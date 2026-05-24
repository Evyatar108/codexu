# Implementation Plan: foundation (overview-data-split / Phase 1)

*Job-scoped slice of `.ralph/job-groups/overview-data-split/plan.md`. Covers US-001 only.*

## Overview

Scaffold `plans/overview-data.js` with the full top-level skeleton of `window.OVERVIEW_DATA`, move every map from the existing inline `<script type="application/json" id="roadmap-data">` block (lines 2180-2612 of `plans/overview.html`) verbatim, delete that inline-JSON block from HTML, and add a `<script src="overview-data.js">` tag immediately before the main inline `<script>`. Rewire `getRoadmapData()` to return `window.OVERVIEW_DATA`. After this story the page must render identically — tasks and phase tree still live in HTML for now.

This story establishes the **skeleton-ownership invariant** that lets US-003 (`full-task-port`) and US-004 (`phase-tree-port`) run in parallel worktrees later: each downstream story mutates only its own array body (`tasks[]` or `phaseTree[]`) without re-formatting the surrounding object literal.

## Technical Constraints

1. **`file://` compatibility forces `.js`** (not `.json`) because Chromium blocks `fetch` on local-file origins. A `<script src="overview-data.js">` works without CORS.
2. **No `meta:{}` wrapper.** `generatedAt` and `generatedFromCommit` stay at the top level because existing consumers in `plans/overview.html` already read them at top level: the freshness-hint IIFE at line 3540 reads `data.generatedFromCommit` and line 3543 reads `data.generatedAt`.
3. **Single top-level assignment, no IIFE, no conditionals** — Vite HMR friendliness for Plan #3 (`plans/overview-vite-react.md` lines 74-88).
4. **Move every map verbatim** — including `effort`, `risk`, `workstream`, `sizeBucket`, `spawnedFrom`, not just `runs/periodic/cadence/lastTouched`.

## Data Schema (top-level skeleton owned by this story)

```js
// plans/overview-data.js
window.OVERVIEW_DATA = {
  generatedAt: "<ISO8601>",        // verbatim from inline JSON
  generatedFromCommit: "<sha>",    // verbatim from inline JSON
  tasks: [],                       // EMPTY — US-002/US-003 append entries here
  phaseTree: [],                   // EMPTY — US-004 appends nodes here
  runs:        { /* verbatim */ },
  periodic:    { /* verbatim */ },
  cadence:     { /* verbatim */ },
  lastTouched: { /* verbatim */ },
  effort:      { /* verbatim */ },
  risk:        { /* verbatim */ },
  workstream:  { /* verbatim */ },
  sizeBucket:  { /* verbatim */ },
  spawnedFrom: { /* verbatim */ }
};
```

## Files to Create / Modify

**Create:**
- `plans/overview-data.js` — top-of-file schema comment block describing every field and the skeleton-ownership invariant, plus the `window.OVERVIEW_DATA = { ... };` assignment with all maps moved verbatim and empty `tasks: []` / `phaseTree: []` arrays.

**Modify:**
- `plans/overview.html`:
  - DELETE: `<script type="application/json" id="roadmap-data">` block (lines 2180-2612, ~430 lines).
  - ADD: `<script src="overview-data.js"></script>` immediately before the main inline `<script>` (at line 2614 pre-refactor).
  - REWIRE: `getRoadmapData()` (currently at lines 3530-3533) to return `window.OVERVIEW_DATA`.
  - PRESERVE: everything else verbatim (all kanban cards, command rows, phase tree, CSS, IIFEs).

**Read as reference:**
- `plans/overview.html` lines 2180-2612 (inline JSON to relocate), 3530-3533 (`getRoadmapData()`), 3540-3543 (freshness-hint consumers).

## Acceptance Criteria

- [ ] `plans/overview-data.js` exists. Top: schema comment block describing every field. Body: single `window.OVERVIEW_DATA = { ... };` assignment, no IIFE, no conditionals.
- [ ] Top-level fields include `generatedAt`, `generatedFromCommit`, `tasks: []`, `phaseTree: []`, `runs`, `periodic`, `cadence`, `lastTouched`, `effort`, `risk`, `workstream`, `sizeBucket`, `spawnedFrom` (NOT under a `meta:{}` wrapper).
- [ ] `runs`, `periodic`, `cadence`, `lastTouched`, `effort`, `risk`, `workstream`, `sizeBucket`, `spawnedFrom`, `generatedAt`, `generatedFromCommit` are character-for-character copies of the matching keys in `plans/overview.html` lines 2180-2612.
- [ ] `plans/overview.html` no longer contains the `<script type="application/json" id="roadmap-data">` block.
- [ ] `plans/overview.html` contains `<script src="overview-data.js"></script>` immediately before the main inline `<script>`.
- [ ] `getRoadmapData()` in `plans/overview.html` returns `window.OVERVIEW_DATA`.
- [ ] Opening the page on `file://` shows the freshness hint (`#freshness-hint`) and SHA-in-header (`#gen-sha`) populated correctly.
- [ ] Page renders identically (all 49 task rows + kanban cards + phase tree still authored inline in HTML; this story only relocates JSON).
- [ ] Skeleton-ownership invariant comment is present at the top of `plans/overview-data.js`: "Each downstream story mutates only its own array body (US-002/US-003 append to `tasks[]`; US-004 appends to `phaseTree[]`). The top-level object skeleton — braces, key order, comma layout — must not be re-formatted by downstream stories."
- [ ] Typecheck passes (root `pnpm` workspace installs/builds).

## Out of Scope

- Any `tasks[]` entries (US-002 ports 3 representatives; US-003 ports the rest).
- Any `phaseTree[]` entries (US-004).
- `renderTasks()` or `renderPhaseTree()` functions (US-002 adds the pipeline).
- HTML deletions beyond the inline-JSON block (kanban / command rows / phase tree HTML stays for now).
- Docs sweep or SKILL.md rewrites (US-005a/US-005b).
