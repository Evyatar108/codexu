# Ralph System DSAT: ralph-pipeline-08-crews (Plan 08 — Crews plugin integration)

Plugin version: v5.41.0

## Executive Summary

The job completed cleanly — 12/12 stories passed across 12 iterations, zero failures, zero rollbacks, zero Story Doctor invocations, zero deferred questions. The signal is therefore not in failed stories but in two upstream/downstream system frictions:

1. **Plan-review hit the soft-cap exit at iteration 12 with 10 Medium findings still open**, and at least two of those deferred Mediums (F-014 lock preflight, F-015 transcript URL-encoding) re-surfaced later as actual code-review findings (F-007 and the URL-encoding work in US-009 respectively). The soft-cap heuristic let real correctness gaps slip from plan-review into implementation.
2. **The manifest verifier was unreachable in nested orchestrator context for the entire run** (4 of 4 verifier-pass-fail JSON files report "subagent dispatch unavailable" or skipped). One real schema violation (`notTested[]` bare-string in iter 9) was only caught by inline structural validation and was advisory-only — no rollback. The same iteration also mis-classified a `manual-skip` fallback (US-009:AC-008) as `evidenceKind: "passed"` with SKIPPED text in the result string.

## Agent Effectiveness

| Agent | Invocations | Quality Issues | Details |
|-------|-------------|----------------|---------|
| Criteria Validator | At least US-009 (Phase 2.7 log entry) | None observed | Correctly pre-blessed US-009:AC-008 browser-automation fallback before iteration began (notepad.md line 26). Output was actionable. |
| Plan Reviewer (Claude + Codex + Copilot) | 12 iterations | Soft-cap exit | Filed 22 findings (5 Critical, 9 High, 8 Medium). Converged on Critical/High in 11 iterations, then exited at iteration 12 with 10 Mediums open (`review-log.json` last entry: `phase: "soft-cap"`). Two of those deferred Mediums materialized as code findings. |
| Manifest Verifier | 4 attempts (iters 7-9 + earlier batch) | Subagent dispatch unavailable in nested orchestrator context for all 4 attempts | Falling back to inline structural validation worked for iters 7-8 but caught the iter-9 `notTested[]` schema violation only as advisory; no rollback was triggered. The agent never actually ran end-to-end in this job. |
| Code Reviewer (Claude) | 1 review cycle (`reviewCycle: 2` in findings) | None — high quality | 3 findings, all fixable, all correctly classified (2 Medium correctness, 1 Low quality). All fixed in iteration 1 of the review loop. |
| Code Reviewer (Codex) | Same cycle | None — high quality | 4 findings, all fixable, including the 3 High-severity worktree-resolution defects (F-004, F-005, F-006) that Claude missed. Codex caught the linked-worktree-mode bugs that the unit tests had codified into "expected" behavior — exceptionally high-signal review. |
| Docs Reviewer | 1 cycle | None — high quality | 7 findings, all fixable, all targeting `plans/ralph-pipeline-08-crews.md` drift from shipped contracts. All fixed in 1 iteration. |
| Progress Analyst | 3 batch summaries (iters 3, 6, 9) | None — accurate | Correctly classified all passes, correctly flagged the iter-9 manifest schema issue, correctly noted the misclassified `manual-skip`, recommended CONTINUE every time without spurious escalation. |
| Story Doctor | 0 | N/A | Never triggered — all stories passed first try. |
| Iteration Agent (Codex, default engine) | 12 | Iter 9 manifest schema bug + misclassified fallback | `notTested[]` written as `["US-009:AC-008 browser automation: ..."]` (bare string) instead of `[{"criterion": "...", "detail": "..."}]`. Same iteration mis-routed a Criteria-Validator pre-blessed fallback into `verifiedEvidence` with `evidenceKind: "passed"` + SKIPPED in result, instead of using `evidenceKind: "manual-skip"` or `"fallback"`. |

## Prompt/Instruction Gaps

