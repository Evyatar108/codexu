# Implementation Plan: Plan 05 — Agent-readable exports

*Refined by `/plan-with-ralph --improve --autonomous` on 2026-05-19. Ready for `/implement-with-ralph --from-plan .ralph/jobs/ralph-pipeline-05-agent-exports/plan.md --autonomous`.*

**Worktree:** `/implement-with-ralph --from-plan` creates the worktree at `D:\harness-efforts\codexu\.ralph\jobs\ralph-pipeline-05-agent-exports\worktree\` on branch `ralph-pipeline-05-agent-exports`. All file edits referenced in this plan happen in that worktree; commits land on the branch and **stay on the branch** (no merge-to-main is part of this plan's deliverable). Do NOT edit `main` directly.

## Overview

This plan turns the data that powers the React dashboard into a clean machine-readable interface for AI agents. The goal: an agent starting cold reads ONE file (`plans/overview-snapshot.json`) and has everything it needs — task list, pipeline state, optional recommendations, optional dependency graph, run history. Companion artifacts (`overview-activity.jsonl` for transitions, `tasks/INDEX.md` for human navigation, `overview-snapshot.schema.json` for downstream typing, `overview-data.json` for tools that cannot `eval` JS) round out the surface.

The refinement pass against current code surfaced six material corrections to the original plan:

1. **Plan 02 (watcher) is merged.** Plan 05 now depends on Plan 02; it must reuse the merged sync-core API and not introduce any polling loop.
2. **`runDurations` does not exist on `OverviewRalphState` today.** It is a Plan 04 artifact; Plan 04 has not shipped. The refined plan treats `Snapshot.runDurations` as a new field (Plan 04 will populate it when it ships) and drops the "migrate from X to Y" wording.
3. **`FilterAxis` lives in `tools/overview-viewer/src/utils/filters.ts`, not `types.ts`.** Plan 03 only edits `filters.ts`. The collision risk between Plan 03 and Plan 05 on `types.ts` (as stated in the spawn briefing) is overstated — both plans add disjoint sets of new exports.
4. **Root `CLAUDE.md` is not tracked.** Replace that edit with `AGENTS.md`.
5. **Activity-event derivation belongs inside `mergeAndWrite`.** `mergeAndWrite` already receives `currentState` and computes the new `state` in the same call, so it has both halves needed to diff `byTaskId` by `taskId` (stage + `storyCompletion`). No `prevStateMap` plumbing is required in the watcher and no slug→taskId resolution is duplicated outside `mergeAndWrite`. `mergeAndWrite` returns `activityEvents` on its result; callers (watcher and one-shot CLI) consume them.
6. **Activity appends happen AFTER successful state write**, not before. `mergeAndWrite` computes the events from `currentState` vs the new state before writing, but the watcher only appends them to `activity.jsonl` after `mergeAndWrite` resolves successfully, so a failed sidecar write does not leak phantom events.

## Research Findings

### Codebase Context

**Plan 02 watcher contract (MERGED on main):**
- `scripts/lib/sync-core.mjs` exports `walkRalphState` (L35), `readBundleForSlug` (L47), `assembleStateFromBundles` (L86), `deriveAffectedTaskUpdate` (L139), `mergeAndWrite` (L232), `writeSidecar` (L289). Atomic write helper `atomicWriteFile` at L301–324 (tmp + fsync + rename retry).
- `scripts/lib/watch-ralph-state.mjs` `start({...})` (L16). Debounce buffer `pendingChanges = new Map()` (L33) keyed by `changeKey(kind, slug)` (L296). `flushPending` (L92) derives updates (L105–106), merges (L134–140), reassigns `currentState = result.state` (L141). Activity events are not derived today; the diff is available inside `mergeAndWrite` because it already holds both `currentState.byTaskId` and the new `state.byTaskId` it constructs.
- `scripts/lib/sync-lock.mjs` exports `acquireLock` (L6), `releaseLock` (L27), `touchLock` (L34). The export name is `touchLock` per commit `5d766c11`; `handle.touch()` works as a method alias.
- `deriveAffectedTaskUpdate` return shape: `{ action: 'upsert'|'remove'|'retain', taskId?, kind, slug, byTaskId?, newPipelineState?, touched, unmatchedFragment }` — does NOT expose the prior pipeline state, but it does not need to: `mergeAndWrite` sees both `currentState.byTaskId[taskId]` and the new `state.byTaskId[taskId]` and can diff by `taskId` directly.

**Type-layer reality (`tools/overview-viewer/src/types.ts`):**
- `RalphStage` union: L36–46.
- `RalphPipelineState` interface: L59–73 — no `runDurations`.
- `OverviewRalphState` interface: L75–81 — no `runDurations`.
- `FilterAxis` is NOT here — it lives in `tools/overview-viewer/src/utils/filters.ts`. Plan 03's ralphStage-filter edits target `filters.ts`, so Plan 05's `types.ts` edits do not collide with Plan 03.

**Job-artifact layout (today):**
- `.ralph/jobs/<slug>/` carries `job-state.json`, `prd.json`, `worktree/`, and plan/review artifacts. No `snapshot.json` / `activity.jsonl` / `INDEX.md` anywhere.
- `plans/overview-ralph-state.{js,json}` already exist (Plan 02). Plan 05 adds peers at the `plans/` level.
- `tasks/` exists with legacy `prd-*.md` files (`prd-1a-fork-doc.md`, `prd-port-explorer-prompt.md`). `tasks/INDEX.md` does not exist.

**Plan 04 artifacts (NOT shipped):**
- `scripts/lib/score-recommendations.mjs`, `scripts/lib/derive-dependency-graph.mjs`, `plans/overview-recommendations.json`, `plans/overview-dependency-graph.json` — none present on `main`. Plan 05 must condition on their presence (empty defaults when absent).

**Test infrastructure:**
- Test runner is **vitest** (`scripts/lib/sync-core.test.mjs` imports from `'vitest'`). Helpers in that file: `makeTempDir`, `writeJson`, `buildConfig`, `writeOverviewData`, `writeJobState`, `writeGroupState`.
- No tests for `watch-ralph-state.mjs` yet.
- TypeScript declarations live in `scripts/lib/*.d.mts` and `tools/overview-viewer/src/__tests__/scripts.d.ts`. New emitter modules need ambient declarations in both places.

**Config wiring (must update together):**
- `scripts/lib/default-config.mjs` + `scripts/lib/default-config.d.mts`
- `scripts/lib/resolve-config.mjs`
- `.ralph/overview-config.json`
- `.ralph/overview-config.schema.json`
- `tools/overview-viewer/src/__tests__/config.test.ts` (tests the resolved config shape)

Skipping any of these five leaves unknown `outputs.*` keys unresolved.

### Technical Constraints

- **All work on branch `ralph-pipeline-05-agent-exports`** inside `.ralph/jobs/ralph-pipeline-05-agent-exports/worktree/`. Nothing lands on `main` as part of this plan.
- **Plan 02 dependency is hard.** No polling loop; reuse the merged watcher/sync-core API exclusively.
- **Plan 03 coexistence:** `types.ts` and `filters.ts` are touched by different plans. Plan 03 edits `filters.ts` (FilterAxis + chip types). Plan 05 edits `types.ts` (Snapshot, SnapshotTask, ActivityEvent — all appended at the end of the file). Plan 04 (when shipped) will be the one to add `runDurations` to either `OverviewRalphState` or directly to `Snapshot`. **Plan 05 does NOT remove `runDurations` from `OverviewRalphState` because the field is not there.**
- **Plan 04 conditional:** if `overview-recommendations.json` and `overview-dependency-graph.json` exist, the snapshot reads them; otherwise `recommendations: []`, `dependencyGraph: { nodes: [], edges: [] }`.
- **`ajv` is not a direct dev dependency** today (transitively present in the lockfile). Either add `ajv` (and `ajv-formats` if used) as a direct dev dep, or run schema validation through a small Node test instead of the `npx ajv` CLI.
- **Atomicity contract:** snapshot/data-twin/schema/tasks-index reuse `atomicWriteFile`. `activity.jsonl` uses a single `writeSync(line + '\n')` + `fsync` + close on a file opened in append mode. All writes happen inside the existing lock window held during the flush.
- **Run start/finish events are not fully derivable today** — `RalphPipelineState` carries no `createdAt`/`completedAt`. Plan 05 emits stage transitions and story-progress deltas; run start/finish are descoped to "approximate (stage entry/exit)" until Plan 04 adds explicit run metadata.

## Approach

### Architecture

**Single-window emission inside the watcher flush.** The watcher already owns the lock window from `acquireLock` through the sidecar write. Plan 05 piggybacks on that window:

1. Watcher's `flushPending` calls `mergeAndWrite` with `currentState` and `updates` exactly as today.
2. Inside `mergeAndWrite`, after computing the new `state`, diff `currentState.byTaskId` vs `state.byTaskId` by `taskId`: emit an `ActivityEvent` for any task whose `stage` or `storyCompletion` changed, plus removals (`newStage: null`) for tasks that disappeared and first observations (`prevStage: null`) for tasks newly present. Return `{ state, writtenAt, changedTaskIds, activityEvents }`.
3. Watcher (after the successful merge) iterates `result.activityEvents` — still inside the lock window:
   - `buildSnapshot(...)` → atomic write `plans/overview-snapshot.json`
   - `appendActivity(repoRoot, event)` per event (rotation handled internally)
   - `buildTasksIndex(snapshot)` → atomic write `tasks/INDEX.md`
   - `emit-snapshot-schema` → atomic write `plans/overview-snapshot.schema.json` (only when stale vs. snapshot)
   - `loadOverviewData` (now exported) → serialize → atomic write `plans/overview-data.json`

The same emission flow runs from `writeSidecar` for one-shot `pnpm sync-ralph-state` (no watcher), so on-demand syncs produce the same artifacts.

**Why this ordering avoids common bugs:**
- The prev-vs-new diff lives inside `mergeAndWrite` where both halves of the comparison are unambiguously available, so there is no risk of capturing a stale `prevStage` outside the merge.
- Snapshot is written before activity events are appended; an empty `activityEvents` array still produces a valid snapshot on the first run.
- Activity append happens only after a successful state write, so a failure in `mergeAndWrite` does not leak phantom log entries.
- All writes are inside the existing lock window; readers (Plan 06 skills, Plan 09 MCP) never see a half-written snapshot.

### Implementation Strategy

Phased so each phase ends in a green test run.

1. **Phase A — Types and config plumbing.**
   - Add `Snapshot`, `SnapshotTask`, `ActivityEvent` to `tools/overview-viewer/src/types.ts` (append at file end).
   - Add config keys: `outputs.snapshot`, `outputs.activity`, `outputs.activityBackup`, `outputs.activityMaxLines` (integer, default 1000), `outputs.dataJson`, `outputs.snapshotSchema`, `outputs.tasksIndex`. Path-shaped keys (`snapshot`, `activity`, `activityBackup`, `dataJson`, `snapshotSchema`, `tasksIndex`) are scalar strings resolved via `resolvePath` alongside `sidecarJs`/`sidecarJson`; `activityMaxLines` is a sibling integer (not nested under `activity`). Update `default-config.mjs`, `default-config.d.mts`, `resolve-config.mjs`, `.ralph/overview-config.json`, `.ralph/overview-config.schema.json`, `tools/overview-viewer/src/__tests__/config.test.ts`.
   - Add ambient declarations for new emitter modules in `tools/overview-viewer/src/__tests__/scripts.d.ts`.
2. **Phase B — Emitters as pure modules.**
   - `scripts/lib/emit-snapshot.mjs` — `buildSnapshot({ ralphState, overviewData, recommendations, dependencyGraph, generatedFromCommit })` returns a `Snapshot`. Recommendations/dependencyGraph default to empty.
   - `scripts/lib/emit-activity.mjs` — `appendActivity(repoRoot, event, { activityPath, activityBackupPath, maxLines = 1000 })` + `rotateActivity(activityPath, activityBackupPath)`. `maxLines` is supplied by callers from the resolved `outputs.activityMaxLines` config key. Append uses `fs.openSync(file, 'a')` → single `writeSync(line + '\n')` → `fsyncSync` → close. Rotation is checked at the start of every append.
   - `scripts/lib/emit-tasks-index.mjs` — `buildTasksIndex(snapshot)` returns markdown. Generated-file header comment.
   - `scripts/lib/emit-snapshot-schema.mjs` — hand-written schema for `Snapshot` v1; exports `SNAPSHOT_SCHEMA` constant and `writeSnapshotSchema(path)` helper.
   - All four ship matching `.d.mts` files.
3. **Phase C — `sync-core.mjs` wiring.**
   - Extract the existing private `loadOverviewData` into an exported helper.
   - Inside `mergeAndWrite`, after computing the new `state`, derive `activityEvents` by diffing `currentState.byTaskId` against `state.byTaskId` keyed by `taskId`: emit an event for every task whose `stage` or `storyCompletion` differs (including removals — `newStage: null` — and first observations — `prevStage: null`). Resolve `slug`/`kind` from the new (or, for removals, prior) `RalphPipelineState`. Return `activityEvents` in the result alongside `state`, `writtenAt`, and `changedTaskIds`. **The `mergeAndWrite` signature is unchanged**: no new arguments — the inputs (`currentState`, `updates`) are already sufficient.
   - Extend `writeSidecar` (or add a sibling `emitAgentArtifacts` called from `writeSidecar`) to invoke the four new emitters in order: schema → snapshot → data-twin → tasks-index. All atomic.
   - Plumb the new config-resolved output paths through both `writeSidecar` and any one-shot CLI callers.
4. **Phase D — `watch-ralph-state.mjs` wiring.**
   - Call `mergeAndWrite` with `currentState` and `updates` exactly as today (no signature change at the call site).
   - After `mergeAndWrite` returns successfully and `currentState` is replaced, iterate `result.activityEvents` and call `appendActivity` per event (still inside the lock window — no lock release between merge and appends).
5. **Phase E — Docs + cascade.**
   - Append the agent-pointer line to `AGENTS.md` (root).
   - Append the "## Ralph state sidecar" section to `tools/overview-viewer/CLAUDE.md`.
   - Audit downstream plans 06–12 and `plans/ralph-pipeline-INDEX.md` and refresh stale references (specific edits called out under **Files to Modify — Cascade**).
6. **Phase F — End-to-end + acceptance run.**
   - `pnpm sync-ralph-state` produces all new artifacts. Run schema validation.
   - Simulate a stage transition (flip a fixture `job-state.json`); confirm a new `activity.jsonl` line.
   - Synthetically inflate `activity.jsonl` past 1000 lines and run sync; confirm rotation to `activity.1.jsonl`.

### Files to Create / Modify

**Create**
- `scripts/lib/emit-snapshot.mjs` + `.d.mts` — pure `buildSnapshot`.
- `scripts/lib/emit-activity.mjs` + `.d.mts` — `appendActivity` + `rotateActivity` with single-write/fsync atomicity.
- `scripts/lib/emit-tasks-index.mjs` + `.d.mts` — `buildTasksIndex(snapshot)` markdown renderer.
- `scripts/lib/emit-snapshot-schema.mjs` + `.d.mts` — `SNAPSHOT_SCHEMA` constant + writer.
- `scripts/lib/emit-snapshot.test.mjs`, `emit-activity.test.mjs`, `emit-tasks-index.test.mjs`, `emit-snapshot-schema.test.mjs` — vitest unit tests.
- `plans/overview-snapshot.json` — generated artifact (header-stable shape, see **Snapshot schema** below).
- `plans/overview-data.json` — generated artifact (JSON twin of `overview-data.js`).
- `plans/overview-activity.jsonl` — generated append-only artifact.
- `plans/overview-activity.1.jsonl` — rotation backup, created on first rollover.
- `plans/overview-snapshot.schema.json` — generated JSON Schema for `Snapshot` v1.
- `tasks/INDEX.md` — generated agent + human navigation file with `<!-- GENERATED -->` header.

**Modify — code**
- `scripts/lib/sync-core.mjs` — export `loadOverviewData`; inside `mergeAndWrite`, diff `currentState.byTaskId` vs the new `state.byTaskId` by `taskId` (stage + `storyCompletion`) and return `activityEvents` on the result (no signature change); extend `writeSidecar` (or add `emitAgentArtifacts`) to emit the four new artifacts atomically.
- `scripts/lib/watch-ralph-state.mjs` — keep the existing `mergeAndWrite` call site unchanged; after merge succeeds, append `result.activityEvents` entries to `activity.jsonl` inside the same lock window.
- `scripts/sync-ralph-state.mjs` — confirm one-shot mode emits the new artifacts (path flows through `writeSidecar`).
- `scripts/lib/default-config.mjs` + `scripts/lib/default-config.d.mts` — add `outputs.snapshot`, `outputs.activity`, `outputs.activityBackup`, `outputs.activityMaxLines` (integer, default 1000), `outputs.dataJson`, `outputs.snapshotSchema`, `outputs.tasksIndex` with sensible defaults.
- `scripts/lib/resolve-config.mjs` — extend the `outputs` destructure on L80 to include the six new scalar path keys, resolve each via `resolvePath` alongside `sidecarJs`/`sidecarJson`, and pass through `activityMaxLines` as a plain integer (no path resolution).
- `.ralph/overview-config.json` — populate the new keys with concrete paths and the integer `activityMaxLines`.
- `.ralph/overview-config.schema.json` — extend `properties.outputs` with the six new path-string property definitions plus the integer `activityMaxLines` (`type: 'integer'`, `minimum: 1`, default 1000).
- `tools/overview-viewer/src/types.ts` — append `Snapshot`, `SnapshotTask`, `ActivityEvent` exports plus minimal v1 stubs for `Recommendation` and `DependencyGraph` so the `Snapshot` interface compiles before Plan 04 ships. Plan 04 may extend or rename the stubs; Plan 05 ships them as the v1 contract. No changes to existing `OverviewRalphState` / `RalphPipelineState`.
- `tools/overview-viewer/src/__tests__/scripts.d.ts` — add ambient module declarations for the four new emitter modules.
- `tools/overview-viewer/src/__tests__/config.test.ts` — extend assertions to cover the new resolved output keys.

**Modify — docs**
- `AGENTS.md` (root) — append:
  ```
  - **Pipeline state for agents:** read `plans/overview-snapshot.json` for the current pipeline state (one merged file). Activity log at `plans/overview-activity.jsonl`. Generated by `scripts/sync-ralph-state.mjs --watch` (auto-started by `pnpm overview`). Never hand-edit these generated files.
  ```
- `tools/overview-viewer/CLAUDE.md` — append a `## Ralph state sidecar` section that points at the new artifacts and reminds readers the sidecar is regenerated automatically.

**Modify — Cascade (downstream plan files)**
- `plans/ralph-pipeline-04-pipeline-overview.md` — Plan 04 has not shipped yet, but its current text disagrees with Plan 05's contract. Update Plan 04's spec to: (1) move `runDurations`'s type-home from `OverviewRalphState` into `Snapshot` (i.e., Plan 04 no longer adds `runDurations?: Record<string, number>` to `OverviewRalphState`; instead Plan 04 computes the per-run hours and either stores them in an in-memory map consumed by Plan 05's snapshot builder, or writes them into the snapshot via the emitter pipeline added here), (2) confirm Plan 04 still emits `plans/overview-recommendations.json` and `plans/overview-dependency-graph.json` as separate sibling artifacts — Plan 05's snapshot then absorbs them by reading those files at build time, (3) reaffirm that the snapshot stays derived: Plan 04 does not mutate `plans/overview-snapshot.json` directly, and the "Common mistakes" note about `runDurations` being a "transient home on `OverviewRalphState`" must be replaced with "`runDurations` lives only in `Snapshot` (Plan 05); Plan 04 does not extend `OverviewRalphState`."
- `plans/ralph-pipeline-06-skills.md` — confirm `/work-on`, `/triage`, `/blocker-report` consumption paths use `plans/overview-snapshot.json` (single source) rather than chaining `overview-recommendations.json` directly.
- `plans/ralph-pipeline-07-context.md` — confirm `RecentActivity` reads `plans/overview-activity.jsonl`; ensure ordering note matches Plan 05's "append after successful write" semantics.
- `plans/ralph-pipeline-08-crews.md` — rewrite any "merge into snapshot" wording: Plan 08 extends source state (`RalphPipelineState.crewSessions`) so sync regenerates the snapshot; it does NOT mutate the snapshot directly.
- `plans/ralph-pipeline-09-mcp.md` — clarify whether MCP imports TypeScript types from `types.ts` or consumes `overview-snapshot.schema.json` separately; remove any "import JSON Schema as TypeScript" wording.
- `plans/ralph-pipeline-10-ralph-handoff.md`, `plans/ralph-pipeline-11-mcp-operational-tools.md`, `plans/ralph-pipeline-12-package-as-plugin.md` — scan for stale Plan 05 references (file paths, function names, dependency claims) and refresh.
- `plans/ralph-pipeline-INDEX.md` — update Source-of-truth modules table to include the new artifacts; update DAG so `05 → depends on 02`; mark Plan 04 outputs as conditional inputs.

### Read for Reference (NOT modified)
- `scripts/lib/sync-core.mjs` (the L139–270 region around `deriveAffectedTaskUpdate` / `mergeAndWrite` and L289–324 around `writeSidecar` + `atomicWriteFile`) — exact integration points.
- `scripts/lib/derive-ralph-stage.mjs` — re-export of `deriveRalphStage({ jobState?, prd?, brainstormJson?, reviewOpenCount?, jobDirMarker? })`. Do not duplicate.
- `scripts/lib/sync-lock.mjs` — for the watcher's lock semantics; Plan 05 does not need new lock APIs.
- `plans/ralph-pipeline-02-watcher.md` — current contract reference.
- `plans/ralph-pipeline-03-ui-chip.md` — confirm zero overlap with `types.ts`.

## Scope

### In Scope
- Generate `plans/overview-snapshot.json` (aggregated merged view, schema v1).
- Generate `plans/overview-data.json` (read-only JSON twin of hand-curated `overview-data.js`).
- Generate `plans/overview-activity.jsonl` (append-only event log with rotation at 1000 lines).
- Generate `plans/overview-snapshot.schema.json` (hand-written JSON Schema v1 matching the TS interface).
- Generate `tasks/INDEX.md` (human + agent-readable per-task summary).
- Add the agent-pointer line to `AGENTS.md` (root) and the dashboard pointer in `tools/overview-viewer/CLAUDE.md`.
- Derive activity events inside `mergeAndWrite` by diffing `currentState.byTaskId` against the new `state.byTaskId` (stage + `storyCompletion`), and append them in the watcher / one-shot CLI after a successful merge.
- Update all five config files together when adding output keys.
- Cascade Plan 06–12 + INDEX references to match the shipped artifacts.

### Out of Scope
- Repo-local skills (`/work-on`, `/triage`, `/blocker-report`) — Plan 06.
- React `RecentActivity` sidebar consuming `activity.jsonl` — Plan 07.
- `RalphPipelineState.crewSessions` and crew aggregation — Plan 08.
- MCP server exposing the snapshot — Plan 09.
- Source data edits (`overview-data.js` stays hand-curated; the `.json` is a derived twin, not an authoring surface).
- `runDurations` population — Plan 04 owns the values; Plan 05 only adds the field to the snapshot type.
- Precise run start/finish event timestamps — descoped to Plan 04 once it adds `createdAt`/`completedAt` to `RalphPipelineState`.
- Auto-generated TypeScript-to-JSON-Schema conversion (`ts-json-schema-generator`) — Plan 05 ships a hand-written schema for v1; auto-generation can come later once the type shape stabilizes.

## Snapshot schema

```ts
export interface Snapshot {
    schemaVersion: number              // integer; v1 for this plan. Bump on breaking changes.
    generatedAt: string                // ISO 8601
    generatedFromCommit: string        // short git SHA
    tasks: SnapshotTask[]              // merged OverviewTask + RalphPipelineState
    runs: RunRecord[]                  // copy of OverviewData.runs[]
    recommendations: Recommendation[]  // [] when Plan 04 not shipped
    dependencyGraph: DependencyGraph   // { nodes: [], edges: [] } when Plan 04 not shipped
    runDurations: Record<string, number>  // {} when Plan 04 not shipped; runId → hours when shipped
    unmatched: Array<{ kind: string; slug: string; reason: string }>
    unmatchedSummary: Record<string, number>
}

export interface SnapshotTask extends OverviewTask {
    ralph?: RalphPipelineState         // pulled from ralphState.byTaskId[task.id]
}

// v1 stubs — Plan 04 owns the authoritative shapes and may extend or rename these.
// Plan 05 ships them as minimal stubs so the Snapshot interface compiles before Plan 04 lands.
export interface Recommendation {
    taskId?: string
    score?: number
    rationale?: string
}

export interface DependencyGraph {
    nodes: Array<{ id: string }>
    edges: Array<{ from: string; to: string }>
}

export interface ActivityEvent {
    ts: string                         // ISO 8601
    slug: string
    kind: 'job' | 'group' | 'brainstorm'
    taskId?: string                    // resolved at event time; absent if unmatched
    prevStage?: RalphStage | null      // null when first observed
    newStage?: RalphStage | null       // null when slug deleted
    changedFields: string[]            // e.g. ['stage', 'storyCompletion']
    reason: 'sync' | 'watch-event' | 'manual'
}
```

The `Snapshot.recommendations`, `Snapshot.dependencyGraph`, and `Snapshot.runDurations` fields are present on every snapshot (always-keys for downstream typing), populated only when Plan 04 has shipped. Agents must treat them as possibly-empty containers.

`schemaVersion: 1` is an integer, not semver. Bump on breaking changes (rename or remove a field); adding optional fields keeps it at 1.

## Activity log rotation

`plans/overview-activity.jsonl` grows monotonically. Cap at 1000 lines (configurable via `outputs.activityMaxLines`, an integer sibling of the path-shaped `outputs.activity` and `outputs.activityBackup` keys). Rotation happens at the start of every append, before the new line is written:

- If the current file has ≥ 1000 lines, rename it to `plans/overview-activity.1.jsonl` (overwriting any prior backup) and start a fresh primary file.
- The rotation is best-effort. A crash mid-rotation yields at most a slightly-too-large primary file or a missing backup — both tolerable since activity is supplementary.

Each line is written via a single `fs.writeSync(line + '\n')` on an append-mode file handle, followed by `fsyncSync`. Lines stay well under PAGE_SIZE, so the write is atomic on common filesystems.

## Suggested Decomposition

Five clusters. Phases are dependency-ordered.

### Cluster: emitter-modules
- Stories: US-001 (emit-snapshot), US-002 (emit-activity), US-003 (emit-tasks-index), US-004 (emit-snapshot-schema), US-005 (vitest tests for the four emitters)
- Phase: 1
- Depends on: None
- File-overlap evidence: shared=[]; exclusive=[scripts/lib/emit-snapshot.mjs, scripts/lib/emit-activity.mjs, scripts/lib/emit-tasks-index.mjs, scripts/lib/emit-snapshot-schema.mjs, plus matching `.d.mts` and `.test.mjs`]; risk=low
- `execution_mode` rationale: Each emitter is an isolated new file with no shared code paths. Could be parallelized further, but bundling as one cluster keeps the test surface coherent.

### Cluster: types-and-config
- Stories: US-006 (Snapshot/SnapshotTask/ActivityEvent type exports plus v1 stubs for Recommendation and DependencyGraph), US-007 (seven new output config keys — six scalar paths plus the integer `activityMaxLines` — wired across all five config files), US-008 (ambient declarations for new emitter modules)
- Phase: 1
- Depends on: None
- File-overlap evidence: shared=[]; exclusive=[tools/overview-viewer/src/types.ts (additive at file end), scripts/lib/default-config.mjs, scripts/lib/default-config.d.mts, scripts/lib/resolve-config.mjs, .ralph/overview-config.json, .ralph/overview-config.schema.json, tools/overview-viewer/src/__tests__/scripts.d.ts, tools/overview-viewer/src/__tests__/config.test.ts]; risk=low (Plan 03 edits `filters.ts`, NOT `types.ts`)
- `execution_mode` rationale: Pure additive type/config plumbing with no overlap with emitter cluster or wiring cluster.

### Cluster: sync-core-wiring
- Stories: US-009 (export `loadOverviewData`), US-010 (derive `activityEvents` inside `mergeAndWrite` by diffing `currentState.byTaskId` vs the new `state.byTaskId`; return on result — no signature change), US-011 (extend `writeSidecar` to invoke emitters atomically)
- Phase: 2
- Depends on: emitter-modules, types-and-config
- File-overlap evidence: shared=[]; exclusive=[scripts/lib/sync-core.mjs, scripts/lib/sync-core.test.mjs]; risk=medium (touches the same module Plan 02 stabilized; must preserve `atomicWriteFile`, lock semantics, and existing test fixtures)
- `execution_mode` rationale: Must serialize after emitters land so the new functions exist; must serialize after config keys exist so emitters can resolve paths.

### Cluster: watcher-wiring
- Stories: US-012 (consume `result.activityEvents` from `mergeAndWrite`), US-013 (append each event via `appendActivity` inside the lock window after a successful merge)
- Phase: 3
- Depends on: sync-core-wiring
- File-overlap evidence: shared=[]; exclusive=[scripts/lib/watch-ralph-state.mjs, scripts/lib/watch-ralph-state.test.mjs (new)]; risk=low (watcher call site is unchanged; only the post-merge consumption is new)
- `execution_mode` rationale: Requires the extended `mergeAndWrite` return shape from sync-core-wiring. Cannot be parallel.

### Cluster: docs-and-cascade
- Stories: US-014 (AGENTS.md + overview-viewer CLAUDE.md), US-015 (audit Plans 06–12 and update stale references), US-016 (update plans/ralph-pipeline-INDEX.md DAG + source-of-truth table), US-017 (acceptance run + schema validation)
- Phase: 4
- Depends on: watcher-wiring (acceptance run needs the watcher fully wired)
- File-overlap evidence: shared=[]; exclusive=[AGENTS.md, tools/overview-viewer/CLAUDE.md, plans/ralph-pipeline-06-skills.md, 07, 08, 09, 10, 11, 12, plans/ralph-pipeline-INDEX.md]; risk=low
- `execution_mode` rationale: Doc/cascade work is sequential by nature (single editor traversing the docs); no parallel benefit.

Parallel handoff: `/implement-with-ralph --from-plan .ralph/jobs/ralph-pipeline-05-agent-exports/plan.md --parallel --suggested-decomposition .ralph/jobs/ralph-pipeline-05-agent-exports/suggested-decomposition.json`

Serial handoff (recommended for this plan due to medium-risk wiring clusters): `/implement-with-ralph --from-plan .ralph/jobs/ralph-pipeline-05-agent-exports/plan.md --autonomous`

## Risk Areas

1. **Removed-task diff coverage.** Because the diff lives inside `mergeAndWrite` and compares the full `currentState.byTaskId` against the new `state.byTaskId`, it must explicitly handle both directions: tasks present in `currentState` but absent from the new state (emit with `newStage: null`) and tasks newly present (emit with `prevStage: null`). Missing either direction silently drops events. Mitigation: vitest cases for both directions in `sync-core.test.mjs`.
2. **Config-key drift.** Five config files must update together. Mitigation: lump them into the types-and-config cluster and have a single commit that touches all five.
3. **`activity.jsonl` partial-write under crash.** Single `writeSync` of a line ≤ 4KB is atomic on common filesystems, but extreme conditions (full disk, EIO mid-write) could still leave a torn line. Mitigation: readers MUST tolerate a final torn line (skip last line if `JSON.parse` throws). Document this in `AGENTS.md`.
4. **`ajv` not a direct dev dep.** The original plan's `npx ajv validate` acceptance criterion may fail. Mitigation: add `ajv` (and `ajv-formats`) to `devDependencies` in `package.json` as part of Phase F, OR replace the criterion with a Node test that imports ajv directly.
5. **Plan 04 conditional drift.** If Plan 04 ships between when Plan 05 starts and when it lands, `recommendations`/`dependencyGraph`/`runDurations` must populate correctly. Mitigation: read the JSON files at sync time (`existsSync` check); fall back to empty defaults.
6. **`overview-data.js` parse via `new Function`.** Reused from sync-core's private `loadOverviewData`. The function evaluates JS at sync time. Mitigation: do NOT widen the input surface; the file is repo-local and already trusted by the build. Document this in the emitter's d.mts.
7. **Plan 03 merge order.** If Plan 03 lands first, no conflict (Plan 03 only edits `filters.ts`). If Plan 05 lands first, no conflict either. Mitigation: include the "no shared file with Plan 03" finding in the commit message so reviewers do not flag a phantom collision.
8. **Schema drift as Plans 07/08 add fields.** They extend `RalphPipelineState`; the schema's `SnapshotTask.ralph` accepts the extended shape because additional properties are allowed. Mitigation: schema's `additionalProperties: true` on `RalphPipelineState`. Document in `AGENTS.md` that adding optional fields is non-breaking.

## Acceptance Criteria

- [ ] `plans/overview-snapshot.json` produced by `pnpm sync-ralph-state` (and by the watcher on every flush), valid against `plans/overview-snapshot.schema.json`.
- [ ] `plans/overview-data.json` produced; deep-equal (modulo whitespace) to the `window.OVERVIEW_DATA` value obtained by parsing `plans/overview-data.js` via the existing `loadOverviewData` helper.
- [ ] `plans/overview-activity.jsonl` exists; a stage transition flip in a fixture `job-state.json` produces a new line within one watcher debounce.
- [ ] `plans/overview-activity.jsonl` rotates at 1000 lines (verified by inflating the file synthetically); `plans/overview-activity.1.jsonl` exists after rollover.
- [ ] `plans/overview-snapshot.schema.json` produced; `schemaVersion` is `1`.
- [ ] `tasks/INDEX.md` produced with one section per task (stage, jobDir, last activity, deep link to dashboard chip); `<!-- GENERATED -->` header present.
- [ ] Schema validation passes via either `npx ajv validate -s plans/overview-snapshot.schema.json -d plans/overview-snapshot.json` (with `ajv`/`ajv-formats` added to devDependencies) OR a vitest test that runs ajv programmatically.
- [ ] Snapshot's `tasks[]` merges `OverviewTask` + `RalphPipelineState` correctly (`jq '.tasks[0] | keys'` shows fields from both).
- [ ] `recommendations`, `dependencyGraph`, and `runDurations` are present as empty containers when Plan 04 has not shipped, and populated correctly when it has.
- [ ] `Snapshot.runDurations` field defined in `types.ts` (Plan 04 will populate it later). `OverviewRalphState` is unchanged (no `runDurations` migration because the field is not there today).
- [ ] `AGENTS.md` updated with the agent-pointer line; `grep "overview-snapshot.json" AGENTS.md` returns ≥1 line.
- [ ] `tools/overview-viewer/CLAUDE.md` updated with the `## Ralph state sidecar` section.
- [ ] Stage-change event verified: a watcher tick that mutates a slug's stage produces an `ActivityEvent` with `prevStage` ≠ `newStage`. A tick where stage is unchanged produces no event. Removed-task and first-observation cases also verified (`newStage: null` and `prevStage: null` respectively).
- [ ] Five-config-file update is atomic — `default-config.mjs`, `default-config.d.mts`, `resolve-config.mjs`, `.ralph/overview-config.json`, `.ralph/overview-config.schema.json` all reference the same set of seven new output keys (six scalar paths: `snapshot`, `activity`, `activityBackup`, `dataJson`, `snapshotSchema`, `tasksIndex`; plus the integer `activityMaxLines`), and `tools/overview-viewer/src/__tests__/config.test.ts` asserts on the resolved shape, including that `outputs.activity` is a string path (not an object) and that `outputs.activityMaxLines` is an integer.
- [ ] All existing tests pass; `pnpm test` (or the equivalent vitest command) green.
- [ ] No signature churn on `mergeAndWrite` — the existing arguments (`repoRoot`, `config`, `currentState`, `updates`, `generatedFromCommit`) are unchanged; only the return value gains an additional `activityEvents` field. Existing callers continue to work without modification.
- [ ] **Downstream-plan cascade audit:**
  - [ ] `plans/ralph-pipeline-04-pipeline-overview.md` — `runDurations` type-home moved from `OverviewRalphState` into `Snapshot` (Plan 04 no longer extends `OverviewRalphState`); Plan 04 still emits `overview-recommendations.json` and `overview-dependency-graph.json` as separate sibling artifacts that Plan 05's snapshot absorbs; the "transient home" note in Plan 04's Common mistakes section is updated to reflect that `runDurations` lives only in `Snapshot`.
  - [ ] `plans/ralph-pipeline-06-skills.md` — confirmed snapshot consumption path; stale references refreshed if any.
  - [ ] `plans/ralph-pipeline-07-context.md` — activity.jsonl ordering matches "append after successful write."
  - [ ] `plans/ralph-pipeline-08-crews.md` — "merge into snapshot" wording rewritten to "extend `RalphPipelineState.crewSessions`."
  - [ ] `plans/ralph-pipeline-09-mcp.md` — TS-types vs JSON-schema consumption clarified.
  - [ ] `plans/ralph-pipeline-10*.md`, `11*.md`, `12*.md` — scanned; any stale Plan 05 references refreshed.
  - [ ] `plans/ralph-pipeline-INDEX.md` — Source-of-truth table extended with Plan 05 artifacts; DAG updated so `05 → depends on 02`; Plan 04 outputs marked conditional.
  - [ ] Cascade edits committed atomically in the final implementation commit; commit message lists each diff (file, lines, what changed).

## Preliminary Story Decomposition

See `stories-outline.md` for full descriptions. High-level summary:

- US-001..US-005 — Emitter modules (snapshot, activity, tasks-index, schema) + tests. Phase 1.
- US-006..US-008 — Types, config keys, ambient declarations. Phase 1.
- US-009..US-011 — `sync-core.mjs` extensions: export `loadOverviewData`, derive `activityEvents` inside `mergeAndWrite` (no signature change), extend `writeSidecar`. Phase 2.
- US-012..US-013 — `watch-ralph-state.mjs` extensions: consume `result.activityEvents` and append. Phase 3.
- US-014..US-017 — Docs (`AGENTS.md`, `tools/overview-viewer/CLAUDE.md`), cascade audit Plans 06–12 + INDEX, end-to-end acceptance run. Phase 4.

## Open Questions

These are autonomous-mode inferences that should be confirmed during implementation. Each is marked `[INFERRED]` so the implementer can verify.

1. `[INFERRED]` **Schema co-location vs `schemas/` dir.** Inference: keep at `plans/overview-snapshot.schema.json` (co-located with the snapshot) for v1; defer `schemas/` directory extraction to Plan 12 (plugin extraction). Reason: no `schemas/` directory exists today; co-location avoids a new top-level dir for a single file.
2. `[INFERRED]` **`tasks/INDEX.md` JSON twin.** Inference: do NOT add `tasks/INDEX.json`; document explicitly that `plans/overview-snapshot.json` IS the machine-readable twin (INDEX.md is for human navigation). Reason: avoiding double-writing the same data; agents already have everything they need from snapshot.json.
3. `[INFERRED]` **`ajv` dev-dep vs Node test.** Inference: add `ajv` + `ajv-formats` to `package.json` devDependencies. Reason: keeps the original `npx ajv` acceptance criterion working without rewriting it; ajv is already in the lockfile transitively, so disk impact is minimal.
4. `[INFERRED]` **Activity event for `action: 'retain'`.** Inference: do NOT emit an event for a retain (no diff). Reason: retain means no change; emitting would noise the log. Note: because the diff is now computed by comparing `currentState.byTaskId` to the new `state.byTaskId` inside `mergeAndWrite`, retain updates naturally produce no events (no byTaskId mutation, so no diff).
5. `[INFERRED]` **`storyCompletion` event.** Inference: emit an `ActivityEvent` when `storyCompletion` (count or fraction) changes between prev and new state, with `changedFields: ['storyCompletion']`. Reason: feature request mentions "story progress changes"; this is the closest derivable signal.
6. `[INFERRED]` **Run start/finish.** Inference: descope precise run start/finish events; approximate via stage entry/exit (which is already in the stage-transition event). Reason: `RalphPipelineState` lacks timestamps today; precise events depend on Plan 04.
7. `[INFERRED]` **One-shot mode emits artifacts.** Inference: a single `pnpm sync-ralph-state` run (no watcher) produces the snapshot, schema, data twin, and tasks-index. Activity events are still derivable in one-shot mode because `mergeAndWrite` diffs `currentState.byTaskId` against the new `state.byTaskId` — the cold-start path passes the pre-sync `currentState` exactly as the watcher does, so the diff produces events whenever the freshly assembled state differs from the prior on-disk sidecar. On the very first run (no prior sidecar) `currentState.byTaskId` is empty, so every task fires a first-observation event (`prevStage: null`); operators who want a quieter first-run can choose not to append those.
8. `[INFERRED]` **Config-key naming.** Inference: `outputs.snapshot`, `outputs.activity`, `outputs.activityBackup`, `outputs.dataJson`, `outputs.snapshotSchema`, `outputs.tasksIndex` as scalar path strings (camelCase, peers of existing `outputs.sidecarJs` / `outputs.sidecarJson`), plus `outputs.activityMaxLines` as an integer sibling (not a nested object under `activity`) — this keeps every known `outputs.*` key resolvable by the existing scalar-path logic in `resolve-config.mjs` while still making the cap configurable. Reason: consistent with the existing key shape and avoids a shape-mismatch in `resolveConfigPaths`.

### Open review findings (soft-cap, Medium only)

Plan review converged on the High findings (F-001, F-002, F-003) and on F-004. The review loop reached its soft-cap at iteration 5 with the following 8 Medium findings still open. None blocks implementation, but each should be addressed during the implementation pass.

**F-005 (Medium, Completeness — Snapshot schema; Approach > Architecture).** Story-progress activity events are underspecified. Suggested fix (inside the `mergeAndWrite` diff): explicitly enumerate the four diff dimensions — stage changed, `storyCompletion` changed, task removed (`newStage: null`), task first-observed (`prevStage: null`) — each becoming one `ActivityEvent` with `changedFields` populated accordingly. Document these four cases under Activity log rotation or a new "Activity event derivation" subsection.

**F-006 (Medium, Criteria Quality — Acceptance Criteria).** "`pnpm test` green" is vague; root `package.json` has no `test` script. Suggested fix: replace with explicit commands — `pnpm --filter @codexu/overview-viewer typecheck`, `pnpm --filter @codexu/overview-viewer test`, and the exact command for `scripts/lib` vitest tests (verify during implementation; likely a dedicated vitest invocation).

**F-007 (Medium, Ordering — Approach > Architecture; Implementation Strategy Phase C/D).** Plan gives two different owners for snapshot/schema/data-twin/tasks-index emission (Architecture says watcher; Phase C says `writeSidecar`). Suggested fix: pick `writeSidecar` (or an `emitAgentArtifacts` helper called from inside it) as the single integration point; the watcher's only Plan 05 responsibility becomes appending activity events from the returned `activityEvents`.

**F-008 (Medium, Feasibility — Acceptance Criteria; Open Questions inference 3).** The `npx ajv validate` criterion will not work just by adding `ajv` + `ajv-formats` — the CLI binary comes from `ajv-cli`. Recommend option (b): drop the CLI criterion and rely on a vitest test that imports ajv programmatically to validate `plans/overview-snapshot.json` against `plans/overview-snapshot.schema.json`. Update Open Question 3 accordingly.

**F-009 (Medium, Criteria Quality — Acceptance Criteria).** "Populated correctly when Plan 04 has shipped" is not verifiable on the current branch (Plan 04 fixtures absent). Suggested fix: split into two ACs — (1) absent-fixture defaults are correct, (2) when fixture `overview-recommendations.json` / `overview-dependency-graph.json` exist, the snapshot picks up their content unchanged (verified by a unit test in `scripts/lib/emit-snapshot.test.mjs` that creates the fixtures).

**F-010 (Medium, Ordering — Suggested Decomposition).** `emitter-modules` and `types-and-config` are both Phase 1 with no inter-dependency, but emitter `.d.mts` files reference `Snapshot` / `ActivityEvent` types. Suggested fix: mark `emitter-modules` as `dependsOn: ["types-and-config"]` (still Phase 1 execution order but serialized), and update both the markdown Suggested Decomposition section and `suggested-decomposition.json` sidecar atomically.

**F-011 (Medium, Completeness — Open Questions inference 7; Acceptance Criteria).** One-shot sync behavior re: the activity log is ambiguous. Suggested fix: state explicitly that `writeSidecar` ensures `plans/overview-activity.jsonl` exists (creates an empty file if absent) on every run, but the one-shot path may still emit first-observation events from the cold-start diff. Add an AC: "after the first `pnpm sync-ralph-state` on a fresh checkout, `plans/overview-activity.jsonl` exists (possibly with first-observation events when prior sidecar state existed)."

**F-012 (Medium, Criteria Quality — Acceptance Criteria).** Activity ACs only require a stage-transition line. Suggested fix: add four ACs — (1) `storyCompletion` change emits an event with `changedFields` containing `storyCompletion`, (2) deleting a fixture job directory emits `newStage: null`, (3) a retain/no-diff tick emits zero events, (4) a reader that JSON.parse-fails on the last line of `activity.jsonl` skips it and continues (documented in `AGENTS.md`). Cover via unit tests in `emit-activity.test.mjs`.

## Next Step

To implement this plan, run:

Skill("ralph-orchestration:implement-with-ralph", args="--from-plan .ralph/jobs/ralph-pipeline-05-agent-exports/plan.md --autonomous")

Or, to parallelize via the suggested decomposition:

Skill("ralph-orchestration:implement-with-ralph", args="--from-plan .ralph/jobs/ralph-pipeline-05-agent-exports/plan.md --parallel --suggested-decomposition .ralph/jobs/ralph-pipeline-05-agent-exports/suggested-decomposition.json --autonomous")
