/**
 * agent-comms Scope B/C/A wiring for the Happy stdio MCP bridge.
 *
 * This module is the producer/consumer half of the "Durable mailbox + channel
 * wake" pattern (plans/durable-mailbox-channel-wake.md). It is extracted from
 * `happyMcpStdioBridge.ts` so the contract can be unit-tested with dependency
 * injection (no live daemon / codex process needed).
 *
 * Responsibilities, all keyed by the per-session Happy session id:
 *  - register an `agent_comms.send` MCP tool that delegates the scope-aware
 *    write to the injected `sendMessage` daemon hop;
 *  - register an `agent_comms.spawn` MCP tool that reuses the local
 *    spawn-session-from-session path and rejects cross-machine spawn requests
 *    until the Scope A approval + transport follow-up lands;
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
import type { AgentCommsChannel, AgentCommsKind, AgentCommsTo } from '@slopus/happy-wire';
import { logger } from '@/ui/logger';
import type { SpawnSessionFromSessionRpcOptions } from '@/api/apiMachine';
import {
    consumePending,
    ensureInbox,
    inboxDirFor,
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
    target: AgentCommsTo,
    body: unknown,
    senderSessionId: string,
    options?: { channel?: AgentCommsChannel; kind?: AgentCommsKind; correlationId?: string },
) => Promise<{ id: string; seq: number }>;

export type AgentCommsSpawner = (options: SpawnSessionFromSessionRpcOptions) => Promise<unknown>;

export interface RegisterAgentCommsBridgeOptions {
    server: Pick<McpServer, 'registerTool' | 'registerResource' | 'server'>;
    sessionId: string;
    sendMessage: AgentCommsSender;
    spawnSession?: AgentCommsSpawner;
    /** Coalesce window for rapid inbox writes into one wake. Default 50ms. */
    watchDebounceMs?: number;
}

export interface AgentCommsBridgeHandle {
    /** Tear down the inbox watcher and pending debounce. Idempotent. */
    dispose(): void;
}

interface SendToolArgs {
    target?: AgentCommsTo;
    targetSessionId?: string;
    body: unknown;
    channel?: AgentCommsChannel;
    kind?: AgentCommsKind;
    correlationId?: string;
}

interface SpawnToolArgs {
    role?: string;
    plugins?: string[];
    agent: SpawnSessionFromSessionRpcOptions['config']['agent'];
    cwd?: string;
    path?: string;
    machineId?: string;
    initialMessage?: string;
    model?: string;
    permissionMode?: string;
    effortLevel?: string;
}

function normalizeSendTarget(args: SendToolArgs): AgentCommsTo {
    if (args.target?.sessionId) return args.target;
    if (args.targetSessionId) return { sessionId: args.targetSessionId };
    throw new Error('agent_comms.send requires target.sessionId (or legacy targetSessionId)');
}

/**
 * Drain the durable inbox for `sessionId` via the mailbox's serialized,
 * cross-process-locked `consumePending` primitive: read the pending entries,
 * hand them to `build`, then advance the cursor (post-drain consume, F-003) —
 * all inside the same per-inbox critical section as the daemon's appends, so a
 * concurrent send can never interleave and be lost (F-007). A `build` failure
 * leaves the mail unconsumed.
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
    return consumePending(sessionId, build);
}

/**
 * Wire the agent-comms send/spawn tools, resource, and inbox watcher onto an
 * MCP server for one session. Returns a handle whose `dispose()` closes the watcher.
 */
export function registerAgentCommsBridge(opts: RegisterAgentCommsBridgeOptions): AgentCommsBridgeHandle {
    const { server, sessionId, sendMessage, spawnSession } = opts;
    const debounceMs = opts.watchDebounceMs ?? 50;
    const uri = agentCommsInboxUri(sessionId);

    let watcher: fs.FSWatcher | undefined;
    let debounceHandle: ReturnType<typeof setTimeout> | undefined;
    let disposed = false;

    server.registerTool(
        'agent_comms.send',
        {
            title: 'Send agent-comms message',
            description: 'Send a message to another Happy session through the unified scope-aware agent-comms router.',
            inputSchema: {
                target: z.object({
                    machineId: z.string().optional(),
                    sessionId: z.string(),
                }).optional().describe('Recipient target. Omit machineId for same-machine delivery.'),
                targetSessionId: z.string().optional().describe('Legacy same-machine recipient Happy session id.'),
                body: z.unknown().describe('Opaque message payload delivered inside the AgentCommsEnvelope body.'),
                channel: z.enum(['message', 'spawn']).optional().describe('Envelope channel; defaults to message.'),
                kind: z.enum(['request', 'reply', 'notify', 'spawn-request', 'spawn-result']).optional().describe('Message kind; defaults to request.'),
                correlationId: z.string().optional().describe('Request/reply correlation id.'),
            },
        },
        async (args: SendToolArgs) => {
            try {
                const target = normalizeSendTarget(args);
                const result = await sendMessage(target, args.body, sessionId, {
                    channel: args.channel,
                    kind: args.kind,
                    correlationId: args.correlationId,
                });
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

    server.registerTool(
        'agent_comms.spawn',
        {
            title: 'Spawn top-level Happy agent session',
            description: 'Spawn another top-level agent session. Local spawns use spawn-session-from-session; cross-machine spawns are design-level and require operator approval.',
            inputSchema: {
                role: z.string().optional().describe('Optional human-readable role for the spawned agent.'),
                plugins: z.array(z.string()).optional().describe('Plugin ids requested for the spawned agent; preserved for Scope A design payloads.'),
                agent: z.enum(['claude', 'codex', 'gemini', 'openclaw']),
                cwd: z.string().optional().describe('Working directory for the child session.'),
                path: z.string().optional().describe('Alias for cwd.'),
                machineId: z.string().optional().describe('Foreign machine id for a future Scope A spawn-request.'),
                initialMessage: z.string().optional().describe('Initial task sent to the spawned child.'),
                model: z.string().optional(),
                permissionMode: z.string().optional(),
                effortLevel: z.string().optional(),
            },
        },
        async (args: SpawnToolArgs) => {
            try {
                if (args.machineId) {
                    return {
                        content: [{
                            type: 'text' as const,
                            text: JSON.stringify({
                                type: 'deferred-scope-a-spawn',
                                requiresOperatorApproval: true,
                                role: args.role,
                                plugins: args.plugins ?? [],
                                agent: args.agent,
                                cwd: args.cwd ?? args.path,
                                initialMessage: args.initialMessage,
                                message: 'Cross-machine spawn-request envelopes are design-level in this pass; no live remote spawn was attempted.',
                            }),
                        }],
                        isError: true,
                    };
                }
                if (!spawnSession) {
                    throw new Error('local spawn handler not available');
                }
                const result = await spawnSession({
                    parentSessionId: sessionId,
                    config: {
                        agent: args.agent,
                        path: args.cwd ?? args.path,
                        model: args.model,
                        permissionMode: args.permissionMode,
                        effortLevel: args.effortLevel,
                        initialMessage: args.initialMessage,
                    },
                });
                return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] };
            } catch (error) {
                return {
                    content: [{
                        type: 'text' as const,
                        text: `agent-comms spawn failed: ${error instanceof Error ? error.message : String(error)}`,
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
