import { AgentContentView } from '@/components/AgentContentView';
import { AgentInput } from '@/components/AgentInput';
import {
    getAvailableModels,
    getAvailablePermissionModes,
    getDefaultModelKey,
    getEffortLevelsForModel,
    getDefaultEffortKeyForModel,
    resolveCurrentOption,
    resolvePermissionModeForPicker,
    EffortLevel,
} from '@/components/modelModeOptions';
import { getSuggestions } from '@/components/autocomplete/suggestions';
import { useChatWidth } from '@/hooks/useChatWidth';
import { ChatList } from '@/components/ChatList';
import { Deferred } from '@/components/Deferred';
import { EmptyMessages } from '@/components/EmptyMessages';
import { emitActiveAgentConfigurationSelection } from './activeAgentConfiguration';
import { getActiveSessionPathSurfaces } from './SessionViewPathSurfaces';
import { Modal } from '@/modal';
import { gitStatusSync } from '@/sync/gitStatusSync';
import { cancelPendingSwitch, requestSwitch, sessionAbort, sessionEmitAgentConfiguration } from '@/sync/ops';
import { storage, useIsDataReady, useLatestBoundary, useLocalSetting, useSessionMessages, useSessionOutputSnapshots, useSessionUsage, useSetting, isReadOnlySession, isPlaceholderSession, isCopilotSession } from '@/sync/storage';
import { useSession } from '@/sync/storage';
import { Session } from '@/sync/storageTypes';
import { sync } from '@/sync/sync';
import { t } from '@/text';
import { resolveTopicBrutalistAvatar } from '@/utils/avatarTopic';
import { isRunningOnMac } from '@/utils/platform';
import { useDeviceType, useHeaderHeight, useIsLandscape, useIsTablet } from '@/utils/responsive';
import { getSessionAvatarId, getSessionMode, getSessionName, useSessionStatus } from '@/utils/sessionUtils';
import { isVersionSupported, MINIMUM_CLI_VERSION } from '@/utils/versionUtils';
// FORK PATCH: [RESTORE-R8a] SessionView e-ink/composer overlays relocated to sources/fork/session/* (invariant HA-4)
// Relocated logic lives in sources/fork/session/{useForkComposer,useBoundaryAdvisory,useSessionContextDrawer,useSessionSidebar,SessionHeaderSurfaces}; see docs/happy-patch-surface.md.
import { getCanSendWhenIdle, useForkComposer } from '@/fork/session/useForkComposer';
import { useBoundaryAdvisory } from '@/fork/session/useBoundaryAdvisory';
import { useSessionContextDrawer } from '@/fork/session/useSessionContextDrawer';
import { useSessionSidebar } from '@/fork/session/useSessionSidebar';
import { SessionHeaderSurfaces } from '@/fork/session/SessionHeaderSurfaces';
import { CopilotSteeringPanel } from '@/components/copilot/CopilotSteeringPanel';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import * as React from 'react';
import { ActivityIndicator, Platform, Pressable, Text, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import type { ModelMode, PermissionMode } from '@/components/PermissionModeSelector';
import { composeSessionMessagesWithSnapshots } from '@/sync/sessionOutputSnapshot';

// FORK PATCH: [RESTORE-R8a] getCanSendWhenIdle relocated to sources/fork/session/useForkComposer (invariant HA-4)
// Re-exported so existing `@/-session/SessionView` importers keep resolving the symbol.
export { getCanSendWhenIdle } from '@/fork/session/useForkComposer';


export const SessionView = React.memo((props: { id: string }) => {
    const sessionId = props.id;
    const router = useRouter();
    const session = useSession(sessionId);
    const isDataReady = useIsDataReady();
    const { theme } = useUnistyles();
    const safeArea = useSafeAreaInsets();
    const isLandscape = useIsLandscape();
    const deviceType = useDeviceType();
    const headerHeight = useHeaderHeight();
    const { width: windowWidth } = useWindowDimensions();
    const unifiedNewSessionComposer = useLocalSetting('unifiedNewSessionComposer');

    // FORK PATCH: [RESTORE-R8a] collapsible files-sidebar wiring relocated (invariant HA-4)
    // M1a: read-only Copilot mirrors (and unknown placeholder sessions) suppress the
    // files-diff sidebar entirely — the sidebar exposes file-open/diff mutations that
    // must not be reachable for observation-only sessions.
    const suppressMutations = isReadOnlySession(session);
    const sidebar = useSessionSidebar({
        sessionId,
        isDataReady,
        hasSession: !!session && !suppressMutations,
        windowWidth,
    });

    // Compute header props based on session state
    const pathSurfaces = React.useMemo(() => getActiveSessionPathSurfaces({
        session,
        unifiedNewSessionComposer,
        projectPathHeaderMaxChars: windowWidth < 420 ? 28 : 48,
    }), [session, unifiedNewSessionComposer, windowWidth]);

    const headerProps = React.useMemo(() => {
        if (!isDataReady) {
            return {
                title: '',
                subtitle: undefined,
                avatarId: undefined,
                onAvatarPress: undefined,
                isConnected: false,
                flavor: null,
            };
        }

        if (!session) {
            return {
                title: t('errors.sessionDeleted'),
                subtitle: undefined,
                avatarId: undefined,
                onAvatarPress: undefined,
                isConnected: false,
                flavor: null,
            };
        }

        const isConnected = session.presence === 'online';
        return {
            title: getSessionName(session),
            subtitle: pathSurfaces.chatHeaderSubtitle,
            avatarId: getSessionAvatarId(session),
            onAvatarPress: isPlaceholderSession(session) ? undefined : () => router.push(`/session/${sessionId}/info`),
            isConnected: isConnected,
            flavor: session.metadata?.flavor || null,
            summaryText: session.metadata?.summary?.text,
            metadataName: session.metadata?.name,
            pinnedAvatarImageIndex: session.pinnedAvatarImageIndex,
            pinnedAvatarColorIndex: session.pinnedAvatarColorIndex,
            tintColor: isConnected ? '#000' : '#8E8E93'
        };
    }, [session, isDataReady, sessionId, router, pathSurfaces.chatHeaderSubtitle]);

    const mainContent = (
        <>
            {/* FORK PATCH: [RESTORE-R8a] header surfaces + web avatar-actions relocated (invariant HA-4) */}
            <SessionHeaderSurfaces
                session={session}
                headerProps={headerProps}
                showSidebar={sidebar.showSidebar}
                sidebarCollapsed={sidebar.sidebarCollapsed}
                toggleSidebar={sidebar.toggleSidebar}
            />

            {/* Content based on state */}
            <View style={{ flex: 1, paddingTop: !(isLandscape && deviceType === 'phone' && Platform.OS !== 'web') ? safeArea.top + headerHeight : 0 }}>
                {!isDataReady ? (
                    <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
                        <ActivityIndicator size="small" color={theme.colors.textSecondary} />
                    </View>
                ) : !session ? (
                    <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
                        <Ionicons name="trash-outline" size={48} color={theme.colors.textSecondary} />
                        <Text style={{ color: theme.colors.text, fontSize: 20, marginTop: 16, fontWeight: '600' }}>{t('errors.sessionDeleted')}</Text>
                        <Text style={{ color: theme.colors.textSecondary, fontSize: 15, marginTop: 8, textAlign: 'center', paddingHorizontal: 32 }}>{t('errors.sessionDeletedDescription')}</Text>
                    </View>
                ) : (
                    <SessionViewLoaded
                        key={sessionId}
                        sessionId={sessionId}
                        session={session}
                        projectPathHeader={pathSurfaces.agentInputProjectPathHeader}
                    />
                )}
            </View>
        </>
    );

    // FORK PATCH: [RESTORE-R8a] two-pane sidebar layout wrap relocated (invariant HA-4)
    return sidebar.wrapWithSidebar(mainContent);
});

function SessionViewLoaded({ sessionId, session, projectPathHeader }: { sessionId: string, session: Session, projectPathHeader?: string }) {
    const { theme } = useUnistyles();
    const router = useRouter();
    const safeArea = useSafeAreaInsets();
    const isLandscape = useIsLandscape();
    const deviceType = useDeviceType();
    const isTablet = useIsTablet();

    // FORK PATCH: [RESTORE-R8a] controlled-draft composer + pre-send intercept relocated (invariant HA-4)
    const composer = useForkComposer(sessionId, session);

    // M1a: read-only Copilot mirrors (and unknown placeholder sessions) render no
    // composer, context drawer, boundary/pending banners, or CLI-update affordance —
    // history is observation-only. Gating lives here (not just in child props) so no
    // send/switch/drawer surface is mounted at all.
    // T6 Path B-lite: Copilot sessions additionally mount the steering panel in
    // place of the (absent) composer — lease UX + prompt-answer composer, driven
    // off actual lease/prompt state, not blanket read-only. Placeholder sessions
    // still render nothing until real metadata arrives.
    const suppressMutations = isReadOnlySession(session);
    const isCopilot = isCopilotSession(session);

    const { messages, isLoaded } = useSessionMessages(sessionId);
    const snapshots = useSessionOutputSnapshots(sessionId);
    const renderedMessages = React.useMemo(
        () => composeSessionMessagesWithSnapshots(messages, snapshots, sessionId),
        [messages, snapshots, sessionId],
    );
    const latestBoundary = useLatestBoundary(sessionId);
    const acknowledgedCliVersions = useLocalSetting('acknowledgedCliVersions');
    const sessionInputHorizontalPadding = Platform.OS === 'web' || isRunningOnMac() || isTablet ? 12 : 8;

    // Check if CLI version is outdated and not already acknowledged
    const cliVersion = session.metadata?.version;
    const machineId = session.metadata?.machineId;
    const isCliOutdated = cliVersion && !isVersionSupported(cliVersion, MINIMUM_CLI_VERSION);
    const isAcknowledged = machineId && acknowledgedCliVersions[machineId] === cliVersion;
    const shouldShowCliWarning = isCliOutdated && !isAcknowledged;

    // SYNC-R5 residual (sync plane): permission / model / effort resolution + agent-config emit (4k).
    // Deeply interwoven with upstream's send rewrite; KEEP-in-place, not seamed this stage.
    const flavor = session.metadata?.flavor;
    const availableModels = React.useMemo(() => (
        getAvailableModels(flavor, session.metadata, t)
    ), [flavor, session.metadata]);
    const availableModes = React.useMemo(() => (
        getAvailablePermissionModes(flavor, session.metadata, t)
    ), [flavor, session.metadata]);

    const permissionMode = React.useMemo<PermissionMode | null>(() => (
        resolvePermissionModeForPicker(availableModes, {
            userChosen: session.permissionModeUserChosen,
            sessionPermissionMode: session.permissionMode,
            metadataCurrentPermissionModeCode: session.metadata?.currentPermissionModeCode,
            metadataDangerouslySkipPermissions: session.metadata?.dangerouslySkipPermissions,
            flavor,
        })
    ), [availableModes, session.permissionModeUserChosen, session.permissionMode, session.metadata?.currentPermissionModeCode, session.metadata?.dangerouslySkipPermissions, flavor]);

    const modelMode = React.useMemo<ModelMode | null>(() => (
        resolveCurrentOption(availableModels, [
            session.modelMode,
            session.metadata?.currentModelCode,
            getDefaultModelKey(flavor),
        ])
    ), [availableModels, session.modelMode, session.metadata?.currentModelCode, flavor]);

    // Effort level state
    const modelKey = modelMode?.key ?? 'default';
    const availableEffortLevels = React.useMemo<EffortLevel[]>(() => (
        getEffortLevelsForModel(flavor, modelKey)
    ), [flavor, modelKey]);
    const effortLevel = React.useMemo<EffortLevel | null>(() => (
        resolveCurrentOption(availableEffortLevels, [
            session.effortLevel,
            getDefaultEffortKeyForModel(flavor, modelKey),
        ])
    ), [availableEffortLevels, session.effortLevel, flavor, modelKey]);

    const sessionStatus = useSessionStatus(session);
    const sessionUsage = useSessionUsage(sessionId);
    const alwaysShowContextSize = useSetting('alwaysShowContextSize');
    const experiments = useSetting('experiments');

    // FORK PATCH: [RESTORE-R8a] context drawer + archived-resume wiring relocated (invariant HA-4)
    const drawer = useSessionContextDrawer({
        sessionId,
        session,
        availableModels,
        availableModes,
        isConnected: sessionStatus.isConnected,
    });

    // SYNC-R5 residual (sync plane): local-Claude idle-send / pending-switch controls (4j).
    const isDisconnected = !sessionStatus.isConnected;
    const pendingSwitch = session.agentState?.pendingSwitch;

    const handleRequestSwitchNow = React.useCallback(async () => {
        try {
            await requestSwitch(sessionId, 'now');
        } catch (error) {
            console.error('Failed to request switch:', error);
            Modal.alert(t('common.error'), t('errors.requestSwitchFailed'));
        }
    }, [sessionId]);

    const handleCancelPendingSwitch = React.useCallback(async () => {
        try {
            await cancelPendingSwitch(sessionId);
        } catch (error) {
            console.error('Failed to cancel pending switch:', error);
            Modal.alert(t('common.error'), t('errors.requestSwitchFailed'));
        }
    }, [sessionId]);

    const handleAbortPress = React.useCallback(() => {
        const isLocalClaudeTurn =
            session.metadata?.flavor === 'claude'
            && getSessionMode(session) === 'local'
            && session.agentState?.turnActive === true
            && session.agentState?.pendingSwitch == null;
        if (!isLocalClaudeTurn) {
            void sessionAbort(sessionId);
            return;
        }
        Modal.alert(
            t('abortPrompt.title'),
            t('abortPrompt.message'),
            [
                {
                    text: t('abortPrompt.switchWhenIdle'),
                    onPress: () => {
                        void requestSwitch(sessionId, 'when-idle').catch((error) => {
                            console.error('Failed to request switch:', error);
                            Modal.alert(t('common.error'), t('errors.requestSwitchFailed'));
                        });
                    },
                },
                {
                    text: t('abortPrompt.switchNow'),
                    style: 'destructive',
                    onPress: () => {
                        void sessionAbort(sessionId);
                    },
                },
                { text: t('abortPrompt.cancel'), style: 'cancel' },
            ],
        );
    }, [session, sessionId]);

    // Handle dismissing CLI version warning
    const handleDismissCliWarning = React.useCallback(() => {
        if (machineId && cliVersion) {
            storage.getState().applyLocalSettings({
                acknowledgedCliVersions: {
                    ...acknowledgedCliVersions,
                    [machineId]: cliVersion
                }
            });
        }
    }, [machineId, cliVersion, acknowledgedCliVersions]);

    // SYNC-R5 residual (sync plane): active-composer agent-config emit callbacks (4k).
    // Function to update permission mode
    const updatePermissionMode = React.useCallback((mode: PermissionMode) => {
        storage.getState().updateSessionPermissionMode(sessionId, mode.key, true);
        void emitActiveAgentConfigurationSelection({ sessionId, emitAgentConfiguration: sessionEmitAgentConfiguration }, { kind: 'permissionMode', option: mode })
            .catch(() => Modal.alert(t('common.error'), t('drawer.applyFailed')));
    }, [sessionId]);

    const updateModelMode = React.useCallback((mode: ModelMode) => {
        storage.getState().updateSessionModelMode(sessionId, mode.key);
        void emitActiveAgentConfigurationSelection({ sessionId, emitAgentConfiguration: sessionEmitAgentConfiguration }, { kind: 'model', option: mode })
            .catch(() => Modal.alert(t('common.error'), t('drawer.applyFailed')));
    }, [sessionId]);

    const updateEffortLevel = React.useCallback((level: EffortLevel) => {
        storage.getState().updateSessionEffortLevel(sessionId, level.key);
        void emitActiveAgentConfigurationSelection({ sessionId, emitAgentConfiguration: sessionEmitAgentConfiguration }, { kind: 'effortLevel', option: level })
            .catch(() => Modal.alert(t('common.error'), t('drawer.applyFailed')));
    }, [sessionId]);
    const iconPinned = session.pinnedAvatarImageIndex !== undefined && session.pinnedAvatarColorIndex !== undefined;
    const handleIconPinnedToggle = React.useCallback(() => {
        if (session.pinnedAvatarImageIndex !== undefined && session.pinnedAvatarColorIndex !== undefined) {
            storage.getState().sessionClearPinnedAvatar(sessionId);
            return;
        }

        const tuple = resolveTopicBrutalistAvatar({
            id: getSessionAvatarId(session),
            summaryText: session.metadata?.summary?.text,
            name: session.metadata?.name,
            flavor: session.metadata?.flavor,
        });
        storage.getState().sessionSetPinnedAvatar(sessionId, tuple);
    }, [session, sessionId]);

    // Memoize header-dependent styles to prevent re-renders
    const headerDependentStyles = React.useMemo(() => ({
        contentContainer: {
            flex: 1
        },
        flatListStyle: {
            marginTop: 0 // No marginTop needed since header is handled by parent
        },
    }), []);

    // SYNC-R5 residual (sync plane): session-visibility sync hook (4l).
    // Trigger session visibility and initialize git status sync
    React.useLayoutEffect(() => {

        // Trigger session sync
        sync.onSessionVisible(sessionId);


        // Initialize git status sync for this session
        gitStatusSync.getSync(sessionId);
    }, [sessionId]);

    React.useEffect(() => {
        sync.onActiveSessionChanged(sessionId);
    }, [sessionId]);

    let content = (
        <>
            <Deferred>
                {renderedMessages.length > 0 && (
                    <ChatList session={session} messages={renderedMessages} />
                )}
            </Deferred>
        </>
    );
    const placeholder = renderedMessages.length === 0 ? (
        <>
            {isLoaded ? (
                <EmptyMessages session={session} />
            ) : (
                <ActivityIndicator size="small" color={theme.colors.textSecondary} />
            )}
        </>
    ) : null;

    // FORK PATCH: [RESTORE-R8a] cross-device boundary advisory relocated (invariant HA-4)
    const boundaryAdvisoryContent = useBoundaryAdvisory({
        latestBoundary,
        composeStartAtRef: composer.composeStartAtRef,
    });
    const boundaryAdvisory = boundaryAdvisoryContent ? (
        <CenteredInputWidth horizontalPadding={sessionInputHorizontalPadding}>
            {boundaryAdvisoryContent}
        </CenteredInputWidth>
    ) : null;

    const composerNode = (
        <AgentInput
            mode="active"
            projectPathHeader={projectPathHeader}
            placeholder={t('session.inputPlaceholder')}
            sessionId={sessionId}
            {...composer.inputProps}
            permissionMode={permissionMode}
            onPermissionModeChange={updatePermissionMode}
            availableModes={availableModes}
            modelMode={modelMode}
            availableModels={availableModels}
            onModelModeChange={updateModelMode}
            effortLevel={effortLevel}
            availableEffortLevels={availableEffortLevels}
            onEffortLevelChange={updateEffortLevel}
            metadata={session.metadata}
            connectionStatus={{
                text: sessionStatus.statusText,
                color: sessionStatus.statusColor,
                dotColor: sessionStatus.statusDotColor,
                isPulsing: sessionStatus.isPulsing
            }}
            onAbort={isDisconnected ? undefined : handleAbortPress}
            showAbortButton={sessionStatus.state === 'thinking' || sessionStatus.state === 'waiting'}
            onFileViewerPress={experiments ? () => router.push(`/session/${sessionId}/files`) : undefined}
            autocompletePrefixes={['@', '/']}
            autocompleteSuggestions={(query) => getSuggestions(sessionId, query)}
            usageData={sessionUsage ? {
                inputTokens: sessionUsage.inputTokens,
                outputTokens: sessionUsage.outputTokens,
                cacheCreation: sessionUsage.cacheCreation,
                cacheRead: sessionUsage.cacheRead,
                contextSize: sessionUsage.contextSize
            } : session.latestUsage ? {
                inputTokens: session.latestUsage.inputTokens,
                outputTokens: session.latestUsage.outputTokens,
                cacheCreation: session.latestUsage.cacheCreation,
                cacheRead: session.latestUsage.cacheRead,
                contextSize: session.latestUsage.contextSize
            } : undefined}
            alwaysShowContextSize={alwaysShowContextSize}
        />
    );

    const archivedHint = drawer.archivedHint ? (
        <CenteredInputWidth horizontalPadding={sessionInputHorizontalPadding}>
            {drawer.archivedHint}
        </CenteredInputWidth>
    ) : null;

    const pendingSwitchBanner = pendingSwitch ? (
        <CenteredInputWidth horizontalPadding={sessionInputHorizontalPadding}>
            <PendingSwitchBanner
                messagePreview={pendingSwitch.messagePreview}
                onCancel={handleCancelPendingSwitch}
                onTakeOverNow={handleRequestSwitchNow}
            />
        </CenteredInputWidth>
    ) : null;

    const contextDrawer = (
        <CenteredInputWidth horizontalPadding={sessionInputHorizontalPadding}>
            {drawer.drawer}
        </CenteredInputWidth>
    );

    const input = isCopilot ? (
        <CenteredInputWidth horizontalPadding={sessionInputHorizontalPadding}>
            <CopilotSteeringPanel sessionId={sessionId} />
        </CenteredInputWidth>
    ) : suppressMutations ? null : drawer.isInactiveArchivedSession ? (
        <>
            {archivedHint}
            {boundaryAdvisory}
            {pendingSwitchBanner}
            {contextDrawer}
            {composerNode}
        </>
    ) : (
        <>
            {boundaryAdvisory}
            {pendingSwitchBanner}
            {contextDrawer}
            {composerNode}
        </>
    );


    return (
        <>
            {/* CLI Version Warning Overlay - Subtle centered pill */}
            {shouldShowCliWarning && !suppressMutations && !(isLandscape && deviceType === 'phone') && (
                <Pressable
                    onPress={handleDismissCliWarning}
                    style={{
                        position: 'absolute',
                        top: 8, // Position at top of content area (padding handled by parent)
                        alignSelf: 'center',
                        backgroundColor: '#FFF3CD',
                        borderRadius: 100, // Fully rounded pill
                        paddingHorizontal: 14,
                        paddingVertical: 7,
                        flexDirection: 'row',
                        alignItems: 'center',
                        zIndex: 998,
                        shadowColor: '#000',
                        shadowOffset: { width: 0, height: 2 },
                        shadowOpacity: 0.15,
                        shadowRadius: 4,
                        elevation: 4,
                    }}
                >
                    <Ionicons name="warning-outline" size={14} color="#FF9500" style={{ marginRight: 6 }} />
                    <Text style={{
                        fontSize: 12,
                        color: '#856404',
                        fontWeight: '600'
                    }}>
                        {t('sessionInfo.cliVersionOutdated')}
                    </Text>
                    <Ionicons name="close" size={14} color="#856404" style={{ marginLeft: 8 }} />
                </Pressable>
            )}

            {/* Main content area - no padding since header is overlay */}
            <View style={{ flexBasis: 0, flexGrow: 1, paddingBottom: safeArea.bottom + ((isRunningOnMac() || Platform.OS === 'web') ? 8 : 0) }}>
                <AgentContentView
                    content={content}
                    input={input}
                    placeholder={placeholder}
                />
            </View >

            {/* Back button for landscape phone mode when header is hidden */}
            {
                isLandscape && deviceType === 'phone' && (
                    <Pressable
                        onPress={() => router.back()}
                        style={{
                            position: 'absolute',
                            top: safeArea.top + 8,
                            left: 16,
                            width: 44,
                            height: 44,
                            borderRadius: 22,
                            backgroundColor: `rgba(${theme.dark ? '28, 23, 28' : '255, 255, 255'}, 0.9)`,
                            alignItems: 'center',
                            justifyContent: 'center',
                            ...Platform.select({
                                ios: {
                                    shadowColor: '#000',
                                    shadowOffset: { width: 0, height: 2 },
                                    shadowOpacity: 0.1,
                                    shadowRadius: 4,
                                },
                                android: {
                                    elevation: 2,
                                }
                            }),
                        }}
                        hitSlop={15}
                    >
                        <Ionicons
                            name={Platform.OS === 'ios' ? 'chevron-back' : 'arrow-back'}
                            size={Platform.select({ ios: 28, default: 24 })}
                            color="#000"
                        />
                    </Pressable>
                )
            }
        </>
    )
}

export function PendingSwitchBanner(props: {
    messagePreview?: string;
    onCancel: () => void;
    onTakeOverNow: () => void;
}) {
    const { theme } = useUnistyles();

    return (
        <View style={styles.pendingSwitchBanner}>
            <View style={styles.pendingSwitchTextColumn}>
                <Text style={styles.pendingSwitchTitle}>{t('pendingSwitch.banner')}</Text>
                {!!props.messagePreview && (
                    <Text style={styles.pendingSwitchPreview} numberOfLines={1}>{props.messagePreview}</Text>
                )}
            </View>
            <View style={styles.pendingSwitchActions}>
                <Pressable
                    onPress={props.onTakeOverNow}
                    accessibilityLabel={t('requestSwitch.now')}
                    style={({ pressed }) => [
                        styles.pendingSwitchButton,
                        styles.pendingSwitchPrimaryButton,
                        pressed && styles.pendingSwitchButtonPressed,
                    ]}
                >
                    <Ionicons name="flash-outline" size={14} color={theme.colors.button.primary.tint} />
                    <Text style={styles.pendingSwitchPrimaryText}>{t('requestSwitch.now')}</Text>
                </Pressable>
                <Pressable
                    onPress={props.onCancel}
                    accessibilityLabel={t('cancelPendingSwitch.label')}
                    style={({ pressed }) => [
                        styles.pendingSwitchButton,
                        styles.pendingSwitchSecondaryButton,
                        pressed && styles.pendingSwitchButtonPressed,
                    ]}
                >
                    <Ionicons name="close" size={14} color={theme.colors.text} />
                    <View style={styles.pendingSwitchSecondaryCopyColumn}>
                        <Text style={styles.pendingSwitchSecondaryText}>{t('cancelPendingSwitch.label')}</Text>
                        <Text style={styles.pendingSwitchSecondaryNote}>{t('cancelPendingSwitch.note')}</Text>
                    </View>
                </Pressable>
            </View>
        </View>
    );
}

function CenteredInputWidth(props: {
    children: React.ReactNode;
    horizontalPadding: number;
}) {
    // FORK PATCH: [RESTORE-R8a] e-ink chat-width helper seam (invariant HA-4)
    const { body: bodyMaxWidth } = useChatWidth();
    const contentWidthStyle = React.useMemo(() => ({ width: '100%' as const, maxWidth: bodyMaxWidth }), [bodyMaxWidth]);

    return (
        <View style={{
            width: '100%',
            paddingHorizontal: props.horizontalPadding,
            alignItems: 'center',
        }}>
            <View style={contentWidthStyle}>
                {props.children}
            </View>
        </View>
    );
}

const styles = StyleSheet.create((theme) => ({
    pendingSwitchBanner: {
        marginHorizontal: 8,
        marginTop: 8,
        marginBottom: 4,
        paddingHorizontal: 12,
        paddingVertical: 10,
        borderRadius: 8,
        borderWidth: 2,
        borderColor: theme.colors.textSecondary,
        backgroundColor: theme.colors.userMessageBackground,
        gap: 10,
    },
    pendingSwitchTextColumn: {
        gap: 2,
    },
    pendingSwitchTitle: {
        color: theme.colors.text,
        fontSize: 13,
        lineHeight: 18,
        fontWeight: '600',
    },
    pendingSwitchPreview: {
        color: theme.colors.textSecondary,
        fontSize: 12,
        lineHeight: 16,
    },
    pendingSwitchActions: {
        flexDirection: 'row',
        gap: 8,
        flexWrap: 'wrap',
    },
    pendingSwitchButton: {
        minHeight: 32,
        borderRadius: 8,
        paddingHorizontal: 10,
        paddingVertical: 6,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 6,
    },
    pendingSwitchPrimaryButton: {
        backgroundColor: theme.colors.button.primary.background,
    },
    pendingSwitchSecondaryButton: {
        backgroundColor: theme.colors.surface,
        borderWidth: 1,
        borderColor: theme.colors.textSecondary,
    },
    pendingSwitchSecondaryCopyColumn: {
        gap: 1,
    },
    pendingSwitchButtonPressed: {
        opacity: 0.7,
    },
    pendingSwitchPrimaryText: {
        color: theme.colors.button.primary.tint,
        fontSize: 12,
        lineHeight: 16,
        fontWeight: '600',
    },
    pendingSwitchSecondaryText: {
        color: theme.colors.text,
        fontSize: 12,
        lineHeight: 16,
        fontWeight: '600',
    },
    pendingSwitchSecondaryNote: {
        color: theme.colors.textSecondary,
        fontSize: 11,
        lineHeight: 14,
    },
}));
