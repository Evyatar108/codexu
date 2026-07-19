import { logger } from '@/ui/logger'
import { EventEmitter } from 'node:events'
import { io, Socket } from 'socket.io-client'
import { AgentState, ClientToServerEvents, MessageMeta, Metadata, ServerToClientEvents, Session, Update, UserMessage, UserMessageSchema, Usage } from './types'
import { decodeBase64, decrypt, encodeBase64, encrypt } from './encryption';
import { decodeIncoming, encodeOutgoing } from './sessionPayloadCodec';
import { backoff, delay } from '@/utils/time';
import { configuration } from '@/configuration';
import * as daemonClient from '@/daemon/daemonClient';
import { RawJSONLines } from '@/claude/types';
import { randomUUID } from 'node:crypto';
import { AsyncLock } from '@/utils/lock';
import { RpcHandlerManager } from './rpc/RpcHandlerManager';
import { registerCommonHandlers } from '../modules/common/registerCommonHandlers';
import { shouldReconnect } from '@/utils/lidState';
import {
    type AgentTreeDelta,
    createEnvelope,
    findSenderDropEntry,
    type SessionContextBoundaryEvent,
    type SessionEnvelope,
    type SessionMessageConsumptionEvent,
    type SessionTurnEndStatus,
} from '@slopus/happy-wire';
import {
    closeClaudeTurnWithStatus,
    mapClaudeLogMessageToSessionEnvelopes,
    type ClaudeSessionProtocolState,
} from '@/claude/utils/sessionProtocolMapper';
import { normalizeSessionLogMessage } from '@/claude/utils/normalizeSessionLogMessage';
import { InvalidateSync } from '@/utils/sync';


const CONSUMPTION_ACK_TIMEOUT_MS = (() => {
    const raw = process.env.HAPPY_CONSUMPTION_ACK_TIMEOUT_MS;
    if (typeof raw !== 'string' || raw.length === 0) {
        return 60_000;
    }
    const parsed = parseInt(raw, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 60_000;
})();

export class MessageConsumptionTimeoutError extends Error {
    readonly messageId: string;
    constructor(messageId: string) {
        super(`consumedPromise timed out after ${CONSUMPTION_ACK_TIMEOUT_MS}ms for messageId=${messageId}`);
        this.name = 'MessageConsumptionTimeoutError';
        this.messageId = messageId;
    }
}

const OBSERVED_CONSUMPTIONS_MAX_ENTRIES = 256;

/**
 * ACP (Agent Communication Protocol) message data types.
 * This is the unified format for all agent messages - CLI adapts each provider's format to ACP.
 */
export type ACPMessageData =
    // Core message types
    | { type: 'message'; message: string }
    | { type: 'reasoning'; message: string }
    | { type: 'thinking'; text: string }
    // Tool interactions
    | { type: 'tool-call'; callId: string; name: string; input: unknown; id: string }
    | { type: 'tool-result'; callId: string; output: unknown; id: string; isError?: boolean }
    // File operations
    | { type: 'file-edit'; description: string; filePath: string; diff?: string; oldContent?: string; newContent?: string; id: string }
    // Terminal/command output
    | { type: 'terminal-output'; data: string; callId: string }
    // Task lifecycle events
    | { type: 'task_started'; id: string }
    | { type: 'task_complete'; id: string }
    | { type: 'turn_aborted'; id: string }
    // Permissions
    | { type: 'permission-request'; permissionId: string; toolName: string; description: string; options?: unknown }
    // Usage/metrics
    | { type: 'token_count';[key: string]: unknown };

export type ACPProvider = 'gemini' | 'codex' | 'claude' | 'opencode';

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
}

type V3SessionMessage = {
    id: string;
    seq: number;
    content: { t: 'encrypted'; c: string };
    localId: string | null;
    createdAt: number;
    updatedAt: number;
};

type V3GetSessionMessagesResponse = {
    messages: V3SessionMessage[];
    hasMore: boolean;
};

type V3PostSessionMessagesResponse = {
    messages: Array<{
        id: string;
        seq: number;
        localId: string | null;
        createdAt: number;
        updatedAt: number;
    }>;
};

type ContextBoundaryInput = Omit<SessionContextBoundaryEvent, 't'>;
type MessageConsumptionInput = Pick<SessionMessageConsumptionEvent, 'messageId' | 'agentFlavor'>;

export type MessageDelivery = {
    id: string;
    seq: number;
};

type PendingOutboxMessage = {
    content: string;
    localId: string;
};

type PendingDelivery = {
    promise: Promise<MessageDelivery>;
    resolve: (delivery: MessageDelivery) => void;
    reject: (err: unknown) => void;
};

export type AgentConfiguration = {
    permissionMode?: string;
    model?: string;
    thinkingLevel?: string;
};

const MAX_AGENT_CONFIG_FIELD_LENGTH = 64;

type AgentConfigurationSnapshot = {
    permissionMode: string | undefined;
    model: string | undefined;
    thinkingLevel: string | undefined;
};

function coerceMetadataString(value: unknown): string | undefined {
    return typeof value === 'string' ? value : undefined;
}

function agentConfigurationSnapshot(metadata: Metadata | null): AgentConfigurationSnapshot {
    return {
        permissionMode: coerceMetadataString(metadata?.currentPermissionModeCode),
        model: coerceMetadataString(metadata?.currentModelCode),
        thinkingLevel: coerceMetadataString(metadata?.currentThoughtLevelCode),
    };
}

function diffAgentConfiguration(
    previous: AgentConfigurationSnapshot,
    next: AgentConfigurationSnapshot,
): AgentConfiguration | null {
    const diff: AgentConfiguration = {};
    let changed = false;

    if (previous.permissionMode !== next.permissionMode) {
        diff.permissionMode = next.permissionMode;
        changed = true;
    }
    if (previous.model !== next.model) {
        diff.model = next.model;
        changed = true;
    }
    if (previous.thinkingLevel !== next.thinkingLevel) {
        diff.thinkingLevel = next.thinkingLevel;
        changed = true;
    }

    return changed ? diff : null;
}

