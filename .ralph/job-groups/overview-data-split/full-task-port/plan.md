# Implementation Plan: full-task-port (overview-data-split / Phase 3)

*Job-scoped slice of `.ralph/job-groups/overview-data-split/plan.md`. Covers US-003 only. Depends on `representative-port` (US-002). Runs parallel with `phase-tree-port` and `docs-sweep` in Phase 3.*

## Overview

Extract the remaining 48 tasks from `plans/overview.html` into `OVERVIEW_DATA.tasks[]`, delete all original HTML kanban cards (lines 1083-1425) and `<details class="cmd">` rows (lines 1442-1914), and let `renderTasks()` drive the entire kanban + command sections. After this story, the only static HTML left for tasks is empty container `<div>`s.

## Parallel-execution Contract

This job runs in the same phase as `phase-tree-port` (US-004) and `docs-sweep` (US-005a). To avoid merge conflicts:

1. **Skeleton-ownership invariant (load-bearing).** This job mutates ONLY the `tasks[]` array body — appending entries inside the existing `tasks: [` ... `]` braces. It does NOT add or reorder other top-level fields in `OVERVIEW_DATA`, does NOT touch `phaseTree[]`, does NOT re-format the surrounding object literal. The diff against US-002's HEAD shows only `tasks[]`-internal additions, `plans/overview.html` deletions inside lines 1083-1425 / 1442-1914, and `renderTasks()` body completion.
2. **Inline-script section markers.** The `renderTasks()` body lives inside the `// ===== renderTasks() =====` block US-002 emitted. The `// ===== renderPhaseTree() =====` marker is NOT touched (US-004 owns it).
3. **File-overlap risk = medium** (acknowledged in `suggested-decomposition.json`). Disjoint line ranges in `plans/overview.html`: this job edits kanban (1083-1425) and command rows (1442-1914); US-004 edits phase tree (1920-2009). The worktree merge handles disjoint ranges cleanly.

## Files to Modify

**`plans/overview-data.js`:**
- Append 48 entries to `tasks[]` (one per remaining HTML-authored task).
- Each entry uses the schema US-002 established (`id`, `title`, `scope`, `phase`, `status`, `planOnly`, `mergeCommit`, `planSource*`, `command: {summaryHtml, descriptionHtml, warnings, planPrompt}`, `kanbanCards: [...]`, `spawnedFrom`, `lastTouchedAt`).
- Final `tasks[]` length = 49 (3 from US-002 + 46 new). No duplicate `id`s.

**`plans/overview.html`:**
- DELETE: all remaining authored `<div class="card">` kanban entries (lines ~1083-1425 minus the 3 US-002 deleted).
- DELETE: all remaining `<details class="cmd">` rows (lines ~1442-1914 minus the 3 US-002 deleted).
- After deletions: zero authored static `<div class="card">` elements in the document body; zero `<details class="cmd">` rows in the authored HTML body. Card markup may exist ONLY inside JS string templates / DOM-construction code within the inline `<script>`.
- COMPLETE: `renderTasks()` body — should already render correctly for all 49 tasks via the loop US-002 wrote; only filler if US-002 hard-coded the 3 ids (then generalize to walk `tasks[]`).
- PRESERVE: section headers, legend, URL filter banner DOM, search input, all CSS, all `<style>` blocks, all other IIFEs.

## Porting Rules

1. **HTML-entity decoding for prompt bodies.** Each prompt string in the existing `<pre class="cmd-pre">` may contain `&lt;`, `&gt;`, `&amp;`, `&quot;`, `&#39;` etc. for shell metacharacters like `2&gt;&amp;1`. Decode ONCE at port time (e.g. via `textarea.innerHTML = x; textarea.value` in a Node helper script, or DOMParser). The render path uses `textContent` so they round-trip identically without re-encoding.
2. **Multiple kanban cards per task.** Codex-confirmed: `1b-multidev` (handled by US-002), `polish-Fs` (handled by US-002), `perf-WS2`, `agent-comms` each render >1 card. For each of these, `kanbanCards[]` must capture every card with full `cardClass` / `inlineStyle` / `html` fields.
3. **Conditional inline styles are NOT derivable.** `phase === "shipped"` typically maps to `border-color: var(--ok); opacity: 0.8` and `status === "paused"` to `border-color: var(--muted); opacity: 0.7`, BUT some cards (e.g. `class="card closed"` at line 1174) carry no phase/status mapping. The per-card `cardClass` and `inlineStyle` fields are authoritative — capture verbatim from the existing HTML, do not derive.
4. **Rich description content.** `.cmd-desc` blocks contain inline `<code>` and `<a>` tags; warnings are ordered rich text; some tasks have no command body. Schema uses `descriptionHtml` (trusted HTML fragment) plus structured `warnings[]`.
5. **`data-*` attributes preserved.** Each `<details class="cmd">` carries `data-task-id`, `data-task-scope`, `data-task-phase`, `data-task-status`; 3 rows carry `data-plan-only="true"`; 6 rows carry `data-merge-commit="<sha>"`. `renderTasks()` (already authored by US-002) re-emits these from data fields.

