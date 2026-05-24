# Ralph System DSAT: Plan 06 — Repo-local skills + derive-next-command.mjs

Plugin version: v5.41.0

Run summary: 6 stories / 6 iterations (all pass on first iteration, no rollbacks, no Story Doctor interventions). Phase 5a code review surfaced 3 fixable findings (2 Medium, 1 Low) cleared in one fix round. Phase 5b docs review surfaced 4 Medium findings, 3 fixed and 1 deliberately deferred to `notepad.md` per the documented Plan 07 parallel-safety rule.

## Agent Effectiveness

| Agent | Invocations | Quality Issues | Details |
|-------|-------------|----------------|---------|
| Criteria Validator | 1 (pre-run) | None | Rewrote vague "Manual smoke" criteria for US-002/003/004/005 into deterministic grep + CLI assertions; recorded the rewrite in `notepad.md` Working Notes. Every story passed first try, indicating high-quality criteria. |
| Plan Reviewer (Claude+Codex+Copilot consensus) | 1 | None | Produced 11 findings in one cycle — 3 High + 8 Medium/Low — all marked fixed before the iteration loop opened. Notably caught the missing `repoRoot` (F-001), brainstorm slug (F-002), Critical/High vs Medium+ wording mismatch (F-004), `node -e` JSON-quoting fragility on Windows (F-005), and the missing `.d.mts` (F-007). High signal-to-noise. |
| Progress Analyst | 6 (post-iteration) | None | No misclassifications — every iteration was a clean pass, nothing to misclassify. |
| Story Doctor | 0 | n/a | Never triggered — no failures to intervene on. |
| Code Reviewer | 1 (round 1 only; converged) | None | 3 findings all classified `fixable`, all genuinely actionable (missing icon field per predicate table, dry-run/null branch ordering bug in skill body, dead `void task` token). 100% fixable-to-PRD ratio, 0% noise. |
| Docs Reviewer | 1 (round 1 only; converged) | Mild over-eagerness on F-004 | Caught 3 real staleness items (test path layout, version pin v5.30.0→v5.41.0, missing CLI wrapper in plan body) — all fixed. F-004 (INDEX + Plan 12 cascade) was correct but in scope-conflict with the documented Plan 07 RUNNING deferral rule; status `wont_fix` with deferral note is the correct outcome, but the reviewer didn't gate F-004 on Plan 07 status itself. |
| Iteration Agent (codex) | 6 | None | Every story passed first invocation; no repeated error_codes, no fabricated `verifiedEvidence`. Evidence commands include `pnpm test`, exact `grep` runs, and `tail` of typecheck logs. |

## Prompt/Instruction Gaps

| Signal | Story/Iteration | Affected File | Suggested Fix |
|--------|-----------------|---------------|---------------|
| F-001 docs row appears in evidence with `C:/Program Files/Git/work-on` instead of `/work-on` — Git Bash on Windows path-translated a literal `/work-on` token inside the acceptance-criterion text when the agent rendered it. | US-003 verifiedEvidence[3].criterion | `agents/criteria-validator.md` and `prompts/codex.md` | Add a "Windows Git Bash path-translation hazard" note: when an acceptance criterion contains a leading-slash literal that is NOT a path (e.g., `/work-on`, `/triage`), wrap it in backticks or quote it as `MSYS_NO_PATHCONV=1`-safe before quoting into a shell. Currently the criterion text itself was mutated in the stored evidence, which is noisy. |
| Docs Reviewer surfaced F-004 (INDEX cascade) without first checking Plan 07 job-state, forcing a `wont_fix` + deferral. The skill body of US-006 explicitly contains this gate; the reviewer should run the same check before emitting cross-plan cascade findings. | docs-review F-004 | `agents/docs-reviewer.md` | Add an instruction: "Before emitting findings against `plans/ralph-pipeline-INDEX.md` or any sibling pipeline plan file inside a `.ralph/jobs/ralph-pipeline-*` job, check the job-state.json of peer pipeline jobs. If any peer is RUNNING, classify the finding as `defer_to_notepad` with a Deferred Cascade entry instead of `fixable`." |
| US-006 produced an empty commit (`dd907aa9 feat: US-006 - Cascade refresh`) because the cascade was entirely deferred to notepad. The acceptance criterion still required a commit listing each "file:line, change summary"; empty commits dilute the git log signal. | US-006 | `prompts/codex.md` (story commit rules) and `skills/implement-with-ralph/SKILL.md` | When all work for a story is deferred, prefer recording the deferred-cascade entry under an existing commit-trailer (Constraint: ...) on the prior story's commit, or explicitly mark the empty commit with a `[deferred-cascade]` tag in the subject so dashboards can filter it. |
| Plan reviewer caught the Windows `mktemp`/`node -e` JSON-quoting fragility (F-005) before any iteration ran. This is a recurring Windows-vs-POSIX category — the planner should be biased toward CLI wrappers up-front. | plan-review F-005 | `agents/codex-planner-prompt.md` / `agents/copilot-planner-prompt.md` | Add a planner heuristic: "When a plan calls for shelling out from a markdown skill body to Node, prefer a thin `scripts/lib/*-cli.mjs` wrapper over `node -e \"import(...)\"`. POSIX `mktemp` and inline JSON arg quoting are unreliable on Windows PowerShell." |
| Working-notes entry from Criteria Validator says it preserved verbatim acceptance criteria but also documents replacements; the CLAUDE.md mandate to "preserve verbatim from `stories-outline.md`" conflicts with the validator's mandate to "rewrite vague criteria." | criteria-validator pre-run | `agents/criteria-validator.md` + `skills/implement-with-ralph/SKILL.md` | Document the precedence order: explicit "preserve verbatim" project mandates (job CLAUDE.md) override the Criteria Validator's rewrite pass. The validator should detect such mandates and downgrade to advisory-only output in `notepad.md` instead of mutating `prd.json`. |

