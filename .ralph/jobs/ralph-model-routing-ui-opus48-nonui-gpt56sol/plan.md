# Implementation Plan: Ralph UI/UX-Judgment Model Routing
<!-- ralph-meta {"overviewTaskId":"ralph-model-routing-ui-opus48-nonui-gpt56sol","uiUxJudgment":"not-required"} -->

*Generated from D-001 on 2026-07-10. Ready for `/implement-with-ralph --from-plan .ralph/jobs/ralph-model-routing-ui-opus48-nonui-gpt56sol/plan.md` after the lead fast-forwards this plan branch.*

## Overview

Release `ralph-orchestration` 5.63.0 with one fail-closed model-routing policy:

- Executable work whose work product itself requires visual, interaction, layout, styling, presentation, or other UI/UX judgment uses `claude-opus-4.8`.
- All other executable work uses `gpt-5.6-sol`, including server, protocol, runtime, security, build, architecture, and test work that merely exercises an existing web/mobile/desktop/TUI acceptance surface.
- `mixed` is container metadata only. Before execution, each story or child call must resolve to `required` or `not-required`; unresolved `mixed` is an error.

The implementation adds `plugins/ralph/src/model-routing.mjs` as the runtime policy source, persists `uiUxJudgment` through brainstorm, plan, story, PRD, review, and nested-workflow boundaries, makes wrappers and generated Copilot `task()` calls select an exact approved model, rejects incompatible Codex/UI-judgment combinations before spawn, retains read compatibility for historical `copilot-opus` review metadata, regenerates both Copilot and Codex artifact trees, and ships the six synchronized 5.63.0 version stamps.

This is non-UI plugin/runtime work. The implementation, its Phase 5a review, and its Phase 5b docs review are themselves `not-required` and must run on `gpt-5.6-sol`.

## Phase-0 Empirical Probe: Copilot Task Model Precedence

### Probe setup

- Copilot CLI: `1.0.70-0`.
- Plugin loaded from `ai-developer-toolkit/plugins/ralph`.
- Custom agent: exact namespaced type `ralph-orchestration:code-reviewer`.
- Registered custom-agent metadata reported `model: "opus"`; its generated YAML at probe time was pinned to the old Opus model.
- The parent invoked `task()` with explicit `model: "gpt-5.6-sol"` and a fixed marker prompt.

### Observed result

- `tool.execution_start` recorded the exact custom agent and explicit `model: "gpt-5.6-sol"`.
- `subagent.started.model` was `gpt-5.6-sol`.
- `subagent.completed.model` was `gpt-5.6-sol`.
- The child returned `CUSTOM_AGENT_MODEL_PRECEDENCE_PROBE_OK` without tool calls.

### Planning consequence

Explicit Copilot Task `model=` overrides the custom-agent model declaration. Generate one Copilot YAML agent per role; do **not** create paired UI/non-UI variants. Every plugin-owned `task()` dispatch must nevertheless pass an explicit approved model, and a regression probe must preserve this precedence guarantee. The YAML model is registration metadata, not the routing source of truth.

The temporary JSONL/OTel probe files were deleted; no probe artifacts are part of this plan commit.

## Research Findings

### Current routing gaps

- `plugins/ralph/src/codex-exec.mjs` hard-codes `gpt-5.5`.
- `plugins/ralph/src/copilot-exec.mjs` defaults to `gpt-5.5` and accepts arbitrary `--model`.
- `plugins/ralph/src/ralph.mjs` selects Opus 4.7 whenever the host engine is Copilot, conflating engine with model policy.
- `plugins/ralph/src/review-loop.mjs` repeats the same engine/model coupling and persists the misleading reviewer ID `copilot-opus`.
- `plugins/ralph/schemas/prd-schema.json` and runtime validation have no `uiUxJudgment` contract.
- `plugins/ralph/scripts/generate-copilot-artifacts.mjs` maps old `sonnet|opus|haiku` aliases to stale model IDs and lowers Agent calls to Copilot Task calls without an explicit `model=`.
- `plugins/ralph/scripts/codex-lowering.mjs` has useful exact literal/prose dispatch inventories, but some analyze-iteration prose sites are deliberately unregistered.
- `plugins/ralph/src/overview-task-id.mjs` currently rewrites the one `ralph-meta` plan comment and can erase unrelated metadata unless generalized to merge fields.
- Generated Copilot and Codex trees contain stale routing prose and fixtures. A current tracked-file scan finds stale active literals across runtime, skills, generated artifacts, tests, and docs; immutable release/probe history must be allowlisted narrowly instead of rewritten.

### Existing patterns to reuse

- `plugins/ralph/src/json-io.mjs` supplies atomic JSON writes.
- `plugins/ralph/src/path-utils.mjs` supplies cross-platform path handling.
- `plugins/ralph/src/crews-env.mjs` supplies the child-environment sanitizer used at spawn boundaries.
- `plugins/ralph/scripts/codex-lowering.mjs` already demonstrates stable dispatch-site inventories, balanced Agent-block parsing, prose-site inventory checks, and generated-artifact drift failures.
- `plugins/ralph/scripts/generate-copilot-artifacts.mjs --target=all --write` is the only normal regeneration entry point.
- `plugins/ralph/.copilot-plugin/copilot-skills/implement-with-ralph/SKILL.md` is a deliberate hand-maintained fork; the generator does not overwrite it.
- `plugins/ralph/tests/run.mjs` auto-discovers `test-*.mjs`; no runner registration is needed for new Node tests.

## Policy and Data Contract

### Canonical values

`uiUxJudgment` accepts exactly:

| Value | Meaning | Executable? | Model |
|---|---|---:|---|
| `required` | The assigned work itself must make or assess UI/UX decisions. | Yes | `claude-opus-4.8` |
| `not-required` | The assigned work itself does not require UI/UX judgment. Existing UI/TUI acceptance surfaces do not change this. | Yes | `gpt-5.6-sol` |
| `mixed` | A container contains both classes. | No | Reject until the current executable unit resolves binary |

