/**
 * Stateless daemon→member inject client (US-002).
 *
 * Given a member's loopback codex app-server endpoint plus the member's
 * currently-observed thread/turn state, this module drives the EXISTING codex
 * app-server v2 command surface to push mail INTO the member's conversation.
 * This is the M1 operator-locked decision (2026-06-30): reuse the app-server
 * command surface over the daemon's existing loopback websocket, with ZERO
 * further codex patch. The three control paths are:
 *
 *   - RUNNING (an active turn exists)  -> `turn/steer`  (steer the live turn)
 *   - IDLE    (no active turn)         -> `turn/start`  (idle-wake: fresh turn)
 *   - record-only                      -> `thread/inject_items` (append items,
 *                                          model-visible, but does NOT make the
 *                                          agent act — no turn is created)
 *
 * The Start-vs-Steer selection mirrors codex's own `inbound.rs::plan_turn`
 * (codex-rs-overlay/codex-happy/src/inbound.rs): when an active turn id is
 * known, steer it with `expectedTurnId`; otherwise start a new turn. The caller
 * (the daemon's event reader, US-003) is the source of truth for the observed
 * thread id + active turn id — this module holds NO state of its own.
 *
 * Statelessness + reconnect: each call opens a fresh ws connection, issues
 * exactly one request, and closes it in a `finally`, mirroring the
 * `codexDaemonDoctor.ts::requestInitialize` pattern. Transport-level failures
 * (a member app-server that is momentarily unreachable) are retried with
 * bounded linear backoff; a JSON-RPC error reply is NOT retried (it is a
 * definitive answer from the server). The connection factory is injectable so
 * unit tests can drive the state machine without a real websocket.
 */

import { createWsTransport } from '@/codex/transport/wsTransport';
import type { JsonRpcConnection, JsonRpcMessage } from '@/codex/transport/JsonRpcConnection';
import {
    enumerateDiscoveryRecords,
    isPidAlive,
    type CodexDiscoveryRecord,
} from '@/codex/codexAppServerDiscovery';

/** Loopback codex app-server endpoint for a single member. */
export interface InjectEndpoint {
    /** Loopback ws URL of the member's codex app-server, e.g. `ws://127.0.0.1:<port>`. */
    url: string;
    /** Per-spawn capability token for the `Authorization: Bearer` ws-upgrade header. */
    authToken?: string;
    /** ws handshake timeout in ms. Defaults to {@link DEFAULT_HANDSHAKE_TIMEOUT_MS}. */
    handshakeTimeoutMs?: number;
}

/**
 * The member's observed thread/turn state, supplied by the daemon's event
 * reader (US-003). This module never derives it — it only reacts to it.
 */
export interface MemberTurnState {
    /** The member's active codex thread id, or `null` when no thread exists yet. */
    threadId: string | null;
    /**
     * The active turn id when a turn is RUNNING, else `null`/`undefined` (IDLE).
     * When present, an inject `wake` steers this turn instead of starting a new
     * one, matching `plan_turn`'s Start-vs-Steer selection.
     */
    activeTurnId?: string | null;
}

/**
 * What to inject.
 *  - `wake`   drives `turn/start` (idle) or `turn/steer` (running); the agent
 *             ACTS on it as a turn.
 *  - `record` drives `thread/inject_items`; the items become model-visible but
 *             do NOT start a turn (record-only).
 */
export type InjectPayload =
    | { kind: 'wake'; text: string }
    | { kind: 'record'; items: unknown[] };

/** Which app-server command a given inject resolved to. */
export type InjectAction = 'started' | 'steered' | 'recorded';

export interface InjectResult {
    /** The command that ran: `turn/start`→`started`, `turn/steer`→`steered`, `thread/inject_items`→`recorded`. */
    action: InjectAction;
    /**
     * Turn id from the server response, when the action created/steered a turn
     * (`turn/start` returns `{ turn: { id } }`; `turn/steer` returns
     * `{ turnId }`). Absent for `recorded`.
     */
    turnId?: string;
}

