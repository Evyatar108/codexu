<!-- ralph-meta {"overviewTaskId":"codex-context-window-tier-selection"} -->
# Implementation Plan: Knob B — Per-Model Context-Window Tier Selector (default | long_context)

*Finalized from the staged `/plan-with-ralph` draft (`20260611T034041Z-plan-knobb-64cc0021`) on
2026-06-10. The original draft + both lens reviews could not be committed by the planning run (a crews
binding bug, since fixed); this is the finalize pass that resolves the Phase-4 review findings. Ready for
`/implement-with-ralph --from-plan <job_dir>/plan.md`.*

## Overview

Expose a per-model **context-window tier** selector (`default` | `long_context`, roughly 200k vs 1m
tokens) for Copilot-provider models in the codex fork, matching VS Code Copilot CLI parity. The selected
tier drives codex's *effective/usable* context window, the compaction thresholds, and the "% context left"
gauge. The selector is presented as the NEXT step AFTER the existing Knob A reasoning-effort picker
(shipped in the `.3` release), so the interactive flow becomes: **pick model → pick effort → pick context
size**, with the context step skipped for single-tier models.

This is a CODEX SUBMODULE feature. It chains after the `.3` (Knob A) ship and must be implemented on top of
the `ralph/codex-release-v3-integration` branch state. Build and release are **lead-owned** (the overlay
relative-path workspace pin does not resolve from a detached worktree, and release builds need the heavy
publish toolchain); the impl member's local gate is `cargo check --workspace` + `just test -p codex-tui` +
`just test -p codex-app-server-protocol` + `cargo insta`.

## Research Findings

### Codebase Context
All paths relative to `codex/external/repos/codex-patched/codex-rs` (branch `ralph/codex-release-v3-integration`).
Seeded from the Knob B split of brainstorm `6efd6d51d` (codex-copilot-model-knobs-reasoning-context).
Anchors below were re-verified against source on 2026-06-10 during this finalize pass.

- **Copilot `/models` parser** — `model-provider/src/copilot_models_endpoint.rs`. `CopilotLimits` (L58-101)
  parses ONLY `max_context_window_tokens` today. `translate_entry()` (L247-353) returns bundled `ModelInfo`
  unchanged for known slugs (except display/visibility/wire_route); `synthesize_from_capabilities()` sets
  both `context_window` and `max_context_window` from the single parsed limit. `is_chat_responses_picker_entry()`
  L203-226. SANDBOX PATCH "D-001 Knob A default" region L298-352.
- **CRITICAL UNVERIFIED PREMISE:** grep across codex-rs found **no** references to `defaultContextMax`,
  `fullMax`, or `billingTier`. The tier-split field names are an assumption inherited from VS Code Copilot
  CLI parity and are NOT confirmed against the live endpoint. This is the gating risk (see US-001).
- **Knob A picker** — `tui/src/chatwidget/model_popups.rs`. Four `(model+effort)` finalize/convergence
  points: (1) auto-model no-effort path `model_selection_actions()` L216-237; (2) effort-selection action in
  `open_reasoning_popup()` L467-485; (3) single-effort fast path L393-405; (4) plan-mode scope-prompt all-modes
  action in `open_plan_reasoning_scope_prompt()` L307-316. All currently emit `UpdateReasoningEffort` +
  `PersistModelSelection`.
- **AppEvent** — `tui/src/app_event.rs` (UpdateReasoningEffort L618, PersistModelSelection L627, OpenReasoningPopup
  L671, OpenPlanReasoningScopePrompt L676); dispatch `tui/src/app/event_dispatch.rs` (L740, L769, L772, PersistModelSelection
  handler L1244-1262).
- **Context-window / compaction / gauge** — `protocol/src/openai_models.rs`: `resolved_context_window()` =
  `context_window.or(max_context_window)` (L353-355), `auto_compact_token_limit()` (L358), `effective_context_window_percent`
  (default 95). `core/src/session/turn_context.rs` L140-146: usable = `resolved_context_window() * pct / 100`
  (the gauge source). `models-manager/src/model_info.rs` L24-40: `with_config_overrides()` min-clamps config
  `model_context_window` to `max_context_window`.
- **ModelInfo→ModelPreset** — `protocol/src/openai_models.rs` L478-512 `impl From<ModelInfo> for ModelPreset`
  carries reasoning efforts + service tiers but **no context metadata** today.