| Signal | Story/Iteration | Affected File | Suggested Fix |
|--------|-----------------|---------------|---------------|
| `notTested[]` written as bare strings instead of `{criterion, detail}` objects (schema requires object shape per `schemas/iteration-result-schema.json:51` and `skills/analyze-iteration/SKILL.md:84-85`). | US-009 / iter 9 | `prompts/codex.md:153`, `prompts/copilot.md:153` | Replace "specific edge cases or checks not run, matching any `Not-tested:` trailer content" with explicit shape: "An array of `{criterion: string, detail: string}` objects (both fields required, non-empty strings). Do NOT use bare strings — bare strings will fail structural validation." Cite the schema file path inline. |
| Pre-blessed Criteria-Validator fallbacks (`suggestedFallback` in notepad) get routed into `verifiedEvidence` with `evidenceKind: "passed"` and SKIPPED text in `result`, rather than into the correct `"manual-skip"` or `"fallback"` evidenceKind. | US-009:AC-008 / iter 9 | `prompts/codex.md:104-108,137`, `prompts/copilot.md` (same section) | Add an explicit rule: "When Criteria Validator pre-blessed a fallback for an AC (recorded in notepad as 'fallback recorded in suggestedFallback'), use `evidenceKind: \"manual-skip\"` or `\"fallback\"` for that AC — never `\"passed\"`. The `result` field describes what the fallback proved, not the literal word SKIPPED." The example at codex.md:137 currently shows N/A + SKIPPED text under what reads like a passed entry; make it use the correct evidenceKind. |
| Plan-review soft-cap exit left 10 Medium findings open; at least 2 (lock preflight F-014, URL-encoding F-015) re-surfaced as real code-level work later. | Plan review iteration 12 (soft-cap entry in `review-log.json`) | `review-loop.sh:511-519`, `skills/review-plan-with-ralph/SKILL.md` | Soft-cap currently exits as soon as state is "Medium-only" at iteration 5. Two options: (a) raise the soft-cap floor — require open Medium count ≤ N (e.g. 5) AND iteration ≥ 5 before exiting; (b) emit each remaining Medium finding to `progress.txt` as a "Codebase Pattern" warning so the iteration agent is at least informed of the deferred risk. The current behavior silently drops them. |
| Manifest verifier subagent dispatch unavailable in nested orchestrator context for every attempt in this run. | All advisory verifications (iters 7-9 + earlier batch) | `skills/analyze-iteration/SKILL.md` (verifier dispatch step), `agents/manifest-verifier.md` | The dispatch path needs a documented fallback when running under `claude --print` nested orchestration. Either: document explicitly that the inline structural validator is the supported path in this context, OR add a retry/spawn-shell fallback. Currently the analyst keeps trying and logging the failure each batch — pure overhead. |

## Workflow Friction

| Phase/Step | Friction Signal | Impact | Suggested Fix |
|------------|-----------------|--------|---------------|
| Plan review convergence loop | 12 iterations to converge, ended via soft-cap with 10 Medium findings open. Mean fix time per finding: 132s (range 79-195s). | Plan-review consumed ~25 minutes of the 130-minute job. Two open Mediums later required code-side fixes anyway, so the soft-cap saved no work. | See prompt-gap row above — raise soft-cap floor or surface deferred Mediums to the iteration agent. |
| Manifest verifier (Phase 4.5) | 4 of 4 verifier attempts blocked by "subagent dispatch unavailable in nested orchestrator context". | One legitimate schema violation (iter 9 `notTested[]`) caught only as advisory; one misclassified fallback (US-009:AC-008) never caught at all. | `skills/analyze-iteration/SKILL.md`: document that when the verifier subagent is unreachable, the inline pre-verifier MUST escalate `notTested[]` schema violations to a blocking rollback, not an advisory note. The current "advisory only — no rollback" behavior allows malformed manifests to land. |
| Code-review convergence | 1 review cycle, 7 findings, all fixed in 1 round. | None — exemplary. | n/a |
| Docs-review convergence | 1 review cycle, 7 findings, all fixed in 1 round. | None — exemplary. | n/a |
| Refactoring Pass | Crossed `refactorInterval=5` threshold at cumulative=6 but was "deferred this run; logged to Working Notes" (orchestrator notes iter 6). Next trigger logged for after cumulative=10 but progress.txt shows no Refactoring Pass entry. | Mild — no fires, but the trigger condition appears to silently defer rather than execute when it crosses inside a batch. | `skills/implement-with-ralph/SKILL.md` (Refactoring Pass section): clarify whether `refactorInterval` triggers on first-cross-within-batch (then runs at end of that batch) or only at exact multiples. Current behavior reads "deferred", which seems unintended for a pipeline tracking cumulative completion. |
| Iteration timing | Velocity reported as `0` and pass_rate as `0` in `metrics.json:13-14` despite 12/12 passes. | Reporting bug — analytics for this job are wrong. | `ralph.sh` metrics writer: pass_rate and velocity calculation appears to be dividing by `total_iterations` only when run-end != run-start within a single invocation, but this job had `this_run_iterations: 3` over 3 ralph invocations. Recompute as `stories_passed / stories_total` and `stories_passed / (total_time_ms / 3600000)`. |

