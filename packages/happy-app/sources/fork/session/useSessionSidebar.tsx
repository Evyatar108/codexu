/**
 * FORK PATCH: [RESTORE-R8a] SessionView collapsible files-sidebar (invariant HA-4).
 *
 * Fork-owned seam for SessionView's desktop/web two-pane collapsible files
 * sidebar (catalogue row 4a): owns the enable gate, the animated collapse state
 * (`sidebarCollapsed` local setting + reanimated width/opacity), the toggle, the
 * file-open handler, and the Pierre-diff prefetch. SessionView calls
 * `useSessionSidebar(...)`, threads `showSidebar`/`sidebarCollapsed`/`toggleSidebar`
 * into its header, and wraps its main content via `sidebar.wrapWithSidebar(...)`,
 * so the rendered tree + animation are byte-identical to the pre-R8 inline
 * sidebar. This seam pairs with the R8 sidebar-trio stage.
 * See docs/happy-patch-surface.md (HA-4).
 */
import * as React from 'react';
import { Platform, View } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { useRouter } from 'expo-router';
import { FilesSidebar } from '@/components/FilesSidebar';
import { prefetchPierreDiff } from '@/components/diff/PierreDiffView';
import { useLocalSettingMutable, useSetting } from '@/sync/storage';
import { GitFileStatus } from '@/sync/gitStatusFiles';
import { encodeBase64Url } from '@/utils/base64url';
import { isRunningOnMac } from '@/utils/platform';

export const SIDEBAR_MIN_WINDOW_WIDTH = 1100;

export interface SessionSidebarSeam {
    showSidebar: boolean;
    sidebarCollapsed: boolean;
    toggleSidebar: () => void;
    wrapWithSidebar: (mainContent: React.ReactNode) => React.ReactNode;
}

export function useSessionSidebar(params: {
    sessionId: string;
    isDataReady: boolean;
    hasSession: boolean;
    windowWidth: number;
}): SessionSidebarSeam {
    const { sessionId, isDataReady, hasSession, windowWidth } = params;
    const router = useRouter();
    const fileDiffsSidebarEnabled = useSetting('fileDiffsSidebar');

    const showSidebar = fileDiffsSidebarEnabled
        && (isRunningOnMac() || Platform.OS === 'web')
        && windowWidth >= SIDEBAR_MIN_WINDOW_WIDTH
        && isDataReady && hasSession;

    // Match left sidebar width: 30% of window, clamped to 250–360px
    const sidebarWidth = Math.min(Math.max(Math.floor(windowWidth * 0.3), 250), 360);

    const [sidebarCollapsed, setSidebarCollapsed] = useLocalSettingMutable('sidebarCollapsed');
    const sidebarAnim = useSharedValue(sidebarCollapsed ? 0 : 1);

    React.useEffect(() => {
        sidebarAnim.value = withTiming(sidebarCollapsed ? 0 : 1, {
            duration: 250,
            easing: Easing.out(Easing.cubic),
        });
    }, [sidebarCollapsed]);

    const animatedSidebarStyle = useAnimatedStyle(() => ({
        width: sidebarAnim.value * sidebarWidth,
        opacity: sidebarAnim.value,
        overflow: 'hidden' as const,
    }));

    const toggleSidebar = React.useCallback(() => {
        setSidebarCollapsed(!sidebarCollapsed);
    }, [sidebarCollapsed, setSidebarCollapsed]);

    const handleSidebarFilePress = React.useCallback((file: GitFileStatus) => {
        router.push(`/session/${sessionId}/file?path=${encodeBase64Url(file.fullPath)}&refresh=1&view=diff`);
    }, [router, sessionId]);

    // Warm Pierre's lazy web chunks while the user is still reading chat.
    React.useEffect(() => {
        prefetchPierreDiff();
    }, []);

    const wrapWithSidebar = React.useCallback((mainContent: React.ReactNode): React.ReactNode => {
        if (!showSidebar) {
            return mainContent;
        }

        // Desktop layout: chat + sidebar at the same level (full height).
        return (
            <View style={{ flex: 1, flexDirection: 'row' }}>
                <View style={{ flex: 1 }}>
                    {mainContent}
                </View>
                <Animated.View style={[{ minWidth: 0, alignSelf: 'stretch' }, animatedSidebarStyle]}>
                    <View style={{ width: sidebarWidth, flex: 1 }}>
                        <FilesSidebar
                            sessionId={sessionId}
                            onFilePress={handleSidebarFilePress}
                        />
                    </View>
                </Animated.View>
            </View>
        );
    }, [showSidebar, animatedSidebarStyle, sidebarWidth, sessionId, handleSidebarFilePress]);

    return { showSidebar, sidebarCollapsed, toggleSidebar, wrapWithSidebar };
}
