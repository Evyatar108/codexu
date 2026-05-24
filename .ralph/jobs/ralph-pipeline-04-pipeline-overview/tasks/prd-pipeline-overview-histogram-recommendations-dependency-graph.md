# PRD: Pipeline Overview — Aggregate Histogram + Recommendations + Dependency Graph

*Autonomous-mode PRD generated from `D:/harness-efforts/codexu/.ralph/jobs/ralph-pipeline-04-pipeline-overview/plan.md` and `stories-outline.md`. Stories are lifted verbatim from the plan-review-converged stories outline (US-001…US-009); do not regenerate them.*

## Introduction

Plan 03 placed a stage chip on every task row. With ~18 tasks, scanning the chips to find pipeline bottlenecks takes ~10 seconds. This plan adds:

1. A horizontal **stage histogram** at the top of the overview dashboard that answers the bottleneck question in ~0.5 seconds and doubles as a single-select filter composing with the existing multi-select toolbar.
2. Two new **sidecar artifacts** emitted by the sync pipeline so the dashboard, the planned `/triage` skill (Plan 06), and the MCP server (Plan 09) share one canonical source of truth:
   - `plans/overview-recommendations.json` — ranked next-action list with reasons.
   - `plans/overview-dependency-graph.json` — node/edge graph derived from `overviewData.spawnedFrom`, bookkeeper-edited `OverviewTask.blocks`, and PRD `userStories[].dependencies[]`.
3. Transient `runDurations` map on `OverviewRalphState` (Plan 05 will absorb into `Snapshot.runDurations`).

Together this turns the dashboard from "see current state" into "prioritize next action."

**Assumptions / inferred defaults (autonomous mode):**
- Branch: new branch `ralph-pipeline-04-pipeline-overview` forked from `main`.
- Worktree: `D:/harness-efforts/codexu/.ralph/jobs/ralph-pipeline-04-pipeline-overview/worktree/`.
- Story review: auto-approve (story content lifted from `stories-outline.md` which has been through plan-with-ralph Phase 4 review).
- Iteration engine: `codex`. Planning engine: `codex`.
- `OverviewTask.priority` is bookkeeper-edited; no auto-population from any source. Default fallback in scorer is `0.5` when missing.
- `OverviewRalphState.aggregateStages` is NOT added — counts derived client-side in `PipelineOverview` (per F-012 medium finding).
- Interaction tests live under `tools/overview-viewer/src/__tests__/interactions/` to get jsdom + `@testing-library/react` + `userEvent` (per F-013).

**Parallel work in flight:** Plan 05 (agent-readable exports) runs in a sibling worktree and edits `scripts/lib/sync-core.mjs` and `tools/overview-viewer/src/types.ts`. Plan 04 lands first; Plan 05 absorbs `runDurations` and rebases on Plan 04's emission helper. Pre-PR rebase guard is in US-001, US-002, and US-005.

## Goals

- Render an aggregate stage histogram between Toolbar and Kanban so users see the pipeline shape at a glance.
- Click-to-filter on the histogram replaces `filters.ralphStage` with a single-stage set (the toolbar group keeps multi-select; they share the same axis).
- Emit `plans/overview-recommendations.json` and `plans/overview-dependency-graph.json` from BOTH the one-shot `pnpm sync-ralph-state` path AND the watcher path (cold-start and incremental).
- Attach `state.runDurations` to the Ralph sidecar before `writeSidecar` runs, populated from `overviewData.runs[]` matched against per-bundle `createdAt`/`completedAt`.
- Add bookkeeper-editable fields `OverviewTask.priority?: number` and `OverviewTask.blocks?: string[]`.
- Extend config schema, defaults, resolver, and tests with `outputs.recommendationsJson`, `outputs.dependencyGraphJson`, `recommendations.topN`, `recommendations.weights`.
- Refresh downstream Plan 05/06/09 and INDEX markdown so DAG and source-of-truth tables match what shipped.

## User Stories

Stories are lifted from `stories-outline.md` with no semantic changes. Every story includes `Typecheck passes` and UI stories include `Verify in browser using dev-browser skill` per the converter rules.

