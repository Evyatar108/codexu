# Ralph System DSAT: session-parent-link

Plugin version: v5.24.0

This job was a clean, high-signal run for assessing Ralph: 5/5 stories passed first try, zero rollbacks, zero Story Doctor interventions, zero deferred questions, and a 2-round Phase 5a convergence on 10 findings. The interesting failure modes are therefore subtle — they live in the gap between *what the plan said the code does* and *what the code actually does*, and in test-assertion strength that the iteration agent and reviewers don't currently police.

## Agent Effectiveness

| Agent | Invocations | Quality Issues | Details |
|-------|-------------|----------------|---------|
| Criteria Validator | 5 stories (pre-pass) | None — net positive | Caught `TESTS_UNDERSPECIFIED` on US-002 and US-003, appended explicit `pnpm --filter happy-app test sources/sync/...` criteria (notepad.md Working Notes). Without this, the iteration agent would likely have skipped sync.test.ts unit coverage. High-value invocation. |
| Plan Reviewer (Claude+Codex+Copilot) | 1 round | 1 real miss | planReviewContext F-001/F-002/F-003 caught applySessions overlay & write-flow scope correctly, but missed the bigger landmine: the plan asserts "downstream `MetadataSchema.parse` decides whether to drop [malformed shapes]" — and `MetadataSchema.parse` is never invoked on ingress in `sync.ts`. This false invariant propagated into job CLAUDE.md (line 14-15) and app CLAUDE.md, was codified in tests (sync.test.ts:803-833 asserted `parentSessionId: 42` *persisted*), then required F-001/F-006/F-008 (all High/Med, 3 independent reviewers) to unwind in Phase 5a. The plan reviewer should have asked "where is `MetadataSchema.parse` called?" |
| Progress Analyst | 5 iterations | None | All 5 passes carried full verifiedEvidence (typecheck logs, test counts, grep traces). analysis-result.json shows VALID classifications and CONTINUE recommendations matched ground truth. |
| Story Doctor | 0 invocations | N/A | No failures, no need. |
| Code Reviewer (Claude+Codex+Copilot, 2 rounds) | 2 rounds, 10 findings | Strong signal | High-quality findings: 3 independent reviewers converged on F-001 (the MetadataSchema gap above) — consensus signal worked. Claude alone caught F-009 (weak `expect.not.objectContaining` matcher) and F-010 (CLAUDE.md mechanism drift after F-001 fix). 8 fixed, 2 wont_fix (already resolved by post-job commit 35bc26f6). Fixable-to-prd-worthy ratio: 10/0 — no replan needed. |
| Docs Reviewer | 1 round, 0 findings | Possibly under-reaching | F-010 (docs/code drift on the malformed-metadata mechanism) was caught by the *code* reviewer, not the docs reviewer, even though the offending paragraph lives in `packages/happy-app/CLAUDE.md`. Docs reviewer ran *before* the F-001 fix changed the mechanism, so the drift was created *by* the code-review-fix cycle and there was no re-run of docs review. |
| Security Reviewer | Skipped | Correct | `security_relevant: false` was the right call (schema/normalizer change, no auth/IO surface). |
| Iteration Agent (codex) | 5 runs | 2 latent quality issues | All 5 passed acceptance criteria, but produced (a) a weak `expect.not.objectContaining({a, b})` test assertion (sync.test.ts:826) that passes whenever *either* field is absent, and (b) initial `plans/overview.html` roadmap-data with `generatedAt` rolled backward and `commits: []` (F-004/F-007) — a follow-up human commit (35bc26f6) had to fix the bookkeeping. The agent met the AC ("status flipped to complete") without thinking through internal consistency of the JSON it wrote. |

## Prompt/Instruction Gaps

