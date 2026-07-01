/**
 * Daemon SPOF recovery: re-inject un-observed mail after a daemon restart
 * (US-005).
 *
 * With the inject model the happy-cli daemon becomes a single point of failure:
 * if it crashes after mail was appended (or injected but not yet observed), that
 * mail is stuck until the daemon comes back. This module is the catch-up run the
 * daemon performs on (re)start.
 *
 * NOTE — this is the DAEMON-side recovery, distinct from the existing MEMBER-side
 * `recovery.ts` (`recoverPendingAgentCommsMessages`, which pushes ONE wake prompt
 * inside a member process). The daemon owns delivery now (it injects), so IT is
 * responsible for replaying un-observed mail into each live member.
 *
 * Correctness contract:
 *  - **Only un-observed mail is re-injected.** OBSERVED mail (seq <= cursor,
 *    the member demonstrably acted on it — US-003 evidence advanced the cursor
 *    via `markObserved`) is never returned by `readUnobserved`, so it is never
 *    replayed. This is the "no re-delivery of already-handled mail" half of the
 *    AC.
 *  - **No dup for the injected-but-unobserved subset.** On a crash the daemon
 *    cannot know whether mail it had marked `injected` actually reached the
 *    member, so it MUST replay it. Duplicate delivery is made harmless by a
 *    per-entry idempotency key = the stable {@link MailboxEntry.id}: the key is
 *    deterministic across restarts, so the member (or a downstream dedup) drops
 *    a second copy. {@link buildRecoveryInjection} surfaces those keys.
 *  - **Unreachable members are skipped, not lost.** If a member has no live
 *    app-server endpoint (crashed / not yet started), its mail stays pending and
 *    is retried on the next recovery pass — nothing is consumed.
 *
 * All I/O is injected through {@link DaemonRecoveryDeps} so the whole pass is
 * unit-testable without a daemon, a real inbox, or a websocket.
 */

import type { MailboxEntry } from './mailbox';
import { listInboxes, readUnobserved, markInjected } from './mailbox';
import {
    injectIntoMember,
    resolveMemberEndpoint,
    InjectNoActiveThreadError,
    type InjectEndpoint,
    type InjectResult,
    type MemberTurnState,
} from './injectClient';

/** Deterministic idempotency key for an entry (stable across restarts). */
export function entryIdempotencyKey(entry: MailboxEntry): string {
    return entry.id;
}

/**
 * Build the wake injection for a batch of un-observed entries. The text is a
 * drain hint (bodies ride the mailbox, not the wake), and `idempotencyKeys`
 * carries one stable key per entry so a replayed batch is de-duplicated
 * downstream. `lastSeq` is the highest seq in the batch (what to `markInjected`).
 */
export function buildRecoveryInjection(entries: MailboxEntry[]): {
    text: string;
    idempotencyKeys: string[];
    lastSeq: number;
} {
    const idempotencyKeys = entries.map(entryIdempotencyKey);
    const lastSeq = entries.length > 0 ? entries[entries.length - 1].seq : 0;
    return {
        text: `[agent-comms] ${entries.length} pending message(s) redelivered after daemon restart; read the agent-comms resource to drain`,
        idempotencyKeys,
        lastSeq,
    };
}

/** How the recovery pass injects a batch into a member. Injectable for tests. */
export type RecoveryInjector = (
    session: string,
    entries: MailboxEntry[],
) => Promise<{ injected: boolean; lastSeq: number; result?: InjectResult; reason?: string }>;

export interface DaemonRecoveryDeps {
    /** Enumerate inbox session ids. Defaults to the on-disk mailbox root. */
    listInboxes?: () => Promise<string[]>;
    /** Read a session's un-observed mail (seq > cursor). Defaults to the mailbox. */
    readUnobserved?: (session: string) => Promise<MailboxEntry[]>;
    /** Re-inject a batch into a member. Defaults to {@link defaultRecoveryInjector}. */
    inject?: RecoveryInjector;
    /** Advance the injected marker after a successful re-inject. Defaults to the mailbox. */
    markInjected?: (session: string, uptoSeq: number) => Promise<void>;
    /** Optional debug logger. */
    log?: (msg: string) => void;
}

export interface PerSessionRecovery {
    session: string;
    reinjected: number;
    lastSeq: number;
}

export interface RecoverySkip {
    session: string;
    reason: 'no-unobserved-mail' | 'member-unreachable' | 'no-active-thread' | 'inject-failed';
    detail?: string;
}

