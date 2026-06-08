import { describe, expect, it, vi } from 'vitest';
import type { AgentCommsEnvelope } from '@slopus/happy-wire';
import { DevTunnelsPeerTransport } from './peerTransport';
import type { OperatorTunnel } from '@/tunnel/tunnelManager';

const envelope: AgentCommsEnvelope = {
    v: 1,
    id: 'env-1',
    ts: 1,
    from: { machineId: 'machine-guid-a', sessionId: 'sender' },
    to: { machineId: 'machine-guid-b', sessionId: 'target' },
    scope: 'A',
    channel: 'message',
    kind: 'request',
    hopCount: 0,
    hopPath: ['machine-guid-a:sender'],
    body: { v: 1, nonce: 'n', ciphertext: 'c' },
};

describe('DevTunnelsPeerTransport', () => {
    it('treats codexu-<hostname> as a host hint, not an authoritative machineId', async () => {
        const tunnel: OperatorTunnel = {
            tunnelId: 'codexu-laptop',
            tunnelName: 'codexu-laptop',
            tunnelUrl: 'https://laptop-3005.devtunnels.ms',
            ports: [{ portNumber: 3005, portUri: 'https://laptop-3005.devtunnels.ms' }],
        };
        const transport = new DevTunnelsPeerTransport({
            listOperatorTunnels: () => [tunnel],
            mintConnectToken: () => 'unused',
        });

        await expect(transport.listReachablePeers()).resolves.toEqual([{
            tunnelName: 'codexu-laptop',
            tunnelId: 'codexu-laptop',
            ingestUrl: 'https://laptop-3005.devtunnels.ms/agent-comms/ingest',
        }]);
    });

    it('posts signed/sealed envelopes with a Dev Tunnels connect token header', async () => {
        const fetchImpl = vi.fn(async () => ({
            ok: true,
            status: 200,
            json: async () => ({ id: 'mb-1', seq: 1 }),
            text: async () => '',
        }));
        const transport = new DevTunnelsPeerTransport({
            listOperatorTunnels: () => [],
            mintConnectToken: (tunnelId: string) => `token-for-${tunnelId}`,
        }, fetchImpl);

        await expect(transport.send({
            envelope,
            signature: 'sig',
            senderKeys: {
                ed25519PublicKey: 'ed',
                ecdhPublicKey: 'ecdh',
                ed25519Fingerprint: 'SHA256:x',
            },
        }, {
            tunnelName: 'codexu-laptop',
            tunnelId: 'codexu-laptop',
            ingestUrl: 'https://laptop-3005.devtunnels.ms/agent-comms/ingest',
        })).resolves.toEqual({ id: 'mb-1', seq: 1 });

        expect(fetchImpl).toHaveBeenCalledWith('https://laptop-3005.devtunnels.ms/agent-comms/ingest', expect.objectContaining({
            method: 'POST',
            headers: expect.objectContaining({ 'X-Tunnel-Authorization': 'tunnel token-for-codexu-laptop' }),
        }));
    });
});
