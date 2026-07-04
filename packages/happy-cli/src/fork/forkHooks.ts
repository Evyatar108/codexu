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
// Sibling hooks R4b/R4c (`onCodexRun`, `onClaudeRun`, `onMachineRpc`) will be
// added alongside `onDaemonRun` as those stories land; keep the module additive.

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
import { DevTunnelsDaemonProvider } from '@/tunnel/devTunnelsDaemonProvider';
import { CloudflareTunnelDaemonProvider } from '@/tunnel/cloudflareTunnelDaemonProvider';
import type { DaemonTunnelProvider } from '@/tunnel/provider';
import { assertPublicBindReady, buildPublicMode, isPublicTunnelOptedIn, readPublicTunnelConfig, writePublicPairingInvite, type PublicMode } from '@/tunnel/publicTunnelConfig';
import { createDeviceEnrollmentPersister, readPublicPairedDevices } from '@/tunnel/publicPairedDevices';
import { bindListenersAndWriteCapability } from '@/daemon/bindListenersAndWriteCapability';
import { loopbackCapabilityPath } from '@/daemon/loopbackCapability';
import type { DualListenerBindingHandle } from '@/daemon/dualListenerBinding';
import type { SpawnSessionFromSessionRpcOptions } from '@/api/apiMachine';
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
  // Provider selection (opt-in only). Default stays Dev Tunnels; the Cloudflare
  // public provider is chosen ONLY when the operator sets
  // HAPPY_TUNNEL_PROVIDER=cloudflare AND supplies a valid public-tunnel.json.
  let tunnelProvider: DaemonTunnelProvider;
  let publicMode: PublicMode | null = null;
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
    const inviteToken = await writePublicPairingInvite(configuration.publicPairingInviteFile, publicMode.invite);
    logger.debug(`[DAEMON RUN] Public mode enabled via Cloudflare named tunnel ${publicTunnelConfig.tunnelName} -> ${serverUrl}`);
    console.log(`Happy public pairing invite (machine ${machineId}, expires ${publicMode.invite.expiresAt}):`);
    console.log(inviteToken);
  } else {
    tunnelProvider = new DevTunnelsDaemonProvider({ manager: tunnelManager });
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
  };
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
        machineKey: tofuKeypairs.ed25519PublicKey,
        localUserId: machineId,
        tofuPublicKeys: tofuPublicKeysConfig,
        // agentCommsIngest is intentionally NOT injected here: ingest is served
        // by the happy-cli-owned listener above (Scope A). The embedded server
        // keeps the rest of the mobile+session plane.
      },
      tunnelProvider,
      paths: {
        profile: join(configuration.happyHomeDir, 'profile.json'),
        accountSettings: join(configuration.happyHomeDir, 'account-settings.json'),
        loopbackCap: loopbackCapabilityPath(configuration.happyHomeDir),
      },
      machineState: () => machineState,
      machineInfo: {
        hostname,
        owner: machineId,
      },
      ...(publicMode ? { publicListener: { auth: 'public' as const, publicAuth: publicMode.publicAuth } } : {}),
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
  logger.debug(`[DAEMON RUN] Dev Tunnel host started for ${tunnelConfig.tunnelUrl}`);

  return {
    embeddedServerPort,
    tunnelConfig,
    listenerBinding,
    ingestServer,
    deliverRemote,
    spawnSessionFromSessionHandlerReady,
    resolveSpawnSessionFromSessionHandler,
  };
}
