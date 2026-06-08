# Stories Outline: Claude models via Copilot `/chat/completions` transport (D-001)

*Preliminary decomposition from `/plan-with-ralph`. Feed to `/implement-with-ralph --from-plan` for PRD generation.*
*Spike-gated: US-001 is the Phase-0 GO/NO-GO gate; no build story (US-002+) starts until US-001 returns GO.*
*Repo rule: use `just test -p <crate>` (NOT `cargo test`); `cargo check --workspace` is the typecheck gate; run `just bazel-lock-update` + `just bazel-lock-check` after any Cargo dep change.*

## US-001: Phase-0 GO/NO-GO feasibility spike (THE GATE)
**Description:** As a maintainer, I want a throwaway spike that proves the hard part of the chat transport against a **live** Copilot call before committing the L build, so we never ship a silently-lossy Claude feature.
**Acceptance Criteria:**
- [ ] A throwaway branch hard-codes ONE Claude slug (`claude-sonnet-4.6`) routed to `/chat/completions` behind an internal flag/allowlist (no production wiring; not merged into the build).
- [ ] A committed artifact under `<job_dir>/` records, for a **live** Copilot `/chat/completions` call, the request body, the raw chat SSE, and the codex event sequence produced, for these flows: (1) a streamed **typed** tool-call with partial JSON arguments, (2) **two interleaved (parallel) tool calls** that must not collapse/reorder, (3) a continuation turn consuming the tool result, (4) **usage** accounting captured, (5) an apply_patch/edit.
- [ ] The artifact states an explicit **GO** or **NO-GO** verdict against the must-pass list; on NO-GO it names the failing flow and triggers the D-003 off-ramp (defer or experimental text-only), and the regression guardrail (US-003) is still landed. Any flow the spike cannot prove (e.g. parallel, usage) is pre-declared **unsupported/gated** rather than assumed working.
- [ ] `cargo check -p <touched crates>` passes on the spike branch (full-workspace pass not required for a spike).
**Dependencies:** None
**Estimated complexity:** medium

## US-002: `WireApi::ChatCompletions` variant + upstream seam scaffolding
**Description:** As the dispatch layer, I want a `ChatCompletions` wire-api variant so a model can be routed to the chat transport.
**Acceptance Criteria:**
- [ ] `WireApi` (`model-provider-info/src/lib.rs:52-82`) gains a `ChatCompletions` variant; the `Display` impl and the custom `Deserialize` are updated and stay **exhaustive** (no wildcard arm); a new serde wire value is chosen that does NOT re-enable the rejected `"chat"`.
- [ ] A focused test asserts serde round-trip for the new variant and that `"chat"` still hard-errors with `CHAT_WIRE_API_REMOVED_ERROR`; run via `just test -p codex-model-provider-info`.
- [ ] Each edited line carries `// SANDBOX PATCH:`; a `patch-surface.md` §14 row + §15 rebase note are added.
- [ ] `cargo check -p codex-model-provider-info` passes.
**Dependencies:** US-001 (GO)
**Estimated complexity:** small

