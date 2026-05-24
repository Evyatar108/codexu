# Research Brief — Plan 05 Refinement (agent-readable exports)

## Researcher Findings (Explore agent — verified file/line)

### Plan 02 watcher contract (MERGED, stable)
- `scripts/lib/sync-core.mjs` exports: `walkRalphState` (L35), `readBundleForSlug` (L47), `assembleStateFromBundles` (L86), `deriveAffectedTaskUpdate` (L139), `mergeAndWrite` (L232), `writeSidecar` (L289). Atomic write helper `atomicWriteFile` at L301–324 (tmp+fsync+rename retry).
- `scripts/lib/watch-ralph-state.mjs` exports `start({...})` (L16). Debounce buffer `pendingChanges = new Map()` (L33), stores `{ kind, slug }` per `changeKey(kind, slug)` (L296). `flushPending` (L92), calls `deriveAffectedTaskUpdate` (L105–106), then `mergeAndWrite` (L134–140), then assigns `currentState = result.state` (L141). **`prevStage` is NOT tracked anywhere in the debounce buffer** — has to be captured before `currentState` is overwritten.
- `scripts/lib/sync-lock.mjs` exports `acquireLock` (L6), `releaseLock` (L27), **`touchLock` (L34)** — correct export name per commit 5d766c11.
- `deriveAffectedTaskUpdate` return shape: `{ action: 'upsert'|'remove'|'retain', taskId?, kind, slug, byTaskId?, newPipelineState?, touched, unmatchedFragment }`. **Does NOT expose the prior state.**

### Type-migration boundary with Plan 03 — CRITICAL CORRECTION
- **`FilterAxis` does NOT live in `tools/overview-viewer/src/types.ts`.** It lives in `tools/overview-viewer/src/utils/filters.ts`. Plan 03 only edits `filters.ts`. **types.ts has zero overlap with Plan 03.** (Confirmed by Codex AND Copilot.)
- `tools/overview-viewer/src/types.ts` current state:
  - `RalphStage` union: L36–46.
  - `RalphPipelineState`: L59–73 — **no `runDurations` field present.**
  - `OverviewRalphState`: L75–81 — **no `runDurations` field present.** Existing plan's claim that `runDurations` lives in `OverviewRalphState` is STALE (it was a Plan 04 artifact and Plan 04 has not shipped).
- No existing `Snapshot`, `SnapshotTask`, `ActivityEvent` types in the file.

### `runDurations` location reality
- `runDurations` is **not** currently in `OverviewRalphState` (`grep` confirmed). It was a Plan 04 artifact. Plan 04 has not shipped (`scripts/lib/score-recommendations.mjs` and `scripts/lib/derive-dependency-graph.mjs` do not exist on `main`).
- Refined plan must drop the "migrate `OverviewRalphState.runDurations` → `Snapshot.runDurations`" wording and treat `Snapshot.runDurations` as a **new** field added by Plan 05 (Plan 04 will populate it when it ships).

### Schema / config landing zones
- No root `schemas/` directory.
- No root `CLAUDE.md` is tracked. Repo uses `AGENTS.md` for root agent guidance (root CLAUDE.md is intentionally gitignored/personal). **Existing plan's "modify root CLAUDE.md" line must change to `AGENTS.md`.**
- `tools/overview-viewer/CLAUDE.md` exists and is the right place for the dashboard-side note.
- Config files: `.ralph/overview-config.json`, `.ralph/overview-config.schema.json`, `scripts/lib/resolve-config.mjs`, `scripts/lib/default-config.mjs`, plus `scripts/lib/default-config.d.mts`. **All five must be updated together if adding output config keys.** Otherwise unknown `outputs.*` keys pass through unresolved.

