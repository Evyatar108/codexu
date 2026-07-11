import * as React from 'react';
import type { TextStyle } from 'react-native';
import { useAnimatedStyle } from 'react-native-reanimated';
import { ChatScaleLiveContext } from '@/components/ChatScaleLiveContext';
import { useLocalSetting } from '@/sync/storage';

export const CHAT_FONT_SCALE_MIN = 0.85;
export const CHAT_FONT_SCALE_MAX = 1.6;
const ChatFontScaleContext = React.createContext<number | null>(null);

function clampChatFontScale(scale: number): number {
    return Math.max(CHAT_FONT_SCALE_MIN, Math.min(CHAT_FONT_SCALE_MAX, scale));
}

function scaleMonoFonts<T extends Record<string, TextStyle>>(styles: T, scale: number): T {
    return Object.fromEntries(
        Object.entries(styles).map(([key, style]) => [
            key,
            {
                ...style,
                ...(typeof style.fontSize === 'number' ? { fontSize: style.fontSize * scale } : {}),
                ...(typeof style.lineHeight === 'number' ? { lineHeight: style.lineHeight * scale } : {}),
            },
        ]),
    ) as T;
}

interface ChatFontScaleProviderProps {
    scale: number;
    children: React.ReactNode;
}

export function ChatFontScaleProvider({ scale, children }: ChatFontScaleProviderProps) {
    const value = React.useMemo(() => clampChatFontScale(scale), [scale]);
    return React.createElement(ChatFontScaleContext.Provider, { value }, children);
}

export function useChatFontScale(): number {
    const overrideScale = React.useContext(ChatFontScaleContext);
    const scale = useLocalSetting('chatFontScale');
    return React.useMemo(() => clampChatFontScale(overrideScale ?? scale ?? 1.0), [overrideScale, scale]);
}

export function useChatFontScaleOverride(baseFontSize: number, baseLineHeight?: number): Pick<TextStyle, 'fontSize' | 'lineHeight'> | null {
    const scale = useChatFontScale();

    return React.useMemo(() => {
        if (scale === 1) {
            return null;
        }

        return {
            fontSize: baseFontSize * scale,
            ...(typeof baseLineHeight === 'number' ? { lineHeight: baseLineHeight * scale } : {}),
        };
    }, [baseFontSize, baseLineHeight, scale]);
}

export function useChatScaleAnimatedTextStyle(baseFontSize: number | undefined, baseLineHeight?: number) {
    const persistedScale = useChatFontScale();
    const liveScale = React.useContext(ChatScaleLiveContext);
    const liveMultiplier = liveScale?.liveMultiplier;

    return useAnimatedStyle(() => {
        const scale = persistedScale * (liveMultiplier?.value ?? 1);

        // Only emit a scaled `fontSize` when the resolved base is a positive
        // number. On web, react-native-unistyles resolves styles to opaque CSS
        // class markers, so `StyleSheet.flatten(...).fontSize` is `undefined`;
        // callers that coerce that to `0` (`?? 0`) would otherwise make this hook
        // emit `fontSize: 0`, a valid CSS value that hides the text. Skipping the
        // property lets the base unistyles class's font-size survive. On native the
        // base resolves to a real number, so scaling behaves exactly as before.
        // Extends the `typeof style.fontSize === 'number'` guard in scaleMonoFonts
        // with an added `> 0` clause, since `?? 0` callers inject a literal 0 that a
        // bare typeof check would wrongly treat as a valid (text-hiding) size.
        return {
            ...(typeof baseFontSize === 'number' && baseFontSize > 0 ? { fontSize: baseFontSize * scale } : {}),
            ...(typeof baseLineHeight === 'number' ? { lineHeight: baseLineHeight * scale } : {}),
        };
    }, [baseFontSize, baseLineHeight, persistedScale, liveMultiplier]);
}

export function useChatScaledStyles<T extends Record<string, TextStyle>>(styles: T): T {
    const scale = useChatFontScale();
    return scaleMonoFonts(styles, scale);
}
