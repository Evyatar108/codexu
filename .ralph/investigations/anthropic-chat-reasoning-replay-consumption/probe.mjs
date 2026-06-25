#!/usr/bin/env node
// copilot-thinking-probe
// ----------------------
// Empirically answers: does GitHub Copilot's /chat/completions endpoint emit
// Anthropic "thinking" (chain-of-thought) for Claude models when reasoning_effort
// is set? The codex fork's chat transport drops thinking_delta/signature_delta
// (core/src/chat_transport/anthropic_sse.rs:174-176); this probe captures the RAW
// SSE so we can see whether that data is even present on the wire.
//
// Fidelity: this replicates the EXACT auth + headers + request the fork sends.
// Every constant/header below is mirrored from
//   codex-rs-overlay/codex-copilot/src/auth.rs           (build_session_headers, github_headers)
//   codex-rs-overlay/codex-copilot/src/header_source.rs  (inject)
//   codex-rs-overlay/codex-copilot/src/chat_completions.rs (send_chat_request streaming overrides)
//   codex-rs-overlay/codex-copilot/src/paths.rs          (token cache location)
//
// Usage:
//   node probe.mjs [model] [effort] [--tool] [--no-effort] [--two-turn]
//   node probe.mjs claude-sonnet-4.6 high
//   node probe.mjs claude-opus-4.8 high --tool
//   node probe.mjs claude-sonnet-4.6 none --no-effort
//   node probe.mjs claude-sonnet-4.6 high --two-turn   # US-001 replay de-risk

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

// --- constants mirrored from codex-copilot/src/auth.rs ---
const API_VERSION = '2025-10-01';
const USER_AGENT = 'GitHubCopilotChat/0.38.2';
const EDITOR_PLUGIN_VERSION = 'copilot-chat/0.38.2';
const VSCODE_VERSION = '1.110.1';
const GITHUB_API_BASE_URL = 'https://api.github.com';
const COPILOT_BASE_URL = 'https://api.githubcopilot.com';

// paths.rs: $COPILOT_API_HOME or ~/.local/share/copilot-api
const APP_DIR = process.env.COPILOT_API_HOME
  ? process.env.COPILOT_API_HOME
  : path.join(os.homedir(), '.local', 'share', 'copilot-api');

function readTrimmed(p) {
  try { return fs.readFileSync(p, 'utf8').trim(); } catch { return null; }
}

// auth.rs: copilot_token(force_refresh=false) — cache hit if expires_at > now+60,
// else exchange github_token via GET /copilot_internal/v2/token.
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
      // auth.rs::github_headers
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

