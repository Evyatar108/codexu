# PRD: MCP Operational Tools — Dev Server, Sync, Build Subprocess Control

## Introduction

Plan 09 shipped an MCP server (`tools/overview-mcp/`) with 10 data-oriented tools that read snapshot/sidecar/manifest files. This feature adds **subprocess management tools** so an agent can start, stop, inspect, and drive the Vite dev server, the sync watcher, and the static build directly from MCP — without round-tripping to a terminal.

The user-stated requirement:
> "I also want the react server itself to be runnable via the mcp, so the agent can have a tool to start it, etc"

The "etc" interprets broadly as the operational surface around the overview viewer: dev-server start/stop/status/logs, one-shot static build, one-shot sync, and watcher status inspection.

This PRD is derived directly from the plan at `D:/harness-efforts/codexu/.ralph/jobs/ralph-pipeline-11-mcp-operational-tools/plan.md` and the 7-story decomposition in `stories-outline.md`. The work lands on branch `ralph-pipeline-11-mcp-operational-tools` in worktree `D:/harness-efforts/codexu/.ralph/jobs/ralph-pipeline-11-mcp-operational-tools/worktree/`.

## Goals

- Extend the existing `tools/overview-mcp` server with 7 new tools covering operational control: dev-server lifecycle (start/stop/status/logs), static build, one-shot sync, and watcher status inspection.
- Introduce a single shared `ProcessManager` class that handles spawn, ring-buffered logs, ready-signal detection, single-flight enforcement, and graceful shutdown for both long-lived (`dev-server`) and transient (`build`, `sync-now`) child processes.
- Ensure all spawned children die with the MCP server on SIGTERM/SIGINT — no orphan PIDs, including on Windows where `shell: true` + tree-kill is required for pnpm.
- Export a canonical `readLockStatus` helper from `scripts/lib/sync-lock.mjs` so the MCP and the existing watcher share one lock-semantics implementation.
- Update `scripts/sync-ralph-state.mjs` to emit a parseable stdout summary line so `overview.sync.now` can return structured `{ tasksMatched, unmatchedCount, durationMs }`.
- Keep the existing MCP stdio JSON-RPC channel uncorrupted by ensuring every child uses `stdio: ['ignore', 'pipe', 'pipe']`.

## User Stories

### US-001: ProcessManager foundation

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

### US-002: sync-lock helper exports

**Description:** As `sync-watch-status.ts` and the future MCP toolset, I want a single canonical `readLockStatus(lockPath)` helper exported from `scripts/lib/sync-lock.mjs` (plus its building blocks), so lock semantics never drift between watcher and MCP.

**Acceptance Criteria:**
- [ ] `scripts/lib/sync-lock.mjs` exports `parseLockMetadata(buffer)`, `isLockHolderAlive(pid)`, and `readLockStatus(lockPath, opts?)`.
- [ ] `readLockStatus` returns `{ state: 'missing' }` | `{ state: 'active', pid, process, startedAt, mtime: Date }` | `{ state: 'stale', pid?, process?, startedAt?, mtime?: Date }`. Unparseable JSON triggers one 50ms retry before classifying as stale.
- [ ] When mtime is older than `staleAfterMs` (default `DEFAULT_STALE_AFTER_MS = 60_000`) BUT `isLockHolderAlive(pid) === true`, the result is `'active'` (trust PID over mtime).
- [ ] `scripts/lib/sync-lock.d.mts` declares the new exports with the documented type shapes so TypeScript consumers (overview-mcp NodeNext resolution) typecheck cleanly.
- [ ] `scripts/lib/sync-lock.test.mjs` (or the equivalent existing test file location) covers each helper: parse success/failure, alive PID, dead PID, active mtime, stale mtime + dead PID, stale mtime + alive PID, missing file, unparseable + retry.
- [ ] No behavior change to existing `acquireLock` / `releaseLock` callers.
- [ ] Typecheck and tests pass for `@codexu/overview-mcp` (verifies the .d.mts edit).

### US-003: sync-ralph-state stdout summary

**Description:** As `overview.sync.now`, I want `scripts/sync-ralph-state.mjs:runOneShot()` to print a parseable summary line on stdout, so the MCP tool can return a structured `{ tasksMatched, unmatchedCount, durationMs }` summary.

