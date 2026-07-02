declare module 'happy-server' {
  import type { FastifyInstance } from 'fastify';

  export interface ApiPaths {
    profile?: string;
    accountSettings?: string;
    loopbackCap?: string;
  }

  export interface MachineSelfState {
    machineId: string;
    hostname: string;
    tunnelPort: number;
    loopbackPort: number;
    tunnelUrl: string;
    lastSeenAt: number | string;
    owner: string;
  }

  export type MachineStateGetter = () => MachineSelfState | Promise<MachineSelfState>;

  /** A paired device allowed to present Ed25519 signed-request proofs (public mode). */
  export interface RemoteDeviceRecord {
    keyId: string;
    publicKey: string;
    label?: string;
  }

  /** A Cloudflare Access service token (client id + secret pair). */
  export interface EdgeAccessServiceToken {
    clientId: string;
    clientSecret: string;
  }

  export interface EdgeAccessConfig {
    serviceTokens: EdgeAccessServiceToken[];
  }

  /** Operator-opened pairing window + pre-shared secret gate for `/pair/complete`. */
  export interface PublicPairingConfig {
    secret: string;
    windowOpenedAt: number;
    windowClosesAt: number;
    now?: () => number;
  }

  /** Fail-closed public listener auth: pinned device verifier + mandatory edge check. */
  export interface PublicAuthConfig {
    devices: RemoteDeviceRecord[];
    edge: EdgeAccessConfig;
    freshnessMs?: number;
    clockSkewMs?: number;
    pairing?: PublicPairingConfig;
    /**
     * Durable-persistence hook invoked after a NEW device is TOFU-pinned via
     * `/pair/complete`. The daemon wires this to persist the enrolled device so it
     * survives a daemon restart. Awaited best-effort; a persistence failure does not
     * unpin the in-memory device.
     */
    onDeviceEnrolled?: (device: RemoteDeviceRecord, allDevices: RemoteDeviceRecord[]) => void | Promise<void>;
    now?: () => number;
  }

  export interface TofuPublicKeys {
    ed25519PublicKey: string | Uint8Array;
    x25519PublicKey: string | Uint8Array;
    x25519SecretKey?: Uint8Array;
    ed25519Fingerprint?: string;
  }

  export interface HappyServerConfig {
    dataDir: string;
    port: number;
    machineKey: string | Uint8Array;
    localUserId?: string;
    tofuPublicKeys?: TofuPublicKeys;
    host?: string;
    publicUrl?: string;
    auth?: 'tunnel' | 'loopback' | 'public';
    publicAuth?: PublicAuthConfig;
    paths?: ApiPaths;
    machineState?: MachineStateGetter;
    enablePrettyLogs?: boolean;
  }

  export interface HappyServerSharedContext {
    dataDir: string;
    machineKey: string | Uint8Array;
    localUserId?: string;
    tofuPublicKeys?: TofuPublicKeys;
    publicUrl?: string;
    enablePrettyLogs?: boolean;
  }

  export interface CreateAppConfig extends HappyServerSharedContext {
    port: number;
    host?: string;
    auth?: 'tunnel' | 'loopback' | 'public';
    publicAuth?: PublicAuthConfig;
    paths?: ApiPaths;
    machineState?: MachineStateGetter;
  }

  export interface HappyServerHandle {
    app: FastifyInstance;
    eventRouter: unknown;
    start: () => Promise<void>;
    stop: () => Promise<void>;
  }

  export interface BootstrapMachineForEmbeddedInput {
    machineId: string;
    metadata: string;
    daemonState: string | null;
    dataEncryptionKeyBase64?: string | null;
  }

  export function createApp(config: CreateAppConfig): HappyServerHandle;
  export function createHappyServer(config: HappyServerConfig): HappyServerHandle;
  export function bootstrapMachineForEmbedded(input: BootstrapMachineForEmbeddedInput): Promise<void>;
}
