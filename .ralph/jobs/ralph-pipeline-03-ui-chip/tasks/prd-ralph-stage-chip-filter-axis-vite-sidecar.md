# PRD: Ralph Stage Chip + Filter Axis + Vite Sidecar Plumbing

*Generated autonomously from `plan.md` and `stories-outline.md` in `.ralph/jobs/ralph-pipeline-03-ui-chip/`.*

## 1. Introduction / Overview

Plan 03 is the first user-visible win in the ralph-pipeline series. It renders a per-task `RalphStageChip` in every command row (`TaskCommand`), adds a 10-chip stage filter axis to the toolbar, and extends Vite to serve / inline `plans/overview-ralph-state.js` for both dev (`pnpm overview`) and static builds (`pnpm overview:build`). After this plan ships, opening the viewer shows the stage chip on every Ralph-tracked task, and clicking a stage chip in the toolbar filters both the command list and kanban view.

**Worktree:** `D:/harness-efforts/codexu/.ralph/jobs/ralph-pipeline-03-ui-chip/worktree/` on branch `ralph-pipeline-03-ui-chip`. Do NOT edit `main` directly.

**Parallel-work guardrail:** Plan 02 (branch `ralph-pipeline-02-watcher`) is concurrently editing `tools/overview-viewer/vite.config.ts`. Plan 03 must confine its vite.config edits to a NEW named plugin `overviewRalphStatePlugin()` registered alongside (NOT inside) `overviewDataPlugin()`. Do NOT touch Plan 02's `configureServer` extensions or extend `overviewDataPlugin`. Do NOT add `server.watcher.add(...)` for the ralph sidecar — Plan 02 owns the watch + WS emit.

## 2. Goals

- Render a focusable, tooltip-equipped Ralph stage chip on every Ralph-tracked task row.
- Provide a 10-entry Ralph-stage filter axis in the toolbar that filters both command list and kanban.
- Serve `plans/overview-ralph-state.js` from the Vite dev server and inline it into the static build.
- Keep static-build size under 525,000 bytes for `plans/overview.html`.
- Preserve typecheck and tests green at the end of every story.
- Expose `filters` and `setFilters` from `useMultiAxisFilter` to unblock Plan 04.

## 3. User Stories

### US-001: Filter threading + minimal App.tsx state, no UI yet
**Description:** As an engineer, I want the `'ralphStage'` filter axis threaded through the predicate functions, hook, and App.tsx state so that subsequent stories can render and toggle stage chips without breaking typecheck mid-flight.

**Acceptance Criteria:**
- [ ] `FilterAxis` union in `tools/overview-viewer/src/utils/filters.ts` includes `'ralphStage'`.
- [ ] `createEmptyFilters()` returns `{ ..., ralphStage: new Set<string>() }`.
- [ ] `cloneFilters(f)` deep-clones `ralphStage` (`new Set(filters.ralphStage)`).
- [ ] `getTaskSearchHaystack(task, data, ralphState)` accepts `ralphState: OverviewRalphState` as a non-optional 3rd parameter and appends `ralphState.byTaskId[task.id]?.stage / jobSlug / groupSlug` to the haystack parts.
- [ ] `matchesTaskFilter` and `matchesKanbanFilter` accept `ralphState` as a non-optional parameter and apply the predicate `filters.ralphStage.size === 0 || filters.ralphStage.has(ralphState.byTaskId[task.id]?.stage ?? '__no_ralph__')`.
- [ ] `useMultiAxisFilter(data, taskIdFilter, ralphState)` accepts `ralphState` as the third parameter, forwards it to filter helpers, and includes it in memo deps.
- [ ] `useMultiAxisFilter` returns an object containing `{ activeFilters, filters, setFilters, query, setQuery, toggleFilter, visibleTaskIds, visibleKanbanTaskIds }`. `filters` aliases `activeFilters`; `setFilters` is the raw `setActiveFilters` state setter. (Required by Plan 04.)
- [ ] `App.tsx` calls `const [ralphState, setRalphState] = useState<OverviewRalphState>(getOverviewRalphState);` and passes `ralphState` to `useMultiAxisFilter(data, taskIdFilter, ralphState)`. Do NOT add `reloadRalphState` or the HMR `useEffect` yet (US-006).
- [ ] `testData.ts` exports `NO_RALPH_STATE: OverviewRalphState = { generatedAt: '', generatedFromCommit: '', byTaskId: {} }` and a `loadRalphState()` helper using the synthetic-window pattern: `const w: { OVERVIEW_RALPH_STATE?: OverviewRalphState } = {}; new Function('window', script)(w); return w.OVERVIEW_RALPH_STATE ?? NO_RALPH_STATE;`.
- [ ] `loadRalphState()` returns `NO_RALPH_STATE` without throwing when `plans/overview-ralph-state.js` is missing.
- [ ] Direct filter-helper call sites updated: `searchHaystack.test.ts`, `urlFilter.test.ts` — every call to `matchesTaskFilter` / `matchesKanbanFilter` / `getTaskSearchHaystack` appends `NO_RALPH_STATE`; existing assertions unchanged.
- [ ] `pnpm --filter @codexu/overview-viewer typecheck` exits 0.
- [ ] `pnpm --filter @codexu/overview-viewer test` exits 0.

