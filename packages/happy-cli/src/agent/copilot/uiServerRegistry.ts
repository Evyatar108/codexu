/**
 * Strict discovery and liveness monitoring for pre-existing Copilot ui-server entries.
 */

import { readdir, readFile, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

export const DEFAULT_UI_SERVER_STALE_MS = 5 * 60 * 1_000;
const UI_SERVER_MONITOR_INTERVAL_MS = 5_000;
const CONNECTION_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const STATUS_VALUES = new Set(['working', 'waiting', 'done', 'attention']);
const ATTENTION_KIND_VALUES = new Set(['error', 'permission', 'exit_plan', 'elicitation', 'user_input']);
const TERMINAL_EVENT_VALUES = new Set(['turn_end', 'abort']);

export type UiServerRegistryEntry = {
  schemaVersion: 1;
  kind?: 'ui-server';
  pid: number;
  host: '127.0.0.1' | 'localhost' | '::1';
  port: number;
  token: string;
  startedAt: string;
  copilotVersion: string;
  sessionId?: string;
  sessionName?: string;
  cwd?: string;
  branch?: string;
  model?: string;
  status?: 'working' | 'waiting' | 'done' | 'attention';
  attentionKind?: 'error' | 'permission' | 'exit_plan' | 'elicitation' | 'user_input';
  statusRevision?: number;
  lastTerminalEvent?: 'turn_end' | 'abort';
};

export type UiServerAttachTarget = {
  registry: UiServerRegistryEntry;
  waitForUnavailable: Promise<void>;
  dispose: () => void;
};

export type UiServerRegistryDependencies = {
  registryDirectory?: string;
  listFiles?: (path: string) => Promise<string[]>;
  readTextFile?: (path: string) => Promise<string>;
  readMtimeMs?: (path: string) => Promise<number>;
  isProcessAlive?: (pid: number) => boolean;
  now?: () => number;
  monitorIntervalMs?: number;
};

type ParseUiServerRegistryOptions = {
  expectedPid?: number;
  mtimeMs: number;
  nowMs: number;
  isProcessAlive: (pid: number) => boolean;
  staleMs?: number;
};

function defaultRegistryDirectory(): string {
  const copilotHome = process.env.COPILOT_HOME || join(homedir(), '.copilot');
  return join(copilotHome, 'servers');
}

/**
 * process.kill(pid, 0) performs a cross-platform existence probe without sending
 * a signal. EPERM still proves that a process exists, while other failures mean
 * the registry owner is no longer safely attachable.
 */
function processIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

function registryObject(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('Copilot ui-server registry entry is not an object');
  }
  return value as Record<string, unknown>;
}

function requiredString(entry: Record<string, unknown>, field: string): string {
  const value = entry[field];
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`Copilot ui-server registry entry has invalid ${field}`);
  }
  return value;
}

function optionalString(entry: Record<string, unknown>, field: string): string | undefined {
  const value = entry[field];
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`Copilot ui-server registry entry has invalid ${field}`);
  }
  return value;
}

function optionalEnum<T extends string>(
  entry: Record<string, unknown>,
  field: string,
  values: ReadonlySet<string>,
): T | undefined {
  const value = optionalString(entry, field);
  if (value === undefined) return undefined;
  if (!values.has(value)) throw new Error(`Copilot ui-server registry entry has invalid ${field}`);
  return value as T;
}

