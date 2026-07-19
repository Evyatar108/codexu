import * as React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Machine, Session } from '@/sync/storageTypes';

type TestRendererInstance = ReturnType<typeof TestRenderer.create>;
type TestRoot = TestRendererInstance['root'];
type RenderNode = { props: Record<string, any>; findAllByType: (type: string) => RenderNode[] };

const reactActEnvironment = globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT?: boolean;
};

const shared = vi.hoisted(() => ({
    routerReplaceMock: vi.fn(),
    machineSpawnSessionFromSessionMock: vi.fn(),
    refreshSessionsMock: vi.fn(),
    sendMessageMock: vi.fn(),
    modalAlertMock: vi.fn(),
    session: null as Session | null,
    machine: null as Machine | null,
    routeId: 'machine-1:parent-session',
    calls: [] as string[],
}));

const theme = {
    colors: {
        header: { background: '#ffffff', tint: '#111111' },
        input: { background: '#f4f4f4' },
        divider: '#dddddd',
        text: '#111111',
        textSecondary: '#666666',
        button: {
            primary: {
                background: '#111111',
                disabled: '#cccccc',
                tint: '#ffffff',
            },
        },
    },
};

vi.mock('react-native', () => ({
    ActivityIndicator: (props: Record<string, unknown>) => React.createElement('ActivityIndicator', props),
    Platform: { OS: 'web', select: (options: Record<string, unknown>) => options.web ?? options.default },
    Pressable: ({ children, style, ...props }: React.PropsWithChildren<Record<string, unknown>>) =>
        React.createElement('Pressable', { ...props, style: typeof style === 'function' ? style({ pressed: false }) : style }, children),
    ScrollView: ({ children, ...props }: React.PropsWithChildren<Record<string, unknown>>) =>
        React.createElement('ScrollView', props, children),
    Text: ({ children, ...props }: React.PropsWithChildren<Record<string, unknown>>) =>
        React.createElement('Text', props, children),
    TextInput: (props: Record<string, unknown>) => React.createElement('TextInput', props),
    View: ({ children, ...props }: React.PropsWithChildren<Record<string, unknown>>) =>
        React.createElement('View', props, children),
}));

vi.mock('@expo/vector-icons', () => ({
    Ionicons: (props: Record<string, unknown>) => React.createElement('Ionicon', props),
    Octicons: (props: Record<string, unknown>) => React.createElement('Octicon', props),
}));

vi.mock('expo-router', () => ({
    useLocalSearchParams: () => ({ id: shared.routeId }),
    useRouter: () => ({ replace: shared.routerReplaceMock }),
}));

vi.mock('react-native-unistyles', () => ({
    StyleSheet: { create: (factory: (themeArg: typeof theme) => Record<string, unknown>) => factory(theme) },
    useUnistyles: () => ({ theme }),
}));

vi.mock('@/components/layout', () => ({
    layout: { maxWidth: 800 },
}));

vi.mock('@/constants/Typography', () => ({
    Typography: { default: () => ({}) },
}));

vi.mock('@/components/pickers', () => ({
    PickerContent: ({ children, ...props }: React.PropsWithChildren<Record<string, unknown>>) =>
        React.createElement('PickerContent', props, children),
}));

vi.mock('@/modal', () => ({
    Modal: { alert: shared.modalAlertMock },
}));

vi.mock('@/sync/ops', () => ({
    machineSpawnSessionFromSession: shared.machineSpawnSessionFromSessionMock,
}));

vi.mock('@/sync/sync', () => ({
    sync: {
        refreshSessions: shared.refreshSessionsMock,
        sendMessage: shared.sendMessageMock,
    },
}));

vi.mock('@/sync/storage', () => ({
    useAllMachines: () => shared.machine ? [shared.machine] : [],
    useSession: () => shared.session,
    isCopilotSession: (s: { metadata?: { flavor?: string } | null } | null | undefined) => s?.metadata?.flavor === 'copilot',
    isPlaceholderSession: (s: { metadata?: unknown } | null | undefined) => !!s && !s.metadata,
}));

vi.mock('@/text', () => ({
    t: (key: string, params?: Record<string, unknown>) => params?.name ? `translated:${key}:${params.name}` : `translated:${key}`,
}));

const { SpawnChildScreen } = await import('./spawn-child');
const SpawnChildGate = (await import('./spawn-child')).default as unknown as {
    type: () => React.ReactElement | null;
};

function createSession(): Session {
    return {
        id: 'machine-1:parent-session',
        seq: 1,
        createdAt: 100,
        updatedAt: 100,
        active: true,
        activeAt: 100,
        metadata: {
            path: '/repo/project',
            host: 'devbox',
            machineId: 'machine-1',
            flavor: 'codex',
            currentModelCode: 'gpt-5.5',
            currentPermissionModeCode: 'safe-yolo',
            currentThoughtLevelCode: 'high',
        },
        metadataVersion: 1,
        agentState: null,
        agentStateVersion: 1,
        thinking: true,
        thinkingAt: 100,
        presence: 'online',
        permissionModeUserChosen: false,
    };
}

function createMachine(): Machine {
    return {
        id: 'machine-1',
        seq: 1,
        createdAt: 100,
        updatedAt: 100,
        active: true,
        activeAt: Date.now(),
        metadata: {
            host: 'devbox',
            displayName: 'Devbox',
            platform: 'win32',
            happyCliVersion: '1.0.0',
            happyHomeDir: '/home/user/.happy',
            homeDir: '/home/user',
            cliAvailability: { claude: true, codex: true, gemini: true, openclaw: true, detectedAt: 100 },
        },
        metadataVersion: 1,
        daemonState: null,
        daemonStateVersion: 1,
    };
}

