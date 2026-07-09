# Ralph model routing: Opus 4.8 for UI, GPT-5.6 Sol for non-UI

- **Task:** `ralph-model-routing-ui-opus48-nonui-gpt56sol`
- **Type:** source-verified implementation brainstorm; no plugin code changed
- **Worktree:** `D:\harness-efforts\codexu\.worktrees\ralph-model-routing`
- **Branch:** `ralph/brainstorm-ralph-model-routing-ui-opus48-nonui-gpt56sol`
- **Base:** `eed3c9156`
- **Plugin baseline:** Ralph `5.62.0`

Bare `src/`, `skills/`, `agents/`, `scripts/`, `schemas/`, and
`.copilot-plugin/` paths are relative to
`ai-developer-toolkit/plugins/ralph/`. Paths beginning `plugins/`,
`.claude-plugin/`, `.github/plugin/`, `.agents/plugins/`, or `tools/` are
relative to `ai-developer-toolkit/`; all other paths are codexu-root relative.

## 1. Verdict

Recommend **D-001: one fail-closed routing module plus explicit
`workSurface` metadata propagated through artifacts, subprocesses, generated
Copilot Task calls, and agent generation**.

The policy is:

| Effective work surface | Required model | Runtime host |
|---|---|---|
| `ui` | `claude-opus-4.8` | Copilot CLI |
| `non-ui` | `gpt-5.6-sol` | Codex CLI or Copilot CLI |
| `mixed`, not split | `claude-opus-4.8` | Copilot CLI |
| `mixed`, split into stories/calls | Per child/story: UI -> Opus; non-UI -> GPT | Per row above |

The work surface, not the selected CLI, must choose the model. The current
implementation instead chooses models through wrapper defaults and engine
branches: Codex is hard-coded to GPT-5.5, Copilot defaults to GPT-5.5, and
several Copilot branches override to Opus 4.7
(`src/codex-exec.mjs:48,126-137`;
`src/copilot-exec.mjs:256-263,338-381`;
`src/ralph.mjs:883-897,934-955`;
`src/review-loop.mjs:823-828,1070-1086`).

This is a **minor behavioral/schema release**, recommended as Ralph `5.63.0`.
There is no planning blocker. The only implementation spike is to prove that a
Copilot `task(..., model="<exact-id>")` override wins over a custom agent YAML
model; if it does not, the generator must emit separate UI/non-UI variants for
the few inheriting agents.

## 2. Policy and current gap

The operator policy requires every direct Copilot Task dispatch to pin an exact
model, routes UI work to `claude-opus-4.8`, routes all non-UI work to
`gpt-5.6-sol`, and sends an unsplittable mixed task to Opus
(`AGENTS.md:806-822`). The tracked task explicitly says to change Ralph runtime,
not just documentation (`.ralph-overview/data.json:1797-1814`).

Current violations are structural:

1. **Codex wrapper:** one module constant forces every invocation to
   `gpt-5.5`; the CLI surface has no model or work-surface argument
   (`ai-developer-toolkit/plugins/ralph/src/codex-exec.mjs:48,126-137,628-634`).
2. **Copilot wrapper:** missing `--model` silently becomes `gpt-5.5`, while an
   arbitrary string is accepted as an override
   (`ai-developer-toolkit/plugins/ralph/src/copilot-exec.mjs:338-381`).
3. **Iteration loop:** model selection is coupled to `iterationEngine`;
   Copilot always receives Opus 4.7 and Codex inherits GPT-5.5
   (`ai-developer-toolkit/plugins/ralph/src/ralph.mjs:883-897,922-955`).
4. **Planning/re-review loop:** `planningEngine` defaults to Codex; the Copilot
   plan-fix branch and the required `copilot-opus` re-review slot pin Opus 4.7,
   while ordinary Codex/Copilot slots inherit GPT-5.5
   (`ai-developer-toolkit/plugins/ralph/src/review-loop.mjs:75-81,648-676,823-828,1070-1086`).
5. **PRD schema:** only engine selection exists. There is no structured UI
   classification, and descriptions encode the GPT-5.5/Opus-4.7 behavior
   (`ai-developer-toolkit/plugins/ralph/schemas/prd-schema.json:6-30,100-118`).
