declare module 'happy-server' {
  import type { FastifyInstance } from 'fastify';
  import type { AgentCommsEnvelope } from '@slopus/happy-wire';

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

  export interface AgentCommsIngestBody {
    envelope: AgentCommsEnvelope;
    signature: string;
    senderKeys: {
      ed25519PublicKey: string;
      ecdhPublicKey: string;
      ed25519Fingerprint?: string;
    };
  }

  export type AgentCommsIngestHandler = (body: AgentCommsIngestBody) => Promise<{ id: string; seq: number }>;

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
    auth?: 'tunnel' | 'loopback';
    paths?: ApiPaths;
    machineState?: MachineStateGetter;
    agentCommsIngest?: AgentCommsIngestHandler;
    enablePrettyLogs?: boolean;
  }

  export interface HappyServerSharedContext {
    dataDir: string;
    machineKey: string | Uint8Array;
    localUserId?: string;
    tofuPublicKeys?: TofuPublicKeys;
    publicUrl?: string;
    agentCommsIngest?: AgentCommsIngestHandler;
    enablePrettyLogs?: boolean;
  }

  export interface CreateAppConfig extends HappyServerSharedContext {
    port: number;
    host?: string;
    auth?: 'tunnel' | 'loopback';
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
