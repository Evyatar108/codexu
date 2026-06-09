#!/usr/bin/env node
// US-001 Phase-0 GO/NO-GO feasibility spike (THROWAWAY — not production wiring).
//
// Proves the HARD PART of D-001 against a LIVE Copilot /chat/completions call for
// claude-sonnet-4.6 (the ONE hard-coded Claude slug, the spike's internal allowlist):
//   F1  streamed TYPED tool-call with partial-JSON arguments
//   F2  two interleaved (parallel) tool calls that must not collapse/reorder
//   F3  a continuation turn consuming a tool result
//   F4  usage accounting captured
//   F5  an apply_patch/edit tool (multi-line string arg round-trip)
//
// For each flow it captures (a) the request body, (b) the raw chat SSE, and
// (c) the codex internal ResponseEvent sequence produced by a faithful translator
// (the same per-call_id partial-JSON assembly the production Rust chat_transport.rs
// will perform). Egress is api.githubcopilot.com ONLY (+ api.github.com for the
// codex-sanctioned token refresh, exactly as overlay auth.rs does).
//
// Auth + headers mirror codex/codex-rs-overlay/codex-copilot/src/{auth.rs,header_source.rs}.

'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

// ---- constants mirrored from overlay auth.rs ----
const GITHUB_API_BASE_URL = 'https://api.github.com';
const COPILOT_BASE_URL = 'https://api.githubcopilot.com';
const API_VERSION = '2025-10-01';
const USER_AGENT = 'GitHubCopilotChat/0.38.2';
const EDITOR_PLUGIN_VERSION = 'copilot-chat/0.38.2';
const VSCODE_VERSION = '1.110.1';
const CLAUDE_SLUG = 'claude-sonnet-4.6'; // the single hard-coded Claude slug (spike allowlist)

const APP_DIR = process.env.COPILOT_API_HOME ||
  path.join(os.homedir(), '.local', 'share', 'copilot-api');
const OUT_DIR = __dirname;
const RAW_DIR = path.join(OUT_DIR, 'raw');
const MAPPED_DIR = path.join(OUT_DIR, 'mapped');
for (const d of [RAW_DIR, MAPPED_DIR]) fs.mkdirSync(d, { recursive: true });

function readTrimmed(p) {
  try { return fs.readFileSync(p, 'utf8').trim(); } catch { return null; }
}
function nowSec() { return Math.floor(Date.now() / 1000); }

async function copilotBearer() {
  const cachedRaw = readTrimmed(path.join(APP_DIR, 'copilot_token'));
  if (cachedRaw) {
    try {
      const c = JSON.parse(cachedRaw);
      if (c.token && Number(c.expires_at) > nowSec() + 60) {
        return { token: c.token, source: 'cache' };
      }
    } catch { /* fall through to refresh */ }
  }
  const gh = readTrimmed(path.join(APP_DIR, 'github_token'));
  if (!gh) throw new Error('No github_token. Run: codex login --provider copilot');
  const res = await fetch(`${GITHUB_API_BASE_URL}/copilot_internal/v2/token`, {
    headers: {
      'content-type': 'application/json',
      'accept': 'application/json',
      'authorization': `token ${gh}`,
      'editor-version': `vscode/${VSCODE_VERSION}`,
      'editor-plugin-version': EDITOR_PLUGIN_VERSION,
      'user-agent': USER_AGENT,
      'x-github-api-version': API_VERSION,
      'x-vscode-user-agent-library-version': 'electron-fetch',
    },
  });
  if (!res.ok) throw new Error(`token refresh failed ${res.status}: ${await res.text()}`);
  const j = await res.json();
  // persist refreshed bearer back to cache (same shape as overlay)
  try {
    fs.writeFileSync(path.join(APP_DIR, 'copilot_token'),
      JSON.stringify({ token: j.token, expires_at: j.expires_at, refresh_in: j.refresh_in }));
  } catch { /* best-effort */ }
  return { token: j.token, source: 'refreshed' };
}

function sessionHeaders(bearer) {
  const machineId = readTrimmed(path.join(APP_DIR, 'machine_id')) || crypto.randomUUID();
  const deviceId = readTrimmed(path.join(APP_DIR, 'device_id')) || crypto.randomUUID();
  const sessionId = `${crypto.randomUUID()}${Date.now()}`;
  const reqId = crypto.randomUUID();
  return {
    'authorization': `Bearer ${bearer}`,
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
    'x-request-id': reqId,
    'x-agent-task-id': reqId,
    'x-interaction-id': reqId,
  };
}

