# codex-fork-flags-to-experimental-features-migration findings

## Scope and read-only guard

This investigation was performed read-only against the canonical trees under:

- `D:\harness-efforts\codexu`
- `D:\harness-efforts\codexu\codex`
- `D:\harness-efforts\codexu\codex\external\repos\codex-patched`

The only repository file added by this task is this findings file.

## 1. Experimental-features mechanism: how it works

### Registry shape

Codex's feature system is centralized in `features/src/lib.rs`:

- `Stage` defines the lifecycle classes: `UnderDevelopment`, `Experimental { name, menu_description, announcement }`, `Stable`, `Deprecated`, and `Removed` (`codex/external/repos/codex-patched/codex-rs/features/src/lib.rs:28-45`).
- `Feature` is the enum of all toggles (`.../features/src/lib.rs:75-271`).
- `FeatureSpec` and the `FEATURES` table bind each enum entry to its stable config key, stage, and default (`.../features/src/lib.rs:721-730`, `730-1268`).
- `Feature::key()`, `Feature::stage()`, and `Feature::default_enabled()` resolve metadata from that registry (`.../features/src/lib.rs:273-291`).

Operationally:

- `Stage::Experimental` entries are user-facing beta features: they expose a menu name/description/announcement (`.../features/src/lib.rs:47-72`), appear in the TUI `/experimental` popup because the popup filters on `experimental_menu_name()` / `experimental_menu_description()` (`codex/external/repos/codex-patched/codex-rs/tui/src/chatwidget/settings_popups.rs:248-269`), and are surfaced over app-server as `ExperimentalFeatureStage::Beta` with display metadata (`codex/external/repos/codex-patched/codex-rs/app-server/src/request_processors/catalog_processor.rs:325-350`, `codex/external/repos/codex-patched/codex-rs/app-server-protocol/src/protocol/v2/experimental_feature.rs:24-61`).
- `Stage::UnderDevelopment` entries are enableable but intentionally not exposed in the `/experimental` picker; when explicitly enabled, Codex emits an unstable-feature warning (`codex/external/repos/codex-patched/codex-rs/features/src/lib.rs:1270-1310`, `codex/external/repos/codex-patched/codex-rs/cli/src/main.rs:1712-1725`).
- `Stage::Stable` entries are normal feature flags that remain keyable via config / CLI but are not treated as beta UI features (`codex/external/repos/codex-patched/codex-rs/cli/src/main.rs:888-895`).

### Enable/disable surfaces

There are three canonical enablement surfaces:

1. CLI `--enable <feature>` / `--disable <feature>`, which are translated into `-c features.<name>=true|false` overrides (`codex/external/repos/codex-patched/codex-rs/cli/src/main.rs:787-860`).
2. Direct config overrides like `-c features.<name>=true`, which flow through the regular config loader.
3. `config.toml` `[features]` entries, parsed via `FeaturesToml` (`codex/external/repos/codex-patched/codex-rs/features/src/lib.rs:606-643`).

`Features::from_sources(...)` starts from registry defaults, applies config/profile feature tables, applies legacy aliases / overrides, then normalizes dependencies (`codex/external/repos/codex-patched/codex-rs/features/src/lib.rs:492-528`).

### How to declare a new feature

The declaration recipe is:

1. Add a new `Feature` enum entry (`codex/external/repos/codex-patched/codex-rs/features/src/lib.rs:75-271`).
2. Add a `FeatureSpec` row in `FEATURES` with:
   - canonical key string,
   - stage,
   - `default_enabled` value
   (`.../features/src/lib.rs:721-730`, `730-1268`).
3. If it needs only boolean enablement, nothing else is required in the config schema because `[features]` has a flattened key/value map (`.../features/src/lib.rs:606-617`).
4. If it needs per-feature config, define a config struct that implements `FeatureConfig`, add `Option<FeatureToml<T>>` to `FeaturesToml`, and wire its `.enabled()` into `FeaturesToml::entries()` so it can collapse back into the canonical feature bit (`codex/external/repos/codex-patched/codex-rs/features/src/feature_configs.rs:7-49`, `.../features/src/lib.rs:626-718`).
5. Gate call sites with `config.features.enabled(Feature::YourFeature)` or an equivalent thread/session-scoped `Features` handle (`codex/external/repos/codex-patched/codex-rs/core/src/tasks/mod.rs:921-923`, `codex/external/repos/codex-patched/codex-rs/core/src/session/mcp.rs:362-364`, `codex/external/repos/codex-patched/codex-rs/app-server/src/request_processors/catalog_processor.rs:623-629`).

### Per-feature config example

`multi_agent_v2` is the clearest example of "feature bit + extra config":

