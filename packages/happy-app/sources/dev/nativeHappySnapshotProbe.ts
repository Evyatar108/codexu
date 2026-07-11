import type { Message } from '@/sync/typesMessage';

export interface NativeHappySnapshotPayload {
    sessionId: string;
    itemId: string;
    revision: number;
    text: string;
    emittedAt: number;
}

export interface NativeHappySnapshotProbeState {
    durableMessages: Message[];
    transientByKey: Record<string, NativeHappySnapshotPayload>;
}

export function createNativeHappySnapshotProbeState(): NativeHappySnapshotProbeState {
    return {
        durableMessages: [],
        transientByKey: {},
    };
}

export function getNativeHappySnapshotKey(sessionId: string, itemId: string): string {
    return `${sessionId}:${itemId}`;
}

export function getNativeHappyTransientMessageId(sessionId: string, itemId: string): string {
    return `native-happy-p0-transient:${getNativeHappySnapshotKey(sessionId, itemId)}`;
}

export function applyNativeHappySnapshot(
    state: NativeHappySnapshotProbeState,
    payload: NativeHappySnapshotPayload,
): NativeHappySnapshotProbeState {
    const durableOriginId = `codex-origin:assistant:${payload.itemId}`;
    if (state.durableMessages.some(message => (
        message.kind === 'agent-text' && message.localId === durableOriginId
    ))) {
        return state;
    }

    const key = getNativeHappySnapshotKey(payload.sessionId, payload.itemId);
    const current = state.transientByKey[key];
    if (current && payload.revision <= current.revision) {
        return state;
    }

    return {
        ...state,
        transientByKey: {
            ...state.transientByKey,
            [key]: payload,
        },
    };
}

export function applyNativeHappyDurableFinal(
    state: NativeHappySnapshotProbeState,
    sessionId: string,
    message: Extract<Message, { kind: 'agent-text' }>,
): NativeHappySnapshotProbeState {
    const itemId = message.localId?.startsWith('codex-origin:assistant:')
        ? message.localId.slice('codex-origin:assistant:'.length)
        : null;
    const transientByKey = { ...state.transientByKey };
    if (itemId) {
        delete transientByKey[getNativeHappySnapshotKey(sessionId, itemId)];
    }

    const durableMessages = state.durableMessages.filter(existing => existing.id !== message.id);
    durableMessages.push(message);

    return {
        durableMessages,
        transientByKey,
    };
}

export function selectNativeHappySnapshotMessages(state: NativeHappySnapshotProbeState): Message[] {
    const transientMessages: Message[] = Object.values(state.transientByKey).map(payload => ({
        kind: 'agent-text',
        id: getNativeHappyTransientMessageId(payload.sessionId, payload.itemId),
        localId: null,
        createdAt: payload.emittedAt,
        seq: Number.MAX_SAFE_INTEGER,
        text: payload.text,
    }));

    return [...state.durableMessages, ...transientMessages];
}

/**
 * Canonical P0 renderer fixture: the ordered full-text snapshot sequence
 * (revision 7 then revision 8) followed by the durable assistant final that
 * removes the transient item. These are the same values `verifyRendererReplacement`
 * asserts against; centralizing them lets the dev-only visual-check seed and the
 * focused tests exercise the exact production render path without the J0 transport.
 */
export const NATIVE_HAPPY_P0_RENDERER_FIXTURE = {
    itemId: 'compat-item',
    snapshots: [
        { revision: 7, text: 'compat snapshot' },
        { revision: 8, text: 'compat snapshot resumed' },
    ],
    finalMessageId: 'compat-durable-final',
    finalText: 'compat durable final replaces transient snapshot',
} as const;

export function buildNativeHappyRendererFixtureState(sessionId: string): NativeHappySnapshotProbeState {
    const emittedBase = 1_700_000_000_000;
    let state = createNativeHappySnapshotProbeState();
    NATIVE_HAPPY_P0_RENDERER_FIXTURE.snapshots.forEach((snapshot, index) => {
        state = applyNativeHappySnapshot(state, {
            sessionId,
            itemId: NATIVE_HAPPY_P0_RENDERER_FIXTURE.itemId,
            revision: snapshot.revision,
            text: snapshot.text,
            emittedAt: emittedBase + index,
        });
    });

    const finalMessage: Extract<Message, { kind: 'agent-text' }> = {
        kind: 'agent-text',
        id: NATIVE_HAPPY_P0_RENDERER_FIXTURE.finalMessageId,
        localId: `codex-origin:assistant:${NATIVE_HAPPY_P0_RENDERER_FIXTURE.itemId}`,
        createdAt: emittedBase + 100,
        seq: 1,
        text: NATIVE_HAPPY_P0_RENDERER_FIXTURE.finalText,
    };
    return applyNativeHappyDurableFinal(state, sessionId, finalMessage);
}
