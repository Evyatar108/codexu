import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { CanonicalLocalProfileFileSchema } from '@slopus/happy-wire';

const mocks = vi.hoisted(() => ({
    readCredentials: vi.fn(),
    writeCredentialsLegacy: vi.fn(),
    writeCredentialsDataKey: vi.fn(),
    configuration: {
        happyHomeDir: 'C:\\happy-test',
        localProfileFile: 'C:\\happy-test\\local-profile.json',
        serverStorageKeyFile: 'C:\\happy-test\\server-storage.key',
        publicPairingInviteFile: 'C:\\happy-test\\public-pairing-invite.json',
    },
}));

vi.mock('@/persistence', () => ({
    readCredentials: mocks.readCredentials,
    writeCredentialsLegacy: mocks.writeCredentialsLegacy,
    writeCredentialsDataKey: mocks.writeCredentialsDataKey,
}));
vi.mock('@/configuration', () => ({
    configuration: mocks.configuration,
}));
vi.mock('./logger', () => ({ logger: { debug: vi.fn(), warn: vi.fn() } }));

import {
    createLocalCompatibilityToken,
    doAuth,
    migrateLocalProfile,
    shouldReplaceBootstrapToken,
} from './auth';

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

    it('migrates the real legacy profile file into the versioned canonical schema', async () => {
        const root = join(process.cwd(), `.auth-profile-test-${randomUUID()}`);
        await mkdir(root, { recursive: true });
        try {
            mocks.configuration.happyHomeDir = root;
            mocks.configuration.localProfileFile = join(root, 'local-profile.json');
            await writeFile(join(root, 'profile.json'), JSON.stringify({
                githubLogin: 'octocat',
                name: 'Octo Cat',
                token: 'ghu_must_not_migrate',
            }));

            await migrateLocalProfile('machine-1');

            const profile = CanonicalLocalProfileFileSchema.parse(
                JSON.parse(await readFile(mocks.configuration.localProfileFile, 'utf8')),
            );
            expect(profile).toEqual({
                version: 1,
                id: 'machine-1',
                timestamp: expect.any(Number),
                firstName: 'Octo',
                lastName: 'Cat',
                avatar: null,
                github: null,
                connectedServices: [],
            });
            expect(JSON.stringify(profile)).not.toContain('ghu_must_not_migrate');
        } finally {
            if (process.platform === 'win32') {
                const profilePath = join(root, 'local-profile.json');
                execFileSync('icacls', [profilePath, '/grant:r', `${process.env.USERNAME}:F`], {
                    stdio: 'ignore',
                });
            }
            await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
        }
    });
});
