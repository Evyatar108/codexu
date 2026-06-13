# Research Brief

## Researcher Findings

The migration is centered on consolidating three fork-divergent toggle surfaces onto the canonical
feature registry. `Feature::AnthropicModels` already exists and is the correct runtime source of
truth; the main cleanup is removing the launcher-local `enable_anthropic` path as an independent
control surface while preserving any intended compatibility affordances. The two real migrations are
`disable_paste_burst` (currently a top-level config bool) and `style_user_messages` (currently a
launcher config/env-mediated TUI toggle).

Relevant files and roles:

- `codex/codex-rs-overlay/codex-copilot-launcher/src/config.rs` - launcher-owned config fields
  including `style_user_messages` and `enable_anthropic`.
- `codex/codex-rs-overlay/codex-copilot-launcher/src/main.rs` - launcher env mediation for
  `CODEX_ENABLE_ANTHROPIC` and `CODEX_TUI_USER_MESSAGE_STYLE`.
- `codex/external/repos/codex-patched/codex-rs/features/src/lib.rs` - `Stage`, `Feature`,
  `FeatureSpec`, and default-enabled registry.
- `codex/external/repos/codex-patched/codex-rs/features/src/feature_configs.rs` - prior art for
  feature-bit plus optional structured config.
- `codex/external/repos/codex-patched/codex-rs/core/src/config/mod.rs` - resolved feature wiring
  and the current `disable_paste_burst` runtime value.
- `codex/external/repos/codex-patched/codex-rs/config/src/config_toml.rs` - top-level
  `disable_paste_burst` input surface.
- `codex/external/repos/codex-patched/codex-rs/tui/src/style.rs` - user-message styling gate via
  `CODEX_TUI_USER_MESSAGE_STYLE`.
- `codex/external/repos/codex-patched/codex-rs/tui/src/chatwidget/constructor.rs` and
  `tui/src/public_widgets/composer_input.rs` - consumers of the paste-burst setting.
- `codex/external/repos/codex-patched/codex-rs/tui/src/bottom_pane/paste_burst.rs` - heuristic
  state-machine docs and behavior that must stay in sync if semantics change.
- `codex/docs/implementation/patch-surface.md` - required SANDBOX PATCH registry target.

Reusable patterns / prior art:

- Feature registration pattern: `features/src/lib.rs` plus `config.features.enabled(Feature::X)`.
- Structured per-feature config pattern: `MultiAgentV2ConfigToml` in
  `features/src/feature_configs.rs`.
- Existing resolved-feature collapse for launcher/env aliases: the Anthropic and managed-hooks
  blocks in `core/src/config/mod.rs`.
- SANDBOX PATCH bookkeeping: every upstream-canonical edit must carry markers plus
  `patch-surface.md` invariant / replant updates.

Test / verification surfaces:

- `just test -p codex-copilot-launcher`
- `just test -p codex-model-provider`
- `just test -p codex-core`
- `just test -p codex-tui`
- `cargo check --workspace`
- `just write-config-schema` if config schema types change
- TUI snapshot review / acceptance if styling-visible output changes

Risks / unknowns:

- Anthropic persistence bug: launcher env mediation can diverge from `Feature::AnthropicModels`.
- Paste-burst naming and compatibility strategy: the product direction is "legacy heuristic opt-in"
  with default-off feature semantics, which does not map cleanly to the current negative
  `disable_paste_burst` key.
- `style_user_messages` currently defaults on, while the requested feature mechanism requires a
  default-off registry entry; the migration must make that behavior flip explicit.

## Architect Analysis

Architecture summary:

- The feature registry in `codex/.../features/src/lib.rs` is the canonical home for fork-divergent
  runtime behavior. New migrated behaviors should become `features.<name>` entries with
  `default_enabled = false`.
- The migration naturally splits into:
  1. registry / config-resolution changes,
  2. launcher compatibility cleanup,
  3. runtime call-site migration,
  4. patch-surface bookkeeping.

Integration points:

- `features/src/lib.rs` - add any new `Feature` enum rows and `FeatureSpec` entries.
- `core/src/config/mod.rs` - collapse legacy config / launcher inputs into resolved features.
- `config/src/config_toml.rs` - retire or compatibility-bridge the top-level
  `disable_paste_burst` field.
- `codex-rs-overlay/codex-copilot-launcher/src/config.rs` and `src/main.rs` - remove direct
  runtime env ownership for Anthropic and user-message styling.
- `tui/src/style.rs` - replace env-based styling gate with feature-based gate.
- `tui/src/chatwidget/constructor.rs` and `tui/src/public_widgets/composer_input.rs` - update
  paste-burst wiring so TUI behavior reads the canonical feature-backed config path.
- `docs/implementation/patch-surface.md` - register every upstream-canonical seam change.

Constraints and sequencing:

- Anthropic comes first because the canonical feature already exists, so the job is to remove the
  second source of truth.
