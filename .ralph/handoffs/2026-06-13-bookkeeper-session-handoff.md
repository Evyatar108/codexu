# Bookkeeper-Lead Handoff — 2026-06-13 end-of-session → fresh session

> Fresh bookkeeper: read in this order — (1) `AGENTS.md`, especially the
> **"Bookkeeper operating invariants"** section (lead-orchestrates-members-do-
> the-work, branch/worktree discipline, data.json edit-anchor safety,
> continuous-flow pipeline, spawn-prompt invariants); (2) the session
> `plan.md` (final-state summary); (3) this doc. You are the
> `overview-bookkeeper` lead of crew `ralph-pipeline`, running under Copilot CLI.

---

## 0. THE HEADLINE: codex `.8` work is accumulated on `v8-int`, NOT yet released

Two `.8`-bound commits sit on the accumulation branch `ralph/codex-v8-int`
(in `codex/external/repos/codex-patched`, off the `.7` tip `7e49fc58` /
released `0.135.0-copilot-api.7`). **`.8` is not cut yet** — the codexu
submodule pointer still points at the `.7` release.

- **`5b8aec23bf`** `Self-heal Windows console input mode` — covers TWO tasks:
  the **input-mode self-heal FIX** (`codex-tui-input-mode-full-guard-windows-recur`,
  the operator's live `[I`/broken-Backspace/Enter/Escape mid-session bug) AND
  the opt-in **console-mode TRACER** (`codex-console-mode-corruption-tracer`,
  `CODEX_CONSOLE_MODE_TRACE=1`, default-off, records the corruption delta
  BEFORE the fix self-heals). `cargo check -p codex-tui` passed.
- **`43ac126981`** `Expose fork experimental feature gates` — a 4-story BUNDLE
  making fork features visible in the `/experimental` picker:
  (1) `anthropic_models` Stable→Experimental visible; (2) `managed_hooks`
  visible as "Allow managed (admin) hooks" + patch-surface §20; (3) new
  default-OFF `Feature::AutoLoadClaudeMd`; (4) `style_user_messages` legacy-key
  compat-mapping. `cargo check -p codex-core` + `codex-tui` passed.

**Getting `.8` out** delivers the operator's input-mode fix (live pain) +
the experimental-picker visibility they asked for. **But cut the Step-0
preflight-gate fix FIRST** — see §3.

---

## 1. Where we are

**Clean exit.** Pipeline STOPPED. Roster = lead only (all 4 members this
session — guard-tracer-resume, reviewmail-conformance, plan-snapshot,
expfeatures-bundle, delivery-gap-investigation — were hard-stopped after
their work landed). Everything synced:
- codexu `main` = **`f59f5c8e`** (local = `origin` = `personal`, all three equal)
- toolkit `main` = **`1e311aa2`** (in `ai-developer-toolkit/`; crews 3.23.1 ship)
- codex inner checkout = branch **`ralph/codex-v8-int`** @ **`43ac126981`**
  (the 2 `.8` commits). **Inner working tree is CLEAN except `?? .worktrees/`**
  (gitignored) — EOL-noise on the usual 4 files was reverted at end of session.
- data.json: **283 tasks**, 0 orphan, 0 dup (JSON.parse-verified).

**Active plugin versions** (codexu AGENTS.md version table = CI source of truth):
`crews 3.23.1` (shipped this session), `ralph (ralph-orchestration) 5.59.0`,
`ralph-overview 2.11.0`. (The AGENTS.md table line for crews was bumped to
3.23.1 in commit `6bc9de7d`.)

---

## 2. Shipped / done this session (all merged + bookkept + pushed)

| Work | Result |
|---|---|
| **crews `3.23.1`** released | review-mail `overview` now emits the full capped `actionable[]` array (headline + lossless per-kind counts + routed-kind handling), replacing the lossy first/last schema. Toolkit FF `1e311aa2` → origin/gim-home/personal; codexu pointer `6bc9de7d`; `copilot plugin update` v3.23.0→v3.23.1 live; task `crews-review-mail-overview-plan-conformance` flipped **merged** (`948c782f`). Merge-gated 293/294 (1 known concurrency flake passes standalone). |
| codex `.8` input-mode self-heal FIX + console-mode TRACER | ✅ impl `5b8aec23bf` on `v8-int`; **resumed from a member that died mid-build** (work preserved, compile-verified, committed); both tasks carded (`7bc547f7`). **`.8` not yet cut.** |
| codex `.8` expfeatures-visibility BUNDLE (4 stories) | ✅ impl `43ac126981` on `v8-int`; 4 tasks carded (`f59f5c8e`). **`.8` not yet cut.** |
| `ralph-copilot-exec-readonly-submodule-snapshot-cost` plan | ✅ shipped (5 stories US-001..005, plan cherry-picked `8cb5480c`) + carded + **impl-seeded** (`64fac53e`). Single-repo ralph plugin. |
| **crews delivery-gap** root-cause investigation | ✅ done (findings `09c68834`); see §4. Filed `crews-review-mail-history-recovery-and-log-rotation` (impl-ready) + corrected a mis-attributed card (`c9b97b07`). |

---

## 3. The `.8` release queue — what's on `v8-int` + the OPEN decision

**Already on `v8-int`** (6 stories across 2 commits): input-mode self-heal +
console-mode tracer (`5b8aec23bf`) + 4 expfeatures stories (`43ac126981`).

**MUST-FIX BEFORE cutting `.8`** (it blocks every release):
`codex-publish-preflight-gate-excludes-submodule-gitlink` — the Step-0
assert-clean gate in `codex/.claude/commands/publish-sandbox-patch.md` (added
by the `.7` overlay-fmt fix) over-counts the expected-ahead submodule gitlink
as dirty and ABORTS Step 0. We hand-waved past it in `.6`/`.7` by telling the
member to proceed; fix it for real this time. It's a **WRAPPER-only doc/skill
change (no inner build, no version bump)** — impl-ready seed exists; safe to
run in a `codex/` worktree (does NOT touch the canonical inner checkout, so it
can run PARALLEL to an inner-codex impl).

**The OPEN decision** (`ask_user` it first thing):
- **(a)** cut `.8` NOW with the 6 stories already on `v8-int` → fastest path
  to the operator's input-mode fix + expfeatures visibility, or
- **(b)** chain more inner-codex queue tasks (below) onto `v8-int` first.

**Remaining inner-codex queue** (all edit `codex/external/repos/codex-patched`;
**serialize ONE at a time** on `ralph/codex-v8-int`):
- `codex-rs-feature-pruning-for-sub-45m-cold` (faster cold builds; impl-ready)
- `codex-bg-wake-payload-overflow-spill-to-file` (impl-ready)
- `codex-patch-surface-divergence-registry-refresh` (doc-only; impl-ready)
- `codex-paste-guard-perf-and-dropped-text` + `codex-v1-agent-thread-limit-not-released-on-completion`
  (both have findings.md; need impl seeds written — quick-seed-from-findings)

**To cut `.8`** (when decided): drive `/publish-sandbox-patch` from the codex
submodule. Bump `Cargo.toml` to `0.135.0-copilot-api.8`, release build via
`files/codex-cargo-release.sh`, tag inner `release/0.135.0-copilot-api.8`,
wrapper gitlink + tag `v0.135.0-copilot-api.8` on gim-home, GitHub Release +
bundle, then codexu pointer bump. Flip all `.8` tasks → `merged` with
shipManifest. Mirror the `.7` ceremony (checkpoint 009).

---

## 4. The crews delivery-gap — root-caused (read this; it changes your habits)

**Symptom this session:** a member's `done` (`plan-copilot-exec-snapshot`)
landed in its OUTBOX but the operator had to relay it — it never surfaced to
the lead. **Root cause (findings `09c68834`,
`.ralph/investigations/crews-undeliverable-report-delivery-gap/findings.md`):**
NOT a delivery failure. The done WAS delivered (lead mailbox-history inbox seq
707) and listener-consumed; then the lead cursor advanced to 710 during the
busy crews-3.23.1 review cycle, **so I consumed it without operationally
surfacing/acting on it**. A **cursor-after-consume review-surfacing gap**.

- The `liveness-notifications.json.lock` `LockTimeoutError` in crews.log is
  **BENIGN** crash-sweep latch pressure — NOT the notify path (ruled out).
- The "zero log lines for the member" was crews.log **64KiB rotation** (it
  DELETES the whole log) — not a missing hook. Don't trust crews.log for old events.
- Actor-hijack **ruled out** (manifest stayed `engine:copilot`; `actors.js`
  guards decline the codex-child takeover).
- Filed **`crews-review-mail-history-recovery-and-log-rotation`** (impl-ready):
  add a non-cursor-advancing `--recover-outbox/--recover-member` lookup in
  `review-mail` + rotate crews.log instead of deleting.

**HABIT CHANGE (carry forward):** when `review-mail` advances the cursor across
a busy multi-member window, **inspect ALL `kind!=='progress'` rows in the
consumed range, not just the one you're expecting** — a member B `done` can be
silently swept while you look for member A's. If a done seems missing, recover
it with **`read-member <name> --all`** (the member outbox is durable even when
the mailbox surfacing missed it).

---

## 5. Held / pending decisions (NOT in the .8 queue)

- **`set-agent-concurrency` skill** (`71797f435`, branch
  `ralph/codex-skill-set-agent-concurrency`, worktree under
  `codex/.worktrees/`) — **UNMERGED**, awaiting operator location decision
  (`.claude/commands/` was flagged as the wrong home). Re-ask where it belongs.
- **`crews-codex-member-tab-title-not-renamed`** (impl-ready, crews) —
  deliberately HELD: its acceptance requires a **LIVE codex-member spawn with
  visual tab-title confirmation** (exit-code-only is a false positive for this
  bug class) AND it shares `hooks/actors.js` with `crews-pidalive` (serialize
  same-plugin). Run it deliberately, not as a blind autonomous stack.
- `crews-mail-delivery-via-codex-injection` — still HELD on dual-repo decisions
  (carry-over from prior handoff).

---

## 6. Recommended next batch (disjoint surfaces, parallel-safe)

With `v8-int` free (no inner-codex member running), a clean wide batch:
1. **`codex-publish-preflight-gate-excludes-submodule-gitlink`** — the `.8`
   unblocker; WRAPPER-only (`codex/` worktree), parallel-safe to everything.
2. **`crews-review-mail-history-recovery-and-log-rotation`** (crews) — fixes
   the bug we just root-caused; impl-ready; high meta-leverage.
3. **`ralph-copilot-exec-readonly-submodule-snapshot-cost`** (ralph plugin) —
   plan just shipped, impl-ready; different plugin = parallel-safe vs #2.
4. (meta) **`overview-parallel-ready-excludes-merged-lifecycle`** (ralph-overview
   plugin) — needs a plan first; the ready-list currently leaks merged tasks.

NOTE: #2 (crews) and #3 (ralph) and #4 (ralph-overview) are 3 DIFFERENT
plugins in the same submodule → parallel-safe at plugin-code level, but each
plugin ship bumps its own version/AGENTS/CHANGELOG, so don't run two impls
targeting the SAME plugin at once. #1 is a different repo entirely (codex
wrapper). The operator picked #1 + #4 earlier but we pivoted to the
investigation + handoff — re-confirm priority.

