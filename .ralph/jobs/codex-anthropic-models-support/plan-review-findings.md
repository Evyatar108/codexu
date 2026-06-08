# Plan Review — Phase 4 convergence (codex-anthropic-models-support)

Three independent reviewers ran against the draft plan; the codex research lens (Phase 2) timed out at its 20-min self-reap and is treated as "research not completed" (the two Explore research agents provided comprehensive grounding). All Critical/High findings below were verified against source and resolved in the final `plan.md` / `stories-outline.md` before handoff.

Reviewers: (1) Explore plan-review agent (gpt-5.4-mini), (2) Copilot review lens (xhigh), (3) rubber-duck (gpt-5.5).

## Critical
- **C-1 (rubber-duck) — `codex-copilot → codex-api` circular dependency.** The draft had the overlay depend on `codex-api` for `ResponseEvent`/`ResponseItem`, but `codex-api` already depends on `codex-copilot` (`codex-api/Cargo.toml:17`, verified). **Resolved:** the overlay now yields a *neutral, overlay-local* event representation; the neutral→`codex_api::ResponseEvent` map (incl. per-`call_id` tool-arg assembly) moves to the core `chat_transport.rs` (core depends on both `codex-api` and, newly, `codex-copilot`). Layering: `codex-copilot` < `codex-api` < `codex-core`.

## High
- **H-1 (copilot + rubber-duck) — `ModelInfo` cannot hold `Option<WireApi>` (cycle).** `ModelInfo` is in `codex-protocol`; `WireApi` is in `model-provider-info`, which depends on `codex-protocol` (verified — `codex-protocol` does not depend back). **Resolved:** the route hint is a `#[serde(default)]` **protocol-local** type (e.g. `ModelWireRoute::{ProviderDefault, ChatCompletions}`), mapped to `WireApi` only at the core/provider boundary.
- **H-2 (planreview) — `ModelInfo` location wrong.** Draft said models-manager; actual is `protocol/src/openai_models.rs:262` (verified). **Resolved:** corrected location + constructor fan-out (`synthesize_from_capabilities`, `translate_entry` bundled-clone, `models-manager/src/model_info.rs:65-102`).
- **H-3 (copilot) — `core/Cargo.toml` dep missing.** `codex-core` does not currently depend on `codex-copilot` (verified). **Resolved:** US-005 + Files-to-Modify now require adding the dep (acyclic) + `just bazel-lock-update`/`-check`.
- **H-4 (copilot + planreview) — "limited to" seam claim contradicts the file list.** The draft claimed upstream edits were limited to the variant + one arm + filter, but also creates `core/src/chat_transport.rs` + a `mod` line + a `core/Cargo.toml` dep (all upstream-canonical). **Resolved:** added an honest "Upstream-canonical surface" section enumerating all FIVE seams, each with §14/§15 coverage; removed the misleading "limited to" framing.
- **H-5 (copilot + rubber-duck) — v1 feature contract not enumerated / not tied to enforcement sites.** **Resolved:** added an explicit contract table (feature → source field → v1 status → exact gate site → test), with enforcement at TWO sites (Prompt→chat-body builder hard-errors + SSE translator no-leak), plus picker capability flags. Noted that `build_reasoning` (`client.rs:699-715`) already returns `None` when `supports_reasoning_summaries==false`, so the residual risk is translator-side thinking leakage (explicit no-leak test added).
- **H-6 (rubber-duck) — partial-rollout guardrail gap.** If US-003 surfaces chat-only rows before US-005 wires dispatch, Claude routes to `/responses` (broken). **Resolved:** surfacing is gated on BOTH the route hint AND a "chat transport available" guard flipped in US-005; the guardrail test asserts hidden-until-transport, not merely hint-absent.

## Medium
- **M-1 — Cache invalidation left optional.** Resolved: US-003 adds a stale-cache/serde-default test + a `client_version` bump (or documented rationale).
- **M-2 — Contract gating ordered too late.** Resolved: request-build hard-errors land in US-004's builder (no silent path ever); US-006 completes the picker UI-disable + full test matrix.
- **M-3 — US-003/US-004 parallel lockfile risk.** Resolved: overlay-transport owns `Cargo.lock` for Phase 3; model-surface rebases (noted in the decomposition).
- **M-4 — Spike insufficient for all load-bearing failures.** Resolved: US-001 expanded to include two interleaved (parallel) tool calls + usage accounting; anything the spike can't prove ships gated.
- **M-5 — `cargo test` violates repo rule.** Resolved: all story ACs now use `just test -p <crate>`; `cargo check --workspace` kept as the typecheck gate.
- **M-6 — `just bazel-lock-update`/`-check` after Cargo dep changes.** Resolved: added to US-004/US-005/US-008.
- **M-7 — Two-commit ordering under-specified.** Resolved: noted the patched submodule is not standalone-buildable; develop in a paired worktree, commit the submodule seam first, then the wrapper (overlay + docs + gitlink); codexu pointer bump lead-owned.
- **M-8 — Live transcript not replayable.** Resolved: US-008 makes a deterministic integration test mandatory; a live transcript only supplements.

## Sound decisions verified (rubber-duck)
- `model_info` is in scope at dispatch (`core/src/client.rs:1571-1582`) → per-model routing feasible without a new parameter.
- `ModelInfo` round-trips through `models_cache.json` (cache stores `Vec<ModelInfo>`); `client_version` bump preferred for the pre-hint case.
- `Prompt`→chat-body conversion in core is correct (`Prompt.tools`/`parallel_tool_calls` are `pub(crate)`).
- Overlay-first placement aligns with fork tenet #1; the only flaw was the (now-fixed) `codex-api` dependency direction.
