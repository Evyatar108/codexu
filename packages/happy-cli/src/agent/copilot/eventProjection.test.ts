import { describe, expect, it } from 'vitest';

import { createProjectionState, projectNativeEvent } from './eventProjection';
import type { NativeEvent } from './types';

const options = { happySessionId: 'happy-1', workspace: process.cwd() };

function event(type: string, id: string, data: Record<string, unknown> = {}): NativeEvent {
  return { id, type, timestamp: '2026-07-19T00:00:00.000Z', data };
}

describe('Copilot event projection', () => {
  it('projects durable turn messages and terminal state exactly once', () => {
    const state = createProjectionState(options.happySessionId);
    const projected = [
      event('assistant.turn_start', '1', { turnId: 'turn-1' }),
      event('assistant.message', '2', { turnId: 'turn-1', content: ' first ' }),
      event('assistant.message', '3', { content: 'second' }),
      event('assistant.turn_end', '4', { turnId: 'turn-1' }),
      event('abort', '5'),
    ].flatMap((item) => projectNativeEvent(item, state, options).deliveries);

    expect(projected.map((item) => item.envelope.ev.t)).toEqual([
      'turn-start', 'text', 'text', 'turn-end',
    ]);
    expect(projected[1].envelope.turn).toBe(projected[2].envelope.turn);
    expect(projected[1].envelope.ev).toEqual({ t: 'text', text: ' first ' });
    expect(new Set(projected.map((item) => item.localId)).size).toBe(projected.length);
  });

  it('projects only safe user fields and fixed error text', () => {
    const state = createProjectionState(options.happySessionId);
    expect(projectNativeEvent(event('user.message', '1', {
      content: 'safe',
      transformedContent: 'secret',
    }), state, options).deliveries).toEqual([]);
    expect(projectNativeEvent(event('user.message', 'safe', {
      content: 'safe',
    }), state, options).deliveries[0].envelope.ev).toEqual({ t: 'text', text: 'safe' });
    expect(projectNativeEvent(event('user.message', '2', {
      content: 'hidden',
      source: 'system',
    }), state, options).deliveries).toEqual([]);

    const error = projectNativeEvent(event('session.error', '3', {
      message: 'private stack',
      stack: 'secret',
    }), state, options);
    expect(error.deliveries).toHaveLength(1);
    expect(error.deliveries[0].envelope.ev).toEqual({ t: 'service', text: 'Copilot session failed.' });

    const completed = createProjectionState(options.happySessionId);
    projectNativeEvent(event('assistant.turn_start', '4', { turnId: 'turn-1' }), completed, options);
    projectNativeEvent(event('assistant.turn_end', '5', { turnId: 'turn-1' }), completed, options);
    expect(projectNativeEvent(event('session.error', '6'), completed, options).deliveries).toEqual([]);
  });

  it('preserves only validated view paths and redacts every other tool argument shape', () => {
    const state = createProjectionState(options.happySessionId);
    projectNativeEvent(event('assistant.turn_start', '1', { turnId: 'turn-1' }), state, options);

    const safeView = projectNativeEvent(event('tool.execution_start', '2', {
      turnId: 'turn-1',
      toolName: 'view',
      toolCallId: 'call-1',
      arguments: { path: 'package.json', ignored: 'secret' },
    }), state, options);
    expect(safeView.deliveries[0].envelope.ev).toMatchObject({
      t: 'tool-call-start',
      name: 'view',
      args: { path: 'package.json' },
    });

    const shell = projectNativeEvent(event('tool.execution_start', '3', {
      toolName: 'powershell',
      toolCallId: 'call-2',
      arguments: { command: 'Get-Secret' },
    }), state, options);
    expect(shell.deliveries[0].envelope.ev).toMatchObject({ name: 'powershell', args: {} });

    const lookalike = projectNativeEvent(event('tool.execution_start', '3b', {
      toolName: 'VIEW',
      toolCallId: 'call-lookalike',
      arguments: { path: 'private.txt' },
    }), state, options);
    expect(lookalike.deliveries[0].envelope.ev).toMatchObject({ name: 'VIEW', args: {} });

    const outside = projectNativeEvent(event('tool.execution_start', '4', {
      toolName: 'view',
      toolCallId: 'call-3',
      arguments: { path: '..\\outside.txt' },
    }), state, options);
    expect(outside.deliveries).toEqual([]);
    expect(outside.diagnostics).toContain('invalid-tool-arguments');
  });

  it('omits ephemeral, unknown, malformed, and streaming events', () => {
    const state = createProjectionState(options.happySessionId);
    expect(projectNativeEvent({ ...event('assistant.message_delta', '1'), ephemeral: true }, state, options).deliveries).toEqual([]);
    expect(projectNativeEvent(event('assistant.message_delta', '2'), state, options).deliveries).toEqual([]);
    expect(projectNativeEvent({ ...event('session.start', '3'), timestamp: 'not-a-date' }, state, options).deliveries).toEqual([]);
  });

  it('projects live prompt state and fails closed on non-read permission kinds', () => {
    const state = createProjectionState(options.happySessionId);
    const safe = projectNativeEvent({
      ...event('permission.requested', 'permission-1', {
        requestId: 'request-1',
        promptRequest: { kind: 'read', path: 'README.md' },
      }),
      ephemeral: true,
    }, state, options);
    expect(safe.deliveries[0].envelope.ev).toMatchObject({
      t: 'copilot-prompt',
      requestId: 'request-1',
      promptType: 'answer-permission',
      state: 'pending',
      destructive: false,
    });

    const unknown = projectNativeEvent({
      ...event('permission.requested', 'permission-2', {
        requestId: 'request-2',
        promptRequest: { kind: 'future-kind' },
      }),
      ephemeral: true,
    }, state, options);
    expect(unknown.deliveries[0].envelope.ev).toMatchObject({ destructive: true });

    const fallback = projectNativeEvent(event('permission.requested', 'permission-fallback', {
      requestId: 'request-fallback',
      permissionRequest: { kind: 'read', path: 'README.md' },
    }), state, options);
    expect(fallback.deliveries[0].envelope.ev).toMatchObject({ destructive: false });

    const completed = projectNativeEvent(event('permission.completed', 'permission-3', {
      requestId: 'request-1',
      result: { kind: 'approved' },
    }), state, options);
    expect(completed.deliveries[0].envelope.ev).toMatchObject({
      requestId: 'request-1',
      state: 'resolved',
      destructive: false,
    });
  });

  it('projects ask-user, elicitation, and plan prompts without marking them destructive', () => {
    const state = createProjectionState(options.happySessionId);
    const projected = [
      event('user_input.requested', 'input', { requestId: 'input-1', question: 'Choose', choices: ['A'] }),
      event('elicitation.requested', 'elicitation', { requestId: 'elicitation-1', message: 'Provide data' }),
      event('exit_plan_mode.requested', 'plan', {
        requestId: 'plan-1',
        summary: 'Plan',
        planContent: '# Plan',
        actions: ['approve'],
        recommendedAction: 'approve',
      }),
    ].flatMap((item) => projectNativeEvent({ ...item, ephemeral: true }, state, options).deliveries);

    expect(projected.map((item) => item.envelope.ev)).toEqual([
      expect.objectContaining({ promptType: 'answer-ask-user', destructive: false }),
      expect.objectContaining({ promptType: 'answer-elicitation', destructive: false }),
      expect.objectContaining({ promptType: 'answer-plan', destructive: false }),
    ]);
  });
});
