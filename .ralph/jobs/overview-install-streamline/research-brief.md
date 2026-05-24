# Research Brief: overview-install-streamline (D-001 + D-003)

## Researcher Findings

**Plugin source** — `D:/ai-developer-toolkit/plugins/ralph-overview/`:
- `.claude-plugin/plugin.json` — currently v1.0.0; needs bump.
- `bin/ralph-overview.mjs` — CLI dispatcher with subcommands `sync`, `watch`, `dev`, `build`, `mcp`, `install-server`, `cli`. Existing dispatch site shows the `install-server` pattern an `init` subcommand can mirror.
- `launch.cjs` — line 121: `cwd: process.cwd()` already correct; passes `RALPH_OVERVIEW_PLUGIN_ROOT` env to the spawned MCP server.
- `package.json` — npm workspaces (`tools/overview-mcp`, `tools/overview-viewer`); npm (NOT pnpm) is the actual package manager despite the brainstorm referencing `pnpm overview`.
- `tools/overview-mcp/src/server.ts` — registers 17 tools today (flat names like `overview.list_tasks`, `overview.invoke_next`, `overview.add_journal_entry`, etc.). New tools slot here.
- `tools/overview-mcp/src/schemas.ts` — Zod input schemas + inferred TS types.
- `tools/overview-mcp/src/context.ts` — resolves `repoRoot` from `OVERVIEW_REPO_ROOT` (set by `bin` dispatcher), `pluginRoot` from `RALPH_OVERVIEW_PLUGIN_ROOT`. `loadConfig()` warns but doesn't throw on missing config — important: `overview.init` must run before consumer config exists.
- `tools/overview-mcp/src/install-server.ts` — **WRONG SHAPE**. Currently writes `.claude/settings.json:mcpServers` directly (lines 46-59). Must be deprecated/replaced by the new engine.
- `tools/overview-mcp/src/tools/set-override.ts` + `src/utils/set-override-edit.ts` — **prior art for AST mutation** using `@babel/parser`. Existing edit utilities splice source via byte ranges without `@babel/traverse`/`@babel/generator`.
- `tools/overview-mcp/src/tools/sync-now.ts` — direct call site `syncNow(context)`. The architect's "shell out to `pnpm sync-ralph-state`" recommendation is wrong; call this function directly.
- `tools/overview-mcp/src/tools/dev-server-start.ts` — uses `bin/ralph-overview.mjs dev` (stale tests claim `pnpm overview`).
- `scripts/sync-ralph-state.mjs` + `scripts/lib/*.mjs` (25 modules, ESM, not compiled).
- `scripts/lib/atomic-write.mjs` — Windows EPERM/EACCES/EBUSY rename retry (3 attempts, 100ms backoff). Reuse.
- `scripts/lib/default-config.mjs` — canonical config defaults. Template is STALE relative to this (missing `**/node_modules/**`, `.ralph/jobs/*/*-worktree/**`, `.ralph/jobs/*/tasks/**` watcher ignore patterns; the codexu config has them).
- `templates/overview-config.template.json` — source for the consumer scaffold; needs the missing watcher ignores added.
- `templates/overview-data.template.js` — assigns `window.OVERVIEW_DATA` with sample tasks + minimal `ui`.
- `skills/work-on/`, `skills/triage/`, `skills/blocker-report/` — existing slash skills. Each is `SKILL.md` with frontmatter + Markdown body. New skills follow this shape.
- `dist/copilot/` — Copilot mirror artifacts (generated). Confirmed via repo conventions; mirror regeneration script lives in the plugin's `scripts/`. Every source skill edit needs a regenerated mirror per the v5.36.0 parity gate.
- Tests use **Vitest** (`npm test --workspaces` or `npm run test --workspace=tools/overview-mcp`). Existing tests in `src/__tests__/install-server.test.ts`, `dev-server.test.ts`, `sync-now.test.ts` have STALE expectations and must be updated alongside this work.

**Consumer reference** — `D:/harness-efforts/codexu/`:
- `.mcp.json` — has `paper` (http) + `ralph-overview` (stdio, pointing at `D:/ai-developer-toolkit/plugins/ralph-overview/launch.cjs`). Safe-merge MUST preserve `paper`.
- `.claude/settings.json` — has `enabledMcpjsonServers: ["paper", "ralph-overview"]`. Append-if-missing semantics.
- `plans/overview-data.js` — large hand-curated file with `CODEXU_UI` const containing `staticSections.parallelism`, `staticSections.dependencies`, `staticSections.footnote` (multi-line `String.raw` blocks); `window.OVERVIEW_DATA` object with `tasks: [...]`, `workstream`, `sizeBucket`, `cadence`, `effort`, `lastTouched`, `periodic`, `risk`, `spawnedFrom`, `phaseTree`, `runs`, `generatedAt`, `generatedFromCommit`. Sample task object includes nested `kanbanCards` (with HTML, `insertBeforeTaskId`, `order`), `command` (with `planPrompt`), and quoted-string fields with `\r\n` line endings. **AST mutation must handle Windows line endings and multi-line nested objects.**
- `.ralph/overview-config.json` — has the extended watcher.ignored patterns the brainstorm calls out.

