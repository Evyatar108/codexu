import { beforeEach, describe, expect, it, vi } from 'vitest';

// Covers Gap 6 (codex-agent-parity-audit.md) v1 defensive plan-mode mapping:
// when codex receives `permissionMode: 'plan'` (from the mobile UI handing a
// Claude session in plan mode off to codex, or any other channel), runCodex
// must emit a one-time service-message hint explaining that plan mode is
// approximated as read-only and the ExitPlanMode tool is not available. The
// hint must fire at most once per session regardless of how many turns
// re-assert plan mode.

const mocks = vi.hoisted(() => {
    const queueBatches: Array<{ message: string; consumedMessages: any[]; mode: any; meta?: any } | null> = [];
    const sentEnvelopes: Array<any> = [];

    const mockSession = {
        on: vi.fn(),
        onUserMessage: vi.fn(),
        onAgentConfiguration: vi.fn(),
        keepAlive: vi.fn(),
        updateMetadata: vi.fn(async () => {}),
        updateAgentState: vi.fn(),
        sendSessionEvent: vi.fn(),
        sendSessionProtocolMessage: vi.fn((envelope: any) => {
            sentEnvelopes.push(envelope);
        }),
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
        sentEnvelopes,
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
            sentEnvelopes.length = 0;
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

function planModeHints(): any[] {
    return mocks.sentEnvelopes.filter(env =>
        env?.role === 'agent'
        && env?.ev?.t === 'service'
        && typeof env.ev.text === 'string'
        && env.ev.text.includes('Plan mode on codex'),
    );
}

describe('runCodex plan-mode defensive hint (Gap 6 v1)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.resetAll();
        mocks.mockApiCreate.mockResolvedValue(createApi());
        mocks.mockReadSettings.mockResolvedValue({ machineId: 'machine-1', sandboxConfig: undefined });
    });

    it('emits the one-time service hint when started in plan mode via opts', async () => {
        await runCodex({
            credentials: { token: 'token' } as any,
            permissionMode: 'plan',
        });

        const hints = planModeHints();
        expect(hints).toHaveLength(1);
        expect(hints[0].ev.text).toContain('approximated as read-only');
        expect(hints[0].ev.text).toContain('ExitPlanMode');
    });

    it('does not emit the hint when started in a non-plan mode', async () => {
        await runCodex({
            credentials: { token: 'token' } as any,
            permissionMode: 'read-only',
        });

        expect(planModeHints()).toHaveLength(0);
    });

    it('fires the hint at most once even when plan mode is re-asserted later', async () => {
        await runCodex({
            credentials: { token: 'token' } as any,
            permissionMode: 'plan',
        });

        // Simulate a later user message that also carries plan mode by invoking
        // the captured onUserMessage handler directly. runCodex has already
        // exited (no batches enqueued), so the handler reaches the
        // currentPermissionMode update + maybeSendPlanModeHint call path
        // without spinning a new turn.
        const onUserMessageCalls = (mocks.mockSession.onUserMessage as ReturnType<typeof vi.fn>).mock.calls;
        expect(onUserMessageCalls.length).toBeGreaterThan(0);
        const handler = onUserMessageCalls[0][0] as (msg: any) => void;
        handler({
            content: { text: 'ping' },
            meta: { permissionMode: 'plan' },
            messageId: 'm-x',
            seq: 99,
        });

        expect(planModeHints()).toHaveLength(1);
    });
});
