# Ralph System DSAT: Pipeline Overview v2 (Plan 04)

Plugin version: v5.41.0

Job: `ralph-pipeline-04-pipeline-overview-v2` (autonomous, batchSize=3, iterationEngine=codex, planningEngine=codex, codexReview/copilotReview=always). 6 stories, 6 iterations, 6 passes, 0 failures, 0 rollbacks, 0 Story Doctor interventions, 0 deferred questions. Total wall time ~51.7 minutes (3,101,000 ms). Plan-review converged in 7 fixes then hit soft-cap with 13 open Medium findings carried into PRD acceptance criteria. Phase 5a code review surfaced 6 findings (2 High, 3 Medium, 1 Low) — all fixable, all fixed by Phase 5b. Docs review clean.

## Agent Effectiveness

| Agent | Invocations | Quality Issues | Details |
|-------|-------------|----------------|---------|
| Plan Reviewer (Codex+Copilot consensus) | 1 plan / 24 findings | Soft-cap exit at iteration 8 with 13 open Medium findings — fix loop converged on the 7 Highs but ran out of budget on Mediums | review-log.json shows 7 sequential High fixes (F-001..F-007) followed by `phase: "soft-cap", iteration: 8, openCount: 13`. Mediums were not fixed in the plan; they were folded into PRD acceptance criteria instead (correct soft-cap handling per the skill). |
| Criteria Validator | 1 (pre-iteration) | One warning surfaced and respected | Flagged US-005:AC-014 as browser-dependent and instructed the iteration agent to fall back to `SKIPPED: browser automation unavailable`. Agent complied. Good guidance. |
| Iteration Agent (codex) | 6 | Non-enum `evidenceKind` values in iteration-result-1/2/3.json | Used `"inspection"`, `"test"`, `"typecheck"` instead of the closed enum `{passed, skipped, manual-skip, fallback, absent-verified}`. Caused manifest-verifier Step 0.5 to fail-open for iters 1-2 and structurally skip iter 3. Self-corrected post-batch-1 (no occurrence noted for iters 4-6 in progress.txt). |
| Manifest Verifier | 3 attempted | All 3 skipped — 2 fail-open (no Agent subagent tool), 1 structural validation failure | Verifier was effectively non-functional this run. Progress Analyst evidence validation was the only authoritative quality signal. |
| Progress Analyst | 1 (post-batch-1) | Accurate — all 3 stories classified VALID, matched downstream outcomes | Recommendation `CONTINUE`, no recurring failures, parity spot-check pass. Tracked the evidenceKind drift as advisory. |
| Code Reviewer (Claude) | 1 (Phase 5a, 2 cycles) | High-quality findings — 6/6 actionable, all `classification: "fixable"`, all `status: "fixed"` in cycle 2 | All findings had concrete relevantFiles + line numbers and suggestedFix with test guidance. Caught 2 real Highs the plan reviewer missed: F-001 spawn `_comment` phantom node, F-002 schema-required fields breaking backward compat. |
| Docs Reviewer | 1 (Phase 5b) | Clean — 0 findings | docs-review-findings.json empty; CLAUDE.md updates from US-006 were correctly absorbed in same pass. |
| Story Doctor | 0 | n/a | No failures, no interventions needed. |
| Refactoring Agent | (not invoked / not surfaced in artifacts) | n/a | Not applicable for this run. |

## Prompt/Instruction Gaps