### Job-artifact directory layout (today)
- `.ralph/jobs/<slug>/` contains job-state.json, prd.json, worktree/, plus plan/review artifacts when relevant. **No snapshot.json / activity.jsonl / INDEX.md anywhere yet.**
- `plans/overview-ralph-state.{js,json}` already exist (Plan 02 sidecar). Plan 05 adds peers: `overview-snapshot.json`, `overview-activity.jsonl`, `overview-snapshot.schema.json`, `overview-data.json`.
- `tasks/` directory exists but only contains legacy `prd-*.md` files (`prd-1a-fork-doc.md`, `prd-port-explorer-prompt.md`). `tasks/INDEX.md` does not exist.

### Test infrastructure
- Test runner is **vitest** (`scripts/lib/sync-core.test.mjs` imports from `'vitest'`). Existing test helpers: `makeTempDir`, `writeJson`, `buildConfig`, `writeOverviewData`, `writeJobState`, `writeGroupState`.
- **No tests for `watch-ralph-state.mjs` yet.**
- TypeScript declarations: `tools/overview-viewer/src/__tests__/scripts.d.ts` and `scripts/lib/*.d.mts` must be updated for any new emitter exports.

### Downstream-plan stale references (to fix in cascade)
- **Plan 06** — reads `plans/overview-snapshot.json` + `plans/overview-recommendations.json`. Compatible.
- **Plan 07** — reads `plans/overview-activity.jsonl`. Compatible. Will extend `RalphPipelineState` (deferredQuestionsCount, branchName, prUrl, etc.) — snapshot picks up extensions automatically.
- **Plan 08** — current wording says "merge crew sessions into snapshot." That implies mutating the snapshot directly. **Stale — must change to "extend `RalphPipelineState.crewSessions` so sync regenerates snapshot from authoritative source."** The snapshot stays derived, never authoritative.
- **Plan 09** — primary input is `plans/overview-snapshot.json`. Existing reference "import JSON Schema as TypeScript" may need rewording (use generated TS types OR JSON schema separately).
- **`plans/ralph-pipeline-INDEX.md`** — Source-of-truth table and DAG must add the new Plan 05 artifacts.

## Architect Analysis (Explore agent)

