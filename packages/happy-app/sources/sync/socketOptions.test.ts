import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';

vi.mock('expo-constants', () => ({
    default: { expoConfig: { version: '1.2.3' } },
}));

vi.mock('react-native', () => ({
    Platform: { OS: 'ios' },
}));

vi.mock('@/auth/connectTokenRefresh', () => ({
    ensureFreshConnectToken: vi.fn(async () => ({ connectToken: 'connect-jwt', connectTokenExpiry: Date.now() + 60_000 })),
}));

import { buildTunnelSocketOptions } from './socketOptions';
import { Platform } from 'react-native';
import {
    PUBLIC_DEVICE_AUTH_TEST_VECTOR,
    PUBLIC_DEVICE_PROOF_HEADER,
    LOCAL_DEVICE_PROOF_HEADER,
    decodeLocalDeviceProofHeader,
    decodePublicDeviceProofHeader,
    encodeBase64,
} from '@slopus/happy-wire';
import { CF_ACCESS_CLIENT_ID_HEADER, CF_ACCESS_CLIENT_SECRET_HEADER } from '@/auth/publicEnrollment';
import type { AuthCredentials } from '@/auth/tokenStorage';

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

describe('socketOptions', () => {
    beforeEach(() => {
        // buildTunnelSocketOptions reads Platform.OS at call time; keep native as
        // the default and let individual tests opt into 'web' explicitly.
        (Platform as { OS: string }).OS = 'ios';
    });

    it('builds Socket.IO options with Dev Tunnels auth and reconnect disabled', async () => {
        const credentials: AuthCredentials = {
            authMode: 'dev-tunnel',
            machineId: 'machine-1',
            tunnelUrl: 'https://machine.example.test',
            firstSeenAt: 123,
            connectToken: 'connect-jwt',
            deviceCode: 'device-1',
            deviceCodeExpiresAt: Date.now() + 60_000,
        };

        const options = await buildTunnelSocketOptions(credentials);
        expect(options.extraHeaders).toMatchObject({
            'X-Tunnel-Authorization': 'tunnel connect-jwt',
            'X-Happy-Client': 'ios/1.2.3',
        });
        expect((options.transportOptions as any).websocket.extraHeaders['X-Tunnel-Authorization']).toBe('tunnel connect-jwt');
        expect((options.auth as Record<string, unknown>)['X-Tunnel-Authorization']).toBeUndefined();
        expect(JSON.stringify(options)).not.toContain('#dt=');
        expect(options.reconnection).toBe(false);
    });

    it('uses the machineId override in the auth payload when provided', async () => {
        const credentials: AuthCredentials = {
            authMode: 'dev-tunnel',
            machineId: 'machine-1',
            tunnelUrl: 'https://machine.example.test',
            firstSeenAt: 123,
            connectToken: 'connect-jwt',
            deviceCode: 'device-1',
            deviceCodeExpiresAt: Date.now() + 60_000,
        };

        const options = await buildTunnelSocketOptions(credentials, 'machine-override');
        expect((options.auth as Record<string, unknown>).machineId).toBe('machine-override');
    });

    it('uses credentials.machineId in the auth payload when no override is provided', async () => {
        const credentials: AuthCredentials = {
            authMode: 'dev-tunnel',
            machineId: 'machine-1',
            tunnelUrl: 'https://machine.example.test',
            firstSeenAt: 123,
            connectToken: 'connect-jwt',
            deviceCode: 'device-1',
            deviceCodeExpiresAt: Date.now() + 60_000,
        };

        const options = await buildTunnelSocketOptions(credentials);
        expect((options.auth as Record<string, unknown>).machineId).toBe('machine-1');
    });

    it('includes finite lastSeenSeq only when provided', async () => {
        const credentials: AuthCredentials = {
            authMode: 'dev-tunnel',
            machineId: 'machine-1',
            tunnelUrl: 'https://machine.example.test',
            firstSeenAt: 123,
            connectToken: 'connect-jwt',
            deviceCode: 'device-1',
            deviceCodeExpiresAt: Date.now() + 60_000,
        };

        const withSeq = await buildTunnelSocketOptions(credentials, 'mA', 42);
        expect((withSeq.auth as Record<string, unknown>).lastSeenSeq).toBe(42);

        const withoutSeq = await buildTunnelSocketOptions(credentials, 'mA');
        expect(withoutSeq.auth as Record<string, unknown>).not.toHaveProperty('lastSeenSeq');

        const nonFiniteSeq = await buildTunnelSocketOptions(credentials, 'mA', Number.POSITIVE_INFINITY);
        expect(nonFiniteSeq.auth as Record<string, unknown>).not.toHaveProperty('lastSeenSeq');
    });

    it('keeps the Dev Tunnels transport list to websocket-only with no polling options', async () => {
        const credentials: AuthCredentials = {
            authMode: 'dev-tunnel',
            machineId: 'machine-1',
            tunnelUrl: 'https://machine.example.test',
            firstSeenAt: 123,
            connectToken: 'connect-jwt',
            deviceCode: 'device-1',
            deviceCodeExpiresAt: Date.now() + 60_000,
        };

        const options = await buildTunnelSocketOptions(credentials);
        expect(options.transports).toEqual(['websocket']);
        expect((options.transportOptions as any).polling).toBeUndefined();
        expect(options.tryAllTransports).toBeUndefined();
    });

    it('builds public-mode options with polling + CF-Access + device proof on every transport', async () => {
        const options = await buildTunnelSocketOptions(publicCredentials);

        // Native (default Platform.OS='ios'): websocket-first with polling fallback.
        expect(options.transports).toEqual(['websocket', 'polling']);
        expect(options.tryAllTransports).toBe(true);
        expect(options.reconnection).toBe(false);

        const transportOptions = options.transportOptions as any;
        const headerSets = [
            options.extraHeaders as Record<string, string>,
            transportOptions.websocket.extraHeaders as Record<string, string>,
            transportOptions.polling.extraHeaders as Record<string, string>,
        ];

        for (const headers of headerSets) {
            expect(headers[CF_ACCESS_CLIENT_ID_HEADER]).toBe('cf-id.example');
            expect(headers[CF_ACCESS_CLIENT_SECRET_HEADER]).toBe('cf-secret-value');
            expect(headers['X-Happy-Client']).toBe('ios/1.2.3');
            expect(headers).not.toHaveProperty('X-Tunnel-Authorization');
            const envelope = decodePublicDeviceProofHeader(headers[PUBLIC_DEVICE_PROOF_HEADER]!);
            expect(envelope?.method).toBe('GET');
            expect(envelope?.path).toBe('/v1/updates');
            expect(envelope?.keyId).toBe(PUBLIC_DEVICE_AUTH_TEST_VECTOR.keyId);
        }

        // The proof is built once and shared, so every transport carries the same
        // single-use nonce for this one-shot (reconnection-off) connection.
        const proofValues = headerSets.map(h => h[PUBLIC_DEVICE_PROOF_HEADER]);
        expect(new Set(proofValues).size).toBe(1);
    });

    it('uses polling-only transport in public mode on web so the browser socket carries auth headers', async () => {
        // On web the browser WebSocket API cannot attach CF-Access / device-proof
        // headers to the WS upgrade, so public mode must connect over polling only.
        (Platform as { OS: string }).OS = 'web';

        const options = await buildTunnelSocketOptions(publicCredentials);

        expect(options.transports).toEqual(['polling']);
        expect(options.tryAllTransports).toBe(true);
        expect(options.reconnection).toBe(false);

        // Polling still carries the CF-Access + device-proof headers.
        const transportOptions = options.transportOptions as any;
        const pollingHeaders = transportOptions.polling.extraHeaders as Record<string, string>;
        expect(pollingHeaders[CF_ACCESS_CLIENT_ID_HEADER]).toBe('cf-id.example');
        expect(pollingHeaders[CF_ACCESS_CLIENT_SECRET_HEADER]).toBe('cf-secret-value');
        const envelope = decodePublicDeviceProofHeader(pollingHeaders[PUBLIC_DEVICE_PROOF_HEADER]!);
        expect(envelope?.method).toBe('GET');
        expect(envelope?.path).toBe('/v1/updates');
    });

    it('uses polling-only local proof with replay sequence and no WebSocket header assumption', async () => {
        const options = await buildTunnelSocketOptions(localCredentials, localCredentials.machineId, 73);

        expect(options.transports).toEqual(['polling']);
        expect(options.tryAllTransports).toBeUndefined();
        expect(options.reconnection).toBe(false);
        expect(options.auth).toMatchObject({
            clientType: 'user-scoped',
            machineId: localCredentials.machineId,
            lastSeenSeq: 73,
        });

        const transportOptions = options.transportOptions as any;
        expect(transportOptions.websocket).toBeUndefined();
        const pollingHeaders = transportOptions.polling.extraHeaders as Record<string, string>;
        expect(pollingHeaders).not.toHaveProperty('X-Tunnel-Authorization');
        expect(pollingHeaders).not.toHaveProperty(CF_ACCESS_CLIENT_ID_HEADER);
        expect(pollingHeaders).not.toHaveProperty(CF_ACCESS_CLIENT_SECRET_HEADER);
        const proof = decodeLocalDeviceProofHeader(pollingHeaders[LOCAL_DEVICE_PROOF_HEADER]);
        expect(proof).toMatchObject({
            method: 'GET',
            target: '/v1/updates',
            keyId: localCredentials.deviceKeyId,
            publicKey: localCredentials.devicePublicKey,
        });
    });
});
