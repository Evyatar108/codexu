/**
 * Private native Copilot managed-server contracts used by the read-only mirror.
 */

import type { SessionEnvelope } from '@slopus/happy-wire';

export const COPILOT_NATIVE_VERSION = '1.0.71-3';
export const COPILOT_PROTOCOL_VERSION = 3;
export const COPILOT_REGISTRY_SCHEMA_VERSION = 2;

export const COPILOT_PROJECTED_EVENT_TYPES = [
  'session.start',
  'user.message',
  'assistant.turn_start',
  'assistant.message',
  'tool.execution_start',
  'tool.execution_complete',
  'assistant.turn_end',
  'abort',
  'session.error',
  'session.shutdown',
] as const;

export type CopilotProjectedEventType = typeof COPILOT_PROJECTED_EVENT_TYPES[number];

export type NativeEvent = {
  id: string;
  type: string;
  timestamp: string;
  ephemeral?: boolean;
  agentId?: string;
  data?: Record<string, unknown>;
  [key: string]: unknown;
};

export type EventLogPage = {
  events: NativeEvent[];
  cursor: string;
  cursorStatus: 'ok' | 'expired';
  hasMore: boolean;
};

export type CopilotRegistryEntry = {
  schemaVersion: 2;
  kind: 'managed-server';
  pid: number;
  host: string;
  port: number;
  token: string;
  sessionId: string;
  copilotVersion: string;
};

export type ProjectedDelivery = {
  sourceEventId: string;
  projectionIndex: number;
  envelope: SessionEnvelope;
  localId: string;
};

export type ProjectionDiagnostic =
  | 'invalid-event'
  | 'invalid-timestamp'
  | 'turn-mismatch'
  | 'missing-turn'
  | 'invalid-tool-name'
  | 'invalid-tool-arguments'
  | 'unknown-event';

export type ProjectionState = {
  lifecycleTurnId: string;
  openSourceTurnId: string | null;
  openHappyTurnId: string | null;
  terminalSeen: boolean;
  toolTurns: Map<string, string>;
  projectedToolCalls: Set<string>;
};

export type NativeNotificationHandler = (event: NativeEvent) => void;
