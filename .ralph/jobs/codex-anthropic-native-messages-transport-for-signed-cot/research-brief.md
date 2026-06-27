# Research Brief — Native Anthropic Messages (`/v1/messages`) signed-CoT transport

Task: `codex-anthropic-native-messages-transport-for-signed-cot`. Brainstorm direction **D-001**
(probe-gated signed fast-follow). Unsigned `reasoning_text` path is SHIPPED on `origin/main`
(sibling `codex-anthropic-chat-reasoning-text-capture-and-replay`), which **moots** the previously
feared parallel-edit conflict. Codex submodule @ main `f779aec7`. Two Opus Explore agents
(researcher, architect) plus direct source reads agree on the seams below; codex-exec research
timed out (0B) and copilot-exec was blocked from reading codex source (sandbox access policy) so it
only corroborated the high-level approach.

## Consolidated File List

### Files to MODIFY (upstream-canonical — minimize; each needs `// SANDBOX PATCH:` marker + §14 invariant row + §15 replant note)
- `model-provider-info/src/lib.rs:56-100` — add 3rd `WireApi::AnthropicMessages` variant + `Display` (`:71-80`) + custom `Deserialize` (`:82-100`, incl. the `&["responses","chatcompletions"]` unknown-variant list). Exhaustive match.
- `protocol/src/openai_models.rs:413-419` — add 3rd `ModelWireRoute::AnthropicMessages` variant. `#[serde(default)]` on `ModelInfo.wire_route` keeps old caches deserializing to `ProviderDefault`.
- `model-provider/src/copilot_models_endpoint.rs` — add `const COPILOT_MESSAGES_ENDPOINT = "/v1/messages"` (near `:55-57`); new branch in `wire_route_for` (`:282-296`) preferring Messages when the signed sub-flag is on AND the row advertises `/v1/messages`; also teach the surfacing filter `is_chat_responses_picker_entry` (`:256-277`). Today `/v1/messages` appears ONLY as test-fixture strings (`:547/614/666/712`); no const, no routing.
- `core/src/chat_transport.rs:64-77` — add `AnthropicMessages` arm to `effective_wire_api_gated` **with graceful degrade to `WireApi::ChatCompletions`** when the sub-flag is off (NOT a panic — this is the NO-GO safety net). Also (`:168-198`) populate `encrypted_content: Some(signature)` in `ReasoningMessageItem::open/finish` for the Messages path. Add a `stream_anthropic_messages` driver (mirror `stream_chat_completions`).
- `core/src/chat_transport/anthropic_sse.rs:179-181` — **stop discarding the signature**: replace the `_ => {}` arm in `content_block_delta` with `Some("thinking_delta")` (accumulate reasoning text) and `Some("signature_delta")` (capture the `signature`) handling. Extend/replace `TranslatedSseEvent` (`:36-44`, currently `Chat`/`ReasoningDelta(String)`/`StreamError`) to carry the signature.
- `core/src/client.rs:1634` — add the 3rd `WireApi::AnthropicMessages => …` dispatch arm (exhaustive match; mirrors the `ChatCompletions` arm at `:1675-1708`: `current_client_setup` → `build_responses_request` → serialize → overlay Messages builder → `stream_anthropic_messages`). The one unavoidable upstream dispatch edit.
- `features/src/lib.rs` — add `Feature::AnthropicSignedMessages` (enum `:148`, FeatureSpec `:1041-1050` mirroring `AnthropicModels`, `default_enabled:false`) if a stricter sub-flag is chosen (RECOMMENDED — see Design Decisions).
- `model-provider/src/anthropic_gate.rs` (or sibling) — a resolver for the new sub-flag (mirror `anthropic_models_resolved()` `:43-45` / `install_anthropic_gate`).
- `codex/docs/implementation/patch-surface.md` — §14 invariant rows starting at **54** (next free; current max = 53). §15 replant note. Existing D-001 invariants this extends: 32 (WireApi variant), 33 (ModelWireRoute), 34 (`/models` filter gate), 35 (`effective_wire_api_gated`), 36 (overlay builder hard-error), 37 (SSE per-call assembly), **38 (host/path allowlist = `api.githubcopilot.com/chat/completions` ONLY — signed ADDS `/v1/messages`)**, 39 (D-002 opt-in default-off), 52 (reasoning capture), 53 (reasoning replay).

### Files to CREATE (overlay-first — zero upstream conflict surface)
- `codex/codex-rs-overlay/codex-copilot/src/<anthropic_messages>.rs` — the BULK: Anthropic Messages REQUEST builder (analog of `build_chat_request_body` at `payload.rs:232-274`), `push_anthropic_message` (analog of `push_chat_message` at `payload.rs:277-344`). Emits Anthropic `messages[]` with `thinking`(+`signature`)→`tool_use` in one assistant message and `tool_result` in the next user message. Reuses the byte-cap logic from `capped_reasoning_plaintext` (`payload.rs:346-386`, `MAX_REPLAYED_REASONING_BYTES = 8000`), counting signature bytes against the per-item budget.
- New tests: parser signature-capture, request-builder ordering, signed round-trip integration (`core/suite` `test_codex`), routing/gate tests, network-audit guard for `/v1/messages` egress.