- **Config** — `config/src/config_toml.rs` L137-155 has scalar `model`, `model_context_window`,
  `model_auto_compact_token_limit` and uses `#[schemars(deny_unknown_fields)]` (new keys MUST be declared).
  No per-model override map. Persist via `tui/src/config_update.rs` `build_model_selection_edits` (L56-73).
  Schema regen: `just write-config-schema` + `core/config.schema.json`, gated by `core/src/config/schema_tests.rs`.
- **Profile config (verified 2026-06-10)** — `config/src/profile_toml.rs` `ConfigProfile` uses
  `#[schemars(deny_unknown_fields)]` (L23) and DUPLICATES the per-model knobs: `model` (L25),
  `service_tier` (L28), `model_provider` (L31), `model_reasoning_effort` (L35), `plan_mode_reasoning_effort`
  (L36), `model_verbosity` (L38), `personality` (L41). A model selected through a profile reads these,
  so the context tier MUST also be a profile key for parity (see US-005 and Finding-4 resolution).
- **Active-thread sync (codex-unique finding)** — `tui/src/app/thread_settings.rs`,
  `app-server-protocol/src/protocol/v2/thread.rs`, `core/src/session/session.rs`,
  `app-server/src/request_processors/turn_processor.rs` carry model/effort/service-tier but no context tier.
  Without adding tier here the picker persists config but does NOT affect the active thread until restart.
- **app-server v2 thread DTOs (verified 2026-06-10, exact lines)** — `app-server-protocol/src/protocol/v2/thread.rs`:
  `ThreadStartParams` L95 (model L97, service_tier L100-107 double-option, personality L137); `ThreadStartResponse`
  L195 (model L197, service_tier L199, reasoning_effort L221); `ThreadSettingsUpdateParams` L229 (model L251,
  service_tier L254-261 double-option, effort L264, summary L267, personality L277); `ThreadSettings` L288
  (model L294, service_tier L296, effort L297, summary L298, personality L300); `ThreadSettingsUpdatedNotification`
  L306 (thread_id L307, thread_settings: ThreadSettings L308); `ThreadResumeParams` L330; `ThreadResumeResponse`
  L411. These are the exact carriers US-007 must touch (see Finding-1 resolution + US-007 below).
- **app-server schema fixtures (verified 2026-06-10)** — `app-server-protocol/tests/schema_fixtures.rs`
  has `typescript_schema_fixtures_match_generated` + `json_schema_fixtures_match_generated`, comparing
  committed fixture trees against in-memory generation. Any v2 DTO field change requires regenerating them
  via `just write-app-server-schema` (and `--experimental` if experimental fixtures change); `cargo check
  --workspace` does NOT catch fixture drift (see Finding-2 resolution).
- **Serde cache compat (copilot finding)** — `~/.codex/models_cache.json` holds older `ModelInfo` without
  the new fields; all new `ModelInfo`/`ModelPreset` fields MUST use serde defaults / `skip_serializing_if`.
- **Insta tests** — `tui/src/chatwidget/tests/popups_and_settings.rs` (model_selection_popup_snapshot ~L2260,
  model_reasoning_selection_popup_snapshot, *_extra_high_warning_snapshot); snapshots under
  `tui/src/chatwidget/snapshots/`.

### Technical Constraints
- **Fork tenet 1 (minimize upstream-canonical conflict surface):** prefer (a) new overlay file, (b) new file
  under a crate called from a 1-3 line seam edit, (c) inline upstream-canonical edit only when unavoidable.
  Every upstream-canonical edit needs a `// SANDBOX PATCH:` marker, a `docs/implementation/patch-surface.md`
  §14 invariant + enforcing test/guard, and a §15 rebase-replant note.
- **Fork tenet 2 (verify the seam):** anchors above were source-verified 2026-06-10/11; the live `/models`
  field names are NOT verified (US-001 gate).
- **Fork tenet 3 (test invariants in-tree):** parser tier parse, tier→window mapping, the clamp-order
  interaction, single-tier skip, the stale-tier normalization, the chained-picker flow, and the v2 DTO
  round-trip each need a test/guard.
