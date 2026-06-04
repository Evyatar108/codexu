Lenses: ran=[codex, copilot, devils-advocate]; skipped=[]

## Top-line finding from grounding

The Devil's Advocate lens identified — and fact-checking confirmed — that **the seed's central premise is wrong**:

- AGENTS.md and CLAUDE.md have **0 `@`-prefix auto-load directives**; nothing implicitly pulls `.ralph-overview/data.json` into agent context.
- The ralph-overview MCP server caches data.json in **process memory only**; `overview.parallel_ready_tasks` returns a slice, `overview.expand_task_context` returns one task.
- The two "in-flight sibling tasks" the seed warns about (`overview-data-dynamic-stages-schema`, `overview-data-ship-manifest`) are already **merged**.

So the seed's "every bookkeeper session auto-loads 680KB / ~173K tokens" framing is unproven and almost certainly false. The proven pain is **edit-anchor regressions** (4 distinct ones in a single 2026-06-03 session — see AGENTS.md `### data.json edit-anchor safety`), which is a write-safety problem rather than a read-context-budget problem.

Ground-truth measurements:
- `data.json` = 680.7 KB / ~173K tokens / 147 tasks (103 merged, 33 tracked, 11 archived).
- The `tasks` array is 612 KB (90% of file).
- Within `tasks`, `command.prompts.*` strings alone account for ~374 KB (over half of total bytes).
- Hot-path subset (tracked only) ≈ 152 KB of compact JSON.

That changes the problem definition: the brainstorm is no longer "how to keep data.json out of context" but **"how to make bookkeeper reads/writes task-id-scoped, and shrink read amplification when an agent explicitly views the file."**

---

### D-001: ID-scoped tooling + lazy MCP first; defer any source-storage split
- **Contributing lenses:** [codex, copilot, devils-advocate]
- **Why this might work:** All three lenses converged on this as the right *first* step. The proven pain (edit-anchor regressions) is fully addressed by adding a checked-in `tools/data-edit.mjs` (or MCP write surface `overview.upsert_task` / `overview.mark_shipped`) that loads data.json, finds by exact id, mutates, validates the schema + task-count invariants, writes atomically, and prints a minimal diff. Pair with the existing read-side MCP tools (`overview.parallel_ready_tasks`, `overview.expand_task_context`) so the lead's typical read path never requires viewing the full file. Coordinates with already-planned MCP work instead of preempting it with a storage migration that is solving a non-existent problem.
- **Risks / friction:** The bookkeeper has to actually use the helpers (muscle memory still wants `edit` against the raw file); needs an obvious lint or hook that flags raw `edit` on data.json. The DA notes that "F-plus" only works if writes are forced through the new API; otherwise regressions return.
- **Cheapest validation:** (a) Add `node tools/data-edit.mjs mark-shipped <task-id> --commit-sha <sha> --summary "..."` to the toolkit; (b) port at least one ship-day to it; (c) measure: zero edit-anchor regressions over N consecutive ships AND prompt-trace shows data.json bytes do not appear in session context unless deliberately viewed.
- **Disconfirming observation:** A prompt-trace at session start that shows data.json *is* being injected into agent context via some indirect path (Claude Code summarizer, MCP "auto-introspect" call, etc.) — would invalidate the "monolith stays" rationale and force a split. Or: bookkeepers bypass the helper out of habit and edit-anchor regressions continue at the same rate.

### D-002: Per-task source files (`.ralph-overview/tasks/<id>.json`) with assembled snapshot + INDEX
- **Contributing lenses:** [codex, copilot, devils-advocate (as cautionary 3rd direction)]
- **Why this might work:** Largest payoff at scale — atomic per-task edits structurally eliminate cross-task anchor collisions; git blame and per-task diffs become cleanest. The watcher absorbs assembly: per-task files → `snapshot.json` consumed by the React app and MCP tools. Edit ergonomics become "open one small file" rather than "navigate 147-task array".
- **Risks / friction:** DA warns this is the highest-cost path with the most silent-failure surface:
  - Dual-authority hazard during migration (both `data.json` and `tasks/<id>.json` editable transiently).
  - Bookkeeper muscle memory keeps hitting `data.json`; need a hard lint/hook to block raw `data.json` edits post-migration.
  - Git blame on the 147-row extraction is noisy.
  - Watcher today reads one file at depth 0 with basename filter — not a drop-in change.
  - The `command.prompts.*` bodies (374 KB of the file) are exactly the cold content that benefits least from per-task files but bloats them most.
