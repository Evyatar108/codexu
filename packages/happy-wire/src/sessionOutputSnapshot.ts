import * as z from 'zod';

export const SESSION_OUTPUT_SNAPSHOT_TYPE = 'session-output-snapshot' as const;
export const SESSION_OUTPUT_SNAPSHOT_TEXT_MAX_BYTES = 1024 * 1024;
export const SESSION_OUTPUT_SNAPSHOT_ID_MAX_CHARS = 256;

const boundedIdentity = z.string().min(1).max(SESSION_OUTPUT_SNAPSHOT_ID_MAX_CHARS);

export const SessionOutputSnapshotPayloadSchema = z.object({
  sessionId: boundedIdentity,
  threadId: boundedIdentity,
  turnId: boundedIdentity,
  itemId: boundedIdentity,
  revision: z.number().int().nonnegative(),
  text: z.string().refine(
    value => new TextEncoder().encode(value).byteLength <= SESSION_OUTPUT_SNAPSHOT_TEXT_MAX_BYTES,
    `text must be at most ${SESSION_OUTPUT_SNAPSHOT_TEXT_MAX_BYTES} UTF-8 bytes`,
  ),
  emittedAt: z.number().int().nonnegative(),
}).strict();

export type SessionOutputSnapshotPayload = z.infer<typeof SessionOutputSnapshotPayloadSchema>;

export const SessionOutputSnapshotEphemeralUpdateSchema = SessionOutputSnapshotPayloadSchema.extend({
  type: z.literal(SESSION_OUTPUT_SNAPSHOT_TYPE),
  id: boundedIdentity,
}).strict().superRefine((update, context) => {
  if (update.id !== update.sessionId) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['id'],
      message: 'ephemeral update id must equal sessionId',
    });
  }
});

export type SessionOutputSnapshotEphemeralUpdate = z.infer<typeof SessionOutputSnapshotEphemeralUpdateSchema>;

export function getSessionOutputSnapshotKey(sessionId: string, itemId: string): string {
  return `${sessionId}:${itemId}`;
}

export function getSessionOutputSnapshotTransientMessageId(sessionId: string, itemId: string): string {
  return `happy-session-output-snapshot:${getSessionOutputSnapshotKey(sessionId, itemId)}`;
}
