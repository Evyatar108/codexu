/**
 * Closed, durable projection from native Copilot events to Happy envelopes.
 */

import { createHash } from 'node:crypto';
import { isAbsolute, relative, resolve, sep } from 'node:path';

import { createEnvelope, type SessionEnvelope } from '@slopus/happy-wire';

import type {
  NativeEvent,
  ProjectedDelivery,
  ProjectionDiagnostic,
  ProjectionState,
} from './types';

export type ProjectionResult = {
  deliveries: ProjectedDelivery[];
  diagnostics: ProjectionDiagnostic[];
};

export function stableCopilotId(namespace: string, ...parts: Array<string | number>): string {
  return createHash('sha256')
    .update([namespace, ...parts.map(String)].join('\0'))
    .digest('hex');
}

export function createProjectionState(happySessionId: string): ProjectionState {
  return {
    lifecycleTurnId: stableCopilotId('copilot-lifecycle-turn', happySessionId),
    openSourceTurnId: null,
    openHappyTurnId: null,
    terminalSeen: false,
    toolTurns: new Map(),
    projectedToolCalls: new Set(),
    pendingPromptKinds: new Map(),
  };
}

function data(event: NativeEvent): Record<string, unknown> {
  return typeof event.data === 'object' && event.data !== null && !Array.isArray(event.data)
    ? event.data
    : event;
}

function stringField(event: NativeEvent, key: string): string | undefined {
  const value = data(event)[key];
  return typeof value === 'string' ? value : undefined;
}

function booleanField(event: NativeEvent, key: string): boolean | undefined {
  const value = data(event)[key];
  return typeof value === 'boolean' ? value : undefined;
}

function sourceTurn(event: NativeEvent): string | undefined {
  return stringField(event, 'turnId');
}

function matchingTurn(event: NativeEvent, state: ProjectionState): string | null {
  const explicit = sourceTurn(event);
  if (state.openSourceTurnId === null || state.openHappyTurnId === null) return null;
  if (explicit !== undefined && explicit !== state.openSourceTurnId) return null;
  return state.openHappyTurnId;
}

