# PRD: Continuous Ralph-State Watcher (Plan 02)

## Introduction/Overview

Plan 01 shipped a one-shot `pnpm sync-ralph-state` that the user runs by hand. For a usable daily-dev flow the sidecar must follow `.ralph/` changes in real time: when `ralph.sh` writes a new `job-state.json`, the overview-viewer dashboard refreshes within seconds without the user running anything.

This feature adds a continuous chokidar-based watcher with a debounce window and per-slug incremental re-derivation that preserves cross-kind precedence (`job > group > brainstorm`). It also adds an opt-in Vite plugin auto-start, so a developer running `pnpm overview` keeps the sidecar fresh in a single terminal.

User-stated requirement (verbatim, 2026-05-18):
> "I want an automatic state watcher that will sync the data when the ralph files change, it should probably have a delay period and it should then process the tasks that changed"

This is the implementation of Plan 02 from `plans/ralph-pipeline-02-*.md`. The full plan is at `.ralph/jobs/ralph-pipeline-02-watcher/plan.md` and the stories outline at `.ralph/jobs/ralph-pipeline-02-watcher/stories-outline.md`. Both files were validated by `/plan-with-ralph --improve` Phase 4 review (1 High + 12 Medium findings open and carried forward as story notes).

## Goals

- Reflect `.ralph/` filesystem changes in `plans/overview-ralph-state.{js,json}` within `debounceMs + ~200ms` (default 2000 ms debounce).
- Preserve cross-kind precedence (`job > group > brainstorm`) on every incremental update, including on deletions that should promote a shadowed bundle.
- Run as either a standalone CLI (`pnpm sync-ralph-state:watch`) or auto-start from the Vite dev server (`pnpm overview`).
- Share a single lock-file primitive between watch and one-shot modes; one-shot fails fast when a watcher holds the lock; lock JSON metadata is consumed by Plans 06 / 08 / 11.
- Keep `pnpm --filter @codexu/overview-viewer typecheck` green; keep Plan 01's verification suite passing unchanged.

## User Stories

### US-001: Refactor sync-core to expose per-slug primitives

**Description:** As the watcher author, I want `scripts/lib/sync-core.mjs` to expose per-slug primitives so that incremental updates preserve cross-kind precedence and `unmatched` / `unmatchedSummary` fidelity.

**Acceptance Criteria:**
- [ ] Internal helpers `readBundleForSlug({ repoRoot, config, kind, slug })` and `assembleStateFromBundles(bundles)` exist; `walkRalphState` is refactored to use them with behavior preserved (Plan 01 tests pass unchanged).
- [ ] New exports `deriveAffectedTaskUpdate` and `mergeAndWrite` are present with the discriminated-union signature documented in the plan's Architecture section (action: upsert | remove | retain; touched + unmatchedFragment carried).
- [ ] `mergeAndWrite` refreshes `unmatched` + `unmatchedSummary` via drop-by-touched + append-unmatchedFragment + re-sort + re-summarize.
- [ ] `scripts/lib/sync-core.d.mts` declares the new exports.
- [ ] `pnpm --filter @codexu/overview-viewer typecheck` passes.
- [ ] `pnpm --filter @codexu/overview-viewer test` passes (Plan 01 baseline + any new unit cases land in this story).
- [ ] Typecheck passes.

**Notes (carried from plan review):**
- F-009 [Medium]: `tools/overview-viewer/src/__tests__/scripts.d.ts` declares sync-core exports separately. Add it to Files to Modify (or document if tests route through the existing barrel) and add coverage so that both `scripts/lib/sync-core.d.mts` and the test-local declaration expose the new exports after US-001 lands.
- F-012 [Medium]: Mention `assembleStateFromBundles(bundles)` as the shared internal primitive; full walk and incremental recompute both produce state fragments through it; `mergeAndWrite` composes fragments + writes. Avoids drift between the two code paths.

### US-002: Implement shared sync-lock helper

**Description:** As the watcher and one-shot CLI, I want a single `scripts/lib/sync-lock.mjs` module so that lock-file metadata, fresh/stale semantics, and PID-liveness gating are not duplicated and never drift.

