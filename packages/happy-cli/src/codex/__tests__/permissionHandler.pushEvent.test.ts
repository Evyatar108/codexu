/**
 * Codex permission handler — push-event parity test (Gap 4 / codex-hooks-parity).
 *
 * Asserts that `CodexPermissionHandler.handleToolCall` fires
 * `session.sendPushEvent({ kind: 'permission', data: { ..., provider: 'codex' } })`
 * for the non-auto-approved (pending) branch and stays silent on the
 * auto-approve branch — mirroring Claude's `permissionHandler.ts:222-231`
 * emit-then-update ordering.
 */

import { describe, expect, it, vi } from 'vitest';
import { CodexPermissionHandler } from '../utils/permissionHandler';

vi.mock('@/ui/logger', () => ({
    logger: {
        debug: vi.fn(),
    },
}));

function createSessionMock() {
    let state: Record<string, any> = {};

    const sendPushEvent = vi.fn();

    return {
        session: {
            sessionId: 'sess-1',
            rpcHandlerManager: {
                registerHandler: vi.fn(),
            },
            updateAgentState: vi.fn((updater: (currentState: Record<string, any>) => Record<string, any>) => {
                state = updater(state);
                return state;
            }),
            sendPushEvent,
        },
        sendPushEvent,
        getState: () => state,
    };
}

describe('CodexPermissionHandler — permission push-event parity', () => {
    it('does NOT fire sendPushEvent when the tool is auto-approved', async () => {
        const { session, sendPushEvent } = createSessionMock();
        const handler = new CodexPermissionHandler(session as any);

        const result = await handler.handleToolCall(
            'call_change_title_1',
            'change_title',
            { title: 'x' },
        );

        expect(result).toEqual({ decision: 'approved' });
        expect(sendPushEvent).not.toHaveBeenCalled();
    });

    it('fires sendPushEvent exactly once on the pending-request branch with the codex-tagged payload', async () => {
        const { session, sendPushEvent } = createSessionMock();
        const handler = new CodexPermissionHandler(session as any);

        const pending = handler.handleToolCall(
            'call_exec_123',
            'CodexBash',
            { command: 'ls' },
        );

        expect(sendPushEvent).toHaveBeenCalledTimes(1);
        expect(sendPushEvent).toHaveBeenCalledWith({
            kind: 'permission',
            data: {
                sessionId: 'sess-1',
                requestId: 'call_exec_123',
                tool: 'CodexBash',
                type: 'permission_request',
                provider: 'codex',
            },
        });

        // Clean up the dangling pending promise so the test runner does not leak it.
        handler.abortAll();
        await expect(pending).resolves.toEqual({ decision: 'abort' });
    });
});