### US-001: Add types + fields

**Description:** As an implementer, I want the new types (`Recommendation`, `DependencyGraph`, `DependencyNode`, `DependencyEdge`) and field additions (`OverviewTask.blocks?`, `OverviewTask.priority?`, `OverviewRalphState.runDurations?`) declared in `tools/overview-viewer/src/types.ts` so downstream stories can import them without conflict.

**Acceptance Criteria:**
- [ ] `Recommendation`, `DependencyGraph`, `DependencyNode`, `DependencyEdge` declared in `tools/overview-viewer/src/types.ts`.
- [ ] `OverviewTask` has optional `blocks: string[]` and `priority: number`.
- [ ] `OverviewRalphState` has optional `runDurations: Record<string, number>` (hours). Do NOT add `aggregateStages?` — derived client-side per F-012.
- [ ] `pnpm --filter @codexu/overview-viewer typecheck` passes.
- [ ] Before opening PR: `git fetch origin main && git rebase origin/main`; if Plan 05 has merged and `runDurations` moved to `Snapshot`, relocate this change per the plan's Risk Areas guidance.
- [ ] Typecheck passes.

**Dependencies:** None
**Estimated complexity:** small

### US-002: Config plumbing for recommendations + output paths

**Description:** As an implementer, I want `.ralph/overview-config.schema.json`, `scripts/lib/default-config.mjs`, `scripts/lib/default-config.d.mts`, and `scripts/lib/resolve-config.mjs` extended with `outputs.recommendationsJson`, `outputs.dependencyGraphJson`, and a `recommendations` block (with `topN` and `weights`) so downstream stories can read configured paths and weights.

**Acceptance Criteria:**
- [ ] Schema admits the new keys (preserve `additionalProperties: false` discipline) — `outputs.recommendationsJson`, `outputs.dependencyGraphJson`, `recommendations.topN`, `recommendations.weights.stageUrgency`, `recommendations.weights.dependencyState`, `recommendations.weights.freshness`, `recommendations.weights.priority`.
- [ ] Defaults: `outputs.recommendationsJson = "plans/overview-recommendations.json"`, `outputs.dependencyGraphJson = "plans/overview-dependency-graph.json"`, `recommendations.topN = 20`, `weights = { stageUrgency: 40, dependencyState: 30, freshness: 20, priority: 10 }`.
- [ ] `scripts/lib/resolve-config.mjs` resolves the two new output paths to absolute paths under `repoRoot`.
- [ ] `.ralph/overview-config.json` (the committed file) is updated in place to add the `recommendations` block — do NOT recreate the file (per F-009).
- [ ] Existing `tools/overview-viewer/src/__tests__/config.test.ts` still passes; extend it (or add `scripts/lib/resolve-config.test.mjs`) to assert the resolved absolute paths and default weights (per F-010).
- [ ] Pre-PR rebase check (same wording as US-001).
- [ ] Typecheck passes.
- [ ] Tests pass.

**Dependencies:** None
**Estimated complexity:** small

### US-003: `scoreRecommendations` pure module

**Description:** As an implementer, I want a pure `scoreRecommendations({ byTaskId, overviewData, prdsByTaskId, config? }) → Recommendation[]` module under `scripts/lib/score-recommendations.mjs` with adjacent `.d.mts` and tests, so `sync-core` can derive a ranked list at write time.

