# Stories Outline: Pipeline Overview — Aggregate Histogram + Recommendations + Dependency Graph

*Preliminary decomposition from `/plan-with-ralph`. Feed to `/implement-with-ralph --from-plan` for PRD generation.*

## US-001: Add types + fields
**Description:** As an implementer, I want the new types (`Recommendation`, `DependencyGraph`, `DependencyNode`, `DependencyEdge`) and field additions (`OverviewTask.blocks?`, `OverviewTask.priority?`, `OverviewRalphState.runDurations?`) declared in `tools/overview-viewer/src/types.ts` so downstream stories can import them without conflict.
**Acceptance Criteria:**
- [ ] `Recommendation`, `DependencyGraph`, `DependencyNode`, `DependencyEdge` declared in `types.ts`.
- [ ] `OverviewTask` has optional `blocks: string[]` and `priority: number`.
- [ ] `OverviewRalphState` has optional `runDurations`. (Do NOT add `aggregateStages?` — derived client-side; per F-012.)
- [ ] `pnpm --filter @codexu/overview-viewer typecheck` passes.
- [ ] Before opening PR: `git fetch origin main && git rebase origin/main`; if Plan 05 has merged and `runDurations` moved to `Snapshot`, relocate this change per the plan's Risk Areas guidance.
**Dependencies:** None
**Estimated complexity:** small

## US-002: Config plumbing for recommendations + output paths
**Description:** As an implementer, I want `.ralph/overview-config.schema.json`, `scripts/lib/default-config.mjs`, `scripts/lib/default-config.d.mts`, and `scripts/lib/resolve-config.mjs` extended with `outputs.recommendationsJson`, `outputs.dependencyGraphJson`, and a `recommendations` block (with `topN` and `weights`) so downstream stories can read configured paths and weights.
**Acceptance Criteria:**
- [ ] Schema admits the new keys (preserve `additionalProperties: false` discipline).
- [ ] Defaults: `outputs.recommendationsJson = "plans/overview-recommendations.json"`, `outputs.dependencyGraphJson = "plans/overview-dependency-graph.json"`, `recommendations.topN = 20`, `weights = { stageUrgency: 40, dependencyState: 30, freshness: 20, priority: 10 }`.
- [ ] `resolve-config.mjs` resolves the two new output paths to absolute paths under `repoRoot`.
- [ ] `.ralph/overview-config.json` (the committed file) updated in place to add the `recommendations` block — do NOT recreate the file (per F-009).
- [ ] Existing `tools/overview-viewer/src/__tests__/config.test.ts` still passes; extend it (or add `scripts/lib/resolve-config.test.mjs`) to assert the resolved absolute paths and default weights (per F-010).
- [ ] Pre-PR rebase check (same as US-001).
**Dependencies:** None
**Estimated complexity:** small

## US-003: `scoreRecommendations` pure module
**Description:** As an implementer, I want a pure `scoreRecommendations({ byTaskId, overviewData, prdsByTaskId, config? }) → Recommendation[]` module under `scripts/lib/score-recommendations.mjs` with adjacent `.d.mts` and tests, so sync-core can derive a ranked list at write time.
**Acceptance Criteria:**
- [ ] Implements scoring rubric: `stageUrgency` per stage map, `dependencyState` from PRD `userStories[].dependencies[]` + `passes` (unblocked/partial/blocked/no-PRD), `freshness` linear decay over 14 days using `lastUpdatedAt`, `priority` from `OverviewTask.priority` or 0.5 fallback.
- [ ] Output sorted descending; default top 20 (configurable via `config.topN`).
- [ ] Each `Recommendation`: `{ taskId, score, stage, reasons: string[] }` with the 2–3 strongest contributing factors as human-readable strings.
- [ ] `scripts/lib/score-recommendations.d.mts` declares the export.
- [ ] `scripts/lib/score-recommendations.test.mjs` (vitest) covers: stage urgency mapping, dependency state (unblocked/partial/blocked/missing-PRD), freshness decay, priority fallback, weight overrides, top-N truncation.
**Dependencies:** US-001, US-002
**Estimated complexity:** medium

## US-004: `deriveDependencyGraph` pure module
**Description:** As an implementer, I want a pure `deriveDependencyGraph({ generatedAt, generatedFromCommit, overviewData, byTaskId, prdsByTaskId }) → { generatedAt, generatedFromCommit, nodes, edges }` module under `scripts/lib/derive-dependency-graph.mjs` with adjacent `.d.mts` and tests, so the dep-graph artifact can be emitted.
**Acceptance Criteria:**
- [ ] Nodes carry `{ id, kind: 'task' | 'story', taskId, storyId?, stage? }`. Story node IDs use the namespaced form `${taskId}:${storyId}`.
- [ ] Edge kinds: `spawn` (from `overviewData.spawnedFrom`), `blocks` (from `OverviewTask.blocks`), `depends-on-story` (from PRD `userStories[].dependencies[]`).
- [ ] Output's `generatedAt` and `generatedFromCommit` come from the input arguments (the Ralph sidecar state), NOT from `overviewData`.
- [ ] Cycle detection: emit a `process.stderr.write` warning; do not throw.
- [ ] `scripts/lib/derive-dependency-graph.d.mts` declares the export.
- [ ] `scripts/lib/derive-dependency-graph.test.mjs` (vitest) covers each edge kind, cycle warning, namespaced story IDs, and explicit sidecar-metadata passthrough.
**Dependencies:** US-001
**Estimated complexity:** medium

