/**
 * Owns one opt-in, spawn-only Copilot read-only mirror session.
 */

import { createEnvelope } from '@slopus/happy-wire';
import { randomUUID } from 'node:crypto';

import { ApiClient } from '@/api/api';
import type { ApiSessionClient } from '@/api/apiSession';
import type { Credentials } from '@/persistence';
import type { Metadata } from '@/api/types';
import { createSessionMetadata } from '@/utils/createSessionMetadata';
import { logger } from '@/ui/logger';

import { CopilotEventRelay } from './eventRelay';
import { stableCopilotId } from './eventProjection';
import { spawnManagedTarget, type ManagedTarget } from './managedServer';
import { NativeLocalRpcClient } from './nativeLocalRpcClient';

type RunCopilotMirrorOptions = {
  credentials: Credentials;
  machineId: string;
  startedBy?: 'daemon' | 'terminal';
};

type CopilotMirrorDependencies = {
  createApi?: (credentials: Credentials) => Promise<ApiClient>;
  spawnTarget?: typeof spawnManagedTarget;
  createNativeClient?: (host: string, port: number) => NativeLocalRpcClient;
};

type MetadataUpdateAnswer =
  | { result: 'success'; metadata: string; version: number }
  | { result: 'version-mismatch'; metadata: string; version: number }
  | { result: 'error'; error?: string };

type BoundedMetadataSocket = {
  timeout(ms: number): {
    emitWithAck(
      event: 'update-metadata',
      body: { sid: string; expectedVersion: number; metadata: string },
    ): Promise<MetadataUpdateAnswer>;
  };
};

type MetadataInternals = {
  socket: BoundedMetadataSocket | null;
  socketReady: Promise<void>;
  metadata: Metadata | null;
  metadataVersion: number;
};

function withDeadline<T>(promise: Promise<T>, timeoutMs: number): Promise<T | undefined> {
  return Promise.race([
    promise,
    new Promise<undefined>((resolve) => {
      const timer = setTimeout(() => resolve(undefined), timeoutMs);
      timer.unref?.();
    }),
  ]);
}

async function updateMetadataBounded(
  session: ApiSessionClient,
  update: (metadata: Metadata) => Metadata,
): Promise<void> {
  const internals = session as unknown as MetadataInternals;
  if (!internals.socket || !internals.metadata) throw new Error('Session metadata socket is unavailable');
  for (let attempt = 0; attempt < 3; attempt++) {
    const updated = update(internals.metadata);
    const answer = await internals.socket.timeout(1_500).emitWithAck('update-metadata', {
      sid: session.sessionId,
      expectedVersion: internals.metadataVersion,
      metadata: JSON.stringify(updated),
    });
    if (answer.result === 'success') {
      internals.metadata = JSON.parse(answer.metadata) as Metadata;
      internals.metadataVersion = answer.version;
      return;
    }
    if (answer.result === 'version-mismatch') {
      internals.metadata = JSON.parse(answer.metadata) as Metadata;
      internals.metadataVersion = answer.version;
      continue;
    }
    throw new Error(answer.error || 'Session metadata update failed');
  }
  throw new Error('Session metadata update did not converge');
}

async function archiveMetadataBounded(session: ApiSessionClient, reason: string): Promise<void> {
  await updateMetadataBounded(session, (metadata) => ({
    ...metadata,
    lifecycleState: 'archived',
    lifecycleStateSince: Date.now(),
    archivedBy: 'cli',
    archiveReason: reason,
  }));
}

async function activateMetadataBounded(session: ApiSessionClient): Promise<void> {
  await updateMetadataBounded(session, (metadata) => {
    const {
      archivedBy: _archivedBy,
      archiveReason: _archiveReason,
      ...active
    } = metadata;
    return {
      ...active,
      lifecycleState: 'running',
      lifecycleStateSince: Date.now(),
    };
  });
}

async function awaitSessionConnected(session: ApiSessionClient): Promise<void> {
  const internals = session as unknown as MetadataInternals & {
    socket: (BoundedMetadataSocket & {
      connected: boolean;
      once(event: 'connect', listener: () => void): void;
      off(event: 'connect', listener: () => void): void;
    }) | null;
  };
  await internals.socketReady;
  if (!internals.socket) throw new Error('Happy session socket was not constructed');
  if (internals.socket.connected) return;
  let onConnect: (() => void) | undefined;
  const connected = await withDeadline(new Promise<boolean>((resolve) => {
    const listener = (): void => {
      internals.socket?.off('connect', listener);
      resolve(true);
    };
    onConnect = listener;
    internals.socket!.once('connect', onConnect);
  }), 10_000);
  if (onConnect) internals.socket.off('connect', onConnect);
  if (!connected) throw new Error('Happy session socket connection timed out');
}

