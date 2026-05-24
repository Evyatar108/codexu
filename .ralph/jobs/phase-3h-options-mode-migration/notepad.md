# Job Notepad — phase-3h-options-mode-migration

## PERMANENT

- This job ports the upstream `options-mode` Claude Code plugin (v0.16.12) to a new codex plugin under `packages/codexu-options-mode-plugin/`. Source plugin at `C:/Users/evmitran/.claude/plugins/cache/ai-developer-toolkit/options-mode/0.16.12/`.
- 7 load-bearing invariants from Phase 4 plan review (also in `prd.json.metadata.implementationInvariants` and job `CLAUDE.md`):
  1. `NullableString` is `serde(transparent)` — `transcript_path` and `last_assistant_message` are plain `string | null`. Read directly. (`hooks/src/schema.rs:34-35`)
  2. `stop_hook_active` semantics IDENTICAL to upstream Claude — init false, set true AFTER block. Port `if (input.stop_hook_active === true) return;` UNCHANGED. (`session/turn.rs:366, 557`)
  3. NO PreToolUse hook for AskUserQuestion on codex — `request_user_input` handler has no `pre_tool_use_payload()`. Drop the upstream PreToolUse block in `hooks.json`.
  4. TUI does NOT reject unknown slash commands — `/options-mode <args>` reaches UserPromptSubmit. UserPromptSubmit is primary toggle; skill is documentation-only. (`chat_composer.rs:2797-2823`)
  5. `${CLAUDE_PLUGIN_ROOT}` env var is codex-set. Keep upstream form unchanged. (`hooks/src/engine/discovery.rs:181-186`)
  6. `PLUGIN_DATA` env var is codex-set plugin data root. Use directly in `config.js` `getConfigRoot()`; fail-loud if unset. (`discovery.rs:184-186`)
  7. Plugin source vs marketplace cache divergence — edits to source don't propagate to `~/.codex/plugins/cache/...`. README + CLAUDE.md must document.

## User Preferences

(None recorded — operator absent during planning/setup.)

## Deferred Questions

| # | Question | Story ID | Iter Asked | Answer | Iter Answered | Auto-Resolved |
|---|----------|----------|------------|--------|---------------|---------------|

## Story Doctor Log

(none yet)

## Autonomous Decisions

- 2026-05-13: Plan-with-ralph operator was absent (auto options-mode). Selected Recommended defaults: skill-only slash command surface (then revised to UserPromptSubmit-primary after F-004), defer statusline to Phase 3h-tail, `PLUGIN_DATA` for state. Documented in `requirements-gaps.md`.
- 2026-05-13: Phase 4 plan review found 2 Critical + 6 High findings; fixed inline (option B) rather than via review-loop.sh because findings were unambiguous and verified against codex source.
- 2026-05-13: Implement-with-ralph operator was absent (auto options-mode). Switched to autonomous mode per skill contract.
- 2026-05-13: `securityFixLoop: false` chosen because the plugin is hooks + Node.js file I/O only; no auth/crypto/network surface.

## Working Notes

- Iteration 3 complete. Pass count: 3/6 (US-001, US-002, US-003 passing). Mode: autonomous. Branch: `phase-3h-options-mode-plugin` from `main`. Worktree at `<job_dir>/worktree`.
- Next-up: US-004 (Rewrite stop.js for codex last_assistant_message + transcript scan) — only unblocked remaining story. US-005 dep-blocked on US-004; US-006 dep-blocked on US-004/US-005.
- Both AC relaxations (statusline, auto-intercept) are documented in plan; iteration agents should NOT attempt to satisfy these — they are explicit Phase 3h-tail follow-ups.
- Recurring-failure detection unavailable: `job-state.json.startCommit` is `null` (legacy job init); `parse-not-tested-trailers.sh` was not invoked. No Not-tested candidates surfaced.
- [Criteria Validator 2026-05-13] 3 blockers auto-fixed (pre-iteration):
  - US-003: removed duplicate "All tests pass" criterion (idx 4); idx 6 "Tests pass" (whitelisted) covers it.
  - US-004: removed duplicate "All tests pass" criterion (idx 18); idx 20 "Tests pass" (whitelisted) covers it.
  - US-006 idx 5: rewrote manual smoke test to script-verifiable form (`scripts/smoke.mjs` runs the sequence; README documents manual codex-CLI equivalent for human verification).
- [Criteria Validator 2026-05-13] 3 warnings logged (tool-availability/verifiability):
  - US-005:AC-005 (manual trigger / live TUI session) — fallback: indirect coverage via US-004 unit tests; record SKIPPED if codex CLI unavailable.
  - US-005:AC-004 (codex-tui.log inspection) — fallback: static schema check.
  - US-006:AC-007 (skill listing in codex) — fallback: static SKILL.md frontmatter check.
- [Iter 3 analysis] Parity spot-check on US-003 (byte-identical claim) PASSED — diff-based mirror verification confirmed user-prompt-submit.js byte-identical, session-start.js differs only by documented `options-mode: <mode>\n` prefix.
- [Phase 6 2026-05-13] Job COMPLETE. 6/6 stories pass. Convergence: code clean (1 round / 11 findings fixed), docs clean (1 round / 5 findings fixed), security clean (0 findings). Terminal: complete.
- [Phase 6 2026-05-13] `main` advanced 10 commits during the run (sync, native-agent-parity docs, async-events-design landed, US-005 docs, overview UI fixes). Merge-base diff is clean (37 files / +2251 / -136). Operator should rebase `phase-3h-options-mode-plugin` onto current `main` before merge — expect potential conflicts in `plans/codexu-roadmap.md`, `plans/overview.html`, `plans/parallel-assignments.md`.
- [Phase 6 2026-05-13] DSAT highlights: 6/6 first-try pass, 0 rollbacks, 0 Story Doctor invocations. DSAT noted: (1) prompts/claude.md should require negative-path coverage for early-`return`s in enforcement layers (4 High fail-open bugs in stop.js were caught only by Phase 5a code review); (2) `job-state.json.startCommit` was null, silently disabling recurring-failure detection — implement-with-ralph should backfill on iteration 1.