**Acceptance Criteria:**
- [ ] Inside `runOneShot()`, after the sidecar write but before lock release, a single line `sync: matched=<N>, unmatched=<N>, duration=<Nms>` is printed to stdout. All other diagnostics continue to go to stderr.
- [ ] The `matched` and `unmatched` counts are derived from the actual local state object (e.g. `Object.keys(state.byTaskId ?? {}).length` and `(state.unmatched ?? []).length`); the implementer reads `runOneShot` and binds the names that exist — does NOT assume.
- [ ] `startTime` is captured at the top of `runOneShot` (`const startTime = Date.now()`); `durationMs = Date.now() - startTime` at emission time.
- [ ] A unit test (in `tools/overview-mcp/src/__tests__/sync-now.test.ts`) spawns the real script with a tmp repo and asserts the stdout contains the parseable summary line.
- [ ] Existing watcher mode behavior is unchanged (the summary line is one-shot only).

### US-004: dev-server tools + MCP wiring

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

### US-005: overview.build tool

**Description:** As an agent, I want `overview.build` to run `pnpm overview:build` and return success/size/duration or a structured failure, so I can rebuild the static viewer from MCP.

**Acceptance Criteria:**
- [ ] `tools/overview-mcp/src/tools/build.ts` registers `overview.build` and spawns the build through `ProcessManager.spawn({ name: 'build', cmd: 'pnpm', args: ['overview:build'], cwd: ctx.repoRoot, oneShot: true })`.
- [ ] Concurrent `overview.build` calls receive `AlreadyRunning` → tool returns `{ ok: false, error: 'another build in progress' }`.
- [ ] On exit code 0, returns `{ ok: true, outputPath: <absolute path to .ralph-overview/generated/overview.html>, sizeBytes, durationMs }`.
- [ ] On non-zero exit, returns `{ ok: false, error: 'build failed with exit code <N>', lastLogLines: stderr.slice(-30) }`.
- [ ] The transient `'build'` entry is registered while running so `stopAll()` kills an in-flight build on SIGTERM.
- [ ] `src/__tests__/build.test.ts` covers success path (mock build script with fixture artifact), failure path (non-zero exit), concurrent-rejection path.
- [ ] `stdio-tools-list.test.ts` count increments to 15 with the new name asserted by set equality.
- [ ] Typecheck and tests pass.

### US-006: overview.sync.now and overview.sync.watch_status

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

### US-007: Shutdown wiring + README + downstream cascade

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

## Functional Requirements

