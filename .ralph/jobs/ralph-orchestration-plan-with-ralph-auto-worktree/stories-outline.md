# Stories Outline: Auto-worktree management in `/plan-with-ralph`

*Preliminary decomposition from `/plan-with-ralph`. Feed to `/implement-with-ralph --from-plan` for PRD generation.*

> **Target plugin repo:** `D:/ai-developer-toolkit/plugins/ralph` (NOT `codexu`). US-006 is the only story that edits `codexu`.

## US-001: Extract `worktree-create.mjs` helper from `convert-to-ralph-prd`
**Description:** As a Ralph plugin maintainer, I want a shared Node helper that encapsulates `git worktree add` plus branch-collision suffixing, existing-path detection, stale-worktree prune-and-retry, fallback start-point resolution, and submodule init under the global lock, so that both `convert-to-ralph-prd` (impl path) and a future `/plan-with-ralph` (plan path) can use the same battle-tested logic.

**Acceptance Criteria:**
- [ ] New file `D:/ai-developer-toolkit/plugins/ralph/src/worktree-create.mjs` exists.
- [ ] `node src/worktree-create.mjs --help` prints the contract: `--target-repo`, `--worktree-path`, `--branch`, `--start-point`, `--allow-existing-branch`, `--json`.
- [ ] On success, emits one JSON object on stdout: `{worktreePath, branch:{name, created, collisionSuffix}, startPoint, reusedExistingWorktree, submoduleInitRan}`.
- [ ] Exits 0 on success, non-zero on unrecoverable error (e.g., target repo missing, start-point unresolvable after fallback chain).
- [ ] Submodule init runs under `~/.cache/ralph-orchestration/submodule-init.lockd` with the same protocol as the current `convert-to-ralph-prd` Step 5 bash block.
- [ ] `--target-repo` is normalized via the same Windows-friendly path conversion as the existing skill (cygpath where available).
- [ ] Unit tests at `D:/ai-developer-toolkit/plugins/ralph/tests/worktree-create.test.mjs` cover and pass for: (1) fresh path creates worktree, (2) existing branch with `--allow-existing-branch` reuses it, (3) existing-and-stale path (no `.git` marker) is pruned and retried, (4) missing start-point falls back to default branch then HEAD, (5) `ralph/foo` branch collision auto-suffixes to `ralph/foo-2` then `ralph/foo-3`.
- [ ] Typecheck (`node --check src/worktree-create.mjs`) passes.
**Dependencies:** None.
**Estimated complexity:** medium

## US-002: Refactor `convert-to-ralph-prd` Step 5 to call the helper
**Description:** As a Ralph plugin maintainer, I want `convert-to-ralph-prd` to delegate worktree creation to the new `worktree-create.mjs` helper instead of inlining the bash logic, so that the impl path and the future plan path share one implementation. Behavior MUST be preserved — the same `prd.json` shape is written, `--batch` still skips worktree creation entirely.

**Acceptance Criteria:**
- [ ] `D:/ai-developer-toolkit/plugins/ralph/skills/convert-to-ralph-prd/SKILL.md` Step 5 calls `node "<plugin_root>/src/worktree-create.mjs"` instead of inlining `git worktree add` and submodule-init bash.
- [ ] The Step 5 bash block reads the helper's JSON stdout into `worktree_path`, `branch_name`, `start_point` for the subsequent prd.json write.
- [ ] `--batch` mode still skips worktree creation (the helper is NOT called when `--batch` is set).
- [ ] `D:/ai-developer-toolkit/plugins/ralph/.copilot-plugin/copilot-skills/convert-to-ralph-prd/SKILL.md` mirrors the same edit.
- [ ] Behavioral parity test: running `convert-to-ralph-prd` on a fresh fixture repo writes the SAME `prd.json` (jq-diffed) before and after the refactor for: (a) default new-branch case, (b) `--start-point feature-branch` case, (c) collision-suffix case.
- [ ] Existing in-flight impl jobs (`*.prd.json` files in `.ralph/jobs/*/`) are not invalidated — the prd.json schema is unchanged.
**Dependencies:** US-001
**Estimated complexity:** small

## US-003: Add Phase 1B + Phase 5 worktree integration to `/plan-with-ralph`
**Description:** As an operator, I want `/plan-with-ralph` to create its own worktree at `.ralph/jobs/<task-id>/worktree/plan/` on `ralph/plan-<task-id>` and run all phases inside that worktree, so that plan-phase Ralph members no longer require a manual WORKTREE MANDATE in the spawn prompt and never touch the lead's primary working dir.

