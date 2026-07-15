# Ralph System DSAT: Codex Wrapper Invariants, Documentation, and Release Readiness

Plugin version: v5.64.0

## Agent Effectiveness
| Agent | Invocations | Quality Issues | Details |
|-------|-------------|----------------|---------|
| Criteria Validator | 1 | Semantic verifiability gaps | The criteria were specific, but the validator allowed a bare `Typecheck passes` criterion for a docs/YAML story, a command whose required working directory was unstated, and a “without performing” criterion with no required audit-proof shape. |
| Iteration Agent | 2 | Passed too early on semantic correctness | Both iterations exited 0 with no error codes, but Phase 5a later recorded 11 fixable findings (10 High, 1 Medium). US-001’s structural test asserted token/count presence more strongly than relationships and downstream propagation; US-002’s syntax/structure probes missed URL value flow, ambient-HEAD tagging, `pushurl`, and post-push equality defects. |
| Manifest Verifier | 2 | High-signal findings were advisory only | It produced five disagreements. Two US-001 disagreements directly anticipated Phase 5a marker-ownership and schema/encoding findings; it also correctly rejected US-002’s YAML parse plus `bash -n` as proof of `Typecheck passes`. |
| Progress Analyst | 1 | Evidence verdict was too shallow | It marked both stories `VALID` because coverage and non-empty command/result checks passed. Current instructions explicitly prohibit downgrading based on manifest-verifier disagreements, so semantic contradictions proceeded to review. No failure-classification assessment was needed because no iteration failed. |
| Quality Gate | 1 | Strong diagnostics, late in the workflow | It passed all focused checks and exposed the key baseline issue: local `main` was 18 commits behind `origin/main`; `main...HEAD` covered 27 files while the actual batch covered 8. |
| Code Reviewers | 5 lanes (3 primary rounds, 2 initial external lanes) | Actionable but partly duplicated | All 11 findings were fixable and all were fixed; no PRD-worthy finding occurred. At least F-001/F-005 and F-004/F-007 overlapped, increasing dispatch overhead. Two fix/re-review rounds converged cleanly. |
| Code Fixer | 11 dispatches | Redundant dispatches | Fixes converged in five commits with no rollback failure, but overlapping findings were routed independently instead of being clustered by root defect. |
| Docs Reviewer | 5 (initial plus 4 re-reviews) | Late discovery and scope noise | It found real staleness, but six of eight findings appeared only after earlier rounds. Review used an over-broad stale baseline and raised findings on paths outside the immutable eight-file write scope. |
| Docs Updater | 7 dispatches | Lacked scope authority | It fixed seven findings, but its prompt receives no job directory, PRD, or write scope and forbids `wont_fix`. Three update waves touched six out-of-scope paths, requiring commit `f993d0770` to restore them. F-006 ultimately remained `wont_fix` for the same scope reason. |
| Story Doctor | 0 | None | Correctly not invoked: both stories passed on their first iteration and no failure snapshots existed. |

## Prompt/Instruction Gaps
| Signal | Story/Iteration | Affected File | Suggested Fix |
|--------|-----------------|---------------|---------------|
| Evidence claimed exact marker ownership and provider-derived behavior beyond what the test actually asserted. | US-001 / iteration 1 | `prompts/copilot.md` and `prompts/codex.md`, Verification Evidence Protocol | Require evidence results to name the exact assertion boundary. For structural invariants, require adversarial mutation cases for missing, moved, swapped, hard-coded, and whitespace-reformatted forms before claiming those cases are rejected. |
| `Typecheck passes` was “verified” with PyYAML parsing and `bash -n`. | US-002 / iteration 2 | `prompts/copilot.md`; parity change in `prompts/codex.md`; `agents/progress-analyst.md` | Define typecheck evidence as an actual compiler/type-check command, or require the criterion to be rewritten as syntax/schema validation when no type system applies. Add command-to-criterion semantic validation. |
| Static release checks passed while URL/path role confusion, candidate binding, push URL validation, and remote postconditions were wrong. | US-002 / iteration 2 | `prompts/copilot.md` and `prompts/codex.md` | Add a non-executable runbook protocol: trace each shell variable by role, reject local paths in remote URLs, bind immutable actions to explicit SHAs rather than ambient `HEAD`, validate fetch and push destinations, and assert post-action remote equality. |
| The verifier found five contradictions, but the authoritative analyst was instructed not to act on them. | Both iterations | `agents/progress-analyst.md`; `claude-skills/analyze-iteration/SKILL.md` Step 0.5/Step 3 | Promote high-confidence `disagree-pass-but-fail` verdicts to evidence `ISSUES`, or route them to a targeted same-story repair before Phase 5. Keep only genuinely input-limited disagreements advisory. |
| Commit trailers preserved “outside the PRD write scope” and read-only constraints, yet Phase 5b edited six excluded paths. | Phase 5b rounds 1-3 | `agents/docs-reviewer.md`; `agents/docs-updater.md`; `claude-skills/implement-with-ralph/SKILL.md` 5b.2 | Pass the context directory and immutable write scope to docs updates. Scope-check every `relevantFiles` path before dispatch; trim mixed findings and mark wholly excluded findings deferred/`wont_fix`. |
| Command-bearing criteria did not require a runnable cwd, and negative-action criteria did not require proof strategy. | US-001/US-002 preflight | `agents/criteria-validator.md` | Warn or reject commands whose execution root is ambiguous, and require state/audit evidence for “must not build/push/tag/install” criteria. Validate that `Typecheck passes` is meaningful for the changed artifact types. |

