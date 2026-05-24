# Architect Analysis — Plan 04 v2 (Pipeline Overview)

## 1. INTEGRATION POINTS

**Two exact call sites for `emitDerivedArtifacts()` (new helper):**

(a) Watcher path — `scripts/lib/watch-ralph-state.mjs` line 135–148:
- After `mergeAndWrite()` returns successfully (line 135)
- Inside the lock window, before activity append (line 142–148)
- Call signature: `await emitDerivedArtifacts({ repoRoot: absoluteRepoRoot, config, state: result.state, generatedFromCommit })`
- Activity events are appended AFTER this call completes

(b) One-shot CLI path — `scripts/sync-ralph-state.mjs` line 36–64:
- After `writeSidecar()` returns (line 47)
- Before activity append (line 49–60)
- Same call signature

**Frontend integration:** `tools/overview-viewer/src/App.tsx` — render `<PipelineOverview>` between `<Toolbar>` (line 9) and `<Kanban>` (line 5). Thread `filters`, `setFilters`, `ralphState` from existing hooks.

## 2. `prdsByTaskId` CARRIER — Compute lazily inside `emitDerivedArtifacts()`

Rationale: only consumed by Plan 04 helpers, not by core Ralph state pipeline. Keeps OverviewRalphState clean. `assembleStateFromBundles()` (line 92–143 in sync-core.mjs) has NO knowledge of PRDs; Plan 04 owns that dependency.

```javascript
async function emitDerivedArtifacts({ repoRoot, config, state, generatedFromCommit }) {
    const prdsByTaskId = loadPrdsByTaskId(repoRoot, state.byTaskId)
    const recommendations = scoreRecommendations({ byTaskId: state.byTaskId, overviewData, prdsByTaskId, config })
    const dependencyGraph = deriveDependencyGraph({ byTaskId: state.byTaskId, overviewData, prdsByTaskId, generatedFromCommit })
}
```

## 3. Snapshot.runDurations CONTRACT

**Existing contract in emit-snapshot.mjs line 1–31:**
```javascript
export function buildSnapshot({
    ralphState,
    overviewData,
    recommendations = [],
    dependencyGraph = { nodes: [], edges: [] },
    runDurations = {},  // ALREADY HERE, Plan 05 owns it
    generatedFromCommit,
})
```

**RECOMMEND:** `emitDerivedArtifacts` accepts an optional `runDurations` param:
```javascript
async function emitDerivedArtifacts({ repoRoot, config, state, generatedFromCommit, runDurations = {} })
```

Watcher/CLI does NOT compute it; they pass `{}` or an explicitly-supplied value. Plan 05 (or later plan) adds computation.

NOTE: Architect notes that buildSnapshot ALREADY accepts `recommendations` and `dependencyGraph`. So Plan 04 must INJECT these into the snapshot build, not emit them as separate JSON files only. Reconcile during planning: confirm Plan 05's `emit-snapshot.mjs` parameter list AND decide whether Plan 04 ALSO emits separate JSON sidecars for viewer consumption.

## 4. `emitDerivedArtifacts` SIGNATURE & ATOMICITY

```javascript
export async function emitDerivedArtifacts({
    repoRoot,
    config,
    state,
    generatedFromCommit,
    runDurations = {}
}) {
    // 1. Load overview data and PRDs
    // 2. scoreRecommendations(...)
    // 3. deriveDependencyGraph(...)
    // 4. atomic writes (reuse exported atomicWriteFile):
    //    - plans/overview-recommendations.json
    //    - plans/overview-dependency-graph.json
}
```

Use existing `atomicWriteFile()` exported from sync-core (line 419). Two separate atomic writes — not transactional across both; acceptable since downstream reads tolerate missing files.

## 5. SCORE RECOMMENDATIONS RUBRIC (fresh, do not copy)

| Dimension | Weight | Scoring Logic |
|-----------|--------|---------------|
| Stage urgency | 40 | Review-fix=1.0 → shipped=0.0 (map STAGE_URGENCY const) |
| Dependency blockers | 30 | Unblocked=1.0, partial=0.5, blocked=0.0 |
| Freshness | 20 | Linear decay 1.0 (≤1 day) → 0.0 (≥14 days) from `lastUpdatedAt` |
| Priority | 10 | OverviewTask.priority normalized 0–1, else 0.5 |

Overrideable via `config.recommendations.weights` in `.ralph/overview-config.json`. Default `topN = 20`.

Output:
```typescript
export interface Recommendation {
    taskId: string
    score: number        // [0, 1] normalized
    stage: RalphStage
    reasons: string[]    // top 2-3 contributing factors
}
```

