import { type ManagerOptions, type SocketOptions } from 'socket.io-client';
import Constants from 'expo-constants';
import { Platform } from 'react-native';

import { AuthCredentials } from '@/auth/tokenStorage';
import { getMachineAuthHeaders, isPublicModeCredentials } from '@/auth/machineAuth';

export type TunnelSocketOptions = Partial<ManagerOptions & SocketOptions>;

function getTunnelHappyClientId(): string {
    let platform: string = Platform.OS;
    if (platform === 'web' && typeof window !== 'undefined' && '__TAURI__' in window) {
        platform = 'desktop';
    }
    const version = Constants.expoConfig?.version || '0.0.0';
    return `${platform}/${version}`;
}

export async function buildTunnelSocketOptions(credentials: AuthCredentials, machineId = credentials.machineId, lastSeenSeq?: number): Promise<TunnelSocketOptions> {
    const happyClient = getTunnelHappyClientId();
    const isPublic = isPublicModeCredentials(credentials);
    const isWeb = Platform.OS === 'web';
    // The socket handshake device-proof binding is FIXED on the server side to
    // GET /v1/updates with an empty body (bodyHash is not checked for sockets).
    // Those SOCKET_PROOF_* constants are server-only (remoteDeviceAuth.ts) and
    // are intentionally NOT exported from happy-wire, so they are duplicated
    // here. The proof is built once (single nonce) and reused across every
    // transport's headers for this one-shot connection (reconnection is off).
    const socketBinding = isPublic
        ? { method: 'GET', path: '/v1/updates', body: null }
        : undefined;
    const authHeaders = await getMachineAuthHeaders(credentials, machineId, socketBinding);
    const replayAuth = typeof lastSeenSeq === 'number' && Number.isFinite(lastSeenSeq) ? { lastSeenSeq } : {};
    const headers = {
        ...authHeaders,
        'X-Happy-Client': happyClient,
    };

    return {
        path: '/v1/updates',
        auth: {
            clientType: 'user-scoped' as const,
            happyClient,
            machineId,
            ...replayAuth,
        },
        extraHeaders: headers,
        transportOptions: {
            websocket: {
                extraHeaders: headers,
            },
            // Public mode allows the polling fallback (some Cloudflare Access
            // edges buffer/deny raw WebSocket upgrades); carry the same
            // CF-Access + device-proof headers on it too.
            ...(isPublic ? { polling: { extraHeaders: headers } } : {}),
        },
        // Public mode over Cloudflare Access: the browser WebSocket API cannot
        // attach the CF-Access service-token nor the device-proof headers to the
        // WS upgrade, so on web we connect over polling only (polling carries the
        // headers). On native the RN websocket layer can attach extraHeaders, so
        // keep websocket-first with polling as a fallback. tryAllTransports lets
        // engine.io fall back to polling if the first transport's open fails
        // instead of terminating (reconnection is off for the single-use nonce).
        transports: isPublic
            ? (isWeb ? ['polling'] : ['websocket', 'polling'])
            : ['websocket'],
        ...(isPublic ? { tryAllTransports: true } : {}),
        reconnection: false,
    };
}
