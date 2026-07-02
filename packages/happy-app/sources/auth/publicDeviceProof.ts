import * as ed from '@noble/ed25519';
import { sha512 } from '@noble/hashes/sha2.js';
import {
    decodeBase64,
    encodePublicDeviceProofHeader,
    hashRequestBody,
    signPublicRequest,
} from '@slopus/happy-wire';

// Defensive: ensure the @noble sha512 sync hook is installed even if this module
// resolves a different @noble/ed25519 instance than happy-wire's dist. Idempotent.
ed.hashes.sha512 = (message: Uint8Array) => sha512(message);

export interface DeviceProofIdentity {
    keyId: string;
    /** Base64 Ed25519 seed (32 bytes). */
    secretKey: string;
}

export interface DeviceProofBinding {
    method: string;
    path: string;
    body?: Uint8Array | string | null;
}

/**
 * Builds the base64 `x-happy-device-proof` header value for a single request.
 * The envelope is produced by happy-wire's signPublicRequest so it is byte-for-
 * byte identical to the server-accepted deterministic test vector. `nonce` and
 * `issuedAt` are injected by the caller (single-use, fresh per request).
 */
export async function buildPublicDeviceProofHeader(
    identity: DeviceProofIdentity,
    binding: DeviceProofBinding,
    nonce: string,
    issuedAt: number,
): Promise<string> {
    const secretKey = decodeBase64(identity.secretKey);
    const envelope = await signPublicRequest({
        method: binding.method,
        path: binding.path,
        keyId: identity.keyId,
        nonce,
        issuedAt,
        bodyHash: hashRequestBody(binding.body ?? null),
    }, secretKey);
    return encodePublicDeviceProofHeader(envelope);
}
