import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';

const connect = vi.hoisted(() => ({
    ensureFreshConnectToken: vi.fn(async () => ({ connectToken: 'connect-jwt', connectTokenExpiry: Date.now() + 60_000 })),
}));

vi.mock('@/auth/connectTokenRefresh', () => connect);

import {
    PUBLIC_DEVICE_AUTH_TEST_VECTOR,
    PUBLIC_DEVICE_PROOF_HEADER,
    LOCAL_DEVICE_PROOF_HEADER,
    decodeLocalDeviceProofHeader,
    decodePublicDeviceProofHeader,
    encodeBase64,
    hashLocalRequestBody,
    verifyLocalRequest,
} from '@slopus/happy-wire';

import {
    InvalidPairedDeviceCredentialsError,
    getMachineAuthHeaders,
    tunnelFetch,
    isPublicModeCredentials,
} from './machineAuth';
import { CF_ACCESS_CLIENT_ID_HEADER, CF_ACCESS_CLIENT_SECRET_HEADER } from './publicEnrollment';
import type { AuthCredentials } from './tokenStorage';

const credentials: AuthCredentials = {
    authMode: 'dev-tunnel',
    machineId: 'machine-1',
    tunnelUrl: 'https://machine.example.test',
    firstSeenAt: 1,
    deviceCode: 'device-1',
    deviceCodeExpiresAt: Date.now() + 60_000,
};

function hexToBytes(hex: string): Uint8Array {
    const out = new Uint8Array(hex.length / 2);
    for (let i = 0; i < out.length; i++) {
        out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
    }
    return out;
}

const publicCredentials: AuthCredentials = {
    authMode: 'paired-device',
    machineId: 'public-machine',
    tunnelUrl: 'https://happy.example.com',
    firstSeenAt: 1,
    cloudflareAccessClientId: 'cf-id.example',
    cloudflareAccessClientSecret: 'cf-secret-value',
    deviceKeyId: PUBLIC_DEVICE_AUTH_TEST_VECTOR.keyId,
    devicePublicKey: 'device-public-key-placeholder',
    deviceSecretKey: encodeBase64(hexToBytes(PUBLIC_DEVICE_AUTH_TEST_VECTOR.seedHex)),
};

const localVectors = JSON.parse(readFileSync(
    new URL('../../../happy-wire/src/fixtures/happy_local_v1_vectors.json', import.meta.url),
    'utf8',
)) as {
    invite: { payload: { serverUrl: string; machineId: string } };
    proof: { seedHex: string; keyId: string; publicKeyBase64: string };
};

const localCredentials: AuthCredentials = {
    authMode: 'paired-device',
    machineId: localVectors.invite.payload.machineId,
    tunnelUrl: localVectors.invite.payload.serverUrl,
    firstSeenAt: 1,
    deviceKeyId: localVectors.proof.keyId,
    devicePublicKey: localVectors.proof.publicKeyBase64,
    deviceSecretKey: encodeBase64(hexToBytes(localVectors.proof.seedHex)),
};

describe('machine auth', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('returns the Dev Tunnels connect token auth header', async () => {
        await expect(getMachineAuthHeaders(credentials)).resolves.toEqual({
            'X-Tunnel-Authorization': 'tunnel connect-jwt',
        });
        expect(connect.ensureFreshConnectToken).toHaveBeenCalledWith(credentials, 'machine-1');
    });

    it('propagates 401 responses raw', async () => {
        global.fetch = vi.fn(async () => new Response(JSON.stringify({ error: 'other' }), { status: 401 })) as never;
        const response = await tunnelFetch('https://machine.example.test/v2/me/settings', credentials);
        expect(response.status).toBe(401);
        expect(global.fetch).toHaveBeenCalledWith('https://machine.example.test/v2/me/settings', expect.objectContaining({
            headers: { 'X-Tunnel-Authorization': 'tunnel connect-jwt' },
        }));
    });

    it('propagates network errors', async () => {
        global.fetch = vi.fn(async () => { throw new Error('network failure'); }) as never;
        await expect(tunnelFetch('https://machine.example.test/v2/me/settings', credentials))
            .rejects.toThrow('network failure');
    });
});

