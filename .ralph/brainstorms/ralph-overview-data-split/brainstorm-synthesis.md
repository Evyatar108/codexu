Lenses: ran=[codex, copilot, devils-advocate]; skipped=[]

# Brainstorm synthesis — split `.ralph-overview/data.json` for readability

All three lenses converged on the same option spectrum (active-vs-archived → per-task-active
hybrid → full per-task → no-split projection-first). The disagreement is narrow and useful:
Codex/Copilot assume a physical split and differ on *how far* to go; the Devil's Advocate
questions whether *any* physical split is warranted and supplies the load-bearing engineering
constraints any split must satisfy.

Key measured facts grounding the call: 231/299 tasks (77%) are cold (merged+archived); only 68
tracked tasks are the hot working set. The write path is a SINGLE id-scoped atomic `runVerb`
under one lock (`${dataFile}.lock`); reads flow through 3 chokepoints (`loadOverviewData`,
`loadData`, MCP `getOverviewData`). `mark-shipped`/`set-lifecycle` are already the exact verbs
that transition a task hot→cold. In the real bookkeeper workflow the LEAD is the single
committer (members push topic branches; lead FF-merges), so git-level merge conflicts on
data.json are rarer than the raw "299 tasks in one file" framing implies — which shifts the
dominant, immediate value toward READABILITY over merge-conflict elimination.

### D-001: Active-vs-archived split (hot tracked file + cold archive file) behind a compat assembler  ← RECOMMENDED
- Contributing lenses: [codex, copilot, devils-advocate]
- Why this might work: Directly removes the 77% cold bulk from the file you open/edit (299→68
  tracked), which is the operator's literal ask ("too large to read"). Only TWO authoritative
  files, so the dup-id `Set` and `validateInvariants` trivially span both. `mark-shipped` /
  `set-lifecycle` are the natural, already-existing hook for moving a task hot→cold. The
  create-task-skill coupling stays trivial: new tasks are always `tracked`, so create-task
  always upserts into the hot file via the existing `upsert-task` path — no new write interface.
  The assembly happens BENEATH the 3 read chokepoints, so projections/watcher/viewer keep
  seeing one `{tasks:[...]}` object unchanged.
- Risks / friction (these become hard design constraints for the plan):
  1. The cross-file MOVE in `mark-shipped`/`set-lifecycle` is a NEW two-file operation. Two
     independent `atomicWriteFile` calls are NOT crash-safe — a half-completed move can
     duplicate or lose a task. Mitigation to specify: add-to-cold BEFORE remove-from-hot, plus
     a load-time recovery that de-dups preferring the cold/newer copy, so a crash duplicates
     (recoverable) rather than loses. The plan must pin an explicit transaction/recovery contract.
  2. The lock must be promoted from `${dataFile}.lock` to a single LOGICAL STORE lock shared by
     both shards, so no caller ever locks only one file (else lost-update / dup-id regressions).
  3. All 3 read chokepoints must assemble both files; the compat shim must auto-detect
     single-file (legacy) vs split and support BOTH during migration (a deliberate, but bounded,
     dual-loader surface with a short deprecation window — not permanent).
  4. "Where do I read a merged task" changes to a two-file habit; cold lookups/search should be
     made obvious (the existing `summary-projection.json` already indexes all tasks).
- Cheapest validation: Prototype on a ~10-task fixture — loader auto-detects single vs split,
  assembles both into the exact current in-memory shape, `runVerb` moves one task across files
  on `mark-shipped`, and the generated projections diff identical except timestamps. Simulate a
  crash between the two writes and confirm the recovery de-dup restores a clean state.
- Disconfirming observation: If real edit history shows agents frequently hand-editing
  merged/archived records, or if most real conflicts occur among tracked tasks still sharing the
  hot file, this split would not solve the main pain (then escalate to D-002).

### D-002: Hybrid — per-task files for the active/tracked set + a single cold archive
- Contributing lenses: [codex, copilot, devils-advocate]
- Why this might work: The merge-conflict-optimal model for the hot set — one tracked task =
  one file (`tasks/active/<id>.json`), so concurrent create/edit of different tracked tasks
  never touch a shared blob, and create-task becomes "write a new file." Cold history stays a
  single compact archive.
