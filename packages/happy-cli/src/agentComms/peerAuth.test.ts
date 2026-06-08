import { afterAll, describe, expect, it } from 'vitest';
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
import {
    openSealedBody,
    peerPinStorePath,
    pinPeerKeys,
    readPeerPins,
    sealBody,
    signEnvelope,
    verifyEnvelopeSignature,
} from './peerAuth';

ed.hashes.sha512 = (message: Uint8Array) => sha512(message);

const tempHome = fsSync.mkdtempSync(path.join(tmpdir(), 'happy-peer-auth-test-'));

afterAll(async () => {
    await fs.rm(tempHome, { recursive: true, force: true });
});

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

function envelope(): AgentCommsEnvelope {
    return {
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
        body: { sealed: true },
    };
}

describe('peerAuth', () => {
    it('signs and verifies an AgentCommsEnvelope with fixture Ed25519 keys', async () => {
        const sender = await fixtureKeypairs(1);
        const signature = await signEnvelope(envelope(), sender);

        await expect(verifyEnvelopeSignature(envelope(), signature, sender.ed25519PublicKey)).resolves.toBe(true);
        await expect(verifyEnvelopeSignature({ ...envelope(), id: 'env-2' }, signature, sender.ed25519PublicKey)).resolves.toBe(false);
    });

    it('seals and opens a body with fixture ECDH keys', async () => {
        const sender = await fixtureKeypairs(2);
        const recipient = await fixtureKeypairs(3);
        const sealed = sealBody({ msg: 'hello' }, sender, recipient.ecdhPublicKey);

        const stranger = await fixtureKeypairs(9);
        expect(openSealedBody<{ msg: string }>(sealed, recipient, sender.ecdhPublicKey)).toEqual({ msg: 'hello' });
        expect(openSealedBody(sealed, stranger, sender.ecdhPublicKey)).toBeNull();
    });

    it('pins peer keys by machineId and rejects fingerprint changes', async () => {
        const peer = await fixtureKeypairs(4);
        const otherPeer = await fixtureKeypairs(5);
        const pinned = await pinPeerKeys(tempHome, 'machine-b', {
            ed25519PublicKey: encodeBase64(peer.ed25519PublicKey),
            ecdhPublicKey: encodeBase64(peer.ecdhPublicKey),
        }, new Date('2026-01-01T00:00:00Z'));

        expect(pinned.ed25519Fingerprint).toBe(peer.ed25519Fingerprint);
        expect(peerPinStorePath(tempHome)).toContain(path.join('agent-comms', 'peers.json'));
        await expect(readPeerPins(tempHome)).resolves.toMatchObject({ peers: { 'machine-b': { machineId: 'machine-b' } } });
        await expect(pinPeerKeys(tempHome, 'machine-b', {
            ed25519PublicKey: encodeBase64(otherPeer.ed25519PublicKey),
            ecdhPublicKey: encodeBase64(otherPeer.ecdhPublicKey),
        })).rejects.toThrow(/fingerprint changed/);
    });
});
