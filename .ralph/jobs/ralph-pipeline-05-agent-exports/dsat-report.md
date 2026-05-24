# Ralph System DSAT: ralph-pipeline-05-agent-exports

Plugin version: v5.32.0

This was a high-quality, frictionless run: 17/17 stories passed on first attempt across 17 iterations with zero failures, zero rollbacks, zero Story Doctor interventions, zero deferred questions, and a clean code/docs review. The interesting signal lives in *plan-review* (soft-capped with 8 open Mediums) and *post-implementation review* (8 fixable findings landed after the iteration loop closed — meaning the implementer shipped technically passing code that nonetheless deviated from the plan contract in measurable ways).

## Agent Effectiveness
| Agent | Invocations | Quality Issues | Details |
|-------|-------------|----------------|---------|
| Criteria Validator | 1 (Phase 2.7) | None | Auto-resolved 6 TESTS_UNDERSPECIFIED blockers on US-001/002/003/004/011/012 by appending per-story test-invocation criteria. Worked as intended — no vague criteria escaped into iteration loop. |
| Plan Reviewer (Claude+Codex+Copilot consensus) | 4 cycles + soft-cap exit | Mixed | Caught 4 High findings (F-001..F-004) and got them fixed by iter 4. Then converged-but-not-resolved on 8 Mediums (F-005..F-012) and exited via soft-cap at iter 5 with `openCount: 8`. All 8 ended up materially correct in the shipped code — but only because the orchestrator side-channeled them into per-story `notes`. The reviewer itself did not drive them to closure. |
| Progress Analyst | 17 (per iter) | None observed | Every iteration was classified `pass` with `claude_exit: 0`. No misclassifications possible because there were no failures to classify. |
| Story Doctor | 0 | N/A | Never invoked. Story sizing was correct; nothing to escalate. |
| Code Reviewer (Phase 5a) | 1 cycle, 6 findings | 1 fabrication-style miss | F-002 noted "fabricated or empty" handling in one-shot — verifiedEvidence on US-011 actually pointed at an assertion that locked in the wrong contract (asserting activity file was empty). The reviewer caught this, which is the system working — but the iteration agent's evidence collector did not. F-004 (vitest config not even wired) is more serious: 17 iterations of "tests pass" evidence referred to a path that *never ran* the new `scripts/lib/*.test.mjs` files. The iteration agent (Codex engine) accepted log lines without verifying *which* tests they came from. |
| Docs Reviewer (Phase 5b) | 1 cycle, 2 findings | None | Both findings were legitimate (stale plan doc + inaccurate watcher entry-path description). High signal-to-noise. |
| Security Reviewer (Phase 5c) | (`security_relevant: true`) | — | Marked relevant but no findings persisted to artifacts read here. |
| Iteration Agent (Codex) | 17 | Evidence-only issues | Common failure mode: claiming "27 files / 153 tests passing" as evidence for stories whose new tests were never executed by that suite (caught by code-review F-004). |

## Prompt/Instruction Gaps
| Signal | Story/Iteration | Affected File | Suggested Fix |
|--------|-----------------|---------------|---------------|
| 8 Medium plan-review findings exited via soft-cap, then re-surfaced as production findings | Plan review iter 5; code-review F-001..F-006 post-impl | `skills/review-plan-with-ralph/SKILL.md` (or equivalent), `prompts/claude.md` plan-review section | Either (a) raise the soft-cap threshold for Medium-only states when openCount > N, or (b) require that any Medium left open at soft-cap be promoted into the per-story `notes` field of the *referenced* story AND tracked through to its iteration evidence. The current side-channel works ad-hoc. |
| Iteration agent accepted "153 tests passing" evidence without verifying *which* tests ran | US-001..US-005 (every iteration that touched `scripts/lib/*`) | `prompts/claude.md` evidence-collection / verifiedEvidence section | Add a verifiedEvidence requirement: when a new test file is created, the evidence command MUST explicitly invoke that test file (e.g. `pnpm vitest run scripts/lib/emit-snapshot.test.mjs`) and the result count must change. A package-level "all tests pass" log is insufficient if the new test file is not in the suite's include glob. |
| Iteration agent wrote a `writeSnapshotSchema` helper that no production code calls (F-006 Low) | US-004 / iter 7 | `prompts/claude.md` Iteration Agent prompt | Add a dead-code self-check step: before commit, grep the codebase for at least one importer of every newly exported function. If none found, drop the export. |
| Iteration agent locked in a test assertion that contradicted the plan (`plan05-acceptance.test.mjs:37` asserted activity log empty after one-shot — the plan said it should emit first-observation events) | US-017 / iter 17 | `prompts/claude.md` evidence/test-design section | Add guidance: "When writing a test that asserts the *absence* of behavior, cross-reference the plan's open-finding list before committing. A test that locks in the wrong contract is worse than no test." |
| Manifest-verifier subagent unavailable across the entire run | Iters 13–17 advisory entries | `skills/analyze-iteration/SKILL.md` | The orchestrator gracefully failed-open ("advisory verifier skipped"), which is correct. But 5 consecutive iterations of "unavailable" suggests the subagent invocation is flaky or misconfigured in this plugin version. Investigate spawn path. |
| ActivityEvent missing `kind` discriminator (F-001 code review High) | US-006 / iter 1 | `prompts/claude.md` "honor every schema field" section | The plan literally said `kind: 'job' \| 'group' \| 'brainstorm'` was required. The agent simply omitted it. Add a story-completion checklist item: "For every interface/schema added, diff the plan's named fields against your implementation's fields and assert equality." |

