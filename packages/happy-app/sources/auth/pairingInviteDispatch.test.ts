import { describe, expect, it } from 'vitest';

import {
    LOCAL_PAIRING_INVITE_KIND,
    PUBLIC_PAIRING_INVITE_TEST_VECTOR,
    encodeBase64,
} from '@slopus/happy-wire';

import { selectPairingEnrollment } from './pairingInviteDispatch';

function encodeToken(payload: unknown): string {
    return encodeBase64(new TextEncoder().encode(JSON.stringify(payload)))
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/g, '');
}

describe('pairing invite dispatch', () => {
    it('preserves the legacy public invite path when no local kind is present', () => {
        expect(selectPairingEnrollment(PUBLIC_PAIRING_INVITE_TEST_VECTOR.token)).toBe('public');
        expect(selectPairingEnrollment('not-an-invite')).toBe('public');
    });

    it('selects local enrollment only from the explicit local invite kind', () => {
        expect(selectPairingEnrollment(encodeToken({
            kind: LOCAL_PAIRING_INVITE_KIND,
            version: 1,
        }))).toBe('local');
    });

    it('never falls a malformed local-kind invite through to public enrollment', () => {
        const publicInviteWithLocalKind = {
            ...PUBLIC_PAIRING_INVITE_TEST_VECTOR.invite,
            kind: LOCAL_PAIRING_INVITE_KIND,
        };

        expect(selectPairingEnrollment(encodeToken(publicInviteWithLocalKind))).toBe('local');
    });
});