// ---- faithful chat-SSE -> codex ResponseEvent translator ----
// Mirrors the per-call_id partial-JSON assembly that production core/src/chat_transport.rs
// will perform when mapping the overlay neutral events to codex_api::ResponseEvent.
function translate(chunks) {
  const events = [];               // codex ResponseEvent sequence (as JSON)
  const toolByIndex = new Map();   // chat tool_call index -> {call_id, name, args, item_id}
  let createdEmitted = false;
  let responseId = null;
  let usage = null;
  let finishReason = null;

  for (const chunk of chunks) {
    if (!responseId && chunk.id) responseId = chunk.id;
    if (chunk.usage) usage = chunk.usage;
    if (!createdEmitted) { events.push({ Created: null }); createdEmitted = true; }
    const choice = (chunk.choices && chunk.choices[0]) || null;
    if (!choice) continue;
    const delta = choice.delta || {};
    if (typeof delta.content === 'string' && delta.content.length) {
      events.push({ OutputTextDelta: delta.content });
    }
    if (Array.isArray(delta.tool_calls)) {
      for (const tc of delta.tool_calls) {
        const idx = tc.index ?? 0;
        if (!toolByIndex.has(idx)) {
          toolByIndex.set(idx, { call_id: null, name: null, args: '', item_id: `item_${idx}` });
        }
        const slot = toolByIndex.get(idx);
        if (tc.id) slot.call_id = tc.id;
        if (tc.function && tc.function.name) slot.name = tc.function.name;
        if (tc.function && typeof tc.function.arguments === 'string') {
          slot.args += tc.function.arguments;
          // streamed partial-JSON fragment -> ToolCallInputDelta
          events.push({
            ToolCallInputDelta: {
              item_id: slot.item_id,
              call_id: slot.call_id,
              delta: tc.function.arguments,
            },
          });
        }
      }
    }
    if (choice.finish_reason) finishReason = choice.finish_reason;
  }

  // finalize each assembled tool call as a typed FunctionCall OutputItemDone
  const assembledTools = [];
  for (const [idx, slot] of [...toolByIndex.entries()].sort((a, b) => a[0] - b[0])) {
    let argsValid = false;
    try { JSON.parse(slot.args); argsValid = true; } catch { argsValid = false; }
    assembledTools.push({ idx, call_id: slot.call_id, name: slot.name, args: slot.args, argsValid });
    events.push({
      OutputItemDone: {
        FunctionCall: {
          id: null,
          name: slot.name,
          namespace: null,
          arguments: slot.args, // codex keeps args as a raw JSON *string*
          call_id: slot.call_id,
        },
      },
    });
  }

  events.push({
    Completed: {
      response_id: responseId,
      token_usage: usage
        ? {
            input_tokens: usage.prompt_tokens,
            output_tokens: usage.completion_tokens,
            total_tokens: usage.total_tokens,
          }
        : null,
      end_turn: finishReason === 'stop' || finishReason === 'tool_calls' ? true : null,
    },
  });

  return { events, assembledTools, usage, finishReason, responseId };
}

async function streamChat(headers, body, rawFile) {
  const res = await fetch(`${COPILOT_BASE_URL}/chat/completions`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`chat/completions ${res.status}: ${t.slice(0, 800)}`);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  let rawAll = '';
  const chunks = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    const text = decoder.decode(value, { stream: true });
    rawAll += text;
    buf += text;
    let nl;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl).replace(/\r$/, '');
      buf = buf.slice(nl + 1);
      if (!line.startsWith('data:')) continue;
      const data = line.slice(5).trim();
      if (data === '[DONE]') continue;
      if (!data) continue;
      try { chunks.push(JSON.parse(data)); } catch { /* keep raw only */ }
    }
  }
  fs.writeFileSync(rawFile, rawAll);
  return chunks;
}

// ---- tool/message fixtures ----
const TOOLS_WEATHER = [{
  type: 'function',
  function: {
    name: 'get_weather',
    description: 'Get current weather for a city.',
    parameters: {
      type: 'object',
      properties: {
        location: { type: 'string', description: 'City name' },
        unit: { type: 'string', enum: ['celsius', 'fahrenheit'] },
      },
      required: ['location'],
    },
  },
}];
const TOOL_APPLY_PATCH = {
  type: 'function',
  function: {
    name: 'apply_patch',
    description: 'Apply a unified-diff style patch to the workspace.',
    parameters: {
      type: 'object',
      properties: {
        input: { type: 'string', description: 'The full patch text (apply_patch envelope).' },
      },
      required: ['input'],
    },
  },
};

