import net, { type Server, type Socket } from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { NativeLocalRpcClient } from './nativeLocalRpcClient';
import { COPILOT_NATIVE_VERSION } from './types';

function frame(value: unknown): Buffer {
  const body = Buffer.from(JSON.stringify(value), 'utf8');
  return Buffer.concat([Buffer.from(`Content-Length: ${body.byteLength}\r\n\r\n`, 'ascii'), body]);
}

function parseFrames(socket: Socket, onMessage: (message: Record<string, unknown>) => void): void {
  let input = Buffer.alloc(0);
  socket.on('data', (chunk) => {
    input = Buffer.concat([input, chunk]);
    while (true) {
      const headerEnd = input.indexOf('\r\n\r\n');
      if (headerEnd < 0) return;
      const match = /^Content-Length: ([0-9]+)$/mi.exec(input.subarray(0, headerEnd).toString('ascii'));
      if (!match) return;
      const length = Number(match[1]);
      if (input.byteLength < headerEnd + 4 + length) return;
      const body = input.subarray(headerEnd + 4, headerEnd + 4 + length);
      input = input.subarray(headerEnd + 4 + length);
      onMessage(JSON.parse(body.toString('utf8')) as Record<string, unknown>);
    }
  });
}

describe('NativeLocalRpcClient', () => {
  let server: Server | undefined;
  let client: NativeLocalRpcClient | undefined;
  afterEach(async () => {
    client?.close();
    if (server) await new Promise<void>((resolve) => server!.close(() => resolve()));
  });

  it('frames requests, validates handshake, injects the verified session id, and receives notifications', async () => {
    const requests: Array<Record<string, unknown>> = [];
    let connectedSocket: Socket | undefined;
    server = net.createServer((socket) => {
      connectedSocket = socket;
      parseFrames(socket, (message) => {
        requests.push(message);
        const params = message.params as Record<string, unknown>;
        let result: unknown = {};
        if (message.method === 'connect') result = { protocolVersion: 3, version: COPILOT_NATIVE_VERSION };
        if (message.method === 'session.getForeground') result = { sessionId: 'session-1' };
        if (message.method === 'session.eventLog.read') {
          result = { events: [], cursor: 'cursor-1', cursorStatus: 'ok', hasMore: false };
        }
        if (message.method === 'happy.getControlState') result = { outcome: 'no_lease' };
        socket.write(frame({ jsonrpc: '2.0', id: message.id, result }));
        expect(params).not.toHaveProperty('rawMethod');
      });
    });
    await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Missing server address');

    client = new NativeLocalRpcClient('127.0.0.1', address.port);
    await client.connect('secret-token', 'session-1');
    const received = new Promise<string>((resolve) => client!.onSessionEvent((event) => resolve(event.id)));
    connectedSocket!.write(frame({
      jsonrpc: '2.0',
      method: 'session.event',
      params: {
        sessionId: 'session-1',
        event: { id: 'event-1', type: 'session.start', timestamp: '2026-07-19T00:00:00Z' },
      },
    }));
    await client.resume();
    await client.readEventLog({ waitMs: 0 });
    await client.invokeSteering('happy.getControlState');

    await expect(received).resolves.toBe('event-1');
    expect((requests[0].params as Record<string, unknown>).token).toBe('secret-token');
    expect(requests.filter((request) => request.method === 'session.resume')[0].params).toMatchObject({
      sessionId: 'session-1',
      disableResume: true,
      requestPermission: false,
    });
    expect(requests.filter((request) => request.method === 'session.resume')[0].params).not.toHaveProperty(
      'observePromptEvents',
    );
    expect(requests.filter((request) => request.method === 'session.eventLog.read')[0].params).toMatchObject({
      sessionId: 'session-1',
      agentScope: 'primary',
      types: [
        'session.start',
        'user.message',
        'assistant.turn_start',
        'assistant.message',
        'tool.execution_start',
        'tool.execution_complete',
        'assistant.turn_end',
        'abort',
        'session.error',
        'session.shutdown',
        'permission.requested',
        'permission.completed',
        'user_input.requested',
        'user_input.completed',
        'elicitation.requested',
        'elicitation.completed',
        'exit_plan_mode.requested',
        'exit_plan_mode.completed',
      ],
    });
    expect(requests.filter((request) => request.method === 'session.eventLog.read')[0].params).not.toHaveProperty('eventTypes');
    expect(requests.filter((request) => request.method === 'happy.getControlState')[0].params).toEqual({
      sessionId: 'session-1',
    });
  });

  it('forwards steering notifications only for the verified foreground session', async () => {
    let socket: Socket | undefined;
    server = net.createServer((connected) => {
      socket = connected;
      parseFrames(connected, (message) => {
        connected.write(frame({
          jsonrpc: '2.0',
          id: message.id,
          result: message.method === 'connect'
            ? { protocolVersion: 3, version: COPILOT_NATIVE_VERSION }
            : { sessionId: 'session-1' },
        }));
      });
    });
    await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Missing server address');
    client = new NativeLocalRpcClient('127.0.0.1', address.port);
    await client.connect('token', 'session-1');
    const notifications: string[] = [];
    client.onSteeringNotification((notification) => notifications.push(notification.method));

    socket!.write(frame({
      jsonrpc: '2.0',
      method: 'happy.leaseGranted',
      params: { sessionId: 'other-session', leaseId: 'wrong', expiresAt: 1 },
    }));
    socket!.write(frame({
      jsonrpc: '2.0',
      method: 'happy.leaseRevoked',
      params: { sessionId: 'session-1', reason: 'keystroke' },
    }));

    await vi.waitFor(() => expect(notifications).toEqual(['happy.leaseRevoked']));
  });

  it('fails closed on version mismatch', async () => {
    server = net.createServer((socket) => {
      parseFrames(socket, (message) => {
        socket.write(frame({
          jsonrpc: '2.0',
          id: message.id,
          result: message.method === 'connect'
            ? { protocolVersion: 3, version: '0.0.1' }
            : { sessionId: 'session-1' },
        }));
      });
    });
    await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Missing server address');
    client = new NativeLocalRpcClient('127.0.0.1', address.port);

    await expect(client.connect('token', 'session-1')).rejects.toThrow('package version');
  });

  it('omits non-primary notifications and fails malformed messages through the connection', async () => {
    let socket: Socket | undefined;
    server = net.createServer((connected) => {
      socket = connected;
      parseFrames(connected, (message) => {
        connected.write(frame({
          jsonrpc: '2.0',
          id: message.id,
          result: message.method === 'connect'
            ? { protocolVersion: 3, version: COPILOT_NATIVE_VERSION }
            : { sessionId: 'session-1' },
        }));
      });
    });
    await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Missing server address');
    client = new NativeLocalRpcClient('127.0.0.1', address.port);
    await client.connect('token', 'session-1');
    let received = 0;
    client.onSessionEvent(() => { received++; });

    socket!.write(frame({
      jsonrpc: '2.0',
      method: 'session.event',
      params: {
        sessionId: 'session-1',
        event: {
          id: 'subagent',
          type: 'assistant.message',
          timestamp: '2026-07-19T00:00:00Z',
          agentId: 'child-1',
          data: { content: 'private child output' },
        },
      },
    }));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(received).toBe(0);

    socket!.write(frame([]));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(socket!.destroyed).toBe(true);
  });
});