- **Fork tenet 4 (frozen iteration profile):** build/verify is lead-owned; do NOT plan a local release build.
- `config_toml.rs` AND `profile_toml.rs` both use `#[schemars(deny_unknown_fields)]`; `app-server` v2 DTO
  changes require schema/TS fixture regeneration per the app-server protocol rules (`just write-app-server-schema`).

## Approach

### Architecture
Introduce a fork-local **context-tier** concept that flows: Copilot `/models` parse → `ModelInfo` tier
metadata → `ModelPreset` (picker payload) → a new TUI context-tier picker chained after effort → a
`model_context_tier` config key (top-level AND profile) + active-thread setting → `models-manager`
resolution that sets the effective `context_window` → existing `resolved_context_window()`/
`effective_context_window_percent` consumers (compaction + gauge) with no further change → the v2 thread
DTOs so the tier reaches the live session.

Key design decisions (consensus across all four research lenses):
1. **New tier fields, not an overwrite of `model_context_window`.** The numeric `model_context_window` config
   override has min-clamp semantics; the tier selects the model's effective catalog window and is applied
   BEFORE the numeric override clamp. Keep `context_window` = selected/effective window, `max_context_window`
   = full ceiling.
2. **Single TUI convergence seam.** Refactor the 4 finalize paths so they all route through one helper
   (`apply_model_effort_and_context` / a "maybe open context picker" seam): after model+effort are settled,
   open the context picker if the model has 2 tiers, else apply/persist directly. For plan mode the order is
   plan-scope prompt → context picker → apply. (Preserves the operator UX requirement — see below.)
3. **Tier must reach the active thread**, not just persisted config, or the parity goal fails (restart needed).
   The carrier is the v2 thread settings DTO surface enumerated in US-007.
4. **Serde defaults on all new metadata fields** for `models_cache.json` backward-compat.
5. **Scalar `model_context_tier` is deliberately not per-model.** Because one scalar key cannot remember a
   distinct tier per model, resolution MUST normalize a stale tier against the selected model's available
   tiers (a persisted `long_context` is ignored / falls back deterministically when the model is single-tier).
   This is required, not optional (see Finding-3 resolution).

### Operator UX requirement (PRESERVED — load-bearing)
The context-size selector is presented as the NEXT step AFTER the `.3` Knob A reasoning-effort picker
(which itself follows model selection). The flow is **pick MODEL → pick EFFORT → pick CONTEXT size**. After
the user confirms an effort level, the context-tier picker (`default` | `long_context`) for that model
appears immediately. The context step is SKIPPED for single-tier models. A non-anthropic model with NO
effort step must still reach the context step right after model selection. The context picker matches the
effort/model pickers' presentation, confirm, default-highlight, and cancel/escape semantics. US-006 owns
this and is the convergence-seam story.

**Plan-mode note:** in plan mode the effort choice is made through the plan-scope prompt
(`open_plan_reasoning_scope_prompt`), which IS plan mode's effort-selection step. So the plan-mode order
`plan-scope → context → apply` is the same rule as `effort → context` — the context picker is always the
step immediately after the effort decision, whichever form that decision takes.

### Implementation Strategy
Ordered (dependency-driven):
1. **US-001 — Phase-0 spike GATE:** verify the live Copilot `/models` shape for tier fields. GO/NO-GO.
2. **US-002 — protocol tier metadata** (`ContextWindowTier`, tier presets, `ModelInfo`/`ModelPreset` fields).
3. **US-003 — Copilot parser tier extraction** (depends US-001, US-002) and **US-004 — tier→window resolution
   + override order + stale-tier normalization** (depends US-002) — file-disjoint (model-provider vs
   models-manager), parallel-able.
4. **US-005 — config key (top-level + profile) + persistence** (depends US-002, US-004).
5. **US-006 — TUI context-tier picker + single convergence seam** (depends US-002, US-005).
6. **US-007 — active-thread sync + enumerated v2 DTO carriers + schema-fixture regen** (depends US-002,
   US-004, US-006).
7. **US-008 — patch-surface §14/§15 registration + docs** (depends on all upstream-canonical edits;
   STRICTLY depends-on US-007 and is final-only — see Finding/ordering resolution).

### Files to Create/Modify
- **Create:** `tui/src/chatwidget/context_tier_popup.rs` (new picker module). Possibly a fork-local
  overlay helper for tier parsing/resolution if it keeps upstream structs un-widened.
