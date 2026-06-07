/**
 * Unit tests for the durable mailbox primitive (US-002).
 *
 * These tests exercise the real `writeJsonAtomically` helper from
 * `@slopus/happy-wire/node` (no mocks-as-main-proof) and a real temp
 * `HAPPY_HOME_DIR`. They pin: happy-path append -> readPending -> markConsumed;
 * cursor advances on consumption; retry-on-locked-read (simulated EBUSY);
 * leftover `.tmp` does not corrupt the next read; sessionId path-safety;
 * version-too-high entry rejection.
 */

import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import * as fsSync from 'node:fs';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { tmpdir } from 'node:os';

// ESM-correct way to make `fs.readFile` fail transiently for the retry test
// (you cannot `vi.spyOn` a live ESM module namespace export). We partial-mock
// `node:fs/promises`, preserving every real export and wrapping ONLY `readFile`
// with an arm-able EBUSY injector. When `failNextReadsWithEbusy` is 0 (the
// default for every other test) the wrapper delegates to the real readFile, so
// the rest of the suite still exercises real filesystem behaviour.
const readControl = vi.hoisted(() => ({ failNextReadsWithEbusy: 0 }));

vi.mock('node:fs/promises', async (importOriginal) => {
    const actual = await importOriginal<typeof import('node:fs/promises')>();
    const readFile = (async (...args: Parameters<typeof actual.readFile>) => {
        if (readControl.failNextReadsWithEbusy > 0) {
            readControl.failNextReadsWithEbusy--;
            const err = new Error('simulated EBUSY') as NodeJS.ErrnoException;
            err.code = 'EBUSY';
            throw err;
        }
        return (actual.readFile as (...a: unknown[]) => unknown)(...args);
    }) as typeof actual.readFile;
    return { ...actual, readFile };
});

const tempHome = fsSync.mkdtempSync(path.join(tmpdir(), 'happy-mailbox-test-'));
process.env.HAPPY_HOME_DIR = tempHome;

// eslint-disable-next-line @typescript-eslint/consistent-type-imports
let mailbox: typeof import('./mailbox');

beforeAll(async () => {
    mailbox = await import('./mailbox');
});

afterAll(async () => {
    await fs.rm(tempHome, { recursive: true, force: true });
});

afterEach(async () => {
    // Wipe the agent-comms inbox tree between tests so each test starts fresh.
    const root = path.join(tempHome, 'agent-comms');
    await fs.rm(root, { recursive: true, force: true });
});

describe('mailbox happy path', () => {
    it('append -> readPending -> markConsumed; subsequent readPending is empty', async () => {
        const sid = 'sess_happy_1';
        await mailbox.ensureInbox(sid);
        const a = await mailbox.appendMessage(sid, { kind: 'hello', n: 1 }, 'sess_sender_1');
        const b = await mailbox.appendMessage(sid, { kind: 'hello', n: 2 }, 'sess_sender_1');
        expect(a.seq).toBe(1);
        expect(b.seq).toBe(2);

        const pending = await mailbox.readPending(sid);
        expect(pending.map(e => e.seq)).toEqual([1, 2]);
        expect(pending[0].body).toEqual({ kind: 'hello', n: 1 });
        expect(pending[0].version).toBe(1);
        expect(pending[0].sender).toBe('sess_sender_1');

        await mailbox.markConsumed(sid, 2);
        const afterDrain = await mailbox.readPending(sid);
        expect(afterDrain).toEqual([]);
    });

    it('ensureInbox is idempotent and does not overwrite an inbox with pending entries', async () => {
        const sid = 'sess_idem';
        await mailbox.ensureInbox(sid);
        await mailbox.appendMessage(sid, { x: 1 }, 'sess_sender');
        await mailbox.ensureInbox(sid);
        await mailbox.ensureInbox(sid);
        const pending = await mailbox.readPending(sid);
        expect(pending.length).toBe(1);
    });

    it('history.jsonl is appended one JSON line per entry', async () => {
        const sid = 'sess_history';
        await mailbox.appendMessage(sid, { a: 1 }, 'sess_sender');
        await mailbox.appendMessage(sid, { a: 2 }, 'sess_sender');
        const historyPath = path.join(mailbox.inboxDirFor(sid), 'history.jsonl');
        const raw = await fs.readFile(historyPath, 'utf8');
        const lines = raw.trim().split('\n');
        expect(lines.length).toBe(2);
        const parsed = lines.map(l => JSON.parse(l));
        expect(parsed[0].seq).toBe(1);
        expect(parsed[1].seq).toBe(2);
        expect(parsed[0].version).toBe(1);
    });
});

