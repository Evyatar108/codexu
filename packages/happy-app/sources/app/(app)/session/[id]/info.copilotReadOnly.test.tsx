import * as React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type TestSession = {
    id: string;
    seq: number;
    createdAt: number;
    updatedAt: number;
    active: boolean;
    thinking: boolean;
    thinkingAt: number;
    agentState: unknown;
    metadata: { flavor?: string; host?: string; path?: string; machineId?: string } | null;
};

const shared = vi.hoisted(() => ({
    session: null as TestSession | null,
    isDataReady: true,
    routeId: 'session-1',
}));

vi.mock('expo-router', () => ({
    useRouter: () => ({ back: vi.fn(), push: vi.fn() }),
    useLocalSearchParams: () => ({ id: shared.routeId }),
}));

vi.mock('@/sync/storage', () => ({
    useSession: () => shared.session,
    useIsDataReady: () => shared.isDataReady,
    isCopilotSession: (s: { metadata?: { flavor?: string } | null } | null | undefined) => s?.metadata?.flavor === 'copilot',
    isPlaceholderSession: (s: { metadata?: unknown } | null | undefined) => !!s && (s as { metadata?: unknown }).metadata === null,
}));

vi.mock('react-native', () => {
    const AnimatedValue = class {
        constructor(public value: number) {}
        setValue(v: number) { this.value = v; }
    };
    const timing = () => ({ start: vi.fn() });
    return {
        View: 'View',
        Text: 'Text',
        Animated: {
            Value: AnimatedValue,
            View: 'Animated.View',
            loop: () => ({ start: vi.fn() }),
            sequence: () => ({ start: vi.fn() }),
            timing,
        },
    };
});

vi.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
vi.mock('@/constants/Typography', () => ({ Typography: { default: () => ({}) } }));
vi.mock('@/components/Item', () => ({ Item: 'Item' }));
vi.mock('@/components/ItemGroup', () => ({ ItemGroup: 'ItemGroup' }));
vi.mock('@/components/ItemList', () => ({ ItemList: 'ItemList' }));
vi.mock('@/components/Avatar', () => ({ Avatar: 'Avatar' }));
vi.mock('@/components/CodeView', () => ({ CodeView: 'CodeView' }));
vi.mock('@/components/layout', () => ({ layout: { maxWidth: 800 } }));
vi.mock('react-native-unistyles', () => ({
    useUnistyles: () => ({ theme: { colors: new Proxy({}, { get: () => '#000' }) } }),
}));
vi.mock('expo-clipboard', () => ({ setStringAsync: vi.fn() }));
vi.mock('@/modal', () => ({ Modal: { alert: vi.fn() } }));
vi.mock('@/sync/ops', () => ({ sessionKill: vi.fn(), sessionDelete: vi.fn() }));
vi.mock('@/hooks/useWorktreeCleanup', () => ({ maybeCleanupWorktree: vi.fn() }));
vi.mock('@/text', () => ({ t: (key: string) => key }));
vi.mock('@/utils/versionUtils', () => ({ isVersionSupported: () => true, MINIMUM_CLI_VERSION: '1.0.0' }));
vi.mock('@/hooks/useHappyAction', () => ({ useHappyAction: (fn: unknown) => [false, fn] }));
vi.mock('@/hooks/useSessionQuickActions', () => ({
    useSessionQuickActions: () => ({
        archiveSession: vi.fn(),
        archivingSession: false,
        canShowResume: false,
        resumeSession: vi.fn(),
        resumeSessionSubtitle: '',
    }),
}));
vi.mock('@/utils/sessionUtils', () => ({
    getSessionName: () => 'Session',
    useSessionStatus: () => ({
        isConnected: false,
        statusDotColor: '#000',
        isPulsing: false,
        statusColor: '#000',
        statusText: 'offline',
    }),
    formatOSPlatform: (v: string) => v,
    formatPathRelativeToHome: (v: string) => v,
    getSessionAvatarId: () => 'avatar',
    getResumeCommand: () => null,
}));
vi.mock('@/utils/copySessionMetadataToClipboard', () => ({
    copySessionMetadataToClipboard: vi.fn(),
    copySessionMetadataAndLogsToClipboard: vi.fn(),
}));
vi.mock('@/utils/errors', () => ({ HappyError: class extends Error {} }));
vi.mock('@/utils/sessionInfoPermissionMode', () => ({ formatDangerouslySkipPermissionsMetadata: () => 'no' }));

const InfoScreen = (await import('./info')).default as unknown as React.ComponentType;

function createSession(flavor: string): TestSession {
    return {
        id: 'machine-1:session-1',
        seq: 3,
        createdAt: 100,
        updatedAt: 200,
        active: true,
        thinking: false,
        thinkingAt: 0,
        agentState: null,
        metadata: { flavor, host: 'devbox', path: '/repo', machineId: 'machine-1' },
    };
}

function itemTitles(renderer: ReturnType<typeof TestRenderer.create>): string[] {
    return renderer.root.findAllByType('Item')
        .map((node: { props: Record<string, unknown> }) => node.props.title)
        .filter((v: unknown): v is string => typeof v === 'string');
}

const MUTATION_TITLES = [
    'sessionInfo.plugins',
    'sessionInfo.skills',
    'sessionInfo.agents',
    'sessionInfo.deleteSession',
    'sessionInfo.copyMetadata',
    'sessionInfo.viewMachine',
];

describe('SessionInfo (M1a read-only Details)', () => {
    beforeEach(() => {
        shared.isDataReady = true;
        shared.routeId = 'session-1';
    });

    it('shows mutation quick actions plus Archive for a normal (codex) session', () => {
        shared.session = createSession('codex');
        let renderer!: ReturnType<typeof TestRenderer.create>;
        act(() => {
            renderer = TestRenderer.create(<InfoScreen />);
        });
        const titles = itemTitles(renderer);
        for (const title of MUTATION_TITLES) {
            expect(titles).toContain(title);
        }
        expect(titles).toContain('sessionInfo.archiveSession');
    });

    it('hides every mutation quick action but keeps Archive for a Copilot mirror', () => {
        shared.session = createSession('copilot');
        let renderer!: ReturnType<typeof TestRenderer.create>;
        act(() => {
            renderer = TestRenderer.create(<InfoScreen />);
        });
        const titles = itemTitles(renderer);
        for (const title of MUTATION_TITLES) {
            expect(titles).not.toContain(title);
        }
        expect(titles).toContain('sessionInfo.archiveSession');
    });

    it('makes the Happy session id row non-interactive (no copy) for a Copilot mirror', () => {
        shared.session = createSession('copilot');
        let renderer!: ReturnType<typeof TestRenderer.create>;
        act(() => {
            renderer = TestRenderer.create(<InfoScreen />);
        });
        const idItem = renderer.root.findAllByType('Item')
            .find((node: { props: Record<string, unknown> }) => node.props.title === 'sessionInfo.happySessionId');
        expect(idItem).toBeDefined();
        expect(idItem!.props.onPress).toBeUndefined();
        expect(idItem!.props.showChevron).toBe(false);
    });

    it('renders a non-interactive loading state for an unknown placeholder session', () => {
        shared.session = { ...createSession('codex'), metadata: null };
        let renderer!: ReturnType<typeof TestRenderer.create>;
        act(() => {
            renderer = TestRenderer.create(<InfoScreen />);
        });
        expect(renderer.root.findAllByType('Item')).toHaveLength(0);
        expect(JSON.stringify(renderer.toJSON())).toContain('common.loading');
    });
});
