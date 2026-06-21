# Stories Outline: Split `.ralph-overview/data.json` into hot + cold shards

*Preliminary decomposition from `/plan-with-ralph`. Feed to `/implement-with-ralph --from-plan` for PRD generation.*
*Dual-repo: Job 1 (ai-developer-toolkit / ralph-overview plugin) ships and is installed BEFORE Job 2 (codexu data migration). See plan.md §Dual-Repo Sequencing — do NOT generate one PRD across both.*

---

## JOB 1 — ralph-overview plugin (ai-developer-toolkit submodule)

## US-101: Shared store module (`data-store.mjs`)
**Description:** As the plugin, I want a single module that knows about the two shards so both the read loader and the write core share one assembler, de-dup, classification, path-derivation, and read-consistency guard.
**Acceptance Criteria:**
- [ ] New `scripts/lib/data-store.mjs` exports: `deriveColdFilePath(hotFile)` (sibling `<base>.archived<ext>`), `isColdShardPresent(coldFile)`, `classifyShard(task)` (**alias-aware**: `task.lifecycle ?? mapLegacyPhaseToLifecycle(task.phase)`; `COLD_LIFECYCLES = {merged,archived}`; single source of truth for partition/de-dup/migration/recovery), `partitionByLifecycle(tasks)`, `assembleTasks({hotData,coldData})` (concat hot++cold then shard-consistency de-dup), and `compositeDataMtimeMs(hotFile, coldFile)`.
- [ ] Store-generation seqlock helpers (Decision 9): `readStoreGeneration(genPath)`, `bumpStoreGeneration(genPath, phase)` (odd in-progress / even stable), and a synchronous `readStoreConsistent({hotFile,coldFile,genPath,maxRetries})` that does read-gen → read-both(+presence) → read-gen with bounded retry and a total fallback (never throws).
- [ ] De-dup: for an id present in both shards, keep the shard-consistent copy and drop the misfiled copy; relocate a single misfiled task; a both-consistent OR both-misfiled duplicate is reported (for the caller to reject on the write path / resolve+warn on the read path).
- [ ] `data-store.test.mjs` covers each helper incl. alias-aware classification, the three de-dup cases, and a seqlock retry that converges.
- [ ] `npm run test:lib` (the new test) and `npm test` pass; typecheck passes.
**Dependencies:** None
**Estimated complexity:** medium

## US-102: Split-aware, total, seqlock-guarded read assembler in `loadOverviewData`
**Description:** As the watcher and MCP, I want `loadOverviewData` to assemble the identical `{tasks:[...]}` from both shards without ever throwing on a lock-free torn read.
**Acceptance Criteria:**
- [ ] `loadOverviewData(dataFile, { coldFile } = {})` resolves `coldFile ?? deriveColdFilePath(dataFile)`; when the cold shard exists, reads both via `readStoreConsistent` (Decision 9), `assembleTasks`, then `normalizeOverviewData` over the union.
- [ ] The read path NEVER throws on a transient torn read: it resolves duplicates (consistent-wins; transient both-consistent/both-misfiled → prefer cold + warn) and tolerates a transient zero-copy.
- [ ] When the cold shard is absent, behavior is byte-identical to today (legacy single-file passthrough).
- [ ] Assembled task order is hot.tasks (file order) then cold.tasks (file order); stays synchronous (no async ripple to call sites).
- [ ] A fixture proves the assembled object equals loading the equivalent pre-split single file (modulo defined ordering); an interleaving test samples a reader MID-move and gets a consistent set.
- [ ] Typecheck + `npm test` pass.
**Dependencies:** US-101
**Estimated complexity:** medium