6. **Generated agents:** source aliases are mapped to Sonnet 4.6, Opus 4.7, or
   Haiku 4.5; generated YAML therefore carries disallowed or wrong-surface
   models (`ai-developer-toolkit/plugins/ralph/scripts/generate-copilot-artifacts.mjs:24-33,96-165`;
   `ai-developer-toolkit/plugins/ralph/.copilot-plugin/agents/code-reviewer.agent.yaml:1-5`;
   `ai-developer-toolkit/plugins/ralph/.copilot-plugin/agents/code-fixer.agent.yaml:1-5`).
7. **Generated Task calls:** both skill delegation and Agent lowering omit the
   `model` argument entirely
   (`ai-developer-toolkit/plugins/ralph/scripts/generate-copilot-artifacts.mjs:186-240`).

A tracked scan over `src`, `skills`, `agents`, `scripts`, `schemas`, both
generated trees, and tests/fixtures finds **44 files** containing GPT-5.5,
GPT-5.4, or Opus-4.7 literals. The task seed's 26-file count is therefore a
narrower production/Copilot count, not a safe completion checklist.

## 3. Source of truth versus generated output

### Authored source

- Runtime and policy logic: `plugins/ralph/src/**`
- User/internal skill source: `plugins/ralph/skills/**/SKILL.md`
- Agent bodies and Claude-facing frontmatter: `plugins/ralph/agents/*.md`
- PRD contract: `plugins/ralph/schemas/prd-schema.json`
- Copilot/Codex generators and lowering:
  `plugins/ralph/scripts/generate-copilot-artifacts.mjs` and
  `plugins/ralph/scripts/codex-lowering.mjs`
- Tests, fixtures, `plugins/ralph/AGENTS.md`, and
  `plugins/ralph/CHANGELOG.md`
- **One authored generated-tree exception:** Copilot
  `implement-with-ralph` is a hand fork guarded by source anchors and declared
  parity exceptions
  (`plugins/ralph/scripts/check-copilot-parity.mjs:2-28,79-95`;
  `plugins/ralph/.copilot-plugin/parity-exceptions.json:1-22`).

### Generated output

The generator emits:

- 13 Copilot agent YAML files from `agents/*.md`
- Copilot internal workflows
- Copilot user skills `brainstorm-with-ralph`, `plan-with-ralph`,
  `multi-model-investigate`, and `prepare-handoff`
- All Codex agents, internal workflows, and listed Codex skills, including
  `implement-with-ralph`

The inventories and output boundaries are explicit in
`scripts/generate-copilot-artifacts.mjs:36-39,246-311`. Codex agents are emitted as
source copies, while Codex skills are lowered through the native child-agent
recipes (`scripts/generate-copilot-artifacts.mjs:266-311`).

From the **`ai-developer-toolkit` submodule root**, regenerate both engines with:

```powershell
node plugins/ralph/scripts/generate-copilot-artifacts.mjs --target=all --write
```

`all` is also the default, but the explicit target is less ambiguous
(`scripts/generate-copilot-artifacts.mjs:384-419`).

Do not independently patch generated copies. Update authored source and the
generator first, regenerate, then manually update the Copilot
`implement-with-ralph` hand fork in lockstep.

## 4. Complete runtime model-selection inventory