function contextBoundaryFallbackMessage(kind: ContextBoundaryInput['kind']): string {
    switch (kind) {
        case 'clear':
            return 'Context was reset';
        case 'compact':
        case 'autocompact':
            return 'Compaction completed';
        case 'plan-mode-enter':
            return 'Entering plan mode';
        case 'plan-mode-exit':
            return 'Exiting plan mode';
        case 'session-fork-resume':
            return 'Resumed from previous session';
    }
}

function safeDebug(...args: Parameters<typeof logger.debug>): void {
    try {
        logger.debug(...args);
    } catch {
        // Diagnostics must never affect session ownership or transport cleanup.
    }
}

async function withClearedDeadline<T>(promise: Promise<T>, timeoutMs: number): Promise<T | undefined> {
    let timer: NodeJS.Timeout | null = null;
    try {
        return await Promise.race([
            promise,
            new Promise<undefined>((resolve) => {
                timer = setTimeout(() => resolve(undefined), timeoutMs);
            }),
        ]);
    } finally {
        if (timer) clearTimeout(timer);
    }
}

export class ApiSessionClient extends EventEmitter {
    private readonly token: string;
    readonly sessionId: string;
    private metadata: Metadata | null;
    private metadataVersion: number;
    private agentState: AgentState | null;
    private agentStateVersion: number;
    private socket: Socket<ServerToClientEvents, ClientToServerEvents> | null = null;
    private socketReady: Promise<void>;
    private pendingMessages: UserMessage[] = [];
    private pendingMessageCallback: ((message: UserMessage) => void) | null = null;
    private pendingAgentConfigurations: AgentConfiguration[] = [];
    private lastAppliedAgentConfiguration: AgentConfigurationSnapshot;
    readonly rpcHandlerManager: RpcHandlerManager;
    private agentStateLock = new AsyncLock();
    private metadataLock = new AsyncLock();
    private encryptionKey: Uint8Array;
    private encryptionVariant: 'legacy' | 'dataKey';
    private closed = false;
    private reconnectInterval: NodeJS.Timeout | null = null;
    private reconnectTimeout: NodeJS.Timeout | null = null;
    private ignoreArchiveSignal = false;
    private skipInitialMessages = false;
    private claudeSessionProtocolState: ClaudeSessionProtocolState = {
        currentTurnId: null,
        uuidToProviderSubagent: new Map<string, string>(),
        taskPromptToSubagents: new Map<string, string[]>(),
        providerSubagentToSessionSubagent: new Map<string, string>(),
        subagentTitles: new Map<string, string>(),
        bufferedSubagentMessages: new Map<string, RawJSONLines[]>(),
        hiddenParentToolCalls: new Set<string>(),
        startedSubagents: new Set<string>(),
        activeSubagents: new Set<string>(),
    };
    private lastSeq = 0;
    private pendingOutbox: PendingOutboxMessage[] = [];
    private pendingOutboxHead = 0;
    private seqResolvers: Map<string, PendingDelivery> = new Map();
    private outboundDeliverySeqs: Map<string, number | null> = new Map();
    private outboundDeliveryHeap: Array<{ localId: string; seq: number }> = [];
    private consumptionResolvers: Map<string, { resolve: (event: SessionMessageConsumptionEvent) => void; reject: (err: unknown) => void }> = new Map();
    private observedConsumptions: Map<string, SessionMessageConsumptionEvent> = new Map();
    private pendingSummaryText: string | null = null;
    private readonly sendSync: InvalidateSync;
    private readonly receiveSync: InvalidateSync;

    private socketAuthBase() {
        return {
            token: this.token,
            clientType: 'session-scoped' as const,
            sessionId: this.sessionId,
            happyClient: `cli-coding-session/${configuration.currentCliVersion}`
        };
    }

    constructor(
        token: string,
        session: Session,
        options: { rpcProfile?: 'full' | 'mirror-read-only' } = {},
    ) {
        super()
        this.token = token;
        this.sessionId = session.id;
        this.metadata = session.metadata;
        this.metadataVersion = session.metadataVersion;
        this.lastAppliedAgentConfiguration = agentConfigurationSnapshot(session.metadata);
        this.agentState = session.agentState;
        this.agentStateVersion = session.agentStateVersion;
        this.encryptionKey = session.encryptionKey;
        this.encryptionVariant = session.encryptionVariant;
        this.sendSync = new InvalidateSync(() => this.flushOutbox());
        this.receiveSync = new InvalidateSync(() => this.fetchMessages());

        // Initialize RPC handler manager
        this.rpcHandlerManager = new RpcHandlerManager({
            scopePrefix: this.sessionId,
            logger: (msg, data) => safeDebug(msg, data)
        });
        if (options.rpcProfile !== 'mirror-read-only') {
            registerCommonHandlers(this.rpcHandlerManager, this.metadata.path);
        }

        //
        // Connect (deferred until tunnel URL is resolved)
        //

        this.socketReady = this.connectWithFreshTunnelAuth().catch((error) => {
            safeDebug('[API] Failed to prepare initial tunnel socket auth:', error);
        });
    }