export function parseUiServerRegistryFile(
  source: string,
  options: ParseUiServerRegistryOptions,
): UiServerRegistryEntry {
  let decoded: unknown;
  try {
    decoded = JSON.parse(source);
  } catch {
    throw new Error('Copilot ui-server registry entry contains malformed JSON');
  }
  const entry = registryObject(decoded);
  if (entry.schemaVersion !== 1) {
    throw new Error('Copilot ui-server registry entry has unsupported schemaVersion');
  }
  if (entry.kind !== undefined && entry.kind !== 'ui-server') {
    throw new Error('Copilot ui-server registry entry has invalid kind');
  }
  if (!Number.isSafeInteger(entry.pid) || (entry.pid as number) < 1) {
    throw new Error('Copilot ui-server registry entry has invalid pid');
  }
  const pid = entry.pid as number;
  if (options.expectedPid !== undefined && pid !== options.expectedPid) {
    throw new Error('Copilot ui-server registry entry pid does not match its file name');
  }
  if (entry.host !== '127.0.0.1' && entry.host !== 'localhost' && entry.host !== '::1') {
    throw new Error('Copilot ui-server registry entry host is not loopback');
  }
  if (!Number.isInteger(entry.port) || (entry.port as number) < 1 || (entry.port as number) > 65_535) {
    throw new Error('Copilot ui-server registry entry has invalid port');
  }
  if (typeof entry.token !== 'string' || !CONNECTION_TOKEN_PATTERN.test(entry.token)) {
    throw new Error('Copilot ui-server registry entry has invalid connection token');
  }
  const startedAt = requiredString(entry, 'startedAt');
  if (!Number.isFinite(Date.parse(startedAt))) {
    throw new Error('Copilot ui-server registry entry has invalid startedAt');
  }
  const copilotVersion = requiredString(entry, 'copilotVersion');
  const staleMs = options.staleMs ?? DEFAULT_UI_SERVER_STALE_MS;
  if (options.nowMs - options.mtimeMs > staleMs) {
    throw new Error(`Copilot ui-server registry entry for PID ${pid} is stale`);
  }
  if (!options.isProcessAlive(pid)) {
    throw new Error(`Copilot ui-server registry entry for PID ${pid} is not running`);
  }

  const statusRevision = entry.statusRevision;
  if (statusRevision !== undefined && (!Number.isSafeInteger(statusRevision) || (statusRevision as number) < 0)) {
    throw new Error('Copilot ui-server registry entry has invalid statusRevision');
  }
  const sessionId = optionalString(entry, 'sessionId');
  const sessionName = optionalString(entry, 'sessionName');
  const cwd = optionalString(entry, 'cwd');
  const branch = optionalString(entry, 'branch');
  const model = optionalString(entry, 'model');
  const status = optionalEnum<NonNullable<UiServerRegistryEntry['status']>>(entry, 'status', STATUS_VALUES);
  const attentionKind = optionalEnum<NonNullable<UiServerRegistryEntry['attentionKind']>>(
    entry,
    'attentionKind',
    ATTENTION_KIND_VALUES,
  );
  const lastTerminalEvent = optionalEnum<NonNullable<UiServerRegistryEntry['lastTerminalEvent']>>(
    entry,
    'lastTerminalEvent',
    TERMINAL_EVENT_VALUES,
  );

  return {
    schemaVersion: 1,
    ...(entry.kind === 'ui-server' ? { kind: 'ui-server' as const } : {}),
    pid,
    host: entry.host,
    port: entry.port as number,
    token: entry.token,
    startedAt,
    copilotVersion,
    ...(sessionId !== undefined ? { sessionId } : {}),
    ...(sessionName !== undefined ? { sessionName } : {}),
    ...(cwd !== undefined ? { cwd } : {}),
    ...(branch !== undefined ? { branch } : {}),
    ...(model !== undefined ? { model } : {}),
    ...(status !== undefined ? { status } : {}),
    ...(attentionKind !== undefined ? { attentionKind } : {}),
    ...(statusRevision !== undefined ? { statusRevision: statusRevision as number } : {}),
    ...(lastTerminalEvent !== undefined ? { lastTerminalEvent } : {}),
  };
}

function candidateDescription(entry: UiServerRegistryEntry): string {
  return [
    `PID ${entry.pid}`,
    `sessionName=${entry.sessionName ?? '<absent>'}`,
    `cwd=${entry.cwd ?? '<absent>'}`,
    `startedAt=${entry.startedAt}`,
  ].join(', ');
}

export function selectUiServerRegistryEntry(
  entries: readonly UiServerRegistryEntry[],
  requestedPid?: number,
): UiServerRegistryEntry {
  if (requestedPid !== undefined) {
    const selected = entries.find((entry) => entry.pid === requestedPid);
    if (!selected) throw new Error(`No live attachable Copilot ui-server entry found for PID ${requestedPid}`);
    return selected;
  }
  if (entries.length === 0) {
    throw new Error('No live attachable Copilot ui-server registry entries were found');
  }
  if (entries.length > 1) {
    const candidates = entries.map(candidateDescription).join('\n  ');
    throw new Error(
      `Multiple live Copilot ui-server entries were found:\n  ${candidates}\nPass --attach-ui-server <pid> to select one.`,
    );
  }
  return entries[0];
}