## Architect Analysis

**Integration points:**
- Tool registration: `server.registerTool('overview.init', schema, handler)` in `server.ts`. Same pattern as existing 17 tools.
- `install-server.ts` is wrong-shape — replace by routing the `install-server` CLI subcommand to the new init engine; delete or stub the file.
- Consumer cwd already correct (`launch.cjs:121`); engine takes explicit `{ cwd }` for clarity.
- Copilot mirror: identify the generator script in `scripts/`; regenerate after every skill edit.

**AST mutation — recommended approach:**
- **Use `@babel/parser` + manual byte-range splicing** (NOT acorn+magic-string). Reason: codebase already uses Babel via `set-override-edit.ts`; adding a competing parser is gratuitous churn. The architect's acorn recommendation was made without seeing the existing prior art.
- Algorithm: parse `plans/overview-data.js`, locate `window.OVERVIEW_DATA = { ... }` AssignmentExpression, find `tasks` ArrayExpression, locate target by `id` string property → splice ONLY that ObjectExpression's byte range. Source outside that range is byte-identical by construction.
- Refuse to mutate tasks containing inline comments (detect via `leadingComments`/`trailingComments` on AST nodes within the target task). Safer than guessing how to round-trip.
- Idempotency: parse the proposed new state and compare AST shape (or normalized JSON) to existing — no-op if equal.
- Refuse to touch `ui.*`, `cadence`, `staticSections`, `kanbanCards`, `phaseTree`, `workstream`, `sizeBucket`, `effort`, `lastTouched`, `periodic`, `risk`, `spawnedFrom`, `runs`. The whitelist of editable per-task fields is finite and lives in the schema.

**Shared engine signature:**
```js
export async function initConsumer({ cwd, dryRun = true, force = false, addPackageJsonScripts = false }) {
  // returns { ok, filesWritten[], filesSkipped[], errors[], summary }
}
```

**First-run detection:**
- Add a `checkConsumerInitialized(repoRoot)` helper. Required artifacts: `plans/overview-data.js`, `.ralph/overview-config.json`, `.mcp.json` containing the `ralph-overview` key, `.claude/settings.json:enabledMcpjsonServers` listing `ralph-overview`.
- `overview.list_tasks` and `overview.dev_server.status` return a structured `{ ok: false, code: 'consumer-not-initialized', suggestedTool: 'overview.init', missing: [...] }` when probe fails. Existing snapshot-missing errors stay distinct.

**Test fixture strategy:**
- Temp dir per test via `fs.mkdtemp()`.
- Stage a copy of `codexu/plans/overview-data.js` as a fixture under `tools/overview-mcp/src/__tests__/fixtures/` (or `tools/overview-mcp/test-fixtures/`) so byte-identical-diff assertions can run against real shape. Sanitize identifying strings if needed.
- 6 required cases — see Acceptance Criteria.

## Codex Research

Concurs on most points. Key additions:
- Node `>=20.0.0`; package manager is **npm**, not pnpm. The brainstorm's `pnpm sync-ralph-state` phrasing is wrong — the actual call is `syncNow(context)` (in-process) or `node bin/ralph-overview.mjs sync` (CLI).
- `install-server.test.ts` expects `settings.local.json` + `codexu-overview`; source writes `settings.json` + `ralph-overview`. Stale expectations must be reconciled.
- `dev-server.test.ts` expects `pnpm overview`; source uses dispatcher. Stale.
- `sync-now.test.ts` may have similar drift; verify during implementation.
- `loadConfig()` defaults to `.ralph/overview-config.json` — init must NOT depend on it pre-existing. Construct context in `overview.init` with a "no-config-yet" mode.

## Copilot Research

Concurs. Key additions:
- Templates may NOT contain consumer-specific defaults (CLAUDE.md invariant 1 — UI copy lives in consumer `overview-data.js:ui.*`, not plugin).
- Config array merge replaces defaults, so scaffolded `watcher.ignored` must include ALL the broad ignore patterns from `scripts/lib/default-config.mjs`. Currently the template is missing some.
- Consumer entry MUST go through `bin/ralph-overview.mjs`, not internal script paths. CLI subcommand `init` is mandatory; even the MCP tool wraps `initConsumer()` from `scripts/init-consumer.mjs` directly (no path traversal into private scripts).
- Existing AST edit utilities use Babel parser only — no `@babel/traverse`/`@babel/generator`. Reuse the pattern.