## 6. DEPENDENCY GRAPH SCHEMA

```typescript
export interface DependencyGraph {
    nodes: Array<{
        id: string
        type: 'task' | 'story'
        taskId?: string      // parent if type=story
        storyId?: string
        stage?: RalphStage
    }>
    edges: Array<{
        source: string
        target: string
        type: 'blocks' | 'depends-on-story' | 'spawn' | 'depends-on-task'
    }>
}
```

Include in priority: (1) PRD→PRD dependencies via userStories[].dependencies[], (2) Task→Task spawn via OverviewTask.spawnedFrom, (3) Task→Task block via OverviewTask.blocks[].

## 7. PARALLEL-SAFETY & CASCADE DEFERRAL

Detect concurrent Ralph jobs before editing shared plan files:
```bash
ls -1 .ralph/jobs/*/job-state.json | while read f; do
  status=$(jq -r '.status' "$f")
  terminal=$(jq -r '.orchestrator.terminal // false' "$f")
  if [ "$status" = "RUNNING" ] && [ "$terminal" != "true" ]; then
    echo "CONCURRENT JOB DETECTED: $f"
    break
  fi
done
```

If concurrent, append cascade entries to `notepad.md ## Deferred Cascade` instead of editing shared plan files.

## 8. RISKS & COMMON MISTAKES

1. Watcher / CLI drift — both paths must call emitDerivedArtifacts identically (shared integration test).
2. Snapshot.runDurations timing — `runDurations = {}` default safe.
3. Schema drift between PipelineOverview.tsx props and emitted JSON.
4. Old branch as temptation — DO NOT rebase/cherry-pick; design reference only.
5. Config precedence — `.ralph/overview-config.json` with fail-safe defaults.

## 9. TEST STRATEGY

1. `scripts/lib/score-recommendations.test.mjs` — synthetic byTaskId/overviewData, 4-dim scoring, weight override, topN, edge cases.
2. `scripts/lib/derive-dependency-graph.test.mjs` — synthetic PRDs, node/edge counts, acyclicity detection.
3. `scripts/lib/emit-derived-artifacts.test.mjs` — mock fs+config, atomic JSON writes, no watcher/CLI drift.
4. `tools/overview-viewer/src/__tests__/pipelineOverview.test.tsx` — RTL: mock state, render histogram, click chip filter toggle, empty state.
5. `tools/overview-viewer/src/__tests__/pipelineOverviewIntegration.test.mjs` — run sync-ralph-state, assert both JSON files exist and parse as Recommendation[]/DependencyGraph.

## 10. STORY DECOMPOSITION (6 stories)

- **US-001**: Foundation — `prdsByTaskId` carrier + Recommendation/DependencyGraph/OverviewTask.blocks types
- **US-002**: scoreRecommendations + unit tests (4-dimension rubric, weight override)
- **US-003**: deriveDependencyGraph + unit tests (task/story nodes, three edge types, DAG)
- **US-004**: emitDerivedArtifacts + wire into BOTH watcher and CLI paths after writeSidecar
- **US-005**: PipelineOverview.tsx + App.tsx slot-in + CSS + RTL tests
- **US-006**: Cascade audit — refresh downstream plans 06, 07, 08, 09, 12, INDEX (defer via notepad.md if concurrent)

## SIGNATURES (existing code)

```javascript
// sync-core.mjs line 238
export async function mergeAndWrite({ repoRoot, config, currentState, updates, generatedFromCommit })
// Returns: { state, writtenAt, changedTaskIds, activityEvents }

// sync-core.mjs line 350
export async function writeSidecar({ repoRoot, config, state })

// sync-core.mjs line 419
export async function atomicWriteFile(finalPath, contents)

// emit-snapshot.mjs line 1
export function buildSnapshot({ ralphState, overviewData, recommendations, dependencyGraph, runDurations })

// watch-ralph-state.mjs line 135
const result = await mergeAndWrite({ ... })
```

## EXPLICIT DO-NOT-DO

1. DO NOT add `runDurations` to OverviewRalphState — Plan 05 owns it on Snapshot
2. DO NOT rebase/cherry-pick the old branch
3. DO NOT bypass atomic writes — use atomicWriteFile
4. DO NOT compute prdsByTaskId in assembleStateFromBundles — lazy in emitDerivedArtifacts
5. DO NOT edit Plans 06–12 sync if concurrent — defer to notepad.md
6. DO NOT hardcode stage/weight constants — .ralph/overview-config.json
7. DO NOT forget empty-state message
8. DO NOT call scoreRecommendations at React render time — bake into JSON
