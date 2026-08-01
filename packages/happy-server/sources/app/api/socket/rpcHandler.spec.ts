import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Server, Socket } from 'socket.io';

import { rpcHandler } from '@/app/api/socket/rpcHandler';

describe('rpcHandler actionId relay', () => {
    afterEach(() => {
        vi.useRealTimers();
    });

    it('forwards answerPrompt params without stripping or rewriting actionId', async () => {
        vi.useFakeTimers();
        let callHandler: ((data: unknown, callback: (response: unknown) => void) => Promise<void>) | undefined;
        const caller = {
            id: 'caller',
            on: vi.fn((event: string, handler: unknown) => {
                if (event === 'rpc-call') {
                    callHandler = handler as typeof callHandler;
                }
            }),
        };
        let forwarded: unknown;
        const target = {
            id: 'daemon',
            timeout: vi.fn(() => ({
                emitWithAck: vi.fn(async (_event: string, payload: unknown) => {
                    forwarded = payload;
                    return { actionId: '123e4567-e89b-42d3-a456-426614174000', outcome: 'applied' };
                }),
            })),
        };
        const fetchSockets = vi.fn(async () => [target]);
        const io = {
            in: vi.fn(() => ({
                timeout: vi.fn(() => ({ fetchSockets })),
            })),
        };
        rpcHandler(caller as unknown as Socket, io as unknown as Server);
        if (!callHandler) throw new Error('rpc-call handler was not registered');

        const params = {
            actionId: '123e4567-e89b-42d3-a456-426614174000',
            sessionId: 'happy-session',
            type: 'answer-permission',
            targetRequestId: 'request-1',
            content: { decision: 'approve', scope: 'once' },
        };
        let response: unknown;
        await callHandler({
            method: 'happy-session:happy.answerPrompt',
            params,
        }, (value) => {
            response = value;
        });

        expect(forwarded).toEqual({
            method: 'happy-session:happy.answerPrompt',
            params,
        });
        expect((forwarded as { params: unknown }).params).toBe(params);
        expect(response).toEqual({
            ok: true,
            result: { actionId: params.actionId, outcome: 'applied' },
        });
    });
});
