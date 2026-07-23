import { describe, expect, it } from 'vitest';

import { isDaemonStateCompatible } from './controlClient';

const HASH_A = 'A'.repeat(64);
const HASH_B = 'B'.repeat(64);

describe('daemon payload compatibility', () => {
  const state = {
    startedWithCliVersion: '1.2.3',
    startedWithPayloadArtifactId: 'happy-a',
    startedWithPayloadManifestSha256: HASH_A,
  };

  it('accepts the same CLI version and exact artifact identity', () => {
    expect(isDaemonStateCompatible(state, '1.2.3', {
      artifactId: 'happy-a',
      manifestSha256: HASH_A,
    })).toBe(true);
  });

  it('does not conflate version-equal artifact-different payloads', () => {
    expect(isDaemonStateCompatible(state, '1.2.3', {
      artifactId: 'happy-b',
      manifestSha256: HASH_A,
    })).toBe(false);
    expect(isDaemonStateCompatible(state, '1.2.3', {
      artifactId: 'happy-a',
      manifestSha256: HASH_B,
    })).toBe(false);
  });

  it('retains version-only compatibility for ordinary Happy invocations', () => {
    expect(isDaemonStateCompatible({
      startedWithCliVersion: '1.2.3',
    }, '1.2.3', null)).toBe(true);
    expect(isDaemonStateCompatible(state, '2.0.0', null)).toBe(false);
  });
});
