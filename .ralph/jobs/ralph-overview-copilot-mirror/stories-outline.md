# Stories Outline: ralph-overview Copilot Mirror

*Preliminary decomposition from `/plan-with-ralph`. Feed to `/implement-with-ralph --from-plan` for PRD generation.*

## US-001: Refactor generator output paths + add forbidden-token assertion
**Description:** As a plugin maintainer, I want `scripts/generate-copilot-artifacts.mjs` to emit Copilot mirrors under `.copilot-plugin/copilot-skills/` (not `dist/copilot/`) and to refuse Claude-only API leakage, so the generated artifacts are discoverable by Copilot and safe to ship.
**Acceptance Criteria:**
- [ ] Generator's `discoverSkillMirrors` writes targets under `<pluginRoot>/.copilot-plugin/copilot-skills/<skill>/SKILL.md`.
- [ ] `renderLocalSkillDispatch` updates BOTH path occurrences in its prompt template (canonical path + glob fallback) — derived from one shared helper/constant to prevent drift.
- [ ] Generator includes a path-consistency self-check: the embedded prompt path equals the actual output target.
- [ ] Forbidden-token assertion rejects any of `['Skill(', 'Agent(', 'BashOutput', 'run_in_background', 'EnterPlanMode', 'ExitPlanMode']` in post-substitution output.
- [ ] `--check` mode reports skill name + target path on drift.
- [ ] Existing `RALPH_OVERVIEW_PLUGIN_ROOT` precedence + `lib/atomic-write.mjs` usage preserved.
- [ ] Typecheck (if applicable) and any existing generator unit tests pass.
**Dependencies:** None
**Estimated complexity:** small

## US-002: Refactor source skills to use plugin-dispatcher path (no PATH lookup)
**Description:** As a Copilot user, I want `/work-on`, `/triage`, and `/blocker-report` to invoke `ralph-overview` via `node <pluginRoot>/bin/ralph-overview.mjs ... --repo <repo-root>` so the skills work without requiring the binary on PATH.
**Acceptance Criteria:**
- [ ] `skills/work-on/SKILL.md`, `skills/triage/SKILL.md`, `skills/blocker-report/SKILL.md` no longer contain bare `ralph-overview sync` / `ralph-overview cli` invocations.
- [ ] All shell-out invocations use the dispatcher path with the resolved plugin root token recognized by both Claude and Copilot.
- [ ] `--repo <repo-root>` is passed explicitly to `sync` and `cli derive-next-command`.
- [ ] Claude-code regression: the skills still work in a Claude Code session (use codexu as the smoke environment).
- [ ] Grep verification: `grep -nE '^[^#]*\bralph-overview (sync|cli)\b' skills/*/SKILL.md` returns no live (non-comment) matches.
**Dependencies:** None (parallel-safe with US-001)
**Estimated complexity:** small

