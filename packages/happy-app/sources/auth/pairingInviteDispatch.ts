import {
    LOCAL_PAIRING_INVITE_KIND,
    decodeBase64,
} from '@slopus/happy-wire';

export type PairingEnrollmentKind = 'local' | 'public';

/**
 * Local pairing is selected only by its explicit invite kind. A token carrying
 * that kind never falls through to the public validator, even when malformed.
 * Public invites retain their legacy shape, which has no kind discriminator.
 */
export function selectPairingEnrollment(token: string): PairingEnrollmentKind {
    return readInviteKind(token) === LOCAL_PAIRING_INVITE_KIND ? 'local' : 'public';
}

function readInviteKind(token: string): unknown {
    try {
        const standard = token.trim().replace(/-/g, '+').replace(/_/g, '/');
        const json = new TextDecoder().decode(decodeBase64(standard));
        const payload = JSON.parse(json) as unknown;
        return payload && typeof payload === 'object' && !Array.isArray(payload)
            ? (payload as Record<string, unknown>).kind
            : undefined;
    } catch {
        return undefined;
    }
}
