# Stories Outline: Deterministic end-to-end test for the Claude `/chat/completions` transport (US-008)

*Preliminary decomposition from `/plan-with-ralph` (refreshed 2026-06-27 for the now-shipped signed `/v1/messages` transport).*
*Target: codex SUBMODULE. TEST-ONLY (no production behavior change). Read `plan.md` for full context, file:line citations (verified vs inner HEAD `16175abdc0`), the dual-gate routing model, and Open Questions.*

## US-001: No-network deterministic assertions (the gated acceptance criteria)
**Description:** As the operator, I want the central CoT capture/replay behaviors asserted by
deterministic tests that run WITHOUT network (so they actually gate in-sandbox and in blocked CI),
by STRENGTHENING the existing inline `#[cfg(test)]` tests rather than adding duplicates.
**Acceptance Criteria:**
- [ ] `build_chat_body_caps_oversized_replayed_reasoning` (`codex-copilot/src/payload.rs:856`) is
  strengthened: a >8000-byte reasoning trace replays as exactly the tail within
  `MAX_REPLAYED_REASONING_BYTES` (8000) bytes, sliced on a UTF-8 char boundary, prefixed by
  `[earlier reasoning truncated]\n` (assert the exact boundary, not just bounds).
- [ ] A non-truncating reasoning item replays verbatim as `{"role":"assistant","content":<text>}` in
  `build_chat_request_body` output (strengthen `payload.rs:767` / `:800`).
- [ ] Present/absent `reasoning_effort` asserted via existing `payload.rs:729` / `:744` (present →
  top-level string; absent → omitted).
- [ ] Parser-level capture, same-chunk ordering, and typed `function_call`+usage are cited by exact
  test name + `just test -p <crate>` command:
  `reasoning_text_chunks_surface_one_reasoning_delta_each` (`anthropic_sse.rs:692`),
  `single_read_with_reasoning_and_content_keeps_reasoning_first` (`chat_transport.rs:1174`),
  `single_typed_tool_call_assembles_valid_json_args` (`chat_completions.rs:274`),
  `usage_is_surfaced_from_trailing_chunk` (`chat_completions.rs:364`). Add a direct single-buffer test
  only for a named gap.
- [ ] `just test -p codex-copilot` and `just test -p codex-core` pass; `just fmt` clean.
**Dependencies:** None
**Estimated complexity:** small

## US-002: Capstone foundation — chat-SSE harness + COPILOT_API_HOME fixture
**Description:** As the impl member, I want a reusable chat-SSE mock harness and a hermetic
Copilot-auth fixture in `core/tests/common/`, so the multi-turn e2e (US-003) can drive the chat
transport against a wiremock server with zero production change.
**Acceptance Criteria:**
- [ ] A chat-SSE mock harness `core/tests/common/chat_sse.rs` mounts `POST /v1/chat/completions` (NOT
  `/chat/completions` — `test_codex.rs:369` sets `base_url = {server}/v1`), exposes `ev_chat_*` builders
  (content delta, `reasoning_text` delta, tool_call, finish_reason, usage, `[DONE]`), and records
  outbound request bodies via a `ChatRequest` with accessors `messages()`, the replayed assistant
  reasoning message, `reasoning_effort()`, and a `path()`/url accessor. NOTE: the routing-proof
  assertion must be SERVER-level (`server.received_requests()`), not a chat-mock `path()` (tautological).
- [ ] Registered via `pub mod chat_sse;` in `core/tests/common/lib.rs`. No new manifest dep expected:
  `core_test_support` already depends on `wiremock`/`tokio`/`tempfile`/`serde_json`/`codex-core`/
  `codex-protocol`/`codex-model-provider-info`/`codex-features`. Add `codex-copilot` ONLY if the
  fixture reuses its token-cache types (prefer writing the cache JSON directly). All edits `// SANDBOX PATCH:`.
- [ ] An Option A fixture sets+restores `COPILOT_API_HOME` to a temp dir seeded with a `copilot_token`
  containing ALL three `CachedCopilotToken` fields (`token`, far-future `expires_at`, `refresh_in` — no
  serde defaults) and NO `github_token`, so `CopilotAuth::new()` + `CopilotHeaderSource::new()` succeed
  fully offline (no live token exchange).
