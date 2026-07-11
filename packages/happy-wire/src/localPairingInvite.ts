import * as z from 'zod';

import { decodeBase64, encodeBase64, generatePublicRequestNonce } from './publicDeviceAuth';

export const LOCAL_PAIRING_INVITE_KIND = 'happy-local-pairing' as const;
export const LOCAL_PAIRING_INVITE_VERSION = 1 as const;
export const LOCAL_PAIRING_AUTH_MODE = 'paired-device' as const;
export const LOCAL_PAIRING_WINDOW_MS = 120_000;
export const LOCAL_PAIRING_FORWARD_SKEW_MS = 30_000;
export const LOCAL_PAIRING_SECRET_BYTES = 32;
export const LOCAL_PAIRING_NONCE_BYTES = 24;

export const LOCAL_PAIRING_SECRET_HEADER = 'X-Happy-Pairing-Secret';
export const LOCAL_PAIRING_NONCE_HEADER = 'X-Happy-Pairing-Nonce';

const LocalPairingInviteShapeSchema = z.object({
  kind: z.literal(LOCAL_PAIRING_INVITE_KIND),
  version: z.literal(LOCAL_PAIRING_INVITE_VERSION),
  authMode: z.literal(LOCAL_PAIRING_AUTH_MODE),
  serverUrl: z.string().min(1),
  browserOrigin: z.string().min(1),
  machineId: z.string().min(1).max(256),
  pairSecret: z.string().min(1),
  pairingNonce: z.string().min(1),
  issuedAt: z.string().datetime(),
  expiresAt: z.string().datetime(),
}).strict();

export const LocalPairingInviteSchema = LocalPairingInviteShapeSchema.superRefine((invite, context) => {
  if (!isStrictLoopbackServerUrl(invite.serverUrl)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['serverUrl'],
      message: 'serverUrl must be an explicit http://127.0.0.1:<port> origin',
    });
  }
  if (!isOrigin(invite.browserOrigin)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['browserOrigin'],
      message: 'browserOrigin must be an exact URL origin',
    });
  }
  if (!isCanonicalBase64UrlBytes(invite.pairSecret, LOCAL_PAIRING_SECRET_BYTES)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['pairSecret'],
      message: `pairSecret must be ${LOCAL_PAIRING_SECRET_BYTES} canonical base64url bytes`,
    });
  }
  if (!isCanonicalBase64UrlBytes(invite.pairingNonce, LOCAL_PAIRING_NONCE_BYTES)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['pairingNonce'],
      message: `pairingNonce must be ${LOCAL_PAIRING_NONCE_BYTES} canonical base64url bytes`,
    });
  }
  const issuedAt = Date.parse(invite.issuedAt);
  const expiresAt = Date.parse(invite.expiresAt);
  if (expiresAt - issuedAt !== LOCAL_PAIRING_WINDOW_MS) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['expiresAt'],
      message: `pairing window must be exactly ${LOCAL_PAIRING_WINDOW_MS}ms`,
    });
  }
});

export type LocalPairingInvite = z.infer<typeof LocalPairingInviteSchema>;

export interface CreateLocalPairingInviteInput {
  serverUrl: string;
  browserOrigin: string;
  machineId: string;
  pairSecret?: string;
  pairingNonce?: string;
  issuedAt?: Date | string;
  expiresAt?: Date | string;
}

export function createLocalPairingInvite(input: CreateLocalPairingInviteInput): LocalPairingInvite {
  const issuedAt = parseDate(input.issuedAt) ?? new Date();
  const expiresAt = parseDate(input.expiresAt) ?? new Date(issuedAt.getTime() + LOCAL_PAIRING_WINDOW_MS);
  return LocalPairingInviteSchema.parse({
    kind: LOCAL_PAIRING_INVITE_KIND,
    version: LOCAL_PAIRING_INVITE_VERSION,
    authMode: LOCAL_PAIRING_AUTH_MODE,
    serverUrl: input.serverUrl,
    browserOrigin: input.browserOrigin,
    machineId: input.machineId,
    pairSecret: input.pairSecret ?? generateLocalPairingSecret(),
    pairingNonce: input.pairingNonce ?? generateLocalPairingNonce(),
    issuedAt: issuedAt.toISOString(),
    expiresAt: expiresAt.toISOString(),
  });
}

