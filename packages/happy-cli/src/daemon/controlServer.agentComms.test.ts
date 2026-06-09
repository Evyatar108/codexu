import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AgentCommsEnvelope } from '@slopus/happy-wire';
import type { TrackedSession } from './types';
import { startDaemonControlServer } from './controlServer';

vi.mock('@/ui/logger', () => ({
  logger: {
    debug: vi.fn(),
  },
}));

const servers: Array<{ stop: () => Promise<void>; port: number }> = [];

const trackedSessions = [{
  startedBy: 'test',
  happySessionId: 'sender',
  pid: process.pid,
}] as unknown as TrackedSession[];

async function startServer(deliverRemote?: (envelope: AgentCommsEnvelope) => Promise<{ id: string; seq: number }>) {
  const server = await startDaemonControlServer({
    getChildren: () => trackedSessions,
    stopSession: vi.fn(),
    spawnSession: vi.fn(),
    requestShutdown: vi.fn(),
    onHappySessionWebhook: vi.fn(),
    localMachineId: 'machine-a',
    agentCommsRemote: deliverRemote ? { deliverRemote } : undefined,
  });
  servers.push(server);
  return server;
}

async function post(port: number, body: unknown): Promise<Response> {
  return fetch(`http://127.0.0.1:${port}/agent-comms/send`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('daemon control server agent-comms route', () => {
  afterEach(async () => {
    await Promise.all(servers.splice(0).map(server => server.stop()));
    vi.clearAllMocks();
  });

  it('accepts widened channel/kind fields and dispatches Scope A to the injected remote transport', async () => {
    const deliverRemote = vi.fn(async (envelope: AgentCommsEnvelope) => ({ id: envelope.id, seq: 9 }));
    const { port } = await startServer(deliverRemote);

    const response = await post(port, {
      target: { machineId: 'machine-b', sessionId: 'target' },
      body: { agent: 'codex' },
      channel: 'spawn',
      kind: 'spawn-request',
      correlationId: 'corr-1',
      sender: { sessionId: 'sender' },
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ seq: 9 });
    expect(deliverRemote).toHaveBeenCalledTimes(1);
    expect(deliverRemote.mock.calls[0]![0]).toMatchObject({
      from: { machineId: 'machine-a', sessionId: 'sender' },
      to: { machineId: 'machine-b', sessionId: 'target' },
      scope: 'A',
      channel: 'spawn',
      kind: 'spawn-request',
      correlationId: 'corr-1',
      body: { agent: 'codex' },
    });
  });

  it('fails closed for Scope A when no remote transport is configured', async () => {
    const { port } = await startServer();

    const response = await post(port, {
      target: { machineId: 'machine-b', sessionId: 'target' },
      body: { msg: 'hello' },
      sender: { sessionId: 'sender' },
    });

    expect(response.status).toBe(501);
    await expect(response.json()).resolves.toEqual({ error: 'Scope A delivery requires the Dev Tunnels peer transport.' });
  });
});
