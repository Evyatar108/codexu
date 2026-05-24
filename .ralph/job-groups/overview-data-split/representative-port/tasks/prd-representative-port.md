# PRD: representative-port (overview-data-split)

## Introduction / Overview

Establish the data-driven render pipeline for the overview viewer. Port 3 representative tasks (`perf-WS3`, `1b-multidev`, `polish-Fs`) into `OVERVIEW_DATA.tasks[]`, add a synchronous `renderTasks()` function to `plans/overview.html` that emits kanban cards and command rows from data, and implement `<details>` open-state preserve/restore. The remaining 48 tasks stay HTML-authored until `full-task-port` (US-003). This story validates the render pipeline + DOM contracts + open-state preservation before the bulk port, and emits both section markers (`renderTasks()` body authored, `renderPhaseTree()` empty stub) so US-004 has a defined slot to fill.

## Goals

1. Append 3 representative task entries (`perf-WS3`, `1b-multidev`, `polish-Fs`) to `OVERVIEW_DATA.tasks[]` covering schema corners (shipped+mergeCommit, multiple kanban cards, rich warnings).
2. Implement `renderTasks()` synchronously at the top of the main inline `<script>` (line 2614+ of `plans/overview.html`), BEFORE any DOM-walking IIFE.
3. Emit both section markers (`// ===== renderTasks() =====` and `// ===== renderPhaseTree() =====`) so US-004 has a clearly-marked slot.
4. Implement `<details>` open-state snapshot/restore around the wipe-and-render cycle.
5. Delete the 3 original HTML blocks (kanban cards and command rows for the 3 tasks) only after visually verifying pixel-identical render against the still-present HTML versions.
6. Preserve all existing IIFEs (counts, filters, URL banner, spawn injection, run history, localStorage v2 persistence) — they must continue working against the freshly-emitted DOM.

## User Stories

### US-002: Establish render pipeline + port 3 representative tasks + open-state preserve/restore

As a bookkeeper, I want `renderTasks()` to data-drive 3 representative tasks (`perf-WS3` shipped+mergeCommit, `1b-multidev` multiple-kanban-cards, `polish-Fs` rich warnings) while the other 48 stay HTML-authored, so that the render pipeline + DOM contracts + `<details>` open-state preservation are validated before the bulk port.

**Acceptance Criteria:**
- [ ] Section markers `// ===== renderTasks() =====` and `// ===== renderPhaseTree() =====` exist near the top of the inline `<script>` block in `plans/overview.html` (US-004 will fill the phase-tree marker; this story emits an empty stub).
- [ ] `renderTasks()` runs synchronously at the top of the main inline `<script>` (line 2614+), BEFORE the first DOM-walking IIFE (`PHASE_TO_ORDER_BUCKET` / `renderPhaseBadges` / counts / filters).
- [ ] `tasks[]` contains exactly 3 entries (`perf-WS3`, `1b-multidev`, `polish-Fs`) with full `command`, `kanbanCards[]`, schema-correct fields.
- [ ] Schema: `kanbanCards[]` entries are `{column, cardClass: string|null, inlineStyle: string|null, html: string}`; rich `.card-meta` content round-trips verbatim.
- [ ] Render emits `<div class="card${card.cardClass ? ' ' + card.cardClass : ''}"${card.inlineStyle ? ' style="' + card.inlineStyle + '"' : ''} data-task-id="${task.id}">${card.html}</div>` for each kanban card.
- [ ] Render emits `<details class="cmd" id="cmd-${task.id}" data-task-id="${task.id}" data-task-scope="${task.scope}" data-task-phase="${task.phase}" data-task-status="${task.status}"${task.planOnly ? ' data-plan-only=\"true\"' : ''}${task.mergeCommit ? ' data-merge-commit=\"${task.mergeCommit}\"' : ''}>` for each command row.
- [ ] Prompt bodies in `<pre class="cmd-pre">` are written via `textContent` (or `document.createTextNode`), NEVER via `innerHTML` or template-string interpolation into an HTML fragment.
- [ ] The 3 data-rendered rows are visually pixel-identical to the (still-present) HTML rows; the 3 original HTML blocks are deleted by end of story.
- [ ] **Open-state preserve/restore**: `renderTasks()` snapshots `Array.from(document.querySelectorAll('details.cmd[open]')).map(el => el.id)` BEFORE the wipe, then re-applies `el.open = true` AFTER render. Verified test: expand 2 details, call `renderTasks()` from console, both remain open.
- [ ] **localStorage v2 persistence still works**: open 2 details, reload page on `file://`, the same 2 are open.
- [ ] Existing IIFEs (`renderPhaseBadges`, `injectTaskScopeChips`, counts, filters, URL banner, spawn injection, run history) continue to function against the freshly-emitted DOM for the 3 ported tasks.
- [ ] Skeleton-ownership invariant respected: this story appends only to `tasks[]`; no re-formatting of other top-level fields in `OVERVIEW_DATA`.
- [ ] Typecheck passes.

**Dependencies:** US-001 (foundation — `OVERVIEW_DATA` skeleton must exist).
**Estimated complexity:** large.

## Non-Goals (Out of Scope)

- The remaining 48 tasks (US-003).
- `phaseTree[]` entries or any non-stub `renderPhaseTree()` body (US-004).
- Any docs or SKILL.md changes (US-005a / US-005b).
- Splitting render JS into a separate file (Plan #3).

## Design Considerations

- **HTML-entity decoding** for prompt bodies: ~3 prompts in the chosen tasks may contain `&lt;`, `&gt;`, `&amp;` for shell metacharacters. Decode once at port time; the render path uses `textContent` so they round-trip identically.
- **Multiple kanban cards** per task: `1b-multidev` renders multiple cards. `kanbanCards[]` must capture every one; `column` field determines target container (`#kanban-ready` / `#kanban-soon` / `#kanban-blocked`).
- **Trusted-HTML escape hatch**: `kanbanCards[].html` carries trusted inner HTML of `<div class="card">` to round-trip pills, icons, `<code>`, `<a>` verbatim. Render assigns via DOM string assignment.
- **Render order**: existing IIFEs assume DOM is pre-populated. `renderTasks()` must run synchronously at the top of the main inline `<script>`, BEFORE the first DOM-walking IIFE.

## Technical Considerations

- The inline JSON has already been hoisted to `plans/overview-data.js` by US-001; this story mutates `OVERVIEW_DATA.tasks[]` and adds render code to `plans/overview.html`.
- Open-state snapshot must run BEFORE wiping `#cmd-list` / kanban containers, else the IDs are gone before snapshot.
- localStorage key is `codexu-overview-details-state-v2` (`plans/overview.html` line 3106) — verify the persistence IIFE re-applies on the new DOM.
- `getRoadmapData()` (rewired by US-001) returns `window.OVERVIEW_DATA`; `renderTasks()` should call `getRoadmapData()` rather than reading the global directly, to stay consistent with existing IIFEs.

## Success Metrics

- Pixel-identical render between the 3 data-driven rows and their (pre-deletion) HTML originals.
- After deletion: page still renders identically end-to-end (3 rows from data, 48 still from HTML).
- Open-state preserve/restore works via console call and localStorage reload.
- All existing IIFEs continue functioning (counts, filters, URL banner, etc.).

## Open Questions

- The exact insertion site for the section markers within the main inline `<script>` should be just above the first DOM-walking IIFE — the implementer should pick the exact line based on what's there at the time, then comment the choice.
