# Stories Outline: Cross-engine ralph-overview consumer wrapper (template-sourced) via overview-init

*Preliminary decomposition from `/plan-with-ralph --from-brainstorm`. Feed to `/implement-with-ralph --from-plan` for PRD generation. Two Ralph jobs: Job A (plugin, `ai-developer-toolkit` submodule) then Job B (codexu adoption). Job B depends on Job A shipping v2.9.0 + the codexu gitlink bump.*

---

# Job A — plugin (`ai-developer-toolkit/plugins/ralph-overview/`)

## US-001: Self-contained cross-engine resolver template
**Description:** As a plugin maintainer, I want one tested template file that locates the plugin under both engines, so every consumer gets a correct wrapper without hand-authoring it.
**Acceptance Criteria:**
- [ ] `templates/consumer-ralph-overview.mjs` exists, thinned from codexu's `bin/ralph-overview.mjs`, importing nothing from the plugin at runtime.
- [ ] Exports a pure `resolvePluginRoot({ env, homedir, cwd, config })` returning `{ pluginRoot, source, depsMissing }`.
- [ ] Dispatch runs only under `fileURLToPath(import.meta.url) === path.resolve(process.argv[1])` (NOT `import.meta.url === process.argv[1]`).
- [ ] Liveness = `.claude-plugin/plugin.json` + `bin/ralph-overview.mjs` only (no `node_modules/chokidar`); a deps-missing install is still selected and prints `installed but dependencies missing — run \`copilot plugin update\` / \`npm install\` in <pluginRoot>` to stderr.
- [ ] Version selection uses an inline numeric semver comparator (`2.10.0 > 2.9.0`), lexical only as a non-semver tie-break.
- [ ] Exit codes: `2` = total cascade miss (friendly message), `3` = found-but-missing-dispatcher. `--repo` preserved if present, else defaulted to git root. Child exit code forwarded; `SIGINT` forwarded (Windows `SIGTERM` best-effort/kill documented).
- [ ] A single `loadConsumerWrapperConfig(repoRoot, env)` helper resolves the config path (honor `OVERVIEW_CONFIG_PATH` repoRoot-relative, else `<repoRoot>/.ralph-overview/config.json`), reads `consumerWrapper.localDevPluginRootRel`, and the wrapper passes the same path down as `OVERVIEW_CONFIG_PATH`.
- [ ] Marketplace/plugin names are emit-time-substitution placeholders (resolved by init-consumer), not hardcoded duplicates.
- [ ] Typecheck/lint passes.
**Dependencies:** None
**Estimated complexity:** medium

## US-002: Hermetic template unit tests
**Description:** As a maintainer, I want the exact emitted template exercised against every install layout, so resolution bugs are caught before consumers hit them.
**Acceptance Criteria:**
- [ ] New test (e.g. `scripts/lib/__tests__/consumer-ralph-overview.test.mjs`) wired into `npm run test:lib`, using fake `HOME`, injected `env`, and temp dirs.
- [ ] Covers: `RALPH_OVERVIEW_PLUGIN_ROOT` valid→resolves / invalid→warn+fall-through; `CLAUDE_PLUGIN_ROOT` direct subdir→resolves; `CLAUDE_PLUGIN_ROOT` cache versioned→newest by semver; `~/.claude` cache versioned→newest by semver; `~/.copilot` single dir→resolves; all-miss→exit 2; found-but-missing-dispatcher→exit 3; `--repo` present→preserved / absent→git-root default.
- [ ] Asserts a Copilot-style install present-but-missing-`node_modules` is **selected** and produces the deps-missing diagnostic (no silent fall-through).
- [ ] Asserts semver ordering: cache with `2.9.0` + `2.10.0` selects `2.10.0`.
- [ ] A CLI spawn test proves the emitted wrapper **actually dispatches** (guard correct) and forwards the child exit code.
- [ ] Typecheck passes.
**Dependencies:** US-001
**Estimated complexity:** medium

