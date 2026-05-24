# Code Review Context — ralph-pipeline-11-mcp-operational-tools

## Codebase Conventions Observed

- All new MCP tool files follow the existing pattern: a `registerXxxTool(server, context)` function plus an exported pure helper (`devServerStart`, `overviewBuild`, `syncNow`, `syncWatchStatus`) so the tool logic can be exercised directly from vitest. This mirrors `tools/overview-mcp/src/tools/add-journal-entry.ts` and `set-override.ts`.
- All tools return through `toToolResult` from `tools/read-only.ts` to keep JSON-RPC response shape uniform.
- Cross-package imports from `scripts/lib/*.mjs` continue to use the established `../../../../scripts/lib/<file>.mjs` traversal pattern (see `sync-now.ts:6`, `sync-watch-status.ts:3`, `context.ts:4`).
- `scripts/lib/sync-lock.d.mts` is the canonical TypeScript surface for the JS lock helpers. New `readLockStatus`, `parseLockMetadata`, and `isLockHolderAlive` exports were added there in sync with the new `.mjs` exports.

## Gotchas Worth Surfacing

- `tools/overview-mcp/tsconfig.json` has no explicit `rootDir`. When the package imports cross-package `.mjs` files from `../../../scripts/lib/*`, tsc widens rootDir to the repo root, which causes `tsc` to emit into `dist/overview-mcp/src/...` and `dist/scripts/lib/...` instead of `dist/*.js` directly. The new `build` script papers over this with a `cpSync('dist/overview-mcp/src', 'dist')` fix-up. Future agents need to understand this implicit dependency before touching the build pipeline (see F-007).
- The `oneShot` flag in `ProcessManager.spawn()` is the *only* mechanism that deletes a completed transient process from the Map; non-oneShot processes are deleted on `stop()` because of the default-true `remove` flag — but that default contradicts the plan (see F-004). When fixing F-004, all callers of `stop()` need to opt into removal explicitly.
- The shutdown integration test (`shutdown.test.ts`) uses real `node -e 'setInterval(...)'` children rather than mocks; the heavier real-Vite version is gated behind `OVERVIEW_MCP_REAL_VITE=1` env (`shutdown-vite.test.ts`).
- `vitest config` globs `src/__tests__/**/*.test.ts` only. Any test placed elsewhere silently does not run; `stdio-tools-list.test.ts` depends on a pre-built `dist/index.js`, so the package must be built before running tests in CI.

## Cross-Cutting Concerns

- Three tools share the dev-server name constant (`'dev-server'`) and the build/sync tools share their own reserved names (`'build'`, `'sync-now'`). These are duplicated as `const ... = '...'` at the top of each tool file. A small `process-names.ts` (or a `processManager.NAMES` enum on the manager itself) would prevent string drift.
- `stderrTail(logs).slice(-30)` is duplicated across `dev-server-start.ts`, `dev-server-status.ts`, `build.ts`, and `sync-now.ts`. Consider extracting a `tailLogs(logs, n)` helper into `process-manager.ts` to centralize the slice-30 vs slice-10 decision (F-002 highlights why this matters).
- `tools/overview-mcp/README.md` documents the lifecycle constraint accurately but contains the "last 30 lines" sentence that contradicts the plan AC (F-002).

## Test Coverage

- `process-manager.test.ts`: spawn / readyPromise / onReady / stop / stopAll / already-running / starting-state-stop / ring-buffer overflow / CRLF normalization / Windows tree-kill. Strong coverage.
- `dev-server.test.ts`: start / status / logs / stop / alreadyRunning short-circuit / readyPromise race / failed-start cleanup / log tail clamping. Strong coverage.
- `build.test.ts`, `sync-now.test.ts`: success, non-zero exit, single-flight, stopAll cleanup. The sync-now suite also covers the lock-held branch via stderr scraping.
- `sync-watch-status.test.ts`: missing / active / stale / unparseable / live-PID + stale mtime. Comprehensive.
- `shutdown.test.ts`: real node-child stopAll cleanup, both long-lived and transient.
- `shutdown-vite.test.ts`: skipIf-gated real-Vite + netstat-port-listener cleanup test for manual Windows verification.
