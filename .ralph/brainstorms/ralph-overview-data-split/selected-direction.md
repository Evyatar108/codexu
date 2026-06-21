---
overviewTaskId: ralph-overview-data-json-split-for-readability
---

## Direction
D-001 — Active-vs-archived split (hot tracked file + cold archive file) behind a compat
assembler. Partition `.ralph-overview/data.json` into a small hot file holding only `tracked`
tasks and a cold file holding `merged`+`archived` tasks, assembled back into the existing
in-memory `{tasks:[...]}` shape beneath the read chokepoints — removing the 77% cold bulk from
the file humans open and edit while preserving the id-scoped atomic mutation core and every
global invariant.

## Goal
A human or agent who opens the live backlog sees only the ~68 `tracked` tasks (a ~77% smaller
file), not all 299. Cold (`merged`/`archived`) history lives in a sibling cold file that is
still part of the one authoritative logical task set. All existing consumers — the watcher
loader (`loadOverviewData`), the mutation core loader (`loadData`), the MCP
`SnapshotReader.getOverviewData()`, the 5 id-scoped write verbs (`runVerb`), the generated
projections (`active-tasks.json`, `summary-projection.json`, `snapshot.json`,
`recommendations.json`, `dependency-graph.json`, `tasks/INDEX.md`), and the React viewer —
behave identically because the split is assembled/dispatched BENEATH the read/write chokepoints.
`mark-shipped`/`set-lifecycle` move a task between the hot and cold files crash-safely under one
logical store lock. The coupled `ralph-overview-create-task-skill` writes a new (`tracked`) task
into the hot file via the existing `upsert-task` path with no new write interface.

## Scope
### In Scope
- Define the split storage model: a hot file (default keep the name `.ralph-overview/data.json`,
  holding `lifecycle === "tracked"` tasks + all top-level non-task metadata keys: `ui`,
  `generatedAt`, `generatedFromCommit`, `phaseTree`, `lastTouched`, `periodic`, `cadence`,
  `runs`, `effort`, `risk`, `workstream`, `sizeBucket`, `spawnedFrom`, `ralphOverrides`) and a
  cold file (e.g. `.ralph-overview/data.archived.json`, holding `merged`+`archived` tasks). The
  plan decides the exact home for the top-level metadata keys.
- A compat-assembling loader behind ALL THREE read chokepoints (`loadOverviewData`,
  `loadData`, MCP `getOverviewData`) that auto-detects single-file (legacy) vs split form and
  returns the identical assembled `{tasks:[...]}` object. Reads must merge hot+cold deterministically.
- Promote the write lock from the per-file `${dataFile}.lock` to ONE logical store lock shared
  by both shards, covering the whole read-mutate-write cycle for every verb.
- Make `validateInvariants` (dup-id `Set`, valid id/scope/lifecycle, target-present, count
  deltas) span BOTH shards (the global uniqueness invariant must hold across the logical set).
- Make `mark-shipped` and `set-lifecycle` perform the cross-file MOVE crash-safely: write the
  add-to-cold side BEFORE the remove-from-hot side, plus a load-time recovery that de-duplicates
  preferring the cold/newer copy, so an interrupted move duplicates (recoverable) rather than
  loses a task. Pin this transaction/recovery contract explicitly in the plan.
- A one-time migration that partitions the existing 299-task `data.json` into hot+cold, with a
  short dual-loader deprecation window (legacy single-file still loads during migration).
- Keep CLI ⇆ MCP write byte-parity (the existing roundtrip test) and canonical serialization
  (`JSON.stringify(data, null, 2) + "\n"`, LF) for each shard.
- Confirm the generated projections + watcher are unchanged in OUTPUT (they consume the
  assembled object); update only the loader layer underneath them.
- Update `overview.validate_data` + the AST/Zod validators + fixtures/tests for the split form,
  and the create-task-skill coupling note (new tasks → hot file).
- Ship vehicle: `ai-developer-toolkit` submodule change → codexu pointer bump → plugin version
  bump → AGENTS.md active-plugin-versions table → CHANGELOG, plus the migrated codexu data files.

### Out of Scope
- **Per-task files (one file per id) for the active set (D-002)** and the **full per-task store
  (D-003)** — deferred. All three lenses flagged the N-file directory watch against the plugin's
  load-bearing Windows watcher depth-cap correctness contract (watcher intentionally watches only
  `dirname(dataFile)` at depth 0). Revisit D-002 as a conditional Phase-2 ONLY if tracked-task
  merge conflicts remain a measured problem after the hot file shrinks.
