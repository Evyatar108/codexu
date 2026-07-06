/**
 * FORK PATCH: [RESTORE-R8a] SessionView header surfaces + web avatar-actions (invariant HA-4).
 *
 * Fork-owned seam for SessionView's header composition (catalogue rows 4b + 4c):
 * the landscape status-bar shadow, the `<ChatHeaderView>` block (fork-added
 * sidebar-toggle + web avatar-actions entrypoint + path-surface subtitle), and the
 * web `<SessionActionsPopover>` — including the shared `sessionActionsAnchor` state
 * that couples the two. SessionView computes `headerProps` (from the fork path
 * surfaces) and renders `<SessionHeaderSurfaces .../>` at the same position, so the
 * rendered header is byte-identical to the pre-R8 inline block.
 * See docs/happy-patch-surface.md (HA-4).
 */
import * as React from 'react';
import { Platform, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useUnistyles } from 'react-native-unistyles';
import { useRouter } from 'expo-router';
import { ChatHeaderView } from '@/components/ChatHeaderView';
import { SessionActionsAnchor, SessionActionsPopover } from '@/components/SessionActionsPopover';
import { Session } from '@/sync/storageTypes';
import { useDeviceType, useIsLandscape } from '@/utils/responsive';

export function SessionHeaderSurfaces(props: {
    session: Session | null | undefined;
    headerProps: Omit<
        React.ComponentProps<typeof ChatHeaderView>,
        | 'onBackPress'
        | 'avatarMenuExpanded'
        | 'avatarMenuSession'
        | 'onAfterAvatarArchive'
        | 'onAfterAvatarDelete'
        | 'onAvatarMenuRequest'
        | 'onSidebarTogglePress'
        | 'sidebarCollapsed'
    >;
    showSidebar: boolean;
    sidebarCollapsed: boolean;
    toggleSidebar: () => void;
}) {
    const { session, headerProps, showSidebar, sidebarCollapsed, toggleSidebar } = props;
    const router = useRouter();
    const { theme } = useUnistyles();
    const safeArea = useSafeAreaInsets();
    const isLandscape = useIsLandscape();
    const deviceType = useDeviceType();
    const [sessionActionsAnchor, setSessionActionsAnchor] = React.useState<SessionActionsAnchor | null>(null);

    return (
        <>
            {/* Status bar shadow for landscape mode */}
            {isLandscape && deviceType === 'phone' && (
                <View style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    right: 0,
                    height: safeArea.top,
                    backgroundColor: theme.colors.surface,
                    zIndex: 1000,
                    shadowColor: theme.colors.shadow.color,
                    shadowOffset: {
                        width: 0,
                        height: 2,
                    },
                    shadowOpacity: theme.colors.shadow.opacity,
                    shadowRadius: 3,
                    elevation: 5,
                }} />
            )}

            {/* Header - always shown on desktop/Mac, hidden in landscape mode only on actual phones */}
            {!(isLandscape && deviceType === 'phone' && Platform.OS !== 'web') && (
                <View style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    right: 0,
                    zIndex: 1000
                }}>
                    <ChatHeaderView
                        {...headerProps}
                        onBackPress={() => router.back()}
                        avatarMenuExpanded={Platform.OS === 'web' && !!sessionActionsAnchor}
                        avatarMenuSession={session}
                        onAfterAvatarArchive={() => {
                            setSessionActionsAnchor(null);
                            router.replace('/');
                        }}
                        onAfterAvatarDelete={() => {
                            setSessionActionsAnchor(null);
                            router.replace('/');
                        }}
                        onAvatarMenuRequest={Platform.OS === 'web' && session ? setSessionActionsAnchor : undefined}
                        onSidebarTogglePress={showSidebar ? toggleSidebar : undefined}
                        sidebarCollapsed={sidebarCollapsed}
                    />
                </View>
            )}

            {Platform.OS === 'web' && session && (
                <SessionActionsPopover
                    anchor={sessionActionsAnchor}
                    onAfterArchive={() => {
                        setSessionActionsAnchor(null);
                        router.replace('/');
                    }}
                    onAfterDelete={() => {
                        setSessionActionsAnchor(null);
                        router.replace('/');
                    }}
                    onClose={() => setSessionActionsAnchor(null)}
                    sessionId={session.id}
                    visible={!!sessionActionsAnchor}
                />
            )}
        </>
    );
}
