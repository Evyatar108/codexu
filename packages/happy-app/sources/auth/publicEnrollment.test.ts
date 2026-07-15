import { describe, expect, it, vi } from 'vitest';
import {
    PUBLIC_DEVICE_AUTH_TEST_VECTOR,
    PUBLIC_DEVICE_PROOF_HEADER,
    PUBLIC_PAIRING_INVITE_TEST_VECTOR,
    encodeBase64,
    signPairCompleteResponse,
} from '@slopus/happy-wire';
import * as ed from '@noble/ed25519';

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
    keyId: PUBLIC_DEVICE_AUTH_TEST_VECTOR.keyId,
    publicKey: PUBLIC_DEVICE_AUTH_TEST_VECTOR.publicKeyBase64,
    secretKey: encodeBase64(Uint8Array.from(
        PUBLIC_DEVICE_AUTH_TEST_VECTOR.seedHex.match(/../g)!.map(value => Number.parseInt(value, 16)),
    )),
};

async function serverResponse() {
    const serverSecret = new Uint8Array(32).fill(22);
    const payload = await signPairCompleteResponse({
        version: 2,
        authMode: 'paired-device',
        githubLogin: null,
        profile: {
            id: invite.machineId,
            timestamp: withinWindow(),
            firstName: null,
            lastName: null,
            avatar: null,
            github: null,
            connectedServices: [],
        },
        machine: {
            machineId: 'server-machine-id',
            tunnelUrl: 'http://127.0.0.1:3005',
            ed25519PublicKey: encodeBase64(await ed.getPublicKeyAsync(serverSecret)),
            x25519PublicKey: encodeBase64(new Uint8Array(32).fill(23)),
            ed25519Fingerprint: 'SHA256:server',
        },
        pairedDevice: { keyId: keypair.keyId, publicKey: keypair.publicKey },
        issuedAt: withinWindow(),
    }, serverSecret);
    return new Response(JSON.stringify(payload), { status: 200 });
}

describe('enrollPublicServer', () => {
    it('posts /pair/complete with CF-Access + pairing headers and persists Access + device creds', async () => {
        const fetchMock = vi.fn(async () => serverResponse());

        const { credentials, invite: parsed } = await enrollPublicServer(validToken, {
            fetch: fetchMock as unknown as typeof fetch,
            generateKeypair: async () => keypair,
            generateNonce: () => 'fixed-nonce',
            now: withinWindow,
            getCredentialsList: async () => [],
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
            [PUBLIC_DEVICE_PROOF_HEADER]: expect.any(String),
        });
        expect(JSON.parse(init.body as string)).toEqual({
            version: 1,
            machineId: invite.machineId,
            deviceEd25519PublicKey: keypair.publicKey,
            deviceKeyId: keypair.keyId,
        });

        expect(parsed.machineId).toBe(invite.machineId);
        expect(credentials).toEqual({
            authMode: 'paired-device',
            machineId: 'server-machine-id',
            tunnelUrl: 'https://happy.example.com',
            firstSeenAt: withinWindow(),
            cloudflareAccessClientId: invite.cloudflareAccess.clientId,
            cloudflareAccessClientSecret: invite.cloudflareAccess.clientSecret,
            deviceKeyId: keypair.keyId,
            devicePublicKey: keypair.publicKey,
            deviceSecretKey: keypair.secretKey,
            serverEd25519PublicKey: expect.any(String),
            serverEd25519Fingerprint: 'SHA256:server',
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

    it('rejects a changed server identity for an already pinned machine', async () => {
        await expect(enrollPublicServer(validToken, {
            fetch: vi.fn(async () => serverResponse()) as unknown as typeof fetch,
            generateKeypair: async () => keypair,
            generateNonce: () => 'fixed-nonce',
            now: withinWindow,
            getCredentialsList: async () => [{
                authMode: 'paired-device',
                machineId: invite.machineId,
                tunnelUrl: invite.serverUrl,
                firstSeenAt: 1,
                serverEd25519PublicKey: 'different-server-key',
            }],
        })).rejects.toMatchObject({ code: 'invalid_response' });
    });
});
