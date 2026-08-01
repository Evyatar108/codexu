/**
 * Version-gated Content-Length JSON-RPC client for an owned Copilot target.
 */

import net, { type Socket } from 'node:net';
import { EventEmitter } from 'node:events';
import {
  steeringResultSchema,
  type SteeringResult,
  type SteeringRpcMethod,
} from '@slopus/happy-wire';

import {
  COPILOT_LIVE_PROMPT_EVENT_TYPES,
  COPILOT_NATIVE_VERSION,
  COPILOT_PROJECTED_EVENT_TYPES,
  COPILOT_PROTOCOL_VERSION,
  type EventLogPage,
  type NativeEvent,
  type NativeNotificationHandler,
} from './types';

const MAX_HEADER_BYTES = 8 * 1024;
const MAX_BODY_BYTES = 4 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 15_000;

export type SteeringNotification =
  | { method: 'happy.leaseGranted'; params: Record<string, unknown> }
  | { method: 'happy.leaseRevoked'; params: Record<string, unknown> };

export type SteeringNotificationHandler = (notification: SteeringNotification) => void;

export class NativeTransportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NativeTransportError';
  }
}

type JsonRpcResponse = {
  jsonrpc: '2.0';
  id: number;
  result?: unknown;
  error?: { code: number; message: string };
};

type PendingRequest = {
  method: string;
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
};

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('Copilot returned an invalid object');
  }
  return value as Record<string, unknown>;
}

function nonEmptyString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`Copilot returned invalid ${field}`);
  }
  return value;
}

function parseEvent(value: unknown): NativeEvent {
  const obj = record(value);
  return {
    ...obj,
    id: nonEmptyString(obj.id, 'event id'),
    type: nonEmptyString(obj.type, 'event type'),
    timestamp: nonEmptyString(obj.timestamp, 'event timestamp'),
  } as NativeEvent;
}

function allowedEvent(value: unknown): NativeEvent | null {
  const event = parseEvent(value);
  if (!(COPILOT_PROJECTED_EVENT_TYPES as readonly string[]).includes(event.type)) return null;
  if (event.ephemeral === true
    && !(COPILOT_LIVE_PROMPT_EVENT_TYPES as readonly string[]).includes(event.type)) return null;
  const eventData = typeof event.data === 'object' && event.data !== null && !Array.isArray(event.data)
    ? event.data
    : {};
  if (event.agentId !== undefined || eventData.agentId !== undefined) return null;
  return event;
}

export class NativeLocalRpcClient extends EventEmitter {
  private socket: Socket | null = null;
  private input = Buffer.alloc(0);
  private expectedBodyBytes: number | null = null;
  private nextId = 1;
  private foregroundSessionId: string | null = null;
  private connectionToken: string | null = null;
  private expectedSessionId: string | null = null;
  private expectedVersion = COPILOT_NATIVE_VERSION;
  private readonly pending = new Map<number, PendingRequest>();
  private notificationHandler: NativeNotificationHandler | null = null;
  private steeringNotificationHandler: SteeringNotificationHandler | null = null;

  constructor(
    private readonly host: string,
    private readonly port: number,
    private readonly requestTimeoutMs = DEFAULT_TIMEOUT_MS,
  ) {
    super();
  }

  async connect(connectionToken: string, expectedSessionId: string, expectedVersion = COPILOT_NATIVE_VERSION): Promise<void> {
    if (this.socket !== null) throw new Error('Copilot client is already connected');
    this.connectionToken = connectionToken;
    this.expectedSessionId = expectedSessionId;
    this.expectedVersion = expectedVersion;
    await this.openAndHandshake(connectionToken, expectedSessionId, expectedVersion);
  }

  async reconnect(): Promise<void> {
    if (!this.connectionToken || !this.expectedSessionId) throw new Error('Copilot reconnect has no verified target');
    this.closeSocketOnly();
    await this.openAndHandshake(this.connectionToken, this.expectedSessionId, this.expectedVersion);
  }

