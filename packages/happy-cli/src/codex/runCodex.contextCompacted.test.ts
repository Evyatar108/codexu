import { beforeEach, describe, expect, it, vi } from 'vitest';

// Covers Gap 4 (codex hooks parity) for the auto-compact context-boundary
// emission path: when codex emits a `context_compacted` event (translated
// from either the legacy `codex/event` notification or the v2 `thread/compacted`
// notification by codexAppServerClient), runCodex's event handler must call
// `session.sendContextBoundary({ kind: 'autocompact', ... })` — parity with
// the Claude PostCompact trigger=auto hook in runClaude.ts.

const mocks = vi.hoisted(() => {
    let eventHandler: ((message: any) => void) | null = null;

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

    class MockMessageQueue2 {
        async waitForMessagesAndGetAsString() {
            return null;
        }
        size() {
            return 0;
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
        abortTurnWithFallback = vi.fn(async () => ({ forcedRestart: false, resumedThread: true }));
    }

    return {
        mockSession,
        MockMessageQueue2,
        MockCodexAppServerClient,
        getEventHandler: () => eventHandler,
        resetHandlers: () => {
            eventHandler = null;
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
        mockReadSettings: vi.fn(async () => ({ machineId: 'machine-1', sandboxConfig: undefined })),
        mockNotifyDaemonSessionStarted: vi.fn(async () => ({ error: null })),
        mockStartHappyServer: vi.fn(async () => ({ url: 'http://127.0.0.1:3000/mcp', stop: vi.fn() })),
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

describe('runCodex auto-compact context boundary parity', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.resetHandlers();
        mocks.mockApiCreate.mockResolvedValue(createApi());
        mocks.mockReadSettings.mockResolvedValue({ machineId: 'machine-1', sandboxConfig: undefined });
    });

    it('emits an autocompact context-boundary when codex fires a context_compacted event', async () => {
        await runCodex({ credentials: { token: 'token' } as any });

        const eventHandler = mocks.getEventHandler();
        expect(eventHandler).toBeDefined();

        const before = Date.now();
        eventHandler!({
            type: 'context_compacted',
            thread_id: 'thread-1',
            threadId: 'thread-1',
            turn_id: 'turn-9',
            turnId: 'turn-9',
        });
        const after = Date.now();

        // Allow the fire-and-forget microtask to settle.
        await Promise.resolve();

        expect(mocks.mockSession.sendContextBoundary).toHaveBeenCalledTimes(1);
        const call = (mocks.mockSession.sendContextBoundary as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as { kind: string; triggeredBy: string; at: number } | undefined;
        expect(call).toEqual({
            kind: 'autocompact',
            triggeredBy: 'system',
            at: expect.any(Number),
        });
        expect(call!.at).toBeGreaterThanOrEqual(before);
        expect(call!.at).toBeLessThanOrEqual(after);
    });

    it('does not emit a context-boundary for unrelated codex events', async () => {
        await runCodex({ credentials: { token: 'token' } as any });

        const eventHandler = mocks.getEventHandler();
        eventHandler!({ type: 'task_started', turn_id: 'turn-1' });
        eventHandler!({ type: 'agent_message', message: 'hi' });
        eventHandler!({ type: 'task_complete', turn_id: 'turn-1' });

        await Promise.resolve();

        expect(mocks.mockSession.sendContextBoundary).not.toHaveBeenCalled();
    });
});
