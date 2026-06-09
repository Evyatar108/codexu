/**
 * Resolves pre-pinned Scope A peers to currently reachable Dev Tunnel targets.
 */

import { configuration } from '@/configuration';
import { TunnelManager, type OperatorTunnel } from '@/tunnel/tunnelManager';
import { ingestUrl, type PeerTransportTarget } from './peerTransport';
import { requirePinnedPeer } from './peerAuth';

export interface ResolvedPeerTransportTarget extends PeerTransportTarget {
    machineId: string;
    peerEcdhPublicKey: string;
    approvedForSpawn: boolean;
}

export interface ResolvePeerTargetOptions {
    happyHomeDir?: string;
    tunnelManager?: Pick<TunnelManager, 'listOperatorTunnels'>;
}

function tunnelMatchesHints(tunnel: OperatorTunnel, hints: { tunnelId?: string; tunnelName?: string }): boolean {
    if (hints.tunnelId && tunnel.tunnelId !== hints.tunnelId) return false;
    if (hints.tunnelName && tunnel.tunnelName !== hints.tunnelName) return false;
    return Boolean(hints.tunnelId || hints.tunnelName);
}

export async function resolvePeerTarget(machineId: string, options: ResolvePeerTargetOptions = {}): Promise<ResolvedPeerTransportTarget> {
    const happyHomeDir = options.happyHomeDir ?? configuration.happyHomeDir;
    const tunnelManager = options.tunnelManager ?? new TunnelManager();
    const pinned = await requirePinnedPeer(happyHomeDir, machineId);
    const matches = tunnelManager.listOperatorTunnels().filter(tunnel => tunnelMatchesHints(tunnel, pinned));

    if (matches.length === 0) {
        const hint = [pinned.tunnelId ? `tunnelId=${pinned.tunnelId}` : '', pinned.tunnelName ? `tunnelName=${pinned.tunnelName}` : '']
            .filter(Boolean)
            .join(', ') || 'no tunnelId/tunnelName hint configured';
        throw new Error(`agent-comms peer ${machineId} has no reachable Dev Tunnel match (${hint})`);
    }
    if (matches.length > 1) {
        throw new Error(`agent-comms peer ${machineId} matched multiple Dev Tunnels; add a tunnelId hint`);
    }

    const tunnel = matches[0]!;
    const url = ingestUrl(tunnel);
    if (!url) {
        throw new Error(`agent-comms peer ${machineId} matched Dev Tunnel ${tunnel.tunnelId} without an ingest URL`);
    }

    return {
        machineId,
        tunnelName: tunnel.tunnelName,
        tunnelId: tunnel.tunnelId,
        ingestUrl: url,
        peerEcdhPublicKey: pinned.ecdhPublicKey,
        approvedForSpawn: pinned.approvedForSpawn ?? false,
    };
}
