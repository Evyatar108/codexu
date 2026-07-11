import {
    LOCAL_DEVICE_PROOF_HEADER,
    LOCAL_PAIRING_NONCE_HEADER,
    LOCAL_PAIRING_SECRET_HEADER,
    decodeLocalPairingInvite,
    isLocalPairingInviteValid,
    type LocalPairingInvite,
} from '@slopus/happy-wire';

import { buildLocalDeviceProofHeader } from './localDeviceProof';
import { generateDeviceKeypair, generateSecureBase64UrlNonce, type DeviceKeypair } from './deviceKeypair';
import { TokenStorage, type AuthCredentials } from './tokenStorage';

export type LocalEnrollmentErrorCode =
    | 'invalid_invite'
    | 'invite_expired'
    | 'unsupported_platform'
    | 'network_error'
    | 'pairing_denied'
    | 'pair_failed'
    | 'invalid_response';

export class LocalEnrollmentError extends Error {
    readonly code: LocalEnrollmentErrorCode;

    constructor(code: LocalEnrollmentErrorCode, message?: string) {
        super(message ?? code);
        this.code = code;
        this.name = 'LocalEnrollmentError';
    }
}

export interface LocalEnrollmentResult {
    credentials: AuthCredentials;
    invite: LocalPairingInvite;
    reusedDeviceKey: boolean;
}

export interface LocalEnrollmentDeps {
    fetch?: typeof fetch;
    getCredentialsList?: () => Promise<AuthCredentials[]>;
    generateKeypair?: () => Promise<DeviceKeypair>;
    generateProofNonce?: () => string;
    now?: () => number;
    browserOrigin?: string;
}

export async function enrollLocalServer(
    inviteToken: string,
    deps: LocalEnrollmentDeps = {},
): Promise<LocalEnrollmentResult> {
    const nowMs = deps.now ? deps.now() : Date.now();
    const browserOrigin = deps.browserOrigin ?? getBrowserOrigin();
    if (!browserOrigin) {
        throw new LocalEnrollmentError('unsupported_platform');
    }

    const invite = decodeLocalPairingInvite(inviteToken, browserOrigin);
    if (!invite) {
        throw new LocalEnrollmentError('invalid_invite');
    }
    if (!isLocalPairingInviteValid(invite, browserOrigin, new Date(nowMs))) {
        throw new LocalEnrollmentError('invite_expired');
    }

    const getCredentialsList = deps.getCredentialsList ?? (() => TokenStorage.getCredentialsList());
    const existing = (await getCredentialsList()).find(item => item.machineId === invite.machineId);
    const reusableKeypair = getReusableKeypair(existing);
    const keypair = reusableKeypair ?? await (deps.generateKeypair ?? generateDeviceKeypair)();
    const body = JSON.stringify({
        version: 1,
        machineId: invite.machineId,
        deviceKeyId: keypair.keyId,
        deviceEd25519PublicKey: keypair.publicKey,
    });
    const proof = await buildLocalDeviceProofHeader(
        { keyId: keypair.keyId, secretKey: keypair.secretKey },
        { method: 'POST', target: '/pair/complete', body },
        (deps.generateProofNonce ?? generateSecureBase64UrlNonce)(),
        nowMs,
    );

    let response: Response;
    try {
        response = await (deps.fetch ?? fetch)(`${invite.serverUrl}/pair/complete`, {
            method: 'POST',
            headers: {
                Origin: browserOrigin,
                'Content-Type': 'application/json',
                [LOCAL_PAIRING_SECRET_HEADER]: invite.pairSecret,
                [LOCAL_PAIRING_NONCE_HEADER]: invite.pairingNonce,
                [LOCAL_DEVICE_PROOF_HEADER]: proof,
            },
            body,
        });
    } catch (error) {
        throw new LocalEnrollmentError('network_error', error instanceof Error ? error.message : undefined);
    }

    if (response.status === 401) {
        throw new LocalEnrollmentError('pairing_denied');
    }
    if (!response.ok) {
        throw new LocalEnrollmentError('pair_failed', `status ${response.status}`);
    }

    let payload: unknown;
    try {
        payload = await response.json();
    } catch {
        throw new LocalEnrollmentError('invalid_response');
    }
    if (!isExpectedPairCompleteResponse(payload, invite, keypair)) {
        throw new LocalEnrollmentError('invalid_response');
    }

    const credentials: AuthCredentials = {
        authMode: 'paired-device',
        machineId: invite.machineId,
        tunnelUrl: invite.serverUrl,
        firstSeenAt: existing?.firstSeenAt ?? nowMs,
        login: existing?.login,
        avatarUrl: existing?.avatarUrl,
        deviceKeyId: keypair.keyId,
        devicePublicKey: keypair.publicKey,
        deviceSecretKey: keypair.secretKey,
    };
    return {
        credentials,
        invite,
        reusedDeviceKey: reusableKeypair !== null,
    };
}

function isExpectedPairCompleteResponse(
    value: unknown,
    invite: LocalPairingInvite,
    keypair: DeviceKeypair,
): boolean {
    if (!hasExactKeys(value, ['machine', 'authMode', 'pairedDevice', 'githubLogin'])) {
        return false;
    }
    const machine = value.machine;
    const pairedDevice = value.pairedDevice;
    return value.authMode === 'paired-device'
        && value.githubLogin === null
        && hasExactKeys(machine, ['machineId', 'tunnelUrl'])
        && machine.machineId === invite.machineId
        && machine.tunnelUrl === invite.serverUrl
        && hasExactKeys(pairedDevice, ['keyId', 'publicKey'])
        && pairedDevice.keyId === keypair.keyId
        && pairedDevice.publicKey === keypair.publicKey;
}

function hasExactKeys<const Keys extends readonly string[]>(
    value: unknown,
    keys: Keys,
): value is { [Key in Keys[number]]: unknown } {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return false;
    }
    const actualKeys = Object.keys(value);
    return actualKeys.length === keys.length
        && keys.every(key => Object.prototype.hasOwnProperty.call(value, key));
}

function getReusableKeypair(credentials: AuthCredentials | undefined): DeviceKeypair | null {
    if (
        credentials
        && typeof credentials.deviceKeyId === 'string'
        && credentials.deviceKeyId.length > 0
        && typeof credentials.devicePublicKey === 'string'
        && credentials.devicePublicKey.length > 0
        && typeof credentials.deviceSecretKey === 'string'
        && credentials.deviceSecretKey.length > 0
    ) {
        return {
            keyId: credentials.deviceKeyId,
            publicKey: credentials.devicePublicKey,
            secretKey: credentials.deviceSecretKey,
        };
    }
    return null;
}

function getBrowserOrigin(): string | null {
    const location = (globalThis as { location?: { origin?: unknown } }).location;
    return typeof location?.origin === 'string' && location.origin.length > 0
        ? location.origin
        : null;
}
