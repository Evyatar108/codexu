# Research Brief: ralph-overview Data Relocation + JSON Migration

*Synthesized for `/plan-with-ralph` on 2026-05-29 (Copilot member, autonomous-style — single-agent synthesis instead of the 4-way parallel research loop, because the design is operator-locked).*

## Why no multi-agent research loop

The spawn prompt explicitly says **"design is LOCKED (do not re-litigate — plan around these)"** with five locked architectural decisions and a fully-specified target directory layout. The remaining open questions are bounded and answerable from the artifacts on disk. Running the 4-way parallel research loop (`researcher` + `architect` + Codex + Copilot) is the right tool when the design space is open; here it would burn 5–10 minutes of model time arguing about decisions the operator has already made. Captured this as a process anomaly in the kind=done body.

Single-pass research below pulled from a direct read of the codebase (see "Sources read").

## Sources read

### Plugin (Repo A: `D:/ai-developer-toolkit/plugins/ralph-overview/`)

- `scripts/lib/parse-overview-data.mjs` — the AST-only loader. Lines 11–14 enforce **exactly one top-level statement** (uses `@babel/parser` `sourceType: 'script'`). Lines 18 reject anything other than `window.OVERVIEW_DATA = {…}`. This is the bug that currently breaks codexu — its data file has two statements: `globalThis.window = globalThis.window || {};` followed by `window.OVERVIEW_DATA = {…}`.
- `scripts/lib/parse-overview-data.d.mts` — return-type contract: `{ ok: true; data: OverviewData } | { ok: false; error: string }`. JSON path must preserve this contract.
- `scripts/lib/default-config.mjs` — default config object. `dataFile: 'plans/overview-data.js'`, `outputs.{sidecarJs,sidecarJson,snapshot,activity,activityBackup,snapshotSchema,recommendationsJson,dependencyGraphJson,viewerHtml}` all hard-coded to `plans/overview-…`, `lockFile: '.ralph/overview-sync.lock'`. `tasksIndex: 'tasks/INDEX.md'` and `activityMaxLines: 1000` are NOT part of the relocation (the `tasks/INDEX.md` index is human-readable navigation, not watcher state).
- `scripts/lib/default-config.d.mts` — TypeScript contract for `RalphOverviewConfig`. Field set must remain stable; only string defaults change.
- `scripts/lib/resolve-config.mjs` — `loadConfig({ repoRoot, configPath })`. Selects `${repoRoot}/.ralph/overview-config.json` by default (line 34, `defaultConfigPath`). Three observations critical to the migration:
  1. The committed config and the default config are **merged**, so consumers can override any single field. Back-compat for existing `outputs.*` overrides is "free" as long as we preserve key names.
  2. `selectConfigPath` checks `process.env.OVERVIEW_CONFIG_PATH` first. The migration must not change that env-var contract.
  3. `defaultConfigPath` hard-codes `.ralph/overview-config.json`. After migration the default becomes `.ralph-overview/config.json`; we keep the legacy path as a discovery fallback so consumers can move at their own pace.
