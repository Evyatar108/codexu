# Code Review Context — Plan 05 Agent-readable exports

Patterns and gotchas discovered while reviewing the round-1 implementation. Hand this to the code-fixer to avoid re-discovery.

## Codebase conventions observed

- **Atomic writes go through `scripts/lib/sync-core.mjs::atomicWriteFile`.** It does tmp + fsync + rename-with-retry against EBUSY/EACCES/EPERM. Any new emitter that writes to disk in the lock window MUST reuse it; `fs.writeFileSync` is reserved for tests and dev tooling. `scripts/lib/emit-snapshot-schema.mjs::writeSnapshotSchema` is the one exception today and should be removed or aligned (see F-006).
- **Activity log atomicity contract.** `scripts/lib/emit-activity.mjs::appendActivity` is the only writer. It opens the file in append mode, issues one `fs.writeSync` + `fs.fsyncSync` + close. Lines stay ≤ 4096 bytes (enforced at the call site). Readers must tolerate a torn final line — the AGENTS.md note at line 18 and `scripts/lib/emit-activity.test.mjs::readEventsToleratingTornFinalLine` codify the contract.
- **Single integration point.** `writeSidecar` (sync-core.mjs:342-354) is the only place that emits Plan 05 agent artifacts. It calls `emitAgentArtifacts` for schema → snapshot → data-twin → tasks-index, then writes the legacy sidecarJs/sidecarJson. Watcher (watch-ralph-state.mjs:135-148) only iterates `result.activityEvents` and calls appendActivity. Job CLAUDE.md enshrines this rule; do not import emitters from the watcher.
- **`mergeAndWrite` signature is frozen.** `({ repoRoot, config, currentState, updates, generatedFromCommit })` -> `{ state, writtenAt, changedTaskIds, activityEvents }`. Plan 05 added `activityEvents` to the return value only; no new arguments. `deriveActivityEvents` (sync-core.mjs:281-310) is the in-merge diff helper.
- **Config keys are scalar paths + one integer.** All seven new keys live under `outputs.*` as siblings of `sidecarJs`/`sidecarJson`. `resolveConfigPaths` (resolve-config.mjs:76-121) is the choke point. Anyone adding a new output key must touch all five config files: `default-config.mjs`, `default-config.d.mts`, `resolve-config.mjs`, `.ralph/overview-config.json`, `.ralph/overview-config.schema.json`, plus the assertion in `tools/overview-viewer/src/__tests__/config.test.ts`.

## Cross-cutting concerns flagged in this review

- **`ActivityEvent.kind` discriminator is missing across the implementation (F-001).** The plan's Snapshot section enumerates kind as a required field, but neither the TS interface (types.ts:185-193) nor the runtime emitter (sync-core.mjs:298-308) sets it. Any fix has to land in types.ts AND sync-core.mjs AND a new unit test simultaneously, otherwise tsc passes but downstream consumers crash.
- **One-shot vs watcher symmetry on activity events (F-002).** The watcher path (`flushPending` -> `mergeAndWrite` -> append) is correct. The one-shot path (`runOneShot` -> `walkRalphState` + `writeSidecar`) skips `mergeAndWrite` entirely, so activity events never get derived for `pnpm sync-ralph-state`. The acceptance test currently locks the wrong contract (size==0). Plan F-011 says first-observation events from cold-start are optional but expected when a prior sidecar exists — that case is impossible with the current code path.
- **Plan 04 conditional inputs read the wrong shape (F-005).** sync-core.mjs:362-363 reads `plans/overview-recommendations.json` and assigns the raw value to `Snapshot.recommendations`. Plan 04 is still in design and the cascaded plan-04 edits mention `jq '.recommendations | length'` (wrapper shape). When Plan 04 ships, snapshot validation will silently break unless the read is shape-tolerant.

## Testing gaps to fix

- The scripts/lib/*.test.mjs suite (~600 LOC of new vitest tests, including end-to-end plan05-acceptance.test.mjs) is not connected to any test runner. tools/overview-viewer/vitest.config.ts excludes them; no root vitest config exists. `pnpm --filter @codexu/overview-viewer test` (the green-pass evidence in prd.json) does not exercise them.
- The `kind` discriminator (F-001) has no test coverage in either sync-core.test.mjs or emit-activity.test.mjs. Fixers should add coverage for all three kinds plus removed-task / first-observed edge cases.

## Files most relevant to the open findings

- `scripts/lib/sync-core.mjs:276-325` — mergeAndWrite + deriveActivityEvents + activitySlug.
- `scripts/lib/sync-core.mjs:342-376` — writeSidecar + emitAgentArtifacts + ensureActivityFile.
- `scripts/lib/emit-activity.mjs:36-44` — rotateActivity (best-effort fix needed).
- `scripts/sync-ralph-state.mjs:34-48` — runOneShot (must invoke mergeAndWrite for activity-event parity).
- `tools/overview-viewer/src/types.ts:185-193` — ActivityEvent interface (missing `kind`).
- `tools/overview-viewer/vitest.config.ts:10` — only covers src/__tests__; needs extension or root config.
- `scripts/lib/plan05-acceptance.test.mjs:37` — asserts size==0; revisit after F-002 fix.
- `scripts/lib/emit-snapshot-schema.mjs:213-220` — dead writeSnapshotSchema helper.