---

## 7. Standing reminders / discipline (the ones that bit us this session)

- **Stagger spawns ~30-45s.** "Denied by preToolUse hook (hook errored)" is
  crews hook-saturation under concurrent SessionStart/arming. Don't fan out
  spawns simultaneously.
- **Canonical-checkout serialization.** Every codex impl edits
  `codex/external/repos/codex-patched`; run ONE at a time on `ralph/codex-v8-int`.
  (The wrapper-only preflight-gate task is the exception — it's in `codex/`,
  not the inner checkout.)
- **EOL-noise pattern (recurred again).** codex-tui impl members leave 4 files
  (`status_surfaces.rs`, `tests/app_server.rs`, `tests/status_and_layout.rs`,
  `resume_picker.rs`) as LF→CRLF whitespace-only churn. Verify with
  `git diff --numstat --ignore-all-space` (0 content lines = pure EOL); `git
  checkout --` them before/after the real commit.
- **Member-liveness scan is unreliable** via regex (`launcherPid:undefined`
  breaks the window). For authoritative liveness, check the most recent
  `manifest-turn-update name=<member>` line in crews.log OR read the member
  manifest's `updatedAt` directly — don't trust a "only lead alive" regex result.
- **Members can die mid-build** leaving uncommitted work (happened to the
  guard-tracer). If a member's tab is gone but the inner checkout is dirty,
  **resume** it (preserve + compile-verify + commit) rather than re-do from scratch.
