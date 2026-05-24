# Stories Outline: Overview-Data Split

*Preliminary decomposition from `/plan-with-ralph`. Feed to `/implement-with-ralph --from-plan` for PRD generation.*

## US-001: Scaffold overview-data.js with full top-level skeleton
**Description:** As a bookkeeper, I want a `plans/overview-data.js` sidecar that holds the entire current inline JSON verbatim plus empty `tasks: []` and empty `phaseTree: []` arrays, so that downstream stories can append into a stable skeleton without contending for the top-level braces.
**Acceptance Criteria:**
- [ ] `plans/overview-data.js` exists. Top of file: schema comment block describing every field. Body: single `window.OVERVIEW_DATA = { ... };` assignment, no IIFE, no conditionals.
- [ ] Top-level fields include `generatedAt`, `generatedFromCommit`, `tasks: []`, `phaseTree: []`, `runs`, `periodic`, `cadence`, `lastTouched`, `effort`, `risk`, `workstream`, `sizeBucket`, `spawnedFrom` (NOT under a `meta:{}` wrapper).
- [ ] `runs`, `periodic`, `cadence`, `lastTouched`, `effort`, `risk`, `workstream`, `sizeBucket`, `spawnedFrom`, `generatedAt`, `generatedFromCommit` are character-for-character copies of the matching keys in the existing `<script type="application/json" id="roadmap-data">` block at `plans/overview.html` lines 2180–2612.
- [ ] `plans/overview.html` no longer contains the `<script type="application/json" id="roadmap-data">` block (lines 2180–2612, ~430 lines).
- [ ] `plans/overview.html` contains `<script src="overview-data.js"></script>` immediately before the main inline `<script>` block (at line 2614 pre-refactor).
- [ ] `getRoadmapData()` in `plans/overview.html` is rewired to return `window.OVERVIEW_DATA`.
- [ ] Opening the page on `file://` shows the freshness hint and SHA-in-header (which read `data.generatedFromCommit` / `data.generatedAt`) populated correctly.
- [ ] Page renders identically (all 49 task rows + kanban cards + phase tree still authored inline in HTML for now; this story only relocates JSON).
- [ ] **Skeleton-ownership invariant established.** `tasks: []` and `phaseTree: []` are present (empty arrays) inside the top-level `OVERVIEW_DATA = { ... }` object. The schema-comment block at the top of `plans/overview-data.js` explicitly states: "Each downstream story mutates only its own array body (US-002/US-003 append to `tasks[]`; US-004 appends to `phaseTree[]`). The top-level object skeleton — braces, key order, comma layout — must not be re-formatted by downstream stories. This isolation lets US-003 and US-004 run in parallel worktrees without merge conflicts on the object literal."
- [ ] Typecheck passes (no TS in this file, but root `pnpm` workspace must still install / build).
**Dependencies:** None
**Estimated complexity:** small

## US-002: Establish render pipeline + port 3 representative tasks + open-state preserve/restore
**Description:** As a bookkeeper, I want `renderTasks()` to data-drive 3 representative tasks (`perf-WS3` shipped+mergeCommit, `1b-multidev` multiple-kanban-cards, `polish-Fs` rich warnings) while the other 48 stay HTML-authored, so that the render pipeline + DOM contracts + `<details>` open-state preservation are validated before the bulk port.
**Acceptance Criteria:**
- [ ] Section markers `// ===== renderTasks() =====` and `// ===== renderPhaseTree() =====` exist near the top of the inline `<script>` block in `plans/overview.html` (US-004 will fill the phase-tree marker; this story emits an empty stub).
- [ ] `renderTasks()` runs synchronously at the top of the main inline `<script>` (line 2614+), BEFORE the first DOM-walking IIFE (`PHASE_TO_ORDER_BUCKET` / `renderPhaseBadges` / counts / filters).
- [ ] `tasks[]` contains exactly 3 entries (`perf-WS3`, `1b-multidev`, `polish-Fs`) with full `command`, `kanbanCards[]`, schema-correct fields.
- [ ] Schema: `kanbanCards[]` entries are `{column, cardClass: string|null, inlineStyle: string|null, html: string}`; rich `.card-meta` content round-trips verbatim.
- [ ] Render emits `<div class="card${card.cardClass ? ' ' + card.cardClass : ''}"${card.inlineStyle ? ' style="' + card.inlineStyle + '"' : ''} data-task-id="${task.id}">${card.html}</div>` for each kanban card.
- [ ] Render emits `<details class="cmd" id="cmd-${task.id}" data-task-id="${task.id}" data-task-scope="${task.scope}" data-task-phase="${task.phase}" data-task-status="${task.status}"${task.planOnly ? ' data-plan-only="true"' : ''}${task.mergeCommit ? ` data-merge-commit="${task.mergeCommit}"` : ''}>` for each command row.
- [ ] Prompt bodies in `<pre class="cmd-pre">` are written via `textContent` (or `document.createTextNode`), NEVER via `innerHTML` or template-string interpolation into an HTML fragment.
- [ ] The 3 data-rendered rows are visually pixel-identical to the (still-present) HTML rows; the 3 original HTML blocks are deleted by end of story.
- [ ] **Open-state preserve/restore**: `renderTasks()` snapshots `Array.from(document.querySelectorAll('details.cmd[open]')).map(el => el.id)` BEFORE the wipe, then re-applies `el.open = true` AFTER render. Verified test: expand 2 details, call `renderTasks()` from console, both remain open.
- [ ] **localStorage v2 persistence still works**: open 2 details, reload page on `file://`, the same 2 are open.
- [ ] Existing IIFEs (`renderPhaseBadges`, `injectTaskScopeChips`, counts, filters, URL banner, spawn injection, run history) continue to function against the freshly-emitted DOM for the 3 ported tasks.
- [ ] Typecheck passes.
**Dependencies:** US-001
**Estimated complexity:** large