describe('mailbox retry-on-locked-read', () => {
    it('retries readFile on EBUSY and succeeds on the second attempt', async () => {
        const sid = 'sess_retry';
        await mailbox.appendMessage(sid, { hello: 'world' }, 'sess_sender');

        // Arm a single EBUSY failure for the next read; readPending's retry loop
        // should absorb it and succeed on the second attempt.
        readControl.failNextReadsWithEbusy = 1;
        const pending = await mailbox.readPending(sid);
        expect(pending.length).toBe(1);
        expect(pending[0].body).toEqual({ hello: 'world' });
        // The injected failure was consumed (proving a retry actually happened).
        expect(readControl.failNextReadsWithEbusy).toBe(0);
    });
});

describe('mailbox leftover-tmp safety (F-011)', () => {
    it('leftover .tmp file in the inbox dir does NOT corrupt the next read', async () => {
        const sid = 'sess_tmp';
        await mailbox.appendMessage(sid, { ok: true }, 'sess_sender');
        const dir = mailbox.inboxDirFor(sid);
        // Simulate a crashed atomic write leaving a junk .tmp sibling.
        await fs.writeFile(path.join(dir, '.mailbox.json.99999.deadbeef.tmp'), '{not-json');
        const pending = await mailbox.readPending(sid);
        expect(pending.length).toBe(1);
        expect(pending[0].body).toEqual({ ok: true });
    });
});

describe('mailbox sessionId path safety (F-010)', () => {
    const valid = ['abc', 'A1_b-c', 'a'.repeat(128)];
    const invalid = ['', '../etc/passwd', 'has/slash', 'has\\backslash', 'a'.repeat(129), 'has space', 'a.b'];

    for (const sid of valid) {
        it(`accepts valid sessionId ${JSON.stringify(sid)}`, () => {
            expect(() => mailbox.inboxPathFor(sid)).not.toThrow();
        });
    }

    for (const sid of invalid) {
        it(`rejects invalid sessionId ${JSON.stringify(sid)}`, async () => {
            expect(() => mailbox.inboxPathFor(sid)).toThrow(mailbox.MailboxInvalidSessionIdError);
            expect(() => mailbox.inboxDirFor(sid)).toThrow(mailbox.MailboxInvalidSessionIdError);
            await expect(mailbox.appendMessage(sid, {}, 'good_sender')).rejects.toBeInstanceOf(mailbox.MailboxInvalidSessionIdError);
            await expect(mailbox.readPending(sid)).rejects.toBeInstanceOf(mailbox.MailboxInvalidSessionIdError);
        });
    }

    it('rejects an invalid sender even when target sessionId is valid', async () => {
        await expect(mailbox.appendMessage('good_target', {}, '../bad')).rejects.toBeInstanceOf(mailbox.MailboxInvalidSessionIdError);
    });
});

describe('mailbox version envelope (Northstar rule 1)', () => {
    it('readPending throws a typed error when an entry version is greater than max', async () => {
        const sid = 'sess_version';
        await mailbox.ensureInbox(sid);
        // Hand-craft a future-version state on disk.
        const file = mailbox.inboxPathFor(sid);
        const futureState = {
            version: 1,
            cursor: 0,
            pending: [
                { version: 2, seq: 1, id: 'future_1', appendedAt: Date.now(), sender: 'sess_sender', body: { future: true } },
            ],
        };
        await fs.writeFile(file, JSON.stringify(futureState));
        await expect(mailbox.readPending(sid)).rejects.toBeInstanceOf(mailbox.MailboxUnsupportedVersionError);
    });
});
