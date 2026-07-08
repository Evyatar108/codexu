import { describe, expect, it, vi } from 'vitest';
import { PUBLIC_PAIRING_INVITE_TEST_VECTOR } from '@slopus/happy-wire';

import {
    CF_ACCESS_CLIENT_ID_HEADER,
    CF_ACCESS_CLIENT_SECRET_HEADER,
    PAIRING_NONCE_HEADER,
    PAIRING_SECRET_HEADER,
    PublicEnrollmentError,
    enrollPublicServer,
} from './publicEnrollment';
import type { DeviceKeypair } from './deviceKeypair';

const validToken = PUBLIC_PAIRING_INVITE_TEST_VECTOR.token;
const invite = PUBLIC_PAIRING_INVITE_TEST_VECTOR.invite;
const withinWindow = () => Date.parse('2026-05-11T12:05:00.000Z');

const keypair: DeviceKeypair = {
    keyId: 'device-key-fixture',
    publicKey: 'ZGV2aWNlLXB1YmxpYy1rZXk=',
    secretKey: 'ZGV2aWNlLXNlY3JldC1zZWVk',
};

function serverResponse() {
    return new Response(JSON.stringify({
        githubLogin: 'octocat',
        machine: {
            machineId: 'server-machine-id',
            // Deliberately a loopback fallback: enrollment must ignore it and
            // keep the invite URL the app actually reached through Cloudflare.
            tunnelUrl: 'http://127.0.0.1:3005',
            ed25519PublicKey: 'srv-ed',
            x25519PublicKey: 'srv-x',
        },
    }), { status: 200 });
}

describe('enrollPublicServer', () => {
    it('posts /pair/complete with CF-Access + pairing headers and persists Access + device creds', async () => {
        const fetchMock = vi.fn(async () => serverResponse());

        const { credentials, invite: parsed } = await enrollPublicServer(validToken, {
            fetch: fetchMock as unknown as typeof fetch,
            generateKeypair: async () => keypair,
            generateNonce: () => 'fixed-nonce',
            now: withinWindow,
        });

        expect(fetchMock).toHaveBeenCalledTimes(1);
        const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
        expect(url).toBe('https://happy.example.com/pair/complete');
        expect(init.method).toBe('POST');
        expect(init.headers).toMatchObject({
            'Content-Type': 'application/json',
            [CF_ACCESS_CLIENT_ID_HEADER]: invite.cloudflareAccess.clientId,
            [CF_ACCESS_CLIENT_SECRET_HEADER]: invite.cloudflareAccess.clientSecret,
            [PAIRING_SECRET_HEADER]: invite.pairSecret,
            [PAIRING_NONCE_HEADER]: 'fixed-nonce',
        });
        expect(JSON.parse(init.body as string)).toEqual({
            deviceEd25519PublicKey: keypair.publicKey,
            deviceKeyId: keypair.keyId,
        });

        expect(parsed.machineId).toBe(invite.machineId);
        expect(credentials).toEqual({
            machineId: 'server-machine-id',
            tunnelUrl: 'https://happy.example.com',
            firstSeenAt: withinWindow(),
            login: 'octocat',
            cloudflareAccessClientId: invite.cloudflareAccess.clientId,
            cloudflareAccessClientSecret: invite.cloudflareAccess.clientSecret,
            deviceKeyId: keypair.keyId,
            devicePublicKey: keypair.publicKey,
            deviceSecretKey: keypair.secretKey,
        });
    });

    it('rejects a malformed invite token', async () => {
        await expect(enrollPublicServer('not-a-valid-invite', { fetch: vi.fn() as never }))
            .rejects.toMatchObject({ code: 'invalid_invite' });
    });

    it('rejects an invite outside its validity window', async () => {
        await expect(enrollPublicServer(validToken, {
            fetch: vi.fn() as never,
            generateKeypair: async () => keypair,
            now: () => Date.parse('2026-05-11T13:00:00.000Z'),
        })).rejects.toMatchObject({ code: 'invite_expired' });
    });

    it('maps a 401 to a pairing_denied error and leaks no credentials', async () => {
        const fetchMock = vi.fn(async () => new Response(JSON.stringify({ error: 'pairing_denied' }), { status: 401 }));
        await expect(enrollPublicServer(validToken, {
            fetch: fetchMock as unknown as typeof fetch,
            generateKeypair: async () => keypair,
            generateNonce: () => 'n',
            now: withinWindow,
        })).rejects.toBeInstanceOf(PublicEnrollmentError);
    });

    it('maps a non-ok server response to pair_failed', async () => {
        const fetchMock = vi.fn(async () => new Response(JSON.stringify({ error: 'tofu_public_keys_unavailable' }), { status: 503 }));
        await expect(enrollPublicServer(validToken, {
            fetch: fetchMock as unknown as typeof fetch,
            generateKeypair: async () => keypair,
            generateNonce: () => 'n',
            now: withinWindow,
        })).rejects.toMatchObject({ code: 'pair_failed' });
    });
});