### Integration recommendation
**Option (a): sibling writers inside `watch-ralph-state.mjs`** — emit snapshot+activity at the same write boundary as the sidecar, within the existing lock window. Rejects option (b) separate module (race window where snapshot reflects T1 but activity captures T2) and option (c) lazy compute (activity loses prevStage by the time it's recomputed). Single atomic window guaranteed.

### Activity-event derivation — minimal watcher change
1. In `flushPending`, BEFORE calling `deriveAffectedTaskUpdate`, walk the `changes` list and capture `prevStateMap: Map<taskId, RalphStage>` from `currentState.byTaskId[taskId]?.stage`. Use a new helper `findCurrentTaskIdForSlug(currentState, kind, slug)` extracted from sync-core L195.
2. Extend `mergeAndWrite` signature with optional `prevStateMap`.
3. Inside `mergeAndWrite`, after the new state is computed, derive activity events by comparing `prevStateMap.get(taskId)` to `state.byTaskId[taskId]?.stage`. Return events alongside the new state.
4. Watcher appends events to `activity.jsonl` after the successful write (so a failed write doesn't leak phantom events).

### Atomicity
- **snapshot.json:** reuse `atomicWriteFile` (sync-core L301–324) — tmp + fsync + rename retry.
- **activity.jsonl:** open in append, single `writeSync(line + '\n')`, fsync, close. Lines ≤ PAGE_SIZE (~4KB) are atomic on common filesystems.
- **rotation:** when the file reaches 1000 lines, rename to `.1.jsonl` (overwriting any prior backup) BEFORE appending the new event.
- All writes must occur inside the existing `sync-lock.mjs` window (already held by the watcher's flush).

### Schema versioning
- `schemaVersion: 1` (integer, NOT semver). Bump on breaking changes (rename/remove). Adding optional fields stays at v1 — agents ignore unknown keys.

### Top risks
1. **prevStage capture races state mutation** — keep `prevStateMap` immutable and local to the flush closure.
2. **activity.jsonl partial-write corruption** — guarantee single `writeSync` call per line, ≤4KB.
3. **Schema drift as Plans 07/08 add fields** — document in `AGENTS.md` that adding fields is non-breaking; agents use field-existence checks.
4. **Lock contention** — new writes stay inside the existing flush lock window; do not spawn async I/O outside the lock.

## Codex Research

### Confirmation points (with corrections to existing plan)
- Plan 02 contract is the integration point; reject any new polling loop.
- `loadOverviewData()` in `sync-core.mjs` is **private** — must be extracted/exported before `emit-snapshot.mjs` can reuse it to write `overview-data.json`.
- **Config files to update together (5):** `default-config.mjs`, `default-config.d.mts`, `resolve-config.mjs`, `.ralph/overview-config.schema.json`, plus the tests that exercise config (`tools/overview-viewer/src/__tests__/config.test.ts`).
- Activity events are derivable for stage transitions, story progress (compare `storyCompletion`), and deletions. **Run start/finish is NOT fully derivable** from `deriveAffectedTaskUpdate` alone — `RalphPipelineState` does not carry `createdAt`/`completedAt` today. Plan 05 should descope precise run start/finish events to "approximate" or defer to Plan 04.
- **`ajv` is not a direct dev dependency.** Acceptance criterion `npx ajv validate -s ... -d ...` may fail. Either add `ajv` as a direct dev dependency or replace with a small Node test that uses ajv (transitively present in lockfile).
- **Append BEFORE vs AFTER successful write:** Codex disagrees with existing plan L60/L167. Recommend computing the activity payload BEFORE the merge (to capture prevStage), but APPENDING it AFTER a successful state write, otherwise phantom log entries pile up on failures. Architect agrees.

### Stale references in existing plan
- `scripts/lib/score-recommendations.mjs`, `scripts/lib/derive-dependency-graph.mjs` — Plan 04 artifacts, do not exist on main. Existing plan treats them as already-shipped; refined plan must condition on their presence.
- "Migrate `OverviewRalphState.runDurations`" — stale; field doesn't exist there today.
- Root `CLAUDE.md` edit — wrong file; should be `AGENTS.md`.
- "depends on Plan 01" (line 5) — should be "depends on Plans 01 and 02"; Plan 02 is required (watcher contract).
- "merged to main after Phase 6" (line 3) — operator says all work stays on `ralph-pipeline-05-agent-exports` branch; do not state merge-to-main path in this plan.

### Cascade
- Plan 06 — verify `/triage` reads `snapshot.recommendations` vs old `overview-recommendations.json`.
- Plan 07 — verify activity ordering with journal/notepad emissions.
- Plan 08 — rewrite "merge into snapshot" → "extend source state".
- Plan 09 — clarify TS-types vs JSON-schema consumption.
- `plans/ralph-pipeline-INDEX.md` — update DAG + source-of-truth table.

## Copilot Research

Concurs with Codex on all major points. Additional emphasis:
- **Worktree wording fix:** existing plan L3 says "merged to main after Phase 6" — the operator explicitly says all work stays on the branch. Refined plan should drop the merge-to-main clause.
- **Plan 05 depends on Plan 02**, not "independent of 02/03/04" (existing plan L5).
- **JSON twin for `tasks/INDEX.md`:** acceptance criterion says "dual JSON twin for any markdown surface." `tasks/INDEX.md` needs a `tasks/INDEX.json` companion, OR the plan must state explicitly that `overview-snapshot.json` IS the machine-readable twin. Recommend the latter for v1 (avoids double-writing the same data).
- **Declarations to update:** `scripts/lib/*.d.mts` + `tools/overview-viewer/src/__tests__/scripts.d.ts` for new emitter exports.

## Consensus (3+ reviewers)

1. **Plan 02 is the integration point** — reuse merged watcher/sync-core API.
2. **`prevStage` capture requires NEW watcher work** — capture `prevStateMap` from `currentState` before `deriveAffectedTaskUpdate`. Pass through `mergeAndWrite`.
3. **`runDurations` is NOT in `OverviewRalphState` today** — drop "migrate from X to Y" wording; add as new Snapshot field.
4. **`FilterAxis` is in `utils/filters.ts`, not `types.ts`** — Plan 03 collision risk on `types.ts` is OVERSTATED in the user request. They are in different files. Plan 05 only adds new exports to `types.ts`.
5. **Root `CLAUDE.md` → `AGENTS.md`** — root CLAUDE.md is not tracked.
6. **Plan 04 artifacts are NOT shipped** — `score-recommendations.mjs`, `derive-dependency-graph.mjs`, `overview-recommendations.json`, `overview-dependency-graph.json` are all conditional. Plan 05 must handle their absence gracefully.
7. **Append activity AFTER successful state write** — capture payload BEFORE, append AFTER. (Disagrees with existing plan L60/L167.)
8. **`ajv` validation acceptance criterion needs hardening** — add ajv as direct dev dep or use a Node-based check.
9. **All five config files must update together** when adding output config keys.
10. **Cascade Plan 08 wording** — snapshot stays derived; Plan 08 extends source state, not snapshot directly.

## Divergences

- **Schema location** (codex/copilot): `plans/overview-snapshot.schema.json` (co-located, recommended for v1) vs `schemas/agent-export.schema.json` (dedicated dir). Researcher recommends co-located; defer `schemas/` extraction to Plan 12. **Decision: co-locate at `plans/overview-snapshot.schema.json` for v1.**
- **`tasks/INDEX.md` JSON twin** (copilot vs architect): explicit `tasks/INDEX.json` vs "snapshot.json is the twin." **Decision: snapshot.json is the canonical JSON twin; INDEX.md is human-only navigation. Document this in the plan's "Common mistakes."**

## Recommended amendments to existing plan

1. **Dependencies block:** change "depends on Plan 01" → "depends on Plans 01 and 02".
2. **Worktree block:** drop "merged to main after Phase 6"; state explicitly that the branch is the deliverable.
3. **Files to modify → `tools/overview-viewer/src/types.ts`:** remove "Migrate `OverviewRalphState.runDurations`" — replace with "Add `Snapshot.runDurations` as a new field (populated by Plan 04 when shipped)."
4. **Files to modify → root CLAUDE.md:** replace with **`AGENTS.md`** (and keep `tools/overview-viewer/CLAUDE.md`).
5. **Add to "To modify":** `scripts/lib/sync-core.mjs` must extract/export `loadOverviewData`. Also `scripts/lib/default-config.mjs`, `scripts/lib/default-config.d.mts`, `scripts/lib/resolve-config.mjs`, `.ralph/overview-config.json`, `.ralph/overview-config.schema.json` (config-key updates). And `tools/overview-viewer/src/__tests__/scripts.d.ts`.
6. **prevStage capture path:** rewrite L61 wording — capture `prevStateMap: Map<taskId, RalphStage>` in watcher BEFORE `deriveAffectedTaskUpdate`; thread through `mergeAndWrite` (new optional arg); have `mergeAndWrite` return `activityEvents`; have watcher append after successful write.
7. **Activity append ordering:** rewrite L60 and "Common mistake #3" — capture BEFORE merge, append AFTER successful write. Update.
8. **Drop `--strict` ajv acceptance line OR add ajv dev dep:** acceptance criterion L138 — replace with a Node test that runs ajv via the transitive copy, OR explicitly add `pnpm add -D ajv ajv-formats` in implementation strategy.
9. **Plan 03 coexistence:** narrow the "shared file" risk — `types.ts` only adds new exports (Plan 05 owns Snapshot/SnapshotTask/ActivityEvent at file end). `FilterAxis` is in a different file. State this explicitly.
10. **Conditional Plan 04 outputs:** clarify the snapshot's `recommendations` and `dependencyGraph` fields are `[]` and `{}` (or `null`) when Plan 04 has not shipped; existing plan already hints at this but acceptance criteria should match.
11. **Acceptance criteria — add cascade items:** `plans/ralph-pipeline-08-crews.md` "merge into snapshot" wording rewritten. INDEX cascade updated. List the specific plan files audited.
12. **Suggested Decomposition section** is required by the planner skill — partition into emitter-build, watcher-wire, sync-core-wire, types+docs, cascade clusters.

## Consolidated File List

### Files to MODIFY
- `scripts/lib/sync-core.mjs` — extract/export `loadOverviewData`; extend `writeSidecar` flow to emit snapshot/activity/data-twin/schema/tasks-index; extend `mergeAndWrite` with optional `prevStateMap` and `activityEvents` return.
- `scripts/lib/watch-ralph-state.mjs` — capture `prevStateMap` before `deriveAffectedTaskUpdate`; pass through; append activity after successful write.
- `scripts/lib/sync-lock.mjs` — read-only (already provides `touchLock`).
- `scripts/lib/default-config.mjs` + `scripts/lib/default-config.d.mts` — add output keys for `snapshot`, `activity`, `activityBackup`, `dataJson`, `snapshotSchema`, `tasksIndex`.
- `scripts/lib/resolve-config.mjs` — resolve new output keys.
- `.ralph/overview-config.json` — populate concrete paths.
- `.ralph/overview-config.schema.json` — extend `outputs` properties.
- `scripts/sync-ralph-state.mjs` — verify CLI exposes the new emissions on one-shot runs (currently delegates to `walkRalphState` + `writeSidecar`).
- `tools/overview-viewer/src/types.ts` — add `Snapshot`, `SnapshotTask`, `ActivityEvent`. (No removal of `runDurations` from `OverviewRalphState` — field is not there today.)
- `tools/overview-viewer/src/__tests__/scripts.d.ts` — add ambient declarations for new emitter modules.
- `AGENTS.md` (root) — append agent-pointer line.
- `tools/overview-viewer/CLAUDE.md` — append "## Ralph state sidecar" section.

### Files to CREATE
- `scripts/lib/emit-snapshot.mjs` — pure `buildSnapshot({...}) -> Snapshot`.
- `scripts/lib/emit-activity.mjs` — `appendActivity(repoRoot, event)` + `rotateActivity(repoRoot)`.
- `scripts/lib/emit-tasks-index.mjs` — `buildTasksIndex(snapshot) -> string` markdown.
- `scripts/lib/emit-snapshot-schema.mjs` — hand-written JSON schema for `Snapshot`.
- `scripts/lib/emit-snapshot.d.mts` + `.d.mts` for each new emitter — ambient TS declarations.
- `plans/overview-snapshot.json` — generated artifact.
- `plans/overview-data.json` — generated artifact.
- `plans/overview-activity.jsonl` — generated artifact (append-only).
- `plans/overview-activity.1.jsonl` — rotation backup (created at rollover).
- `plans/overview-snapshot.schema.json` — generated artifact.
- `tasks/INDEX.md` — generated artifact.
- Tests:
  - `scripts/lib/emit-snapshot.test.mjs`
  - `scripts/lib/emit-activity.test.mjs`
  - `scripts/lib/emit-tasks-index.test.mjs`
  - `scripts/lib/emit-snapshot-schema.test.mjs` (validates schema against itself + a sample snapshot)
  - Optional integration test in `scripts/lib/sync-core.test.mjs` exercising the new emissions.

### Cascade — files to AUDIT and update
- `plans/ralph-pipeline-06-skills.md` — verify recommendations consumption path.
- `plans/ralph-pipeline-07-context.md` — verify activity.jsonl consumption ordering.
- `plans/ralph-pipeline-08-crews.md` — rewrite any "merge into snapshot" wording to "extend source state".
- `plans/ralph-pipeline-09-mcp.md` — clarify TS-types vs JSON-schema reuse.
- `plans/ralph-pipeline-10*.md`, `11*.md`, `12*.md` (if exist) — scan for Plan 05 references.
- `plans/ralph-pipeline-INDEX.md` — update Source-of-truth table + DAG with new Plan 05 artifacts and revised dependency (`05 → 02`, not isolated).
