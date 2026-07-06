/**
 * FORK PATCH: [RESTORE-R8a] SessionView cross-device boundary advisory (invariant HA-4).
 *
 * Fork-owned seam for SessionView's typed cross-device boundary advisory
 * (catalogue row 4g): the visibility gate (`shouldShowBoundaryAdvisory`, comparing
 * the latest context-boundary against the compose-start timestamp owned by
 * `useForkComposer`) plus the small advisory pill. SessionView calls
 * `useBoundaryAdvisory(...)` and wraps the returned node in its shared
 * `CenteredInputWidth`, so the rendered tree + styles are byte-identical to the
 * pre-R8 inline advisory. See docs/happy-patch-surface.md (HA-4).
 */
import * as React from 'react';
import { Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { t } from '@/text';
import { shouldShowBoundaryAdvisory } from '@/-session/composeBoundaryAdvisory';
import type { LatestBoundary } from '@/sync/reducer/reducer';

function CrossDeviceBoundaryAdvisory() {
    const { theme } = useUnistyles();

    return (
        <View style={styles.boundaryAdvisory}>
            <Ionicons name="warning-outline" size={16} color={theme.colors.text} />
            <Text style={styles.boundaryAdvisoryText}>{t('chat.boundaryDivider.crossDeviceAdvisory')}</Text>
        </View>
    );
}

/**
 * Returns the boundary-advisory node when a context boundary has landed since the
 * user started composing, otherwise `null`. Reads `composeStartAtRef.current` at
 * render time exactly as the pre-R8 inline gate did.
 */
export function useBoundaryAdvisory(params: {
    latestBoundary: LatestBoundary | null;
    composeStartAtRef: React.MutableRefObject<number | null>;
}): React.ReactNode {
    const showBoundaryAdvisory = shouldShowBoundaryAdvisory(params.latestBoundary, params.composeStartAtRef.current);
    return showBoundaryAdvisory ? <CrossDeviceBoundaryAdvisory /> : null;
}

const styles = StyleSheet.create((theme) => ({
    boundaryAdvisory: {
        marginHorizontal: 8,
        marginTop: 8,
        marginBottom: 4,
        paddingHorizontal: 12,
        paddingVertical: 10,
        borderRadius: 8,
        borderWidth: 2,
        borderColor: theme.colors.textSecondary,
        backgroundColor: theme.colors.surface,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
    },
    boundaryAdvisoryText: {
        color: theme.colors.text,
        fontSize: 13,
        lineHeight: 18,
        flex: 1,
    },
}));
