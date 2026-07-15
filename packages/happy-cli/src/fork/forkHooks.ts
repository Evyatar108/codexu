// FORK PATCH: [RESTORE-R4-done] fork wiring hooks relocated out of upstream-hot run files (invariant HC-6)
//
// This module is the single fork-owned seam for the wiring that the fork adds
// on top of upstream's agent-loop / daemon entry points. Each `onXxx(...)` hook
// carries the inline fork block that used to live in an upstream-hot file
// (`daemon/run.ts`, `codex/runCodex.ts`, `claude/runClaude.ts`,
// `api/apiMachine.ts`) so those entry files shrink back toward the upstream
// shape and the fork logic lives in one place.
//
// The hook bodies ONLY delegate to the already-isolated overlay modules under
// `src/daemon/`, `src/tunnel/`, and `src/agentComms/` — they carry no new
// behavior. Relocating the call boundary here is behavior-preserving.
//
// Sibling hooks for R4b/R4c:
//   - `onMachineRpc` (this file) — fork daemon RPC-handler registration relocated
//     out of `api/apiMachine.ts`. Kept here beside `onDaemonRun` because it is
//     lightweight (no agent-loop / UI imports) and the daemon already loads this
//     module.
//   - `onCodexRun` (`fork/onCodexRun.ts`) and `onClaudeRun` (`fork/onClaudeRun.ts`)
//     — the codex/claude agent-loop bodies relocated out of `codex/runCodex.ts` /
//     `claude/runClaude.ts`. They live in their OWN fork-owned modules (not this
//     file) on purpose: they pull in `ink`/`react` and the full agent-loop
//     dependency surface, and the daemon imports THIS module for `onDaemonRun` —
//     re-exporting them here would drag that heavy graph into the daemon's
//     startup, which is not behavior-preserving. `runCodex.ts` / `runClaude.ts`
//     import those hooks directly.

import { join } from 'path';

import { logger } from '@/ui/logger';
import { configuration } from '@/configuration';
import { loadOrCreateTofuKeypairs } from '@/tofu/keypairManager';
import { pickFreeLoopbackPort } from '@/utils/pickFreeLoopbackPort';
import { readMachineState, writeMachineState, type MachineLocallyPersistedState } from '@/persistence';
import { createDevTunnelsAgentCommsDeliverRemote } from '@/agentComms/peerDelivery';
import { createAgentCommsIngestHandler } from '@/agentComms/ingestHandler';
import { startAgentCommsIngestServer } from '@/agentComms/ingestServer';
import { TunnelManager } from '@/tunnel/tunnelManager';
import { LocalDaemonProvider } from '@/tunnel/localDaemonProvider';
import { CloudflareTunnelDaemonProvider } from '@/tunnel/cloudflareTunnelDaemonProvider';
import type { DaemonTunnelProvider } from '@/tunnel/provider';
import { assertPublicBindReady, buildPublicMode, isPublicTunnelOptedIn, readPublicTunnelConfig, type PublicMode } from '@/tunnel/publicTunnelConfig';
import { createDeviceEnrollmentPersister, readPublicPairedDevices } from '@/tunnel/publicPairedDevices';
import { readFile } from 'node:fs/promises';
import {
  createPublicPairingInvite,
  encodeLocalPairingInvite,
  encodePublicPairingInvite,
} from '@slopus/happy-wire';
import { bindListenersAndWriteCapability } from '@/daemon/bindListenersAndWriteCapability';
import { loopbackCapabilityPath } from '@/daemon/loopbackCapability';
import { isSupportedAgent } from '@/modules/common/registerCommonHandlers';
import { isValidCodexEffortLevel, isValidCodexRemotePermissionMode } from '@/codex/cliArgs';
import { validateStopSessionId } from '@/daemon/stopTrackedSession';
import type { DualListenerBindingHandle } from '@/daemon/dualListenerBinding';
import type { RpcHandlerManager } from '@/api/rpc/RpcHandlerManager';
import type { ForkSessionOptions, MachineRpcHandlers, SpawnSessionFromSessionRpcOptions } from '@/api/apiMachine';
import type { SpawnSessionResult } from '@/modules/common/registerCommonHandlers';

type AgentCommsIngestServerHandle = Awaited<ReturnType<typeof startAgentCommsIngestServer>>;
type AgentCommsDeliverRemote = ReturnType<typeof createDevTunnelsAgentCommsDeliverRemote>;
type SpawnSessionFromSessionHandler = (options: SpawnSessionFromSessionRpcOptions) => Promise<SpawnSessionResult>;

