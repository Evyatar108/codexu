# Ralph System DSAT: remove-tunnel-claim-layer

Plugin version: v5.24.0

Summary: A clean 6/6 first-pass run (no Story Doctor, no rollbacks, no failures), but review phases surfaced **19 fixable findings** (7 code + 9 docs + 3 security) — almost all rooted in two recurring patterns: (a) story-level grep ACs were scoped too narrowly and missed sibling artifact types, and (b) US-006's documentation sweep was term-list-based rather than semantic, so high-visibility README/CLAUDE.md bullets and "Implemented" status checklists escaped the sweep. Security review showed that a logically equivalent identity-gate change (collapse to `tofuConfig.localUserId`) shipped without a paired runtime/docs guard. These are Ralph-system-level patterns, not project-level bugs.

## Agent Effectiveness

| Agent | Invocations | Quality Issues | Details |
|-------|-------------|----------------|---------|
| Criteria Validator | 6 (one per story) | None observed | All 6 stories produced explicit command/result evidence pairs; no vague-criteria slippage flagged in progress.txt. |
| Progress Analyst | 6 | None observed | Every iteration classified `pass` correctly; no false passes (review caught completeness issues, but those are AC-scope issues, not classifier errors). |
| Story Doctor | 0 | Not invoked | No interventions needed — no recurring failures, no rollbacks. Detection itself was degraded: `job-state.json` had no `startCommit` so recurring-failures array was treated as `[]` (noted three times in progress.txt). |
| Code Reviewer | 1 (Phase 5a, 1 round to clean) | Mostly High signal | 7 findings, all `fixable`; 5 were genuine completeness gaps (F-001 stale import in test, F-002 ambient `.d.ts` re-export, F-003 validation scripts asserting deleted contract, F-004/F-005 on-disk credential field stripping). F-006 (out-of-scope test edits inside a story commit) is meta-quality signal. F-007 (manual operator follow-up) is borderline informational. Ratio of high-value findings ≈ 6/7. |
| Docs Reviewer | 1 + 2 re-review rounds (3 rounds to plateau) | Multi-round leakage | Round 1: 4 findings. Round 2: +2 new. Round 3: +3 new. Each re-review re-swept the worktree and discovered tracked .md files the prior pass missed (e.g. `packages/happy-server/README.md` had F-004 fix at line 37 but F-007 at line 15 went unnoticed until round 3). Suggests the docs-reviewer's first-pass scan is term-list driven and doesn't enumerate every tracked .md file containing tunnel/claim terms. |
| Security Reviewer | 1 | High signal | 3 findings, all fixable and merged. F-001 (operator-identity gate documentation/runtime assertion missing after auth collapse) is a structural call-out the orchestrator framework should make automatic for "delete an auth check" diffs. |
| Iteration Agent (codex default) | 6 | Clean | Avg 823 s/story, range 500–1693 s. No `error_code` set in any iteration log. Iter 4 (US-004) ran 2.8× longer than median, attributable to the noisy full-suite vitest baseline (recorded as `Not-tested` trailer rather than failure — correct behavior). |

## Prompt/Instruction Gaps

