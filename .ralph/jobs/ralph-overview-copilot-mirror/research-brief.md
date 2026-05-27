# Research Brief — ralph-overview Copilot Mirror

## Researcher Findings

(Full agent transcript inlined below; key items called out here.)

- `plugins/ralph-overview/` is a workspace-style plugin (root `package.json` v1.0.0 + 2 workspaces: `tools/overview-mcp/` TS, `tools/overview-viewer/` React 19 + Vite 8).
- Claude-side metadata: `.claude-plugin/plugin.json` v2.0.3, `.mcp.json` declaring stdio MCP via `node ${CLAUDE_PLUGIN_ROOT}/launch.cjs`.
- `launch.cjs` stages source to `~/.cache/ralph-overview-mcp/<version>/`, runs `npm install` + build, spawns `node dist/index.js`. **Engine-agnostic**.
- **Source-of-truth skills (4)**: `skills/{work-on,triage,blocker-report,overview-init}/SKILL.md`.
- **MCP server (`tools/overview-mcp/src/server.ts`) registers 5 tools** (confirmed via direct read at HEAD `bd94fc67`):
  1. `overview.init` → `registerInitTool`
  2. `overview.validate_data` → `registerValidateDataTool`
  3. `overview.parallel_ready_tasks` → `registerParallelReadyTasksTool`
  4. `overview.dev_server.start` → `registerDevServerStartTool`
  5. `overview.dev_server.stop` → `registerDevServerStopTool`
  The original prompt listed 4 tools (omitting dev_server.stop and using a stale `dev_server_start` name); **the plan corrects this to 5 tools with their canonical dotted names**.
- Codex flagged that `overview.dev_server.start` is reportedly removed in v2.1.0 and replaced by `overview.watcher_status` — **NOT confirmed against local HEAD**. Source still shows dev_server registrations. Plan assumes 5 tools per actual source; pre-impl member should re-verify.
- **`generate-copilot-artifacts.mjs` already exists** at `plugins/ralph-overview/scripts/generate-copilot-artifacts.mjs` (118 lines, full content inspected). It currently targets `dist/copilot/<skill>/SKILL.md`. Substitutions: 5 rules (ralph-skill-dispatch, local-skill-dispatch, options-no-question, options-tags, mcp-tools). **Critical**: the `renderLocalSkillDispatch` function hardcodes the path `plugins/ralph-overview/dist/copilot/${name}/SKILL.md` inside the substituted `task(...)` prompt — must be updated when output moves.
- Ralph's generator (`plugins/ralph/scripts/generate-copilot-artifacts.mjs`, 308 lines) is the mature reference: 18 substitution rules, agents + internal-workflows + user-skills, forbidden-token assertions, `--check` mode.

## Architect Analysis

- **Watcher auto-start**: handled by `WatcherSupervisor` in `tools/overview-mcp/src/watcher-supervisor.ts`, invoked on MCP boot from `tools/overview-mcp/src/index.ts` (line 49: `await watcherSupervisor.start()`). This is transport-agnostic and works under any MCP host (Claude or Copilot). The Vite-side `ralphStateWatcherPlugin` in `tools/overview-viewer/vite.config.ts` is HMR-only and is irrelevant to Copilot.
- **Engine-agnostic binary**: `launch.cjs` does not depend on a Claude-specific runtime; Copilot can spawn the same process via the same `.mcp.json` if Copilot picks it up.
- **MCP server context resolution**: `tools/overview-mcp/src/context.ts` reads `OVERVIEW_REPO_ROOT` env or falls back to `git rev-parse --show-toplevel` from cwd. Works the same way under Copilot.
- **Lease guards** (`.ralph/overview-watcher.owner` via `scripts/lib/sync-lock.mjs`) prevent two watchers running concurrently — single MCP server per workspace is enforced even if both Claude + Copilot try to start. Verified in `feedback_overview_reset` skill design.
- **Port collision**: `overview.dev_server.start` hardcodes port 5173 — minor risk if both Claude+Copilot run dev server simultaneously. Out of scope for v2.4.0.
- Architect's recommendation: **port ralph's pattern, NOT extract to shared lib**. Premature abstraction; ralph + ralph-overview have orthogonal output sets.

