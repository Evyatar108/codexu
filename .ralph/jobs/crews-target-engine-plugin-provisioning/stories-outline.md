# Stories Outline: crews `install-plugin` two-layer engine plugin provisioner (v3.14.0)

*Preliminary decomposition from `/plan-with-ralph`. Feed to `/implement-with-ralph --from-plan` for PRD generation. Single serial cluster; execute US-001 → US-008 in dependency order. Target repo: the `ai-developer-toolkit` submodule, `plugins/crews/`. Two-commit flow — the impl member commits the submodule branch; the LEAD bumps the codexu pointer + ships the wrapper ceremony.*

## US-001: Provisioning library scaffold
**Description:** As a crews maintainer, I want a pure, unit-testable provisioning library skeleton so the engine adapters and command modules build on a shared, tested foundation.
**Acceptance Criteria:**
- [ ] `lib/plugin-provisioning/version.js` provides a pure semver parse + compare (crews has no reusable semver helper) with unit tests (equal/greater/less, prerelease tolerance as needed).
- [ ] `lib/plugin-provisioning/command-runner.js` provides an injectable command runner seam (default `execFileSync`/`spawnSync` with argv arrays — never shell strings); tests inject a fake runner.
- [ ] `lib/plugin-provisioning/source.js` resolves (a) the marketplace source (explicit `--marketplace` name|abs-path > already-registered engine marketplace > default toolkit root via `hooks/paths.js::getPluginRoot()` walk-up) AND (b) plugin NAME → source dir via the marketplace index `plugins[].source` (e.g. `ralph-orchestration` → `plugins/ralph`); `sourceVersion` reads from `<resolved-source-dir>/.claude-plugin/plugin.json`. Unit-tested incl. the `ralph-orchestration` name≠dir case (`plugin-provisioning-source.test.js`).
- [ ] `lib/plugin-provisioning/index.js` exposes a `buildVerdict` skeleton with the per-status restart/usability table (no-op→false/true; installed|upgraded→true/false; failed→false/pre-action-usable).
- [ ] `node --check` passes on every new file; `node tests/run.js` green.
**Dependencies:** None
**Estimated complexity:** medium

## US-002: Codex adapter
**Description:** As a lead, I want a codex engine adapter that installs/refreshes a plugin via the native codex CLI, local-source-only, so a codex member can gain a missing plugin safely.
**Acceptance Criteria:**
- [ ] `adapters/codex.js` exposes `detectCurrentState`/`installOrUpgrade`/`verify` using `codex plugin marketplace add <local-abs-path>` + `codex plugin add <plugin>@<mp>` + `codex plugin list`, via the injected runner.
- [ ] A git/URL `--marketplace` is REFUSED with an actionable error citing the auto-upgrade corruption bug; ZERO `marketplace add` calls recorded (AC3).
- [ ] Cache-lag refresh: when the installed/cache version < source version, re-running `codex plugin add` updates the cache version subdir so `installedVersion == sourceVersion` (AC4), tested against a fake `~/.codex` tree.
- [ ] Verify cross-checks `~/.codex/plugins/cache/<mp>/<plugin>/<ver>/` + the `~/.codex/config.toml` stanza.
- [ ] Unit tests (`plugin-provisioning-codex.test.js`) cover AC2/AC3/AC4 with injected runner + fake home; `node --check` passes.
**Dependencies:** US-001
**Estimated complexity:** large

## US-003: Copilot adapter
**Description:** As a lead, I want a copilot engine adapter wrapping the native copilot CLI so a copilot member can gain a missing plugin.
**Acceptance Criteria:**
- [ ] `adapters/copilot.js` installs/updates via `copilot plugin marketplace add <source>` (when needed) + `copilot plugin install <plugin>@<mp>` and verifies via `copilot plugin list` + the single-copy install dir `~/.copilot/installed-plugins/<mp>/<plugin>/` (AC5).
- [ ] Unit tests (`plugin-provisioning-copilot.test.js`) assert argv + verification against a fake `~/.copilot` tree; `node --check` passes.
**Dependencies:** US-001
**Estimated complexity:** medium

## US-004: Claude adapter
**Description:** As a lead, I want a claude engine adapter using the native `claude plugin` CLI (with a narrow settings.json enable-only fallback) so a claude member can gain a missing plugin.
**Acceptance Criteria:**
- [ ] `adapters/claude.js` installs via `claude plugin install <plugin>@<mp> --scope user` + `claude plugin enable` and detects via `claude plugin list --json`, correctly handling the SAME plugin listed under both `user` and `project` scopes (keys on user scope, surfaces a conflicting project-scoped entry); verdict carries resolved `scope` (AC6).
- [ ] CLI-absent (ENOENT) fallback ENABLES an already-cached version via the `~/.claude/settings.json` `enabledPlugins` edit (cannot populate cache); when not cached → `status:failed` with an actionable "claude CLI required to install/populate cache" message (AC6).
- [ ] Unit tests (`plugin-provisioning-claude.test.js`) cover duplicate-scope list, enable-from-cache fallback, and no-cache failure against fake `~/.claude`; `node --check` passes.
**Dependencies:** US-001
**Estimated complexity:** large