  private async openAndHandshake(connectionToken: string, expectedSessionId: string, expectedVersion: string): Promise<void> {
    this.socket = await new Promise<Socket>((resolve, reject) => {
      const socket = net.createConnection({ host: this.host, port: this.port });
      const onError = (error: Error): void => {
        socket.destroy();
        reject(error);
      };
      socket.once('error', onError);
      socket.once('connect', () => {
        socket.off('error', onError);
        resolve(socket);
      });
    });
    const socket = this.socket;
    socket.on('data', (chunk) => {
      if (this.socket === socket) this.onData(chunk);
    });
    socket.on('error', () => {
      if (this.socket === socket) {
        this.failPending(new NativeTransportError('Copilot connection failed'));
        this.emit('transport-disconnected');
      }
    });
    socket.on('close', () => {
      if (this.socket === socket) {
        this.failPending(new NativeTransportError('Copilot connection closed'));
        this.emit('transport-disconnected');
      }
    });

    try {
      const connected = record(await this.request('connect', {
        token: connectionToken,
        protocolVersion: COPILOT_PROTOCOL_VERSION,
        client: { name: 'happy-cli', version: 'm1a' },
        capabilities: {},
      }));
      if (connected.protocolVersion !== COPILOT_PROTOCOL_VERSION) {
        throw new Error('Unsupported Copilot protocol version');
      }
      if (connected.version !== expectedVersion) {
        throw new Error('Unsupported Copilot package version');
      }

      const foreground = record(await this.request('session.getForeground', {}));
      const sessionId = nonEmptyString(foreground.sessionId, 'foreground session id');
      if (sessionId !== expectedSessionId) {
        throw new Error('Copilot foreground session does not match registry');
      }
      this.foregroundSessionId = sessionId;
    } catch (error) {
      this.closeSocketOnly();
      throw error;
    }
  }

  onSessionEvent(handler: NativeNotificationHandler): () => void {
    this.notificationHandler = handler;
    return () => {
      if (this.notificationHandler === handler) this.notificationHandler = null;
    };
  }

  onSteeringNotification(handler: SteeringNotificationHandler): () => void {
    this.steeringNotificationHandler = handler;
    return () => {
      if (this.steeringNotificationHandler === handler) this.steeringNotificationHandler = null;
    };
  }

  onTransportDisconnected(handler: () => void): () => void {
    this.on('transport-disconnected', handler);
    return () => this.off('transport-disconnected', handler);
  }

  async resume(): Promise<void> {
    await this.sessionRequest('session.resume', {
      disableResume: true,
      requestPermission: false,
    });
  }

  async readEventLog(options: { cursor?: string; waitMs?: number }): Promise<EventLogPage> {
    const result = record(await this.sessionRequest('session.eventLog.read', {
      ...(options.cursor ? { cursor: options.cursor } : {}),
      ...(options.waitMs !== undefined ? { waitMs: options.waitMs } : {}),
      agentScope: 'primary',
      types: [...COPILOT_PROJECTED_EVENT_TYPES],
    }, options.waitMs === undefined ? undefined : options.waitMs + 5_000));
    if (!Array.isArray(result.events) || typeof result.cursor !== 'string'
      || typeof result.hasMore !== 'boolean'
      || (result.cursorStatus !== 'ok' && result.cursorStatus !== 'expired')) {
      throw new Error('Copilot returned an invalid event-log page');
    }
    return {
      events: result.events.map(allowedEvent).filter((event): event is NativeEvent => event !== null),
      cursor: result.cursor,
      hasMore: result.hasMore,
      cursorStatus: result.cursorStatus,
    };
  }

  async shutdown(): Promise<void> {
    await this.request('runtime.shutdown', {});
  }

  async invokeSteering(
    method: SteeringRpcMethod,
    params: Record<string, unknown> = {},
    timeoutMs?: number,
  ): Promise<SteeringResult> {
    return steeringResultSchema.parse(await this.sessionRequest(method, params, timeoutMs));
  }

  close(): void {
    this.connectionToken = null;
    this.expectedSessionId = null;
    this.closeSocketOnly();
  }

  private closeSocketOnly(): void {
    const socket = this.socket;
    this.socket = null;
    this.foregroundSessionId = null;
    this.input = Buffer.alloc(0);
    this.expectedBodyBytes = null;
    socket?.destroy();
    this.failPending(new Error('Copilot client closed'));
  }

  private sessionRequest(
    method: 'session.resume' | 'session.eventLog.read' | SteeringRpcMethod,
    params: Record<string, unknown>,
    timeoutMs?: number,
  ): Promise<unknown> {
    if (this.foregroundSessionId === null) throw new Error('Copilot foreground session is not verified');
    if ('sessionId' in params) throw new Error('Caller cannot override Copilot session id');
    return this.request(method, { ...params, sessionId: this.foregroundSessionId }, timeoutMs);
  }

