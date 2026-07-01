/**
 * Unit tests for the daemon AppServerEvent reader + member identity registry
 * (US-003). Everything here is pure/in-memory except `attachMemberEventStream`,
 * which is driven through a fake JsonRpcConnection (no real websocket).
 */

import { describe, expect, it, vi } from 'vitest';
import type { JsonRpcConnection, JsonRpcMessage } from '@/codex/transport/JsonRpcConnection';
import type { InjectEndpoint } from './injectClient';
import {
    parseKindTag,
    reduceMemberEvent,
    initialMemberState,
    MemberEventTracker,
    MemberRegistry,
    memberLiveness,
    attachMemberEventStream,
    type AppServerNotification,
    type EventStreamConnectionFactory,
} from './eventReader';

const ENDPOINT: InjectEndpoint = { url: 'ws://127.0.0.1:1234', authToken: 'tok' };
const fixedNow = () => 1000;

describe('parseKindTag', () => {
    it('extracts a double-quoted kind', () => {
        expect(parseKindTag('all done <|report kind="done" summary="ok"|>')).toBe('done');
    });

    it('extracts a single-quoted kind', () => {
        expect(parseKindTag("<|report kind='question' summary='?'|>")).toBe('question');
    });

    it('tolerates extra whitespace after report', () => {
        expect(parseKindTag('<|report   kind="blocked"|>')).toBe('blocked');
    });

    it('returns null when there is no report tag', () => {
        expect(parseKindTag('just a normal assistant message')).toBeNull();
    });

    it('returns null for empty/non-string input', () => {
        expect(parseKindTag('')).toBeNull();
        expect(parseKindTag(undefined)).toBeNull();
        expect(parseKindTag(42)).toBeNull();
    });
});

describe('reduceMemberEvent', () => {
    it('sets threadId on thread/started', () => {
        const next = reduceMemberEvent(initialMemberState(), { method: 'thread/started', params: { thread: { id: 'th1' } } }, fixedNow);
        expect(next.threadId).toBe('th1');
        expect(next.lastEventAt).toBe(1000);
    });

    it('goes RUNNING with activeTurnId on turn/started', () => {
        const next = reduceMemberEvent(initialMemberState(), { method: 'turn/started', params: { turn: { id: 'tn1' } } }, fixedNow);
        expect(next.phase).toBe('running');
        expect(next.activeTurnId).toBe('tn1');
    });

    it('goes IDLE and clears activeTurnId on turn/completed', () => {
        const running = reduceMemberEvent(initialMemberState(), { method: 'turn/started', params: { turnId: 'tn1' } }, fixedNow);
        const done = reduceMemberEvent(running, { method: 'turn/completed', params: { turn: { id: 'tn1', status: 'completed' } } }, fixedNow);
        expect(done.phase).toBe('idle');
        expect(done.activeTurnId).toBeNull();
    });

    it('captures agentMessage text and parses the kind-tag on item/completed', () => {
        const next = reduceMemberEvent(
            initialMemberState(),
            { method: 'item/completed', params: { item: { type: 'agentMessage', text: 'finished <|report kind="done"|>' } } },
            fixedNow,
        );
        expect(next.lastMessageText).toBe('finished <|report kind="done"|>');
        expect(next.lastKindTag).toBe('done');
    });

    it('keeps the prior kind-tag when a later message has none', () => {
        const first = reduceMemberEvent(
            initialMemberState(),
            { method: 'item/completed', params: { item: { type: 'agentMessage', text: '<|report kind="progress"|>' } } },
            fixedNow,
        );
        const second = reduceMemberEvent(
            first,
            { method: 'item/completed', params: { item: { type: 'agentMessage', text: 'no tag here' } } },
            fixedNow,
        );
        expect(second.lastMessageText).toBe('no tag here');
        expect(second.lastKindTag).toBe('progress');
    });

    it('ignores non-agentMessage items', () => {
        const state = initialMemberState();
        const next = reduceMemberEvent(state, { method: 'item/completed', params: { item: { type: 'commandExecution', command: 'ls' } } }, fixedNow);
        expect(next).toBe(state); // referentially unchanged
    });

    it('handles legacy codex/event task_started / task_complete', () => {
        const started = reduceMemberEvent(initialMemberState(), { method: 'codex/event', params: { msg: { type: 'task_started', turn_id: 'tn9' } } }, fixedNow);
        expect(started.phase).toBe('running');
        expect(started.activeTurnId).toBe('tn9');
        const complete = reduceMemberEvent(started, { method: 'codex/event/task_complete', params: { msg: { type: 'task_complete', turn_id: 'tn9' } } }, fixedNow);
        expect(complete.phase).toBe('idle');
        expect(complete.activeTurnId).toBeNull();
    });

    it('handles legacy turn_aborted as IDLE', () => {
        const started = reduceMemberEvent(initialMemberState(), { method: 'codex/event', params: { msg: { type: 'task_started', turn_id: 't' } } }, fixedNow);
        const aborted = reduceMemberEvent(started, { method: 'codex/event', params: { msg: { type: 'turn_aborted' } } }, fixedNow);
        expect(aborted.phase).toBe('idle');
    });

    it('parses kind-tag from a legacy agent_message', () => {
        const next = reduceMemberEvent(initialMemberState(), { method: 'codex/event', params: { msg: { type: 'agent_message', message: 'x <|report kind="blocked"|>' } } }, fixedNow);
        expect(next.lastKindTag).toBe('blocked');
        expect(next.lastMessageText).toBe('x <|report kind="blocked"|>');
    });

    it('returns the same state (no-op) for unknown methods', () => {
        const state = initialMemberState();
        expect(reduceMemberEvent(state, { method: 'thread/tokenUsage/updated', params: {} }, fixedNow)).toBe(state);
        expect(reduceMemberEvent(state, { method: 'mcpServer/startupStatus/updated' }, fixedNow)).toBe(state);
    });
});

