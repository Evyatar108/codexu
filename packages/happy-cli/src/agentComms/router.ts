/**
 * Scope-aware router for the unified agent-comms API.
 *
 * The router owns the logical Scope B/C/A decision and the cross-scope cycle
 * gates. Physical delivery stays injected: local delivery is the durable
 * mailbox sink, while Scope A delivery is the Dev Tunnels transport skeleton.
 */

import { randomUUID } from 'node:crypto';
import {
    AgentCommsEnvelopeSchema,
    MAX_HOPS,
    type AgentCommsChannel,
    type AgentCommsEnvelope,
    type AgentCommsKind,
    type AgentCommsScope,
} from '@slopus/happy-wire';

export interface AgentCommsEndpoint {
    machineId?: string;
    sessionId: string;
}

export interface AgentCommsSender {
    machineId: string;
    sessionId: string;
}

export interface AgentCommsSessionMetadata {
    sessionId: string;
    parentSessionId?: string;
    spawnedChildren?: readonly string[];
}

export interface AgentCommsResolveContext {
    selfMachineId: string;
    hasLocalSession?: (sessionId: string) => boolean;
    isParentChildEdge?: (leftSessionId: string, rightSessionId: string) => boolean;
    sessionMetadata?: readonly AgentCommsSessionMetadata[];
}

export interface AgentCommsDeliveryAck {
    id: string;
    seq: number;
}

export interface AgentCommsDispatchContext extends AgentCommsResolveContext {
    deliverLocal: (envelope: AgentCommsEnvelope) => Promise<AgentCommsDeliveryAck>;
    deliverRemote?: (envelope: AgentCommsEnvelope) => Promise<AgentCommsDeliveryAck>;
}

export interface AgentCommsDispatchInput {
    from: AgentCommsSender;
    to: AgentCommsEndpoint;
    body: unknown;
    channel?: AgentCommsChannel;
    kind?: AgentCommsKind;
    correlationId?: string;
    hopCount?: number;
    hopPath?: readonly string[];
    now?: number;
    id?: string;
}

export class AgentCommsRoutingError extends Error {
    constructor(
        readonly code: 'agent_comms_unknown_local_target'
            | 'agent_comms_cycle_detected'
            | 'agent_comms_remote_transport_unavailable',
        message: string,
    ) {
        super(message);
        this.name = 'AgentCommsRoutingError';
    }
}

function compositeSession(machineId: string, sessionId: string): string {
    return `${machineId}:${sessionId}`;
}

function sameMachine(machineId: string | undefined, selfMachineId: string): boolean {
    return !machineId || machineId === selfMachineId;
}

function refMatchesSession(ref: string | undefined, selfMachineId: string, sessionId: string): boolean {
    return ref === sessionId || ref === compositeSession(selfMachineId, sessionId);
}

function metadataDeclaresParentChild(
    parentSessionId: string,
    childSessionId: string,
    context: AgentCommsResolveContext,
): boolean {
    const metadata = context.sessionMetadata ?? [];
    const parent = metadata.find(item => item.sessionId === parentSessionId);
    const child = metadata.find(item => item.sessionId === childSessionId);
    const parentListsChild = parent?.spawnedChildren?.some(ref => refMatchesSession(ref, context.selfMachineId, childSessionId)) ?? false;
    const childNamesParent = refMatchesSession(child?.parentSessionId, context.selfMachineId, parentSessionId);
    return parentListsChild || childNamesParent;
}

function isKnownParentChildEdge(from: AgentCommsSender, to: AgentCommsEndpoint, context: AgentCommsResolveContext): boolean {
    if (!sameMachine(to.machineId, context.selfMachineId)) return false;
    const direct = context.isParentChildEdge?.(from.sessionId, to.sessionId)
        || context.isParentChildEdge?.(to.sessionId, from.sessionId);
    return Boolean(direct)
        || metadataDeclaresParentChild(from.sessionId, to.sessionId, context)
        || metadataDeclaresParentChild(to.sessionId, from.sessionId, context);
}

