# Ralph System DSAT: Overview Install Streamline

Plugin version: v5.42.0

This was a structurally clean run: 5 stories, 5 iterations, 5 passes, 0 failures, 0 Story Doctor invocations, 0 rollbacks, 0 deferred questions, and all manifest-verifier verdicts agreed. The signal in this run sits almost entirely in Phase 2R (plan review) and Phase 5 (code/docs review), where the planner and Claude reviewer left several real correctness gaps that only Codex/Copilot consensus caught — and in one workflow exit that hit the plan-review soft-cap with 8 open Medium findings still on the table.

## Agent Effectiveness

| Agent | Invocations | Quality Issues | Details |
|-------|-------------|----------------|---------|
| Criteria Validator | 5 stories | None observed | All 5 stories had concrete, testable ACs (typecheck, exact test commands, byte-identity assertions, version-equality checks). No `TESTS_UNDERSPECIFIED` flags. |
| Progress Analyst | 1 run (after iteration 3) | None | All 3 evidence validations VALID; matched manifest-verifier; correctly identified US-004 unblocked and US-005 dep-blocked. |
| Story Doctor | 0 invocations | N/A | Never needed — no failures triggered intervention. |
| Code Reviewer (Claude) | 1 cycle, 11 findings | **Under-detection on correctness** | Claude flagged 7/11 findings. Codex/Copilot caught 4 additional findings, 3 of which were High (F-002 install-server `--print-only` contract break, F-003 silent-pass on conflicting scaffold content, F-008 `bin/ralph-overview.mjs cli` routing bug breaking 3 existing skills). All three Highs were promoted via 3-way consensus — Claude alone would have shipped them. |
| Docs Reviewer | 1 cycle, 3 findings | Findings actionable; all fixed in iter 1 | All three were real staleness (pnpm vs npm, missing `consumer-not-initialized` documentation, overstated probe scope). Good signal-to-noise. |
| Security Reviewer | Skipped per repo CLAUDE.md | N/A | Correctly skipped (`securityFixLoop: false`, no auth/secrets/crypto in scope). |
| Iteration Agent (Codex) | 5 iterations | None | All 5 passed first attempt; non-empty verifiedEvidence with concrete commands and results; no fabricated evidence. Two Not-tested entries were deliberate and disclosed in commit trailers. |
| Plan Reviewer | 12 iterations, hit soft-cap | **Convergence inefficiency** | Plan review needed 11 fixed findings + still exited at soft-cap iteration 12 with 8 open Mediums. F-008 (the `cli` routing bug breaking existing skills) was a Phase 2R-detectable correctness issue that slipped through 12 review rounds and only surfaced in Phase 5a via Copilot. |

## Prompt/Instruction Gaps

| Signal | Story/Iteration | Affected File | Suggested Fix |
|--------|-----------------|---------------|---------------|
| Claude code-reviewer missed 3 High correctness issues that Codex+Copilot both caught (F-002, F-003, F-008) | Phase 5a iter 1 | `agents/code-reviewer.md` | Add an explicit "legacy-contract preservation" check item: when a story rewires an existing public surface (CLI subcommand, package bin, `--print-only` output), the reviewer must trace every existing caller and assert behavioral equivalence — not just look at the new code path. F-008 (cli dispatcher pointed at wrong script and broke 3 SKILL.md callsites) is the canonical example. |
| Claude reviewer accepted silent-pass behavior on half-set-up consumer state (F-003) — only Codex/Copilot flagged the masked-broken-state risk | Phase 5a iter 1 | `agents/code-reviewer.md` | Strengthen the Correctness rubric with "skip-vs-conflict discrimination": when an init/setup tool reports `ok: true` because a target file exists, the reviewer must check whether content equivalence was verified — bare existence checks that mask conflicting content are a High. |
| Plan-review soft-cap at iteration 12 with 8 open Mediums | Phase 2R | `prompts/review-plan-initial.md`, `prompts/review-verifier.md` | The plan-review loop fixed 11 findings then plateaued on 8 Mediums it could not converge. Two possible root causes: (a) reviewers were re-detecting the same residual concerns each round, (b) the rubric over-classifies polish items as Medium. Audit the 8 surviving Mediums (`review-log.json` after iteration 11) to decide whether to raise the rubric's Medium threshold or add explicit "accept residual Medium and move on" guidance. |
| F-011 (policy-consistency divergence between MCP tool registration patterns) flagged Medium and surfaced two iterations into Phase 5a | Phase 5a iter 2 | `agents/code-reviewer.md` policy-consistency dimension | Working as intended — caught it eventually. No fix needed, but consider: the F-006 fix introduced the divergence by patching only 2 of 12 callsites, suggesting the code-fixer prompt could explicitly request "scan for adjacent same-pattern callsites and migrate together or document the divergence." Cite `agents/code-fixer.md`. |
| Two Not-tested entries (full overview-mcp suite skipped in US-001 and US-002) | Iter 1, 2 | `prompts/codex.md` Pre-Committed Story Pattern | These were correctly disclosed and the suite was run in US-003. Pattern is working. No change required, but the recurring-failure analyzer correctly flagged them as candidates without promoting — keep this behavior. |
| F-009 (return shape divergence between plan text and implementation) — implementer followed a thinner shape than the plan promised | US-003 iter 3 | `prompts/codex.md` evidence protocol | The iteration agent passed verifiedEvidence and the manifest-verifier agreed, yet the plan said "Returns { ok, action, fieldsChanged[], editedRanges[], filePath }" and the implementation returned a narrower shape. Add to the iteration prompt: "when the plan's Approach section names specific return-shape fields, re-read the Approach text and check the return-shape literal in your output matches; AC may not cover it but plan text counts as a contract." |

