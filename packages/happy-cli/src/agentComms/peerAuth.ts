/**
 * Scope A app-layer peer authentication helpers.
 *
 * Microsoft Dev Tunnels authenticates the connection at the gateway, but the
 * backend cannot see `X-Tunnel-Authorization` after the gateway consumes it.
 * The backend-observable checks therefore live here: detached Ed25519
 * signatures over canonical AgentCommsEnvelope data, X25519/TweetNaCl sealed
 * bodies, and TOFU pinning of peer public keys by machineId.
 */

import { createHash } from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as ed from '@noble/ed25519';
import { sha512 } from '@noble/hashes/sha2.js';
import nacl from 'tweetnacl';
import type { AgentCommsEnvelope } from '@slopus/happy-wire';
import { decodeBase64, encodeBase64, getRandomBytes } from '@/api/encryption';
import { formatEd25519Fingerprint, type TofuKeypairs } from '@/tofu/keypairManager';

ed.hashes.sha512 = (message: Uint8Array) => sha512(message);

export interface PeerPublicKeys {
    ed25519PublicKey: string;
    ecdhPublicKey: string;
    ed25519Fingerprint?: string;
}

export interface PeerConfigHints {
    tunnelName?: string;
    tunnelId?: string;
    /**
     * The peer's forwarded ingest port (Scope A). Scope A forwards two Dev Tunnel
     * ports — the embedded happy-server port and the happy-cli ingest port — so the
     * outbound resolver needs the peer's ingest port to target the right one.
     */
    ingestPort?: number;
    approvedForSpawn?: boolean;
}

export interface PinnedPeerKeys extends PeerPublicKeys, PeerConfigHints {
    machineId: string;
    ed25519Fingerprint: string;
    pinnedAt: string;
}

export interface PeerPinStore {
    version: 1;
    peers: Record<string, PinnedPeerKeys>;
}

export interface SealedAgentCommsBody {
    v: 1;
    nonce: string;
    ciphertext: string;
}

function stableJson(value: unknown): string {
    if (value === null || typeof value !== 'object') return JSON.stringify(value);
    if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).filter(key => record[key] !== undefined).sort().map(key => `${JSON.stringify(key)}:${stableJson(record[key])}`).join(',')}}`;
}

export function canonicalizeEnvelopeForSignature(envelope: AgentCommsEnvelope): Uint8Array {
    return new TextEncoder().encode(stableJson(envelope));
}

export async function signEnvelope(envelope: AgentCommsEnvelope, keypairs: Pick<TofuKeypairs, 'ed25519PrivateKey'>): Promise<string> {
    const signature = await ed.signAsync(canonicalizeEnvelopeForSignature(envelope), keypairs.ed25519PrivateKey);
    return encodeBase64(signature);
}

export async function verifyEnvelopeSignature(envelope: AgentCommsEnvelope, signatureBase64: string, ed25519PublicKey: Uint8Array): Promise<boolean> {
    try {
        return await ed.verifyAsync(decodeBase64(signatureBase64), canonicalizeEnvelopeForSignature(envelope), ed25519PublicKey);
    } catch {
        return false;
    }
}

export function sealBody(body: unknown, sender: Pick<TofuKeypairs, 'ecdhPrivateKey'>, recipientEcdhPublicKey: Uint8Array): SealedAgentCommsBody {
    const nonce = getRandomBytes(nacl.box.nonceLength);
    const plaintext = new TextEncoder().encode(JSON.stringify(body));
    const ciphertext = nacl.box(plaintext, nonce, recipientEcdhPublicKey, sender.ecdhPrivateKey);
    return { v: 1, nonce: encodeBase64(nonce), ciphertext: encodeBase64(ciphertext) };
}

export function openSealedBody<T>(sealed: SealedAgentCommsBody, recipient: Pick<TofuKeypairs, 'ecdhPrivateKey'>, senderEcdhPublicKey: Uint8Array): T | null {
    if (sealed.v !== 1) return null;
    const plaintext = nacl.box.open(decodeBase64(sealed.ciphertext), decodeBase64(sealed.nonce), senderEcdhPublicKey, recipient.ecdhPrivateKey);
    if (!plaintext) return null;
    return JSON.parse(new TextDecoder().decode(plaintext)) as T;
}

export function peerPinStorePath(happyHomeDir: string): string {
    return path.join(happyHomeDir, 'agent-comms', 'peers.json');
}

function emptyStore(): PeerPinStore {
    return { version: 1, peers: {} };
}

export async function readPeerPins(happyHomeDir: string): Promise<PeerPinStore> {
    try {
        const parsed = JSON.parse(await fs.readFile(peerPinStorePath(happyHomeDir), 'utf8')) as PeerPinStore;
        return { version: 1, peers: parsed.peers ?? {} };
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return emptyStore();
        throw error;
    }
}

export async function pinPeerKeys(happyHomeDir: string, machineId: string, publicKeys: PeerPublicKeys & PeerConfigHints, now = new Date()): Promise<PinnedPeerKeys> {
    const ed25519PublicKey = decodeBase64(publicKeys.ed25519PublicKey);
    const fingerprint = publicKeys.ed25519Fingerprint ?? formatEd25519Fingerprint(ed25519PublicKey);
    const store = await readPeerPins(happyHomeDir);
    const existing = store.peers[machineId];
    if (existing && existing.ed25519Fingerprint !== fingerprint) {
        throw new Error(`agent-comms peer ${machineId} Ed25519 fingerprint changed: ${existing.ed25519Fingerprint} -> ${fingerprint}`);
    }
    const pinned: PinnedPeerKeys = {
        machineId,
        ed25519PublicKey: publicKeys.ed25519PublicKey,
        ecdhPublicKey: publicKeys.ecdhPublicKey,
        ed25519Fingerprint: fingerprint,
        pinnedAt: existing?.pinnedAt ?? now.toISOString(),
        tunnelName: publicKeys.tunnelName ?? existing?.tunnelName,
        tunnelId: publicKeys.tunnelId ?? existing?.tunnelId,
        ingestPort: publicKeys.ingestPort ?? existing?.ingestPort,
        approvedForSpawn: publicKeys.approvedForSpawn ?? existing?.approvedForSpawn,
    };
    await fs.mkdir(path.dirname(peerPinStorePath(happyHomeDir)), { recursive: true });
    await fs.writeFile(peerPinStorePath(happyHomeDir), JSON.stringify({ version: 1, peers: { ...store.peers, [machineId]: pinned } }, null, 2), 'utf8');
    return pinned;
}

export async function requirePinnedPeer(happyHomeDir: string, machineId: string): Promise<PinnedPeerKeys> {
    const pinned = (await readPeerPins(happyHomeDir)).peers[machineId];
    if (!pinned) throw new Error(`agent-comms peer ${machineId} is not TOFU-pinned`);
    return pinned;
}

export function peerKeyFingerprint(publicKeyBase64: string): string {
    const digest = createHash('sha256').update(decodeBase64(publicKeyBase64)).digest('base64').replace(/=+$/u, '');
    return `SHA256:${digest}`;
}
