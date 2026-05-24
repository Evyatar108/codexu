# Plan 06 Research Brief

## Key verifications

### Stage list (10 stages, all present in derive-ralph-stage.mjs)
`brainstorming`, `brainstorm-ready`, `planning`, `plan-ready`, `implementing`, `reviewing`, `review-fix`, `replan-pending`, `shipped`, `blocked`.

`derive-ralph-stage.mjs` returns `replan-pending` when `orchestrator.terminal === true && terminalReason === 'replan'` (line 30-32). The pipeline state surfaces only the derived `stage` plus a separate `terminalReason` field — the `orchestrator` object is internal to sync-core/derive-ralph-stage.

### Types (tools/overview-viewer/src/types.ts)

- `OverviewTask` has `command?: OverviewCommand` where `OverviewCommand` has `planPrompt?: string | null` (line 10).
- `RalphPipelineState` (line 61–75): `stage`, `entryPath`, `artifacts?: { brainstormDir, planDraftFile, jobDir, groupDir, planFile, prdFile }`, `jobSlug`, `groupSlug`, `isParallel`, `matchSource`, `storyCompletion`, `reviewOpenCount: Record<string, number | undefined>`, `hasPrdWorthy`, `terminalReason: 'complete' | 'replan' | 'blocked'`, `lastUpdatedAt`.
- **`NextCommand` type does NOT exist** — Plan 06 needs to add it (additive merge with Plan 07).
- `SnapshotTask extends OverviewTask` adds `ralph?: RalphPipelineState`.
- `Snapshot` has `tasks: SnapshotTask[]`, `recommendations: Recommendation[]`, `dependencyGraph`, `runDurations`, `unmatched`, `unmatchedSummary`.
- `Recommendation` shape: `{ taskId, score, stage, reasons }` — matches the plan.
- `OverviewTask.mergeCommit` exists.

### reviewOpenCount keys
`sync-core.mjs` line 35–38: `FINDINGS_FILES = [['code', 'code-review-findings.json'], ['docs', 'docs-review-findings.json']]`. So `ralph.reviewOpenCount.code` and `.docs` are the canonical keys — plan reference is correct.

### Snapshot files at runtime
- `plans/overview-snapshot.json` and `plans/overview-recommendations.json` do NOT currently exist on disk in this worktree. They are emitted by `scripts/lib/sync-core.mjs` via `emitDerivedArtifacts()` + `emitAgentArtifacts()` when `pnpm sync-ralph-state` or `pnpm sync-ralph-state:watch` runs. Plan 06's skills handle the missing-file case (suggest running `pnpm sync-ralph-state`).

### Test infrastructure (CORRECTION TO PLAN)
- **Plan says** `scripts/lib/__tests__/deriveNextCommand.test.mjs`.
- **Actual convention** in repo: tests live next to source files under `scripts/lib/` directly, kebab-case suffix `.test.mjs` (e.g. `derive-dependency-graph.test.mjs`, `emit-snapshot.test.mjs`, `score-recommendations.test.mjs`).
- `vitest.config.ts` line 7: `include: ['scripts/lib/**/*.test.mjs']` — glob picks up both flat and nested.
- **Correct file path:** `scripts/lib/derive-next-command.test.mjs` (no `__tests__/` subdir).
- Root `pnpm test` runs `vitest run` for the scripts project.
- Single-file form: `pnpm test scripts/lib/derive-next-command.test.mjs` is the actual command (vitest accepts a filter argument).

### .claude/skills/ structure
Repo-local skills exist (`run-tests/`, `agent-browser/`, `terminal-emulator/`, `control-flow/`, `release/`, `maintain/`, `metrics-graphana/`, `happy-release-to-fork/`). Each is a directory containing `SKILL.md` with YAML frontmatter (`name`, `description`) followed by body markdown. `run-tests/SKILL.md` is the best stylistic reference (active-voice instructions for Claude, decision rules, file paths).

### TaskCommand.tsx + copyTextWithToast
`tools/overview-viewer/src/components/TaskCommand.tsx` exists; `copyTextWithToast` is imported there. The optional Copy-button UI integration is feasible but explicitly deferrable per plan §"Out of scope".

