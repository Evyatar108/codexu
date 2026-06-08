/**
 * Cross-process regression for the durable mailbox lock (F-007).
 *
 * Lives in a SERIAL integration project (vitest.config.ts `integration-agent-comms`,
 * maxWorkers: 1) rather than the parallel unit suite: it forks real OS processes
 * (one appender, one consumer) that contend on the cross-process inbox lockfile,
 * and that contention is timing-sensitive under the 15-worker parallel unit run.
 * Run serially it mirrors the deterministic file-scoped behaviour.
 *
 * The race it proves: the daemon process appends (via /agent-comms/send) while
 * the consumer's OWN stdio-bridge process drains. Both are read-modify-write
 * cycles on the same mailbox.json in DIFFERENT OS processes, so the in-process
 * serialization chain cannot protect them — only the cross-process O_EXCL
 * lockfile can. Every appended message must be accounted for exactly once.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fsSync from 'node:fs';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { tmpdir } from 'node:os';
import { fork } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const tempHome = fsSync.mkdtempSync(path.join(tmpdir(), 'happy-mailbox-xproc-'));
process.env.HAPPY_HOME_DIR = tempHome;

let mailbox: typeof import('./mailbox');

beforeAll(async () => {
    mailbox = await import('./mailbox');
});

afterAll(async () => {
    await fs.rm(tempHome, { recursive: true, force: true });
});

describe('mailbox cross-process append/consume (F-007)', () => {
    const mailboxModuleUrl = pathToFileURL(
        path.join(path.dirname(fileURLToPath(import.meta.url)), 'mailbox.ts'),
    ).href;

    it('serializes the daemon-append vs bridge-consume race across OS processes with no message lost', async () => {
        const sessionId = 'sessXProc';
        const N = 40;
        const resultsPath = path.join(tempHome, 'consumed.jsonl');
        const workerPath = path.join(tempHome, 'mailbox-race-worker.mjs');
        // The worker retries transient lock-acquire timeouts so the test proves
        // "no message lost", not "never contends".
        fsSync.writeFileSync(workerPath, `
import { appendMessage, consumePending } from ${JSON.stringify(mailboxModuleUrl)};
import { appendFileSync } from 'node:fs';

const [role, sessionId, countText, resultsPath] = process.argv.slice(2);
const count = Number(countText);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function withRetry(fn) {
  for (let attempt = 0; ; attempt += 1) {
    try { return await fn(); }
    catch (e) { if (attempt >= 8) throw e; await sleep(20 + attempt * 10); }
  }
}

if (role === 'appender') {
  for (let i = 0; i < count; i += 1) {
    await withRetry(() => appendMessage(sessionId, { i }, 'sessSenderX'));
  }
} else {
  let collected = 0;
  const deadline = Date.now() + 15000;
  while (collected < count && Date.now() < deadline) {
    const entries = await withRetry(() => consumePending(sessionId, (e) => e));
    for (const e of entries) {
      appendFileSync(resultsPath, JSON.stringify(e.body.i) + '\\n');
      collected += 1;
    }
    await sleep(entries.length === 0 ? 8 : 3);
  }
}
`);

        const runWorker = (role: 'appender' | 'consumer') => new Promise<void>((resolve, reject) => {
            const child = fork(workerPath, [role, sessionId, String(N), resultsPath], {
                env: { ...process.env, HAPPY_HOME_DIR: tempHome },
                execArgv: ['--import', 'tsx'],
                stdio: ['ignore', 'ignore', 'inherit', 'ipc'],
            });
            child.once('error', reject);
            child.once('exit', (code) => {
                code === 0 ? resolve() : reject(new Error(`mailbox race worker '${role}' exited with code ${code}`));
            });
        });

        await Promise.all([runWorker('appender'), runWorker('consumer')]);

        // What the consumer drained, plus anything still pending (parent drains
        // the remainder), must together cover every appended message exactly once.
        const consumed = fsSync.existsSync(resultsPath)
            ? fsSync.readFileSync(resultsPath, 'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l) as number)
            : [];
        const remaining = await mailbox.consumePending(sessionId, (entries) => entries.map(e => (e.body as { i: number }).i));
        const all = [...consumed, ...remaining].sort((a, b) => a - b);
        expect(all).toEqual(Array.from({ length: N }, (_, i) => i));
    }, 45000);
});
