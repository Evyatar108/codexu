import { describe, expect, it, vi } from 'vitest';
import { runForkComposerSend, type ForkComposerSendDeps } from './forkComposerSend';
import type { FileAttachment } from '@/hooks/useFileAttachmentCore';
import type { PreSendCommandResult } from '@/hooks/usePreSendCommand';

/**
 * Wiring test for the SessionView controlled-composer send seam (HA-4, stage 5).
 * Exercises the pure `runForkComposerSend` runner that `useForkComposer.onSend`
 * delegates to, asserting the fork's pre-send slash-command intercept still fires
 * (short-circuiting before `sync.sendMessage`) and that draft state clears exactly
 * as the pre-R8 inline handler did.
 */

function makeAttachment(over: Partial<FileAttachment> = {}): FileAttachment {
    return {
        id: 'a1',
        name: 'note.txt',
        originalName: 'note.txt',
        size: 4,
        base64: 'bm90ZQ==',
        ...over,
    };
}

function makeDeps(over: Partial<ForkComposerSendDeps> = {}): {
    deps: ForkComposerSendDeps;
    setMessage: ReturnType<typeof vi.fn>;
    clearDraft: ReturnType<typeof vi.fn>;
    sendMessage: ReturnType<typeof vi.fn>;
    writeFile: ReturnType<typeof vi.fn>;
    alertUploadError: ReturnType<typeof vi.fn>;
    execute: ReturnType<typeof vi.fn>;
    composeStartAtRef: { current: number | null };
    messageRef: { current: string };
} {
    const setMessage = vi.fn();
    const clearDraft = vi.fn();
    const sendMessage = vi.fn(async () => {});
    const writeFile = vi.fn(async () => ({ success: true as const }));
    const alertUploadError = vi.fn();
    const execute = vi.fn();
    const composeStartAtRef = { current: 12345 as number | null };
    const messageRef = { current: over.message ?? '' };

    const preSendCommand = vi.fn(
        (_command: string): PreSendCommandResult => ({ intercepted: false, execute }),
    );

    const deps: ForkComposerSendDeps = {
        sessionId: 'session-1',
        message: '',
        preSendCommand,
        composeStartAtRef,
        messageRef,
        setMessage,
        clearDraft,
        generateLocalMessageId: vi.fn(() => 'local-id'),
        writeFile,
        sendMessage,
        buildMessageWithAttachmentRefs: (text, refs) =>
            refs.length === 0 ? text : `${text}\n\nAttachments:\n${refs.map((r) => `- ${r.remotePath}`).join('\n')}`,
        alertUploadError,
        ...over,
    };

    return { deps, setMessage, clearDraft, sendMessage, writeFile, alertUploadError, execute, composeStartAtRef, messageRef };
}