## Workflow Friction

| Phase/Step | Friction Signal | Impact | Suggested Fix |
|------------|-----------------|--------|---------------|
| Phase 2R (plan-review loop) — soft-cap exit | `review-log.json` shows `{ "phase": "soft-cap", "iteration": 12, "openCount": 8, "severities": { "Medium": 8 } }` | 11 fixes + 12 review rounds before soft-cap; significant clock-time spent without converging on the residual Mediums | Working as designed per v5.26.0 soft-cap convergence — this is a successful exit, not a failure. But the 8 surviving Mediums suggest either the plan was genuinely good-enough at iteration 7-8 (auditing the review-log timestamps would tell us) or the reviewers were generating new Medium polish items each round. Recommend instrumenting per-round delta in `review-loop.sh` (already partly via `--max-re-reviews` budget) to make the plateau visible mid-flight. |
| Phase 5a (code review-fix loop) | 2 rounds, 11 findings, all fixed; F-011 surfaced in round 2 as a consequence of the F-006 fix | Minor — the re-review correctly detected a regression-pattern from the prior round's fix | None — this is the convergence loop working correctly. |
| Phase 5b (docs review) | 1 round, 3 findings, all fixed | Healthy | None. |
| Claude reviewer detection rate vs Codex/Copilot | Of 11 code findings: Claude alone detected 7, consensus (3-way) detected 3 Highs, Copilot alone detected 1 (F-008 — the most impactful correctness issue in the run) | Claude as a solo reviewer would have shipped 3 High-severity correctness bugs in this run | The codexReview/copilotReview defaults of `always` are clearly load-bearing here. Confirm this default is preserved in `skills/review-changes/SKILL.md` and resist proposals to default them to `adaptive`. |

## Orchestration Metrics

- Efficiency ratio: 5 stories / 5 iterations = **1.0 stories/iter** (optimal — zero retries)
- Auto-rollback rate: 0 / 5 = 0%
- Deferred questions: 0 / 0 (none asked)
- PRD-worthy findings: 0 (all 11 + 3 findings were `fixable` — no replan triggered)
- Story Doctor interventions: 0
- Manifest-verifier disagreements: 0 / 33 ACs across 3 iterations checked
- Quality Gate: PASS at mid-run checkpoint (iter 3) and again at finalize
- Total wall time: ~47 minutes (2410s metrics + Phase 5 fix loop time)
- Plan-review iterations: 12 (soft-cap exit) — disproportionate to the 5-iter implementation run

## Recommendations

1. **`agents/code-reviewer.md` — add "legacy-contract preservation" check item.** The Claude reviewer missed F-002 (install-server `--print-only` engine-envelope vs registration-block contract break) and F-008 (`bin/ralph-overview.mjs cli` routing breaking 3 existing skills) — both were 3-way Highs that Codex and Copilot caught independently. Add an explicit checklist item in the Correctness section that requires tracing every existing caller of any rewired public surface (CLI subcommand, package bin, MCP tool output shape, slash skill) and asserting behavioral equivalence with concrete file:line citations.

2. **`agents/code-reviewer.md` — strengthen skip-vs-conflict discrimination in Correctness rubric.** F-003 (init reporting `ok: true` and `filesSkipped: ['plans/overview-data.js: exists']` when the existing file has conflicting content) was a real masked-broken-state risk. Add rubric text: "When a setup/init tool skips an existing file, verify the skip path checks content equivalence — bare `existsSync` skips that mask conflicting content are a High Correctness finding."

3. **`prompts/codex.md` — extend evidence protocol to cover plan-text return-shape contracts.** F-009 surfaced because the implementer matched ACs but not the Approach-section return-shape promise. Add to the iteration-agent prompt: "When the plan's Approach section enumerates specific return-shape fields (e.g. `Returns { ok, action, fieldsChanged[], editedRanges[], filePath }`), treat that enumeration as a contract even if no AC explicitly references it; include a verifiedEvidence entry that greps the implemented return object against the named fields."

4. **`skills/review-changes/SKILL.md` — document the load-bearing role of `codexReview: always` / `copilotReview: always`.** This run's data is a strong case study: 3 of the 4 Highs (F-002, F-003, F-008) required 3-way consensus or Copilot-alone detection. Add a comment near the defaults explaining "do not switch to `adaptive` unless you have a specific cost reason — recent DSAT data shows ~25% of code findings are missed by Claude-solo review."

5. **`skills/review-plan-with-ralph/SKILL.md` (or `review-loop.sh`) — surface plan-review plateau metrics.** This run hit the soft-cap at iteration 12 with 8 open Mediums — almost certainly the right exit, but the operator has no visibility into "are the Mediums genuinely residual or is the reviewer regenerating new ones each round?" Consider emitting a per-round delta summary into `review-log.json` (`{ iteration, addedCount, fixedCount, persistedCount }`) so the soft-cap exit decision is auditable post-hoc.

6. **`agents/code-fixer.md` — add "scan adjacent callsites" instruction.** F-011 surfaced because the F-006 fix patched 2 of 12 same-pattern callsites, creating a policy-consistency divergence the reviewer correctly flagged in round 2 (causing a second review cycle). Adding "when fixing a finding that touches a reusable pattern (schema wrapping, validation helper, argument-parsing utility), grep for adjacent callsites of the same pattern and either migrate them together or explicitly document the deliberate divergence in the commit body" would have closed F-006 + F-011 in a single round.

7. **`skills/analyze-iteration/SKILL.md` — Not-tested promotion check.** The recurring-failures analyzer correctly tracked 2 Not-tested candidates across iterations 1-2 and correctly did not promote them (US-003 covered both). The promotion threshold logic is working. No fix — flag for retention.
