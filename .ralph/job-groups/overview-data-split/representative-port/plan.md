# Implementation Plan: representative-port (overview-data-split / Phase 2)

*Job-scoped slice of `.ralph/job-groups/overview-data-split/plan.md`. Covers US-002 only. Depends on `foundation` (US-001).*

## Overview

Establish the data-driven render pipeline by porting 3 representative tasks into `OVERVIEW_DATA.tasks[]` and adding `renderTasks()` + `<details>` open-state preserve/restore. The other 48 tasks stay HTML-authored for now. The 3 tasks are chosen to exercise the schema corners:

- **`perf-WS3`** — phase=shipped + `mergeCommit` populated
- **`1b-multidev`** — multiple `kanbanCards[]` entries; paused/blocked semantics
- **`polish-Fs`** — rich `warnings[]` content

This story emits BOTH section markers (`// ===== renderTasks() =====` and `// ===== renderPhaseTree() =====`) into the inline `<script>` block. US-004 (`phase-tree-port`) will fill the phase-tree marker; the `renderTasks()` marker is owned by this story and US-003 only.

## Render Pipeline Contract

1. `<script src="overview-data.js">` loads before the main inline `<script>` (already wired by `foundation`).
2. `renderTasks()` runs **synchronously at the top of the main inline `<script>` (line 2614+), BEFORE the first DOM-walking IIFE** (`PHASE_TO_ORDER_BUCKET` / `renderPhaseBadges` / counts / filters).
3. For each task in `OVERVIEW_DATA.tasks` (this story: only the 3), emit:
   - Kanban cards into `#kanban-ready` / `#kanban-soon` / `#kanban-blocked` (one `<div class="card">` per `kanbanCards[]` entry, with `cardClass`/`inlineStyle` applied).
   - Command rows into `#cmd-list` as `<details class="cmd" id="cmd-${id}" data-task-id, data-task-scope, data-task-phase, data-task-status, data-plan-only?, data-merge-commit?>`.
4. Prompt bodies in `<pre class="cmd-pre">` are assigned via `textContent` (or `document.createTextNode`), NEVER via `innerHTML` or template-string interpolation.
5. **Open-state preserve/restore**: `renderTasks()` snapshots `Array.from(document.querySelectorAll('details.cmd[open]')).map(el => el.id)` BEFORE the wipe, then re-applies `el.open = true` AFTER render.
6. Existing IIFEs (`renderPhaseBadges`, `injectTaskScopeChips`, counts, filters, URL banner, spawn injection, run history, localStorage v2 persistence) run as-is against the freshly-emitted DOM.

## Schema (the 3 task entries this story authors)

Per the data schema in `.ralph/job-groups/overview-data-split/plan.md`:

```js
{
  id: "perf-WS3", title: "...", scope: "codexu", phase: "shipped", status: "ok",
  planOnly: false, mergeCommit: "197b0148", planSource: "fresh",
  planSourceRef: null, planJobId: null,
  command: {
    summaryHtml: "...",        // <summary> inner HTML
    descriptionHtml: "...",    // .cmd-desc inner HTML (may contain <code>, <a>)
    warnings: [{kind, html}],
    planPrompt: "..."          // decoded shell-safe string; render via textContent
  },
  kanbanCards: [
    {column: "ready"|"soon"|"blocked", cardClass: string|null,
     inlineStyle: string|null, html: "..."}
  ],
  spawnedFrom: null,
  lastTouchedAt: "2026-..."
}
```

**HTML entity decoding:** prompt strings in the existing HTML contain `&lt;`, `&gt;`, `&amp;` for shell metacharacters like `2&gt;&amp;1`. Decode once when porting; the render path uses `textContent` so they round-trip identically.

**Multiple kanban cards:** `1b-multidev` renders >1 card. `kanbanCards[]` must capture every one.

## Files to Create / Modify

**Modify:**
- `plans/overview-data.js`:
  - Append exactly 3 entries to `tasks[]`: `perf-WS3`, `1b-multidev`, `polish-Fs`.
  - **Skeleton invariant**: mutate ONLY the `tasks[]` array body; do not touch other top-level fields or re-format the surrounding object literal.
