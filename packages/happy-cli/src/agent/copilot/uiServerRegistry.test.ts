import { describe, expect, it, vi } from 'vitest';

import {
  DEFAULT_UI_SERVER_STALE_MS,
  attachUiServerTarget,
  discoverUiServerRegistryEntry,
  parseUiServerRegistryFile,
  selectUiServerRegistryEntry,
  type UiServerRegistryEntry,
} from './uiServerRegistry';

const NOW = Date.parse('2026-08-01T12:05:00.000Z');
const TOKEN = 'A'.repeat(43);

function registry(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schemaVersion: 1,
    pid: 123,
    host: '127.0.0.1',
    port: 54321,
    token: TOKEN,
    startedAt: '2026-08-01T12:00:00.000Z',
    copilotVersion: '1.0.75-ev.1',
    sessionId: 'session-1',
    sessionName: 'T6 terminal',
    cwd: 'C:\\work',
    ...overrides,
  };
}

function parse(overrides: Record<string, unknown> = {}, ageMs = 0): UiServerRegistryEntry {
  return parseUiServerRegistryFile(JSON.stringify(registry(overrides)), {
    expectedPid: 123,
    mtimeMs: NOW - ageMs,
    nowMs: NOW,
    isProcessAlive: () => true,
  });
}

describe('parseUiServerRegistryFile', () => {
  it('accepts schemaVersion 1 when kind is absent', () => {
    expect(parse()).toMatchObject({
      schemaVersion: 1,
      pid: 123,
      token: TOKEN,
      copilotVersion: '1.0.75-ev.1',
    });
    expect(parse()).not.toHaveProperty('kind');
  });

  it('accepts an explicit ui-server kind and rejects foreign kinds', () => {
    expect(parse({ kind: 'ui-server' })).toHaveProperty('kind', 'ui-server');
    expect(() => parse({ kind: 'managed-server' })).toThrow('invalid kind');
  });

  it('requires schemaVersion 1', () => {
    expect(() => parse({ schemaVersion: 2 })).toThrow('unsupported schemaVersion');
  });

  it('rejects null or malformed tokens without exposing their value', () => {
    expect(() => parse({ token: null })).toThrow('invalid connection token');
    const invalid = 'not/a/token';
    try {
      parse({ token: invalid });
      throw new Error('expected parse failure');
    } catch (error) {
      expect((error as Error).message).not.toContain(invalid);
    }
  });

  it.each(['0.0.0.0', '192.168.1.5', 'example.com'])('rejects non-loopback host %s', (host) => {
    expect(() => parse({ host })).toThrow('host is not loopback');
  });

  it('accepts the five-minute boundary and rejects entries older than it', () => {
    expect(parse({}, DEFAULT_UI_SERVER_STALE_MS)).toHaveProperty('pid', 123);
    expect(() => parse({}, DEFAULT_UI_SERVER_STALE_MS + 1)).toThrow('is stale');
  });

  it('rejects a registry whose process is no longer alive', () => {
    expect(() => parseUiServerRegistryFile(JSON.stringify(registry()), {
      expectedPid: 123,
      mtimeMs: NOW,
      nowMs: NOW,
      isProcessAlive: () => false,
    })).toThrow('is not running');
  });

  it('rejects malformed JSON', () => {
    expect(() => parseUiServerRegistryFile('{', {
      mtimeMs: NOW,
      nowMs: NOW,
      isProcessAlive: () => true,
    })).toThrow('malformed JSON');
  });

  it.each([
    'schemaVersion',
    'pid',
    'host',
    'port',
    'token',
    'startedAt',
    'copilotVersion',
  ])('rejects a missing required %s field', (field) => {
    expect(() => parse({ [field]: undefined })).toThrow();
  });
});

describe('selectUiServerRegistryEntry', () => {
  const first = parse();
  const second = {
    ...first,
    pid: 456,
    sessionName: 'Other terminal',
    cwd: 'C:\\other',
    startedAt: '2026-08-01T12:01:00.000Z',
  };

  it('selects exactly the requested pid', () => {
    expect(selectUiServerRegistryEntry([first, second], 456)).toBe(second);
    expect(() => selectUiServerRegistryEntry([first], 999)).toThrow('PID 999');
  });

  it('selects the sole live candidate', () => {
    expect(selectUiServerRegistryEntry([first])).toBe(first);
  });

  it('rejects zero candidates', () => {
    expect(() => selectUiServerRegistryEntry([])).toThrow('No live attachable');
  });

  it('lists multiple candidates and instructs the caller to pass a pid', () => {
    expect(() => selectUiServerRegistryEntry([first, second])).toThrow(
      /PID 123.*sessionName=T6 terminal.*cwd=C:\\work.*PID 456.*Pass --attach-ui-server <pid>/s,
    );
  });
});

describe('discoverUiServerRegistryEntry', () => {
  it('reads exactly the requested mocked registry file', async () => {
    const readTextFile = vi.fn(async () => JSON.stringify(registry()));
    const selected = await discoverUiServerRegistryEntry(123, {
      registryDirectory: 'C:\\copilot\\servers',
      readTextFile,
      readMtimeMs: vi.fn(async () => NOW),
      isProcessAlive: () => true,
      now: () => NOW,
    });

    expect(selected.entry.pid).toBe(123);
    expect(readTextFile).toHaveBeenCalledWith(expect.stringMatching(/123\.json$/));
  });

  it('scans mocked files and ignores non-v1 managed-server entries', async () => {
    const selected = await discoverUiServerRegistryEntry(undefined, {
      registryDirectory: 'C:\\copilot\\servers',
      listFiles: async () => ['111.json', '123.json', 'notes.txt'],
      readTextFile: async (path) => path.endsWith('111.json')
        ? JSON.stringify({ schemaVersion: 2, kind: 'managed-server' })
        : JSON.stringify(registry()),
      readMtimeMs: async () => NOW,
      isProcessAlive: () => true,
      now: () => NOW,
    });

    expect(selected.entry.pid).toBe(123);
  });

  it('ends an attached target when its mocked heartbeat becomes stale', async () => {
    vi.useFakeTimers();
    try {
      let mtimeMs = NOW;
      const target = await attachUiServerTarget(123, {
        registryDirectory: 'C:\\copilot\\servers',
        readTextFile: async () => JSON.stringify(registry()),
        readMtimeMs: async () => mtimeMs,
        isProcessAlive: () => true,
        now: () => NOW,
        monitorIntervalMs: 10,
      });
      mtimeMs = NOW - DEFAULT_UI_SERVER_STALE_MS - 1;

      await vi.advanceTimersByTimeAsync(10);
      await expect(target.waitForUnavailable).resolves.toBeUndefined();
      target.dispose();
    } finally {
      vi.useRealTimers();
    }
  });
});
