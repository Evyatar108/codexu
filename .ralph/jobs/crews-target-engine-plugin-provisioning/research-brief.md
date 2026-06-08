# Research Brief: crews install-plugin (v3.14.0)

Source tree for crews (submodule, initialized in PRIMARY checkout, NOT the plan worktree):
`D:/harness-efforts/codexu/ai-developer-toolkit/plugins/crews/`

## Researcher Findings

### CLI subcommand registration mechanism
- `hooks/commands/registry.js` — `COMMAND_DEFINITIONS` array: `{ name, aliases, load: () => require('./<name>') }`. Add new command here. `findCommand()`, `getAllCommands()`, `COMMANDS` getter. Visibility gate checks `roleVisibility`, `surfaces.slash.enabled`, `requiredCapabilities`.
- `hooks/commands/runtime.js` — `runCliCommand(name, argv, io, opts)`: help → parse → createContext → auth → handler → stdout/stderr formatting → exit code. `dispatchSlashCommand(prompt, ctx)` for slash.
- `tools/crews.js` — dispatcher: `arm` → runListenerLoop, else runCliCommand. cliSubcommands() filters `surfaces.cli.enabled === true`.

### Command module shape (exemplar: hooks/commands/list-members.js)
```
module.exports = {
  name, aliases: [], description, usage,
  roleVisibility: ['member','lead'],
  surfaces: {
    slash: { enabled, auth, parseArgs, formatSuccess, formatError },
    cli:   { enabled, auth, usage, parseArgs, createContext, formatSuccess, formatError }
  },
  handler   // handler(ctx, args) -> result object
};
```
- `formatSuccess(result)` returns the stdout string. **JSON output**: `return JSON.stringify(result.rows, null, 2)` (list-members.js:58-61). spawn-member CLI returns `{ ok, name, crew, pid, note }` JSON (spawn-member.js:204-215).
- Arg parsing via `parseCrewArgs(argv, { flags: { name:{type,alias} } })` from `tools/lib/parse-crew-args.js`.
- Errors: `CommandInputError` from `./errors` (also re-exported from `./helpers`).
- `createCliContext(args)` → `RuntimeContext.fromCli({ stateCwd, crew })`.

### Child-process / native-CLI invocation (spawn-member.js + hooks/actors.js)
- spawn-member calls `spawnMember(...)` from `../config`. The actual launcher/process logic lives in `hooks/actors.js` (`buildLauncherCommand`, `buildLauncherInvocation`, `spawnMember`, `describeProcess` returns commandLine, `ENGINE_BINARIES`, process-tree helpers via CIM/taskkill).
- Engine detection: `hooks/lib/session-env.js::readSessionEnv()` 3-way tiebreak; `hooks/actors.js` `CREWS_ENGINE` precedence (existing > opts.engine > process.env.CREWS_ENGINE > 'claude'); `VALID_ENGINES = ['claude','copilot','codex']`, `normalizeEngine()`.

### Structured JSON output conventions
- CLI commands emit one formatted stdout payload via `formatSuccess`; errors to stderr. JSON-emitting: list-members, spawn-member. `--json`/`--pretty` flag pattern in list-members (json wins, disables pretty).

### Skill structure — GENERATED, do not hand-edit
- `scripts/gen-skills.js` reads `COMMANDS` from registry and generates `skills/<name>/SKILL.md` (Claude) + `.copilot-plugin/copilot-skills/<name>/SKILL.md` (Copilot kebab `/crews-<name>`). Header: `<!-- GENERATED FROM hooks/commands/registry.js — DO NOT HAND-EDIT -->`.
- Special sets in gen-skills.js: `NO_SKILL_COMMANDS` (review-mail — no SKILL.md surface), `CLI_ONLY_MUTATING_COMMANDS` (bootstrap-crew — CLI-only body, no slash), `SLASH_ONLY_SKILL_COMMANDS` (empty).
- Uses each command's `name`, `description`, `usage`, `surfaces`. **After registry change → run `node scripts/gen-skills.js`.**
- `.codex-plugin/` has ONE manifest (`.codex-plugin/plugin.json`) + `hooks/hooks.json`; NO per-skill files in v1 (21-skill codex overlay deferred). So a new command does NOT need a codex skill file — only Claude + Copilot generated skills.