function validToolName(value: unknown): value is string {
  return typeof value === 'string'
    && value.length > 0
    && Buffer.byteLength(value, 'utf8') <= 128
    && !/[\u0000-\u001f\u007f]/.test(value);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function projectViewArgs(value: unknown, workspace: string): Record<string, unknown> | null {
  if (!isPlainObject(value) || typeof value.path !== 'string' || /[\u0000-\u001f\u007f]/.test(value.path)) return null;
  const absolute = resolve(workspace, value.path);
  const workspaceAbsolute = resolve(workspace);
  const display = relative(workspaceAbsolute, absolute);
  if (display === '' || display === '..' || display.startsWith(`..${sep}`) || isAbsolute(display)) return null;
  const normalized = display.split(sep).join('/');
  if (Buffer.byteLength(normalized, 'utf8') > 512) return null;
  return { path: normalized };
}

function withStableIdentity(
  happySessionId: string,
  event: NativeEvent,
  index: number,
  envelope: SessionEnvelope,
): ProjectedDelivery {
  const id = stableCopilotId('copilot-envelope', happySessionId, event.id, index);
  return {
    sourceEventId: event.id,
    projectionIndex: index,
    envelope: { ...envelope, id },
    localId: stableCopilotId('copilot-local', happySessionId, event.id, index),
  };
}

export function projectNativeEvent(
  event: NativeEvent,
  state: ProjectionState,
  options: { happySessionId: string; workspace: string },
): ProjectionResult {
  const diagnostics: ProjectionDiagnostic[] = [];
  const isPromptEvent = event.type.endsWith('.requested') || event.type.endsWith('.completed');
  if ((event.ephemeral === true && !isPromptEvent) || typeof event.id !== 'string' || event.id.length === 0) {
    return { deliveries: [], diagnostics: ['invalid-event'] };
  }
  const time = Date.parse(event.timestamp);
  if (!Number.isFinite(time)) return { deliveries: [], diagnostics: ['invalid-timestamp'] };

  const envelopes: SessionEnvelope[] = [];
  const push = (envelope: SessionEnvelope): void => { envelopes.push(envelope); };

  switch (event.type) {
    case 'session.start': {
      push(createEnvelope('agent', {
        t: 'start',
        title: 'Copilot',
      }, { time, turn: state.lifecycleTurnId }));
      break;
    }
    case 'user.message': {
      const eventData = data(event);
      const content = eventData.content;
      if (eventData.agentId !== undefined || eventData.source !== undefined
        || eventData.isAutopilotContinuation === true || eventData.attachments !== undefined
        || eventData.transformedContent !== undefined
        || typeof content !== 'string' || content.trim().length === 0) {
        break;
      }
      push(createEnvelope('user', { t: 'text', text: content }, { time }));
      break;
    }
    case 'assistant.turn_start': {
      const turnId = sourceTurn(event);
      if (!turnId || state.openSourceTurnId !== null) {
        diagnostics.push('turn-mismatch');
        break;
      }
      state.openSourceTurnId = turnId;
      state.openHappyTurnId = stableCopilotId('copilot-turn', options.happySessionId, turnId);
      state.terminalSeen = false;
      state.toolTurns.clear();
      state.projectedToolCalls.clear();
      push(createEnvelope('agent', { t: 'turn-start' }, { time, turn: state.openHappyTurnId }));
      break;
    }
    case 'assistant.message': {
      const turn = matchingTurn(event, state);
      if (!turn) {
        diagnostics.push(state.openHappyTurnId ? 'turn-mismatch' : 'missing-turn');
        break;
      }
      const content = stringField(event, 'content');
      if (content?.trim()) push(createEnvelope('agent', { t: 'text', text: content }, { time, turn }));
      break;
    }
    case 'tool.execution_start': {
      const turn = matchingTurn(event, state);
      const toolName = stringField(event, 'toolName');
      const toolCallId = stringField(event, 'toolCallId');
      if (!turn) {
        diagnostics.push(state.openHappyTurnId ? 'turn-mismatch' : 'missing-turn');
        break;
      }
      if (!validToolName(toolName) || !toolCallId) {
        diagnostics.push('invalid-tool-name');
        break;
      }
      const argumentsValue = data(event).arguments;
      const args = toolName === 'view'
        ? projectViewArgs(argumentsValue, options.workspace)
        : {};
      if (args === null) {
        diagnostics.push('invalid-tool-arguments');
        break;
      }
      state.projectedToolCalls.add(toolCallId);
      state.toolTurns.set(toolCallId, turn);
      push(createEnvelope('agent', {
        t: 'tool-call-start',
        call: toolCallId,
        name: toolName,
        title: toolName,
        description: '',
        args,
      }, { time, turn }));
      break;
    }
    case 'tool.execution_complete': {
      const toolCallId = stringField(event, 'toolCallId');
      const turn = toolCallId ? state.toolTurns.get(toolCallId) : undefined;
      if (!toolCallId || !turn || !state.projectedToolCalls.has(toolCallId)) break;
      const explicit = sourceTurn(event);
      if (explicit !== undefined && explicit !== state.openSourceTurnId) {
        diagnostics.push('turn-mismatch');
        break;
      }
      push(createEnvelope('agent', { t: 'tool-call-end', call: toolCallId }, { time, turn }));
      break;
    }
    case 'assistant.turn_end': {
      const turnId = sourceTurn(event);
      if (!state.openHappyTurnId || !turnId || turnId !== state.openSourceTurnId || state.terminalSeen) {
        diagnostics.push('turn-mismatch');
        break;
      }
      state.terminalSeen = true;
      push(createEnvelope('agent', { t: 'turn-end', status: 'completed' }, { time, turn: state.openHappyTurnId }));
      state.openSourceTurnId = null;
      state.openHappyTurnId = null;
      break;
    }
    case 'abort': {
      if (state.openHappyTurnId && !state.terminalSeen) {
        state.terminalSeen = true;
        push(createEnvelope('agent', { t: 'turn-end', status: 'cancelled' }, { time, turn: state.openHappyTurnId }));
        state.openSourceTurnId = null;
        state.openHappyTurnId = null;
      }
      break;
    }
    case 'session.error': {
      if (state.terminalSeen) break;
      push(createEnvelope('agent', { t: 'service', text: 'Copilot session failed.' }, { time }));
      if (state.openHappyTurnId && !state.terminalSeen) {
        state.terminalSeen = true;
        push(createEnvelope('agent', { t: 'turn-end', status: 'failed' }, { time, turn: state.openHappyTurnId }));
        state.openSourceTurnId = null;
        state.openHappyTurnId = null;
      }
      break;
    }
    case 'session.shutdown':
      push(createEnvelope('agent', { t: 'stop' }, {
        id: stableCopilotId('copilot-stop', options.happySessionId),
        time,
        turn: state.lifecycleTurnId,
      }));
      break;
    case 'permission.requested': {
      const eventData = data(event);
      if (eventData.resolvedByHook === true || typeof eventData.requestId !== 'string') break;
      const promptRequest = isPlainObject(eventData.promptRequest) ? eventData.promptRequest : undefined;
      const permissionRequest = isPlainObject(eventData.permissionRequest) ? eventData.permissionRequest : undefined;
      // This flag describes approval risk for rendering and fail-closed approval.
      // A destructive permission remains deniable because denial cannot cause the action.
      const destructive = (promptRequest?.kind ?? permissionRequest?.kind) !== 'read';
      state.pendingPromptKinds.set(eventData.requestId, {
        promptType: 'answer-permission',
        destructive,
      });
      push(createEnvelope('agent', {
        t: 'copilot-prompt',
        requestId: eventData.requestId,
        promptType: 'answer-permission',
        state: 'pending',
        destructive,
        payload: eventData,
      }, { time }));
      break;
    }
    case 'user_input.requested':
    case 'elicitation.requested':
    case 'exit_plan_mode.requested': {
      const eventData = data(event);
      if (typeof eventData.requestId !== 'string') break;
      const promptType = event.type === 'user_input.requested'
        ? 'answer-ask-user' as const
        : event.type === 'elicitation.requested'
          ? 'answer-elicitation' as const
          : 'answer-plan' as const;
      state.pendingPromptKinds.set(eventData.requestId, { promptType, destructive: false });
      push(createEnvelope('agent', {
        t: 'copilot-prompt',
        requestId: eventData.requestId,
        promptType,
        state: 'pending',
        destructive: false,
        payload: eventData,
      }, { time }));
      break;
    }
    case 'permission.completed':
    case 'user_input.completed':
    case 'elicitation.completed':
    case 'exit_plan_mode.completed': {
      const eventData = data(event);
      if (typeof eventData.requestId !== 'string') break;
      const remembered = state.pendingPromptKinds.get(eventData.requestId);
      const promptType = remembered?.promptType ?? (
        event.type === 'permission.completed'
          ? 'answer-permission'
          : event.type === 'user_input.completed'
            ? 'answer-ask-user'
            : event.type === 'elicitation.completed'
              ? 'answer-elicitation'
              : 'answer-plan'
      );
      const destructive = remembered?.destructive ?? event.type === 'permission.completed';
      state.pendingPromptKinds.delete(eventData.requestId);
      push(createEnvelope('agent', {
        t: 'copilot-prompt',
        requestId: eventData.requestId,
        promptType,
        state: 'resolved',
        destructive,
        payload: eventData,
      }, { time }));
      break;
    }
    default:
      diagnostics.push('unknown-event');
  }

  return {
    deliveries: envelopes.map((envelope, index) => event.type === 'session.shutdown'
      ? {
        sourceEventId: event.id,
        projectionIndex: index,
        envelope,
        localId: stableCopilotId('copilot-stop', options.happySessionId),
      }
      : withStableIdentity(options.happySessionId, event, index, envelope)),
    diagnostics,
  };
}
