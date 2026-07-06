import { StyleSheet } from 'react-native-unistyles';
import { Typography } from '@/constants/Typography';

/**
 * FORK PATCH: [RESTORE-R8d] 8a e-ink option-card styles (invariant HA-8).
 *
 * Upstream styles option cards with `surfaceHighest` fill + a 1px `divider`
 * border. On the color e-ink panel both of those quantize to pure white, so the
 * card vanishes into the page. The fork uses the proven-visible
 * `userMessageBackground` fill, a 2px `textSecondary` border, and a hard-edged
 * 4px `text` left accent bar (documented in packages/happy-app/AGENTS.md) so the
 * "tap me" affordance survives e-ink quantization.
 *
 * Behavior-preserving relocation of the inline option-card styles that used to
 * live in components/markdown/MarkdownView.tsx. See docs/happy-patch-surface.md (HA-8).
 */
export const optionCardStyles = StyleSheet.create((theme) => ({
    optionsContainer: {
        flexDirection: 'column',
        gap: 8,
        marginVertical: 8,
    },
    optionItem: {
        // E-ink visibility: surfaceHighest (#f0f0f0) and divider (#eaeaea) both
        // quantize to pure white on color e-ink panels, making the options card
        // disappear into the page background. userMessageBackground (#d4d4d4)
        // is the proven-visible value documented in packages/happy-app/AGENTS.md;
        // 2px textSecondary border survives quantization where 1px divider does not.
        position: 'relative',
        overflow: 'hidden',
        backgroundColor: theme.colors.userMessageBackground,
        borderRadius: 8,
        paddingHorizontal: 16,
        paddingVertical: 12,
        borderWidth: 2,
        borderColor: theme.colors.textSecondary,
    },
    optionItemAccent: {
        // Hard-edged left bar — strong "tap me" cue on e-ink, where shadow /
        // elevation / opacity-pressed states all fail to render.
        position: 'absolute',
        left: 0,
        top: 0,
        bottom: 0,
        width: 4,
        backgroundColor: theme.colors.text,
    },
    optionItemPressed: {
        opacity: 0.7,
        backgroundColor: theme.colors.surfaceHigh,
    },
    optionText: {
        ...Typography.default(),
        fontSize: 16,
        lineHeight: 24,
        color: theme.colors.text,
    },
    // Shared no-op first/last markers (kept empty to mirror upstream's shape so
    // the seam call site stays identical to the other block renderers).
    first: {
        // marginTop: 0
    },
    last: {
        // marginBottom: 0
    },
}));
