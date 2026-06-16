# Bookkeeper Session Handoff — 2026-06-16

Lead session (this one): `c9a3990e-55c1-4ddb-b566-78cf0b64b6fa` (Copilot CLI,
`overview-bookkeeper` lead of crew `ralph-pipeline`). Continuation of the
2026-06-15 session (same session id, post-compaction).

## TL;DR

This session shipped **two codex artifacts** and teed up the next big one:

1. **Patch-surface registry refresh** (docs/markers, no release) — refreshed the
   fork divergence ledger through `0.135.0-copilot-api.10` as prep for the
   upstream rebase. Inner `b540ef30` + wrapper `5fd96ad4`.
2. **`.140` rebase PLAN shipped + assessed** — confirmed the real upstream
   target is **`rust-v0.140.0`** (not 0.139), produced a 7-story serial plan,
   and **renamed the task to `codex-upstream-rebase-to-0.140`**. The rebase
   IMPL is **NOT started** — it's queued for a fresh session.

All work is on `origin/main` + `personal/main`. No members running. Clean stop.

## Current state (verified at handoff)

| Thing | Value |
|---|---|
| codexu `main` HEAD | `2dd5ff99` (origin + personal synced) |
| codexu `codex` submodule pointer | `5fd96ad4` (clean, == wrapper HEAD) |
| codex **wrapper** (`codex/`) | `main` @ `5fd96ad4` (registry refresh), on gim-home/codex |
| codex **inner** (`codex/external/repos/codex-patched`) | `sandbox-patches` @ `b540ef30` (marker commit), on Evyatar108/codex-openai-fork |
| Latest codex **release** | `v0.135.0-copilot-api.10` (`720ad774`) — the registry refresh is docs-only, NO new release cut |
| Live crew members | only the lead |

> The wrapper `main` is now ONE docs-commit (`5fd96ad4`) ahead of the
> `.10` release tag (`720ad774`); inner `sandbox-patches` is ONE marker-commit
> (`b540ef30`) ahead of the `.10` inner bump (`dc7e7491`). Both are the clean
> base the `.140` rebase will build on.

## What shipped this session

### 1. Patch-surface registry refresh (task `codex-patch-surface-divergence-registry-refresh` → merged)
- **Inner `b540ef30`** "docs: mark fork patch seams" — `// SANDBOX PATCH:`
  anchors on 9 live fork seams (agents_md.rs, features/legacy.rs,
  app/thread_routing.rs, chatwidget/constructor.rs, tool_lifecycle.rs,
  multi_agents.rs, resume_picker.rs, tui/console_mode_trace.rs,
  tui/event_stream.rs). Marker-only, 20 insertions / 0 deletions, no behavior change.
- **Wrapper `5fd96ad4`** "docs: refresh codex patch surface registry" —
  `docs/implementation/patch-surface.md` header → `0.135.0-copilot-api.10`
  (base `rust-v0.135.0`), `.6`–`.10` release ledger, paste-burst row corrected
  to the `Feature::LegacyPasteBurstHeuristic` model (incl. `.9` Windows
  default-on), full 8-feature fork gate set, invariants/replant notes through
  `.10`, audit-guard updates (`audit_invariants.sh` + `audit_network_calls.sh`).
  Includes the `external/repos/codex-patched` gitlink bump to `b540ef30`.
- **Scope note:** the committed plan targeted `.8`; I extended it to current
  `.10` so the registry is accurate for the rebase. Both wrapper audits pass.
- codexu pointer bump + bookkeeping: `10270e0c`.

### 2. `.140` rebase plan (task `codex-upstream-rebase-to-0.140` → tracked, plan-shipped)
- Spawned `plan-rebase-139` (copilot, `/plan-with-ralph`). **Plan `77f0894a`**
  FF-merged to main: `plan.md` (530 lines) + `stories-outline.md` (7 stories) +
  `suggested-decomposition.json`, under
  `.ralph/jobs/codex-upstream-rebase-to-0.140/`.
