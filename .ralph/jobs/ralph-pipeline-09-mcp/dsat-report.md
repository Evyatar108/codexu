# Ralph System DSAT: Overview MCP Server (Plan 09)

Plugin version: v5.41.0

## Agent Effectiveness

| Agent | Invocations | Quality Issues | Details |
|-------|-------------|----------------|---------|
| Plan-Review (Claude + Codex + Copilot) | 6 iterations + soft-cap | Soft-cap at iter 7 with 8 open Medium findings; converter then dropped F-007..F-014 from `planReviewContext` (all 8 Medium without `classification`, rule "fixable→exclude"), leaving the iteration agent with only F-001..F-006 surfaced in `prd.json`. The Medium findings still got applied because they were documented inline in `plan.md`, but the contract between plan-review output (Medium open) and prd.json enrichment (Medium excluded) created a silent gap. |
| Criteria Validator | 0 | Skipped — notepad says "current Skill toolset for this conversation does not include `Agent(subagent_type=criteria-validator, ...)`". The PRD was shipped without validator enrichment. AC quality was good enough that no Story Doctor or deferred questions arose, so the skip caused no observable damage, but the silent skip is an availability gap. |
| Progress Analyst | 4 (Orchestrator Notes at iter 3, 6, 9, 10) | Healthy. Caught the iteration-1/3 advisory manifest-verifier `evidenceKind` schema mismatch ("command"/"typecheck"/"test" vs allowed enum) and correctly chose not to rollback — judged it a schema-only issue. Good triage. |
| Story Doctor | 0 | Not triggered. No failures, no need. |
| Code Reviewer (Claude) | 1 | 8 findings (F-001..F-008); 3 of them (F-001, F-002, F-003) were High. All actionable, all fixable, none escalated to PRD-worthy. Solid signal/noise ratio. |
| Code Reviewer (Copilot) | 1 | 4 findings (F-009..F-012). 3 of 4 were **duplicates** of Claude's findings (F-009≡F-001, F-011≡F-005, F-012≡F-006). The lone unique Copilot finding (F-010 — `ts` injection in `add_journal_entry`) was a real security/correctness catch that Claude missed. Net signal: 1 unique, 3 duplicates → 25% unique-rate. |
| Docs Reviewer | 1 | 4 findings, all Medium, all "Stale Documentation" in `plans/ralph-pipeline-09-mcp.md` (the source plan). Useful staleness catches — bin entry, install script form, test directory path, `@babel/generator` contradiction. No noise. |
| Security Reviewer | 0 | Per `review-metadata.json` `security_relevant: true` and `lastRoundReReview: true` but `lastRoundNewFindings: 0`. Either ran cleanly or did not surface findings. |
| Iteration Agent (Codex) | 10 (one per story) | Zero failures, zero retries, zero rollbacks. All 10 stories passed first try. Average iteration time 554.6s. **Two compliance gaps**: (1) iterations 1 & 3 emitted invalid `evidenceKind` enum values ("command", "typecheck", "test") instead of "passed" — Progress Analyst noted this. (2) Both High code-review findings F-001 (assertSafeTaskId) and F-010 (`ts` injection) were AC contract violations — the agent implemented the spirit but not the letter of the AC. |

## Prompt/Instruction Gaps

