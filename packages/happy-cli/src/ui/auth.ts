import { randomBytes, randomUUID } from 'node:crypto';
import { chmod, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { applyOwnerOnlyPerms, writeJsonAtomically } from '@slopus/happy-wire/node';
import tweetnacl from 'tweetnacl';

import { configuration } from '@/configuration';
import {
    type Credentials,
    readCredentials,
    updateSettings,
    writeCredentialsDataKey,
    writeCredentialsLegacy,
} from '@/persistence';
import { logger } from './logger';

const GITHUB_BOOTSTRAP_TOKEN_PREFIXES = ['ghu_', 'gho_', 'ghp_', 'github_pat_'];

export async function doAuth(): Promise<Credentials | null> {
    try {
        const existingCredentials = await readCredentials();
        const token = shouldReplaceBootstrapToken(existingCredentials?.token)
            ? createLocalCompatibilityToken()
            : existingCredentials?.token ?? createLocalCompatibilityToken();
        return await persistLocalCredentials(token, existingCredentials);
    } catch (error) {
        logger.warn(`Local credential bootstrap failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
        return null;
    }
}

export function shouldReplaceBootstrapToken(token: string | undefined): boolean {
    return token !== undefined && GITHUB_BOOTSTRAP_TOKEN_PREFIXES.some(prefix => token.startsWith(prefix));
}

export function createLocalCompatibilityToken(): string {
    return `happy-local-v1_${randomBytes(32).toString('base64url')}`;
}

async function persistLocalCredentials(token: string, existingCredentials: Credentials | null): Promise<Credentials> {
    if (existingCredentials?.encryption.type === 'legacy') {
        if (existingCredentials.token === token) {
            return existingCredentials;
        }
        await writeCredentialsLegacy({ secret: existingCredentials.encryption.secret, token });
        return { token, encryption: existingCredentials.encryption };
    }
    if (existingCredentials?.encryption.type === 'dataKey') {
        if (existingCredentials.token === token) {
            return existingCredentials;
        }
        await writeCredentialsDataKey({
            publicKey: existingCredentials.encryption.publicKey,
            machineKey: existingCredentials.encryption.machineKey,
            token,
        });
        return { token, encryption: existingCredentials.encryption };
    }

    const keypair = tweetnacl.box.keyPair();
    await writeCredentialsDataKey({ publicKey: keypair.publicKey, machineKey: keypair.secretKey, token });
    return {
        token,
        encryption: {
            type: 'dataKey',
            publicKey: keypair.publicKey,
            machineKey: keypair.secretKey,
        },
    };
}

async function migrateLocalProfile(machineId: string): Promise<void> {
    try {
        const existing = JSON.parse(await readFile(configuration.localProfileFile, 'utf8')) as {
            version?: unknown;
            id?: unknown;
            github?: unknown;
        };
        if (existing.version === 1 && existing.id === machineId && existing.github === null) {
            return;
        }
    } catch {
        // Missing or invalid canonical profile falls through to one-time migration.
    }
    let displayName: string | null = null;
    try {
        const legacy = JSON.parse(
            await readFile(join(configuration.happyHomeDir, 'profile.json'), 'utf8'),
        ) as { name?: unknown };
        displayName = typeof legacy.name === 'string' && legacy.name.trim() ? legacy.name.trim() : null;
    } catch {
        // A legacy GitHub-shaped profile is optional migration input only.
    }
    const [firstName, ...lastNameParts] = displayName?.split(/\s+/) ?? [];
    await writeJsonAtomically(configuration.localProfileFile, {
        version: 1,
        id: machineId,
        timestamp: Date.now(),
        firstName: firstName ?? null,
        lastName: lastNameParts.length > 0 ? lastNameParts.join(' ') : null,
        avatar: null,
        github: null,
        connectedServices: [],
    });
}

async function ensureServerStorageKey(): Promise<void> {
    try {
        await readFile(configuration.serverStorageKeyFile);
        if (process.platform === 'win32') {
            await applyOwnerOnlyPerms(configuration.serverStorageKeyFile);
        } else {
            await chmod(configuration.serverStorageKeyFile, 0o600);
        }
        return;
    } catch {
        // First start creates an owner-only key unrelated to the public server key.
    }
    try {
        await writeFile(
            configuration.serverStorageKeyFile,
            `${randomBytes(32).toString('base64')}\n`,
            { flag: 'wx', mode: 0o600 },
        );
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
            throw error;
        }
    }
    if (process.platform !== 'win32') {
        await chmod(configuration.serverStorageKeyFile, 0o600);
    } else {
        await applyOwnerOnlyPerms(configuration.serverStorageKeyFile);
    }
}

async function archiveRetiredDevTunnelState(): Promise<void> {
    const legacyPath = join(configuration.happyHomeDir, 'tunnel.json');
    try {
        await rename(legacyPath, `${legacyPath}.retired`);
    } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code === 'EEXIST') {
            await unlink(legacyPath);
            return;
        }

        if (code !== 'ENOENT') {
            throw error;
        }
    }
}

async function removeStalePairingInvite(): Promise<void> {
    await unlink(configuration.publicPairingInviteFile).catch(error => {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
            throw error;
        }
    });
}

/**
 * Creates or migrates the local-only compatibility credential and stable
 * machine identity without making any network request.
 */
export async function authAndSetupMachineIfNeeded(): Promise<{
    credentials: Credentials;
    machineId: string;
}> {
    logger.debug('[AUTH] Starting offline local bootstrap...');

    let credentials = await readCredentials();
    if (!credentials || shouldReplaceBootstrapToken(credentials.token)) {
        credentials = await doAuth();
        if (!credentials) {
            throw new Error('Local credential bootstrap failed');
        }
    }

    const settings = await updateSettings(async current => current.machineId
        ? current
        : { ...current, machineId: randomUUID() });
    const machineId = settings.machineId!;

    await Promise.all([
        migrateLocalProfile(machineId),
        ensureServerStorageKey(),
        archiveRetiredDevTunnelState(),
        removeStalePairingInvite(),
    ]);
    logger.debug(`[AUTH] Offline local bootstrap complete for machine ${machineId}`);
    return { credentials, machineId };
}
