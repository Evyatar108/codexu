# Stories Outline: ralph-orchestration-worktree-conditional-submodule-init (NARROW re-plan)

*Preliminary decomposition from `/plan-with-ralph`. Feed to `/implement-with-ralph --from-plan` for PRD generation. Supersedes the OFF-TARGET 130bbff7 plan.*

## US-001: Make `runSubmoduleInit()` opt-in via `--init-submodules`
**Description:** As an autonomous impl member, I want `worktree-create.mjs` to skip submodule initialization by default and only init when `--init-submodules` is passed, so that plan-phase and impl-phase worktrees don't pay the multi-GB submodule-pull cost on every spawn.
**Acceptance Criteria:**
- [ ] `parseArgs` in `src/worktree-create.mjs` accepts `--init-submodules` and sets `opts.initSubmodules = true`; default is `false` via the initial opts object.
- [ ] `runSubmoduleInit(worktreePath, io, opts)` signature accepts `opts` and returns `false` BEFORE any filesystem touch when `!opts.initSubmodules`.
- [ ] Both call sites (reuse path + fresh path via `finishResult`) thread `opts` through; `finishResult` signature gains trailing `opts` arg.
- [ ] `helpText` documents the new flag and notes the new default is no-op.
- [ ] Default CLI invocation produces stdout JSON `"submoduleInitRan": false`, no lock-parent dir activity, and empty submodule dirs in the resulting worktree.
- [ ] Opt-in CLI invocation (`--init-submodules`) produces stdout JSON `"submoduleInitRan": true`, acquires + releases the lock, and populates declared submodules.
- [ ] Typecheck / `node --check src/worktree-create.mjs` passes.
**Dependencies:** None
**Estimated complexity:** small

## US-002: Update `tests/worktree-create.test.mjs` for v5.50.0 default
**Description:** As an autonomous impl member, I want the node:test cases to cover both the new default no-op path and the opt-in init path so that future regressions on either path are caught at test time.
**Acceptance Criteria:**
- [ ] Existing tests that asserted `submoduleInitRan: true` are amended with `initSubmodules: true` (preserving original intent) OR updated to `false` if the test was incidentally exercising the default.
- [ ] NEW test: default `createWorktree({ ... })` invocation (without `initSubmodules`) returns `submoduleInitRan === false`.
- [ ] NEW test: `createWorktree({ ..., initSubmodules: true })` returns `submoduleInitRan === true`.
- [ ] NEW CLI help-text test: `runCli(['--help'])` stdout contains `--init-submodules`.
- [ ] `node --test plugins/ralph/tests/worktree-create.test.mjs` passes including all amended + new cases.
**Dependencies:** US-001
**Estimated complexity:** small

