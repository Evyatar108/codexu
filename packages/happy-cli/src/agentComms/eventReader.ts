/**
 * Daemon-side AppServerEvent reader + member identity registration (US-003).
 *
 * The daemon drives each native codex member by INJECTING mail into its
 * conversation (US-002, {@link injectIntoMember}). To choose start-vs-steer and
 * to observe what a member did with injected mail, the daemon must know each
 * member's live turn/item state. That state comes from the member's
 * **AppServerEvent stream** — NOT from stdout scraping (stdout is ANSI-redraw,
 * title-suppressed, and has no turn boundary; see the plan's Technical
 * Constraints and the northstar `selected-direction.md`).
 *
 * Two facts shape this module:
 *
 *  1. **AppServerEvent carries NO identity field.** A raw `turn/started` or
 *     `item/completed` notification says nothing about WHICH member emitted it.
 *     So the daemon needs an explicit **registration** step that binds a
 *     member's `happySessionId` (the logical handle used everywhere in
 *     agent-comms) to its loopback app-server endpoint + OS pid. That binding
 *     is {@link MemberRegistry}. The `happySessionId` also lives on the codex
 *     discovery record (`codexAppServerDiscovery.ts`), which is how
 *     `resolveMemberEndpoint` (US-002) finds a member — registration is the
 *     in-daemon, in-memory mirror the event reader attributes events against.
 *
 *  2. **Turn/crash/kind-tag are DERIVED from the event stream, not stdout.**
 *     - Turn boundary: `turn/started` → RUNNING (with the active turn id),
 *       `turn/completed` / `turn_aborted` → IDLE. This directly produces the
 *       {@link MemberTurnState} that {@link injectIntoMember} consumes, closing
 *       the observe→inject loop.
 *     - Kind-tag: the crews report protocol emits a final-line
 *       `<|report kind="done" summary="..."|>` tag inside the member's
 *       assistant message; it surfaces as an `item/completed` `agentMessage`.
 *       {@link parseKindTag} extracts the kind.
 *     - Crash: AppServerEvent cannot report that the member PROCESS died, so
 *       crash detection is an OS process-liveness check ({@link memberLiveness})
 *       against the registered pid — the same `isPidAlive` the discovery layer
 *       uses.
 *
 * The pure reducer ({@link reduceMemberEvent}) and the registry hold no I/O, so
 * both are exhaustively unit-testable without a live app-server. The optional
 * {@link attachMemberEventStream} glue opens a real loopback ws (reusing the
 * US-002 transport) and pumps notifications into a tracker; it consumes an
 * already-subscribed notification stream and does NOT own the app-server
 * initialize/subscribe handshake (that belongs to `CodexAppServerClient`).
 */

import { createWsTransport } from '@/codex/transport/wsTransport';
import type { JsonRpcConnection, JsonRpcMessage } from '@/codex/transport/JsonRpcConnection';
import { isPidAlive } from '@/codex/codexAppServerDiscovery';
import type { InjectEndpoint, MemberTurnState } from './injectClient';
import { DEFAULT_HANDSHAKE_TIMEOUT_MS } from './injectClient';

/** A JSON-RPC notification from a member's app-server (method set, no response id semantics). */
export interface AppServerNotification {
    method: string;
    params?: unknown;
}

/** Whether the member is mid-turn (RUNNING) or between turns (IDLE). */
export type MemberTurnPhase = 'idle' | 'running';

/**
 * The daemon's observed view of a single member, derived purely from its
 * AppServerEvent stream. `threadId` + `activeTurnId` are exactly the fields
 * {@link MemberTurnState} needs, so {@link ObservedMemberState.turnState}
 * feeds straight into {@link injectIntoMember}.
 */
