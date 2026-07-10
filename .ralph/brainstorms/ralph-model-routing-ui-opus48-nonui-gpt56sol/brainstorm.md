# Ralph model routing: Opus 4.8 for UI/UX judgment, GPT-5.6 Sol otherwise

- **Task:** `ralph-model-routing-ui-opus48-nonui-gpt56sol`
- **Type:** source-verified implementation brainstorm; no plugin code changed
- **Worktree:** `D:\harness-efforts\codexu\.worktrees\ralph-model-routing`
- **Branch:** `ralph/brainstorm-ralph-model-routing-ui-opus48-nonui-gpt56sol`
- **Base:** `bf977fa70`
- **Plugin baseline:** Ralph `5.62.0`
- **Policy correction incorporated:** `bf977fa70` (`AGENTS.md:806-826`)

Bare `src/`, `skills/`, `agents/`, `scripts/`, `schemas/`, and
`.copilot-plugin/` paths are relative to
`ai-developer-toolkit/plugins/ralph/`. Paths beginning `plugins/`,
`.claude-plugin/`, `.github/plugin/`, `.agents/plugins/`, or `tools/` are
relative to `ai-developer-toolkit/`; all other paths are codexu-root relative.

## 1. Verdict

Recommend **D-001: one fail-closed routing module plus explicit
`uiUxJudgment` metadata propagated through artifacts, subprocesses, generated
Copilot Task calls, and agent generation**.

The policy is:

| Executable unit's `uiUxJudgment` | Meaning | Required model | Runtime host |
|---|---|---|---|
| `required` | The work itself requires visual, interaction, layout, styling, or other UI/UX judgment | `claude-opus-4.8` | Copilot CLI |
| `not-required` | The work itself does not require UI/UX judgment, even if it mentions, touches, or tests through an existing UI | `gpt-5.6-sol` | Codex CLI or Copilot CLI |
| `mixed` | Container classification only: split into executable units and classify each as `required` or `not-required` | Per child/story | Per child/story |

If mixed work cannot be split, classify the unsplit unit by the same binary
question: does **the work itself** require UI/UX judgment? Use Opus only when
the answer is yes; otherwise use Sol. A server/protocol/runtime architecture
task remains `not-required` when an existing web, mobile, desktop, or TUI
surface is merely its acceptance harness (`AGENTS.md:809-822`).

The need for UI/UX judgment—not the selected CLI, mentioned technology,
touched files, or acceptance surface—must choose the model. The current
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
model; if it does not, the generator must emit separate UI-judgment and
no-UI-judgment variants for the few inheriting agents.

## 2. Policy and current gap

The operator policy requires every direct Copilot Task dispatch to pin an exact
model. Work that itself requires UI/UX judgment uses `claude-opus-4.8`; all
other work uses `gpt-5.6-sol`. An existing UI used only for acceptance does not
change a server/protocol/runtime architecture task from `not-required`, and an
unsplit mixed task uses Opus only when the task itself requires UI/UX judgment
(`AGENTS.md:806-826`). The tracked task explicitly says to change Ralph runtime,
not just documentation (`.ralph-overview/data.json:1797-1814`).

Current violations are structural:

1. **Codex wrapper:** one module constant forces every invocation to
   `gpt-5.5`; the CLI surface has no model or UI/UX-judgment argument
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
5. **PRD schema:** only engine selection exists. There is no structured
   UI/UX-judgment classification, and descriptions encode the
   GPT-5.5/Opus-4.7 behavior
   (`ai-developer-toolkit/plugins/ralph/schemas/prd-schema.json:6-30,100-118`).
