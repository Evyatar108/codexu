# Implementation Plan: Ralph 5.64 Hybrid Model-Routing Convergence
<!-- ralph-meta {"overviewTaskId":"ralph-model-routing-ui-opus48-nonui-gpt56sol","uiUxJudgment":"not-required"} -->

*Phase-4 convergence plan, 2026-07-11. This replaces the historical 5.63 plan in this job directory. Planning occurred only in `D:\harness-efforts\codexu\.worktrees\plan-ralph-model-routing-v564` on branch `ralph/plan-ralph-model-routing-v564`.*

## Outcome

Release `ralph-orchestration` **5.64.0** by extending the released 5.63 policy rather than merging the divergent local implementation.

The final route is determined from two independent structured inputs:

1. **What the executable unit is doing** (`purpose` -> work category -> normal model and effort).
2. **Whether that exact executable unit requires UI/UX judgment** (`uiUxJudgment`).

The required mapping is:

| Executable purpose/category | `uiUxJudgment` | Exact model | Exact effort |
|---|---|---|---|
| Exploration or repository detection | `not-required` | `gpt-5.6-luna` | `medium` |
| Planning, research, review, or orchestration | `not-required` | `gpt-5.6-sol` | `xhigh` |
| Primary implementation | `not-required` | `gpt-5.6-sol` | `medium` |
| Code fixer, docs updater, refactoring, or other implementation child | `not-required` | `gpt-5.6-sol` | `medium` |
| **Any executable purpose** | `required` | `claude-opus-4.8` | `high` |
| Any executable purpose | missing, invalid, or `mixed` | **Reject before spawn** | n/a |

Therefore a primary UI story is Opus 4.8 high, while a non-UI server/runtime story that happens to be accepted through an existing UI, mobile, desktop, or TUI surface remains Sol medium.

This is non-UI planning and implementation infrastructure. The implementation member, plan/review agents, and Phase 5a/5b reviewers use GPT-5.6 Sol under the normal category-specific effort.

## Worktree and Base Safety

### Planning worktree

- Current plan worktree: `D:\harness-efforts\codexu\.worktrees\plan-ralph-model-routing-v564`
- Current plan branch: `ralph/plan-ralph-model-routing-v564`
- Only the three job artifacts in this directory belong in the plan commit.

### Future implementation worktree

Create the implementation worktree **inside the toolkit repository**, for example:

```powershell
git -C D:\harness-efforts\codexu\ai-developer-toolkit fetch origin
git -C D:\harness-efforts\codexu\ai-developer-toolkit fetch gim-home
git -C D:\harness-efforts\codexu\ai-developer-toolkit worktree add `
  D:\harness-efforts\codexu\ai-developer-toolkit\.worktrees\ralph-model-routing-ui-opus48-nonui-gpt56sol `
  -b ralph/ralph-model-routing-ui-opus48-nonui-gpt56sol origin/main
```

Do not create the implementation branch from the toolkit checkout's local `main`, from the codexu gitlink, or from `267e7cd7`.

### Source refs

| Ref | Role |
|---|---|
| `964c36f7` | Released authoritative convergence base; merge of `37e03c05` and `318a86d0` |
| `37e03c05` | Released Ralph 5.63 category/effort routing |
| `267e7cd7` | Read-only local semantic reference; never merge/cherry-pick wholesale |
| `10fcb5da` | Common ancestor used to compute the exact 88-file overlap |
| `23c88e03` | Crews 3.25.0; must survive |
| `90f578fe` | Ralph Overview 2.15.1; must survive |
| `318a86d0` | Ralph Overview cached-compiler follow-up; must survive |

At implementation start:

1. Require current `origin/main` and `gim-home/main` to contain `964c36f7`.
2. Start from the current `origin/main` descendant, not from the historical SHA if newer remote commits exist.
3. If `origin/main` and `gim-home/main` have diverged, reconcile those released remotes first. Do not use `267e7cd7` to bridge them.
4. Record `git status`, HEAD, the three marketplace versions, and tree hashes for `plugins/crews`, `plugins/ralph-overview`, and `plugins/subagent-model-routing`.
5. Read local-reference code only with `git show 267e7cd7:<path>` or a read-only diff. Never merge, cherry-pick, reset, or replace the remote tree with that commit.
6. Before spawning implementation, the lead must refresh the tracked overview task's historical `command.prompts.impl`, which still says six stories and 5.63.0. That bookkeeping edit is outside this plan-only commit. Until refreshed, this 5.64 plan and its seven-story outline are authoritative.

## Source-Verified Delta

### Released 5.63 strengths to keep

`964c36f7:plugins/ralph/src/model-routing-policy.mjs` already owns the useful category and effort table:

- exploration -> Luna medium;
- research/design/orchestration -> Sol xhigh;
- implementation -> Sol medium;
- UI override -> Opus 4.8 high.

The released generators also emit explicit model and effort for both Copilot `task(...)` and Codex v1/v2 `spawn_agent` recipes, omit role-locked `agent_type` where it can override an explicit route, and test Luna/Sol/Opus routes.

### Released 5.63 gaps to replace

- `isUiFocusedDelegatedTask(actualTask)` and its prompt regexes infer UI work from words such as `react`, `layout`, `style`, and `implement`.
- The override is delegated-only; `policyForPrimaryIteration()` always returns Sol medium.
- The durable artifacts and schemas do not carry `uiUxJudgment`.
- Generated routing guidance tells an agent to inspect prompt text.
- Wrapper model/effort options are permissive rather than policy assertions.

### Local reference semantics to port selectively

`267e7cd7:plugins/ralph/src/model-routing.mjs` provides useful strict behavior:

- exact `required|not-required|mixed` validation;
- executable-`mixed` rejection;
- binary top-level inheritance and contradiction rejection;
- mixed-container per-story requirements;
- atomic PRD migration;
- full-PRD-set review classification;
- durable propagation through brainstorm, plan, PRD, phase config, resume, and nested workflows;
- historical reviewer-ID normalization.