async function renderScreen(): Promise<TestRendererInstance> {
    let renderer: TestRendererInstance;
    await act(async () => {
        renderer = TestRenderer.create(<SpawnChildScreen />);
        await Promise.resolve();
    });
    return renderer!;
}

function textValues(root: RenderNode): string[] {
    return root.findAllByType('Text')
        .map((node: RenderNode) => node.props.children)
        .filter((value: unknown): value is string => typeof value === 'string');
}

function findPressableByText(root: TestRoot, text: string): RenderNode {
    const node = root.findAllByType('Pressable').find((candidate: RenderNode) => textValues(candidate).includes(text));
    if (!node) throw new Error(`Missing Pressable with text ${text}`);
    return node;
}

function findSubmit(root: TestRoot): RenderNode {
    const node = root.findAllByType('Pressable').find((candidate: RenderNode) => candidate.props.accessibilityLabel === 'translated:spawnChild.submit');
    if (!node) throw new Error('Missing Spawn child submit button');
    return node;
}

describe('SpawnChildScreen', () => {
    beforeEach(() => {
        reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
        shared.routerReplaceMock.mockReset();
        shared.machineSpawnSessionFromSessionMock.mockReset();
        shared.refreshSessionsMock.mockReset();
        shared.sendMessageMock.mockReset();
        shared.modalAlertMock.mockReset();
        shared.calls = [];
        shared.session = createSession();
        shared.machine = createMachine();
        shared.routeId = 'machine-1:parent-session';
        shared.machineSpawnSessionFromSessionMock.mockImplementation(async () => {
            shared.calls.push('spawn');
            return { type: 'success', sessionId: 'machine-1:child-session' };
        });
        shared.refreshSessionsMock.mockImplementation(async () => {
            shared.calls.push('refresh');
        });
        shared.sendMessageMock.mockImplementation(async () => {
            shared.calls.push('send');
        });
        shared.routerReplaceMock.mockImplementation(() => {
            shared.calls.push('replace');
        });
    });

    it('sends a non-empty initial message to the returned child session before navigating', async () => {
        const renderer = await renderScreen();

        await act(async () => {
            renderer.root.findByType('TextInput').props.onChangeText('continue here');
        });

        await act(async () => {
            findSubmit(renderer.root).props.onPress();
            await Promise.resolve();
            await Promise.resolve();
        });

        expect(shared.machineSpawnSessionFromSessionMock).toHaveBeenCalledWith('machine-1:parent-session', {
            agent: 'codex',
            model: 'gpt-5.5',
            permissionMode: 'safe-yolo',
            effortLevel: 'high',
            initialMessage: 'continue here',
        });
        expect(shared.machineSpawnSessionFromSessionMock.mock.calls[0][1]).not.toHaveProperty('path');
        expect(shared.calls).toEqual(['spawn', 'refresh', 'send', 'replace']);
        expect(shared.sendMessageMock).toHaveBeenCalledWith('machine-1:child-session', 'continue here', { source: 'new_session' });
        expect(shared.routerReplaceMock).toHaveBeenCalledWith('/session/machine-1:child-session');
    });

    it('does not send an empty initial message', async () => {
        const renderer = await renderScreen();

        await act(async () => {
            findSubmit(renderer.root).props.onPress();
            await Promise.resolve();
            await Promise.resolve();
        });

        expect(shared.machineSpawnSessionFromSessionMock).toHaveBeenCalledWith('machine-1:parent-session', expect.objectContaining({
            agent: 'codex',
            initialMessage: undefined,
        }));
        expect(shared.sendMessageMock).not.toHaveBeenCalled();
        expect(shared.routerReplaceMock).toHaveBeenCalledWith('/session/machine-1:child-session');
    });

    it('shows RPC errors without navigating', async () => {
        shared.machineSpawnSessionFromSessionMock.mockResolvedValue({ type: 'error', errorMessage: 'parent session not tracked' });
        const renderer = await renderScreen();

        await act(async () => {
            findSubmit(renderer.root).props.onPress();
            await Promise.resolve();
        });

        expect(shared.modalAlertMock).toHaveBeenCalledWith('translated:common.error', 'parent session not tracked');
        expect(shared.routerReplaceMock).not.toHaveBeenCalled();
        expect(shared.sendMessageMock).not.toHaveBeenCalled();
    });

    it('lets the user switch the agent picker before submit', async () => {
        const renderer = await renderScreen();

        await act(async () => {
            findPressableByText(renderer.root, 'translated:spawnChild.agents.codex').props.onPress();
        });
        await act(async () => {
            renderer.root.findByType('PickerContent').props.onSelect('claude');
        });
        await act(async () => {
            findSubmit(renderer.root).props.onPress();
            await Promise.resolve();
            await Promise.resolve();
        });

        expect(shared.machineSpawnSessionFromSessionMock).toHaveBeenCalledWith('machine-1:parent-session', expect.objectContaining({
            agent: 'claude',
        }));
    });
});

describe('SpawnChildScreenGate (M1a fail-closed)', () => {
    beforeEach(() => {
        shared.session = createSession();
    });

    it('renders the spawn screen for a normal (codex) session', () => {
        shared.session = createSession();
        expect(SpawnChildGate.type()).not.toBeNull();
    });

    it('fails closed (null) for a read-only Copilot mirror', () => {
        const copilot = createSession();
        copilot.metadata = { ...copilot.metadata!, flavor: 'copilot' };
        shared.session = copilot;
        expect(SpawnChildGate.type()).toBeNull();
    });

    it('fails closed (null) for an unknown placeholder session', () => {
        const placeholder = createSession();
        placeholder.metadata = null;
        shared.session = placeholder;
        expect(SpawnChildGate.type()).toBeNull();
    });
});
