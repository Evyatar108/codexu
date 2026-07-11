import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import {
  SESSION_OUTPUT_SNAPSHOT_TEXT_MAX_BYTES,
  SessionOutputSnapshotEphemeralUpdateSchema,
  SessionOutputSnapshotPayloadSchema,
  getSessionOutputSnapshotKey,
  getSessionOutputSnapshotTransientMessageId,
} from './index';

interface LocalVectors {
  snapshot: {
    payload: Record<string, unknown>;
    ephemeralUpdate: Record<string, unknown>;
  };
}

const vectors = JSON.parse(
  readFileSync(new URL('./fixtures/happy_local_v1_vectors.json', import.meta.url), 'utf8'),
) as LocalVectors;

describe('session output snapshot', () => {
  it('loads the shared payload and ephemeral update fixtures', () => {
    expect(SessionOutputSnapshotPayloadSchema.parse(vectors.snapshot.payload)).toEqual(vectors.snapshot.payload);
    expect(SessionOutputSnapshotEphemeralUpdateSchema.parse(vectors.snapshot.ephemeralUpdate))
      .toEqual(vectors.snapshot.ephemeralUpdate);
  });

  it('enforces identity, revision, timestamp, exact id, and UTF-8 byte bounds', () => {
    const payload = vectors.snapshot.payload;
    expect(SessionOutputSnapshotPayloadSchema.safeParse({ ...payload, sessionId: '' }).success).toBe(false);
    expect(SessionOutputSnapshotPayloadSchema.safeParse({ ...payload, revision: -1 }).success).toBe(false);
    expect(SessionOutputSnapshotPayloadSchema.safeParse({ ...payload, revision: 1.5 }).success).toBe(false);
    expect(SessionOutputSnapshotPayloadSchema.safeParse({ ...payload, emittedAt: Number.NaN }).success).toBe(false);
    expect(SessionOutputSnapshotPayloadSchema.safeParse({
      ...payload,
      text: 'é'.repeat(SESSION_OUTPUT_SNAPSHOT_TEXT_MAX_BYTES / 2),
    }).success).toBe(true);
    expect(SessionOutputSnapshotPayloadSchema.safeParse({
      ...payload,
      text: `${'é'.repeat(SESSION_OUTPUT_SNAPSHOT_TEXT_MAX_BYTES / 2)}x`,
    }).success).toBe(false);
    expect(SessionOutputSnapshotEphemeralUpdateSchema.safeParse({
      ...vectors.snapshot.ephemeralUpdate,
      id: 'another-session',
    }).success).toBe(false);
  });

  it('derives stable session/item keys and renderer ids', () => {
    expect(getSessionOutputSnapshotKey('session-1', 'item-1')).toBe('session-1:item-1');
    expect(getSessionOutputSnapshotTransientMessageId('session-1', 'item-1'))
      .toBe('happy-session-output-snapshot:session-1:item-1');
  });
});
