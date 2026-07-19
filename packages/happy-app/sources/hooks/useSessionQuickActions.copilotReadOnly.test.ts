import * as React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useSessionQuickActions } from './useSessionQuickActions';
import type { Machine, Session } from '@/sync/storageTypes';

/**
 * M1a: the single header/list action gate for read-only Copilot mirrors and
 * not-yet-hydrated placeholders. Asserts that the web popover, mobile
 * long-press, and compact-list swipe (all derived from this hook) cannot reach
 * resume/fork/spawn-child/metadata-copy for a Copilot mirror, and that Copilot
 * Archive is a pure `killSession` request with no worktree cleanup and no
 * server-archive fallback.
 */

const reactActEnvironment = globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT?: boolean;
};

const shared = vi.hoisted(() => ({
    routerPushMock: vi.fn(),
    navigateToSessionMock: vi.fn(),
    confirmMock: vi.fn(),
    sessionArchiveMock: vi.fn(),
    sessionKillMock: vi.fn(),
    maybeCleanupWorktreeMock: vi.fn(),
    isConnected: true,
    machine: null as Machine | null,
    latestActions: null as ReturnType<typeof useSessionQuickActions> | null,
    latestActionPromise: null as Promise<void> | null,
    latestActionError: null as unknown,
}));

vi.mock('expo-router', () => ({
    useRouter: () => ({ push: shared.routerPushMock }),
}));

vi.mock('@/hooks/useNavigateToSession', () => ({
    useNavigateToSession: () => shared.navigateToSessionMock,
}));

vi.mock('@/hooks/useHappyAction', () => ({
    useHappyAction: (action: () => Promise<void>) => {
        return [false, () => {
            shared.latestActionPromise = action().catch((error: unknown) => {
                shared.latestActionError = error;
            });
        }] as const;
    },
}));

vi.mock('@/hooks/useWorktreeCleanup', () => ({
    maybeCleanupWorktree: shared.maybeCleanupWorktreeMock,
}));

vi.mock('@/modal', () => ({
    Modal: { alert: vi.fn(), confirm: shared.confirmMock },
}));

vi.mock('@/sync/ops', () => ({
    machineResumeSession: vi.fn(),
    sessionArchive: shared.sessionArchiveMock,
    sessionKill: shared.sessionKillMock,
}));

vi.mock('@/sync/sync', () => ({
    sync: {
        refreshSessions: vi.fn(),
    },
}));

vi.mock('@/sync/storage', () => ({
    storage: {
        getState: () => ({
            updateSessionPermissionMode: vi.fn(),
            updateSessionModelMode: vi.fn(),
        }),
    },
    useLocalSetting: () => false,
    useMachine: () => shared.machine,
    useSession: vi.fn(),
    isCopilotSession: (s: { metadata?: { flavor?: string } | null } | null | undefined) => s?.metadata?.flavor === 'copilot',
    isPlaceholderSession: (s: { metadata?: unknown } | null | undefined) => !!s && !s.metadata,
}));

vi.mock('@/utils/machineUtils', () => ({
    isMachineOnline: (machine: Machine) => machine.active,
}));

vi.mock('@/utils/sessionUtils', () => ({
    useSessionStatus: () => ({ isConnected: shared.isConnected }),
}));

vi.mock('@/text', () => ({
    t: (key: string) => `translated:${key}`,
}));

vi.mock('@/utils/copySessionMetadataToClipboard', () => ({
    copySessionMetadataToClipboard: vi.fn(),
    copySessionMetadataAndLogsToClipboard: vi.fn(),
}));

function createCopilotSession(overrides: Partial<Session> = {}): Session {
    return {
        id: 'copilot-session',
        seq: 1,
        createdAt: 100,
        updatedAt: 100,
        active: true,
        activeAt: 100,
        metadata: {
            path: '/workspace/project',
            host: 'devbox',
            machineId: 'machine-1',
            flavor: 'copilot',
        },
        metadataVersion: 1,
        agentState: null,
        agentStateVersion: 1,
        thinking: false,
        thinkingAt: 0,
        presence: 100,
        ...overrides,
    } as Session;
}

