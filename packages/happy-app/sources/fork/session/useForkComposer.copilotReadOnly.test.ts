import * as React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useForkComposer } from './useForkComposer';
import type { Session } from '@/sync/storageTypes';

/**
 * M1a: defense-in-depth for the fork-owned composer seam. SessionView never
 * mounts AgentInput for a read-only Copilot mirror (or a not-yet-hydrated
 * placeholder), but this asserts that even a direct/alternate caller of the
 * seam gets `blockSend: true` and a no-op `onSend` that never reaches the send
 * runner.
 */

const reactActEnvironment = globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT?: boolean;
};

const shared = vi.hoisted(() => ({
    runForkComposerSendMock: vi.fn(),
    latest: null as ReturnType<typeof useForkComposer> | null,
}));

vi.mock('@/hooks/useDraft', () => ({
    useDraft: () => ({ clearDraft: vi.fn() }),
}));

vi.mock('@/hooks/usePreSendCommand', () => ({
    usePreSendCommand: () => vi.fn(),
}));

vi.mock('@/modal', () => ({
    Modal: { alert: vi.fn() },
}));

vi.mock('@/-session/composeBoundaryAdvisory', () => ({
    updateComposeStartAt: () => null,
}));

vi.mock('@/sync/ops', () => ({
    sessionWriteFile: vi.fn(),
}));

vi.mock('@/sync/sync', () => ({
    generateLocalMessageId: () => 'local-id',
    sync: { sendMessage: vi.fn() },
}));

vi.mock('@/text', () => ({
    t: (key: string) => `translated:${key}`,
}));

vi.mock('@/utils/sessionUtils', () => ({
    getSessionMode: () => 'remote',
}));

vi.mock('@/components/composer/AttachmentChip', () => ({
    buildMessageWithAttachmentRefs: (message: string) => message,
}));

vi.mock('@/sync/storage', () => ({
    isReadOnlySession: (s: { metadata?: { flavor?: string } | null } | null | undefined) =>
        s?.metadata?.flavor === 'copilot' || (!!s && !s.metadata),
}));

vi.mock('./forkComposerSend', () => ({
    runForkComposerSend: shared.runForkComposerSendMock,
}));

function createSession(flavor?: string, metadataNull = false): Session {
    return {
        id: 'session-1',
        seq: 1,
        createdAt: 100,
        updatedAt: 100,
        active: true,
        activeAt: 100,
        metadata: metadataNull ? null : ({ path: '/repo', host: 'devbox', flavor } as Session['metadata']),
        metadataVersion: metadataNull ? 0 : 1,
        agentState: null,
        agentStateVersion: 1,
        thinking: false,
        thinkingAt: 0,
        presence: 100,
    } as Session;
}

function Harness({ session }: { session: Session }) {
    shared.latest = useForkComposer(session.id, session);
    return null;
}

async function render(session: Session) {
    await act(async () => {
        TestRenderer.create(React.createElement(Harness, { session }));
    });
}

describe('useForkComposer read-only gating', () => {
    beforeEach(() => {
        reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
        shared.runForkComposerSendMock.mockReset();
        shared.runForkComposerSendMock.mockResolvedValue(true);
        shared.latest = null;
    });

    it('blocks send and no-ops onSend for a Copilot mirror', async () => {
        await render(createSession('copilot'));
        expect(shared.latest!.inputProps.blockSend).toBe(true);
        let result: boolean | undefined;
        await act(async () => {
            result = await shared.latest!.inputProps.onSend('now', []);
        });
        expect(result).toBeUndefined();
        expect(shared.runForkComposerSendMock).not.toHaveBeenCalled();
    });

    it('blocks send for a placeholder (null-metadata) session', async () => {
        await render(createSession(undefined, true));
        expect(shared.latest!.inputProps.blockSend).toBe(true);
        await act(async () => {
            await shared.latest!.inputProps.onSend('now', []);
        });
        expect(shared.runForkComposerSendMock).not.toHaveBeenCalled();
    });

    it('allows send for a normal non-Copilot session', async () => {
        await render(createSession('claude'));
        expect(shared.latest!.inputProps.blockSend).toBe(false);
        await act(async () => {
            await shared.latest!.inputProps.onSend('now', []);
        });
        expect(shared.runForkComposerSendMock).toHaveBeenCalledTimes(1);
    });
});
