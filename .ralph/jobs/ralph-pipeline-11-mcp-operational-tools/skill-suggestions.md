# Skill Suggestions

## Candidate: mcp-subprocess-manager
- Description: Scaffold and review a ProcessManager-backed MCP tool cluster (long-running + one-shot children) with ring-buffered logs, single-flight reserved names, ANSI-stripping ready detection, Windows tree-kill shutdown, and `stopAll()` wiring into the server's SIGINT/SIGTERM path.
- Triggers: User adds MCP tools that spawn child processes (vite dev, build, sync scripts) under an existing MCP server; phrases like "add overview MCP tool that runs", "manage long-running subprocess from MCP", "ProcessManager", "tree-kill on Windows", "one-shot vs persistent process tool".
- Target location: `plugins/ralph-orchestration/skills/mcp-subprocess-manager/SKILL.md` (or repo-level `.claude/skills/mcp-subprocess-manager/SKILL.md` since the pattern is currently codexu-specific).
- Evidence:
  - `progress.txt` Codebase Patterns section enumerates the full pattern (top-level `{ ok, ... }` envelope for operational tools, reserved transient names `build` / `sync-now`, AlreadyRunning as the single-flight guard, Windows tree-kill ESRCH handling).
  - Commits `7532573a` (US-001 ProcessManager foundation, `Constraint: Windows shell:true subprocesses require tree-kill`), `cbdde971` (US-004 dev-server), `55cfb916` (US-005 build, `Constraint: single-flight uses ProcessManager reserved name 'build'` / `Rejected: module-level build flag | ProcessManager AlreadyRunning is the guard`), `44c12f8a` (US-006 sync.now/watch_status), `b0ecf02e` (US-007 shutdown).
  - Plan-review findings F-001..F-008 in `plan-review-findings.json` and `prd.json.planReviewContext` capture the exact subclass of mistakes a skill should preempt: arrow-prefixed Vite banner regex, double-start race needing `readyPromise`, missing start-failure cleanup, untracked transient children orphaned by `stopAll`, hung-child not throwing after SIGKILL, `Promise.all` vs `Promise.allSettled` in `stopAll`.
  - Job CLAUDE.md hardcodes the same constraints: `stdio: ['ignore','pipe','pipe']`, pnpm `{ shell: true }` on Windows, reserved names only, no module-level booleans.
- Rationale: Five files (`process-manager.ts`, `dev-server-*.ts`, `build.ts`, `sync-now.ts`, `index.ts`) replicate the same six-part recipe (spawn → ready signal → AlreadyRunning → start-failure cleanup → exitPromise → shutdown wiring). Eight of twelve plan-review High findings were variations on this recipe being implemented slightly wrong. No existing skill in the plugin or repo inventory covers MCP-server subprocess management; `run-tests`, `simplify`, `review` are unrelated. This is a durable, copy-pasteable workflow whose failure modes are well-attested across plan review and post-iteration fixes.

## Candidate: ac-contract-string-audit
- Description: Audit the three-way agreement between plan AC text, README/docs, and implementation for exact error strings, numeric clamps, and idempotent return shapes; surface mismatches before review.
- Triggers: User completes an MCP tool, CLI command, or any feature with documented error contracts; phrases like "match AC wording", "error string contract", "verify README matches implementation", or running post-implementation code review on a feature that defines exact error messages.
- Target location: `plugins/ralph-orchestration/skills/ac-contract-string-audit/SKILL.md` (process-quality skill that complements `review-changes`).
- Evidence:
  - `code-review-findings.json` F-001 (`dev_server.stop` not idempotent — AC said `{ ok:true, stoppedAt }`, impl returned `{ ok:false, error: 'dev server is not running' }`), F-002 (tailLogs 30 vs AC-required 10), F-003 (`sync already in progress` vs AC `another sync in progress`).
  - `docs-review-findings.json` F-001 (README line 142 string drift on the same `another sync in progress` contract), F-002 (README "last 30 lines" vs impl 10).
  - Commits `bd0a660f` (F-001), `33c860f1` (F-002), `a32d8b02` (F-003), `2771d150` (docs F-001), `e1f5d11c` (docs F-002) — five separate fix commits, all post-implementation, all string/numeric drift across plan/README/code.
- Rationale: The same drift class triggered findings in two reviewers (code + docs) and required five follow-up commits, despite all seven stories passing first try. Existing `review-changes` and `simplify` skills examine code quality but do not specifically diff acceptance-criteria literals against README and implementation literals. A focused audit (grep each AC-quoted string and number across the three artifacts) would have caught all five fixes in one pass.

## Candidate: mcp-stdio-tools-list-exact-set
- Description: When adding or removing an MCP tool, update the stdio smoke test to assert the exact SET of tool names (not just the count) and bump the count assertion atomically; document the per-story expected tool count in the job CLAUDE.md.
- Triggers: User adds a new tool to an MCP server via `server.registerTool` or via tool-local registration; phrases like "register MCP tool", "stdio smoke test", "tools/list assertion", or any diff that adds a file under `src/tools/`.
- Target location: `plugins/ralph-orchestration/skills/mcp-stdio-tools-list-exact-set/SKILL.md` (small companion skill; alternatively a section inside `mcp-subprocess-manager`).
- Evidence:
  - `progress.txt` iteration logs explicitly track the exact tool counts per story: US-004 → 14, US-005 → 15, US-006 → 17, US-007 confirms 17.
  - Job `CLAUDE.md`: "Per-story stdio-tools-list count: US-004 → 14, US-005 → 15, US-006 → 17, US-007 confirms 17. Assert the exact SET of tool names, not just the count."
  - Files changed in US-004, US-005, US-006 all include `src/__tests__/stdio-tools-list.test.ts` as a co-modified file; the test was updated four times in seven iterations.
  - `prd.json.planReviewContext` F-006 also documents how adding a context field to `ServerContext` cascades into `helpers.ts` and three other direct context-literal tests — same "atomic cascade" pattern.
- Rationale: This is a small, mechanical, recurring co-modification pattern (`src/tools/*.ts` + `schemas.ts` + `server.ts` + `__tests__/stdio-tools-list.test.ts` + README, all in one commit). The plan reviewer explicitly cited the risk and the job CLAUDE.md preemptively documented it, which is exactly the shape of guidance that belongs in a skill rather than per-job CLAUDE.md duplication. No existing skill captures it.
