import * as React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MessageView } from './MessageView';
import type { Message } from '@/sync/typesMessage';
import type { Metadata } from '@/sync/storageTypes';

/**
 * M1a: Copilot mirror messages render truthfully read-only. The message body
 * must supply no option-send callback and no session id (which would scope
 * session-file/link actions), and must never offer fork-from-message. Tool and
 * result rendering stays intact for observation. Non-Copilot messages are
 * unchanged.
 */

const reactActEnvironment = globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT?: boolean;
};

const shared = vi.hoisted(() => ({
    sendMessageMock: vi.fn(),
    messageCommandChips: false,
}));

vi.mock('react-native', () => ({
    View: 'View',
    Text: 'Text',
    Pressable: 'Pressable',
}));

vi.mock('react-native-unistyles', () => ({
    StyleSheet: {
        create: () => new Proxy({}, { get: () => ({}) }),
    },
}));

vi.mock('@expo/vector-icons', () => ({
    Ionicons: 'Ionicons',
}));

vi.mock('./markdown/MarkdownView', () => ({
    MarkdownView: 'MarkdownView',
}));

vi.mock('./tools/ToolView', () => ({
    ToolView: 'ToolView',
}));

vi.mock('./markdown/skillBody', () => ({
    isSkillBodyMessage: () => false,
}));

vi.mock('./StyledText', () => ({
    AnimatedText: 'AnimatedText',
}));

vi.mock('@/hooks/useChatFontScale', () => ({
    useChatScaleAnimatedTextStyle: () => ({}),
}));

vi.mock('./BoundaryDivider', () => ({
    BoundaryDivider: 'BoundaryDivider',
}));

vi.mock('@/sync/storage', () => ({
    useLocalSetting: () => shared.messageCommandChips,
}));

vi.mock('@/sync/sync', () => ({
    sync: { sendMessage: shared.sendMessageMock },
}));

vi.mock('./parseLocalCommandMessage', () => ({
    parseLocalCommandMessage: (text: string) => ({ kind: 'text', text }),
    isUserSlashCommandEcho: () => false,
}));

vi.mock('../fork/message/einkMessageStyles', () => ({
    einkMessageStyles: new Proxy({}, { get: () => ({}) }),
}));

vi.mock('../fork/message/MessageAttachmentChips', () => ({
    MessageAttachmentChips: 'MessageAttachmentChips',
}));

vi.mock('../fork/message/nestedStepsCap', () => ({
    MAX_NESTED_CHILD_DEPTH: 3,
    countNestedSteps: () => 0,
}));

vi.mock('@/text', () => ({
    t: (key: string) => key,
}));

function userTextMessage(): Message {
    return {
        kind: 'user-text',
        id: 'm1',
        localId: null,
        createdAt: 100,
        text: 'hello',
        displayText: 'hello',
        meta: undefined,
    } as unknown as Message;
}

function renderMessageView(metadata: Metadata | null, onFork?: () => void) {
    let renderer: ReturnType<typeof TestRenderer.create>;
    act(() => {
        renderer = TestRenderer.create(
            React.createElement(MessageView, {
                message: userTextMessage(),
                metadata,
                sessionId: 'session-1',
                chatBodyWidth: 300,
                onForkFromUserMessage: onFork as never,
            }),
        );
    });
    return renderer!;
}

describe('MessageView Copilot read-only gating', () => {
    beforeEach(() => {
        reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
        shared.sendMessageMock.mockReset();
        shared.messageCommandChips = false;
    });

    it('renders the markdown body without option-send or session id for a Copilot mirror', () => {
        const renderer = renderMessageView({ flavor: 'copilot' } as Metadata, vi.fn());
        const markdown = renderer.root.findAllByType('MarkdownView' as never);
        expect(markdown.length).toBeGreaterThan(0);
        expect(markdown[0].props.onOptionPress).toBeUndefined();
        expect(markdown[0].props.sessionId).toBeUndefined();
    });

    it('wires option-send and session id for a normal (claude) session', () => {
        const renderer = renderMessageView({ flavor: 'claude' } as Metadata, vi.fn());
        const markdown = renderer.root.findAllByType('MarkdownView' as never);
        expect(markdown[0].props.onOptionPress).toBeTypeOf('function');
        expect(markdown[0].props.sessionId).toBe('session-1');
    });

    it('never renders a long-pressable fork bubble for a Copilot mirror when command chips are ON', () => {
        shared.messageCommandChips = true;
        const renderer = renderMessageView({ flavor: 'copilot' } as Metadata, vi.fn());
        const pressables = renderer.root.findAllByType('Pressable' as never);
        for (const pressable of pressables) {
            expect(pressable.props.onLongPress).toBeUndefined();
        }
    });
});
