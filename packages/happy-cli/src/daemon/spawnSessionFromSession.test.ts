import { describe, expect, it, vi } from 'vitest';

import type { Metadata } from '@/api/types';
import { HAPPY_PARENT_SESSION_ID } from '@/utils/envNames';
import type { TrackedSession } from './types';
import { appendSpawnedChild, spawnSessionFromSession } from './spawnSessionFromSession';

function metadata(overrides: Partial<Metadata> = {}): Metadata {
  return {
    path: '/repo/project',
    host: 'host',
    homeDir: '/home/test',
    happyHomeDir: '/home/test/.happy',
    happyLibDir: '/happy/lib',
    happyToolsDir: '/happy/tools',
    flavor: 'codex',
    ...overrides,
  };
}

function tracked(parentMetadata: Metadata = metadata()): TrackedSession {
  return {
    startedBy: 'daemon',
    happySessionId: 'parent-local',
    happySessionMetadataFromLocalWebhook: parentMetadata,
    encryption: {
      encryptionKey: new Uint8Array([1, 2, 3]),
      encryptionVariant: 'legacy',
      seq: 1,
      metadataVersion: 2,
      agentStateVersion: 3,
    },
    pid: 42,
  };
}

describe('spawnSessionFromSession', () => {
  it('spawns a child with parent env, runtime config, and parent path default', async () => {
    const parent = tracked();
    const spawnSession = vi.fn().mockResolvedValue({ type: 'success', sessionId: 'child-local' });
    const updateParentMetadata = vi.fn().mockResolvedValue(undefined);

    const result = await spawnSessionFromSession({
      parentLocalId: 'parent-local',
      machineId: 'machine-1',
      config: {
        agent: 'codex',
        model: 'gpt-5.4',
        permissionMode: 'safe-yolo',
        effortLevel: 'high',
      },
    }, {
      getTrackedSession: vi.fn().mockReturnValue(parent),
      spawnSession,
      updateParentMetadata,
      stat: vi.fn().mockResolvedValue({ isDirectory: () => true }),
    });

    expect(result).toEqual({ type: 'success', sessionId: 'child-local' });
    expect(spawnSession).toHaveBeenCalledWith({
      directory: '/repo/project',
      approvedNewDirectoryCreation: false,
      agent: 'codex',
      environmentVariables: { [HAPPY_PARENT_SESSION_ID]: 'machine-1:parent-local' },
      model: 'gpt-5.4',
      permissionMode: 'safe-yolo',
      effortLevel: 'high',
    });
    expect(updateParentMetadata).toHaveBeenCalledTimes(1);
  });

  it('rejects missing parent path, relative path, and non-directory path before spawning', async () => {
    for (const [parentMetadata, stat] of [
      [metadata({ path: '' }), vi.fn()],
      [metadata({ path: 'relative/path' }), vi.fn()],
      [metadata({ path: '/repo/file.txt' }), vi.fn().mockResolvedValue({ isDirectory: () => false })],
    ] as const) {
      const spawnSession = vi.fn();
      const updateParentMetadata = vi.fn();

      const result = await spawnSessionFromSession({
        parentLocalId: 'parent-local',
        machineId: 'machine-1',
        config: { agent: 'claude' },
      }, {
        getTrackedSession: vi.fn().mockReturnValue(tracked(parentMetadata)),
        spawnSession,
        updateParentMetadata,
        stat,
      });

      expect(result.type).toBe('error');
      expect(spawnSession).not.toHaveBeenCalled();
      expect(updateParentMetadata).not.toHaveBeenCalled();
    }
  });

  it('returns error without spawning when parent is not tracked', async () => {
    const spawnSession = vi.fn();
    const updateParentMetadata = vi.fn();

    const result = await spawnSessionFromSession({
      parentLocalId: 'missing',
      machineId: 'machine-1',
      config: { agent: 'claude' },
    }, {
      getTrackedSession: vi.fn().mockReturnValue(undefined),
      spawnSession,
      updateParentMetadata,
      stat: vi.fn(),
    });

    expect(result.type).toBe('error');
    expect(spawnSession).not.toHaveBeenCalled();
    expect(updateParentMetadata).not.toHaveBeenCalled();
  });

  it('converts directory-creation approval requests to error envelopes', async () => {
    const updateParentMetadata = vi.fn();

    const result = await spawnSessionFromSession({
      parentLocalId: 'parent-local',
      machineId: 'machine-1',
      config: { agent: 'claude', path: '/repo/child' },
    }, {
      getTrackedSession: vi.fn().mockReturnValue(tracked()),
      spawnSession: vi.fn().mockResolvedValue({ type: 'requestToApproveDirectoryCreation', directory: '/repo/child' }),
      updateParentMetadata,
      stat: vi.fn().mockResolvedValue({ isDirectory: () => true }),
    });

    expect(result).toMatchObject({ type: 'error', errorMessage: expect.stringContaining('not supported') });
    expect(updateParentMetadata).not.toHaveBeenCalled();
  });

  it('metadata patch appends and dedupes child composite sid while preserving existing children', () => {
    expect(appendSpawnedChild(metadata({ spawnedChildren: ['machine-1:older'] }), 'machine-1:child')).toMatchObject({
      spawnedChildren: ['machine-1:older', 'machine-1:child'],
    });
    expect(appendSpawnedChild(metadata({ spawnedChildren: ['machine-1:child'] }), 'machine-1:child')).toMatchObject({
      spawnedChildren: ['machine-1:child'],
    });
  });
});
