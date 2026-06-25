# Stories Outline: Verify-and-harden the Anthropic model / gate desync (D-001)

*Preliminary decomposition from `/plan-with-ralph`. Feed to `/implement-with-ralph --from-plan` for PRD generation.*

*Target repo: codex submodule `codex/external/repos/codex-patched/codex-rs` @ `0.141.0-copilot-api.3`.*

## US-001: Production-wrap + resolution-chain locking regression test
**Description:** As a fork maintainer, I want a regression test that reproduces the operator's gate-OFF + persisted-Anthropic-model scenario through the production model-manager wrap and the real session-startup resolution sequence, so a future refactor cannot silently reintroduce the desync (a Claude slug reaching the `/responses` request).
**Acceptance Criteria:**
- [ ] `model-provider/Cargo.toml [dev-dependencies]` gains `serial_test = { workspace = true }` BEFORE the tests are written (it is a workspace dep but not yet a `model-provider` dev-dep, so `#[serial_test::serial]` would otherwise not compile).
- [ ] A new test in the `model-provider` crate constructs a `CopilotModelProvider` (`CopilotModelProvider::new(...)`, `copilot.rs:64`) and calls `models_manager(codex_home, Some(catalog))` with a 2-entry catalog ordered so `gpt-5.5` (`ModelWireRoute::ProviderDefault`) is FIRST/surviving + `claude-opus-4.8` (`ModelWireRoute::ChatCompletions`) second. Note: `ModelInfo` has NO `is_default` field — defaulting is derived at the `ModelPreset` level (`default_model_from_presets` finds `ModelPreset.is_default` else `.first()`); mirror the existing helper at `gated_models_manager.rs:259-272`.
- [ ] With the process-global gate OFF (`install_anthropic_gate(false)` at the START), the test replicates `core/src/session/mod.rs:564-573`: `let model = mgr.get_default_model(&Some("claude-opus-4.8".into()), RefreshStrategy::Offline).await;` then `let info = mgr.get_model_info(&model, &ModelsManagerConfig::default()).await;`.
- [ ] Asserts `model == "gpt-5.5"` (the non-Anthropic fallback) AND `info.slug == "gpt-5.5"` AND `info.wire_route == ModelWireRoute::ProviderDefault` (so `effective_wire_api_gated` routes to a valid Responses request, not a Claude slug).
- [ ] Test is annotated `#[serial_test::serial]` and calls `install_anthropic_gate(false)` at BOTH start and end, with minimal code between set and assert.
- [ ] The existing `cache_identity_tracks_resolved_anthropic_gate` test (`copilot_models_endpoint.rs:582-604`), which flips the global gate, is also marked `#[serial_test::serial]` so it cannot race the new tests.
- [ ] Test asserts the **production** `GatedModelsManager::wrap` / `AnthropicGate::Global` path (NOT the per-instance `wrap_with_test_gate`), distinguishing it from the existing `off_replaces_inherited_…` decorator tests.
- [ ] `just test -p codex-model-provider` passes; `just fmt` clean; no new `pub` API surface added. (If `Cargo.lock` changes, run `just bazel-lock-update` + `just bazel-lock-check`.)
- [ ] Typecheck passes (`cargo check --workspace` green).
**Dependencies:** None
**Estimated complexity:** small–medium