## US-103: Config `coldFile` + SnapshotReader cold-shard awareness
**Description:** As the MCP server, I want config to carry `coldFile` and the SnapshotReader to watch + mtime-guard both shards.
**Acceptance Criteria:**
- [ ] `default-config.mjs` adds `coldFile: '.ralph-overview/data.archived.json'`; `resolve-config.mjs` resolves it (absolute) via the explicit destructure AND throws when `dirname(coldFile) !== dirname(dataFile)`.
- [ ] `SnapshotReader` constructor resolves `config.coldFile`; `start()` adds it to the chokidar paths; `getOverviewData()` mtime-guards on `compositeDataMtimeMs(hot,cold)` and passes `{coldFile}` to `loadOverviewData`; `#invalidate()` invalidates the overview cache on a hot OR cold change.
- [ ] A snapshot-reader test mutating ONLY the cold file invalidates the cache and re-reads.
- [ ] A config-resolution test covers the same-dir guard (throws on a different dir).
- [ ] Typecheck + `npm test` + `npm run build --workspace=tools/overview-mcp` pass.
**Dependencies:** US-101, US-102
**Estimated complexity:** medium

## US-104: Store-aware write core (`runVerb`) with the 3-step misfile move
**Description:** As the data-edit CLI and MCP write tools, I want `runVerb` to operate on the two-shard store under one lock with crash-safe moves, so all 5 verbs work identically and atomically across shards.
**Acceptance Criteria:**
- [ ] `loadStore(hotFile, coldFile)` loads both shards (or legacy single), runs the de-dup recovery on load, and rejects an ambiguous manual duplicate.
- [ ] `validateInvariants` spans the union (dup-id Set + count deltas over hot+cold; raw multiset checked for manual dupes).
- [ ] A verb that changes a task's shard brackets the 3-step misfile protocol (source-misfile → destination-append → source-remove) with store-generation bumps (odd before, even after), each step an `atomicWriteFile`, under ONE `${hotFile}.lock`. Non-moving verbs write only the changed shard in place; `upsert-task` of a new task → hot only.
- [ ] The LOCKED write path rejects a both-consistent / both-misfiled manual duplicate (data untouched); the load-time de-dup repairs a torn one-consistent-one-misfiled state.
- [ ] Simulated-crash fixtures at EACH step boundary for BOTH ship (tracked→merged) and reopen (merged→tracked) recover to the single correct copy, losing no task.
- [ ] CLI and MCP writes are byte-identical against the split store, including a move (roundtrip test extended to both shards).
- [ ] Legacy mode (cold absent) writes single-file exactly as today (back-compat test).
- [ ] Two concurrent verbs (one cold, one hot) serialize on the store lock (lock test).
- [ ] Typecheck + `npm test` + MCP build pass.
**Dependencies:** US-101, US-102
**Estimated complexity:** large

