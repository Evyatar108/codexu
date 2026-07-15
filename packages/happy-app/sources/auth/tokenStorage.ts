import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

// Web persists credentials (Dev Tunnels GitHub OAuth token and per-machine
// connection metadata) into localStorage; native uses expo-secure-store.
// The localStorage choice is an accepted trade-off for the single-user
// self-host scope — see packages/happy-app/scripts/sprint-a-gap.md
// "Web platform threat model (TokenStorage persistence)".
const AUTH_KEY = 'machine_credentials';

export type AuthMode = 'dev-tunnel' | 'paired-device';

export interface AuthCredentials {
    authMode: AuthMode;
    machineId: string;
    tunnelUrl: string;
    firstSeenAt: number;
    login?: string;
    avatarUrl?: string;
    deviceCode?: string;
    deviceCodeExpiresAt?: number;
    connectToken?: string;
    connectTokenExpiry?: number;
    tunnelId?: string;
    // Optional Cloudflare Access edge layer for paired-device mode. When both
    // fields are absent, paired-device requests use local loopback proof only.
    cloudflareAccessClientId?: string;
    cloudflareAccessClientSecret?: string;
    deviceKeyId?: string;
    devicePublicKey?: string;
    /** Base64 Ed25519 seed (32 bytes). Sensitive; persisted via SecureStore/localStorage. */
    deviceSecretKey?: string;
    serverEd25519PublicKey?: string;
    serverEd25519Fingerprint?: string;
}

export type AuthCredentialsIssue = 'missing-device-key' | 'incomplete-cloudflare';

export function getAuthCredentialsIssue(credentials: AuthCredentials): AuthCredentialsIssue | null {
    if (credentials.authMode === 'dev-tunnel') {
        return null;
    }
    if (!credentials.deviceKeyId || !credentials.devicePublicKey || !credentials.deviceSecretKey) {
        return 'missing-device-key';
    }
    const hasCloudflareId = Boolean(credentials.cloudflareAccessClientId);
    const hasCloudflareSecret = Boolean(credentials.cloudflareAccessClientSecret);
    return hasCloudflareId === hasCloudflareSecret ? null : 'incomplete-cloudflare';
}

export function isUsableAuthCredentials(credentials: AuthCredentials): boolean {
    return getAuthCredentialsIssue(credentials) === null;
}

interface StoredMachineCredentials {
    primaryMachineId: string | null;
    machines: AuthCredentials[];
    devTunnelsAccess: string | null;
}

function isStoredMachineCredentials(value: unknown): value is StoredMachineCredentials {
    if (!value || typeof value !== 'object') {
        return false;
    }
    const candidate = value as Partial<StoredMachineCredentials>;
    return (candidate.primaryMachineId === null || typeof candidate.primaryMachineId === 'string')
        && Array.isArray(candidate.machines)
        && (candidate.devTunnelsAccess === null || typeof candidate.devTunnelsAccess === 'string' || candidate.devTunnelsAccess === undefined);
}

const AUTH_CREDENTIALS_KEYS = new Set<string>([
    'authMode', 'machineId', 'tunnelUrl', 'firstSeenAt',
    'login', 'avatarUrl', 'deviceCode', 'deviceCodeExpiresAt',
    'connectToken', 'connectTokenExpiry', 'tunnelId',
    'cloudflareAccessClientId', 'cloudflareAccessClientSecret',
    'deviceKeyId', 'devicePublicKey', 'deviceSecretKey',
    'serverEd25519PublicKey', 'serverEd25519Fingerprint',
]);

function normalizeAuthCredentials(value: unknown): AuthCredentials | null {
    if (!value || typeof value !== 'object') {
        return null;
    }
    const candidate = value as Partial<AuthCredentials> & Record<string, unknown>;
    if (typeof candidate.machineId !== 'string'
        || typeof candidate.tunnelUrl !== 'string'
        || typeof candidate.firstSeenAt !== 'number') {
        return null;
    }
    if (isOldShape(candidate)) {
        return null;
    }
    const authMode = candidate.authMode === 'dev-tunnel' || candidate.authMode === 'paired-device'
        ? candidate.authMode
        : hasAnyPairedDeviceField(candidate)
            ? 'paired-device'
            : 'dev-tunnel';
    if (authMode !== 'paired-device') {
        return null;
    }
    if ((candidate.authMode !== undefined && candidate.authMode !== 'dev-tunnel' && candidate.authMode !== 'paired-device')
        || (candidate.login !== undefined && typeof candidate.login !== 'string')
        || (candidate.avatarUrl !== undefined && typeof candidate.avatarUrl !== 'string')
        || (candidate.deviceCode !== undefined && typeof candidate.deviceCode !== 'string')
        || (candidate.deviceCodeExpiresAt !== undefined && typeof candidate.deviceCodeExpiresAt !== 'number')
        || (candidate.connectToken !== undefined && typeof candidate.connectToken !== 'string')
        || (candidate.connectTokenExpiry !== undefined && typeof candidate.connectTokenExpiry !== 'number')
        || (candidate.tunnelId !== undefined && typeof candidate.tunnelId !== 'string')
        || (candidate.cloudflareAccessClientId !== undefined && typeof candidate.cloudflareAccessClientId !== 'string')
        || (candidate.cloudflareAccessClientSecret !== undefined && typeof candidate.cloudflareAccessClientSecret !== 'string')
        || (candidate.deviceKeyId !== undefined && typeof candidate.deviceKeyId !== 'string')
        || (candidate.devicePublicKey !== undefined && typeof candidate.devicePublicKey !== 'string')
        || (candidate.deviceSecretKey !== undefined && typeof candidate.deviceSecretKey !== 'string')
        || (candidate.serverEd25519PublicKey !== undefined && typeof candidate.serverEd25519PublicKey !== 'string')
        || (candidate.serverEd25519Fingerprint !== undefined && typeof candidate.serverEd25519Fingerprint !== 'string')) {
        return null;
    }
    const normalized: Record<string, unknown> = {};
    for (const key of Object.keys(candidate)) {
        if (AUTH_CREDENTIALS_KEYS.has(key)) {
            normalized[key] = candidate[key];
        }
    }
    normalized.authMode = authMode;
    return normalized as unknown as AuthCredentials;
}

