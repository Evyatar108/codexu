# Research Brief — ralph-overview MCP lifecycle-first sync-on-read (D-001)

All paths under `ai-developer-toolkit/plugins/ralph-overview/` (read from the MAIN
codexu checkout; the plan worktree has uninitialized submodules).

## Researcher Findings

### parallel-ready-tasks.ts (the file to change)
- `parallelReadyTasks()` entry: lines 102-140.
- Candidate construction: `snapshot.tasks.filter((t) => isCandidateStage(t, stageFilter))` at **119**.
- `tasksById = new Map(snapshot.tasks.map(...))` at **114** — used for prereq resolution.
- `isCandidateStage()` at **162-168**: `stage = task.ralph?.stage ?? task.initialStage`; returns false if no stage or `EXCLUDED_STAGES.has(stage)`; else respects `stageFilter`. **NEVER checks `task.lifecycle`** — THE BUG.
- `EXCLUDED_STAGES = {shipped, replan-pending, blocked}` at **22**.
- `isTaskReady()` 170-187 → `taskPrerequisitesSatisfied()` 189-204 (uses `graph.edges` + `BLOCKING_EDGE_TYPES={depends-on-task,depends-on-story,blocks}`); `storyPrerequisitesSatisfied()` 206-217; `prerequisiteSatisfied()` 219-224 (checks `tasksById.get(nodeId)?.ralph?.stage === 'shipped'`); `storyNodeSatisfied()` 226-235; `isStorySatisfied()` 237-239 (`passes===true|'true' || status==='done'`).
- `toReadyTask()` 241-256: builds `{taskId,title,stage,command,readyBecause,cluster?,fileOverlapRisk?}`; `stage = task.ralph?.stage ?? task.initialStage`; `command = deriveNextCommand(task.ralph, task, {repoRoot})`.
- `computeSnapshotStaleSince()` 338-354: collects mtimes of `dataFile` + each task's job-state.json/group.json; returns ISO of the min mtime newer than snapshot mtime, else null. (Already computes data.json-vs-snapshot staleness — only needs to be ELEVATED into a surfaced reason + age.)
- `ParallelReadyTasksResult` 74-81: `{readyTasks, totalReady, totalActionable, curatorConflicts?, snapshotStaleSince?, watcherFailure?}`. No Zod output schema enforced (schemas.ts only enforces `watcher_status` output) → **result fields are additive / non-breaking**.
- PRD memo: `loadMemoizedPrds()` 151-160, keyed by snapshot mtime; `prdMemoByContext` WeakMap.
- Missing-snapshot today: **hard fail** `{ok:false,error:'missing snapshot'}` at 108-110.

### snapshot-reader.ts
- `getOverviewData()` 84-98: returns `OverviewData | null` via `loadOverviewData(dataFile)` (from `scripts/lib/sync-core.mjs`). **Cached** in `#overviewData` slot; invalidated only by the in-process chokidar watcher started in `start()` (36-58, `usePolling:true, interval:50`, watches snapshot+dataFile+sidecar). No mtime self-check today.
- `getSnapshot()` 68-82 (cached, same pattern). `getSidecarDiagnostics()` 100-117.
- `readWithRetry()` 133-166: 3 attempts, falls back to previous cached value or null on parse failure.

### Reference pattern: expand-task-context.ts (NOT unblock-candidates)
- `expandTaskContext()` 72-: calls `getOverviewData()` (**76**), `overviewData.tasks` (**81**), finds task by id, returns `{ok:false,error:'missing .ralph-overview/data.json'}` when data absent (77-79). Then `getSnapshot()` (**94**) + `resolveStage(snapshot, taskId)` (**95**) for ENRICHMENT. This is the canonical lifecycle-first + snapshot-overlay pattern to mirror.
- CORRECTION to seed: `unblock-candidates.ts` does NOT read data.json lifecycle — it filters `snapshot.tasks` on the derived `task.unblockCandidate===true` flag (40-49). So it is snapshot-only, not the reference pattern.

