/**
 * Writer inventory for the agent-comms coordination files (US-004).
 *
 * The crews-replacement design lets the F-007 cross-process `mailbox.lock` be
 * dropped ONLY once the happy-cli daemon is the SOLE writer of the coordination
 * files under `<happyHomeDir>/agent-comms/inboxes/<sessionId>/`
 * (`mailbox.json`, `history.jsonl`). The plan is explicit: "drop locks ONLY
 * after writer inventory ... all behind daemon APIs — premature lock-drop =
 * races." (`plan.md`, Risk Areas → Sole-writer.)
 *
 * This module is that inventory, encoded as data so it can be asserted in tests
 * and inspected at runtime. Each entry cites the exact writer call-site and
 * classifies it as either the daemon (allowed) or a FOREIGN process (must be
 * removed before the lock is dropped). {@link daemonSoleWriterReadiness}
 * computes whether the sole-writer precondition currently holds.
 *
 * IMPORTANT: this inventory is maintained by hand against the code. When you add
 * or remove a writer of the coordination files, update {@link MAILBOX_WRITERS}
 * in the same change; `mailboxWriters.test.ts` guards a few invariants but
 * cannot discover a brand-new writer on its own.
 */

/** Which process performs a given write. */
export type WriterProcess = 'daemon' | 'consumer-bridge' | 'member';

/** A single code-path that writes an agent-comms coordination file. */
export interface MailboxWriter {
    /** Short stable id. */
    id: string;
    /** `path:line` of the write call-site (as of this inventory). */
    site: string;
    /** The mailbox primitive invoked. */
    primitive: 'appendMessage' | 'markConsumed' | 'markObserved' | 'markInjected' | 'consumePending' | 'ensureInbox';
    /** Which process this runs in. */
    process: WriterProcess;
    /**
     * True when this writer is the daemon itself (the intended sole writer).
     * A `false` here is a FOREIGN writer that blocks the lock-drop.
     */
    isDaemon: boolean;
    /** Human note on why it writes and what must happen for the lock-drop. */
    note: string;
}

/**
 * The complete set of writers of the agent-comms coordination files.
 *
 * Note the scope boundary: the crews plugin's OWN coordination files (under
 * `.crews/`: stop / review-mail / session-start / crash-sweep) are a SEPARATE
 * file set migrated by P3/US-006, not the happy-cli agent-comms mailbox
 * inventoried here. This module is happy-cli-only (P2).
 */
export const MAILBOX_WRITERS: readonly MailboxWriter[] = [
    {
        id: 'daemon-control-send',
        site: 'src/daemon/controlServer.ts:354',
        primitive: 'appendMessage',
        process: 'daemon',
        isDaemon: true,
        note: 'POST /agent-comms/send deliverLocal → appendMessage. Runs in the daemon; the intended sole append writer.',
    },
    {
        id: 'daemon-ingest-relay',
        site: 'src/agentComms/ingestHandler.ts:68',
        primitive: 'appendMessage',
        process: 'daemon',
        isDaemon: true,
        note: 'Ingest/relay path → appendMessage, invoked from the daemon control server. Daemon-owned.',
    },
    {
        id: 'daemon-mark-injected',
        site: 'src/agentComms/mailbox.ts markInjected',
        primitive: 'markInjected',
        process: 'daemon',
        isDaemon: true,
        note: 'US-004 ack transition: daemon marks mail injected after injectIntoMember. Daemon-only.',
    },
    {
        id: 'daemon-mark-observed',
        site: 'src/agentComms/mailbox.ts markObserved',
        primitive: 'markObserved',
        process: 'daemon',
        isDaemon: true,
        note: 'US-004 ack transition: daemon advances the observed cursor from AppServerEvent evidence. Daemon-only.',
    },
    {
        id: 'consumer-bridge-drain',
        site: 'src/codex/agentCommsBridge.ts:133',
        primitive: 'consumePending',
        process: 'consumer-bridge',
        isDaemon: false,
        note: 'FOREIGN: the member/consumer stdio bridge drains + advances the cursor in the MEMBER process (F-007 second writer). This is the pull model the inject model replaces; it must be removed (US-006) before the lock is dropped.',
    },
    {
        id: 'consumer-bridge-ensure-inbox',
        site: 'src/codex/agentCommsBridge.ts:313',
        primitive: 'ensureInbox',
        process: 'consumer-bridge',
        isDaemon: false,
        note: 'FOREIGN: the bridge creates the empty mailbox.json in the MEMBER process on arm. Removed together with the drain path in US-006.',
    },
] as const;

/** All foreign (non-daemon) writers that currently block the lock-drop. */
export function foreignWriters(): MailboxWriter[] {
    return MAILBOX_WRITERS.filter((w) => !w.isDaemon);
}

/** Readiness verdict for daemon-sole-writer mode. */
export interface SoleWriterReadiness {
    /** True only when there are ZERO foreign writers of the coordination files. */
    ready: boolean;
    /** The blocking foreign writers (empty when `ready`). */
    blockers: MailboxWriter[];
    /** Human-readable rationale. */
    reason: string;
}

/**
 * Compute whether the daemon-sole-writer precondition holds. Today it does NOT:
 * the consumer bridge is still a live foreign writer, so this returns
 * `ready: false` and enumerates the blockers. Once US-006 removes the bridge
 * writers from {@link MAILBOX_WRITERS}, this flips to `ready: true` and the
 * `HAPPY_DAEMON_SOLE_WRITER` lock-elision (see `mailbox.ts::setDaemonSoleWriter`)
 * becomes safe to enable.
 */
export function daemonSoleWriterReadiness(): SoleWriterReadiness {
    const blockers = foreignWriters();
    if (blockers.length === 0) {
        return {
            ready: true,
            blockers,
            reason: 'All coordination-file writers are the daemon; the F-007 cross-process lock can be dropped.',
        };
    }
    return {
        ready: false,
        blockers,
        reason: `Cannot drop the mailbox lock: ${blockers.length} foreign writer(s) remain (${blockers
            .map((b) => `${b.id}@${b.site}`)
            .join(', ')}). Remove them (US-006) before enabling daemon-sole-writer.`,
    };
}
