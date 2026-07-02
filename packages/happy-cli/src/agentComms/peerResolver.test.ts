import { afterAll, describe, expect, it } from 'vitest';
import * as fsSync from 'node:fs';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { tmpdir } from 'node:os';
import type { OperatorTunnel } from '@/tunnel/tunnelManager';
import { pinPeerKeys } from './peerAuth';
import { resolvePeerTarget } from './peerResolver';

const tempHome = fsSync.mkdtempSync(path.join(tmpdir(), 'happy-peer-resolver-test-'));

afterAll(async () => {
    await fs.rm(tempHome, { recursive: true, force: true });
});

const tunnel: OperatorTunnel = {
    tunnelId: 'tunnel-guid-b',
    tunnelName: 'codexu-peer-host',
    tunnelUrl: 'https://peer-3005.devtunnels.ms',
    ports: [{ portNumber: 3005, portUri: 'https://peer-3005.devtunnels.ms' }],
};

describe('resolvePeerTarget', () => {
    it('joins an explicit pinned peer hint to the live Dev Tunnel list', async () => {
        await pinPeerKeys(tempHome, 'machine-b', {
            ed25519PublicKey: 'ZWQ=',
            ecdhPublicKey: 'ZWNkaA==',
            tunnelName: 'codexu-peer-host',
            approvedForSpawn: true,
        });

        await expect(resolvePeerTarget('machine-b', {
            happyHomeDir: tempHome,
            tunnelManager: { listOperatorTunnels: () => [tunnel] },
        })).resolves.toEqual({
            machineId: 'machine-b',
            tunnelName: 'codexu-peer-host',
            tunnelId: 'tunnel-guid-b',
            ingestUrl: 'https://peer-3005.devtunnels.ms/agent-comms/ingest',
            peerEcdhPublicKey: 'ZWNkaA==',
            approvedForSpawn: true,
        });
    });

    it('fails closed for unknown peers', async () => {
        await expect(resolvePeerTarget('machine-missing', {
            happyHomeDir: tempHome,
            tunnelManager: { listOperatorTunnels: () => [tunnel] },
        })).rejects.toThrow(/not TOFU-pinned/);
    });

    it('does not derive machineId from codexu-style tunnel names', async () => {
        await pinPeerKeys(tempHome, 'peer-host', {
            ed25519PublicKey: 'ZWQ=',
            ecdhPublicKey: 'ZWNkaA==',
        });

        await expect(resolvePeerTarget('peer-host', {
            happyHomeDir: tempHome,
            tunnelManager: { listOperatorTunnels: () => [tunnel] },
        })).rejects.toThrow(/no reachable Dev Tunnel match/);
    });

    it('selects the pinned ingest port from a two-port tunnel (Scope A)', async () => {
        const twoPortTunnel: OperatorTunnel = {
            tunnelId: 'tunnel-guid-two-port',
            tunnelName: 'codexu-two-port',
            // tunnelUrl points at the embedded-server port; the ingest port is a second forward.
            tunnelUrl: 'https://peer-3005.devtunnels.ms',
            ports: [
                { portNumber: 3005, portUri: 'https://peer-3005.devtunnels.ms' },
                { portNumber: 4010, portUri: 'https://peer-4010.devtunnels.ms' },
            ],
        };
        await pinPeerKeys(tempHome, 'machine-two-port', {
            ed25519PublicKey: 'ZWQ=',
            ecdhPublicKey: 'ZWNkaA==',
            tunnelId: 'tunnel-guid-two-port',
            ingestPort: 4010,
        });

        const resolved = await resolvePeerTarget('machine-two-port', {
            happyHomeDir: tempHome,
            tunnelManager: { listOperatorTunnels: () => [twoPortTunnel] },
        });
        expect(resolved.ingestUrl).toBe('https://peer-4010.devtunnels.ms/agent-comms/ingest');
    });

    it('fails closed when the pinned ingest port is not forwarded on the tunnel', async () => {
        const oneForwardedPort: OperatorTunnel = {
            tunnelId: 'tunnel-guid-missing-ingest',
            tunnelName: 'codexu-missing-ingest',
            tunnelUrl: 'https://peer-3005.devtunnels.ms',
            ports: [{ portNumber: 3005, portUri: 'https://peer-3005.devtunnels.ms' }],
        };
        await pinPeerKeys(tempHome, 'machine-missing-ingest', {
            ed25519PublicKey: 'ZWQ=',
            ecdhPublicKey: 'ZWNkaA==',
            tunnelId: 'tunnel-guid-missing-ingest',
            ingestPort: 4010,
        });

        await expect(resolvePeerTarget('machine-missing-ingest', {
            happyHomeDir: tempHome,
            tunnelManager: { listOperatorTunnels: () => [oneForwardedPort] },
        })).rejects.toThrow(/without an ingest URL/);
    });
});