### Types (overview-viewer/src/types.ts, re-exported by overview-mcp/src/types.ts)
- `OverviewTask` 42-61: `id; scope?; lifecycle?(string); phase?(@deprecated alias); status?; lastTouchedAt?; planOnly?; shipManifest?; blocks?; blockedOn?(string[]); members?; initialStage?(RalphStage); priority?; kanbanCards?; command?`.
- `OverviewCommand` 6-17: `{name?, descriptionHtml, warnings?, prompts?:{brainstorm?,plan?,impl?}, planPrompt?(@deprecated)}`.
- `RalphStage` 63-73 (10 values incl. shipped/blocked).
- `OverviewData` 288-309: `{generatedAt?, tasks?:OverviewTask[], ..., ui?}`.
- **`SnapshotTask extends OverviewTask { ralph?: RalphPipelineState; unblockCandidate?: boolean }`** (345-348). KEY: a SnapshotTask IS an OverviewTask plus `ralph`. snapshot.tasks already carry data.json fields merged at sync time — which is why STALE lifecycle leaks through the snapshot.
- `DependencyGraph` 330-343: `nodes[]`, `edges[]{from,to,type: blocks|depends-on-story|spawn|depends-on-task}`. Orientation: edge from dependent→prerequisite; `blocks` = blocked→blocker.
- `NextCommand` 324-328: `{label, command, icon?}`.

### derive-next-command.mjs
- `deriveNextCommand(state, task, options)` 18-95. When `state`(ralph) absent → `deriveInitialStageCommand(task)` 97-112: maps `task.initialStage` → promptKey (114-127: brainstorming→brainstorm; planning/brainstorm-ready→plan; plan-ready/implementing→impl), resolves `resolveTaskPrompt(task, promptKey)`, returns `{label,command,icon}` or null. ⇒ a snapshot-absent data.json task with `initialStage` + `command.prompts` STILL yields a kickoff command.

### Tests
- `__tests__/parallel-ready-tasks.test.ts`: fixture helpers — `createContext()` (320), `snapshot(tasks,depGraph?)` (324), `task(id,stage,ralph?)` (339), `writePrd()` (352), `writeSidecar()` (358), `taskIds(result)` (362), `readyTask(result,id)` (366), `setMtime()` (370), `readOptional()` (375).
- `__tests__/helpers.ts`: `makeContext()` (142-158) builds ServerContext+SnapshotReader; `setupTempRoot()` (164); `writeFixtureConfig()` (93-140) → RalphOverviewConfig with `.ralph-overview/generated/*` outputs; `writeOverviewData()` (77-87) **writes data.json**; `writeSnapshot()` (73-75).
- ⇒ Tests can write a FRESH data.json + an OLDER snapshot and use `setMtime()` to assert staleness behavior — exactly the fixtures D-001 needs.

### schemas.ts
- `parallelReadyTasksInputSchema = {limit?, stageFilter?}` (33-36). Unchanged. No output schema on the tool ⇒ result additions are safe.

### Build / test
- plugin root `package.json`: `build`, `test`, `test:lib`, `typecheck`. Root `npm test` runs Vitest `--no-file-parallelism --maxWorkers=1` (Windows watcher-race safe).
- overview-mcp `package.json`: `build` (tsc+cpSync flatten), `typecheck`, `test`.

### load-prds-by-task-id.mjs
- Loads PRD carriers (`{userStories[], dependencies?}`) keyed by overview task id from `.ralph/jobs/*/prd.json` + `.ralph/job-groups/*/*/prd.json`; also loads overview data to enumerate task ids.

## Architect Analysis (key points)
- Pivot `parallelReadyTasks` to: `getOverviewData()` → authoritative `overview.tasks` → lifecycle gate → overlay snapshot `ralph` by id → readiness → result. Refactor `isCandidateStage`, `toReadyTask`, `computeSnapshotStaleSince`, and the prereq lookups.
- Merge model: base = data.json OverviewTask; enrichment = snapshot.ralph by id. Snapshot-absent task → ralph undefined; conservative readiness; flag with an additive `stageSource`/`enrichment` marker on ReadyTask (non-breaking, ReadyTask has no output schema).
- Envelope: add `snapshotAgeMs?` = now − snapshotMtimeMs, `snapshotStaleReason?` (human string). Additive.
- Prereq resolution must build `tasksById` from the MERGED set; a prereq present only in data.json (merged) should count as satisfied even when snapshot stage is stale.
- Perf: getOverviewData already cached/invalidated; stays sub-second; no full sync.

