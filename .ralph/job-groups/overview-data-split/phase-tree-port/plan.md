# Implementation Plan: phase-tree-port (overview-data-split / Phase 3)

*Job-scoped slice of `.ralph/job-groups/overview-data-split/plan.md`. Covers US-004 only. Depends on `representative-port` (US-002). Runs parallel with `full-task-port` and `docs-sweep` in Phase 3.*

## Overview

Extract the entire phase tree section (`plans/overview.html` lines 1920-2009) into `OVERVIEW_DATA.phaseTree[]` and implement `renderPhaseTree()` that data-drives `#phase-tree`. The phase tree is NOT task-derived: bullets like `1b.1` and `4a-4m` exist without task IDs (Copilot caught). Dedicated `phaseTree` schema with `task-ref` / `raw` node kinds is required.

## Parallel-execution Contract

This job runs in the same phase as `full-task-port` (US-003) and `docs-sweep` (US-005a). To avoid merge conflicts:

1. **Skeleton-ownership invariant (load-bearing).** This job mutates ONLY the `phaseTree[]` array body US-001 stubbed. It does NOT touch `tasks[]`, does NOT add or reorder other top-level fields, does NOT re-format the surrounding object literal.
2. **Inline-script section markers.** `renderPhaseTree()` body lives inside the `// ===== renderPhaseTree() =====` section marker US-002 emitted; the `// ===== renderTasks() =====` marker is NOT touched (US-003 owns it).
3. **File-overlap risk = medium** (acknowledged in `suggested-decomposition.json`). Disjoint line ranges in `plans/overview.html`: this job edits the phase tree section (1920-2009); US-003 edits kanban (1083-1425) and command rows (1442-1914). Worktree merge handles disjoint ranges cleanly.

## Phase Tree Schema (recap from master plan)

```js
phaseTree: [
  {
    id: "phase-1",
    title: "Phase 1 — Foundations",
    headerHtml: null,            // optional trusted HTML for .phase-head; overrides `title` when set
                                 // (use for headers with <span class="ptag"> or rich content)
    collapsible: false,          // wrap items in <details class="phase-subdetails"> when true
    collapsibleSummary: null,    // text shown in <summary> when collapsible:true
    nodes: [
      { kind: "task-ref", taskId: "perf-WS3", state: "open",
        trailingHtml: " — docs-only, open" },
      { kind: "raw", html: "<span class=\"item-name closed\">...</span> ..." },
      { kind: "sub-phase", id: "1b", title: "...", headerHtml: null,
        collapsible: false, collapsibleSummary: null, nodes: [ /* recursive */ ] }
    ]
  }
]
```