**Acceptance Criteria:**
- [ ] Implements the scoring rubric: `stageUrgency` per stage map (`review-fix=1.0, replan-pending=0.95, plan-ready=0.9, reviewing=0.7, implementing=0.6, blocked=0.5, planning=0.4, brainstorm-ready=0.3, brainstorming=0.2, shipped=0.0`); `dependencyState` from PRD `userStories[].dependencies[]` + `passes` (unblocked=1.0, partial=0.5, blocked=0.0, missing-PRD=0.0 + low-confidence reason); `freshness` linear decay from 1.0 (today) to 0.0 (≥14 days ago) using `RalphPipelineState.lastUpdatedAt`; `priority` from `OverviewTask.priority` (clamped 0..1) or `0.5` fallback.
- [ ] `score = sum(weight_i * value_i) / sum(weight_i)` in `[0, 1]`. Sort descending. Default top 20 (configurable via `config.topN`).
- [ ] Each `Recommendation`: `{ taskId, score, stage, reasons: string[] }` with the 2–3 strongest contributing factors written as human-readable strings.
- [ ] `scripts/lib/score-recommendations.d.mts` declares the export.
- [ ] `scripts/lib/score-recommendations.test.mjs` (vitest) covers: stage urgency mapping, dependency state (unblocked / partial / blocked / missing-PRD), freshness decay, priority fallback, weight overrides (including `weights.priority = 50` deterministic ranking shift per F-015), top-N truncation.
- [ ] Typecheck passes.
- [ ] Tests pass.

**Dependencies:** US-001, US-002
**Estimated complexity:** medium

### US-004: `deriveDependencyGraph` pure module

**Description:** As an implementer, I want a pure `deriveDependencyGraph({ generatedAt, generatedFromCommit, overviewData, byTaskId, prdsByTaskId }) → { generatedAt, generatedFromCommit, nodes, edges }` module under `scripts/lib/derive-dependency-graph.mjs` with adjacent `.d.mts` and tests, so the dep-graph artifact can be emitted.

**Acceptance Criteria:**
- [ ] Nodes carry `{ id: string, kind: 'task' | 'story', taskId: string, storyId?: string, stage?: RalphStage }`. Story node IDs use the namespaced form `${taskId}:${storyId}`.
- [ ] Edge kinds emitted: `spawn` (from `overviewData.spawnedFrom[child] = parent` producing `parent → child`), `blocks` (task-level from `OverviewTask.blocks[]`), `depends-on-story` (PRD `userStories[i].dependencies[]` → `${taskId}:${depStoryId} → ${taskId}:${storyId}`).
- [ ] Output's `generatedAt` and `generatedFromCommit` come from the input arguments (the Ralph sidecar state), NOT from `overviewData` (per F-005).
- [ ] Cycle detection: emit a `process.stderr.write` warning; do not throw.
- [ ] `scripts/lib/derive-dependency-graph.d.mts` declares the export.
- [ ] `scripts/lib/derive-dependency-graph.test.mjs` (vitest) covers each edge kind, cycle warning, namespaced story IDs, and explicit sidecar-metadata passthrough.
- [ ] Typecheck passes.
- [ ] Tests pass.

**Dependencies:** US-001
**Estimated complexity:** medium

### US-005: State enrichment in `sync-core.mjs`

**Description:** As an implementer, I want `assembleStateFromBundles` extended to build `prdsByTaskId` from matched bundles and compute `state.runDurations` (keyed by `run.id`, only when both `createdAt` and `completedAt` exist) so that downstream emission has all the data it needs and `writeSidecar` serializes a complete sidecar payload. `deriveAffectedTaskUpdate` / `mergeAndWrite` must propagate the same enrichment on incremental updates.

**Acceptance Criteria:**
- [ ] `assembleStateFromBundles` returns enriched state with `runDurations` (in hours, keyed by `run.id`, omitting runs without both timestamps — no `null` values) and a non-persisted `prdsByTaskId` carrier (in a return tuple or attached to an in-memory state object — NOT serialized into the sidecar JSON).
- [ ] `deriveAffectedTaskUpdate` / `mergeAndWrite` recompute or propagate `runDurations` and `prdsByTaskId` for incremental updates so the watcher path stays consistent with one-shot.
- [ ] `state.runDurations` is populated BEFORE `writeSidecar` runs on every code path (one-shot CLI, watcher cold-start, watcher incremental).
- [ ] Tests assert one-shot and incremental paths produce equivalent enriched state.
- [ ] Pre-PR rebase check (same wording as US-001) — Plan 05 also edits this file.
- [ ] Typecheck passes.
- [ ] Tests pass.

**Dependencies:** US-003, US-004
**Estimated complexity:** medium

