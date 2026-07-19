/**
 * Direct spawn and fail-closed registry validation for Copilot managed-server.
 */

import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

import {
  COPILOT_NATIVE_VERSION,
  COPILOT_REGISTRY_SCHEMA_VERSION,
  type CopilotRegistryEntry,
} from './types';

export type ManagedTarget = {
  child: ChildProcess;
  registry: CopilotRegistryEntry;
  terminate: () => Promise<void>;
};

export type ManagedServerDependencies = {
  spawnProcess?: typeof spawn;
  readFile?: (path: string) => string;
  fileExists?: (path: string) => boolean;
  sleep?: (ms: number) => Promise<void>;
  randomToken?: () => string;
  resolveExecutable?: () => string;
};

function isLoopback(host: string): boolean {
  const normalized = host.toLowerCase();
  return normalized === '127.0.0.1' || normalized === '::1' || normalized === 'localhost';
}

function copilotHome(): string {
  return process.env.COPILOT_HOME || join(homedir(), '.copilot');
}

function resolveCopilotExecutable(): string {
  const override = process.env.HAPPY_COPILOT_BINARY;
  if (override) return override;
  const executable = process.platform === 'win32' ? 'where.exe' : 'which';
  const result = execFileSync(executable, ['copilot'], { encoding: 'utf8', windowsHide: true })
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean);
  if (!result) throw new Error('Copilot CLI executable was not found');
  return result;
}

function parseJsonConfig(source: string): { enabledFeatureFlags?: Record<string, unknown> } {
  let output = '';
  let inString = false;
  let escaped = false;
  for (let index = 0; index < source.length; index++) {
    const char = source[index];
    const next = source[index + 1];
    if (inString) {
      output += char;
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') {
      inString = true;
      output += char;
      continue;
    }
    if (char === '/' && next === '/') {
      while (index < source.length && source[index] !== '\n') index++;
      output += '\n';
      continue;
    }
    if (char === '/' && next === '*') {
      index += 2;
      while (index < source.length && !(source[index] === '*' && source[index + 1] === '/')) index++;
      index++;
      continue;
    }
    output += char;
  }
  return JSON.parse(output.replace(/,\s*([}\]])/g, '$1')) as { enabledFeatureFlags?: Record<string, unknown> };
}

function assertConfigAllowsManagedServer(readFile: (path: string) => string, fileExists: (path: string) => boolean): void {
  const candidates = [
    join(copilotHome(), 'config.json'),
    join(copilotHome(), 'settings.json'),
  ];
  for (const path of candidates) {
    if (!fileExists(path)) continue;
    const parsed = parseJsonConfig(readFile(path));
    if (parsed.enabledFeatureFlags?.COPILOT_AGENTS_TAB === false) {
      throw new Error('Copilot config disables COPILOT_AGENTS_TAB; managed-server is unavailable');
    }
  }
}

export function validateRegistryEntry(value: unknown, expected: {
  pid: number;
  token: string;
}): CopilotRegistryEntry {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('Copilot registry entry is not an object');
  }
  const entry = value as Record<string, unknown>;
  if (entry.schemaVersion !== COPILOT_REGISTRY_SCHEMA_VERSION
    || entry.kind !== 'managed-server'
    || entry.pid !== expected.pid
    || typeof entry.host !== 'string'
    || !isLoopback(entry.host)
    || typeof entry.port !== 'number'
    || !Number.isInteger(entry.port)
    || entry.port < 1
    || entry.port > 65535
    || entry.token !== expected.token
    || typeof entry.sessionId !== 'string'
    || entry.sessionId.length === 0
    || entry.copilotVersion !== COPILOT_NATIVE_VERSION) {
    throw new Error('Copilot registry entry failed validation');
  }
  return entry as CopilotRegistryEntry;
}

export async function spawnManagedTarget(
  options: { startupTimeoutMs?: number } = {},
  dependencies: ManagedServerDependencies = {},
): Promise<ManagedTarget> {
  const spawnProcess = dependencies.spawnProcess ?? spawn;
  const readFile = dependencies.readFile ?? ((path: string) => readFileSync(path, 'utf8'));
  const fileExists = dependencies.fileExists ?? existsSync;
  const sleep = dependencies.sleep ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));
  const token = (dependencies.randomToken ?? (() => randomBytes(32).toString('base64url')))();
  const executable = (dependencies.resolveExecutable ?? resolveCopilotExecutable)();
  assertConfigAllowsManagedServer(readFile, fileExists);

  const inheritedFlags = (process.env.COPILOT_CLI_ENABLED_FEATURE_FLAGS || '')
    .split(/[,;]/)
    .map((flag) => flag.trim())
    .filter(Boolean);
  const enabledFlags = [...new Set([...inheritedFlags, 'COPILOT_AGENTS_TAB'])].join(',');
  const env = { ...process.env };
  delete env.COPILOT_LOADER_PID;
  delete env.COPILOT_DETACHED_SESSION;
  delete env.COPILOT_DETACHED_PARENT_SESSION_ID;
  delete env.COPILOT_DETACHED_PARENT_ENGAGEMENT_ID;
  Object.assign(env, {
    COPILOT_CONNECTION_TOKEN: token,
    COPILOT_RUN_APP: '1',
    COPILOT_FORCE_WINDOWS_HIDE: '1',
    COPILOT_AGENTS_TAB: 'true',
    COPILOT_CLI_ENABLED_FEATURE_FLAGS: enabledFlags,
  });

  const child = spawnProcess(executable, [
    '--server',
    '--port', '0',
    '--managed-server',
    '--session-idle-timeout', '300',
  ], {
    cwd: process.cwd(),
    env,
    stdio: 'ignore',
    windowsHide: true,
    detached: false,
  });
  let childFailure: Error | null = null;
  child.on('error', (error) => { childFailure = error; });
  child.on('exit', (code, signal) => {
    childFailure = new Error(`Copilot managed-server exited early (${code ?? signal ?? 'unknown'})`);
  });
  if (!child.pid) throw new Error('Copilot managed-server did not produce a PID');

  const terminate = async (): Promise<void> => {
    if (child.exitCode !== null) return;
    child.kill('SIGTERM');
    await Promise.race([new Promise<void>((resolve) => child.once('exit', () => resolve())), sleep(2_000)]);
    if (child.exitCode === null) child.kill('SIGKILL');
  };

  const registryPath = join(copilotHome(), 'servers', `${child.pid}.json`);
  const deadline = Date.now() + (options.startupTimeoutMs ?? 20_000);
  try {
    while (Date.now() < deadline) {
      if (childFailure) throw childFailure;
      if (fileExists(registryPath)) {
        const registry = validateRegistryEntry(JSON.parse(readFile(registryPath)), { pid: child.pid, token });
        return { child, registry, terminate };
      }
      await sleep(50);
    }
    throw new Error('Timed out waiting for Copilot managed-server registry');
  } catch (error) {
    await terminate();
    throw error;
  }
}