- **Modify (upstream-canonical, SANDBOX PATCH):** `tui/src/app_event.rs`, `tui/src/app/event_dispatch.rs`,
  `tui/src/chatwidget/model_popups.rs`, `model-provider/src/copilot_models_endpoint.rs` (CopilotLimits +
  translate/synthesize), `protocol/src/openai_models.rs` (ModelInfo/ModelPreset fields + tier types),
  `models-manager/src/{model_info.rs,config.rs}`, `config/src/config_toml.rs`, `config/src/profile_toml.rs`,
  `core/src/config/mod.rs` (+ `edit.rs`), `tui/src/config_update.rs`, `tui/src/app/thread_settings.rs`,
  `app-server-protocol/src/protocol/v2/thread.rs` (the enumerated DTOs), `core/src/session/session.rs`,
  `app-server/src/request_processors/turn_processor.rs` (+ thread_processor for the settings-update path).
- **Generated:** `core/config.schema.json` (`just write-config-schema`); app-server v2 schema/TS fixtures
  (`just write-app-server-schema`, `app-server-protocol/schema/...`) because US-007 changes v2 DTOs.
- **Docs:** `codex/docs/implementation/patch-surface.md` §14 (invariants) + §15 (replant notes).
- **Tests:** `model-provider/src/copilot_models_endpoint.rs` (parser fixtures), `protocol/src/openai_models.rs`
  (serde/cache compat + conversion), `models-manager/src/model_info_tests.rs` (tier mapping + clamp order +
  stale-tier normalization), a core/session test (gauge reflects tier), `tui/src/chatwidget/tests/popups_and_settings.rs`
  (+ snapshots; single-tier skip incl. stale-config case), `config` profile round-trip + deny_unknown_fields
  test, `app-server-protocol/tests/schema_fixtures.rs` (regenerated fixtures).

## Scope

### In Scope
- Parse tier metadata from Copilot `/models` (field names confirmed by US-001) and model a per-model
  `default | long_context` tier with `default→defaultContextMax`, `long_context→fullMax`.
- A TUI context-tier picker chained after the effort picker (and reachable from the no-effort auto-model path),
  matching the reasoning popup's presentation + confirm/cancel/default-highlight semantics; skipped for
  single-tier models.
- A `model_context_tier` config key (default = default tier) at BOTH top-level (`config_toml.rs`) and profile
  (`profile_toml.rs`) scope, persisted alongside model + reasoning effort.
- Deterministic stale-tier normalization: a persisted `long_context` must not affect a later single-tier
  model selection.
- Wiring the selected tier into the effective/usable context window, compaction thresholds, and the % gauge.
- Active-thread sync via the enumerated v2 thread DTOs so the tier takes effect on the next turn without a
  restart, plus regenerated app-server schema fixtures.
- Subsuming the Option-2 GPT case (gpt-5.4 max=1m/default=272k; gpt-5.5 272k/272k) via the tier toggle.
- Tests for parser, tier mapping, clamp-order, stale-tier normalization, single-tier skip, picker flow,
  live-session gauge, profile round-trip, and v2 DTO/schema-fixture round-trip.
- Patch-surface §14/§15 registration for every upstream-canonical edit.

### Out of Scope
- A local release build (lead-owned).
- A standalone numeric "effective context cap" picker (Option 3 — not chosen).
- Non-Copilot providers' tier handling (the feature targets Copilot-provider models).
- Any change to the `.3` Knob A effort picker behavior beyond routing it through the shared convergence seam.
- Carrying the tier as a settable param on `ThreadResumeParams`/`ThreadResumeResponse` (resume restores the
  tier from persisted session/config state; see US-007 enumeration).

## Risk Areas
- **GATING: live `/models` field shape unverified.** If the endpoint does not expose per-tier maxes, the
  Option-1 premise breaks; US-001 must surface `kind=question` to the operator before further coding.
- **Multi-convergence-point chaining.** Four finalize paths must all reach the context step exactly once and
  skip cleanly for single-tier models; regressions here are subtle (double-apply, skipped persist, plan-mode
  ordering).
- **Clamp-order interaction.** Applying the tier window must precede the numeric `model_context_window`
  min-clamp; getting the order wrong can clamp `long_context` away.
