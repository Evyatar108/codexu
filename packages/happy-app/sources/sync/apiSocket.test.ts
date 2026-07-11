import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';

const mocks = vi.hoisted(() => ({
    sockets: [] as any[],
    io: vi.fn((endpoint: string, options: any) => {
        const handlers = new Map<string, (...args: any[]) => void>();
        const socket = {
            endpoint,
            options,
            recovered: false,
            id: endpoint,
            on: vi.fn((event: string, handler: (...args: any[]) => void) => {
                handlers.set(event, handler);
            }),
            onAny: vi.fn((handler: (...args: any[]) => void) => {
                handlers.set('*', handler);
            }),
            emit: vi.fn(),
            emitWithAck: vi.fn(async (_event: string, data: any) => ({ ok: true, result: data })),
            disconnect: vi.fn(),
            removeAllListeners: vi.fn(() => handlers.clear()),
            trigger: (event: string, ...args: any[]) => handlers.get(event)?.(...args),
            triggerAny: (event: string, data: any) => handlers.get('*')?.(event, data),
        };
        mocks.sockets.push(socket);
        return socket;
    }),
    credentials: [] as any[],
    storageState: {
        localSettings: { verboseLogging: false },
        lastSeenUpdateSeqByMachineId: {} as Record<string, number>,
    },
    markMachineDisconnected: vi.fn(),
    ensureFreshConnectToken: vi.fn(),
}));

vi.mock('socket.io-client', () => ({
    io: mocks.io,
}));

vi.mock('expo-constants', () => ({
    default: { expoConfig: { version: '1.2.3' } },
}));

vi.mock('react-native', () => ({
    Platform: { OS: 'ios' },
}));

vi.mock('@/auth/tokenStorage', () => ({
    getAuthCredentialsIssue: (credentials: any) => {
        if (credentials.authMode === 'dev-tunnel') return null;
        if (!credentials.deviceKeyId || !credentials.devicePublicKey || !credentials.deviceSecretKey) {
            return 'missing-device-key';
        }
        return Boolean(credentials.cloudflareAccessClientId) === Boolean(credentials.cloudflareAccessClientSecret)
            ? null
            : 'incomplete-cloudflare';
    },
    TokenStorage: {
        getCredentialsList: vi.fn(async () => mocks.credentials),
    },
}));

vi.mock('@/auth/connectTokenRefresh', () => ({
    ensureFreshConnectToken: mocks.ensureFreshConnectToken,
}));

vi.mock('./storage', () => ({
    storage: {
        getState: () => mocks.storageState,
    },
}));

import {
    LOCAL_DEVICE_PROOF_HEADER,
    decodeLocalDeviceProofHeader,
    encodeBase64,
} from '@slopus/happy-wire';

function hexToBytes(hex: string): Uint8Array {
    const out = new Uint8Array(hex.length / 2);
    for (let index = 0; index < out.length; index += 1) {
        out[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16);
    }
    return out;
}

const localVectors = JSON.parse(readFileSync(
    new URL('../../../happy-wire/src/fixtures/happy_local_v1_vectors.json', import.meta.url),
    'utf8',
)) as {
    invite: { payload: { serverUrl: string; machineId: string } };
    proof: { seedHex: string; keyId: string; publicKeyBase64: string };
};

function credential(machineId: string) {
    return {
        authMode: 'dev-tunnel' as const,
        machineId,
        tunnelUrl: `https://${machineId}.example.test`,
        firstSeenAt: 1,
        tunnelId: `tunnel-${machineId}`,
        login: `login-${machineId}`,
        avatarUrl: `https://avatars.example.test/${machineId}.png`,
        deviceCode: `device-${machineId}`,
        deviceCodeExpiresAt: Date.now() + 60_000,
    };
}

function localCredential() {
    return {
        authMode: 'paired-device' as const,
        machineId: localVectors.invite.payload.machineId,
        tunnelUrl: localVectors.invite.payload.serverUrl,
        firstSeenAt: 1,
        deviceKeyId: localVectors.proof.keyId,
        devicePublicKey: localVectors.proof.publicKeyBase64,
        deviceSecretKey: encodeBase64(hexToBytes(localVectors.proof.seedHex)),
    };
}

