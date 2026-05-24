# Research Brief — Plan 04 v2 (Pipeline Overview)

*Compiled from researcher Agent + architect Agent + Codex CLI + Copilot CLI, cross-validated against current main.*

## Researcher Findings (Primary)

**Snapshot.runDurations contract (CONFIRMED):**
- `scripts/lib/emit-snapshot.mjs:1-31` — buildSnapshot accepts `runDurations = {}`
- `scripts/lib/emit-snapshot-schema.mjs:27` — `runDurations: { type: 'object', additionalProperties: { type: 'number' } }`
- `tools/overview-viewer/src/types.ts:180` — `runDurations: Record<string, number>` (runId → hours)
- `scripts/lib/sync-core.mjs:383` — `emitAgentArtifacts` reads `state.runDurations ?? {}`

**STALE in existing plan.md:**
- Line 54-57: says Plan 04 should emit recommendations + dep-graph JSON AFTER `writeSidecar()`. **This is architecturally backwards.** `writeSidecar()` (sync-core.mjs:350-362) calls `emitAgentArtifacts()` FIRST (line 356), which READS `plans/overview-recommendations.json` (line 381) and `plans/overview-dependency-graph.json` (line 382) from DISK. If Plan 04 emits AFTER writeSidecar, the snapshot reflects the PREVIOUS cycle's recommendations (1-cycle lag). Improved plan must emit BEFORE writeSidecar.
- Line 3: worktree path references v1 dir. v2 must use `.ralph/jobs/ralph-pipeline-04-pipeline-overview-v2/worktree/`.
- Line 66: references plugin v5.30.0. Current is v5.41.0+.

**sync-core.mjs exports (CONFIRMED):**
```typescript
walkRalphState({ repoRoot, config, generatedFromCommit }) → OverviewRalphState
readBundleForSlug({ repoRoot, config, kind, slug }) → Bundle | undefined
assembleStateFromBundles({ bundles, repoRoot, config, generatedFromCommit }) → OverviewRalphState
deriveAffectedTaskUpdate({ repoRoot, config, kind, slug, currentState, generatedFromCommit }) → UpdateResult
mergeAndWrite({ repoRoot, config, currentState, updates, generatedFromCommit }) → { state, writtenAt, changedTaskIds, activityEvents }
writeSidecar({ repoRoot, config, state }) → Promise<void>
deriveActivityEvents({ previousByTaskId, nextByTaskId, ts }) → ActivityEvent[]
resolveCrossKindPrecedence(bundles) → { winner, shadowed }
atomicWriteFile(finalPath, contents) → Promise<void>  // ALREADY EXPORTED, line 419
loadOverviewData(dataFile) → OverviewData
```

**Two integration sites:**
- **Watcher:** `scripts/lib/watch-ralph-state.mjs:135` — `mergeAndWrite()` (which calls writeSidecar at line 277), then activityEvents loop at 142.
- **One-shot:** `scripts/sync-ralph-state.mjs:47` — explicit `writeSidecar()` call after `walkRalphState()`.

**No partial Plan 04 work on main:**
- No `score-recommendations.mjs`, `derive-dependency-graph.mjs`, `plans/overview-recommendations.json`, `plans/overview-dependency-graph.json`.

**Downstream plans (researcher report):**
- Plan 05 (line 15): correctly notes Plan 04 emits the two JSONs and Plan 05 reads them.
- Plan 06 (line 117, 162): `snapshot.recommendations` fallback to `plans/overview-recommendations.json` — correct.
- Plan 09 (line 9, 45, 75): correctly imports `score-recommendations.mjs` and reads the snapshot/JSON.
- Plan 07: no Plan 04 refs.
- Plan INDEX: high-level DAG only — no stale refs.
- **NO stale references found.** Improved plan cascade story becomes "verify, update if any drift; otherwise no-op + log finding."

**Tests pattern:** `scripts/lib/emit-snapshot.test.mjs` is the canonical vitest pattern (tempdir + fixture JSON + clean up).

## Architect Analysis

- **prdsByTaskId carrier**: Architect recommends option B — compute lazily inside `emitDerivedArtifacts()` by reading PRDs from disk. (Codex/Copilot recommend option A — derive inside `assembleStateFromBundles()` and thread.) **Decision (this plan): adopt option B for v1 (simpler), with option A noted as future optimization.**
- **emitDerivedArtifacts signature:**
  ```js
  emitDerivedArtifacts({ repoRoot, config, state, generatedFromCommit, runDurations = {} })
  ```
