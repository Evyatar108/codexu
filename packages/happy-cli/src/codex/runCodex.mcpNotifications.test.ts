/**
 * Story 3 integration test for codex MCP-notification consumer wiring.
 *
 * Acceptance criterion AC3.1: with `enabled: true` and default routing, a
 * synthetic `mcp_server_notification` event delivered through the codex
 * event channel causes `MessageQueue2.push` to be observed.
 *
 * Uses the same mock harness pattern as runCodex.contextCompacted.test.ts
 * (per-utility regression test; not the layer-1 primary integration test).
 *
 * Plan: .ralph/jobs/codex-channels-option-b/plan.md §5 (Story 3).
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
    let eventHandler: ((message: any) => void) | null = null;
    const pushedMessages: Array<{ message: string; mode: unknown }> = [];

    const mockSession = {
        on: vi.fn(),
        onUserMessage: vi.fn(),
        onAgentConfiguration: vi.fn(),
        keepAlive: vi.fn(),
        updateMetadata: vi.fn(async () => {}),
        updateAgentState: vi.fn(),
        sendSessionEvent: vi.fn(),
        sendSessionProtocolMessage: vi.fn(),
        sendContextBoundary: vi.fn(async () => {}),
        sendMessageConsumption: vi.fn(),
        sendAgentTreeUpdate: vi.fn(),
        sendPushEvent: vi.fn(),
        sendSessionDeath: vi.fn(),
        flush: vi.fn(async () => {}),
        close: vi.fn(async () => {}),
        getMetadata: vi.fn(() => ({})),
        rpcHandlerManager: {
            registerHandler: vi.fn(),
            unregisterHandler: vi.fn(),
        },
        sessionId: 'session-1',
    };

    class MockMessageQueue2<TMode> {
        public queue: Array<{ message: string; mode: TMode }> = [];
        async waitForMessagesAndGetAsString() {
            return null;
        }
        size() {
            return this.queue.length;
        }
        push(message: string, mode: TMode) {
            this.queue.push({ message, mode });
            pushedMessages.push({ message, mode });
        }
        pushIsolateAndClear(message: string, mode: TMode) {
            this.queue.push({ message, mode });
        }
    }

    class MockCodexAppServerClient {
        sandboxEnabled = false;
        connect = vi.fn(async () => {});
        disconnect = vi.fn(async () => {});
        setApprovalHandler = vi.fn();
        setEventHandler = vi.fn((handler: (message: any) => void) => {
            eventHandler = handler;
        });
        hasActiveThread = vi.fn(() => true);
        startThread = vi.fn(async () => ({ threadId: 'thread-1' }));
        sendTurnAndWait = vi.fn(async () => ({ aborted: false }));
        abortTurnWithFallback = vi.fn(async () => ({
            forcedRestart: false,
            resumedThread: true,
        }));
    }

    return {
        mockSession,
        MockMessageQueue2,
        MockCodexAppServerClient,
        pushedMessages,
        getEventHandler: () => eventHandler,
        resetHandlers: () => {
            eventHandler = null;
            pushedMessages.length = 0;
        },
        mockExecSync: vi.fn(() => 'codex-cli 0.120.0'),
        mockApiCreate: vi.fn(),
        mockGetOrCreateSession: vi.fn(async ({ metadata }: { metadata: any }) => ({
            id: 'session-1',
            seq: 0,
            encryptionKey: new Uint8Array(32),
            encryptionVariant: 'legacy',
            metadata,
            metadataVersion: 0,
            agentState: null,
            agentStateVersion: 0,
        })),
        mockReadSettings: vi.fn(async (): Promise<{
            machineId: string;
            sandboxConfig: undefined;
            mcpNotificationRouting?: unknown;
        }> => ({
            machineId: 'machine-1',
            sandboxConfig: undefined,
            mcpNotificationRouting: { enabled: true },
        })),
        mockNotifyDaemonSessionStarted: vi.fn(async () => ({ error: null })),
        mockStartHappyServer: vi.fn(async () => ({
            url: 'http://127.0.0.1:3000/mcp',
            stop: vi.fn(),
        })),
        mockRegisterKillSessionHandler: vi.fn(),
        mockSetBackend: vi.fn(),
        mockProjectPath: vi.fn(() => '/tmp/happy'),
        mockLoggerDebug: vi.fn(),
        mockLoggerWarn: vi.fn(),
    };
});

vi.mock('node:child_process', async (importOriginal) => ({
    ...await importOriginal<typeof import('node:child_process')>(),
    execSync: mocks.mockExecSync,
}));

vi.mock('@/api/api', () => ({
    ApiClient: {
        create: mocks.mockApiCreate,
    },
}));

vi.mock('@/persistence', async () => {
    const actual = await vi.importActual<typeof import('@/persistence')>('@/persistence');
    return {
        ...actual,
        readSettings: mocks.mockReadSettings,
    };
});

vi.mock('@/daemon/controlClient', () => ({
    notifyDaemonSessionStarted: mocks.mockNotifyDaemonSessionStarted,
}));

vi.mock('@/daemon/run', () => ({
    initialMachineMetadata: { host: 'host', platform: 'test', happyCliVersion: 'test' },
}));

vi.mock('@/claude/utils/startHappyServer', () => ({
    startHappyServer: mocks.mockStartHappyServer,
}));

vi.mock('@/claude/registerKillSessionHandler', () => ({
    registerKillSessionHandler: mocks.mockRegisterKillSessionHandler,
}));

vi.mock('@/projectPath', () => ({
    projectPath: mocks.mockProjectPath,
}));

vi.mock('@/utils/serverConnectionErrors', () => ({
    connectionState: {
        setBackend: mocks.mockSetBackend,
    },
    startOfflineReconnection: vi.fn(),
}));

vi.mock('@/utils/MessageQueue2', () => ({
    MessageQueue2: mocks.MockMessageQueue2,
}));

vi.mock('./codexAppServerClient', () => ({
    CodexAppServerClient: mocks.MockCodexAppServerClient,
}));

vi.mock('@/ui/logger', () => ({
    logger: {
        debug: mocks.mockLoggerDebug,
        warn: mocks.mockLoggerWarn,
        getLogPath: vi.fn(() => '/tmp/happy.log'),
    },
}));

const { runCodex } = await import('./runCodex');

function createApi() {
    return {
        getOrCreateSession: mocks.mockGetOrCreateSession,
        sessionSyncClient: vi.fn(() => mocks.mockSession),
    };
}

describe('runCodex MCP notification wiring (Option B)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.resetHandlers();
        mocks.mockApiCreate.mockResolvedValue(createApi());
        mocks.mockReadSettings.mockResolvedValue({
            machineId: 'machine-1',
            sandboxConfig: undefined,
            mcpNotificationRouting: { enabled: true },
        });
    });

    // AC3.1
    it('synthetic tool_list_changed event with enabled routing pushes a synthesized prompt onto the queue', async () => {
        await runCodex({ credentials: { token: 'token' } as any });

        const eventHandler = mocks.getEventHandler();
        expect(eventHandler).toBeDefined();

        eventHandler!({
            type: 'mcp_server_notification',
            server_name: 'tools-srv',
            kind: 'tool_list_changed',
            params: {},
        });

        // Push is synchronous; no microtask flush needed.
        expect(mocks.pushedMessages).toHaveLength(1);
        expect(mocks.pushedMessages[0].message).toBe(
            '[mcp:tools-srv] tool list changed; re-check available tools',
        );
        const mode = mocks.pushedMessages[0].mode as { permissionMode: string };
        expect(mode.permissionMode).toBe('default');
    });

    it('mcp_sampling_request is logged and does not push (out of scope per plan §4)', async () => {
        await runCodex({ credentials: { token: 'token' } as any });

        const eventHandler = mocks.getEventHandler();
        eventHandler!({
            type: 'mcp_sampling_request',
            server_name: 'sampling-srv',
            request_id: 1,
            params: {},
        });

        expect(mocks.pushedMessages).toHaveLength(0);
        const warnCalls = mocks.mockLoggerWarn.mock.calls.map((c) => String(c[0]));
        expect(warnCalls.some((m) => m.includes('mcp_sampling_request'))).toBe(true);
    });

    it('with mcpNotificationRouting omitted from settings the consumer is a no-op (default disabled)', async () => {
        mocks.mockReadSettings.mockResolvedValue({
            machineId: 'machine-1',
            sandboxConfig: undefined,
        });
        await runCodex({ credentials: { token: 'token' } as any });

        const eventHandler = mocks.getEventHandler();
        eventHandler!({
            type: 'mcp_server_notification',
            server_name: 'tools-srv',
            kind: 'tool_list_changed',
            params: {},
        });

        expect(mocks.pushedMessages).toHaveLength(0);
    });

    it('unrelated events flow through the consumer without pushing', async () => {
        await runCodex({ credentials: { token: 'token' } as any });

        const eventHandler = mocks.getEventHandler();
        eventHandler!({ type: 'task_started', turn_id: 'turn-1' });
        eventHandler!({ type: 'agent_message', message: 'hi' });
        eventHandler!({ type: 'task_complete', turn_id: 'turn-1' });

        expect(mocks.pushedMessages).toHaveLength(0);
    });
});