describe('runForkComposerSend — SessionView composer seam (HA-4)', () => {
    it('fires the pre-send intercept and does NOT call sendMessage', async () => {
        const execute = vi.fn();
        const preSendCommand = vi.fn((): PreSendCommandResult => ({ intercepted: true, execute }));
        const ctx = makeDeps({ message: '/clear', preSendCommand });

        const result = await runForkComposerSend(ctx.deps, 'now', []);

        expect(result).toBe(false);
        expect(execute).toHaveBeenCalledOnce();
        expect(ctx.sendMessage).not.toHaveBeenCalled();
        expect(ctx.setMessage).toHaveBeenCalledWith('');
        expect(ctx.clearDraft).toHaveBeenCalledOnce();
        expect(ctx.composeStartAtRef.current).toBeNull();
    });

    it('sends a plain text message when not intercepted', async () => {
        const ctx = makeDeps({ message: 'hello world' });

        const result = await runForkComposerSend(ctx.deps, 'now', []);

        expect(result).toBe(true);
        expect(ctx.sendMessage).toHaveBeenCalledOnce();
        expect(ctx.sendMessage).toHaveBeenCalledWith('session-1', 'hello world', {
            source: 'chat',
            switchMode: 'now',
        });
        expect(ctx.setMessage).toHaveBeenCalledWith('');
        expect(ctx.clearDraft).toHaveBeenCalledOnce();
        expect(ctx.composeStartAtRef.current).toBeNull();
    });

    it('uploads attachments under a generated local id before sending', async () => {
        const ctx = makeDeps({ message: 'please inspect' });

        const attachments = [
            makeAttachment({ id: 'a1', name: 'note.txt', size: 4, base64: 'bm90ZQ==' }),
            makeAttachment({ id: 'a2', name: '../NOTE.txt', size: 5, base64: 'bm90ZTI=' }),
        ];

        const result = await runForkComposerSend(ctx.deps, 'now', attachments);

        expect(result).toBe(true);
        expect(ctx.writeFile).toHaveBeenNthCalledWith(1, 'session-1', '.happy/attachments/local-id/note.txt', 'bm90ZQ==', { createParents: true });
        expect(ctx.writeFile).toHaveBeenNthCalledWith(2, 'session-1', '.happy/attachments/local-id/NOTE (2).txt', 'bm90ZTI=', { createParents: true });
        expect(ctx.sendMessage).toHaveBeenCalledWith(
            'session-1',
            'please inspect\n\nAttachments:\n- .happy/attachments/local-id/note.txt\n- .happy/attachments/local-id/NOTE (2).txt',
            {
                source: 'chat',
                switchMode: 'now',
                localId: 'local-id',
                attachmentRefs: [
                    { remotePath: '.happy/attachments/local-id/note.txt', name: 'note.txt', size: 4 },
                    { remotePath: '.happy/attachments/local-id/NOTE (2).txt', name: 'NOTE (2).txt', size: 5 },
                ],
                displayText: 'please inspect',
            },
        );
    });

    it('does not send when an attachment upload fails', async () => {
        const writeFile = vi.fn(async () => ({ success: false as const, error: 'write failed' }));
        const ctx = makeDeps({ message: 'x', writeFile });

        const result = await runForkComposerSend(ctx.deps, 'now', [makeAttachment()]);

        expect(result).toBe(false);
        expect(ctx.sendMessage).not.toHaveBeenCalled();
        expect(ctx.alertUploadError).toHaveBeenCalledWith('write failed');
    });

    it('returns undefined when there is nothing to send', async () => {
        const ctx = makeDeps({ message: '   ' });

        const result = await runForkComposerSend(ctx.deps, 'now', []);

        expect(result).toBeUndefined();
        expect(ctx.sendMessage).not.toHaveBeenCalled();
    });

    it('restores the draft snapshot when sendMessage rejects on the now path', async () => {
        const sendMessage = vi.fn(async () => { throw new Error('network'); });
        const ctx = makeDeps({ message: 'typed', sendMessage });

        const result = await runForkComposerSend(ctx.deps, 'now', []);

        expect(result).toBe(false);
        // Optimistic clear then rollback because messageRef stayed empty during the send.
        expect(ctx.setMessage).toHaveBeenCalledWith('');
        expect(ctx.setMessage).toHaveBeenLastCalledWith('typed');
        expect(ctx.messageRef.current).toBe('typed');
    });

    it('does NOT restore the snapshot if the user typed during an in-flight rejection', async () => {
        let rejectSend!: (e: Error) => void;
        const sendMessage = vi.fn(() => new Promise<void>((_, reject) => { rejectSend = reject; }));
        const ctx = makeDeps({ message: 'original', sendMessage });

        const pending = runForkComposerSend(ctx.deps, 'now', []);
        // Simulate the user typing a fresh draft while the send is in flight.
        ctx.messageRef.current = 'new draft';
        rejectSend(new Error('rpc failed'));

        const result = await pending;

        expect(result).toBe(false);
        expect(ctx.messageRef.current).toBe('new draft');
        expect(ctx.setMessage).not.toHaveBeenCalledWith('original');
    });
});
