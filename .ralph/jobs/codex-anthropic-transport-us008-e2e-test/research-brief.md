# Research Brief: US-008 chat-transport e2e (refreshed 2026-06-27)

*Citations verified against codex inner `codex-patched` HEAD `16175abdc0` (wrapper `ed44c1d0`), the just-shipped signed-CoT `/v1/messages` transport. All paths under `codex/external/repos/codex-patched/codex-rs/` (`codex-rs/`) or `codex/codex-rs-overlay/` (overlay).*

## Headline: what the signed-CoT ship changed (vs the 2026-06-24 plan)

- The signed native Anthropic Messages (`/v1/messages`) transport SHIPPED — `patch-surface.md` §14 invariants **63–68**. The unsigned `/chat/completions` path is intact and is the **degrade target** of the signed path.
- Routing is now a **dual-gate** decision (`chat_transport.rs:79` `effective_wire_api_gated(route, provider_wire, anthropic_enabled, signed_messages_enabled)`), unit-tested by `signed_messages_route_honors_both_gates_with_degrade`:
  - `AnthropicMessages` route + parent ON + signed ON → `WireApi::AnthropicMessages` (signed `/v1/messages`).
  - `AnthropicMessages` route + parent ON + signed OFF → `WireApi::ChatCompletions` (degrade).
  - `ChatCompletions` route + parent ON → `WireApi::ChatCompletions` (US-008's target).
  - else / parent OFF → `provider_wire` (Responses).
- `client.rs` dispatch is now 3-way: `:1676` ChatCompletions → `stream_chat_completions` `:1702`; **NEW** `:1718` AnthropicMessages → `stream_anthropic_messages` `:1736`. Routing decision at `:1634`.
- New signed sub-gate: `install_anthropic_signed_messages_gate(enabled)` / `anthropic_signed_messages_resolved()` (`model-provider/src/anthropic_gate.rs:58`/`:64`), re-derived from `Feature::AnthropicSignedMessages` (`config/mod.rs:2835-2837`; `features/src/lib.rs:155`, default OFF). Parent gate `install_anthropic_gate`/`anthropic_models_resolved` at `:44`/`:50`, re-derived from `Feature::AnthropicModels` (`config/mod.rs:2832`).

**Routing verdict:** US-003's `with_model_info_override` + parent-gate-on setup still selects `/chat/completions` as long as it does NOT enable the signed sub-gate (default off) and uses `wire_route = ChatCompletions`. Add an explicit "egress is `/v1/chat/completions`, not `/v1/messages`" assertion.

## Verified citations (current file:line)

**Live chat path**
- `client.rs`: routing `:1634`; ChatCompletions arm `:1676` (base_url `:1691`, reasoning_effort `:1698`, stream_chat_completions `:1702`); AnthropicMessages arm `:1718`/`:1736`.
- `chat_transport.rs`: `stream_chat_completions` `:234`; `build_chat_request_body` call `:240`; `CopilotAuth::new()` `:245` + `CopilotHeaderSource::new().await` `:246`; `run_chat_stream` `:275` → `send_chat_request` `:289`; `effective_wire_api` `:70` / `effective_wire_api_gated` `:79`; `drain_chat_chunk` (anthropic-first) `:423`; ordering test `single_read_with_reasoning_and_content_keeps_reasoning_first` `:1174`.
- `anthropic_sse.rs`: `reasoning_text`→`ReasoningDelta` `:345-355` (variant `:44`); tests `reasoning_text_chunks_surface_one_reasoning_delta_each` `:692`, `empty_reasoning_text_chunk_is_skipped` `:731`.

**Payload / replay (overlay `codex-copilot`)**
- `payload.rs`: `build_chat_request_body` `:232`; `"reasoning" =>` arm `:332`; `capped_reasoning_plaintext` `:352`; `MAX_REPLAYED_REASONING_BYTES = 8000` `:362`; truncation marker `format!("[earlier reasoning truncated]\n{}", …)` `:377-386`.
- Tests: `build_chat_body_sets_reasoning_effort_when_selected` `:729`, `build_chat_body_omits_reasoning_effort_when_absent` `:744`, `build_chat_body_replays_reasoning_as_standalone_assistant_message` `:767`, `persisted_reasoning_item_reaches_chat_request_body` `:800`, `build_chat_body_caps_oversized_replayed_reasoning` `:856`.

**Chat parse / function_call / usage (overlay `codex-copilot`)**
- `chat_completions.rs`: `CHAT_COMPLETIONS_PATH = "/chat/completions"` `:31`; `send_chat_request` `:215`; tests `single_typed_tool_call_assembles_valid_json_args` `:274` (name/args/call_id), `two_parallel_tool_calls_do_not_collapse_or_reorder` `:324`, `usage_is_surfaced_from_trailing_chunk` `:364`.

**Auth fixture feasibility (Option A)**
- `auth.rs`: `CopilotAuth::new()` `:102`; `copilot_token(force_refresh)` `:170`; no-network short-circuit `:173-177` (returns cached token when `expires_at > now+60`).
- `header_source.rs`: `CopilotHeaderSource::new` `:27`; `build_cached_headers` `:89` → `copilot_token(false)` `:90`.
- `paths.rs`: `from_env()` `:15`; reads env `COPILOT_API_HOME` `:16`; fallback `~/.local/share/copilot-api` `:20`.

**Test harness (to mirror)**
- `core/tests/common/responses.rs`: `ResponseMock` `:39`, `single_request` `:50`, `requests` `:58`, `sse` `:599`, `ev_function_call` `:815`, `mount_sse_once` `:995`, `start_mock_server` `:1182`, `ResponsesRequest` `:84` (accessors `body_json` `:102`, `input` `:190`, `function_call_output` `:205`, `header` `:285`, `path` `:293`).
- `core/tests/common/test_codex.rs`: `with_model_info_override` `:283` (closure gets `&mut ModelInfo`); provider `base_url = format!("{}/v1", server.uri())` `:369` → mock mounts `/v1/chat/completions`.
- `core/tests/common/streaming_sse.rs`: `StreamingSseChunk` `:15`, `start_streaming_sse_server` `:59`.
- `core/tests/common/lib.rs` exposes `pub mod responses; pub mod streaming_sse;` — add `pub mod chat_sse;`.
- `core/tests/suite/mod.rs` registers each test as `mod <name>;` (`mod client;` `:43`, `mod permissions_messages;` `:80`) — add `mod chat_completions;`.

**Gate & home precedent**
- `gate.rs` (overlay): `CODEX_ENABLE_ANTHROPIC_ENV` `:3`, `OnceLock` `:5`, `anthropic_models_enabled()` `:7-12`.
- `model-provider/src/anthropic_gate.rs`: parent `install_anthropic_gate` `:44` / `anthropic_models_resolved` `:50`; signed `install_anthropic_signed_messages_gate` `:58` / `anthropic_signed_messages_resolved` `:64`. Direct test usage at `copilot_models_endpoint.rs:633/657/667`.
- `config/mod.rs`: parent install `:2832`, signed install `:2835-2837`.
- `codex-invariant-tests/Cargo.toml`: `publish = false`, `workspace = "../../external/repos/codex-patched/codex-rs"`, own `tests/`; member at `codex-rs/Cargo.toml:128`; does NOT dev-depend on `core_test_support`.
- `core/tests/common/Cargo.toml`: `name = "core_test_support"`, `codex-core = { workspace = true }`, NO `workspace` key.

## Test-home decision (refreshed)

`patch-surface.md` invariant **37** (typed `function_call` assembly) already NAMES `core/tests/suite/chat_completions.rs` as the "core deterministic e2e" verification location — but the file does NOT exist yet (confirmed). Recommend creating it there (codex-core's own test dir → no dependency cycle, no `core_test_support` preflight). The overlay leaf crate `codex-copilot-e2e-tests` is the documented alternative (zero suite-dir surface, but adds a `codex-rs/Cargo.toml` member edit + the preflight).

## Drift table (old → current line)
client.rs routing 1632→1634; ChatCompletions arm 1675→1676; stream_chat_completions 209→234; build_chat_request_body call 215→240; CopilotAuth/HeaderSource 219-223→245-246; send_chat_request 250→289; effective_wire_api 64-75→70 (gated 79); drain_chat_chunk 398→423; ordering test 1096→1174; MAX_REPLAYED_REASONING_BYTES 359-361→362; capture 242-260→345-355; reasoning-capture test 572→692; empty-skip 611→731; COPILOT_API_HOME read 15→16; base_url {server}/v1 364→369; install_anthropic_gate 37→44; anthropic_models_resolved 43→50. No items GONE.

## Method
Direct source reads of routing/gate seams (chat_transport.rs, client.rs, config/mod.rs, anthropic_gate.rs, suite/mod.rs) + a parallel claude-opus-4.8 explore agent that verified every cited file:line against current HEAD and produced the drift table. patch-surface.md §14 invariants 37/38/63–68 cross-checked.