- **Stale scalar tier.** A persisted `long_context` applied to a single-tier model would wrongly widen its
  window; normalization is required and explicitly tested.
- **Serde cache compat.** Missing defaults on new fields would break deserialization of an existing
  `models_cache.json`.
- **GPT bundled-metadata merge.** `translate_entry()` returns bundled `ModelInfo` unchanged for known slugs;
  tier metadata must be overlaid onto bundled rows, not only synthesized rows.
- **Snapshot churn / TUI module size.** New picker should live in its own module (keep `model_popups.rs` and
  `chatwidget.rs` from growing); any user-visible UI change requires insta coverage.
- **app-server v2 DTO fixture drift.** Adding a tier field to the enumerated DTOs silently breaks
  `schema_fixtures.rs` unless `just write-app-server-schema` is run; `cargo check` will not catch it.
- **Profile parity.** Forgetting `profile_toml.rs` silently drops the tier for profile-selected models.

## Acceptance Criteria
- [ ] US-001 produces a documented, evidence-backed answer for the live `/models` tier field names (or a
      definitive "not exposed" finding that gates the rest), with the raw capture stored at a named artifact
      path and any secrets/PII redacted (see US-001).
- [ ] Copilot models with two distinct tier windows expose both `default` and `long_context`; models with one
      tier expose only one (no toggle).
- [ ] Selecting `long_context` makes the effective/usable context window, the auto-compaction threshold, and
      the % context gauge reflect the full-tier window on the NEXT turn without a restart.
- [ ] Selecting `default` (or leaving the default) yields the default-tier window; this is the persisted default.
- [ ] The context picker appears immediately after the effort step for multi-effort models, and after model
      selection for auto/no-effort models; it is skipped for single-tier models. Esc semantics are specified
      per path: in `model → effort → context`, Esc on the context picker returns to the effort picker; in
      `model → context` (no-effort/auto), Esc returns to the model picker; in `plan-scope → context`, Esc
      returns to the plan-scope prompt.
- [ ] **Stale-tier normalization:** with `model_context_tier = "long_context"` persisted, selecting or loading
      a single-tier model resolves to that model's single available window, does NOT show a toggle, and the
      stale `long_context` does NOT widen the resolved window. Covered by an explicit models-manager unit test
      AND a TUI picker-skip test.
- [ ] The numeric `model_context_window` override still clamps correctly relative to the selected tier
      (tier window applied before the min-clamp).
- [ ] GPT slugs route through the tier path with correct windows **conditional on US-001**: the source of
      truth is the captured `/models` response; if gpt-5.4/gpt-5.5 appear with tier metadata they must
      resolve to (gpt-5.4 full=1m/default=272k; gpt-5.5 272k/272k). If US-001 finds these slugs lack tier
      metadata, this criterion is satisfied by the single-tier path instead.
- [ ] New `ModelInfo`/`ModelPreset` fields deserialize from a pre-existing `models_cache.json` (serde defaults).
- [ ] `model_context_tier` round-trips through config read/write/edit at BOTH top-level and profile scope;
      a `#[schemars(deny_unknown_fields)]` rejection/compat test exists; `core/config.schema.json` regenerated;
      `core/src/config/schema_tests.rs` pass.
- [ ] US-007 carries the tier through the enumerated v2 DTOs (see US-007); app-server schema fixtures
      regenerated via `just write-app-server-schema`; `just test -p codex-app-server-protocol` passes.
- [ ] Every upstream-canonical edit has a `// SANDBOX PATCH:` marker + a patch-surface §14 invariant with an
      enforcing test/guard + a §15 replant note.
- [ ] Local gates pass: `cargo check --workspace`; `just test -p codex-tui`; `just test -p codex-models-manager`;
      `just test -p codex-app-server-protocol`; `cargo insta` (no pending snapshots). Release build is
      lead-owned and out of scope.

## Story Decomposition