export function encodeLocalPairingInvite(invite: LocalPairingInvite): string {
  const validated = LocalPairingInviteSchema.parse(invite);
  return encodeBase64Url(new TextEncoder().encode(JSON.stringify(validated)));
}

export function decodeLocalPairingInvite(
  token: string | undefined | null,
  expectedBrowserOrigin?: string,
): LocalPairingInvite | null {
  if (!token) {
    return null;
  }
  try {
    const bytes = decodeBase64Url(token.trim());
    const parsed = LocalPairingInviteSchema.safeParse(
      JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)),
    );
    if (!parsed.success) {
      return null;
    }
    if (expectedBrowserOrigin !== undefined && parsed.data.browserOrigin !== expectedBrowserOrigin) {
      return null;
    }
    return parsed.data;
  } catch {
    return null;
  }
}

export function isLocalPairingInviteValid(
  invite: unknown,
  expectedBrowserOrigin: string,
  now: Date = new Date(),
): invite is LocalPairingInvite {
  const parsed = LocalPairingInviteSchema.safeParse(invite);
  if (!parsed.success || parsed.data.browserOrigin !== expectedBrowserOrigin) {
    return false;
  }
  const issuedAt = Date.parse(parsed.data.issuedAt);
  const expiresAt = Date.parse(parsed.data.expiresAt);
  const nowMs = now.getTime();
  return issuedAt <= nowMs + LOCAL_PAIRING_FORWARD_SKEW_MS && expiresAt > nowMs;
}

export function generateLocalPairingSecret(): string {
  return toBase64Url(generatePublicRequestNonce(LOCAL_PAIRING_SECRET_BYTES));
}

export function generateLocalPairingNonce(): string {
  return toBase64Url(generatePublicRequestNonce(LOCAL_PAIRING_NONCE_BYTES));
}

export function encodeBase64Url(bytes: Uint8Array): string {
  return encodeBase64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

export function decodeBase64Url(value: string): Uint8Array {
  if (!value || !/^[A-Za-z0-9_-]+$/.test(value) || value.length % 4 === 1) {
    throw new Error('invalid base64url input');
  }
  const standard = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = standard.padEnd(Math.ceil(standard.length / 4) * 4, '=');
  const decoded = decodeBase64(padded);
  if (encodeBase64Url(decoded) !== value) {
    throw new Error('non-canonical base64url input');
  }
  return decoded;
}

export function isStrictLoopbackServerUrl(value: string): boolean {
  const match = /^http:\/\/127\.0\.0\.1:(\d{1,5})$/.exec(value);
  if (!match) {
    return false;
  }
  const port = Number(match[1]);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    return false;
  }
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:'
      && parsed.hostname === '127.0.0.1'
      && parsed.port === String(port)
      && parsed.pathname === '/'
      && parsed.search === ''
      && parsed.hash === ''
      && parsed.username === ''
      && parsed.password === '';
  } catch {
    return false;
  }
}

function isCanonicalBase64UrlBytes(value: string, byteLength: number): boolean {
  try {
    return decodeBase64Url(value).length === byteLength;
  } catch {
    return false;
  }
}

function isOrigin(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.origin === value
      && parsed.pathname === '/'
      && parsed.search === ''
      && parsed.hash === ''
      && parsed.username === ''
      && parsed.password === '';
  } catch {
    return false;
  }
}

function parseDate(value: Date | string | undefined): Date | null {
  if (value === undefined) {
    return null;
  }
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) {
    throw new Error('Invalid date supplied to local pairing invite');
  }
  return date;
}

function toBase64Url(value: string): string {
  return value.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}