**Acceptance Criteria:**
- [ ] `scripts/lib/sync-lock.mjs` exports `acquireLock({ lockPath, processLabel, staleAfterMs })`, `releaseLock(handle)`, `touchLock(handle)`; `LockHandle` exposes `release()` (ENOENT-tolerant unlink) and `touch()` (ENOENT-tolerant `fs.utimes`).
- [ ] Acquire writes JSON `{ pid, process, startedAt }` with flag `'wx'`.
- [ ] On `EEXIST` with mtime age `< staleAfterMs`: throws `Error("another sync in progress (pid <N>, process <label>, started <ts>)")` with the JSON parsed from disk.
- [ ] On `EEXIST` with mtime age `>= staleAfterMs`: runs `process.kill(parsedPid, 0)` — `ESRCH`/unparseable JSON ⇒ overwrite + `stale lock removed (mtime <ms> ms, pid <N> not alive)` warning; alive/`EPERM` ⇒ throw the canonical fresh-lock diagnostic.
- [ ] `scripts/lib/sync-lock.d.mts` declares the matching types.
- [ ] Vitest fake-timer unit tests cover: acquire on missing file, fast-fail on fresh lock with diagnostic match, ESRCH stale-overwrite path, EPERM-alive path, touch refresh, release ENOENT tolerance.
- [ ] Typecheck passes.

### US-003: Implement `scripts/lib/watch-ralph-state.mjs`

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

**Notes (carried from plan review):**
- F-006 [High]: Implementation Strategy step 3 names `config.ralphRoot/jobs`, `/job-groups`, `/brainstorms` directly. Resolve these through `config.ralphSubdirs.jobs` / `.jobGroups` / `.brainstorms` (joined under `config.ralphRoot`) so user overrides via `resolve-config.mjs` are honored. Must fix before merging this story.
- F-007 [Medium]: `start()` should resolve HEAD internally (reusing the helper today in `sync-ralph-state.mjs`) so CLI and Vite plugin do not need to plumb `generatedFromCommit`.
- F-010 [Medium]: Pick one explicit startup strategy: (A) subscribe-then-cold-start (chokidar `ignoreInitial:true`, buffer events, then cold-start, then process), or (B) cold-start-then-subscribe-then-rescan (enqueue all slugs into `pendingChanges` after subscribe). Document the choice on this story. The "exactly one cold-start write" AC means: exactly one cold-start write at startup; any writes that occurred during cold-start are reconciled by the first debounce tick.

**Dependencies:** US-001, US-002

### US-004: Wire CLI — one-shot lock + `--watch` flag

**Description:** As a CLI user, I want `pnpm sync-ralph-state` to fail fast against a running watcher, and `pnpm sync-ralph-state:watch` to spawn the watcher with debounce control.

**Acceptance Criteria:**
- [ ] One-shot path in `scripts/sync-ralph-state.mjs` calls `acquireLock` BEFORE `walkRalphState`; releases in `finally`. On contention exits non-zero with the canonical diagnostic message; no partial sidecar write.
- [ ] `--watch` flag triggers `start({ ...args, processLabel: 'standalone' })` and blocks via `process.stdin.resume()`; SIGINT/SIGTERM cleanly call `handle.stop()` then exit 0.
- [ ] `--debounce-ms <N>` clamps to `[500, 30000]`; invalid input rejected with a clear error.
- [ ] `pnpm sync-ralph-state:watch` script added to root `package.json`.
- [ ] `chokidar` added to root `devDependencies`; `pnpm-lock.yaml` committed; `pnpm install --frozen-lockfile` succeeds from a clean checkout.
- [ ] Integration test: one-shot against a running watcher exits with the diagnostic message format.
- [ ] Typecheck passes.

**Notes (carried from plan review):**
- F-015 [Medium]: Install `chokidar` and commit `pnpm-lock.yaml` BEFORE creating/importing `watch-ralph-state.mjs` so no intermediate commit imports a missing dependency. In practice that means the `pnpm install -D chokidar` commit lands first in this story.

**Dependencies:** US-002, US-003

### US-005: Vite plugin auto-start

**Description:** As a developer running `pnpm overview`, I want the watcher to spawn inside the Vite dev server so I don't have to remember to run `pnpm sync-ralph-state:watch` separately.