## Files to Read as Reference

- `plans/overview.html` lines 1083-1914 (kanban + command rows for the 48 unported tasks; the 3 US-002 deleted are already gone)
- `plans/overview.html` lines 3070-3096 (counts IIFE — must continue working post-port)
- `plans/overview.html` line 3106 (localStorage v2 key)
- `plans/overview.html` lines 3206-3254 (`parseTaskIdFilter()` — URL param is `?tasks=`, not `?id=`)
- `plans/overview.html` line 2984 (`buildTodayPanel()` — classifies rendered DOM by `data-task-id` + status)
- `plans/overview-data.js` (US-001 created skeleton, US-002 added 3 entries) — schema-comment block and current `tasks[]` shape
- `.ralph/job-groups/overview-data-split/plan.md` § "Data schema" for the full schema reference

## Acceptance Criteria

- [ ] `tasks[]` contains exactly 49 entries total (the 3 from US-002 + 46 new); no two entries share the same `id` (deduplication check).
- [ ] **Skeleton-ownership invariant respected.** This story mutates ONLY the `tasks[]` array body. The diff against US-002's HEAD shows only `tasks[]`-internal additions, `plans/overview.html` deletions inside lines 1083-1425 / 1442-1914, and `renderTasks()` body completion. Does NOT touch `phaseTree[]`, does NOT re-format the surrounding object literal.
- [ ] `plans/overview.html` contains zero authored static `<div class="card">` elements in the document body (card markup may exist only inside JS string templates or DOM-construction code within the inline `<script>`).
- [ ] `plans/overview.html` contains zero `<details class="cmd">` rows in the authored HTML body (all rendered from data).
- [ ] All HTML-entity decoding for prompt bodies happened once at port time; `tasks[].command.planPrompt` strings contain literal `<`, `>`, `&` (no `&lt;`, `&gt;`, `&amp;`).
- [ ] Manual copy-paste check on first 3 + last 3 tasks (by `tasks[]` order): clipboard text from the rendered `<pre class="cmd-pre">` equals `tasks[].command.planPrompt` byte-for-byte.
- [ ] **Identical-render check** (6 concrete checks):
  1. Kanban column counts match pre-refactor (`#kanban-ready`, `#kanban-soon`, `#kanban-blocked` show the same N/M/K).
  2. Command row count = 49.
  3. Every `#cmd-<id>` hash link in URL bar jumps to a matching `<details>` after reload.
  4. `?tasks=<id1>,<id2>` URL filter shows exactly those tasks.
  5. Every kanban card retains its `.card-meta` block content (pills, icons, links, `<code>`).
  6. Section counts (`#counts-cmds`, `#counts-kanban`) populate correctly via the existing IIFE.
- [ ] **Today-panel check**: after editing `plans/overview-data.js` to change one task's `phase` to `impl-in-progress`, a single page reload places the task's id-chip in `#today-running` with no console errors. Confirms `buildTodayPanel()` at line 2984 still classifies the freshly-rendered DOM correctly.
- [ ] Bookkeeper workflow: flipping a task's `phase` from `impl-in-progress` to `shipped` requires editing exactly one entry in `overview-data.js` and zero edits to `overview.html`. The change reflects in kanban placement, command-row badge, phase tree pill (after US-004 lands), and Today panel without further file edits.
- [ ] Typecheck passes.

## Out of Scope

- Phase tree (US-004 / `phase-tree-port`).
- Docs sweep (US-005a / `docs-sweep`).
- SKILL.md (US-005b / `skill-rewrite`).
- Any new task fields beyond the schema established in US-001/US-002.
- Splitting render JS into a separate file (Plan #3).