### US-002: `RalphStageChip` component + unit + interaction tests
**Description:** As a user, I want a focusable stage chip with a Radix Tooltip showing stage / slug / timestamp so I can see at-a-glance where each task sits in the Ralph pipeline.

**Acceptance Criteria:**
- [ ] New file `tools/overview-viewer/src/components/RalphStageChip.tsx` exports a React component with props `{ taskId: string; ralphState: OverviewRalphState; tooltipExtras?: ReactNode }`.
- [ ] Returns `null` when `ralphState.byTaskId[taskId]` is `undefined`.
- [ ] Renders `<span class="ralph-stage-chip stage-<stage>" tabIndex={0} aria-label={'Ralph stage: ' + stage} onClick={e => e.stopPropagation()}>...</span>` wrapped in a Radix `Tooltip.Provider` / `Trigger asChild` / `Portal` / `Content`. No `role="button"`.
- [ ] Tooltip body renders stage name, slug (prefer `jobSlug`, fall back to `groupSlug`, omit if both null), and `lastUpdatedAt` (omit if null). No literal `undefined` strings in the DOM.
- [ ] When `ralphState.byTaskId[taskId].matchSource === 'slug-default'`, the chip element also carries class `match-slug-default`.
- [ ] When `tooltipExtras` prop is provided, it renders inside the tooltip body below the stage/slug/timestamp rows.
- [ ] New file `tools/overview-viewer/src/__tests__/ralphStageChip.test.tsx` (node SSR project) covers: null-when-absent; correct `stage-<stage>` class for each of the 10 stages; `match-slug-default` class added when matchSource is slug-default; no `undefined` in rendered output when jobSlug/groupSlug/lastUpdatedAt are missing.
- [ ] New file `tools/overview-viewer/src/__tests__/interactions/ralphStageChipTooltip.test.tsx` (jsdom project, mirror `interactions/workstreamTooltip.test.tsx`) covers: tab reaches the chip; tooltip appears on focus; tooltip content includes stage and slug.
- [ ] Typecheck and test pass.
- [ ] Verify in browser using dev-browser skill.

### US-003: Wire chip through `CommandList` → `TaskCommand`
**Description:** As a user, I want stage chips to actually show up on every command row in the viewer.

**Acceptance Criteria:**
- [ ] `CommandList.tsx` accepts `ralphState: OverviewRalphState` as a required prop and forwards it to every `<TaskCommand … />` render call.
- [ ] `TaskCommand.tsx` accepts `ralphState` as a required prop and renders `<RalphStageChip taskId={task.id} ralphState={ralphState} />` immediately next to the existing `<WorkstreamPill … />`.
- [ ] `App.tsx` passes `ralphState` to `<CommandList … ralphState={ralphState} />`.
- [ ] Component-render tests `commandList.test.tsx` and `kanban.test.tsx` updated to pass `ralphState={NO_RALPH_STATE}` in every JSX render.
- [ ] For a task whose id is NOT in `ralphState.byTaskId`, `document.querySelectorAll('[data-task-id="<id>"] .ralph-stage-chip').length === 0`.
- [ ] Existing `commandList.test.tsx` and `kanban.test.tsx` snapshots remain unchanged.
- [ ] Typecheck and test pass.
- [ ] Verify in browser using dev-browser skill.

### US-004: `Toolbar` filter group + 10 CSS stage variants
**Description:** As a user, I want a row of 10 stage chips in the toolbar so I can filter the command list and kanban view by Ralph stage.

**Acceptance Criteria:**
- [ ] `Toolbar.tsx` `FILTER_GROUPS` gains an entry `{ axis: 'ralphStage', title: 'Ralph stage', chips: [...10 entries...] }` with stages: brainstorming, brainstorm-ready, planning, plan-ready, implementing, reviewing, review-fix, replan-pending, shipped, blocked (each with emoji label).
- [ ] `Toolbar` does NOT take a new prop — `FILTER_GROUPS` is module-level static.
- [ ] `styles.css` appended with `.ralph-stage-chip` base + exactly 10 per-stage variants (`.stage-brainstorming` … `.stage-blocked`) + `.ralph-stage-chip.match-slug-default { border-style: dotted; }`.
- [ ] Toolbar renders exactly 10 stage chips under the "Ralph stage" group: `document.querySelectorAll('.filter-group[data-axis="ralphStage"] .chip').length === 10`.
- [ ] Positive filter test: given OverviewRalphState with taskA in `implementing` and taskB in `shipped`, `matchesTaskFilter(taskA, ..., { ralphStage: new Set(['implementing']) }, ..., ralphState)` returns true and same call for taskB returns false. Same for `matchesKanbanFilter`.
- [ ] Clicking a stage chip in dev filters both command list AND kanban.
- [ ] Typecheck and test pass.
- [ ] Verify in browser using dev-browser skill.

