import { describe, expect, it, vi } from 'vitest';

import type { Metadata } from '@/api/types';
import { HAPPY_FORKED_FROM_SESSION_ID, HAPPY_PARENT_SESSION_ID } from '@/utils/envNames';
import type { TrackedSession } from './types';
import { FORK_ENV_DENYLIST_PATTERN, forkSession, type ForkSessionDeps } from './forkSession';
import { MAX_SPAWN_DEPTH, appendSpawnedChild } from './spawnSessionFromSession';

const PARENT_REPO_ROOT = '/parent';
const MACHINE_ID = 'machine-1';
const defaultRealpath = (p: string) => Promise.resolve(p);
const defaultRunGit = async (_cwd: string, args: string[]): Promise<string> => {
  if (args[0] === 'rev-parse' && args[1] === '--show-toplevel') {
    return `${PARENT_REPO_ROOT}\n`;
  }
  if (args[0] === 'worktree' && args[1] === 'list' && args[2] === '--porcelain') {
    return [
      `worktree ${PARENT_REPO_ROOT}`,
      'HEAD 0000000000000000000000000000000000000000',
      'branch refs/heads/main',
      '',
      'worktree /fork/worktree',
      'HEAD 0000000000000000000000000000000000000000',
      'branch refs/heads/fork',
      '',
    ].join('\n');
  }
  return '';
};

function codexMetadata(overrides: Partial<Metadata> = {}): Metadata {
  return {
    path: '/parent/worktree',
    host: 'test-host',
    homeDir: '/home/test',
    happyHomeDir: '/home/test/.happy',
    happyLibDir: '/happy/lib',
    happyToolsDir: '/happy/tools',
    flavor: 'codex',
    codexThreadId: 'thread-parent',
    ...overrides,
  };
}

function trackedSession(metadata: Metadata = codexMetadata(), happySessionId = 'parent-local-id'): TrackedSession {
  return {
    startedBy: 'daemon',
    happySessionId,
    happySessionMetadataFromLocalWebhook: metadata,
    encryption: {
      encryptionKey: new Uint8Array([1, 2, 3]),
      encryptionVariant: 'legacy',
      seq: 7,
      metadataVersion: 11,
      agentStateVersion: 13,
    },
    pid: 123,
  };
}

/**
 * Mirrors spawnSessionFromSession.test.ts:48-56 ancestryLinks pattern: builds a
 * chain of `depth` parent links rooted at 'parent-local-id' on the given
 * machine, terminating in a tracked ancestor with no parentSessionId.
 */
function ancestryLinks(machineId: string, depth: number): Record<string, string | undefined> {
  const links: Record<string, string | undefined> = {};
  for (let index = 0; index < depth; index += 1) {
    const localId = index === 0 ? 'parent-local-id' : `ancestor-${index}`;
    links[localId] = `${machineId}:ancestor-${index + 1}`;
  }
  links[`ancestor-${depth}`] = undefined;
  return links;
}

function trackedByLocalId(parentLinks: Record<string, string | undefined>): Map<string, TrackedSession> {
  const sessions = new Map<string, TrackedSession>();
  for (const [localId, parentSessionId] of Object.entries(parentLinks)) {
    sessions.set(localId, trackedSession(codexMetadata(parentSessionId ? { parentSessionId } : {}), localId));
  }
  return sessions;
}

