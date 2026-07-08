import { PUBLIC_DEVICE_PROOF_HEADER } from '@slopus/happy-wire';

import { AuthCredentials } from './tokenStorage';
import { ensureFreshConnectToken } from './connectTokenRefresh';
import { generateSecureNonce } from './deviceKeypair';
import { buildPublicDeviceProofHeader, type DeviceProofBinding } from './publicDeviceProof';
import { CF_ACCESS_CLIENT_ID_HEADER, CF_ACCESS_CLIENT_SECRET_HEADER } from './publicEnrollment';

/**
 * A device is in public-server (example.com single-user) mode once it has been
 * enrolled via a public pairing invite: it then holds Cloudflare Access
 * service-token creds plus an Ed25519 device key. Their presence is what
 * switches request auth away from the default Dev Tunnels path.
 */
export function isPublicModeCredentials(credentials: AuthCredentials): boolean {
    return Boolean(
        credentials.cloudflareAccessClientId
        && credentials.cloudflareAccessClientSecret
        && credentials.deviceKeyId
        && credentials.deviceSecretKey,
    );
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
    const binding: DeviceProofBinding = {
        method: (init?.method ?? 'GET').toUpperCase(),
        path: new URL(url).pathname,
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
    binding?: DeviceProofBinding,
): Promise<Record<string, string>> {
    if (isPublicModeCredentials(credentials)) {
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

    const { connectToken } = await ensureFreshConnectToken(credentials, machineId);
    return {
        'X-Tunnel-Authorization': `tunnel ${connectToken}`,
    };
}
