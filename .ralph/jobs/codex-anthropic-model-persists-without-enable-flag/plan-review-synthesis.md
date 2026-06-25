# Phase-4 plan review — synthesis

Reviewers: **Claude (rubber-duck)** + **Codex** (`codex-exec`, effort high). Both reviewed
the draft `plan.md` against the codex-rs source.

## Consensus (both reviewers)

- **F-001 [High] `serial_test` not a `model-provider` dev-dep.** It is defined at the
  codex-rs workspace root (`Cargo.toml:417`) and used by `core`/`app-server`/`tui`, but
  `model-provider/Cargo.toml:42-46` does NOT list it. `#[serial_test::serial]` tests would
  not compile. → Plan now requires adding `serial_test = { workspace = true }` first
  (US-001 AC + ordering note + Cargo.lock/Bazel nuance).
- **F-002 [Medium] Global-gate set-at-start + serialize the existing test.** New tests must
  `install_anthropic_gate(false)` at start AND end; the existing un-serialized
  `cache_identity_tracks_resolved_anthropic_gate` (`copilot_models_endpoint.rs:582-604`)
  flips the global gate and must also be `#[serial]`. → Folded into US-001 ACs + Risk.
- **F-006 [Medium] US-004 ambiguous include/defer.** → US-004 relabeled **DEFERRED**;
  default impl scope is US-001+US-002+US-003 only.

## Codex-specific

- **F-003 [High] US-002 online-branch coverage too weak.** A comment/ledger note does not
  guard `copilot.rs:140`. → US-002 now requires a `check_*` in
  `codex/scripts/audit_invariants.sh` that fails if either wrap site stops returning
  `GatedModelsManager::wrap(...)` (≥ 2 occurrences in `copilot.rs`); AC made concrete.
- **F-004 [Medium] Nested-repo commit layering under-specified.** → Added a
  "Commit & ship layering" subsection (inner submodule → codex wrapper → codexu pointer).
- **F-005 [Medium] Invariant 39 update should name the enforcing mechanism.** → US-003 AC
  references `audit_invariants.sh` + `patch-surface.md:877`.

## Rubber-duck-specific

- **F-007 [Low] US-001 is a model-provider lock, not a session/request-boundary lock.** A
  future session refactor using `config.model` directly would still pass US-001/US-002; the
  full session→`/responses` body test is blocked on the removed Copilot fixture
  (`codex-rebase-debt-fix-client-copilot-fixture`). → Documented in Risk + Open Questions;
  an optional core-level handoff guard is offered, not required.
- **F-008 [Medium] `ModelInfo` has no `is_default` field.** Defaulting is derived at the
  `ModelPreset` level (`default_model_from_presets` → `.first()`). → Catalog ACs reworded to
  "gpt-5.5 first/surviving entry".

## Disposition

All 8 findings adopted and applied to `plan.md` + `stories-outline.md` (see
`plan-review-findings.json`, all `status: "resolved"`). No critical divergences between
reviewers. The verify-and-harden core (US-001–US-003) is unblocked; US-004 is deferred.