## US-003: Generate Copilot skill mirrors
**Description:** As a Copilot user, I want the 4 user skills mirrored at `.copilot-plugin/copilot-skills/{work-on,triage,blocker-report,overview-init}/SKILL.md` so Copilot can discover them.
**Acceptance Criteria:**
- [ ] `node plugins/ralph-overview/scripts/generate-copilot-artifacts.mjs --write` produces all 4 SKILL.md files.
- [ ] Re-running `--write` is idempotent (no git diff after second run).
- [ ] Default `--check` mode exits 0 after committing the generated files.
- [ ] None of the 4 generated files contain any forbidden Claude-only token (verified by the generator's assertion AND by an external grep).
- [ ] Generated files inherit the PATH-free dispatcher invocation from US-002 (verified by grep).
**Dependencies:** US-001, US-002
**Estimated complexity:** small

## US-004: Add Copilot manifest (+ optional parity-exceptions decision)
**Description:** As a Copilot CLI user, I want `plugins/ralph-overview/.github/plugin/plugin.json` to declare the plugin, its skills directory, and its MCP server, so `copilot plugin install ralph-overview@ai-developer-toolkit` discovers everything.
**Acceptance Criteria:**
- [ ] `plugins/ralph-overview/.github/plugin/plugin.json` exists with v2.4.0 and the schema fields: `name`, `description`, `version`, `author`, `license`, `homepage`, `repository`, `keywords`, `"skills": ".copilot-plugin/copilot-skills/"`, `mcpServers`.
- [ ] Initial `mcpServers` value: `".mcp.json"` (string-path form). If US-008 verification reveals Copilot does not resolve the resulting command, switch to a verified inline object whose launch token works under Copilot (do NOT preserve `${CLAUDE_PLUGIN_ROOT}` in the inline fallback).
- [ ] `.copilot-plugin/parity-exceptions.json` is EITHER created with a one-line justification (future-hook for parity-checker consumption) OR omitted entirely per F-010 resolution. Decision documented in CHANGELOG.
**Dependencies:** US-003
**Estimated complexity:** small

## US-005: Version bumps across all version-bearing files
**Description:** As a plugin maintainer, I want v2.4.0 reflected in the Claude manifest, the new Copilot manifest, and all three marketplace indexes so installs see the new version.
**Acceptance Criteria:**
- [ ] `plugins/ralph-overview/.claude-plugin/plugin.json` has `"version": "2.4.0"`.
- [ ] `plugins/ralph-overview/.github/plugin/plugin.json` has `"version": "2.4.0"` (US-004's create has this set).
- [ ] `.claude-plugin/marketplace.json` ralph-overview entry: `"version": "2.4.0"`.
- [ ] `.github/plugin/marketplace.json` ralph-overview entry: `"version": "2.4.0"`.
- [ ] `.agents/plugins/marketplace.json` ralph-overview entry: `"version": "2.4.0"`.
- [ ] Root `plugins/ralph-overview/package.json` left at `1.0.0` (intentional, documented in CHANGELOG).
- [ ] All 5 version-bearing JSON files parse successfully (`jq . <file>` exits 0).
**Dependencies:** US-004
**Estimated complexity:** small

## US-006: Drop `dist/copilot/` cleanup
**Description:** As a plugin maintainer, I want `dist/copilot/` removed to prevent confusion over which Copilot mirror is canonical.
**Acceptance Criteria:**
- [ ] Pre-deletion grep `grep -r "dist/copilot" D:/ai-developer-toolkit/plugins/ralph-overview/ --exclude=CHANGELOG.md --exclude-dir=node_modules --exclude-dir=dist` returns NO matches in live source.
- [ ] Same grep with same exclusions at toolkit root returns no live-source matches.
- [ ] `plugins/ralph-overview/dist/copilot/` directory no longer exists.
- [ ] `node plugins/ralph-overview/scripts/generate-copilot-artifacts.mjs` (`--check` mode) still exits 0 after deletion.
**Dependencies:** US-003 (mirrors must be in new location before old is dropped)
**Estimated complexity:** small

## US-007: Documentation (CHANGELOG, README, plugin CLAUDE.md)
**Description:** As a Copilot user (and as a future maintainer), I want clear v2.4.0 docs covering install, install verification, and the new mirror location.
**Acceptance Criteria:**
- [ ] `plugins/ralph-overview/CHANGELOG.md` has `## [2.4.0] — 2026-05-27` block in Keep-a-Changelog format with `### Added`, `### Changed`, `### Removed`, `### Migration` subsections.
- [ ] `plugins/ralph-overview/README.md` has a `## Copilot CLI Installation` section that (a) shows the marketplace-add step (e.g. `copilot plugin marketplace add ...`, exact command verified against `copilot plugin --help`), (b) shows `copilot plugin install ralph-overview@ai-developer-toolkit`, (c) shows verification (`copilot plugin list`, `copilot mcp list --json`), and (d) lists the actual MCP tools derived from `server.ts` / the `stdio-tools-list.test.ts` test (NOT hardcoded from this plan).
- [ ] `plugins/ralph-overview/CLAUDE.md` no longer says `dist/copilot/` is the mirror destination; updated to `.copilot-plugin/copilot-skills/`.
- [ ] Migration section explicitly tells Copilot users about the marketplace-add prereq.
**Dependencies:** US-005 (so docs reference the correct version)
**Estimated complexity:** small

## US-008: Pre-merge Copilot install + MCP runtime verification (blocking gate)
**Description:** As the operator, I want pre-merge proof that Copilot CLI actually loads the plugin and starts the MCP server, otherwise the release is blocked.
**Acceptance Criteria:**
- [ ] Fresh Copilot CLI install on this Windows host: `copilot plugin marketplace add ...` succeeds, `copilot plugin install ralph-overview@ai-developer-toolkit` succeeds.
- [ ] `copilot plugin list` shows `ralph-overview` at v2.4.0.
- [ ] `copilot mcp list --json` shows the `ralph-overview` MCP server. The resolved `command` + `args` point at a real, existing `launch.cjs` (no unresolved `${...}` token in the output).
- [ ] The MCP server actually starts: `copilot mcp tools ralph-overview` (or equivalent) lists the tools that `server.ts` registers (currently 5: init, validate_data, parallel_ready_tasks, dev_server.start, dev_server.stop — verify against `stdio-tools-list.test.ts` expectations at impl time).
- [ ] Each of the 4 Copilot skills (`/work-on`, `/triage`, `/blocker-report`, `/overview-init`) is discoverable and executes successfully under Copilot (smoke test with at least one task each).
- [ ] Claude-code regression: in codexu, `mcp__ralph-overview__overview_parallel_ready_tasks` still works (test by spawning a fresh Claude Code session and calling the tool).
- [ ] `npm test --workspace=tools/overview-mcp` passes (catches MCP-tool-list drift between source and the test/README).
- [ ] If Copilot is not installable on the impl host, the release is BLOCKED — do not merge without this gate.
**Dependencies:** US-007
**Estimated complexity:** medium
