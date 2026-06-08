import chalk from 'chalk';
import { configuration } from '@/configuration';
import {
    enumerateDiscoveryRecords,
    isPidAlive,
    type CodexDiscoveryRecord,
} from './codexAppServerDiscovery';
import {
    instanceKey,
    readEvents,
    type CodexDaemonLifecycleEvent,
} from './codexDaemonLifecycle';
import { createWsTransport } from './transport/wsTransport';
import type { JsonRpcMessage } from './transport/JsonRpcConnection';
import { sampleProcessRssKb } from './processRss';

export type CodexDaemonDoctorState = 'live' | 'stale-pid-gone' | 'stale-unreachable' | 'post-mortem' | 'unparsable';

type ProbeResult = {
    pidAlive: boolean;
    wsInitialized: boolean;
    lastHealth: string;
    lastHealthAtMs?: number;
    rssKb?: number | null;
    version?: string;
};

type InstanceRow = {
    record: CodexDiscoveryRecord | null;
    events: CodexDaemonLifecycleEvent[];
    probe: ProbeResult | null;
    state: CodexDaemonDoctorState;
    parseError?: Error;
    filePath?: string;
};

type ProbeOptions = {
    timeoutMs?: number;
};

const DEFAULT_PROBE_TIMEOUT_MS = 1_500;

function discoveryStartedAtKey(record: CodexDiscoveryRecord): number | string {
    const startedAtMs = Date.parse(record.startedAt);
    return Number.isFinite(startedAtMs) ? startedAtMs : record.startedAt;
}

function eventTimeMs(event: CodexDaemonLifecycleEvent): number {
    switch (event.event) {
        case 'codex.daemon.spawn':
            return event.started_at_ms;
        case 'codex.daemon.reattach':
            return event.reattached_at_ms;
        case 'codex.daemon.disconnect':
            return event.disconnected_at_ms;
        case 'codex.daemon.exit':
            return event.exited_at_ms;
    }
}

function humanizeDuration(ms: number | null): string {
    if (ms === null || !Number.isFinite(ms)) return '';
    const totalSeconds = Math.max(0, Math.floor(ms / 1000));
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    if (hours > 0) return `${hours}h ${minutes}m`;
    if (minutes > 0) return `${minutes}m ${seconds}s`;
    return `${seconds}s`;
}

function truncate(value: string, maxLength: number): string {
    if (value.length <= maxLength) return value;
    return `${value.slice(0, Math.max(0, maxLength - 3))}...`;
}

function pad(value: string, width: number): string {
    return value.padEnd(width, ' ');
}

function stateLabel(state: CodexDaemonDoctorState): string {
    switch (state) {
        case 'live':
            return chalk.green(state);
        case 'post-mortem':
            return chalk.gray(state);
        case 'unparsable':
            return chalk.red(state);
        default:
            return chalk.yellow(state);
    }
}

function endpointCell(record: CodexDiscoveryRecord | null): string {
    if (!record) return '';
    const tokenHash = record.capabilityTokenSha256 ? ` sha256:${record.capabilityTokenSha256.slice(0, 8)}` : '';
    return `ws://127.0.0.1:${record.port}${tokenHash}`;
}

function lastEvent<T extends CodexDaemonLifecycleEvent['event']>(
    events: CodexDaemonLifecycleEvent[],
    event: T,
): Extract<CodexDaemonLifecycleEvent, { event: T }> | null {
    for (let i = events.length - 1; i >= 0; i--) {
        if (events[i].event === event) {
            return events[i] as Extract<CodexDaemonLifecycleEvent, { event: T }>;
        }
    }
    return null;
}

function startedAtMsForRow(row: InstanceRow): number | null {
    if (row.record) {
        const startedAtMs = Date.parse(row.record.startedAt);
        if (Number.isFinite(startedAtMs)) return startedAtMs;
    }
    return row.events[0]?.started_at_ms ?? null;
}

function versionForRow(row: InstanceRow): string {
    return row.probe?.version ?? row.record?.happyCliVersion ?? '';
}

function rssForRow(row: InstanceRow): string {
    if (row.probe?.rssKb !== null && row.probe?.rssKb !== undefined) {
        return String(row.probe.rssKb);
    }
    const exitEvent = lastEvent(row.events, 'codex.daemon.exit');
    return exitEvent?.rss_kb_at_exit === null || exitEvent?.rss_kb_at_exit === undefined
        ? ''
        : String(exitEvent.rss_kb_at_exit);
}

function lastHealthCellForRow(row: InstanceRow): string {
    if (row.probe?.lastHealthAtMs !== undefined) {
        return new Date(row.probe.lastHealthAtMs).toISOString();
    }
    return '';
}

function exitReasonForRow(row: InstanceRow): string {
    if (row.state === 'live') return '';
    return lastEvent(row.events, 'codex.daemon.exit')?.exit_reason ?? '';
}

