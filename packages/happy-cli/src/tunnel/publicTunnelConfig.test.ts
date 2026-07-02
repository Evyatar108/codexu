import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  assertPublicBindReady,
  buildPublicMode,
  isPublicTunnelOptedIn,
  readPublicTunnelConfig,
  writePublicPairingInvite,
  type PublicTunnelConfig,
} from './publicTunnelConfig';
import { decodePublicPairingInvite, isPublicPairingInviteValid } from '@slopus/happy-wire';

const VALID_CONFIG: PublicTunnelConfig = {
  hostname: 'happy.evyatar.dev',
  tunnelName: 'happy-evyatar',
  cloudflareAccess: {
    serviceTokens: [{ clientId: 'cf-id', clientSecret: 'cf-secret' }],
  },
};

let workDir: string;

beforeEach(() => {
  workDir = mkdtempSync(join(tmpdir(), 'happy-public-tunnel-'));
});

afterEach(() => {
  rmSync(workDir, { recursive: true, force: true });
});

describe('isPublicTunnelOptedIn', () => {
  it('is true only for HAPPY_TUNNEL_PROVIDER=cloudflare (case-insensitive)', () => {
    expect(isPublicTunnelOptedIn({ HAPPY_TUNNEL_PROVIDER: 'cloudflare' })).toBe(true);
    expect(isPublicTunnelOptedIn({ HAPPY_TUNNEL_PROVIDER: 'Cloudflare' })).toBe(true);
    expect(isPublicTunnelOptedIn({ HAPPY_TUNNEL_PROVIDER: ' cloudflare ' })).toBe(true);
  });

  it('is false when unset or set to another provider', () => {
    expect(isPublicTunnelOptedIn({})).toBe(false);
    expect(isPublicTunnelOptedIn({ HAPPY_TUNNEL_PROVIDER: 'devtunnels' })).toBe(false);
  });
});

describe('readPublicTunnelConfig', () => {
  it('returns null when the file is absent', async () => {
    await expect(readPublicTunnelConfig(join(workDir, 'missing.json'))).resolves.toBeNull();
  });

  it('parses a valid config', async () => {
    const file = join(workDir, 'public-tunnel.json');
    writeFileSync(file, JSON.stringify(VALID_CONFIG));
    await expect(readPublicTunnelConfig(file)).resolves.toEqual(VALID_CONFIG);
  });

  it('throws on invalid JSON', async () => {
    const file = join(workDir, 'public-tunnel.json');
    writeFileSync(file, '{ not json');
    await expect(readPublicTunnelConfig(file)).rejects.toThrow(/not valid JSON/);
  });

  it('throws when serviceTokens is empty (schema min)', async () => {
    const file = join(workDir, 'public-tunnel.json');
    writeFileSync(file, JSON.stringify({ ...VALID_CONFIG, cloudflareAccess: { serviceTokens: [] } }));
    await expect(readPublicTunnelConfig(file)).rejects.toThrow(/invalid/);
  });
});

describe('assertPublicBindReady', () => {
  it('throws when config is null', () => {
    expect(() => assertPublicBindReady(null)).toThrow(/requires a public-tunnel.json/);
  });

  it('throws when no edge service token is present', () => {
    const bare = { ...VALID_CONFIG, cloudflareAccess: { serviceTokens: [] } } as unknown as PublicTunnelConfig;
    expect(() => assertPublicBindReady(bare)).toThrow(/service token is mandatory/);
  });

  it('passes with at least one service token', () => {
    expect(() => assertPublicBindReady(VALID_CONFIG)).not.toThrow();
  });
});

describe('buildPublicMode', () => {
  it('couples the public auth config and the pairing invite via one secret', () => {
    const now = () => new Date('2026-05-11T12:00:00.000Z');
    const { publicAuth, invite } = buildPublicMode({
      config: VALID_CONFIG,
      serverUrl: 'https://happy.evyatar.dev',
      machineId: 'machine-xyz',
      now,
    });

    // Devices default to empty (first pairing enrolls one); edge carries the token.
    expect(publicAuth.devices).toEqual([]);
    expect(publicAuth.edge.serviceTokens).toEqual([{ clientId: 'cf-id', clientSecret: 'cf-secret' }]);

    // The one-time secret is shared: server pairing secret === invite pairSecret.
    expect(publicAuth.pairing?.secret).toBe(invite.pairSecret);
    // Window is aligned to the invite issued/expiry.
    expect(publicAuth.pairing?.windowOpenedAt).toBe(new Date('2026-05-11T12:00:00.000Z').getTime());
    expect(publicAuth.pairing?.windowClosesAt).toBe(new Date(invite.expiresAt).getTime());

    // Invite carries the public URL + machineId + edge creds.
    expect(invite.serverUrl).toBe('https://happy.evyatar.dev');
    expect(invite.machineId).toBe('machine-xyz');
    expect(invite.cloudflareAccess).toEqual({ clientId: 'cf-id', clientSecret: 'cf-secret' });
    expect(isPublicPairingInviteValid(invite, new Date('2026-05-11T12:05:00.000Z'))).toBe(true);
  });

  it('propagates freshness/skew overrides into publicAuth', () => {
    const { publicAuth } = buildPublicMode({
      config: { ...VALID_CONFIG, freshnessMs: 1000, clockSkewMs: 500 },
      serverUrl: 'https://happy.evyatar.dev',
      machineId: 'm',
    });
    expect(publicAuth.freshnessMs).toBe(1000);
    expect(publicAuth.clockSkewMs).toBe(500);
  });

  it('refuses to build without an edge token', () => {
    const bare = { ...VALID_CONFIG, cloudflareAccess: { serviceTokens: [] } } as unknown as PublicTunnelConfig;
    expect(() => buildPublicMode({ config: bare, serverUrl: 'https://x.dev', machineId: 'm' })).toThrow(/service token is mandatory/);
  });
});

describe('writePublicPairingInvite', () => {
  it('writes JSON and returns a decodable token', async () => {
    const { invite } = buildPublicMode({
      config: VALID_CONFIG,
      serverUrl: 'https://happy.evyatar.dev',
      machineId: 'machine-xyz',
    });
    const file = join(workDir, 'public-pairing-invite.json');
    const token = await writePublicPairingInvite(file, invite);
    expect(decodePublicPairingInvite(token)).toEqual(invite);
  });
});
