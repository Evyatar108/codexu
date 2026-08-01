import { afterEach, describe, expect, it, vi } from 'vitest';

import type {
  SteeringResult,
  SteeringRpcMethod,
} from '@slopus/happy-wire';

import {
  COPILOT_HEARTBEAT_INTERVAL_MS,
  COPILOT_LEASE_TTL_MS,
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
  const calls: Array<{ method: SteeringRpcMethod; params: Record<string, unknown> }> = [];
  const transport = {
    invokeSteering: vi.fn(async (method: SteeringRpcMethod, params: Record<string, unknown> = {}) => {
      calls.push({ method, params });
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

  it('requests without assuming a grant, accepts a grant, and renews from heartbeat values', async () => {
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
    expect(client.getState()).toEqual({ status: 'requested', requestId: 'lease-request-1' });

    fake.notify({
      method: 'happy.leaseGranted',
      params: {
        sessionId: 'native-session',
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

  it.each(['keystroke', 'expired', 'superseded', 'released', 'detached'] as const)(
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

      fake.notify({ method: 'happy.leaseRevoked', params: { reason, leaseId: 'lease-1' } });

      expect(client.getState()).toEqual({ status: 'no-lease', reason });
      expect(fake.calls).toHaveLength(before);
      client.dispose();
    },
  );

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
});
