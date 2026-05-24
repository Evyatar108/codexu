# PRD: Overview MCP Server (`tools/overview-mcp/`)

*Autonomous-mode PRD generated for Ralph job `ralph-pipeline-09-mcp`. Source plan: `.ralph/jobs/ralph-pipeline-09-mcp/plan.md`. Stories preserved from `.ralph/jobs/ralph-pipeline-09-mcp/stories-outline.md` (US-001..US-010 ids/dependencies/AC intact; only wording lightly polished for PRD context).*

## Introduction

Plans 01–08 of the Ralph pipeline produce file-based interfaces (sidecar, snapshot, activity log, journal, recommendations). Agents can consume those by reading files, but that surface is brittle: paths drift, JSON has no input validation, and concurrent writers can produce torn reads. This plan adds a first-class **Model Context Protocol (MCP) server** at `tools/overview-mcp/` exposing **10 typed tools** so other agents (the bookkeeping lead, any tool-using Claude Code session) call typed RPC instead of parsing files. Skills (Plan 06) remain the user-facing surface; MCP is the agent-to-agent / programmatic surface.

The new package lives in the existing pnpm workspace, depends on `@modelcontextprotocol/sdk`, `zod`, `chokidar`, and `@babel/parser`, runs as a stdio subprocess registered via `.claude/settings.local.json`, and exposes 10 read/write tools backed by the existing shared libraries under `scripts/lib/`.

## Goals

- Provide a typed RPC interface (10 MCP tools) over Ralph's overview state for agents (replaces file parsing).
- Reuse existing shared modules (`derive-next-command.mjs`, `crews-cross-walk.mjs`, `work-on-via-crew.mjs`, `sync-core.mjs`, `resolve-config.mjs`, `atomic-write.mjs`); add only one small additive extension to `append-journal.mjs` (`appendJournalNote`).
- Land the package in the pnpm workspace cleanly: both `pnpm-workspace.yaml` and root `package.json.workspaces.packages` updated; `pnpm install --frozen-lockfile` passes from a clean checkout.
- Provide a one-command install script (`pnpm overview-mcp:install`) that registers the server under `mcpServers.codexu-overview` in `.claude/settings.local.json`.
- Confine `set_override` writes to the `ralphOverrides` byte range of `plans/overview-data.js` (no whole-file regeneration; byte-range tests enforce this).
- Surface live (not snapshot-cached) crew session state via `list_crew_sessions` (re-reads `.crews/.../manifest.json` per call, with a 500 ms cache).
- Keep all diagnostic logs on stderr; stdout is reserved for MCP JSON-RPC.

## User Stories

### US-001: Scaffold MCP package + shared TypeScript context

**Description:** As an implementer, I want a working `tools/overview-mcp/` package with all build infrastructure so subsequent stories can implement tools.

**Acceptance Criteria:**
- [ ] `tools/overview-mcp/package.json` declares `@codexu/overview-mcp` (ESM, `"type": "module"`), `bin` `overview-mcp-install` → `dist/install-server.js`, deps `@modelcontextprotocol/sdk`, `zod`, `chokidar`, `@babel/parser`, dev `typescript`, `vitest`, `@types/node`.
- [ ] `tools/overview-mcp/tsconfig.json` — `target: ES2022`, `module: NodeNext`, `moduleResolution: NodeNext`, `outDir: dist`, `declaration: false`, `strict: true`.
- [ ] `tools/overview-mcp/vitest.config.ts`, stub `README.md`, `src/index.ts` (skeleton), `src/server.ts` (empty `createServer`), `src/context.ts` (`buildContext()` resolves repoRoot + config via `scripts/lib/resolve-config.mjs`).
- [ ] `pnpm-workspace.yaml` contains `tools/overview-mcp` under `packages`.
- [ ] Root `package.json.workspaces.packages` contains `tools/overview-mcp`; root scripts include `overview-mcp:build` and `overview-mcp:install`.
- [ ] `scripts/lib/work-on-via-crew.d.mts` exists with `runWorkOnViaCrew` declared (type-only, mirroring the JS signature).
- [ ] `pnpm install` succeeds; `pnpm install --frozen-lockfile` succeeds in a clean checkout; `pnpm-lock.yaml` is updated.
- [ ] `pnpm --filter @codexu/overview-mcp build` produces `dist/index.js`; `pnpm --filter @codexu/overview-mcp typecheck` passes.
- [ ] `node tools/overview-mcp/dist/index.js` starts without crashing and logs `connected` to stderr; exits cleanly on SIGINT. No stdout output during startup (pipe stdout to a file and assert empty).
- [ ] Typecheck passes.

