# Research Brief — Plan 09 (overview-mcp)

## Researcher Findings (Explore agent)

### Snapshot artifact state
- `plans/overview-snapshot.json`, `plans/overview-snapshot.schema.json`, `plans/overview-recommendations.json`, `plans/overview-dependency-graph.json` — **not present in working tree** at HEAD. Plan 05 ships the *generator* (in `scripts/lib/emit-snapshot.mjs` + `scripts/lib/emit-snapshot-schema.mjs` + `scripts/lib/sync-core.mjs:writeSidecar()`), but the artifacts are produced at runtime by either the Vite dev server or `pnpm sync-ralph-state:watch`. The MCP server must handle the case where these files are not yet generated (return a clear error / empty result).
- `plans/overview-data.js` — present (~192 KB). Top-level keys observed in source: `generatedAt`, `generatedFromCommit`, `tasks`, `phaseTree`, `cadence`, `effort`, `lastTouched`, `periodic`, `risk`, `runs`, `sizeBucket`, `spawnedFrom`, `workstream`. No `ralphOverrides` key — the structured edit must insert it.

### TypeScript types (single source)
- `tools/overview-viewer/src/types.ts` — defines `OverviewTask`, `RalphPipelineState`, `RalphStage` (union of `'brainstorming' | 'brainstorm-ready' | 'planning' | 'plan-ready' | 'implementing' | 'reviewing' | 'review-fix' | 'replan-pending' | 'shipped' | 'blocked'`), `CrewSessionRef` (lines 52–63: `{ crewName, memberName, startedAt, sessionId?, transcriptPath?, endedAt?, outcome?, summary?, _isExplicit?, cwd? }`), `Recommendation`, `NextCommand`, `DependencyGraph`, `SnapshotTask extends OverviewTask` (lines 207–209), `Snapshot` (211–222: includes `schemaVersion: 1`, `tasks`, `runs`, `recommendations`, `dependencyGraph`, `runDurations`, `unmatched`, `unmatchedSummary`).
- `OverviewTask` does **not** have a `title` field — `list_tasks` needs a fallback (use `command?.descriptionHtml` plain-text or `command?.name`).
- `Snapshot` does **not** include top-level OverviewData maps such as `workstream`, `sizeBucket`, `cadence`. `overview.list_tasks` filtering by `workstream` therefore requires loading `plans/overview-data.js` in addition to the snapshot. Reuse `loadOverviewData()` from `scripts/lib/sync-core.mjs` (the trusted parser).

### Shared modules to consume
- `scripts/lib/derive-next-command.mjs` — exports `deriveNextCommand(state, task, { repoRoot? })` returning `NextCommand | null`. Has `.d.mts`.
- `scripts/lib/derive-next-command-cli.mjs` — `node scripts/lib/derive-next-command-cli.mjs <taskId>` reads snapshot and outputs `NextCommand` JSON to stdout. This is what `runWorkOnViaCrew()` already uses.
- `scripts/lib/append-journal.mjs` — exports `appendJournalEntry({ repoRoot, taskId, ts, prevStage, newStage, slug })` and `formatJournalLine({ ts, prevStage, newStage, slug })`. **Currently only formats stage-transition lines** like `- <ts>  stage: <prev> → <new>  (job: <slug>)`. Does **not** accept arbitrary `{ note }`. Mismatch with plan contract — see Open Question #1.
- `scripts/lib/crews-cross-walk.mjs` — exports `discoverCrewSessions({ repoRoot, ralphState, overviewData, crewsRoot, now, logger })` and `matchTaskId()`. Live manifest scan over `.crews/crews/*/{members,leads}/*/manifest.json`. Has `.d.mts`.
- `scripts/lib/parse-spawn-launcher.mjs` — exports `parseSpawnLauncher(absolutePath)` returning `{ initialPrompt, memberName, crewName }`. Has `.d.mts`.
- `scripts/lib/work-on-via-crew.mjs` — exports `runWorkOnViaCrew({ repoRoot, config, taskId, stage, crewName, ... })`. Performs lock preflight → derive prompt → spawn via `D:/ai-developer-toolkit/plugins/crews/tools/spawn-member.js` → poll member manifest → write ref via `scripts/sync-ralph-state.mjs --update-crew-session`. **Lacks `.d.mts`** — add one for TS consumption from the MCP package.
- `scripts/sync-ralph-state.mjs` — lock-protected CLI; subcommands `--update-crew-session <taskId> <stage> --json <ref>` and `--finalize-crew-session <taskId> <stage> [--member X | --session-id Y] --outcome ...`. Internal entry points `runUpdateCrewSession(...)` / `runFinalizeCrewSession(...)` exported for programmatic use.
- `scripts/lib/atomic-write.mjs` — has `.d.mts`. Use for the `set_override` write.
- `scripts/lib/resolve-config.mjs` — has `.d.mts`. Resolves `repoRoot`, `config.dataFile`, `config.outputs.*`, `config.crewsRoot`, `config.lockFile`. Use this — do not hardcode `plans/*` paths.
- `scripts/lib/score-recommendations.mjs` — exports `scoreRecommendations({ byTaskId, overviewData, prdsByTaskId, weights, topN, now })`. The MCP `list_recommendations` should prefer the precomputed `snapshot.recommendations` over re-scoring.

