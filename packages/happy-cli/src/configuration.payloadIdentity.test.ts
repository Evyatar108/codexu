import { describe, expect, it } from 'vitest';

import { parseHappyPayloadIdentity } from './configuration';

describe('Happy payload identity configuration', () => {
  it('keeps ordinary global and development invocations version-only', () => {
    expect(parseHappyPayloadIdentity({})).toBeNull();
  });

  it('accepts an exact id/hash pair and rejects partial or malformed values', () => {
    expect(parseHappyPayloadIdentity({
      HAPPY_PAYLOAD_ARTIFACT_ID: 'happy-20260722',
      HAPPY_PAYLOAD_MANIFEST_SHA256: 'A'.repeat(64),
    })).toEqual({
      artifactId: 'happy-20260722',
      manifestSha256: 'A'.repeat(64),
    });
    expect(() => parseHappyPayloadIdentity({
      HAPPY_PAYLOAD_ARTIFACT_ID: 'happy-20260722',
    })).toThrow('Invalid Happy payload identity');
    expect(() => parseHappyPayloadIdentity({
      HAPPY_PAYLOAD_ARTIFACT_ID: '../escape',
      HAPPY_PAYLOAD_MANIFEST_SHA256: 'a'.repeat(64),
    })).toThrow('Invalid Happy payload identity');
  });
});
