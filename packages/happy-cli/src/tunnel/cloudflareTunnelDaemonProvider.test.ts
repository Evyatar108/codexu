import { EventEmitter } from 'node:events';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CloudflareTunnelDaemonProvider, parseCloudflareTunnelId } from './cloudflareTunnelDaemonProvider';
import type { CommandResult, CommandRunner, ProcessSpawner } from './tunnelManager';

const HAPPY_TUNNEL_ID = '11111111-2222-3333-4444-555555555555';

const TUNNEL_LIST_JSON = JSON.stringify([
  { id: 'aaaaaaaa-1111-2222-3333-444444444444', name: 'other-tunnel' },
  { id: HAPPY_TUNNEL_ID, name: 'happy-example' },
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
    expect(parseCloudflareTunnelId(TUNNEL_LIST_JSON, 'happy-example')).toBe('11111111-2222-3333-4444-555555555555');
  });

  it('returns null when the name is absent', () => {
    expect(parseCloudflareTunnelId(TUNNEL_LIST_JSON, 'missing')).toBeNull();
  });

  it('tolerates leading log noise before the JSON array', () => {
    const noisy = `2024-01-01T00:00:00Z INF Using default configuration\n${TUNNEL_LIST_JSON}`;
    expect(parseCloudflareTunnelId(noisy, 'happy-example')).toBe('11111111-2222-3333-4444-555555555555');
  });

  it('finds the tunnel when an outdated-version WARNING object trails the array', () => {
    // cloudflared >= 2026.5.0 appends this as a SEPARATE top-level JSON object line
    // AFTER the tunnel-list array; a naive JSON.parse(slice) throws on the trailing data.
    const withWarning =
      `${TUNNEL_LIST_JSON}\n` +
      `{"level":"warn","message":"Your version 2026.5.0 is outdated. We recommend upgrading.","time":"2026-05-11T00:00:00Z"}`;
    expect(parseCloudflareTunnelId(withWarning, 'happy-example')).toBe('11111111-2222-3333-4444-555555555555');
  });

  it('finds the tunnel when a warning object leads the array', () => {
    const leadingWarning =
      `{"level":"warn","message":"Your version is outdated.","time":"2026-05-11T00:00:00Z"}\n` +
      `${TUNNEL_LIST_JSON}`;
    expect(parseCloudflareTunnelId(leadingWarning, 'happy-example')).toBe('11111111-2222-3333-4444-555555555555');
  });

  it('resolves a single bare object (not wrapped in an array)', () => {
    const single = JSON.stringify({ id: '99999999-0000-0000-0000-000000000000', name: 'happy-example' });
    expect(parseCloudflareTunnelId(single, 'happy-example')).toBe('99999999-0000-0000-0000-000000000000');
  });

  it('resolves a single object even with a trailing warning object', () => {
    const single =
      `${JSON.stringify({ id: '99999999-0000-0000-0000-000000000000', name: 'happy-example' })}\n` +
      `{"level":"warn","message":"outdated"}`;
    expect(parseCloudflareTunnelId(single, 'happy-example')).toBe('99999999-0000-0000-0000-000000000000');
  });

  it('does not match a name that only appears inside the warning object', () => {
    const withWarning =
      `${TUNNEL_LIST_JSON}\n` +
      `{"level":"warn","name":"decoy","message":"outdated"}`;
    expect(parseCloudflareTunnelId(withWarning, 'decoy')).toBeNull();
  });

  it('returns null on malformed JSON after the opening bracket', () => {
    expect(parseCloudflareTunnelId('[ { "id": "x", "name": "happy-example" ', 'happy-example')).toBeNull();
  });

  it('returns null on non-JSON output', () => {
    expect(parseCloudflareTunnelId('cloudflared: command not found', 'happy-example')).toBeNull();
  });
});