function hasAnyPairedDeviceField(candidate: Partial<AuthCredentials>): boolean {
    return candidate.cloudflareAccessClientId !== undefined
        || candidate.cloudflareAccessClientSecret !== undefined
        || candidate.deviceKeyId !== undefined
        || candidate.devicePublicKey !== undefined
        || candidate.deviceSecretKey !== undefined;
}

export function isOldShape(credentials: Partial<AuthCredentials> | (Partial<AuthCredentials> & Record<string, unknown>)): boolean {
    const candidate = credentials as Partial<AuthCredentials> & Record<string, unknown>;
    return Boolean(candidate.pinnedPubkey) || Boolean(candidate.sessionKey);
}

function parseStoredCredentials(stored: string | null): StoredMachineCredentials | null {
    if (!stored) {
        return null;
    }
    let parsed: AuthCredentials | StoredMachineCredentials;
    try {
        parsed = JSON.parse(stored) as AuthCredentials | StoredMachineCredentials;
    } catch {
        return null;
    }
    if (isStoredMachineCredentials(parsed)) {
        return {
            primaryMachineId: parsed.primaryMachineId,
            machines: parsed.machines.map(normalizeAuthCredentials).filter((m): m is AuthCredentials => m !== null),
            devTunnelsAccess: parsed.devTunnelsAccess ?? null,
        };
    }
    return null;
}

function serializeCredentials(credentials: StoredMachineCredentials): string {
    return JSON.stringify(credentials);
}

function filterOldShapeCredentials(credentials: StoredMachineCredentials): StoredMachineCredentials {
    const machines = credentials.machines
        .filter(machine => !isOldShape(machine as Partial<AuthCredentials> & Record<string, unknown>))
        .filter(machine => machine.authMode === 'paired-device')
        .map(machine => ({
            authMode: 'paired-device' as const,
            machineId: machine.machineId,
            tunnelUrl: machine.tunnelUrl,
            firstSeenAt: machine.firstSeenAt,
            ...(machine.cloudflareAccessClientId ? { cloudflareAccessClientId: machine.cloudflareAccessClientId } : {}),
            ...(machine.cloudflareAccessClientSecret ? { cloudflareAccessClientSecret: machine.cloudflareAccessClientSecret } : {}),
            ...(machine.deviceKeyId ? { deviceKeyId: machine.deviceKeyId } : {}),
            ...(machine.devicePublicKey ? { devicePublicKey: machine.devicePublicKey } : {}),
            ...(machine.deviceSecretKey ? { deviceSecretKey: machine.deviceSecretKey } : {}),
            ...(machine.serverEd25519PublicKey ? { serverEd25519PublicKey: machine.serverEd25519PublicKey } : {}),
            ...(machine.serverEd25519Fingerprint ? { serverEd25519Fingerprint: machine.serverEd25519Fingerprint } : {}),
        }));
    const primaryMachineId = credentials.primaryMachineId && machines.some(machine => machine.machineId === credentials.primaryMachineId)
        ? credentials.primaryMachineId
        : machines[0]?.machineId ?? null;
    return {
        primaryMachineId,
        machines,
        devTunnelsAccess: null,
    };
}

function credentialsChanged(a: StoredMachineCredentials, b: StoredMachineCredentials): boolean {
    return serializeCredentials(a) !== serializeCredentials(b);
}

