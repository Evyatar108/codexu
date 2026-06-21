# Research Brief — split `.ralph-overview/data.json` (active-vs-archived, D-001)

*Seeded from brainstorm `.ralph/brainstorms/ralph-overview-data-split/` (shipped 161fbe00).
Research performed by reading the live plugin source under
`ai-developer-toolkit/plugins/ralph-overview/`. All paths below are inside that
plugin unless noted as codexu (consumer) paths.*

## Measured facts (live, 2026-06-21)

- `.ralph-overview/data.json`: **299 tasks, 1,917,458 bytes (~1.83 MiB)**.
- Lifecycle split: **tracked 68 / merged 215 / archived 16** → cold (merged+archived)
  = **231 = 77.3%**; hot (tracked) = **68 = 22.7%**.
- Top-level non-task keys (13): `ui, generatedAt, generatedFromCommit, phaseTree,
  lastTouched, periodic, cadence, runs, effort, risk, workstream, sizeBucket,
  spawnedFrom`.
- Plugin version: **2.11.0** (`.github/plugin/plugin.json`, `.claude-plugin/plugin.json`).

## Read chokepoints (where the file is parsed into `{tasks:[...]}`)

There are **two loader functions**, behind **three logical read surfaces**:

1. `scripts/lib/sync-core.mjs :: loadOverviewData(dataFile)` (line 845).
   - `fs.existsSync` guard → `{}` if absent.
   - Extension dispatch: `.json` → `parseOverviewDataJson`; `.js/.mjs/.cjs` →
     `parseOverviewDataJs` (+ one-shot legacy warn); else throws.
   - Returns `normalizeOverviewData(parsed.data)` — WRITE-SIDE normalization that
     upgrades legacy task shapes (`phase`→`lifecycle`, `planPrompt`→`prompts.plan`,
     derive `initialStage`).
   - **Consumers:** the watcher (`assembleStateFromBundles`, `walkRalphState`,
     `deriveAffectedTaskUpdate`, several call sites lines 104/295/318/528/565/1031),
     and the MCP `SnapshotReader.getOverviewData()`.
2. `scripts/lib/data-edit-core.mjs :: loadData(dataFilePath)` (line 27).
   - Source-preserving: `parseOverviewDataJson` (plain `JSON.parse`), **NEVER**
     `loadOverviewData` (avoids legacy normalization rewriting unrelated tasks).
   - Returns `{ raw, data }` (raw = verbatim bytes for minimal-diff).
   - **Consumer:** the write core `runVerb` (CLI `data-edit` + the 5 MCP write tools).
3. MCP `tools/overview-mcp/src/snapshot-reader.ts :: getOverviewData()` (line 85)
   — calls `loadOverviewData(config.dataFile)`. It is **mtime-guarded** on the data
   file (re-reads only when mtime changes; line 86-101) and the chokidar watch list
   at `start()` includes `config.dataFile` (line 42), invalidating the cache on
   change (`#invalidate`, line 129).

`parseOverviewDataJson(content)` (`scripts/lib/parse-overview-data.mjs:24`) is plain
`JSON.parse` + "root must be object" check; `parseOverviewData(content,{kind})`
dispatches js/json (default js for back-compat).

## Write core (single chokepoint for ALL mutations)

`scripts/lib/data-edit-core.mjs`:
- `runVerb({ dataFile, verb, args, lockPath, staleAfterMs })` (line 272):
  acquire lock (default `${dataFile}.lock`) → `loadData` → `applyVerb` (deep-clone,
  mutate target task by exact id) → `validateInvariants(before, after, verb, id)` →
  `serialize` → `writeData`(=`atomicWriteFile`) → return `{affectedId, verb, changed, diff}`.
  Lock wraps the **whole read-mutate-write cycle**.
- `VERBS = [mark-shipped, upsert-task, set-lifecycle, add-kanban-card, set-prompts]`.
  `LIFECYCLES = [tracked, merged, archived]`.
- `applyVerb`:
  - `set-lifecycle`: sets `task.lifecycle` + `lastTouchedAt`.
  - `mark-shipped`: sets `lifecycle='merged'`, `shipManifest`, `lastTouchedAt`.
  - `add-kanban-card` / `set-prompts`: in-place field edits (no lifecycle change).
  - `upsert-task`: insert/replace by id; canonicalizes top-level key order `{id, ...incoming}`
    so CLI (key-order-preserving) and MCP (Zod hoists `id`) produce **byte-identical** writes.
- `validateInvariants` (line 150): re-parse serialized JSON; every task has non-empty
  string id matching `^[A-Za-z0-9_./-]+$`; **dup-id `Set`**; target id present;
  count deltas (in-place preserves `tasks.length`; upsert insert adds exactly 1).
  **Operates on a single `after` object today — must be made to span both shards.**
- `serialize(data)` = `` `${JSON.stringify(data,null,2)}\n` `` (2-space, trailing LF).
- `unifiedDiff` produces one tight hunk via prefix/suffix trim (per-file).

Two thin surfaces over the core, both pass `dataFile: config.dataFile`:
- CLI: `scripts/data-edit.mjs` (line 184) `runVerb({ dataFile: config.dataFile, ... })`.
- MCP: `tools/overview-mcp/src/tools/data-write.ts` (line 61) `runVerb({ dataFile: context.config.dataFile, ... })`.
Byte-parity asserted by `tools/overview-mcp/src/__tests__/data-write-roundtrip.test.ts`.

## Lock + atomic write

