# Stories Outline: Fill `explorer.toml` for built-in `explorer` role

*Preliminary decomposition from `/plan-with-ralph`. Feed to `/implement-with-ralph --from-plan` for PRD generation. **Refreshed after Round 2 review** (path-scoped stash, SANDBOX PATCH markers, defer-staging-until-after-smoke, expanded write-class checks).*

> All cargo / `just fmt` commands run from `external/repos/codex-patched/codex-rs/` inside the codex worktree (the "cargo root"). All `git -C codex …` commands run from the codexu superproject root. Path views per the plan: `core/...` = cargo-root view; `docs/...` = codex-worktree view; `codex/...` = codexu-superproject view.

## US-001: Pre-flight SHA-record-then-checkout (NOT stash) + create codex submodule worktree
**Description:** As an implementer, I want to isolate the existing unstaged `M codex` gitlink change so it doesn't roll into our pointer-bump commit, and I want a clean topic-branch worktree.
**Acceptance Criteria:**
- [ ] If `git status` (codexu root) shows `modified: codex`: record `PREFLIGHT_CODEX_SHA=$(git -C codex rev-parse HEAD)` and `SUPERPROJECT_RECORDED_SHA=$(git rev-parse HEAD:codex)` into `<job_dir>/preflight-stash.md` (JSON-in-md).
- [ ] Sanity-check: `git -C codex status --porcelain` returns empty (no dirty inner working tree). Otherwise abort.
- [ ] `git -C codex checkout "$SUPERPROJECT_RECORDED_SHA"` makes the main codex checkout match the superproject's recorded pointer; `git status` in codexu root no longer shows `modified: codex`.
- [ ] **`git stash` is NOT used** — Codex round-4 verified that `git stash push -- codex` does not reliably stash an unstaged submodule gitlink.
- [ ] `.worktrees/`, `tasks/`, and unrelated working-tree changes remain untouched.
- [ ] `git -C codex fetch origin main` succeeds.
- [ ] `git -C codex worktree add -b feat/explorer-role-prompt <job_dir>/codex-worktree origin/main` succeeds and the worktree dir exists.
- [ ] Worktree HEAD is on branch `feat/explorer-role-prompt`, based on `origin/main`.
**Dependencies:** None
**Estimated complexity:** small

