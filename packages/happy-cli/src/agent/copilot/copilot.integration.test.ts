/**
 * Real managed-server compatibility smoke. It is explicitly opt-in because it
 * starts the installed Copilot runtime and requires the pinned build.
 */

import { EventEmitter } from 'node:events';
import net, { type Socket } from 'node:net';
import type { ChildProcess } from 'node:child_process';
import { describe, expect, it, vi } from 'vitest';

import { spawnManagedTarget } from './managedServer';
import { CopilotEventRelay } from './eventRelay';
import { NativeLocalRpcClient } from './nativeLocalRpcClient';
import { COPILOT_NATIVE_VERSION, type EventLogPage, type NativeEvent, type NativeNotificationHandler } from './types';

function frame(value: unknown): Buffer {
  const body = Buffer.from(JSON.stringify(value), 'utf8');
  return Buffer.concat([Buffer.from(`Content-Length: ${body.byteLength}\r\n\r\n`, 'ascii'), body]);
}

function serveRpc(socket: Socket): void {
  let input = Buffer.alloc(0);
  socket.on('data', (chunk) => {
    input = Buffer.concat([input, chunk]);
    while (true) {
      const headerEnd = input.indexOf('\r\n\r\n');
      if (headerEnd < 0) return;
      const match = /Content-Length: ([0-9]+)/i.exec(input.subarray(0, headerEnd).toString('ascii'));
      if (!match) return;
      const length = Number(match[1]);
      if (input.byteLength < headerEnd + 4 + length) return;
      const request = JSON.parse(input.subarray(headerEnd + 4, headerEnd + 4 + length).toString('utf8')) as {
        id: number;
        method: string;
      };
      input = input.subarray(headerEnd + 4 + length);
      const result = request.method === 'connect'
        ? { protocolVersion: 3, version: COPILOT_NATIVE_VERSION }
        : request.method === 'session.getForeground'
          ? { sessionId: 'integration-session' }
          : request.method === 'session.eventLog.read'
            ? { events: [], cursor: 'frontier', cursorStatus: 'ok', hasMore: false }
            : {};
      socket.write(frame({ jsonrpc: '2.0', id: request.id, result }));
    }
  });
}

describe('Copilot fake managed-server integration', () => {
  it('validates registry, handshakes, resumes, reads, and shuts down through the real framed client', async () => {
    const server = net.createServer(serveRpc);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Missing integration server address');
    const child = Object.assign(new EventEmitter(), {
      pid: 9191,
      exitCode: null,
      killed: false,
      kill: vi.fn(),
    }) as unknown as ChildProcess;
    const target = await spawnManagedTarget({ startupTimeoutMs: 100 }, {
      spawnProcess: vi.fn(() => child) as never,
      resolveExecutable: () => 'copilot-fixture',
      randomToken: () => 'integration-token',
      fileExists: (path) => path.endsWith('9191.json'),
      readFile: () => JSON.stringify({
        schemaVersion: 2,
        kind: 'managed-server',
        pid: 9191,
        host: '127.0.0.1',
        port: address.port,
        token: 'integration-token',
        sessionId: 'integration-session',
        copilotVersion: COPILOT_NATIVE_VERSION,
      }),
      sleep: async () => undefined,
    });
    const client = new NativeLocalRpcClient(target.registry.host, target.registry.port);
    try {
      await client.connect(target.registry.token, target.registry.sessionId);
      client.onSessionEvent(() => undefined);
      await client.resume();
      await expect(client.readEventLog({ waitMs: 0 })).resolves.toMatchObject({
        cursor: 'frontier',
        cursorStatus: 'ok',
      });
      await client.shutdown();
    } finally {
      client.close();
      server.close();
    }
  });

  it('relays more than 200 ordered rows and replay-deduplicates deterministic local ids', async () => {
    const events: NativeEvent[] = Array.from({ length: 205 }, (_, index) => ({
      id: `event-${index}`,
      type: 'user.message',
      timestamp: '2026-07-19T00:00:00.000Z',
      data: { content: `message-${index}` },
    }));
    class FakeNative {
      handler: NativeNotificationHandler | null = null;
      pages: EventLogPage[] = [];
      onSessionEvent(handler: NativeNotificationHandler): () => void {
        this.handler = handler;
        return () => { this.handler = null; };
      }
      async resume(): Promise<void> {}
      async readEventLog(): Promise<EventLogPage> {
        const page = this.pages.shift();
        if (!page) throw new Error('Unexpected integration read');
        return page;
      }
    }
    const native = new FakeNative();
    const refill = (): void => {
      native.pages = [
        { events: events.slice(0, 100), cursor: 'c1', cursorStatus: 'ok', hasMore: true },
        { events: events.slice(100, 200), cursor: 'c2', cursorStatus: 'ok', hasMore: true },
        { events: events.slice(200), cursor: 'c3', cursorStatus: 'ok', hasMore: false },
        { events: [], cursor: 'c4', cursorStatus: 'ok', hasMore: false },
        { events: [], cursor: 'c5', cursorStatus: 'ok', hasMore: false },
      ];
    };
    const rows = new Map<string, string>();
    const happy = {
      sessionId: 'happy-integration',
      sendSessionProtocolMessageWithDelivery: vi.fn(async (envelope, options) => {
        const text = (envelope.ev as { text: string }).text;
        if (!rows.has(options.localId)) rows.set(options.localId, text);
        return { id: options.localId, seq: rows.size };
      }),
    };

    refill();
    await new CopilotEventRelay(native as never, happy as never, process.cwd()).bootstrapFromStart();
    expect([...rows.values()]).toEqual(events.map((event) => (event.data!.content as string)));
    expect(rows.size).toBe(205);

    refill();
    await new CopilotEventRelay(native as never, happy as never, process.cwd()).bootstrapFromStart();
    expect(rows.size).toBe(205);
    expect(new Set(rows.keys()).size).toBe(205);
  });
});

describe.skipIf(process.env.RUN_COPILOT_NATIVE_SMOKE !== '1')('Copilot managed-server smoke', () => {
  it('spawns, validates, handshakes, establishes history buffering, and shuts down', async () => {
    const target = await spawnManagedTarget({ startupTimeoutMs: 60_000 });
    const client = new NativeLocalRpcClient(target.registry.host, target.registry.port, 30_000);
    try {
      expect(target.registry.copilotVersion).toBe(COPILOT_NATIVE_VERSION);
      expect(target.registry.pid).toBe(target.child.pid);
      await client.connect(target.registry.token, target.registry.sessionId);
      client.onSessionEvent(() => undefined);
      await client.resume();
      const page = await client.readEventLog({ waitMs: 0 });
      expect(page.cursorStatus).toBe('ok');
      await client.shutdown();
    } finally {
      client.close();
      await target.terminate();
    }
  });
});