async function pickDistinctLoopbackPort(taken: number[]): Promise<number> {
  let port = await pickFreeLoopbackPort();
  while (taken.includes(port)) {
    port = await pickFreeLoopbackPort();
  }
  return port;
}

async function resolveMachineState(machineId: string): Promise<MachineLocallyPersistedState> {
  const machineState = await readMachineState(machineId);
  if (machineState) {
    let updated: MachineLocallyPersistedState = machineState;
    let changed = false;
    if (updated.machineId !== machineId) {
      updated = { ...updated, machineId };
      changed = true;
    }
    if (updated.tunnelPort === updated.loopbackPort) {
      const loopbackPort = await pickDistinctLoopbackPort([updated.tunnelPort]);
      updated = { ...updated, loopbackPort };
      changed = true;
    }
    // Scope A: ensure a distinct ingest port. Pins written before Scope A lack it,
    // and a persisted one must not collide with the tunnel/loopback ports.
    if (
      updated.ingestPort === undefined
      || updated.ingestPort === updated.tunnelPort
      || updated.ingestPort === updated.loopbackPort
    ) {
      const ingestPort = await pickDistinctLoopbackPort([updated.tunnelPort, updated.loopbackPort]);
      updated = { ...updated, ingestPort };
      changed = true;
    }
    if (changed) {
      await writeMachineState(updated);
    }
    return updated;
  }

  const tunnelPort = await pickFreeLoopbackPort();
  const loopbackPort = await pickDistinctLoopbackPort([tunnelPort]);
  const ingestPort = await pickDistinctLoopbackPort([tunnelPort, loopbackPort]);
  const created = { machineId, tunnelPort, loopbackPort, ingestPort, tunnelId: '', lastTunnelUrl: null };
  await writeMachineState(created);
  return created;
}

export interface OnDaemonRunOptions {
  /** Resolved machine id from `authAndSetupMachineIfNeeded()`. */
  machineId: string;
  /** Host name to bind the embedded happy-server machine to (`initialMachineMetadata.host`). */
  hostname: string;
}

export interface OnDaemonRunResult {
  /** Embedded happy-server tunnel-listener port (used by the daemon for loopback session queries). */
  embeddedServerPort: number;
  /** Tunnel config produced by the embedded-server dual-listener binding. */
  tunnelConfig: DualListenerBindingHandle['tunnelConfig'];
  /** Handle to stop the embedded-server dual listeners on shutdown. */
  listenerBinding: DualListenerBindingHandle;
  /** Handle to stop the agent-comms ingest listener on shutdown. */
  ingestServer: AgentCommsIngestServerHandle;
  /** Agent-comms remote-delivery function wired to the local tunnel manager + keypairs. */
  deliverRemote: AgentCommsDeliverRemote;
  /** Resolves once the daemon publishes its spawn-session-from-session handler. */
  spawnSessionFromSessionHandlerReady: Promise<SpawnSessionFromSessionHandler>;
  /** Publishes the daemon's spawn-session-from-session handler to the ingest/control planes. */
  resolveSpawnSessionFromSessionHandler: (handler: SpawnSessionFromSessionHandler) => void;
  createPairingInvite: (browserOrigin?: string, publicMode?: boolean) => string;
}

/**
 * Fork daemon wiring: embed the happy-server, select the tunnel provider
 * (Dev Tunnels by default, opt-in Cloudflare public mode), and stand up the
 * agent-comms ingest listener. Upstream's daemon is a thin remote client and
 * does none of this. The body is the verbatim inline block relocated out of
 * `daemon/run.ts` (M1-S5 / R4a); it only delegates to `src/daemon/`,
 * `src/tunnel/`, and `src/agentComms/` overlay bodies, which are unchanged.
 */