**Dependencies:** none
**Priority:** 1

### US-002: SnapshotReader + ServerContext (lazy load + chokidar invalidation)

**Description:** As a tool implementer, I want a `SnapshotReader` that lazily loads `Snapshot` and `OverviewData` from disk and invalidates on file change, so every read-only tool shares one cached parse path.

**Acceptance Criteria:**
- [ ] `SnapshotReader` class exposes `getSnapshot()`, `getOverviewData()`, `start()`, `close()`.
- [ ] Uses `chokidar.watch()` on `config.outputs.snapshot` and `config.dataFile`. On change events, nulls caches; next `get*()` re-reads.
- [ ] `getSnapshot()` returns `null` when the snapshot file is missing (no throw).
- [ ] `getOverviewData()` reuses `loadOverviewData()` from `scripts/lib/sync-core.mjs`.
- [ ] Tolerates torn reads: on parse failure, schedule one 100 ms retry; if still failing, return cached value or null. Log a single stderr warning per failure.
- [ ] Vitest fixture under a tmp dir: write snapshot → read → modify → read → assert refreshed; corrupt mid-write → assert reader recovers.
- [ ] Typecheck passes. Tests pass.

**Dependencies:** US-001
**Priority:** 2

### US-003: Read-only snapshot tools (`list_tasks`, `get_task`, `next_command`, `list_recommendations`, `list_blockers`)

**Description:** As an agent, I want the five read-only tools so I can introspect the pipeline without parsing files.

**Acceptance Criteria:**
- [ ] All five tools registered in `src/server.ts` with zod input schemas in `src/schemas.ts`.
- [ ] `list_tasks` filters: `stage`, `scope`, `workstream` (lookup via `OverviewData.workstream`), `hasDeferredQuestions`, `hasOpenFindings`. `hasOpenFindings` predicate uses `Object.values(reviewOpenCount ?? {}).some((n) => (n ?? 0) > 0)` (per F-002). Title falls back to `command?.descriptionHtml` (plaintext) or `command?.name`.
- [ ] `get_task` validates `taskId` via the exported `assertSafeTaskId` (re-exported from `scripts/lib/append-journal.mjs`) before any filesystem read (per F-003), OR resolves taskId only against the snapshot's known task set and returns `{ ok: false, error: 'unknown task' }` for unknown ids.
- [ ] `get_task` returns merged `SnapshotTask` + `recentJournal: string[]` (last 3 lines of `tasks/<taskId>/journal.md`).
- [ ] `next_command` calls `deriveNextCommand()` from `scripts/lib/derive-next-command.mjs` directly; result matches `node scripts/lib/derive-next-command-cli.mjs <taskId>`.
- [ ] `list_recommendations` reads `snapshot.recommendations`; falls back to `plans/overview-recommendations.json`; both missing → `{ ok: false, error: 'no recommendations available' }`. Supports `limit` and `stageFilter`.
- [ ] `list_blockers` returns tasks where `stage === 'blocked'` OR `Object.values(reviewOpenCount ?? {}).some((n) => (n ?? 0) > 0)` OR `(deferredQuestionsCount ?? 0) > 0`.
- [ ] One vitest test per tool covering happy path + at least one error case (missing snapshot, unknown task).
- [ ] Typecheck passes. Tests pass.

