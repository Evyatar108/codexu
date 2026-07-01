/**
 * Durable mailbox primitive for cross-session agent-comms messages.
 *
 * This module is the durable substrate for the "Durable mailbox + channel wake"
 * pattern (plans/durable-mailbox-channel-wake.md). It is intentionally NOT a
 * reuse of:
 *  - the crews-plugin mailbox (CommonJS, in a sibling git submodule, and
 *    in-memory; would not survive a daemon restart and creates a CJS/ESM
 *    boundary across happy-cli);
 *  - codex multi_agents_v2 input_queue (in-memory `watch::Receiver<()>` +
 *    `VecDeque<InterAgentCommunication>`; also non-durable, and lives in the
 *    Rust submodule that this project may not edit).
 *
 * Contract:
 *  - Inboxes live under `<happyHomeDir>/agent-comms/inboxes/<sessionId>/`,
 *    rooted via `configuration.happyHomeDir` and NEVER keyed by cwd.
 *  - `mailbox.json` carries the cursor + the current pending list and is
 *    always written via `writeJsonAtomically` from `@slopus/happy-wire/node`.
 *  - `history.jsonl` is an append-only, one-JSON-line-per-entry audit log.
 *  - Every persisted entry carries a top-level `version: 1` (Northstar rule 1:
 *    versioned envelope). `readPending` throws a typed
 *    `MailboxUnsupportedVersionError` when it observes an entry whose
 *    `version` is greater than the consumer's known max (currently 1).
 *  - Addresses on the wire are logical `sessionId` handles only (Northstar
 *    rule 2). No filesystem path is ever the destination identity.
 *  - `sessionId` is validated against `SESSION_ID_REGEX` before any path is
 *    constructed (soft-cap F-010), so a malicious or buggy id (`../etc`,
 *    slashes, backslashes, oversized) cannot become a path component.
 *  - Consumption invariant: `markConsumed` MUST run only AFTER a successful
 *    drain of the corresponding payload by the caller (the bridge resource
 *    read in US-003); the watcher / wake path NEVER calls `markConsumed`.
 *  - `readPending` is retry-tolerant: it retries up to 3x with linear
 *    backoff on `EBUSY` to cover the writer-flush vs reader-poll race
 *    (Windows is the common case for `EBUSY`). `ENOENT` is absorbed earlier
 *    by `readStateOrEmpty` (returns an empty state) and never reaches the
 *    retry loop.
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { writeJsonAtomically } from '@slopus/happy-wire/node';
import { configuration } from '@/configuration';
import { logger } from '@/ui/logger';

export const MAILBOX_ENVELOPE_VERSION = 1 as const;

/** Soft-cap F-010: sessionId path-safety regex. */
export const SESSION_ID_REGEX = /^[A-Za-z0-9_-]{1,128}$/;

export interface MailboxEntry {
    /** Envelope version (Northstar rule 1). v1 is the only accepted value today. */
    version: 1;
    /** Monotonic per-inbox sequence number; assigned by `appendMessage`. */
    seq: number;
    /** UUID-like opaque entry id; stable across reads. */
    id: string;
    /** Wall-clock ms when the entry was appended. */
    appendedAt: number;
    /** Sender session id (logical handle; never a path). */
    sender: string;
    /** Caller-supplied opaque body. */
    body: unknown;
}

export interface MailboxState {
    version: 1;
    /** Highest `seq` that has been OBSERVED (the member acted on it) — the true consume point. */
    cursor: number;
    /**
     * Highest `seq` the daemon has INJECTED into the member but not yet observed
     * (US-004 pending→injected→observed). Always `>= cursor`. Absent on legacy
     * files, where it defaults to `cursor` (nothing in-flight). "inject IS read"
     * must NOT advance `cursor`; injection advances only this marker, so a
     * daemon crash mid-flight can re-inject un-observed mail (US-005) without
     * losing it.
     */
    injected?: number;
    /** Entries with `seq > cursor` (un-observed), in append order. */
    pending: MailboxEntry[];
}

export class MailboxInvalidSessionIdError extends Error {
    readonly code = 'mailbox_invalid_session_id' as const;
    constructor(sessionId: string) {
        super(`mailbox: invalid sessionId ${JSON.stringify(sessionId)} (must match ${SESSION_ID_REGEX.source})`);
        this.name = 'MailboxInvalidSessionIdError';
    }
}

