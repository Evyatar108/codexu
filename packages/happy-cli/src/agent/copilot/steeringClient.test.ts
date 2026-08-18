import { afterEach, describe, expect, it, vi } from 'vitest';

import type {
  SteeringResult,
  SteeringRpcMethod,
} from '@slopus/happy-wire';

import {
  COPILOT_HEARTBEAT_INTERVAL_MS,
  COPILOT_LEASE_TTL_MS,
  CopilotPhoneSteeringBroker,
  CopilotSteeringClient,
} from './steeringClient';
import {
  NativeTransportError,
  type SteeringNotification,
  type SteeringNotificationHandler,
} from './nativeLocalRpcClient';

const actionId = '123e4567-e89b-42d3-a456-426614174000';

function harness(results: Array<SteeringResult | Error> = []) {
  let notificationHandler: SteeringNotificationHandler | null = null;
  let disconnectHandler: (() => void) | null = null;
  const calls: Array<{ method: SteeringRpcMethod; params: Record<string, unknown>; timeoutMs?: number }> = [];
  const transport = {
    invokeSteering: vi.fn(async (
      method: SteeringRpcMethod,
      params: Record<string, unknown> = {},
      timeoutMs?: number,
    ) => {
      calls.push({ method, params, ...(timeoutMs === undefined ? {} : { timeoutMs }) });
      const result = results.shift();
      if (!result) throw new Error(`Missing result for ${method}`);
      if (result instanceof Error) throw result;
      return result;
    }),
    onSteeringNotification: vi.fn((handler: SteeringNotificationHandler) => {
      notificationHandler = handler;
      return () => { notificationHandler = null; };
    }),
    onTransportDisconnected: vi.fn((handler: () => void) => {
      disconnectHandler = handler;
      return () => { disconnectHandler = null; };
    }),
  };
  return {
    calls,
    transport,
    notify(notification: SteeringNotification) {
      notificationHandler?.(notification);
    },
    disconnect() {
      disconnectHandler?.();
    },
  };
}

