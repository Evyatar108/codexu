# Findings: can codex workflows replace `ralph-orchestration` and make phases user-extensible?

## Verdict

**PARTIAL-REPLACE.** A codex workflows product can plausibly absorb the **root-owned, autonomous** parts of Ralph (parallel lens fan-out, plan review/re-review, reviewer/fixer/retrospective pipelines), but it **cannot fully replace** today's Ralph system or make Ralph-class phases user-extensible from workflow data **with the current codex runtime model**. The three hardest blockers are:

1. **No true nested workflow recursion today.** Codex child-agent spawning is effectively **root-only** in this fork: `spawn_agent` rejects subagent sessions, and the default agent-depth limit is `1`. That means a spawned child cannot itself drive another agent graph the way Ralph's nested phases imply. `codex-rs\core\src\tools\handlers\multi_agents_v2\spawn.rs:57-63,253-263`; `codex-rs\core\src\config\mod.rs:188-196`; `codex-rs\core\src\agent\registry.rs:71-76`; `codex-rs\core\src\session\mod.rs:488-494`
2. **No workflow-run persistence / resume product yet.** Codex today has thread persistence and multi-agent tools, but no `/workflows` runtime, no persisted workflow-run registry, and no resume contract for a partially completed orchestration DAG. `.ralph\investigations\codex-cli-vs-claude-code-workflows-parity\findings.md:21-31,49-53,57-75`; `codex-rs\sdk\typescript\src\codex.ts:29-37`
3. **Ralph's convergence loops are richer than a flat phase list.** `review-loop.mjs` and `implement-with-ralph` both depend on runtime-decided loop exits (clean, soft-cap, plateau, hard-cap, prd-worthy short-circuit, failed-review guard, synthesis-drop replan). A simple declarative phase sequence is not enough. `ai-developer-toolkit\plugins\ralph\src\review-loop.mjs:193-466`; `ai-developer-toolkit\plugins\ralph\skills\implement-with-ralph\SKILL.md:993-1175,1274-1379`

So: **use Ralph as the canonical complex design benchmark for the workflows MVP, but do not claim MVP-level full replacement.**

---

## Ralph's real phase tree from source

Ralph is not a flat `plan -> implement -> done` pipeline. It is a nested orchestration tree with runtime loops, phase-specific state, and subagent fan-out.

```text
brainstorm-with-ralph
├─ Phase 1 parse/frame
├─ Phase 2 parallel lenses
│  ├─ Devil's Advocate agent
│  ├─ Codex lens
│  └─ Copilot lens
└─ Phase 3 synthesis -> selected-direction.md handoff

plan-with-ralph
├─ Phase 1 parse/gate
├─ Phase 2 parallel research
├─ Phase 3 draft plan + suggested-decomposition sidecar
└─ Phase 4 multi-model review
   ├─ Claude plan reviewer
   ├─ Codex review
   ├─ Copilot review
   └─ review-loop.mjs convergence

implement-with-ralph
├─ Setup / optional plan import / PRD generation
│  ├─ convert-to-ralph-prd
│  │  ├─ repo-detector Explore agent
│  │  └─ criteria-validator
│  └─ Phase 2.7 criteria-validator safety pass
├─ Phase 3 execute
│  └─ run-ralph / ralph.mjs
│     └─ fresh iteration agent per story
├─ Phase 3.5 analyze-iteration
│  ├─ manifest-verifier
│  ├─ progress-analyst
│  ├─ deferred-question handling
│  ├─ auto-rollback
│  ├─ retry gate
│  ├─ story-doctor
│  ├─ quality gate
│  └─ refactoring pass
├─ Phase 4 completion gate
└─ Finalization
   ├─ Phase 5a code review-fix convergence
   │  ├─ review-changes (Claude + optional Codex/Copilot review)
   │  ├─ code-fixer per finding
   │  └─ re-review / plateau / prd-worthy short-circuit
   ├─ Phase 5b docs review-fix convergence
   │  ├─ review-changes (docs scope)
   │  └─ docs-updater per finding
   ├─ Phase 5.5 retrospectives
   │  ├─ dsat-analyst
   │  ├─ skill-suggester
   │  └─ followup-task-gatherer
   └─ Phase 6 terminal routing
      ├─ failed-review blocked exit
      ├─ synthesis-drop replan exit
      ├─ prd-worthy replan exit
      ├─ accept-open-findings exit
      └─ parallel PR handoff on complete path
```

