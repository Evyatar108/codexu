import { beforeEach, describe, expect, it, vi } from 'vitest';

// Covers Gap 5 (codex slash-command parity) from
// plans/codex-agent-parity-audit.md. The runCodex message loop must intercept
// `/clear` and `/compact` user messages before dispatching to codex, drive the
// equivalent codex JSON-RPCs (clearActiveThread / compactThread), and emit the
// typed context-boundary envelopes that the app uses to render the divider —
// parity with the Claude path in runClaude.ts:543-580. The context_compacted
// event handler must also distinguish user-triggered compaction (kind=compact,
// triggeredBy=user) from auto compaction (kind=autocompact, triggeredBy=system)
// using the `userTriggeredCompactInFlight` flag.

const mocks = vi.hoisted(() => {
    let eventHandler: ((message: any) => void) | null = null;
    const queueBatches: Array<{ message: string; consumedMessages: any[]; mode: any } | null> = [];

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
            return queueBatches.shift() ?? null;
        }
        size() {
            return queueBatches.length;
        }
    }

    // Module-level shared state so each test can configure the next runCodex
    // call by mutating these BEFORE invoking runCodex (which constructs the
    // mock client). Instance-field vi.fn()s on the class would override any
    // prototype patches and lose visibility from the test scope.
    const clientControls = {
        threadActive: true as boolean,
        compactThreadImpl: vi.fn(async () => {}),
        clearActiveThreadImpl: vi.fn(() => {}),
    };

    class MockCodexAppServerClient {
        sandboxEnabled = false;
        connect = vi.fn(async () => {});
        disconnect = vi.fn(async () => {});
        setApprovalHandler = vi.fn();
        setEventHandler = vi.fn((handler: (message: any) => void) => {
            eventHandler = handler;
        });
        hasActiveThread = vi.fn(() => clientControls.threadActive);
        startThread = vi.fn(async () => {
            clientControls.threadActive = true;
            return { threadId: 'thread-1' };
        });
        sendTurnAndWait = vi.fn(async () => ({ aborted: false }));
        abortTurnWithFallback = vi.fn(async () => ({ forcedRestart: false, resumedThread: true }));
        compactThread = vi.fn(async () => {
            await clientControls.compactThreadImpl();
        });
        clearActiveThread = vi.fn(() => {
            clientControls.threadActive = false;
            clientControls.clearActiveThreadImpl();
        });
    }

    return {
        mockSession,
        MockMessageQueue2,
        MockCodexAppServerClient,
        clientControls,
        getEventHandler: () => eventHandler,
        enqueueBatch: (text: string) => {
            queueBatches.push({
                message: text,
                consumedMessages: [{ messageId: `msg-${queueBatches.length + 1}`, seq: queueBatches.length + 1 }],
                mode: { permissionMode: 'default' },
            });
        },
        resetAll: () => {
            eventHandler = null;
            queueBatches.length = 0;
            clientControls.threadActive = true;
            clientControls.compactThreadImpl = vi.fn(async () => {});
            clientControls.clearActiveThreadImpl = vi.fn(() => {});
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

describe('runCodex /clear and /compact slash-command parity', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.resetAll();
        mocks.mockApiCreate.mockResolvedValue(createApi());
        mocks.mockReadSettings.mockResolvedValue({ machineId: 'machine-1', sandboxConfig: undefined });
    });

    it('intercepts /clear, drops the active thread, and emits a kind=clear boundary', async () => {
        mocks.clientControls.threadActive = true;
        mocks.enqueueBatch('/clear');

        await runCodex({ credentials: { token: 'token' } as any });

        expect(mocks.clientControls.clearActiveThreadImpl).toHaveBeenCalledTimes(1);

        const calls = (mocks.mockSession.sendContextBoundary as ReturnType<typeof vi.fn>).mock.calls
            .map((args) => args[0] as { kind: string; triggeredBy: string });
        expect(calls).toContainEqual(expect.objectContaining({ kind: 'clear', triggeredBy: 'user' }));

        // The clear branch must drop the codexThreadId metadata field so a
        // subsequent metadata reader (reconnect, fork) does not resurrect the
        // dead thread.
        const metadataPatchCalls = (mocks.mockSession.updateMetadata as ReturnType<typeof vi.fn>).mock.calls;
        const sawCodexThreadReset = metadataPatchCalls.some(([updater]) => {
            const patched = (updater as (m: Record<string, unknown>) => Record<string, unknown>)({ codexThreadId: 'old-thread' });
            return Object.prototype.hasOwnProperty.call(patched, 'codexThreadId')
                && patched.codexThreadId === undefined;
        });
        expect(sawCodexThreadReset).toBe(true);
    });

    it('intercepts /compact and emits kind=compact (not autocompact) on the compacted event', async () => {
        mocks.clientControls.threadActive = true;
        const compactCalls: number[] = [];
        mocks.clientControls.compactThreadImpl = vi.fn(async () => {
            compactCalls.push(Date.now());
        });

        mocks.enqueueBatch('/compact');

        await runCodex({ credentials: { token: 'token' } as any });

        // compactThread must have been invoked exactly once.
        expect(compactCalls.length).toBe(1);

        // Simulate the codex `thread/compacted` notification arriving after the
        // RPC ack — fan-out emits a `context_compacted` event into the handler.
        const eventHandler = mocks.getEventHandler();
        expect(eventHandler).toBeDefined();
        eventHandler!({ type: 'context_compacted', threadId: 'thread-1', turnId: 'turn-1' });
        await Promise.resolve();

        // User-triggered compact: kind=compact, triggeredBy=user (NOT autocompact).
        const boundaryCalls = (mocks.mockSession.sendContextBoundary as ReturnType<typeof vi.fn>).mock.calls
            .map((args) => args[0] as { kind: string; triggeredBy: string });
        const compactBoundary = boundaryCalls.find((c) => c.kind === 'compact');
        expect(compactBoundary).toEqual(expect.objectContaining({ kind: 'compact', triggeredBy: 'user' }));
        const autoBoundary = boundaryCalls.find((c) => c.kind === 'autocompact');
        expect(autoBoundary).toBeUndefined();

        // A subsequent compacted event with no user request in flight reverts
        // to the autocompact kind — the flag is consumed exactly once.
        eventHandler!({ type: 'context_compacted', threadId: 'thread-1', turnId: 'turn-2' });
        await Promise.resolve();
        const boundaryCallsAfter = (mocks.mockSession.sendContextBoundary as ReturnType<typeof vi.fn>).mock.calls
            .map((args) => args[0] as { kind: string; triggeredBy: string });
        expect(boundaryCallsAfter.filter((c) => c.kind === 'compact')).toHaveLength(1);
        expect(boundaryCallsAfter.filter((c) => c.kind === 'autocompact')).toHaveLength(1);
        const lastAuto = boundaryCallsAfter.find((c) => c.kind === 'autocompact');
        expect(lastAuto).toEqual(expect.objectContaining({ kind: 'autocompact', triggeredBy: 'system' }));
    });

    it('skips /compact when no thread is active (no-op safety)', async () => {
        mocks.clientControls.threadActive = false;
        const compactCalls: number[] = [];
        mocks.clientControls.compactThreadImpl = vi.fn(async () => {
            compactCalls.push(Date.now());
        });

        mocks.enqueueBatch('/compact');

        await runCodex({ credentials: { token: 'token' } as any });

        expect(compactCalls.length).toBe(0);
        const boundaryCalls = (mocks.mockSession.sendContextBoundary as ReturnType<typeof vi.fn>).mock.calls;
        expect(boundaryCalls.filter((args) => (args[0] as any).kind === 'compact')).toHaveLength(0);
    });
});
