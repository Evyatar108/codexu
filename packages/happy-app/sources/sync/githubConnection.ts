import { tunnelFetch } from '@/auth/machineAuth';
import type { AuthCredentials } from '@/auth/tokenStorage';
import { getHappyClientId } from '@/sync/apiSocket';

/**
 * Optional, upstream-style GitHub connected service. This is a POST-PAIRING
 * profile enrichment against the per-daemon server's own routes; it is NOT an
 * auth/pairing mechanism and never gates pairing or daemon use. All requests go
 * through `tunnelFetch`, so they carry the same paired-device proof as every
 * other authenticated request.
 *
 * Server contract (packages/happy-server .../routes/githubConnectionRoutes.ts):
 *   GET    /v1/connect/github/params  -> { enabled: boolean, url?: string }
 *   DELETE /v1/connect/github         -> { disconnected: true }
 * The browser-completed `/v1/connect/github/callback` writes the connection and
 * emits a profile update; the app just re-fetches its profile afterwards.
 */

export interface GithubConnectParams {
    /** false when the server has no GitHub OAuth app configured. */
    enabled: boolean;
    /** The GitHub authorize URL to open in a browser, present iff enabled. */
    url?: string;
}

function baseHeaders(): Record<string, string> {
    return {
        'Content-Type': 'application/json',
        'X-Happy-Client': getHappyClientId(),
    };
}

export async function fetchGithubConnectParams(
    credentials: AuthCredentials,
): Promise<GithubConnectParams> {
    const response = await tunnelFetch(
        `${credentials.tunnelUrl}/v1/connect/github/params`,
        credentials,
        { method: 'GET', headers: baseHeaders() },
    );
    if (!response.ok) {
        throw new Error(`Failed to load GitHub connection params: ${response.status}`);
    }
    const data = await response.json() as { enabled?: unknown; url?: unknown };
    return {
        enabled: data.enabled === true,
        url: typeof data.url === 'string' ? data.url : undefined,
    };
}

export async function disconnectGithub(credentials: AuthCredentials): Promise<void> {
    const response = await tunnelFetch(
        `${credentials.tunnelUrl}/v1/connect/github`,
        credentials,
        { method: 'DELETE', headers: baseHeaders() },
    );
    if (!response.ok) {
        throw new Error(`Failed to disconnect GitHub: ${response.status}`);
    }
}
