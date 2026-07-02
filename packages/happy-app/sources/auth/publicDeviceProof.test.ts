import { describe, expect, it } from 'vitest';
import {
    PUBLIC_DEVICE_AUTH_TEST_VECTOR,
    decodePublicDeviceProofHeader,
    encodeBase64,
} from '@slopus/happy-wire';

import { buildPublicDeviceProofHeader } from './publicDeviceProof';

function hexToBytes(hex: string): Uint8Array {
    const out = new Uint8Array(hex.length / 2);
    for (let i = 0; i < out.length; i++) {
        out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
    }
    return out;
}

describe('publicDeviceProof', () => {
    // Proves the app's proof builder — running @noble/ed25519 with the pure-JS
    // sha512 hook and no WebCrypto — reproduces the exact header the happy-server
    // verifier accepts, per the shared cross-runtime test vector.
    it('reproduces the server-accepted proof header for the shared test vector', async () => {
        const v = PUBLIC_DEVICE_AUTH_TEST_VECTOR;
        const secretKey = encodeBase64(hexToBytes(v.seedHex));

        const header = await buildPublicDeviceProofHeader(
            { keyId: v.keyId, secretKey },
            { method: v.method, path: v.path, body: v.body },
            v.nonceBase64,
            v.issuedAt,
        );

        expect(header).toBe(v.headerBase64);
        expect(decodePublicDeviceProofHeader(header)).toEqual(v.envelope);
    });

    it('hashes an empty body for GET socket-handshake bindings', async () => {
        const v = PUBLIC_DEVICE_AUTH_TEST_VECTOR;
        const secretKey = encodeBase64(hexToBytes(v.seedHex));

        const header = await buildPublicDeviceProofHeader(
            { keyId: v.keyId, secretKey },
            { method: 'GET', path: '/v1/updates' },
            v.nonceBase64,
            v.issuedAt,
        );

        const envelope = decodePublicDeviceProofHeader(header);
        expect(envelope?.method).toBe('GET');
        expect(envelope?.path).toBe('/v1/updates');
        // SHA-256 of the empty byte string, base64 — the fixed empty-body hash.
        expect(envelope?.bodyHash).toBe('47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU=');
    });
});