## US-005: Orchestrator + verdict assembly
**Description:** As a lead, I want `installPlugin`/`listPlugins`/`buildVerdict` so the structured no-op/install/upgrade/failed verdict (with the report-only restart semantics) is assembled consistently across engines.
**Acceptance Criteria:**
- [ ] `installPlugin(opts)`: resolve source → detect → decide no-op (installed≥required) vs install vs upgrade (`--version` minimum-acceptable; `--exact` opt-in) → mutate+verify → assemble verdict; idempotent no-op makes NO changes (AC1).
- [ ] `--exact <v>` whose `v` ≠ `sourceVersion` and not already installed ⇒ `status:failed` with an actionable message; no mutating call (AC11).
- [ ] A failed install ⇒ `status:failed` with a non-opaque error, documents partial marketplace-registration state, `restartRequired:false`, and `currentThreadUsable` false unless the plugin was already installed+enabled (AC8).
- [ ] `listPlugins(opts)` reports per-plugin `{installed, enabled, installedVersion, sourceVersion, marketplaceSource, installPath}` for crews/ralph-orchestration/ralph-overview, sourceVersion via the marketplace-resolved dir (AC7).
- [ ] Unit tests (`plugin-provisioning-orchestrator.test.js`) cover AC1/AC8/AC11 + restart verdicts with injected adapters; `node --check` passes.
**Dependencies:** US-001, US-002, US-003, US-004
**Estimated complexity:** large

## US-006: `install-plugin` command module
**Description:** As a lead, I want a registered `install-plugin` crews command (operator-trust) that wraps the orchestrator and emits the JSON verdict.
**Acceptance Criteria:**
- [ ] `hooks/commands/install-plugin.js` exports the registry command shape (slash auth `active-lead-session`, cli auth `open` with handler-side lead enforcement); registered in `hooks/commands/registry.js`. `<plugin>` positional; `--engine` REQUIRED (errors with usage when absent); `--version`/`--marketplace`/`--dry-run`/`--exact` flags; `formatSuccess` emits the JSON verdict.
- [ ] `--dry-run` returns the would-be verdict (status enum + `dryRun:true`) with ZERO mutating runner calls (AC9).
- [ ] Auth: slash rejects a non-lead; CLI requires `--as <lead>`/in-session lead auto-resolve, rejecting missing/invalid lead (AC12).
- [ ] Update the hard-coded `listCommands('lead')` array in `tests/command-registry-shape.test.js` and add the `tests/command-args-parity.test.js` row IN THIS STORY (registry change + test arrays land together).
- [ ] Command tests (`install-plugin-command.test.js`) cover `--engine`-required, `--dry-run` no-mutation, and non-lead/missing-`--as` rejection; `node --check` passes.
**Dependencies:** US-005
**Estimated complexity:** medium

## US-007: `list-plugins` command module + skill generation
**Description:** As a lead, I want a read-only `list-plugins` discovery command plus the generated skills for both new commands, so I can see per-engine plugin state and the slash commands are registered.
**Acceptance Criteria:**
- [ ] `hooks/commands/list-plugins.js` (read-only; roleVisibility `['member','lead']`, auth `open`/`any-actor`) requires `--engine` and reports the AC7 discovery shape; registered in `registry.js`.
- [ ] Run `node scripts/gen-skills.js` ONCE (after BOTH commands registered) → emits `skills/install-plugin/SKILL.md`, `skills/list-plugins/SKILL.md`, and the two `.copilot-plugin/copilot-skills/.../SKILL.md` mirrors; `node scripts/gen-skills.js --check` reports no drift (asserted in a test).
- [ ] Update the hard-coded `listCommands('member')`/`listCommands('lead')` arrays in `tests/command-registry-shape.test.js` for `list-plugins` in this story.
- [ ] `CREWS_PROVISIONING_LIVE=1`-gated live smoke runs `list-plugins`/`install --dry-run` against the real engine CLI and asserts the JSON verdict shape (skipped by default) (AC13).
- [ ] Command tests (`list-plugins-command.test.js`) cover the discovery report (mocked adapters) incl. the ralph-orchestration source resolution; `node --check` passes.
**Dependencies:** US-005, US-006
**Estimated complexity:** medium

## US-008: Ship prep — version bump + docs
**Description:** As a maintainer, I want the crews version bumped and docs updated so the release is consistent and the new feature is documented.
**Acceptance Criteria:**
- [ ] `node plugins/crews/scripts/bump-version.js 3.14.0` (run from the `ai-developer-toolkit` submodule root) updates the 6 version files + the `tests/version.test.js` literal; `tests/version.test.js` asserts `3.14.0` across all 6 (AC10).
- [ ] `CHANGELOG.md` gets a prepended `## 3.14.0 - <date>` entry describing the install-plugin/list-plugins feature.
- [ ] `AGENTS.md` (the crews submodule AGENTS.md) gets a v3.14.0 section documenting the provisioning lib, adapters, the structured verdict, the report-only restart semantics, and the common-mistake gotchas.
- [ ] Full `node tests/run.js` green; `node scripts/gen-skills.js --check` no drift; `node --check` on all changed `.js`.
- [ ] Do NOT edit the codexu root `AGENTS.md`/`CLAUDE.md` or the codexu submodule pointer (LEAD owns those + the active-plugin-versions table after merge).
**Dependencies:** US-001, US-002, US-003, US-004, US-005, US-006, US-007
**Estimated complexity:** small
