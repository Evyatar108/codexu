# US-001 Phase-0 Feasibility Spike — VERDICT: **GO**

**Task:** `codex-anthropic-models-support` (D-001 — Claude via Copilot `/chat/completions` transport)
**Date:** 2026-06-09
**Slug under test:** `claude-sonnet-4.6` (the single hard-coded Claude slug; the spike's internal allowlist — no production wiring)
**Egress:** `api.githubcopilot.com` ONLY (+ `api.github.com/copilot_internal/v2/token` for the codex-sanctioned bearer refresh, identical to overlay `auth.rs`).
**Harness:** `spike/spike.js` (throwaway). Auth + headers mirror `codex/codex-rs-overlay/codex-copilot/src/{auth.rs,header_source.rs}` exactly (Bearer + `copilot-integration-id: vscode-chat`, `editor-version: vscode/1.110.1`, `x-github-api-version: 2025-10-01`, vscode-machineid/sessionid, device-id, `x-initiator: agent`). Bearer was refreshed live from the on-disk `github_token`.

## Must-pass results (all against ONE live Copilot call each)

| Flow | What it proves | Result | Evidence |
|---|---|---|---|
| **F1** streamed TYPED tool-call, partial-JSON args | Chat `delta.tool_calls[].function.arguments` arrive as partial JSON fragments and reassemble into a valid typed `function_call` (never assistant text) | ✅ PASS — assembled `{"location": "Paris", "unit": "celsius"}`, 1 typed tool, 0 raw-JSON-as-text | `raw/flow1.sse.txt`, `mapped/flow1.events.json` |
| **F2** two parallel/interleaved tool calls | Two tool calls don't collapse/reorder; distinct `call_id` per call | ✅ PASS — 2 tools (Paris, Tokyo), 2 distinct `toolu_vrtx_*` ids, kept separate by `index` (2 and 3) | `raw/flow2.sse.txt`, `mapped/flow2.events.json` |
| **F3** continuation turn consuming a tool result | A `role:assistant`(tool_calls)+`role:tool`(result) history continues and yields a final answer | ✅ PASS — final text referenced the injected result ("14°C", "Overcast") | `raw/flow3.sse.txt`, `mapped/flow3.events.json` |
| **F4** usage accounting | The stream carries token usage | ✅ PASS — `usage{prompt_tokens:19, completion_tokens:4, total_tokens:23}` (+ a Copilot-specific `copilot_usage` cost block) | `raw/flow4.sse.txt` |
| **F5** apply_patch / edit tool | A multi-line patch string round-trips through partial-JSON streaming | ✅ PASS — reassembled a valid `*** Begin Patch … *** End Patch` envelope (multi-line) | `raw/flow5.sse.txt`, `mapped/flow5.events.json` |

`spike-summary.json` holds the machine-readable result (`"verdict": "GO"`, `"failingFlows": []`).

## Verified chat-SSE → codex `ResponseEvent` mapping

The mapping is mechanical and lossless (`api/src/common.rs::ResponseEvent`, `protocol/src/models.rs::ResponseItem::FunctionCall`). The throwaway translator in `spike.js::translate()` is the reference for the production Rust `core/src/chat_transport.rs` (US-005):

| Chat-completions SSE field | codex `ResponseEvent` |
|---|---|
| first chunk | `Created` |
| `choices[0].delta.content` (string) | `OutputTextDelta(content)` |
| `choices[0].delta.tool_calls[i].id` + `.function.name` (first fragment for that `index`) | begins a `FunctionCall` item (`call_id`, `name`) |
| `choices[0].delta.tool_calls[i].function.arguments` (fragment) | `ToolCallInputDelta { item_id, call_id, delta }` |
| tool call complete (assembled args) | `OutputItemDone(ResponseItem::FunctionCall { name, arguments: <raw JSON string>, call_id })` |
| trailing `usage` + `finish_reason` | `Completed { response_id, token_usage, end_turn }` |

## Load-bearing wire findings for US-004 / US-005 (genuinely new, from live data)

1. **Tool-call `index` is the content-block position, NOT 0-based contiguous.** Claude via Copilot emitted the tool at `index: 2` in F1 and at `index: 2` and `index: 3` in F2 (preceded by thinking/content blocks). **The per-`call_id` assembler MUST key on the chat `tool_calls[].index` field and tolerate arbitrary / non-zero / non-contiguous values.** A 0-based-contiguous assumption would collapse or misorder parallel calls — this is the single highest-risk translator bug and is now pre-identified.
2. **First fragment carries `id`+`name`+`type:"function"`; subsequent fragments carry only `{function:{arguments:"<chunk>"}, index}`.** Standard OpenAI chat-stream shape — `call_id` (`toolu_vrtx_*`) and `name` appear once, up front.
3. **Usage** rides a trailing chunk (empty `choices` delta) with `finish_reason:"stop"` on the last content choice; `usage` has `prompt_tokens`/`completion_tokens`/`total_tokens`. A provider-specific `copilot_usage` cost block is also present — ignore for token accounting (or surface as metadata only).
4. **`apply_patch` works as a function tool with `{input: "<multi-line patch>"}`** — the multi-line string survives partial-JSON reassembly intact, so codex's freeform apply_patch can be represented over chat as a function tool.
5. **Reasoning/thinking did not surface as `delta.content`** (F1/F4 content was `null` through the tool path), consistent with the request-side gate (`supports_reasoning_summaries=false`). US-006 must still add the explicit translator no-leak assertion (thinking never emitted as `OutputTextDelta`).

## NO-GO off-ramp (did NOT trigger)

The D-003 off-ramp (defer / experimental-text-only, while still landing the US-003 hidden-until-transport guardrail) was the documented exit had any must-pass flow failed. **No flow failed; the off-ramp is not taken.** The full D-001 build (US-002…US-008) is cleared to proceed.

## Scope notes / honest limits

- This spike validates the **wire + the mapping** — the genuine unknowns. The **production translator is Rust** (`payload.rs` builder + `chat_completions.rs` neutral SSE parser in US-004; `chat_transport.rs` neutral→`ResponseEvent` map in US-005). The `cargo check -p <crate>` gate from US-001's AC applies once that Rust lands (US-002+), not to this Node harness; the harness deliberately avoids the heavy LLVM build to keep the gate fast and the live evidence reproducible.
- The translator here is the faithful reference implementation the Rust port must match; `mapped/*.events.json` are the golden sequences for the deterministic US-008 test.