## US-003: `/models` filter relaxation + protocol-local wire-route hint + cache + hidden-until-transport guardrail
**Description:** As a user, I want Claude rows to appear in the picker tagged to the chat wire — but only once a working transport exists — while a chat-only model with no transport stays hidden during partial rollout.
**Acceptance Criteria:**
- [ ] `is_chat_responses_picker_entry` (`copilot_models_endpoint.rs:199-215`) is relaxed so a row advertising `/chat/completions` (and not `/responses`) can be surfaced AND tagged to the chat wire; a GPT `/responses` row is unaffected.
- [ ] A `#[serde(default)]` **protocol-local** wire-route field (e.g. `ModelWireRoute::{ProviderDefault, ChatCompletions}`, NOT `Option<WireApi>` — that would cycle) is added to `ModelInfo` (`protocol/src/openai_models.rs:262`) and set in `synthesize_from_capabilities` + the `translate_entry` bundled-clone path; `models-manager/src/model_info.rs:65-102` constructor compiles.
- [ ] GUARDRAIL test: a chat-only Claude row stays HIDDEN from the picker until BOTH the route hint is present AND the chat transport is available (a "chat transport available" guard, flipped in US-005) — not merely "hint absent"; run via `just test -p codex-model-provider`.
- [ ] CACHE test: a `ModelInfo` with the route hint serialized to and re-read from `models_cache.json` preserves it (restart/reload), and a pre-hint cache entry (missing the field) deserializes via serde-default to `ProviderDefault`; a `client_version` bump (or documented rationale for not bumping) forces a one-time refresh. Run via `just test` in the cache-owning crate.
- [ ] `// SANDBOX PATCH:` markers + §14 rows + §15 notes for the filter relaxation and the `ModelInfo` field.
- [ ] `cargo check --workspace` passes.
**Dependencies:** US-002
**Estimated complexity:** large

## US-004: Overlay chat transport — request builder + neutral SSE translator
**Description:** As the transport, I want to build a chat-completions request from codex turn data and translate the chat SSE into a neutral event stream (no `codex-api` dependency — that would cycle).
**Acceptance Criteria:**
- [ ] `codex-rs-overlay/codex-copilot/src/payload.rs` gains a public, serializable chat request body type + a builder mapping the public turn data (input items, tools, tool_choice, parallel_tool_calls, system/developer messages, `image_url` data-URI vision parts) into the chat-completions JSON. The builder **hard-errors** if an unsupported request feature is present (e.g. `previous_response_id`/`store`), so no silent path exists.
- [ ] `codex-rs-overlay/codex-copilot/src/chat_completions.rs` POSTs to `api.githubcopilot.com/chat/completions` reusing `CopilotHeaderSource`/`auth.rs` (Authorization + ChatGPT-Account-ID `set_sensitive(true)` preserved), parses the chat SSE, and yields a **neutral, overlay-local event** representation (content delta; tool-call id+name+partial-args delta; finish reason; usage) — it does **NOT** reference `codex_api::ResponseEvent`.
- [ ] wiremock unit tests cover: (a) a single streamed typed tool-call assembles valid JSON args, (b) two parallel tool calls don't collapse/reorder, (c) usage is surfaced, (d) a content-only turn maps to content deltas + a finish event, (e) the builder hard-errors on an unsupported request feature. Run via `just test -p codex-copilot`.
- [ ] `pub mod` registered in `lib.rs`; no outbound host/path beyond `api.githubcopilot.com/chat/completions`; if any Cargo dep is added, run `just bazel-lock-update` + `just bazel-lock-check`.
- [ ] `cargo check -p codex-copilot` passes.
**Dependencies:** US-002
**Estimated complexity:** large

## US-005: Core dispatch wiring — `chat_transport.rs` + one `client.rs` arm + neutral→ResponseEvent map + routing test
**Description:** As the dispatcher, I want one new arm that routes chat-hinted models through the overlay transport while GPT keeps using `/responses`.
**Acceptance Criteria:**
- [ ] A new module `core/src/chat_transport.rs` exposes `stream_chat_completions` that converts the core-private `Prompt` into the overlay's public chat body, drives the overlay POST + parse, **maps the overlay neutral events → `codex_api::ResponseEvent`** (per-`call_id` partial-JSON tool-arg assembly lives here), and wraps the result into the core `ResponseStream` (owns the mpsc channel/spawn + `consumer_dropped` cancellation, mirroring `stream_responses_api`). `codex-copilot` is added to `core/Cargo.toml` (acyclic; run `just bazel-lock-update`/`-check`).
- [ ] The ONLY edit to `core/src/client.rs` is one new arm `WireApi::ChatCompletions => self.stream_chat_completions(...).await` (`// SANDBOX PATCH:`), deriving the effective wire by mapping `model_info`'s protocol-local route hint → `WireApi` (fallback `provider.wire_api`).
- [ ] The "chat transport available" guard (from US-003) is flipped on here so Claude rows become visible only now.
- [ ] ROUTING regression test: dispatch selects `ChatCompletions` for a chat-hinted `ModelInfo` and `Responses` for a `/responses` row; a Claude row never reaches `stream_responses_api` and a GPT row never reaches `stream_chat_completions`; run via `just test -p codex-core`.
- [ ] §14 row + §15 note for the dispatch arm + the new module/dep; `chat_transport.rs` kept under ~500 LoC (split if larger); additions to `codex-core` minimized and justified (needs `Prompt` internals).
- [ ] `cargo check --workspace` passes.
**Dependencies:** US-002, US-003, US-004
**Estimated complexity:** large