## Orchestration Metrics

- Efficiency ratio: 12 stories / 12 iterations = **1.0 stories/iteration** (perfect — no retries)
- Auto-rollback rate: 0 / 12 passes = **0%**
- Deferred questions: 0 / 0 = **n/a** (none ever raised)
- PRD-worthy findings: **0** (all 14 review findings — 7 code + 7 docs — were classified fixable; no full replan triggered)
- Plan-review iterations: **12** (consensus + per-source findings filed; ended via soft-cap, 10 Mediums open)
- Story Doctor interventions: **0**
- Total runtime: **130 minutes** across 3 ralph invocations (3/3/3+3 batch pattern)
- Avg time per story: **651 s** (~10.9 min)
- Fastest/slowest stories: US-010 (368s, test-expansion only) / US-001 (912s, types + schema + Ajv coverage including pnpm install side-effects on a fresh worktree)

## Recommendations

1. **`C:/Users/evmitran/.claude/plugins/cache/ai-developer-toolkit/ralph-orchestration/5.41.0/prompts/codex.md:153` and `prompts/copilot.md:153`** — Replace the one-line `notTested` description with explicit schema shape: "Array of `{criterion: string, detail: string}` objects; both fields required and non-empty. Bare strings will fail validation (`schemas/iteration-result-schema.json`)." Iter 9 produced a bare-string entry that escaped only because the verifier subagent was unreachable.

2. **`C:/Users/evmitran/.claude/plugins/cache/ai-developer-toolkit/ralph-orchestration/5.41.0/prompts/codex.md:104-137` (Fallback / SKIPPED examples)** — The example at line 137 shows `result: "SKIPPED: browser tooling unavailable..."` but the enclosing evidenceKind is implied to be `passed`. Make the example route through `evidenceKind: "manual-skip"` (or `"fallback"`), and explicitly forbid using `evidenceKind: "passed"` for pre-blessed-fallback evidence. This is what mis-routed US-009:AC-008.

3. **`C:/Users/evmitran/.claude/plugins/cache/ai-developer-toolkit/ralph-orchestration/5.41.0/review-loop.sh:511-519` (soft-cap exit)** — The current soft-cap fires the moment state goes "Medium-only" at iteration 5+. In this job that left 10 Mediums open, two of which became real code work. Either (a) require `open_count ≤ 5` in addition to iteration ≥ 5, or (b) before exit, append each open Medium to `progress.txt` under "Codebase Patterns / Deferred plan-review Mediums" so the iteration agent at least sees them.

4. **`C:/Users/evmitran/.claude/plugins/cache/ai-developer-toolkit/ralph-orchestration/5.41.0/skills/analyze-iteration/SKILL.md` (manifest-verifier dispatch)** — Document the nested-orchestrator dispatch limitation explicitly and switch the inline pre-verifier from advisory to blocking for hard-schema violations (`notTested[]` shape, missing `iterationSHA`, wrong `storyId`). The current advisory-only behavior let a schema-invalid manifest land in iter 9.

5. **`C:/Users/evmitran/.claude/plugins/cache/ai-developer-toolkit/ralph-orchestration/5.41.0/skills/implement-with-ralph/SKILL.md` (Refactoring Pass trigger)** — Clarify whether `refactorInterval` triggers on first-cross-within-batch or only at exact multiples. Orchestrator notes for iter 6 say "trigger crossed at cumulative=6 … deferred this run", which silently skipped the pass. The next batch (iter 9) also deferred citing "next trigger at 10". Net effect: the Refactoring Pass never ran.

6. **`ralph.sh` metrics writer** — Fix `velocity` and `pass_rate` in `metrics.json` (both report `0` despite 12/12 passing). At minimum, set `pass_rate = stories_passed / stories_total` and `velocity = stories_passed / (total_time_ms / 3600000)`. The current values make the metrics file misleading for downstream analytics and group-level rollups.

7. **`C:/Users/evmitran/.claude/plugins/cache/ai-developer-toolkit/ralph-orchestration/5.41.0/agents/code-reviewer.md`** — No change needed; the Claude reviewer's 3 findings + Codex's 4 findings split was high-signal complementary coverage. Worth preserving the current dual-reviewer setup for code-scope reviews on multi-platform / worktree-sensitive plans.
