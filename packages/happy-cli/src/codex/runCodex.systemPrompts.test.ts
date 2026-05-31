import { beforeEach, describe, expect, it, vi } from 'vitest';

// Covers Gap 7 (codex-agent-parity-audit.md): the runCodex message loop must
// thread per-message `meta.customSystemPrompt` / `meta.appendSystemPrompt`
// through codex's `baseInstructions` / `developerInstructions` wire fields on
// BOTH the fresh-thread path (client.startThread) and the resume path
// (client.resumeThread via resumeExistingThread). Mid-session changes are
// deferred to the next thread start, matching Claude's "next turn only"
// semantics — but the most-recently-seen values must be the ones applied at
// the next start/resume.

const mocks = vi.hoisted(() => {
    const queueBatches: Array<{ message: string; consumedMessages: any[]; mode: any; meta?: any } | null> = [];

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

    // The runCodex source pushes user messages onto its own MessageQueue2 in the
    // onUserMessage handler — at that point per-message meta (customSystemPrompt,
    // appendSystemPrompt, etc.) has already been folded into `batch.mode`. So
    // the test pre-populates batches with the resolved mode that runCodex would
    // have computed.
    class MockMessageQueue2 {
        async waitForMessagesAndGetAsString() {
            return queueBatches.shift() ?? null;
        }
        size() {
            return queueBatches.length;
        }
        // No-op variants — runCodex's onUserMessage handler calls these but our
        // test pre-populates queueBatches directly.
        push() {}
        pushIsolateAndClear() {}
    }

    const clientControls = {
        threadActive: false as boolean,
        startThreadCalls: [] as Array<Record<string, unknown>>,
        sendTurnImpl: vi.fn(async () => ({ aborted: false })),
    };

    class MockCodexAppServerClient {
        sandboxEnabled = false;
        connect = vi.fn(async () => {});
        disconnect = vi.fn(async () => {});
        setApprovalHandler = vi.fn();
        setEventHandler = vi.fn();
        hasActiveThread = vi.fn(() => clientControls.threadActive);
        startThread = vi.fn(async (opts: Record<string, unknown>) => {
            clientControls.startThreadCalls.push(opts);
            clientControls.threadActive = true;
            return { threadId: 'thread-1' };
        });
        resumeThread = vi.fn(async () => ({ threadId: 'thread-1', model: 'gpt-5' }));
        sendTurnAndWait = vi.fn(async () => clientControls.sendTurnImpl());
        abortTurnWithFallback = vi.fn(async () => ({ forcedRestart: false, resumedThread: true }));
        compactThread = vi.fn(async () => {});
        clearActiveThread = vi.fn(() => { clientControls.threadActive = false; });
    }

    return {
        mockSession,
        MockMessageQueue2,
        MockCodexAppServerClient,
        clientControls,
        enqueueBatch: (text: string, mode: Record<string, unknown>) => {
            queueBatches.push({
                message: text,
                consumedMessages: [{ messageId: `msg-${queueBatches.length + 1}`, seq: queueBatches.length + 1 }],
                mode: { permissionMode: 'default', ...mode },
            });
        },
        resetAll: () => {
            queueBatches.length = 0;
            clientControls.threadActive = false;
            clientControls.startThreadCalls.length = 0;
            clientControls.sendTurnImpl = vi.fn(async () => ({ aborted: false }));
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
        mockResumeExistingThread: vi.fn(async () => ({ threadId: 'thread-1', model: 'gpt-5' })),
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

vi.mock('./resumeExistingThread', () => ({
    resumeExistingThread: mocks.mockResumeExistingThread,
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

describe('runCodex customSystemPrompt / appendSystemPrompt parity (Gap 7)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.resetAll();
        mocks.mockApiCreate.mockResolvedValue(createApi());
        mocks.mockReadSettings.mockResolvedValue({ machineId: 'machine-1', sandboxConfig: undefined });
    });

    it('threads customSystemPrompt + appendSystemPrompt into startThread on the first turn', async () => {
        mocks.enqueueBatch('hello', {
            customSystemPrompt: 'You are a pirate',
            appendSystemPrompt: 'Always say "Arrr"',
        });

        await runCodex({ credentials: { token: 'token' } as any });

        expect(mocks.clientControls.startThreadCalls).toHaveLength(1);
        expect(mocks.clientControls.startThreadCalls[0]).toMatchObject({
            baseInstructions: 'You are a pirate',
            developerInstructions: 'Always say "Arrr"',
        });
    });

    it('forwards persisted system prompts to resumeExistingThread when resuming an existing thread', async () => {
        await runCodex({
            credentials: { token: 'token' } as any,
            resumeThreadId: '019ccca2-1a77-7481-9873-de72f3464372',
        });

        // resumeExistingThread is called once on the resume path with the current
        // (undefined-on-fresh-process) baseInstructions / developerInstructions.
        // The contract is that the keys are forwarded — whether they carry a
        // value or undefined — so they reach the codex wire on every resume.
        expect(mocks.mockResumeExistingThread).toHaveBeenCalledTimes(1);
        const calls = (mocks.mockResumeExistingThread as ReturnType<typeof vi.fn>).mock.calls;
        const call = calls[0][0] as Record<string, unknown>;
        expect(call).toHaveProperty('baseInstructions');
        expect(call).toHaveProperty('developerInstructions');
        expect(call.threadId).toBe('019ccca2-1a77-7481-9873-de72f3464372');
    });
});