### REFERENCE-ONLY
- `protocol/src/models.rs:927-940` — `ResponseItem::Reasoning { id, summary, content: Option<Vec<ReasoningItemContent>>, encrypted_content: Option<String> (:936 = THE SIGNATURE-READY SLOT), metadata }`.
- `core/src/chat_transport.rs:148-150` — doc explicitly reserves `encrypted_content` for "the future signed fast-follow … without reworking this lifecycle".
- `codex-rs-overlay/codex-copilot/src/payload.rs:832-847` — shipped test `build_chat_body_replays_signed_reasoning_plaintext_without_mutating_item` proving a populated `encrypted_content:"opaque-sig"` survives round-trip untouched (forward-compat already proven).
- `codex-rs-overlay/codex-copilot/src/{chat_completions.rs,header_source.rs,auth.rs}` — neutral `ChatStreamEvent`/`ChatSseParser` + `CopilotHeaderSource`/`CopilotAuth` (reuse for `/v1/messages` auth/billing; same `api.githubcopilot.com` host + token cache).
- `core/src/chat_transport/anthropic_sse.rs:101-105` — the parser is DUAL-shape: `decode_line` routes type-keyed Anthropic events → `decode_anthropic_event` (`:108-218`: message_start, content_block_start tool_use, content_block_delta text/json/**thinking/signature-dropped**, message_delta) vs `choices` → `decode_openai_structured_content` (`:242-315`, the live unsigned `/chat/completions` path). The Anthropic Messages envelope is **already mostly parsed** — only thinking/signature content is dropped.
- `codex/external/repos/codex-patched/justfile` — build/test recipes.

## The signed round-trip data flow
- **Outbound (overlay builder):** Anthropic contract requires the signed `thinking` block in the SAME assistant message immediately before its `tool_use`; the `tool_result` follows in the next user message: `assistant:[{type:"thinking",thinking,signature},{type:"tool_use",id,name,input}]` then `user:[{type:"tool_result",tool_use_id,content}]`. The builder walks the persisted `ResponseItem` stream; when it hits a `reasoning` item with populated `encrypted_content`, it emits a `thinking` block (text from `content[].reasoning_text`, signature from `encrypted_content`) bound to the following `function_call`.
- **Inbound (parser→persist):** `content_block_delta` `thinking_delta`→accumulate, `signature_delta`→capture; on the thinking block's `content_block_stop` finalize the signature; `ReasoningMessageItem::finish()` writes `encrypted_content: Some(signature)`. Lifecycle (OutputItemAdded(Reasoning) before deltas; OutputItemDone before message/function-call opens) is UNCHANGED from the unsigned path.
- **Replay:** `push_anthropic_message` reads `encrypted_content`: `Some(sig)`→signed `thinking` block bound to next tool_use; `None`→plaintext fallback/omit. Contrast unsigned chat path which emits a standalone, order-free plaintext assistant message.

## Dependency graph (from architect)
`(0) confirmation re-probe` GATES everything. On GO: `routing skeleton (seams)` compiles independently and is inert via degrade-to-chat. `(A) Messages request builder` (overlay) and `(B) Messages-SSE parse+persist` (core) depend only on the frozen `encrypted_content` slot — independently buildable/testable. `signed replay round-trip` requires all of A+B+routing.

## Design Decisions to resolve in PLAN
1. **Parser placement (the one agent divergence).** researcher + direct reads → EXTEND the existing core `anthropic_sse.rs` (it ALREADY parses the Messages envelope; only thinking/signature dropped; it's a fork-exclusive D-001 file so extending adds ~0 new upstream conflict; already plumbed into the chat run path). architect → new overlay `messages_sse.rs` (pure overlay, but DUPLICATES the message_start/content_block_delta/message_delta parsing). **RECOMMENDATION: extend the existing core parser** — less code, no duplication, conflict-surface cost is minimal because it's already fork-owned. Note both options in the plan.
2. **Sub-flag vs reuse `anthropic_models`.** RECOMMEND a stricter `Feature::AnthropicSignedMessages` (default off) ANDed with `AnthropicModels`, so signed ships dark and `anthropic_models` stays the unsigned/chat default until the proxy + a soak window validate replay acceptance. Matches the fork's experimental-features convention.
3. **NO-GO safety net.** `effective_wire_api_gated` Messages arm DEGRADES to `ChatCompletions` when the sub-flag is off — never a hard fail; the model always runs.

## Constraints / risks
- Proxy risk (decisive gate): Copilot may strip/rewrite/reject Anthropic signatures → front-load a confirmation re-probe; on NO-GO halt (D-003), no transport code lands.
- Tool-loop ordering: signed `thinking` must precede each `tool_use`/`tool_result`; mis-order → proxy 400/signature-validation failure (strictly worse than order-free unsigned).
- Bounded model-visible context: no item >10K tokens; count signature bytes against the per-item budget (unsigned cap `MAX_REPLAYED_REASONING_BYTES=8000`).
- Permanent 3rd transport: every exhaustive `match wire_api` site gains an arm forever; +2 seams to replant each rebase.
- Nested 2-repo change: Rust code in the INNER submodule (`codex/external/repos/codex-patched/`) + ledger `codex/docs/implementation/patch-surface.md` in the codex WRAPPER → two-commit (inner first, then wrapper pointer) and possibly a direct impl (the single-repo `/implement-with-ralph` model can't express nested 2-repo — flag for the lead).
- Build/test: `cargo metadata --no-deps` preflight → `cargo check --workspace` (~6 min) → `just test -p codex-core`/`-p codex-copilot`/`-p codex-model-provider(-info)`; `cargo build --release` + `cargo test --workspace` are CI-only. `--all-targets` typecheck where feasible.
