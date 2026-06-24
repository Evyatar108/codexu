# Research Brief — overview-data-json-further-breakdown-for-readability (D-001)

> NOTE: Phase 2 codex/copilot research were killed mid-run by a session-suspend reap
> (codex-research.txt missing; copilot-research.txt partial/no-summary; researcher
> explore agent cancelled). The architect explore agent completed, and the planner
> performed authoritative source research directly. Coverage is complete via those two.

## Architect Analysis (complete)

### Integration points
- Projection emitter: `ai-developer-toolkit/plugins/ralph-overview/scripts/lib/emit-projections.mjs:20-40` (the `emitProjections` fn) + `:42-65` (`stripColdBodies` shallow-clone helper). Add a new `config.outputs.*` branch beside `activeTasksJson`/`summaryProjectionJson`.
- Sole call site: `scripts/lib/sync-core.mjs:570-598` (`emitAgentArtifacts`); the `emitProjections` call is at `:589-597`, AFTER the `snapshot.json` write at `:581-582`. Keep the new projection after the snapshot so snapshot stays byte-identical.
- Default outputs: `scripts/lib/default-config.mjs:11-24` (activeTasksJson `:21`, summaryProjectionJson `:22`).
- Resolved outputs: `scripts/lib/resolve-config.mjs:122-139` (destructure block; activeTasksJson `:134`, summaryProjectionJson `:135`) AND `:164-179` (resolved-outputs rebuild; `:175-176`). MUST add the new key in BOTH places.
- Type surface: `scripts/lib/default-config.d.mts:11-23` (NOTE: this interface currently OMITS activeTasksJson/summaryProjectionJson entirely — pre-existing gap).
- Plugin config schema: `templates/overview-config.schema.json:22-39` (lists activeTasksJson `:35` + summaryProjectionJson `:36`; `additionalProperties:false` at `:6` and `:24`).

### Determinism / ordering
- `emitProjections` filters/maps over the assembled `overviewData.tasks` array (hot-then-cold ordered). New lean projection should filter `lifecycle === 'tracked'` on the same array — identical to `active-tasks.json` — preserving order with no churn (`emit-projections.mjs:26-38`).

### Purity / additivity
- Existing strip avoids mutation by shallow-clone: `{ ...command }` + `{ ...task, command: nextCommand }` (`emit-projections.mjs:42-65`). New kanbanCards strip + the lean projection MUST follow the same pattern; never mutate `overviewData`.
- `snapshot.json` byte-identical because it is written earlier (`sync-core.mjs:581-582`); projections emit afterward.

### Constraint — watcher invariant #14
- Safe placement = SAME-DIR sibling under `.ralph-overview/generated/`, NOT a new `data/` subdir. Depth-0 watch contract at `watch-ralph-state.mjs:326-347,398-408,452-462`; `:344-346` explicitly allows only the hot shard + cold sibling ("same-dir sibling, no new/deeper watcher").

### Risk areas
- `tasks/INDEX.md` churn: regenerated at `sync-core.mjs:583`; it is git-TRACKED, so a buildTasksIndex change produces working-tree noise on every watcher pass. Existing tests expect `## TASK` headings to survive.
- Consumer schema drift: schema `additionalProperties:false` → a new output key in a config needs the schema updated in lockstep.
- Plugin release invariant: `plugin.json`, the 3 marketplace indexes, `CHANGELOG.md`, and codexu `AGENTS.md` active-plugin-versions table must move together.

### Suggested implementation
- Mirror `activeTasksJson` + `summaryProjectionJson` wiring exactly; tracked-only filter identical to `active-tasks.json`.
- selected-direction says YES, also strip `kanbanCards` in `summary-projection.json` (it already strips prompt/HTML bodies; this closes the remaining bulk).

## Planner Source Research (authoritative, verified directly)

### Measured sizes (current corpus, on-disk)
- HOT `data.json` = 401,849 B; COLD `data.archived.json` = 1,602,402 B.
- `active-tasks.json` = 357,235 B (tracked-only, FULL bodies — nearly as big as hot shard).
- `summary-projection.json` = 975,258 B (ALL tasks, strips command bodies but NOT kanbanCards; LARGER than hot shard).
- `snapshot.json` = 2,245,895 B.
- HOT shard: 72 total tasks, ALL 72 `lifecycle==='tracked'`.
- THE GAP CONFIRMED: no existing projection is BOTH tracked-only AND fully body-stripped.

### Real task spine (top-level keys observed)
`id`, `scope`, `lifecycle`, `status`, `lastTouchedAt`, `kanbanCards`, `command`. Merged tasks additionally carry `shipManifest`.
- `command` sub-keys: `name`, `descriptionHtml`, `warnings`, `prompts{brainstorm?,plan?,impl?}`.
- `kanbanCards` shape: array of `{ className, html }` (e.g. className `cmd-warn` / `cmd-ok`).
- `scope` is often pipe-delimited multi-scope, e.g. `"crews|codex"`, `"codexu|ralph-overview"`.

### Snapshot tasks DO carry scope
`snapshot.json` task[0] keys = `id, scope, lifecycle, status, lastTouchedAt, kanbanCards, command, initialStage`; `scope` present. So `buildTasksIndex` (which reads `snapshot.tasks`) CAN group by `task.scope`.