### US-001 — Phase-0 spike GATE: verify live `/models` tier field shape (GO/NO-GO)
Obtain the live Copilot `/models` JSON shape to confirm (or refute) the per-tier max fields
(`defaultContextMax`/`fullMax`/billing-tier). `~/.codex/models_cache.json` holds codex's TRANSLATED
`ModelInfo`, not the raw response, so it cannot answer this. **Concrete probe path:** issue a raw authenticated
`GET https://api.githubcopilot.com/models` reusing the session Copilot bearer (via the existing
`CopilotHeaderSource`/`provider.api_auth()` seam) OR capture the VS Code Copilot CLI network response.
**Artifact location:** store the raw/sanitized capture at `.ralph/jobs/codex-context-window-tier-selection/spike/models-raw.json`
with a short findings note (`spike/findings.md`) recording the exact tier field names and an example
two-tier row. **Auth/privacy handling:** redact the bearer token and any account IDs before committing the
capture; commit only the fields relevant to the tier decision. If the endpoint does NOT expose per-tier
maxes, the impl member MUST surface `kind=question` to the operator and STOP — do not hardcode tier values.
- AC: documented field names (or "not exposed" gate) + redacted artifact committed.

### US-002 — Protocol tier metadata types + `ModelInfo`/`ModelPreset` fields (serde-default)
Add `ContextWindowTier { Default, LongContext }` (serde-renamed to `default`/`long_context` for config;
camelCase on the v2 wire), an optional tier-preset descriptor, and `ModelInfo` fields
(`default_context_tier` + `supported_context_tiers` or equivalent) mirrored into `ModelPreset`. All new
fields use `#[serde(default, skip_serializing_if = ...)]` for `models_cache.json` back-compat.
- AC: serde round-trip incl. deserializing a pre-existing cache without the fields; `ModelInfo→ModelPreset`
  carries the tier metadata.

### US-003 — Copilot parser tier extraction (bundled + synthesized paths)
Extend `CopilotLimits`/`CopilotCapabilities` to parse the US-001-confirmed tier fields. Overlay tier
metadata onto BOTH the bundled-`ModelInfo` path (`translate_entry` known slugs) and the synthesized path.
Treat absent/invalid/equal default vs full maxes as single-tier.
- Depends: US-001 (field names), US-002 (types).
- AC: parser unit fixtures for a two-tier row, a single-tier row, and an absent-fields row.

### US-004 — Tier→effective-window resolution + override order + stale-tier normalization
In `models-manager/src/{model_info.rs,config.rs}`: resolve the selected/default tier into the effective
`context_window` (keep `max_context_window` = full ceiling). Apply the tier window BEFORE the numeric
`model_context_window` min-clamp. **Stale-tier normalization (Finding-3):** when the persisted scalar tier
is `long_context` but the selected model exposes only one tier (or old cache metadata lacks tier fields),
deterministically fall back to the single available window — the stale tier must not widen the resolved
window.
- Depends: US-002.
- AC: unit tests for tier→window mapping, clamp-order interaction, AND an explicit stale-`long_context`-on-
  single-tier-model test proving no widening.

### US-005 — `model_context_tier` config key (top-level + profile) + persistence + schema regen
Add `model_context_tier: Option<...>` to `config_toml.rs` (under `#[schemars(deny_unknown_fields)]`) AND to
`profile_toml.rs` `ConfigProfile` (parity with `model_reasoning_effort`/`service_tier`, which profiles
already carry — Finding-4). Merge the profile value into effective config in `core/src/config/mod.rs`;
persist via `tui/src/config_update.rs` `build_model_selection_edits` + the `PersistModelSelection` dispatch.
Run `just write-config-schema`.
- Depends: US-002, US-004.
- AC: top-level AND profile-scoped read/write/edit round-trip; a `deny_unknown_fields` rejection/compat test;
  `core/config.schema.json` regenerated; `schema_tests.rs` pass.

### US-006 — TUI context-tier picker + single convergence seam + snapshots
New module `tui/src/chatwidget/context_tier_popup.rs` + `AppEvent::OpenContextTierPopup`/`UpdateContextTier`
+ dispatch. Refactor the 4 finalize paths through one seam so the context step fires after effort (after
plan-scope in plan mode), is skipped for single-tier models (incl. when config carries a stale `long_context`),
and the no-effort/auto path reaches it after model selection. Match effort-picker confirm/cancel/default-
highlight; specify Esc-return per path (see AC). Add insta coverage for the new popup and the single-tier-skip
(stale-config) case.
- Depends: US-002, US-005.
- AC: picker-flow + single-tier-skip + Esc-per-path covered; insta snapshots accepted.