## US-003: Port remaining 48 tasks; full data-driven render
**Description:** As a bookkeeper, I want all remaining 48 tasks ported into `tasks[]` and all original HTML kanban cards + command rows deleted, so that `renderTasks()` drives the entire kanban + command sections.
**Acceptance Criteria:**
- [ ] `tasks[]` contains exactly 49 entries total (the 3 from US-002 + 46 new); no two entries share the same `id` (deduplication check).
- [ ] **Skeleton-ownership invariant respected.** This story mutates ONLY the `tasks[]` array body — appending entries inside the existing `tasks: [` … `]` braces. It does NOT add or reorder other top-level fields, does not touch `phaseTree[]`, does not re-format the surrounding object literal. The diff against US-002's HEAD shows only `tasks[]`-internal additions, `plans/overview.html` deletions inside lines 1083–1425 / 1442–1914, and `renderTasks()` body completion. (Enables parallel execution with US-004.)
- [ ] `plans/overview.html` contains zero authored static `<div class="card">` elements in the document body (card markup may exist only inside JS string templates or DOM-construction code within the inline `<script>`).
- [ ] `plans/overview.html` contains zero `<details class="cmd">` rows in the authored HTML body (all rendered from data).
- [ ] All HTML-entity decoding for prompt bodies happened once at port time; `tasks[].command.planPrompt` strings contain literal `<`, `>`, `&` (no `&lt;`, `&gt;`, `&amp;`).
- [ ] Manual copy-paste check on first 3 + last 3 tasks (by `tasks[]` order): clipboard text from the rendered `<pre class="cmd-pre">` equals `tasks[].command.planPrompt` byte-for-byte.
- [ ] **Identical-render check**: (1) kanban column counts match pre-refactor (ready=N, soon=M, blocked=K); (2) command row count = 49; (3) every `#cmd-<id>` hash link jumps to a matching `<details>`; (4) `?tasks=<id1>,<id2>` URL filter shows exactly those tasks; (5) every kanban card retains its `.card-meta` block; (6) section counts (`#counts-cmds`, `#counts-kanban`) populate correctly.
- [ ] **Today-panel check**: after editing `plans/overview-data.js` to change one task's `phase` to `impl-in-progress`, a single page reload places the task in `#today-running` with no console errors (confirms `buildTodayPanel()` still classifies the rendered DOM correctly).
- [ ] Bookkeeper workflow: flipping a task's `phase` from `impl-in-progress` to `shipped` requires editing exactly one entry in `overview-data.js` and zero edits to `overview.html`.
- [ ] Typecheck passes.
**Dependencies:** US-002
**Estimated complexity:** large

