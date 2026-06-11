<!-- ralph-meta {"overviewTaskId":"codex-context-window-tier-selection"} -->
# Phase-4 Review Findings Resolution — Knob B Context-Window Tier Selector

The staged `/plan-with-ralph` run (`20260611T034041Z-plan-knobb-64cc0021`) produced a complete draft plus
two lens reviews (`codex-plan-review.txt`, `copilot-plan-review.txt`) but could not commit (a crews binding
bug, since fixed). This document records how each Phase-4 finding was resolved in the finalized `plan.md`.
All source anchors below were re-verified against `codex/external/repos/codex-patched/codex-rs` on
2026-06-10/11 (branch state at the lead's checkout). No multi-lens review was redone.

---

## Finding 1 — [HIGH] US-007 too broad for the app-server v2 protocol surface

**Review text (codex lens):** "US-007 ... should enumerate the exact structs that must carry or intentionally
not carry the context tier: at minimum `ThreadStartParams`, `ThreadStartResponse`, `ThreadSettingsUpdateParams`,
`ThreadSettings`, and `ThreadSettingsUpdatedNotification`."

**Source verification** (`app-server-protocol/src/protocol/v2/thread.rs`):
- `ThreadStartParams` — L95; fields incl. `model` L97, `service_tier` L100-107 (double-option), `personality` L137.
- `ThreadStartResponse` — L195; `model` L197, `service_tier` L199, `reasoning_effort` L221.
- `ThreadSettingsUpdateParams` — L229; `model` L251, `service_tier` L254-261 (double-option), `effort` L264,
  `summary` L267, `personality` L277.
- `ThreadSettings` — L288; `model` L294, `service_tier` L296, `effort` L297, `summary` L298, `personality` L300.
- `ThreadSettingsUpdatedNotification` — L306; `thread_id` L307, `thread_settings: ThreadSettings` L308.
- `ThreadResumeParams` — L330; `ThreadResumeResponse` — L411.

**Resolution (plan.md US-007):** each struct is now enumerated with the exact field-shape to mirror and a
carry/no-carry decision:
- `ThreadSettingsUpdateParams` — ADD `context_tier: Option<ContextWindowTier>` mirroring `effort` (L264),
  `#[ts(optional = nullable)]`. This is the field that makes the tier take effect next turn without restart.
- `ThreadSettings` — ADD `context_tier` mirroring `effort` (L297).
- `ThreadSettingsUpdatedNotification` — NO direct field; inherits via `thread_settings: ThreadSettings`.
- `ThreadStartParams` — ADD `context_tier`, `#[ts(optional = nullable)]`, mirroring `service_tier` (parity:
  start a thread on a non-default tier).
- `ThreadStartResponse` — ADD `context_tier` mirroring `reasoning_effort` (L221) so the client sees the
  resolved start tier.
- `ThreadResumeParams`/`ThreadResumeResponse` — INTENTIONAL EXCLUSION: resume restores the tier from
  persisted session/config state; no settable param, no fixture change.

This respects the copilot lens's "Simplicity" caution (don't over-widen broad model DTOs): only the thread
settings/start surface is widened — the minimum contract for next-turn application — not arbitrary model
metadata DTOs.

---

## Finding 2 — [MED] Missing app-server schema-fixture regen gate

**Review text (copilot lens):** "If US-007 changes v2 DTOs, `app-server-protocol/tests/schema_fixtures.rs`
requires regenerated JSON/TS fixtures via `just write-app-server-schema`; `cargo check --workspace` will not
catch fixture drift."

**Source verification:** `app-server-protocol/tests/schema_fixtures.rs` exists and contains
`typescript_schema_fixtures_match_generated` + `json_schema_fixtures_match_generated`, comparing committed
fixture trees against in-memory generation. The repo AGENTS.md app-server section confirms the regen recipe
`just write-app-server-schema` (and `--experimental`) + validation `just test -p codex-app-server-protocol`.

