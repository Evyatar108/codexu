import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiClient } from './api';
import { connectionState } from '@/utils/serverConnectionErrors';

const { mockTunnelFetch, mockLoggerDebug } = vi.hoisted(() => ({
    mockTunnelFetch: vi.fn(),
    mockLoggerDebug: vi.fn(),
}));

vi.mock('@/daemon/daemonClient', () => ({
    tunnelFetch: mockTunnelFetch,
    tunnelSocketIOOptions: vi.fn(async () => {
        throw new Error('socket setup unavailable');
    }),
}));

vi.mock('@/ui/logger', () => ({
    logger: {
        debug: mockLoggerDebug,
    },
}));

vi.mock('./encryption', () => ({
    decodeBase64: vi.fn((data: string) => data),
    encodeBase64: vi.fn((data: any) => data),
    decrypt: vi.fn((_key: any, _variant: any, data: any) => data),
    encrypt: vi.fn((_key: any, _variant: any, data: any) => data),
    getRandomBytes: vi.fn(() => new Uint8Array(32)),
    libsodiumEncryptForPublicKey: vi.fn(() => new Uint8Array(32)),
}));

vi.mock('@/configuration', () => ({
    configuration: {
        currentCliVersion: '1.2.3',
    },
}));

function response(status: number, body: unknown = {}): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json' },
    });
}

const testMetadata = {
    path: '/tmp',
    host: 'localhost',
    homeDir: '/home/user',
    happyHomeDir: '/home/user/.happy',
    happyLibDir: '/home/user/.happy/lib',
    happyToolsDir: '/home/user/.happy/tools',
};

describe('ApiClient daemon REST routing', () => {
    let api: ApiClient;

    beforeEach(async () => {
        vi.clearAllMocks();
        mockLoggerDebug.mockReset();
        connectionState.reset();
        api = await ApiClient.create({
            token: 'token',
            encryption: {
                type: 'legacy',
                secret: new Uint8Array(32),
            },
        });
    });

    it('creates sessions through daemonClient.tunnelFetch', async () => {
        mockTunnelFetch.mockResolvedValue(response(200, {
            session: {
                id: 'session-1',
                tag: 'test-tag',
                seq: 7,
                createdAt: 1,
                updatedAt: 1,
                metadata: JSON.stringify(testMetadata),
                metadataVersion: 2,
                agentState: null,
                agentStateVersion: 3,
            },
        }));

        const result = await api.getOrCreateSession({
            tag: 'test-tag',
            metadata: testMetadata,
            state: null,
        });

        expect(mockTunnelFetch).toHaveBeenCalledWith('/v1/sessions', expect.objectContaining({
            method: 'POST',
            headers: expect.objectContaining({
                'Content-Type': 'application/json',
                'X-Happy-Client': 'cli-coding-session/1.2.3',
            }),
        }));
        expect(result).toMatchObject({
            id: 'session-1',
            seq: 7,
            metadata: testMetadata,
            metadataVersion: 2,
            agentState: null,
            agentStateVersion: 3,
        });
    });

    it('returns null for retryable session creation failures', async () => {
        const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
        mockTunnelFetch.mockResolvedValue(response(503));

        await expect(api.getOrCreateSession({ tag: 'test-tag', metadata: testMetadata, state: null })).resolves.toBeNull();
        expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Session creation failed: 503'));
        consoleSpy.mockRestore();
    });

    it('keeps machine and vendor REST helpers deleted from ApiClient', () => {
        expect('getOrCreateMachine' in api).toBe(false);
        expect('registerVendorToken' in api).toBe(false);
        expect('getVendorToken' in api).toBe(false);
    });

    it('constructs a restricted mirror client without common RPC handlers', async () => {
        const session = {
            id: 'session-1',
            seq: 0,
            metadata: testMetadata,
            metadataVersion: 1,
            agentState: null,
            agentStateVersion: 1,
            encryptionKey: new Uint8Array(32),
            encryptionVariant: 'legacy' as const,
        };
        const full = api.sessionSyncClient(session);
        const restricted = api.sessionSyncClient(session, { rpcProfile: 'mirror-read-only' });

        expect(full.rpcHandlerManager.getHandlerCount()).toBeGreaterThan(0);
        expect(restricted.rpcHandlerManager.getHandlerCount()).toBe(0);
        await full.close();
        await restricted.close();
    });

    it('returns and closes the real restricted client when logger diagnostics throw', async () => {
        const session = {
            id: 'session-logger-failure',
            seq: 0,
            metadata: testMetadata,
            metadataVersion: 1,
            agentState: null,
            agentStateVersion: 1,
            encryptionKey: new Uint8Array(32),
            encryptionVariant: 'legacy' as const,
        };
        mockLoggerDebug.mockImplementation(() => {
            throw new Error('logger unavailable');
        });

        const restricted = api.sessionSyncClient(session, { rpcProfile: 'mirror-read-only' });
        expect(restricted.rpcHandlerManager.getHandlerCount()).toBe(0);
        await expect(restricted.close()).resolves.toBeUndefined();
    });
});
