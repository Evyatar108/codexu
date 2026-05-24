## Researcher Findings

### Plan 09 actual shipped state — `tools/overview-mcp/`
- Directory confirmed. Entry layout: `src/index.ts` (stdio entrypoint), `src/server.ts` (tool registration), `src/context.ts` (`ServerContext { repoRoot, config, snapshotReader }`), `src/schemas.ts` (zod shapes + `asSdkInputSchema` wrapper), `src/tools/read-only.ts` (multiple read tools + `toToolResult()`), `src/tools/{add-journal-entry,get-transcript,invoke-next,list-crew-sessions,set-override}.ts`.
- Total registered tools: **10** (matches Plan 11 context).
- Registration pattern:
  ```typescript
  server.registerTool(
    'overview.list_tasks',
    { description: '...', inputSchema: asSdkInputSchema(listTasksInputSchema) },
    async (input) => toToolResult(await listTasks(context, input as ListTasksInput)),
  )
  ```
- New tools MUST be registered in `src/server.ts`, not directly in `src/index.ts` (separation of concerns matches the shipped pattern).
- Existing shutdown in `src/index.ts:26-31`: `process.once('SIGINT' | 'SIGTERM', () => void shutdown(signal))`. `shutdown()` already awaits `context.snapshotReader.close()` then `server.close()`. Plan 11 hooks into THIS shutdown — no duplicate signal handlers.
- Package deps: `@modelcontextprotocol/sdk@^1.23.0`, `chokidar@^5.0.0`, `zod@^4.1.13`. `tree-kill` is NOT present.
- `tsconfig.json`: ES2022 / NodeNext / strict / `skipLibCheck: true`.
- **Vitest config — CRITICAL CORRECTION:** `vitest.config.ts` only includes `src/__tests__/**/*.test.ts`. Plan 11's proposed `tools/overview-mcp/tests/*.test.ts` path WILL NOT BE PICKED UP by vitest. Tests must live under `tools/overview-mcp/src/__tests__/`.
- Existing test helper pattern: `src/__tests__/helpers.ts` exposes `setupTempRoot()` (returns `fs.mkdtemp(...)`) and `writeFixtureConfig(repoRoot)` — Plan 11 tests should reuse these.
- Existing stdio smoke test `src/__tests__/stdio-tools-list.test.ts` asserts a tool count of 10. **Plan 11 must update that assertion to 17.**

### Plan 02 lock file format — `scripts/lib/sync-lock.mjs` + `scripts/lib/watch-ralph-state.mjs`
- Lock metadata schema (line 14):
  ```js
  { pid: process.pid, process: processLabel, startedAt: new Date().toISOString() }
  ```
- Default stale threshold: `DEFAULT_STALE_AFTER_MS = 60_000`.
- PID liveness (line 127-139): `process.kill(pid, 0)`; ESRCH → dead, EPERM → alive.
- Heartbeat in watch mode: `HEARTBEAT_MS = 30_000` (touches mtime every 30s).
- Default lock path: `.ralph/overview-sync.lock` (from `scripts/lib/default-config.mjs:32`), resolved absolute by `resolve-config.mjs:141`. **Plan 11's path is correct; the TASK BRIEF's mention of `plans/.overview-ralph-state.lock` is stale.**
- ProcessLabel values actually emitted in the codebase:
  - `'standalone-oneshot'` — one-shot sync (`scripts/sync-ralph-state.mjs:133`)
  - `'standalone'` — standalone watcher (`scripts/sync-ralph-state.mjs:175`)
  - `'vite-plugin'` — Vite-plugin watcher (`tools/overview-viewer/vite.config.ts:184`)
  - `'crew-session-update'`, `'crew-session-finalize'` — additional labels for crew flows
  - `'watcher'` — default fallback in `watch-ralph-state.mjs:18` when no `processLabel` is passed
- **Plan 11 must add `'crew-session-update' | 'crew-session-finalize'` to the `lockHolderProcess` union type** OR keep it `string` and document the known labels.