### US-006: `emitDerivedArtifacts` helper + `writeSidecar` hook

**Description:** As an implementer, I want a shared `emitDerivedArtifacts({ repoRoot, config, recommendations, dependencyGraph })` helper called after every `writeSidecar` invocation (one-shot, watcher cold-start, watcher incremental) so both derived artifacts are emitted atomically wherever the sidecar is written.

**Acceptance Criteria:**
- [ ] `scripts/lib/sync-core.mjs` exports `atomicWriteFile`.
- [ ] `sync-core.mjs` calls `scoreRecommendations(...)` and `deriveDependencyGraph(...)` once with `prdsByTaskId` from US-005; the results are passed to `emitDerivedArtifacts` AFTER `writeSidecar` resolves.
- [ ] Both `plans/overview-recommendations.json` and `plans/overview-dependency-graph.json` are written via `atomicWriteFile` (tmp + fsync + rename) on every sidecar-write path.
- [ ] `writeSidecar` signature stays `{ repoRoot, config, state }` — it does NOT receive `overviewData` or PRDs.
- [ ] Recommendations and dep-graph payloads use `state.generatedAt` and `state.generatedFromCommit` as metadata (NOT `overviewData.generatedFromCommit`).
- [ ] A new sync-core test exercises the one-shot CLI path and asserts both files appear with valid JSON shapes (`recommendations: []` and `nodes`/`edges` arrays).
- [ ] A new sync-core / watcher test exercises the watcher cold-start / flush path and asserts both artifacts re-emit with advanced `generatedAt` (per F-016).
- [ ] Pre-PR rebase check (same wording as US-001).
- [ ] Typecheck passes.
- [ ] Tests pass.

**Dependencies:** US-005
**Estimated complexity:** medium

### US-007: `PipelineOverview.tsx` component + CSS

**Description:** As a user, I want a horizontal histogram of stage chips between Toolbar and Kanban so I can see the pipeline shape at a glance and click a chip to filter.

**Acceptance Criteria:**
- [ ] `tools/overview-viewer/src/components/PipelineOverview.tsx` renders 10 stage chips in canonical `RALPH_STAGE_ORDER` with `<stage> · <count>` labels.
- [ ] Counts derived client-side from `ralphState.byTaskId` (no dependency on a precomputed `aggregateStages` field).
- [ ] Empty state renders when total count is `0` OR `ralphState === null`.
- [ ] Click handler: if `filters.ralphStage.has(stage)`, clear `filters.ralphStage` to an empty set; else replace with `new Set([stage])` (single-select on this surface).
- [ ] `RALPH_STAGE_ORDER` exported from `tools/overview-viewer/src/utils/ralphStages.ts` (or re-exported from `PipelineOverview.tsx`) for shared use; `Toolbar.tsx` refactor is out of scope.
- [ ] `tools/overview-viewer/src/styles.css` extended with `.pipeline-overview`, `.pipeline-overview-empty`, hover/active/focus states.
- [ ] Typecheck passes.
- [ ] Verify in browser using dev-browser skill.

**Dependencies:** US-001
**Estimated complexity:** medium

### US-008: `App.tsx` integration + HMR check

**Description:** As a user, I want the histogram visible on page load and updated via HMR when the watcher emits new state.

**Acceptance Criteria:**
- [ ] `tools/overview-viewer/src/App.tsx` renders `<PipelineOverview ralphState={ralphState} filters={filter.activeFilters} setFilters={filter.setFilters} />` between `<Toolbar />` and `<Kanban />`.
- [ ] Existing `overview-ralph-state:update` HMR handler still refreshes `ralphState`; the histogram re-renders without page reload.
- [ ] `pnpm overview` boots; manual smoke test confirms histogram + click-to-filter behave per US-007 ACs.
- [ ] Typecheck passes.
- [ ] Verify in browser using dev-browser skill.

**Dependencies:** US-007
**Estimated complexity:** small

### US-009: Tests, end-to-end, and downstream-plan refresh

**Description:** As a maintainer, I want full feature verification plus refreshed downstream plan markdown so Plans 05/06/09 and the INDEX reflect what shipped.