// auth.rs::build_session_headers + header_source.rs::inject + chat_completions.rs
// streaming overrides (accept: text/event-stream, x-initiator: agent, ...).
function sessionHeaders(token) {
  const machineId = readTrimmed(path.join(APP_DIR, 'machine_id')) || '';
  const deviceId = readTrimmed(path.join(APP_DIR, 'device_id')) || '';
  const sessionId = `${crypto.randomUUID()}${Date.now()}`; // auth.rs: uuid + epoch_millis
  const reqId = crypto.randomUUID();
  return {
    'authorization': `Bearer ${token}`,
    'content-type': 'application/json',
    'accept': 'text/event-stream',
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

function buildBody(model, effort, withTool) {
  const ask = withTool
    ? 'Reason carefully step by step, then call the record_answer tool with the final numeric answer in dollars.'
    : 'Reason carefully step by step, then state the final answer.';
  const body = {
    model,
    messages: [
      { role: 'system', content: 'You are a careful reasoning assistant.' },
      { role: 'user', content: `A bat and a ball cost $1.10 total. The bat costs $1.00 more than the ball. How much does the ball cost? ${ask}` },
    ],
    stream: true,
    stream_options: { include_usage: true },
  };
  if (effort) body.reasoning_effort = effort;
  if (withTool) {
    body.tools = [{
      type: 'function',
      function: {
        name: 'record_answer',
        description: 'Record the final numeric answer in dollars.',
        parameters: { type: 'object', properties: { answer: { type: 'number' } }, required: ['answer'] },
      },
    }];
    body.tool_choice = 'auto';
  }
  return body;
}

// Substrings that would prove thinking/CoT is present on the wire (either the
// Anthropic Messages SSE shape or a non-standard chat-completions reasoning field).
const MARKERS = [
  'thinking_delta', 'signature_delta', 'redacted_thinking',
  '"type":"thinking"', '"thinking"', '"signature"',
  'reasoning_text', 'reasoning_content', '"reasoning"', // OpenAI-chat reasoning extensions
  'content_block_delta', 'content_block_start', 'text_delta', 'input_json_delta', // Anthropic shape
  '"choices"', 'tool_calls', // OpenAI chat shape
];

// Stream one /chat/completions request and assemble the OpenAI-chat-shape
// `content` and the non-standard `reasoning_text` extension separately, so a
// caller can ask "what did the model answer?" and "did it reveal CoT?" apart.
// Returns transport ACCEPTANCE (status) distinct from any decoded body.
async function streamChat(headers, body) {
  const res = await fetch(`${COPILOT_BASE_URL}/chat/completions`, {
    method: 'POST', headers, body: JSON.stringify(body),
  });
  const contentType = res.headers.get('content-type');
  if (!res.ok) {
    const errorText = await res.text();
    return { ok: false, status: res.status, statusText: res.statusText, contentType, raw: errorText, content: '', reasoning: '', errorText };
  }
  const decoder = new TextDecoder();
  const rawChunks = [];
  let buf = '';
  for await (const chunk of res.body) {
    const t = decoder.decode(chunk, { stream: true });
    buf += t;
    rawChunks.push(t);
  }
  let content = '';
  let reasoning = '';
  for (const line of buf.split('\n')) {
    const s = line.trim();
    if (!s.startsWith('data:')) continue;
    const data = s.slice('data:'.length).trim();
    if (!data || data === '[DONE]') continue;
    let j;
    try { j = JSON.parse(data); } catch { continue; }
    const delta = j?.choices?.[0]?.delta;
    if (!delta) continue;
    if (typeof delta.content === 'string') content += delta.content;
    if (typeof delta.reasoning_text === 'string') reasoning += delta.reasoning_text;
  }
  return { ok: true, status: res.status, statusText: res.statusText, contentType, raw: rawChunks.join(''), content, reasoning };
}

// US-001 de-risk: decide which replay field shape Copilot /chat/completions
// ACCEPTS (HTTP 200 vs 400 field-rejection) and HONORS (model can read the
// replayed reasoning back) on INPUT. Turn 1 generates real CoT; turn 2 replays
// that CoT — with a unique injected canary codeword — in each candidate shape
// and asks the model to echo the codeword. The canary cleanly separates
// "accepted but silently ignored" from "accepted and honored": the codeword
// lives ONLY in the replayed reasoning, so echoing it proves the reasoning was
// model-visible. Writes a machine-readable evidence JSON next to this script.
async function runTwoTurn(model, effort) {
  const token = await getCopilotToken();
  const sys = { role: 'system', content: 'You are a careful reasoning assistant.' };

  const turn1Body = buildBody(model, effort, false);
  const Q = turn1Body.messages[1].content;
  console.error('\n=== TURN 1 (generate CoT) ===');
  console.error('model:', model, '| reasoning_effort:', effort ?? '(omitted)');
  const t1 = await streamChat(sessionHeaders(token), turn1Body);
  console.error('HTTP', t1.status, t1.statusText, '| content-type:', t1.contentType);
  if (!t1.ok) { console.error('turn-1 failed:', t1.errorText); process.exit(1); }
  console.error('reasoning chars:', t1.reasoning.length, '| answer chars:', t1.content.length);
  if (!t1.reasoning) {
    console.error('WARN: turn 1 produced no reasoning_text; cannot probe replay honoring. Raise effort.');
  }

  const canary = `CANARY-${crypto.randomBytes(5).toString('hex').toUpperCase()}`;
  const replayedReasoning = `${t1.reasoning}\n(Internal continuity note: the verification codeword is ${canary}. Remember it.)`;
  const followUp = 'Earlier, in your private step-by-step reasoning, you recorded an internal verification codeword. Reply with ONLY that codeword and nothing else.';

  // Each candidate encodes the prior assistant turn (carrying the replayed
  // reasoning) differently, then asks the same follow-up.
  const candidates = {
    reasoning_text_field: [
      sys,
      { role: 'user', content: Q },
      { role: 'assistant', content: t1.content, reasoning_text: replayedReasoning },
      { role: 'user', content: followUp },
    ],
    inline_content: [
      sys,
      { role: 'user', content: Q },
      { role: 'assistant', content: `<reasoning>\n${replayedReasoning}\n</reasoning>\n\n${t1.content}` },
      { role: 'user', content: followUp },
    ],
    standalone_assistant_message: [
      sys,
      { role: 'user', content: Q },
      { role: 'assistant', content: replayedReasoning },
      { role: 'assistant', content: t1.content },
      { role: 'user', content: followUp },
    ],
  };

  const results = {};
  for (const [shape, messages] of Object.entries(candidates)) {
    const body = { model, messages, stream: true, stream_options: { include_usage: true } };
    if (effort) body.reasoning_effort = effort;
    console.error(`\n=== TURN 2 candidate: ${shape} ===`);
    const r = await streamChat(sessionHeaders(token), body);
    const echoed = (r.content + r.reasoning).includes(canary);
    const accepted = r.ok && r.status === 200;
    console.error('ACCEPTANCE:', accepted ? 'HTTP 200 (accepted)' : `HTTP ${r.status} ${r.statusText} (rejected)`);
    if (!r.ok) console.error('  error body:', r.errorText?.slice(0, 400));
    console.error('HONORING:', echoed ? `YES — codeword ${canary} echoed` : 'NO — codeword not echoed');
    console.error('  turn-2 answer (first 200 chars):', JSON.stringify(r.content.slice(0, 200)));
    results[shape] = {
      requestBody: body,
      accepted,
      status: r.status,
      statusText: r.statusText,
      contentType: r.contentType,
      honored: echoed,
      turn2Content: r.content,
      turn2Reasoning: r.reasoning,
      errorText: r.errorText ?? null,
    };
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const evidenceFile = path.join(import.meta.dirname, `two-turn-evidence-${model}-${effort ?? 'noeffort'}-${stamp}.json`);
  const evidence = {
    model,
    effort: effort ?? null,
    canary,
    turn1: { question: Q, answer: t1.content, reasoning: t1.reasoning, reasoningChars: t1.reasoning.length },
    candidates: results,
  };
  fs.writeFileSync(evidenceFile, JSON.stringify(evidence, null, 2));

  console.error('\n=== DECISION SUMMARY (accepted / honored per shape) ===');
  for (const [shape, r] of Object.entries(results)) {
    console.error(`  ${shape}: accepted=${r.accepted} honored=${r.honored}`);
  }
  console.error('evidence saved to:', evidenceFile);
}

// CONSUMPTION A/B (codex-anthropic-chat-reasoning-replay-consumption-verification).
// Decisive, confound-free test of whether the SHIPPED unsigned replay shape —
// a standalone {role:"assistant", content:<plaintext reasoning>} message placed
// BEFORE the prior answer (mirrors codex-rs-overlay/codex-copilot/src/payload.rs
// :332-338 `push_chat_message` "reasoning" arm) — is actually CONSUMED by the
// model on a later /chat/completions turn, vs silently dropped.
//
// Improvements over runTwoTurn's canary test:
//  1. NEUTRAL framing. The discriminating fact is an arbitrary codename the
//     assistant "assigned", recalled as ordinary continuity — NOT a "secret
//     verification codeword to reveal", which tripped Claude's prompt-injection
//     refusal in the 2026-06-21 run (it objected instead of cleanly using it).
//  2. EXPLICIT WITHOUT control. Each shape is run WITH the reasoning replayed and
//     WITHOUT it. If turn-2 yields the planted token ONLY in the WITH arm, the
//     channel is consumed; identical-without-it proves non-guessability.
//  3. The discriminating token lives ONLY in the reasoning, never in the visible
//     answer, and is a random non-guessable tag so it cannot leak via priors.
//  4. N trials per (shape,condition) to beat stochasticity.
//
// Shapes mirror exactly what matters for the build decision:
//   shipped_standalone_assistant — the field the fork actually emits today.
//   reasoning_text_field         — the dedicated input field (re-confirm dropped).
//   control_no_reasoning         — baseline; reasoning omitted entirely.
function randomCodename() {
  const words = ['Marlin', 'Juniper', 'Basalt', 'Quasar', 'Cobalt', 'Vesper',
    'Onyx', 'Falcon', 'Sienna', 'Zephyr', 'Garnet', 'Lyra'];
  const w = words[crypto.randomInt(words.length)];
  const tag = crypto.randomBytes(2).toString('hex').toUpperCase(); // 4 hex chars
  return `${w}-${tag}`;
}

async function runConsumption(model, effort, trials) {
  const token = await getCopilotToken();
  const sys = { role: 'system', content: 'You are a careful assistant that maintains continuity across turns.' };

  // Turn-1 question that legitimately produces hidden intermediate state: the
  // assistant assigns three codenames but is told NOT to list them in the visible
  // answer — so the names exist ONLY in its reasoning. We synthesize that prior
  // turn deterministically (per-run random tokens) so the discriminating fact is
  // GUARANTEED to live only in the replayed reasoning, never in the visible answer.
  const q1 = 'I am naming three internal microservices #1, #2, #3. Assign each a distinct '
    + 'codename. In your visible reply, only confirm you have chosen them — do NOT list the '
    + 'codenames; keep the actual names solely in your private step-by-step reasoning.';
  // The follow-up whose CORRECT answer is recoverable ONLY from the reasoning.
  const q2 = 'What codename did you assign to microservice #2? Reply with ONLY that codename token and nothing else.';
  const a1 = 'I have chosen a distinct codename for each of the three microservices and kept the '
    + 'actual names in my private notes as requested, so they are not listed here.';

  const conditions = ['shipped_standalone_assistant', 'reasoning_text_field', 'reasoning_content_field', 'control_no_reasoning'];
  const results = {};
  // One representative captured raw request+response per condition (auth-free) for the evidence file.
  const rawCaptures = {};

  for (const shape of conditions) {
    const trialRows = [];
    let hits = 0;
    for (let i = 0; i < trials; i++) {
      const codenames = [randomCodename(), randomCodename(), randomCodename()];
      const target = codenames[1]; // microservice #2
      const reasoning = `Assigning codenames now. Microservice #1 -> "${codenames[0]}". `
        + `Microservice #2 -> "${codenames[1]}". Microservice #3 -> "${codenames[2]}". `
        + `I will keep these only in my private reasoning and will not list them in the visible answer.`;

      let messages;
      if (shape === 'shipped_standalone_assistant') {
        // EXACT fork shape: standalone assistant message carrying the reasoning,
        // placed before the prior answer (two consecutive assistant messages).
        messages = [sys, { role: 'user', content: q1 },
          { role: 'assistant', content: reasoning },
          { role: 'assistant', content: a1 },
          { role: 'user', content: q2 }];
      } else if (shape === 'reasoning_text_field') {
        messages = [sys, { role: 'user', content: q1 },
          { role: 'assistant', content: a1, reasoning_text: reasoning },
          { role: 'user', content: q2 }];
      } else if (shape === 'reasoning_content_field') {
        // The DeepSeek/OpenAI-compatible field name opencode actually replays over
        // /chat/completions (packages/llm/src/protocols/openai-chat.ts:257-261).
        messages = [sys, { role: 'user', content: q1 },
          { role: 'assistant', content: a1, reasoning_content: reasoning },
          { role: 'user', content: q2 }];
      } else { // control_no_reasoning — the discriminating fact is nowhere in the request
        messages = [sys, { role: 'user', content: q1 },
          { role: 'assistant', content: a1 },
          { role: 'user', content: q2 }];
      }

      const body = { model, messages, stream: true, stream_options: { include_usage: true } };
      if (effort) body.reasoning_effort = effort;
      const r = await streamChat(sessionHeaders(token), body);
      const out = `${r.content}\n${r.reasoning}`;
      const recalled = out.toUpperCase().includes(target.toUpperCase());
      if (recalled) hits++;
      trialRows.push({
        trial: i, accepted: r.ok && r.status === 200, status: r.status,
        targetToken: target, allCodenames: codenames, recalledTarget: recalled,
        turn2Content: r.content, errorText: r.errorText ?? null,
      });
      // capture the first trial's raw request+response for this shape
      if (i === 0) {
        rawCaptures[shape] = {
          // request body carries NO auth; headers (which hold the bearer) are never serialized.
          requestBody: body,
          httpStatus: r.status,
          contentType: r.contentType,
          rawResponseSse: r.raw,
        };
      }
      console.error(`  [${shape}] trial ${i}: accepted=${r.ok && r.status === 200} recalledTarget(${target})=${recalled} | turn2="${r.content.slice(0, 80).replace(/\n/g, ' ')}"`);
    }
    results[shape] = { trials: trials, recallHits: hits, recallRate: hits / trials, rows: trialRows };
  }

  // Interpretation. The shipped shape is CONSUMED iff it recalls the planted token
  // at a materially higher rate than the no-reasoning control (which must be ~0).
  const shipped = results.shipped_standalone_assistant;
  const field = results.reasoning_text_field;
  const contentField = results.reasoning_content_field;
  const control = results.control_no_reasoning;
  let verdict;
  if (control.recallHits > 0) {
    verdict = 'INVALID — control recalled the token (guessable/leaked); tighten token randomness';
  } else if (shipped.recallHits === shipped.trials) {
    verdict = 'CONSUMED — shipped standalone-assistant replay recalled the reasoning-only token on every trial while control recalled none';
  } else if (shipped.recallHits > 0) {
    verdict = 'CONSUMED (partial) — shipped shape recalled the reasoning-only token on some trials; control recalled none';
  } else {
    verdict = 'IGNORED — shipped shape never recalled the reasoning-only token (behaved like the no-reasoning control)';
  }
  const fieldVerdict = field.recallHits === 0
    ? 'reasoning_text_field DROPPED (behaves like control — accepted but content not model-visible)'
    : `reasoning_text_field CONSUMED on ${field.recallHits}/${field.trials} trials`;
  const contentFieldVerdict = contentField.recallHits === 0
    ? 'reasoning_content_field DROPPED (behaves like control — accepted but content not model-visible)'
    : `reasoning_content_field CONSUMED on ${contentField.recallHits}/${contentField.trials} trials`;

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const evidenceFile = path.join(import.meta.dirname, `consumption-evidence-${model}-${effort ?? 'noeffort'}-${stamp}.json`);
  const evidence = {
    probe: 'chat-reasoning-replay-consumption',
    model, effort: effort ?? null, trialsPerCondition: trials,
    forkShapeRef: 'codex-rs-overlay/codex-copilot/src/payload.rs:332-338 (push_chat_message "reasoning" arm -> standalone {role:assistant, content:<plaintext>})',
    design: 'Discriminating codename token lives ONLY in the replayed reasoning, never in the visible answer; recalled on turn-2. WITH (shipped/field) vs WITHOUT (control).',
    results,
    rawCaptures,
    verdict,
    fieldVerdict,
    contentFieldVerdict,
  };
  fs.writeFileSync(evidenceFile, JSON.stringify(evidence, null, 2));

  console.error('\n=== CONSUMPTION SUMMARY ===');
  console.error(`  shipped_standalone_assistant : recall ${shipped.recallHits}/${shipped.trials}`);
  console.error(`  reasoning_text_field         : recall ${field.recallHits}/${field.trials}`);
  console.error(`  reasoning_content_field      : recall ${contentField.recallHits}/${contentField.trials}`);
  console.error(`  control_no_reasoning         : recall ${control.recallHits}/${control.trials}`);
  console.error('  VERDICT:', verdict);
  console.error('  FIELD (reasoning_text)   :', fieldVerdict);
  console.error('  FIELD (reasoning_content):', contentFieldVerdict);
  console.error('  evidence saved to:', evidenceFile);
}

async function main() {
  const argv = process.argv.slice(2);
  const flags = argv.filter(a => a.startsWith('--'));
  const pos = argv.filter(a => !a.startsWith('--'));
  const model = pos[0] || 'claude-sonnet-4.6';
  const noEffort = flags.includes('--no-effort');
  let effort = 'high';
  if (noEffort || pos[1] === 'none') effort = null;
  else if (pos[1]) effort = pos[1];
  const withTool = flags.includes('--tool');

  // US-001: two-turn input-acceptance + honoring de-risk.
  if (flags.includes('--two-turn')) {
    await runTwoTurn(model, effort);
    return;
  }

  // Consumption A/B: is the shipped unsigned standalone-assistant replay CONSUMED?
  if (flags.includes('--consume')) {
    const trialsFlag = flags.find(f => f.startsWith('--trials='));
    const trials = trialsFlag ? Math.max(1, parseInt(trialsFlag.split('=')[1], 10) || 3) : 3;
    await runConsumption(model, effort, trials);
    return;
  }

  const token = await getCopilotToken();
  const headers = sessionHeaders(token);
  const body = buildBody(model, effort, withTool);

  console.error('\n=== REQUEST ===');
  console.error(`POST ${COPILOT_BASE_URL}/chat/completions`);
  console.error('model:', model, '| reasoning_effort:', effort ?? '(omitted)', '| tools:', withTool);
  console.error('headers:', JSON.stringify({ ...headers, authorization: 'Bearer <redacted>' }));
  console.error('body:', JSON.stringify(body));

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const rawFile = path.join(import.meta.dirname, `raw-${model}-${effort ?? 'noeffort'}${withTool ? '-tool' : ''}-${stamp}.sse`);
  const rawChunks = [];

  const res = await fetch(`${COPILOT_BASE_URL}/chat/completions`, {
    method: 'POST', headers, body: JSON.stringify(body),
  });
  console.error('\n=== RESPONSE ===');
  console.error('HTTP', res.status, res.statusText);
  console.error('content-type:', res.headers.get('content-type'));
  if (!res.ok) {
    const t = await res.text();
    console.error(t);
    process.exit(1);
  }

  console.error('\n=== RAW SSE (streaming) ===');
  const decoder = new TextDecoder();
  let buf = '';
  for await (const chunk of res.body) {
    const text = decoder.decode(chunk, { stream: true });
    buf += text;
    rawChunks.push(text);
    process.stdout.write(text);
  }
  process.stdout.write('\n');

  fs.writeFileSync(rawFile, rawChunks.join(''));

  const seen = MARKERS.filter(m => buf.includes(m));
  const thinkingMarkers = ['thinking_delta', 'signature_delta', 'redacted_thinking', '"type":"thinking"', 'reasoning_text', 'reasoning_content'];
  const thinkingSeen = thinkingMarkers.filter(m => buf.includes(m));

  console.error('\n=== SUMMARY ===');
  console.error('markers seen:', seen.join(', ') || '(none)');
  console.error('CHAIN-OF-THOUGHT present on wire:', thinkingSeen.length ? `YES -> ${thinkingSeen.join(', ')}` : 'NO');
  console.error('raw saved to:', rawFile);
}

main().catch(err => { console.error('ERROR:', err.message); process.exit(1); });
