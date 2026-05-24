# Stories Outline: Plan 04 v2 — Pipeline Overview header + recommendations + dependency graph

*Preliminary decomposition from `/plan-with-ralph --improve`. Feed to `/implement-with-ralph --from-plan` for PRD generation.*

## US-001: Foundation — types + config schema + load-prds-by-task-id helper

**Description:** As an implementer, I need the widened `Recommendation`/`DependencyGraph` types, new `OverviewTask.blocks`/`OverviewTask.priority` fields, the new config keys (`outputs.recommendationsJson`, `outputs.dependencyGraphJson`, `recommendations.weights`, `recommendations.topN`), the `atomic-write.mjs` extraction (per F-013), and the `load-prds-by-task-id.mjs` helper so that downstream stories (US-002..US-005) can rely on stable contracts.

**Acceptance Criteria:**
- [ ] `tools/overview-viewer/src/types.ts` widened: `Recommendation = { taskId, score, stage, reasons: string[] }` (no optionals); `DependencyGraph` node `{ id, type, taskId?, storyId?, stage? }`, edge `{ from, to, type }`; added `OverviewTask.blocks?: string[]` and `OverviewTask.priority?: number`.
- [ ] `scripts/lib/emit-snapshot-schema.mjs` mirrors the new shapes (additive `additionalProperties: true` on Recommendation and DependencyGraph nodes/edges; no breaking changes for existing snapshot files).
- [ ] `.ralph/overview-config.schema.json` accepts `outputs.recommendationsJson`, `outputs.dependencyGraphJson`, and a `recommendations` block (`weights`, `topN`).
- [ ] `scripts/lib/default-config.mjs` + `default-config.d.mts` provide defaults: `outputs.recommendationsJson = 'plans/overview-recommendations.json'`, `outputs.dependencyGraphJson = 'plans/overview-dependency-graph.json'`, `recommendations.weights = { stageUrgency: 40, dependencyState: 30, freshness: 20, priority: 10 }`, `recommendations.topN = 20`.
- [ ] `scripts/lib/resolve-config.mjs`: `recommendations.weights`, `recommendations.topN`, `outputs.recommendationsJson`, `outputs.dependencyGraphJson` round-trip without being filtered (F-023).
- [ ] `scripts/lib/atomic-write.mjs` extracted with `atomicWriteFile` moved from sync-core (or aliased re-export); both sync-core and emit-derived-artifacts import from the new module to break the circular-import risk (F-013).
- [ ] `scripts/lib/load-prds-by-task-id.mjs` + `.d.mts` + `.test.mjs`. Walks `.ralph/jobs/*/prd.json` AND `.ralph/job-groups/*/*/prd.json`. Returns `Record<taskId, { userStories: Array<{ id, dependencies?: string[], passes?: boolean | string }>, dependencies?: string[] }>`. On malformed PRDs: log `[load-prds-by-task-id] failed to parse <path>: <error>` to stderr and skip (never throw).
- [ ] Test fixtures cover: missing prd.json, malformed JSON (logs+skips), ralphOverrides resolution, multi-job same-taskId (last-write-wins by mtime), group member PRD at `.ralph/job-groups/<group>/<member>/prd.json`.
- [ ] `tools/overview-viewer/src/__tests__/scripts.d.ts` ambient declarations kept in sync with `default-config.d.mts` changes (F-019).
- [ ] `pnpm test` (root vitest) and `pnpm --filter @codexu/overview-viewer typecheck` pass.

**Dependencies:** None.
**Estimated complexity:** medium.

---

## US-002: `scoreRecommendations` pure helper + tests

**Description:** As the sync emitter, I need a pure scoring function that turns `byTaskId + overviewData + prdsByTaskId + weights` into a sorted `Recommendation[]`, so downstream consumers (the viewer histogram, `/triage` skill, MCP) read a precomputed list rather than recomputing at consumer time.

**Acceptance Criteria:**
- [ ] `scripts/lib/score-recommendations.mjs` exports `scoreRecommendations({ byTaskId, overviewData, prdsByTaskId, weights, topN })` → `Recommendation[]` (sorted score-descending, capped at `topN`).
- [ ] Each `Recommendation = { taskId, score, stage, reasons: string[] }`. `reasons` carries top 2-3 contributing factors as human-readable strings (e.g. `["review-fix stage", "unblocked", "not touched in 9 days"]`).
- [ ] Scoring rubric per the plan: 40 stage / 30 dependency / 20 freshness / 10 priority. Dependency state uses `userStories[].passes` from `prdsByTaskId`. Freshness decays linearly from `lastUpdatedAt`. Priority reads `OverviewTask.priority` and falls back to 0.5 when undefined/non-numeric.
- [ ] Pure function — no fs, no console, no clock reads except `Date.now()` for freshness (inject via optional `now` parameter for tests).
- [ ] Adjacent `.d.mts`.
- [ ] `scripts/lib/score-recommendations.test.mjs` covers: per-dimension scoring; weight override; topN limit; missing-data fallbacks (no PRD, no priority, no lastUpdatedAt); priority normalization; deterministic ordering for ties (stable sort by taskId).
- [ ] `pnpm test` passes.