    private buildSocket(url: string, auth: object, extraHeaders?: Record<string, string>): Socket<ServerToClientEvents, ClientToServerEvents> {
        const socket = io(url, {
            auth,
            // Attached only in public mode (see daemonClient.tunnelSocketIOOptions):
            // the local loopback capability that authenticates this co-resident
            // client to the public listener's handshake. Omitted otherwise so
            // non-public socket options stay unchanged. Honored on the ws upgrade
            // request in Node (unlike browsers).
            ...(extraHeaders ? { extraHeaders } : {}),
            path: '/v1/updates',
            reconnection: false,
            transports: ['websocket'],
            withCredentials: true,
            autoConnect: false
        });

        socket.on('connect', () => {
            if (this.closed) {
                socket.close();
                return;
            }
            safeDebug('Socket connected successfully');
            if (this.reconnectInterval) {
                clearInterval(this.reconnectInterval);
                this.reconnectInterval = null;
            }
            if (this.reconnectTimeout) {
                clearTimeout(this.reconnectTimeout);
                this.reconnectTimeout = null;
            }
            this.rpcHandlerManager.onSocketConnect(socket);
            this.receiveSync.invalidate();
        });

        socket.on('rpc-request', async (data: { method: string, params: unknown }, callback: (response: unknown) => void) => {
            if (this.closed) return;
            const response = await this.rpcHandlerManager.handleRequest(data);
            if (!this.closed) {
                callback(response);
            }
        });

        socket.on('disconnect', (reason) => {
            safeDebug(`[API] Socket disconnected: ${reason}`);
            this.rpcHandlerManager.onSocketDisconnect();
            this.startSmartReconnect();
        });

        socket.on('connect_error', (error) => {
            safeDebug('[API] Socket connection error:', error);
            this.rpcHandlerManager.onSocketDisconnect();
            this.startSmartReconnect();
        });

        socket.on('update', (data: Update) => {
            if (this.closed) return;
            try {
                logger.debugLargeJson('[SOCKET] [UPDATE] Received update:', data);

                if (!data.body) {
                    logger.debug('[SOCKET] [UPDATE] [ERROR] No body in update!');
                    return;
                }

                if (data.body.t === 'new-message') {
                    const messageSeq = data.body.message?.seq;
                    const localId = data.body.message?.localId;
                    if (localId && this.resolveOutboundDelivery(localId, {
                        id: data.body.message.id,
                        seq: messageSeq,
                    })) {
                        this.receiveSync.invalidate();
                        return;
                    }
                    if (this.lastSeq === 0) {
                        this.receiveSync.invalidate();
                        return;
                    }
                    if (typeof messageSeq !== 'number' || messageSeq !== this.lastSeq + 1) {
                        this.receiveSync.invalidate();
                        return;
                    }
                    // FORK PATCH: RESTORE-R2-done live-receive path routes through the fork codec seam decodeIncoming({source:'live'}) in sessionPayloadCodec.ts, which parses content.c as plaintext JSON (no decrypt), mirroring the plaintext send path — behavior-preserving relocation, bytes unchanged (invariant HC-2)
                    const body = decodeIncoming(data.body.message.content.c, { source: 'live' });
                    logger.debugLargeJson('[SOCKET] [UPDATE] Received update:', body)
                    this.routeIncomingMessage(body, {
                        id: data.body.message.id,
                        seq: messageSeq,
                    });
                    this.lastSeq = messageSeq;
                    this.evictScannedOutboundDeliveries();
                } else if (data.body.t === 'update-session') {
                    if (data.body.metadata && data.body.metadata.version > this.metadataVersion) {
                        const nextMetadata = JSON.parse(data.body.metadata.value);
                        this.metadata = nextMetadata;
                        this.metadataVersion = data.body.metadata.version;
                        this.routeAgentConfigurationIfChanged(nextMetadata);
                        const meta = this.metadata as any;
                        if (meta?.lifecycleState === 'archiveRequested' || meta?.lifecycleState === 'archived') {
                            if (this.ignoreArchiveSignal) {
                                logger.debug(`[SOCKET] Session archived (${meta.lifecycleState}) but suppressed for reconnect`);
                                this.ignoreArchiveSignal = false;
                            } else {
                                logger.debug(`[SOCKET] Session archived (${meta.lifecycleState}), exiting...`);
                                this.rejectPendingConsumptionAcks(new Error('Session archived before message consumption was observed'));
                                this.emit('archived');
                            }
                        }
                    }
                    if (data.body.agentState && data.body.agentState.version > this.agentStateVersion) {
                        this.agentState = data.body.agentState.value ? decrypt(this.encryptionKey, this.encryptionVariant, decodeBase64(data.body.agentState.value)) : null;
                        this.agentStateVersion = data.body.agentState.version;
                    }
                } else if (data.body.t === 'update-machine') {
                    logger.debug(`[SOCKET] WARNING: Session client received unexpected machine update - ignoring`);
                } else {
                    this.emit('message', data.body);
                }
            } catch (error) {
                logger.debug('[SOCKET] [UPDATE] [ERROR] Error handling update', { error });
            }
        });

        socket.on('error', (error) => {
            logger.debug('[API] Socket error:', error);
        });

        return socket;
    }

    private async connectWithFreshTunnelAuth(): Promise<void> {
        if (this.closed) return;
        const options = await daemonClient.tunnelSocketIOOptions();
        if (this.closed) return;
        const auth = {
            ...this.socketAuthBase(),
            ...options.auth,
        };
        if (this.socket) {
            this.socket.removeAllListeners();
            this.socket.disconnect();
        }
        this.socket = this.buildSocket(options.url, auth, options.extraHeaders);
        this.socket.connect();
    }

    onUserMessage(callback: (data: UserMessage) => void) {
        this.pendingMessageCallback = callback;
        while (this.pendingMessages.length > 0) {
            callback(this.pendingMessages.shift()!);
        }
    }

    onAgentConfiguration(callback: (data: AgentConfiguration) => void) {
        this.on('agent-configuration', callback);
        while (this.pendingAgentConfigurations.length > 0) {
            callback(this.pendingAgentConfigurations.shift()!);
        }
    }

    private authHeaders() {
        return {
            'Authorization': `Bearer ${this.token}`,
            'Content-Type': 'application/json',
            'X-Happy-Client': `cli-coding-session/${configuration.currentCliVersion}`
        };
    }

    private routeIncomingMessage(message: unknown, delivery?: MessageDelivery) {
        const userResult = UserMessageSchema.safeParse(message);
        if (userResult.success) {
            const userMessage = userResult.data;
            if (delivery) {
                Object.defineProperties(userMessage, {
                    messageId: { value: delivery.id, enumerable: false, configurable: true },
                    seq: { value: delivery.seq, enumerable: false, configurable: true },
                });
            }
            if (this.pendingMessageCallback) {
                this.pendingMessageCallback(userMessage);
            } else {
                this.pendingMessages.push(userMessage);
            }
            return;
        }
        const consumption = this.getSessionMessageConsumptionEvent(message);
        if (consumption) {
            this.resolveConsumptionAck(consumption);
        }
        this.emit('message', message);
    }

