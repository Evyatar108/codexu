import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import {
    SessionOutputSnapshotEphemeralUpdateSchema,
    sessionEnvelopeSchema,
    type SessionOutputSnapshotPayload,
} from '@slopus/happy-wire';

import {
    applySessionOutputSnapshot,
    clearSessionOutputSnapshotForDurableMessage,
    clearSessionOutputSnapshotsForMachine,
    composeSessionMessagesWithSnapshots,
    localizeSessionOutputSnapshot,
    type SessionOutputSnapshotMap,
} from './sessionOutputSnapshot';
import { decodeLegacyPlainJsonApiMessage, parseLegacyPlainJson } from './legacyPlainJsonCodec';
import { RawRecordSchema } from './typesRaw';
import type { Message } from './typesMessage';

interface LocalVectors {
    snapshot: {
        payload: SessionOutputSnapshotPayload;
        ephemeralUpdate: Record<string, unknown>;
    };
    legacyPlainJsonV1: {
        sessionEnvelope: Record<string, unknown>;
        rawRecord: Record<string, unknown>;
        outerContent: { t: 'encrypted'; c: string };
        metadata: string;
        agentState: string;
    };
}

const vectors = JSON.parse(
    readFileSync(
        new URL('../../../happy-wire/src/fixtures/happy_local_v1_vectors.json', import.meta.url),
        'utf8',
    ),
) as LocalVectors;

describe('session output snapshot compatibility', () => {
    it('loads the shared fixture and localizes the bare session id with its authenticated source machine', () => {
        const update = SessionOutputSnapshotEphemeralUpdateSchema.parse(vectors.snapshot.ephemeralUpdate);
        const localized = localizeSessionOutputSnapshot(update, 'machine-a');

        expect(localized.sessionId).toBe(`machine-a:${vectors.snapshot.payload.sessionId}`);
        expect(localized.itemId).toBe(vectors.snapshot.payload.itemId);
    });

    it('keeps only the latest monotonic full-text revision', () => {
        const base = localizeSessionOutputSnapshot(vectors.snapshot.payload, 'machine-a');
        let snapshots: SessionOutputSnapshotMap = {};
        snapshots = applySessionOutputSnapshot(snapshots, { ...base, revision: 7, text: 'revision 7' });
        const revision7 = snapshots;
        snapshots = applySessionOutputSnapshot(snapshots, { ...base, revision: 8, text: 'revision 8' });
        const revision8 = snapshots;
        snapshots = applySessionOutputSnapshot(snapshots, { ...base, revision: 8, text: 'duplicate' });
        snapshots = applySessionOutputSnapshot(snapshots, { ...base, revision: 6, text: 'stale' });

        expect(revision8).not.toBe(revision7);
        expect(snapshots).toBe(revision8);
        expect(Object.values(snapshots)).toHaveLength(1);
        expect(Object.values(snapshots)[0]).toMatchObject({ revision: 8, text: 'revision 8' });
    });

    it('clears on the durable assistant local id and rejects a late snapshot after the final exists', () => {
        const payload = localizeSessionOutputSnapshot(vectors.snapshot.payload, 'machine-a');
        const durable: Extract<Message, { kind: 'agent-text' }> = {
            kind: 'agent-text',
            id: 'durable-final',
            localId: `codex-origin:assistant:${payload.itemId}`,
            createdAt: payload.emittedAt + 1,
            seq: 10,
            text: 'durable final',
        };

        const withSnapshot = applySessionOutputSnapshot({}, payload);
        const cleared = clearSessionOutputSnapshotForDurableMessage(
            withSnapshot,
            payload.sessionId,
            durable.localId,
        );
        expect(cleared).toEqual({});
        expect(applySessionOutputSnapshot(cleared, { ...payload, revision: 8 }, [durable])).toBe(cleared);
        expect(composeSessionMessagesWithSnapshots([durable], withSnapshot, payload.sessionId)).toEqual([durable]);
    });

    it('starts from an empty memory-only map instead of hydrating a prior snapshot', () => {
        const payload = localizeSessionOutputSnapshot(vectors.snapshot.payload, 'machine-a');
        const liveState = applySessionOutputSnapshot({}, payload);
        const restartedState: SessionOutputSnapshotMap = {};

        expect(Object.keys(liveState)).toHaveLength(1);
        expect(restartedState).toEqual({});
    });

    it('drops disconnected-machine snapshots so reconnect restores only live replay', () => {
        const machineASnapshot = localizeSessionOutputSnapshot(vectors.snapshot.payload, 'machine-a');
        const machineBSnapshot = localizeSessionOutputSnapshot(vectors.snapshot.payload, 'machine-b');
        const snapshots = applySessionOutputSnapshot(
            applySessionOutputSnapshot({}, machineASnapshot),
            machineBSnapshot,
        );

        const cleared = clearSessionOutputSnapshotsForMachine(snapshots, 'machine-a');
        expect(Object.values(cleared)).toEqual([machineBSnapshot]);
        expect(clearSessionOutputSnapshotsForMachine(cleared, 'machine-a')).toBe(cleared);
    });

    it('inserts transient rows without reordering durable seq-desc history', () => {
        const payload = {
            ...localizeSessionOutputSnapshot(vectors.snapshot.payload, 'machine-a'),
            emittedAt: 250,
        };
        const durable: Message[] = [
            { kind: 'agent-text', id: 'pending', localId: null, createdAt: 300, seq: Number.MAX_SAFE_INTEGER, text: 'pending' },
            { kind: 'agent-text', id: 'seq-3', localId: null, createdAt: 100, seq: 3, text: 'three' },
            { kind: 'agent-text', id: 'seq-2', localId: null, createdAt: 500, seq: 2, text: 'two' },
            { kind: 'agent-text', id: 'seq-1', localId: null, createdAt: 200, seq: 1, text: 'one' },
        ];

        const composed = composeSessionMessagesWithSnapshots(
            durable,
            applySessionOutputSnapshot({}, payload),
            payload.sessionId,
        );

        expect(composed.map(message => message.id)).toEqual([
            'pending',
            expect.stringContaining('happy-session-output-snapshot:'),
            'seq-3',
            'seq-2',
            'seq-1',
        ]);
        expect(composed.filter(message => !message.id.startsWith('happy-session-output-snapshot:')))
            .toEqual(durable);
    });
});

