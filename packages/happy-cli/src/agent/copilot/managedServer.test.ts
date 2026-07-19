import { EventEmitter } from 'node:events';
import type { ChildProcess } from 'node:child_process';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { spawnManagedTarget, validateRegistryEntry } from './managedServer';
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
  afterEach(() => {
    if (originalFalse === undefined) delete process.env.COPILOT_AGENTS_TAB;
    else process.env.COPILOT_AGENTS_TAB = originalFalse;
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
      env: expect.objectContaining({
        COPILOT_CONNECTION_TOKEN: 'token',
        COPILOT_RUN_APP: '1',
        COPILOT_AGENTS_TAB: 'true',
      }),
    }));
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
});