## US-003: Coupled, force-scoped wrapper+scripts emit in init-consumer (+ MCP surface)
**Description:** As a consumer, I want `overview-init` to emit the wrapper and point my package scripts at it together, never leaving a half-state and never overwriting my data/config.
**Acceptance Criteria:**
- [ ] `PACKAGE_SCRIPTS` become `node bin/ralph-overview.mjs <sub> --repo .` (wrapper-backed).
- [ ] init-consumer emits the wrapper + the 4 script mutations as one planned group with the ordering contract: preflight (fail-together) → write wrapper first → only then write package.json scripts. Injected wrapper-write failure leaves `package.json` **unmodified**; if `package.json` is absent, **neither** is written.
- [ ] The wrapper emit has its own overwrite policy (skip-if-identical; overwrite-if-changed) **independent** of the `.ralph-overview/data.json`/`config.json` scaffold templates — emitting/re-emitting the wrapper never touches data/config.
- [ ] `addPackageJsonScripts` keeps its name; its meaning becomes the coupled wrapper+scripts bundle; default stays `false`.
- [ ] `planTemplate` gains an emit-time substitution variant for the wrapper's marketplace/plugin-name placeholders.
- [ ] MCP `overview.init` (`tools/overview-mcp/src/tools/init.ts`, `schemas.ts`, `.d.mts`) updated; the CLI / MCP-shim / shared-engine **parity test** still passes and now covers the coupled wrapper+script ops.
- [ ] An atomicity test asserts the no-half-state invariant. Typecheck passes.
**Dependencies:** US-001
**Estimated complexity:** large

## US-004: `consumerWrapper.localDevPluginRootRel` config hook (template + schema + docs)
**Description:** As codexu (a non-generic consumer), I want my submodule local-dev fallback expressed in config, so the generic wrapper needs no codexu-specific code.
**Acceptance Criteria:**
- [ ] `templates/overview-config.template.json` documents an optional `consumerWrapper: { localDevPluginRootRel }` block.
- [ ] `templates/overview-config.schema.json` (`additionalProperties:false`) adds `consumerWrapper` with `localDevPluginRootRel: string`; `additionalProbePaths` is **not** added (deferred).
- [ ] A schema-validation test asserts a config with `consumerWrapper.localDevPluginRootRel` validates, and the wrapper resolves the named local-dev path.
- [ ] `docs/configuration.md` documents the block as a generated consumer-boundary setting. Typecheck passes.
**Dependencies:** US-001
**Estimated complexity:** small

## US-005: `derive-next-command-cli` snapshot-default source fix
**Description:** As a consumer, I want `cli derive-next-command` to default to my real snapshot, so no `--snapshot` injection wrapper hook is needed.
**Acceptance Criteria:**
- [ ] `scripts/lib/derive-next-command-cli.mjs` defaults the snapshot to `loadConfig({ repoRoot }).outputs.snapshot` (= `.ralph-overview/generated/snapshot.json`) when `--snapshot` is absent, instead of `plans/overview-snapshot.json`.
- [ ] A test asserts the default resolves to the config `outputs.snapshot` path; an explicit `--snapshot` still overrides.
- [ ] Typecheck passes.
**Dependencies:** None
**Estimated complexity:** small

## US-006: Lazy-load chokidar so one-shot `sync` works without deps
**Description:** As a fresh-Copilot-install user, I want `sync` to run without `node_modules`, so the diagnostic-only decision is actually usable.
**Acceptance Criteria:**
- [ ] `scripts/sync-ralph-state.mjs` no longer statically imports `watch-ralph-state.mjs`; the watch module is loaded via dynamic `import()` only on the `--watch` path.
- [ ] A test asserts one-shot `sync` succeeds against a fake install whose `node_modules` is absent (chokidar not evaluated), and `watch` against the same surfaces the deps-missing diagnostic / fails clearly.
- [ ] Existing sync + watch behavior unchanged when deps are present. Typecheck passes.
**Dependencies:** None
**Estimated complexity:** medium

