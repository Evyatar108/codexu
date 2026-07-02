/**
 * Scope A agent-comms ingest listener (happy-cli owned).
 *
 * Standalone single-route Fastify server that serves only
 * `POST /agent-comms/ingest`. It replaces the embedded happy-server ingest
 * route for the Scope A cross-machine path: a remote daemon's Dev Tunnel
 * forwards its ingest port to this listener's loopback bind, which performs the
 * backend-observable request-shape and hop checks, then delegates cryptographic
 * verification (TOFU-pinned Ed25519 signature + ECDH sealed-body open) and
 * mailbox append to the daemon-injected handler.
 *
 * The 127.0.0.1 bind plus the Dev Tunnels gateway auth (performed and stripped
 * before the request reaches this process) are the transport boundary; the
 * injected handler's cryptographic verification is the caller-identity boundary.
 * There is intentionally no `X-Loopback-Capability` gate here.
 */

import fastify from 'fastify';
import { z } from 'zod';
import { serializerCompiler, validatorCompiler, ZodTypeProvider } from 'fastify-type-provider-zod';
import { AgentCommsIngestBodySchema, routeHopValidation, type AgentCommsIngestHandler } from '@slopus/happy-wire';
import { logger } from '@/ui/logger';

export interface AgentCommsIngestServerOptions {
    /**
     * Loopback port to bind. Must be the exact Dev-Tunnel-forwarded ingest port
     * in production (Option A forwards each registered tunnel port to the
     * same-numbered local port). Pass 0 in tests to bind an ephemeral port and
     * read the actual port back from the returned handle.
     */
    port: number;
    host?: string;
    handler?: AgentCommsIngestHandler;
}

export interface AgentCommsIngestServerHandle {
    port: number;
    stop: () => Promise<void>;
}

export function startAgentCommsIngestServer(options: AgentCommsIngestServerOptions): Promise<AgentCommsIngestServerHandle> {
    const host = options.host ?? '127.0.0.1';
    return new Promise((resolve, reject) => {
        const app = fastify({ logger: false });
        app.setValidatorCompiler(validatorCompiler);
        app.setSerializerCompiler(serializerCompiler);
        const typed = app.withTypeProvider<ZodTypeProvider>();

        typed.post('/agent-comms/ingest', {
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
                return reply.code(503).send({ error: 'agent_comms_ingest_unavailable' });
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

        app.listen({ port: options.port, host }, (err, address) => {
            if (err) {
                logger.debug('[INGEST SERVER] Failed to start:', err);
                reject(err);
                return;
            }
            const boundPort = parseInt(address.split(':').pop()!);
            logger.debug(`[INGEST SERVER] Started on ${host}:${boundPort}`);
            resolve({
                port: boundPort,
                stop: async () => {
                    logger.debug('[INGEST SERVER] Stopping server');
                    await app.close();
                    logger.debug('[INGEST SERVER] Server stopped');
                },
            });
        });
    });
}
