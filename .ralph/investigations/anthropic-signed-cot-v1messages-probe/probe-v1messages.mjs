#!/usr/bin/env node
// copilot-thinking-probe :: /v1/messages (Anthropic Messages) extension
// -------------------------------------------------------------------
// GATING SPIKE for codex-anthropic-native-messages-transport-for-signed-cot.
// Answers a GO/NO-GO question with raw evidence: can Copilot's
// https://api.githubcopilot.com/v1/messages deliver FAITHFUL SIGNED
// chain-of-thought? Three gates:
//   (a) Copilot bearer auth ACCEPTED on /v1/messages (not 401/404/unsupported).
//   (b) signed `thinking` + `signature` EMITTED in the turn-1 Anthropic SSE.
//   (c) signed thinking ACCEPTED ON REPLAY before a tool_result in turn 2
//       (the decisive gate: does the proxy preserve the signature end-to-end?).
//
// Auth/headers/token-cache are mirrored 1:1 from the existing probe.mjs, which
// in turn mirrors the fork's codex-copilot auth.rs / header_source.rs. The only
// additions for the Anthropic Messages shape are `anthropic-version` /
// `anthropic-beta` request headers and the Messages request/response shape.
//
// Usage:
//   node probe-v1messages.mjs [model]
//   node probe-v1messages.mjs claude-sonnet-4.6
//
// Writes per-turn raw `.sse` captures + a machine-readable evidence JSON next to
// this script. NO secrets are written: only request bodies (which carry no auth)
// and response SSE are saved; auth headers are never serialized to disk.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

// --- constants mirrored from codex-copilot/src/auth.rs (see probe.mjs) ---
const API_VERSION = '2025-10-01';
const USER_AGENT = 'GitHubCopilotChat/0.38.2';
const EDITOR_PLUGIN_VERSION = 'copilot-chat/0.38.2';
const VSCODE_VERSION = '1.110.1';
const GITHUB_API_BASE_URL = 'https://api.github.com';
const COPILOT_BASE_URL = 'https://api.githubcopilot.com';

// Anthropic Messages API contract headers. anthropic-version is REQUIRED by the
// native Messages API; the interleaved-thinking beta is what lets thinking +
// tool_use co-exist in one assistant turn (the exact shape gate (c) replays).
const ANTHROPIC_VERSION = '2023-06-01';
const ANTHROPIC_BETA = 'interleaved-thinking-2025-05-14';

const APP_DIR = process.env.COPILOT_API_HOME
  ? process.env.COPILOT_API_HOME
  : path.join(os.homedir(), '.local', 'share', 'copilot-api');

function readTrimmed(p) {
  try { return fs.readFileSync(p, 'utf8').trim(); } catch { return null; }
}

// auth.rs: copilot_token(force_refresh=false) — cache hit if expires_at > now+60.
async function getCopilotToken() {
  const cachePath = path.join(APP_DIR, 'copilot_token');
  const raw = readTrimmed(cachePath);
  if (raw) {
    try {
      const c = JSON.parse(raw);
      if (c.token && c.expires_at > Math.floor(Date.now() / 1000) + 60) {
        console.error('[auth] using cached copilot_token');
        return c.token;
      }
    } catch { /* fall through to exchange */ }
  }
  const gh = readTrimmed(path.join(APP_DIR, 'github_token'));
  if (!gh) throw new Error(`github_token not found in ${APP_DIR}; run: codex login --provider copilot`);
  console.error('[auth] cached token missing/expired; exchanging github_token');
  const res = await fetch(`${GITHUB_API_BASE_URL}/copilot_internal/v2/token`, {
    headers: {
      'authorization': `token ${gh}`,
      'content-type': 'application/json',
      'accept': 'application/json',
      'editor-version': `vscode/${VSCODE_VERSION}`,
      'editor-plugin-version': EDITOR_PLUGIN_VERSION,
      'user-agent': USER_AGENT,
      'x-github-api-version': API_VERSION,
      'x-vscode-user-agent-library-version': 'electron-fetch',
    },
  });
  if (!res.ok) throw new Error(`token exchange failed ${res.status}: ${await res.text()}`);
  const j = await res.json();
  try {
    fs.writeFileSync(cachePath, JSON.stringify({ token: j.token, expires_at: j.expires_at, refresh_in: j.refresh_in }));
    console.error('[auth] refreshed copilot_token cached back to disk');
  } catch { /* best-effort */ }
  return j.token;
}