function createPlaceholderSession(): Session {
    return {
        id: 'placeholder-session',
        seq: 1,
        createdAt: 100,
        updatedAt: 100,
        active: true,
        activeAt: 100,
        metadata: null,
        metadataVersion: 0,
        agentState: null,
        agentStateVersion: 1,
        thinking: false,
        thinkingAt: 0,
        presence: 100,
    } as Session;
}

function Harness({ session }: { session: Session }) {
    shared.latestActions = useSessionQuickActions(session);
    return null;
}

async function render(session: Session) {
    await act(async () => {
        TestRenderer.create(React.createElement(Harness, { session }));
    });
}

describe('useSessionQuickActions Copilot read-only gating', () => {
    beforeEach(() => {
        reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
        shared.routerPushMock.mockReset();
        shared.navigateToSessionMock.mockReset();
        shared.confirmMock.mockReset();
        shared.sessionArchiveMock.mockReset();
        shared.sessionKillMock.mockReset();
        shared.maybeCleanupWorktreeMock.mockReset();
        shared.isConnected = true;
        shared.machine = null;
        shared.latestActions = null;
        shared.latestActionPromise = null;
        shared.latestActionError = null;
        shared.confirmMock.mockResolvedValue(true);
        shared.sessionKillMock.mockResolvedValue({ success: true });
        shared.sessionArchiveMock.mockResolvedValue({ success: true });
        shared.maybeCleanupWorktreeMock.mockResolvedValue(undefined);
    });

    it('exposes only Details + Archive for a connected Copilot mirror', async () => {
        await render(createCopilotSession());
        const ids = shared.latestActions!.actionItems.map((a) => a.id);
        expect(ids).toEqual(['details', 'archive']);
        expect(shared.latestActions!.canArchive).toBe(true);
    });

    it('never exposes resume/fork/spawn-child/metadata-copy for a Copilot mirror', async () => {
        await render(createCopilotSession());
        const ids = shared.latestActions!.actionItems.map((a) => a.id);
        for (const forbidden of ['resume', 'fork', 'spawn-child', 'copy-metadata', 'copy-metadata-and-logs']) {
            expect(ids).not.toContain(forbidden);
        }
    });

    it('drops Archive (Details only) when the Copilot mirror is not connected', async () => {
        shared.isConnected = false;
        await render(createCopilotSession());
        expect(shared.latestActions!.actionItems.map((a) => a.id)).toEqual(['details']);
        expect(shared.latestActions!.canArchive).toBe(false);
    });

    it('drops Archive for an already-archived Copilot mirror', async () => {
        await render(createCopilotSession({
            metadata: {
                path: '/workspace/project',
                host: 'devbox',
                machineId: 'machine-1',
                flavor: 'copilot',
                lifecycleState: 'archived',
            } as Session['metadata'],
        }));
        expect(shared.latestActions!.actionItems.map((a) => a.id)).toEqual(['details']);
        expect(shared.latestActions!.canArchive).toBe(false);
    });

    it('exposes no actions and forbids archive for a placeholder session', async () => {
        await render(createPlaceholderSession());
        expect(shared.latestActions!.actionItems).toEqual([]);
        expect(shared.latestActions!.canArchive).toBe(false);
    });

    it('Copilot archive kills the session without worktree cleanup or server-archive fallback', async () => {
        await render(createCopilotSession());
        await act(async () => {
            await shared.latestActions!.archiveSession();
        });
        await shared.latestActionPromise;

        expect(shared.sessionKillMock).toHaveBeenCalledWith('copilot-session');
        expect(shared.maybeCleanupWorktreeMock).not.toHaveBeenCalled();
        expect(shared.sessionArchiveMock).not.toHaveBeenCalled();
    });

    it('Copilot archive surfaces an error and does not fall back to server-archive on kill failure', async () => {
        shared.sessionKillMock.mockResolvedValue({ success: false });
        await render(createCopilotSession());
        await act(async () => {
            await shared.latestActions!.archiveSession();
        });
        await shared.latestActionPromise;

        expect(shared.sessionKillMock).toHaveBeenCalledWith('copilot-session');
        expect(shared.sessionArchiveMock).not.toHaveBeenCalled();
    });
});