- **Known false-alarms** (NOT build blockers): `spec_plan_tests.rs` rustfmt/
  parse quirk blocks core unit-test filters (byte-identical to released);
  `reset_memories_clears_local_memory_directories` `STATUS_STACK_OVERFLOW`
  (Windows harness). Touched-path test reruns are the real signal.
- **data.json edits** — ID-keyed file-based scratch script in `.ralph/scratch/`
  (NOT inline `node -e` — PowerShell mangles parens/quotes), `JSON.parse` guard
  + before/after count, stage `data.json` explicitly (**never `git add -A`**),
  commit retry loop on `index.lock` (collisions were FREQUENT this session —
  loop ~10x with 4-5s sleep), delete the scratch after commit.
- **Lead listener** — re-arm as the FIRST tool call on every PreToolUse block
  (no `--timeout-ms`, indefinite); review-mail on every review-required nag
  (and inspect ALL non-progress rows per §4).
- **Push both remotes** after every merge: `origin` (evmitran_microsoft) +
  `personal` (Evyatar108, needs `gh auth switch --user Evyatar108` then switch
  back). Toolkit also pushes `gim-home` (SAML, evmitran_microsoft).
- **Plugin version ships PAUSE** for operator confirmation (toolkit push to
  gim-home + codexu pointer + `copilot plugin update`). ralph-overview
  hot-swap hits `EBUSY` (its MCP server holds the install dir) — refreshes
  next session; non-blocking.