- **Confirmed target: `rust-v0.140.0`** = commit `6506579001` (released
  2026-06-15). The operator's "0.139" was one minor stale (0.141.0 is
  alpha-only). Fork base `rust-v0.135.0` (`4daceea869`).
- **Forecast:** upstream delta 1,613 files / +121,670 / −38,372. 2 highest-risk
  REPLANTs (P2 remote-control 3-layer disable vs upstream's native managed
  disable #27961; P3 multi-agent tool registration vs the ToolExecutor refactor
  #27304/#27299 — the zone that caused the `.135` 30-error debt) + 4 more
  replants; ~15 conflicts (all 8 fork gates covered P1–P25); **6–9 debt-fix
  sub-tasks** concentrated in `core/src/tools/` (dominant), config, app-server,
  remote_control, tui, overlay-bridge. 2 OBSOLETE? flags
  (`close_agent`→`interrupt_agent` #26994; `cloud-requirements` moved #24621).
  Paste-burst + WindowsGitBashShell survive.
- Bookkeeping: `6633a03e` (plan-shipped card + impl seed).
- **Task renamed** `…-0.139` → `…-0.140` (id + job dir + refs): `2dd5ff99`.

## NEXT UP (for a fresh session): the `.140` rebase IMPL

The task `codex-upstream-rebase-to-0.140` is **plan-shipped, ready for impl**.

- **Plan:** `.ralph/jobs/codex-upstream-rebase-to-0.140/plan.md` (7 serial
  stories US-001→US-007).
- **Impl seed:** in `.ralph-overview/data.json` under
  `codex-upstream-rebase-to-0.140` → `command.prompts.impl` (also saved at
  `…/files/rebase139-impl-seed.txt`).
- **Shape:** SERIAL (a rebase is one dependency chain in one worktree). Drive
  `codex/.claude/commands/rebase-upstream.md` end-to-end: US-001 setup →
  US-002 squash-merge `rust-v0.140.0` + re-anchor every fork patch → US-003
  Phase 5a `cargo check --workspace` HARD GATE (file `codex-rebase-debt-fix-*`
  tasks for big clusters, resolve serially in-worktree) → US-004 static audits →
  US-005 release cut via `/publish-sandbox-patch` (version `0.140.0-copilot-api.1`) →
  US-006 closeout (gitlink + pointer bumps + Phase 5b CI/interim) → US-007 bookkeep.
- **MAJOR multi-hour, babysit-heavy effort** with an operator-gated release.
- **The release member MUST run on COPILOT** (a codex-engine release self-kills
  via the publish flow's stray-`codex.exe` cleanup — confirmed twice this arc).

## Operational notes / gotchas (IMPORTANT)

1. **`data-edit.mjs` needs `RALPH_OVERVIEW_PLUGIN_ROOT` pointed at the in-tree
   plugin.** The INSTALLED Copilot ralph-overview plugin is **2.8.1**, which
   LACKS the `data-edit` subcommand (errors `Unknown subcommand: data-edit`).
   The in-tree submodule plugin is **2.11.0** (the AGENTS.md-pinned version) and
   HAS it. For any `node tools/data-edit.mjs <verb> …`, first
   `$env:RALPH_OVERVIEW_PLUGIN_ROOT='D:/harness-efforts/codexu/ai-developer-toolkit/plugins/ralph-overview'`.
   **Follow-up worth doing:** `copilot plugin update` to bring the installed
   ralph-overview to 2.11.0 so this workaround isn't needed.
   - Helper can't rename a task id — for an id rename, do a count-asserting
     text-level script (see `…/files/rename-rebase-task.js`) + the JSON guard,
     NOT JSON.parse+stringify (that reformats the whole file).
   - `set-lifecycle <id> tracked --touched-at <iso>` is the way to refresh
     `lastTouchedAt` without changing lifecycle (the other verbs don't touch it).
2. **Codex release members MUST run on COPILOT, never codex** (self-kill — see above).
3. **codex-inner impls = direct-impl in the canonical checkout**
   (`codex/external/repos/codex-patched`), serialized on the accumulation
   branch; cargo via Git Bash `…/files/codex-cargo.sh`. The registry-refresh
   member was given a DIRECT-impl prompt (no `$skill` token) and implemented
   manually — desired.
4. **Multi-account pushes:** inner → `Evyatar108/codex-openai-fork` (gh switch
   to **Evyatar108**); wrapper → `gim-home/codex` (**evmitran_microsoft**, SAML);
   codexu → `origin` (evmitran_microsoft) + `personal` (Evyatar108). Always
   `gh auth switch --user <x>` then switch back to evmitran_microsoft.
5. **`data.json` discipline:** anchor on exact id; pre/post `JSON.parse` +
   task-count (289) + dup guard; stage `data.json` EXPLICITLY (NEVER `git add -A`
   — `M codex` pointer + untracked `generated/`/`.worktrees/` noise). data.json
   summary files written on Windows carry `\r\n` — fine (escaped in JSON).
6. **Listener:** arm INDEFINITELY (no `--timeout-ms`), async, shellId `listener`,
   re-arm as the FIRST tool call after every drain; the PreToolUse nag gives the
   exact `arm` + `review-mail` commands (positional name form:
   `review-mail overview-bookkeeper --crew ralph-pipeline --cwd …`).
7. **Two unrelated pre-existing dirty files** in the working tree
   (`.ralph/brainstorms/crews-roles-and-direct-operator-channel/selected-direction.md`,
   `.ralph/jobs/codex-nonblocking-bg-completion-surfacing/plan.md`) are from
   prior sessions — NOT mine, left untouched.

## Lead takeover (do this FIRST in the next session)

1. Rebind the lead (manifest may still point at THIS session id):
   `assign-role lead --crew ralph-pipeline --name overview-bookkeeper`
   (reads `COPILOT_AGENT_SESSION_ID` + `CREWS_STATE_CWD` env; REJECTS `--cwd`).
   Verify the lead manifest `sessionId` == your session, THEN arm.
   *(This session was a continuation, so the lead was already bound — a brand-new
   session must rebind.)*
2. Arm the listener INDEFINITELY (no `--timeout-ms`), async, shellId `listener`.
3. **NEVER `resume-crew --confirm`** on `ralph-pipeline` (mass-respawn footgun).

## Spawn / build helpers (in this session's files dir)

`C:/Users/evmitran/.copilot/session-state/c9a3990e-55c1-4ddb-b566-78cf0b64b6fa/files/`
- `spawn-from-file.js <name> <promptfile>` — spawns a **codex** member.
- `spawn-copilot-from-file.js <name> <promptfile>` — spawns a **copilot**
  member (release / heavy plan-brainstorm / investigation).
- `codex-cargo.sh` / `codex-cargo-release.sh` — Git Bash cargo helpers.
- `rebase139-impl-seed.txt` — the ready `.140` rebase impl prompt.
- `prompt-plan-rebase-139.txt`, `rename-rebase-task.js`, and the
  patch-surface ship inputs (`patchsurface-v11-*`).

> **A brand-new session MUST re-patch `SESSION_ID` in `spawn-from-file.js` +
> `spawn-copilot-from-file.js`** (they hard-code this session's id
> `c9a3990e-55c1-4ddb-b566-78cf0b64b6fa`) and copy them to its own files dir.

## Engine policy reminder

`CREWS_ENGINE=codex` is the User-level default → a bare spawn = codex. Use
`--engine copilot` (or `spawn-copilot-from-file.js`) for: release members
(self-kill), heavy multi-lens brainstorm/plan members, and read-only
investigations. Keep concurrent heavy multi-lens members to ~2.
