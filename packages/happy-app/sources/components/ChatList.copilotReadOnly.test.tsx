import * as React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ChatList } from './ChatList';
import type { Session } from '@/sync/storageTypes';

/**
 * M1a: read-only Copilot mirrors must render through the flat path
 * (`ForkFlatChatList`), which routes every row through `MessageView` where the
 * read-only gating lives. The grouped Tool/AgentWork views render tool content
 * outside `MessageView` and would bypass that gating, so a Copilot mirror is
 * forced flat even when the `chatToolGrouping` setting is 'grouped'. Non-Copilot
 * sessions still honor the setting.
 */

const shared = vi.hoisted(() => ({
    chatToolGrouping: 'grouped' as 'grouped' | 'flat',
    isCopilot: false,
}));

vi.mock('@/sync/storage', () => ({
    storage: { getState: () => ({ sessionMessages: {} }) },
    useLocalSetting: () => shared.chatToolGrouping,
    useSession: vi.fn(),
    useSessionMessages: () => ({ messages: [] }),
    isCopilotSession: () => shared.isCopilot,
}));

vi.mock('@/sync/sync', () => ({ sync: {} }));

vi.mock('react-native', () => ({
    AppState: { addEventListener: vi.fn() },
    FlatList: 'FlatList',
    Platform: { OS: 'web' },
    Pressable: 'Pressable',
    View: 'View',
}));

vi.mock('react-native-unistyles', () => ({
    StyleSheet: { create: () => new Proxy({}, { get: () => ({}) }) },
    useUnistyles: () => ({ theme: {} }),
}));

vi.mock('react-native-safe-area-context', () => ({
    useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

vi.mock('@/utils/responsive', () => ({ useHeaderHeight: () => 0 }));
vi.mock('@/hooks/useChatWidth', () => ({ useChatWidth: () => ({ width: 300 }) }));
vi.mock('@/hooks/useGroupedMessages', () => ({ useGroupedMessages: () => [] }));
vi.mock('./MessageView', () => ({ MessageView: 'MessageView' }));
vi.mock('./ToolGroupView', () => ({ AgentWorkGroupView: 'AgentWorkGroupView', ToolGroupView: 'ToolGroupView' }));
vi.mock('./ChatFooter', () => ({ ChatFooter: 'ChatFooter' }));
vi.mock('@expo/vector-icons', () => ({ Octicons: 'Octicons' }));
vi.mock('@/fork/chat/ForkFlatChatList', () => ({ ForkFlatChatList: 'ForkFlatChatList' }));

function createSession(): Session {
    return { id: 'session-1', metadata: { path: '/r', host: 'h' } } as Session;
}

function renderDispatch(): React.ReactElement {
    const inner = (ChatList as unknown as { type: (props: { session: Session; messages?: unknown }) => React.ReactElement }).type;
    return inner({ session: createSession() });
}

describe('ChatList Copilot force-flat dispatch', () => {
    beforeEach(() => {
        shared.chatToolGrouping = 'grouped';
        shared.isCopilot = false;
    });

    it('routes a Copilot mirror to the flat list even when grouping is enabled', () => {
        shared.isCopilot = true;
        shared.chatToolGrouping = 'grouped';
        expect(renderDispatch().type).toBe('ForkFlatChatList');
    });

    it('routes a non-Copilot grouped session to the grouped (non-flat) path', () => {
        shared.isCopilot = false;
        shared.chatToolGrouping = 'grouped';
        expect(renderDispatch().type).not.toBe('ForkFlatChatList');
    });

    it('routes a non-Copilot session to the flat list when grouping is off', () => {
        shared.isCopilot = false;
        shared.chatToolGrouping = 'flat';
        expect(renderDispatch().type).toBe('ForkFlatChatList');
    });
});