No routing code may infer classification from prompt text, touched file extensions, framework names, UI mentions, selected engine, or acceptance-test surface.

### Resolution precedence

For an executable unit, resolve in this order:

1. Current story's explicit `uiUxJudgment`.
2. Explicit binary `--ui-ux-judgment` for the current child/review/lens invocation.
3. Persisted binary artifact/job `uiUxJudgment`.
4. Error.

Top-level binary PRDs may let stories inherit. If a story explicitly contradicts a binary top-level value, reject and require the container to be marked `mixed`. Top-level `mixed` requires every executable story to declare `required` or `not-required`; story-level `mixed` is invalid.

When a whole-plan or whole-diff call consumes a `mixed` container:

- A story-scoped call uses the story's binary classification.
- A full-diff review resolves to `required` when its reviewed story set contains a `required` story and the reviewer must assess those criteria; otherwise it resolves to `not-required`.
- A pre-story whole-plan/research call has no safe inference. Its caller must pass a binary classification for that invocation; omission rejects.
- The container remains `mixed`; a binary dispatch override does not overwrite it.

### Engine compatibility

| Engine | `not-required` | `required` | unresolved `mixed` |
|---|---:|---:|---:|
| Copilot | Allowed, Sol | Allowed, Opus | Reject |
| Codex | Allowed, Sol | Reject in 5.63.0 | Reject |
| Deprecated `claude` | Normalize to Copilot, then apply policy | Normalize to Copilot, then apply policy | Reject |

Engine is a host selection, not a model alias.

- If `iterationEngine`/`planningEngine` is omitted for a binary unit, use the compatible default: Codex for `not-required`, Copilot for `required`.
- For a mixed PRD, story dispatch may choose those compatible defaults per story when no explicit engine is persisted.
- An explicit engine is an assertion. `codex + required` rejects; it never silently switches to Copilot.
- An explicit `copilot + not-required` is valid and runs Sol.

## Durable Metadata Propagation

### Brainstorm artifacts

- `brainstorm.json`: add top-level `uiUxJudgment`.
- `selected-direction.md`: add `uiUxJudgment` to YAML frontmatter beside optional `overviewTaskId`.
- Interactive mode may prompt once, using the canonical wording below, then persist.
- Autonomous/batch mode without a value fails before launching lenses.
- `mixed` may be persisted at this container stage, but every executable lens still needs a binary dispatch value.

### Plan artifacts

- `plan.md`: retain one merged `<!-- ralph-meta {...} -->` JSON object containing `overviewTaskId` when present and `uiUxJudgment`.
- `stories-outline.md`: add `**UI/UX judgment:** required|not-required` per story when the plan is `mixed`; binary plans may write the inherited value explicitly for auditability.
- Extend `overview-task-id.mjs` into a metadata-preserving helper without breaking its existing exported compatibility API. Updating `overviewTaskId` must not remove `uiUxJudgment`, and vice versa.

### PRD and runtime artifacts

- `prd.json`: require top-level `uiUxJudgment`; allow story-level binary values under the inheritance rules above.
- `phase-config.json`: persist the binary classification used by the current plan/review invocation, plus the parent container value when different.
- Nested workflow inputs: forward `--ui-ux-judgment` or the resolved structured value at every Skill/Task/wrapper boundary.
- Review logs: new writes use `copilot-primary`; readers normalize historical `copilot-opus` to the same reviewer slot.

## Central Module and CLI

Create `plugins/ralph/src/model-routing.mjs` as the only executable-code owner of the approved model constants and policy functions.

Required exports:

- `UI_UX_JUDGMENT_MODEL`
- `NO_UI_UX_JUDGMENT_MODEL`
- `normalizeUiUxJudgment(value, options?)`
- `resolveModelForUiUxJudgment(value)`
- `assertApprovedModel(model)`
- `normalizeEngine(engine)`
- `assertEngineSupportsUiUxJudgment(engine, value)`
- `resolveStoryUiUxJudgment(prd, story)`
- `resolveEngineForUiUxJudgment({ engine, uiUxJudgment, purpose })`
- `assertModelMatchesUiUxJudgment(model, value)`
- `migratePrdUiUxJudgment(...)`

Required CLI modes:

```text
node plugins/ralph/src/model-routing.mjs resolve \
  --ui-ux-judgment required|not-required \
  [--engine codex|copilot|claude] \
  [--model <asserted-id>] \
  [--format json|model|engine]

node plugins/ralph/src/model-routing.mjs migrate-prd \
  --prd <path> \
  --ui-ux-judgment required|not-required|mixed \
  [--story US-001=required]...
```

`migrate-prd` must:

- atomically persist the classification;
- refuse invalid/unknown/duplicate story IDs;
- require every story mapping for `mixed`;
- reject story-level `mixed`;
- refuse to overwrite existing conflicting metadata;
- validate engine compatibility after migration and provide an actionable engine correction;
- leave the file untouched on any error.

## CLI, Help, and Backward Compatibility

### User-facing flag

Add `--ui-ux-judgment required|not-required|mixed` to artifact-producing user flows:

- brainstorm;
- plan;
- multi-model investigate;
- plan review;
- PRD conversion/edit;
- implementation;
- Ralph run/resume.

Executable wrappers accept only binary values. A mixed artifact consumer must resolve the current call to binary before invoking a wrapper or Task.

Canonical help text:

> Classify whether the work itself requires UI/UX judgment. Merely using an existing web/mobile/desktop/TUI surface for acceptance is `not-required`.

Canonical interactive prompt:

> Does this work itself require visual, interaction, layout, styling, presentation, or other UI/UX judgment? `required`, `not-required`, or `mixed`.

### Raw model compatibility

- Remove wrapper defaults.
- `codex-exec.mjs` requires `--ui-ux-judgment not-required`; it has no model selector.
- `copilot-exec.mjs` requires binary `--ui-ux-judgment`.
- If `copilot-exec.mjs --model` remains temporarily for compatibility, it is an equality assertion only. It must match the policy result exactly or fail before spawn.
- High-level skills override classification, never raw model IDs.

