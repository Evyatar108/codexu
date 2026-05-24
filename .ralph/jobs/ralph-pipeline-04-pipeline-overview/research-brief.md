# Research Brief — Plan 04 Pipeline Overview (Improve)

## Researcher Findings

### Verified present on main
- `scripts/lib/sync-core.mjs` exports: `walkRalphState`, `readBundleForSlug`, `assembleStateFromBundles`, `deriveAffectedTaskUpdate`, `mergeAndWrite`, `writeSidecar` (private `atomicWriteFile`).
- `mergeAndWrite({ repoRoot, config, currentState, updates, generatedFromCommit })` returns `{ state, writtenAt, changedTaskIds }`. Calls `writeSidecar` near line 270.
- `scripts/lib/watch-ralph-state.mjs`: chokidar + debounce + sync-lock integration.
- `scripts/lib/derive-ralph-stage.mjs`: stage derivation (10 stages — `brainstorming`, `brainstorm-ready`, `planning`, `plan-ready`, `implementing`, `reviewing`, `review-fix`, `replan-pending`, `shipped`, `blocked`).
- `tools/overview-viewer/src/types.ts`: `OverviewTask`, `RalphPipelineState`, `OverviewRalphState`, `OverviewData` — all without Plan 04 fields yet.
- `tools/overview-viewer/src/App.tsx`: `useMultiAxisFilter` → `{ activeFilters, filters, setFilters, query, setQuery, toggleFilter, visibleTaskIds, visibleKanbanTaskIds }`. HMR handlers for `overview-data:update` and `overview-ralph-state:update`.
- `tools/overview-viewer/src/components/Toolbar.tsx`: 10 ralph stage chips in `FILTER_GROUPS`, toggle pattern.
- `tools/overview-viewer/src/components/RalphStageChip.tsx`: stage chip rendering + `tooltipExtras` slot.
- `tools/overview-viewer/src/utils/filters.ts`: `toggleFilter`, `cloneFilters`, `createEmptyFilters`, `FilterAxis` already includes `ralphStage`.
- `tools/overview-viewer/src/styles.css`: `.ralph-stage-chip`, `.chip`, `.filter-chip` style families (lines 102–116, 225–239, 563–576).
- `tools/overview-viewer/vite.config.ts`: `overviewDataPlugin`, `overviewRalphStatePlugin`, `ralphStateWatcherPlugin` all registered.

### Files that DO NOT exist (Plan 04 creates)
- `scripts/lib/score-recommendations.mjs`
- `scripts/lib/derive-dependency-graph.mjs`
- `tools/overview-viewer/src/components/PipelineOverview.tsx`
- `tools/overview-viewer/src/__tests__/pipelineOverview.test.tsx`
- `.ralph/overview-config.json` (only schema file exists)
- `plans/overview-recommendations.json` (generated)
- `plans/overview-dependency-graph.json` (generated)

## Architect Analysis

