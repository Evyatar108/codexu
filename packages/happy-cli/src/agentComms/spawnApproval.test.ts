import { afterEach, describe, expect, it, vi } from 'vitest';
import * as fsSync from 'node:fs';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { tmpdir } from 'node:os';
import type { AgentCommsEnvelope } from '@slopus/happy-wire';
import { pinPeerKeys } from './peerAuth';
import { handleInboundSpawnRequest, pendingSpawnsPath } from './spawnApproval';

const rmOptions = { recursive: true, force: true, maxRetries: 5, retryDelay: 50 };

function makeHome(): string {
    return fsSync.mkdtempSync(path.join(tmpdir(), 'happy-spawn-approval-test-'));
}

function spawnEnvelope(overrides: Partial<AgentCommsEnvelope> = {}): AgentCommsEnvelope {
    return {
        v: 1,
        id: 'env-spawn-1',
        ts: 1,
        from: { machineId: 'machine-a', sessionId: 'remote-parent' },
        to: { machineId: 'machine-b', sessionId: 'local-parent' },
        scope: 'A',
        channel: 'spawn',
        kind: 'spawn-request',
        correlationId: 'corr-spawn-1',
        hopCount: 1,
        hopPath: ['machine-a:remote-parent', 'machine-b:daemon-machine-b'],
        body: {
            role: 'reviewer',
            plugins: ['ralph-overview@ai-developer-toolkit'],
            agent: 'codex',
            cwd: 'D:/repo',
            initialMessage: 'inspect the diff',
            model: 'gpt-5',
            permissionMode: 'yolo',
            effortLevel: 'high',
        },
        ...overrides,
    };
}

async function readPendingStore(home: string): Promise<{ pending: unknown[]; completed: unknown[] }> {
    return JSON.parse(await fs.readFile(pendingSpawnsPath(home), 'utf8')) as { pending: unknown[]; completed: unknown[] };
}

