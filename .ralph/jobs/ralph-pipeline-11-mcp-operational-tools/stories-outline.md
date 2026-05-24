# Stories Outline: MCP operational tools — dev server, sync, build subprocess control

*Preliminary decomposition from `/plan-with-ralph --improve`. Feed to `/implement-with-ralph --from-plan` for PRD generation.*

## US-001: ProcessManager foundation
**Description:** As an MCP server author, I want a single `ProcessManager` class that spawns, tracks, ring-buffers, and stops child processes, so each new operational tool can share one lifecycle implementation.
**Acceptance Criteria:**
- [ ] `tools/overview-mcp/src/process-manager.ts` exports a `ProcessManager` class with `spawn`, `stop`, `status`, `logs`, `stopAll`, plus `ManagedProcess.onReady` (checks both stdout and stderr ring buffers).
- [ ] `ProcessManager.spawn` registers the `ManagedProcess` record in its Map with `status='starting'` BEFORE calling `child_process.spawn`, closing the double-start race window.
- [ ] Each `ManagedProcess` carries a `readyPromise: Promise<{ url, pid, startedAt }>` that resolves when the first `onReady` callback fires; callers receiving `AlreadyRunning` await this promise before constructing their response.
- [ ] Transient single-flight names (`'build'`, `'sync-now'`) are tracked while running and auto-removed on `'exit'`; in-flight transients ARE included in `stopAll()`.
- [ ] Children spawn with `stdio: ['ignore', 'pipe', 'pipe']` and `{ shell: true }`; tests assert the parent's stdout stays clean (no JSON-RPC pollution).
- [ ] On Windows, `stop()` uses `tree-kill` for both SIGTERM and SIGKILL escalation, killing the whole child process tree rather than just the shell wrapper PID.
- [ ] Ring buffer is capped at 1000 lines per stream; CRLF is normalized to LF before splitting.
- [ ] `tools/overview-mcp/src/__tests__/process-manager.test.ts` covers: spawn → logs, onReady (stdout AND stderr), stop (graceful + SIGKILL escalation), stopAll on long-lived + transient mix, already-running guard, double-start race ordering, stop-while-starting, ring-buffer overflow drops oldest, CRLF normalization, stdio isolation.
- [ ] Typecheck passes for `@codexu/overview-mcp`.
- [ ] `pnpm --filter @codexu/overview-mcp test` passes.

**Dependencies:** None
**Estimated complexity:** large

## US-002: sync-lock helper exports
**Description:** As `sync-watch-status.ts` and the future MCP toolset, I want a single canonical `readLockStatus(lockPath)` helper exported from `scripts/lib/sync-lock.mjs` (plus its building blocks), so lock semantics never drift between watcher and MCP.
**Acceptance Criteria:**
- [ ] `scripts/lib/sync-lock.mjs` exports `parseLockMetadata(buffer)`, `isLockHolderAlive(pid)`, and `readLockStatus(lockPath, opts?)`.
- [ ] `readLockStatus` returns `{ state: 'missing' }` | `{ state: 'active', pid, process, startedAt, mtime: Date }` | `{ state: 'stale', pid?, process?, startedAt?, mtime?: Date }`. Unparseable JSON triggers one 50ms retry before classifying as stale.
- [ ] When mtime is older than `staleAfterMs` (default `DEFAULT_STALE_AFTER_MS = 60_000`) BUT `isLockHolderAlive(pid) === true`, the result is `'active'` (trust PID over mtime).
- [ ] `scripts/lib/sync-lock.d.mts` declares the new exports with the documented type shapes so TypeScript consumers (overview-mcp NodeNext resolution) typecheck cleanly.
- [ ] `scripts/lib/sync-lock.test.mjs` (or the equivalent existing test file location) covers each helper: parse success/failure, alive PID, dead PID, active mtime, stale mtime + dead PID, stale mtime + alive PID, missing file, unparseable + retry.
- [ ] No behavior change to existing `acquireLock` / `releaseLock` callers.
- [ ] Typecheck and tests pass for `@codexu/overview-mcp` (verifies the .d.mts edit).

**Dependencies:** None
**Estimated complexity:** medium