describe('LegacyPlainJsonV1 app decoding', () => {
    it('parses the plaintext SessionEnvelope inside the legacy encrypted-shaped outer record', () => {
        const decoded = decodeLegacyPlainJsonApiMessage({
            id: 'message-1',
            seq: 1,
            localId: `codex-origin:assistant:${vectors.snapshot.payload.itemId}`,
            content: vectors.legacyPlainJsonV1.outerContent,
            createdAt: vectors.snapshot.payload.emittedAt,
            updatedAt: vectors.snapshot.payload.emittedAt,
        });

        expect(decoded).not.toBeNull();
        expect(sessionEnvelopeSchema.parse(vectors.legacyPlainJsonV1.sessionEnvelope))
            .toEqual(vectors.legacyPlainJsonV1.sessionEnvelope);
        expect(decoded?.content).toEqual(vectors.legacyPlainJsonV1.rawRecord);
        expect(RawRecordSchema.parse(decoded?.content)).toEqual({
            role: 'session',
            content: {
                type: 'session',
                data: vectors.legacyPlainJsonV1.sessionEnvelope,
            },
        });
    });

    it('parses plaintext metadata and agent state without consulting the endpoint URL', () => {
        expect(parseLegacyPlainJson(vectors.legacyPlainJsonV1.metadata, null)).toEqual({
            path: 'C:\\fixture',
            flavor: 'codex',
        });
        expect(parseLegacyPlainJson(vectors.legacyPlainJsonV1.agentState, null)).toEqual({
            turnActive: false,
        });
    });
});