### US-005: `overviewRalphStatePlugin` in vite.config.ts + `overview.html` script tag
**Description:** As a user, I want the static build and dev server to serve `plans/overview-ralph-state.js` so the chips render in both `pnpm overview` and `pnpm overview:build` outputs.

**Acceptance Criteria:**
- [ ] `vite.config.ts` defines a new named factory `overviewRalphStatePlugin(): Plugin` distinct from `overviewDataPlugin()`. Do NOT modify or extend the existing plugin. Do NOT touch Plan 02's `configureServer` extensions or extend `overviewDataPlugin`. Add a separate named plugin only.
- [ ] `overviewRalphStatePlugin.configureServer` registers middleware on `/overview-ralph-state.js` that reads `plans/overview-ralph-state.js` from disk and serves it with `Content-Type: application/javascript`. Read errors return 500 with an inline comment.
- [ ] Does NOT call `server.watcher.add(...)` for the ralph sidecar (Plan 02 owns the watch).
- [ ] `transformIndexHtml` (order: 'pre', skipped on dev) reads `plans/overview-ralph-state.js`, minifies via esbuild, escapes `</script` → `<\/script`, and inlines into the script tag. Throws a clear error if `overview.html` does not contain `<script src="./overview-ralph-state.js"></script>`.
- [ ] `tools/overview-viewer/overview.html` contains `<script src="./overview-ralph-state.js"></script>` between the existing `overview-data.js` tag and the `/src/main.tsx` module tag.
- [ ] Dev verification: while `pnpm overview` is running, fetching `<dev-server-url>/overview-ralph-state.js` (using the URL printed by `pnpm overview`) returns a non-empty body containing `window.OVERVIEW_RALPH_STATE = `.
- [ ] Static verification: `pnpm overview:build` produces `plans/overview.html` with `grep -c 'OVERVIEW_RALPH_STATE' plans/overview.html >= 1`.
- [ ] Bundle size budget: `wc -c plans/overview.html` reports <= 525000 bytes.
- [ ] Typecheck and test pass.

### US-006: App.tsx `reloadRalphState` helper + HMR `useEffect`
**Description:** As a user with Plan 02's watcher running, I want stage chips to update in real time when underlying job-state files change.

**Acceptance Criteria:**
- [ ] `App.tsx` adds a `reloadRalphState` helper using `useCallback`: fetch `./overview-ralph-state.js?t=<Date.now()>`, execute via `new Function(text)()`, then `setRalphState(getOverviewRalphState())`. Defensive `.catch` logs and continues.
- [ ] `App.tsx` adds a `useEffect` subscribing to `overview-ralph-state:update` via `import.meta.hot?.on('overview-ralph-state:update', reloadRalphState)`, with matching `import.meta.hot?.off` in cleanup. Mirrors existing `overview-data:update` subscription.
- [ ] Both `overview-data:update` and `overview-ralph-state:update` subscriptions coexist.
- [ ] Typecheck and test pass.
- [ ] Verify in browser using dev-browser skill.

### US-007: Downstream-plan cascade audit + INDEX refresh
**Description:** As the next plan-author, I want plans 04–12 + the INDEX to reflect Plan 03's actual deliverables so nobody chases stale file paths or type signatures.

**Acceptance Criteria:**
- [ ] Read each existing plan `plans/ralph-pipeline-04-pipeline-overview.md` through `plans/ralph-pipeline-12-package-as-plugin.md`. List any reference to `RalphStageChip`, `filters.ralphStage`, `useMultiAxisFilter`, `overview-ralph-state.js`, or vite.config plumbing.
- [ ] Confirm Plan 04 line 58's `<PipelineOverview filters={filters} setFilters={setFilters} />` matches the hook return shape (`filters`, `setFilters`).
- [ ] Read `plans/ralph-pipeline-INDEX.md` and update the "Source-of-truth modules" table + DAG diagram for any module names, paths, or contracts changed by Plan 03.
- [ ] Refresh stale references (file paths, type signatures, function/export names, behavior contracts) that diverged from Plan 03's actual implementation.
- [ ] Apply all cascade updates in the final implementation commit. The commit message lists each diff (filename, lines, what changed).
- [ ] Typecheck and test pass.

## 4. Functional Requirements