## US-003: sync-ralph-state stdout summary
**Description:** As `overview.sync.now`, I want `scripts/sync-ralph-state.mjs:runOneShot()` to print a parseable summary line on stdout, so the MCP tool can return a structured `{ tasksMatched, unmatchedCount, durationMs }` summary.
**Acceptance Criteria:**
- [ ] Inside `runOneShot()`, after the sidecar write but before lock release, a single line `sync: matched=<N>, unmatched=<N>, duration=<Nms>` is printed to stdout. All other diagnostics continue to go to stderr.
- [ ] The `matched` and `unmatched` counts are derived from the actual local state object (e.g. `Object.keys(state.byTaskId ?? {}).length` and `(state.unmatched ?? []).length`); the implementer reads `runOneShot` and binds the names that exist — does NOT assume.
- [ ] `startTime` is captured at the top of `runOneShot` (`const startTime = Date.now()`); `durationMs = Date.now() - startTime` at emission time.
- [ ] A unit test (in `tools/overview-mcp/src/__tests__/sync-now.test.ts`) spawns the real script with a tmp repo and asserts the stdout contains the parseable summary line.
- [ ] Existing watcher mode behavior is unchanged (the summary line is one-shot only).

**Dependencies:** None
**Estimated complexity:** small

## US-004: dev-server tools + MCP wiring
**Description:** As an agent using the MCP, I want `overview.dev_server.{start,stop,status,logs}` so I can drive the Vite dev server from MCP.
**Acceptance Criteria:**
- [ ] `tools/overview-mcp/src/context.ts` extends `ServerContext` with `processManager: ProcessManager`. `tools/overview-mcp/src/__tests__/helpers.ts` is updated to construct the manager in `makeContext()` and to accept an injectable override.
- [ ] `tools/overview-mcp/src/tools/dev-server-{start,stop,status,logs}.ts` register the 4 tools through `server.registerTool` following the Plan 09 pattern (`asSdkInputSchema(zodShape)`, `toToolResult(...)`).
- [ ] The Vite ready predicate strips ANSI control sequences before matching, then searches for `Local:\s+(https?:\S+)` anywhere in the line. Tests assert both arrow-prefixed (`  ➜  Local:   http://...`) and plain (`Local: http://...`) banners are matched.
- [ ] `dev_server.start` on `AlreadyRunning` awaits the existing handle's `readyPromise` so the response always carries defined `url`, `pid`, `startedAt`.
- [ ] On `onReady` timeout or pre-ready exit, `dev_server.start` calls `manager.stop('dev-server')` to clear the stale handle and returns `{ ok: false, error, lastLogLines }`. A retry after failure can start fresh.
- [ ] `dev_server.logs` clamps `tail` to `[1, 1000]` (never rejects).
- [ ] `src/__tests__/dev-server.test.ts` covers: start → status → logs → stop, start-while-already-running (`alreadyRunning: true`), start-during-startup (second call awaits `readyPromise`), start-failure-then-retry.
- [ ] `src/__tests__/stdio-tools-list.test.ts` asserts 14 tools and verifies the 4 new tool names by exact set equality.
- [ ] Build the package (`pnpm --filter @codexu/overview-mcp build`) before running `stdio-tools-list.test.ts` (or rely on the new `pretest` hook).
- [ ] Typecheck and tests pass.

**Dependencies:** US-001, US-002
**Estimated complexity:** large

## US-005: overview.build tool
**Description:** As an agent, I want `overview.build` to run `pnpm overview:build` and return success/size/duration or a structured failure, so I can rebuild the static viewer from MCP.
**Acceptance Criteria:**
- [ ] `tools/overview-mcp/src/tools/build.ts` registers `overview.build` and spawns the build through `ProcessManager.spawn({ name: 'build', cmd: 'pnpm', args: ['overview:build'], cwd: ctx.repoRoot, oneShot: true })`.
- [ ] Concurrent `overview.build` calls receive `AlreadyRunning` → tool returns `{ ok: false, error: 'another build in progress' }`.
- [ ] On exit code 0, returns `{ ok: true, outputPath: <absolute path to plans/overview.html>, sizeBytes, durationMs }`.
- [ ] On non-zero exit, returns `{ ok: false, error: 'build failed with exit code <N>', lastLogLines: stderr.slice(-30) }`.
- [ ] The transient `'build'` entry is registered while running so `stopAll()` kills an in-flight build on SIGTERM.
- [ ] `src/__tests__/build.test.ts` covers success path (mock build script with fixture artifact), failure path (non-zero exit), concurrent-rejection path.
- [ ] `stdio-tools-list.test.ts` count increments to 15 with the new name asserted by set equality.
- [ ] Typecheck and tests pass.

**Dependencies:** US-001
**Estimated complexity:** medium

