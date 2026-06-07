/**
 * Startup catch-up for the durable agent-comms mailbox (US-005, D-002).
 *
 * This is the entire "missed wakes are harmless" safety net. On process start
 * (or reconnect), `runCodex.ts` calls {@link recoverPendingAgentCommsMessages}
 * AFTER the input `MessageQueue2` is constructed and BEFORE the codex event
 * handler is bound. If the durable inbox already holds unconsumed entries, the
 * helper pushes EXACTLY ONE wake prompt so the agent re-reads the agent-comms
 * MCP resource on its next turn.
 *
 * Invariants (pinned here and exercised by recovery.test.ts):
 *  - It NEVER calls `mailbox.markConsumed`. A queued wake prompt proves only
 *    that a wake was enqueued, NOT that the receiver drained the durable
 *    mailbox. The cursor advances only through the bridge's explicit
 *    resource-read/drain path (see agentCommsBridge.ts `drainAgentCommsInbox`).
 *  - It returns NO message bodies. The wake payload is the literal
 *    {@link AGENT_COMMS_WAKE_PROMPT}; bodies are delivered only by the drain.
 *  - It enqueues at most ONE wake regardless of how many entries are pending
 *    (the drain picks up all N atomically).
 *
 * This helper does NOT replay lost `resource_updated` notifications — the
 * filesystem mailbox is the source of truth, so a re-read fully recovers.
 */

import { readPending } from '@/agentComms/mailbox';

/**
 * The single human-readable wake string pushed onto the input queue when
 * pending agent-comms mail is detected. Intentionally free of message bodies
 * and counts: it only tells the agent to drain the agent-comms MCP resource.
 */
export const AGENT_COMMS_WAKE_PROMPT =
    '[agent-comms] you have pending message(s); read the agent-comms MCP resource to drain';

/**
 * Minimal slice of `MessageQueue2` the recovery helper needs, so tests can pass
 * a tiny fake without depending on the full queue surface.
 */
export interface AgentCommsWakeQueue<TMode> {
    push(message: string, mode: TMode): void;
}

/**
 * Scan the session's durable inbox once on startup; if any unconsumed entries
 * exist, push exactly one wake prompt onto `queue` tagged with `currentMode()`.
 *
 * @returns `{ wakeEnqueued: true }` when a wake was pushed, `{ wakeEnqueued:
 *   false }` when the inbox was empty. Never marks anything consumed.
 */
export async function recoverPendingAgentCommsMessages<TMode>(
    sessionId: string,
    queue: AgentCommsWakeQueue<TMode>,
    currentMode: () => TMode,
): Promise<{ wakeEnqueued: boolean }> {
    const pending = await readPending(sessionId);
    if (pending.length === 0) {
        return { wakeEnqueued: false };
    }
    queue.push(AGENT_COMMS_WAKE_PROMPT, currentMode());
    return { wakeEnqueued: true };
}