// Session headers identical to probe.mjs (fork's build_session_headers + inject),
// plus the two Anthropic Messages contract headers.
function sessionHeaders(token) {
  const machineId = readTrimmed(path.join(APP_DIR, 'machine_id')) || '';
  const deviceId = readTrimmed(path.join(APP_DIR, 'device_id')) || '';
  const sessionId = `${crypto.randomUUID()}${Date.now()}`;
  const reqId = crypto.randomUUID();
  return {
    'authorization': `Bearer ${token}`,
    'content-type': 'application/json',
    'accept': 'text/event-stream',
    'anthropic-version': ANTHROPIC_VERSION,
    'anthropic-beta': ANTHROPIC_BETA,
    'copilot-integration-id': 'vscode-chat',
    'editor-version': `vscode/${VSCODE_VERSION}`,
    'editor-plugin-version': EDITOR_PLUGIN_VERSION,
    'user-agent': USER_AGENT,
    'openai-intent': 'conversation-agent',
    'x-github-api-version': API_VERSION,
    'x-vscode-user-agent-library-version': 'electron-fetch',
    'vscode-machineid': machineId,
    'vscode-sessionid': sessionId,
    'x-codex-copilot-device-id': deviceId,
    'x-initiator': 'agent',
    'x-interaction-type': 'conversation-agent',
    'x-interaction-id': reqId,
    'x-request-id': reqId,
    'x-agent-task-id': reqId,
  };
}

// Tool advertised so the model emits a tool_use block in the same assistant turn
// as its (signed) thinking — that is the exact shape gate (c) replays.
const TOOL = {
  name: 'record_answer',
  description: 'Record the final numeric answer in dollars.',
  input_schema: {
    type: 'object',
    properties: { answer: { type: 'number' } },
    required: ['answer'],
  },
};

const QUESTION =
  'A bat and a ball cost $1.10 total. The bat costs $1.00 more than the ball. '
  + 'How much does the ball cost? Reason carefully step by step, then call the '
  + 'record_answer tool with the final numeric answer in dollars.';

function turn1Body(model) {
  return {
    model,
    max_tokens: 4096,
    thinking: { type: 'enabled', budget_tokens: 2048 },
    system: 'You are a careful reasoning assistant.',
    messages: [{ role: 'user', content: QUESTION }],
    tools: [TOOL],
    stream: true,
  };
}