| Signal | Story/Iteration | Affected File | Suggested Fix |
|--------|-----------------|---------------|---------------|
| Iteration agent emitted `evidenceKind: "inspection"` / `"test"` / `"typecheck"` across iter-1/2/3, none of which are valid enum members | iters 1-3 (US-001..US-003) | `prompts/codex.md` line 151 | Replace `"evidenceKind set to one of the schema values"` with the explicit enumeration `{passed, skipped, manual-skip, fallback, absent-verified}` and one positive + one negative example. Currently the closed enum is only spelled out in `skills/analyze-iteration/SKILL.md:79` (jq filter), which the iteration agent never reads. |
| Code reviewer caught F-001 (spawn `_comment` phantom node) and F-002 (required-field regression) — neither caught by the plan reviewer despite both being on the obvious code path | Phase 5a cycle 1 | `agents/plan-reviewer.md` (and Codex/Copilot reviewer prompts) | Plan reviewers focus on plan correctness but miss "phantom/_underscore metadata in real fixtures" and "schema `required: [...]` semantics vs additive intent". Add a checklist item: when reviewing pure-helper plans, scan referenced fixtures for `_`-prefixed metadata keys, and when reviewing schema widening, confirm the `required` array is not expanded beyond pre-existing fields. |
| `manifest-verifier` Step 0.5 silently fail-open when no Agent subagent tool is available (iter 1, iter 2) | iters 1-2 | `skills/analyze-iteration/SKILL.md` Step 0.5 | When Agent subagent is unavailable, the skill currently degrades to "advisory fail-open" with only a notepad note. For autonomous mode with batchSize >= 3, this means structural validation is silently disabled. Either (a) escalate to a hard warning that surfaces in `analysis-result.json` top-level (currently buried under `manifestVerifier.iter1/2/3`), or (b) implement a non-Agent jq-based fallback that at least validates the enum. |
| US-005:AC-014 required browser automation; Criteria Validator flagged this in advance and iteration agent gracefully fell back | iter 5 | (working as intended) | No fix — call out as the prompt-instruction success of this run. |
| `planReviewContext` cap at 500 tokens truncated 5 of 7 High findings (F-003..F-007 invisible in PRD top-level) | Plan generation | `skills/implement-with-ralph/SKILL.md` step 10 | The current truncation sentinel works but the operator only sees F-001/F-002 in `prd.json.planReviewContext` and must read `plan-review-findings.json` separately. Consider either raising the cap to 1500 tokens, or restructuring `planReviewContext` to carry `{id, severity, oneLineSummary}` only (no description/suggestedFix), which would fit all 24 findings in <500 tokens. |
| F-014 `runDurations` precision was clarified in the plan ("hours rounded to 1 decimal") but the code reviewer still found F-005 (computeRunDurations applied current job-state.json window to ALL historical runs) | iter 4 / code review | `agents/code-reviewer.md` (already catches this) | The reviewer caught it — but only after merge. Suggestion: when AC text contains the phrase "key = runId" or similar "key = X" contracts, the iteration agent prompt should require an explicit assertion that the helper does not multi-map old keys. Add to `prompts/codex.md` a "Contract preservation" subsection: "if an AC names a Record<X, Y> key convention, write a test that exercises the multi-X case before claiming the story passes." |

## Workflow Friction

| Phase/Step | Friction Signal | Impact | Suggested Fix |
|------------|-----------------|--------|---------------|
| Plan-review convergence loop | Soft-cap exit at iteration 8 with 13 Medium findings still open | Mediums had to be folded into PRD ACs (operator did this manually per notepad.md). 17 plan-review findings were threaded into individual story ACs by the autonomous planner. | `skills/review-plan-with-ralph/SKILL.md`: the soft-cap path works, but document the recommended action when it triggers ("fold remaining Mediums into PRD ACs and proceed") explicitly. Currently the operator has to know this convention. |
| Phase 5a code review | 2 review cycles required (reviewCycle: 2 in code-review-findings.json) | All 6 findings fixed before docs/security review, but cycle 1 produced fixable findings; cycle 2 confirmed clean. Adds ~10-15 min. | Working as intended — multi-cycle convergence is the design. No fix needed. |
| Manifest verifier non-functional this run | 3 of 3 iterations skipped (no Agent subagent + enum drift) | Lost a structural-validation safety net | Already addressed under Prompt/Instruction Gaps row 3. |
| Phase 5b docs review | Clean first pass (reviewCycle: 1) | No friction | Working as intended. |
| Batch 1 pause then resume | Job paused after iter 3, resumed for iters 4-6 | Adds operator coordination overhead but matches `batchSize: 3` autonomous semantics. `runCount: 1` in job-state suggests this resumed under a single orchestrator invocation. | Working as intended. |
| Iteration timing variance | iter 1 (US-001) took 1,112s vs iter 3 (US-003) at 290s — ~4x spread | First-iteration premium for codebase familiarization + US-001 had the largest fan-out (12 files changed) | Inherent to story sizing. No fix. |

