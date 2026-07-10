# Stories Outline: Ralph UI/UX-Judgment Model Routing

*Six-story serial decomposition from D-001. The implementation target is the `ai-developer-toolkit` submodule; parent codexu pointer closeout remains lead-owned.*

## US-001: Add central policy and durable classification

**Description:** As a Ralph workflow author, I want one fail-closed model policy and durable `uiUxJudgment` metadata so that every later execution boundary has an explicit, auditable classification.

**UI/UX judgment:** `not-required`

**Acceptance Criteria:**

- [ ] `plugins/ralph/src/model-routing.mjs` owns the two approved model IDs and validates `required|not-required|mixed`.
- [ ] Missing/invalid classification and executable `mixed` reject.
- [ ] Top-level binary inheritance works; contradictory story metadata rejects.
- [ ] Top-level mixed PRDs require every story to be `required` or `not-required`.
- [ ] `brainstorm.json`, selected-direction frontmatter, plan `ralph-meta`, story outline, `prd.json`, and phase config carry classification.
- [ ] Updating `overviewTaskId` preserves `uiUxJudgment`.
- [ ] Explicit atomic migration handles old PRDs; no silent non-UI default exists.
- [ ] Existing UI/TUI acceptance surfaces are documented and tested as `not-required`.
- [ ] Targeted policy/schema/metadata tests pass.

**Dependencies:** None

**Estimated complexity:** large

## US-002: Route wrappers and the per-story runtime

**Description:** As a Ralph operator, I want wrappers and the iteration loop to resolve exact approved models from classification so that host engine choice cannot silently select the wrong model.

**UI/UX judgment:** `not-required`

**Acceptance Criteria:**

- [ ] Codex `not-required` uses exact `gpt-5.6-sol`.
- [ ] Copilot `not-required` uses exact `gpt-5.6-sol`.
- [ ] Copilot `required` uses exact `claude-opus-4.8`.
- [ ] Codex `required`, missing, invalid, and executable mixed reject before spawn.
- [ ] Mixed PRDs route representative stories by their binary story metadata.
- [ ] Deprecated `claude` normalizes to Copilot before policy resolution.
- [ ] Wrapper model defaults are removed; raw Copilot `--model` is removed or equality-only.
- [ ] Model-unavailable errors never fall back to GPT-5.5, `auto`, or another model.
- [ ] Wrapper and runtime tests pass.

**Dependencies:** US-001

**Estimated complexity:** large

## US-003: Route planning, review, and nested workflows

**Description:** As a Ralph workflow maintainer, I want every lens, reviewer, fixer, and nested workflow to receive the current binary classification so that planning and convergence obey the same policy as implementation.

**UI/UX judgment:** `not-required`

**Acceptance Criteria:**

- [ ] User-facing skills accept/persist/forward `--ui-ux-judgment`.
- [ ] Every wrapper and plugin-owned Task dispatch receives structured classification.
- [ ] Fixed roles use Sol; inherited roles resolve from their target unit.
- [ ] Required workflows skip/reject Codex participation rather than substituting GPT.
- [ ] Whole mixed-container calls resolve a binary dispatch class before execution.
- [ ] New review metadata writes `copilot-primary`.
- [ ] Historical `copilot-opus` metadata remains readable and merge-compatible.
- [ ] Help text uses the canonical acceptance-surface distinction.
- [ ] Planning-engine and re-review tests pass.

**Dependencies:** US-001, US-002

**Estimated complexity:** large

## US-004: Make generation and agent metadata policy-aware

**Description:** As a plugin release engineer, I want source agent metadata and a complete dispatch inventory to generate exact Copilot/Codex artifacts so that routing drift fails during generation rather than at runtime.

**UI/UX judgment:** `not-required`

**Acceptance Criteria:**

- [ ] Every Ralph agent source declares `copilotUiUxJudgment: not-required|inherit`.
- [ ] One generated YAML agent remains per role; Task precedence is relied on only with an explicit regression test.
- [ ] Generated YAML contains only the two approved IDs.
- [ ] Every generated Copilot `task()` call contains explicit model routing.
- [ ] Literal Agent sites, prose delegations, wrappers, Skill dispatches, and emitted Tasks are inventory-covered.
- [ ] New/unregistered/stale inventory sites fail generation.
- [ ] Generated Codex recipes reject inherited required work before spawn.
- [ ] `--target=all --write`, `--target=all --check`, Copilot parity, and Codex generator gates pass.
- [ ] The hand-maintained Copilot implement skill is updated separately and remains parity-clean.

**Dependencies:** US-001, US-003

**Estimated complexity:** large

## US-005: Add regression coverage and migrate active docs

**Description:** As a maintainer, I want a complete routing/migration/literal regression matrix and accurate help so that old models or acceptance-surface misclassification cannot re-enter the plugin.

**UI/UX judgment:** `not-required`

**Acceptance Criteria:**

- [ ] Required/not-required/mixed, inheritance, contradiction, engine compatibility, and migration tests pass.
- [ ] Server/protocol/runtime work tested through an existing UI/TUI resolves to Sol.
- [ ] Actual layout/interaction/presentation judgment resolves to Opus.
- [ ] Generated Task exact-model and YAML-precedence tests pass.
- [ ] Historical `copilot-opus` read compatibility is covered.
- [ ] Active surfaces reject GPT-5.5, GPT-5.4, and Opus 4.7 literals.
- [ ] Immutable historical evidence has only narrow explicit allowlists.
- [ ] Runtime/help/docs/examples and directly affected fixtures describe 5.63.0 policy.
- [ ] Full `node plugins/ralph/tests/run.mjs` passes.

**Dependencies:** US-002, US-003, US-004

**Estimated complexity:** large

## US-006: Ship Ralph 5.63.0 and dogfood installed routing

**Description:** As the release lead, I want synchronized release metadata and real installed-plugin evidence so that consumers receive the policy proven through actual model-selection telemetry.

**UI/UX judgment:** `not-required`

**Acceptance Criteria:**

- [ ] All six plugin/marketplace stamps equal `5.63.0`.
- [ ] `plugins/ralph/CHANGELOG.md`, `plugins/ralph/AGENTS.md`, and toolkit-root `AGENTS.md` document policy, migration, compatibility, and release gates.
- [ ] Targeted tests, generation/parity checks, marketplace policy, and full suite pass.
- [ ] Phase 5a code review/fix convergence is clean.
- [ ] Phase 5b docs review/fix convergence is clean.
- [ ] Installed Copilot not-required flow reports `gpt-5.6-sol` in JSON events/OTel.
- [ ] Installed Copilot required flow reports `claude-opus-4.8`.
- [ ] Installed Codex not-required flow reports `gpt-5.6-sol`.
- [ ] Existing UI/TUI acceptance dogfood remains Sol, and unavailable-model paths show no fallback.
- [ ] The lead merges/pushes toolkit first, then updates codexu's `ai-developer-toolkit` gitlink and root active-version table.

**Dependencies:** US-005

**Estimated complexity:** large