## US-005: State enrichment in `sync-core.mjs`
**Description:** As an implementer, I want `assembleStateFromBundles` extended to build `prdsByTaskId` from matched bundles and compute `state.runDurations` (keyed by `run.id`, only when both `createdAt` and `completedAt` exist) so that downstream emission has all the data it needs and `writeSidecar` serializes a complete sidecar payload. `deriveAffectedTaskUpdate` / `mergeAndWrite` must propagate the same enrichment on incremental updates.
**Acceptance Criteria:**
- [ ] `assembleStateFromBundles` returns enriched state with `runDurations` and a non-persisted `prdsByTaskId` carrier (in a return-tuple or attached to an in-memory state object — not serialized to the sidecar).
- [ ] `deriveAffectedTaskUpdate` / `mergeAndWrite` recompute or propagate `runDurations` and `prdsByTaskId` for incremental updates so the watcher path stays consistent with one-shot.
- [ ] `state.runDurations` is populated BEFORE `writeSidecar` runs.
- [ ] Tests assert one-shot and incremental paths produce equivalent enriched state.
- [ ] Pre-PR rebase check (same as US-001).
**Dependencies:** US-003, US-004
**Estimated complexity:** medium

## US-006: `emitDerivedArtifacts` helper + `writeSidecar` hook
**Description:** As an implementer, I want a shared `emitDerivedArtifacts({ repoRoot, config, recommendations, dependencyGraph })` helper called after every `writeSidecar` invocation (one-shot, watcher cold-start, watcher incremental) so both derived artifacts are emitted atomically wherever the sidecar is written.
**Acceptance Criteria:**
- [ ] `scripts/lib/sync-core.mjs` exports `atomicWriteFile`.
- [ ] `sync-core.mjs` calls `scoreRecommendations(...)` and `deriveDependencyGraph(...)` once with `prdsByTaskId` from US-005; results are passed to `emitDerivedArtifacts` after `writeSidecar` resolves.
- [ ] Both `plans/overview-recommendations.json` and `plans/overview-dependency-graph.json` are written via `atomicWriteFile` (tmp + fsync + rename) on every sidecar-write path.
- [ ] `writeSidecar` signature stays `{ repoRoot, config, state }` — it does NOT receive `overviewData` or PRDs.
- [ ] New sync-core test exercises the one-shot CLI path and asserts both files appear with valid JSON shapes.
**Dependencies:** US-005
**Estimated complexity:** medium

## US-007: `PipelineOverview.tsx` component + CSS
**Description:** As a user, I want a horizontal histogram of stage chips between Toolbar and Kanban so I can see the pipeline shape at a glance and click a chip to filter.
**Acceptance Criteria:**
- [ ] `tools/overview-viewer/src/components/PipelineOverview.tsx` renders 10 stage chips in canonical `RALPH_STAGE_ORDER` with `<stage> · <count>` labels.
- [ ] Counts derived client-side from `ralphState.byTaskId` (no dependency on a precomputed `aggregateStages` field).
- [ ] Empty state when total count is 0 OR `ralphState === null`.
- [ ] Click handler: if `filters.ralphStage.has(stage)`, clear; else replace with `new Set([stage])` (single-select on this surface).
- [ ] `RALPH_STAGE_ORDER` exported from `tools/overview-viewer/src/utils/ralphStages.ts` (or re-exported from `PipelineOverview.tsx`) for shared use.
- [ ] `tools/overview-viewer/src/styles.css` extended with `.pipeline-overview`, `.pipeline-overview-empty`, hover/active/focus states.
**Dependencies:** US-001
**Estimated complexity:** medium

## US-008: `App.tsx` integration + HMR check
**Description:** As a user, I want the histogram visible on page load and updated via HMR when the watcher emits new state.
**Acceptance Criteria:**
- [ ] `tools/overview-viewer/src/App.tsx` renders `<PipelineOverview ralphState={ralphState} filters={filter.activeFilters} setFilters={filter.setFilters} />` between `<Toolbar />` and `<Kanban />`.
- [ ] Existing `overview-ralph-state:update` HMR handler still refreshes `ralphState`; the histogram re-renders without page reload.
- [ ] `pnpm overview` boots; manual smoke test confirms histogram + click-to-filter behave per US-007 ACs.
**Dependencies:** US-007
**Estimated complexity:** small

## US-009: Tests, end-to-end, and downstream-plan refresh
**Description:** As a maintainer, I want full feature verification plus refreshed downstream plan markdown so Plans 05/06/09 and the INDEX reflect what shipped.
**Acceptance Criteria:**
- [ ] `tools/overview-viewer/src/__tests__/interactions/pipelineOverview.test.tsx` covers: histogram count rendering, click-to-filter (replace + clear), empty-state branch, multi-select coexistence with toolbar filter group. (Lives under `interactions/` per F-013 so jsdom + userEvent are available.)
- [ ] `pnpm --filter @codexu/overview-viewer typecheck` and `pnpm --filter @codexu/overview-viewer test` both pass.
- [ ] `pnpm sync-ralph-state` (one-shot) emits both artifacts; verify via `jq` checks per Verification A.
- [ ] `pnpm overview:build` regenerates `plans/overview.html` and the file is < 512000 bytes; the regenerated file is committed in this story.
- [ ] Audit and refresh `plans/ralph-pipeline-05-*.md`, `plans/ralph-pipeline-06-*.md`, `plans/ralph-pipeline-09-*.md`, and `plans/ralph-pipeline-INDEX.md` for stale references.
- [ ] Create `plans/ralph-pipeline-04-refresh-changelog.md` listing each downstream-plan diff (file, lines, what changed). Commit this file + the updated plans in the same final commit (per F-008).
- [ ] No existing tests broken across the repo.
**Dependencies:** US-007, US-008, US-006 (sync-integration end-to-end)
**Estimated complexity:** large
