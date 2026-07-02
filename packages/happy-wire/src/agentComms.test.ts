import { describe, expect, it } from 'vitest';
import {
  AgentCommsChannelSchema,
  AgentCommsEnvelopeSchema,
  AgentCommsIngestBodySchema,
  AgentCommsKindSchema,
  AgentCommsScopeSchema,
  MAX_HOPS,
  routeHopValidation,
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

const validIngestBody = {
  envelope: {
    v: 1,
    id: 'env-1',
    ts: 1,
    from: { machineId: 'machine-a', sessionId: 'sender' },
    to: { machineId: 'machine-b', sessionId: 'target' },
    scope: 'A',
    channel: 'message',
    kind: 'request',
    hopCount: 0,
    hopPath: ['machine-a:sender'],
    body: { nonce: 'n', ciphertext: 'c' },
  },
  signature: 'sig',
  senderKeys: {
    ed25519PublicKey: 'ed-pub',
    ecdhPublicKey: 'ecdh-pub',
    ed25519Fingerprint: 'SHA256:abc',
  },
};

describe('AgentCommsIngestBodySchema', () => {
  it('accepts a well-formed signed/sealed ingest body', () => {
    const parsed = AgentCommsIngestBodySchema.parse(validIngestBody);
    expect(parsed.envelope.scope).toBe('A');
    expect(parsed.signature).toBe('sig');
    expect(parsed.senderKeys.ecdhPublicKey).toBe('ecdh-pub');
  });

  it('accepts a body without the optional ed25519Fingerprint', () => {
    const { ed25519Fingerprint, ...senderKeys } = validIngestBody.senderKeys;
    const parsed = AgentCommsIngestBodySchema.parse({ ...validIngestBody, senderKeys });
    expect(parsed.senderKeys.ed25519Fingerprint).toBeUndefined();
  });

  it('rejects an empty signature', () => {
    expect(() => AgentCommsIngestBodySchema.parse({ ...validIngestBody, signature: '' })).toThrow();
  });

  it('rejects senderKeys missing the ecdh public key', () => {
    const { ecdhPublicKey, ...senderKeys } = validIngestBody.senderKeys;
    expect(() => AgentCommsIngestBodySchema.parse({ ...validIngestBody, senderKeys })).toThrow();
  });

  it('rejects a body whose envelope is malformed', () => {
    const envelope = { ...validIngestBody.envelope, scope: 'D' };
    expect(() => AgentCommsIngestBodySchema.parse({ ...validIngestBody, envelope })).toThrow();
  });
});

describe('routeHopValidation', () => {
  const baseEnvelope: AgentCommsEnvelope = {
    v: 1,
    id: 'env-hop',
    ts: 1,
    from: { machineId: 'machine-a', sessionId: 'sender' },
    to: { machineId: 'machine-b', sessionId: 'target' },
    scope: 'A',
    channel: 'message',
    kind: 'request',
    hopCount: 0,
    hopPath: ['machine-a:sender'],
    body: { text: 'hello' },
  };

  it('returns null for a valid envelope', () => {
    expect(routeHopValidation(baseEnvelope)).toBeNull();
  });

  it('flags hopCount > MAX_HOPS', () => {
    const envelope = { ...baseEnvelope, hopCount: MAX_HOPS + 1 };
    expect(routeHopValidation(envelope)).toContain('exceeds MAX_HOPS');
  });

  it('flags a duplicate hop in hopPath', () => {
    const envelope = { ...baseEnvelope, hopPath: ['machine-a:sender', 'machine-a:sender'] };
    expect(routeHopValidation(envelope)).toBe('hopPath contains a duplicate session');
  });

  it('flags hopPath already containing the bare target sessionId', () => {
    const envelope = { ...baseEnvelope, hopPath: ['target'] };
    expect(routeHopValidation(envelope)).toBe('hopPath already contains the target session');
  });

  it('flags hopPath already containing the machine-qualified target ref', () => {
    const envelope = { ...baseEnvelope, hopPath: ['machine-b:target'] };
    expect(routeHopValidation(envelope)).toBe('hopPath already contains the target session');
  });
});
