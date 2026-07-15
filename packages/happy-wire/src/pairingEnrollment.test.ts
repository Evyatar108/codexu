import * as ed from '@noble/ed25519';
import { describe, expect, it } from 'vitest';

import {
  encodeBase64,
  signPairCompleteResponse,
  verifyPairCompleteResponse,
} from './index';

describe('signed pairing enrollment response', () => {
  it('verifies the server identity and rejects tampering', async () => {
    const secretKey = new Uint8Array(32).fill(11);
    const publicKey = encodeBase64(await ed.getPublicKeyAsync(secretKey));
    const response = await signPairCompleteResponse({
      version: 2,
      authMode: 'paired-device',
      githubLogin: null,
      profile: {
        id: 'machine-1',
        timestamp: 1,
        firstName: null,
        lastName: null,
        avatar: null,
        github: null,
        connectedServices: [],
      },
      machine: {
        machineId: 'machine-1',
        tunnelUrl: 'http://127.0.0.1:4567',
        ed25519PublicKey: publicKey,
        x25519PublicKey: encodeBase64(new Uint8Array(32).fill(12)),
        ed25519Fingerprint: 'SHA256:test',
      },
      pairedDevice: {
        keyId: 'tablet-1',
        publicKey: encodeBase64(new Uint8Array(32).fill(13)),
      },
      issuedAt: 123,
    }, secretKey);

    await expect(verifyPairCompleteResponse(response)).resolves.toBe(true);
    await expect(verifyPairCompleteResponse({
      ...response,
      machine: { ...response.machine, machineId: 'machine-2' },
    })).resolves.toBe(false);
  });
});
