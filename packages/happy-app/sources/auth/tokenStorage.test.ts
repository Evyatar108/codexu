import { beforeEach, describe, expect, it, vi } from 'vitest';

const secureStore = vi.hoisted(() => ({
    getItemAsync: vi.fn(),
    setItemAsync: vi.fn(),
    deleteItemAsync: vi.fn(),
}));

vi.mock('expo-secure-store', () => secureStore);
vi.mock('react-native', () => ({ Platform: { OS: 'ios' } }));

import { type AuthCredentials, TokenStorage } from './tokenStorage';

const paired: AuthCredentials = {
    authMode: 'paired-device',
    machineId: 'machine-1',
    tunnelUrl: 'http://127.0.0.1:4567',
    firstSeenAt: 123,
    deviceKeyId: 'tablet-1',
    devicePublicKey: 'public-key',
    deviceSecretKey: 'secret-key',
    serverEd25519PublicKey: 'server-public-key',
    serverEd25519Fingerprint: 'SHA256:server',
};

describe('TokenStorage pairing migration', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        secureStore.getItemAsync.mockResolvedValue(null);
    });

    it('round-trips paired-device and server identity fields', async () => {
        await expect(TokenStorage.setCredentials(paired)).resolves.toBe(true);
        const serialized = secureStore.setItemAsync.mock.calls[0]![1] as string;
        secureStore.getItemAsync.mockResolvedValue(serialized);
        await expect(TokenStorage.getCredentials()).resolves.toEqual(paired);
    });

    it('removes retired Dev-Tunnels credentials and OAuth token while preserving paired devices', async () => {
        secureStore.getItemAsync.mockResolvedValue(JSON.stringify({
            primaryMachineId: 'legacy',
            devTunnelsAccess: 'ghu_retired',
            machines: [
                {
                    authMode: 'dev-tunnel',
                    machineId: 'legacy',
                    tunnelUrl: 'https://legacy.devtunnels.ms',
                    firstSeenAt: 1,
                    connectToken: 'connect-secret',
                    tunnelId: 'legacy-tunnel',
                },
                paired,
            ],
        }));

        await expect(TokenStorage.getCredentialsList()).resolves.toEqual([paired]);
        expect(secureStore.setItemAsync).toHaveBeenCalledWith(
            'machine_credentials',
            JSON.stringify({
                primaryMachineId: 'machine-1',
                machines: [paired],
                devTunnelsAccess: null,
            }),
        );
    });

    it('does not persist newly supplied Dev-Tunnels credentials or tokens', async () => {
        await expect(TokenStorage.setCredentials({
            authMode: 'dev-tunnel',
            machineId: 'legacy',
            tunnelUrl: 'https://legacy.devtunnels.ms',
            firstSeenAt: 1,
        })).resolves.toBe(false);
        await TokenStorage.setDevTunnelsToken('ghu_retired');
        expect(secureStore.setItemAsync).toHaveBeenLastCalledWith(
            'machine_credentials',
            JSON.stringify({ primaryMachineId: null, machines: [], devTunnelsAccess: null }),
        );
    });
});