### Source evidence for the tree

- **Brainstorm is already a nested parallel workflow.** It explicitly launches three parallel lenses in one step: Devil's Advocate via `Agent(...)`, plus Codex and Copilot shell lenses, then synthesizes their staged outputs into `brainstorm-synthesis.md` / `brainstorm.json` for downstream planning. `ai-developer-toolkit\plugins\ralph\skills\brainstorm-with-ralph\SKILL.md:9-16,113-189,223-259`
- **Plan is not just drafting.** It produces a reviewed plan plus a machine-readable `suggested-decomposition.json` handoff, then runs a multi-model review phase with Claude/Codex/Copilot and a `review-loop.mjs` convergence pass. `ai-developer-toolkit\plugins\ralph\skills\plan-with-ralph\SKILL.md:9-16,528-566,620-760`
- **Implementation setup includes PRD conversion as its own subworkflow.** `implement-with-ralph` routes through PRD generation before execution, and `convert-to-ralph-prd` itself delegates target-repo detection to an Explore agent and writes the execution contract into `prd.json`. `ai-developer-toolkit\plugins\ralph\skills\implement-with-ralph\SKILL.md:73-89`; `ai-developer-toolkit\plugins\ralph\skills\convert-to-ralph-prd\SKILL.md:247-304,329-404`
- **Phase 3 is a repeated agent loop, not a single call.** `run-ralph` invokes `src\ralph.mjs`, which spawns a fresh per-story iteration agent, records accounting, updates `job-state.json`, and loops until `<promise>COMPLETE</promise>` or a pause/iteration cap. `ai-developer-toolkit\plugins\ralph\skills\run-ralph\SKILL.md:104-141`; `ai-developer-toolkit\plugins\ralph\src\ralph.mjs:184-268`
- **Phase 3.5 is another nested workflow.** `analyze-iteration` runs manifest-verifier, progress-analyst, deferred-question handling, auto-rollback, retry gating, Story Doctor, Quality Gate, and refactoring logic between story batches. `ai-developer-toolkit\plugins\ralph\skills\implement-with-ralph\SKILL.md:750-794`; `ai-developer-toolkit\plugins\ralph\skills\analyze-iteration\SKILL.md:29-111,115-355`
- **Phase 5a/5b are genuine convergence loops.** `implement-with-ralph` defines the review-fix loops, while `review-loop.mjs` shows the runtime shape: open-findings scan, highest-severity target, fix attempt, manifest update, optional multi-reviewer re-review, plateau detection, soft-cap, and hard-cap exits. `ai-developer-toolkit\plugins\ralph\skills\implement-with-ralph\SKILL.md:993-1175`; `ai-developer-toolkit\plugins\ralph\src\review-loop.mjs:193-466,637-705`
- **Phase 5.5 is explicit parallel retrospective fan-out.** It launches `dsat-analyst`, `skill-suggester`, and `followup-task-gatherer` in one message for parallel execution, in both single-job and group mode. `ai-developer-toolkit\plugins\ralph\skills\implement-with-ralph\SKILL.md:1215-1270`; `ai-developer-toolkit\plugins\ralph\agents\followup-task-gatherer.md:10-69`
- **Phase 6 is another branching state machine, not "done".** It contains blocked-terminal handling, reviewer-text scan/replan, `hasPrdWorthy` routing, open-findings accept vs replan, and parallel PR handoff. `ai-developer-toolkit\plugins\ralph\skills\implement-with-ralph\SKILL.md:1274-1505`

