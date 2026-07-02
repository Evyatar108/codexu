import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';

import { CloudflareTunnelDaemonProvider, parseCloudflareTunnelId } from './cloudflareTunnelDaemonProvider';
import type { CommandResult, CommandRunner, ProcessSpawner } from './tunnelManager';

const TUNNEL_LIST_JSON = JSON.stringify([
  { id: 'aaaaaaaa-1111-2222-3333-444444444444', name: 'other-tunnel' },
  { id: '11111111-2222-3333-4444-555555555555', name: 'happy-evyatar' },
]);

type FakeChild = EventEmitter & { kill: ReturnType<typeof vi.fn>; unref: ReturnType<typeof vi.fn> };

function makeFakeChild(): FakeChild {
  const child = new EventEmitter() as FakeChild;
  child.kill = vi.fn();
  child.unref = vi.fn();
  return child;
}

/**
 * Build a runner that answers cloudflared subcommands deterministically:
 * `--version` and `tunnel list` succeed by default; `route dns` behavior is configurable.
 */
function makeRunner(options: {
  calls: string[][];
  versionStatus?: number;
  listResult?: CommandResult;
  dnsResult?: CommandResult;
} = { calls: [] }): CommandRunner {
  const calls = options.calls;
  return (command, args) => {
    calls.push([command, ...args]);
    if (args[0] === '--version') {
      return { status: options.versionStatus ?? 0, stdout: 'cloudflared version 2024.1.0', stderr: '' };
    }
    if (args[0] === 'tunnel' && args[1] === 'list') {
      return options.listResult ?? { status: 0, stdout: TUNNEL_LIST_JSON, stderr: '' };
    }
    if (args[0] === 'tunnel' && args[1] === 'route' && args[2] === 'dns') {
      return options.dnsResult ?? { status: 0, stdout: '', stderr: '' };
    }
    return { status: 1, stdout: '', stderr: `unexpected command: ${command} ${args.join(' ')}` };
  };
}

describe('parseCloudflareTunnelId', () => {
  it('extracts the UUID matching the tunnel name', () => {
    expect(parseCloudflareTunnelId(TUNNEL_LIST_JSON, 'happy-evyatar')).toBe('11111111-2222-3333-4444-555555555555');
  });

  it('returns null when the name is absent', () => {
    expect(parseCloudflareTunnelId(TUNNEL_LIST_JSON, 'missing')).toBeNull();
  });

  it('tolerates leading log noise before the JSON array', () => {
    const noisy = `2024-01-01T00:00:00Z INF Using default configuration\n${TUNNEL_LIST_JSON}`;
    expect(parseCloudflareTunnelId(noisy, 'happy-evyatar')).toBe('11111111-2222-3333-4444-555555555555');
  });

  it('returns null on non-JSON output', () => {
    expect(parseCloudflareTunnelId('cloudflared: command not found', 'happy-evyatar')).toBeNull();
  });
});