function lastDisconnectForRow(row: InstanceRow): string {
    const ageMs = lastDisconnectAgeMsForRow(row, Date.now());
    return ageMs === null ? '' : humanizeDuration(ageMs);
}

function lastDisconnectAgeMsForRow(row: InstanceRow, nowMs: number): number | null {
    const exitEvent = lastEvent(row.events, 'codex.daemon.exit');
    if (!row.record && exitEvent) {
        return exitEvent.last_client_disconnect_age_ms;
    }
    const disconnectEvent = lastEvent(row.events, 'codex.daemon.disconnect');
    return disconnectEvent ? Math.max(0, nowMs - disconnectEvent.disconnected_at_ms) : null;
}

function disconnectAgeBucket(ageMs: number | null): '<1h' | '1-24h' | '>24h' | 'unknown' {
    if (ageMs === null) return 'unknown';
    if (ageMs < 60 * 60 * 1000) return '<1h';
    if (ageMs <= 24 * 60 * 60 * 1000) return '1-24h';
    return '>24h';
}

function disconnectAgeDistribution(rows: InstanceRow[], nowMs: number): string {
    const counts = new Map<string, number>([
        ['<1h', 0],
        ['1-24h', 0],
        ['>24h', 0],
        ['unknown', 0],
    ]);
    for (const row of rows) {
        const bucket = disconnectAgeBucket(lastDisconnectAgeMsForRow(row, nowMs));
        counts.set(bucket, (counts.get(bucket) ?? 0) + 1);
    }
    return `last-disconnect age: <1h=${counts.get('<1h')}, 1-24h=${counts.get('1-24h')}, >24h=${counts.get('>24h')}, unknown=${counts.get('unknown')}`;
}

function buildHeader(columns: string[], widths: number[]): string {
    return columns.map((column, index) => pad(column, widths[index])).join('  ');
}

function buildRows(rows: InstanceRow[]): string[] {
    const now = Date.now();
    const columns = ['state', 'pid', 'endpoint', 'cwd', 'age', 'RSS', 'last-health', 'last-disconnect', 'exit_reason', 'version'];
    const cells = rows.map((row) => {
        const startedAtMs = startedAtMsForRow(row);
        return [
            row.state,
            String(row.record?.pid ?? row.events[0]?.pid ?? ''),
            endpointCell(row.record),
            truncate(row.record?.cwd ?? row.events[0]?.cwd ?? row.filePath ?? '', 40),
            humanizeDuration(startedAtMs === null ? null : now - startedAtMs),
            rssForRow(row),
            lastHealthCellForRow(row),
            lastDisconnectForRow(row),
            row.parseError?.message ?? exitReasonForRow(row),
            versionForRow(row),
        ];
    });
    const widths = columns.map((column, index) => Math.max(column.length, ...cells.map((row) => row[index].length)));
    return [
        buildHeader(columns, widths),
        buildHeader(widths.map((width) => '-'.repeat(width)), widths),
        ...cells.map((row) => row.map((cell, index) => pad(index === 0 ? stateLabel(cell as CodexDaemonDoctorState) : cell, widths[index])).join('  ')),
    ];
}

async function requestInitialize(record: CodexDiscoveryRecord, timeoutMs: number): Promise<{ version?: string; jsonRpcError?: string }> {
    const transport = createWsTransport({
        url: `ws://127.0.0.1:${record.port}`,
        authToken: record.capabilityToken,
        handshakeTimeoutMs: timeoutMs,
    });
    const nextId = 1;
    try {
        await transport.open();
        const response = await new Promise<JsonRpcMessage>((resolve, reject) => {
            const timeout = setTimeout(() => reject(new Error(`initialize probe timed out after ${timeoutMs}ms`)), timeoutMs);
            transport.onMessage((message) => {
                if (message.id !== nextId) return;
                clearTimeout(timeout);
                resolve(message);
            });
            transport.onError((error) => {
                clearTimeout(timeout);
                reject(error);
            });
            transport.onClose(() => {
                clearTimeout(timeout);
                reject(new Error('ws probe closed before initialize completed'));
            });
            void transport.send({ jsonrpc: '2.0', id: nextId, method: 'initialize', params: {} }).catch((error) => {
                clearTimeout(timeout);
                reject(error instanceof Error ? error : new Error(String(error)));
            });
        });
        if (response.error) {
            return { jsonRpcError: response.error.message };
        }
        const result = response.result as { userAgent?: unknown; version?: unknown } | undefined;
        const version = typeof result?.version === 'string'
            ? result.version
            : typeof result?.userAgent === 'string'
                ? result.userAgent
                : undefined;
        return { version };
    } finally {
        await transport.close().catch(() => undefined);
    }
}

