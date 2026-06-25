# Stories Outline: Deterministic end-to-end test for the Claude `/chat/completions` transport (US-008)

*Preliminary decomposition from `/plan-with-ralph`. Feed to `/implement-with-ralph --from-plan` for PRD generation.*
*Target: codex SUBMODULE. TEST-ONLY (the single production-manifest edit is a workspace-member entry under Option A). Read `plan.md` for full context, file:line citations, and Open Questions.*

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
  top-level string; absent → omitted). No "gate-off" assertion (process-global gate).
- [ ] Parser-level capture, same-chunk ordering, and `function_call`+usage are cited by exact test
  name + `just test -p <crate>` command: `anthropic_sse.rs:572`,
  `single_read_with_reasoning_and_content_keeps_reasoning_first` (`chat_transport.rs:1096`),
  `codex-copilot/src/chat_completions.rs:271-372`. Add a direct single-buffer test only for a named gap.
- [ ] `just test -p codex-copilot` and `just test -p codex-core` pass; `just fmt` clean.
**Dependencies:** None
**Estimated complexity:** small

## US-002: Capstone foundation — leaf test crate + chat-SSE harness + COPILOT_API_HOME fixture
**Description:** As the impl member, I want a new overlay leaf test crate plus a chat-SSE mock harness
and a hermetic Copilot-auth fixture, so the multi-turn e2e (US-003) can drive the chat transport
against a wiremock server with zero production change and zero upstream conflict surface.
**Acceptance Criteria:**
- [ ] PREFLIGHT recorded: confirm (via `cargo metadata` / trial manifest) that a new overlay leaf
  crate can name `core_test_support` as a dev-dependency (`core/tests/common/Cargo.toml` has no
  `workspace` key; `codex-invariant-tests` does not use it). If not nameable, record the
  path/`workspace` mechanism or escalate the `core/tests/suite/` fallback (Open Question #3).
- [ ] New overlay leaf crate `codex/codex-rs-overlay/codex-copilot-e2e-tests/` exists (`publish = false`,
  `workspace = "../../external/repos/codex-patched/codex-rs"`, own `tests/` dir; modeled on
  `codex-invariant-tests`) with dev-deps `core_test_support`, `codex-copilot`, `codex-core`,
  `codex-model-provider` (gate), `codex-protocol` (`ModelWireRoute`), `wiremock`, `tokio`, `tempfile`,
  `pretty_assertions`, and is registered as a workspace member in
  `codex/external/repos/codex-patched/codex-rs/Cargo.toml` with a `// SANDBOX PATCH:` marker.
- [ ] A chat-SSE mock harness mounts `POST /v1/chat/completions` (NOT `/chat/completions`), exposes
  `ev_chat_*` builders (content delta, `reasoning_text` delta, tool_call, finish_reason, usage,
  `[DONE]`), and records outbound request bodies via a `ChatRequest` with accessors `messages()`, the
  replayed assistant reasoning message, and `reasoning_effort()`.
- [ ] An Option A fixture sets+restores `COPILOT_API_HOME` to a temp dir seeded with a `copilot_token`
  whose `expires_at` is far-future and NO `github_token`, so `CopilotAuth::new()` +
  `CopilotHeaderSource::new()` succeed fully offline (no live token exchange).
- [ ] `cargo check --workspace` passes; no production behavior change.
**Dependencies:** US-001 (ordering preference — land first to de-risk; no hard code dependency)
**Estimated complexity:** medium

## US-003: Capstone — multi-turn wiremock `test_codex` e2e (network-gated; run outside the sandbox)
**Description:** As the operator, I want a deterministic end-to-end test exercising a FULL multi-turn
agentic conversation over the Claude `/chat/completions` transport, proving the
capture→persist→replay loop through the real agent loop.
**Acceptance Criteria:**
- [ ] A `tests/chat_reasoning_e2e.rs` in the leaf crate configures a chat-route Claude model via
  `with_model_info_override(<ModelWireRoute::ChatCompletions>)` and enables the Anthropic gate with the
  correct ordering (enable `Feature::AnthropicModels` in the builder config before `build()`, OR call
  `install_anthropic_gate(true)` AFTER `build()` and before the first turn — NOT before `build()`, which
  `config/mod.rs:2832` would silently reset) + the US-002 Option A fixture + provider `base_url`
  → wiremock, guarded by `skip_if_no_network!()`.
- [ ] Turn 1: the mock returns `reasoning_text` deltas + a `tool_call` + a usage chunk; the test
  asserts the turn-1 outgoing body carries `reasoning_effort`, and the mock reasoning is captured into
  a reasoning item equal to the concatenated deltas.
- [ ] Tool round → Turn 2: the test asserts the turn-2 outgoing body's `messages[]` carries the prior
  reasoning replayed as `{"role":"assistant","content":...}` equal to the captured text, plus typed
  `function_call` assembly (name/args/call_id) and usage (input/output tokens).
- [ ] No `/responses` regression: existing `core/tests/suite` responses tests remain green.
- [ ] The impl member runs the e2e OUTSIDE the codex sandbox (where localhost TCP works) and pastes the
  passing output as evidence (this test is NOT the sole gate for any AC — US-001 carries the gated ACs).
- [ ] `just test -p codex-copilot-e2e-tests` (outside sandbox) passes; `just fmt` clean.
**Dependencies:** US-002 (hard: cannot compile without the crate + harness + fixture); US-001 (ordering)
**Estimated complexity:** medium

---

### Open Questions carried to implementation (see plan.md)
1. Aggregate-cap semantics: code has only a per-item 8000-byte cap; the "aggregate" is a token-based
   history/compaction cap (different subsystem). Operator confirms scope.
2. Overlap with `codex-rebase-debt-fix-client-copilot-fixture` (the removed Copilot-client fixture).
3. Leaf-crate vs `core/tests/suite/` home — gated on the US-002 `core_test_support`-reachability preflight.
4. Exact Claude chat-route model slug + `with_model_info_override` mechanism + whether a models
   fixture/stub is needed alongside `install_anthropic_gate(true)`.
