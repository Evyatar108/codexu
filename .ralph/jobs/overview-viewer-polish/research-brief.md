# Research Brief: overview-viewer polish + IA restructuring

*Compiled from 4 parallel research outputs on 2026-05-18.*

## Researcher Findings (codebase scan)

### Current component inventory under `tools/overview-viewer/src/components/`

| File | Responsibility |
|------|---|
| `TaskCommand.tsx` | Individual command/task row with status badge, scope chips, copy button, checkbox, warning blocks, cadence info, run history. Exports: `StatusBadge`, `ScopeChip`, `BulkSelectCheckbox`, `CopyNameButton`, `CopyCommandButton` |
| `CommandList.tsx` | Renders flat list of task `<details>` rows; applies `sortTasksByLastTouchedAsc` within phase buckets; handles visibility filtering + bulk selection |
| `Kanban.tsx` | Three-column kanban (ready/soon/blocked) with cards from `data.kanbanCards`; click-to-jump-to-command |
| `PhaseTree.tsx` | Nested phase/sub-phase sections; applies `deferred` class for blocked/paused task refs (deviation #1) |
| `TodayPanel.tsx` | Always-visible summary of running tasks + recently shipped (7d) + upcoming due-soon items |
| `Toolbar.tsx` | Sticky top bar: search input, filter details popup, bulk-copy button, kbd-hint. Exports: `SearchInput`, `FilterChips`, `BulkCopyButton`, `Toolbar` |
| `StaticSections.tsx` | Collapsible sections for Parallelism, Dependencies, Footnote |
| `TopLevelSurfaces.tsx` | Wrapper components: `Layout`, `FreshnessHint`, `KeyboardHelp`, `UrlFilterBanner`, `WhatsNewBanner`, `Legend` |
| `RunsLog.tsx` | Per-task run-history mini-list (`.run-entry` grid: date, sha, outcome, summary) |

### Hook inventory under `src/hooks/`

| File | Provides |
|------|---|
| `usePersistentExpanded.ts` | `expanded` state synced to localStorage (`codexu-overview-details-state-v2`). Returns `{ expanded, isExpanded(id), setTaskExpanded(id, open), setAllExpanded(ids[], open) }` |
| `useBulkSelection.ts` | Multi-select checkbox state. Returns `{ selectedTaskIds: Set, toggleTask, copyText, clearSelection }` |
| `useHashNav.ts` | Watches `window.location.hash` for `#cmd-<id>`; expands matching task + `scrollIntoView`. Uses `block: 'start'`, no flash class. |
| `useKeyboardShortcuts.ts` | Global keys: `/` focus search, `?` help, `e` expand-all, `c` collapse-all |
| `useMultiAxisFilter.ts` | Status/workstream/size/cadence/scope filters. Returns `{ activeFilters, visibleTaskIds, visibleKanbanTaskIds, query, setQuery, toggleFilter }` |
| `useTaskClassification.ts` | Returns `{ filterBucket, orderBucket }` from `task.phase`/`task.status` |
| `useUrlFilter.ts` | Parses `?tasks=id1,id2,id3` query string |
| `useWhatsNewSinceLastVisit.ts` | localStorage key `codexu-overview-last-visit-v1`. Returns `{ changedTasks, lastVisit, changedTaskIds, markAllSeen }` |

### CSS architecture (`src/styles.css`, ~1060 lines)

| Section | Lines | Purpose |
|---|---|---|
| Variables (dark/light) | 1–32 | `--bg`, `--fg`, `--muted`, `--border`, `--card`, `--accent`, `--ok/warn/bad/info/done/purple` |
| Base reset | 33–52 | `*`, `body`, headings, `code`, `.sub`, links |
| Kanban grid | 53–77 | `.kanban`, `.col`, `.col-head`, `.badge` |
| Kanban cards | 78–105 | `.card`, pill colors |
| Phase tree | 121–185 | `.legend`, `.phase-grid`, `.phase`, `.open`, `.deferred`, `.donefade`, `.closed` |
| Today panel | 127–156 | `.today-panel`, `.today-chips`, `.today-footer` |
| Sticky toolbar | 263–335 | `.toolbar`, `.toolbar-filters`, `.filter-popover` |
| Workstream pill | 336–352 | `.pill-workstream` |
| Spawn/cadence pills | 354–413 | `.pill-spawned-from`, `.spawned-children`, `.cadence-chip` |
| Run history | 415–451 | `.run-history`, `.run-entry`, outcome colors |
| Search match (unused!) | 572 | `.search-match { amber bg + radius }` — already styled, no JS emits `<mark>` |
| Keyboard help modal | 584–619 | `.kbd-help { fixed, z-index:100 }`, `.kbd-backdrop`, `.kbd` |
| E-ink / coarse-pointer | 667–700 | `@media (max-width: 900px), (pointer: coarse)` overrides |
| Section spine | 702–772 | `.section.sec-*` colored left stripe |
| Command rows | 773–982 | `.cmd-list`, `.cmd`, `.cmd > summary`, `.cmd-name`, `.cmd-badge`, `.cmd-status-mod`, `.cmd-actions` |
| CSS `order` rules | 837–852 | `.cmd[data-cmd-status="ready"] { order: 8 }` etc — global, drives bucket separation today |

### Existing localStorage keys

- `codexu-overview-details-state-v2` — expanded task state
- `codexu-overview-last-visit-v1` — what's-new banner

**Pattern:** `codexu-overview-<feature>-v<N>` where `<N>` increments on breaking changes.

### vite.config.ts customizations

`overviewDataPlugin` (custom Vite plugin, enforce: 'pre'):
- `buildStart()` — safe-name flag caches existing `plans/overview.html`
- `configureServer(server)` — dev middleware at `/overview-data.js`; watcher on `plans/overview-data.js`; emits custom WS event `overview-data:update`
- `transformIndexHtml(html, ctx)` — build-time: escapes `</script` then inlines sidecar
- `closeBundle()` — safe-name flag swaps to `.next`

Output config: root `tools/overview-viewer/`, base `./`, entry `overview.html`, output `plans/overview.html` via `vite-plugin-singlefile`, dev server `--host 127.0.0.1 --port 5173`, fs.allow includes `../../plans`.

### Existing dependencies

`tools/overview-viewer/package.json`:
- runtime: `@vitejs/plugin-react ^6.0.1`, `react 19.2.0`, `react-dom 19.2.0`, `vite ^8.0.9`, `vite-plugin-singlefile ^2.3.0`
- dev: `@types/node >=20`, `@types/react ^19.2.7`, `@types/react-dom ^19.2.3`, `typescript ^5.9.3`, `vitest ^4.1.5`

Root scripts: `overview`, `overview:build`, `overview:build:preview` (uses `cross-env` for `OVERVIEW_BUILD_SAFE_NAME=1`).

### Test inventory under `src/__tests__/`

vitest config: `environment: 'node'`, include `src/__tests__/**/*.test.{ts,tsx}`. Tests run via `react-dom/server` SSR.

| File | Coverage |
|---|---|
| `persistentExpanded.test.ts` | `readExpandedState`/`writeExpandedState` with MemoryStorage mock |
| `urlFilter.test.ts` | `useUrlFilter` query-string parsing |
| `commandSort.test.ts` | `sortTasksByLastTouchedAsc` stable sort |
| `commandList.test.tsx` | CommandList render + filtering |
| `kanban.test.tsx` | Kanban three-column layout |
| `kanbanInteraction.test.ts` | Card click-to-jump |
| `kanbanOrdering.test.ts` | Card ordering within columns |
| `copyPreamble.test.ts` | Task scope → preamble injection |
| `phaseTreeDerivation.test.tsx` | Phase tree `deferred` class derivation |
| `searchHaystack.test.ts` | Search filter haystack |
| `topLevelSurfaces.test.tsx` | WhatsNewBanner, FreshnessHint, KeyboardHelp render |
| `testData.ts` | Shared mock `OverviewData` |
| `__snapshots__/` | Golden HTML snapshots (vitest auto-generated) |

**Patterns:** MemoryStorage mock for localStorage; snapshot testing for SSR HTML; no `window.location` or `import.meta.hot` mocking.

### Naming conventions

- Components: PascalCase (`TaskCommand.tsx`)
- Hooks: `use<Name>.ts` (`usePersistentExpanded.ts`)
- Utils: camelCase (`copyCommand.ts`)
- Tests: `<target>.test.{ts,tsx}` in `__tests__/`
- CSS: single monolithic `styles.css`
- Types: centralized in `src/types.ts`

---

## Architect Analysis

### Integration points per phase

**Phase A — pure CSS / JS, no deps, ~1 KB**
- A1 (smooth `<details>` expand): `styles.css:773-981` + wrap each task body in `<div class="cmd-body">`; use `interpolate-size: allow-keywords` + `grid-template-rows: 0fr→1fr`. Safari <17.4 / FF <129 fallback: explicit `max-height`.
- A2 (search highlighting): `styles.css:572` (`.search-match` already exists!) + `utils/filters.ts:42-65` + `TaskCommand.tsx:289` — emit `<mark class="search-match">`; skip inside `<code>`.
- A3 (smooth-scroll + flash-pulse): extend `useHashNav.ts` with `scrollIntoView({ behavior: 'smooth', block: 'center' })` + `.cmd-flash` 1.5s keyframe.
- A4 (sticky-toolbar elevation): `styles.css:264-277` + `animation-timeline: scroll()` — fade shadow + `backdrop-filter: blur` only past 24px scroll.
- A5 (bucket-count chips): populate existing `.section-counts` spans in Kanban + Commands summaries.
- A6 (global reduced-motion guard): single `@media (prefers-reduced-motion: reduce) { animation: none !important; transition: none !important; }` at top of styles.css.

**Phase B — small renderer additions, no deps**
- B1 (copy-success toast): bug fix — `writeClipboard` returns a boolean that's discarded; `.copy-btn.copied` CSS exists but is never applied. Apply `.copied` for 1.2s + render bottom-right `<div role="status">` toast. New `src/components/CopyToast.tsx`, integrate in `TaskCommand.tsx:105-120`.
- B2 (quick-actions strip): extend `.cmd-actions` (`TaskCommand.tsx:293-296` + `styles.css:939-971`) with `Copy markdown link`, `Copy ID + status`, `↑ parent` (only if `spawnedFrom[id]`), `↓ N children`, `Jump to kanban card`. Icon-only buttons; conditional render.
- B3 (density toggle): `Toolbar.tsx:38-97` + new localStorage key `codexu-overview-density-v1`. Toggle `body.compact` class.

**Phase C — Radix UI primitives**
- C1 (Tooltip on WorkstreamPill): `@radix-ui/react-tooltip` (~3 KB gz) — `TaskCommand.tsx:170-203` + style via `[data-state="open"]`.
- C2 (Dialog for KeyboardHelp): `@radix-ui/react-dialog` (~6 KB gz) — `TopLevelSurfaces.tsx:45-62` + existing `.kbd-help` CSS at `styles.css:584-618`. Note z-index conflict: existing `.kbd-help` has z-index: 100; Radix portal must match.
- C3 (Popover + ToggleGroup for FilterChips): `@radix-ui/react-popover` + `@radix-ui/react-toggle-group` (~6-8 KB gz) — `Toolbar.tsx:58-77` + `styles.css:280-335`. Gains outside-click dismiss + roving Tab/Shift-Tab focus.
- C4 (Checkbox): `@radix-ui/react-checkbox` (~3 KB gz) — `TaskCommand.tsx:72-85`. Enables `data-state="indeterminate"` for bucket-wide select-all.
- C5 (broader Tooltip): systematically replace `title=` attrs on cadenceChip, StatusBadge, ScopeChip, SpawnedFromPill, pill-*.

**Phase D — IA restructuring**
- D1 (bucket headers): `CommandList.tsx:37-81` — group tasks by `orderBucket`, emit `<details class="cmd-bucket">` per bucket with summary `(count · n blocked · oldest lastTouchedAt)`. Sort tasks within each bucket via `sortTasksByLastTouchedAsc`. **CSS migration**: drop global `.cmd[data-cmd-status]` order rules at `styles.css:837-852`; re-add blocked-tail rule scoped under `.cmd-bucket > .cmd[data-task-status="blocked|paused"]`.
- D2 (sticky frame + metrics + ToC): new `src/components/StickyFrame.tsx`, mounted above `<main>` in `App.tsx:85-126`. Metrics derived from `filterBucketForTask` + `recentRuns` (extract from `TodayPanel.tsx:22-27`). ToC anchor buttons scroll-to + expand matching `<details>`.
- D3 (persist bucket expand-state): extend `usePersistentExpanded.ts:30-32` with `setBucketExpanded`/`isBucketExpanded`. Bucket ID format: `cmd-bucket-<phase>`. Same localStorage key (`codexu-overview-details-state-v2`).

**Phase E — left rail**
- E1 (LeftRail component): new `src/components/LeftRail.tsx`. Layout: `<div class="main-layout"><LeftRail /><main>...</main></div>`. Rail is `position: sticky; top: 60px` (below sticky-frame). Contents: Today / What's-New / Recently shipped (7d) / Periodic due-soon / Legend.
- E2 (factor utilities): extract `buildTodayBuckets`, `recentRuns`, `TodayChips` from `TodayPanel.tsx:38-71`. Move `Legend` out of `TopLevelSurfaces.tsx:65-80` into rail.
- E3 (responsive collapse < 900px): `styles.css:670` existing media query. Add: `.left-rail { position: fixed; left: -220px; transition: left 0.3s; } .left-rail.open { left: 0; }`. Hamburger button in StickyFrame.

### Dependency graph

```
Phase A (parallel-OK across A1..A6)
  └─ all isolated CSS or single-file JS changes

Phase B (parallel-OK across B1..B3)
  └─ writeClipboard boolean + spawnedFrom + childrenByParent (all exist)

Phase C (SEQUENTIAL — C1 gates the rest)
  ├─ C1 (Tooltip on WorkstreamPill) — VALIDATES CSS interleaving with [data-state] selectors
  ├─ C2 (Dialog for KeyboardHelp) — depends C1 validation, validates portal behavior under file://
  ├─ C3 (Popover + ToggleGroup) — depends C2
  ├─ C4 (Checkbox) — orthogonal, can land after C1
  └─ C5 (broader Tooltip adoption) — depends C1

Phase D (SEQUENTIAL — D1 → D2 → D3)
  ├─ D1 (bucket headers) — must preserve 3 deviations; deep-link useHashNav must expand parent bucket
  ├─ D2 (sticky frame + metrics + ToC) — depends D1 (counts use bucket grouping; ToC anchors reference bucket IDs)
  └─ D3 (persist bucket state) — depends D1 (bucket DOM exists)

Phase E (depends D complete)
  ├─ E1 (LeftRail component)
  ├─ E2 (extract TodayPanel/Legend logic)
  ├─ E3 (responsive collapse < 900px)
  └─ E4 (no-workstream edge case)

Post-each-story:
  └─ pnpm overview:build — rebuilds plans/overview.html (artifact ~447 KB, will grow ~50 KB by end)
```

### Critical risks

| Phase | Risk | Mitigation |
|---|---|---|
| A | `interpolate-size` not supported on Safari < 17.4 / FF < 129 | Explicit `max-height` fallback works; animation still degrades to less smooth |
| A | `animation-timeline: scroll()` ignored on older Safari / FF | Toolbar keeps static shadow (acceptable) |
| C | Radix bundle delta target < 50 KB gz | **Gate after C1**: measure artifact size; halt C2-C5 if > 500 KB total |
| C | Radix portal behavior under file:// | Validate Dialog open/close in `pnpm overview:build` artifact after C2 |
| C | z-index conflicts (existing `.kbd-help` z-index: 100) | Set Radix portal z-index >= 100; verify by inspection after C2 |
| D | Bucket DOM restructure breaks `#cmd-foo` deep-links | Implement walk-up logic in `useHashNav.ts`: expand `.cmd-bucket` parent before task |
| D | CSS global `order` rules become inert / blocked-tail rule needs re-scoping | Drop global rules, add scoped `.cmd-bucket > .cmd[data-task-status]` rule |
| D | Breaking persistent expand-state (task-level) | Task IDs unchanged (`cmd-US-001`); only bucket-level keys are new |
| E | Responsive `< 900px` collapse breaks mobile UX | Validate on mobile or emulator after E3 |
| E | Legend out of Kanban loses contextual cohesion | Optional revert if operator complaint |
| Cross | Static artifact regen creates ~447 KB diff per build | **Recommendation: batch builds by phase** (5 commits for A/B/C/D/E instead of 18+) |
| Cross | Test coverage gap for D1 bucket grouping | Add 3-5 unit tests before landing D1 |

### Suggested commit batching

1. Batch A (6 stories) → 1 commit + 1 build
2. Batch B (3 stories) → 1 commit + 1 build
3. Phase C **one story at a time** (C1 gates C2-C5) → 5 commits + 5 builds (gate on bundle size)
4. Phase D sequential D1 → D2 → D3 → 3 commits + 3 builds
5. Phase E E1 → E2 → E3 → 3 commits + 3 builds
6. Docs sweep (US-018) → final commit

**Total: ~14-15 commits** including builds.

---

## Codex Research

**Codebase architecture (independent confirmation):**
- pnpm workspace `tools/overview-viewer` registered in both `pnpm-workspace.yaml` + root `package.json`
- React 19.2, TypeScript strict, Vite 8, `@vitejs/plugin-react`, `vite-plugin-singlefile`, Vitest in `node` mode
- Build entry `tools/overview-viewer/overview.html` (NOT `index.html`)
- `plans/overview-data.js` hand-edited; `plans/overview.html` generated only (current size 447,483 bytes)
- HMR option (c): fetch + re-execute via `import.meta.hot.on('overview-data:update')` + `new Function(text)()` in `App.tsx` lines 41-55

**Codex key callouts:**
- The `useHashNav` hook + `utils/commandNavigation.ts` already exist for `#cmd-*` expansion + smooth scroll, but currently use `block: 'start'` and no flash class — both are precise targets for Phase A3.
- `utils/filters.ts` already has `getTaskSearchHaystack` (recently widened for F-011) — Phase A2 (search highlighting) only needs to add a separate `highlightMatches(text, query)` util; haystack widening is already done.
- `.search-match` CSS at line 572 confirmed present-but-unused.
- Static sections in `App.tsx`: existing IDs `#kanban-ready`, `#cmd-list`, `#roadmap`, `#parallelism`, `#deps` (or similar) — verify exact IDs before wiring ToC anchors in Phase D2.

---

## Copilot Research

**Copilot key callouts:**
- Authoritative dep version: React **19.2.0** (not 18 as some docs say); update plan refs.
- Vitest is `environment: 'node'`, SSR-style — Phase D adds DOM-mutation tests (e.g., expand parent bucket on hash nav). Need to confirm whether jsdom env is required for those tests OR whether `react-dom/server` snapshots + pure-function tests are sufficient.
- Data model fields in `src/types.ts`: `tasks, phaseTree, runs, periodic, cadence, lastTouched, effort, risk, workstream, sizeBucket, spawnedFrom` — comprehensive list confirms what's available for metrics strip (Phase D2).
- Renderer organization: components/, hooks/, utils/ split is clean — Phase E's `LeftRail.tsx` should follow same pattern (component imports utils from utils/, hooks from hooks/).

---

## Consolidated File List

### Files to MODIFY (existing)

**styles.css**
- `tools/overview-viewer/src/styles.css` — Phase A (all 6 stories), B1 (toast), B2 (quick-actions), B3 (body.compact), C (Radix data-state selectors + tooltip-content + dialog-content), D1 (drop global order rules, add .cmd-bucket rules), D2 (sticky-frame styles), E1 (main-layout grid + .left-rail), E3 (responsive < 900px)

**App.tsx**
- `tools/overview-viewer/src/App.tsx:85-126` (Layout composition) — D2 (mount StickyFrame), E1 (wrap with main-layout grid + LeftRail)

**TaskCommand.tsx**
- `tools/overview-viewer/src/components/TaskCommand.tsx:105-120` (CopyCommandButton) — B1 (toast wiring)
- `:170-203` (WorkstreamPill) — C1 (Radix Tooltip wrap)
- `:72-85` (BulkSelectCheckbox) — C4 (Radix Checkbox)
- `:289` (cmd-desc dangerouslySetInnerHTML) — A2 (highlightMatches)
- `:293-296` (.cmd-actions cluster) — B2 (quick-actions strip)

**Toolbar.tsx**
- `tools/overview-viewer/src/components/Toolbar.tsx:38-97` (FilterChips, BulkCopyButton) — B3 (density toggle button), C3 (Radix Popover + ToggleGroup)

**TopLevelSurfaces.tsx**
- `tools/overview-viewer/src/components/TopLevelSurfaces.tsx:45-62` (KeyboardHelp) — C2 (Radix Dialog)
- `:65-80` (Legend) — E2 (extract to LeftRail)

**TodayPanel.tsx**
- `tools/overview-viewer/src/components/TodayPanel.tsx:22-71` (buildTodayBuckets, recentRuns, TodayChips) — E2 (extract utilities for LeftRail)

**CommandList.tsx**
- `tools/overview-viewer/src/components/CommandList.tsx:37-81` — D1 (bucket grouping)

**Kanban.tsx**
- `tools/overview-viewer/src/components/Kanban.tsx:88-98` (section summary) — A5 (bucket-count chips)

**useHashNav.ts**
- `tools/overview-viewer/src/hooks/useHashNav.ts` — A3 (smooth-scroll + flash-pulse), D1 (walk up to .cmd-bucket parent and expand it)

**usePersistentExpanded.ts**
- `tools/overview-viewer/src/hooks/usePersistentExpanded.ts:30-32` — D3 (setBucketExpanded/isBucketExpanded extension)

**utils/filters.ts**
- `tools/overview-viewer/src/utils/filters.ts:42-65` — A2 (search highlighting integration)

**utils/clipboard.ts**
- `tools/overview-viewer/src/utils/clipboard.ts:1-18` — B1 (capture writeClipboard boolean)

**package.json**
- `tools/overview-viewer/package.json` — C1-C5 (add `@radix-ui/react-tooltip`, `@radix-ui/react-dialog`, `@radix-ui/react-popover`, `@radix-ui/react-toggle-group`, `@radix-ui/react-checkbox`)

**Docs**
- `tools/overview-viewer/README.md` — US-018 (document fourth/fifth deviations if added, new HMR/layout if changed)
- `tools/overview-viewer/CLAUDE.md` — US-018 (layout map update for LeftRail + StickyFrame)
- `.agents/skills/roadmap-and-overview/SKILL.md` — US-018 (viewing subsection update)

### Files to CREATE (new)

- `tools/overview-viewer/src/components/StickyFrame.tsx` — D2
- `tools/overview-viewer/src/components/CopyToast.tsx` — B1
- `tools/overview-viewer/src/components/LeftRail.tsx` — E1
- `tools/overview-viewer/src/utils/searchHighlighting.ts` — A2 (`highlightMatches` util)
- `tools/overview-viewer/src/__tests__/searchHighlighting.test.ts` — A2
- `tools/overview-viewer/src/__tests__/bucketGrouping.test.ts` — D1 (group tasks by orderBucket, count blocked, oldest lastTouchedAt)
- `tools/overview-viewer/src/__tests__/hashNavBucket.test.ts` — D1 (deep-link walks up to .cmd-bucket parent)
- `tools/overview-viewer/src/__tests__/stickyFrame.test.tsx` — D2 (metrics calculation)
- `tools/overview-viewer/src/__tests__/copyToast.test.tsx` — B1 (toast renders + dismisses)
- `tools/overview-viewer/src/__tests__/density.test.ts` — B3 (localStorage persistence)
- `tools/overview-viewer/src/__tests__/leftRail.test.tsx` — E1
- Possibly: `tools/overview-viewer/src/utils/dashboardCounts.ts` — shared between StickyFrame + LeftRail (factor from TodayPanel)

### Files to READ as reference (don't modify)

- `plans/overview-data.js` — data shape, read-only contract
- `plans/overview.html` — generated artifact (rebuilt by `pnpm overview:build`; never hand-edit)
- `tools/overview-viewer/vite.config.ts` — `overviewDataPlugin` shape; don't change without operator approval
- `.ralph/jobs/overview-vite-react/plan.md` — structural reference for previous build
- `plans/overview-viewer-polish-seed.md` — this planning seed (already read)
