/**
 * FORK PATCH: [RESTORE-R8c] AgentInput e-ink text-size + chat-width overlays (invariant HA-6).
 *
 * Fork-owned overlay seam for AgentInput's two e-ink composer choosers:
 *   - the in-input **text-size** picker (discrete chat-font-scale chips), and
 *   - the tablet-only **chat-width** picker (horizontal-margin chips).
 *
 * Both overlays are FORK-INTRODUCED (upstream cli-1.1.8 / cli-1.1.10 have no
 * equivalent in-composer choosers). Relocating the presentational bodies here
 * keeps AgentInput.tsx close to upstream shape; AgentInput calls
 * `<ComposerLayoutOverlays />` at the same JSX position with the same props, so
 * the rendered tree + styles are byte-identical to the pre-R8 inline overlays.
 * This is a PURE MOVE — behavior unchanged. See docs/happy-patch-surface.md (HA-6).
 */
import * as React from 'react';
import { View, Text, Pressable, TouchableWithoutFeedback } from 'react-native';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { FloatingOverlay } from '@/components/FloatingOverlay';
import { Typography } from '@/constants/Typography';
import { t } from '@/text';

// Discrete chat-font-scale steps for the in-input text-size picker.
// 9 values spanning 0.85..1.5 (CHAT_FONT_SCALE_MAX in the hook is 1.6 and remains
// reachable via pinch-to-zoom and the Settings → Appearance slider; the picker tops
// out at 1.5 because anything above feels excessive on the BOOX).
// Chip 4 = 1.00 (default scale). 0.05 spacing below 1.0 for fine accessibility tuning,
// 0.10 spacing above 1.0 for clear visual jumps.
export const CHAT_FONT_SCALE_STEPS = [0.85, 0.9, 0.95, 1.0, 1.1, 1.2, 1.3, 1.4, 1.5] as const;

const overlayStyles = StyleSheet.create((theme) => ({
    textSizeOverlay: {
        position: 'absolute',
        bottom: '100%',
        left: 0,
        right: 0,
        marginBottom: 8,
        zIndex: 1000,
    },
    overlayBackdrop: {
        position: 'absolute',
        top: -1000,
        left: -1000,
        right: -1000,
        bottom: -1000,
        zIndex: 999,
    },
    overlaySection: {
        paddingVertical: 8,
    },
    overlaySectionTitle: {
        fontSize: 12,
        fontWeight: '600',
        color: theme.colors.textSecondary,
        paddingHorizontal: 16,
        paddingBottom: 4,
        ...Typography.default('semiBold'),
    },
    textSizeChipsRow: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 8,
        paddingHorizontal: 16,
        paddingTop: 4,
        paddingBottom: 8,
    },
    textSizeChip: {
        minWidth: 44,
        height: 40,
        paddingHorizontal: 12,
        borderRadius: 12,
        borderWidth: 1,
        alignItems: 'center',
        justifyContent: 'center',
    },
}));

interface ComposerLayoutOverlaysProps {
    showTextSize: boolean;
    showChatWidth: boolean;
    isTablet: boolean;
    screenWidth: number;
    chatFontScale: number;
    chatWidthMode: number;
    chatWidthMarginOptions: readonly number[];
    onTextSizeSelect: (value: number) => void;
    onChatWidthSelect: (value: number) => void;
    onCloseTextSize: () => void;
    onCloseChatWidth: () => void;
}

/**
 * Presentational text-size + chat-width overlays for AgentInput. Stateless: the
 * parent owns visibility (`showTextSize`/`showChatWidth`), the current values,
 * and the select/close handlers, so this seam has no side effects of its own.
 */
export function ComposerLayoutOverlays(props: ComposerLayoutOverlaysProps) {
    const styles = overlayStyles;
    const { theme } = useUnistyles();
    return (
        <>
            {/* Text-size overlay */}
            {props.showTextSize && (
                <>
                    <TouchableWithoutFeedback onPress={props.onCloseTextSize}>
                        <View style={styles.overlayBackdrop} />
                    </TouchableWithoutFeedback>
                    <View style={[
                        styles.textSizeOverlay,
                        { paddingHorizontal: props.screenWidth > 700 ? 0 : 8 }
                    ]}>
                        <FloatingOverlay maxHeight={140} keyboardShouldPersistTaps="always">
                            <View style={styles.overlaySection}>
                                <Text style={styles.overlaySectionTitle}>
                                    {t('agentInput.textSize.title')}
                                </Text>
                                <View style={styles.textSizeChipsRow}>
                                    {CHAT_FONT_SCALE_STEPS.map((step, idx) => {
                                        const isActive = Math.abs(step - props.chatFontScale) < 0.0001;
                                        return (
                                            <Pressable
                                                key={step}
                                                onPress={() => props.onTextSizeSelect(step)}
                                                hitSlop={{ top: 4, bottom: 4, left: 4, right: 4 }}
                                                style={({ pressed }) => ({
                                                    ...styles.textSizeChip,
                                                    backgroundColor: isActive ? theme.colors.button.primary.background : 'transparent',
                                                    borderColor: isActive ? theme.colors.button.primary.background : theme.colors.divider,
                                                    opacity: pressed ? 0.7 : 1,
                                                })}
                                            >
                                                <Text style={{
                                                    fontSize: 16,
                                                    color: isActive ? theme.colors.button.primary.tint : theme.colors.text,
                                                    ...Typography.default('semiBold'),
                                                }}>
                                                    {idx + 1}
                                                </Text>
                                            </Pressable>
                                        );
                                    })}
                                </View>
                            </View>
                        </FloatingOverlay>
                    </View>
                </>
            )}

            {/* Chat-width overlay */}
            {props.isTablet && props.showChatWidth && (
                <>
                    <TouchableWithoutFeedback onPress={props.onCloseChatWidth}>
                        <View style={styles.overlayBackdrop} />
                    </TouchableWithoutFeedback>
                    <View style={[
                        styles.textSizeOverlay,
                        { paddingHorizontal: props.screenWidth > 700 ? 0 : 8 }
                    ]}>
                        <FloatingOverlay maxHeight={140} keyboardShouldPersistTaps="always">
                            <View style={styles.overlaySection}>
                                <Text style={styles.overlaySectionTitle}>
                                    {t('agentInput.chatWidth.title')}
                                </Text>
                                <View style={styles.textSizeChipsRow}>
                                    {props.chatWidthMarginOptions.map((margin) => {
                                        const isActive = margin === props.chatWidthMode;
                                        return (
                                            <Pressable
                                                key={margin}
                                                onPress={() => props.onChatWidthSelect(margin)}
                                                hitSlop={{ top: 4, bottom: 4, left: 4, right: 4 }}
                                                style={({ pressed }) => ({
                                                    ...styles.textSizeChip,
                                                    backgroundColor: isActive ? theme.colors.button.primary.background : 'transparent',
                                                    borderColor: isActive ? theme.colors.button.primary.background : theme.colors.divider,
                                                    opacity: pressed ? 0.7 : 1,
                                                })}
                                            >
                                                <Text style={{
                                                    fontSize: 14,
                                                    color: isActive ? theme.colors.button.primary.tint : theme.colors.text,
                                                    ...Typography.default('semiBold'),
                                                }}>
                                                    {String(margin)}
                                                </Text>
                                            </Pressable>
                                        );
                                    })}
                                </View>
                            </View>
                        </FloatingOverlay>
                    </View>
                </>
            )}
        </>
    );
}
