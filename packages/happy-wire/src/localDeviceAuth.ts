import * as ed from '@noble/ed25519';
import { sha512 } from '@noble/hashes/sha2.js';
import * as z from 'zod';

import {
  decodeBase64,
  encodeBase64,
  hashRequestBody,
  normalizeMethod,
} from './publicDeviceAuth';
import { decodeBase64Url, encodeBase64Url } from './localPairingInvite';

ed.hashes.sha512 = (message: Uint8Array) => sha512(message);

export const LOCAL_DEVICE_PROOF_ENVELOPE_VERSION = 1 as const;
export const LOCAL_DEVICE_PROOF_DOMAIN = 'happy-local-device-proof/v1';
export const LOCAL_DEVICE_PROOF_HEADER = 'X-Happy-Local-Device-Proof';
export const LOCAL_DEVICE_PROOF_FRESHNESS_MS = 120_000;
export const LOCAL_DEVICE_PROOF_CLOCK_SKEW_MS = 30_000;
export const LOCAL_DEVICE_PROOF_NONCE_BYTES = 24;

const LocalSignedRequestEnvelopeShapeSchema = z.object({
  v: z.literal(LOCAL_DEVICE_PROOF_ENVELOPE_VERSION),
  keyId: z.string().min(1).max(256),
  publicKey: z.string().min(1),
  nonce: z.string().min(1),
  issuedAt: z.number().int().nonnegative(),
  method: z.string().regex(/^[A-Z]+$/),
  target: z.string().min(1),
  bodyHash: z.string().min(1),
  signature: z.string().min(1),
}).strict();

export const LocalSignedRequestEnvelopeSchema = LocalSignedRequestEnvelopeShapeSchema.superRefine((envelope, context) => {
  if (!isCanonicalBase64Bytes(envelope.publicKey, 32)) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['publicKey'], message: 'invalid Ed25519 public key' });
  }
  if (!isCanonicalBase64UrlBytes(envelope.nonce, LOCAL_DEVICE_PROOF_NONCE_BYTES)) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['nonce'], message: 'invalid proof nonce' });
  }
  try {
    if (canonicalizeLocalRequestTarget(envelope.target) !== envelope.target) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ['target'], message: 'target is not canonical' });
    }
  } catch {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['target'], message: 'invalid proof target' });
  }
  if (!isCanonicalBase64Bytes(envelope.bodyHash, 32)) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['bodyHash'], message: 'invalid SHA-256 body hash' });
  }
  if (!isCanonicalBase64Bytes(envelope.signature, 64)) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['signature'], message: 'invalid Ed25519 signature' });
  }
});

export type LocalSignedRequestEnvelope = z.infer<typeof LocalSignedRequestEnvelopeSchema>;

export interface LocalCanonicalRequestFields {
  method: string;
  target: string;
  keyId: string;
  publicKey: string;
  nonce: string;
  issuedAt: number;
  bodyHash: string;
}

export interface SignLocalRequestInput {
  method: string;
  target: string;
  keyId: string;
  nonce: string;
  issuedAt: number;
  bodyHash: string;
}

export interface VerifyLocalRequestContext {
  method: string;
  target: string;
  bodyHash?: string;
  expectedPublicKey?: string;
}

export interface LocalRequestVerification {
  ok: boolean;
  reason?: string;
}

export function canonicalizeLocalRequestTarget(target: string): string {
  if (!target.startsWith('/') || target.includes('#') || /[\u0000-\u001f\u007f]/.test(target)) {
    throw new Error('invalid proof target');
  }
  validatePercentEncodingAndUtf8(target);

  const parsed = new URL(`http://localhost${target}`);
  const pairs = Array.from(parsed.searchParams.entries()).sort(([leftKey, leftValue], [rightKey, rightValue]) => {
    const keyOrder = compareUtf8(leftKey, rightKey);
    return keyOrder !== 0 ? keyOrder : compareUtf8(leftValue, rightValue);
  });
  const search = new URLSearchParams();
  for (const [key, value] of pairs) {
    search.append(key, value);
  }
  const encodedQuery = search.toString();
  return encodedQuery ? `${parsed.pathname}?${encodedQuery}` : parsed.pathname;
}

export function canonicalLocalRequestStringToSign(fields: LocalCanonicalRequestFields): string {
  return [
    LOCAL_DEVICE_PROOF_DOMAIN,
    normalizeMethod(fields.method),
    canonicalizeLocalRequestTarget(fields.target),
    fields.keyId,
    fields.publicKey,
    fields.nonce,
    String(fields.issuedAt),
    fields.bodyHash,
  ].join('\n');
}