    private getSessionMessageConsumptionEvent(message: unknown): SessionMessageConsumptionEvent | null {
        if (!isRecord(message) || message.role !== 'session' || !isRecord(message.content)) {
            return null;
        }
        const content = message.content;
        const envelope = content.type === 'session' && isRecord(content.data)
            ? content.data
            : content;
        if (!isRecord(envelope) || !isRecord(envelope.ev)) {
            return null;
        }
        const ev = envelope.ev;
        if (ev.t !== 'message-consumption' || typeof ev.messageId !== 'string' || typeof ev.consumedAt !== 'number') {
            return null;
        }
        if (ev.agentFlavor !== 'claude' && ev.agentFlavor !== 'codex') {
            return null;
        }
        return ev as SessionMessageConsumptionEvent;
    }

    private resolveConsumptionAck(event: SessionMessageConsumptionEvent) {
        const pending = this.consumptionResolvers.get(event.messageId);
        if (!pending) {
            if (this.observedConsumptions.has(event.messageId)) {
                this.observedConsumptions.delete(event.messageId);
            } else if (this.observedConsumptions.size >= OBSERVED_CONSUMPTIONS_MAX_ENTRIES) {
                const oldestKey = this.observedConsumptions.keys().next().value;
                if (oldestKey !== undefined) {
                    this.observedConsumptions.delete(oldestKey);
                }
            }
            this.observedConsumptions.set(event.messageId, event);
            return;
        }
        this.consumptionResolvers.delete(event.messageId);
        pending.resolve(event);
    }

    private waitForConsumptionAck(messageId: string, signal?: AbortSignal): Promise<SessionMessageConsumptionEvent> {
        const observed = this.observedConsumptions.get(messageId);
        if (observed) {
            this.observedConsumptions.delete(messageId);
            return Promise.resolve(observed);
        }
        return new Promise((resolve, reject) => {
            this.consumptionResolvers.set(messageId, { resolve, reject });

            const onAbort = () => {
                if (this.consumptionResolvers.has(messageId)) {
                    this.consumptionResolvers.delete(messageId);
                    reject(signal!.reason instanceof Error ? signal!.reason : new Error('consumedPromise aborted'));
                }
                clearTimeout(timeoutHandle);
            };

            const timeoutHandle = setTimeout(() => {
                if (this.consumptionResolvers.has(messageId)) {
                    this.consumptionResolvers.delete(messageId);
                    reject(new MessageConsumptionTimeoutError(messageId));
                }
                signal?.removeEventListener('abort', onAbort);
            }, CONSUMPTION_ACK_TIMEOUT_MS);
            timeoutHandle.unref?.();

            if (signal) {
                if (signal.aborted) {
                    clearTimeout(timeoutHandle);
                    this.consumptionResolvers.delete(messageId);
                    reject(signal.reason instanceof Error ? signal.reason : new Error('consumedPromise aborted'));
                    return;
                }
                signal.addEventListener('abort', onAbort, { once: true });
            }
        });
    }

    private rejectPendingConsumptionAcks(error: Error) {
        for (const pending of this.consumptionResolvers.values()) {
            pending.reject(error);
        }
        this.consumptionResolvers.clear();
    }

    private routeAgentConfigurationIfChanged(metadata: Metadata): void {
        const nextSnapshot = agentConfigurationSnapshot(metadata);
        const diff = diffAgentConfiguration(this.lastAppliedAgentConfiguration, nextSnapshot);
        this.lastAppliedAgentConfiguration = nextSnapshot;

        if (!diff) {
            return;
        }

        for (const field of ['permissionMode', 'model', 'thinkingLevel'] as const) {
            if (Object.prototype.hasOwnProperty.call(diff, field)) {
                const value = diff[field];
                if (typeof value === 'string' && value.length > MAX_AGENT_CONFIG_FIELD_LENGTH) {
                    logger.debug(`[apiSession] Dropping oversized agent configuration field ${field} (length ${value.length} > ${MAX_AGENT_CONFIG_FIELD_LENGTH})`);
                    delete diff[field];
                }
            }
        }

        const remainingKeys = Object.keys(diff);
        if (remainingKeys.length === 0) {
            return;
        }

        if (this.listenerCount('agent-configuration') > 0) {
            this.emit('agent-configuration', diff);
        } else {
            this.pendingAgentConfigurations.push(diff);
        }
    }

    private async fetchMessages() {
        if (this.closed) return;
        // On reconnect, skip processing existing messages — just advance lastSeq
        const skipRouting = this.skipInitialMessages;
        if (skipRouting) {
            this.skipInitialMessages = false;
            logger.debug('[API] Reconnect mode: skipping existing messages, advancing lastSeq');
        }

        let afterSeq = this.lastSeq;
        while (true) {
            const params = new URLSearchParams({
                after_seq: String(afterSeq),
                limit: '100',
            });
            const response = await daemonClient.tunnelFetch(
                `/v3/sessions/${encodeURIComponent(this.sessionId)}/messages?${params.toString()}`,
                { headers: this.authHeaders() }
            );
            if (this.closed) return;
            if (!response.ok) {
                throw new Error(`Failed to fetch session messages: ${response.status}`);
            }
            const data = await response.json() as V3GetSessionMessagesResponse;
            if (this.closed) return;

            const messages = Array.isArray(data.messages) ? data.messages : [];
            let maxSeq = afterSeq;

            for (const message of messages) {
                if (message.seq > maxSeq) {
                    maxSeq = message.seq;
                }

                if (skipRouting) continue;
                if (message.localId && this.resolveOutboundDelivery(message.localId, {
                    id: message.id,
                    seq: message.seq,
                })) {
                    continue;
                }

                if (message.content?.t !== 'encrypted') {
                    continue;
                }

                try {
                    // FORK PATCH: RESTORE-R2-done fetch/cold-start path routes through the fork codec seam decodeIncoming({source:'fetch'}) in sessionPayloadCodec.ts, which still calls decrypt() while send + live-receive are plaintext — latent asymmetry preserved verbatim (fetched replay of plaintext messages fails to decode → dropped); a real fix is a wire/at-rest format change, out of M1 (invariant HC-3)
                    const body = decodeIncoming(message.content.c, { source: 'fetch', encryptionKey: this.encryptionKey, encryptionVariant: this.encryptionVariant });
                    this.routeIncomingMessage(body, {
                        id: message.id,
                        seq: message.seq,
                    });
                } catch (error) {
                    logger.debug('[API] Failed to decrypt fetched message', {
                        sessionId: this.sessionId,
                        seq: message.seq,
                        error
                    });
                }
            }

            this.lastSeq = Math.max(this.lastSeq, maxSeq);
            this.evictScannedOutboundDeliveries();
            const hasMore = !!data.hasMore;
            if (hasMore && maxSeq === afterSeq) {
                logger.debug('[API] fetchMessages pagination stalled, stopping to avoid infinite loop', {
                    sessionId: this.sessionId,
                    afterSeq
                });
                break;
            }
            afterSeq = maxSeq;
            if (!hasMore) {
                break;
            }
        }
    }