Its architecture and route table are not authoritative:

- it creates a second policy module;
- it collapses all non-UI work to Sol and loses Luna/xhigh distinctions;
- it rejects some engine/model combinations that released 5.63 deliberately emits;
- it introduces duplicate frontmatter/inventory policy values.

Port semantics, not blobs.

## One Central Ralph Policy Source

Extend **`plugins/ralph/src/model-routing-policy.mjs`** as the only Ralph-owned source of:

- model IDs;
- reasoning efforts;
- work categories;
- purpose-to-category mappings;
- agent/site routing registration;
- `uiUxJudgment` values and validation;
- route resolution and assertion rules;
- PRD validation/migration/full-set aggregation;
- CLI output used by skills and wrappers.

Do **not** add or retain `plugins/ralph/src/model-routing.mjs`. Do **not** add a second category table in a generator, skill, agent frontmatter field, test fixture, or inventory module. The local `scripts/model-routing-inventory.mjs` design is also superseded as a policy owner: port useful stable site IDs and source anchors into the central registry, while generator files retain only syntax capture/lowering mechanics.

### Central vocabulary

```text
uiUxJudgment = required | not-required | mixed

workCategory =
  exploration
  researchDesignOrchestration
  implementation

purpose examples =
  repositoryDetection
  exploration
  planning
  research
  review
  orchestration
  primaryImplementation
  codeFix
  docsUpdate
  refactoring
  securityFix
```

Generic roles such as `general-purpose` do not determine purpose from prompt text. Each registered dispatch site supplies a structured purpose. Agent name is only one input to validating the site registration.

### Required central APIs

Names may be adjusted to fit existing style, but one module must provide equivalent behavior:

- `RALPH_MODEL_POLICIES`
- `RALPH_PURPOSE_POLICY`
- `RALPH_AGENT_POLICY`
- `RALPH_DISPATCH_SITE_POLICY`
- `UI_UX_JUDGMENT_VALUES`
- `normalizeUiUxJudgment(value, { allowMixed, fieldName })`
- `categoryForPurpose(purpose)`
- `resolveRalphRoute({ purpose, workCategory, uiUxJudgment, engine, model, reasoningEffort })`
- `policyForGeneratedAgent(agentName)`
- `policyForGeneratedTaskSite(siteId, structuredInput)`
- `resolveStoryUiUxJudgment(prd, story)`
- `validatePrdUiUxJudgment(prd)`
- `resolvePrdSetUiUxJudgment(prds)`
- `migratePrdUiUxJudgment(prd, options)`
- registry/inventory validation helpers used by both generators.

The module remains importable and gains guarded CLI modes:

```text
node plugins/ralph/src/model-routing-policy.mjs resolve ...
node plugins/ralph/src/model-routing-policy.mjs validate-prd --prd <path>
node plugins/ralph/src/model-routing-policy.mjs resolve-prd-set --prd <path>...
node plugins/ralph/src/model-routing-policy.mjs migrate-prd ...
```

### Resolution precedence

For every executable dispatch, resolve in this exact order:

1. **Primary/delegated purpose:** the runtime path or registered dispatch site supplies a structured `purpose`.
2. **Work category:** central policy maps purpose to category. An explicit `workCategory` is an equality assertion against this mapping, never an override.
3. **Durable judgment:** resolve the executable unit's explicit binary `uiUxJudgment`. A binary container may be inherited; a mixed container requires the exact child/story value. Missing, invalid, contradictory, or executable `mixed` fails.
4. **Judgment override:** `required` replaces both the category model and effort with Opus 4.8 high. `not-required` preserves the category's Luna/Sol route and effort.
5. **Engine/host:** normalize and validate the requested host. Engine never selects, downgrades, or upgrades the model. Both released Copilot Task and Codex spawn paths receive the resolved explicit model/effort. If an installed host cannot instantiate the resolved model, fail without fallback or host switching.
6. **Explicit model/effort:** raw `model`, `--model`, `reasoning_effort`, or `--effort` values are final equality assertions. Any mismatch fails before spawn.

Platform precedence is separate: explicit Copilot Task model/effort must override agent YAML registration metadata, and explicit Codex v1/v2 spawn fields must not be defeated by role-locked `agent_type`.

### Removed behavior

Delete:

- `taskText`;
- `UI_CONTEXT`;
- `UI_WORK`;
- `UI_OVERRIDE_TASK_SITES`;
- `isUiFocusedDelegatedTask`;
- all `actualTask`-based category selection;
- generated prose instructing agents to inspect task wording for UI terms.

Tests must prove that changing prompt wording, file paths, frameworks, or acceptance surfaces cannot change a route when structured metadata is unchanged.

## Durable Classification and Route Propagation

### Container versus executable units

- `required` and `not-required` are executable.
- `mixed` is container-only.
- A binary parent may be inherited by its executable children.
- A child that contradicts a binary parent is invalid; mark the parent `mixed` first.
- A mixed parent requires every executable child/story to declare a binary value.
- No engine, model, role name, prompt, file path, or framework fills a missing value.

### Artifact contract

| Artifact/boundary | Durable requirement |
|---|---|
| `brainstorm.json` | Top-level `uiUxJudgment`; mixed brainstorms also persist binary classifications for every executable lens/synthesis dispatch |
| `selected-direction.md` | YAML frontmatter `uiUxJudgment` |
| `plan.md` | Merged `ralph-meta.uiUxJudgment`, preserving `overviewTaskId` and other keys |
| `stories-outline.md` | Binary `UI/UX judgment` for every story |
| `prd.json` | Top-level `uiUxJudgment`; mixed PRDs require binary `userStories[].uiUxJudgment` |
| `group.json` | Container judgment plus per-member/job classification |
| `phase-config.json` | Resolved route envelope for the current executable call and a dispatch map when the phase fans out |
| `job-state.json` | Resume-safe aggregate/full-diff classifications such as `orchestrator.codeUiUxJudgment` |
| review findings | Story/scope association and binary classification sufficient to route each fixer/updater |
| nested Skill/Task/wrapper call | Structured site/purpose plus binary judgment; model/effort emitted from central resolution |