describe('public-server machine auth', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('detects public mode only when CF-Access + device key fields are all present', () => {
        expect(isPublicModeCredentials(credentials)).toBe(false);
        expect(isPublicModeCredentials(publicCredentials)).toBe(true);
        expect(isPublicModeCredentials({ ...publicCredentials, deviceSecretKey: undefined })).toBe(false);
    });

    it('emits CF-Access headers + a device proof bound to the request, not the tunnel token', async () => {
        const headers = await getMachineAuthHeaders(publicCredentials, publicCredentials.machineId, {
            method: 'POST',
            path: '/v1/sessions',
            target: '/v1/sessions',
            body: '{"a":1}',
        });

        expect(headers[CF_ACCESS_CLIENT_ID_HEADER]).toBe('cf-id.example');
        expect(headers[CF_ACCESS_CLIENT_SECRET_HEADER]).toBe('cf-secret-value');
        expect(headers).not.toHaveProperty('X-Tunnel-Authorization');
        expect(connect.ensureFreshConnectToken).not.toHaveBeenCalled();

        const envelope = decodePublicDeviceProofHeader(headers[PUBLIC_DEVICE_PROOF_HEADER]!);
        expect(envelope?.method).toBe('POST');
        expect(envelope?.path).toBe('/v1/sessions');
        expect(envelope?.keyId).toBe(PUBLIC_DEVICE_AUTH_TEST_VECTOR.keyId);
    });

    it('omits the device proof when no request binding is supplied', async () => {
        const headers = await getMachineAuthHeaders(publicCredentials);
        expect(headers[CF_ACCESS_CLIENT_ID_HEADER]).toBe('cf-id.example');
        expect(headers).not.toHaveProperty(PUBLIC_DEVICE_PROOF_HEADER);
        expect(connect.ensureFreshConnectToken).not.toHaveBeenCalled();
    });

    it('tunnelFetch signs a proof over the derived path + method in public mode', async () => {
        const seen: Record<string, string>[] = [];
        global.fetch = vi.fn(async (_url: string, init: RequestInit) => {
            seen.push(init.headers as Record<string, string>);
            return new Response('{}', { status: 200 });
        }) as never;

        await tunnelFetch('https://happy.example.com/v1/sessions?cursor=2', publicCredentials, {
            method: 'POST',
            body: '{"x":1}',
        });

        const sent = seen[0]!;
        expect(sent[CF_ACCESS_CLIENT_ID_HEADER]).toBe('cf-id.example');
        expect(sent[CF_ACCESS_CLIENT_SECRET_HEADER]).toBe('cf-secret-value');
        const envelope = decodePublicDeviceProofHeader(sent[PUBLIC_DEVICE_PROOF_HEADER]!);
        // Server strips the query string; the proof path must be the bare pathname.
        expect(envelope?.path).toBe('/v1/sessions');
        expect(envelope?.method).toBe('POST');
    });
});

describe('local paired-device machine auth', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('signs the exact query and raw request body without Cloudflare or Dev Tunnels fallback', async () => {
        const body = '{"local":true}';
        let sentHeaders: Record<string, string> | undefined;
        global.fetch = vi.fn(async (_url: string, init: RequestInit) => {
            sentHeaders = init.headers as Record<string, string>;
            return new Response('{}', { status: 200 });
        }) as never;

        await tunnelFetch(
            `${localCredentials.tunnelUrl}/v3/sessions/s1/messages?b=2&a=hello%20world&a=1`,
            localCredentials,
            { method: 'POST', body },
        );

        expect(sentHeaders).toBeDefined();
        expect(sentHeaders).not.toHaveProperty(CF_ACCESS_CLIENT_ID_HEADER);
        expect(sentHeaders).not.toHaveProperty(CF_ACCESS_CLIENT_SECRET_HEADER);
        expect(sentHeaders).not.toHaveProperty('X-Tunnel-Authorization');
        expect(connect.ensureFreshConnectToken).not.toHaveBeenCalled();

        const proof = decodeLocalDeviceProofHeader(sentHeaders![LOCAL_DEVICE_PROOF_HEADER]);
        expect(proof?.target).toBe('/v3/sessions/s1/messages?a=1&a=hello+world&b=2');
        await expect(verifyLocalRequest(proof, {
            method: 'POST',
            target: '/v3/sessions/s1/messages?b=2&a=hello%20world&a=1',
            bodyHash: hashLocalRequestBody(body),
            expectedPublicKey: localCredentials.devicePublicKey,
        })).resolves.toEqual({ ok: true });
    });

    it('fails closed for incomplete paired-device credentials', async () => {
        const incompleteCredentials: AuthCredentials[] = [
            { ...localCredentials, deviceSecretKey: undefined },
            { ...localCredentials, cloudflareAccessClientId: 'cf-id-only' },
            { ...localCredentials, cloudflareAccessClientSecret: 'cf-secret-only' },
        ];

        for (const incomplete of incompleteCredentials) {
            await expect(getMachineAuthHeaders(incomplete, incomplete.machineId, {
                method: 'GET',
                path: '/v1/updates',
                target: '/v1/updates',
                body: null,
            })).rejects.toBeInstanceOf(InvalidPairedDeviceCredentialsError);
        }
        expect(connect.ensureFreshConnectToken).not.toHaveBeenCalled();
    });

    it('requires an exact binding for every local paired-device request', async () => {
        await expect(getMachineAuthHeaders(localCredentials))
            .rejects.toBeInstanceOf(InvalidPairedDeviceCredentialsError);
        expect(connect.ensureFreshConnectToken).not.toHaveBeenCalled();
    });
});
