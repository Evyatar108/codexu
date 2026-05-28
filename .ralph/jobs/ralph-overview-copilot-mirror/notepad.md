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

- Mode: autonomous; batch size: 3; cumulative completed: 7.
- Pass count: 7 (US-001..US-007). Blocked: 1 (US-008, external-dependency). Remaining (actionable): 0.
- Job status: COMPLETED per job-state.json (iter 8 terminal). All 8 stories addressed.
- Manifest verifier (this batch, iters 7-8): subagent-spawn tool unavailable in analyzer environment; structural validation passed on both manifests. Iter 7 manifest = 5 verifiedEvidence (US-007). Iter 8 manifest = 10 verifiedEvidence + 3 skippedReasons + 2 notTested (US-008, all skipped/fallback evidence justified by external-dependency).
- Quality Gate (this batch): SKIPPED — subagent-spawn unavailable in analyzer environment. In-iteration typecheck + plugin tests recorded in verifiedEvidence cover the surface (US-007: overview-mcp 96/96, overview-viewer 256 passed/5 skipped, typecheck clean; US-008: typecheck clean, overview-mcp 96/96).
- Parity spot-check (this batch): US-007 AC text does not contain `mirror|parity|reuse` keywords on the documentation surface; US-008 AC text does not match either. Skipped (no triggers, no warning).
- Refactoring Pass: cumulative completed 7 does not cross multiple of 5; not triggered this run. Next trigger at completion 10.
- Auto-rollback: none (US-007 evidence VALID; US-008 is operator-blocked with notes, not an unverified pass).
- Retry Gate (US-008): classification `external-dependency` (Copilot CLI 1.0.55 MCP-registration gap + marketplace v2.3.0 lag). 0 retries — not retryable by ralph; needs operator action (publish v2.4.0 marketplace entry; re-verify on a Copilot CLI build that exposes plugin MCP servers OR adjust manifest to whatever schema Copilot honors).
- Story Doctor: not triggered (US-008 has only 1 failed run; failure is environmental, not story-design).
- Deferred questions: none detected in iter 7/8 manifests.
- Next operator action: ship US-007 docs (already committed as `ad5fe390`). For US-008 see `deferred-us008-followup.md` in job dir — gate must be re-run after marketplace publication.
