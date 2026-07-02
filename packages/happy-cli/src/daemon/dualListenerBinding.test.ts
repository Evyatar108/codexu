import { describe, expect, it, vi } from 'vitest';

import { dualListenerBinding } from './dualListenerBinding';
import { DevTunnelsDaemonProvider } from '@/tunnel/devTunnelsDaemonProvider';
import type { DaemonTunnelProvider } from '@/tunnel/provider';
import type { TunnelConfig } from '@/tunnel/types';

describe('dualListenerBinding', () => {
  const tunnelConfig: TunnelConfig = {
    tunnelId: 'happy-machine-1',
    tunnelName: 'happy-machine-1',
    tunnelUrl: 'https://happy-machine-1.devtunnels.ms',
    createdAt: '2026-05-11T12:00:00.000Z',
  };

  it('creates tunnel and loopback apps from one shared context and starts both ports', async () => {
    const tunnelProvider: DaemonTunnelProvider = {
      loadHostTunnel: vi.fn().mockResolvedValue(tunnelConfig),
      createHostTunnel: vi.fn(),
      stop: vi.fn(),
    };
    const start = vi.fn().mockResolvedValue(undefined);
    const stop = vi.fn().mockResolvedValue(undefined);
    const createAppFactory = vi.fn(() => ({ app: {} as any, eventRouter: {}, start, stop }));

    const handle = await dualListenerBinding({
      sharedContext: {
        dataDir: '/tmp/happy',
        machineKey: 'machine-key',
        localUserId: 'machine-1',
        tofuPublicKeys: {
          ed25519PublicKey: 'ed25519-public',
          x25519PublicKey: 'x25519-public',
        },
      },
      tunnelProvider,
      paths: {
        profile: '/tmp/happy/profile.json',
        accountSettings: '/tmp/happy/account-settings.json',
        loopbackCap: '/tmp/happy/loopback-cap.txt',
      },
      machineState: () => ({
        machineId: 'machine-1',
        tunnelPort: 62000,
        loopbackPort: 62001,
        tunnelId: 'happy-machine-1',
        lastTunnelUrl: tunnelConfig.tunnelUrl,
      }),
      createAppFactory,
    });

    expect(tunnelProvider.loadHostTunnel).toHaveBeenCalledWith({ port: 62000 });
    expect(createAppFactory).toHaveBeenCalledTimes(2);
    expect(createAppFactory).toHaveBeenNthCalledWith(1, expect.objectContaining({ auth: 'tunnel', port: 62000, publicUrl: tunnelConfig.tunnelUrl }));
    expect(createAppFactory).toHaveBeenNthCalledWith(2, expect.objectContaining({ auth: 'loopback', port: 62001, publicUrl: tunnelConfig.tunnelUrl }));
    expect(start).toHaveBeenCalledTimes(2);

    await handle.stop();
    expect(stop).toHaveBeenCalledTimes(2);
    expect(tunnelProvider.stop).toHaveBeenCalledTimes(1);
  });

  it('loads and hosts the co-located Dev Tunnel port used by the tunnel-auth listener', async () => {
    const manager = {
      init: vi.fn(),
      loadForDaemon: vi.fn().mockResolvedValue(tunnelConfig),
      startHost: vi.fn(),
      stop: vi.fn(),
    };
    const runner = vi.fn(() => ({ status: 0, stdout: '', stderr: '' }));
    const tunnelProvider = new DevTunnelsDaemonProvider({ manager, runner });
    const start = vi.fn().mockResolvedValue(undefined);
    const stop = vi.fn().mockResolvedValue(undefined);
    const createAppFactory = vi.fn(() => ({ app: {} as any, eventRouter: {}, start, stop }));

    const handle = await dualListenerBinding({
      sharedContext: {
        dataDir: '/tmp/happy',
        machineKey: 'machine-key',
        localUserId: 'machine-1',
        tofuPublicKeys: {
          ed25519PublicKey: 'ed25519-public',
          x25519PublicKey: 'x25519-public',
        },
      },
      tunnelProvider,
      paths: {
        profile: '/tmp/happy/profile.json',
        accountSettings: '/tmp/happy/account-settings.json',
        loopbackCap: '/tmp/happy/loopback-cap.txt',
      },
      machineState: () => ({
        machineId: 'machine-1',
        tunnelPort: 62000,
        loopbackPort: 62001,
        tunnelId: 'happy-machine-1',
        lastTunnelUrl: tunnelConfig.tunnelUrl,
      }),
      createAppFactory,
    });

    expect(manager.loadForDaemon).toHaveBeenCalledWith(62000);
    expect(runner).toHaveBeenCalledWith('devtunnel', ['update', 'happy-machine-1', '--add-labels', 'happy-machine']);
    expect(manager.startHost).toHaveBeenCalledWith(tunnelConfig, 62000);
    expect(createAppFactory).toHaveBeenNthCalledWith(1, expect.objectContaining({
      auth: 'tunnel',
      port: 62000,
      publicUrl: tunnelConfig.tunnelUrl,
    }));

    await handle.stop();
    expect(manager.stop).toHaveBeenCalledTimes(1);
  });

  it('binds the tunnel listener in public auth mode when publicListener is set', async () => {
    const tunnelProvider: DaemonTunnelProvider = {
      loadHostTunnel: vi.fn().mockResolvedValue(tunnelConfig),
      createHostTunnel: vi.fn(),
      stop: vi.fn(),
    };
    const start = vi.fn().mockResolvedValue(undefined);
    const stop = vi.fn().mockResolvedValue(undefined);
    const createAppFactory = vi.fn(() => ({ app: {} as any, eventRouter: {}, start, stop }));
    const publicAuth = {
      devices: [],
      edge: { serviceTokens: [{ clientId: 'cf-id', clientSecret: 'cf-secret' }] },
      pairing: { secret: 'pair-secret', windowOpenedAt: 1000, windowClosesAt: 2000 },
    };

    await dualListenerBinding({
      sharedContext: {
        dataDir: '/tmp/happy',
        machineKey: 'machine-key',
        localUserId: 'machine-1',
        tofuPublicKeys: { ed25519PublicKey: 'ed25519-public', x25519PublicKey: 'x25519-public' },
      },
      tunnelProvider,
      paths: {
        profile: '/tmp/happy/profile.json',
        accountSettings: '/tmp/happy/account-settings.json',
        loopbackCap: '/tmp/happy/loopback-cap.txt',
      },
      machineState: () => ({
        machineId: 'machine-1',
        tunnelPort: 62000,
        loopbackPort: 62001,
        tunnelId: 'happy-machine-1',
        lastTunnelUrl: tunnelConfig.tunnelUrl,
      }),
      publicListener: { auth: 'public', publicAuth },
      createAppFactory,
    });

    // Tunnel listener carries auth:"public" + publicAuth; loopback stays loopback.
    expect(createAppFactory).toHaveBeenNthCalledWith(1, expect.objectContaining({
      auth: 'public',
      port: 62000,
      publicAuth,
    }));
    expect(createAppFactory).toHaveBeenNthCalledWith(2, expect.objectContaining({ auth: 'loopback', port: 62001 }));
    // Public bind never carries publicAuth on the loopback listener.
    expect(createAppFactory).toHaveBeenNthCalledWith(2, expect.not.objectContaining({ publicAuth: expect.anything() }));
  });

  it('stops partial startup when the second listener cannot bind', async () => {
    const tunnelProvider: DaemonTunnelProvider = {
      loadHostTunnel: vi.fn().mockResolvedValue(tunnelConfig),
      createHostTunnel: vi.fn(),
      stop: vi.fn(),
    };
    const first = { app: {} as any, eventRouter: {}, start: vi.fn().mockResolvedValue(undefined), stop: vi.fn().mockResolvedValue(undefined) };
    const second = { app: {} as any, eventRouter: {}, start: vi.fn().mockRejectedValue(new Error('EADDRINUSE')), stop: vi.fn().mockResolvedValue(undefined) };
    const createAppFactory = vi.fn()
      .mockReturnValueOnce(first)
      .mockReturnValueOnce(second);

    await expect(dualListenerBinding({
      sharedContext: { dataDir: '/tmp/happy', machineKey: 'machine-key', localUserId: 'machine-1' },
      tunnelProvider,
      paths: { profile: 'profile.json', accountSettings: 'account-settings.json', loopbackCap: 'loopback-cap.txt' },
      machineState: () => ({ machineId: 'machine-1', tunnelPort: 62000, loopbackPort: 62000, tunnelId: '', lastTunnelUrl: null }),
      createAppFactory,
    })).rejects.toThrow('EADDRINUSE');

    expect(first.stop).toHaveBeenCalledTimes(1);
    expect(second.stop).toHaveBeenCalledTimes(1);
    expect(tunnelProvider.stop).toHaveBeenCalledTimes(1);
  });

  it('stop() tears down both listeners and the tunnel provider — relied on by run.ts writeMachineState failure guard', async () => {
    const tunnelProvider: DaemonTunnelProvider = {
      loadHostTunnel: vi.fn().mockResolvedValue(tunnelConfig),
      createHostTunnel: vi.fn(),
      stop: vi.fn(),
    };
    const start = vi.fn().mockResolvedValue(undefined);
    const stop = vi.fn().mockResolvedValue(undefined);
    const createAppFactory = vi.fn(() => ({ app: {} as any, eventRouter: {}, start, stop }));

    const handle = await dualListenerBinding({
      sharedContext: { dataDir: '/tmp/happy', machineKey: 'machine-key', localUserId: 'machine-1', tofuPublicKeys: { ed25519PublicKey: 'ed25519-public', x25519PublicKey: 'x25519-public' } },
      tunnelProvider,
      paths: { profile: '/tmp/happy/profile.json', accountSettings: '/tmp/happy/account-settings.json', loopbackCap: '/tmp/happy/loopback-cap.txt' },
      machineState: () => ({ machineId: 'machine-1', tunnelPort: 62000, loopbackPort: 62001, tunnelId: 'happy-machine-1', lastTunnelUrl: tunnelConfig.tunnelUrl }),
      createAppFactory,
    });

    // Simulate run.ts try/catch: writeMachineState throws, so we call handle.stop() and rethrow
    const writeError = new Error('ENOSPC: no space left on device');
    let caughtError: Error | undefined;
    try {
      throw writeError;
    } catch (err) {
      await handle.stop();
      caughtError = err as Error;
    }

    expect(caughtError).toBe(writeError);
    expect(stop).toHaveBeenCalledTimes(2);
    expect(tunnelProvider.stop).toHaveBeenCalledTimes(1);
  });
});