| Signal | Story/Iteration | Affected File | Suggested Fix |
|--------|-----------------|---------------|---------------|
| Plan claims "downstream MetadataSchema.parse decides whether to drop [malformed shapes]" but `MetadataSchema.parse` is never called on ingress; 3 reviewers caught this in code review (F-001, F-006, F-008) | Phase 1 plan + Phase 5a iter 1 | `agents/plan-reviewer.md` | Add an explicit check: "When the plan references a downstream validator/parser as the safety mechanism for a defensive invariant, the reviewer MUST grep for the validator call site in the actual code path and confirm it is invoked. If absent, flag as **High / Correctness** rather than accepting the plan's claim." |
| Iteration agent wrote `expect.not.objectContaining({a, b})` matcher that has AND-semantics on match — i.e., the negation passes whenever *either* field is absent. Logic hole only caught by F-009 in Phase 5a. | US-002 / iter 2 | `prompts/claude.md` (iteration agent prompt) | Add a "Test assertion strength" guidance section: explicitly list `expect.not.objectContaining({k1, k2})` as a foot-gun and instruct preference for per-key `not.toHaveProperty('k1'); not.toHaveProperty('k2');` when asserting absence of multiple fields. (The same prompt could nudge against `.toMatchObject` for absence checks.) |
| Iteration agent produced internally-inconsistent JSON in `plans/overview.html` roadmap-data: `generatedAt` rolled backward, `commits: []` despite a real landing commit (F-004/F-007 wont_fix because a later human commit cleaned it up). The agent met the literal AC ("status flipped to complete") but not its spirit. | US-005 / iter 5 | `prompts/claude.md` and `agents/docs-updater.md` | Add: "When updating tracker/roadmap JSON, after writing, verify (a) the landing commit SHA is recorded if known; (b) generated/asOf timestamps are not older than any `lastTouched` cell you just edited; (c) re-read and JSON-parse the file to confirm validity." Currently the prompt has no internal-consistency check for tracker files. |
| Job-specific constraints ("single commit on main", "read-side parity only", "no applySessions merge") live only in `.ralph/jobs/session-parent-link/CLAUDE.md`. The iteration agent honored them, but the prompt does not formally enumerate "job-CLAUDE.md is authoritative for constraints not in the story criteria." | All 5 iterations | `prompts/claude.md` | Add an explicit "Read job CLAUDE.md before each story and treat its Job-Specific Instructions as additional acceptance criteria, even when not in the story's `acceptanceCriteria[]`." (It worked here only because the iteration agent inferred this; nothing in the prompt forces it.) |
| Docs reviewer is invoked once and not re-run after Phase 5a code fixes change documented mechanisms (F-010 docs drift caused by F-001 code fix). | Phase 5a iter 1 fix → docs already-shipped | `skills/review-changes/SKILL.md` Phase 5b | After Phase 5a converges, if any code fix touched a mechanism described in a `CLAUDE.md` / docs file (heuristic: code-review-findings.json fix changed a function referenced by a doc fingerprint), re-trigger Phase 5b with the changed mechanism in context. Today the order is 5a → 5b once → 5c; consider a 5a→5b feedback edge. |

## Workflow Friction

| Phase/Step | Friction Signal | Impact | Suggested Fix |
|------------|-----------------|--------|---------------|
| Phase 5a convergence | 2 rounds, 10 findings, 8 fixed + 2 wont_fix (both wont_fix were "already resolved by a separate commit 35bc26f6 made outside Ralph") | Wasted ~1 review round re-flagging F-004/F-007 because the reviewer couldn't tell the file had been fixed by an external commit | `skills/review-changes/SKILL.md` Phase 5a — at the start of each round, capture `HEAD` of all changed paths since the *previous* round and surface that diff to the reviewer agents so they can skip already-resolved findings. Or: have the orchestrator pre-filter wont_fix candidates by replaying the suggestedFix and seeing if the diff is already a no-op. |
| Plan → code drift on the `MetadataSchema.parse` invariant | Plan stated a safety mechanism that didn't exist; took until Phase 5a to surface | The reviewers found it, but only after 5 iterations of code wrote tests *codifying* the wrong invariant | (Covered above under Plan Reviewer.) Additionally, `skills/implement-with-ralph/SKILL.md` Phase 2.7 could have a "trace plan invariants to call sites" sub-step. |
| Docs review timing | Phase 5b ran once at the start, before Phase 5a fixes changed mechanisms | F-010 surfaced as a *code-review* finding because nothing re-triggered docs review | See `review-changes/SKILL.md` fix above. |
| Story Doctor never invoked despite 0 failures — not friction, but a control we have no data on | All 5 stories passed first try | N/A (positive signal — small, well-scoped PRD; or the validator pre-screened well) | None needed here. |