Use a common route-envelope shape where an executable route is persisted:

```json
{
  "siteId": "stable-dispatch-id",
  "purpose": "review",
  "workCategory": "researchDesignOrchestration",
  "uiUxJudgment": "required",
  "engine": "copilot",
  "model": "claude-opus-4.8",
  "reasoningEffort": "high"
}
```

The persisted model and effort are audit assertions. On resume, re-resolution from purpose and judgment must equal them.

### Mixed phase configuration

For a phase that launches more than one executable child, persist:

```json
{
  "uiUxJudgment": "mixed",
  "dispatches": {
    "plan:repo-detection": { "uiUxJudgment": "not-required" },
    "plan:ui-design-review": { "uiUxJudgment": "required" },
    "plan:architecture-synthesis": { "uiUxJudgment": "not-required" }
  }
}
```

Keys are stable central-registry site IDs. Before autonomous launch, every required site must exist and be binary. A single `--call-ui-ux-judgment` value is insufficient for a mixed fan-out unless that invocation truly contains one executable child.

### Primary stories

`src/ralph.mjs` must select the target story first, then resolve:

```text
purpose = primaryImplementation
uiUxJudgment = resolved story value
```

- UI story -> Opus 4.8 high.
- Non-UI story -> Sol medium.
- Mixed PRD -> route each selected story independently.
- A UI acceptance surface does not alter a non-UI story.
- The chosen engine is a host assertion and receives the exact resolved route.

### Review and fixer propagation

- Whole-plan and whole-diff review derives its binary judgment only from represented structured child/story values: any represented `required` unit makes the aggregate review `required`; otherwise it is `not-required`.
- Persist the aggregate before the initial review and reuse it on resume/re-review.
- Findings from mixed work carry story IDs/scope and a binary classification. A finding spanning multiple stories is `required` if any represented story is `required`.
- Code fixer, docs updater, and refactoring dispatches use their exact finding/scope classification. Their non-UI category route remains Sol medium; a UI finding overrides to Opus high.
- New review writes retain the released canonical reviewer ID `copilot-secondary`.
- Readers normalize historical `copilot-opus` and local-reference `copilot-primary` records into `copilot-secondary` before dedupe/merge. Historical `claude` remains readable. New writes never emit the aliases.

### Resume and nested workflows

Port strict propagation through:

- brainstorm -> selected direction -> plan;
- plan -> story outline -> PRD;
- `create-prd`, `edit-prd`, `convert-to-ralph-prd`, and `decompose-plan`;
- `run-ralph`, `parallel-ralph`, and `list-jobs`;
- `implement-with-ralph` Phase 2, Phase 4, Phase 5a, Phase 5b, and resume branches;
- `analyze-iteration`, Story Doctor, manifest verification, and refactoring;
- generated Copilot and Codex Skill dispatches;
- full-diff code review and re-review.

Resume may reconstruct an aggregate from complete durable PRDs/stories, but it may not infer missing classifications. Persist the reconstructed value before spawning.

## Migration and Operator UX

### Autonomous execution

Autonomous/batch execution fails before the first child spawn when:

- a required artifact lacks classification;
- a value is invalid;
- an executable value is `mixed`;
- a mixed container lacks any child/story mapping;
- an explicit purpose/category/model/effort conflicts;
- persisted route assertions no longer match central policy.

The error names the artifact and missing IDs, and prints an exact migration command shape. It never defaults to `not-required`.

### Interactive execution

Interactive skills may repair legacy artifacts, but only by asking and persisting:

> Does this executable work itself require visual, interaction, layout, styling, presentation, or other UI/UX judgment? Choose `required`, `not-required`, or `mixed`. Merely using an existing UI/TUI for acceptance is `not-required`.

Flow:

1. Display the artifact and currently known container/story/dispatch IDs.
2. Ask once for the container value.
3. If `mixed`, require a binary answer for every executable child/story.
4. Show the proposed durable changes.
5. Write atomically through shared policy helpers.
6. Re-read, validate, and only then spawn.

Existing valid metadata is never silently overwritten. A contradictory CLI flag is an assertion failure, not migration permission.

### PRD migrator

```text
node plugins/ralph/src/model-routing-policy.mjs migrate-prd \
  --prd <path> \
  --ui-ux-judgment required|not-required|mixed \
  [--story US-001=required]...
```

The migrator must:

- use atomic JSON writes;
- reject unknown or duplicate story IDs;
- reject story-level `mixed`;
- require every story mapping for mixed;
- preserve unrelated fields and formatting conventions;
- refuse conflicting persisted metadata;
- validate purpose/category/engine/model/effort assertions after migration;
- leave the file byte-identical on any failure.

## Exact 88-File Semantic Matrix

Computed from common base `10fcb5da`:

```powershell
$remote = git diff --name-only 10fcb5da..37e03c05
$local  = git diff --name-only 10fcb5da..267e7cd7
$remote | Where-Object { $local -contains $_ } | Sort-Object
```

Status meanings:

- **KEEP REMOTE**: local delta is unnecessary or conflicts with the released contract.
- **PORT LOCAL**: selectively port the strict semantic behavior; never replace the remote blob.
- **SUPERSEDED**: do not merge either generated/local representation; regenerate or consolidate from the reconciled source.
- **MANUAL RECONCILIATION**: both sides contain load-bearing behavior and require a fresh hybrid edit.