    private static readonly MAX_OUTBOX_BATCH_SIZE = 50;

    private pushOutboundDelivery(localId: string, seq: number): void {
        const entry = { localId, seq };
        let index = this.outboundDeliveryHeap.push(entry) - 1;
        while (index > 0) {
            const parent = Math.floor((index - 1) / 2);
            if (this.outboundDeliveryHeap[parent].seq <= seq) {
                break;
            }
            this.outboundDeliveryHeap[index] = this.outboundDeliveryHeap[parent];
            index = parent;
        }
        this.outboundDeliveryHeap[index] = entry;
    }

    private popOutboundDelivery(): { localId: string; seq: number } | undefined {
        const first = this.outboundDeliveryHeap[0];
        const last = this.outboundDeliveryHeap.pop();
        if (!first || !last || this.outboundDeliveryHeap.length === 0) {
            return first;
        }
        let index = 0;
        while (true) {
            const left = index * 2 + 1;
            if (left >= this.outboundDeliveryHeap.length) {
                break;
            }
            const right = left + 1;
            const child = right < this.outboundDeliveryHeap.length
                && this.outboundDeliveryHeap[right].seq < this.outboundDeliveryHeap[left].seq
                ? right
                : left;
            if (this.outboundDeliveryHeap[child].seq >= last.seq) {
                break;
            }
            this.outboundDeliveryHeap[index] = this.outboundDeliveryHeap[child];
            index = child;
        }
        this.outboundDeliveryHeap[index] = last;
        return first;
    }

    private evictScannedOutboundDeliveries(): void {
        while (this.outboundDeliveryHeap[0]?.seq <= this.lastSeq) {
            const delivered = this.popOutboundDelivery();
            if (delivered && this.outboundDeliverySeqs.get(delivered.localId) === delivered.seq) {
                this.outboundDeliverySeqs.delete(delivered.localId);
            }
        }
    }

    private resolveOutboundDelivery(localId: string, delivery: MessageDelivery): boolean {
        if (!this.outboundDeliverySeqs.has(localId)) {
            return false;
        }
        const previousSeq = this.outboundDeliverySeqs.get(localId);
        this.outboundDeliverySeqs.set(localId, delivery.seq);
        if (previousSeq !== delivery.seq) {
            this.pushOutboundDelivery(localId, delivery.seq);
        }
        const deferred = this.seqResolvers.get(localId);
        if (deferred) {
            deferred.resolve(delivery);
        }
        if (delivery.seq <= this.lastSeq) {
            this.evictScannedOutboundDeliveries();
        }
        return true;
    }

    private async flushOutbox() {
        while (this.pendingOutboxHead < this.pendingOutbox.length) {
            const batchEnd = Math.min(
                this.pendingOutboxHead + ApiSessionClient.MAX_OUTBOX_BATCH_SIZE,
                this.pendingOutbox.length,
            );
            const batch = this.pendingOutbox.slice(this.pendingOutboxHead, batchEnd);

            const response = await daemonClient.tunnelFetch(
                `/v3/sessions/${encodeURIComponent(this.sessionId)}/messages`,
                {
                    method: 'POST',
                    headers: this.authHeaders(),
                    body: JSON.stringify({
                        messages: batch
                    }),
                }
            );
            if (this.closed) return;
            if (!response.ok) {
                throw new Error(`Failed to flush session outbox: ${response.status}`);
            }
            const data = await response.json() as V3PostSessionMessagesResponse;
            if (this.closed) return;

            const messages = Array.isArray(data.messages) ? data.messages : [];
            const batchLocalIds = new Set(batch.map((entry) => entry.localId));
            const acknowledgedLocalIds = new Set<string>();
            for (const msg of messages) {
                if (msg.localId && batchLocalIds.has(msg.localId)) {
                    acknowledgedLocalIds.add(msg.localId);
                    this.resolveOutboundDelivery(msg.localId, { id: msg.id, seq: msg.seq });
                }
            }

            const unacknowledged = batch.filter((entry) => !acknowledgedLocalIds.has(entry.localId));
            const nextHead = batchEnd - unacknowledged.length;
            for (let index = 0; index < unacknowledged.length; index += 1) {
                this.pendingOutbox[nextHead + index] = unacknowledged[index];
            }
            this.pendingOutboxHead = nextHead;
            for (const localId of acknowledgedLocalIds) {
                this.seqResolvers.delete(localId);
            }
            if (acknowledgedLocalIds.size !== batch.length) {
                throw new Error('Server did not acknowledge every session outbox localId');
            }
            if (this.pendingOutboxHead === this.pendingOutbox.length) {
                this.pendingOutbox = [];
                this.pendingOutboxHead = 0;
            } else if (this.pendingOutboxHead >= 1024 && this.pendingOutboxHead * 2 >= this.pendingOutbox.length) {
                this.pendingOutbox = this.pendingOutbox.slice(this.pendingOutboxHead);
                this.pendingOutboxHead = 0;
            }
        }
    }

