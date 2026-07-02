import { z } from "zod";
import {
    AgentCommsIngestBodySchema,
    routeHopValidation,
    type AgentCommsIngestHandler,
} from "@slopus/happy-wire";
import { type Fastify } from "../types";

export type { AgentCommsIngestHandler };

export interface AgentCommsIngestRoutesOptions {
    handler?: AgentCommsIngestHandler;
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
