import { describe, expect, it } from 'vitest';
import {
  AgentCommsChannelSchema,
  AgentCommsEnvelopeSchema,
  AgentCommsKindSchema,
  AgentCommsScopeSchema,
  MAX_HOPS,
  type AgentCommsEnvelope,
} from './index';

const baseEnvelope: AgentCommsEnvelope = {
  v: 1,
  id: 'env-001',
  ts: 1_700_000_000_000,
  from: { machineId: 'machine-a', sessionId: 'sess-a' },
  to: { machineId: 'machine-b', sessionId: 'sess-b' },
  scope: 'A',
  channel: 'message',
  kind: 'request',
  hopCount: 0,
  hopPath: ['sess-a'],
  body: { text: 'hello' },
};

describe('AgentCommsEnvelope', () => {
  it('accepts a valid Scope A request envelope', () => {
    const parsed = AgentCommsEnvelopeSchema.parse(baseEnvelope);
    expect(parsed.scope).toBe('A');
    expect(parsed.hopCount).toBe(0);
  });

  it('accepts a valid Scope B envelope with no machineId on target', () => {
    const envelope = {
      ...baseEnvelope,
      scope: 'B' as const,
      to: { sessionId: 'sess-b' },
    };
    const parsed = AgentCommsEnvelopeSchema.parse(envelope);
    expect(parsed.to.machineId).toBeUndefined();
  });

  it('accepts a valid Scope C envelope with correlationId', () => {
    const envelope = {
      ...baseEnvelope,
      scope: 'C' as const,
      to: { sessionId: 'sess-child' },
      kind: 'reply' as const,
      correlationId: 'corr-1',
    };
    const parsed = AgentCommsEnvelopeSchema.parse(envelope);
    expect(parsed.correlationId).toBe('corr-1');
  });

  it('accepts spawn channel with spawn-request kind', () => {
    const envelope = {
      ...baseEnvelope,
      channel: 'spawn' as const,
      kind: 'spawn-request' as const,
    };
    const parsed = AgentCommsEnvelopeSchema.parse(envelope);
    expect(parsed.channel).toBe('spawn');
    expect(parsed.kind).toBe('spawn-request');
  });

  it('rejects invalid scope values', () => {
    const envelope = { ...baseEnvelope, scope: 'D' };
    expect(() => AgentCommsEnvelopeSchema.parse(envelope)).toThrow();
  });

  it('rejects invalid channel values', () => {
    const envelope = { ...baseEnvelope, channel: 'broadcast' };
    expect(() => AgentCommsEnvelopeSchema.parse(envelope)).toThrow();
  });

  it('rejects invalid kind values', () => {
    const envelope = { ...baseEnvelope, kind: 'shout' };
    expect(() => AgentCommsEnvelopeSchema.parse(envelope)).toThrow();
  });

  it('rejects missing from.sessionId', () => {
    const envelope = {
      ...baseEnvelope,
      from: { machineId: 'machine-a' },
    };
    expect(() => AgentCommsEnvelopeSchema.parse(envelope)).toThrow();
  });

  it('rejects missing to.sessionId', () => {
    const envelope = {
      ...baseEnvelope,
      to: { machineId: 'machine-b' },
    };
    expect(() => AgentCommsEnvelopeSchema.parse(envelope)).toThrow();
  });

  it('rejects missing from.machineId', () => {
    const envelope = {
      ...baseEnvelope,
      from: { sessionId: 'sess-a' },
    };
    expect(() => AgentCommsEnvelopeSchema.parse(envelope)).toThrow();
  });

  it('rejects v != 1', () => {
    const envelope = { ...baseEnvelope, v: 2 };
    expect(() => AgentCommsEnvelopeSchema.parse(envelope)).toThrow();
  });

  it('accepts hopCount at the MAX_HOPS boundary', () => {
    const envelope = { ...baseEnvelope, hopCount: MAX_HOPS };
    const parsed = AgentCommsEnvelopeSchema.parse(envelope);
    expect(parsed.hopCount).toBe(MAX_HOPS);
  });

  it('rejects hopCount > MAX_HOPS', () => {
    const envelope = { ...baseEnvelope, hopCount: MAX_HOPS + 1 };
    expect(() => AgentCommsEnvelopeSchema.parse(envelope)).toThrow();
  });

  it('rejects negative hopCount', () => {
    const envelope = { ...baseEnvelope, hopCount: -1 };
    expect(() => AgentCommsEnvelopeSchema.parse(envelope)).toThrow();
  });

  it('rejects non-integer hopCount', () => {
    const envelope = { ...baseEnvelope, hopCount: 1.5 };
    expect(() => AgentCommsEnvelopeSchema.parse(envelope)).toThrow();
  });

  it('rejects empty hopPath entries', () => {
    const envelope = { ...baseEnvelope, hopPath: [''] };
    expect(() => AgentCommsEnvelopeSchema.parse(envelope)).toThrow();
  });

  it('exposes scope/channel/kind enums', () => {
    expect(AgentCommsScopeSchema.options).toEqual(['B', 'C', 'A']);
    expect(AgentCommsChannelSchema.options).toEqual(['message', 'spawn']);
    expect(AgentCommsKindSchema.options).toEqual([
      'request',
      'reply',
      'notify',
      'spawn-request',
      'spawn-result',
    ]);
  });

  it('exposes MAX_HOPS as the documented cap of 4', () => {
    expect(MAX_HOPS).toBe(4);
  });
});