export async function onDaemonRun(options: OnDaemonRunOptions): Promise<OnDaemonRunResult> {
  const { machineId, hostname } = options;

  const tofuKeypairs = await loadOrCreateTofuKeypairs(configuration.happyHomeDir);
  if (tofuKeypairs.createdEd25519) {
    console.log(`Happy server Ed25519 fingerprint: ${tofuKeypairs.ed25519Fingerprint}`);
  }

  let machineState = await resolveMachineState(machineId);
  const tunnelManager = new TunnelManager();
  // Provider selection (opt-in only). Default is an offline loopback listener;
  // public provider is chosen ONLY when the operator sets
  // HAPPY_TUNNEL_PROVIDER=cloudflare AND supplies a valid public-tunnel.json.
  let tunnelProvider: DaemonTunnelProvider;
  let publicMode: PublicMode | null = null;
  let refreshPublicPairingInvite: (() => string) | null = null;
  if (isPublicTunnelOptedIn()) {
    const publicTunnelConfig = await readPublicTunnelConfig();
    assertPublicBindReady(publicTunnelConfig);
    const serverUrl = `https://${publicTunnelConfig.hostname}`;
    // Re-seed the verifier with devices pinned in earlier daemon runs so a paired
    // device does not have to re-pair after a restart, and persist any NEW device
    // enrolled via `/pair/complete` during this run.
    const persistedDevices = await readPublicPairedDevices();
    publicMode = buildPublicMode({
      config: publicTunnelConfig,
      serverUrl,
      machineId,
      devices: persistedDevices,
      onDeviceEnrolled: createDeviceEnrollmentPersister(),
    });
    refreshPublicPairingInvite = () => {
      const issuedAt = new Date();
      const invite = createPublicPairingInvite({
        serverUrl,
        machineId,
        cloudflareAccess: publicTunnelConfig.cloudflareAccess.serviceTokens[0]!,
        issuedAt,
        ttlMs: publicTunnelConfig.pairing?.windowMs,
      });
      const pairing = publicMode!.publicAuth.pairing!;
      pairing.secret = invite.pairSecret;
      pairing.windowOpenedAt = issuedAt.getTime();
      pairing.windowClosesAt = Date.parse(invite.expiresAt);
      return encodePublicPairingInvite(invite);
    };
    publicMode.publicAuth.pairing!.windowOpenedAt = 0;
    publicMode.publicAuth.pairing!.windowClosesAt = 0;
    tunnelProvider = new CloudflareTunnelDaemonProvider({
      hostname: publicTunnelConfig.hostname,
      tunnelName: publicTunnelConfig.tunnelName,
    });
    machineState = {
      ...machineState,
      publicListener: {
        hostname: publicTunnelConfig.hostname,
        tunnelName: publicTunnelConfig.tunnelName,
      },
    };
    await writeMachineState(machineState);
    logger.debug(`[DAEMON RUN] Public mode enabled via Cloudflare named tunnel ${publicTunnelConfig.tunnelName} -> ${serverUrl}`);
  } else {
    tunnelProvider = new LocalDaemonProvider();
  }
  const deliverRemote = createDevTunnelsAgentCommsDeliverRemote({
    localKeypairs: tofuKeypairs,
    tunnelManager,
  });
  let resolveSpawnSessionFromSessionHandler!: (handler: SpawnSessionFromSessionHandler) => void;
  const spawnSessionFromSessionHandlerReady = new Promise<SpawnSessionFromSessionHandler>(
    (resolve) => { resolveSpawnSessionFromSessionHandler = resolve; }
  );
  const tofuPublicKeysConfig = {
    ed25519PublicKey: tofuKeypairs.ed25519PublicKey,
    x25519PublicKey: tofuKeypairs.ecdhPublicKey,
    x25519SecretKey: tofuKeypairs.ecdhPrivateKey,
    ed25519Fingerprint: tofuKeypairs.ed25519Fingerprint,
    ed25519SecretKey: tofuKeypairs.ed25519PrivateKey,
  };
  const serverStorageKey = (await readFile(configuration.serverStorageKeyFile, 'utf8')).trim();
  const localDevices = publicMode ? [] : await readPublicPairedDevices(configuration.localPairedDevicesFile);
  const agentCommsIngest = createAgentCommsIngestHandler({
    happyHomeDir: configuration.happyHomeDir,
    localMachineId: machineId,
    tofuKeypairs,
    spawnSessionFromSession: options => spawnSessionFromSessionHandlerReady.then(handler => handler(options)),
    deliverRemote,
  });
  // Scope A: serve agent-comms ingest from a happy-cli-owned loopback listener
  // instead of injecting the handler into the embedded happy-server. The ingest
  // port is forwarded as a second Dev Tunnel port (see resolveMachineState +
  // dualListenerBinding). Bind it before the embedded servers/tunnel so the
  // loopback port is accepting connections before the tunnel forwards it.
  if (machineState.ingestPort === undefined) {
    throw new Error('resolveMachineState did not allocate an agent-comms ingestPort');
  }
  const ingestServer = await startAgentCommsIngestServer({
    port: machineState.ingestPort,
    handler: agentCommsIngest,
  });
  logger.debug(`[DAEMON RUN] Agent-comms ingest listener started on 127.0.0.1:${ingestServer.port}`);
  let listenerBinding: DualListenerBindingHandle;
  try {
    listenerBinding = await bindListenersAndWriteCapability({
      sharedContext: {
        dataDir: configuration.happyHomeDir,
        machineKey: serverStorageKey,
        localUserId: machineId,
        tofuPublicKeys: tofuPublicKeysConfig,
        // agentCommsIngest is intentionally NOT injected here: ingest is served
        // by the happy-cli-owned listener above (Scope A). The embedded server
        // keeps the rest of the mobile+session plane.
      },
      tunnelProvider,
      paths: {
        profile: configuration.localProfileFile,
        accountSettings: join(configuration.happyHomeDir, 'account-settings.json'),
        githubConnection: configuration.githubConnectionFile,
        loopbackCap: loopbackCapabilityPath(configuration.happyHomeDir),
      },
      machineState: () => machineState,
      machineInfo: {
        hostname,
        owner: machineId,
      },
      ...(publicMode
        ? { publicListener: { auth: 'public' as const, publicAuth: publicMode.publicAuth } }
        : {
            localListener: {
              auth: 'local-device' as const,
              localAuth: {
                machineId,
                serverUrl: `http://127.0.0.1:${machineState.tunnelPort}`,
                devices: localDevices,
                onDevicesChanged: async devices => {
                  const persist = createDeviceEnrollmentPersister(configuration.localPairedDevicesFile);
                  const newest = devices.at(-1);
                  if (newest) {
                    await persist(newest, devices);
                  }
                },
              },
            },
          }),
    }, configuration.happyHomeDir);
  } catch (bindError) {
    await ingestServer.stop();
    throw bindError;
  }
  const tunnelConfig = listenerBinding.tunnelConfig;
  machineState = {
    ...machineState,
    tunnelId: tunnelConfig.tunnelId,
    lastTunnelUrl: tunnelConfig.tunnelUrl,
  };
  try {
    await writeMachineState(machineState);
  } catch (writeError) {
    await listenerBinding.stop();
    await ingestServer.stop();
    throw writeError;
  }
  const embeddedServerPort = machineState.tunnelPort;
  logger.debug(`[DAEMON RUN] Embedded happy-server tunnel listener started on 127.0.0.1:${machineState.tunnelPort}`);
  logger.debug(`[DAEMON RUN] Embedded happy-server loopback listener started on 127.0.0.1:${machineState.loopbackPort}`);
  logger.debug(`[DAEMON RUN] Paired-device listener ready at ${tunnelConfig.tunnelUrl}`);

  return {
    embeddedServerPort,
    tunnelConfig,
    listenerBinding,
    ingestServer,
    deliverRemote,
    spawnSessionFromSessionHandlerReady,
    resolveSpawnSessionFromSessionHandler,
    createPairingInvite(browserOrigin, usePublicMode) {
      if (usePublicMode) {
        if (!publicMode) {
          throw new Error('Public pairing is unavailable because public mode is disabled');
        }
        return refreshPublicPairingInvite!();
      }
      if (!browserOrigin) {
        throw new Error('Local pairing requires an exact browser origin');
      }
      return encodeLocalPairingInvite(listenerBinding.createLocalPairingInvite(browserOrigin));
    },
  };
}