**Resolution:** added to US-007 body, Files-Generated, and the Acceptance Criteria: because US-007 changes
v2 DTOs, the impl member MUST run the regen step `just write-app-server-schema` (and `--experimental` if
experimental fixtures are touched), commit the regenerated fixture trees, and validate with the gate
`just test -p codex-app-server-protocol` (which is listed in the plan's local-gates section). The plan
explicitly notes `cargo check --workspace` does not catch this drift.

---

## Finding 3 — [MED] Stale-tier case (scalar persisted tier on a single-tier model)

**Review text (codex + copilot lenses):** a scalar `model_context_tier` "cannot remember different tier
choices per model, and it risks applying a stale `long_context` choice to a later single-tier model unless
fallback/clear semantics are explicitly designed." Both lenses asked for an explicit AC + test.

**Resolution (plan.md US-004 + Scope + AC):**
- US-004 now REQUIRES deterministic stale-tier normalization: when the persisted scalar tier is `long_context`
  but the selected model exposes only one tier (or old cache metadata lacks tier fields), resolution falls
  back to the single available window — the stale tier must not widen the resolved window.
- An explicit models-manager unit test proves a stale `long_context` config value cannot affect a single-tier
  model's resolved window.
- A TUI picker-skip test (US-006) proves the toggle is not shown for a single-tier model even when config
  carries `long_context`.
- A dedicated Acceptance Criterion was added.

This is the design answer to the "scalar can't be per-model" risk: rather than a per-model map (larger
surface, more conflict), the scalar is normalized at resolution/selection time, which both lenses accept as
sufficient given the picker-skip behavior.

---

## Finding 4 — [MED] `profile_toml.rs` duplicates model keys

**Review text (codex + copilot lenses):** `config/src/profile_toml.rs` `ConfigProfile` has its own
`#[schemars(deny_unknown_fields)]` and duplicates `model`, `service_tier`, `model_reasoning_effort`, etc. The
draft listed `profile_toml.rs` only "if needed"; the lenses asked to either add profile support or state it's
top-level-only + add a rejection/compat test.

**Source verification** (`config/src/profile_toml.rs`): `ConfigProfile` uses `#[schemars(deny_unknown_fields)]`
(L23) and carries `model` (L25), `service_tier` (L28), `model_provider` (L31), `model_reasoning_effort` (L35),
`plan_mode_reasoning_effort` (L36), `model_verbosity` (L38), `personality` (L41).

**Resolution (plan.md US-005):** because profiles already mirror the per-model knobs (and a model is commonly
selected through a profile), the tier is added to the profile for parity — NOT top-level-only, which would
silently drop the tier for profile-selected models. US-005 now:
- Adds `model_context_tier` to `ConfigProfile` (alongside `model_reasoning_effort`/`service_tier`).
- Merges the profile value into effective config in `core/src/config/mod.rs`.
- Adds a profile-scoped round-trip test AND a `#[schemars(deny_unknown_fields)]` rejection/compat test.
- Adds an Acceptance Criterion for the profile round-trip.

---

## Secondary findings addressed

- **US-001 probe under-specified (copilot MED).** US-001 now names the concrete probe path (raw authenticated
  `/models` GET via the existing Copilot auth seam, or a VS Code Copilot CLI capture), the artifact location
  (`.ralph/jobs/codex-context-window-tier-selection/spike/{models-raw.json,findings.md}`), and the auth/privacy
  handling (redact bearer + account IDs before committing).
- **"Typecheck passes" vague (codex MED).** Replaced with concrete gate commands: `cargo check --workspace`,
  `just test -p codex-tui`, `just test -p codex-models-manager`, `just test -p codex-app-server-protocol`,
  `cargo insta`.
- **GPT-slug AC depends on US-001 (codex MED).** Made fixture-driven/conditional: the captured `/models`
  response is the source of truth; if gpt-5.4/gpt-5.5 appear with tier metadata they resolve to the stated
  windows, otherwise the single-tier path satisfies the criterion.
- **Esc semantics under-specified (codex LOW).** Specified per path: `model→effort→context` Esc → effort;
  `model→context` (no-effort/auto) Esc → model; `plan-scope→context` Esc → plan-scope.
- **US-008 ordering race under `--parallel` (codex MED).** US-008 is now strictly depends-on US-007 and
  final-only in its own `docs-registration` cluster (Phase 7), so patch-surface docs cannot race the final
  protocol edits.
- **Active-thread override surfaces (copilot MED).** US-007 enumerates the app-server-side + core wiring
  (`turn_processor.rs` / thread settings-update processor, `core/src/session/session.rs`,
  `tui/src/app/thread_settings.rs`) in addition to the DTOs, so the tier is translated end-to-end rather than
  just declared on the wire.

---

## Preserved operator UX requirement

The finalize pass keeps the load-bearing operator UX intact: the context-size selector is the NEXT step AFTER
the `.3` Knob A reasoning-effort picker (which follows model selection) — flow **model → effort → context** —
and the context step is SKIPPED for single-tier models, with the no-effort/auto path reaching it directly
after model selection. US-006 (the single convergence-seam story) owns this and carries the matching
confirm/cancel/default-highlight + per-path Esc semantics.