- Risks / friction: Pushes directly on the plugin's KNOWN-fragile part — the watcher is
  deliberately constrained to watch only `dirname(dataFile)` at depth 0 with a basename filter
  because broader/uncapped chokidar coverage caused Windows cold-start hangs on this real repo
  (~1.9M files under `.ralph/jobs`). A tracked-task DIRECTORY means N-file glob/assemble per sync
  (~68 reads), new directory-watch invalidation, id→filename mapping for slash/dot ids (escaping,
  traversal protection, rename-on-id-change), and atomicity becomes a directory-level
  transaction. Mixed formats (active=files, cold=blob) add asymmetry.
- Cheapest validation: Convert only tracked tasks in a fixture to `tasks/active/<id>.json`, keep
  cold in one archive, and benchmark watcher sync latency + concurrent CLI/MCP `upsert-task` on
  different active ids on the same Windows box before committing.
- Disconfirming observation: If N-file assembly slows the watcher hot path or id→filename mapping
  can't be made clean+reversible, the extra machinery isn't worth it for a ~300-task backlog.

### D-003: Full per-task store with a meta/index file
- Contributing lenses: [codex, copilot, devils-advocate]
- Why this might work: Cleanest long-term conflict model — every task (hot or cold) is its own
  artifact; create-task = new file. Best if the project wants to treat the backlog as a task
  database.
- Risks / friction: Biggest behavior shift + the same Windows watcher / N≈300-file-assembly /
  id-mapping / directory-atomicity costs as D-002, amplified across ALL tasks. Loses
  source-preserving minimal-diff / array-ordering semantics. One malformed task file can break
  assembly across all projections (rollback story needed). Over-rotates for a 299-task backlog.
- Cheapest validation: Read-only assembler spike over a temp copy of the live 299-task dataset;
  compare sync latency + snapshot/recommendation output vs the current single-file loader.
- Disconfirming observation: If 300-file reads are too slow for the watcher/MCP hot path, or ids
  can't map cleanly+reversibly to portable filenames, rule it out for now.

### D-004: Projection-first — NO storage change; better hot view + strictly id-scoped edits
- Contributing lenses: [devils-advocate]
- Why this might work: The existing `active-tasks.json` (68 tracked) + `summary-projection.json`
  (all tasks, prompts stripped) ALREADY provide a small hot view; routing every edit through the
  id-scoped `data-edit`/MCP tools preserves the entire current one-lock/one-file/dup-id-Set/
  minimal-diff contract with near-zero risk. Create-task = `upsert-task` against the existing file.
- Risks / friction: Does NOT shrink the physical file anyone insists on hand-opening (the
  operator explicitly asked to "split it … so we can more easily read it"), and does not reduce
  git-level conflict surface for raw edits. Only helps if the helper verbs cover the real edits
  and the projections are kept fresh/discoverable.
- Cheapest validation: A no-schema-change trial week — document the projection+data-edit workflow
  and count how often anyone actually needs to read/edit cold tasks or hits a verb gap.
- Disconfirming observation: If sessions frequently need raw multi-task edits across cold records,
  or agents still collide on the single file despite id-scoped tooling, projection-only is
  insufficient — which is precisely the operator's stated complaint, so this is a reframe to
  HONOR (keep the cold bulk out of the hot file) rather than a do-nothing.

## Recommendation rationale
**D-001 (active-vs-archived split)** is the recommendation: it is the only direction all three
lenses endorse, it satisfies the operator's literal readability ask by shrinking the hot file
77%, it keeps the machinery minimal (2 files, trivial invariants, existing move-hook), and it
gives the coupled create-task skill a zero-new-interface target. It also honors the Devil's
Advocate reframe (get the cold bulk out of the way) while still being a real physical split.

D-002 (per-task files for the active set) is the natural Phase-2 follow-up IF, after the hot file
shrinks, concurrent-edit merge conflicts on tracked tasks remain a measured problem — but it is
explicitly DEFERRED here because all three lenses flagged it against the plugin's load-bearing
Windows watcher depth-cap contract, and the merge-conflict benefit is partly mooted by the
lead-serializes-ships workflow + the id-scoped write lock. Recommending D-001-first keeps the
door open to D-002 without betting the watcher on it upfront.

## Open question carried forward (for the plan / operator)
Scope of THIS effort: do active-vs-archived ONLY (recommended; defer per-task), or also take on
per-task files for the active set now to eliminate tracked-task merge conflicts? The
recommendation is the staged active-vs-archived-first; the plan should treat D-002 as an
explicit, conditional future phase, not in-scope, unless the operator elevates merge-conflict
elimination to a hard requirement for this effort.