| Flow | Current routing path | Required change |
|---|---|---|
| Any Codex subprocess | `codex-exec.mjs` hard-codes GPT-5.5 (`src/codex-exec.mjs:48,126-137`) | Require structured surface; resolve only non-UI -> GPT-5.6 Sol; reject UI/mixed in Codex v1 |
| Any Copilot subprocess | `copilot-exec.mjs` defaults GPT-5.5 and accepts arbitrary `--model` (`src/copilot-exec.mjs:338-381`) | Require surface; resolve through allowlist; no arbitrary model selector |
| Per-story implementation | Engine branch chooses model (`src/ralph.mjs:883-955`) | Resolve target story surface, then model; validate engine compatibility before spawn |
| Plan-fix + re-review | Engine/slot names choose GPT-5.5 or Opus 4.7 (`src/review-loop.mjs:648-676,823-828,1070-1086`) | Pass review surface; all participating reviewers use that surface's approved model |
| Brainstorm | Direct general-purpose Agent plus Codex/Copilot wrappers, all without surface metadata (`skills/brainstorm-with-ralph/SKILL.md:117-159`) | Require/inherit `workSurface`; direct Task pins exact model; wrappers receive surface |
| Plan research/review | Generic Explore agents and two wrapper pairs omit model/surface (`skills/plan-with-ralph/SKILL.md:331-403,647-708`) | Propagate surface to each call; mixed whole-plan judgment uses Opus unless explicitly split |
| Multi-model investigation | Codex, Copilot, and general-purpose paths omit model/surface and describe old GPT models (`skills/multi-model-investigate/SKILL.md:89-112`) | Same surface across lenses; preserve role/host diversity, not prohibited-model diversity |
| Change review | Selected custom reviewer plus external Codex/Copilot reviewers (`skills/review-changes/SKILL.md:118-193`) | Code reviewer inherits target surface; docs/security are fixed non-UI |
| Plan review | Initial wrapper and iterative review-loop routing (`skills/review-plan-with-ralph/SKILL.md:127-161,225-237`) | Persist surface in phase config and pass it to review-loop |
| Plan-reviewer agent | Internally launches both wrappers without a surface (`agents/plan-reviewer.md:23-45`) | Read surface from phase config; pass it to both wrappers |
| PRD conversion | Repo detector and criteria validator direct Agents (`skills/convert-to-ralph-prd/SKILL.md:284-288,498-501`) | Repo detector/validator fixed non-UI; converter writes job/story surfaces |
| Implementation orchestration | PRD generator, validator, fixers, docs updater, retrospective fan-out, and many generated Skill-delegation Tasks (`skills/implement-with-ralph/SKILL.md:277-280,530-533,1057-1061,1142-1146,1225-1257`; generated hand fork at `.copilot-plugin/copilot-skills/implement-with-ralph/SKILL.md:48-49,237,546,703,809,1027-1273`) | Add a route entry for every direct call; propagate job/story surface through nested workflow inputs |
| Iteration analysis | Manifest verifier, progress analyst, Story Doctor, and refactoring are prose-only delegations (`skills/analyze-iteration/SKILL.md:90-95,115-119,286-291,397-404`) | Lower to explicit model-pinned Copilot Tasks or add equivalent structured dispatch metadata |
| Workflow-to-workflow Skill delegation | `Skill()` sites in implement, decompose, parallel, list/resume, and plan handoff are lowered by `renderSkillDispatch()` to a general-purpose Task with no model (`skills/implement-with-ralph/SKILL.md:46-48,229-230,684-685,776-778,1005-1156`; `skills/decompose-plan/SKILL.md:216-250`; `skills/parallel-ralph/SKILL.md:142-144`; `skills/list-jobs/SKILL.md:172-189`; `skills/plan-with-ralph/SKILL.md:988-990`; `scripts/generate-copilot-artifacts.mjs:186-208`) | Propagate surface in workflow inputs; generated Task must carry the exact resolved model |
| Generated Agent delegation | `renderAgentDispatch()` creates a Task prefix with no model (`scripts/generate-copilot-artifacts.mjs:210-240`) | Generator uses callsite route metadata to add the exact model |
| Generated custom-agent YAML | `MODEL_MAP` maps Claude aliases to old Copilot models (`scripts/generate-copilot-artifacts.mjs:24-33,128-165`) | Emit only approved exact Copilot model IDs; UI callsites override inherited roles explicitly |
| Native Codex child agents | Lowered recipes explicitly omit model and inherit the parent model (`scripts/codex-lowering.mjs:269-278,320-349,363-395`) | Keep inheritance; ensure the parent Codex session is non-UI GPT-5.6 Sol |

This inventory includes the indirect model paths. Merely replacing four
hard-coded strings would leave generated Tasks, agent YAML, prose-only
delegations, and nested workflow Tasks non-compliant.

## 5. Recommended design

### 5.1 One structured classification

Add the enum:

```text
workSurface = ui | non-ui | mixed
```