### Existing artifacts lacking metadata

There is no silent `not-required` default.

- Old `prd.json`: stop before any child spawn and print the exact `migrate-prd` command shape. `src/ralph.mjs --ui-ux-judgment ...` may call the same helper once when the field is absent, but it must persist before continuing.
- Old mixed PRD: list every story ID still needing a binary mapping.
- Old brainstorm/selected-direction artifact: require an explicit flag at the next stage and persist it into the next durable artifact.
- Old plan: require an explicit flag before PRD generation; persist into the generated PRD and story outline.
- Existing binary metadata that conflicts with a CLI value rejects rather than being overwritten.
- Deprecated `claude` engine warnings remain, but describe Copilot normalization followed by policy routing; they must not name Opus 4.7.

### Availability errors

- Missing Copilot CLI for `required`: hard preflight failure.
- Approved model unavailable/account not entitled: preserve the underlying CLI error and add policy context; do not retry with GPT-5.5, `auto`, a different Claude model, or another GPT model.
- Optional/adaptive lens unavailable: preserve its existing fail-soft participation semantics by skipping that slot, not rerouting it.
- Blocking review/implement/fix slot unavailable: hard failure.

## Generator and Dispatch Inventory Design

Create `plugins/ralph/scripts/model-routing-inventory.mjs` and use it from both generator/lowering paths.

Each entry records:

```js
{
  siteId,
  source,
  kind: "wrapper" | "agent-literal" | "agent-prose" | "skill-dispatch" | "task",
  uiUxJudgment: "not-required" | "inherit",
  required: true | false
}
```

Required behavior:

- Inventory every plugin-owned wrapper invocation, literal Agent call, prose Agent delegation, Skill dispatch, and emitted Copilot Task call.
- Add the currently omitted analyze-iteration prose sites.
- Fail generation/check on missing, duplicate, or stale entries.
- Fixed roles always resolve `not-required`.
- Inherited roles require the current binary classification.
- A new plugin-owned dispatch without an inventory row fails the build.
- Generated Copilot Task calls always include `model=`.
- Inherited Task sites lower to explicit `required` and `not-required` branches whose concrete calls contain one of the two exact model IDs; an unresolved `mixed` branch errors.
- Generated Codex recipes reject inherited `required` work before `spawn_agent`; fixed `not-required` children continue to inherit the compatible GPT parent.

### Agent metadata

Keep Claude-facing `model: sonnet|opus|haiku` independent. Add required generator metadata `copilotUiUxJudgment: not-required|inherit` to every actual Ralph agent definition.

Fixed `not-required`:

- criteria-validator
- docs-reviewer
- docs-updater
- progress-analyst
- story-doctor
- dsat-analyst
- skill-suggester
- followup-task-gatherer
- security-reviewer
- security-fixer

Inherited:

- code-reviewer
- code-fixer
- refactoring-agent
- manifest-verifier
- plan-reviewer

One YAML file remains per role because the Phase-0 probe proved Task precedence. Generated YAML must contain only approved exact model IDs. For inherited roles, the YAML model is a non-routing registration baseline; all supported Ralph dispatches override it explicitly and carry the classification in the prompt/input contract.

## Authored vs Generated Boundaries

### Authored sources

Edit runtime, schema, skills, agents, prompts, generator/lowering code, tests, and docs under `plugins/ralph/`.

### Generated outputs

Do not hand-edit:

- `plugins/ralph/.copilot-plugin/agents/**`
- `plugins/ralph/.copilot-plugin/internal-workflows/**`
- generated Copilot user skills
- `plugins/ralph/.codex-plugin/agents/**`
- `plugins/ralph/.codex-plugin/internal-workflows/**`
- `plugins/ralph/.codex-plugin/codex-skills/**`

Regenerate from the toolkit worktree root:

```powershell
node plugins/ralph/scripts/generate-copilot-artifacts.mjs --target=all --write
```

Then verify:

```powershell
node plugins/ralph/scripts/generate-copilot-artifacts.mjs --target=all --check
node plugins/ralph/scripts/check-copilot-parity.mjs
```

### Hand-maintained Copilot exception

`plugins/ralph/.copilot-plugin/copilot-skills/implement-with-ralph/SKILL.md` is intentionally not generated. Update it manually from the authored source and its source anchors, then use parity checks. Do not assume `--target=all --write` refreshes it.

## Worktree and Repository Layout

### Implementation repository

All implementation code is in the `ai-developer-toolkit` submodule, using a worktree **inside that submodule**:

```text
Repository: ai-developer-toolkit/
Worktree:   ai-developer-toolkit/.worktrees/ralph-model-routing-ui-opus48-nonui-gpt56sol/
Branch:     ralph/ralph-model-routing-ui-opus48-nonui-gpt56sol
```

Create the worktree from the toolkit's current `main`. Do not implement in the codexu primary checkout or directly in the parent submodule directory shared with other jobs.

### Parent repository closeout

The implementation PRD/write scope is toolkit-only. After the toolkit commit is reviewed, merged, pushed, and dogfooded, the lead updates in codexu:

- the `ai-developer-toolkit` gitlink;
- root `AGENTS.md` active plugin version from 5.62.0 to 5.63.0.

That parent pointer/version-table commit is a lead-owned ship ceremony, not a second write root inside the Ralph implementation job.

## Exact Files to Create or Modify

Paths in this subsection are relative to `ai-developer-toolkit/` unless prefixed `[parent codexu]`.

### New authored files

- `plugins/ralph/src/model-routing.mjs`
- `plugins/ralph/scripts/model-routing-inventory.mjs`
- `plugins/ralph/tests/test-model-routing.mjs`
- `plugins/ralph/tests/test-model-routing-literals.mjs`

### Runtime, schema, and examples

