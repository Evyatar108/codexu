import type { CreateAppConfig, HappyServerHandle, HappyServerSharedContext, PublicAuthConfig } from 'happy-server';

import type { MachineLocallyPersistedState } from '@/persistence';
import type { DaemonTunnelProvider } from '@/tunnel/provider';
import type { TunnelConfig } from '@/tunnel/types';

type CreateAppFactory = (config: CreateAppConfig) => HappyServerHandle;
type HappyServerModule = { createApp: CreateAppFactory };
const importHappyServer = new Function('specifier', 'return import(specifier)') as (specifier: string) => Promise<HappyServerModule>;

export type DualListenerPaths = {
  profile: string;
  accountSettings: string;
  loopbackCap: string;
};

export type DualListenerBindingOptions = {
  sharedContext: HappyServerSharedContext;
  tunnelProvider: DaemonTunnelProvider;
  paths: DualListenerPaths;
  machineState: () => MachineLocallyPersistedState;
  machineInfo?: {
    hostname: string;
    owner: string;
  };
  /**
   * When present, the outbound (tunnel) listener is bound in `auth:"public"` mode
   * with the given fail-closed device verifier + edge config instead of the default
   * `auth:"tunnel"`. Only set when the operator opted into the Cloudflare public
   * provider. The embedded server still binds 127.0.0.1 (cloudflared forwards the
   * public hostname to loopback), so the server-side operator-identity gate is
   * satisfied even before the first device is paired.
   */
  publicListener?: {
    auth: 'public';
    publicAuth: PublicAuthConfig;
  };
  createAppFactory?: CreateAppFactory;
};

export type DualListenerBindingHandle = {
  tunnel: HappyServerHandle;
  loopback: HappyServerHandle;
  tunnelConfig: TunnelConfig;
  stop: () => Promise<void>;
};

export async function dualListenerBinding(options: DualListenerBindingOptions): Promise<DualListenerBindingHandle> {
  const state = options.machineState();
  const additionalPorts = state.ingestPort ? [state.ingestPort] : [];
  const tunnelConfig = await options.tunnelProvider.loadHostTunnel(
    additionalPorts.length > 0
      ? { port: state.tunnelPort, additionalPorts }
      : { port: state.tunnelPort },
  );
  const create = options.createAppFactory ?? (await importHappyServer('happy-server')).createApp;
  const machineState = () => {
    const current = options.machineState();
    return {
      machineId: current.machineId,
      hostname: options.machineInfo?.hostname ?? current.machineId,
      tunnelPort: current.tunnelPort,
      loopbackPort: current.loopbackPort,
      tunnelUrl: current.lastTunnelUrl ?? tunnelConfig.tunnelUrl,
      lastSeenAt: Date.now(),
      owner: options.machineInfo?.owner ?? current.machineId,
    };
  };
  const shared = {
    ...options.sharedContext,
    publicUrl: tunnelConfig.tunnelUrl,
  };
  const tunnel = create({
    ...shared,
    port: state.tunnelPort,
    auth: options.publicListener?.auth ?? 'tunnel',
    ...(options.publicListener ? { publicAuth: options.publicListener.publicAuth } : {}),
    paths: options.paths,
    machineState,
  });
  const loopback = create({
    ...shared,
    port: state.loopbackPort,
    auth: 'loopback',
    paths: options.paths,
    machineState,
  });

  try {
    await tunnel.start();
    await loopback.start();
  } catch (error) {
    await Promise.allSettled([tunnel.stop(), loopback.stop()]);
    options.tunnelProvider.stop();
    throw error;
  }

  return {
    tunnel,
    loopback,
    tunnelConfig,
    async stop() {
      await Promise.allSettled([loopback.stop(), tunnel.stop()]);
      options.tunnelProvider.stop();
    },
  };
}