describe('MemberEventTracker', () => {
    it('accumulates state across a start→message→complete sequence', () => {
        const tracker = new MemberEventTracker(fixedNow);
        tracker.apply({ method: 'thread/started', params: { thread: { id: 'th1' } } });
        tracker.apply({ method: 'turn/started', params: { turn: { id: 'tn1' } } });
        expect(tracker.turnState).toEqual({ threadId: 'th1', activeTurnId: 'tn1' });

        tracker.apply({ method: 'item/completed', params: { item: { type: 'agentMessage', text: 'done <|report kind="done"|>' } } });
        tracker.apply({ method: 'turn/completed', params: { turn: { id: 'tn1' } } });

        expect(tracker.turnState).toEqual({ threadId: 'th1', activeTurnId: null });
        expect(tracker.state.lastKindTag).toBe('done');
        expect(tracker.state.phase).toBe('idle');
    });

    it('turnState is shaped exactly like injectClient MemberTurnState', () => {
        const tracker = new MemberEventTracker(fixedNow);
        tracker.apply({ method: 'thread/started', params: { threadId: 'th2' } });
        const ts = tracker.turnState;
        expect(Object.keys(ts).sort()).toEqual(['activeTurnId', 'threadId']);
    });
});

describe('memberLiveness', () => {
    it('reports alive when the pid probe returns true', () => {
        expect(memberLiveness(123, () => true)).toBe('alive');
    });
    it('reports crashed when the pid probe returns false', () => {
        expect(memberLiveness(123, () => false)).toBe('crashed');
    });
});

