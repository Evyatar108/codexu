# Ralph System DSAT: realtime-sync-perf-ws3

Plugin version: v5.24.0

## Summary

This was a 7-story, 7-iteration job with **100% first-pass success** (every story passed on its first iteration, zero rollbacks, zero Story Doctor interventions, zero deferred questions). Total runtime ~51 minutes (avg 7.4 min/story). Plan-review surfaced 9 findings before execution started; code review surfaced 10 findings across 3 review cycles (3 High severity, all real correctness bugs). Docs review caught 1 stale-doc issue. Security review caught 1 input-validation gap. All review fixes converged in 1–2 rounds.

Headline: the **execution loop** ran flawlessly; the **review-fix loop** did the heavy lifting catching three High-severity correctness bugs (daemon-restart overflow loop, premature cursor advance on missing-session, addConnection-before-replay race) that the iteration agent shipped with full self-claimed evidence.

## Agent Effectiveness

| Agent | Invocations | Quality Issues | Details |
|-------|-------------|----------------|---------|
| Criteria Validator | 1 (Phase 2.7) | None observed | All 7 stories had concrete, testable ACs; no vague criteria slipped through. Plan was already heavily-reviewed (planReviewContext F-001..F-009) before execution. |
| Iteration Agent (codex) | 7 | High-quality evidence collection (verifiedEvidence on every AC) BUT shipped 3 High-severity correctness bugs that needed Phase 5a to catch | Each story passed first try with detailed `verifiedEvidence` (16–18 entries on the big stories). Yet US-005 alone shipped F-001, F-002, F-003, F-004 — four code-review findings, three High. The agent satisfied the literal ACs but missed cross-story invariants. |
| Progress Analyst | 7 | Working as intended — no false passes, no false failures | Recurrence detection was unavailable all 7 iterations because `job-state.json` lacked `startCommit` (noted in progress.txt every iter). |
| Story Doctor | 0 | N/A — never invoked | No failures triggered intervention. |
| Code Reviewer (Claude) | 3 rounds | Excellent fixable-to-prd ratio: 6/6 findings fixable, 0 PRD-worthy. F-001/F-002/F-003 are exactly the kind of subtle correctness bugs human reviewers would catch. | Found 3 High-severity bugs that survived the iteration agent's own evidence collection. F-007/F-008/F-009/F-010 from Copilot were all duplicates of F-001..F-005. |
| Code Reviewer (Copilot) | 3 rounds | 100% duplicate detection rate (4/4 of its findings duplicated Claude's). Net unique value = 0 for this job. | Worth keeping for cross-validation, but a budget-conscious config could downgrade Copilot to one round. |
| Docs Reviewer | 1 round | Caught 1 real stale-doc issue (F-001 docs): CLAUDE.md still described monotonic-only setter after `resetLastSeenUpdateSeq` was introduced in Phase 5a. Tight, non-noisy. | Good catch — exactly the kind of staleness that would have been merged silently. |
| Security Reviewer | 2 rounds | 1 Low fixable (input validation on `currentSeq` from wire), 1 Low wont_fix (DoS amplification, accepted under one-user-per-daemon trust model). Both well-reasoned. | Good signal-to-noise. The accepted wont_fix is well-justified. |
| Plan Reviewer (pre-execution) | 1 round | F-001/F-002/F-004/F-006 fixed in plan; F-003/F-005 hit agent-failure path ("skipped-after-2-retries" because agent didn't emit `<review-meta>`). | **Friction signal**: 2 of 9 plan-review findings died because the fixer agent didn't emit the required sentinel block on retry. See review-log.json lines 18-19, 36-37. |

## Prompt/Instruction Gaps

| Signal | Story/Iteration | Affected File | Suggested Fix |
|--------|-----------------|---------------|---------------|
| Iteration agent self-claimed full evidence on US-005 (18/18 ACs verified) yet shipped 3 High-severity correctness bugs (F-001 daemon-restart overflow loop, F-002 premature cursor advance, F-003 race-before-join) | US-005 iter 5 | `prompts/claude.md`, `agents/code-fixer.md`, `skills/implement-with-ralph/SKILL.md` | Add a "Cross-story invariant check" step before claiming a story passes — explicitly walk failure recovery paths (`replay-overflow` after daemon restart, missing-session drop on replay) using the existing planReviewContext (Risk #7 was explicit about daemon-restart but the agent didn't synthesize it into a test). |
| F-005 commit-scope bleed: 9 unrelated test/source files (refreshClaim.ts, profile.test.ts, etc.) were bundled into the WS3 commit because they were stale-baseline blockers for the combined Vitest run | US-007 iter 7 | `skills/implement-with-ralph/SKILL.md` Phase 4, job CLAUDE.md template | Add explicit guidance: when stale-baseline test fixes are required for verification, land them as a precursor commit BEFORE the WS3 commit — don't bundle. The current job CLAUDE.md only says "single commit on main" without saying what to do when baselines drift. |
| Plan-review F-003 and F-005 both hit "skipped-after-2-retries" because the fixer agent failed to emit `<review-meta>` sentinel | review-log.json lines 18-19, 36-37 | `agents/plan-reviewer.md` or whichever fixer handles plan-review findings | The fixer for plan-review findings should have a stronger sentinel-emission contract or a deterministic fallback. Losing 2/9 findings to a sentinel-parsing failure is a real defect rate. |
| `job-state.json` never had `startCommit`, so recurrence detection was unavailable all 7 iterations (logged 7 times in progress.txt) | All 7 iters | `skills/implement-with-ralph/SKILL.md` Phase 2.5 (or wherever `job-state.json` is scaffolded) | When a job uses `worktree.external: true` (work directly on existing branch), capture `git rev-parse HEAD` as `startCommit` at job creation. The "no separate worktree" path silently skips this. |
| Refactoring Pass deferred at cumulative-5 and skipped at cumulative-6/7 because "WS3 lands as a single commit on main" — the gate is effectively dead for any single-commit job shape | iters 5, 6, 7 | `skills/analyze-iteration/SKILL.md` Refactoring Pass step | Refactoring Pass should detect `worktree.external: true` + single-commit job-style upfront and skip with a single concise log line instead of evaluating + deferring each iteration. |
| F-006 (docs) — plan footer placeholder `pending-US-007-single-WS3-commit` left in `plans/realtime-sync-perf.md` because the iteration agent for US-006 had no way to know the future commit SHA | US-006 iter 6 | `skills/implement-with-ralph/SKILL.md` Phase 4 verification step, or new "post-commit doc fixup" sub-step | For workflows where docs reference the final commit SHA, add a post-final-commit fixup step that resolves placeholders. Currently relies on Phase 5b docs review to catch it (which did, but as a separate review cycle). |

## Workflow Friction

| Phase/Step | Friction Signal | Impact | Suggested Fix |
|------------|-----------------|--------|---------------|
| Phase 5a code review convergence | 3 rounds before convergence; F-002 only fully fixed in round 2 (the iter-1 fix moved persist to `.finally()`, still wrong, finally gated on session-existence in round 2) | ~127s + 155s + 134s + 122s + 222s = ~12 min on findings 1–6; full Phase 5a wall time considerable | The Claude code-reviewer correctly flagged that `.finally()` runs on reject too — this should have been caught in iter-5 by the iteration agent. Add to `agents/code-fixer.md`: "When converting deferred work between `.then`/`.catch`/`.finally`, explicitly state which branches run on resolve vs reject." |
| Phase 5a Copilot reviewer | 4/4 findings were duplicates (F-007=F-002, F-008=F-003, F-009=F-004, F-010=F-005) | Cost ~4 review-fixer cycles that produced no unique signal; all marked `wont_fix` with "Duplicate of F-00X" | Add a dedup pre-pass in `skills/review-changes/SKILL.md`: when Copilot findings overlap >70% on `relevantFiles` + category with an existing Claude finding, auto-merge into `detectedBy: [claude, copilot]` instead of opening a separate finding. The current process did this manually via `wont_fix` resolutions; doing it programmatically saves cycles. |
| Phase 5b docs review | 1 round, 1 finding, fixed in 1 iter — clean | None | No change needed. |
| Phase 5c security review | 2 rounds; round-2 F-001 added a `NOTE: The round 2 diff did not change this surface` clause — the reviewer re-flagged unchanged code as still open | Mild — accepted as `wont_fix` quickly | Security reviewer prompt could include: "If the round-N diff did not touch the surface, do not re-emit the finding; reference the prior decision instead." |

## Orchestration Metrics

- **Efficiency ratio (stories / iterations):** 7 stories / 7 iterations = 1.00 (optimal)
- **Auto-rollback rate:** 0 / 7 passes = 0%
- **Deferred questions:** 0 resolved / 0 total (none asked)
- **Story Doctor interventions:** 0
- **PRD-worthy findings:** 0 (all 10 code-review findings were `fixable`; original plan was correct)
- **Code review convergence:** 3 rounds, 10 findings total (6 unique fixable + 4 Copilot duplicates)
- **Docs review convergence:** 1 round, 1 finding
- **Security review convergence:** 2 rounds, 2 findings (1 fixed, 1 wont_fix)
- **Total wall time:** ~51 min execution + Phase 5 review cycles
- **Avg time per story:** 444 s (7.4 min)
- **Fastest story:** US-006 (docs, 199 s)
- **Slowest story:** US-007 (final verification + commit + baseline fixes, 604 s)
- **Plan-review finding loss rate:** 2/9 (F-003, F-005) dropped due to sentinel-emission failures

## Recommendations

1. **`agents/code-fixer.md` and `prompts/claude.md`**: Add an explicit "Failure-path test gate" at the end of each story before claiming evidence-VALID. Walk through each failure path called out in `planReviewContext` (here: Risk #7 daemon-restart, Risk #8 missing-session drop) and assert a regression test exists. US-005 had 18 ACs of evidence but missed the failure paths that the planReviewContext explicitly called out — the literal-AC-satisfaction bar is too low for stories that touch multi-async invariants.

2. **`skills/review-changes/SKILL.md`**: Add a finding-dedup pre-pass between reviewers. The Copilot/Claude overlap on this job was 100% on its findings (4/4); merging into `detectedBy: [claude, copilot]` upfront would save the per-finding fix cycle that each one currently consumes (even when fast-resolved as `wont_fix: duplicate`).

3. **`skills/implement-with-ralph/SKILL.md` Phase 2.5 (job scaffolding)**: When `worktree.external: true`, capture `git rev-parse HEAD` of the target branch as `startCommit` in `job-state.json`. Recurrence detection silently no-op'd all 7 iterations because this field was missing — a meaningful safety net was disabled for the entire job.

4. **`agents/plan-reviewer.md` (or the plan-review fixer agent)**: Harden the `<review-meta>` sentinel emission contract. Two of nine plan-review findings (F-003, F-005) were lost to `skipped-after-2-retries` — a 22% finding-loss rate due to format compliance. Either enforce sentinel emission via post-processing fallback (parse free-text response if sentinel missing) or fail-loud instead of silent skip.

5. **`skills/implement-with-ralph/SKILL.md` (commit-scope policy)** and job CLAUDE.md template: Add explicit guidance for the "single commit on main" job shape when stale-baseline test fixes are required for verification — these should land as a precursor commit, not bundled. F-005 (`wont_fix`, history-fixed) documented exactly this regret on this job.

6. **`skills/analyze-iteration/SKILL.md` Refactoring Pass**: Detect single-commit job shapes (`worktree.external: true` + job-CLAUDE.md "single commit" constraint) upfront and skip the refactoring gate with one log line. Currently it evaluates and defers/skips on every multiple-of-5 iteration with verbose reasoning — pure overhead.

7. **`agents/security-reviewer.md`**: Add guidance "if the round-N diff did not touch the flagged surface, reference the prior round's decision and do not re-emit the finding." Round-2 security review's F-001 already noted the diff didn't change the surface but still emitted it; this caused a wont_fix loop.

8. **`skills/implement-with-ralph/SKILL.md` Phase 4 (or 5b)**: For workflows where docs reference the final commit SHA, add an explicit post-commit doc-fixup step. The placeholder `pending-US-007-single-WS3-commit` landed in `plans/realtime-sync-perf.md` and was only fixed via Phase 5a F-006 — a separate review cycle for a deterministic substitution.
