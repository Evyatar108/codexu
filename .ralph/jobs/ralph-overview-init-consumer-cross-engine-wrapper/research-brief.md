# Research Brief — ralph-overview-init-consumer-cross-engine-wrapper (D-001)

Seeded from brainstorm: `.ralph/brainstorms/ralph-overview-init-consumer-cross-engine-wrapper/selected-direction.md` (D-001, shipped @ ced2085d).

Streams: researcher (Explore), architect (Explore), Copilot xhigh, Codex xhigh. All four converged; Codex added four plan-shaping constraints (below) that the others missed.

## Researcher Findings (file inventory, cited)

### Plugin repo (`ai-developer-toolkit/plugins/ralph-overview/`)
- `scripts/init-consumer.mjs` — `PACKAGE_SCRIPTS` (`:10-15`) hard-codes `node $CLAUDE_PLUGIN_ROOT/ralph-overview/bin/ralph-overview.mjs <sub> --repo .` for 4 scripts (`overview`→dev, `overview:build`→build, `sync-ralph-state`→sync, `sync-ralph-state:watch`→watch). `initConsumer()` (`:28-76`) plans ops then writes each one-by-one (`:43-63`) — best-effort, NOT all-or-nothing. `planOperations` (`:78-116`), `planTemplate` literal copy + overwrite/skip gate (`:126-137`), `planPackageJsonScripts` spread-merge over existing (`:155-165`). All writes via `atomicWriteFile`.
- `bin/ralph-overview.mjs` (dispatcher) — routes `init|install-server|sync|watch|dev|build|mcp|cli` (`:18-59`); `runInit` forwards `addPackageJsonScripts,force,serverOnly,legacyLayout` (`:62-83`); `cli derive-next-command` → `scripts/lib/derive-next-command-cli.mjs` (`:50-56`).
- `scripts/lib/atomic-write.mjs` (`:8-31`) — per-file atomic (tmp+fsync+rename-with-retry). No multi-file transaction; on failure deletes its own tmp only.
- `scripts/lib/resolve-config.mjs` — config path precedence: explicit `configPath` > `OVERVIEW_CONFIG_PATH` (repoRoot-relative) > new default `.ralph-overview/config.json` > legacy `.ralph/overview-config.json` (`:38-60`). **Array merge REPLACES, not appends** (`:105-116`); `watcher.ignored` copied wholesale (`:184-187`). Tolerates unknown keys.
- `scripts/lib/default-config.mjs` (`:1-58`) — default keys: dataFile, ralphRoot, crewsRoot, ralphSubdirs, outputs, recommendations, lockFile, watcher.ignored.
- `templates/overview-config.template.json` (`:1-66`) — the `.ralph-overview/config.json` scaffold. NO wrapper-resolver keys today (no additionalProbePaths / localDevPluginRootRel / cliDefaults).
- `scripts/lib/derive-next-command-cli.mjs` — defaults snapshot to `plans/overview-snapshot.json` unless `--snapshot` supplied → codexu injects `<repo>/.ralph-overview/generated/snapshot.json`.

### codexu repo
- `bin/ralph-overview.mjs:16-170` — resolver cascade (RALPH_OVERVIEW_PLUGIN_ROOT → CLAUDE_PLUGIN_ROOT/<plugin> → CLAUDE_PLUGIN_ROOT/cache/<mkt>/<plugin>/<latest> → ~/.claude/.../<latest> → ~/.copilot/installed-plugins/<mkt>/<plugin> → in-tree submodule). **BUG #1**: `existsPluginAt` requires `node_modules/chokidar` (`:53-56`). **BUG #2**: `newestVersionedSubdir` lexical `entries.sort()` (`:58-68`) → 2.10.0 < 2.9.0. Codexu deltas: `withCodexuCliDefaults` `--snapshot` injection (`:159-170`); script-relative submodule local-dev fallback (`:95-103`). Already wires `OVERVIEW_CONFIG_PATH` to child env when config exists (`:146-153`).
- `package.json:11-16` — SIX scripts call `node bin/ralph-overview.mjs ...` (overview, overview:dev, overview:build, overview:build:preview, sync-ralph-state, sync-ralph-state:watch) — already point at LOCAL `bin/`, NOT `$CLAUDE_PLUGIN_ROOT`. Plugin manages only 4 of these.
- `AGENTS.md` — active-plugin-versions table, ralph-overview pinned `2.8.1` (between BEGIN/END markers).
- `.gitignore` — `/bin` is NOT ignored (wrapper-retirement task removed it); only `.ralph-overview/config.local.json` + generated lock files are ignored.