Persist it at these boundaries:

1. `brainstorm.json` and selected-direction/plan frontmatter
2. Top-level `prd.json.workSurface`
3. `prd.json.userStories[].workSurface` when the top-level value is `mixed`
4. Plan-review `phase-config.json`
5. Nested internal-workflow inputs where a direct Copilot Task may be spawned

Resolution precedence:

1. Current story's `workSurface`
2. Explicit `--work-surface`
3. Persisted artifact/job `workSurface`
4. **Error** — never infer from prompt text, paths, framework names, or engine

Rules:

- Top-level `ui` or `non-ui`: stories may omit the field and inherit.
- Top-level `mixed`: every executable story must declare `ui`, `non-ui`, or
  `mixed`; a missing story value is an error.
- Story-level `mixed` means that story could not be split and therefore uses
  Opus.
- Whole-plan/whole-diff work over a mixed job uses Opus unless the caller
  supplies separate structured surface slices. The first release need not add
  a new slice-map format; story boundaries already provide the important
  implementation split.

This extends the existing PRD contract, which currently requires no surface
metadata and validates story shape without it
(`schemas/prd-schema.json:6-30,100-118`;
`src/ralph.mjs:341-390`).

### 5.2 Central policy module

Add `plugins/ralph/src/model-routing.mjs` as the only source of approved IDs:

```js
UI_MODEL = "claude-opus-4.8"
NON_UI_MODEL = "gpt-5.6-sol"
```

Exports should include:

- `normalizeWorkSurface(value)` — exact enum validation
- `resolveModelForSurface(surface)` — `ui|mixed` -> Opus, `non-ui` -> GPT
- `assertApprovedModel(model)` — exact two-ID allowlist
- `assertEngineSupportsSurface(engine, surface)`
- `resolveStorySurface(prd, story)` — inheritance and mixed-job validation
- a small CLI mode so generated skill prose can resolve and validate the same
  policy instead of duplicating literals

No environment variable or hidden default may select a third model.

### 5.3 Engine compatibility

Keep engine selection orthogonal to model policy:

| Engine | `non-ui` | `ui` / unsplit `mixed` |
|---|---|---|
| Copilot | allowed, GPT-5.6 Sol | allowed, Opus 4.8 |
| Codex | allowed, GPT-5.6 Sol | reject in this release |
| Deprecated `claude` alias | normalize to Copilot, then apply surface rule | normalize to Copilot, then apply surface rule |

Why UI is Copilot-only in the minimal release:

- Codex child recipes inherit the parent model and intentionally reject a
  per-child model override (`scripts/codex-lowering.mjs:269-278,320-349`).
- The fork's Anthropic support is feature-gated and disabled behavior removes
  persisted Claude model selections; it is not a portable assumption for every
  installed Codex (`.ralph-overview/data.archived.json:503-505`).
- Therefore a UI-through-Codex route would need additional gate/version
  detection and release coupling. It is unnecessary because Copilot already
  hosts both approved models.

PRD creation should choose a compatible default **only after an explicit
surface is known**:

- non-UI -> current engine default may remain Codex
- UI/mixed -> default engine Copilot
- explicit incompatible `iterationEngine=codex` or `planningEngine=codex` ->
  actionable error, not silent engine switching

### 5.4 Fixed versus inherited roles

There is no current Ralph agent that is intrinsically UI-only. UI is a property
of the target job/story.

| Route | Roles/calls | Rationale |
|---|---|---|
| Fixed `non-ui` | criteria-validator, docs-reviewer, docs-updater, progress-analyst, story-doctor, DSAT analyst, skill suggester, follow-up gatherer, repo detector, list/edit/decompose/parallel orchestration, inert security roles | Their authored contracts are criteria validation, docs, bookkeeping/analysis, planning repair, or security rather than UI judgment (`agents/criteria-validator.md:2-6`; `agents/docs-reviewer.md:2-6`; `agents/progress-analyst.md:2-7`; `agents/story-doctor.md:2-6`; `agents/dsat-analyst.md:2-7`; `agents/skill-suggester.md:2-7`; `agents/followup-task-gatherer.md:2-7`) |
| Inherit target surface | code-reviewer, code-fixer, refactoring-agent, manifest-verifier, generic brainstorm/research/architecture/plan-review agents, PRD generator, implementation workflow entry | These roles inspect or mutate the target surface and can therefore perform UI judgment (`agents/code-reviewer.md:2-7`; `agents/code-fixer.md:2-6`; `agents/refactoring-agent.md:2-7`; `agents/manifest-verifier.md:2-7`; `agents/plan-reviewer.md:2-4`) |

