# Research Brief: ID-scoped data.json write tooling + lazy read projections (D-001)

## Researcher Findings
- `.ralph-overview/data.json` top-level keys: `ui, generatedAt, generatedFromCommit, tasks, phaseTree, lastTouched, periodic, cadence, runs, effort, risk, workstream, sizeBucket, spawnedFrom`.
- Task object fields: `id, scope, lifecycle, status, lastTouchedAt, kanbanCards[{className,html}], command{name,descriptionHtml,warnings,prompts{brainstorm,plan,impl}}, shipManifest{shippedAt,summary,commits[{sha,oneLine,repo?}]}`, legacy `mergeCommit`, plus optional `initialStage, blockedOn, members`.
- Counts: **180 tasks** (merged 132 / tracked 36 / archived 12).
- Root `tools/`: only `tools/check-toolkit-submodule-invariants.mjs` present (ESM, run via root `package.json` script `check:toolkit-submodule`). Root `package.json` scripts include `test` (`vitest run`), `overview`, `sync-ralph-state`, `check:toolkit-submodule`. ESM root, pnpm workspace; no codexu-root tool-specific test harness beyond vitest.
- Toolkit `parse-overview-data.mjs`: `parseOverviewDataJson` (JSON.parse + object-root check), `parseOverviewDataJs` (AST literal parser), `parseOverviewData(content,{kind})` dispatcher.
- `sync-core.mjs` read path: `loadOverviewData(dataFile)` reads `.json` via `parseOverviewDataJson` (sync-core.mjs:835-854). `writeSidecar()` → `loadOverviewData` → `emitDerivedArtifacts` → `emitAgentArtifacts` (sync-core.mjs:521-581).
- Emit hook points: `emitAgentArtifacts()` (sync-core.mjs:562-581) writes `snapshotSchema`, `snapshot`, `tasksIndex`; `emitDerivedArtifacts()` (emit-derived-artifacts.mjs:15-52) writes `recommendationsJson`, `dependencyGraphJson`. Output paths all come from `config.outputs.*` (default-config.mjs:10-22).
- MCP server: `createServer()` registers 6 tools (server.ts:12-25). Registration pattern: `server.registerTool(name, {description, inputSchema}, handler)` per `src/tools/*.ts`. `context.ts` resolves `repoRoot`+`pluginRoot`; data.json loaded via `SnapshotReader.getOverviewData()`.
- MCP package: `tools/overview-mcp/package.json` — `"type":"module"`, `build`, `typecheck`, `test` (`vitest run --passWithNoTests`). Own vitest setup + `src/__tests__/`.
- **ralph-overview plugin currently declares NO hooks** in `plugin.json`. Hook prior art is `plugins/options-mode/` (Claude `hooks/hooks.json` + Copilot `.github/plugin/hooks.json` + `hooks/pre-tool-use.js` + `hooks/copilot-pre-tool-use.js`).
- Version/marketplace paths: `plugins/ralph-overview/.claude-plugin/plugin.json`; indexes at `ai-developer-toolkit/.claude-plugin/marketplace.json`, `.github/plugin/marketplace.json`, `.agents/plugins/marketplace.json` (Codex policy enums).

## Architect Analysis
- **Shared-lib placement: Option A** — core mutator lives in the plugin (`plugins/ralph-overview/scripts/lib/data-edit-core.mjs`). Driven by plugin invariant #1 ("No consumer-specific defaults in production code") + #4 ("Bin dispatcher is the only consumer↔plugin boundary"). Option B (lib at codexu root, imported by MCP) breaks the plugin boundary because the MCP server is a marketplace-distributed plugin that cannot import consumer code.
- Mutation-core API: `loadData(path)`, `applyVerb(data, verb, args)`, `validateInvariants(before, after, verb, targetId)`, `serialize(data)`, `atomicWrite(path, serialized)`. Canonical write = `JSON.stringify(data, null, 2)` + trailing newline.
- C-7: `emit-snapshot.mjs:18-38` clones tasks and only conditionally adds `ralph`/`unblockCandidate`; new projections are purely additive — no perturbation of existing `snapshot.json.tasks`.
- Invariants per verb: global (JSON parses, no dup ids, non-empty id); in-place verbs preserve `tasks.length`; target present after write.
- Engine-aware hook outputs: Claude PreToolUse returns `{"decision":"block","reason":...}` (options-mode `hooks/pre-tool-use.js:9-19`); Copilot returns `{permissionDecision:'deny', permissionDecisionReason, decision:'block', reason}` (`hooks/copilot-pre-tool-use.js:48-60`). Target `edit`/`apply_patch` tool calls on `**/.ralph-overview/data.json`, not shell redirection.
- Risks: CLI depends on submodule init; toolkit changes need two commits (submodule then pointer bump); Windows LF stability; watcher depth-cap invariant #14; round-trip test belongs in plugin tests.

