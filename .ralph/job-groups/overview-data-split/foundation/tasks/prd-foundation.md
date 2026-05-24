# PRD: foundation (overview-data-split)

## Introduction / Overview

Scaffold a new `plans/overview-data.js` sidecar file that becomes the single source of truth for the overview viewer's data, and switch `plans/overview.html` to consume it via a `<script src>` tag. This is Phase 1 of the `overview-data-split` group: it establishes the top-level `window.OVERVIEW_DATA` skeleton and relocates all existing map metadata verbatim, without yet porting any tasks or phase-tree nodes. Downstream jobs (`representative-port`, `full-task-port`, `phase-tree-port`) will append into the empty `tasks: []` and `phaseTree: []` arrays this story creates.

## Goals

1. Create `plans/overview-data.js` with a single top-level `window.OVERVIEW_DATA = { ... };` assignment containing the full skeleton.
2. Move every map from the existing inline `<script type="application/json" id="roadmap-data">` block (`plans/overview.html` lines 2180-2612) verbatim into `OVERVIEW_DATA`.
3. Delete the inline `<script type="application/json" id="roadmap-data">` block from `plans/overview.html`.
4. Add `<script src="overview-data.js"></script>` immediately before the main inline `<script>` so the data loads first.
5. Rewire `getRoadmapData()` in `plans/overview.html` to return `window.OVERVIEW_DATA`.
6. Preserve identical visual rendering: the page on `file://` looks the same as before this change.
7. Establish the skeleton-ownership invariant (documented in the file's top comment) so future stories can mutate only their own array body without merge conflicts.

## User Stories

### US-001: Scaffold overview-data.js with full top-level skeleton

As a bookkeeper, I want a `plans/overview-data.js` sidecar that holds the entire current inline JSON verbatim plus empty `tasks: []` and empty `phaseTree: []` arrays, so that downstream stories can append into a stable skeleton without contending for the top-level braces.

**Acceptance Criteria:**
- [ ] `plans/overview-data.js` exists. Top of file: schema comment block describing every field. Body: single `window.OVERVIEW_DATA = { ... };` assignment, no IIFE, no conditionals.
- [ ] Top-level fields include `generatedAt`, `generatedFromCommit`, `tasks: []`, `phaseTree: []`, `runs`, `periodic`, `cadence`, `lastTouched`, `effort`, `risk`, `workstream`, `sizeBucket`, `spawnedFrom` (NOT under a `meta:{}` wrapper).
- [ ] `runs`, `periodic`, `cadence`, `lastTouched`, `effort`, `risk`, `workstream`, `sizeBucket`, `spawnedFrom`, `generatedAt`, `generatedFromCommit` are character-for-character copies of the matching keys in the existing `<script type="application/json" id="roadmap-data">` block at `plans/overview.html` lines 2180-2612.
- [ ] `plans/overview.html` no longer contains the `<script type="application/json" id="roadmap-data">` block (lines 2180-2612, ~430 lines).
- [ ] `plans/overview.html` contains `<script src="overview-data.js"></script>` immediately before the main inline `<script>` block (at line 2614 pre-refactor).
- [ ] `getRoadmapData()` in `plans/overview.html` is rewired to return `window.OVERVIEW_DATA`.
- [ ] Opening the page on `file://` shows the freshness hint and SHA-in-header (which read `data.generatedFromCommit` / `data.generatedAt`) populated correctly.
- [ ] Page renders identically (all 51 task rows + kanban cards + phase tree still authored inline in HTML for now; this story only relocates JSON).
- [ ] Skeleton-ownership invariant established: `tasks: []` and `phaseTree: []` are present (empty arrays) inside the top-level `OVERVIEW_DATA = { ... }` object. The schema-comment block at the top of `plans/overview-data.js` explicitly states: "Each downstream story mutates only its own array body (US-002/US-003 append to `tasks[]`; US-004 appends to `phaseTree[]`). The top-level object skeleton — braces, key order, comma layout — must not be re-formatted by downstream stories. This isolation lets US-003 and US-004 run in parallel worktrees without merge conflicts on the object literal."
- [ ] Typecheck passes (no TS in this file, but root `pnpm` workspace must still install / build).

**Dependencies:** None.
**Estimated complexity:** small.

## Non-Goals (Out of Scope)

- Porting any tasks into `tasks[]` (US-002 / US-003 do that in later phases).
- Porting any phase-tree nodes into `phaseTree[]` (US-004).
- Adding `renderTasks()` or `renderPhaseTree()` (US-002 establishes the render pipeline).
- Deleting kanban cards, `<details class="cmd">` rows, or the phase tree section from HTML (later phases).
- Updating any docs or SKILL.md (US-005a / US-005b).

## Design Considerations

- The top-of-file schema comment must describe every field shape AND the skeleton-ownership invariant, so future agents working on US-002/US-003/US-004 land in a worktree with clear guard-rails.
- Single-quoted JS string literals where possible (avoid template literals — backticks collide with markdown backticks in prompts that future stories will add).
- The file is operator/agent-authored; trust is by convention. No runtime validation needed in this story.

## Technical Considerations

- `plans/overview.html` is rendered from `file://`; Chromium blocks `fetch` on local origins, hence `.js` (not `.json`).
- `generatedAt` and `generatedFromCommit` must stay at the top level — the freshness-hint IIFE at `plans/overview.html:3540` reads `data.generatedFromCommit` and `:3543` reads `data.generatedAt` directly.
- The `<script src="overview-data.js">` tag must come BEFORE the main inline `<script>` so `window.OVERVIEW_DATA` is defined when `getRoadmapData()` runs.
- Existing consumers (the freshness hint, SHA-in-header, `getRoadmapData()`) must keep working without any logic changes beyond the rewire.

## Success Metrics

- Page on `file://` renders identically to pre-refactor (manual visual diff).
- `#gen-sha` and `#freshness-hint` show the same values as before.
- `git diff` shows `plans/overview-data.js` added with all maps verbatim and `plans/overview.html` reduced by ~430 lines of inline JSON plus one `<script src>` line added and `getRoadmapData()` rewired.

## Open Questions

None for this story. Downstream coordination questions (multiple kanban cards per task, phase-tree node schema, etc.) are resolved in later phases.
