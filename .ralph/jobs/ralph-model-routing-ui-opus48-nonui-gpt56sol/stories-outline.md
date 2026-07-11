# Stories Outline: Ralph 5.64 Hybrid Model-Routing Convergence

*Seven serial toolkit stories. This replaces the historical 5.63 decomposition. Implementation targets a fresh worktree inside `D:\harness-efforts\codexu\ai-developer-toolkit` created from current `origin/main`; parent codexu closeout is lead-owned and is not a PRD story.*

## US-001: Establish the remote base and central hybrid policy

**Description:** As a Ralph maintainer, I want the released 5.63 category/effort policy extended with strict structured UI/UX judgment so that one source resolves every primary and delegated route without losing Luna or xhigh behavior.

**UI/UX judgment:** `not-required`

**Relevant files:**

- Change: `plugins/ralph/src/model-routing-policy.mjs`
- Reference only: `267e7cd7:plugins/ralph/src/model-routing.mjs`
- Reference only: `267e7cd7:plugins/ralph/scripts/model-routing-inventory.mjs`
- Reference: `plugins/ralph/scripts/generate-copilot-artifacts.mjs`
- Reference: `plugins/ralph/scripts/codex-lowering.mjs`

**Acceptance Criteria:**

- [ ] Implementation starts from current `origin/main` containing `964c36f7`; no local-reference merge/cherry-pick occurs.
- [ ] `model-routing-policy.mjs` is the only model/category/effort/judgment policy source.
- [ ] No `src/model-routing.mjs` or second policy/inventory constant table exists.
- [ ] The normal mappings are Luna medium exploration, Sol xhigh research/design/review/orchestration, and Sol medium implementation/fix/update/refactor.
- [ ] `required` overrides every category to Opus 4.8 high.
- [ ] Primary and delegated purpose are structured; generic roles do not infer purpose from prompt text.
- [ ] Resolution follows purpose -> category assertion -> binary judgment -> override -> engine validation -> explicit model/effort assertions.
- [ ] Missing, invalid, contradictory, and executable `mixed` fail before spawn.
- [ ] `isUiFocusedDelegatedTask`, UI prompt regexes, `actualTask` routing, and heuristic guidance are removed.
- [ ] Correct explicit model/effort assertions pass; mismatches fail.
- [ ] Engine choice cannot alter or fallback the resolved route.
- [ ] Central exact-route unit tests cover the six category/judgment combinations.

**Dependencies:** None

**Estimated complexity:** large

## US-002: Persist classification through schemas and migration

**Description:** As an operator, I want UI/UX judgment and resolved route assertions persisted across every artifact boundary so that mixed work and legacy resumes cannot silently change models.

**UI/UX judgment:** `not-required`

**Relevant files:**

- `plugins/ralph/schemas/prd-schema.json`
- `plugins/ralph/schemas/group-schema.json`
- `plugins/ralph/schemas/job-state-schema.json`
- `plugins/ralph/schemas/review-findings-schema.json`
- `plugins/ralph/src/overview-task-id.mjs`
- `plugins/ralph/src/json-io.mjs`
- `plugins/ralph/src/model-routing-policy.mjs`
- `plugins/ralph/tests/test-overview-task-id.mjs`
- `plugins/ralph/tests/test-model-routing.mjs`

**Acceptance Criteria:**

- [ ] `brainstorm.json`, selected-direction frontmatter, plan `ralph-meta`, story outline, PRD, group, phase config, job state, and findings have the required durable fields.
- [ ] Updating `overviewTaskId` preserves `uiUxJudgment` and other `ralph-meta` keys.
- [ ] Binary parents may be inherited; contradictory children fail.
- [ ] Mixed containers require every executable child/story to be binary.
- [ ] Mixed fan-outs persist a stable site-ID dispatch map rather than one blanket call value.
- [ ] Phase config persists purpose, category, judgment, engine, model, and effort assertions for each executable route.
- [ ] Full-PRD-set aggregation is based only on structured story values.
- [ ] Findings retain enough story/scope metadata to route each fixer/updater.
- [ ] `migrate-prd`, `validate-prd`, and `resolve-prd-set` are provided by the central module.
- [ ] Migration is atomic, preserves unrelated fields, rejects conflicts/unknown/duplicate IDs, and is byte-stable on failure.
- [ ] Autonomous missing metadata fails with actionable commands.
- [ ] Interactive migration asks, previews, persists, re-reads, and validates before spawn.