## Workflow Friction
| Phase/Step | Friction Signal | Impact | Suggested Fix |
|------------|-----------------|--------|---------------|
| Phase 5 baseline selection | Local `main` was 18 commits stale; review diff contained 27 files instead of the batch’s 8. | Docs review attributed unrelated pre-batch changes to this job and expanded the fix surface. | In `claude-skills/implement-with-ralph/SKILL.md` Phase 5a/5b, pass the exact `job-state.startCommit` or persisted fetched base SHA, not a mutable local branch name. |
| Phase 5a review/fix | 11 findings required two rounds and five fix commits after both stories had passed. | The 1.0 story/iteration metric concealed substantial correctness debt. | Move manifest-verifier contradictions into the post-iteration repair gate and add structural-invariant mutation guidance to the iteration prompts. |
| Phase 5a synthesis | At least two overlapping finding pairs were persisted and routed separately. | Eleven fixer dispatches addressed fewer unique root defects. | Update `claude-skills/review-changes/SKILL.md` Step 4b.5 dedupe to use normalized file/line anchors plus semantic defect and suggested-fix similarity, not category/word overlap alone. |
| Phase 5b review/fix | Four fix/re-review rounds ran although `implement-with-ralph/SKILL.md` 5b.2 states a two-round maximum. Six of eight findings were discovered after the initial review. | Five reviewer calls, seven updater dispatches, and prolonged convergence. No soft-cap entry was present. | Enforce the round counter mechanically and make `agents/docs-reviewer.md` perform a complete first-pass version/config/command pattern sweep before emitting findings. |
| Phase 5b scope handling | Six excluded paths were edited and then restored in `f993d0770`. | Added three out-of-scope update waves plus a corrective commit, risking violation of the immutable receipt contract. | Add a pre-dispatch write-scope gate in Phase 5b and let `agents/docs-updater.md` return `wont_fix: outside immutable scope`. |

## Orchestration Metrics
- Efficiency ratio: 2 stories / 2 iterations = 1.0
- Auto-rollback rate: 0 / 2 passes
- Deferred questions: 0 / 0
- PRD-worthy findings: 0
- Iteration time: 3,407,161 ms total (56m 47s); 1,703,580 ms average per story
- Finalization overhead: 8 review invocations and 18 fixer/updater dispatches for 2 stories
- Review convergence: code 2 fix rounds; docs 4 fix rounds; no persisted soft-cap entry
- Findings: code 11/11 fixed; docs 7 fixed and 1 scope-based `wont_fix`

## Recommendations
1. **`claude-skills/implement-with-ralph/SKILL.md` Phase 5a/5b:** use the immutable start/base SHA for review diffs, enforce the documented round caps, and reject fixer/updater paths outside `prd.json.writeScope` before dispatch.
2. **`agents/docs-updater.md` and `agents/docs-reviewer.md`:** provide/read job context and write scope, support an explicit out-of-scope disposition, and perform one complete concept/version/config sweep so findings do not emerge one layer per round.
3. **`agents/progress-analyst.md` plus `claude-skills/analyze-iteration/SKILL.md`:** make semantically grounded manifest-verifier contradictions actionable evidence issues rather than dashboard-only advisories.
4. **`prompts/copilot.md` and `prompts/codex.md`:** add mutation-based structural-invariant evidence and static runbook value-flow/fail-closed checks; prohibit evidence results from claiming behavior not directly asserted by the recorded command.
5. **`agents/criteria-validator.md`:** validate command working directories, meaningful typecheck criteria, and verification plans for forbidden-action/absence criteria.
6. **`claude-skills/review-changes/SKILL.md` Step 4b.5:** deduplicate cross-lane findings by root defect and file anchor before spawning one fixer per finding.