describe('MemberRegistry', () => {
    const reg = (id: string, pid = 100): { happySessionId: string; endpoint: InjectEndpoint; pid: number } => ({
        happySessionId: id,
        endpoint: { url: `ws://127.0.0.1:${pid}`, authToken: 't' },
        pid,
    });

    it('registers and looks up members by happySessionId', () => {
        const registry = new MemberRegistry(fixedNow);
        registry.register(reg('session-A', 111));
        expect(registry.has('session-A')).toBe(true);
        expect(registry.get('session-A')).toEqual(reg('session-A', 111));
        expect(registry.list()).toEqual(['session-A']);
    });

    it('does not leak the internal tracker through get()', () => {
        const registry = new MemberRegistry(fixedNow);
        registry.register(reg('session-A'));
        expect((registry.get('session-A') as unknown as Record<string, unknown>).tracker).toBeUndefined();
    });

    it('preserves the tracker across re-registration', () => {
        const registry = new MemberRegistry(fixedNow);
        registry.register(reg('session-A', 111));
        registry.applyEvent('session-A', { method: 'turn/started', params: { turn: { id: 'tn1' } } });
        // Re-register with a new pid/endpoint (discovery-record refresh).
        registry.register(reg('session-A', 222));
        expect(registry.get('session-A')?.pid).toBe(222);
        // Prior observed turn state survives.
        expect(registry.tracker('session-A')?.turnState.activeTurnId).toBe('tn1');
    });

    it('applyEvent updates the registered tracker and returns state', () => {
        const registry = new MemberRegistry(fixedNow);
        registry.register(reg('session-A'));
        const state = registry.applyEvent('session-A', { method: 'thread/started', params: { thread: { id: 'th7' } } });
        expect(state?.threadId).toBe('th7');
        expect(registry.tracker('session-A')?.state.threadId).toBe('th7');
    });

    it('applyEvent returns undefined for an unregistered (unattributable) member', () => {
        const registry = new MemberRegistry(fixedNow);
        const notification: AppServerNotification = { method: 'turn/started', params: { turn: { id: 'x' } } };
        expect(registry.applyEvent('ghost', notification)).toBeUndefined();
    });

    it('unregister removes the member', () => {
        const registry = new MemberRegistry(fixedNow);
        registry.register(reg('session-A'));
        expect(registry.unregister('session-A')).toBe(true);
        expect(registry.has('session-A')).toBe(false);
        expect(registry.unregister('session-A')).toBe(false);
    });

    it('reports per-member liveness and enumerates crashed members', () => {
        const registry = new MemberRegistry(fixedNow);
        registry.register(reg('alive-1', 111));
        registry.register(reg('dead-1', 222));
        registry.register(reg('dead-2', 333));
        const probe = (pid: number) => pid === 111;
        expect(registry.liveness('alive-1', probe)).toBe('alive');
        expect(registry.liveness('dead-1', probe)).toBe('crashed');
        expect(registry.liveness('missing', probe)).toBeUndefined();
        expect(registry.crashedMembers(probe).sort()).toEqual(['dead-1', 'dead-2']);
    });
});

/** A fake connection that lets the test emit server→client notifications after open(). */
class FakeStreamConnection implements JsonRpcConnection {
    opened = false;
    closed = false;
    private messageHandler: ((msg: JsonRpcMessage) => void) | null = null;
    private errorHandler: ((error: Error) => void) | null = null;
    private closeHandler: ((code: number | null, signal: NodeJS.Signals | null) => void) | null = null;

    async open(): Promise<void> {
        this.opened = true;
    }
    async send(): Promise<void> {}
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
        this.closeHandler?.(null, null);
    }
    emit(msg: JsonRpcMessage): void {
        this.messageHandler?.(msg);
    }
    fail(error: Error): void {
        this.errorHandler?.(error);
    }
}

describe('attachMemberEventStream', () => {
    it('pumps notifications into the tracker and fires onState', async () => {
        let conn: FakeStreamConnection | undefined;
        const connect: EventStreamConnectionFactory = () => (conn = new FakeStreamConnection());
        const tracker = new MemberEventTracker(fixedNow);
        const seen: string[] = [];
        const handle = await attachMemberEventStream(ENDPOINT, tracker, {
            connect,
            onState: (_state, n) => seen.push(n.method),
        });
        expect(conn?.opened).toBe(true);

        conn!.emit({ jsonrpc: '2.0', method: 'turn/started', params: { turn: { id: 'tn1' } } });
        conn!.emit({ jsonrpc: '2.0', method: 'item/completed', params: { item: { type: 'agentMessage', text: '<|report kind="done"|>' } } });

        expect(tracker.state.activeTurnId).toBe('tn1');
        expect(tracker.state.lastKindTag).toBe('done');
        expect(seen).toEqual(['turn/started', 'item/completed']);

        await handle.close();
        expect(conn?.closed).toBe(true);
    });

    it('ignores non-notification messages (responses with only id/result)', async () => {
        let conn: FakeStreamConnection | undefined;
        const connect: EventStreamConnectionFactory = () => (conn = new FakeStreamConnection());
        const tracker = new MemberEventTracker(fixedNow);
        const seen: AppServerNotification[] = [];
        await attachMemberEventStream(ENDPOINT, tracker, { connect, onState: (_s, n) => seen.push(n) });

        conn!.emit({ jsonrpc: '2.0', id: 1, result: { ok: true } });
        expect(seen).toHaveLength(0);
        expect(tracker.state.lastEventAt).toBeNull();
    });

    it('routes transport errors to onError', async () => {
        let conn: FakeStreamConnection | undefined;
        const connect: EventStreamConnectionFactory = () => (conn = new FakeStreamConnection());
        const onError = vi.fn();
        await attachMemberEventStream(ENDPOINT, new MemberEventTracker(fixedNow), { connect, onError });
        conn!.fail(new Error('socket blew up'));
        expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'socket blew up' }));
    });
});
