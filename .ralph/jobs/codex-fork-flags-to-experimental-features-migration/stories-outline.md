# Stories Outline: Migrate fork flags onto codex experimental features

*Preliminary decomposition from `/plan-with-ralph`. Feed to `/implement-with-ralph --from-plan` for PRD generation. Recommended execution: SERIAL (single interlocking codex-submodule change).*

## US-001: Collapse Anthropic enablement onto Feature::AnthropicModels
**Description:** As a fork maintainer, I want Anthropic enablement to flow only through the canonical feature path so the transport gate, model visibility, and persisted defaults cannot diverge.
**Acceptance Criteria:**
- [ ] `Feature::AnthropicModels` remains the only runtime source of truth; launcher `enable_anthropic` no longer independently controls runtime behavior.
- [ ] `model-provider/src/anthropic_gate.rs` no longer treats `CODEX_ENABLE_ANTHROPIC` as parallel runtime authority; any retained compatibility adapter translates into `features.anthropic_models` before config resolution.
- [ ] When Anthropic is disabled, a persisted Claude `config.model` no longer overrides the gate-safe bootstrap default in `tui/src/app.rs`.
- [ ] `just test -p codex-copilot-launcher`, `just test -p codex-model-provider`, and `just test -p codex-core` cover the single-source behavior and persistence bug path.
**Dependencies:** None
**Estimated complexity:** medium

## US-002: Migrate paste-burst opt-in onto a default-off feature
**Description:** As a maintainer, I want the legacy paste-burst heuristic represented by a canonical default-off feature so the heuristic is opt-in without relying on a top-level bespoke config bool.
**Acceptance Criteria:**
- [ ] `features.legacy_paste_burst_heuristic` / `Feature::LegacyPasteBurstHeuristic` is added as `Stage::Experimental` with `default_enabled = false`.
- [ ] Any remaining `disable_paste_burst` config input is a one-release deprecated compatibility alias that maps into the canonical feature path while preserving current call-site meaning.
- [ ] TUI composer wiring reads only the canonical feature-backed value, and `paste_burst.rs` / `chat_composer.rs` docs stay aligned with the resulting behavior.
- [ ] `just test -p codex-core` and `just test -p codex-tui` cover config-resolution semantics and paste-burst behavior.
**Dependencies:** US-001
**Estimated complexity:** medium

## US-003: Migrate Claude-style user-message styling onto a default-off feature
**Description:** As a maintainer, I want Claude-style user-message and proposed-plan styling controlled by a canonical feature so launcher env mediation is no longer the runtime authority.
**Acceptance Criteria:**
- [ ] `features.user_message_styling` / `Feature::UserMessageStyling` is added as `Stage::Experimental` with `default_enabled = false`.
- [ ] `style_user_messages` remains only as a one-release launcher compatibility adapter; runtime styling no longer depends on `CODEX_TUI_USER_MESSAGE_STYLE`.
- [ ] A concrete one-time TUI install seam lets `tui/src/style.rs` shared helpers read the resolved feature-backed value without large-scale call-site replumbing.
- [ ] Transcript, history-cell, proposed-plan, streaming-plan, and composer-visible surfaces have the needed `codex-tui` test/snapshot coverage.
**Dependencies:** US-001
**Estimated complexity:** medium

## US-004: Refresh patch-surface bookkeeping and verification
**Description:** As a maintainer, I want the fork ledger and verification contract updated so future rebases preserve the migrated feature seams instead of restoring stale behavior.
**Acceptance Criteria:**
- [ ] Every upstream-canonical edit introduced by the migration carries `// SANDBOX PATCH:` markers plus matching `patch-surface.md` invariant / replant updates.
- [ ] `codex/CLAUDE.md` and any stale paste-burst or Anthropic guidance are updated so future rebases do not reapply superseded defaults.
- [ ] If config schema-bearing types change, `just write-config-schema` is run and the generated schema is committed.
- [ ] Verification covers `cargo check --workspace`, `just fix -p` for touched crates, targeted `just test -p` runs, and TUI snapshot review/acceptance when user-visible styling changes.
**Dependencies:** US-001, US-002, US-003
**Estimated complexity:** small