## Codex Research
**Failed** — the codex-exec xhigh process hung with its output-capturing wrapper dropped; output never materialized after >5 min (Copilot, launched identically, finished in ~2 min). Stuck process killed. Per skill error-handling, research failure is non-blocking; coverage is provided by the researcher + architect agents + Copilot research + direct grounding.

## Copilot Research
- **CRITICAL constraint:** do NOT use `loadOverviewData()` for write-side edits — it normalizes legacy fields and could rewrite unrelated tasks. Use `parseOverviewDataJson()` for source-preserving mutations, then validate invariants. (This protects C-7 byte-stability and "minimal diff" quality.)
- Recommends: shared mutation engine in plugin (`scripts/lib/data-edit*.mjs`), exposed via BOTH MCP tools AND a `data-edit` subcommand on `bin/ralph-overview.mjs`; codexu `tools/data-edit.mjs` is a thin wrapper around `node bin/ralph-overview.mjs data-edit --repo .` so MCP and CLI stay bit-identical.
- Use file/stdin JSON for large values: `upsert-task --json`, `mark-shipped --summary-file`, `set-prompts --plan-file`. Add a **lock around read-mutate-write** to avoid lost updates, then `atomicWriteFile()`.
- Stripped-projection shape: prefer explicit marker `{ "stripped": true, "approxBytes": N }` over null/omission so consumers can detect projection semantics.
- Hooks: add Claude `hooks/hooks.json` PreToolUse + Copilot `.github/plugin/hooks.json`; inspect edit/apply-patch/shell payloads for `.ralph-overview/data.json` unless the command is the approved helper. A pre-commit check is a useful backstop because hooks cannot catch external-editor edits.
- Docs to update: root `AGENTS.md`, plugin `README.md`, `docs/extending.md`, plugin `AGENTS.md`.

## Direct-grounding facts (verified by the planner)
- **Byte-stability proof:** `JSON.stringify(data, null, 2) + '\n'` is **byte-identical** to the current `data.json` (933,531 bytes, **LF-only, trailing newline**). This is the canonical serialization that makes a no-op helper write produce a zero-byte diff and underwrites C-7.
- `bin/ralph-overview.mjs` resolver cascade (RALPH_OVERVIEW_PLUGIN_ROOT → CLAUDE_PLUGIN_ROOT → ~/.claude cache → ~/.copilot install → in-tree submodule fallback) is the precedent for how a codexu CLI locates the plugin; it SPAWNS the plugin dispatcher (does not import), so a `data-edit` bin subcommand is the natural CLI surface.
- The plugin uses `atomicWriteFile()` (scripts/lib/atomic-write.mjs: tmp + fsync + rename-with-retry) — reuse it for the helper writes.

## Consolidated File List
### ai-developer-toolkit (plugin) — to create
- `plugins/ralph-overview/scripts/lib/data-edit-core.mjs` (shared mutation engine) + `.test.mjs`
- `plugins/ralph-overview/tools/overview-mcp/src/tools/{upsert-task,mark-shipped,set-lifecycle,add-kanban-card,set-prompts}.ts` (or one `data-write.ts`)
- `plugins/ralph-overview/tools/overview-mcp/src/__tests__/data-write-roundtrip.test.ts` (CLI↔MCP parity)
- `plugins/ralph-overview/scripts/lib/emit-projections.mjs` (active-tasks.json + summary-projection.json) + `.test.mjs`
- `plugins/ralph-overview/hooks/hooks.json` + `hooks/pre-tool-use-data-edit.js` (Claude) and `.github/plugin/hooks.json` + `hooks/copilot-pre-tool-use-data-edit.js` (Copilot)
### ai-developer-toolkit (plugin) — to modify
- `plugins/ralph-overview/bin/ralph-overview.mjs` (add `data-edit` subcommand dispatch)
- `plugins/ralph-overview/tools/overview-mcp/src/server.ts` (+ `schemas.ts`) (register 5 write tools)
- `plugins/ralph-overview/scripts/lib/sync-core.mjs` (emitAgentArtifacts → call emit-projections) + `default-config.mjs` (+`resolve-config.mjs` if needed) (new `config.outputs` keys)
- `plugins/ralph-overview/.claude-plugin/plugin.json` (version + hooks decl) ; 3 marketplace indexes ; plugin `AGENTS.md`, `README.md`, `docs/extending.md`
### codexu — to create
- `tools/data-edit.mjs` (thin wrapper → `node bin/ralph-overview.mjs data-edit`)
### codexu — to modify
- `package.json` (add `data-edit` script) ; `.ralph-overview/config.json` (new output paths) ; root `AGENTS.md` (bookkeeper invariants: canonical write/read paths) ; `ai-developer-toolkit` submodule pointer bump
