---
overviewTaskId: ralph-orchestration-worktree-conditional-submodule-init
---

## Direction
D-001 — Phase-aware escape hatch (--no-submodule-init flag + plan-default-skip). Ship a minimal, low-risk first cut: add a CLI flag + env-var override on worktree-create.mjs, default plan-phase callers to skip submodule init, leave impl-phase callers on the current init-all behavior unchanged. Defer the larger PRD-schema work (D-002) and self-heal recovery (D-003) until D-001's telemetry shows whether they're worth the additional complexity.

## Goal
worktree-create.mjs accepts a `--no-submodule-init` CLI flag and an equivalent `RALPH_NO_SUBMODULE_INIT=1` env-var override. When either is set, `runSubmoduleInit()` returns false WITHOUT acquiring the cross-process lock and WITHOUT invoking `git submodule update --init --recursive`; the success-JSON `submoduleInitRan` field is `false`. Plan-with-ralph plan-phase spawn sites pass `--no-submodule-init` by default. convert-to-ralph-prd standalone Step 5 and decompose-plan Step 5b impl-worktree paths continue to call worktree-create.mjs WITHOUT the flag, preserving the v5.42.0 init-all-on-impl safety. All existing tests in tests/test-submodule-worktree-init.sh and tests/worktree-create.test.mjs continue to pass unmodified; three new test cases cover the flag + env var + their combination. The Claude source SKILL.md files and their `.copilot-plugin/` mirrors are updated in lockstep via `scripts/generate-copilot-artifacts.mjs --write`. AGENTS.md gets a new v5.4X.0 Behavioral Additions section documenting the new flag, env var, plan-default change, and explicit non-change to impl-phase callers.

## Scope

### In Scope
- New `--no-submodule-init` boolean CLI flag on `D:/harness-efforts/codexu/ai-developer-toolkit/plugins/ralph/src/worktree-create.mjs` (default false).
- New `RALPH_NO_SUBMODULE_INIT` env var (truthy values: `1`, `true`, `yes`; case-insensitive; falsy/absent: default unchanged).
- Effective skip: either signal causes `runSubmoduleInit()` to return false WITHOUT acquiring the lock at `~/.cache/ralph-orchestration/submodule-init.lockd` (do not waste the lock budget on a no-op).
- Success-JSON contract update: `submoduleInitRan: false` when skipped, both in `finishResult()` and in the worktree-reuse branch.
- Plan-worktree spawn sites in `skills/plan-with-ralph/SKILL.md` default to passing `--no-submodule-init` — likely in Phase 2 (research) and Phase 4 (review) staging setup if those create worktrees; also `--improve` if applicable. The implementer must audit plan-with-ralph for every `worktree-create.mjs` call site and assess each independently — only sites that genuinely don't need submodule content get the default-skip wire-up.
- Equivalent edits in `.copilot-plugin/copilot-skills/plan-with-ralph/SKILL.md` (regenerated via `scripts/generate-copilot-artifacts.mjs --write`).
- Codexu-relevant plan-worktree paths in `skills/decompose-plan/SKILL.md` if any exist (decompose-plan Step 5b is impl-phase, but verify there is no plan-phase worktree usage worth skipping).
- New test cases in `tests/test-submodule-worktree-init.sh` and `tests/worktree-create.test.mjs`: (a) flag-only sets `submoduleInitRan: false` and leaves submodule dirs empty; (b) env-only sets `submoduleInitRan: false`; (c) flag + env set both produce `submoduleInitRan: false`; (d) regression — neither flag nor env produces the v5.46.0 default behavior (lock acquired, `submoduleInitRan: true`, submodule populated).
- Update `AGENTS.md` with a new `## v5.4X.0 Behavioral Additions` section following the v5.42.0 documentation style. Mention: new CLI flag, env-var precedence (flag > env > default), plan-phase default change, explicit impl-phase non-change, lock-acquisition skip on no-op path, and the test gate.
- Plugin version bump and 5-stamp sync per the v5.41.0+ marketplace-sync rule: `plugins/ralph/.claude-plugin/plugin.json`, `plugins/ralph/.github/plugin/plugin.json`, `.claude-plugin/marketplace.json`, `.github/plugin/marketplace.json`, `.agents/plugins/marketplace.json`.
- Two-commit submodule pattern: ship the toolkit-side change first inside `ai-developer-toolkit/` (commit + push to all 3 toolkit remotes including `gim-home` for marketplace pickup), THEN commit the codexu submodule pointer bump in the parent repo.
- Smoke-test: spawn one codexu plan-phase member after the change lands; verify the spawn-prompt's `worktree-create.mjs` call observes `submoduleInitRan: false` and the spawn completes meaningfully faster than a v5.46.0 baseline spawn.

