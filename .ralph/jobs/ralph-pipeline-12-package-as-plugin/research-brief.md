# Research Brief — Plan 12 (Extract ralph-overview plugin)

Compiled from 4 parallel research agents: Claude researcher (file inventory), Claude architect (extraction strategy), Codex (engineering analysis), Copilot (cross-codebase verification).

---

## Researcher Findings — File Inventory (verified against disk)

### scripts/lib/ — plan enumerates 18 files; actual is 28 .mjs + 24 .d.mts

**Plan-listed (18, all confirmed exist):**
- derive-ralph-stage.mjs (35), derive-next-command.mjs (207), sync-core.mjs (552), sync-lock.mjs (195), watch-ralph-state.mjs (286), score-recommendations.mjs (142), derive-dependency-graph.mjs (85), parse-notepad.mjs (186), derive-pr-links.mjs (47), append-journal.mjs (137), emit-snapshot.mjs (70), emit-activity.mjs (80), emit-tasks-index.mjs (87), emit-snapshot-schema.mjs (43), crews-cross-walk.mjs (81), parse-spawn-launcher.mjs (98), resolve-config.mjs (79), default-config.mjs (53)

**Plan-omitted but MUST extract (10 additional):**
- `atomic-write.mjs` (45 lines) — used by overview-mcp/install-server.ts:1
- `path-utils.mjs` (38 lines) — utility imported by multiple modules
- `task-match.mjs` (28 lines) — internal utility
- `emit-derived-artifacts.mjs` (33 lines) — emits recommendations + dependency-graph artifacts (plan mentions outputs but not the module)
- `load-prds-by-task-id.mjs` (28 lines) — helper for derived artifacts
- `derive-next-command-cli.mjs` (34 lines) — CLI wrapper, referenced by skills (`pnpm sync-ralph-state`, `node scripts/lib/derive-next-command-cli.mjs`)
- `work-on-via-crew.mjs` — plugin library surface per Codex
- 21 `.test.mjs` files in scripts/lib/ — not enumerated, decision required (plugin or codexu)
- All 24 `.d.mts` declaration files (1:1 with non-test .mjs)

Total: ~8,790 lines of .mjs to extract from scripts/lib/.

### scripts/sync-ralph-state.mjs
Exists (432 lines).

### tools/overview-mcp/
- package.json name: `@codexu/overview-mcp`
- src/: 15+ TypeScript files, ~2,200 lines + 21 test files
- Build: dist/index.js, fragile cpSync flattens cross-package imports

### tools/overview-viewer/
- package.json name: `@codexu/overview-viewer`
- React 19 + Vite 8 + TypeScript + vite-plugin-singlefile
- src/: 75+ files, ~2,111 lines + 34 test files
- pnpm (workspace member)

### Skills (3, all exist)
- `.claude/skills/work-on/SKILL.md` (188 lines)
- `.claude/skills/triage/SKILL.md` (92 lines)
- `.claude/skills/blocker-report/SKILL.md` (104 lines)

### Consumer-owned (STAY in codexu)
- `.ralph/overview-config.json` (45 lines)
- `.ralph/overview-config.schema.json` (1832 bytes) — current title/id are codexu-specific; plugin template needs scrubbing
- `plans/overview-data.js`
- Generated sidecars + `tasks/<id>/journal.md`

