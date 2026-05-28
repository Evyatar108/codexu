# Research Brief: ralph-overview-watcher-consumer-workspace-root

## Researcher Findings

### resolveRepoRoot call sites (4 duplicated implementations)

| File | Line | Logic | Has env? |
|---|---|---|---|
| `tools/overview-mcp/src/context.ts` | 65 | `git -C cwd rev-parse --show-toplevel` → `cwd` | **NO** |
| `tools/overview-mcp/src/install-server.ts` | 104 | Same as context.ts | **NO** |
| `scripts/sync-ralph-state.mjs` | 438 | `git rev-parse --show-toplevel` (throws on failure) | **NO** |
| `tools/overview-viewer/vite.config.ts` | 30 | `OVERVIEW_REPO_ROOT` → git → cwd | **YES (only one)** |

### Chokepoint
- `buildContext()` in `context.ts:19-34` is the MCP entry point — fixing `resolveRepoRoot()` here propagates through `watcher-supervisor.ts:78` (`getWatcherOwnerPath(context.repoRoot)`) and `:147` (`--repo this.context.repoRoot` + `cwd: this.context.repoRoot` + `env.OVERVIEW_REPO_ROOT: this.context.repoRoot`).
- `sync-ralph-state.mjs:438` is NOT reachable through this chokepoint (standalone script entry).

### All write paths rooted at resolved `repoRoot`
1. **Owner marker:** `<repoRoot>/.ralph/overview-watcher.owner` — `watch-ralph-state.mjs` `claimOwnerHeartbeat`; `getWatcherOwnerPath(repoRoot)`
2. **Sidecar JSON:** `<repoRoot>/<config.outputs.sidecarJson>` (default `.ralph/overview-ralph-state.json`)
3. **Sidecar JS:** `<repoRoot>/<config.outputs.sidecarJs>` (default `.ralph/overview-ralph-state.js`)
4. **Lock file:** `<repoRoot>/<config.lockFile>` (default `.ralph/overview.lock`)
5. **Activity log:** `<repoRoot>/.ralph/overview-activity.jsonl`
6. **Parent heartbeat** (different path: `~/.cache/ralph-overview-mcp/watcher-parent-<pid>.owner` — NOT affected by repoRoot)

### Currently-read env vars (file:line)
- `OVERVIEW_REPO_ROOT` — `vite.config.ts:31` (only reader)
- `RALPH_OVERVIEW_PLUGIN_ROOT` — `context.ts:49`
- `CLAUDE_PLUGIN_ROOT` — `context.ts:50`
- `OVERVIEW_CONFIG_PATH` — `resolve-config.mjs:29`
- `RALPH_OVERVIEW_MCP_PARENT_PID`, `RALPH_OVERVIEW_MCP_HEARTBEAT` — heartbeat IPC
- No `RALPH_OVERVIEW_REPO_ROOT` exists today

### Tests of repo-root resolution
- `tools/overview-mcp/src/__tests__/watcher-supervisor.test.ts` — exercises supervisor with explicit `tempRoot`
- `tools/overview-mcp/src/__tests__/install-server.test.ts` — tests with explicit `repoRoot` param
- `scripts/lib/resolve-config.test.mjs` — loadConfig with explicit `repoRoot`
- **GAP:** No tests for `resolveRepoRoot()` function itself, no env-var or filesystem-walk tests

### `pnpm overview` regression path (AC-2)
1. `pnpm overview` → `node bin/ralph-overview.mjs dev` (codexu wrapper at `D:/harness-efforts/codexu/bin/ralph-overview.mjs:108-112`)
2. Wrapper **auto-adds `--repo <gitRoot>`** if not supplied (L112)
3. Plugin dispatcher (`<plugin>/bin/ralph-overview.mjs:29`) sets `env.OVERVIEW_REPO_ROOT=args.repoRoot`
4. Vite picks up `OVERVIEW_REPO_ROOT` (`vite.config.ts:31`)

**Implication:** Claude/manual path is already protected by explicit `--repo`. Copilot MCP path is unprotected — no `--repo` passes through.

