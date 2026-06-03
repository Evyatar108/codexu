/**
 * Turn-lifecycle parity test for Gap 4 (codex-hooks-parity).
 *
 * Asserts that runCodex's event handler publishes `agentState.turnActive`
 * through `session.updateAgentState`:
 *   - true  on `task_started`
 *   - false on `task_complete` (UNCONDITIONAL — not guarded by `thinking`)
 *   - false on `turn_aborted`
 *
 * Replays every captured `updateAgentState` mutator on a fresh base state
 * (`{ controlledByUser: false }`) so the assertion stays robust to unrelated
 * `updateAgentState` calls that may be added to the event handler in future
 * commits.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

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

/**
 * Replay every captured `updateAgentState` mutator onto a fresh base state.
 *
 * Robust to additional `updateAgentState` callers (current or future) — only
 * the keys those mutators actually touch end up in the final state.
 */
function replayAgentStateMutators(baseState: Record<string, any>): Record<string, any> {
    const calls = (mocks.mockSession.updateAgentState as ReturnType<typeof vi.fn>).mock.calls;
    let state: Record<string, any> = { ...baseState };
    for (const [updater] of calls) {
        state = (updater as (s: Record<string, any>) => Record<string, any>)(state);
    }
    return state;
}

describe('runCodex turn-lifecycle agentState.turnActive parity', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.resetHandlers();
        mocks.mockApiCreate.mockResolvedValue(createApi());
        mocks.mockReadSettings.mockResolvedValue({ machineId: 'machine-1', sandboxConfig: undefined });
    });

    it('publishes turnActive: true on task_started', async () => {
        await runCodex({ credentials: { token: 'token' } as any });

        const eventHandler = mocks.getEventHandler();
        expect(eventHandler).toBeDefined();

        eventHandler!({ type: 'task_started', turn_id: 'turn-1' });

        const finalState = replayAgentStateMutators({ controlledByUser: false });
        expect(finalState.turnActive).toBe(true);
    });

    it('publishes turnActive: false on task_complete even without a preceding task_started (unconditional)', async () => {
        await runCodex({ credentials: { token: 'token' } as any });

        const eventHandler = mocks.getEventHandler();
        expect(eventHandler).toBeDefined();

        // No `task_started` first — proves the completion publication is not
        // guarded by `if (thinking)`.
        eventHandler!({ type: 'task_complete', turn_id: 'turn-1' });

        const finalState = replayAgentStateMutators({ controlledByUser: false });
        expect(finalState.turnActive).toBe(false);
    });

    it('publishes turnActive: true then false across task_started -> turn_aborted', async () => {
        await runCodex({ credentials: { token: 'token' } as any });

        const eventHandler = mocks.getEventHandler();
        expect(eventHandler).toBeDefined();

        eventHandler!({ type: 'task_started', turn_id: 'turn-2' });

        // Intermediate replay: after only task_started, turnActive must be true.
        const intermediateState = replayAgentStateMutators({ controlledByUser: false });
        expect(intermediateState.turnActive).toBe(true);

        eventHandler!({ type: 'turn_aborted', turn_id: 'turn-2' });

        const finalState = replayAgentStateMutators({ controlledByUser: false });
        expect(finalState.turnActive).toBe(false);
    });
});
