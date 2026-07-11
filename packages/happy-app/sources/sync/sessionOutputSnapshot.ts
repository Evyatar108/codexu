import {
    getSessionOutputSnapshotKey,
    getSessionOutputSnapshotTransientMessageId,
    type SessionOutputSnapshotPayload,
} from '@slopus/happy-wire';

import { compositeSessionId } from './machineSessionId';
import type { Message } from './typesMessage';

export const CODEX_ASSISTANT_ORIGIN_PREFIX = 'codex-origin:assistant:';

export type SessionOutputSnapshotMap = Record<string, SessionOutputSnapshotPayload>;

export function localizeSessionOutputSnapshot(
    payload: SessionOutputSnapshotPayload,
    sourceMachineId: string | undefined,
): SessionOutputSnapshotPayload {
    if (!sourceMachineId) {
        return payload;
    }
    return {
        ...payload,
        sessionId: compositeSessionId(sourceMachineId, payload.sessionId),
    };
}

export function applySessionOutputSnapshot(
    snapshots: SessionOutputSnapshotMap,
    payload: SessionOutputSnapshotPayload,
    durableMessages: readonly Message[] = [],
): SessionOutputSnapshotMap {
    if (hasDurableAssistantFinal(durableMessages, payload.itemId)) {
        return snapshots;
    }

    const key = getSessionOutputSnapshotKey(payload.sessionId, payload.itemId);
    const current = snapshots[key];
    if (current && payload.revision <= current.revision) {
        return snapshots;
    }
    return {
        ...snapshots,
        [key]: payload,
    };
}

export function clearSessionOutputSnapshotForDurableMessage(
    snapshots: SessionOutputSnapshotMap,
    sessionId: string,
    localId: string | null | undefined,
): SessionOutputSnapshotMap {
    const itemId = getDurableAssistantItemId(localId);
    if (!itemId) {
        return snapshots;
    }
    const key = getSessionOutputSnapshotKey(sessionId, itemId);
    if (!(key in snapshots)) {
        return snapshots;
    }
    const next = { ...snapshots };
    delete next[key];
    return next;
}

export function clearSessionOutputSnapshotsForSession(
    snapshots: SessionOutputSnapshotMap,
    sessionId: string,
): SessionOutputSnapshotMap {
    const entries = Object.entries(snapshots);
    if (!entries.some(([, snapshot]) => snapshot.sessionId === sessionId)) {
        return snapshots;
    }
    return Object.fromEntries(entries.filter(([, snapshot]) => snapshot.sessionId !== sessionId));
}

export function clearSessionOutputSnapshotsForMachine(
    snapshots: SessionOutputSnapshotMap,
    machineId: string,
): SessionOutputSnapshotMap {
    const prefix = `${machineId}:`;
    const entries = Object.entries(snapshots);
    if (!entries.some(([, snapshot]) => snapshot.sessionId.startsWith(prefix))) {
        return snapshots;
    }
    return Object.fromEntries(
        entries.filter(([, snapshot]) => !snapshot.sessionId.startsWith(prefix)),
    );
}

export function composeSessionMessagesWithSnapshots(
    durableMessages: readonly Message[],
    snapshots: SessionOutputSnapshotMap,
    sessionId: string,
): Message[] {
    const transientMessages: Message[] = Object.values(snapshots)
        .filter(snapshot => (
            snapshot.sessionId === sessionId
            && !hasDurableAssistantFinal(durableMessages, snapshot.itemId)
        ))
        .map(snapshot => ({
            kind: 'agent-text' as const,
            id: getSessionOutputSnapshotTransientMessageId(snapshot.sessionId, snapshot.itemId),
            localId: null,
            createdAt: snapshot.emittedAt,
            seq: Number.MAX_SAFE_INTEGER,
            text: snapshot.text,
        }))
        .sort(compareMessagesDescending);

    const composed = [...durableMessages];
    for (const transient of transientMessages) {
        const insertionIndex = composed.findIndex(message => (
            compareMessagesDescending(transient, message) < 0
        ));
        composed.splice(insertionIndex === -1 ? composed.length : insertionIndex, 0, transient);
    }
    return composed;
}

export function getDurableAssistantItemId(localId: string | null | undefined): string | null {
    return localId?.startsWith(CODEX_ASSISTANT_ORIGIN_PREFIX)
        ? localId.slice(CODEX_ASSISTANT_ORIGIN_PREFIX.length) || null
        : null;
}

function hasDurableAssistantFinal(messages: readonly Message[], itemId: string): boolean {
    const durableLocalId = `${CODEX_ASSISTANT_ORIGIN_PREFIX}${itemId}`;
    return messages.some(message => (
        message.kind === 'agent-text' && message.localId === durableLocalId
    ));
}

function compareMessagesDescending(left: Message, right: Message): number {
    if (left.seq !== right.seq) {
        return right.seq - left.seq;
    }
    return right.createdAt - left.createdAt;
}