6. **Generated agents:** source aliases are mapped to Sonnet 4.6, Opus 4.7, or
   Haiku 4.5; generated YAML therefore carries disallowed or wrong-class
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
| Any Codex subprocess | `codex-exec.mjs` hard-codes GPT-5.5 (`src/codex-exec.mjs:48,126-137`) | Require `uiUxJudgment`; resolve only `not-required` -> GPT-5.6 Sol; reject `required` and unresolved `mixed` in Codex v1 |
| Any Copilot subprocess | `copilot-exec.mjs` defaults GPT-5.5 and accepts arbitrary `--model` (`src/copilot-exec.mjs:338-381`) | Require `uiUxJudgment`; resolve through the two-ID allowlist; no arbitrary model selector |
| Per-story implementation | Engine branch chooses model (`src/ralph.mjs:883-955`) | Resolve the target story's UI/UX-judgment requirement, then model; validate engine compatibility before spawn |
| Plan-fix + re-review | Engine/slot names choose GPT-5.5 or Opus 4.7 (`src/review-loop.mjs:648-676,823-828,1070-1086`) | Pass the review task's judgment classification; use Opus only when that review itself requires UI/UX judgment |
| Brainstorm | Direct general-purpose Agent plus Codex/Copilot wrappers, all without judgment metadata (`skills/brainstorm-with-ralph/SKILL.md:117-159`) | Require/inherit `uiUxJudgment`; direct Task pins the exact model; wrappers receive the classification |
| Plan research/review | Generic Explore agents and two wrapper pairs omit model/classification (`skills/plan-with-ralph/SKILL.md:331-403,647-708`) | Propagate the judgment classification to each call; a UI acceptance harness alone remains `not-required` |
| Multi-model investigation | Codex, Copilot, and general-purpose paths omit model/classification and describe old GPT models (`skills/multi-model-investigate/SKILL.md:89-112`) | Use the same resolved judgment classification across lenses; preserve role/host diversity, not prohibited-model diversity |
| Change review | Selected custom reviewer plus external Codex/Copilot reviewers (`skills/review-changes/SKILL.md:118-193`) | Code reviewer inherits whether the review requires UI/UX judgment; docs/security are fixed `not-required` |
| Plan review | Initial wrapper and iterative review-loop routing (`skills/review-plan-with-ralph/SKILL.md:127-161,225-237`) | Persist `uiUxJudgment` in phase config and pass it to review-loop |
| Plan-reviewer agent | Internally launches both wrappers without a classification (`agents/plan-reviewer.md:23-45`) | Read `uiUxJudgment` from phase config and pass it to both wrappers |
| PRD conversion | Repo detector and criteria validator direct Agents (`skills/convert-to-ralph-prd/SKILL.md:284-288,498-501`) | Repo detector/validator fixed `not-required`; converter writes job/story judgment metadata |
| Implementation orchestration | PRD generator, validator, fixers, docs updater, retrospective fan-out, and many generated Skill-delegation Tasks (`skills/implement-with-ralph/SKILL.md:277-280,530-533,1057-1061,1142-1146,1225-1257`; generated hand fork at `.copilot-plugin/copilot-skills/implement-with-ralph/SKILL.md:48-49,237,546,703,809,1027-1273`) | Add a route entry for every direct call; propagate job/story `uiUxJudgment` through nested workflow inputs |
| Iteration analysis | Manifest verifier, progress analyst, Story Doctor, and refactoring are prose-only delegations (`skills/analyze-iteration/SKILL.md:90-95,115-119,286-291,397-404`) | Lower to explicit model-pinned Copilot Tasks or add equivalent structured dispatch metadata |
| Workflow-to-workflow Skill delegation | `Skill()` sites in implement, decompose, parallel, list/resume, and plan handoff are lowered by `renderSkillDispatch()` to a general-purpose Task with no model (`skills/implement-with-ralph/SKILL.md:46-48,229-230,684-685,776-778,1005-1156`; `skills/decompose-plan/SKILL.md:216-250`; `skills/parallel-ralph/SKILL.md:142-144`; `skills/list-jobs/SKILL.md:172-189`; `skills/plan-with-ralph/SKILL.md:988-990`; `scripts/generate-copilot-artifacts.mjs:186-208`) | Propagate `uiUxJudgment` in workflow inputs; generated Task must carry the exact resolved model |
| Generated Agent delegation | `renderAgentDispatch()` creates a Task prefix with no model (`scripts/generate-copilot-artifacts.mjs:210-240`) | Generator uses callsite route metadata to add the exact model |
| Generated custom-agent YAML | `MODEL_MAP` maps Claude aliases to old Copilot models (`scripts/generate-copilot-artifacts.mjs:24-33,128-165`) | Emit only approved exact Copilot model IDs; callsites that require UI/UX judgment override inherited roles explicitly |
| Native Codex child agents | Lowered recipes explicitly omit model and inherit the parent model (`scripts/codex-lowering.mjs:269-278,320-349,363-395`) | Keep inheritance; ensure the parent Codex session is `not-required` GPT-5.6 Sol |

