# Notepad: port-explorer-prompt

## PERMANENT
- Plan converged across 6 plan-review rounds (Claude + Codex + Copilot, 16 findings resolved, 1 invalidated, 0 High remaining).
- License-paraphrase posture per plans/native-agent-parity.md §4 is GATING — operator must sign off at <job_dir>/license-review-approval.md before the submodule commit lands.
- Push to gim-home/codex is GATING — operator must sign off at <job_dir>/push-approval.md before US-009 runs.
- US-001 uses SHA-record-then-checkout (NOT git stash) for the pre-existing `M codex` pointer per Codex round-4 verification that `git stash push -- codex` does not stash unstaged submodule gitlinks.
- patch-surface.md edits: new top-level §17 section + new row 21 in §14 invariant-to-test mapping table (rows 1-20 already exist).
- Test assertion for `project_doc_fallback_filenames` MUST be raw `toml::Value` explicit-key check; both the `ConfigToml`-typed default-comparison AND seed-then-clear-via-apply_role_to_config alternatives are false positives.
- Build command in the codex worktree: `cargo build -p codex-cli --bin codex-core` (package name is `codex-cli`, binary target is `codex-core`). Smoke MUST use the worktree-built `target/{debug,release}/codex-core(.exe)`, never the $PATH-resolved system codex.
- Smoke target: `codex/scripts/` or `codex/docs/workflows/` (each ≤ ~30 files); `packages/codium/` is rescinded.
- Codexu working tree currently has unrelated dirty hunks in `packages/happy-app/sources/sync/*` and `plans/overview.html`; US-010 must use `git add codex` ONLY (not `git add -A`) to avoid sweeping unrelated changes into the pointer-bump commit.

## User Preferences

## Deferred Questions
| # | Question | Story ID | Iter Asked | Answer | Iter Answered | Auto-Resolved |
|---|----------|----------|------------|--------|---------------|---------------|

## Story Doctor Log

## Autonomous Decisions
2026-05-13T20:39:08Z — User invoked /implement-with-ralph without --autonomous flag, but options-mode auto reports user is not present. Best-judgment default: run Phases 0/2/2.5/2.7 (PRD setup) only, STOP before Phase 3 (ralph.sh iteration). User came back later and authorized autonomous run.

2026-05-13T21:30Z — User authorized autonomous run with two modifications: (1) drop US-008/US-009 push entirely (marked passes:true, skipped) — no push to gim-home/codex; (2) US-004 license review pre-approved subject to conditions (Claude-Explore-derived, no Claude Code/Anthropic brand strings in body, codex tool names or capabilities replace Claude tool names) — iteration agent self-verifies. Only US-010 remains as operator gate.

2026-05-13T~21:25-21:31Z — Ralph.sh completed iter 1 (US-001 PASS: pre-flight reconcile + codex submodule worktree at .ralph/jobs/port-explorer-prompt/codex-worktree/ on feat/explorer-role-prompt). Iter 2 (US-002 PASS: explorer.toml filled at codex worktree with 1538-char paraphrased body, no brand strings, no 6-word verbatim spans). Iter 2/3 errored on US-003 because cargo/rustc not on PATH on this machine. Ralph.sh killed by user.

2026-05-13T~21:35Z — User noted: working in primary codexu checkout was wrong; codexu work must happen in a worktree. Created codexu worktree at `D:/harness-efforts/codexu/.worktrees/port-explorer-prompt/` on branch `port-explorer-prompt-pointer-bump`. Primary checkout (`D:/harness-efforts/codexu`) detached at 47de9b32 to free the branch. `codex/` submodule inside the codexu worktree is NOT initialized (no objects pulled) — the actual code work continues at `.ralph/jobs/port-explorer-prompt/codex-worktree/` (independent codex submodule worktree, preserved across this superproject change). For US-010 (pointer bump), the operator can either `git -C codex submodule update --init codex` first or use `git update-index --cacheinfo 160000 <topic-SHA> codex` to record the pointer without populating.

## Repository Layout (updated 2026-05-13T~21:35Z)
- Primary codexu checkout: `D:/harness-efforts/codexu` — detached at 47de9b32; no active work here. (User's `.worktrees/main-merge/` is their canonical `main` worktree.)
- **Codexu worktree (work-dir for US-005, US-007, US-010)**: `D:/harness-efforts/codexu/.worktrees/port-explorer-prompt/` on branch `port-explorer-prompt-pointer-bump`. The codexu-side pointer-bump commit (US-010) lands here.
- **Codex submodule worktree (work-dir for US-002, US-003, US-005-patch-surface)**: `D:/harness-efforts/codexu/.ralph/jobs/port-explorer-prompt/codex-worktree/` on branch `feat/explorer-role-prompt` of the codex submodule. Already has uncommitted explorer.toml + role_tests.rs from US-002. Independent git working tree — preserved regardless of codexu superproject branch state.
- Job metadata (THIS notepad, prd.json, plan.md, etc.): `D:/harness-efforts/codexu/.ralph/jobs/port-explorer-prompt/` — gitignored, not branch-specific.
- US-005 patch-surface.md edit: `<codex-worktree>/docs/implementation/patch-surface.md`. NOT in the codexu worktree's `codex/` (which is uninitialized); use the dedicated codex submodule worktree.
- **Local cargo intentionally unavailable per fork convention.** Codex builds require an LLVM clang-cl + lld-link + xwin + V8 env (per `codex/.claude/commands/publish-sandbox-patch.md` and `codex/.claude/commands/rebase-upstream.md`). Building locally is the publish path's job; daily iteration does NOT use cargo. **Validation strategy for THIS job**: (a) TOML syntax check via `python -c "import tomllib; tomllib.loads(open(p, 'rb').read())"` if needed; (b) Rust compile/test validation deferred to CI (`.github/workflows/invariant-check.yml`) on push; (c) end-to-end smoke deferred to post-publish via `codex/.claude/commands/publish-sandbox-patch.md` → `codex/.claude/commands/verify.md`. **US-003 dropped cargo runs; US-006 marked `blocked: true` (post-publish operator workflow).**

## Working Notes
- Phase 2 PRD subagent decisions logged in PRD's `metadata.autonomousDecisions` array.
- 10 stories total. Status snapshot (2026-05-13T~21:35Z):
  - US-001 PASS, US-002 PASS (codex worktree dirty with explorer.toml + role_tests.rs, uncommitted)
  - US-008 PASS (skipped — no push), US-009 PASS (skipped — no push)
  - US-003 PENDING (blocked on cargo PATH fix)
  - US-004, US-005, US-006, US-007 PENDING (downstream of US-003)
  - US-010 BLOCKED (operator gate — codexu main merge)
