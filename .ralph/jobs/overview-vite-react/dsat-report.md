# Ralph System DSAT: Overview Viewer - Vite + React Port

Plugin version: v5.30.0

Job: `D:/harness-efforts/codexu/.ralph/jobs/overview-vite-react`
Mode: interactive, batchSize 1, iterationEngine codex
Stories: 9/9 passed in 9 iterations (no rollbacks, no Story Doctor interventions, no deferred questions)
Total wall-clock: 4,877,000 ms (~81 min)

## Agent Effectiveness

| Agent | Invocations | Quality Issues | Details |
|-------|-------------|----------------|---------|
| Criteria Validator | 1 (Phase 2.7) | None — high signal | Produced 2 TOO_SHORT blockers (US-002 AC-003, US-005 AC-001) that the operator accepted via "Apply validator suggestions", plus 22 tool-availability warnings (browser/DOM) that propagated correctly into per-story `criteriaWarnings[]` with `suggestedFallback` strings. Every SKIPPED dev-browser AC during iteration cited the validator's fallback verbatim — clean closed loop. |
| Progress Analyst | 9 (one per iter) | None | Every iteration ended in `pass`. Evidence validation correctly identified the SSR-fallback pattern as VALID rather than fabricated. Correctly skipped Refactoring Pass on docs-only iter-9 and on non-multiple-of-5 iterations. |
| Story Doctor | 0 | N/A | No SPLIT/SIMPLIFY/SKIP needed — every story passed on first attempt. |
| Code Reviewer (Phase 5a) | 2 rounds | Strong signal-to-noise | 7 findings: 4 fixed (F-001..F-004), 1 dup (F-005 = F-002), 2 wont_fix with cited baseline parity rationale (F-006/F-007 from copilot — kanban scope + Esc handler). All `fixable`, none escalated to PRD-worthy. Round 2 zero new findings = clean convergence. |
| Docs Reviewer (Phase 5b) | 3 rounds | High signal | 9 findings, all `fixed`. Notably F-008 was a Round 2 catch — SKILL.md *frontmatter* still said "touch the HTML" while the *body* was already corrected in Round 1 by F-002/F-004. The reviewer not catching frontmatter in Round 1 indicates a partial-file review pattern worth tightening. |
| Iteration Agent (codex) | 9 | Recurring "browser unavailable" pattern | Every story with browser ACs hit the same fallback path. No repeated error codes (all `claude_exit: 0`). Notable: iter-4 used `Constraint:` trailer instead of `Not-tested:`, so the recurrence detector missed it (documented in notepad working-notes 2026-05-18). |
| Manifest Verifier | 9 (all skipped) | Systemic schema mismatch | All 9 iteration-result-*.json files use legacy `evidenceKind: "command-output" \| "static-inspection" \| "skipped"` instead of the v5.25 closed enum `passed \| skipped \| manual-skip \| fallback \| absent-verified`. Verifier ran 0 times and was advisory-only on every iteration. Currently the iteration agent prompt has no instruction teaching the closed-enum vocabulary. |

## Prompt/Instruction Gaps

| Signal | Story/Iteration | Affected File | Suggested Fix |
|--------|-----------------|---------------|---------------|
| 9/9 iterations produced `evidenceKind: "command-output"` etc., causing 100% manifest-verifier skip rate | iter-1..9 (all) | `prompts/claude.md` (Step that emits iteration-result schema) | Add an explicit `evidenceKind` enum constraint: must be one of `passed \| skipped \| manual-skip \| fallback \| absent-verified`. Show a worked example. Reference: `skills/analyze-iteration/SKILL.md:79`. |
| `Not-tested` recurrence detection silently skipped iter-4 because the agent used `Constraint:` instead of `Not-tested:` for the browser-unavailable note | iter-4 (US-004) | `prompts/claude.md:38-43` (trailer rules) | Add disambiguation: "Browser/tool unavailability fallbacks MUST use `Not-tested:` (not `Constraint:`) so recurrence detection can promote them after 2 occurrences." Cite parse-not-tested-trailers.sh as the consumer. |
| 7 first-occurrence Not-tested keys ("browser dom/visual ...") never crossed the >=2 threshold because each iteration reworded the same root cause slightly differently | iter-1, 2, 3, 5, 6, 7, 7, 8 | `prompts/claude.md:38-43` + `skills/analyze-iteration/SKILL.md` (Not-tested promotion logic) | Either (a) normalize Not-tested values before hashing (lowercase, strip stop-words), or (b) instruct the iteration agent to reuse the literal phrasing "browser automation unavailable; verified via fallback" whenever the root cause is dev-browser absence. Today the recurrence detector sees 8 keys for what is conceptually one recurring constraint. |
| Phase 5b Round 1 docs reviewer fixed body but missed frontmatter (F-008 only caught in Round 2) | Phase 5b, F-008 | `agents/docs-reviewer.md` (and/or `skills/review-changes/SKILL.md`) | Add an explicit instruction: when a doc has YAML/markdown frontmatter, the reviewer MUST examine frontmatter `description:`/`name:` fields alongside body content — these are often read first by tooling and frequently lag behind body edits. |
| Plan-review needed 2 soft-cap exits (iter-5 with 1 Medium open, iter-8 with 5 Medium open) before convergence | Plan review (Phase 2.5) | `skills/review-plan-with-ralph/SKILL.md` | Soft-cap exits at openCount 1 and 5 suggest the convergence threshold may be too aggressive for first-time plans of this size (9 stories, 3 reviewers — claude/codex/copilot). Consider adjusting the soft-cap policy to allow one more round when openCount is non-zero but trending down. |

