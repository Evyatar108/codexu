import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';

import * as z from 'zod';
import {
  createPublicPairingInvite,
  encodePublicPairingInvite,
  generatePairSecret,
  PUBLIC_PAIRING_INVITE_DEFAULT_TTL_MS,
  type PublicPairingInvite,
} from '@slopus/happy-wire';
import type { PublicAuthConfig, RemoteDeviceRecord } from 'happy-server';

import { configuration } from '@/configuration';

/**
 * Persisted opt-in config for the Cloudflare public-tunnel provider. Lives in a
 * restricted file (`public-tunnel.json`) inside the 0700 happyHomeDir because it
 * carries Cloudflare Access service-token secrets. Absent by default: without it
 * (and without the opt-in env flag) the daemon keeps the Dev Tunnels path.
 */
export const PublicTunnelConfigSchema = z.object({
  /** Public hostname the named tunnel serves, e.g. `happy.evyatar.dev`. */
  hostname: z.string().min(1),
  /** Cloudflare named-tunnel name (must already exist via `cloudflared tunnel create`). */
  tunnelName: z.string().min(1),
  cloudflareAccess: z.object({
    /** At least one Cloudflare Access service token — mandatory edge expectation. */
    serviceTokens: z
      .array(z.object({ clientId: z.string().min(1), clientSecret: z.string().min(1) }))
      .min(1),
    /**
     * Cloudflare Access team domain (e.g. `evyatar-codexu.cloudflareaccess.com`).
     * The origin uses it to derive the JWKS issuer + certs URL when verifying the
     * CF-injected `Cf-Access-Jwt-Assertion` JWT. Machine-specific — never hardcoded.
     */
    teamDomain: z.string().min(1),
    /** The Access application AUD tag the assertion's `aud` must include. */
    appAud: z.string().min(1),
    /** Optional explicit JWKS certs URL; defaults to the derived team-domain endpoint. */
    jwksUrl: z.string().url().optional(),
    /** Optional identity allowlist matched against the assertion's common_name/sub. */
    expectedServiceTokenNames: z.array(z.string()).optional(),
  }),
  /** Optional pairing-window tuning; defaults to the invite default TTL. */
  pairing: z
    .object({
      windowMs: z.number().int().positive().optional(),
    })
    .optional(),
  /** Optional device-proof freshness window override (ms). */
  freshnessMs: z.number().int().positive().optional(),
  /** Optional device-proof clock-skew allowance override (ms). */
  clockSkewMs: z.number().int().positive().optional(),
});

export type PublicTunnelConfig = z.infer<typeof PublicTunnelConfigSchema>;

export const PUBLIC_TUNNEL_PROVIDER_VALUE = 'cloudflare';

/**
 * True when the operator opted into the Cloudflare public-tunnel provider via
 * `HAPPY_TUNNEL_PROVIDER=cloudflare`. Default (unset / any other value) keeps the
 * Dev Tunnels provider — this function is the ONLY provider-selection switch.
 */
export function isPublicTunnelOptedIn(env: NodeJS.ProcessEnv = process.env): boolean {
  return (env.HAPPY_TUNNEL_PROVIDER ?? '').trim().toLowerCase() === PUBLIC_TUNNEL_PROVIDER_VALUE;
}

/**
 * Read + validate the persisted public-tunnel config. Returns null when the file
 * is absent. Throws a clear fail-closed error when the file exists but is invalid
 * JSON or fails schema validation (do NOT silently fall back to a public bind
 * without an edge expectation).
 */
export async function readPublicTunnelConfig(
  filePath: string = configuration.publicTunnelFile,
): Promise<PublicTunnelConfig | null> {
  if (!existsSync(filePath)) {
    return null;
  }
  let raw: string;
  try {
    raw = await readFile(filePath, 'utf-8');
  } catch (error) {
    throw new Error(`Failed to read public-tunnel config at ${filePath}: ${error instanceof Error ? error.message : String(error)}`);
  }
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(raw);
  } catch {
    throw new Error(`public-tunnel config at ${filePath} is not valid JSON`);
  }
  const result = PublicTunnelConfigSchema.safeParse(parsedJson);
  if (!result.success) {
    throw new Error(`public-tunnel config at ${filePath} is invalid: ${result.error.message}`);
  }
  return result.data;
}

/**
 * Fail-closed guard: a public listener may be brought up ONLY when a Cloudflare
 * Access edge expectation is present (at least one service token). This mirrors
 * the server-side `assertOperatorIdentityGate` edge requirement. Devices may be
 * empty at first start — pairing (`/pair/complete`) enrolls the first device.
 */
