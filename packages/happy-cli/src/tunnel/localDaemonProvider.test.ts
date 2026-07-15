import { describe, expect, it } from 'vitest';

import { LocalDaemonProvider } from './localDaemonProvider';

describe('LocalDaemonProvider', () => {
  it('returns a loopback URL without running any network provider', async () => {
    const provider = new LocalDaemonProvider();
    await expect(provider.loadHostTunnel({ port: 4567, additionalPorts: [4568] })).resolves.toMatchObject({
      tunnelId: 'local-loopback',
      tunnelName: 'local-loopback',
      tunnelUrl: 'http://127.0.0.1:4567',
    });
  });
});