export class MailboxUnsupportedVersionError extends Error {
    readonly code = 'mailbox_unsupported_version' as const;
    constructor(public readonly observed: number) {
        super(`mailbox: entry envelope version ${observed} > max supported ${MAILBOX_ENVELOPE_VERSION}`);
        this.name = 'MailboxUnsupportedVersionError';
    }
}

function assertSessionId(sessionId: string): void {
    if (typeof sessionId !== 'string' || !SESSION_ID_REGEX.test(sessionId)) {
        throw new MailboxInvalidSessionIdError(sessionId);
    }
}

function agentCommsRoot(): string {
    return path.join(configuration.happyHomeDir, 'agent-comms', 'inboxes');
}

export function inboxDirFor(sessionId: string): string {
    assertSessionId(sessionId);
    return path.join(agentCommsRoot(), sessionId);
}

export function inboxPathFor(sessionId: string): string {
    return path.join(inboxDirFor(sessionId), 'mailbox.json');
}

function historyPathFor(sessionId: string): string {
    return path.join(inboxDirFor(sessionId), 'history.jsonl');
}

function emptyState(): MailboxState {
    return { version: MAILBOX_ENVELOPE_VERSION, cursor: 0, injected: 0, pending: [] };
}

async function readStateRaw(sessionId: string): Promise<MailboxState> {
    const file = inboxPathFor(sessionId);
    const raw = await fs.readFile(file, 'utf8');
    const parsed = JSON.parse(raw) as MailboxState;
    if (typeof parsed.version === 'number' && parsed.version > MAILBOX_ENVELOPE_VERSION) {
        throw new MailboxUnsupportedVersionError(parsed.version);
    }
    for (const entry of parsed.pending ?? []) {
        if (typeof entry.version === 'number' && entry.version > MAILBOX_ENVELOPE_VERSION) {
            throw new MailboxUnsupportedVersionError(entry.version);
        }
    }
    const cursor = parsed.cursor ?? 0;
    // `injected` defaults to `cursor` on legacy files (nothing in-flight) and is
    // clamped so it can never sit below the observed cursor.
    const injected = Math.max(cursor, parsed.injected ?? cursor);
    return {
        version: MAILBOX_ENVELOPE_VERSION,
        cursor,
        injected,
        pending: parsed.pending ?? [],
    };
}

async function readStateOrEmpty(sessionId: string): Promise<MailboxState> {
    try {
        return await readStateRaw(sessionId);
    } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code === 'ENOENT') {
            return emptyState();
        }
        throw error;
    }
}

export async function ensureInbox(sessionId: string): Promise<void> {
    const dir = inboxDirFor(sessionId);
    await fs.mkdir(dir, { recursive: true });
    const file = inboxPathFor(sessionId);
    try {
        await fs.access(file);
        // Already exists; do NOT overwrite (idempotency invariant).
        return;
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
            throw error;
        }
    }
    await writeJsonAtomically(file, emptyState());
}

// Per-session in-process serialization chains — one promise chain per active
// inbox session id in THIS process (F-001). Combined with the cross-process
// lockfile below (F-007), every read-modify-write on an inbox (append, consume,
// markConsumed) is serialized both within and across processes.
const inboxChains = new Map<string, Promise<unknown>>();

// Cross-process per-inbox lock (F-007). `writeJsonAtomically` makes each write
// atomic but provides NO cross-process mutual exclusion, and an inbox has two
// distinct writer processes: the daemon (`appendMessage`, via /agent-comms/send)
// and the consumer's own stdio bridge (`consumePending` / `markConsumed`).
// Without this guard a concurrent send + drain can interleave their
// read-modify-write cycles and clobber the pending list (silent message loss),
// which would violate the whole point of a durable mailbox. The lock is an
// O_EXCL lockfile with bounded acquire retry + stale-holder takeover.
const LOCK_ACQUIRE_TIMEOUT_MS = 5000;
const LOCK_STALE_MS = 15000;

function lockPathFor(sessionId: string): string {
    return path.join(inboxDirFor(sessionId), 'mailbox.lock');
}

