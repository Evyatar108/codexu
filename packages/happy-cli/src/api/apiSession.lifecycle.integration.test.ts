import { createServer } from 'node:http';

import { Server as SocketIOServer } from 'socket.io';
import { describe, expect, it, vi } from 'vitest';

const { runtime, mockLoggerDebug } = vi.hoisted(() => ({
    runtime: { url: '' },
    mockLoggerDebug: vi.fn(),
}));

vi.mock('@/daemon/daemonClient', () => ({
    tunnelSocketIOOptions: vi.fn(async () => ({
        url: runtime.url,
        auth: {},
    })),
}));

vi.mock('@/ui/logger', () => ({
    logger: {
        debug: mockLoggerDebug,
        debugLargeJson: vi.fn(),
    },
}));

import { ApiClient } from './api';

describe('ApiSessionClient real Socket.IO lifecycle', () => {
    it('closes a restricted factory client and real socket when logging throws', async () => {
        const httpServer = createServer();
        const socketServer = new SocketIOServer(httpServer, {
            path: '/v1/updates',
            transports: ['websocket'],
        });
        await new Promise<void>((resolve) => httpServer.listen(0, '127.0.0.1', resolve));
        const address = httpServer.address();
        if (!address || typeof address === 'string') throw new Error('Missing lifecycle server address');
        runtime.url = `http://127.0.0.1:${address.port}`;
        const connected = new Promise<void>((resolve) => {
            socketServer.once('connection', (socket) => {
                socket.on('ping', (callback: () => void) => callback());
                resolve();
            });
        });

        try {
            const api = await ApiClient.create({
                token: 'test-token',
                encryption: { type: 'legacy', secret: new Uint8Array(32) },
            });
            mockLoggerDebug.mockImplementation(() => {
                throw new Error('logger unavailable');
            });
            const client = api.sessionSyncClient({
                id: 'real-socket-session',
                seq: 0,
                metadata: {
                    path: process.cwd(),
                    host: 'localhost',
                    homeDir: process.cwd(),
                    happyHomeDir: process.cwd(),
                    happyLibDir: process.cwd(),
                    happyToolsDir: process.cwd(),
                },
                metadataVersion: 0,
                agentState: null,
                agentStateVersion: 0,
                encryptionKey: new Uint8Array(32),
                encryptionVariant: 'legacy',
            }, { rpcProfile: 'mirror-read-only' });

            await expect(Promise.race([
                connected,
                new Promise((_, reject) => setTimeout(() => reject(new Error('socket connect timed out')), 2_000)),
            ])).resolves.toBeUndefined();
            expect(client.rpcHandlerManager.getHandlerCount()).toBe(0);
            expect(socketServer.sockets.sockets.size).toBe(1);
            await expect(Promise.race([
                client.flush(),
                new Promise((_, reject) => setTimeout(() => reject(new Error('client flush timed out')), 500)),
            ])).resolves.toBeUndefined();

            await expect(Promise.race([
                client.close(),
                new Promise((_, reject) => setTimeout(() => reject(new Error('client close timed out')), 500)),
            ])).resolves.toBeUndefined();
            await vi.waitFor(() => expect(socketServer.sockets.sockets.size).toBe(0));
            expect(client.eventNames()).toEqual([]);
        } finally {
            await socketServer.close();
            await new Promise<void>((resolve) => httpServer.close(() => resolve()));
        }
    });
});
