# PRD: phase-tree-port (overview-data-split)

## Introduction / Overview

Port the entire phase tree section (`plans/overview.html` lines 1920-2009) into `OVERVIEW_DATA.phaseTree[]` with a rich node schema that handles both task-linked bullets (`task-ref`) and structural bullets with no task id (`raw`, for `1b.1`, `4a-4m`, etc.). Implement `renderPhaseTree()` to data-drive `#phase-tree`, including state classes (`open|deferred|donefade|closed`), inline styles via `raw` nodes, nested `<details class="phase-subdetails">` collapsibles (phases 4 and 5), and `<span class="ptag">` rich-header content. Delete the original authored HTML.

This job runs in Phase 3 in parallel with `full-task-port` (US-003) and `docs-sweep` (US-005a). The skeleton-ownership invariant — mutate only `phaseTree[]` and the `renderPhaseTree()` marker block — is load-bearing for parallel merge safety.

## Goals

1. Populate `OVERVIEW_DATA.phaseTree[]` with every node from the authored HTML (including non-task structural bullets, inline-style bullets, nested collapsibles, rich `<span class="ptag">` headers).
2. Implement `renderPhaseTree()` that emits a DOM identical to the pre-refactor authored HTML (same `.phase-grid`, `.phase`, `.phase-head`, `.item-name` with state classes, `<details class="phase-subdetails">` wrappers).
3. Delete the original phase tree HTML at `plans/overview.html` lines 1920-2009.
4. Drop any `task-ref` whose `taskId` is not present in `tasks[]` rather than carrying dead references; log to commit message.
5. Maintain the skeleton-ownership invariant: touch only `phaseTree[]` and the `// ===== renderPhaseTree() =====` marker block, never `tasks[]` or `// ===== renderTasks() =====`.

## User Stories

### US-004: Port phase tree into phaseTree[] with rich node schema

As a bookkeeper, I want `OVERVIEW_DATA.phaseTree` to hold the entire phase tree (including non-task structural bullets like `1b.1` and `4a-4m`) and `renderPhaseTree()` to data-drive `#phase-tree`, so that the section becomes maintainable from one file.

**Acceptance Criteria:**
- [ ] `phaseTree[]` is populated. Each phase node carries `{id, title, headerHtml?, collapsible?, collapsibleSummary?, nodes: [{kind: 'task-ref'|'raw', taskId?, state?: 'open'|'deferred'|'donefade'|'closed', html?, trailingHtml?}, ...], subPhases: recursive}`.
- [ ] **Skeleton-ownership invariant respected.** This story mutates ONLY the `phaseTree[]` array body US-001 stubbed. It does NOT touch `tasks[]`, does not add or reorder other top-level fields, does not re-format the surrounding object literal. `renderPhaseTree()` body lives inside the `// ===== renderPhaseTree() =====` section marker US-002 emitted; the `// ===== renderTasks() =====` marker is not touched. (Enables parallel execution with US-003.)
- [ ] `task-ref` nodes carry `taskId` (must match an entry in `tasks[]`) plus optional `state` (`open|deferred|donefade|closed`) for the `.item-name` class.
- [ ] `raw` nodes carry trusted inner HTML for structural bullets that have no task id (e.g. `1b.1`, `4a-4m`).
- [ ] `renderPhaseTree()` fills the `#phase-tree` container, emitting `.phase-grid`, `.phase`, `.phase-head`, `.item-name` with state classes, and nested `<details class="phase-subdetails">` collapsibles to match the pre-refactor HTML.
- [ ] `plans/overview.html` no longer contains the authored phase tree section at lines 1920-2009.
- [ ] Page on `file://` renders the phase tree identically (same headers, same bullets, same state classes, same collapsibles).
- [ ] Drift handling: any `task-ref` whose `taskId` is not present in `tasks[]` is dropped at port time (logged in the commit message), not carried as a dead reference.
- [ ] Section markers maintained: `renderPhaseTree()` fills the `// ===== renderPhaseTree() =====` block US-002 stubbed.
- [ ] Typecheck passes.

**Dependencies:** US-002 (representative-port — render pipeline + section markers established).
**Estimated complexity:** medium.

## Non-Goals (Out of Scope)

- The 48 unported tasks (US-003).
- Docs sweep (US-005a).
- SKILL.md (US-005b).
- Restructuring `renderPhaseBadges()` IIFE.
- Splitting render JS to a separate file (Plan #3).

## Design Considerations

- **Non-task structural bullets.** Bullets like `1b.1` and `4a-4m` have no task id; use `{kind: "raw", html}` with the verbatim `<li>` inner HTML. This round-trips inline styles (`style="color: var(--warn);"`) and composite multi-`.item-name` lines.
- **State classes are load-bearing for styling.** `.item-name.open`, `.item-name.deferred`, `.item-name.donefade`, `.item-name.closed` drive strike-through and color. Capture verbatim from existing HTML.
- **Collapsibles.** Phases 4 and 5 wrap items in `<details class="phase-subdetails"><summary>…</summary>`. Schema captures `collapsible: true` + `collapsibleSummary` per phase node.
- **Rich headers.** Some `.phase-head` contains `<span class="ptag">…</span>`. Schema captures `headerHtml` for these; falls back to plain `title` text otherwise.
- **Trusted-HTML escape hatch (deliberate).** `raw` nodes carry trusted inner HTML for irregular bullets too varied to round-trip from structured fields. Data file is operator/agent-authored — trust by convention.

## Technical Considerations

- **Parallel-merge file overlap (medium risk).** This job and `full-task-port` both edit `plans/overview.html` and `plans/overview-data.js`. Disjoint line ranges: phase tree (1920-2009) vs kanban/commands (1083-1425, 1442-1914). Skeleton-ownership ensures clean merges on `OVERVIEW_DATA` and the inline `<script>`.
- **Render contract for `renderPhaseTree()`.** Lives inside the marker block US-002 emitted. Must call into `getRoadmapData()` (US-001 rewired) for the data, walk `phaseTree[]`, and emit DOM that matches the pre-refactor CSS selectors.
- **Cross-link to `tasks[]`.** `task-ref` `taskId`s should resolve to entries in `tasks[]` so phase pills can highlight. After US-003 lands, all 51 should be present; until then, drop any drift cases.

## Success Metrics

- Pre/post refactor visual diff of `#phase-tree`: identical headers, bullets, state classes, collapsibles, inline styles.
- 0 dead `task-ref` references in `phaseTree[]` (dropped during port; logged in commit).
- 0 changes to `tasks[]` or the `renderTasks()` marker (skeleton-ownership invariant respected).

## Open Questions

- The exact set of phase nodes that require `headerHtml` vs plain `title` should be determined by reading the existing HTML; the implementer should document any unusual cases in the commit message.