// Bounds shared by the spawn-session-from-session / fork-into-worktree RPC
// validators. Relocated verbatim from `api/apiMachine.ts` alongside the handler
// registration body (M1-S7 / R4c-ii).
const PARENT_SESSION_ID_MAX_LENGTH = 128;
const PARENT_SESSION_ID_SHAPE = /^[A-Za-z0-9_-]+$/;

export interface OnMachineRpcContext {
  /** The client's RPC handler manager the fork handlers register against. */
  rpcHandlerManager: RpcHandlerManager;
  /** `this.machine.id` — used to scope spawn-in-worktree / reject cross-machine parents. */
  machineId: string;
  /** The spawn/stop/shutdown handler bundle passed to `setRPCHandlers`. */
  handlers: MachineRpcHandlers;
  /**
   * Late-bound accessor for `this.forkSessionHandler`. The fork-into-worktree
   * handler reads the CURRENT value at RPC-call time (it can be re-assigned after
   * registration), so this must be an accessor closure, not a snapshot.
   */
  getForkSessionHandler: () => ((options: ForkSessionOptions) => Promise<SpawnSessionResult>) | null;
  /** Bound `this.syncResumeSessionRpcRegistration()` — registers/unregisters the resume handler. */
  syncResumeSessionRpcRegistration: () => void;
}

