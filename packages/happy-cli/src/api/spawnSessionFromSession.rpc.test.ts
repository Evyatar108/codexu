import { describe, expect, it, vi } from 'vitest';

import { ApiMachineClient, type SpawnSessionFromSessionRpcOptions } from './apiMachine';
import type { Machine, MachineMetadata } from './types';
import type { SpawnSessionResult } from '@/modules/common/registerCommonHandlers';

vi.mock('@/ui/logger', () => ({
    logger: {
        debug: vi.fn(),
        debugLargeJson: vi.fn(),
    },
}));

function createMachine(): Machine {
    const metadata: MachineMetadata = {
        host: 'localhost',
        platform: 'win32',
        happyCliVersion: '1.0.0',
        homeDir: 'C:/Users/test',
        happyHomeDir: 'C:/Users/test/.happy',
        happyLibDir: 'C:/happy',
    };

    return {
        id: 'machine-1',
        encryptionKey: new Uint8Array(32),
        encryptionVariant: 'legacy',
        metadata,
        metadataVersion: 1,
        daemonState: null,
        daemonStateVersion: 1,
    };
}

function getSpawnFromSessionRpcHandler(client: ApiMachineClient): (options: SpawnSessionFromSessionRpcOptions) => Promise<SpawnSessionResult> {
    const manager = (client as any).rpcHandlerManager;
    return (manager as any).handlers.get('machine-1:spawn-session-from-session');
}

describe('spawn-session-from-session machine RPC', () => {
    it('registers the handler and forwards accepted params', async () => {
        const spawnSessionFromSession = vi.fn().mockResolvedValue({ type: 'success', sessionId: 'child-local-id' });
        const client = new ApiMachineClient('token', createMachine());

        client.setRPCHandlers({
            spawnSession: vi.fn(),
            spawnSessionFromSession,
            stopSession: vi.fn(),
            requestShutdown: vi.fn(),
        });

        const result = await getSpawnFromSessionRpcHandler(client)({
            parentSessionId: 'parent-local-id',
            config: {
                agent: 'codex',
                model: 'gpt-5.4',
                permissionMode: 'safe-yolo',
                effortLevel: 'high',
                initialMessage: 'start here',
            },
        });

        expect(result).toEqual({ type: 'success', sessionId: 'child-local-id' });
        expect(spawnSessionFromSession).toHaveBeenCalledWith({
            parentSessionId: 'parent-local-id',
            config: {
                agent: 'codex',
                path: undefined,
                model: 'gpt-5.4',
                permissionMode: 'safe-yolo',
                effortLevel: 'high',
                initialMessage: 'start here',
            },
        });
    });

    it('rejects malformed parentSessionId and composite same-machine ids at the RPC boundary', async () => {
        const spawnSessionFromSession = vi.fn();
        const client = new ApiMachineClient('token', createMachine());

        client.setRPCHandlers({
            spawnSession: vi.fn(),
            spawnSessionFromSession,
            stopSession: vi.fn(),
            requestShutdown: vi.fn(),
        });

        const handler = getSpawnFromSessionRpcHandler(client);
        const tooLong = 'a'.repeat(129);
        for (const parentSessionId of ['', tooLong, 'parent id with spaces', 'parent;rm -rf /', 'parent\nid', 'machine-1:parent-local-id']) {
            await expect(handler({ parentSessionId, config: { agent: 'claude' } }))
                .resolves.toMatchObject({ type: 'error', errorMessage: expect.any(String) });
        }

        expect(spawnSessionFromSession).not.toHaveBeenCalled();
    });

    it('rejects cross-machine composite ids with the dedicated error', async () => {
        const client = new ApiMachineClient('token', createMachine());
        client.setRPCHandlers({
            spawnSession: vi.fn(),
            spawnSessionFromSession: vi.fn(),
            stopSession: vi.fn(),
            requestShutdown: vi.fn(),
        });

        await expect(getSpawnFromSessionRpcHandler(client)({ parentSessionId: 'other-machine:parent', config: { agent: 'claude' } }))
            .resolves.toEqual({ type: 'error', errorMessage: 'parent session not on this machine' });
    });

    it('rejects missing or unsupported config.agent', async () => {
        const spawnSessionFromSession = vi.fn();
        const client = new ApiMachineClient('token', createMachine());
        client.setRPCHandlers({
            spawnSession: vi.fn(),
            spawnSessionFromSession,
            stopSession: vi.fn(),
            requestShutdown: vi.fn(),
        });

        const handler = getSpawnFromSessionRpcHandler(client);
        await expect(handler({ parentSessionId: 'parent', config: undefined as any }))
            .resolves.toMatchObject({ type: 'error' });
        await expect(handler({ parentSessionId: 'parent', config: { agent: 'bad-agent' as any } }))
            .resolves.toMatchObject({ type: 'error', errorMessage: expect.stringContaining('agent must be one of') });
        expect(spawnSessionFromSession).not.toHaveBeenCalled();
    });
});