describe('CopilotSteeringClient', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('accepts a matching-requestId grant and renews from heartbeat values', async () => {
    const fake = harness([
      { outcome: 'applied' },
      { outcome: 'no_lease' },
      { outcome: 'pending', requestId: 'lease-request-1' },
      {
        outcome: 'applied',
        leaseId: 'lease-1',
        expiresAt: Date.now() + 45_000,
        heartbeatIntervalMs: 12_000,
        leaseTtlMs: 36_000,
      },
    ]);
    const client = new CopilotSteeringClient(fake.transport as never);

    await client.start();
    await expect(client.requestLease()).resolves.toMatchObject({ outcome: 'pending' });
    expect(fake.calls[2]).toMatchObject({
      method: 'happy.requestLease',
      params: {
        scope: ['answer-prompts'],
      },
    });
    expect(fake.calls[2]?.params.actionId).toEqual(expect.any(String));
    expect(client.getState()).toEqual({ status: 'requested', requestId: 'lease-request-1' });

    fake.notify({
      method: 'happy.controlChanged',
      params: {
        sessionId: 'native-session',
        reason: 'granted',
        requestId: 'lease-request-1',
        leaseId: 'lease-1',
        expiresAt: Date.now() + 45_000,
        heartbeatIntervalMs: 12_000,
        leaseTtlMs: 36_000,
      },
    });
    expect(client.getState()).toMatchObject({
      status: 'active',
      leaseId: 'lease-1',
      heartbeatIntervalMs: 12_000,
      leaseTtlMs: 36_000,
    });

    await client.heartbeat();
    expect(fake.calls.at(-1)).toEqual({
      method: 'happy.heartbeat',
      params: { leaseId: 'lease-1' },
    });
    client.dispose();
  });

  it('accepts a v3 attach advertising happyProtocolVersion 3 and the full method surface', async () => {
    const fake = harness([
      {
        outcome: 'applied',
        happyProtocolVersion: '3',
        capabilities: {},
        methods: [
          'happy.attach',
          'happy.requestLease',
          'happy.heartbeat',
          'happy.releaseLease',
          'happy.answerPrompt',
          'happy.getControlState',
        ],
      },
      { outcome: 'no_lease' },
    ]);
    const client = new CopilotSteeringClient(fake.transport as never);

    await expect(client.start()).resolves.toMatchObject({ outcome: 'no_lease' });
    expect(fake.calls[0]).toMatchObject({ method: 'happy.attach' });
    client.dispose();
  });

  it('fails closed on an unsupported happy protocol version or missing method', async () => {
    const versionFake = harness([
      { outcome: 'applied', happyProtocolVersion: '4' },
    ]);
    const versionClient = new CopilotSteeringClient(versionFake.transport as never);
    await expect(versionClient.start()).rejects.toThrow('happy protocol version');
    versionClient.dispose();

    const methodFake = harness([
      {
        outcome: 'applied',
        happyProtocolVersion: '3',
        methods: [
          'happy.attach',
          'happy.requestLease',
          'happy.heartbeat',
          'happy.releaseLease',
          'happy.getControlState',
        ],
      },
    ]);
    const methodClient = new CopilotSteeringClient(methodFake.transport as never);
    await expect(methodClient.start()).rejects.toThrow('missing a required method');
    methodClient.dispose();
  });

  it('discards a delayed grant for an older lease request', async () => {
    const fake = harness([
      { outcome: 'applied' },
      { outcome: 'no_lease' },
      { outcome: 'pending', requestId: 'request-a' },
      { outcome: 'pending', requestId: 'request-b' },
    ]);
    const client = new CopilotSteeringClient(fake.transport as never);
    await client.start();
    await client.requestLease();
    await client.requestLease();
    expect(client.getState()).toEqual({ status: 'requested', requestId: 'request-b' });

    fake.notify({
      method: 'happy.controlChanged',
      params: {
        reason: 'granted',
        requestId: 'request-a',
        leaseId: 'lease-a',
        expiresAt: Date.now() + 45_000,
      },
    });
    expect(client.getState()).toEqual({ status: 'requested', requestId: 'request-b' });

    fake.notify({
      method: 'happy.controlChanged',
      params: {
        reason: 'granted',
        requestId: 'request-b',
        leaseId: 'lease-b',
        expiresAt: Date.now() + 45_000,
      },
    });
    expect(client.getState()).toMatchObject({ status: 'active', leaseId: 'lease-b' });
    client.dispose();
  });

  it('does not transfer a disconnected requester grant to a different phone connection', async () => {
    const fake = harness([
      { outcome: 'applied' },
      { outcome: 'no_lease' },
      { outcome: 'pending', requestId: 'request-a' },
      { outcome: 'pending', requestId: 'request-b' },
    ]);
    const client = new CopilotSteeringClient(fake.transport as never);
    await client.start();
    const broker = new CopilotPhoneSteeringBroker(client);
    await broker.requestLease('phone-a');
    await broker.invalidateConnection('phone-a');
    await broker.requestLease('phone-b');

    fake.notify({
      method: 'happy.controlChanged',
      params: {
        reason: 'granted',
        requestId: 'request-a',
        leaseId: 'lease-a',
        expiresAt: Date.now() + 45_000,
      },
    });
    expect(client.getState()).toEqual({ status: 'requested', requestId: 'request-b' });
    expect(broker.attach('phone-b')).toEqual({ outcome: 'pending', requestId: 'request-b' });

    fake.notify({
      method: 'happy.controlChanged',
      params: {
        reason: 'granted',
        requestId: 'request-b',
        leaseId: 'lease-b',
        expiresAt: Date.now() + 45_000,
      },
    });
    expect(broker.attach('phone-b')).toMatchObject({ outcome: 'applied', leaseId: 'lease-b' });
    expect(broker.attach('phone-a')).toEqual({ outcome: 'no_lease' });
    client.dispose();
  });

  it.each(['keystroke', 'expired', 'released', 'detached'] as const)(
    'treats %s revocation as authoritative without re-requesting',
    async (reason) => {
      const fake = harness([
        { outcome: 'applied' },
        {
          outcome: 'applied',
          leaseId: 'lease-1',
          expiresAt: Date.now() + 45_000,
          heartbeatIntervalMs: COPILOT_HEARTBEAT_INTERVAL_MS,
          leaseTtlMs: COPILOT_LEASE_TTL_MS,
        },
      ]);
      const client = new CopilotSteeringClient(fake.transport as never);
      await client.start();
      const before = fake.calls.length;

      fake.notify({ method: 'happy.controlChanged', params: { reason, leaseId: 'lease-1' } });

      expect(client.getState()).toEqual({ status: 'no-lease', reason });
      expect(fake.calls).toHaveLength(before);
      client.dispose();
    },
  );

  it('invalidates a requested lease on a revocation without requestId', async () => {
    const fake = harness([
      { outcome: 'applied' },
      { outcome: 'no_lease' },
      { outcome: 'pending', requestId: 'request-1' },
    ]);
    const client = new CopilotSteeringClient(fake.transport as never);
    await client.start();
    await client.requestLease();

    fake.notify({
      method: 'happy.controlChanged',
      params: { reason: 'released', leaseId: 'lease-from-native' },
    });

    expect(client.getState()).toEqual({ status: 'no-lease', reason: 'released' });
    client.dispose();
  });

  it('resolves a matching denial without activating a lease', async () => {
    const fake = harness([
      { outcome: 'applied' },
      { outcome: 'no_lease' },
      { outcome: 'pending', requestId: 'request-1' },
    ]);
    const client = new CopilotSteeringClient(fake.transport as never);
    await client.start();
    await client.requestLease();

    fake.notify({
      method: 'happy.controlChanged',
      params: { reason: 'denied', requestId: 'request-1' },
    });

    expect(client.getState()).toEqual({ status: 'no-lease' });
    client.dispose();
  });

  it('fails safe on an unknown control-change reason', async () => {
    const fake = harness([
      { outcome: 'applied' },
      { outcome: 'applied', leaseId: 'lease-1', expiresAt: Date.now() + 45_000 },
    ]);
    const client = new CopilotSteeringClient(fake.transport as never);
    await client.start();

    fake.notify({
      method: 'happy.controlChanged',
      params: { reason: 'future-revocation', leaseId: 'lease-1' },
    });

    expect(client.getState()).toEqual({ status: 'no-lease', reason: 'detached' });
    client.dispose();
  });

  it('expires locally and never auto reacquires after disconnect or reconnect resync', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-01T00:00:00.000Z'));
    const fake = harness([
      { outcome: 'applied' },
      {
        outcome: 'applied',
        leaseId: 'lease-1',
        expiresAt: Date.now() + 1_000,
      },
      { outcome: 'applied' },
      { outcome: 'no_lease' },
    ]);
    const client = new CopilotSteeringClient(fake.transport as never);
    await client.start();

    await vi.advanceTimersByTimeAsync(1_000);
    expect(client.getState()).toEqual({ status: 'no-lease', reason: 'expired' });
    fake.disconnect();
    expect(client.getState()).toEqual({ status: 'no-lease', reason: 'detached' });
    await client.attachAndResync();

    expect(fake.calls.map((call) => call.method)).toEqual([
      'happy.attach',
      'happy.getControlState',
      'happy.attach',
      'happy.getControlState',
    ]);
    expect(fake.calls).not.toContainEqual(expect.objectContaining({ method: 'happy.requestLease' }));
    client.dispose();
  });

  it('reuses actionId while respecting retryAfterMs and exposes optimistic confirmation hooks', async () => {
    let now = 0;
    const fake = harness([
      { outcome: 'applied' },
      {
        outcome: 'applied',
        leaseId: 'lease-1',
        expiresAt: 45_000,
      },
      { actionId, outcome: 'rate_limited', retryAfterMs: 250 },
      { actionId, outcome: 'applied' },
    ]);
    const sleep = vi.fn(async (ms: number) => { now += ms; });
    const client = new CopilotSteeringClient(fake.transport as never, {
      now: () => now,
      sleep,
    });
    const updates: string[] = [];
    client.onActionUpdate((update) => updates.push(`${update.actionId}:${update.status}`));
    await client.start();
    client.observeNativeEvent({
      id: 'prompt-event',
      type: 'permission.requested',
      timestamp: '2026-08-01T00:00:00Z',
      data: {
        requestId: 'prompt-1',
        promptRequest: { kind: 'read', path: 'README.md' },
      },
    });

    await expect(client.answerPrompt({
      actionId,
      sessionId: 'happy-session',
      targetRequestId: 'prompt-1',
      type: 'answer-permission',
      content: { decision: 'approve', scope: 'once' },
    })).resolves.toMatchObject({ actionId, outcome: 'applied' });

    const answerCalls = fake.calls.filter((call) => call.method === 'happy.answerPrompt');
    expect(answerCalls).toHaveLength(2);
    expect(answerCalls[0].params).toEqual(answerCalls[1].params);
    expect(answerCalls[0].params).not.toHaveProperty('sessionId');
    expect(answerCalls[0].params.actionId).toBe(actionId);
    expect(sleep).toHaveBeenCalledWith(250);
    expect(updates).toEqual([`${actionId}:pending`, `${actionId}:confirmed`]);
    client.dispose();
  });

  it('retries an ambiguous transport timeout with the same actionId inside the dedup window', async () => {
    let now = 0;
    const fake = harness([
      { outcome: 'applied' },
      { outcome: 'applied', leaseId: 'lease-1', expiresAt: 45_000 },
      new NativeTransportError('Copilot request timed out: happy.answerPrompt'),
      { actionId, outcome: 'duplicate' },
    ]);
    const client = new CopilotSteeringClient(fake.transport as never, {
      now: () => now,
      sleep: async (ms) => { now += ms; },
    });
    await client.start();
    client.observeNativeEvent({
      id: 'prompt-event',
      type: 'user_input.requested',
      timestamp: '2026-08-01T00:00:00Z',
      data: { requestId: 'prompt-1', question: 'Choose' },
    });

    await expect(client.answerPrompt({
      actionId,
      sessionId: 'happy-session',
      targetRequestId: 'prompt-1',
      type: 'answer-ask-user',
      content: { answer: 'A' },
    })).resolves.toMatchObject({ actionId, outcome: 'duplicate' });

    const answerCalls = fake.calls.filter((call) => call.method === 'happy.answerPrompt');
    expect(answerCalls).toHaveLength(2);
    expect(answerCalls[0].params).toEqual(answerCalls[1].params);
    client.dispose();
  });

  it('discards a stale heartbeat response after an authoritative revoke', async () => {
    let resolveHeartbeat!: (result: SteeringResult) => void;
    const fake = harness([
      { outcome: 'applied' },
      { outcome: 'applied', leaseId: 'lease-1', expiresAt: Date.now() + 45_000 },
    ]);
    fake.transport.invokeSteering.mockImplementation(async (method, params = {}, timeoutMs) => {
      fake.calls.push({ method, params, ...(timeoutMs === undefined ? {} : { timeoutMs }) });
      if (method === 'happy.attach') return { outcome: 'applied' };
      if (method === 'happy.getControlState') {
        return { outcome: 'applied', leaseId: 'lease-1', expiresAt: Date.now() + 45_000 };
      }
      if (method === 'happy.heartbeat') {
        return new Promise<SteeringResult>((resolve) => { resolveHeartbeat = resolve; });
      }
      throw new Error(`Unexpected ${method}`);
    });
    const client = new CopilotSteeringClient(fake.transport as never);
    await client.start();

    const heartbeat = client.heartbeat();
    fake.notify({ method: 'happy.controlChanged', params: { reason: 'keystroke', leaseId: 'lease-1' } });
    resolveHeartbeat({
      outcome: 'applied',
      leaseId: 'lease-1',
      expiresAt: Date.now() + 45_000,
    });

    await expect(heartbeat).resolves.toEqual({ outcome: 'no_lease' });
    expect(client.getState()).toEqual({ status: 'no-lease', reason: 'keystroke' });
    client.dispose();
  });

  it('immediately invalidates an active lease and cancels answer retries on a keystroke revocation', async () => {
    let now = 0;
    let releaseSleep!: () => void;
    const fake = harness([
      { outcome: 'applied' },
      { outcome: 'applied', leaseId: 'lease-1', expiresAt: 45_000 },
      new NativeTransportError('ambiguous timeout'),
    ]);
    const client = new CopilotSteeringClient(fake.transport as never, {
      now: () => now,
      sleep: async (ms) => new Promise<void>((resolve) => {
        now += ms;
        releaseSleep = resolve;
      }),
    });
    await client.start();
    client.observeNativeEvent({
      id: 'prompt-event',
      type: 'user_input.requested',
      timestamp: '2026-08-01T00:00:00Z',
      data: { requestId: 'prompt-1', question: 'Choose' },
    });
    const answer = client.answerPrompt({
      actionId,
      sessionId: 'happy-session',
      targetRequestId: 'prompt-1',
      type: 'answer-ask-user',
      content: { answer: 'A' },
    });
    await vi.waitFor(() => expect(releaseSleep).toBeTypeOf('function'));

    fake.notify({
      method: 'happy.controlChanged',
      params: { reason: 'keystroke', leaseId: 'lease-1' },
    });
    expect(client.getState()).toEqual({ status: 'no-lease', reason: 'keystroke' });
    releaseSleep();

    await expect(answer).resolves.toMatchObject({ actionId, outcome: 'no_lease' });
    expect(fake.calls.filter((call) => call.method === 'happy.answerPrompt')).toHaveLength(1);
    client.dispose();
  });

  it('allows destructive denial while keeping approval fail-closed and requiring a pending target', async () => {
    const denyActionId = '123e4567-e89b-42d3-a456-426614174001';
    const approveReadActionId = '123e4567-e89b-42d3-a456-426614174002';
    const fake = harness([
      { outcome: 'applied' },
      { outcome: 'applied', leaseId: 'lease-1', expiresAt: Date.now() + 45_000 },
      { actionId: denyActionId, outcome: 'applied' },
      { actionId: approveReadActionId, outcome: 'applied' },
    ]);
    const client = new CopilotSteeringClient(fake.transport as never);
    await client.start();
    client.observeNativeEvent({
      id: 'write',
      type: 'permission.requested',
      timestamp: '2026-08-01T00:00:00Z',
      data: { requestId: 'write-1', promptRequest: { kind: 'write' } },
    });
    client.observeNativeEvent({
      id: 'unknown',
      type: 'permission.requested',
      timestamp: '2026-08-01T00:00:00Z',
      data: { requestId: 'unknown-1', promptRequest: { kind: 'future-kind' } },
    });
    client.observeNativeEvent({
      id: 'read',
      type: 'permission.requested',
      timestamp: '2026-08-01T00:00:00Z',
      data: { requestId: 'read-1', promptRequest: { kind: 'read' } },
    });

    const answer = (
      targetRequestId: string,
      decision: 'approve' | 'deny',
      commandActionId = actionId,
    ) => client.answerPrompt({
      actionId: commandActionId,
      sessionId: 'happy-session',
      targetRequestId,
      type: 'answer-permission',
      content: { decision, scope: 'once' },
    });
    await expect(answer('write-1', 'approve')).resolves.toMatchObject({ outcome: 'destructive_kind' });
    await expect(answer('unknown-1', 'approve')).resolves.toMatchObject({ outcome: 'destructive_kind' });
    await expect(answer('missing', 'deny')).resolves.toMatchObject({ outcome: 'not_pending' });
    await expect(answer('write-1', 'deny', denyActionId))
      .resolves.toMatchObject({ actionId: denyActionId, outcome: 'applied' });
    await expect(answer('read-1', 'approve', approveReadActionId))
      .resolves.toMatchObject({ actionId: approveReadActionId, outcome: 'applied' });

    const answerCalls = fake.calls.filter((call) => call.method === 'happy.answerPrompt');
    expect(answerCalls).toHaveLength(2);
    expect(answerCalls.map((call) => call.params)).toEqual([
      expect.objectContaining({
        leaseId: 'lease-1',
        targetRequestId: 'write-1',
        content: { decision: 'deny', scope: 'once' },
      }),
      expect.objectContaining({
        leaseId: 'lease-1',
        targetRequestId: 'read-1',
        content: { decision: 'approve', scope: 'once' },
      }),
    ]);
    client.dispose();
  });

  // Regression: the live joint E2E returned JSON-RPC -32603 on every
  // `happy.answerPrompt` because the fork's `handleAnswerPrompt` requires a
  // non-empty string `leaseId` (`happy.* requires a non-empty string leaseId`),
  // which the wire envelope deliberately does not carry. Pin the full param
  // contract so a future envelope change cannot silently drop it again.
  it('sends every param the fork requires on happy.answerPrompt and never leaks the Happy session id', async () => {
    const fake = harness([
      { outcome: 'applied' },
      { outcome: 'applied', leaseId: 'lease-7', expiresAt: Date.now() + 45_000 },
      { actionId, outcome: 'applied' },
    ]);
    const client = new CopilotSteeringClient(fake.transport as never);
    await client.start();
    client.observeNativeEvent({
      id: 'write',
      type: 'permission.requested',
      timestamp: '2026-08-01T00:00:00Z',
      data: { requestId: 'write-9', promptRequest: { kind: 'write' } },
    });

    await expect(client.answerPrompt({
      actionId,
      sessionId: 'happy-session',
      targetRequestId: 'write-9',
      type: 'answer-permission',
      content: { decision: 'deny', scope: 'once' },
    })).resolves.toMatchObject({ outcome: 'applied' });

    const call = fake.calls.find((entry) => entry.method === 'happy.answerPrompt');
    expect(call?.params).toEqual({
      actionId,
      leaseId: 'lease-7',
      targetRequestId: 'write-9',
      type: 'answer-permission',
      content: { decision: 'deny', scope: 'once' },
    });
    // `sessionId` is injected by the native transport (the Copilot foreground
    // session id); the Happy session id must never be forwarded.
    expect(call?.params).not.toHaveProperty('sessionId');
    client.dispose();
  });

  it('does not start a retry at the 45s deadline and bounds request timeout to remaining time', async () => {
    let now = 0;
    const fake = harness([
      { outcome: 'applied' },
      { outcome: 'applied', leaseId: 'lease-1', expiresAt: 45_000 },
      { actionId, outcome: 'rate_limited', retryAfterMs: 44_999 },
    ]);
    const client = new CopilotSteeringClient(fake.transport as never, {
      now: () => now,
      sleep: async (ms) => { now += ms + 1; },
    });
    await client.start();
    client.observeNativeEvent({
      id: 'prompt',
      type: 'user_input.requested',
      timestamp: '2026-08-01T00:00:00Z',
      data: { requestId: 'prompt-1', question: 'Choose' },
    });

    await expect(client.answerPrompt({
      actionId,
      sessionId: 'happy-session',
      targetRequestId: 'prompt-1',
      type: 'answer-ask-user',
      content: { answer: 'A' },
    })).resolves.toMatchObject({ outcome: 'rate_limited' });

    const answerCalls = fake.calls.filter((call) => call.method === 'happy.answerPrompt');
    expect(answerCalls).toHaveLength(1);
    expect(answerCalls[0].timeoutMs).toBe(15_000);
    client.dispose();
  });

  it('binds a lease to one relay connection and requires explicit re-request after reconnect', async () => {
    const fake = harness([
      { outcome: 'applied' },
      { outcome: 'no_lease' },
      { outcome: 'pending', requestId: 'request-1' },
      { outcome: 'applied' },
      { outcome: 'pending', requestId: 'request-2' },
    ]);
    const client = new CopilotSteeringClient(fake.transport as never);
    await client.start();
    const broker = new CopilotPhoneSteeringBroker(client);

    await expect(broker.requestLease('phone-a')).resolves.toMatchObject({ outcome: 'pending' });
    fake.notify({
      method: 'happy.controlChanged',
      params: {
        reason: 'granted',
        requestId: 'request-1',
        leaseId: 'lease-1',
        expiresAt: Date.now() + 45_000,
      },
    });
    await expect(broker.heartbeat('phone-b')).resolves.toEqual({ outcome: 'no_lease' });
    await expect(broker.getControlState('phone-b')).resolves.toEqual({ outcome: 'no_lease' });
    expect(broker.attach('phone-b')).toEqual({ outcome: 'no_lease' });

    await broker.invalidateConnection('phone-a');
    expect(broker.attach('phone-a-reconnected')).toEqual({ outcome: 'no_lease' });
    await expect(broker.requestLease('phone-a-reconnected')).resolves.toMatchObject({
      outcome: 'pending',
      requestId: 'request-2',
    });
    expect(fake.calls.filter((call) => call.method === 'happy.releaseLease')).toHaveLength(1);
    expect(fake.calls.filter((call) => call.method === 'happy.requestLease')).toHaveLength(2);
    client.dispose();
  });
});