## Workflow Friction

| Phase/Step | Friction Signal | Impact | Suggested Fix |
|------------|-----------------|--------|---------------|
| Phase 5a Code Review convergence | 1 round, 3 findings, all fixed. Clean convergence. | Low | None. |
| Phase 5b Docs Review convergence | 1 round, 4 findings, 3 fixed + 1 `wont_fix` (F-004 cascade). No `review-log.json` soft-cap entries present. | Low | None — but see the F-004 gating fix above to avoid the `wont_fix` exit path entirely. |
| Phase 2.5 Setup (recorded in `job-state.json` `phase: "5.5"`) | Inconsistent phase labeling: `dashboard.md` says Phase 2.5, `job-state.json.orchestrator.phase` says "5.5". | Cosmetic, but confusing to humans reading both artifacts. | `skills/implement-with-ralph/SKILL.md` — make the phase label authoritative in one location (`job-state.json`) and have `dashboard.md` read from it instead of carrying its own value. |
| Iteration timing variance | US-001 took 749s, US-006 took 290s. The 2.6x variance is dominated by `pnpm install` running on US-001 only (per `progress.txt` learning). | Low — single-shot setup cost. | `agents/codex-reviewer-prompt.md` / iteration prompt: add a pre-flight check that runs `pnpm install` once outside the story timer if `node_modules` is absent, so story velocity isn't penalized by setup. |
| Cascade-deferral verification commands quote `cat ... \| grep -n` against multi-pattern regex with bash-style alternation | US-006 evidence used `grep -n "status\|updatedAt"` and similar pipe-OR patterns, which Windows Git Bash handles but PowerShell does not. | Low — codex ran in Bash. | `prompts/copilot.md` (Copilot uses PowerShell-ish behaviors) — if iterationEngine is `copilot`, prefer `Select-String` or explicit multiple greps to keep evidence reproducible. |

## Orchestration Metrics
- Efficiency ratio: 6 stories / 6 iterations = 1.0 (theoretical max for first-pass)
- Auto-rollback rate: 0 / 6 = 0%
- Deferred questions: 0 resolved / 0 total (none raised)
- PRD-worthy findings: 0 (every plan/code/docs finding was `fixable` at its respective level)
- Plan-review findings cleared pre-iteration: 11 (3 High, 8 Medium/Low)
- Code-review fix commits: 3 (all single-story, single-finding)
- Docs-review fix commits: 3 fixed + 1 deferred via Deferred Cascade in `notepad.md`
- Total run wallclock: ~2,553s (42 min) across 6 iterations + 2 review rounds
- Story Doctor invocations: 0
- Soft-cap exits: 0

## Recommendations

1. `agents/docs-reviewer.md` — add a parallel-safety pre-check: before emitting findings against shared pipeline plan files (`plans/ralph-pipeline-*.md`, `plans/ralph-pipeline-INDEX.md`), inspect peer `.ralph/jobs/ralph-pipeline-*/job-state.json` and downgrade in-flight-peer findings to `defer_to_notepad` with a Deferred Cascade template, rather than letting them ship as `wont_fix`. This converts F-004-style outcomes into clean classifications.

2. `agents/codex-planner-prompt.md` and `agents/copilot-planner-prompt.md` — add the "prefer a `scripts/lib/*-cli.mjs` wrapper over `node -e "import(...)"` when shelling out from skill markdown" heuristic, with explicit mention of Windows PowerShell `mktemp` / JSON-quoting fragility. This would have made plan-review F-005 unnecessary.

3. `agents/criteria-validator.md` — codify the precedence rule: when a job CLAUDE.md contains a "preserve verbatim" mandate against acceptance criteria, the validator must skip its rewrite pass and emit rewrite suggestions to `notepad.md` Working Notes only. Today the validator both rewrote criteria AND recorded the rewrite in Working Notes; the project mandate said the criteria should not have been touched.

4. `prompts/codex.md` (and mirror in `prompts/copilot.md`) — add a "Windows Git Bash path-translation" note for evidence-command construction: literal `/work-on`, `/triage`, etc. inside criterion text must be backtick-quoted before being interpolated into a `grep -q '...'` command, otherwise MSYS may rewrite them to `C:/Program Files/Git/work-on` (as observed in `prd.json` US-003 verifiedEvidence[3]).

5. `skills/implement-with-ralph/SKILL.md` — single-source the phase label: have `dashboard.md` re-render from `job-state.json.orchestrator.phase` rather than maintaining its own `Phase 2.5 (Setup)` string that drifts from the orchestrator's `"5.5"`.

6. `skills/implement-with-ralph/SKILL.md` and `prompts/codex.md` — when a story's work is fully deferred (e.g., US-006 here), require either (a) consolidating the Deferred Cascade entries into the preceding story's commit as `Constraint:` / `Deferred:` trailers, or (b) tagging the empty commit subject with `[deferred-cascade]` so downstream tooling and humans can filter it. Empty `feat:` commits without a diff are a smell.

7. `agents/codex-reviewer-prompt.md` (iteration prompt) — gate `pnpm install` outside the per-story timer when `node_modules` is absent in a fresh worktree. US-001 paid a one-time 200-300s install cost that distorts the per-story time histogram in `metrics.json`.
