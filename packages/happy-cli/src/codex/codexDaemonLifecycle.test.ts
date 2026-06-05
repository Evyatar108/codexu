import { fork } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

type LifecycleModule = typeof import('./codexDaemonLifecycle');
type LifecycleEvent = z.infer<LifecycleModule['CodexDaemonLifecycleEvent']>;

const thisFile = fileURLToPath(import.meta.url);
const moduleUrl = pathToFileURL(join(dirname(thisFile), 'codexDaemonLifecycle.ts')).href;

function lifecyclePath(homeDir: string): string {
    return join(homeDir, 'codex-daemons', 'lifecycle.jsonl');
}

async function importLifecycle(homeDir: string): Promise<LifecycleModule> {
    vi.resetModules();
    process.env.HAPPY_HOME_DIR = homeDir;
    return import('./codexDaemonLifecycle');
}

function spawnEvent(overrides: Partial<Extract<LifecycleEvent, { event: 'codex.daemon.spawn' }>> = {}): Extract<LifecycleEvent, { event: 'codex.daemon.spawn' }> {
    return {
        event: 'codex.daemon.spawn',
        pid: 1234,
        started_at_ms: 1_800_000_000_000,
        cwd: '/tmp/project',
        endpoint: 'ws://127.0.0.1:12345',
        happy_session_id: 'session-1',
        cold_start_ms: 17,
        ...overrides,
    };
}

function reattachEvent(overrides: Partial<Extract<LifecycleEvent, { event: 'codex.daemon.reattach' }>> = {}): Extract<LifecycleEvent, { event: 'codex.daemon.reattach' }> {
    return {
        event: 'codex.daemon.reattach',
        pid: 1234,
        started_at_ms: 1_800_000_000_000,
        cwd: '/tmp/project',
        happy_session_id: 'session-1',
        reattached_at_ms: 1_800_000_000_500,
        ...overrides,
    };
}

function disconnectEvent(overrides: Partial<Extract<LifecycleEvent, { event: 'codex.daemon.disconnect' }>> = {}): Extract<LifecycleEvent, { event: 'codex.daemon.disconnect' }> {
    return {
        event: 'codex.daemon.disconnect',
        pid: 1234,
        started_at_ms: 1_800_000_000_000,
        cwd: '/tmp/project',
        happy_session_id: 'session-1',
        disconnected_at_ms: 1_800_000_001_000,
        last_client_disconnect_age_ms: null,
        ...overrides,
    };
}

function exitEvent(overrides: Partial<Extract<LifecycleEvent, { event: 'codex.daemon.exit' }>> = {}): Extract<LifecycleEvent, { event: 'codex.daemon.exit' }> {
    return {
        event: 'codex.daemon.exit',
        pid: 1234,
        started_at_ms: 1_800_000_000_000,
        cwd: '/tmp/project',
        happy_session_id: 'session-1',
        exited_at_ms: 1_800_000_002_000,
        exit_code: null,
        exit_signal: null,
        exit_reason: 'killed',
        uptime_ms: 2_000,
        rss_kb_at_exit: null,
        last_client_disconnect_age_ms: null,
        ...overrides,
    };
}

async function forkAppender(homeDir: string, childId: string, count: number, rotateAt: number | null): Promise<void> {
    const scriptPath = join(homeDir, `${childId}-append-worker.mjs`);
    writeFileSync(scriptPath, `
import { appendEvent, rotateIfNeeded } from ${JSON.stringify(moduleUrl)};

const [childId, countText, rotateAtText] = process.argv.slice(2);
const count = Number(countText);
const rotateAt = rotateAtText === 'none' ? null : Number(rotateAtText);
const largeCwd = '/tmp/' + 'x'.repeat(80 * 1024);

for (let index = 0; index < count; index += 1) {
  await appendEvent({
    event: 'codex.daemon.spawn',
    pid: process.pid,
    started_at_ms: 1900000000000 + index,
    cwd: largeCwd,
    endpoint: 'ws://127.0.0.1:12345',
    happy_session_id: childId + ':' + index,
    cold_start_ms: 0
  });
  if (rotateAt !== null && index === rotateAt) {
    rotateIfNeeded();
  }
}
`, 'utf8');

    await new Promise<void>((resolve, reject) => {
        const child = fork(scriptPath, [childId, String(count), rotateAt === null ? 'none' : String(rotateAt)], {
            env: { ...process.env, HAPPY_HOME_DIR: homeDir },
            execArgv: ['--import', 'tsx'],
            stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
        });
        child.once('error', reject);
        child.once('exit', (code, signal) => {
            if (code === 0) {
                resolve();
                return;
            }
            reject(new Error(`append worker ${childId} failed code=${code} signal=${signal ?? ''}`));
        });
    });
}