**Acceptance Criteria:**
- [ ] `D:/ai-developer-toolkit/plugins/ralph/skills/plan-with-ralph/SKILL.md` Phase 1 always resolves `<job_dir>` (no Phase 5 deferral): when neither `--job` nor `--improve` nor `--from-brainstorm` is passed, derive `job_name` deterministically from the feature description (kebab-case, first 6 ASCII-alphanumeric words, ≤ 60 chars; fall back to `plan-<timestamp>` if derivation yields <3 chars). Interactive mode confirms derived names that came from the content-fallback path; Autonomous accepts silently.
- [ ] New Phase 1B "Worktree Creation" section inserts after Phase 1, before Phase 2. It invokes `node "<plugin_root>/src/worktree-create.mjs"` with `--target-repo "$repo_root"`, `--worktree-path "$job_dir/worktree/plan"`, `--branch "ralph/plan-$job_name"`, `--start-point origin/main`, `--json`. Reads the result into `$PLAN_WORKTREE` and `$PLAN_BRANCH`.
- [ ] Phase 1B fetches origin first (`git -C "$repo_root" fetch origin --quiet`) so `origin/main` is up-to-date.
- [ ] All subsequent phases (2, 3, 4, 5) run with cwd = `$PLAN_WORKTREE` for every git operation, every file write, every node helper invocation.
- [ ] Phase 5 step 3 writes deliverables under `$PLAN_WORKTREE/.ralph/jobs/<job_name>/`, then runs `git -C "$PLAN_WORKTREE" add .ralph/jobs/<job_name>/ && git commit -m "plan: <job_name>" && git push -u origin "$PLAN_BRANCH"`.
- [ ] The commit message body lists the deliverable filenames; trailer `Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>` is appended when the runtime engine is Copilot CLI.
- [ ] Phase 5 writes `<STAGING>/handoff-receipt.json` with `{commitSha, branch, worktreePath}` for the calling agent to surface to the lead.
- [ ] Phase 5 handoff content (the markdown emitted into plan mode in Interactive, or into the autonomous success summary) appends a `### Plan worktree (this skill ran in)` section listing the commit SHA, branch, worktree path, and a `cleanup` invocation hint.
- [ ] The lead's primary working dir is never touched by the skill — it stays on whatever branch it was on (typically `main`).
- [ ] Existing-worktree-detected edge case: in Autonomous mode, log a warning and reuse via the helper's existing-worktree path; in Interactive mode, prompt the operator (A) reuse / (B) wipe + recreate / (C) abort.
- [ ] `.copilot-plugin/copilot-skills/plan-with-ralph/SKILL.md` mirrors the same edits.
- [ ] End-to-end smoke: `/plan-with-ralph --autonomous --job test-plan-autoworktree "test feature"` against a fixture repo (or a sandbox branch of codexu) produces the worktree, runs all phases, pushes the commit, leaves the lead's dir untouched.
**Dependencies:** US-001, US-002
**Estimated complexity:** large

## US-004: Add `/plan-with-ralph cleanup <job-name>` subcommand
**Description:** As an operator, I want a `cleanup` subcommand on `/plan-with-ralph` so that after FF-merging a plan branch to main I can remove the worktree and topic branch in one command, with a safety check that refuses to delete a branch that hasn't been merged yet.

**Acceptance Criteria:**
- [ ] `D:/ai-developer-toolkit/plugins/ralph/skills/plan-with-ralph/SKILL.md` Phase 1 detects `cleanup` as positional arg 1 and routes to a new "Cleanup mode" section (skipping Phases 2-5).
- [ ] Cleanup mode signature: `/plan-with-ralph cleanup <job-name> [--force] [--prune-remote] [--dry-run]`.
- [ ] Resolves the actual branch name from the worktree HEAD (handles `-2`/`-3` collision suffixes correctly).
- [ ] Safety check: `git fetch origin --quiet`, then `git -C "$repo_root" merge-base --is-ancestor "$BRANCH_TIP" origin/main`. If the branch tip is NOT reachable from `origin/main`, refuse cleanup and exit non-zero with: `Refusing cleanup: <branch> is not reachable from origin/main. Either FF the branch first, or re-run with --force.`
- [ ] `--force` bypasses the safety check.
- [ ] On success: `git -C "$repo_root" worktree remove --force "$PLAN_WORKTREE"` + `git -C "$repo_root" branch -D "$BRANCH_NAME"`.
- [ ] `--prune-remote` additionally runs `git -C "$repo_root" push origin --delete "$BRANCH_NAME"`. Default behavior leaves origin branch as audit trail.
- [ ] `--dry-run` prints what would be removed and exits 0 without changes.
- [ ] Idempotent: re-running cleanup when worktree/branch are already gone exits 0 with a no-op message.
- [ ] `.copilot-plugin/copilot-skills/plan-with-ralph/SKILL.md` mirrors the same edits.
**Dependencies:** US-003
**Estimated complexity:** small

