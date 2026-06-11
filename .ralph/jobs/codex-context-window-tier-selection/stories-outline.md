<!-- ralph-meta {"overviewTaskId":"codex-context-window-tier-selection"} -->
# Stories Outline: Knob B — Context-Window Tier Selector

Companion to `plan.md`. Eight stories; one largely-serial chain with a single parallel-safe pair
(US-003 ∥ US-004). All paths under `codex/external/repos/codex-patched/codex-rs`.

| ID | Title | Phase | Depends on | Key files | Parallel-safe with |
|----|-------|------:|-----------|-----------|--------------------|
| US-001 | Phase-0 spike GATE: verify live `/models` tier fields (GO/NO-GO) | 1 | — | `.ralph/jobs/.../spike/` | — |
| US-002 | Protocol tier metadata + `ModelInfo`/`ModelPreset` fields (serde-default) | 2 | US-001 | `protocol/src/openai_models.rs` | — |
| US-003 | Copilot parser tier extraction (bundled + synthesized) | 3 | US-001, US-002 | `model-provider/src/copilot_models_endpoint.rs` | US-004 |
| US-004 | Tier→window resolution + override order + stale-tier normalization | 3 | US-002 | `models-manager/src/{model_info,config}.rs` | US-003 |
| US-005 | `model_context_tier` config key (top-level + profile) + persist + schema regen | 4 | US-002, US-004 | `config/src/{config_toml,profile_toml}.rs`, `core/src/config/{mod,edit}.rs`, `tui/src/config_update.rs`, `core/config.schema.json` | — |
| US-006 | TUI context-tier picker + single convergence seam + snapshots | 5 | US-002, US-005 | NEW `tui/src/chatwidget/context_tier_popup.rs`, `tui/src/app_event.rs`, `tui/src/app/event_dispatch.rs`, `tui/src/chatwidget/model_popups.rs` | — |
| US-007 | Active-thread sync + enumerated v2 DTO carriers + schema-fixture regen | 6 | US-002, US-004, US-006 | `app-server-protocol/src/protocol/v2/thread.rs`, `app-server/src/request_processors/*`, `core/src/session/session.rs`, `tui/src/app/thread_settings.rs`, app-server schema fixtures | — |
| US-008 | Patch-surface §14/§15 registration + docs | 7 | **US-007 (strict, final-only)** | `codex/docs/implementation/patch-surface.md` | — |

## Per-story acceptance summary

- **US-001** — Documented live-`/models` tier field names (or definitive "not exposed" gate that surfaces
  `kind=question`). Redacted raw capture at `.ralph/jobs/codex-context-window-tier-selection/spike/models-raw.json`
  + `spike/findings.md`. No tier values hardcoded.
- **US-002** — `ContextWindowTier { Default, LongContext }` + tier-preset descriptor; `ModelInfo` tier fields
  mirrored into `ModelPreset`; all new fields `#[serde(default, skip_serializing_if=...)]`; deserializes a
  pre-existing `models_cache.json`.
- **US-003** — Parser extracts the US-001 fields on BOTH the bundled-`translate_entry` and synthesized paths;
  absent/invalid/equal maxes ⇒ single-tier. Fixtures: two-tier, single-tier, absent-fields.
- **US-004** — Tier resolves to effective `context_window` (`max_context_window`=full ceiling); tier window
  applied BEFORE the numeric `model_context_window` min-clamp; **stale `long_context` cannot widen a
  single-tier model** (explicit unit test).
- **US-005** — `model_context_tier` at top-level AND profile scope; profile merge in `core/src/config/mod.rs`;
  `deny_unknown_fields` rejection/compat test; `just write-config-schema`; `schema_tests.rs` pass.
- **US-006** — Picker chained after effort (after plan-scope in plan mode), reachable on no-effort/auto path
  after model selection, skipped for single-tier incl. stale-config; Esc-return specified per path; insta
  snapshots for the new popup + single-tier-skip case.
- **US-007** — Tier carried through the enumerated v2 DTOs (see plan.md US-007 for the exact per-struct list),
  applied to the active thread (effect on next turn, no restart); fixtures regenerated via
  `just write-app-server-schema`; `just test -p codex-app-server-protocol` passes.
- **US-008** — `// SANDBOX PATCH:` markers + patch-surface §14 invariant/guard + §15 replant note for every
  upstream-canonical edit; runs strictly after US-007.

## Local gates (impl member; build/release lead-owned)
`cargo check --workspace` → `just test -p codex-tui` → `just test -p codex-models-manager` →
`just test -p codex-app-server-protocol` → `cargo insta` (no pending). Schema regen for config
(`just write-config-schema`) and app-server (`just write-app-server-schema`) when those surfaces change.