- Per-scope sharding (compound scopes like `codex|codexu` have no stable owner rule).
- Any change to the 5 write verbs' external semantics or the snapshot/projection schemas.
- The create-task skill itself (separate task `ralph-overview-create-task-skill`); here we only
  fix its target (the hot file) so it can be designed against the final model.

## Criteria
- Loading the split form through each of the 3 read chokepoints yields a `{tasks:[...]}` object
  byte-equivalent (modulo task ordering policy the plan defines) to loading the pre-split
  single-file form; `snapshot.json` and the other projections are unchanged except timestamps.
- After migration the hot file contains ONLY `tracked` tasks and is ~77% smaller (≈68 vs 299
  tasks); the cold file contains exactly the `merged`+`archived` tasks; union == original set,
  no task lost or duplicated (verified by id-set equality before/after).
- All 5 verbs run against the split store under one logical lock; `validateInvariants` rejects a
  duplicate id introduced ACROSS shards (fixture test), and rejects locking only one shard.
- `mark-shipped` on a tracked task removes it from the hot file and adds it to the cold file in
  one logical transaction; a simulated crash between the two writes leaves a state the load-time
  recovery de-dups to the correct single cold copy (fixture test).
- CLI and MCP writes remain byte-identical (existing roundtrip test passes against the split store).
- Legacy single-file `data.json` still loads during the deprecation window (back-compat test).
- A new (`tracked`) task created via `upsert-task` lands in the hot file (create-task coupling test).
- Plugin builds + `npm test` (scripts/lib + overview-mcp) green; AGENTS.md version table +
  CHANGELOG + 3 marketplace indexes updated for the version bump.

## Context
- **Why D-001 over the alternatives:** It is the only direction endorsed by all three lenses
  (Codex offered it as the lowest-risk M option, Copilot recommended it #1, the Devil's Advocate
  accepted it as the minimal split "if proven necessary"). It satisfies the operator's literal
  ask ("too large to read") by shrinking the file you hand-open ~77%, keeps machinery minimal
  (2 files, trivial dup-`Set`, the existing `mark-shipped`/`set-lifecycle` move-hook), and gives
  the coupled create-task skill a zero-new-interface target. It also honors the Devil's Advocate
  reframe (get the cold bulk out of the way) while remaining a real physical split.
- **Measured facts that drove the call:** lifecycle breakdown is `merged` 215 / `tracked` 68 /
  `archived` 16 → 77% cold. Single write chokepoint is `runVerb` under one lock; reads flow
  through `loadOverviewData` (watcher), `loadData` (mutation core, via source-preserving
  `parseOverviewDataJson`), and MCP `getOverviewData`. The split must sit beneath all three.
- **Disconfirming observations to carry forward:** (1) The cross-file lifecycle MOVE is the #1
  risk — two naive `atomicWriteFile` calls are not crash-safe; if making it safe needs a heavy
  manifest/journal it erodes the "low-machinery" appeal, so the plan must keep the
  add-before-remove + load-time-dedup contract lightweight. (2) Active-vs-archived does NOT
  eliminate merge conflicts among tracked tasks still sharing the hot file — but that benefit is
  largely mooted because the LEAD is the single committer (members push topic branches; lead
  FF-merges) and writes serialize through the id-scoped lock, so readability is the dominant,
  real value here, not conflict elimination. (3) Per-task files push on the known-fragile Windows
  watcher; that is why D-002/D-003 are deferred.
- **Open decision for the plan/operator (not blocking D-001):** whether to also take on per-task
  files for the active set NOW (D-002) to eliminate tracked-task conflicts, or stage it as a
  conditional Phase-2. Recommendation: stage it; keep this effort to active-vs-archived. Also
  open: exact home for the top-level metadata keys (hot file vs a `meta.json`), and whether to
  keep the historical `data.json` name for least disruption (recommended) vs an explicit
  `meta.json` + `active.json`.
- **Coupling note:** under D-001 the create-task skill (`ralph-overview-create-task-skill`)
  always writes a new `tracked` task into the hot file via `upsert-task` — confirm this is the
  intended UX (a hand-editable hot-file entry) rather than a separate per-task file, since that
  choice is exactly what D-001 fixes for it.