This inventory includes the indirect model paths. Merely replacing four
hard-coded strings would leave generated Tasks, agent YAML, prose-only
delegations, and nested workflow Tasks non-compliant.

## 5. Recommended design

### 5.1 One structured UI/UX-judgment classification

Add the enum:

```text
uiUxJudgment = required | not-required | mixed
```

Persist it at these boundaries:

1. `brainstorm.json` and selected-direction/plan frontmatter
2. Top-level `prd.json.uiUxJudgment`
3. `prd.json.userStories[].uiUxJudgment` when the top-level value is `mixed`
4. Plan-review `phase-config.json`
5. Nested internal-workflow inputs where a direct Copilot Task may be spawned

Resolution precedence:

1. Current story's `uiUxJudgment`
2. Explicit `--ui-ux-judgment`
3. Persisted artifact/job `uiUxJudgment`
4. **Error** — never infer from prompt text, file extensions, framework names,
   UI mentions, acceptance-test surface, or selected engine

Rules:

- `required` means the task itself must make or assess visual, interaction,
  layout, styling, presentation, or other UI/UX decisions.
- `not-required` means it does not. A server, protocol, runtime, security,
  build, or architecture task stays `not-required` when it merely drives an
  existing web/mobile/desktop/TUI surface for acceptance
  (`AGENTS.md:813-822`).
- Top-level `required` or `not-required`: stories may omit the field and
  inherit.
- Top-level `mixed`: every executable story must declare `required` or
  `not-required`; a missing value or story-level `mixed` is an error.
- If a combined unit cannot be split, the author must resolve it to
  `required` or `not-required` by asking whether that unit itself needs UI/UX
  judgment. There is no blanket `mixed -> Opus` mapping.
- A whole-plan or whole-diff call uses Opus only when that call itself must
  judge UI/UX. Merely reviewing an architecture whose acceptance test opens an
  existing app or TUI remains `not-required` -> Sol.

Examples:

| Work | `uiUxJudgment` | Model |
|---|---|---|
| Design a per-daemon server/protocol, verify it through the existing Happy web app | `not-required` | GPT-5.6 Sol |
| Change a CLI runtime, smoke-test it through the existing TUI | `not-required` | GPT-5.6 Sol |
| Design React layout, interaction flow, e-ink affordances, or terminal presentation | `required` | Opus 4.8 |
| Backend plus a new UI flow | Split stories: backend `not-required`, UI flow `required` | Sol + Opus |
| Unsplit backend/UI task that must make UX decisions | `required` | Opus 4.8 |

This extends the existing PRD contract, which currently requires no judgment
metadata and validates story shape without it
(`schemas/prd-schema.json:6-30,100-118`;
`src/ralph.mjs:341-390`).

### 5.2 Central policy module

Add `plugins/ralph/src/model-routing.mjs` as the only source of approved IDs:

```js
UI_UX_JUDGMENT_MODEL = "claude-opus-4.8"
NO_UI_UX_JUDGMENT_MODEL = "gpt-5.6-sol"
```

Exports should include:

- `normalizeUiUxJudgment(value)` — exact enum validation
- `resolveModelForUiUxJudgment(value)` — `required` -> Opus,
  `not-required` -> GPT, unresolved `mixed` -> error
- `assertApprovedModel(model)` — exact two-ID allowlist
- `assertEngineSupportsUiUxJudgment(engine, value)`
- `resolveStoryUiUxJudgment(prd, story)` — inheritance and mixed-job validation
- a small CLI mode so generated skill prose can resolve and validate the same
  policy instead of duplicating literals

No environment variable or hidden default may select a third model.

### 5.3 Engine compatibility

Keep engine selection orthogonal to model policy:

| Engine | `not-required` | `required` | unresolved `mixed` |
|---|---|---|---|
| Copilot | allowed, GPT-5.6 Sol | allowed, Opus 4.8 | reject until split/resolved |
| Codex | allowed, GPT-5.6 Sol | reject in this release | reject until split/resolved |
| Deprecated `claude` alias | normalize to Copilot, then apply judgment rule | normalize to Copilot, then apply judgment rule | reject until split/resolved |

Why UI/UX-judgment work is Copilot-only in the minimal release:

- Codex child recipes inherit the parent model and intentionally reject a
  per-child model override (`scripts/codex-lowering.mjs:269-278,320-349`).
- The fork's Anthropic support is feature-gated and disabled behavior removes
  persisted Claude model selections; it is not a portable assumption for every
  installed Codex (`.ralph-overview/data.archived.json:503-505`).
- Therefore routing `required` work through Codex would need additional
  gate/version detection and release coupling. It is unnecessary because
  Copilot already hosts both approved models.

PRD creation should choose a compatible default **only after an explicit
judgment classification is known**:

- `not-required` -> current engine default may remain Codex
- `required` -> default engine Copilot
- `mixed` -> no container-level engine default; split or resolve each
  executable unit first
- explicit incompatible `iterationEngine=codex` or `planningEngine=codex` ->
  actionable error, not silent engine switching

### 5.4 Fixed versus inherited roles

There is no current Ralph agent that is intrinsically UI/UX-only. The
classification belongs to the work the call must perform, not the files it
touches or the UI used to exercise the result.

| Route | Roles/calls | Rationale |
|---|---|---|
| Fixed `not-required` | criteria-validator, docs-reviewer, docs-updater, progress-analyst, story-doctor, DSAT analyst, skill suggester, follow-up gatherer, repo detector, list/edit/decompose/parallel orchestration, inert security roles | Their authored contracts are criteria validation, docs, bookkeeping/analysis, planning repair, or security rather than UI/UX judgment (`agents/criteria-validator.md:2-6`; `agents/docs-reviewer.md:2-6`; `agents/progress-analyst.md:2-7`; `agents/story-doctor.md:2-6`; `agents/dsat-analyst.md:2-7`; `agents/skill-suggester.md:2-7`; `agents/followup-task-gatherer.md:2-7`) |
| Inherit target unit's `uiUxJudgment` | code-reviewer, code-fixer, refactoring-agent, manifest-verifier, generic brainstorm/research/architecture/plan-review agents, PRD generator, implementation workflow entry | These roles may or may not require UI/UX judgment depending on their assigned work. Architecture through an existing UI acceptance harness remains `not-required`; actual UI/UX design or review is `required` (`agents/code-reviewer.md:2-7`; `agents/code-fixer.md:2-6`; `agents/refactoring-agent.md:2-7`; `agents/manifest-verifier.md:2-7`; `agents/plan-reviewer.md:2-4`) |

Source agent `model: sonnet|opus|haiku` is Claude-facing metadata and should not
be overloaded as Copilot policy. Add a separate generator-consumed field such
as `copilotUiUxJudgment: not-required|inherit`. The generator should require it.

For generated Copilot YAML:

- emit an approved exact model, never the current alias map;
- every plugin-owned Task call must still pass `model=` explicitly;
- for `inherit` roles, prove in a live installed-plugin probe that Task's
  explicit model overrides YAML. If not, generate `-ui-judgment` and
  `-no-ui-judgment` YAML variants from the same source body and select the
  variant at the callsite.

### 5.5 Structured callsite inventory and drift guard

Do not encode routing only in prose. Add a source inventory, preferably beside
the existing lowering inventories, with stable IDs:

```js
{
  siteId,
  source,
  kind: "wrapper" | "agent-literal" | "agent-prose" | "skill-dispatch",
  uiUxJudgment: "not-required" | "inherit",
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
- an `inherit` call cannot resolve persisted `uiUxJudgment`;
- an unresolved `mixed` value reaches an executable dispatch;
- any emitted Copilot Task lacks `model=`;
- an emitted model is outside the two-ID allowlist.

## 6. Planning, review, and “multi-model” diversity

The policy allows one model per resolved judgment class, so diversity can no
longer mean “use prohibited models anyway.”

### `not-required` flow

- Codex lens: `gpt-5.6-sol`
- Copilot lens: `gpt-5.6-sol`
- Direct Task/Devil's Advocate: `gpt-5.6-sol`
- Server/protocol/runtime architecture remains in this flow when an existing
  UI or TUI is only its acceptance harness.
- Diversity remains in host implementation, prompt, role, tools, and context.

### `required` UI/UX-judgment flow

- Copilot wrapper lenses: `claude-opus-4.8`
- Direct Task lenses/reviewers: `claude-opus-4.8`
- Use this flow for actual layout, styling, interaction, presentation, visual
  QA, e-ink UX, or equivalent judgment—not because a task happens to touch UI
  code or launch an app.
- Skip Codex participation rather than launching GPT on work that requires
  UI/UX judgment.
- Diversity remains role/prompt-based.

### `mixed` job flow

- Split at PRD story/call boundaries: units requiring UI/UX judgment use Opus;
  backend, protocol, runtime, tests, release, and other units that do not use
  GPT.
- An unsplit call uses Opus only if that call itself requires UI/UX judgment.
  Otherwise it uses Sol, even if its acceptance test goes through an existing
  web/mobile/desktop/TUI surface (`AGENTS.md:817-822`).
- A whole-plan or whole-diff reviewer follows the same rule. The existence of
  a UI acceptance path is not enough to classify the review as `required`.
- If a future structured judgment-slice map is added, independent
  `required`/`not-required` plan or research lenses may use both approved
  models in parallel.

The review-loop's required slot is currently named `copilot-opus`, and that key
is persisted in review metadata/tests
(`src/review-loop.mjs:417-420,628-652,1078-1081`). Rename new output to
`copilot-primary` or `policy-primary`, while accepting the old key when reading
historical logs. Otherwise a `not-required` GPT reviewer would be mislabeled
“Opus.”

## 7. Compatibility and migration

### CLI and help contract

- Add `--ui-ux-judgment required|not-required|mixed` to user-facing brainstorm, plan,
  investigate, review, conversion, implementation, and run paths where no
  persisted value is available.
- Help copy must say: “Classify whether the work itself requires UI/UX
  judgment. Merely using an existing web/mobile/desktop/TUI surface for
  acceptance is `not-required`.”
- In interactive mode, prompt: “Does this work itself require visual,
  interaction, layout, styling, presentation, or other UI/UX judgment?
  `required`, `not-required`, or `mixed`.” Persist the answer.
- In autonomous/batch mode, missing classification is an immediate actionable
  error.
- High-level callers override **judgment classification**, not raw model.
- `codex-exec.mjs` and `copilot-exec.mjs` should accept a required
  `uiUxJudgment` and resolve through `model-routing.mjs`.
- If raw `--model` is retained for compatibility, it becomes an assertion: it
  must exactly equal the model resolved from the supplied judgment
  classification. It must not select arbitrary models.

### Existing artifacts

Do not silently classify old PRDs.

- Existing `prd.json` without `uiUxJudgment`: stop before spawning and instruct
  the operator to pass `--ui-ux-judgment` once; persist it.
- Existing mixed PRD without story classifications: stop and list the story IDs
  needing `required` or `not-required`.
- Existing brainstorm/plan artifacts: allow a one-time explicit flag, then
  write the metadata into the next durable artifact.
- The deprecated `claude` engine alias may remain, but warnings must stop naming
  Opus 4.7 and must say the model is resolved from `uiUxJudgment`.

### Availability and failure behavior

- Model unavailable/account not entitled: surface the underlying CLI error; no
  fallback to GPT-5.5, `auto`, or another Claude/GPT model.
- Missing Copilot CLI on `required` work: hard preflight failure.
- Missing selected CLI on a required implementation/fix path: hard failure.
- Optional/adaptive research or reviewer slot: may remain missing/fail-soft
  under its existing participation contract, but it is skipped rather than
  rerouted to another model.
- Required blocking review slot: hard failure if the approved model cannot run.

## 8. Candidate directions

### D-001 — Central router + structured UI/UX-judgment propagation (**recommended**)

Add one policy module, artifact/story `uiUxJudgment` metadata, a callsite
inventory, generator support, fail-closed wrapper validation, and regenerated
artifacts. This is the smallest direction that covers runtime, generated Task
calls, mixed-story jobs, the acceptance-surface distinction, and future drift.

### D-002 — Literal replacement sweep

Replace GPT-5.5 with GPT-5.6 Sol and Opus 4.7 with Opus 4.8 at current callsites.

**Reject:** engine branches would still decide the model; Copilot could
incorrectly use Opus for server architecture merely tested through a UI,
mixed stories could not split, missing callsites would keep defaults, and
future drift would be uncontrolled.

### D-003 — Engine-to-model mapping

Declare Codex = GPT and Copilot = Opus.

**Reject:** the operator policy is based on whether work itself requires UI/UX
judgment, not engine or acceptance surface. Copilot must run GPT for
`not-required` work, while Opus through Codex is not safely portable.

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

- exact `uiUxJudgment = required|not-required|mixed` enum and two exact model
  constants;
- missing/invalid classification and executable `mixed` fail closed;
- top-level mixed jobs require per-story `required|not-required`;
- artifact/PRD propagation has no prompt-text, touched-file, or
  acceptance-surface inference;
- server/protocol/runtime architecture with an existing UI/TUI acceptance
  harness is documented as `not-required`.

### Story 2 — Wrapper and core runtime routing

Change:

- `plugins/ralph/src/codex-exec.mjs`
- `plugins/ralph/src/copilot-exec.mjs`
- `plugins/ralph/src/ralph.mjs`
- `plugins/ralph/src/review-loop.mjs`
- `plugins/ralph/skills/run-ralph/SKILL.md`

Acceptance:

- `required` Copilot spawn uses `claude-opus-4.8`;
- `not-required` Codex and Copilot spawns use `gpt-5.6-sol`;
- `required`+Codex and unresolved `mixed` are rejected before child launch;
- no wrapper default and no arbitrary model fallback;
- mixed PRD dispatch changes model between representative
  `required`/`not-required` stories;
- a server architecture story verified through the existing Happy web app
  dispatches to GPT-5.6 Sol.

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

- all wrapper calls receive `uiUxJudgment`;
- all direct Copilot Task paths can resolve an exact model;
- nested Skill delegations carry the judgment classification;
- fixed and inherited roles follow the matrix above;
- CLI/help copy asks whether the work itself requires UI/UX judgment and
  explicitly says an existing UI acceptance surface does not;
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
- every dispatch site is inventory-covered as fixed `not-required` or
  inherited `uiUxJudgment`;
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

- exact `required`/`not-required` routing matrix assertions;
- default/invalid/GPT-5.5 rejection;
- mixed story split and unresolved-mixed rejection;
- acceptance-only web/mobile/TUI examples route to GPT-5.6 Sol;
- actual layout/interaction/presentation examples route to Opus 4.8;
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
- installed Copilot plugin runs one `not-required` flow on GPT-5.6 Sol and one
  `required` UI/UX-judgment flow on Opus 4.8;
- Codex wrapper dogfood runs a `not-required` flow on GPT-5.6 Sol;
- installed help text and a live acceptance-only architecture dogfood prove
  that merely opening an existing UI/TUI does not select Opus;
- unavailable-model tests fail closed with no fallback.

## 10. Exact test plan

1. **Router unit tests**
   - `required -> claude-opus-4.8`
   - `not-required -> gpt-5.6-sol`
   - unresolved `mixed` rejects instead of selecting a model
   - missing/unknown/case-varied values rejected
2. **Classification examples**
   - server/protocol/runtime architecture tested through an existing web app
     -> `not-required` -> GPT-5.6 Sol
   - CLI runtime smoke-tested through an existing TUI -> `not-required` ->
     GPT-5.6 Sol
   - React/React Native layout or interaction design -> `required` -> Opus 4.8
   - terminal/TUI presentation or interaction design -> `required` -> Opus 4.8
   - backend plus new UX splits into `not-required` and `required` children
   - unsplit combined work with actual UX decisions -> `required`; unsplit
     work with only an existing UI acceptance harness -> `not-required`
3. **Wrapper argv**
   - Codex `not-required` contains `--model gpt-5.6-sol`
   - Copilot `required` contains `--model claude-opus-4.8`
   - Copilot `not-required` contains `--model gpt-5.6-sol`
   - Codex `required` and either engine's unresolved `mixed` reject
   - GPT-5.5, GPT-5.4, Opus 4.7, `auto`, and arbitrary IDs rejected
4. **Iteration routing**
   - `not-required` story through Codex
   - `not-required` story through Copilot
   - `required` story through Copilot
   - `required` story through Codex rejected
   - mixed job with a `required` story followed by a `not-required` story
     changes exact model
   - architecture story with existing Happy web acceptance stays GPT-5.6 Sol
5. **Review routing**
   - `not-required` plan-fix/re-review uses GPT
   - UI/UX-judgment plan-fix/re-review uses Opus
   - docs review fixed GPT
   - mixed whole-diff review uses Opus only when the review itself must assess
     UI/UX; acceptance-only architecture review uses GPT
6. **CLI/help and migration**
   - help explicitly distinguishes UI/UX judgment from UI acceptance
   - old PRD without `uiUxJudgment` fails with remediation
   - mixed PRD missing story classification lists offending IDs
   - story-level `mixed` is rejected
   - explicit one-time classification persists
7. **Generator**
   - every generated agent YAML model is one of the two exact IDs
   - every real generated Copilot `task()` call carries `model=`
   - adding an unregistered dispatch site fails inventory validation
   - source/generated parity gates pass
8. **No-regression scan**
   - active runtime/generated/test surfaces contain no GPT-5.5, GPT-5.4, or
     Opus-4.7 literal; allow only immutable historical release notes when
     explicitly allowlisted
9. **Installed dogfood**
   - real installed plugin, not only in-tree scripts
   - verify actual selected model from Copilot/Codex logs or emitted routing
     metadata
   - run a server/runtime architecture scenario through an existing UI/TUI and
     verify GPT-5.6 Sol
   - run a real layout/interaction judgment scenario and verify Opus 4.8

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
| Classifying by touched UI files or acceptance harness instead of required judgment | High | Use `uiUxJudgment`, explicit help/examples, and acceptance-only regression tests |
| Existing jobs lack classification | High but intentional | One-time explicit migration; autonomous fail closed |
| Custom agent YAML may override Task's explicit model | Medium | Phase-0 installed CLI probe; generate UI-judgment/no-UI-judgment variants if precedence is wrong |
| Opus through Codex depends on Anthropic feature/version state | Medium | V1 routes `required` work to Copilot only; revisit separately |
| Same approved model across `not-required` lenses reduces model diversity | Medium | Preserve host, prompt, role, and context diversity; never violate policy to simulate diversity |
| `copilot-opus` attribution rename affects historical fixtures/log readers | Low-Medium | Write new `copilot-primary`, accept legacy key on read |
| Broad stale-string cleanup may rewrite historical release notes | Low | Scan active surfaces; allowlist immutable history |

## 13. Decisions and blockers

**No operator decision is required to proceed with planning.** Recommended
defaults:

1. `required` UI/UX-judgment work runs through Copilot only in `5.63.0`;
   `not-required` work uses GPT-5.6 Sol even when an existing UI/TUI is its
   acceptance harness.
2. `mixed` is container-only. Split when practical; otherwise resolve the
   executable unit to `required` or `not-required` from the judgment it needs.
3. Existing unclassified jobs fail with a one-time remediation instead of
   defaulting.
4. Raw model overrides are removed or reduced to equality assertions.
5. New review attribution uses `copilot-primary` with legacy-read support.
6. If the custom-agent override probe fails, emit UI-judgment/no-UI-judgment
   generated variants; do not weaken the policy.

Possible future work, not a blocker for this release: support Opus 4.8 through
Codex only after a separate compatibility design covers Codex version,
Anthropic feature enablement, and fail-closed model availability.