// Parse an Anthropic Messages SSE stream into ordered, assembled content blocks.
// Dispatches purely on the `type` field of each `data:` JSON, so it is robust to
// `event:` line presence/absence. Returns transport acceptance (status) distinct
// from the decoded body, plus the raw SSE text for disk capture.
async function streamMessages(headers, body) {
  const res = await fetch(`${COPILOT_BASE_URL}/v1/messages`, {
    method: 'POST', headers, body: JSON.stringify(body),
  });
  const contentType = res.headers.get('content-type');
  if (!res.ok) {
    const errorText = await res.text();
    return { ok: false, status: res.status, statusText: res.statusText, contentType, raw: errorText, blocks: [], errorText, stopReason: null };
  }
  const decoder = new TextDecoder();
  const rawChunks = [];
  let buf = '';
  for await (const chunk of res.body) {
    const t = decoder.decode(chunk, { stream: true });
    buf += t;
    rawChunks.push(t);
  }

  // Assemble content blocks by index.
  const byIndex = new Map();
  let stopReason = null;
  let streamError = null;
  for (const line of buf.split('\n')) {
    const s = line.trim();
    if (!s.startsWith('data:')) continue;
    const data = s.slice('data:'.length).trim();
    if (!data) continue;
    let j;
    try { j = JSON.parse(data); } catch { continue; }
    switch (j.type) {
      case 'content_block_start': {
        const cb = j.content_block || {};
        const entry = { type: cb.type, index: j.index };
        if (cb.type === 'thinking') { entry.thinking = cb.thinking || ''; entry.signature = cb.signature || ''; }
        else if (cb.type === 'redacted_thinking') { entry.data = cb.data || ''; }
        else if (cb.type === 'text') { entry.text = cb.text || ''; }
        else if (cb.type === 'tool_use') { entry.id = cb.id; entry.name = cb.name; entry.partialJson = ''; entry.input = cb.input || {}; }
        byIndex.set(j.index, entry);
        break;
      }
      case 'content_block_delta': {
        const e = byIndex.get(j.index);
        if (!e) break;
        const d = j.delta || {};
        if (d.type === 'thinking_delta') e.thinking = (e.thinking || '') + (d.thinking || '');
        else if (d.type === 'signature_delta') e.signature = (e.signature || '') + (d.signature || '');
        else if (d.type === 'text_delta') e.text = (e.text || '') + (d.text || '');
        else if (d.type === 'input_json_delta') e.partialJson = (e.partialJson || '') + (d.partial_json || '');
        break;
      }
      case 'content_block_stop': break;
      case 'message_delta': {
        if (j.delta && j.delta.stop_reason) stopReason = j.delta.stop_reason;
        break;
      }
      case 'error': streamError = j.error || j; break;
      default: break;
    }
  }

  const blocks = [...byIndex.entries()].sort((a, b) => a[0] - b[0]).map(([, e]) => {
    if (e.type === 'tool_use') {
      let input = e.input;
      try { if (e.partialJson) input = JSON.parse(e.partialJson); } catch { /* keep raw */ }
      return { type: 'tool_use', id: e.id, name: e.name, input };
    }
    if (e.type === 'thinking') return { type: 'thinking', thinking: e.thinking, signature: e.signature };
    if (e.type === 'redacted_thinking') return { type: 'redacted_thinking', data: e.data };
    if (e.type === 'text') return { type: 'text', text: e.text };
    return e;
  });

  return { ok: true, status: res.status, statusText: res.statusText, contentType, raw: rawChunks.join(''), blocks, errorText: null, stopReason, streamError };
}

function saveRaw(model, label, text) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const file = path.join(import.meta.dirname, `raw-v1messages-${model}-${label}-${stamp}.sse`);
  fs.writeFileSync(file, text);
  return file;
}

function summarizeBlocks(blocks) {
  return blocks.map(b => {
    if (b.type === 'thinking') return `thinking(chars=${(b.thinking || '').length}, sig=${b.signature ? `${b.signature.length}ch` : 'NONE'})`;
    if (b.type === 'redacted_thinking') return `redacted_thinking(data=${(b.data || '').length}ch)`;
    if (b.type === 'tool_use') return `tool_use(${b.name}, id=${b.id}, input=${JSON.stringify(b.input)})`;
    if (b.type === 'text') return `text(chars=${(b.text || '').length})`;
    return b.type;
  }).join(' | ');
}

