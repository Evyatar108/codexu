# Stories Outline: ralph-overview Data Relocation + JSON Migration

*Preliminary decomposition from `/plan-with-ralph` on 2026-05-29. Feed to `/implement-with-ralph --from-plan` for PRD generation. **Note: this is a cross-repo migration shipped as TWO impl jobs in sequence — see plan.md "Sequencing" for the why.** The bookkeeper lead should spawn impl members job-by-job, not story-by-story across both jobs at once.*

---

# JOB 1 — Plugin migration (ai-developer-toolkit, v2.5.0 minor bump)

Branch: `ralph/<task-slug>-plugin` off `Evyatar108/ai-developer-toolkit:main`. Worktree: `D:/ai-developer-toolkit/` (the dev box's local clone) or a fresh worktree per the impl member's preference.

## US-A1: JSON data loader (auto-detect by extension; .js back-compat with deprecation)

**Description:** As a consumer, I want `parseOverviewData` to accept both `.json` (pure JSON via `JSON.parse`) and `.js` (existing AST path, with the leading `globalThis.window = …` polyfill allowed) so that I can migrate to `.ralph-overview/data.json` without losing the ability to run my old `.js` data file during the migration window.

**Acceptance Criteria:**
- [ ] `scripts/lib/parse-overview-data.mjs` is split: the existing AST function is renamed to `parseOverviewDataJs(content)`; a new `parseOverviewDataJson(content)` does `JSON.parse` and validates the result is a plain object. The public `parseOverviewData(content, { kind })` (or sibling `loadOverviewData(filePath)`) routes by extension. Return type contract `{ ok: true; data: OverviewData } | { ok: false; error: string }` is preserved.
- [ ] `.js` path: relax the 1-statement enforcement at lines 11–14. Allow `globalThis.window = globalThis.window || {};` as a leading optional polyfill statement when it's followed by exactly one `window.OVERVIEW_DATA = …` ObjectExpression assignment. Reject anything else with the same error message shape as today.
- [ ] `.js` path emits exactly one `console.warn('[ralph-overview] .js data files are deprecated; migrate to .ralph-overview/data.json — see <docs/migration-v2.4-to-v2.5.md>. Removal scheduled for v2.6.0.')` per process. Use a module-scoped `let warned = false` guard to avoid spam.
- [ ] `.json` path: `JSON.parse(content)`; reject non-object root with `{ ok: false, error: 'JSON root must be an object literal' }`.
- [ ] Auto-detection: at the higher-level call site (search `loadOverviewData` callers — likely in `tools/overview-mcp/src/snapshot-reader.ts` line 94 and `scripts/sync-ralph-state.mjs`), the dispatcher reads `path.extname(filePath).toLowerCase()` and calls the right parser. Extensions `.json` → JSON, `.js` → AST + deprecation. Other extensions → `{ ok: false, error: 'Unsupported data file extension: <ext>' }`.
- [ ] `scripts/lib/parse-overview-data.d.mts` keeps `ParseOverviewDataResult` shape; optionally add a `kind: 'json' | 'js'` discriminator on the success branch for downstream introspection (do not break existing consumers).
- [ ] New test fixture: `test-fixtures/overview-data.rich.json` (JSON form of the existing `overview-data.rich.js`). Existing `.js` fixtures stay for regression coverage of the deprecation path.
- [ ] New unit tests in `scripts/lib/__tests__/parseOverviewData.test.mjs` (or extend existing) cover: pure JSON round-trip; JS with polyfill + assignment (codexu shape); legacy JS without polyfill (regression); JS with 3+ statements (rejected); JSON with array root (rejected); unsupported extension (rejected); the deprecation `console.warn` fires exactly once across multiple calls in the same process.
- [ ] Existing `parseOverviewData` tests pass unchanged (back-compat for the 1-statement legacy form).
- [ ] `pnpm --filter ralph-overview test` passes.
- [ ] `pnpm --filter ralph-overview typecheck` passes.

**Dependencies:** None — foundation story.

**Estimated complexity:** medium

---

## US-A2: Default config: `.ralph-overview/` layout + config-file discovery fallback

**Description:** As a new consumer with no `overview-config.json`, I want the plugin to emit/expect data and generated artifacts under `.ralph-overview/` by default, so that a fresh `overview.init` lands a clean modern layout. As an existing consumer with `.ralph/overview-config.json` and explicit `outputs.*` overrides, I want nothing to break — my overrides keep winning.

**Acceptance Criteria:**
- [ ] `scripts/lib/default-config.mjs` `defaultOverviewConfig` updated:
  - `dataFile: '.ralph-overview/data.json'`
  - `outputs.sidecarJs: '.ralph-overview/generated/ralph-state.js'`
  - `outputs.sidecarJson: '.ralph-overview/generated/ralph-state.json'`
  - `outputs.snapshot: '.ralph-overview/generated/snapshot.json'`
  - `outputs.activity: '.ralph-overview/generated/activity.jsonl'`
  - `outputs.activityBackup: '.ralph-overview/generated/activity.1.jsonl'`
  - `outputs.snapshotSchema: '.ralph-overview/generated/snapshot.schema.json'`
  - `outputs.recommendationsJson: '.ralph-overview/generated/recommendations.json'`
  - `outputs.dependencyGraphJson: '.ralph-overview/generated/dependency-graph.json'`
  - `outputs.viewerHtml: '.ralph-overview/generated/overview.html'`
  - `outputs.tasksIndex` STAYS `tasks/INDEX.md` (intentional — not part of the relocation).
  - `outputs.activityMaxLines` unchanged.
  - `lockFile: '.ralph-overview/generated/.lock/sync.lock'`
- [ ] No `outputs.*` field NAME is changed. Only string values change.
- [ ] `scripts/lib/default-config.d.mts` unchanged (string fields stay strings).
- [ ] `scripts/lib/resolve-config.mjs` `defaultConfigPath(repoRoot)` updated: now returns `path.join(repoRoot, '.ralph-overview', 'config.json')`. ADD a fallback: if that file does not exist AND `path.join(repoRoot, '.ralph', 'overview-config.json')` exists, use the legacy path AND emit a one-shot `console.warn('[ralph-overview] Detected legacy .ralph/overview-config.json — see docs/migration-v2.4-to-v2.5.md for the relocation guide.')`. The `OVERVIEW_CONFIG_PATH` env var still takes precedence over both.
- [ ] `scripts/lib/resolve-config.mjs` `localOverlayPath` reuses the parent dir of the selected config path; no special-case needed (the `parsed.dir` resolution handles both legacy and new locations).
- [ ] `templates/overview-config.template.json` updated to the new defaults (paths + the new `dataFile`).
- [ ] `templates/overview-config.schema.json` unchanged (no schema shape change).
- [ ] `templates/overview-data.template.js` is supplemented with `templates/overview-data.template.json` (a JSON-form template). The `.js` template stays for users explicitly opting into the legacy form via `--legacy-layout` (see US-A7).
- [ ] `scripts/init-consumer.mjs`: by default, writes `.ralph-overview/config.json` (new layout) + `.ralph-overview/data.json` (or `.json` template). Adds a `--legacy-layout` flag that re-routes both writes to the v2.4.x paths for users who explicitly want to defer migration.
- [ ] New unit tests in `scripts/lib/__tests__/`:
  - `resolveConfig.legacyFallback.test.mjs`: confirms that when only `.ralph/overview-config.json` exists, it is selected with a `console.warn`; when only `.ralph-overview/config.json` exists, it is selected silently; when both exist, the new path wins (no warn).
  - `resolveConfig.envOverride.test.mjs`: confirms `OVERVIEW_CONFIG_PATH` still beats both auto-discovered paths.
  - `defaultConfig.newPaths.test.mjs`: snapshot-test the resolved-config object structure.
- [ ] Existing `resolve-config.test.mjs` tests pass (no shape regression).
- [ ] `pnpm --filter ralph-overview test` passes.
- [ ] `pnpm --filter ralph-overview typecheck` passes.

**Dependencies:** US-A1 (loader auto-detect must exist before consumers can rely on `dataFile: '.ralph-overview/data.json'` working).

**Estimated complexity:** medium

---

## US-A3: Watcher lock-path + owner-marker config-driven

**Description:** As a watcher, I want the sync lock and owner-marker paths to be derived from the resolved config so that consumers can override them and so that the default lands in `.ralph-overview/generated/.lock/`.

**Acceptance Criteria:**
- [ ] `scripts/lib/watch-ralph-state.mjs` `getWatcherOwnerPath(repoRoot)` (line ~515) is REPLACED with a config-driven equivalent. Option A: `getWatcherOwnerPath(config)` reads `config.watcherOwnerFile` (new optional field, defaulted to `.ralph-overview/generated/.lock/watcher.owner` in `default-config.mjs`); falls back to a derived `path.join(path.dirname(config.lockFile), 'watcher.owner')` when the field is absent, so consumers who only override `lockFile` get the owner-marker in the right place automatically. Option B (simpler): always derive `path.join(path.dirname(config.lockFile), 'watcher.owner')`; no new config field. **Recommend Option B** unless implementer finds a reason to want independent owner-marker override.
- [ ] All call sites of `getWatcherOwnerPath` updated to pass the resolved config (or its derived path). Search: `grep -rn 'getWatcherOwnerPath' D:/ai-developer-toolkit/plugins/ralph-overview/`. Known callers include `scripts/lib/watch-ralph-state.mjs` (self-reference), `tools/overview-mcp/src/watcher-supervisor.ts`, possibly `tools/overview-mcp/src/tools/watcher-status.ts`.
- [ ] Lock dir mkdir-p: `scripts/lib/sync-lock.mjs:11-12` already does `fs.mkdir(path.dirname(absoluteLockPath), { recursive: true })`. Verify that the new nested `.ralph-overview/generated/.lock/` path is created cleanly on first lock acquisition (test: rm -rf the dir, run a sync, lock file appears).
- [ ] Same mkdir-p for the owner-marker write path (search `openSync(ownerPath, 'wx')` site — `scripts/lib/watch-ralph-state.mjs` near the marker-claim block. Ensure the parent dir exists before the claim, otherwise first-run will fail with ENOENT).
- [ ] `tools/overview-mcp/src/__tests__/three-mcp-integration.test.ts:17,70` hard-codes `overview-watcher.owner` filename — update to compose from config or use the new default `.ralph-overview/generated/.lock/watcher.owner` filename. Confirm no other tests hard-code the owner-marker path.
- [ ] Sweep `grep -rn '\.ralph/overview-watcher\.owner\|\.ralph/overview-sync\.lock' D:/ai-developer-toolkit/plugins/ralph-overview/` returns zero hits in code (excluding CHANGELOG.md, docs/, AGENTS.md historical/migration notes which can keep references explaining the old paths).
- [ ] New unit test: simulate a config with `lockFile: '<tmp>/custom/lock'` and verify the owner-marker derives to `<tmp>/custom/watcher.owner` (Option B); or with the explicit `watcherOwnerFile` override (Option A).
- [ ] Existing `sync-lock.test.mjs`, `watch-ralph-state.test.mjs` pass.
- [ ] `pnpm --filter ralph-overview test` and `pnpm --filter @ralph-overview/mcp test` pass.

**Dependencies:** US-A2 (default lockFile changes).

**Estimated complexity:** medium

---

## US-A4: Viewer fetch-bootstrap + Vite plugin migration

**Description:** As the viewer, I want to load `data.json` and `ralph-state.json` via runtime fetch (dev) or inlined `<script type="application/json">` blocks (prod), so that the data layer can be pure JSON without losing the offline-openable single-file `overview.html` artifact contract.

**Acceptance Criteria:**
- [ ] `tools/overview-viewer/overview.html` no longer has the static `<script src="./overview-data.js"></script>` and `<script src="./overview-ralph-state.js"></script>` tags. Replace with a single `<div id="root">Loading overview data…</div>` + the existing `<script type="module" src="/src/main.tsx"></script>` (or a new `src/bootstrap.tsx`).
- [ ] New `tools/overview-viewer/src/bootstrap.ts` (or top-of-`main.tsx`): an async `loadAndMount()` that:
  1. Tries to read `<script type="application/json" id="overview-data">` from the DOM. If present, `JSON.parse(textContent)` → `window.OVERVIEW_DATA`. If absent, `await fetch('./data.json').then(r => r.json())`.
  2. Same for `id="overview-ralph-state"` vs `./ralph-state.json` (this one optional — `.catch(() => ({}))` if missing).
  3. Then `import('./mountApp.ts')` and call `mountApp()` (or call the existing `ReactDOM.createRoot(...).render(<App/>)` directly).
- [ ] `App.tsx:29-31` `getOverviewData()` and the existing `window.OVERVIEW_DATA` contract are UNCHANGED. Only the entry-script changes.
- [ ] `tools/overview-viewer/vite.config.ts` dev-server middleware:
  - Remove the `/overview-data.js` and `/overview-ralph-state.js` middleware handlers that synthesize JS shims (lines ~92–104, ~150–162).
  - Add `/data.json` and `/ralph-state.json` middleware that reads `config.dataFile` and `config.outputs.sidecarJson` respectively, serves raw JSON, and triggers `overview-data:update` / `overview-ralph-state:update` HMR events on file change (preserving the existing dev-server live-reload behavior).
  - The `transformIndexHtml` `handler(html, ctx)` (lines ~110–180) no longer needs to swap `<script src="./overview-data.js">` for inlined JS. It needs to ADD `<script type="application/json" id="overview-data">…</script>` and the ralph-state equivalent BEFORE the `<script type="module" src="/src/main.tsx">` tag at PRODUCTION-BUILD time only (skip in dev).
- [ ] The production build still emits a single self-contained `overview.html` at `config.outputs.viewerHtml`. Confirm by manual smoke: copy the built artifact to `/tmp/`, open via `file:///tmp/overview.html` in a browser, verify it renders with non-empty kanban/commands.
- [ ] **Legacy `.js` shim retained for HMR back-compat in dev only**: the watcher continues to emit a small `outputs.sidecarJs` file (the `window.OVERVIEW_RALPH_STATE = …` shim form), so external dev workflows that load the file directly still work. The viewer no longer reads it; it's purely a dev-tool artifact.
- [ ] Existing viewer tests under `tools/overview-viewer/src/__tests__/` continue to pass. New tests:
  - `bootstrap.test.ts`: confirms inline-block path is preferred over fetch; fetch is used when inline block is absent.
  - `bootstrap.errorHandling.test.ts`: confirms a failed fetch shows the "Failed to load overview data:" message in the root div.
  - Update `devServerHtml.test.ts` to assert the new HTML shape (no script-tag swap; expect inlined `<script type="application/json">` blocks in prod-built HTML).
- [ ] `pnpm --filter ralph-overview test:viewer` passes.
- [ ] `pnpm --filter ralph-overview typecheck` passes.
- [ ] Manual smoke: `pnpm --filter ralph-overview build:viewer` (or equivalent), open produced `overview.html` via file://, verify render.

**Dependencies:** US-A2 (depends on `outputs.snapshot` / `outputs.sidecarJson` / `outputs.viewerHtml` defaults pointing to the new locations, although technically file-independent of US-A3).

**Estimated complexity:** large

---

## US-A5: Skill SKILL.md decoupling + Copilot mirror regen

**Description:** As a skill consumer, I want skills (`work-on`, `triage`, `blocker-report`) to derive snapshot/lock paths from config (or call MCP) rather than hardcoding `plans/overview-snapshot.json` and `.ralph/overview-sync.lock`, so that the migration doesn't silently break the skills on consumers that have moved to `.ralph-overview/`.

**Acceptance Criteria:**
- [ ] `skills/work-on/SKILL.md`: replace `<repo-root>/plans/overview-snapshot.json` literal (line ~45) with a derivation step that uses the existing `node "$plugin_root/bin/ralph-overview.mjs" cli derive-next-command --repo "$repo_root" --task <id>` helper (which already loads config and reads the right snapshot path). The MCP-first path (lines ~33–43) is unchanged. The fallback path is REWRITTEN to call the CLI helper instead of reading the literal snapshot.
- [ ] Same treatment for `skills/triage/SKILL.md` and `skills/blocker-report/SKILL.md`. Search each for `plans/overview-` and `.ralph/overview-sync.lock` literals; replace with either MCP calls or CLI-helper-derived paths.
- [ ] Lock-preflight pseudocode in `work-on/SKILL.md` (lines ~145–157) references `config.lockFile` (good) but the example string is `.ralph/overview-sync.lock` (bad — that's the default, not a literal). Update the example to `.ralph-overview/generated/.lock/sync.lock` so users reading the skill don't get the wrong impression about the modern default; keep the wording "config.lockFile (default ...)" to make the source-of-truth explicit.
- [ ] **Forbidden-token grep**: `grep -rn 'plans/overview-snapshot\.json\|plans/overview-ralph-state\|plans/overview-data\|\.ralph/overview-sync\.lock\|\.ralph/overview-watcher\.owner' D:/ai-developer-toolkit/plugins/ralph-overview/skills/ D:/ai-developer-toolkit/plugins/ralph-overview/.copilot-plugin/copilot-skills/` returns zero hits (excluding intentional migration-doc references that explain the move).
- [ ] Copilot mirrors under `.copilot-plugin/copilot-skills/` are REGENERATED from the source skills via `node scripts/generate-copilot-artifacts.mjs` (or the documented regen command). The mirror is generated, not hand-authored; the source change must regenerate the mirror in the same commit.
- [ ] Verify no drift: `node scripts/generate-copilot-artifacts.mjs --check` (if a `--check` mode exists) exits 0; otherwise diff the generated output against the committed mirror and assert zero diff.
- [ ] Follow-up task captured: add `overview.snapshot` / `overview.task` / `overview.sidecar_diagnostics` MCP tools so a future migration can flip skills to MCP-only. Proposed id: `ralph-overview-mcp-snapshot-task-tools`. Tracked in plan.md OQ #3 resolution; this story's acceptance does NOT require adding the MCP tools.
- [ ] `pnpm --filter ralph-overview test` passes.

**Dependencies:** US-A2 (skill examples reference the new defaults).

**Estimated complexity:** small-to-medium

---

## US-A6: Tests + back-compat coverage

**Description:** As a maintainer, I want a test matrix that exercises both layouts (legacy `.ralph/` + new `.ralph-overview/`), both data file formats (`.js` + `.json`), and the back-compat envelope (deprecation warning fires, legacy override still wins), so that regressions are caught at PR time.

**Acceptance Criteria:**
- [ ] Tests added under `scripts/lib/__tests__/` and `tools/overview-mcp/src/__tests__/` covering:
  - JSON data loader: round-trip a representative `overview-data.rich.json` fixture; assert deep-equal to the JS-fixture equivalent.
  - Multi-statement JS loader: codexu's `globalThis.window` + `window.OVERVIEW_DATA` two-statement shape parses successfully and the deprecation `console.warn` fires.
  - 3+ statement JS: rejected.
  - Auto-detect by extension: `loadOverviewData('foo.json')` vs `loadOverviewData('foo.js')` routes correctly.
  - Default-config new paths: a config-less consumer resolves `dataFile: '.ralph-overview/data.json'`, `outputs.snapshot: '.ralph-overview/generated/snapshot.json'`, etc.
  - Legacy config fallback: a consumer with only `.ralph/overview-config.json` is picked up; the `console.warn` fires; the legacy config's `outputs.*` overrides are still honored.
  - New consumer (`.ralph-overview/config.json` exists): picked silently; `console.warn` does NOT fire.
  - Both present: new wins.
  - `OVERVIEW_CONFIG_PATH` env: still beats both.
  - Lock-path mkdir-p: nested `.ralph-overview/generated/.lock/` is created on first lock.
  - Owner-marker derives to `path.dirname(lockFile)/watcher.owner` (or the configured override).
  - Viewer bootstrap: inline-block path preferred over fetch; fetch fallback works; failed fetch surfaces error message.
  - Skill forbidden-token grep test (new `scripts/lib/__tests__/skillForbiddenTokens.test.mjs`): asserts no `plans/overview-` literals in skill bodies.
- [ ] Forbidden-token grep over the whole plugin (excluding `CHANGELOG.md`, `docs/migration-*.md`, `AGENTS.md` historical context blocks):
  ```bash
  grep -rn 'plans/overview-' \
    --include='*.{ts,mjs,js,d.mts,test.mjs,test.ts,tsx,html,json}' \
    --exclude-dir=node_modules \
    --exclude-dir=dist \
    D:/ai-developer-toolkit/plugins/ralph-overview/scripts \
    D:/ai-developer-toolkit/plugins/ralph-overview/tools \
    D:/ai-developer-toolkit/plugins/ralph-overview/skills \
    D:/ai-developer-toolkit/plugins/ralph-overview/.copilot-plugin \
    D:/ai-developer-toolkit/plugins/ralph-overview/templates
  ```
  Must return zero hits (test fixtures that explicitly test the legacy `.js` path are OK if they use a tmpdir-local path, not `plans/`).
- [ ] `pnpm --filter ralph-overview test` and `pnpm --filter @ralph-overview/mcp test` pass.
- [ ] Test coverage is at least at parity with v2.4.1 baseline (no story uncovers a metric drop).

**Dependencies:** US-A1, US-A2, US-A3, US-A4 (covers them).

**Estimated complexity:** medium

---

## US-A7: CHANGELOG + migration guide + version bump

**Description:** As a consumer upgrading from v2.4.x, I want a clear migration guide that tells me exactly which 3 lines of config to change to keep the legacy layout vs adopt the new layout, so that the upgrade is a 2-minute decision.

**Acceptance Criteria:**
- [ ] `CHANGELOG.md` v2.5.0 entry under `## [2.5.0] - YYYY-MM-DD`:
  - **Added:** JSON support for `dataFile`; `.ralph-overview/` layout with `generated/` subdir.
  - **Changed:** Default `dataFile` is `.ralph-overview/data.json`; default `outputs.*` paths under `.ralph-overview/generated/`; default `lockFile` under `.ralph-overview/generated/.lock/sync.lock`; default watcher owner-marker derives from `lockFile`. **Field NAMES unchanged.**
  - **Deprecated:** `.js` data file format. Loader emits one-shot `console.warn` per process. Removal in v2.6.0.
  - **Fixed:** `parseOverviewData` 1-statement enforcement relaxed to allow a leading `globalThis.window = …` polyfill before `window.OVERVIEW_DATA = …`. Fixes pre-existing bug where consumers with the polyfill (e.g., codexu) couldn't run sync.
  - **Migration:** Pointer to `docs/migration-v2.4-to-v2.5.md`.
- [ ] New `docs/migration-v2.4-to-v2.5.md` containing:
  - Decision matrix: "Stay on v2.4.x layout" vs "Adopt v2.5.x layout" — what each requires.
  - For "stay on legacy layout": the exact 3-line `.ralph/overview-config.json` snippet (`dataFile`, `outputs.*`, `lockFile`) that preserves current behavior — for users who can't migrate immediately.
  - For "adopt new layout": the 4-step migration recipe (move config file, convert data to JSON, run sync, git rm stale files) with example commands.
  - The deprecation timeline for the `.js` loader (one minor version; removed in v2.6.0).
- [ ] `docs/configuration.md` updated: new defaults documented; legacy fallback documented; new `dataFile` extension auto-detection documented.
- [ ] `docs/extending.md` updated: "Reading task/snapshot state" section uses new default paths in examples.
- [ ] `docs/migration-v1-to-v2.md` updated: the example owner-marker `node -e` snippet at line 145 uses the new path (or both paths with a note explaining which version each applies to).
- [ ] `AGENTS.md` (plugin's own, not codexu's): owner-marker references at lines 64, 118, 120 updated to new path; sync-lock references updated.
- [ ] `README.md`: owner-marker reference (line 33) updated.
- [ ] `tools/overview-mcp/README.md`: owner-marker reference (line 87) updated.
- [ ] `tools/overview-viewer/AGENTS.md`: references to `OVERVIEW_DATA` script-tag bootstrap updated to describe the fetch / inline-block bootstrap.
- [ ] Version bumps:
  - `.claude-plugin/plugin.json`: `2.4.1` → `2.5.0`.
  - Any sibling `.copilot-plugin/plugin.json` (verify location during impl): same bump.
  - Root `package.json` (workspace): leave at `1.0.0` per the v2.4.0 changelog note (it's private staging metadata).
  - `tools/overview-mcp/package.json`: confirm whether it has its own version that needs bumping; align with whatever the toolkit's release process expects.
- [ ] Marketplace index entries (in `ai-developer-toolkit/`'s marketplace metadata): bump to 2.5.0 wherever the plugin is listed.
- [ ] CHANGELOG.md's `[Unreleased]` section is cleared of items that landed in v2.5.0 (the `test:lib` script consistency fix from the v2.4.1 [Unreleased] block was already merged; verify nothing else is pending).
- [ ] All earlier-story acceptance criteria still pass (typecheck, tests, regen-mirror check).
- [ ] `pnpm --filter ralph-overview build` (if a release build exists) succeeds.

**Dependencies:** US-A1, US-A2, US-A3, US-A4, US-A5, US-A6 — must land last in Job 1.

**Estimated complexity:** small (mechanical docs + version bumps; the engineering risk is exhausted by earlier stories).

---

# JOB 2 — Codexu adoption (after plugin v2.5.0 ships)

Branch: `ralph/<task-slug>-codexu` off `Evyatar108/codexu:main`. Worktree: codexu primary (lead is on main per AGENTS.md; impl uses a worktree `D:/codexu-<slug>/` per AGENTS.md "Cross-repo impl spawns need worktrees in EVERY shared repo" — although this is a single-repo job, the worktree convention still applies for impl-phase isolation).

**Precondition:** Plugin v2.5.0 has shipped + the local install (`~/.copilot/installed-plugins/ai-developer-toolkit/ralph-overview/` or `~/.claude/plugins/cache/.../ralph-overview/`) is updated. Verify with `node bin/ralph-overview.mjs --version` (or equivalent) before starting.

## US-B1: Convert overview-data.js → JSON; extract SCHEMA.md; move config

**Description:** As codexu, I want to move my hand-curated overview data into the new `.ralph-overview/` layout in a single atomic commit so that the dashboard never sees a partial / split-brain state.

**Acceptance Criteria:**
- [ ] Create `.ralph-overview/` directory at codexu repo root.
- [ ] Extract the leading `/* … */` schema comment (lines 1–19 of `plans/overview-data.js`) into `.ralph-overview/SCHEMA.md`. Reformat as Markdown:
  - The opening `OVERVIEW_DATA schema for plans/overview.html.` line becomes the file title `# OVERVIEW_DATA schema` (with a sub-line noting "renders into `.ralph-overview/generated/overview.html` as of plugin v2.5.0").
  - Each `* fieldName: description.` line becomes a Markdown list item.
  - The trailing paragraph about parallel-isolation invariants is preserved as a "## Mutation discipline" section.
- [ ] Convert `plans/overview-data.js` to `.ralph-overview/data.json`:
  - Use a one-shot Node script: `node -e "globalThis.window = globalThis.window || {}; require('./plans/overview-data.js'); console.log(JSON.stringify(window.OVERVIEW_DATA, null, 2));" > .ralph-overview/data.json`
  - **Note:** this requires the local plugin install to be on a version that tolerates the 2-statement JS form (`parseOverviewData` from plugin v2.5.0+, OR a manual sed/awk strip of the polyfill line for the conversion step). If running pre-plugin-v2.5.0 install for the conversion, manually strip line 25 (the `globalThis.window = …` polyfill) and line 26's `window.OVERVIEW_DATA =` prefix + trailing `;` before passing through `node -e "console.log(JSON.stringify(JSON.parse(/* file content as raw text via fs.readFileSync */), null, 2))"`. The simpler path is to do the conversion AFTER the plugin install is updated.
  - Validate: `node -e "JSON.parse(require('fs').readFileSync('.ralph-overview/data.json', 'utf8'))"` exits 0.
  - Drift check: stable-stringify of the JSON form deep-equals stable-stringify of the parsed JS form. (See plan.md verification gates.)
- [ ] Move `.ralph/overview-config.json` → `.ralph-overview/config.json`. Update every `outputs.*` to point under `.ralph-overview/generated/<prefix-stripped>.{json,jsonl}`. Update `dataFile` to `.ralph-overview/data.json`. Either drop `lockFile` (inherit new default) or set it to `.ralph-overview/generated/.lock/sync.lock` explicitly. Update `ralphRoot` if there's a relocation; otherwise leave `.ralph` (jobs live under `.ralph/jobs/` regardless — they're per-task workdirs, not overview state).
- [ ] Create `.ralph-overview/generated/` directory and `.ralph-overview/generated/.lock/` directory with `.gitkeep` files so the dirs are tracked even when empty.
- [ ] Do NOT yet delete the old `plans/overview-*.{js,json,jsonl,html}` files or `.ralph/overview-*.{json,lock,owner}` files — that's US-B2's atomic step after sync-verify.
- [ ] Commit shape: `chore(plans): introduce .ralph-overview/ layout (US-B1)` — adds config + data + SCHEMA.md, no deletes yet. Keeps the diff small for review.
- [ ] Codexu-specific check: confirm the leading comment of `plans/overview-data.js` carries no codexu-only context that isn't in SCHEMA.md (the Plan 12 migration note at lines 20–24 about `ui.*` strings should also land in SCHEMA.md as a section "## Codexu UI override convention", because it explains a codexu-specific consumer behavior that future agents will need to know).

**Dependencies:** Job 1 must be fully shipped + the local plugin install must reflect v2.5.0.

**Estimated complexity:** medium (mechanical but error-prone: one wrong character in the JSON conversion breaks the dashboard).

---

## US-B2: Run sync; verify new-layout regeneration; git rm stale files

**Description:** As codexu, I want to verify that the new layout produces an equivalent generated state before deleting the old files, so that I can roll back if drift is detected.

**Acceptance Criteria:**
- [ ] Pre-step: `cp plans/overview-data.js plans/overview-data.js.bak` (or `git stash` it after US-B1 commit — choose whichever the impl member prefers; the .bak is the simpler choice).
- [ ] Run `pnpm sync-ralph-state` (or equivalent direct invocation: `node bin/ralph-overview.mjs sync --repo .`). It must exit 0 and write:
  - `.ralph-overview/generated/snapshot.json`
  - `.ralph-overview/generated/ralph-state.{json,js}`
  - `.ralph-overview/generated/recommendations.json`
  - `.ralph-overview/generated/dependency-graph.json`
  - `.ralph-overview/generated/activity.jsonl` (may be empty if no recent activity)
  - `.ralph-overview/generated/snapshot.schema.json`
- [ ] Verify nothing was emitted to the OLD locations (`plans/overview-*.json`, `.ralph/overview-sync.lock`).
- [ ] Drift check: compare key counts and a structural hash between the freshly-emitted `.ralph-overview/generated/snapshot.json` and the pre-existing `plans/overview-snapshot.json` (which is from the last pre-migration sync). Expect: same `tasks[]` ids, same `generatedAt` fields populated, structural keys match. Minor differences in `generatedAt` timestamps and other freshness fields are EXPECTED.
- [ ] `git rm`:
  - `plans/overview-data.js`
  - `plans/overview-data.js.bak` (delete after drift check, NOT committed)
  - `plans/overview-snapshot.json`
  - `plans/overview-snapshot.schema.json`
  - `plans/overview-ralph-state.js`
  - `plans/overview-ralph-state.json`
  - `plans/overview-recommendations.json`
  - `plans/overview-dependency-graph.json`
  - `plans/overview-activity.jsonl` (and any `.1.jsonl` backup)
  - `plans/overview.html`
  - `plans/overview.html.next` (if present)
  - `.ralph/overview-config.json`
  - `.ralph/overview-sync.lock` (if tracked; usually gitignored — `git rm --cached --ignore-unmatch`)
  - `.ralph/overview-watcher.owner` (same — usually gitignored)
- [ ] KEEP:
  - `plans/overview-data-split.md`
  - `plans/overview-viewer-polish-seed.md`
  - `plans/overview-vite-react.md`
  - `tasks/INDEX.md` (regenerated by `outputs.tasksIndex` which still defaults to `tasks/INDEX.md`)
- [ ] Update `.gitignore`: any `.ralph/overview-*` entries are removed; add `.ralph-overview/generated/.lock/sync.lock` (or similar runtime-only files that shouldn't be committed even though `.lock/` is tracked).
- [ ] Verify the lock-dir is correctly populated post-sync: `.ralph-overview/generated/.lock/watcher.owner` exists when the watcher is running, `.lock/sync.lock` is held briefly during sync.
- [ ] Commit shape: `chore(plans): adopt .ralph-overview/ layout (US-B2 — sync + git rm stale)`.

**Dependencies:** US-B1.

**Estimated complexity:** medium

---

## US-B3: Doc sweep

**Description:** As codexu, I want every reference to `plans/overview-snapshot.json`, `plans/overview-data.js`, `.ralph/overview-watcher.owner`, `.ralph/overview-sync.lock` in tracked Markdown updated to the new paths, so that future agents reading docs see consistent path information.

**Acceptance Criteria:**
- [ ] `AGENTS.md` updated:
  - All `plans/overview-snapshot.json` → `.ralph-overview/generated/snapshot.json`
  - All `plans/overview-data.js` → `.ralph-overview/data.json`
  - All `.ralph/overview-watcher.owner` → `.ralph-overview/generated/.lock/watcher.owner`
  - All `.ralph/overview-sync.lock` → `.ralph-overview/generated/.lock/sync.lock`
  - All `plans/overview-ralph-state.{js,json}` → `.ralph-overview/generated/ralph-state.{js,json}`
  - The "Copilot migration milestone" block item (b) is REWRITTEN to say the `parseOverviewData` 1-statement bug is FIXED in plugin v2.5.0 (no longer a follow-up). Optionally retire the item entirely or reframe as a historical note ("Fixed 2026-MM-DD").
- [ ] `docs/fork-roadmap.md`: same find-and-replace pass.
- [ ] `docs/fork-notes.md`: same.
- [ ] `plans/overview-data-split.md`: find-and-replace references to `plans/overview-data.js` → `.ralph-overview/data.json`; clarify that the "split" framing now refers to `.ralph-overview/data.json` (hand-curated) vs `.ralph-overview/generated/ralph-state.json` (watcher-generated), not the historical `plans/overview-data.js` vs `plans/overview-ralph-state.{js,json}` split.
- [ ] `plans/overview-viewer-polish-seed.md`, `plans/overview-vite-react.md`: scan + update any path references.
- [ ] `CLAUDE.md` (gitignored pointer): no changes needed, but verify it still points to AGENTS.md correctly.
- [ ] **Forbidden-token grep**: from codexu repo root,
  ```bash
  grep -rn 'plans/overview-snapshot\.json\|plans/overview-data\.js\|plans/overview-ralph-state\|\.ralph/overview-watcher\.owner\|\.ralph/overview-sync\.lock' \
    --include='*.md' \
    --exclude-dir=node_modules \
    --exclude-dir=.ralph \
    --exclude-dir=.git \
    .
  ```
  Must return zero hits, EXCEPT inside the migration commit message itself (if a `MIGRATION.md` is added — not required by this plan), or inside a deliberately-historical "what changed" section explaining the move.
- [ ] Commit shape: `docs: update path references after .ralph-overview/ adoption (US-B3)`.

**Dependencies:** US-B2.

**Estimated complexity:** small (mostly sed-style mechanical edits).

---

## US-B4: E2E smoke verification

**Description:** As codexu, I want a full end-to-end smoke test of the new layout — sync, viewer, MCP — so that I can declare the migration complete with confidence.

**Acceptance Criteria:**
- [ ] `pnpm sync-ralph-state` exits 0; touches files only under `.ralph-overview/`; does NOT touch `plans/` or `.ralph/overview-*`.
- [ ] `pnpm overview` (the Vite dev server) starts; the dashboard loads in a browser; no console errors visible in DevTools; the kanban/command list/activity panel/phase tree all show non-empty content for known tasks. (Manual visual smoke. Capture a screenshot in the impl member's report.)
- [ ] `pnpm overview:build` (or equivalent) produces a fresh `.ralph-overview/generated/overview.html`. Open via `file://` — verify renders standalone.
- [ ] `mcp__ralph-overview__overview_parallel_ready_tasks` returns non-empty results from the new snapshot. (If the MCP server caches old paths, restart it. AGENTS.md has the overview-reset skill for this.)
- [ ] `mcp__ralph-overview__overview_validate_data` returns `ok: true` for the new `.ralph-overview/data.json`.
- [ ] Lead's `/work-on <task-id>` slash command works against the new layout (skill helper resolves config-driven snapshot path, not the hardcoded `plans/overview-snapshot.json`).
- [ ] Watcher: `node bin/ralph-overview.mjs sync --repo . --watch` (or `pnpm sync-ralph-state:watch`) starts, claims the new owner-marker at `.ralph-overview/generated/.lock/watcher.owner`, refreshes mtime ~1Hz. Confirm via `ls -la .ralph-overview/generated/.lock/` showing both files updating.
- [ ] Re-verify the lead's bookkeeper workflow: spawn a one-off member via `crews.js spawn-member`, watch it appear in the kanban via the watcher's auto-update, watch the snapshot regenerate. Smoke-test only; no functional change to the crews flow.
- [ ] If any smoke gate fails: revert the codexu commits (US-B1, US-B2, US-B3) and re-spawn a debug member with the failure details.
- [ ] Commit shape: this story may not produce a code commit. If verification passes, the impl member's `kind=done` report carries the smoke evidence. If a small follow-up patch is needed (e.g., a missed `.gitkeep`), commit as `chore: post-migration cleanup (US-B4)`.

**Dependencies:** US-B1, US-B2, US-B3.

**Estimated complexity:** small (verification only, no new code).

---

# Cross-cutting non-goals

- **No new MCP tools** (`overview.snapshot`, `overview.task`, etc.) — tracked as follow-up `ralph-overview-mcp-snapshot-task-tools`.
- **No retirement of `bin/ralph-overview.mjs` resolver wrapper** — tracked as follow-up `ralph-overview-resolver-wrapper-retirement`.
- **No relocation of `tasks/INDEX.md`** — intentional, see plan.md.
- **No relocation of `~/.cache/ralph-overview-mcp/watcher-parent-<mcpPid>.owner`** — that's per-MCP-process, not per-repo.
- **No upstream MR to slopus/happy** — this is a fork-local + plugin-local migration. Codexu is the only known consumer of the plugin today.