export interface DaemonRecoveryResult {
    /** Inboxes scanned. */
    scanned: number;
    /** Members that had >=1 entry re-injected. */
    membersRecovered: number;
    /** Total entries re-injected across all members. */
    entriesReinjected: number;
    /** Per-member successful recovery detail. */
    perSession: PerSessionRecovery[];
    /** Members skipped (with reason); their mail stays pending. */
    skipped: RecoverySkip[];
}

/**
 * The default injector: resolve the member's live loopback endpoint, drive an
 * idle-wake/steer via {@link injectIntoMember}, carrying the un-observed batch's
 * idempotency keys. An unreachable member (no live endpoint) or a member with no
 * active thread is reported as a skip, not a failure — its mail stays pending.
 *
 * `turnStateFor` supplies the observed {threadId, activeTurnId} so start-vs-steer
 * matches the member's live state (from the US-003 registry at the call site);
 * without it, injection targets a fresh turn once a thread exists.
 */
export function defaultRecoveryInjector(
    turnStateFor?: (session: string, endpoint: InjectEndpoint) => MemberTurnState,
    homeDir?: string,
): RecoveryInjector {
    return async (session, entries) => {
        const endpoint = await resolveMemberEndpoint(session, homeDir);
        if (!endpoint) {
            return { injected: false, lastSeq: 0, reason: 'member-unreachable' };
        }
        const { text, lastSeq } = buildRecoveryInjection(entries);
        const state: MemberTurnState = turnStateFor
            ? turnStateFor(session, endpoint)
            : { threadId: session, activeTurnId: null };
        try {
            const result = await injectIntoMember(endpoint, state, { kind: 'wake', text });
            return { injected: true, lastSeq, result };
        } catch (error) {
            if (error instanceof InjectNoActiveThreadError) {
                return { injected: false, lastSeq: 0, reason: 'no-active-thread' };
            }
            return { injected: false, lastSeq: 0, reason: `inject-failed:${String(error)}` };
        }
    };
}

function reasonToSkip(reason: string | undefined): RecoverySkip['reason'] {
    if (reason === 'member-unreachable') return 'member-unreachable';
    if (reason === 'no-active-thread') return 'no-active-thread';
    return 'inject-failed';
}

/**
 * Run one daemon recovery pass: for every inbox with un-observed mail, re-inject
 * the batch into its member and advance the injected marker. Returns a summary;
 * throws only on an unexpected enumerate/read failure (individual member
 * failures are captured as skips so one bad member never blocks the rest).
 */
export async function recoverDaemonInjectState(deps: DaemonRecoveryDeps = {}): Promise<DaemonRecoveryResult> {
    const enumerate = deps.listInboxes ?? listInboxes;
    const read = deps.readUnobserved ?? readUnobserved;
    const inject = deps.inject ?? defaultRecoveryInjector();
    const mark = deps.markInjected ?? markInjected;
    const log = deps.log ?? (() => undefined);

    const sessions = await enumerate();
    const result: DaemonRecoveryResult = {
        scanned: sessions.length,
        membersRecovered: 0,
        entriesReinjected: 0,
        perSession: [],
        skipped: [],
    };

    for (const session of sessions) {
        const unobserved = await read(session);
        if (unobserved.length === 0) {
            result.skipped.push({ session, reason: 'no-unobserved-mail' });
            continue;
        }
        let outcome: Awaited<ReturnType<RecoveryInjector>>;
        try {
            outcome = await inject(session, unobserved);
        } catch (error) {
            result.skipped.push({ session, reason: 'inject-failed', detail: String(error) });
            log(`[daemon-recovery] inject threw for ${session}: ${String(error)}`);
            continue;
        }
        if (!outcome.injected) {
            result.skipped.push({ session, reason: reasonToSkip(outcome.reason), detail: outcome.reason });
            log(`[daemon-recovery] skipped ${session}: ${outcome.reason ?? 'unknown'}`);
            continue;
        }
        // Advance the injected marker so steady-state top-up (readUninjected)
        // does not re-push what recovery just delivered. Un-observed status is
        // unchanged — only markObserved (US-003 evidence) advances the cursor.
        const uptoSeq = outcome.lastSeq || unobserved[unobserved.length - 1].seq;
        await mark(session, uptoSeq);
        result.membersRecovered += 1;
        result.entriesReinjected += unobserved.length;
        result.perSession.push({ session, reinjected: unobserved.length, lastSeq: uptoSeq });
        log(`[daemon-recovery] re-injected ${unobserved.length} entr(y|ies) into ${session} (uptoSeq=${uptoSeq})`);
    }

    return result;
}
