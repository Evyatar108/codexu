/**
 * Unit tests for the agent-comms startup recovery helper (US-005).
 *
 * Pins the "missed wakes are harmless" contract at the helper level: a wake is
 * pushed exactly once when mail is pending, never per-entry, and recovery never
 * advances the durable cursor (consumption is the bridge drain's job only).
 */

import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import * as fsSync from 'node:fs';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { tmpdir } from 'node:os';

const tempHome = fsSync.mkdtempSync(path.join(tmpdir(), 'happy-recovery-test-'));
process.env.HAPPY_HOME_DIR = tempHome;

let mailbox: typeof import('./mailbox');
let recovery: typeof import('./recovery');

beforeAll(async () => {
    mailbox = await import('./mailbox');
    recovery = await import('./recovery');
});

afterAll(async () => {
    await fs.rm(tempHome, { recursive: true, force: true });
});

afterEach(async () => {
    await fs.rm(path.join(tempHome, 'agent-comms'), { recursive: true, force: true });
});

interface CapturedMode { tag: string }
const MODE: CapturedMode = { tag: 'mode-under-test' };

function fakeQueue() {
    const pushes: { message: string; mode: CapturedMode }[] = [];
    return {
        pushes,
        push(message: string, mode: CapturedMode) {
            pushes.push({ message, mode });
        },
    };
}

describe('recoverPendingAgentCommsMessages', () => {
    it('empty inbox is a no-op (no push, wakeEnqueued false)', async () => {
        const queue = fakeQueue();
        const result = await recovery.recoverPendingAgentCommsMessages('sess_empty', queue, () => MODE);
        expect(result).toEqual({ wakeEnqueued: false });
        expect(queue.pushes).toHaveLength(0);
    });

    it('one pending entry enqueues exactly one wake tagged with the current mode', async () => {
        const sid = 'sess_one';
        await mailbox.appendMessage(sid, { hi: 1 }, 'sess_sender');
        const queue = fakeQueue();
        const result = await recovery.recoverPendingAgentCommsMessages(sid, queue, () => MODE);
        expect(result).toEqual({ wakeEnqueued: true });
        expect(queue.pushes).toHaveLength(1);
        expect(queue.pushes[0].message).toBe(recovery.AGENT_COMMS_WAKE_PROMPT);
        expect(queue.pushes[0].mode).toBe(MODE);
    });

    it('three pending entries still enqueue exactly one wake (not per-entry)', async () => {
        const sid = 'sess_three';
        await mailbox.appendMessage(sid, { n: 1 }, 'sess_sender');
        await mailbox.appendMessage(sid, { n: 2 }, 'sess_sender');
        await mailbox.appendMessage(sid, { n: 3 }, 'sess_sender');
        const queue = fakeQueue();
        const result = await recovery.recoverPendingAgentCommsMessages(sid, queue, () => MODE);
        expect(result).toEqual({ wakeEnqueued: true });
        expect(queue.pushes).toHaveLength(1);
    });

    it('does NOT mark anything consumed (cursor unchanged after recovery)', async () => {
        const sid = 'sess_cursor';
        await mailbox.appendMessage(sid, { keep: true }, 'sess_sender');
        const before = await mailbox.readPending(sid);
        expect(before).toHaveLength(1);

        await recovery.recoverPendingAgentCommsMessages(sid, fakeQueue(), () => MODE);

        const after = await mailbox.readPending(sid);
        expect(after).toHaveLength(1);
        expect(after[0].seq).toBe(before[0].seq);
    });
});