### MCP server registration (codexu `.mcp.json`)
```json
{ "mcpServers": { "ralph-overview": { "type": "stdio", "command": "node",
  "args": ["${CLAUDE_PLUGIN_ROOT}/launch.cjs"] } } }
```
No `cwd` field, no `--repo` flag — child inherits parent cwd (= plugin cache when Copilot launches).

## Architect Analysis

### Recommended priority order
1. `RALPH_OVERVIEW_REPO_ROOT` env var (per spec)
2. `OVERVIEW_REPO_ROOT` env var (legacy alias — already used by vite, dispatcher)
3. Walk up from `process.cwd()` for nearest `.ralph/` ancestor
4. `git rev-parse --show-toplevel` from `process.cwd()`
5. `process.cwd()` itself

### Rationale
- Reusing `OVERVIEW_REPO_ROOT` keeps the existing protected `pnpm overview` path unchanged.
- The new `RALPH_OVERVIEW_REPO_ROOT` ranks first per spec; treat `OVERVIEW_REPO_ROOT` as backwards-compatible alias.
- Walk-up handles Copilot's case (cwd = plugin cache, no env, no git repo at that path) without depending on Copilot setting any env var.
- Loop terminates at filesystem root **and** `os.homedir()` to prevent walking past consumer workspace into a global `~/.ralph/`.

### Shared resolver lib
- New file: `scripts/lib/repo-root.mjs` exporting `resolveRepoRootDefault(cwd)` (env→walk→git→cwd) and `resolveRepoRootFromEnv()`.
- Matching `.d.mts` stub for TypeScript consumers.

### Wired into:
- `tools/overview-mcp/src/context.ts:65` (CRITICAL — chokepoint for MCP)
- `scripts/sync-ralph-state.mjs:438` (CRITICAL — standalone script entry)
- `tools/overview-mcp/src/install-server.ts:104` (consistency)
- `tools/overview-viewer/vite.config.ts:30` (replace local helper with shared)

### Risk areas
1. **Nested `.ralph/` in monorepo:** walk-up stops at first match — usually correct but flag in docs.
2. **Parent repo with `.ralph/`:** mitigation = stop walk at `os.homedir()`.
3. **Walk-up cost:** negligible (single `existsSync` per level, terminates quickly).
4. **Symlinked worktrees:** existing git logic still handles — walk-up is only a fallback when env unset.
5. **Copilot launch contract unknown:** design intentionally does not depend on Copilot env vars; walk-up works regardless.

## Codex Research

### Key additions over researcher+architect

1. **Stale audit row name:** v2.4.0 no longer exposes `overview.dev_server.start`. The FAIL is real (owner marker rooted in plugin cache); only the row title is dated. The fix flips the underlying status — the row's name does not need to change here.

2. **Add `RALPH_OVERVIEW_REPO_ROOT` AS spec'd, keep `OVERVIEW_REPO_ROOT` AS alias.** Don't drop `OVERVIEW_REPO_ROOT` — vite + dispatcher rely on it.

3. **`launch.cjs` and `.mcp.json` should ALSO carry an explicit root** as defense-in-depth:
   - `scripts/init-consumer.mjs:planMcpJson()` could append `--repo <consumerRoot>` to the `args` array OR set `env.RALPH_OVERVIEW_REPO_ROOT` in the registration.
   - `launch.cjs` should detect the env var and propagate it (already passes `cwd: process.cwd()` — that becomes irrelevant if env is set).
   - **Trade-off:** doing this requires re-running `overview.init` to update `.mcp.json`. Surface this as a release note.

4. **TypeScript `.mjs` import:** add `.d.mts` declaration alongside the helper so `.ts` files type-check.

5. **Version bump touches multiple manifest files:**
   - `.claude-plugin/plugin.json`
   - `.github/plugin/plugin.json`
   - `.claude-plugin/marketplace.json`
   - `.github/plugin/marketplace.json`
   - `.agents/plugins/marketplace.json` (in toolkit repo)
   - `CHANGELOG.md`

## Consolidated File List

### Files to create
- `D:/ai-developer-toolkit/plugins/ralph-overview/scripts/lib/repo-root.mjs` (new shared resolver)
- `D:/ai-developer-toolkit/plugins/ralph-overview/scripts/lib/repo-root.d.mts` (TS type stub)
- `D:/ai-developer-toolkit/plugins/ralph-overview/scripts/lib/__tests__/repo-root.test.mjs` (resolver unit tests) — OR co-located `scripts/lib/repo-root.test.mjs` per existing convention

