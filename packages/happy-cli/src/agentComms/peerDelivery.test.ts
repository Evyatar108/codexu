import { describe, expect, it, vi } from 'vitest';
import * as ed from '@noble/ed25519';
import { sha512 } from '@noble/hashes/sha2.js';
import nacl from 'tweetnacl';
import type { AgentCommsEnvelope } from '@slopus/happy-wire';
import { encodeBase64 } from '@/api/encryption';
import { formatEd25519Fingerprint, type TofuKeypairs } from '@/tofu/keypairManager';
import { openSealedBody, verifyEnvelopeSignature, type SealedAgentCommsBody } from './peerAuth';
import { createDevTunnelsAgentCommsDeliverRemote } from './peerDelivery';
import type { PeerTransportTarget, SignedSealedEnvelope } from './peerTransport';

ed.hashes.sha512 = (message: Uint8Array) => sha512(message);

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

const envelope: AgentCommsEnvelope = {
    v: 1,
    id: 'env-1',
    ts: 1,
    from: { machineId: 'machine-a', sessionId: 'sender' },
    to: { machineId: 'machine-b', sessionId: 'target' },
    scope: 'A',
    channel: 'message',
    kind: 'request',
    hopCount: 0,
    hopPath: ['machine-a:sender'],
    body: { msg: 'plaintext' },
};

describe('createDevTunnelsAgentCommsDeliverRemote', () => {
    it('resolves the pinned peer target, seals the body, signs the sealed envelope, and sends sender keys', async () => {
        const local = await fixtureKeypairs(20);
        const peer = await fixtureKeypairs(21);
        const transport = {
            send: vi.fn(async (_payload: SignedSealedEnvelope, _target: PeerTransportTarget) => ({ id: 'remote-ack', seq: 2 })),
        };
        const deliverRemote = createDevTunnelsAgentCommsDeliverRemote({
            localKeypairs: local,
            resolveTarget: vi.fn(async () => ({
                machineId: 'machine-b',
                tunnelName: 'codexu-peer',
                tunnelId: 'tunnel-b',
                ingestUrl: 'https://peer-3005.devtunnels.ms/agent-comms/ingest',
                peerEcdhPublicKey: encodeBase64(peer.ecdhPublicKey),
                approvedForSpawn: false,
            })),
            transport,
        });

        await expect(deliverRemote(envelope)).resolves.toEqual({ id: 'remote-ack', seq: 2 });

        expect(transport.send).toHaveBeenCalledTimes(1);
        const [payload, target] = transport.send.mock.calls[0]!;
        expect(target).toMatchObject({ machineId: 'machine-b', tunnelId: 'tunnel-b' });
        expect(payload.senderKeys).toEqual({
            ed25519PublicKey: encodeBase64(local.ed25519PublicKey),
            ecdhPublicKey: encodeBase64(local.ecdhPublicKey),
            ed25519Fingerprint: local.ed25519Fingerprint,
        });
        expect(payload.envelope.body).not.toEqual(envelope.body);
        await expect(verifyEnvelopeSignature(payload.envelope, payload.signature, local.ed25519PublicKey)).resolves.toBe(true);
        expect(openSealedBody(payload.envelope.body as SealedAgentCommsBody, peer, local.ecdhPublicKey)).toEqual(envelope.body);
    });
});
