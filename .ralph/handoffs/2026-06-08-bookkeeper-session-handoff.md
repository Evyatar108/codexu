# Bookkeeper-Lead Handoff — 2026-06-08 end-of-session → fresh session

> Fresh bookkeeper: read in this order — (1) `AGENTS.md`, especially the
> "Bookkeeper operating invariants" section and the **NEW 2026-06-08 lessons**
> (FF-merge gotchas, dogfood-the-real-path, engine selection, seed-verify-
> not-rubber-stamp, settle-claims-against-source, file-based data.json scripts);
> (2) the **codex-default-engine** bullet in AGENTS.md (Spawn-prompt invariants);
> (3) the session `plan.md` (final-state summary); (4) this doc. You are the
> `overview-bookkeeper` lead of crew `ralph-pipeline`, running under Copilot CLI.

---

## 0. THE HEADLINE: codex is now the DEFAULT crews member engine

Set this session via the User-level env var **`CREWS_ENGINE=codex`** (chosen for
max reversibility — no code change). A bare spawn (no `--engine`) now produces a
**codex** member, even from this Copilot lead. Precedence in
`hooks/actors.js spawnMember`: `--engine` > `CREWS_ENGINE` > caller-CLI-detect >
`claude`. Validated: a no-`--engine` spawn wrote `manifest.engine=codex`.

- **In-session caveat:** a User-level env var only reaches NEW process trees. If
  `echo $env:CREWS_ENGINE` is empty in a shell, either set
  `$env:CREWS_ENGINE='codex'` there or pass `--engine codex` explicitly.
- **Spawn helpers** (session-state `files/`): `spawn-from-file.js` now injects
  `CREWS_ENGINE=codex` (codex default); `spawn-copilot-from-file.js` forces
  `--engine copilot` — **use the copilot helper for HEAVY multi-lens brainstorms/
  plans** (reliability; codex-default is fine for routine/validated work).
- **Revert:** `[Environment]::SetEnvironmentVariable('CREWS_ENGINE',$null,'User')`.

The full codex-engine readiness chain is COMPLETE (spawn/lifecycle, skills+adapter,
lens hang+timeout, provisioning, runaway-guard closed, Stage-1 live smoke passed).

---

## 1. Where we are

**Clean exit.** Pipeline STOPPED by operator. Roster = lead only. Everything synced:
- codexu `main` = **`44b0069e`** (local = `origin` = `personal`)
- toolkit `main` = **`548152a9`** (`origin` = `gim-home` = `personal`)
- codex submodule pointer = HEAD = `4f305936`
- data.json: **189 tasks** (143 merged / 32 tracked / 14 archived), 0 orphan, 0 dup.

**Active plugin versions** (codexu AGENTS.md version table = CI source of truth):
`crews 3.14.1`, `ralph (ralph-orchestration) 5.55.0`, `ralph-overview 2.10.0`.

### Shipped this session (all merged + bookkept)
- **crews v3.13.0** — member-crash auto-notify lead. Toolkit `bea1bd20`.
- **ralph v5.55.0** — codex-exec `DEFAULT_TIMEOUT_MS` 240000→1200000 (20-min
  last-resort backstop); removed the stale "must undercut ~300s harness" premise.
  Toolkit `5b917d9a`. (Honors the operator rule: codex/agent lens timeouts ≥20 min.)
- **crews v3.14.0** — two-layer engine plugin provisioner (`install-plugin` +
  `list-plugins`, all 3 engines, structured restart-required verdict). Toolkit `cf14fc98`.
- **crews v3.14.1** — installed-CLI toolkit-root fix for the provisioner (found by
  live DOGFOOD of v3.14.0 — green 295/295 tests but 100% broken via the installed
  CLI). Toolkit `548152a9`.