### Config deep-merge (important)
`resolve-config.mjs::mergeObject` (`:105-117`) DEEP-merges plain objects, so `outputs` from the consumer config overlays the default's `outputs`; a NEW default key (`leanTasksJson`) survives even if the consumer config doesn't list it. => Adding the key to `default-config.mjs` is sufficient for function; consumer config edit is optional (consistency only).
- BUT resolve-config destructures KNOWN output keys explicitly; an unknown key falls into `...unknownOutputs` and is spread UNRESOLVED (relative). Convention is to wire it explicitly in resolve-config (destructure + resolved block), like the existing two.

### Consumer schema is STALE (a real, tightly-coupled bug)
- Consumer schema `.ralph/overview-config.schema.json` has `outputs.additionalProperties:false` (`:23`) but its `outputs.properties` (`:24-35`) does NOT list `activeTasksJson` or `summaryProjectionJson` — yet the consumer `.ralph-overview/config.json` (`:20-21`) DOES list them. So the live consumer config already violates its own schema. The schema is clearly NOT runtime-enforced (editor-only `$schema` hint), which is why nothing broke. Plan should bring it in sync (add all three) when adding the new key.
- Plugin TEMPLATE schema `templates/overview-config.schema.json` DOES list the two existing ones (`:35-36`) — so consumer schema lags the template.

### Generated-file git-tracking status (verified via git check-ignore + ls-files)
- `.ralph-overview/generated/active-tasks.json`, `summary-projection.json`, `snapshot.json` are UNTRACKED (present on disk, NOT in git, NOT ignored). => the new `lean-tasks.json` sibling will likewise be untracked; impl does NOT commit it (the watcher regenerates).
- `tasks/INDEX.md` IS tracked & committed. => a buildTasksIndex change yields a tracked diff that impl must regenerate + commit once.

### Existing tests (the test surface to extend)
- `scripts/lib/emit-projections.test.mjs` — unit tests for active-tasks (tracked-only) + summary-projection (stripped command bodies) + purity (no input mutation) + additivity (pre-existing snapshot.json byte-identical). Vitest, fixture-based. THE model to mirror for the new projection + the kanbanCards strip.
- `scripts/lib/sync-core.test.mjs:380-402` — integration: byte-identical snapshot tasks across base vs projection config; active-tasks tracked-only; summary-projection prompts stripped. `:990-1028` — writeSidecar emits schema/snapshot/tasks-index; asserts `## TASK` survives in INDEX.md.

### Routing targets (codexu AGENTS.md)
- `AGENTS.md:248-251` — "For large read-only scans, prefer the generated projections (active-tasks.json for live backlog, summary-projection.json when prompt/body bulk is not needed)…" → route the lean view as the FIRST/canonical lean read.
- `AGENTS.md:275-284` — "Other generated files" list (active-tasks.json `:278`, summary-projection.json `:279`) → add the lean projection entry.

### Plugin docs / version surface
- `.claude-plugin/plugin.json` version currently `2.12.0`.
- `CHANGELOG.md` — prepend a new version section (the "Lazy read projections" Unreleased block in the plugin AGENTS.md describes the existing two; the new lean projection + kanban strip extend it).
- 3 marketplace indexes (invariant #6) + codexu AGENTS.md active-plugin-versions table → bump in lockstep.

## Consolidated File List

### Files to modify (plugin — ai-developer-toolkit/plugins/ralph-overview/)
- `scripts/lib/emit-projections.mjs` — add lean projection branch + lean strip helper; extend stripColdBodies (or summary path) to also strip kanbanCards.
- `scripts/lib/default-config.mjs` — add `outputs.leanTasksJson` default path.
- `scripts/lib/resolve-config.mjs` — add `leanTasksJson` in BOTH the destructure block and the resolved-outputs block.
- `scripts/lib/default-config.d.mts` — add `leanTasksJson` (and backfill the two missing existing keys) to the outputs interface.
- `templates/overview-config.schema.json` — add `leanTasksJson` to outputs.properties.
- `scripts/lib/emit-projections.test.mjs` — new unit tests (lean projection tracked-only + all-3-body-classes stripped; kanbanCards strip on summary; purity; additivity).
- `scripts/lib/emit-tasks-index.mjs` — per-scope navigation grouping (additive; keep `## <taskId>` blocks).
- `CHANGELOG.md` + `.claude-plugin/plugin.json` (+ AGENTS.md plugin section "Lazy read projections").

### Files to modify (consumer — codexu repo root)
- `.ralph-overview/config.json` — add `leanTasksJson` (optional for function; consistency).
- `.ralph/overview-config.schema.json` — add activeTasksJson + summaryProjectionJson + leanTasksJson (fix the stale drift).
- `AGENTS.md` — route readers to the lean projection (sections ~`:248-251`, `:275-284`); active-plugin-versions table version bump.
- 3 marketplace indexes (in ai-developer-toolkit): `.claude-plugin/marketplace.json`, `.github/plugin/marketplace.json`, `.agents/plugins/marketplace.json` — ralph-overview version bump.

### Reference-only
- `scripts/lib/sync-core.mjs:570-598` (call site; do not change ordering).
- `scripts/lib/watch-ralph-state.mjs:326-347` (invariant #14 — do NOT add a `data/` subdir).
- `scripts/lib/data-store.mjs` (assembly; UNCHANGED — lean view is additive).
