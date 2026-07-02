import { beforeEach, describe, expect, it, vi } from 'vitest';

const secureStore = vi.hoisted(() => ({
    getItemAsync: vi.fn(),
    setItemAsync: vi.fn(),
    deleteItemAsync: vi.fn(),
}));

vi.mock('expo-secure-store', () => secureStore);

vi.mock('react-native', () => ({
    Platform: { OS: 'ios' },
}));

import { AuthCredentials, isOldShape, TokenStorage } from './tokenStorage';

describe('TokenStorage', () => {
    const credentials: AuthCredentials = {
        machineId: 'machine-1',
        tunnelUrl: 'https://machine.example.test',
        firstSeenAt: 123,
        tunnelId: 'tunnel-1',
        login: 'octocat',
        avatarUrl: 'https://avatars.example.test/octocat.png',
        deviceCode: 'device-1',
        deviceCodeExpiresAt: 456,
    };

    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('persists trusted machine credentials in SecureStore', async () => {
        await expect(TokenStorage.setCredentials(credentials)).resolves.toBe(true);

        expect(secureStore.setItemAsync).toHaveBeenCalledWith(
            'machine_credentials',
            JSON.stringify({
                primaryMachineId: 'machine-1',
                machines: [credentials],
                devTunnelsAccess: null,
            })
        );
    });

    it('loads trusted machine credentials from SecureStore', async () => {
        secureStore.getItemAsync.mockResolvedValue(JSON.stringify({
            primaryMachineId: 'machine-1',
            machines: [credentials],
            devTunnelsAccess: null,
        }));

        await expect(TokenStorage.getCredentials()).resolves.toEqual(credentials);
    });

    it('appends additional trusted machines and returns the full paired list', async () => {
        const second: AuthCredentials = {
            ...credentials,
            machineId: 'machine-2',
            tunnelUrl: 'https://machine-2.example.test',
        };
        secureStore.getItemAsync.mockResolvedValueOnce(JSON.stringify({
            primaryMachineId: 'machine-1',
            machines: [credentials],
            devTunnelsAccess: 'oauth-token-1',
        }));

        await expect(TokenStorage.setCredentials(second)).resolves.toBe(true);

        expect(secureStore.setItemAsync).toHaveBeenCalledWith(
            'machine_credentials',
            JSON.stringify({
                primaryMachineId: 'machine-2',
                machines: [credentials, second],
                devTunnelsAccess: 'oauth-token-1',
            })
        );
    });

    it('drops legacy single-machine storage', async () => {
        secureStore.getItemAsync.mockResolvedValue(JSON.stringify(credentials));

        await expect(TokenStorage.getCredentialsList()).resolves.toEqual([]);
    });

    it('round-trips the top-level Dev Tunnels token without paired machines', async () => {
        secureStore.getItemAsync.mockResolvedValueOnce(null).mockResolvedValueOnce(JSON.stringify({
            primaryMachineId: null,
            machines: [],
            devTunnelsAccess: 'oauth-token-2',
        }));

        await expect(TokenStorage.setDevTunnelsToken('oauth-token-2')).resolves.toBeUndefined();
        await expect(TokenStorage.getDevTunnelsToken()).resolves.toBe('oauth-token-2');

        expect(secureStore.setItemAsync).toHaveBeenCalledWith(
            'machine_credentials',
            JSON.stringify({
                primaryMachineId: null,
                machines: [],
                devTunnelsAccess: 'oauth-token-2',
            })
        );
    });

    it('loads an empty machine bundle with Dev Tunnels OAuth preserved', async () => {
        secureStore.getItemAsync.mockResolvedValue(JSON.stringify({
            primaryMachineId: null,
            machines: [],
            devTunnelsAccess: 'oauth-token-3',
        }));

        await expect(TokenStorage.getCredentials()).resolves.toBeNull();
        await expect(TokenStorage.getDevTunnelsToken()).resolves.toBe('oauth-token-3');
    });

    it('removes a single machine and preserves Dev Tunnels OAuth', async () => {
        const second: AuthCredentials = { ...credentials, machineId: 'machine-2', tunnelUrl: 'https://machine-2.example.test' };
        secureStore.getItemAsync.mockResolvedValue(JSON.stringify({
            primaryMachineId: 'machine-1',
            machines: [credentials, second],
            devTunnelsAccess: 'oauth-token-4',
        }));

        await expect(TokenStorage.removeMachineCredentials('machine-1')).resolves.toBe(true);

        expect(secureStore.setItemAsync).toHaveBeenCalledWith(
            'machine_credentials',
            JSON.stringify({
                primaryMachineId: 'machine-2',
                machines: [second],
                devTunnelsAccess: 'oauth-token-4',
            })
        );
    });

    it('updates one machine without changing primary machine or Dev Tunnels OAuth', async () => {
        const second: AuthCredentials = { ...credentials, machineId: 'machine-2', tunnelUrl: 'https://machine-2.example.test' };
        secureStore.getItemAsync.mockResolvedValue(JSON.stringify({
            primaryMachineId: 'machine-1',
            machines: [credentials, second],
            devTunnelsAccess: 'oauth-token-6',
        }));

        await expect(TokenStorage.updateMachineCredentials('machine-2', {
            connectToken: 'connect-2',
            connectTokenExpiry: 999,
        })).resolves.toBe(true);

        expect(secureStore.setItemAsync).toHaveBeenCalledWith(
            'machine_credentials',
            JSON.stringify({
                primaryMachineId: 'machine-1',
                machines: [credentials, { ...second, connectToken: 'connect-2', connectTokenExpiry: 999 }],
                devTunnelsAccess: 'oauth-token-6',
            })
        );
    });

    it('returns false without writing when updating an unknown machine', async () => {
        secureStore.getItemAsync.mockResolvedValue(JSON.stringify({
            primaryMachineId: 'machine-1',
            machines: [credentials],
            devTunnelsAccess: 'oauth-token-7',
        }));

        await expect(TokenStorage.updateMachineCredentials('missing-machine', { connectToken: 'connect' })).resolves.toBe(false);

        expect(secureStore.setItemAsync).not.toHaveBeenCalled();
    });

    it('strips unknown fields (e.g. stale tunnelClaim) on load', async () => {
        const staleBlob = { ...credentials, tunnelClaim: 'stale-claim', accountId: 'old-account' };
        secureStore.getItemAsync.mockResolvedValue(JSON.stringify({
            primaryMachineId: 'machine-1',
            machines: [staleBlob],
            devTunnelsAccess: null,
        }));

        await expect(TokenStorage.getCredentials()).resolves.toEqual(credentials);
    });

    it('does not re-persist unknown fields from a stale blob after updateMachineCredentials', async () => {
        const staleBlob = { ...credentials, tunnelClaim: 'stale-claim', accountId: 'old-account' };
        secureStore.getItemAsync.mockResolvedValue(JSON.stringify({
            primaryMachineId: 'machine-1',
            machines: [staleBlob],
            devTunnelsAccess: null,
        }));

        await expect(TokenStorage.updateMachineCredentials('machine-1', { connectToken: 'new-token' })).resolves.toBe(true);

        expect(secureStore.setItemAsync).toHaveBeenCalledWith(
            'machine_credentials',
            JSON.stringify({
                primaryMachineId: 'machine-1',
                machines: [{ ...credentials, connectToken: 'new-token' }],
                devTunnelsAccess: null,
            })
        );
    });

    it('strips unknown fields when setting credentials', async () => {
        const staleBlob = { ...credentials, tunnelClaim: 'stale-claim', accountId: 'old-account' } as AuthCredentials & Record<string, unknown>;
        await expect(TokenStorage.setCredentials(staleBlob as AuthCredentials)).resolves.toBe(true);

        expect(secureStore.setItemAsync).toHaveBeenCalledWith(
            'machine_credentials',
            JSON.stringify({
                primaryMachineId: 'machine-1',
                machines: [credentials],
                devTunnelsAccess: null,
            })
        );
    });

    it('detects old-shape records', () => {
        expect(isOldShape({ ...credentials, pinnedPubkey: 'ed-pubkey' })).toBe(true);
        expect(isOldShape({ ...credentials, sessionKey: 'shared-session-key' })).toBe(true);
        expect(isOldShape(credentials)).toBe(false);
    });

    it('wipes old-shape records while preserving claim-free credentials and rolling primary machine', async () => {
        const cleanSecond: AuthCredentials = {
            ...credentials,
            machineId: 'machine-2',
            tunnelUrl: 'https://machine-2.example.test',
        };
        const oldPinned = { ...credentials, pinnedPubkey: 'legacy-pubkey' };
        const oldSession = { ...credentials, machineId: 'machine-3', sessionKey: 'legacy-session' };
        const claimFree = { ...credentials, machineId: 'machine-4', tunnelUrl: 'https://machine-4.example.test' };
        secureStore.getItemAsync.mockResolvedValue(JSON.stringify({
            primaryMachineId: 'machine-1',
            machines: [oldPinned, cleanSecond, oldSession, claimFree],
            devTunnelsAccess: 'oauth-token-5',
        }));

        await expect(TokenStorage.getCredentialsList()).resolves.toEqual([cleanSecond, claimFree]);

        expect(secureStore.setItemAsync).toHaveBeenCalledWith(
            'machine_credentials',
            JSON.stringify({
                primaryMachineId: 'machine-2',
                machines: [cleanSecond, claimFree],
                devTunnelsAccess: 'oauth-token-5',
            })
        );
    });

    // --- Public-server (evyatar.dev) credential migration (US-007) ---

    const publicCredentials: AuthCredentials = {
        machineId: 'machine-public',
        tunnelUrl: 'https://happy.evyatar.dev',
        firstSeenAt: 789,
        login: 'octocat',
        cloudflareAccessClientId: 'cf-access-client-id.example',
        cloudflareAccessClientSecret: 'cf-access-client-secret-value',
        deviceKeyId: 'device-key-1',
        devicePublicKey: 'cHVibGljLWtleS1iYXNlNjQ=',
        deviceSecretKey: 'c2VjcmV0LWtleS1iYXNlNjQ=',
    };

    it('round-trips public-mode Access + device-key fields through set/get', async () => {
        secureStore.getItemAsync.mockResolvedValueOnce(null);
        await expect(TokenStorage.setCredentials(publicCredentials)).resolves.toBe(true);

        expect(secureStore.setItemAsync).toHaveBeenCalledWith(
            'machine_credentials',
            JSON.stringify({
                primaryMachineId: 'machine-public',
                machines: [publicCredentials],
                devTunnelsAccess: null,
            })
        );

        secureStore.getItemAsync.mockResolvedValue(JSON.stringify({
            primaryMachineId: 'machine-public',
            machines: [publicCredentials],
            devTunnelsAccess: null,
        }));
        await expect(TokenStorage.getCredentials()).resolves.toEqual(publicCredentials);
    });

    it('upgrades existing Dev Tunnels storage with a public machine without mutating the old entry', async () => {
        secureStore.getItemAsync.mockResolvedValueOnce(JSON.stringify({
            primaryMachineId: 'machine-1',
            machines: [credentials],
            devTunnelsAccess: 'oauth-token-8',
        }));

        await expect(TokenStorage.setCredentials(publicCredentials)).resolves.toBe(true);

        // The pre-existing Dev Tunnels machine is preserved byte-for-byte (no new
        // public fields injected); the public machine is appended and becomes primary.
        expect(secureStore.setItemAsync).toHaveBeenCalledWith(
            'machine_credentials',
            JSON.stringify({
                primaryMachineId: 'machine-public',
                machines: [credentials, publicCredentials],
                devTunnelsAccess: 'oauth-token-8',
            })
        );
    });

    it('loads pre-existing Dev Tunnels credentials that predate the public fields unchanged', async () => {
        // A blob written before US-007 has none of the new keys. Loading it must
        // return it exactly, without materializing undefined public-mode fields.
        secureStore.getItemAsync.mockResolvedValue(JSON.stringify({
            primaryMachineId: 'machine-1',
            machines: [credentials],
            devTunnelsAccess: null,
        }));

        const loaded = await TokenStorage.getCredentials();
        expect(loaded).toEqual(credentials);
        expect(loaded).not.toHaveProperty('cloudflareAccessClientId');
        expect(loaded).not.toHaveProperty('deviceSecretKey');
    });

    it('drops a public machine whose device key fields are the wrong type', async () => {
        const corrupt = { ...publicCredentials, machineId: 'machine-corrupt', deviceSecretKey: 123 };
        secureStore.getItemAsync.mockResolvedValue(JSON.stringify({
            primaryMachineId: 'machine-public',
            machines: [publicCredentials, corrupt],
            devTunnelsAccess: null,
        }));

        await expect(TokenStorage.getCredentialsList()).resolves.toEqual([publicCredentials]);
    });
});
