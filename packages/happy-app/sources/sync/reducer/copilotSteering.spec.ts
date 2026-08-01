import { describe, it, expect } from 'vitest';

import { NormalizedMessage } from '../typesRaw';
import { createReducer, reducer, applyCopilotControl, applyCopilotPrompt } from './reducer';

function controlMessage(id: string, seq: number, partial: Partial<Extract<NormalizedMessage['content'], { type: 'copilot-control' }>>): NormalizedMessage {
    return {
        id,
        localId: null,
        createdAt: seq,
        seq,
        role: 'event',
        isSidechain: false,
        content: { type: 'copilot-control', state: 'no-lease', ...partial } as never,
    };
}

function promptMessage(id: string, seq: number, requestId: string, state: 'pending' | 'resolved', destructive = false): NormalizedMessage {
    return {
        id,
        localId: null,
        createdAt: seq,
        seq,
        role: 'event',
        isSidechain: false,
        content: {
            type: 'copilot-prompt',
            requestId,
            promptType: 'answer-permission',
            state,
            destructive,
        },
    };
}

describe('reducer copilot steering projection', () => {
    it('projects the latest-by-seq control state without rendering a chat message', () => {
        const state = createReducer();
        const result = reducer(state, [
            controlMessage('c1', 10, { state: 'requested', requestId: 'r1' }),
            controlMessage('c2', 20, { state: 'active', leaseId: 'l1', expiresAt: 5000, heartbeatIntervalMs: 15000, leaseTtlMs: 45000 }),
        ]);
        // No chat rows produced by control events.
        expect(result.messages).toHaveLength(0);
        expect(state.copilotControl).toEqual({
            id: 'c2',
            seq: 20,
            state: 'active',
            leaseId: 'l1',
            expiresAt: 5000,
            heartbeatIntervalMs: 15000,
            leaseTtlMs: 45000,
        });
    });

    it('does not regress control state on an older-seq event', () => {
        const state = createReducer();
        applyCopilotControl(state, controlMessage('c2', 20, { state: 'active', leaseId: 'l1', expiresAt: 5000 }));
        applyCopilotControl(state, controlMessage('c1', 10, { state: 'no-lease', reason: 'expired' }));
        expect(state.copilotControl?.seq).toBe(20);
        expect(state.copilotControl?.state).toBe('active');
    });

    it('carries a revocation reason on a no-lease control event', () => {
        const state = createReducer();
        applyCopilotControl(state, controlMessage('c1', 5, { state: 'no-lease', reason: 'keystroke' }));
        expect(state.copilotControl?.state).toBe('no-lease');
        expect(state.copilotControl?.reason).toBe('keystroke');
    });

    it('tracks pending prompts keyed by requestId and resolves them', () => {
        const state = createReducer();
        reducer(state, [
            promptMessage('p1', 10, 'req-a', 'pending'),
            promptMessage('p2', 11, 'req-b', 'pending', true),
        ]);
        expect(state.copilotPrompts?.get('req-a')?.state).toBe('pending');
        expect(state.copilotPrompts?.get('req-b')?.destructive).toBe(true);

        // Resolving with a newer seq flips state to resolved.
        reducer(state, [promptMessage('p3', 20, 'req-a', 'resolved')]);
        expect(state.copilotPrompts?.get('req-a')?.state).toBe('resolved');
    });

    it('does not let an older-seq prompt event overwrite a newer resolution', () => {
        const state = createReducer();
        applyCopilotPrompt(state, promptMessage('p2', 20, 'req-a', 'resolved'));
        applyCopilotPrompt(state, promptMessage('p1', 10, 'req-a', 'pending'));
        expect(state.copilotPrompts?.get('req-a')?.state).toBe('resolved');
        expect(state.copilotPrompts?.get('req-a')?.seq).toBe(20);
    });

    it('replaces the prompts Map identity on write so store selectors re-render', () => {
        const state = createReducer();
        applyCopilotPrompt(state, promptMessage('p1', 10, 'req-a', 'pending'));
        const first = state.copilotPrompts;
        applyCopilotPrompt(state, promptMessage('p2', 11, 'req-b', 'pending'));
        expect(state.copilotPrompts).not.toBe(first);
    });
});
