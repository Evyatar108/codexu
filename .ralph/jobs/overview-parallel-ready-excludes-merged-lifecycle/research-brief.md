# Research Brief: ralph-overview recommendations lifecycle gate

Plugin root: `ai-developer-toolkit/plugins/ralph-overview/` (primary checkout; the plan worktree's submodule is uninitialized). Current version: **2.13.0**.

## Researcher Findings (verified, with line numbers)

### `scripts/lib/score-recommendations.mjs`
- `tasksById` built at **line 45** from `overviewData.tasks` (filter `task?.id`); used ONLY for `?.priority` at **line 63**. **`task.lifecycle` is never consulted** in this file.
- `topRecommendations` from `Object.entries(byTaskId)` (**line 56**); `.filter` chain **lines 75–78**: `entry.stage !== 'shipped'` and `!candidateTaskIds.has(entry.taskId)` only — no lifecycle gate.
- `unblockCandidates` built **lines 47–53** from `findUnblockCandidates(overviewData)`; `candidateTaskIds` (line 54) deduped out of topRecommendations.
- Returns `{ topRecommendations, unblockCandidates }` (**line 80**).
- `tasksById` here is NOT alias-aware → the fix must route lifecycle through `resolveTaskLifecycle`/`classifyShard`, not read `task.lifecycle` directly, to satisfy the legacy-`phase` test cases.

### `scripts/lib/unblock-candidates.mjs`
- `computeUnblockCandidate` (**lines 1–20**) gates on `task?.status !== 'blocked'` (line 5), then `blockedOn.length`, then `allMerged` blockers. Candidate task's own lifecycle is never checked → a `merged`/`archived` blocked task with all-merged blockers WOULD surface.
- `findUnblockCandidates` (**lines 22–30**) — no candidate-lifecycle gate.

### `scripts/lib/data-store.mjs` + `scripts/lib/task-aliases.mjs`
- `COLD_LIFECYCLES = new Set(['merged','archived'])` (**data-store.mjs:18**).
- `classifyShard(task)` → `'cold'` for merged/archived else `'hot'` (**data-store.mjs:61–63**), alias-aware via `resolveTaskLifecycle`.
- `resolveTaskLifecycle(task)` = `task?.lifecycle ?? mapLegacyPhase(task?.phase) ?? null` (**task-aliases.mjs:20–22**); `mapLegacyPhase`: `shipped→merged`, `closed→archived`, `plan-ready→tracked`, else passthrough (**:43–54**).

### `scripts/lib/emit-derived-artifacts.mjs` + `scripts/lib/emit-snapshot.mjs`
- `emit-derived-artifacts.mjs`: imports `scoreRecommendations` (**:7**), calls it (**:28–34**), writes `recommendations.json` (**:45–48**).
- `emit-snapshot.mjs`: `buildSnapshot` (**:3**) flattens `[...topRecommendations, ...unblockCandidates]` via `normalizeRecommendations` (**:26, :34, :42–53**) into `snapshot.recommendations`. Independently computes per-task `unblockCandidate` flag via `computeUnblockCandidate` (**:21–23**) — separate surface.

### `tools/overview-mcp/src/tools/parallel-ready-tasks.ts` — existing gate (DO NOT TOUCH)
- `EXCLUDED_LIFECYCLES = new Set(['merged','archived'])` (**:25**), applied at **:141** before the stage gate. Uses literal `task.lifecycle ?? ''` (not alias-aware). Shipped v2.10.0.

### Tests — `scripts/lib/score-recommendations.test.mjs`
- Vitest, one `describe('scoreRecommendations')`, 12 tests. Inline fixtures: `byTaskId` (taskId→`{stage,lastUpdatedAt?}`), `overviewData.tasks` (`{id,priority?,status?,blockedOn?,lifecycle?}`), `prdsByTaskId`. Weight presets + `NOW` constant at top. Helpers `top()`, `scoreByTask()` (**lines 224–230**). Existing unblock tests **182–205** and dedup **207–221** already use `lifecycle:'merged'` + `status:'blocked'` — direct templates. Wired into `package.json scripts.test:lib`.

### Release files (under `ai-developer-toolkit/`)
- `plugins/ralph-overview/.claude-plugin/plugin.json` version (**:4**, 2.13.0).
- `.claude-plugin/marketplace.json`, `.github/plugin/marketplace.json`, `.agents/plugins/marketplace.json` (Codex schema: `source.source:"local"` + `policy.{installation:"AVAILABLE",authentication:"ON_INSTALL"}` + `category`).
- `plugins/ralph-overview/CHANGELOG.md`, `plugins/ralph-overview/AGENTS.md`.
- `/release-plugin` skill: `ai-developer-toolkit/.claude/skills/release-plugin/SKILL.md`. Pre-flight: `node tools/validate-codex-marketplace-policy.mjs` from toolkit root.

## Architect Analysis (integration + approach)
- **Sole production caller** of `scoreRecommendations` is `emit-derived-artifacts.mjs:28`, invoked from the watcher derive path (`sync-core.mjs`). Both leaked surfaces (`recommendations.json` and `snapshot.recommendations`) come from the SAME return value — `snapshot.recommendations` is a flatten, not a re-derivation. **Gating inside `scoreRecommendations` fixes both** (plus the viewer rows/NOTIFY chips fed by recommendations). No other callers/re-readers.
- **Approach (recommended):** gate inside `scoreRecommendations` for BOTH arrays using `classifyShard` from `./data-store.mjs`, with an `!task` guard for unknown lifecycle. Reject gating inside `computeUnblockCandidate` (shared by the per-task snapshot flag — would change unrelated semantics).
- **Out of scope (call out in CHANGELOG):** the per-task `snapshot.unblockCandidate` flag and `overview.unblock_candidates` MCP tool are intentionally NOT changed; `overview.parallel_ready_tasks` already gated (v2.10.0).
- **Reuse:** `import { classifyShard } from './data-store.mjs'` (relative `.mjs`, matches existing `./unblock-candidates.mjs` import). Prefer `classifyShard(t) === 'cold'`.
- **Normalization nuance:** production `loadOverviewData` (`sync-core.mjs normalizeOverviewTask`) already maps `phase→lifecycle`, so production sees populated `lifecycle`; but unit tests feed raw legacy `phase`, so alias-awareness via `classifyShard` is required for the mandated legacy-`phase` test.
- **Bump:** MINOR → `2.14.0` (behavioral exclusion change; mirrors how the parallel-ready gate shipped v2.10.0 as minor).
- **Tests:** extend `score-recommendations.test.mjs` (merged/archived/legacy-phase excluded; tracked-ready kept; unknown-lifecycle kept; merged+blocked not an unblockCandidate). Add thin inheritance guards in `emit-derived-artifacts.test.mjs` and `emit-snapshot.test.mjs`.

## Codex Research
Confirms the same Node-side trace (with `sync-core.mjs:535` as the watcher entry calling `emitDerivedArtifacts`) AND surfaces a THIRD actionable surface the other agents missed: **the viewer recomputes NOTIFY chips CLIENT-SIDE via a DUPLICATED `computeUnblockCandidate`** —
- `tools/overview-viewer/src/utils/unblockCandidates.ts:3` (duplicate predicate; gates only `status==='blocked'` + blockers all `lifecycle==='merged'`, NOT the candidate's own lifecycle).
- `tools/overview-viewer/src/components/TaskCommand.tsx:572` (`showUnblockNotify` command-row NOTIFY chip).
- `tools/overview-viewer/src/components/Kanban.tsx:40` (`injectKanbanUnblockPill` kanban NOTIFY pill).
So the Node-side fix does NOT stop the viewer's NOTIFY chips. Constraint: do NOT import `scripts/lib/data-store.mjs` into the browser (it imports `node:fs`). VERIFIED: a browser-safe `taskLifecycle(task)` already exists at `tools/overview-viewer/src/utils/taskAliases.ts:7` (`task.lifecycle ?? task.phase`) and is already imported in both components — so the viewer gate reuses it (no new helper needed; Codex's `taskAliases.ts` suggestion already exists). Note `taskLifecycle` does NOT map legacy phase values (returns raw `task.phase`), so the viewer gate covers `merged`/`archived` lifecycle values (the real, hand-curated data.json case). Codex also recommends viewer tests (no NOTIFY on merged/archived blocked tasks) and the `npm run test:viewer` + `typecheck` gates.

## Copilot Research
Confirms the same code trace (score-recommendations.mjs gap; computeUnblockCandidate gates only on status==='blocked'; classifyShard is the canonical alias-aware predicate; do not retouch parallel-ready-tasks.ts; unknown byTaskId entries must remain eligible). **Key divergence from architect:** Copilot recommends putting the unblock exclusion in `computeUnblockCandidate()` (not only in `scoreRecommendations()`), because `buildSnapshot()` uses that predicate directly for the per-task `snapshotTask.unblockCandidate = true` flag — so a scoreRecommendations-only fix would still let merged/archived tasks leak through viewer NOTIFY chips via the snapshot task flag. **Resolution adopted in this plan:** gate `computeUnblockCandidate` on the candidate's own lifecycle (the complete fix), which covers snapshot.recommendations + the per-task flag + the `overview.unblock_candidates` MCP tool in one DRY place, AND separately gate `topRecommendations` in `scoreRecommendations` (the stage-keyed observed bug, which the unblock gate does not cover).

## Consolidated File List
**Files to modify (impl phase):**
- `scripts/lib/score-recommendations.mjs` — add lifecycle gate (import `classifyShard`).
- `scripts/lib/score-recommendations.test.mjs` — regression tests.
- `scripts/lib/emit-derived-artifacts.test.mjs` — thin inheritance guard.
- `scripts/lib/emit-snapshot.test.mjs` — thin inheritance guard.
- `.claude-plugin/plugin.json` — version → 2.14.0.
- `../../.claude-plugin/marketplace.json`, `../../.github/plugin/marketplace.json`, `../../.agents/plugins/marketplace.json` — ralph-overview version → 2.14.0.
- `CHANGELOG.md`, `AGENTS.md` — entry + behavioral note.

**Reference (read-only):** `data-store.mjs`, `task-aliases.mjs`, `unblock-candidates.mjs`, `emit-derived-artifacts.mjs`, `emit-snapshot.mjs`, `tools/overview-mcp/src/tools/parallel-ready-tasks.ts`, `package.json` (test:lib), `tools/validate-codex-marketplace-policy.mjs`.