export interface ObservedMemberState {
    /** Active thread id, or null before any `thread/started`. */
    threadId: string | null;
    /** Active turn id while RUNNING; null when IDLE. */
    activeTurnId: string | null;
    /** Derived turn phase. */
    phase: MemberTurnPhase;
    /** Most recent report kind-tag parsed from an assistant message, or null. */
    lastKindTag: string | null;
    /** Text of the most recent assistant (`agentMessage`) item, or null. */
    lastMessageText: string | null;
    /** Wall-clock ms of the most recently applied event, or null. */
    lastEventAt: number | null;
}

/** Fresh IDLE state with no thread yet. */
export function initialMemberState(): ObservedMemberState {
    return {
        threadId: null,
        activeTurnId: null,
        phase: 'idle',
        lastKindTag: null,
        lastMessageText: null,
        lastEventAt: null,
    };
}

const KIND_TAG_REGEX = /<\|report\s+kind=(?:"([^"]+)"|'([^']+)')/;

/**
 * Extract the crews report kind (`done` / `question` / `blocked` / `progress` /
 * …) from an assistant message body, or null when no report tag is present.
 * Matches the `<|report kind="..."|>` protocol tag (double- or single-quoted).
 */
export function parseKindTag(text: unknown): string | null {
    if (typeof text !== 'string' || text.length === 0) return null;
    const match = KIND_TAG_REGEX.exec(text);
    if (!match) return null;
    const kind = match[1] ?? match[2];
    return kind && kind.length > 0 ? kind : null;
}

function firstString(...vals: unknown[]): string | null {
    for (const v of vals) {
        if (typeof v === 'string' && v.length > 0) return v;
    }
    return null;
}

/** Turn id from `turn/started` / `turn/completed` params (all observed shapes). */
function extractTurnId(params: any): string | null {
    return firstString(params?.turn?.id, params?.turnId, params?.turn_id);
}

/** Thread id from a lifecycle notification's params/item. */
function extractThreadId(params: any): string | null {
    return firstString(params?.thread?.id, params?.threadId, params?.thread_id, params?.item?.threadId);
}

/**
 * Pure reducer: apply one AppServerEvent notification to the observed state and
 * return the next state. Unknown/irrelevant methods return the input state
 * unchanged (referentially, so callers can cheaply detect no-ops). `now` is
 * injectable for deterministic tests.
 *
 * Recognized methods (both v2 and legacy, mirroring `codexAppServerClient`):
 *  - `thread/started`                 → set threadId
 *  - `turn/started`                   → RUNNING + activeTurnId
 *  - `turn/completed`                 → IDLE (clear activeTurnId)
 *  - `item/completed` (agentMessage)  → capture text + parse kind-tag
 *  - legacy `codex/event` msg.type    → task_started / task_complete / turn_aborted
 */
export function reduceMemberEvent(
    state: ObservedMemberState,
    notification: AppServerNotification,
    now: () => number = Date.now,
): ObservedMemberState {
    const { method } = notification;
    const params = notification.params as any;

    // Legacy `codex/event` envelope carries the real type inside params.msg.
    if (method === 'codex/event' || method.startsWith('codex/event/')) {
        const msg = params?.msg;
        if (!msg || typeof msg.type !== 'string') return state;
        if (msg.type === 'task_started') {
            const turnId = firstString(msg.turn_id, msg.turnId);
            return { ...state, phase: 'running', activeTurnId: turnId, lastEventAt: now() };
        }
        if (msg.type === 'task_complete' || msg.type === 'turn_aborted') {
            return { ...state, phase: 'idle', activeTurnId: null, lastEventAt: now() };
        }
        if (msg.type === 'agent_message' || msg.type === 'agent_message_delta') {
            const text = firstString(msg.message, msg.text);
            if (text === null) return state;
            const kind = parseKindTag(text);
            return {
                ...state,
                lastMessageText: text,
                lastKindTag: kind ?? state.lastKindTag,
                lastEventAt: now(),
            };
        }
        return state;
    }

    if (method === 'thread/started') {
        const threadId = extractThreadId(params);
        if (threadId === null) return state;
        return { ...state, threadId, lastEventAt: now() };
    }

    if (method === 'turn/started') {
        const turnId = extractTurnId(params);
        const threadId = extractThreadId(params) ?? state.threadId;
        return { ...state, phase: 'running', activeTurnId: turnId, threadId, lastEventAt: now() };
    }

    if (method === 'turn/completed' || method === 'turn/aborted') {
        return { ...state, phase: 'idle', activeTurnId: null, lastEventAt: now() };
    }

    if (method === 'item/completed') {
        const item = params?.item;
        if (item?.type === 'agentMessage') {
            const text = typeof item.text === 'string' ? item.text : null;
            if (text === null) return state;
            const kind = parseKindTag(text);
            return {
                ...state,
                lastMessageText: text,
                lastKindTag: kind ?? state.lastKindTag,
                threadId: extractThreadId(params) ?? state.threadId,
                lastEventAt: now(),
            };
        }
        return state;
    }

    return state;
}

