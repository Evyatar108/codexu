import type { TunnelConfig } from './types';

export type CreateHostTunnelOptions = {
  port: number;
  machineId: string;
  extraTags?: string[];
};

export type LoadHostTunnelOptions = {
  port: number;
  /**
   * Extra local ports to register + forward on the same Dev Tunnel (Scope A ingest
   * port). Each is registered idempotently via `devtunnel port create`; `devtunnel
   * host` forwards all registered ports.
   */
  additionalPorts?: number[];
  extraTags?: string[];
};

export interface DaemonTunnelProvider {
  createHostTunnel(options: CreateHostTunnelOptions): Promise<TunnelConfig>;
  loadHostTunnel(options: LoadHostTunnelOptions): Promise<TunnelConfig>;
  stop(): void;
}
