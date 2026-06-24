Lenses: ran=[codex, copilot, devils-advocate]; skipped=[] (all three lenses ran at xhigh)

# Brainstorm synthesis — `overview-data-json-further-breakdown-for-readability`

**Question:** Does a FURTHER breakdown of `.ralph-overview/data.json` beyond the shipped
hot/cold two-shard split (ralph-overview 2.12.0) meaningfully improve human + agent
readability/navigation, WITHOUT breaking the loader / watcher / MCP / viewer / projection
consumers that all assemble one `{tasks:[...]}`?

**Verdict (3-lens consensus, recommend D-001):** Do **not** add a further STORAGE split as
the first move. All three lenses independently rank "generated read-only views / better
projections over unchanged hot/cold storage" as their #1 direction, and all three flag that
a subdirectory `data/<scope>.json` or `data/tasks/<id>.json` shard layout collides with the
watcher's depth-0 same-dir-sibling contract (invariant #14) and risks reintroducing the
Windows cold-start hang. The Devil's Advocate raised a **red flag** on the whole storage-split
premise and backed it with a source-measured byte breakdown.

## The decisive evidence: it's BODY bulk, not too few shards

The Devil's Advocate measured the real checkout (HOT shard = 398,109 bytes, which matches the
on-disk size exactly):

| Component of the HOT shard | Approx bytes | Share |
|---|---:|---:|
| `command.prompts.*` (brainstorm/plan/impl seeds) | ~180,598 | ~45% |
| `kanbanCards[]` | ~122,312 | ~31% |
| `command.descriptionHtml` | ~10,970 | ~3% |
| task spine (ids, lifecycle, shipManifest, …) | remainder | ~21% |

So **~76% of the HOT shard is prompt + kanban BODY bulk**, not the task spine. Splitting the
*task set* across more files (per-scope / per-task) does nothing about the bytes that actually
make the file hard to read — it just multiplies the loader/watcher/move/seqlock machinery.

Confirmed independently in this synthesis against the generated projections:
- `active-tasks.json` = **353,500 bytes** — tracked-only, but keeps FULL bodies (nearly as big
  as data.json), so it's not a lean read.
- `summary-projection.json` = **973,986 bytes** — all tasks, `command.prompts`/`descriptionHtml`
  stripped to `{stripped, approxBytes}` — but `kanbanCards` are NOT stripped, and it's all-tasks
  (not tracked-only), so it's larger than the hot shard.

**Neither existing projection is BOTH tracked-only AND fully body-stripped.** That gap — not a
shortage of shards — is the lever.

## The seam (source-confirmed, file:line)

- Read loader branches ONLY on cold-file presence: `scripts/lib/sync-core.mjs:859-865`;
  `loadSplitOverviewData` reads exactly hot+cold and assembles: `:893-903`.
- `assembleTasks` = hot file order then cold file order with de-dup: `scripts/lib/data-store.mjs:106-181`;
  `classifyShard` is lifecycle-derived (`COLD_LIFECYCLES={merged,archived}`): `:52-63`;
  `partitionByLifecycle` preserves per-partition order: `:65-79`.
- Write core hard-codes TWO shards: `runVerbSplit` assembles hot+cold, repartitions, computes
  hot/cold leavers, keep-both-then-remove move: `scripts/lib/data-edit-core.mjs:340-413`.
- Migration: `scripts/migrate-split.mjs` is a COLD-FIRST two-file partition: `:13-89`.
- Projections + index are emitted AFTER the snapshot, additive, never mutating the parsed object:
  `scripts/lib/sync-core.mjs:581-597`; `scripts/lib/emit-projections.mjs:5-14,29-39,42-64`;
  `scripts/lib/emit-tasks-index.mjs:22-33`.
