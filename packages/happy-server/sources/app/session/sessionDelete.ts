import { inTx, afterTx } from "@/storage/inTx";
import { buildDeleteSessionUpdate, type EventRouter } from "@/app/events/eventRouter";
import { allocateUpdateSeq } from "@/storage/seq";
import { randomKeyNaked } from "@/utils/randomKeyNaked";
import { log } from "@/utils/log";
import { deleteSessionAttachments } from "@/storage/files";

/**
 * Delete a session and all its related data.
 * Handles:
 * - Deleting all session messages
 * - Deleting the session itself
 * - Sending socket notification to all connected clients
 *
 * @param sessionId - ID of the session to delete
 * @returns true if deletion was successful, false if the session was not found
 */
export async function sessionDelete(sessionId: string, eventRouter: EventRouter): Promise<boolean> {
    return await inTx(async (tx) => {
        // Verify session exists and belongs to the user
        const session = await tx.session.findFirst({
            where: {
                id: sessionId,
            }
        });

        if (!session) {
            log({
                module: 'session-delete',
                sessionId
            }, `Session not found`);
            return false;
        }

        // Delete all related data
        // Note: Order matters to avoid foreign key constraint violations

        // 1. Delete session messages
        const deletedMessages = await tx.sessionMessage.deleteMany({
            where: { sessionId }
        });
        log({
            module: 'session-delete',
            sessionId,
            deletedCount: deletedMessages.count
        }, `Deleted ${deletedMessages.count} session messages`);

        // 2. Delete the session itself
        await tx.session.delete({
            where: { id: sessionId }
        });
        log({
            module: 'session-delete',
            sessionId
        }, `Session deleted successfully`);

        // Send notification after transaction commits
        afterTx(tx, async () => {
            const updSeq = await allocateUpdateSeq();
            const updatePayload = buildDeleteSessionUpdate(sessionId, updSeq, randomKeyNaked(12));

            log({
                module: 'session-delete',
                sessionId,
                updateType: 'delete-session',
                updatePayload: JSON.stringify(updatePayload)
            }, `Emitting delete-session update to user-scoped connections`);

            eventRouter.emitUpdate({
                payload: updatePayload,
                recipientFilter: { type: 'user-scoped-only' }
            });

            // FORK PATCH: [KEEP] adopted upstream's session-attachment storage GC on delete (cli-1.1.10), adapted to single-user logging — no `userId`/`ctx.uid` (the account plane was removed with the multi-tenant identity graph, HS-6) (invariant HS-18)
            try {
                await deleteSessionAttachments(sessionId);
                log({ module: 'session-delete', sessionId }, `Attachment blobs deleted`);
            } catch (err) {
                log({ module: 'session-delete', sessionId, err }, `Failed to delete attachment blobs (non-fatal)`);
            }
        });

        return true;
    });
}
