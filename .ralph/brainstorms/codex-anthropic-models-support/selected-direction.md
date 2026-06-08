---
overviewTaskId: codex-anthropic-models-support
---

## Direction
D-001 — Overlay `/chat/completions` transport with per-model routing
(spike-gated, contract-scoped). Build a fork-local chat-completions transport in
`codex-rs-overlay/codex-copilot/` that translates codex's internal
Responses request/response/SSE to/from Copilot's `/chat/completions` wire,
routed per-model via a minimal upstream seam, so Claude models become selectable
and runnable through the existing Copilot provider — gated by a Phase-0
feasibility spike and bounded by an explicit, test-enforced v1 feature contract.

## Goal
A codexu user can pick a Claude model (e.g. `claude-sonnet-4.6`,
`claude-opus-4.8`) in the codex model picker and run an agentic turn against it
through the existing Copilot provider — egress stays `api.githubcopilot.com`
only, no new credentials — with tool-calling working and any unsupported
Responses-only feature surfaced visibly (UI-disabled or hard error), never
silently degraded. GPT-5.x continues to flow through the unchanged
`/responses` transport.

## Scope
### In Scope
- A Phase-0 feasibility spike (the GO gate): hard-code ONE Claude slug behind an
  internal flag and prove a live Copilot `/chat/completions` request can produce
  the internal `ResponseEvent`/output-item sequence codex expects for: a
  streamed **typed tool-call with JSON arguments**, a **continuation turn**, and
  an **apply_patch/edit** flow. The spike result is committed and decides
  GO (D-001 proceeds) vs OFF-RAMP (D-003: defer or experimental text-only).
- A new overlay transport (`codex-rs-overlay/codex-copilot/src/chat_completions.rs`
  + request/payload translation in `payload.rs`): build the chat-completions
  request body from codex's `Prompt`/tools; POST to
  `api.githubcopilot.com/chat/completions` reusing the existing
  `CopilotHeaderSource` auth/header path; parse the chat-completions SSE stream
  and translate deltas into codex's `ResponseEvent`/`ResponseStream` (content,
  tool_calls, finish_reason, usage). Built/vendored from scratch — no residual
  chat code exists in codex-rs.
- A minimal upstream-canonical dispatch seam: a new `WireApi::ChatCompletions`
  variant (`model-provider-info/src/lib.rs:55-82`) + one new match arm at the
  `core/src/client.rs:1582-1621` dispatch, each `// SANDBOX PATCH:`-marked with a
  patch-surface.md §14 row + §15 rebase note.
- A per-model routing decision (one of: a `ModelInfo` per-model wire hint, a
  `supported_endpoints` lookup inside `stream()`, or a second `copilot-chat`
  provider — chosen during planning) and the corresponding `/models` filter
  relaxation so `/chat/completions` Claude entries are surfaced and tagged to the
  chat wire api (`copilot_models_endpoint.rs:199-292`).
- An explicit v1 feature contract: enumerate which Responses features are
  supported for Claude vs UI-disabled/hard-error (reasoning summaries,
  `previous_response_id`/`store` continuity, structured output, apply_patch,
  web-search, vision), enforced by tests.
- Model-id handling for Copilot-only slugs (`-1m`, `-high`, `-xhigh`,
  `-internal`) via `synthesize_from_capabilities`; preserve exact Copilot slugs
  in UI+wire (normalize only after a live POST proves an alias).
- Tests: a guardrail regression test that Claude rows lacking `/responses` stay
  hidden unless the chat-transport hint is present; network-audit + redaction
  coverage for the new path/builder.

### Out of Scope
- Anthropic-native `/v1/messages` transport (D-002) — deferred phase-2 fidelity
  upgrade; the reference proxy translates `/v1/messages`→OpenAI-chat anyway, so
  no proven fidelity gain at higher cost.
- Any new network egress or credential surface beyond `api.githubcopilot.com`.
- Full Responses-feature parity for Claude where Copilot's chat route cannot
  faithfully round-trip it; such features are explicitly gated, not bridged.
- Adding chat-completions support to non-Copilot providers.

## Criteria
- Phase-0 spike artifact is committed and shows, against a live Copilot
  `/chat/completions` call for one Claude slug, either: (a) the expected codex
  output-item sequence for a streamed typed tool-call + a continuation turn +
  apply_patch (→ GO), or (b) a documented failure that triggers the D-003
  off-ramp.
- A Claude model selected in the picker completes an agentic turn end-to-end via
  the new transport, with at least one tool-call executed correctly (typed
  function_call item, not assistant text).
- GPT-5.x models still route through the unchanged `/responses` transport (no
  regression); a Claude row never routes to `/responses` and a GPT `/responses`
  row never routes to chat (cache-keying verified across restart/reload).
- `cargo check --workspace` passes from
  `codex/external/repos/codex-patched/codex-rs`; the upstream-canonical edits are
  limited to the WireApi variant + the one client.rs match arm + the filter
  relaxation, each `// SANDBOX PATCH:`-marked with patch-surface.md §14/§15 rows.
- `scripts/audit_network_calls.sh` passes with the new overlay registered
  appropriately (EXCLUDED_FILES / path-level assertion); the new request builder
  preserves `Authorization`/`ChatGPT-Account-ID` `set_sensitive(true)`.
- Any v1-unsupported Responses feature for Claude is visibly UI-disabled or a
  hard error (covered by a test), never a silent degradation.

## Context
**Endpoint verdict is SOURCE-SETTLED.** Live `GET api.githubcopilot.com/models`
(via codex's own Copilot token, 2026-06-08): every Claude model advertises
`supported_endpoints = /chat/completions + /v1/messages` only; NONE advertises
`/responses`. Only OpenAI/Azure GPT-5.x is `/responses`-capable. codex is
Responses-API-only (`WireApi` enum has only `Responses`, `chat` deleted —
`model-provider-info/src/lib.rs:48,55-82`; copilot provider hardcodes Responses
`:477-498`; single-arm dispatch `core/src/client.rs:1582-1621`; filter requires
`/responses` `copilot_models_endpoint.rs:199-215`). So filter/metadata-only is
impossible, and there is **no residual chat-completions code** in codex-rs to
reuse — the overlay translator is from scratch (the dominant edit-budget driver:
L).

**Reference prior art** (ericc-ch/copilot-api): forwards OpenAI-shaped payloads
straight to Copilot `/chat/completions`; its Anthropic `/v1/messages` surface is
a translation layer onto chat-completions (source-verified by the copilot lens),
confirming `/chat/completions` as the lowest-friction Claude path. Notable
translation gotchas: model alias normalization, thinking blocks, `image_url`
data-URI vision parts, tool_use/tool_result mapping, finish_reason, and usage.
Coincidentally, codex's Copilot auth dir (`~/.local/share/copilot-api/`) mirrors
that proxy's storage convention.

**Disconfirming observation to carry forward (DA, red_flag=true):** the failure
mode is *silent lossy success* — Claude appearing to work while dropping
Responses semantics codex relies on for tool orchestration, reasoning state,
usage accounting, and `previous_response_id`/`store` continuity. A single
plain-text Claude response is NOT evidence the feature works; the Phase-0 spike
must exercise tool-heavy + continuation turns. This is why D-001 is spike-gated
and contract-scoped rather than a straight build.

**Open questions for the plan** (carried from synthesis): per-model routing
mechanism (ModelInfo hint vs stream()-time `supported_endpoints` lookup vs a
second `copilot-chat` provider); the exact v1 feature contract; alias
normalization policy; models_cache keying/invalidation; and the explicit no-go
threshold.
