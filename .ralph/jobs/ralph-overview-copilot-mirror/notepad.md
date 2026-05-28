## PERMANENT

This job ships ralph-overview v2.4.0 (Copilot mirror) to the **ai-developer-toolkit** repo.

- **Cross-repo**: `job_dir` lives in codexu (`D:/harness-efforts/codexu/.ralph/jobs/ralph-overview-copilot-mirror/`); `work_dir`/`repoDir` is the ai-developer-toolkit worktree (`D:/ai-developer-toolkit/.worktrees/ralph-overview-copilot-mirror/`) on branch `ralph/ralph-overview-copilot-mirror` off `origin/main@0493680c`.
- **Multi-remote push at merge time**: ai-developer-toolkit has `origin` (Evyatar108) and `work` (gim-home) remotes — push to BOTH.
- **Copilot CLI is installed**: verified `copilot --version` returned `1.0.55-7` and `copilot mcp list` works. US-008 smoke is REACHABLE on this host.
- **Plan corrections** (codified in PRD per spawn prompt):
  - Manifest path: `.github/plugin/plugin.json` (NOT `.copilot-plugin/plugin.json`)
  - 5 MCP tools dotted names: `overview.init`, `overview.validate_data`, `overview.parallel_ready_tasks`, `overview.dev_server.start`, `overview.dev_server.stop` (verify against `server.ts` HEAD at impl time)
  - Generator at `dist/copilot/` is REFACTOR not CREATE
  - Drop `install-copilot-mcp.mjs` from scope; manifest `mcpServers` handles registration
  - Source skills must drop bare `ralph-overview sync` PATH assumptions (US-002)
- **3 Open Questions from plan** (F-008, F-009, F-010) to address in Phase 5a fix loop:
  - F-008: forbidden token list `['Skill(', 'Agent(', 'BashOutput', 'run_in_background', 'EnterPlanMode', 'ExitPlanMode']`
  - F-009: use `tools/overview-mcp/src/__tests__/stdio-tools-list.test.ts` as canonical tool-list assertion; derive README list from `server.ts` not from this plan's 5-tool list
  - F-010: justify or drop `parity-exceptions.json` (recommended drop since generator doesn't consume it)

## User Preferences

(none yet)

## Deferred Questions

| # | Question | Story ID | Iter Asked | Answer | Iter Answered | Auto-Resolved |
|---|----------|----------|------------|--------|---------------|---------------|

## Story Doctor Log

(none yet)

## Autonomous Decisions

- 2026-05-28: Job spawned in `--autonomous` mode. No clarifying questions relayed during Phase 2 PRD generation.

## Working Notes

- Mode: autonomous; batch size: 3; cumulative completed: 6.
- Pass count: 6 (US-001 .. US-006). Remaining: 2 (US-007 docs, US-008 pre-merge Copilot install gate). Blocked: 0 (US-008 is dependency-blocked behind US-007 until US-007 passes).
- Manifest verifier (advisory, iters 4-6): all verdicts=agree on every AC, no warnings. Earlier iter 3 warning (extra `Plugin tests pass` evidence) carries over without effect.
- Quality Gate (this batch): not executed in analyze-iteration this run (no subagent-spawn tool available in analyzer environment); evidence validation + manifest-verifier covered the same surface (typecheck + plugin tests run in-iteration per AC). Operator should run Quality Gate manually if a deslop scan is desired.
- Parity spot-check (this batch): no AC in US-004/US-005/US-006 triggers parity keywords on the AC text itself — skipped (no warning).
- Refactoring Pass: cumulative completed 6 crosses multiple of 5; skipped this run for the same subagent-spawn reason. Batch is not test-only (production manifests/marketplace JSONs + generator changed), so a future Refactoring Pass on iteration 10 should be honored.
- Auto-rollback: none (all 6 stories VALID).
- Story Doctor: none (no story has 2+ consecutive failed runs).
- Deferred questions: none detected in progress.txt for iters 4-6.
- Next: US-007 (docs: CHANGELOG/README/plugin CLAUDE.md) — now unblocked since dep US-005 passes. Then US-008 (pre-merge Copilot install + MCP runtime gate).