### Out of Scope
- PRD schema field `submodulesNeeded` or `submoduleInit.{mode,paths}` (deferred to D-002 as a separate task).
- Auto-derive of submodule scope from plan.md grep at `convert-to-ralph-prd` time (deferred to D-002).
- Lazy self-heal recovery in iteration agent or story-doctor (deferred to D-003).
- Per-spawn timing instrumentation JSONL (deferred to D-004; could run in parallel without blocking D-001).
- Defaulting impl-phase callers to `--no-submodule-init` (intentionally NOT done — the impl safety net of init-all stays in place; operator can pass the flag manually if they know the impl scope doesn't need submodule code, but the default-on protects against silent compile/test failure).
- Phase 5a code-reviewer prompt updates to detect "green-but-meaningless verification" (DA's Q7 risk, only relevant if D-002 or D-003 ships).
- Modifying the codex/ submodule's contents or its `.gitmodules` declaration in codexu.

## Criteria

The following criteria must each be verifiable by a concrete command or a Phase 5a reviewer-visible diff. Avoid AC patterns that are vague or that the criteria-validator would flag as `TESTS_UNDERSPECIFIED`.

1. `node ai-developer-toolkit/plugins/ralph/src/worktree-create.mjs --target-repo <REPO> --worktree-path <WT> --branch <BR> --no-submodule-init --json` returns exit 0 with stdout JSON containing `"submoduleInitRan": false`, AND running `git -C <WT> submodule status` shows each submodule line begins with `-` (uninitialized marker), AND no `~/.cache/ralph-orchestration/submodule-init.lockd` was created during this invocation (asserted by mtime check on the lock-parent dir before/after).
2. `RALPH_NO_SUBMODULE_INIT=1 node ai-developer-toolkit/plugins/ralph/src/worktree-create.mjs --target-repo <REPO> --worktree-path <WT2> --branch <BR2> --json` (WITHOUT the CLI flag) produces the same `"submoduleInitRan": false` result and the same uninitialized-submodule outcome. Truthy env values `1`, `true`, `yes` (case-insensitive) all skip; falsy/empty/absent does not skip.
3. Default invocation (neither flag nor env set): `node ai-developer-toolkit/plugins/ralph/src/worktree-create.mjs --target-repo <REPO> --worktree-path <WT3> --branch <BR3> --json` returns `"submoduleInitRan": true`, acquires + releases the lock, and populates each declared submodule (verified by `git -C <WT3> submodule status` showing each line begins with a space, not `-`). Byte-for-byte equivalent to v5.46.0 baseline; all pre-existing tests in `tests/test-submodule-worktree-init.sh` and `tests/worktree-create.test.mjs` pass unmodified.
4. `bash plugins/ralph/tests/test-submodule-worktree-init.sh` passes including 4+ new cases: flag-only, env-only, flag+env, plus a default-unchanged regression case asserting `submoduleInitRan: true`.
5. `node --test plugins/ralph/tests/worktree-create.test.mjs` passes including the equivalent Node-test cases.
6. plan-with-ralph spawn sites that create plan-only worktrees pass `--no-submodule-init` by default. Verified by reading the SKILL.md call sites and asserting the flag is present; the impl member must list every `worktree-create.mjs` call in plan-with-ralph (Claude source) and its `.copilot-plugin` mirror, with a per-site decision rationale (skip or keep).
7. `convert-to-ralph-prd` Step 5 and `decompose-plan` Step 5b impl-worktree paths do NOT pass `--no-submodule-init`. Verified by SKILL.md grep returning no occurrences of the flag in those impl-phase sites.
8. AGENTS.md has a new `## v5.4X.0 Behavioral Additions` section documenting the flag, env var, precedence rule, plan-phase default change, impl-phase non-change, lock-skip on no-op, and test gate, with at least 6 bullet points in the v5.42.0 style.
9. `node plugins/ralph/scripts/generate-copilot-artifacts.mjs --check` and `node plugins/ralph/scripts/check-copilot-parity.mjs` both pass.
10. Plugin version bumped (suggested: v5.47.0 or next available); all 5 version-stamp locations updated to the new version in one commit.
11. The toolkit-side commit lands on `origin/main`, `personal/main`, AND `gim-home/main` for marketplace consumer pickup. The codexu submodule pointer bump commit lands AFTER on codexu `origin/main` (per the two-commit submodule pattern).
12. A post-ship codexu smoke spawn: spawn one plan-phase crew member using `/plan-with-ralph` (any small fuzzy idea). Observe stderr / staging output showing `worktree-create.mjs` returned `submoduleInitRan: false`. No submodule directory was populated in the plan worktree. The plan completes its research/review phases without referencing missing submodule code (proves the disconfirming observation in D-001 — that plan-phase needs submodule code — is false for at least this representative case).

## Context

Multi-lens brainstorm at xhigh effort across Codex (Feasibility Mapper), Copilot (Product-Reality Challenger), and a Devil's Advocate (general-purpose Agent). Three lenses converged on D-001 as the right first-cut in a staged rollout where the minimal escape hatch ships first and larger investments (D-002 PRD-declared scope, D-003 self-heal recovery) are gated on D-001's telemetry. Devil's Advocate flagged D-004 (measure-first) as the only reframe that questions whether the framing is even correct; that work is ~2 hours of instrumentation and can run in parallel with D-001 without blocking it.

### Key risks the implementer should keep visible during planning

- (codex, disconfirming-obs for D-001) Plan-with-ralph's research/review phases MAY currently grep code inside the `ai-developer-toolkit/` submodule path for context lookup. If they do, defaulting plan worktrees to `--no-submodule-init` would break planning. The impl member MUST audit every `worktree-create.mjs` call in plan-with-ralph SKILL.md and assess each per-site. If a site actually needs submodule content, do NOT default-skip it — instead, expose the flag and let the caller decide. The criteria require a per-site decision rationale, not a blanket flip.
- (Devil's Advocate) If a future D-002 or D-003 ships on top of D-001 and starts skipping submodules on impl paths, the Phase 5a code-reviewer prompt MUST gain a "green-but-meaningless verification" check (look for `0 tests found`, suspiciously-fast test runs, fallback paths triggered by missing files). D-001 alone does not need this because plan worktrees don't run test suites. Flag this as a follow-up brainstorm for the D-002 task.
- (codex) Open question: canonical override shape. `--no-submodule-init` + `--init-submodules <list>` (two flags) vs single `--submodule-init=none|all|scoped` (one flag). Two-flag composes better with future D-002 (operator can pass `--init-submodules codex` to override a PRD `submodulesNeeded: []`). One-flag is more discoverable. Tentatively recommend two-flag for forward composability; planning should make the explicit decision and stamp it into the AGENTS.md addition.
- (Devil's Advocate) The unconditional-init pattern was added DELIBERATELY in v5.42.0 (W-5 Prereq A) with a cross-process lock + two env tunables. The v5.42.0 commit message and AGENTS.md entry should be re-read during planning to understand the failure modes that motivated unconditional init — this work intentionally relaxes that safety on plan-phase only, where the failure modes don't apply. The planning doc should explicitly cite v5.42.0 and explain why plan-phase is the safe relaxation surface.

### Constraints carried forward from brainstorm

- Changes must live in the ralph-orchestration plugin source at `D:/harness-efforts/codexu/ai-developer-toolkit/plugins/ralph`.
- Submodule edits use the fork's two-commit pattern: commit + push inside `ai-developer-toolkit/` first (to `origin`, `personal`, AND `gim-home`), THEN commit the codexu pointer bump.
- The plugin powers OTHER consumers besides codexu. The new flag MUST be a no-op when the consumer repo has no submodules (no `.gitmodules` file or empty submodule list), so non-codexu consumers see zero behavior change.
- Crews v3.2.0+ resilience improvements mean a stalled plan member won't disengage the session anymore, but the wall-clock waste is still bad UX. D-001's win is real even with the new resilience.

### Deferred to follow-up brainstorms

The four open questions in `brainstorm.json.questionsForSynthesis` that are not addressed by D-001 alone should be carried into the D-002 brainstorm seed when/if it spawns: (1) PRD-field shape, (2) existing-PRD auto-derive policy, (3) backward-compat default for PRDs without submodule scope, (4) the "what signal tells impl member 'missing-submodule vs real failure'" diagnostic question.

### Path to brainstorm artifacts

Full synthesis at `.ralph/brainstorms/ralph-orchestration-worktree-conditional-submodule-init/brainstorm-synthesis.md`. Machine-readable manifest at `.ralph/brainstorms/ralph-orchestration-worktree-conditional-submodule-init/brainstorm.json`. Per-lens raw outputs were in the Phase 1-3 staging directory but were cleaned up at Phase 5 finalize per the skill contract; the per-direction `contributingLenses` attribution in `brainstorm.json` preserves which lens endorsed which direction.