- **task-ref**: emit `<li><span class="item-name ${state}">…</span>${trailingHtml}</li>`. `state` is one of `open|deferred|donefade|closed`. `taskId` MUST match an entry in `tasks[]` (after US-003 lands all 51 will be present; for now reference what's there or note drift in the commit).
- **raw**: trusted full `<li>…</li>` inner HTML. Use for bullets without a task id, entries with inline `style="color: var(--warn);"`, or composite lines mixing multiple `.item-name` spans.
- **sub-phase**: recursive phase node.

## Files to Modify

**`plans/overview-data.js`:**
- Populate `phaseTree[]` by walking `plans/overview.html` lines 1920-2009.
- For each bullet, choose the schema variant: a single `<span class="item-name ${state}">` followed by optional trailing text → `{kind: "task-ref", taskId, state, trailingHtml}`; everything else → `{kind: "raw", html}` carrying the verbatim `<li>` inner HTML.
- For each phase node, capture `headerHtml` when the `.phase-head` contains `<span class="ptag">…</span>`, and set `collapsible: true` + `collapsibleSummary` for phases 4 and 5 whose items live inside `<details class="phase-subdetails">`.

**`plans/overview.html`:**
- Fill the empty `renderPhaseTree()` stub US-002 left inside the `// ===== renderPhaseTree() =====` marker. It must:
  - Emit `<div class="phase-grid">` wrapper, then for each phase node a `<div class="phase">` containing `<div class="phase-head">` (use `headerHtml` if set, else `title` as text).
  - When `collapsible: true`: wrap items in `<details class="phase-subdetails"><summary>${collapsibleSummary}</summary><ul>…</ul></details>`.
  - When `collapsible: false`: emit a plain `<ul>…</ul>`.
  - For each `task-ref` node: `<li><span class="item-name ${state}">${task.title || visibleText}</span>${trailingHtml || ""}</li>`.
  - For each `raw` node: inject `html` via `innerHTML` (trusted).
  - For each `sub-phase` node: recurse, emitting as a nested `<div class="phase">` if needed.
- DELETE: the original phase tree HTML at lines 1920-2009.

## Drift Handling

If `task-ref` `taskId`s reference task ids not present in `tasks[]`, drop them at port time rather than carrying dead references. Log dropped ids in the commit message.

## Files to Read as Reference

- `plans/overview.html` lines 1920-2009 (phase tree section to port and delete)
- `plans/overview-data.js` (US-001 skeleton + US-002 entries) — `phaseTree: []` stub, schema-comment block
- `.ralph/job-groups/overview-data-split/plan.md` § "Data schema" → `phaseTree` for full schema reference
- `plans/overview.html` `<style>` block lines 1920-onwards CSS for `.phase`, `.phase-head`, `.phase-grid`, `.phase-subdetails`, `.item-name.open|.deferred|.donefade|.closed`, `.ptag` — render must produce DOM the existing CSS targets.

## Acceptance Criteria

- [ ] `phaseTree[]` is populated. Each phase node carries `{id, title, headerHtml?, collapsible?, collapsibleSummary?, nodes: [{kind: 'task-ref'|'raw', taskId?, state?: 'open'|'deferred'|'donefade'|'closed', html?, trailingHtml?}, ...]}`. Sub-phases recurse.
- [ ] **Skeleton-ownership invariant respected.** This story mutates ONLY the `phaseTree[]` array body US-001 stubbed. It does NOT touch `tasks[]`, does not add or reorder other top-level fields, does not re-format the surrounding object literal. `renderPhaseTree()` body lives inside the `// ===== renderPhaseTree() =====` section marker US-002 emitted; the `// ===== renderTasks() =====` marker is not touched. (Enables parallel execution with US-003.)
- [ ] `task-ref` nodes carry `taskId` (must match an entry in `tasks[]`) plus optional `state` (`open|deferred|donefade|closed`) for the `.item-name` class.
- [ ] `raw` nodes carry trusted inner HTML for structural bullets that have no task id (e.g. `1b.1`, `4a-4m`).
- [ ] `renderPhaseTree()` fills the `#phase-tree` container, emitting `.phase-grid`, `.phase`, `.phase-head`, `.item-name` with state classes, and nested `<details class="phase-subdetails">` collapsibles to match the pre-refactor HTML.
- [ ] `plans/overview.html` no longer contains the authored phase tree section at lines 1920-2009.
- [ ] Page on `file://` renders the phase tree identically (same headers, same bullets, same state classes, same collapsibles, same inline styles via `raw` nodes).
- [ ] Drift handling: any `task-ref` whose `taskId` is not present in `tasks[]` is dropped at port time (logged in the commit message), not carried as a dead reference.
- [ ] Section markers maintained: `renderPhaseTree()` fills the `// ===== renderPhaseTree() =====` block US-002 stubbed.
- [ ] Typecheck passes.

## Out of Scope

- The 48 unported tasks (US-003 / `full-task-port`).
- Docs sweep (US-005a / `docs-sweep`).
- SKILL.md (US-005b / `skill-rewrite`).
- Restructuring `renderPhaseBadges()` IIFE (it walks DOM post-render and works as-is).
- Splitting render JS into a separate file (Plan #3).
