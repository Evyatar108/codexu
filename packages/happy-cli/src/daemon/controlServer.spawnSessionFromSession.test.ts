import { afterEach, describe, expect, it, vi } from 'vitest';

import { startDaemonControlServer } from './controlServer';
import type { SpawnSessionFromSessionRpcOptions } from '@/api/apiMachine';

vi.mock('@/ui/logger', () => ({
  logger: {
    debug: vi.fn(),
  },
}));

const servers: Array<{ stop: () => Promise<void>; port: number }> = [];

async function startServer(spawnSessionFromSession = vi.fn()) {
  const server = await startDaemonControlServer({
    getChildren: () => [],
    stopSession: vi.fn(),
    spawnSession: vi.fn(),
    spawnSessionFromSession,
    requestShutdown: vi.fn(),
    onHappySessionWebhook: vi.fn(),
  });
  servers.push(server);
  return server;
}

async function post(port: number, body: unknown): Promise<Response> {
  return fetch(`http://127.0.0.1:${port}/spawn-session-from-session`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('daemon control server spawn-session-from-session route', () => {
  afterEach(async () => {
    await Promise.all(servers.splice(0).map(server => server.stop()));
    vi.clearAllMocks();
  });

  it('calls the spawn handler with the parsed body', async () => {
    const spawnSessionFromSession = vi.fn().mockResolvedValue({ type: 'success', sessionId: 'child-local-id' });
    const { port } = await startServer(spawnSessionFromSession);
    const payload: SpawnSessionFromSessionRpcOptions = {
      parentSessionId: 'parent-local-id',
      config: {
        agent: 'codex',
        path: 'D:/work/project',
        model: 'gpt-5.4',
        permissionMode: 'safe-yolo',
        effortLevel: 'high',
        initialMessage: 'start here',
      },
    };

    const response = await post(port, payload);

    await expect(response.json()).resolves.toEqual({ type: 'success', sessionId: 'child-local-id' });
    expect(response.status).toBe(200);
    expect(spawnSessionFromSession).toHaveBeenCalledWith(payload);
  });

  it('rejects invalid parentSessionId shapes before calling the handler', async () => {
    const spawnSessionFromSession = vi.fn();
    const { port } = await startServer(spawnSessionFromSession);
    const invalidParentIds = [
      'a'.repeat(129),
      'parent id with spaces',
      'parent;rm-rf',
      'machine-1:parent-local-id',
    ];

    for (const parentSessionId of invalidParentIds) {
      const response = await post(port, { parentSessionId, config: { agent: 'codex' } });
      expect(response.status).toBe(400);
    }

    expect(spawnSessionFromSession).not.toHaveBeenCalled();
  });

  it('maps daemon error results to HTTP error responses', async () => {
    const spawnSessionFromSession = vi.fn().mockResolvedValue({ type: 'error', errorMessage: 'parent not tracked' });
    const { port } = await startServer(spawnSessionFromSession);

    const response = await post(port, { parentSessionId: 'parent-local-id', config: { agent: 'claude' } });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ type: 'error', errorMessage: 'parent not tracked' });
  });
});
