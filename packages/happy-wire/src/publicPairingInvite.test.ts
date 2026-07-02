import { describe, expect, it } from 'vitest';

import {
  PUBLIC_PAIRING_INVITE_TEST_VECTOR,
  PUBLIC_PAIRING_INVITE_VERSION,
  PublicPairingInviteSchema,
  createPublicPairingInvite,
  decodePublicPairingInvite,
  encodePublicPairingInvite,
  generatePairSecret,
  isPublicPairingInviteValid,
} from './index';

const BASE_INPUT = {
  serverUrl: 'https://happy.evyatar.dev',
  machineId: 'machine-abc',
  cloudflareAccess: {
    clientId: 'client-id.example',
    clientSecret: 'client-secret',
  },
};

describe('createPublicPairingInvite', () => {
  it('fills a bounded issued/expires window and a generated secret', () => {
    const issuedAt = new Date('2026-05-11T12:00:00.000Z');
    const invite = createPublicPairingInvite({ ...BASE_INPUT, issuedAt, ttlMs: 60_000 });

    expect(invite.version).toBe(PUBLIC_PAIRING_INVITE_VERSION);
    expect(invite.serverUrl).toBe('https://happy.evyatar.dev');
    expect(invite.machineId).toBe('machine-abc');
    expect(invite.issuedAt).toBe('2026-05-11T12:00:00.000Z');
    expect(invite.expiresAt).toBe('2026-05-11T12:01:00.000Z');
    expect(invite.pairSecret.length).toBeGreaterThan(0);
    expect(invite.cloudflareAccess).toEqual(BASE_INPUT.cloudflareAccess);
  });

  it('honors an explicit pairSecret and expiresAt', () => {
    const invite = createPublicPairingInvite({
      ...BASE_INPUT,
      pairSecret: 'fixed-secret',
      issuedAt: '2026-05-11T12:00:00.000Z',
      expiresAt: '2026-05-11T13:00:00.000Z',
    });
    expect(invite.pairSecret).toBe('fixed-secret');
    expect(invite.expiresAt).toBe('2026-05-11T13:00:00.000Z');
  });

  it('rejects a non-URL serverUrl', () => {
    expect(() => createPublicPairingInvite({ ...BASE_INPUT, serverUrl: 'not-a-url' })).toThrow();
  });
});

describe('generatePairSecret', () => {
  it('produces distinct non-empty secrets', () => {
    const a = generatePairSecret();
    const b = generatePairSecret();
    expect(a.length).toBeGreaterThan(0);
    expect(a).not.toBe(b);
  });
});

describe('encode/decode round-trip', () => {
  it('round-trips a valid invite through a base64url token', () => {
    const invite = createPublicPairingInvite({
      ...BASE_INPUT,
      pairSecret: 'secret',
      issuedAt: '2026-05-11T12:00:00.000Z',
      expiresAt: '2026-05-11T12:10:00.000Z',
    });
    const token = encodePublicPairingInvite(invite);
    expect(token).not.toContain('+');
    expect(token).not.toContain('/');
    expect(token).not.toContain('=');
    expect(decodePublicPairingInvite(token)).toEqual(invite);
  });

  it('matches the shared test vector deterministically', () => {
    expect(encodePublicPairingInvite(PUBLIC_PAIRING_INVITE_TEST_VECTOR.invite)).toBe(
      PUBLIC_PAIRING_INVITE_TEST_VECTOR.token,
    );
    expect(decodePublicPairingInvite(PUBLIC_PAIRING_INVITE_TEST_VECTOR.token)).toEqual(
      PUBLIC_PAIRING_INVITE_TEST_VECTOR.invite,
    );
  });

  it('returns null for malformed tokens', () => {
    expect(decodePublicPairingInvite('')).toBeNull();
    expect(decodePublicPairingInvite(null)).toBeNull();
    expect(decodePublicPairingInvite('%%%not-base64%%%')).toBeNull();
    expect(decodePublicPairingInvite(encodePublicPairingInvite(PUBLIC_PAIRING_INVITE_TEST_VECTOR.invite).slice(0, 4))).toBeNull();
  });
});

describe('isPublicPairingInviteValid', () => {
  const invite = {
    version: PUBLIC_PAIRING_INVITE_VERSION,
    serverUrl: 'https://happy.evyatar.dev',
    machineId: 'm',
    pairSecret: 's',
    cloudflareAccess: { clientId: 'a', clientSecret: 'b' },
    issuedAt: '2026-05-11T12:00:00.000Z',
    expiresAt: '2026-05-11T12:10:00.000Z',
  };

  it('accepts a time inside the window', () => {
    expect(isPublicPairingInviteValid(invite, new Date('2026-05-11T12:05:00.000Z'))).toBe(true);
  });

  it('rejects a time before issuance or after expiry', () => {
    expect(isPublicPairingInviteValid(invite, new Date('2026-05-11T11:59:59.000Z'))).toBe(false);
    expect(isPublicPairingInviteValid(invite, new Date('2026-05-11T12:10:01.000Z'))).toBe(false);
  });

  it('rejects a structurally invalid invite', () => {
    expect(isPublicPairingInviteValid({ version: 1 })).toBe(false);
    expect(PublicPairingInviteSchema.safeParse({ version: 1 }).success).toBe(false);
  });
});