- `scripts/lib/sync-core.mjs` — synthesizes snapshot/recommendations/dep-graph/activity/tasks-index. Receives the resolved config. No lock-path code lives here; it just writes the configured `outputs.*`. Lock acquisition is the caller's responsibility.
- `scripts/lib/sync-lock.mjs` — generic lock primitive. Lines 11–12 mkdir-p the lock's parent dir before write, so `.ralph-overview/generated/.lock/sync.lock` "just works" if the path is passed through. Owner-marker logic is in `scripts/lib/watch-ralph-state.mjs`, NOT here.
- `scripts/lib/watch-ralph-state.mjs:515-517` — **hard-coded** `getWatcherOwnerPath(repoRoot)` returning `path.join(repoRoot, '.ralph', 'overview-watcher.owner')`. This is the second of two lock-related paths and is NOT currently config-driven. The migration must either thread it through config (preferred) or change the hard-coded suffix to `.ralph-overview/generated/.lock/watcher.owner`. Either works; the plan picks "config-driven" because it preserves consumer overrides.
- `tools/overview-mcp/src/snapshot-reader.ts` — reads three files through the resolved config: `config.outputs.snapshot`, `config.dataFile`, `config.outputs.sidecarJson`. All three are config-driven; no hard-coded paths. **No MCP code change needed** beyond the default-config bump; the path resolution flows from config.
- `tools/overview-mcp/src/__tests__/three-mcp-integration.test.ts:17,70` — hard-codes `overview-watcher.owner` filename inside test fixtures, so when the path moves, this test needs an update (or the path becomes config-driven and the fixture is updated to compose it from config).
- `tools/overview-viewer/overview.html` — currently has TWO static `<script>` tags loading `./overview-data.js` and `./overview-ralph-state.js`. These set `window.OVERVIEW_DATA` and `window.OVERVIEW_RALPH_STATE` before React mounts.
- `tools/overview-viewer/vite.config.ts` — dev-server middleware serves `/overview-data.js` and `/overview-ralph-state.js` by reading from `config.outputs.sidecarJs` / `config.outputs.sidecarJson` and synthesizing a tiny JS shim (`window.X = {…};`). The production-bundle `handler(html, ctx)` (lines 110–180) inlines the data into a `<script>{minifiedData.code}</script>` literal at build time. **This is the critical viewer surface** — switching to fetch-of-JSON means the Vite plugin must serve `/data.json` and `/ralph-state.json` raw, and the build-time inlining either disappears (replaced by a runtime fetch) or becomes inlining of `<script type="application/json" id="overview-data">…</script>` blocks the entry script reads. Recommended: runtime fetch for dev + inlined `<script type="application/json">` blocks for the production single-file `overview.html`, keeping the offline-openable artifact contract.
- `tools/overview-viewer/src/overviewData.ts` — declares `window.OVERVIEW_DATA?: OverviewData` and `window.OVERVIEW_RALPH_STATE?: OverviewRalphState`. This contract is the consumer of the script tags.
- `tools/overview-viewer/src/App.tsx:29-31` — `getOverviewData(): OverviewData { return window.OVERVIEW_DATA ?? {} }`. **The simplest viewer migration preserves this contract** — the entry script assigns `window.OVERVIEW_DATA` from fetched JSON before React mounts, and `App.tsx` is unchanged.
- `skills/{work-on,triage,blocker-report}/SKILL.md` + `.copilot-plugin/copilot-skills/{work-on,triage,blocker-report}/SKILL.md` — eight files total. All hardcode `plans/overview-snapshot.json` and `.ralph/overview-sync.lock` literal paths. See `work-on/SKILL.md` lines 45–58 for the exact pattern. The Copilot mirror is generated from the source by `scripts/generate-copilot-artifacts.mjs`; both must be updated together. **Decision needed:** MCP-only or config-aware. Resolved in plan §"Open question resolutions".
- `templates/overview-config.template.json` + `templates/overview-config.schema.json` — what `overview.init` writes into a fresh consumer's `.ralph/overview-config.json`. Templates must be updated to the new layout AND new default location (`.ralph-overview/config.json`).
- `CHANGELOG.md` — recent v2.4.1 was a `repo-root resolution` fix, v2.4.0 added Copilot plugin manifest, v2.3.0 was the `OverviewTask.lifecycle` rename with v2.3.x aliases. The plugin uses **minor bumps for additive changes + breaking-default with alias-window** (e.g., `phase → lifecycle` was minor + alias). Consistent with that, this migration is **v2.5.0 minor** with a one-minor-version deprecation window on the legacy `.js` loader path.

### Codexu (Repo B: `D:/harness-efforts/codexu/`)

- `plans/overview-data.js` — 2,365 lines, ~400 KB. Top is a 19-line `/* … */` schema comment, then 6 lines of one-line comment + the `globalThis.window = …` polyfill (line 25) + `window.OVERVIEW_DATA = { … }` (line 26 through EOF). The body is a plain JSON-compatible object literal (verified by Node round-trip — the file deserializes with `parseOverviewData` patched to accept multi-statement; structure shows pure data, no functions/getters). Safe to mechanically transform to JSON via `node -e "console.log(JSON.stringify(window.OVERVIEW_DATA, null, 2))"`.
- `.ralph/overview-config.json` — already overrides every `outputs.*` field, plus `dataFile`, `ralphRoot`, `lockFile`, and `watcher.ignored`. **Codexu is already an override-heavy consumer**, which means it's the ideal first migration target: the move is purely "rewrite the override paths"; no risk of inheriting unexpected new defaults mid-flight.
- `bin/ralph-overview.mjs` — gitignored resolver wrapper. From AGENTS.md: it checks `RALPH_OVERVIEW_PLUGIN_ROOT`, `$CLAUDE_PLUGIN_ROOT/ralph-overview/`, `$CLAUDE_PLUGIN_ROOT/cache/ai-developer-toolkit/ralph-overview/<latest>/`, `~/.claude/plugins/cache/ai-developer-toolkit/ralph-overview/<latest>/`, `~/.copilot/installed-plugins/ai-developer-toolkit/ralph-overview/`, then the local-dev fallback `D:/ai-developer-toolkit/plugins/ralph-overview/`. No change required for this migration; resolver dispatches to the plugin's own `bin/ralph-overview.mjs`, which gets the new defaults via the plugin update. Retirement is OQ #6 (deferred follow-up).
- `AGENTS.md` — references `plans/overview-snapshot.json` (multiple), `.ralph/overview-watcher.owner`, `.ralph/overview-sync.lock`, the `parseOverviewData` 1-statement bug (item (b) in the "Copilot migration milestone" block). All must be updated.
- `docs/fork-roadmap.md`, `docs/fork-notes.md`, `plans/overview-data-split.md` — likely have path references; sweep via grep.
- `plans/overview.html`, `plans/overview.html.next`, `plans/overview-*.json`, `plans/overview-activity.jsonl`, `plans/overview-ralph-state.{js,json}`, `plans/overview-snapshot.schema.json` — all current generated artifacts. To be `git rm`'d in Repo B phase after the new layout is verified.