/** Thrown before any connection is opened when the member has no active thread. */
export class InjectNoActiveThreadError extends Error {
    readonly code = 'inject_no_active_thread' as const;
    constructor() {
        super('inject: member has no active codex thread; cannot start/steer/record');
        this.name = 'InjectNoActiveThreadError';
    }
}

/** Thrown when the app-server replies with a JSON-RPC error (a definitive, non-retryable answer). */
export class InjectRequestError extends Error {
    readonly code = 'inject_request_failed' as const;
    constructor(
        public readonly method: string,
        public readonly rpcError: { code: number; message: string },
    ) {
        super(`inject: ${method} failed: ${rpcError.message} (rpc code ${rpcError.code})`);
        this.name = 'InjectRequestError';
    }
}

/** Factory that builds a fresh (unopened) JSON-RPC connection for an endpoint. Injectable for tests. */
export type InjectConnectionFactory = (endpoint: InjectEndpoint) => JsonRpcConnection;

export interface InjectOptions {
    /** Per-request response timeout in ms. Defaults to {@link DEFAULT_REQUEST_TIMEOUT_MS}. */
    requestTimeoutMs?: number;
    /** Connection factory override for tests. Defaults to a real loopback ws transport. */
    connect?: InjectConnectionFactory;
    /** Max connect attempts on transport-level failure (>=1). Defaults to {@link DEFAULT_ATTEMPTS}. */
    attempts?: number;
    /** Base backoff between transport retries in ms. Defaults to {@link RECONNECT_BACKOFF_MS}. */
    backoffMs?: number;
}

export const DEFAULT_HANDSHAKE_TIMEOUT_MS = 5_000;
export const DEFAULT_REQUEST_TIMEOUT_MS = 10_000;
export const DEFAULT_ATTEMPTS = 3;
export const RECONNECT_BACKOFF_MS = 150;

const REQUEST_ID = 1;

interface InjectPlan {
    method: 'turn/start' | 'turn/steer' | 'thread/inject_items';
    params: Record<string, unknown>;
    action: InjectAction;
}

/**
 * Pure Start-vs-Steer-vs-Record selection, mirroring `inbound.rs::plan_turn`.
 * Throws {@link InjectNoActiveThreadError} when there is no thread to target
 * (so the caller fails fast, before any socket is opened).
 */
export function planInjectAction(payload: InjectPayload, state: MemberTurnState): InjectPlan {
    if (!state.threadId) {
        throw new InjectNoActiveThreadError();
    }
    const threadId = state.threadId;

    if (payload.kind === 'record') {
        // Raw Responses-API items, recorded without starting a turn.
        return {
            method: 'thread/inject_items',
            params: { threadId, items: payload.items },
            action: 'recorded',
        };
    }

    // A `wake`: turn/start when IDLE, turn/steer when a turn is RUNNING.
    const input = [{ type: 'text', text: payload.text }];
    if (state.activeTurnId) {
        return {
            method: 'turn/steer',
            params: { threadId, input, expectedTurnId: state.activeTurnId },
            action: 'steered',
        };
    }
    return {
        method: 'turn/start',
        params: { threadId, input },
        action: 'started',
    };
}

function extractTurnId(method: InjectPlan['method'], result: unknown): string | undefined {
    if (method === 'turn/start') {
        const turn = (result as { turn?: { id?: unknown } } | undefined)?.turn;
        return typeof turn?.id === 'string' && turn.id.length > 0 ? turn.id : undefined;
    }
    if (method === 'turn/steer') {
        const turnId = (result as { turnId?: unknown } | undefined)?.turnId;
        return typeof turnId === 'string' && turnId.length > 0 ? turnId : undefined;
    }
    return undefined;
}

function defaultConnect(endpoint: InjectEndpoint): JsonRpcConnection {
    return createWsTransport({
        url: endpoint.url,
        authToken: endpoint.authToken,
        handshakeTimeoutMs: endpoint.handshakeTimeoutMs ?? DEFAULT_HANDSHAKE_TIMEOUT_MS,
    });
}

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Open the connection, issue exactly one request, and resolve with its result
 * (or reject on a JSON-RPC error / timeout / transport failure). Mirrors
 * `requestInitialize`: single-shot request/response keyed by a fixed id.
 */