- The config schema lives in `MultiAgentV2ConfigToml` and includes `enabled`, `max_concurrent_threads_per_session`, wait timeouts, usage-hint text, etc. (`codex/external/repos/codex-patched/codex-rs/features/src/feature_configs.rs:7-49`).
- `FeaturesToml` exposes it as `multi_agent_v2: Option<FeatureToml<MultiAgentV2ConfigToml>>` (`codex/external/repos/codex-patched/codex-rs/features/src/lib.rs:606-613`).
- `FeaturesToml::entries()` folds the structured config back into the canonical `multi_agent_v2` feature bit (`.../features/src/lib.rs:626-643`).
- The resolved feature then gates behavior and activates the extra config: when enabled, `agent_max_threads` is derived from `max_concurrent_threads_per_session`; otherwise Codex falls back to `agents.max_threads` (`codex/external/repos/codex-patched/codex-rs/core/src/config/mod.rs:3088-3111`).

## 2. Inventory of current fork-divergent flag / toggle surfaces

I found 10 relevant fork-divergent surfaces in the current checked-out tree.

| # | Surface | Current shape | Current default | Classification | Evidence |
|---|---|---|---|---|---|
| 1 | `anthropic_models` | Proper `Feature` entry | off | already on the mechanism | `features/src/lib.rs:131-139`, `960-968` |
| 2 | `managed_hooks` | Proper `Feature` entry | off | already on the mechanism | `features/src/lib.rs:135-139`, `969-978` |
| 3 | `background_process_notification` | Proper `Feature` entry | off | already on the mechanism | `features/src/lib.rs:91-93`, `750-755` |
| 4 | `mcp_server_notifications` | Proper `Feature` entry | off | already on the mechanism | `features/src/lib.rs:200-204`, `1161-1170` |
| 5 | launcher `enable_anthropic` | ad-hoc launcher config bool / env alias | unset = no env override | duplicate alias to #1 | `codex/codex-rs-overlay/codex-copilot-launcher/src/config.rs:3-8`, `19-27`, `68-70`; `src/main.rs:102-120` |
| 6 | `disable_paste_burst` | top-level config bool | off in current tree | ad-hoc config bool | `codex/external/repos/codex-patched/codex-rs/config/src/config_toml.rs:470-473`; `core/src/config/mod.rs:3570-3577` |
| 7 | `style_user_messages` | launcher config bool -> env var | on when unset | ad-hoc config bool | `codex/codex-rs-overlay/codex-copilot-launcher/src/config.rs:16-24`, `68-69`; `src/main.rs:102-112` |
| 8 | `auto_load_claude_md` | launcher config bool -> injected config override | on when unset | ad-hoc config bool | `codex/codex-rs-overlay/codex-copilot-launcher/src/config.rs:16-18`, `68-69`, `116-118`; `src/main.rs:30-31`, `78-90` |
| 9 | Knob A default reasoning level | hardcoded fork behavior | prefer `medium` for Claude/Copilot when available | product behavior knob, not a feature | `codex/external/repos/codex-patched/codex-rs/model-provider/src/copilot_models_endpoint.rs:372-389` |
| 10 | Knob B `model_context_tier` | dedicated config field (`default` / `long_context`) | unset = provider-curated default tier | product setting, not a feature | `codex/external/repos/codex-patched/codex-rs/config/src/config_toml.rs:147-156`; `core/src/config/mod.rs:868-873` |

### Notes by item

#### Already proper `Feature` entries

1. `anthropic_models`
   - Canonical key: `features.anthropic_models`
   - Stage: `Stable`
   - Default: `false`
   - Runtime gate resolves CLI / config / env precedence, then reflects the effective value back into the resolved feature set (`codex/external/repos/codex-patched/codex-rs/model-provider/src/anthropic_gate.rs:1-64`, `core/src/config/mod.rs:2576-2591`).
   - There is still duplicate ad-hoc launcher config (`enable_anthropic`), which is the main cleanup target.

2. `managed_hooks`
   - Canonical key: `features.managed_hooks`
   - Stage: `Stable`
   - Default: `false`
   - Runtime gate resolves CLI / config / env precedence and then gates hook discovery with `skip_managed_hooks: !config.features.enabled(Feature::ManagedHooks)` (`codex/external/repos/codex-patched/codex-rs/hooks/src/managed_gate.rs:1-55`, `core/src/config/mod.rs:2592-2605`, `app-server/src/request_processors/catalog_processor.rs:623-629`).

3. `background_process_notification`
   - Canonical key: `features.background_process_notification`
   - Stage: `UnderDevelopment`
   - Default: `false`
   - Example gate: the task wakeup only runs when the feature is enabled (`codex/external/repos/codex-patched/codex-rs/core/src/tasks/mod.rs:921-923`).