## Consolidated file list (grouped by relevance)

### Repo A — plugin source files to modify
- `scripts/lib/parse-overview-data.mjs` (loader: add JSON path)
- `scripts/lib/parse-overview-data.d.mts` (type-stable; possibly add a `kind: 'json' | 'js'` discriminator on result)
- `scripts/lib/default-config.mjs` (default paths)
- `scripts/lib/default-config.d.mts` (no shape change; only string defaults)
- `scripts/lib/resolve-config.mjs` (default-config-path fallback chain: check `.ralph-overview/config.json` first, then legacy `.ralph/overview-config.json` for back-compat)
- `scripts/lib/watch-ralph-state.mjs` (~line 516: thread `watcherOwnerPath` through config OR change hard-coded suffix)
- `scripts/sync-ralph-state.mjs` (CLI; consumes config — verify lock-path flow)
- `tools/overview-viewer/overview.html` (replace script tags with `<script type="module" src="./bootstrap.js">` or similar)
- `tools/overview-viewer/vite.config.ts` (dev-server middleware: serve `.json` raw; build-time inlining: emit `<script type="application/json">` blocks)
- `tools/overview-viewer/src/main.tsx` or new `src/bootstrap.ts` (the pre-React fetch shim)
- `skills/{work-on,triage,blocker-report}/SKILL.md` (decouple from hardcoded paths)
- `.copilot-plugin/copilot-skills/{work-on,triage,blocker-report}/SKILL.md` (mirror — regenerate via `scripts/generate-copilot-artifacts.mjs`)
- `templates/overview-config.template.json` (new defaults)
- `templates/overview-config.schema.json` (no shape change; optional comment updates)
- `templates/overview-data.template.js` → ALSO add `templates/overview-data.template.json` (or replace the .js template since new consumers should start in JSON)
- `tools/overview-mcp/src/__tests__/three-mcp-integration.test.ts` (line 17, 70: update owner-marker fixture composition)
- `scripts/lib/__tests__/` various (existing parse-overview-data, resolve-config, sync-core, sync-lock, watch-ralph-state tests must add JSON-path + new-default coverage)
- `scripts/init-consumer.mjs` (writes `.ralph/overview-config.json` today; must write `.ralph-overview/config.json` post-migration, with optional `--legacy-layout` escape for users not ready to move)
- `CHANGELOG.md` (v2.5.0 entry + migration block)
- `docs/configuration.md`, `docs/extending.md`, `docs/migration-v1-to-v2.md` (update path references; add a new `docs/migration-v2.4-to-v2.5.md` migration guide)
- `AGENTS.md` (plugin's own; mentions `.ralph/overview-watcher.owner` and `.ralph/overview-sync.lock` repeatedly)
- `README.md` (mentions owner-marker path)
- `tools/overview-mcp/README.md` (mentions owner-marker path)
- `tools/overview-viewer/AGENTS.md` (mentions `OVERVIEW_DATA` script-tag bootstrap)
- `.claude-plugin/plugin.json`, `.copilot-plugin/copilot-skills/*` Copilot plugin manifest (version bump)

### Repo B — codexu files to modify / move
- NEW `.ralph-overview/config.json` (from migrated `.ralph/overview-config.json`)
- NEW `.ralph-overview/data.json` (from converted `plans/overview-data.js`)
- NEW `.ralph-overview/SCHEMA.md` (extracted from the 19-line leading comment block of `plans/overview-data.js`)
- NEW `.ralph-overview/generated/` directory + tracked sidecars (snapshot, ralph-state, recommendations, dep-graph, activity, snapshot-schema, overview.html)
- NEW `.ralph-overview/generated/.lock/` directory (empty until first sync; `.gitkeep` to track)
- DELETE `plans/overview-data.js`, `plans/overview-snapshot.json`, `plans/overview-ralph-state.{js,json}`, `plans/overview-recommendations.json`, `plans/overview-dependency-graph.json`, `plans/overview-activity.jsonl`, `plans/overview-snapshot.schema.json`, `plans/overview.html`, `plans/overview.html.next`
- DELETE `.ralph/overview-config.json`, `.ralph/overview-sync.lock`, `.ralph/overview-watcher.owner` (if any tracked); update `.gitignore` if any of these had ignore entries that no longer apply
- KEEP `plans/overview-data-split.md`, `plans/overview-viewer-polish-seed.md`, `plans/overview-vite-react.md` (human-written design docs; not relocated)
- KEEP `tasks/INDEX.md` (human-readable nav; lives outside the `.ralph-overview/` blob by design — `tasksIndex` config field stays `tasks/INDEX.md`)
- MODIFY `AGENTS.md` (multiple path references including the "Copilot migration milestone" item (b) which currently flags the bug being fixed by this migration)
- MODIFY `docs/fork-roadmap.md`, `docs/fork-notes.md` (path references)
- MODIFY `plans/overview-data-split.md` (references the .js form)
- VERIFY `bin/ralph-overview.mjs` resolver wrapper still dispatches correctly to the post-bump plugin

## Technical constraints

1. **Sequencing is operator-mandated**: Plugin (Repo A) MUST publish v2.5.0 first; codexu (Repo B) adopts after. During the window, codexu's existing `.ralph/overview-config.json` keeps working because the merged-config code path still honors `outputs.*` overrides at their old locations.

2. **The plugin loader's JSON path must coexist with the legacy `.js` path for one minor version**. Auto-detect by file extension. Emit a `console.warn`-level deprecation when the `.js` path is used so existing consumers see the signal. Hard-cut in v2.6.0 (or v3.0.0, depending on adoption telemetry).

3. **The owner-marker path is hard-coded in `watch-ralph-state.mjs`** (line 516). Threading it through config is preferred over a hard-coded suffix swap so consumers retain override capability and the test fixture composition remains config-driven.

4. **The viewer's production build is offline-openable** (`plans/overview.html` is a single self-contained file). The fetch-bootstrap migration must preserve that contract: dev uses runtime `fetch()`, production inlines the JSON into `<script type="application/json">` blocks the bootstrap reads. Avoid CORS / file:// concerns for the single-file production artifact.

5. **Two-file split (data.json vs ralph-state.json) is preserved** — the watcher still writes `generated/ralph-state.json` separately from the hand-curated `data.json`. The viewer fetches both. This preserves the architectural reason the split exists (hand-curated vs auto-generated, race-condition avoidance).

6. **MCP exposes `overview.parallel_ready_tasks`, `overview.validate_data`, `overview.watcher_status`. There is no `overview.snapshot` or `overview.tasks` MCP tool today.** The skill-decoupling decision (OQ #3) must reckon with this: fully MCP-only requires net-new MCP tools. Plan resolves this with a config-aware fallback in v1 and a follow-up task for `overview.snapshot` / `overview.task` MCP tools.

7. **The Copilot mirror under `.copilot-plugin/copilot-skills/` is generated, not hand-authored.** All skill edits land in `skills/<name>/SKILL.md`; the mirror is regenerated via `scripts/generate-copilot-artifacts.mjs`. The plan's stories must call this out — otherwise the mirror drifts and the Copilot path serves stale instructions.

8. **`scripts/init-consumer.mjs` writes new-consumer config**. The migration must update this so new consumers get the new layout straight away; otherwise we'd be quietly creating new clones in the deprecated layout.

9. **Test fixtures hard-code paths** at `tools/overview-mcp/src/__tests__/three-mcp-integration.test.ts:17,70` and possibly elsewhere. Sweep with `grep -r 'overview-watcher.owner\|overview-sync.lock\|overview-snapshot.json\|overview-ralph-state\|overview-data.js' --include='*.{ts,mjs,js,test.mjs,test.ts}'` before declaring "done".

10. **Existing `outputs.*` config overrides MUST continue to work post-migration** for back-compat. The plugin's `mergeConfig` already preserves any keys present in the consumer config, so the only risk is if we rename a key. Keep all field NAMES stable (only string defaults change).

## Anti-patterns to avoid

- **Don't change `outputs.*` field NAMES** (e.g., don't rename `outputs.sidecarJson` to `outputs.ralphStateJson`). Field renames break consumer overrides; only default values change.
- **Don't conflate the plugin update with the codexu adoption in one PR.** The sequencing constraint requires two separate shipped commits: plugin v2.5.0 first, then codexu adopt-the-new-defaults second.
- **Don't drop the back-compat `.js` loader path** without a deprecation window. Operator preference: keep one minor with `console.warn`, then drop.
- **Don't migrate `tasks/INDEX.md`** — it's intentionally a human-readable nav file outside the `.ralph-overview/` blob.
- **Don't add new MCP tools as part of this migration.** Scope creep. The MCP-only-skills follow-up is a separate task.
