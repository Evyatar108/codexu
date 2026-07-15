import * as z from 'zod';
import * as ed from '@noble/ed25519';
import { sha256, sha512 } from '@noble/hashes/sha2.js';

// @noble/ed25519 v3 requires a synchronous SHA-512 to be installed before any
// sign/verify call. This is a one-time, deterministic crypto configuration and
// is the same wiring happy-server and happy-cli already use.
ed.hashes.sha512 = (message: Uint8Array) => sha512(message);

// ---------------------------------------------------------------------------
// Base64 (standard RFC 4648 alphabet, padded) — dependency-free so this module
// stays cross-runtime (Node, browsers, and React Native without Buffer). The
// output is byte-for-byte compatible with privacy-kit's encodeBase64/decodeBase64
// used on the happy-server side, so pinned keys and signatures interoperate.
// ---------------------------------------------------------------------------

const BASE64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

const BASE64_LOOKUP: Int16Array = (() => {
  const table = new Int16Array(128).fill(-1);
  for (let i = 0; i < BASE64_ALPHABET.length; i++) {
    table[BASE64_ALPHABET.charCodeAt(i)] = i;
  }
  return table;
})();

export function encodeBase64(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const hasByte1 = i + 1 < bytes.length;
    const hasByte2 = i + 2 < bytes.length;
    const b0 = bytes[i];
    const b1 = hasByte1 ? bytes[i + 1] : 0;
    const b2 = hasByte2 ? bytes[i + 2] : 0;
    const triple = (b0 << 16) | (b1 << 8) | b2;
    out += BASE64_ALPHABET[(triple >> 18) & 0x3f];
    out += BASE64_ALPHABET[(triple >> 12) & 0x3f];
    out += hasByte1 ? BASE64_ALPHABET[(triple >> 6) & 0x3f] : '=';
    out += hasByte2 ? BASE64_ALPHABET[triple & 0x3f] : '=';
  }
  return out;
}

