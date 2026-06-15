# Bookkeeper Session Handoff — 2026-06-15

Lead session (this one): `c9a3990e-55c1-4ddb-b566-78cf0b64b6fa` (Copilot CLI,
`overview-bookkeeper` lead of crew `ralph-pipeline`).

## TL;DR

Shipped **two codex releases** end-to-end and bookkept them:

- **`0.135.0-copilot-api.9`** — fixed the operator's two `.8` regressions
  (broken Windows paste; anthropic `/model` cache staleness).
- **`0.135.0-copilot-api.10`** — bundled three nice-to-have features
  accumulated on `v10-int` (live feature toggles without restart; open-agent
  -limit error clarity; paste-burst robustness).

All work is on `origin/main` + `personal/main` and reflected in
`.ralph-overview/data.json`. No members are running. Clean stopping point.

## Current state (verified at handoff)

| Thing | Value |
|---|---|
| codexu `main` HEAD | `6ec79105` (origin + personal synced) |
| codexu `codex` submodule pointer | `720ad774` = `v0.135.0-copilot-api.10` (clean, matches) |
| codex **wrapper** (`codex/`) | `main` @ `720ad774`, tag `v0.135.0-copilot-api.10`, on gim-home |
| codex **inner** (`codex/external/repos/codex-patched`) | `ralph/codex-v10-int` = `origin/sandbox-patches` = `dc7e7491` (the `.10` version-bump) |
| Live crew members | only the lead (`alive=1`) |

> The inner `v10-int` now points at the `.10` release commit `dc7e7491`
> (version string already `0.135.0-copilot-api.10`). **The next codex-inner
> batch should branch a fresh `ralph/codex-v11-int` off `dc7e7491` /
> `sandbox-patches`** (don't keep piling `.11` work on `v10-int` — same
> convention as v8→v9→v10).

## What shipped this session

### codex 0.135.0-copilot-api.9 (Release: gim-home/codex `v0.135.0-copilot-api.9`)
- `a5fc05d1` fix(config): paste-burst heuristic **default-ON for Windows**
  (`Feature::LegacyPasteBurstHeuristic` `default_enabled = cfg!(windows)`).
  Root cause: the `.8` expfeatures migration silently defaulted the guard OFF,
  and on Windows crossterm never emits `Event::Paste` (WinAPI INPUT_RECORD
  backend + codex clears `ENABLE_VIRTUAL_TERMINAL_INPUT`), so the heuristic is
  the only Windows paste path. Investigation:
  `.ralph/investigations/codex-bracketed-paste-fails-windows-terminal/findings.md`.
- `c7cf5413` Fix Copilot model cache gate identity — `models_cache.json`
  identity now keyed by provider + `anthropic_models_resolved()`, so toggling
  the anthropic gate invalidates the stale (300s TTL) cache. Fixes "anthropic
  models don't appear in `/model` after enable+restart". **Note:** this fixes
  the enable+**restart** path; live toggle (no restart) is the `.10` feature.

### codex 0.135.0-copilot-api.10 (Release: gim-home/codex `v0.135.0-copilot-api.10`)
Inner `dc7e7491` (version bump) over the 3 feature commits on `v10-int`:
- `596352d5` fix(tui): **live-toggle selected experimental features** — the
  anthropic model gate (live `GatedModelsManager` gate + model-catalog refresh
  after the awaited config reload + active-model fallback),
  `LegacyPasteBurstHeuristic`, and `UserMessageStyling` now apply live in
  `/experimental` without restart (via `set_feature_enabled()`).
- `46488481` fix(core): **clarify open agent thread limit** — the
  agent-thread-limit error now reads as an OPEN-agent limit, lists open agents,
  hints `close_agent` (v1 + v2). The cap is intentionally on OPEN threads; NOT
  a leak.
- `48a2f99` fix(tui): **make paste burst heuristic rearmable** — no first-char
  typing lag; rearmable bursts so a slow producer can't split or early-submit a
  paste. Tested (paste_burst 12 + chat_composer 192).

## Bookkeeping done (data.json)

`merged` + `shipManifest` this session:
- **`.9` batch** (10 tasks flipped earlier in the session via the `.8`→`.9`
  arc; see prior handoff for the `.8` set) plus
  `codex-anthropic-models-not-in-model-picker-when-enabled` (the cache fix; I
  also removed an accidental DUPLICATE row of it — the real one is the last
  task in the array).
- **`.10` batch**: `codex-experimental-feature-live-toggle-no-restart`,
  `codex-v1-agent-thread-limit-not-released-on-completion`,
  `codex-paste-guard-perf-and-dropped-text` (the last shipped across **both**
  `.9` default-flip and `.10` robustness — its shipManifest lists both commits).
- `codex-rs-feature-pruning-for-sub-45m-cold` → **`archived`** (reverted from
  `v10-int`; A/B showed no cold-build win, not worth the fork-conflict surface).

Filed (still `tracked`, NOT shipped):
- `codex-windows-bracketed-paste-vt-input` — long-term "make true Windows
  bracketed paste work" (VT-input reader; needs brainstorm/plan). Investigation
  done.
- `codex-experimental-feature-live-toggle-no-restart` is now `merged`, but a
  per-feature classification in its findings notes other features that could be
  made live later if asked.

## Next batch candidates (for a fresh `v11-int` off `dc7e7491`)

- `codex-upstream-rebase-to-0.139` — we're on `.135`, upstream is `.139`.
  Gated on the patch-surface registry refresh landing as prep.