Source agent `model: sonnet|opus|haiku` is Claude-facing metadata and should not
be overloaded as Copilot policy. Add a separate generator-consumed field such
as `copilotWorkSurface: non-ui|inherit`. The generator should require it.

For generated Copilot YAML:

- emit an approved exact model, never the current alias map;
- every plugin-owned Task call must still pass `model=` explicitly;
- for `inherit` roles, prove in a live installed-plugin probe that Task's
  explicit model overrides YAML. If not, generate `-ui` and `-non-ui` YAML
  variants from the same source body and select the variant at the callsite.

### 5.5 Structured callsite inventory and drift guard

Do not encode routing only in prose. Add a source inventory, preferably beside
the existing lowering inventories, with stable IDs:

```js
{
  siteId,
  source,
  kind: "wrapper" | "agent-literal" | "agent-prose" | "skill-dispatch",
  surface: "non-ui" | "inherit",
  required: true | false
}
```

The repository already uses exact inventories to prevent Agent-site and
prose-site drift (`scripts/codex-lowering.mjs:79-92,860-917,930-965`), but the
current prose inventory explicitly leaves the analyze-iteration agents
unregistered (`scripts/codex-lowering.mjs:930-949`). Extend this pattern rather
than building a prompt-text classifier.

The generator/check must fail when:

- a new wrapper invocation, `Agent(`, prose delegation, `Skill(`, or generated
  `task(` lacks an inventory entry;
- an `inherit` call cannot resolve a persisted surface;
- any emitted Copilot Task lacks `model=`;
- an emitted model is outside the two-ID allowlist.

## 6. Planning, review, and “multi-model” diversity

The policy allows one model per homogeneous surface, so diversity can no longer
mean “use prohibited models anyway.”

### Non-UI flow

- Codex lens: `gpt-5.6-sol`
- Copilot lens: `gpt-5.6-sol`
- Direct Task/Devil's Advocate: `gpt-5.6-sol`
- Diversity remains in host implementation, prompt, role, tools, and context.

### UI flow

- Copilot wrapper lenses: `claude-opus-4.8`
- Direct Task lenses/reviewers: `claude-opus-4.8`
- Skip Codex participation rather than launching GPT on UI work.
- Diversity remains role/prompt-based.

### Mixed flow

- Split implementation at PRD story boundaries: UI stories use Opus; backend,
  protocol, tests, release, and other non-UI stories use GPT.
- A whole-plan or whole-diff reviewer that cannot be split uses Opus.
- If a future structured surface-slice map is added, independent UI/non-UI
  plan/research lenses may use both approved models in parallel.

The review-loop's required slot is currently named `copilot-opus`, and that key
is persisted in review metadata/tests
(`src/review-loop.mjs:417-420,628-652,1078-1081`). Rename new output to
`copilot-primary` or `policy-primary`, while accepting the old key when reading
historical logs. Otherwise a non-UI GPT reviewer would be mislabeled “Opus.”

## 7. Compatibility and migration

### CLI contract

- Add `--work-surface ui|non-ui|mixed` to user-facing brainstorm, plan,
  investigate, review, conversion, implementation, and run paths where no
  persisted value is available.
- In interactive mode, missing surface may prompt once and persist the answer.
- In autonomous/batch mode, missing surface is an immediate actionable error.
- High-level callers override **surface**, not raw model.
- `codex-exec.mjs` and `copilot-exec.mjs` should accept a required surface and
  resolve through `model-routing.mjs`.
- If raw `--model` is retained for compatibility, it becomes an assertion: it
  must exactly equal the model resolved from the supplied surface. It must not
  select arbitrary models.

### Existing artifacts

