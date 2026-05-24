# PRD: docs-sweep (overview-data-split)

## Introduction / Overview

Schema-shape-independent doc edits across `plans/` to redirect every reference that tells agents to edit `plans/overview.html` for task state. Re-point them at `plans/overview-data.js`. Also fix the stale `?id=foo,bar` URL-filter references in `plans/overview-vite-react.md` (the actual URL param is `?tasks=`, confirmed at `plans/overview.html:3206`), re-point the `lastRanAt timestamp` / `roadmap-data JSON` phrasings in `plans/parallel-assignments.md`, and update the `roadmap-plugin` prompt body.

This job runs in Phase 3 fully parallel-safe with `full-task-port` (US-003) and `phase-tree-port` (US-004) — the file lists are disjoint. It explicitly does NOT touch `.agents/skills/roadmap-and-overview/SKILL.md` (US-005b owns the SKILL rewrite in Phase 4).

## Goals

1. Update `plans/codexu-roadmap.md` Companion-snapshot callout and Task-phase-model rule to reference `plans/overview-data.js`.
2. Add a "data file is source of truth" note to `plans/parallel-assignments.md` top; re-point stale `lastRanAt timestamp` / `roadmap-data JSON` phrasings; keep the bottom status table.
3. Re-point references in `plans/agent-view-research.md` and `plans/codex-agent-parity-audit.md` line 1358.
4. Fix `?id=` → `?tasks=` at `plans/overview-vite-react.md` lines 66 and 147; add a note about the `dangerouslySetInnerHTML` consumption pattern for `kanbanCards[].html` and `phaseTree` `raw` nodes.
5. Update the `roadmap-plugin` prompt body (locate via grep).
6. Pass the narrow grep AC and the broad grep AC (zero hits for `edit plans/overview.html`, `roadmap-data`, `lastRanAt timestamp` in `.agents/ plans/ packages/` with `plans/overview.html` excluded).
7. Do NOT modify `.agents/skills/roadmap-and-overview/SKILL.md`.

## User Stories

### US-005a: Docs sweep (stale-reference fixes outside SKILL.md)

As an autonomous bookkeeper agent, I want every standing doc outside the SKILL to stop telling agents to edit `plans/overview.html` for task state and to start pointing at `plans/overview-data.js`, so that the source-of-truth shift is consistent across all human- and agent-facing references — independent of when the SKILL rewrite (US-005b) finalizes. This story is schema-shape-independent: it does NOT depend on `tasks[]` or `phaseTree[]` final content because all edits are at the file-path / parameter-name level.

**Acceptance Criteria:**
- [ ] `plans/codexu-roadmap.md` Companion-snapshot callout (lines 5-9) and Task-phase-model standing rule (line 175) reference `plans/overview-data.js`.
- [ ] `plans/parallel-assignments.md` top adds a "data file is source of truth" note; bottom status table remains as a derived view.
- [ ] `plans/parallel-assignments.md` lines 225, 235, 242, 247 — stale "bump lastRanAt timestamp in plans/overview.html's roadmap-data JSON" and "Add new task entries to plans/parallel-assignments.md and plans/overview.html roadmap-data JSON" phrasings — re-pointed to `plans/overview-data.js`.
- [ ] `plans/agent-view-research.md` and `plans/codex-agent-parity-audit.md` line 1358 — references to editing `overview.html` for task state re-pointed.
- [ ] `plans/overview-vite-react.md` lines 66 and 147 — stale `?id=foo,bar` URL-filter references updated to `?tasks=` (matching `parseTaskIdFilter()` at `plans/overview.html` line 3206). `plans/overview-vite-react.md` also adds a note that `<KanbanCard>` and `<PhaseTreeNode>` raw branches consume `kanbanCards[].html` and `phaseTree` `raw` nodes via `dangerouslySetInnerHTML` (trusted-HTML escape hatch documented in this plan's Risk Area #9).
- [ ] The `roadmap-plugin` prompt body (locate via `git grep roadmap-plugin plans/`) is updated to describe the data-file edit model, not HTML edits.
- [ ] **Broad grep AC**: each of the following, run against `.agents/ plans/ packages/` with `plans/overview.html` excluded, returns zero hits: `edit plans/overview.html`, `roadmap-data`, `lastRanAt timestamp`. The phrase `generatedFromCommit` is allowed only inside `plans/overview-data.js`.
- [ ] **Narrow grep AC**: `git grep -n "edit plans/overview.html" -- :!plans/overview.html .agents/ plans/ packages/` returns zero hits.
- [ ] Does NOT touch `.agents/skills/roadmap-and-overview/SKILL.md` (that's US-005b's territory; running this story before SKILL is finalized must be safe).
- [ ] Typecheck passes.

**Dependencies:** US-002 (representative-port — establishes the data file exists; this story's edits don't depend on its content).
**Estimated complexity:** small.

## Non-Goals (Out of Scope)

- `.agents/skills/roadmap-and-overview/SKILL.md` (US-005b).
- Any code changes in `plans/overview.html` or `plans/overview-data.js`.
- Task or phase-tree porting (US-003 / US-004).

## Design Considerations

- Edits are at the file-path and parameter-name level, schema-shape-independent. Safe to run before US-003 and US-004 finalize.
- The `?id=` → `?tasks=` fix in `plans/overview-vite-react.md` matches the actual implementation at `plans/overview.html:3206`. This was caught as F-011 in plan review.
- The "trusted-HTML escape hatch" note for `<KanbanCard>` and `<PhaseTreeNode>` is forward-looking documentation for Plan #3 (Vite + React).

## Technical Considerations

- The `roadmap-plugin` prompt body location is not pre-known; the implementer must `git grep` to find it (likely in `plans/parallel-assignments.md` ralph command rows).
- The broad grep AC permits `generatedFromCommit` ONLY inside `plans/overview-data.js`. The data file doesn't exist on this worktree's branch (it's created by `foundation` / US-001 on a different branch); the AC applies after the orchestrator merges all phase branches.

## Success Metrics

- All six bullet lists above pass.
- The grep ACs return zero hits.
- `.agents/skills/roadmap-and-overview/SKILL.md` is byte-for-byte unchanged on this branch (compared to base).

## Open Questions

- Location of the `roadmap-plugin` prompt body — resolve at implementation time via `git grep`.
