import { describe, expect, it, vi } from 'vitest';

import type { Metadata } from '@/api/types';
import { buildDaemonSpawnArgs, createSpawnFromSessionMetadataUpdater } from './runSpawnHelpers';
import type { TrackedSession } from './types';

function trackedSession(): TrackedSession {
  return {
    startedBy: 'daemon',
    happySessionId: 'parent-local',
    happySessionMetadataFromLocalWebhook: {
      path: '/repo/project',
      host: 'host',
      homeDir: '/home/test',
      happyHomeDir: '/home/test/.happy',
      happyLibDir: '/happy/lib',
      happyToolsDir: '/happy/tools',
    },
    encryption: {
      encryptionKey: new Uint8Array([1, 2, 3]),
      encryptionVariant: 'dataKey',
      seq: 9,
      metadataVersion: 11,
      agentStateVersion: 13,
    },
    pid: 123,
  };
}

describe('daemon spawn-from-session wiring helpers', () => {
  it('builds supported child-process runtime argv flags per agent', () => {
    expect(buildDaemonSpawnArgs({ agent: 'claude', model: 'claude-opus', permissionMode: 'plan', effortLevel: 'high' })).toEqual([
      'claude', '--happy-starting-mode', 'remote', '--started-by', 'daemon',
      '--model', 'claude-opus', '--permission-mode', 'plan',
    ]);
    expect(buildDaemonSpawnArgs({ agent: 'codex', model: 'gpt-5.4', permissionMode: 'safe-yolo', effortLevel: 'high' })).toEqual([
      'codex', '--happy-starting-mode', 'remote', '--started-by', 'daemon',
      '--model', 'gpt-5.4', '--permission-mode', 'safe-yolo', '--effort', 'high',
    ]);
    expect(buildDaemonSpawnArgs({ agent: 'gemini', model: 'ignored', permissionMode: 'ignored', effortLevel: 'ignored' })).toEqual([
      'gemini', '--happy-starting-mode', 'remote', '--started-by', 'daemon',
    ]);
    expect(buildDaemonSpawnArgs({ agent: 'codex', permissionMode: 'read-only' })).not.toContain('--model');
    expect(buildDaemonSpawnArgs({ agent: 'claude', initialMessage: 'start here' })).toEqual([
      'claude', '--happy-starting-mode', 'remote', '--started-by', 'daemon', 'start here',
    ]);
  });

  it('updates parent metadata through a short-lived session sync client and closes it', async () => {
    const updateMetadata = vi.fn(async (patchFn: (metadata: Metadata) => Metadata) => {
      expect(patchFn({ path: '/repo', host: 'host', homeDir: '/home', happyHomeDir: '/home/.happy', happyLibDir: '/happy', happyToolsDir: '/happy/tools' })).toMatchObject({
        spawnedChildren: ['machine-1:child'],
      });
    });
    const close = vi.fn();
    const sessionSyncClient = vi.fn(() => ({ updateMetadata, close }));
    const tracked = trackedSession();

    const updateParentMetadata = createSpawnFromSessionMetadataUpdater({ sessionSyncClient } as any);
    await updateParentMetadata('parent-local', tracked, metadata => ({
      ...metadata,
      spawnedChildren: ['machine-1:child'],
    }));

    expect(sessionSyncClient).toHaveBeenCalledWith({
      id: 'parent-local',
      seq: 0,
      metadata: tracked.happySessionMetadataFromLocalWebhook,
      metadataVersion: 11,
      agentState: null,
      agentStateVersion: 13,
      encryptionKey: tracked.encryption!.encryptionKey,
      encryptionVariant: 'dataKey',
    });
    expect(updateMetadata).toHaveBeenCalledTimes(1);
    expect(close).toHaveBeenCalledTimes(1);
  });
});
