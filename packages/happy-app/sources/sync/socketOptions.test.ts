import { describe, expect, it, vi } from 'vitest';

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
import {
    PUBLIC_DEVICE_AUTH_TEST_VECTOR,
    PUBLIC_DEVICE_PROOF_HEADER,
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
    machineId: 'public-machine',
    tunnelUrl: 'https://happy.evyatar.dev',
    firstSeenAt: 1,
    cloudflareAccessClientId: 'cf-id.example',
    cloudflareAccessClientSecret: 'cf-secret-value',
    deviceKeyId: PUBLIC_DEVICE_AUTH_TEST_VECTOR.keyId,
    devicePublicKey: 'device-public-key-placeholder',
    deviceSecretKey: encodeBase64(hexToBytes(PUBLIC_DEVICE_AUTH_TEST_VECTOR.seedHex)),
};

describe('socketOptions', () => {
    it('builds Socket.IO options with Dev Tunnels auth and reconnect disabled', async () => {
        const credentials: AuthCredentials = {
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
    });

    it('builds public-mode options with polling + CF-Access + device proof on every transport', async () => {
        const options = await buildTunnelSocketOptions(publicCredentials);

        expect(options.transports).toEqual(['websocket', 'polling']);
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
});
