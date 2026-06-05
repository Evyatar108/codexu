import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DISCOVERY_FILE_VERSION, type CodexDiscoveryRecord } from './codexAppServerDiscovery';
import type { CodexDaemonLifecycleEvent } from './codexDaemonLifecycle';

type TelemetryModule = typeof import('./codexDaemonTelemetry');
type LoggerModule = typeof import('@/ui/logger');

function lifecyclePath(homeDir: string): string {
    return join(homeDir, 'codex-daemons', 'lifecycle.jsonl');
}

async function importTelemetry(homeDir: string): Promise<{ telemetry: TelemetryModule; logger: LoggerModule['logger'] }> {
    vi.resetModules();
    process.env.HAPPY_HOME_DIR = homeDir;
    const [telemetry, loggerModule] = await Promise.all([
        import('./codexDaemonTelemetry'),
        import('@/ui/logger'),
    ]);
    return { telemetry, logger: loggerModule.logger };
}

function spawnEvent(overrides: Partial<Extract<CodexDaemonLifecycleEvent, { event: 'codex.daemon.spawn' }>> = {}): Extract<CodexDaemonLifecycleEvent, { event: 'codex.daemon.spawn' }> {
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

function discoveryRecord(overrides: Partial<CodexDiscoveryRecord> = {}): CodexDiscoveryRecord {
    const capabilityToken = overrides.capabilityToken ?? 'raw-token-fixture-never-sidecar';
    return {
        version: DISCOVERY_FILE_VERSION,
        pid: 4321,
        port: 12345,
        startedAt: '2027-01-15T12:00:00.000Z',
        happyCliVersion: '1.2.3-test',
        cwd: '/tmp/project',
        capabilityToken,
        capabilityTokenSha256: createHash('sha256').update(capabilityToken).digest('hex'),
        transport: 'ws',
        happySessionId: 'session-from-record',
        ...overrides,
    };
}

function eventFromDiscovery(record: CodexDiscoveryRecord): Extract<CodexDaemonLifecycleEvent, { event: 'codex.daemon.spawn' }> {
    return spawnEvent({
        pid: record.pid,
        started_at_ms: Date.parse(record.startedAt),
        cwd: record.cwd,
        endpoint: `ws://127.0.0.1:${record.port}`,
        happy_session_id: record.happySessionId,
    });
}

function readLog(path: string): string {
    return existsSync(path) ? readFileSync(path, 'utf8') : '';
}

describe('codex daemon telemetry emitter', () => {
    let tempRoot: string;
    let previousHappyHomeDir: string | undefined;
    let previousDebug: string | undefined;

    beforeEach(() => {
        previousHappyHomeDir = process.env.HAPPY_HOME_DIR;
        previousDebug = process.env.DEBUG;
        delete process.env.DEBUG;
        tempRoot = mkdtempSync(join(tmpdir(), 'happy-codex-telemetry-'));
    });

    afterEach(() => {
        if (previousHappyHomeDir === undefined) {
            delete process.env.HAPPY_HOME_DIR;
        } else {
            process.env.HAPPY_HOME_DIR = previousHappyHomeDir;
        }
        if (previousDebug === undefined) {
            delete process.env.DEBUG;
        } else {
            process.env.DEBUG = previousDebug;
        }
        vi.resetModules();
        rmSync(tempRoot, { recursive: true, force: true });
    });

    it('writes spawn events to the real logger file and sidecar', async () => {
        const { telemetry, logger } = await importTelemetry(tempRoot);
        const event = spawnEvent();

        await expect(telemetry.emitCodexDaemonEvent(event)).resolves.toBeUndefined();

        const logContent = readLog(logger.getLogPath());
        const debugLine = logContent.split(/\r?\n/).find((line) => line.includes('codex.daemon.spawn'));
        expect(debugLine).toBeDefined();
        expect(JSON.parse(debugLine!.slice(debugLine!.indexOf('{')))).toEqual(event);

        const sidecarLines = readFileSync(lifecyclePath(tempRoot), 'utf8').trim().split('\n');
        expect(sidecarLines).toHaveLength(1);
        expect(JSON.parse(sidecarLines[0])).toEqual(event);
    });

    it('resolves and warns when the sidecar cannot be written', async () => {
        const { telemetry, logger } = await importTelemetry(tempRoot);
        const event = spawnEvent();
        mkdirSync(lifecyclePath(tempRoot), { recursive: true });

        await expect(telemetry.emitCodexDaemonEvent(event)).resolves.toBeUndefined();

        const logContent = readLog(logger.getLogPath());
        expect(logContent).toContain(JSON.stringify(event));
        expect(logContent).toContain('[WARN] Failed to write codex daemon lifecycle event sidecar');
    });

    it('resolves and still writes the sidecar when the logger file cannot be written', async () => {
        process.env.DEBUG = '1';
        const { telemetry, logger } = await importTelemetry(tempRoot);
        const event = spawnEvent({ happy_session_id: 'logger-failure' });
        mkdirSync(logger.getLogPath(), { recursive: true });

        await expect(telemetry.emitCodexDaemonEvent(event)).resolves.toBeUndefined();

        const sidecarLines = readFileSync(lifecyclePath(tempRoot), 'utf8').trim().split('\n');
        expect(sidecarLines).toHaveLength(1);
        expect(JSON.parse(sidecarLines[0])).toEqual(event);
    });

    it('does not copy a raw discovery capability token into the sidecar', async () => {
        const { telemetry } = await importTelemetry(tempRoot);
        const record = discoveryRecord();

        await telemetry.emitCodexDaemonEvent(eventFromDiscovery(record));

        const sidecarContent = readFileSync(lifecyclePath(tempRoot), 'utf8');
        expect(sidecarContent).not.toContain(record.capabilityToken);
        expect(sidecarContent).not.toContain('capabilityToken');
        expect(JSON.parse(sidecarContent)).toEqual(eventFromDiscovery(record));
    });
});
