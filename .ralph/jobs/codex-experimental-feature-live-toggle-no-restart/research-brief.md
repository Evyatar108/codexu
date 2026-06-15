# Research Brief: Codex Experimental Feature Live Toggle No Restart

## Researcher Findings

The requested scope is concrete and intentionally narrow: make `Feature::AnthropicModels`, `Feature::LegacyPasteBurstHeuristic`, and `Feature::UserMessageStyling` take effect after `/experimental` acceptance in the current TUI process. Exclude the general hot-reload framework, restart-bound features, and already-live features.

The prior investigation remains accurate and was spot-checked against source. `/experimental` persists changes before calling bespoke TUI live-patch hooks (`codex-rs\tui\src\app\config_persistence.rs:361-507`). `ChatWidget::set_feature_enabled()` is the existing live patch seam (`codex-rs\tui\src\chatwidget\settings.rs:70-132`).

`Feature::AnthropicModels` already updates a process-global atomic gate through config resolution (`codex-rs\core\src\config\mod.rs:2627-2630`; `codex-rs\model-provider\src\anthropic_gate.rs:35-45`). The endpoint reads that gate for cache identity and filtering (`codex-rs\model-provider\src\copilot_models_endpoint.rs:175-183`, `:238-244`, `:253-276`). The missing live pieces are the captured `GatedModelsManager` bool (`codex-rs\model-provider\src\copilot.rs:123-129`, `:141-148`; `codex-rs\model-provider\src\copilot\gated_models_manager.rs:17-44`, `:57-90`) and TUI's bootstrap-only model catalog (`codex-rs\tui\src\app_server_session.rs:237-263`; `codex-rs\tui\src\app.rs:754-795`; `codex-rs\tui\src\model_catalog.rs:4-16`; `codex-rs\tui\src\chatwidget\model_popups.rs:20-30`).

`Feature::LegacyPasteBurstHeuristic` already derives startup config as `disable_paste_burst = !features.enabled(...)` (`codex-rs\core\src\config\mod.rs:2631-2633`) and passes it to `BottomPane::new()` at construction (`codex-rs\tui\src\chatwidget\constructor.rs:100-107`). The composer has a safe live setter (`codex-rs\tui\src\bottom_pane\chat_composer.rs:922-949`), but `BottomPane` lacks a passthrough and `set_feature_enabled()` lacks a branch.

`Feature::UserMessageStyling` installs the style gate during construction (`codex-rs\tui\src\chatwidget\constructor.rs:37-40`). The gate is atomic and style helpers read it (`codex-rs\tui\src\style.rs:56-83`), but there is no live branch in `set_feature_enabled()`.

## Architect Analysis

Use the existing fork seams. The Anthropic live path should avoid core/session feature re-derive and avoid adding an app-server protocol method. Instead, make the fork-specific gated manager live-readable and add a TUI refresh helper that reuses the existing `model/list` bootstrap request shape.

The paste and styling features are TUI-only and should remain simple branches in `ChatWidget::set_feature_enabled()`. They should not share abstractions with Anthropic beyond the existing handler because that would drift toward the excluded general framework.

The impl should be direct in `D:\harness-efforts\codexu\codex\external\repos\codex-patched` on a fresh post-.9 branch, not a codex inner worktree.

Phase-4 critique validated the plan's core mechanism and added three US-001 clarifications: production `GatedModelsManager` must read the global `anthropic_models_resolved()` gate after the awaited config write re-installs it; tests should use a flippable injected gate rather than the global gate; and disabling Anthropic while Claude is active must update the active model, not only the picker catalog.

## Codex Research

Not run as a separate external Codex lens in this member turn. The plan uses the committed read-only investigation as the source of truth and validates its file:line claims directly against the local source.

## Copilot Research

Not run as a separate external Copilot lens in this member turn. The planning member validated source seams directly and used a Phase-4 plan critique pass before finalizing.

## Consolidated File List

### Files to modify

- `codex-rs\model-provider\src\copilot\gated_models_manager.rs`
- `codex-rs\model-provider\src\copilot.rs`
- `codex-rs\tui\src\app_server_session.rs`
- `codex-rs\tui\src\app\config_persistence.rs`
- `codex-rs\tui\src\chatwidget\settings.rs`
- `codex-rs\tui\src\chatwidget\model_popups.rs`
- `codex-rs\tui\src\bottom_pane\mod.rs`
- `codex-rs\tui\src\bottom_pane\chat_composer.rs`
- `codex-rs\tui\src\style.rs`
- `codex-rs\tui\src\app\tests.rs`
- `codex-rs\tui\src\chatwidget\tests\popups_and_settings.rs`
- `codex\external\repos\codex-patched\docs\implementation\patch-surface.md`

### Test/build commands

- From `D:\harness-efforts\codexu\codex\external\repos\codex-patched\codex-rs`: `just fmt`
- `just test -p codex-model-provider`
- `just test -p codex-tui`
- `cargo check --workspace` if shared interfaces changed or as the standard codex Phase-5a gate
