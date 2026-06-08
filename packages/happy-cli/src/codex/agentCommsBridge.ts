/**
 * agent-comms Scope B (D-002) wiring for the Happy stdio MCP bridge.
 *
 * This module is the producer/consumer half of the "Durable mailbox + channel
 * wake" pattern (plans/durable-mailbox-channel-wake.md). It is extracted from
 * `happyMcpStdioBridge.ts` so the contract can be unit-tested with dependency
 * injection (no live daemon / codex process needed).
 *
 * Responsibilities, all keyed by the per-session Happy session id:
 *  - register an `agent_comms.send` MCP tool that delegates the cross-session
 *    write to the injected `sendMessage` (the daemon hop in US-004);
 *  - register an `agent-comms` MCP resource whose read callback DRAINS the
 *    durable inbox and returns the pending entries (post-drain consume, F-001);
 *  - watch the inbox DIRECTORY (not the file — F-003) and emit a
 *    `resource_updated` WAKE HINT on `mailbox.json` changes, debounced to
 *    coalesce rapid writes;
 *  - emit one initial (non-consuming) wake if mail already landed before the
 *    watcher armed (closes the write-before-watch startup gap).
 *
 * Invariants:
 *  - The watcher / wake path NEVER calls `markConsumed`. Consumption happens
 *    ONLY in the resource-read drain callback, AFTER the response payload is
 *    built. The wake is just a hint; the durable mailbox is the source of truth.
 *  - The wake/resource URI uses the stable logical scheme
 *    `agent-comms://inbox/<sessionId>` (Northstar rule 3), NOT a `file:///`
 *    URI — so the wire shape stays stable when a future transport swaps the
 *    filesystem mailbox for an app-server RPC or cross-machine relay.
 */

import * as fs from 'node:fs';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { logger } from '@/ui/logger';
import {
    ensureInbox,
    inboxDirFor,
    markConsumed,
    readPending,
    type MailboxEntry,
} from '@/agentComms/mailbox';

/**
 * Stable wake-URI scheme (Northstar rule 3). Logical and transport-independent:
 * the URI a consumer sees stays the same even if the underlying transport
 * changes. NOT a `file:///` URI of the mailbox file.
 */
export function agentCommsInboxUri(sessionId: string): string {
    return `agent-comms://inbox/${sessionId}`;
}

/**
 * Injected cross-session send (the US-004 daemon hop). Kept as a parameter so
 * the bridge can be unit-tested without the real control client / daemon.
 */
export type AgentCommsSender = (
    targetSessionId: string,
    body: unknown,
    senderSessionId: string,
) => Promise<{ id: string; seq: number }>;

export interface RegisterAgentCommsBridgeOptions {
    server: Pick<McpServer, 'registerTool' | 'registerResource' | 'server'>;
    sessionId: string;
    sendMessage: AgentCommsSender;
    /** Coalesce window for rapid inbox writes into one wake. Default 50ms. */
    watchDebounceMs?: number;
}

export interface AgentCommsBridgeHandle {
    /** Tear down the inbox watcher and pending debounce. Idempotent. */
    dispose(): void;
}

// Per-session drain serialization so two concurrent resource reads cannot both
// `readPending` before either `markConsumed` (which would double-deliver). Each
// drain chains after the previous one for the same session.
const drainChains = new Map<string, Promise<unknown>>();

/**
 * Drain the durable inbox for `sessionId`: read the pending entries, hand them
 * to `build` to construct the caller's payload, and ONLY THEN advance the
 * cursor via `markConsumed` (post-drain consume, F-001 + F-003). Building the
 * payload BEFORE consuming means a payload-construction failure leaves the mail
 * unconsumed and recoverable. Drains for the same session are serialized.
 *
 * Drain-acknowledgment boundary: the strongest drain-success signal the MCP
 * resource-read API exposes is the read callback's return — there is no
 * post-transport delivery ack. A transport failure AFTER this returns is an
 * accepted at-most-once edge in v1 (documented in
 * plans/durable-mailbox-channel-wake.md). The durable mailbox + missed-wake
 * recovery cover the pre-consume window, not post-consume transport loss.
 */
export function drainAgentCommsInbox<T>(
    sessionId: string,
    build: (entries: MailboxEntry[]) => T,
): Promise<T> {
    const prior = drainChains.get(sessionId) ?? Promise.resolve();
    const next = prior
        // A prior drain failure must not poison the chain for the next caller.
        .catch(() => undefined)
        .then(async () => {
            const entries = await readPending(sessionId);
            const result = build(entries); // build payload BEFORE consuming
            if (entries.length > 0) {
                await markConsumed(sessionId, entries[entries.length - 1].seq);
            }
            return result;
        });
    drainChains.set(sessionId, next.catch(() => undefined));
    return next;
}