function assertLocalTargetTracked(target: AgentCommsEndpoint, context: AgentCommsResolveContext): void {
    if (!sameMachine(target.machineId, context.selfMachineId)) return;
    const hasLocalSession = context.hasLocalSession ?? (() => true);
    if (!hasLocalSession(target.sessionId)) {
        throw new AgentCommsRoutingError(
            'agent_comms_unknown_local_target',
            `Target session is not tracked by this daemon: ${target.sessionId}`,
        );
    }
}

export function resolveScope(
    from: AgentCommsSender,
    to: AgentCommsEndpoint,
    context: AgentCommsResolveContext,
): AgentCommsScope {
    if (!sameMachine(to.machineId, context.selfMachineId)) {
        return 'A';
    }
    assertLocalTargetTracked(to, context);
    return isKnownParentChildEdge(from, to, context) ? 'C' : 'B';
}

function hasDuplicate(values: readonly string[]): boolean {
    return new Set(values).size !== values.length;
}

export function validateAgentCommsHops(envelope: Pick<AgentCommsEnvelope, 'to' | 'hopCount' | 'hopPath'>): void {
    if (envelope.hopCount > MAX_HOPS) {
        throw new AgentCommsRoutingError(
            'agent_comms_cycle_detected',
            `agent-comms hopCount ${envelope.hopCount} exceeds MAX_HOPS ${MAX_HOPS}`,
        );
    }
    if (hasDuplicate(envelope.hopPath)) {
        throw new AgentCommsRoutingError('agent_comms_cycle_detected', 'agent-comms hopPath contains a duplicate session');
    }
    const targetRefs = new Set([envelope.to.sessionId]);
    if (envelope.to.machineId) targetRefs.add(compositeSession(envelope.to.machineId, envelope.to.sessionId));
    if (envelope.hopPath.some(ref => targetRefs.has(ref))) {
        throw new AgentCommsRoutingError('agent_comms_cycle_detected', 'agent-comms hopPath already contains the target session');
    }
}

export function createAgentCommsEnvelope(input: AgentCommsDispatchInput, context: AgentCommsResolveContext): AgentCommsEnvelope {
    const scope = resolveScope(input.from, input.to, context);
    const envelope: AgentCommsEnvelope = {
        v: 1,
        id: input.id ?? randomUUID(),
        ts: input.now ?? Date.now(),
        from: input.from,
        to: input.to,
        scope,
        channel: input.channel ?? 'message',
        kind: input.kind ?? 'request',
        correlationId: input.correlationId,
        hopCount: input.hopCount ?? 0,
        hopPath: [...(input.hopPath ?? [compositeSession(input.from.machineId, input.from.sessionId)])],
        body: input.body,
    };
    const parsed = AgentCommsEnvelopeSchema.parse(envelope);
    validateAgentCommsHops(parsed);
    return parsed;
}

export function advanceAgentCommsRelay(envelope: AgentCommsEnvelope, relay: AgentCommsSender): AgentCommsEnvelope {
    const relayRef = compositeSession(relay.machineId, relay.sessionId);
    const next = AgentCommsEnvelopeSchema.parse({
        ...envelope,
        hopCount: envelope.hopCount + 1,
        hopPath: envelope.hopPath.includes(relayRef) ? envelope.hopPath : [...envelope.hopPath, relayRef],
    });
    validateAgentCommsHops(next);
    return next;
}

export function requiresOperatorApproval(envelope: AgentCommsEnvelope): boolean {
    return envelope.scope === 'A' && (envelope.channel === 'spawn' || envelope.kind === 'spawn-request');
}

export async function dispatchAgentCommsEnvelope(
    input: AgentCommsDispatchInput,
    context: AgentCommsDispatchContext,
): Promise<AgentCommsDeliveryAck> {
    const envelope = createAgentCommsEnvelope(input, context);
    if (envelope.scope === 'A') {
        if (!context.deliverRemote) {
            throw new AgentCommsRoutingError(
                'agent_comms_remote_transport_unavailable',
                'Scope A delivery requires the Dev Tunnels peer transport, which is design-level in this pass.',
            );
        }
        return context.deliverRemote(envelope);
    }
    return context.deliverLocal(envelope);
}