async function main() {
  const summary = { slug: CLAUDE_SLUG, startedAt: new Date().toISOString(), flows: {} };
  const { token, source } = await copilotBearer();
  summary.bearerSource = source;
  console.log(`[spike] bearer source=${source}; slug=${CLAUDE_SLUG}`);
  const headers = sessionHeaders(token);

  // ---------- F1: single typed tool-call, streamed partial JSON ----------
  {
    const body = {
      model: CLAUDE_SLUG, stream: true, stream_options: { include_usage: true },
      parallel_tool_calls: true, tools: TOOLS_WEATHER, tool_choice: 'auto',
      messages: [
        { role: 'system', content: 'You are a coding agent. Use tools when asked.' },
        { role: 'user', content: 'What is the weather in Paris in celsius? Call get_weather.' },
      ],
    };
    const chunks = await streamChat(headers, body, path.join(RAW_DIR, 'flow1.sse.txt'));
    const t = translate(chunks);
    fs.writeFileSync(path.join(MAPPED_DIR, 'flow1.events.json'), JSON.stringify(t.events, null, 2));
    const tc = t.assembledTools[0];
    const pass = !!tc && tc.name === 'get_weather' && tc.argsValid &&
      JSON.parse(tc.args).location;
    summary.flows.F1_typed_tool_call = {
      pass: !!pass, toolName: tc && tc.name, argsValid: tc && tc.argsValid,
      assembledArgs: tc && tc.args,
      toolCallInputDeltas: t.events.filter(e => e.ToolCallInputDelta).length,
      noRawJsonAsText: !t.events.some(e => typeof e.OutputTextDelta === 'string' &&
        e.OutputTextDelta.includes('get_weather')),
    };
    console.log(`[spike] F1 typed tool-call pass=${!!pass} args=${tc && tc.args}`);
    summary._f1ToolForContinuation = tc;
  }

  // ---------- F2: two parallel/interleaved tool calls ----------
  {
    const body = {
      model: CLAUDE_SLUG, stream: true, stream_options: { include_usage: true },
      parallel_tool_calls: true, tools: TOOLS_WEATHER, tool_choice: 'auto',
      messages: [
        { role: 'system', content: 'You are a coding agent. Use tools when asked.' },
        { role: 'user', content: 'Get the weather for BOTH Paris and Tokyo. Call get_weather twice (in parallel), once per city.' },
      ],
    };
    const chunks = await streamChat(headers, body, path.join(RAW_DIR, 'flow2.sse.txt'));
    const t = translate(chunks);
    fs.writeFileSync(path.join(MAPPED_DIR, 'flow2.events.json'), JSON.stringify(t.events, null, 2));
    const cities = t.assembledTools
      .filter(x => x.argsValid)
      .map(x => { try { return JSON.parse(x.args).location; } catch { return null; } });
    const distinctIds = new Set(t.assembledTools.map(x => x.call_id).filter(Boolean));
    const pass = t.assembledTools.length >= 2 && t.assembledTools.every(x => x.argsValid) &&
      distinctIds.size === t.assembledTools.length;
    summary.flows.F2_parallel_tool_calls = {
      pass, count: t.assembledTools.length, cities, distinctCallIds: distinctIds.size,
      noCollapse: distinctIds.size === t.assembledTools.length,
    };
    console.log(`[spike] F2 parallel pass=${pass} count=${t.assembledTools.length} cities=${JSON.stringify(cities)}`);
  }

  // ---------- F3: continuation turn consuming a tool result ----------
  {
    const tc = summary._f1ToolForContinuation;
    if (!tc || !tc.argsValid) {
      summary.flows.F3_continuation = { pass: false, reason: 'F1 produced no valid tool call to continue from' };
      console.log('[spike] F3 SKIP (no F1 tool)');
    } else {
      const body = {
        model: CLAUDE_SLUG, stream: true, stream_options: { include_usage: true },
        tools: TOOLS_WEATHER, tool_choice: 'auto',
        messages: [
          { role: 'system', content: 'You are a coding agent. Use tools when asked.' },
          { role: 'user', content: 'What is the weather in Paris in celsius? Call get_weather.' },
          { role: 'assistant', content: null, tool_calls: [{ id: tc.call_id, type: 'function', function: { name: tc.name, arguments: tc.args } }] },
          { role: 'tool', tool_call_id: tc.call_id, content: '{"location":"Paris","temperature":14,"unit":"celsius","conditions":"overcast"}' },
        ],
      };
      const chunks = await streamChat(headers, body, path.join(RAW_DIR, 'flow3.sse.txt'));
      const t = translate(chunks);
      fs.writeFileSync(path.join(MAPPED_DIR, 'flow3.events.json'), JSON.stringify(t.events, null, 2));
      const finalText = t.events.filter(e => typeof e.OutputTextDelta === 'string').map(e => e.OutputTextDelta).join('');
      const pass = finalText.length > 0 && (/14|overcast|paris/i.test(finalText));
      summary.flows.F3_continuation = { pass, finalText: finalText.slice(0, 400), finishReason: t.finishReason };
      console.log(`[spike] F3 continuation pass=${pass} text="${finalText.slice(0, 120)}"`);
    }
  }

  // ---------- F4: usage accounting (explicit short content turn) ----------
  {
    const body = {
      model: CLAUDE_SLUG, stream: true, stream_options: { include_usage: true },
      messages: [
        { role: 'system', content: 'You are concise.' },
        { role: 'user', content: 'Say the single word: ok' },
      ],
    };
    const chunks = await streamChat(headers, body, path.join(RAW_DIR, 'flow4.sse.txt'));
    const t = translate(chunks);
    fs.writeFileSync(path.join(MAPPED_DIR, 'flow4.events.json'), JSON.stringify(t.events, null, 2));
    const u = t.usage;
    const pass = !!u && Number.isFinite(u.prompt_tokens) && Number.isFinite(u.completion_tokens);
    summary.flows.F4_usage = { pass, usage: u };
    console.log(`[spike] F4 usage pass=${pass} usage=${JSON.stringify(u)}`);
  }

  // ---------- F5: apply_patch / edit tool (multi-line string arg round-trip) ----------
  {
    const body = {
      model: CLAUDE_SLUG, stream: true, stream_options: { include_usage: true },
      parallel_tool_calls: true, tools: [TOOL_APPLY_PATCH], tool_choice: 'auto',
      messages: [
        { role: 'system', content: 'You are a coding agent. To edit files you MUST call apply_patch with a patch in the input argument.' },
        { role: 'user', content: 'Add a file hello.txt containing the single line "hello world". Use the apply_patch tool. The input must be a multi-line patch.' },
      ],
    };
    const chunks = await streamChat(headers, body, path.join(RAW_DIR, 'flow5.sse.txt'));
    const t = translate(chunks);
    fs.writeFileSync(path.join(MAPPED_DIR, 'flow5.events.json'), JSON.stringify(t.events, null, 2));
    const tc = t.assembledTools.find(x => x.name === 'apply_patch');
    let inputStr = null, multiLine = false;
    if (tc && tc.argsValid) { try { inputStr = JSON.parse(tc.args).input; multiLine = typeof inputStr === 'string' && inputStr.includes('\n'); } catch {} }
    const pass = !!tc && tc.argsValid && typeof inputStr === 'string' && inputStr.length > 0;
    summary.flows.F5_apply_patch = { pass, argsValid: tc && tc.argsValid, multiLine, inputPreview: inputStr && inputStr.slice(0, 300) };
    console.log(`[spike] F5 apply_patch pass=${pass} multiLine=${multiLine}`);
  }

  delete summary._f1ToolForContinuation;
  summary.finishedAt = new Date().toISOString();
  const flows = summary.flows;
  const mustPass = ['F1_typed_tool_call', 'F2_parallel_tool_calls', 'F3_continuation', 'F4_usage', 'F5_apply_patch'];
  summary.verdict = mustPass.every(k => flows[k] && flows[k].pass) ? 'GO' : 'NO-GO';
  summary.failingFlows = mustPass.filter(k => !(flows[k] && flows[k].pass));
  fs.writeFileSync(path.join(OUT_DIR, 'spike-summary.json'), JSON.stringify(summary, null, 2));
  console.log(`\n[spike] VERDICT=${summary.verdict} failing=${JSON.stringify(summary.failingFlows)}`);
}

main().catch(e => { console.error('[spike] FATAL', e); process.exit(1); });
