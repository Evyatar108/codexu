---
overviewTaskId: crews-target-engine-plugin-provisioning
---

## Direction
D-001 — Two-layer native-CLI-wrapper installer + discovery companion, with an explicit restart/respawn verdict. A lead/bookkeeper-invoked, ON-DEMAND crews command suite that installs a missing plugin into a target engine (copilot | claude | codex) by thinly wrapping each engine's NATIVE plugin CLI, and returns a structured verdict that tells the lead whether the target member must be respawned to actually see the new plugin. Operator-selected on 2026-06-08 (full all-three-engine scope).

## Goal
After this ships, a lead who notices a member's engine is missing a plugin (e.g. a codex member can't run `/plan-with-ralph` because only crews is installed in codex) can run a single crews command —
`/crews-install-plugin <plugin> --engine <copilot|claude|codex> [--version <v>] [--marketplace <name-or-localpath>]` —
that installs/refreshes the plugin via that engine's native installer, is idempotent (no-op when already at the right version), and returns a structured result
`{ status: installed|no-op|upgraded|failed, installedVersion, sourceVersion, enabled, installPath, marketplaceSource, restartRequired, currentThreadUsable }`
plus a clear, non-opaque human summary that states whether the blocked member needs a fresh-thread respawn. A discovery/verification companion lets the lead SEE installed/enabled/version/source before and after. The durable logic lives in a tested crews CLI subcommand; the skill is a thin wrapper. crews 3.12.1 -> 3.13.0.

## Scope