### Integration points
- `OverviewRalphState` is the aggregation envelope; new top-level fields go here: `aggregateStages?`, `recommendations?`, `dependencyGraph?`, `runDurations?`.
- `mergeAndWrite` is the watcher emission hub. **But** one-shot `pnpm sync-ralph-state` runs `walkRalphState` + `writeSidecar` directly without going through `mergeAndWrite` (see Codex finding #1) — hooks must be placed where both paths cover.
- HMR events: same `overview-ralph-state:update` carries all derived data; no new channels required.

### Suggested 8-story decomposition (architect)
1. Add types
2. Build `score-recommendations.mjs` + tests
3. Build `derive-dependency-graph.mjs` + tests
4. Wire recs + dep-graph emission into shared sync helper
5. Compute & embed `runDurations`
6. Build `PipelineOverview.tsx` + CSS
7. Integrate in `App.tsx`
8. Tests + end-to-end + downstream-plan refresh

### Plan 05 merge surface
- `OverviewRalphState.runDurations` is the known migration target (Plan 05 → `Snapshot.runDurations`). Plan 04 marks it transient.
- `mergeAndWrite` body: Plan 04 adds emission calls; Plan 05 adds activity capture and snapshot emit. Both additive; order = Plan 04 emits first, Plan 05 wraps with activity + snapshot writes.
- `types.ts`: both append at file end; non-conflicting.

## Codex Research

### CRITICAL fixes the existing plan needs
1. **Sync integration path**: Existing plan hooks `mergeAndWrite`. One-shot `pnpm sync-ralph-state` calls `walkRalphState` → `writeSidecar` directly (no `mergeAndWrite`). Watcher cold-start path also calls `writeSidecar` directly. Hooking only `mergeAndWrite` means one-shot CLI never emits recommendations or dep-graph. **Fix:** emit from `writeSidecar` or a shared `emitDerivedArtifacts(state, overviewData, config)` helper called by both `writeSidecar` and the post-merge path.
2. **Config schema**: `.ralph/overview-config.schema.json` has `additionalProperties: false`. Adding `recommendations.weights` requires schema + `default-config.mjs` + `default-config.d.mts` + `resolve-config.mjs` updates plus config tests. Plan currently lists only the JSON file.
3. **Output path config**: Add `outputs.recommendationsJson` and `outputs.dependencyGraphJson` instead of hardcoding `plans/overview-recommendations.json`. Matches existing `outputs.sidecarJson` / `outputs.sidecarJs` pattern.
4. **PRD dependencies are story-local**: `userStories[].dependencies[]` reference story IDs (`US-001`) within the SAME PRD, not cross-job tasks. Node IDs in the dep graph must be `${taskId}:${storyId}` (or similar) — not raw `US-001`. Edge `kind` should distinguish `'depends-on-story'` vs `'spawn'` vs `'blocks-task'`.
5. **`overviewData.spawnedFrom` is top-level**, NOT `OverviewTask.spawnedFrom`. The existing plan line 49 reference (`OverviewTask.spawnedFrom`) is incorrect.
6. **`OverviewTask.priority` does not exist**. The plan's scoring rubric assumes it. Either add `priority?: number` to `OverviewTask` (and document bookkeeper edit pattern) or define hardcoded fallback (always 0.5 → priority weight becomes a constant).
7. **Run duration keying is underspecified**: `RunRecord.id` is not directly linked to `.ralph/jobs/<slug>/job-state.json`. Plan must define: key by run.id, by taskId, or by matching `completedAt` to `run.ranAt` within a window.
8. **`.d.mts` declarations**: New `scripts/lib/*.mjs` modules need adjacent `.d.mts` files so TypeScript tests/imports type-check.
9. **Inline DAG tooltip claim**: Existing plan promises "small inline DAG in the chip tooltip" — but there's no browser plumbing. Either drop the promise or add: graph JS sidecar (`plans/overview-dependency-graph.js`), Vite plugin/inlining, App state load, `tooltipExtras` threading into `RalphStageChip`. Recommended: **drop** the inline DAG from this plan (it adds significant surface) and document it as Plan 06+ scope.

## Copilot Research

Independently confirms Codex points 1–3 and 6:
- Emission path needs to cover one-shot + watcher cold-start + watcher updates.
- Schema `additionalProperties: false` adds work for `recommendations.weights`.
- `OverviewTask.priority` missing.
- PRD dependencies are story-local — edge IDs need `jobSlug:storyId` namespacing.
- Suggests exporting `atomicWriteFile` rather than duplicating.
- Suggests a shared `RALPH_STAGE_ORDER` constant exported from the new component (or extracted) so Toolbar and PipelineOverview share the canonical order; eventually dedupe Toolbar's hardcoded list.

## Consolidated File List

### Files to modify (in worktree at `.ralph/jobs/ralph-pipeline-04-pipeline-overview/worktree/`)
- `scripts/lib/sync-core.mjs` — add `emitDerivedArtifacts` helper; call from `writeSidecar`; export `atomicWriteFile`.
- `scripts/lib/default-config.mjs` + `scripts/lib/default-config.d.mts` — add `outputs.recommendationsJson`, `outputs.dependencyGraphJson`, `recommendations.weights` defaults.
- `scripts/lib/resolve-config.mjs` — resolve new output paths.
- `.ralph/overview-config.schema.json` — extend schema for new config keys.
- `tools/overview-viewer/src/types.ts` — add `Recommendation`, `DependencyGraph`, `DependencyNode`, `DependencyEdge`; add `blocks?: string[]` and `priority?: number` to `OverviewTask`; add `runDurations?`, `recommendations?`, `dependencyGraph?`, `aggregateStages?` to `OverviewRalphState`.
- `tools/overview-viewer/src/App.tsx` — insert `<PipelineOverview>` between `<Toolbar>` and `<Kanban>`.
- `tools/overview-viewer/src/styles.css` — `.pipeline-overview` + `.pipeline-overview-empty` + active/hover.

### Files to create
- `scripts/lib/score-recommendations.mjs` + `.d.mts`
- `scripts/lib/derive-dependency-graph.mjs` + `.d.mts`
- `scripts/lib/score-recommendations.test.mjs`
- `scripts/lib/derive-dependency-graph.test.mjs`
- `tools/overview-viewer/src/components/PipelineOverview.tsx`
- `tools/overview-viewer/src/__tests__/pipelineOverview.test.tsx`
- `.ralph/overview-config.json` (sample with default weights)

### Files to reference (read only)
- `scripts/lib/watch-ralph-state.mjs` — emission timing
- `scripts/sync-ralph-state.mjs` — one-shot path
- `tools/overview-viewer/src/components/Toolbar.tsx` — stage chip pattern + `FILTER_GROUPS`
- `tools/overview-viewer/src/components/RalphStageChip.tsx` — chip rendering / tooltip
- `tools/overview-viewer/src/utils/filters.ts` — `toggleFilter`, `cloneFilters`
- `tools/overview-viewer/src/hooks/useMultiAxisFilter.ts` — return shape
- `scripts/lib/sync-core.test.mjs` (or `syncCore.test.ts`) — script test pattern
- `tools/overview-viewer/src/__tests__/toolbarRalphStageFilter.test.tsx` — component test pattern
- `tools/overview-viewer/src/__tests__/testData.ts` — fixture helpers
- `plans/ralph-pipeline-INDEX.md` — must be refreshed post-merge

### Downstream plans to audit/refresh after Phase 6
- `plans/ralph-pipeline-05-*.md` (agent exports) — runDurations absorption handoff
- `plans/ralph-pipeline-06-*.md` (skills) — `/triage` consumes recommendations
- `plans/ralph-pipeline-09-*.md` (MCP) — recommendations + DAG exposure
- `plans/ralph-pipeline-INDEX.md` — DAG diagram + source-of-truth modules table

## Stale references in the existing plan

| Plan line | Issue | Fix |
|-----------|-------|-----|
| 49 | `OverviewTask.spawnedFrom` — wrong location | Use `overviewData.spawnedFrom` (top-level) |
| 49 | `userStories[].dependencies[]` treated as cross-job | Clarify: story-local IDs; namespace as `${taskId}:${storyId}` |
| 54-57 | Hook into `mergeAndWrite` only | Hook into `writeSidecar` (or shared helper); covers one-shot + watcher |
| 33 | `recommendations.weights` in config — only mentions JSON file | List schema + default-config + resolve-config + config tests |
| 75-78 | Scoring uses `OverviewTask.priority` but field doesn't exist | Either add field or hardcode fallback |
| 11, 41, 132 | "Inline DAG in chip tooltip" | Drop (no browser plumbing) or expand scope significantly. Recommended: drop |
| 67 | Plan references plugin-cache schema path | Use `.ralph/overview-config.schema.json` (in-repo) |
| 94 | "Add 2-3 tests in `ralphStage.test.ts` or new `recommendations.test.ts`" | Use co-located `scripts/lib/score-recommendations.test.mjs` (vitest pattern) |
| 90 | `runDurations` keying ambiguity | Specify: key by `run.id`; resolve completedAt by `.ralph/jobs/<slug>/job-state.json` |
