# Code Review Context — Plan 04 v2 Pipeline Overview

Captured during initial code review (round 1) of branch
`ralph-pipeline-04-pipeline-overview-v2`. These patterns / gotchas are
informational so the fixer agent and future reviewers can find them quickly.

## Codebase conventions noticed

- **Script libs live under `scripts/lib/*.mjs`** with adjacent `.d.mts`
  declarations consumed by `tools/overview-viewer` TypeScript. New helpers
  added this round (`atomic-write`, `load-prds-by-task-id`,
  `score-recommendations`, `derive-dependency-graph`,
  `emit-derived-artifacts`) follow the existing pattern.
- **`atomicWriteFile` was extracted to `scripts/lib/atomic-write.mjs`** to
  break the circular import between `sync-core.mjs` and
  `emit-derived-artifacts.mjs` (plan F-013). `sync-core.mjs` re-exports it for
  back-compat. Other helpers should import from `atomic-write.mjs` directly.
- **`writeSidecar()` is the single integration point** for both the Ralph
  sidecar (overview-ralph-state.{js,json}) AND durable Plan 05 artifacts
  (snapshot, schema, dataJson, tasksIndex). Plan 04 added a third tier:
  `emitDerivedArtifacts` runs BEFORE `emitAgentArtifacts` so the snapshot
  inlines the freshly emitted recommendations + dep graph (no 1-cycle lag).
  See `tools/overview-viewer/CLAUDE.md` 'Ralph state sidecar' section.
- **Edge direction convention**: `from = dependent`, `to = prerequisite`.
  This is now documented in `derive-dependency-graph.mjs:8-12`. Reviewers
  re-checked the four edge types and all four conform.
- **Stage order single source of truth**: `tools/overview-viewer/src/utils/ralphStages.ts`
  exports a frozen `RALPH_STAGE_ORDER` consumed by Toolbar + PipelineOverview.
  Resolves the F-009 drift risk.

## Gotchas / things future agents should know

- **`overviewData.spawnedFrom` is a top-level map that can contain `_comment`
  metadata** (see `plans/overview-data.js:1605`). Any consumer must filter
  underscore-prefixed keys or whitelist string-typed parentTaskId values
  before treating entries as real (childTaskId, parentTaskId) pairs.
  See F-001.
- **`scoreRecommendations` does not filter shipped tasks.** Stage urgency is
  0 for shipped but the other three components can carry the score above
  fresh pending work — making the "next task to work on" list rank shipped
  tasks. See F-004.
- **The snapshot schema widening must remain backward-compatible.** Plan
  Risk Area #3 explicitly requires legacy minimal snapshots
  (`{recommendations:[{taskId,score}], dependencyGraph:{nodes:[{id}], edges:[{from,to}]}}`)
  to still validate. The current `emit-snapshot-schema.mjs` marks too many
  fields as `required`. See F-002.
- **`runDurations` is keyed by `runId`, not by `taskId`.** When a task has
  N historical runs in `overviewData.runs`, the helper should NOT broadcast
  the current job-state.json window to all N entries. See F-005.
- **`scoreRecommendations` default `topN` is `Infinity`**, not 20. The
  production wrapper (`emit-derived-artifacts`) supplies 20 from
  `config.recommendations.topN`, so the bug is invisible in normal sync runs
  but visible to direct callers (tests, future MCP/skills consumers).
  See F-003.
- **PRDs across multiple tasks reuse `US-001`/`US-002`/...** — `derive-dependency-graph.mjs`
  correctly composes story node IDs as `${taskId}:${storyId}` to avoid
  collisions (plan F-005 mitigation). Bare story-id dependencies are
  resolved within the owning task; pre-qualified `taskId:storyId` deps are
  preserved untouched.
- **`load-prds-by-task-id.mjs` walks BOTH `.ralph/jobs/*/prd.json` AND
  `.ralph/job-groups/*/<member>/prd.json`** (two-level glob). Parse errors
  log to stderr and are skipped rather than throwing (plan F-016
  mitigation), so the watcher debounce loop is never halted by one malformed
  PRD.
- **`writeSidecar` does NOT mutate `state`.** `runDurations` is returned from
  `emitDerivedArtifacts` and threaded as a parameter through
  `emitAgentArtifacts` into `buildSnapshot`. Regression test in
  `sync-core.test.mjs` confirms the serialized sidecar JSON does not contain
  `runDurations`.

## Cross-cutting concerns the per-story iterations couldn't see

- **Bogus spawn nodes (F-001) only surface when `overviewData.spawnedFrom`
  actually carries metadata** — the unit test fixtures in
  `derive-dependency-graph.test.mjs` use clean (childTaskId, parentTaskId)
  maps so the bug is invisible at the helper level. The real data file is
  what reveals it. Fixer should add a fixture mirroring the real shape.
- **Schema back-compat (F-002) is invisible while no persisted legacy
  snapshot exists in the worktree.** First emission after this branch ships
  is fine, but any consumer keeping a snapshot from before Plan 04 lands
  cannot re-validate against the new schema. Add an explicit legacy-shape
  test to `emit-snapshot-schema.test.mjs`.
- **The codex external reviewer and Claude independently caught F-001/F-002/F-003/F-005**,
  consensus on F-004 with copilot. Strong signal these are real and worth
  fixing this round.

## File relationships

- `sync-core.mjs.writeSidecar` -> `emit-derived-artifacts.mjs` -> [`load-prds-by-task-id`, `score-recommendations`, `derive-dependency-graph`] -> writes `overview-recommendations.json` + `overview-dependency-graph.json`
- `sync-core.mjs.writeSidecar` -> `emit-agent-artifacts` (private) reads the two derived JSON files back from disk -> `buildSnapshot` -> writes `overview-snapshot.json`
- `overview-viewer/src/App.tsx` renders `<PipelineOverview>` between `<Toolbar>` and `<Kanban>`; both consume `RALPH_STAGE_ORDER` from `utils/ralphStages.ts`.
