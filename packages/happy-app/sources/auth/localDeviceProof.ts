import {
    decodeBase64,
    encodeLocalDeviceProofHeader,
    hashLocalRequestBody,
    signLocalRequest,
} from '@slopus/happy-wire';

export interface LocalDeviceProofIdentity {
    keyId: string;
    /** Base64 Ed25519 seed (32 bytes). */
    secretKey: string;
}

export interface LocalDeviceProofBinding {
    method: string;
    target: string;
    body?: Uint8Array | string | null;
}

export async function buildLocalDeviceProofHeader(
    identity: LocalDeviceProofIdentity,
    binding: LocalDeviceProofBinding,
    nonce: string,
    issuedAt: number,
): Promise<string> {
    const envelope = await signLocalRequest({
        method: binding.method,
        target: binding.target,
        keyId: identity.keyId,
        nonce,
        issuedAt,
        bodyHash: hashLocalRequestBody(binding.body ?? null),
    }, decodeBase64(identity.secretKey));
    return encodeLocalDeviceProofHeader(envelope);
}
