/**
 * Private native Copilot managed-server contracts used by the read-only mirror.
 */

import type { SessionEnvelope } from '@slopus/happy-wire';

export const COPILOT_NATIVE_VERSION = '1.0.71-3';
export const COPILOT_PROTOCOL_VERSION = 3;
export const COPILOT_REGISTRY_SCHEMA_VERSION = 2;
/**
 * Transport-level version string sent on `connect` per the T6 v3 contract.
 * Verified runtime builds (<= 1.0.80-ev.3) type-check this field as a string
 * but never validate its value, so '1' is accepted by both the legacy and the
 * v3 handshake. The negotiated response is still validated separately.
 */
export const COPILOT_CONNECT_PROTOCOL_VERSION = '1';
/**
 * Happy-protocol version expected in the `happy.attach` result when the
 * runtime advertises attach-level negotiation (T6 v3). Legacy runtimes omit
 * the field entirely and negotiate protocol 3 at `connect` instead.
 */
export const COPILOT_HAPPY_PROTOCOL_VERSION = '3';

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
  // Permission request/completion events are durable and reconstruct the
  // pending set during event-log replay. The other prompt families are
  // ephemeral and appear here for live notification filtering only.
  'permission.requested',
  'permission.completed',
  'user_input.requested',
  'user_input.completed',
  'elicitation.requested',
  'elicitation.completed',
  'exit_plan_mode.requested',
  'exit_plan_mode.completed',
] as const;

export type CopilotProjectedEventType = typeof COPILOT_PROJECTED_EVENT_TYPES[number];

export const COPILOT_LIVE_PROMPT_EVENT_TYPES = [
  'permission.requested',
  'permission.completed',
  'user_input.requested',
  'user_input.completed',
  'elicitation.requested',
  'elicitation.completed',
  'exit_plan_mode.requested',
  'exit_plan_mode.completed',
] as const;

export type CopilotLivePromptEventType = typeof COPILOT_LIVE_PROMPT_EVENT_TYPES[number];

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
  pendingPromptKinds: Map<string, {
    promptType: 'answer-permission' | 'answer-elicitation' | 'answer-plan' | 'answer-ask-user';
    destructive: boolean;
  }>;
};

export type NativeNotificationHandler = (event: NativeEvent) => void;
