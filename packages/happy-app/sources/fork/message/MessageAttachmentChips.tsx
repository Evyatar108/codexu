/**
 * FORK PATCH: [RESTORE-R8e] e-ink attachment-chip row for user messages (invariant HA-9).
 *
 * Renders the paperclip chips beneath a user message's flat e-ink band. This
 * is fork-only UI (upstream MessageView has no attachment chips) and is shown
 * only on the DEFAULT (messageCommandChips OFF) path. Relocated out of
 * MessageView.tsx so the canonical file stays close to upstream shape.
 */
import * as React from 'react';
import { View, Text } from 'react-native';
import { useUnistyles } from 'react-native-unistyles';
import { Octicons } from '@expo/vector-icons';
import { UserTextMessage } from '@/sync/typesMessage';
import { formatAttachmentSize } from '@/components/composer/AttachmentChip';
import { einkMessageStyles as styles } from './einkMessageStyles';

export function MessageAttachmentChips(props: {
    attachmentRefs: NonNullable<UserTextMessage['meta']>['attachmentRefs'];
}) {
    const { theme } = useUnistyles();

    if (!props.attachmentRefs || props.attachmentRefs.length === 0) {
        return null;
    }

    return (
        <View style={styles.messageAttachmentChips}>
            {props.attachmentRefs.map((ref, index) => (
                <View key={index} style={styles.messageAttachmentChip} testID="message-attachment-chip">
                    <Octicons name="paperclip" size={13} color={theme.colors.textSecondary} />
                    <Text style={styles.messageAttachmentChipText} numberOfLines={1}>{ref.name}</Text>
                    <Text style={styles.messageAttachmentChipSize}>{formatAttachmentSize(ref.size)}</Text>
                </View>
            ))}
        </View>
    );
}
