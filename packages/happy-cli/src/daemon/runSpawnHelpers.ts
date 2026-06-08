import type { ApiClient } from '@/api/api';
import type { Metadata } from '@/api/types';
import type { SpawnSessionOptions, SupportedAgent } from '@/modules/common/registerCommonHandlers';
import type { TrackedSession } from './types';

function daemonAgentCommand(agent: SupportedAgent | undefined): SupportedAgent {
  switch (agent) {
    case 'claude':
    case undefined:
      return 'claude';
    case 'codex':
      return 'codex';
    case 'gemini':
      return 'gemini';
    case 'openclaw':
      return 'openclaw';
    default:
      throw new Error(`Unsupported agent type: ${String(agent)}`);
  }
}

export function daemonSpawnWindowName(agent: SupportedAgent | undefined): string {
  return `happy-${Date.now()}-${daemonAgentCommand(agent)}`;
}

export function buildDaemonSpawnArgs(options: Pick<SpawnSessionOptions, 'agent' | 'model' | 'permissionMode' | 'effortLevel' | 'initialMessage'>): string[] {
  const agentCommand = daemonAgentCommand(options.agent);
  const args = [agentCommand, '--happy-starting-mode', 'remote', '--started-by', 'daemon'];

  if ((agentCommand === 'claude' || agentCommand === 'codex') && options.model) {
    args.push('--model', options.model);
  }
  if ((agentCommand === 'claude' || agentCommand === 'codex') && options.permissionMode) {
    args.push('--permission-mode', options.permissionMode);
  }
  if (agentCommand === 'codex' && options.effortLevel) {
    args.push('--effort', options.effortLevel);
  }
  if (options.initialMessage) {
    args.push(options.initialMessage);
  }

  return args;
}

export function createSpawnFromSessionMetadataUpdater(api: Pick<ApiClient, 'sessionSyncClient'>) {
  return async (
    parentLocalId: string,
    tracked: TrackedSession,
    patchFn: (metadata: Metadata) => Metadata,
  ): Promise<void> => {
    if (!tracked.happySessionMetadataFromLocalWebhook || !tracked.encryption) {
      throw new Error(`Session ${parentLocalId} has no metadata/encryption for metadata update.`);
    }

    const client = api.sessionSyncClient({
      id: parentLocalId,
      seq: 0,
      metadata: tracked.happySessionMetadataFromLocalWebhook,
      metadataVersion: tracked.encryption.metadataVersion,
      agentState: null,
      agentStateVersion: tracked.encryption.agentStateVersion,
      encryptionKey: tracked.encryption.encryptionKey,
      encryptionVariant: tracked.encryption.encryptionVariant,
    });

    try {
      await client.updateMetadata(patchFn);
    } finally {
      await client.close();
    }
  };
}
