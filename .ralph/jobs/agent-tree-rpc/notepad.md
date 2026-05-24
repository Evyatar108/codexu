# Notepad: agent-tree-rpc

## PERMANENT

- Codex submodule (`codex/external/repos/codex-patched/`) is READ-ONLY. Never edit files there. Verify pre-commit with `git -C codex diff --name-only -- external/repos/codex-patched` returning empty AND `git diff --submodule=diff -- codex` returning no content delta.
- Single commit on `main` is the target — the worktree branch `agent-tree-rpc` will be squash-merged.
- AC4 primary acceptance is gated by `RUN_CODEX_INTEGRATION=1` env var; without it, vitest skips the gated test (and AC4 is NOT considered met).
- happy-server is embedded single-user per daemon process; `userId` plumbing is still required but functionally constant per process.

## User Preferences
_(none recorded; user not present this session)_

## Deferred Questions

| # | Question | Story ID | Iter Asked | Answer | Iter Answered | Auto-Resolved |
|---|----------|----------|------------|--------|---------------|---------------|

## Story Doctor Log
_(none yet)_

## Autonomous Decisions

- 2026-05-13T11:34Z — Invoked `/implement-with-ralph --from-plan` in autonomous mode because options-mode auto was active (user not present). Default reviewers, default iteration engine (codex).

## Working Notes

- Mode: autonomous. Iteration batch size 3, cumulativeCompleted=5 (after 7 iterations).
- Pass count 5/7 — US-001, US-002, US-003, US-004, US-005 complete with VALID evidence and matched commits (4f5762f9, 6f327e9c, e1a19de8, f37c9542, b2826f89). No unverified passes; no ISSUES.
- Blocked: US-006 (`blocked: true` set in iter 7; failureCount=1, classification=design_flaw, snapshot at failures/US-006_2026-05-13T20-53-44Z.json, partial branch partial/US-006 @ ba8b6a73). Real Codex child agents lack spawn_agent/wait_agent tools, so nested A→B topology cannot be produced under current codex submodule pin.
- Dep-blocked: US-007 (waits on US-006 — now permanently blocked).
- Iter 7 was metadata-only: flipped US-006 `blocked: true` in prd.json; no worktree code commits since US-005 (b2826f89). Pass count unchanged (5 → 5).
- Retry Gate decision: design_flaw → 0 retries → already escalated to BLOCKED. Story Doctor not invoked this iteration (story already blocked; 2-consecutive-run threshold not met with failureCount=1).
- Quality Gate: SKIPPED — no new passes crossed a multiple of qualityGateFrequency=1; cumulativeCompleted stayed at 5. Prior iter-6 Quality Gate result (PASS — happy-wire build/typecheck, happy-cli typecheck, happy-cli focused agent-tree tests 10/10, happy-server typecheck, happy-server full test 88/88 across 17 files) remains the latest baseline.
- Refactoring Pass: SKIPPED — iter 7 batch is metadata-only (test-only/docs-only detection: 0 production files changed; only the data-repo `prd.json` was touched). Cross-story consolidation should wait until US-006 acceptance is revised or unblocked.
- Codex submodule read-only invariant: PRESERVED. `git diff -- codex/external/repos/codex-patched` and `git diff --submodule=diff -- codex` both empty across iter 4–7.
- Recurring-failure detection: legacy job (no `startCommit` in job-state.json); recurrence detection unavailable. US-006 occurrences=1; no PERMANENT/Not-tested promotion.
- Recommendation: BLOCKED. Unblock by (a) revising US-006 AC to relax nested-B topology to flat sibling A+B or single-child A as the real-Codex proof, or (b) updating the codex submodule pin to a version where child agents expose `spawn_agent`/`wait_agent`.

## Security Review Open Items (deferred from Phase 5c)

Logged 2026-05-13:
- **F-001 (Medium):** taskMessage/lastTaskMessage are plaintext on the Socket.IO channel. Matches existing happy-cli plaintext-RPC boundary for control codes. Follow-up: encrypt or document in security-model.md.
- **F-002 (Low):** Unbounded z.string() in agent-tree schemas; cross-cutting hardening should land uniformly across all wire schemas.
- **F-003 (Low):** sessionGetAgentTree handler ignores params.sessionId; session boundary already enforced by rpc routing.
- **F-004 (Low, was prd-worthy):** No rate cap on agent-tree-update fan-out. Bounded by single-user-per-daemon invariant; relax with multi-tenant work (matches the userid-cleanup task).
