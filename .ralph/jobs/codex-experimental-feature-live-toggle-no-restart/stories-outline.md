# Stories Outline: Codex Experimental Feature Live Toggle No Restart

*Preliminary decomposition from `/plan-with-ralph`. Feed to `/implement-with-ralph --from-plan` for PRD generation.*

## US-001: Anthropic model catalog live refresh

**Description:** As a Codex user, I want accepted `Feature::AnthropicModels` changes in `/experimental` to refresh `/model` immediately so that Claude rows appear or disappear without restarting the TUI.

**Acceptance Criteria:**
- [ ] `GatedModelsManager` responds to Anthropic gate changes after manager construction for all catalog/model-info read methods.
- [ ] After enabling `Feature::AnthropicModels` in `/experimental`, a fixture-backed Claude/chat-completions row appears in `/model` in the same TUI process.
- [ ] After disabling `Feature::AnthropicModels` in `/experimental`, Claude/Anthropic rows disappear from `/model` in the same TUI process.
- [ ] Disabling while the current model is a now-unavailable Claude/Anthropic slug switches the active current-session model to the refreshed catalog default or equivalent safe model, not just the picker catalog.
- [ ] The live catalog refresh runs only after the awaited config write/reload has re-installed the process-global Anthropic gate.
- [ ] Model-provider tests use a flippable injected test gate to prove post-construction behavior without mutating the global Anthropic gate.
- [ ] Defaults, CLI/config enable paths, and restart behavior remain unchanged.
- [ ] New SANDBOX PATCH surfaces are registered in `docs\implementation\patch-surface.md`.
- [ ] `just test -p codex-model-provider` passes.
- [ ] `just test -p codex-tui` passes.

**Dependencies:** None

**Estimated complexity:** large

## US-002: Legacy paste-burst heuristic live toggle

**Description:** As a Codex user, I want accepted `Feature::LegacyPasteBurstHeuristic` changes in `/experimental` to affect the current composer immediately so that I can enable or disable the heuristic without restarting.

**Acceptance Criteria:**
- [ ] `ChatWidget::set_feature_enabled(Feature::LegacyPasteBurstHeuristic, true)` maps to `disable_paste_burst = false` in the active composer.
- [ ] `ChatWidget::set_feature_enabled(Feature::LegacyPasteBurstHeuristic, false)` maps to `disable_paste_burst = true` in the active composer.
- [ ] Disabling the heuristic uses `ChatComposer::set_disable_paste_burst()` so any in-flight burst state is flushed/cleared.
- [ ] Bottom-pane docs remain aligned with the live toggle behavior.
- [ ] `just test -p codex-tui` passes.

**Dependencies:** US-001

**Estimated complexity:** medium

## US-003: User message styling live toggle

**Description:** As a Codex user, I want accepted `Feature::UserMessageStyling` changes in `/experimental` to redraw current-session styling immediately so that the visual toggle takes effect without restarting.

**Acceptance Criteria:**
- [ ] `ChatWidget::set_feature_enabled(Feature::UserMessageStyling, true)` installs the enabled style gate and requests redraw.
- [ ] `ChatWidget::set_feature_enabled(Feature::UserMessageStyling, false)` installs the disabled style gate and requests redraw.
- [ ] Focused tests observe `user_message_style()` and `proposed_plan_style()` output changing after toggling through the widget path.
- [ ] Defaults, startup behavior, and existing style helper tests remain unchanged.
- [ ] `just test -p codex-tui` passes.

**Dependencies:** US-002

**Estimated complexity:** small