- **runaway-guard** (`ralph-codex-iteration-engine-runaway-spawn-guard`) — ARCHIVED
  as superseded. Investigation proved codex sub-agent spawn is depth-limited-to-1
  (breadth-only, like Claude Code Task tool); every "runaway" ingredient already
  handled. Findings: `.ralph/investigations/codex-recursive-subagent-spawn/`.
- **AGENTS.md** — 6 new bookkeeper lessons codified (`44b0069e`).
- The **codex-default flip** itself (bookkept merged).

---

## 2. What to do next (nothing is running — all plan-ready)

### ★ Top item: `codex-raw-session-happy-daemon-autoconnect` (PLAN-READY, spike-gated)

Operator goal (refined across 4 messages this session): a raw `codex` invocation
of OUR FORK binary should **behave exactly like `happy codex`** — FULL mobile
remote control (turns + approvals + interrupt/stop), discoverable + synced — with
**NO happy-cli runtime dependency**, **integrated into the fork** (NOT a read-only
mirror, NOT a PATH alias).

Brainstorm v2 (`2a2c8278`) → **Direction B: native Rust `codex-happy` overlay
crate**, session-scope, **Phase-0 GO/NO-GO spike is Story 1**. `prompts.plan` is
seeded in data.json. Key source-verified finding: `Codex.rx_event` is a TUI-owned
single-consumer mpsc, so a *bounded* upstream-canonical seam is unavoidable (sized
**XL**). **CODEX SUBMODULE task.**

> **OPERATOR DECISION PENDING (do not start the plan without surfacing this):** B
> puts new network egress (happy-server + Dev Tunnels) INSIDE the audited
> codex-core, whose whole purpose is suppressing non-Copilot egress — the
> strongest argument for the **D fallback** (keep happy-cli daemon owning the
> Happy wire, reuse the same Axis-1 seam). The Phase-0 spike is designed to decide
> B-vs-D. Next action = spawn `/plan-with-ralph --from-brainstorm` (jobs-only,
> conflict-free) when the operator says go.

### Other plan-ready / impl-ready (operator-gated — confirm before spawning)
- `codex-app-server-idle-timeout` — IMPL-ready (was HOLD; happy-cli TS only).
- `overview-data-context-scalability` — IMPL-ready, **DUAL-REPO** (don't blind-chain
  `/implement-with-ralph` — see AGENTS.md dual-repo rule).
- `ralph-overview-init-consumer-cross-engine-wrapper` — IMPL-ready.
- `codex-fork-install-script` — PLAN-ready (HOLD).
- Disjoint backlog candidates (jobs-only, conflict-free): `plan-runaway`'s sibling
  `ralph-copilot-exec-readonly-submodule-snapshot-cost` (PLAN), `codex-git-marketplace-
  snapshot-tmp-ephemeral` (BRAINSTORM).

### Filed bugs (tracked, no prompts yet)
- `ralph-codex-live-smoke-windows-shim-spawn` — the v5.53.0 opt-in live fan-out
  smoke uses bare `spawnSync("codex")` which ENOENTs on Windows' `codex.ps1` shim;
  NOT a fan-out regression (fan-out validated by the D-003 spike + Stage-1 smoke).
  Small; bundle with a future ralph change.

---

## 3. Session lessons now in AGENTS.md (don't re-derive)

