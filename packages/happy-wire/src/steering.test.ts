import { describe, expect, it } from 'vitest';

import {
  STEERING_RPC_METHODS,
  STEERING_RELAY_CALLER_KEY,
  steeringCommandEnvelopeSchema,
  steeringControlChangedParamsSchema,
  steeringControlChangedReasonSchema,
  steeringRelayCallerSchema,
  steeringResultSchema,
} from './index';

const actionId = '123e4567-e89b-42d3-a456-426614174000';
const base = {
  actionId,
  sessionId: 'session-1',
  targetRequestId: 'request-1',
};

describe('steering wire schemas', () => {
  it('accepts every final answer content type', () => {
    const commands = [
      {
        ...base,
        type: 'answer-ask-user',
        content: { answer: 'Option A', wasFreeform: false, dismissed: false },
      },
      {
        ...base,
        type: 'answer-elicitation',
        content: { action: 'accept', content: { project: 'happy' } },
      },
      {
        ...base,
        type: 'answer-plan',
        content: { approved: false, selectedAction: 'revise', feedback: 'Tighten scope' },
      },
      {
        ...base,
        type: 'answer-permission',
        content: { decision: 'approve', scope: 'once' },
      },
    ];

    for (const command of commands) {
      expect(steeringCommandEnvelopeSchema.parse(command)).toEqual(command);
    }
  });

  it('rejects non-v4 action IDs and out-of-scope content fields', () => {
    expect(steeringCommandEnvelopeSchema.safeParse({
      ...base,
      actionId: '123e4567-e89b-12d3-a456-426614174000',
      type: 'answer-permission',
      content: { decision: 'approve' },
    }).success).toBe(false);
    expect(steeringCommandEnvelopeSchema.safeParse({
      ...base,
      type: 'answer-permission',
      content: { decision: 'approve', scope: 'session' },
    }).success).toBe(false);
    expect(steeringCommandEnvelopeSchema.safeParse({
      ...base,
      type: 'answer-plan',
      content: { approved: true, autoApproveEdits: true },
    }).success).toBe(false);
  });

  it('accepts the final outcome and lease result fields', () => {
    expect(steeringResultSchema.parse({
      actionId,
      outcome: 'applied',
      leaseId: 'lease-1',
      expiresAt: 1_800_000,
      heartbeatIntervalMs: 15_000,
      leaseTtlMs: 45_000,
      requestId: 'request-1',
    })).toMatchObject({
      actionId,
      outcome: 'applied',
      heartbeatIntervalMs: 15_000,
      leaseTtlMs: 45_000,
    });
    expect(steeringResultSchema.parse({
      actionId,
      outcome: 'rate_limited',
      retryAfterMs: 250,
    }).outcome).toBe('rate_limited');
  });

  it('keeps the final RPC names and control-change reasons stable', () => {
    expect(STEERING_RPC_METHODS).toEqual([
      'happy.attach',
      'happy.requestLease',
      'happy.heartbeat',
      'happy.releaseLease',
      'happy.answerPrompt',
      'happy.getControlState',
    ]);
    for (const reason of ['granted', 'denied', 'keystroke', 'expired', 'released', 'detached']) {
      expect(steeringControlChangedReasonSchema.safeParse(reason).success).toBe(true);
    }
    expect(steeringControlChangedParamsSchema.parse({
      reason: 'granted',
      requestId: 'request-1',
      leaseId: 'lease-1',
      expiresAt: 1_800_000,
      heartbeatIntervalMs: 15_000,
      leaseTtlMs: 45_000,
    })).toMatchObject({
      reason: 'granted',
      requestId: 'request-1',
      leaseTtlMs: 45_000,
    });
    expect(steeringControlChangedParamsSchema.parse({
      reason: 'future-revocation',
      leaseId: 'lease-1',
    }).reason).toBe('future-revocation');
    expect(STEERING_RELAY_CALLER_KEY).toBe('__happyRpcCaller');
    expect(steeringRelayCallerSchema.parse({ connectionId: 'socket-1' })).toEqual({
      connectionId: 'socket-1',
    });
  });
});