- FR-1: Add `'ralphStage'` to `FilterAxis` union in `tools/overview-viewer/src/utils/filters.ts`.
- FR-2: Update `createEmptyFilters` and `cloneFilters` to include a `ralphStage: Set<string>` axis.
- FR-3: Add `ralphState: OverviewRalphState` as a non-optional parameter to `getTaskSearchHaystack`, `matchesTaskFilter`, and `matchesKanbanFilter`.
- FR-4: Extend `useMultiAxisFilter` with `ralphState` as a 3rd parameter and expose `filters` + `setFilters` on its return object alongside existing keys.
- FR-5: Implement `RalphStageChip` component with Radix Tooltip, focusable trigger (`tabIndex={0}`), `aria-label`, `onClick stopPropagation`, optional `tooltipExtras` slot, null-safe slug/timestamp rendering, and a `match-slug-default` border-dotted variant.
- FR-6: Render `<RalphStageChip />` in `TaskCommand` next to `<WorkstreamPill />`; thread `ralphState` through `CommandList` → `TaskCommand`.
- FR-7: Add a 10-entry `{ axis: 'ralphStage', title: 'Ralph stage', chips: [...] }` filter group to `Toolbar.tsx` `FILTER_GROUPS`.
- FR-8: Add `.ralph-stage-chip` base + 10 per-stage color variants + `.match-slug-default { border-style: dotted; }` to `styles.css`.
- FR-9: Add a new `overviewRalphStatePlugin()` Vite plugin (sibling to `overviewDataPlugin`) that serves `plans/overview-ralph-state.js` in dev and inlines it in static builds, with a fail-fast guard on missing script tag.
- FR-10: Add `<script src="./overview-ralph-state.js"></script>` to `overview.html` between the existing data sidecar tag and the React module entry.
- FR-11: Implement `App.tsx` `reloadRalphState` helper + `import.meta.hot` subscription to `overview-ralph-state:update`.
- FR-12: Export `NO_RALPH_STATE` and `loadRalphState()` from `testData.ts` using the synthetic-window pattern; handle missing-file by returning `NO_RALPH_STATE`.
- FR-13: Audit downstream plans 04–12 and the INDEX; refresh stale references.

## 5. Non-Goals (Out of Scope)

- Aggregate Pipeline Overview histogram and click-bar-to-filter wiring (Plan 04).
- `nextCommand` derivation and "Copy next command" button in `TaskCommand` (Plan 06).
- `injectRalphStagePill` on kanban cards (Plan 04 or follow-up).
- Notepad surfacing, journal links, PR/branch backlinks in tooltip (Plan 07, via `tooltipExtras`).
- Crew-session list in tooltip (Plan 08, via `tooltipExtras`).
- RecentActivity sidebar (Plan 07).
- Broadening `matchesKanbanFilter` beyond ralphStage + the pre-existing workstream/query checks.
- Modifying Plan 02's `configureServer` extensions or `overviewDataPlugin`.

## 6. Design Considerations

- Mirror `WorkstreamPill` (`TaskCommand.tsx:276-322`) as the Radix Tooltip template.
- Reuse `.cmd-badge.b-*` palette (`styles.css:909-968`) as the starting reference for 10 stage colors.
- Tooltip slug priority: `jobSlug` first, fall back to `groupSlug`, omit if both null.
- Use `useState(getOverviewRalphState)` function-ref form in `App.tsx` so HMR setState triggers re-render.

## 7. Technical Considerations

- React 19 + Vite 8 + Vitest + Radix UI. Viewer at `tools/overview-viewer/`. All files `.tsx`/`.ts`.
- Test split: Node SSR project (excluding `interactions/`) vs jsdom project (`interactions/`). Radix hover/focus tests must live under `interactions/`.
- Static bundle budget: `wc -c plans/overview.html` <= 525,000 bytes.
- `plans/overview-ralph-state.js` assigns to `window.OVERVIEW_RALPH_STATE`; Node SSR tests need synthetic-window pattern.
- Branch `ralph-pipeline-03-ui-chip`. Plan 02 sibling branch `ralph-pipeline-02-watcher` also edits `vite.config.ts` — strict plugin-separation boundary.

## 8. Success Metrics

- Stage chips visible on every Ralph-tracked task in dev and static builds.
- 10-entry Ralph-stage filter group renders in the toolbar.
- Clicking a stage chip filters both command list and kanban.
- `pnpm overview:build` produces `plans/overview.html` <= 525KB with inlined ralph state.
- Both `pnpm --filter @codexu/overview-viewer typecheck` and `test` exit 0.

## 9. Open Questions

- Tooltip slug priority when both `jobSlug` and `groupSlug` are present — defaulted to `jobSlug`-first.
- Exact CSS hex values for the 10 stage variants — deferred to implementation using `.cmd-badge.b-*` palette as reference.
