import { getRandomBytes } from 'expo-crypto';
import * as ed from '@noble/ed25519';
import { sha512 } from '@noble/hashes/sha2.js';
import { encodeBase64 } from '@slopus/happy-wire';

// @noble/ed25519 v3 requires a synchronous SHA-512 implementation to be
// installed before any sign/verify/derive call. happy-wire's dist installs the
// same hook at import time; we set it here too so this module works even when it
// resolves a distinct @noble/ed25519 instance under Metro or the test runner.
// The hook is pure JS (no WebCrypto), so it is Hermes-safe.
ed.hashes.sha512 = (message: Uint8Array) => sha512(message);

const DEVICE_SEED_BYTES = 32;
const DEVICE_KEY_ID_BYTES = 16;

export interface DeviceKeypair {
    /** Opaque per-device identifier the server pins alongside the public key. */
    keyId: string;
    /** Base64 Ed25519 public key (32 bytes). */
    publicKey: string;
    /** Base64 Ed25519 seed / secret key (32 bytes). Sensitive; store via SecureStore. */
    secretKey: string;
}

/**
 * Generates a fresh Ed25519 device identity for public-server pairing. The
 * 32-byte seed is sourced from expo-crypto's platform CSPRNG (the same source
 * the OAuth PKCE flow already relies on on-device), never from @noble's
 * WebCrypto-dependent randomBytes, so it works under Hermes.
 */
export async function generateDeviceKeypair(): Promise<DeviceKeypair> {
    const seed = getRandomBytes(DEVICE_SEED_BYTES);
    const publicKey = await ed.getPublicKeyAsync(seed);
    return {
        keyId: toBase64Url(getRandomBytes(DEVICE_KEY_ID_BYTES)),
        publicKey: encodeBase64(publicKey),
        secretKey: encodeBase64(seed),
    };
}

/**
 * Fresh base64 nonce sourced from the platform CSPRNG for device-proof and
 * pairing replay protection. Uses expo-crypto rather than @noble's
 * `generatePublicRequestNonce` (which falls back to Math.random when
 * globalThis.crypto is absent, as it is on Hermes).
 */
export function generateSecureNonce(byteLength = 24): string {
    return encodeBase64(getRandomBytes(byteLength));
}

function toBase64Url(bytes: Uint8Array): string {
    return encodeBase64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}
