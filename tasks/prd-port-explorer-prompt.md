# PRD: Port Explore Prompt into Codex Built-in `explorer.toml`

*Generated 2026-05-13 in autonomous mode from `D:/harness-efforts/codexu/.ralph/jobs/port-explorer-prompt/plan.md` + `stories-outline.md`.*

## Introduction

Fill the empty `core/src/agent/builtins/explorer.toml` stub (currently 0 bytes) inside the codex submodule with a paraphrased Explore-prompt body so the built-in `explorer` role finally has a functioning prompt. The `role.rs` wiring (registry entry + `include_str!` arm) is already in place; this PR is the smallest possible delta from `plans/native-agent-parity.md §2.1`: one TOML file, one updated test + one new invariant test, plus a mandatory same-commit entry in `codex/docs/implementation/patch-surface.md` (new §17 section + new row in §14 invariant-to-test table).

The work is license-sensitive (prose is paraphrased from Claude Code's `exploreAgent.ts`, a reverse-engineered reconstruction). Two operator-gated approvals therefore bracket the implementation: license-paraphrase review before any commit, and push approval before pushing to the shared `gim-home/codex` fork remote. After approvals, the topic branch `feat/explorer-role-prompt` is pushed and a separate codexu `main` commit bumps the submodule pointer.

## Goals

- Fill `explorer.toml` with a paraphrased Explore prompt (≥ 200 chars `developer_instructions`), `model_reasoning_effort = "low"`, and `project_doc_fallback_filenames = []`.
- Update + extend `core/src/agent/role_tests.rs` so the built-in TOML parse + invariants are guarded.
- Add same-commit fork-discipline entries to `docs/implementation/patch-surface.md` (new §17 + row in §14 table).
- Smoke-validate via parent-`codex exec` + `spawn_agent` against a small target using a worktree-built `codex-core(.exe)`.
- Gate the license-paraphrase review and the push behind explicit operator approval artifacts.
- Bump codexu's submodule pointer in a dedicated commit on `main` after the fork push lands.

## User Stories

### US-001: Pre-flight reconcile + create codex submodule worktree
**Description:** As the implementer, I want to isolate the existing unstaged `M codex` gitlink change (without losing it) and create a clean topic-branch worktree of the codex submodule, so my pointer-bump commit doesn't accidentally sweep up unrelated state.

**Acceptance Criteria:**
- [ ] If `git status` in codexu root shows `modified: codex`, record both `PREFLIGHT_CODEX_SHA=$(git -C codex rev-parse HEAD)` and `SUPERPROJECT_RECORDED_SHA=$(git rev-parse HEAD:codex)` into `<job_dir>/preflight-stash.md` (JSON-in-md) BEFORE any state change.
- [ ] `git -C codex status --porcelain` returns empty (sanity-check inner working tree clean) — otherwise abort with an error message; do NOT proceed.
- [ ] `git -C codex checkout "$SUPERPROJECT_RECORDED_SHA"` reconciles the main codex submodule checkout back to the superproject's recorded pointer; afterwards `git status` in codexu root no longer shows `modified: codex`.
- [ ] `git stash` is NOT used (Codex round-4 verified it does not reliably stash an unstaged submodule gitlink).
- [ ] Unrelated working-tree state (`.worktrees/`, `tasks/`, `packages/happy-app/`, etc.) is untouched.
- [ ] `git -C codex fetch origin main` succeeds.
- [ ] `git -C codex worktree add -b feat/explorer-role-prompt D:/harness-efforts/codexu/.ralph/jobs/port-explorer-prompt/codex-worktree origin/main` succeeds; the worktree directory exists.
- [ ] Worktree HEAD is on branch `feat/explorer-role-prompt`, based on `origin/main` of `gim-home/codex`.

### US-002: Paraphrase + save `explorer.toml`
**Description:** As the codex agent author, I want a paraphrased Explore prompt embedded in `core/src/agent/builtins/explorer.toml` with required fork-discipline markers, so the built-in `explorer` role has a compliant body.

**Acceptance Criteria:**
- [ ] Cargo-root path `core/src/agent/builtins/explorer.toml` (inside the worktree) line 1 is a comment header identifying inspiration (Claude Code's Explore subagent) and noting that prose is paraphrased.
- [ ] Line 2 is a `# SANDBOX PATCH:` marker (per `codex/CLAUDE.md` line 21).
- [ ] File contains `model_reasoning_effort = "low"`, `developer_instructions = """..."""` (trimmed body length ≥ 200 chars), and `project_doc_fallback_filenames = []`.
- [ ] In the `developer_instructions` body only (NOT in the comment header, NOT in the SANDBOX PATCH marker line), there is no occurrence of `Claude Code`, `Anthropic`, or `Anthropic's CLI`.
- [ ] No verbatim span of more than 5 consecutive words from `D:/harness-efforts/claude-code/worktrees/main/src/tools/AgentTool/built-in/exploreAgent.ts:24-56` appears in the body (operator confirms in US-004).
- [ ] File does NOT contain `sandbox_mode = "read-only"` (explicitly out of scope this PR).

### US-003: Update + add tests; cargo check, cargo test, just fmt
**Description:** As the implementer, I want `role_tests.rs` updated to reflect new TOML behavior and extended with a parse + invariants test, all with SANDBOX PATCH markers, and the codex-core crate green locally.

**Acceptance Criteria:**
- [ ] Cargo-root path `core/src/agent/role_tests.rs`: existing test at lines 92-105 renamed to `apply_explorer_role_preserves_current_model_and_sets_reasoning_effort_low` and updated to assert (a) caller's `model` is preserved and (b) `model_reasoning_effort` is set to `Low` by the role layer. Setup seeds caller's model via CLI overrides or config.toml (mirror `apply_role_preserves_unspecified_keys`), NOT by post-stack mutation of `config.model`.
- [ ] New test `built_in_explorer_role_parses_and_has_non_blank_developer_instructions` asserts ALL of: (a) `config_file_contents(Path::new("explorer.toml"))` returns `Some`; (b) parses via `toml::from_str::<ConfigToml>` to `Ok`; (c) parsed `developer_instructions` is `Some` with trimmed length ≥ 200; (d) raw-TOML-form clearing check: parse via `toml::from_str::<toml::Value>` and assert the top-level table has an EXPLICIT `project_doc_fallback_filenames` key whose value is an empty array. Do NOT use a `ConfigToml` default check or a seed-then-apply alternative — Codex round-4 verified both are false positives.
- [ ] A test (this one or a sibling) uses the existing helper `session_flags_layer_count(&config)` at `role_tests.rs:586-614` to assert that applying the explorer role adds exactly one session-flags layer (count_after - count_before == 1).
- [ ] Each updated or new test `fn` line carries a `// SANDBOX PATCH:` marker.
- [ ] `cargo check -p codex-core` succeeds when run from `external/repos/codex-patched/codex-rs/` inside the codex worktree.
- [ ] `cargo test -p codex-core explorer` passes (all updated + new tests).
- [ ] `just fmt` run from `external/repos/codex-patched/codex-rs/` leaves no formatting drift; `git status` shows no fmt-only changes.

### US-004: License paraphrase review (OPERATOR GATE)
**Description:** As the operator, I want to verify side-by-side that the paraphrased prose satisfies `plans/native-agent-parity.md §4` before any commit lands.

**Acceptance Criteria:**
- [ ] Side-by-side diff surfaced: paraphrased `developer_instructions` body vs `exploreAgent.ts:24-56`.
- [ ] Operator confirms no verbatim spans > 5 consecutive words in body.
- [ ] Operator confirms no `Claude Code`, `Anthropic`, or `Anthropic's CLI` in body (header + SANDBOX PATCH marker are exempt and required).
- [ ] Operator confirms attribution header is present on line 1.
- [ ] Approval recorded at `<job_dir>/license-review-approval.md` (timestamp + initials) BEFORE US-005 proceeds.
- [ ] If operator rejects: loop back to US-002.

### US-005: Patch-surface entries + pre-commit-diff snapshot (NO `git add` yet)
**Description:** As a fork maintainer, I want the upstream-canonical edit documented in `docs/implementation/patch-surface.md` per `codex/CLAUDE.md` line 21 (new §17 section + new row in §14 invariant-to-test table) AND a baseline diff snapshot captured before smoke so iteration is clean if smoke fails.

**Acceptance Criteria:**
- [ ] Codex-worktree-relative path `docs/implementation/patch-surface.md` gains a NEW top-level section (likely §17 "Built-in agent role: `explorer` prompt") mirroring §13's format: brief description, file-role table (listing `core/src/agent/builtins/explorer.toml`, `core/src/agent/role_tests.rs`, and the role.rs seams as read-only references), Important-invariants bullet list (TOML parses; `developer_instructions` non-blank length ≥ 200; `project_doc_fallback_filenames == Some(vec![])`; SANDBOX PATCH markers preserved), and per-section rebase guidance.
- [ ] Same file gains ONE new row in §14's Invariant-to-test mapping table (verified row number 21: §14 currently has rows 1-20). Columns: description ("Built-in `explorer.toml` parses and supplies non-blank `developer_instructions` with explicit empty `project_doc_fallback_filenames`"), Enforcement type `in-subtree-test`, Test path `core/src/agent/role_tests.rs::built_in_explorer_role_parses_and_has_non_blank_developer_instructions` via `cargo test -p codex-core built_in_explorer_role_parses`, Deliberate-violation procedure.
- [ ] Entry formats mirror the verified existing §13 and §14 entries (implementer reads existing entries first).
- [ ] No `git add` yet — staging is deferred until US-007 (after smoke green).
- [ ] `git diff` of all three files (`explorer.toml`, `role_tests.rs`, `patch-surface.md`) is captured to `<job_dir>/pre-commit-diff.patch`.

### US-006: Smoke via worktree-built `codex-core`
**Description:** As the implementer, I want a one-minute smoke that exercises the new built-in TOML via a worktree-built `codex-core(.exe)` (NOT the system PATH codex), to confirm the explorer role dispatches and produces sensible read-only output.

**Acceptance Criteria:**
- [ ] Smoke target chosen and recorded at the top of `<job_dir>/smoke-transcript.md`. Default candidates: `D:/harness-efforts/codexu/codex/scripts/` or `D:/harness-efforts/codexu/codex/docs/workflows/` (both ≤ ~30 files). `packages/codium/` is RESCINDED (~1650 files).
- [ ] `cargo build -p codex-cli --bin codex-core` run from `external/repos/codex-patched/codex-rs/` inside the worktree produces `target/debug/codex-core.exe` (or `.so`/no-extension equivalent). NOTE: package name is `codex-cli` but binary target is `codex-core`.
- [ ] Binary identity recorded at the top of `<job_dir>/smoke-transcript.md`: absolute path of the binary used MUST resolve to a worktree-built `target/{debug,release}/codex-core(.exe)` (or worktree-built launcher pinned to that codex-core). NOT a `$PATH`-resolved system codex.
- [ ] Worktree HEAD SHA captured alongside the binary path: `git -C <codex-worktree> rev-parse HEAD` recorded in `<job_dir>/smoke-transcript.md`.
- [ ] `codex exec` (or `codex-core.exe exec`) invoked with a parent prompt asking for an `spawn_agent agent_type=explorer` against the chosen target. Plan does NOT pass `--sandbox read-only`.
- [ ] Pre-pass spawn-failure scan: transcript checked for `unknown agent type`, `role not found`, `failed to load role layer`. If any appear, smoke is a SHOW-STOPPER failure, not a pass-by-no-evidence.
- [ ] Full transcript captured at `<job_dir>/smoke-transcript.md`.
- [ ] Smoke pass criterion (a): explorer output (parent-agent stdout/stderr emitted after `spawn_agent` returns, through session end) names ≥ 2 specific file paths from the target — absolute paths inside the target, or paths relative to the target dir (e.g., `audit_invariants.sh` for `codex/scripts/audit_invariants.sh`). Generic strings like "the script" do NOT count.
- [ ] Smoke pass criterion (b): structured tool-call entries in the transcript show zero write-class activity. Two-pass scan: (i) no tool-call entry uses tool name `Write`, `Edit`, `MultiEdit`, `apply_patch`, or `NotebookEdit`; (ii) no shell/bash tool-call entry's `command` argument contains `>`, `>>`, heredoc `<<`, `mkdir`, `rm`, `rmdir`, `touch`, `mv`, `cp`, `git add`, `git commit`, `git checkout`, `git reset`, `python -c`, `python3 -c`, `powershell ... Set-Content`/`Out-File`/`Add-Content`, `node -e`, `sed -i`, `awk ... > ...`, or `tee`. Scan structured tool-call entries only (not free prose), to avoid false positives on the model casually mentioning words like `Write`.
- [ ] If smoke fails: run `git restore --staged .` (no-op if nothing staged), revise the TOML, re-run from US-003.

### US-007: Stage + local commit (after smoke green)
**Description:** As the implementer, I want a single local commit that bundles TOML + tests + patch-surface entries per fork discipline. No push yet — push is gated by US-008.

**Acceptance Criteria:**
- [ ] `git add` of cargo-root paths `core/src/agent/builtins/explorer.toml` + `core/src/agent/role_tests.rs`, plus codex-worktree path `docs/implementation/patch-surface.md`.
- [ ] `git diff --cached` matches `<job_dir>/pre-commit-diff.patch` modulo any post-smoke TOML revisions.
- [ ] Local commit created with first-line message: `feat(role): paraphrase Explore prompt into built-in explorer.toml + SANDBOX PATCH markers + patch-surface §17/§14 entries` (operator may amend equivalently).
- [ ] `git log -1 --format=%H` SHA captured for use in US-008 / US-010.

### US-008: Push-approval gate (OPERATOR GATE)
**Description:** As the operator, I want one final approval before any push to a shared remote (`gim-home/codex`). By this point the commit exists locally and is inspectable.

**Acceptance Criteria:**
- [ ] Surfaced to operator: branch name `feat/explorer-role-prompt`, local commit SHA, full `git show HEAD` diff + message, smoke transcript path.
- [ ] Approval recorded at `<job_dir>/push-approval.md` (timestamp + initials).
- [ ] If rejected: do NOT push. Operator may amend the commit locally and re-surface.

### US-009: Push to `gim-home/codex`
**Description:** As the operator, I want the local commit published to `origin` of the codex submodule (= `gim-home/codex`) so the codexu submodule pointer can reference it.

**Acceptance Criteria:**
- [ ] `git push -u origin feat/explorer-role-prompt` (run from the codex worktree root) succeeds.
- [ ] `git ls-remote https://github.com/gim-home/codex.git refs/heads/feat/explorer-role-prompt` returns a SHA equal to local `HEAD` of the worktree.

### US-010: Bump codexu submodule pointer + cleanup
**Description:** As a fork maintainer, I want codexu's `main` to point at the new fork commit in a dedicated commit. Per Codex review, `git add codex` in the superproject records the SHA at `D:/harness-efforts/codexu/codex/` (the main checkout), NOT the worktree HEAD — so the main checkout must be advanced first.

**Acceptance Criteria:**
- [ ] `git -C codex fetch origin feat/explorer-role-prompt` pulls the just-pushed branch into the main codex submodule checkout's refs.
- [ ] `WORKTREE_SHA=$(git -C .ralph/jobs/port-explorer-prompt/codex-worktree rev-parse HEAD)` captured.
- [ ] `git -C codex checkout "$WORKTREE_SHA"` detaches the main codex submodule checkout at the new SHA.
- [ ] From codexu superproject root: `git add codex && git commit -m "..."` records `WORKTREE_SHA` as the new submodule pointer in a dedicated commit on `main`. Commit first-line message: something like `chore(codex): bump submodule pointer to feat/explorer-role-prompt`.
- [ ] `git submodule status` shows the new SHA with no `+` or `-` divergence.
- [ ] `git show HEAD -- codex` records exactly the expected `Subproject commit <WORKTREE_SHA>` change.
- [ ] `git -C codex worktree remove --force D:/harness-efforts/codexu/.ralph/jobs/port-explorer-prompt/codex-worktree` removes the worktree.
- [ ] Pre-flight SHA capture in `<job_dir>/preflight-stash.md` gets a final-state line noting whether the operator restored or discarded `PREFLIGHT_CODEX_SHA`.

## Functional Requirements

- FR-1: The `core/src/agent/builtins/explorer.toml` file must be a valid TOML document with line 1 = comment header (provenance/inspiration), line 2 = `# SANDBOX PATCH:` marker, and contain `model_reasoning_effort = "low"`, `developer_instructions = """..."""`, and `project_doc_fallback_filenames = []`.
- FR-2: The `developer_instructions` body must be ≥ 200 chars trimmed and contain no `Claude Code` / `Anthropic` / `Anthropic's CLI` strings.
- FR-3: A new test in `core/src/agent/role_tests.rs` must (a) resolve the embedded `explorer.toml` via `config_file_contents`, (b) parse it through `toml::from_str::<ConfigToml>`, (c) assert `developer_instructions` non-blank ≥ 200 chars, (d) assert the raw `toml::Value` table has an explicit `project_doc_fallback_filenames` key with an empty-array value.
- FR-4: The existing `apply_empty_explorer_role_*` test must be renamed and rewritten to assert model preservation + reasoning-effort change to `Low`, with caller's model seeded via CLI overrides / config.toml (not post-stack mutation).
- FR-5: A test must assert that applying the explorer role adds exactly one session-flags layer (uses `session_flags_layer_count` helper).
- FR-6: `docs/implementation/patch-surface.md` must gain a new top-level section (§17) AND a new row in §14's invariant table, in the SAME commit as the TOML and test edits.
- FR-7: Smoke must use a worktree-built `codex-core(.exe)` binary; the system PATH `codex` is forbidden.
- FR-8: License-paraphrase approval (US-004) MUST land before any commit; push approval (US-008) MUST land before any push to `gim-home/codex`.
- FR-9: The codexu submodule pointer bump is a separate commit on `main` AFTER the fork push lands, and must record the worktree HEAD SHA — which requires checking out that SHA in the main `codex/` submodule checkout first.

## Non-Goals

- No change to `core/src/agent/role.rs` (already wired).
- No change to `happy-cli` or `happy-app`.
- No porting of other built-in roles (`plan`, `verification`, etc.) — separate plan slot.
- No new `omitClaudeMd` core plumbing beyond the chosen `project_doc_fallback_filenames = []` analog.
- NOT setting `sandbox_mode = "read-only"` in this PR — deferred to a follow-up due to `codex exec --sandbox read-only` silent-failure mode.
- NOT un-ignoring the `gpt-5.4-mini`-hardcoded test at `role_tests.rs:78-89`.

## Technical Considerations

- All cargo / `just fmt` commands run from `external/repos/codex-patched/codex-rs/` inside the codex submodule worktree (the "cargo root").
- Three path views appear in this PRD (per plan): cargo-root view (`core/...`), codex-worktree view (`docs/...`), codexu-superproject view (`codex/...`).
- Built-in role TOMLs are loaded as a plain `ConfigToml` layer (`toml::from_str` + `deserialize_config_toml_with_base`), NOT through the user-role parse path. `parse_agent_role_file_contents()` validation is NOT applied to built-ins. The new test IS the only guard.
- `include_str!` is NOT compile-time TOML validation — it only embeds bytes. The new test must parse at runtime.
- `codex exec --sandbox read-only` is documented as silently failing for read+tool flows; smoke uses a parent agent calling `spawn_agent` WITHOUT `--sandbox read-only`.
- The user-facing `codex` binary on PATH is the launcher in `codex-rs-overlay/codex-copilot-launcher/`, which shells out to `codex-core(.exe)`. Smoke either invokes worktree-built `codex-core.exe` directly OR builds the full launcher stack pinned at the worktree's `codex-core`.
- Codex's config-merge layer replaces arrays, so `project_doc_fallback_filenames = []` overrides at the role layer. But `core/src/agents_md.rs` always checks `AGENTS.md` first regardless of fallback list — `omitClaudeMd` analog suppresses CLAUDE.md-style fallbacks only.

## Operator Gates Summary

Two operator-gated stories require human intervention and cannot be auto-passed by an iteration agent:
- **US-004** (license-paraphrase review) — artifact: `<job_dir>/license-review-approval.md`.
- **US-008** (push approval) — artifact: `<job_dir>/push-approval.md`.

Two additional stories touch shared / superproject state and should be operator-driven post-approval:
- **US-009** (push to `gim-home/codex` shared remote).
- **US-010** (codexu submodule pointer bump on `main`).

## Success Metrics

- `cargo test -p codex-core explorer` passes locally inside the codex worktree (US-003).
- Smoke transcript shows ≥ 2 specific file paths from the smoke target and zero write-class tool calls (US-006).
- `feat/explorer-role-prompt` branch published on `gim-home/codex` and reachable via `git ls-remote` (US-009).
- `git submodule status` in codexu reports the new SHA with no `+`/`-` divergence (US-010).

## Open Questions

Inherited as provisional defaults from the plan; to be confirmed by operator during US-004:
1. Topic branch name `feat/explorer-role-prompt` — acceptable?
2. Defer `sandbox_mode = "read-only"` to a follow-up — confirm or override.
3. `project_doc_fallback_filenames = []` does not suppress `AGENTS.md` — accept as documented limitation, or schedule a separate core feature?
4. Rename existing test vs replacing it outright — plan default: rename.
5. Smoke target directory — plan default candidates: `codex/scripts/` or `codex/docs/workflows/`.
