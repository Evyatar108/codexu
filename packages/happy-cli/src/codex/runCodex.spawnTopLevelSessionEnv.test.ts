import { beforeEach, describe, expect, it, vi } from 'vitest';

import { HAPPY_CURRENT_SESSION_ID, HAPPY_DAEMON_CONTROL_URL } from '@/utils/envNames';

const mocks = vi.hoisted(() => {
    let lastCodexClient: any = null;
    const mockSession = {
        on: vi.fn(),
        onUserMessage: vi.fn(),
        onAgentConfiguration: vi.fn(),
        keepAlive: vi.fn(),
        updateMetadata: vi.fn(async () => {}),
        updateAgentState: vi.fn(),
        sendSessionEvent: vi.fn(),
        sendSessionProtocolMessage: vi.fn(),
        sendMessageConsumption: vi.fn(),
        sendSessionDeath: vi.fn(),
        flush: vi.fn(async () => {}),
        close: vi.fn(async () => {}),
        getMetadata: vi.fn(() => ({})),
        rpcHandlerManager: { registerHandler: vi.fn() },
        sessionId: 'happy-session-local-id',
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
        constructor() {
            lastCodexClient = this;
        }

        sandboxEnabled = false;
        connect = vi.fn(async () => {});
        disconnect = vi.fn(async () => {});
        setApprovalHandler = vi.fn();
        setEventHandler = vi.fn();
        hasActiveThread = vi.fn(() => true);
        startThread = vi.fn(async () => ({ threadId: 'codex-thread-id' }));
        sendTurnAndWait = vi.fn(async () => ({ aborted: false }));
        abortTurnWithFallback = vi.fn(async () => ({ forcedRestart: false, resumedThread: true }));
    }

    return {
        mockSession,
        MockMessageQueue2,
        MockCodexAppServerClient,
        getLastCodexClient: () => lastCodexClient,
        mockExecSync: vi.fn(() => 'codex-cli 0.120.0'),
        mockApiCreate: vi.fn(),
        mockGetOrCreateSession: vi.fn(async ({ metadata }: { metadata: any }) => ({
            id: 'happy-session-local-id',
            seq: 1,
            encryptionKey: new Uint8Array(32),
            encryptionVariant: 'legacy',
            metadata,
            metadataVersion: 1,
            agentState: {},
            agentStateVersion: 1,
        })),
        mockReadSettings: vi.fn(async () => ({ machineId: 'machine-1', sandboxConfig: undefined })),
        mockReadDaemonState: vi.fn(async () => ({ pid: 1234, httpPort: 45678 })),
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
    ...(await importOriginal<typeof import('node:child_process')>()),
    execSync: mocks.mockExecSync,
}));

vi.mock('@/api/api', () => ({
    ApiClient: { create: mocks.mockApiCreate },
}));

vi.mock('@/persistence', async () => {
    const actual = await vi.importActual<typeof import('@/persistence')>('@/persistence');
    return {
        ...actual,
        readSettings: mocks.mockReadSettings,
        readDaemonState: mocks.mockReadDaemonState,
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
    connectionState: { setBackend: mocks.mockSetBackend },
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

describe('runCodex spawn_top_level_session env plumbing', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.mockApiCreate.mockResolvedValue(createApi());
    });

    it('injects the bare Happy session id and daemon control URL into the Codex app-server child env', async () => {
        await runCodex({ credentials: { token: 'token' } as any });

        expect(mocks.getLastCodexClient().connect).toHaveBeenCalledWith({
            extraEnv: {
                [HAPPY_CURRENT_SESSION_ID]: 'happy-session-local-id',
                [HAPPY_DAEMON_CONTROL_URL]: 'http://127.0.0.1:45678',
            },
        });
        expect(mocks.getLastCodexClient().connect.mock.calls[0][0].extraEnv[HAPPY_CURRENT_SESSION_ID])
            .not.toBe('codex-thread-id');
    });
});