- `plugins/ralph/src/codex-exec.mjs`
- `plugins/ralph/src/copilot-exec.mjs`
- `plugins/ralph/src/ralph.mjs`
- `plugins/ralph/src/review-loop.mjs`
- `plugins/ralph/src/overview-task-id.mjs`
- `plugins/ralph/schemas/prd-schema.json`
- `plugins/ralph/prd.json.example`

### Generator and parity sources

- `plugins/ralph/scripts/generate-copilot-artifacts.mjs`
- `plugins/ralph/scripts/codex-lowering.mjs`
- `plugins/ralph/scripts/check-copilot-parity.mjs`

### Authored skills

- `plugins/ralph/skills/brainstorm-with-ralph/SKILL.md`
- `plugins/ralph/skills/plan-with-ralph/SKILL.md`
- `plugins/ralph/skills/multi-model-investigate/SKILL.md`
- `plugins/ralph/skills/review-plan-with-ralph/SKILL.md`
- `plugins/ralph/skills/implement-with-ralph/SKILL.md`
- `plugins/ralph/skills/create-prd/SKILL.md`
- `plugins/ralph/skills/convert-to-ralph-prd/SKILL.md`
- `plugins/ralph/skills/edit-prd/SKILL.md`
- `plugins/ralph/skills/list-jobs/SKILL.md`
- `plugins/ralph/skills/decompose-plan/SKILL.md`
- `plugins/ralph/skills/parallel-ralph/SKILL.md`
- `plugins/ralph/skills/review-changes/SKILL.md`
- `plugins/ralph/skills/analyze-iteration/SKILL.md`
- `plugins/ralph/skills/run-ralph/SKILL.md`

### Authored agent metadata

- `plugins/ralph/agents/code-fixer.md`
- `plugins/ralph/agents/code-reviewer.md`
- `plugins/ralph/agents/criteria-validator.md`
- `plugins/ralph/agents/docs-reviewer.md`
- `plugins/ralph/agents/docs-updater.md`
- `plugins/ralph/agents/dsat-analyst.md`
- `plugins/ralph/agents/followup-task-gatherer.md`
- `plugins/ralph/agents/manifest-verifier.md`
- `plugins/ralph/agents/plan-reviewer.md`
- `plugins/ralph/agents/progress-analyst.md`
- `plugins/ralph/agents/refactoring-agent.md`
- `plugins/ralph/agents/security-fixer.md`
- `plugins/ralph/agents/security-reviewer.md`
- `plugins/ralph/agents/skill-suggester.md`
- `plugins/ralph/agents/story-doctor.md`

### Authored prompts

- `plugins/ralph/prompts/codex.md`
- `plugins/ralph/prompts/copilot.md`
- `plugins/ralph/prompts/plan-reviewer.md`

### Generated Copilot agent YAML

- `plugins/ralph/.copilot-plugin/agents/code-fixer.agent.yaml`
- `plugins/ralph/.copilot-plugin/agents/code-reviewer.agent.yaml`
- `plugins/ralph/.copilot-plugin/agents/criteria-validator.agent.yaml`
- `plugins/ralph/.copilot-plugin/agents/docs-reviewer.agent.yaml`
- `plugins/ralph/.copilot-plugin/agents/docs-updater.agent.yaml`
- `plugins/ralph/.copilot-plugin/agents/dsat-analyst.agent.yaml`
- `plugins/ralph/.copilot-plugin/agents/followup-task-gatherer.agent.yaml`
- `plugins/ralph/.copilot-plugin/agents/manifest-verifier.agent.yaml`
- `plugins/ralph/.copilot-plugin/agents/plan-reviewer.agent.yaml`
- `plugins/ralph/.copilot-plugin/agents/progress-analyst.agent.yaml`
- `plugins/ralph/.copilot-plugin/agents/refactoring-agent.agent.yaml`
- `plugins/ralph/.copilot-plugin/agents/skill-suggester.agent.yaml`
- `plugins/ralph/.copilot-plugin/agents/story-doctor.agent.yaml`

### Generated Copilot skills/workflows

- `plugins/ralph/.copilot-plugin/copilot-skills/brainstorm-with-ralph/SKILL.md`
- `plugins/ralph/.copilot-plugin/copilot-skills/plan-with-ralph/SKILL.md`
- `plugins/ralph/.copilot-plugin/copilot-skills/multi-model-investigate/SKILL.md`
- `plugins/ralph/.copilot-plugin/copilot-skills/implement-with-ralph/SKILL.md` (hand-maintained exception)
- `plugins/ralph/.copilot-plugin/internal-workflows/analyze-iteration/SKILL.md`
- `plugins/ralph/.copilot-plugin/internal-workflows/create-prd/SKILL.md`
- `plugins/ralph/.copilot-plugin/internal-workflows/convert-to-ralph-prd/SKILL.md`
- `plugins/ralph/.copilot-plugin/internal-workflows/decompose-plan/SKILL.md`
- `plugins/ralph/.copilot-plugin/internal-workflows/edit-prd/SKILL.md`
- `plugins/ralph/.copilot-plugin/internal-workflows/list-jobs/SKILL.md`
- `plugins/ralph/.copilot-plugin/internal-workflows/parallel-ralph/SKILL.md`
- `plugins/ralph/.copilot-plugin/internal-workflows/review-changes/SKILL.md`
- `plugins/ralph/.copilot-plugin/internal-workflows/run-ralph/SKILL.md`

### Generated Codex agents

- `plugins/ralph/.codex-plugin/agents/code-fixer.md`
- `plugins/ralph/.codex-plugin/agents/code-reviewer.md`
- `plugins/ralph/.codex-plugin/agents/criteria-validator.md`
- `plugins/ralph/.codex-plugin/agents/docs-reviewer.md`
- `plugins/ralph/.codex-plugin/agents/docs-updater.md`
- `plugins/ralph/.codex-plugin/agents/dsat-analyst.md`
- `plugins/ralph/.codex-plugin/agents/followup-task-gatherer.md`
- `plugins/ralph/.codex-plugin/agents/manifest-verifier.md`
- `plugins/ralph/.codex-plugin/agents/plan-reviewer.md`
- `plugins/ralph/.codex-plugin/agents/progress-analyst.md`
- `plugins/ralph/.codex-plugin/agents/refactoring-agent.md`
- `plugins/ralph/.codex-plugin/agents/skill-suggester.md`
- `plugins/ralph/.codex-plugin/agents/story-doctor.md`