export function decodeBase64(text: string): Uint8Array {
  let clean = '';
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code < 128 && BASE64_LOOKUP[code] !== -1) {
      clean += text[i];
    } else if (text[i] !== '=' && text[i] !== '\n' && text[i] !== '\r' && text[i] !== ' ' && text[i] !== '\t') {
      throw new Error('invalid base64 input');
    }
  }
  const outLen = Math.floor((clean.length * 3) / 4);
  const out = new Uint8Array(outLen);
  let acc = 0;
  let bits = 0;
  let oi = 0;
  for (let i = 0; i < clean.length; i++) {
    acc = (acc << 6) | BASE64_LOOKUP[clean.charCodeAt(i)];
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[oi++] = (acc >> bits) & 0xff;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Signed-request envelope
// ---------------------------------------------------------------------------

export const PUBLIC_DEVICE_PROOF_ENVELOPE_VERSION = 1 as const;

/**
 * Domain-separation prefix for the canonical string that a paired device signs.
 * Binding this into every signature prevents a signature produced for another
 * purpose (e.g. a peer-auth handshake) from being replayed as a device proof.
 */
export const PUBLIC_DEVICE_PROOF_DOMAIN = 'happy-public-device-proof/v1';

/**
 * HTTP + Socket.IO handshake header that carries the base64-encoded JSON
 * envelope. Lower-case because Node/Fastify/Socket.IO normalize header names.
 */
export const PUBLIC_DEVICE_PROOF_HEADER = 'x-happy-device-proof';

/** Default freshness window (5 minutes) for a proof's issuedAt timestamp. */
export const PUBLIC_DEVICE_PROOF_FRESHNESS_MS = 5 * 60 * 1000;

/** Allowed forward clock skew (1 minute) between a device and the server. */
export const PUBLIC_DEVICE_PROOF_CLOCK_SKEW_MS = 60 * 1000;

export const PublicSignedRequestEnvelopeSchema = z.object({
  v: z.literal(PUBLIC_DEVICE_PROOF_ENVELOPE_VERSION),
  keyId: z.string().min(1),
  publicKey: z.string().min(1),
  nonce: z.string().min(1),
  issuedAt: z.number().int().nonnegative(),
  method: z.string().min(1),
  path: z.string().min(1),
  bodyHash: z.string().min(1),
  signature: z.string().min(1),
});

export type PublicSignedRequestEnvelope = z.infer<typeof PublicSignedRequestEnvelopeSchema>;

export function normalizeMethod(method: string): string {
  return method.toUpperCase();
}

export interface CanonicalRequestFields {
  method: string;
  path: string;
  keyId: string;
  publicKey: string;
  nonce: string;
  issuedAt: number;
  bodyHash: string;
}

/**
 * Builds the exact string a device signs. The field order is fixed and each
 * field is on its own line; the values themselves are opaque base64/ascii and
 * never contain a newline, so the encoding is unambiguous.
 */
export function canonicalRequestStringToSign(fields: CanonicalRequestFields): string {
  return [
    PUBLIC_DEVICE_PROOF_DOMAIN,
    normalizeMethod(fields.method),
    canonicalizePublicRequestTarget(fields.path),
    fields.keyId,
    fields.publicKey,
    fields.nonce,
    String(fields.issuedAt),
    fields.bodyHash,
  ].join('\n');
}

/** Canonical request target shared by public HTTP proofs and local proofs. */
export function canonicalizePublicRequestTarget(target: string): string {
  if (!target.startsWith('/') || target.includes('#') || /[\u0000-\u001f\u007f]/.test(target)) {
    throw new Error('invalid proof target');
  }
  for (let index = 0; index < target.length; index += 1) {
    if (target[index] === '%' && !/^[0-9A-Fa-f]{2}$/.test(target.slice(index + 1, index + 3))) {
      throw new Error('invalid proof target encoding');
    }
  }
  decodeURIComponent(target);
  const parsed = new URL(`http://localhost${target}`);
  const pairs = Array.from(parsed.searchParams.entries()).sort(([leftKey, leftValue], [rightKey, rightValue]) => {
    const keyOrder = compareUtf8(leftKey, rightKey);
    return keyOrder !== 0 ? keyOrder : compareUtf8(leftValue, rightValue);
  });
  const query = new URLSearchParams();
  for (const [key, value] of pairs) {
    query.append(key, value);
  }
  const encoded = query.toString();
  return encoded ? `${parsed.pathname}?${encoded}` : parsed.pathname;
}

function compareUtf8(left: string, right: string): number {
  const leftBytes = new TextEncoder().encode(left);
  const rightBytes = new TextEncoder().encode(right);
  const length = Math.min(leftBytes.length, rightBytes.length);
  for (let index = 0; index < length; index += 1) {
    if (leftBytes[index] !== rightBytes[index]) {
      return leftBytes[index]! - rightBytes[index]!;
    }
  }
  return leftBytes.length - rightBytes.length;
}

/** SHA-256 of the raw request body, base64-encoded. Empty body hashes the empty string. */
export function hashRequestBody(body: Uint8Array | string | null | undefined): string {
  let bytes: Uint8Array;
  if (body == null) {
    bytes = new Uint8Array();
  } else if (typeof body === 'string') {
    bytes = new TextEncoder().encode(body);
  } else {
    bytes = body;
  }
  return encodeBase64(sha256(bytes));
}

/** Generates a random base64 nonce. 24 bytes → 192 bits of entropy by default. */
export function generatePublicRequestNonce(byteLength = 24): string {
  const bytes = new Uint8Array(byteLength);
  const cryptoObj = (globalThis as { crypto?: { getRandomValues?: (array: Uint8Array) => Uint8Array } }).crypto;
  if (cryptoObj && typeof cryptoObj.getRandomValues === 'function') {
    cryptoObj.getRandomValues(bytes);
  } else {
    for (let i = 0; i < byteLength; i++) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
  }
  return encodeBase64(bytes);
}

export interface SignPublicRequestInput {
  method: string;
  path: string;
  keyId: string;
  nonce: string;
  issuedAt: number;
  bodyHash: string;
}

/**
 * Produces a signed-request envelope for an already-paired device. `secretKey`
 * is the 32-byte Ed25519 seed; the public key is derived from it so the
 * envelope is internally self-consistent.
 */
export async function signPublicRequest(input: SignPublicRequestInput, secretKey: Uint8Array): Promise<PublicSignedRequestEnvelope> {
  const method = normalizeMethod(input.method);
  const path = canonicalizePublicRequestTarget(input.path);
  const publicKey = encodeBase64(await ed.getPublicKeyAsync(secretKey));
  const canonical = canonicalRequestStringToSign({
    method,
    path,
    keyId: input.keyId,
    publicKey,
    nonce: input.nonce,
    issuedAt: input.issuedAt,
    bodyHash: input.bodyHash,
  });
  const signature = encodeBase64(await ed.signAsync(new TextEncoder().encode(canonical), secretKey));
  return {
    v: PUBLIC_DEVICE_PROOF_ENVELOPE_VERSION,
    keyId: input.keyId,
    publicKey,
    nonce: input.nonce,
    issuedAt: input.issuedAt,
    method,
    path,
    bodyHash: input.bodyHash,
    signature,
  };
}

export interface VerifyPublicRequestContext {
  /** Actual HTTP method of the incoming request. */
  method: string;
  /** Actual matched route path (or URL path) of the incoming request. */
  path: string;
  /** Actual base64 SHA-256 of the incoming body. If provided, it must equal the signed bodyHash. */
  bodyHash?: string;
  /** Pinned device public key (base64). If provided, the envelope's publicKey must match it exactly. */
  expectedPublicKey?: string;
}

export interface PublicRequestVerification {
  ok: boolean;
  reason?: string;
}

/**
 * Cryptographically verifies a signed-request envelope and its binding to the
 * incoming request (method, path, and — when supplied — body hash and pinned
 * key). This is intentionally stateless: freshness (issuedAt) and single-use
 * (nonce) enforcement live in the server-side verifier that owns a clock and a
 * replay cache. Returns { ok:false, reason } rather than throwing so callers
 * fail closed on any error.
 */
export async function verifyPublicRequest(envelope: unknown, context: VerifyPublicRequestContext): Promise<PublicRequestVerification> {
  const parsed = PublicSignedRequestEnvelopeSchema.safeParse(envelope);
  if (!parsed.success) {
    return { ok: false, reason: 'invalid_envelope' };
  }
  const env = parsed.data;
  if (normalizeMethod(env.method) !== normalizeMethod(context.method)) {
    return { ok: false, reason: 'method_mismatch' };
  }
  let target: string;
  try {
    target = canonicalizePublicRequestTarget(context.path);
  } catch {
    return { ok: false, reason: 'path_mismatch' };
  }
  if (env.path !== target) {
    return { ok: false, reason: 'path_mismatch' };
  }

  if (context.bodyHash !== undefined && env.bodyHash !== context.bodyHash) {
    return { ok: false, reason: 'body_hash_mismatch' };
  }
  if (context.expectedPublicKey !== undefined && env.publicKey !== context.expectedPublicKey) {
    return { ok: false, reason: 'public_key_mismatch' };
  }

  let publicKeyBytes: Uint8Array;
  let signatureBytes: Uint8Array;
  try {
    publicKeyBytes = decodeBase64(env.publicKey);
    signatureBytes = decodeBase64(env.signature);
  } catch {
    return { ok: false, reason: 'invalid_base64' };
  }
  if (publicKeyBytes.length !== 32) {
    return { ok: false, reason: 'invalid_public_key_length' };
  }
  if (signatureBytes.length !== 64) {
    return { ok: false, reason: 'invalid_signature_length' };
  }

  const canonical = canonicalRequestStringToSign(env);
  let valid = false;
  try {
    valid = await ed.verifyAsync(signatureBytes, new TextEncoder().encode(canonical), publicKeyBytes);
  } catch {
    valid = false;
  }
  return valid ? { ok: true } : { ok: false, reason: 'signature_invalid' };
}

/**
 * True when a proof's issuedAt falls inside the freshness window relative to
 * `now`, tolerating a small forward clock skew. Server-side helper; kept here so
 * the freshness policy is defined next to the envelope it guards.
 */
export function isPublicProofFresh(
  issuedAt: number,
  now: number,
  windowMs: number = PUBLIC_DEVICE_PROOF_FRESHNESS_MS,
  clockSkewMs: number = PUBLIC_DEVICE_PROOF_CLOCK_SKEW_MS,
): boolean {
  return issuedAt <= now + clockSkewMs && issuedAt >= now - windowMs;
}

/** Encodes an envelope into the base64 header string carried on requests/handshakes. */
export function encodePublicDeviceProofHeader(envelope: PublicSignedRequestEnvelope): string {
  return encodeBase64(new TextEncoder().encode(JSON.stringify(envelope)));
}

/** Parses the base64 header string back into a validated envelope, or null if malformed. */
export function decodePublicDeviceProofHeader(header: string | undefined | null): PublicSignedRequestEnvelope | null {
  if (!header) {
    return null;
  }
  try {
    const json = new TextDecoder().decode(decodeBase64(header));
    const parsed = PublicSignedRequestEnvelopeSchema.safeParse(JSON.parse(json));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Deterministic cross-runtime test vectors
//
// These are the single source of truth for server/app/cli/codex conformance:
// a fixed 32-byte Ed25519 seed and a fixed request produce a fixed public key,
// body hash, canonical string, and signature. Any runtime that implements the
// envelope correctly must reproduce these exact constants. The values are
// computed once from this module (see publicDeviceAuth.test.ts) and pinned.
// ---------------------------------------------------------------------------

export interface PublicDeviceAuthTestVector {
  seedHex: string;
  keyId: string;
  publicKeyBase64: string;
  nonceBase64: string;
  issuedAt: number;
  method: string;
  path: string;
  body: string;
  bodyHashBase64: string;
  canonicalString: string;
  signatureBase64: string;
  envelope: PublicSignedRequestEnvelope;
  headerBase64: string;
}

export const PUBLIC_DEVICE_AUTH_TEST_VECTOR: PublicDeviceAuthTestVector = {
  seedHex: '000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f',
  keyId: 'device-test-key',
  publicKeyBase64: 'A6EHv/POEL4dcN0Y50vAmWfk1jCbpQ1fHdyGZBJVMbg=',
  nonceBase64: 'bm9uY2UtMDAwMDAwMDAwMDAwMDAwMDAwMDA=',
  issuedAt: 1735689600000,
  method: 'POST',
  path: '/pair/connect',
  body: '{"mobileEcdhPublicKey":"AAECAwQFBgcICQoLDA0ODw=="}',
  bodyHashBase64: 'x4jOxy7m4ahMoun9VgIPk36KVKoOaXa7IbYZChfDhiw=',
  canonicalString: 'happy-public-device-proof/v1\nPOST\n/pair/connect\ndevice-test-key\nA6EHv/POEL4dcN0Y50vAmWfk1jCbpQ1fHdyGZBJVMbg=\nbm9uY2UtMDAwMDAwMDAwMDAwMDAwMDAwMDA=\n1735689600000\nx4jOxy7m4ahMoun9VgIPk36KVKoOaXa7IbYZChfDhiw=',
  signatureBase64: '6A31zge0s5yf6XHqLDAp4gdtZ5k0nzSJIk1YF5IdfXiY8kL/5MqAjvNFSgSWN7rDmYD8F21Md+C2R8cRAFzlBw==',
  envelope: {
    v: PUBLIC_DEVICE_PROOF_ENVELOPE_VERSION,
    keyId: 'device-test-key',
    publicKey: 'A6EHv/POEL4dcN0Y50vAmWfk1jCbpQ1fHdyGZBJVMbg=',
    nonce: 'bm9uY2UtMDAwMDAwMDAwMDAwMDAwMDAwMDA=',
    issuedAt: 1735689600000,
    method: 'POST',
    path: '/pair/connect',
    bodyHash: 'x4jOxy7m4ahMoun9VgIPk36KVKoOaXa7IbYZChfDhiw=',
    signature: '6A31zge0s5yf6XHqLDAp4gdtZ5k0nzSJIk1YF5IdfXiY8kL/5MqAjvNFSgSWN7rDmYD8F21Md+C2R8cRAFzlBw==',
  },
  headerBase64: 'eyJ2IjoxLCJrZXlJZCI6ImRldmljZS10ZXN0LWtleSIsInB1YmxpY0tleSI6IkE2RUh2L1BPRUw0ZGNOMFk1MHZBbVdmazFqQ2JwUTFmSGR5R1pCSlZNYmc9Iiwibm9uY2UiOiJibTl1WTJVdE1EQXdNREF3TURBd01EQXdNREF3TURBd01EQT0iLCJpc3N1ZWRBdCI6MTczNTY4OTYwMDAwMCwibWV0aG9kIjoiUE9TVCIsInBhdGgiOiIvcGFpci9jb25uZWN0IiwiYm9keUhhc2giOiJ4NGpPeHk3bTRhaE1vdW45VmdJUGszNktWS29PYVhhN0liWVpDaGZEaGl3PSIsInNpZ25hdHVyZSI6IjZBMzF6Z2UwczV5ZjZYSHFMREFwNGdkdFo1azBuelNKSWsxWUY1SWRmWGlZOGtMLzVNcUFqdk5GU2dTV043ckRtWUQ4RjIxTWQrQzJSOGNSQUZ6bEJ3PT0ifQ==',
};
