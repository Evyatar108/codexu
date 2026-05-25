import * as React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import type { TreeSessionRowData } from '@/sync/storage';
import { beforeEach, describe, expect, it, vi } from 'vitest';

(
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const theme = {
    colors: {
        groupped: { background: '#f0f0f0', sectionTitle: '#000' },
        surface: '#fff',
        surfaceSelected: '#e0e0e0',
        textSecondary: '#8E8E93',
        text: '#000',
        divider: '#ccc',
        gitAddedText: '#34C759',
        gitRemovedText: '#FF3B30',
        status: { error: '#FF3B30' },
        shadow: { color: '#000', opacity: 0.1 },
    },
};

const expansionMock = vi.hoisted(() => ({
    expanded: {} as Record<string, true>,
    toggle: vi.fn(),
}));

vi.mock('react-native', () => ({
    View: 'View',
    Pressable: 'Pressable',
    Platform: { OS: 'web', select: (s: any) => s.default ?? s.ios },
    StyleSheet: { hairlineWidth: 1 },
}));

vi.mock('react-native-unistyles', () => ({
    StyleSheet: {
        create: (factory: (t: typeof theme) => Record<string, unknown>) => factory(theme),
        hairlineWidth: 1,
    },
    useUnistyles: () => ({ theme }),
}));

vi.mock('react-native-gesture-handler', () => ({
    Swipeable: 'Swipeable',
}));

vi.mock('@expo/vector-icons', () => ({
    Ionicons: 'Ionicons',
    MaterialCommunityIcons: 'MaterialCommunityIcons',
}));

vi.mock('@/components/StyledText', () => ({
    Text: ({ children, ...props }: React.PropsWithChildren<Record<string, unknown>>) =>
        React.createElement('Text', props, children),
}));

vi.mock('@/components/Avatar', () => ({
    Avatar: 'Avatar',
}));

vi.mock('./StatusDot', () => ({
    StatusDot: 'StatusDot',
}));

vi.mock('@/sync/storage', () => ({
    useAllMachines: () => [],
    useSession: () => null,
    useSessionProjectGitStatus: () => null,
    useSessionGitStatus: () => null,
    useSettingMutable: () => [[], () => {}],
}));

vi.mock('@/utils/sessionUtils', () => ({
    formatPathRelativeToHome: (p: string) => p,
    vibingMessages: [],
    formatLastSeen: () => '',
}));

vi.mock('@/utils/worktree', () => ({
    isWorktreePath: () => false,
    getRepoPath: (p: string) => p,
    getWorktreeName: () => null,
}));

vi.mock('@/hooks/useNavigateToSession', () => ({
    useNavigateToSession: () => () => {},
}));

vi.mock('./SessionActionsPopover', () => ({
    SessionActionsPopover: 'SessionActionsPopover',
}));

vi.mock('@/hooks/useSessionQuickActions', () => ({
    useSessionActionAlert: () => () => {},
    useSessionQuickActions: () => ({ archiveSession: () => {}, archivingSession: false }),
}));

vi.mock('@/hooks/useNewSessionDraft', () => ({
    useNewSessionDraft: () => ({
        setMachineId: () => {},
        setPath: () => {},
        setSessionType: () => {},
        setWorktreeKey: () => {},
    }),
}));

vi.mock('@/hooks/useSessionTreeExpansion', () => ({
    useSessionTreeExpansion: (selector: any) => selector({
        expanded: expansionMock.expanded,
        toggle: expansionMock.toggle,
    }),
}));

vi.mock('expo-router', () => ({
    useRouter: () => ({ navigate: () => {}, push: () => {} }),
}));

vi.mock('@/constants/Typography', () => ({
    Typography: { default: () => ({}) },
}));

vi.mock('@/text', () => ({
    t: (key: string) => key,
}));

const { ActiveSessionsGroupCompact } = await import('./ActiveSessionsGroupCompact');

type TestNode = {
    props: Record<string, any>;
    findByType: (type: string) => TestNode;
};

function makeSession(overrides: Partial<TreeSessionRowData>): TreeSessionRowData {
    return {
        id: 'session-1',
        machineId: 'machine-1',
        machineName: 'machine-1',
        path: '/repo',
        homeDir: '/home/user',
        name: 'Session',
        subtitle: '',
        flavor: null,
        active: true,
        state: 'waiting',
        hasDraft: false,
        avatarId: 'avatar-1',
        completedTodosCount: 0,
        totalTodosCount: 0,
        depth: 0,
        hasChildren: false,
        ...overrides,
    };
}

function render(sessions: TreeSessionRowData[]) {
    let renderer: ReturnType<typeof TestRenderer.create> | null = null;
    act(() => {
        renderer = TestRenderer.create(
            React.createElement(ActiveSessionsGroupCompact, { sessions })
        );
    });
    return renderer as ReturnType<typeof TestRenderer.create>;
}

function textRows(tree: ReturnType<typeof TestRenderer.create>, names: string[]) {
    return tree.root
        .findAllByType('Text')
        .map((node: TestNode) => node.props.children)
        .filter((child: unknown): child is string => typeof child === 'string' && names.includes(child));
}

describe('ActiveSessionsGroupCompact DFS order', () => {
    beforeEach(() => {
        expansionMock.expanded = {};
        expansionMock.toggle.mockClear();
    });

    it('preserves builder DFS pre-order within a machine and project block', () => {
        const sessions = [
            makeSession({ id: 'parent', name: 'Parent', createdAt: 1, depth: 0, hasChildren: true }),
            makeSession({ id: 'child', name: 'Child', createdAt: 999, depth: 1 }),
            makeSession({ id: 'sibling', name: 'Sibling', createdAt: 500, depth: 0 }),
        ];

        const tree = render(sessions);

        expect(textRows(tree, ['Parent', 'Child', 'Sibling'])).toEqual(['Parent', 'Child', 'Sibling']);
    });

    it('renders compact row tree controls with indent and stopped propagation', () => {
        expansionMock.expanded = { parent: true };
        const tree = render([
            makeSession({ id: 'parent', name: 'Parent', depth: 2, hasChildren: true }),
        ]);

        const row = tree.root.findAllByType('Pressable').find((node: TestNode) => {
            const style = node.props.style;
            return Array.isArray(style) && style.some((entry: any) => entry?.paddingLeft === 56);
        });
        expect(row?.props.style).toContainEqual({ paddingLeft: 56, paddingRight: 16 });

        const toggle = tree.root.findByProps({ testID: 'compact-session-tree-toggle-parent' });
        const chevron = toggle.findByType('Ionicons');
        expect(chevron.props.name).toBe('chevron-down');

        const stopPropagation = vi.fn();
        act(() => {
            toggle.props.onPress({ stopPropagation });
        });
        expect(stopPropagation).toHaveBeenCalledOnce();
        expect(expansionMock.toggle).toHaveBeenCalledWith('parent');
    });

    it('uses disconnected title styling for inactive children in the active aggregate', () => {
        const tree = render([
            makeSession({ id: 'inactive-child', name: 'Inactive child', active: false, state: 'waiting', depth: 1 }),
        ]);

        const title = tree.root.findAllByType('Text').find((node: TestNode) => node.props.children === 'Inactive child');
        expect(title?.props.style).toContainEqual({ color: theme.colors.textSecondary });
    });
});
