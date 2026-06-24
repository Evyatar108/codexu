---
overviewTaskId: overview-data-json-further-breakdown-for-readability
---

## Direction
D-001 — Generated lean read views + projection routing, canonical hot/cold storage UNCHANGED. The
HOT shard is hard to read because ~76% of its bytes are prompt + kanban BODY bulk and because nothing
routes humans/agents to the lean read surfaces that already exist — not because there are too few
storage shards; so the fix is better read projections + routing, with zero loader/watcher/data-edit risk.

## Goal
A reader (human or agent) can navigate the active backlog and triage the right task WITHOUT loading
the full `.ralph-overview/data.json` HOT shard, by reading small generated read-only surfaces. The
canonical hot/cold storage, the loader's assembled `{tasks:[...]}` shape and ordering, the watcher,
the MCP server, the React viewer, and `data-edit` are all UNCHANGED. Concretely:
- A new generated `active-summary-tasks.json` projection: `lifecycle === "tracked"` tasks only AND
  with ALL heavy bodies stripped (`command.prompts`, `command.descriptionHtml`, AND `kanbanCards`
  replaced by `{stripped, approxBytes}`), so it is a tiny spine (~72 rows) — the lean live-backlog read.
- `summary-projection.json` extended to ALSO strip `kanbanCards` (today it strips only the two
  `command` body fields, leaving ~122 KB of kanban HTML).
- A generated per-scope human-navigation surface (extend the existing `tasks/INDEX.md`, e.g. group
  tasks by `scope`, or emit a sibling per-scope index), so a human opens just the scope they care about.
- Docs/skills/AGENTS routing: point the bookkeeper + members at the lean projection + INDEX FIRST,
  opening `data.json` only to MUTATE (always via `data-edit`).

## Scope
### In Scope
- New `active-summary-tasks.json` projection emitted from `scripts/lib/emit-projections.mjs` (additive,
  after the snapshot at `scripts/lib/sync-core.mjs:581-597`), wired through `config.outputs.*` in BOTH
  `scripts/lib/default-config.mjs` and `scripts/lib/resolve-config.mjs` (mirror the existing
  `activeTasksJson` / `summaryProjectionJson` wiring).
- Extend `summary-projection.json` stripping to also strip `kanbanCards` (shallow-clone the task +
  command exactly as the existing strip path does; never mutate the shared `overviewData`).
- Extend the generated human index (`scripts/lib/emit-tasks-index.mjs` / `tasks/INDEX.md`) with a
  per-scope grouping or a sibling per-scope read-only view.
- Routing docs: update codexu `AGENTS.md` ("Other generated files" / projection-reads guidance) and
  the relevant ralph-overview docs so the lean surfaces are the default read; keep the existing
  `data-edit` write-path guidance unchanged.
- Tests: unit coverage for the new projection (tracked-only + all three body classes stripped, additive,
  byte-stable `snapshot.json`) and the kanbanCards strip extension.

### Out of Scope
- Any change to the canonical hot/cold STORAGE layout, the loader/assembly (`sync-core.mjs:859`,
  `data-store.mjs`), the write core (`data-edit-core.mjs`), `migrate-split.mjs`, the watcher, the MCP
  server, or the React viewer. The assembled `{tasks:[...]}` shape + ordering MUST stay byte-identical.
- Per-scope / per-task SUBDIRECTORY shards (D-003) — gated behind a separate proven prototype; a `data/`
  subdir collides with the depth-0 same-dir watcher (invariant #14, Windows cold-start hang).
- Body-sidecar extraction that shrinks the canonical EDIT file (D-002) — a deliberate follow-up, only
  if D-001's read-routing proves insufficient (see Context).

## Criteria
- [ ] Running a sync emits `active-summary-tasks.json` containing ONLY `lifecycle === "tracked"` tasks,
      each with `command.prompts`, `command.descriptionHtml`, and `kanbanCards` replaced by a
      `{stripped: true, approxBytes: N}` marker; its byte size is a small fraction of `data.json`.
- [ ] `summary-projection.json` now also strips `kanbanCards` (verified by a unit test asserting no raw
      kanban HTML remains and the marker is present), with `snapshot.json` byte-unchanged.
- [ ] `snapshot.json`, the assembled `{tasks:[...]}` from `loadOverviewData`, and every other existing
      projection are byte-identical to a pre-change baseline run on the current corpus (no consumer churn).
- [ ] The generated human index exposes a per-scope grouping/view so a reader can open one scope's tasks
      without scanning the full file.
- [ ] codexu `AGENTS.md` + ralph-overview docs route readers to the lean projection + INDEX first;
      `data-edit` remains the only documented mutation path.
- [ ] New projection + strip logic is unit-tested; `npm test` (plugin-local, scripts/lib + projections)
      passes on Windows.

## Context
**Brainstorm verdict (3-lens consensus — codex + copilot + devil's-advocate, all xhigh):** recommend
D-001; a further STORAGE split is NOT the right first move. The Devil's Advocate raised a red flag and
source-measured the HOT shard (398,109 bytes): `command.prompts` ~180 KB (45%), `kanbanCards` ~122 KB
(31%), `descriptionHtml` ~11 KB (3%) — **~76% is body bulk, not the task spine**. Confirmed in
synthesis: `active-tasks.json` (353 KB) keeps full bodies; `summary-projection.json` (973 KB) strips
command bodies but NOT kanbanCards and is all-tasks — so neither existing projection is BOTH
tracked-only AND fully body-stripped. That gap is the lever.

**Why not D-003 (per-scope/per-task subdir shards):** all three lenses flag that a new `.ralph-overview/data/`
subdirectory is invisible to the depth-0 same-dir watcher (`watch-ralph-state.mjs:337-347,398-408,452-462`;
`resolve-config.mjs:199-218` rejects a non-sibling cold shard), reintroducing the Windows cold-start hang
that invariant #14 guards against; it also needs a deterministic order-owner manifest (else snapshots/
projections churn) and multiplies the crash-safe N-way move + seqlock cases that the 2-shard
`runVerbSplit`/`migrate-split` machinery (`data-edit-core.mjs:340-413`; `migrate-split.mjs`) was built for.

**The deliberate follow-up (D-002):** if read-routing does NOT relieve the pain because the canonical
EDIT file itself must shrink, extract the bulky bodies into SAME-DIR sibling sidecars hydrated by the
loader before `normalizeOverviewData` (keeping the assembled object byte-equivalent and the
lifecycle-based partition unchanged). Validate D-001 first; it is the cheapest signal on whether D-002
is even needed.

**Disconfirming observation to watch in planning:** if real workflows still require full prompt/kanban
bodies for most active tasks, and the lean views are ignored even when linked prominently, the pain is
canonical editability rather than discoverability — escalate to D-002 rather than adding more views.