### Test surfaces
- Run via `npm run test:lib` (Vitest) + MCP + viewer. Lib tests in `scripts/lib/*.test.mjs` and `scripts/lib/__tests__/`.
- Hermetic patterns to copy: `resolve-config.test.mjs` (`fs.mkdtempSync(os.tmpdir())` + afterEach cleanup + fake git worktree), `__tests__/resolveConfig.legacyFallback.test.mjs` (env save/restore + console.warn spy), `derive-next-command-cli.test.mjs` (`spawnSync` subprocess CLI test).
- MCP init coverage in `tools/overview-mcp/src/__tests__/init-consumer.test.ts` (force/conflict, CLI/MCP parity) — natural place for atomicity + emitted-wrapper-op parity tests.

### Versioning surfaces (6, must move in lockstep)
1. `plugins/ralph-overview/.claude-plugin/plugin.json` (`2.8.1`→`2.9.0`)
2. `.claude-plugin/marketplace.json` (`:95-99`)
3. `.github/plugin/marketplace.json` (`:95-99`)
4. `.agents/plugins/marketplace.json` (`:180-190`, Codex format with policy+category)
5. codexu `AGENTS.md` active-plugin-versions table
6. `plugins/ralph-overview/CHANGELOG.md` (Unreleased→2.9.0 block)
- `docs/installation.md` + AGENTS.md invariant #4 wording also updated.
- `tools/validate-codex-marketplace-policy.mjs` guards the .agents enum (release Pre-flight runs it).

