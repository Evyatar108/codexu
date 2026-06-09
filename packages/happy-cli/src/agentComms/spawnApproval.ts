import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { writeJsonAtomically } from '@slopus/happy-wire/node';
import { z } from 'zod';
import type { AgentCommsEnvelope } from '@slopus/happy-wire';
import type { SpawnSessionFromSessionRpcOptions } from '@/api/apiMachine';
import type { SpawnSessionResult, SupportedAgent } from '@/modules/common/registerCommonHandlers';
import type { PinnedPeerKeys } from './peerAuth';
import { createAgentCommsEnvelope, type AgentCommsDeliveryAck } from './router';

const spawnRequestBodySchema = z.object({
    agent: z.enum(['claude', 'codex', 'gemini', 'openclaw']),
    cwd: z.string().min(1).optional(),
    path: z.string().min(1).optional(),
    role: z.string().min(1).optional(),
    plugins: z.array(z.string().min(1)).optional(),
    initialMessage: z.string().optional(),
    model: z.string().min(1).optional(),
    permissionMode: z.string().min(1).optional(),
    effortLevel: z.string().min(1).optional(),
}).strict();

export type AgentCommsSpawnRequestBody = z.infer<typeof spawnRequestBodySchema>;

interface PendingSpawnRecord {
    envelopeId: string;
    correlationId?: string;
    fromMachineId: string;
    fromSessionId: string;
    targetSessionId: string;
    receivedAt: string;
    reason: string;
    body: unknown;
}

interface CompletedSpawnRecord {
    envelopeId: string;
    correlationId?: string;
    completedAt: string;
    spawnResult: SpawnSessionResult;
    deliveryAck: AgentCommsDeliveryAck;
}

interface SpawnApprovalStore {
    version: 1;
    pending: PendingSpawnRecord[];
    completed: CompletedSpawnRecord[];
}

const STORE_VERSION = 1 as const;
const LOCK_STALE_MS = 15_000;
const LOCK_ACQUIRE_TIMEOUT_MS = 5_000;
const storeChains = new Map<string, Promise<unknown>>();

export function pendingSpawnsPath(happyHomeDir: string): string {
    return path.join(happyHomeDir, 'agent-comms', 'pending-spawns.json');
}

function emptyStore(): SpawnApprovalStore {
    return { version: STORE_VERSION, pending: [], completed: [] };
}

async function readStore(happyHomeDir: string): Promise<SpawnApprovalStore> {
    try {
        const parsed = JSON.parse(await fs.readFile(pendingSpawnsPath(happyHomeDir), 'utf8')) as Partial<SpawnApprovalStore>;
        return {
            version: STORE_VERSION,
            pending: parsed.pending ?? [],
            completed: parsed.completed ?? [],
        };
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return emptyStore();
        throw error;
    }
}

async function writeStore(happyHomeDir: string, store: SpawnApprovalStore): Promise<void> {
    const file = pendingSpawnsPath(happyHomeDir);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await writeJsonAtomically(file, store);
}

function lockPath(happyHomeDir: string): string {
    return `${pendingSpawnsPath(happyHomeDir)}.lock`;
}

async function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function withStoreLock<T>(happyHomeDir: string, fn: () => Promise<T>): Promise<T> {
    await fs.mkdir(path.dirname(pendingSpawnsPath(happyHomeDir)), { recursive: true });
    const lock = lockPath(happyHomeDir);
    const deadline = Date.now() + LOCK_ACQUIRE_TIMEOUT_MS;
    let handle: fs.FileHandle;
    for (;;) {
        try {
            handle = await fs.open(lock, 'wx');
            break;
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
            try {
                const st = await fs.stat(lock);
                if (Date.now() - st.mtimeMs > LOCK_STALE_MS) {
                    const tombstone = `${lock}.stale.${process.pid}.${Math.random().toString(36).slice(2, 10)}`;
                    try {
                        await fs.rename(lock, tombstone);
                        await fs.rm(tombstone, { force: true });
                    } catch {
                        // Another contender claimed the stale lock.
                    }
                    continue;
                }
            } catch {
                continue;
            }
            if (Date.now() > deadline) {
                throw new Error('agent-comms spawn approval store lock timed out');
            }
            await sleep(15 + Math.floor(Math.random() * 25));
        }
    }
    try {
        return await fn();
    } finally {
        try { await handle.close(); } catch { /* already closed */ }
        try { await fs.rm(lock, { force: true }); } catch { /* already removed */ }
    }
}