    private enqueueMessageWithDelivery(content: unknown, invalidate: boolean = true, localId: string = randomUUID()): Promise<MessageDelivery> {
        if (this.closed) {
            return Promise.reject(new Error('Session is closed'));
        }
        if (localId.length === 0) {
            return Promise.reject(new Error('Session message localId must not be empty'));
        }
        // FORK PATCH: RESTORE-R2-done send path routes through the fork codec seam encodeOutgoing() in sessionPayloadCodec.ts, which serializes plaintext JSON (local `encrypted` is a misnomer); fork performs NO E2E encryption on send — behavior-preserving relocation, bytes unchanged (invariant HC-1)
        const encrypted = encodeOutgoing(content);
        const existing = this.seqResolvers.get(localId);
        if (existing) {
            return existing.promise;
        }
        let resolve!: (delivery: MessageDelivery) => void;
        let reject!: (err: unknown) => void;
        const deliveryPromise = new Promise<MessageDelivery>((res, rej) => {
            resolve = res;
            reject = rej;
        });
        this.outboundDeliverySeqs.set(localId, null);
        this.seqResolvers.set(localId, { promise: deliveryPromise, resolve, reject });
        this.pendingOutbox.push({ content: encrypted, localId });
        if (invalidate) {
            this.sendSync.invalidate();
        }
        deliveryPromise.catch(() => undefined);
        return deliveryPromise;
    }

    private enqueueMessage(content: unknown, invalidate: boolean = true): Promise<number> {
        const seqPromise = this.enqueueMessageWithDelivery(content, invalidate).then((delivery) => delivery.seq);
        seqPromise.catch(() => undefined);
        return seqPromise;
    }

    enqueueMessageWithConsumptionAck(content: unknown, signal?: AbortSignal): { seqPromise: Promise<number>; consumedPromise: Promise<SessionMessageConsumptionEvent> } {
        const deliveryPromise = this.enqueueMessageWithDelivery(content);
        const seqPromise = deliveryPromise.then((delivery) => delivery.seq);
        const consumedPromise = deliveryPromise.then((delivery) => this.waitForConsumptionAck(delivery.id, signal));
        seqPromise.catch(() => undefined);
        consumedPromise.catch(() => undefined);
        return { seqPromise, consumedPromise };
    }

    /**
     * Send message to session
     * @param body - Message body (can be MessageContent or raw content for agent messages)
     */
    sendClaudeSessionMessage(body: RawJSONLines | unknown) {
        const dropEntry = findSenderDropEntry(body);
        if (dropEntry) {
            logger.debug('[SOCKET] Dropped non-renderable claude message', { class: dropEntry.name });
            return;
        }

        const isSyntheticTitleEvent = isRecord(body)
            && (body.type === 'custom-title' || body.type === 'ai-title');
        const normalizedTitleEvent = isSyntheticTitleEvent
            ? normalizeSessionLogMessage(body)
            : null;
        if (isSyntheticTitleEvent && !normalizedTitleEvent) {
            return;
        }
        const normalized = normalizedTitleEvent ?? body as RawJSONLines;

        const mapped = mapClaudeLogMessageToSessionEnvelopes(normalized, this.claudeSessionProtocolState);
        this.claudeSessionProtocolState.currentTurnId = mapped.currentTurnId;
        for (const envelope of mapped.envelopes) {
            this.sendSessionProtocolMessage(envelope);
        }
        for (const boundary of mapped.boundaries) {
            void this.sendContextBoundary(boundary).catch((error: unknown) => {
                logger.debug('[SOCKET] Failed to send context boundary:', error);
            });
        }
        // Track usage from assistant messages
        if (normalized.type === 'assistant' && normalized.message?.usage) {
            try {
                this.sendUsageData(normalized.message.usage, normalized.message.model);
            } catch (error) {
                logger.debug('[SOCKET] Failed to send usage data:', error);
            }
        }

        // Update metadata with summary if this is a summary message
        if (normalized.type === 'summary' && 'summary' in normalized && 'leafUuid' in normalized) {
            const leafUuid = normalized.leafUuid as string | undefined;
            const isTitleEvent = leafUuid?.startsWith('custom-title:') || leafUuid?.startsWith('ai-title:');
            if (isTitleEvent) {
                const currentSummary = this.metadata?.summary?.text;
                if (currentSummary === normalized.summary || this.pendingSummaryText === normalized.summary) {
                    return;
                }
            }

            this.pendingSummaryText = normalized.summary;
            void this.updateMetadata((metadata) => ({
                ...metadata,
                summary: {
                    text: normalized.summary,
                    updatedAt: Date.now()
                }
            })).catch((err: unknown) => {
                logger.debug('[SOCKET] Failed to update summary metadata:', err);
            }).finally(() => {
                if (this.pendingSummaryText === normalized.summary) {
                    this.pendingSummaryText = null;
                }
            });
        }
    }

    closeClaudeSessionTurn(status: SessionTurnEndStatus = 'completed') {
        const mapped = closeClaudeTurnWithStatus(this.claudeSessionProtocolState, status);
        this.claudeSessionProtocolState.currentTurnId = mapped.currentTurnId;
        for (const envelope of mapped.envelopes) {
            this.sendSessionProtocolMessage(envelope);
        }
    }

    sendCodexMessage(body: any) {
        let content = {
            role: 'agent',
            content: {
                type: 'codex',
                data: body  // This wraps the entire Claude message
            },
            meta: {
                sentFrom: 'cli'
            }
        };
        this.enqueueMessage(content);
    }

    private enqueueSessionProtocolEnvelope(envelope: SessionEnvelope, invalidate: boolean = true): Promise<number> {
        const content = {
            role: 'session',
            content: envelope,
            meta: {
                sentFrom: 'cli'
            }
        };

        return this.enqueueMessage(content, invalidate);
    }