### Generated Codex skills/workflows

- `plugins/ralph/.codex-plugin/codex-skills/brainstorm-with-ralph/SKILL.md`
- `plugins/ralph/.codex-plugin/codex-skills/plan-with-ralph/SKILL.md`
- `plugins/ralph/.codex-plugin/codex-skills/multi-model-investigate/SKILL.md`
- `plugins/ralph/.codex-plugin/codex-skills/implement-with-ralph/SKILL.md`
- `plugins/ralph/.codex-plugin/internal-workflows/analyze-iteration/SKILL.md`
- `plugins/ralph/.codex-plugin/internal-workflows/create-prd/SKILL.md`
- `plugins/ralph/.codex-plugin/internal-workflows/convert-to-ralph-prd/SKILL.md`
- `plugins/ralph/.codex-plugin/internal-workflows/decompose-plan/SKILL.md`
- `plugins/ralph/.codex-plugin/internal-workflows/edit-prd/SKILL.md`
- `plugins/ralph/.codex-plugin/internal-workflows/list-jobs/SKILL.md`
- `plugins/ralph/.codex-plugin/internal-workflows/parallel-ralph/SKILL.md`
- `plugins/ralph/.codex-plugin/internal-workflows/review-changes/SKILL.md`
- `plugins/ralph/.codex-plugin/internal-workflows/run-ralph/SKILL.md`

### Tests and fixtures

- `plugins/ralph/tests/test-codex-exec.mjs`
- `plugins/ralph/tests/test-copilot-exec.mjs`
- `plugins/ralph/tests/test-ralph.mjs`
- `plugins/ralph/tests/test-review-loop.mjs`
- `plugins/ralph/tests/test-review-loop-planning-engine.sh`
- `plugins/ralph/tests/test-review-loop-rereview.sh`
- `plugins/ralph/tests/test-codex-generator.mjs`
- `plugins/ralph/tests/test-copilot-generator.sh`
- `plugins/ralph/tests/test-overview-task-id.mjs`
- `plugins/ralph/tests/test-copilot-readonly-caller-split.mjs`
- `plugins/ralph/tests/test-copilot-nested-task.sh`
- `plugins/ralph/tests/test-copilot-readonly-guard.mjs`
- `plugins/ralph/tests/test-regression-smoke-phase-3.mjs`
- `plugins/ralph/tests/test-durable-memory-smoke.sh`
- `plugins/ralph/tests/test-iteration-counter.sh`
- `plugins/ralph/tests/fixtures/regression-smoke/job/prd.json`
- `plugins/ralph/tests/fixtures/regression-smoke-phase-2/ralph-job-fixture/prd.json`
- `plugins/ralph/tests/fixtures/regression-smoke-phase-2/ralph-job-fixture-pre-init/prd.json`
- `plugins/ralph/tests/fixtures/regression-smoke-phase-2/review-loop-plan-fixture.expected-review-log.json`
- `plugins/ralph/tests/fixtures/regression-smoke-phase-3/codex-exec-argv.json`
- `plugins/ralph/tests/fixtures/regression-smoke-phase-3/copilot-exec-argv.json`
- `plugins/ralph/tests/fixtures/regression-smoke-phase-4/pre-flight-caller-surface.txt`
- `plugins/ralph/tests/fixtures/regression-smoke-phase-4/post-migration-caller-surface.txt`

Additional fixture/test edits discovered by the targeted or full gate are allowed only when they directly add the now-required classification or update an expected approved model; do not broaden scope to unrelated baseline failures.

### Documentation

- `AGENTS.md` (toolkit root; distinct from parent codexu `AGENTS.md`)
- `plugins/ralph/AGENTS.md`
- `plugins/ralph/CHANGELOG.md`
- `plugins/ralph/docs/copilot-quickstart.md`
- `plugins/ralph/docs/future-work/claude-code-to-copilot-cli-tool-mapping.md`
- `plugins/ralph/docs/future-work/copilot-cli-port-design.md`
- `plugins/ralph/docs/future-work/copilot-port-handoff.md`
- `plugins/ralph/docs/future-work/per-story-reasoning-effort-classification.md`

`plugins/ralph/docs/future-work/copilot-probe-results.md` is immutable historical evidence. Leave it unchanged and allowlist it narrowly in the stale-literal test.

### Ralph 5.63.0 version stamps

- `.claude-plugin/marketplace.json`
- `.github/plugin/marketplace.json`
- `.agents/plugins/marketplace.json`
- `plugins/ralph/.claude-plugin/plugin.json`
- `plugins/ralph/.github/plugin/plugin.json`
- `plugins/ralph/.codex-plugin/plugin.json`

### Parent codexu closeout

- `[parent codexu] ai-developer-toolkit` (gitlink)
- `[parent codexu] AGENTS.md`

## Reference Files

Paths are relative to the plan worktree root unless stated otherwise.

- `.ralph/brainstorms/ralph-model-routing-ui-opus48-nonui-gpt56sol/brainstorm.md`
- `.ralph/brainstorms/ralph-model-routing-ui-opus48-nonui-gpt56sol/brainstorm.json`
- `.ralph-overview/data.json`
- `AGENTS.md`
- `ai-developer-toolkit/AGENTS.md`
- `ai-developer-toolkit/plugins/ralph/AGENTS.md`
- `ai-developer-toolkit/plugins/ralph/src/json-io.mjs`
- `ai-developer-toolkit/plugins/ralph/src/path-utils.mjs`
- `ai-developer-toolkit/plugins/ralph/src/crews-env.mjs`
- `ai-developer-toolkit/plugins/ralph/scripts/codex-lowering.mjs`
- `ai-developer-toolkit/plugins/ralph/.copilot-plugin/parity-exceptions.json`
- `ai-developer-toolkit/plugins/ralph/tests/run.mjs`
- `ai-developer-toolkit/plugins/ralph/tests/test-no-stale-sh-refs.mjs`
- `ai-developer-toolkit/tools/validate-codex-marketplace-policy.mjs`