async function sendSingleRequest(
    connection: JsonRpcConnection,
    method: string,
    params: Record<string, unknown>,
    timeoutMs: number,
): Promise<unknown> {
    await connection.open();
    return await new Promise<unknown>((resolve, reject) => {
        const timer = setTimeout(
            () => reject(new Error(`inject: ${method} timed out after ${timeoutMs}ms`)),
            timeoutMs,
        );
        connection.onMessage((message: JsonRpcMessage) => {
            if (message.id !== REQUEST_ID) return;
            clearTimeout(timer);
            if (message.error) {
                reject(new InjectRequestError(method, message.error));
                return;
            }
            resolve(message.result);
        });
        connection.onError((error) => {
            clearTimeout(timer);
            reject(error instanceof Error ? error : new Error(String(error)));
        });
        connection.onClose(() => {
            clearTimeout(timer);
            reject(new Error(`inject: connection closed before ${method} responded`));
        });
        void connection.send({ jsonrpc: '2.0', id: REQUEST_ID, method, params }).catch((error) => {
            clearTimeout(timer);
            reject(error instanceof Error ? error : new Error(String(error)));
        });
    });
}

/**
 * Inject `payload` into the member reachable at `endpoint`, choosing
 * start/steer/record from the observed `state`. Stateless: opens a fresh
 * connection per call and closes it in `finally`. Transport failures are
 * retried up to `attempts`; a JSON-RPC error reply (`InjectRequestError`) is
 * returned to the caller immediately without retry.
 */
export async function injectIntoMember(
    endpoint: InjectEndpoint,
    state: MemberTurnState,
    payload: InjectPayload,
    opts: InjectOptions = {},
): Promise<InjectResult> {
    // Plan first so a no-active-thread caller fails fast, before opening a socket.
    const plan = planInjectAction(payload, state);
    const connect = opts.connect ?? defaultConnect;
    const requestTimeoutMs = opts.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
    const attempts = Math.max(1, opts.attempts ?? DEFAULT_ATTEMPTS);
    const backoffMs = opts.backoffMs ?? RECONNECT_BACKOFF_MS;

    let lastError: unknown;
    for (let attempt = 0; attempt < attempts; attempt++) {
        const connection = connect(endpoint);
        try {
            const result = await sendSingleRequest(connection, plan.method, plan.params, requestTimeoutMs);
            const turnId = extractTurnId(plan.method, result);
            return turnId !== undefined ? { action: plan.action, turnId } : { action: plan.action };
        } catch (error) {
            // A definitive server-side JSON-RPC error is not a connectivity
            // problem — surface it immediately rather than burning retries.
            if (error instanceof InjectRequestError) {
                throw error;
            }
            lastError = error;
        } finally {
            await connection.close().catch(() => undefined);
        }
        if (attempt < attempts - 1) {
            await sleep(backoffMs * (attempt + 1));
        }
    }
    throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

/**
 * Resolve a member's loopback inject endpoint from the discovery records,
 * keyed by the member's `happySessionId` (the identity link — AppServerEvent
 * itself carries no identity field, so US-003 registration writes this id into
 * the discovery record). Only a record with a live pid and a ws transport is
 * returned; a stale/dead record yields `null`.
 */
export async function resolveMemberEndpoint(
    happySessionId: string,
    homeDir?: string,
): Promise<InjectEndpoint | null> {
    const rows = await enumerateDiscoveryRecords(homeDir);
    for (const { record } of rows) {
        if (isLiveMemberRecord(record, happySessionId)) {
            return {
                url: `ws://127.0.0.1:${record.port}`,
                authToken: record.capabilityToken,
            };
        }
    }
    return null;
}

function isLiveMemberRecord(
    record: CodexDiscoveryRecord | null,
    happySessionId: string,
): record is CodexDiscoveryRecord {
    return (
        record !== null &&
        record.happySessionId === happySessionId &&
        record.transport === 'ws' &&
        isPidAlive(record.pid)
    );
}