describe('CloudflareTunnelDaemonProvider', () => {
  it('rejects an unsafe hostname before any subprocess runs', () => {
    expect(() => new CloudflareTunnelDaemonProvider({
      hostname: 'evil;rm -rf/',
      tunnelName: 'happy-evyatar',
    })).toThrow(/invalid characters/);
  });

  it('rejects an unsafe tunnel name before any subprocess runs', () => {
    expect(() => new CloudflareTunnelDaemonProvider({
      hostname: 'happy.evyatar.dev',
      tunnelName: 'evil; rm -rf /',
    })).toThrow(/invalid characters/);
  });

  it('resolves the tunnel id, ensures DNS, and spawns an outbound cloudflared host', async () => {
    const calls: string[][] = [];
    const spawned: string[][] = [];
    const child = makeFakeChild();
    const spawner: ProcessSpawner = (command, args) => {
      spawned.push([command, ...args]);
      return child as unknown as ReturnType<ProcessSpawner>;
    };
    const provider = new CloudflareTunnelDaemonProvider({
      hostname: 'happy.evyatar.dev',
      tunnelName: 'happy-evyatar',
      runner: makeRunner({ calls }),
      spawner,
      now: () => new Date('2026-05-11T12:00:00.000Z'),
    });

    const config = await provider.createHostTunnel({ port: 62000, machineId: 'machine-123' });

    expect(config).toEqual({
      tunnelId: '11111111-2222-3333-4444-555555555555',
      tunnelName: 'happy-evyatar',
      tunnelUrl: 'https://happy.evyatar.dev',
      createdAt: '2026-05-11T12:00:00.000Z',
    });
    expect(calls).toContainEqual(['cloudflared', 'tunnel', 'list', '--output', 'json']);
    expect(calls).toContainEqual(['cloudflared', 'tunnel', 'route', 'dns', 'happy-evyatar', 'happy.evyatar.dev']);
    expect(spawned).toEqual([[
      'cloudflared', 'tunnel', 'run', '--url', 'http://127.0.0.1:62000', 'happy-evyatar',
    ]]);
    expect(child.unref).toHaveBeenCalled();
  });

  it('loadHostTunnel starts the same outbound host and ignores additionalPorts', async () => {
    const calls: string[][] = [];
    const spawned: string[][] = [];
    const child = makeFakeChild();
    const provider = new CloudflareTunnelDaemonProvider({
      hostname: 'happy.evyatar.dev',
      tunnelName: 'happy-evyatar',
      runner: makeRunner({ calls }),
      spawner: (command, args) => {
        spawned.push([command, ...args]);
        return child as unknown as ReturnType<ProcessSpawner>;
      },
      now: () => new Date('2026-05-11T12:00:00.000Z'),
    });

    const config = await provider.loadHostTunnel({ port: 62000, additionalPorts: [62001] });

    expect(config.tunnelUrl).toBe('https://happy.evyatar.dev');
    expect(spawned).toEqual([[
      'cloudflared', 'tunnel', 'run', '--url', 'http://127.0.0.1:62000', 'happy-evyatar',
    ]]);
  });

  it('treats an already-existing DNS route as success', async () => {
    const child = makeFakeChild();
    const provider = new CloudflareTunnelDaemonProvider({
      hostname: 'happy.evyatar.dev',
      tunnelName: 'happy-evyatar',
      runner: makeRunner({
        calls: [],
        dnsResult: {
          status: 1,
          stdout: '',
          stderr: 'An A, AAAA, or CNAME record with that host already exists.',
        },
      }),
      spawner: () => child as unknown as ReturnType<ProcessSpawner>,
    });

    await expect(provider.createHostTunnel({ port: 62000, machineId: 'm' })).resolves.toMatchObject({
      tunnelName: 'happy-evyatar',
    });
  });

  it('throws a clear error when cloudflared is not installed', async () => {
    const provider = new CloudflareTunnelDaemonProvider({
      hostname: 'happy.evyatar.dev',
      tunnelName: 'happy-evyatar',
      runner: makeRunner({ calls: [], versionStatus: 127 }),
      spawner: () => makeFakeChild() as unknown as ReturnType<ProcessSpawner>,
    });

    await expect(provider.createHostTunnel({ port: 62000, machineId: 'm' })).rejects.toThrow(/cloudflared CLI was not found/);
  });

  it('throws when the named tunnel does not exist', async () => {
    const provider = new CloudflareTunnelDaemonProvider({
      hostname: 'happy.evyatar.dev',
      tunnelName: 'missing-tunnel',
      runner: makeRunner({ calls: [] }),
      spawner: () => makeFakeChild() as unknown as ReturnType<ProcessSpawner>,
    });

    await expect(provider.createHostTunnel({ port: 62000, machineId: 'm' })).rejects.toThrow(/was not found/);
  });

  it('stop() terminates the spawned host process', async () => {
    const child = makeFakeChild();
    const provider = new CloudflareTunnelDaemonProvider({
      hostname: 'happy.evyatar.dev',
      tunnelName: 'happy-evyatar',
      runner: makeRunner({ calls: [] }),
      spawner: () => child as unknown as ReturnType<ProcessSpawner>,
    });

    await provider.createHostTunnel({ port: 62000, machineId: 'm' });
    provider.stop();

    expect(child.kill).toHaveBeenCalledWith('SIGTERM');
  });
});