| # | File | Status | 5.64 action |
|---:|---|---|---|
| 01 | `.agents/plugins/marketplace.json` | MANUAL RECONCILIATION | Bump only Ralph to 5.64.0; preserve Crews 3.25.0, Overview 2.15.1+, and all unrelated entries. |
| 02 | `.claude-plugin/marketplace.json` | MANUAL RECONCILIATION | Same six-stamp release rule; retain remote ordering and unrelated plugins. |
| 03 | `.github/plugin/marketplace.json` | MANUAL RECONCILIATION | Same; do not disturb the independent generic routing plugin entry. |
| 04 | `AGENTS.md` | MANUAL RECONCILIATION | Preserve released summaries and newer plugin notes; update only the Ralph 5.64 policy/release entry. |
| 05 | `plugins/ralph/.claude-plugin/plugin.json` | MANUAL RECONCILIATION | Set 5.64.0 without reverting manifest capabilities. |
| 06 | `plugins/ralph/.codex-plugin/agents/dsat-analyst.md` | SUPERSEDED | Regenerate from reconciled authored agent plus central policy. |
| 07 | `plugins/ralph/.codex-plugin/agents/plan-reviewer.md` | SUPERSEDED | Regenerate; do not hand-port local agent metadata. |
| 08 | `plugins/ralph/.codex-plugin/codex-skills/brainstorm-with-ralph/SKILL.md` | SUPERSEDED | Regenerate from authored skill and structured registry. |
| 09 | `plugins/ralph/.codex-plugin/codex-skills/implement-with-ralph/SKILL.md` | SUPERSEDED | Regenerate; retain remote v1/v2 explicit model/effort recipes. |
| 10 | `plugins/ralph/.codex-plugin/codex-skills/multi-model-investigate/SKILL.md` | SUPERSEDED | Regenerate with Luna/Sol/Opus routes and binary child metadata. |
| 11 | `plugins/ralph/.codex-plugin/codex-skills/plan-with-ralph/SKILL.md` | SUPERSEDED | Regenerate after authored convergence. |
| 12 | `plugins/ralph/.codex-plugin/codex-skills/prepare-handoff/SKILL.md` | SUPERSEDED | Regenerate; preserve handoff semantics. |
| 13 | `plugins/ralph/.codex-plugin/internal-workflows/analyze-iteration/SKILL.md` | SUPERSEDED | Regenerate from authored workflow. |
| 14 | `plugins/ralph/.codex-plugin/internal-workflows/convert-to-ralph-prd/SKILL.md` | SUPERSEDED | Regenerate after schema/metadata reconciliation. |
| 15 | `plugins/ralph/.codex-plugin/internal-workflows/create-prd/SKILL.md` | SUPERSEDED | Regenerate with structured route inputs. |
| 16 | `plugins/ralph/.codex-plugin/internal-workflows/decompose-plan/SKILL.md` | SUPERSEDED | Regenerate mixed group/member propagation. |
| 17 | `plugins/ralph/.codex-plugin/internal-workflows/edit-prd/SKILL.md` | SUPERSEDED | Regenerate migration-safe behavior. |
| 18 | `plugins/ralph/.codex-plugin/internal-workflows/list-jobs/SKILL.md` | SUPERSEDED | Regenerate resume forwarding. |
| 19 | `plugins/ralph/.codex-plugin/internal-workflows/parallel-ralph/SKILL.md` | SUPERSEDED | Regenerate per-member routes. |
| 20 | `plugins/ralph/.codex-plugin/internal-workflows/review-changes/SKILL.md` | SUPERSEDED | Regenerate full-diff/finding routes. |
| 21 | `plugins/ralph/.codex-plugin/internal-workflows/run-ralph/SKILL.md` | SUPERSEDED | Regenerate primary story routing instructions. |
| 22 | `plugins/ralph/.codex-plugin/plugin.json` | MANUAL RECONCILIATION | Set 5.64.0 and preserve released manifest structure. |
| 23 | `plugins/ralph/.copilot-plugin/agents/code-fixer.agent.yaml` | SUPERSEDED | Regenerate; Task arguments remain authoritative. |
| 24 | `plugins/ralph/.copilot-plugin/agents/code-reviewer.agent.yaml` | SUPERSEDED | Regenerate central baseline; no duplicated judgment metadata. |
| 25 | `plugins/ralph/.copilot-plugin/agents/criteria-validator.agent.yaml` | SUPERSEDED | Regenerate. |
| 26 | `plugins/ralph/.copilot-plugin/agents/docs-reviewer.agent.yaml` | SUPERSEDED | Regenerate. |
| 27 | `plugins/ralph/.copilot-plugin/agents/docs-updater.agent.yaml` | SUPERSEDED | Regenerate; non-UI baseline Sol medium. |
| 28 | `plugins/ralph/.copilot-plugin/agents/dsat-analyst.agent.yaml` | SUPERSEDED | Regenerate from authored source. |
| 29 | `plugins/ralph/.copilot-plugin/agents/followup-task-gatherer.agent.yaml` | SUPERSEDED | Regenerate. |
| 30 | `plugins/ralph/.copilot-plugin/agents/manifest-verifier.agent.yaml` | SUPERSEDED | Regenerate; dispatch route is explicit. |
| 31 | `plugins/ralph/.copilot-plugin/agents/plan-reviewer.agent.yaml` | SUPERSEDED | Regenerate with Sol xhigh baseline and explicit Task override behavior. |
| 32 | `plugins/ralph/.copilot-plugin/agents/progress-analyst.agent.yaml` | SUPERSEDED | Regenerate. |
| 33 | `plugins/ralph/.copilot-plugin/agents/refactoring-agent.agent.yaml` | SUPERSEDED | Regenerate; non-UI baseline Sol medium, UI route Opus high. |
| 34 | `plugins/ralph/.copilot-plugin/agents/skill-suggester.agent.yaml` | SUPERSEDED | Regenerate. |
| 35 | `plugins/ralph/.copilot-plugin/agents/story-doctor.agent.yaml` | SUPERSEDED | Regenerate; story dispatch supplies structured judgment. |
| 36 | `plugins/ralph/.copilot-plugin/copilot-skills/brainstorm-with-ralph/SKILL.md` | SUPERSEDED | Generated mirror; never hand-merge. |
| 37 | `plugins/ralph/.copilot-plugin/copilot-skills/implement-with-ralph/SKILL.md` | MANUAL RECONCILIATION | Hand-maintained exception: port source semantics and explicit Tasks under parity anchors. |
| 38 | `plugins/ralph/.copilot-plugin/copilot-skills/multi-model-investigate/SKILL.md` | SUPERSEDED | Regenerate. |
| 39 | `plugins/ralph/.copilot-plugin/copilot-skills/plan-with-ralph/SKILL.md` | SUPERSEDED | Regenerate. |
| 40 | `plugins/ralph/.copilot-plugin/copilot-skills/prepare-handoff/SKILL.md` | SUPERSEDED | Regenerate. |
| 41 | `plugins/ralph/.copilot-plugin/internal-workflows/analyze-iteration/SKILL.md` | SUPERSEDED | Regenerate. |
| 42 | `plugins/ralph/.copilot-plugin/internal-workflows/convert-to-ralph-prd/SKILL.md` | SUPERSEDED | Regenerate. |
| 43 | `plugins/ralph/.copilot-plugin/internal-workflows/create-prd/SKILL.md` | SUPERSEDED | Regenerate. |
| 44 | `plugins/ralph/.copilot-plugin/internal-workflows/decompose-plan/SKILL.md` | SUPERSEDED | Regenerate. |
| 45 | `plugins/ralph/.copilot-plugin/internal-workflows/edit-prd/SKILL.md` | SUPERSEDED | Regenerate. |
| 46 | `plugins/ralph/.copilot-plugin/internal-workflows/list-jobs/SKILL.md` | SUPERSEDED | Regenerate. |
| 47 | `plugins/ralph/.copilot-plugin/internal-workflows/parallel-ralph/SKILL.md` | SUPERSEDED | Regenerate. |
| 48 | `plugins/ralph/.copilot-plugin/internal-workflows/review-changes/SKILL.md` | SUPERSEDED | Regenerate. |
| 49 | `plugins/ralph/.copilot-plugin/internal-workflows/run-ralph/SKILL.md` | SUPERSEDED | Regenerate. |
| 50 | `plugins/ralph/.github/plugin/plugin.json` | MANUAL RECONCILIATION | Set 5.64.0 and retain released Copilot plugin wiring. |
| 51 | `plugins/ralph/AGENTS.md` | MANUAL RECONCILIATION | Preserve remote 5.63 categories and all newer notes; document central precedence, migration, and gates. |
| 52 | `plugins/ralph/agents/dsat-analyst.md` | MANUAL RECONCILIATION | Keep remote role/category; update stale fixed-model prose only, without local duplicate frontmatter policy. |
| 53 | `plugins/ralph/agents/plan-reviewer.md` | MANUAL RECONCILIATION | Preserve remote review lanes/effort and port structured route input/fail-closed semantics. |
| 54 | `plugins/ralph/CHANGELOG.md` | MANUAL RECONCILIATION | Prepend 5.64.0; retain all 5.63 and later history. |
| 55 | `plugins/ralph/prompts/copilot.md` | MANUAL RECONCILIATION | Preserve remote dependency-deadlock fix; describe the resolved route rather than fixed Sol. |
| 56 | `plugins/ralph/prompts/plan-reviewer.md` | MANUAL RECONCILIATION | Preserve remote xhigh review category and add structured binary judgment/assertions. |
| 57 | `plugins/ralph/schemas/prd-schema.json` | MANUAL RECONCILIATION | Add durable container/story fields while retaining remote engine/model descriptions. |
| 58 | `plugins/ralph/schemas/review-findings-schema.json` | MANUAL RECONCILIATION | Keep canonical `copilot-secondary`; accept/normalize historical aliases and add finding scope/classification fields. |
| 59 | `plugins/ralph/scripts/codex-lowering.mjs` | MANUAL RECONCILIATION | Keep remote Luna/Sol/xhigh/Opus v1/v2 recipes; replace heuristic guidance with central structured site routes. |
| 60 | `plugins/ralph/scripts/generate-copilot-artifacts.mjs` | MANUAL RECONCILIATION | Keep remote category/effort generation; port complete site coverage without a second policy table. |
| 61 | `plugins/ralph/skills/brainstorm-with-ralph/SKILL.md` | PORT LOCAL | Port durable/mixed lens propagation, but resolve each lens through released purpose/category policy. |
| 62 | `plugins/ralph/skills/convert-to-ralph-prd/SKILL.md` | MANUAL RECONCILIATION | Preserve remote repository-detection Luna route and port strict artifact migration. |
| 63 | `plugins/ralph/skills/implement-with-ralph/SKILL.md` | MANUAL RECONCILIATION | Preserve remote 5.63 flow and Phase 5 behavior; add per-story/full-diff/finding propagation. |
| 64 | `plugins/ralph/skills/multi-model-investigate/SKILL.md` | MANUAL RECONCILIATION | Preserve Luna exploration and Sol xhigh synthesis; add explicit per-lens judgments. |
| 65 | `plugins/ralph/skills/plan-with-ralph/SKILL.md` | MANUAL RECONCILIATION | Preserve remote role efforts and add plan/outline/phase-config durability. |
| 66 | `plugins/ralph/skills/review-changes/SKILL.md` | MANUAL RECONCILIATION | Preserve remote reviewer topology/IDs; add aggregate and per-finding structured routing. |
| 67 | `plugins/ralph/skills/review-plan-with-ralph/SKILL.md` | MANUAL RECONCILIATION | Preserve Sol xhigh normal review and override only explicit required judgment. |
| 68 | `plugins/ralph/skills/run-ralph/SKILL.md` | PORT LOCAL | Port strict resume/PRD assertion, but use the central hybrid primary route. |
| 69 | `plugins/ralph/src/codex-exec.mjs` | MANUAL RECONCILIATION | Keep released explicit Codex model support; make site/purpose/judgment authoritative and raw model/effort equality-only. |
| 70 | `plugins/ralph/src/copilot-exec.mjs` | MANUAL RECONCILIATION | Same for Copilot, retaining read-only/write-allowlist behavior. |
| 71 | `plugins/ralph/src/ralph.mjs` | MANUAL RECONCILIATION | Replace fixed primary Sol route with selected-story structured resolution; preserve remote runtime fixes. |
| 72 | `plugins/ralph/src/review-loop.mjs` | MANUAL RECONCILIATION | Preserve remote reviewer topology and `copilot-secondary`; port strict route persistence and alias normalization. |
| 73 | `plugins/ralph/tests/fixtures/regression-smoke-phase-2/review-loop-plan-fixture.expected-review-log.json` | KEEP REMOTE | Canonical new reviewer remains `copilot-secondary`; test aliases separately. |
| 74 | `plugins/ralph/tests/fixtures/regression-smoke-phase-3/codex-exec-argv.json` | KEEP REMOTE | Remote and local resolved identically; update only if the reconciled CLI contract requires it. |
| 75 | `plugins/ralph/tests/fixtures/regression-smoke-phase-3/copilot-exec-argv.json` | KEEP REMOTE | Same. |
| 76 | `plugins/ralph/tests/fixtures/regression-smoke-phase-4/post-migration-caller-surface.txt` | SUPERSEDED | Regenerate from the final caller surface; never merge stale snapshots. |
| 77 | `plugins/ralph/tests/synthesis-drop-test.sh` | MANUAL RECONCILIATION | Retain canonical remote source IDs and add historical aliases only where reader compatibility requires them. |
| 78 | `plugins/ralph/tests/test-codex-exec.mjs` | MANUAL RECONCILIATION | Preserve explicit model/effort argv coverage; add structured route and mismatch failures. |
| 79 | `plugins/ralph/tests/test-codex-generator.mjs` | MANUAL RECONCILIATION | Preserve released Luna/Sol/xhigh/Opus expectations; replace heuristic tests with metadata matrix/inventory tests. |
| 80 | `plugins/ralph/tests/test-copilot-exec.mjs` | MANUAL RECONCILIATION | Add route assertions without losing remote wrapper/read-only behavior. |
| 81 | `plugins/ralph/tests/test-copilot-generator.sh` | MANUAL RECONCILIATION | Preserve comprehensive 5.63 category/effort checks and add strict structured routing. |
| 82 | `plugins/ralph/tests/test-copilot-readonly-caller-split.mjs` | PORT LOCAL | Keep local prompt coverage/write allowlist/classification checks on top of remote callers. |
| 83 | `plugins/ralph/tests/test-copilot-readonly-guard.mjs` | MANUAL RECONCILIATION | Preserve remote guard behavior and port fail-closed route arguments. |
| 84 | `plugins/ralph/tests/test-ralph.mjs` | MANUAL RECONCILIATION | Preserve remote runtime tests; add primary UI/non-UI/mixed/migration cases. |
| 85 | `plugins/ralph/tests/test-regression-smoke-phase-3.mjs` | MANUAL RECONCILIATION | Update fixtures for structured wrapper assertions without dropping 5.63 coverage. |
| 86 | `plugins/ralph/tests/test-review-loop-planning-engine.sh` | MANUAL RECONCILIATION | Preserve host-lane behavior; assert purpose/judgment/model/effort. |
| 87 | `plugins/ralph/tests/test-review-loop-rereview.sh` | MANUAL RECONCILIATION | Keep `copilot-secondary` blocking semantics and test both historical aliases. |
| 88 | `plugins/ralph/tests/test-review-loop.mjs` | MANUAL RECONCILIATION | Add aggregate/finding/alias behavior while preserving remote retry/topology tests. |