### US-007 — Active-thread sync + enumerated v2 DTO carriers + schema-fixture regen
Carry the tier from the TUI/config through to the active thread so it takes effect next turn. **Exact v2
`thread.rs` DTO carriers (Finding-1):**
- **`ThreadSettingsUpdateParams` (L229)** — ADD `context_tier: Option<ContextWindowTier>` mirroring the
  `effort: Option<ReasoningEffort>` field (L264), `#[ts(optional = nullable)]`. This is THE field that makes
  the picker change take effect on the next turn without restart.
- **`ThreadSettings` (L288)** — ADD `context_tier: Option<ContextWindowTier>` mirroring `effort` (L297). The
  canonical current-settings struct echoed by the notification.
- **`ThreadSettingsUpdatedNotification` (L306)** — NO new direct field; inherits the tier through its
  `thread_settings: ThreadSettings` (L308).
- **`ThreadStartParams` (L95)** — ADD `context_tier: Option<ContextWindowTier>`, `#[ts(optional = nullable)]`,
  mirroring `service_tier` (L100-107), so a thread can start on a non-default tier (parity).
- **`ThreadStartResponse` (L195)** — ADD `context_tier: Option<ContextWindowTier>` mirroring `reasoning_effort`
  (L221) so the client sees the resolved start tier.
- **`ThreadResumeParams` (L330) / `ThreadResumeResponse` (L411)** — INTENTIONALLY NOT carrying the tier as a
  settable param; resumed threads restore the tier from persisted session/config state. State this exclusion
  + add a note (no fixture change for resume).

App-server-side + core wiring: translate the new DTO field into the core session settings in
`app-server/src/request_processors/turn_processor.rs` (and the thread settings-update processor), set it on
the session in `core/src/session/session.rs`, and emit it from the TUI in `tui/src/app/thread_settings.rs`
on a picker change. **Schema-fixture regen (Finding-2):** because v2 DTOs change, run
`just write-app-server-schema` (and `--experimental` if experimental fixtures are touched) to regenerate
`app-server-protocol/tests/schema_fixtures.rs` JSON/TS fixtures; `cargo check --workspace` will NOT catch
fixture drift. Validate with `just test -p codex-app-server-protocol`.
- Depends: US-002, US-004, US-006.
- AC: a live-session test (or app-server protocol test) showing a tier change applies on the next turn
  without restart; regenerated fixtures committed; `just test -p codex-app-server-protocol` passes.

### US-008 — Patch-surface §14/§15 registration + docs
Register every upstream-canonical edit: a `// SANDBOX PATCH:` marker on each edited line, a
`docs/implementation/patch-surface.md` §14 invariant + enforcing test/guard, and a §15 rebase-replant note.
- Depends: ALL upstream-canonical edits; **STRICTLY depends-on US-007** and is FINAL-ONLY (must run after
  US-007 so it reflects the final protocol edits — see ordering resolution).
- AC: §14/§15 rows exist for each landed upstream-canonical edit; `scripts/audit_invariants.sh`-style guards pass.

## Suggested Decomposition

This feature is a largely-serial dependency chain (protocol foundation → parser/resolution → config → TUI →
thread-sync → docs). The only safe intra-feature parallelism is US-003 (model-provider) vs US-004
(models-manager) once US-002 lands. Config-schema, protocol files, and the v2 DTO + fixture surface are
risky/global → serialized. **US-008 is split out as strictly depends-on US-007 and final-only** (not merely
same-cluster) so patch-surface docs cannot race the final protocol edits under `--parallel`.

### Cluster: spike-gate
- Stories: US-001
- Phase: 1
- Depends on: None
- File-overlap: shared=[]; exclusive=[spike notes/capture under `.ralph/jobs/.../spike/`]; risk=low

### Cluster: protocol-foundation
- Stories: US-002
- Phase: 2
- Depends on: spike-gate
- File-overlap: shared=[protocol/src/openai_models.rs]; exclusive=[]; risk=medium

### Cluster: parse-and-resolve
- Stories: US-003, US-004
- Phase: 3
- Depends on: protocol-foundation (US-003 also on spike-gate)
- File-overlap: shared=[]; exclusive=[US-003: model-provider/src/copilot_models_endpoint.rs; US-004:
  models-manager/src/{model_info.rs,config.rs}]; risk=low