describe('CloudflareTunnelDaemonProvider', () => {
  // Bug 2 makes the daemon write its OWN cloudflared config (referencing the tunnel
  // credentials file) instead of relying on the global `~/.cloudflared/config.yml`.
  // These temp dirs stand in for the daemon config dir and the cloudflared home dir
  // (which holds `<tunnel-id>.json`), so the tests exercise the real fs behavior
  // without touching the operator's machine.
  let configDir: string;
  let cloudflaredHomeDir: string;

  beforeEach(() => {
    configDir = mkdtempSync(join(tmpdir(), 'happy-cf-config-'));
    cloudflaredHomeDir = mkdtempSync(join(tmpdir(), 'happy-cf-home-'));
    // The credentials file `cloudflared tunnel create` writes for the resolved tunnel.
    writeFileSync(join(cloudflaredHomeDir, `${HAPPY_TUNNEL_ID}.json`), JSON.stringify({ TunnelID: HAPPY_TUNNEL_ID }));
  });

  afterEach(() => {
    rmSync(configDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
    rmSync(cloudflaredHomeDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  });

  function daemonConfigPath(): string {
    return join(configDir, 'config.yml');
  }

  it('rejects an unsafe hostname before any subprocess runs', () => {
    expect(() => new CloudflareTunnelDaemonProvider({
      hostname: 'evil;rm -rf/',
      tunnelName: 'happy-example',
    })).toThrow(/invalid characters/);
  });

  it('rejects an unsafe tunnel name before any subprocess runs', () => {
    expect(() => new CloudflareTunnelDaemonProvider({
      hostname: 'happy.example.com',
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
      hostname: 'happy.example.com',
      tunnelName: 'happy-example',
      runner: makeRunner({ calls }),
      spawner,
      now: () => new Date('2026-05-11T12:00:00.000Z'),
      configDir,
      cloudflaredHomeDir,
    });

    const config = await provider.createHostTunnel({ port: 62000, machineId: 'machine-123' });

    expect(config).toEqual({
      tunnelId: '11111111-2222-3333-4444-555555555555',
      tunnelName: 'happy-example',
      tunnelUrl: 'https://happy.example.com',
      createdAt: '2026-05-11T12:00:00.000Z',
    });
    expect(calls).toContainEqual(['cloudflared', 'tunnel', 'list', '--output', 'json']);
    expect(calls).toContainEqual(['cloudflared', 'tunnel', 'route', 'dns', 'happy-example', 'happy.example.com']);
    // Bug 2: the daemon runs cloudflared with its OWN --config so the global
    // ~/.cloudflared/config.yml can no longer override the intended ingress.
    // No positional tunnel name and no --url: the config file is authoritative.
    expect(spawned).toEqual([[
      'cloudflared', 'tunnel', '--config', daemonConfigPath(), 'run',
    ]]);
    expect(spawned[0]).not.toContain('--url');
    expect(child.unref).toHaveBeenCalled();

    const written = readFileSync(daemonConfigPath(), 'utf8');
    expect(written).toContain(`tunnel: ${HAPPY_TUNNEL_ID}`);
    expect(written).toContain(join(cloudflaredHomeDir, `${HAPPY_TUNNEL_ID}.json`));
    expect(written).toContain('hostname: happy.example.com');
    expect(written).toContain('service: http://127.0.0.1:62000');
    expect(written).toContain('service: http_status:404');
  });

  it('loadHostTunnel starts the same outbound host and ignores additionalPorts', async () => {
    const calls: string[][] = [];
    const spawned: string[][] = [];
    const child = makeFakeChild();
    const provider = new CloudflareTunnelDaemonProvider({
      hostname: 'happy.example.com',
      tunnelName: 'happy-example',
      runner: makeRunner({ calls }),
      spawner: (command, args) => {
        spawned.push([command, ...args]);
        return child as unknown as ReturnType<ProcessSpawner>;
      },
      now: () => new Date('2026-05-11T12:00:00.000Z'),
      configDir,
      cloudflaredHomeDir,
    });

    const config = await provider.loadHostTunnel({ port: 62000, additionalPorts: [62001] });

    expect(config.tunnelUrl).toBe('https://happy.example.com');
    expect(spawned).toEqual([[
      'cloudflared', 'tunnel', '--config', daemonConfigPath(), 'run',
    ]]);
  });

  it('treats an already-existing DNS route as success', async () => {
    const child = makeFakeChild();
    const provider = new CloudflareTunnelDaemonProvider({
      hostname: 'happy.example.com',
      tunnelName: 'happy-example',
      runner: makeRunner({
        calls: [],
        dnsResult: {
          status: 1,
          stdout: '',
          stderr: 'An A, AAAA, or CNAME record with that host already exists.',
        },
      }),
      spawner: () => child as unknown as ReturnType<ProcessSpawner>,
      configDir,
      cloudflaredHomeDir,
    });

    await expect(provider.createHostTunnel({ port: 62000, machineId: 'm' })).resolves.toMatchObject({
      tunnelName: 'happy-example',
    });
  });

  it('throws a clear error when cloudflared is not installed', async () => {
    const provider = new CloudflareTunnelDaemonProvider({
      hostname: 'happy.example.com',
      tunnelName: 'happy-example',
      runner: makeRunner({ calls: [], versionStatus: 127 }),
      spawner: () => makeFakeChild() as unknown as ReturnType<ProcessSpawner>,
    });

    await expect(provider.createHostTunnel({ port: 62000, machineId: 'm' })).rejects.toThrow(/cloudflared CLI was not found/);
  });

  it('throws when the named tunnel does not exist', async () => {
    const provider = new CloudflareTunnelDaemonProvider({
      hostname: 'happy.example.com',
      tunnelName: 'missing-tunnel',
      runner: makeRunner({ calls: [] }),
      spawner: () => makeFakeChild() as unknown as ReturnType<ProcessSpawner>,
    });

    await expect(provider.createHostTunnel({ port: 62000, machineId: 'm' })).rejects.toThrow(/was not found/);
  });

  it('stop() terminates the spawned host process', async () => {
    const child = makeFakeChild();
    const provider = new CloudflareTunnelDaemonProvider({
      hostname: 'happy.example.com',
      tunnelName: 'happy-example',
      runner: makeRunner({ calls: [] }),
      spawner: () => child as unknown as ReturnType<ProcessSpawner>,
      configDir,
      cloudflaredHomeDir,
    });

    await provider.createHostTunnel({ port: 62000, machineId: 'm' });
    provider.stop();

    expect(child.kill).toHaveBeenCalledWith('SIGTERM');
  });

  it('fails loud when the tunnel credentials file is missing instead of silently 502-ing', async () => {
    // Empty cloudflaredHomeDir: no `<tunnel-id>.json` present.
    rmSync(join(cloudflaredHomeDir, `${HAPPY_TUNNEL_ID}.json`), { force: true });
    const spawned: string[][] = [];
    const provider = new CloudflareTunnelDaemonProvider({
      hostname: 'happy.example.com',
      tunnelName: 'happy-example',
      runner: makeRunner({ calls: [] }),
      spawner: (command, args) => {
        spawned.push([command, ...args]);
        return makeFakeChild() as unknown as ReturnType<ProcessSpawner>;
      },
      configDir,
      cloudflaredHomeDir,
    });

    await expect(provider.createHostTunnel({ port: 62000, machineId: 'm' }))
      .rejects.toThrow(/credentials file.*was not found/);
    // It must fail before spawning a cloudflared host that would 502.
    expect(spawned).toEqual([]);
  });

  it('daemon config ingress overrides any global config (self-owned --config path is authoritative)', async () => {
    const spawned: string[][] = [];
    const child = makeFakeChild();
    const provider = new CloudflareTunnelDaemonProvider({
      hostname: 'happy.example.com',
      tunnelName: 'happy-example',
      runner: makeRunner({ calls: [] }),
      spawner: (command, args) => {
        spawned.push([command, ...args]);
        return child as unknown as ReturnType<ProcessSpawner>;
      },
      configDir,
      cloudflaredHomeDir,
    });

    await provider.createHostTunnel({ port: 62000, machineId: 'm' });

    // The spawn must reference our own --config (not defer to ~/.cloudflared/config.yml).
    expect(spawned[0]).toContain('--config');
    expect(spawned[0][spawned[0].indexOf('--config') + 1]).toBe(daemonConfigPath());

    // And that config pins the ingress the daemon intends, with a catch-all 404 so a
    // stale/foreign hostname rule cannot leak through.
    const written = readFileSync(daemonConfigPath(), 'utf8');
    expect(written).toMatch(/ingress:/);
    expect(written).toMatch(/- hostname: happy\.example\.com\s+service: http:\/\/127\.0\.0\.1:62000/);
    expect(written).toMatch(/- service: http_status:404/);
  });
});