### Sync summary line — `scripts/sync-ralph-state.mjs`
- One-shot path is `runOneShot()` at line 131-159. It currently emits unmatched diagnostics to **stderr** only.
- It does NOT currently emit a parseable stdout summary line. Plan 11's `sync.now` parser depends on a line of the form `sync: matched=<N>, unmatched=<N>, duration=<Nms>` — that line must be added in `runOneShot()` after the sidecar write but inside the lock window. Suggested location: line ~142.

### package.json scripts (confirmed)
- `overview` → `pnpm --filter @codexu/overview-viewer dev`
- `overview:build` → `pnpm --filter @codexu/overview-viewer build`
- `sync-ralph-state` → `node scripts/sync-ralph-state.mjs`
- `sync-ralph-state:watch` → `node scripts/sync-ralph-state.mjs --watch`
- `tools/overview-viewer/package.json:6` pins Vite to `--host 127.0.0.1 --port 5173`.

### Vite ready signal
- Vite prints `Local: http://127.0.0.1:5173/` to stdout by default. Regex `^\s*Local:\s+(\S+)` is correct, but stdout buffering may interleave with ANSI escapes; ring-buffer should normalize CRLF and the predicate should optionally strip ANSI.

### Plan reference file existence — verified
- `tools/overview-mcp/src/process-manager.ts` — not present (correct, Plan 11 creates it).
- All `tools/overview-mcp/src/tools/dev-server-*.ts`, `build.ts`, `sync-now.ts`, `sync-watch-status.ts` — not present (correct).
- Plan 11's test paths under `tools/overview-mcp/tests/` are WRONG (see vitest config correction above).

## Architect Analysis

### Integration / lifecycle
- ProcessManager should be created once at module-level in `index.ts` (or, cleaner: attached to `ServerContext` in `context.ts`) and passed into the tool registrations in `server.ts`. Tests can then inject a fresh manager.
- `shutdown()` should call `await processManager.stopAll()` after `snapshotReader.close()` and before `server.close()`. Do NOT add new SIGTERM/SIGINT handlers — extend the existing ones.
- Child stdio MUST NOT be inherited (`stdio: ['ignore', 'pipe', 'pipe']`). MCP transport uses stdout for JSON-RPC; any child writing to the parent's stdout would corrupt the protocol stream. This is a hard constraint, not a preference.

