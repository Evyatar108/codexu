/**
 * Scope A outbound delivery composition.
 */

import { AgentCommsEnvelopeSchema, type AgentCommsEnvelope } from '@slopus/happy-wire';
import { decodeBase64, encodeBase64 } from '@/api/encryption';
import { configuration } from '@/configuration';
import { TunnelManager } from '@/tunnel/tunnelManager';
import type { TofuKeypairs } from '@/tofu/keypairManager';
import { DevTunnelsPeerTransport, type AgentCommsPeerTransport } from './peerTransport';
import { resolvePeerTarget, type ResolvePeerTargetOptions, type ResolvedPeerTransportTarget } from './peerResolver';
import { sealBody, signEnvelope } from './peerAuth';
import type { AgentCommsDeliveryAck } from './router';

export interface CreateDevTunnelsAgentCommsDeliverRemoteOptions {
    happyHomeDir?: string;
    localKeypairs: Pick<TofuKeypairs, 'ed25519PublicKey' | 'ed25519PrivateKey' | 'ecdhPublicKey' | 'ecdhPrivateKey' | 'ed25519Fingerprint'>;
    tunnelManager?: Pick<TunnelManager, 'listOperatorTunnels' | 'mintConnectToken'>;
    resolveTarget?: (machineId: string, options?: ResolvePeerTargetOptions) => Promise<ResolvedPeerTransportTarget>;
    transport?: Pick<AgentCommsPeerTransport, 'send'>;
}

export function createDevTunnelsAgentCommsDeliverRemote({
    happyHomeDir = configuration.happyHomeDir,
    localKeypairs,
    tunnelManager = new TunnelManager(),
    resolveTarget = resolvePeerTarget,
    transport = new DevTunnelsPeerTransport(tunnelManager),
}: CreateDevTunnelsAgentCommsDeliverRemoteOptions): (envelope: AgentCommsEnvelope) => Promise<AgentCommsDeliveryAck> {
    return async (envelope) => {
        if (!envelope.to.machineId) {
            throw new Error('Scope A delivery requires target.machineId');
        }

        const target = await resolveTarget(envelope.to.machineId, { happyHomeDir, tunnelManager });
        const sealedEnvelope = AgentCommsEnvelopeSchema.parse({
            ...envelope,
            body: sealBody(envelope.body, localKeypairs, decodeBase64(target.peerEcdhPublicKey)),
        });

        return transport.send({
            envelope: sealedEnvelope,
            signature: await signEnvelope(sealedEnvelope, localKeypairs),
            senderKeys: {
                ed25519PublicKey: encodeBase64(localKeypairs.ed25519PublicKey),
                ecdhPublicKey: encodeBase64(localKeypairs.ecdhPublicKey),
                ed25519Fingerprint: localKeypairs.ed25519Fingerprint,
            },
        }, target);
    };
}
