# Stories Outline: Ralph Stage Chip + Filter Axis + Vite Sidecar Plumbing

*Preliminary decomposition from `/plan-with-ralph`. Feed to `/implement-with-ralph --from-plan` for PRD generation.*

## US-001: Filter threading + minimal App.tsx state, no UI yet

**Description:** As an engineer, I want the `'ralphStage'` filter axis threaded through the predicate functions, hook, and App.tsx state so that subsequent stories can render and toggle stage chips without breaking typecheck mid-flight.

**Acceptance Criteria:**
- [ ] `FilterAxis` union in `tools/overview-viewer/src/utils/filters.ts` includes `'ralphStage'`.
- [ ] `createEmptyFilters()` returns `{ ..., ralphStage: new Set<string>() }`.
- [ ] `cloneFilters(f)` deep-clones `ralphStage` (`new Set(filters.ralphStage)`).
- [ ] `getTaskSearchHaystack(task, data, ralphState)` accepts `ralphState: OverviewRalphState` as a non-optional 3rd parameter and appends `ralphState.byTaskId[task.id]?.stage / jobSlug / groupSlug` to the haystack parts.
- [ ] `matchesTaskFilter` and `matchesKanbanFilter` accept `ralphState` as a non-optional parameter and apply the predicate `filters.ralphStage.size === 0 || filters.ralphStage.has(ralphState.byTaskId[task.id]?.stage ?? '__no_ralph__')`.
- [ ] `useMultiAxisFilter(data, taskIdFilter, ralphState)` accepts `ralphState` as the third parameter, forwards it to filter helpers, and includes it in memo deps.
- [ ] `useMultiAxisFilter` returns an **object** containing `{ activeFilters, filters, setFilters, query, setQuery, toggleFilter, visibleTaskIds, visibleKanbanTaskIds }`. `filters` is an alias of `activeFilters`; `setFilters` exposes the raw `setActiveFilters` state setter. (Required by Plan 04.)
- [ ] `App.tsx` calls `const [ralphState, setRalphState] = useState<OverviewRalphState>(getOverviewRalphState);` and passes `ralphState` to `useMultiAxisFilter(data, taskIdFilter, ralphState)`. **Do NOT add `reloadRalphState` or the HMR `useEffect` yet — those are US-006.**
- [ ] `testData.ts` exports `NO_RALPH_STATE: OverviewRalphState = { generatedAt: '', generatedFromCommit: '', byTaskId: {} }` and a `loadRalphState()` helper using the synthetic-window pattern: `const w: { OVERVIEW_RALPH_STATE?: OverviewRalphState } = {}; new Function('window', script)(w); return w.OVERVIEW_RALPH_STATE ?? NO_RALPH_STATE;` (mirrors `loadOverviewData()` at `testData.ts:7`).
- [ ] `loadRalphState()` returns `NO_RALPH_STATE` without throwing when `plans/overview-ralph-state.js` is missing.
- [ ] Direct filter-helper call sites updated: `searchHaystack.test.ts`, `urlFilter.test.ts` — every call to `matchesTaskFilter` / `matchesKanbanFilter` / `getTaskSearchHaystack` appends `NO_RALPH_STATE` as the new argument; existing assertions unchanged.
- [ ] `pnpm --filter @codexu/overview-viewer typecheck` exits 0 at the end of this story (no type errors, no missing args at the App.tsx call site).
- [ ] `pnpm --filter @codexu/overview-viewer test` exits 0.