All codified under "Bookkeeper operating invariants" (markers "codified 2026-06-08"):
1. **Two FF-merge gotchas** for plan/brainstorm branches: stale-base phantom diff
   (rebase the worktree onto main first; three-dot diff confirms it's phantom) +
   untracked-copy conflict (hash-verify identical, then `Remove-Item`, then FF).
   Both bit ~4× this session.
2. **Dogfood a shipped CLI/tool via its REAL installed-CLI path before flipping
   `merged`** — green unit tests are insufficient (the v3.14.0→v3.14.1 lesson).
3. **Engine selection** — heavy multi-lens work on copilot; routine on codex-default.
4. **Seed brainstorms with the operator's lean BUT demand the disconfirming check**
   (no rubber-stamp) — the v2 brainstorm earned its keep by correcting "overlay-only".
5. **Settle factual fork/codex claims against SOURCE before they drive task framing**
   — my wrong "recursive spawn" claim → operator challenged → investigation corrected.
6. **File-based `.ralph/scratch/*.js` for all non-trivial data.json edits** (inline
   `node -e` breaks on PS5.1 quote-mangling — broke twice this session).

Plus the standing data.json safety: JSON.parse check + EOL guard
(`git diff --cached --numstat` must equal `--ignore-cr-at-eol --numstat`) +
`git add` data.json explicitly (never `-A`).

---

## 4. Listener + operational reminders

- **Arm the lead listener INDEFINITELY** — use the exact hook-provided command
  (name + `--crew` + `--cwd` + `--session-id`, **no `--timeout-ms``). It blocks
  until a message arrives (real-time `via=watch`), then re-arm after processing.
- **Wait via the armed listener, never periodic polls.** `arm-skipped /
  already-active-listener` = don't re-arm.
- **review-mail truncation trap:** a proactive batch can bundle 20+ entries with
  the terminal `done` LAST. Filter for `kind != 'progress'` rather than
  print-then-truncate (this nearly cost a mis-ship this session).
- **Ship ceremony** (canonical in `ai-developer-toolkit/plugins/ralph/AGENTS.md`):
  FF-merge submodule → push 3 toolkit remotes → codexu pointer + AGENTS version-
  table bump → push 2 codexu remotes → `copilot plugin update` → bookkeep merged →
  stop member → cleanup worktree + branch. Standing operator agreement: **pause
  before any plugin VERSION push** (this session the operator granted blanket
  autonomy for the codex-readiness batch; confirm the scope each session).

---

## 5. Housekeeping debt (pre-existing — NOT this session's; flagged for a cleanup pass)

- **~30 leftover worktrees** from prior sessions (several for already-merged tasks)
  = `git fetch --prune` noise. Needs DELIBERATE review — some are intentionally
  parked Phase-4 brainstorms (`brainstorm-bg-gate`, `brainstorm-copilot-exec-readonly`).
  Do NOT blind-sweep.
- **`.gitignore` gap:** `.ralph/scratch/`, `.ralph/jobs/*/worktree/`,
  `.ralph/jobs/.staging/`, `*.log`, `.xwin-cache/` are NOT gitignored → permanent
  `git status` noise (~550 untracked/dirty entries). Targeted ignores would clean
  it (but `.ralph/jobs/<id>/plan.md` IS tracked, so can't ignore `.ralph/jobs`
  wholesale). Operator was offered this fix; left for a dedicated pass.
- **6 legacy merged tasks** (2026-05-13/14) lack `shipManifest` (pre-convention);
  cosmetic, ship info lives in their kanban cards.

> "Everything committed?" answer for this session: YES for all committable work
> (data.json, AGENTS.md, all ships, findings, brainstorm merges — pushed to all
> remotes). The dirty working tree is entirely watcher-generated sidecars +
> transient `.ralph/jobs|scratch` artifacts + build/test logs — none committable.

---

## 6. Quick-reference

- Lead session id: `ebadd2f4-5beb-46b1-ba0c-27729d3cb730`
- crews CLI: `C:/Users/evmitran/.copilot/installed-plugins/ai-developer-toolkit/crews/tools/crews.js`
- Always pass `--state-cwd D:/harness-efforts/codexu --as overview-bookkeeper` to crews CLI calls.
- codexu remotes: `origin` (evmitran_microsoft), `personal` (Evyatar108).
- toolkit remotes: `origin` (evmitran_microsoft), `gim-home` (marketplace source —
  `copilot plugin update` pulls from here), `personal` (Evyatar108).
- codex submodule typecheck gate: `cd codex/external/repos/codex-patched/codex-rs &&
  cargo check --workspace` (~6 min); workspace-parse preflight:
  `cargo metadata --no-deps --format-version 1` before any codex-touching spawn.
