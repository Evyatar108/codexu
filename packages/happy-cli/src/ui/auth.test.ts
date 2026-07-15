import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    readCredentials: vi.fn(),
    writeCredentialsLegacy: vi.fn(),
    writeCredentialsDataKey: vi.fn(),
}));

vi.mock('@/persistence', () => ({
    readCredentials: mocks.readCredentials,
    writeCredentialsLegacy: mocks.writeCredentialsLegacy,
    writeCredentialsDataKey: mocks.writeCredentialsDataKey,
}));
vi.mock('@/configuration', () => ({
    configuration: {
        happyHomeDir: 'C:\\happy-test',
        localProfileFile: 'C:\\happy-test\\local-profile.json',
        serverStorageKeyFile: 'C:\\happy-test\\server-storage.key',
    },
}));
vi.mock('./logger', () => ({ logger: { debug: vi.fn(), warn: vi.fn() } }));

import { createLocalCompatibilityToken, doAuth, shouldReplaceBootstrapToken } from './auth';

describe('offline local bootstrap', () => {
    afterEach(() => vi.clearAllMocks());

    it.each(['ghu_old', 'gho_old', 'ghp_old', 'github_pat_old'])(
        'recognizes only known GitHub bootstrap token %s',
        token => expect(shouldReplaceBootstrapToken(token)).toBe(true),
    );

    it('preserves unknown upstream Happy tokens and encryption keys', async () => {
        const fetchSpy = vi.spyOn(globalThis, 'fetch');
        const publicKey = new Uint8Array(32).fill(1);
        const machineKey = new Uint8Array(32).fill(2);
        const existing = {
            token: 'happy-upstream-token',
            encryption: { type: 'dataKey' as const, publicKey, machineKey },
        };
        mocks.readCredentials.mockResolvedValue(existing);

        await expect(doAuth()).resolves.toBe(existing);
        expect(mocks.writeCredentialsDataKey).not.toHaveBeenCalled();
        expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('atomically replaces a known GitHub token while preserving encryption keys', async () => {
        const secret = new Uint8Array(32).fill(7);
        mocks.readCredentials.mockResolvedValue({
            token: 'ghu_retired',
            encryption: { type: 'legacy', secret },
        });

        const result = await doAuth();

        expect(result?.token).toMatch(/^happy-local-v1_[A-Za-z0-9_-]+$/);
        expect(result?.encryption).toEqual({ type: 'legacy', secret });
        expect(mocks.writeCredentialsLegacy).toHaveBeenCalledWith({
            secret,
            token: result?.token,
        });
    });

    it('creates opaque compatibility tokens without network-shaped prefixes', () => {
        expect(createLocalCompatibilityToken()).toMatch(/^happy-local-v1_[A-Za-z0-9_-]{40,}$/);
    });
});