Do not silently classify old PRDs as non-UI.

- Existing `prd.json` without `workSurface`: stop before spawning and instruct
  the operator to pass `--work-surface` once; persist it.
- Existing mixed PRD without story classifications: stop and list the story IDs
  needing a value.
- Existing brainstorm/plan artifacts: allow a one-time explicit flag, then
  write the metadata into the next durable artifact.
- The deprecated `claude` engine alias may remain, but warnings must stop naming
  Opus 4.7 and must say the model is resolved from `workSurface`.

### Availability and failure behavior

- Model unavailable/account not entitled: surface the underlying CLI error; no
  fallback to GPT-5.5, `auto`, or another Claude/GPT model.
- Missing Copilot CLI on UI work: hard preflight failure.
- Missing selected CLI on a required implementation/fix path: hard failure.
- Optional/adaptive research or reviewer slot: may remain missing/fail-soft
  under its existing participation contract, but it is skipped rather than
  rerouted to another model.
- Required blocking review slot: hard failure if the approved model cannot run.

## 8. Candidate directions

### D-001 — Central router + structured surface propagation (**recommended**)

Add one policy module, artifact/story surface metadata, a callsite inventory,
generator support, fail-closed wrapper validation, and regenerated artifacts.
This is the smallest direction that covers runtime, generated Task calls,
mixed-story jobs, and future drift.

### D-002 — Literal replacement sweep

Replace GPT-5.5 with GPT-5.6 Sol and Opus 4.7 with Opus 4.8 at current callsites.

**Reject:** engine branches would still decide the model; non-UI Copilot would
incorrectly use Opus, UI Codex would incorrectly use GPT, mixed stories could
not split, missing callsites would keep defaults, and future drift would be
uncontrolled.

### D-003 — Engine-to-model mapping

Declare Codex = GPT and Copilot = Opus.

**Reject:** the operator policy is surface-based, not engine-based. Copilot must
run GPT for non-UI work, while UI through Codex is not safely portable.

## 9. Actionable next-stage plan seed

**Target repository:** `ai-developer-toolkit` submodule.
**Implementation worktree:** create inside the submodule, for example
`ai-developer-toolkit\.worktrees\ralph-model-routing-ui-opus48-nonui-gpt56sol`.
The lead performs the later codexu submodule-pointer/version-table ceremony.

### Story 1 — Policy module and durable classification

Change:

- `plugins/ralph/src/model-routing.mjs` (new)
- `plugins/ralph/schemas/prd-schema.json`
- `plugins/ralph/src/ralph.mjs`
- `plugins/ralph/skills/convert-to-ralph-prd/SKILL.md`
- `plugins/ralph/skills/create-prd/SKILL.md`
- relevant brainstorm/plan artifact-writing sections

Acceptance:

- exact enum and two exact model constants;
- missing/invalid surface fails;
- top-level mixed jobs require per-story classification;
- artifact/PRD propagation has no prompt-text inference.

### Story 2 — Wrapper and core runtime routing

Change:

- `plugins/ralph/src/codex-exec.mjs`
- `plugins/ralph/src/copilot-exec.mjs`
- `plugins/ralph/src/ralph.mjs`
- `plugins/ralph/src/review-loop.mjs`
- `plugins/ralph/skills/run-ralph/SKILL.md`

Acceptance:

- UI/mixed Copilot spawn uses `claude-opus-4.8`;
- non-UI Codex and Copilot spawns use `gpt-5.6-sol`;
- UI+Codex is rejected before child launch;
- no wrapper default and no arbitrary model fallback;
- mixed PRD dispatch changes model between representative UI/non-UI stories.

### Story 3 — Source skills and nested workflow propagation

Change:

- `plugins/ralph/skills/brainstorm-with-ralph/SKILL.md`
- `plugins/ralph/skills/plan-with-ralph/SKILL.md`
- `plugins/ralph/skills/multi-model-investigate/SKILL.md`
- `plugins/ralph/skills/review-plan-with-ralph/SKILL.md`
- `plugins/ralph/skills/review-changes/SKILL.md`
- `plugins/ralph/skills/implement-with-ralph/SKILL.md`
- `plugins/ralph/skills/analyze-iteration/SKILL.md`
- `plugins/ralph/skills/convert-to-ralph-prd/SKILL.md`
- `plugins/ralph/agents/plan-reviewer.md`