- **Watcher landmine (invariant #14):** the data watcher runs at `depth:0` over
  `path.dirname(config.dataFile)` and reports a data change only when the touched basename matches
  the hot OR cold file: `scripts/lib/watch-ralph-state.mjs:337-347,398-408,452-462`;
  `resolve-config.mjs:199-218` REJECTS a cold shard in a different directory. A NEW `data/`
  subdirectory of shards is invisible to this watcher unless a deeper/new watcher is added — the
  exact change AGENTS.md invariant #14 says reintroduces the Windows cold-start hang on codexu's
  ~1.9M `.ralph/jobs` files.

## Candidate directions

### D-001: Generated lean read views + projection routing — canonical hot/cold storage UNCHANGED  ⭐ recommended
- Contributing lenses: [codex, copilot, devils-advocate] (all three ranked this #1)
- Why this might work: attacks the actual failure mode (agent-context bloat + "find the right
  task fast") with ZERO loader/watcher/data-edit risk. The infrastructure mostly exists —
  `tasks/INDEX.md`, `summary-projection.json`, `active-tasks.json` are already emitted post-snapshot.
  Concrete deliverables: (a) a new `active-summary-tasks.json` projection = tracked-only AND all
  bodies stripped (`command.prompts`, `descriptionHtml`, AND `kanbanCards`) → tiny (~72 spine rows);
  (b) extend `summary-projection.json` to also strip `kanbanCards`; (c) extend/添加 a generated
  per-scope read-only view or per-scope section in `tasks/INDEX.md`; (d) route docs/skills/agents to
  read the lean projection + INDEX FIRST, opening `data.json` only to mutate (via `data-edit`).
- Risks / friction: does NOT shrink the canonical EDIT file; if the operator's pain is scrolling/
  editing the JSON itself, views only cut accidental context loads.
- Cheapest validation: add `active-summary-tasks.json` + strip kanbanCards in summary-projection,
  point one week of lead/member prompts at INDEX+summary first, measure whether `data.json` still
  gets opened for triage. No loader/watcher/data-edit change.
- Disconfirming observation: if real workflows still require full prompt/kanban bodies for most
  active tasks and the views are ignored even when linked prominently, the pain is canonical
  editability, not discoverability — which would justify D-002.

### D-002: Body-sidecar extraction — move prompt/descriptionHtml (and maybe kanbanCards) bodies OUT of data.json, keep the task spine + lifecycle partition
- Contributing lenses: [devils-advocate, codex] (devil's-advocate primary; codex's per-task framing is a weaker variant)
- Why this might work: targets the measured 76% body bulk while keeping `data.json` as the
  order-bearing spine and the proven lifecycle-based `classifyShard`/`partitionByLifecycle`/2-shard
  move contract UNCHANGED. The loader hydrates bodies from path-referenced sidecars before
  `normalizeOverviewData`, so the assembled `{tasks:[...]}` stays byte-equivalent for every consumer.
- Risks / friction: sidecars MUST be same-dir siblings (a `data/` subdir breaks the depth-0
  watcher, invariant #14) — so the basename allow-list + composite-mtime (`data-store.mjs:184-190`)
  must grow to cover them; `data-edit` deliberately uses source-preserving `parseOverviewDataJson`
  (`data-edit-core.mjs:21-24,35-51`), so every write verb (esp. `set-prompts`) needs explicit
  sidecar handling without rewriting unrelated rows; freshness must advance on sidecar-only edits.
- Cheapest validation: FIRST extend `summary-projection.json` to also strip kanbanCards + add
  `active-summary-tasks.json` (D-001). If that makes agent reads small enough, sidecars are
  unnecessary. If not, prototype ONE prompt-body sidecar in a fixture and prove: hydrated assembled
  object byte-equivalent for consumers; sidecar-only edit advances freshness; `data-edit set-prompts`
  round-trips without rewriting other rows. Pursue only if D-001 proves insufficient.
- Disconfirming observation: if bodies are NOT the dominant bytes after stripping all three
  (prompts+descriptionHtml+kanbanCards), or sidecars can't be watched without relaxing depth-0,
  body extraction is just a smaller version of the N-shard problem.

### D-003: Per-scope or per-task SUBDIRECTORY shards (the literal options 1 & 2 from the seed) — REJECT unless a flat, ordered, watcher-safe contract is proven first
- Contributing lenses: [codex, copilot, devils-advocate] (all three list it but rank it last / behind a hard gate)
- Why this might work (only if): per-scope/per-task files give human navigation, git-blame, and
  small diffs — BUT only if they remain a pure storage-layer detail that assembles to the exact
  same object in the exact same order.
- Risks / friction: (1) `data/<scope>.json` / `data/tasks/<id>.json` is a NEW subdirectory →
  invisible to the depth-0 same-dir watcher (invariant #14) → Windows cold-start hang risk if a
  deeper/new watcher is added. (2) Needs a single deterministic ORDER owner (a manifest/order
  spine); lexical id/scope order is NOT today's hot-then-cold order, so snapshots/projections
  churn. (3) Multiplies the crash-safe N-way move + seqlock + duplicate-resolution cases that the
  2-shard `runVerbSplit`/`migrate-split` machinery was built for. (4) Scope is a per-task field
  today, not a partition key — cross-scope edits become file moves.
- Cheapest validation: a READ-ONLY fixture prototype (not production): load a directory of shards
  + explicit order manifest, assemble, and byte-compare snapshot/projections against current
  hot+cold on the real codexu corpus; run a watcher smoke with same-dir flat basenames AND with
  subdirectory shards (the subdir variant is expected to MISS events under depth-0).
- Disconfirming observation: if a prototype keeps shards as same-dir siblings, preserves exact
  current order without a drifting manifest, passes split read/write/migration parity, and shows
  no Windows watcher cold-start regression — N-shard storage becomes plausible. Absent that proof,
  it is a silent-failure trap / engineering theater.

## Open questions carried to planning
1. What exact read op is painful: human editing of canonical rows, agent listing/triage, or agent
   loading full prompt bodies for execution? Each points to a different solution (D-001 vs D-002).
2. Why are agents still opening `data.json` when `summary-projection.json` + `tasks/INDEX.md`
   exist? Is this a skill/doc/tool-routing gap rather than a storage gap?
3. Should `summary-projection.json` strip `kanbanCards` (and `shipManifest` summaries), and should
   an `active-summary-tasks.json` (tracked-only + fully stripped) exist before ANY storage change?
4. If canonical editability is the real pain, can `data-edit` / overview MCP tools provide focused
   per-task views + body editors so humans rarely open the whole JSON?
5. If any further split is ever pursued: who owns task order, and can it be tested byte-identical
   against snapshot/projection output on the current 307-task corpus?