## Scope

### In scope

- Exact model policy and engine compatibility.
- Durable classification through all named Ralph artifact and dispatch boundaries.
- Explicit migration for old artifacts.
- Direct wrappers, core iteration runtime, planning/fix/re-review runtime.
- Generated Copilot Task and custom-agent YAML routing.
- Generated Codex fail-closed behavior.
- Active stale-literal cleanup and narrow immutable-history allowlists.
- Ralph 5.63.0 release metadata, installed-plugin dogfood, and parent pointer closeout.

### Out of scope

- Opus 4.8 support through Codex.
- Prompt/file-name heuristics that auto-classify work.
- A third model, GPT-5.5 fallback, `auto`, or model cascading.
- Per-story reasoning-effort work described in the future-work document.
- Redesigning UI/TUI surfaces.
- Rewriting immutable historical changelog/probe claims.
- Unrelated plugin cleanup or dependency changes.

## Preliminary Story Decomposition

### US-001 — Central policy, schema, and durable classification

Create the policy module and inventory foundation; extend schema/runtime validation; merge plan metadata safely; persist classification through brainstorm, selected direction, plan, story outline, PRD, and nested artifacts; add explicit migration.

### US-002 — Wrapper and per-story runtime routing

Make Codex/Copilot wrappers require structured classification, remove defaults/arbitrary selection, route per story in `ralph.mjs`, normalize the deprecated engine alias, and reject incompatible combinations before spawn.

### US-003 — Planning, review, and mixed-workflow routing

Route planning/fix/re-review and all source Skill/Agent/prose sites, carry binary classifications into executable children, rename new review attribution to `copilot-primary`, and read historical `copilot-opus`.

### US-004 — Generator metadata and regenerated artifacts

Add per-agent generator metadata, exact dispatch inventory/drift guards, Task-model lowering, Codex incompatibility guards, then regenerate Copilot/Codex outputs and manually update the Copilot implement hand-fork.

### US-005 — Regression matrix, literal ban, and docs/help migration

Add unit/integration/generator/live-precedence tests, migrate fixtures, enforce active stale-literal bans with narrow history exceptions, and update active help/documentation.

### US-006 — Ralph 5.63.0 ship and installed dogfood

Bump all six toolkit stamps, update the plugin CHANGELOG/AGENTS and toolkit-root Ralph summary, run all gates and Phase 5 convergence, dogfood installed Copilot/Codex routes with telemetry, then hand off the parent gitlink/version-table update to the lead.

## Suggested Decomposition

### Cluster: serial-ralph-model-routing

- Stories: US-001, US-002, US-003, US-004, US-005, US-006
- Phase: 1
- Depends on: None
- File-overlap evidence:
  - Shared: `plugins/ralph/src/ralph.mjs`, `plugins/ralph/src/review-loop.mjs`, `plugins/ralph/scripts/generate-copilot-artifacts.mjs`, `plugins/ralph/scripts/codex-lowering.mjs`, shared skills, generated trees, `AGENTS.md`, `CHANGELOG.md`, and six version stamps.
  - Exclusive: only small test/doc subsets are story-specific.
  - Risk: high.
- `execution_mode` rationale: every story converges on the same policy module, dispatch inventory, generator outputs, and release metadata. Parallel same-plugin work would create source/generated drift and version conflicts. Execute serially in one toolkit worktree.

Do not create a parallel-decomposition sidecar for this task; the user limited plan deliverables to this plan, the six-story outline, and an optional review note.

## Story-Level Acceptance Criteria

### US-001

- Only `required|not-required|mixed` validate.
- Missing metadata fails closed.
- `required -> claude-opus-4.8`; `not-required -> gpt-5.6-sol`; executable `mixed` rejects.
- Binary top-level inheritance works; contradictory story metadata rejects.
- Top-level mixed requires every story to be binary.
- `overviewTaskId` updates preserve `uiUxJudgment`.
- One-time PRD migration is atomic and explicit.
- Acceptance-surface examples remain `not-required`.

### US-002

- Codex not-required spawns exact Sol.
- Copilot not-required spawns exact Sol.
- Copilot required spawns exact Opus.
- Codex required, missing, invalid, and executable mixed reject before spawn.
- Per-story mixed PRD dispatch changes model/compatible host between representative stories.
- Raw model mismatch rejects; no arbitrary model fallback remains.
- Model-unavailable failures retain the original error and do not retry another model.

### US-003

- Every wrapper call receives structured classification.
- Every plugin-owned Task call resolves and pins an exact approved model.
- Fixed roles use Sol; inherited roles use the target unit's binary classification.
- Required flows skip/reject Codex participation rather than substituting GPT.
- New review metadata writes `copilot-primary`.
- Historical `copilot-opus` records remain readable and merge into the primary reviewer slot.
- Help copy distinguishes judgment work from an existing UI/TUI acceptance harness.

### US-004

- Every actual agent source has `copilotUiUxJudgment`.
- Generator rejects absent/invalid metadata.
- Generated YAML contains only the two approved IDs.
- Generated Task calls include explicit `model=`.
- Dispatch inventory detects unregistered literal, prose, wrapper, Skill, and Task sites.
- Codex artifacts reject inherited required work before child spawn.
- `--target=all --write`, `--target=all --check`, and parity commands agree.

### US-005

- Required/not-required/mixed routing matrix passes.
- Server/protocol/runtime through existing UI/TUI acceptance routes to Sol.
- React/layout/interaction/terminal-presentation judgment routes to Opus.
- Old PRD without metadata fails, then explicit migration passes.
- Copilot custom-agent YAML precedence live probe confirms Task model wins.
- Active scan rejects GPT-5.5, GPT-5.4, and Opus 4.7.
- Only exact immutable history and the legacy `copilot-opus` reader/fixtures are allowlisted.
- All active docs/help/examples describe the new policy.