## US-002: Paraphrase + save `explorer.toml`
**Description:** As the codex agent author, I want a paraphrased Explore prompt + required markers embedded in `core/src/agent/builtins/explorer.toml` so the built-in `explorer` role has a compliant body.
**Acceptance Criteria:**
- [ ] (cargo-root path) `core/src/agent/builtins/explorer.toml` line 1 = comment header identifying inspiration (Claude Code's Explore subagent), with explicit paraphrase note.
- [ ] Line 2 = `# SANDBOX PATCH:` marker (required by `codex/CLAUDE.md` line 21).
- [ ] File contains `model_reasoning_effort = "low"`, `developer_instructions = """..."""` (trimmed body length ≥ 200), and `project_doc_fallback_filenames = []`.
- [ ] **In the `developer_instructions` body only** (not header, not SANDBOX PATCH marker): no occurrence of `Claude Code`, `Anthropic`, or `Anthropic's CLI`.
- [ ] No verbatim spans > 5 consecutive words from `exploreAgent.ts:24-56` in the body (operator verifies in US-004).
- [ ] File does NOT contain `sandbox_mode = "read-only"`.
**Dependencies:** US-001
**Estimated complexity:** medium

## US-003: Update + add tests; cargo check, cargo test, just fmt (with SANDBOX PATCH markers)
**Description:** As an implementer, I want role-tests to reflect new TOML behavior + guard the new invariants, with proper `// SANDBOX PATCH:` markers.
**Acceptance Criteria:**
- [ ] (cargo-root path) `core/src/agent/role_tests.rs` existing test (lines 92-105) is renamed to `apply_explorer_role_preserves_current_model_and_sets_reasoning_effort_low` and asserts: (a) caller's `model` preserved; (b) `model_reasoning_effort` is set to `Low` by the role layer. **Setup must seed caller's model via CLI overrides or config.toml** (mirror `apply_role_preserves_unspecified_keys`), NOT by post-stack mutation of `config.model`.
- [ ] New test `built_in_explorer_role_parses_and_has_non_blank_developer_instructions` asserts: (a) `config_file_contents(Path::new("explorer.toml"))` returns `Some`; (b) parses via `toml::from_str::<ConfigToml>` to `Ok`; (c) parsed `developer_instructions` is `Some` with trimmed length ≥ 200; (d) **strong project_doc_fallback_filenames clearing (raw-TOML form only)**: parse via `toml::from_str::<toml::Value>` and assert the top-level table has an **explicit** key `project_doc_fallback_filenames` whose value is an empty array. Codex round-4 confirmed both the `ConfigToml`-typed check AND the seed-then-apply-role alternative are false positives (the latter because `apply_role_to_config` rebuilds from `config.config_layer_stack`, ignoring the seeded mutation).
- [ ] **Session-flags layer-count assertion**: a test (this one or a sibling) uses `session_flags_layer_count(&config)` (existing helper at `role_tests.rs:586-614`) to assert that applying the explorer role adds exactly one layer (count_after - count_before == 1).
- [ ] Each updated/new test `fn` line carries a `// SANDBOX PATCH:` marker.
- [ ] `cargo check -p codex-core` succeeds (run from `external/repos/codex-patched/codex-rs/`).
- [ ] `cargo test -p codex-core explorer` passes (all updated + new tests).
- [ ] `just fmt` (run from `external/repos/codex-patched/codex-rs/`) leaves no formatting drift; `git status` clean of fmt-only changes.
**Dependencies:** US-002
**Estimated complexity:** medium

## US-004: License paraphrase review (operator gate)
**Description:** As the operator, I want to verify side-by-side that prose satisfies `plans/native-agent-parity.md §4` before any commit.
**Acceptance Criteria:**
- [ ] Side-by-side diff is surfaced: paraphrased `developer_instructions` body vs `exploreAgent.ts:24-56`.
- [ ] Operator confirms no verbatim spans > 5 consecutive words in body.
- [ ] Operator confirms no `Claude Code` / `Anthropic` / `Anthropic's CLI` in body (header + SANDBOX PATCH marker are exempt and required).
- [ ] Operator confirms attribution header is present on line 1.
- [ ] Approval recorded at `<job_dir>/license-review-approval.md` (timestamp + initials) BEFORE US-005.
- [ ] If operator rejects: loop back to US-002.
**Dependencies:** US-003
**Estimated complexity:** small

## US-005: Patch-surface entries (new §17 section + new §14 invariant row) + pre-commit-diff snapshot — NO `git add` yet
**Description:** As a fork maintainer, I want the upstream-canonical edit documented in `docs/implementation/patch-surface.md` per `codex/CLAUDE.md` line 21 — two distinct edits per the verified file structure — AND a baseline diff snapshot before smoke so iteration is clean if smoke fails.
**Acceptance Criteria:**
- [ ] (codex-worktree path) `docs/implementation/patch-surface.md` gains a **new top-level section** (likely §17 "Built-in agent role: `explorer` prompt") mirroring §13's format: brief description, file-role table, "Important invariants" bullet list, and per-section rebase guidance.
- [ ] Same file gains **one new row in §14's Invariant-to-test mapping table** — verified row number is **21** (existing rows go up to 20). Columns: description, Enforcement type `in-subtree-test`, Test path `core/src/agent/role_tests.rs::built_in_explorer_role_parses_and_has_non_blank_developer_instructions`, Deliberate-violation procedure.
- [ ] Entry formats mirror the verified file structure (implementer reads existing §13 and §14 entries first).
- [ ] **No `git add` yet** — staging is deferred until US-007 after smoke green.
- [ ] `git diff` of all three files (TOML, role_tests.rs, patch-surface.md) is captured to `<job_dir>/pre-commit-diff.patch`.
**Dependencies:** US-004
**Estimated complexity:** small

## US-006: Smoke `codex exec` parent → `spawn_agent agent_type=explorer` (worktree-built binary)
**Description:** As an implementer, I want a 1-minute smoke against a small target using a worktree-built `codex` binary (NOT the system PATH codex), to confirm the explorer role actually dispatches with the new TOML and produces sensible read-only output.
**Acceptance Criteria:**
- [ ] Smoke target chosen and recorded at the top of `<job_dir>/smoke-transcript.md`. Default candidates: `D:/harness-efforts/codexu/codex/scripts/` or `D:/harness-efforts/codexu/codex/docs/workflows/`. **`packages/codium/` is RESCINDED** (~1650 files).
- [ ] **Binary identity recorded** at the top of `<job_dir>/smoke-transcript.md`: absolute path of the binary used MUST resolve to a worktree-built `target/{debug,release}/codex-core(.exe)` (or, if launcher pattern is chosen, the worktree-built launcher `codex(.exe)` pinned to the worktree-built `codex-core(.exe)`). NOT a `$PATH`-resolved system codex. Build command: `cargo build -p codex-cli --bin codex-core` from `external/repos/codex-patched/codex-rs/` (note: package name is `codex-cli` but the binary target is `codex-core`, per `codex/CLAUDE.md` confusion-points).
- [ ] Worktree HEAD SHA captured: `git -C <codex-worktree> rev-parse HEAD` recorded alongside the binary path.
- [ ] `codex exec` invoked with a parent prompt that asks for an explorer spawn against the target. Plan does NOT use `--sandbox read-only`.
- [ ] **Pre-pass spawn-failure scan**: transcript checked for `unknown agent type`, `role not found`, `failed to load role layer`. If any appear: smoke is a **show-stopper failure**, not a pass.
- [ ] Full transcript captured at `<job_dir>/smoke-transcript.md`.
- [ ] Smoke pass: (a) **explorer output** (parent-agent stdout/stderr emitted after `spawn_agent` returns, up through session end) names ≥ 2 specific file paths from the target — counted only when paths are absolute or relative-to-target (e.g., `audit_invariants.sh` for `codex/scripts/audit_invariants.sh`).
- [ ] Smoke pass: (b) transcript shows zero write-class activity per BOTH (i) no occurrence of: `Write`, `Edit`, `MultiEdit`, `apply_patch`, `NotebookEdit`, `mkdir`, `rm`, `rmdir`, `touch`, `mv`, `cp`, `git add`, `git commit`, `git checkout`, `git reset`; (ii) no shell call with `>`, `>>`, heredoc `<<`, `python -c`, `python3 -c`, `powershell ... Set-Content`/`Out-File`/`Add-Content`, `node -e`, `sed -i`, `awk ... > ...`, or `tee`.
- [ ] If smoke fails: `git restore --staged .` (no-op if nothing staged), revise TOML, re-run from US-003.
**Dependencies:** US-005
**Estimated complexity:** small

## US-007: Stage + commit locally (after smoke green)
**Description:** As an implementer, I want a single local commit that bundles TOML + tests + patch-surface entries per fork discipline. **No push yet** — push is gated by US-008.
**Acceptance Criteria:**
- [ ] `git add` cargo-root paths `core/src/agent/builtins/explorer.toml`, `core/src/agent/role_tests.rs`, plus codex-worktree path `docs/implementation/patch-surface.md`.
- [ ] `git diff --cached` matches `<job_dir>/pre-commit-diff.patch` modulo any post-smoke TOML revisions.
- [ ] Local commit created with message: `feat(role): paraphrase Explore prompt into built-in explorer.toml + SANDBOX PATCH markers + patch-surface §17/§14 entries` (or operator-amended equivalent).
- [ ] `git log -1 --format=%H` captures the new commit SHA for use in US-008.
**Dependencies:** US-006
**Estimated complexity:** small

## US-008: Push-approval gate (operator) — sees the local commit
**Description:** As the operator, I want one final approval before any push to a shared remote. By this point the commit exists locally; operator inspects via `git show HEAD`.
**Acceptance Criteria:**
- [ ] Surfaced to operator: branch name, local commit SHA, full `git show HEAD` diff + message, smoke transcript path.
- [ ] Approval recorded at `<job_dir>/push-approval.md` (timestamp + initials).
- [ ] If rejected: hold; do NOT push. Operator may amend the commit locally and re-surface.
**Dependencies:** US-007
**Estimated complexity:** small

## US-009: Push to `gim-home/codex`
**Description:** As an implementer, I want the local commit published to `origin` so the superproject pointer can reference it.
**Acceptance Criteria:**
- [ ] `git push -u origin feat/explorer-role-prompt` succeeds.
- [ ] `git ls-remote https://github.com/gim-home/codex.git refs/heads/feat/explorer-role-prompt` returns a SHA matching local HEAD.
**Dependencies:** US-008
**Estimated complexity:** small

## US-010: Bump codexu submodule pointer + cleanup
**Description:** As a fork maintainer, I want codexu pointing at the new fork commit. **Per Codex review:** `git add codex` in the superproject records the SHA of the main `D:/harness-efforts/codexu/codex/` checkout — NOT the sibling worktree's HEAD. Must explicitly update the main submodule checkout first.
**Acceptance Criteria:**
- [ ] `git -C codex fetch origin feat/explorer-role-prompt` (pulls just-pushed branch into the main codex checkout's refs).
- [ ] `WORKTREE_SHA=$(git -C .ralph/jobs/port-explorer-prompt/codex-worktree rev-parse HEAD)` captured.
- [ ] `git -C codex checkout "$WORKTREE_SHA"` (detaches the main codex checkout at the new SHA).
- [ ] From codexu root: `git add codex && git commit -m "..."` records `WORKTREE_SHA` as the new submodule pointer in a dedicated commit on `main`.
- [ ] `git submodule status` shows the new SHA with no `+`/`-` divergence.
- [ ] `git show HEAD -- codex` records exactly the expected `Subproject commit ...` change to `WORKTREE_SHA`.
- [ ] `git -C codex worktree remove --force <job_dir>/codex-worktree` removes the worktree.
- [ ] Pre-flight stash ref reported in `<job_dir>/preflight-stash.md` final-state line (restore/discard pending operator decision).
**Dependencies:** US-009
**Estimated complexity:** small
