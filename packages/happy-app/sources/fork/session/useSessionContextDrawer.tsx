/**
 * FORK PATCH: [RESTORE-R8a] SessionView context drawer + archived-resume (invariant HA-4).
 *
 * Fork-owned seam for SessionView's context drawer + inactive-archived resume
 * affordance (catalogue row 4f): resolves the drawer's display model/permission
 * modes, the machine name, the fork-composer entrypoint, the quick-action /
 * resume wiring, and the inactive-archived detection, and renders the
 * `<SessionContextDrawer>` + `<InactiveArchivedHint>` nodes. SessionView calls
 * `useSessionContextDrawer(...)` and wraps the returned nodes in its shared
 * `CenteredInputWidth`, so the rendered tree is byte-identical to the pre-R8
 * inline drawer. The active-composer permission/model/effort resolution (4k)
 * stays in SessionView (SYNC-R5 residual); this seam only consumes the derived
 * `availableModels`/`availableModes` + connection state as inputs.
 * See docs/happy-patch-surface.md (HA-4).
 */
import * as React from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useUnistyles } from 'react-native-unistyles';
import {
    getDefaultModelKey,
    resolveCurrentOption,
    resolvePermissionModeForPicker,
} from '@/components/modelModeOptions';
import { ResumeCommandCopyBlock, SessionContextDrawer } from '@/components/SessionContextDrawer';
import { useSessionQuickActions } from '@/hooks/useSessionQuickActions';
import { useMachine } from '@/sync/storage';
import { isReadOnlySession } from '@/sync/storage';
import { Session } from '@/sync/storageTypes';
import { t } from '@/text';
import { getResumeCommandBlock } from '@/utils/sessionUtils';
import type { ModelMode, PermissionMode } from '@/components/PermissionModeSelector';

function InactiveArchivedHint(props: {
    resumeCommandBlock: NonNullable<ReturnType<typeof getResumeCommandBlock>> | null;
    canResume: boolean;
    resuming: boolean;
    onResume: () => void;
}) {
    const { theme } = useUnistyles();
    const hintTextStyle = {
        color: theme.colors.agentEventText,
        fontSize: 13,
        lineHeight: 18,
        textAlign: 'left' as const,
    };

    return (
        <View style={{
            paddingTop: 12,
            paddingBottom: 10,
            gap: 10,
            alignItems: 'stretch',
        }}>
            <View style={{ paddingHorizontal: 8, gap: 4 }}>
                <Text style={hintTextStyle}>
                    {t('session.inactiveArchived')}
                </Text>
                {props.canResume ? null : props.resumeCommandBlock && (
                    <Text style={hintTextStyle}>
                        {t('session.resumeFromTerminal')}
                    </Text>
                )}
            </View>
            {props.canResume ? (
                <Pressable
                    onPress={props.onResume}
                    disabled={props.resuming}
                    style={({ pressed }) => ({
                        height: 40,
                        borderRadius: 10,
                        backgroundColor: theme.colors.button.primary.background,
                        opacity: props.resuming ? 0.6 : pressed ? 0.8 : 1,
                        alignItems: 'center',
                        justifyContent: 'center',
                        marginHorizontal: 8,
                    })}
                >
                    {props.resuming ? (
                        <ActivityIndicator size="small" color={theme.colors.button.primary.tint} />
                    ) : (
                        <Text style={{ color: theme.colors.button.primary.tint, fontSize: 15, fontWeight: '600' }}>
                            {t('sessionInfo.resumeSession')}
                        </Text>
                    )}
                </Pressable>
            ) : props.resumeCommandBlock && (
                <ResumeCommandCopyBlock resumeCommandBlock={props.resumeCommandBlock} />
            )}
        </View>
    );
}

export interface SessionContextDrawerSeam {
    isInactiveArchivedSession: boolean;
    drawer: React.ReactNode;
    archivedHint: React.ReactNode;
}

export function useSessionContextDrawer(params: {
    sessionId: string;
    session: Session;
    availableModels: ModelMode[];
    availableModes: PermissionMode[];
    isConnected: boolean;
}): SessionContextDrawerSeam {
    const { sessionId, session, availableModels, availableModes, isConnected } = params;
    const router = useRouter();
    const flavor = session.metadata?.flavor;

    const { canResume, resumeAvailability, resumeSession, resumeSessionInline, resumingSession } = useSessionQuickActions(session);

    const sessionMachineId = session.metadata?.machineId ?? '';
    const sessionMachine = useMachine(sessionMachineId);
    const machineName = sessionMachine?.metadata?.displayName
        ?? sessionMachine?.metadata?.host
        ?? session.metadata?.host
        ?? session.metadata?.machineId
        ?? null;

    const drawerPermissionMode = React.useMemo<PermissionMode | null>(() => (
        resolvePermissionModeForPicker(availableModes, {
            userChosen: false,
            sessionPermissionMode: null,
            metadataCurrentPermissionModeCode: session.metadata?.currentPermissionModeCode,
            metadataDangerouslySkipPermissions: session.metadata?.dangerouslySkipPermissions,
            flavor,
        })
    ), [availableModes, session.metadata?.currentPermissionModeCode, session.metadata?.dangerouslySkipPermissions, flavor]);
    const drawerModelMode = React.useMemo<ModelMode | null>(() => (
        resolveCurrentOption(availableModels, [
            session.metadata?.currentModelCode,
            getDefaultModelKey(flavor),
        ])
    ), [availableModels, session.metadata?.currentModelCode, flavor]);

    const isArchivedSession = session.metadata?.lifecycleState === 'archived';
    const isInactiveArchivedSession = isArchivedSession && !isConnected;
    const resumeCommandBlock = getResumeCommandBlock(session);

    const handleForkPress = React.useCallback(() => {
        router.push(`/session/${sessionId}/fork-composer`);
    }, [router, sessionId]);

    // M1a: Copilot mirrors (and not-yet-hydrated placeholders) are read-only.
    // The context drawer and archived-resume hint expose fork / resume / model /
    // permission / take-over / cancel controls, so suppress both entirely. This
    // backs SessionView's own suppression as defense in depth.
    const readOnly = isReadOnlySession(session);

    const drawer = readOnly ? null : (
        <SessionContextDrawer
            machineName={machineName}
            workdirPath={session.metadata?.path}
            modelMode={drawerModelMode}
            permissionMode={drawerPermissionMode}
            canResume={canResume}
            resumeAvailability={resumeAvailability}
            resumeCommandBlock={resumeCommandBlock}
            session={session}
            machine={sessionMachine}
            onForkPress={handleForkPress}
            resumeSessionInline={resumeSessionInline}
        />
    );

    const archivedHint = (!readOnly && isInactiveArchivedSession) ? (
        <InactiveArchivedHint
            resumeCommandBlock={resumeCommandBlock}
            canResume={canResume}
            resuming={resumingSession}
            onResume={resumeSession}
        />
    ) : null;

    return { isInactiveArchivedSession: !readOnly && isInactiveArchivedSession, drawer, archivedHint };
}
