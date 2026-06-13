# Bookkeeper-Lead Handoff — 2026-06-12 end-of-session → fresh session

> Fresh bookkeeper: read in this order — (1) `AGENTS.md`, especially the
> **"Bookkeeper operating invariants"** section (lead-orchestrates-members-do-
> the-work, branch/worktree discipline, data.json edit-anchor safety,
> continuous-flow pipeline, spawn-prompt invariants); (2) the session
> `plan.md` (final-state summary); (3) this doc. You are the
> `overview-bookkeeper` lead of crew `ralph-pipeline`, running under Copilot CLI.

---

## 0. THE HEADLINE: codex `.6` resume-regression fix is committed, NOT yet released

The operator hit a **resume history-paint regression** on the released `.5`
("very slowly prints the messages from history"). It is **root-caused and
fixed** on the `.6` accumulation branch, but **`.6` is not cut yet** — the fix
is one commit on `ralph/codex-v6-int`, the codexu submodule pointer still points
at the `.5` release. **Getting `.6` out is the top priority** because the fix is
default-off (it restores the operator's old fast resume immediately on install).

- **Inner branch:** `ralph/codex-v6-int` @ **`6f0137db`** `fix(tui): restore
  fast resume history paint` (in `codex/external/repos/codex-patched`, off the
  `.5` tip `a2bafe72` / tag `release/0.135.0-copilot-api.5`).
- **The fix:** new **default-OFF** experimental Feature `retained_transcript_viewport`.
  Default-off restores native terminal-scrollback (fast + scroll-up) AND emits a
  finalized cell once (kills the `.4` multi-reprint). Feature-on suppresses
  per-cell frames + one frame at replay end (kills the `.5` slow trickle).
  Follows the **fork convention**: fork-divergent behavior gates via codex
  experimental-features, default off — NOT ad-hoc config bools.

---

## 1. Where we are

**Clean exit.** Pipeline STOPPED. Roster = lead only (`impl-resume-fix-codex`
was hard-stopped after its commit landed). Everything synced:
- codexu `main` = **`e3758811`** (local = `origin` = `personal`, all three equal)
- toolkit `main` = **`b576f183`** (in `ai-developer-toolkit/`)
- codex inner checkout = branch **`ralph/codex-v6-int`** @ **`6f0137db`** (the
  `.6` resume fix). **Inner working tree is clean except `?? .worktrees/`**
  (gitignored member worktrees) — EOL-noise was reverted at end of session.
- data.json: **271 tasks** (75 tracked / 181 merged / 15 archived), 0 orphan, 0 dup.

**Active plugin versions** (codexu AGENTS.md version table = CI source of truth):
`crews 3.21.6`, `ralph (ralph-orchestration) 5.58.0`, `ralph-overview 2.10.0`.

---

## 2. Shipped / done this session (all merged + bookkept + pushed)

| Work | Result |
|---|---|
| **codex `0.135.0-copilot-api.5`** released | inner `a2bafe72` (tag `release/…api.5`), wrapper `ebd6e0ba` (gim-home tag `v0.135.0-copilot-api.5`), GitHub Release + bundle, codexu pointer `b399ed5f`. 4 tasks flipped merged (agent-name cells, /resume DB-only, resize retained-viewport, focus-leak-recur). |
| **resume slow-paint fix** | ✅ impl on `ralph/codex-v6-int` (`6f0137db`); carded; card commit `e3758811`. **`.6` not yet cut.** |
| `codex-patch-surface-divergence-registry-refresh` plan | ✅ shipped (4 stories, plan `90c6bb5e`) + carded `72b70c8c` + impl-seeded |
| `codex-fork-flags-to-experimental-features-migration` plan | ✅ shipped (4 stories, plan `f571e62f`, **anthropic-persists bug covered**) + carded `91575ab2` + impl-seeded |
| `codex-bg-wake-payload-overflow-spill-to-file` plan | ✅ shipped (3 stories, plan `52428190`) + carded `366761d0` + impl-seeded |
| `codex-paste-guard-perf-and-dropped-text` investigation | ✅ done (bracketed-paste-authoritative small fix ready) + carded |
| `crews-pretooluse-hook-errored-under-concurrent-spawn-burst` investigation | ✅ done (runtime saturation confirmed) + carded + filed |

---

## 3. The `.6` release queue — 5 impl-ready codex tasks, ALL serialize

The resume fix is already on `v6-int`. The other four impl-ready codex tasks
**all edit `codex/external/repos/codex-patched`** and therefore **MUST run one
at a time** onto `ralph/codex-v6-int` (canonical-checkout serialization holds
even with the relaxed concurrency cap):

1. ✅ `codex-resume-slow-history-paint-regression-from-resize-fix` — DONE (`6f0137db`)
2. `codex-fork-flags-to-experimental-features-migration` — **recommended next**;
   fixes the `codex-anthropic-model-persists-without-enable-flag` bug AND
   establishes the Feature-migration pattern for the other fork flags
   (`enable_anthropic`, `disable_paste_burst`, `style_user_messages`,
   `auto_load_claude_md`). Plan `f571e62f`.
3. `codex-paste-guard-perf-and-dropped-text` — the operator's other reported
   pain (paste lag / dropped text); small fix, investigation done.
4. `codex-bg-wake-payload-overflow-spill-to-file` — plan `52428190`.
5. `codex-patch-surface-divergence-registry-refresh` — **doc-only / no-build**,
   rebase-safety; safe to interleave (doesn't touch Rust build) but still edits
   the canonical checkout's `patch-surface.md` so coordinate the file.

**The open decision** (operator skipped it at session end — re-ask first thing):
- **(a)** cut `.6` NOW with just the resume fix → gets the operator's fix to
  their machine fastest, or
- **(b)** chain one or more of #2–#5 onto `v6-int` first → batch more into `.6`.

Use the `ask_user` tool (operator preference: never free-text questions).

**To cut `.6`** (when decided): drive `/publish-sandbox-patch` from the codex
submodule (impl-with-ralph-driveable — it handles commit+tag+push). Bump
`Cargo.toml` to `0.135.0-copilot-api.6`, release build via
`files/codex-cargo-release.sh`, tag inner `release/0.135.0-copilot-api.6`,
wrapper gitlink + tag `v0.135.0-copilot-api.6` on gim-home, GitHub Release +
bundle, then codexu pointer bump. Flip all `.6` tasks → `merged` with
shipManifest. Mirror the `.5` ceremony recorded in checkpoint 007/004.

---

## 4. Held / blocked / in-flight (NOT in the .6 queue)

- `crews-mail-delivery-via-codex-injection` — **HELD** on operator's dual-repo
  decisions. Prerequisite: codex experimental feature **`Feature::McpServerNotifications`**
  ("MCP server notifications") — necessary but **NOT sufficient** and **do not
  enable yet**: raw codex still drops the event at
  `turn.rs::realtime_text_for_event()` and crews has no producer. The operator
  asked whether to enable that codex experimental toggle — answer was **no, not
  needed for current work**.

---

## 5. Standing reminders / discipline (the ones that bit us this session)

- **Stagger spawns.** The "Denied by preToolUse hook (hook errored)" failure is
  crews hook-saturation under a SessionStart/arming spawn-burst (Copilot's 30s
  hook window starved when ~36 node procs spin up at once). Don't fan out
  spawns simultaneously — stagger them. Filed as
  `crews-pretooluse-hook-errored-under-concurrent-spawn-burst`.
- **Canonical-checkout serialization.** Every remaining codex impl edits
  `codex/external/repos/codex-patched`; run ONE at a time on `ralph/codex-v6-int`.
- **EOL-noise pattern.** codex-tui impl members repeatedly leave 4 files
  (`status_surfaces.rs`, `tests/app_server.rs`, `tests/status_and_layout.rs`,
  `resume_picker.rs`) as LF→CRLF whitespace-only churn. Verify with
  `git diff --numstat --ignore-all-space`; revert before/after the real commit.
- **Known false-alarms** (NOT build blockers): `cargo test -p codex-tui` hits a
  pre-existing `reset_memories_clears_local_memory_directories`
  `STATUS_STACK_OVERFLOW` (Windows harness); `spec_plan_tests.rs` "fmt error" is
  a rustfmt quirk byte-identical to released `.4`. Touched-path reruns are the
  real signal.
- **data.json edits** — ID-keyed file-based scratch script in `.ralph/scratch/`
  (NOT inline `node -e` — PowerShell 5.1 mangles parens/quotes and aborts the
  whole block), `JSON.parse` guard + before/after count, stage `data.json`
  explicitly (**never `git add -A`**), commit retry loop on `index.lock`.
- **Lead listener** — re-arm as the FIRST tool call on every PreToolUse block
  (no `--timeout-ms`, indefinite); review-mail on every review-required nag.
- **Push both remotes** after every merge: `origin` (evmitran_microsoft) +
  `personal` (Evyatar108, needs `gh auth switch --user Evyatar108` then switch
  back to `evmitran_microsoft`).
- **codex builds ONLY** via `files/codex-cargo.sh` (Git Bash; clang-cl /
  lld-link / xwin); release via `files/codex-cargo-release.sh`.

---

## 6. Key files / pointers

- `.ralph-overview/data.json` — 271 tasks; the bookkeeping target.
- `codex/external/repos/codex-patched` — inner Rust submodule, on
  `ralph/codex-v6-int` @ `6f0137db`. The canonical checkout where codex impls serialize.
- `codex/external/repos/codex-patched/codex-rs/features/src/lib.rs` — the
  experimental-features registry; resume fix added `retained_transcript_viewport`;
  the expfeatures-migration + bg-wake + paste-guard impls all add Features here.
- `codex/docs/implementation/patch-surface.md` — fork divergence registry.
- `.ralph/investigations/codex-resume-slow-history-paint-regression-from-resize-fix/findings.md`
  — the root-cause analysis driving the fix.
- `.ralph/jobs/{codex-patch-surface-divergence-registry-refresh,codex-fork-flags-to-experimental-features-migration,codex-bg-wake-payload-overflow-spill-to-file}/plan.md`
  — the 3 impl-ready plans.
- Session-state `files/`: `spawn-copilot-from-file.js` (codexu-root cwd member),
  `spawn-copilot-cwd.js` (custom cwd, arg3 = member cwd, for canonical-checkout
  impls), `codex-cargo.sh` / `codex-cargo-release.sh` (builds),
  `prompt-impl-resumefix.txt` (the resume-fix prompt, already used).

---

## 7. First actions for the next bookkeeper

1. **Arm the lead listener** (the exact command the PreToolUse block hands you).
2. **`ask_user`** the §3 open decision: cut `.6` now (just resume fix) vs. chain
   more impls onto `v6-int` first. This is the only thing gating the operator's
   fix reaching their machine.
3. Verify state matches §1 (`git -C codex/external/repos/codex-patched log
   --oneline -1` = `6f0137db`; codexu `main` = `e3758811`; roster = lead only).
4. Proceed per the operator's choice — serialize codex impls on `v6-int`,
   stagger any spawns, bookkeep + push both remotes after each ship.
