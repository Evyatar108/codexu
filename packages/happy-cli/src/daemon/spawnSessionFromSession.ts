import { isAbsolute } from 'node:path';

import type { Metadata } from '@/api/types';
import type { SpawnSessionOptions, SpawnSessionResult, SupportedAgent } from '@/modules/common/registerCommonHandlers';
import { HAPPY_PARENT_SESSION_ID } from '@/utils/envNames';
import type { TrackedSession } from './types';

/**
 * v1 spawn-from-session limits: reparenting is out of scope, cross-machine
 * ancestors are invisible to the daemon-local cycle check, and ancestry depth
 * is capped at 10 parent links.
 */

export const MAX_SPAWN_DEPTH = 10;

export type SpawnFromSessionConfig = {
  agent: SupportedAgent;
  path?: string;
  model?: string;
  permissionMode?: string;
  effortLevel?: string;
  initialMessage?: string;
};

export type SpawnSessionFromSessionOptions = {
  parentLocalId: string;
  machineId: string;
  config: SpawnFromSessionConfig;
};

export type SpawnSessionFromSessionDeps = {
  getTrackedSession: (parentLocalId: string) => TrackedSession | undefined;
  spawnSession: (options: SpawnSessionOptions) => Promise<SpawnSessionResult>;
  updateParentMetadata: (
    parentLocalId: string,
    tracked: TrackedSession,
    patchFn: (metadata: Metadata) => Metadata,
  ) => Promise<void>;
  stat: (path: string) => Promise<{ isDirectory(): boolean }>;
};

export function appendSpawnedChild(metadata: Metadata, childCompositeSid: string): Metadata {
  const existing = Array.isArray(metadata.spawnedChildren) ? metadata.spawnedChildren : [];
  return {
    ...metadata,
    spawnedChildren: existing.includes(childCompositeSid) ? existing : [...existing, childCompositeSid],
  };
}

export function validateSpawnAncestry(
  parentLocalId: string,
  machineId: string,
  getTrackedSession: SpawnSessionFromSessionDeps['getTrackedSession'],
): { type: 'success' } | { type: 'error'; errorMessage: string } {
  let currentLocalId = parentLocalId;
  let depth = 0;

  while (true) {
    const current = getTrackedSession(currentLocalId);
    const parentSessionId = current?.happySessionMetadataFromLocalWebhook?.parentSessionId;
    if (!parentSessionId || typeof parentSessionId !== 'string') {
      return { type: 'success' };
    }

    const separatorIndex = parentSessionId.indexOf(':');
    if (separatorIndex <= 0 || separatorIndex === parentSessionId.length - 1) {
      return { type: 'success' };
    }

    const ancestorMachineId = parentSessionId.slice(0, separatorIndex);
    const ancestorLocalId = parentSessionId.slice(separatorIndex + 1);
    if (ancestorMachineId !== machineId) {
      return { type: 'success' };
    }
    if (ancestorLocalId === currentLocalId) {
      return { type: 'error', errorMessage: `Session ${currentLocalId} metadata parentSessionId references itself.` };
    }

    depth += 1;
    if (depth >= MAX_SPAWN_DEPTH) {
      return { type: 'error', errorMessage: `Spawn ancestry exceeds depth cap of ${MAX_SPAWN_DEPTH}.` };
    }

    currentLocalId = ancestorLocalId;
  }
}

export async function spawnSessionFromSession(
  options: SpawnSessionFromSessionOptions,
  deps: SpawnSessionFromSessionDeps,
): Promise<SpawnSessionResult> {
  const tracked = deps.getTrackedSession(options.parentLocalId);
  if (!tracked) {
    return { type: 'error', errorMessage: `Session ${options.parentLocalId} is not tracked by this daemon.` };
  }

  const parentMetadata = tracked.happySessionMetadataFromLocalWebhook;
  if (!parentMetadata) {
    return { type: 'error', errorMessage: `Session ${options.parentLocalId} has no metadata. Cannot spawn child.` };
  }

  const ancestry = validateSpawnAncestry(options.parentLocalId, options.machineId, deps.getTrackedSession);
  if (ancestry.type === 'error') {
    return ancestry;
  }

  const resolvedPath = options.config.path ?? parentMetadata.path;
  if (!resolvedPath || typeof resolvedPath !== 'string') {
    return { type: 'error', errorMessage: 'Parent session has no path; config.path is required.' };
  }
  if (!isAbsolute(resolvedPath)) {
    return { type: 'error', errorMessage: `Spawn path must be absolute: ${resolvedPath}` };
  }

  try {
    const pathStat = await deps.stat(resolvedPath);
    if (!pathStat.isDirectory()) {
      return { type: 'error', errorMessage: `Spawn path must be an existing directory: ${resolvedPath}` };
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return { type: 'error', errorMessage: `Spawn path must be an existing directory: ${errorMessage}` };
  }

  const parentCompositeSid = `${options.machineId}:${options.parentLocalId}`;
  const spawnResult = await deps.spawnSession({
    directory: resolvedPath,
    approvedNewDirectoryCreation: false,
    agent: options.config.agent,
    environmentVariables: { [HAPPY_PARENT_SESSION_ID]: parentCompositeSid },
    model: options.config.model,
    permissionMode: options.config.permissionMode,
    effortLevel: options.config.effortLevel,
    ...(options.config.initialMessage !== undefined ? { initialMessage: options.config.initialMessage } : {}),
  });

  if (spawnResult.type === 'requestToApproveDirectoryCreation') {
    return { type: 'error', errorMessage: `Directory creation approval is not supported for spawn-from-session: ${spawnResult.directory}` };
  }
  if (spawnResult.type === 'error') {
    return spawnResult;
  }

  const childCompositeSid = `${options.machineId}:${spawnResult.sessionId}`;
  await deps.updateParentMetadata(options.parentLocalId, tracked, metadata => appendSpawnedChild(metadata, childCompositeSid));
  return spawnResult;
}
