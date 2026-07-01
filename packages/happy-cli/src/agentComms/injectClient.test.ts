/**
 * Unit tests for the stateless daemon→member inject client (US-002).
 *
 * These drive the Start-vs-Steer-vs-Record state machine with a fake
 * JsonRpcConnection (no real websocket) and exercise `resolveMemberEndpoint`
 * against real discovery-record files in a temp home dir.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { JsonRpcConnection, JsonRpcMessage } from '@/codex/transport/JsonRpcConnection';
import {
    injectIntoMember,
    planInjectAction,
    resolveMemberEndpoint,
    InjectNoActiveThreadError,
    InjectRequestError,
    type InjectEndpoint,
    type InjectConnectionFactory,
} from './injectClient';
import type { CodexDiscoveryRecord } from '@/codex/codexAppServerDiscovery';

type Responder = (msg: JsonRpcMessage) => JsonRpcMessage | Error | 'close' | undefined;

/** A fake JSON-RPC connection that records sends and replies via a responder. */
class FakeConnection implements JsonRpcConnection {
    readonly sent: JsonRpcMessage[] = [];
    opened = false;
    closed = false;
    private messageHandler: ((msg: JsonRpcMessage) => void) | null = null;
    private errorHandler: ((error: Error) => void) | null = null;
    private closeHandler: ((code: number | null, signal: NodeJS.Signals | null) => void) | null = null;

    constructor(private readonly responder: Responder) {}

    async open(): Promise<void> {
        this.opened = true;
    }

    async send(msg: JsonRpcMessage): Promise<void> {
        this.sent.push(msg);
        const reply = this.responder(msg);
        queueMicrotask(() => {
            if (reply === undefined) return;
            if (reply === 'close') {
                this.closeHandler?.(null, null);
            } else if (reply instanceof Error) {
                this.errorHandler?.(reply);
            } else {
                this.messageHandler?.(reply);
            }
        });
    }

    onMessage(handler: (msg: JsonRpcMessage) => void): void {
        this.messageHandler = handler;
    }

    onError(handler: (error: Error) => void): void {
        this.errorHandler = handler;
    }

    onClose(handler: (code: number | null, signal: NodeJS.Signals | null) => void): void {
        this.closeHandler = handler;
    }

    async close(): Promise<void> {
        this.closed = true;
    }
}

const ENDPOINT: InjectEndpoint = { url: 'ws://127.0.0.1:1234', authToken: 'tok' };

function replyResult(id: number | undefined, result: unknown): JsonRpcMessage {
    return { jsonrpc: '2.0', id, result };
}

describe('planInjectAction', () => {
    it('selects turn/start when IDLE (no active turn)', () => {
        const plan = planInjectAction({ kind: 'wake', text: 'hi' }, { threadId: 'th1' });
        expect(plan.action).toBe('started');
        expect(plan.method).toBe('turn/start');
        expect(plan.params).toEqual({ threadId: 'th1', input: [{ type: 'text', text: 'hi' }] });
    });

    it('selects turn/steer with expectedTurnId when RUNNING', () => {
        const plan = planInjectAction({ kind: 'wake', text: 'go' }, { threadId: 'th1', activeTurnId: 'tn9' });
        expect(plan.action).toBe('steered');
        expect(plan.method).toBe('turn/steer');
        expect(plan.params).toEqual({
            threadId: 'th1',
            input: [{ type: 'text', text: 'go' }],
            expectedTurnId: 'tn9',
        });
    });

    it('selects thread/inject_items for record payloads', () => {
        const items = [{ type: 'message', role: 'user', content: [] }];
        const plan = planInjectAction({ kind: 'record', items }, { threadId: 'th1', activeTurnId: 'tn9' });
        expect(plan.action).toBe('recorded');
        expect(plan.method).toBe('thread/inject_items');
        expect(plan.params).toEqual({ threadId: 'th1', items });
    });

    it('throws InjectNoActiveThreadError when there is no thread', () => {
        expect(() => planInjectAction({ kind: 'wake', text: 'x' }, { threadId: null }))
            .toThrow(InjectNoActiveThreadError);
    });
});

