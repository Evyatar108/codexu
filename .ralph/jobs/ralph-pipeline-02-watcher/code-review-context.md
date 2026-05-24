# Code Review Context — ralph-pipeline-02-watcher

Captured during Phase 6 code review (round 1).

## Codebase conventions observed

- **Sidecar emission contract** (`tools/overview-viewer/CLAUDE.md`): the `.js` wrapper is exactly `window.OVERVIEW_RALPH_STATE = <json>;` where `<json>` is the same payload as the `.json` sidecar after escaping `</script` as `<\/script`. `writeSidecar` in `scripts/lib/sync-core.mjs:267-277` correctly mirrors the existing `overview-data.js` pattern.
- **Atomic writes**: every sidecar write uses tmp-file + `fsyncSync` + rename-with-retry on `EBUSY/EACCES/EPERM` (sync-core.mjs:279-316). Plan 01 baseline; preserved through Plan 02.
- **Root-script imports under `moduleResolution: "bundler"`**: tests must have `.d.mts` siblings next to `.mjs` for `tsc --noEmit` to typecheck. This is enforced by the test-local ambient `tools/overview-viewer/src/__tests__/scripts.d.ts` which mirrors the root `.d.mts` declarations.
- **Cross-kind precedence**: `job > group > brainstorm`. Implemented identically in `resolveCrossKindPrecedence` (sync-core.mjs:252-255) for both full walk and incremental paths.
- **Glob-to-regexp helper**: appears in both `sync-core.mjs:593-601` and `watch-ralph-state.mjs:209-217` — duplication is intentional in this PR but worth extracting (F-008).

## Cross-cutting concerns

- **Lock-file contract crosses plans 02 / 06 / 08 / 11.** Plan 11's MCP tool `sync.watch_status` reads the JSON content; Plan 08 acquires the lock during crews cross-walk. Any change to the JSON shape or `processLabel` enum values is a downstream contract break, not a local style preference. See F-002.
- **Worktree isolation**: `config.watcher.ignored` already excludes `.worktrees/**`, `**/.git/**`, `.ralph/jobs/*/worktree/**`. The watcher consumes this list verbatim via `matchesIgnored` (watch-ralph-state.mjs:204-207) — do not hardcode a subset.
- **Plan-vs-PRD divergence on `status()` shape**: plan.md AC #2 explicitly enumerates `{ running, pendingSlugs, queueDepth, lastTickAt }`. PRD US-003 ACs were softened during implementation to match what the agent built. The downstream Plan 11 expectation still anchors to the plan version. See F-005.

## Files most relevant to follow-up fixes

- `scripts/lib/watch-ralph-state.mjs` — owns retain handling, startup ordering, parseWatchedPath, status shape.
- `scripts/lib/sync-core.mjs:138-250` — deriveAffectedTaskUpdate + mergeAndWrite; the per-slug-incremental contract lives here.
- `scripts/sync-ralph-state.mjs:33-47` — one-shot path lock acquisition.
- `tools/overview-viewer/vite.config.ts:100-131` — auto-start path; tolerates lock contention correctly.
- `tools/overview-viewer/src/__tests__/ralphWatcher.test.ts` — adding regression tests for F-001 (parse-error unmatched refresh) and F-003 (brainstorm unlinkDir) lands here.

## Test coverage gaps observed

- No test asserts that after a malformed `job-state.json` change, `sidecar.unmatched` contains the `parse-error` entry for that slug (only the per-slug `consecutiveFailures` counter is asserted). Drives F-001.
- No test for `unlinkDir` on `.ralph/brainstorms/<slug>` (only `.ralph/jobs/<slug>` is exercised in 'removes a task when all bundle files for the deleted job disappear'). Drives F-003.
- No test exercises the race between chokidar 'ready' resolving and `currentState` assignment (the cold-start gap). Drives F-004.

## Documentation staleness (informational only — handled by docs-reviewer)

- `tools/overview-viewer/CLAUDE.md` was updated as part of US-007 to mention the watcher auto-start and lock-contention tolerance. No stale references observed in this PR's diff.
- Plans 03 / 06 / 08 / 11 / 12 and INDEX were cascaded by US-007 (commit b4e98fcc). Plans 04 / 05 / 07 / 09 / 10 were audited and left unchanged per US-007 verifiedEvidence — no Plan-02-facing references diverged.
