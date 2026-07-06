/**
 * R8 stage3 (catalogue HA-9): the MessageView command/goal-chip toggle.
 *
 * Operator decision #3 ("KEEP BOTH") restored upstream's slash-command / goal
 * chip rendering + fork-from-message long-press as an OPT-IN path behind the
 * `messageCommandChips` local setting whose DEFAULT preserves the fork's flat
 * e-ink user-message band. These assertions pin that contract: the default is
 * OFF (behavior-identical to the pre-R8 fork), and flipping it ON selects the
 * upstream chip rendering. The fork's composer-side pre-send intercept is a
 * separate mechanism and is unaffected either way.
 */
import * as React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';
import {
    LocalSettingsSchema,
    localSettingsDefaults,
    localSettingsParse,
} from '../sync/localSettings';

(
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const settingState = vi.hoisted(() => ({ messageCommandChips: false }));

const themeValue = new Proxy({}, {
    get: () => themeValue,
    apply: () => '#000',
}) as unknown as string;

vi.mock('react-native', () => ({
    Text: 'Text',
    View: 'View',
    Pressable: 'Pressable',
    Platform: { OS: 'web' },
}));

vi.mock('@expo/vector-icons', () => ({ Octicons: 'Octicons', Ionicons: 'Ionicons' }));

vi.mock('react-native-unistyles', () => ({
    StyleSheet: {
        create: (factory: (theme: unknown) => Record<string, unknown>) => factory({ colors: themeValue }),
    },
    useUnistyles: () => ({ theme: { colors: themeValue } }),
}));

vi.mock('@/constants/Typography', () => ({
    Typography: { default: () => ({}) },
}));

vi.mock('@/text', () => ({
    t: (key: string) => key,
}));

vi.mock('./markdown/MarkdownView', () => ({
    MarkdownView: 'MarkdownView',
}));

vi.mock('./markdown/skillBody', () => ({
    isSkillBodyMessage: () => false,
}));

vi.mock('./tools/ToolView', () => ({
    ToolView: 'ToolView',
}));

vi.mock('./StyledText', () => ({
    AnimatedText: 'AnimatedText',
    Text: 'Text',
}));

vi.mock('@/hooks/useChatFontScale', () => ({
    useChatScaleAnimatedTextStyle: () => ({}),
}));

vi.mock('./BoundaryDivider', () => ({
    BoundaryDivider: 'BoundaryDivider',
}));

vi.mock('@/sync/sync', () => ({
    sync: { sendMessage: vi.fn() },
}));

vi.mock('@/sync/storage', () => ({
    useLocalSetting: (key: string) =>
        (key === 'messageCommandChips' ? settingState.messageCommandChips : false),
}));

const { MessageView } = await import('./MessageView');

function makeGoalMessage(overrides: Record<string, unknown> = {}) {
    return {
        kind: 'user-text' as const,
        id: 'msg-goal',
        localId: null,
        createdAt: 0,
        seq: 1,
        text: '/goal do the thing',
        ...overrides,
    };
}

function renderMessage(message: unknown, metadata: unknown = null) {
    let renderer!: ReturnType<typeof TestRenderer.create>;
    act(() => {
        renderer = TestRenderer.create(
            <MessageView
                message={message as never}
                metadata={metadata as never}
                sessionId="s1"
                chatBodyWidth={undefined}
            />
        );
    });
    return renderer;
}

function textChildren(renderer: ReturnType<typeof TestRenderer.create>): string[] {
    return renderer.root.findAllByType('Text').map(
        (node: { children: unknown }) => (Array.isArray(node.children) ? node.children.join('') : String(node.children))
    );
}

describe('messageCommandChips local setting (R8 stage3 / HA-9)', () => {
    it('defaults to false — the fork behavior-preserving flat e-ink band', () => {
        expect(localSettingsDefaults.messageCommandChips).toBe(false);
    });

    it('schema accepts a boolean', () => {
        expect(LocalSettingsSchema.shape.messageCommandChips.parse(true)).toBe(true);
        expect(LocalSettingsSchema.shape.messageCommandChips.parse(false)).toBe(false);
    });

    it('localSettingsParse falls back to false when the key is absent', () => {
        expect(localSettingsParse({}).messageCommandChips).toBe(false);
    });

    it('localSettingsParse round-trips an explicit true selection', () => {
        expect(localSettingsParse({ messageCommandChips: true }).messageCommandChips).toBe(true);
    });
});

describe('MessageView command/goal chips (R8 stage3 / HA-9)', () => {
    it('DEFAULT (OFF): renders the raw user text in a flat band, no goal chip', () => {
        settingState.messageCommandChips = false;
        const tree = renderMessage(makeGoalMessage());

        const markdown = tree.root.findAllByType('MarkdownView');
        expect(markdown).toHaveLength(1);
        // Flat band renders the raw text verbatim (no command parsing).
        expect(markdown[0].props.markdown).toBe('/goal do the thing');
        // No "Sent as goal" caption and no long-press bubble.
        expect(textChildren(tree)).not.toContain('message.sentAsGoal');
        expect(tree.root.findAllByType('Pressable')).toHaveLength(0);
    });

    it('ON: selects the upstream goal-run chip (parsed goal + "Sent as goal")', () => {
        settingState.messageCommandChips = true;
        const tree = renderMessage(makeGoalMessage());

        const markdown = tree.root.findAllByType('MarkdownView');
        expect(markdown).toHaveLength(1);
        // Goal-run chip renders the extracted goal, not the raw "/goal …" text.
        expect(markdown[0].props.markdown).toBe('do the thing');
        expect(textChildren(tree)).toContain('message.sentAsGoal');
        // Upstream bubble is a long-press Pressable.
        expect(tree.root.findAllByType('Pressable').length).toBeGreaterThan(0);
    });

    it('ON: fork-from-message long-press stays inert until a parent provides the callback', () => {
        settingState.messageCommandChips = true;
        const tree = renderMessage(makeGoalMessage());

        // No onForkFromUserMessage prop is threaded (deferred to R8 stage 5), so
        // canFork is false and the Pressable exposes no onLongPress handler.
        const pressables = tree.root.findAllByType('Pressable');
        expect(pressables.length).toBeGreaterThan(0);
        expect(pressables.every((p: { props: { onLongPress?: unknown } }) => p.props.onLongPress === undefined)).toBe(true);
    });
});