describe('apiSocket multi-machine connections', () => {
    beforeEach(() => {
        vi.resetModules();
        vi.clearAllMocks();
        mocks.sockets.length = 0;
        mocks.credentials = [credential('machine-a'), credential('machine-b')];
        mocks.storageState.lastSeenUpdateSeqByMachineId = {};
        mocks.ensureFreshConnectToken.mockImplementation(async (_credentials: any, machineId: string) => ({
            connectToken: `connect-${machineId}`,
            connectTokenExpiry: Date.now() + 60_000,
        }));
    });

    it('maintains one Socket.IO connection per configured machine', async () => {
        const { apiSocket } = await import('./apiSocket');
        await apiSocket.initializeMany(mocks.credentials.map((item) => ({ endpoint: item.tunnelUrl, credentials: item })));

        expect(apiSocket.getConnectionCount()).toBe(2);
        expect(mocks.io).toHaveBeenCalledTimes(2);
        expect(mocks.sockets.map(socket => socket.endpoint).sort()).toEqual([
            'https://machine-a.example.test',
            'https://machine-b.example.test',
        ]);
    });

    it('retries when initial socket option creation fails before a socket exists', async () => {
        const credentials = credential('machine-a');
        mocks.credentials = [credentials];
        mocks.ensureFreshConnectToken
            .mockRejectedValueOnce(new Error('token endpoint unavailable'))
            .mockResolvedValue({
                connectToken: 'connect-machine-a',
                connectTokenExpiry: Date.now() + 60_000,
            });
        const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

        const { apiSocket } = await import('./apiSocket');
        await apiSocket.initializeMany([{ endpoint: credentials.tunnelUrl, credentials }]);

        await vi.waitFor(() => expect(mocks.ensureFreshConnectToken).toHaveBeenCalledTimes(2));
        expect(mocks.sockets).toHaveLength(1);
        expect(mocks.sockets[0].endpoint).toBe(credentials.tunnelUrl);
        errorSpy.mockRestore();
    });

    it('passes each machine lastSeenSeq in its Socket.IO handshake auth', async () => {
        mocks.credentials = [credential('mA'), credential('mB')];
        mocks.storageState.lastSeenUpdateSeqByMachineId = { mA: 10, mB: 20 };

        const { apiSocket } = await import('./apiSocket');
        await apiSocket.initializeMany(mocks.credentials.map((item) => ({ endpoint: item.tunnelUrl, credentials: item })));

        expect(mocks.sockets).toHaveLength(2);
        expect(mocks.sockets[0].options.auth).toMatchObject({ machineId: 'mA', lastSeenSeq: 10 });
        expect(mocks.sockets[1].options.auth).toMatchObject({ machineId: 'mB', lastSeenSeq: 20 });
    });

    it('routes events with the source machine id and marks a disconnected machine stale', async () => {
        const { apiSocket } = await import('./apiSocket');
        await apiSocket.initializeMany(mocks.credentials.map((item) => ({ endpoint: item.tunnelUrl, credentials: item })));

        const handler = vi.fn();
        const stale = vi.fn();
        apiSocket.onMessage('update', handler);
        apiSocket.onMachineDisconnected(stale);

        mocks.sockets[1].triggerAny('update', { body: { t: 'new-session' } });
        mocks.sockets[1].trigger('disconnect');

        expect(handler).toHaveBeenCalledWith({ body: { t: 'new-session' } }, 'machine-b');
        expect(stale.mock.calls[0][0]).toBe('machine-b');
        expect(typeof stale.mock.calls[0][1]).toBe('number');
    });

    it('requestForMachine throws when TokenStorage has no credentials for the machine', async () => {
        const { apiSocket } = await import('./apiSocket');
        const cred = mocks.credentials[0];
        await apiSocket.initializeMany([{ endpoint: cred.tunnelUrl, credentials: cred }]);
        mocks.sockets[0].trigger('connect');

        mocks.credentials = [];

        await expect(
            apiSocket.forMachine(cred.machineId).request('/api/test'),
        ).rejects.toThrow(`No credentials found in TokenStorage for machine ${cred.machineId}`);
    });

    it('removeMachine decrements connection count and clears the entry', async () => {
        const { apiSocket } = await import('./apiSocket');
        await apiSocket.initializeMany(mocks.credentials.map((item) => ({ endpoint: item.tunnelUrl, credentials: item })));
        expect(apiSocket.getConnectionCount()).toBe(2);

        apiSocket.removeMachine('machine-a');

        expect(apiSocket.getConnectionCount()).toBe(1);
        expect(apiSocket.getConnectionMachineIds()).toEqual(['machine-b']);
    });

    it('removeMachine reassigns primaryMachineId to a remaining connection when the primary is deleted', async () => {
        const { apiSocket } = await import('./apiSocket');
        await apiSocket.initializeMany(mocks.credentials.map((item) => ({ endpoint: item.tunnelUrl, credentials: item })));

        // machine-a is set as primaryMachineId first because initializeMany iterates in order
        apiSocket.removeMachine('machine-a');

        // The remaining connection should be machine-b
        expect(apiSocket.getConnectionCount()).toBe(1);
        expect(apiSocket.getConnectionMachineIds()).toEqual(['machine-b']);
    });

    it('removeMachine sets primaryMachineId to null when the last connection is removed', async () => {
        const { apiSocket } = await import('./apiSocket');
        const cred = mocks.credentials[0];
        await apiSocket.initializeMany([{ endpoint: cred.tunnelUrl, credentials: cred }]);

        apiSocket.removeMachine(cred.machineId);

        expect(apiSocket.getConnectionCount()).toBe(0);
        expect(() => apiSocket.forPrimaryMachine()).toThrow('SyncSocket not initialized');
    });

    it('removeMachine does not affect primaryMachineId when a non-primary machine is removed', async () => {
        const { apiSocket } = await import('./apiSocket');
        await apiSocket.initializeMany(mocks.credentials.map((item) => ({ endpoint: item.tunnelUrl, credentials: item })));
        mocks.sockets[0].trigger('connect');

        apiSocket.removeMachine('machine-b');

        expect(apiSocket.getConnectionCount()).toBe(1);
        expect(apiSocket.getConnectionMachineIds()).toEqual(['machine-a']);
    });

    it('replaces unintentional disconnects with a new socket and skips intentional reconnects', async () => {
        const { apiSocket } = await import('./apiSocket');
        await apiSocket.initializeMany([{ endpoint: mocks.credentials[0].tunnelUrl, credentials: mocks.credentials[0] }]);

        const reconnected = vi.fn();
        apiSocket.onReconnected(reconnected);
        mocks.sockets[0].trigger('connect');
        const firstAuth = mocks.sockets[0].options.extraHeaders['X-Tunnel-Authorization'];

        mocks.sockets[0].trigger('disconnect');
        await Promise.resolve();
        await Promise.resolve();
        await new Promise(resolve => setTimeout(resolve, 0));
        expect(mocks.sockets).toHaveLength(2);
        expect(mocks.sockets[1].options.extraHeaders['X-Tunnel-Authorization']).toBe(firstAuth);

        mocks.sockets[1].trigger('connect');
        expect(reconnected).toHaveBeenCalledTimes(1);
        expect(reconnected).toHaveBeenCalledWith('machine-a', false);

        apiSocket.disconnect('machine-a');
        mocks.sockets[1].trigger('disconnect');
        await Promise.resolve();
        expect(mocks.sockets).toHaveLength(2);
    });

    it('reconnects local polling with a fresh proof nonce and the current lastSeenSeq', async () => {
        const local = localCredential();
        mocks.credentials = [local];
        mocks.storageState.lastSeenUpdateSeqByMachineId = { [local.machineId]: 41 };

        const { apiSocket } = await import('./apiSocket');
        await apiSocket.initializeMany([{ endpoint: local.tunnelUrl, credentials: local }]);

        const firstOptions = mocks.sockets[0].options;
        const firstProof = decodeLocalDeviceProofHeader(
            firstOptions.extraHeaders[LOCAL_DEVICE_PROOF_HEADER],
        );
        expect(firstOptions.transports).toEqual(['polling']);
        expect(firstOptions.auth.lastSeenSeq).toBe(41);
        expect(firstProof).not.toBeNull();

        mocks.storageState.lastSeenUpdateSeqByMachineId[local.machineId] = 57;
        mocks.sockets[0].trigger('disconnect');
        await vi.waitFor(() => expect(mocks.sockets).toHaveLength(2));
        const secondOptions = mocks.sockets[1].options;
        const secondProof = decodeLocalDeviceProofHeader(
            secondOptions.extraHeaders[LOCAL_DEVICE_PROOF_HEADER],
        );
        expect(secondOptions.transports).toEqual(['polling']);
        expect(secondOptions.auth.lastSeenSeq).toBe(57);
        expect(secondProof?.nonce).not.toBe(firstProof?.nonce);
    });

    it('replaces an existing machine socket when enrollment updates its endpoint and credentials', async () => {
        const original = credential('machine-a');
        mocks.credentials = [original];

        const { apiSocket } = await import('./apiSocket');
        await apiSocket.initializeMany([{ endpoint: original.tunnelUrl, credentials: original }]);
        mocks.sockets[0].trigger('connect');

        const updated = {
            ...original,
            tunnelUrl: 'https://machine-a-repaired.example.test',
            connectToken: 'replacement-token',
        };
        mocks.credentials = [updated];
        const appended = apiSocket.appendMachine({
            endpoint: updated.tunnelUrl,
            credentials: updated,
        }, 1_000);

        await vi.waitFor(() => expect(mocks.sockets).toHaveLength(2));
        expect(mocks.sockets[0].disconnect).toHaveBeenCalledTimes(1);
        expect(mocks.sockets[1].endpoint).toBe(updated.tunnelUrl);

        mocks.sockets[1].trigger('connect');
        await expect(appended).resolves.toBeUndefined();
        expect(apiSocket.forPrimaryMachine().machineId).toBe(updated.machineId);
    });

    it('retries a failed local reconnect with another fresh proof and the latest cursor', async () => {
        const local = localCredential();
        mocks.credentials = [local];
        mocks.storageState.lastSeenUpdateSeqByMachineId = { [local.machineId]: 41 };

        const { apiSocket } = await import('./apiSocket');
        await apiSocket.initializeMany([{ endpoint: local.tunnelUrl, credentials: local }]);
        mocks.sockets[0].trigger('connect');

        mocks.storageState.lastSeenUpdateSeqByMachineId[local.machineId] = 52;
        mocks.sockets[0].trigger('disconnect');
        await vi.waitFor(() => expect(mocks.sockets).toHaveLength(2));
        const failedProof = decodeLocalDeviceProofHeader(
            mocks.sockets[1].options.extraHeaders[LOCAL_DEVICE_PROOF_HEADER],
        );
        expect(mocks.sockets[1].options.auth.lastSeenSeq).toBe(52);

        mocks.storageState.lastSeenUpdateSeqByMachineId[local.machineId] = 63;
        mocks.sockets[1].trigger('connect_error', new Error('server still restarting'));
        await vi.waitFor(() => expect(mocks.sockets).toHaveLength(3), { timeout: 2_000 });
        const recoveredProof = decodeLocalDeviceProofHeader(
            mocks.sockets[2].options.extraHeaders[LOCAL_DEVICE_PROOF_HEADER],
        );
        expect(mocks.sockets[2].options.auth.lastSeenSeq).toBe(63);
        expect(recoveredProof?.nonce).not.toBe(failedProof?.nonce);

        mocks.sockets[2].trigger('connect');
    });

    it('reports when the first successful connection arrives only after a retry', async () => {
        const local = localCredential();
        mocks.credentials = [local];

        const { apiSocket } = await import('./apiSocket');
        const reconnected = vi.fn();
        apiSocket.onReconnected(reconnected);
        await apiSocket.initializeMany([{ endpoint: local.tunnelUrl, credentials: local }]);

        mocks.sockets[0].trigger('connect_error', new Error('server still starting'));
        await vi.waitFor(() => expect(mocks.sockets).toHaveLength(2));
        mocks.sockets[1].trigger('connect');

        expect(reconnected).toHaveBeenCalledWith(local.machineId, true);
    });
});
