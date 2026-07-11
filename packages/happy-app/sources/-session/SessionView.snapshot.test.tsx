import { describe, expect, it } from 'vitest';

import type { SessionOutputSnapshotPayload } from '@slopus/happy-wire';

import { composeSessionMessagesWithSnapshots } from '@/sync/sessionOutputSnapshot';
import type { Message } from '@/sync/typesMessage';

describe('SessionView snapshot composition', () => {
    it('derives one standard agent-text row for the existing MessageView/list path', () => {
        const sessionId = 'machine-a:happy-session-id';
        const snapshot: SessionOutputSnapshotPayload = {
            sessionId,
            threadId: 'thread-1',
            turnId: 'turn-1',
            itemId: 'item-1',
            revision: 8,
            text: 'full accumulated text',
            emittedAt: 200,
        };
        const durable: Message = {
            kind: 'user-text',
            id: 'user-1',
            localId: 'local-user-1',
            createdAt: 100,
            seq: 1,
            text: 'prompt',
        };

        const messages = composeSessionMessagesWithSnapshots(
            [durable],
            { [`${sessionId}:item-1`]: snapshot },
            sessionId,
        );

        expect(messages).toHaveLength(2);
        expect(messages[0]).toEqual({
            kind: 'agent-text',
            id: `happy-session-output-snapshot:${sessionId}:item-1`,
            localId: null,
            createdAt: 200,
            seq: Number.MAX_SAFE_INTEGER,
            text: 'full accumulated text',
        });
        expect(messages[1]).toBe(durable);
    });

    it('replaces the transient row with the durable final without changing renderer shape', () => {
        const sessionId = 'machine-a:happy-session-id';
        const durable: Extract<Message, { kind: 'agent-text' }> = {
            kind: 'agent-text',
            id: 'durable-item-1',
            localId: 'codex-origin:assistant:item-1',
            createdAt: 300,
            seq: 2,
            text: 'durable final',
        };

        expect(composeSessionMessagesWithSnapshots([durable], {
            [`${sessionId}:item-1`]: {
                sessionId,
                threadId: 'thread-1',
                turnId: 'turn-1',
                itemId: 'item-1',
                revision: 8,
                text: 'stale transient',
                emittedAt: 200,
            },
        }, sessionId)).toEqual([durable]);
    });
});
