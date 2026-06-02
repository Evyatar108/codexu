/**
 * Codex MCP-notification consumer (Option B for codex-channels).
 *
 * Subscribes to the codex/event stream variants added in Stage A
 * (`EventMsg::McpServerNotification`, `EventMsg::McpSamplingRequest`) and:
 *
 * - For `mcp_server_notification`: resolves the configured route, debounces
 *   per `${server}|${uri ?? kind}` when the route requests it, synthesizes a
 *   prompt string from the template, and pushes it onto the existing input
 *   `MessageQueue2` as a second producer alongside live user messages.
 *
 * - For `mcp_sampling_request`: out of scope for Option B. Log once per
 *   server name per session and continue. A future task wires the reply path.
 *
 * - Any other event type: ignored silently.
 *
 * The consumer is generic over the message-queue mode type (`TMode`) so it
 * does not need to know about runCodex's inline `EnhancedMode` shape.
 *
 * See `.ralph/jobs/codex-channels-option-b/plan.md` §5 (Story 2) for the
 * acceptance criteria and §4 for the sampling decision.
 */

import { logger } from '@/ui/logger';

import type {
    McpNotificationKind,
    McpNotificationRoutingConfig,
    RouteAction,
} from './mcpNotificationRouting';
import {
    MCP_NOTIFICATION_KINDS,
    renderNotificationTemplate,
    resolveRoute,
} from './mcpNotificationRouting';

/**
 * Minimal slice of `MessageQueue2` the consumer needs. Lets tests pass in
 * a tiny fake without depending on the full queue surface.
 */
export interface PromptQueuePusher<TMode> {
    push(message: string, mode: TMode): void;
}

/**
 * Injectable clock so debounce timing is deterministic under tests.
 * Defaults to global `setTimeout`/`clearTimeout`.
 */
export interface DebounceClock {
    setTimeout: (cb: () => void, ms: number) => NodeJS.Timeout | number;
    clearTimeout: (handle: NodeJS.Timeout | number) => void;
}

const DEFAULT_CLOCK: DebounceClock = {
    setTimeout: (cb, ms) => setTimeout(cb, ms),
    clearTimeout: (h) => clearTimeout(h as NodeJS.Timeout),
};

export interface McpNotificationConsumer {
    /** Feed one codex `EventMsg` into the consumer. Safe to call on every event. */
    handle(msg: { type?: string } & Record<string, unknown>): void;
    /** Cancel any in-flight debounce timers. Call on session shutdown. */
    dispose(): void;
}

export interface CreateMcpNotificationConsumerOptions<TMode> {
    routing: McpNotificationRoutingConfig;
    messageQueue: PromptQueuePusher<TMode>;
    /** Accessor returning the current `EnhancedMode` shape to tag synthesized pushes with. */
    currentMode: () => TMode;
    /** Optional clock for deterministic debounce in tests. */
    clock?: DebounceClock;
}

interface PendingDebounce {
    handle: NodeJS.Timeout | number;
}

/**
 * Build the notification consumer.
 *
 * The returned `handle` is intended to be invoked at the top of
 * `client.setEventHandler((msg) => …)` in `runCodex.ts`. It is a no-op when
 * the routing config has `enabled: false`, so wiring it in unconditionally
 * is safe.
 */
export function createMcpNotificationConsumer<TMode>(
    opts: CreateMcpNotificationConsumerOptions<TMode>,
): McpNotificationConsumer {
    const { routing, messageQueue, currentMode } = opts;
    const clock = opts.clock ?? DEFAULT_CLOCK;

    const debounces = new Map<string, PendingDebounce>();
    const samplingWarned = new Set<string>();

    function flushPush(key: string, text: string): void {
        debounces.delete(key);
        try {
            messageQueue.push(text, currentMode());
            logger.debug(`[mcpNotificationConsumer] pushed prompt key=${key} len=${text.length}`);
        } catch (err) {
            logger.debug(`[mcpNotificationConsumer] push failed key=${key}: ${String(err)}`);
        }
    }

    function enqueuePush(server: string, kind: McpNotificationKind, uri: string | undefined, text: string, action: RouteAction): void {
        if (action.type !== 'prompt-queue') return;
        const debounceMs = action.debounceMs ?? 0;
        const key = `${server}|${uri ?? kind}`;
        if (debounceMs <= 0) {
            flushPush(key, text);
            return;
        }
        const existing = debounces.get(key);
        if (existing) clock.clearTimeout(existing.handle);
        const handle = clock.setTimeout(() => flushPush(key, text), debounceMs);
        debounces.set(key, { handle });
    }

    function handleServerNotification(msg: Record<string, unknown>): void {
        if (!routing.enabled) return;
        const server = typeof msg.server_name === 'string' ? msg.server_name : '';
        const kindRaw = msg.kind;
        if (!server) {
            logger.debug('[mcpNotificationConsumer] dropping notification with empty server_name');
            return;
        }
        if (typeof kindRaw !== 'string' || !(MCP_NOTIFICATION_KINDS as ReadonlyArray<string>).includes(kindRaw)) {
            logger.debug(`[mcpNotificationConsumer] dropping notification with unknown kind=${String(kindRaw)} server=${server}`);
            return;
        }
        const kind = kindRaw as McpNotificationKind;
        const params = msg.params;
        const action = resolveRoute(routing, server, kind);
        if (action.type === 'display-only') {
            logger.debug(`[mcpNotificationConsumer] display-only kind=${kind} server=${server}`);
            return;
        }

        let text: string;
        try {
            text = renderNotificationTemplate(action.template, server, kind, params);
        } catch (err) {
            logger.debug(`[mcpNotificationConsumer] template synthesis failed kind=${kind} server=${server}: ${String(err)}`);
            text = `[mcp:${server}] ${kind} (synthesis error: see logs)`;
        }
        const uri = typeof (params as Record<string, unknown> | null)?.uri === 'string'
            ? ((params as Record<string, unknown>).uri as string)
            : undefined;
        enqueuePush(server, kind, uri, text, action);
    }

    function handleSamplingRequest(msg: Record<string, unknown>): void {
        const server = typeof msg.server_name === 'string' ? msg.server_name : '<unknown>';
        if (samplingWarned.has(server)) return;
        samplingWarned.add(server);
        // TODO(codex-sampling-handler): sampling responses are not yet wired
        // through happy-cli; see plan.md §4.
        logger.warn(
            `[mcpNotificationConsumer] mcp_sampling_request from "${server}" is not yet supported — logging and ignoring. Future work: wire reply path through happy-cli.`,
        );
    }

    return {
        handle(msg) {
            if (!msg || typeof msg !== 'object') return;
            const type = msg.type;
            if (type === 'mcp_server_notification') {
                handleServerNotification(msg);
                return;
            }
            if (type === 'mcp_sampling_request') {
                handleSamplingRequest(msg);
                return;
            }
            // Unknown / unrelated event types: silently ignore.
        },
        dispose() {
            for (const pending of debounces.values()) {
                clock.clearTimeout(pending.handle);
            }
            debounces.clear();
        },
    };
}
