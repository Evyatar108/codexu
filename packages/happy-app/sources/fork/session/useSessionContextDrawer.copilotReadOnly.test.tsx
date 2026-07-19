import * as React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useSessionContextDrawer } from './useSessionContextDrawer';
import type { Session } from '@/sync/storageTypes';

/**
 * M1a: the context drawer + archived-resume hint expose fork / resume / model /
 * permission / take-over controls, so a read-only Copilot mirror (or a
 * not-yet-hydrated placeholder) must render neither. Asserts both nodes are
 * null and `isInactiveArchivedSession` is forced false for read-only sessions,
 * while a normal session still renders the drawer.
 */

const reactActEnvironment = globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT?: boolean;
};

const shared = vi.hoisted(() => ({
    latest: null as ReturnType<typeof useSessionContextDrawer> | null,
}));

vi.mock('react-native', () => ({
    ActivityIndicator: 'ActivityIndicator',
    Pressable: 'Pressable',
    Text: 'Text',
    View: 'View',
}));

vi.mock('expo-router', () => ({
    useRouter: () => ({ push: vi.fn() }),
}));

vi.mock('react-native-unistyles', () => ({
    useUnistyles: () => ({
        theme: {
            colors: {
                agentEventText: '#000',
                button: { primary: { background: '#111', tint: '#fff' } },
            },
        },
    }),
}));

vi.mock('@/components/modelModeOptions', () => ({
    getDefaultModelKey: () => 'default',
    resolveCurrentOption: () => null,
    resolvePermissionModeForPicker: () => null,
}));

vi.mock('@/components/SessionContextDrawer', () => ({
    ResumeCommandCopyBlock: 'ResumeCommandCopyBlock',
    SessionContextDrawer: 'SessionContextDrawer',
}));

vi.mock('@/hooks/useSessionQuickActions', () => ({
    useSessionQuickActions: () => ({
        canResume: false,
        resumeAvailability: { canResume: false, canShowResume: false, message: '', subtitle: '' },
        resumeSession: vi.fn(),
        resumeSessionInline: vi.fn(),
        resumingSession: false,
    }),
}));

vi.mock('@/sync/storage', () => ({
    useMachine: () => null,
    isReadOnlySession: (s: { metadata?: { flavor?: string } | null } | null | undefined) =>
        s?.metadata?.flavor === 'copilot' || (!!s && !s.metadata),
}));

vi.mock('@/text', () => ({
    t: (key: string) => `translated:${key}`,
}));

vi.mock('@/utils/sessionUtils', () => ({
    getResumeCommandBlock: () => null,
}));

function createSession(flavor?: string, overrides: Partial<Session> = {}): Session {
    return {
        id: 'session-1',
        seq: 1,
        createdAt: 100,
        updatedAt: 100,
        active: true,
        activeAt: 100,
        metadata: { path: '/repo', host: 'devbox', flavor } as Session['metadata'],
        metadataVersion: 1,
        agentState: null,
        agentStateVersion: 1,
        thinking: false,
        thinkingAt: 0,
        presence: 100,
        ...overrides,
    } as Session;
}

function Harness({ session }: { session: Session }) {
    shared.latest = useSessionContextDrawer({
        sessionId: session.id,
        session,
        availableModels: [],
        availableModes: [],
        isConnected: false,
    });
    return null;
}

async function render(session: Session) {
    await act(async () => {
        TestRenderer.create(React.createElement(Harness, { session }));
    });
}

describe('useSessionContextDrawer read-only gating', () => {
    beforeEach(() => {
        reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
        shared.latest = null;
    });

    it('renders no drawer or archived hint for a Copilot mirror', async () => {
        await render(createSession('copilot', {
            metadata: { path: '/repo', host: 'devbox', flavor: 'copilot', lifecycleState: 'archived' } as Session['metadata'],
        }));
        expect(shared.latest!.drawer).toBeNull();
        expect(shared.latest!.archivedHint).toBeNull();
        expect(shared.latest!.isInactiveArchivedSession).toBe(false);
    });

    it('renders no drawer for a placeholder (null-metadata) session', async () => {
        await render(createSession(undefined, { metadata: null, metadataVersion: 0 }));
        expect(shared.latest!.drawer).toBeNull();
        expect(shared.latest!.archivedHint).toBeNull();
    });

    it('renders the drawer for a normal non-Copilot session', async () => {
        await render(createSession('claude'));
        expect(shared.latest!.drawer).not.toBeNull();
    });
});
