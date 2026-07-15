import {
    decodePublicPairingInvite,
    isPublicPairingInviteValid,
    PairCompleteResponseSchema,
    PUBLIC_DEVICE_PROOF_HEADER,
    verifyPairCompleteResponse,
    type PublicPairingInvite,
} from '@slopus/happy-wire';

import { generateDeviceKeypair, generateSecureNonce, type DeviceKeypair } from './deviceKeypair';
import { buildPublicDeviceProofHeader } from './publicDeviceProof';
import { TokenStorage, type AuthCredentials } from './tokenStorage';

// Header names the app SENDS. Cloudflare Access service-token headers are
// case-insensitive on the wire; the happy-server edge check reads them
// lowercased (cf-access-client-id / cf-access-client-secret). The pairing gate
// headers gate the pre-enrollment /pair/complete route in public mode.
// Source of truth: packages/happy-server/sources/app/api/auth/remoteDeviceAuth.ts
export const CF_ACCESS_CLIENT_ID_HEADER = 'CF-Access-Client-Id';
export const CF_ACCESS_CLIENT_SECRET_HEADER = 'CF-Access-Client-Secret';
export const PAIRING_SECRET_HEADER = 'x-happy-pairing-secret';
export const PAIRING_NONCE_HEADER = 'x-happy-pairing-nonce';

export type PublicEnrollmentErrorCode =
    | 'invalid_invite'
    | 'invite_expired'
    | 'network_error'
    | 'pairing_denied'
    | 'pair_failed'
    | 'invalid_response';

export class PublicEnrollmentError extends Error {
    code: PublicEnrollmentErrorCode;
    constructor(code: PublicEnrollmentErrorCode, message?: string) {
        super(message ?? code);
        this.code = code;
        this.name = 'PublicEnrollmentError';
    }
}

export interface PublicEnrollmentResult {
    credentials: AuthCredentials;
    invite: PublicPairingInvite;
}

export interface PublicEnrollmentDeps {
    fetch?: typeof fetch;
    generateKeypair?: () => Promise<DeviceKeypair>;
    generateNonce?: () => string;
    now?: () => number;
    getCredentialsList?: () => Promise<AuthCredentials[]>;
}

/** Strip a trailing slash so `${serverUrl}/path` never double-slashes. */
function normalizeServerUrl(url: string): string {
    return url.replace(/\/+$/, '');
}

/**
 * Completes first-contact enrollment against a public happy-server from a
 * base64url pairing invite:
 *   1. decode + validate the invite (schema + issued/expiry window),
 *   2. generate a fresh Ed25519 device keypair,
 *   3. POST /pair/complete carrying the Cloudflare Access service-token headers
 *      (edge auth) + the one-time pairing secret + a single-use pairing nonce,
 *      forwarding the device public key so a future server release can pin it,
 *   4. assemble AuthCredentials with the Access creds + device keypair persisted
 *      so every later request presents a device proof.
 *
 * Pure + dependency-injected so it is unit-testable without a device runtime.
 * The caller persists the returned credentials (e.g. via AuthContext.login).
 */
export async function enrollPublicServer(
    inviteToken: string,
    deps: PublicEnrollmentDeps = {},
): Promise<PublicEnrollmentResult> {
    const doFetch = deps.fetch ?? fetch;
    const genKeypair = deps.generateKeypair ?? generateDeviceKeypair;
    const genNonce = deps.generateNonce ?? generateSecureNonce;
    const nowMs = deps.now ? deps.now() : Date.now();

    const invite = decodePublicPairingInvite(inviteToken);
    if (!invite) {
        throw new PublicEnrollmentError('invalid_invite');
    }
    if (!isPublicPairingInviteValid(invite, new Date(nowMs))) {
        throw new PublicEnrollmentError('invite_expired');
    }

    const keypair = await genKeypair();
    const serverUrl = normalizeServerUrl(invite.serverUrl);
    const body = JSON.stringify({
        version: 1,
        machineId: invite.machineId,
        deviceEd25519PublicKey: keypair.publicKey,
        deviceKeyId: keypair.keyId,
    });
    const proof = await buildPublicDeviceProofHeader(
        { keyId: keypair.keyId, secretKey: keypair.secretKey },
        { method: 'POST', path: '/pair/complete', body },
        genNonce(),
        nowMs,
    );

    let response: Response;
    try {
        response = await doFetch(`${serverUrl}/pair/complete`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                [CF_ACCESS_CLIENT_ID_HEADER]: invite.cloudflareAccess.clientId,
                [CF_ACCESS_CLIENT_SECRET_HEADER]: invite.cloudflareAccess.clientSecret,
                [PAIRING_SECRET_HEADER]: invite.pairSecret,
                [PAIRING_NONCE_HEADER]: genNonce(),
                [PUBLIC_DEVICE_PROOF_HEADER]: proof,
            },
            body,
        });
    } catch (error) {
        throw new PublicEnrollmentError('network_error', error instanceof Error ? error.message : undefined);
    }

    if (response.status === 401) {
        // Edge (CF-Access) denial or pairing-gate denial both surface as 401.
        throw new PublicEnrollmentError('pairing_denied');
    }
    if (!response.ok) {
        throw new PublicEnrollmentError('pair_failed', `status ${response.status}`);
    }

    let payload: unknown;
    try {
        payload = await response.json();
    } catch {
        throw new PublicEnrollmentError('invalid_response');
    }
    const parsed = PairCompleteResponseSchema.safeParse(payload);
    if (!parsed.success || !await verifyPairCompleteResponse(parsed.data)) {
        throw new PublicEnrollmentError('invalid_response');
    }
    const machine = parsed.data.machine;
    if (
        machine.machineId !== invite.machineId
        || parsed.data.profile.id !== invite.machineId
        || parsed.data.pairedDevice.keyId !== keypair.keyId
        || parsed.data.pairedDevice.publicKey !== keypair.publicKey
    ) {
        throw new PublicEnrollmentError('invalid_response', 'pairing response identity mismatch');
    }
    const existing = (await (deps.getCredentialsList ?? (() => TokenStorage.getCredentialsList()))())
        .find(credentials => credentials.machineId === invite.machineId);
    if (
        existing?.serverEd25519PublicKey
        && existing.serverEd25519PublicKey !== machine.ed25519PublicKey
    ) {
        throw new PublicEnrollmentError('invalid_response', 'server identity changed');
    }

    const credentials: AuthCredentials = {
        authMode: 'paired-device',
        machineId: machine.machineId,
        // The invite URL is the address the app just reached through Cloudflare,
        // so it is authoritative for later requests (the server-reported
        // tunnelUrl may be a private/loopback fallback).
        tunnelUrl: serverUrl,
        firstSeenAt: existing?.firstSeenAt ?? nowMs,
        cloudflareAccessClientId: invite.cloudflareAccess.clientId,
        cloudflareAccessClientSecret: invite.cloudflareAccess.clientSecret,
        deviceKeyId: keypair.keyId,
        devicePublicKey: keypair.publicKey,
        deviceSecretKey: keypair.secretKey,
        serverEd25519PublicKey: machine.ed25519PublicKey,
        serverEd25519Fingerprint: machine.ed25519Fingerprint,
    };

    return { credentials, invite };
}
