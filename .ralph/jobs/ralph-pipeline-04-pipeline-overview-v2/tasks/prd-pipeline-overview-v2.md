# PRD: Pipeline Overview v2 — Header histogram + recommendations + dependency graph (Plan 04 v2)

*Generated autonomously by Phase 2 of `/implement-with-ralph` on 2026-05-19 from `plan.md` + `stories-outline.md`. Plan-review findings (24 total; 7 High, 13 Medium, 4 Low) are folded into individual story acceptance criteria; the 7 High consensus findings (F-001..F-007) are also carried verbatim in `prd.json.planReviewContext` so the iteration agent re-encounters them on every run.*

## 1. Introduction / Overview

Plan 03 gave every task a Ralph stage chip on its row. With ~18 tasks, scanning 18 chips to find "where are my bottlenecks?" still takes ~10 seconds. A horizontal histogram of stage counts pinned between the Toolbar and the Kanban answers the same question in ~0.5 seconds and doubles as a click-to-filter UI.

In parallel, this feature emits two new derived JSON artifacts on every sync:

1. `plans/overview-recommendations.json` — ranked "what should I work on next?" list scored from stage urgency, dependency state, freshness, and bookkeeper-set priority. Consumed by Plan 06 (`/triage`) and Plan 09 (MCP `overview.list_recommendations`).
2. `plans/overview-dependency-graph.json` — task DAG export with task-level and story-level nodes. Consumed by Plan 09 (MCP `overview.dependency_graph`) and any future inline-DAG UI.