**Dependencies:** US-001

**Estimated complexity:** large

## US-003: Route primary runtime, wrappers, reviews, and fixers

**Description:** As a Ralph user, I want the selected story and each review/fix scope to resolve an exact model and effort so that UI work reaches Opus and all non-UI roles retain their released category route.

**UI/UX judgment:** `not-required`

**Relevant files:**

- `plugins/ralph/src/ralph.mjs`
- `plugins/ralph/src/codex-exec.mjs`
- `plugins/ralph/src/copilot-exec.mjs`
- `plugins/ralph/src/review-loop.mjs`
- `plugins/ralph/prompts/copilot.md`
- `plugins/ralph/prompts/plan-reviewer.md`
- `plugins/ralph/agents/plan-reviewer.md`
- `plugins/ralph/skills/review-changes/SKILL.md`
- `plugins/ralph/skills/review-plan-with-ralph/SKILL.md`

**Acceptance Criteria:**

- [ ] `ralph.mjs` selects a story before resolving `primaryImplementation`.
- [ ] Primary UI story resolves Opus 4.8 high.
- [ ] Primary non-UI story resolves Sol medium.
- [ ] An existing UI/TUI acceptance surface does not alter a non-UI primary route.
- [ ] Mixed PRDs route each selected story independently.
- [ ] Both wrappers resolve through the central policy; raw model/effort options are equality assertions only.
- [ ] Copilot and Codex host paths receive the same policy-selected route; unavailability fails without fallback/host switching.
- [ ] Whole-diff review is required if any represented story is required; otherwise review is Sol xhigh.
- [ ] Finding-level UI fix uses Opus high; non-UI code fixer/docs updater/refactoring uses Sol medium.
- [ ] New review writes keep canonical `copilot-secondary`.
- [ ] Historical `copilot-opus`, `copilot-primary`, and `claude` records remain readable and dedupe correctly.
- [ ] Runtime, wrapper, planning-engine, and re-review tests pass.

**Dependencies:** US-001, US-002

**Estimated complexity:** large

## US-004: Propagate through authored skills, mixed fan-outs, and resume

**Description:** As a workflow author, I want every brainstorm, plan, PRD, nested Skill, parallel member, and resume boundary to forward structured purpose and judgment so that no child relies on prose or stale defaults.

**UI/UX judgment:** `not-required`

**Relevant files:**

- `plugins/ralph/skills/brainstorm-with-ralph/SKILL.md`
- `plugins/ralph/skills/multi-model-investigate/SKILL.md`
- `plugins/ralph/skills/plan-with-ralph/SKILL.md`
- `plugins/ralph/skills/convert-to-ralph-prd/SKILL.md`
- `plugins/ralph/skills/create-prd/SKILL.md`
- `plugins/ralph/skills/edit-prd/SKILL.md`
- `plugins/ralph/skills/decompose-plan/SKILL.md`
- `plugins/ralph/skills/run-ralph/SKILL.md`
- `plugins/ralph/skills/parallel-ralph/SKILL.md`
- `plugins/ralph/skills/list-jobs/SKILL.md`
- `plugins/ralph/skills/analyze-iteration/SKILL.md`
- `plugins/ralph/skills/implement-with-ralph/SKILL.md`
- `plugins/ralph/skills/prepare-handoff/SKILL.md`

**Acceptance Criteria:**