- `codex-patch-surface-divergence-registry-refresh` — RE-PLAN shipped
  (`b834baab`, current-through-`.8`) + impl seed READY; doc+markers, no build.
  This is `.139`-rebase prep. **Good next impl** (codex-inner, no build).
- `codex-windows-bracketed-paste-vt-input` — brainstorm/plan-first.
- The live-toggle "other features" follow-ups (low value; defer).

## Operational notes / gotchas (IMPORTANT — learned this session)

1. **Codex release members MUST run on the COPILOT engine, never codex.** The
   publish flow (`/publish-sandbox-patch`) kills stray `codex.exe`/`codex-core
   .exe` to avoid build-lock `Access is denied`; a codex-engine release member
   is itself such a process and **kills itself** mid-cut (this happened to
   `release-codex-v9`; recovered via copilot `release-codex-v9b`). The `.10`
   cut ran clean on copilot. Spawn release members with
   `spawn-copilot-from-file.js`.
2. **codex-inner impls = direct-impl in the canonical checkout**
   (`codex/external/repos/codex-patched`), NOT `/implement-with-ralph` (cargo
   can't build from a worktree). Serialize one-at-a-time on the accumulation
   branch. Build via Git Bash `files/codex-cargo.sh check -p <crate>`; release
   via `codex-cargo-release.sh`. A codex member given a direct-impl prompt (no
   `$skill` token) just implements manually — that's what we want.
3. **Release ceremony env hiccups (copilot handled them, but expect them):**
   `python` resolves to the MS Store alias → use
   `C:\Users\evmitran\AppData\Local\miniconda3\python.exe`; bare `npm`/`pnpm`
   subprocess lookups need a temp resolver wrapper; the sandbox-setup helper
   `--version` needs elevation (record as built-but-not-runnable, not a
   blocker); the combined `--version` smoke can hang on that helper — use
   per-binary timeouts. Build was ~38 min on a partial cache.
4. **`data.json` is the highest-risk file.** Per-edit discipline: anchor edits
   on `"id": "<exact-task-id>"` + the specific field (NEVER on non-unique
   `"lifecycle":`/`"scope":`/`"lastTouchedAt":`); after edits run a
   JSON.parse + task-count + duplicate-id guard (scratch script in
   `.ralph/scratch/`, delete after); stage `data.json` EXPLICITLY (NEVER
   `git add -A` — `M codex` is the submodule pointer + there's untracked
   generated/ + worktree noise); commit with a retry loop (~12× / 4s) for
   `index.lock` collisions. I hit a duplicate-task bug this session from a
   `Select-Object -First 2` that hid a pre-existing row — always grep WITHOUT a
   head limit when checking for existing tasks.
5. **`.release-*` scratch files** can be left in the codex wrapper by a
   crashed/partial release member — clean them (untracked; not committed since
   we stage explicitly).
6. **Pushing both remotes:** codexu has `origin` (evmitran_microsoft) +
   `personal` (Evyatar108, needs `gh auth switch --user Evyatar108` then switch
   back to `evmitran_microsoft`). gim-home is SAML under evmitran_microsoft.

## Lead takeover (do this FIRST in the next session)

1. Rebind the lead (the manifest still points at THIS session id):
   `assign-role lead --crew ralph-pipeline --name overview-bookkeeper`
   (reads `COPILOT_AGENT_SESSION_ID` + `CREWS_STATE_CWD` env; REJECTS `--cwd`).
   Verify the lead manifest `sessionId` == your session, THEN arm.
2. Arm the listener INDEFINITELY (no `--timeout-ms`), async, shellId `listener`,
   using the exact PreToolUse-provided command. Re-arm as the FIRST tool call
   after every mailbox drain.
3. **NEVER `resume-crew --confirm`** on `ralph-pipeline` (mass-respawn footgun —
   hundreds of dead members). To recover one member, spawn it fresh by name.

## Spawn / build helpers (in this session's files dir)

`C:/Users/evmitran/.copilot/session-state/c9a3990e-55c1-4ddb-b566-78cf0b64b6fa/files/`
- `spawn-from-file.js <name> <promptfile>` — spawns a **codex** member
  (CREWS_ENGINE=codex), cwd=codexu root.
- `spawn-copilot-from-file.js <name> <promptfile>` — spawns a **copilot**
  member (use for release members + heavy multi-lens brainstorm/plan +
  read-only investigations).
- `codex-cargo.sh` / `codex-cargo-release.sh` — Git Bash cargo helpers
  (clang-cl/lld-link/xwin env). Check via `... check -p <crate>`.
- Saved prompts: `prompt-impl-*.txt`, `prompt-plan-*.txt`,
  `prompt-investigate-*.txt`, `prompt-release-v9.txt` / `-v9b.txt` /
  `-v10.txt` (adapt for the next cut).

> **The next session MUST re-patch `SESSION_ID` in
> `spawn-from-file.js` + `spawn-copilot-from-file.js`** (and copy them to its
> own files dir) — they hard-code this session's id
> `c9a3990e-55c1-4ddb-b566-78cf0b64b6fa`.

## Engine policy reminder

`CREWS_ENGINE=codex` is the User-level default, so a bare spawn = codex. Use
`--engine copilot` (or `spawn-copilot-from-file.js`) for: release members
(self-kill!), heavy multi-lens brainstorm/plan members (reliability), and
read-only investigations (isolation from codex resource pressure). Keep
concurrent heavy multi-lens members to ~2; a light codex impl + one heavy
copilot plan in parallel is fine.