It also computes `runDurations` (hours per completed Ralph cycle) and threads them through `writeSidecar` → `emitAgentArtifacts` → `buildSnapshot.runDurations` (Plan 05's durable home) **without mutating the Ralph sidecar state**.

**Critical architectural correction vs. the original plan markdown:** `emitDerivedArtifacts` MUST be called **inside `writeSidecar()` BEFORE `emitAgentArtifacts()`**. The latter reads `overview-recommendations.json` and `overview-dependency-graph.json` from disk and bakes them into the snapshot. Calling derived emission after `writeSidecar` produces a 1-cycle staleness lag. (F-001 / F-003 / risk #1.)

## 2. Goals

- A user opening `pnpm overview` immediately sees stage counts at the top of the dashboard and can click any stage to filter Command List + Kanban to that single stage.
- A user opening the dashboard with no Ralph state sees a clear empty-state message (not broken/zero chips).
- The sync (`pnpm sync-ralph-state` AND the watcher) emits `plans/overview-recommendations.json` and `plans/overview-dependency-graph.json` atomically alongside the existing sidecar.
- A single `writeSidecar()` call produces a coherent snapshot: `snapshot.recommendations` deep-equals the freshly written recommendations file's `.recommendations` array; `snapshot.dependencyGraph` deep-equals the freshly written graph file. No 1-cycle staleness lag.
- `Snapshot.runDurations` is populated for completed cycles, the Ralph sidecar JSON does NOT gain a `runDurations` field, and `state` is never mutated.
- `pnpm overview:build` static build (`plans/overview.html`) grows by no more than 5% over the pre-US-005 baseline of 501,307 bytes (cap 526,372 bytes).
- All existing typecheck (`pnpm --filter @codexu/overview-viewer typecheck`) and vitest (`pnpm test`, `pnpm --filter @codexu/overview-viewer test`) suites continue to pass.

## 3. User Stories

### US-001: Foundation — widen types, add config schema, extract atomic-write, build PRD carrier

**Description:** As the implementer of subsequent stories, I need the widened `Recommendation`/`DependencyGraph` types, the new `OverviewTask.blocks?: string[]` + `OverviewTask.priority?: number` fields, the new config keys (`outputs.recommendationsJson`, `outputs.dependencyGraphJson`, `recommendations.weights`, `recommendations.topN`), the `scripts/lib/atomic-write.mjs` extraction (per F-013), and the `scripts/lib/load-prds-by-task-id.mjs` helper, so that US-002..US-005 can rely on stable contracts.

**Acceptance Criteria:**
- [ ] `tools/overview-viewer/src/types.ts` widened: `Recommendation = { taskId: string; score: number; stage: RalphStage; reasons: string[] }` (no optionals; was `{ taskId?, score?, rationale? }`). `DependencyGraph.nodes` element widened to `{ id, type: 'task'|'story', taskId?, storyId?, stage? }`. `DependencyGraph.edges` element widened to `{ from, to, type: 'blocks'|'depends-on-story'|'spawn'|'depends-on-task' }`.
- [ ] `OverviewTask` interface gains `blocks?: string[]` (bookkeeper-edited only — no auto-population) AND `priority?: number` (resolves F-006: the field referenced by the scoring rubric now exists in the type).
- [ ] `scripts/lib/emit-snapshot-schema.mjs` mirrors the widened shapes: `Recommendation` keeps `additionalProperties: true`; `DependencyGraph` nodes/edges each gain `additionalProperties: true`. Existing snapshot files still parse against the widened schema.
- [ ] `.ralph/overview-config.schema.json` accepts new keys: `outputs.recommendationsJson` (string), `outputs.dependencyGraphJson` (string), and a `recommendations` block with `weights` (object) + `topN` (integer ≥ 1).
- [ ] `scripts/lib/default-config.mjs` + `scripts/lib/default-config.d.mts` supply defaults: `outputs.recommendationsJson = 'plans/overview-recommendations.json'`, `outputs.dependencyGraphJson = 'plans/overview-dependency-graph.json'`, `recommendations.weights = { stageUrgency: 40, dependencyState: 30, freshness: 20, priority: 10 }`, `recommendations.topN = 20`.
- [ ] `scripts/lib/resolve-config.mjs` round-trips the new keys without filtering. Unit test asserts `resolveConfig({ outputs: { recommendationsJson: 'custom/rec.json', dependencyGraphJson: 'custom/dep.json' }, recommendations: { weights: { priority: 50 }, topN: 5 } })` preserves them all. (F-023)
- [ ] `scripts/lib/atomic-write.mjs` exists; `atomicWriteFile` is moved (or re-exported) from `sync-core.mjs` into the new module. Both `sync-core.mjs` and `emit-derived-artifacts.mjs` (US-004) import from the new module. This breaks the otherwise-circular import. (F-013)
- [ ] `scripts/lib/load-prds-by-task-id.mjs` + `.d.mts` + `.test.mjs` exist. The helper walks BOTH `.ralph/jobs/*/prd.json` AND `.ralph/job-groups/*/*/prd.json` (two-level glob — group member PRDs live at `<group>/<member>/prd.json`, per F-004). Returns `Record<taskId, { userStories: Array<{ id: string; dependencies?: string[]; passes?: boolean | string }>; dependencies?: string[] }>` — preserves `userStories[].passes` (needed by `scoreRecommendations`, F-002) AND PRD-level `dependencies?: string[]` (needed for `depends-on-task` fallback, F-017).
- [ ] On malformed JSON, `load-prds-by-task-id.mjs` logs `[load-prds-by-task-id] failed to parse <path>: <error>` to stderr and skips the file (never throws — would otherwise halt the watcher debounce loop). (F-016)
- [ ] Task-matching reuses the same `ralphOverrides` + filename-slug resolution as `assembleStateFromBundles`; if the helper is not already exported from `sync-core.mjs`, export it.
- [ ] Multi-job same-taskId resolution: when two PRDs resolve to the same taskId, last-write-wins by `mtime`.
- [ ] Tests cover: missing prd.json, malformed JSON (logs + skips, does NOT throw), `ralphOverrides` resolution, group member PRD fixture (`.ralph/job-groups/<group>/<member>/prd.json`), multi-job same-taskId (last-write-wins by mtime), `userStories[].passes` preserved, PRD-level `dependencies` preserved for `depends-on-task` fallback.
- [ ] Implementer inspects `C:/Users/evmitran/.claude/plugins/cache/ai-developer-toolkit/ralph-orchestration/5.41.0/schemas/prd-schema.json` to confirm `userStories[].id`, `userStories[].dependencies`, `userStories[].passes`, and PRD-level `dependencies` field names. Verified field names are captured in `load-prds-by-task-id.mjs` JSDoc. If the schema lacks the PRD-level `dependencies` field, document that the `depends-on-task` fallback in US-003 is dropped. (F-024)
- [ ] `tools/overview-viewer/src/__tests__/scripts.d.ts` ambient declarations updated to mirror new `default-config.d.mts` fields so overview-viewer typecheck continues to pass. (F-019)
- [ ] `pnpm test` (root vitest) and `pnpm --filter @codexu/overview-viewer typecheck` pass.

**Dependencies:** None.

---

### US-002: `scoreRecommendations` pure helper + tests

**Description:** As the sync emitter, I need a pure scoring function that turns `byTaskId + overviewData + prdsByTaskId + weights` into a sorted `Recommendation[]`, so downstream consumers (viewer histogram, `/triage` skill, MCP) read a precomputed list rather than recomputing at consumer time.

**Acceptance Criteria:**
- [ ] `scripts/lib/score-recommendations.mjs` exports `scoreRecommendations({ byTaskId, overviewData, prdsByTaskId, weights, topN, now? })` → `Recommendation[]`, sorted score-descending, capped at `topN`.
- [ ] Each `Recommendation = { taskId: string; score: number; stage: RalphStage; reasons: string[] }`. `reasons` contains the top 2-3 contributing factors as human-readable strings (e.g. `["review-fix stage", "unblocked", "not touched in 9 days"]`).
- [ ] Scoring rubric per the plan: **40 stage urgency / 30 dependency state / 20 freshness / 10 priority**.
  - Stage urgency: `review-fix`=1.0, `replan-pending`=0.95, `plan-ready`=0.9, `reviewing`=0.7, `implementing`=0.6, `blocked`=0.5, `planning`=0.4, `brainstorm-ready`=0.3, `brainstorming`=0.2, `shipped`=0.0.
  - Dependency state: derived from `prdsByTaskId[taskId].userStories[].passes`. Unblocked (all referenced jobs `passes: true`) = 1.0; partially blocked = 0.5; fully blocked = 0.0. No dependencies → 1.0.
  - Freshness: linear decay 1.0 (`lastUpdatedAt` ≤ 1 day ago) → 0.0 (≥ 14 days). Missing timestamp → 0.5.
  - Priority: reads `OverviewTask.priority`. Numeric values normalized 0..1. Missing or non-numeric → 0.5. (F-006)
- [ ] Score formula: `score = sum(w_i * v_i) / sum(w_i)`, range `[0, 1]`.
- [ ] Pure function — no fs, no console. Only clock read is `Date.now()` for freshness; tests inject via optional `now` parameter.
- [ ] Adjacent `scripts/lib/score-recommendations.d.mts` exists.
- [ ] `scripts/lib/score-recommendations.test.mjs` covers (≥ 6 tests): per-dimension scoring (each of stage, dependency, freshness, priority isolated); weight override (e.g. `weights: { priority: 50, stageUrgency: 10, dependencyState: 30, freshness: 10 }` shifts ordering); `topN` cap; missing-data fallbacks (no PRD entry → dep state 1.0; missing `priority` → 0.5; missing `lastUpdatedAt` → 0.5); deterministic tie-break (stable sort by taskId ascending); no-PRD case where `prdsByTaskId` is empty.
- [ ] `pnpm test` passes.

**Dependencies:** US-001.

---

### US-003: `deriveDependencyGraph` pure helper + tests

**Description:** As the sync emitter, I need a pure function that turns `byTaskId + overviewData + prdsByTaskId` into a `DependencyGraph` with task and story nodes plus directional edges, so the viewer can render the DAG and Plan 09's MCP server can expose it.

**Acceptance Criteria:**
- [ ] `scripts/lib/derive-dependency-graph.mjs` exports `deriveDependencyGraph({ byTaskId, overviewData, prdsByTaskId, generatedFromCommit })` → `DependencyGraph`.
- [ ] Task nodes use `taskId` directly. **Story nodes use globally unique composite ids `${taskId}:${storyId}`** so duplicate story ids across PRDs do NOT collapse to one node. Raw `storyId` is preserved as a separate node field for display/debugging. (F-005)
- [ ] **Edge direction convention** (F-015): for ALL edge types, `from` = dependent and `to` = prerequisite. `{ from: 'A', to: 'B', type: 'depends-on-story' }` means A depends on B. Same for `blocks`, `spawn`, `depends-on-task`. Documented in `derive-dependency-graph.mjs` JSDoc.
- [ ] Edge types emitted (in priority order):
  1. `depends-on-story` from `prdsByTaskId[*].userStories[*].dependencies[]`. Bare deps resolve within the same owning task → `${taskId}:${dependencyId}`. Already-qualified `${otherTaskId}:US-NNN` deps are preserved verbatim.
  2. `spawn` from `OverviewData.spawnedFrom` top-level map (`Record<childTaskId, parentTaskId>`, NOT a per-task field — F-005 cousin).
  3. `blocks` from `OverviewTask.blocks?: string[]`.
  4. `depends-on-task` fallback from PRD-level `dependencies?: string[]` for PRDs that have no `userStories`. If the plugin PRD schema does not contain a PRD-level `dependencies` field (verified in US-001), this edge type is dropped entirely. (F-017)
- [ ] Edges are de-duplicated: same `{from, to, type}` triple appears at most once.
- [ ] Pure function — no fs, no console.
- [ ] Adjacent `scripts/lib/derive-dependency-graph.d.mts` exists.
- [ ] `scripts/lib/derive-dependency-graph.test.mjs` covers: each edge type with explicit direction assertion (dependent → prerequisite); composite story node uniqueness (two PRDs with `US-001` produce two distinct nodes and edges target the correct one); de-duplication; acyclicity check on the produced graph for a representative fixture; empty inputs (no PRDs, no spawnedFrom, no blocks) produce `{ nodes: [...task nodes only], edges: [] }`.
- [ ] `pnpm test` passes.

**Dependencies:** US-001.

---

### US-004: `emitDerivedArtifacts` + `writeSidecar` wiring + integration freshness test

**Description:** As the sync pipeline, I need a helper that calls the pure functions from US-002/US-003, writes both JSON artifacts atomically, computes `runDurations`, and threads `runDurations` separately through `writeSidecar` → `emitAgentArtifacts` → `buildSnapshot` (no state mutation), so that one `writeSidecar()` call produces a fresh, coherent snapshot in a single write.

**Acceptance Criteria:**
- [ ] `scripts/lib/emit-derived-artifacts.mjs` exports `emitDerivedArtifacts({ repoRoot, config, state, overviewData, prdsByTaskId?, generatedFromCommit })` → `Promise<{ runDurations: Record<runId, number> }>`. JSDoc documents inputs, returned `runDurations`, and the no-mutation contract for `state`. (F-022)
- [ ] When `prdsByTaskId` is not supplied, the helper loads it lazily via `loadPrdsByTaskId` from US-001.
- [ ] Body order: (1) build `prdsByTaskId` if missing; (2) call `scoreRecommendations` to get `Recommendation[]`; (3) call `deriveDependencyGraph` to get `DependencyGraph`; (4) compute `runDurations` from completed Ralph cycles' `job-state.json` (`createdAt` + `completedAt`); (5) `atomicWriteFile(resolveMaybeAbsolute(repoRoot, config.outputs.recommendationsJson), JSON.stringify({ recommendations, generatedAt, generatedFromCommit }, null, 2))`; (6) `atomicWriteFile(resolveMaybeAbsolute(repoRoot, config.outputs.dependencyGraphJson), JSON.stringify(graph, null, 2))`; (7) return `{ runDurations }`. (F-007 — file shapes documented: recommendations file is wrapped `{ recommendations, ... }`; graph file is unwrapped `{ nodes, edges }` matching `unwrapDependencyGraph` at `sync-core.mjs:370`.)
- [ ] `runDurations` precision (F-014): key = `runId` matching `OverviewData.runs[].id` from `types.ts:151`; value = hours rounded to 1 decimal (3h30m → 3.5).
- [ ] `scripts/lib/sync-core.mjs:writeSidecar` modified:
  - `loadOverviewData(resolveMaybeAbsolute(absoluteRepoRoot, config.dataFile))` is hoisted into `writeSidecar` (parsed once per call) and passed down to both `emitDerivedArtifacts` and `emitAgentArtifacts`.
  - `emitDerivedArtifacts` is called **BEFORE** `emitAgentArtifacts`. (F-001 / risk #1)
  - Returned `runDurations` is passed as a parameter to `emitAgentArtifacts({ ..., runDurations })`, which passes it to `buildSnapshot({ ..., runDurations })`. `state` is NEVER mutated.
  - `generatedFromCommit` source of truth is `state.generatedFromCommit` (already populated by upstream callers). Do not widen `writeSidecar`'s signature. (F-012)
- [ ] Hardcoded `PLAN_04_RECOMMENDATIONS_PATH` and `PLAN_04_DEPENDENCY_GRAPH_PATH` constants at `sync-core.mjs:38-39` are REMOVED. The reader in `emitAgentArtifacts` now resolves recommendations/dep-graph paths via `resolveMaybeAbsolute(repoRoot, config.outputs.recommendationsJson)` / `resolveMaybeAbsolute(repoRoot, config.outputs.dependencyGraphJson)` — the SAME paths the writer uses. (F-003)
- [ ] `emitAgentArtifacts` signature accepts optional `overviewData` (falls back to `loadOverviewData(...)` when omitted, preserving existing direct-test callers) and optional `runDurations` (falls back to `{}` when omitted).
- [ ] Both derived JSON files are written via the shared `atomicWriteFile` from `scripts/lib/atomic-write.mjs` (US-001). No second copy of the helper.
- [ ] Integration test (`scripts/lib/write-sidecar-freshness.test.mjs` or an extension of `scripts/lib/sync-core.test.mjs`): in a tempdir, run `writeSidecar()` once with a small fixture (~3 tasks, ~2 PRDs); then read all four files from disk; assert `JSON.parse(read(snapshotPath)).recommendations` deep-equals `JSON.parse(read(recommendationsPath)).recommendations`; assert `JSON.parse(read(snapshotPath)).dependencyGraph` deep-equals `JSON.parse(read(graphPath))` (no 1-cycle lag). (F-007)
- [ ] Custom output-path override test: set `outputs.recommendationsJson = 'tmp/custom-rec.json'` and `outputs.dependencyGraphJson = 'tmp/custom-dep.json'` in the test config; run `writeSidecar()`; assert both files are written to the overridden paths AND the snapshot embeds the same contents read from those overridden paths. (F-003)
- [ ] Regression guard for F-001 / F-008: after `writeSidecar()` completes in the integration test, assert `JSON.parse(read(sidecarJsonPath))` does NOT contain a `runDurations` key (the `state` object was never mutated, so the serialized sidecar omits the field).
- [ ] `pnpm test` and `pnpm --filter @codexu/overview-viewer typecheck` pass.

**Dependencies:** US-002, US-003.

---

### US-005: `PipelineOverview` component + App.tsx wiring + CSS + tests

**Description:** As a dashboard user, I want a horizontal stage-count histogram between the Toolbar and the Kanban so I can see Ralph pipeline bottlenecks at a glance and click a stage to filter all views to that single stage.

**Acceptance Criteria:**
- [ ] `tools/overview-viewer/src/utils/ralphStages.ts` exists and exports a frozen `RALPH_STAGE_ORDER: readonly RalphStage[]` (length 10) in canonical order. Both `Toolbar.tsx` (refactored) and the new `PipelineOverview.tsx` import it. Test asserts array length is 10 and every entry is a valid `RalphStage` union member. (F-009 — kills stage-order drift risk.)
- [ ] `tools/overview-viewer/src/components/PipelineOverview.tsx` is created. Props: `{ ralphState, filters, setFilters }`. It computes `counts = Object.values(ralphState.byTaskId).reduce(...)` and renders a `<section className="pipeline-overview" aria-label="Ralph pipeline overview">` with 10 buttons (one per stage in `RALPH_STAGE_ORDER`). Each button label: `<stage> · <count>`. Active class when `filters.ralphStage.has(stage)`.
- [ ] Click handler is single-select REPLACE (distinct from Toolbar's multi-select toggle): `setFilters(current => { const next = cloneFilters(current); next.ralphStage = current.ralphStage.has(stage) ? new Set() : new Set([stage]); return next })`. Clicking active chip clears; clicking inactive chip replaces with `new Set([stage])`.
- [ ] Empty-state render: when `Object.keys(ralphState.byTaskId).length === 0`, render `<div className="pipeline-overview-empty">No Ralph state tracked yet — run <code>pnpm sync-ralph-state</code> or check unmatched in stderr</div>`.
- [ ] `tools/overview-viewer/src/App.tsx`: render `<PipelineOverview ralphState={ralphState} filters={filters} setFilters={setFilters} />` between `<Toolbar>` and `<Kanban>`. `ralphState`, `filters`, `setFilters` come from the existing `useMultiAxisFilter()` return — no new state plumbing.
- [ ] `tools/overview-viewer/src/styles.css`: add `.pipeline-overview` (horizontal flex), `.pipeline-overview-chip`, `.pipeline-overview-chip.active`, `.pipeline-overview-empty`. Reuse existing `.ralph-stage-chip.stage-*` color classes where possible.
- [ ] `tools/overview-viewer/src/__tests__/pipelineOverview.test.tsx` (SSR project): renders 10 chips with correct counts for a small fixture; empty-state test asserts the rendered output contains the substring `No Ralph state tracked yet` AND an element with class `pipeline-overview-empty`. (F-021)
- [ ] `tools/overview-viewer/src/__tests__/interactions/pipelineOverviewFilter.test.tsx` (jsdom project): click chip → `setFilters` called once with a callback that produces `filters.ralphStage = new Set([stage])`; click same chip again → callback produces empty set; click a different chip → callback produces `new Set([differentStage])` (replace, not add).
- [ ] No tooltip DAG — the inline-tooltip mention has been removed from the architecture (F-010). The dep graph JSON is sufficient for Plan 06/09 consumers.
- [ ] `pnpm overview` (dev server) shows the histogram between Toolbar and Kanban.
- [ ] `pnpm overview:build` produces `plans/overview.html` whose `wc -c` is **≤ 526,372 bytes** (1.05× the baseline of 501,307 bytes measured immediately before US-005 starts). The final byte count is recorded in the US-005 commit message. (F-018)
- [ ] `pnpm --filter @codexu/overview-viewer test` (both SSR + jsdom projects) and `pnpm --filter @codexu/overview-viewer typecheck` pass.
- [ ] Verify in browser using dev-browser skill: histogram renders, clicking chips filters Command List + Kanban, empty state renders when Ralph state is empty.

**Dependencies:** US-001.

---

### US-006: Downstream cascade audit + CLAUDE.md update

**Description:** As an INDEX maintainer, I need downstream plans (06, 07, 08, 09, 12, INDEX) and `tools/overview-viewer/CLAUDE.md` to reflect the actual Plan 04 v2 contracts — OR to have stale references safely logged for later cleanup if concurrent jobs are running.

**Acceptance Criteria:**
- [ ] Parallel-safety scan: enumerate `.ralph/jobs/*/job-state.json` AND `.ralph/job-groups/*/job-state.json`, **excluding the current job directory `ralph-pipeline-04-pipeline-overview-v2`** (read the slug from `<job_dir>/job-state.json` or the `$CURRENT_JOB` env var — must NOT self-detect). (F-011) Treat any peer entry with `status: "RUNNING"` AND `orchestrator.terminal !== true` as a concurrent execution.
- [ ] If a concurrent peer is detected: append entries to `<job_dir>/notepad.md` under a `## Deferred Cascade` heading. Each entry includes: which file, which line, what change is needed, name of the concurrent peer job. Do NOT edit any shared plan markdown.
- [ ] If NOT concurrent: audit `plans/ralph-pipeline-06-skills.md`, `plans/ralph-pipeline-07-bookkeeping.md` (if present), `plans/ralph-pipeline-08-static-build.md` (if present), `plans/ralph-pipeline-09-mcp.md`, `plans/ralph-pipeline-12-future-loop.md` (if present), and `plans/ralph-pipeline-INDEX.md` for stale references to: `Recommendation` shape, `DependencyGraph` shape, `OverviewTask.blocks`, `OverviewTask.priority`, `runDurations`, `overview-recommendations.json` path, `overview-dependency-graph.json` path, `score-recommendations.mjs` exports.
- [ ] If zero drift is found, log "no drift found" + the verified plan list to `<job_dir>/notepad.md` as evidence. If drift IS found and no concurrent peer is running, update the offending plan markdown files atomically in the final implementation commit; list each diff in the commit message.
- [ ] `tools/overview-viewer/CLAUDE.md` "Ralph state sidecar" section gains one new sentence: `writeSidecar()` now also emits `overview-recommendations.json` and `overview-dependency-graph.json` via `emitDerivedArtifacts()` BEFORE `emitAgentArtifacts()`, so the snapshot picks up fresh derived artifacts in the same write.
- [ ] `pnpm test` and `pnpm --filter @codexu/overview-viewer typecheck` still pass.

**Dependencies:** US-004, US-005.

---

## 4. Functional Requirements

- **FR-1**: `pnpm sync-ralph-state` and the watcher both emit `plans/overview-recommendations.json` (shape: `{ recommendations: Recommendation[], generatedAt: string, generatedFromCommit?: string }`) and `plans/overview-dependency-graph.json` (shape: `{ nodes, edges }`).
- **FR-2**: `emitDerivedArtifacts` is called inside `writeSidecar()` **before** `emitAgentArtifacts()`. The snapshot picks up the just-emitted artifacts in the same write.
- **FR-3**: `runDurations` is computed inside `emitDerivedArtifacts`, returned to `writeSidecar`, threaded as a parameter into `emitAgentArtifacts` → `buildSnapshot`. `state` is NOT mutated; the Ralph sidecar JSON does NOT carry a `runDurations` field.
- **FR-4**: Custom config overrides for `outputs.recommendationsJson` / `outputs.dependencyGraphJson` work end-to-end: both the writer (`emitDerivedArtifacts`) and the reader (`emitAgentArtifacts`) resolve from the SAME `config.outputs.*` keys via `resolveMaybeAbsolute(repoRoot, ...)`. No hardcoded constants remain in `sync-core.mjs`.
- **FR-5**: The `PipelineOverview` React component renders 10 stage chips in canonical order with click-to-filter behavior (single-select replace) and shows an empty-state message when Ralph state is empty.
- **FR-6**: A canonical `RALPH_STAGE_ORDER` constant lives in `tools/overview-viewer/src/utils/ralphStages.ts` and is imported by both `Toolbar.tsx` and `PipelineOverview.tsx` (no duplicate stage lists).
- **FR-7**: The `load-prds-by-task-id.mjs` helper walks BOTH `.ralph/jobs/*/prd.json` and `.ralph/job-groups/*/*/prd.json` (two-level glob for group members) and preserves `userStories[].passes` + PRD-level `dependencies` in the returned carrier.
- **FR-8**: `scoreRecommendations` is a pure function — no fs, no console, no `Date.now()` outside an injectable `now` parameter.
- **FR-9**: `deriveDependencyGraph` produces story nodes with globally unique composite ids `${taskId}:${storyId}`; the `from`/`to` edge convention is dependent → prerequisite for ALL edge types.
- **FR-10**: `atomicWriteFile` is exported from `scripts/lib/atomic-write.mjs`; both `sync-core.mjs` and `emit-derived-artifacts.mjs` import from there (breaks circular import per F-013).
- **FR-11**: The static-build size (`plans/overview.html`) does not exceed 526,372 bytes after US-005 lands.
- **FR-12**: The US-006 parallel-safety scan excludes the current job directory `ralph-pipeline-04-pipeline-overview-v2` so it does not self-detect as a concurrent peer.

## 5. Non-Goals (Out of Scope)

- Snapshot file `plans/overview-snapshot.json` and activity tail — owned by Plan 05 (already shipped).
- `/triage` skill that consumes recommendations — Plan 06.
- MCP `overview.list_recommendations` / `overview.dependency_graph` tools — Plan 09.
- A detail dialog showing the full DAG. **No tooltip DAG** either (F-010 removed it). The JSON export is enough for downstream consumers.
- Option A `prdsByTaskId` carrier (derive in `assembleStateFromBundles` and thread through `deriveAffectedTaskUpdate` / `mergeAndWrite`) — deferred as a future optimization. v1 uses Option B (lazy fs read inside `emitDerivedArtifacts`).
- Auto-population of `OverviewTask.blocks` — bookkeeper-edited only.
- Mutating `OverviewData.runs` from sync — the sync only computes `runDurations` for the snapshot, never edits hand-curated data.
- Editing the preserved v1 branch `ralph-pipeline-04-pipeline-overview` (HEAD `896872c3`). It branched from a stale base and is unsalvageable. Use ONLY as design inspiration (scoring rubric weights, edge categorization, component structure). Do NOT rebase, cherry-pick, or `--allow-stale-base`. The v2 worktree must fork from current main (HEAD `fc27ba86` or later); the plugin v5.40.0+ branch-base freshness check will abort otherwise.

## 6. Design Considerations

- **PipelineOverview UI**: horizontal flex of 10 chip buttons; reuse `.ralph-stage-chip.stage-*` color classes from existing Toolbar styling where possible.
- **Single-select vs multi-select**: the histogram is single-select REPLACE (triage UX: "show me this one stage"); the Toolbar filter group is multi-select TOGGLE (power filtering). Both write to the same `filters.ralphStage` set, so they stay co-evolved.
- **Empty state**: a first-time user opening the dashboard with no `.ralph/` directory should see a clear empty-state message instead of broken zero-count chips.
- **Stage order canonicalization**: extract `RALPH_STAGE_ORDER` to `tools/overview-viewer/src/utils/ralphStages.ts`. Both `Toolbar.tsx` and `PipelineOverview.tsx` import it; tests assert length=10.

## 7. Technical Considerations

- **CRITICAL emission order**: `emitDerivedArtifacts` runs inside `writeSidecar` BEFORE `emitAgentArtifacts`. The latter reads `overview-recommendations.json` and `overview-dependency-graph.json` from disk; running it before derived emission gives a 1-cycle staleness lag. (F-001 / F-007.)
- **Hardcoded path constants** at `sync-core.mjs:38-39` (`PLAN_04_RECOMMENDATIONS_PATH`, `PLAN_04_DEPENDENCY_GRAPH_PATH`) must be removed; replace with `config.outputs.*` reads via `resolveMaybeAbsolute`. (F-003.)
- **Circular-import risk**: `sync-core.mjs` imports `emit-derived-artifacts.mjs`; the latter would import `atomicWriteFile` from `sync-core.mjs`. Break the cycle by extracting `atomic-write.mjs` and having both files import from there. (F-013.)
- **`OverviewData.spawnedFrom` is a top-level map** (`Record<childTaskId, parentTaskId>`), NOT a per-task field. The original Plan 04 markdown said "OverviewTask.spawnedFrom" — stale.
- **Story node uniqueness**: PRDs across multiple tasks all reuse `US-001`/`US-002`/... — story node ids in the dep graph MUST be composite `${taskId}:${storyId}` or two distinct stories will collapse into one node. (F-005.)
- **PRD carrier completeness**: `load-prds-by-task-id.mjs` MUST preserve `userStories[].passes` (consumed by `scoreRecommendations` for dep state) AND PRD-level `dependencies` (consumed by `deriveDependencyGraph` for the `depends-on-task` fallback). (F-002.)
- **Group member PRD path**: `.ralph/job-groups/<group>/<member>/prd.json` (TWO levels under `job-groups`), not `<group>/prd.json`. The helper needs a two-level glob. (F-004.)
- **`OverviewTask.priority` field gap**: the field referenced by the rubric does not currently exist on `OverviewTask`. US-001 adds it as `priority?: number` with a 0.5 fallback for missing/non-numeric values. (F-006.)
- **Recommendation file shape mismatch**: the recommendations file is `{ recommendations, ... }` (wrapped); the snapshot embeds the unwrapped array. The freshness AC compares `snapshot.recommendations` to `recommendations-file.recommendations`. The graph file is unwrapped (matches `unwrapDependencyGraph` at `sync-core.mjs:370`). (F-007.)
- **runDurations precision**: key = `runId` matching `OverviewData.runs[].id`; value = hours rounded to 1 decimal. (F-014.)
- **Edge direction convention**: dependent → prerequisite for ALL edge types. Document in `derive-dependency-graph.mjs` JSDoc; assert in US-003 tests. (F-015.)
- **PRD parse failures**: `load-prds-by-task-id.mjs` MUST log+skip malformed PRDs, never throw (would halt the watcher). (F-016.)
- **Branch base freshness**: the v2 worktree must fork from current main (HEAD `fc27ba86` or later). Plugin v5.40.0+ freshness check will abort otherwise. Do NOT use `--allow-stale-base`.

## 8. Success Metrics

- A user opens `pnpm overview` and identifies the most-loaded stage in ≤ 1 second (vs ~10s scanning row chips).
- `jq '.recommendations[0:5]' plans/overview-recommendations.json` returns 5 entries sorted by score descending, each with `{ taskId, score, stage, reasons }`.
- `jq '.edges | length' plans/overview-dependency-graph.json` returns ≥ 1 for the current repo (which has spawnedFrom + PRD deps populated).
- `diff <(jq '.recommendations' plans/overview-snapshot.json) <(jq '.recommendations' plans/overview-recommendations.json)` returns empty after a single `pnpm sync-ralph-state` run.
- `jq '.runDurations' plans/overview-snapshot.json` returns a non-empty object after at least one Ralph cycle completes; `jq '.runDurations' plans/overview-ralph-state.json` returns null/missing.
- `wc -c plans/overview.html` ≤ 526,372 bytes after US-005 lands.

## 9. Open Questions

- **[INFERRED]** `prdsByTaskId` carrier: chose Option B (lazy fs read inside `emitDerivedArtifacts`). Option A (derive in `assembleStateFromBundles` and thread) deferred as future optimization. Confidence: high — ~18 tasks, cost is negligible.
- **Plugin PRD schema field names**: implementer verifies in US-001 by inspecting `C:/Users/evmitran/.claude/plugins/cache/ai-developer-toolkit/ralph-orchestration/5.41.0/schemas/prd-schema.json`. If PRD-level `dependencies` is absent from the schema, the `depends-on-task` fallback in US-003 is dropped. Confidence: medium.
- **`emitAgentArtifacts` overviewData re-emission**: after hoisting `loadOverviewData` to `writeSidecar`, the existing `outputs.dataJson` re-emission must remain byte-identical. US-004 implementer verifies via a regression test (compare pre/post output bytes against a fixture). Confidence: high.

## 10. Autonomous Mode Decisions

This PRD was generated by Phase 2 of `/implement-with-ralph --autonomous` on 2026-05-19. The following defaults were applied without user interaction (logged here per global instructions):

- **Branch:** `ralph-pipeline-04-pipeline-overview-v2`, created NEW, forked from current `main` (HEAD `fc27ba86`). NOT forked from the preserved v1 branch `ralph-pipeline-04-pipeline-overview` (stale base).
- **Story review:** auto-approved 6 stories US-001..US-006 (no edits applied).
- **`iterationEngine`:** `codex` (forced by orchestrator args).
- **`planningEngine`:** `codex` (forced by orchestrator args).
- **`codexReview` / `copilotReview`:** both `always` (forced by orchestrator args; recorded in job-state, not in `prd.json` schema).
- **Worktree:** `D:/harness-efforts/codexu/.ralph/jobs/ralph-pipeline-04-pipeline-overview-v2/worktree/`.
- **`additionalDirs`:** none added — the plan + research already capture the codebase context; no out-of-tree docs directory is relevant.
- **planReviewContext:** 7 High consensus findings F-001..F-007 (carried verbatim). 13 Medium findings (F-008..F-019, F-024) are NOT in `planReviewContext` (classification is `null`, treated as `"fixable"` per the convert-to-ralph-prd contract) but ARE folded into individual story acceptance criteria above. 4 Low findings (F-020..F-023) are also folded into story ACs.