4. `mcp_server_notifications`
   - Canonical key: `features.mcp_server_notifications`
   - Stage: `Experimental`
   - Default: `false`
   - Example gate: the MCP connection manager receives the feature bit explicitly (`codex/external/repos/codex-patched/codex-rs/core/src/session/mcp.rs:362-364`).

#### Ad-hoc bools / aliases

5. launcher `enable_anthropic`
   - This is no longer the source of truth; it only sets / clears `CODEX_ENABLE_ANTHROPIC`, while the canonical runtime feature is already `Feature::AnthropicModels` (`codex/codex-rs-overlay/codex-copilot-launcher/src/main.rs:113-120`; `codex/external/repos/codex-patched/codex-rs/model-provider/src/anthropic_gate.rs:29-64`).
   - This is the clearest duplicate surface to remove.

6. `disable_paste_burst`
   - This is a plain top-level config bool, not a feature key.
   - Important current-state note: in the checked-out tree it resolves with `unwrap_or(false)`, so the current default is upstream-like OFF-for-disable / ON-for-heuristic, not the stale "fork default true" note in older docs (`codex/external/repos/codex-patched/codex-rs/core/src/config/mod.rs:3570-3577`).

7. `style_user_messages`
   - Launcher-owned config bool.
   - Default-on when unset.
   - Propagated via `CODEX_TUI_USER_MESSAGE_STYLE`, not via `Features` (`codex/codex-rs-overlay/codex-copilot-launcher/src/main.rs:102-112`).

8. `auto_load_claude_md`
   - Launcher-owned config bool.
   - Default-on when unset.
   - Implemented by appending `project_doc_fallback_filenames=["CLAUDE.md"]` before `codex-core` starts (`codex/codex-rs-overlay/codex-copilot-launcher/src/config.rs:116-118`; `src/main.rs:30-31`, `78-90`).

#### Product knobs, not feature flags

9. Knob A default reasoning level
   - This is not a config bool or feature bit.
   - It is a fork-local model metadata policy: for Claude/Copilot chat-completions rows, default to `medium` reasoning when available (`codex/external/repos/codex-patched/codex-rs/model-provider/src/copilot_models_endpoint.rs:372-389`).

10. Knob B `model_context_tier`
   - This is an explicit user setting, not a rollout gate.
   - It is already modeled as a named config field with domain values (`default` / `long_context`) and flows through `ConfigToml` / resolved `Config` (`codex/external/repos/codex-patched/codex-rs/config/src/config_toml.rs:147-156`; `core/src/config/mod.rs:868-873`).

## 3. Migration plan

### Standard to apply

Recommended standard:

> New fork-divergent behavior should enter codex through the `Feature` registry, with `default_enabled = false`, a canonical `features.<name>` key, and call-site gates on `config.features.enabled(Feature::X)`.

Stage choice:

- Use `Stage::Experimental` when the behavior is user-testable and should appear in `/experimental`.
- Use `Stage::UnderDevelopment` when the behavior must stay hidden from `/experimental` but still be opt-in for testing.
- Use `Stage::Stable` only after the behavior is mature and intentionally remains a supported opt-in.

Every upstream-canonical change required for these migrations should carry `// SANDBOX PATCH:` markers and a matching `patch-surface.md` registration, as required by `codex/CLAUDE.md`.

### Prioritized migrations

#### Priority 1 - collapse Anthropic onto the existing `Feature`

Do this first because the operator called it out explicitly and most of the work is already done.

- Keep `Feature::AnthropicModels` as the single source of truth (`features/src/lib.rs:960-968`).
- Deprecate and eventually remove launcher `enable_anthropic` from `~/.codex-copilot/config.toml` (`codex/codex-rs-overlay/codex-copilot-launcher/src/config.rs:25-27`, `68-70`).
- Keep `--enable-anthropic` and `CODEX_ENABLE_ANTHROPIC` temporarily as back-compat shims if desired, but document them as aliases to the canonical feature and push users toward:
  - `--enable anthropic_models`
  - `-c features.anthropic_models=true`
  - `[features] anthropic_models = true`

Why first: it delivers the operator's requirement with minimal risk because the feature bit already exists and the runtime gate is already wired end-to-end.

#### Priority 2 - convert `disable_paste_burst` from top-level bool to a `Feature`

Suggested shape:

- New feature key: either `disable_paste_burst` (literal behavior) or a positive-form name like `paste_burst_heuristic`.
- `default_enabled = false`.
- Suggested stage: `Experimental` until the UX is validated.
- Gate the relevant TUI behavior with `config.features.enabled(...)` instead of a bespoke top-level bool.