- Paste-burst should be modeled as a default-off legacy-opt-in feature, coordinated with
  `codex-paste-guard-perf-and-dropped-text`.
- `managed_hooks`, `background_process_notification`, and `mcp_server_notifications` should stay
  structurally unchanged.
- Knob A / Knob B stay out of scope.

Recommended slicing:

1. Anthropic single-source cleanup.
2. Paste-burst feature migration.
3. User-message styling feature migration.
4. Patch-surface / divergence-registry refresh.

## Codex Research

The Codex research pass completed late but added one important completeness finding and two concrete
implementation suggestions:

- Anthropic persistence is not only a launcher/env problem. `tui/src/app.rs` accepts
  `bootstrap.default_model` and then overwrites it with persisted `config.model`, which can
  reselect a hidden Claude slug after the gate-filtered bootstrap chose a safe default.
- The Anthropic migration therefore needs to include the persisted-model fallback path alongside
  `model-provider/src/anthropic_gate.rs`, `model-provider/src/copilot/gated_models_manager.rs`, and
  `core/src/chat_transport.rs`.
- For paste burst, Codex suggested a positive-form legacy name such as
  `legacy_paste_burst_heuristic`, with resolved config semantics expressed as
  `Config.disable_paste_burst = !features.enabled(...)`.
- For styling, Codex confirmed the compatibility path should translate launcher
  `style_user_messages` into the canonical feature rather than keeping env-based runtime reads.

## Copilot Research

Copilot's research completed with a usable final analysis. It confirms the same three active
migration surfaces and adds two useful implementation insights:

- Anthropic should be handled first because the feature bit already exists and the bug is caused by
  launcher-local `enable_anthropic` still setting `CODEX_ENABLE_ANTHROPIC` independently of the
  canonical feature path.
- Paste-burst and styling migrations should be framed as canonical feature moves with compatibility
  handling layered on top, not as launcher/env-first behavior.

Additional relevant files / seams called out by the Copilot pass:

- `codex/external/repos/codex-patched/codex-rs/model-provider/src/anthropic_gate.rs` - current
  Anthropic config/flag/env collapse point.
- `codex/external/repos/codex-patched/codex-rs/cli/src/main.rs` - `--enable-anthropic` already
  folds into `features.anthropic_models=true`.
- `codex/external/repos/codex-patched/codex-rs/tui/src/bottom_pane/mod.rs` and
  `tui/src/bottom_pane/chat_composer.rs` - additional paste-burst wiring / state-machine surfaces.

It also confirmed a key source-of-truth constraint: the current source resolves
`disable_paste_burst` with `unwrap_or(false)`, so any stale docs claiming a default of `true`
should be treated as drift that this migration must reconcile.

## Consolidated File List

### Files to modify

- `codex/codex-rs-overlay/codex-copilot-launcher/src/config.rs`
- `codex/codex-rs-overlay/codex-copilot-launcher/src/main.rs`
- `codex/external/repos/codex-patched/codex-rs/features/src/lib.rs`
- `codex/external/repos/codex-patched/codex-rs/core/src/config/mod.rs`
- `codex/external/repos/codex-patched/codex-rs/config/src/config_toml.rs`
- `codex/external/repos/codex-patched/codex-rs/tui/src/style.rs`
- `codex/external/repos/codex-patched/codex-rs/tui/src/chatwidget/constructor.rs`
- `codex/external/repos/codex-patched/codex-rs/tui/src/public_widgets/composer_input.rs`
- `codex/external/repos/codex-patched/codex-rs/tui/src/bottom_pane/paste_burst.rs`
- `codex/docs/implementation/patch-surface.md`

### Dependencies / prior-art seams

- `codex/external/repos/codex-patched/codex-rs/features/src/feature_configs.rs`
- `codex/external/repos/codex-patched/codex-rs/model-provider/src/anthropic_gate.rs`
- `codex/external/repos/codex-patched/codex-rs/core/src/config/config_tests.rs`
- `codex/external/repos/codex-patched/codex-rs/tui/src/style.rs`
- `codex/external/repos/codex-patched/codex-rs/tui/src/bottom_pane/mod.rs`
- `codex/external/repos/codex-patched/codex-rs/tui/src/app.rs`
- `codex/external/repos/codex-patched/codex-rs/model-provider/src/copilot/gated_models_manager.rs`
- `codex/external/repos/codex-patched/codex-rs/core/src/chat_transport.rs`

### Test / verification files

- `codex/external/repos/codex-patched/codex-rs/core/src/config/config_tests.rs`
- existing launcher tests under `codex/codex-rs-overlay/codex-copilot-launcher/`
- existing TUI tests / snapshots under `codex/external/repos/codex-patched/codex-rs/tui/`

### Notes

- The plan worktree was created without submodule initialization, so source verification for the
  codex submodule was performed against the primary checkout at `D:\harness-efforts\codexu\codex`
  while the deliverables continue to land under the plan worktree.