## US-003: Redesign `tests/test-submodule-worktree-init.sh` for v5.50.0
**Description:** As an autonomous impl member, I want the bash behavioral test to (a) cover the new CLI default no-op and opt-in cases against the existing super-repo fixture, (b) drop assertions that became false under v5.50.0, and (c) add negative-assertions covering the v5.50.0 prose contract for the three updated SKILL.md files. The test must NOT amend the existing `assert_source_contract` / `assert_grep_contracts` semantics naively — the source files no longer contain `git submodule update --init`, so those assertions need REPLACEMENT not amendment.
**Acceptance Criteria:**
- [ ] In `create_fixture_repos()`, `git config protocol.file.allow always` is set on the super-repo immediately after `git init` so worktrees created via `worktree-create.mjs` inherit the config (mitigates F-004; without this the helper's plain `git submodule update --init --recursive` fails against the file:// fixture submodule).
- [ ] `assert_source_contract($decompose)` and `assert_source_contract($convert)` are removed from `assert_grep_contracts()` (both files lose the `git submodule update --init` line under v5.50.0).
- [ ] The two `assert_file_contains "$copilot_*" "git submodule update --init"` calls in `assert_grep_contracts()` are removed (mirrors lose the line too).
- [ ] `assert_batch_scope($convert)` is KEPT (still true: convert-to-ralph-prd batch-mode prose at line ~372 does not contain init command).
- [ ] NEW assertion: decompose-plan SKILL.md does NOT contain `git submodule update --init --recursive` anywhere in Step 5b's section.
- [ ] NEW assertion: convert-to-ralph-prd SKILL.md Step 5 prose does NOT contain `submodules initialize under the shared cross-process lock` AND DOES contain `--init-submodules` reference.
- [ ] NEW assertion: plan-with-ralph SKILL.md Phase 1B prose does NOT contain `initializes submodules under the shared Ralph lock` AND DOES contain `--init-submodules` reference.
- [ ] NEW CLI case "default no-op": `node "$PLUGIN_ROOT/src/worktree-create.mjs" --target-repo $SUPER_REPO --worktree-path <fresh-wt> --branch <br> --json` returns JSON `.submoduleInitRan == false`, `git -C <wt> submodule status` lines all begin with `-`, lock-parent dir existence-state unchanged.
- [ ] NEW CLI case "opt-in init": same command with `--init-submodules` returns `.submoduleInitRan == true`, submodule status lines all begin with space.
- [ ] The existing `run_locked_submodule_update()` behavioral fixture is either deleted OR repurposed as a regression test asserting decompose-plan's new "no inline init" prose. Repurpose preferred.
- [ ] `bash plugins/ralph/tests/test-submodule-worktree-init.sh` passes end-to-end.
**Dependencies:** US-001, US-004 (decompose-plan), US-004b (convert-to-ralph-prd), US-004c (plan-with-ralph)
**Estimated complexity:** medium

## US-004: Remove inline submodule-init from `decompose-plan` Step 5b
**Description:** As a parallel-group impl member, I want `decompose-plan` Step 5b to NOT initialize submodules in my worktree post-creation, matching the v5.50.0 worktree-create.mjs no-op default for parity. If I need submodule code, I run `git submodule update --init <path>` from inside my worktree on demand.
**Acceptance Criteria:**
- [ ] `skills/decompose-plan/SKILL.md` Step 5b's prose paragraph "After the worktree has been added or validly reused, initialize submodules under the shared cross-process lock at ..." is removed.
- [ ] The entire inline bash block (`lock_parent=...` + acquire-loop + `git submodule update --init --recursive` + cleanup + trap) is removed.
- [ ] A replacement 1-paragraph note explains: "After the worktree is added or validly reused, do NOT initialize submodules. Members whose work requires submodule contents run `git submodule update --init <path>` from inside the worktree on demand. This matches the v5.50.0 worktree-create.mjs no-op default; see `plugins/ralph/AGENTS.md` `## v5.50.0 Behavioral Additions` for the pivot rationale."
- [ ] `.copilot-plugin/internal-workflows/decompose-plan/SKILL.md` regenerated via `node plugins/ralph/scripts/generate-copilot-artifacts.mjs --write`.
- [ ] `node plugins/ralph/scripts/generate-copilot-artifacts.mjs --check` passes post-edit.
- [ ] `node plugins/ralph/scripts/check-copilot-parity.mjs` passes.
**Dependencies:** US-001
**Estimated complexity:** small

## US-004b: Rewrite stale submodule-init prose in `convert-to-ralph-prd` Step 5
**Description:** As a doc reader, I want the `convert-to-ralph-prd` Step 5 prose to accurately describe the v5.50.0 worktree-create.mjs no-op default rather than claiming the helper initializes submodules under a shared lock.
**Acceptance Criteria:**
- [ ] In `skills/convert-to-ralph-prd/SKILL.md`, the "The helper owns the behavior previously inlined here:" bullet list submodule-init bullet (around line ~396 in v5.49.0) is rewritten to: "submodule initialization is OPT-IN via `--init-submodules` (default off in v5.50.0+); this caller omits the flag so the impl worktree starts with uninitialized submodules. Members run `git submodule update --init <path>` on demand from inside the worktree."
- [ ] Batch-mode prose (around line ~372) is UNTOUCHED — it remains factually correct ("do not initialize submodules" because batch mode doesn't, regardless of helper default).
- [ ] `.copilot-plugin/internal-workflows/convert-to-ralph-prd/SKILL.md` regenerated via `generate-copilot-artifacts.mjs --write`.
- [ ] `--check` and `check-copilot-parity.mjs` pass.
**Dependencies:** US-001
**Estimated complexity:** small

## US-004c: Rewrite stale submodule-init prose in `plan-with-ralph` Phase 1B
**Description:** As a doc reader, I want the `plan-with-ralph` Phase 1B prose to accurately describe the v5.50.0 worktree-create.mjs no-op default rather than claiming the helper "initializes submodules under the shared Ralph lock".
**Acceptance Criteria:**
- [ ] In `skills/plan-with-ralph/SKILL.md`, the post-bash-block paragraph that lists `worktree-create.mjs` behaviors (around line ~323 in v5.49.0) is rewritten to drop the "and initializes submodules under the shared Ralph lock" clause AND append: "Submodule init is opt-in via `--init-submodules` (default off in v5.50.0+); this caller omits the flag so the plan worktree starts with uninitialized submodules."
- [ ] `.copilot-plugin/copilot-skills/plan-with-ralph/SKILL.md` regenerated via `generate-copilot-artifacts.mjs --write`.
- [ ] `--check` and `check-copilot-parity.mjs` pass.
**Dependencies:** US-001
**Estimated complexity:** small

## US-005: Add v5.50.0 sections to AGENTS.md + CHANGELOG.md
**Description:** As a plugin consumer reading the changelog before upgrading, I want a clear v5.50.0 entry explaining the pivot from v5.42.0 unconditional-init behavior so I can audit my flows before pulling the new version.
**Acceptance Criteria:**
- [ ] `plugins/ralph/AGENTS.md` has a `## v5.50.0 Behavioral Additions` section inserted above the existing v5.49.0 section.
- [ ] The section contains at least 6 bullets covering: pivot from v5.42.0, new `--init-submodules` flag, decompose-plan Step 5b removal, convert-to-ralph-prd + plan-with-ralph prose updates, explicit non-changes list (env-var / precedence / PRD field / Step 5 call wiring / Phase 1B call wiring), self-heal contract, consumer-impact summary.
- [ ] `plugins/ralph/CHANGELOG.md` has a `## v5.50.0` entry inserted above the v5.49.0 entry, mirroring the AGENTS.md bullets in changelog style.
- [ ] CHANGELOG.md entry explicitly mentions the pivot from v5.42.0 unconditional-init behavior.
**Dependencies:** US-001, US-004, US-004b, US-004c
**Estimated complexity:** small

## US-006: Bump 5 version stamps lockstep to 5.50.0
**Description:** As a marketplace consumer, I want all 5 toolkit-side version stamps to advance in lockstep so `copilot plugin update` from any marketplace index pulls v5.50.0.
**Acceptance Criteria:**
- [ ] `plugins/ralph/.claude-plugin/plugin.json` `version` field bumped `5.49.0` → `5.50.0`.
- [ ] `plugins/ralph/.github/plugin/plugin.json` `version` field bumped `5.49.0` → `5.50.0`.
- [ ] `.claude-plugin/marketplace.json` ralph entry version bumped `5.49.0` → `5.50.0`.
- [ ] `.github/plugin/marketplace.json` ralph entry version bumped `5.49.0` → `5.50.0`.
- [ ] `.agents/plugins/marketplace.json` ralph entry version bumped `5.49.0` → `5.50.0`.
- [ ] Sanity grep `grep -rl "5\\.49\\.0" plugins/ralph/.claude-plugin plugins/ralph/.github/plugin .claude-plugin/marketplace.json .github/plugin/marketplace.json .agents/plugins/marketplace.json` returns zero matches.
**Dependencies:** US-005
**Estimated complexity:** small

## US-007: Run quality gates and commit toolkit topic branch
**Description:** As the autonomous impl member, I want to run all quality gates before commit and push the toolkit-side topic branch so the lead can review + FF-merge.
**Acceptance Criteria:**
- [ ] `node --test plugins/ralph/tests/worktree-create.test.mjs` exits 0.
- [ ] `bash plugins/ralph/tests/test-submodule-worktree-init.sh` exits 0.
- [ ] `node plugins/ralph/scripts/generate-copilot-artifacts.mjs --check` exits 0.
- [ ] `node plugins/ralph/scripts/check-copilot-parity.mjs` exits 0.
- [ ] All edits + version bumps committed on topic branch `ralph/plan-worktree-conditional-narrow` in `ai-developer-toolkit/` worktree.
- [ ] Topic branch pushed to ai-developer-toolkit `origin`.
- [ ] kind=done report issued with commit SHA + branch + Phase-4 findings summary.
**Dependencies:** US-002, US-003, US-004, US-004b, US-004c, US-005, US-006
**Estimated complexity:** small

## US-008: (LEAD-OWNED follow-up) Codexu submodule pointer bump
**Description:** As the codexu bookkeeper-lead (or a brief follow-up impl member), I commit the codexu submodule pointer bump after the toolkit FF-merge so codexu records the v5.50.0 toolkit-main SHA.
**Acceptance Criteria:**
- [ ] `ai-developer-toolkit` submodule pointer in codexu staged to the toolkit-main SHA produced by the lead's FF-merge of US-007's toolkit topic branch.
- [ ] `D:/harness-efforts/codexu/AGENTS.md` `## Active plugin versions` table row for `ralph (ralph-orchestration)` updated from `5.49.0` to `5.50.0`.
- [ ] Both changes committed on topic branch `ralph/plan-worktree-conditional-narrow` in codexu.
- [ ] Topic branch pushed to codexu `origin`.
- [ ] Lead executes FF-merge to codexu-main + multi-remote push per codexu/AGENTS.md ask-before-pushing rule.
**Dependencies:** US-007 + lead toolkit FF-merge
**Estimated complexity:** small