describe('forkSession', () => {
  it('spawns a fresh Codex resume launch in the chosen worktree with fork env only', async () => {
    const parent = trackedSession();
    const spawnTrackedHappyProcess = vi.fn().mockResolvedValue({ type: 'success', sessionId: 'fork-child-id' });
    const updateParentMetadata = vi.fn().mockResolvedValue(undefined);

    const result = await forkSession({
      parentSessionId: 'parent-local-id',
      worktreePath: '/fork/worktree',
      model: 'gpt-5.2-codex',
      permissionMode: 'safe-yolo',
      effortLevel: 'high',
    }, {
      findTrackedSessionById: vi.fn().mockReturnValue(parent),
      fetchServerSessionMetadata: vi.fn(),
      spawnTrackedHappyProcess,
      stat: vi.fn().mockResolvedValue({ isDirectory: () => true }),
      realpath: vi.fn(defaultRealpath),
      runGit: vi.fn(defaultRunGit),
      baseEnv: {
        PATH: '/bin',
        HAPPY_RECONNECT_SESSION_ID: 'old-session',
        HAPPY_RECONNECT_ENCRYPTION_KEY: 'old-key',
      },
      machineId: MACHINE_ID,
      updateParentMetadata,
    });

    expect(result).toEqual({ type: 'success', sessionId: 'fork-child-id' });
    expect(spawnTrackedHappyProcess).toHaveBeenCalledTimes(1);
    const launch = spawnTrackedHappyProcess.mock.calls[0][0];
    expect(launch.cwd).toBe('/fork/worktree');
    expect(launch.args).toEqual([
      'codex', '--resume', 'thread-parent',
      '--started-by', 'daemon',
      '--effort', 'high',
      '--model', 'gpt-5.2-codex',
      '--permission-mode', 'safe-yolo',
    ]);
    expect(launch.env[HAPPY_FORKED_FROM_SESSION_ID]).toBe('parent-local-id');
    expect(launch.env[HAPPY_PARENT_SESSION_ID]).toBe(`${MACHINE_ID}:parent-local-id`);
    expect(Object.keys(launch.env).filter(key => key.startsWith('HAPPY_RECONNECT_'))).toHaveLength(0);

    expect(updateParentMetadata).toHaveBeenCalledTimes(1);
    const [parentArg, trackedArg, patchFn] = updateParentMetadata.mock.calls[0];
    expect(parentArg).toBe('parent-local-id');
    expect(trackedArg).toBe(parent);
    const patched = patchFn(codexMetadata({ spawnedChildren: ['machine-1:older'] }));
    expect(patched).toMatchObject({
      spawnedChildren: ['machine-1:older', `${MACHINE_ID}:fork-child-id`],
    });
    // Sanity-check parity with appendSpawnedChild semantics.
    expect(appendSpawnedChild(codexMetadata(), `${MACHINE_ID}:fork-child-id`)).toMatchObject({
      spawnedChildren: [`${MACHINE_ID}:fork-child-id`],
    });
  });

  it('always fetches server metadata and prefers fresh codexThreadId over stale cached one', async () => {
    const parent = trackedSession(codexMetadata({ codexThreadId: 'stale-thread' }));
    const spawnTrackedHappyProcess = vi.fn().mockResolvedValue({ type: 'success', sessionId: 'fork-child-id' });
    const fetchServerSessionMetadata = vi.fn().mockResolvedValue(codexMetadata({ codexThreadId: 'fresh-thread' }));

    await forkSession({ parentSessionId: 'parent-local-id', worktreePath: '/fork/worktree' }, {
      findTrackedSessionById: vi.fn().mockReturnValue(parent),
      fetchServerSessionMetadata,
      spawnTrackedHappyProcess,
      stat: vi.fn().mockResolvedValue({ isDirectory: () => true }),
      realpath: vi.fn(defaultRealpath),
      runGit: vi.fn(defaultRunGit),
      baseEnv: {},
      machineId: MACHINE_ID,
      updateParentMetadata: vi.fn().mockResolvedValue(undefined),
    });

    expect(fetchServerSessionMetadata).toHaveBeenCalledTimes(1);
    expect(fetchServerSessionMetadata).toHaveBeenCalledWith('parent-local-id', parent.encryption!.encryptionKey, 'legacy');
    expect(spawnTrackedHappyProcess.mock.calls[0][0].args).toContain('fresh-thread');
    expect(spawnTrackedHappyProcess.mock.calls[0][0].args).not.toContain('stale-thread');
    expect(spawnTrackedHappyProcess.mock.calls[0][0].env[HAPPY_PARENT_SESSION_ID]).toBe(`${MACHINE_ID}:parent-local-id`);
  });

  it('falls back to local cached codexThreadId when server fetch fails', async () => {
    const parent = trackedSession(codexMetadata({ codexThreadId: 'cached-thread' }));
    const spawnTrackedHappyProcess = vi.fn().mockResolvedValue({ type: 'success', sessionId: 'fork-child-id' });
    const fetchServerSessionMetadata = vi.fn().mockRejectedValue(new Error('network error'));

    await forkSession({ parentSessionId: 'parent-local-id', worktreePath: '/fork/worktree' }, {
      findTrackedSessionById: vi.fn().mockReturnValue(parent),
      fetchServerSessionMetadata,
      spawnTrackedHappyProcess,
      stat: vi.fn().mockResolvedValue({ isDirectory: () => true }),
      realpath: vi.fn(defaultRealpath),
      runGit: vi.fn(defaultRunGit),
      baseEnv: {},
      machineId: MACHINE_ID,
      updateParentMetadata: vi.fn().mockResolvedValue(undefined),
    });

    expect(fetchServerSessionMetadata).toHaveBeenCalledTimes(1);
    expect(spawnTrackedHappyProcess.mock.calls[0][0].args).toContain('cached-thread');
    expect(spawnTrackedHappyProcess.mock.calls[0][0].env[HAPPY_PARENT_SESSION_ID]).toBe(`${MACHINE_ID}:parent-local-id`);
  });

  it('fetches fresh metadata when the webhook has Codex flavor but no thread id', async () => {
    const parent = trackedSession(codexMetadata({ codexThreadId: undefined }));
    const spawnTrackedHappyProcess = vi.fn().mockResolvedValue({ type: 'success', sessionId: 'fork-child-id' });
    const fetchServerSessionMetadata = vi.fn().mockResolvedValue(codexMetadata({ codexThreadId: 'fresh-thread' }));

    await forkSession({ parentSessionId: 'parent-local-id', worktreePath: '/fork/worktree' }, {
      findTrackedSessionById: vi.fn().mockReturnValue(parent),
      fetchServerSessionMetadata,
      spawnTrackedHappyProcess,
      stat: vi.fn().mockResolvedValue({ isDirectory: () => true }),
      realpath: vi.fn(defaultRealpath),
      runGit: vi.fn(defaultRunGit),
      baseEnv: {},
      machineId: MACHINE_ID,
      updateParentMetadata: vi.fn().mockResolvedValue(undefined),
    });

    expect(fetchServerSessionMetadata).toHaveBeenCalledWith('parent-local-id', parent.encryption!.encryptionKey, 'legacy');
    expect(spawnTrackedHappyProcess.mock.calls[0][0].args).toContain('fresh-thread');
  });

  it('returns error envelopes for missing parent, missing worktree, and non-Codex parent', async () => {
    const parentMissing = await forkSession({ parentSessionId: 'missing', worktreePath: '/fork/worktree' }, {
      findTrackedSessionById: vi.fn().mockReturnValue(undefined),
      fetchServerSessionMetadata: vi.fn(),
      spawnTrackedHappyProcess: vi.fn(),
      stat: vi.fn(),
      realpath: vi.fn(defaultRealpath),
      runGit: vi.fn(defaultRunGit),
      baseEnv: {},
      machineId: MACHINE_ID,
      updateParentMetadata: vi.fn(),
    });
    expect(parentMissing.type).toBe('error');
    expect(parentMissing).toMatchObject({ errorMessage: expect.stringContaining('not tracked') });

    const worktreeMissing = await forkSession({ parentSessionId: 'parent-local-id', worktreePath: '/missing/worktree' }, {
      findTrackedSessionById: vi.fn().mockReturnValue(trackedSession()),
      fetchServerSessionMetadata: vi.fn(),
      spawnTrackedHappyProcess: vi.fn(),
      stat: vi.fn().mockRejectedValue(new Error('ENOENT')),
      realpath: vi.fn(defaultRealpath),
      runGit: vi.fn(defaultRunGit),
      baseEnv: {},
      machineId: MACHINE_ID,
      updateParentMetadata: vi.fn(),
    });
    expect(worktreeMissing.type).toBe('error');
    expect(worktreeMissing).toMatchObject({ errorMessage: expect.stringContaining('ENOENT') });

    const flavorUnsupported = await forkSession({ parentSessionId: 'parent-local-id', worktreePath: '/fork/worktree' }, {
      findTrackedSessionById: vi.fn().mockReturnValue(trackedSession(codexMetadata({ flavor: 'claude', codexThreadId: undefined }))),
      fetchServerSessionMetadata: vi.fn(),
      spawnTrackedHappyProcess: vi.fn(),
      stat: vi.fn(),
      realpath: vi.fn(defaultRealpath),
      runGit: vi.fn(defaultRunGit),
      baseEnv: {},
      machineId: MACHINE_ID,
      updateParentMetadata: vi.fn(),
    });
    expect(flavorUnsupported.type).toBe('error');
    expect(flavorUnsupported).toMatchObject({ errorMessage: expect.stringContaining('Codex sessions only') });
  });

  it('returns error when worktreePath is not absolute', async () => {
    const result = await forkSession({ parentSessionId: 'parent-local-id', worktreePath: 'relative/path' }, {
      findTrackedSessionById: vi.fn().mockReturnValue(trackedSession()),
      fetchServerSessionMetadata: vi.fn(),
      spawnTrackedHappyProcess: vi.fn(),
      stat: vi.fn(),
      realpath: vi.fn(defaultRealpath),
      runGit: vi.fn(defaultRunGit),
      baseEnv: {},
      machineId: MACHINE_ID,
      updateParentMetadata: vi.fn(),
    });
    expect(result.type).toBe('error');
    expect(result).toMatchObject({ errorMessage: expect.stringContaining('absolute path') });
  });

  it('returns error when worktreePath stat is not a directory', async () => {
    const result = await forkSession({ parentSessionId: 'parent-local-id', worktreePath: '/fork/worktree/file.txt' }, {
      findTrackedSessionById: vi.fn().mockReturnValue(trackedSession()),
      fetchServerSessionMetadata: vi.fn(),
      spawnTrackedHappyProcess: vi.fn(),
      stat: vi.fn().mockResolvedValue({ isDirectory: () => false }),
      realpath: vi.fn(defaultRealpath),
      runGit: vi.fn(defaultRunGit),
      baseEnv: {},
      machineId: MACHINE_ID,
      updateParentMetadata: vi.fn(),
    });
    expect(result.type).toBe('error');
    expect(result).toMatchObject({ errorMessage: expect.stringContaining('directory') });
  });

  it('passes through approval-request envelopes returned by the spawner and does NOT call updateParentMetadata', async () => {
    const updateParentMetadata = vi.fn().mockResolvedValue(undefined);
    const result = await forkSession({ parentSessionId: 'parent-local-id', worktreePath: '/fork/worktree' }, {
      findTrackedSessionById: vi.fn().mockReturnValue(trackedSession()),
      fetchServerSessionMetadata: vi.fn(),
      spawnTrackedHappyProcess: vi.fn().mockResolvedValue({ type: 'requestToApproveDirectoryCreation', directory: '/fork/worktree' }),
      stat: vi.fn().mockResolvedValue({ isDirectory: () => true }),
      realpath: vi.fn(defaultRealpath),
      runGit: vi.fn(defaultRunGit),
      baseEnv: {},
      machineId: MACHINE_ID,
      updateParentMetadata,
    });

    expect(result).toEqual({ type: 'requestToApproveDirectoryCreation', directory: '/fork/worktree' });
    expect(updateParentMetadata).not.toHaveBeenCalled();
  });

  it('does NOT call updateParentMetadata when spawn returns an error envelope', async () => {
    const updateParentMetadata = vi.fn().mockResolvedValue(undefined);
    const result = await forkSession({ parentSessionId: 'parent-local-id', worktreePath: '/fork/worktree' }, {
      findTrackedSessionById: vi.fn().mockReturnValue(trackedSession()),
      fetchServerSessionMetadata: vi.fn(),
      spawnTrackedHappyProcess: vi.fn().mockResolvedValue({ type: 'error', errorMessage: 'spawn boom' }),
      stat: vi.fn().mockResolvedValue({ isDirectory: () => true }),
      realpath: vi.fn(defaultRealpath),
      runGit: vi.fn(defaultRunGit),
      baseEnv: {},
      machineId: MACHINE_ID,
      updateParentMetadata,
    });

    expect(result).toEqual({ type: 'error', errorMessage: 'spawn boom' });
    expect(updateParentMetadata).not.toHaveBeenCalled();
  });

  it('strips every env var matching the fork denylist pattern (HAPPY_RECONNECT_*, HAPPY_DAEMON_PRIVATE_*)', async () => {
    expect(FORK_ENV_DENYLIST_PATTERN.test('HAPPY_RECONNECT_SESSION_ID')).toBe(true);
    expect(FORK_ENV_DENYLIST_PATTERN.test('HAPPY_RECONNECT_ENCRYPTION_KEY')).toBe(true);
    expect(FORK_ENV_DENYLIST_PATTERN.test('HAPPY_DAEMON_PRIVATE_TOKEN')).toBe(true);
    expect(FORK_ENV_DENYLIST_PATTERN.test('HAPPY_DAEMON_PRIVATE_FUTURE_KEY')).toBe(true);
    expect(FORK_ENV_DENYLIST_PATTERN.test('HAPPY_OTHER_VAR')).toBe(false);
    expect(FORK_ENV_DENYLIST_PATTERN.test('PATH')).toBe(false);

    const parent = trackedSession();
    const spawnTrackedHappyProcess = vi.fn().mockResolvedValue({ type: 'success', sessionId: 'fork-child-id' });

    await forkSession({ parentSessionId: 'parent-local-id', worktreePath: '/fork/worktree' }, {
      findTrackedSessionById: vi.fn().mockReturnValue(parent),
      fetchServerSessionMetadata: vi.fn(),
      spawnTrackedHappyProcess,
      stat: vi.fn().mockResolvedValue({ isDirectory: () => true }),
      realpath: vi.fn(defaultRealpath),
      runGit: vi.fn(defaultRunGit),
      baseEnv: {
        PATH: '/bin',
        HAPPY_RECONNECT_SESSION_ID: 'old-session',
        HAPPY_RECONNECT_ENCRYPTION_KEY: 'old-key',
        HAPPY_DAEMON_PRIVATE_TOKEN: 'private-token',
        HAPPY_DAEMON_PRIVATE_FUTURE_KEY: 'future',
        HAPPY_OTHER_VAR: 'kept',
      },
      machineId: MACHINE_ID,
      updateParentMetadata: vi.fn().mockResolvedValue(undefined),
    });

    const launchEnv = spawnTrackedHappyProcess.mock.calls[0][0].env;
    expect(Object.keys(launchEnv).filter((key: string) => FORK_ENV_DENYLIST_PATTERN.test(key))).toHaveLength(0);
    expect(launchEnv.HAPPY_RECONNECT_SESSION_ID).toBeUndefined();
    expect(launchEnv.HAPPY_RECONNECT_ENCRYPTION_KEY).toBeUndefined();
    expect(launchEnv.HAPPY_DAEMON_PRIVATE_TOKEN).toBeUndefined();
    expect(launchEnv.HAPPY_DAEMON_PRIVATE_FUTURE_KEY).toBeUndefined();
    expect(launchEnv.HAPPY_OTHER_VAR).toBe('kept');
    expect(launchEnv.PATH).toBe('/bin');
    expect(launchEnv[HAPPY_FORKED_FROM_SESSION_ID]).toBe('parent-local-id');
    expect(launchEnv[HAPPY_PARENT_SESSION_ID]).toBe(`${MACHINE_ID}:parent-local-id`);
  });

  it('rejects an absolute worktree directory outside the parent repo and not registered as a worktree', async () => {
    const parent = trackedSession();
    const runGit = vi.fn(async (_cwd: string, args: string[]): Promise<string> => {
      if (args[0] === 'rev-parse') return `${PARENT_REPO_ROOT}\n`;
      if (args[0] === 'worktree') {
        return [
          `worktree ${PARENT_REPO_ROOT}`,
          'HEAD 0000000000000000000000000000000000000000',
          'branch refs/heads/main',
          '',
        ].join('\n');
      }
      return '';
    });

    const result = await forkSession({
      parentSessionId: 'parent-local-id',
      worktreePath: '/etc/elsewhere',
    }, {
      findTrackedSessionById: vi.fn().mockReturnValue(parent),
      fetchServerSessionMetadata: vi.fn(),
      spawnTrackedHappyProcess: vi.fn(),
      stat: vi.fn().mockResolvedValue({ isDirectory: () => true }),
      realpath: vi.fn(defaultRealpath),
      runGit,
      baseEnv: {},
      machineId: MACHINE_ID,
      updateParentMetadata: vi.fn(),
    });

    expect(result.type).toBe('error');
    expect(result).toMatchObject({ errorMessage: expect.stringContaining('not a registered worktree') });
  });

  // Mirrors spawnSessionFromSession.test.ts:185 — ancestry validation must
  // reject at the cap BEFORE any worktree stat/realpath/runGit/spawn work.
  it('rejects local ancestry at MAX_SPAWN_DEPTH before stat, runGit, spawn, or updateParentMetadata', async () => {
    const sessions = trackedByLocalId(ancestryLinks(MACHINE_ID, MAX_SPAWN_DEPTH));
    const spawnTrackedHappyProcess = vi.fn();
    const stat = vi.fn();
    const realpath = vi.fn(defaultRealpath);
    const runGit = vi.fn(defaultRunGit);
    const updateParentMetadata = vi.fn();

    const result = await forkSession({
      parentSessionId: 'parent-local-id',
      worktreePath: '/fork/worktree',
    }, {
      findTrackedSessionById: vi.fn((id: string) => sessions.get(id)),
      fetchServerSessionMetadata: vi.fn(),
      spawnTrackedHappyProcess,
      stat,
      realpath,
      runGit,
      baseEnv: {},
      machineId: MACHINE_ID,
      updateParentMetadata,
    });

    expect(result).toMatchObject({ type: 'error', errorMessage: expect.stringContaining('depth cap') });
    expect(spawnTrackedHappyProcess).not.toHaveBeenCalled();
    expect(stat).not.toHaveBeenCalled();
    expect(realpath).not.toHaveBeenCalled();
    expect(runGit).not.toHaveBeenCalled();
    expect(updateParentMetadata).not.toHaveBeenCalled();
  });

  // Mirrors spawnSessionFromSession.test.ts:167 — depth one below the cap
  // must still succeed.
  it('allows local ancestry depth one below MAX_SPAWN_DEPTH', async () => {
    const sessions = trackedByLocalId(ancestryLinks(MACHINE_ID, MAX_SPAWN_DEPTH - 1));
    const spawnTrackedHappyProcess = vi.fn().mockResolvedValue({ type: 'success', sessionId: 'fork-child-id' });
    const updateParentMetadata = vi.fn().mockResolvedValue(undefined);

    const result = await forkSession({
      parentSessionId: 'parent-local-id',
      worktreePath: '/fork/worktree',
    }, {
      findTrackedSessionById: vi.fn((id: string) => sessions.get(id)),
      fetchServerSessionMetadata: vi.fn(),
      spawnTrackedHappyProcess,
      stat: vi.fn().mockResolvedValue({ isDirectory: () => true }),
      realpath: vi.fn(defaultRealpath),
      runGit: vi.fn(defaultRunGit),
      baseEnv: {},
      machineId: MACHINE_ID,
      updateParentMetadata,
    });

    expect(result).toEqual({ type: 'success', sessionId: 'fork-child-id' });
    expect(spawnTrackedHappyProcess).toHaveBeenCalledTimes(1);
    expect(updateParentMetadata).toHaveBeenCalledTimes(1);
  });

  // updateParentMetadata is awaited WITHOUT a try-catch — failures must
  // propagate through the outer try-catch as a 'Failed to fork session: ' error.
  it('propagates updateParentMetadata rejection through outer try-catch as a fork error', async () => {
    const parent = trackedSession();
    const spawnTrackedHappyProcess = vi.fn().mockResolvedValue({ type: 'success', sessionId: 'fork-child-id' });
    const updateParentMetadata = vi.fn().mockRejectedValue(new Error('persist failed'));

    const result = await forkSession({
      parentSessionId: 'parent-local-id',
      worktreePath: '/fork/worktree',
    }, {
      findTrackedSessionById: vi.fn().mockReturnValue(parent),
      fetchServerSessionMetadata: vi.fn(),
      spawnTrackedHappyProcess,
      stat: vi.fn().mockResolvedValue({ isDirectory: () => true }),
      realpath: vi.fn(defaultRealpath),
      runGit: vi.fn(defaultRunGit),
      baseEnv: {},
      machineId: MACHINE_ID,
      updateParentMetadata,
    });

    expect(result.type).toBe('error');
    if (result.type === 'error') {
      expect(result.errorMessage.startsWith('Failed to fork session: ')).toBe(true);
      expect(result.errorMessage).toContain('persist failed');
    }
    expect(spawnTrackedHappyProcess).toHaveBeenCalledTimes(1);
    expect(updateParentMetadata).toHaveBeenCalledTimes(1);
  });

  // Lock the ForkSessionDeps shape: machineId + updateParentMetadata exist.
  it('ForkSessionDeps requires machineId and updateParentMetadata', () => {
    const deps: ForkSessionDeps = {
      findTrackedSessionById: () => undefined,
      fetchServerSessionMetadata: async () => null,
      spawnTrackedHappyProcess: async () => ({ type: 'error', errorMessage: '' }),
      stat: async () => ({ isDirectory: () => true }),
      realpath: async (p) => p,
      runGit: async () => '',
      baseEnv: {},
      machineId: MACHINE_ID,
      updateParentMetadata: async () => undefined,
    };
    expect(deps.machineId).toBe(MACHINE_ID);
    expect(typeof deps.updateParentMetadata).toBe('function');
  });
});
