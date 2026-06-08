import { describe, expect, it, vi } from 'vitest';
import { MAX_HOPS, type AgentCommsEnvelope } from '@slopus/happy-wire';
import {
    AgentCommsRoutingError,
    advanceAgentCommsRelay,
    createAgentCommsEnvelope,
    dispatchAgentCommsEnvelope,
    requiresOperatorApproval,
    resolveScope,
    validateAgentCommsHops,
    type AgentCommsResolveContext,
} from './router';

const context: AgentCommsResolveContext = {
    selfMachineId: 'machine-a',
    hasLocalSession: (sessionId) => ['parent', 'child', 'peer'].includes(sessionId),
    sessionMetadata: [
        { sessionId: 'parent', spawnedChildren: ['machine-a:child'] },
        { sessionId: 'child', parentSessionId: 'machine-a:parent' },
    ],
};

const from = { machineId: 'machine-a', sessionId: 'parent' };

describe('agent-comms router', () => {
    it('routes same-machine peers as Scope B', () => {
        expect(resolveScope(from, { sessionId: 'peer' }, context)).toBe('B');
    });

    it('routes known parent-child edges as Scope C without discovery', () => {
        expect(resolveScope(from, { sessionId: 'child' }, context)).toBe('C');
        expect(resolveScope({ machineId: 'machine-a', sessionId: 'child' }, { sessionId: 'parent' }, context)).toBe('C');
    });

    it('routes a foreign machineId as Scope A', () => {
        expect(resolveScope(from, { machineId: 'machine-b', sessionId: 'peer' }, context)).toBe('A');
    });

    it('rejects unknown local targets before mailbox delivery', () => {
        expect(() => resolveScope(from, { sessionId: 'missing' }, context)).toThrow(AgentCommsRoutingError);
    });

    it('validates hop cap and loop path invariants', () => {
        expect(() => validateAgentCommsHops({ to: { sessionId: 'peer' }, hopCount: MAX_HOPS + 1, hopPath: [] })).toThrow(/exceeds MAX_HOPS/);
        expect(() => validateAgentCommsHops({ to: { sessionId: 'peer' }, hopCount: 1, hopPath: ['peer'] })).toThrow(/target session/);
        expect(() => validateAgentCommsHops({ to: { sessionId: 'peer' }, hopCount: 1, hopPath: ['parent', 'parent'] })).toThrow(/duplicate/);
    });

    it('creates envelopes with derived scope and default hop path', () => {
        const envelope = createAgentCommsEnvelope({ from, to: { sessionId: 'peer' }, body: { hello: true } }, context);
        expect(envelope.scope).toBe('B');
        expect(envelope.hopCount).toBe(0);
        expect(envelope.hopPath).toEqual(['machine-a:parent']);
    });

    it('increments and validates relay hops independently', () => {
        const envelope = createAgentCommsEnvelope({ from, to: { machineId: 'machine-b', sessionId: 'remote' }, body: {} }, context);
        const relayed = advanceAgentCommsRelay(envelope, from);
        expect(relayed.hopCount).toBe(1);
        expect(relayed.hopPath).toEqual(['machine-a:parent']);
    });

    it('dispatches Scope A through the remote transport and marks cross-machine spawns for approval', async () => {
        const deliverRemote = vi.fn(async (envelope: AgentCommsEnvelope) => ({ id: envelope.id, seq: 7 }));
        const result = await dispatchAgentCommsEnvelope({
            from,
            to: { machineId: 'machine-b', sessionId: 'remote' },
            channel: 'spawn',
            kind: 'spawn-request',
            body: { agent: 'codex' },
        }, {
            ...context,
            deliverLocal: vi.fn(),
            deliverRemote,
        });
        expect(result.seq).toBe(7);
        expect(deliverRemote).toHaveBeenCalledTimes(1);
        expect(requiresOperatorApproval(deliverRemote.mock.calls[0][0])).toBe(true);
    });

    it('fails closed when Scope A transport is not wired', async () => {
        await expect(dispatchAgentCommsEnvelope({
            from,
            to: { machineId: 'machine-b', sessionId: 'remote' },
            body: {},
        }, {
            ...context,
            deliverLocal: vi.fn(),
        })).rejects.toMatchObject({ code: 'agent_comms_remote_transport_unavailable' });
    });
});
