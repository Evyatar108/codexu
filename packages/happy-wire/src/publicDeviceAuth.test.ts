import { describe, expect, it } from 'vitest';
import {
  PUBLIC_DEVICE_AUTH_TEST_VECTOR,
  PUBLIC_DEVICE_PROOF_DOMAIN,
  PUBLIC_DEVICE_PROOF_ENVELOPE_VERSION,
  PublicSignedRequestEnvelopeSchema,
  canonicalRequestStringToSign,
  decodeBase64,
  decodePublicDeviceProofHeader,
  encodeBase64,
  encodePublicDeviceProofHeader,
  hashRequestBody,
  isPublicProofFresh,
  signPublicRequest,
  verifyPublicRequest,
} from './index';

function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

describe('base64 (standard, padded)', () => {
  it('round-trips arbitrary bytes and matches padded RFC 4648 output', () => {
    expect(encodeBase64(new Uint8Array([250, 251, 252]))).toBe('+vv8');
    expect(encodeBase64(new Uint8Array([250, 251, 252, 253]))).toBe('+vv8/Q==');
    expect(encodeBase64(new Uint8Array([250, 251, 252, 253, 254]))).toBe('+vv8/f4=');
    for (let len = 0; len < 40; len++) {
      const bytes = new Uint8Array(len);
      for (let i = 0; i < len; i++) bytes[i] = (i * 37 + 11) & 0xff;
      expect(Array.from(decodeBase64(encodeBase64(bytes)))).toEqual(Array.from(bytes));
    }
  });

  it('rejects non-base64 garbage', () => {
    expect(() => decodeBase64('not base64 %%%')).toThrow();
  });
});

describe('canonical string + body hash', () => {
  it('binds the domain prefix and every field in a fixed order', () => {
    const s = canonicalRequestStringToSign({
      method: 'post',
      path: '/x',
      keyId: 'k',
      publicKey: 'pk',
      nonce: 'n',
      issuedAt: 42,
      bodyHash: 'bh',
    });
    expect(s).toBe([PUBLIC_DEVICE_PROOF_DOMAIN, 'POST', '/x', 'k', 'pk', 'n', '42', 'bh'].join('\n'));
  });

  it('hashes the empty body deterministically (sha256 of empty input)', () => {
    // base64 of the well-known SHA-256 of the empty string.
    expect(hashRequestBody('')).toBe('47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU=');
    expect(hashRequestBody(null)).toBe('47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU=');
    expect(hashRequestBody(undefined)).toBe('47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU=');
  });
});

describe('deterministic cross-runtime test vector', () => {
  const v = PUBLIC_DEVICE_AUTH_TEST_VECTOR;

  it('the pinned vector is internally consistent (recompute matches constants)', async () => {
    const seed = hexToBytes(v.seedHex);
    const bodyHash = hashRequestBody(v.body);
    expect(bodyHash).toBe(v.bodyHashBase64);

    const canonical = canonicalRequestStringToSign({
      method: v.method,
      path: v.path,
      keyId: v.keyId,
      publicKey: v.publicKeyBase64,
      nonce: v.nonceBase64,
      issuedAt: v.issuedAt,
      bodyHash: v.bodyHashBase64,
    });
    expect(canonical).toBe(v.canonicalString);

    const envelope = await signPublicRequest(
      {
        method: v.method,
        path: v.path,
        keyId: v.keyId,
        nonce: v.nonceBase64,
        issuedAt: v.issuedAt,
        bodyHash: v.bodyHashBase64,
      },
      seed,
    );
    expect(envelope.publicKey).toBe(v.publicKeyBase64);
    expect(envelope.signature).toBe(v.signatureBase64);
    expect(envelope).toEqual(v.envelope);
    expect(encodePublicDeviceProofHeader(envelope)).toBe(v.headerBase64);
  });

  it('verifies the pinned envelope against the matching request context', async () => {
    const result = await verifyPublicRequest(v.envelope, {
      method: v.method,
      path: v.path,
      bodyHash: v.bodyHashBase64,
      expectedPublicKey: v.publicKeyBase64,
    });
    expect(result).toEqual({ ok: true });
  });

  it('round-trips through the header encoding', () => {
    const decoded = decodePublicDeviceProofHeader(v.headerBase64);
    expect(decoded).toEqual(v.envelope);
  });
});

describe('verifyPublicRequest failure modes (fail closed)', () => {
  const v = PUBLIC_DEVICE_AUTH_TEST_VECTOR;

  it('rejects a tampered method', async () => {
    const r = await verifyPublicRequest(v.envelope, { method: 'GET', path: v.path });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('method_mismatch');
  });

  it('rejects a tampered path', async () => {
    const r = await verifyPublicRequest(v.envelope, { method: v.method, path: '/pair/complete' });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('path_mismatch');
  });

  it('rejects a mismatched body hash', async () => {
    const r = await verifyPublicRequest(v.envelope, { method: v.method, path: v.path, bodyHash: hashRequestBody('tampered') });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('body_hash_mismatch');
  });

  it('rejects a non-pinned public key', async () => {
    const r = await verifyPublicRequest(v.envelope, { method: v.method, path: v.path, expectedPublicKey: 'AAAA' });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('public_key_mismatch');
  });

  it('rejects a corrupted signature', async () => {
    const tampered = { ...v.envelope, signature: encodeBase64(new Uint8Array(64)) };
    const r = await verifyPublicRequest(tampered, { method: v.method, path: v.path });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('signature_invalid');
  });

  it('rejects a signature over a different path (path swapped after signing)', async () => {
    const forged = { ...v.envelope, path: '/pair/complete' };
    const r = await verifyPublicRequest(forged, { method: v.method, path: '/pair/complete' });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('signature_invalid');
  });

  it('rejects a structurally invalid envelope', async () => {
    const r = await verifyPublicRequest({ nope: true }, { method: 'GET', path: '/' });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('invalid_envelope');
  });

  it('schema rejects the wrong envelope version', () => {
    const parsed = PublicSignedRequestEnvelopeSchema.safeParse({ ...v.envelope, v: 2 });
    expect(parsed.success).toBe(false);
    expect(PUBLIC_DEVICE_PROOF_ENVELOPE_VERSION).toBe(1);
  });
});

describe('isPublicProofFresh', () => {
  it('accepts a proof inside the window and rejects stale/future proofs', () => {
    const now = 1_000_000_000;
    expect(isPublicProofFresh(now, now)).toBe(true);
    expect(isPublicProofFresh(now - 4 * 60 * 1000, now)).toBe(true);
    expect(isPublicProofFresh(now - 6 * 60 * 1000, now)).toBe(false);
    expect(isPublicProofFresh(now + 30 * 1000, now)).toBe(true);
    expect(isPublicProofFresh(now + 5 * 60 * 1000, now)).toBe(false);
  });
});
