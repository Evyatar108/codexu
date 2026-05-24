# Implementation Plan: docs-sweep (overview-data-split / Phase 3)

*Job-scoped slice of `.ralph/job-groups/overview-data-split/plan.md`. Covers US-005a only. Depends on `representative-port` (US-002). Runs parallel with `full-task-port` and `phase-tree-port` in Phase 3.*

## Overview

Schema-shape-independent doc edits. Update every standing doc outside `.agents/skills/roadmap-and-overview/SKILL.md` (US-005b owns the SKILL) to stop telling agents to edit `plans/overview.html` for task state and to start pointing at `plans/overview-data.js`. Also fix the stale `?id=` → `?tasks=` URL-filter references in `plans/overview-vite-react.md` and re-point the `lastRanAt timestamp` / `roadmap-data JSON` phrasings in `plans/parallel-assignments.md`.

This job is **fully parallel-safe with `full-task-port` (US-003) and `phase-tree-port` (US-004)**: the file lists are disjoint. It is the parallel-safe carve-out from the original docs-and-skill-rewrite cluster, resolving F-013's ordering tension.

## Files to Modify

**`plans/codexu-roadmap.md`:**
- Companion-snapshot callout (lines 5-9): update to reference `plans/overview-data.js`.
- Task-phase-model standing rule (line 175): update to reference `plans/overview-data.js`.

**`plans/parallel-assignments.md`:**
- Add a "data file is source of truth" note near the top (before the bottom status table).
- Lines 225, 235, 242, 247: re-point stale "bump lastRanAt timestamp in plans/overview.html's roadmap-data JSON" and "Add new task entries to plans/parallel-assignments.md and plans/overview.html roadmap-data JSON" phrasings to `plans/overview-data.js`.
- Keep the bottom status table (lines 561-612) as a derived view.

**`plans/agent-view-research.md`:**
- Re-point references to editing `overview.html` for task state to `plans/overview-data.js`.

**`plans/codex-agent-parity-audit.md`:**
- Line 1358: re-point reference.

**`plans/overview-vite-react.md`:**
- Lines 66 and 147: update stale `?id=foo,bar` URL-filter references to `?tasks=` (matching `parseTaskIdFilter()` at `plans/overview.html` line 3206).
- Add a note that `<KanbanCard>` and `<PhaseTreeNode>` raw branches consume `kanbanCards[].html` and `phaseTree` `raw` nodes via `dangerouslySetInnerHTML` (trusted-HTML escape hatch documented in the master plan's Risk Area #9).

**`roadmap-plugin` prompt body:**
- Locate via `git grep roadmap-plugin plans/`. Update to describe the data-file edit model, not HTML edits.

## Files NOT Modified

**`.agents/skills/roadmap-and-overview/SKILL.md`** — that is US-005b's territory. Running this story before SKILL is finalized must be safe.

## Verification Greps

Run after edits:
1. **Narrow:** `git grep -n "edit plans/overview.html" -- :!plans/overview.html .agents/ plans/ packages/` returns zero hits.
2. **Broad (`.agents/ plans/ packages/`, excluding `plans/overview.html`):**
   - `edit plans/overview.html` → 0 hits
   - `roadmap-data` → 0 hits
   - `lastRanAt timestamp` → 0 hits
   - `generatedFromCommit` → 0 hits except inside `plans/overview-data.js` (which doesn't exist yet on this branch — but the rule applies on the merged result).

## Files to Read as Reference

- `plans/codexu-roadmap.md` (full file — find Companion-snapshot callout and Task-phase-model rule)
- `plans/parallel-assignments.md` (full file — find the relevant lines and status table)
- `plans/agent-view-research.md` (full file)
- `plans/codex-agent-parity-audit.md` (around line 1358)
- `plans/overview-vite-react.md` (lines 66, 147, plus surrounding context)
- `plans/overview.html` line 3206 (`parseTaskIdFilter()` — confirms URL param is `?tasks=`)
- `.ralph/job-groups/overview-data-split/plan.md` § "Risk Area #9" (trusted-HTML escape hatch context for the `overview-vite-react.md` note)

## Acceptance Criteria

- [ ] `plans/codexu-roadmap.md` Companion-snapshot callout (lines 5-9) and Task-phase-model standing rule (line 175) reference `plans/overview-data.js`.
- [ ] `plans/parallel-assignments.md` top adds a "data file is source of truth" note; bottom status table remains as a derived view.
- [ ] `plans/parallel-assignments.md` lines 225, 235, 242, 247 — stale "bump lastRanAt timestamp in plans/overview.html's roadmap-data JSON" and "Add new task entries to plans/parallel-assignments.md and plans/overview.html roadmap-data JSON" phrasings — re-pointed to `plans/overview-data.js`.
- [ ] `plans/agent-view-research.md` and `plans/codex-agent-parity-audit.md` line 1358 — references to editing `overview.html` for task state re-pointed.
- [ ] `plans/overview-vite-react.md` lines 66 and 147 — stale `?id=foo,bar` URL-filter references updated to `?tasks=` (matching `parseTaskIdFilter()` at `plans/overview.html` line 3206). Also adds a note that `<KanbanCard>` and `<PhaseTreeNode>` raw branches consume `kanbanCards[].html` and `phaseTree` `raw` nodes via `dangerouslySetInnerHTML`.
- [ ] The `roadmap-plugin` prompt body (locate via `git grep roadmap-plugin plans/`) is updated to describe the data-file edit model, not HTML edits.
- [ ] **Broad grep AC**: each of the following, run against `.agents/ plans/ packages/` with `plans/overview.html` excluded, returns zero hits: `edit plans/overview.html`, `roadmap-data`, `lastRanAt timestamp`.
- [ ] **Narrow grep AC**: `git grep -n "edit plans/overview.html" -- :!plans/overview.html .agents/ plans/ packages/` returns zero hits.
- [ ] Does NOT touch `.agents/skills/roadmap-and-overview/SKILL.md` (that is US-005b's territory; running this story before SKILL is finalized must be safe).
- [ ] Typecheck passes.

## Out of Scope

- `.agents/skills/roadmap-and-overview/SKILL.md` (US-005b).
- Any code changes in `plans/overview.html` or `plans/overview-data.js`.
- Task or phase-tree porting (US-003 / US-004).