### Cluster: config-persistence
- Stories: US-005
- Phase: 4
- Depends on: parse-and-resolve
- File-overlap: shared=[core/config.schema.json, config/src/config_toml.rs, config/src/profile_toml.rs]; risk=high

### Cluster: tui-picker
- Stories: US-006
- Phase: 5
- Depends on: config-persistence
- File-overlap: shared=[tui/src/app_event.rs, tui/src/app/event_dispatch.rs, tui/src/chatwidget/model_popups.rs];
  exclusive=[tui/src/chatwidget/context_tier_popup.rs]; risk=medium

### Cluster: thread-sync
- Stories: US-007
- Phase: 6
- Depends on: tui-picker
- File-overlap: shared=[app-server-protocol/src/protocol/v2/thread.rs, app-server v2 generated fixtures,
  app-server/src/request_processors/*, core/src/session/session.rs, tui/src/app/thread_settings.rs]; risk=high

### Cluster: docs-registration
- Stories: US-008
- Phase: 7
- Depends on: thread-sync (US-007) — STRICT, final-only
- File-overlap: shared=[codex/docs/implementation/patch-surface.md]; risk=low (docs-only, but must reflect all
  landed edits)

Parallel handoff: `/implement-with-ralph --from-plan <plan_job_dir>/plan.md --parallel --suggested-decomposition <plan_job_dir>/suggested-decomposition.json`

## Phase-4 Review Findings Resolution

The staged draft was reviewed by both the codex and copilot lenses. This finalize pass resolves all four
mandated findings (full detail in `phase-4-findings-resolution.md`):

1. **[HIGH] US-007 too broad — enumerate exact v2 DTOs.** US-007 now enumerates each `thread.rs` struct by
   line number (`ThreadStartParams` L95, `ThreadStartResponse` L195, `ThreadSettingsUpdateParams` L229,
   `ThreadSettings` L288, `ThreadSettingsUpdatedNotification` L306) with the exact field-shape to mirror
   (`effort`/`service_tier`/`reasoning_effort`), states `ThreadSettingsUpdatedNotification` inherits via
   `ThreadSettings`, and marks `ThreadResumeParams/Response` as intentional exclusions.
2. **[MED] app-server schema-fixture regen gate.** US-007 + Files-Generated + AC now require
   `just write-app-server-schema` (+`--experimental` when needed) to regenerate
   `app-server-protocol/tests/schema_fixtures.rs` fixtures and `just test -p codex-app-server-protocol`,
   noting `cargo check --workspace` does not catch fixture drift.
3. **[MED] Stale-tier case.** US-004 now requires deterministic stale-tier normalization with an explicit
   models-manager unit test (stale `long_context` cannot widen a single-tier model) plus a TUI picker-skip
   test; a dedicated AC is added.
4. **[MED] `profile_toml.rs`.** Verified `ConfigProfile` duplicates the per-model knobs under
   `#[schemars(deny_unknown_fields)]`; US-005 now adds `model_context_tier` to the profile (parity), merges
   it in `core/src/config/mod.rs`, and adds a profile round-trip + deny_unknown_fields compat test.

Secondary review findings also addressed: US-001 probe path/artifact/privacy made concrete; "Typecheck
passes" replaced with concrete gate commands; the GPT-slug AC made fixture-driven/conditional on US-001;
Esc semantics specified per path; US-008 made strictly depends-on US-007 and final-only.

## Open Questions
- **[GATING] Live Copilot `/models` tier field names.** `defaultContextMax`/`fullMax`/billing-tier are NOT in
  codex source. US-001 must obtain a raw authenticated `/models` GET or a VS Code Copilot CLI capture. If the
  endpoint does not expose per-tier maxes, the impl member must surface `kind=question` to the operator (do
  NOT hardcode tier values).
- **`max_context_window` semantics under long_context.** Default recommendation: `max_context_window = fullMax`,
  `context_window = selected tier`, so the numeric override remains meaningful. Decided in US-004 tests.

## Next Step
To implement this plan after the lead fast-forwards the plan branch to main, run:
`/implement-with-ralph --from-plan <job_dir>/plan.md --autonomous`
(or the `--parallel --suggested-decomposition <plan_job_dir>/suggested-decomposition.json` handoff above).

After merging, clean up the plan worktree with `/plan-with-ralph cleanup codex-context-window-tier-selection`.