/**
 * Stateful wrapper around {@link reduceMemberEvent} for a single member. Feed it
 * notifications; read {@link MemberEventTracker.turnState} to drive injection.
 */
export class MemberEventTracker {
    private current: ObservedMemberState;

    constructor(private readonly now: () => number = Date.now) {
        this.current = initialMemberState();
    }

    /** Apply one notification; returns the updated snapshot. */
    apply(notification: AppServerNotification): ObservedMemberState {
        this.current = reduceMemberEvent(this.current, notification, this.now);
        return this.current;
    }

    /** Current full observed snapshot. */
    get state(): ObservedMemberState {
        return this.current;
    }

    /** The subset {@link injectIntoMember} needs to choose start-vs-steer. */
    get turnState(): MemberTurnState {
        return { threadId: this.current.threadId, activeTurnId: this.current.activeTurnId };
    }
}

/** OS-level liveness of a member process. `crashed` = the pid is gone. */
export type MemberLiveness = 'alive' | 'crashed';

/**
 * Crash detection for a member: AppServerEvent cannot report process death, so
 * we probe the registered pid directly. `probe` is injectable for tests.
 */
export function memberLiveness(pid: number, probe: (pid: number) => boolean = isPidAlive): MemberLiveness {
    return probe(pid) ? 'alive' : 'crashed';
}

/** A registered member: its identity handle, loopback endpoint, and OS pid. */
export interface MemberRegistration {
    /** Logical member identity (agent-comms handle); the event-attribution key. */
    happySessionId: string;
    /** Loopback codex app-server endpoint (for US-002 injection). */
    endpoint: InjectEndpoint;
    /** OS pid of the member process (for crash detection). */
    pid: number;
}

interface RegistryEntry extends MemberRegistration {
    tracker: MemberEventTracker;
}

/**
 * In-daemon registry binding `happySessionId` → { endpoint, pid, tracker }.
 *
 * This is the "member identity registration" AC of US-003: because
 * AppServerEvent has no identity field, the daemon attributes an event stream
 * to a member only via this explicit registration (performed when the daemon
 * observes / spawns a member). Injection (US-002) and crash detection both key
 * off the same `happySessionId`.
 */
export class MemberRegistry {
    private readonly members = new Map<string, RegistryEntry>();

    constructor(private readonly now: () => number = Date.now) {}

    /**
     * Register (or re-register) a member. Re-registration with the same
     * happySessionId replaces the endpoint/pid but PRESERVES the existing
     * tracker so observed turn state survives a discovery-record refresh.
     */
    register(reg: MemberRegistration): void {
        const existing = this.members.get(reg.happySessionId);
        this.members.set(reg.happySessionId, {
            ...reg,
            tracker: existing?.tracker ?? new MemberEventTracker(this.now),
        });
    }

    /** Remove a member from the registry (e.g. after confirmed crash/exit). */
    unregister(happySessionId: string): boolean {
        return this.members.delete(happySessionId);
    }

    /** Whether a member is currently registered. */
    has(happySessionId: string): boolean {
        return this.members.has(happySessionId);
    }