    /**
     * Queues a session envelope under a caller-stable id and resolves when that
     * exact outbound row is acknowledged. localId must be non-empty; invalid
     * ids reject without queueing. Reuse localId across retries or process
     * restarts. Delivery acknowledgement does not itself advance the inbound
     * receive watermark; normal receive scanning may advance through the
     * acknowledged row. Closed clients reject new delivery attempts.
     */
    sendSessionProtocolMessageWithDelivery(
        envelope: SessionEnvelope,
        options: { localId: string },
    ): Promise<MessageDelivery> {
        const content = {
            role: 'session',
            content: envelope,
            meta: {
                sentFrom: 'cli'
            }
        };
        return this.enqueueMessageWithDelivery(content, true, options.localId);
    }

    sendSessionProtocolMessage(envelope: SessionEnvelope) {
        if (envelope.role !== 'user') {
            this.enqueueSessionProtocolEnvelope(envelope);
            return;
        }

        if (envelope.ev.t !== 'text') {
            this.enqueueSessionProtocolEnvelope(envelope);
            return;
        }

        this.enqueueSessionProtocolEnvelope(envelope);
    }

    sendMessageConsumption({ messageId, agentFlavor }: MessageConsumptionInput) {
        this.enqueueSessionProtocolEnvelope(createEnvelope('agent', {
            t: 'message-consumption',
            messageId,
            consumedAt: Date.now(),
            agentFlavor,
        }));
    }

    async sendContextBoundary(boundary: ContextBoundaryInput): Promise<void> {
        const envelope = createEnvelope('agent', {
            t: 'context-boundary',
            ...boundary,
        }, { time: boundary.at });

        const seqPromise = this.enqueueSessionProtocolEnvelope(envelope, false);
        this.sendSessionEvent({
            type: 'message',
            message: contextBoundaryFallbackMessage(boundary.kind),
        }, undefined, { contextBoundaryFallback: true });

        const SEQ_TIMEOUT_MS = 5000;
        const timeoutSentinel = Symbol('seq-timeout');
        let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
        const timeoutPromise = new Promise<typeof timeoutSentinel>((resolve) => {
            timeoutHandle = setTimeout(() => resolve(timeoutSentinel), SEQ_TIMEOUT_MS);
            timeoutHandle.unref?.();
        });

        let seq: number;
        try {
            const result = await Promise.race([seqPromise, timeoutPromise]);
            if (result === timeoutSentinel) {
                logger.debug('[sendContextBoundary] seq resolution timed out, skipping metadata write');
                return;
            }
            seq = result;
        } catch (err) {
            logger.debug('[sendContextBoundary] envelope flush failed, skipping metadata write', err);
            return;
        } finally {
            if (timeoutHandle !== undefined) clearTimeout(timeoutHandle);
        }

        try {
            await this.updateMetadata((metadata) => ({
                ...metadata,
                latestBoundary: {
                    id: envelope.id,
                    kind: boundary.kind,
                    seq,
                    at: boundary.at,
                    ...(boundary.forkedFromSid ? { forkedFromSid: boundary.forkedFromSid } : {}),
                }
            }));
        } catch (err) {
            logger.debug('[sendContextBoundary] metadata write failed, continuing', err);
        }
    }

    /**
     * Send a generic agent message to the session using ACP (Agent Communication Protocol) format.
     * Works for any agent type (Gemini, Codex, Claude, etc.) - CLI normalizes to unified ACP format.
     * 
     * @param provider - The agent provider sending the message (e.g., 'gemini', 'codex', 'claude')
     * @param body - The message payload (type: 'message' | 'reasoning' | 'tool-call' | 'tool-result')
     */
    sendAgentMessage(provider: 'gemini' | 'codex' | 'claude' | 'opencode' | 'openclaw', body: ACPMessageData) {
        let content = {
            role: 'agent',
            content: {
                type: 'acp',
                provider,
                data: body
            },
            meta: {
                sentFrom: 'cli'
            }
        };

        logger.debug(`[SOCKET] Sending ACP message from ${provider}:`, { type: body.type, hasMessage: 'message' in body });

        this.enqueueMessage(content);
    }

    sendSessionEvent(event: {
        type: 'switch', mode: 'local' | 'remote'
    } | {
        type: 'message', message: string
    } | {
        type: 'permission-mode-changed', mode: 'default' | 'acceptEdits' | 'bypassPermissions' | 'plan'
    } | {
        type: 'ready'
    }, id?: string, meta?: MessageMeta) {
        let content = {
            role: 'agent',
            content: {
                id: id ?? randomUUID(),
                type: 'event',
                data: event
            },
            ...(meta && { meta })
        };
        this.enqueueMessage(content);
    }

    sendPushEvent(event: {
        kind: 'done' | 'permission' | 'question';
        data?: Record<string, unknown>;
    }) {
        if (!this.socket) return;
        const mappedKind: 'status-change' | 'codex-finish' = event.kind === 'done' ? 'codex-finish' : 'status-change';
        const payload = {
            sid: this.sessionId,
            kind: mappedKind,
            summary: this.metadata?.summary?.text ?? null,
            ...event.data,
        };
        if (mappedKind === 'codex-finish') {
            this.socket.emit('codex-finish', payload);
            return;
        }
        this.socket.emit('push-event', payload);
    }

    sendAgentTreeUpdate(delta: AgentTreeDelta) {
        if (!this.socket) return;
        this.socket.emit('agent-tree-update', { delta });
    }

    /**
     * Send a ping message to keep the connection alive
     */
    keepAlive(thinking: boolean, mode: 'local' | 'remote') {
        if (!this.socket) return;
        if (process.env.DEBUG) { // too verbose for production
            logger.debug(`[API] Sending keep alive message: ${thinking}`);
        }
        this.socket.volatile.emit('session-alive', {
            sid: this.sessionId,
            time: Date.now(),
            thinking,
            mode
        });
    }

    /**
     * Send session death message
     */
    sendSessionDeath() {
        this.rejectPendingConsumptionAcks(new Error('Session ended before message consumption was observed'));
        if (!this.socket) return;
        this.socket.emit('session-end', { sid: this.sessionId, time: Date.now() });
    }

