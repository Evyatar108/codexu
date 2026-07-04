import { describe, it, expect, vi, beforeEach } from 'vitest';

// M1-S5 / R4a wiring proof. `onDaemonRun` is a behavior-preserving relocation of
// the fork block that used to live inline in `daemon/run.ts`. These tests mock the
// already-isolated `src/daemon/`, `src/tunnel/`, and `src/agentComms/` overlays and
// assert the hook drives them with the exact same arguments / side-effect ordering
// and hands back the same wiring handles the inline block produced.

const h = vi.hoisted(() => ({
  fakeKeypairs: {
    createdEd25519: false,
    ed25519Fingerprint: 'ed25519-fp',
    ed25519PublicKey: 'ed25519-pub',
    ecdhPublicKey: 'ecdh-pub',
    ecdhPrivateKey: 'ecdh-priv',
  },
  // Distinct tunnel/loopback/ingest ports + matching machineId so resolveMachineState
  // returns the persisted state unchanged (no extra writeMachineState from resolution).
  machineState: {
    machineId: 'machine-1',
    tunnelPort: 5001,
    loopbackPort: 5002,
    ingestPort: 5003,
    tunnelId: '',
    lastTunnelUrl: null as string | null,
  },
  tunnelManagerInstance: { __tag: 'tunnelManager' },
  devtunnelsProviderInstance: { __tag: 'devtunnels-provider' },
  deliverRemoteSentinel: Object.assign(vi.fn(), { __tag: 'deliverRemote' }),
  ingestHandlerSentinel: Object.assign(vi.fn(), { __tag: 'ingestHandler' }),
  ingestServerHandle: { port: 5003, stop: vi.fn(async () => {}) },
  bindTunnelConfig: { tunnelId: 'tunnel-1', tunnelUrl: 'https://tunnel-1.example' },
  listenerStop: vi.fn(async () => {}),
}));

vi.mock('@/tofu/keypairManager', () => ({
  loadOrCreateTofuKeypairs: vi.fn(async () => h.fakeKeypairs),
}));
vi.mock('@/utils/pickFreeLoopbackPort', () => ({
  pickFreeLoopbackPort: vi.fn(async () => 6000),
}));
vi.mock('@/persistence', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  readMachineState: vi.fn(async () => h.machineState),
  writeMachineState: vi.fn(async () => {}),
}));
vi.mock('@/agentComms/peerDelivery', () => ({
  createDevTunnelsAgentCommsDeliverRemote: vi.fn(() => h.deliverRemoteSentinel),
}));
vi.mock('@/agentComms/ingestHandler', () => ({
  createAgentCommsIngestHandler: vi.fn(() => h.ingestHandlerSentinel),
}));
vi.mock('@/agentComms/ingestServer', () => ({
  startAgentCommsIngestServer: vi.fn(async () => h.ingestServerHandle),
}));
vi.mock('@/tunnel/tunnelManager', () => ({
  TunnelManager: vi.fn(() => h.tunnelManagerInstance),
}));
vi.mock('@/tunnel/devTunnelsDaemonProvider', () => ({
  DevTunnelsDaemonProvider: vi.fn(() => h.devtunnelsProviderInstance),
}));
vi.mock('@/tunnel/cloudflareTunnelDaemonProvider', () => ({
  CloudflareTunnelDaemonProvider: vi.fn(() => ({ __tag: 'cloudflare-provider' })),
}));
vi.mock('@/tunnel/publicTunnelConfig', () => ({
  isPublicTunnelOptedIn: vi.fn(() => false),
  assertPublicBindReady: vi.fn(),
  buildPublicMode: vi.fn(),
  readPublicTunnelConfig: vi.fn(),
  writePublicPairingInvite: vi.fn(),
}));
vi.mock('@/tunnel/publicPairedDevices', () => ({
  createDeviceEnrollmentPersister: vi.fn(),
  readPublicPairedDevices: vi.fn(),
}));
vi.mock('@/daemon/bindListenersAndWriteCapability', () => ({
  bindListenersAndWriteCapability: vi.fn(async () => ({
    tunnelConfig: h.bindTunnelConfig,
    stop: h.listenerStop,
  })),
}));
vi.mock('@/daemon/loopbackCapability', () => ({
  loopbackCapabilityPath: vi.fn(() => '/fake/happy/loopback-capability.json'),
}));

import { configuration } from '@/configuration';
import { onDaemonRun } from '@/fork/forkHooks';
import { loadOrCreateTofuKeypairs } from '@/tofu/keypairManager';
import { readMachineState, writeMachineState } from '@/persistence';
import { createDevTunnelsAgentCommsDeliverRemote } from '@/agentComms/peerDelivery';
import { createAgentCommsIngestHandler } from '@/agentComms/ingestHandler';
import { startAgentCommsIngestServer } from '@/agentComms/ingestServer';
import { TunnelManager } from '@/tunnel/tunnelManager';
import { DevTunnelsDaemonProvider } from '@/tunnel/devTunnelsDaemonProvider';
import { CloudflareTunnelDaemonProvider } from '@/tunnel/cloudflareTunnelDaemonProvider';
import { isPublicTunnelOptedIn } from '@/tunnel/publicTunnelConfig';
import { bindListenersAndWriteCapability } from '@/daemon/bindListenersAndWriteCapability';