## Workflow Friction

| Phase/Step | Friction Signal | Impact | Suggested Fix |
|------------|-----------------|--------|---------------|
| Plan review (Phase 2.5) | Two `soft-cap` events in `review-log.json` (iter-5 openCount=1, iter-8 openCount=5) | Plan shipped with 5 known Mediums open — but Phase 5a found only 7 *new* findings, so the soft-cap exit was correctly tuned for this job | Add a CLAUDE.md note next to the plan that lists remaining Mediums-at-soft-cap so the iteration agent can pre-empt them. Today they appear only in review-log.json. |
| Manifest verifier (Phase 4) | 100% skip rate over 9 iterations | Verifier provides zero signal; dashboard shows the same disagreement block every iteration | Either fix the iteration agent prompt (preferred — see Prompt Gaps #1) OR drop the verifier from interactive mode entirely until the schema-emit gap is closed in `prompts/claude.md`. Current state is pure overhead with no benefit. |
| Iter-1 wall-clock outlier | 1,488,000 ms (24.8 min) vs median 412,000 ms | First-iteration scaffold cost dominates total run | Acceptable for a scaffold story; consider documenting in `skills/implement-with-ralph/SKILL.md` that iter-1 wall-clock is not representative for velocity projections. |
| Refactoring Pass triggered once (cumulative=5) and produced 0 proposals | iter-5 | Wasted spawn | The pass already correctly skipped on iter-9 (docs-only). Consider also skipping when port-from-baseline parity is the explicit goal — the agent already noted "intentionally faithful to legacy plans/overview.html" as the rationale for emitting nothing. Add a `parityPort: true` PRD flag that suppresses refactor passes mid-port. |
| 8 separate "browser unavailable" SKIPPED ACs across 8 stories | iter-1..8 | Repetitive evidence-writing overhead, dilutes review signal | Add a job-level `toolingConstraints.browserAutomation: "unavailable"` PRD field. Iteration agent reads it once and applies the validator's suggestedFallback automatically without per-AC restatement. |

## Orchestration Metrics

- Efficiency ratio: 9 stories / 9 iterations = **1.0** (perfect — no retries, no rollbacks)
- Auto-rollback rate: 0 / 9 = **0%**
- Deferred questions: 0 / 0 (none asked; the destructive US-008 gate was handled via notepad PERMANENT entry, not the deferred-questions table)
- PRD-worthy findings: **0** (all 16 review findings were `fixable` or `wont_fix` with baseline-parity rationale)
- Soft-cap exits during plan review: 2 (iter-5, iter-8)
- Manifest-verifier coverage: 0/9 (advisory skip rate 100% — schema drift)
- Plan-review findings: 11 (all `fixed` before Phase 3)
- Code-review findings (Phase 5a): 7 (4 fixed, 1 dup, 2 wont_fix)
- Docs-review findings (Phase 5b): 9 (all fixed; F-008 caught in Round 2 only)

## Recommendations

1. **`prompts/claude.md` — fix manifest-verifier schema drift.** Add an explicit enum constraint for `evidenceKind` (`passed | skipped | manual-skip | fallback | absent-verified`) in the section that defines iteration-result-N.json output. Without this, the v5.25+ manifest verifier is dead code on every job this prompt drives — this job had 100% skip rate over 9 iterations.

2. **`prompts/claude.md:38-43` — disambiguate `Not-tested:` vs `Constraint:` trailers.** Add a rule that browser/tool unavailability fallbacks MUST use `Not-tested:` so the recurrence detector at `parse-not-tested-trailers.sh` picks them up. Iter-4 of this job silently fell out of the recurrence pipeline due to the wrong trailer name.

3. **`prompts/claude.md` Not-tested wording — normalize recurring constraints.** Either canonicalize the Not-tested text the agent emits ("browser automation unavailable; fallback verified") or hash-normalize Not-tested values in the consumer. This job emitted 8 distinct keys for one root cause and never triggered promotion to PERMANENT.

4. **`agents/docs-reviewer.md` — require frontmatter inspection.** Add an explicit checklist item: "for any `.md` file with YAML frontmatter, inspect `description`, `name`, and other metadata fields independently from the body." F-008 (high severity) was caught only in Round 2 of Phase 5b because Round 1 fixed body procedures but left the contradicting frontmatter intact.

5. **`agents/criteria-validator.md` — promote per-job tooling constraints.** When >=N (e.g., 3) ACs in a PRD trigger the same tool-availability warning, emit a single job-level `toolingConstraints` block instead of N per-AC `criteriaWarnings[]`. This job produced 22 nearly identical browser-availability warnings; one job-level flag would have been sufficient.

6. **`skills/analyze-iteration/SKILL.md` Refactoring Pass — add `parityPort` skip.** When the PRD is an explicit byte-for-byte port from a baseline (this job's CSS verbatim copy, kanban scope parity, Esc-handler parity), the Refactoring Pass cannot fire meaningfully because divergence is forbidden. Add a PRD-level `parityPort: true` flag (or detect via AC keywords "verbatim"/"byte-identical"/"baseline parity") to suppress the pass entirely.

7. **`skills/review-plan-with-ralph/SKILL.md` — surface soft-cap residue.** When plan review exits at soft-cap with non-zero openCount, materialize the remaining findings into the job CLAUDE.md (or a `plan-review-residue.md`) so the iteration agent can see them. Today they live only in `review-log.json` and the iteration agent never reads that file.
