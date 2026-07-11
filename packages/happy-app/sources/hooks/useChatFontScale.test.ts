import { beforeEach, describe, expect, it, vi } from 'vitest';

const testState = vi.hoisted(() => ({
    persistedScale: 1,
    liveMultiplierRef: { value: 1 },
    isActiveRef: { value: false },
    chatScaleLiveContextRef: null as unknown,
    animatedStyleDeps: [] as unknown[][],
}));

vi.mock('react', async (importActual) => {
    const actual = await importActual<typeof import('react')>();
    return {
        ...actual,
        useContext: (ctx: unknown) => {
            if (ctx === testState.chatScaleLiveContextRef) {
                return {
                    liveMultiplier: testState.liveMultiplierRef,
                    isActive: testState.isActiveRef,
                };
            }

            return null;
        },
        useMemo: <T>(factory: () => T) => factory(),
    };
});

vi.mock('@/components/ChatScaleLiveContext', async (importActual) => {
    const actual = await importActual<typeof import('@/components/ChatScaleLiveContext')>();
    testState.chatScaleLiveContextRef = actual.ChatScaleLiveContext;
    return actual;
});

vi.mock('@/sync/storage', () => ({
    useLocalSetting: (_name: string) => testState.persistedScale,
}));

vi.mock('react-native-reanimated', () => ({
    useAnimatedStyle: (factory: () => object, deps?: unknown[]) => {
        testState.animatedStyleDeps.push(deps ?? []);
        return factory();
    },
}));

import {
    useChatFontScale,
    useChatFontScaleOverride,
    useChatScaleAnimatedTextStyle,
    useChatScaledStyles,
} from './useChatFontScale';

function setup(persistedScale: number, liveMultiplier: number) {
    testState.persistedScale = persistedScale;
    testState.liveMultiplierRef.value = liveMultiplier;
    testState.isActiveRef.value = liveMultiplier !== 1;
}

beforeEach(() => {
    setup(1, 1);
    testState.animatedStyleDeps = [];
});

describe('useChatFontScale', () => {
    it('returns persistedScale only, ignoring the live multiplier', () => {
        setup(1.2, 1.5);
        expect(useChatFontScale()).toBeCloseTo(1.2, 9);
    });

    it('returns null override when persistedScale is 1.0', () => {
        setup(1.0, 1.5);
        expect(useChatFontScaleOverride(10, 20)).toBe(null);
    });

    it('scales static styles by persistedScale only', () => {
        setup(1.2, 1.5);
        const result = useChatScaledStyles({ body: { fontSize: 10, lineHeight: 20 } });
        expect(result.body.fontSize).toBeCloseTo(12, 9);
        expect(result.body.lineHeight).toBeCloseTo(24, 9);
    });

    it('computes animated text fontSize and lineHeight at live multiplier 1.0', () => {
        setup(1.2, 1.0);
        const style = useChatScaleAnimatedTextStyle(10, 20);
        expect(style.fontSize).toBeCloseTo(12, 9);
        expect(style.lineHeight).toBeCloseTo(24, 9);
    });

    it('computes animated text fontSize and lineHeight at live multiplier 1.5', () => {
        setup(1.2, 1.5);
        const style = useChatScaleAnimatedTextStyle(10, 20);
        expect(style.fontSize).toBeCloseTo(18, 9);
        expect(style.lineHeight).toBeCloseTo(36, 9);
    });

    it('omits fontSize when the base is unresolved (web unistyles) instead of hiding text with 0', () => {
        // On web, react-native-unistyles resolves styles to opaque CSS-class markers,
        // so StyleSheet.flatten(baseStyle).fontSize is undefined; callers may coerce
        // that to 0 via `?? 0`. The hook must never emit a text-hiding `fontSize: 0` —
        // it should leave the property off so the base class font-size survives.
        setup(1.2, 1.0);

        const undefinedBase = useChatScaleAnimatedTextStyle(undefined, undefined);
        expect(undefinedBase.fontSize).toBeUndefined();
        expect(undefinedBase.lineHeight).toBeUndefined();

        const zeroBase = useChatScaleAnimatedTextStyle(0, 24);
        expect(zeroBase.fontSize).toBeUndefined();
        // A resolvable lineHeight is still scaled so the base line box is preserved.
        expect(zeroBase.lineHeight).toBeCloseTo(28.8, 9);
    });

    it('still scales a positive base fontSize so the native path is unchanged', () => {
        setup(1.2, 1.0);
        const style = useChatScaleAnimatedTextStyle(16, 24);
        expect(style.fontSize).toBeCloseTo(19.2, 9);
        expect(style.lineHeight).toBeCloseTo(28.8, 9);
    });

    it('captures persistedScale in the deps array while keeping the live shared value stable', () => {
        setup(1.2, 1.0);
        useChatScaleAnimatedTextStyle(10, 20);

        setup(0.9, 1.0);
        useChatScaleAnimatedTextStyle(10, 20);

        expect(testState.animatedStyleDeps).toHaveLength(2);
        expect(testState.animatedStyleDeps[0]).toEqual([10, 20, 1.2, testState.liveMultiplierRef]);
        expect(testState.animatedStyleDeps[1]).toEqual([10, 20, 0.9, testState.liveMultiplierRef]);
    });
});
