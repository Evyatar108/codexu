import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { PUBLIC_PAIRING_INVITE_TEST_VECTOR } from '@slopus/happy-wire';

import { previewPairingInvite } from './pairingInvitePreview';

const publicToken = PUBLIC_PAIRING_INVITE_TEST_VECTOR.token;
const publicInvite = PUBLIC_PAIRING_INVITE_TEST_VECTOR.invite;
const publicNow = () => Date.parse('2026-05-11T12:05:00.000Z');
const publicExpired = () => Date.parse(publicInvite.expiresAt) + 1_000;

interface LocalVectors {
    invite: {
        payload: { serverUrl: string; browserOrigin: string; machineId: string; issuedAt: string };
        token: string;
    };
}

const localVectors = JSON.parse(
    readFileSync(
        new URL('../../../happy-wire/src/fixtures/happy_local_v1_vectors.json', import.meta.url),
        'utf8',
    ),
) as LocalVectors;

const localToken = localVectors.invite.token;
const localOrigin = localVectors.invite.payload.browserOrigin;
const localNow = () => Date.parse(localVectors.invite.payload.issuedAt);

describe('previewPairingInvite', () => {
    it('previews a valid public invite with its host and expiry', () => {
        const result = previewPairingInvite(publicToken, { now: publicNow });
        expect(result).toEqual({
            ok: true,
            preview: {
                kind: 'public',
                machineId: publicInvite.machineId,
                serverUrl: publicInvite.serverUrl,
                host: new URL(publicInvite.serverUrl).host,
                expiresAt: Date.parse(publicInvite.expiresAt),
            },
        });
    });

    it('fails closed on an expired public invite', () => {
        expect(previewPairingInvite(publicToken, { now: publicExpired })).toEqual({
            ok: false,
            error: 'invite_expired',
        });
    });

    it('fails closed on a malformed token', () => {
        expect(previewPairingInvite('not-a-real-invite', { now: publicNow })).toEqual({
            ok: false,
            error: 'invalid_invite',
        });
    });

    it('previews a valid local invite when the browser origin matches', () => {
        const result = previewPairingInvite(localToken, { now: localNow, browserOrigin: localOrigin });
        expect(result.ok).toBe(true);
        if (result.ok) {
            expect(result.preview.kind).toBe('local');
            expect(result.preview.machineId).toBe(localVectors.invite.payload.machineId);
            expect(result.preview.host).toBe(new URL(localVectors.invite.payload.serverUrl).host);
        }
    });

    it('reports unsupported platform for a local invite without a browser origin', () => {
        expect(previewPairingInvite(localToken, { now: localNow })).toEqual({
            ok: false,
            error: 'unsupported_platform',
        });
    });

    it('fails closed on a local invite from the wrong origin', () => {
        expect(previewPairingInvite(localToken, {
            now: localNow,
            browserOrigin: 'http://127.0.0.1:8081',
        })).toEqual({ ok: false, error: 'invalid_invite' });
    });
});