## Orchestration Metrics

- Efficiency ratio: 5 stories / 5 iterations = **1.00 stories/iter** (optimal — no retries)
- Auto-rollback rate: 0 / 5 = **0%**
- Deferred questions: 0 / 0 (none raised)
- PRD-worthy findings: 0 (all Phase 5a findings were fixable in-place)
- Total wall time: ~29 min (1,740,000 ms across 5 iterations); avg 348s/story
- Code review rounds: 2 (converged); docs rounds: 1 (clean); security: skipped (correctly)
- Plan-review consensus signal: 3/3 reviewers caught F-001 (applySessions overlay) — consensus mechanism worked
- Code-review consensus signal: 3/3 reviewers caught the malformed-metadata gap (F-001/F-006/F-008) — consensus mechanism worked

## Recommendations

1. **`agents/plan-reviewer.md`** — Add a "Trace claimed invariants to call sites" rule: when the plan attributes a defensive behavior to a downstream validator (`Zod.parse`, schema validation, type coercion, etc.), the plan reviewer MUST grep the actual code path and confirm the validator is invoked. The single biggest issue in this run was a plan claim that `MetadataSchema.parse` would drop malformed values — but it is never called on ingress. Three Phase 5a reviewers caught it; the plan reviewer (also three models) didn't. Highest-impact fix in this report.

2. **`prompts/claude.md`** (iteration agent prompt) — Add a short "Test assertion pitfalls" section that explicitly calls out `expect.not.objectContaining({a, b})` (matches if *all* listed keys are present, so its negation is a strictly weaker assertion than per-key `not.toHaveProperty`). Recommend the per-key form when asserting absence of multiple fields. This would have prevented F-009 with zero workflow change.

3. **`skills/review-changes/SKILL.md`** Phase 5b — Add a feedback edge: when Phase 5a fixes a mechanism (function body, control flow, or safety guard) that is named/described in any `CLAUDE.md` or docs file in the change set, re-run Phase 5b focused on those docs. F-010 (docs drift) was caught only because Claude's code reviewer also reads docs; the docs reviewer ran before the F-001 fix that obsoleted the mechanism description.

4. **`prompts/claude.md`** — Add an "Internal consistency check for tracker/roadmap files" rule: after editing `plans/*.html` / `plans/*.md` status JSON, verify (a) any `generatedAt`/`asOf` timestamps are >= the most recent `lastTouched` cell edited; (b) commit-id fields are populated when a landing commit exists; (c) the file still parses as valid JSON/HTML. This would have prevented F-004/F-007 (which had to be cleaned up by an out-of-band human commit).

5. **`prompts/claude.md`** — Formalize "job CLAUDE.md is authoritative" as a first-class instruction. Today the iteration agent inferred it (and honored single-commit-on-main, read-side-parity-only, no-applySessions-overlay correctly) — but nothing in the prompt requires reading the job-level CLAUDE.md before each story. A change in iteration engine or prompt could regress this silently.

6. **`skills/review-changes/SKILL.md`** Phase 5a — Pre-filter "already-fixed" findings: at the start of round N+1, replay each prior round's suggestedFix against current HEAD and mark as `wont_fix` (auto) if the diff is already a no-op. F-004 and F-007 churned a full round because the reviewer couldn't see that an out-of-band commit had resolved them.
