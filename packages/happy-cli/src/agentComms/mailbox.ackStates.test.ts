/**
 * Unit tests for the US-004 ack-state model + daemon-sole-writer gate added to
 * the durable mailbox. Uses a real temp `HAPPY_HOME_DIR` and the real
 * `writeJsonAtomically`, matching mailbox.test.ts.
 *
 * Covers pending→injected→observed transitions (markInjected / markObserved),
 * the un-observed / un-injected readers, `injected`-marker persistence + legacy
 * default, and the sole-writer cross-process-lock elision.
 */

import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import * as fsSync from 'node:fs';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { tmpdir } from 'node:os';

const tempHome = fsSync.mkdtempSync(path.join(tmpdir(), 'happy-mailbox-ack-test-'));
process.env.HAPPY_HOME_DIR = tempHome;

// eslint-disable-next-line @typescript-eslint/consistent-type-imports
let mailbox: typeof import('./mailbox');

const SENDER = 'sess_sender';
const RCVR = 'sess_receiver';

async function seed(count: number): Promise<void> {
    for (let i = 0; i < count; i++) {
        await mailbox.appendMessage(RCVR, { n: i }, SENDER);
    }
}

function inboxState(): { cursor: number; injected?: number; pending: Array<{ seq: number }> } {
    const file = path.join(tempHome, 'agent-comms', 'inboxes', RCVR, 'mailbox.json');
    return JSON.parse(fsSync.readFileSync(file, 'utf8'));
}

beforeAll(async () => {
    mailbox = await import('./mailbox');
});

afterAll(async () => {
    await fs.rm(tempHome, { recursive: true, force: true });
});

afterEach(async () => {
    mailbox.setDaemonSoleWriter(false);
    await fs.rm(path.join(tempHome, 'agent-comms'), { recursive: true, force: true });
});

describe('ack-state model (pending → injected → observed)', () => {
    it('markInjected advances only the injected marker, not the observed cursor', async () => {
        await seed(3);
        await mailbox.markInjected(RCVR, 2);
        const state = inboxState();
        expect(state.cursor).toBe(0); // NOT observed
        expect(state.injected).toBe(2);
        // All 3 are still un-observed (injection is not observation).
        expect((await mailbox.readUnobserved(RCVR)).map(e => e.seq)).toEqual([1, 2, 3]);
    });

    it('readUninjected returns only entries past the injected marker', async () => {
        await seed(3);
        await mailbox.markInjected(RCVR, 2);
        expect((await mailbox.readUninjected(RCVR)).map(e => e.seq)).toEqual([3]);
        await mailbox.markInjected(RCVR, 3);
        expect(await mailbox.readUninjected(RCVR)).toEqual([]);
    });

    it('markObserved advances the cursor, prunes pending, and keeps injected >= cursor', async () => {
        await seed(3);
        await mailbox.markInjected(RCVR, 1);
        await mailbox.markObserved(RCVR, 2); // observed past the injected marker
        const state = inboxState();
        expect(state.cursor).toBe(2);
        expect(state.injected).toBe(2); // bumped up to cursor
        expect(state.pending.map(e => e.seq)).toEqual([3]);
        expect((await mailbox.readUnobserved(RCVR)).map(e => e.seq)).toEqual([3]);
    });

    it('supports the full pending → injected → observed lifecycle for one entry', async () => {
        await seed(1);
        expect((await mailbox.readUninjected(RCVR)).map(e => e.seq)).toEqual([1]); // pending
        await mailbox.markInjected(RCVR, 1);
        expect(await mailbox.readUninjected(RCVR)).toEqual([]); // injected
        expect((await mailbox.readUnobserved(RCVR)).map(e => e.seq)).toEqual([1]); // still un-observed
        await mailbox.markObserved(RCVR, 1);
        expect(await mailbox.readUnobserved(RCVR)).toEqual([]); // observed
    });

    it('injected marker is monotonic and never regresses below cursor', async () => {
        await seed(3);
        await mailbox.markObserved(RCVR, 2);
        await mailbox.markInjected(RCVR, 1); // stale/lower — must not pull injected below cursor
        expect(inboxState().injected).toBe(2);
    });

    it('defaults injected to cursor for a legacy file that lacks the field', async () => {
        await seed(2);
        const file = path.join(tempHome, 'agent-comms', 'inboxes', RCVR, 'mailbox.json');
        // Simulate a pre-US-004 file: cursor advanced, NO injected field.
        fsSync.writeFileSync(file, JSON.stringify({ version: 1, cursor: 1, pending: [{ version: 1, seq: 2, id: 'x', appendedAt: Date.now(), sender: SENDER, body: {} }] }));
        // readUninjected should treat everything past cursor as un-injected.
        expect((await mailbox.readUninjected(RCVR)).map(e => e.seq)).toEqual([2]);
        // A fresh markInjected then persists an explicit injected marker.
        await mailbox.markInjected(RCVR, 2);
        expect(inboxState().injected).toBe(2);
    });

    it('appendMessage preserves an existing injected marker', async () => {
        await seed(2);
        await mailbox.markInjected(RCVR, 2);
        await mailbox.appendMessage(RCVR, { n: 99 }, SENDER);
        const state = inboxState();
        expect(state.injected).toBe(2);
        expect(state.pending.map(e => e.seq)).toEqual([1, 2, 3]);
        expect((await mailbox.readUninjected(RCVR)).map(e => e.seq)).toEqual([3]);
    });
});

describe('daemon-sole-writer lock gate', () => {
    it('defaults to off and toggles via setter', () => {
        expect(mailbox.isDaemonSoleWriter()).toBe(false);
        mailbox.setDaemonSoleWriter(true);
        expect(mailbox.isDaemonSoleWriter()).toBe(true);
        mailbox.setDaemonSoleWriter(false);
        expect(mailbox.isDaemonSoleWriter()).toBe(false);
    });

    it('elides the cross-process lock: append succeeds even while a fresh foreign lock is held', async () => {
        // Pre-create the inbox dir and a NON-stale lock held by a live pid. In
        // locked mode this would make appendMessage spin until the 5s deadline;
        // in sole-writer mode the lock is ignored and the append is immediate.
        const inboxDir = path.join(tempHome, 'agent-comms', 'inboxes', RCVR);
        await fs.mkdir(inboxDir, { recursive: true });
        const lockPath = path.join(inboxDir, 'mailbox.lock');
        await fs.writeFile(lockPath, `${JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() })}\n`);

        mailbox.setDaemonSoleWriter(true);
        const started = Date.now();
        const res = await Promise.race([
            mailbox.appendMessage(RCVR, { via: 'sole-writer' }, SENDER),
            new Promise<never>((_, reject) => setTimeout(() => reject(new Error('append blocked on lock')), 2000)),
        ]);
        expect(Date.now() - started).toBeLessThan(2000);
        expect(res.seq).toBe(1);
        expect((await mailbox.readUnobserved(RCVR)).map(e => e.body)).toEqual([{ via: 'sole-writer' }]);
    });

    it('still serializes concurrent appends in-process under sole-writer mode', async () => {
        mailbox.setDaemonSoleWriter(true);
        const N = 20;
        const results = await Promise.all(
            Array.from({ length: N }, (_, i) => mailbox.appendMessage(RCVR, { i }, SENDER)),
        );
        const seqs = results.map(r => r.seq).sort((a, b) => a - b);
        expect(seqs).toEqual(Array.from({ length: N }, (_, i) => i + 1)); // unique + contiguous
    });
});