## Orchestration Metrics

- Efficiency ratio: 6 stories / 6 iterations = 1.00 stories/iteration (no rollbacks, no retries)
- Auto-rollback rate: 0 / 6 = 0%
- Deferred questions: 0 raised / 0 total
- PRD-worthy findings: 0 (no findings required replan; all Phase 5a findings were `classification: "fixable"`)
- Plan-review fix-loop: 7 fixes accepted, soft-cap at iter 8 with 13 open Medium findings
- Code-review convergence: 2 cycles, 6 findings, 6 fixed (100% fix rate in single cycle)
- Total wall time: 51.7 min (avg 8.6 min/story, median 6.5 min)
- Manifest verifier success rate: 0/3 (all skipped)

## Recommendations

1. **`prompts/codex.md` line 151** — Replace the vague "evidenceKind set to one of the schema values" with the explicit closed enum `{passed, skipped, manual-skip, fallback, absent-verified}` and one positive example (`evidenceKind: "passed"` for green tests) and one negative example (`evidenceKind: "absent-verified"` for negation tests). The current phrasing produced 3 consecutive iterations of non-enum drift in this run; the enum is only documented in `skills/analyze-iteration/SKILL.md:79` and `agents/manifest-verifier.md:36`, neither of which the iteration agent reads.

2. **`agents/plan-reviewer.md` (and the Codex/Copilot reviewer agents `agents/codex-reviewer-prompt.md`, `agents/copilot-reviewer-prompt.md`)** — Add two checklist items the plan-reviewers missed but the code-reviewer caught: (a) when a plan references a runtime map/dictionary as a fixture, scan that fixture for `_`-prefixed metadata keys that the iteration code might naively iterate; (b) when a plan widens a JSON schema, verify the `required` array is not expanded beyond pre-existing fields. F-001 (spawn `_comment` phantom node) and F-002 (Recommendation/DependencyGraph `required` overreach) both blocked Phase 5a and could have been caught at plan-review time.

3. **`skills/analyze-iteration/SKILL.md` Step 0.5 (manifest-verifier)** — When no Agent subagent tool is available, do not degrade to silent "advisory fail-open"; promote the unavailability to a top-level `analysis-result.json.manifestVerifier.unavailable: true` field and emit a one-line warning to the dashboard. Also add a non-Agent jq-only fallback that at minimum runs the closed-enum check from line 79. This run had 3/3 verifier skips and the operator had to read `notepad.md` Working Notes to find out.

4. **`skills/implement-with-ralph/SKILL.md` step 10 (`planReviewContext` truncation)** — The current 500-token cap surfaces only F-001/F-002 in `prd.json.planReviewContext` and silently drops F-003..F-007 (all High consensus). Either raise the cap to 1500 tokens, or restructure `planReviewContext` entries to `{id, severity, source, oneLineSummary}` only (drop `description` and `suggestedFix` from the carrier, which already live in `plan-review-findings.json`). This would fit all 24 findings from this run in <500 tokens.

5. **`skills/review-plan-with-ralph/SKILL.md` (soft-cap path)** — Document the operator-side convention applied here ("fold remaining Mediums into individual story ACs and proceed") as a first-class output of soft-cap exit, ideally as a structured `review-log.json` entry rather than a free-form notepad note. The notepad.md "Autonomous Decisions" block manually catalogs which findings were threaded into which stories (US-001 absorbed F-013/F-016/F-017/F-019/F-023/F-024, etc.) — this mapping should be machine-readable.

6. **`prompts/codex.md` ("Contract preservation" — new subsection)** — When a story AC contains a `Record<X, Y>` or `key = <field>` contract (e.g. F-014's `Record<runId, hours>`), require the iteration agent to write at least one test exercising the multi-X case before claiming pass. F-005 in Phase 5a (computeRunDurations mapped all historical runs of a task to the current cycle's window) was a multi-key contract violation the iteration agent missed despite the AC text being explicit.
