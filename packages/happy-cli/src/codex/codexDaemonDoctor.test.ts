import {
    mkdirSync,
    mkdtempSync,
    readFileSync,
    rmSync,
    writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocketServer } from 'ws';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DISCOVERY_FILE_VERSION, isPidAlive, type CodexDiscoveryRecord } from './codexAppServerDiscovery';
import type { CodexDaemonLifecycleEvent } from './codexDaemonLifecycle';

const operationSpies = vi.hoisted(() => ({
    writeFileSync: vi.fn(),
    renameSync: vi.fn(),
    unlinkSync: vi.fn(),
    execSync: vi.fn(),
    sampleProcessRssKb: vi.fn(),
}));

vi.mock('node:fs', async (importActual) => {
    const actual = await importActual<typeof import('node:fs')>();
    return {
        ...actual,
        writeFileSync: (...args: Parameters<typeof actual.writeFileSync>) => {
            operationSpies.writeFileSync(...args);
            return actual.writeFileSync(...args);
        },
        renameSync: (...args: Parameters<typeof actual.renameSync>) => {
            operationSpies.renameSync(...args);
            return actual.renameSync(...args);
        },
        unlinkSync: (...args: Parameters<typeof actual.unlinkSync>) => {
            operationSpies.unlinkSync(...args);
            return actual.unlinkSync(...args);
        },
    };
});

vi.mock('node:child_process', async (importActual) => {
    const actual = await importActual<typeof import('node:child_process')>();
    return {
        ...actual,
        execSync: (...args: Parameters<typeof actual.execSync>) => {
            operationSpies.execSync(...args);
            return actual.execSync(...args);
        },
    };
});

vi.mock('./processRss', () => ({
    sampleProcessRssKb: operationSpies.sampleProcessRssKb,
}));

function shaFixture(seed: string): string {
    return seed.padEnd(64, 'a').slice(0, 64);
}

function discoveryRecord(overrides: Partial<CodexDiscoveryRecord> = {}): CodexDiscoveryRecord {
    return {
        version: DISCOVERY_FILE_VERSION,
        pid: process.pid,
        port: 4321,
        startedAt: new Date('2026-06-05T00:00:00.000Z').toISOString(),
        happyCliVersion: '1.2.3-test',
        cwd: '/tmp/project',
        capabilityToken: 'raw-token-fixture-never-render',
        capabilityTokenSha256: shaFixture('12345678'),
        transport: 'ws',
        ...overrides,
    };
}

function spawnEvent(overrides: Partial<Extract<CodexDaemonLifecycleEvent, { event: 'codex.daemon.spawn' }>> = {}): Extract<CodexDaemonLifecycleEvent, { event: 'codex.daemon.spawn' }> {
    return {
        event: 'codex.daemon.spawn',
        pid: 7777,
        started_at_ms: Date.UTC(2026, 5, 5, 0, 0, 0),
        cwd: '/tmp/post-mortem',
        endpoint: 'ws://127.0.0.1:4321',
        cold_start_ms: 12,
        ...overrides,
    };
}

function exitEvent(overrides: Partial<Extract<CodexDaemonLifecycleEvent, { event: 'codex.daemon.exit' }>> = {}): Extract<CodexDaemonLifecycleEvent, { event: 'codex.daemon.exit' }> {
    return {
        event: 'codex.daemon.exit',
        pid: 7777,
        started_at_ms: Date.UTC(2026, 5, 5, 0, 0, 0),
        cwd: '/tmp/post-mortem',
        exited_at_ms: Date.UTC(2026, 5, 5, 0, 1, 0),
        exit_code: 0,
        exit_signal: null,
        exit_reason: 'killed',
        uptime_ms: 60_000,
        rss_kb_at_exit: 12345,
        last_client_disconnect_age_ms: null,
        ...overrides,
    };
}

function writeRecord(homeDir: string, record: CodexDiscoveryRecord, name = 'codex-active-fixture.json'): void {
    writeFileSync(join(homeDir, name), JSON.stringify(record, null, 2));
}

