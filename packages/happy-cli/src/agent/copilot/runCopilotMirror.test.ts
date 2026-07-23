import { EventEmitter } from 'node:events';
import { mkdir, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { logger } from '@/ui/logger';

import { runCopilotMirror } from './runCopilotMirror';
import {
  initializeLaunchStatus,
  type EvCopilotHappyLaunchContextV1,
} from './launchContext';
import { ManagedTargetTerminationUnconfirmedError } from './managedServer';

const scratchRoots: string[] = [];

function target() {
  return {
    child: Object.assign(new EventEmitter(), { pid: 123 }),
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

function activeHarness(overrides: {
  send?: (envelope: { ev: { t: string } }) => Promise<unknown>;
  metadataAck?: (call: number) => Promise<unknown>;
  flush?: () => Promise<void>;
  close?: () => Promise<void>;
} = {}) {
  const ownedTarget = target();
  const registered = new Map<string, (params?: unknown) => unknown>();
  let metadata: Record<string, unknown> = {};
  let metadataVersion = 0;
  let metadataAckCalls = 0;
  const socket = {
    connected: true,
    once: vi.fn(),
    off: vi.fn(),
    timeout: vi.fn(() => ({
      emitWithAck: vi.fn(async (_event, body) => {
        metadataAckCalls++;
        if (overrides.metadataAck) {
          const overridden = await overrides.metadataAck(metadataAckCalls);
          if (overridden !== undefined) return overridden;
        }
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
    sendSessionProtocolMessageWithDelivery: vi.fn(overrides.send ?? (async () => ({ id: 'delivery', seq: 1 }))),
    sendSessionDeath: vi.fn(),
    flush: vi.fn(overrides.flush ?? (async () => undefined)),
    close: vi.fn(overrides.close ?? (async () => undefined)),
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
  return {
    ownedTarget,
    registered,
    session,
    native,
    api,
    currentMetadata: () => metadata,
    dependencies: {
      createApi: vi.fn(async () => api as never),
      spawnTarget: vi.fn(async () => ownedTarget) as never,
      createNativeClient: vi.fn(() => native as never),
    },
  };
}

async function launchContext(): Promise<EvCopilotHappyLaunchContextV1> {
  const root = join(
    process.cwd(),
    '.test-artifacts',
    `run-copilot-mirror-${Date.now()}-${Math.random().toString(16).slice(2)}`,
  );
  scratchRoots.push(root);
  await mkdir(root, { recursive: true });
  const context: EvCopilotHappyLaunchContextV1 = {
    schemaVersion: 1,
    invocationId: 'invocation-1',
    channel: 'local-preview',
    releaseSetId: 'release-1',
    statusPath: join(root, 'happy-status.json'),
    evCopilot: {
      artifactId: 'ev-artifact',
      manifestSha256: 'A'.repeat(64),
      packageVersion: '1.0.71-3',
      executablePath: join(root, 'private-runtime-path', 'node.exe'),
      fixedArguments: [join(root, 'private-runtime-path', 'index.js')],
      edition: {
        name: 'owner-preview',
        version: '2026.07',
        sourceCommit: 'a'.repeat(40),
      },
    },
    happy: {
      artifactId: 'happy-artifact',
      manifestSha256: 'B'.repeat(64),
      cliVersion: '1.2.3',
    },
  };
  await initializeLaunchStatus(context);
  return context;
}

afterEach(async () => {
  await Promise.all(scratchRoots.splice(0).map((root) => rm(root, {
    recursive: true,
    force: true,
    maxRetries: 5,
    retryDelay: 50,
  })));
});

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

  it('bounds a hung active delivery and still releases every owned resource', async () => {
    vi.useFakeTimers();
    try {
      const harness = activeHarness({
        send: async (envelope) => envelope.ev.t === 'text'
          ? new Promise(() => undefined)
          : Promise.reject(new Error('Happy ACK rejected')),
      });
      const run = runCopilotMirror(options, harness.dependencies);
      await vi.waitFor(() => expect(harness.session.sendSessionProtocolMessageWithDelivery).toHaveBeenCalledOnce());
      harness.registered.get('killSession')?.();

      await vi.advanceTimersByTimeAsync(12_000);
      await expect(run).resolves.toBeUndefined();
      expect(harness.native.close).toHaveBeenCalledOnce();
      expect(harness.session.close).toHaveBeenCalledOnce();
      expect(harness.ownedTarget.terminate).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });

  it('isolates rejected ACK and Happy outage cleanup failures from child termination', async () => {
    const metadataAck = vi.fn(async (call: number) => {
      if (call === 1) return undefined;
      throw new Error('metadata outage');
    });
    const harness = activeHarness({
      send: async (envelope) => {
        if (envelope.ev.t === 'stop') throw new Error('stop ACK rejected');
        return { id: 'delivery', seq: 1 };
      },
      metadataAck,
      flush: async () => {
        throw new Error('flush outage');
      },
      close: async () => {
        throw new Error('close outage');
      },
    });

    await expect(runCopilotMirror(options, harness.dependencies)).resolves.toBeUndefined();
    expect(harness.session.sendSessionProtocolMessageWithDelivery.mock.calls.some(
      ([envelope]) => envelope.ev.t === 'stop',
    )).toBe(true);
    expect(metadataAck).toHaveBeenCalledTimes(2);
    expect(harness.session.sendSessionDeath).toHaveBeenCalledOnce();
    expect(harness.session.flush).toHaveBeenCalledOnce();
    expect(harness.session.close).toHaveBeenCalledOnce();
    expect(harness.native.close).toHaveBeenCalledOnce();
    expect(harness.ownedTarget.terminate).toHaveBeenCalledOnce();
  });

  it('preserves the primary runtime error while cleanup failures remain diagnostic', async () => {
    const debug = vi.spyOn(logger, 'debug').mockImplementation(() => {
      throw new Error('diagnostic logger failure');
    });
    const harness = activeHarness({
      close: async () => {
        throw new Error('secondary close failure');
      },
    });
    harness.native.readEventLog.mockRejectedValue(new Error('primary relay failure'));

    try {
      await expect(runCopilotMirror(options, harness.dependencies)).rejects.toThrow('primary relay failure');
      expect(harness.session.close).toHaveBeenCalledOnce();
      expect(harness.native.close).toHaveBeenCalledOnce();
      expect(harness.ownedTarget.terminate).toHaveBeenCalledOnce();
    } finally {
      debug.mockRestore();
    }
  });

  it('publishes path-free provenance and completes ownership monotonically', async () => {
    const context = await launchContext();
    const harness = activeHarness();

    await expect(runCopilotMirror(
      { ...options, launchContext: context },
      harness.dependencies,
    )).resolves.toBeUndefined();

    const status = JSON.parse(await readFile(context.statusPath, 'utf8'));
    expect(status).toMatchObject({
      phase: 'completed',
      targetPid: 123,
      exitCode: 0,
    });
    const provenance = harness.api.getOrCreateSession.mock.calls[0][0].metadata.copilotIntegration;
    expect(provenance).toMatchObject({
      launcher: { channel: 'local-preview', releaseSetId: 'release-1' },
      happyPayload: { artifactId: 'happy-artifact', manifestSha256: 'B'.repeat(64) },
      copilotRuntime: { artifactId: 'ev-artifact', packageVersion: '1.0.71-3' },
    });
    expect(JSON.stringify(provenance)).not.toContain('private-runtime-path');
    expect(JSON.stringify(provenance)).not.toContain('fixedArguments');
    expect(JSON.stringify(provenance)).not.toContain('secret');
  });

  it('leaves pre-ownership handshake failure eligible for fallback', async () => {
    const context = await launchContext();
    const harness = activeHarness();
    harness.native.connect.mockRejectedValueOnce(new Error('handshake rejected'));

    await expect(runCopilotMirror(
      { ...options, launchContext: context },
      harness.dependencies,
    )).rejects.toThrow('handshake rejected');

    expect(JSON.parse(await readFile(context.statusPath, 'utf8'))).toMatchObject({
      phase: 'initializing',
      failureCode: 'startup-failure',
    });
    expect(harness.ownedTarget.terminate).toHaveBeenCalledOnce();
  });

  it('prevents native fallback when pre-ownership target death cannot be proven', async () => {
    const context = await launchContext();
    const harness = activeHarness();
    harness.native.connect.mockRejectedValueOnce(new Error('handshake rejected'));
    harness.ownedTarget.terminate.mockRejectedValueOnce(
      new ManagedTargetTerminationUnconfirmedError(123),
    );

    await expect(runCopilotMirror(
      { ...options, launchContext: context },
      harness.dependencies,
    )).rejects.toBeInstanceOf(ManagedTargetTerminationUnconfirmedError);

    expect(JSON.parse(await readFile(context.statusPath, 'utf8'))).toMatchObject({
      phase: 'completed',
      targetPid: 123,
      exitCode: 1,
      failureCode: 'termination-unconfirmed',
    });
  });

  it('records post-ownership termination uncertainty instead of successful completion', async () => {
    const context = await launchContext();
    const harness = activeHarness();
    harness.ownedTarget.terminate.mockRejectedValueOnce(
      new ManagedTargetTerminationUnconfirmedError(123),
    );

    await expect(runCopilotMirror(
      { ...options, launchContext: context },
      harness.dependencies,
    )).resolves.toBeUndefined();

    expect(JSON.parse(await readFile(context.statusPath, 'utf8'))).toMatchObject({
      phase: 'completed',
      targetPid: 123,
      exitCode: 1,
      failureCode: 'termination-unconfirmed',
    });
  });
});
