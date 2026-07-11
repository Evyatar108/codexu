import * as React from 'react';
import { StyleSheet as RNStyleSheet, type StyleProp, type TextStyle } from 'react-native';
import { AnimatedText } from '@/components/StyledText';
import { useChatScaleAnimatedTextStyle } from '@/hooks/useChatFontScale';

/**
 * FORK PATCH: [RESTORE-R8d] 8g chat font-scale wrapper for markdown text (invariant HA-8).
 *
 * Upstream renders markdown text with a plain `<Text>`. The fork wraps every
 * markdown text node in an animated component whose fontSize / lineHeight track
 * the chat font-scale slider (`useChatScaleAnimatedTextStyle`), so the e-ink
 * tablet's global text-scale setting applies inside rendered markdown too.
 *
 * Behavior-preserving relocation of the inline `AnimatedMarkdownText` that used
 * to live in components/markdown/MarkdownView.tsx. See docs/happy-patch-surface.md (HA-8).
 *
 * On web, react-native-unistyles resolves styles to opaque CSS-class markers
 * (`{ unistyles_<hash>: {} }`), so `RNStyleSheet.flatten(baseStyle).fontSize`
 * is `undefined` (the numeric value lives only in the emitted CSS class, not on
 * the JS object). We therefore pass the possibly-undefined base fontSize through
 * unchanged; `useChatScaleAnimatedTextStyle` skips emitting a `fontSize` when the
 * base is not a positive number, so the base class's font-size survives instead
 * of being overridden with a text-hiding `0`. On native, flatten yields the real
 * numeric fontSize, so the animated scale applies exactly as before.
 */
export function AnimatedMarkdownText(props: React.ComponentProps<typeof AnimatedText> & { baseStyle?: StyleProp<TextStyle> }) {
    const flattenedBaseStyle = RNStyleSheet.flatten(props.baseStyle) ?? {};
    const animatedTextStyle = useChatScaleAnimatedTextStyle(flattenedBaseStyle.fontSize, flattenedBaseStyle.lineHeight);

    return <AnimatedText {...props} style={[props.baseStyle, props.style, animatedTextStyle]} />;
}