### Decisive non-overlap files

| File/surface | Status | Action |
|---|---|---|
| `plugins/ralph/src/model-routing-policy.mjs` (remote-only) | MANUAL RECONCILIATION | Extend this released module into the sole central source. |
| `plugins/ralph/src/model-routing.mjs` (local-only) | SUPERSEDED | Do not add it; port strict helpers into the released module. |
| `plugins/ralph/scripts/model-routing-inventory.mjs` (local-only) | SUPERSEDED | Port stable site IDs/anchors into the central registry; no second policy module. |
| `plugins/ralph/schemas/group-schema.json` | PORT LOCAL | Add explicit container/member judgment fields; avoid unrelated local-reference edits. |
| `plugins/ralph/schemas/job-state-schema.json` | PORT LOCAL | Add resume-safe route fields; preserve current remote lifecycle descriptions. |
| `plugins/ralph/skills/{analyze-iteration,create-prd,decompose-plan,edit-prd,list-jobs,parallel-ralph,prepare-handoff}/SKILL.md` | PORT LOCAL | Port structured propagation selectively, resolving all routes through the central hybrid policy. |
| `plugins/ralph/tests/test-model-routing.mjs` and routing migration/inventory tests | PORT LOCAL | Adapt assertions to the hybrid category/effort matrix and central module path. |
| `plugins/ralph/docs/model-routing-dogfood.md` | PORT LOCAL | Rewrite for 5.64 and category-specific effort telemetry. |
| `plugins/subagent-model-routing/**` (remote-only) | KEEP REMOTE | Independent generic SessionStart plugin: no edits, imports, generated outputs, tests, or Ralph references. |
| `plugins/crews/**` and `plugins/ralph-overview/**` remote changes | KEEP REMOTE | Preserve exact current remote trees. |