async function readLiveEntry(
  path: string,
  expectedPid: number,
  dependencies: Required<Pick<
    UiServerRegistryDependencies,
    'readTextFile' | 'readMtimeMs' | 'isProcessAlive' | 'now'
  >>,
): Promise<UiServerRegistryEntry> {
  const [source, mtimeMs] = await Promise.all([
    dependencies.readTextFile(path),
    dependencies.readMtimeMs(path),
  ]);
  return parseUiServerRegistryFile(source, {
    expectedPid,
    mtimeMs,
    nowMs: dependencies.now(),
    isProcessAlive: dependencies.isProcessAlive,
  });
}

export async function discoverUiServerRegistryEntry(
  requestedPid: number | undefined,
  dependencies: UiServerRegistryDependencies = {},
): Promise<{ entry: UiServerRegistryEntry; path: string }> {
  const registryDirectory = dependencies.registryDirectory ?? defaultRegistryDirectory();
  const readers = {
    listFiles: dependencies.listFiles ?? readdir,
    readTextFile: dependencies.readTextFile ?? ((path: string) => readFile(path, 'utf8')),
    readMtimeMs: dependencies.readMtimeMs ?? (async (path: string) => (await stat(path)).mtimeMs),
    isProcessAlive: dependencies.isProcessAlive ?? processIsAlive,
    now: dependencies.now ?? Date.now,
  };

  if (requestedPid !== undefined) {
    const path = join(registryDirectory, `${requestedPid}.json`);
    try {
      return { entry: await readLiveEntry(path, requestedPid, readers), path };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'unknown validation failure';
      throw new Error(`Unable to attach to Copilot ui-server PID ${requestedPid}: ${message}`);
    }
  }

  let files: string[];
  try {
    files = await readers.listFiles(registryDirectory);
  } catch {
    throw new Error(`Unable to scan Copilot ui-server registry directory: ${registryDirectory}`);
  }
  const valid: Array<{ entry: UiServerRegistryEntry; path: string }> = [];
  for (const file of files) {
    const match = /^([1-9]\d*)\.json$/.exec(file);
    if (!match) continue;
    const pid = Number(match[1]);
    const path = join(registryDirectory, file);
    try {
      valid.push({ entry: await readLiveEntry(path, pid, readers), path });
    } catch {
      // Unrelated managed-server, malformed, stale, or dead rows are never attach candidates.
    }
  }
  valid.sort((left, right) => left.entry.pid - right.entry.pid);
  const entry = selectUiServerRegistryEntry(valid.map((candidate) => candidate.entry));
  return valid.find((candidate) => candidate.entry === entry)!;
}

export async function attachUiServerTarget(
  requestedPid: number | undefined,
  dependencies: UiServerRegistryDependencies = {},
): Promise<UiServerAttachTarget> {
  const selected = await discoverUiServerRegistryEntry(requestedPid, dependencies);
  const readMtimeMs = dependencies.readMtimeMs ?? (async (path: string) => (await stat(path)).mtimeMs);
  const isProcessAlive = dependencies.isProcessAlive ?? processIsAlive;
  const now = dependencies.now ?? Date.now;
  let disposed = false;
  let resolveUnavailable!: () => void;
  const waitForUnavailable = new Promise<void>((resolve) => {
    resolveUnavailable = resolve;
  });
  const timer = setInterval(() => {
    void readMtimeMs(selected.path).then((mtimeMs) => {
      if (!disposed
        && (now() - mtimeMs > DEFAULT_UI_SERVER_STALE_MS || !isProcessAlive(selected.entry.pid))) {
        resolveUnavailable();
      }
    }, () => {
      // Registry publishers may replace the file atomically, producing a
      // transient stat gap. The attached process PID remains the authoritative
      // liveness signal during that window.
      if (!disposed && !isProcessAlive(selected.entry.pid)) resolveUnavailable();
    });
  }, dependencies.monitorIntervalMs ?? UI_SERVER_MONITOR_INTERVAL_MS);
  timer.unref?.();

  return {
    registry: selected.entry,
    waitForUnavailable,
    dispose: () => {
      disposed = true;
      clearInterval(timer);
    },
  };
}