describe('handleInboundSpawnRequest', () => {
    let homes: string[] = [];

    afterEach(async () => {
        await Promise.all(homes.map(home => fs.rm(home, rmOptions)));
        homes = [];
    });

    it('records non-allowlisted spawn requests and returns a spawn-result without spawning', async () => {
        const home = makeHome();
        homes.push(home);
        const pinned = await pinPeerKeys(home, 'machine-a', {
            ed25519PublicKey: 'ZWQ=',
            ecdhPublicKey: 'ZWNkaA==',
            approvedForSpawn: false,
        });
        const spawnSessionFromSession = vi.fn();
        const deliverRemote = vi.fn(async (envelope: AgentCommsEnvelope) => ({ id: envelope.id, seq: 3 }));

        await expect(handleInboundSpawnRequest(spawnEnvelope(), {
            happyHomeDir: home,
            localMachineId: 'machine-b',
            pinnedPeer: pinned,
            spawnSessionFromSession,
            deliverRemote,
            now: () => new Date('2026-06-09T12:00:00.000Z'),
        })).resolves.toEqual({ id: expect.any(String), seq: 3 });

        expect(spawnSessionFromSession).not.toHaveBeenCalled();
        expect(deliverRemote).toHaveBeenCalledTimes(1);
        expect(deliverRemote.mock.calls[0][0]).toMatchObject({
            channel: 'spawn',
            kind: 'spawn-result',
            correlationId: 'corr-spawn-1',
            body: {
                type: 'spawn-result',
                ok: false,
                requiresOperatorApproval: true,
            },
        });
        await expect(readPendingStore(home)).resolves.toMatchObject({
            pending: [{
                envelopeId: 'env-spawn-1',
                correlationId: 'corr-spawn-1',
                fromMachineId: 'machine-a',
                targetSessionId: 'local-parent',
                reason: 'sender peer is not approvedForSpawn',
            }],
        });
    });

    it('validates and maps allowlisted requests to spawn-session-from-session config', async () => {
        const home = makeHome();
        homes.push(home);
        const pinned = await pinPeerKeys(home, 'machine-a', {
            ed25519PublicKey: 'ZWQ=',
            ecdhPublicKey: 'ZWNkaA==',
            approvedForSpawn: true,
        });
        const spawnSessionFromSession = vi.fn(async () => ({ type: 'success' as const, sessionId: 'child-1' }));
        const deliverRemote = vi.fn(async (envelope: AgentCommsEnvelope) => ({ id: envelope.id, seq: 4 }));

        await handleInboundSpawnRequest(spawnEnvelope(), {
            happyHomeDir: home,
            localMachineId: 'machine-b',
            pinnedPeer: pinned,
            spawnSessionFromSession,
            deliverRemote,
            now: () => new Date('2026-06-09T12:01:00.000Z'),
        });

        expect(spawnSessionFromSession).toHaveBeenCalledTimes(1);
        expect(spawnSessionFromSession).toHaveBeenCalledWith({
            parentSessionId: 'local-parent',
            config: {
                agent: 'codex',
                path: 'D:/repo',
                initialMessage: 'inspect the diff',
                model: 'gpt-5',
                permissionMode: 'yolo',
                effortLevel: 'high',
            },
        });
        expect(deliverRemote.mock.calls[0][0]).toMatchObject({
            channel: 'spawn',
            kind: 'spawn-result',
            body: {
                ok: true,
                result: { type: 'success', sessionId: 'child-1' },
            },
        });
    });

    it('dedupes approved execution by envelope id and correlation id', async () => {
        const home = makeHome();
        homes.push(home);
        const pinned = await pinPeerKeys(home, 'machine-a', {
            ed25519PublicKey: 'ZWQ=',
            ecdhPublicKey: 'ZWNkaA==',
            approvedForSpawn: true,
        });
        const spawnSessionFromSession = vi.fn(async () => ({ type: 'success' as const, sessionId: 'child-1' }));
        const deliverRemote = vi.fn(async (envelope: AgentCommsEnvelope) => ({ id: envelope.id, seq: 5 }));

        const options = {
            happyHomeDir: home,
            localMachineId: 'machine-b',
            pinnedPeer: pinned,
            spawnSessionFromSession,
            deliverRemote,
            now: () => new Date('2026-06-09T12:02:00.000Z'),
        };
        const first = await handleInboundSpawnRequest(spawnEnvelope(), options);
        const retry = await handleInboundSpawnRequest(spawnEnvelope({ id: 'env-spawn-retry' }), options);

        expect(retry).toEqual(first);
        expect(spawnSessionFromSession).toHaveBeenCalledTimes(1);
        expect(deliverRemote).toHaveBeenCalledTimes(1);
        await expect(readPendingStore(home)).resolves.toMatchObject({ completed: [{ correlationId: 'corr-spawn-1' }] });
    });

    it('returns the in-flight result for a same-correlation retry without double-spawning', async () => {
        const home = makeHome();
        homes.push(home);
        const pinned = await pinPeerKeys(home, 'machine-a', {
            ed25519PublicKey: 'ZWQ=',
            ecdhPublicKey: 'ZWNkaA==',
            approvedForSpawn: true,
        });
        let release: (value: { type: 'success'; sessionId: string }) => void = () => {};
        const gate = new Promise<{ type: 'success'; sessionId: string }>(resolve => { release = resolve; });
        const spawnSessionFromSession = vi.fn(async () => gate);
        const deliverRemote = vi.fn(async (envelope: AgentCommsEnvelope) => ({ id: envelope.id, seq: 12 }));
        const options = {
            happyHomeDir: home,
            localMachineId: 'machine-b',
            pinnedPeer: pinned,
            spawnSessionFromSession,
            deliverRemote,
        };

        const first = handleInboundSpawnRequest(spawnEnvelope(), options);
        const retry = handleInboundSpawnRequest(spawnEnvelope({ id: 'env-spawn-retry' }), options);
        release({ type: 'success', sessionId: 'child-1' });
        const [firstAck, retryAck] = await Promise.all([first, retry]);

        expect(retryAck).toEqual(firstAck);
        expect(spawnSessionFromSession).toHaveBeenCalledTimes(1);
        expect(deliverRemote).toHaveBeenCalledTimes(1);
    });

    it('does not serialize an unrelated spawn behind an in-flight spawn', async () => {
        const home = makeHome();
        homes.push(home);
        const pinned = await pinPeerKeys(home, 'machine-a', {
            ed25519PublicKey: 'ZWQ=',
            ecdhPublicKey: 'ZWNkaA==',
            approvedForSpawn: true,
        });
        let releaseA: (value: { type: 'success'; sessionId: string }) => void = () => {};
        const gateA = new Promise<{ type: 'success'; sessionId: string }>(resolve => { releaseA = resolve; });
        const spawnSessionFromSession = vi.fn(async (rpc: { config: { initialMessage?: string } }) =>
            rpc.config.initialMessage === 'A' ? gateA : { type: 'success' as const, sessionId: 'child-B' });
        const deliverRemote = vi.fn(async (envelope: AgentCommsEnvelope) => ({ id: envelope.id, seq: 11 }));
        const options = {
            happyHomeDir: home,
            localMachineId: 'machine-b',
            pinnedPeer: pinned,
            spawnSessionFromSession,
            deliverRemote,
        };

        const envA = spawnEnvelope({ id: 'env-A', correlationId: 'corr-A', body: { agent: 'codex', initialMessage: 'A' } });
        const envB = spawnEnvelope({ id: 'env-B', correlationId: 'corr-B', body: { agent: 'codex', initialMessage: 'B' } });

        const aPromise = handleInboundSpawnRequest(envA, options);
        // B must complete even though A's spawn is still gated; the approval-store
        // lock is released before the long spawn runs, so unrelated requests are
        // not serialized behind it.
        const bAck = await handleInboundSpawnRequest(envB, options);

        expect(bAck).toEqual({ id: expect.any(String), seq: 11 });
        expect(spawnSessionFromSession).toHaveBeenCalledTimes(2);

        releaseA({ type: 'success', sessionId: 'child-A' });
        await aPromise;
    });

    it('returns spawn-result errors for invalid allowlisted request bodies', async () => {        const home = makeHome();
        homes.push(home);
        const pinned = await pinPeerKeys(home, 'machine-a', {
            ed25519PublicKey: 'ZWQ=',
            ecdhPublicKey: 'ZWNkaA==',
            approvedForSpawn: true,
        });
        const spawnSessionFromSession = vi.fn();
        const deliverRemote = vi.fn(async (envelope: AgentCommsEnvelope) => ({ id: envelope.id, seq: 6 }));

        await handleInboundSpawnRequest(spawnEnvelope({ body: { cwd: 'D:/repo' } }), {
            happyHomeDir: home,
            localMachineId: 'machine-b',
            pinnedPeer: pinned,
            spawnSessionFromSession,
            deliverRemote,
        });

        expect(spawnSessionFromSession).not.toHaveBeenCalled();
        expect(deliverRemote.mock.calls[0][0]).toMatchObject({
            channel: 'spawn',
            kind: 'spawn-result',
            body: {
                ok: false,
                result: { type: 'error' },
            },
        });
    });
});