### Where codex-native child-agent fan-out already appears in Ralph

- Ralph's codex lowering layer explicitly maps many `Agent(...)` sites to codex multi-agent recipes, and its inventory shows that implementation work already depends on codex child agents for `criteria-validator`, `code-fixer`, `dsat-analyst`, `skill-suggester`, and `followup-task-gatherer`. `ai-developer-toolkit\plugins\ralph\scripts\codex-lowering.mjs:52-92,201-301,320-358`
- The same lowering layer documents that the **write/review** sites (PRD generation and review children) needed special prose-site lowering because they are not simple literal `Agent(...)` blocks. `ai-developer-toolkit\plugins\ralph\AGENTS.md:33-39`

---

## 7-point assessment against the codex workflow/runtime model

### 1. Nested sub-workflows / recursion

**Current answer: no, not with the existing child-agent surface.**

- The patched fork's `spawn_agent` v2 handler explicitly rejects subagent sessions, so a child agent cannot itself call `spawn_agent`. `codex-rs\core\src\tools\handlers\multi_agents_v2\spawn.rs:57-63`
- The default depth cap is still `1`, and the helper functions treat any deeper thread spawn as over the limit. `codex-rs\core\src\config\mod.rs:188-196`; `codex-rs\core\src\agent\registry.rs:71-76`
- Session/control code also disables or strips spawn surfaces at/over the depth boundary on non-v2 paths. `codex-rs\core\src\session\mod.rs:488-494`; `codex-rs\core\src\agent\control.rs:584-590`; `codex-rs\core\src\tools\handlers\multi_agents_common.rs:332-336`
- The existing codex multi-agent investigation already classified the current model as **top-level fan-out, not recursive child-of-child orchestration**. `.ralph\investigations\codex-upstream-multi-agent-v2-fork-impact\findings.md:13-31,125-145,159-172,211-220`

**Implication:** a codex workflows product can only support Ralph-class nesting if the **workflow runner itself stays root-owned** and manages a stack/DAG of child phases centrally. A "phase implemented as a spawned agent that itself runs a workflow" does not fit the current runtime.

### 2. Agent budget

**The current caps are usable for shallow Ralph hot spots, but only with explicit per-phase budgeting.**

- Codex's v2 config defaults to `max_concurrent_threads_per_session = 4`. `codex-rs\features\src\feature_configs.rs:7-39`; `codex-rs\core\src\config\mod.rs:188-193`
- Ralph's common parallel bursts are **3-wide**, not 16-wide: brainstorm fan-out is 3 lenses; plan review is up to 3 reviewers; re-review is up to 3 reviewers; Phase 5.5 is 3 retrospectives. `ai-developer-toolkit\plugins\ralph\skills\brainstorm-with-ralph\SKILL.md:113-161`; `ai-developer-toolkit\plugins\ralph\skills\plan-with-ralph\SKILL.md:647-730`; `ai-developer-toolkit\plugins\ralph\src\review-loop.mjs:397-455`; `ai-developer-toolkit\plugins\ralph\skills\implement-with-ralph\SKILL.md:1224-1260`
- So a **carefully staged, root-owned** Ralph port could fit inside the default v2 concurrency cap.

**But** if the workflow MVP allows nested workflow-of-workflow execution, or tries to overlap plan/review/retrospective phases, the 4-thread default becomes a hard scheduler constraint. Claude's documented 16-concurrent / 1000-total workflow envelope is therefore **not** matched today. Ralph-class workflows need:

- a **per-phase concurrency budget**
- a **global child count budget**
- backpressure / queueing at the workflow runner

Without that, the MVP will look fine on toy workflows and then deadlock or thrash on Ralph.

### 3. Convergence loops

**Not representable by today's codex product surface; only representable today as imperative code.**

