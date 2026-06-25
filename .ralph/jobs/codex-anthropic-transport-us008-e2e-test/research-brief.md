# Research Brief — US-008 Claude `/chat/completions` e2e test

Task: `codex-anthropic-transport-us008-e2e-test` (codex SUBMODULE). Test-only addition (+ minimal test-support scaffolding). No production behavior change to the transport itself, but a **Copilot-session test seam** must be (re)built (see §B).

All paths are in the initialized primary checkout. Two trees:
- Patched upstream: `codex/external/repos/codex-patched/codex-rs/` (referred to as `codex-rs/`)
- Fork overlay crates: `codex/codex-rs-overlay/` (e.g. `codex-copilot/`) — wired into the `codex-rs` workspace as path-dep members; NOT physically under `codex-rs/`.

## Consolidated File List

**Production (read-only during planning):**
- `codex-rs/core/src/chat_transport.rs` — chat dispatch + request build + response stream/parse. THE live chat path. (`stream_chat_completions` :209; `run_chat_stream` :250; `drain_chat_chunk` :398 — same-chunk ordering; reasoning accumulation :477-502; `ReasoningMessageItem` :138-204; tool finalize :348-365; usage :624-642; `build_chat_request_body` call site :215.)
- `codex-rs/core/src/chat_transport/anthropic_sse.rs` — Anthropic SSE decode. `AnthropicSseParser` :54; `push` :67; `finish` :78; reasoning_text capture :248-260; `TranslatedSseEvent::ReasoningDelta` :42. 12 inline parser unit tests (:367-625).
- `codex-rs/core/src/client.rs` — wire-API dispatch. `effective_wire_api` :1633; ChatCompletions arm :1675-1708; `base_url = provider.info().base_url` :1689; `reasoning_effort` thread :1698-1700; calls `stream_chat_completions` :1701.
- `codex/codex-rs-overlay/codex-copilot/src/payload.rs` — `build_chat_request_body` :232 (Responses→Chat translate); reasoning replay arm `"reasoning" =>` :332-339; `capped_reasoning_plaintext` :352; **`MAX_REPLAYED_REASONING_BYTES = 8000`** :362 (PER-ITEM cap, tail-keep w/ `[earlier reasoning truncated]\n` :386). 4 inline replay/effort unit tests (:729-880).
- `codex/codex-rs-overlay/codex-copilot/src/chat_completions.rs` — OpenAI-shape overlay parser `ChatSseParser` + `send_chat_request` :215; `CHAT_COMPLETIONS_PATH = "/chat/completions"` :31. 5 inline parser unit tests (:274-420).
- `codex/codex-rs-overlay/codex-copilot/src/auth.rs` — `CopilotAuth::new()` :102 (hardcoded GITHUB/COPILOT base URLs; reads on-disk token cache).
- `codex/codex-rs-overlay/codex-copilot/src/header_source.rs` — `CopilotHeaderSource::new(auth).await` :27 → `build_cached_headers(&auth).await` :29 (token exchange → real network).
- `codex-rs/model-provider/src/anthropic_gate.rs` — `install_anthropic_gate(enabled)` :37; `anthropic_models_resolved()` :43 (PROCESS-GLOBAL AtomicBool). Re-derived from `Feature::AnthropicModels` at `core/src/config/mod.rs:2832`.
- `codex-rs/protocol/src/openai_models.rs` :402-417 — `WireRoute`/chat-route hint on `ModelInfo`.

**Test infra to mirror / extend:**
- `codex-rs/core/tests/common/responses.rs` — `core_test_support::responses` mock-SSE harness for `/responses`. `ResponseMock` :39, `single_request` :50, `requests` :58; `sse(...)` :599; event ctors `ev_completed` :619, `ev_response_created` :630, `ev_assistant_message` :667, `ev_output_text_delta` :703, `ev_reasoning_item` :710, `ev_reasoning_text_delta` :766, `ev_function_call` :815; mounting `mount_sse_once` :995, `mount_sse_once_match` :982, `mount_sse_sequence` :1438; `start_mock_server` :1182; `impl Match for ResponseMock` :584. `ResponsesRequest` accessors `input` :190, `function_call_output` :205, `header` :285, `path` :293, `body_json`.
- `codex-rs/core/tests/common/Cargo.toml` — crate `name = "core_test_support"` :2.
- `codex-rs/core/tests/suite/client.rs` — integration tests using `test_codex().build(&server)`; `mount_sse_once`, `wait_for_event`, `Op::UserInput`. **:1059-1065 = THE KEY FINDING (see §B).**
- Example suite tests using the harness: `core/tests/suite/abort_tasks.rs`, `items.rs` (uses `ev_reasoning_text_delta` :1153), `otel.rs` (:791).

