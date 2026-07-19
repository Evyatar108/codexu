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
    nestedStepCount: 0,
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
    countNestedSteps: () => shared.nestedStepCount,
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

function nestedUserTextChild(): Message {
    return {
        kind: 'user-text',
        id: 'child-1',
        localId: null,
        createdAt: 101,
        text: 'nested answer',
        displayText: 'nested answer',
        meta: undefined,
    } as unknown as Message;
}

function toolCallMessage(children: Message[] = []): Message {
    return {
        kind: 'tool-call',
        id: 'tool-1',
        localId: null,
        createdAt: 100,
        seq: 1,
        tool: {
            name: 'AskUserQuestion',
            state: 'running',
            input: {},
            permission: { id: 'perm-1', status: 'pending' },
        },
        children,
        meta: undefined,
    } as unknown as Message;
}

function renderMessageView(metadata: Metadata | null, onFork?: () => void) {
    return renderMessage(userTextMessage(), metadata, onFork);
}

function renderMessage(message: Message, metadata: Metadata | null, onFork?: () => void) {
    let renderer: ReturnType<typeof TestRenderer.create>;
    act(() => {
        renderer = TestRenderer.create(
            React.createElement(MessageView, {
                message,
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
        shared.nestedStepCount = 0;
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

    it('withholds the actionable sessionId from ToolView for a Copilot mirror (permission/AskUserQuestion cannot steer) while still rendering it', () => {
        const renderer = renderMessage(toolCallMessage(), { flavor: 'copilot' } as Metadata);
        const toolViews = renderer.root.findAllByType('ToolView' as never);
        expect(toolViews.length).toBe(1);
        // Display preserved (ToolView present) but no actionable sessionId → the
        // permission footer (Allow/Deny/Abort) and AskUserQuestion Submit are inert.
        expect(toolViews[0].props.sessionId).toBeUndefined();
    });

    it('passes the live sessionId to ToolView for a normal (claude) session (controls remain active)', () => {
        const renderer = renderMessage(toolCallMessage(), { flavor: 'claude' } as Metadata);
        const toolViews = renderer.root.findAllByType('ToolView' as never);
        expect(toolViews.length).toBe(1);
        expect(toolViews[0].props.sessionId).toBe('session-1');
    });

    it('threads readOnly into nested tool-call children for a Copilot mirror (nested body loses option-send + session id)', () => {
        shared.nestedStepCount = 1;
        const renderer = renderMessage(toolCallMessage([nestedUserTextChild()]), { flavor: 'copilot' } as Metadata);
        const markdown = renderer.root.findAllByType('MarkdownView' as never);
        expect(markdown.length).toBeGreaterThan(0);
        for (const node of markdown) {
            expect(node.props.onOptionPress).toBeUndefined();
            expect(node.props.sessionId).toBeUndefined();
        }
    });

    it('keeps nested tool-call children fully interactive for a normal (claude) session', () => {
        shared.nestedStepCount = 1;
        const renderer = renderMessage(toolCallMessage([nestedUserTextChild()]), { flavor: 'claude' } as Metadata);
        const markdown = renderer.root.findAllByType('MarkdownView' as never);
        expect(markdown.length).toBeGreaterThan(0);
        expect(markdown[0].props.onOptionPress).toBeTypeOf('function');
        expect(markdown[0].props.sessionId).toBe('session-1');
    });
});
