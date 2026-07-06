import type { TextStyle } from 'react-native';
import { Typography } from '@/constants/Typography';

/**
 * FORK PATCH: [RESTORE-R8d] 8b/8h e-ink markdown text-weight + code-span overrides (invariant HA-8).
 *
 * Upstream derives `bold` / `semibold` from `Typography.default('semiBold')`
 * and pins the inline-`code` span to `fontSize: 16 / lineHeight: 24`. The fork
 * simplifies the weights to plain `fontWeight` values and drops the fixed code
 * metrics so the chat font-scale hook governs code sizing (paired with the
 * `useChatScaledStyles` seam in the code block, HA-8 8h).
 *
 * These values are fork-owned but stay as keys in MarkdownView's `StyleSheet`
 * so the dynamic `style[spanStyle]` span-style lookup keeps working. See
 * docs/happy-patch-surface.md (HA-8).
 */
export const einkTextWeightStyles = {
    bold: { fontWeight: 'bold' } satisfies TextStyle,
    semibold: { fontWeight: '600' } satisfies TextStyle,
};

export function einkCodeSpanStyle(textColor: string) {
    return { ...Typography.mono(), color: textColor };
}
