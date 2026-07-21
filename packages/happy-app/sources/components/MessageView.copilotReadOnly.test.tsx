import * as React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MessageView } from './MessageView';
import { AskUserQuestionView } from './tools/views/AskUserQuestionView';
import type { Message } from '@/sync/typesMessage';
import type { Metadata } from '@/sync/storageTypes';
import type { ToolCall } from '@/sync/typesMessage';

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
    TouchableOpacity: 'TouchableOpacity',
    ActivityIndicator: 'ActivityIndicator',
    StyleSheet: {
        flatten: () => ({}),
    },
}));

vi.mock('react-native-unistyles', () => ({
    StyleSheet: {
        create: () => new Proxy({}, { get: () => ({}) }),
    },
    useUnistyles: () => ({ theme: { colors: { button: { primary: { tint: '#fff' } } } } }),
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

vi.mock('./tools/ToolSectionView', () => ({
    ToolSectionView: 'ToolSectionView',
}));

vi.mock('@/sync/ops', () => ({
    sessionAllow: vi.fn(),
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

/**
 * AskUserQuestion read-only rendering for Copilot mirrors. A read-only mirror
 * passes no actionable sessionId, so the prompt must be fully observable
 * (question / header / option label / option description text) while every
 * option control is disabled, Submit is absent, and a tap cannot mutate the
 * local selection. A session with a live sessionId stays fully interactive.
 */
const SUBMIT_KEY = 'tools.askUserQuestion.submit';

function askUserQuestionTool(): ToolCall {
    return {
        name: 'AskUserQuestion',
        state: 'running',
        input: {
            questions: [
                {
                    question: 'Which color do you prefer?',
                    header: 'COLOR',
                    multiSelect: false,
                    options: [
                        { label: 'Crimson', description: 'a warm red' },
                        { label: 'Cerulean', description: 'a cool blue' },
                    ],
                },
            ],
        },
        permission: { id: 'perm-ask-1', status: 'pending' },
    } as unknown as ToolCall;
}

function renderAskUserQuestion(sessionId: string | undefined) {
    let renderer: ReturnType<typeof TestRenderer.create>;
    act(() => {
        renderer = TestRenderer.create(
            React.createElement(AskUserQuestionView, {
                tool: askUserQuestionTool(),
                metadata: null,
                messages: [],
                sessionId,
            }),
        );
    });
    return renderer!;
}

function animatedTexts(renderer: ReturnType<typeof TestRenderer.create>): string[] {
    return renderer.root.findAllByType('AnimatedText' as never).map((node: { props: { children: unknown } }) => {
        const children = node.props.children;
        return Array.isArray(children) ? children.join('') : String(children);
    });
}

function countViews(renderer: ReturnType<typeof TestRenderer.create>): number {
    return renderer.root.findAllByType('View' as never).length;
}

describe('AskUserQuestion read-only rendering for Copilot mirrors', () => {
    beforeEach(() => {
        reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
    });

    it('keeps all question/option/description content visible for a Copilot mirror (no sessionId)', () => {
        const renderer = renderAskUserQuestion(undefined);
        const texts = animatedTexts(renderer);
        expect(texts).toContain('COLOR');
        expect(texts).toContain('Which color do you prefer?');
        expect(texts).toContain('Crimson');
        expect(texts).toContain('a warm red');
        expect(texts).toContain('Cerulean');
        expect(texts).toContain('a cool blue');
    });

    it('disables every option control and offers no Submit for a Copilot mirror (no sessionId)', () => {
        const renderer = renderAskUserQuestion(undefined);
        const touchables = renderer.root.findAllByType('TouchableOpacity' as never);
        // Only the two option buttons render; the Submit action is gated out.
        expect(touchables.length).toBe(2);
        for (const touchable of touchables) {
            expect(touchable.props.disabled).toBe(true);
        }
        expect(animatedTexts(renderer)).not.toContain(SUBMIT_KEY);
    });

    it('does not mutate local selection when a Copilot mirror option is tapped (no sessionId)', () => {
        const renderer = renderAskUserQuestion(undefined);
        const before = countViews(renderer);
        const firstOption = renderer.root.findAllByType('TouchableOpacity' as never)[0];
        act(() => {
            firstOption.props.onPress();
        });
        // Selection would add the radio dot + selected accent; the read-only
        // guard must leave the tree unchanged.
        expect(countViews(renderer)).toBe(before);
        expect(animatedTexts(renderer)).not.toContain(SUBMIT_KEY);
    });

    it('stays fully interactive for a normal session with a live sessionId', () => {
        const renderer = renderAskUserQuestion('session-1');
        const touchables = renderer.root.findAllByType('TouchableOpacity' as never);
        // Option buttons render before Submit and are enabled.
        expect(touchables[0].props.disabled).toBe(false);
        expect(touchables[1].props.disabled).toBe(false);
        // Submit is present for an interactive session.
        expect(animatedTexts(renderer)).toContain(SUBMIT_KEY);

        const before = countViews(renderer);
        act(() => {
            touchables[0].props.onPress();
        });
        // Selecting the option adds the radio dot + selected accent views.
        expect(countViews(renderer)).toBeGreaterThan(before);
    });
});
