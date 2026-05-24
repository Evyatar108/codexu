# Code Review Context — overview-install-streamline

Patterns and conventions observed during code review of the ralph-overview v1.1.0 changes.

## Codebase conventions
- **`asSdkInputSchema()` cast** in `tools/overview-mcp/src/schemas.ts` is a runtime no-op cast from a plain zod shape object to the MCP SDK's `ZodRawShapeCompat`. Every MCP tool registration uses this pattern. The cast bypasses strict-mode enforcement at the SDK layer — strict variants live as parallel `*Schema` exports for parsing/validation outside the registration boundary.
- **`atomicWriteFile()`** under `scripts/lib/atomic-write.mjs` is the universal write helper. Both engine paths (init-consumer.mjs, upsert-task.ts) route through it for Windows EPERM/EBUSY retry. Direct `fs.writeFile` calls are reserved for tests.
- **Bin dispatcher subcommands** parse `--repo` / `--cwd` (alias) interchangeably for `parseRepoArgs` and `parseInitArgs`. The `install-server` subcommand is a passthrough to the built JS that has its own narrower parser (only `--print-only`).
- **Engine result shape**: `{ ok, filesPlanned, filesWritten, filesSkipped, errors, summary }`. The CLI prints either `summary` (default) or the full JSON envelope (`--json`); the MCP tool returns the envelope verbatim. install-server.ts wraps engine and additionally returns `{ settingsPath, settings }`.
- **First-run probe pattern**: `checkConsumerInitialized()` returns `{ initialized, missing }`. Consumer-reading tools check this at handler entry and short-circuit with `{ ok: false, code: 'consumer-not-initialized', suggestedTool: 'overview.init', missing }` (the `consumerNotInitialized()` helper in `read-only.ts`). Wired into `overview.list_tasks` and `overview.dev_server.status`; other reading tools (get_task, next_command, list_recommendations, etc.) still fall through to a generic 'missing snapshot' error per plan-review F-014 (Medium, soft-cap).
- **Whitelist enforcement** in `upsert-task-edit.mjs` uses zod `.strict()` on a fixed shape of allowed fields. The schema rejects `ui.*` and `staticSections.*` mutations by construction.

## File relationships
- `scripts/init-consumer.mjs` is shared by three call sites: CLI (`bin/ralph-overview.mjs init`), MCP tool (`tools/init.ts`), and install-server (`tools/overview-mcp/src/install-server.ts` with `serverOnly: true, force: true`). The install-server preview path (`previewSettings`) re-reads `.claude/settings.json` directly rather than going through the engine, which means a future engine-side change to `enabledMcpjsonServers` semantics has to be mirrored in `previewSettings` to keep the preview accurate.
- `scripts/lib/upsert-task-edit.mjs` ships paired `.d.mts` declarations consumed by `tools/overview-mcp/src/tools/upsert-task.ts`. The TS strict mode requires these declarations; missing them would break `tsc -p tools/overview-mcp/tsconfig.json`.
- `dist/copilot/<skill>/SKILL.md` mirrors are gitignored at the toolkit level (`dist/`) — they must be force-added via `git add -f` because the plugin intentionally ships them. Same applies to `bin/`.

## Cross-cutting concerns observed
- **MCP tool count is documented in three places**: plugin/CLAUDE.md (line 8), plugin README, tools/overview-mcp/README — all updated to 19 in US-005.
- **Marketplace lockstep** is enforced via three indexes (`.claude-plugin/marketplace.json`, `.github/plugin/marketplace.json`, `.agents/plugins/marketplace.json`). The `.agents/plugins/` index uses a different shape (`source: { source: "local", path: ... }`) and gained the `version` field in this release.
- **Schema duality**: `*InputSchema` (plain object for SDK registration) vs `*Schema` (strict zod for parsing). Tests assert strictness through the strict variant, not the SDK-registered shape — see F-006 for the resulting coverage gap.
- **Soft-cap state inheritance**: The plan landed with 8 Medium and 1 Low plan-review findings open per plan.md's "Remaining Medium-severity review findings" section (F-012 through F-020). Some of these recur in code-review findings (F-013 install-server --repo aliasing already exists; F-014 first-run probe limited coverage; F-017 watcher.ignored full DEFAULT_IGNORED coverage actually got addressed via the new unit test in init-consumer.test.ts:111-118; F-019 conflict refusal still missing → my F-003).

## Notable safety patterns
- Force semantics partition: `--force` overwrites scaffold templates only (`plans/overview-data.js`, `.ralph/overview-config.json`); registration files (`.mcp.json`, `.claude/settings.json`) always safe-merge regardless. install-server.ts uses `force: true` because it's invoking the engine in `serverOnly: true` mode where no scaffold templates are touched.
- `JSON.stringify(current) === JSON.stringify(next)` is the idempotency check in `planJsonMutation`. Key-order-sensitive — survives because JS preserves insertion order through spread + assignment. A consumer file whose mcpServers entry was originally written out-of-canonical-order would force a rewrite on first init, but subsequent runs would match.
- `findPropertyInsertionOffset` in `upsert-task-edit.mjs` walks past whitespace and conditionally consumes a trailing comma, so the mutator behaves correctly whether the existing array uses trailing commas or not.
