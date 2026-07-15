import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';

import {
    LOCAL_DEVICE_PROOF_HEADER,
    LOCAL_PAIRING_NONCE_HEADER,
    LOCAL_PAIRING_SECRET_HEADER,
    decodeLocalDeviceProofHeader,
    hashLocalRequestBody,
    signPairCompleteResponse,
    verifyLocalRequest,
} from '@slopus/happy-wire';
import * as ed from '@noble/ed25519';

import { encodeBase64 } from '@slopus/happy-wire';
import type { DeviceKeypair } from './deviceKeypair';
import { LocalEnrollmentError, enrollLocalServer } from './localEnrollment';
import type { AuthCredentials } from './tokenStorage';

interface LocalVectors {
    invite: {
        payload: {
            serverUrl: string;
            browserOrigin: string;
            machineId: string;
            pairSecret: string;
            pairingNonce: string;
            issuedAt: string;
        };
        token: string;
    };
    proof: {
        seedHex: string;
        keyId: string;
        publicKeyBase64: string;
        nonceBase64Url: string;
    };
}

const vectors = JSON.parse(
    readFileSync(
        new URL('../../../happy-wire/src/fixtures/happy_local_v1_vectors.json', import.meta.url),
        'utf8',
    ),
) as LocalVectors;

function hexToBytes(hex: string): Uint8Array {
    const out = new Uint8Array(hex.length / 2);
    for (let index = 0; index < out.length; index += 1) {
        out[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16);
    }
    return out;
}

const keypair: DeviceKeypair = {
    keyId: vectors.proof.keyId,
    publicKey: vectors.proof.publicKeyBase64,
    secretKey: encodeBase64(hexToBytes(vectors.proof.seedHex)),
};

async function successResponse() {
    const serverSecret = new Uint8Array(32).fill(31);
    const serverPublic = encodeBase64(await ed.getPublicKeyAsync(serverSecret));
    const payload = await signPairCompleteResponse({
        version: 2,
        authMode: 'paired-device',
        githubLogin: null,
        profile: {
            id: vectors.invite.payload.machineId,
            timestamp: Date.parse(vectors.invite.payload.issuedAt),
            firstName: null,
            lastName: null,
            avatar: null,
            github: null,
            connectedServices: [],
        },
        machine: {
            machineId: vectors.invite.payload.machineId,
            tunnelUrl: vectors.invite.payload.serverUrl,
            ed25519PublicKey: serverPublic,
            x25519PublicKey: encodeBase64(new Uint8Array(32).fill(32)),
            ed25519Fingerprint: 'SHA256:local-server',
        },
        pairedDevice: {
            keyId: keypair.keyId,
            publicKey: keypair.publicKey,
        },
        issuedAt: Date.parse(vectors.invite.payload.issuedAt),
    }, serverSecret);
    return new Response(JSON.stringify(payload), { status: 200 });
}