### Parallel safety (Plan 07 disjoint)
Plan 07 (context-worker) touches:
- `scripts/lib/parse-notepad.mjs`, `scripts/lib/derive-pr-links.mjs`, `scripts/lib/append-journal.mjs` (new files — disjoint).
- `tools/overview-viewer/src/components/RecentActivity.tsx` (different component — disjoint).
- `tools/overview-viewer/src/types.ts` — additive (different field clusters). Plan 06 adds `NextCommand`; Plan 07 adds `deferredQuestionsCount`/`deferredQuestionsPreview` to `RalphPipelineState`. No conflict.

### Cascade plan refresh targets
All present:
- `plans/ralph-pipeline-INDEX.md` — has DAG + source-of-truth modules table.
- `plans/ralph-pipeline-07-context.md` — extends `RalphPipelineState` with deferred-question fields that `/blocker-report` will consume.
- `plans/ralph-pipeline-08-crews.md` — adds `--via-crew` to `/work-on`.
- `plans/ralph-pipeline-09-mcp.md` — wraps the same `deriveNextCommand` predicate as MCP tools.

## Stale-assumption summary (to fix in Phase 3 plan revision)

1. **Test file path** — plan's `scripts/lib/__tests__/deriveNextCommand.test.mjs` → must be `scripts/lib/derive-next-command.test.mjs` (matches existing kebab-case naming convention; no `__tests__/` subdir exists in repo).
2. **Verification command** — `pnpm test scripts/lib/__tests__/deriveNextCommand.test.mjs` → `pnpm test scripts/lib/derive-next-command.test.mjs`.
3. **Predicate input source** — Plan §"deriveNextCommand predicate table" caption says "Inputs: the task's `RalphPipelineState` and the corresponding `OverviewTask`." Confirm that the predicate reads `state.stage` (not `orchestrator.terminal`/`terminalReason` directly) — those are derived upstream. The `replan-pending` row's parenthetical mentions `orchestrator.terminal === true && terminalReason === 'replan'` which is correct as a description of when `derive-ralph-stage.mjs` emits the stage, but `deriveNextCommand` itself only switches on `state.stage`. Plan should clarify this to avoid implementers reading raw orchestrator fields.
4. **`overview-recommendations.json` shape** — `Recommendation[]` directly (per `score-recommendations.mjs`), not wrapped in `{ recommendations, generatedAt, generatedFromCommit }`. Verify with `score-recommendations.mjs` before finalizing skill body.

## Files of interest (paths)

- D:/harness-efforts/codexu/scripts/lib/derive-ralph-stage.mjs — predicate to mirror.
- D:/harness-efforts/codexu/scripts/lib/derive-dependency-graph.test.mjs — test style reference.
- D:/harness-efforts/codexu/scripts/lib/score-recommendations.mjs — `Recommendation` shape source.
- D:/harness-efforts/codexu/scripts/lib/sync-core.mjs — overview-snapshot/recommendations emission.
- D:/harness-efforts/codexu/tools/overview-viewer/src/types.ts — types to extend additively.
- D:/harness-efforts/codexu/tools/overview-viewer/src/__tests__/ralphStage.test.ts — vitest style reference.
- D:/harness-efforts/codexu/tools/overview-viewer/src/components/TaskCommand.tsx — optional UI button integration site.
- D:/harness-efforts/codexu/.claude/skills/run-tests/SKILL.md — repo-local skill style reference.
- D:/harness-efforts/codexu/plans/ralph-pipeline-INDEX.md — INDEX to update in cascade.
- D:/harness-efforts/codexu/plans/ralph-pipeline-07-context.md — Plan 07 plan; deferred-question handoff.
- D:/harness-efforts/codexu/plans/ralph-pipeline-08-crews.md — Plan 08 plan; `--via-crew` follow-up.
- D:/harness-efforts/codexu/plans/ralph-pipeline-09-mcp.md — Plan 09 plan; MCP wrapper.