- [ ] `cargo check --workspace` passes; no production behavior change.
- [ ] (Alternative-home only) If the overlay leaf crate is chosen instead of `core/tests/suite/`,
  PREFLIGHT recorded: `core_test_support` is confirmed nameable as a dev-dep (or the home is recorded
  with rationale). The recommended `core/tests/` home has NO preflight.
**Dependencies:** US-001 (ordering preference — land first to de-risk; no hard code dependency)
**Estimated complexity:** medium

## US-003: Capstone — multi-turn wiremock `test_codex` e2e (network-gated; run outside the sandbox)
**Description:** As the operator, I want a deterministic end-to-end test exercising a FULL multi-turn
agentic conversation over the Claude `/chat/completions` transport, proving the
capture→persist→replay loop AND that routing lands on `/chat/completions` (not the new `/v1/messages`).
**Acceptance Criteria:**
- [ ] `core/tests/suite/chat_completions.rs` (registered `mod chat_completions;` in
  `core/tests/suite/mod.rs`, alphabetically before `mod cli_stream;` `:42`) configures the chat route by
  overriding an EXISTING bundled GPT slug (the bundled catalog is GPT-only; a `claude-*` slug panics
  `with_model_info_override`):
  `with_model_info_override("gpt-5.2", |mi| { mi.wire_route = ModelWireRoute::ChatCompletions; mi.supports_reasoning_summaries = false; mi.default_reasoning_level = Some(<level>); })`
  (two-arg `(model: &str, FnOnce(&mut ModelInfo))` form; `supports_reasoning_summaries=false` mimics a
  synthesized Claude chat row so the explicit `reasoning_effort` threading path fires) and enables the
  **parent Anthropic gate ON with the signed sub-gate OFF**, with the correct ordering (enable
  `Feature::AnthropicModels` and leave `Feature::AnthropicSignedMessages` OFF in the builder config
  before `build()`, OR call `install_anthropic_gate(true)` + `install_anthropic_signed_messages_gate(false)`
  AFTER `build()` and before the first turn — NOT before `build()`, which `config/mod.rs:2832` would
  silently reset) + the US-002 Option A fixture + provider `base_url` → wiremock, guarded by
  `skip_if_no_network!()` and run via nextest/`just test` (process-per-test isolates the global gate).
- [ ] Turn 1: the mock returns `reasoning_text` deltas + a `tool_call` + a usage chunk; the test
  asserts the turn-1 outgoing body carries `reasoning_effort`, and the mock reasoning is captured into
  a reasoning item equal to the concatenated deltas.
- [ ] Tool round → Turn 2: the test asserts the turn-2 outgoing body's `messages[]` carries the prior
  reasoning replayed as `{"role":"assistant","content":...}` equal to the captured text, plus typed
  `function_call` assembly (name/args/call_id) and usage (input/output tokens).
- [ ] Routing proof (SERVER-level): `server.received_requests()` shows NO `/v1/messages` path and ≥1
  `/v1/chat/completions` (or a `/v1/messages` recorder stub got ZERO hits). A chat-mock `path()`
  accessor alone is tautological (a misroute 404s and is never captured).
- [ ] No `/responses` regression: existing `core/tests/suite` responses tests remain green.
- [ ] The impl member runs the e2e OUTSIDE the codex sandbox (where localhost TCP works) and pastes the
  passing output as evidence (this test is NOT the sole gate for any AC — US-001 carries the gated ACs).
- [ ] `just test -p codex-core chat_completions` (outside sandbox) passes; `just fmt` clean.
**Dependencies:** US-002 (hard: cannot compile without the harness + fixture); US-001 (ordering)
**Estimated complexity:** medium

---

### Open Questions carried to implementation (see plan.md)
1. Aggregate-cap semantics: code has only a per-item 8000-byte cap; the "aggregate" is a token-based
   history/compaction cap (different subsystem). Operator confirms scope.
2. Test home: `core/tests/suite/chat_completions.rs` (recommended — patch-surface invariant-37 home, no
   cycle, no preflight) vs the overlay leaf crate (alternative — Cargo.toml member edit + preflight).
3. Overlap with `codex-rebase-debt-fix-client-copilot-fixture` (the removed Copilot-client fixture).
4. Model override: do NOT pass a `claude-*` slug (bundled catalog is GPT-only → panic). Override an
   existing bundled slug (`gpt-5.2`) with `wire_route=ChatCompletions` + `supports_reasoning_summaries=false`;
   only the exact `default_reasoning_level` to assert remains open. No models fixture/stub needed.