export const TokenStorage = {
    async getCredentials(): Promise<AuthCredentials | null> {
        const stored = await this.getStoredCredentials();
        if (!stored) {
            return null;
        }
        return stored.machines.find(machine => machine.machineId === stored.primaryMachineId) ?? stored.machines[0] ?? null;
    },

    async getCredentialsList(): Promise<AuthCredentials[]> {
        const stored = await this.getStoredCredentials();
        return stored?.machines ?? [];
    },

    async getUsableCredentials(): Promise<AuthCredentials | null> {
        const stored = await this.getStoredCredentials();
        if (!stored) {
            return null;
        }
        const primary = stored.machines.find(machine => machine.machineId === stored.primaryMachineId);
        if (primary && isUsableAuthCredentials(primary)) {
            return primary;
        }
        return stored.machines.find(isUsableAuthCredentials) ?? null;
    },

    async getUsableCredentialsList(): Promise<AuthCredentials[]> {
        const stored = await this.getStoredCredentials();
        if (!stored) {
            return [];
        }
        const usable = stored.machines.filter(isUsableAuthCredentials);
        const primaryIndex = usable.findIndex(machine => machine.machineId === stored.primaryMachineId);
        if (primaryIndex <= 0) {
            return usable;
        }
        return [
            usable[primaryIndex]!,
            ...usable.slice(0, primaryIndex),
            ...usable.slice(primaryIndex + 1),
        ];
    },

    async getStoredCredentials(): Promise<StoredMachineCredentials | null> {
        const migrate = async (stored: StoredMachineCredentials | null): Promise<StoredMachineCredentials | null> => {
            if (!stored) {
                return null;
            }
            const filtered = filterOldShapeCredentials(stored);
            if (credentialsChanged(stored, filtered)) {
                await this.writeStoredCredentials(filtered);
            }
            return filtered;
        };

        if (Platform.OS === 'web') {
            const stored = localStorage.getItem(AUTH_KEY);
            return migrate(parseStoredCredentials(stored));
        }
        try {
            const stored = await SecureStore.getItemAsync(AUTH_KEY);
            return migrate(parseStoredCredentials(stored));
        } catch (error) {
            console.error('Error getting credentials:', error);
            return null;
        }
    },

    async setCredentials(credentials: AuthCredentials): Promise<boolean> {
        const normalized = normalizeAuthCredentials(credentials);
        if (!normalized) {
            return false;
        }
        const existing = await this.getStoredCredentials();
        const machines = existing?.machines.filter(machine => machine.machineId !== normalized.machineId) ?? [];
        machines.push(normalized);
        const next: StoredMachineCredentials = {
            primaryMachineId: normalized.machineId,
            machines,
            devTunnelsAccess: existing?.devTunnelsAccess ?? null,
        };
        return await this.writeStoredCredentials(next);
    },

    async updateMachineCredentials(machineId: string, patch: Partial<AuthCredentials>): Promise<boolean> {
        const existing = await this.getStoredCredentials();
        if (!existing) {
            return false;
        }
        let found = false;
        const machines: AuthCredentials[] = [];
        for (const machine of existing.machines) {
            if (machine.machineId !== machineId) {
                machines.push(machine);
                continue;
            }
            found = true;
            const merged = normalizeAuthCredentials({ ...machine, ...patch });
            if (!merged) {
                return false;
            }
            machines.push(merged);
        }
        if (!found) {
            return false;
        }
        return await this.writeStoredCredentials({
            primaryMachineId: existing.primaryMachineId,
            machines,
            devTunnelsAccess: existing.devTunnelsAccess,
        });
    },

    async removeMachineCredentials(machineId: string): Promise<boolean> {
        const existing = await this.getStoredCredentials();
        if (!existing) {
            return true;
        }
        const machines = existing.machines.filter(machine => machine.machineId !== machineId);
        const primaryMachineId = existing.primaryMachineId === machineId
            ? machines[0]?.machineId ?? null
            : existing.primaryMachineId;
        return await this.writeStoredCredentials({
            primaryMachineId,
            machines,
            devTunnelsAccess: existing.devTunnelsAccess,
        });
    },

    async setDevTunnelsToken(token: string): Promise<void> {
        void token;
        const existing = await this.getStoredCredentials();
        await this.writeStoredCredentials({
            primaryMachineId: existing?.primaryMachineId ?? null,
            machines: existing?.machines ?? [],
            devTunnelsAccess: null,
        });
    },

    async getDevTunnelsToken(): Promise<string | null> {
        const existing = await this.getStoredCredentials();
        return existing?.devTunnelsAccess ?? null;
    },

    async writeStoredCredentials(credentials: StoredMachineCredentials): Promise<boolean> {
        if (Platform.OS === 'web') {
            localStorage.setItem(AUTH_KEY, serializeCredentials(credentials));
            return true;
        }
        try {
            await SecureStore.setItemAsync(AUTH_KEY, serializeCredentials(credentials));
            return true;
        } catch (error) {
            console.error('Error setting credentials:', error);
            return false;
        }
    },

    async removeCredentials(): Promise<boolean> {
        if (Platform.OS === 'web') {
            localStorage.removeItem(AUTH_KEY);
            return true;
        }
        try {
            await SecureStore.deleteItemAsync(AUTH_KEY);
            return true;
        } catch (error) {
            console.error('Error removing credentials:', error);
            return false;
        }
    },
};
