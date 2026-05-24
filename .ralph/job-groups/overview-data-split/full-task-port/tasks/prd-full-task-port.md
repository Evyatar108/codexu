# PRD: full-task-port (overview-data-split)

## Introduction / Overview

Bulk-port the remaining 48 tasks out of `plans/overview.html` and into `OVERVIEW_DATA.tasks[]`. Delete every authored kanban card and `<details class="cmd">` row from the HTML body so the page is entirely data-driven for task content. After this story, the only static HTML for tasks is the empty container `<div>`s that `renderTasks()` populates.

This job runs in Phase 3 in parallel with `phase-tree-port` (US-004) and `docs-sweep` (US-005a). The skeleton-ownership invariant — mutate only `tasks[]`, never touch `phaseTree[]` or the surrounding object literal — is load-bearing for parallel merge safety.

## Goals

1. Append exactly 48 task entries to `OVERVIEW_DATA.tasks[]`, bringing the total to 51 with zero duplicate `id`s.
2. Delete every remaining authored `<div class="card">` and `<details class="cmd">` from `plans/overview.html`.
3. Decode HTML entities (`&lt;`, `&gt;`, `&amp;`, `&quot;`, `&#39;`) in prompt bodies exactly once at port time; render path keeps `textContent`-only assignment.
4. Preserve identical render: kanban column counts unchanged, command row count = 51, hash navigation works, URL filter `?tasks=` works, kanban `.card-meta` blocks intact, section counts populate correctly.
5. Verify the bookkeeper workflow: flipping a task's `phase` requires editing exactly one entry in `overview-data.js` and zero edits to `overview.html`.
6. Verify the Today-panel pipeline: changing a task's `phase` to `impl-in-progress` in the data file and reloading places its id-chip in `#today-running`.

## User Stories

### US-003: Port remaining 48 tasks; full data-driven render

As a bookkeeper, I want all remaining 48 tasks ported into `tasks[]` and all original HTML kanban cards + command rows deleted, so that `renderTasks()` drives the entire kanban + command sections.

**Acceptance Criteria:**
- [ ] `tasks[]` contains exactly 51 entries total (the 3 from US-002 + 48 new); no two entries share the same `id` (deduplication check).
- [ ] **Skeleton-ownership invariant respected.** This story mutates ONLY the `tasks[]` array body — appending entries inside the existing `tasks: [` ... `]` braces. It does NOT add or reorder other top-level fields, does not touch `phaseTree[]`, does not re-format the surrounding object literal. The diff against US-002's HEAD shows only `tasks[]`-internal additions, `plans/overview.html` deletions inside lines 1083-1425 / 1442-1914, and `renderTasks()` body completion. (Enables parallel execution with US-004.)
- [ ] `plans/overview.html` contains zero authored static `<div class="card">` elements in the document body (card markup may exist only inside JS string templates or DOM-construction code within the inline `<script>`).
- [ ] `plans/overview.html` contains zero `<details class="cmd">` rows in the authored HTML body (all rendered from data).
- [ ] All HTML-entity decoding for prompt bodies happened once at port time; `tasks[].command.planPrompt` strings contain literal `<`, `>`, `&` (no `&lt;`, `&gt;`, `&amp;`).
- [ ] Manual copy-paste check on first 3 + last 3 tasks (by `tasks[]` order): clipboard text from the rendered `<pre class="cmd-pre">` equals `tasks[].command.planPrompt` byte-for-byte.
- [ ] **Identical-render check**: (1) kanban column counts match pre-refactor (ready=N, soon=M, blocked=K); (2) command row count = 51; (3) every `#cmd-<id>` hash link jumps to a matching `<details>`; (4) `?tasks=<id1>,<id2>` URL filter shows exactly those tasks; (5) every kanban card retains its `.card-meta` block; (6) section counts (`#counts-cmds`, `#counts-kanban`) populate correctly.
- [ ] **Today-panel check**: after editing `plans/overview-data.js` to change one task's `phase` to `impl-in-progress`, a single page reload places the task in `#today-running` with no console errors (confirms `buildTodayPanel()` still classifies the rendered DOM correctly).
- [ ] Bookkeeper workflow: flipping a task's `phase` from `impl-in-progress` to `shipped` requires editing exactly one entry in `overview-data.js` and zero edits to `overview.html`.
- [ ] Typecheck passes.

**Dependencies:** US-002 (representative-port — render pipeline + DOM contracts established; schema corners validated).
**Estimated complexity:** large.

## Non-Goals (Out of Scope)

- Phase tree (US-004).
- Docs sweep (US-005a).
- SKILL.md (US-005b).
- Any schema extensions beyond US-001/US-002.
- Splitting render JS into a separate file (Plan #3).

## Design Considerations

- **Multiple kanban cards.** `perf-WS2` and `agent-comms` (in this story's 48) each render >1 card. `kanbanCards[]` must capture every card.
- **Conditional inline styles are not derivable in all cases.** Capture verbatim from existing HTML; do not algorithmically derive from `phase`/`status`.
- **Rich description content.** `descriptionHtml` is a trusted fragment that may contain inline `<code>` and `<a>` tags. Render assigns via `innerHTML` on the `.cmd-desc` container.
- **`data-*` attribute round-trip.** `renderTasks()` (from US-002) re-emits `data-task-id`, `data-task-scope`, `data-task-phase`, `data-task-status`, `data-plan-only`, `data-merge-commit`. The existing IIFEs read these post-render and must keep working.

## Technical Considerations

- **Parallel-merge file overlap (medium risk).** This job and `phase-tree-port` both edit `plans/overview.html` and `plans/overview-data.js`, but on disjoint line ranges. The skeleton-ownership invariant ensures merges resolve cleanly: `tasks[]` body is exclusively this job's; the `// ===== renderTasks() =====` marker block is exclusively this job's.
- **HTML-entity decoding.** Use a one-shot decode helper (`textarea.innerHTML = x; textarea.value` or DOMParser) when extracting prompts; re-emit via `textContent` so they round-trip without re-encoding.
- **URL param is `?tasks=`**, not `?id=` (Codex confirmed at `plans/overview.html:3206`); existing IIFE keeps working post-port.
- **Today-panel pipeline.** `buildTodayPanel()` at line 2984 walks `document.querySelectorAll('details.cmd')` and reads `data-task-id` + status precedence — must keep classifying the rendered DOM correctly.

## Success Metrics

- 51 total task entries in `tasks[]`; 0 duplicate ids.
- 0 authored `<div class="card">` and 0 `<details class="cmd">` in the HTML body.
- Pre/post refactor visual diff: identical kanban + command-row rendering.
- Bookkeeper workflow: one-file edit changes everything downstream (kanban placement, badge, Today panel).

## Open Questions

- During port, any task whose existing HTML carries non-derivable inline styles or unusual `data-*` combinations should have those captured verbatim as `cardClass` / `inlineStyle` / appropriate task fields. Log unusual cases in the commit message.