**Dependencies:** US-001.
**Estimated complexity:** medium.

---

## US-003: `deriveDependencyGraph` pure helper + tests

**Description:** As the sync emitter, I need a pure function that turns `byTaskId + overviewData + prdsByTaskId` into a `DependencyGraph` with task and story nodes plus directional edges, so the viewer can render the DAG and Plan 09's MCP server can expose it.

**Acceptance Criteria:**
- [ ] `scripts/lib/derive-dependency-graph.mjs` exports `deriveDependencyGraph({ byTaskId, overviewData, prdsByTaskId, generatedFromCommit })` → `DependencyGraph`.
- [ ] Node ids: task nodes use `taskId` directly; **story nodes use composite `${taskId}:${storyId}`** so duplicate story ids across PRDs do not collapse (F-005).
- [ ] Edge direction convention (F-015): for ALL edge types, `from` = dependent, `to` = prerequisite. `{ from: 'A', to: 'B', type: 'depends-on-story' }` ⇒ A depends on B.
- [ ] Edge types emitted: `depends-on-story` (from `prdsByTaskId[*].userStories[*].dependencies[]`), `spawn` (from `OverviewData.spawnedFrom` top-level map), `blocks` (from `OverviewTask.blocks[]`), `depends-on-task` (fallback from PRD-level `dependencies[]` per F-017; drop this type if the plugin PRD schema lacks the field).
- [ ] Edges are de-duplicated (same `from`/`to`/`type` triple appears once).
- [ ] Pure function — no fs, no console.
- [ ] Adjacent `.d.mts`.
- [ ] `scripts/lib/derive-dependency-graph.test.mjs` covers: each edge type (with explicit direction assertion); composite story node uniqueness (two PRDs with `US-001` produce two distinct story nodes); de-duplication; acyclicity check; empty inputs.
- [ ] `pnpm test` passes.

**Dependencies:** US-001.
**Estimated complexity:** medium.

---

## US-004: `emitDerivedArtifacts` + `writeSidecar` wiring + integration test

**Description:** As the sync emitter, I need a helper that calls the pure functions from US-002/US-003, writes the two JSON artifacts atomically, computes `runDurations`, and threads `runDurations` separately through `writeSidecar` → `emitAgentArtifacts` → `buildSnapshot` (no state mutation), so that one writeSidecar call produces a fresh, coherent snapshot.

**Acceptance Criteria:**
- [ ] `scripts/lib/emit-derived-artifacts.mjs` exports `emitDerivedArtifacts({ repoRoot, config, state, overviewData, prdsByTaskId?, generatedFromCommit })` → `{ runDurations: Record<runId, number> }`. JSDoc documents inputs, outputs, and the no-mutation contract for `state` (F-022).
- [ ] When `prdsByTaskId` is not supplied, the helper loads it lazily via `loadPrdsByTaskId` (US-001).
- [ ] `runDurations` precision (F-014): key = `runId` matching `OverviewData.runs[].id`; value = hours rounded to 1 decimal.
- [ ] `scripts/lib/sync-core.mjs`:
  - `writeSidecar()` accepts a `runDurations` slot via local variable returned by `emitDerivedArtifacts`; threads it as a parameter into `emitAgentArtifacts({ ..., runDurations })` which passes it into `buildSnapshot`. `state` is not mutated and `state.generatedFromCommit` is the source of truth for any commit metadata (F-012).
  - `loadOverviewData` is hoisted out of `emitAgentArtifacts` into `writeSidecar`, parsed once and passed down.
  - Replace hardcoded `PLAN_04_RECOMMENDATIONS_PATH` / `PLAN_04_DEPENDENCY_GRAPH_PATH` constants at lines 38-39 with `config.outputs.recommendationsJson` / `config.outputs.dependencyGraphJson` resolved via `resolveMaybeAbsolute` for both the writer and the reader (F-003).
- [ ] Both JSON files are written via the shared `atomicWriteFile` from `scripts/lib/atomic-write.mjs`.
- [ ] Recommendations file shape: `{ recommendations: Recommendation[], generatedAt, generatedFromCommit }`. Graph file shape: `{ nodes, edges }` (unwrapped — matches `unwrapDependencyGraph` at sync-core.mjs:370).
- [ ] Integration test (`scripts/lib/write-sidecar-freshness.test.mjs` or extension of `sync-core.test.mjs`): run `writeSidecar()` once in a tempdir, then assert `JSON.parse(read(snapshotPath)).recommendations` deep-equals `JSON.parse(read(recommendationsPath)).recommendations` (no 1-cycle lag); same for `dependencyGraph` (`JSON.parse(read(snapshotPath)).dependencyGraph` deep-equals `JSON.parse(read(graphPath))`).
- [ ] Custom output path override test: set `outputs.recommendationsJson` and `outputs.dependencyGraphJson` to non-default temp paths; assert both writer and reader honor them and snapshot fields match (F-003).
- [ ] Sidecar JSON does NOT contain a `runDurations` field (regression guard for F-001/F-008).
- [ ] `pnpm test` and `pnpm --filter @codexu/overview-viewer typecheck` pass.

