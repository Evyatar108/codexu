# Implementation Plan: skill-rewrite (overview-data-split / Phase 4)

*Job-scoped slice of `.ralph/job-groups/overview-data-split/plan.md`. Covers US-005b only. Depends on `full-task-port` AND `phase-tree-port` (the final schema must be in place).*

## Overview

Rewrite `.agents/skills/roadmap-and-overview/SKILL.md` (548 lines) procedures A–G to describe data-file edits (single JS entry append/edit) instead of multi-file HTML edits, with a working example task entry copied from `plans/overview-data.js` once `full-task-port` (US-003) and `phase-tree-port` (US-004) have landed. Fix the `codexu-overview-details-state-v1` → `v2` localStorage key drift. Add Pitfalls entries for JS string escaping, the `lastTouched` dual-update invariant, and the skeleton-ownership invariant.

This job is the **sole owner of `.agents/skills/roadmap-and-overview/SKILL.md`**. Zero file overlap with any other cluster, so the only cost of Phase 4 placement is wall time — not parallelism.

## Files to Modify

**`.agents/skills/roadmap-and-overview/SKILL.md`** (single file; 548 lines pre-refactor):

- **Procedure A ("Adding a new ralph task")**: include a complete working example task entry copied from `plans/overview-data.js`. Required fields in the example: `id`, `title`, `scope`, `phase`, `status`, `command: {summaryHtml, descriptionHtml, warnings: [], planPrompt}`, `kanbanCards: [{column, cardClass, inlineStyle, html}]`, `lastTouchedAt`. Also show the matching update to `OVERVIEW_DATA.lastTouched[id]`.
- **Procedure B ("Marking a task as shipped")**: explicitly call out the **lastTouched dual-update invariant**: "When you set `tasks[x].lastTouchedAt = '<new ISO>'`, also set `OVERVIEW_DATA.lastTouched['<id>'] = '<new ISO>'` in the same edit. The data file is invalid if these drift; the page's freshness hint and ordering will be wrong until corrected."
- **Procedure C–G**: rewrite each to describe data-file edits (single JS entry append/edit) instead of multi-file HTML edits.
- **Procedure D ("Marking a task paused / blocked")**: include the same dual-update reminder.
- **Procedure for phase-tree edits**: reference the final `phaseTree[]` node schema (`{kind: 'task-ref'|'raw', taskId?, state?, html?}`). Show a worked example of adding/removing a `task-ref` plus updating a `state` class.
- **localStorage key fix**: change `codexu-overview-details-state-v1` → `v2` (verified against `plans/overview.html` line 3106 — keep in sync with whatever is current).
- **Pitfalls section** — add entries for:
  1. JS string-escaping guidance (HTML-entity one-shot decode, single-quoted string literals with `\'` escapes, never re-encode entities in render).
  2. The `lastTouched` dual-update invariant (with a "common mistake" example).
  3. The skeleton-ownership invariant — each story PRD mutates only its own array body, never re-formats the top-level object.

## Files NOT Modified

Any file other than `.agents/skills/roadmap-and-overview/SKILL.md`. The docs sweep already landed in US-005a (`docs-sweep` job).

## Files to Read as Reference

- `.agents/skills/roadmap-and-overview/SKILL.md` (full file — read end-to-end before editing)
- `plans/overview-data.js` (after `full-task-port` and `phase-tree-port` merge — read a representative task entry to use as the SKILL example)
- `plans/overview.html` line 3106 (current localStorage key — verify before editing)
- `.ralph/job-groups/overview-data-split/plan.md` § "Data schema" for the finalized schema reference
- `plans/task-phases.md` for the phase enum (already shipped)

## Acceptance Criteria

- [ ] `.agents/skills/roadmap-and-overview/SKILL.md` Procedures A–G describe data-file edits (single JS entry append/edit) instead of multi-file HTML edits.
- [ ] Procedure A ("Adding a new ralph task") includes a complete, working example task entry copied from `plans/overview-data.js` after US-003 lands. The example includes `id`, `title`, `scope`, `phase`, `status`, `command: {summaryHtml, descriptionHtml, warnings: [], planPrompt}`, `kanbanCards: [{column, cardClass, inlineStyle, html}]`, `lastTouchedAt`, and `OVERVIEW_DATA.lastTouched[id]` matching `lastTouchedAt`.
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

## Out of Scope

- Any task or phase-tree porting (US-003 / US-004 — already done before this story runs).
- Doc edits in `plans/` (US-005a / `docs-sweep` — already done before this story runs).
- Any code changes in `plans/overview.html` or `plans/overview-data.js`.
- Schema changes to `OVERVIEW_DATA`.