- [ ] Brainstorm and investigation persist container and per-lens/synthesis values before launch.
- [ ] Repository detection/exploration retains Luna medium when not-required.
- [ ] Planning/research/review/orchestration retains Sol xhigh when not-required.
- [ ] Selected direction, plan metadata, stories outline, and PRD conflict-check rather than overwrite.
- [ ] PRD create/edit/split/add operations maintain valid binary story values.
- [ ] Group decomposition persists container and per-member values.
- [ ] Parallel launch resolves each member PRD independently.
- [ ] `list-jobs` and every resume branch forward persisted classification and revalidate route assertions.
- [ ] Analyze-iteration, Story Doctor, manifest verification, refactoring, Phase 5a, and Phase 5b receive the exact represented scope classification.
- [ ] Every nested Skill/Task/wrapper boundary has a registered site/purpose and binary executable judgment.
- [ ] Autonomous missing metadata fails before any child; interactive migration persists before continuing.
- [ ] No skill instructs an agent to classify from text, files, frameworks, or acceptance surfaces.

**Dependencies:** US-001, US-002, US-003

**Estimated complexity:** large

## US-005: Reconcile generators and regenerate both engine trees

**Description:** As a release engineer, I want one central dispatch registry to drive Copilot and Codex generation so that exact model/effort routing and missing-site drift are mechanically enforced.

**UI/UX judgment:** `not-required`

**Relevant files:**

- `plugins/ralph/src/model-routing-policy.mjs`
- `plugins/ralph/scripts/generate-copilot-artifacts.mjs`
- `plugins/ralph/scripts/codex-lowering.mjs`
- `plugins/ralph/.copilot-plugin/**`
- `plugins/ralph/.codex-plugin/**`
- `plugins/ralph/scripts/check-copilot-parity.mjs`
- `plugins/ralph/parity-exceptions.json`
- `plugins/ralph/tests/test-copilot-generator.sh`
- `plugins/ralph/tests/test-codex-generator.mjs`

**Acceptance Criteria:**

- [ ] Central registry covers agent definitions, literal/prose delegations, Skill dispatches, wrappers, primary runtime, re-review, and hand-maintained Tasks.
- [ ] Generator/lowering modules contain no duplicate model/category/judgment constants or prompt inference.
- [ ] Every generated Copilot Task and Codex v1/v2 spawn has explicit exact model and effort.
- [ ] `agent_type` cannot override explicit Codex model/effort.
- [ ] One generated agent definition remains per role; no UI/non-UI agent duplication.
- [ ] Missing, duplicate, stale, or count-mismatched inventory entries fail.
- [ ] Copilot Task/YAML precedence is tested in both Sol and Opus directions.
- [ ] All generated Codex skills/workflows/agents are regenerated from reconciled sources.
- [ ] All generated Copilot skills/workflows/agents are regenerated.
- [ ] The Copilot `implement-with-ralph` hand fork is manually reconciled under existing parity anchors.
- [ ] `--target=all --write`, `--target=all --check`, Copilot parity, and Codex marketplace-policy gates pass.

**Dependencies:** US-001, US-003, US-004

**Estimated complexity:** large

## US-006: Complete regression, compatibility, and documentation coverage

**Description:** As a maintainer, I want exact routing, migration, compatibility, and no-heuristic tests plus accurate active documentation so that the hybrid contract cannot regress.

**UI/UX judgment:** `not-required`

**Relevant files:**

- `plugins/ralph/tests/test-model-routing.mjs`
- `plugins/ralph/tests/test-ralph.mjs`
- `plugins/ralph/tests/test-{codex,copilot}-exec.mjs`
- `plugins/ralph/tests/test-{codex,copilot}-generator.*`
- `plugins/ralph/tests/test-review-loop*.{mjs,sh}`
- `plugins/ralph/tests/test-copilot-readonly-*.mjs`
- `plugins/ralph/tests/test-copilot-task-model-precedence-live.mjs`
- `plugins/ralph/tests/fixtures/regression-smoke-phase-*/**`
- `plugins/ralph/AGENTS.md`
- `plugins/ralph/docs/model-routing-dogfood.md`
- toolkit-root `AGENTS.md`
- toolkit-root `readme.md`

**Acceptance Criteria:**