/**
 * Fork machine RPC wiring: register the daemon-side RPC handlers that back the
 * fork's single-machine spawn/fork/stop surface (`spawn-happy-session`,
 * `spawn-in-worktree`, `spawn-session-from-session`, `fork-into-worktree`,
 * `stop-session`, `stop-daemon`, plus the resume-session registration). Upstream's
 * multi-machine model does not have these. The body is the verbatim inline block
 * relocated out of `ApiMachineClient.setRPCHandlers` (M1-S7 / R4c-ii); it only
 * delegates to the caller-supplied handlers + the `@/daemon` / `@/codex` / common
 * validators, which are unchanged.
 */
// FORK PATCH: [RESTORE-R4-done] fork machine RPC-handler registration relocated out of api/apiMachine.ts (invariant HC-7)
export function onMachineRpc(context: OnMachineRpcContext): void {
  const { rpcHandlerManager, machineId, handlers, getForkSessionHandler, syncResumeSessionRpcRegistration } = context;
  const { spawnSession, spawnInWorktree, spawnSessionFromSession, stopSession, requestShutdown } = handlers;

  // Register spawn session handler
  rpcHandlerManager.registerHandler('spawn-happy-session', async (params: any) => {
    const { directory, sessionId, machineId: paramMachineId, approvedNewDirectoryCreation, agent, environmentVariables, token } = params || {};
    logger.debug(`[API MACHINE] Spawning session with params: ${JSON.stringify(params)}`);

    if (!directory) {
      throw new Error('Directory is required');
    }

    const result = await spawnSession({ directory, sessionId, machineId: paramMachineId, approvedNewDirectoryCreation, agent, environmentVariables, token });

    switch (result.type) {
      case 'success':
        logger.debug(`[API MACHINE] Spawned session ${result.sessionId}`);
        return { type: 'success', sessionId: result.sessionId };

      case 'requestToApproveDirectoryCreation':
        logger.debug(`[API MACHINE] Requesting directory creation approval for: ${result.directory}`);
        return { type: 'requestToApproveDirectoryCreation', directory: result.directory };

      case 'error':
        throw new Error(result.errorMessage);
    }
  });

  syncResumeSessionRpcRegistration();

  rpcHandlerManager.registerHandler('spawn-in-worktree', async (params: any) => {
    const { repoPath, worktreePath, runId, agent, token } = params || {};

    if (!isSupportedAgent(agent)) {
      return { type: 'error', errorMessage: 'agent must be one of: claude, codex, gemini, openclaw' };
    }
    if (!repoPath || typeof repoPath !== 'string') {
      return { type: 'error', errorMessage: 'repoPath is required' };
    }
    if (worktreePath !== undefined && worktreePath !== null && typeof worktreePath !== 'string') {
      return { type: 'error', errorMessage: 'worktreePath must be a string when provided' };
    }
    if (runId !== undefined && runId !== null && typeof runId !== 'string') {
      return { type: 'error', errorMessage: 'runId must be a string when provided' };
    }
    if (!spawnInWorktree) {
      return { type: 'error', errorMessage: 'Spawn-in-worktree handler not available' };
    }

    return spawnInWorktree({
      machineId,
      repoPath,
      worktreePath: worktreePath ?? undefined,
      runId: runId ?? undefined,
      agent,
      token,
    });
  });

  rpcHandlerManager.registerHandler('spawn-session-from-session', async (params: any) => {
    const { parentSessionId, config } = params || {};

    if (!parentSessionId || typeof parentSessionId !== 'string') {
      return { type: 'error', errorMessage: 'Parent session ID is required' };
    }
    if (parentSessionId.includes(':')) {
      const [parsedMachineId] = parentSessionId.split(':', 1);
      if (parsedMachineId && parsedMachineId !== machineId) {
        return { type: 'error', errorMessage: 'parent session not on this machine' };
      }
      return { type: 'error', errorMessage: 'parentSessionId must be a bare local session id' };
    }
    if (parentSessionId.length > PARENT_SESSION_ID_MAX_LENGTH || !PARENT_SESSION_ID_SHAPE.test(parentSessionId)) {
      return { type: 'error', errorMessage: 'parentSessionId must be 1-128 characters of [A-Za-z0-9_-]' };
    }
    if (!config || typeof config !== 'object') {
      return { type: 'error', errorMessage: 'config is required' };
    }
    if (!isSupportedAgent(config.agent)) {
      return { type: 'error', errorMessage: 'agent must be one of: claude, codex, gemini, openclaw' };
    }
    for (const field of ['path', 'model', 'permissionMode', 'effortLevel', 'initialMessage'] as const) {
      const value = config[field];
      if (value !== undefined && value !== null && typeof value !== 'string') {
        return { type: 'error', errorMessage: `${field} must be a string when provided` };
      }
    }
    if (config.model === '' || config.permissionMode === '' || config.effortLevel === '') {
      return { type: 'error', errorMessage: 'model, permissionMode, and effortLevel must be non-empty when provided' };
    }
    if (config.effortLevel !== undefined && config.effortLevel !== null && !isValidCodexEffortLevel(config.effortLevel)) {
      return { type: 'error', errorMessage: 'effortLevel must be one of: none, minimal, low, medium, high, xhigh' };
    }

    const handler = spawnSessionFromSession;
    if (!handler) {
      return { type: 'error', errorMessage: 'Spawn-from-session handler not available' };
    }

    return handler({
      parentSessionId,
      config: {
        agent: config.agent,
        path: config.path ?? undefined,
        model: config.model ?? undefined,
        permissionMode: config.permissionMode ?? undefined,
        effortLevel: config.effortLevel ?? undefined,
        initialMessage: config.initialMessage ?? undefined,
      },
    });
  });

  rpcHandlerManager.registerHandler('fork-into-worktree', async (params: any) => {
    const { parentSessionId, worktreePath, model, permissionMode, effortLevel } = params || {};

    if (!parentSessionId || typeof parentSessionId !== 'string') {
      return { type: 'error', errorMessage: 'Parent session ID is required' };
    }
    if (parentSessionId.length > PARENT_SESSION_ID_MAX_LENGTH || !PARENT_SESSION_ID_SHAPE.test(parentSessionId)) {
      return { type: 'error', errorMessage: 'parentSessionId must be 1-128 characters of [A-Za-z0-9_-]' };
    }
    if (!worktreePath || typeof worktreePath !== 'string') {
      return { type: 'error', errorMessage: 'Worktree path is required' };
    }
    if (model !== undefined && model !== null && (typeof model !== 'string' || model.length === 0)) {
      return { type: 'error', errorMessage: 'model must be a non-empty string when provided' };
    }
    if (permissionMode !== undefined && permissionMode !== null && !isValidCodexRemotePermissionMode(permissionMode)) {
      return { type: 'error', errorMessage: 'permissionMode must be one of: default, read-only, safe-yolo, yolo' };
    }
    if (effortLevel !== undefined && effortLevel !== null && !isValidCodexEffortLevel(effortLevel)) {
      return { type: 'error', errorMessage: 'effortLevel must be one of: none, minimal, low, medium, high, xhigh' };
    }

    const handler = getForkSessionHandler();
    if (!handler) {
      return { type: 'error', errorMessage: 'Fork session handler not available' };
    }

    return handler({
      parentSessionId,
      worktreePath,
      model: model ?? undefined,
      permissionMode: permissionMode ?? undefined,
      effortLevel: effortLevel ?? undefined,
    });
  });

  // Register stop session handler
  rpcHandlerManager.registerHandler('stop-session', async (params: any) => {
    const { sessionId } = params || {};

    const validation = validateStopSessionId(sessionId);
    if (!validation.ok) {
      throw new Error(validation.error);
    }

    const success = await stopSession(validation.sessionId);
    if (!success) {
      throw new Error('Session not found or failed to stop');
    }

    logger.debug(`[API MACHINE] Stopped session ${validation.sessionId}`);
    return { message: 'Session stopped' };
  });

  // Register stop daemon handler
  rpcHandlerManager.registerHandler('stop-daemon', () => {
    logger.debug('[API MACHINE] Received stop-daemon RPC request');

    // Trigger shutdown callback after a delay
    setTimeout(() => {
      logger.debug('[API MACHINE] Initiating daemon shutdown from RPC');
      requestShutdown();
    }, 100);

    return { message: 'Daemon stop request acknowledged, starting shutdown sequence...' };
  });
}
