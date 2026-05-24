# Code Review Context — Plan 04 Pipeline Overview

## Codebase patterns observed during review

- **Single emission point.** `writeSidecar({ repoRoot, config, state })` is the single sync-core sidecar entry point. It writes both `overview-ralph-state.{js,json}` and then derives + emits `overview-recommendations.json` and `overview-dependency-graph.json` via `emitDerivedArtifacts()`. Both one-shot CLI (`pnpm sync-ralph-state`) and watcher cold-start / incremental paths funnel through this single call site, so emission stays in sync. Future sidecar-write paths must stay on `writeSidecar` (also documented in `tools/overview-viewer/CLAUDE.md`).

- **prdsByTaskId is a non-enumerable carrier.** `scripts/lib/sync-core.mjs` attaches PRDs to state via `attachPrdsByTaskId(state, prds)` using `Object.defineProperty(..., { enumerable: false })`. This keeps PRD bodies out of the on-disk sidecar JSON (which would balloon size) while making them available to `scoreRecommendations` and `deriveDependencyGraph` through `getPrdsByTaskId(state)`. Do not make PRDs enumerable or treat them as part of the persisted contract.

- **Story IDs are task-namespaced in the dep-graph.** PRD `userStories[].dependencies[]` are story-local. Dep-graph node IDs are `${taskId}:${storyId}` — confirmed in `derive-dependency-graph.mjs` (`storyNodeIdFor`) and the emitted graph JSON. Do not treat `US-001` as globally unique across tasks.

- **Edge field naming diverges from plan.md.** The shipped contract is `{ source, target, kind }` (TypeScript type, derive module, emitted JSON). Plan.md still says `{ from, to, kind }`. The implementation is internally consistent; downstream plans should follow the types/JSON, not plan.md verbatim.

- **atomicWriteFile is now multi-caller.** Originally private, now exported. Used by `writeSidecar` and `emitDerivedArtifacts` and reused in tests. Performs `mkdirSync(recursive) → open → write → fsync → close → renameSync` with EBUSY/EACCES/EPERM rename retry (3 attempts, 100ms delay) — important on Windows where AV scanners briefly lock files.

- **Run durations key by `run.id`, not by bundle.** Implementation assigns the same per-task latest-completed-bundle duration to every `run.id` matching that task. Documented as "transient" in plan; Plan 05 absorbs into `Snapshot.runDurations`. Consumers should not interpret per-run duration as historically accurate.

- **HMR cleanup must tolerate partial `import.meta.hot`.** Vitest exposes a partial `import.meta.hot` object (no `off` method). `App.tsx` uses `import.meta.hot?.off?.(...)` while keeping additive `on(...)` subscriptions active.

- **Interaction tests under `src/__tests__/interactions/`.** Only the jsdom Vitest project includes that path. Tests needing `userEvent`, `@testing-library/react` clicks, or Radix surfaces (Dialog, Tooltip) belong there — not in `src/__tests__/*`.

- **Static build budget under 512000 bytes.** `plans/overview.html` regenerated to 504238 bytes; the budget is "< 512000 bytes" (matches F-007 from plan review). The sidecar is minified via esbuild inside `vite.config.ts` to preserve the budget.

## Files relevant to follow-up

- `scripts/lib/sync-core.mjs` — single emission point; future Plan 05 rebase target
- `scripts/lib/score-recommendations.mjs` — recommendation scoring contract
- `scripts/lib/derive-dependency-graph.mjs` — DAG contract; cycle warning only, no throw
- `tools/overview-viewer/src/components/PipelineOverview.tsx` — histogram component
- `tools/overview-viewer/src/utils/ralphStages.ts` — canonical RALPH_STAGE_ORDER
- `plans/ralph-pipeline-04-refresh-changelog.md` — downstream-plan refresh artifact
- `plans/overview-recommendations.json` / `plans/overview-dependency-graph.json` — emitted artifacts; recommendations is a bare `Recommendation[]`, graph is `{ generatedAt, generatedFromCommit, nodes, edges }`.