## US-105: Watcher cold-shard awareness (invariant #14 preserved)
**Description:** As the watcher, I want a cold-shard change to emit `{kind:'data'}` without adding a new or deeper chokidar instance.
**Acceptance Criteria:**
- [ ] The depth-0 data-file watcher's `ignored` predicate also allows `config.coldFile`; `parseWatchedPath` also matches the cold basename → `{kind:'data'}`.
- [ ] No new chokidar instance and no depth change (invariant #14 unchanged).
- [ ] `watch-ralph-state.test.mjs` proves a cold-file change is enqueued as a data change.
- [ ] Typecheck + `npm test` pass.
**Dependencies:** US-103
**Estimated complexity:** small

## US-106: `validate-data` over the assembled union
**Description:** As `overview.validate_data`, I want to validate the assembled hot+cold set (incl. the union dup-id + manual-dup flag), keeping the 3-surface drift-check green.
**Acceptance Criteria:**
- [ ] When validating the configured data file in split mode, validate the assembled union; flag a manual cross-shard duplicate.
- [ ] An explicit `path`/`content` input validates that single input as today (back-compat).
- [ ] Zod mirror + `validate-data.test.ts` (3-surface drift) stay green.
- [ ] Typecheck + `npm test` + MCP build pass.
**Dependencies:** US-101, US-102
**Estimated complexity:** medium

## US-107: COLD-FIRST idempotent `migrate-split` command
**Description:** As an operator, I want a one-shot, idempotent, crash-safe command that partitions a single `data.json` into hot + cold.
**Acceptance Criteria:**
- [ ] New `scripts/migrate-split.mjs` wired as `data-edit migrate-split` (via `scripts/data-edit.mjs` / `bin/ralph-overview.mjs`), runs under the store lock.
- [ ] Partitions by alias-aware lifecycle; brackets its writes with store-generation bumps; writes COLD shard FIRST (full hot still present), THEN slims the hot shard; both canonical; original relative order preserved within each partition.
- [ ] A crash between the cold write and the hot slim is recoverable (split mode + de-dup keeps cold copies); never produces `hot-slim + cold-absent`. A reader sampled mid-migration returns a consistent set (seqlock retry).
- [ ] Re-running in `hot-full + cold-present` completes the slim; re-running fully-split is a byte no-op; genuinely inconsistent manual state errors unless `--force`.
- [ ] Migration crash-window + idempotency tests pass.
- [ ] Typecheck + `npm test` pass.
**Dependencies:** US-101, US-104
**Estimated complexity:** medium

## US-108: Composite-mtime for the other read surfaces
**Description:** As the MCP read tools, I want cold-only edits to invalidate the PRD-memo/staleness and PRD loader so they never serve stale or hot-only data.
**Acceptance Criteria:**
- [ ] `parallel-ready-tasks.ts` keys its PRD-memo + stale-snapshot reasoning on `compositeDataMtimeMs(hot,cold)` rather than hot-only `dataMtimeMs`.
- [ ] `load-prds-by-task-id.mjs`'s local data-loader fallback uses the split-aware assembler (or is passed the assembled `overviewData`) — never hot-only.
- [ ] A test mutating only the cold file invalidates the `parallel-ready-tasks` memo/staleness.
- [ ] Typecheck + `npm test` + MCP build pass.
**Dependencies:** US-101, US-102
**Estimated complexity:** small

## US-109: Version bump + docs + marketplace indexes
**Description:** As a consumer, I want the new behavior shipped as 2.12.0 with the indexes, AGENTS.md, CHANGELOG, and a short design doc updated.
**Acceptance Criteria:**
- [ ] `plugin.json` (`.github/plugin/` + `.claude-plugin/`) → 2.12.0; all 3 marketplace indexes' `ralph-overview` version → 2.12.0 (invariant #6); codex policy enum still valid.
- [ ] Plugin `AGENTS.md` documents the two-shard model, the misfile move protocol + de-dup rule, `config.coldFile` + same-dir constraint, and `migrate-split`.
- [ ] `CHANGELOG.md` prepends a 2.12.0 entry; a short `docs/data-json-split.md` describes the model + migration.
- [ ] `npm test` + MCP build green.
**Dependencies:** US-101..US-108
**Estimated complexity:** small

---

## JOB 2 — codexu (consumer) — ONLY after Job 1 ships + plugin updated + watcher/MCP restarted

## US-201: Migrate codexu data to the split + verify
**Description:** As codexu, I want my `data.json` partitioned into hot + cold via the new plugin, verified equivalent.
**Acceptance Criteria:**
- [ ] The running watcher + MCP are stopped/restarted (overview-reset) and the running plugin is confirmed 2.12.0 BEFORE migration.
- [ ] `data-edit migrate-split` produces `.ralph-overview/data.json` (≈68 tracked + metadata, ~77% smaller) and `.ralph-overview/data.archived.json` (231 merged+archived); union id-set == pre-migration id-set.
- [ ] Through a freshly restarted split-aware process, `pnpm sync-ralph-state` emits a `snapshot.json` whose task set equals the pre-migration set (ordering/timestamps excepted).
- [ ] Both shards committed (no `git add -A`; explicit stage; no CLAUDE.md).
**Dependencies:** US-101..US-109 (Job 1 shipped + installed + restarted)
**Estimated complexity:** small

## US-202: Submodule pointer + codexu docs
**Description:** As codexu, I want the submodule pointer bumped and the docs reflecting the two-file consumer model.
**Acceptance Criteria:**
- [ ] `ai-developer-toolkit` submodule pointer bumped to the Job-1 ship commit; codexu `AGENTS.md` active-plugin-versions table → ralph-overview 2.12.0.
- [ ] codexu `AGENTS.md` two-file bookkeeping notes + `tools/data-edit.mjs` docstring mention the hot/cold shards where they reference the single file.
- [ ] No CLAUDE.md staged; CI invariant (version table matches submodule manifest) passes.
**Dependencies:** US-201
**Estimated complexity:** small
