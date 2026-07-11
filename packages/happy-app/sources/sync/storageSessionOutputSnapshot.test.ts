import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { SessionOutputSnapshotPayload } from '@slopus/happy-wire';
import type { NormalizedMessage } from './typesRaw';

vi.mock('@/utils/sessionUtils', () => ({
    getSessionName: () => 'Test Session',
    getSessionSubtitle: () => 'Test Project',
    getSessionAvatarId: () => 'test-avatar',
}));

vi.mock('@/components/tools/knownTools', () => ({
    isMutableTool: () => true,
}));

vi.mock('./projectManager', () => ({
    projectManager: {
        updateSessions: vi.fn(),
        updateSessionProjectGitStatus: vi.fn(),
        getProjects: () => [],
        getProject: () => null,
        getProjectForSession: () => null,
        getProjectSessions: () => [],
        getProjectGitStatus: () => null,
        getSessionProjectGitStatus: () => null,
    },
}));

vi.mock('./sync', () => ({
    sync: {
        applySettings: vi.fn(),
    },
}));

vi.mock('expo-modules-core', () => ({
    requireOptionalNativeModule: () => null,
}));

async function importFreshStorage() {
    const module = await import('./storage');
    return module.storage;
}

describe('storage session output snapshot replacement', () => {
    beforeEach(() => {
        vi.resetModules();
    });

    it('preserves the durable agent local id, clears the transient, and rejects late snapshots', async () => {
        const storage = await importFreshStorage();
        const sessionId = 'machine-a:session-a';
        const itemId = 'assistant-item-a';
        const snapshot: SessionOutputSnapshotPayload = {
            sessionId,
            threadId: 'thread-a',
            turnId: 'turn-a',
            itemId,
            revision: 1,
            text: 'transient',
            emittedAt: 1_000,
        };
        const durableMessage: NormalizedMessage = {
            id: 'durable-message-a',
            localId: `codex-origin:assistant:${itemId}`,
            createdAt: 2_000,
            seq: 10,
            role: 'agent',
            isSidechain: false,
            content: [{
                type: 'text',
                text: 'durable final',
                uuid: 'content-a',
                parentUUID: null,
            }],
        };

        storage.getState().applySessionOutputSnapshot(snapshot);
        expect(Object.values(storage.getState().sessionOutputSnapshots)).toHaveLength(1);

        storage.getState().applyMessages(sessionId, [durableMessage]);

        const storedMessage = storage.getState().sessionMessages[sessionId]?.messages[0];
        expect(storedMessage?.kind).toBe('agent-text');
        expect(storedMessage && 'localId' in storedMessage ? storedMessage.localId : null)
            .toBe(durableMessage.localId);
        expect(storage.getState().sessionOutputSnapshots).toEqual({});

        storage.getState().applySessionOutputSnapshot({
            ...snapshot,
            revision: 2,
            text: 'late transient',
        });
        expect(storage.getState().sessionOutputSnapshots).toEqual({});
    });
});