describe('onDaemonRun (M1-S5 / R4a fork daemon wiring hook)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('drives the daemon overlays with the same args as the inline block and returns the wiring handles', async () => {
    const machineId = 'machine-1';
    const hostname = 'test-host';

    const result = await onDaemonRun({ machineId, hostname });

    // TOFU keypairs + machine-state resolution
    expect(loadOrCreateTofuKeypairs).toHaveBeenCalledWith(configuration.happyHomeDir);
    expect(readMachineState).toHaveBeenCalledWith(machineId);

    // Default (non-public) path: Dev Tunnels provider, never Cloudflare.
    expect(isPublicTunnelOptedIn).toHaveBeenCalled();
    expect(CloudflareTunnelDaemonProvider).not.toHaveBeenCalled();
    expect(TunnelManager).toHaveBeenCalledTimes(1);
    expect(DevTunnelsDaemonProvider).toHaveBeenCalledWith({ manager: h.tunnelManagerInstance });

    // Agent-comms remote delivery is wired to the local keypairs + tunnel manager.
    expect(createDevTunnelsAgentCommsDeliverRemote).toHaveBeenCalledWith({
      localKeypairs: h.fakeKeypairs,
      tunnelManager: h.tunnelManagerInstance,
    });

    // Agent-comms ingest handler wiring.
    expect(createAgentCommsIngestHandler).toHaveBeenCalledWith(
      expect.objectContaining({
        happyHomeDir: configuration.happyHomeDir,
        localMachineId: machineId,
        tofuKeypairs: h.fakeKeypairs,
        deliverRemote: h.deliverRemoteSentinel,
        spawnSessionFromSession: expect.any(Function),
      }),
    );

    // Scope A: ingest is served by the happy-cli-owned loopback listener on the
    // resolved ingest port, wired to the ingest handler.
    expect(startAgentCommsIngestServer).toHaveBeenCalledWith({
      port: h.machineState.ingestPort,
      handler: h.ingestHandlerSentinel,
    });

    // Embedded happy-server dual-listener binding.
    expect(bindListenersAndWriteCapability).toHaveBeenCalledTimes(1);
    const [bindArgs, bindHome] = vi.mocked(bindListenersAndWriteCapability).mock.calls[0];
    expect(bindHome).toBe(configuration.happyHomeDir);
    expect(bindArgs.sharedContext.machineKey).toBe(h.fakeKeypairs.ed25519PublicKey);
    expect(bindArgs.sharedContext.localUserId).toBe(machineId);
    expect(bindArgs.sharedContext.tofuPublicKeys).toEqual({
      ed25519PublicKey: h.fakeKeypairs.ed25519PublicKey,
      x25519PublicKey: h.fakeKeypairs.ecdhPublicKey,
      x25519SecretKey: h.fakeKeypairs.ecdhPrivateKey,
      ed25519Fingerprint: h.fakeKeypairs.ed25519Fingerprint,
    });
    // Scope A: agentCommsIngest is NOT injected into the embedded server.
    expect((bindArgs.sharedContext as unknown as Record<string, unknown>).agentCommsIngest).toBeUndefined();
    expect(bindArgs.tunnelProvider).toBe(h.devtunnelsProviderInstance);
    expect(bindArgs.machineInfo).toEqual({ hostname, owner: machineId });
    // Default path binds no public listener.
    expect('publicListener' in bindArgs).toBe(false);

    // Persisted exactly once (post-bind), with the tunnel identity from the binding.
    expect(writeMachineState).toHaveBeenCalledTimes(1);
    expect(writeMachineState).toHaveBeenCalledWith(
      expect.objectContaining({
        machineId,
        tunnelId: h.bindTunnelConfig.tunnelId,
        lastTunnelUrl: h.bindTunnelConfig.tunnelUrl,
      }),
    );

    // Returned wiring handles match what the inline block exposed downstream.
    expect(result.embeddedServerPort).toBe(h.machineState.tunnelPort);
    expect(result.tunnelConfig).toBe(h.bindTunnelConfig);
    expect(result.listenerBinding.tunnelConfig).toBe(h.bindTunnelConfig);
    expect(result.ingestServer).toBe(h.ingestServerHandle);
    expect(result.deliverRemote).toBe(h.deliverRemoteSentinel);
    expect(result.spawnSessionFromSessionHandlerReady).toBeInstanceOf(Promise);
    expect(typeof result.resolveSpawnSessionFromSessionHandler).toBe('function');
  });

  it('binds the ingest listener before the embedded happy-server listeners', async () => {
    const callOrder: string[] = [];
    vi.mocked(startAgentCommsIngestServer).mockImplementationOnce(async () => {
      callOrder.push('ingest');
      return h.ingestServerHandle;
    });
    vi.mocked(bindListenersAndWriteCapability).mockImplementationOnce(async () => {
      callOrder.push('bind');
      return { tunnelConfig: h.bindTunnelConfig, stop: h.listenerStop } as never;
    });

    await onDaemonRun({ machineId: 'machine-1', hostname: 'test-host' });

    expect(callOrder).toEqual(['ingest', 'bind']);
  });

  it('defers spawnSessionFromSession to the daemon handler published via resolveSpawnSessionFromSessionHandler', async () => {
    const spawnResult = { sessionId: 'session-1' } as never;
    const handlerSpy = vi.fn(async () => spawnResult);

    const result = await onDaemonRun({ machineId: 'machine-1', hostname: 'test-host' });

    const ingestArgs = vi.mocked(createAgentCommsIngestHandler).mock.calls[0][0] as {
      spawnSessionFromSession: (options: unknown) => Promise<unknown>;
    };
    const spawnSessionFromSession = ingestArgs.spawnSessionFromSession;

    // Publishing the handler resolves the ready promise the daemon awaits.
    result.resolveSpawnSessionFromSessionHandler(handlerSpy as never);
    await expect(result.spawnSessionFromSessionHandlerReady).resolves.toBe(handlerSpy);

    // Ingest-triggered spawns delegate to the published handler with the same options.
    const options = { requestId: 'req-1' };
    await expect(spawnSessionFromSession(options)).resolves.toBe(spawnResult);
    expect(handlerSpy).toHaveBeenCalledWith(options);
  });
});