**Acceptance Criteria:**
- [ ] `tools/overview-viewer/vite.config.ts` `configureServer` dynamic-imports `scripts/lib/watch-ralph-state.mjs` and calls `start({ ..., processLabel: 'vite-plugin' })`.
- [ ] On lock contention (`another watcher holds lock`), the plugin logs a warning via `server.config.logger.warn` and continues serving the app (does NOT crash `pnpm overview`).
- [ ] `server.httpServer?.on('close', ...)` calls `handle.stop().catch(() => {})`.
- [ ] `onWrite` fires `server.ws.send({ type: 'custom', event: 'overview-ralph-state:update' })` exactly once per debounced write.
- [ ] `pnpm --filter @codexu/overview-viewer typecheck` passes (the new `.d.mts` makes the dynamic import type-safe).
- [ ] Manual verification (Test E + Test F in plan).
- [ ] Typecheck passes.

**Notes (carried from plan review):**
- F-008 [Medium]: Wrap `await watcher.start(...)` in a `try/catch`; on "another watcher holds lock", log a warning via `server.config.logger.warn` and continue serving the app. `pnpm overview` must not crash when a standalone watcher already runs.

**Dependencies:** US-003

### US-006: Watcher integration test suite

**Description:** As a future maintainer, I want the watcher behaviors covered by automated tests so regressions are caught without manual `pnpm overview` driving.

**Acceptance Criteria:**
- [ ] `tools/overview-viewer/src/__tests__/ralphWatcher.test.ts` exists under the `ssr` Vitest project (Node env).
- [ ] Tests A–H from the plan's Verification section have automated counterparts (or are explicitly tagged as manual-only with a why-not-automated note).
- [ ] Fake-timer tests cover debounce coalescing, fresh-lock diagnostic message format, stale-lock heartbeat refresh (Test G2), PID-liveness gate (Test G3), malformed-JSON counter, cross-kind promotion.
- [ ] All tests pass under `pnpm --filter @codexu/overview-viewer test`.
- [ ] Typecheck passes.