## US-006: overview.sync.now and overview.sync.watch_status
**Description:** As an agent, I want `overview.sync.now` to run the one-shot sync and `overview.sync.watch_status` to inspect the lock file holder, so I can drive and observe the sync pipeline from MCP.
**Acceptance Criteria:**
- [ ] `tools/overview-mcp/src/tools/sync-now.ts` registers `overview.sync.now` and spawns `node scripts/sync-ralph-state.mjs` through `ProcessManager.spawn({ name: 'sync-now', oneShot: true })`. Concurrent calls receive `AlreadyRunning` → returns `{ ok: false, error: 'sync already in progress' }`.
- [ ] On exit code 0, the tool parses the stdout summary line and returns `{ ok: true, summary: { tasksMatched, unmatchedCount, durationMs } }`.
- [ ] If the underlying script fails because the lock is held by another holder (vite-plugin / standalone / etc.), the tool reads `readLockStatus(ctx.config.lockFile)` and returns `{ ok: false, error: 'sync lock held by <process>', lockHolderProcess, lockHolderPid }`.
- [ ] On other non-zero exits, returns `{ ok: false, error, lastLogLines: stderr.slice(-30) }`.
- [ ] `tools/overview-mcp/src/tools/sync-watch-status.ts` registers `overview.sync.watch_status`, calls `readLockStatus(ctx.config.lockFile)`, and maps the result to `{ running, lockHolderPid?, lockHolderProcess?, startedAt?, lastHeartbeatAt?, staleLock?: boolean }`.
- [ ] `src/__tests__/sync-watch-status.test.ts` covers: missing lock, active lock, stale (old mtime + dead pid), stale (unparseable JSON), active (old mtime + ALIVE pid → still active).
- [ ] `src/__tests__/sync-now.test.ts` covers: parses the summary line; vite-plugin-lock-held path returns the lock-held error with metadata; concurrent call returns `another sync in progress`.
- [ ] `stdio-tools-list.test.ts` count increments to 17 with all 7 new names asserted by set equality.
- [ ] Typecheck and tests pass.

**Dependencies:** US-001, US-002, US-003
**Estimated complexity:** large

## US-007: Shutdown wiring + README + downstream cascade
**Description:** As the MCP server, I want `ProcessManager.stopAll()` invoked inside the existing `shutdown()` so all spawned children (long-lived and transient) die when SIGTERM arrives. Documentation must reflect the new operational surface, and downstream plans/INDEX references must be refreshed.
**Acceptance Criteria:**
- [ ] `tools/overview-mcp/src/index.ts` `shutdown()` awaits `context.processManager.stopAll()` between `snapshotReader.close()` and `server.close()`, inside a try/catch that logs to stderr so a hung child cannot block the rest of shutdown.
- [ ] No new SIGTERM/SIGINT/exit handlers are added. The existing handlers (Plan 09) are extended in place.
- [ ] `src/__tests__/shutdown.test.ts` (fast) uses real `node -e 'setInterval(() => {}, 1000)'` children to verify `ProcessManager.stopAll()` kills BOTH long-lived (`'dev-server'`) and transient (`'build'`, `'sync-now'`) registered entries within the SIGTERM + SIGKILL window.
- [ ] `src/__tests__/shutdown-vite.test.ts` (or `describe.skipIf(!process.env.OVERVIEW_MCP_REAL_VITE)` block) covers the real-Vite Windows orphan check from verification step L — runnable manually but skipped in CI to avoid flakiness.
- [ ] `tools/overview-mcp/README.md` documents the 7 new tools (one section per tool with input/output schema), the lifecycle constraint (children die with MCP), the build single-flight rejection, the ring-buffer cap, the `tree-kill` Windows dependency, and the dev-server stdio isolation guarantee.
- [ ] `tools/overview-mcp/package.json` declares `tree-kill` as a runtime dependency (or devDependency if only used in tests — the plan uses it in `ProcessManager.stop()`, so runtime).
- [ ] **Cascade audit:** `plans/ralph-pipeline-INDEX.md`'s "Source-of-truth modules" table and DAG diagram are updated for the new files: `tools/overview-mcp/src/process-manager.ts`, the 7 new tool files, the new test files, and the modifications to `scripts/lib/sync-lock.mjs` + `scripts/sync-ralph-state.mjs`. Plans 02 and 09 are reviewed for any references that drifted (file paths, type signatures, export names, behavior contracts) and updated atomically in the final implementation commit. The commit message lists each diff (file, lines, change) so reviewers can verify the cascade.
- [ ] All 17 tools are listed in the stdio smoke test by exact set equality.
- [ ] Final typecheck + test run passes; `pnpm overview-mcp:install` (and equivalent CI scripts) continue to succeed.

**Dependencies:** US-001, US-004, US-005, US-006
**Estimated complexity:** medium
