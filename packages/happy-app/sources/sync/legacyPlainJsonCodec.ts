import type { ApiMessage } from './apiTypes';
import type { DecryptedMessage } from './storageTypes';
import type { RawRecord } from './typesRaw';

export function parseLegacyPlainJson<T>(value: unknown, fallback: T): T {
    if (typeof value !== 'string') {
        return (value ?? fallback) as T;
    }
    try {
        return JSON.parse(value) as T;
    } catch {
        return fallback;
    }
}

export function decodeLegacyPlainJsonApiMessage(message: ApiMessage): DecryptedMessage | null {
    const content = parseLegacyPlainJson<RawRecord | null>(message.content.c, null);
    if (!content) {
        return null;
    }
    return {
        id: message.id,
        localId: message.localId ?? null,
        createdAt: message.createdAt,
        seq: message.seq,
        content,
    };
}

export function decodeLegacyPlainJsonApiMessages(
    messages: ApiMessage[],
): (DecryptedMessage | null)[] {
    return messages.map(decodeLegacyPlainJsonApiMessage);
}