    /**
     * Send usage data to the server
     */
    sendUsageData(usage: Usage, model?: string) {
        void usage;
        void model;
    }

    /**
     * Returns the latest session metadata known to the client.
     */
    getMetadata(): Metadata | null {
        return this.metadata;
    }

    getAgentState(): AgentState | null {
        return this.agentState;
    }

    /**
     * Update session metadata
     * @param handler - Handler function that returns the updated metadata
     */
    suppressNextArchiveSignal() {
        this.ignoreArchiveSignal = true;
    }

    skipExistingMessages() {
        this.skipInitialMessages = true;
    }

    updateMetadata(handler: (metadata: Metadata) => Metadata): Promise<void> {
        return this.metadataLock.inLock(async () => {
            await this.socketReady;
            await backoff(async () => {
                const socket = this.socket;
                if (!socket) { throw new Error('socket not yet constructed'); }
                let updated = handler(this.metadata!); // Weird state if metadata is null - should never happen but here we are
                const answer = await socket.emitWithAck('update-metadata', { sid: this.sessionId, expectedVersion: this.metadataVersion, metadata: JSON.stringify(updated) });
                if (answer.result === 'success') {
                    this.metadata = JSON.parse(answer.metadata);
                    this.metadataVersion = answer.version;
                    this.lastAppliedAgentConfiguration = agentConfigurationSnapshot(this.metadata);
                } else if (answer.result === 'version-mismatch') {
                    if (answer.version > this.metadataVersion) {
                        this.metadataVersion = answer.version;
                        this.metadata = JSON.parse(answer.metadata);
                        this.lastAppliedAgentConfiguration = agentConfigurationSnapshot(this.metadata);
                    }
                    throw new Error('Metadata version mismatch');
                } else if (answer.result === 'error') {
                    // Hard error - ignore
                }
            });
        });
    }

    /**
     * Update session agent state
     * @param handler - Handler function that returns the updated agent state
     */
    updateAgentState(handler: (metadata: AgentState) => AgentState) {
        logger.debugLargeJson('Updating agent state', this.agentState);
        this.agentStateLock.inLock(async () => {
            await this.socketReady;
            await backoff(async () => {
                const socket = this.socket;
                if (!socket) { throw new Error('socket not yet constructed'); }
                let updated = handler(this.agentState || {});
                const answer = await socket.emitWithAck('update-state', { sid: this.sessionId, expectedVersion: this.agentStateVersion, agentState: updated ? JSON.stringify(updated) : null });
                if (answer.result === 'success') {
                    this.agentState = answer.agentState ? JSON.parse(answer.agentState) : null;
                    this.agentStateVersion = answer.version;
                    logger.debug('Agent state updated', this.agentState);
                } else if (answer.result === 'version-mismatch') {
                    if (answer.version > this.agentStateVersion) {
                        this.agentStateVersion = answer.version;
                        this.agentState = answer.agentState ? decrypt(this.encryptionKey, this.encryptionVariant, decodeBase64(answer.agentState)) : null;
                    }
                    throw new Error('Agent state version mismatch');
                } else if (answer.result === 'error') {
                    // console.error('Agent state update error', answer);
                    // Hard error - ignore
                }
            });
        });
    }

    /**
     * Wait for socket buffer to flush
     */
    async flush(): Promise<void> {
        await withClearedDeadline(this.sendSync.invalidateAndAwait(), 10000);
        if (!this.socket || !this.socket.connected) {
            return;
        }
        const socket = this.socket;
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                resolve();
            }, 10000);
            try {
                socket.emit('ping', () => {
                    clearTimeout(timer);
                    resolve();
                });
            } catch (error) {
                clearTimeout(timer);
                reject(error);
            }
        });
    }

    async close() {
        this.closed = true;
        try { this.sendSync.stop(); } catch {}
        try { this.receiveSync.stop(); } catch {}
        for (const deferred of this.seqResolvers.values()) {
            deferred.reject(new Error('Session closed before seq was assigned'));
        }
        this.seqResolvers.clear();
        this.pendingOutbox = [];
        this.pendingOutboxHead = 0;
        this.outboundDeliverySeqs.clear();
        this.outboundDeliveryHeap = [];
        this.rejectPendingConsumptionAcks(new Error('Session closed before message consumption was observed'));
        if (this.reconnectInterval) {
            clearInterval(this.reconnectInterval);
            this.reconnectInterval = null;
        }
        if (this.reconnectTimeout) {
            clearTimeout(this.reconnectTimeout);
            this.reconnectTimeout = null;
        }
        const socket = this.socket;
        this.socket = null;
        try { this.rpcHandlerManager.onSocketDisconnect(); } catch {}
        try { socket?.removeAllListeners(); } catch {}
        try { socket?.close(); } catch {}
        try { this.removeAllListeners(); } catch {}
        safeDebug('[API] socket.close() called');
    }

    private startSmartReconnect() {
        if (this.closed || this.reconnectInterval) return;

        this.reconnectInterval = setInterval(() => {
            if (this.closed) {
                clearInterval(this.reconnectInterval!);
                this.reconnectInterval = null;
                return;
            }
            if (this.socket?.connected) {
                clearInterval(this.reconnectInterval!);
                this.reconnectInterval = null;
                return;
            }
            if (!shouldReconnect()) {
                safeDebug('[API] Still not ready to reconnect');
                return;
            }
            safeDebug('[API] Attempting reconnect');
            void this.connectWithFreshTunnelAuth().catch((error) => {
                safeDebug('[API] Failed to refresh tunnel auth before reconnect:', error);
            });
        }, 3000);

        if (shouldReconnect()) {
            safeDebug('[API] Network up + lid open — reconnecting in 1s');
            this.reconnectTimeout = setTimeout(() => {
                this.reconnectTimeout = null;
                if (!this.closed && !this.socket?.connected) {
                    void this.connectWithFreshTunnelAuth().catch((error) => {
                        safeDebug('[API] Failed to refresh tunnel auth before reconnect:', error);
                    });
                }
            }, 1000);
        }
    }
}
