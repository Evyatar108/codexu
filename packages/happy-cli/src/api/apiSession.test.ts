// FORK PATCH: test tracks HC-2
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiSessionClient, MessageConsumptionTimeoutError } from './apiSession';
import { encodeBase64, encrypt } from './encryption';
import type { Update } from './types';

const {
    mockIo,
    mockAxiosGet,
    mockAxiosPost,
    mockBackoff,
    mockDelay,
    mockTunnelSocketIOOptions,
    mockTunnelFetch,
    mockLoggerDebug,
    mockLoggerDebugLargeJson,
    mockMapClaudeLogMessageToSessionEnvelopes,
    mockRegisterCommonHandlers,
    mockRpcOnSocketDisconnect,
} = vi.hoisted(() => {
    const mockAxiosGet = vi.fn();
    const mockAxiosPost = vi.fn();
    return {
        mockIo: vi.fn(),
        mockAxiosGet,
        mockAxiosPost,
        mockBackoff: vi.fn(async <T>(callback: () => Promise<T>) => {
            let lastError: unknown;
            for (let i = 0; i < 20; i += 1) {
                try {
                    return await callback();
                } catch (error) {
                    lastError = error;
                }
            }
            throw lastError;
        }),
        mockDelay: vi.fn(async () => undefined),
        mockTunnelSocketIOOptions: vi.fn(async () => ({
            url: 'http://127.0.0.1:7010',
            auth: {}
        })),
        mockTunnelFetch: vi.fn(async (path: string, init: RequestInit = {}) => {
            const url = new URL(path, 'https://server.test');
            const method = init.method ?? 'GET';
            const axiosResponse = method === 'POST'
                ? await mockAxiosPost(url.origin + url.pathname, init.body ? JSON.parse(String(init.body)) : undefined, { headers: init.headers })
                : await mockAxiosGet(url.origin + url.pathname, {
                    params: Object.fromEntries([...url.searchParams.entries()].map(([key, value]) => [key, Number(value)])),
                    headers: init.headers,
                });
            const status = axiosResponse.status ?? 200;
            return {
                ok: status >= 200 && status < 300,
                status,
                json: async () => axiosResponse.data,
            };
        }),
        mockLoggerDebug: vi.fn(),
        mockLoggerDebugLargeJson: vi.fn(),
        mockMapClaudeLogMessageToSessionEnvelopes: vi.fn(),
        mockRegisterCommonHandlers: vi.fn(),
        mockRpcOnSocketDisconnect: vi.fn(),
    };
});

vi.mock('socket.io-client', () => ({
    io: mockIo
}));

vi.mock('axios', () => ({
    default: {
        get: mockAxiosGet,
        post: mockAxiosPost
    }
}));

vi.mock('@/configuration', () => ({
    configuration: {
        serverUrl: 'https://server.test',
        currentCliVersion: '1.2.3'
    }
}));

vi.mock('@/daemon/daemonClient', () => ({
    tunnelSocketIOOptions: mockTunnelSocketIOOptions,
    tunnelFetch: mockTunnelFetch,
}));

vi.mock('@/ui/logger', () => ({
    logger: {
        debug: mockLoggerDebug,
        debugLargeJson: mockLoggerDebugLargeJson
    }
}));

vi.mock('@/claude/utils/sessionProtocolMapper', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@/claude/utils/sessionProtocolMapper')>();

    return {
        ...actual,
        mapClaudeLogMessageToSessionEnvelopes: ((...args: Parameters<typeof actual.mapClaudeLogMessageToSessionEnvelopes>) => {
            mockMapClaudeLogMessageToSessionEnvelopes(...args);
            return actual.mapClaudeLogMessageToSessionEnvelopes(...args);
        })
    };
});

vi.mock('@/api/rpc/RpcHandlerManager', () => ({
    RpcHandlerManager: class {
        onSocketConnect = vi.fn();
        onSocketDisconnect = mockRpcOnSocketDisconnect;
        handleRequest = vi.fn(async () => '');
    }
}));

vi.mock('@/modules/common/registerCommonHandlers', () => ({
    registerCommonHandlers: mockRegisterCommonHandlers,
}));

vi.mock('@/utils/time', () => ({
    backoff: mockBackoff,
    delay: mockDelay
}));

type SocketHandler = (...args: any[]) => void;
type SocketHandlers = Record<string, SocketHandler[]>;

function makeSession() {
    return {
        id: 'test-session-id',
        seq: 0,
        metadata: {
            path: '/tmp',
            host: 'localhost',
            homeDir: '/home/user',
            happyHomeDir: '/home/user/.happy',
            happyLibDir: '/home/user/.happy/lib',
            happyToolsDir: '/home/user/.happy/tools'
        },
        metadataVersion: 0,
        agentState: null,
        agentStateVersion: 0,
        encryptionKey: new Uint8Array(32),
        encryptionVariant: 'legacy' as const
    };
}

function encryptContent(session: ReturnType<typeof makeSession>, content: unknown): string {
    return encodeBase64(encrypt(session.encryptionKey, session.encryptionVariant, content));
}

function plaintextContent(content: unknown): string {
    return JSON.stringify(content);
}

function parsePostedMessage(index = 0, callIndex = 0): any {
    const payload = mockAxiosPost.mock.calls[callIndex][1];
    return JSON.parse(payload.messages[index].content);
}

function mockNextPostAck(seq = 1, id = `msg-${seq}`): void {
    mockAxiosPost.mockImplementationOnce(async (_url: string, body: { messages: Array<{ localId: string }> }) => ({
        data: {
            messages: body.messages.map((message) => ({
                id,
                seq,
                localId: message.localId,
                createdAt: seq,
                updatedAt: seq,
            }))
        }
    }));
}

function createNewMessageUpdate(seq: number, serializedContent: string, localId: string | null = null): Update {
    return {
        id: `upd-${seq}`,
        seq,
        createdAt: Date.now(),
        body: {
            t: 'new-message',
            sid: 'test-session-id',
            message: {
                id: `msg-${seq}`,
                seq,
                localId,
                content: {
                    t: 'encrypted',
                    c: serializedContent
                },
                createdAt: Date.now(),
                updatedAt: Date.now(),
            }
        }
    };
}

function createUpdateSessionUpdate(version: number, metadata: unknown): Update {
    return {
        id: `upd-session-${version}`,
        seq: version,
        createdAt: Date.now(),
        body: {
            t: 'update-session',
            id: 'test-session-id',
            metadata: {
                version,
                value: plaintextContent(metadata),
            },
        },
    };
}

async function waitForCheck(check: () => void, timeoutMs = 2000) {
    const startedAt = Date.now();
    let lastError: unknown;
    while (Date.now() - startedAt < timeoutMs) {
        try {
            check();
            return;
        } catch (error) {
            lastError = error;
            await new Promise((resolve) => setTimeout(resolve, 5));
        }
    }
    throw lastError;
}

async function waitForSocketInit(mockSocket: any) {
    await waitForCheck(() => expect(mockSocket.on).toHaveBeenCalled());
}