## Findings by central assertion

### A1 — Reasoning capture (turn 1)
`decode_openai_structured_content` (anthropic_sse.rs:242) recognizes the non-standard `choices[].delta.reasoning_text` String (:254-259) and emits `TranslatedSseEvent::ReasoningDelta`. `chat_transport.rs:477-502` accumulates deltas into a `ReasoningMessageItem` (open/push_str), emitting the reasoning-item lifecycle. **Nuance:** parser capture is NOT gated by `reasoning_effort` — it captures whatever `reasoning_text` the wire carries. `reasoning_effort` gates the OUTGOING request (top-level `reasoning_effort` field, payload.rs:216/273) that makes Copilot emit CoT. So the e2e: assert turn-1 outgoing body carries `reasoning_effort`; mock returns `reasoning_text` deltas; assert captured reasoning equals the mock.

### A2 — Reasoning replay continuity + byte cap (turn 2)
On the next turn, the persisted `reasoning` input item is replayed by `build_chat_request_body`→`push_chat_message` `"reasoning" =>` arm (payload.rs:332-339) as a standalone `{"role":"assistant","content":<capped text>}` message. `capped_reasoning_plaintext` (:352) enforces **`MAX_REPLAYED_REASONING_BYTES = 8000`** PER ITEM, keeping the tail on a char boundary, prefixing `[earlier reasoning truncated]\n` (:377-386).
**SCOPE CORRECTION (operator's assertion 2 says "per-item + AGGREGATE BYTE cap"):** there is NO aggregate *byte* cap in the replay path. payload.rs:359-361 explicitly states the per-item cap is the only one here; "the total replay budget across many prior turns is governed by the existing history/compaction context management, not here" (model-visible-context = ≤10K tokens per item, codex AGENTS.md "Model visible context"). So the e2e asserts (a) the per-item 8000-byte truncation precisely, and (b) optionally that N replayed items are EACH capped. The true aggregate is a token-based history cap enforced elsewhere (history/compaction), out of direct scope for a payload-replay test — flagged as an Open Question for the operator.

### A3 — Same-chunk ordering fix
`drain_chat_chunk` (chat_transport.rs:398-437) drains the Anthropic (translated) events FIRST (`handle_translated_events` :408), THEN overlay events (:421). Doc :387-397 explains: if a single network read buffers both the first reasoning line and the first content line, draining the overlay parser first would open the assistant message before the reasoning item, later nulling the active item and tripping `error_or_panic("OutputTextDelta without active item")`. Defense-in-depth `close_reasoning_if_open` :514-540. Existing regression unit test: `single_read_with_reasoning_and_content_keeps_reasoning_first` :1096. The e2e should exercise this via a mock chunk that packs reasoning+content in one body.

### A4 — function_call assembly + usage
Tool calls: OpenAI `tool_calls` decoded anthropic_sse.rs:283-300; Anthropic `tool_use` :123-147; finalized in index order chat_transport.rs:348-365 into `ResponseItem::FunctionCall { name, arguments, call_id }`. Usage: `input_tokens` from `message_start` (anthropic_sse.rs:116-121), `output_tokens` from `message_delta` (:192); chat usage `ChatStreamEvent::Usage` chat_transport.rs:624-636 → `to_token_usage` :642, emitted on `Completed` :373.

### A5 — No /responses regression
The `/responses` path is untouched by a test-only change; assert by leaving existing `core/tests/suite` responses tests green (they run under the same harness). Routing tests `routing_maps_hint_to_effective_wire_when_anthropic_enabled` (chat_transport.rs:662) + `routing_falls_back_to_responses_when_anthropic_disabled` (:682) already guard the dispatch boundary.

### Existing "17/17" parser tests (the gap)
12 in `anthropic_sse.rs` (:367-625) + 5 in `codex-copilot/src/chat_completions.rs` (:274-420). All are pure single-`push`/`finish` wire-format/mapping unit tests; the replay side is covered by 4 unit tests in `payload.rs` (:729-880). NONE drive a full multi-turn agentic conversation through a mounted mock server with reasoning capture→persist→replay. That end-to-end flow is the US-008 gap.

## §B — THE CRITICAL FINDING: the Copilot-session test seam does not exist

`core/tests/suite/client.rs:1059-1065` (verbatim):
> "SANDBOX PATCH: the WIP copilot-client integration tests (test_copilot_auth, copilot_client_fixture -> CopilotSessionFixture, configure_copilot_session_for_tests, and the copilot_* tests) were removed during the v0.140.0 rebase. They referenced fork test infrastructure that was never committed (the responses-URL test side-channel that redirects /responses to a wiremock server does not exist). The copilot transport stays covered by model-provider/src/copilot.rs unit tests; re-adding end-to-end copilot-client tests is tracked as a follow-up (codex-rebase-debt-fix-client-copilot-fixture)."

Why this blocks a naive "mirror the responses harness" approach:
- `stream_chat_completions` (chat_transport.rs:219-223) constructs `CopilotAuth::new()` + `CopilotHeaderSource::new(auth).await` INLINE, with no injection parameter.
- `CopilotAuth::new()` (auth.rs:102-110) hardcodes `GITHUB_BASE_URL`/`GITHUB_API_BASE_URL`/`COPILOT_BASE_URL` and reads an on-disk Copilot token cache.
- `CopilotHeaderSource::new(auth).await` → `build_cached_headers` (header_source.rs:29) performs a token exchange against the REAL GitHub/Copilot endpoints (network).
- `base_url` for the chat POST IS already injectable (flows from `provider.info().base_url`, client.rs:1689 → `stream_chat_completions(base_url)` :212 → `send_chat_request({base_url}/chat/completions)`), so a wiremock URL reaches the request — but auth construction still hits the network and reads real tokens.

Therefore US-008 must (re)build a Copilot-session test seam: a process-global override (overlay-first, in `codex-copilot`) that installs a fake header source / static bearer and lets `stream_chat_completions` skip real auth construction, redirecting the whole chat call to the wiremock server. This is the same infra `codex-rebase-debt-fix-client-copilot-fixture` tracks — US-008 and that follow-up should be coordinated (US-008 likely subsumes/depends on it).

## §B(test) — Test setup recipe (confirmed seams)
- `install_anthropic_gate(true)` (`codex_model_provider::install_anthropic_gate`, lib.rs:25) — PROCESS-GLOBAL; existing tests call it directly (model-provider/src/copilot_models_endpoint.rs:587/595/603). Routes a Claude-row model to `WireApi::ChatCompletions`. Parallelism hazard: the gate is process-global — multiple chat tests must not race it (serialize, or set/reset around each).
- Model selection: a `ModelInfo` whose `wire_route` resolves to chat (a Claude slug, e.g. `claude-sonnet-4.6`/`claude-opus-4.8`) + a `default_reasoning_level` or per-turn `effort` so `reasoning_effort` is `Some`.
- `test_codex().build(&server)` sets `model_provider.base_url` → mock server (so the chat POST + the auth seam, once stubbed, hit the mock). Existing chat-style tests use `skip_if_no_network!()` because wiremock needs localhost TCP (codex sandbox disables network) — the e2e will too.
- Endpoint path the mock must match: `POST {base}/chat/completions` (chat_completions.rs:31), vs the responses harness `/responses`.

## §C — Test-support scaffolding required (the "minimal harness")
1. Copilot-session test seam (overlay `codex-copilot`, zero conflict surface; + a tiny consuming branch in the fork file `chat_transport.rs`): inject a fake `CopilotHeaderSource`/bearer + skip real `CopilotAuth::new()`/token-exchange. Mirrors removed `configure_copilot_session_for_tests`.
2. Chat-SSE mock harness in `core_test_support` (new module, mirror `responses.rs`): `chat_sse(...)` frame builder; chat `ev_*` ctors (assistant content delta, `reasoning_text` delta, tool_call, finish_reason, usage chunk, `[DONE]`); `mount_chat_sse_once` / `mount_chat_sse_sequence` returning a `ChatRequestMock` that records outbound `/chat/completions` POST bodies; `ChatRequest` accessors (messages[], the replayed assistant reasoning message, `reasoning_effort`, tool_call assembly).

## §D — Architect agent
Architect explore agent ran very long (>880s) without delivering; its scope (payload replay/byte cap, e2e placement, observe-the-payload seam, risks) was independently resolved above by direct source reads with file:line citations. [If it returns useful deltas they will be folded into the plan before Phase 4.]