| Signal | Story/Iteration | Affected File | Suggested Fix |
|--------|-----------------|---------------|---------------|
| US-004 / US-006 grep ACs scoped to `packages/*/CLAUDE.md` + docs only — missed `.ts` test files (F-001), ambient `.d.ts` (F-002), validation scripts (F-003). | US-004 iter-4, US-006 iter-6 | `prompts/claude.md`; `agents/criteria-validator.md` | Criteria validator should flag grep ACs that exclude `.ts`/`.tsx`/`.mjs`/`.d.ts` when the story is "removal of a symbol/header". Iteration prompt should default removal-stories to a project-root grep, not a path-list grep. |
| US-006 docs sweep missed high-visibility surfaces (README Features bullet, CLAUDE.md Security Considerations bullet, "Status: implemented" checklists, plan-doc forward-looking statements). 6 of 9 docs findings were leaks from the US-006 sweep. | US-006 iter-6 | `agents/docs-reviewer.md`; `prompts/claude.md` docs-sweep guidance | Docs-sweep AC should require `git ls-files '*.md' '*.html'` enumeration + a semantic check (not just term-list) on the top 5 files by inbound-link count or by "Status: implemented" / "Features" headings. Doc reviewer should run the same enumeration on its first pass to prevent the round-2/round-3 leakage. |
| F-006: out-of-scope test edits (voice mic + profile shape) landed inside US-003's claim-removal commit. | US-003 iter-3 | `prompts/claude.md` Commit Discipline section | Iteration prompt should require: "If you touch a file outside the story's `relevantFiles`, either revert it or split into a separate commit before claiming the story complete." Criteria validator could also check `git diff --stat` against `relevantFiles` allowlist. |
| Persisted-credential field-stripping (F-004, F-005) — two stories independently spread server-returned objects into on-disk JSON without an allowlist projection, re-persisting retired fields. | US-003 iter-3 (happy-app) and US-005 iter-5 (happy-agent) | `prompts/claude.md` "deslop" / cleanliness guidance | Add a "removal stories must include a field-allowlist projector at every persistence write-site" rule when the story deletes a field from a persisted shape. Code reviewer's "Correctness" category caught it; the iteration agent should preempt it. |
| F-001 security: deleting auth check shipped without runtime guard or doc update. | US-001 iter-1 | `agents/criteria-validator.md`; `agents/security-reviewer.md` | Stories whose ACs include "delete a verification" should auto-require (a) a docs update describing the surviving gate, and (b) a startup assertion / refusal if the surviving gate's preconditions aren't met. Criteria validator should add these as implicit ACs. |
| Recurring-failure detection unavailable for entire 6-iter run (`job-state.json` missing `startCommit`). Flagged 3× in progress.txt. | All iterations | `skills/analyze-iteration/SKILL.md`; `ralph.sh` job-bootstrap | Job creation should always seed `startCommit = HEAD` at job start; for legacy jobs, the analyze-iteration skill should backfill from the first iteration's commit. |

## Workflow Friction

| Phase/Step | Friction Signal | Impact | Suggested Fix |
|------------|-----------------|--------|---------------|
| Phase 5b docs review-fix loop | 3 rounds to plateau (round 1: 4, round 2: +2, round 3: +3 new) | ~30 min review-fix overhead that could have been a single round | `skills/review-changes/SKILL.md` should mandate that the docs reviewer's round-1 enumeration include every tracked `.md`/`.html` containing any term from the retired-symbol list, sorted by file. The current implementation appears to scan incrementally; an upfront file enumeration prevents per-round trickle. |
| Refactoring Pass triggered at iter-5 (cumulative=5, refactorInterval=5) but deferred for interactive approval — never run before review. | iter-5 → iter-6 → review | Refactoring opportunities (if any) carried into review phase rather than being consolidated pre-review. | `skills/analyze-iteration/SKILL.md` — interactive deferral of a Refactoring Pass should surface in the orchestrator's next user prompt with a default action ("run now / skip / defer to after next story"), not just be logged in notepad.md. |
| US-004 commit recorded `Not-tested` trailer because full-suite vitest has unrelated pre-existing failures on this worktree (runClaude mock, tunnelManager fixture, Windows flakies). | iter-4 | Story validated only on focused 12 tests; broader regressions would be invisible. | `prompts/claude.md` testing guidance should suggest a "baseline-failures.json" capture step at job creation so subsequent iterations can diff against known-bad rather than write `Not-tested`. |
| Code review surfaced 5 of 7 completeness findings that the story-level grep ACs were supposed to catch. | Phase 5a | Indicates AC quality was uneven story-to-story (US-001/US-002 ACs caught everything; US-003/US-004/US-005/US-006 ACs missed sibling artifacts). | `agents/criteria-validator.md` — when validating ACs for a "removal" story, require a grep AC over the *entire* tracked tree, not a per-package allowlist. |