### US-006

- Six toolkit version stamps equal 5.63.0.
- CHANGELOG, plugin AGENTS, and the toolkit-root AGENTS Ralph summary describe behavior and migration.
- Targeted tests, generator/parity gates, marketplace policy, and full plugin suite pass.
- Phase 5a code review/fix and Phase 5b docs review/fix converge clean.
- Installed Copilot not-required route actually runs Sol.
- Installed Copilot required route actually runs Opus.
- Installed Codex not-required route actually runs Sol.
- Existing-UI/TUI acceptance dogfood remains Sol.
- Parent codexu gitlink and active-version table point to the shipped toolkit commit.

## Exact Test Matrix

| Area | Case | Expected |
|---|---|---|
| Policy | `required` | exact Opus ID |
| Policy | `not-required` | exact Sol ID |
| Policy | missing/invalid | error |
| Policy | executable `mixed` | error |
| Inheritance | binary top + missing story value | inherit |
| Inheritance | binary top + contradictory story | error |
| Inheritance | mixed top + complete binary stories | resolve per story |
| Inheritance | mixed top + missing/mixed story | list IDs and error |
| Acceptance surface | server/protocol/runtime + existing web/mobile/TUI smoke | not-required/Sol |
| Actual UI judgment | React layout, interaction, e-ink UX, terminal presentation | required/Opus |
| Codex wrapper | not-required | argv contains Sol |
| Codex wrapper | required/mixed/missing | no spawn; actionable error |
| Copilot wrapper | required | argv contains Opus |
| Copilot wrapper | not-required | argv contains Sol |
| Copilot wrapper | raw model equals resolved | allowed assertion |
| Copilot wrapper | raw model differs | no spawn; error |
| Runtime | mixed PRD, current required story | compatible Copilot/Opus |
| Runtime | mixed PRD, current not-required story | compatible default or explicit host/Sol |
| Runtime | explicit Codex + required story | error before spawn |
| Alias | `claude` | Copilot normalization, then policy |
| Review | not-required planning/fix/re-review | Sol; new ID `copilot-primary` |
| Review | required planning/fix/re-review | Opus; Codex slot skipped/rejected per participation contract |
| Review compatibility | historical `copilot-opus` | read/merge succeeds |
| Migration | old binary PRD + explicit migration | atomically persisted |
| Migration | old mixed PRD missing mappings | unchanged file; listed IDs |
| Migration | conflicting existing field | unchanged file; error |
| Generator | fixed role | explicit Sol Task |
| Generator | inherited role, required branch | explicit Opus Task |
| Generator | inherited role, not-required branch | explicit Sol Task |
| Generator | new unregistered dispatch | drift failure |
| Generator | unresolved mixed | generated/runtime error path |
| YAML precedence | YAML-pinned opposite model + explicit Task model | `subagent.started/completed` show Task model |
| Availability | approved model unavailable | original CLI error, no fallback |
| Literal ban | active old model literal | test failure |
| Literal compatibility | exact historical/legacy allowlist | test pass |

## Validation Commands

Run from `ai-developer-toolkit/.worktrees/ralph-model-routing-ui-opus48-nonui-gpt56sol/`.

### Targeted runtime and metadata tests

```powershell
node plugins/ralph/tests/test-model-routing.mjs
node plugins/ralph/tests/test-model-routing-literals.mjs
node plugins/ralph/tests/test-codex-exec.mjs
node plugins/ralph/tests/test-copilot-exec.mjs
node plugins/ralph/tests/test-ralph.mjs
node plugins/ralph/tests/test-review-loop.mjs
node plugins/ralph/tests/test-overview-task-id.mjs
node plugins/ralph/tests/test-copilot-readonly-caller-split.mjs
bash plugins/ralph/tests/test-review-loop-planning-engine.sh
bash plugins/ralph/tests/test-review-loop-rereview.sh
```

### Regeneration and generated-artifact gates

```powershell
node plugins/ralph/scripts/generate-copilot-artifacts.mjs --target=all --write
node plugins/ralph/scripts/generate-copilot-artifacts.mjs --target=all --check
node plugins/ralph/scripts/check-copilot-parity.mjs
node plugins/ralph/tests/test-codex-generator.mjs
bash plugins/ralph/tests/test-copilot-generator.sh
node tools/validate-codex-marketplace-policy.mjs
```

### Regression and full gate

```powershell
node plugins/ralph/tests/test-regression-smoke-phase-3.mjs
bash plugins/ralph/tests/test-durable-memory-smoke.sh
bash plugins/ralph/tests/test-iteration-counter.sh
node plugins/ralph/tests/run.mjs
```

Run the live Copilot Task/YAML precedence test only with its explicit opt-in environment flag and an authenticated Copilot CLI. It must parse JSONL/OTel events, not trust parent prose.

Do not run `pnpm install` in this submodule/plugin. Ralph has no relevant package manifest; install nothing unless a real validation command reports a missing dependency.

## Phase 5a and Phase 5b Convergence

### Phase 5a — Code review/fix

After tests and regenerated parity are green:

1. Run the Ralph code reviewer against the complete toolkit diff, original brainstorm, this plan, and generated PRD.
2. Classify the review invocation `not-required`; use exact Sol.
3. Fix every Critical/High/Medium finding with targeted fix agents, also Sol.
4. Re-run targeted tests after each fix round.
5. Repeat review/fix until code review reports clean; do not stop after story pass.

### Phase 5b — Docs review/fix

1. Run the docs reviewer against every tracked Markdown file affected by routing/help/release changes.
2. Use exact Sol; docs review is a fixed `not-required` role.
3. Fix stale help, migration, generated-artifact, version, and dogfood instructions.
4. Re-run the docs review until clean.

The implementation is not ship-ready until both review states are clean. Empty-diff short-circuit is the only normal exception.

## Release and Installed-Plugin Dogfood