## Codex Research (xhigh)
- Corroborates the snapshot-first bug and lifecycle-first fix shape.
- **Reuse `scripts/lib/task-aliases.mjs`: `resolveTaskLifecycle(task)` + `resolveTaskPrompt(task,key)`** as the alias-safe readers (handles legacy `phase`/`planPrompt`).
- `sync-core.mjs loadOverviewData()` normalizes legacy `phase`→`lifecycle`, `planPrompt`→`command.prompts.plan`, and derives `initialStage` from prompts (verified at sync-core.mjs:868-886; `mapLegacyPhaseToLifecycle` maps `shipped→merged`, `closed→archived`, `plan-ready→tracked`).
- **`loadPrdsByTaskId({repoRoot,config,overviewData})` already accepts `overviewData`** (load-prds-by-task-id.mjs:16,23) — pass the loaded data to avoid parsing data.json twice in one call.
- `derive-dependency-graph.mjs`: edge dependent`from`→prerequisite`to`; `blockedOn` becomes a `blocks` edge.
- **Performance probe (real codexu data.json, 180 tasks, 20 runs): ~6.4ms min / 7.1ms median / 10.1ms max.** Disconfirms the brainstorm's "not sub-second" disproof — lifecycle read is ~7ms.
- Suggests: candidate source = `overviewData.tasks`; overlay `{...dataTask, ralph: snap?.ralph, unblockCandidate: snap?.unblockCandidate}`; snapshot-absent → `awaitingSync`/`stageSource` caveat; missing snapshot → continue with empty enrichment + warning.

## Copilot Research (xhigh)
- Same conclusions. **Explicit warning: do NOT spread the stale snapshot task over the data task** — that would reintroduce stale lifecycle/prompts/initialStage. Base must be the data.json task; overlay ONLY `ralph` + `unblockCandidate`.
- Confirms tests often instantiate `SnapshotReader` WITHOUT `start()`, so the chokidar invalidation doesn't run in tests → reinforces the mtime-guard (D-A) for a hard "fresh on every call" guarantee; alternative is calling `loadOverviewData(config.dataFile)` directly.
- `ServerContext` built in `context.ts`; `SnapshotReader` + `WatcherSupervisor` started in `index.ts`.
- Recommends `ReadyTask` caveat field (`stateSource`/`awaitingSync`/`caveats`) + `snapshotAgeMs` + stale reason; keep `snapshotStaleSince` for back-compat.

## Consolidated File List
### Files to modify (impl phase)
- `tools/overview-mcp/src/tools/parallel-ready-tasks.ts` (core change)
- `tools/overview-mcp/src/snapshot-reader.ts` (mtime-guarded fresh read for getOverviewData)
- `tools/overview-mcp/src/__tests__/parallel-ready-tasks.test.ts` (+ helpers.ts if a new fixture helper is needed)
- `.claude-plugin/plugin.json` (2.9.0→2.10.0) + 3 marketplace indexes + CHANGELOG.md
- `AGENTS.md` (v2.10.0 Behavioral Additions: lifecycle-first read + snapshotAgeMs)
### Reference / read-only
- `tools/overview-mcp/src/tools/expand-task-context.ts` (reference getOverviewData→overlay pattern)
- `tools/overview-mcp/src/tools/unblock-candidates.ts` (blockedOn/merged-blocker derivation semantics)
- `scripts/lib/derive-next-command.mjs`, `scripts/lib/sync-core.mjs` (loadOverviewData)
- `tools/overview-viewer/src/types.ts` (canonical types; SnapshotTask extends OverviewTask)
