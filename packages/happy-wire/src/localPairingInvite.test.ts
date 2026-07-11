import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import {
  LOCAL_PAIRING_FORWARD_SKEW_MS,
  LOCAL_PAIRING_WINDOW_MS,
  LocalPairingInviteSchema,
  createLocalPairingInvite,
  decodeLocalPairingInvite,
  encodeLocalPairingInvite,
  isLocalPairingInviteValid,
  isStrictLoopbackServerUrl,
} from './index';

interface LocalVectors {
  version: 1;
  invite: {
    payload: {
      kind: 'happy-local-pairing';
      version: 1;
      authMode: 'paired-device';
      serverUrl: string;
      browserOrigin: string;
      machineId: string;
      pairSecret: string;
      pairingNonce: string;
      issuedAt: string;
      expiresAt: string;
    };
    token: string;
  };
}

const vectors = JSON.parse(
  readFileSync(new URL('./fixtures/happy_local_v1_vectors.json', import.meta.url), 'utf8'),
) as LocalVectors;

describe('local pairing invite', () => {
  it('loads the canonical cross-language fixture and round-trips exactly', () => {
    const invite = LocalPairingInviteSchema.parse(vectors.invite.payload);
    expect(encodeLocalPairingInvite(invite)).toBe(vectors.invite.token);
    expect(decodeLocalPairingInvite(vectors.invite.token, invite.browserOrigin)).toEqual(invite);
  });

  it('requires the exact browser origin and the 120-second validity window', () => {
    const invite = vectors.invite.payload;
    const issuedAt = Date.parse(invite.issuedAt);
    expect(isLocalPairingInviteValid(invite, invite.browserOrigin, new Date(issuedAt))).toBe(true);
    expect(isLocalPairingInviteValid(
      invite,
      invite.browserOrigin,
      new Date(issuedAt - LOCAL_PAIRING_FORWARD_SKEW_MS - 1),
    )).toBe(false);
    expect(isLocalPairingInviteValid(
      invite,
      invite.browserOrigin,
      new Date(issuedAt + LOCAL_PAIRING_WINDOW_MS),
    )).toBe(false);
    expect(isLocalPairingInviteValid(invite, 'http://127.0.0.1:8081', new Date(issuedAt))).toBe(false);
    expect(decodeLocalPairingInvite(vectors.invite.token, 'http://127.0.0.1:8081')).toBeNull();
  });

  it.each([
    'http://localhost:43127',
    'http://0.0.0.0:43127',
    'http://[::1]:43127',
    'https://127.0.0.1:43127',
    'http://user:pass@127.0.0.1:43127',
    'http://127.0.0.1:43127/path',
    'http://127.0.0.1:43127?query=1',
    'http://127.0.0.1:43127#fragment',
    'http://127.0.0.1',
    'http://127.0.0.1:0',
    'http://127.0.0.1:65536',
  ])('rejects non-contract loopback endpoint %s', (serverUrl) => {
    expect(isStrictLoopbackServerUrl(serverUrl)).toBe(false);
    expect(LocalPairingInviteSchema.safeParse({ ...vectors.invite.payload, serverUrl }).success).toBe(false);
  });

  it('rejects malformed sizes, extra fields, and non-canonical tokens', () => {
    expect(LocalPairingInviteSchema.safeParse({
      ...vectors.invite.payload,
      pairSecret: vectors.invite.payload.pairSecret.slice(1),
    }).success).toBe(false);
    expect(LocalPairingInviteSchema.safeParse({
      ...vectors.invite.payload,
      pairingNonce: `${vectors.invite.payload.pairingNonce}=`,
    }).success).toBe(false);
    expect(LocalPairingInviteSchema.safeParse({
      ...vectors.invite.payload,
      unexpected: true,
    }).success).toBe(false);
    expect(decodeLocalPairingInvite(`${vectors.invite.token}=`)).toBeNull();
  });

  it('creates a validated invite without relaxing the endpoint or origin', () => {
    const invite = createLocalPairingInvite({
      ...vectors.invite.payload,
      issuedAt: vectors.invite.payload.issuedAt,
      expiresAt: vectors.invite.payload.expiresAt,
    });
    expect(invite).toEqual(vectors.invite.payload);
  });
});
