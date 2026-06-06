---
overviewTaskId: ralph-overview-init-consumer-cross-engine-wrapper
---

## Direction
D-001 — Generated consumer wrapper (template-sourced) + wrapper-backed scripts, emitted atomically by `overview-init`. Ship the cross-engine resolver as ONE tested, self-contained template file in the plugin, copy it verbatim into the consumer, and point the package scripts at it in a single atomic operation — fixing the latent bugs in codexu's hand-rolled wrapper along the way.

## Goal
After a consumer runs `overview-init` (CLI, MCP `overview.init`, or `initConsumer()`), its `package.json` has `overview`, `overview:build`, `sync-ralph-state`, and `sync-ralph-state:watch` scripts that **work under BOTH Claude Code AND Copilot CLI**, survive plugin upgrades and machine moves, and are safe to commit and clone fresh — with **no consumer hand-authoring a resolver wrapper**. The resolver logic lives in exactly one plugin-owned, unit-tested source (a template), is emitted verbatim to the consumer, and codexu can adopt it (replacing or thinning its hand-committed `bin/ralph-overview.mjs`).

## Scope

### In Scope
- A new plugin-owned **template file** (e.g. `templates/consumer-ralph-overview.mjs`) containing a **self-contained** cross-engine resolver (no imports from the plugin, since its whole job is to locate the plugin). It must:
  - Probe, first-usable-wins: (1) `$RALPH_OVERVIEW_PLUGIN_ROOT`, (2) `$CLAUDE_PLUGIN_ROOT/<plugin>/`, (3) `$CLAUDE_PLUGIN_ROOT/cache/<marketplace>/<plugin>/<latest>/`, (4) `~/.claude/plugins/cache/<marketplace>/<plugin>/<latest>/`, (5) `~/.copilot/installed-plugins/<marketplace>/<plugin>/`, (6) optional config-driven local-dev fallback.
  - **Fix #1 (liveness):** treat an install as usable when it has the manifest (`.claude-plugin/plugin.json`) + dispatcher (`bin/ralph-overview.mjs`). Do **NOT** require `node_modules/chokidar`. If the resolved install is missing runtime deps, dispatch anyway and surface a precise "installed but dependencies missing — run `copilot plugin update` / `npm install` in the plugin root" diagnostic instead of silently skipping to a fallback.
  - **Fix #2 (versioning):** select the newest versioned cache subdir by **semver-aware numeric comparison** (so `2.10.0 > 2.9.0`), with lexical sort only as a final tie-break for non-semver names.
  - Default `--repo` to the consumer git root; set `RALPH_OVERVIEW_PLUGIN_ROOT` for the spawned child; forward stdio + signals + exit code.
  - Print a friendly install-instruction message and exit non-zero on total cascade miss (exit 2) / found-but-missing-dispatcher (exit 3).
  - Expose the resolver as an **importable pure function** (e.g. `resolvePluginRoot({ env, homedir, cwd, config })`) under the `import.meta.url === process.argv[1]` script-vs-module guard, so the plugin's tests exercise the exact emitted source.