describe('codex daemon lifecycle sidecar', () => {
    let tempRoot: string;
    let previousHappyHomeDir: string | undefined;

    beforeEach(() => {
        previousHappyHomeDir = process.env.HAPPY_HOME_DIR;
        tempRoot = mkdtempSync(join(tmpdir(), 'happy-codex-lifecycle-'));
    });

    afterEach(() => {
        if (previousHappyHomeDir === undefined) {
            delete process.env.HAPPY_HOME_DIR;
        } else {
            process.env.HAPPY_HOME_DIR = previousHappyHomeDir;
        }
        vi.resetModules();
        rmSync(tempRoot, { recursive: true, force: true });
    });

    it('validates all four persisted event shapes and no health event', async () => {
        const lifecycle = await importLifecycle(tempRoot);
        const events = [spawnEvent(), reattachEvent(), disconnectEvent(), exitEvent()];

        for (const event of events) {
            expect(lifecycle.CodexDaemonLifecycleEvent.parse(JSON.parse(JSON.stringify(event)))).toEqual(event);
        }

        expect(() => lifecycle.CodexDaemonLifecycleEvent.parse({
            event: 'codex.daemon.health',
            pid: 1234,
            started_at_ms: 1_800_000_000_000,
            cwd: '/tmp/project',
        })).toThrow();
    });

    it('builds instance keys from pid and startedAt only', async () => {
        const lifecycle = await importLifecycle(tempRoot);

        expect(lifecycle.instanceKey({ pid: 1234, startedAt: 1_800_000_000_000 })).toBe('1234:1800000000000');
        expect(lifecycle.instanceKey({ pid: 1234, startedAt: '2026-06-04T12:00:00.000Z' })).toBe('1234:2026-06-04T12:00:00.000Z');
    });

    it('appends and reads events in order from the configured happy home', async () => {
        const lifecycle = await importLifecycle(tempRoot);
        const events = [spawnEvent(), reattachEvent(), disconnectEvent(), exitEvent()];

        for (const event of events) {
            await lifecycle.appendEvent(event);
        }

        expect(await lifecycle.readEvents()).toEqual(events);
        expect(readFileSync(lifecyclePath(tempRoot), 'utf8').trim().split('\n')).toHaveLength(4);
    });

    it('drops a malformed trailing line without throwing', async () => {
        const lifecycle = await importLifecycle(tempRoot);
        const events = [spawnEvent(), reattachEvent()];

        for (const event of events) {
            await lifecycle.appendEvent(event);
        }
        writeFileSync(lifecyclePath(tempRoot), '{not-json', { flag: 'a' });

        await expect(lifecycle.readEvents()).resolves.toEqual(events);
    });

    it('rotates once the sidecar exceeds five megabytes and writes fresh events afterward', async () => {
        const lifecycle = await importLifecycle(tempRoot);
        const largeCwd = '/tmp/' + 'x'.repeat(64 * 1024);

        for (let index = 0; (statSync(lifecyclePath(tempRoot), { throwIfNoEntry: false })?.size ?? 0) <= 5 * 1024 * 1024; index += 1) {
            await lifecycle.appendEvent(spawnEvent({
                started_at_ms: 1_800_000_000_000 + index,
                cwd: largeCwd,
                happy_session_id: `large:${index}`,
            }));
        }

        const priorContent = readFileSync(lifecyclePath(tempRoot), 'utf8');
        lifecycle.rotateIfNeeded();

        expect(existsSync(`${lifecyclePath(tempRoot)}.1`)).toBe(true);
        expect(readFileSync(`${lifecyclePath(tempRoot)}.1`, 'utf8')).toBe(priorContent);
        expect(existsSync(lifecyclePath(tempRoot))).toBe(false);

        const fresh = spawnEvent({ happy_session_id: 'fresh-after-rotate' });
        await lifecycle.appendEvent(fresh);

        expect(await lifecycle.readEvents()).toEqual([fresh]);
    });

    it('preserves all child-process appends across a concurrent rotation race', async () => {
        mkdirSync(join(tempRoot, 'codex-daemons'), { recursive: true });

        await Promise.all([
            forkAppender(tempRoot, 'child-a', 80, null),
            forkAppender(tempRoot, 'child-b', 80, 70),
        ]);

        const current = existsSync(lifecyclePath(tempRoot)) ? readFileSync(lifecyclePath(tempRoot), 'utf8') : '';
        const rotated = existsSync(`${lifecyclePath(tempRoot)}.1`) ? readFileSync(`${lifecyclePath(tempRoot)}.1`, 'utf8') : '';
        const ids = new Set(
            `${current}${rotated}`
                .trim()
                .split('\n')
                .filter(Boolean)
                .map((line) => JSON.parse(line) as { happy_session_id: string })
                .map((event) => event.happy_session_id),
        );

        for (const childId of ['child-a', 'child-b']) {
            for (let index = 0; index < 80; index += 1) {
                expect(ids.has(`${childId}:${index}`)).toBe(true);
            }
        }
        expect(ids.size).toBe(160);
    }, 20_000);

    it('does not expose a capabilityToken field in any schema shape', async () => {
        const lifecycle = await importLifecycle(tempRoot);
        const options = lifecycle.CodexDaemonLifecycleEvent.options;

        for (const option of options) {
            expect(Object.keys(option.shape)).not.toContain('capabilityToken');
            expect(Object.keys(option.shape)).not.toContain('capability_token');
        }
        expect(() => lifecycle.CodexDaemonLifecycleEvent.parse({
            ...spawnEvent(),
            capabilityToken: 'raw-token',
        })).toThrow();
    });
});
