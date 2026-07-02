import { beforeEach, describe, expect, it, vi } from 'vitest';

const connect = vi.hoisted(() => ({
    ensureFreshConnectToken: vi.fn(async () => ({ connectToken: 'connect-jwt', connectTokenExpiry: Date.now() + 60_000 })),
}));

vi.mock('@/auth/connectTokenRefresh', () => connect);

import {
    PUBLIC_DEVICE_AUTH_TEST_VECTOR,
    PUBLIC_DEVICE_PROOF_HEADER,
    decodePublicDeviceProofHeader,
    encodeBase64,
} from '@slopus/happy-wire';

import { getMachineAuthHeaders, tunnelFetch, isPublicModeCredentials } from './machineAuth';
import { CF_ACCESS_CLIENT_ID_HEADER, CF_ACCESS_CLIENT_SECRET_HEADER } from './publicEnrollment';
import type { AuthCredentials } from './tokenStorage';

const credentials: AuthCredentials = {
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
    machineId: 'public-machine',
    tunnelUrl: 'https://happy.evyatar.dev',
    firstSeenAt: 1,
    cloudflareAccessClientId: 'cf-id.example',
    cloudflareAccessClientSecret: 'cf-secret-value',
    deviceKeyId: PUBLIC_DEVICE_AUTH_TEST_VECTOR.keyId,
    devicePublicKey: 'device-public-key-placeholder',
    deviceSecretKey: encodeBase64(hexToBytes(PUBLIC_DEVICE_AUTH_TEST_VECTOR.seedHex)),
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

        await tunnelFetch('https://happy.evyatar.dev/v1/sessions?cursor=2', publicCredentials, {
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
