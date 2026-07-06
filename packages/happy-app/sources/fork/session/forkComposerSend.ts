/**
 * FORK PATCH: [RESTORE-R8a] SessionView controlled-composer send-runner (invariant HA-4).
 *
 * Pure, dependency-injected extraction of SessionView's composer `onSend` body —
 * the fork's pre-send slash-command intercept + attachment upload/send pipeline
 * (catalogue rows 4d + 4e). Kept React-Native-free so `useForkComposer.test.ts`
 * can exercise the real send logic under the Vitest node runner without importing
 * RN or the sync singleton. `useForkComposer` wires the live deps (sync/storage/
 * Modal) around this runner, so the rendered behavior is byte-identical to the
 * pre-R8 inline handler. See docs/happy-patch-surface.md (HA-4).
 */
import { dedupeAttachmentNames, sanitizeAttachmentName } from '@/utils/attachmentName';
import type { PreSendCommandResult } from '@/hooks/usePreSendCommand';
import type { AttachmentRef, SendMessageOptions } from '@/sync/sync';
import type { FileAttachment } from '@/hooks/useFileAttachmentCore';

export interface MutableRef<T> {
    current: T;
}

export interface ForkComposerSendDeps {
    sessionId: string;
    message: string;
    preSendCommand: (command: string) => PreSendCommandResult;
    composeStartAtRef: MutableRef<number | null>;
    messageRef: MutableRef<string>;
    setMessage: (value: string) => void;
    clearDraft: () => void;
    generateLocalMessageId: () => string;
    writeFile: (
        sessionId: string,
        path: string,
        base64: string,
        options: { createParents: boolean },
    ) => Promise<{ success: boolean; error?: string }>;
    sendMessage: (sessionId: string, body: string, options: SendMessageOptions) => Promise<void>;
    buildMessageWithAttachmentRefs: (text: string, attachmentRefs: { remotePath: string }[]) => string;
    alertUploadError: (error: string | undefined) => void;
}

/**
 * Executes a composer send exactly as the pre-R8 inline `onSend` did:
 *   1. trim + pre-send slash-command intercept (short-circuits before the injected send),
 *   2. attachment upload sequencing (dedupe -> write -> build attachment refs),
 *   3. optimistic draft-clear + rollback on send failure.
 *
 * Returns `false` when the send was intercepted / aborted / failed (mirrors the
 * original), `true` on a successful send, and `undefined` when there was nothing
 * to send. The two `switchMode` branches are preserved verbatim from the inline
 * handler to guarantee identical behavior.
 */
export async function runForkComposerSend(
    deps: ForkComposerSendDeps,
    switchMode: 'now' | 'when-idle',
    attachments: readonly FileAttachment[],
): Promise<boolean | undefined> {
    const {
        sessionId,
        message,
        preSendCommand,
        composeStartAtRef,
        messageRef,
        setMessage,
        clearDraft,
        generateLocalMessageId,
        writeFile,
        sendMessage,
        buildMessageWithAttachmentRefs,
        alertUploadError,
    } = deps;

    const trimmedMessage = message.trim();
    if (trimmedMessage || attachments.length > 0) {
        const intercept = preSendCommand(trimmedMessage);
        composeStartAtRef.current = null;
        if (trimmedMessage && intercept.intercepted) {
            setMessage('');
            clearDraft();
            intercept.execute();
            return false;
        }

        const localId = attachments.length > 0 ? generateLocalMessageId() : undefined;
        const dedupedNames = dedupeAttachmentNames(attachments.map((file) => sanitizeAttachmentName(file.name)));
        const attachmentRefs: AttachmentRef[] = attachments.map((file, index) => ({
            remotePath: `.happy/attachments/${localId}/${dedupedNames[index]}`,
            name: dedupedNames[index],
            size: file.size,
        }));

        for (const [index, attachment] of attachments.entries()) {
            const result = await writeFile(
                sessionId,
                attachmentRefs[index].remotePath,
                attachment.base64,
                { createParents: true },
            );

            if (!result.success) {
                alertUploadError(result.error);
                return false;
            }
        }

        const body = buildMessageWithAttachmentRefs(message, attachmentRefs);
        const sendOptions: SendMessageOptions = {
            source: 'chat' as const,
            switchMode,
            ...(localId ? { localId, attachmentRefs, displayText: message } : {}),
        };

        if (switchMode === 'when-idle') {
            const snapshot = message;
            messageRef.current = '';
            setMessage('');
            clearDraft();
            try {
                await sendMessage(sessionId, body, sendOptions);
            } catch {
                if (messageRef.current === '') {
                    messageRef.current = snapshot;
                    setMessage(snapshot);
                }
                return false;
            }
        } else {
            const snapshot = message;
            messageRef.current = '';
            setMessage('');
            clearDraft();
            try {
                await sendMessage(sessionId, body, sendOptions);
            } catch {
                if (messageRef.current === '') {
                    messageRef.current = snapshot;
                    setMessage(snapshot);
                }
                return false;
            }
        }
        return true;
    }
    return undefined;
}