- **Recommended scoring weights:** 40 stage / 30 dep / 20 freshness / 10 priority.
- **DependencyGraph schema:** richer than current minimal `{nodes: [{id}], edges: [{from, to}]}` — need node `type: 'task' | 'story'` + `stage?: RalphStage`, edge `type: 'blocks' | 'depends-on-story' | 'spawn' | 'depends-on-task'`.
- **Risk areas:** watcher/CLI drift, Snapshot.runDurations timing, schema drift PipelineOverview ↔ JSON, old-branch copy-paste temptation, config precedence fail-safe.
- **6-story decomposition:** US-001 prdsByTaskId+types, US-002 score-recommendations, US-003 derive-dependency-graph, US-004 emit-derived-artifacts+sync-core wiring, US-005 PipelineOverview UI, US-006 cascade audit.

## Codex CLI Findings

- **plans/overview-data.js is hand-edited** (source of truth). plans/overview-ralph-state.{js,json} is generated.
- **Vite config (`tools/overview-viewer/vite.config.ts`)** serves/inlines both sidecars and starts the Ralph watcher during `pnpm overview`.
- **`OverviewData.spawnedFrom` is a TOP-LEVEL map** (`Record<childTaskId, parentTaskId>`), not a per-task field. Original plan said "OverviewTask.spawnedFrom" — STALE.
- **Existing Plan 05 Recommendation type is minimal/stale:** `{ taskId?, score?, rationale? }` (types.ts:157-161). Plan 04 wants `{ taskId, score, stage, reasons: string[] }`. MUST update `types.ts` AND `emit-snapshot-schema.mjs` together.
- **DependencyGraph schema currently:** `{ nodes: [{id}], edges: [{from, to}] }` (types.ts:163-166, schema.mjs:169). Plan 04 wants richer node/edge types. UPDATE both.
- **Config missing keys:** `outputs.recommendationsJson`, `outputs.dependencyGraphJson`, `recommendations` (weights, topN). Updates needed in `.ralph/overview-config.schema.json`, `scripts/lib/default-config.mjs`, `scripts/lib/default-config.d.mts`, `scripts/lib/resolve-config.mjs`.
- **`overview.html` is already 501,307 bytes** — original AC "under 500KB" is ambiguous. Redefine as `< 512000 bytes` (≤500 KiB) or as "no significant growth (<5% increase vs current baseline)".
- **Frontend test layout:** jsdom click tests go under `tools/overview-viewer/src/__tests__/interactions/` per `vitest.config.ts` jsdom project. SSR tests under `__tests__/*.test.tsx`.

## Copilot CLI Findings

- **Reaffirms architect/codex:** Plan 05 scaffolding already in place; v2 is a "post-sidecar derived-artifacts refactor" (or in our chosen design, **pre-sidecar**).
- **Watcher cold-start path:** `watch-ralph-state.mjs` cold-starts via `walkRalphState()` + `writeSidecar()` (the "first emit" before the debounce loop begins). This third call site MUST also pick up `emitDerivedArtifacts` — by embedding inside writeSidecar, it's automatically covered.
- **External PRD schema path inaccessible to copilot.** Verify against the plugin schema: `userStories[].dependencies[]` shape. Confirmed by researcher (see codex-research and prd-schema references).
- **`loadConfig()` preserves unknown keys**, so adding `recommendations` and new outputs keys is non-breaking once schema validation is widened.
- **`.d.mts` declarations required** for new `.mjs` modules imported by TypeScript tests (per `tools/overview-viewer/CLAUDE.md`).

## Consensus

1. **`runDurations` lives on `Snapshot.runDurations`, NOT on `OverviewRalphState`.** Plan 04 attaches its computed values to `state.runDurations` (non-persisted; `emitAgentArtifacts` reads it). Plan 05 owns the durable home.
2. **`atomicWriteFile` is already exported** from `scripts/lib/sync-core.mjs:419` — reuse, do not duplicate.
3. **`prdsByTaskId` is NEW**: no current code aggregates it. v2 plan introduces it. Carrier choice: option B (read PRDs lazily inside emitDerivedArtifacts) for simplicity in v1.
4. **Two/three integration sites for emitDerivedArtifacts**: watcher cold-start (writeSidecar), watcher debounce (mergeAndWrite→writeSidecar), one-shot (writeSidecar). Embedding `emitDerivedArtifacts` INSIDE `writeSidecar()` (just before `emitAgentArtifacts()`) covers all three with one change and preserves the "writeSidecar is the single integration point for durable Plan 05 agent artifacts" invariant from `tools/overview-viewer/CLAUDE.md`.
5. **No downstream-plan stale refs** (06, 07, 09, INDEX all correct). Cascade story becomes "verify only" unless drift discovered during implementation.
6. **OverviewData.spawnedFrom is a top-level map**, not a per-task field. Original plan was wrong here.
7. **Old branch (ralph-pipeline-04-pipeline-overview @ 896872c3) is DESIGN REFERENCE ONLY.** Do NOT rebase/cherry-pick.

## Divergences

