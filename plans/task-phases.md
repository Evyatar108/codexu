# Task-phase model — plan/implement phases within a single task entry

*Drafted 2026-05-17 as input to a future `/plan-with-ralph` invocation. This is the FIRST of three sibling plans (`task-phases.md` → `overview-data-split.md` → `overview-vite-react.md`); they MUST land in that order because each builds on the previous one's schema choices.*

## Why

The codexu bookkeeping convention today tracks one row per task in `.ralph-overview/generated/overview.html` and `plans/parallel-assignments.md`, with a single status badge collapsing THREE distinct operator actions:

1. `/brainstorm-with-ralph "..."` — multi-model brainstorming for fuzzy ideas before planning. Writes `selected-direction.md` per the `ralph-orchestration:brainstorm-with-ralph` skill. Optional; most concrete tasks skip this and start at plan.
2. `/plan-with-ralph "..."` (or `/plan-with-ralph --from-brainstorm`) — drafts a PRD + plan under `.ralph/jobs/<auto-named>/`.
3. `/implement-with-ralph` — runs the ralph loop against that PRD.

Between each pair of operator actions there's a review checkpoint, sometimes for hours or days:
- After brainstorm: operator reviews `selected-direction.md`, picks a direction.
- After plan: operator reviews the PRD.
- After implement: operator merges the topic branch.

Today all the intermediate states ("no work started", "brainstorm output landed and unreviewed", "plan output landed and unreviewed", "plan approved, implement not yet fired", "implement in progress") all collapse to `b-ready` or `b-paused`. That's the blind spot. Some tasks also fan out (one plan → multiple parallel implements, e.g. `agent-view-research` → 6 follow-ups); the spawn relationship is captured but the per-phase status is not.

## What changes

Introduce a phase-aware status enum. Each task carries:

- `phase: "brainstorm-ready" | "brainstorm-in-progress" | "brainstorm-review" | "plan-ready" | "plan-in-progress" | "plan-review" | "impl-ready" | "impl-in-progress" | "shipped" | "closed"`
- `status: "ok" | "blocked" | "paused"` — a cross-cutting modifier (a task can be `impl-ready` AND `blocked` if it's waiting on another task to land; can be `plan-in-progress` AND `paused` if the discovery session is on hold). Today blocked/paused are conflated with the phase; separate them.
- `planOnly: true` — flag for research/docs tasks whose terminal state is the plan-review output (the plan IS the deliverable). Examples currently in the corpus: `codex-parity-audit`, `agent-view-research`, `1a-fork-doc`, `3c-hooks`. These transition `plan-review` → `shipped` (with `shipped` meaning "the research doc is the deliverable; nothing to implement").
- `brainstormPrompt?: string` — optional `/brainstorm-with-ralph "..."` body. Present only for tasks that started with a brainstorm phase.
- `planPrompt: string` — the existing `/plan-with-ralph "..."` body. For tasks that brainstormed first, this is often `/plan-with-ralph --from-brainstorm` so plan-with-ralph picks up the brainstorm's `selected-direction.md`.
- `implementPrompt?: string` — optional follow-up. Often literally `/implement-with-ralph` with no args; for security-gated bundles (`polish-Fs`) it can carry operator-sign-off prose like "review each fix before merging."

**Phase progression — what skips what.** No phase is mandatory except `plan-*` (every task has a plan). Operators choose the starting phase per task:
- **Concrete task** (most common today): start at `plan-ready`. Skip brainstorm entirely.
- **Fuzzy idea**: start at `brainstorm-ready`. After brainstorm-review, transition to `plan-ready` and run `/plan-with-ralph --from-brainstorm`.
- **Trivial 1-paragraph task** (per `plans/codexu-roadmap.md` line ~1285): start at `plan-ready`, plan and implement fuse via a single operator session — phase jumps `plan-ready` → `impl-in-progress` → `shipped` without a `plan-review` pause. The kanban renders this fine; the `plan-review` state is just unused for these tasks.

The brainstorm phase is not a research/audit phase. Tasks like `agent-view-research` are research-output tasks that go through `plan-*` and terminate at `shipped` with `planOnly: true`. Distinguish: brainstorm = "explore directions for a fuzzy idea before committing to a plan shape"; research-with-planOnly = "produce a research doc as the final deliverable, no implementation phase follows".

## Phase inputs and outputs

Each phase has a distinct input requirement and produces a distinct artifact. The data schema must capture both so the viewer can show input chips and deep-link to outputs.

### Inputs

| Phase | What the operator needs to fire it | Schema field(s) |
|---|---|---|
| Brainstorm | Just the prompt text (no upstream artifact — brainstorm is the entry point for fuzzy ideas). | `brainstormPrompt: string` |
| Plan | Prompt text + ONE of three input sources: (a) self-contained prompt, (b) prior brainstorm output of THIS task, (c) a manually-authored plan doc in the repo (e.g., `plans/task-phases.md`). | `planPrompt: string`, `planSource: "fresh" \| "from-brainstorm" \| "from-plan-doc"`, `planSourceRef?: string` |
| Implement | Prompt text + reference to THIS task's plan output (the PRD landed in `.ralph/jobs/<plan-job>/plan.md`). Always sourced from the same task's plan phase — no other valid input. | `implementPrompt: string` (no source-kind field needed; always from this task's plan) |

**`planSource` values:**
- `"fresh"` — the `planPrompt` is self-contained. Most existing tasks today are this.
- `"from-brainstorm"` — `planPrompt` is typically `/plan-with-ralph --from-brainstorm`. Picks up `selected-direction.md` from THIS task's brainstorm job (resolved via `brainstormJobId`). Requires the task to have already reached `brainstorm-review`.
- `"from-plan-doc"` — `planPrompt` references a manually-authored plan doc in the repo (e.g., `"/plan-with-ralph \"...per plans/task-phases.md...\""`). `planSourceRef` carries the relative path to the doc. Used for the meta-pattern where the operator drafts a planning doc by hand (or with a non-ralph agent) and then asks /plan-with-ralph to convert it into a full PRD. The three plans drafted today (`plans/task-phases.md`, `plans/overview-data-split.md`, `plans/overview-vite-react.md`) are exactly this case.

**Note on `/review-plan-with-ralph`:** This skill (per the `ralph-orchestration:review-plan-with-ralph` description) takes an existing plan and iteratively improves it until convergence. It's NOT a separate phase — it operates within `plan-in-progress`, looping on the same plan. The schema captures invocations of it via an optional `planReviewIterations: number` counter (incremented each time the operator runs review-plan-with-ralph on the current plan). Useful for the viewer to badge "plan iterated 3×" so operators know how mature the PRD is.

### Outputs (artifacts)

Each phase produces a tangible artifact under `.ralph/jobs/<jobId>/`. The schema captures pointers to these artifacts AS they're produced, so the viewer can deep-link rather than forcing the operator to `ls .ralph/jobs/`.

| Phase | Output artifact | Schema field(s) |
|---|---|---|
| Brainstorm | `.ralph/jobs/<brainstormJobId>/selected-direction.md` | `brainstormJobId?: string` (populated when phase enters `brainstorm-in-progress` or later; the output path is derived: `.ralph/jobs/${brainstormJobId}/selected-direction.md`) |
| Plan | `.ralph/jobs/<planJobId>/plan.md` (plus PRD + acceptance criteria) | `planJobId?: string`, `planReviewIterations?: number` |
| Implement | `.ralph/jobs/<implementJobId>/` working state + eventual merge commit | `implementJobId?: string`, `mergeCommit?: string` (populated when phase reaches `shipped`) |

The viewer can compose these into deep-links — e.g., `[plan output](.ralph/jobs/foo/plan.md)` — without needing the schema to carry full paths. Only the jobId is stored; the path convention is implied.

### Example: a fuzzy task all the way through

```js
{
  id: "agent-comms",
  title: "Top-level agent ↔ top-level agent comms",
  phase: "shipped",
  status: "ok",
  brainstormPrompt: "/brainstorm-with-ralph \"explore options for agent-to-agent comms across tunnel...\"",
  brainstormJobId: "agent-comms-brainstorm",        // → .ralph/jobs/agent-comms-brainstorm/selected-direction.md
  planSource: "from-brainstorm",
  planSourceRef: null,                              // null for from-brainstorm; resolved via brainstormJobId
  planPrompt: "/plan-with-ralph --from-brainstorm",
  planJobId: "agent-comms-plan",                    // → .ralph/jobs/agent-comms-plan/plan.md
  planReviewIterations: 2,                          // review-plan-with-ralph was run twice
  implementPrompt: "/implement-with-ralph",
  implementJobId: "agent-comms-impl",
  mergeCommit: "abc123ef",
  // ... rest of fields per the main schema
}
```

### Example: a meta-task drafted manually first

```js
{
  id: "task-phases",
  title: "Task-phase model integration",
  phase: "plan-ready",
  status: "ok",
  brainstormPrompt: null,                           // skipped — operator drafted the planning doc manually
  brainstormJobId: null,
  planSource: "from-plan-doc",
  planSourceRef: "plans/task-phases.md",            // ← the just-written plan
  planPrompt: "/plan-with-ralph \"convert plans/task-phases.md into a full PRD with stories + acceptance...\"",
  planJobId: null,                                  // not yet started
  planReviewIterations: 0,
  implementPrompt: "/implement-with-ralph",
  implementJobId: null,
  mergeCommit: null,
}
```

### Visualization affordances (handed off to plan #3)

The Vite/React viewer renders the input/output structure as:

- **Each phase's `<details>` body opens with a "Source" chip** that shows the input:
  - `Source: fresh` (no chip, default-rendered, possibly omitted entirely)
  - `Source: ⤴ brainstorm output` (clickable, deep-links to `.ralph/jobs/<brainstormJobId>/selected-direction.md`)
  - `Source: 📄 plans/task-phases.md` (clickable, opens the referenced file)
- **And a "Job" chip** when the phase has been started, deep-linking to the job dir (`.ralph/jobs/<jobId>/plan.md` or the dir root).
- **Plan-phase iteration badge:** if `planReviewIterations > 0`, a small "🔁 iterated 3×" badge next to the plan phase pill.
- **Shipped badge with commit:** when `mergeCommit` is populated, the shipped phase pill is clickable and links to the commit (GitHub URL or a `git show` aside).

The viewer never auto-populates these artifact fields — the bookkeeper agent fills them in after each operator action, the same way it flips the phase enum. The viewer just reads.

## Schema mapping for existing tasks

The migration is not free — every existing task entry needs a phase value assigned. Use this mapping from current state to new fields:

| Today's badge | New phase | New status | Notes |
|---|---|---|---|
| `b-ready` (no plan exists, concrete task) | `plan-ready` | `ok` | Default for un-fired concrete tasks |
| `b-ready` (no plan exists, fuzzy idea) | `brainstorm-ready` | `ok` | Operator marks during migration if the task is fuzzy enough to brainstorm |
| `b-ready` (plan exists under `.ralph/jobs/<id>/`) | `plan-review` or `impl-ready` | `ok` | Operator decides per task by reading the plan file |
| `b-blocked` | (preserve current phase) | `blocked` | Phase reflects how far along it got |
| `b-paused` | (preserve current phase) | `paused` | Same |
| `b-closed` (shipped) | `shipped` | `ok` | Terminal |
| `b-closed` (obsolete-by-design) | `closed` | `ok` | Terminal, separate from shipped |
| `🚫 closed` cmd-warn | `closed` | `ok` | |

The agent doing the migration should NOT auto-derive `plan-review` or `brainstorm-ready` from filesystem state — that's fragile (worktrees come and go, and "fuzzy enough to brainstorm" is operator judgment). Instead, present the operator with a per-task table at the end and ask:
1. Which tasks have plans landed but unreviewed (→ `plan-review`)?
2. Which un-fired tasks are fuzzy enough to warrant `brainstorm-ready` instead of going straight to `plan-ready`?

Default everything else to `plan-ready` (the most common starting state).

## Files to change

- `.ralph-overview/generated/overview.html` — primary change surface:
  - CSS badge classes: add `.b-brainstorm-ready`, `.b-brainstorm-in-progress`, `.b-brainstorm-review`, `.b-plan-ready`, `.b-plan-in-progress`, `.b-plan-review`, `.b-impl-ready`, `.b-impl-in-progress`, `.b-shipped` next to the existing `.b-now`/`.b-soon`/`.b-block`. Pick a color palette that visually distinguishes the three phase families: brainstorm-phase (purple — maps to existing `--purple` token), plan-phase (cool blue — maps to `--info`/`--accent`), impl-phase (warm yellow/orange — maps to `--warn`), terminal (muted — maps to `--ok` for shipped, `--done` for closed). Each phase family has 3 intensity levels (ready / in-progress / review) — vary saturation or use a small status dot.
  - Status modifier sub-badge for blocked/paused (small pill rendered alongside the phase badge).
  - Kanban columns: decide whether to keep the existing 3-column layout (Ready / Soon / Blocked) and surface phase as a pill on each card, OR re-column by phase (Plan-ready / Plan-review / Impl-ready / Impl-in-progress / Shipped). Recommend the former — fewer columns, phase-as-pill scales better with task count.
  - Phase tree section: phase pills also surface there per node.
  - Existing line ranges to read first: lines ~76-110 (badge CSS), ~1043-1180 (kanban cards), ~1400-2150 (commands `<details>` rows), ~76-90 (badge color CSS vars).
- `.ralph-overview/generated/overview.html` `<script type="application/json" id="roadmap-data">` block (line ~2155): no changes here — phase is a per-task field, not a per-run field. The `runs` log stays as-is.
- `plans/parallel-assignments.md` — document the phase enum in the front-matter conventions section (lines 1-22). Update the per-task table at the bottom of the file (after the lane sections) to include phase + status columns.
- `plans/codexu-roadmap.md` — add a "Task phase model" entry under the "Standing rules" section (lines ~163-175). One-paragraph description with a link to `plans/parallel-assignments.md` for the full enum.

## Files to read as reference (do NOT edit)

- `plans/codexu-roadmap.md` lines ~176-203 ("In-flight ralph jobs") — for current bookkeeping patterns.
- `plans/parallel-assignments.md` lines 1-100 — for the existing /plan-with-ralph / /implement-with-ralph workflow tenets.
- `tasks/prd-1a-fork-doc.md` and `tasks/prd-port-explorer-prompt.md` — examples of PRDs that split internally into autonomous + operator-gated user stories; this plan does not change that pattern, but it should reference it as the per-PRD analog of the per-task phase model.
- `.ralph/jobs/devtunnels-E-cleanup/` (if accessible) — example of a multi-phase ralph job for context on how plan-review checkpoints work today.

## Acceptance

- Every existing task entry in `.ralph-overview/generated/overview.html` and the corresponding row in `plans/parallel-assignments.md` carries an explicit phase value. No `b-ready` ambiguity remains.
- New CSS badge classes render with visually distinct colors in both dark and light theme variants (the overview.html has `@media (prefers-color-scheme: light)` blocks at line ~22-38 that must be updated in parallel).
- The phase enum is documented in `plans/parallel-assignments.md` and `plans/codexu-roadmap.md`.
- One end-to-end smoke per progression path:
  - **Brainstorm path:** pick a fuzzy task (suggest creating a fresh test task or repurposing one that's still fuzzy like `agent-comms` if its design isn't settled), flip it through `brainstorm-ready` → `brainstorm-in-progress` → `brainstorm-review` → `plan-ready` → `plan-in-progress` → `plan-review` → `impl-ready` → `impl-in-progress` → `shipped`.
  - **Standard path:** pick a concrete task (suggest `1b-multidev` since it's `b-ready` today with no plan landed), flip it through `plan-ready` → `plan-in-progress` → `plan-review` → `impl-ready` → `impl-in-progress` → `shipped`.
  - **Fused 1-paragraph path:** pick a small task that fuses plan+implement, flip it `plan-ready` → `impl-in-progress` → `shipped` directly (skipping `plan-review`).
  - **planOnly path:** pick a research task (e.g., the historical `codex-parity-audit`), verify it terminates at `shipped` after `plan-review`.
- Backwards-compat: if a future hand-edited task accidentally uses one of the legacy classes (`b-ready`/`b-blocked`/`b-paused`/`b-closed`), the CSS still renders something readable rather than blank. Either keep the legacy classes aliased to the closest new phase, or fail-soft to a default style.

## Worktree

`.worktrees/task-phases/` per `plans/parallel-assignments.md` lines 10-11. Single commit on the topic branch `ralph/task-phases`. Push to operator for review; merge via `--no-ff` per the existing convention.

## Common mistakes / confusion points

1. **Coupling this with the data extraction.** This plan is intentionally HTML-only. Do NOT also extract task definitions out of HTML into a sidecar JSON — that's `overview-data-split.md`'s scope. Mixing them would 2x the diff and make review impossible. The phase fields land on the HTML side first; the data extraction picks them up in the next plan.

2. **Auto-deriving phase from filesystem state.** The presence of `.ralph/jobs/<task-id>/plan.md` is NOT a reliable signal that a task is in `plan-review` — operators sometimes start a discovery session that never produces a plan, then close the session. The bookkeeper should treat phase as an explicit operator-asserted field, never inferred. The migration script may suggest defaults but must ask the operator to confirm.

3. **Conflating `blocked` with `impl-ready` waiting on dependency.** A task can be `plan-ready` AND `blocked` (the plan hasn't been started because the prerequisite task hasn't landed). A task can be `impl-ready` AND `blocked` (the plan exists and is approved, but the prerequisite task's CODE hasn't merged yet). Don't lose this distinction by merging phase+status into one enum.

4. **Plan-only tasks losing their terminal state.** Research/docs tasks that have no implement phase reach a terminal state at `plan-shipped` (or however the schema names it). If the schema only has one terminal `shipped`, treat `planOnly: true` tasks as reaching `shipped` after the plan PRD/research doc lands. Either choice is fine — pick one and document it.

5. **Modifier sub-badge styling.** A task with `phase: "impl-ready"` and `status: "blocked"` needs to visually communicate BOTH. A single combined badge ("impl-ready-blocked") becomes unreadable. Render two pills next to each other, with the modifier pill smaller and in a yellow/orange tint.

6. **Existing CSS uses semantic color tokens** (`--ok`, `--warn`, `--bad`, `--info`, `--accent`, `--done`, `--purple`) defined at lines ~7-37. Use these tokens for the new phase colors instead of hardcoding hex values — preserves the dark/light theme support.

7. **Spawned-from pills coexist with phase badges.** Some tasks (e.g. `codex-attachments`) carry a "spawned from `codex-parity-audit`" pill (CSS class `pill-spawned-from`, lines ~362-376). Phase badge sits in the `<summary>` element; spawned-from pill sits in the body. Don't move them.

## Out of scope

- Any inline-edit affordance to change phase from the UI. Phase changes happen via hand-edit of the HTML (today) or the data file (after `overview-data-split.md` lands). Inline editing is `overview-vite-react.md` Stage 6.5 at the earliest.
- Auto-bumping `lastTouchedAt` in the existing `roadmap-data` JSON when phase changes. Bookkeeper still bumps it manually.
- New kanban columns. The 3-column structure (Ready / Soon / Blocked) is preserved; phase is rendered as a pill within each card.
- Touching `.ralph/jobs/*/plan.md` files. Those are per-task PRDs and out of scope here.

## Dependency notes

- This is plan #1 of 3. Plan #2 (`overview-data-split.md`) and #3 (`overview-vite-react.md`) MUST wait for this to land — they encode the phase enum in their data schema and component types respectively.
- If the phase enum changes after #2 has been started, plan #2 has to re-migrate. Keep #1 small and tightly-scoped to minimize re-work.