- FR-1: A new `ProcessManager` class lives in `tools/overview-mcp/src/process-manager.ts`, instantiated once per MCP server lifetime and attached to `ServerContext`.
- FR-2: `ProcessManager.spawn` registers each `ManagedProcess` (with its `readyPromise`) in the Map BEFORE calling `child_process.spawn`; subsequent calls with the same name throw `AlreadyRunning` carrying the existing handle.
- FR-3: All children are spawned with `stdio: ['ignore', 'pipe', 'pipe']` and `{ shell: true }`; the MCP parent stdout must never receive child output.
- FR-4: Ring buffers cap at 1000 lines per stream; CRLF is normalized to LF before splitting.
- FR-5: `ProcessManager.stop()` uses `tree-kill` on Windows for SIGTERM and SIGKILL escalation; POSIX uses `child.kill('SIGTERM')` then `child.kill('SIGKILL')` with 5s and 2s waits.
- FR-6: `ProcessManager.stopAll()` is called once, inside the existing `shutdown()` in `src/index.ts`, between `snapshotReader.close()` and `server.close()`, wrapped in try/catch that logs to stderr.
- FR-7: Transient one-shot names (`'build'`, `'sync-now'`) are tracked while running and removed from the Map on `'exit'` via a `disposeOnExit`/`oneShot` flag, but `stopAll()` always includes them while alive.
- FR-8: `overview.dev_server.start` spawns `pnpm overview` and resolves with the Vite-emitted URL within 60s; on failure (timeout, spawn error, exit-before-ready) it calls `manager.stop('dev-server', { remove: true })` and returns `{ ok: false, error, lastLogLines: stderr.slice(-30) }`.
- FR-9: When `dev_server.start` is called while a start is already in progress, it awaits the existing handle's `readyPromise` and returns `{ ok: true, alreadyRunning: true, url, pid, startedAt }` with defined fields.
- FR-10: The Vite ready predicate strips CSI ANSI escapes with `/\x1b\[[0-9;]*[A-Za-z]/g`, then matches `/Local:\s+(https?:\S+)/` anywhere in the line; the search is performed on both stdout and stderr ring buffers.
- FR-11: `overview.dev_server.stop` terminates the child within 5s (SIGTERM) or 7s (escalated SIGKILL); returns `{ ok: true, stoppedAt }` even when no child exists (idempotent).
- FR-12: `overview.dev_server.status` returns `{ running, url?, pid?, startedAt?, lastReadyAt?, lastLogTail: { stdout: string[≤10], stderr: string[≤10] } }`.
- FR-13: `overview.dev_server.logs` validates inputs via zod (`tail` integer default 100, `stream` enum default `'both'`) and CLAMPS `tail` to `[1, 1000]` at runtime — out-of-range values are clamped, never rejected.
- FR-14: `overview.build` spawns `pnpm overview:build` through `ProcessManager` with reserved name `'build'`; on exit code 0 returns `{ ok: true, outputPath: <absolute path to .ralph-overview/generated/overview.html>, sizeBytes, durationMs }`; on non-zero exit returns `{ ok: false, error: 'build failed with exit code N', lastLogLines: stderr.slice(-30) }`; concurrent calls return `{ ok: false, error: 'another build in progress' }`.
- FR-15: `overview.sync.now` spawns `node scripts/sync-ralph-state.mjs` through `ProcessManager` with reserved name `'sync-now'`; on success it parses the stdout summary line `sync: matched=<N>, unmatched=<N>, duration=<Nms>` and returns `{ ok: true, summary: { tasksMatched, unmatchedCount, durationMs } }`.
- FR-16: When `sync.now` exits non-zero because the lock is held by another holder, the tool calls `readLockStatus(ctx.config.lockFile)` and returns `{ ok: false, error: 'sync lock held by <process>', lockHolderProcess, lockHolderPid }`.
- FR-17: `overview.sync.watch_status` calls `readLockStatus(ctx.config.lockFile)` and maps the result to `{ running, lockHolderPid?, lockHolderProcess?, startedAt?, lastHeartbeatAt?, staleLock?: boolean }`. Returns `{ running: false, staleLock: true }` on unparseable JSON (after one 50ms retry).
- FR-18: `scripts/lib/sync-lock.mjs` exports `parseLockMetadata(buffer)`, `isLockHolderAlive(pid)`, and `readLockStatus(lockPath, opts?)`; existing `acquireLock` / `releaseLock` callers are refactored to use the extracted helpers but their public behavior is unchanged.
- [ ] FR-19: `scripts/lib/sync-lock.d.mts` declares matching TypeScript exports for `readLockStatus`, `parseLockMetadata`, and `isLockHolderAlive` so the overview-mcp NodeNext resolution typechecks cleanly.
- FR-20: `scripts/sync-ralph-state.mjs:runOneShot()` captures `const startTime = Date.now()` at the top, then after `await writeSidecar(...)` and before lock release emits `console.log(\`sync: matched=${matched}, unmatched=${unmatched}, duration=${durationMs}ms\`)` exactly once. All other diagnostics remain on stderr.
- FR-21: `tools/overview-mcp/src/__tests__/stdio-tools-list.test.ts` asserts an exact tool count of 17 and an exact set of names (10 from Plan 09 + 7 new). Per-story interim counts: US-004 → 14, US-005 → 15, US-006 → 17, US-007 confirms 17.
- FR-22: `tools/overview-mcp/package.json` declares `tree-kill` as a runtime dependency.
- FR-23: `tools/overview-mcp/README.md` documents each of the 7 new tools (input/output schema), the lifecycle constraint, the single-flight constraints, the ring-buffer cap, the Windows `shell: true` + `tree-kill` behavior, and the stdio isolation guarantee.
- FR-24: `plans/ralph-pipeline-INDEX.md` and any drift-affected references in Plans 02 and 09 are updated atomically in the final implementation commit; the commit message lists each diff so reviewers can verify the cascade.

## Non-Goals (Out of Scope)

- Detached / persistent dev server that survives MCP restarts. v1 ties dev-server lifetime to MCP.
- Multi-instance dev servers on different ports.
- Generic process-launcher tool (`overview.spawn_any`) — security risk.
- Test/typecheck invocation tools (`overview.test`, `overview.typecheck`) — possible follow-up.
- Stale-lock cleanup from MCP. `overview.sync.watch_status` only reports stale locks; cleanup remains the watcher / one-shot's responsibility.
- New SIGTERM/SIGINT/exit handlers in `src/index.ts`. The existing handlers from Plan 09 are extended in place.
- Module-level booleans for build/sync single-flight. Single-flight is enforced solely via `ProcessManager.spawn`'s `AlreadyRunning` exception on reserved names.

## Design Considerations

- **Reuse Plan 09's tool registration pattern.** Each new tool file in `src/tools/` calls `server.registerTool('overview.<name>', { description, inputSchema: asSdkInputSchema(<zod>) }, async (input) => toToolResult(await <handler>(context, input)))`.
- **`ServerContext` is the single injection point.** `ProcessManager` is constructed once in `buildContext` (or wherever the context is built) and passed to every tool registration via `ctx.processManager`. Tests inject overrides through `makeContext({ processManager })`.
- **Tests live under `src/__tests__/`.** Vitest config only globs `src/__tests__/**/*.test.ts`; the legacy `tests/` directory will silently NOT run. All new tests follow the `src/__tests__/` convention.
- **README structure mirrors existing tool documentation.** Add a "Subprocess tools" section listing each new tool with input schema, output schema, and behavioral notes.