function writeSidecar(homeDir: string, events: CodexDaemonLifecycleEvent[]): void {
    const dir = join(homeDir, 'codex-daemons');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'lifecycle.jsonl'), events.map((event) => JSON.stringify(event)).join('\n') + '\n');
}

async function importDoctor(homeDir: string): Promise<typeof import('./codexDaemonDoctor')> {
    vi.resetModules();
    process.env.HAPPY_HOME_DIR = homeDir;
    return import('./codexDaemonDoctor');
}

async function withWsServer(handler: (port: number) => Promise<void>): Promise<void> {
    const server = new WebSocketServer({ port: 0, host: '127.0.0.1' });
    server.on('connection', (socket) => {
        socket.on('message', (data) => {
            const request = JSON.parse(data.toString()) as { id?: number; method?: string };
            if (request.method === 'initialize') {
                socket.send(JSON.stringify({ jsonrpc: '2.0', id: request.id, result: { version: 'codex-test/1.0' } }));
            }
        });
    });
    await new Promise<void>((resolve) => server.once('listening', resolve));
    const address = server.address();
    if (typeof address === 'string' || address === null) {
        throw new Error('expected TCP server address');
    }
    try {
        await handler(address.port);
    } finally {
        await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
}

describe('codex daemon doctor', () => {
    let tempRoot: string;
    let homeDir: string;
    let previousHappyHomeDir: string | undefined;
    let logSpy: ReturnType<typeof vi.spyOn>;
    let errorSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
        previousHappyHomeDir = process.env.HAPPY_HOME_DIR;
        tempRoot = mkdtempSync(join(tmpdir(), 'happy-codex-doctor-'));
        homeDir = join(tempRoot, 'home');
        mkdirSync(homeDir, { recursive: true });
        logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
        errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        operationSpies.sampleProcessRssKb.mockResolvedValue(null);
    });

    afterEach(() => {
        logSpy.mockRestore();
        errorSpy.mockRestore();
        if (previousHappyHomeDir === undefined) {
            delete process.env.HAPPY_HOME_DIR;
        } else {
            process.env.HAPPY_HOME_DIR = previousHappyHomeDir;
        }
        vi.resetModules();
        rmSync(tempRoot, { recursive: true, force: true });
    });

    it('returns exit code 2 when no discovery records and no sidecar events exist', async () => {
        const { runCodexDoctor } = await importDoctor(homeDir);

        await expect(runCodexDoctor([])).resolves.toBe(2);
        expect(logSpy).toHaveBeenCalledWith('No codex app-server instances found.');
    });

    it('returns exit code 3 when HAPPY_HOME cannot be enumerated', async () => {
        const { runCodexDoctor } = await importDoctor(homeDir);
        rmSync(homeDir, { recursive: true, force: true });
        writeFileSync(homeDir, 'not a directory');

        await expect(runCodexDoctor([])).resolves.toBe(3);
        expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('Unable to read codex discovery directory'));
    });

    it('classifies a reachable discovery record as live and returns exit code 0', async () => {
        await withWsServer(async (port) => {
            const record = discoveryRecord({ port, cwd: join(tempRoot, 'project') });
            writeRecord(homeDir, record);
            const { runCodexDoctor } = await importDoctor(homeDir);

            await expect(runCodexDoctor([])).resolves.toBe(0);

            const output = logSpy.mock.calls.map((call) => String(call[0])).join('\n');
            expect(output).toContain('live');
            expect(output).toContain(`ws://127.0.0.1:${port}`);
            expect(output).toContain('codex-test/1.0');
        });
    });

    it('classifies a dead PID discovery record as stale-pid-gone and returns exit code 1', async () => {
        expect(isPidAlive(99_999_999)).toBe(false);
        await withWsServer(async (port) => {
            writeRecord(homeDir, discoveryRecord({ pid: 99_999_999, port }));
            const { runCodexDoctor } = await importDoctor(homeDir);

            await expect(runCodexDoctor([])).resolves.toBe(1);

            const output = logSpy.mock.calls.map((call) => String(call[0])).join('\n');
            expect(output).toContain('stale-pid-gone');
            expect(output).toContain('0 live, 1 stale, 0 post-mortem');
        });
    });

    it('classifies alive-but-unreachable records as stale-unreachable', async () => {
        const { classifyCodexDaemonState } = await importDoctor(homeDir);

        expect(classifyCodexDaemonState(
            discoveryRecord({ pid: process.pid }),
            { pidAlive: true, wsInitialized: false, lastHealth: 'failed' },
        )).toBe('stale-unreachable');
    });

    it('reports platform RSS samples for live probes', async () => {
        await withWsServer(async (port) => {
            const record = discoveryRecord({ pid: process.pid, port });
            operationSpies.sampleProcessRssKb.mockResolvedValue(2468);
            const { probeCodexDaemon } = await importDoctor(homeDir);

            const probe = await probeCodexDaemon(record);

            expect(probe.pidAlive).toBe(true);
            expect(probe.wsInitialized).toBe(true);
            expect(probe.rssKb).toBe(2468);
        });
    });

    it('classifies sidecar-only instances as post-mortem and returns exit code 1', async () => {
        writeSidecar(homeDir, [spawnEvent(), exitEvent({ last_client_disconnect_age_ms: 90_000 })]);
        const { runCodexDoctor } = await importDoctor(homeDir);

        await expect(runCodexDoctor([])).resolves.toBe(1);

        const output = logSpy.mock.calls.map((call) => String(call[0])).join('\n');
        expect(output).toContain('post-mortem');
        expect(output).toContain('killed');
        expect(output).toContain('/tmp/post-mortem');
        expect(output).toContain('last-disconnect age: <1h=1, 1-24h=0, >24h=0, unknown=0');
    });

    it('redacts raw capability tokens and renders the token hash prefix', async () => {
        await withWsServer(async (port) => {
            writeRecord(homeDir, discoveryRecord({ port }));
            const { runCodexDoctor } = await importDoctor(homeDir);

            await runCodexDoctor([]);

            const output = logSpy.mock.calls.map((call) => String(call[0])).join('\n');
            expect(output).not.toContain('raw-token-fixture-never-render');
            expect(output).toContain('sha256:12345678');
        });
    });

    it('does not write, rotate, remove, kill, or shell out while rendering post-mortem diagnostics', async () => {
        writeSidecar(homeDir, [spawnEvent(), exitEvent()]);
        const { runCodexDoctor } = await importDoctor(homeDir);
        operationSpies.writeFileSync.mockClear();
        operationSpies.renameSync.mockClear();
        operationSpies.unlinkSync.mockClear();
        operationSpies.execSync.mockClear();
        const killSpy = vi.spyOn(process, 'kill');

        try {
            await runCodexDoctor([]);
        } finally {
            killSpy.mockRestore();
        }

        expect(operationSpies.writeFileSync).not.toHaveBeenCalled();
        expect(operationSpies.renameSync).not.toHaveBeenCalled();
        expect(operationSpies.unlinkSync).not.toHaveBeenCalled();
        expect(killSpy).not.toHaveBeenCalled();
        expect(operationSpies.execSync).not.toHaveBeenCalled();
    });

    it('keeps the source export surface read-only and allowlisted', () => {
        const source = readFileSync(join(process.cwd(), 'src/codex/codexDaemonDoctor.ts'), 'utf8');
        const exportLines = source.split(/\r?\n/).filter((line) => line.startsWith('export '));

        expect(exportLines).toEqual([
            "export type CodexDaemonDoctorState = 'live' | 'stale-pid-gone' | 'stale-unreachable' | 'post-mortem' | 'unparsable';",
            'export async function probeCodexDaemon(record: CodexDiscoveryRecord, opts: ProbeOptions = {}): Promise<ProbeResult> {',
            'export function classifyCodexDaemonState(',
            'export function renderCodexDaemonTable(rows: InstanceRow[]): string {',
            'export async function runCodexDoctor(args: string[]): Promise<number> {',
        ]);
        expect(exportLines.join('\n')).not.toMatch(/kill|restart|remove|delete|terminate|mutate/i);
    });
});
