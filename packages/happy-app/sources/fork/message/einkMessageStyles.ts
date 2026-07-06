/**
 * FORK PATCH: [RESTORE-R8e] e-ink user-message band + attachment-chip styles (invariant HA-9).
 *
 * Fork-owned overlay seam for MessageView's DEFAULT (messageCommandChips OFF)
 * user-message rendering: a flat full-width band (no rounded right-aligned
 * bubble, and — critically — NO paddingVertical on the bubble, which would
 * introduce phantom rows on the e-ink panel) plus the attachment-chip row.
 *
 * The upstream right-aligned bubble + goal/command chips live inline in
 * MessageView.tsx behind the toggle. These values are kept byte-identical to
 * the pre-R8 fork MessageView so the default path renders behavior-identically.
 */
import { StyleSheet } from 'react-native-unistyles';
import { Typography } from '@/constants/Typography';

export const einkMessageStyles = StyleSheet.create((theme) => ({
    userMessageContainer: {
        flexDirection: 'column',
        backgroundColor: theme.colors.userMessageBackground,
        marginBottom: 12,
    },
    userMessageBubble: {
        paddingHorizontal: 16,
    },
    messageAttachmentChips: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 6,
        paddingHorizontal: 16,
        paddingBottom: 8,
    },
    messageAttachmentChip: {
        flexDirection: 'row',
        alignItems: 'center',
        maxWidth: '100%',
        borderRadius: 14,
        borderWidth: 1,
        borderColor: theme.colors.divider,
        backgroundColor: theme.colors.surfacePressed,
        paddingLeft: 8,
        paddingRight: 8,
        height: 30,
        gap: 6,
    },
    messageAttachmentChipText: {
        flexShrink: 1,
        fontSize: 12,
        color: theme.colors.text,
        ...Typography.default('semiBold'),
    },
    messageAttachmentChipSize: {
        fontSize: 11,
        color: theme.colors.textSecondary,
        ...Typography.default(),
    },
}));