**Verification mapping (from plan §Acceptance Criteria → Verification):**
- Test A (Cold-start walk), Test B (Debounce coalescing), Test C (Incremental equals full walk), Test D (Lock contention), Test E (Vite auto-start — manual + WS-frame assertion), Test F (Concurrent-watcher rejection), Test G (Error resilience + recovery counter), Test G2 (Heartbeat keeps healthy watcher's lock fresh), Test G3 (PID-liveness gates overwrite), Test H (Deletion / promotion), Test I (Worktree isolation), Test K (selected-direction.md no-op — spy on `onWrite` + `pendingChanges`).

**Notes (carried from plan review):**
- F-011 [Medium]: Plan suggested splitting US-006 into US-006a (core merge + watcher unit tests, lands with US-001/US-003) and US-006b (CLI + Vite integration tests, lands with US-004/US-005). This PRD keeps US-006 as a single story for simplicity; if the implementer chooses to split, both halves must land before US-007. Record the choice in `notepad.md`.
- F-013 [Medium]: Closed as duplicate by AC #4 of the plan + Test C as rewritten; implementer may verify and close without separate action.
- F-014 [Medium]: Explicit Test K — touching `.ralph/brainstorms/<slug>/selected-direction.md` does NOT enqueue a pending change, does NOT call `deriveAffectedTaskUpdate`, and does NOT fire `onWrite`. Spy on `onWrite` + `pendingChanges` to verify.
- F-017 [Medium]: Vitest fake-timer tests cover debounce coalescing (Test B), lock contention diagnostic format (Test D), stale-lock recovery via heartbeat (Test G2), malformed-JSON failure counter (Test G), and cross-kind promotion (Test H part 3). Run under the `ssr` Vitest project (Node env).

**Dependencies:** US-003, US-004, US-005

### US-007: Downstream cascade audit

**Description:** As the consumer of Plans 03–12, I want any references to Plan 02's contracts (lock-file format, sidecar event name, `deriveAffectedTaskUpdate` API, watched-path conventions) refreshed in those plans + INDEX so future implementers don't follow stale guidance.

**Acceptance Criteria:**
- [ ] Audit `plans/ralph-pipeline-INDEX.md` and `plans/ralph-pipeline-{03..12}-*.md`; identify any Plan-02-facing reference that diverges from what shipped.
- [ ] Apply edits in the FINAL commit on the worktree branch (no earlier story commit touches these files).
- [ ] Commit message lists each diff (file + line range + what changed) so reviewers can verify.
- [ ] `git log -1 --stat` on that final commit shows the cascade edits.

**Notes (carried from plan review):**
- F-018 [Medium]: The downstream cascade MUST land as the final commit on the worktree branch; earlier story commits MUST NOT touch `plans/ralph-pipeline-{INDEX,03..12}*.md`. Update Test J wording accordingly. Files to audit: `plans/ralph-pipeline-INDEX.md`, `plans/ralph-pipeline-03-ui-chip.md`, `plans/ralph-pipeline-04-pipeline-overview.md`, `plans/ralph-pipeline-05-agent-exports.md`, `plans/ralph-pipeline-06-skills.md`, `plans/ralph-pipeline-07-context.md`, `plans/ralph-pipeline-08-crews.md`, `plans/ralph-pipeline-09-mcp.md`, `plans/ralph-pipeline-10-ralph-handoff.md`, `plans/ralph-pipeline-11-mcp-operational-tools.md`, `plans/ralph-pipeline-12-package-as-plugin.md`.

**Dependencies:** US-001, US-002, US-003, US-004, US-005, US-006

## Functional Requirements

- FR-1: `scripts/lib/sync-core.mjs` MUST expose `deriveAffectedTaskUpdate({ repoRoot, config, generatedFromCommit, slug, kind })` and `mergeAndWrite({ repoRoot, config, currentState, taskUpdates })` in addition to all Plan 01 exports.
- FR-2: `scripts/lib/sync-core.mjs` MUST refactor `walkRalphState` to delegate to internal helpers `readBundleForSlug` and `assembleStateFromBundles` without changing observable behavior.
- FR-3: `scripts/lib/sync-lock.mjs` MUST expose `acquireLock`, `releaseLock`, `touchLock`. Both watcher and one-shot CLI MUST consume this module; neither MUST inline `fs.writeFileSync(lockPath, ...)`.
- FR-4: Lock acquisition MUST write JSON `{ pid, process, startedAt }` with `flag: 'wx'`. The `process` field MUST be one of `'standalone' | 'standalone-oneshot' | 'vite-plugin'`.
- FR-5: On `EEXIST` with lock mtime age `< staleAfterMs` (default 60 000 ms): MUST throw `Error("another sync in progress (pid <N>, process <label>, started <ts>)")` parsed from disk.
- FR-6: On `EEXIST` with lock mtime age `≥ staleAfterMs`: MUST run `process.kill(parsedPid, 0)`. `ESRCH` or unparseable JSON ⇒ overwrite the lock and log `stale lock removed (mtime <ms> ms, pid <N> not alive)` to stderr. Alive (no throw) or `EPERM` ⇒ throw the canonical fresh-lock diagnostic.
- FR-7: `scripts/lib/watch-ralph-state.mjs` MUST expose `async start({ repoRoot, configPath?, debounceMs?, processLabel, onWrite?, onError? }) → Promise<WatchHandle>` where `WatchHandle = { stop, status }`.
- FR-8: `start()` MUST resolve only after cold-start (`walkRalphState` + `writeSidecar`) AND chokidar subscription are both ready.
- FR-9: Watcher MUST schedule a 30 s `.unref()`-ed heartbeat that calls `handle.touch()`; the interval MUST be cleared in `stop()` before `releaseLock`.
- FR-10: `chokidar.watch` MUST receive resolved directory paths (`config.ralphRoot` joined with `config.ralphSubdirs.{jobs, jobGroups, brainstorms}`) — NOT glob patterns. Ignore list MUST come from `config.watcher.ignored`. Options MUST include `awaitWriteFinish: { stabilityThreshold: 200, pollInterval: 50 }` and `ignoreInitial: true`.
- FR-11: Debounce default MUST be 2000 ms. The path-to-slug parser MUST accept both backslash and forward-slash separators. Files outside the watched contract (notably `.ralph/brainstorms/<slug>/selected-direction.md`) MUST be dropped silently — they MUST NOT enqueue a pending change, MUST NOT call `deriveAffectedTaskUpdate`, and MUST NOT fire `onWrite`.
- FR-12: On debounce fire, the watcher MUST call `deriveAffectedTaskUpdate` for each pending `(kind, slug)`, collect `TaskUpdate[]`, pass them all to `mergeAndWrite`, update `currentState`, and call `onWrite({ writtenAt, changedTaskIds })` with the union of upsert+remove taskIds (retain MUST NOT count as a change).
- FR-13: `mergeAndWrite` MUST refresh `unmatched` and `unmatchedSummary` so that after any incremental write they are structurally equal (set-equal entries; identical summary keys/counts) to what a full `walkRalphState` would produce on the same on-disk state.
- FR-14: On `retain` result, the watcher MUST log to stderr (slug + error.message), increment `consecutiveFailures` for that slug, and emit a single `watcher: <slug> failing repeatedly` warning at 10. The counter MUST reset on the next non-retain result for that slug.
- FR-15: `scripts/sync-ralph-state.mjs` one-shot path MUST call `acquireLock({ processLabel: 'standalone-oneshot' })` BEFORE `walkRalphState` and `releaseLock` in `finally`. On contention the process MUST exit non-zero with the canonical diagnostic and MUST NOT have written a partial sidecar.
- FR-16: `scripts/sync-ralph-state.mjs` MUST accept `--watch` and `--debounce-ms <N>` (clamp `[500, 30000]`). When `--watch` is set, the CLI MUST delegate to `start({ ..., processLabel: 'standalone' })` and block via `process.stdin.resume()`, with SIGINT/SIGTERM handlers that call `handle.stop()` then `process.exit(0)`.
- FR-17: Root `package.json` MUST gain `"sync-ralph-state:watch": "node scripts/sync-ralph-state.mjs --watch"` and `chokidar` in `devDependencies` (pinned to the existing transitive 5.x). `pnpm-lock.yaml` MUST be updated in the same commit and MUST pass `pnpm install --frozen-lockfile`.
- FR-18: `tools/overview-viewer/vite.config.ts` `configureServer` MUST dynamic-import `scripts/lib/watch-ralph-state.mjs` and call `start({ processLabel: 'vite-plugin', onWrite, onError })`. On lock contention it MUST log a `server.config.logger.warn` and continue serving (NOT crash). `server.httpServer?.on('close', ...)` MUST call `handle.stop().catch(() => {})`. `onWrite` MUST fire `server.ws.send({ type: 'custom', event: 'overview-ralph-state:update' })` exactly once per debounced write.
- FR-19: New type declarations `scripts/lib/sync-lock.d.mts`, `scripts/lib/watch-ralph-state.d.mts` and updates to `scripts/lib/sync-core.d.mts` MUST keep `pnpm --filter @codexu/overview-viewer typecheck` green.
- FR-20: `tools/overview-viewer/src/__tests__/ralphWatcher.test.ts` MUST run under the `ssr` Vitest project (Node env) and cover Tests A–K from the plan's Verification section (or tag as manual-only with rationale).
- FR-21: The final commit on the worktree branch MUST refresh `plans/ralph-pipeline-INDEX.md` and `plans/ralph-pipeline-{03..12}-*.md` for any Plan-02-facing references that diverge from what shipped. No earlier story commit MUST touch those files.

## Non-Goals (Out of Scope)

- `.crews/` cross-walk and `CrewSessionRef` updates — covered by Plan 08.
- Aggregated snapshot, activity tail, or additional emitted artifacts — covered by Plan 05.
- UI subscription to sidecar updates via HMR events — covered by Plan 03. Plan 02 only emits the WebSocket event.
- A general dependency-graph scheduler / task ordering — not part of this product. Plan 04 visualizes histograms.
- Watching `.ralph/brainstorms/*/selected-direction.md` — `sync-core` does not read it; brainstorm state derives from `brainstorm.json`.
- Fixing the long-standing parse-error asymmetry for `group.json` in `sync-core` — tracked in Open Questions; not required by this plan.
- A `config.watcher.debounceMs` configuration knob — only CLI flag + hardcoded default in this plan; Plan 11 / MCP tooling can add a config-driven default later.

## Design Considerations

- Reuse the existing `atomicWriteFile` + `renameWithRetry` pattern in `scripts/lib/sync-core.mjs` for the sidecar write — do NOT introduce a new write primitive.
- Mirror the WebSocket event-name convention used today by `overviewDataPlugin` (`overview-data:update`) — the new event is `overview-ralph-state:update`. The UI HMR plumbing in `tools/overview-viewer/CLAUDE.md` already documents the pattern.

## Technical Considerations

- chokidar 5.x is present transitively but MUST be made an explicit `devDependency`. v4+ removes glob inputs — watch resolved directories and filter event paths in code.
- Windows fs.watch quirks require `awaitWriteFinish` to coalesce Ralph's tmp+rename writes; without it the watcher sees torn reads.
- Lock-file contract crosses plans: Plan 06 reads it to assess data freshness, Plan 08 acquires it during crews cross-walk, Plan 11's `sync.watch_status` reads its JSON content. The JSON metadata format MUST be respected.
- Worktree isolation: walk root is exactly `<repoRoot>/<config.ralphRoot>/`. Ignore list excludes `.worktrees/**`, `**/.git/**`, `.ralph/jobs/*/worktree/**`, `.ralph/jobs/.staging/**`, `.ralph/telemetry/**`, `.crews/logs/**`, `.crews/spawn-launchers/**` so per-worktree `.ralph/` copies do not leak.
- `tools/overview-viewer/vite.config.ts` is TypeScript-checked; the dynamic `await import('../../scripts/lib/watch-ralph-state.mjs')` needs a sibling `.d.mts` to keep `pnpm --filter @codexu/overview-viewer typecheck` green.
- Reference files (read, do not modify in this plan's scope): `scripts/lib/derive-ralph-stage.mjs`, `scripts/lib/default-config.mjs`, `scripts/lib/resolve-config.mjs`, `tools/overview-viewer/src/types.ts`, `tools/overview-viewer/CLAUDE.md`, `tools/overview-viewer/vitest.config.ts`, `.ralph/overview-config.json`, `.ralph/overview-config.schema.json`.

## Success Metrics

- `pnpm sync-ralph-state:watch` cold-start to first sidecar write completes within ~2 s on a typical laptop checkout.
- Three `touch` calls within 1 s on the same `(kind, slug)` produce exactly one sidecar write ~2 s later.
- Running watcher + one-shot CLI contention surfaces within ~1 s with the canonical diagnostic; no partial sidecar.
- `pnpm install --frozen-lockfile` continues to succeed on a clean checkout after `chokidar` is added as an explicit devDependency.
- Plan 01 verification suite continues to pass with zero new failures after US-001 refactor.

## Open Questions / Assumptions

1. **[INFERRED]** Should the watcher fix `sync-core`'s `group.json` parse-error asymmetry? Assumed answer: NO — out of scope; document and defer.
2. **[INFERRED]** Should `mergeAndWrite` accept optional emitter hooks now (for Plan 05) or stay minimal? Assumed answer: keep minimal in this plan. Plan 05 will extend the signature.
3. **[INFERRED]** Resolved chokidar version: pin to whatever `pnpm why chokidar` reports today (currently 5.x). If a newer major lands during implementation, defer the upgrade to a follow-up.
4. **[INFERRED]** Watcher debounce config in `config.watcher.debounceMs`? NOT implemented in this plan; only CLI flag + hardcoded default.
5. **[Autonomous-mode PRD assumption]** US-006 is kept as a single story rather than the F-011 split into US-006a/US-006b. If the implementer chooses to split, both halves MUST land before US-007. Record the choice in `notepad.md`.
6. **[Autonomous-mode PRD assumption]** The iteration engine is `codex` (orchestrator default); `--iteration-engine` was not passed.
7. **F-006 [High, carried]** Resolve `config.ralphSubdirs.{jobs,jobGroups,brainstorms}` in US-003 — must fix before merging that story.
8. **F-007 [Medium, carried]** `start()` resolves HEAD internally for `generatedFromCommit`.
9. **F-008 [Medium, carried]** Vite plugin lock-collision must log+continue, not crash.
10. **F-009 [Medium, carried]** Test-local `scripts.d.ts` declarations may also need the new exports.
11. **F-010 [Medium, carried]** Implementer must pick and document a startup ordering strategy on US-003.
12. **F-011 [Medium, carried]** US-006 split into US-006a/US-006b is optional; this PRD keeps the single story.
13. **F-012 [Medium, carried]** `assembleStateFromBundles` is the shared internal primitive.
14. **F-013 [Medium, carried]** Subsumed by AC #4 + Test C; close as duplicate during US-006.
15. **F-014 [Medium, carried]** `selected-direction.md` Test K spies on `onWrite` + `pendingChanges`.
16. **F-015 [Medium, carried]** Install chokidar + commit `pnpm-lock.yaml` BEFORE creating `watch-ralph-state.mjs` — applies to US-004's commit ordering.
17. **F-016 [Medium, carried]** Already addressed by `scripts/lib/sync-lock.mjs`; close during US-002.
18. **F-017 [Medium, carried]** Vitest fake-timer coverage list documented on US-006.
19. **F-018 [Medium, carried]** Cascade lands as the final commit on the worktree branch; earlier story commits must not touch the plan files.