## Implementation Sequence

The seven stories in `stories-outline.md` are serial because they converge on the same Ralph plugin and generated trees.

1. Establish the remote-base guard and central hybrid policy.
2. Add durable artifact/schema/migration contracts.
3. Route primary runtime, wrappers, reviews, and fixers.
4. Propagate through authored skills, mixed fan-outs, nested workflows, and resume.
5. Reconcile generators and regenerate both engine artifact trees.
6. Complete exact regression/compatibility/docs coverage.
7. Prepare the 5.64.0 release and lead-owned closeout handoff.

Generated artifacts are written only after authored sources and the central registry are coherent. Do not fix generated failures by hand except the documented Copilot `implement-with-ralph` hand fork.

## Test and Evidence Matrix

### Central exact-route tests

Test all six category/judgment combinations:

| Category | Judgment | Expected |
|---|---|---|
| exploration | not-required | Luna medium |
| exploration | required | Opus high |
| research/design/orchestration | not-required | Sol xhigh |
| research/design/orchestration | required | Opus high |
| implementation | not-required | Sol medium |
| implementation | required | Opus high |

Also test:

- every primary and delegated purpose maps to its expected category;
- an explicit mismatching category fails;
- correct explicit model/effort assertions pass;
- either mismatching assertion fails before spawn;
- engine changes do not alter model/effort;
- missing/invalid/executable-mixed fails;
- no unavailable-model fallback exists.