- **Architect (option B lazy)** vs **Codex/Copilot (option A — derive in assembleStateFromBundles and thread)**: this plan adopts option B for v1, calls out option A as future optimization. Rationale: ~18 tasks; lazy fs read is negligible cost and avoids threading complexity through deriveAffectedTaskUpdate/mergeAndWrite.

## Consolidated File List

### To create (NEW)
- `scripts/lib/score-recommendations.mjs` (pure function)
- `scripts/lib/score-recommendations.d.mts` (TS declaration)
- `scripts/lib/score-recommendations.test.mjs` (vitest)
- `scripts/lib/derive-dependency-graph.mjs` (pure function)
- `scripts/lib/derive-dependency-graph.d.mts`
- `scripts/lib/derive-dependency-graph.test.mjs`
- `scripts/lib/emit-derived-artifacts.mjs` (orchestrator; wraps the two pure fns + atomicWriteFile)
- `scripts/lib/emit-derived-artifacts.d.mts`
- `scripts/lib/emit-derived-artifacts.test.mjs`
- `scripts/lib/load-prds-by-task-id.mjs` (helper to read all `.ralph/jobs/*/prd.json` files and group by taskId via overview-data ralphOverrides)
- `scripts/lib/load-prds-by-task-id.test.mjs`
- `tools/overview-viewer/src/components/PipelineOverview.tsx`
- `tools/overview-viewer/src/__tests__/pipelineOverview.test.tsx` (SSR rendering test)
- `tools/overview-viewer/src/__tests__/interactions/pipelineOverviewFilter.test.tsx` (jsdom click test)
- `plans/overview-recommendations.json` (generated artifact — not committed seed)
- `plans/overview-dependency-graph.json` (generated artifact — not committed seed)

### To modify
- `scripts/lib/sync-core.mjs` — extend `writeSidecar()` to accept (optionally compute) prdsByTaskId and call `emitDerivedArtifacts()` BEFORE `emitAgentArtifacts()`. Add runDurations computation (or thread from caller). Keep `atomicWriteFile` export intact.
- `scripts/lib/emit-snapshot-schema.mjs` — widen `Recommendation` definition (add `stage`, `reasons`); widen `DependencyGraph` node/edge schema (additionalProperties allowed; add optional `type`, `stage`, `taskId`, `storyId`).
- `tools/overview-viewer/src/types.ts` — upgrade `Recommendation` to `{ taskId, score, stage, reasons: string[] }` (drop `?` from required), upgrade `DependencyGraph` node/edge shapes; add `OverviewTask.blocks?: string[]`; keep `Snapshot.runDurations`.
- `.ralph/overview-config.schema.json` — add `outputs.recommendationsJson`, `outputs.dependencyGraphJson`, `recommendations` block (weights, topN).
- `scripts/lib/default-config.mjs` + `default-config.d.mts` — add the new outputs paths + recommendations defaults.
- `scripts/lib/resolve-config.mjs` — pass-through new keys.
- `tools/overview-viewer/src/App.tsx` — render `<PipelineOverview>` between `<Toolbar>` and `<Kanban>`; thread `filters`, `setFilters`, `ralphState`.
- `tools/overview-viewer/src/styles.css` — add `.pipeline-overview*` styles.
- (Conditional) `plans/ralph-pipeline-INDEX.md` — only if drift found during audit.
- (Conditional) `plans/ralph-pipeline-06-skills.md` / `09-mcp.md` — only if drift found.

### Read for reference
- `scripts/lib/emit-snapshot.mjs`, `emit-snapshot-schema.mjs`, `emit-tasks-index.mjs`, `emit-activity.mjs` — Plan 05 contracts.
- `scripts/lib/sync-core.mjs` — assembleStateFromBundles, writeSidecar internals.
- `scripts/sync-ralph-state.mjs` — one-shot CLI path.
- `scripts/lib/watch-ralph-state.mjs` — watcher path (cold-start + flushPending).
- `tools/overview-viewer/src/components/Toolbar.tsx`, `RalphStageChip.tsx`, `utils/filters.ts`, `hooks/useMultiAxisFilter.ts` — UI patterns to mirror.
- `tools/overview-viewer/CLAUDE.md` — package conventions (HMR, sidecar invariants, test layout).
- Plugin v5.41.0+ PRD schema (the path on disk may be `5.41.0/schemas/prd-schema.json` — verify before parsing `userStories[].dependencies[]`).

## Build / Test Commands (confirmed)

- `pnpm test` — root vitest (includes `scripts/lib/*.test.mjs`)
- `pnpm --filter @codexu/overview-viewer test` — overview-viewer SSR + jsdom projects
- `pnpm --filter @codexu/overview-viewer typecheck` — strict TS
- `pnpm overview` — Vite dev server with HMR + Ralph watcher
- `pnpm overview:build` — produces `plans/overview.html` (single-file)
- `pnpm sync-ralph-state` — one-shot
- `pnpm sync-ralph-state:watch` — standalone watcher