**Acceptance Criteria:**
- [ ] `tools/overview-viewer/src/__tests__/interactions/pipelineOverview.test.tsx` covers: histogram count rendering, click-to-filter (replace + clear), empty-state branch, multi-select coexistence with the toolbar filter group. Lives under `interactions/` per F-013 so jsdom + `userEvent` are available.
- [ ] `pnpm --filter @codexu/overview-viewer typecheck` and `pnpm --filter @codexu/overview-viewer test` both pass.
- [ ] `pnpm sync-ralph-state` (one-shot) emits both artifacts; verify via `jq` checks per plan Verification A.
- [ ] `pnpm overview:build` regenerates `plans/overview.html`; the file is `< 512000` bytes; the regenerated file is committed in this story.
- [ ] Audit and refresh `plans/ralph-pipeline-05-*.md`, `plans/ralph-pipeline-06-*.md`, `plans/ralph-pipeline-09-*.md`, and `plans/ralph-pipeline-INDEX.md` for stale references (file paths, type signatures, function/export names, behavior contracts, module dependencies).
- [ ] Create `plans/ralph-pipeline-04-refresh-changelog.md` listing each downstream-plan diff (file, lines, what changed). Commit this file plus the updated plans in the same final commit (per F-008).
- [ ] No existing tests broken across the repo.
- [ ] Typecheck passes.
- [ ] Tests pass.
- [ ] Verify in browser using dev-browser skill.

**Dependencies:** US-006, US-007, US-008
**Estimated complexity:** large

## Functional Requirements

- **FR-1:** The system must declare `Recommendation`, `DependencyGraph`, `DependencyNode`, `DependencyEdge` interfaces in `tools/overview-viewer/src/types.ts`, plus optional `OverviewTask.priority`, `OverviewTask.blocks`, and `OverviewRalphState.runDurations`.
- **FR-2:** The config layer must accept and resolve `outputs.recommendationsJson`, `outputs.dependencyGraphJson`, and a `recommendations` block (`topN`, `weights.{stageUrgency,dependencyState,freshness,priority}`) with the documented defaults; `additionalProperties: false` must be preserved.
- **FR-3:** The pure `scoreRecommendations` module must implement the four-dimension rubric (stage urgency, dependency state, freshness, priority) and return a sorted `Recommendation[]` of up to `config.topN`, each carrying 2–3 human-readable reasons.
- **FR-4:** The pure `deriveDependencyGraph` module must emit `spawn`, `blocks`, and `depends-on-story` edges; story node IDs must be namespaced `${taskId}:${storyId}`; metadata must come from the sidecar input, not `overviewData`.
- **FR-5:** `assembleStateFromBundles`, `deriveAffectedTaskUpdate`, and `mergeAndWrite` must enrich state with `runDurations` (hours, keyed by `run.id`, omitting entries without both timestamps) and a non-persisted `prdsByTaskId` carrier before `writeSidecar` is called.
- **FR-6:** A shared `emitDerivedArtifacts({ repoRoot, config, recommendations, dependencyGraph })` helper must write both artifact files via `atomicWriteFile` after `writeSidecar` resolves, on every sidecar-write code path. `atomicWriteFile` must be exported from `scripts/lib/sync-core.mjs`.
- **FR-7:** `PipelineOverview.tsx` must render 10 stage chips in `RALPH_STAGE_ORDER`, with empty state when total count is `0` or `ralphState === null`; clicking a chip must single-select replace `filters.ralphStage` (or clear it if already active).
- **FR-8:** `App.tsx` must render `<PipelineOverview>` between `<Toolbar />` and `<Kanban />`, threading `ralphState`, `filter.activeFilters`, and `filter.setFilters`. HMR refresh via `overview-ralph-state:update` must continue to update the histogram without a page reload.
- **FR-9:** US-009 must produce a verifiable downstream refresh: updated Plans 05/06/09 + INDEX, plus an in-repo changelog `plans/ralph-pipeline-04-refresh-changelog.md`, committed alongside the updated plan files.