export async function signLocalRequest(
  input: SignLocalRequestInput,
  secretKey: Uint8Array,
): Promise<LocalSignedRequestEnvelope> {
  const publicKey = encodeBase64(await ed.getPublicKeyAsync(secretKey));
  const envelope: LocalSignedRequestEnvelope = {
    v: LOCAL_DEVICE_PROOF_ENVELOPE_VERSION,
    keyId: input.keyId,
    publicKey,
    nonce: input.nonce,
    issuedAt: input.issuedAt,
    method: normalizeMethod(input.method),
    target: canonicalizeLocalRequestTarget(input.target),
    bodyHash: input.bodyHash,
    signature: '',
  };
  const canonical = canonicalLocalRequestStringToSign(envelope);
  envelope.signature = encodeBase64(await ed.signAsync(new TextEncoder().encode(canonical), secretKey));
  return LocalSignedRequestEnvelopeSchema.parse(envelope);
}

export async function verifyLocalRequest(
  envelope: unknown,
  context: VerifyLocalRequestContext,
): Promise<LocalRequestVerification> {
  const parsed = LocalSignedRequestEnvelopeSchema.safeParse(envelope);
  if (!parsed.success) {
    return { ok: false, reason: 'invalid_envelope' };
  }
  const proof = parsed.data;
  let target: string;
  try {
    target = canonicalizeLocalRequestTarget(context.target);
  } catch {
    return { ok: false, reason: 'invalid_target' };
  }
  if (proof.method !== normalizeMethod(context.method)) {
    return { ok: false, reason: 'method_mismatch' };
  }
  if (proof.target !== target) {
    return { ok: false, reason: 'target_mismatch' };
  }
  if (context.bodyHash !== undefined && proof.bodyHash !== context.bodyHash) {
    return { ok: false, reason: 'body_hash_mismatch' };
  }
  if (context.expectedPublicKey !== undefined && proof.publicKey !== context.expectedPublicKey) {
    return { ok: false, reason: 'public_key_mismatch' };
  }

  try {
    const valid = await ed.verifyAsync(
      decodeBase64(proof.signature),
      new TextEncoder().encode(canonicalLocalRequestStringToSign(proof)),
      decodeBase64(proof.publicKey),
    );
    return valid ? { ok: true } : { ok: false, reason: 'signature_invalid' };
  } catch {
    return { ok: false, reason: 'signature_invalid' };
  }
}

export function isLocalProofFresh(
  issuedAt: number,
  now: number,
  freshnessMs = LOCAL_DEVICE_PROOF_FRESHNESS_MS,
  clockSkewMs = LOCAL_DEVICE_PROOF_CLOCK_SKEW_MS,
): boolean {
  return issuedAt >= now - freshnessMs && issuedAt <= now + clockSkewMs;
}

export function encodeLocalDeviceProofHeader(envelope: LocalSignedRequestEnvelope): string {
  return encodeBase64Url(new TextEncoder().encode(JSON.stringify(LocalSignedRequestEnvelopeSchema.parse(envelope))));
}

export function decodeLocalDeviceProofHeader(
  header: string | undefined | null,
): LocalSignedRequestEnvelope | null {
  if (!header) {
    return null;
  }
  try {
    const json = new TextDecoder('utf-8', { fatal: true }).decode(decodeBase64Url(header));
    const parsed = LocalSignedRequestEnvelopeSchema.safeParse(JSON.parse(json));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export function hashLocalRequestBody(body: Uint8Array | string | null | undefined): string {
  return hashRequestBody(body);
}

function validatePercentEncodingAndUtf8(value: string): void {
  for (let index = 0; index < value.length; index += 1) {
    if (value[index] === '%' && !/^[0-9A-Fa-f]{2}$/.test(value.slice(index + 1, index + 3))) {
      throw new Error('invalid proof target encoding');
    }
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdfff) {
      const isHigh = code <= 0xdbff;
      const next = value.charCodeAt(index + 1);
      if (!isHigh || next < 0xdc00 || next > 0xdfff) {
        throw new Error('invalid proof target unicode');
      }
      index += 1;
    }
  }
  decodeURIComponent(value);
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

function isCanonicalBase64Bytes(value: string, byteLength: number): boolean {
  try {
    const decoded = decodeBase64(value);
    return decoded.length === byteLength && encodeBase64(decoded) === value;
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
