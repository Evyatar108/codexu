import type { AgentCommsEnvelope } from '@slopus/happy-wire';
import type { AgentCommsIngestBody } from 'happy-server';
import { decodeBase64 } from '@/api/encryption';
import type { SpawnSessionFromSessionRpcOptions } from '@/api/apiMachine';
import type { SpawnSessionResult } from '@/modules/common/registerCommonHandlers';
import { appendMessage as appendMailboxMessage } from './mailbox';
import { openSealedBody, requirePinnedPeer, verifyEnvelopeSignature, type SealedAgentCommsBody } from './peerAuth';
import { advanceAgentCommsRelay, requiresOperatorApproval } from './router';
import { handleInboundSpawnRequest } from './spawnApproval';
import type { AgentCommsDeliveryAck } from './router';
import type { TofuKeypairs } from '@/tofu/keypairManager';

export interface CreateAgentCommsIngestHandlerOptions {
    happyHomeDir: string;
    localMachineId: string;
    tofuKeypairs: Pick<TofuKeypairs, 'ecdhPrivateKey'>;
    spawnSessionFromSession: (options: SpawnSessionFromSessionRpcOptions) => Promise<SpawnSessionResult>;
    deliverRemote: (envelope: AgentCommsEnvelope) => Promise<AgentCommsDeliveryAck>;
    appendMessage?: (sessionId: string, body: unknown, sender: string) => Promise<AgentCommsDeliveryAck>;
}

export function createAgentCommsIngestHandler({
    happyHomeDir,
    localMachineId,
    tofuKeypairs,
    spawnSessionFromSession,
    deliverRemote,
    appendMessage = appendMailboxMessage,
}: CreateAgentCommsIngestHandlerOptions): (body: AgentCommsIngestBody) => Promise<AgentCommsDeliveryAck> {
    return async (body) => {
        const pinned = await requirePinnedPeer(happyHomeDir, body.envelope.from.machineId);
        if (body.senderKeys.ed25519Fingerprint && body.senderKeys.ed25519Fingerprint !== pinned.ed25519Fingerprint) {
            throw new Error(`agent-comms peer fingerprint mismatch for ${body.envelope.from.machineId}`);
        }
        if (body.senderKeys.ed25519PublicKey !== pinned.ed25519PublicKey || body.senderKeys.ecdhPublicKey !== pinned.ecdhPublicKey) {
            throw new Error(`agent-comms peer public keys do not match pinned keys for ${body.envelope.from.machineId}`);
        }
        const signatureOk = await verifyEnvelopeSignature(body.envelope, body.signature, decodeBase64(pinned.ed25519PublicKey));
        if (!signatureOk) {
            throw new Error(`agent-comms signature verification failed for ${body.envelope.from.machineId}`);
        }
        const openedBody = openSealedBody<unknown>(body.envelope.body as SealedAgentCommsBody, tofuKeypairs, decodeBase64(pinned.ecdhPublicKey));
        if (openedBody === null) {
            throw new Error(`agent-comms sealed body could not be opened for ${body.envelope.from.machineId}`);
        }
        const openedEnvelope: AgentCommsEnvelope = { ...body.envelope, body: openedBody };
        const relayedEnvelope = advanceAgentCommsRelay(openedEnvelope, { machineId: localMachineId, sessionId: `daemon-${localMachineId}` });
        if (relayedEnvelope.to.machineId && relayedEnvelope.to.machineId !== localMachineId) {
            throw new Error(`agent-comms ingest target machine mismatch: ${relayedEnvelope.to.machineId}`);
        }
        if (relayedEnvelope.kind === 'spawn-request') {
            return handleInboundSpawnRequest(relayedEnvelope, {
                happyHomeDir,
                localMachineId,
                pinnedPeer: pinned,
                spawnSessionFromSession,
                deliverRemote,
            });
        }
        if (requiresOperatorApproval(relayedEnvelope) && !pinned.approvedForSpawn) {
            throw new Error(`agent-comms peer ${body.envelope.from.machineId} is not approved for spawn envelopes`);
        }
        return appendMessage(relayedEnvelope.to.sessionId, relayedEnvelope, relayedEnvelope.from.sessionId);
    };
}
