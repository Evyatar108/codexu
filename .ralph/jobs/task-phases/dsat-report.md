# Ralph System DSAT: task-phases

Plugin version: v5.27.0

## Agent Effectiveness
| Agent | Invocations | Quality Issues | Details |
|-------|-------------|----------------|---------|
| Criteria Validator | 5 stories | Noise: 13 tool-availability warnings — all for browser/dev-browser checks — every warning anticipated the same fallback path | Warnings were technically correct but redundant: 11 ACs flagged `dev-browser`/DevTools as possibly unavailable. The iteration agent eventually used headless Edge instead, which was not in the suggested fallback. Validator could surface "if Edge/Chrome installed, use it headlessly" as a higher-quality fallback when the project is plain HTML. |
| Progress Analyst | 2 (post-batch 1 and post-batch 2) | None — accurate. Correctly recommended CONTINUE; correctly noted Refactoring Pass was non-applicable for a single-HTML diff and recorded the rationale. | Also surfaced advisory manifest-verifier disagreement for `evidenceKind` enum drift in batch 1, recovered in batch 2. Good signal capture. |
| Story Doctor | 0 | n/a — never triggered (no failures). | Healthy: 5/5 first-pass. |
| Code Reviewer (Phase 5a) | 3 rounds | Mixed: round 1 produced 5 fixable findings (all valid). Round 2 produced 3 more fixables — but findings F-006/F-007/F-008 were **cascading consequences of F-002's round-1 fix** that the reviewer/fix loop did not detect when patching F-002. The reviewer earned its keep but the fix step was too narrow. | F-002 changed `PHASE_TO_FILTER_BUCKET`/`PHASE_TO_ORDER_BUCKET` to emit a new `brainstorm` bucket, but the patch did not touch downstream consumers (`buildTodayPanel`, CSS sort-order block, stale `verifiedEvidence`). 8/8 findings ultimately fixed; convergence in 3 rounds is acceptable but the second round was avoidable. |
| Docs Reviewer (Phase 5b) | 1 round | None — single Medium finding (`b-inflight` stale reference in `plans/crews-integration.md`) was real staleness, low noise. | High signal-to-noise. |
| Iteration Agent (codex) | 5 | Recurring pattern: every story recorded SKIPPED for browser-dependent ACs in iterations 1–4, then iteration 5 discovered headless Edge could be used. | The agent did not attempt headless browser exploration until US-005 explicitly forced it, leaving 6 SKIPPED ACs across US-001/US-002 that could have been verified with the same headless Edge approach. |

## Prompt/Instruction Gaps
| Signal | Story/Iteration | Affected File | Suggested Fix |
|--------|-----------------|---------------|---------------|
| Browser verification fallback escalation missed: validator and agent both treated `dev-browser` absence as "skip" until iteration 5 discovered installed Edge could be driven headlessly with `--force-dark-mode`. | US-001, US-002 (iter 1–2) | `agents/criteria-validator.md` (or equivalent), `prompts/claude.md` | Add a fallback ladder: dev-browser → Playwright/jsdom → installed Chromium/Edge headless over `file://` → manual. Mention `--force-dark-mode` for theme checks. |
| Cascading-impact review: F-002 changed an enum-emitting map but no review check flagged the downstream readers of the new enum value. | Phase 5a round 1 | `skills/review-changes/SKILL.md`, `agents/code-reviewer.md` | After a fix that introduces a new enum/bucket value, require a "downstream-consumer sweep" sub-step (grep for all map readers + verify each handles the new value). |
| Stale `verifiedEvidence` after a fix: F-002 patched code but did not update `iteration-result-5.json` / `prd.json` evidence; required F-008 as a separate finding. | Phase 5a round 2 | `skills/review-changes/SKILL.md` | When a fix changes runtime behavior that any AC's `verifiedEvidence` captured (look for matching `command`/`result` strings), re-run the verifier or invalidate the evidence in the same fix commit. |
| Manifest verifier advisory failed for all batch-1 manifests (`evidenceKind` outside closed enum). | Batch 1, iterations 1–3 | `prompts/claude.md` (iteration prompt) or wherever evidence enum is documented | Surface the closed enum (`passed | skipped | manual-skip | fallback | absent-verified`) in the iteration prompt and reject `command-output` / `static-inspection` aliases. |
| `notTested[0]` shape warning: bare string vs `{criterion, detail}` object. | Iteration 5 | `prompts/claude.md` | Tighten the manifest schema callout — show the object shape explicitly with a concrete example for the not-tested array. |
| Browser-dependent ACs (11 of them across US-001/002/005) drove zero actual failures but generated a lot of `criteriaWarnings` noise. | Plan review / `criteria-validator` | `agents/criteria-validator.md` | When a project is `plans/*.html` with no test infra (already detected and noted in CLAUDE.md), downgrade severity from `tool-availability` to `informational` to reduce warning-table sprawl. |

