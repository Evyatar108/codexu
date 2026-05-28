# Research Brief — ralph-exec-sh-wrapper-removal-changelog

## Researcher Findings

### CHANGELOG.md current state
- `D:/ai-developer-toolkit/plugins/ralph/CHANGELOG.md` v5.46.0 entry spans lines 3-27.
- Shim removal is mentioned at line 7 as a normal bullet inside a longer phase narrative; the explicit "Breaking change advisory" bullet is buried at line 24 (last bullet of the entry).
- CHANGELOG uses `## v<version>` level-2 headers with inline bullet content — there are no level-3 `### BREAKING CHANGES` subsections in prior entries (v5.36–v5.45).
- Promote the existing line-24 bullet to a top-of-entry, clearly labeled subsection.

### README.md current state
- `D:/ai-developer-toolkit/plugins/ralph/README.md` does **not exist**. Migration notes therefore have no natural README home; do not create a new README just for this task.
- `plugins/ralph/CLAUDE.md` and `plugins/ralph/docs/copilot-quickstart.md` already say "all-Node runtime" / "no `.sh` entry shims remain". Optionally extend those if they undersell the BREAKING aspect.

### codex-exec.mjs / copilot-exec.mjs current state
- `src/codex-exec.mjs` lines 1-8 open with a JSDoc-style block documenting the Phase 3 porting contract. No BREAKING CHANGE pointer present.
- `src/copilot-exec.mjs` mirrors the same shape. Same gap.
- A one-line `//` comment inserted above the existing JSDoc block is the lowest-noise insertion.

### Caller sweep — codexu repo (`D:/harness-efforts/codexu`)
Findings (file:line — classification):
- `.agents/memory/feedback_codex_exec_v545_windows_spawn.md:10,20,23` — HISTORICAL (post-mortem of the v5.45 Windows ENOENT issue; still valid as recovery guidance via CODEX_EXEC_SCRIPT)
- `.ralph/jobs/plugins-copilot-cross-engine-audit/{plan,research-brief,progress,audit-report}.md` — HISTORICAL (this is the audit that triggered the current task; references are evidence of removal, not callers)
- `codex/plans/codex-exec-post-completion-hang.md:33,35,79,88,118,179,197,217` — HISTORICAL (codex-fork investigation; references v5.44 path in context of a hang investigation)
- `plans/codexu-roadmap.md:146,1141,1147,1178-1180,1214,1313,2153,2254,2256,2296-2328` — DOCUMENTATION (forward-looking roadmap planning prose; some sections may still describe the shim as the migration target. Each line range worth re-examining for STALE entries that should be edited.)
- `plans/overview-data.js`, `plans/overview-snapshot.json`, `plans/overview.html`, `plans/parallel-assignments.md` — DOCUMENTATION (overview/dashboard text; check for stale "use bash codex-exec.sh" instructions)
- **Zero active scripts, hooks, or configs in codexu invoke the removed shims by path.**

### Caller sweep — ai-developer-toolkit repo (`D:/ai-developer-toolkit`)
Findings:
- `plugins/crews/CLAUDE.md:657` — HISTORICAL (historical v1.3.2 review note mentioning ralph shims)
- `plugins/ralph/.copilot-plugin/copilot-skills/implement-with-ralph/SKILL.md:1621-1640,1662` — STALE PROSE (Copilot skill mirror still references `.sh` paths in prose)
- `plugins/ralph/.copilot-plugin/copilot-skills/multi-model-investigate/SKILL.md:146` — STALE PROSE
- `plugins/ralph/skills/review-plan-with-ralph/SKILL.md:9-11` — STALE PROSE
- `plugins/ralph/skills/multi-model-investigate/SKILL.md:146` — STALE PROSE
- `plugins/ralph/schemas/prd-schema.json:21,27` — STALE SCHEMA EXAMPLES (.sh paths in example values)
- Later sections of `plugins/ralph/CLAUDE.md` — STALE PROSE (the top of the file already says "zero .sh at runtime", but later sections may not be updated)
- `plugins/ralph/tests/test-review-loop-rereview.sh`, `test-review-loop-planning-engine.sh`, `test-regression-smoke-phase-3.mjs` — TEST STUBS (intentional `.sh` mock files created at runtime; not callers — EXEMPT)
- **Zero ACTIVE callers in any other plugin.**

### Hermetic-test env vars
- `CODEX_EXEC_SCRIPT` and `COPILOT_EXEC_SCRIPT` are still honored.
- Resolution sites:
  - `src/ralph.mjs:978-994` — `resolveEngineScript()` returns env-var path or default `.mjs`
  - `src/review-loop.mjs:840,843,1068-1084` — same pattern
- `engineSpawnCommand()` branches on extension: `.mjs` → spawn `node`; anything else (e.g. `.sh`) → spawn `bash`. So `.sh` stubs still work when explicitly opted in via env var.