export async function probeCodexDaemon(record: CodexDiscoveryRecord, opts: ProbeOptions = {}): Promise<ProbeResult> {
    const pidAlive = isPidAlive(record.pid);
    const rssKb = await sampleProcessRssKb(record.pid);
    const lastHealthAtMs = Date.now();
    try {
        const initialized = await requestInitialize(record, opts.timeoutMs ?? DEFAULT_PROBE_TIMEOUT_MS);
        return {
            pidAlive,
            wsInitialized: true,
            lastHealth: initialized.jsonRpcError !== undefined ? `ok (rpc-error: ${initialized.jsonRpcError})` : 'ok',
            lastHealthAtMs,
            rssKb,
            ...(initialized.version !== undefined ? { version: initialized.version } : {}),
        };
    } catch (error) {
        return {
            pidAlive,
            wsInitialized: false,
            lastHealth: pidAlive ? 'failed' : 'pid-gone',
            lastHealthAtMs,
            rssKb,
        };
    }
}

export function classifyCodexDaemonState(
    record: CodexDiscoveryRecord | null,
    probe: ProbeResult | null,
): CodexDaemonDoctorState {
    if (!record) {
        return 'post-mortem';
    }
    if (probe?.pidAlive === false) return 'stale-pid-gone';
    if (probe?.pidAlive === true && probe.wsInitialized) return 'live';
    return 'stale-unreachable';
}

export function renderCodexDaemonTable(rows: InstanceRow[]): string {
    if (rows.length === 0) {
        return 'No codex app-server instances found.';
    }
    return buildRows(rows).join('\n');
}

export async function runCodexDoctor(args: string[]): Promise<number> {
    void args;
    let discoveryRows: Awaited<ReturnType<typeof enumerateDiscoveryRecords>>;
    try {
        discoveryRows = await enumerateDiscoveryRecords(configuration.happyHomeDir);
    } catch (error) {
        console.error(chalk.red(`Unable to read codex discovery directory: ${error instanceof Error ? error.message : String(error)}`));
        return 3;
    }

    const events = await readEvents(configuration.happyHomeDir);
    if (discoveryRows.length === 0 && events.length === 0) {
        console.log(renderCodexDaemonTable([]));
        console.log('0 live, 0 stale, 0 post-mortem (stdio sessions are foreground-owned and not discoverable by `happy codex doctor`)');
        return 2;
    }

    const eventsByKey = new Map<string, CodexDaemonLifecycleEvent[]>();
    for (const event of [...events].sort((left, right) => eventTimeMs(left) - eventTimeMs(right))) {
        const key = instanceKey({ pid: event.pid, startedAt: event.started_at_ms });
        eventsByKey.set(key, [...(eventsByKey.get(key) ?? []), event]);
    }

    const recordsByKey = new Map<string, CodexDiscoveryRecord>();
    const unparsableRows: InstanceRow[] = [];
    for (const row of discoveryRows) {
        if (row.record) {
            recordsByKey.set(instanceKey({ pid: row.record.pid, startedAt: discoveryStartedAtKey(row.record) }), row.record);
        } else if (row.parseError) {
            unparsableRows.push({
                record: null,
                events: [],
                probe: null,
                state: 'unparsable',
                parseError: row.parseError,
                filePath: row.filePath,
            });
        }
    }

    const keys = [...new Set([...recordsByKey.keys(), ...eventsByKey.keys()])].sort();
    const probeEntries = await Promise.all(keys.map(async (key) => {
        const record = recordsByKey.get(key) ?? null;
        return [key, record ? await probeCodexDaemon(record) : null] as const;
    }));
    const probesByKey = new Map(probeEntries);
    const rows = [
        ...keys.map((key): InstanceRow => {
            const record = recordsByKey.get(key) ?? null;
            const rowEvents = eventsByKey.get(key) ?? [];
            const probe = probesByKey.get(key) ?? null;
            return {
                record,
                events: rowEvents,
                probe,
                state: classifyCodexDaemonState(record, probe),
            };
        }),
        ...unparsableRows,
    ];

    console.log(renderCodexDaemonTable(rows));
    const liveCount = rows.filter((row) => row.state === 'live').length;
    const staleCount = rows.filter((row) => row.state === 'stale-pid-gone' || row.state === 'stale-unreachable').length;
    const postMortemCount = rows.filter((row) => row.state === 'post-mortem').length;
    const unparsableCount = rows.filter((row) => row.state === 'unparsable').length;
    console.log(`${liveCount} live, ${staleCount} stale, ${postMortemCount} post-mortem, ${unparsableCount} unparsable; ${disconnectAgeDistribution(rows, Date.now())} (stdio sessions are foreground-owned and not discoverable by \`happy codex doctor\`)`);
    return liveCount > 0 ? 0 : 1;
}
