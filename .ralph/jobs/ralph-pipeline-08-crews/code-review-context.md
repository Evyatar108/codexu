# Code Review Context — ralph-pipeline-08-crews

## Codebase Conventions Observed

- All sync-core helpers normalize config paths via `normalizeConfigPaths()` (sync-core.mjs:851). New top-level config roots (here: `crewsRoot`) MUST be added to this normalizer in addition to `resolveConfigPaths()` (resolve-config.mjs), because `assembleStateFromBundles()` re-normalizes when callers pass partial configs (e.g., tests). The plan's F-021 soft-cap deferral explicitly called this out and was followed in sync-core.mjs:857.
- `path.relative(parent, child)` + check for `''` or non-`..`/non-absolute is the standard pattern for "is child inside parent" — used in `isPathInside()` (sync-core.mjs:876) and `isManifestCwdInsideRepo()` (crews-cross-walk.mjs:107). New child-inside-root checks should use the same pattern.
- Glob ignore patterns are evaluated via `matchesIgnored()` (path-utils.mjs:26), which relativizes against a SINGLE root. This works as long as all ignore patterns are anchored at that root. Cross-root patterns (e.g., `.crews/` outside the worktree) are NOT supported by the current helper.
- Linked-worktree detection consistently uses `git rev-parse --git-dir` vs `--git-common-dir` (resolve-config.mjs:158). When they differ, base resolution should use `path.resolve(repoRoot, commonDir, '..')`.

## Cross-Cutting Concerns

- **Lock contract.** All subcommands and the watcher share `config.lockFile` via sync-lock.mjs. `work-on-via-crew.mjs:65` re-implements the lock preflight (read JSON, check PID liveness, format diagnostic) outside sync-lock.mjs. The duplication is intentional (preflight must NOT acquire) but the constants `WATCHER_LOCK_PROCESSES` and `formatLockDiagnostic` should ideally be exported from sync-lock.mjs to avoid drift. Not a finding for this round, but worth tracking.
- **Schema strictness.** `.ralph/overview-config.schema.json` rejects unknown root properties (`additionalProperties: false`). Plan 08 atomically added `crewsRoot` to schema + default-config.mjs + default-config.d.mts + resolve-config.mjs. Future config additions must do the same.
- **Stage values.** Subcommands validate stage strings against the union (`RALPH_STAGES` set in scripts/sync-ralph-state.mjs:18). The set is duplicated from `tools/overview-viewer/src/types.ts` `RalphStage` union. Future stage additions require touching both.

## Relevant File Relationships

- `crews-cross-walk.mjs` → `parse-spawn-launcher.mjs` (launcher index) → `default-config.mjs` (ignore patterns).
- `sync-core.mjs::mergeAndWrite()` invokes `mergeDiscoveredCrewSessions()` AFTER `assembleStateFromBundles()`, so crew merging runs twice in the watcher tick path (once per per-slug `deriveAffectedTaskUpdate` fragment, then once globally). Idempotent but redundant — leave as-is until perf evidence shows otherwise.
- `RalphPipelineState.crewSessions` flows: heuristic (crews-cross-walk) ⇄ explicit (sync-ralph-state.mjs subcommands) ⇄ schema (emit-snapshot-schema.mjs) ⇄ UI (TaskCommand.tsx tooltip extras).

## Gotchas

- `matchesIgnored()` relativizing against a single root means cross-root ignore patterns silently fail. See finding F-005 for the linked-worktree mailbox/outbox case.
- The schema's `crewSessions` map (`CrewSessionsByStage`) uses `additionalProperties: false` with explicit per-stage `properties`. This is intentional (matches the RalphStage union) but means future stage additions must touch BOTH the type union AND the schema.
- `runUpdateCrewSession` writes the sidecar (`config.outputs.sidecarJson`), not the snapshot. `writeSidecar()` regenerates the snapshot downstream. Don't be surprised that direct snapshot edits would be overwritten.