**Dependencies:** US-002, US-003.
**Estimated complexity:** medium.

---

## US-005: `PipelineOverview` component + App.tsx wiring + CSS + tests

**Description:** As a dashboard user, I want a horizontal stage-count histogram between the Toolbar and the Kanban so I can see bottlenecks at a glance and click a stage to filter the views to that single stage.

**Acceptance Criteria:**
- [ ] `tools/overview-viewer/src/utils/ralphStages.ts` exports a frozen `RALPH_STAGE_ORDER: readonly RalphStage[]` (length 10). Both `Toolbar.tsx` and `PipelineOverview.tsx` import it (F-009).
- [ ] `tools/overview-viewer/src/components/PipelineOverview.tsx` renders 10 chips in canonical order with `<stage> · <count>` labels and active state on chips matching `filters.ralphStage`.
- [ ] Click handler: single-select replace. `setFilters(current => { const next = cloneFilters(current); next.ralphStage = current.ralphStage.has(stage) ? new Set() : new Set([stage]); return next })`.
- [ ] Empty state: when `Object.keys(ralphState.byTaskId).length === 0`, render `<div className="pipeline-overview-empty">No Ralph state tracked yet — run <code>pnpm sync-ralph-state</code> or check unmatched in stderr</div>`.
- [ ] `tools/overview-viewer/src/App.tsx`: render `<PipelineOverview ralphState={ralphState} filters={filters} setFilters={setFilters} />` between `<Toolbar>` and `<Kanban>`. Thread from existing `useMultiAxisFilter()` return.
- [ ] `tools/overview-viewer/src/styles.css`: `.pipeline-overview`, `.pipeline-overview-chip`, `.pipeline-overview-chip.active`, `.pipeline-overview-empty`. Reuse `.ralph-stage-chip.stage-*` color classes where possible.
- [ ] `tools/overview-viewer/src/__tests__/pipelineOverview.test.tsx` (SSR project): renders 10 chips with correct counts; empty-state test asserts rendered output contains substring `No Ralph state tracked yet` and an element with class `pipeline-overview-empty` (F-021).
- [ ] `tools/overview-viewer/src/__tests__/interactions/pipelineOverviewFilter.test.tsx` (jsdom project): click chip → `setFilters` called with single-element set; click same chip again → empty set; click different chip → replaces.
- [ ] `pnpm overview` shows the histogram between Toolbar and Kanban.
- [ ] `pnpm overview:build` produces `plans/overview.html` with `wc -c plans/overview.html` ≤ 526,372 bytes (1.05x current baseline of 501,307 bytes; F-018). Record final byte count in the US-005 commit message.
- [ ] `pnpm --filter @codexu/overview-viewer test` (both SSR + jsdom projects) and `pnpm --filter @codexu/overview-viewer typecheck` pass.

**Dependencies:** US-001.
**Estimated complexity:** medium.

---

## US-006: Downstream cascade audit + CLAUDE.md update

**Description:** As an INDEX maintainer, I need downstream plans (06, 07, 08, 09, 12, INDEX) and `tools/overview-viewer/CLAUDE.md` to reflect the actual Plan 04 v2 contracts (or have stale references logged for later cleanup if concurrent jobs are running).

**Acceptance Criteria:**
- [ ] Parallel-safety scan: enumerate `.ralph/jobs/*/job-state.json` AND `.ralph/job-groups/*/job-state.json`, **excluding the current job directory `ralph-pipeline-04-pipeline-overview-v2`** (F-011). If any peer entry has `status: "RUNNING"` AND `orchestrator.terminal !== true`, treat as concurrent.
- [ ] If concurrent: append entries to `<job_dir>/notepad.md` under a `## Deferred Cascade` heading. Each entry: which file, which line, what change is needed, name of the concurrent peer job. Do NOT edit shared plan markdown.
- [ ] If NOT concurrent: audit Plans 06, 07, 08, 09, 12, INDEX for stale references to `Recommendation` shape, `DependencyGraph` shape, `OverviewTask.blocks`/`priority`, `runDurations`, `overview-recommendations.json` path, `overview-dependency-graph.json` path, `score-recommendations.mjs` exports. Per research, none should exist on current main; if zero drift found, log "no drift found" + the verified plan list to `<job_dir>/notepad.md` as evidence.
- [ ] If drift found and not concurrent: update plan markdown files atomically in the final commit. List each diff in the commit message.
- [ ] `tools/overview-viewer/CLAUDE.md` "Ralph state sidecar" section gains a single sentence: "`writeSidecar()` now also emits `overview-recommendations.json` and `overview-dependency-graph.json` via `emitDerivedArtifacts()` BEFORE `emitAgentArtifacts()`, so the snapshot picks up fresh derived artifacts in the same write."
- [ ] `pnpm test` and `pnpm --filter @codexu/overview-viewer typecheck` still pass.

**Dependencies:** US-004, US-005.
**Estimated complexity:** small.
