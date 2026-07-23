import { afterEach, describe, expect, it, vi } from 'vitest';

import type { TrackedSession } from './types';
import { startDaemonControlServer } from './controlServer';
import {
  DaemonReplacementCoordinator,
  type DaemonReplacementIdentity,
} from './replacementCoordinator';

vi.mock('@/ui/logger', () => ({
  logger: {
    debug: vi.fn(),
  },
}));

const servers: Array<{ stop: () => Promise<void>; port: number }> = [];
const identity: DaemonReplacementIdentity = {
  pid: 123,
  startedWithCliVersion: '1.2.3',
  startedWithPayloadArtifactId: 'happy-a',
  startedWithPayloadManifestSha256: 'A'.repeat(64),
};

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

  it('reserves replacement in the old daemon and rejects a racing registration', async () => {
      const requestShutdown = vi.fn();
      const onHappySessionWebhook = vi.fn();
      const server = await startDaemonControlServer({
        getChildren: () => [],
        stopSession: vi.fn(),
        spawnSession: vi.fn(),
        requestShutdown,
        onHappySessionWebhook,
        replacement: {
          coordinator: new DaemonReplacementCoordinator(),
          identity,
        },
      });
      servers.push(server);

      const reservation = await fetch(`http://127.0.0.1:${server.port}/prepare-replacement`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(identity),
      });
      expect(reservation.status).toBe(200);
      await expect(reservation.json()).resolves.toEqual({ reserved: true });

      const registration = await fetch(`http://127.0.0.1:${server.port}/session-started`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: 'late-session', metadata: { hostPid: 456 } }),
      });
      expect(registration.status).toBe(409);
      await expect(registration.json()).resolves.toEqual({ error: 'daemon_draining' });
      expect(onHappySessionWebhook).not.toHaveBeenCalled();
      await vi.waitFor(() => expect(requestShutdown).toHaveBeenCalledOnce());
  });

  it('refuses the reservation while the old daemon owns children', async () => {
    const requestShutdown = vi.fn();
    const server = await startDaemonControlServer({
      getChildren: () => [{ startedBy: 'daemon', pid: 456 }] as TrackedSession[],
      stopSession: vi.fn(),
      spawnSession: vi.fn(),
      requestShutdown,
      onHappySessionWebhook: vi.fn(),
      replacement: {
        coordinator: new DaemonReplacementCoordinator(),
        identity,
      },
    });
    servers.push(server);

    const response = await fetch(`http://127.0.0.1:${server.port}/prepare-replacement`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(identity),
    });

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      reserved: false,
      reason: 'active-children',
    });
    expect(requestShutdown).not.toHaveBeenCalled();
  });
});