### Crews integration (Plan 08)
- `.crews/crews/<crewName>/{members,leads}/<name>/manifest.json` exists — sample shows fields `name, crew, role, sessionId, cwd, stateCwd, startedAt, lastSessionStartAt, lastHeartbeatAt, lastSeq, lastTurnAt, lastKind, lastSummary, transcriptPath, listenerState, actorState`.
- Crews CLI tool at `D:/ai-developer-toolkit/plugins/crews/tools/spawn-member.js` exists (consumed by `runWorkOnViaCrew`).

### Workspace + build
- `pnpm-workspace.yaml` packages: 10 entries currently; no `tools/overview-mcp`.
- Root `package.json`: `packageManager: pnpm@10.11.0`, `workspaces.packages` mirrors pnpm-workspace.yaml. `chokidar@5.0.0` is a root devDependency (reusable). No `@modelcontextprotocol/sdk` or `@babel/parser` anywhere in the workspace yet.
- No root `tsconfig.json`. `tools/overview-viewer/tsconfig.json` uses `target: ES2022`, `module: ESNext`, `moduleResolution: bundler`, `noEmit: true`. The MCP package needs a different tsconfig (must emit `dist/`).
- Test runner: vitest (`tools/overview-viewer/package.json: "test": "vitest run --passWithNoTests"`). Tests are in `src/__tests__/`. Reuse vitest in the new package.

### MCP reference patterns
- **In-repo (best reference):** `D:/ai-developer-toolkit/plugins/agent-peers/src/server.ts` — uses `import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'`, `import { z } from 'zod'`, registers tools via `server.tool(name, description, zodSchema, handler)`. Returns `{ content: [{ type: 'text', text }] }`. Companion `D:/ai-developer-toolkit/plugins/agent-peers/src/index.ts` wires `StdioServerTransport`.
- `packages/happy-cli/src/codex/happyMcpStdioBridge.ts` — stdio MCP bridge inside this repo. Also a reasonable reference.
- All other toolkit plugins (`ado`, `teams`, `devui`, `edge-browser`, `seval`) use the `.mcp.json` + launcher pattern; `tools/overview-mcp` is in-workspace and registers via `.claude/settings.local.json` instead.

### Settings.local.json
- `.gitignore` confirms `.claude/settings.local.json` is gitignored. Current `.claude/settings.local.json` has crews plugin metadata but no `mcpServers` block yet.

## Architect Analysis (Explore agent)

### Type-sharing decision
The plan's "don't import from `tools/overview-viewer/`" rule is about **React/Vite runtime code**. Type-only imports (`import type { Snapshot, SnapshotTask, ... } from '../../tools/overview-viewer/src/types'`) are zero-runtime and already used by `scripts/lib/*.d.mts`. The plan should clarify this explicitly in the Common Mistakes section.

### Locking
- `runWorkOnViaCrew()` already preflights `.ralph/overview-sync.lock` and refuses to proceed if a watcher process holds it. The MCP `invoke_next` reuses this for free.
- `set_override` writes `overview-data.js`, which the watcher reads via `loadOverviewData()`. The watcher acquires the same lock when *writing* sidecar outputs. To avoid the race "watcher reads partial overview-data.js mid-`set_override` write" — use the atomic-write pattern (`scripts/lib/atomic-write.mjs`: tmp + rename). Document the choice: `set_override` does NOT acquire the snapshot lock; it relies on atomic rename + same-FS guarantees. If a future change needs stronger guarantees, the file-level lock can be added then.