/**
 * Wire the agent-comms send tool, resource, and inbox watcher onto an MCP
 * server for one session. Returns a handle whose `dispose()` closes the watcher.
 */
export function registerAgentCommsBridge(opts: RegisterAgentCommsBridgeOptions): AgentCommsBridgeHandle {
    const { server, sessionId, sendMessage } = opts;
    const debounceMs = opts.watchDebounceMs ?? 50;
    const uri = agentCommsInboxUri(sessionId);

    let watcher: fs.FSWatcher | undefined;
    let debounceHandle: ReturnType<typeof setTimeout> | undefined;
    let disposed = false;

    server.registerTool(
        'agent_comms.send',
        {
            title: 'Send agent-comms message',
            description: 'Send a message to another Happy session on the same daemon (agent-comms Scope B).',
            inputSchema: {
                targetSessionId: z.string().describe('Recipient Happy session id.'),
                body: z.unknown().describe('Opaque message payload delivered to the recipient inbox.'),
            },
        },
        async (args: { targetSessionId: string; body: unknown }) => {
            try {
                const result = await sendMessage(args.targetSessionId, args.body, sessionId);
                return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] };
            } catch (error) {
                return {
                    content: [{
                        type: 'text' as const,
                        text: `agent-comms send failed: ${error instanceof Error ? error.message : String(error)}`,
                    }],
                    isError: true,
                };
            }
        },
    );

    server.registerResource(
        'agent-comms',
        uri,
        {
            title: 'Pending agent-comms messages',
            description: 'Reading this resource drains the durable agent-comms inbox for this session.',
            mimeType: 'application/json',
        },
        // The drained payload carries the top-level `version: 1` envelope
        // (Northstar rule 1). The wake `resource_updated` notification itself is
        // a protocol-fixed `{ uri }`-only hint (MCP cannot carry extra params),
        // so the versioned envelope rides the mailbox entries + this payload, not
        // the wake. The cursor advances only after this payload object is built.
        async () => drainAgentCommsInbox(sessionId, (entries) => ({
            contents: [{
                uri,
                mimeType: 'application/json',
                text: JSON.stringify({ version: 1, entries }),
            }],
        })),
    );

    function emitWakeRaw(): void {
        if (disposed) return;
        // WAKE HINT ONLY — never marks consumed.
        void Promise.resolve(server.server.sendResourceUpdated({ uri })).catch((err) => {
            logger.debug(`[agent-comms] sendResourceUpdated failed for ${sessionId}: ${String(err)}`);
        });
    }

    // Gate every wake on an actual pending-mail check (still NON-consuming).
    // This keeps the wake accurate and suppresses spurious self-wakes from the
    // bridge's own writes: `ensureInbox`'s empty-mailbox creation and the drain
    // callback's `markConsumed` write both land in the watched directory, and
    // fs.watch can surface them (or a stale event around watch-arm). Re-reading
    // the cursor means those self-writes produce no wake when no mail is pending.
    async function checkAndWake(): Promise<void> {
        if (disposed) return;
        try {
            const pending = await readPending(sessionId);
            if (!disposed && pending.length > 0) emitWakeRaw();
        } catch (err) {
            logger.debug(`[agent-comms] wake check failed for ${sessionId}: ${String(err)}`);
        }
    }

    function scheduleWake(): void {
        if (disposed) return;
        if (debounceHandle) clearTimeout(debounceHandle);
        debounceHandle = setTimeout(() => { void checkAndWake(); }, debounceMs);
    }

    // Arm everything AFTER the inbox dir + empty mailbox.json exist.
    void ensureInbox(sessionId)
        .then(async () => {
            if (disposed) return;
            const dir = inboxDirFor(sessionId);
            watcher = fs.watch(dir, { persistent: false }, (_eventType, filename) => {
                // Some platforms omit filename; treat null as a possible change.
                if (filename === null || filename === 'mailbox.json') {
                    scheduleWake();
                }
            });
            // Initial scan closes the write-before-watch gap: if mail already
            // landed before the watcher armed, wake once (gated on real mail).
            await checkAndWake();
        })
        .catch((err) => {
            logger.debug(`[agent-comms] bridge arm failed for ${sessionId}: ${String(err)}`);
        });

    return {
        dispose() {
            disposed = true;
            if (debounceHandle) {
                clearTimeout(debounceHandle);
                debounceHandle = undefined;
            }
            if (watcher) {
                try {
                    watcher.close();
                } catch {
                    /* watcher already closed */
                }
                watcher = undefined;
            }
        },
    };
}