describe('injectIntoMember', () => {
    it('starts a turn when the member is IDLE and returns the new turn id', async () => {
        let captured: FakeConnection | undefined;
        const connect: InjectConnectionFactory = () => {
            captured = new FakeConnection((msg) => replyResult(msg.id, { turn: { id: 'turn-abc' } }));
            return captured;
        };
        const result = await injectIntoMember(ENDPOINT, { threadId: 'th1' }, { kind: 'wake', text: 'hello' }, { connect });
        expect(result).toEqual({ action: 'started', turnId: 'turn-abc' });
        expect(captured?.sent[0]).toMatchObject({
            method: 'turn/start',
            params: { threadId: 'th1', input: [{ type: 'text', text: 'hello' }] },
        });
        expect(captured?.opened).toBe(true);
        expect(captured?.closed).toBe(true);
    });

    it('steers the live turn when RUNNING and returns the steered turn id', async () => {
        let captured: FakeConnection | undefined;
        const connect: InjectConnectionFactory = () => {
            captured = new FakeConnection((msg) => replyResult(msg.id, { turnId: 'turn-xyz' }));
            return captured;
        };
        const result = await injectIntoMember(
            ENDPOINT,
            { threadId: 'th1', activeTurnId: 'turn-xyz' },
            { kind: 'wake', text: 'steer me' },
            { connect },
        );
        expect(result).toEqual({ action: 'steered', turnId: 'turn-xyz' });
        expect(captured?.sent[0]).toMatchObject({
            method: 'turn/steer',
            params: { threadId: 'th1', input: [{ type: 'text', text: 'steer me' }], expectedTurnId: 'turn-xyz' },
        });
    });

    it('records items without starting a turn (no turnId in result)', async () => {
        let captured: FakeConnection | undefined;
        const items = [{ type: 'message', role: 'user', content: [{ type: 'input_text', text: 'noted' }] }];
        const connect: InjectConnectionFactory = () => {
            captured = new FakeConnection((msg) => replyResult(msg.id, {}));
            return captured;
        };
        const result = await injectIntoMember(ENDPOINT, { threadId: 'th1' }, { kind: 'record', items }, { connect });
        expect(result).toEqual({ action: 'recorded' });
        expect(captured?.sent[0]).toMatchObject({ method: 'thread/inject_items', params: { threadId: 'th1', items } });
    });

    it('throws InjectNoActiveThreadError before opening a connection', async () => {
        const connect = vi.fn<InjectConnectionFactory>();
        await expect(injectIntoMember(ENDPOINT, { threadId: null }, { kind: 'wake', text: 'x' }, { connect }))
            .rejects.toBeInstanceOf(InjectNoActiveThreadError);
        expect(connect).not.toHaveBeenCalled();
    });

    it('surfaces a JSON-RPC error reply as InjectRequestError without retrying', async () => {
        const connect = vi.fn<InjectConnectionFactory>(() =>
            new FakeConnection((msg) => ({ jsonrpc: '2.0', id: msg.id, error: { code: -32000, message: 'boom' } })),
        );
        await expect(
            injectIntoMember(ENDPOINT, { threadId: 'th1' }, { kind: 'wake', text: 'x' }, { connect, attempts: 3, backoffMs: 1 }),
        ).rejects.toBeInstanceOf(InjectRequestError);
        expect(connect).toHaveBeenCalledTimes(1);
    });

    it('retries transport-level failures up to `attempts` and then throws', async () => {
        const connect = vi.fn<InjectConnectionFactory>(() => {
            const conn = new FakeConnection(() => undefined);
            conn.open = async () => {
                throw new Error('ECONNREFUSED');
            };
            return conn;
        });
        await expect(
            injectIntoMember(ENDPOINT, { threadId: 'th1' }, { kind: 'wake', text: 'x' }, { connect, attempts: 3, backoffMs: 1 }),
        ).rejects.toThrow('ECONNREFUSED');
        expect(connect).toHaveBeenCalledTimes(3);
    });

    it('recovers on a later attempt after an early transport failure', async () => {
        let attempt = 0;
        const connect: InjectConnectionFactory = () => {
            attempt += 1;
            if (attempt === 1) {
                const conn = new FakeConnection(() => undefined);
                conn.open = async () => {
                    throw new Error('flaky');
                };
                return conn;
            }
            return new FakeConnection((msg) => replyResult(msg.id, { turn: { id: 'turn-2' } }));
        };
        const result = await injectIntoMember(
            ENDPOINT,
            { threadId: 'th1' },
            { kind: 'wake', text: 'x' },
            { connect, attempts: 3, backoffMs: 1 },
        );
        expect(result).toEqual({ action: 'started', turnId: 'turn-2' });
        expect(attempt).toBe(2);
    });

    it('times out when the server never replies with a matching id', async () => {
        const connect: InjectConnectionFactory = () => new FakeConnection(() => undefined);
        await expect(
            injectIntoMember(ENDPOINT, { threadId: 'th1' }, { kind: 'wake', text: 'x' }, {
                connect,
                attempts: 1,
                requestTimeoutMs: 20,
            }),
        ).rejects.toThrow(/timed out/);
    });
});

describe('resolveMemberEndpoint', () => {
    let homeDir: string;

    beforeEach(() => {
        homeDir = mkdtempSync(join(tmpdir(), 'inject-resolve-'));
    });

    afterEach(() => {
        rmSync(homeDir, { recursive: true, force: true });
    });

    function writeRecord(name: string, overrides: Partial<CodexDiscoveryRecord>): void {
        const record: CodexDiscoveryRecord = {
            version: 1,
            pid: process.pid,
            port: 4599,
            startedAt: new Date().toISOString(),
            happyCliVersion: '0.0.0-test',
            cwd: 'C:/tmp/member',
            capabilityToken: 'cap-token',
            capabilityTokenSha256: 'sha',
            transport: 'ws',
            happySessionId: 'session-A',
            ...overrides,
        };
        writeFileSync(join(homeDir, name), `${JSON.stringify(record)}\n`);
    }

    it('returns an endpoint for a live member matched by happySessionId', async () => {
        writeRecord('codex-active-aaa.json', { happySessionId: 'session-A', port: 5111, capabilityToken: 'tok-A' });
        const endpoint = await resolveMemberEndpoint('session-A', homeDir);
        expect(endpoint).toEqual({ url: 'ws://127.0.0.1:5111', authToken: 'tok-A' });
    });

    it('returns null when no record matches the session id', async () => {
        writeRecord('codex-active-aaa.json', { happySessionId: 'session-A' });
        const endpoint = await resolveMemberEndpoint('session-Z', homeDir);
        expect(endpoint).toBeNull();
    });

    it('ignores records whose pid is not alive', async () => {
        // pid 0x7fffffff is effectively never a live process.
        writeRecord('codex-active-dead.json', { happySessionId: 'session-A', pid: 0x7fffffff });
        const endpoint = await resolveMemberEndpoint('session-A', homeDir);
        expect(endpoint).toBeNull();
    });
});
