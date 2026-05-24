# PRD: skill-rewrite (overview-data-split)

## Introduction / Overview

Rewrite `.agents/skills/roadmap-and-overview/SKILL.md` to match the finalized data-file schema. Procedures A–G shift from multi-file HTML edits to single-JS-entry append/edit. The rewrite includes a working example task entry copied from `plans/overview-data.js` (after `full-task-port` and `phase-tree-port` have merged). Critical invariants are explicitly called out: the `lastTouched` dual-update, the skeleton-ownership invariant, and the localStorage `v1` → `v2` drift fix.

This is the **sole owner** of `.agents/skills/roadmap-and-overview/SKILL.md` — zero file overlap with any other cluster.

## Goals

1. Rewrite Procedures A–G in `.agents/skills/roadmap-and-overview/SKILL.md` to describe data-file edits.
2. Include a complete, working example task entry in Procedure A copied verbatim from the post-merge `plans/overview-data.js`.
3. Call out the `lastTouched` dual-update invariant in Procedures B and D.
4. Reference the final `phaseTree[]` node schema in the phase-tree edit procedure with a worked example.
5. Fix the `codexu-overview-details-state-v1` → `v2` localStorage key drift.
6. Add Pitfalls entries for JS string escaping, the `lastTouched` dual-update invariant, and the skeleton-ownership invariant.
7. Do NOT modify any file other than `.agents/skills/roadmap-and-overview/SKILL.md`.

## User Stories

### US-005b: Rewrite SKILL.md procedures around final schema

As an autonomous bookkeeper agent, I want `.agents/skills/roadmap-and-overview/SKILL.md` rewritten with procedures A–G describing data-file edits (single JS entry append/edit) AND with a working example task entry that references the finalized `kanbanCards[]` / `phaseTree` schema and the `lastTouched` dual-update invariant, so that future bookkeepers have a copy-paste template that matches the actual data file.

**Acceptance Criteria:**
- [ ] `.agents/skills/roadmap-and-overview/SKILL.md` Procedures A–G describe data-file edits (single JS entry append/edit) instead of multi-file HTML edits.
- [ ] Procedure A ("Adding a new ralph task") includes a complete, working example task entry copied from `plans/overview-data.js` after US-003 lands. The example must include `id`, `title`, `scope`, `phase`, `status`, `command: {summaryHtml, descriptionHtml, warnings: [], planPrompt}`, `kanbanCards: [{column, cardClass, inlineStyle, html}]`, `lastTouchedAt`, and `OVERVIEW_DATA.lastTouched[id]` matching `lastTouchedAt`.
- [ ] Procedure B ("Marking a task as shipped") explicitly calls out the **lastTouched dual-update invariant**: "When you set `tasks[x].lastTouchedAt = '<new ISO>'`, also set `OVERVIEW_DATA.lastTouched['<id>'] = '<new ISO>'` in the same edit. The data file is invalid if these drift; the page's freshness hint and ordering will be wrong until corrected."
- [ ] Procedure D ("Marking a task paused / blocked") includes the same dual-update reminder.
- [ ] Procedure for phase-tree edits references the final `phaseTree[]` node schema (`{kind: 'task-ref'|'raw', taskId?, state?, html?}`) and shows a worked example of adding/removing a `task-ref` plus updating a `state` class.
- [ ] The `codexu-overview-details-state-v1` → `v2` localStorage key drift in SKILL.md is fixed (verified against `plans/overview.html` line 3106 — keep in sync with whatever is current).
- [ ] SKILL.md Pitfalls section adds entries for:
  - JS string-escaping guidance (HTML-entity one-shot decode, single-quoted string literals with `\'` escapes, never re-encode entities in render).
  - The `lastTouched` dual-update invariant (with a "common mistake" example).
  - The skeleton-ownership invariant — each story PRD mutates only its own array body, never re-formats the top-level object.
- [ ] Does NOT modify any file other than `.agents/skills/roadmap-and-overview/SKILL.md` (the docs sweep landed in US-005a).
- [ ] Typecheck passes.

**Dependencies:** US-003 (full-task-port) AND US-004 (phase-tree-port). The SKILL example must reference the finalized data-file schema.
**Estimated complexity:** medium.

## Non-Goals (Out of Scope)

- Any task or phase-tree porting.
- Doc edits in `plans/` (US-005a / `docs-sweep`).
- Any code changes in `plans/overview.html` or `plans/overview-data.js`.
- Schema changes to `OVERVIEW_DATA`.

## Design Considerations

- **Working example must be byte-equal** (or near byte-equal) to a real entry in `plans/overview-data.js` after US-003 lands. This ensures future bookkeepers can copy-paste with confidence.
- **Dual-update invariant emphasis.** `lastTouchedAt` (per-task) and `OVERVIEW_DATA.lastTouched[id]` (top-level map) are kept in sync. Drift produces silent bugs in the freshness hint and ordering.
- **Skeleton-ownership invariant** in Pitfalls is preventative: a future bookkeeper touching the data file in a non-parallel context should still respect the convention, since `plans/overview.html` parsing logic assumes a stable top-level shape.

## Technical Considerations

- This story runs in Phase 4 after `full-task-port` and `phase-tree-port` have merged. The implementer should READ `plans/overview-data.js` and `plans/overview.html` line 3106 in the worktree before authoring the example.
- The SKILL.md file is ~548 lines pre-refactor. Net change is roughly ±200 lines (procedures rewritten; Pitfalls grown).
- The `roadmap-plugin` prompt body and other `plans/` doc fixes are NOT in this story's scope (US-005a handled them).

## Success Metrics

- Procedures A–G read as data-file edit instructions, with the Procedure A example copy-paste-runnable as a valid task entry.
- Pitfalls section explicitly calls out the three invariants (JS string escaping, `lastTouched` dual-update, skeleton-ownership).
- localStorage key in SKILL.md = `codexu-overview-details-state-v2`.
- 0 changes to any file other than `.agents/skills/roadmap-and-overview/SKILL.md`.

## Open Questions

- Which task entry should be used as the canonical example in Procedure A? Suggested: pick one with multiple `kanbanCards[]` (e.g. `1b-multidev` or `perf-WS2`) so the example exercises the multi-card schema corner.
