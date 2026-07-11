import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import {
  LOCAL_DEVICE_PROOF_CLOCK_SKEW_MS,
  LOCAL_DEVICE_PROOF_FRESHNESS_MS,
  LocalSignedRequestEnvelopeSchema,
  canonicalLocalRequestStringToSign,
  canonicalizeLocalRequestTarget,
  decodeLocalDeviceProofHeader,
  encodeLocalDeviceProofHeader,
  hashLocalRequestBody,
  isLocalProofFresh,
  signLocalRequest,
  verifyLocalRequest,
} from './index';

interface LocalVectors {
  proof: {
    seedHex: string;
    keyId: string;
    publicKeyBase64: string;
    nonceBase64Url: string;
    issuedAt: number;
    method: string;
    targetInput: string;
    canonicalTarget: string;
    body: string;
    bodyHashBase64: string;
    canonicalString: string;
    signatureBase64: string;
    envelope: Record<string, unknown>;
    headerBase64Url: string;
  };
  canonicalTargets: Array<{ input: string; canonical: string }>;
  invalidTargets: string[];
}

const vectors = JSON.parse(
  readFileSync(new URL('./fixtures/happy_local_v1_vectors.json', import.meta.url), 'utf8'),
) as LocalVectors;

function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let index = 0; index < out.length; index += 1) {
    out[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16);
  }
  return out;
}

describe('local request target canonicalization', () => {
  it('matches every shared Rust/TypeScript canonical target vector', () => {
    for (const vector of vectors.canonicalTargets) {
      expect(canonicalizeLocalRequestTarget(vector.input)).toBe(vector.canonical);
    }
  });

  it('rejects malformed percent encodings and invalid UTF-8', () => {
    for (const target of vectors.invalidTargets) {
      expect(() => canonicalizeLocalRequestTarget(target), target).toThrow();
    }
  });
});

describe('local device proof', () => {
  const vector = vectors.proof;

  it('recomputes the exact cross-language body hash, canonical string, signature, and header', async () => {
    expect(canonicalizeLocalRequestTarget(vector.targetInput)).toBe(vector.canonicalTarget);
    expect(hashLocalRequestBody(vector.body)).toBe(vector.bodyHashBase64);
    expect(canonicalLocalRequestStringToSign({
      method: vector.method,
      target: vector.targetInput,
      keyId: vector.keyId,
      publicKey: vector.publicKeyBase64,
      nonce: vector.nonceBase64Url,
      issuedAt: vector.issuedAt,
      bodyHash: vector.bodyHashBase64,
    })).toBe(vector.canonicalString);

    const envelope = await signLocalRequest({
      method: vector.method,
      target: vector.targetInput,
      keyId: vector.keyId,
      nonce: vector.nonceBase64Url,
      issuedAt: vector.issuedAt,
      bodyHash: vector.bodyHashBase64,
    }, hexToBytes(vector.seedHex));

    expect(envelope).toEqual(vector.envelope);
    expect(envelope.publicKey).toBe(vector.publicKeyBase64);
    expect(envelope.signature).toBe(vector.signatureBase64);
    expect(encodeLocalDeviceProofHeader(envelope)).toBe(vector.headerBase64Url);
    expect(decodeLocalDeviceProofHeader(vector.headerBase64Url)).toEqual(envelope);
  });

  it('verifies the fixture and fails closed on request/key/body/signature changes', async () => {
    const envelope = LocalSignedRequestEnvelopeSchema.parse(vector.envelope);
    await expect(verifyLocalRequest(envelope, {
      method: vector.method,
      target: vector.targetInput,
      bodyHash: vector.bodyHashBase64,
      expectedPublicKey: vector.publicKeyBase64,
    })).resolves.toEqual({ ok: true });
    await expect(verifyLocalRequest(envelope, {
      method: 'GET',
      target: vector.targetInput,
    })).resolves.toMatchObject({ ok: false, reason: 'method_mismatch' });
    await expect(verifyLocalRequest(envelope, {
      method: vector.method,
      target: '/pair/complete',
    })).resolves.toMatchObject({ ok: false, reason: 'target_mismatch' });
    await expect(verifyLocalRequest(envelope, {
      method: vector.method,
      target: vector.targetInput,
      bodyHash: hashLocalRequestBody('tampered'),
    })).resolves.toMatchObject({ ok: false, reason: 'body_hash_mismatch' });
    await expect(verifyLocalRequest(envelope, {
      method: vector.method,
      target: vector.targetInput,
      expectedPublicKey: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
    })).resolves.toMatchObject({ ok: false, reason: 'public_key_mismatch' });
    await expect(verifyLocalRequest({
      ...envelope,
      signature: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==',
    }, {
      method: vector.method,
      target: vector.targetInput,
    })).resolves.toMatchObject({ ok: false, reason: 'signature_invalid' });
  });

  it('enforces the frozen 120-second freshness and 30-second forward skew', () => {
    const now = vector.issuedAt;
    expect(isLocalProofFresh(now, now)).toBe(true);
    expect(isLocalProofFresh(now - LOCAL_DEVICE_PROOF_FRESHNESS_MS, now)).toBe(true);
    expect(isLocalProofFresh(now - LOCAL_DEVICE_PROOF_FRESHNESS_MS - 1, now)).toBe(false);
    expect(isLocalProofFresh(now + LOCAL_DEVICE_PROOF_CLOCK_SKEW_MS, now)).toBe(true);
    expect(isLocalProofFresh(now + LOCAL_DEVICE_PROOF_CLOCK_SKEW_MS + 1, now)).toBe(false);
  });
});
