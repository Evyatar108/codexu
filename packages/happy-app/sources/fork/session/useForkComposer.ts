/**
 * FORK PATCH: [RESTORE-R8a] SessionView controlled-draft composer + pre-send intercept (invariant HA-4).
 *
 * Fork-owned seam for SessionView's controlled composer (catalogue rows 4d + 4e):
 * owns the draft `message` state + refs, the `useDraft` auto-save wiring, the
 * `usePreSendCommand` slash-command pre-send intercept, the compose-start tracking
 * (consumed by the boundary advisory seam), and the full `onSend` handler
 * (attachment upload sequencing + optimistic draft-clear/rollback). SessionView
 * calls `useForkComposer(sessionId, session)` and spreads `composer.inputProps`
 * onto `<AgentInput>`, so the composer behavior is byte-identical to the pre-R8
 * inline handler. The SYNC-R5 send-policy props (permission/model/effort, abort /
 * pending-switch) stay in SessionView and are NOT owned here. The `onSend` body
 * itself lives in the RN-free `./forkComposerSend` runner so it can be unit-tested.
 * See docs/happy-patch-surface.md (HA-4).
 */
import * as React from 'react';
import { useDraft } from '@/hooks/useDraft';
import { usePreSendCommand } from '@/hooks/usePreSendCommand';
import { Modal } from '@/modal';
import { updateComposeStartAt } from '@/-session/composeBoundaryAdvisory';
import { sessionWriteFile } from '@/sync/ops';
import { generateLocalMessageId, sync } from '@/sync/sync';
import { Session } from '@/sync/storageTypes';
import { t } from '@/text';
import { getSessionMode } from '@/utils/sessionUtils';
import { buildMessageWithAttachmentRefs } from '@/components/composer/AttachmentChip';
import type { FileAttachment } from '@/hooks/useFileAttachmentCore';
import { isReadOnlySession } from '@/sync/storage';
import { runForkComposerSend } from './forkComposerSend';

/**
 * Whether the composer may queue a "send when idle" for a live local-Claude turn.
 * Relocated verbatim from SessionView (still re-exported there for back-compat).
 */
export function getCanSendWhenIdle(session: Session): boolean {
    return session.metadata?.flavor === 'claude'
        && getSessionMode(session) === 'local'
        && session.agentState?.turnActive === true
        && session.agentState?.pendingSwitch == null;
}

export interface ForkComposerInputProps {
    value: string;
    onChangeText: (next: string) => void;
    blockSend: boolean;
    canSendWhenIdle: boolean;
    onSend: (switchMode: 'now' | 'when-idle', attachments: readonly FileAttachment[]) => Promise<boolean | undefined>;
}

export interface ForkComposer {
    message: string;
    messageRef: React.MutableRefObject<string>;
    composeStartAtRef: React.MutableRefObject<number | null>;
    clearDraft: () => void;
    canSendWhenIdle: boolean;
    inputProps: ForkComposerInputProps;
}

export function useForkComposer(sessionId: string, session: Session): ForkComposer {
    const [message, setMessage] = React.useState('');
    const messageRef = React.useRef('');
    const composeStartAtRef = React.useRef<number | null>(null);
    const preSendCommand = usePreSendCommand(sessionId);

    // Use draft hook for auto-saving message drafts
    const { clearDraft } = useDraft(sessionId, message, setMessage);
    const canSendWhenIdle = getCanSendWhenIdle(session);

    // M1a: Copilot mirrors (and not-yet-hydrated placeholders) are read-only.
    // SessionView never mounts AgentInput for them, but block send here too as
    // defense in depth so no alternate caller of this seam can dispatch input.
    const readOnly = isReadOnlySession(session);

    const handleChangeMessage = React.useCallback((nextMessage: string) => {
        messageRef.current = nextMessage;
        setMessage((previousMessage) => {
            composeStartAtRef.current = updateComposeStartAt(
                composeStartAtRef.current,
                previousMessage,
                nextMessage,
                Date.now(),
            );
            return nextMessage;
        });
    }, []);

    const onSend = React.useCallback(
        (switchMode: 'now' | 'when-idle', attachments: readonly FileAttachment[]) => {
            // Defense in depth: a read-only mirror must never dispatch user input.
            if (readOnly) {
                return Promise.resolve<boolean | undefined>(undefined);
            }
            return runForkComposerSend(
                {
                    sessionId,
                    message,
                    preSendCommand,
                    composeStartAtRef,
                    messageRef,
                    setMessage,
                    clearDraft,
                    generateLocalMessageId,
                    writeFile: sessionWriteFile,
                    sendMessage: async (id, body, options) => {
                        await sync.sendMessage(id, body, options);
                    },
                    buildMessageWithAttachmentRefs,
                    alertUploadError: (error) => {
                        Modal.alert(t('common.error'), error || t('errors.attachmentUploadFailed'), [{ text: t('common.ok') }]);
                    },
                },
                switchMode,
                attachments,
            );
        },
        [readOnly, sessionId, message, preSendCommand, clearDraft],
    );

    return {
        message,
        messageRef,
        composeStartAtRef,
        clearDraft,
        canSendWhenIdle,
        inputProps: {
            value: message,
            onChangeText: handleChangeMessage,
            blockSend: readOnly,
            canSendWhenIdle,
            onSend,
        },
    };
}