## Technical Considerations

- **MCP stdio is reserved for JSON-RPC.** Every child must spawn with `stdio: ['ignore', 'pipe', 'pipe']`. Any inherited stdout would corrupt the JSON-RPC stream — test must assert parent stdout stays clean.
- **Windows `pnpm` requires `shell: true`.** Without it, `spawn` throws ENOENT for `.cmd` shims. With `shell: true`, the tracked PID can be the shell wrapper, so `tree-kill` is required for both SIGTERM and SIGKILL escalation on Windows.
- **`process.on('exit', async)` cannot await.** Only SIGINT/SIGTERM via the existing `shutdown()` trigger `stopAll`. Do not add new handlers.
- **Vite ready signal may appear on stderr.** `onReady` checks both stdout and stderr ring buffers.
- **Lock file write race.** `readLockStatus` retries `JSON.parse` once after a 50ms backoff before classifying as unparseable.
- **Ring buffer cap is 1000 lines per stream.** Dev servers running > 10 minutes lose early lines. Documented in README.
- **Stdio smoke test runs the BUILT `dist/index.js`.** Run `pnpm --filter @codexu/overview-mcp build` (or rely on a `pretest` hook) before invoking `stdio-tools-list.test.ts`, otherwise stale `dist/` would mask source changes.
- **`pnpm overview` already starts the watcher via Plan 02's Vite plugin.** `sync.watch_status` will reflect `lockHolderProcess: 'vite-plugin'`. Do not start a separate watcher from MCP.
- **`lockHolderProcess` is typed as `string`, not a closed union.** Known emitted values: `'standalone-oneshot'`, `'standalone'`, `'vite-plugin'`, `'crew-session-update'`, `'crew-session-finalize'`, `'watcher'`. Consumers can pattern-match against the known set and treat unknowns as `'unknown'`.
- **`mcp-ops-tools` cluster (US-004..US-007) must run strictly serially.** All four stories edit `src/server.ts`, `src/context.ts`, `src/schemas.ts`, `src/__tests__/stdio-tools-list.test.ts`, and `README.md`. Parallelizing would produce merge conflicts on every shared file.

## Success Metrics

- All 7 new tools registered and callable via the MCP server (`tools/list` returns exactly 17 tool names).
- An agent can fully drive the overview lifecycle (start, stop, build, sync, status) via MCP without touching a terminal.
- SIGTERM/SIGINT to the MCP server kills every spawned child within 7 seconds — no orphan node/pnpm PIDs and port 5173 is no longer listening (verified by shutdown integration test).
- `pnpm --filter @codexu/overview-mcp test` and typecheck pass on the worktree branch with all 7 stories complete.
- No regression in existing Plan 02 watcher behavior (existing `acquireLock` / `releaseLock` callers continue to function unchanged after the helper extraction).

## Open Questions

- **External sync concurrency remains possible.** `overview.sync.now` is single-flight inside one MCP process via `ProcessManager`, but an external `pnpm sync-ralph-state:watch` or another MCP server can still contend on `config.lockFile`. That is intentional — the OS-level lock remains the cross-process source of truth, and MCP's in-process guard only prevents duplicate local children and ensures shutdown cleanup.
- **`build` and `sync-now` are tracked-while-running but auto-disposed on exit.** Confirm during US-005/US-006 implementation that the `disposeOnExit` semantics introduced in US-001 line up with the assertions in `build.test.ts`/`sync-now.test.ts` (in-flight transient present in `stopAll()`, absent from manager state after exit).
- **Real-Vite shutdown integration test is gated by env var.** `src/__tests__/shutdown-vite.test.ts` is skipped unless `OVERVIEW_MCP_REAL_VITE=1` to avoid CI flakiness. Manual Windows verification of the no-orphan AC remains the canonical proof.

## Autonomous Mode Notes

Generated in `--mode autonomous` from the plan + stories outline. No clarifying questions were asked; all answers were derived directly from `plan.md`'s "Files to Create/Modify", "Acceptance Criteria", and "Verification" sections, plus the verbatim US-001..US-007 definitions in `stories-outline.md`. Story dependencies and acceptance criteria are preserved as-is from the outline. The 7 Medium plan-review findings (F-013..F-019) remain in `plan-review-findings.json` with `status: open` for tracking but are not duplicated as PRD acceptance criteria (the criteria-validator runs in Phase 2.7 separately).