### Required behavioral cases

- Primary UI story -> Opus high.
- Primary non-UI story -> Sol medium.
- Server/protocol/runtime story accepted through an existing UI/TUI -> Sol medium.
- UI design/implementation delegated child -> Opus high.
- Non-UI code fixer/docs updater/refactoring -> Sol medium.
- Mixed PRD with UI and non-UI stories routes each independently.
- Mixed phase fan-out missing one child mapping fails.
- Full-diff review containing any required story -> Opus high.
- Non-UI full-diff review -> Sol xhigh.
- UI finding fixer -> Opus high; non-UI finding fixer -> Sol medium.
- Legacy artifact migration is atomic and conflict-safe.
- Resume uses persisted/re-resolved values and rejects stale assertions.

### No-heuristic tests

Use paired payloads with identical structured metadata and radically different prose:

- UI-heavy words with `not-required` stay on the category route.
- No UI words with `required` route to Opus.
- `.tsx`, React, CSS, browser, Android, TUI, screenshot, and acceptance-test references do not affect routing.
- Assert removed regex symbols and `actualTask` routing APIs are absent from active Ralph source and generated artifacts.

### Explicit Task and spawn precedence

- Copilot: opt-in live test declares a conflicting agent YAML model, invokes `task(...)` with explicit policy model/effort, and verifies `tool.execution_start`, `subagent.started`, and `subagent.completed`.
- Run both Sol and Opus cases; include effort telemetry when the CLI exposes it.
- Codex: generated v1/v2 recipes contain explicit model/effort and omit `agent_type`; unit tests pin Luna, Sol medium, Sol xhigh, and Opus high.
- Installed dogfood, not prose or argv alone, is the release evidence.

### Inventory and generation

- Every literal Agent site, prose delegation, Skill dispatch, wrapper launch, primary runtime launch, re-review, and hand-maintained Copilot Task has a stable central site ID and purpose.
- Missing, duplicate, stale, or count-mismatched sites fail generation.
- Generator files contain no model/category/judgment constants.
- `--target=all --write` followed by `--target=all --check` is clean.
- Copilot parity and Codex marketplace-policy gates are clean.
- Generated artifacts contain the exact expected model and effort for every route.
- No generated artifact contains heuristic routing guidance.

### Historical review compatibility

- New writes use `copilot-secondary`.
- Read/dedupe tests cover `copilot-opus`, `copilot-primary`, `copilot-secondary`, and historical `claude`.
- Aliases normalize before finding merge, reviewer success accounting, and schema-backed persistence.
- Existing 5.63 fixtures remain canonical where no migration is required.

### Release metadata and preservation

- Add a test that all six Ralph version stamps equal 5.64.0.
- Do not make Ralph tests import or depend on `plugins/subagent-model-routing`.
- As a release checklist, verify `git diff 964c36f7 -- plugins/crews plugins/ralph-overview plugins/subagent-model-routing` contains no task-authored changes. This is a manual source-control guard, not a cross-plugin test dependency.
- Verify current Crews and Overview versions remain unchanged or advance only through separately released remote commits.

### Existing commands

Run targeted tests during each story, then:

```powershell
node plugins/ralph/scripts/generate-copilot-artifacts.mjs --target=all --write
node plugins/ralph/scripts/generate-copilot-artifacts.mjs --target=all --check
node plugins/ralph/scripts/check-copilot-parity.mjs
node plugins/ralph/tests/test-codex-generator.mjs
bash plugins/ralph/tests/test-copilot-generator.sh
node tools/validate-codex-marketplace-policy.mjs
node plugins/ralph/tests/run.mjs
```

## Documentation and Release Target

Update:

- `plugins/ralph/CHANGELOG.md` with a 5.64.0 entry;
- `plugins/ralph/AGENTS.md` with central precedence, generated/manual boundaries, migration, test gates, and common mistakes;
- toolkit-root `AGENTS.md` and `readme.md` only where active Ralph behavior/version text is stale;
- `plugins/ralph/docs/model-routing-dogfood.md` with installed Copilot/Codex telemetry commands and evidence locations;
- user-facing skill help for classification and migration.

Keep standalone `plugins/subagent-model-routing/**` documentation untouched.

## Phase 5 and Ship Ceremony

### Phase 5a: code review/fix convergence

