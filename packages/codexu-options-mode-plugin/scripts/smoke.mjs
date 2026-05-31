#!/usr/bin/env node

import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const config = require('../hooks/config.js');
const stopHook = require('../hooks/stop.js');

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tempRoot = mkdtempSync(path.join(tmpdir(), 'codexu-options-mode-'));
const sessionId = 'smoke-session';
const transcriptPath = path.join(tempRoot, 'transcript.jsonl');
writeFileSync(transcriptPath, JSON.stringify({ payload: { type: 'message', role: 'assistant' } }) + '\n');

function runStop(input) {
  return spawnSync(process.execPath, [path.join(pluginRoot, 'hooks', 'stop.js')], {
    cwd: pluginRoot,
    env: { ...process.env, PLUGIN_DATA: tempRoot },
    input: JSON.stringify(input),
    encoding: 'utf8'
  });
}

try {
  process.env.PLUGIN_DATA = tempRoot;

  config.setOptionsMode(sessionId, 'on');
  const blocked = runStop({
    session_id: sessionId,
    stop_hook_active: false,
    transcript_path: transcriptPath,
    last_assistant_message: 'plain prose'
  });
  assert.equal(blocked.status, 0, blocked.stderr);
  const blockedJson = JSON.parse(blocked.stdout);
  assert.equal(blockedJson.decision, 'block');
  assert.equal(blockedJson.reason, stopHook.BLOCK_REASON);

  config.setOptionsMode(sessionId, 'off');
  const passed = runStop({
    session_id: sessionId,
    stop_hook_active: false,
    transcript_path: transcriptPath,
    last_assistant_message: 'plain prose'
  });
  assert.equal(passed.status, 0, passed.stderr);
  assert.equal(passed.stdout, '');

  // PreToolUse request_user_input auto-respond (Phase 3h-tail).
  config.setOptionsMode(sessionId, 'auto');
  const preToolUse = spawnSync(process.execPath, [path.join(pluginRoot, 'hooks', 'pre-tool-use.js')], {
    cwd: pluginRoot,
    env: { ...process.env, PLUGIN_DATA: tempRoot },
    input: JSON.stringify({
      hook_event_name: 'PreToolUse',
      session_id: sessionId,
      tool_name: 'request_user_input',
      tool_use_id: 'tu-smoke',
      tool_input: {
        questions: [
          {
            id: 'q1',
            header: 'Pick',
            question: 'Which?',
            options: [
              { label: 'Recommended', description: 'Default' },
              { label: 'Other', description: 'Alt' }
            ]
          }
        ]
      }
    }),
    encoding: 'utf8'
  });
  assert.equal(preToolUse.status, 0, preToolUse.stderr);
  const syntheticEnvelope = JSON.parse(preToolUse.stdout);
  assert.deepEqual(syntheticEnvelope, {
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      syntheticResponse: {
        answers: { q1: { answers: ['Recommended'] } }
      }
    }
  });

  console.log('options-mode smoke passed: on blocks plain prose; off passes through; auto returns syntheticResponse; temp state removed');
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
}