### Version + build
- `plugins/ralph/.claude-plugin/plugin.json` is at `5.46.0`.
- No `ralph-exec-help-contract` job exists yet in either repo's `.ralph/jobs/` (confirmed by Researcher + Architect).
- **Doc-only task → no version bump.** If a future help-contract patch lands, it can bump to v5.46.1 separately.
- No CHANGELOG linter found in CI; CHANGELOG.md is hand-maintained.
- Test commands: `cd plugins/ralph && node tests/run.mjs` (or `npm test`).

### Audit commit f4d63067
- Researcher noted: not directly findable in the ai-developer-toolkit tree — likely on a topic branch or in codexu's `.ralph/jobs/plugins-copilot-cross-engine-audit/`. Audit findings at `audit-report.md:69-78` (codex-exec-shell-true FAIL), `87-97` (smoke tests confirming `.sh` absent), `107` (33 stale `.sh` refs in Copilot SKILL mirror), `167` (`Batch 3: ralph-implement-skill-mirror-regenerate-2026-05-28` follow-up proposed).

## Architect Analysis

### Integration points (CHANGELOG style)
- v5.36–v5.45 use `## v<version>` headers with inline bullets only; no level-3 subsection convention.
- Recommendation: do NOT introduce `### BREAKING CHANGES` as a new heading. Instead, promote the existing advisory bullet to a **bold-led top bullet** at the start of the v5.46.0 section:
  ```markdown
  ## v5.46.0
  - **BREAKING CHANGE: codex-exec.sh and copilot-exec.sh entry-point shims deleted.**
    External callers invoking `bash plugins/ralph/<wrapper>.sh ...` will fail with "No such file or directory". Migrate to `node plugins/ralph/src/<wrapper>.mjs ...`. Hermetic-test overrides via `CODEX_EXEC_SCRIPT` / `COPILOT_EXEC_SCRIPT` continue to work for `.sh` stubs (the spawn helper auto-detects `.sh` and runs `bash`, `.mjs` and runs `node`).
  ```
- However, **researcher recommends a `### BREAKING CHANGE: ...` subsection heading** for higher visibility. Either format works; pick one consistently.

### Cross-repo coordination
- This task's job-tracking dir is in codexu (`.ralph/jobs/ralph-exec-sh-wrapper-removal-changelog/`).
- Code edits land in `D:/ai-developer-toolkit/plugins/ralph/` (CHANGELOG.md, src/codex-exec.mjs, src/copilot-exec.mjs).
- Audit artifact (`caller-sweep.md`) lands in codexu.
- `D:/ai-developer-toolkit` git remotes: `origin` (Evyatar108 fork) + `work` (gim-home upstream). Multi-remote push topology = `git push origin <branch> && git push work <branch>`.
- `D:/harness-efforts/codexu` remotes: `origin` only.
- **Worktree strategy:** per `.agents/memory/feedback_cross_repo_impl_worktree_mandate.md`, the impl needs a worktree in BOTH repos (because the lead's working tree in ai-developer-toolkit may already be on a non-main branch, and codexu's lead is on `ralph/plugin-scope-agents-v2`). The lead — not the impl member — handles the worktree per `feedback_impl_topic_branch_vs_lead_branch`: impl member commits to `ralph/<task-id>` topic branch off main in each repo.

### Caller-sweep approach
- Recommended grep variants: exact `codex-exec.sh`, `copilot-exec.sh`, plus backslash variant `codex-exec\\.sh` (for Windows path strings in JSON), plus URL/JSON-escaped forms (`codex-exec\\\\.sh`).
- Heuristic to skip historical references:
  - SKIP files under `*/CHANGELOG.md`, `*/follow-ups/`, `*/future-work/`, `*/.agents/memory/`, `*/.ralph/jobs/*/{plan,research-brief,audit-report,progress}.md`, test fixtures named `*pre-flight*`, `*post-migration*`, `*regression-smoke*`, `*baseline*`, `*recorded*`.
  - INCLUDE skills/agents prose, schemas, application scripts, package.json scripts, hooks, scaffolding templates.

### Version bump decision
- No `ralph-exec-help-contract` job exists at the moment.
- **Decision: no version bump. Stay on v5.46.0.**
- If the parallel `ralph-exec-help-contract` plan ships and we bundle, that PR will own the v5.46.1 bump.

### Story decomposition recommendation
- US-001: CHANGELOG.md BREAKING-CHANGE promotion (blocking)
- US-002: codex-exec.mjs / copilot-exec.mjs header pointers (parallel to US-003 + US-004 after US-001)
- US-003: caller-sweep.md audit report in codexu (parallel)
- US-004: file follow-up tasks for STALE PROSE findings in codexu + ai-developer-toolkit (independent)
- (Optional US-005: README.md migration notes — SKIP because no README exists; instead consider extending `docs/copilot-quickstart.md` or `CLAUDE.md` if reviewers want it)

