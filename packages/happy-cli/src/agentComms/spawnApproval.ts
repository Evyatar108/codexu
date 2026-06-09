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
}).strict().refine(
    body => body.cwd === undefined || body.path === undefined || body.cwd === body.path,
    { message: 'spawn-request carries conflicting cwd and path values', path: ['path'] },
);

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

interface InflightSpawnRecord {
    envelopeId: string;
    correlationId?: string;
    reservedAt: string;
}

interface CompletedSpawnRecord {
    envelopeId: string;
    correlationId?: string;
    completedAt: string;
    spawnResult: SpawnSessionResult;
    // Set once outbound spawn-result delivery succeeds. The terminal record is
    // persisted right after a successful spawn (before delivery), so a record
    // can durably exist with delivery still pending; a retry then re-delivers.
    deliveryAck?: AgentCommsDeliveryAck;
}

interface SpawnApprovalStore {
    version: 1;
    pending: PendingSpawnRecord[];
    inflight: InflightSpawnRecord[];
    completed: CompletedSpawnRecord[];
}

const STORE_VERSION = 1 as const;
const LOCK_STALE_MS = 15_000;
const LOCK_ACQUIRE_TIMEOUT_MS = 5_000;
// A persisted reservation older than this is treated as abandoned (e.g. the
// reserving process crashed mid-spawn), so a fresh request may re-run.
const INFLIGHT_STALE_MS = 300_000;
const storeChains = new Map<string, Promise<unknown>>();
// In-process registry of running spawns keyed by happyHomeDir + dedupe key.
// Lets a mid-flight retry observe and return the in-flight result without
// re-acquiring the cross-process lock or spawning a second child.
const inflightSpawns = new Map<string, Promise<AgentCommsDeliveryAck>>();

export function pendingSpawnsPath(happyHomeDir: string): string {
    return path.join(happyHomeDir, 'agent-comms', 'pending-spawns.json');
}

function emptyStore(): SpawnApprovalStore {
    return { version: STORE_VERSION, pending: [], inflight: [], completed: [] };
}