| Signal | Story/Iteration | Affected File | Suggested Fix |
|--------|-----------------|---------------|---------------|
| Iteration agent emits non-enum `evidenceKind` values ("command", "typecheck", "test") | iter 1 & 3 | `prompts/codex.md` (manifest schema section) | Add an explicit "evidenceKind MUST be one of: passed, partial, failed, skipped" line and an example block. Current prompt likely under-specifies the enum. |
| Iteration agent skipped explicit `assertSafeTaskId(input.taskId)` guard in `getTask()` despite AC stating it explicitly (F-001) — relied on incidental snapshot-lookup protection instead | US-003, iter 3 | `prompts/codex.md` (AC compliance section) | Add a rule: "When AC says 'validate X before reading Y', emit a literal try/catch guard at the top of the handler — do not rely on incidental protection elsewhere in the call path. The reviewer reads code, not call graphs." |
| Iteration agent accepted `ts` as MCP input despite AC saying public contract is `{ taskId, note }` (F-010 — newline injection vector) | US-004, iter 4 | `prompts/codex.md` (zod schema discipline) | Add a rule: "When AC enumerates the public input contract, treat it as exhaustive — do not add convenience inputs even if helpful for tests. Defaults belong in the handler body (`new Date().toISOString()`), not the schema." |
| Iteration agent re-declared 9 structural types locally (F-006/F-012) despite plan's Codebase Context section explicitly allowing type-only imports from `tools/overview-viewer/src/types.ts` | US-002+ | `prompts/codex.md` (plan adherence) | The plan said "MAY use type-only imports"; the agent interpreted "MAY" conservatively. Add: "When plan explicitly allows a cross-package type-only import to prevent drift, prefer it over local re-declaration unless tsconfig blocks it. If tsconfig blocks it, fix tsconfig in the same story." |
| Iteration agent used `zod/v3` import path despite `package.json` declaring zod ^4 (F-007) | US-003, iter 3 | `prompts/codex.md` (dependency consistency) | Add a check: "Import paths must match `package.json` semver intent — if you find yourself reaching for a compat namespace, that is a signal to either pin the dependency to match or migrate to the current API." |
| Plan-review soft-capped at iteration 7 with 8 open Medium findings still active in `review-log.json`; converter then excluded them from `planReviewContext` per "Medium without classification → fixable → exclude" rule | Plan-review phase | `skills/review-plan-with-ralph` (soft-cap handling) + converter rule for `planReviewContext` | The Medium findings were "open" in plan-review's view but the plan was shipped anyway. Either (a) require plan-review to flip all soft-cap Mediums to `prd-worthy` so they reach the iteration agent via `planReviewContext`, or (b) mark soft-cap explicitly in the plan markdown so the iteration agent sees them inline (which is what saved this job). Today's success was load-bearing on the human-readable `plan.md` carrying the findings. |
| Criteria Validator skipped silently because subagent type unavailable in the spawning Skill toolset | Phase 2 | `skills/create-prd` or `skills/convert-to-ralph-prd` | If `Agent(subagent_type=criteria-validator)` is unavailable, the converter should log a WARN and persist a `criteriaValidatorSkipped: true` marker in `prd.json` so downstream phases (and DSAT) can see the gap. Today's notepad entry is human-readable only. |
| Docs reviewer found 4 stale references in `plans/ralph-pipeline-09-mcp.md` — the source plan diverged from the implementation during execution (`@babel/generator` reversed, bin entry renamed, install script form changed, test directory moved) | Phase 5b | `skills/review-changes` (docs phase) + `skills/implement-with-ralph` plan-pinning | The plan was treated as frozen ("Did NOT modify plan.md per orchestrator instructions") but the implementation legitimately deviated based on Medium findings applied inline. Add a step to plan-with-ralph or analyze-iteration: "If a story's implementation deviates from `plan.md` due to a Medium/High finding applied inline, append a deviation note to `plan.md` in the same commit." This prevents the docs reviewer from finding stale plan text after the fact. |

## Workflow Friction

| Phase/Step | Friction Signal | Impact | Suggested Fix |
|------------|-----------------|--------|---------------|
| Plan-review convergence loop | Soft-cap at iteration 7 with 8 open Medium findings (all severity=Medium per `review-log.json`) | Plan shipped with open Mediums; converter then excluded them from `planReviewContext`. Saved by inline `plan.md` documentation. | `skills/review-plan-with-ralph/SKILL.md` — at soft-cap, emit a structured artifact (`unconverged-findings.json`) and require the converter to either propagate Mediums into `planReviewContext` or fail loudly. |
| Plan-review → PRD converter | Medium findings without `classification` field are silently excluded from `planReviewContext` | 8 of 14 plan-review findings never surfaced in `prd.json`. They only worked because they were also written into `plan.md` inline. | `skills/convert-to-ralph-prd/SKILL.md` (or the converter spec) — Medium findings missing `classification` should default to `prd-worthy` when produced by a soft-cap phase, not `fixable`. Today's default direction is unsafe. |
| Code-review redundancy across Claude + Copilot | 3 of 4 Copilot findings were duplicates of Claude's (75% overlap on F-001/F-005/F-006) | Spent compute on Copilot to catch one unique High finding (F-010). Worth it, but the dedup pass is purely manual (`resolution: "Duplicate of F-XXX..."`) | `skills/review-changes/SKILL.md` — add an explicit dedup step or pass Claude's findings as context to Copilot ("flag only findings Claude missed"). Today's synthesis is post-hoc. |
| Manifest verifier vs iteration agent enum mismatch | Iterations 1 & 3 used invalid `evidenceKind` values; verifier flagged; no rollback | Schema validation noise; Progress Analyst correctly suppressed | Either (a) widen the verifier enum, or (b) tighten `prompts/codex.md`. Recommend tightening the prompt since the verifier semantics are correct. |