## US-002: Production `models_manager()` wrap-guard test
**Description:** As a fork maintainer, I want a guard that the single production model-manager construction site keeps wrapping with `GatedModelsManager`, so a refactor that passes a raw `SharedModelsManager` (the highest-risk regression) is caught.
**Acceptance Criteria:**
- [ ] A new `model-provider` test asserts that, with the gate OFF, the config-catalog branch of `CopilotModelProvider::models_manager(Some(catalog))` (`copilot.rs:120-127`) filters the Claude entry out of `list_models(RefreshStrategy::Offline)` and `try_list_models()` (only `gpt-5.5` remains). `#[serial_test::serial]`; `install_anthropic_gate(false)` at start and end.
- [ ] A static guard is added to `codex/scripts/audit_invariants.sh` (new `check_*` registered in the runner, using the existing `require_file_pattern`/`grep -c` style at `audit_invariants.sh:40-48`) that FAILS if `model-provider/src/copilot.rs` stops containing ≥ 2 `GatedModelsManager::wrap(` occurrences — i.e. if either wrap site (`copilot.rs:123` config-catalog OR `:140` live `/models`) is dropped. This guards the network-bound online branch testably, not just via a comment.
- [ ] `bash codex/scripts/audit_invariants.sh` exits 0 on the current tree and exits non-zero in a local experiment where one wrap site is removed.
- [ ] `just test -p codex-model-provider` passes; `just fmt` clean.
- [ ] Typecheck passes.
**Dependencies:** US-001 (same test module; land together)
**Estimated complexity:** small

## US-003: Patch-surface Invariant 39 ledger update + verify note
**Description:** As a fork maintainer, I want the patch-surface invariant ledger to name the new enforcing tests and record the verify finding, so the invariant↔test mapping (fork tenant #3) stays accurate for the next rebase.
**Acceptance Criteria:**
- [ ] `codex/docs/implementation/patch-surface.md` Invariant 39 (`:877`) enforcing-test column lists the US-001 and US-002 test names AND the new `scripts/audit_invariants.sh` wrap-site check as the enforcing mechanism.
- [ ] A one-line verify note records that on `0.141.0-copilot-api.3` the gate-off + persisted-Anthropic-model desync is closed via the `get_default_model`/`get_model_info` reversion (`gated_models_manager.rs:142-180`) consumed at `session/mod.rs:564-573` → `client.rs:814-815`.
- [ ] No contradictory or duplicated ledger rows introduced; the section remains internally consistent.
- [ ] Doc-only change (no code); not lint/test gated, but verify the markdown renders and references resolve.
**Dependencies:** US-001, US-002 (the ledger names those tests + the audit check)
**Estimated complexity:** small

## US-004: Cold-start + exec advisory for gate-off Anthropic-model reversion (DEFERRED / out of default scope)
**Status:** DEFERRED — NOT part of the default verify-and-harden ship (US-001+US-002+US-003). Do NOT implement unless the operator explicitly opts in; otherwise file as a separate follow-up task.
**Description:** As a user who persisted a Claude model and started without `--enable-anthropic`, I want a one-time message telling me the model was switched to a default because Anthropic is disabled (and how to re-enable), so I am not silently running on a different model than `config.toml` shows.
**Acceptance Criteria:**
- [ ] On TUI cold start, when `bootstrap_default_model` (`tui/src/app_server_session.rs:1260`) reverts a configured Anthropic model because the gate is off, surface a one-time info message mirroring the live-toggle wording at `tui/src/chatwidget/settings.rs:237-240` ("Model changed to {x} because the previous model is no longer available.") plus how to re-enable (`--enable-anthropic` / persistent `features.anthropic_models = true`).
- [ ] On exec/headless, emit a `WarningEvent` for the same condition (pattern: `core/src/session/turn_context.rs::maybe_emit_unknown_model_warning_for_turn`, `:854`). The advisory MUST compare the resolved model against `config.model` explicitly — `used_fallback_model_metadata` is laundered to `false` by the two-step session-startup resolution, so it cannot be the trigger.
- [ ] `config.toml::model` is left unchanged on disk (preference preserved; re-enabling restores Claude).
- [ ] A TUI `insta` snapshot covers the cold-start message; a core unit/integration test covers the exec `WarningEvent`.
- [ ] `just test -p codex-tui` + `just test -p codex-core` pass; snapshots reviewed/accepted; `just fmt` clean.
- [ ] Typecheck passes.
**Dependencies:** US-001 (ship verify/harden first); otherwise independent
**Estimated complexity:** medium
