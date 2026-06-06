# Stories Outline: Constrain Copilot CLI research-mode invocations to read-only

*Preliminary decomposition from `/plan-with-ralph`. Feed to `/implement-with-ralph --from-plan` for PRD generation.*

## US-001: Reusable WIP-preserving working-tree snapshot/revert helper
**Description:** As a ralph maintainer, I want a reusable `src/worktree-snapshot.mjs` primitive that captures a working-tree snapshot and reverts only out-of-zone changes made during an invocation window, so the copilot read-only guard (and a future codex-exec port) can enforce "no residual change" without destroying operator WIP.
**Acceptance Criteria:**
- [ ] `captureSnapshot(cwd, { allowWritePaths })` records exact pre-run content + file mode for every path that could be written outside the allowed zone (clean tracked → HEAD blob; pre-dirty tracked and pre-existing untracked → actual bytes), plus index state. Git fast-path via `git status --porcelain=v1`; non-git filesystem-manifest fallback excluding `.git`/`node_modules`/`.ralph`/gitignored heavies/allowed zone.
- [ ] `revertOutsideZone(snapshot, cwd, { allowWritePaths })` restores modified AND deleted out-of-zone files to exact pre-run content+mode, deletes newly-created out-of-zone files, removes newly-created empty dirs deepest-first (never pre-existing dirs), and returns the reverted-paths list. Restores ONLY window-changed paths (never `git checkout HEAD -- .`).
- [ ] Initialized nested repos/submodules under cwd are either recursively protected or trigger a read-only-fail when a write can't be safely restored.
- [ ] Path-canonicalization helper resolves symlinks/junctions + case-folds on Windows before zone-containment checks.
- [ ] Test matrix (`tests/test-worktree-snapshot.mjs`) passes: clean tracked modify, clean tracked delete, pre-dirty tracked modify, pre-dirty tracked delete, staged change preserved, pre-existing untracked modify, pre-existing untracked delete, newly-created untracked file + empty-dir removal, symlink/junction containment, nested-repo write, exact-output-file-allowed vs sibling-disallowed.
- [ ] Typecheck/lint passes; `node plugins/ralph/tests/run.mjs` discovers and passes the new test.
**Dependencies:** None
**Estimated complexity:** large

## US-002: Opt-in `--read-only` guard on copilot-exec.mjs
**Description:** As a ralph maintainer, I want copilot-exec.mjs to support an opt-in `--read-only` mode that tightens permissions and wraps the copilot run with the snapshot/revert guard, so research/review-mode invocations can't leave residual edits in the working tree, while the implementer/plan-fix write path is unchanged by default.
**Acceptance Criteria:**
- [ ] New `parseArgs` flags: `--read-only` (boolean, default false) and `--allow-write-path <dir>` (repeatable). Default implicit allowed zone = the exact `--output` FILE only (NOT its parent dir). `--allow-write-path` values that canonicalize to repo root/cwd are rejected or loudly warned.
- [ ] When `--read-only`: childArgs use `--allow-all-tools --deny-tool=write` (keep `--silent`). When absent: childArgs are byte-for-byte `--allow-all --silent` (v5.50.0 behavior preserved).
- [ ] `captureSnapshot` runs before spawn; revert runs in the `finally` AND in SIGINT/SIGTERM handlers, which first stop the child process tree then run a synchronous idempotent revert.
- [ ] On a detected+reverted violation: emit a single stderr line `<copilot-readonly-violation>{"originalExitCode":N,"revertedPaths":[...]}</copilot-readonly-violation>` and return exit code 3; preserve the `--output` file. A clean read-only run preserves copilot's own exit code/output. Revert-failure returns a distinct non-3 non-zero code.
- [ ] `tests/test-copilot-readonly-guard.mjs` invokes `main(argv, { spawn })` with an injected spawn stub (NOT `COPILOT_EXEC_SCRIPT`) whose fake child writes OUTSIDE the zone via shell redirection; asserts the file is reverted, sentinel emitted, exit 3. Also covers: non-git cwd fallback, SIGTERM-mid-write revert, and an in-allowed-zone write that is NOT reverted (exit preserved).
- [ ] Default-off regression: a non-read-only run's childArgs are byte-for-byte identical to v5.50.0; existing `test-copilot-exec.mjs` and regression-smoke tests pass.
**Dependencies:** US-001
**Estimated complexity:** large

## US-003: Flip research/review callers to `--read-only` + prompt-layer note + mirror regen
**Description:** As a ralph maintainer, I want every Copilot research/review-mode caller to pass `--read-only` (and an explicit `--allow-write-path`), the copilot prompts to carry a "research only" note, and the `.copilot-plugin` mirror regenerated, so the guard is actually engaged everywhere it should be and write-mode paths stay untouched.
**Acceptance Criteria:**
- [ ] These callers pass `--read-only` + `--allow-write-path <staging-or-job-dir>`: `skills/brainstorm-with-ralph/SKILL.md`, `skills/plan-with-ralph/SKILL.md` (Phase 2 + Phase 4), `skills/review-changes/SKILL.md`, `skills/review-plan-with-ralph/SKILL.md`, `skills/multi-model-investigate/SKILL.md`, `agents/plan-reviewer.md`, and the `src/review-loop.mjs` re-review `copilot-opus` slot.
- [ ] Write-mode callers are NOT given `--read-only`: `src/ralph.mjs` per-iteration copilot implementer and the `src/review-loop.mjs` plan-fix path (`planningEngine=copilot`).
- [ ] `agents/copilot-planner-prompt.md`, `agents/copilot-reviewer-prompt.md`, and `agents/copilot-brainstorm-prompt.md` carry a "RESEARCH ONLY — do not create, edit, or delete any file; your only output is your analysis text" note (defense-in-depth).
- [ ] A regression test asserts the caller split (every research/review caller has `--read-only`; write callers don't) to prevent SKILL.md prose drift.
- [ ] `.copilot-plugin` mirror regenerated via `node plugins/ralph/scripts/generate-copilot-artifacts.mjs --write`; `node plugins/ralph/scripts/generate-copilot-artifacts.mjs --check && node plugins/ralph/scripts/check-copilot-parity.mjs` passes.
- [ ] Typecheck passes; `node plugins/ralph/tests/run.mjs` passes.
**Dependencies:** US-002
**Estimated complexity:** medium

## US-004: CHANGELOG + version bump (5.51.0) + AGENTS.md behavioral section
**Description:** As a ralph maintainer, I want the release stamped and documented so consumers pick up the read-only guard and understand its Copilot-only scope and the failure pattern it prevents.
**Acceptance Criteria:**
- [ ] `plugins/ralph/CHANGELOG.md` has a `## v5.51.0` entry citing the 2026-05-28 16-file-edit failure pattern and explicitly scoping the guarantee to **Copilot** research/review invocations (codex-exec deferred to a follow-up).
- [ ] All 5 version stamps read `5.51.0`: `plugins/ralph/.claude-plugin/plugin.json`, `plugins/ralph/.github/plugin/plugin.json`, `.claude-plugin/marketplace.json`, `.github/plugin/marketplace.json`, `.agents/plugins/marketplace.json`.
- [ ] `plugins/ralph/AGENTS.md` has a `## v5.51.0 Behavioral Additions` section describing the opt-in `--read-only` flag, the snapshot/revert guard, the exit-3 violation contract, and the Copilot-only scope.
- [ ] `node tools/validate-codex-marketplace-policy.mjs` passes (codex marketplace policy enums valid); the documented copilot release gate passes.
**Dependencies:** US-003
**Estimated complexity:** small