### Cross-package imports
- No external code references `@codexu/overview-mcp` or `@codexu/overview-viewer` outside their own trees — clean rename.
- `tools/overview-mcp/src/` imports 14+ modules via `../../../../scripts/lib/` relative paths.
- `tools/overview-viewer/src/` does NOT import `scripts/lib/` directly (consumes via globals + types from overview-mcp's `types.ts`).

### Codexu root state (verified)
- `package.json` scripts confirmed: `sync-ralph-state`, `sync-ralph-state:watch`, `overview-mcp:build`, `overview-mcp:install`, `overview`, `overview:build`, `overview:build:preview`
- `pnpm-workspace.yaml`: lists both `tools/overview-viewer` and `tools/overview-mcp`
- `.claude/settings.json` exists (NOT `.local`). No overview-mcp MCP entry currently. Plugins section has only `"crews@ai-developer-toolkit": true`.
- **There is NO root `CLAUDE.md` in codexu — the doc to update is `AGENTS.md`** (plan incorrectly references CLAUDE.md).

### Toolbar.tsx hardcoded values (confirmed lines 24-55)
- workstream (8): perf, codex-spec, codex-parity, polish, cleanup, upstream, agent-arch, tooling
- scope (3): 🟦 codexu, 🦀 codex, 📋 bookkeeping
- status (5), cadence (1), ralph stage (9 — from RALPH_STAGE_ORDER constant), size (4) — all generic, NOT codexu-specific

---

## Architect Analysis — Extraction Strategy

### Dependency graph (scripts/lib/) — well-layered, 8 layers

- L0 (leaf utilities): atomic-write, path-utils, task-match, default-config
- L1 (config foundation): resolve-config → default-config
- L2 (emission/parsing — mostly pure): emit-snapshot, emit-snapshot-schema, emit-activity, emit-tasks-index, emit-derived-artifacts, derive-pr-links, derive-dependency-graph, parse-notepad
- L3 (ralph stage): derive-ralph-stage (pure state machine, no internal imports)
- L4: crews-cross-walk → path-utils
- L5 (hub): sync-core → L0-4 (15+ imports). **This is the hub — cannot cherry-pick, moves as a block**
- L5b: sync-lock → path-utils (independent of sync-core)
- L6 (watcher): watch-ralph-state → sync-core + sync-lock + resolve-config + path-utils + emitters
- L7: derive-next-command (pure, no imports) + derive-next-command-cli
- L8 (CLI): sync-ralph-state.mjs → L5/L6

### Three CRITICAL blocking unknowns

1. **MCP server import path post-extraction.** Today `tools/overview-mcp/src/context.ts` and `snapshot-reader.ts` import `../../../scripts/lib/resolve-config.mjs` (4-level reach back). Post-extraction, options:
   - Option A: Plugin layout keeps `tools/overview-mcp/` sibling to `scripts/`. Imports become `../../scripts/lib/...` (3 levels).
   - Option B: Plugin exports config helpers via npm package (`@ralph/overview-core`).
   - Option C: MCP re-exports config helpers from its own entry point.
   **Recommendation: Option A** — simplest, preserves existing test patterns, matches the canonical "plugin-local layout."

2. **Plugin CLI invocation.** Plan suggests wrapper scripts `"overview": "ralph-overview dev"` but `ralph-overview` CLI is NOT defined anywhere. Must add `bin/ralph-overview` shell wrapper that dispatches to `scripts/sync-ralph-state.mjs` (sync mode) and `tools/overview-viewer` (dev mode). Plugin needs subcommands: `ralph-overview sync|watch|dev|build|mcp [--repo <consumerRoot>]`.

3. **MCP server registration mechanism.** Plan's proposed `"mcpServers": {...}` field in `plugin.json` is NOT present in any examined ai-developer-toolkit plugin manifest. Per Codex: canonical pattern is `.claude-plugin/plugin.json` (not top-level) + separate `.mcp.json` using `${CLAUDE_PLUGIN_ROOT}`. See Codex finding below.

### Toolbar.tsx data-driven refactor — clear path

filters.ts already uses `data.workstream`, `data.tasks[].scope` via `parseTaskScope`. Refactor:
- Pass `OverviewData` into `Toolbar` as a prop
- In Toolbar: `useMemo(() => unique sorted workstream values from data.tasks)` and same for scope
- Build `FILTER_GROUPS` dynamically; static groups (status, ralph stage, size, cadence) stay hardcoded since they're generic
- Caveats: ordering instability (sort alphabetically), empty-data initial render (allow empty chip array), label derivation (use raw value if no label map provided)

### Two-repo merge ordering — fragile

- Plugin commits to `ai-developer-toolkit/add-ralph-overview-plugin`; merges first.
- Codexu PR depends on plugin being on main. Need PR description gate or CI check.
- Verify whether `claude-code` plugin marketplace supports branch-pinning (`ai-developer-toolkit:ralph-overview@<branch>`) — if not, must merge plugin first.

### Migration order recommended changes

- Keep plan order (prep → shell → copy → rename → toolbar refactor → isolation test → migrate → verify) but **add a Vite isolation smoke test BEFORE Toolbar refactor** so a broken extraction doesn't get conflated with a broken refactor.

---

## Codex Research — Toolkit Convention Verification

### Plugin manifest shape — CANONICAL is `.claude-plugin/plugin.json` (NOT top-level)

Existing plugins live at `D:\ai-developer-toolkit\plugins\<name>\.claude-plugin\plugin.json`. Canonical fields are limited:
```json
{ "name", "description", "version", "author": {"name"}, "keywords": [] }
```

MCP servers are registered via a **separate** `.mcp.json` at plugin root, using `${CLAUDE_PLUGIN_ROOT}` placeholder for plugin-relative paths. Codex consumers use parallel `.codex-plugin/plugin.json` + `.mcp.codex.json`.

Marketplace registration: add entry to `D:/ai-developer-toolkit/.claude-plugin/marketplace.json` with `{ name, source, description, version }` — e.g., the ralph-orchestration entry at lines 71-75.

**Plan's proposed top-level `plugin.json` with `skills`/`mcpServers`/`consumerSetup` is WRONG for this toolkit.** Must use canonical shape.

### Vite config hardcoding — codexu-relative paths

`tools/overview-viewer/vite.config.ts` hardcodes:
- `../../plans` (consumer data dir)
- `../../scripts/lib/watch-ralph-state.mjs` (cross-package import)
- `outDir: '../../plans'` (consumer artifact dir)
- `server.fs.allow: [__dirname, '../../plans']`

Plugin Vite config must become config-driven: resolve consumer `repoRoot` from `--repo` arg or env or cwd's git root, call `loadConfig()`, derive paths.

### MCP operational tools hardcode codexu commands

- `dev-server-start.ts` spawns `pnpm overview` in consumer repo
- `build.ts` spawns `pnpm overview:build`
- `sync-now.ts` spawns `node scripts/sync-ralph-state.mjs`
- `install-server.ts` registers server name `codexu-overview` pointing at `repoRoot/tools/overview-mcp/dist/index.js`

Post-extraction, these must call the plugin CLI (`ralph-overview sync --repo <repoRoot>` etc.) and install-server must register from plugin path.

### Codexu-specific UI text/copy (additional scrubbing needed)

Beyond Toolbar.tsx, the following contain codexu-specific copy that needs generalization or fallback-driving:
- `App.tsx` — title `codexu — plan overview`
- `StaticSections.tsx`, `TaskCommand.tsx`, `PhaseTree.tsx`
- `data/copyPreambles.ts` — copy-command templates

Suggestion: make title and scope labels config-driven via `data.ui.title` etc., with codexu-specific values living in `plans/overview-data.js` (consumer-curated).

### Skills generalization

`.claude/skills/{work-on,triage,blocker-report}` hardcode `plans/*` paths, `pnpm sync-ralph-state`, and `node scripts/lib/derive-next-command-cli.mjs`. Pluginized versions must call the plugin CLI instead.

### default-config.mjs

Exports symbol named `codexuDefaultConfig` — rename to generic `defaultOverviewConfig` (or similar) during extraction.

### Root doc

`AGENTS.md` (NOT `CLAUDE.md`) is the doc to update. Currently points at `scripts/lib/watch-ralph-state.mjs` and `pnpm sync-ralph-state:watch`.

### Sidecar contract

Viewer executes `overview-data.js` and `overview-ralph-state.js` via `new Function` to populate `window.OVERVIEW_DATA` / `window.OVERVIEW_RALPH_STATE`. Plugin MUST preserve this contract — the viewer's loader code cannot change.

### Activity reader AGENTS.md guarantee

`useActivityEvents.ts` already implements the AGENTS.md rule: skip malformed final JSONL line silently, warn only for malformed interior lines. Preserve this in extraction.

### `resolveCrewsRoot` git-worktree behavior

Intentionally resolves `.crews` relative to git common root for linked worktrees. Plugin extraction MUST preserve this — do not simplify.

### Watcher/CLI shared lock

`.ralph/overview-sync.lock` is shared between watcher, CLI, and MCP tools. `readLockStatus` reads it. Preserve JSON shape + process labels.

---

## Copilot Research — Consumer-Side Verification

(Codex's findings are corroborated; Copilot adds cross-codebase verification of the same seams.)

### Confirmed codexu seams

- pnpm@10.11.0 monorepo, two overview tools in `package.json` + `pnpm-workspace.yaml`
- `.ralph/overview-config.schema.json` title/id are codexu-specific; downstream keys shipped: `crewsRoot`, `recommendations`, `recommendationsJson`, `dependencyGraphJson`, activity rotation. Plugin template must include all.
- `tools/overview-viewer/src/utils/filters.ts` already uses `data.workstream`, `data.sizeBucket`, `data.cadence`, `parseTaskScope` — this is the natural source for data-driven chips. **Refactor target is clearer than plan suggests.**

### Toolbar refactor specifics

Pass `OverviewData` into `Toolbar`/`FilterChips`. Derive:
- Workstream: unique non-empty `data.workstream` values (it's an OBJECT field, per filters.ts — read keys via `Object.keys(data.workstream || {})`)
- Scope: `parseTaskScope(data.tasks[i].scope)` for each task, deduplicated
- Add tests with non-codexu values to verify the refactor.

### Toolkit not accessible to Copilot

Copilot could not access `D:/ai-developer-toolkit` from its session — relies on Claude researcher + Codex for manifest verification. Both agree on canonical `.claude-plugin/plugin.json` + separate `.mcp.json`.

---

## Consolidated File List (deduplicated, grouped by relevance)

### Files to extract from codexu (full block — corrects plan omissions)

**scripts/lib/ — 28 .mjs + 24 .d.mts:**
atomic-write, append-journal, crews-cross-walk, default-config, derive-dependency-graph, derive-next-command, derive-next-command-cli, derive-pr-links, derive-ralph-stage, emit-activity, emit-derived-artifacts, emit-snapshot, emit-snapshot-schema, emit-tasks-index, load-prds-by-task-id, parse-notepad, parse-spawn-launcher, path-utils, resolve-config, score-recommendations, sync-core, sync-lock, task-match, watch-ralph-state, work-on-via-crew (Codex-flagged) — plus matching `.d.mts` for each non-test `.mjs`.

**scripts/sync-ralph-state.mjs** (432 lines)

**tools/overview-mcp/** (full tree, package renamed to `@ralph/overview-mcp`)

**tools/overview-viewer/** (full tree, package renamed to `@ralph/overview-viewer`)

**.claude/skills/{work-on,triage,blocker-report}/SKILL.md**

**Tests: 21 in scripts/lib/, 21 in overview-mcp, 34 in overview-viewer** — decision required on placement (plugin vs codexu)

### Files to modify in codexu

- `package.json` (root scripts), `pnpm-workspace.yaml`, `AGENTS.md` (NOT CLAUDE.md), `.claude/settings.json` (NOT settings.local.json)

### Files to consult / mirror

- D:/ai-developer-toolkit/plugins/crews/.claude-plugin/plugin.json (canonical shape)
- D:/ai-developer-toolkit/plugins/ralph/.claude-plugin/plugin.json (skills layout)
- D:/ai-developer-toolkit/plugins/seval/.claude-plugin/plugin.json (MCP server example, `.mcp.json` shape)
- D:/ai-developer-toolkit/.claude-plugin/marketplace.json (registration)

### Files to create in plugin (D:/ai-developer-toolkit/plugins/ralph-overview/)

`.claude-plugin/plugin.json`, `.mcp.json`, `(optional) .codex-plugin/plugin.json + .mcp.codex.json`, `bin/ralph-overview` (CLI dispatcher), `scripts/lib/* + sync-ralph-state.mjs` (copied), `tools/overview-mcp/` (copied + renamed + import paths fixed), `tools/overview-viewer/` (copied + renamed + Vite config genericized + Toolbar refactored + UI strings audited), `skills/{work-on,triage,blocker-report}/SKILL.md` (copied + CLI calls updated), `docs/{installation,configuration,extending}.md`, `templates/{overview-config.template.json,overview-config.schema.json,overview-data.template.js}`, `README.md`, `package.json` (workspace member), maybe `tsconfig.json` if pattern requires.
