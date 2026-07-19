import * as React from 'react';
import type { SpawnSessionResult } from '@/sync/ops';
import { useHappyAction } from '@/hooks/useHappyAction';
import { useNavigateToSession } from '@/hooks/useNavigateToSession';
import { Modal } from '@/modal';
import { machineResumeSession, sessionArchive, sessionKill } from '@/sync/ops';
import { maybeCleanupWorktree } from '@/hooks/useWorktreeCleanup';
import { storage, useLocalSetting, useMachine } from '@/sync/storage';
import { isCopilotSession, isPlaceholderSession } from '@/sync/storage';
import { Session } from '@/sync/storageTypes';
import { sync } from '@/sync/sync';
import { t } from '@/text';
import { HappyError } from '@/utils/errors';
import { copySessionMetadataToClipboard, copySessionMetadataAndLogsToClipboard } from '@/utils/copySessionMetadataToClipboard';
import { forkAvailability } from '@/utils/forkAvailability';
import { useSessionStatus } from '@/utils/sessionUtils';
import { getResumeAvailability } from '@/utils/resumeAvailability';
import { useRouter } from 'expo-router';
import { useSession } from '@/sync/storage';

export interface SessionActionItem {
    id: string;
    label: string;
    icon: string;
    onPress: () => void;
    destructive?: boolean;
}

interface UseSessionQuickActionsOptions {
    onAfterArchive?: () => void;
    onAfterDelete?: () => void;
    onAfterCopySessionMetadata?: () => void;
}

