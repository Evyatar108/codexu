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
 */
export function AnimatedMarkdownText(props: React.ComponentProps<typeof AnimatedText> & { baseStyle?: StyleProp<TextStyle> }) {
    const flattenedBaseStyle = RNStyleSheet.flatten(props.baseStyle) ?? {};
    const animatedTextStyle = useChatScaleAnimatedTextStyle(flattenedBaseStyle.fontSize ?? 0, flattenedBaseStyle.lineHeight);

    return <AnimatedText {...props} style={[props.baseStyle, props.style, animatedTextStyle]} />;
}