- `plans/overview.html`:
  - ADD: `renderTasks()` function in a `// ===== renderTasks() =====` block near the top of the main inline `<script>` (line 2614+).
  - ADD: empty stub `// ===== renderPhaseTree() =====` block (function exists but does nothing yet; US-004 will fill it).
  - ADD: `<details>` open-state snapshot/restore inside `renderTasks()`.
  - ADD: empty containers if not already present: `<div id="kanban-ready">`, `<div id="kanban-soon">`, `<div id="kanban-blocked">`, `<div id="cmd-list">`, `<div id="phase-tree">`.
  - DELETE: the 3 original HTML blocks for `perf-WS3`, `1b-multidev`, `polish-Fs` (both kanban cards and `<details class="cmd">` rows) — only after visual pixel-identical verification against the still-present rendered versions.

**Read as reference:**
- `plans/overview.html` lines 1083-1425 (kanban cards for 3 tasks), 1442-1914 (command rows for 3 tasks), 2614+ (main inline script insertion point), 3070-3096 (counts IIFE), 3106 (localStorage v2 key), 3265-3301 (filter IIFE), 3530-3533 (`getRoadmapData()`), 3540-3543 (freshness hint).
- `plans/overview-data.js` (created by `foundation`) — schema-comment block, current top-level skeleton.

## Acceptance Criteria

- [ ] Section markers `// ===== renderTasks() =====` and `// ===== renderPhaseTree() =====` exist near the top of the inline `<script>` block in `plans/overview.html`. US-004 will fill the phase-tree marker; this story emits an empty stub.
- [ ] `renderTasks()` runs synchronously at the top of the main inline `<script>`, BEFORE the first DOM-walking IIFE.
- [ ] `tasks[]` contains exactly 3 entries (`perf-WS3`, `1b-multidev`, `polish-Fs`) with full `command`, `kanbanCards[]`, schema-correct fields.
- [ ] `kanbanCards[]` entries are `{column, cardClass: string|null, inlineStyle: string|null, html: string}`; rich `.card-meta` content round-trips verbatim.
- [ ] Render emits `<div class="card${card.cardClass ? ' ' + card.cardClass : ''}"${card.inlineStyle ? ' style="' + card.inlineStyle + '"' : ''} data-task-id="${task.id}">${card.html}</div>` for each kanban card.
- [ ] Render emits `<details class="cmd" id="cmd-${task.id}" data-task-id="${task.id}" data-task-scope="${task.scope}" data-task-phase="${task.phase}" data-task-status="${task.status}"${task.planOnly ? ' data-plan-only="true"' : ''}${task.mergeCommit ? ' data-merge-commit="${task.mergeCommit}"' : ''}>` for each command row.
- [ ] Prompt bodies in `<pre class="cmd-pre">` are written via `textContent` (or `document.createTextNode`), NEVER via `innerHTML` or template-string interpolation into an HTML fragment.
- [ ] The 3 data-rendered rows are visually pixel-identical to the (still-present) HTML rows; the 3 original HTML blocks are deleted by end of story.
- [ ] **Open-state preserve/restore**: `renderTasks()` snapshots `Array.from(document.querySelectorAll('details.cmd[open]')).map(el => el.id)` BEFORE the wipe, then re-applies `el.open = true` AFTER render. Test: expand 2 details, call `renderTasks()` from console, both remain open.
- [ ] **localStorage v2 persistence still works**: open 2 details, reload page on `file://`, the same 2 are open.
- [ ] Existing IIFEs (`renderPhaseBadges`, `injectTaskScopeChips`, counts, filters, URL banner, spawn injection, run history) continue to function against the freshly-emitted DOM for the 3 ported tasks.
- [ ] **Skeleton invariant respected**: diff shows ONLY `tasks[]`-internal additions, render-code additions in `plans/overview.html`, and deletions of the 3 original HTML blocks. No re-formatting of `OVERVIEW_DATA`'s top-level braces / key order.
- [ ] Typecheck passes.

## Out of Scope

- The remaining 48 tasks (US-003 / `full-task-port`).
- `phaseTree[]` entries or `renderPhaseTree()` body (US-004 / `phase-tree-port`).
- Docs sweep or SKILL.md (US-005a / US-005b).
