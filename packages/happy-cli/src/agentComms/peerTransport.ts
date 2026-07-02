/**
 * Scope A peer transport design surface.
 *
 * This pass deliberately stops at the Dev Tunnels transport skeleton: discovery
 * and connect-token minting are injectable/testable, while live two-machine
 * delivery is deferred to the Scope A follow-up. The only supported network path
 * in this design is daemon-to-daemon over Microsoft Dev Tunnels into the remote
 * daemon's happy-cli-owned `/agent-comms/ingest` listener, forwarded as a second
 * Dev Tunnel port alongside the embedded happy-server port (Scope A).
 */

import type { AgentCommsEnvelope } from '@slopus/happy-wire';
import type { OperatorTunnel, TunnelManager } from '@/tunnel/tunnelManager';

export interface PeerTransportTarget {
    /** Authoritative daemon machineId, supplied by the caller's TOFU pin/operator config when known. */
    machineId?: string;
    /** Human-readable `codexu-<hostname>` Dev Tunnel name; a host hint, not a machineId. */
    tunnelName: string;
    tunnelId: string;
    ingestUrl: string;
}

export interface SignedSealedEnvelope {
    envelope: AgentCommsEnvelope;
    signature: string;
    senderKeys: {
        ed25519PublicKey: string;
        ecdhPublicKey: string;
        ed25519Fingerprint: string;
    };
}

export interface AgentCommsPeerTransport {
    listReachablePeers(): Promise<PeerTransportTarget[]>;
    send(envelope: SignedSealedEnvelope, target: PeerTransportTarget): Promise<{ id: string; seq: number }>;
}

export type FetchLike = (url: string, init: {
    method: 'POST';
    headers: Record<string, string>;
    body: string;
}) => Promise<{ ok: boolean; status: number; json(): Promise<unknown>; text(): Promise<string> }>;

export function ingestUrl(tunnel: OperatorTunnel, ingestPort?: number): string | null {
    let base: string | undefined;
    if (ingestPort !== undefined) {
        // Scope A forwards two ports on the same tunnel (embedded happy-server +
        // happy-cli ingest listener). Select the port that maps to the peer's
        // ingest listener, and fail closed if it is not currently forwarded rather
        // than silently delivering to the wrong (embedded-server) port.
        base = tunnel.ports.find(port => port.portNumber === ingestPort && port.portUri)?.portUri;
        if (!base) return null;
    } else {
        // Legacy pin / single-port peer: fall back to the tunnel's primary port URL.
        base = tunnel.tunnelUrl ?? tunnel.ports.find(port => port.portUri)?.portUri;
    }
    return base ? `${base.replace(/\/$/u, '')}/agent-comms/ingest` : null;
}

export class DevTunnelsPeerTransport implements AgentCommsPeerTransport {
    constructor(
        private readonly tunnelManager: Pick<TunnelManager, 'listOperatorTunnels' | 'mintConnectToken'>,
        private readonly fetchImpl: FetchLike = fetch as unknown as FetchLike,
    ) {}

    async listReachablePeers(): Promise<PeerTransportTarget[]> {
        return this.tunnelManager.listOperatorTunnels().flatMap((tunnel): PeerTransportTarget[] => {
            const url = ingestUrl(tunnel);
            if (!url) return [];
            return [{ tunnelName: tunnel.tunnelName, tunnelId: tunnel.tunnelId, ingestUrl: url }];
        });
    }

    async send(payload: SignedSealedEnvelope, target: PeerTransportTarget): Promise<{ id: string; seq: number }> {
        const connectToken = this.tunnelManager.mintConnectToken(target.tunnelId);
        const response = await this.fetchImpl(target.ingestUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                // Dev Tunnels gateway consumes and strips this before happy-server
                // receives the request; it is still the only transport auth header.
                'X-Tunnel-Authorization': `tunnel ${connectToken}`,
            },
            body: JSON.stringify(payload),
        });
        if (!response.ok) {
            throw new Error(`Scope A ingest failed with HTTP ${response.status}: ${await response.text()}`);
        }
        const parsed = await response.json();
        if (!parsed || typeof parsed !== 'object' || typeof (parsed as { id?: unknown }).id !== 'string' || typeof (parsed as { seq?: unknown }).seq !== 'number') {
            throw new Error(`Scope A ingest returned malformed response: ${JSON.stringify(parsed)}`);
        }
        return parsed as { id: string; seq: number };
    }
}