### Risks
- Wrong CHANGELOG format → inconsistent with prior entries. Mitigate by reading v5.36–v5.45 first and matching.
- Header comment in `.mjs` files too verbose → noise. Strict one-line `//` rule.
- Missing an active caller in a third repo we don't have local. Mitigate: document the grep scope explicitly in caller-sweep.md so reviewers can re-run in their own checkout.
- Multi-remote push divergence (push to one remote, forget the other). Mitigate: spell out both `git push origin` AND `git push work` commands in the plan.

## Codex Research
(See `<STAGING>/codex-research.txt` for raw content. Consensus highlights:)
- Confirms CHANGELOG v5.46.0 already has a "Breaking change advisory" bullet at line 24; promote it.
- Confirms `plugins/ralph/README.md` does not exist.
- Confirms `ralph.mjs` and `review-loop.mjs` extension-detection logic for `.sh` env-stub support.
- Flags `tools/ralph.js` as intentionally narrow (only `--help`, `--version`) — should NOT become the migration entrypoint.
- Reminds: both worktrees are currently dirty; implementation must avoid overwriting unrelated changes.
- Suggests filing follow-up tasks for stale prose in `.copilot-plugin/copilot-skills/implement-with-ralph/SKILL.md`, `.copilot-plugin/copilot-skills/multi-model-investigate/SKILL.md`, and `schemas/prd-schema.json`.

## Copilot Research
(See `<STAGING>/copilot-research.txt` for raw content. Consensus highlights:)
- Confirms CHANGELOG promotion plan.
- Confirms no README.md exists → skip README story.
- Adds: stale prose in `skills/review-plan-with-ralph/SKILL.md:9-11`, `skills/implement-with-ralph/SKILL.md:1621-1640`, `skills/multi-model-investigate/SKILL.md:146`.
- Recommends running `scripts/check-copilot-parity.mjs` if any `.copilot-plugin/` mirror is touched.
- Re-confirms `.ralph/jobs/plugins-copilot-cross-engine-audit/audit-report.md:87-95` as the only concrete failed-caller evidence (which was the audit smoke test, not an external user).

## Consolidated File List

### Files to modify (ai-developer-toolkit)
1. `plugins/ralph/CHANGELOG.md` (lines 3-27) — promote shim-removal advisory to top of v5.46.0 entry.
2. `plugins/ralph/src/codex-exec.mjs` (top of file) — one-line `// See CHANGELOG.md v5.46.0 BREAKING CHANGE …` comment.
3. `plugins/ralph/src/copilot-exec.mjs` (top of file) — same one-line pointer.

### Files to create (codexu)
4. `.ralph/jobs/ralph-exec-sh-wrapper-removal-changelog/caller-sweep.md` — audit report with grep commands + findings table + classification.

### Optional / follow-up only
- `plugins/ralph/CLAUDE.md` later sections — if reviewers want stale-prose cleanup in this PR. Likely defer to follow-up.
- `plugins/ralph/docs/copilot-quickstart.md` — already mostly correct; could mention BREAKING CHANGE link.

### Reference (do not modify)
- `plugins/ralph/src/ralph.mjs:978-994` — `resolveEngineScript()` and env-var detection
- `plugins/ralph/src/review-loop.mjs:840,843` — same env-var pattern
- `plugins/ralph/.claude-plugin/plugin.json` — version, NOT bumped in this task
- `plugins/ralph/tests/run.mjs` — test entrypoint for ralph plugin
- `.ralph/jobs/plugins-copilot-cross-engine-audit/audit-report.md` — origin audit findings
- `D:/harness-efforts/codexu/AGENTS.md`, `.agents/memory/feedback_cross_repo_impl_worktree_mandate.md`, `.agents/memory/feedback_impl_topic_branch_vs_lead_branch.md` — cross-repo conventions

### Follow-up tasks to FILE (not fix in this PR)
- `D:/ai-developer-toolkit/plugins/ralph/.copilot-plugin/copilot-skills/implement-with-ralph/SKILL.md:1621-1662` — STALE PROSE
- `D:/ai-developer-toolkit/plugins/ralph/.copilot-plugin/copilot-skills/multi-model-investigate/SKILL.md:146` — STALE PROSE
- `D:/ai-developer-toolkit/plugins/ralph/skills/review-plan-with-ralph/SKILL.md:9-11` — STALE PROSE
- `D:/ai-developer-toolkit/plugins/ralph/skills/multi-model-investigate/SKILL.md:146` — STALE PROSE
- `D:/ai-developer-toolkit/plugins/ralph/schemas/prd-schema.json:21,27` — STALE EXAMPLES
- `D:/harness-efforts/codexu/plans/codexu-roadmap.md` — multiple line ranges with potentially stale `.sh` references
- `D:/harness-efforts/codexu/plans/overview-data.js` — review for stale `.sh` instructions in command prose
- (The audit already proposed `Batch 3: ralph-implement-skill-mirror-regenerate-2026-05-28` for the Copilot SKILL mirror; that may subsume the Copilot-mirror entries above.)
