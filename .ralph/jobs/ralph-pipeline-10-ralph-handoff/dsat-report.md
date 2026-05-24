# Ralph System DSAT: ralph-pipeline-10-ralph-handoff (Ralph plugin handoff doc — overviewTaskId field)

Plugin version: v5.32.0

## Summary signals

- 1 story, 1 iteration, pass on first try (891 s). Iteration agent behaved well.
- The friction was almost entirely upstream of `ralph.sh`: the plan-review loop hit the **soft cap at iteration 5 with 6 open Medium findings** that were then dumped into "Open Questions > Soft-cap" and excluded by the plan-review filter (per `notepad.md` Autonomous Decisions, 8 Mediums were filtered as "unclassified-fixable").
- Of those 6 deferred Mediums, **at least 4 were real and load-bearing** for the deliverable (F-005, F-006, F-007, F-009 all surface as explicit acceptance criteria on US-001 — meaning the story was rewritten to absorb the un-fixed plan findings rather than the plan being fixed). This is a process smell: the plan-review soft cap silently shifts work into AC list bloat.

## Agent Effectiveness

| Agent | Invocations | Quality Issues | Details |
|-------|-------------|----------------|---------|
| Criteria Validator | 1 (Phase 2.5, story setup) | None observed | 17 ACs were specific, individually verifiable, and every one got matching `verifiedEvidence` (analysis-result.json: "VALID, 17/17 covered, each prefixed PASS:"). |
| Plan Reviewer (Codex + Copilot consensus) | 1 round, 10 findings | Consensus quality high; **soft-cap exit suspicious** | F-001/F-002 (Highs) were correct and were fixed. But F-005 (skill-patch coverage criterion was literally false), F-006 (missing §3.5 conditional patch), F-007 (`yq` portability), F-009 (landing-order prerequisite) all became AC bullets on US-001 instead of plan fixes. They were classified "unclassified-fixable" and filtered out by the plan-review filter — but they had concrete `suggestedFix` strings, so the filter was over-aggressive. |
| Progress Analyst | 1 invocation post-iteration | Accurate | Correctly classified US-001 as pass, recommended BLOCKED (job complete), validated evidence. patternAwareChecks all "not triggered". |
| Story Doctor | 0 | n/a | Not needed — single story passed first try. |
| Code Reviewer (Phase 5a) | 2 rounds (review-cycle 0, then re-review round 1) | High quality | Found 2 real issues: F-001 (3.3 brainstorm metadata coupled to 6.1 plan-format decision — a real consistency bug introduced during the plan-review fix cycle) and F-002 (Section 7 numbered the conditional step 5 while the prose said "before steps 2-4"). Both fixable, both fixed, both well-justified. No noise. |
| Docs Reviewer (Phase 5b) | 1 round | Clean (0 findings) | Appropriate — this job's deliverable IS a doc, and the related INDEX was correctly audited as unchanged. |
| Security Reviewer (Phase 5c) | Skipped after `security_relevant: true`? | Indeterminate | `review-metadata.json` flags `security_relevant: true` but no `security-review-findings.json` exists. Either the security review was skipped (process gap) or its output was never persisted. **Recommendation: investigate why.** |
| Iteration Agent (Codex, claude-exec=Codex per `iterationEngine: "codex"`) | 1 | None | Wrote a 17-AC doc, ran typecheck + tests, restored unrelated generated files before committing (per progress.txt learnings). Commit `d3cddcd5` carries `Constraint:` trailer correctly. |

## Prompt/Instruction Gaps

| Signal | Story/Iteration | Affected File | Suggested Fix |
|--------|-----------------|---------------|---------------|
| Plan-review filter classified 8 Mediums as "unclassified-fixable" and excluded them, but each had a concrete `suggestedFix`. The filter conflates "no classification field set on the finding" with "not fixable". | Phase 2 plan-review, draft-plan.md | `C:/Users/evmitran/.claude/plugins/cache/ai-developer-toolkit/ralph-orchestration/5.32.0/skills/review-plan-with-ralph/SKILL.md` (or the analogous review-plan filter step) | When a finding has a non-empty `suggestedFix` and matches the fixable severity rubric (Medium with localized scope), default-classify it `fixable` instead of dropping it as "unclassified". Only exclude findings whose `suggestedFix` is empty or marked PRD-worthy. |
| Soft-cap at iteration 5 with 6 open Mediums was treated as terminal — findings were dumped into "Open Questions > Soft-cap" in the plan and into `prd.json.planReviewContext` only for the Highs. The Mediums then re-surfaced as US-001 acceptance criteria. | review-log.json (`phase: "soft-cap"`, openCount 6, all Medium) | `skills/review-plan-with-ralph/SKILL.md` and `lib/` (review-log soft-cap handler) | On soft-cap exit with all-Medium open items, either (a) write the remaining findings into `prd.json.planReviewContext` for visibility in the iteration agent, OR (b) emit a single Quality Gate warning to the orchestrator before Phase 2.5 finalizes ACs. Currently the iteration agent never saw F-005..F-010 except as inflated ACs. |
| `iterationEngine: "codex"` was set but there is no notepad entry about why; this is an implicit autonomous decision. | prd.json | `skills/implement-with-ralph/SKILL.md` Phase 2 prompt | When the orchestrator overrides the default iteration engine, record the rationale in `notepad.md` Autonomous Decisions so future DSAT can attribute timing differences. |
| `review-metadata.json` says `security_relevant: true` but no security-review artifact was written. | Phase 5c | `skills/review-changes/SKILL.md` Phase 5c block | When `security_relevant: true`, require `security-review-findings.json` to exist before Phase 5.5 finalize. If skipped intentionally (doc-only change), record the skip reason in `review-metadata.json.security_skip_reason`. |
| `metrics.json` shows `velocity: 0` and `pass_rate: 0` despite 1/1 pass. The metric computation appears to floor a divide-by-something. | metrics.json | `scripts/metrics-update.sh` or wherever `velocity` / `pass_rate` are computed | Fix the formula so `pass_rate = stories_passed / stories_total` (= 1.0 here), not 0. Same for velocity (stories per iteration = 1.0). Currently misleading. |