## Workflow Friction
| Phase/Step | Friction Signal | Impact | Suggested Fix |
|------------|-----------------|--------|---------------|
| Plan review convergence | Soft-cap at iter 5 with `openCount: 8` all-Medium | 6 of those 8 issues resurfaced as post-implementation code-review fixes (8 fix commits after the iteration loop) — represents real rework | Bound the soft-cap by *severity-weighted* open count, not raw count. 8 Mediums is signal that the plan is still drifting. Consider 2 more cycles when all remaining are fixable and reviewer disagreement is structural. See `skills/review-plan-with-ralph/SKILL.md`. |
| Code-review convergence (Phase 5a) | 1 cycle, 6 findings, all fixed | Healthy — but 4 of 6 were "agent ignored plan constraint" not "agent made a coding error". Suggests prompt gap, not reviewer overhead. | The reviewer is doing the iteration agent's job. Shift left: see prompt fixes above. |
| Refactoring Pass | Skipped at cumulative=15 (refactorInterval=5 boundary) with rationale "test-only batch" | Correct behavior, but the skip-rule was triggered by an *unusual* batch composition (8 docs files + 1 test file). Worth a sanity check that the rule isn't masking the need for refactor at the cumulative=10 boundary, where production code was actively being added. | Audit `skills/analyze-iteration/SKILL.md` Refactoring Pass section: does the test-only rule also fire correctly at cumulative=10 when production code lands in the same batch? |
| Manifest verifier | "Subagent unavailable" 5 iterations in a row | No regressions caught because none existed — but if one had been introduced, this entire defense layer was silently disabled | See gap above. Health-check the subagent at orchestrator startup. |

## Orchestration Metrics
- Efficiency ratio: 17 stories / 17 iterations = **1.0** (best possible)
- Auto-rollback rate: 0 / 17 passes = **0%**
- Deferred questions: 0 / 0 (none generated)
- PRD-worthy findings: **0** (no Phase 5 finding required replan; all 8 code-review + docs-review findings were classified `fixable`)
- Plan-review cycles: 4 closed + 1 soft-cap exit = 5 total
- Plan-review findings: 12 total (3 High → all fixed; 8 Medium → 4 fixed in loop, 8 open at soft-cap but 6 re-fixed post-impl; 1 already resolved before exit)
- Post-implementation review findings: 8 (6 code + 2 docs), all fixed in 1 cycle each
- Total wall time: ~122 min implementation + ~2 hr 38 min total run
- Avg time per story: 433 s (range 233s–753s — US-006 took the longest at 753s; second longest US-004 at 619s)

## Recommendations

1. **`prompts/claude.md` — Iteration Agent evidence section:** Require that verifiedEvidence for a story that creates new test files MUST include a command that names those files explicitly. The current "package-level test count" pattern lets new tests pass through unexecuted (F-004 caught this — but only after 17 iterations of false confidence).

2. **`prompts/claude.md` — Iteration Agent schema-compliance section:** Add a mandatory checklist: for every new interface/type/JSON Schema added in a story, the agent must enumerate the plan's named fields and self-verify each one appears in the implementation. F-001 (missing `kind` discriminator) was a 60-second self-check that didn't happen.

3. **`skills/review-plan-with-ralph/SKILL.md` — Soft-cap policy:** Change soft-cap exit from raw `openCount` to severity-weighted. 8 open Mediums on a 17-story plan represents real residual risk (validated: 6 of 8 re-surfaced as production findings). Either run 2 more cycles or *require* each remaining Medium be attached to a specific story's `notes` block, tracked through evidence collection, and re-graded at Phase 5a.

4. **`skills/analyze-iteration/SKILL.md` — Manifest verifier health:** The advisory verifier was "subagent unavailable" for 5 consecutive iterations. Add a startup health-check at orchestrator launch and surface a one-time WARN if the subagent cannot be spawned, so operators know the layer is silently disabled rather than silently passing.

5. **`prompts/claude.md` — Iteration Agent dead-code guard:** Before committing exports, grep for at least one importer. F-006 (`writeSnapshotSchema`) was caught by code review but is the kind of finding that adds review noise; a 5-line check in the iteration agent prompt eliminates it entirely.

6. **`agents/code-reviewer.md`:** Excellent run here (6/6 high-quality findings). No change needed — but consider adding a hint that "agent ignored a literal plan constraint" findings (which were 4 of 6 here) should be routed back to *prompt improvement* recommendations, not just per-finding fixes. The reviewer is doing prompt-debugging by proxy.