function runExclusive<T>(happyHomeDir: string, fn: () => Promise<T>): Promise<T> {
    const prior = storeChains.get(happyHomeDir) ?? Promise.resolve();
    const run = prior.catch(() => undefined).then(() => withStoreLock(happyHomeDir, fn));
    storeChains.set(happyHomeDir, run.catch(() => undefined));
    return run;
}

function dedupeKeyMatches(record: CompletedSpawnRecord, envelope: AgentCommsEnvelope): boolean {
    return record.envelopeId === envelope.id
        || (Boolean(envelope.correlationId) && record.correlationId === envelope.correlationId);
}

function mapSpawnRequestToRpc(envelope: AgentCommsEnvelope, body: AgentCommsSpawnRequestBody): SpawnSessionFromSessionRpcOptions {
    return {
        parentSessionId: envelope.to.sessionId,
        config: {
            agent: body.agent as SupportedAgent,
            path: body.cwd ?? body.path,
            model: body.model,
            permissionMode: body.permissionMode,
            effortLevel: body.effortLevel,
            initialMessage: body.initialMessage,
        },
    };
}

async function sendSpawnResult(
    request: AgentCommsEnvelope,
    localMachineId: string,
    body: unknown,
    deliverRemote: (envelope: AgentCommsEnvelope) => Promise<AgentCommsDeliveryAck>,
): Promise<AgentCommsDeliveryAck> {
    return deliverRemote(createAgentCommsEnvelope({
        from: { machineId: localMachineId, sessionId: request.to.sessionId },
        to: { machineId: request.from.machineId, sessionId: request.from.sessionId },
        channel: 'spawn',
        kind: 'spawn-result',
        correlationId: request.correlationId ?? request.id,
        body,
    }, {
        selfMachineId: localMachineId,
        hasLocalSession: () => true,
    }));
}

export async function handleInboundSpawnRequest(
    envelope: AgentCommsEnvelope,
    options: {
        happyHomeDir: string;
        localMachineId: string;
        pinnedPeer: PinnedPeerKeys;
        spawnSessionFromSession: (options: SpawnSessionFromSessionRpcOptions) => Promise<SpawnSessionResult>;
        deliverRemote: (envelope: AgentCommsEnvelope) => Promise<AgentCommsDeliveryAck>;
        now?: () => Date;
    },
): Promise<AgentCommsDeliveryAck> {
    if (envelope.channel !== 'spawn' || envelope.kind !== 'spawn-request') {
        throw new Error(`agent-comms spawn approval only handles spawn-request envelopes, got ${envelope.channel}/${envelope.kind}`);
    }
    const now = options.now ?? (() => new Date());

    return runExclusive(options.happyHomeDir, async () => {
        const store = await readStore(options.happyHomeDir);
        const prior = store.completed.find(record => dedupeKeyMatches(record, envelope));
        if (prior) return prior.deliveryAck;

        if (!options.pinnedPeer.approvedForSpawn) {
            if (!store.pending.some(record => record.envelopeId === envelope.id || (envelope.correlationId && record.correlationId === envelope.correlationId))) {
                store.pending.push({
                    envelopeId: envelope.id,
                    correlationId: envelope.correlationId,
                    fromMachineId: envelope.from.machineId,
                    fromSessionId: envelope.from.sessionId,
                    targetSessionId: envelope.to.sessionId,
                    receivedAt: now().toISOString(),
                    reason: 'sender peer is not approvedForSpawn',
                    body: envelope.body,
                });
                await writeStore(options.happyHomeDir, store);
            }
            return sendSpawnResult(envelope, options.localMachineId, {
                type: 'spawn-result',
                ok: false,
                requestId: envelope.id,
                correlationId: envelope.correlationId,
                requiresOperatorApproval: true,
                error: `Peer ${envelope.from.machineId} is not approved for remote spawn.`,
            }, options.deliverRemote);
        }

        let spawnResult: SpawnSessionResult;
        try {
            const body = spawnRequestBodySchema.parse(envelope.body);
            spawnResult = await options.spawnSessionFromSession(mapSpawnRequestToRpc(envelope, body));
        } catch (error) {
            spawnResult = { type: 'error', errorMessage: error instanceof Error ? error.message : String(error) };
        }

        const deliveryAck = await sendSpawnResult(envelope, options.localMachineId, {
            type: 'spawn-result',
            ok: spawnResult.type === 'success',
            requestId: envelope.id,
            correlationId: envelope.correlationId,
            result: spawnResult,
        }, options.deliverRemote);

        store.completed.push({
            envelopeId: envelope.id,
            correlationId: envelope.correlationId,
            completedAt: now().toISOString(),
            spawnResult,
            deliveryAck,
        });
        await writeStore(options.happyHomeDir, store);
        return deliveryAck;
    });
}
