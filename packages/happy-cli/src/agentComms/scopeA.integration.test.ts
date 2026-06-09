import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import * as fsSync from 'node:fs';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { tmpdir } from 'node:os';
import * as ed from '@noble/ed25519';
import { sha512 } from '@noble/hashes/sha2.js';
import nacl from 'tweetnacl';
import type { AgentCommsEnvelope } from '@slopus/happy-wire';
import { encodeBase64 } from '@/api/encryption';
import { formatEd25519Fingerprint, type TofuKeypairs } from '@/tofu/keypairManager';
import { createAgentCommsEnvelope } from './router';
import { pinPeerKeys, sealBody, signEnvelope } from './peerAuth';
import type { SignedSealedEnvelope } from './peerTransport';

ed.hashes.sha512 = (message: Uint8Array) => sha512(message);

const rmOptions = { recursive: true, force: true, maxRetries: 5, retryDelay: 50 };
const tempRoot = fsSync.mkdtempSync(path.join(tmpdir(), 'happy-scopea-test-'));
const homeA = path.join(tempRoot, 'machine-a-home');
const homeB = path.join(tempRoot, 'machine-b-home');

let mailbox: typeof import('./mailbox');
let peerDelivery: typeof import('./peerDelivery');
let peerTransport: typeof import('./peerTransport');
let ingestHandler: typeof import('./ingestHandler');
let spawnApproval: typeof import('./spawnApproval');

function fixedSecret(seed: number): Uint8Array {
    return Uint8Array.from({ length: 32 }, (_, index) => (seed + index) % 255);
}

async function fixtureKeypairs(seed: number): Promise<TofuKeypairs> {
    const ed25519PrivateKey = fixedSecret(seed);
    const ed25519PublicKey = await ed.getPublicKeyAsync(ed25519PrivateKey);
    const ecdh = nacl.box.keyPair.fromSecretKey(fixedSecret(seed + 50));
    return {
        ed25519PrivateKey,
        ed25519PublicKey,
        ecdhPrivateKey: ecdh.secretKey,
        ecdhPublicKey: ecdh.publicKey,
        ed25519Fingerprint: formatEd25519Fingerprint(ed25519PublicKey),
        createdEd25519: false,
        createdEcdh: false,
        files: {
            ed25519PublicKeyFile: '',
            ed25519PrivateKeyFile: '',
            ecdhPublicKeyFile: '',
            ecdhPrivateKeyFile: '',
        },
    };
}

function peerKeys(keys: TofuKeypairs, approvedForSpawn?: boolean) {
    return {
        ed25519PublicKey: encodeBase64(keys.ed25519PublicKey),
        ecdhPublicKey: encodeBase64(keys.ecdhPublicKey),
        ed25519Fingerprint: keys.ed25519Fingerprint,
        approvedForSpawn,
    };
}

function scopeAEnvelope(overrides: Partial<AgentCommsEnvelope> = {}): AgentCommsEnvelope {
    return {
        v: 1,
        id: 'env-a-to-b-1',
        ts: 1,
        from: { machineId: 'machine-a', sessionId: 'sender' },
        to: { machineId: 'machine-b', sessionId: 'target' },
        scope: 'A',
        channel: 'message',
        kind: 'request',
        hopCount: 0,
        hopPath: ['machine-a:sender'],
        body: { text: 'hello over scope a' },
        ...overrides,
    };
}

function makeFetch(handlerByUrl: Map<string, (payload: SignedSealedEnvelope) => Promise<{ id: string; seq: number }>>) {
    return async (url: string, init: { method: 'POST'; headers: Record<string, string>; body: string }) => {
        expect(init.method).toBe('POST');
        expect(init.headers['X-Tunnel-Authorization']).toBe('tunnel token-for-tunnel-b');
        const handler = handlerByUrl.get(url);
        if (!handler) throw new Error(`unexpected ingest url ${url}`);
        try {
            const ack = await handler(JSON.parse(init.body) as SignedSealedEnvelope);
            return { ok: true, status: 200, json: async () => ack, text: async () => JSON.stringify(ack) };
        } catch (error) {
            const text = error instanceof Error ? error.message : String(error);
            return { ok: false, status: 400, json: async () => ({ error: text }), text: async () => text };
        }
    };
}