## Workflow Friction
| Phase/Step | Friction Signal | Impact | Suggested Fix |
|------------|-----------------|--------|---------------|
| Phase 5a code review | 3 rounds before convergence (5 + 3 + 0 findings). Round 2 was caused by an incomplete round-1 fix to F-002 (changed map, missed consumers). | Wasted one full review/fix loop iteration. | In `skills/review-changes/SKILL.md`, add a "ripple check" before closing a fix: grep for all readers of any newly-introduced enum value or map key. |
| Refactoring Pass | Triggered at cumulative=5 but deferred — "no Agent/subagent dispatcher available in this harness session". | The job structurally has no shared code to refactor (single HTML surface), so the deferral was correct, but the trigger condition wasted analyst tokens evaluating. | In `skills/analyze-iteration/SKILL.md`, gate the Refactoring Pass on "more than one .ts/.js source file modified this cycle" instead of just iteration count. |
| Plan-review round | 7 plan-review findings, all High, all consensus from Codex+Copilot. Each was a real gap, but several were "the plan needs a pinned table" — meaning the original `/plan-with-ralph` produced an under-specified plan that required a full second pass to become autonomously executable. | Added one full plan-review cycle. | In `skills/plan-with-ralph/SKILL.md`, add a pre-flight check: "If the plan migrates N rows/entries, the plan MUST include the full migration mapping table for all N. Reject 'TBD per row' or 'operator picks'." |
| Soft-cap exits | None — review-log shows clean convergence with no soft-cap entries. | Healthy. | No action. |

## Orchestration Metrics
- Efficiency ratio: 5 stories / 5 iterations = **1.0 stories/iteration** (optimal — no retries)
- Auto-rollback rate: 0 / 5 passes (clean)
- Deferred questions: 0 / 0 (none raised)
- PRD-worthy findings: 0 (all 9 code+docs findings were fixable in-place; no replan needed)
- Phase 5a review rounds to plateau: 3 (5 → 3 → 0 findings)
- Total job time: 1,637,000 ms (~27 min); per-iteration avg 327s
- Story Doctor interventions: 0
- Auto-resolved questions: 0
- Browser-AC SKIPPED count (iterations 1–4): 6 ACs; recovered to fully-verified in iteration 5 via headless Edge

## Recommendations
1. **`agents/criteria-validator.md`** — Replace the binary `dev-browser available?` test with a fallback ladder: dev-browser → Playwright/jsdom → installed Chromium/Edge headless over `file://` → manual. Include the `--force-dark-mode` flag for theme checks. This would have eliminated 6 SKIPPED ACs in iterations 1–2 of this job.
2. **`skills/review-changes/SKILL.md`** — Add a "ripple check" sub-step to the convergence loop: before marking a fix as resolved, if the fix introduced a new value to an enum or map (e.g., a new bucket key), grep the entire patched file for every consumer of that map/enum and verify each handles the new value. This would have collapsed F-006/F-007/F-008 into the F-002 fix and saved a full review round.
3. **`skills/review-changes/SKILL.md`** — When a fix changes runtime behavior whose specific output appears in any AC's `verifiedEvidence.result` (string match), invalidate or refresh that evidence atomically with the code fix; do not let stale evidence become a separate finding in a later round (F-008 was avoidable).
4. **`skills/plan-with-ralph/SKILL.md`** — Add a hard requirement: if a plan touches more than ~10 enumerated entities (rows, files, tasks, enum values), the plan must ship the full migration table inline; reject "TBD" or "operator judgment per row" entries. F-001 in the plan-review round was a Feasibility-High caused by this exact gap.
5. **`prompts/claude.md`** — Document the closed `evidenceKind` enum (`passed | skipped | manual-skip | fallback | absent-verified`) and the `notTested` object shape (`{criterion, detail}`) explicitly. Codex iteration manifests in batch 1 used `command-output` and `static-inspection` (rejected by the verifier) plus a bare string for `notTested[0]`; both are repeat offenders worth pinning.
6. **`skills/analyze-iteration/SKILL.md`** — Gate the Refactoring Pass on "more than one source file modified across the cycle" in addition to the cumulative iteration count, so single-HTML-surface jobs do not trigger an unproductive evaluation.
7. **`agents/criteria-validator.md`** — When CLAUDE.md or the plan notes "no automated test infrastructure", downgrade browser/test-availability warnings from blocking-style `tool-availability` to `informational` to reduce warning-table noise (this job emitted 11 such warnings for what was effectively a single known-environment constraint).
