# Research Brief — codex-anthropic-models-support (D-001 chat-completions transport)

Sources: explore/researcher + explore/architect agents + first-hand source reads (codex lens pending).
Search root: `D:/harness-efforts/codexu/codex` (wrapper) and `.../external/repos/codex-patched/codex-rs` (patched submodule).

## Consolidated File List

### Upstream-canonical (patched submodule `codex/external/repos/codex-patched/codex-rs/`) — minimize edits
- `model-provider-info/src/lib.rs:52-82` — `WireApi` enum (only `Responses`; `#[derive(Copy, Default, Serialize, JsonSchema)]`, `#[serde(rename_all="lowercase")]`; Display match exhaustive `:63-65`; custom `Deserialize` `:70-82` rejects `"chat"` with `CHAT_WIRE_API_REMOVED_ERROR`). `ModelProviderInfo.wire_api` field `:113-115`.
- `model-provider-info/src/lib.rs:477-498` — `create_copilot_provider()` hardcodes `wire_api: WireApi::Responses` (provider-level).
- `core/src/client.rs:1571-1621` — `stream()` (returns `core` `ResponseStream`); single-arm `match wire_api { Responses => ... stream_responses_api(...) }`. THE dispatch seam.
- `core/src/client.rs` — existing `stream_responses_api` (+ `map_response_stream`, invariant 14: forwards `Completed` before trace I/O).
- `model-provider/src/copilot_models_endpoint.rs:199-215` — `is_chat_responses_picker_entry` filter (requires `/responses` = `COPILOT_RESPONSES_ENDPOINT`). `synthesize_from_capabilities` `:230-292` (Copilot-only slugs; sets vision/parallel_tool_calls/context_window/etc).
- `model-provider/src/copilot.rs:150-172` — `api_auth()` builds `CopilotHeaderSource::new(auth)`; fail-closed on untrusted base_url. wiremock test mod `:185-280`.
- `model-provider/src/provider.rs:160-174` — `create_model_provider()` routes copilot id → `CopilotModelProvider`.
- `codex-api/src/common.rs` — request shapes `ResponsesApiRequest`/`ResponseCreateWsRequest` `:170-240`; `ResponseEvent` enum `:72-111`; codex-api `ResponseStream` `:299-311`; `Reasoning` `:113-119`.
- `codex-api/src/sse/responses.rs:29-196` — Responses SSE parser (mirror its structure for chat). `TokenUsage` mapping `:100-132`.
- `core/src/client_common.rs:23-46` — `Prompt { input: Vec<ResponseItem>, tools: Vec<ToolSpec> (pub(crate)), parallel_tool_calls (pub(crate)), base_instructions, personality, output_schema, output_schema_strict }`. **`tools`/`parallel_tool_calls` are core-private** → overlay cannot read them; core must convert Prompt→chat-body.
- `core/src/client_common.rs:68-87` — codex-core `ResponseStream { rx_event: mpsc::Receiver<Result<ResponseEvent>>, consumer_dropped }` + Drop cancels token. THIS is what `stream()` returns (distinct from codex-api's ResponseStream).
- `models-manager/src/manager.rs` + `cache.rs` — `models_cache.json`, TTL 300s, keyed by path + `client_version` + `etag`; `ModelsCache{fetched_at, etag, client_version, models}`. Picker presets `manager.rs:76-121`.
- `Cargo.toml` (codex-rs root) — workspace members incl overlay path deps `../../../../codex-rs-overlay/codex-copilot` etc.

### Overlay (wrapper repo `codex/codex-rs-overlay/codex-copilot/`) — fork-exclusive, zero upstream conflict
- Existing crate: `src/{auth.rs, header_source.rs, lib.rs, paths.rs, payload.rs}`. Deps: codex-client, reqwest(json,rustls-tls), serde, serde_json, sha2, tokio, http, uuid. `workspace = "../../external/repos/codex-patched/codex-rs"`.
- **NEW**: `src/chat_completions.rs` (POST + SSE→ResponseEvent translation), EXTEND `src/payload.rs` (chat request body builder). Register `pub mod` in `lib.rs`.
- `src/auth.rs` — already applies `set_sensitive(true)` (redaction invariant 7).

### Wrapper-repo docs/scripts
- `codex/docs/implementation/patch-surface.md` §14 invariant table (`:757-799`, format below), §15 rebase replant notes (`:1245-1298`).
- `codex/scripts/audit_network_calls.sh` — 5 phases; `KNOWN_PATCH_FILES`/`OVERLAY_KNOWN_PATCH_FILES`/`EXCLUDED_FILES`; codex-copilot already overlay-known.
- `codex/scripts/audit_invariants.sh` — grep guards for §14 invariants; overlay invariant-tests crate `codex-rs-overlay/codex-invariant-tests`.

## §14 invariant row format
`| Invariant | One-line description | Enforcement type (in-tree-test|grep|overlay-test|Windows-only) | Test path or script reference | Deliberate-violation procedure |`
Next free numbers ~30+ (1-21 used, 22 reserved, 23/24 used, 30=stream-cut per CLAUDE.md).

## Key architectural decisions (for the plan)
1. **Overlay placement (chosen):** chat translation in `codex-rs-overlay/codex-copilot/` (tenet #1 option 1). The ONLY upstream-canonical edits: (a) WireApi variant, (b) one client.rs dispatch arm, (c) filter relaxation, (d) per-model wire hint plumbing in ModelInfo/synthesize. Each needs `// SANDBOX PATCH:` + §14 row + §15 note.
2. **Per-model routing (architect-recommended): ModelInfo per-model wire hint.** wire_api is provider-level, but Claude vs GPT must differ within one Copilot provider. Add a wire-hint field to ModelInfo set during translate_entry/synthesize based on `supported_endpoints`; dispatch reads `model_info` hint (falls back to provider.wire_api). MUST persist hint in models_cache.json (cache invalidates on client_version mismatch — bump or include hint in serialized ModelInfo). Alternatives rejected: stream()-time supported_endpoints lookup (runtime coupling); second copilot-chat provider (splits auth/picker/cache — worst UX).
3. **Prompt-internals constraint:** `Prompt.tools`/`parallel_tool_calls` are `pub(crate)`. So a thin **core** `stream_chat_completions` (new module, NOT bloating client.rs) converts Prompt→a public chat request body, calls overlay `codex_copilot::chat_completions::stream(...)` (which POSTs + yields `ResponseEvent`), and wraps the result into core `ResponseStream` (owns channel+spawn+Drop/cancellation). Overlay depends on codex-api for ResponseEvent/ResponseItem (lower crate, no cycle).
4. **Translation hard points:** streamed partial tool-call JSON args → buffer per `call_id` until valid JSON → emit typed `ResponseEvent::ToolCallInputDelta`/`OutputItemDone` function_call (NOT assistant text); parallel tool calls (interleaved deltas); reasoning/thinking (no chat analog → contract-gated); usage (`Completed{token_usage,end_turn}` ← chat `usage`/`finish_reason`); vision image_url data-URI parts (`codex-api/src/images.rs`).

## v1 feature contract (architect proposal — refine in plan; NEVER silent degradation)
| Responses feature | Claude-via-chat v1 | Enforcement anchor |
|---|---|---|
| typed tool-calls (function_call) | SUPPORTED (must round-trip; core contract) | overlay translator + spike |
| apply_patch/edit | SUPPORTED iff tool-call path round-trips | core/src/apply_patch.rs, tools/handlers/dynamic.rs |
| vision (image input) | SUPPORTED iff image parts survive | `supports_image_detail_original` copilot_models_endpoint.rs:281-283 |
| reasoning summaries | HARD-ERROR or UI-DISABLED | ResponseEvent::ReasoningSummary* common.rs:98-108 |
| previous_response_id/store continuity | HARD-ERROR if requested | ResponseCreateWsRequest.previous_response_id/store common.rs:220-239 |
| structured output | UI-DISABLED (unless maps to text.format) | common.rs:140-148,182-187 |
| web-search | UI-DISABLED | web_search_tool_type/supports_search_tool copilot_models_endpoint.rs:278-291 |

## Phase-0 spike (Story 1, GO/NO-GO)
- Slug: `claude-sonnet-4.6` (hard-coded behind an internal flag/allowlist routing only it to chat).
- Exercise 3 flows: (1) streamed typed tool-call w/ partial JSON args, (2) continuation turn, (3) apply_patch/edit.
- Artifact: committed spike transcript/fixture under job dir showing request → chat SSE → codex ResponseEvent mapping for all 3.
- NO-GO: any silent loss of tool calls / reasoning / continuity, or Claude only works as plain text → off-ramp to D-003 (defer or experimental text-only) + land the regression guardrail anyway.

## Build/test
- `cargo check --workspace` from codex-rs (~6 min; rustup/cargo installed) = Phase-5a gate. `cargo test -p <crate>` for touched crates. `cargo test --workspace` = CI only (invariant-check.yml).
- wiremock MockServer pattern (model-provider/src/copilot.rs) for transport tests; core_test_support::responses for e2e.
- `bash scripts/audit_network_calls.sh` + `bash scripts/audit_invariants.sh` must pass.