async function signedSealedPayload(envelope: AgentCommsEnvelope, sender: TofuKeypairs, recipient: TofuKeypairs): Promise<SignedSealedEnvelope> {
    const sealedEnvelope = { ...envelope, body: sealBody(envelope.body, sender, recipient.ecdhPublicKey) };
    return {
        envelope: sealedEnvelope,
        signature: await signEnvelope(sealedEnvelope, sender),
        senderKeys: peerKeys(sender),
    };
}

describe('Scope A hermetic round-trip', () => {
    let keysA: TofuKeypairs;
    let keysB: TofuKeypairs;

    beforeAll(async () => {
        await fs.mkdir(homeA, { recursive: true });
        await fs.mkdir(homeB, { recursive: true });
        process.env.HAPPY_HOME_DIR = homeB;
        vi.resetModules();
        [mailbox, peerDelivery, peerTransport, ingestHandler, spawnApproval] = await Promise.all([
            import('./mailbox'),
            import('./peerDelivery'),
            import('./peerTransport'),
            import('./ingestHandler'),
            import('./spawnApproval'),
        ]);
        keysA = await fixtureKeypairs(30);
        keysB = await fixtureKeypairs(31);
        await pinPeerKeys(homeA, 'machine-b', { ...peerKeys(keysB), tunnelName: 'codexu-machine-b', tunnelId: 'tunnel-b' });
        await pinPeerKeys(homeB, 'machine-a', { ...peerKeys(keysA), approvedForSpawn: false });
    });

    afterAll(async () => {
        await fs.rm(tempRoot, rmOptions);
    });

    it('delivers a signed and sealed message through loopback POST into the remote mailbox', async () => {
        const ingestB = ingestHandler.createAgentCommsIngestHandler({
            happyHomeDir: homeB,
            localMachineId: 'machine-b',
            tofuKeypairs: keysB,
            spawnSessionFromSession: vi.fn(),
            deliverRemote: vi.fn(),
            appendMessage: mailbox.appendMessage,
        });
        const urlB = 'https://machine-b-3005.devtunnels.ms/agent-comms/ingest';
        const tunnelManager = {
            listOperatorTunnels: () => [{
                tunnelId: 'tunnel-b',
                tunnelName: 'codexu-machine-b',
                tunnelUrl: 'https://machine-b-3005.devtunnels.ms',
                ports: [{ portNumber: 3005, portUri: 'https://machine-b-3005.devtunnels.ms' }],
            }],
            mintConnectToken: (tunnelId: string) => `token-for-${tunnelId}`,
        };
        const transport = new peerTransport.DevTunnelsPeerTransport(tunnelManager, makeFetch(new Map([[urlB, payload => ingestB(payload)]])));
        const deliverRemote = peerDelivery.createDevTunnelsAgentCommsDeliverRemote({
            happyHomeDir: homeA,
            localKeypairs: keysA,
            tunnelManager,
            transport,
        });
        const envelope = createAgentCommsEnvelope({
            from: { machineId: 'machine-a', sessionId: 'sender' },
            to: { machineId: 'machine-b', sessionId: 'target' },
            body: { text: 'hello over scope a' },
        }, { selfMachineId: 'machine-a', hasLocalSession: sessionId => sessionId === 'sender' });

        const ack = await deliverRemote(envelope);

        expect(ack.seq).toBe(1);
        const pending = await mailbox.readPending('target');
        expect(pending).toHaveLength(1);
        expect((pending[0].body as AgentCommsEnvelope)).toMatchObject({
            id: envelope.id,
            scope: 'A',
            hopCount: 1,
            hopPath: ['machine-a:sender', 'machine-b:daemon-machine-b'],
            body: { text: 'hello over scope a' },
        });
    });

    it('rejects unknown peers, fingerprint mismatch, signature failure, and sealed-body open failure before append', async () => {
        const appendMessage = vi.fn(async () => ({ id: 'unexpected', seq: 99 }));
        const ingestB = ingestHandler.createAgentCommsIngestHandler({
            happyHomeDir: homeB,
            localMachineId: 'machine-b',
            tofuKeypairs: keysB,
            spawnSessionFromSession: vi.fn(),
            deliverRemote: vi.fn(),
            appendMessage,
        });

        await expect(ingestB(await signedSealedPayload(scopeAEnvelope({ from: { machineId: 'unknown', sessionId: 'sender' } }), keysA, keysB)))
            .rejects.toThrow(/not TOFU-pinned/);

        const validPayload = await signedSealedPayload(scopeAEnvelope({ id: 'env-fingerprint' }), keysA, keysB);
        await expect(ingestB({
            ...validPayload,
            senderKeys: { ...validPayload.senderKeys, ed25519Fingerprint: 'SHA256:not-the-pinned-key' },
        })).rejects.toThrow(/fingerprint mismatch/);

        const signedPayload = await signedSealedPayload(scopeAEnvelope({ id: 'env-signature' }), keysA, keysB);
        await expect(ingestB({
            ...signedPayload,
            envelope: { ...signedPayload.envelope, id: 'env-signature-mutated' },
        })).rejects.toThrow(/signature verification failed/);

        const stranger = await fixtureKeypairs(90);
        await expect(ingestB(await signedSealedPayload(scopeAEnvelope({ id: 'env-sealed' }), keysA, stranger)))
            .rejects.toThrow(/sealed body could not be opened/);

        expect(appendMessage).not.toHaveBeenCalled();
    });

    it('denies non-allowlisted spawn, executes allowlisted spawn once, and dedupes retry by correlationId', async () => {
        const spawnSessionFromSession = vi.fn(async () => ({ type: 'success' as const, sessionId: 'child-1' }));
        const deliverRemote = vi.fn(async (envelope: AgentCommsEnvelope) => ({ id: envelope.id, seq: 8 }));
        const ingestB = ingestHandler.createAgentCommsIngestHandler({
            happyHomeDir: homeB,
            localMachineId: 'machine-b',
            tofuKeypairs: keysB,
            spawnSessionFromSession,
            deliverRemote,
        });
        const spawnEnvelope = scopeAEnvelope({
            id: 'env-spawn-denied',
            channel: 'spawn',
            kind: 'spawn-request',
            correlationId: 'spawn-corr-denied',
            to: { machineId: 'machine-b', sessionId: 'remote-parent' },
            body: { agent: 'codex', cwd: 'D:/repo', initialMessage: 'inspect' },
        });

        await expect(ingestB(await signedSealedPayload(spawnEnvelope, keysA, keysB))).resolves.toEqual({ id: expect.any(String), seq: 8 });
        expect(spawnSessionFromSession).not.toHaveBeenCalled();
        expect(deliverRemote.mock.calls[0]![0]).toMatchObject({
            channel: 'spawn',
            kind: 'spawn-result',
            body: { ok: false, requiresOperatorApproval: true },
        });
        await expect(fs.readFile(spawnApproval.pendingSpawnsPath(homeB), 'utf8')).resolves.toContain('sender peer is not approvedForSpawn');

        await pinPeerKeys(homeB, 'machine-a', { ...peerKeys(keysA), approvedForSpawn: true });
        const approvedEnvelope = {
            ...spawnEnvelope,
            id: 'env-spawn-approved',
            correlationId: 'spawn-corr-approved',
            body: { agent: 'codex', cwd: 'D:/repo', initialMessage: 'inspect' },
        };
        const first = await ingestB(await signedSealedPayload(approvedEnvelope, keysA, keysB));
        const retry = await ingestB(await signedSealedPayload({ ...approvedEnvelope, id: 'env-spawn-approved-retry' }, keysA, keysB));

        expect(retry).toEqual(first);
        expect(spawnSessionFromSession).toHaveBeenCalledTimes(1);
        expect(spawnSessionFromSession).toHaveBeenCalledWith({
            parentSessionId: 'remote-parent',
            config: {
                agent: 'codex',
                path: 'D:/repo',
                initialMessage: 'inspect',
            },
        });
        expect(deliverRemote).toHaveBeenCalledTimes(2);
        expect(deliverRemote.mock.calls[1]![0]).toMatchObject({
            channel: 'spawn',
            kind: 'spawn-result',
            correlationId: 'spawn-corr-approved',
            body: { ok: true, result: { type: 'success', sessionId: 'child-1' } },
        });
    });

    it('accepts an inbound spawn-result reply even when the responder is not approvedForSpawn', async () => {
        await pinPeerKeys(homeB, 'machine-a', { ...peerKeys(keysA), approvedForSpawn: false });
        const spawnSessionFromSession = vi.fn();
        const deliverRemote = vi.fn();
        const ingestB = ingestHandler.createAgentCommsIngestHandler({
            happyHomeDir: homeB,
            localMachineId: 'machine-b',
            tofuKeypairs: keysB,
            spawnSessionFromSession,
            deliverRemote,
            appendMessage: mailbox.appendMessage,
        });
        const spawnResultEnvelope = scopeAEnvelope({
            id: 'env-spawn-result-reply',
            channel: 'spawn',
            kind: 'spawn-result',
            correlationId: 'spawn-corr-reply',
            to: { machineId: 'machine-b', sessionId: 'requester' },
            body: { type: 'spawn-result', ok: true, result: { type: 'success', sessionId: 'child-2' } },
        });

        const ack = await ingestB(await signedSealedPayload(spawnResultEnvelope, keysA, keysB));

        expect(ack.seq).toBeGreaterThan(0);
        expect(spawnSessionFromSession).not.toHaveBeenCalled();
        expect(deliverRemote).not.toHaveBeenCalled();
        const pending = await mailbox.readPending('requester');
        expect(pending).toHaveLength(1);
        expect((pending[0].body as AgentCommsEnvelope)).toMatchObject({
            id: 'env-spawn-result-reply',
            channel: 'spawn',
            kind: 'spawn-result',
            body: { ok: true, result: { type: 'success', sessionId: 'child-2' } },
        });
    });

    it('rejects a malformed channel/kind mismatch envelope fail-closed: no spawn, no mailbox append', async () => {
        await pinPeerKeys(homeB, 'machine-a', { ...peerKeys(keysA), approvedForSpawn: true });
        const spawnSessionFromSession = vi.fn();
        const deliverRemote = vi.fn();
        const appendMessage = vi.fn(async () => ({ id: 'unexpected', seq: 77 }));
        const ingestB = ingestHandler.createAgentCommsIngestHandler({
            happyHomeDir: homeB,
            localMachineId: 'machine-b',
            tofuKeypairs: keysB,
            spawnSessionFromSession,
            deliverRemote,
            appendMessage,
        });

        // channel='message' mixed with kind='spawn-request' is an envelope the
        // approval predicate gates but the spawn handler must never receive.
        const mismatchEnvelope = scopeAEnvelope({
            id: 'env-malformed-mismatch',
            channel: 'message',
            kind: 'spawn-request',
            correlationId: 'malformed-corr',
            to: { machineId: 'machine-b', sessionId: 'remote-parent' },
            body: { agent: 'codex', cwd: 'D:/repo', initialMessage: 'inspect' },
        });

        await expect(ingestB(await signedSealedPayload(mismatchEnvelope, keysA, keysB)))
            .rejects.toThrow(/malformed spawn envelope/);
        expect(spawnSessionFromSession).not.toHaveBeenCalled();
        expect(deliverRemote).not.toHaveBeenCalled();
        expect(appendMessage).not.toHaveBeenCalled();

        // spawn channel carrying a non-spawn kind is equally rejected.
        const spawnChannelWrongKind = scopeAEnvelope({
            id: 'env-malformed-spawn-channel',
            channel: 'spawn',
            kind: 'request',
            correlationId: 'malformed-corr-2',
            to: { machineId: 'machine-b', sessionId: 'remote-parent' },
            body: { text: 'not a spawn payload' },
        });

        await expect(ingestB(await signedSealedPayload(spawnChannelWrongKind, keysA, keysB)))
            .rejects.toThrow(/malformed spawn envelope/);
        expect(spawnSessionFromSession).not.toHaveBeenCalled();
        expect(deliverRemote).not.toHaveBeenCalled();
        expect(appendMessage).not.toHaveBeenCalled();
    });
});