## Non-Goals (Out of Scope)

- Snapshot file and activity tail — Plan 05 owns these.
- `/triage` skill consuming recommendations — Plan 06.
- MCP tool exposing recommendations + DAG — Plan 09.
- Inline DAG in chip tooltip — explicitly cut from this plan (no browser plumbing exists today).
- Auto-population of `OverviewTask.blocks` — explicit bookkeeper signal only.
- Refactoring `Toolbar.tsx` to import the shared `RALPH_STAGE_ORDER` constant — follow-up only.
- Adding `aggregateStages?` to `OverviewRalphState` — per F-012 medium finding, derive client-side.
- Adding an ajv runtime validator for `.ralph/overview-config.schema.json` — per F-011 medium finding, the schema is documentation only; resolver tests assert behavior.

## Design Considerations

- Reuse `RalphStageChip` styling primitives where possible. The histogram is a flex row of chips with counts.
- Empty state must be guidance text, not broken chips — first-time users without `.ralph/` data must see a clear message.
- The histogram and toolbar filter group write to the SAME `filters.ralphStage` axis; this is intentional. Histogram = single-select replace (triage); toolbar group = multi-select toggle (power filtering).
- Stage chip click handler must replace, not toggle (toggle is the toolbar's job).

## Technical Considerations

- **Two emission paths must both fire.** One-shot CLI (`pnpm sync-ralph-state`) and watcher cold-start call `writeSidecar` directly without going through `mergeAndWrite`. Derivation must happen in both `assembleStateFromBundles` and `mergeAndWrite` so file emission lands on every path.
- **`runDurations` is transient.** Plan 05 will absorb it into `Snapshot.runDurations`. Do not build consumer code against `OverviewRalphState.runDurations` long-term.
- **Story IDs are namespaced.** PRD `userStories[].dependencies[]` are story-local. Dep-graph node IDs are `${taskId}:${storyId}` — don't treat `US-001` as globally unique.
- **`overviewData.spawnedFrom` is top-level** (`Record<childTaskId, parentTaskId>`), not on `OverviewTask`.
- **`.d.mts` declarations** are required alongside new `scripts/lib/*.mjs` consumed by typed code or tests.
- **Plan 05 coupling.** Pre-PR rebase guard in US-001, US-002, US-005. If Plan 05 has merged when this branch is ready, relocate `runDurations` per the plan's Risk Areas guidance.

## Success Metrics

- Time to spot pipeline bottleneck drops from ~10s (scanning chips) to ~0.5s (reading histogram).
- `plans/overview-recommendations.json` and `plans/overview-dependency-graph.json` exist with valid JSON shapes after `pnpm sync-ralph-state` AND after a watcher cycle, with `generatedAt` advancing on each emission.
- All existing tests pass; new unit + interaction tests added (score-recommendations, derive-dependency-graph, pipelineOverview interactions, sync-core one-shot + watcher emission tests).
- `plans/overview.html` regenerated and committed at `< 512000` bytes.
- Downstream plans (05/06/09) and INDEX reflect the canonical artifact filenames, type signatures, and behavior contracts; `plans/ralph-pipeline-04-refresh-changelog.md` lists each diff.

## Open Questions

1. **Toolbar dedupe** — currently hardcodes the 10 stages. Mechanical refactor to import shared `RALPH_STAGE_ORDER` is intentionally deferred to keep this plan focused.
2. **Plan 05 timing.** If Plan 05 lands first, US-005's `runDurations` site moves into `Snapshot`. Plan 04 lands first per the parallel-work context; the rebase guard covers the inverse case.
3. **`aggregateStages` in `Snapshot`** — Plan 05 may bake this in. Plan 04 deliberately does not pre-emptively declare the field on `OverviewRalphState` to avoid an unowned contract.

## Notes

- Plan-review converged on all 8 High findings (F-001…F-008); 8 Medium findings (F-009…F-016) are recorded in `plan-review-findings.json` and addressed inline in the story acceptance criteria above where actionable.
- Stories are auto-approved in this autonomous run; the converter will not prompt for review.