- `review-loop.mjs` uses runtime data to decide whether to continue: open findings, no Critical/High => soft-cap, identical open-ID set => plateau, new findings from re-review => continue, else hard-cap. `ai-developer-toolkit\plugins\ralph\src\review-loop.mjs:193-466`
- `implement-with-ralph` Phase 5a / 5b adds even more branching: `prd-worthy` short-circuit, per-round manifest updates, failed-review guards, and Phase 6 replan vs accept decisions. `ai-developer-toolkit\plugins\ralph\skills\implement-with-ralph\SKILL.md:1027-1110,1129-1175,1278-1379`

So:

- **Imperative JS/Rust workflow code** could express this.
- A **simple declarative phase list** cannot.

For user-extensible Ralph phases, the workflow definition format must include a first-class **loop node** or **transition predicates** over machine-readable outputs, not just `nextPhase: "<id>"`.

### 4. Operator interaction

**Current blocker for parity with Ralph's interactive pauses.**

- The parity investigation explicitly documents that Claude workflows have **no mid-run user input**. `.ralph\investigations\codex-cli-vs-claude-code-workflows-parity\findings.md:49-53,71-75`
- Codex does have `request_user_input`, but the tool description says it is only available in **Default or Plan mode**, not a separate workflow-run product surface. `codex-rs\core\src\tools\handlers\request_user_input_spec_tests.rs:136-144`
- Ralph relies on human decisions at several load-bearing points: brainstorm direction selection, some plan review choices, accept-vs-replan at Phase 6, and bookkeeper/operator relays around crew messages. `ai-developer-toolkit\plugins\ralph\skills\brainstorm-with-ralph\SKILL.md:9-16`; `ai-developer-toolkit\plugins\ralph\skills\plan-with-ralph\SKILL.md:736-760`; `ai-developer-toolkit\plugins\ralph\skills\implement-with-ralph\SKILL.md:1325-1379`

**Implication:** if codex workflows copy Claude's "no mid-run input" rule, then Ralph question-relay becomes **pause/terminalize + later resume**, not a true in-run approval pause. That is a meaningful behavior change.

### 5. State / resume

**Ralph already has the persistence model; codex workflows do not yet.**

- Ralph persists `prd.json`, `job-state.json`, `progress.txt`, `notepad.md`, metrics, iteration logs, findings manifests, and worktree paths as the authoritative resume state. `ai-developer-toolkit\plugins\ralph\schemas\job-state-schema.json:1-119`; `ai-developer-toolkit\plugins\ralph\schemas\prd-schema.json:1-219`; `ai-developer-toolkit\plugins\ralph\skills\run-ralph\SKILL.md:144-181`
- Phase 2R / Phase 6 explicitly route resume through `orchestrator.phase`, `review.*`, `terminal`, `terminalReason`, and `hasPrdWorthy`. `ai-developer-toolkit\plugins\ralph\skills\implement-with-ralph\SKILL.md:576-594,873-960,1274-1389`
- Codex today persists **threads**, not workflow runs. `resumeThread()` is conversation-level persistence, not orchestration state. `codex-rs\sdk\typescript\src\codex.ts:29-37`

**Implication:** a codex workflows MVP needs its own persisted run registry with at least:

- workflow definition/version
- current node / loop round / branch state
- artifact paths
- worktree/repo pointer
- child-agent handles / completed results
- pause reason / resume token

Without that, it cannot replace Ralph's mid-job resume semantics.

### 6. Cross-engine + crews

**A codex-native workflow runtime would replace only the codex slice, not the whole orchestration ecosystem.**

- Ralph today is intentionally cross-engine: Codex + Copilot + Claude appear in brainstorm, plan review, review changes, and iteration-engine selection. `ai-developer-toolkit\plugins\ralph\skills\brainstorm-with-ralph\SKILL.md:113-161`; `ai-developer-toolkit\plugins\ralph\skills\plan-with-ralph\SKILL.md:647-730`; `ai-developer-toolkit\plugins\ralph\schemas\prd-schema.json:17-30`
- The crews/bookkeeper model is cross-session, mailbox-based orchestration outside Ralph itself. A codex-native workflow runtime would not replace that role model; at best crews would become the **outer** launcher/resumer of codex workflows.