## Consensus

All 4 reviewers converged on:
1. Shared engine at `scripts/init-consumer.mjs`, three thin surfaces (MCP / CLI / skills).
2. Use **Babel** for AST mutation (matches `set-override-edit.ts`).
3. `install-server.ts` is wrong-shape; replace/deprecate.
4. Reuse `scripts/lib/atomic-write.mjs` for all writes.
5. Call `syncNow(context)` after upsert (in-process), not a shell-out.
6. Six required test cases (empty, merge, partial, upsert-byte-identity, --force, Windows EPERM).
7. Templates need the watcher.ignored patches.

## Divergences

- Architect picked acorn+magic-string; Codex/Copilot picked Babel. **Decision: Babel** (matches existing pattern, no new dep, cheaper review).
- Architect suggested 5 implementation phases over 3 weeks. Ralph stories will be more granular but the sequencing is sound: foundation engine → MCP wrapper → skills → AST → release.

## Consolidated File List

**Files to create:**
- `plugins/ralph-overview/scripts/init-consumer.mjs` — shared engine.
- `plugins/ralph-overview/scripts/lib/upsert-task-edit.mjs` — AST mutator (mirrors `set-override-edit.ts`).
- `plugins/ralph-overview/scripts/lib/check-initialized.mjs` — first-run probe helper.
- `plugins/ralph-overview/tools/overview-mcp/src/tools/init.ts` — MCP tool `overview.init`.
- `plugins/ralph-overview/tools/overview-mcp/src/tools/upsert-task.ts` — MCP tool `overview.upsert_task`.
- `plugins/ralph-overview/skills/overview-init/SKILL.md`
- `plugins/ralph-overview/skills/overview-add-task/SKILL.md`
- `plugins/ralph-overview/skills/overview-edit-task/SKILL.md`
- `plugins/ralph-overview/skills/overview-set-status/SKILL.md`
- `plugins/ralph-overview/tools/overview-mcp/src/__tests__/init.test.ts`
- `plugins/ralph-overview/tools/overview-mcp/src/__tests__/upsert-task.test.ts`
- `plugins/ralph-overview/tools/overview-mcp/test-fixtures/overview-data.rich.js` — sanitized codexu-style fixture.
- `plugins/ralph-overview/scripts/__tests__/init-consumer.test.mjs` (if scripts has a test harness) OR integrate into MCP test suite.
- Corresponding `dist/copilot/` mirror artifacts (generated).

**Files to modify:**
- `plugins/ralph-overview/tools/overview-mcp/src/server.ts` — register 2 new tools + add `consumer-not-initialized` probe to `list_tasks` and `dev_server.status`.
- `plugins/ralph-overview/tools/overview-mcp/src/schemas.ts` — add `overviewInitInputSchema`, `overviewUpsertTaskInputSchema`.
- `plugins/ralph-overview/tools/overview-mcp/src/install-server.ts` — replace body with a redirect/deprecation to `scripts/init-consumer.mjs`, OR delete and re-route the `install-server` CLI subcommand.
- `plugins/ralph-overview/tools/overview-mcp/src/__tests__/install-server.test.ts` — fix stale expectations (`settings.local.json` → `settings.json`, `codexu-overview` → `ralph-overview`), update to new shape `.mcp.json + enabledMcpjsonServers`.
- `plugins/ralph-overview/tools/overview-mcp/src/__tests__/dev-server.test.ts` — fix stale `pnpm overview` expectation.
- `plugins/ralph-overview/bin/ralph-overview.mjs` — add `init` subcommand.
- `plugins/ralph-overview/templates/overview-config.template.json` — add missing watcher.ignored patterns.
- `plugins/ralph-overview/.claude-plugin/plugin.json` — version bump.
- `plugins/ralph-overview/CHANGELOG.md` — new version entry.
- `plugins/ralph-overview/CLAUDE.md` — document init engine, upsert constraints, agent-driven flow.
- `D:/ai-developer-toolkit/CLAUDE.md` — update ralph-overview entry in "Active Tools".
- `D:/ai-developer-toolkit/.claude-plugin/marketplace.json` — version bump.
- `D:/ai-developer-toolkit/.github/plugin/marketplace.json` — version bump.
- `D:/ai-developer-toolkit/.agents/plugins/marketplace.json` — version bump.

**Files as reference (do not modify):**
- `D:/harness-efforts/codexu/plans/overview-data.js`
- `D:/harness-efforts/codexu/.mcp.json`
- `D:/harness-efforts/codexu/.claude/settings.json`
- `D:/harness-efforts/codexu/.ralph/overview-config.json`

**Docs to update:**
- Plugin `CLAUDE.md`, plugin `CHANGELOG.md`, plugin `docs/installation.md` (mention agent-driven flow as primary), toolkit-root `CLAUDE.md`.