async function withInboxLock<T>(sessionId: string, fn: () => Promise<T>): Promise<T> {
    await fs.mkdir(inboxDirFor(sessionId), { recursive: true });
    const lockPath = lockPathFor(sessionId);
    const deadline = Date.now() + LOCK_ACQUIRE_TIMEOUT_MS;
    let handle: fs.FileHandle;
    for (;;) {
        try {
            handle = await fs.open(lockPath, 'wx');
            break;
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
            // Lock is held; take it over if the holder looks stale (crashed
            // mid-critical-section), otherwise back off and retry.
            try {
                const st = await fs.stat(lockPath);
                if (Date.now() - st.mtimeMs > LOCK_STALE_MS) {
                    // Atomically CLAIM the stale lock before deleting it: rename is
                    // atomic, so only ONE contender can win the takeover of this
                    // exact file. The loser gets ENOENT and re-loops, then contends
                    // for the fresh lock via O_EXCL. This prevents two processes
                    // from both deciding "stale", both deleting, and both entering
                    // the critical section (which would re-open the F-007 race).
                    const tombstone = `${lockPath}.stale.${process.pid}.${Math.random().toString(36).slice(2, 10)}`;
                    try {
                        await fs.rename(lockPath, tombstone);
                        await fs.rm(tombstone, { force: true });
                    } catch {
                        // Another contender claimed the stale lock first — just retry.
                    }
                    continue;
                }
            } catch {
                // Lock vanished between EEXIST and stat — retry immediately.
                continue;
            }
            if (Date.now() > deadline) {
                throw new Error(`mailbox: timed out acquiring inbox lock for ${sessionId}`);
            }
            await sleep(15 + Math.floor(Math.random() * 25));
        }
    }
    try {
        return await fn();
    } finally {
        // Close BEFORE unlink — Windows cannot remove a file with an open handle.
        try { await handle.close(); } catch { /* already closed */ }
        try { await fs.rm(lockPath, { force: true }); } catch { /* already gone */ }
    }
}

/**
 * Sole-writer mode (US-004). When the daemon is the ONLY writer of the
 * coordination files (proven by the writer inventory in `mailboxWriters.ts`),
 * the cross-process F-007 lock is unnecessary and can be skipped, leaving only
 * the in-process serialization chain. DEFAULT-OFF: it must stay off until every
 * foreign writer (the consumer bridge `consumePending`/`ensureInbox`) is removed
 * (US-006). Toggling it on while a foreign writer still exists re-opens the
 * F-007 clobber race, so this is a deliberate, inventory-gated switch.
 */
let daemonSoleWriter = process.env.HAPPY_DAEMON_SOLE_WRITER === '1'
    || process.env.HAPPY_DAEMON_SOLE_WRITER === 'true';

/** Whether the daemon-sole-writer lock-elision is active. */
export function isDaemonSoleWriter(): boolean {
    return daemonSoleWriter;
}

/** Enable/disable daemon-sole-writer lock-elision (see {@link isDaemonSoleWriter}). */
export function setDaemonSoleWriter(enabled: boolean): void {
    daemonSoleWriter = enabled;
}

/**
 * Run `fn` under both the in-process per-session chain and the cross-process
 * inbox lockfile, so an inbox read-modify-write can never interleave with
 * another (in this or any other process). In daemon-sole-writer mode the
 * cross-process lockfile is elided (only the in-process chain remains), because
 * a single writer process cannot race itself across processes.
 */
function runExclusive<T>(sessionId: string, fn: () => Promise<T>): Promise<T> {
    const prior = inboxChains.get(sessionId) ?? Promise.resolve();
    const critical = daemonSoleWriter
        ? async (): Promise<T> => {
            // Still ensure the inbox dir exists (writeJsonAtomically targets it);
            // withInboxLock normally does this before acquiring the lockfile.
            await fs.mkdir(inboxDirFor(sessionId), { recursive: true });
            return fn();
        }
        : (): Promise<T> => withInboxLock(sessionId, fn);
    const run = prior.catch(() => undefined).then(critical);
    inboxChains.set(sessionId, run.catch(() => undefined));
    return run;
}

