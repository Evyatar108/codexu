# Stories Outline: Continuous Ralph-State Watcher (Plan 02)

*Preliminary decomposition from `/plan-with-ralph --improve`. Feed to `/implement-with-ralph --from-plan` for PRD generation.*

## US-001: Refactor sync-core to support per-slug derivation
**Description:** As the watcher author, I want `scripts/lib/sync-core.mjs` to expose per-slug primitives so that incremental updates preserve cross-kind precedence and `unmatched`/`unmatchedSummary` fidelity.
**Acceptance Criteria:**
- [ ] Internal helpers `readBundleForSlug({ repoRoot, config, kind, slug })` and `assembleStateFromBundles(bundles)` exist; `walkRalphState` is refactored to use them with behavior preserved (Plan 01 tests pass unchanged).
- [ ] New exports `deriveAffectedTaskUpdate` and `mergeAndWrite` are present with the discriminated-union signature documented in the plan's Architecture section (action: upsert | remove | retain; touched + unmatchedFragment carried).
- [ ] `mergeAndWrite` refreshes `unmatched` + `unmatchedSummary` via drop-by-touched + append-unmatchedFragment + re-sort + re-summarize.
- [ ] `scripts/lib/sync-core.d.mts` declares the new exports.
- [ ] `pnpm --filter @codexu/overview-viewer typecheck` passes.
- [ ] `pnpm --filter @codexu/overview-viewer test` passes (Plan 01 baseline + any new unit cases land in this story).
- [ ] Typecheck passes.
**Dependencies:** None
**Estimated complexity:** large

## US-002: Implement shared sync-lock helper
**Description:** As the watcher and one-shot CLI, I want a single `scripts/lib/sync-lock.mjs` module so that lock-file metadata, fresh/stale semantics, and PID-liveness gating are not duplicated and never drift.
**Acceptance Criteria:**
- [ ] `scripts/lib/sync-lock.mjs` exports `acquireLock({ lockPath, processLabel, staleAfterMs })`, `releaseLock(handle)`, `touchLock(handle)`; `LockHandle` exposes `release()` (ENOENT-tolerant unlink) and `touch()` (ENOENT-tolerant `fs.utimes`).
- [ ] Acquire writes JSON `{ pid, process, startedAt }` with flag `'wx'`.
- [ ] On `EEXIST` with mtime age `< staleAfterMs`: throws `Error("another sync in progress (pid <N>, process <label>, started <ts>)")` with the JSON parsed from disk.
- [ ] On `EEXIST` with mtime age `>= staleAfterMs`: runs `process.kill(parsedPid, 0)` — `ESRCH`/unparseable JSON ⇒ overwrite + `stale lock removed (mtime <ms> ms, pid <N> not alive)` warning; alive/`EPERM` ⇒ throw the canonical fresh-lock diagnostic.
- [ ] `scripts/lib/sync-lock.d.mts` declares the matching types.
- [ ] Vitest fake-timer unit tests cover: acquire on missing file, fast-fail on fresh lock with diagnostic match, ESRCH stale-overwrite path, EPERM-alive path, touch refresh, release ENOENT tolerance.
- [ ] Typecheck passes.
**Dependencies:** None
**Estimated complexity:** medium

## US-003: Implement `scripts/lib/watch-ralph-state.mjs`
**Description:** As a developer running `pnpm overview`, I want a watcher that keeps `plans/overview-ralph-state.{js,json}` in sync with `.ralph/` so the dashboard updates without me running anything.
**Acceptance Criteria:**
- [ ] Exports `async start({ repoRoot, configPath?, debounceMs?, processLabel, onWrite?, onError? }) → Promise<{ stop, status }>`; `start()` is async and resolves only after cold-start + chokidar subscription are both ready.
- [ ] Uses `acquireLock`/`releaseLock` from `scripts/lib/sync-lock.mjs` (does NOT inline `fs.writeFileSync` for the lock).
- [ ] Schedules a 30 s `.unref()`-ed heartbeat via `handle.touch()`; cleared in `stop()` before `releaseLock`.
- [ ] Cold-start runs `walkRalphState` once then `writeSidecar`; stores `currentState` in memory.
- [ ] chokidar.watch resolves directory roots via `config.ralphRoot` joined with `config.ralphSubdirs.{jobs,jobGroups,brainstorms}` — NOT hardcoded subdir names (see F-006 in Open Questions); uses `config.watcher.ignored`, `awaitWriteFinish: { stabilityThreshold: 200, pollInterval: 50 }`, `ignoreInitial: true`.
- [ ] Path-to-slug parser handles Windows + POSIX separators; non-watched files are dropped silently.
- [ ] Debounce default 2000 ms; processes pending `(kind, slug)` set on fire; passes `TaskUpdate[]` to `mergeAndWrite`; calls `onWrite({ writtenAt, changedTaskIds })`.
- [ ] On `retain` result, increments `consecutiveFailures` per slug, logs to stderr; emits single `watcher: <slug> failing repeatedly` warning at 10; resets on next non-retain.
- [ ] `stop()` closes chokidar, clears timers, releases lock in `finally`.
- [ ] Touching `.ralph/brainstorms/<slug>/selected-direction.md` does not enqueue or fire `onWrite`.
- [ ] `scripts/lib/watch-ralph-state.d.mts` declares the module.
- [ ] Watcher unit tests in `tools/overview-viewer/src/__tests__/ralphWatcher.test.ts` cover: debounce coalescing, cold-start runs once, lock-collision rejection, malformed-JSON retain + counter, deletion-only-job-state → plan-ready re-derivation, cross-kind promotion on job delete, worktree-isolation ignore, `selected-direction.md` no-op.
- [ ] Typecheck passes.
**Dependencies:** US-001, US-002
**Estimated complexity:** large