describe('ApiSessionClient v3 messages API migration', () => {
    let socketHandlers: SocketHandlers;
    let mockSocket: any;
    let session: ReturnType<typeof makeSession>;

    const emitSocketEvent = (event: string, ...args: any[]) => {
        const handlers = socketHandlers[event] || [];
        handlers.forEach((handler) => handler(...args));
    };

    beforeEach(() => {
        vi.clearAllMocks();
        mockLoggerDebug.mockReset();
        mockLoggerDebugLargeJson.mockReset();
        socketHandlers = {};
        session = makeSession();
        mockSocket = {
            connected: true,
            auth: {},
            io: { uri: '', opts: {} },
            connect: vi.fn(),
            on: vi.fn((event: string, handler: SocketHandler) => {
                if (!socketHandlers[event]) {
                    socketHandlers[event] = [];
                }
                socketHandlers[event].push(handler);
            }),
            off: vi.fn(),
            emit: vi.fn(),
            emitWithAck: vi.fn(async () => ({ result: 'error' })),
            volatile: {
                emit: vi.fn()
            },
            close: vi.fn(),
            disconnect: vi.fn(),
            removeAllListeners: vi.fn(() => { socketHandlers = {}; })
        };

        mockIo.mockReturnValue(mockSocket);
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('registers core socket handlers and connects', async () => {
        new ApiSessionClient('fake-token', session);

        await waitForSocketInit(mockSocket);
        expect(mockSocket.on).toHaveBeenCalledWith('connect', expect.any(Function));
        expect(mockSocket.on).toHaveBeenCalledWith('disconnect', expect.any(Function));
        expect(mockSocket.on).toHaveBeenCalledWith('update', expect.any(Function));
        await waitForCheck(() => {
            expect(mockSocket.connect).toHaveBeenCalledTimes(1);
        });
    });

    it('never installs common handlers for the restricted profile', async () => {
        const client = new ApiSessionClient('fake-token', session, { rpcProfile: 'mirror-read-only' });

        await waitForSocketInit(mockSocket);
        expect(mockRegisterCommonHandlers).not.toHaveBeenCalled();
        await client.close();
    });

    it('preserves normal-profile handlers', async () => {
        const client = new ApiSessionClient('fake-token', session);

        await waitForSocketInit(mockSocket);
        expect(mockRegisterCommonHandlers).toHaveBeenCalledOnce();
        await client.close();
    });

    it('tears down socket, RPC, and client listeners before fallible close logging', async () => {
        const client = new ApiSessionClient('fake-token', session, { rpcProfile: 'mirror-read-only' });
        const archived = vi.fn();
        client.on('archived', archived);
        await waitForSocketInit(mockSocket);
        mockLoggerDebug.mockImplementation(() => {
            throw new Error('logger unavailable');
        });

        await expect(Promise.race([
            client.close(),
            new Promise((_, reject) => setTimeout(() => reject(new Error('close timed out')), 250)),
        ])).resolves.toBeUndefined();
        expect(mockRpcOnSocketDisconnect).toHaveBeenCalledOnce();
        expect(mockSocket.removeAllListeners).toHaveBeenCalledOnce();
        expect(mockSocket.close).toHaveBeenCalledOnce();
        expect(client.listenerCount('archived')).toBe(0);
        expect(Object.values(socketHandlers).flat()).toHaveLength(0);
    });

    it('clears reconnect interval and timeout during logger-failure cleanup', async () => {
        const client = new ApiSessionClient('fake-token', session, { rpcProfile: 'mirror-read-only' });
        await waitForSocketInit(mockSocket);
        mockSocket.connected = false;
        vi.useFakeTimers();
        try {
            emitSocketEvent('disconnect', 'transport close');
            expect(vi.getTimerCount()).toBeGreaterThan(0);
            mockLoggerDebug.mockImplementation(() => {
                throw new Error('logger unavailable');
            });

            await client.close();
            expect(vi.getTimerCount()).toBe(0);
            expect(mockSocket.removeAllListeners).toHaveBeenCalledOnce();
            expect(mockSocket.close).toHaveBeenCalledOnce();
        } finally {
            vi.useRealTimers();
        }
    });

    it('clears successful flush deadline timers', async () => {
        const client = new ApiSessionClient('fake-token', session, { rpcProfile: 'mirror-read-only' });
        await waitForSocketInit(mockSocket);
        mockSocket.emit.mockImplementation((event: string, callback?: () => void) => {
            if (event === 'ping') callback?.();
        });
        vi.useFakeTimers();
        try {
            await client.flush();
            expect(vi.getTimerCount()).toBe(0);
            await client.close();
        } finally {
            vi.useRealTimers();
        }
    });

    it('queues agent configuration metadata diffs until a runner subscribes', async () => {
        const client = new ApiSessionClient('fake-token', session);
        const nextMetadata = {
            ...session.metadata,
            currentModelCode: 'claude-opus',
            currentPermissionModeCode: 'plan',
            currentThoughtLevelCode: 'high',
        };

        await waitForSocketInit(mockSocket);
        emitSocketEvent('update', createUpdateSessionUpdate(1, nextMetadata));

        const received: unknown[] = [];
        client.onAgentConfiguration((configuration) => received.push(configuration));

        expect(received).toEqual([
            {
                model: 'claude-opus',
                permissionMode: 'plan',
                thinkingLevel: 'high',
            },
        ]);
    });

    it('does not emit agent configuration when update-session metadata is unchanged', async () => {
        session.metadata = {
            ...session.metadata,
            currentModelCode: 'claude-sonnet',
            currentPermissionModeCode: 'default',
            currentThoughtLevelCode: 'medium',
        } as typeof session.metadata;
        const client = new ApiSessionClient('fake-token', session);
        const received: unknown[] = [];
        client.onAgentConfiguration((configuration) => received.push(configuration));

        await waitForSocketInit(mockSocket);
        emitSocketEvent('update', createUpdateSessionUpdate(1, { ...session.metadata }));

        expect(received).toEqual([]);
    });

    it('queues codex message to v3 outbox, sends once, and drains outbox', async () => {
        const client = new ApiSessionClient('fake-token', session);
        mockAxiosPost.mockImplementationOnce(async (_url: string, body: { messages: Array<{ localId: string }> }) => ({
            data: {
                messages: body.messages.map((message) => ({
                    id: 'msg-1',
                    seq: 1,
                    localId: message.localId,
                    createdAt: 1,
                    updatedAt: 1
                }))
            }
        }));

        client.sendCodexMessage({ type: 'delta', text: 'hello' });

        await waitForCheck(() => {
            expect(mockAxiosPost).toHaveBeenCalledTimes(1);
            expect((client as any).pendingOutbox).toHaveLength(0);
        });

        const payload = mockAxiosPost.mock.calls[0][1];
        expect(payload.messages).toHaveLength(1);
        expect(typeof payload.messages[0].localId).toBe('string');
        expect((client as any).pendingOutbox).toHaveLength(0);
        expect((client as any).lastSeq).toBe(0);

        const decrypted = JSON.parse(payload.messages[0].content);
        expect(decrypted).toEqual({
            role: 'agent',
            content: {
                type: 'codex',
                data: { type: 'delta', text: 'hello' }
            },
            meta: {
                sentFrom: 'cli'
            }
        });
    });

    it('accumulates multiple pending outbox messages into one follow-up batch', async () => {
        const client = new ApiSessionClient('fake-token', session);

        type PostResponse = {
            data: {
                messages: Array<{ id: string; seq: number; localId: string; createdAt: number; updatedAt: number }>;
            };
        };
        let resolveFirstPost!: (value: PostResponse) => void;
        let firstLocalId = '';
        mockAxiosPost
            .mockImplementationOnce((_url: string, body: { messages: Array<{ localId: string }> }) => new Promise<PostResponse>((resolve) => {
                firstLocalId = body.messages[0].localId;
                resolveFirstPost = resolve;
            }))
            .mockImplementationOnce(async (_url: string, body: { messages: Array<{ localId: string }> }) => ({
                data: {
                    messages: body.messages.map((message, index) => ({
                        id: `msg-${index + 2}`,
                        seq: index + 2,
                        localId: message.localId,
                        createdAt: index + 2,
                        updatedAt: index + 2
                    }))
                }
            }));

        client.sendCodexMessage({ type: 'first' });
        await waitForCheck(() => {
            expect(mockAxiosPost).toHaveBeenCalledTimes(1);
        });

        client.sendCodexMessage({ type: 'second' });
        client.sendCodexMessage({ type: 'third' });

        resolveFirstPost({
            data: {
                messages: [
                    { id: 'msg-1', seq: 1, localId: firstLocalId, createdAt: 1, updatedAt: 1 }
                ]
            }
        });

        await waitForCheck(() => {
            expect(mockAxiosPost).toHaveBeenCalledTimes(2);
        });

        const secondPayload = mockAxiosPost.mock.calls[1][1];
        expect(secondPayload.messages).toHaveLength(2);
        expect((client as any).pendingOutbox).toHaveLength(0);
        expect((client as any).lastSeq).toBe(0);
    });

    it('retries failed POST and succeeds without dropping queued messages', async () => {
        const client = new ApiSessionClient('fake-token', session);

        mockAxiosPost
            .mockRejectedValueOnce(new Error('network down'))
            .mockImplementationOnce(async (_url: string, body: { messages: Array<{ localId: string }> }) => ({
                data: {
                    messages: body.messages.map((message) => ({
                        id: 'msg-1',
                        seq: 1,
                        localId: message.localId,
                        createdAt: 1,
                        updatedAt: 1
                    }))
                }
            }));

        client.sendCodexMessage({ type: 'retry-me' });

        await waitForCheck(() => {
            expect(mockAxiosPost).toHaveBeenCalledTimes(2);
        });

        const firstPayload = mockAxiosPost.mock.calls[0][1];
        const secondPayload = mockAxiosPost.mock.calls[1][1];
        expect(secondPayload).toEqual(firstPayload);
        expect((client as any).pendingOutbox).toHaveLength(0);
        expect((client as any).lastSeq).toBe(0);
    });

    it('flushes queues larger than 50 from the oldest row forward', async () => {
        const client = new ApiSessionClient('fake-token', session);
        mockAxiosPost.mockImplementation(async (_url: string, body: { messages: Array<{ localId: string }> }) => ({
            data: {
                messages: body.messages.map((message) => {
                    const index = Number(message.localId.slice('ordered-'.length));
                    return {
                        id: `msg-${index}`,
                        seq: index + 1,
                        localId: message.localId,
                        createdAt: index + 1,
                        updatedAt: index + 1,
                    };
                })
            }
        }));

        const deliveries = Array.from({ length: 55 }, (_, index) => (
            (client as any).enqueueMessageWithDelivery(
                { role: 'agent', content: { index } },
                false,
                `ordered-${index}`,
            )
        ));
        (client as any).sendSync.invalidate();

        await expect(Promise.all(deliveries)).resolves.toHaveLength(55);
        await waitForCheck(() => {
            expect(mockAxiosPost).toHaveBeenCalledTimes(2);
            expect((client as any).pendingOutbox).toHaveLength(0);
        });

        expect(mockAxiosPost.mock.calls[0][1].messages.map((message: { localId: string }) => message.localId))
            .toEqual(Array.from({ length: 50 }, (_, index) => `ordered-${index}`));
        expect(mockAxiosPost.mock.calls[1][1].messages.map((message: { localId: string }) => message.localId))
            .toEqual(Array.from({ length: 5 }, (_, index) => `ordered-${index + 50}`));
    });

    it('evicts delivered localId tracking as long-running inbound scanning catches up', async () => {
        const client = new ApiSessionClient('fake-token', session);
        const onMessage = vi.fn();
        client.on('message', onMessage);
        const messageCount = 120;
        mockAxiosPost.mockImplementation(async (_url: string, body: { messages: Array<{ localId: string }> }) => ({
            data: {
                messages: body.messages.map((message) => {
                    const seq = Number(message.localId.slice('long-run-'.length)) + 1;
                    return {
                        id: `msg-${seq}`,
                        seq,
                        localId: message.localId,
                        createdAt: seq,
                        updatedAt: seq,
                    };
                })
            }
        }));

        const deliveries = Array.from({ length: messageCount }, (_, index) => (
            (client as any).enqueueMessageWithDelivery(
                { role: 'agent', content: { index } },
                false,
                `long-run-${index}`,
            )
        ));
        (client as any).sendSync.invalidate();

        await expect(Promise.all(deliveries)).resolves.toHaveLength(messageCount);
        expect((client as any).lastSeq).toBe(0);
        expect((client as any).outboundDeliverySeqs.size).toBe(messageCount);

        const storedMessages = Array.from({ length: messageCount }, (_, index) => {
            const seq = index + 1;
            return {
                id: `msg-${seq}`,
                seq,
                localId: `long-run-${index}`,
                content: { t: 'encrypted', c: plaintextContent({ role: 'session' }) },
                createdAt: seq,
                updatedAt: seq,
            };
        });
        mockAxiosGet
            .mockResolvedValueOnce({
                data: {
                    messages: storedMessages.slice(0, 100),
                    hasMore: true,
                }
            })
            .mockResolvedValueOnce({
                data: {
                    messages: storedMessages.slice(100),
                    hasMore: false,
                }
            });

        await (client as any).fetchMessages();

        expect((client as any).lastSeq).toBe(messageCount);
        expect((client as any).outboundDeliverySeqs.size).toBe(0);
        expect((client as any).outboundDeliveryHeap).toHaveLength(0);
        expect(onMessage).not.toHaveBeenCalled();
        expect(mockAxiosGet.mock.calls[1][1].params.after_seq).toBe(100);
    });

    it('evicts out-of-order delivered sequences in watermark order', async () => {
        const client = new ApiSessionClient('fake-token', session);
        const highDelivery = (client as any).enqueueMessageWithDelivery(
            { role: 'agent', content: 'high' },
            false,
            'heap-high',
        );
        const lowDelivery = (client as any).enqueueMessageWithDelivery(
            { role: 'agent', content: 'low' },
            false,
            'heap-low',
        );

        (client as any).resolveOutboundDelivery('heap-high', { id: 'msg-high', seq: 30 });
        (client as any).resolveOutboundDelivery('heap-low', { id: 'msg-low', seq: 20 });
        await expect(Promise.all([highDelivery, lowDelivery])).resolves.toEqual([
            { id: 'msg-high', seq: 30 },
            { id: 'msg-low', seq: 20 },
        ]);

        (client as any).lastSeq = 25;
        (client as any).evictScannedOutboundDeliveries();
        expect((client as any).outboundDeliverySeqs).toEqual(new Map([['heap-high', 30]]));
        expect((client as any).outboundDeliveryHeap).toEqual([{ localId: 'heap-high', seq: 30 }]);

        (client as any).lastSeq = 30;
        (client as any).evictScannedOutboundDeliveries();
        expect((client as any).outboundDeliverySeqs.size).toBe(0);
        expect((client as any).outboundDeliveryHeap).toHaveLength(0);
        await client.close();
    });

    it('correlates out-of-order acknowledgements by caller-supplied localId', async () => {
        const client = new ApiSessionClient('fake-token', session);
        mockAxiosPost.mockImplementationOnce(async (_url: string, body: { messages: Array<{ localId: string }> }) => ({
            data: {
                messages: [...body.messages].reverse().map((message, index) => ({
                    id: `msg-${message.localId}`,
                    seq: 20 + index,
                    localId: message.localId,
                    createdAt: 20 + index,
                    updatedAt: 20 + index,
                }))
            }
        }));

        const first = (client as any).enqueueMessageWithDelivery(
            { role: 'agent', content: 'a' },
            false,
            'stable-a',
        );
        const second = (client as any).enqueueMessageWithDelivery(
            { role: 'agent', content: 'b' },
            false,
            'stable-b',
        );
        (client as any).sendSync.invalidate();

        await expect(first).resolves.toEqual({ id: 'msg-stable-a', seq: 21 });
        await expect(second).resolves.toEqual({ id: 'msg-stable-b', seq: 20 });
        expect(mockAxiosPost.mock.calls[0][1].messages.map((message: { localId: string }) => message.localId))
            .toEqual(['stable-a', 'stable-b']);
    });

    it('deduplicates repeated pending sends with the same caller-supplied localId', async () => {
        const client = new ApiSessionClient('fake-token', session);
        type PostResponse = {
            data: {
                messages: Array<{ id: string; seq: number; localId: string; createdAt: number; updatedAt: number }>;
            };
        };
        let resolvePost!: (value: PostResponse) => void;
        mockAxiosPost.mockImplementationOnce(() => new Promise<PostResponse>((resolve) => {
            resolvePost = resolve;
        }));
        const envelope = {
            id: 'duplicate-envelope',
            time: 2,
            role: 'agent' as const,
            ev: { t: 'text' as const, text: 'duplicate-safe' },
        };

        const first = client.sendSessionProtocolMessageWithDelivery(
            envelope,
            { localId: 'duplicate-stable-id' },
        );
        const second = client.sendSessionProtocolMessageWithDelivery(
            envelope,
            { localId: 'duplicate-stable-id' },
        );

        expect(second).toBe(first);
        await waitForCheck(() => expect(mockAxiosPost).toHaveBeenCalledTimes(1));
        expect(mockAxiosPost.mock.calls[0][1].messages).toHaveLength(1);

        resolvePost({
            data: {
                messages: [{
                    id: 'duplicate-message',
                    seq: 25,
                    localId: 'duplicate-stable-id',
                    createdAt: 25,
                    updatedAt: 25,
                }]
            }
        });
        await expect(first).resolves.toEqual({ id: 'duplicate-message', seq: 25 });
        await expect(second).resolves.toEqual({ id: 'duplicate-message', seq: 25 });
    });

    it('rejects an empty caller localId before queue mutation and keeps later delivery usable', async () => {
        const client = new ApiSessionClient('fake-token', session);
        const envelope = {
            id: 'validated-envelope',
            time: 3,
            role: 'agent' as const,
            ev: { t: 'text' as const, text: 'validated' },
        };

        await expect(client.sendSessionProtocolMessageWithDelivery(
            envelope,
            { localId: '' },
        )).rejects.toThrow('Session message localId must not be empty');
        expect(mockAxiosPost).not.toHaveBeenCalled();
        expect((client as any).pendingOutbox).toHaveLength(0);
        expect((client as any).seqResolvers.size).toBe(0);
        expect((client as any).outboundDeliverySeqs.size).toBe(0);

        mockNextPostAck(26, 'validated-message');
        await expect(client.sendSessionProtocolMessageWithDelivery(
            envelope,
            { localId: 'validated-local-id' },
        )).resolves.toEqual({ id: 'validated-message', seq: 26 });
        expect(mockAxiosPost).toHaveBeenCalledTimes(1);
        expect(mockAxiosPost.mock.calls[0][1].messages[0].localId).toBe('validated-local-id');
        expect((client as any).pendingOutbox).toHaveLength(0);
    });

    it('reuses a deterministic localId across retry and a new client instance', async () => {
        const envelope = {
            id: 'restart-envelope',
            time: 3,
            role: 'agent' as const,
            ev: { t: 'text' as const, text: 'restart-safe' },
        };
        const respondWithExistingDelivery = async (
            _url: string,
            body: { messages: Array<{ localId: string }> },
        ) => ({
            data: {
                messages: body.messages.map((message) => ({
                    id: 'existing-message',
                    seq: 30,
                    localId: message.localId,
                    createdAt: 30,
                    updatedAt: 30,
                }))
            }
        });
        mockAxiosPost
            .mockRejectedValueOnce(new Error('connection reset'))
            .mockImplementationOnce(respondWithExistingDelivery)
            .mockImplementationOnce(respondWithExistingDelivery);

        const firstClient = new ApiSessionClient('fake-token', session);
        await expect(firstClient.sendSessionProtocolMessageWithDelivery(
            envelope,
            { localId: 'restart-stable-id' },
        )).resolves.toEqual({ id: 'existing-message', seq: 30 });

        const retryPayload = mockAxiosPost.mock.calls[1][1];
        expect(retryPayload).toEqual(mockAxiosPost.mock.calls[0][1]);
        expect(retryPayload.messages[0].localId).toBe('restart-stable-id');

        const restartedClient = new ApiSessionClient('fake-token', session);
        await expect(restartedClient.sendSessionProtocolMessageWithDelivery(
            envelope,
            { localId: 'restart-stable-id' },
        )).resolves.toEqual({ id: 'existing-message', seq: 30 });
        expect(mockAxiosPost.mock.calls[2][1].messages[0].localId).toBe('restart-stable-id');
    });

    it('sends claude user text as modern session envelope', async () => {
        const client = new ApiSessionClient('fake-token', session);
        mockNextPostAck();

        client.sendClaudeSessionMessage({
            type: 'user',
            message: { content: 'hi there' },
            isSidechain: false,
            isMeta: false
        } as any);

        await waitForCheck(() => {
            expect(mockAxiosPost).toHaveBeenCalledTimes(1);
        });

        const payload = mockAxiosPost.mock.calls[0][1];
        expect(payload.messages).toHaveLength(1);

        const sessionUser = JSON.parse(payload.messages[0].content);
        expect(sessionUser).toMatchObject({
            role: 'session',
            content: {
                role: 'user',
                ev: {
                    t: 'text',
                    text: 'hi there'
                }
            },
            meta: {
                sentFrom: 'cli'
            }
        });
        expect(typeof (sessionUser as any).content.time).toBe('number');
    });

    it('drops SKILL-shaped raw Claude user messages before mapper and outbox', () => {
        const client = new ApiSessionClient('fake-token', session);

        client.sendClaudeSessionMessage({
            type: 'user',
            message: {
                content: [
                    {
                        type: 'text',
                        text: 'Base directory for this skill: C:\\Users\\foo\\.claude\\skills\\demo\n\n# Demo Skill\n\nInstructions'
                    }
                ]
            },
            isSidechain: false,
            isMeta: false
        } as any);

        expect(mockMapClaudeLogMessageToSessionEnvelopes).not.toHaveBeenCalled();
        expect(mockAxiosPost).not.toHaveBeenCalled();
        expect((client as any).pendingOutbox).toHaveLength(0);
        expect(mockLoggerDebug).toHaveBeenCalledWith(
            '[SOCKET] Dropped non-renderable claude message',
            { class: 'skill-body' }
        );
    });

    it('drops standalone local-command-caveat user messages before mapper and outbox', () => {
        const client = new ApiSessionClient('fake-token', session);

        client.sendClaudeSessionMessage({
            type: 'user',
            message: {
                content: '<local-command-caveat>Use the local shell carefully.</local-command-caveat>'
            },
            isSidechain: false,
            isMeta: false
        } as any);

        expect(mockMapClaudeLogMessageToSessionEnvelopes).not.toHaveBeenCalled();
        expect(mockAxiosPost).not.toHaveBeenCalled();
        expect((client as any).pendingOutbox).toHaveLength(0);
        expect(mockLoggerDebug).toHaveBeenCalledWith(
            '[SOCKET] Dropped non-renderable claude message',
            { class: 'local-command-caveat' }
        );
    });

    it('keeps user messages that mention the SKILL prefix mid-paragraph', async () => {
        const client = new ApiSessionClient('fake-token', session);
        mockNextPostAck();

        client.sendClaudeSessionMessage({
            type: 'user',
            message: {
                content: 'Please explain this line: Base directory for this skill: C:\\tmp\n\n# Not injected'
            },
            isSidechain: false,
            isMeta: false
        } as any);

        await waitForCheck(() => {
            expect(mockAxiosPost).toHaveBeenCalledTimes(1);
        });
        expect(mockMapClaudeLogMessageToSessionEnvelopes).toHaveBeenCalledTimes(1);
        expect(parsePostedMessage()).toMatchObject({
            role: 'session',
            content: {
                role: 'user',
                ev: {
                    t: 'text',
                    text: 'Please explain this line: Base directory for this skill: C:\\tmp\n\n# Not injected'
                }
            }
        });
    });

    it('keeps user messages that quote local-command-caveat inside a paragraph or code block', async () => {
        const client = new ApiSessionClient('fake-token', session);
        mockNextPostAck();
        const text = 'Example:\n```xml\n<local-command-caveat>quoted</local-command-caveat>\n```';

        client.sendClaudeSessionMessage({
            type: 'user',
            message: { content: text },
            isSidechain: false,
            isMeta: false
        } as any);

        await waitForCheck(() => {
            expect(mockAxiosPost).toHaveBeenCalledTimes(1);
        });
        expect(mockMapClaudeLogMessageToSessionEnvelopes).toHaveBeenCalledTimes(1);
        expect(parsePostedMessage()).toMatchObject({
            role: 'session',
            content: {
                role: 'user',
                ev: { t: 'text', text }
            }
        });
    });

    it('keeps standalone system-reminder user messages because the entry is receiver-only', async () => {
        const client = new ApiSessionClient('fake-token', session);
        mockNextPostAck();

        client.sendClaudeSessionMessage({
            type: 'user',
            message: { content: '<system-reminder>Remember this.</system-reminder>' },
            isSidechain: false,
            isMeta: false
        } as any);

        await waitForCheck(() => {
            expect(mockAxiosPost).toHaveBeenCalledTimes(1);
        });
        expect(mockMapClaudeLogMessageToSessionEnvelopes).toHaveBeenCalledTimes(1);
        expect(parsePostedMessage()).toMatchObject({
            role: 'session',
            content: {
                role: 'user',
                ev: { t: 'text', text: '<system-reminder>Remember this.</system-reminder>' }
            }
        });
    });

    it('keeps assistant thinking content blocks on the wire', async () => {
        const client = new ApiSessionClient('fake-token', session);
        mockAxiosPost.mockImplementation(async (_url: string, body: { messages: Array<{ localId: string }> }) => ({
            data: {
                messages: body.messages.map((message, index) => ({
                    id: `msg-${index + 1}`,
                    seq: index + 1,
                    localId: message.localId,
                    createdAt: index + 1,
                    updatedAt: index + 1
                }))
            }
        }));

        client.sendClaudeSessionMessage({
            type: 'assistant',
            uuid: 'assistant-thinking-1',
            message: {
                role: 'assistant',
                content: [
                    {
                        type: 'thinking',
                        thinking: 'private reasoning summary'
                    }
                ]
            }
        } as any);

        await waitForCheck(() => {
            expect(mockAxiosPost).toHaveBeenCalledTimes(2);
        });
        expect(mockMapClaudeLogMessageToSessionEnvelopes).toHaveBeenCalledTimes(1);
        expect(parsePostedMessage(0, 1)).toMatchObject({
            role: 'session',
            content: {
                role: 'agent',
                ev: {
                    t: 'text',
                    text: 'private reasoning summary',
                    thinking: true
                }
            }
        });
    });

    it('sends session protocol messages through enqueueMessage with session envelope', async () => {
        const client = new ApiSessionClient('fake-token', session);
        mockNextPostAck();

        const envelope = {
            id: 'env-1',
            time: 1000,
            role: 'agent' as const,
            turn: 'turn-1',
            ev: { t: 'text' as const, text: 'hello from session protocol' }
        };
        client.sendSessionProtocolMessage(envelope);

        await waitForCheck(() => {
            expect(mockAxiosPost).toHaveBeenCalledTimes(1);
        });

        const payload = mockAxiosPost.mock.calls[0][1];
        const decrypted = JSON.parse(payload.messages[0].content);

        expect(decrypted).toEqual({
            role: 'session',
            content: envelope,
            meta: {
                sentFrom: 'cli'
            }
        });
    });

    it('sends only modern payload for user session envelopes', async () => {
        const client = new ApiSessionClient('fake-token', session);
        mockNextPostAck();

        client.sendSessionProtocolMessage({
            id: 'env-user-1',
            time: 1001,
            role: 'user',
            ev: { t: 'text', text: 'shadow this' }
        });

        await waitForCheck(() => {
            expect(mockAxiosPost).toHaveBeenCalledTimes(1);
        });

        const payload = mockAxiosPost.mock.calls[0][1];
        expect(payload.messages).toHaveLength(1);

        const sessionUser = JSON.parse(payload.messages[0].content);
        expect(sessionUser).toMatchObject({
            role: 'session',
            content: {
                id: 'env-user-1',
                time: 1001,
                role: 'user',
                ev: { t: 'text', text: 'shadow this' }
            }
        });
    });

    it('sends modern session envelope for user text', async () => {
        const client = new ApiSessionClient('fake-token', session);
        mockNextPostAck();

        client.sendSessionProtocolMessage({
            id: 'env-user-flag-on-1',
            time: 1002,
            role: 'user',
            ev: { t: 'text', text: 'session only' }
        });

        await waitForCheck(() => {
            expect(mockAxiosPost).toHaveBeenCalledTimes(1);
        });

        const payload = mockAxiosPost.mock.calls[0][1];
        expect(payload.messages).toHaveLength(1);

        const sessionOnly = JSON.parse(payload.messages[0].content);

        expect(sessionOnly).toMatchObject({
            role: 'session',
            content: {
                role: 'user',
                ev: { t: 'text', text: 'session only' }
            },
            meta: {
                sentFrom: 'cli'
            }
        });
        expect(typeof (sessionOnly as any).content.time).toBe('number');
    });

    it('sends ACP agent messages through enqueueMessage', async () => {
        const client = new ApiSessionClient('fake-token', session);
        mockNextPostAck();

        client.sendAgentMessage('codex', {
            type: 'message',
            message: 'hi'
        });

        await waitForCheck(() => {
            expect(mockAxiosPost).toHaveBeenCalledTimes(1);
        });

        const payload = mockAxiosPost.mock.calls[0][1];
        const decrypted = JSON.parse(payload.messages[0].content);

        expect(decrypted).toEqual({
            role: 'agent',
            content: {
                type: 'acp',
                provider: 'codex',
                data: {
                    type: 'message',
                    message: 'hi'
                }
            },
            meta: {
                sentFrom: 'cli'
            }
        });
    });

    it('sends agent tree deltas over the session-scoped socket without sid', async () => {
        const client = new ApiSessionClient('fake-token', session);
        await waitForSocketInit(mockSocket);

        client.sendAgentTreeUpdate({
            type: 'pending-spawn-started',
            seq: 1,
            callId: 'call-a',
            parentThreadId: 'root-thread',
            agentRole: 'explorer',
            nickname: 'A',
            startedAt: 10,
        });

        expect(mockSocket.emit).toHaveBeenCalledWith('agent-tree-update', {
            delta: {
                type: 'pending-spawn-started',
                seq: 1,
                callId: 'call-a',
                parentThreadId: 'root-thread',
                agentRole: 'explorer',
                nickname: 'A',
                startedAt: 10,
            },
        });
    });

    it('sends session events through enqueueMessage', async () => {
        const client = new ApiSessionClient('fake-token', session);
        mockNextPostAck();

        client.sendSessionEvent({ type: 'ready' }, 'event-1', { contextBoundaryFallback: true });

        await waitForCheck(() => {
            expect(mockAxiosPost).toHaveBeenCalledTimes(1);
        });

        const payload = mockAxiosPost.mock.calls[0][1];
        const decrypted = JSON.parse(payload.messages[0].content);

        expect(decrypted).toEqual({
            role: 'agent',
            content: {
                id: 'event-1',
                type: 'event',
                data: {
                    type: 'ready'
                }
            },
            meta: {
                contextBoundaryFallback: true
            }
        });
    });

    it('sends context boundary typed-first, legacy fallback second, and updates metadata', async () => {
        const client = new ApiSessionClient('fake-token', session);
        mockAxiosPost.mockImplementationOnce(async (_url: string, body: { messages: Array<{ localId: string }> }) => ({
            data: {
                messages: body.messages.map((m, i) => ({
                    id: `msg-${i + 1}`,
                    seq: i + 1,
                    localId: m.localId,
                    createdAt: i + 1,
                    updatedAt: i + 1,
                }))
            }
        }));
        mockSocket.emitWithAck.mockImplementation(async (event: string, data: any) => {
            if (event === 'update-metadata') {
                return { result: 'success', version: 1, metadata: data.metadata };
            }
            return { result: 'error' };
        });

        await client.sendContextBoundary({
            kind: 'clear',
            triggeredBy: 'user',
            at: 1234,
        });

        await waitForCheck(() => {
            expect(mockAxiosPost).toHaveBeenCalledTimes(1);
        });

        const payload = mockAxiosPost.mock.calls[0][1];
        expect(payload.messages).toHaveLength(2);

        const typed = JSON.parse(payload.messages[0].content) as any;
        const fallback = JSON.parse(payload.messages[1].content);

        expect(typed).toMatchObject({
            role: 'session',
            content: {
                role: 'agent',
                time: 1234,
                ev: {
                    t: 'context-boundary',
                    kind: 'clear',
                    at: 1234,
                    triggeredBy: 'user'
                }
            },
            meta: {
                sentFrom: 'cli'
            }
        });
        expect(fallback).toMatchObject({
            role: 'agent',
            content: {
                type: 'event',
                data: {
                    type: 'message',
                    message: 'Context was reset'
                }
            },
            meta: {
                contextBoundaryFallback: true
            }
        });

        const metadataPayload = mockSocket.emitWithAck.mock.calls.find((call: any[]) => call[0] === 'update-metadata')?.[1];
        expect(metadataPayload).toBeTruthy();
        const metadata = JSON.parse(metadataPayload.metadata) as any;
        expect(metadata.latestBoundary).toEqual({
            id: typed.content.id,
            kind: 'clear',
            seq: 1,
            at: 1234,
        });
    });

    it('routes plan-mode mapper intents through sendContextBoundary', async () => {
        const client = new ApiSessionClient('fake-token', session);
        const sendContextBoundary = vi.spyOn(client, 'sendContextBoundary').mockResolvedValue(undefined);
        mockAxiosPost.mockImplementation(async (_url: string, body: { messages: Array<{ localId: string }> }) => ({
            data: {
                messages: body.messages.map((message, index) => ({
                    id: `msg-${index + 1}`,
                    seq: index + 1,
                    localId: message.localId,
                    createdAt: index + 1,
                    updatedAt: index + 1,
                }))
            }
        }));

        client.sendClaudeSessionMessage({
            type: 'assistant',
            uuid: 'assistant-plan-enter',
            message: {
                role: 'assistant',
                content: [
                    {
                        type: 'tool_use',
                        id: 'tool-plan-enter',
                        name: 'EnterPlanMode',
                        input: {},
                    },
                ],
            },
        } as any);
        client.sendClaudeSessionMessage({
            type: 'assistant',
            uuid: 'assistant-plan-exit',
            message: {
                role: 'assistant',
                content: [
                    {
                        type: 'tool_use',
                        id: 'tool-plan-exit',
                        name: 'ExitPlanMode',
                        input: {},
                    },
                ],
            },
        } as any);

        expect(sendContextBoundary).toHaveBeenNthCalledWith(1, {
            kind: 'plan-mode-enter',
            triggeredBy: 'agent',
            at: expect.any(Number),
        });
        expect(sendContextBoundary).toHaveBeenNthCalledWith(2, {
            kind: 'plan-mode-exit',
            triggeredBy: 'agent',
            at: expect.any(Number),
        });
        await waitForCheck(() => {
            expect(mockAxiosPost).toHaveBeenCalled();
        });
    });

    it('normalizes custom-title records into one metadata update per rename event', () => {
        const client = new ApiSessionClient('fake-token', session);
        const updateMetadata = vi.spyOn(client, 'updateMetadata').mockImplementation(async (handler) => {
            (client as any).metadata = handler((client as any).metadata);
        });

        client.sendClaudeSessionMessage({
            type: 'custom-title',
            customTitle: 'Renamed From Claude',
            sessionId: session.id,
        } as any);

        expect(updateMetadata).toHaveBeenCalledTimes(1);
        expect((client as any).metadata.summary.text).toBe('Renamed From Claude');

        client.sendClaudeSessionMessage({
            type: 'custom-title',
            customTitle: 'Renamed From Claude',
            sessionId: session.id,
        } as any);
        client.sendClaudeSessionMessage({
            type: 'summary',
            summary: 'Renamed From Claude',
            leafUuid: 'mcp-echo-1',
        } as any);

        expect(updateMetadata).toHaveBeenCalledTimes(2);
    });

    it('native summary (no title prefix) always writes updateMetadata even when text equals current title', () => {
        const client = new ApiSessionClient('fake-token', session);
        const updateMetadata = vi.spyOn(client, 'updateMetadata').mockImplementation(async (handler) => {
            (client as any).metadata = handler((client as any).metadata);
        });

        (client as any).metadata = {
            ...(client as any).metadata,
            summary: { text: 'Existing Title', updatedAt: 1 }
        };

        client.sendClaudeSessionMessage({
            type: 'summary',
            summary: 'Existing Title',
            leafUuid: 'some-native-uuid',
        } as any);

        expect(updateMetadata).toHaveBeenCalledTimes(1);
    });

    it('normalizes ai-title records into one metadata update per rename event', () => {
        const client = new ApiSessionClient('fake-token', session);
        const updateMetadata = vi.spyOn(client, 'updateMetadata').mockImplementation(async (handler) => {
            (client as any).metadata = handler((client as any).metadata);
        });

        client.sendClaudeSessionMessage({
            type: 'ai-title',
            aiTitle: 'Suggested By Claude',
            sessionId: session.id,
        } as any);

        expect(updateMetadata).toHaveBeenCalledTimes(1);
        expect((client as any).metadata.summary.text).toBe('Suggested By Claude');

        client.sendClaudeSessionMessage({
            type: 'ai-title',
            aiTitle: 'Suggested By Claude',
            sessionId: session.id,
        } as any);

        expect(updateMetadata).toHaveBeenCalledTimes(1);
    });

    it('fetchMessages uses after_seq=0 initially and routes user messages to callback', async () => {
        const client = new ApiSessionClient('fake-token', session);
        const onUserMessage = vi.fn();
        client.onUserMessage(onUserMessage);

        const userMessage = {
            role: 'user',
            content: {
                type: 'text',
                text: 'from fetch'
            }
        };

        mockAxiosGet.mockResolvedValueOnce({
            data: {
                messages: [
                    {
                        id: 'msg-1',
                        seq: 1,
                        content: {
                            t: 'encrypted',
                            c: encryptContent(session, userMessage)
                        },
                        localId: null,
                        createdAt: 1000,
                        updatedAt: 1000
                    }
                ],
                hasMore: false
            }
        });

        await (client as any).fetchMessages();

        expect(mockAxiosGet).toHaveBeenCalledTimes(1);
        expect(mockAxiosGet.mock.calls[0][0]).toBe('https://server.test/v3/sessions/test-session-id/messages');
        expect(mockAxiosGet.mock.calls[0][1].params).toEqual({
            after_seq: 0,
            limit: 100
        });
        expect(onUserMessage).toHaveBeenCalledWith(userMessage);
        expect((client as any).lastSeq).toBe(1);
    });

    it('routes fetched user messages with image attachments to callback', async () => {
        const client = new ApiSessionClient('fake-token', session);
        const onUserMessage = vi.fn();
        client.onUserMessage(onUserMessage);

        const userMessage = {
            role: 'user',
            content: {
                type: 'text',
                text: 'from fetch with image',
                attachments: [
                    { type: 'image', ref: 'data:image/jpeg;base64,abc123', mimeType: 'image/jpeg' }
                ]
            }
        };

        mockAxiosGet.mockResolvedValueOnce({
            data: {
                messages: [
                    {
                        id: 'msg-1',
                        seq: 1,
                        content: {
                            t: 'encrypted',
                            c: encryptContent(session, userMessage)
                        },
                        localId: null,
                        createdAt: 1000,
                        updatedAt: 1000
                    }
                ],
                hasMore: false
            }
        });

        await (client as any).fetchMessages();

        expect(onUserMessage).toHaveBeenCalledWith(userMessage);
    });

    it('fetchMessages uses incremental cursor and paginates while hasMore is true', async () => {
        const client = new ApiSessionClient('fake-token', session);
        const onUserMessage = vi.fn();
        client.onUserMessage(onUserMessage);

        (client as any).lastSeq = 2;

        const message3 = {
            role: 'user',
            content: { type: 'text', text: 'm3' }
        };
        const message4 = {
            role: 'user',
            content: { type: 'text', text: 'm4' }
        };

        mockAxiosGet
            .mockResolvedValueOnce({
                data: {
                    messages: [
                        {
                            id: 'msg-3',
                            seq: 3,
                            content: { t: 'encrypted', c: encryptContent(session, message3) },
                            localId: null,
                            createdAt: 3000,
                            updatedAt: 3000
                        }
                    ],
                    hasMore: true
                }
            })
            .mockResolvedValueOnce({
                data: {
                    messages: [
                        {
                            id: 'msg-4',
                            seq: 4,
                            content: { t: 'encrypted', c: encryptContent(session, message4) },
                            localId: null,
                            createdAt: 4000,
                            updatedAt: 4000
                        }
                    ],
                    hasMore: false
                }
            });

        await (client as any).fetchMessages();

        expect(mockAxiosGet).toHaveBeenCalledTimes(2);
        expect(mockAxiosGet.mock.calls[0][1].params.after_seq).toBe(2);
        expect(mockAxiosGet.mock.calls[1][1].params.after_seq).toBe(3);
        expect(onUserMessage).toHaveBeenCalledTimes(2);
        expect((client as any).lastSeq).toBe(4);
    });

    it('fetchMessages stops pagination when hasMore is true but seq cursor does not advance', async () => {
        const client = new ApiSessionClient('fake-token', session);
        (client as any).lastSeq = 2;

        mockAxiosGet
            .mockResolvedValueOnce({
                data: {
                    messages: [],
                    hasMore: true
                }
            })
            .mockRejectedValueOnce(new Error('should not request another page when cursor is stalled'));

        await expect((client as any).fetchMessages()).resolves.toBeUndefined();

        expect(mockAxiosGet).toHaveBeenCalledTimes(1);
        expect(mockAxiosGet.mock.calls[0][1].params.after_seq).toBe(2);
        expect((client as any).lastSeq).toBe(2);
    });

    it('routes non-user fetched messages through EventEmitter message event', async () => {
        const client = new ApiSessionClient('fake-token', session);
        const onUserMessage = vi.fn();
        const onMessage = vi.fn();
        client.onUserMessage(onUserMessage);
        client.on('message', onMessage);

        const userMessage = {
            role: 'user',
            content: { type: 'text', text: 'user text' }
        };
        const agentMessage = {
            role: 'agent',
            content: {
                type: 'output',
                data: { answer: 'agent response' }
            }
        };

        mockAxiosGet.mockResolvedValueOnce({
            data: {
                messages: [
                    {
                        id: 'msg-1',
                        seq: 1,
                        content: { t: 'encrypted', c: encryptContent(session, userMessage) },
                        localId: null,
                        createdAt: 1000,
                        updatedAt: 1000
                    },
                    {
                        id: 'msg-2',
                        seq: 2,
                        content: { t: 'encrypted', c: encryptContent(session, agentMessage) },
                        localId: null,
                        createdAt: 2000,
                        updatedAt: 2000
                    }
                ],
                hasMore: false
            }
        });

        await (client as any).fetchMessages();

        expect(onUserMessage).toHaveBeenCalledTimes(1);
        expect(onUserMessage).toHaveBeenCalledWith(userMessage);
        expect(onMessage).toHaveBeenCalledTimes(1);
        expect(onMessage).toHaveBeenCalledWith(agentMessage);
    });

    it('applies consecutive new-message updates directly (fast path)', async () => {
        const client = new ApiSessionClient('fake-token', session);
        const onUserMessage = vi.fn();
        client.onUserMessage(onUserMessage);

        await waitForSocketInit(mockSocket);
        (client as any).lastSeq = 1;
        const userMessage = {
            role: 'user',
            content: { type: 'text', text: 'fast-path' }
        };

        emitSocketEvent('update', createNewMessageUpdate(2, plaintextContent(userMessage)));

        expect(onUserMessage).toHaveBeenCalledTimes(1);
        expect(onUserMessage).toHaveBeenCalledWith(userMessage);
        expect((client as any).lastSeq).toBe(2);
        expect(mockAxiosGet).not.toHaveBeenCalled();
    });

    it('correlates a socket-before-HTTP self-echo without skipping an interleaved phone row', async () => {
        const client = new ApiSessionClient('fake-token', session);
        const onUserMessage = vi.fn();
        const onMessage = vi.fn();
        client.onUserMessage(onUserMessage);
        client.on('message', onMessage);
        (client as any).lastSeq = 10;

        type PostResponse = {
            data: {
                messages: Array<{ id: string; seq: number; localId: string; createdAt: number; updatedAt: number }>;
            };
        };
        type GetResponse = {
            data: {
                messages: Array<{
                    id: string;
                    seq: number;
                    localId: string | null;
                    content: { t: 'encrypted'; c: string };
                    createdAt: number;
                    updatedAt: number;
                }>;
                hasMore: boolean;
            };
        };
        let resolvePost!: (value: PostResponse) => void;
        let resolveGet!: (value: GetResponse) => void;
        mockAxiosPost.mockImplementationOnce(() => new Promise<PostResponse>((resolve) => {
            resolvePost = resolve;
        }));
        mockAxiosGet.mockImplementationOnce(() => new Promise<GetResponse>((resolve) => {
            resolveGet = resolve;
        }));

        const deliveryPromise = client.sendSessionProtocolMessageWithDelivery({
            id: 'socket-first-envelope',
            time: 11,
            role: 'agent',
            ev: { t: 'text', text: 'local' },
        }, { localId: 'socket-first-local' });

        await waitForCheck(() => expect(mockAxiosPost).toHaveBeenCalledTimes(1));
        emitSocketEvent('update', createNewMessageUpdate(
            11,
            plaintextContent({ role: 'session', content: { role: 'agent' } }),
            'socket-first-local',
        ));

        await expect(deliveryPromise).resolves.toEqual({ id: 'msg-11', seq: 11 });
        expect((client as any).lastSeq).toBe(10);
        expect((client as any).outboundDeliverySeqs.get('socket-first-local')).toBe(11);
        await waitForCheck(() => expect(mockAxiosGet).toHaveBeenCalledTimes(1));

        const phoneMessage = {
            role: 'user',
            content: { type: 'text', text: 'phone row' }
        };
        resolveGet({
            data: {
                messages: [
                    {
                        id: 'msg-local',
                        seq: 11,
                        localId: 'socket-first-local',
                        content: { t: 'encrypted', c: plaintextContent({ role: 'session' }) },
                        createdAt: 11,
                        updatedAt: 11,
                    },
                    {
                        id: 'msg-phone',
                        seq: 12,
                        localId: null,
                        content: { t: 'encrypted', c: encryptContent(session, phoneMessage) },
                        createdAt: 12,
                        updatedAt: 12,
                    },
                ],
                hasMore: false,
            }
        });

        await waitForCheck(() => {
            expect(onUserMessage).toHaveBeenCalledWith(phoneMessage);
            expect((client as any).lastSeq).toBe(12);
        });
        expect(onUserMessage).toHaveBeenCalledTimes(1);
        expect(onMessage).not.toHaveBeenCalled();
        expect((client as any).outboundDeliverySeqs.size).toBe(0);

        resolvePost({
            data: {
                messages: [{
                    id: 'msg-local',
                    seq: 11,
                    localId: 'socket-first-local',
                    createdAt: 11,
                    updatedAt: 11,
                }]
            }
        });
        await waitForCheck(() => expect((client as any).pendingOutbox).toHaveLength(0));
        expect((client as any).outboundDeliverySeqs.size).toBe(0);
    });

    it('keeps ACK-before-socket tracking until the self-echo is scanned', async () => {
        const client = new ApiSessionClient('fake-token', session);
        const onUserMessage = vi.fn();
        const onMessage = vi.fn();
        client.onUserMessage(onUserMessage);
        client.on('message', onMessage);
        (client as any).lastSeq = 20;
        mockAxiosPost.mockImplementationOnce(async (_url: string, body: { messages: Array<{ localId: string }> }) => ({
            data: {
                messages: [{
                    id: 'msg-21',
                    seq: 21,
                    localId: body.messages[0].localId,
                    createdAt: 21,
                    updatedAt: 21,
                }]
            }
        }));

        await expect(client.sendSessionProtocolMessageWithDelivery({
            id: 'ack-first-envelope',
            time: 21,
            role: 'agent',
            ev: { t: 'text', text: 'ack first' },
        }, { localId: 'ack-first-local' })).resolves.toEqual({ id: 'msg-21', seq: 21 });
        expect((client as any).lastSeq).toBe(20);
        expect((client as any).outboundDeliverySeqs.get('ack-first-local')).toBe(21);

        const phoneMessage = {
            role: 'user',
            content: { type: 'text', text: 'after ack' }
        };
        mockAxiosGet.mockResolvedValueOnce({
            data: {
                messages: [
                    {
                        id: 'msg-21',
                        seq: 21,
                        localId: 'ack-first-local',
                        content: { t: 'encrypted', c: plaintextContent({ role: 'session' }) },
                        createdAt: 21,
                        updatedAt: 21,
                    },
                    {
                        id: 'msg-22',
                        seq: 22,
                        localId: null,
                        content: { t: 'encrypted', c: encryptContent(session, phoneMessage) },
                        createdAt: 22,
                        updatedAt: 22,
                    },
                ],
                hasMore: false,
            }
        });

        emitSocketEvent('update', createNewMessageUpdate(
            21,
            plaintextContent({ role: 'session', content: { role: 'agent' } }),
            'ack-first-local',
        ));

        await waitForCheck(() => {
            expect(onUserMessage).toHaveBeenCalledWith(phoneMessage);
            expect((client as any).lastSeq).toBe(22);
        });
        expect(onUserMessage).toHaveBeenCalledTimes(1);
        expect(onMessage).not.toHaveBeenCalled();
        expect((client as any).outboundDeliverySeqs.size).toBe(0);
    });

    it('invalidates receive sync and fetches on seq gap', async () => {
        const client = new ApiSessionClient('fake-token', session);
        await waitForSocketInit(mockSocket);
        (client as any).lastSeq = 1;

        mockAxiosGet.mockResolvedValueOnce({
            data: {
                messages: [],
                hasMore: false
            }
        });

        emitSocketEvent('update', createNewMessageUpdate(3, plaintextContent({
            role: 'user',
            content: { type: 'text', text: 'gap' }
        })));

        await waitForCheck(() => {
            expect(mockAxiosGet).toHaveBeenCalledTimes(1);
        });
        expect(mockAxiosGet.mock.calls[0][1].params.after_seq).toBe(1);
    });

    it('invalidates receive sync on first message when lastSeq is 0', async () => {
        const client = new ApiSessionClient('fake-token', session);
        await waitForSocketInit(mockSocket);

        mockAxiosGet.mockResolvedValueOnce({
            data: {
                messages: [],
                hasMore: false
            }
        });

        emitSocketEvent('update', createNewMessageUpdate(1, plaintextContent({
            role: 'user',
            content: { type: 'text', text: 'first' }
        })));

        await waitForCheck(() => {
            expect(mockAxiosGet).toHaveBeenCalledTimes(1);
        });
        expect(mockAxiosGet.mock.calls[0][1].params.after_seq).toBe(0);
    });

    it('invalidates receive sync for duplicate and stale seq values', async () => {
        const client = new ApiSessionClient('fake-token', session);
        await waitForSocketInit(mockSocket);
        (client as any).lastSeq = 5;

        mockAxiosGet.mockResolvedValue({
            data: {
                messages: [],
                hasMore: false
            }
        });

        emitSocketEvent('update', createNewMessageUpdate(5, plaintextContent({
            role: 'user',
            content: { type: 'text', text: 'duplicate' }
        })));
        emitSocketEvent('update', createNewMessageUpdate(4, plaintextContent({
            role: 'user',
            content: { type: 'text', text: 'stale' }
        })));

        await waitForCheck(() => {
            expect(mockAxiosGet).toHaveBeenCalledTimes(2);
        });
        expect(mockAxiosGet.mock.calls[0][1].params.after_seq).toBe(5);
        expect(mockAxiosGet.mock.calls[1][1].params.after_seq).toBe(5);
    });

    it('never advances the inbound watermark from outbound acknowledgements', async () => {
        const client = new ApiSessionClient('fake-token', session);
        (client as any).lastSeq = 10;

        mockAxiosPost.mockImplementation(async (_url: string, body: { messages: Array<{ localId: string }> }) => ({
            data: {
                messages: body.messages.map((message) => ({
                    id: 'msg-100',
                    seq: 100,
                    localId: message.localId,
                    createdAt: 100,
                    updatedAt: 100,
                }))
            }
        }));

        client.sendCodexMessage({ type: 'outbound' });
        await waitForCheck(() => {
            expect(mockAxiosPost).toHaveBeenCalledTimes(1);
            expect((client as any).pendingOutbox).toHaveLength(0);
        });
        expect((client as any).lastSeq).toBe(10);
    });

    it('retries a batch when the response omits acknowledgements without dropping rows', async () => {
        const client = new ApiSessionClient('fake-token', session);
        (client as any).lastSeq = 7;

        mockAxiosPost
            .mockResolvedValueOnce({ data: {} })
            .mockImplementationOnce(async (_url: string, body: { messages: Array<{ localId: string }> }) => ({
                data: {
                    messages: body.messages.map((message) => ({
                        id: 'msg-8',
                        seq: 8,
                        localId: message.localId,
                        createdAt: 8,
                        updatedAt: 8,
                    }))
                }
            }));

        client.sendCodexMessage({ type: 'no-messages-field' });
        await waitForCheck(() => {
            expect(mockAxiosPost).toHaveBeenCalledTimes(2);
            expect((client as any).pendingOutbox).toHaveLength(0);
        });

        expect(mockAxiosPost.mock.calls[1][1]).toEqual(mockAxiosPost.mock.calls[0][1]);
        expect((client as any).lastSeq).toBe(7);
    });

    it('triggers receive catch-up fetch on socket reconnect', async () => {
        new ApiSessionClient('fake-token', session);
        await waitForSocketInit(mockSocket);

        mockAxiosGet.mockResolvedValueOnce({
            data: {
                messages: [],
                hasMore: false
            }
        });

        emitSocketEvent('connect');

        await waitForCheck(() => {
            expect(mockAxiosGet).toHaveBeenCalledTimes(1);
        });
        expect(mockAxiosGet.mock.calls[0][1].params.after_seq).toBe(0);
    });

    it('clears delivered and pending outbound tracking on close', async () => {
        const client = new ApiSessionClient('fake-token', session);
        mockSocket.close.mockImplementation(() => {
            emitSocketEvent('disconnect', 'io client disconnect');
        });
        mockNextPostAck(40, 'close-delivered-message');

        await expect(client.sendSessionProtocolMessageWithDelivery({
            id: 'close-delivered-envelope',
            time: 40,
            role: 'agent',
            ev: { t: 'text', text: 'delivered before close' },
        }, { localId: 'close-delivered-local' })).resolves.toEqual({
            id: 'close-delivered-message',
            seq: 40,
        });
        (client as any).enqueueMessageWithDelivery(
            { role: 'agent', content: 'pending at close' },
            false,
            'close-pending-local',
        );

        expect((client as any).outboundDeliverySeqs).toEqual(new Map([
            ['close-delivered-local', 40],
            ['close-pending-local', null],
        ]));
        expect((client as any).seqResolvers.size).toBe(1);

        await client.close();

        expect((client as any).outboundDeliverySeqs.size).toBe(0);
        expect((client as any).outboundDeliveryHeap).toHaveLength(0);
        expect((client as any).seqResolvers.size).toBe(0);
        expect((client as any).pendingOutbox).toHaveLength(0);
        expect((client as any).pendingOutboxHead).toBe(0);
        expect((client as any).reconnectInterval).toBeNull();
    });

    it('ignores GET and POST completions that arrive after close', async () => {
        const client = new ApiSessionClient('fake-token', session);
        const onUserMessage = vi.fn();
        client.onUserMessage(onUserMessage);
        (client as any).lastSeq = 1;

        type PostResponse = {
            data: {
                messages: Array<{ id: string; seq: number; localId: string; createdAt: number; updatedAt: number }>;
            };
        };
        type GetResponse = {
            data: {
                messages: Array<{
                    id: string;
                    seq: number;
                    localId: null;
                    content: { t: 'encrypted'; c: string };
                    createdAt: number;
                    updatedAt: number;
                }>;
                hasMore: boolean;
            };
        };
        let resolvePost!: (value: PostResponse) => void;
        let resolveGet!: (value: GetResponse) => void;
        mockAxiosPost.mockImplementationOnce(() => new Promise<PostResponse>((resolve) => {
            resolvePost = resolve;
        }));
        mockAxiosGet.mockImplementationOnce(() => new Promise<GetResponse>((resolve) => {
            resolveGet = resolve;
        }));

        const deliveryPromise = client.sendSessionProtocolMessageWithDelivery({
            id: 'late-post-envelope',
            time: 2,
            role: 'agent',
            ev: { t: 'text', text: 'late post' },
        }, { localId: 'late-post-local' });
        const fetchPromise = (client as any).fetchMessages();
        await waitForCheck(() => {
            expect(mockAxiosPost).toHaveBeenCalledTimes(1);
            expect(mockAxiosGet).toHaveBeenCalledTimes(1);
        });

        await client.close();
        await expect(deliveryPromise).rejects.toThrow('Session closed before seq was assigned');
        resolvePost({
            data: {
                messages: [{
                    id: 'late-post-message',
                    seq: 2,
                    localId: 'late-post-local',
                    createdAt: 2,
                    updatedAt: 2,
                }],
            },
        });
        resolveGet({
            data: {
                messages: [{
                    id: 'late-phone-message',
                    seq: 2,
                    localId: null,
                    content: { t: 'encrypted', c: encryptContent(session, {
                        role: 'user',
                        content: { type: 'text', text: 'late phone row' },
                    }) },
                    createdAt: 2,
                    updatedAt: 2,
                }],
                hasMore: false,
            },
        });
        await fetchPromise;
        await new Promise((resolve) => setTimeout(resolve, 20));

        expect(onUserMessage).not.toHaveBeenCalled();
        expect((client as any).lastSeq).toBe(1);
        expect((client as any).pendingOutbox).toHaveLength(0);
        expect((client as any).pendingOutboxHead).toBe(0);
        expect((client as any).seqResolvers.size).toBe(0);
        expect((client as any).outboundDeliverySeqs.size).toBe(0);
        expect((client as any).outboundDeliveryHeap).toHaveLength(0);
    });

    it('stops send and receive sync loops on close', async () => {
        const client = new ApiSessionClient('fake-token', session);
        await waitForSocketInit(mockSocket);
        await client.close();

        mockAxiosGet.mockResolvedValue({
            data: {
                messages: [],
                hasMore: false
            }
        });
        mockAxiosPost.mockResolvedValue({
            data: {
                messages: []
            }
        });

        emitSocketEvent('update', createNewMessageUpdate(1, plaintextContent({
            role: 'user',
            content: { type: 'text', text: 'after-close' }
        })));
        client.sendCodexMessage({ type: 'after-close-send' });
        await expect(client.sendSessionProtocolMessageWithDelivery({
            id: 'after-close-envelope',
            time: 1,
            role: 'agent',
            ev: { t: 'text', text: 'after close' },
        }, { localId: 'after-close-local' })).rejects.toThrow('Session is closed');

        await new Promise((resolve) => setTimeout(resolve, 20));

        expect(mockSocket.close).toHaveBeenCalledTimes(1);
        expect(mockAxiosGet).not.toHaveBeenCalled();
        expect(mockAxiosPost).not.toHaveBeenCalled();
        expect((client as any).pendingOutbox).toHaveLength(0);
        expect((client as any).seqResolvers.size).toBe(0);
        expect((client as any).outboundDeliverySeqs.size).toBe(0);
        expect((client as any).outboundDeliveryHeap).toHaveLength(0);
    });

    it('sendContextBoundary returns within timeout when flushOutbox never resolves the seq', async () => {
        vi.useFakeTimers();
        const client = new ApiSessionClient('fake-token', session);

        // POST never resolves — simulates a stalled network
        mockAxiosPost.mockImplementation(() => new Promise(() => undefined));
        mockSocket.emitWithAck.mockResolvedValue({ result: 'error' });

        const boundaryPromise = client.sendContextBoundary({
            kind: 'clear',
            triggeredBy: 'user',
            at: Date.now(),
        });

        // Advance past the 5-second seq-resolution timeout
        await vi.advanceTimersByTimeAsync(6000);

        await expect(boundaryPromise).resolves.toBeUndefined();

        // metadata write must NOT have been attempted (seq was never resolved)
        expect(mockSocket.emitWithAck).not.toHaveBeenCalledWith('update-metadata', expect.anything());

        vi.useRealTimers();
    });

    it('keeps unacknowledged rows queued and retries only the partial remainder', async () => {
        const client = new ApiSessionClient('fake-token', session);

        mockAxiosPost
            .mockImplementationOnce(async (_url: string, body: { messages: Array<{ localId: string }> }) => ({
                data: {
                    messages: [{
                        id: 'msg-b',
                        seq: 1,
                        localId: body.messages[1].localId,
                        createdAt: 1,
                        updatedAt: 1,
                    }]
                }
            }))
            .mockImplementationOnce(async (_url: string, body: { messages: Array<{ localId: string }> }) => ({
                data: {
                    messages: body.messages.map((message) => ({
                        id: 'msg-b',
                        seq: 2,
                        localId: message.localId,
                        createdAt: 2,
                        updatedAt: 2,
                    }))
                }
            }));

        const seqPromiseA = (client as any).enqueueMessage({ role: 'agent', content: 'a' }, false);
        const seqPromiseB = (client as any).enqueueMessage({ role: 'agent', content: 'b' }, false);
        const seqPromiseC = (client as any).enqueueMessage({ role: 'agent', content: 'c' }, false);
        (client as any).sendSync.invalidate();

        await expect(seqPromiseA).resolves.toBe(2);
        await expect(seqPromiseB).resolves.toBe(1);
        await expect(seqPromiseC).resolves.toBe(2);
        await waitForCheck(() => {
            expect(mockAxiosPost).toHaveBeenCalledTimes(2);
            expect((client as any).pendingOutbox).toHaveLength(0);
        });

        const firstBatch = mockAxiosPost.mock.calls[0][1].messages;
        const retryBatch = mockAxiosPost.mock.calls[1][1].messages;
        expect(firstBatch).toHaveLength(3);
        expect(retryBatch).toEqual([
            {
                content: firstBatch[0].content,
                localId: firstBatch[0].localId,
            },
            {
                content: firstBatch[2].content,
                localId: firstBatch[2].localId,
            },
        ]);
    });

    it('resolves enqueueMessageWithConsumptionAck after message-consumption round-trip', async () => {
        const client = new ApiSessionClient('fake-token', session);

        mockAxiosPost.mockImplementationOnce(async (_url: string, body: { messages: Array<{ localId: string }> }) => ({
            data: {
                messages: [
                    {
                        id: 'user-message-1',
                        seq: 1,
                        localId: body.messages[0].localId,
                        createdAt: 1,
                        updatedAt: 1,
                    }
                ]
            }
        }));

        const { seqPromise, consumedPromise } = client.enqueueMessageWithConsumptionAck({
            role: 'user',
            content: { type: 'text', text: 'hello' },
        });

        await expect(seqPromise).resolves.toBe(1);

        (client as any).lastSeq = 1;
        emitSocketEvent('update', createNewMessageUpdate(2, plaintextContent({
            role: 'session',
            content: {
                id: 'consumption-1',
                time: 10,
                role: 'agent',
                ev: {
                    t: 'message-consumption',
                    messageId: 'user-message-1',
                    consumedAt: 10,
                    agentFlavor: 'claude',
                }
            }
        })));

        await expect(consumedPromise).resolves.toMatchObject({
            t: 'message-consumption',
            messageId: 'user-message-1',
            consumedAt: 10,
            agentFlavor: 'claude',
        });
    });

    it('rejects consumedPromise with session-closed error when close() is called while queued', async () => {
        const client = new ApiSessionClient('fake-token', session);

        mockAxiosPost.mockImplementationOnce(async (_url: string, body: { messages: Array<{ localId: string }> }) => ({
            data: {
                messages: [
                    {
                        id: 'user-message-close',
                        seq: 1,
                        localId: body.messages[0].localId,
                        createdAt: 1,
                        updatedAt: 1,
                    }
                ]
            }
        }));

        const { seqPromise, consumedPromise } = client.enqueueMessageWithConsumptionAck({
            role: 'user',
            content: { type: 'text', text: 'disconnect-me' },
        });

        await expect(seqPromise).resolves.toBe(1);

        await client.close();

        await expect(consumedPromise).rejects.toThrow('Session closed before message consumption was observed');
    });

    it('rejects consumedPromise with MessageConsumptionTimeoutError after CONSUMPTION_ACK_TIMEOUT_MS', async () => {
        vi.useFakeTimers();
        const client = new ApiSessionClient('fake-token', session);

        mockAxiosPost.mockImplementationOnce(async (_url: string, body: { messages: Array<{ localId: string }> }) => ({
            data: {
                messages: [
                    {
                        id: 'user-message-timeout',
                        seq: 1,
                        localId: body.messages[0].localId,
                        createdAt: 1,
                        updatedAt: 1,
                    }
                ]
            }
        }));

        const { seqPromise, consumedPromise } = client.enqueueMessageWithConsumptionAck({
            role: 'user',
            content: { type: 'text', text: 'timeout-me' },
        });

        await vi.runAllTimersAsync();

        await expect(seqPromise).resolves.toBe(1);
        await expect(consumedPromise).rejects.toBeInstanceOf(MessageConsumptionTimeoutError);
        await expect(consumedPromise).rejects.toMatchObject({ messageId: 'user-message-timeout' });

        vi.useRealTimers();
    });

    it('rejects consumedPromise immediately when AbortSignal fires', async () => {
        const client = new ApiSessionClient('fake-token', session);

        mockAxiosPost.mockImplementationOnce(async (_url: string, body: { messages: Array<{ localId: string }> }) => ({
            data: {
                messages: [
                    {
                        id: 'user-message-abort',
                        seq: 1,
                        localId: body.messages[0].localId,
                        createdAt: 1,
                        updatedAt: 1,
                    }
                ]
            }
        }));

        const controller = new AbortController();
        const { seqPromise, consumedPromise } = client.enqueueMessageWithConsumptionAck(
            { role: 'user', content: { type: 'text', text: 'abort-me' } },
            controller.signal
        );

        await expect(seqPromise).resolves.toBe(1);

        controller.abort(new Error('session killed'));
        await expect(consumedPromise).rejects.toThrow('session killed');

        expect((client as any).consumptionResolvers.size).toBe(0);
    });

    it('caps observedConsumptions at 256 entries and evicts the oldest on overflow', () => {
        const client = new ApiSessionClient('fake-token', session);
        const observed: Map<string, unknown> = (client as any).observedConsumptions;

        for (let i = 0; i < 256; i += 1) {
            (client as any).resolveConsumptionAck({
                t: 'message-consumption',
                messageId: `obs-${i}`,
                consumedAt: i,
                agentFlavor: 'claude',
            });
        }
        expect(observed.size).toBe(256);
        expect(observed.has('obs-0')).toBe(true);
        expect(observed.has('obs-255')).toBe(true);

        (client as any).resolveConsumptionAck({
            t: 'message-consumption',
            messageId: 'obs-256',
            consumedAt: 256,
            agentFlavor: 'claude',
        });
        expect(observed.size).toBe(256);
        expect(observed.has('obs-0')).toBe(false);
        expect(observed.has('obs-1')).toBe(true);
        expect(observed.has('obs-256')).toBe(true);

        (client as any).resolveConsumptionAck({
            t: 'message-consumption',
            messageId: 'obs-257',
            consumedAt: 257,
            agentFlavor: 'claude',
        });
        expect(observed.size).toBe(256);
        expect(observed.has('obs-1')).toBe(false);
        expect(observed.has('obs-2')).toBe(true);
        expect(observed.has('obs-257')).toBe(true);
    });

    it('resolves batched consumption acks one envelope per original message seq', async () => {
        const client = new ApiSessionClient('fake-token', session);

        let nextSeq = 0;
        mockAxiosPost.mockImplementation(async (_url: string, body: { messages: Array<{ localId: string }> }) => ({
            data: {
                messages: body.messages.map((message) => {
                    nextSeq += 1;
                    return {
                        id: `user-message-${nextSeq}`,
                        seq: nextSeq,
                        localId: message.localId,
                        createdAt: nextSeq,
                        updatedAt: nextSeq,
                    };
                })
            }
        }));

        const first = client.enqueueMessageWithConsumptionAck({ role: 'user', content: { type: 'text', text: 'one' } });
        const second = client.enqueueMessageWithConsumptionAck({ role: 'user', content: { type: 'text', text: 'two' } });

        await expect(first.seqPromise).resolves.toEqual(expect.any(Number));
        await expect(second.seqPromise).resolves.toEqual(expect.any(Number));

        client.sendMessageConsumption({ messageId: 'user-message-1', agentFlavor: 'claude' });
        client.sendMessageConsumption({ messageId: 'user-message-2', agentFlavor: 'claude' });
        await (client as any).flushOutbox();

        const receipts = mockAxiosPost.mock.calls.slice(1).flatMap((call, callOffset) => {
            const payload = call[1];
            return payload.messages.map((_message: unknown, index: number) => parsePostedMessage(index, callOffset + 1));
        }).filter((message) => message.role === 'session' && message.content?.ev?.t === 'message-consumption');

        const uniqueReceiptIds = [...new Set(receipts.map((receipt) => receipt.content.ev.messageId))];
        expect(uniqueReceiptIds).toEqual([
            'user-message-1',
            'user-message-2',
        ]);
        expect(receipts.every((receipt) => receipt.content.ev.agentFlavor === 'claude')).toBe(true);

        for (const receipt of receipts) {
            (client as any).routeIncomingMessage(receipt);
        }

        await expect(first.consumedPromise).resolves.toMatchObject({ messageId: 'user-message-1' });
        await expect(second.consumedPromise).resolves.toMatchObject({ messageId: 'user-message-2' });
    });
});