### In Scope
- **Two-layer surface.** A crews CLI subcommand (`tools/crews.js install-plugin`) owns the install logic and emits structured JSON; a thin `/crews-install-plugin` skill (+ `.copilot-plugin` Copilot mirror) collects intent, calls the CLI, and explains the result. Per-engine adapters live under `lib/plugin-provisioning/{copilot,codex,claude}.js` (or equivalent).
- **All three engines** (copilot, claude, codex), each a thin wrapper over the engine's NATIVE plugin CLI — never a reimplementation of cache/config writes (except the explicit claude fallback below).
  - **codex:** LOCAL-SOURCE marketplace ONLY — `codex plugin marketplace add <local-abs-path>` then `codex plugin add <id>@<marketplace>`. NEVER git-source (it triggers the codex auto-upgrade marketplace-corruption bug; see `.ralph/investigations/codex-git-marketplace-snapshot-tmp-ephemeral`). Handle local-source cache-version-LAG by re-running `codex plugin add` to re-copy current source into a new cache version subdir (PROVEN by the `codex-engine-ralph-member-enablement` spike). Verify via `codex plugin list` (reports STATUS+VERSION on codex 0.135) cross-checked against cache `~/.codex/plugins/cache/<mp>/<plugin>/<ver>/` + the `~/.codex/config.toml` plugin stanza.
  - **copilot:** `copilot plugin marketplace add <source>` (when the marketplace isn't already registered) then `copilot plugin install <id>@<marketplace>`. Verify via `copilot plugin list` + the single-copy install dir `~/.copilot/installed-plugins/<mp>/<plugin>/` (no version subdir).
  - **claude:** ensure the marketplace is registered + cache present and set `enabledPlugins["<plugin>@<marketplace>"]` in `~/.claude/settings.json`. Verify via cache `~/.claude/plugins/cache/<mp>/<plugin>/<ver>/` + the settings entry. (Plan must confirm whether a non-interactive claude CLI install exists; if not, the settings-edit path is the claude adapter — the one sanctioned direct-edit, clearly labelled.)
- **Idempotency + version.** Detect already-installed-at-right-version (no-op) vs install vs upgrade. `--version` defaults to MINIMUM-ACCEPTABLE (no-op if installed >= required) unless the plan justifies exact-match.
- **Explicit restart/respawn verdict (the load-bearing feature).** Because a freshly-installed plugin's skills/hooks only register in a FRESH engine thread, the result MUST carry `restartRequired` / `currentThreadUsable` and the human summary MUST tell the lead the exact respawn action for the blocked member. Restart is **REPORT-ONLY** — the command does NOT auto-restart a running member (hidden lifecycle changes are surprising; keep lead lifecycle explicit).
- **Discovery/verification companion** so the lead can see + verify state: per engine, for crews / ralph-orchestration / ralph-overview, report installed, enabled, installedVersion, sourceVersion, marketplaceSource, installPath.
- **Defaults.** `--marketplace` defaults to the `ai-developer-toolkit` local-source. `--engine` handling (require explicit vs caller-engine default) is a plan decision (see below).
- **Tests** for the provisioning lib + a version-bump test. crews `plugin.json` 3.12.1 -> **3.13.0**; `CHANGELOG.md` + `AGENTS.md` updated.

### Out of Scope
- **Auto-provision-on-spawn** — a possible FUTURE opt-in. Design the lib so a future spawn-time hook could reuse it, but do NOT build the hook now.
- **Direct config/cache reconciler as the DEFAULT path** (D-003) — only the narrow, clearly-labelled claude settings-edit fallback is sanctioned; never the default for codex/copilot.
- **`--verify-skills` that boots a fresh engine session** — optional/future. v1 verifies install-state via the list + cache + config cross-check.

## Criteria
- Running install for an already-correctly-installed plugin returns `status: "no-op"` and makes no changes (idempotent), verified by unchanged cache/config + `plugin list`.
- Installing `ralph-orchestration` into codex via the local-source marketplace yields `codex plugin list` reporting it installed+enabled at the source version, AND the result reports `restartRequired: true` / `currentThreadUsable: false` with an explicit "spawn a fresh codex thread/member" instruction.
- The codex adapter NEVER registers a git-source marketplace; a git-source request is refused with a message citing the auto-upgrade corruption bug.
- A codex install whose cache version lags the source is refreshed (re-run `codex plugin add`) so installedVersion matches sourceVersion, verified via the cache version subdir + `plugin list` VERSION.
- The copilot adapter installs/updates via native `copilot plugin install <id>@<mp>` and verifies via `copilot plugin list` + the install dir.
- The discovery surface reports, per engine for crews / ralph-orchestration / ralph-overview: installed, enabled, installedVersion, sourceVersion, marketplaceSource, installPath.
- A failed install returns `status: "failed"` with an actionable, non-opaque error (not a raw CLI dump) and does not leave the engine in a half-registered marketplace state (or documents/rolls back the partial state).
- crews `plugin.json` version is `3.13.0`; `CHANGELOG.md` + `AGENTS.md` updated; the provisioning lib has unit tests.

## Context

**Plan decisions to carry (lenses + operator lean noted):**
- **`--engine` required vs caller-engine default:** lean toward requiring `--engine` (or caller-default with a LOUD echo) — the blocked member is frequently a DIFFERENT engine than the lead, so a silent caller-default risks installing into the wrong engine.
- **Discovery surface:** standalone `/crews-list-plugins --engine X` vs an `install-plugin --status`/`--dry-run` mode vs both. Lenses are fine with a `--status`/`--dry-run` mode reused by a thin list skill; plan picks the exact surface.
- **Restart handling:** REPORT-ONLY respawn-required verdict vs an optional `--respawn-member <name>` follow-up. Lenses + operator lean **report-only** — keep member lifecycle explicit; an optional explicit follow-up is acceptable but not auto-restart.
- **claude install path:** confirm whether a non-interactive claude CLI install exists; if not, the `settings.json enabledPlugins` edit is the claude adapter (the one sanctioned direct-edit).

**Cross-lens spine (all 3 lenses agreed):** thin native-CLI wrappers (not reimplementation); two-layer CLI-subcommand-owns-logic + thin-skill; the explicit restart/respawn verdict is non-negotiable; a discovery/verification companion; a structured non-opaque result; codex local-source-only + cache-lag refresh; crews 3.13.0.

**Disconfirming observation (the test that matters):** a blocked codex member that can't run `/plan-with-ralph` — after the lead installs the plugin successfully, the SAME running member still can't see the skill until a fresh codex thread. If the design treats install-success as done without a prominent respawn-required verdict + a clear lead respawn action, it fails at the exact scenario it was built for.

**Key references:** `codex-engine-ralph-member-enablement` spike findings (`.ralph/jobs/codex-engine-ralph-member-enablement/findings.md`) for the proven codex local-source `plugin add` refresh mechanics; `.ralph/investigations/codex-git-marketplace-snapshot-tmp-ephemeral/findings.md` for the git-source corruption bug; codexu `AGENTS.md` for per-engine install-path knowledge. This advances the codex-as-member-engine readiness chain.