Rationale:

- Today this is an ad-hoc config bool (`config/src/config_toml.rs:470-473`).
- It is exactly the kind of fork-local behavior toggle the standard is meant to absorb.

#### Priority 3 - convert `style_user_messages` from launcher bool/env to a `Feature`

Suggested shape:

- New feature key: `user_message_styling` (or similar).
- `default_enabled = false`.
- Suggested stage: `Experimental`.
- Replace the launcher env path with a normal feature gate read inside `codex-rs/tui`.

Rationale:

- This is fork-local behavior currently controlled by a launcher-only bool and env var (`codex/codex-rs-overlay/codex-copilot-launcher/src/main.rs:102-112`).
- It should be moved into the same registry as the rest of the runtime behavior toggles.

#### Priority 4 - leave `managed_hooks` on the current mechanism, but trim alias debt only if needed

- `Feature::ManagedHooks` is already correct structurally (`features/src/lib.rs:969-978`).
- No new feature is needed.
- Optional follow-up: decide whether `--enable-managed-hooks` / `CODEX_ENABLE_MANAGED_HOOKS` should remain as compatibility aliases or be reduced over time.

#### Priority 5 - keep `background_process_notification` and `mcp_server_notifications` as-is

- Both are already proper feature-registry entries (`features/src/lib.rs:750-755`, `1161-1170`).
- No migration needed here beyond ensuring patch-surface bookkeeping stays current for fork-added entries like `mcp_server_notifications`.

### Surfaces that should stay as-is

These should not be forced into the feature registry in the same way:

1. `auto_load_claude_md`
   - This is a launcher bootstrap decision that must happen before `codex-core` resolves project-doc fallback config (`codex/codex-rs-overlay/codex-copilot-launcher/src/config.rs:116-118`; `src/main.rs:78-90`).
   - It is not a normal runtime feature gate, so it does not fit cleanly into the existing `Features` pipeline without re-architecting launcher startup.

2. Knob A default reasoning level
   - This is a semantic default-selection policy, not an on/off feature or persisted user rollout gate (`codex/external/repos/codex-patched/codex-rs/model-provider/src/copilot_models_endpoint.rs:372-389`).

3. Knob B `model_context_tier`
   - This is already a first-class product setting with domain values, not a hidden rollout bit (`codex/external/repos/codex-patched/codex-rs/config/src/config_toml.rs:147-156`).

## 4. Recommended implementation slicing

This should be several impls, not one monolith.

Recommended split:

1. `anthropic-feature-surface-cleanup`
   - Remove or deprecate launcher `enable_anthropic`.
   - Keep the existing `Feature::AnthropicModels`.
   - Update docs and tests around the canonical feature path.

2. `paste-burst-feature-migration`
   - Add a proper feature entry.
   - Replace top-level `disable_paste_burst` config wiring.
   - Update TUI docs / tests together.

3. `user-message-styling-feature-migration`
   - Add a proper feature entry.
   - Remove launcher env mediation.
   - Gate styling directly from resolved `Features`.

4. `feature-registry-bookkeeping-refresh`
   - Update `patch-surface.md` / divergence registry to explicitly list which `Feature` entries are fork-added or fork-repurposed (`anthropic_models`, `managed_hooks`, `mcp_server_notifications`, and any new migrations).

I would not bundle all of that into one impl because the surfaces are disjoint (launcher vs config vs TUI) and the operator explicitly wants the feature-standardization rule to be durable, not just a one-off code motion.

## 5. Final recommendation

The standard should be:

- **New fork-divergent behavior:** add a `Feature` enum entry, `default_enabled = false`, canonical `features.<name>` config/CLI surface, and explicit call-site gates.
- **User-testable behavior:** prefer `Stage::Experimental`.
- **Hidden-in-progress behavior:** use `Stage::UnderDevelopment`.
- **Do not use ad-hoc launcher or top-level config bools** for runtime fork behavior unless the decision must happen before `codex-core` config resolution (the `auto_load_claude_md` case).

Priority order:

1. Collapse Anthropic support onto `Feature::AnthropicModels` as the sole source of truth.
2. Migrate `disable_paste_burst` into the feature registry.
3. Migrate `style_user_messages` into the feature registry.
4. Leave `managed_hooks`, `background_process_notification`, and `mcp_server_notifications` structurally as they are.
5. Treat Knob A / Knob B as product settings, not feature flags.

Cross-reference for follow-up bookkeeping: `codex-patch-surface-divergence-registry-refresh` should explicitly record every fork-added / fork-repurposed feature key so rebases can verify them mechanically.