Acceptance:

- all wrapper calls receive surface;
- all direct Copilot Task paths can resolve an exact model;
- nested Skill delegations carry surface;
- fixed and inherited roles follow the matrix above;
- review slot identity no longer falsely encodes Opus.

### Story 4 — Generator, callsite inventory, and generated artifacts

Change:

- `plugins/ralph/scripts/generate-copilot-artifacts.mjs`
- `plugins/ralph/scripts/codex-lowering.mjs` or a new routing-site inventory
- source agent frontmatter under `plugins/ralph/agents/*.md`
- generated `.copilot-plugin/**`
- generated `.codex-plugin/**`
- hand-forked
  `plugins/ralph/.copilot-plugin/copilot-skills/implement-with-ralph/SKILL.md`

Acceptance:

- generated YAML contains only approved IDs;
- every generated Copilot `task(` has explicit model routing;
- every dispatch site is inventory-covered;
- generated Codex children inherit a policy-compliant parent model;
- `--target=all --write` followed by both parity checks is clean.

### Story 5 — Regression suite

Change or add targeted tests beside:

- `tests/test-codex-exec.mjs`
- `tests/test-copilot-exec.mjs`
- `tests/test-ralph.mjs`
- `tests/test-review-loop.mjs`
- `tests/test-review-loop-planning-engine.sh`
- `tests/test-review-loop-rereview.sh`
- `tests/test-codex-generator.mjs`
- `tests/test-copilot-generator.sh`
- `tests/test-copilot-readonly-caller-split.mjs`
- affected fixtures

Acceptance:

- exact routing matrix assertions;
- default/invalid/GPT-5.5 rejection;
- mixed story split;
- generated artifact parity;
- source/generated stale-model scan with historical-doc allowlist;
- custom-agent model-override precedence probe.

### Story 6 — Release and installed-path dogfood

Change:

- `plugins/ralph/CHANGELOG.md`
- `plugins/ralph/AGENTS.md`
- all six version stamps listed in section 11
- codexu `AGENTS.md` active-version table and submodule pointer in the lead-owned
  wrapper commit

Acceptance:

- release gates pass;
- `copilot plugin update --all`;
- installed Copilot plugin runs one non-UI flow on GPT-5.6 Sol and one UI flow
  on Opus 4.8;
- Codex wrapper dogfood runs a non-UI flow on GPT-5.6 Sol;
- unavailable-model tests fail closed with no fallback.

## 10. Exact test plan

1. **Router unit tests**
   - `ui -> claude-opus-4.8`
   - `non-ui -> gpt-5.6-sol`
   - `mixed -> claude-opus-4.8`
   - missing/unknown/case-varied values rejected
2. **Wrapper argv**
   - Codex non-UI contains `--model gpt-5.6-sol`
   - Copilot UI contains `--model claude-opus-4.8`
   - Copilot non-UI contains `--model gpt-5.6-sol`
   - GPT-5.5, GPT-5.4, Opus 4.7, `auto`, and arbitrary IDs rejected
3. **Iteration routing**
   - non-UI story through Codex
   - non-UI story through Copilot
   - UI story through Copilot
   - UI story through Codex rejected
   - mixed job with a UI story followed by a non-UI story changes exact model
4. **Review routing**
   - non-UI plan-fix/re-review uses GPT
   - UI plan-fix/re-review uses Opus
   - docs review fixed GPT
   - mixed whole-diff review uses Opus
5. **Migration**
   - old PRD without surface fails with remediation
   - mixed PRD missing story surface lists offending IDs
   - explicit one-time surface persists
6. **Generator**
   - every generated agent YAML model is one of the two exact IDs
   - every real generated Copilot `task()` call carries `model=`
   - adding an unregistered dispatch site fails inventory validation
   - source/generated parity gates pass
7. **No-regression scan**
   - active runtime/generated/test surfaces contain no GPT-5.5, GPT-5.4, or
     Opus-4.7 literal; allow only immutable historical release notes when
     explicitly allowlisted