## US-004: Wire CLI — one-shot lock + `--watch` flag
**Description:** As a CLI user, I want `pnpm sync-ralph-state` to fail fast against a running watcher, and `pnpm sync-ralph-state:watch` to spawn the watcher with debounce control.
**Acceptance Criteria:**
- [ ] One-shot path in `scripts/sync-ralph-state.mjs` calls `acquireLock` BEFORE `walkRalphState`; releases in `finally`. On contention exits non-zero with the canonical diagnostic message; no partial sidecar write.
- [ ] `--watch` flag triggers `start({ ...args, processLabel: 'standalone' })` and blocks via `process.stdin.resume()`; SIGINT/SIGTERM cleanly call `handle.stop()` then exit 0.
- [ ] `--debounce-ms <N>` clamps to `[500, 30000]`; invalid input rejected with a clear error.
- [ ] `pnpm sync-ralph-state:watch` script added to root `package.json`.
- [ ] `chokidar` added to root `devDependencies`; `pnpm-lock.yaml` committed; `pnpm install --frozen-lockfile` succeeds from a clean checkout.
- [ ] Integration test: one-shot against a running watcher exits with the diagnostic message format.
- [ ] Typecheck passes.
**Dependencies:** US-002, US-003
**Estimated complexity:** medium

## US-005: Vite plugin auto-start
**Description:** As a developer running `pnpm overview`, I want the watcher to spawn inside the Vite dev server so I don't have to remember to run `pnpm sync-ralph-state:watch` separately.
**Acceptance Criteria:**
- [ ] `tools/overview-viewer/vite.config.ts` `configureServer` dynamic-imports `scripts/lib/watch-ralph-state.mjs` and calls `start({ ..., processLabel: 'vite-plugin' })`.
- [ ] On lock contention (`another watcher holds lock`), the plugin logs a warning via `server.config.logger.warn` and continues serving the app (does NOT crash `pnpm overview`).
- [ ] `server.httpServer?.on('close', ...)` calls `handle.stop().catch(() => {})`.
- [ ] `onWrite` fires `server.ws.send({ type: 'custom', event: 'overview-ralph-state:update' })` exactly once per debounced write.
- [ ] `pnpm --filter @codexu/overview-viewer typecheck` passes (the new `.d.mts` makes the dynamic import type-safe).
- [ ] Manual verification (Test E + Test F in plan).
- [ ] Typecheck passes.
**Dependencies:** US-003
**Estimated complexity:** medium

## US-006: Watcher integration test suite
**Description:** As a future maintainer, I want the watcher behaviors covered by automated tests so regressions are caught without manual `pnpm overview` driving.
**Acceptance Criteria:**
- [ ] `tools/overview-viewer/src/__tests__/ralphWatcher.test.ts` exists under the `ssr` Vitest project (Node env).
- [ ] Tests A–H from the plan's Verification section have automated counterparts (or are explicitly tagged as manual-only with a why-not-automated note).
- [ ] Fake-timer tests cover debounce coalescing, fresh-lock diagnostic message format, stale-lock heartbeat refresh (Test G2), PID-liveness gate (Test G3), malformed-JSON counter, cross-kind promotion.
- [ ] All tests pass under `pnpm --filter @codexu/overview-viewer test`.
- [ ] Typecheck passes.
**Dependencies:** US-003, US-004, US-005
**Estimated complexity:** large

## US-007: Downstream cascade audit
**Description:** As the consumer of Plans 03–12, I want any references to Plan 02's contracts (lock-file format, sidecar event name, `deriveAffectedTaskUpdate` API, watched-path conventions) refreshed in those plans + INDEX so future implementers don't follow stale guidance.
**Acceptance Criteria:**
- [ ] Audit `plans/ralph-pipeline-INDEX.md` and `plans/ralph-pipeline-{03..12}-*.md`; identify any Plan-02-facing reference that diverges from what shipped.
- [ ] Apply edits in the FINAL commit on the worktree branch (no earlier story commit touches these files).
- [ ] Commit message lists each diff (file + line range + what changed) so reviewers can verify.
- [ ] `git log -1 --stat` on that final commit shows the cascade edits.
**Dependencies:** US-001..US-006
**Estimated complexity:** medium