export function useSessionQuickActions(
    session: Session,
    options: UseSessionQuickActionsOptions = {},
) {
    const {
        onAfterArchive,
        onAfterCopySessionMetadata,
    } = options;
    const router = useRouter();
    const navigateToSession = useNavigateToSession();
    const sessionStatus = useSessionStatus(session);
    const machineId = session.metadata?.machineId ?? '';
    const machine = useMachine(machineId);
    const devModeEnabled = useLocalSetting('devModeEnabled');
    const resumeAvailability = React.useMemo(
        () => getResumeAvailability(session, machine, sessionStatus.isConnected),
        [machine, session, sessionStatus.isConnected],
    );
    const canFork = forkAvailability(session, machine);

    // M1a read-only Copilot mirror gating. This hook is the single header/list
    // action gate: the web header popover, the mobile long-press alert, and the
    // compact-list swipe all derive their actions (and archivability) from here.
    //  - placeholder (unknown, not-yet-hydrated): no actions at all.
    //  - active Copilot mirror: Details + Archive only.
    //  - inactive/archived Copilot mirror: Details only.
    //  - every other (non-Copilot) session: unchanged.
    const isCopilotMirror = isCopilotSession(session);
    const isPlaceholder = isPlaceholderSession(session);
    const isArchivedLifecycle = session.metadata?.lifecycleState === 'archived';
    const copilotArchivable = isCopilotMirror && sessionStatus.isConnected && !isArchivedLifecycle;
    const canArchive = isPlaceholder ? false : (isCopilotMirror ? copilotArchivable : true);

    const openDetails = React.useCallback(() => {
        router.push(`/session/${session.id}/info`);
    }, [router, session.id]);

    const copySessionMetadata = React.useCallback(() => {
        void (async () => {
            const copied = await copySessionMetadataToClipboard(session);
            if (copied) {
                onAfterCopySessionMetadata?.();
            }
        })();
    }, [onAfterCopySessionMetadata, session]);

    const copySessionMetadataAndLogs = React.useCallback(() => {
        void (async () => {
            const copied = await copySessionMetadataAndLogsToClipboard(session);
            if (copied) {
                onAfterCopySessionMetadata?.();
            }
        })();
    }, [onAfterCopySessionMetadata, session]);

    const resumeSessionInline = React.useCallback(async (): Promise<SpawnSessionResult> => {
        if (!resumeAvailability.canResume) {
            return { type: 'error', errorMessage: resumeAvailability.message };
        }

        if (!machineId) {
            return { type: 'error', errorMessage: t('sessionInfo.resumeSessionMissingMachine') };
        }

        const result = await machineResumeSession({
            machineId,
            sessionId: session.id,
            model: session.modelMode ?? undefined,
            permissionMode: session.permissionMode ?? undefined,
        });

        switch (result.type) {
            case 'success': {
                await sync.refreshSessions();

                if (session.permissionMode) {
                    storage.getState().updateSessionPermissionMode(result.sessionId, session.permissionMode, session.permissionModeUserChosen);
                }
                if (session.modelMode) {
                    storage.getState().updateSessionModelMode(result.sessionId, session.modelMode);
                }

                navigateToSession(result.sessionId);
                return result;
            }
            case 'requestToApproveDirectoryCreation':
            case 'error':
                return result;
        }
    }, [machineId, navigateToSession, resumeAvailability.canResume, resumeAvailability.message, session.id, session.modelMode, session.permissionMode, session.permissionModeUserChosen]);

    const [resumingSession, performResume] = useHappyAction(async () => {
        const result = await resumeSessionInline();

        switch (result.type) {
            case 'success':
                return;
            case 'requestToApproveDirectoryCreation':
                throw new HappyError(t('sessionInfo.resumeSessionUnexpectedDirectoryPrompt'), false);
            case 'error':
                throw new HappyError(result.errorMessage, false);
        }
    });

    const [archivingSession, performArchive] = useHappyAction(async () => {
        // Copilot Archive is a pure provider lifecycle request: it must never
        // touch worktree/shell/filesystem cleanup and must never fall back to the
        // server-only archive endpoint (which deactivates storage without waking
        // the relay). It calls only the provider `killSession` RPC; on failure we
        // surface the error and leave the session active for retry.
        if (isCopilotMirror) {
            const killResult = await sessionKill(session.id);
            if (!killResult.success) {
                throw new HappyError(t('sessionInfo.failedToArchiveSession'), false);
            }
            onAfterArchive?.();
            return;
        }

        await maybeCleanupWorktree(session.id, session.metadata?.path, session.metadata?.machineId);

        // Try to kill the CLI process; if it's already dead, force-archive via server
        const killResult = await sessionKill(session.id);
        if (!killResult.success) {
            await sessionArchive(session.id);
        }
        onAfterArchive?.();
    });

    const archiveSession = React.useCallback(async () => {
        const confirmed = await Modal.confirm(
            t('sessionInfo.archiveSession'),
            t('sessionInfo.archiveSessionConfirm'),
            {
                cancelText: t('common.cancel'),
                confirmText: t('common.archive'),
                destructive: true,
            },
        );

        if (confirmed) {
            performArchive();
        }
    }, [performArchive]);

    const resumeSession = React.useCallback(() => {
        performResume();
    }, [performResume]);

    const forkSession = React.useCallback(() => {
        router.push(`/session/${session.id}/fork-composer`);
    }, [router, session.id]);

    const spawnChildSession = React.useCallback(() => {
        router.push(`/session/${session.id}/spawn-child`);
    }, [router, session.id]);

    const canCopySessionMetadata = __DEV__ || devModeEnabled;

    const actionItems = React.useMemo<SessionActionItem[]>(() => {
        // Placeholder (unknown, not-yet-hydrated) sessions expose no actions.
        if (isPlaceholder) {
            return [];
        }

        const items: SessionActionItem[] = [
            { id: 'details', icon: 'information-circle-outline', label: t('profile.details'), onPress: openDetails },
        ];

        // Read-only Copilot mirror: Details, plus Archive only while active. It
        // omits resume, fork, spawn-child, and metadata copy entirely, so neither
        // the web popover nor the mobile/list long-press can reach them.
        if (isCopilotMirror) {
            if (copilotArchivable) {
                items.push({ id: 'archive', icon: 'archive-outline', label: t('sessionInfo.archiveSession'), onPress: archiveSession, destructive: true });
            }
            return items;
        }

        if (resumeAvailability.canShowResume) {
            items.push({ id: 'resume', icon: 'play-circle-outline', label: t('sessionInfo.resumeSession'), onPress: resumeSession });
        }

        if (canFork) {
            items.push({ id: 'fork', icon: 'git-branch-outline', label: t('drawer.fork.action'), onPress: forkSession });
        }

        items.push({ id: 'spawn-child', icon: 'git-network-outline', label: t('drawer.spawnChild.action'), onPress: spawnChildSession });

        if (canCopySessionMetadata) {
            items.push({ id: 'copy-metadata', icon: 'bug-outline', label: t('sessionInfo.copyMetadata'), onPress: copySessionMetadata });
            items.push({ id: 'copy-metadata-and-logs', icon: 'document-text-outline', label: t('sessionInfo.copyMetadata') + ' & Client Logs', onPress: copySessionMetadataAndLogs });
        }

        items.push({ id: 'archive', icon: 'archive-outline', label: t('sessionInfo.archiveSession'), onPress: archiveSession, destructive: true });

        return items;
    }, [
        archiveSession,
        canFork,
        canCopySessionMetadata,
        copilotArchivable,
        copySessionMetadata,
        copySessionMetadataAndLogs,
        forkSession,
        isCopilotMirror,
        isPlaceholder,
        openDetails,
        resumeAvailability.canShowResume,
        resumeSession,
        spawnChildSession,
    ]);

    const showActionAlert = React.useCallback(() => {
        const buttons: Array<{ text: string; onPress?: () => void; style?: 'cancel' | 'destructive' | 'default' }> = actionItems.map(item => ({
            text: item.label,
            onPress: item.onPress,
            style: item.destructive ? 'destructive' as const : undefined,
        }));
        buttons.push({ text: t('common.cancel'), style: 'cancel' });
        Modal.alert('Session', undefined, buttons);
    }, [actionItems]);

    return {
        actionItems,
        showActionAlert,
        archiveSession,
        archivingSession,
        canArchive,
        canCopySessionMetadata,
        canFork,
        canResume: resumeAvailability.canResume,
        canShowResume: resumeAvailability.canShowResume,
        copySessionMetadata,
        copySessionMetadataAndLogs,
        forkSession,
        openDetails,
        resumeSession,
        spawnChildSession,
        resumeSessionInline,
        resumeAvailability,
        resumeSessionSubtitle: resumeAvailability.subtitle,
        resumingSession,
    };
}

/**
 * Lightweight hook for list items that only have a sessionId.
 * Returns a long-press handler that shows the action alert on mobile.
 */
export function useSessionActionAlert(sessionId: string) {
    const session = useSession(sessionId);
    const { showActionAlert } = useSessionQuickActions(session!, {});
    return session ? showActionAlert : undefined;
}