## US-004: Port phase tree into phaseTree[] with rich node schema
**Description:** As a bookkeeper, I want `OVERVIEW_DATA.phaseTree` to hold the entire phase tree (including non-task structural bullets like `1b.1` and `4a-4m`) and `renderPhaseTree()` to data-drive `#phase-tree`, so that the section becomes maintainable from one file.
**Acceptance Criteria:**
- [ ] `phaseTree[]` is populated. Each phase node carries `{id, title, headerHtml?, collapsible?, collapsibleSummary?, nodes: [{kind: 'task-ref'|'raw', taskId?, state?: 'open'|'deferred'|'donefade'|'closed', html?, trailingHtml?}, ...], subPhases: recursive}`.
- [ ] **Skeleton-ownership invariant respected.** This story mutates ONLY the `phaseTree[]` array body US-001 stubbed. It does NOT touch `tasks[]`, does not add or reorder other top-level fields, does not re-format the surrounding object literal. `renderPhaseTree()` body lives inside the `// ===== renderPhaseTree() =====` section marker US-002 emitted; the `// ===== renderTasks() =====` marker is not touched. (Enables parallel execution with US-003.)
- [ ] `task-ref` nodes carry `taskId` (must match an entry in `tasks[]`) plus optional `state` (`open|deferred|donefade|closed`) for the `.item-name` class.
- [ ] `raw` nodes carry trusted inner HTML for structural bullets that have no task id (e.g. `1b.1`, `4a-4m`).
- [ ] `renderPhaseTree()` fills the `#phase-tree` container, emitting `.phase-grid`, `.phase`, `.phase-head`, `.item-name` with state classes, and nested `<details class="phase-subdetails">` collapsibles to match the pre-refactor HTML.
- [ ] `plans/overview.html` no longer contains the authored phase tree section at lines 1920–2009.
- [ ] Page on `file://` renders the phase tree identically (same headers, same bullets, same state classes, same collapsibles).
- [ ] Drift handling: any `task-ref` whose `taskId` is not present in `tasks[]` is dropped at port time (logged in the commit message), not carried as a dead reference.
- [ ] Section markers maintained: `renderPhaseTree()` fills the `// ===== renderPhaseTree() =====` block US-002 stubbed.
- [ ] Typecheck passes.
**Dependencies:** US-002
**Estimated complexity:** medium

## US-005a: Docs sweep (stale-reference fixes outside SKILL.md)
**Description:** As an autonomous bookkeeper agent, I want every standing doc outside the SKILL to stop telling agents to edit `plans/overview.html` for task state and to start pointing at `plans/overview-data.js`, so that the source-of-truth shift is consistent across all human- and agent-facing references — independent of when the SKILL rewrite (US-005b) finalizes. This story is schema-shape-independent: it does NOT depend on `tasks[]` or `phaseTree[]` final content because all edits are at the file-path / parameter-name level.
**Acceptance Criteria:**
- [ ] `plans/codexu-roadmap.md` Companion-snapshot callout (lines 5–9) and Task-phase-model standing rule (line 175) reference `plans/overview-data.js`.
- [ ] `plans/parallel-assignments.md` top adds a "data file is source of truth" note; bottom status table remains as a derived view.
- [ ] `plans/parallel-assignments.md` lines 225, 235, 242, 247 — stale "bump lastRanAt timestamp in plans/overview.html's roadmap-data JSON" and "Add new task entries to plans/parallel-assignments.md and plans/overview.html roadmap-data JSON" phrasings — re-pointed to `plans/overview-data.js`.
- [ ] `plans/agent-view-research.md` and `plans/codex-agent-parity-audit.md` line 1358 — references to editing `overview.html` for task state re-pointed.
- [ ] `plans/overview-vite-react.md` lines 66 and 147 — stale `?id=foo,bar` URL-filter references updated to `?tasks=` (matching `parseTaskIdFilter()` at `plans/overview.html` line 3206). `plans/overview-vite-react.md` also adds a note that `<KanbanCard>` and `<PhaseTreeNode>` raw branches consume `kanbanCards[].html` and `phaseTree` `raw` nodes via `dangerouslySetInnerHTML` (trusted-HTML escape hatch documented in this plan's Risk Area #9).
- [ ] The `roadmap-plugin` prompt body (locate via `git grep roadmap-plugin plans/`) is updated to describe the data-file edit model, not HTML edits.
- [ ] **Broad grep AC**: each of the following, run against `.agents/ plans/ packages/` with `plans/overview.html` excluded, returns zero hits: `edit plans/overview.html`, `roadmap-data`, `lastRanAt timestamp`. The phrase `generatedFromCommit` is allowed only inside `plans/overview-data.js`.
- [ ] **Narrow grep AC**: `git grep -n "edit plans/overview.html" -- :!plans/overview.html .agents/ plans/ packages/` returns zero hits.
- [ ] Does NOT touch `.agents/skills/roadmap-and-overview/SKILL.md` (that's US-005b's territory; running this story before SKILL is finalized must be safe).
- [ ] Typecheck passes.
**Dependencies:** US-002 (representative-port — establishes the data file exists; this story's edits don't depend on its content)
**Estimated complexity:** small

## US-005b: Rewrite SKILL.md procedures around final schema
**Description:** As an autonomous bookkeeper agent, I want `.agents/skills/roadmap-and-overview/SKILL.md` rewritten with procedures A–G describing data-file edits (single JS entry append/edit) AND with a working example task entry that references the finalized `kanbanCards[]` / `phaseTree` schema and the `lastTouched` dual-update invariant, so that future bookkeepers have a copy-paste template that matches the actual data file.
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
**Dependencies:** US-003 AND US-004 (SKILL examples must match the finalized data-file schema)
**Estimated complexity:** medium
