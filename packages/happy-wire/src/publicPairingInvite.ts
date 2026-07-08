import * as z from 'zod';

import { decodeBase64, encodeBase64, generatePublicRequestNonce } from './publicDeviceAuth';

// ---------------------------------------------------------------------------
// Public pairing invite
//
// A short-lived, one-time payload the happy-cli daemon emits when it brings up a
// public `auth:"public"` listener over a Cloudflare named tunnel. It carries
// everything a fresh happy-app device needs to complete first-contact pairing
// against the public server:
//   - the public server URL (https://<hostname>),
//   - the machineId being paired,
//   - the one-time pairing-window secret (consumed by `/pair/complete`),
//   - the Cloudflare Access service-token credentials required to pass the
//     mandatory edge auth in front of the server.
//
// The invite is transport-agnostic: `encodePublicPairingInvite` produces a
// compact base64url token suitable for a QR code or manual entry, and
// `decodePublicPairingInvite` validates + parses it back. The schema lives in
// happy-wire so the CLI (producer) and the app (consumer, US-007) share one
// typed contract.
// ---------------------------------------------------------------------------

export const PUBLIC_PAIRING_INVITE_VERSION = 1 as const;

/** Default lifetime of a pairing invite when no explicit expiry/ttl is supplied. */
export const PUBLIC_PAIRING_INVITE_DEFAULT_TTL_MS = 10 * 60 * 1000;

export const CloudflareAccessServiceTokenSchema = z.object({
  clientId: z.string().min(1),
  clientSecret: z.string().min(1),
});

export type CloudflareAccessServiceToken = z.infer<typeof CloudflareAccessServiceTokenSchema>;

export const PublicPairingInviteSchema = z.object({
  version: z.literal(PUBLIC_PAIRING_INVITE_VERSION),
  serverUrl: z.string().url(),
  machineId: z.string().min(1),
  pairSecret: z.string().min(1),
  cloudflareAccess: CloudflareAccessServiceTokenSchema,
  issuedAt: z.string().datetime(),
  expiresAt: z.string().datetime(),
});

export type PublicPairingInvite = z.infer<typeof PublicPairingInviteSchema>;

export interface CreatePublicPairingInviteInput {
  serverUrl: string;
  machineId: string;
  cloudflareAccess: CloudflareAccessServiceToken;
  /** One-time pairing-window secret. Generated when omitted. */
  pairSecret?: string;
  issuedAt?: Date | string;
  /** Invite lifetime; ignored when `expiresAt` is supplied. */
  ttlMs?: number;
  expiresAt?: Date | string;
}

/** Generate a fresh, high-entropy one-time pairing secret. */
export function generatePairSecret(byteLength = 24): string {
  return generatePublicRequestNonce(byteLength);
}

function toDate(value: Date | string | undefined): Date | null {
  if (value === undefined) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error('Invalid date supplied to public pairing invite');
  }
  return date;
}

/**
 * Assemble a validated {@link PublicPairingInvite}. Generates a fresh
 * `pairSecret` and a bounded `issuedAt`/`expiresAt` window unless overridden.
 */
export function createPublicPairingInvite(input: CreatePublicPairingInviteInput): PublicPairingInvite {
  const issuedAtDate = toDate(input.issuedAt) ?? new Date();
  const ttlMs = input.ttlMs ?? PUBLIC_PAIRING_INVITE_DEFAULT_TTL_MS;
  const expiresAtDate = toDate(input.expiresAt) ?? new Date(issuedAtDate.getTime() + ttlMs);

  return PublicPairingInviteSchema.parse({
    version: PUBLIC_PAIRING_INVITE_VERSION,
    serverUrl: input.serverUrl,
    machineId: input.machineId,
    pairSecret: input.pairSecret ?? generatePairSecret(),
    cloudflareAccess: {
      clientId: input.cloudflareAccess.clientId,
      clientSecret: input.cloudflareAccess.clientSecret,
    },
    issuedAt: issuedAtDate.toISOString(),
    expiresAt: expiresAtDate.toISOString(),
  });
}

/**
 * True when `invite` parses against the schema and `now` falls within
 * `[issuedAt, expiresAt]`. Never throws.
 */
export function isPublicPairingInviteValid(invite: unknown, now: Date = new Date()): boolean {
  const parsed = PublicPairingInviteSchema.safeParse(invite);
  if (!parsed.success) return false;
  const issuedAt = new Date(parsed.data.issuedAt).getTime();
  const expiresAt = new Date(parsed.data.expiresAt).getTime();
  const nowMs = now.getTime();
  return nowMs >= issuedAt && nowMs <= expiresAt;
}

function toBase64Url(text: string): string {
  const bytes = new TextEncoder().encode(text);
  return encodeBase64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function fromBase64Url(token: string): string {
  const standard = token.replace(/-/g, '+').replace(/_/g, '/');
  return new TextDecoder().decode(decodeBase64(standard));
}

/** Encode a validated invite as a compact base64url token (QR / manual entry). */
export function encodePublicPairingInvite(invite: PublicPairingInvite): string {
  const validated = PublicPairingInviteSchema.parse(invite);
  return toBase64Url(JSON.stringify(validated));
}

/**
 * Decode + validate a base64url invite token. Returns null when the token is
 * malformed, not valid base64url, not JSON, or fails schema validation.
 */
export function decodePublicPairingInvite(token: string | undefined | null): PublicPairingInvite | null {
  if (!token) return null;
  let json: string;
  try {
    json = fromBase64Url(token.trim());
  } catch {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return null;
  }
  const result = PublicPairingInviteSchema.safeParse(parsed);
  return result.success ? result.data : null;
}

export interface PublicPairingInviteTestVector {
  invite: PublicPairingInvite;
  token: string;
}

/**
 * Deterministic round-trip fixture shared with consumers (US-007 app import).
 * `token` is the canonical base64url encoding of `invite`.
 */
export const PUBLIC_PAIRING_INVITE_TEST_VECTOR: PublicPairingInviteTestVector = (() => {
  const invite: PublicPairingInvite = {
    version: PUBLIC_PAIRING_INVITE_VERSION,
    serverUrl: 'https://happy.example.com',
    machineId: 'machine-test-0001',
    pairSecret: 'cGFpci1zZWNyZXQtZml4dHVyZQ==',
    cloudflareAccess: {
      clientId: 'cf-access-client-id.example',
      clientSecret: 'cf-access-client-secret-value',
    },
    issuedAt: '2026-05-11T12:00:00.000Z',
    expiresAt: '2026-05-11T12:10:00.000Z',
  };
  return { invite, token: encodePublicPairingInvite(invite) };
})();
