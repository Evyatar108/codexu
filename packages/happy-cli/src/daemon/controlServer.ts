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
  onHappySessionWebhook
}: {
  getChildren: () => TrackedSession[];
  stopSession: (sessionId: string) => boolean | Promise<boolean>;
  spawnSession: (options: SpawnSessionOptions) => Promise<SpawnSessionResult>;
  spawnSessionFromSession?: (options: SpawnSessionFromSessionRpcOptions) => Promise<SpawnSessionResult>;
  requestShutdown: () => void;
  onHappySessionWebhook: (sessionId: string, metadata: Metadata, encryption?: SessionEncryptionData) => void;
}): Promise<{ port: number; stop: () => Promise<void> }> {
  return new Promise((resolve) => {
    const app = fastify({
      logger: false // We use our own logger
    });

    // Set up Zod type provider
    app.setValidatorCompiler(validatorCompiler);
    app.setSerializerCompiler(serializerCompiler);
    const typed = app.withTypeProvider<ZodTypeProvider>();

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
          })
        }
      }
    }, async (request) => {
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

    // List all tracked sessions
    typed.post('/list', {
      schema: {
        response: {
          200: z.object({
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
        children: children
          .filter(child => child.happySessionId !== undefined)
          .map(child => ({
            startedBy: child.startedBy,
            happySessionId: child.happySessionId!,
            pid: child.pid
          }))
      }
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
            directory: z.string().optional()
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
      const result = await spawnSession({ directory, sessionId, agent, environmentVariables });

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
        }
      }
    }, async (request, reply) => {
      if (!spawnSessionFromSession) {
        return { type: 'error' as const, errorMessage: 'Spawn-from-session handler not available' };
      }

      logger.debug(`[CONTROL SERVER] Spawn session from parent request: parentSessionId=${request.body.parentSessionId}, agent=${request.body.config.agent}`);
      const result = await spawnSessionFromSession(request.body as SpawnSessionFromSessionRpcOptions);
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

    // agent-comms Scope B (D-002): same-daemon cross-session message hop.
    // The sender's stdio bridge posts here; the daemon serializes the write
    // through one process to avoid two-writer races on the target inbox file.
    // No X-Loopback-Capability gate on this control-port path — the 127.0.0.1
    // binding is the auth boundary (per plan F-002). See
    // packages/happy-cli/src/agentComms/mailbox.ts + plans/durable-mailbox-channel-wake.md.
    typed.post('/agent-comms/send', {
      schema: {
        body: z.object({
          targetSessionId: agentCommsSessionIdSchema,
          body: z.unknown(),
          sender: z.object({ sessionId: agentCommsSessionIdSchema }),
        }),
        response: {
          200: z.object({ id: z.string(), seq: z.number() }),
          404: z.object({ error: z.string() }),
        }
      }
    }, async (request, reply) => {
      const { targetSessionId, body, sender } = request.body;
      const tracked = new Set(
        getChildren()
          .map(child => child.happySessionId)
          .filter((id): id is string => id !== undefined)
      );
      if (!tracked.has(sender.sessionId)) {
        reply.code(404);
        return { error: `Sender session not tracked by this daemon: ${sender.sessionId}` };
      }
      if (!tracked.has(targetSessionId)) {
        reply.code(404);
        return { error: `Target session not tracked by this daemon: ${targetSessionId}` };
      }
      const { id, seq } = await appendMessage(targetSessionId, body, sender.sessionId);
      logger.debug(`[CONTROL SERVER] agent-comms send ${sender.sessionId} -> ${targetSessionId} (id=${id} seq=${seq})`);
      return { id, seq };
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