### Toolkit release preparation

1. Prepend `v5.63.0` sections to:
   - `plugins/ralph/CHANGELOG.md`
   - `plugins/ralph/AGENTS.md`
2. Update the Ralph Plugin entry in toolkit-root `AGENTS.md` so its current routing description names the `uiUxJudgment` policy and approved models instead of GPT-5.5/GPT-5.4/Opus-4.7 behavior.
3. Set all six manifests/indexes to `5.63.0`.
4. Re-run regeneration, parity, targeted tests, full suite, Phase 5a, and Phase 5b.
5. Commit the toolkit branch locally and report it to the lead.

### Lead-owned merge/push/install sequence

1. Lead reviews and fast-forwards the toolkit topic branch to toolkit `main`.
2. Lead pushes toolkit `main` to every configured toolkit remote and verifies matching SHAs.
3. Lead runs `copilot plugin update --all`.
4. Lead runs the installed-plugin dogfood below.
5. Only after dogfood passes, lead updates the codexu gitlink and root version table, commits, and pushes codexu `main` to every configured remote.

### Real installed dogfood

Use the installed plugin, not the in-tree source path.

1. **Copilot not-required:** run a minimal routed wrapper/Task flow classified `not-required`, with a prompt describing server/runtime work verified through an existing UI/TUI. Assert `subagent.started.model` or OTel `gen_ai.request.model` is `gpt-5.6-sol`.
2. **Copilot required:** run a minimal routed wrapper/Task flow classified `required`, with actual layout/interaction judgment. Assert the event/OTel model is `claude-opus-4.8`.
3. **Codex not-required:** run a minimal installed-wrapper flow classified `not-required`; assert the real Codex invocation/session metadata uses `gpt-5.6-sol`.
4. **Fail closed:** attempt `required` through Codex and a deliberately unavailable/invalid approved-model fixture or mock boundary; verify no fallback spawn.
5. Preserve a concise dogfood transcript in the Ralph job directory if the implementation workflow supports it; never infer success from assistant prose alone.

## Risk and Conflict Surface

| Risk | Mitigation |
|---|---|
| Classification based on touched UI files or acceptance surface | Structured field only; explicit examples and regression tests |
| Missing nested/prose dispatch sites | Exact inventory plus source/generated drift checks |
| Task YAML overriding explicit model | Phase-0 probe proved Task wins; retain opt-in regression probe |
| Mixed container reaches executable spawn | Central resolver rejects; story/call boundary must be binary |
| Engine/model conflation | Separate engine normalization/compatibility APIs from model resolution |
| Arbitrary `--model` bypass | Remove selector or reduce to equality assertion |
| Old PRDs silently become Sol | Explicit atomic migration; missing is an error |
| Review logs break on renamed reviewer | Write `copilot-primary`; accept `copilot-opus` on read |
| Generated source edited directly | Regenerate from authored sources; recognize the one Copilot implement hand-fork exception |
| Same-plugin parallel jobs conflict | Serialize all six stories in one toolkit worktree |
| One of six version stamps is missed | Version equality test/release checklist |
| Parent pointer records unpushed toolkit SHA | Push/verify toolkit first, then bump parent gitlink |
| Model entitlement differs by machine | Real installed dogfood; no fallback |
| Historical evidence is rewritten to satisfy a scan | Narrow allowlist immutable history; scan active surfaces |

## Rollback

1. Revert the toolkit 5.63.0 implementation/version commit on toolkit `main`.
2. Regenerate Copilot/Codex artifacts from the reverted authored sources and rerun the release gates.
3. Push the reverted toolkit `main` to all toolkit remotes.
4. Update/reinstall the Copilot plugin so installed consumers return to 5.62.0.
5. Revert the codexu gitlink/version-table commit and push all codexu remotes.
6. Do not strip `uiUxJudgment` from migrated PRDs; 5.62.0 tolerates additional JSON properties. Preserve job/review evidence for forward recovery.

## Common Mistakes and Confusion Points

- Editing `.copilot-plugin/**` or `.codex-plugin/**` directly instead of changing authored sources and regenerating. The only exception is the anchored Copilot `implement-with-ralph` hand-fork.
- Classifying by `.tsx`, React, web, mobile, terminal, or screenshot mentions. The question is whether the work itself requires UI/UX judgment.
- Routing every Copilot call to Opus or every Codex call to GPT. Engine and model are separate.
- Treating `mixed` as executable or mapping it wholesale to Opus.
- Allowing GPT-5.5, `auto`, or another model as a fallback.
- Retaining unrestricted `copilot-exec --model`.
- Updating `overviewTaskId` by replacing the entire `ralph-meta` comment and losing `uiUxJudgment`.
- Emitting a generated `task()` call without `model=`.
- Forgetting the historical `copilot-opus` read alias while renaming new writes.
- Missing one of the three plugin manifests or three marketplace indexes.
- Running `pnpm install` inside the toolkit/Ralph plugin and hoisting dependencies into the wrong workspace.
- Implementing in the codexu primary checkout instead of a worktree inside `ai-developer-toolkit/`.
- Recording the parent gitlink before the toolkit commit exists on every required remote.
- Trusting model names in prose instead of JSON events, OTel, or real invocation metadata.

## Open Questions

None. The Phase-0 precedence probe resolved the only branch in the brainstorm: one generated YAML agent per role is sufficient. Opus-through-Codex support and pre-PRD structured judgment-slice maps remain explicitly deferred.

## Next Step

After the lead fast-forwards this plan branch, implement serially in the toolkit submodule:

```text
/implement-with-ralph --from-plan .ralph/jobs/ralph-model-routing-ui-opus48-nonui-gpt56sol/plan.md --autonomous
```

The implementation member must create/use `ai-developer-toolkit/.worktrees/ralph-model-routing-ui-opus48-nonui-gpt56sol/`, keep the PRD write scope toolkit-only, drive Phase 5a/5b to clean, and leave the codexu gitlink/version-table update to the lead after toolkit merge/push/dogfood.