### Risk mitigations (specific)
1. **Vite ready emits to stderr on some versions:** `onReady` predicate checks BOTH stdout and stderr ring buffers.
2. **Double-start race:** Set `proc.status = 'starting'` and `this.processes.set(name, proc)` BEFORE `child_process.spawn(...)` returns the child. Second call sees `'starting'` and short-circuits.
3. **Stop while spawning (no pid yet):** In `stop()`, if `proc.pid` is undefined, wait briefly (≤200ms) for the `'spawn'` event, then proceed.
4. **Lock-file write race:** `sync.watch_status` reads while `sync.now` writes. Mitigation: 2-3 retry attempts on `JSON.parse` failure, 50ms backoff. Treat unparseable lock as `{ running: false, staleLock: true }`.
5. **Ring buffer overflow:** 1000 lines per stream caps memory at ~200KB. Document explicitly that dev-server logs > 10 minutes lose early lines.
6. **Orphan grandchildren on Windows:** Document the constraint; promote to `tree-kill` ONLY if `stopAll` tests reveal leaks (don't add the dep speculatively).
7. **Module-level `isBuilding` boolean for build single-flight** — simpler than tracking transient build processes in `ProcessManager.Map`. Reject the second concurrent call immediately.

### Test strategy
- All tests must `afterEach(() => manager.stopAll())` to prevent orphan leakage across tests.
- Use real `spawn(process.execPath, ['-e', '...'])` to mimic Vite (`console.log('Local: http://fake')`) — matches existing `stdio-tools-list.test.ts` style.
- Lock-status test: build a real lock file in a tmpdir with `fs.utimes` to backdate mtime → exercise stale path.
- Shutdown integration test: spawn the real MCP server as a subprocess, send a JSON-RPC `dev_server.start` call, then SIGTERM the parent, then `process.kill(childPid, 0)` to assert ESRCH (no orphan).

## Codex Research

- **Tests location:** matches researcher finding — tests live under `src/__tests__/`, NOT `tests/`. Vitest config only globs `src/__tests__/**/*.test.ts`.
- **Stdio smoke test count to bump:** 10 → 17.
- **Attach ProcessManager to ServerContext.** Construct once in `context.ts`, pass through to tools in `server.ts`.
- **`process.on('exit', async cb)` cannot await** — use SIGINT/SIGTERM only.
- **Reuse `sync-lock.mjs` helpers** by exporting a `readLockStatus` / `parseLockMetadata` / liveness function rather than duplicating the parse + stale + PID-check logic inside `sync-watch-status.ts`. Otherwise the MCP and the watcher will drift.
- **Vite output may include ANSI sequences and CRLF.** Normalize CRLF in the ring buffer; make the ready-signal regex tolerant.
- **Build output path is `plans/overview.html`** (from Vite config `build.outDir: '../../plans'`).
- **Sync-ralph-state CLI:** accepts `cwd: repoRoot` correctly; no `--repo` flag needed.

## Copilot Research

Copilot session exited prematurely without writing a usable report (only 346 bytes of progress chatter). Failed: treated as additive — no findings extracted.

## Consolidated File List

### Files to CREATE (under `tools/overview-mcp/`)
- `src/process-manager.ts`
- `src/tools/dev-server-start.ts`
- `src/tools/dev-server-stop.ts`
- `src/tools/dev-server-status.ts`
- `src/tools/dev-server-logs.ts`
- `src/tools/build.ts`
- `src/tools/sync-now.ts`
- `src/tools/sync-watch-status.ts`
- `src/__tests__/process-manager.test.ts` (note: src/__tests__, NOT tests/)
- `src/__tests__/dev-server.test.ts`
- `src/__tests__/build.test.ts`
- `src/__tests__/sync-watch-status.test.ts` (recommended; not in original plan but covers the lock-reader logic)
- `src/__tests__/shutdown.test.ts` (recommended integration test for SIGTERM → stopAll → no orphans)

### Files to MODIFY
- `tools/overview-mcp/src/server.ts` — register the 7 new tools.
- `tools/overview-mcp/src/context.ts` — instantiate `ProcessManager` and add to `ServerContext`.
- `tools/overview-mcp/src/index.ts` — wire `processManager.stopAll()` into the existing `shutdown()` between `snapshotReader.close()` and `server.close()`.
- `tools/overview-mcp/src/schemas.ts` — add zod input schemas for the 7 new tools.
- `tools/overview-mcp/src/__tests__/stdio-tools-list.test.ts` — bump expected tool count from 10 → 17.
- `tools/overview-mcp/README.md` — document the 7 new tools and the lifecycle constraint.
- `scripts/sync-ralph-state.mjs` — emit stdout summary `sync: matched=<N>, unmatched=<N>, duration=<Nms>` in `runOneShot()` (~line 142).
- `scripts/lib/sync-lock.mjs` — export a `readLockStatus(lockPath)` helper (or `parseLockMetadata` + `isLockHolderAlive`) so `sync-watch-status.ts` can reuse the canonical parse + stale + PID-liveness logic instead of duplicating it.

### Files for REFERENCE
- `tools/overview-mcp/src/snapshot-reader.ts` — chokidar lifecycle pattern.
- `tools/overview-mcp/src/__tests__/helpers.ts` — `setupTempRoot`, `writeFixtureConfig`.
- `tools/overview-mcp/src/__tests__/stdio-tools-list.test.ts` — real-process test pattern (spawn child, parse JSON-RPC).
- `scripts/lib/default-config.mjs` — confirms `.ralph/overview-sync.lock` default.
- `tools/overview-viewer/vite.config.ts` — pinned `--host 127.0.0.1 --port 5173`, build outDir = `../../plans`.

### Stale references in original Plan 11 — to be corrected during plan improvement
- Test paths use `tools/overview-mcp/tests/` (should be `tools/overview-mcp/src/__tests__/`).
- The `lockHolderProcess` union omits `'crew-session-update'` and `'crew-session-finalize'`. Either expand the union or document.
- Plan 11 does not call out the stdio-tools-list count bump.
- Plan 11 does not call out reusing `sync-lock.mjs` parse/liveness helpers — currently implies duplicating the logic.
- Plan 11 implementation strategy section skips step 8 in numbering (jumps 7→9).
