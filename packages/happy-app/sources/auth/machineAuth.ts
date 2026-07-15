import { LOCAL_DEVICE_PROOF_HEADER, PUBLIC_DEVICE_PROOF_HEADER } from '@slopus/happy-wire';

import { AuthCredentials, getAuthCredentialsIssue } from './tokenStorage';
import { ensureFreshConnectToken } from './connectTokenRefresh';
import { generateSecureBase64UrlNonce, generateSecureNonce } from './deviceKeypair';
import { buildLocalDeviceProofHeader } from './localDeviceProof';
import { buildPublicDeviceProofHeader, type DeviceProofBinding } from './publicDeviceProof';
import { CF_ACCESS_CLIENT_ID_HEADER, CF_ACCESS_CLIENT_SECRET_HEADER } from './publicEnrollment';

/**
 * `authMode` is the sole mode discriminator. Paired-device credentials use
 * Cloudflare Access only when both edge fields are present; otherwise they use
 * the local proof contract.
 */
export type MachineAuthKind = 'dev-tunnel' | 'paired-local' | 'paired-public';

export class InvalidPairedDeviceCredentialsError extends Error {
    constructor(message = 'Paired-device credentials are incomplete; re-pair this machine') {
        super(message);
        this.name = 'InvalidPairedDeviceCredentialsError';
    }
}

export interface MachineProofBinding extends DeviceProofBinding {
    /** Exact path+query used by the local proof contract. */
    target: string;
}

export function isPublicModeCredentials(credentials: AuthCredentials): boolean {
    return credentials.authMode === 'paired-device'
        && hasCompleteDeviceKey(credentials)
        && hasCompleteCloudflareCredentials(credentials);
}

export function isLocalPairedDeviceCredentials(credentials: AuthCredentials): boolean {
    return credentials.authMode === 'paired-device'
        && hasCompleteDeviceKey(credentials)
        && !credentials.cloudflareAccessClientId
        && !credentials.cloudflareAccessClientSecret;
}

export function resolveMachineAuthKind(credentials: AuthCredentials): MachineAuthKind {
    if (credentials.authMode === 'dev-tunnel') {
        return 'dev-tunnel';
    }
    const issue = getAuthCredentialsIssue(credentials);
    if (issue === 'missing-device-key') {
        throw new InvalidPairedDeviceCredentialsError('Paired-device credentials are missing device key material; re-pair this machine');
    }
    if (issue === 'incomplete-cloudflare') {
        throw new InvalidPairedDeviceCredentialsError('Paired-device Cloudflare credentials are incomplete; re-pair this machine');
    }
    return credentials.cloudflareAccessClientId ? 'paired-public' : 'paired-local';
}

function coerceProofBody(body: unknown): Uint8Array | string | null {
    if (typeof body === 'string') {
        return body;
    }
    if (body instanceof Uint8Array) {
        return body;
    }
    return null;
}

/**
 * fetch() wrapper that injects the machine auth headers. Drop-in replacement for
 * fetch() at tunnel call sites; pass extra headers separately. In public mode it
 * derives the device-proof binding (method + path + body) from the request so
 * every call presents a fresh Ed25519 proof; in Dev Tunnels mode it behaves as
 * before (X-Tunnel-Authorization only).
 */
export async function tunnelFetch(
    url: string,
    credentials: AuthCredentials,
    init?: Omit<RequestInit, 'headers'> & { headers?: Record<string, string> },
): Promise<Response> {
    const parsedUrl = new URL(url);
    const binding: MachineProofBinding = {
        method: (init?.method ?? 'GET').toUpperCase(),
        path: `${parsedUrl.pathname}${parsedUrl.search}`,
        target: `${parsedUrl.pathname}${parsedUrl.search}`,
        body: coerceProofBody(init?.body),
    };
    const headers: Record<string, string> = {
        ...(init?.headers ?? {}),
        ...await getMachineAuthHeaders(credentials, credentials.machineId, binding),
    };
    return fetch(url, { ...init, headers });
}

/**
 * Returns the auth headers for a machine request.
 *
 * - Dev Tunnels (default): `X-Tunnel-Authorization: tunnel <connectToken>`.
 * - Public server: `CF-Access-Client-Id` / `CF-Access-Client-Secret` (Cloudflare
 *   Access edge auth) plus, when a `binding` is supplied, an `x-happy-device-proof`
 *   Ed25519 envelope signed over the request (method + path + body hash) with a
 *   fresh single-use nonce. The proof is built via happy-wire's signPublicRequest
 *   so it is byte-for-byte accepted by the server verifier.
 */
export async function getMachineAuthHeaders(
    credentials: AuthCredentials,
    machineId = credentials.machineId,
    binding?: MachineProofBinding,
): Promise<Record<string, string>> {
    const authKind = resolveMachineAuthKind(credentials);
    if (authKind === 'paired-public') {
        const headers: Record<string, string> = {
            [CF_ACCESS_CLIENT_ID_HEADER]: credentials.cloudflareAccessClientId!,
            [CF_ACCESS_CLIENT_SECRET_HEADER]: credentials.cloudflareAccessClientSecret!,
        };
        if (binding) {
            headers[PUBLIC_DEVICE_PROOF_HEADER] = await buildPublicDeviceProofHeader(
                { keyId: credentials.deviceKeyId!, secretKey: credentials.deviceSecretKey! },
                binding,
                generateSecureNonce(),
                Date.now(),
            );
        }
        return headers;
    }
    if (authKind === 'paired-local') {
        if (!binding) {
            throw new InvalidPairedDeviceCredentialsError('Local paired-device requests require an exact request binding');
        }
        return {
            [LOCAL_DEVICE_PROOF_HEADER]: await buildLocalDeviceProofHeader(
                { keyId: credentials.deviceKeyId!, secretKey: credentials.deviceSecretKey! },
                {
                    method: binding.method,
                    target: binding.target,
                    body: binding.body,
                },
                generateSecureBase64UrlNonce(),
                Date.now(),
            ),
        };
    }

    const { connectToken } = await ensureFreshConnectToken(credentials, machineId);
    return {
        'X-Tunnel-Authorization': `tunnel ${connectToken}`,
    };
}

function hasCompleteDeviceKey(credentials: AuthCredentials): boolean {
    return Boolean(
        credentials.deviceKeyId
        && credentials.devicePublicKey
        && credentials.deviceSecretKey,
    );
}

function hasCompleteCloudflareCredentials(credentials: AuthCredentials): boolean {
    return Boolean(
        credentials.cloudflareAccessClientId
        && credentials.cloudflareAccessClientSecret,
    );
}