- **Cheapest validation:** Convert the 10 largest tasks to `.ralph-overview/tasks/<id>.json`, generate `INDEX.md` from the watcher, prove deterministic snapshot assembly, run one ship-day against the new shape, then measure: index size, snapshot diff stability, watcher latency.
- **Disconfirming observation:** Normal bookkeeper operations (lifecycle flips, shipManifest add, kanban card add) require coordinated multi-file transactions; OR snapshot diffs become so noisy that reviewers stop trusting them; OR the watcher cannot reliably enforce "exactly one authoritative source" without a per-machine config flag.

### D-003: Lifecycle-bucketed files (`data-active.json` + `data-merged.json` + `data-archived.json`)
- **Contributing lenses:** [codex, copilot]
- **Why this might work:** Simplest split. Hot path (tracked only) drops from 147 → 33 tasks immediately and from ~680 KB → ~152 KB. Migration is a one-shot bucket rewrite. Matches the natural mental model ("today I only care about in-flight work").
- **Risks / friction:** Ship-time atomicity is broken — moving a task from `data-active.json` to `data-merged.json` is a coordinated two-file edit, violating the "atomic per-task edit" invariant. The active bucket still grows monotonically until a manual archival sweep. Cross-file references (`spawnedFrom`, dependencies) need stable IDs and a discovery convention.
- **Cheapest validation:** Prototype the 3-file split on a copy of current data.json, simulate one lifecycle flip from `tracked` → `merged` using only the proposed edit instructions, and measure: number of files touched, edit-anchor uniqueness, whether the watcher can still single-source the assembled snapshot.
- **Disconfirming observation:** A normal ship requires editing two hand-curated files; OR the active bucket exceeds the budget within 6 months as new tracked tasks accumulate; OR `spawnedFrom` lookups break across files.

### D-004: Generated projection / "compute, don't split"
- **Contributing lenses:** [devils-advocate]
- **Why this might work:** Acknowledges that the *source* doesn't need to be small if the agent's *read path* is purpose-built. Watcher already emits `.ralph-overview/generated/snapshot.json`, `recommendations.json`, `tasks/INDEX.md`. Add an `active-tasks.json` and `summary-projection.json` (per task: id, scope, lifecycle, lastTouchedAt, mergeCommit/shipManifest summary, warnings count — drops the 374 KB of `prompts.*` bodies). MCP `overview.expand_task_context(id)` already pulls full detail for a single task on demand. No source-storage migration; no dual-authority hazard.
- **Risks / friction:** Doesn't address the edit-anchor write-safety pain at all — purely read-side. If write-safety is the dominant pain (which grounding suggests it is), this alone is insufficient. Best paired with D-001's write-tooling.
- **Cheapest validation:** Add the projection generation to `sync-core.mjs`; remove any direct-`data.json` views from the bookkeeper's documented read path; verify the React app + MCP tools render correctly from the projection alone.
- **Disconfirming observation:** Bookkeepers still need full task detail (prompts, descriptionHtml) frequently enough that the projection is rarely sufficient and they fall back to viewing data.json anyway.

---

## Recommended direction

**D-001 (ID-scoped tooling + lazy MCP first; defer source-storage split)**, ideally **paired with the cheap subset of D-004** (add a `summary-projection.json` + `active-tasks.json` to the watcher's generated artifacts). 

This is recommended because:

1. **Grounding invalidates the seed's main rationale.** Nothing auto-loads data.json into context. The "save 173K tokens at session start" payoff D-002/D-003 are reaching for doesn't exist.
2. **The proven pain is write-safety** (4 anchor regressions / session). That pain is *fully solvable* by ID-scoped tooling without any storage migration.
3. **D-002 (per-task files) is the highest-cost path with the most silent-failure surface.** Worth doing if growth + edit-frequency justify it later, but doing it *now* — based on a wrong premise — would burn migration effort and introduce dual-authority hazards for no measurable user-facing improvement.
4. **D-003 (lifecycle buckets) violates an explicit non-negotiable invariant** (atomic per-task edits) at every ship.
5. **D-004 alone is insufficient** (doesn't address write-safety), but its cheap subset (regenerate `active-tasks.json` + `summary-projection.json` from the existing watcher) is essentially free and gives the bookkeeper a smaller read path immediately.

The combined D-001 + cheap-D-004 path is also strategically deferrable: if at 300+ tasks the read amplification *does* become measurable, the per-task split (D-002) remains available as a follow-up — but only with the write-safety problem already gone, which dramatically reduces D-002's migration risk.
