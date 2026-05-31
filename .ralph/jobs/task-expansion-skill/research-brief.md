# Research Brief: task-expansion-skill

## Researcher Findings

Direct inspection by planner of the two repositories implicated by the brainstorm (codexu + ai-developer-toolkit/plugins/ralph-overview). No external research agents spawned — the brainstorm already ran a devil's-advocate lens and the spawn-prompt narrowly specifies file paths, so the unknowns are implementation patterns inside `overview-mcp`, which the planner could read in five direct file views.

### Plugin layout (ai-developer-toolkit/plugins/ralph-overview)

- MCP tool source root: `tools/overview-mcp/src/`
- Existing tools (one file each): `tools/init.ts`, `tools/validate-data.ts`, `tools/parallel-ready-tasks.ts`, `tools/watcher-status.ts`. Each exports `register<Name>Tool(server, context)` and a pure async handler `<name>(context, input)` that returns a `ToolEnvelope<T>`.
- Shared envelope: `tools/envelope.ts` — `ToolEnvelope<T> = { ok: true; data: T } | { ok: false; error: string } | ConsumerNotInitialized`. `toToolResult(value)` wraps the envelope as `{ content: [{ type: 'text', text: JSON.stringify(value, null, 2) + '\n' }] }`.
- Server registration: `src/server.ts` constructs the `McpServer` with `name: '@gim-home/ralph-overview-mcp'`, currently `version: '2.1.0'`, and calls `register<Name>Tool` for each tool. New tools register here.
- Input schema convention: zod raw shape in `src/schemas.ts` (e.g. `parallelReadyTasksInputSchema = { limit: z.number()..., stageFilter: z.array(...).optional() }`); tool file wraps with `z.object(...).strict()` for parsing and `asSdkInputSchema(...)` for the SDK declaration.
- Data access: `context.snapshotReader.getOverviewData()` → `OverviewData | null` (the parsed `.ralph-overview/data.json`); `getSnapshot()` → `Snapshot | null` (includes ralph runtime state per task). Both are cached + chokidar-invalidated. `OverviewData.tasks: OverviewTask[]`.
- Task shape (`tools/overview-viewer/src/types.ts`): `OverviewTask { id, scope?, lifecycle?, status?, lastTouchedAt?, shipManifest? { shippedAt, summary, commits[{sha, oneLine, repo?}] }, kanbanCards?, command? { name, descriptionHtml, warnings?, prompts? { brainstorm?, plan?, impl? } } }`. `SnapshotTask` extends `OverviewTask` and adds `ralph?: RalphPipelineState { stage, jobSlug, artifacts?, ... }` and `initialStage`.
- Build/test scripts (package.json): `pnpm --filter @gim-home/ralph-overview-mcp build`, `... typecheck`, `... test`. Test runner is vitest 4.x; tests live under `src/__tests__/`. Helpers in `__tests__/helpers.ts` provide `setupTempRoot()`, `makeContext()`, `writeOverviewData()`, `writeSnapshot()`.
- Dependencies already present: `@modelcontextprotocol/sdk ^1.23.0`, `zod ^4.1.13`, `chokidar ^5.0.0`. No need to add new runtime deps for v1.

### Skill layout (ai-developer-toolkit/plugins/ralph-overview)

- Two parallel skill trees must be kept in sync: `skills/<name>/SKILL.md` (Claude Code) and `.copilot-plugin/copilot-skills/<name>/SKILL.md` (Copilot CLI). Existing examples: `work-on`, `triage`, `blocker-report`, `overview-init`.
- Skill frontmatter convention: `name: <name>`, `description: > <multi-line summary>`.
- Skill registration in plugin metadata: see `.claude-plugin/plugin.json` and `.copilot-plugin/copilot-plugin.json` — additions there make the skill discoverable to the respective CLI.

### Codexu-side scope (template + example)

- Template path per brainstorm: `.ralph-overview/task-expansion-template.md` (codexu repo).
- Example expansion path: `.ralph/brainstorms/task-expansion-skill/example-expansion.md` (codexu repo).
- No code changes in codexu beyond these two markdown files for v1. `.ralph-overview/data.json` curation (lifecycle flip to `merged`, shipManifest) happens at bookkeeping time after impl ships, not during this plan.
- Validate AC-8 fallback metric by sampling `prerequisitesCandidates` against the first three real tasks during the worked example (US-006); operator-judgment "true vs noise" per candidate.

### Real data sample for heuristic design

`.ralph-overview/data.json` `task-expansion-skill` entry uses `prompts.brainstorm` (single field present) and has `lifecycle: "tracked"`, `scope: "ralph-overview|bookkeeping"`. Other entries (e.g. `impl-mcp-server-notifications`) typically carry one or more of `prompts.{brainstorm, plan, impl}`. Auto-discovery heuristics must operate on whichever subset is populated.

## Architect Analysis

### Integration points

- **Tool registration:** add one line to `src/server.ts` after the existing `register*` calls. No interface change to `McpServer` or `ServerContext`.
- **Data access reuse:** `expand_task_context` consumes `context.snapshotReader.getOverviewData()` + `getSnapshot()` — no new readers, no new chokidar paths.
- **Git log search:** spawn `git log --grep=<taskId> --oneline -20 -- .` via `node:child_process.execFile` from `context.repoRoot`. No new dep. Time-bound the call with a `signal: AbortSignal.timeout(5000)` so a slow/locked repo cannot stall the tool.
- **Filesystem probes:** plan path `<repo_root>/.ralph/jobs/<taskId>/plan.md`, brainstorm path `<repo_root>/.ralph/brainstorms/<taskId>/selected-direction.md`, template path `<repo_root>/.ralph-overview/task-expansion-template.md`. All resolved via `path.join(context.repoRoot, ...)` + `fs.access`. Return `null` on miss, not throw.
- **Tests:** new `src/__tests__/expand-task-context.test.ts` follows the `parallel-ready-tasks.test.ts` setup pattern (setupTempRoot + writeOverviewData + writeSnapshot). Fixtures for prereq heuristic written as ad-hoc strings + small `git init` setup in the temp repo to seed two commits whose messages mention task ids (validates commit-grep) and touch overlapping files (validates prompt-file-overlap).