function randomId(): string {
    return `mb_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

export async function appendMessage(sessionId: string, body: unknown, sender: string): Promise<{ id: string; seq: number }> {
    assertSessionId(sessionId);
    assertSessionId(sender);
    // Serialized per-inbox within AND across processes (F-001 + F-007), so two
    // concurrent appends — or an append racing a consume in the bridge process —
    // cannot read the same state, assign the same seq, and clobber each other.
    return runExclusive(sessionId, async (): Promise<{ id: string; seq: number }> => {
        await ensureInbox(sessionId);
        const current = await readStateOrEmpty(sessionId);
        const lastSeq = current.pending.length > 0
            ? current.pending[current.pending.length - 1].seq
            : current.cursor;
        const entry: MailboxEntry = {
            version: MAILBOX_ENVELOPE_VERSION,
            seq: lastSeq + 1,
            id: randomId(),
            appendedAt: Date.now(),
            sender,
            body,
        };
        const next: MailboxState = {
            version: MAILBOX_ENVELOPE_VERSION,
            cursor: current.cursor,
            injected: current.injected ?? current.cursor,
            pending: [...current.pending, entry],
        };
        await writeJsonAtomically(inboxPathFor(sessionId), next);
        // History sidecar is GENUINELY best-effort (F-004): mailbox.json is
        // already committed above and is the source of truth, so a sidecar
        // failure must NOT fail the send — failing would invite duplicate
        // retries against an inbox that already holds the message.
        try {
            await fs.appendFile(historyPathFor(sessionId), `${JSON.stringify(entry)}\n`, { mode: 0o600 });
        } catch (err) {
            logger.debug(`[mailbox] history sidecar append failed for ${sessionId} (mailbox.json is authoritative): ${String(err)}`);
        }
        return { id: entry.id, seq: entry.seq };
    });
}

async function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

export async function readPending(sessionId: string, sinceSeq?: number): Promise<MailboxEntry[]> {
    assertSessionId(sessionId);
    let lastError: unknown;
    for (let attempt = 0; attempt < 3; attempt++) {
        try {
            const state = await readStateOrEmpty(sessionId);
            const floor = sinceSeq ?? state.cursor;
            return state.pending.filter(e => e.seq > floor);
        } catch (error) {
            if (error instanceof MailboxUnsupportedVersionError) {
                throw error;
            }
            const code = (error as NodeJS.ErrnoException).code;
            // ENOENT is already absorbed by readStateOrEmpty (returns empty
            // state), so it never reaches here on the normal path; only EBUSY
            // (the Windows writer-flush vs reader-poll lock race) is a live
            // retry case (F-006).
            if (code !== 'EBUSY') {
                throw error;
            }
            lastError = error;
            await sleep(10 * (attempt + 1));
        }
    }
    throw lastError;
}

export async function markConsumed(sessionId: string, uptoSeq: number): Promise<void> {
    assertSessionId(sessionId);
    return runExclusive(sessionId, async () => {
        const state = await readStateOrEmpty(sessionId);
        const nextCursor = Math.max(state.cursor, uptoSeq);
        const next: MailboxState = {
            version: MAILBOX_ENVELOPE_VERSION,
            cursor: nextCursor,
            injected: Math.max(state.injected ?? state.cursor, nextCursor),
            pending: state.pending.filter(e => e.seq > nextCursor),
        };
        await writeJsonAtomically(inboxPathFor(sessionId), next);
    });
}

/**
 * Mark mail up to `uptoSeq` as INJECTED (US-004 pending→injected→observed). This
 * is what the daemon calls right after it pushes mail into a member via
 * {@link injectIntoMember} (US-002). It advances ONLY the `injected` marker, not
 * `cursor`: injection is not observation, so the mail stays un-observed until
 * the member's AppServerEvent stream (US-003) confirms it acted. `injected` is
 * clamped to `>= cursor` and never regresses. Daemon-only writer.
 */
export async function markInjected(sessionId: string, uptoSeq: number): Promise<void> {
    assertSessionId(sessionId);
    return runExclusive(sessionId, async () => {
        const state = await readStateOrEmpty(sessionId);
        const currentInjected = state.injected ?? state.cursor;
        const nextInjected = Math.max(currentInjected, state.cursor, uptoSeq);
        const next: MailboxState = {
            version: MAILBOX_ENVELOPE_VERSION,
            cursor: state.cursor,
            injected: nextInjected,
            pending: state.pending,
        };
        await writeJsonAtomically(inboxPathFor(sessionId), next);
    });
}

/**
 * Mark mail up to `uptoSeq` as OBSERVED (US-004 pending→injected→observed): the
 * member demonstrably acted on it (evidence from the AppServerEvent stream,
 * US-003). This is the true consume point — it advances `cursor`, prunes the
 * observed entries from `pending`, and keeps `injected >= cursor`. Idempotent
 * and monotonic (never regresses). Daemon-only writer; the canonical
 * consume transition in the inject model, replacing the pull-model
 * `markConsumed`/`consumePending`.
 */
export async function markObserved(sessionId: string, uptoSeq: number): Promise<void> {
    assertSessionId(sessionId);
    return runExclusive(sessionId, async () => {
        const state = await readStateOrEmpty(sessionId);
        const nextCursor = Math.max(state.cursor, uptoSeq);
        const next: MailboxState = {
            version: MAILBOX_ENVELOPE_VERSION,
            cursor: nextCursor,
            injected: Math.max(state.injected ?? state.cursor, nextCursor),
            pending: state.pending.filter(e => e.seq > nextCursor),
        };
        await writeJsonAtomically(inboxPathFor(sessionId), next);
    });
}

/**
 * Un-OBSERVED mail: every entry with `seq > cursor` (both not-yet-injected and
 * injected-but-not-observed). This is the exact set the daemon must re-inject on
 * a SPOF restart (US-005); duplicate delivery of the already-injected subset is
 * made harmless by per-entry idempotency keys (the stable {@link MailboxEntry.id}).
 */
export async function readUnobserved(sessionId: string, sinceSeq?: number): Promise<MailboxEntry[]> {
    return readPending(sessionId, sinceSeq);
}

/**
 * Un-INJECTED mail: entries with `seq > injected`. This is the set the daemon
 * should inject on a normal top-up (steady state), i.e. mail that has never been
 * pushed to the member yet.
 */
export async function readUninjected(sessionId: string): Promise<MailboxEntry[]> {
    assertSessionId(sessionId);
    let lastError: unknown;
    for (let attempt = 0; attempt < 3; attempt++) {
        try {
            const state = await readStateOrEmpty(sessionId);
            const floor = state.injected ?? state.cursor;
            return state.pending.filter(e => e.seq > floor);
        } catch (error) {
            if (error instanceof MailboxUnsupportedVersionError) throw error;
            if ((error as NodeJS.ErrnoException).code !== 'EBUSY') throw error;
            lastError = error;
            await sleep(10 * (attempt + 1));
        }
    }
    throw lastError;
}

/**
 * Atomically drain the inbox: read the pending entries, hand them to `build` to
 * construct the caller's payload, and ONLY THEN advance the cursor (post-drain
 * consume, F-003). The read, the `build`, and the cursor advance all run inside
 * the same per-inbox critical section (in-process chain + cross-process lock,
 * F-007), so a concurrent `appendMessage` cannot interleave and be lost. If
 * `build` throws, the cursor is NOT advanced and the mail stays pending.
 *
 * This is the single consumption primitive: the bridge's resource-read callback
 * delegates here rather than doing its own read+markConsumed, which would put a
 * second writer (the bridge process) in contention with the daemon's appends.
 */
export async function consumePending<T>(sessionId: string, build: (entries: MailboxEntry[]) => T): Promise<T> {
    assertSessionId(sessionId);
    return runExclusive(sessionId, async () => {
        const state = await readStateOrEmpty(sessionId);
        const entries = state.pending;
        const result = build(entries); // build payload BEFORE advancing the cursor
        if (entries.length > 0) {
            const uptoSeq = entries[entries.length - 1].seq;
            const next: MailboxState = {
                version: MAILBOX_ENVELOPE_VERSION,
                cursor: Math.max(state.cursor, uptoSeq),
                injected: Math.max(state.injected ?? state.cursor, uptoSeq),
                pending: [],
            };
            await writeJsonAtomically(inboxPathFor(sessionId), next);
        }
        return result;
    });
}