- Review the complete toolkit diff against this plan, `964c36f7`, `37e03c05`, and the selected semantics from `267e7cd7`.
- Reviewer purpose is `review`, judgment `not-required`: Sol xhigh.
- Code fixers use purpose `codeFix`, judgment `not-required`: Sol medium.
- Repeat until code review is clean. Do not stop at story-pass.
- Verify no task-authored change under Crews, Overview, or the generic routing plugin.

### Phase 5b: docs review/fix convergence

- Review active docs, help, migration commands, generated prose, version stamps, and dogfood instructions.
- Docs reviewer is Sol xhigh; docs updater is Sol medium.
- Repeat until docs review is clean.
- Phase 5c remains disabled.

### Release-ready member handoff

The implementation member commits and reports:

- toolkit commit SHA and topic branch;
- all test/generation results;
- seven-story completion;
- Phase 5a/5b clean state;
- exact six-stamp values;
- remote-preservation diff;
- installed-dogfood commands still awaiting lead execution.

The member does not push, tag, update installed plugins, or edit parent codexu.

### Lead-owned toolkit release and installed dogfood

After review:

1. Fast-forward toolkit `main`.
2. Push and verify `origin/main` and `gim-home/main`.
3. The configured `personal` toolkit remote currently returns repository-not-found. Record the failure, but do not block a verified `origin`/`gim-home` release unless the operator explicitly chooses to repair/require it.
4. Update installed Copilot and Codex plugin copies through their real marketplace/install paths.
5. Verify the installed manifest is 5.64.0; do not dogfood the source checkout.
6. Capture JSONL/OTel/session telemetry under the Ralph job directory for:
   - Copilot exploration -> Luna medium;
   - Copilot non-UI review/orchestration -> Sol xhigh;
   - Copilot non-UI primary implementation -> Sol medium;
   - Copilot primary/delegated UI work -> Opus high;
   - Codex exploration -> Luna medium;
   - Codex non-UI implementation/review -> the matching Sol effort;
   - Codex UI executable dispatch -> Opus high.
7. Verify actual started/completed model and effort fields, not assistant prose.
8. Any host/model unavailability fails closed and blocks 5.64 release completion pending operator decision. Do not substitute another model, change judgment, or silently switch host.
9. Tag/publish according to the normal Ralph release process only after telemetry passes.

### Parent codexu closeout

Only after toolkit release and installed dogfood:

1. Update codexu's `ai-developer-toolkit` gitlink to the released toolkit SHA.
2. Update the root `AGENTS.md` active-plugin table to Ralph 5.64.0 while preserving the actual current Crews and Overview versions.
3. Commit the pointer/table change in codexu with the required Copilot trailer.
4. Push and verify all required codexu remotes.

This parent change is deliberately not a toolkit PRD story; it is a lead-owned cross-repo ceremony.

## Rollback

### Before external release

- Abandon or revert the topic branch.
- Restore generated artifacts only by regenerating from the reverted authored sources.
- Atomic migrator tests must prove failed migrations leave artifacts untouched.

### After toolkit main/marketplace publication

- Do not force-rewrite a published 5.64.0 tag or marketplace version.
- Revert the defective commit and issue a forward patch release (normally 5.64.1).
- Re-run all tests, Phase 5a/5b, installation, and telemetry.
- If codexu already points at the defective SHA, revert its gitlink/version-table commit until the forward fix is proven.

### Policy rollback

If live telemetry disproves an engine route, fail closed and return to the operator. Do not restore prompt regex inference, primary-Sol-for-UI behavior, implicit defaults, or model fallback.

## Common Mistakes

1. Starting implementation from local toolkit `main`, the stale codexu gitlink, or `267e7cd7`.
2. Wholesale merging/cherry-picking the local reference despite 88 overlaps and more than 50 conflicts.
3. Creating both `model-routing-policy.mjs` and `model-routing.mjs`, or duplicating route constants in an inventory/generator.
4. Losing Luna medium exploration or Sol xhigh planning/review effort while porting strict semantics.
5. Leaving primary UI stories on Sol because the released override was delegated-only.
6. Inferring UI from prompt text, touched files, extensions, frameworks, screenshots, or acceptance surfaces.
7. Treating `mixed` as executable or assigning one binary value to every child of a genuinely mixed fan-out.
8. Allowing engine, agent YAML, or raw model/effort flags to override central policy.
9. Reintroducing a Codex-only rejection or fallback without reconciling released explicit model support and live telemetry.
10. Renaming the released `copilot-secondary` reviewer slot instead of normalizing historical aliases.
11. Hand-editing generated Copilot/Codex artifacts or forgetting the Copilot implement-skill hand fork.
12. Coupling Ralph code, generation, tests, or docs to `plugins/subagent-model-routing`.
13. Reverting Crews 3.25.0, Ralph Overview 2.15.1+, or later remote commits through a stale-base merge.
14. Updating fewer than all six Ralph version stamps.
15. Treating the broken `personal` remote as an automatic blocker after `origin` and `gim-home` are verified.
16. Updating the parent codexu pointer before installed Copilot and Codex telemetry passes.
17. Spawning from the stale overview `impl` seed that still names six stories and 5.63.0 instead of this reviewed seven-story 5.64 plan.

## Completion Definition

The task is complete only when:

- all seven toolkit stories pass;
- one central policy module owns all route semantics;
- primary UI and every other required executable route to Opus high;
- non-UI routes retain Luna/Sol category efforts;
- durable mixed-child propagation and migration fail closed;
- both generated trees and the hand-maintained Copilot skill are current;
- exact tests and Phase 5a/5b converge cleanly;
- all six stamps are 5.64.0;
- installed Copilot and Codex telemetry proves the routes;
- `origin` and `gim-home` are verified;
- the parent codexu gitlink/version table is updated by the lead;
- the overview implementation seed is refreshed to the reviewed 5.64/seven-story contract before spawn;
- the independent generic routing plugin and unrelated remote releases remain untouched.