**Dependencies:** US-002
**Priority:** 3

### US-004: `add_journal_entry` tool + `appendJournalNote()` helper

**Description:** As an agent, I want to append a free-form note to a task's journal so I can record context without going through the bookkeeper.

**Acceptance Criteria:**
- [ ] `scripts/lib/append-journal.mjs` adds `appendJournalNote({ repoRoot, taskId, ts, note })`. Format: `- <ts>  note: <note>\n` with `\n  ` continuation for multi-line notes. Also export `assertSafeTaskId` (currently file-local) so other modules can reuse it (per F-003).
- [ ] `scripts/lib/append-journal.d.mts` declares `appendJournalEntry`, `appendJournalNote`, `formatJournalLine`, `assertSafeTaskId`.
- [ ] `scripts/lib/append-journal.test.mjs` extends with: single-line note, multi-line note, special-character note. Pre-existing `appendJournalEntry` / `formatJournalLine` stage-transition test cases all pass unchanged (per F-013).
- [ ] MCP `overview.add_journal_entry` tool wraps `appendJournalNote()`. `ts` defaults to `new Date().toISOString()`. Validates `taskId` via `assertSafeTaskId`.
- [ ] Tests verify (per F-009): (a) append is atomic (uses fsync), (b) `tasks/<taskId>/` directory is created idempotently via `fs.mkdirSync({ recursive: true })` — calling `appendJournalNote` twice in a row succeeds with both lines appended, (c) existing stage-transition tests still pass. Append semantics are NOT deduplicating — repeated identical calls append duplicate lines by design.
- [ ] Typecheck passes. Tests pass for `scripts/lib/` and `tools/overview-mcp/`.

**Dependencies:** US-001
**Priority:** 4

### US-005: `set_override` (structured edit of `overview-data.js`)

**Description:** As an agent, I want to set `ralphOverrides[slug] = taskId` in `plans/overview-data.js` without touching any other field.

**Acceptance Criteria:**
- [ ] `src/utils/set-override-edit.ts` exposes `editOverrides({ source, slug, taskId }): { source: string }` — pure function (no I/O).
- [ ] Uses `@babel/parser` only to LOCATE AST ranges; splices the original source string. Does NOT call `@babel/generator`.
- [ ] Handles both cases: `ralphOverrides` already present (replace value) or absent (insert immediately after `tasks:` property).
- [ ] Tool wrapper reads `config.dataFile`, calls `editOverrides`, validates the result parses, writes via `atomicWriteFile()` from `scripts/lib/atomic-write.mjs`.
- [ ] Returns `{ ok: false, error }` on parse failure or absent `window.OVERVIEW_DATA` assignment — does NOT overwrite.
- [ ] Fixture lives at `tools/overview-mcp/src/__tests__/fixtures/overview-data.sample.js` — a trimmed but representative `window.OVERVIEW_DATA` with ~5 tasks and the full top-level key set (`generatedAt`, `generatedFromCommit`, `tasks`, `phaseTree`, `cadence`, `effort`, `lastTouched`, `periodic`, `risk`, `runs`, `sizeBucket`, `spawnedFrom`, `workstream`) (per F-014).
- [ ] Byte-range confinement test: capture the original source; run `editOverrides()`; compare every byte outside the replaced/inserted `[start, end]` range via `Buffer.compare(originalSlice, newSlice) === 0`. Run all four scenarios: (a) `ralphOverrides` absent → insert, (b) present, different value → replace, (c) present, same value → no-op (`result.source === input`), (d) malformed source → `{ ok: false, error }` returned and no write performed.
- [ ] Typecheck passes. Tests pass.

**Dependencies:** US-002
**Priority:** 5

### US-006: `list_crew_sessions` (live re-read with 500 ms cache + LiveCrewSession shape)