### `set_override` byte-identity strategy
Babel `@babel/generator` reformats source even with `retainLines + compact: false`. The reliable approach:
1. Read source as string.
2. Parse with `@babel/parser` (`errorRecovery: true`) only to locate the `window.OVERVIEW_DATA = {...}` `ObjectExpression` and any existing `ralphOverrides` property — record `start` and `end` offsets.
3. **Splice the original source string**: either replace the existing `ralphOverrides` property's `[start, end]` range with the new serialized value, or insert a new property at an indent-matched position adjacent to `tasks:` / `phaseTree:`.
4. Write atomically (`atomicWriteFile` from `scripts/lib/atomic-write.mjs`).
5. Test: assert that the resulting file differs from the original ONLY in the spliced region (use a byte-range diff in tests).

### Tool group risk ranking
- **Lowest risk:** `list_tasks`, `get_task`, `next_command`, `list_recommendations`, `list_blockers` — read-only from snapshot. Need a snapshot-presence check.
- **Medium:** `add_journal_entry` — append-only filesystem. Contract mismatch with existing helper (see Open Question #1).
- **Medium:** `list_crew_sessions` + `get_transcript` — live re-read with short cache + JSONL tail.
- **High:** `set_override` — structured edit + byte-identity.
- **High:** `invoke_next` — reuse `runWorkOnViaCrew()`; the risk is the contract surface (default mode vs `viaCrewMember`) and the spawn-poll lifecycle, which is already implemented in the shared module.

### Build target
- ESM, Node 20+, `module: NodeNext`, `target: ES2022`, `outDir: dist`, `declaration: false` (server-only). Entry `dist/index.js` invoked as `node tools/overview-mcp/dist/index.js`. Build via `tsc -p tsconfig.json`.

## Codex Research

- Workspace registration is duplicated in root `package.json` and `pnpm-workspace.yaml`; both must be updated.
- `scripts/lib/work-on-via-crew.mjs` already implements most `invoke_next viaCrewMember` behavior; reuse via `runWorkOnViaCrew()`. Lacks `.d.mts` — add one.
- `appendJournalEntry()` does not accept `{ note }`; either extend additively or create a sibling helper.
- For `set_override`, Babel generator will likely reformat more than `ralphOverrides`. **Recommendation: parse only to locate AST ranges, then splice the original source and write atomically.** (Same conclusion as architect agent.)
- Declare direct deps in `tools/overview-mcp/package.json`: `@modelcontextprotocol/sdk`, `zod`, `chokidar`, optional `ajv`, dev: `@types/node`, `vitest`, `typescript`, `tsx`, `@babel/parser` if used.
- Root `vitest.config.ts` only covers `scripts/**/*.test.mjs`; `pnpm --filter @codexu/overview-mcp test` owns the new package's tests.

## Copilot Research

- Existing MCP examples: `packages/happy-cli/src/codex/happyMcpStdioBridge.ts`, `packages/happy-cli/src/claude/utils/startHappyServer.ts`.
- Stdio MCP must use **stdout for protocol traffic only**; all logs/diagnostics must go to **stderr**.
- Use `scripts/lib/resolve-config.mjs` to resolve config paths — don't hardcode `plans/*`.
- `appendJournalEntry` mismatch: must extend, replace, or change the tool contract.
- For `invoke_next`, reuse `runWorkOnViaCrew()` instead of duplicating spawn/poll/persist.
- For `list_crew_sessions`, reuse `discoverCrewSessions()` with a ~500 ms cache.
- For `get_transcript`, tolerate malformed final JSONL lines as a torn write (same pattern as `useActivityEvents()` in overview-viewer).
- Most important regression tests: snapshot refresh, `set_override` diff confinement, crew live-read, journal helper contract mismatch.

## Consolidated File List

### Files to create (new package)
- `tools/overview-mcp/package.json`
- `tools/overview-mcp/tsconfig.json`
- `tools/overview-mcp/README.md`
- `tools/overview-mcp/vitest.config.ts`
- `tools/overview-mcp/src/index.ts` (stdio entrypoint)
- `tools/overview-mcp/src/server.ts` (factory: `createServer()` returns `McpServer`)
- `tools/overview-mcp/src/context.ts` (resolves repoRoot, config, snapshot reader)
- `tools/overview-mcp/src/snapshot-reader.ts` (chokidar watch + in-memory cache + `loadOverviewData()`)
- `tools/overview-mcp/src/schemas.ts` (zod schemas for all 10 tool inputs)
- `tools/overview-mcp/src/tools/{list-tasks,get-task,next-command,invoke-next,list-recommendations,list-blockers,set-override,add-journal-entry,list-crew-sessions,get-transcript}.ts`
- `tools/overview-mcp/src/utils/set-override-edit.ts`
- `tools/overview-mcp/src/utils/transcript-tail.ts`
- `tools/overview-mcp/src/install-server.ts` (registers in `.claude/settings.local.json` or prints JSON)
- `tools/overview-mcp/src/__tests__/*.test.ts` (one per tool + utils)

### Files to modify
- `pnpm-workspace.yaml` — add `tools/overview-mcp`
- `package.json` (root) — add to `workspaces.packages`; add scripts `overview-mcp:build`, `overview-mcp:install`
- `scripts/lib/work-on-via-crew.d.mts` — **NEW**, sibling declaration so the MCP TS package can `import { runWorkOnViaCrew } from '../../scripts/lib/work-on-via-crew.mjs'`
- `scripts/lib/append-journal.mjs` — extend additively with a new exported `appendJournalNote({ repoRoot, taskId, ts, note })` (preserves existing `appendJournalEntry` contract; see Open Question #1)
- `scripts/lib/append-journal.d.mts` — **NEW**, declare both functions
- `scripts/lib/append-journal.test.mjs` — extend with note-append tests
- `plans/ralph-pipeline-INDEX.md` — refresh DAG / source-of-truth table for the new package (final commit only)

### Files to read for reference (don't modify)
- `scripts/lib/derive-next-command.mjs`, `.d.mts`
- `scripts/lib/crews-cross-walk.mjs`, `.d.mts`
- `scripts/lib/parse-spawn-launcher.mjs`, `.d.mts`
- `scripts/lib/work-on-via-crew.mjs`
- `scripts/lib/sync-core.mjs` (esp. `loadOverviewData`, `atomicWriteFile`)
- `scripts/lib/resolve-config.mjs`, `.d.mts`
- `scripts/lib/atomic-write.mjs`, `.d.mts`
- `tools/overview-viewer/src/types.ts`
- `tools/overview-viewer/package.json`, `tsconfig.json`, `vitest.config.ts` (for conventions)
- `D:/ai-developer-toolkit/plugins/agent-peers/src/server.ts` + `index.ts` (MCP pattern reference)
- `packages/happy-cli/src/codex/happyMcpStdioBridge.ts`
- `plans/overview-data.js` (write target for `set_override`)
- `.crews/crews/ralph-pipeline/leads/overview-bookkeeper/manifest.json` (manifest shape)

## Open Questions (deferred decisions)

### OQ-1 — `add_journal_entry` contract
The plan says the tool takes `{ taskId, note }`, but `appendJournalEntry()` only formats `stage: prev → new (job: slug)` lines. **Recommendation (autonomous):** extend `scripts/lib/append-journal.mjs` additively with a new export `appendJournalNote({ repoRoot, taskId, ts, note })` that formats `- <ts>  note: <single-line-note>\n`. Multi-line notes are joined with `\n  ` indented continuation. The new helper is the one the MCP tool wraps. The existing `appendJournalEntry` for stage transitions is untouched.

### OQ-2 — `list_recommendations` snapshot absence
If `plans/overview-snapshot.json` does not yet exist (because Plan 05's watcher hasn't run), the tool falls back to `plans/overview-recommendations.json`. If that's also absent, return `{ ok: false, error: 'no recommendations available — run pnpm sync-ralph-state to generate' }`. Document in README.

### OQ-3 — `list_tasks` `workstream` filter
`Snapshot.tasks[*]` does not carry `workstream`; it's a top-level OverviewData map. Either:
- (a) load `overview-data.js` via `loadOverviewData()` when the filter is set, look up the task's group.
- (b) drop `workstream` from the filter set in v1.

**Recommendation (autonomous):** (a) — already need `OverviewData` for `set_override` write target, so the reader can keep an OverviewData cache alongside the snapshot cache. Filter behavior: a task matches `workstream=foo` if its taskId appears in `overviewData.workstream[foo]` (or however the map is keyed — confirm during implementation by sampling `plans/overview-data.js`).

### OQ-4 — `set_override` locking
The plan says the MCP server is the ONLY writer of `overview-data.js`'s `ralphOverrides` field. The watcher reads this file. The atomic-write pattern (tmp + rename, same-FS) is sufficient for atomicity of the swap. Do NOT acquire `.ralph/overview-sync.lock` from `set_override` — that lock is for snapshot generation, and grabbing it from a fast structured-edit tool would block snapshot writers. Document this choice in the tool docstring.
