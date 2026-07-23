import { afterEach, describe, expect, it, vi } from 'vitest';

import type { TrackedSession } from './types';
import { startDaemonControlServer } from './controlServer';

vi.mock('@/ui/logger', () => ({
  logger: {
    debug: vi.fn(),
  },
}));

const servers: Array<{ stop: () => Promise<void>; port: number }> = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.stop()));
});

describe('daemon control server list route', () => {
  it('counts startup-stage children that do not have a Happy session id yet', async () => {
    const children = [
      { startedBy: 'terminal', pid: 101 },
      { startedBy: 'daemon', pid: 102, happySessionId: 'happy-1' },
    ] as TrackedSession[];
    const server = await startDaemonControlServer({
      getChildren: () => children,
      stopSession: vi.fn(),
      spawnSession: vi.fn(),
      requestShutdown: vi.fn(),
      onHappySessionWebhook: vi.fn(),
    });
    servers.push(server);

    const response = await fetch(`http://127.0.0.1:${server.port}/list`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      trackedCount: 2,
      children: [{
        startedBy: 'daemon',
        happySessionId: 'happy-1',
        pid: 102,
      }],
    });
  });
});
