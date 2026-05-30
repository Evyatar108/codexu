# Plan — codex-upstream-rebase

**Task:** Periodic rebase of the codex/ submodule chain against `openai/codex` upstream.

**Bottom line up front:** *This is a 1-story "invoke the existing skill" task.* The wrapper repo already ships a 29 KB `/rebase-upstream <tag>` skill, a `scripts/check_submodule_lag.sh` for state assessment, a `scripts/setup-merge-drivers.sh` for merge-driver registration, a `scripts/audit_network_calls.sh` static gate, a `scripts/runtime_audit.ps1` runtime gate, a versioned patch-surface inventory (`docs/implementation/patch-surface.md` §14/§15/§16), and a `regression-history.md` ledger. The rebase plan IS the skill. **Recommendation: skip a separate `/implement-with-ralph` decomposition and instead spawn a single impl member whose entire job is "invoke `/rebase-upstream rust-v0.135.0` from inside the codex/ wrapper, walk the skill steps, ship the result."** The rest of this plan documents the operator-relevant context an impl member needs that the skill itself does NOT cover.

---

## 0. Important clarification on the task framing

The task description says:

> Target: D:/harness-efforts/codexu/codex (git submodule pointing at our fork of openai/codex)

That framing collapses what is actually a **two-layer submodule chain**:

| Layer | Path | Git URL | Role |
|---|---|---|---|
| Outer (codexu) | `codexu/codex` | `gim-home/codex` | The **wrapper** repo. Hosts overlay crates, launcher, publish pipeline, docs, scripts, skills. Pinned via codexu submodule gitlink. |
| Inner (codex wrapper) | `codex/external/repos/codex-patched` | `Evyatar108/codex-openai-fork` | The **patched upstream fork**. Branch `sandbox-patches`. This is the one that tracks `openai/codex`. |

`gim-home/codex` is NOT a fork of `openai/codex` — it's the wrapper repo. The relationship is documented in `codex/CLAUDE.md` ("Remotes (dual-fork pattern)") and `codex/docs/implementation/architecture.md` § "Fork strategy". Any operator/agent who reads the task literally as "rebase `codex/`" will look for an `openai/codex` remote on `gim-home/codex` and find nothing — confusion that has cost real session time before.

**Rebase target therefore = `codex/external/repos/codex-patched` → openai/codex upstream tag.**
Wrapper-side change = a single gitlink-bump commit on `codex/main` pointing at the new `sandbox-patches` tip.
codexu-side change = a single gitlink-bump commit on `codexu/main` pointing at the new `codex/main` tip.

## 1. Current state assessment

Captured `2026-05-30` from `bash scripts/check_submodule_lag.sh` (run from `codex/` wrapper root):

```
openai_codex_remote: https://github.com/openai/codex.git
codex_patched_remote: https://github.com/Evyatar108/codex-openai-fork.git
latest_stable_tag: rust-v0.135.0
pinned_gitlink_sha: a13689049991cb585698c515ca85d41ae44143ef
sandbox_patches_sha: a13689049991cb585698c515ca85d41ae44143ef
sandbox_patches_lag_commits: 0
latest_stable_tag_lag_commits: 588
```

Translation:

- **Wrapper gitlink == `sandbox-patches` HEAD** (0 commits drift). Clean starting point — no "did somebody bump sandbox without bumping the wrapper" reconciliation needed first.
- **`sandbox-patches` is 588 upstream commits behind `rust-v0.135.0`.** Last upstream merge (per `git log --merges`) is `5058f5aa1 "Merge upstream rust-v0.130.0"`. We're 5 stable-tag versions behind (0.131, 0.132, 0.133, 0.134, 0.135). Cadence per `regression-history.md` is ~1–2 weeks per merge; this catch-up rebase will land 5 versions in one squashed merge, which the skill's "squash-style merge into the fork rather than replaying every patch commit" workflow already explicitly handles.
- **`codex-patched` `feature/launcher-additional-instructions` is dirty.** A local checkout exists on that feature branch with 5 unpushed commits and an uncommitted `Cargo.lock` modification. The skill's recommended worktree-based rebase keeps that dirty state untouched, but the impl member MUST verify the rebase worktree was created from `origin/sandbox-patches` (not from local HEAD) — otherwise the squash-merge replays unrelated feature work and produces a bogus diff.
- **`codex/` wrapper** is currently checked out on `feature/sandbox-setup-release` (not `main`) with a modified-submodule indicator. The rebase skill's "create a temporary wrapper worktree from HEAD" step assumes the operator is on the intended wrapper branch — for this rebase, the impl member should start by checking out `codex/main` (or use `git worktree add ... main`) before invoking the skill so the rebase produces a commit on `main`, not on a stale feature branch.