- **codex builds ONLY** via `files/codex-cargo.sh` (Git Bash; clang-cl /
  lld-link / xwin); release via `files/codex-cargo-release.sh`. Default `bash`
  may be broken WSL — members must use Git Bash explicitly.

---

## 8. Key files / pointers

- `.ralph-overview/data.json` — 283 tasks; the bookkeeping target.
- `codex/external/repos/codex-patched` — inner Rust submodule, on
  `ralph/codex-v8-int` @ `43ac126981`. The canonical checkout where codex impls
  serialize. `features/src/lib.rs` is the experimental-features registry.
- `codex/.claude/commands/publish-sandbox-patch.md` — the release ceremony
  skill (has the buggy Step-0 gate — see §3).
- `.ralph/investigations/crews-undeliverable-report-delivery-gap/findings.md`
  — the delivery-gap root-cause (§4).
- `.ralph/investigations/codex-focus-leak-recur-after-subagent-v6/findings.md`
  + `.ralph/investigations/codex-console-mode-corruption-tracer/design-spike.md`
  — drove the `.8` self-heal + tracer.
- `.ralph/investigations/codex-fork-features-experimental-audit/findings.md`
  — the 29-row audit driving the expfeatures bundle.
- `.ralph/jobs/ralph-copilot-exec-readonly-submodule-snapshot-cost/plan.md`
  — the just-shipped 5-story plan (impl-seeded).
- Session-state `files/`: `spawn-copilot-from-file.js` (codexu-root cwd member),
  `spawn-copilot-cwd.js` (custom cwd, arg3 = member cwd, for canonical-checkout
  + worktree impls), `codex-cargo.sh` / `codex-cargo-release.sh` (builds),
  and ~20 saved prompts incl. `prompt-impl-guard-tracer-resume.txt`,
  `prompt-impl-expfeatures-bundle.txt`, `prompt-investigate-delivery-gap.txt`.

---

## 9. First actions for the next bookkeeper

1. **Arm the lead listener** (the exact command the PreToolUse block hands you;
   no `--timeout-ms`).
2. Verify state matches §1 (`git -C codex/external/repos/codex-patched log
   --oneline -1` = `43ac126981`; codexu `main` = `f59f5c8e`; roster = lead only).
3. **`ask_user`** the §3 open decision: cut `.8` now (6 stories on `v8-int`)
   vs. chain more inner-codex impls first — AND confirm the §3 must-fix
   (publish-preflight-gate) runs before the cut.
4. Re-confirm the §5 `set-agent-concurrency` skill location decision.
5. Proceed per the operator's choice — serialize codex impls on `v8-int`,
   run the wrapper-only preflight-gate fix + the crews/ralph/ralph-overview
   plugin impls in parallel (disjoint plugins), stagger spawns, bookkeep +
   push both remotes after each ship.
