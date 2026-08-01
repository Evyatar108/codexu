/**
 * Owns one opt-in, spawn-only Copilot read-only mirror session.
 */

import {
  createEnvelope,
  STEERING_RELAY_CALLER_KEY,
  steeringCommandEnvelopeSchema,
  steeringRelayCallerSchema,
} from '@slopus/happy-wire';
import { randomUUID } from 'node:crypto';

import { ApiClient } from '@/api/api';
import type { ApiSessionClient } from '@/api/apiSession';
import type { Credentials } from '@/persistence';
import type { Metadata } from '@/api/types';
import { createSessionMetadata } from '@/utils/createSessionMetadata';
import { logger } from '@/ui/logger';

import { CopilotEventRelay } from './eventRelay';
import { stableCopilotId } from './eventProjection';
import {
  ManagedTargetTerminationUnconfirmedError,
  spawnManagedTarget,
  type ManagedTarget,
} from './managedServer';
import { NativeLocalRpcClient } from './nativeLocalRpcClient';
import {
  CopilotPhoneSteeringBroker,
  CopilotSteeringClient,
  type CopilotLeaseState,
} from './steeringClient';
import type { EvCopilotHappyLaunchContextV1 } from './launchContext';
import {
  launchContextProvenance,
  markLaunchCompleted,
  markLaunchFailedBeforeOwnership,
  markLaunchOwned,
} from './launchContext';

type RunCopilotMirrorOptions = {
  credentials: Credentials;
  machineId: string;
  startedBy?: 'daemon' | 'terminal';
  launchContext?: EvCopilotHappyLaunchContextV1;
};

