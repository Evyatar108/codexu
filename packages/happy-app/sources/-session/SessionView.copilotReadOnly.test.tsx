import * as React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';

(
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const routerPush = vi.fn();
let agentInputProps: { onSend?: unknown } | null = null;

type TestSession = {
    id: string;
    active: boolean;
    activeAt: number;
    presence: string;
    metadata: { path?: string; flavor?: string; machineId?: string } | null;
    agentState: unknown;
    permissionModeUserChosen: boolean;
    permissionMode: unknown;
    modelMode: unknown;
    effortLevel: unknown;
    latestUsage: unknown;
};

const holder = {
    session: null as TestSession | null,
};

function createSession(flavor: string): TestSession {
    return {
        id: 'session-1',
        active: true,
        activeAt: Date.now(),
        presence: 'online',
        metadata: { path: '/repo', flavor, machineId: 'machine-1' },
        agentState: null,
        permissionModeUserChosen: false,
        permissionMode: null,
        modelMode: null,
        effortLevel: null,
        latestUsage: null,
    };
}

const themeValue = new Proxy({}, {
    get: () => themeValue,
    apply: () => '#000',
}) as unknown as string;

vi.mock('expo-router', () => ({
    useRouter: () => ({ push: routerPush, back: vi.fn(), replace: vi.fn() }),
}));

vi.mock('react-native', () => ({
    ActivityIndicator: 'ActivityIndicator',
    Platform: { OS: 'web', select: (values: Record<string, unknown>) => values.web ?? values.default },
    Pressable: 'Pressable',
    Text: 'Text',
    View: 'View',
    useWindowDimensions: () => ({ width: 1200, height: 800 }),
}));

vi.mock('react-native-reanimated', () => ({
    default: { View: 'AnimatedView' },
    Easing: { out: () => undefined, cubic: 'cubic' },
    useAnimatedStyle: (factory: () => unknown) => factory(),
    useSharedValue: (value: unknown) => ({ value }),
    withTiming: (value: unknown) => value,
}));

vi.mock('react-native-safe-area-context', () => ({
    useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

vi.mock('react-native-unistyles', () => ({
    StyleSheet: {
        hairlineWidth: 1,
        create: (factory: (theme: unknown) => Record<string, unknown>) => factory({
            colors: themeValue,
        }),
    },
    useUnistyles: () => ({ theme: { colors: themeValue } }),
}));

vi.mock('@expo/vector-icons', () => ({
    Ionicons: 'Ionicons',
}));

vi.mock('@/components/FilesSidebar', () => ({
    FilesSidebar: () => React.createElement('FilesSidebar'),
}));
vi.mock('@/components/AgentContentView', () => ({
    AgentContentView: (props: { input?: React.ReactNode; children?: React.ReactNode }) => React.createElement('AgentContentView', null, props.children, props.input),
}));
vi.mock('@/components/AgentInput', () => ({
    AgentInput: (props: typeof agentInputProps) => {
        agentInputProps = props;
        return React.createElement('AgentInput');
    },
}));
vi.mock('@/components/ChatHeaderView', () => ({ ChatHeaderView: 'ChatHeaderView' }));
vi.mock('@/components/ChatList', () => ({ ChatList: 'ChatList' }));
vi.mock('@/components/Deferred', () => ({ Deferred: ({ children }: { children: React.ReactNode }) => React.createElement(React.Fragment, null, children) }));
vi.mock('@/components/EmptyMessages', () => ({ EmptyMessages: 'EmptyMessages' }));
vi.mock('@/components/SessionActionsPopover', () => ({ SessionActionsPopover: 'SessionActionsPopover' }));
vi.mock('@/components/SessionContextDrawer', () => ({
    ResumeCommandCopyBlock: 'ResumeCommandCopyBlock',
    SessionContextDrawer: 'SessionContextDrawer',
}));
vi.mock('@/components/SidebarContext', () => ({ useSidebar: () => ({ isExpanded: false }) }));
vi.mock('@/components/diff/PierreDiffView', () => ({ prefetchPierreDiff: vi.fn() }));
vi.mock('@/components/modelModeOptions', () => ({
    getAvailableModels: () => [],
    getAvailablePermissionModes: () => [],
    getDefaultModelKey: () => 'default',
    getEffortLevelsForModel: () => [],
    getDefaultEffortKeyForModel: () => 'default',
    resolveCurrentOption: () => null,
    resolvePermissionModeForPicker: () => null,
}));
vi.mock('@/components/autocomplete/suggestions', () => ({ getSuggestions: () => [] }));
vi.mock('@/hooks/useChatWidth', () => ({ useChatWidth: () => 800 }));
vi.mock('@/hooks/useDraft', () => ({ useDraft: () => ({ clearDraft: vi.fn() }) }));
vi.mock('@/hooks/usePreSendCommand', () => ({ usePreSendCommand: () => () => ({ intercepted: false, execute: vi.fn() }) }));
vi.mock('@/hooks/useSessionQuickActions', () => ({ useSessionQuickActions: () => ({ canResume: false, resumeAvailability: null, resumeSession: vi.fn(), resumeSessionInline: vi.fn(), resumingSession: false }) }));
vi.mock('@/modal', () => ({ Modal: { alert: vi.fn() } }));
vi.mock('./composeBoundaryAdvisory', () => ({ shouldShowBoundaryAdvisory: () => false, updateComposeStartAt: (_current: unknown, _prev: string, next: string, now: number) => next ? now : null }));
vi.mock('@/sync/gitStatusSync', () => ({ gitStatusSync: { getSync: vi.fn(), invalidate: vi.fn() } }));
vi.mock('@/sync/ops', () => ({
    cancelPendingSwitch: vi.fn(),
    requestSwitch: vi.fn(),
    sessionAbort: vi.fn(),
    sessionEmitAgentConfiguration: vi.fn(),
    sessionWriteFile: vi.fn(),
}));
vi.mock('@/sync/storage', () => ({
    storage: { getState: () => ({}), applyLocalSettings: vi.fn() },
    useIsDataReady: () => true,
    useLatestBoundary: () => null,
    useLocalSetting: () => ({}),
    useLocalSettingMutable: () => [false, vi.fn()],
    useMachine: () => null,
    useRealtimeStatus: () => 'disconnected',
    useSession: () => holder.session,
    useSessionMessages: () => ({ messages: [], isLoaded: true }),
    useSessionOutputSnapshots: () => ({}),
    useSessionUsage: () => null,
    useSetting: (key: string) => key === 'fileDiffsSidebar',
    isReadOnlySession: (s: { metadata?: { flavor?: string } | null } | null | undefined) =>
        s?.metadata?.flavor === 'copilot' || (!!s && s.metadata === null),
    isPlaceholderSession: (s: { metadata?: unknown } | null | undefined) => !!s && (s as { metadata?: unknown }).metadata === null,
}));
vi.mock('@/sync/sync', () => ({
    generateLocalMessageId: vi.fn(),
    sync: { onSessionVisible: vi.fn(), onActiveSessionChanged: vi.fn(), sendMessage: vi.fn() },
}));
vi.mock('@/text', () => ({ t: (key: string) => key }));
vi.mock('@/track', () => ({ tracking: null }));
vi.mock('@/sync/persistence', () => ({ getVoiceMessageCount: () => 0, getVoiceOnboardingPromptLoadCount: () => 0 }));
vi.mock('@/utils/platform', () => ({ isRunningOnMac: () => false }));
vi.mock('@/utils/responsive', () => ({
    useDeviceType: () => 'desktop',
    useHeaderHeight: () => 0,
    useIsLandscape: () => false,
    useIsTablet: () => false,
}));
vi.mock('@/utils/sessionUtils', () => ({
    formatPathRelativeToHome: (path: string) => path,
    getResumeCommandBlock: () => null,
    getSessionAvatarId: () => 'avatar',
    getSessionMode: () => 'local',
    getSessionName: () => 'Session',
    useSessionStatus: () => ({ state: 'idle', statusText: '', statusColor: '#000', statusDotColor: '#000', isPulsing: false, isConnected: true }),
}));
vi.mock('@/utils/versionUtils', () => ({ isVersionSupported: () => true, MINIMUM_CLI_VERSION: '0.0.0' }));

const { SessionView } = await import('./SessionView');

function agentInputNodes(renderer: ReturnType<typeof TestRenderer.create>) {
    return renderer.root.findAllByType('AgentInput');
}

describe('SessionView M1a read-only gating', () => {
    beforeEach(() => {
        routerPush.mockReset();
        agentInputProps = null;
    });

    it('mounts the AgentInput composer for a normal (codex) session', async () => {
        holder.session = createSession('codex');
        let renderer!: ReturnType<typeof TestRenderer.create>;
        await act(async () => {
            renderer = TestRenderer.create(<SessionView id="session-1" />);
        });
        expect(agentInputNodes(renderer)).toHaveLength(1);
        expect(agentInputProps?.onSend).toBeTypeOf('function');
    });

    it('renders no composer (input === null) for a Copilot mirror session', async () => {
        holder.session = createSession('copilot');
        let renderer!: ReturnType<typeof TestRenderer.create>;
        await act(async () => {
            renderer = TestRenderer.create(<SessionView id="session-1" />);
        });
        expect(agentInputNodes(renderer)).toHaveLength(0);
        expect(agentInputProps).toBeNull();
    });

    it('renders no composer (input === null) for an unknown placeholder session', async () => {
        holder.session = { ...createSession('codex'), metadata: null };
        let renderer!: ReturnType<typeof TestRenderer.create>;
        await act(async () => {
            renderer = TestRenderer.create(<SessionView id="session-1" />);
        });
        expect(agentInputNodes(renderer)).toHaveLength(0);
        expect(agentInputProps).toBeNull();
    });
});