- [ ] Exact category/judgment matrix tests cover Luna medium, Sol xhigh, Sol medium, and Opus high.
- [ ] Primary UI, primary non-UI, acceptance-surface non-UI, mixed stories, aggregate review, and finding routes are covered.
- [ ] Missing/invalid/executable-mixed and conflicting purpose/category/model/effort fail.
- [ ] UI-word/file/framework changes cannot change a structured route.
- [ ] Generated inventory and parity tests are exhaustive.
- [ ] Historical `copilot-opus` and `copilot-primary` normalize to canonical `copilot-secondary`.
- [ ] Active docs/help describe central precedence and interactive/autonomous migration.
- [ ] Ralph code/tests/docs do not import, generate, or depend on `plugins/subagent-model-routing`.
- [ ] Manual diff verification shows no task-authored changes to Crews, Ralph Overview, or the generic routing plugin.
- [ ] The full Ralph test suite passes.

**Dependencies:** US-002, US-003, US-004, US-005

**Estimated complexity:** large

## US-007: Prepare Ralph 5.64.0 release and closeout handoff

**Description:** As the release lead, I want synchronized metadata, clean convergence, and an executable installed-dogfood handoff so that 5.64.0 can be released without losing newer remote work.

**UI/UX judgment:** `not-required`

**Relevant files:**

- `.agents/plugins/marketplace.json`
- `.claude-plugin/marketplace.json`
- `.github/plugin/marketplace.json`
- `plugins/ralph/.claude-plugin/plugin.json`
- `plugins/ralph/.codex-plugin/plugin.json`
- `plugins/ralph/.github/plugin/plugin.json`
- `plugins/ralph/CHANGELOG.md`
- `plugins/ralph/AGENTS.md`
- `plugins/ralph/docs/model-routing-dogfood.md`
- Parent closeout reference: codexu `AGENTS.md` and `ai-developer-toolkit` gitlink

**Acceptance Criteria:**

- [ ] All six Ralph stamps equal 5.64.0 and a test enforces parity.
- [ ] Changelog/AGENTS/migration/dogfood docs are current.
- [ ] Crews 3.25.0 and Ralph Overview 2.15.1+ remote changes remain intact.
- [ ] `plugins/subagent-model-routing/**` remains byte-untouched and test-independent.
- [ ] Targeted tests, generation/parity checks, marketplace policy, and full suite pass.
- [ ] Phase 5a code review/fix convergence is clean.
- [ ] Phase 5b docs review/fix convergence is clean.
- [ ] The member commits locally and reports the toolkit SHA/branch, seven-story result, test evidence, and lead dogfood commands without pushing/tagging.
- [ ] Lead handoff requires installed Copilot and Codex telemetry for Luna medium, Sol xhigh, Sol medium, and Opus high routes, including primary UI Opus.
- [ ] Host/model unavailability is fail-closed with no fallback and requires operator decision.
- [ ] Toolkit release verifies `origin` and `gim-home`; the current repository-not-found `personal` remote is recorded but nonblocking unless the operator says otherwise.
- [ ] Parent codexu pointer/version-table update occurs only after installed telemetry and remains lead-owned.
- [ ] The lead-owned handoff calls out that `.ralph-overview/data.json` still has a historical six-story/5.63 `impl` seed and must be refreshed before the implementation member is spawned.

**Dependencies:** US-006

**Estimated complexity:** medium

## Lead-Owned Closeout (not a PRD story)

After US-007 and the implementation commit:

1. Fast-forward and push toolkit `main` to `origin` and `gim-home`.
2. Update the real installed Copilot and Codex plugins.
3. Capture actual child/session model-and-effort telemetry for every route class.
4. Tag/publish only after telemetry succeeds.
5. Update codexu's toolkit gitlink and root active-version table to Ralph 5.64.0.
6. Refresh the overview task's `command.prompts.impl` to the reviewed seven-story 5.64 contract through the canonical data-edit path.
7. Preserve actual current Crews/Overview versions and push required codexu remotes.