### Files to modify (source)
- `D:/ai-developer-toolkit/plugins/ralph-overview/tools/overview-mcp/src/context.ts` (L65)
- `D:/ai-developer-toolkit/plugins/ralph-overview/scripts/sync-ralph-state.mjs` (L438)
- `D:/ai-developer-toolkit/plugins/ralph-overview/tools/overview-mcp/src/install-server.ts` (L104)
- `D:/ai-developer-toolkit/plugins/ralph-overview/tools/overview-viewer/vite.config.ts` (L30)
- `D:/ai-developer-toolkit/plugins/ralph-overview/launch.cjs` (L121-122 — propagate env)
- `D:/ai-developer-toolkit/plugins/ralph-overview/scripts/init-consumer.mjs` (`planMcpJson()` — append env or `--repo` to generated `.mcp.json`)

### Files to modify (version/docs)
- `D:/ai-developer-toolkit/plugins/ralph-overview/.claude-plugin/plugin.json` (2.4.0 → 2.4.1)
- `D:/ai-developer-toolkit/plugins/ralph-overview/.github/plugin/plugin.json` (2.4.0 → 2.4.1)
- `D:/ai-developer-toolkit/plugins/ralph-overview/.claude-plugin/marketplace.json` (if version pinned)
- `D:/ai-developer-toolkit/plugins/ralph-overview/.github/plugin/marketplace.json` (if version pinned)
- `D:/ai-developer-toolkit/.agents/plugins/marketplace.json` (if version pinned)
- `D:/ai-developer-toolkit/plugins/ralph-overview/CHANGELOG.md` (new v2.4.1 entry)
- `D:/ai-developer-toolkit/plugins/ralph-overview/CLAUDE.md` (document new env var precedence near L78 "Consumer `repoRoot` flows through `OVERVIEW_REPO_ROOT`")
- `D:/ai-developer-toolkit/plugins/ralph-overview/docs/configuration.md` (document `RALPH_OVERVIEW_REPO_ROOT`)

### Files to modify (tests + audit)
- `D:/ai-developer-toolkit/plugins/ralph-overview/tools/overview-mcp/src/__tests__/watcher-supervisor.test.ts` (optional integration test)
- `D:/harness-efforts/codexu/.ralph/jobs/plugins-copilot-cross-engine-audit/audit-report.md` (flip `dev-server-watcher-autostart` row FAIL → PASS after AC-3 verification, with new evidence)
- `D:/harness-efforts/codexu/.ralph/jobs/plugins-copilot-cross-engine-audit/evidence/ralph-overview-owner-path.txt` (refresh with consumer-workspace path proof)

### Reference files (read-only context)
- `D:/ai-developer-toolkit/plugins/ralph-overview/tools/overview-mcp/src/watcher-supervisor.ts` (consumer of `context.repoRoot`)
- `D:/ai-developer-toolkit/plugins/ralph-overview/scripts/lib/watch-ralph-state.mjs` (`getWatcherOwnerPath`)
- `D:/ai-developer-toolkit/plugins/ralph-overview/scripts/lib/resolve-config.mjs` (`loadConfig({ repoRoot })`)
- `D:/ai-developer-toolkit/plugins/ralph-overview/bin/ralph-overview.mjs` (dispatcher — sets `OVERVIEW_REPO_ROOT`)
- `D:/harness-efforts/codexu/bin/ralph-overview.mjs` (consumer wrapper — auto-adds `--repo`)
- `D:/harness-efforts/codexu/.ralph/jobs/plugins-copilot-cross-engine-audit/audit-report.md` (rows ~135-141 + ~21)
- `D:/harness-efforts/codexu/.ralph/jobs/plugins-copilot-cross-engine-audit/evidence/ralph-overview-owner-snapshot.txt`
- `D:/harness-efforts/codexu/.ralph/jobs/plugins-copilot-cross-engine-audit/evidence/ralph-overview-launch-cwd-lines.txt`