  private request(
    method: 'connect' | 'session.getForeground' | 'session.resume' | 'session.eventLog.read'
      | 'runtime.shutdown' | SteeringRpcMethod,
    params: Record<string, unknown>,
    timeoutMs = this.requestTimeoutMs,
  ): Promise<unknown> {
    if (this.socket === null) return Promise.reject(new Error('Copilot client is not connected'));
    const id = this.nextId++;
    const body = Buffer.from(JSON.stringify({ jsonrpc: '2.0', id, method, params }), 'utf8');
    const frame = Buffer.concat([Buffer.from(`Content-Length: ${body.byteLength}\r\n\r\n`, 'ascii'), body]);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new NativeTransportError(`Copilot request timed out: ${method}`));
      }, timeoutMs);
      timer.unref?.();
      this.pending.set(id, { method, resolve, reject, timer });
      this.socket!.write(frame);
    });
  }

  private onData(chunk: Buffer): void {
    this.input = Buffer.concat([this.input, chunk]);
    while (true) {
      if (this.expectedBodyBytes === null) {
        const headerEnd = this.input.indexOf('\r\n\r\n');
        if (headerEnd < 0) {
          if (this.input.byteLength > MAX_HEADER_BYTES) this.protocolFailure('Copilot frame header is too large');
          return;
        }
        if (headerEnd > MAX_HEADER_BYTES) return this.protocolFailure('Copilot frame header is too large');
        const header = this.input.subarray(0, headerEnd).toString('ascii');
        const matches = /^Content-Length: ([0-9]+)$/gmi;
        const lengths = [...header.matchAll(matches)];
        if (lengths.length !== 1) return this.protocolFailure('Copilot frame has invalid Content-Length');
        const length = Number(lengths[0][1]);
        if (!Number.isSafeInteger(length) || length < 2 || length > MAX_BODY_BYTES) {
          return this.protocolFailure('Copilot frame body size is invalid');
        }
        this.expectedBodyBytes = length;
        this.input = this.input.subarray(headerEnd + 4);
      }
      if (this.input.byteLength < this.expectedBodyBytes) return;
      const body = this.input.subarray(0, this.expectedBodyBytes);
      this.input = this.input.subarray(this.expectedBodyBytes);
      this.expectedBodyBytes = null;
      let message: unknown;
      try {
        message = JSON.parse(body.toString('utf8'));
      } catch {
        return this.protocolFailure('Copilot frame contains invalid JSON');
      }
      try {
        this.handleMessage(message);
      } catch (error) {
        return this.protocolFailure(error instanceof Error ? error.message : 'Copilot message validation failed');
      }
    }
  }

  private handleMessage(value: unknown): void {
    const message = record(value);
    if (message.jsonrpc !== '2.0') return this.protocolFailure('Copilot sent an invalid JSON-RPC message');
    if (typeof message.id === 'number') {
      if (typeof message.method === 'string') {
        this.sendMethodNotFound(message.id);
        return;
      }
      const pending = this.pending.get(message.id);
      if (!pending) return this.protocolFailure('Copilot sent an unknown response id');
      this.pending.delete(message.id);
      clearTimeout(pending.timer);
      const response = message as JsonRpcResponse;
      if (response.error) pending.reject(new Error(`Copilot RPC failed (${pending.method}, code ${response.error.code})`));
      else pending.resolve(response.result);
      return;
    }
    if (message.method === 'session.event') {
      const params = record(message.params);
      const sessionId = nonEmptyString(params.sessionId, 'notification session id');
      if (sessionId !== this.foregroundSessionId) return;
      const event = allowedEvent(params.event);
      if (event) this.notificationHandler?.(event);
      return;
    }
    if (message.method === 'happy.leaseGranted' || message.method === 'happy.leaseRevoked') {
      const params = record(message.params);
      if (typeof params.sessionId === 'string' && params.sessionId !== this.foregroundSessionId) return;
      this.steeringNotificationHandler?.({ method: message.method, params });
    }
  }

  private sendMethodNotFound(id: number): void {
    if (this.socket === null) return;
    const body = Buffer.from(JSON.stringify({
      jsonrpc: '2.0',
      id,
      error: { code: -32601, message: 'Method not found' },
    }), 'utf8');
    this.socket.write(Buffer.concat([Buffer.from(`Content-Length: ${body.byteLength}\r\n\r\n`, 'ascii'), body]));
  }

  private protocolFailure(message: string): void {
    const error = new Error(message);
    this.failPending(error);
    this.socket?.destroy(error);
  }

  private failPending(error: Error): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
  }
}