## Workflow Friction

| Phase/Step | Friction Signal | Impact | Suggested Fix |
|------------|-----------------|--------|---------------|
| Phase 2 plan-review-fix loop | Soft-cap exit at iteration 5 (`review-log.json` line 28: `phase: "soft-cap", iteration: 5, openCount: 6, severities: {Medium: 6}`) | 6 real findings escaped into AC bloat instead of being fixed in the plan. Story now has 17 ACs, many derived from un-fixed plan items. | Raise the soft cap when only Mediums remain AND each has a concrete `suggestedFix` — those rounds are cheap and converge. Alternatively, allow the user (or autonomous mode default) to choose "absorb-into-prd" vs "absorb-into-story-AC" explicitly rather than the current silent absorption. |
| Phase 2.5 (criteria/story finalization) | 17 ACs on a single doc-only story is high — driven by absorbing un-fixed plan-review Mediums | Verbose verifiedEvidence (good for verification, bad for review readability). Future regressions on any of 17 ACs will count as a story failure. | When ACs exceed ~10, criteria-validator could suggest grouping or splitting the story. For doc-only stories specifically, allow a "document-structure" AC type that bundles section-presence checks. |
| Phase 5a code review re-review (round 1) | Re-review found 0 new findings AND 0 reopened, but still ran a full re-review pass | Modest overhead (1 round). | Acceptable — the convergence loop terminated correctly. No fix needed. |
| Phase 5c security review | `security_relevant: true` but no findings file | Either silent skip or unpersisted output — both are gaps. | See Prompt/Instruction Gaps row above. |

## Orchestration Metrics

- Efficiency ratio (stories / iterations): **1.0** (1/1) — optimal for the iteration loop itself.
- Plan-review-fix rounds: **5 (soft-cap exit)**, 4 findings fixed, 6 left open as Mediums.
- Code-review-fix rounds: **2** (initial + 1 re-review), 2 findings fixed, 0 open.
- Docs-review-fix rounds: 1, 0 findings.
- Auto-rollback rate: 0 / 1 passes (no rollbacks).
- Deferred questions (notepad): **0 / 0** — none asked.
- Autonomous decisions logged: 2 (Phase 2 defaults; plan-review filter excluded 8 Mediums).
- PRD-worthy findings: 0 (none required full replan).
- Reported `velocity: 0`, `pass_rate: 0` in metrics.json — **bug, see gap row above**.
- Total wall time: ~19 min from createdAt to completedAt; iteration itself 891 s (~14.85 min).
- Commit trailers observed: `Constraint:` on `d3cddcd5` (worktree scope) — well-formed. No `Rejected:` or `Not-tested:` trailers.

## Recommendations

1. **`skills/review-plan-with-ralph/SKILL.md` — fix the "unclassified-fixable" filter.** Findings with a concrete `suggestedFix` string and Medium severity should default-classify as `fixable`, not be dropped. Today's run lost 8 Mediums to this rule (notepad.md line 18); 4 of them were load-bearing enough to become US-001 acceptance criteria. The current behavior silently shifts plan-quality debt onto story ACs.

2. **`skills/review-plan-with-ralph/SKILL.md` (soft-cap handler) and the lib code that writes `review-log.json`.** When the soft cap fires with only Mediums open AND each has a `suggestedFix`, either (a) raise the cap by N rounds for cheap Medium-only convergence, or (b) write the remaining findings into `prd.json.planReviewContext` so the iteration agent sees them rather than the orchestrator absorbing them invisibly into the story AC list.

3. **`skills/review-changes/SKILL.md` Phase 5c.** When `review-metadata.json.security_relevant` is `true`, require either a `security-review-findings.json` artifact OR an explicit `security_skip_reason` recorded in `review-metadata.json`. This job set the flag true but produced neither — a silent gap.

4. **`scripts/metrics-update.sh` (or wherever `velocity` and `pass_rate` are computed in `metrics.json`).** Both are reported as 0 for a 1/1 passing job. Fix the divide-by-zero / off-by-one so single-story passing jobs report `pass_rate: 1.0` and `velocity: 1.0`. Without this, downstream DSAT and dashboard aggregation will under-count successes.

5. **`skills/implement-with-ralph/SKILL.md` Phase 2 (autonomous-decision logging).** When the orchestrator chooses a non-default iteration engine (here `iterationEngine: "codex"` instead of Claude), log the reason in `notepad.md` Autonomous Decisions. Today the choice is invisible to retrospective analysis.

6. **`agents/criteria-validator.md` (or equivalent Phase 2.5 agent).** Add guidance: if a story accumulates >10 ACs because plan-review absorption injected them, surface a single Quality Gate warning naming the source findings (F-IDs) so reviewers can decide whether to revisit the plan instead of accepting a 17-AC story. The current job is a clean example of when this warning would help.