## Codex Research

- **Copilot CLI MCP config sources** (per local `copilot mcp --help`):
  - User: `~/.copilot/mcp-config.json`
  - Workspace: `.mcp.json` (auto-picked-up)
  - Installed plugins with MCP servers
- Confirmed via `copilot mcp list --json`: workspace `.mcp.json` already works for codexu, but ralph-overview not visible because it's not declared at the plugin-manifest level.
- **Plugin-installed MCP registration**: Copilot manifest at `.github/plugin/plugin.json` supports `"mcpServers": ".mcp.json"` field with `${CLAUDE_PLUGIN_ROOT}` / `${PLUGIN_ROOT}` expansion.
- **No `.copilot-plugin/plugin.json`** — that path does NOT exist as a convention. Crews and ralph both use `.github/plugin/plugin.json`. **The prompt's file list (item 4: `.copilot-plugin/plugin.json`) is incorrect** and must be corrected to `.github/plugin/plugin.json` in the plan.
- Codex says `ralph-overview` is at v2.3.0 at commit `0493680c` and `dev_server.start` removed in v2.1.0 — local HEAD shows v2.0.3 and dev_server still present. **Treat as ambiguous; plan instructs impl member to re-verify before assuming tool list.**
- Install verification: `copilot plugin install ralph-overview@ai-developer-toolkit` and `copilot plugin list` / `copilot mcp list --json`.

## Copilot Research

- Confirms `.github/plugin/plugin.json` is the Copilot manifest (NOT `.copilot-plugin/plugin.json`).
- Confirms 5 MCP tools (not 4) in `server.ts` at local HEAD.
- Flags that ralph-overview skills reference `ralph-overview sync` / `ralph-overview cli` as if it's on PATH — but the plugin does NOT add the binary to PATH. Copilot variants should either use `node <pluginRoot>/bin/ralph-overview.mjs ...` or document a resolver.
- Recommends: forbidden-token assertions (mirror ralph's generator pattern), keep `dist/copilot` for back-compat only if needed, target `.copilot-plugin/copilot-skills/` for discoverable output.
- Recommends NOT depending on `.claude/settings.json` for Copilot — instead, declare via `.github/plugin/plugin.json`.

## Consolidated File List

### Files to modify

- `D:/ai-developer-toolkit/plugins/ralph-overview/scripts/generate-copilot-artifacts.mjs` — change output target from `dist/copilot/` to `.copilot-plugin/copilot-skills/`; update hardcoded path inside `renderLocalSkillDispatch`'s prompt template; add forbidden-token assertion (mirror ralph's generator); decide whether to keep dist/copilot writes for back-compat (recommend: drop).
- `D:/ai-developer-toolkit/plugins/ralph-overview/.claude-plugin/plugin.json` — version 2.0.3 → 2.4.0.
- `D:/ai-developer-toolkit/plugins/ralph-overview/CHANGELOG.md` — add `## [2.4.0] — 2026-05-27` entry, Keep-a-Changelog format (matches existing v2.0.2/2.0.1 style).
- `D:/ai-developer-toolkit/plugins/ralph-overview/README.md` — add Copilot installation section.
- `D:/ai-developer-toolkit/.claude-plugin/marketplace.json` — bump ralph-overview entry 2.0.3 → 2.4.0.
- `D:/ai-developer-toolkit/.github/plugin/marketplace.json` — bump ralph-overview entry 2.0.3 → 2.4.0.
- `D:/ai-developer-toolkit/.agents/plugins/marketplace.json` — bump ralph-overview entry 2.0.3 → 2.4.0.
- (Optional) `D:/ai-developer-toolkit/plugins/ralph-overview/package.json` — bump root workspace version 1.0.0 → 2.4.0 for alignment (currently misaligned; not strictly required).