- `scripts/lib/sync-lock.mjs`: `acquireLock({lockPath, processLabel, staleAfterMs})`
  uses `wx` create + stale/PID-liveness reclaim; `releaseLock` rms the file.
- `scripts/lib/atomic-write.mjs`: `atomicWriteFile(finalPath, contents)` = write
  `${finalPath}.tmp` (fsync) → rename-with-retry (EBUSY/EACCES/EPERM, 3×). **Per-file
  atomic** (rename), so a single shard write is crash-atomic; a two-shard MOVE is NOT
  atomic across files — hence the add-before-remove + load-time de-dup contract.

## Config resolution

- `scripts/lib/default-config.mjs`: `dataFile: '.ralph-overview/data.json'`;
  `lockFile: '.ralph-overview/generated/.lock/sync.lock'` (that is the SYNC/watcher
  lock, NOT the data-edit lock); `outputs.activeTasksJson`,
  `outputs.summaryProjectionJson` already exist; `watcher.ignored` list.
- `scripts/lib/resolve-config.mjs`: `loadConfig({repoRoot, configPath})` merges
  default ← committed (`.ralph-overview/config.json`) ← local overlay, then
  `resolveConfigPaths` resolves each known key to an absolute path via **explicit
  destructuring** (line 122+). A NEW config key (e.g. `coldFile`) must be added BOTH
  to `default-config.mjs` AND to the explicit destructure+resolve in
  `resolve-config.mjs` (else it flows through `unknownRoot` UNRESOLVED/relative).
  Array values REPLACE (not append) on merge (invariant #14 caveat for `watcher.ignored`).

## Watcher data-file watch (invariant #14 — Windows depth-cap correctness)

`scripts/lib/watch-ralph-state.mjs`:
- `getWatchRoots(config)` (line 394) returns roots; `roots[5]=dirname(dataFile)`,
  `roots[6]=dataFile`.
- `start()` builds 3 chokidar instances with pinned depth caps; the data-file one
  (line 335-345) watches `dataRoot` at **depth 0** with an `ignored` predicate that
  allows ONLY `dataRoot` itself and `config.dataFile` (line 342).
- `parseWatchedPath` (line 447-455) emits `{kind:'data'}` when a changed path under
  `dataRoot` has basename === `basename(dataFile)`.
- **Cold file is a sibling in the SAME dir** (`.ralph-overview/`) → already enumerated
  at depth 0. Split only needs: (a) allow the cold basename in the `ignored` predicate;
  (b) recognize the cold basename in `parseWatchedPath`. No new watcher instance, no
  depth change → invariant #14 preserved.

## Projections / snapshot / derived artifacts (consume the assembled object → unchanged)

`scripts/lib/emit-projections.mjs` (`active-tasks.json` = lifecycle==='tracked';
`summary-projection.json` = all tasks, prompts/descriptionHtml stripped),
`emit-snapshot.mjs`, `emit-tasks-index.mjs`, `score-recommendations.mjs`,
`derive-dependency-graph.mjs` — ALL receive the already-assembled `overviewData` /
`{tasks}` object from `loadOverviewData`. If the assembler returns the identical
union, these are byte-unchanged except task ordering + timestamps.

## validate-data (needs split awareness)

`overview.validate_data` (`tools/overview-mcp/src/tools/validate-data.ts`) + the Zod
mirror `validate-data-schema.ts` validate a SINGLE file (`config.dataFile` by default,
or an explicit `path`/`content`). Post-split it must validate the **assembled** logical
set (hot + cold), and the union dup-id invariant. Invariant #10 (JSON-first) +
the drift-check `validate-data.test.ts` (3-surface) apply.

## Tests to extend / add

- `scripts/lib/data-edit-core.test.mjs`, `scripts/lib/parse-overview-data.test.mjs`,
  `scripts/lib/__tests__/parseOverviewData.test.mjs`.
- `tools/overview-mcp/src/__tests__/data-write-roundtrip.test.ts` (CLI⇆MCP byte parity).
- `tools/overview-mcp/src/__tests__/snapshot-reader.test.ts` (mtime guard, torn write).
- `tools/overview-mcp/src/__tests__/validate-data.test.ts`, `parallel-ready-tasks.test.ts`.
- `scripts/lib/watch-ralph-state.test.mjs`.
- Build/test: from plugin root `npm test` (`--no-file-parallelism --maxWorkers=1`),
  `npm run test:lib`, `npm run build --workspace=tools/overview-mcp`.

## Dual-repo surface

- **ai-developer-toolkit (plugin):** loader assembler, write-core re-partition +
  ordered two-file move + cross-shard de-dup, store-lock, `config.coldFile`, watcher +
  SnapshotReader cold-file awareness, migration command, validate-data, tests, version
  bump (→ 2.12.0), AGENTS.md, CHANGELOG, **3 marketplace indexes** (invariant #6).
- **codexu (consumer):** run migration → emit `data.json` (hot) + `data.archived.json`
  (cold); possibly touch `.ralph-overview/config.json`; bump `ai-developer-toolkit`
  submodule pointer; update `AGENTS.md` active-plugin-versions table + bookkeeper
  two-file notes; `tools/data-edit.mjs` wrapper docstring.
- **Sequencing is mandatory:** if codexu partitions data while the INSTALLED plugin is
  the old single-file loader, the old loader reads only `data.json` (hot) and silently
  drops all 231 cold tasks. Plugin must ship + be installed (`copilot plugin update`)
  BEFORE codexu migrates.
