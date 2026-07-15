import type { CreateHostTunnelOptions, DaemonTunnelProvider, LoadHostTunnelOptions } from './provider';
import type { TunnelConfig } from './types';

/** A no-network provider for the default paired-device loopback listener. */
export class LocalDaemonProvider implements DaemonTunnelProvider {
  async createHostTunnel(options: CreateHostTunnelOptions): Promise<TunnelConfig> {
    return this.createConfig(options.port);
  }

  async loadHostTunnel(options: LoadHostTunnelOptions): Promise<TunnelConfig> {
    return this.createConfig(options.port);
  }

  stop(): void {}

  private createConfig(port: number): TunnelConfig {
    const now = new Date().toISOString();
    return {
      tunnelId: 'local-loopback',
      tunnelName: 'local-loopback',
      tunnelUrl: `http://127.0.0.1:${port}`,
      createdAt: now,
      refreshedAt: now,
    };
  }
}