async function main() {
  const model = process.argv.slice(2).find(a => !a.startsWith('--')) || 'claude-sonnet-4.6';
  const token = await getCopilotToken();

  const evidence = { endpoint: `${COPILOT_BASE_URL}/v1/messages`, model, ranAt: new Date().toISOString(), gates: {}, turns: {} };

  // ---------------- TURN 1: elicit signed thinking + tool_use ----------------
  console.error('\n=== TURN 1: elicit signed thinking + tool_use on /v1/messages ===');
  const b1 = turn1Body(model);
  console.error('POST', `${COPILOT_BASE_URL}/v1/messages`, '| model:', model);
  const t1 = await streamMessages(sessionHeaders(token), b1);
  const raw1File = saveRaw(model, 'turn1', t1.raw);
  console.error('HTTP', t1.status, t1.statusText, '| content-type:', t1.contentType, '| raw:', raw1File);

  // GATE (a): auth/endpoint acceptance.
  const gateA = t1.ok;
  evidence.gates.a_auth_accepted = { pass: gateA, status: t1.status, statusText: t1.statusText, contentType: t1.contentType, rawFile: path.basename(raw1File) };
  if (!gateA) {
    console.error('GATE (a) auth/endpoint: NO-GO — HTTP', t1.status, t1.statusText);
    console.error('  error body (first 600):', (t1.errorText || '').slice(0, 600));
    evidence.gates.a_auth_accepted.errorBody = (t1.errorText || '').slice(0, 2000);
    evidence.gates.b_signed_emitted = { pass: false, reason: 'gate (a) failed; no stream to inspect' };
    evidence.gates.c_signed_replay_accepted = { pass: false, reason: 'gate (a) failed; replay not attempted' };
    evidence.verdict = 'NO-GO';
    writeEvidence(evidence);
    return;
  }
  console.error('GATE (a) auth/endpoint: GO — accepted HTTP', t1.status);
  console.error('turn-1 blocks:', summarizeBlocks(t1.blocks));
  evidence.turns.turn1 = { status: t1.status, stopReason: t1.stopReason, blocks: t1.blocks.map(b => b.type === 'thinking' ? { type: 'thinking', thinkingChars: (b.thinking || '').length, signatureChars: (b.signature || '').length, signaturePresent: !!b.signature } : (b.type === 'tool_use' ? { type: 'tool_use', name: b.name, id: b.id, input: b.input } : { type: b.type })) };

  const thinkingBlock = t1.blocks.find(b => b.type === 'thinking' && b.signature);
  const anyThinking = t1.blocks.find(b => b.type === 'thinking' || b.type === 'redacted_thinking');
  const toolUseBlock = t1.blocks.find(b => b.type === 'tool_use');

  // GATE (b): signed thinking emitted.
  const gateB = !!thinkingBlock;
  evidence.gates.b_signed_emitted = {
    pass: gateB,
    thinkingPresent: !!anyThinking,
    signaturePresent: !!thinkingBlock,
    signatureChars: thinkingBlock ? thinkingBlock.signature.length : 0,
    rawFile: path.basename(raw1File),
  };
  if (!gateB) {
    console.error('GATE (b) signed thinking emitted: NO-GO —', anyThinking ? 'thinking present but NO signature' : 'no thinking block at all');
    evidence.gates.c_signed_replay_accepted = { pass: false, reason: 'gate (b) failed; nothing signed to replay' };
    evidence.verdict = 'NO-GO';
    writeEvidence(evidence);
    return;
  }
  console.error('GATE (b) signed thinking emitted: GO — signature', thinkingBlock.signature.length, 'chars');

  if (!toolUseBlock) {
    console.error('NOTE: turn 1 produced signed thinking but no tool_use; replaying thinking before a synthetic tool_result anyway.');
  }

  // ---------------- TURN 2: replay the captured SIGNED thinking ----------------
  // The decisive gate. The assistant turn carries the captured thinking block
  // (verbatim text + signature) followed by its tool_use; the next user turn is
  // the tool_result. We probe both:
  //   genuine  — replay the real captured signature (should be accepted IF the
  //              proxy preserved the signature end-to-end).
  //   tampered — flip a handful of signature chars (negative control). If the
  //              proxy validates signatures, this MUST be rejected; if BOTH are
  //              accepted, the proxy is not enforcing signatures at all.
  const toolUseId = toolUseBlock ? toolUseBlock.id : `toolu_${crypto.randomBytes(8).toString('hex')}`;
  const toolUseForReplay = toolUseBlock
    ? { type: 'tool_use', id: toolUseId, name: toolUseBlock.name, input: toolUseBlock.input }
    : { type: 'tool_use', id: toolUseId, name: TOOL.name, input: { answer: 0.05 } };

  function replayBody(signature) {
    return {
      model,
      max_tokens: 4096,
      thinking: { type: 'enabled', budget_tokens: 2048 },
      system: 'You are a careful reasoning assistant.',
      messages: [
        { role: 'user', content: QUESTION },
        { role: 'assistant', content: [
          { type: 'thinking', thinking: thinkingBlock.thinking, signature },
          toolUseForReplay,
        ] },
        { role: 'user', content: [
          { type: 'tool_result', tool_use_id: toolUseId, content: 'Recorded. Now state the final answer in one short sentence.' },
        ] },
      ],
      tools: [TOOL],
      stream: true,
    };
  }

  // genuine replay
  console.error('\n=== TURN 2a: replay GENUINE signed thinking before tool_result ===');
  const t2g = await streamMessages(sessionHeaders(token), replayBody(thinkingBlock.signature));
  const raw2gFile = saveRaw(model, 'turn2-genuine', t2g.raw);
  console.error('HTTP', t2g.status, t2g.statusText, '| raw:', raw2gFile);
  if (!t2g.ok) console.error('  error body (first 800):', (t2g.errorText || '').slice(0, 800));
  else console.error('  turn-2a blocks:', summarizeBlocks(t2g.blocks));

  // tampered replay (negative control)
  const sig = thinkingBlock.signature;
  const mid = Math.floor(sig.length / 2);
  const tamperedChar = sig[mid] === 'A' ? 'B' : 'A';
  const tamperedSig = sig.slice(0, mid) + tamperedChar + sig.slice(mid + 1);
  console.error('\n=== TURN 2b: replay TAMPERED signature (negative control) ===');
  const t2t = await streamMessages(sessionHeaders(token), replayBody(tamperedSig));
  const raw2tFile = saveRaw(model, 'turn2-tampered', t2t.raw);
  console.error('HTTP', t2t.status, t2t.statusText, '| raw:', raw2tFile);
  if (!t2t.ok) console.error('  error body (first 800):', (t2t.errorText || '').slice(0, 800));

  const genuineAccepted = t2g.ok && t2g.status === 200;
  const tamperedRejected = !t2t.ok;

  // GATE (c): signed thinking accepted on replay.
  const gateC = genuineAccepted;
  evidence.gates.c_signed_replay_accepted = {
    pass: gateC,
    genuine: { accepted: genuineAccepted, status: t2g.status, statusText: t2g.statusText, errorBody: t2g.ok ? null : (t2g.errorText || '').slice(0, 2000), rawFile: path.basename(raw2gFile) },
    tamperedControl: { rejected: tamperedRejected, status: t2t.status, statusText: t2t.statusText, errorBody: t2t.ok ? null : (t2t.errorText || '').slice(0, 2000), rawFile: path.basename(raw2tFile) },
    signatureEnforced: genuineAccepted && tamperedRejected,
    signatureIgnored: genuineAccepted && !tamperedRejected,
  };

  console.error('\n=== GATE (c) signed thinking accepted on replay ===');
  console.error('  genuine  replay:', genuineAccepted ? 'ACCEPTED (200)' : `REJECTED (${t2g.status} ${t2g.statusText})`);
  console.error('  tampered control:', tamperedRejected ? `REJECTED (${t2t.status}) — proxy validates the signature` : 'ACCEPTED — proxy does NOT validate the signature');

  // Verdict: BOTH (b) AND (c). Endpoint availability alone is not enough.
  const go = gateA && gateB && gateC;
  evidence.verdict = go ? 'GO' : 'NO-GO';
  evidence.verdictRationale = go
    ? (evidence.gates.c_signed_replay_accepted.signatureEnforced
        ? 'All three gates pass; genuine signature accepted AND tampered rejected => signature preserved+enforced end-to-end.'
        : 'All three gates pass; genuine signature accepted but tampered ALSO accepted => signature round-trips but proxy does not enforce it (round-trip still faithful).')
    : 'At least one of gates (a)/(b)/(c) failed; see per-gate evidence.';

  console.error('\n=================== VERDICT:', evidence.verdict, '===================');
  console.error('  (a) auth accepted          :', evidence.gates.a_auth_accepted.pass ? 'GO' : 'NO-GO');
  console.error('  (b) signed thinking emitted:', evidence.gates.b_signed_emitted.pass ? 'GO' : 'NO-GO');
  console.error('  (c) signed replay accepted :', evidence.gates.c_signed_replay_accepted.pass ? 'GO' : 'NO-GO');
  writeEvidence(evidence);
}

function writeEvidence(evidence) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const file = path.join(import.meta.dirname, `v1messages-evidence-${evidence.model}-${stamp}.json`);
  fs.writeFileSync(file, JSON.stringify(evidence, null, 2));
  console.error('evidence saved to:', file);
}

main().catch(err => { console.error('ERROR:', err.message); process.exit(1); });