## US-007: Update overview-init SKILL.md + regenerate Copilot mirror
**Description:** As a user reading the skill, I want accurate docs for the coupled emit + force semantics.
**Acceptance Criteria:**
- [ ] `skills/overview-init/SKILL.md` describes `addPackageJsonScripts` as the coupled wrapper+scripts bundle and clarifies that `--force` scopes the scaffold data/config templates (not the wrapper) — and that the wrapper has independent overwrite semantics.
- [ ] `.copilot-plugin/copilot-skills/overview-init/SKILL.md` regenerated via `scripts/generate-copilot-artifacts.mjs --write` and committed (mirror matches source).
**Dependencies:** US-003
**Estimated complexity:** small

## US-008: Version bump v2.9.0 lockstep + docs + invariant #4
**Description:** As a maintainer, I want v2.9.0 to ship consistently across all release surfaces.
**Acceptance Criteria:**
- [ ] `.claude-plugin/plugin.json` = `2.9.0`; all three marketplace indexes (`.claude-plugin/marketplace.json`, `.github/plugin/marketplace.json`, `.agents/plugins/marketplace.json`) = `2.9.0`.
- [ ] `CHANGELOG.md` gets a `2.9.0` section summarizing the template wrapper, coupled emit, two bug fixes, lazy-chokidar sync fix, config hook, and the diagnostic-only decision.
- [ ] `docs/installation.md` updated; `AGENTS.md` invariant #4 reworded to classify the emitted wrapper as part of the generated consumer boundary.
- [ ] `node tools/validate-codex-marketplace-policy.mjs` passes; `npm test` + `npm run typecheck` green.
**Dependencies:** US-001, US-002, US-003, US-004, US-005, US-006, US-007
**Estimated complexity:** small

---

# Job B — codexu adoption (after Job A ships v2.9.0 to the marketplace + gitlink bump)

## US-009: Dry-run delta validation against codexu (data-loss guard)
**Description:** As the adopter, I want to prove adoption changes only the wrapper + scripts before any write, so codexu's 135-task data is never at risk.
**Acceptance Criteria:**
- [ ] `overview-init --dry-run --json` against codexu reports planned changes to ONLY `bin/ralph-overview.mjs` + `package.json` (+ the intentional `.ralph-overview/config.json` `consumerWrapper` merge), with `.ralph-overview/data.json` reported skipped/unchanged.
- [ ] A recorded sha256 of `.ralph-overview/data.json` is captured pre-adoption for the post-adoption equality check.
- [ ] No blanket `--force` is used.
**Dependencies:** US-008 (Job A shipped)
**Estimated complexity:** small

## US-010: Adopt the emitted wrapper + config hook in codexu
**Description:** As codexu, I want the generic wrapper installed and my submodule fallback expressed in config, with my custom scripts preserved.
**Acceptance Criteria:**
- [ ] codexu `bin/ralph-overview.mjs` is replaced by the emitted v2.9.0 wrapper via the wrapper-scoped emit (the two bugs gone; ESM guard correct).
- [ ] `.ralph-overview/config.json` gains `consumerWrapper.localDevPluginRootRel = "ai-developer-toolkit/plugins/ralph-overview"`, preserving all existing config keys.
- [ ] `package.json`: the 4 managed scripts use `node bin/ralph-overview.mjs <sub> --repo .`; `overview:dev` and `overview:build:preview` are preserved.
- [ ] `pnpm sync-ralph-state` exits 0 end-to-end; a second invocation re-installs nothing.
- [ ] `.ralph-overview/data.json` is byte-identical to the pre-adoption sha256 from US-009.
**Dependencies:** US-009
**Estimated complexity:** medium

## US-011: codexu gitlink bump gate + AGENTS.md version row + invariant #4 backlink
**Description:** As a bookkeeper, I want the codexu version table to move only when the gitlink actually points at v2.9.0.
**Acceptance Criteria:**
- [ ] codexu `ai-developer-toolkit` gitlink points at the toolkit commit that ships ralph-overview `2.9.0`.
- [ ] codexu `AGENTS.md` active-plugin-versions row shows `ralph-overview 2.9.0` (only after the gitlink bump) and invariant #4 wording matches the plugin's.
- [ ] `.gitignore` still keeps `/bin` tracked; `bin/ralph-overview.mjs` is committed.
**Dependencies:** US-010
**Estimated complexity:** small
