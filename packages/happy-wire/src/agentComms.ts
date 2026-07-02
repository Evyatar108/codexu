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

/**
 * Sender public-key material carried alongside a Scope A ingest envelope.
 *
 * These are the pinned peer's Ed25519/X25519 public keys (and optional
 * fingerprint) used by the receiving daemon to verify the detached signature
 * and open the sealed body. See `plans/agent-comms-design.md` §5.4.
 */
export const SenderKeysSchema = z.object({
  ed25519PublicKey: z.string().min(1),
  ecdhPublicKey: z.string().min(1),
  ed25519Fingerprint: z.string().min(1).optional(),
});
export type SenderKeys = z.infer<typeof SenderKeysSchema>;

/**
 * Wire body for the Scope A `POST /agent-comms/ingest` endpoint.
 *
 * The receiving daemon's ingest listener validates this shape at the Zod
 * boundary, runs `routeHopValidation`, then delegates cryptographic
 * verification and mailbox append to the daemon-injected handler.
 */
export const AgentCommsIngestBodySchema = z.object({
  envelope: AgentCommsEnvelopeSchema,
  signature: z.string().min(1),
  senderKeys: SenderKeysSchema,
});
export type AgentCommsIngestBody = z.infer<typeof AgentCommsIngestBodySchema>;

/** The daemon-injected closure that performs auth + mailbox delivery for an ingest body. */
export type AgentCommsIngestHandler = (body: AgentCommsIngestBody) => Promise<{ id: string; seq: number }>;

function hasDuplicate(values: readonly string[]): boolean {
  return new Set(values).size !== values.length;
}

/**
 * Backend-observable hop checks performed before an ingest body reaches the
 * cryptographic handler. Returns a human-readable error string when the
 * envelope violates a hop invariant (hop-count cap, duplicate hop, or the
 * hopPath already containing the target session), or `null` when it is valid.
 */
export function routeHopValidation(envelope: AgentCommsEnvelope): string | null {
  if (envelope.hopCount > MAX_HOPS) return `hopCount ${envelope.hopCount} exceeds MAX_HOPS ${MAX_HOPS}`;
  if (hasDuplicate(envelope.hopPath)) return 'hopPath contains a duplicate session';
  const targetRefs = new Set([envelope.to.sessionId]);
  if (envelope.to.machineId) targetRefs.add(`${envelope.to.machineId}:${envelope.to.sessionId}`);
  return envelope.hopPath.some(ref => targetRefs.has(ref)) ? 'hopPath already contains the target session' : null;
}