type CopilotMirrorDependencies = {
  createApi?: (credentials: Credentials) => Promise<ApiClient>;
  spawnTarget?: typeof spawnManagedTarget;
  createNativeClient?: (host: string, port: number) => NativeLocalRpcClient;
  markOwned?: typeof markLaunchOwned;
  markCompleted?: typeof markLaunchCompleted;
  markFailedBeforeOwnership?: typeof markLaunchFailedBeforeOwnership;
  ownershipRetrySleep?: () => Promise<void>;
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

async function cleanupStage(
  name: string,
  action: () => void | Promise<unknown>,
  timeoutMs = 5_000,
): Promise<void> {
  let completed = false;
  try {
    await Promise.race([
      Promise.resolve().then(action).then(() => {
        completed = true;
      }),
      new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, timeoutMs);
        timer.unref?.();
      }),
    ]);
    if (!completed) throw new Error(`Cleanup stage timed out: ${name}`);
  } catch {
    try {
      logger.debug('[Copilot] Cleanup stage failed', { category: 'cleanup', stage: name });
    } catch {
      // Cleanup diagnostics must never interrupt later release stages.
    }
  }
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
  let steering: CopilotSteeringClient | null = null;
  let phoneSteering: CopilotPhoneSteeringBroker | null = null;
  let detachSteeringState: (() => void) | null = null;
  let finalization: Promise<void> | null = null;
  let terminationFailure: ManagedTargetTerminationUnconfirmedError | null = null;
  let stopDelivered = false;
  let activated = false;
  let nativeShutdownObserved = false;
  let quiescing = false;
  let startupResolved = false;
  let ownershipWritten = false;
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
  let resolveFinalizationComplete!: () => void;
  const finalizationCompletePromise = new Promise<void>((resolve) => {
    resolveFinalizationComplete = resolve;
  });
  const persistOwned = dependencies.markOwned ?? markLaunchOwned;
  const persistCompleted = dependencies.markCompleted ?? markLaunchCompleted;
  const persistFailedBeforeOwnership = dependencies.markFailedBeforeOwnership
    ?? markLaunchFailedBeforeOwnership;
  const ownershipRetrySleep = dependencies.ownershipRetrySleep
    ?? (() => new Promise<void>((resolve) => setTimeout(resolve, 250)));

  const persistOwnershipBeforeReturn = async (targetPid: number): Promise<void> => {
    if (!options.launchContext || ownershipWritten) return;
    let loggedFailure = false;
    while (!ownershipWritten) {
      try {
        await persistOwned(options.launchContext, targetPid);
        ownershipWritten = true;
      } catch {
        if (!loggedFailure) {
          loggedFailure = true;
          try {
            logger.debug('[Copilot] Ownership status persistence failed; retaining target', {
              category: 'ownership',
            });
          } catch {
            // Diagnostics cannot make a live target eligible for fallback.
          }
        }
        await ownershipRetrySleep();
      }
    }
  };

  const finalizeOnce = (reason: string): Promise<void> => {
    quiescing = true;
    if (finalization) return finalization;
    finalization = (async () => {
      await startupPromise;
      relay?.quiesce();
      if (native && reason !== 'native-shutdown') {
        await cleanupStage('native-shutdown-request', () => native!.shutdown(), 3_000);
        if (relay && !nativeShutdownObserved) {
          await cleanupStage('native-shutdown-observation', () => nativeShutdownPromise, 3_000);
        }
      }
      if (relay && reason !== 'native-shutdown') {
        await cleanupStage('active-delivery-drain', () => relay!.drainCurrentDelivery(), 5_000);
      }
      relay?.stop();
      detachSteeringState?.();
      detachSteeringState = null;
      steering?.dispose();
      if (session && activated && !stopDelivered) {
        stopDelivered = true;
        const time = Date.now();
        const sessionId = session.sessionId;
        const id = stableCopilotId('copilot-stop', sessionId);
        await cleanupStage('stop-delivery', () => session!.sendSessionProtocolMessageWithDelivery(
          createEnvelope('agent', { t: 'stop' }, {
            id,
            time,
            turn: stableCopilotId('copilot-lifecycle-turn', sessionId),
          }),
          { localId: id },
        ), 5_000);
      }
      if (session) {
        if (activated) {
          await cleanupStage('metadata-archive', () => archiveMetadataBounded(session!, reason), 5_000);
        }
        await cleanupStage('session-death', () => session!.sendSessionDeath());
        await cleanupStage('session-flush', () => session!.flush(), 5_000);
        await cleanupStage('session-close', () => session!.close(), 5_000);
      }
      await cleanupStage('native-client-close', () => native?.close());
      try {
        await target?.terminate();
      } catch (error) {
        try {
          logger.debug('[Copilot] Cleanup stage failed', {
            category: 'cleanup',
            stage: 'managed-child-terminate',
          });
        } catch {
          // Diagnostics cannot obscure termination ownership.
        }
        if (error instanceof ManagedTargetTerminationUnconfirmedError) {
          terminationFailure = error;
          throw error;
        }
      }
    })().finally(resolveFinalizationComplete);
    return finalization;
  };

  const onSignal = (): void => { void finalizeOnce('controlled-stop'); };
  process.once('SIGINT', onSignal);
  process.once('SIGTERM', onSignal);

  try {
    target = await (dependencies.spawnTarget ?? spawnManagedTarget)({
      launch: options.launchContext ? {
        executable: options.launchContext.evCopilot.executablePath,
        fixedArguments: options.launchContext.evCopilot.fixedArguments,
        packageVersion: options.launchContext.evCopilot.packageVersion,
        edition: options.launchContext.evCopilot.edition,
      } : undefined,
    });
    if (quiescing) throw new Error('Copilot mirror startup cancelled');
    native = (dependencies.createNativeClient ?? ((host, port) => new NativeLocalRpcClient(host, port)))(
      target.registry.host,
      target.registry.port,
    );
    await native.connect(target.registry.token, target.registry.sessionId, target.registry.copilotVersion);
    steering = new CopilotSteeringClient(native);
    await steering.start();
    phoneSteering = new CopilotPhoneSteeringBroker(steering);
    if (quiescing) throw new Error('Copilot mirror startup cancelled');
    if (options.launchContext) {
      await persistOwnershipBeforeReturn(target.child.pid!);
    }

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
      ...(options.launchContext
        ? { copilotIntegration: launchContextProvenance(options.launchContext) }
        : {}),
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
    const steeringRequest = (params: unknown): {
      connectionId: string;
      body: Record<string, unknown>;
    } => {
      if (typeof params !== 'object' || params === null || Array.isArray(params)) {
        throw new Error('Steering RPC parameters must be an object');
      }
      const source = params as Record<string, unknown>;
      const caller = steeringRelayCallerSchema.parse(source[STEERING_RELAY_CALLER_KEY]);
      const body = { ...source };
      delete body[STEERING_RELAY_CALLER_KEY];
      return { connectionId: caller.connectionId, body };
    };
    session.rpcHandlerManager.registerHandler('happy.attach', (params: unknown) => {
      const { connectionId } = steeringRequest(params);
      return phoneSteering!.attach(connectionId);
    });
    session.rpcHandlerManager.registerHandler('happy.requestLease', (params: unknown) => {
      const { connectionId } = steeringRequest(params);
      return phoneSteering!.requestLease(connectionId);
    });
    session.rpcHandlerManager.registerHandler('happy.heartbeat', (params: unknown) => {
      const { connectionId } = steeringRequest(params);
      return phoneSteering!.heartbeat(connectionId);
    });
    session.rpcHandlerManager.registerHandler('happy.releaseLease', (params: unknown) => {
      const { connectionId } = steeringRequest(params);
      return phoneSteering!.releaseLease(connectionId);
    });
    session.rpcHandlerManager.registerHandler('happy.getControlState', (params: unknown) => {
      const { connectionId } = steeringRequest(params);
      return phoneSteering!.getControlState(connectionId);
    });
    session.rpcHandlerManager.registerHandler('happy.relayCallerDisconnected', (params: unknown) => {
      const { connectionId } = steeringRequest(params);
      return phoneSteering!.invalidateConnection(connectionId).then(() => ({ outcome: 'applied' as const }));
    });
    session.rpcHandlerManager.registerHandler('happy.answerPrompt', (params: unknown) => {
      const { connectionId, body } = steeringRequest(params);
      const command = steeringCommandEnvelopeSchema.parse(body);
      if (command.sessionId !== session!.sessionId) {
        throw new Error('Steering command sessionId does not match the Happy session');
      }
      return phoneSteering!.answerPrompt(connectionId, command);
    });
    await awaitSessionConnected(session);
    await activateMetadataBounded(session);
    activated = true;
    const publishSteeringState = (state: CopilotLeaseState): void => {
      const id = randomUUID();
      const ev = state.status === 'active'
        ? {
          t: 'copilot-control' as const,
          state: 'active' as const,
          leaseId: state.leaseId,
          expiresAt: state.expiresAt,
          heartbeatIntervalMs: state.heartbeatIntervalMs,
          leaseTtlMs: state.leaseTtlMs,
        }
        : state.status === 'requested'
          ? {
            t: 'copilot-control' as const,
            state: 'requested' as const,
            ...(state.requestId ? { requestId: state.requestId } : {}),
          }
          : {
            t: 'copilot-control' as const,
            state: 'no-lease' as const,
            ...(state.reason ? { reason: state.reason } : {}),
          };
      void session!.sendSessionProtocolMessageWithDelivery(
        createEnvelope('agent', ev, { id }),
        { localId: id },
      ).catch(() => undefined);
    };
    detachSteeringState = steering.onStateChange(publishSteeringState);
    publishSteeringState(steering.getState());
    if (quiescing) throw new Error('Copilot mirror startup cancelled');

    relay = new CopilotEventRelay(native, session, process.cwd(), async () => {
      nativeShutdownObserved = true;
      resolveNativeShutdown();
      if (!finalization) await finalizeOnce('native-shutdown');
    }, async () => {
      phoneSteering!.invalidateOwner();
      await steering!.attachAndResync();
    }, (event) => steering!.observeNativeEvent(event));
    const childExit = new Promise<void>((resolve, reject) => {
      target!.child.once('exit', () => {
        if (finalization) resolve();
        else reject(new Error('Copilot managed-server exited'));
      });
      target!.child.once('error', reject);
    });
    resolveStartup();
    await Promise.race([relay.run(), childExit, finalizationCompletePromise]);
    if (finalization) await finalization;
    if (terminationFailure) throw terminationFailure;
    if (options.launchContext && ownershipWritten && !terminationFailure) {
      await persistCompleted(options.launchContext, { exitCode: 0 });
    }
  } catch (error) {
    resolveStartup();
    const shutdownWasAlreadyInProgress = finalization !== null;
    let terminationError = error instanceof ManagedTargetTerminationUnconfirmedError
      ? error
      : null;
    try {
      await finalizeOnce('runtime-failure');
    } catch (cleanupError) {
      if (cleanupError instanceof ManagedTargetTerminationUnconfirmedError) {
        terminationError = cleanupError;
      }
    }
    if (options.launchContext) {
      if (terminationError && !ownershipWritten) {
        await persistOwnershipBeforeReturn(terminationError.targetPid);
      }
      const recordFailure = terminationError
        ? persistCompleted(options.launchContext, {
          exitCode: 1,
          failureCode: 'termination-unconfirmed',
        })
        : ownershipWritten
          ? persistCompleted(options.launchContext, { exitCode: 1, failureCode: 'runtime-failure' })
          : persistFailedBeforeOwnership(options.launchContext, 'startup-failure');
      await recordFailure.catch(() => undefined);
    }
    if (!shutdownWasAlreadyInProgress
      && (!quiescing || (error instanceof Error && error.message !== 'Copilot mirror startup cancelled'))) {
      throw terminationError ?? error;
    }
  } finally {
    resolveStartup();
    process.off('SIGINT', onSignal);
    process.off('SIGTERM', onSignal);
  }
}