### Test infrastructure (Windows)
- Runner: `tests/run.js` — fresh Worker per test file, default concurrency 10, serial denylist for race-sensitive files, per-worker env scrub (incl. CREWS_*, agent-session env) + per-worker temp HOME/USERPROFILE/CREWS_HOME.
- Run: `cd plugins/crews && node tests/run.js` (~40-60s Windows). Save to file: `node tests/run.js 2>&1 | tee /tmp/crews-tests.out`.
- Test helpers: `tests/lib/assert.js` (equal, ok), `tests/lib/repo-checks.js` (read), `tests/lib/with-session-env.js` (withSessionEnv/withCopilotEnv), `tests/lib/force-response.js` (runStop), `lib/scenario.js`.
- Example command tests: command-compat-spawn-member.test.js, command-registry-shape.test.js (pins roleVisibility/enabled surfaces/listCommands order), command-args-parity.test.js (slash/CLI parity), command-side-effect-coverage.test.js.
- Typecheck (JS-only, no tsconfig): `node --check <file.js>`.

### Version-bump mechanics (7 stamps)
- `node plugins/crews/scripts/bump-version.js <x.y.z>` run from **ai-developer-toolkit submodule root** (script resolves repoRoot 3 levels up from scripts/). Writes: 3 plugin manifests (`.claude-plugin/plugin.json`, `.github/plugin/plugin.json`, `.codex-plugin/plugin.json`), 3 marketplace indexes (`.claude-plugin/marketplace.json`, `.github/plugin/marketplace.json`, `.agents/plugins/marketplace.json`), and the `const VERSION = '...'` literal in `tests/version.test.js`.
- `tests/version.test.js` asserts all 6 files carry the version + the literal. `lib/version.js` reads `.claude-plugin/plugin.json` version (cached) → used by collapse log line.
- CHANGELOG.md entry prepended (`## 3.14.0 - <date>`).
- **TARGET: 3.13.0 → 3.14.0** (3.13.0 already shipped; brainstorm seed's "3.13.0" is STALE).

### Engine install-path knowledge (codexu AGENTS.md + spike findings)
- codex: LOCAL-SOURCE ONLY — `codex plugin marketplace add <local-abs-path>` then `codex plugin add <id>@<mp>`. NEVER git-source (auto-upgrade corruption). Cache: `~/.codex/plugins/cache/<mp>/<plugin>/<ver>/`; config stanza in `~/.codex/config.toml`; verify `codex plugin list` (STATUS+VERSION on 0.135). Cache-lag refresh: re-run `codex plugin add` to copy current source to new cache version subdir.
- copilot: `copilot plugin marketplace add <source>` then `copilot plugin install <id>@<mp>`. Verify `copilot plugin list` + `~/.copilot/installed-plugins/<mp>/<plugin>/` (single copy, no version subdir).
- claude: `~/.claude/settings.json` enabledPlugins + cache `~/.claude/plugins/cache/<mp>/<plugin>/<ver>/`. (Confirm if non-interactive claude CLI install exists; else settings-edit is the sanctioned adapter.)
- Reference findings: `.ralph/jobs/codex-engine-ralph-member-enablement/findings.md` (proven codex local-source refresh), `.ralph/investigations/codex-git-marketplace-snapshot-tmp-ephemeral/findings.md` (git-source corruption bug).

### Reusable lib modules (CommonJS throughout)
- `lib/version.js` (getPluginVersion/getPluginRoot), `lib/collapse-key.js` (pure hash/env helpers), `lib/listener-loop.js`. All `module.exports`/`require()`.
- Proposed new: `lib/plugin-provisioning/{copilot,codex,claude}.js` + shared orchestrator (`index.js`).

## Architect Analysis

### Integration points (create vs modify)
- CREATE: `hooks/commands/install-plugin.js` (+ maybe `list-plugins.js`), `lib/plugin-provisioning/{copilot,codex,claude}.js` + orchestrator `index.js`, generated skill files.
- MODIFY: `hooks/commands/registry.js` (add entry), version stamps (via bump-version.js), CHANGELOG.md, AGENTS.md (submodule), `tests/` (new test files), `tests/command-registry-shape.test.js` + `tests/command-args-parity.test.js` (new command rows), possibly `tests/version.test.js` literal (via script).
- `tools/crews.js` dispatcher needs NO change (registry-driven). gen-skills.js needs NO code change unless install-plugin needs a special skill-set classification (e.g. discovery vs mutating).

### Adapter contract (proposed)
Each adapter exposes: `detectCurrentState({plugin, marketplaceSource, version})`, `installOrUpgrade({plugin, marketplaceSource, version, sourcePath})` (idempotent), `verify({plugin, installPath, expectedVersion})`.
Shared orchestrator: detect → compare versions → decide no-op/install/upgrade → assemble verdict. Sets `restartRequired=true, currentThreadUsable=false` on real install/upgrade; `false`/`true` on no-op.
Verdict: `{ status: installed|no-op|upgraded|failed, installedVersion, sourceVersion, enabled, installPath, marketplaceSource, restartRequired, currentThreadUsable }` + human summary.

### Idempotency + versioning
- `--version` defaults to MINIMUM-ACCEPTABLE: no-op if installed >= required. Source version from marketplace local-path plugin.json. Edge: codex cache-lag where `plugin list` VERSION < source → refresh.

### Failure/partial-state
- status:"failed" with actionable (non-opaque) error; never leave half-registered marketplace; identify rollback points (marketplace added but plugin add failed) → roll back or document.

### Discovery surface decision (architect recommends)
- Primary: `install-plugin --status` / `--dry-run` (reuse detectCurrentState). Add standalone `list-plugins` only if needed later — don't duplicate logic now.

### --engine required vs caller-default (architect recommends)
- Recommend REQUIRED. Blocked member is often a different engine than the lead. Engine detection prior-art: `hooks/actors.js` caller-engine detection + `CREWS_ENGINE` precedence; session-start shims.

### Risk areas / constraints
- Windows PATH/bash quirks; ~/.codex vs ~/.copilot vs ~/.claude home resolution. Native CLI output parsing fragile → prefer cache/config cross-check over text-only `plugin list`. Non-interactive invocation (do codex/copilot/claude prompt? need non-interactive flags). Concurrency with a running member (restart is REPORT-ONLY, never auto).

### Test strategy
- Unit-testable: orchestrator decisions, version compare, adapter state detection, rollback with mocked CLI + fake home dirs / injected fs seams. Integration smoke: one real install per engine (gated).

## Codex Research (key NEW facts)
- **Claude HAS a non-interactive CLI install path** (verified from local CLI help): `claude plugin marketplace add <source> --scope user`, `claude plugin install <plugin>@<marketplace> --scope user`, `claude plugin list --json`, `claude plugin enable`. → claude adapter uses the native CLI as PRIMARY; settings.json edit is a documented FALLBACK only.
- Codex/Copilot native CLIs confirmed: `codex plugin marketplace add <SOURCE>` / `codex plugin add <p>@<mp>` / `codex plugin list`; `copilot plugin marketplace add <source>` / `copilot plugin install <p>@<mp>` / `copilot plugin list`.
- **Live cache-lag case exists NOW**: crews source/manifests are 3.13.0 but local codex lists crews@ai-developer-toolkit at 3.12.1 — a real fixture/manual-smoke target for the codex cache-lag refresh AC.
- **Codex skill discoverability**: crews `.codex-plugin/plugin.json` wires HOOKS ONLY (no `skills` block, unlike ralph's codex overlay). So `/crews-install-plugin` is callable on a codex member via UserPromptSubmit hook interception — NO codex skill file needed. Adding codex-skill discoverability would be a separate `.codex-plugin` change → OUT OF SCOPE.
- Proposed lib: `lib/plugin-provisioning/index.js` (orchestrate installPlugin/listPlugins), `version.js` (semver comparator — crews has NO reusable semver helper, must build+test), `source.js` (resolve default marketplace: explicit path > configured engine marketplace > `<stateCwd>/ai-developer-toolkit`), `adapters/{codex,copilot,claude}.js`. **Use injected command runners; argv arrays with spawnSync/execFileSync, NOT shell strings.**
- More exemplars: `hooks/commands/inbox.js` (CLI-only structured-JSON command), `hooks/commands/auth-policies.js` (operator/lead auth policies), `hooks/user-prompt-submit.js` + copilot/codex shims (slash normalization `/crews:<cmd>` Claude, `/crews-<cmd>` Copilot/Codex).
- Tests to cover: source manifest parsing, no-op idempotency, codex git-source refusal, codex cache-lag refresh, claude `plugin list --json` parsing, copilot single-copy install-dir verification, restart verdicts, command-registry shape, generated-skill drift via `node scripts/gen-skills.js --check`.
- Slash form `--marketplace` default to local-source; `--engine` REQUIRED. Codex leans toward a SEPARATE `list-plugins` command (simpler operator/skill text) over only `--status`.

## Copilot Research (corroboration)
- Confirms: JS-only, no package.json; `tools/crews.js` dispatcher; registry-driven commands; 3 plugin manifests + 3 marketplace indexes; gen-skills.js + bump-version.js. install/list commands do NOT yet exist.
- Confirms codex local-source-only + git-source refusal + cache-lag refresh; copilot native CLI; claude settings.json fallback if no CLI (codex lens supersedes: claude CLI DOES exist).
- Recommends: pure provisioning layer `lib/plugin-provisioning/{codex,copilot,claude}.js` + shared version/path helpers + injectable command runner for tests; `--engine` required; `--marketplace` default local `ai-developer-toolkit`; mock CLI/cache/config in tests (avoid real engine installs); update registry-shape tests, generated skills, CHANGELOG, AGENTS.md.
- `hooks/paths.js::getPluginRoot()` + home-path conventions are the path helpers to reuse.

## Consolidated File List
### Files to create
- hooks/commands/install-plugin.js
- lib/plugin-provisioning/index.js (orchestrator) + copilot.js + codex.js + claude.js
- tests/install-plugin.test.js (+ adapter unit tests, version-stamp coverage)
- (generated) skills/install-plugin/SKILL.md + .copilot-plugin/copilot-skills/install-plugin/SKILL.md

### Files to modify
- hooks/commands/registry.js (add install-plugin entry)
- 3 plugin.json + 3 marketplace.json + tests/version.test.js (via scripts/bump-version.js 3.14.0)
- CHANGELOG.md (prepend 3.14.0)
- AGENTS.md (submodule — add v3.14.0 section)
- tests/command-registry-shape.test.js + tests/command-args-parity.test.js (new command rows)
- scripts/gen-skills.js ONLY if install-plugin needs a special skill classification set

### Reference (read-only)
- .ralph/jobs/codex-engine-ralph-member-enablement/findings.md
- .ralph/investigations/codex-git-marketplace-snapshot-tmp-ephemeral/findings.md
- codexu AGENTS.md (per-engine install paths)

## Submodule / worktree notes
- This is a SUBMODULE task (ai-developer-toolkit/plugins/crews). Two-commit flow: commit submodule first, then codexu pointer bump. Impl member commits on `ralph/<task>` topic branch in a submodule worktree; LEAD merges + bumps pointer + ships wrapper ceremony.
- Impl members must NOT edit codexu root AGENTS.md/CLAUDE.md or the parent submodule pointer.
- Skip Ralph Phase 5c (security) by default per repo AGENTS.md unless ACs mention auth/secrets/crypto (this task does not).