export async function runCopilotMirror(
  options: RunCopilotMirrorOptions,
  dependencies: CopilotMirrorDependencies = {},
): Promise<void> {
  const api = await (dependencies.createApi ?? ApiClient.create)(options.credentials);
  let target: ManagedTarget | null = null;
  let native: NativeLocalRpcClient | null = null;
  let session: ApiSessionClient | null = null;
  let relay: CopilotEventRelay | null = null;
  let finalization: Promise<void> | null = null;
  let stopDelivered = false;
  let activated = false;
  let nativeShutdownObserved = false;
  let quiescing = false;
  let startupResolved = false;
  let resolveStartup!: () => void;
  const startupPromise = new Promise<void>((resolve) => {
    resolveStartup = () => {
      if (!startupResolved) {
        startupResolved = true;
        resolve();
      }
    };
  });
  let resolveNativeShutdown!: () => void;
  const nativeShutdownPromise = new Promise<void>((resolve) => {
    resolveNativeShutdown = resolve;
  });

  const finalizeOnce = (reason: string): Promise<void> => {
    quiescing = true;
    if (finalization) return finalization;
    finalization = (async () => {
      await startupPromise;
      relay?.quiesce();
      if (native && reason !== 'native-shutdown') {
        await withDeadline(native.shutdown().catch(() => undefined), 3_000);
        if (relay && !nativeShutdownObserved) await withDeadline(nativeShutdownPromise, 3_000);
      }
      if (relay && reason !== 'native-shutdown') {
        await relay.drainCurrentDelivery();
      }
      relay?.stop();
      if (session && activated && !stopDelivered) {
        stopDelivered = true;
        const time = Date.now();
        const id = stableCopilotId('copilot-stop', session.sessionId);
        await withDeadline(session.sendSessionProtocolMessageWithDelivery(
          createEnvelope('agent', { t: 'stop' }, {
            id,
            time,
            turn: stableCopilotId('copilot-lifecycle-turn', session.sessionId),
          }),
          { localId: id },
        ), 5_000);
      }
      if (session) {
        if (activated) await archiveMetadataBounded(session, reason).catch((error) => {
          logger.debug('[Copilot] Failed to archive mirror metadata', { category: 'metadata-update', error });
        });
        try {
          session.sendSessionDeath();
        } finally {
          await withDeadline(session.flush().catch(() => undefined), 5_000);
          await session.close().catch(() => undefined);
        }
      }
      native?.close();
      await target?.terminate();
    })();
    return finalization;
  };

  const onSignal = (): void => { void finalizeOnce('controlled-stop'); };
  process.once('SIGINT', onSignal);
  process.once('SIGTERM', onSignal);

  try {
    target = await (dependencies.spawnTarget ?? spawnManagedTarget)();
    if (quiescing) throw new Error('Copilot mirror startup cancelled');
    native = (dependencies.createNativeClient ?? ((host, port) => new NativeLocalRpcClient(host, port)))(
      target.registry.host,
      target.registry.port,
    );
    await native.connect(target.registry.token, target.registry.sessionId, target.registry.copilotVersion);
    if (quiescing) throw new Error('Copilot mirror startup cancelled');

    const { state, metadata: createdMetadata } = createSessionMetadata({
      flavor: 'copilot',
      machineId: options.machineId,
      startedBy: options.startedBy,
      dangerouslySkipPermissions: false,
    });
    const metadata: Metadata = {
      ...createdMetadata,
      lifecycleState: 'archived',
      lifecycleStateSince: Date.now(),
      archivedBy: 'cli',
      archiveReason: 'startup-pending',
    };
    const created = await api.getOrCreateSession({
      tag: `copilot-native-${randomUUID()}`,
      metadata,
      state,
    });
    if (!created) throw new Error('Unable to create Happy Copilot mirror session');
    session = api.sessionSyncClient(created, { rpcProfile: 'mirror-read-only' });
    session.onUserMessage(() => {
      logger.debug('[Copilot] Dropped unexpected inbound phone message', { category: 'read-only-profile' });
    });
    session.rpcHandlerManager.registerHandler('killSession', (params: unknown) => {
      if (params !== undefined
        && (typeof params !== 'object' || params === null || Array.isArray(params)
          || Object.keys(params as Record<string, unknown>).length !== 0)) {
        throw new Error('killSession takes no parameters');
      }
      void finalizeOnce('phone-archive');
      return { success: true, message: 'Archiving Copilot mirror session' };
    });
    await awaitSessionConnected(session);
    await activateMetadataBounded(session);
    activated = true;
    if (quiescing) throw new Error('Copilot mirror startup cancelled');

    relay = new CopilotEventRelay(native, session, process.cwd(), async () => {
      nativeShutdownObserved = true;
      resolveNativeShutdown();
      if (!finalization) await finalizeOnce('native-shutdown');
    });
    const childExit = new Promise<void>((resolve, reject) => {
      target!.child.once('exit', () => {
        if (finalization) resolve();
        else reject(new Error('Copilot managed-server exited'));
      });
      target!.child.once('error', reject);
    });
    resolveStartup();
    await Promise.race([relay.run(), childExit]);
    if (finalization) await finalization;
  } catch (error) {
    resolveStartup();
    const shutdownWasAlreadyInProgress = finalization !== null;
    await finalizeOnce('runtime-failure');
    if (!shutdownWasAlreadyInProgress
      && (!quiescing || (error instanceof Error && error.message !== 'Copilot mirror startup cancelled'))) {
      throw error;
    }
  } finally {
    resolveStartup();
    process.off('SIGINT', onSignal);
    process.off('SIGTERM', onSignal);
  }
}