### Files to create

- `D:/ai-developer-toolkit/plugins/ralph-overview/.github/plugin/plugin.json` — Copilot manifest with `"skills": ".copilot-plugin/copilot-skills/"` and `"mcpServers": ".mcp.json"`.
- `D:/ai-developer-toolkit/plugins/ralph-overview/.copilot-plugin/copilot-skills/work-on/SKILL.md` (generated).
- `D:/ai-developer-toolkit/plugins/ralph-overview/.copilot-plugin/copilot-skills/triage/SKILL.md` (generated).
- `D:/ai-developer-toolkit/plugins/ralph-overview/.copilot-plugin/copilot-skills/blocker-report/SKILL.md` (generated).
- `D:/ai-developer-toolkit/plugins/ralph-overview/.copilot-plugin/copilot-skills/overview-init/SKILL.md` (generated).
- `D:/ai-developer-toolkit/plugins/ralph-overview/.copilot-plugin/parity-exceptions.json` — empty or minimal; needed only if hand-edits expected (probably empty for v2.4.0).

### Files to delete (cleanup)

- `D:/ai-developer-toolkit/plugins/ralph-overview/dist/copilot/` — superseded by `.copilot-plugin/copilot-skills/`. **Open question**: keep for one release as a compat shim, or drop in v2.4.0?

### Reference files (don't modify)

- `D:/ai-developer-toolkit/plugins/ralph/scripts/generate-copilot-artifacts.mjs` — mature generator pattern.
- `D:/ai-developer-toolkit/plugins/ralph/.github/plugin/plugin.json` — Copilot manifest shape.
- `D:/ai-developer-toolkit/plugins/ralph/.copilot-plugin/parity-exceptions.json` — example structure.
- `D:/ai-developer-toolkit/plugins/crews/.github/plugin/plugin.json` — alternate manifest shape with hooks.
- `D:/ai-developer-toolkit/plugins/ralph-overview/skills/*/SKILL.md` — source-of-truth skills (DO NOT edit during impl; only the generator reads them).
- `D:/ai-developer-toolkit/plugins/ralph-overview/CLAUDE.md` — currently says "dist/copilot is the mirror dir"; this guidance must be UPDATED as part of the plan (treat as a doc to modify).
- `D:/ai-developer-toolkit/plugins/ralph-overview/.mcp.json` — already correct, no changes needed.
- `D:/harness-efforts/codexu/.claude/settings.json` — consumer-side; no changes needed for this plan.

## Key insights / corrections to the original prompt

1. **MCP tool count is 5, not 4.** Original task said: `overview_parallel_ready_tasks, overview_dev_server_start, overview_init, overview_validate_data`. Actual source registers all 5: init, validate_data, parallel_ready_tasks, dev_server.start, dev_server.stop. The canonical names use dotted notation.
2. **Copilot plugin manifest is at `.github/plugin/plugin.json`, NOT `.copilot-plugin/plugin.json`.** This is the convention used by ralph and crews. The original prompt's file list item 4 (new `.copilot-plugin/plugin.json`) is wrong.
3. **The generator already exists** — task description implied it was "new"; in reality it needs to be REFACTORED to write to `.copilot-plugin/copilot-skills/` instead of `dist/copilot/`, and the hardcoded path in `renderLocalSkillDispatch` must move too.
4. **`scripts/install-copilot-mcp.mjs` not needed.** Copilot CLI auto-discovers workspace `.mcp.json` and plugin-declared `mcpServers`. The optional installer the prompt suggested adds maintenance burden without clear value.
5. **Three marketplace indexes need version bumps**, not just the plugin manifest.
6. **`plugins/ralph-overview/CLAUDE.md`** currently documents `dist/copilot/` as the mirror location — must be updated.
