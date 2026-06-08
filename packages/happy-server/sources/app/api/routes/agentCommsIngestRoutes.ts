import { z } from "zod";
import { AgentCommsEnvelopeSchema, MAX_HOPS, type AgentCommsEnvelope } from "@slopus/happy-wire";
import { type Fastify } from "../types";

const SenderKeysSchema = z.object({
    ed25519PublicKey: z.string().min(1),
    ecdhPublicKey: z.string().min(1),
    ed25519Fingerprint: z.string().min(1).optional(),
});

export const AgentCommsIngestBodySchema = z.object({
    envelope: AgentCommsEnvelopeSchema,
    signature: z.string().min(1),
    senderKeys: SenderKeysSchema,
});

export type AgentCommsIngestBody = z.infer<typeof AgentCommsIngestBodySchema>;

export type AgentCommsIngestHandler = (body: AgentCommsIngestBody) => Promise<{ id: string; seq: number }>;

export interface AgentCommsIngestRoutesOptions {
    handler?: AgentCommsIngestHandler;
}

function hasDuplicate(values: readonly string[]): boolean {
    return new Set(values).size !== values.length;
}

function routeHopValidation(envelope: AgentCommsEnvelope): string | null {
    if (envelope.hopCount > MAX_HOPS) return `hopCount ${envelope.hopCount} exceeds MAX_HOPS ${MAX_HOPS}`;
    if (hasDuplicate(envelope.hopPath)) return "hopPath contains a duplicate session";
    const targetRefs = new Set([envelope.to.sessionId]);
    if (envelope.to.machineId) targetRefs.add(`${envelope.to.machineId}:${envelope.to.sessionId}`);
    return envelope.hopPath.some(ref => targetRefs.has(ref)) ? "hopPath already contains the target session" : null;
}

/**
 * Scope A ingest endpoint skeleton.
 *
 * The route is reached through the remote daemon's Dev Tunnel into its embedded
 * happy-server. It performs backend-observable request-shape and hop checks,
 * then delegates cryptographic verification (TOFU-pinned Ed25519 signature +
 * ECDH sealed-body open) and mailbox append to the daemon-injected handler.
 */
export function agentCommsIngestRoutes(app: Fastify, options: AgentCommsIngestRoutesOptions = {}) {
    app.post('/agent-comms/ingest', {
        preHandler: [app.authenticate],
        schema: {
            body: AgentCommsIngestBodySchema,
            response: {
                200: z.object({ id: z.string(), seq: z.number() }),
                400: z.object({ error: z.string() }),
                503: z.object({ error: z.string() }),
            },
        },
    }, async (request, reply) => {
        if (!options.handler) {
            return reply.code(503).send({ error: "agent_comms_ingest_unavailable" });
        }
        const hopError = routeHopValidation(request.body.envelope);
        if (hopError) {
            return reply.code(400).send({ error: hopError });
        }
        try {
            return await options.handler(request.body);
        } catch (error) {
            return reply.code(400).send({ error: error instanceof Error ? error.message : String(error) });
        }
    });
}