**Description:** As an agent, I want to see live crew sessions per task (not the snapshot's cached view) so I can react to active members.

**Acceptance Criteria:**
- [ ] Tool reuses `discoverCrewSessions()` from `scripts/lib/crews-cross-walk.mjs` with fresh inputs (Ralph state + OverviewData + `config.crewsRoot`).
- [ ] Caches the discovery result for 500 ms (single call serves all reads within the window).
- [ ] Defines a local `LiveCrewSession` type (in `tools/overview-mcp/src/tools/list-crew-sessions.ts`) extending `CrewSessionRef` with `lastHeartbeatAt?`, `lastSummary?`, `lastTurnAt?`, `listenerState?`, `actorState?` populated by re-reading each match's `.crews/crews/<crew>/{members,leads}/<name>/manifest.json` (per F-006). `CrewSessionRef` in the shared types remains unchanged.
- [ ] Returns `Array<LiveCrewSession & { taskId: string; stage: RalphStage; role: 'member' | 'lead' }>` (per F-011).
- [ ] `taskId` filter (when provided) does an exact match on the flattened Map result — does NOT import the private `matchTaskId()` heuristic (per F-008).
- [ ] Live-read regression test: write a manifest with `lastHeartbeatAt = T1`, call the tool (returns T1), advance fake time 600 ms (past cache window), update manifest to `T2`, call again (returns T2).
- [ ] Typecheck passes. Tests pass.

**Dependencies:** US-002
**Priority:** 6

### US-007: `get_transcript` (JSONL reverse-tail with torn-line tolerance)

**Description:** As an agent, I want to read the tail of a session transcript by `sessionId` so I can review what another agent did.

**Acceptance Criteria:**
- [ ] `src/utils/transcript-tail.ts` exposes `tailTranscript({ transcriptPath, lastN, includeToolEvents }): Array<TranscriptTurn>`.
- [ ] Reads file backward in 64 KB chunks; stops when N complete lines collected or file exhausted; caps at 100 lastN.
- [ ] Tolerates a malformed final line (torn write) — skip without warning. Malformed interior lines log a single stderr warning per line.
- [ ] Filters `tool_use` / `tool_result` entries by default; `includeToolEvents: true` retains them.
- [ ] Tool resolves `sessionId → transcriptPath` via cached `discoverCrewSessions()` result (or scans `.crews/.../manifest.json` directly). Returns `{ ok: false, error: 'session not found' }` for unknown sessionId.
- [ ] Test fixture: JSONL with 50 mixed entries; assert last 20 user/assistant turns by default; assert full set with `includeToolEvents: true`; assert torn-line tolerance.
- [ ] Typecheck passes. Tests pass.

**Dependencies:** US-006
**Priority:** 7

### US-008: `invoke_next` (default + `viaCrewMember`)

**Description:** As an agent, I want one tool that either tells me the next command to run, or spawns a crew member to run it.

**Acceptance Criteria:**
- [ ] **Default mode (no `viaCrewMember`):** calls `deriveNextCommand()`, returns `{ ok: true, command: <NextCommand>, invocationGuidance: 'Use the Skill tool to invoke this — for example: Skill("ralph-orchestration:run-ralph", args="...")' }`.
- [ ] **Null command case (per F-010):** when `deriveNextCommand()` returns `null` (shipped task, non-actionable), the tool returns `{ ok: true, command: null, invocationGuidance: 'no next command — task is complete or has no actionable next step' }`.
- [ ] **`viaCrewMember` mode:** delegates to `runWorkOnViaCrew({ repoRoot, config, taskId, stage, crewName, memberName?, stdout: process.stderr })` (per F-001 — `stdout: process.stderr` MUST be passed to prevent the helper's confirmation line from corrupting the MCP JSON-RPC channel). Returns `{ ok: true, sessionRef }`.
- [ ] **Dynamic import for Plan-08 fallback (per F-007):** the handler uses `const mod = await import('../../scripts/lib/work-on-via-crew.mjs').catch(() => null)`. If null, returns `{ ok: false, error: 'requires plan 08' }`. NO top-level static import of `work-on-via-crew.mjs`.
- [ ] Tests with mocks for `runWorkOnViaCrew()` assert: (a) default mode happy path, (b) null command case, (c) `viaCrewMember` happy path with `stdout` arg validated, (d) Plan-08-missing fallback (mock the dynamic import to fail).
- [ ] Typecheck passes. Tests pass.

**Dependencies:** US-002, US-003
**Priority:** 8

### US-009: `install-server.ts` (`.claude/settings.local.json` patcher)

**Description:** As an operator, I want a one-command install that registers the MCP server in my machine-local settings.

**Acceptance Criteria:**
- [ ] CLI binary `overview-mcp-install` declared as `package.json.bin` → `dist/install-server.js`.
- [ ] Reads `<repoRoot>/.claude/settings.local.json` (creates `{}` if absent).
- [ ] Merges under `mcpServers.codexu-overview`: `{ command: 'node', args: ['<absolute-forward-slash-path-to-dist/index.js>'] }`.
- [ ] Writes atomically via `atomicWriteFile()` from `scripts/lib/atomic-write.mjs`.
- [ ] `--print-only` flag emits the JSON to stdout without writing.
- [ ] Errors clearly if `dist/index.js` is absent (asks user to run `pnpm overview-mcp:build` first).
- [ ] Test uses a temp dir as repoRoot; asserts file content after install; verifies idempotency (running twice produces the same file).
- [ ] Typecheck passes. Tests pass.

**Dependencies:** US-001
**Priority:** 9

### US-010: README + final INDEX refresh + downstream-plan audit

**Description:** As a future maintainer, I want clear docs on installation, registration, and each tool's contract; and the project INDEX must reflect the new package.

**Acceptance Criteria:**
- [ ] `tools/overview-mcp/README.md` covers: install (`pnpm overview-mcp:build && pnpm overview-mcp:install`); registration JSON layout; verifying with `/mcp` (or the Claude Code tool list); per-tool contract (name, inputs, outputs, mutation behavior, error envelope); Windows-specific PowerShell verification commands.
- [ ] `plans/ralph-pipeline-INDEX.md`: Source-of-truth modules table lists `tools/overview-mcp/` and the new `appendJournalNote` export; DAG diagram shows Plan 09 dependency edges.
- [ ] Any reference in `plans/ralph-pipeline-10-ralph-handoff.md` (per F-005 — note the correct filename) is updated to mention the MCP package.
- [ ] Atomic final commit; commit message lists each diff (file, lines, what changed) so reviewers can audit the cascade.
- [ ] Typecheck across the workspace passes; full test suite passes.

**Dependencies:** US-001, US-002, US-003, US-004, US-005, US-006, US-007, US-008, US-009
**Priority:** 10

## Functional Requirements

- FR-1: New pnpm workspace package `@codexu/overview-mcp` at `tools/overview-mcp/` registered in both `pnpm-workspace.yaml` and root `package.json.workspaces.packages`.
- FR-2: Package builds via `pnpm overview-mcp:build` producing `tools/overview-mcp/dist/index.js`.
- FR-3: The server exposes 10 MCP tools over stdio (`StdioServerTransport`): `overview.list_tasks`, `overview.get_task`, `overview.next_command`, `overview.invoke_next`, `overview.list_recommendations`, `overview.list_blockers`, `overview.set_override`, `overview.add_journal_entry`, `overview.list_crew_sessions`, `overview.get_transcript`.
- FR-4: All tool inputs are validated by zod schemas in `src/schemas.ts`.
- FR-5: Read-only tools share a `SnapshotReader` with chokidar invalidation on `config.outputs.snapshot` and `config.dataFile`; the reader tolerates torn reads via a 100 ms retry.
- FR-6: `set_override` writes ONLY the `ralphOverrides` field of `plans/overview-data.js` via AST-locate + source-string splice (no `@babel/generator`); atomic write via `atomicWriteFile()`.
- FR-7: `list_crew_sessions` re-reads `.crews/crews/<crewName>/{members,leads}/<name>/manifest.json` per call (with 500 ms cache) and merges live fields (`lastHeartbeatAt`, `lastSummary`, `lastTurnAt`, `listenerState`, `actorState`) into a package-local `LiveCrewSession` shape.
- FR-8: `get_transcript` resolves `sessionId → transcriptPath` via crews discovery and tail-reads the JSONL file in 64 KB chunks, capped at `lastN ≤ 100`, default 20, default-excludes tool events.
- FR-9: `invoke_next` default mode returns `{ ok: true, command, invocationGuidance }`; `viaCrewMember` mode dynamically imports `scripts/lib/work-on-via-crew.mjs` and calls `runWorkOnViaCrew({ ..., stdout: process.stderr })`.
- FR-10: `add_journal_entry` wraps the new `appendJournalNote({ repoRoot, taskId, ts, note })` helper in `scripts/lib/append-journal.mjs`; `assertSafeTaskId` is also exported and reused by all path-building tools.
- FR-11: `pnpm overview-mcp:install` patches `.claude/settings.local.json` to register `mcpServers.codexu-overview`; `--print-only` prints the JSON to stdout without writing.
- FR-12: All diagnostic output goes to stderr; stdout is reserved for MCP JSON-RPC.
- FR-13: `pnpm install --frozen-lockfile` succeeds from a clean checkout with the new package and dependencies committed via `pnpm-lock.yaml` regeneration.
- FR-14: `pnpm --filter @codexu/overview-mcp test` and `pnpm --filter @codexu/overview-mcp typecheck` pass; existing `scripts/lib/` and `tools/overview-viewer/` tests remain green.

## Non-Goals

- No authentication / per-user authorization — single-user, single-workstation deployment.
- No streaming results — all tools return synchronously.
- No tool versioning beyond v1 — breaking changes ship as new tools (`overview.list_tasks_v2`) rather than mutated v1.
- No file edits other than the additive extension to `scripts/lib/append-journal.mjs`, the targeted splice of `plans/overview-data.js` via `set_override`, append-only journal lines, and the documented INDEX/README/handoff doc refresh.
- No replacement of or modification to snapshot generation logic (Plan 05's watcher remains the source of truth for snapshot artifacts).
- No `unset_override` / deletion of `ralphOverrides[slug]` in v1 (deferred to v2 if requested).
- No WebSocket / HTTP transport in v1 — stdio only (the standard MCP transport for Claude Code).
- No re-scoring of recommendations on the fly — tool always prefers `snapshot.recommendations` and falls back to the JSON file.

## Design Considerations

- Reuse existing shared libraries from `scripts/lib/` — do NOT reimplement next-command derivation, crews cross-walk, atomic write, or config resolution.
- Type-only imports from `tools/overview-viewer/src/types.ts` are allowed (erased at compile time, no runtime dependency). Do NOT import any React/Vite/runtime code from `tools/overview-viewer/`.
- Reference MCP server implementation: `D:/ai-developer-toolkit/plugins/agent-peers/src/{server.ts,index.ts}` (`McpServer` + `zod` + `server.tool(name, description, schema, handler)`).
- `set_override` requires careful AST locate + splice (never `@babel/generator`) — the byte-range confinement test is the critical guardrail.
- All write-path tools must use `atomicWriteFile()` (tmp + rename) for crash safety.

## Technical Considerations

- ESM module system; `"type": "module"` in `package.json`. TypeScript `target: ES2022`, `module: NodeNext`, `outDir: dist`.
- Per-package `vitest.config.ts` (root `vitest.config.ts` only matches `scripts/**/*.test.mjs`).
- Workspace registration is duplicated in `pnpm-workspace.yaml` AND root `package.json.workspaces.packages` — both must be updated (Common Mistake from existing `tools/overview-viewer/CLAUDE.md`).
- `chokidar` is already a root devDep at v5.0.0 but the new package declares its own to avoid version coupling.
- Stdio MCP protocol uses stdout for JSON-RPC; ALL diagnostic output must go to stderr.
- Windows host — verification commands must use PowerShell (`Get-Content -Tail`, `Get-FileHash`), not bash-only `tail`/`head`.
- `runWorkOnViaCrew()` (Plan 08) must be invoked with `stdout: process.stderr` to keep its confirmation line off the MCP JSON-RPC stream (F-001).
- Use `resolve-config.mjs` for ALL paths — never hardcode `plans/overview-snapshot.json` etc.

## Success Metrics

- All 10 tools registered and callable via stdio; manual `tools/list` smoke test returns exactly 10 `overview.*` tools.
- `pnpm install --frozen-lockfile` succeeds in a clean checkout.
- `pnpm overview-mcp:build` produces a reproducible `dist/index.js`.
- `pnpm --filter @codexu/overview-mcp test` passes (one `.test.ts` per tool plus utilities); existing `scripts/lib/` and `tools/overview-viewer/` test suites remain green.
- `set_override` byte-range confinement tests pass for all four scenarios (insert, replace, no-op, malformed).
- `list_crew_sessions` reflects live `lastHeartbeatAt` updates within the 500 ms cache window.

## Open Questions

- **OQ-1 (resolved):** `add_journal_entry { taskId, note }` contract mismatched `appendJournalEntry()`. Resolved by additive extension (`appendJournalNote()` in US-004).
- **OQ-2 (deferred):** Should `list_recommendations` re-score on the fly if the snapshot's array is stale (e.g. older than 5 min)? v1 answer: no — snapshot freshness is the watcher's responsibility.
- **OQ-3 (deferred):** WebSocket transport in addition to stdio? v1 answer: no — stdio is the standard.
- **OQ-4 (deferred):** `list_tasks workstream` filter keying — implementer adjusts predicate during US-003 if `OverviewData.workstream` shape differs; fail soft to empty result, not error.
- **OQ-5 (deferred):** `set_override` deletion (taskId: null)? v1 answer: no — defer to `unset_override` in v2 if requested.

## Reference Files (consume, do not modify)

- `scripts/lib/derive-next-command.mjs`, `scripts/lib/derive-next-command-cli.mjs`
- `scripts/lib/crews-cross-walk.mjs` (and `.d.mts`)
- `scripts/lib/parse-spawn-launcher.mjs` (and `.d.mts`)
- `scripts/lib/work-on-via-crew.mjs` (US-001 adds the sibling `.d.mts`)
- `scripts/lib/sync-core.mjs` (esp. `loadOverviewData`, `atomicWriteFile`)
- `scripts/lib/resolve-config.mjs` (and `.d.mts`)
- `scripts/lib/atomic-write.mjs` (and `.d.mts`)
- `scripts/lib/emit-snapshot-schema.mjs`
- `tools/overview-viewer/src/types.ts` (type-only imports)
- `tools/overview-viewer/{package.json,tsconfig.json,vitest.config.ts,CLAUDE.md}` (conventions)
- `D:/ai-developer-toolkit/plugins/agent-peers/src/{server.ts,index.ts}` (MCP pattern reference)
- `packages/happy-cli/src/codex/happyMcpStdioBridge.ts`
- `plans/overview-data.js` (write target for `set_override`)
- `.crews/crews/ralph-pipeline/leads/overview-bookkeeper/manifest.json` (manifest shape)

## Documentation to Update

- `tools/overview-mcp/README.md` — created in US-001 (stub) and finalized in US-010.
- `plans/ralph-pipeline-INDEX.md` — final commit in US-010.
- `plans/ralph-pipeline-10-ralph-handoff.md` — final commit in US-010 (if it references the MCP package).