## Architect Analysis (recommendations)
1. **Template self-contained** (no plugin import at runtime). Marketplace+plugin names via **emit-time substitution** in init-consumer (planTemplate currently literal → add a substitution variant).
2. **Atomicity** = plan-all-then-write with commit-style staging (write all to temp, then rename-commit) above existing writers. Single `initConsumer` transaction layer; don't make each helper transactional.
3. **`addPackageJsonScripts`** — keep flag NAME, change meaning to coupled "wrapper+scripts" bundle. Callers: `tools/overview-mcp/src/tools/init.ts:24-26`, `schemas.ts:17-22`, `initConsumer` default false, CLI `runInit`.
4. **Liveness** = manifest+dispatcher. deps-missing → select + dispatch anyway + precise diagnostic ("installed but dependencies missing — run `copilot plugin update`/`npm install` in <pluginRoot>"). Keep exit 2=total-miss, 3=found-but-no-dispatcher; NO new hard-fail code for deps-missing.
5. **RECONCILIATION → DIAGNOSTIC-ONLY**; archive sibling `ralph-overview-wrapper-auto-bootstrap-deps` as superseded. Auto-install footguns: network/time surprise, offline failure, lockfile/`npm ci` drift, reinstall-loop risk; chokidar is watch-only so one-shot `sync` shouldn't pay an install tax.
6. **Config schema** — emitted wrapper reads `.ralph-overview/config.json` itself (minimal JSON read, since it can't `loadConfig()` before finding plugin). Add `additionalProbePaths`, `localDevPluginRootRel`, generic `derive-next-command --snapshot` hook. Require `overview-init --diff`/dry-run validation against codexu.
7. **Dual-repo split → TWO Ralph jobs**: (A) plugin ship (template+init-consumer+tests+v2.9.0+marketplace+CHANGELOG+docs), (B) codexu adoption (`overview-init --force` + active-plugin-versions). B depends on A shipping + marketplace bump. Submodule two-commit flow; `/bin` gitignore watch; CRLF/Windows path hazards.

## Copilot xhigh (additions)
- Add `templates/consumer-ralph-overview.mjs`; export `resolvePluginRoot({ env, homedir, cwd, config })` + ESM main guard so tests exercise the exact emitted source.
- New `PACKAGE_SCRIPTS` form: `node bin/ralph-overview.mjs <sub> --repo .`. Add ONE grouped planner op emitting wrapper + package.json together; preflight the group before writing.
- Concrete config shape: a root `consumerWrapper` object → `{ additionalProbePaths, localDevPluginRootRel, cliDefaults: { deriveNextCommandSnapshotRel } }`. Update template + docs to classify these as generated consumer-boundary settings.
- Semver compare implemented inline (no runtime dep) in the template.
- Test the TEMPLATE directly (not a reimplementation): fake plugin layouts for Claude-direct, Claude-cache, user-cache, Copilot-install, missing-dispatcher, all-miss, semver `2.10.0 > 2.9.0`, Copilot-missing-node_modules. Extend init parity so CLI/MCP/shared engine report identical wrapper/script ops.

## Codex xhigh — four plan-shaping constraints (NET-NEW, high value)
1. **`templates/overview-config.schema.json` has `additionalProperties: false`.** The runtime loader tolerates unknown root keys, but the JSON schema REJECTS them. Any new config hook key (`consumerWrapper` / `additionalProbePaths` / `localDevPluginRootRel`) MUST be added to `overview-config.schema.json` or consumer config validation breaks. (Cited `:43`.)
2. **Fix `derive-next-command-cli.mjs` default at the SOURCE instead of carrying a wrapper `--snapshot` hook.** Codex: default the CLI's snapshot to `loadConfig().outputs.snapshot` (= `.ralph-overview/generated/snapshot.json`) rather than the stale `plans/overview-snapshot.json`. This makes codexu's bespoke `--snapshot` injection UNNECESSARY — collapsing codexu's non-generic deltas from TWO to ONE (`localDevPluginRootRel` only). Prefer the source fix; if a per-consumer override is still wanted, use an allowlisted config key, NOT arbitrary argument injection. This materially strengthens the "generic wrapper replaces codexu's" goal.
3. **`overview-init --diff` does NOT exist today.** CLI `init` supports `--add-package-json-scripts`, `--dry-run`, `--json` only. The brainstorm's `--diff` validation must either use the existing `--dry-run` (preferred — already there) or add a thin `--diff` flag. Don't assume `--diff` exists.
4. **`launch.cjs` stages only `scripts`, `tools`, `package.json` into the MCP build cache — NOT `templates/`.** init-consumer resolves pluginRoot via `RALPH_OVERVIEW_PLUGIN_ROOT` (set by launch.cjs to the REAL plugin tree), so existing templates resolve fine; the new `templates/consumer-ralph-overview.mjs` inherits that. But the plan must include an AC verifying the emitted-wrapper template is reachable at MCP-driven `overview.init` emit-time (not only direct-CLI).

Codex also recommends: build the template by THINNING codexu's existing `bin/ralph-overview.mjs` (not from scratch); keep `resolvePluginRoot({env,homedir,cwd,config})` pure + exported with a script guard; tiny local semver comparator; if package.json is missing skip BOTH wrapper+scripts (atomic pair); CLI spawn tests for exit 2/3 + signal/exit-code forwarding + `--repo` defaulting; gate ship on `npm test`, `npm run typecheck`, `validate-codex-marketplace-policy.mjs`, and a codexu dry-run smoke.

## Consolidated File List
**Plugin (Job A):** scripts/init-consumer.mjs; bin/ralph-overview.mjs; scripts/lib/atomic-write.mjs (maybe extend / new transaction helper); templates/consumer-ralph-overview.mjs (NEW); templates/overview-config.template.json; scripts/lib/resolve-config.mjs (+ schema doc); new template test (scripts/lib/__tests__/ or templates/__tests__/); tools/overview-mcp/src/tools/init.ts + schemas.ts + __tests__/init-consumer.test.ts; .claude-plugin/plugin.json; CHANGELOG.md; docs/installation.md; docs/configuration.md; AGENTS.md (invariant #4). Toolkit root: 3 marketplace indexes; tools/validate-codex-marketplace-policy.mjs (run only).
**codexu (Job B):** bin/ralph-overview.mjs (replace with emitted wrapper); .ralph-overview/config.json (NEW consumerWrapper hooks); package.json (4 managed scripts get `--repo .`; 2 extra preserved); AGENTS.md (active-plugin-versions row + invariant #4 backlink); .gitignore (verify /bin stays tracked).