**What is lost in a full codex-only replacement:**

- Copilot/Claude model diversity
- cross-engine fan-out
- crews mailbox / listener / operator relay semantics
- ability to run the same orchestration on non-codex members

So even if codex workflows replace **plugin-internal orchestration**, they do not replace the broader `crews + bookkeeper + cross-engine` operating model.

### 7. User-extensibility

**Possible in principle, but only with a richer phase-definition DSL than a simple ordered list.**

To let third parties add/reorder Ralph phases **without forking plugin code**, a phase-definition format needs at minimum:

- `id`, `kind`, `displayName`
- `inputs` / `outputs` contracts
- artifact paths and persistence rules
- execution mode (`inline`, `agent`, `multi-agent`, `shell`, `subworkflow`)
- engine/model hints
- concurrency budget hints
- branching predicates over machine-readable outputs
- loop policy (`maxRounds`, `plateauKey`, `softCapPredicate`, `terminalOn`)
- human-input policy (`inline`, `pause-and-resume`, `forbidden`)
- resume key / checkpoint schema

Ralph's current shapes prove why this is necessary:

- nested fan-out phases (`brainstorm`, `plan review`, `phase 5.5`)
- iterative convergence (`review-loop.mjs`, 5a, 5b)
- mode-dependent branches (interactive vs autonomous)
- group-vs-single-job branches
- terminal writes tied to durable state

That is **workflow graph + state machine**, not just "phase order in JSON."

---

## Recommendation for `codex-workflows-product-mvp`

### Should the MVP target Ralph as its canonical complex use case?

**Yes — as the design benchmark, not as the promised MVP parity target.**

Ralph is exactly the right stress test because it forces the workflows product to answer the hard questions up front:

- root-owned vs recursive orchestration
- loop semantics
- per-phase budgets
- persisted run state
- pause/resume for human gates

If the MVP ignores Ralph, it will likely ship a flat "spawn some agents and show progress" product that later has to be broken to support real automation.

### Recommended MVP scope split

1. **MVP-A (shallow/root-owned workflows):**
   - `/workflows` run registry + browser
   - persisted workflow-run state
   - root-owned agent nodes over existing collaboration tools
   - simple branching
   - explicit **pause terminal + resume** semantics for human gates
   - per-phase concurrency budgets

   This can already replace **parts** of Ralph: brainstorm fan-out, plan review/re-review, Phase 5.5 retrospectives, maybe isolated review/fixer loops.

2. **MVP-B (Ralph-class workflows):**
   - nested subworkflow nodes
   - declarative/runtime loop nodes
   - plateau/soft-cap predicates
   - richer artifact/state schemas
   - optional crews/operator integration

   This is the point where "replace Ralph" becomes credible.

### Conflict-surface recommendation

Keep the **workflow engine** as overlay-heavy as possible and spend upstream-canonical edits only on the unavoidable product seams:

- slash-command / TUI entry (`/workflows`)
- run registry / session-task hook-up
- workflow progress browser

The multi-agent substrate itself is already upstream-native and exposed through `add_collaboration_tools`; the expensive changes are the **user-visible product** and **persistent workflow state** surfaces, not the spawn primitives. `codex-rs\core\src\tools\spec_plan.rs:635-720`; `codex-rs\core\src\tasks\mod.rs:292-299`; `codex-rs\tui\src\slash_command.rs:12-140`

---

## Bottom line

**Can codex workflows replace Ralph today?** No.

**Can a codex workflows product eventually replace the autonomous, codex-only core of Ralph?** Yes, but only after it grows:

1. root-owned nested orchestration
2. explicit loop semantics
3. persisted workflow-run resume state
4. a human-gate pause/resume model

Until then, the right framing is: **build codex workflows to absorb the shallow/root-owned slices first, while using Ralph as the canonical "don't paint ourselves into a corner" benchmark.**