## US-005: Mirror all SKILL.md edits to `.copilot-plugin/copilot-skills/`
**Description:** As a cross-engine Ralph user, I want the Copilot-CLI copies of `plan-with-ralph` and `convert-to-ralph-prd` skills to match the Claude-Code copies, so that the auto-worktree behavior is identical regardless of which CLI invoked the skill.

**Acceptance Criteria:**
- [ ] `D:/ai-developer-toolkit/plugins/ralph/.copilot-plugin/copilot-skills/plan-with-ralph/SKILL.md` contains the same Phase 1, Phase 1B, Phase 5, and Cleanup-mode content as `skills/plan-with-ralph/SKILL.md` (modulo legitimate cross-engine differences that already exist in the file — e.g., engine-name in Copilot-CLI doc references).
- [ ] `D:/ai-developer-toolkit/plugins/ralph/.copilot-plugin/copilot-skills/convert-to-ralph-prd/SKILL.md` contains the same Step 5 refactor as `skills/convert-to-ralph-prd/SKILL.md`.
- [ ] `diff` between the Claude-Code and Copilot-CLI copies of each skill shows ONLY pre-existing cross-engine differences (no new drift introduced by this PR).
- [ ] If the toolkit repo has a sync-checker script (e.g., `tools/check-skill-mirrors.mjs`) it passes on the working tree before commit.
**Dependencies:** US-003, US-004 (mirrors what those stories add to the Claude-Code copies)
**Estimated complexity:** small

## US-006: Update `codexu/AGENTS.md` to retire WORKTREE MANDATE pattern
**Description:** As a bookkeeper-lead, I want `codexu/AGENTS.md` to reflect that `/plan-with-ralph` now self-manages its worktree, so that I no longer inject a manual `git worktree add` snippet into plan-member spawn prompts and so that future bookkeepers don't repeat the 2026-05-29 mistakes (sibling-of-repo worktrees, root-of-D-drive worktrees).

**Acceptance Criteria:**
- [ ] `D:/harness-efforts/codexu/AGENTS.md` "Worktree placement convention" sub-section no longer contains the paragraph beginning with `Caveat: /plan-with-ralph does NOT currently auto-manage a worktree`. Replaced with a sentence noting that as of this PR, `/plan-with-ralph` self-manages a worktree at `.ralph/jobs/<task-id>/worktree/plan/`.
- [ ] Spawn-prompt examples in `AGENTS.md` no longer reference manual `git worktree add` for plan members. The bookkeeper invocation becomes: spawn member, instruct it to run `/plan-with-ralph "<seed>"`, skill handles everything.
- [ ] New sub-section "Lead post-FF flow for plan-phase members" codifies the three-command pattern: `git fetch origin && git merge --ff-only <sha> && git push origin main && /plan-with-ralph cleanup <task-id>`.
- [ ] The "Branch + worktree discipline" section's "Plan-phase members commit on a topic branch in a worktree" bullet is updated to point at the skill rather than describing it as a manual member responsibility.
- [ ] The "Bookkeeper operating practice" section's spawn-prompt guidance is updated to reflect that plan-phase prompts no longer need a WORKTREE MANDATE block.
**Dependencies:** US-003, US-004 (the behavior they introduce is what the docs now reflect)
**Estimated complexity:** small

## US-007: End-to-end smoke test against a fresh task
**Description:** As a Ralph plugin maintainer, I want to verify the auto-worktree flow end-to-end by spawning a real plan-phase member against a synthetic task and observing that no manual WORKTREE MANDATE is needed, the worktree lands at the canonical path, the commit pushes cleanly, and the cleanup subcommand removes everything.

**Acceptance Criteria:**
- [ ] Choose a small synthetic task (e.g., add a one-line note to `codexu/docs/fork-notes.md`). Add it to `plans/overview-data.js` as a `tracked` task with a `command.prompts.plan` seed.
- [ ] Bookkeeper-lead invokes `/spawn-member plan-<synthetic-task> --crew <test-crew>` with a spawn prompt that does NOT contain the WORKTREE MANDATE language.
- [ ] Plan-phase member runs `/plan-with-ralph "<seed>"`; observes worktree created at `<repo_root>/.ralph/jobs/<synthetic-task>/worktree/plan/` on `ralph/plan-<synthetic-task>`.
- [ ] Plan-phase member's kind=done report contains the worktree path, branch, and commit SHA.
- [ ] Lead FFs the branch to main, pushes, runs `/plan-with-ralph cleanup <synthetic-task>`; cleanup succeeds, worktree is gone, local branch is deleted.
- [ ] Cleanup safety check is verified separately: temporarily revert the FF (or use a never-FF'd test branch), run `cleanup` without `--force`, observe the refusal message.
- [ ] No sibling-of-repo worktrees were created at any point.
- [ ] Lead's primary dir remained on `main` throughout.
**Dependencies:** US-005, US-006
**Estimated complexity:** small