## 2. Rebase strategy

**Decision: squash-style merge of `openai/codex` tag `rust-v0.135.0` onto `sandbox-patches`** — exactly the strategy the existing skill documents (workflow step 2, line ~44: `git merge --squash FETCH_HEAD`). Rationale:

- The fork's patches are pre-committed on `sandbox-patches`; they don't move during the rebase. Only upstream's 588 commits are squashed in.
- A non-squash merge would replay every upstream commit individually, creating 588-deep history with no per-commit value (none of them touch our patch surface in isolation; the fork's seam-level invariants are what matter).
- A *full rebase* (replaying our patches on top of upstream HEAD) was the v3-era pattern, abandoned because every upstream API churn forced us to re-resolve the same conflict per-commit. `regression-history.md` records the move to squash-merge as a deliberate cost reduction.

**Cherry-pick alternative:** rejected. Cherry-pick is the right pattern when our patches are an ordered topic series independent from upstream — but `sandbox-patches` has accumulated 4+ historical squash merges (`Merge upstream rust-v0.130.0`, `subtree: pull rust-v0.129.0`, `rust-v0.128.0`, `rust-v0.125.0`). Switching strategies mid-stream loses the merge ancestry that lets `git merge --squash` produce a tractable conflict set.

**Intermediate-tag approach:** rejected. Doing 5 sequential squash-merges (`rust-v0.131.0` → `rust-v0.132.0` → … → `rust-v0.135.0`) would multiply conflict-resolution effort 5× with no obvious payoff — the conflicts are mostly at the same seams regardless of how many upstream commits land between them. If the conflict set turns out to be unmanageably large mid-rebase, the impl member can pivot to intermediate tags as a fallback (a regression escape hatch worth naming in the impl PRD).

## 3. Conflict-likelihood survey

Cross-referencing the skill's "Current patch surface to watch during conflict resolution" list (rebase-upstream.md lines 80–118) against the kinds of churn that typically happen across 588 upstream commits and 5 stable releases:

**HIGH conflict probability** (expect mechanical-but-tedious resolution):

- `core/src/client.rs` — every upstream version touches the main agent loop; our Copilot auth-retry counter and `current_client_setup` hook live there. ~30 min budget.
- `model-provider/src/copilot.rs` + `copilot_models_endpoint.rs` (NEW FILES) — fork-exclusive, **no conflicts**, but adjacent `model-provider/src/provider.rs` (`create_model_provider` routing) and `lib.rs` (no `CoreAuthProvider` alias) need re-application of the same one-line edits if upstream refactored either. ~20 min.
- `core/src/config/mod.rs::~2457` `disable_paste_burst = unwrap_or(true)` — the skill's "Common mistakes" entry already calls out that upstream re-emits `unwrap_or(false)` and four `Config` test fixtures in `core/src/config/config_tests.rs` need to keep asserting `disable_paste_burst: true`. **Guaranteed conflict; mechanical fix.** ~10 min.
- `app-server-transport/src/transport/remote_control/mod.rs` — three-layer force-disable. Most fragile area: a previous rebase missed layer 2 (`RemoteControlHandle::set_enabled` ignoring its argument) and re-enabled the WS enrollment silently. Plus 10 upstream tests in `tests.rs` need their `#[ignore = "patched fork force-disables remote_control..."]` markers preserved. Any new upstream test in that file that assumes runtime remote_control behavior must be added to the ignore list. ~45 min, **review-fix risk: HIGH** — this is the recurring silent-drop hotspot.
- `app-server/src/request_processors/command_exec_processor.rs:208` (`ExecParams { ... }`) — if any new field was added to `ExecParams` in `core/src/exec.rs` across the 5 versions, the app-server initializer needs the matching field with a sensible default (`may_background: false, promotion_tx: None` per CLAUDE.md). Failure mode is a hard build error (E0063), not a silent regression. ~15 min.

**MEDIUM conflict probability:**

- `tui/src/style.rs::user_message_style_for` + `tui/src/chat_composer.rs` + `tui/src/history_cell.rs` — the user-message-background feature gated on `style_user_messages`. TUI is one of the most-churned upstream areas. ~30 min.
- `core/src/spawn.rs::spawn_child_async` + `core/src/windows_job.rs` — Windows Job Object confinement for tool-exec children. If upstream restructures `spawn_child_async`, the `CREATE_SUSPENDED` → assign → resume sequence and the post-exit watcher need re-planting. ~30 min.
- `core-plugins/src/loader.rs` — one-line call to `apply_plugin_root_substitution(...)` in `normalize_plugin_mcp_server_value`. Patch-surface §16 documents the replant recipe if upstream renamed/moved that function. ~10 min.
- `tui/src/bottom_pane/paste_burst.rs::on_plain_char` — adjacent area to the `disable_paste_burst` default. ~10 min if touched at all.
- `tui/src/tooltips.rs::blocking_init_announcement_tip` — the `None` patch that suppresses `raw.githubusercontent.com` fetch. Easy to miss if upstream renames the file. ~10 min.

**LOW conflict probability (fork-exclusive new files / overlay crates):**

- All `codex-rs-overlay/` paths — zero conflict surface by design.
- `core/src/copilot_transport.rs`, `core/src/compact_remote.rs`, `core/src/memory_trace.rs`, `core/src/thread_manager.rs` — fork-exclusive new files; conflict only if upstream coincidentally adds same-named files.
- `core-plugins/src/mcp_substitution.rs` — fork-exclusive new file.

**Edit-budget rough estimate:** ~3.5 h of focused conflict-resolution work + ~1.5 h of `cargo check --workspace` type-drift fixes (5 versions of upstream API churn typically surface 10–20 small signature mismatches in fork patches) + ~1 h for the audit + smoke gates. Total ~6 hours of impl-member work for a clean rebase. Double it (~12 h) if a layer-2 silent-drop type bug shows up.

## 4. Verification steps

The skill's workflow already enumerates these (steps 5, 9, 12). Stitching them into a checklist the impl member must run in order:

1. **Inside the rebase worktree** at `codex-patched/codex-rs/`:
   - `cargo metadata --no-deps --format-version 1` — workspace-parse preflight (per AGENTS.md). Non-zero = overlay coordination is broken; stop and fix Cargo.toml/lock issues before continuing.
   - `cargo check --workspace` — the standard typecheck gate (~6 min). Every diagnostic is a type-drift fix-up. Iterate until clean.
   - **Skip `cargo test --workspace`.** Per CLAUDE.md, that's a 90+ min CI-only run with known false positives on Windows. Run `cargo test -p <crate>` only for crates the impl member actually touched during conflict resolution.
2. **From wrapper root** after the gitlink bump:
   - `bash scripts/audit_network_calls.sh` — static patch audit (5 phases, ~2 min). Phase-5 known catch: `tui/src/tooltips.rs::blocking_init_announcement_tip` returning `None`. Any unfamiliar finding = silent drop.
   - The skill's "Silent-drop checklist" at `rebase-upstream.md` line 191 — REQUIRED. The skill notes the first audit alone is insufficient and missed Copilot-auth breaks in two consecutive rebases.
3. **Pre-tag runtime smoke** (skill step 12):
   - `target/release/codex.exe --version` — confirms binary refreshed (catches the "`cargo build -p codex-core` doesn't produce `codex-core.exe`" gotcha from CLAUDE.md).
   - One-shot prompt: `echo 'say hi in 3 words' | target/release/codex.exe exec` — exercises Copilot auth end-to-end. Auth failure blocks tagging.
   - `pwsh scripts/runtime_audit.ps1` — elevated PS only; ETW-based network egress check. Catches dynamic URLs / hardcoded IPs the static audit misses.
4. **Cargo release build** (`cargo build --release -p codex-cli --bin codex-core --bin codex`) is **deferred to CI**. Local fat-LTO link can exceed the 2 h tool ceiling. The `/publish-sandbox-patch` skill handles this on the CI worker.

## 5. Submodule-pointer bump + push fan-out

Three repos in the dependency chain, each needs its own gitlink commit + push to multiple remotes. **Order matters — bottom-up, never top-down.**

1. **codex-patched** (the actual upstream-tracking fork):
   - Squash-merge commit on `sandbox-patches` (skill step 6).
   - `git push origin HEAD:sandbox-patches --force-with-lease` — only `origin` exists on this submodule; no fan-out.
   - **Auth note:** the skill calls out `gh auth switch --user Evyatar108` before push and `gh auth switch --user evmitran_microsoft` after. The `codex-patched` remote is a personal-account fork; pushing as the work account 403s. Impl member MUST follow this.

2. **codex wrapper** (`gim-home/codex`):
   - Gitlink-bump commit on `codex/main` pointing at the new `sandbox-patches` tip. Wrapper-owned files in the same commit: any `patch-surface.md` §15 entries (new release-tag retention notes), any `regression-history.md` entries for newly-caught silent drops, any `.gitattributes` / `merge=theirs` rule additions if conflict resolution discovered a new always-take-theirs path.
   - Push fan-out per AGENTS.md "Always push main to ALL configured remotes": loop over `git remote` and push to each. For codex/ that's `origin` (gim-home), `codex-patched` (Evyatar108/codex-openai-fork — **do NOT push wrapper history here per CLAUDE.md "Remotes (dual-fork pattern)" — push to origin only**), `personal`, `work`. Practical loop: push only `origin` for the wrapper update.
   - Optional retention tag: `release/<wrapper-version>` immutable tag on the `codex-patched` remote at the new wrapper gitlink SHA (skill / CLAUDE.md "W-5 release retention" section).

3. **codexu** (this repo):
   - Gitlink-bump commit on `codexu/main` pointing at the new `codex/main` tip. Commit message format consistent with prior bumps (e.g., `chore(codex): bump submodule to <sha> (rebase upstream rust-v0.135.0)`).
   - Push fan-out: `origin` (evmitran_microsoft/codexu) AND `personal` (Evyatar108/codexu) per AGENTS.md.
   - Bookkeeper duty (lead, not impl member): flip `.ralph-overview/data.json` `lifecycle: "tracked"` → `"merged"` for this task, add `mergeCommit` SHA(s).

## 6. Rollback plan

The rebase produces three new commits across three repos. Rollback symmetry depends on what level the regression is found at.

**During the rebase, before any push** — easiest case:

- Drop the rebase worktree: `git worktree remove <REBASE_WORKTREE>` + `rm -rf $TMP_ROOT`. Nothing was pushed; nothing to revert.
- The skill already structures the work in a throwaway worktree precisely for this reason.

**Post-push, post-CI failure, pre-tag** — the most likely failure mode (CI/smoke gate catches something `cargo check` didn't):

- `codex-patched` rollback: `git push origin <previous-sandbox-patches-sha>:sandbox-patches --force-with-lease`. Force-with-lease is safe because the SHA we're overriding is the one our local just pushed.
- Wrapper rollback: revert the gitlink-bump commit on `codex/main` and push. Tags (if any retention tag was added) are immutable — leave them, future rebase will create a new one.
- codexu rollback: revert the codexu gitlink bump commit on `codexu/main` and push to both remotes.

**Post-tag, post-publish, regression-found-in-production** — worst case:

- The published npm tarball can't be un-published. The fix is forward, not backward: cut a new patch release (`/publish-sandbox-patch` with bumped suffix) reverting the gitlink chain to the prior wrapper SHA.
- Update `regression-history.md` with the failure mode so the next rebase has a guard.

**Saved escape hatches** built into the workflow:

- Original `sandbox-patches` SHA `a13689049991cb585698c515ca85d41ae44143ef` is captured in this plan (§1). If `--force-with-lease` is ever needed to reset, this is the target.
- Original wrapper-submodule pointer is in `codexu/main`'s tree object; `git show HEAD:.gitmodules` + `git ls-tree HEAD codex` recovers it.
- The skill's worktree-isolation pattern means the dev tree at `codex/external/repos/codex-patched` (on the dirty `feature/launcher-additional-instructions` branch with the 5 unpushed commits) is untouched throughout, so the operator's in-flight work is recoverable.

## 7. Recommendation to the operator

This is honestly a **1-story task**. The brainstorm/plan ceremony adds little because:

- The "plan" is the existing 29 KB `/rebase-upstream` skill — exhaustively detailed, including the LLVM/xwin env, the silent-drop checklist, the runtime-smoke recipe, and the auth-switch dance.
- The "decisions" the plan would normally surface (squash vs cherry-pick, intermediate tags vs jump-to-head, full-rebase vs merge-squash) are all already settled in the skill + `patch-surface.md` §15 policy.
- The conflict-likelihood survey in §3 above is the only piece of context that genuinely benefits from up-front thinking — and that's mainly because the impl member would otherwise spend ~1 h reading `patch-surface.md` themselves to derive the same list.

**Suggested next action:** spawn a single impl member with prompt:

> Invoke `/rebase-upstream rust-v0.135.0` from the codex/ wrapper. Walk the skill steps in order. Use the conflict-likelihood survey in `.ralph/jobs/codex-upstream-rebase/plan.md` §3 as a checklist for high-risk hotspots (`remote_control` three-layer, `disable_paste_burst` default, `ExecParams` field drift). Honor the silent-drop checklist gate; do NOT ship if any gate fails. Land the three gitlink-bump commits (codex-patched → codex wrapper → codexu) with the fan-out documented in plan §5. Stop with `kind=question` if any cargo-check diagnostic isn't a mechanical type-drift fix-up — those are the cases where the operator's review is the difference between "rebase done" and "rebase merged a silent regression."

If the impl member completes cleanly, the whole job is ~6 h of work + ~30 min of lead review. If conflict resolution surfaces something unexpected (e.g., upstream removed a seam the fork relies on, or `model-provider` got a structural refactor that obsoletes `CopilotModelProvider`'s shape), the impl member should `kind=question` early — those cases warrant a regression-prevention brainstorm, not heroics inside one impl loop.

## 8. Out of scope for this plan

- **Publishing the new release.** `/publish-sandbox-patch` is a separate skill with its own ceremony (version bump, build, tag, npm publish, GitHub release). The rebase plan stops at "gitlink bumps landed on codexu/main." Publish is the operator's call about when to ship a v0.135-based release — they may want to batch with other feature work.
- **Intermediate `rust-v0.131` / `0.132` / `0.133` / `0.134` rebases.** Recommendation §2 is to jump direct to `0.135.0`. If the operator prefers a staged approach, this plan should be re-spawned with different targets and the conflict-survey rerun per tag.
- **`feature/launcher-additional-instructions` reconciliation.** The dirty 5-commit-ahead state on the inner submodule is unrelated dev work; the rebase does not interact with it. The operator may want to push or rebase that branch separately, but that's not this task.
- **The wrapper's own `feature/sandbox-setup-release` branch.** Wrapper-side feature work in flight is not blocked by the rebase, but the rebase impl member should checkout `main` for the gitlink-bump commit — not pile onto the feature branch.

---

**Footnotes for the impl member:**

- The skill is at `codex/.claude/commands/rebase-upstream.md`. Read it end-to-end (~30 min) before starting; it has 7 sections of operational detail (Workflow, Build step, Manual publish notes, Audit gate, Silent-drop checklist, Pre-tag runtime smoke, Common mistakes) that this plan deliberately does not duplicate.
- The patch-surface inventory is at `codex/docs/implementation/patch-surface.md`. §14 = invariant ↔ enforcing-test mapping. §15 = release-tag retention + cadence policy. §16 = replant recipes for fork-exclusive call sites if upstream renames their target functions.
- The regression-history ledger is at `codex/docs/implementation/regression-history.md`. Check it for the last few rebases' failure modes before starting — those are the silent-drop traps most likely to repeat.
- The build environment requires LLVM clang-cl + lld-link + xwin SDK staged at `~/.xwin/{crt,sdk}` + `rusty_v8` prebuilt lib. Authoritative env var list lives in `publish-sandbox-patch.md`, mirrored in `rebase-upstream.md` § "Build step". If the impl member hits `/usr/bin/link: extra operand …`, that's Git Bash's coreutils `link` shadowing `lld-link`; fix is in the skill.