**Dependencies:** None (depends on Plan 01's emitted types + sidecar files, which are already on disk).

**Estimated complexity:** medium

---

## US-002: `RalphStageChip` component + unit + interaction tests

**Description:** As a user, I want a focusable stage chip with a Radix Tooltip showing stage / slug / timestamp so I can see at-a-glance where each task sits in the Ralph pipeline.

**Acceptance Criteria:**
- [ ] New file `tools/overview-viewer/src/components/RalphStageChip.tsx` exports a React component with props `{ taskId: string; ralphState: OverviewRalphState; tooltipExtras?: ReactNode }`.
- [ ] Returns `null` when `ralphState.byTaskId[taskId]` is `undefined`.
- [ ] Renders `<span class="ralph-stage-chip stage-<stage>" tabIndex={0} aria-label={`Ralph stage: ${stage}`} onClick={e => e.stopPropagation()}>…</span>` wrapped in a Radix `Tooltip.Provider` / `Trigger asChild` / `Portal` / `Content` (mirror `WorkstreamPill` at `TaskCommand.tsx:276-322`). No `role="button"`.
- [ ] Tooltip body renders stage name, slug (prefer `jobSlug`, fall back to `groupSlug`, omit if both null), and `lastUpdatedAt` (omit if null). No literal `undefined` strings in the DOM.
- [ ] When `ralphState.byTaskId[taskId].matchSource === 'slug-default'`, the chip element also carries class `match-slug-default`.
- [ ] When `tooltipExtras` prop is provided, it renders inside the tooltip body below the stage/slug/timestamp rows.
- [ ] New file `tools/overview-viewer/src/__tests__/ralphStageChip.test.tsx` (node SSR project) covers: null-when-absent; correct `stage-<stage>` class for each of the 10 stages; `match-slug-default` class added when matchSource is slug-default; no `undefined` in rendered output when jobSlug/groupSlug/lastUpdatedAt are missing.
- [ ] New file `tools/overview-viewer/src/__tests__/interactions/ralphStageChipTooltip.test.tsx` (jsdom project, mirror `interactions/workstreamTooltip.test.tsx`) covers: tab key reaches the chip; tooltip appears on focus; tooltip content includes stage and slug.
- [ ] `pnpm --filter @codexu/overview-viewer typecheck && pnpm --filter @codexu/overview-viewer test` exits 0.

**Dependencies:** US-001.

**Estimated complexity:** medium

---

## US-003: Wire chip through `CommandList` → `TaskCommand`

**Description:** As a user, I want stage chips to actually show up on every command row in the viewer.

**Acceptance Criteria:**
- [ ] `tools/overview-viewer/src/components/CommandList.tsx` accepts `ralphState: OverviewRalphState` as a required prop and forwards it to every `<TaskCommand … />` render call.
- [ ] `tools/overview-viewer/src/components/TaskCommand.tsx` accepts `ralphState` as a required prop and renders `<RalphStageChip taskId={task.id} ralphState={ralphState} />` immediately next to the existing `<WorkstreamPill … />` (around line 410 in current code).
- [ ] `App.tsx` passes `ralphState` to `<CommandList … ralphState={ralphState} />`.
- [ ] Component-render tests `commandList.test.tsx` and `kanban.test.tsx` updated to pass `ralphState={NO_RALPH_STATE}` in JSX so they continue to compile and existing assertions still hold.
- [ ] Tasks whose id is NOT in `ralphState.byTaskId` show no `.ralph-stage-chip` element: `document.querySelectorAll('[data-task-id="<untracked-id>"] .ralph-stage-chip').length === 0`.
- [ ] Existing `commandList.test.tsx` and `kanban.test.tsx` snapshots remain unchanged.
- [ ] `pnpm --filter @codexu/overview-viewer typecheck && pnpm --filter @codexu/overview-viewer test` exits 0.

**Dependencies:** US-001, US-002.

**Estimated complexity:** small

---

## US-004: `Toolbar` filter group + 10 CSS stage variants

**Description:** As a user, I want a row of 10 stage chips in the toolbar so I can filter the command list and kanban view by Ralph stage.

**Acceptance Criteria:**
- [ ] `tools/overview-viewer/src/components/Toolbar.tsx` `FILTER_GROUPS` gains an entry `{ axis: 'ralphStage', title: 'Ralph stage', chips: [...10 entries...] }`. Exact chips: brainstorming, brainstorm-ready, planning, plan-ready, implementing, reviewing, review-fix, replan-pending, shipped, blocked (each with an emoji label per the existing convention in this plan).
- [ ] `Toolbar` does NOT take a new prop — `FILTER_GROUPS` is module-level static.
- [ ] `tools/overview-viewer/src/styles.css` appended with `.ralph-stage-chip` base (mirror `.pill` at line 98) **plus exactly 10 per-stage color variants** (`.stage-brainstorming` … `.stage-blocked`) plus `.ralph-stage-chip.match-slug-default { border-style: dotted; }`.
- [ ] Toolbar renders exactly 10 stage chips under the "Ralph stage" group (verifiable: `document.querySelectorAll('.filter-group[data-axis="ralphStage"] .chip').length === 10` in dev).
- [ ] Positive filter test: `matchesTaskFilter` against a real OverviewRalphState with one task in stage `implementing` and one in stage `shipped`, given `filters = { ralphStage: new Set(['implementing']) }` returns true for the implementing task and false for the shipped task. Same for `matchesKanbanFilter`.
- [ ] Clicking a stage chip in dev (`pnpm overview`) filters both the command list AND the kanban view to that stage.
- [ ] `pnpm --filter @codexu/overview-viewer typecheck && pnpm --filter @codexu/overview-viewer test` exits 0.

**Dependencies:** US-001, US-003.

**Estimated complexity:** small

---

## US-005: `overviewRalphStatePlugin` in vite.config.ts + `overview.html` script tag

**Description:** As a user, I want the static build and dev server to serve `plans/overview-ralph-state.js` so the chips render in both `pnpm overview` and `pnpm overview:build` outputs.

**Acceptance Criteria:**
- [ ] `tools/overview-viewer/vite.config.ts` defines a new named factory `overviewRalphStatePlugin(): Plugin` distinct from `overviewDataPlugin()` (DO NOT modify or extend the existing plugin).
- [ ] `overviewRalphStatePlugin.configureServer` registers middleware on `/overview-ralph-state.js` that reads `plans/overview-ralph-state.js` from disk and serves it with `Content-Type: application/javascript`. Read errors return a 500 with an inline comment.
- [ ] **Does NOT call `server.watcher.add(...)`** for the ralph sidecar (Plan 02 owns the watch).
- [ ] **Does NOT touch Plan 02's `configureServer` extensions** — `overviewRalphStatePlugin` is registered as a sibling in the `plugins: []` array after `overviewDataPlugin()`.
- [ ] `transformIndexHtml` (order: 'pre', skipped on dev) reads `plans/overview-ralph-state.js`, minifies via esbuild, escapes `</script` → `<\/script`, and inlines into the script tag. **Must throw a clear error if `overview.html` does not contain `<script src="./overview-ralph-state.js"></script>`** (mirror existing `overviewDataPlugin` guard).
- [ ] `tools/overview-viewer/overview.html` contains `<script src="./overview-ralph-state.js"></script>` placed between the existing `overview-data.js` tag and the `/src/main.tsx` module tag.
- [ ] Dev verification: while `pnpm overview` is running, fetching `<dev-server-url>/overview-ralph-state.js` (using the URL printed by `pnpm overview`, NOT a hardcoded 127.0.0.1:5173) returns a non-empty body containing `window.OVERVIEW_RALPH_STATE = `.
- [ ] Static verification: `pnpm overview:build` produces `plans/overview.html` with `grep -c 'OVERVIEW_RALPH_STATE' plans/overview.html >= 1`.
- [ ] Bundle size budget: `wc -c plans/overview.html` reports **<= 525000 bytes**.
- [ ] `pnpm --filter @codexu/overview-viewer typecheck && pnpm --filter @codexu/overview-viewer test` exits 0.

**Dependencies:** US-001 (so that the sidecar consumers exist), US-004 (so the chip + CSS render in the built output).

**Estimated complexity:** medium

---

## US-006: App.tsx `reloadRalphState` helper + HMR `useEffect`

**Description:** As a user with Plan 02's watcher running, I want stage chips to update in real time when underlying job-state files change.

**Acceptance Criteria:**
- [ ] `App.tsx` adds a `reloadRalphState` helper: `useCallback(async () => { try { const text = await fetch('./overview-ralph-state.js?t=' + Date.now()).then(r => r.text()); new Function(text)(); setRalphState(getOverviewRalphState()); } catch (err) { console.warn('[ralph-state] reload failed', err); } }, []);` — note the defensive `.catch` for transient fetch failures during atomic writes.
- [ ] `App.tsx` adds a `useEffect` subscribing to `overview-ralph-state:update` via `import.meta.hot?.on('overview-ralph-state:update', reloadRalphState)`, with the matching `import.meta.hot?.off` in cleanup. Mirror the existing `overview-data:update` subscription pattern.
- [ ] Both `overview-data:update` and `overview-ralph-state:update` subscriptions coexist (the new one is additive, not a replacement).
- [ ] Dev verification (only if Plan 02 is merged): editing a `.ralph/jobs/<test>/job-state.json` updates the chip color in the browser within ~2-3 seconds without a page reload. Without Plan 02, the subscription is a harmless no-op.
- [ ] `pnpm --filter @codexu/overview-viewer typecheck && pnpm --filter @codexu/overview-viewer test` exits 0.

**Dependencies:** US-001, US-005 (the sidecar must be served before `reloadRalphState` can fetch it).

**Estimated complexity:** small

---

## US-007: Downstream-plan cascade audit + INDEX refresh

**Description:** As the next plan-author, I want plans 04–12 + the INDEX to reflect Plan 03's actual deliverables so nobody chases stale file paths or type signatures.

**Acceptance Criteria:**
- [ ] Read each existing plan under `plans/ralph-pipeline-04-pipeline-overview.md` through `plans/ralph-pipeline-12-package-as-plugin.md`. For each, list any reference to `RalphStageChip`, `filters.ralphStage`, `useMultiAxisFilter`, `overview-ralph-state.js` sidecar, or `vite.config.ts` plumbing.
- [ ] Plan 04 (`plans/ralph-pipeline-04-pipeline-overview.md`) line 58 references `setFilters` from `useMultiAxisFilter`. Confirm that Plan 03's US-001 has exposed `setFilters` on the hook's return object. (Should already be true from US-001's acceptance.) If Plan 04 references any other shape change, update Plan 03 accordingly OR update Plan 04 — pick the more correct of the two.
- [ ] Read `plans/ralph-pipeline-INDEX.md` and update the "Source-of-truth modules" table and DAG diagram if Plan 03's deliverables changed module names, paths, or contracts (e.g., `RalphStageChip` becomes the source-of-truth chip component for plans 07/08).
- [ ] Refresh stale references — file paths, type signatures, function/export names, behavior contracts, module dependencies — that diverged from Plan 03's actual implementation.
- [ ] Apply all cascade updates in the final implementation commit. The commit message lists each diff (filename, lines changed, what changed) so reviewers can verify the cascade in one read.

**Dependencies:** US-001 through US-006 (cascade audit is meaningful only after the implementation has materialized).

**Estimated complexity:** small