## Orchestration Metrics

- **Efficiency ratio:** 10 stories / 10 iterations = **1.0 stories per iteration** (perfect — no retries)
- **Auto-rollback rate:** 0 / 10 passes = **0%**
- **Deferred questions:** 0 / 0 (none asked, none resolved)
- **PRD-worthy findings:** 0 (all 12 code-review + 4 docs-review findings classified `fixable`; no replans triggered)
- **Plan-review soft-cap:** 1 (iteration 7, 8 open Medium)
- **Story Doctor interventions:** 0
- **Code-review unique-rate (Copilot vs Claude):** 1 / 4 = **25%**
- **Total wall-clock:** 5546s (~92 min); avg story time 554.6s
- **Refactoring Pass:** 1 trigger (cumulativeCompleted=6 crossed refactorInterval=5), no actionable refactorings found

## Recommendations

1. **`prompts/codex.md` — AC literalism rule.** Add explicit guidance: "When AC says 'validate X before reading Y', emit a literal guard at the top of the handler. Reviewers grade against the diff, not the call graph." This single rule would have prevented F-001/F-009 (assertSafeTaskId) and probably F-010 (ts injection — same root cause: AC said "{taskId, note}", agent added "ts" as a convenience).

2. **`prompts/codex.md` — `evidenceKind` enum.** Add a fenced example showing the exact allowed values (`passed | partial | failed | skipped`) and forbid free-text like "command"/"typecheck"/"test". Two iterations (1 and 3) emitted invalid values.

3. **`skills/convert-to-ralph-prd/SKILL.md` — soft-cap propagation.** Change the converter rule so that Medium findings without `classification` from a plan-review **soft-cap exit** default to `prd-worthy` (or at minimum get included in `planReviewContext` regardless of token budget). Today this job survived only because the plan author also wrote findings inline into `plan.md`; that is fragile load-bearing redundancy.

4. **`skills/review-changes/SKILL.md` — Copilot dedup.** When invoking Copilot as a second reviewer, pass Claude's findings as input context with instruction "flag only findings missing from this list." 75% overlap on this job suggests the second reviewer is mostly re-discovering known issues. Even at 25% unique-rate the catch is valuable (F-010 was real), but the cost can drop.

5. **`skills/implement-with-ralph/SKILL.md` — plan deviation note.** When an iteration applies a Medium/High finding inline that contradicts `plan.md`, require appending a one-line deviation note to `plan.md` in the same commit. This would have eliminated all 4 docs-review findings on this job (all were stale plan text vs shipped implementation).

6. **`agents/criteria-validator.md` (or convert-to-ralph-prd skill) — availability fallback.** When the criteria-validator subagent is unavailable in the spawning Skill toolset, emit a WARN to stderr and set `prd.criteriaValidatorSkipped = true` so downstream phases can compensate or alert. Today the skip was buried in `notepad.md` as a human-readable note.

7. **`skills/review-plan-with-ralph/SKILL.md` — soft-cap artifact.** On soft-cap exit, write `unconverged-findings.json` to the job dir with every still-open finding, then make the converter consume it. The current `review-log.json` soft-cap entry only records counts (`{phase: "soft-cap", iteration: 7, openCount: 8, severities: {Medium: 8}}`), not the findings themselves — downstream tooling has no structured handle on what was left open.