## Orchestration Metrics

- Efficiency ratio: **1.0 stories/iteration** (6/6) — optimal
- Auto-rollback rate: **0/6** — no rollbacks triggered
- Deferred questions: **0/0** — none raised, none auto-resolved (interactive user pre-empted via two notepad-recorded preference clarifications before the loop)
- PRD-worthy findings: **0** — all 19 review findings were `fixable`; no replanning required
- Story Doctor interventions: **0** (and detection was degraded — missing `startCommit`)
- Review-fix rounds: code 1 round, docs 3 rounds, security 1 round
- Total wall-clock: 4942 s (≈ 82 min) across iteration runs; avg 823 s/story
- Per-iteration time spread: 500 s (US-002) → 1693 s (US-004); 3.4× spread driven by full-suite vitest noise on US-004

## Recommendations

1. **`agents/criteria-validator.md`** — Add a "Removal Story" rule: when a story's title/description contains delete/remove/retire/strip-out verbs against a symbol, header, or field, the validator must (a) require at least one grep AC over `git ls-files` (not a per-package path list), (b) require a docs-update AC naming the surviving mechanism, and (c) require a persistence-projector AC if the deleted thing was a field on a persisted shape. This single change would have surfaced F-001..F-005 (code) and F-001..F-009 (docs) as AC gaps before iteration, instead of as post-hoc review findings.

2. **`agents/docs-reviewer.md`** — Replace the term-list incremental scan with a deterministic round-1 enumeration: `git ls-files '*.md' '*.html'` filtered by "contains any retired-term", grouped by repo subtree, with required commentary per file ("touched in diff" / "not touched — checked / not touched — out of scope"). This prevents the 3-round trickle seen here (4 → 6 → 9 findings), which adds two unnecessary review-fix rounds.

3. **`prompts/claude.md`** — Add an explicit "Commit Discipline" section that forbids out-of-scope edits inside a story commit (the F-006 pattern). Concrete rule: "Before claiming the story complete, run `git diff --stat HEAD` and confirm every changed file is either in the story's `relevantFiles`, is the test for one of those files, or has been split into a separate commit with its own justification." Optionally add the diff-stat allowlist check to `agents/progress-analyst.md` as a pre-pass gate.

4. **`skills/review-changes/SKILL.md`** — When the security reviewer finds an auth-gate deletion or collapse (category: Auth/AuthZ, severity High), the convergence loop should require (a) a runtime startup assertion enforcing the surviving gate's preconditions and (b) a `docs/security-model.md` paragraph naming the surviving gate, before the security phase can mark `clean`. F-001 of this run produced exactly that fix (`assertOperatorIdentityGate`) but only after the security review surfaced it — it should be a story-level AC, not a review-time discovery.

5. **`ralph.sh` / `skills/implement-with-ralph/SKILL.md`** — Always seed `job-state.json.startCommit = HEAD` at job creation (and backfill for legacy jobs from the first iteration's commit). This run logged "Recurring-failure detection unavailable" three times; that degrades Story Doctor's ability to detect 3rd-attempt patterns when stories *do* start failing. Cheap one-line fix.

6. **`skills/analyze-iteration/SKILL.md`** — When a Refactoring Pass trigger fires but is deferred under interactive mode (as happened at iter-5 here), surface it to the user *at the next orchestrator turn* with a default action and clear "run / skip / defer-until-review" choice, rather than recording it in notepad.md and letting it slip past review.

7. **`agents/docs-reviewer.md`** — Add a "high-visibility surface" heuristic: README Features bullets, CLAUDE.md Security Considerations bullets, and any "Status: implemented" / "Implementation status" checklist must be enumerated explicitly in round 1. F-007 (`README.md:15` Features bullet) and F-008 (`tunnel-transport-recommendation.md:15` status checklist) both leaked past round-1/round-2 because the reviewer scanned for term hits rather than file-section types.
