import { EventEmitter } from 'node:events';
import type { ChildProcess } from 'node:child_process';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  ManagedTargetTerminationUnconfirmedError,
  spawnManagedTarget,
  validateRegistryEntry,
} from './managedServer';
import { COPILOT_NATIVE_VERSION } from './types';

function registry(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schemaVersion: 2,
    kind: 'managed-server',
    pid: 123,
    host: '127.0.0.1',
    port: 4321,
    token: 'token',
    sessionId: 'session-1',
    copilotVersion: COPILOT_NATIVE_VERSION,
    ...overrides,
  };
}

describe('managed Copilot target', () => {
  const originalFalse = process.env.COPILOT_AGENTS_TAB;
  const originalBinary = process.env.HAPPY_COPILOT_BINARY;
  beforeEach(() => {
    delete process.env.HAPPY_COPILOT_BINARY;
  });
  afterEach(() => {
    if (originalFalse === undefined) delete process.env.COPILOT_AGENTS_TAB;
    else process.env.COPILOT_AGENTS_TAB = originalFalse;
    if (originalBinary === undefined) delete process.env.HAPPY_COPILOT_BINARY;
    else process.env.HAPPY_COPILOT_BINARY = originalBinary;
  });

  it('validates exact PID, token, loopback, schema, kind and version', () => {
    expect(validateRegistryEntry(registry(), { pid: 123, token: 'token' })).toMatchObject({ port: 4321 });
    for (const invalid of [
      { pid: 124 },
      { token: 'other' },
      { host: '0.0.0.0' },
      { schemaVersion: 1 },
      { kind: 'server' },
      { copilotVersion: '0.0.1' },
    ]) {
      expect(() => validateRegistryEntry(registry(invalid), { pid: 123, token: 'token' })).toThrow();
    }
  });

  it('spawns a retained direct child with security and lease flags', async () => {
    process.env.COPILOT_AGENTS_TAB = 'false';
    const child = Object.assign(new EventEmitter(), {
      pid: 123,
      exitCode: null,
      killed: false,
      kill: vi.fn(),
    }) as unknown as ChildProcess;
    const spawnProcess = vi.fn(() => child);
    const target = await spawnManagedTarget({ startupTimeoutMs: 100 }, {
      spawnProcess: spawnProcess as never,
      resolveExecutable: () => 'copilot.exe',
      randomToken: () => 'token',
      fileExists: (path) => path.endsWith('123.json'),
      readFile: () => JSON.stringify(registry()),
      sleep: async () => undefined,
    });

    expect(target.registry.sessionId).toBe('session-1');
    expect(spawnProcess).toHaveBeenCalledWith('copilot.exe', [
      '--server', '--port', '0', '--managed-server', '--session-idle-timeout', '300',
    ], expect.objectContaining({
      detached: false,
      stdio: 'ignore',
      windowsHide: true,
      shell: false,
      env: expect.objectContaining({
        COPILOT_CONNECTION_TOKEN: 'token',
        COPILOT_RUN_APP: '1',
        COPILOT_AGENTS_TAB: 'true',
      }),
    }));
  });

  it('spawns the exact verified executable and one fixed entry point before managed flags', async () => {
    const child = Object.assign(new EventEmitter(), {
      pid: 123,
      exitCode: null,
      kill: vi.fn(),
    }) as unknown as ChildProcess;
    const spawnProcess = vi.fn(() => child);
    await spawnManagedTarget({
      startupTimeoutMs: 100,
      launch: {
        executable: 'C:\\EvCopilot\\payload\\node.exe',
        fixedArguments: ['C:\\EvCopilot\\payload\\dist-cli\\index.js'],
        packageVersion: COPILOT_NATIVE_VERSION,
        edition: {
          name: 'owner-preview',
          version: '2026.07',
          sourceCommit: 'a'.repeat(40),
        },
      },
    }, {
      spawnProcess: spawnProcess as never,
      randomToken: () => 'token',
      fileExists: (path) => path.endsWith('123.json'),
      readFile: () => JSON.stringify(registry()),
      sleep: async () => undefined,
    });

    expect(spawnProcess).toHaveBeenCalledWith('C:\\EvCopilot\\payload\\node.exe', [
      'C:\\EvCopilot\\payload\\dist-cli\\index.js',
      '--server', '--port', '0', '--managed-server', '--session-idle-timeout', '300',
    ], expect.objectContaining({
      shell: false,
      env: expect.objectContaining({
        COPILOT_AUTO_UPDATE: 'false',
        COPILOT_LOCAL_BUILD: '1',
        COPILOT_EDITION_NAME: 'owner-preview',
        COPILOT_EDITION_VERSION: '2026.07',
        COPILOT_EDITION_SOURCE_COMMIT: 'a'.repeat(40),
      }),
    }));
  });

  it('rejects development override mixing before spawn', async () => {
    process.env.HAPPY_COPILOT_BINARY = 'C:\\dev\\copilot.exe';
    const spawnProcess = vi.fn();
    try {
      await expect(spawnManagedTarget({
        launch: {
          executable: 'C:\\verified\\node.exe',
          fixedArguments: ['C:\\verified\\index.js'],
          packageVersion: COPILOT_NATIVE_VERSION,
          edition: { name: 'preview', version: '1', sourceCommit: 'b'.repeat(40) },
        },
      }, { spawnProcess: spawnProcess as never })).rejects.toThrow('cannot be combined');
      expect(spawnProcess).not.toHaveBeenCalled();
    } finally {
      if (originalBinary === undefined) delete process.env.HAPPY_COPILOT_BINARY;
      else process.env.HAPPY_COPILOT_BINARY = originalBinary;
    }
  });

  it('fails before spawn when canonical config disables the feature', async () => {
    const spawnProcess = vi.fn();
    await expect(spawnManagedTarget({}, {
      spawnProcess: spawnProcess as never,
      resolveExecutable: () => 'copilot',
      fileExists: (path) => path.endsWith('config.json'),
      readFile: () => `{
        // User setting must win over the environment.
        "enabledFeatureFlags": {
          "COPILOT_AGENTS_TAB": false,
        },
      }`,
    })).rejects.toThrow('disables COPILOT_AGENTS_TAB');
    expect(spawnProcess).not.toHaveBeenCalled();
  });

  it('fails closed when TERM and KILL are refused and the target remains alive', async () => {
    const child = Object.assign(new EventEmitter(), {
      pid: 123,
      exitCode: null,
      kill: vi.fn(() => false),
    }) as unknown as ChildProcess;
    const target = await spawnManagedTarget({ startupTimeoutMs: 100 }, {
      spawnProcess: vi.fn(() => child) as never,
      resolveExecutable: () => 'copilot.exe',
      randomToken: () => 'token',
      fileExists: (path) => path.endsWith('123.json'),
      readFile: () => JSON.stringify(registry()),
      sleep: async () => undefined,
      isProcessAlive: () => true,
    });

    await expect(target.terminate()).rejects.toBeInstanceOf(
      ManagedTargetTerminationUnconfirmedError,
    );
    expect(child.kill).toHaveBeenNthCalledWith(1, 'SIGTERM');
    expect(child.kill).toHaveBeenNthCalledWith(2, 'SIGKILL');
  });

  it('does not trust successful kill return values while liveness remains true', async () => {
    const child = Object.assign(new EventEmitter(), {
      pid: 123,
      exitCode: null,
      kill: vi.fn(() => true),
    }) as unknown as ChildProcess;
    const target = await spawnManagedTarget({ startupTimeoutMs: 100 }, {
      spawnProcess: vi.fn(() => child) as never,
      resolveExecutable: () => 'copilot.exe',
      randomToken: () => 'token',
      fileExists: (path) => path.endsWith('123.json'),
      readFile: () => JSON.stringify(registry()),
      sleep: async () => undefined,
      isProcessAlive: () => true,
    });

    await expect(target.terminate()).rejects.toMatchObject({ targetPid: 123 });
  });

  it('confirms death after escalation before returning', async () => {
    let alive = true;
    const child = Object.assign(new EventEmitter(), {
      pid: 123,
      exitCode: null,
      kill: vi.fn((signal: NodeJS.Signals) => {
        if (signal === 'SIGKILL') alive = false;
        return true;
      }),
    }) as unknown as ChildProcess;
    const target = await spawnManagedTarget({ startupTimeoutMs: 100 }, {
      spawnProcess: vi.fn(() => child) as never,
      resolveExecutable: () => 'copilot.exe',
      randomToken: () => 'token',
      fileExists: (path) => path.endsWith('123.json'),
      readFile: () => JSON.stringify(registry()),
      sleep: async () => undefined,
      isProcessAlive: () => alive,
    });

    await expect(target.terminate()).resolves.toBeUndefined();
    expect(child.kill).toHaveBeenNthCalledWith(2, 'SIGKILL');
  });

  it('surfaces unconfirmed startup cleanup instead of the registry timeout', async () => {
    vi.useFakeTimers();
    try {
      const child = Object.assign(new EventEmitter(), {
        pid: 123,
        exitCode: null,
        kill: vi.fn(() => false),
      }) as unknown as ChildProcess;
      let now = 0;
      vi.spyOn(Date, 'now').mockImplementation(() => {
        now += 101;
        return now;
      });

      await expect(spawnManagedTarget({ startupTimeoutMs: 100 }, {
        spawnProcess: vi.fn(() => child) as never,
        resolveExecutable: () => 'copilot.exe',
        randomToken: () => 'token',
        fileExists: () => false,
        sleep: async () => undefined,
        isProcessAlive: () => true,
      })).rejects.toBeInstanceOf(ManagedTargetTerminationUnconfirmedError);
    } finally {
      vi.restoreAllMocks();
      vi.useRealTimers();
    }
  });
});