### Technical constraints

- No prose synthesis in the tool — explicit brainstorm rejection of D-002. Handler does data plumbing + heuristic; agent does authoring.
- All bundle fields documented in brainstorm Scope must be populated or explicitly `null`. Stable shape validated against a strict zod output schema (mirrors `watcherStatusOutputSchema` in `schemas.ts`).
- Cross-engine reach is automatic via MCP layer — both Claude Code and Copilot CLI auto-load `ralph-overview@ai-developer-toolkit` via marketplace registration. No `.mcp.json` change in codexu.

### Suggested implementation approach

- Land the template (codexu) first — it has no dependencies on the tool and unblocks the worked example.
- Then land the tool + heuristics + tests + skill (plugin) as one atomic ralph impl, in the plugin's worktree. Single PRD; the impl-with-ralph member sequences stories internally.
- Worked example + AC-8 metric (codexu) lands after the plugin ships and is installed, so the example invocation hits the real `overview.expand_task_context` tool.

### Risk areas

- **Heuristic noise (AC-8 trigger):** auto-discovered `prerequisitesCandidates` can include unrelated commits/tasks. v1 mitigations: every entry carries `candidate: true` and a `heuristic` field (`"prompt-file-overlap"` or `"commit-message-grep"`); agent prose-filters during synthesis. If first three real tasks exceed 50% noise, surface kind=question to operator per brainstorm AC-8 → pivot to D-005 (curated schema fields).
- **File-path extraction from prompts:** regex over prompt text for `(packages|src|scripts|docs|tools|\.ralph-overview|\.ralph|plugins)/[\w./-]+\.(ts|tsx|js|mjs|md|json|toml|rs)` and similar. May miss prose-y "edit the X module" references. Acceptable for v1 — labeled candidate.
- **Codex-submodule git log:** out of scope per brainstorm. Tool should emit a `caveats[]` field warning when `task.scope` matches `codex` (open question from synthesis: D-004 secondary).
- **Two repos at impl time:** codexu (template + example) + ai-developer-toolkit/ralph-overview (tool + tests + skill). Per fork AGENTS.md "Cross-repo impl spawns need worktrees in EVERY shared repo." impl-with-ralph PRD must script worktree creation in both.

### Files to Create/Modify

**ai-developer-toolkit/plugins/ralph-overview:**
- `tools/overview-mcp/src/schemas.ts` — add `expandTaskContextInputSchema` + `expandTaskContextOutputSchema` (modify)
- `tools/overview-mcp/src/tools/expand-task-context.ts` — new file (~200 lines including heuristics)
- `tools/overview-mcp/src/server.ts` — register the new tool (one line)
- `tools/overview-mcp/src/__tests__/expand-task-context.test.ts` — new test file
- `skills/expand-task/SKILL.md` — new (Claude Code)
- `.copilot-plugin/copilot-skills/expand-task/SKILL.md` — new (Copilot CLI)
- `.claude-plugin/plugin.json` — version bump + skill entry
- `.copilot-plugin/copilot-plugin.json` — version bump + skill entry
- `CHANGELOG.md` — bullet
- `tools/overview-mcp/src/server.ts` — server version bump (2.1.0 → 2.2.0)

**codexu:**
- `.ralph-overview/task-expansion-template.md` — new
- `.ralph/brainstorms/task-expansion-skill/example-expansion.md` — new (worked example output)

## Codex Research

Not run — direct planner inspection of the same files was sufficient and the brainstorm itself ran the devil's-advocate lens. Phase 4 review-loop will catch what was missed.

## Copilot Research

Not run — planner runs under Copilot CLI; the brainstorm already represented the product-reality lens inline.

## Consolidated File List

### Files to create
- `ai-developer-toolkit/plugins/ralph-overview/tools/overview-mcp/src/tools/expand-task-context.ts`
- `ai-developer-toolkit/plugins/ralph-overview/tools/overview-mcp/src/__tests__/expand-task-context.test.ts`
- `ai-developer-toolkit/plugins/ralph-overview/skills/expand-task/SKILL.md`
- `ai-developer-toolkit/plugins/ralph-overview/.copilot-plugin/copilot-skills/expand-task/SKILL.md`
- `codexu/.ralph-overview/task-expansion-template.md`
- `codexu/.ralph/brainstorms/task-expansion-skill/example-expansion.md`

### Files to modify
- `ai-developer-toolkit/plugins/ralph-overview/tools/overview-mcp/src/schemas.ts`
- `ai-developer-toolkit/plugins/ralph-overview/tools/overview-mcp/src/server.ts`
- `ai-developer-toolkit/plugins/ralph-overview/.claude-plugin/plugin.json`
- `ai-developer-toolkit/plugins/ralph-overview/.copilot-plugin/copilot-plugin.json`
- `ai-developer-toolkit/plugins/ralph-overview/CHANGELOG.md`

### Dependencies
- None new. `@modelcontextprotocol/sdk`, `zod`, `chokidar`, `node:child_process`, `node:fs/promises`, `node:path` already available.

### Test files
- `tools/overview-mcp/src/__tests__/expand-task-context.test.ts` (new); leverages existing `__tests__/helpers.ts`.

### Build/config
- `tools/overview-mcp/package.json` — no change needed.
- Plugin manifests bumped to advertise the new skill.