describe('local enrollment', () => {
    it('proves possession of a new private key and returns local paired credentials without persisting the invite secret', async () => {
        const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
            const headers = init.headers as Record<string, string>;
            expect(_url).toBe(`${vectors.invite.payload.serverUrl}/pair/complete`);
            expect(headers.Origin).toBe(vectors.invite.payload.browserOrigin);
            expect(headers[LOCAL_PAIRING_SECRET_HEADER]).toBe(vectors.invite.payload.pairSecret);
            expect(headers[LOCAL_PAIRING_NONCE_HEADER]).toBe(vectors.invite.payload.pairingNonce);

            const body = String(init.body);
            const proof = decodeLocalDeviceProofHeader(headers[LOCAL_DEVICE_PROOF_HEADER]);
            expect(proof?.keyId).toBe(keypair.keyId);
            await expect(verifyLocalRequest(proof, {
                method: 'POST',
                target: '/pair/complete',
                bodyHash: hashLocalRequestBody(body),
                expectedPublicKey: keypair.publicKey,
            })).resolves.toEqual({ ok: true });
            expect(JSON.parse(body)).toEqual({
                version: 1,
                machineId: vectors.invite.payload.machineId,
                deviceKeyId: keypair.keyId,
                deviceEd25519PublicKey: keypair.publicKey,
            });
            return successResponse();
        });

        const result = await enrollLocalServer(vectors.invite.token, {
            fetch: fetchMock as unknown as typeof fetch,
            getCredentialsList: async () => [],
            generateKeypair: async () => keypair,
            generateProofNonce: () => vectors.proof.nonceBase64Url,
            now: () => Date.parse(vectors.invite.payload.issuedAt),
            browserOrigin: vectors.invite.payload.browserOrigin,
        });

        expect(result.reusedDeviceKey).toBe(false);
        expect(result.credentials).toEqual({
            authMode: 'paired-device',
            machineId: vectors.invite.payload.machineId,
            tunnelUrl: vectors.invite.payload.serverUrl,
            firstSeenAt: Date.parse(vectors.invite.payload.issuedAt),
            login: undefined,
            avatarUrl: undefined,
            deviceKeyId: keypair.keyId,
            devicePublicKey: keypair.publicKey,
            deviceSecretKey: keypair.secretKey,
            serverEd25519PublicKey: expect.any(String),
            serverEd25519Fingerprint: 'SHA256:local-server',
        });
        expect(result.credentials).not.toHaveProperty('pairSecret');
        expect(result.credentials).not.toHaveProperty('pairingNonce');
        expect(result.credentials).not.toHaveProperty('cloudflareAccessClientId');
        expect(result.credentials).not.toHaveProperty('cloudflareAccessClientSecret');
    });

    it('reuses a known machine keypair and replaces its endpoint only after pair completion succeeds', async () => {
        const existing: AuthCredentials = {
            authMode: 'paired-device',
            machineId: vectors.invite.payload.machineId,
            tunnelUrl: 'https://old-public.example.test',
            firstSeenAt: 123,
            login: 'octocat',
            avatarUrl: 'https://avatars.example.test/octocat.png',
            cloudflareAccessClientId: 'old-cf-id',
            cloudflareAccessClientSecret: 'old-cf-secret',
            deviceKeyId: keypair.keyId,
            devicePublicKey: keypair.publicKey,
            deviceSecretKey: keypair.secretKey,
        };
        const generateKeypair = vi.fn();
        const fetchMock = vi.fn(async () => successResponse());

        const result = await enrollLocalServer(vectors.invite.token, {
            fetch: fetchMock as unknown as typeof fetch,
            getCredentialsList: async () => [existing],
            generateKeypair,
            generateProofNonce: () => vectors.proof.nonceBase64Url,
            now: () => Date.parse(vectors.invite.payload.issuedAt),
            browserOrigin: vectors.invite.payload.browserOrigin,
        });

        expect(generateKeypair).not.toHaveBeenCalled();
        expect(result.reusedDeviceKey).toBe(true);
        expect(result.credentials).toMatchObject({
            tunnelUrl: vectors.invite.payload.serverUrl,
            firstSeenAt: 123,
            login: 'octocat',
            deviceKeyId: keypair.keyId,
        });
        expect(result.credentials).not.toHaveProperty('cloudflareAccessClientId');

        await expect(enrollLocalServer(vectors.invite.token, {
            fetch: vi.fn(async () => new Response('{}', { status: 500 })) as unknown as typeof fetch,
            getCredentialsList: async () => [existing],
            generateProofNonce: () => vectors.proof.nonceBase64Url,
            now: () => Date.parse(vectors.invite.payload.issuedAt),
            browserOrigin: vectors.invite.payload.browserOrigin,
        })).rejects.toMatchObject({ code: 'pair_failed' });
        expect(existing.tunnelUrl).toBe('https://old-public.example.test');
    });

    it('rejects cross-origin invites and invalid success responses', async () => {
        await expect(enrollLocalServer(vectors.invite.token, {
            browserOrigin: 'http://127.0.0.1:8081',
            now: () => Date.parse(vectors.invite.payload.issuedAt),
        })).rejects.toMatchObject({ code: 'invalid_invite' } satisfies Partial<LocalEnrollmentError>);

        await expect(enrollLocalServer(vectors.invite.token, {
            fetch: vi.fn(async () => new Response(JSON.stringify({
                machine: { machineId: 'other-machine', tunnelUrl: vectors.invite.payload.serverUrl },
                authMode: 'paired-device',
                pairedDevice: { keyId: keypair.keyId, publicKey: keypair.publicKey },
            }), { status: 200 })) as unknown as typeof fetch,
            getCredentialsList: async () => [],
            generateKeypair: async () => keypair,
            generateProofNonce: () => vectors.proof.nonceBase64Url,
            now: () => Date.parse(vectors.invite.payload.issuedAt),
            browserOrigin: vectors.invite.payload.browserOrigin,
        })).rejects.toMatchObject({ code: 'invalid_response' } satisfies Partial<LocalEnrollmentError>);
    });

    it('requires the exact frozen local pair-completion response', async () => {
        const invalidPayloads = [
            {
                machine: {
                    machineId: vectors.invite.payload.machineId,
                    tunnelUrl: 'http://127.0.0.1:43128',
                },
                authMode: 'paired-device',
                pairedDevice: { keyId: keypair.keyId, publicKey: keypair.publicKey },
                githubLogin: null,
            },
            {
                machine: {
                    machineId: vectors.invite.payload.machineId,
                    tunnelUrl: vectors.invite.payload.serverUrl,
                },
                authMode: 'paired-device',
                pairedDevice: { keyId: keypair.keyId, publicKey: keypair.publicKey },
                githubLogin: 'unexpected-login',
            },
            {
                machine: {
                    machineId: vectors.invite.payload.machineId,
                    tunnelUrl: vectors.invite.payload.serverUrl,
                },
                authMode: 'paired-device',
                pairedDevice: { keyId: keypair.keyId, publicKey: keypair.publicKey },
                githubLogin: null,
                unexpected: true,
            },
        ];

        for (const payload of invalidPayloads) {
            await expect(enrollLocalServer(vectors.invite.token, {
                fetch: vi.fn(async () => new Response(JSON.stringify(payload), { status: 200 })) as unknown as typeof fetch,
                getCredentialsList: async () => [],
                generateKeypair: async () => keypair,
                generateProofNonce: () => vectors.proof.nonceBase64Url,
                now: () => Date.parse(vectors.invite.payload.issuedAt),
                browserOrigin: vectors.invite.payload.browserOrigin,
            })).rejects.toMatchObject({ code: 'invalid_response' });
        }
    });
});
