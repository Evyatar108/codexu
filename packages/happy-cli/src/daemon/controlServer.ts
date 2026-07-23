/**
 * HTTP control server for daemon management
 * Provides endpoints for listing sessions, stopping sessions, and daemon shutdown
 */

import fastify, { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { serializerCompiler, validatorCompiler, ZodTypeProvider } from 'fastify-type-provider-zod';
import { logger } from '@/ui/logger';
import { Metadata } from '@/api/types';
import { decodeBase64 } from '@/api/encryption';
import { TrackedSession, SessionEncryptionData } from './types';
import { isSupportedAgent, SpawnSessionOptions, SpawnSessionResult } from '@/modules/common/registerCommonHandlers';
import { STOP_SESSION_ID_MAX_LENGTH, STOP_SESSION_PID_SUFFIX_SHAPE } from './stopTrackedSession';
import type { SpawnSessionFromSessionRpcOptions } from '@/api/apiMachine';
import { appendMessage, SESSION_ID_REGEX } from '@/agentComms/mailbox';
import { createDevTunnelsAgentCommsDeliverRemote } from '@/agentComms/peerDelivery';
import { AgentCommsRoutingError, dispatchAgentCommsEnvelope, type AgentCommsDeliveryAck, type AgentCommsSessionMetadata } from '@/agentComms/router';
import type { AgentCommsEnvelope } from '@slopus/happy-wire';
import { TunnelManager } from '@/tunnel/tunnelManager';
import type { TofuKeypairs } from '@/tofu/keypairManager';
import {
  DaemonDrainingError,
  type DaemonReplacementCoordinator,
  type DaemonReplacementIdentity,
} from './replacementCoordinator';

const PARENT_SESSION_ID_MAX_LENGTH = 128;
const PARENT_SESSION_ID_SHAPE = /^[A-Za-z0-9_-]+$/;

// agent-comms Scope B (D-002): same-daemon cross-session messaging. Session ids
// are validated with the mailbox path-safety regex at the route boundary so a
// malformed id is rejected with a 400 before it can reach the durable store.
const agentCommsSessionIdSchema = z.string().refine(value => SESSION_ID_REGEX.test(value), {
  message: 'sessionId must match ^[A-Za-z0-9_-]{1,128}$',
});

const spawnSessionFromSessionConfigSchema = z.object({
  agent: z.string().refine(isSupportedAgent, { message: 'agent must be one of: claude, codex, gemini, openclaw' }),
  path: z.string().optional(),
  model: z.string().min(1).optional(),
  permissionMode: z.string().min(1).optional(),
  effortLevel: z.string().min(1).optional(),
  initialMessage: z.string().optional(),
});

export function startDaemonControlServer({
  getChildren,
  stopSession,
  spawnSession,
  spawnSessionFromSession,
  requestShutdown,
  onHappySessionWebhook,
  localMachineId = 'local-machine',
  agentCommsRemote,
  createPairingInvite,
  replacement,
}: {
  getChildren: () => TrackedSession[];
  stopSession: (sessionId: string) => boolean | Promise<boolean>;
  spawnSession: (options: SpawnSessionOptions) => Promise<SpawnSessionResult>;
  spawnSessionFromSession?: (options: SpawnSessionFromSessionRpcOptions) => Promise<SpawnSessionResult>;
  requestShutdown: () => void;
  onHappySessionWebhook: (sessionId: string, metadata: Metadata, encryption?: SessionEncryptionData) => void;
  localMachineId?: string;
  agentCommsRemote?: {
    localKeypairs?: Pick<TofuKeypairs, 'ed25519PublicKey' | 'ed25519PrivateKey' | 'ecdhPublicKey' | 'ecdhPrivateKey' | 'ed25519Fingerprint'>;
    tunnelManager?: Pick<TunnelManager, 'listOperatorTunnels' | 'mintConnectToken'>;
    deliverRemote?: (envelope: AgentCommsEnvelope) => Promise<AgentCommsDeliveryAck>;
  };
  createPairingInvite?: (
    origin: string | undefined,
    publicMode: boolean,
    capability: string | undefined,
  ) => Promise<string>;
  replacement?: {
    coordinator: DaemonReplacementCoordinator;
    identity: DaemonReplacementIdentity;
    onReserved?: () => void;
  };
}): Promise<{ port: number; stop: () => Promise<void> }> {
  return new Promise((resolve) => {
    const app = fastify({
      logger: false // We use our own logger
    });

    // Set up Zod type provider
    app.setValidatorCompiler(validatorCompiler);
    app.setSerializerCompiler(serializerCompiler);
    const typed = app.withTypeProvider<ZodTypeProvider>();
    const deliverRemote = agentCommsRemote?.deliverRemote
      ?? (agentCommsRemote?.localKeypairs
        ? createDevTunnelsAgentCommsDeliverRemote({
          localKeypairs: agentCommsRemote.localKeypairs,
          tunnelManager: agentCommsRemote.tunnelManager,
        })
        : undefined);
    const withAdmission = <T>(action: () => T | Promise<T>): Promise<T> => replacement
      ? replacement.coordinator.withAdmission(action)
      : Promise.resolve().then(action);

    typed.post('/pair', {
      schema: {
        body: z.object({
          origin: z.string().url().optional(),
          public: z.boolean().optional(),
        }),
        response: {
          200: z.object({ invite: z.string() }),
          400: z.object({ error: z.string() }),
          401: z.object({ error: z.string() }),
          503: z.object({ error: z.string() }),
        },
      },
    }, async (request, reply) => {
      if (!createPairingInvite) {
        return reply.code(503).send({ error: 'pairing_unavailable' });
      }
      if (!request.body.public) {
        if (!request.body.origin || new URL(request.body.origin).origin !== request.body.origin) {
          return reply.code(400).send({ error: 'invalid_origin' });
        }
      }
      try {
        return {
          invite: await createPairingInvite(
            request.body.origin,
            request.body.public === true,
            typeof request.headers['x-loopback-capability'] === 'string'
              ? request.headers['x-loopback-capability']
              : undefined,
          ),
        };
      } catch {
        return reply.code(401).send({ error: 'pairing_denied' });
      }
    });

    // Session reports itself after creation
    typed.post('/session-started', {
      schema: {
        body: z.object({
          sessionId: z.string(),
          metadata: z.any(),
          encryption: z.object({
            encryptionKey: z.string(),
            encryptionVariant: z.enum(['legacy', 'dataKey']),
            seq: z.number(),
            metadataVersion: z.number(),
            agentStateVersion: z.number(),
          }).optional()
        }),
        response: {
          200: z.object({
            status: z.literal('ok')
          }),
          409: z.object({ error: z.literal('daemon_draining') }),
        }
      }
    }, async (request, reply) => {
      try {
        return await withAdmission(() => {
          const { sessionId, metadata, encryption } = request.body;

          logger.debug(`[CONTROL SERVER] Session started: ${sessionId}`);

          let encryptionData: SessionEncryptionData | undefined;
          if (encryption) {
            encryptionData = {
              encryptionKey: decodeBase64(encryption.encryptionKey),
              encryptionVariant: encryption.encryptionVariant,
              seq: encryption.seq,
              metadataVersion: encryption.metadataVersion,
              agentStateVersion: encryption.agentStateVersion,
            };
          }

          onHappySessionWebhook(sessionId, metadata, encryptionData);

          return { status: 'ok' as const };
        });
      } catch (error) {
        if (error instanceof DaemonDrainingError) {
          return reply.code(409).send({ error: 'daemon_draining' });
        }
        throw error;
      }
    });

    // List all tracked sessions
    typed.post('/list', {
      schema: {
        response: {
          200: z.object({
            trackedCount: z.number().int().nonnegative(),
            children: z.array(z.object({
              startedBy: z.string(),
              happySessionId: z.string(),
              pid: z.number()
            }))
          })
        }
      }
    }, async () => {
      const children = getChildren();
      logger.debug(`[CONTROL SERVER] Listing ${children.length} sessions`);
      return { 
        trackedCount: children.length,
        children: children
          .filter(child => child.happySessionId !== undefined)
          .map(child => ({
            startedBy: child.startedBy,
            happySessionId: child.happySessionId!,
            pid: child.pid
          }))
      }
    });

    typed.post('/prepare-replacement', {
      schema: {
        body: z.object({
          pid: z.number().int().positive(),
          startedWithCliVersion: z.string().min(1),
          startedWithPayloadArtifactId: z.string().min(1).optional(),
          startedWithPayloadManifestSha256: z.string().min(1).optional(),
        }).strict(),
        response: {
          200: z.object({ reserved: z.literal(true) }),
          409: z.object({
            reserved: z.literal(false),
            reason: z.enum([
              'identity-mismatch',
              'active-children',
              'admission-in-flight',
              'already-draining',
              'unsupported',
            ]),
          }),
        },
      },
    }, async (request, reply) => {
      if (!replacement) {
        return reply.code(409).send({ reserved: false, reason: 'unsupported' });
      }
      const result = replacement.coordinator.prepare(
        request.body,
        replacement.identity,
        getChildren().length,
      );
      if (!result.reserved) return reply.code(409).send(result);

      // Keep the reservation active before yielding the event loop. The response
      // is flushed first; all later admission attempts are already denied.
      reply.hijack();
      reply.raw.statusCode = 200;
      reply.raw.setHeader('content-type', 'application/json; charset=utf-8');
      reply.raw.end(JSON.stringify(result), () => {
        (replacement.onReserved ?? requestShutdown)();
      });
      return reply;
    });

    // Stop specific session
    typed.post('/stop-session', {
      schema: {
        body: z.object({
          sessionId: z.string()
            .min(1)
            .max(STOP_SESSION_ID_MAX_LENGTH)
            .refine(
              (value) => !value.startsWith('PID-') || STOP_SESSION_PID_SUFFIX_SHAPE.test(value.slice('PID-'.length)),
              { message: 'sessionId with PID- prefix must have a 1-10 digit numeric suffix' }
            )
        }),
        response: {
          200: z.object({
            success: z.boolean()
          })
        }
      }
    }, async (request) => {
      const { sessionId } = request.body;

      logger.debug(`[CONTROL SERVER] Stop session request: ${sessionId}`);
      const success = await stopSession(sessionId);
      return { success };
    });

    // Spawn new session
    typed.post('/spawn-session', {
      schema: {
        body: z.object({
          directory: z.string(),
          sessionId: z.string().optional(),
          agent: z.enum(['claude', 'codex', 'gemini', 'openclaw']).optional(),
          environmentVariables: z.record(z.string(), z.string()).optional(),
        }),
        response: {
          200: z.object({
            success: z.boolean(),
            sessionId: z.string().optional(),
            approvedNewDirectoryCreation: z.boolean().optional()
          }),
          409: z.object({
            success: z.boolean(),
            requiresUserApproval: z.boolean().optional(),
            actionRequired: z.string().optional(),
            directory: z.string().optional(),
            error: z.string().optional(),
          }),
          500: z.object({
            success: z.boolean(),
            error: z.string().optional()
          })
        }
      }
    }, async (request, reply) => {
      const { directory, sessionId, agent, environmentVariables } = request.body;

      logger.debug(`[CONTROL SERVER] Spawn session request: dir=${directory}, sessionId=${sessionId || 'new'}, agent=${agent || 'default'}`);
      let result: SpawnSessionResult;
      try {
        result = await withAdmission(
          () => spawnSession({ directory, sessionId, agent, environmentVariables }),
        );
      } catch (error) {
        if (error instanceof DaemonDrainingError) {
          reply.code(409);
          return { success: false, error: 'daemon_draining' };
        }
        throw error;
      }

      switch (result.type) {
        case 'success':
          // Check if sessionId exists, if not return error
          if (!result.sessionId) {
            reply.code(500);
            return {
              success: false,
              error: 'Failed to spawn session: no session ID returned'
            };
          }
          return {
            success: true,
            sessionId: result.sessionId,
            approvedNewDirectoryCreation: true
          };
        
        case 'requestToApproveDirectoryCreation':
          reply.code(409); // Conflict - user input needed
          return { 
            success: false,
            requiresUserApproval: true,
            actionRequired: 'CREATE_DIRECTORY',
            directory: result.directory
          };
        
        case 'error':
          reply.code(500);
          return { 
            success: false,
            error: result.errorMessage
          };
      }
    });

    typed.post('/spawn-session-from-session', {
      schema: {
        body: z.object({
          parentSessionId: z.string()
            .min(1)
            .max(PARENT_SESSION_ID_MAX_LENGTH)
            .refine(value => PARENT_SESSION_ID_SHAPE.test(value), {
              message: 'parentSessionId must be 1-128 characters of [A-Za-z0-9_-]'
            }),
          config: spawnSessionFromSessionConfigSchema,
        }),
        response: {
          200: z.discriminatedUnion('type', [
            z.object({
              type: z.literal('success'),
              sessionId: z.string(),
            }),
            z.object({
              type: z.literal('error'),
              errorMessage: z.string(),
            }),
          ]),
          409: z.object({ type: z.literal('error'), errorMessage: z.literal('daemon_draining') }),
        }
      }
    }, async (request, reply) => {
      if (!spawnSessionFromSession) {
        return { type: 'error' as const, errorMessage: 'Spawn-from-session handler not available' };
      }

      logger.debug(`[CONTROL SERVER] Spawn session from parent request: parentSessionId=${request.body.parentSessionId}, agent=${request.body.config.agent}`);
      let result: SpawnSessionResult;
      try {
        result = await withAdmission(
          () => spawnSessionFromSession(request.body as SpawnSessionFromSessionRpcOptions),
        );
      } catch (error) {
        if (error instanceof DaemonDrainingError) {
          return reply.code(409).send({
            type: 'error',
            errorMessage: 'daemon_draining',
          });
        }
        throw error;
      }
      if (result.type === 'success') {
        return result;
      }

      if (result.type === 'requestToApproveDirectoryCreation') {
        return {
          type: 'error' as const,
          errorMessage: `Directory creation approval is not supported for spawn-from-session: ${result.directory}`,
        };
      }
      return result;
    });

    // agent-comms unified local control hop. The sender's stdio bridge posts
    // here; the daemon resolves B/C/A scope, serializes local writes through one
    // process, and leaves Scope A live networking disabled unless a remote
    // transport is injected in a later pass. No X-Loopback-Capability gate on
    // this control-port path — the 127.0.0.1 binding is the auth boundary.
    typed.post('/agent-comms/send', {
      schema: {
        body: z.object({
          target: z.object({
            machineId: z.string().min(1).optional(),
            sessionId: agentCommsSessionIdSchema,
          }).optional(),
          targetSessionId: agentCommsSessionIdSchema.optional(),
          body: z.unknown(),
          channel: z.enum(['message', 'spawn']).optional(),
          kind: z.enum(['request', 'reply', 'notify', 'spawn-request', 'spawn-result']).optional(),
          correlationId: z.string().min(1).optional(),
          sender: z.object({
            machineId: z.string().min(1).optional(),
            sessionId: agentCommsSessionIdSchema,
          }),
        }).refine(value => Boolean(value.target?.sessionId || value.targetSessionId), {
          message: 'target.sessionId or targetSessionId is required',
        }),
        response: {
          200: z.object({ id: z.string(), seq: z.number() }),
          400: z.object({ error: z.string() }),
          404: z.object({ error: z.string() }),
          501: z.object({ error: z.string() }),
        }
      }
    }, async (request, reply) => {
      const { target, targetSessionId, body, channel, kind, correlationId, sender } = request.body;
      const children = getChildren();
      const tracked = new Set(
        children
          .map(child => child.happySessionId)
          .filter((id): id is string => id !== undefined)
      );
      if (!tracked.has(sender.sessionId)) {
        reply.code(404);
        return { error: `Sender session not tracked by this daemon: ${sender.sessionId}` };
      }
      const sessionMetadata: AgentCommsSessionMetadata[] = children
        .filter((child): child is TrackedSession & { happySessionId: string } => typeof child.happySessionId === 'string')
        .map(child => ({
          sessionId: child.happySessionId,
          parentSessionId: typeof child.happySessionMetadataFromLocalWebhook?.parentSessionId === 'string'
            ? child.happySessionMetadataFromLocalWebhook.parentSessionId
            : undefined,
          spawnedChildren: Array.isArray(child.happySessionMetadataFromLocalWebhook?.spawnedChildren)
            ? child.happySessionMetadataFromLocalWebhook.spawnedChildren.filter((sid): sid is string => typeof sid === 'string')
            : undefined,
        }));
      try {
        const normalizedTarget = target ?? { sessionId: targetSessionId! };
        const { id, seq } = await dispatchAgentCommsEnvelope({
          from: { machineId: sender.machineId ?? localMachineId, sessionId: sender.sessionId },
          to: normalizedTarget,
          body,
          channel,
          kind,
          correlationId,
        }, {
          selfMachineId: localMachineId,
          hasLocalSession: sessionId => tracked.has(sessionId),
          sessionMetadata,
          deliverLocal: envelope => appendMessage(envelope.to.sessionId, envelope, envelope.from.sessionId),
          deliverRemote,
        });
        logger.debug(`[CONTROL SERVER] agent-comms send ${sender.sessionId} -> ${normalizedTarget.machineId ? `${normalizedTarget.machineId}:` : ''}${normalizedTarget.sessionId} (id=${id} seq=${seq})`);
        return { id, seq };
      } catch (error) {
        if (error instanceof AgentCommsRoutingError) {
          reply.code(error.code === 'agent_comms_unknown_local_target' ? 404
            : error.code === 'agent_comms_remote_transport_unavailable' ? 501
            : 400);
          return { error: error.message };
        }
        throw error;
      }
    });

    // Stop daemon
    typed.post('/stop', {
      schema: {
        response: {
          200: z.object({
            status: z.string()
          })
        }
      }
    }, async () => {
      logger.debug('[CONTROL SERVER] Stop daemon request received');

      // Give time for response to arrive
      setTimeout(() => {
        logger.debug('[CONTROL SERVER] Triggering daemon shutdown');
        requestShutdown();
      }, 50);

      return { status: 'stopping' };
    });

    app.listen({ port: 0, host: '127.0.0.1' }, (err, address) => {
      if (err) {
        logger.debug('[CONTROL SERVER] Failed to start:', err);
        throw err;
      }

      const port = parseInt(address.split(':').pop()!);
      logger.debug(`[CONTROL SERVER] Started on port ${port}`);

      resolve({
        port,
        stop: async () => {
          logger.debug('[CONTROL SERVER] Stopping server');
          await app.close();
          logger.debug('[CONTROL SERVER] Server stopped');
        }
      });
    });
  });
}