- Update `scripts/init-consumer.mjs` so the package-scripts emission and the wrapper emission are **one atomic operation** (scripts point at the emitted wrapper; you cannot get one without the other) — eliminating the half-applied broken state. `PACKAGE_SCRIPTS` change from `node $CLAUDE_PLUGIN_ROOT/ralph-overview/bin/ralph-overview.mjs <sub> --repo .` to `node <wrapperPath> <sub> --repo .`.
- Marketplace + plugin names parameterized in the template (templated at emit time or read from a constant block).
- A `.ralph-overview/config.json` hook for non-generic consumer behavior: at minimum `additionalProbePaths` / `localDevPluginRootRel` (codexu's submodule fallback) and a generic hook covering codexu's `cli derive-next-command --snapshot` injection.
- **Unit tests** against the emitted template for every install layout (see Criteria).
- Keep engine/MCP-shim/CLI-JSON parity (the existing parity test must still pass).
- Version bump to **v2.9.0** with all three marketplace indexes, codexu's active-plugin-versions table, and CHANGELOG updated in lockstep (plugin invariant #6).
- Update plugin docs (`docs/installation.md`, AGENTS.md invariant #4) to classify the emitted wrapper as part of the generated consumer boundary.
- codexu migration path documented (see Context).

### Out of Scope
- **Copilot CLI plugin-install dependency gap** — `~/.copilot/installed-plugins/.../ralph-overview/` ships without `node_modules/`. This is a Copilot-CLI/publish-pipeline issue; the wrapper's job is to locate+dispatch and (with Fix #1) surface a clear diagnostic, not to install deps. File/track as a separate plugin-author follow-up.
- **Copilot CLI `$CLAUDE_PLUGIN_ROOT`-parity env-var feature request** — pursue out of band via a GitHub issue.
- **D-002** (absolute init-time paths) and **D-003** (published npm/bin shim) — rejected for now (see synthesis). D-003 is recorded as the eventual north-star once a package-distribution channel already exists.
- Auto-mutating existing consumers' `package.json` without an explicit `overview-init` run.

## Criteria
- Running `overview-init` into a fresh temp repo emits the wrapper AND wrapper-pointing package scripts together; neither appears without the other.
- The emitted wrapper resolves correctly, with hermetic tests (fake `HOME`, injected `env`, temp dirs) for: `RALPH_OVERVIEW_PLUGIN_ROOT` valid → resolves; invalid → warns + falls through; `CLAUDE_PLUGIN_ROOT` direct subdir → resolves; `CLAUDE_PLUGIN_ROOT` cache versioned → newest by semver; `~/.claude` cache versioned → newest by semver; `~/.copilot` single dir → resolves; all-miss → exit 2 with friendly message; found-but-missing-dispatcher → exit 3; `--repo` present → preserved, absent → defaulted to git root.
- A test asserts a Copilot-style install present-but-missing-`node_modules` is **still selected** (manifest+dispatcher liveness) and produces the "dependencies missing" diagnostic — NOT a silent fall-through to local-dev.
- A test asserts semver ordering: a cache with `2.9.0` and `2.10.0` selects `2.10.0`.
- `pnpm sync-ralph-state` (or the node-equivalent) exits 0 end-to-end in a temp consumer whose resolved install has populated `node_modules`.
- Engine / MCP-shim / CLI-`--json` planning-field parity test still passes.
- `plugin.json` v2.9.0 and all three marketplace indexes carry matching versions; `node tools/validate-codex-marketplace-policy.mjs` passes.
- An `overview-init --diff`/dry-run against codexu enumerates the exact codexu-specific deltas, and each is shown to map to a config knob OR a documented thin codexu shim.

## Context
**Full-mode brainstorm** (Codex gpt-5.5 xhigh + Copilot xhigh + Devil's Advocate). All three lenses independently converged on the same top-two directions and the same risk set, which is why the recommendation is high-confidence. See `brainstorm-synthesis.md` for the per-direction detail and `brainstorm.json` for the manifest.

**Why D-001 over the alternatives:** D-002 (absolute paths in `package.json`) fails the committed/portable-scripts requirement that a shared-repo tool needs — two lenses flagged it as machine-local-only and home-dir-leaking, and Claude's versioned cache stales on every upgrade. D-003 (published npm/bin shim) is the cleanest north-star but adds a disproportionate package-distribution + auth + version-drift axis and is partly blocked by GitHub Packages auth complexity; keep it on record for later.

**Disconfirming observations carried forward (from the lenses, must be respected by the plan):**
- The `node_modules/chokidar` liveness check (codexu `bin/ralph-overview.mjs:49-56`) is a footgun against the known Copilot-install gap → liveness must be manifest+dispatcher only.
- Lexical version sort (codexu `:58-68`) is a latent bug (`2.10.0 < 2.9.0`) → use semver comparison; do NOT port the lexical sort.
- Two independent flags (`addPackageJsonScripts` + `addConsumerWrapper`) invite a broken half-state → couple them into one atomic emit.

**Highest-risk assumption:** that a generic upstream wrapper can REPLACE codexu's wrapper without codexu needing a post-emit patch. codexu's wrapper is NOT generic — it injects `--snapshot` for `cli derive-next-command` (`:159-170`) and hard-codes a script-relative `ai-developer-toolkit` submodule local-dev fallback (`:95-102`). **Cheapest validation:** `overview-init --diff`/dry-run a copy of codexu and enumerate the deltas; if both map to `.ralph-overview/config.json` knobs the generic goal holds, otherwise the plan carves out a thin codexu shim that delegates to the shared resolver template.

**Recommended codexu migration:** `overview-init --diff` first, then `--force` adopt once the config hooks land; express codexu's two deltas via config, falling back to a minimal codexu shim only if a delta cannot be config-expressed. (Synthesis recommends C→A from Axis 4.)

**Open questions for the planner:** bin/ vs scripts/ default location; exact liveness diagnostic + exit code; the precise config schema for the codexu deltas; the back-compat story for the existing `addPackageJsonScripts` flag; marketplace/plugin-name templating mechanism; invariant #4 doc wording.

**Plugin version bump target:** v2.9.0 (minor, additive) from current v2.8.1.
