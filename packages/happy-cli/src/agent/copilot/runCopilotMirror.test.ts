import { EventEmitter } from 'node:events';

import { describe, expect, it, vi } from 'vitest';

import { runCopilotMirror } from './runCopilotMirror';

function target() {
  return {
    child: new EventEmitter(),
    registry: {
      schemaVersion: 2 as const,
      kind: 'managed-server' as const,
      pid: 123,
      host: '127.0.0.1',
      port: 4321,
      token: 'secret',
      sessionId: 'native-private-id',
      copilotVersion: '1.0.71-3',
    },
    terminate: vi.fn(async () => undefined),
  };
}

const options = {
  credentials: {
    token: 'happy-token',
    encryption: { type: 'legacy' as const, secret: new Uint8Array(32) },
  },
  machineId: 'machine-1',
};

describe('runCopilotMirror lifecycle', () => {
  it('quiesces startup and terminates a target acquired after a stop signal', async () => {
    const ownedTarget = target();
    let resolveTarget!: (value: ReturnType<typeof target>) => void;
    const spawnTarget = vi.fn(() => new Promise<ReturnType<typeof target>>((resolve) => {
      resolveTarget = resolve;
    }));
    const createNativeClient = vi.fn();
    const run = runCopilotMirror(options, {
      createApi: vi.fn(async () => ({} as never)),
      spawnTarget: spawnTarget as never,
      createNativeClient,
    });
    await vi.waitFor(() => expect(spawnTarget).toHaveBeenCalledOnce());

    process.emit('SIGTERM');
    resolveTarget(ownedTarget);

    await expect(run).resolves.toBeUndefined();
    expect(createNativeClient).not.toHaveBeenCalled();
    expect(ownedTarget.terminate).toHaveBeenCalledOnce();
  });

  it('publishes startup-pending metadata as archived until the Happy socket is ready', async () => {
    const ownedTarget = target();
    let createOptions: { metadata: Record<string, unknown> } | undefined;
    const session = {
      socketReady: Promise.resolve(),
      socket: null,
      metadata: null,
      metadataVersion: 0,
      onUserMessage: vi.fn(),
      rpcHandlerManager: { registerHandler: vi.fn() },
      sendSessionDeath: vi.fn(),
      flush: vi.fn(async () => undefined),
      close: vi.fn(async () => undefined),
    };
    const api = {
      getOrCreateSession: vi.fn(async (value) => {
        createOptions = value;
        return { id: 'happy-1' };
      }),
      sessionSyncClient: vi.fn(() => session),
    };
    const native = {
      connect: vi.fn(async () => undefined),
      shutdown: vi.fn(async () => undefined),
      close: vi.fn(),
    };

    await expect(runCopilotMirror(options, {
      createApi: vi.fn(async () => api as never),
      spawnTarget: vi.fn(async () => ownedTarget) as never,
      createNativeClient: vi.fn(() => native as never),
    })).rejects.toThrow('socket was not constructed');

    expect(createOptions?.metadata).toMatchObject({
      lifecycleState: 'archived',
      archiveReason: 'startup-pending',
      flavor: 'copilot',
    });
    expect(ownedTarget.terminate).toHaveBeenCalledOnce();
    expect(native.close).toHaveBeenCalledOnce();
    expect(session.close).toHaveBeenCalledOnce();
  });

  it('runs the integrated read-only relay and finalizes after native shutdown', async () => {
    const ownedTarget = target();
    const deliveries: string[] = [];
    let metadata: Record<string, unknown> = {};
    let metadataVersion = 0;
    const registered = new Map<string, (params?: unknown) => unknown>();
    const socket = {
      connected: true,
      once: vi.fn(),
      off: vi.fn(),
      timeout: vi.fn(() => ({
        emitWithAck: vi.fn(async (_event, body) => {
          metadata = JSON.parse(body.metadata);
          metadataVersion++;
          return { result: 'success', metadata: body.metadata, version: metadataVersion };
        }),
      })),
    };
    const session = {
      sessionId: 'happy-1',
      socketReady: Promise.resolve(),
      socket,
      metadata,
      metadataVersion,
      rpcHandlerManager: {
        registerHandler: vi.fn((name: string, handler: (params?: unknown) => unknown) => {
          registered.set(name, handler);
        }),
      },
      onUserMessage: vi.fn(),
      sendSessionProtocolMessageWithDelivery: vi.fn(async (envelope) => {
        deliveries.push(envelope.ev.t);
        return { id: 'delivery', seq: deliveries.length };
      }),
      sendSessionDeath: vi.fn(),
      flush: vi.fn(async () => undefined),
      close: vi.fn(async () => undefined),
    };
    const api = {
      getOrCreateSession: vi.fn(async (value) => {
        metadata = value.metadata;
        session.metadata = metadata;
        return { id: 'happy-1' };
      }),
      sessionSyncClient: vi.fn(() => session),
    };
    const pages = [
      {
        events: [{ id: 'message', type: 'user.message', timestamp: '2026-07-19T00:00:00Z', data: { content: 'hello' } }],
        cursor: 'c1',
        cursorStatus: 'ok',
        hasMore: false,
      },
      { events: [], cursor: 'c2', cursorStatus: 'ok', hasMore: false },
      { events: [], cursor: 'c3', cursorStatus: 'ok', hasMore: false },
      {
        events: [{ id: 'shutdown', type: 'session.shutdown', timestamp: '2026-07-19T00:00:01Z' }],
        cursor: 'c4',
        cursorStatus: 'ok',
        hasMore: false,
      },
    ];
    const native = {
      connect: vi.fn(async () => undefined),
      onSessionEvent: vi.fn(() => () => undefined),
      resume: vi.fn(async () => undefined),
      readEventLog: vi.fn(async () => pages.shift()),
      reconnect: vi.fn(async () => undefined),
      shutdown: vi.fn(async () => undefined),
      close: vi.fn(),
    };

    await expect(runCopilotMirror(options, {
      createApi: vi.fn(async () => api as never),
      spawnTarget: vi.fn(async () => ownedTarget) as never,
      createNativeClient: vi.fn(() => native as never),
    })).resolves.toBeUndefined();

    expect(deliveries).toEqual(['text', 'stop']);
    expect(metadata).toMatchObject({ lifecycleState: 'archived', archiveReason: 'native-shutdown' });
    expect(registered.has('killSession')).toBe(true);
    expect(session.onUserMessage).toHaveBeenCalledOnce();
    expect(session.sendSessionDeath).toHaveBeenCalledOnce();
    expect(session.close).toHaveBeenCalledOnce();
    expect(ownedTarget.terminate).toHaveBeenCalledOnce();
    expect(api.getOrCreateSession.mock.calls[0][0].tag).not.toContain('native-private-id');
  });
});