    /** The member's registration, or undefined. */
    get(happySessionId: string): MemberRegistration | undefined {
        const entry = this.members.get(happySessionId);
        if (!entry) return undefined;
        const { tracker: _tracker, ...reg } = entry;
        return reg;
    }

    /** The member's event tracker, or undefined when not registered. */
    tracker(happySessionId: string): MemberEventTracker | undefined {
        return this.members.get(happySessionId)?.tracker;
    }

    /** All registered member identities. */
    list(): string[] {
        return [...this.members.keys()];
    }

    /**
     * Apply a notification to a registered member's tracker. Returns the updated
     * observed state, or undefined when the member is not registered (an
     * unattributable event — dropped rather than mis-credited).
     */
    applyEvent(happySessionId: string, notification: AppServerNotification): ObservedMemberState | undefined {
        return this.members.get(happySessionId)?.tracker.apply(notification);
    }

    /** Liveness of a registered member, or undefined when not registered. */
    liveness(happySessionId: string, probe: (pid: number) => boolean = isPidAlive): MemberLiveness | undefined {
        const entry = this.members.get(happySessionId);
        return entry ? memberLiveness(entry.pid, probe) : undefined;
    }

    /** Registered members whose process is no longer alive (crashed). */
    crashedMembers(probe: (pid: number) => boolean = isPidAlive): string[] {
        return [...this.members.values()]
            .filter((entry) => memberLiveness(entry.pid, probe) === 'crashed')
            .map((entry) => entry.happySessionId);
    }
}

/** Connection factory override (tests). Mirrors {@link injectClient}'s pattern. */
export type EventStreamConnectionFactory = (endpoint: InjectEndpoint) => JsonRpcConnection;

export interface AttachEventStreamOptions {
    /** Connection factory override for tests. Defaults to a real loopback ws transport. */
    connect?: EventStreamConnectionFactory;
    /** Optional per-notification hook (e.g. to advance a mailbox cursor on observation). */
    onState?: (state: ObservedMemberState, notification: AppServerNotification) => void;
    /** Optional transport-error hook. */
    onError?: (error: Error) => void;
}

/** Handle to a live event stream; call {@link EventStreamHandle.close} to stop. */
export interface EventStreamHandle {
    close: () => Promise<void>;
}

function isNotification(message: JsonRpcMessage): message is JsonRpcMessage & { method: string } {
    return typeof message.method === 'string' && message.method.length > 0;
}

function defaultConnect(endpoint: InjectEndpoint): JsonRpcConnection {
    return createWsTransport({
        url: endpoint.url,
        authToken: endpoint.authToken,
        handshakeTimeoutMs: endpoint.handshakeTimeoutMs ?? DEFAULT_HANDSHAKE_TIMEOUT_MS,
    });
}

/**
 * Open a loopback ws to `endpoint` and pump every JSON-RPC NOTIFICATION into
 * `tracker`, invoking `onState` after each applied event. Returns a handle
 * whose `close()` tears the connection down.
 *
 * Scope note: this consumes an already-flowing notification stream. It does NOT
 * perform the app-server `initialize` + thread `subscribe` handshake — that is
 * `CodexAppServerClient`'s responsibility and is wired at the daemon's member-
 * attach site. Keeping the handshake out of here makes the reader a thin,
 * testable adapter over the transport.
 */
export async function attachMemberEventStream(
    endpoint: InjectEndpoint,
    tracker: MemberEventTracker,
    opts: AttachEventStreamOptions = {},
): Promise<EventStreamHandle> {
    const connect = opts.connect ?? defaultConnect;
    const connection = connect(endpoint);
    connection.onMessage((message: JsonRpcMessage) => {
        if (!isNotification(message)) return;
        const notification: AppServerNotification = { method: message.method, params: message.params };
        const state = tracker.apply(notification);
        opts.onState?.(state, notification);
    });
    if (opts.onError) {
        connection.onError(opts.onError);
    }
    await connection.open();
    return {
        close: () => connection.close().catch(() => undefined),
    };
}