## US-006: v1 feature-contract enforcement (visible, never silent)
**Description:** As a user, I want any Responses feature that chat can't faithfully serve for Claude to fail visibly, not silently degrade.
**Acceptance Criteria:**
- [ ] The contract table from the plan is enforced at the correct sites: request-build hard-errors (`previous_response_id`/`store`) live in US-004's builder; reasoning is not requested (`supports_reasoning_summaries=false`) AND the SSE translator never emits model "thinking" as an assistant content delta; structured output + web-search are UI-disabled via capability flags; apply_patch + parallel + vision are enabled only where the spike/tests prove round-trip.
- [ ] A test per gated feature asserts a hard error OR a capability flag marking it unavailable, AND asserts NO silent fallthrough (specifically: reasoning content never appears as an assistant `OutputTextDelta`); run via `just test -p codex-core` / `just test -p codex-model-provider`.
- [ ] The contract table is documented (plan + patch-surface) and matches the synthesized `ModelInfo` capability flags.
**Dependencies:** US-005 (request-build hard-errors land already in US-004; this story completes picker UI-disable + the full matrix)
**Estimated complexity:** medium

## US-007: Network audit + invariant registration + redaction coverage
**Description:** As a maintainer, I want the new path to pass the audits and register its invariants so rebases can't silently regress it.
**Acceptance Criteria:**
- [ ] `bash scripts/audit_network_calls.sh` passes with the new overlay path recognized (codex-copilot already overlay-known; register `chat_completions.rs` if the marker scan needs it); no new host/path beyond `api.githubcopilot.com/chat/completions`.
- [ ] `bash scripts/audit_invariants.sh` passes; new §14 invariant rows (WireApi variant, dispatch arm + core module/dep, filter relaxation, `ModelInfo` route field, hidden-until-transport guardrail, `set_sensitive` on the new builder) each map to an enforcing test or grep guard with a deliberate-violation procedure.
- [ ] A redaction test asserts the new chat request builder marks Authorization + ChatGPT-Account-ID `set_sensitive(true)` (a `Debug`/`{:?}` on the request never leaks the secret).
**Dependencies:** US-002, US-003, US-004, US-005, US-006
**Estimated complexity:** medium

## US-008: End-to-end agentic validation + GPT-5.x regression
**Description:** As a user, I want a Claude model to complete a real agentic turn while GPT keeps working unchanged.
**Acceptance Criteria:**
- [ ] A **deterministic** integration test (à la `core_test_support::responses`, mocking the chat SSE) drives a Claude model through an agentic turn with ≥1 tool-call executed as a typed `function_call`; a live Copilot transcript may supplement but is NOT a substitute for the deterministic test.
- [ ] GPT-5.x regression: a GPT model still completes a turn via the unchanged `/responses` transport (existing tests green).
- [ ] `cargo check --workspace` green; `just test -p <touched crate>` green for touched crates; both audit scripts pass; `just bazel-lock-check` clean if deps changed.
**Dependencies:** US-001, US-002, US-003, US-004, US-005, US-006, US-007
**Estimated complexity:** medium
