# Stories Outline: Overview Install Streamline

*Preliminary decomposition from `/plan-with-ralph`. Feed to `/implement-with-ralph --from-plan` for PRD generation.*

## US-001: Copilot mirror generator + init engine + template fix + CLI subcommand

**Description:** As a plugin maintainer, I want a shared `scripts/init-consumer.mjs` engine plus a `ralph-overview`-local Copilot mirror generator and a fixed `overview-config.template.json`, so that agent and CLI flows have one source of truth for scaffolding and so the v5.36.0 mirror-parity gate is satisfied before any new skills are added.

**Acceptance Criteria:**
- [ ] `plugins/ralph-overview/scripts/generate-copilot-artifacts.mjs` exists, supports default drift-check mode and `--write`, and discovers `plugins/ralph-overview/skills/*/SKILL.md` (does not delegate to the Ralph plugin's generator).
- [ ] `plugins/ralph-overview/scripts/init-consumer.mjs` exports `initConsumer({ cwd, dryRun = true, force = false, serverOnly = false, addPackageJsonScripts = false })` returning `{ ok, filesPlanned[], filesWritten[], filesSkipped[], errors[], summary }`.
- [ ] `serverOnly: true` plans ONLY `.mcp.json` + `.claude/settings.json:enabledMcpjsonServers` mutations (skips scaffold templates).
- [ ] `--force` overwrites scaffold templates (`plans/overview-data.js`, `.ralph/overview-config.json`) only; registration files always safe-merge.
- [ ] All writes route through `scripts/lib/atomic-write.mjs` (Windows EPERM/EACCES/EBUSY retry).
- [ ] `bin/ralph-overview.mjs` gains an `init` subcommand: `node bin/ralph-overview.mjs init [--repo <path>|--cwd <path>] [--dry-run] [--force] [--server-only] [--json] [--add-package-json-scripts]`. `--repo` is primary, `--cwd` is alias.
- [ ] `templates/overview-config.template.json` `watcher.ignored` ⊇ `scripts/lib/default-config.mjs:DEFAULT_IGNORED` (unit test imports both and asserts inclusion).
- [ ] Paired `.d.mts` declaration files exist for `scripts/init-consumer.mjs`.
- [ ] Tests cover: empty-repo init, repo-with-existing-`.mcp.json` safe-merge, codexu-like-partial-state idempotency, `--force` scaffold overwrite with registration safe-merge preserved, Windows EPERM atomic-write retry (mock).
- [ ] All three surfaces (engine direct, MCP-tool-shim-stub for parity test, CLI `--json`) produce identical `{ filesPlanned, filesSkipped, errors }` JSON.
- [ ] Typecheck passes (`tsc -p tools/overview-mcp/tsconfig.json`).

**Dependencies:** None
**Estimated complexity:** large

## US-002: AST mutator `upsert-task-edit.mjs` with byte-range splicing

**Description:** As an agent, I want a `scripts/lib/upsert-task-edit.mjs` module that mutates a single task in `plans/overview-data.js` (task ObjectExpression fields and exact entries in supported top-level maps) using `@babel/parser` byte-range splicing, so that ongoing bookkeeping never corrupts hand-curated rich data.

**Acceptance Criteria:**
- [ ] `upsertTaskInSource(source, { id, taskObjectFields, topLevelMapFields }) → { source, changed, action: 'created' | 'updated' | 'noop', editedRanges: Array<{start, end}>}`.
- [ ] Task-object whitelist: `id` (required, immutable after create), `title`, `scope`, `status`, `phase`, `blockedBy`, `mergeCommit`, `lastTouchedAt`, `kanbanCards`, `command`, `runsAfter`, `notes`.
- [ ] Top-level-map whitelist: `workstream`, `sizeBucket`, `risk`, `cadence`, `effort`, `periodic`, `spawnedFrom` (each keyed by task id).
- [ ] Strict Zod schema with no `extras` escape hatch in v1 — unknown fields rejected.
- [ ] Source bytes outside the union of `editedRanges` are byte-identical to input (assertion against `test-fixtures/overview-data.rich.js` sanitized codexu copy).
- [ ] Refuses to mutate tasks containing leading/trailing comments inside the task ObjectExpression; returns clear error.
- [ ] Idempotent: re-running with same payload returns `action: 'noop'` and `changed: false`; source is byte-identical to previous output.
- [ ] Preserves `\r\n` line endings inside string literals.
- [ ] Paired `.d.mts` declaration file exists.
- [ ] Tests cover: update existing task (AC6a), create new task with required-fields + map population + idempotency (AC6b), refuse `ui.*` mutation, refuse on inline comment, byte-identity outside edited ranges.
- [ ] Typecheck passes.

**Dependencies:** None (independent of US-001)
**Estimated complexity:** large

## US-003: MCP tools + first-run probe + install-server reconcile + stale-test fixes

**Description:** As an agent, I want `overview.init` and `overview.upsert_task` MCP tools, a `consumer-not-initialized` first-run signal in consumer-reading tools, and a reconciled `install-server.ts` that preserves the `overview-mcp-install` package bin while writing the new `.mcp.json + enabledMcpjsonServers` shape, so that I can drive the full agent flow from one MCP server with no broken legacy contracts.

**Acceptance Criteria:**
- [ ] `tools/overview-mcp/src/tools/init.ts` wraps `initConsumer()` and returns its result via MCP.
- [ ] `tools/overview-mcp/src/tools/upsert-task.ts` reads `plans/overview-data.js`, calls `upsertTaskInSource()`, writes back via `atomicWriteFile()`, then calls `syncNow(context)`.
- [ ] `tools/overview-mcp/src/schemas.ts` adds `overviewInitInputSchema` and `overviewUpsertTaskInputSchema` (strict, no extras).
- [ ] `tools/overview-mcp/src/server.ts` registers both new tools.
- [ ] `scripts/lib/check-initialized.mjs` exports `checkConsumerInitialized(repoRoot) → { initialized: boolean, missing: string[] }`; paired `.d.mts` declaration exists.
- [ ] `overview.list_tasks` and `overview.dev_server.status` return `{ ok: false, code: 'consumer-not-initialized', suggestedTool: 'overview.init', missing }` when probe fails.
- [ ] `install-server.ts` rewired to call `initConsumer({ ..., serverOnly: true, force: true })`; preserves exported `installServer(options)` API, the `overview-mcp-install` package bin, and `--print-only` (no-write preview).
- [ ] `bin/ralph-overview.mjs install-server` continues delegating to the built installer (semantically equivalent to `init --server-only --force`).
- [ ] Stale tests fixed: `install-server.test.ts` (`settings.local.json` → `settings.json`, `codexu-overview` → `ralph-overview`, new shape + `--print-only` no-write); `dev-server.test.ts` (stale `pnpm overview`); `build.test.ts` (stale `pnpm overview:build`); `stdio-tools-list.test.ts` (17 → 19, add new tool names); `read-only-tools.test.ts` (17 → 19, add new tool names).
- [ ] `npm test --workspace=tools/overview-mcp` passes green.
- [ ] Typecheck passes.

**Dependencies:** US-001, US-002
**Estimated complexity:** large

## US-004: Slash skills + Copilot mirror regeneration

**Description:** As an operator, I want slash skills `/overview-init`, `/overview-add-task`, `/overview-edit-task`, and `/overview-set-status` plus regenerated Copilot mirrors under `dist/copilot/`, so that natural-language commands map to the MCP tools and the v5.36.0 parity gate is satisfied.

**Acceptance Criteria:**
- [ ] Four new SKILL.md files under `plugins/ralph-overview/skills/`, each with the `<!-- ralph-meta {...} -->` HTML-comment metadata block per Section 6.1 resolution B.
- [ ] `/overview-init` instructs the agent to call `overview.init` (dry-run first, confirm, then force if needed).
- [ ] `/overview-add-task`, `/overview-edit-task`, `/overview-set-status` are thin wrappers that call `overview.upsert_task` with opinionated field sets.
- [ ] `node plugins/ralph-overview/scripts/generate-copilot-artifacts.mjs --write` regenerates `dist/copilot/<skill>/SKILL.md` for all 7 skills (3 existing + 4 new).
- [ ] Copilot mirror count = source skill count (7 = 7).
- [ ] Generator drift-check mode (no `--write`) passes.

**Dependencies:** US-003
**Estimated complexity:** medium

## US-005: Docs + version bump + marketplace + release

**Description:** As a maintainer, I want plugin `CLAUDE.md`/`docs/installation.md` updated, the toolkit-root `CLAUDE.md` entry refreshed, the plugin version bumped (1.0.0 → 1.1.0), and the three marketplace indexes synced atomically via `/release-plugin`, so that consumers pick up the new tools and skills via `/plugin update`.

**Acceptance Criteria:**
- [ ] `plugins/ralph-overview/CLAUDE.md` documents the init engine, the upsert constraints (task-object vs top-level-map split), the `consumer-not-initialized` signal, `--force` scaffold-only semantics, and the regenerated `dist/copilot/` mirror.
- [ ] `plugins/ralph-overview/docs/installation.md` mentions the agent-driven flow as primary; manual install stays as fallback.
- [ ] `D:/ai-developer-toolkit/CLAUDE.md` "Active Tools" entry for `ralph-overview` is updated.
- [ ] Tool-count references in `plugins/ralph-overview/README.md`, `plugins/ralph-overview/tools/overview-mcp/README.md`, and `plugins/ralph-overview/CLAUDE.md` are updated from 17 to 19 wherever present.
- [ ] CHANGELOG 1.1.0 entry prepended to `plugins/ralph-overview/CHANGELOG.md`.
- [ ] `/release-plugin` atomically bumps `plugin.json`, the three marketplace indexes (`.claude-plugin/marketplace.json`, `.github/plugin/marketplace.json`, `.agents/plugins/marketplace.json`), creates the commit, and pushes to all configured remotes.
- [ ] All three marketplace indexes carry version 1.1.0 matching `plugin.json`.

**Dependencies:** US-004
**Estimated complexity:** small