export function assertPublicBindReady(
  config: PublicTunnelConfig | null,
): asserts config is PublicTunnelConfig {
  if (!config) {
    throw new Error(
      'HAPPY_TUNNEL_PROVIDER=cloudflare requires a public-tunnel.json config (hostname, tunnelName, ' +
      'cloudflareAccess.serviceTokens). None was found. Corp policy blocks Dev Tunnels, so refusing to ' +
      'start rather than silently downgrading.',
    );
  }
  if (config.cloudflareAccess.serviceTokens.length === 0) {
    throw new Error(
      'Refusing to enable public mode: cloudflareAccess.serviceTokens is empty. A Cloudflare Access ' +
      'service token is mandatory for the public listener edge (defense in depth).',
    );
  }
  if (!config.cloudflareAccess.teamDomain || !config.cloudflareAccess.appAud) {
    throw new Error(
      'Refusing to enable public mode: cloudflareAccess.teamDomain and cloudflareAccess.appAud are ' +
      'mandatory. Real Cloudflare Access strips the service-token headers before the origin, so the ' +
      'origin verifies the CF-injected Cf-Access-Jwt-Assertion JWT — which requires the team domain ' +
      '(JWKS issuer) and the application AUD to validate.',
    );
  }
}

export interface BuildPublicModeInput {
  config: PublicTunnelConfig;
  /** Public server URL — `https://<hostname>`. */
  serverUrl: string;
  machineId: string;
  /** Already-paired devices (default none; first pairing enrolls one). */
  devices?: RemoteDeviceRecord[];
  /**
   * Durable-persistence hook invoked by the embedded happy-server after a NEW
   * device is TOFU-pinned via `/pair/complete`. The daemon wires this to persist
   * the enrolled device so the pin survives a daemon restart.
   */
  onDeviceEnrolled?: (device: RemoteDeviceRecord, allDevices: RemoteDeviceRecord[]) => void | Promise<void>;
  now?: () => Date;
}

export interface PublicMode {
  /** Server-side public auth config for the embedded happy-server public listener. */
  publicAuth: PublicAuthConfig;
  /** One-time invite the operator surfaces to the app to complete pairing. */
  invite: PublicPairingInvite;
}

/**
 * Assemble the coupled server-side {@link PublicAuthConfig} and the client-facing
 * {@link PublicPairingInvite} for a single daemon start. The one-time pairing
 * secret is generated once and shared between the two so `/pair/complete` on the
 * server validates the secret carried in the invite. The pairing window
 * (`windowOpenedAt`/`windowClosesAt`) is aligned to the invite's issued/expiry.
 */
export function buildPublicMode(input: BuildPublicModeInput): PublicMode {
  assertPublicBindReady(input.config);
  const nowFn = input.now ?? (() => new Date());
  const issuedAt = nowFn();
  const windowMs = input.config.pairing?.windowMs ?? PUBLIC_PAIRING_INVITE_DEFAULT_TTL_MS;
  const pairSecret = generatePairSecret();
  const primaryToken = input.config.cloudflareAccess.serviceTokens[0];

  const invite = createPublicPairingInvite({
    serverUrl: input.serverUrl,
    machineId: input.machineId,
    cloudflareAccess: {
      clientId: primaryToken.clientId,
      clientSecret: primaryToken.clientSecret,
    },
    pairSecret,
    issuedAt,
    ttlMs: windowMs,
  });

  const publicAuth: PublicAuthConfig = {
    devices: input.devices ?? [],
    edge: {
      serviceTokens: input.config.cloudflareAccess.serviceTokens.map((token) => ({
        clientId: token.clientId,
        clientSecret: token.clientSecret,
      })),
      assertion: {
        teamDomain: input.config.cloudflareAccess.teamDomain,
        appAud: input.config.cloudflareAccess.appAud,
        ...(input.config.cloudflareAccess.jwksUrl !== undefined
          ? { jwksUrl: input.config.cloudflareAccess.jwksUrl }
          : {}),
        ...(input.config.cloudflareAccess.expectedServiceTokenNames !== undefined
          ? { expectedIdentities: input.config.cloudflareAccess.expectedServiceTokenNames }
          : {}),
      },
    },
    ...(input.config.freshnessMs !== undefined ? { freshnessMs: input.config.freshnessMs } : {}),
    ...(input.config.clockSkewMs !== undefined ? { clockSkewMs: input.config.clockSkewMs } : {}),
    ...(input.onDeviceEnrolled !== undefined ? { onDeviceEnrolled: input.onDeviceEnrolled } : {}),
    pairing: {
      secret: pairSecret,
      windowOpenedAt: issuedAt.getTime(),
      windowClosesAt: new Date(invite.expiresAt).getTime(),
    },
  };

  return { publicAuth, invite };
}

/**
 * Persist the pairing invite to a restricted file and return its compact
 * base64url token (also suitable for logging / QR encoding by the caller).
 */
export async function writePublicPairingInvite(
  filePath: string,
  invite: PublicPairingInvite,
): Promise<string> {
  await writeFile(filePath, JSON.stringify(invite, null, 2), { mode: 0o600 });
  return encodePublicPairingInvite(invite);
}
