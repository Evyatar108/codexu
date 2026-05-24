# Stories Outline: Plan 09 — MCP server at `tools/overview-mcp/`

*Preliminary decomposition from `/plan-with-ralph --improve`. Feed to `/implement-with-ralph --from-plan` for PRD generation.*

## US-001: Scaffold MCP package + shared TypeScript context
**Description:** As an implementer, I want a working `tools/overview-mcp/` package with all build infrastructure so subsequent stories can implement tools.
**Acceptance Criteria:**
- [ ] `tools/overview-mcp/package.json` declares `@codexu/overview-mcp` (ESM, `"type": "module"`), `bin` `overview-mcp-install` → `dist/install-server.js`, deps `@modelcontextprotocol/sdk`, `zod`, `chokidar`, `@babel/parser`, dev `typescript`, `vitest`, `@types/node`.
- [ ] `tools/overview-mcp/tsconfig.json` — `target: ES2022`, `module: NodeNext`, `moduleResolution: NodeNext`, `outDir: dist`, `declaration: false`, `strict: true`.
- [ ] `tools/overview-mcp/vitest.config.ts`, stub `README.md`, `src/index.ts` (skeleton), `src/server.ts` (empty `createServer`), `src/context.ts` (`buildContext()` resolves repoRoot + config via `resolve-config.mjs`).
- [ ] `pnpm-workspace.yaml` contains `tools/overview-mcp` under `packages`.
- [ ] Root `package.json.workspaces.packages` contains `tools/overview-mcp`; root scripts include `overview-mcp:build` and `overview-mcp:install`.
- [ ] `scripts/lib/work-on-via-crew.d.mts` exists with `runWorkOnViaCrew` declared (mirror the JS signature).
- [ ] `pnpm install` succeeds. `pnpm install --frozen-lockfile` succeeds in a clean checkout. `pnpm-lock.yaml` is updated.
- [ ] `pnpm --filter @codexu/overview-mcp build` produces `dist/index.js`; `pnpm --filter @codexu/overview-mcp typecheck` passes.
- [ ] Server starts (`node tools/overview-mcp/dist/index.js`) without crashing and logs `connected` to stderr; exits cleanly on SIGINT. No stdout output (verify by piping stdout to a file and asserting it's empty during startup).
- [ ] Typecheck passes.
**Dependencies:** None
**Estimated complexity:** small

## US-002: SnapshotReader + ServerContext (lazy load + chokidar invalidation)
**Description:** As a tool implementer, I want a `SnapshotReader` that lazily loads `Snapshot` and `OverviewData` from disk and invalidates on file change, so every read-only tool shares one cached parse path.
**Acceptance Criteria:**
- [ ] `SnapshotReader` class with `getSnapshot()`, `getOverviewData()`, `start()`, `close()`.
- [ ] Uses `chokidar.watch()` on `config.outputs.snapshot` and `config.dataFile`. On change events, nulls caches; next `get*()` re-reads.
- [ ] Returns `null` from `getSnapshot()` when the snapshot file is missing (no throw).
- [ ] `getOverviewData()` reuses `loadOverviewData()` from `scripts/lib/sync-core.mjs`.
- [ ] Tolerates torn reads: on parse failure, schedule one 100 ms retry; if still failing, return cached value or null. Log a single stderr warning per failure.
- [ ] Tests: fixture under a tmp dir, write snapshot → read → modify → read → assert refreshed; corrupt mid-write → assert reader recovers.
- [ ] Typecheck + vitest pass.
**Dependencies:** US-001
**Estimated complexity:** medium

## US-003: Read-only snapshot tools (`list_tasks`, `get_task`, `next_command`, `list_recommendations`, `list_blockers`)
**Description:** As an agent, I want the five read-only tools so I can introspect the pipeline without parsing files.
**Acceptance Criteria:**
- [ ] All five tools registered in `src/server.ts` with zod input schemas in `src/schemas.ts`.
- [ ] `list_tasks` filters supported: `stage`, `scope`, `workstream` (lookup via `OverviewData.workstream`), `hasDeferredQuestions`, `hasOpenFindings`. `hasOpenFindings` predicate uses `Object.values(reviewOpenCount ?? {}).some((n) => (n ?? 0) > 0)` (per F-002). Title falls back to `command?.descriptionHtml` (plaintext) or `command?.name`.
- [ ] `get_task` returns merged `SnapshotTask` + `recentJournal: string[]` (last 3 lines of `tasks/<taskId>/journal.md`). **taskId is validated via the exported `assertSafeTaskId` (re-exported from `scripts/lib/append-journal.mjs`) before any filesystem read** (per F-003) — OR taskId is only resolved against the snapshot's known task set with `{ ok: false, error: 'unknown task' }` for unknown ids.
- [ ] `next_command` calls `deriveNextCommand()` directly; result matches `node scripts/lib/derive-next-command-cli.mjs <taskId>`.
- [ ] `list_recommendations` reads `snapshot.recommendations`; falls back to `plans/overview-recommendations.json`; both missing → `{ ok: false, error: 'no recommendations available' }`. Supports `limit` and `stageFilter`.
- [ ] `list_blockers` returns tasks where `stage === 'blocked'` OR `Object.values(reviewOpenCount ?? {}).some((n) => (n ?? 0) > 0)` OR `(deferredQuestionsCount ?? 0) > 0`.
- [ ] One vitest test per tool covering happy path + at least one error case (e.g. missing snapshot, unknown task).
- [ ] Typecheck + vitest pass.
**Dependencies:** US-002
**Estimated complexity:** medium

## US-004: `add_journal_entry` tool + `appendJournalNote()` helper
**Description:** As an agent, I want to append a free-form note to a task's journal so I can record context without going through the bookkeeper.
**Acceptance Criteria:**
- [ ] `scripts/lib/append-journal.mjs` adds `appendJournalNote({ repoRoot, taskId, ts, note })`. Format: `- <ts>  note: <note>\n` with `\n  ` continuation for multi-line notes. Also export `assertSafeTaskId` (currently file-local) so other modules can reuse it (per F-003).
- [ ] `scripts/lib/append-journal.d.mts` declares `appendJournalEntry`, `appendJournalNote`, `formatJournalLine`, `assertSafeTaskId`.
- [ ] `scripts/lib/append-journal.test.mjs` extends with: single-line note, multi-line note, special-character note, and explicit regression checks that the pre-existing `appendJournalEntry` / `formatJournalLine` stage-transition test cases all pass unchanged (per F-013).
- [ ] MCP `overview.add_journal_entry` tool wraps `appendJournalNote()`. `ts` defaults to `new Date().toISOString()`. Validates `taskId` via `assertSafeTaskId`.
- [ ] Tests verify: (a) append is atomic (uses fsync), (b) `tasks/<taskId>/` is created idempotently via `fs.mkdirSync({ recursive: true })` — calling `appendJournalNote` twice succeeds with both lines appended, (c) existing stage-transition tests still pass (per F-009). Append semantics are NOT deduplicating — duplicate calls append duplicate lines by design.
- [ ] Typecheck + vitest pass for `scripts/lib/` and `tools/overview-mcp/`.
**Dependencies:** US-001
**Estimated complexity:** small

## US-005: `set_override` (structured edit of `overview-data.js`)
**Description:** As an agent, I want to set `ralphOverrides[slug] = taskId` in `plans/overview-data.js` without touching any other field.
**Acceptance Criteria:**
- [ ] `src/utils/set-override-edit.ts` exposes `editOverrides({ source, slug, taskId }): { source: string }` — pure function (no I/O).
- [ ] Uses `@babel/parser` only to LOCATE AST ranges; splices the original source string. Does NOT call `@babel/generator`.
- [ ] Handles both cases: `ralphOverrides` already present (replace value) or absent (insert immediately after `tasks:` property).
- [ ] Tool wrapper reads `config.dataFile`, calls `editOverrides`, validates the result parses, writes via `atomicWriteFile()`.
- [ ] Returns `{ ok: false, error }` on parse failure or absent `window.OVERVIEW_DATA` assignment — does NOT overwrite.
- [ ] Fixture lives at `tools/overview-mcp/src/__tests__/fixtures/overview-data.sample.js` — a trimmed but representative `window.OVERVIEW_DATA` with ~5 tasks and the full top-level key set (`generatedAt`, `generatedFromCommit`, `tasks`, `phaseTree`, `cadence`, `effort`, `lastTouched`, `periodic`, `risk`, `runs`, `sizeBucket`, `spawnedFrom`, `workstream`) (per F-014).
- [ ] Byte-range confinement test: capture the original source; run `editOverrides()`; compare every byte outside the replaced/inserted `[start, end]` range via `Buffer.compare(originalSlice, newSlice) === 0`. Run all four scenarios: (a) `ralphOverrides` absent → insert, (b) present, different value → replace, (c) present, same value → no-op (`result.source === input`), (d) malformed source → `{ ok: false, error }` returned, no write performed.
- [ ] Typecheck + vitest pass.
**Dependencies:** US-002
**Estimated complexity:** large

## US-006: `list_crew_sessions` (live re-read with 500 ms cache + LiveCrewSession shape)
**Description:** As an agent, I want to see live crew sessions per task (not the snapshot's cached view) so I can react to active members.
**Acceptance Criteria:**
- [ ] Tool reuses `discoverCrewSessions()` from `scripts/lib/crews-cross-walk.mjs` with fresh inputs (Ralph state + OverviewData + `config.crewsRoot`).
- [ ] Caches the discovery result for 500 ms (single call serves all reads within the window).
- [ ] Defines a local `LiveCrewSession` type (in `tools/overview-mcp/src/tools/list-crew-sessions.ts`) extending `CrewSessionRef` with `lastHeartbeatAt?`, `lastSummary?`, `lastTurnAt?`, `listenerState?`, `actorState?` populated by re-reading each match's `.crews/crews/<crew>/{members,leads}/<name>/manifest.json` (per F-006). `CrewSessionRef` in the shared types remains unchanged.
- [ ] Returns `Array<LiveCrewSession & { taskId: string; stage: RalphStage; role: 'member' | 'lead' }>` (per F-011).
- [ ] `taskId` filter (when provided) does an exact match on the flattened Map result — does NOT import the private `matchTaskId()` heuristic (per F-008).
- [ ] Live-read regression test: write a manifest with `lastHeartbeatAt = T1`, call the tool (returns T1), advance fake time 600 ms (past cache window), update manifest to `T2`, call again (returns T2).
- [ ] Typecheck + vitest pass.
**Dependencies:** US-002
**Estimated complexity:** medium

## US-007: `get_transcript` (JSONL reverse-tail with torn-line tolerance)
**Description:** As an agent, I want to read the tail of a session transcript by `sessionId` so I can review what another agent did.
**Acceptance Criteria:**
- [ ] `src/utils/transcript-tail.ts` exposes `tailTranscript({ transcriptPath, lastN, includeToolEvents }): Array<TranscriptTurn>`.
- [ ] Reads file backward in 64 KB chunks; stops when N complete lines collected or file exhausted; caps at 100 lastN.
- [ ] Tolerates a malformed final line (torn write) — skip without warning. Malformed interior lines log a single stderr warning per line.
- [ ] Filters `tool_use` / `tool_result` entries by default; `includeToolEvents: true` retains them.
- [ ] Tool resolves `sessionId → transcriptPath` via cached `discoverCrewSessions()` result (or scans `.crews/.../manifest.json` directly). Returns `{ ok: false, error: 'session not found' }` for unknown sessionId.
- [ ] Test fixture: JSONL with 50 mixed entries; assert last 20 user/assistant turns by default; assert full set with `includeToolEvents: true`; assert torn-line tolerance.
- [ ] Typecheck + vitest pass.
**Dependencies:** US-006
**Estimated complexity:** medium

## US-008: `invoke_next` (default + `viaCrewMember`)
**Description:** As an agent, I want one tool that either tells me the next command to run, or spawns a crew member to run it.
**Acceptance Criteria:**
- [ ] **Default mode (no `viaCrewMember`):** calls `deriveNextCommand()`, returns `{ ok: true, command: <NextCommand>, invocationGuidance: 'Use the Skill tool to invoke this — for example: Skill("ralph-orchestration:run-ralph", args="...")' }`.
- [ ] **Null command case (per F-010):** when `deriveNextCommand()` returns null (shipped task, non-actionable), the tool returns `{ ok: true, command: null, invocationGuidance: 'no next command — task is complete or has no actionable next step' }`.
- [ ] **`viaCrewMember` mode:** delegates to `runWorkOnViaCrew({ repoRoot, config, taskId, stage, crewName, memberName?, stdout: process.stderr })` (per F-001 — `stdout: process.stderr` MUST be passed to prevent the helper's confirmation line from corrupting the MCP JSON-RPC channel). Returns `{ ok: true, sessionRef }`.
- [ ] **Dynamic import for Plan-08 fallback (per F-007):** the handler uses `const mod = await import('../../scripts/lib/work-on-via-crew.mjs').catch(() => null)`. If null, returns `{ ok: false, error: 'requires plan 08' }`. NO top-level static import of `work-on-via-crew.mjs`.
- [ ] Tests with mocks for `runWorkOnViaCrew()` assert: (a) default mode happy path, (b) null command case, (c) `viaCrewMember` happy path with `stdout` arg validated, (d) Plan-08-missing fallback (mock the dynamic import to fail).
- [ ] Typecheck + vitest pass.
**Dependencies:** US-002, US-003
**Estimated complexity:** medium

## US-009: `install-server.ts` (`.claude/settings.local.json` patcher)
**Description:** As an operator, I want a one-command install that registers the MCP server in my machine-local settings.
**Acceptance Criteria:**
- [ ] CLI binary `overview-mcp-install` declared as `package.json.bin`.
- [ ] Reads `<repoRoot>/.claude/settings.local.json` (creates `{}` if absent).
- [ ] Merges under `mcpServers.codexu-overview`: `{ command: 'node', args: ['<absolute-forward-slash-path-to-dist/index.js>'] }`.
- [ ] Writes atomically via `atomicWriteFile()`.
- [ ] `--print-only` flag emits the JSON to stdout without writing.
- [ ] Errors clearly if `dist/index.js` is absent (asks user to run `pnpm overview-mcp:build` first).
- [ ] Test uses a temp dir as repoRoot; asserts file content after install; verifies idempotency (running twice produces the same file).
- [ ] Typecheck + vitest pass.
**Dependencies:** US-001
**Estimated complexity:** small

## US-010: README + final INDEX refresh + downstream-plan audit
**Description:** As a future maintainer, I want clear docs on installation, registration, and each tool's contract; and the project INDEX must reflect the new package.
**Acceptance Criteria:**
- [ ] `tools/overview-mcp/README.md` covers: install (`pnpm overview-mcp:build && pnpm overview-mcp:install`); registration JSON layout; verifying with `/mcp` (or the Claude Code tool list); per-tool contract (name, inputs, outputs, mutation behavior, error envelope); Windows-specific PowerShell verification commands.
- [ ] `plans/ralph-pipeline-INDEX.md`: Source-of-truth modules table lists `tools/overview-mcp/` and the new `appendJournalNote` export; DAG diagram shows Plan 09 dependency edges.
- [ ] Any reference in `plans/ralph-pipeline-10-ralph-handoff.md` (per F-005 — note the correct filename) is updated to mention the MCP package.
- [ ] Atomic final commit; commit message lists each diff (file, lines, what changed) so reviewers can audit the cascade.
- [ ] Typecheck across the workspace passes; full test suite passes.
**Dependencies:** US-001..US-009
**Estimated complexity:** small