async function readStore(happyHomeDir: string): Promise<SpawnApprovalStore> {
    try {
        const parsed = JSON.parse(await fs.readFile(pendingSpawnsPath(happyHomeDir), 'utf8')) as Partial<SpawnApprovalStore>;
        return {
            version: STORE_VERSION,
            pending: parsed.pending ?? [],
            inflight: parsed.inflight ?? [],
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

function spawnKeyMatches(record: { envelopeId: string; correlationId?: string }, envelope: AgentCommsEnvelope): boolean {
    return record.envelopeId === envelope.id
        || (Boolean(envelope.correlationId) && record.correlationId === envelope.correlationId);
}

function isActiveInflight(record: InflightSpawnRecord, now: Date): boolean {
    return now.getTime() - new Date(record.reservedAt).getTime() < INFLIGHT_STALE_MS;
}

function inflightKey(happyHomeDir: string, envelope: AgentCommsEnvelope): string {
    return `${happyHomeDir}::${envelope.correlationId ?? envelope.id}`;
}

interface SpawnDeferred {
    promise: Promise<AgentCommsDeliveryAck>;
    resolve: (ack: AgentCommsDeliveryAck) => void;
    reject: (error: unknown) => void;
}

function createDeferred(): SpawnDeferred {
    let resolve!: (ack: AgentCommsDeliveryAck) => void;
    let reject!: (error: unknown) => void;
    const promise = new Promise<AgentCommsDeliveryAck>((res, rej) => { resolve = res; reject = rej; });
    return { promise, resolve, reject };
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

function spawnResultDeliveryBody(envelope: AgentCommsEnvelope, spawnResult: SpawnSessionResult): unknown {
    return {
        type: 'spawn-result',
        ok: spawnResult.type === 'success',
        requestId: envelope.id,
        correlationId: envelope.correlationId,
        result: spawnResult,
    };
}

interface SpawnApprovalOptions {
    happyHomeDir: string;
    localMachineId: string;
    pinnedPeer: PinnedPeerKeys;
    spawnSessionFromSession: (options: SpawnSessionFromSessionRpcOptions) => Promise<SpawnSessionResult>;
    deliverRemote: (envelope: AgentCommsEnvelope) => Promise<AgentCommsDeliveryAck>;
    now?: () => Date;
}

type SpawnPlan =
    | { type: 'completed'; record: CompletedSpawnRecord }
    | { type: 'denied' }
    | { type: 'await-local'; promise: Promise<AgentCommsDeliveryAck> }
    | { type: 'remote-inflight' }
    | { type: 'reserved'; deferred: SpawnDeferred };

// Persists the successful delivery ack onto an already-terminal completed
// record so a later retry can short-circuit to the stored ack rather than
// re-delivering. No-op if the record is gone or already carries an ack.
async function recordDeliveryAck(happyHomeDir: string, envelope: AgentCommsEnvelope, deliveryAck: AgentCommsDeliveryAck): Promise<void> {
    await runExclusive(happyHomeDir, async () => {
        const store = await readStore(happyHomeDir);
        const record = store.completed.find(r => spawnKeyMatches(r, envelope));
        if (record && !record.deliveryAck) {
            record.deliveryAck = deliveryAck;
            await writeStore(happyHomeDir, store);
        }
    });
}

// Runs the long spawn + delivery WITHOUT holding the approval-store lock. On a
// successful spawn the terminal completed record (carrying the spawn outcome) is
// persisted BEFORE delivery is attempted, so a delivery failure can never drop
// it: a retry of the same envelope/correlationId returns (and may re-deliver)
// the recorded result without spawning a second child. Only an actual spawn
// failure clears the reservation, allowing a future retry to spawn again. The
// deferred mirrors the result to any concurrent in-process retry waiting on the
// same dedupe key.
function executeReservedSpawn(envelope: AgentCommsEnvelope, options: SpawnApprovalOptions, now: () => Date, key: string, deferred: SpawnDeferred): void {
    void (async () => {
        try {
            let spawnResult: SpawnSessionResult;
            try {
                const body = spawnRequestBodySchema.parse(envelope.body);
                spawnResult = await options.spawnSessionFromSession(mapSpawnRequestToRpc(envelope, body));
            } catch (error) {
                spawnResult = { type: 'error', errorMessage: error instanceof Error ? error.message : String(error) };
            }

            if (spawnResult.type !== 'success') {
                // The spawn did not produce a child, so this is NOT terminal: clear
                // the reservation so a future retry may re-attempt the spawn. Still
                // deliver the error result to the caller.
                const deliveryAck = await sendSpawnResult(envelope, options.localMachineId, spawnResultDeliveryBody(envelope, spawnResult), options.deliverRemote);
                await runExclusive(options.happyHomeDir, async () => {
                    const store = await readStore(options.happyHomeDir);
                    store.inflight = store.inflight.filter(record => !spawnKeyMatches(record, envelope));
                    await writeStore(options.happyHomeDir, store);
                });
                deferred.resolve(deliveryAck);
                return;
            }

            // Spawn SUCCEEDED: persist the terminal completed record and release the
            // reservation BEFORE attempting delivery. From here on a delivery failure
            // must not drop the completed record.
            await runExclusive(options.happyHomeDir, async () => {
                const store = await readStore(options.happyHomeDir);
                store.inflight = store.inflight.filter(record => !spawnKeyMatches(record, envelope));
                if (!store.completed.some(record => spawnKeyMatches(record, envelope))) {
                    store.completed.push({
                        envelopeId: envelope.id,
                        correlationId: envelope.correlationId,
                        completedAt: now().toISOString(),
                        spawnResult,
                    });
                }
                await writeStore(options.happyHomeDir, store);
            });

            const deliveryAck = await sendSpawnResult(envelope, options.localMachineId, spawnResultDeliveryBody(envelope, spawnResult), options.deliverRemote);
            await recordDeliveryAck(options.happyHomeDir, envelope, deliveryAck);
            deferred.resolve(deliveryAck);
        } catch (error) {
            // Reached only when delivery (or ack persistence) threw. Any terminal
            // completed record written for a successful spawn is intentionally left
            // in place; only the inflight reservation is released so the registry
            // doesn't leak. A retry returns/re-delivers the recorded result.
            try {
                await runExclusive(options.happyHomeDir, async () => {
                    const store = await readStore(options.happyHomeDir);
                    store.inflight = store.inflight.filter(record => !spawnKeyMatches(record, envelope));
                    await writeStore(options.happyHomeDir, store);
                });
            } catch { /* best-effort reservation release */ }
            deferred.reject(error);
        } finally {
            if (inflightSpawns.get(key) === deferred.promise) inflightSpawns.delete(key);
        }
    })();
}

export async function handleInboundSpawnRequest(
    envelope: AgentCommsEnvelope,
    options: SpawnApprovalOptions,
): Promise<AgentCommsDeliveryAck> {
    if (envelope.channel !== 'spawn' || envelope.kind !== 'spawn-request') {
        throw new Error(`agent-comms spawn approval only handles spawn-request envelopes, got ${envelope.channel}/${envelope.kind}`);
    }
    const now = options.now ?? (() => new Date());
    const key = inflightKey(options.happyHomeDir, envelope);

    // Critical section: dedupe against completed work and atomically reserve the
    // key. The lock is released before the long spawn/delivery runs so a
    // mid-flight retry never blocks on it until LOCK_ACQUIRE_TIMEOUT_MS.
    const plan = await runExclusive(options.happyHomeDir, async (): Promise<SpawnPlan> => {
        const store = await readStore(options.happyHomeDir);
        const prior = store.completed.find(record => spawnKeyMatches(record, envelope));
        if (prior) return { type: 'completed', record: prior };

        if (!options.pinnedPeer.approvedForSpawn) {
            if (!store.pending.some(record => spawnKeyMatches(record, envelope))) {
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
            return { type: 'denied' };
        }

        const localInflight = inflightSpawns.get(key);
        if (localInflight) return { type: 'await-local', promise: localInflight };

        if (store.inflight.some(record => spawnKeyMatches(record, envelope) && isActiveInflight(record, now()))) {
            return { type: 'remote-inflight' };
        }

        store.inflight = store.inflight.filter(record => !spawnKeyMatches(record, envelope) && isActiveInflight(record, now()));
        store.inflight.push({ envelopeId: envelope.id, correlationId: envelope.correlationId, reservedAt: now().toISOString() });
        await writeStore(options.happyHomeDir, store);

        const deferred = createDeferred();
        inflightSpawns.set(key, deferred.promise);
        return { type: 'reserved', deferred };
    });

    switch (plan.type) {
        case 'completed': {
            // A terminal record exists. If delivery already succeeded, return the
            // stored ack. Otherwise the original attempt's delivery failed after the
            // spawn — re-deliver the recorded result WITHOUT spawning again.
            if (plan.record.deliveryAck) return plan.record.deliveryAck;
            const deliveryAck = await sendSpawnResult(envelope, options.localMachineId, spawnResultDeliveryBody(envelope, plan.record.spawnResult), options.deliverRemote);
            await recordDeliveryAck(options.happyHomeDir, envelope, deliveryAck);
            return deliveryAck;
        }
        case 'await-local':
            return plan.promise;
        case 'denied':
            return sendSpawnResult(envelope, options.localMachineId, {
                type: 'spawn-result',
                ok: false,
                requestId: envelope.id,
                correlationId: envelope.correlationId,
                requiresOperatorApproval: true,
                error: `Peer ${envelope.from.machineId} is not approved for remote spawn.`,
            }, options.deliverRemote);
        case 'remote-inflight':
            return sendSpawnResult(envelope, options.localMachineId, {
                type: 'spawn-result',
                ok: false,
                requestId: envelope.id,
                correlationId: envelope.correlationId,
                inProgress: true,
                error: `Spawn for ${envelope.correlationId ?? envelope.id} is already in progress.`,
            }, options.deliverRemote);
        case 'reserved':
            executeReservedSpawn(envelope, options, now, key, plan.deferred);
            return plan.deferred.promise;
    }
}