8. **Installed dogfood**
   - real installed plugin, not only in-tree scripts
   - verify actual selected model from Copilot/Codex logs or emitted routing
     metadata

## 11. Ship surface

Recommended Ralph version: **`5.63.0`**.

All six stamps currently read `5.62.0` and must change together:

1. `ai-developer-toolkit/.claude-plugin/marketplace.json`
2. `ai-developer-toolkit/.github/plugin/marketplace.json`
3. `ai-developer-toolkit/.agents/plugins/marketplace.json`
4. `ai-developer-toolkit/plugins/ralph/.claude-plugin/plugin.json`
5. `ai-developer-toolkit/plugins/ralph/.github/plugin/plugin.json`
6. `ai-developer-toolkit/plugins/ralph/.codex-plugin/plugin.json`

The current locations are source-verified at the marketplace/manifests
(`.claude-plugin/marketplace.json:77-80`;
`.github/plugin/marketplace.json:77-80`;
`.agents/plugins/marketplace.json:140-150`;
`plugins/ralph/.claude-plugin/plugin.json:1-4`;
`plugins/ralph/.github/plugin/plugin.json:1-4`;
`plugins/ralph/.codex-plugin/plugin.json:1-4`). Marketplace synchronization is
mandatory (`ai-developer-toolkit/AGENTS.md:45-66`).

Release checks from the toolkit root:

```powershell
node plugins/ralph/scripts/generate-copilot-artifacts.mjs --check
node plugins/ralph/scripts/check-copilot-parity.mjs
node plugins/ralph/scripts/generate-copilot-artifacts.mjs --target=codex --check
node plugins/ralph/tests/test-codex-generator.mjs
node tools/validate-codex-marketplace-policy.mjs
```

These are the documented Copilot and Codex gates
(`plugins/ralph/AGENTS.md:1244-1254`).

After the toolkit commit is merged/pushed to all toolkit remotes, the lead must
bump the codexu `ai-developer-toolkit` gitlink and the root active-version table
in the same wrapper commit, push wrapper remotes, run
`copilot plugin update --all`, and dogfood the installed path. The canonical
seven-step ceremony is
`ai-developer-toolkit/plugins/ralph/AGENTS.md:640-720`; codexu's table currently
pins Ralph `5.62.0` (`AGENTS.md:21-31`).

## 12. Conflict and risk assessment

| Risk | Level | Mitigation |
|---|---|---|
| Same-plugin concurrent Ralph work touches generator, skills, AGENTS, CHANGELOG, and six version files | High | Serialize this implementation against other `plugins/ralph` releases |
| Missing propagation through nested `Skill()` or prose-only Agent sites | High | Stable callsite inventory + generator drift guard |
| Existing jobs lack classification | High but intentional | One-time explicit migration; autonomous fail closed |
| Custom agent YAML may override Task's explicit model | Medium | Phase-0 installed CLI probe; generate UI/non-UI variants if precedence is wrong |
| UI through Codex depends on Anthropic feature/version state | Medium | V1 routes UI to Copilot only; revisit separately |
| Same approved model across non-UI lenses reduces model diversity | Medium | Preserve host, prompt, role, and context diversity; never violate policy to simulate diversity |
| `copilot-opus` attribution rename affects historical fixtures/log readers | Low-Medium | Write new `copilot-primary`, accept legacy key on read |
| Broad stale-string cleanup may rewrite historical release notes | Low | Scan active surfaces; allowlist immutable history |

## 13. Decisions and blockers

**No operator decision is required to proceed with planning.** Recommended
defaults:

1. UI/unsplit-mixed runs through Copilot only in `5.63.0`.
2. Existing unclassified jobs fail with a one-time remediation instead of
   defaulting.
3. Raw model overrides are removed or reduced to equality assertions.
4. New review attribution uses `copilot-primary` with legacy-read support.
5. If the custom-agent override probe fails, emit UI/non-UI generated variants;
   do not weaken the policy.

Possible future work, not a blocker for this release: support Opus 4.8 through
Codex only after a separate compatibility design covers Codex version,
Anthropic feature enablement, and fail-closed model availability.
