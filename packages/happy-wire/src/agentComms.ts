import * as z from 'zod';

/**
 * Hop-count cap for cross-scope envelope relays.
 *
 * Every relaying daemon increments `hopCount` and rejects when it exceeds
 * `MAX_HOPS`. The initial cap is 4; chains beyond this length are treated
 * as cross-scope cycles. See `plans/agent-comms-design.md` §3 / §6.
 */
export const MAX_HOPS = 4;

export const AgentCommsScopeSchema = z.enum(['B', 'C', 'A']);
export type AgentCommsScope = z.infer<typeof AgentCommsScopeSchema>;

export const AgentCommsChannelSchema = z.enum(['message', 'spawn']);
export type AgentCommsChannel = z.infer<typeof AgentCommsChannelSchema>;

export const AgentCommsKindSchema = z.enum([
  'request',
  'reply',
  'notify',
  'spawn-request',
  'spawn-result',
]);
export type AgentCommsKind = z.infer<typeof AgentCommsKindSchema>;

export const AgentCommsFromSchema = z.object({
  machineId: z.string().min(1),
  sessionId: z.string().min(1),
});
export type AgentCommsFrom = z.infer<typeof AgentCommsFromSchema>;

export const AgentCommsToSchema = z.object({
  machineId: z.string().min(1).optional(),
  sessionId: z.string().min(1),
});
export type AgentCommsTo = z.infer<typeof AgentCommsToSchema>;

/**
 * Shared wire envelope for unified agent-to-agent communication.
 *
 * Carries both `agent_comms.send` (message channel) and `agent_comms.spawn`
 * (spawn channel) payloads across all three scopes (B, C, A). The router
 * derives/asserts `scope`; the envelope carries it for audit so downstream
 * relays can verify the dispatch path independently. Hop tracking
 * (`hopCount`, `hopPath`) is the load-bearing cross-scope cycle gate; see
 * `plans/agent-comms-design.md` §3 and §6 for the producer/relay rules.
 */
export const AgentCommsEnvelopeSchema = z.object({
  v: z.literal(1),
  id: z.string().min(1),
  ts: z.number().int().nonnegative(),
  from: AgentCommsFromSchema,
  to: AgentCommsToSchema,
  scope: AgentCommsScopeSchema,
  channel: AgentCommsChannelSchema,
  kind: AgentCommsKindSchema,
  correlationId: z.string().min(1).optional(),
  hopCount: z.number().int().min(0).max(MAX_HOPS),
  hopPath: z.array(z.string().min(1)),
  body: z.unknown(),
});
export type AgentCommsEnvelope = z.infer<typeof AgentCommsEnvelopeSchema>;
