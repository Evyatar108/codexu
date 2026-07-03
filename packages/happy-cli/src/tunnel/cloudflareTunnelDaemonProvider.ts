import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { configuration } from '@/configuration';
import { logger } from '@/ui/logger';
import type { CommandRunner, ProcessSpawner } from './tunnelManager';
import type { CreateHostTunnelOptions, DaemonTunnelProvider, LoadHostTunnelOptions } from './provider';
import { TunnelConfigSchema, type TunnelConfig } from './types';

const DEFAULT_CLOUDFLARED_COMMAND = 'cloudflared';
const DAEMON_CONFIG_DIR_NAME = 'cloudflared';
const DAEMON_CONFIG_FILE_NAME = 'config.yml';

// Hostnames like `happy.evyatar.dev`: dotted labels of alphanumerics/hyphens, no leading/trailing hyphen per label.
const HOSTNAME_PATTERN = /^(?=.{1,253}$)([A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/;
// Cloudflare named-tunnel names: alphanumerics plus dot/underscore/hyphen; must start alphanumeric.
const TUNNEL_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

const DNS_ROUTE_ALREADY_EXISTS = /already (?:exists|configured)|record with that host|An A, AAAA, or CNAME record with that host already exists|already has a/i;

const defaultRunner: CommandRunner = (command, args) => {
  const result = spawnSync(command, args, {
    encoding: 'utf-8',
    windowsHide: true,
  });

  return {
    status: result.status ?? 1,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? (result.error instanceof Error ? result.error.message : ''),
  };
};

const defaultSpawner: ProcessSpawner = (command, args) => spawn(command, args, {
  detached: true,
  stdio: 'ignore',
  windowsHide: true,
});

export type CloudflareTunnelDaemonProviderOptions = {
  /** Public hostname the named tunnel serves, e.g. `happy.evyatar.dev`. */
  hostname: string;
  /** Cloudflare named-tunnel name (must already exist via `cloudflared tunnel create`). */
  tunnelName: string;
  runner?: CommandRunner;
  spawner?: ProcessSpawner;
  now?: () => Date;
  cloudflaredCommand?: string;
  /** When true (default), idempotently ensure the DNS route exists before running. */
  ensureDnsRoute?: boolean;
  /**
   * Directory the daemon writes its OWN cloudflared config into. Defaults to
   * `<happyHomeDir>/cloudflared`. Kept separate from the global `~/.cloudflared`
   * so the daemon's ingress is authoritative and never merges with a stray
   * operator-global `config.yml`.
   */
  configDir?: string;
  /**
   * Directory holding the tunnel credentials JSON (`<tunnel-id>.json`) that
   * `cloudflared tunnel create` writes. Defaults to `~/.cloudflared`.
   */
  cloudflaredHomeDir?: string;
};

/** Values resolved during {@link CloudflareTunnelDaemonProvider.prepare} and reused when spawning the host. */
type CloudflaredRunContext = {
  tunnelId: string;
  credentialsFile: string;
};

/**
 * DaemonTunnelProvider backed by an OUTBOUND-ONLY Cloudflare named tunnel.
 *
 * `cloudflared tunnel run` dials the Cloudflare edge (no inbound ports are opened
 * on the host) and forwards `https://<hostname>` traffic to the embedded happy-server
 * listening on `127.0.0.1:<port>`. This is the corp-policy-safe replacement for
 * Microsoft Dev Tunnels: it never requires an inbound listener and never touches the
 * blocked Dev Tunnels service.
 *
 * All subprocess access flows through an injectable {@link CommandRunner} /
 * {@link ProcessSpawner} so the provider is unit-testable without a real
 * `cloudflared` binary or a live tunnel.
 */
export class CloudflareTunnelDaemonProvider implements DaemonTunnelProvider {
  private readonly hostname: string;
  private readonly tunnelName: string;
  private readonly runner: CommandRunner;
  private readonly spawner: ProcessSpawner;
  private readonly now: () => Date;
  private readonly cloudflared: string;
  private readonly ensureDns: boolean;
  private readonly configDir: string;
  private readonly cloudflaredHomeDir: string;
  private hostProcess: ChildProcess | null = null;

  constructor(options: CloudflareTunnelDaemonProviderOptions) {
    const hostname = options.hostname.trim();
    const tunnelName = options.tunnelName.trim();
    if (!HOSTNAME_PATTERN.test(hostname)) {
      throw new Error(`Cloudflare tunnel hostname contains invalid characters: ${options.hostname}`);
    }
    if (!TUNNEL_NAME_PATTERN.test(tunnelName)) {
      throw new Error(`Cloudflare tunnel name contains invalid characters: ${options.tunnelName}`);
    }
    this.hostname = hostname;
    this.tunnelName = tunnelName;
    this.runner = options.runner ?? defaultRunner;
    this.spawner = options.spawner ?? defaultSpawner;
    this.now = options.now ?? (() => new Date());
    this.cloudflared = options.cloudflaredCommand ?? DEFAULT_CLOUDFLARED_COMMAND;
    this.ensureDns = options.ensureDnsRoute ?? true;
    this.configDir = options.configDir ?? join(configuration.happyHomeDir, DAEMON_CONFIG_DIR_NAME);
    this.cloudflaredHomeDir = options.cloudflaredHomeDir ?? join(homedir(), '.cloudflared');
  }

  async createHostTunnel(options: CreateHostTunnelOptions): Promise<TunnelConfig> {
    const { config, runContext } = await this.prepare();
    this.startHost(options.port, runContext);
    return config;
  }

  async loadHostTunnel(options: LoadHostTunnelOptions): Promise<TunnelConfig> {
    if (options.additionalPorts && options.additionalPorts.length > 0) {
      // A single named-tunnel hostname forwards only the primary port; Scope A ingest
      // ports are reachable via loopback on the same machine, not through this hostname.
      logger.debug(
        `[CF-TUNNEL] Named tunnel ${this.tunnelName} forwards only primary port ${options.port}; ` +
        `ignoring additionalPorts ${options.additionalPorts.join(',')}`,
      );
    }
    const { config, runContext } = await this.prepare();
    this.startHost(options.port, runContext);
    return config;
  }

  stop(): void {
    if (!this.hostProcess) return;
    try {
      this.hostProcess.kill('SIGTERM');
    } catch {
      // Process may already have exited.
    }
    this.hostProcess = null;
  }

  private async prepare(): Promise<{ config: TunnelConfig; runContext: CloudflaredRunContext }> {
    this.assertCloudflaredInstalled();
    const tunnelId = this.resolveTunnelId();
    const credentialsFile = this.resolveCredentialsFile(tunnelId);
    if (this.ensureDns) {
      this.ensureDnsRoute();
    }
    const config = TunnelConfigSchema.parse({
      tunnelId,
      tunnelName: this.tunnelName,
      tunnelUrl: `https://${this.hostname}`,
      createdAt: this.now().toISOString(),
    });
    return { config, runContext: { tunnelId, credentialsFile } };
  }

  private assertCloudflaredInstalled(): void {
    const result = this.runner(this.cloudflared, ['--version']);
    if (result.status !== 0) {
      throw new Error(
        'cloudflared CLI was not found. Install Cloudflare Tunnel (cloudflared) and create the named ' +
        'tunnel before enabling public mode.',
      );
    }
  }

  private resolveTunnelId(): string {
    const result = this.runner(this.cloudflared, ['tunnel', 'list', '--output', 'json']);
    if (result.status !== 0) {
      throw new Error(
        `Failed to list Cloudflare tunnels: ${result.stderr || result.stdout || 'unknown error'}`,
      );
    }
    const tunnelId = parseCloudflareTunnelId(`${result.stdout}\n${result.stderr}`, this.tunnelName);
    if (!tunnelId) {
      throw new Error(
        `Cloudflare named tunnel "${this.tunnelName}" was not found. Create it with ` +
        `\`cloudflared tunnel create ${this.tunnelName}\` before enabling public mode.`,
      );
    }
    return tunnelId;
  }

  /**
   * Resolve the tunnel credentials JSON that `cloudflared tunnel create` wrote for
   * this tunnel (default `~/.cloudflared/<tunnel-id>.json`). It is referenced by the
   * daemon-owned config so `cloudflared tunnel run` can authenticate the tunnel by
   * UUID without needing `cert.pem`. Fails loud when absent rather than letting
   * cloudflared start against an unexpected credentials location.
   */
  private resolveCredentialsFile(tunnelId: string): string {
    const credentialsFile = join(this.cloudflaredHomeDir, `${tunnelId}.json`);
    if (!existsSync(credentialsFile)) {
      throw new Error(
        `Cloudflare tunnel credentials file for "${this.tunnelName}" (${tunnelId}) was not found at ` +
        `${credentialsFile}. \`cloudflared tunnel create ${this.tunnelName}\` writes this file; re-run ` +
        `tunnel creation, or set cloudflaredHomeDir to the directory that holds <tunnel-id>.json. ` +
        `(Follow-up: a non-default credentials location is not yet auto-discovered.)`,
      );
    }
    return credentialsFile;
  }

  private ensureDnsRoute(): void {
    const result = this.runner(this.cloudflared, ['tunnel', 'route', 'dns', this.tunnelName, this.hostname]);
    if (result.status === 0) {
      return;
    }
    const output = `${result.stdout}\n${result.stderr}`;
    if (DNS_ROUTE_ALREADY_EXISTS.test(output)) {
      logger.debug(`[CF-TUNNEL] DNS route for ${this.hostname} already exists; continuing`);
      return;
    }
    throw new Error(
      `Failed to configure Cloudflare DNS route for ${this.hostname}: ${result.stderr || result.stdout || 'unknown error'}`,
    );
  }

  private startHost(localPort: number, runContext: CloudflaredRunContext): void {
    if (this.hostProcess) return;

    // BUG 2 FIX: make the daemon's ingress authoritative regardless of any global
    // `~/.cloudflared/config.yml`. cloudflared reads the global config.yml by default,
    // and its `ingress:` rules WIN over `--url` — a stale operator config (e.g. one
    // routing the hostname at a now-dead origin) silently caused every request through
    // the tunnel to 502. We instead write our OWN config with an explicit ingress and
    // run `cloudflared tunnel --config <ours> run`, so the global config is NOT consulted
    // (passing --config overrides the default config path entirely). The config pins the
    // tunnel by UUID + credentials-file so no `cert.pem` lookup is needed at run time.
    const configPath = this.writeDaemonConfig(localPort, runContext);

    // Outbound-only: cloudflared connects OUT to the Cloudflare edge and forwards
    // inbound HTTPS to the embedded server on loopback. No inbound port is opened here.
    // `--config` must precede `run` (it is a `tunnel` command option, not a `run` option).
    this.hostProcess = this.spawner(this.cloudflared, [
      'tunnel',
      '--config',
      configPath,
      'run',
    ]);
    this.hostProcess.on('error', (error) => {
      logger.debug(`[CF-TUNNEL] cloudflared host failed for ${this.tunnelName}: ${error.message}`);
    });
    this.hostProcess.on('exit', (code, signal) => {
      logger.debug(`[CF-TUNNEL] cloudflared host exited for ${this.tunnelName}: code=${code}, signal=${signal}`);
      this.hostProcess = null;
    });
    this.hostProcess.unref?.();
    logger.debug(`[CF-TUNNEL] Started cloudflared host for ${this.tunnelName} (config ${configPath}) -> 127.0.0.1:${localPort}`);
  }

  /**
   * Write the daemon-owned cloudflared config that makes the ingress authoritative.
   * Lives under a happy-owned dir (not `~/.cloudflared`) so it never merges with a
   * stray global `config.yml`. Returns the config file path.
   */
  private writeDaemonConfig(localPort: number, runContext: CloudflaredRunContext): string {
    mkdirSync(this.configDir, { recursive: true, mode: 0o700 });
    const configPath = join(this.configDir, DAEMON_CONFIG_FILE_NAME);
    // hostname/tunnelId are constrained (regex/UUID); the credentials path is the only
    // free-form value, so single-quote it (YAML single-quotes take backslashes literally,
    // which keeps Windows paths intact; a literal `'` is escaped by doubling).
    const credentialsYaml = `'${runContext.credentialsFile.replace(/'/g, "''")}'`;
    const yaml = [
      `tunnel: ${runContext.tunnelId}`,
      `credentials-file: ${credentialsYaml}`,
      'ingress:',
      `  - hostname: ${this.hostname}`,
      `    service: http://127.0.0.1:${localPort}`,
      '  - service: http_status:404',
      '',
    ].join('\n');
    writeFileSync(configPath, yaml, { mode: 0o600 });
    logger.debug(
      `[CF-TUNNEL] Wrote daemon cloudflared config ${configPath} (ingress ${this.hostname} -> 127.0.0.1:${localPort})`,
    );
    return configPath;
  }
}

/**
 * Extract the tunnel UUID matching `name` from `cloudflared tunnel list --output json`.
 *
 * The intended payload is a JSON array of `{ id, name, ... }` records, but real
 * cloudflared output is not clean: it interleaves the array with human/log noise
 * and — since ~2026.5.0 — an "outdated version" WARNING emitted as a SEPARATE
 * top-level JSON object line AFTER the array, e.g.
 *
 *   [ { "id": "...", "name": "happy", ... } ]
 *   {"level":"warn","message":"Your version ... is outdated ...","time":"..."}
 *
 * A naive `JSON.parse(output.slice(firstBracket))` throws on that trailing object
 * (trailing data after the array) and used to make the daemon FATAL with
 * "named tunnel was not found" even though the tunnel exists. To stay robust to
 * leading/trailing/interleaved non-JSON, we scan for every balanced top-level
 * JSON value (array or object), parse each independently, and search the flattened
 * records. Returns null when the name is genuinely absent or nothing parses; it
 * never throws. Both a bare array and a single object are supported.
 */
export function parseCloudflareTunnelId(output: string, name: string): string | null {
  for (const value of extractTopLevelJsonValues(output)) {
    const records = Array.isArray(value) ? value : [value];
    for (const record of records) {
      if (record && typeof record === 'object') {
        const rec = record as Record<string, unknown>;
        if (rec.name === name && typeof rec.id === 'string' && rec.id.length > 0) {
          return rec.id;
        }
      }
    }
  }
  return null;
}

/**
 * Walk `output` and return every balanced top-level JSON value (array or object)
 * that parses, ignoring any surrounding/interleaving non-JSON noise. A bracket that
 * does not begin valid JSON (stray `[`/`{` in log text) is skipped and scanning
 * resumes at the next character.
 */
function extractTopLevelJsonValues(output: string): unknown[] {
  const values: unknown[] = [];
  let index = 0;
  while (index < output.length) {
    const char = output[index];
    if (char === '[' || char === '{') {
      const end = findBalancedEnd(output, index);
      if (end > index) {
        try {
          values.push(JSON.parse(output.slice(index, end + 1)));
          index = end + 1;
          continue;
        } catch {
          // Not valid JSON despite balanced brackets; treat as noise and advance.
        }
      }
    }
    index += 1;
  }
  return values;
}

/**
 * Given the index of an opening `[`/`{`, return the index of its matching close
 * bracket (respecting nested brackets and string literals), or -1 if unbalanced.
 */
function findBalancedEnd(output: string, start: number): number {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < output.length; i += 1) {
    const char = output[i];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === '\\') {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }
    if (char === '"') {
      inString = true;
    } else if (char === '[' || char === '{') {
      depth += 1;
    } else if (char === ']' || char === '}') {
      depth -= 1;
      if (depth === 0) {
        return i;
      }
    }
  }
  return -1;
}
