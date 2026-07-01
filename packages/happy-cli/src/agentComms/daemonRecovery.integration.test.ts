/**
 * US-005 daemon SPOF recovery — integration test against the REAL durable
 * mailbox (no mocked mailbox I/O).
 *
 * Lives in the serial `integration-agent-comms` project so it never contends
 * with the parallel unit run over a shared temp home. It exercises the real
 * `listInboxes` / `readUnobserved` / `markInjected` / `markObserved` cycle and a
 * fake injector (there is no live codex app-server in the test), proving the two
 * load-bearing recovery guarantees end-to-end:
 *
 *   1. A daemon restart re-injects ONLY un-observed mail — mail the member
 *      already observed (cursor advanced via `markObserved`) is never replayed.
 *   2. Replaying the injected-but-unobserved subset is dup-safe: two successive
 *      recovery passes over the same un-observed set carry IDENTICAL per-entry
 *      idempotency keys, so a member dedups the second copy.
 *
 * NOTE: temp home uses the OS temp dir via `mkdtempSync(tmpdir(), ...)`, matching
 * every other mailbox / agent-comms test in this suite (the happy-wire atomic
 * writer is reliable there; writing under the watched project tree trips a
 * Windows EPERM-on-rename).
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fsSync from 'node:fs';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { tmpdir } from 'node:os';

const tempHome = fsSync.mkdtempSync(path.join(tmpdir(), 'happy-daemonrec-integ-'));
process.env.HAPPY_HOME_DIR = tempHome;

let mailbox: typeof import('./mailbox');
let daemonRecovery: typeof import('./daemonRecovery');

beforeAll(async () => {
    mailbox = await import('./mailbox');
    daemonRecovery = await import('./daemonRecovery');
});

afterAll(async () => {
    await fs.rm(tempHome, { recursive: true, force: true });
});

describe('daemon SPOF recovery (US-005) against the real mailbox', () => {
    it('re-injects only un-observed mail, is dup-safe across restarts, and stops once observed', async () => {
        const { appendMessage, readUnobserved, markObserved, listInboxes, markInjected, readUninjected } = mailbox;
        const { recoverDaemonInjectState, buildRecoveryInjection } = daemonRecovery;

        const alpha = 'sessAlpha';
        const beta = 'sessBeta';

        // Seed two inboxes.
        await appendMessage(alpha, { n: 1 }, 'lead');
        await appendMessage(alpha, { n: 2 }, 'lead');
        await appendMessage(alpha, { n: 3 }, 'lead');
        await appendMessage(beta, { n: 1 }, 'lead');
        await appendMessage(beta, { n: 2 }, 'lead');

        // The member observed alpha's first message before the daemon crashed.
        await markObserved(alpha, 1);

        // A fake injector: real mailbox, but no live app-server — record what it
        // would inject (session → idempotency keys) and report success.
        const passKeys = (): {
            inject: (session: string, entries: import('./mailbox').MailboxEntry[]) => Promise<{ injected: boolean; lastSeq: number }>;
            captured: Record<string, string[]>;
        } => {
            const captured: Record<string, string[]> = {};
            const inject = async (session: string, entries: import('./mailbox').MailboxEntry[]) => {
                captured[session] = buildRecoveryInjection(entries).idempotencyKeys;
                return { injected: true, lastSeq: entries[entries.length - 1].seq };
            };
            return { inject, captured };
        };

        // ---- First recovery pass (daemon restart #1) ----
        const p1 = passKeys();
        const r1 = await recoverDaemonInjectState({
            listInboxes,
            readUnobserved,
            markInjected,
            inject: p1.inject,
        });

        expect(r1.scanned).toBe(2);
        expect(r1.membersRecovered).toBe(2);
        // alpha: only seq 2,3 (seq 1 was observed); beta: seq 1,2.
        expect(p1.captured[alpha]).toHaveLength(2);
        expect(p1.captured[beta]).toHaveLength(2);
        expect(r1.entriesReinjected).toBe(4);

        // Un-observed status is unchanged (only markObserved advances cursor);
        // the injected marker advanced so steady-state top-up is now empty.
        expect(await readUnobserved(alpha)).toHaveLength(2);
        expect(await readUninjected(alpha)).toHaveLength(0);
        expect(await readUninjected(beta)).toHaveLength(0);

        // ---- Second recovery pass (daemon restart #2, nothing observed since) ----
        const p2 = passKeys();
        const r2 = await recoverDaemonInjectState({
            listInboxes,
            readUnobserved,
            markInjected,
            inject: p2.inject,
        });

        // Same un-observed set ⇒ IDENTICAL idempotency keys ⇒ member dedups.
        expect(r2.entriesReinjected).toBe(4);
        expect(p2.captured[alpha]).toEqual(p1.captured[alpha]);
        expect(p2.captured[beta]).toEqual(p1.captured[beta]);

        // ---- Member now observes everything; a third restart re-injects nothing ----
        await markObserved(alpha, 3);
        await markObserved(beta, 2);

        const p3 = passKeys();
        const r3 = await recoverDaemonInjectState({
            listInboxes,
            readUnobserved,
            markInjected,
            inject: p3.inject,
        });

        expect(r3.membersRecovered).toBe(0);
        expect(r3.entriesReinjected).toBe(0);
        expect(r3.skipped.every((s) => s.reason === 'no-unobserved-mail')).toBe(true);
        expect(p3.captured).toEqual({});
    });
});
