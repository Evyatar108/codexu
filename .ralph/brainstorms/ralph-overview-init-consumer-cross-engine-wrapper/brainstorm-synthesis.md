Lenses: ran=[devils-advocate, codex, copilot]; skipped=[] (full mode)

# Brainstorm synthesis — push cross-engine plugin-path resolution upstream into ralph-overview's overview-init

**Idea:** Make `overview-init` emit a setup that gives every consumer working
`pnpm sync-ralph-state` + `pnpm overview` under BOTH Claude Code AND Copilot CLI,
without each consumer hand-rolling codexu's per-repo resolver wrapper.

**Mode:** Full (Codex gpt-5.5 xhigh + Copilot xhigh + Devil's Advocate). All three
lenses independently converged on the same top-two directions and the same set of
sharp risks, which raises confidence in the recommendation.

## Cross-lens agreement (high signal)

Every lens independently surfaced these, so treat them as near-settled constraints
for whichever direction the planner picks:

1. **Two independent flags invite a broken half-state.** `addPackageJsonScripts`
   (existing) + a new `addConsumerWrapper` can drift: scripts updated but wrapper
   absent (fresh clone → `MODULE_NOT_FOUND`), or wrapper present but scripts still
   point at `$CLAUDE_PLUGIN_ROOT` (Copilot still broken). The scripts and the
   wrapper MUST be emitted by ONE atomic operation.
2. **The `node_modules/chokidar` liveness check is a footgun.** Codexu's
   `existsPluginAt()` (`bin/ralph-overview.mjs:49-56`) requires `node_modules/chokidar`.
   The known Copilot-install gap (install dir ships WITHOUT `node_modules/`) means a
   real, correct Copilot install would be judged "not usable", silently SKIPPED, and
   the cascade would fall through to a local-dev checkout (running unpinned source) or
   exit 2 with a misleading "could not locate" message. Liveness should be
   manifest (`.claude-plugin/plugin.json`) + dispatcher (`bin/ralph-overview.mjs`);
   a missing runtime dep should produce a precise "installed but dependencies missing —
   run `copilot plugin update` / `npm install`" diagnostic, NOT a fall-through.
3. **Lexical version sort is a latent bug, not behavior to port.** Codexu's
   `newestVersionedSubdir()` (`bin/ralph-overview.mjs:58-68`) sorts cache dirs
   lexically; once versions hit double digits `2.10.0 < 2.9.0`, so the resolver picks
   an OLDER Claude cache. Use semver-aware numeric comparison; lexical only as a
   final tie-break for invalid names.
4. **codexu's wrapper is NOT generic.** It injects `--snapshot` for
   `cli derive-next-command` (`:159-170`) and hard-codes a script-relative
   `ai-developer-toolkit` submodule local-dev fallback (`:95-102`). "A fully generic
   upstream wrapper drop-in replaces codexu's" is a FALSE GOAL unless those deltas can
   move into `.ralph-overview/config.json` (an `additionalProbePaths` /
   `localDevPluginRootRel` hook and a generic CLI-default hook) OR codexu keeps a thin
   shim that delegates to the shared resolver.
5. **Version target v2.9.0** (minor, additive) from v2.8.1, with the three
   marketplace indexes + codexu's active-plugin-versions table + CHANGELOG kept in
   lockstep (plugin invariant #6).
6. **Architecture invariant #4 needs a doc update.** "The bin dispatcher is the only
   consumer↔plugin boundary" no longer holds cleanly once a generated consumer-side
   resolver exists; the docs must explicitly classify the emitted wrapper as part of
   the generated consumer boundary.

## Candidate directions

### D-001: Generated consumer wrapper (template-sourced) + wrapper-backed scripts, emitted atomically
- **Contributing lenses:** [codex, copilot, devils-advocate]
- **Why this might work:** Delivers the actual goal — every NEW consumer gets
  cross-engine scripts that survive plugin upgrades, machine moves, AND fresh clones,
  with zero plugin-internals knowledge. The keystone is to ship the resolver as a
  single self-contained **template file** in the plugin
  (`templates/consumer-ralph-overview.mjs`), unit-test that exact file against every
  install layout, and have `initConsumer` copy it verbatim to the consumer
  (`bin/ralph-overview.mjs` default) while pointing the 4 package scripts at it — all
  in one operation. This resolves the circularity (the consumer wrapper can't import
  the plugin it's trying to locate) AND gives codexu's currently-untested 170 LoC a
  real test suite.
- **Risks / friction:** Ships a generated tracked file; repos with `/bin` gitignore
  (codexu had this) need `scripts/` or an un-ignore. Existing `addPackageJsonScripts`
  callers see new file creation. codexu-specific behavior must be config-expressed or
  codexu keeps a thin delegating shim (risk #4).
- **Cheapest validation:** `overview-init --diff` codexu against the emitted template
  to enumerate EXACTLY the codexu-specific deltas; if each maps to a config knob, the
  generic goal holds; if not, scope a thin codexu shim. Plus hermetic vitest with fake
  `HOME` + injected env for all 8+ layouts.
- **Disconfirming observation:** A fresh temp consumer passes all tests, but codexu
  still needs a post-emit patch for `--snapshot`/local-dev, proving "generic" is
  partial — in which case the planner must explicitly choose config-hook vs thin-shim.

### D-002: Init-time absolute dispatcher-path scripts (no wrapper) + repair command
- **Contributing lenses:** [codex, copilot, devils-advocate]
- **Why this might work:** Zero tracked consumer source; `overview-init` resolves the
  current engine install once and writes absolute-path scripts. Smallest change
  surface (Codex: effort "S"). Copilot's path is genuinely stable (single live copy,
  no version dir), so it doesn't stale for Copilot.
- **Risks / friction:** Leaks a machine-specific home dir into `package.json` →
  unacceptable for committed/shared repos. Claude's versioned cache stales on every
  plugin upgrade (old version dir may be pruned → `MODULE_NOT_FOUND` before any
  friendly message). Cross-shell quoting for paths with spaces. Needs a
  `overview repair` command + "rerun overview-init" contract.
- **Cheapest validation:** Emit absolute scripts in a throwaway repo, then run the
  same `package.json` from a second fake `HOME` and the other engine layout; count
  failures. If `package.json` can't be portable, reject quickly.
- **Disconfirming observation:** Scripts fail after moving `HOME`, upgrading the
  plugin, or switching engines — showing this fixes single-user setup while making
  shared repos LESS reliable. Viable only as a machine-local convenience or interim
  opt-in, not the durable default.

### D-003: Plugin-owned npm/bin shim or engine-neutral launcher (published shim package)
- **Contributing lenses:** [devils-advocate]
- **Why this might work:** The most "correct" long-term shape — one tested artifact
  instead of N generated copies; scripts call a stable `ralph-overview <sub>` /
  `node node_modules/.bin/ralph-overview <sub>`; resolver logic lives in one versioned
  package. Forces the Copilot dependency-packaging question into the open (a feature,
  not a bug).
- **Risks / friction:** Requires a package distribution + versioning channel beyond
  the plugin marketplace; if GitHub Packages auth is needed, consumer setup becomes
  WORSE than a generated wrapper. Adds a second version axis (plugin v2.9.0 vs shim
  v?) that can drift. May still violate invariant #4 unless documented as the
  dispatcher-locator.
- **Cheapest validation:** Prototype `node_modules/.bin` resolution + Windows `.cmd`
  shim behavior (reuse the existing Node-20.12 EINVAL `.cmd` regression test as prior
  art); measure the offline/auth setup cost. If setup cost > generated wrapper, defer.
- **Disconfirming observation:** The distribution/auth overhead makes first-run setup
  heavier than the problem warrants right now — record as a future option once a
  package channel already exists.

## Recommendation

**D-001**, in its bug-fixed, atomically-coupled, template-sourced form. It is the
only direction that satisfies the real requirement (portable, committed,
upgrade-surviving, fresh-clone-safe scripts under both engines) without taking on the
disproportionate package-distribution + auth axis of D-003. D-002 fails the
"committed/portable `package.json`" test that a shared-repo tool requires (two lenses
independently flagged it as machine-local-only). D-003 is the right NORTH STAR but is
heavier than the current need and partly blocked by GitHub Packages auth complexity —
keep it on record as the eventual evolution.

The recommendation is explicitly the *refined* D-001, not "copy codexu's 170 LoC":
ship the resolver as a tested template, fix the semver-sort and node_modules-liveness
bugs, couple scripts+wrapper into one atomic emit, and provide a config hook (or a
documented thin-shim escape) for codexu's two non-generic behaviors.

## Single highest-risk assumption

That a generic upstream wrapper can REPLACE codexu's wrapper without codexu needing a
post-emit patch. Cheapest test: run `overview-init --diff` (or a dry-run emit) into a
copy of codexu and enumerate the exact deltas (`--snapshot` injection, submodule
local-dev fallback). If both map to `.ralph-overview/config.json` knobs, the generic
goal holds; otherwise the plan must carve out a thin codexu shim that delegates to the
shared resolver template.

## Open questions for the planner

1. Default wrapper location: `bin/ralph-overview.mjs` (continuity with codexu, the
   only current consumer) vs `scripts/ralph-overview.mjs` (avoids common `/bin`
   gitignore)? Make it a single init option with one default.
2. Liveness semantics: confirm manifest+dispatcher (NOT node_modules) and the exact
   "installed but dependencies missing" diagnostic + exit code (reuse 2/3 or add a
   new code?).
3. Config schema for the codexu-specific deltas: `additionalProbePaths` +
   `localDevPluginRootRel` for the submodule fallback, and a generic hook for the
   `cli derive-next-command --snapshot` default — or does codexu keep a thin shim?
4. API coupling: does the existing `addPackageJsonScripts` flag's meaning CHANGE to
   atomically include the wrapper, or is there a new single coupled flag? What is the
   back-compat story for callers that pass `addPackageJsonScripts: true` today?
5. Marketplace/plugin-name handling in the template: templated at emit time vs a
   constant block the template reads.
6. Invariant #4 doc update wording (consumer wrapper as generated boundary).
