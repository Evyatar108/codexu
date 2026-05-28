# Follow-up: US-008 End-to-End Copilot Smoke Gate (deferred from v2.4.0)

**Origin job**: `.ralph/jobs/ralph-overview-copilot-mirror/` (ralph-overview v2.4.0 ship)
**Original spec**: see `plan.md` US-008 in the same directory, and the v2.4.0 `CHANGELOG.md` "Deferred — End-to-End Copilot Smoke (US-008)" section.
**Deferred at**: 2026-05-28
**Authorization**: operator (overview-bookkeeper relay 4c26d7fb-890e-492e-884a-396836060e8d)

## What was shipped in v2.4.0

All local artifacts for the Copilot mirror landed:
- `.github/plugin/plugin.json` Copilot manifest (`skills` + `mcpServers` declarations)
- `.copilot-plugin/copilot-skills/{work-on,triage,blocker-report,overview-init}/SKILL.md` (4 generated mirrors)
- `scripts/generate-copilot-artifacts.mjs` refactored output path, path-consistency self-check, forbidden-token assertion
- Source skill PATH-free dispatcher invocations (`work-on`, `triage`, `blocker-report`)
- Version bumps to 2.4.0 across `.claude-plugin/plugin.json`, `.github/plugin/plugin.json`, and 3 marketplace indexes
- `dist/copilot/` subtree removed
- CHANGELOG entry, README Copilot install section, CLAUDE.md mirror-path update

Local verification passed: `npm run typecheck`, `npm test --workspace=tools/overview-mcp` (11 files / 96 tests), generator `--check` parity, `--write` idempotence, forbidden-token assertion fires correctly, no bare `ralph-overview sync|cli` in generated mirrors. Direct local Copilot install of `./plugins/ralph-overview` makes the 4 skills skill-list-discoverable in Copilot.

## What blocked end-to-end verification pre-merge

Two genuine external constraints, not addressable within this PR's scope:

1. **Marketplace pins published v2.3.0**.
   `copilot plugin install ralph-overview@ai-developer-toolkit` resolves to the published v2.3.0 (which has no Copilot manifest), not the unmerged v2.4.0 topic branch. A marketplace-driven install therefore cannot exercise the v2.4.0 manifest pre-merge.

2. **Copilot CLI 1.0.55 doesn't surface plugin-manifest `mcpServers`**.
   `copilot mcp list --json` lists only workspace `.mcp.json` MCP servers — plugin-manifest `mcpServers` entries (string-path form `".mcp.json"` AND inline object form both tested via temp-marketplace probes) do not appear. The plugin MCP registration is not observable through the documented Copilot discovery path. The MCP server binary works — `overview.parallel_ready_tasks` is callable via codexu's workspace `.mcp.json`.

Concrete evidence is in `.ralph/jobs/ralph-overview-copilot-mirror/copilot-skill-smoke.log` and `iteration-result-8.json`.

## What still needs to happen (re-enable conditions)

The smoke gate can run when **both** of these hold:

- **(a)** v2.4.0 of ralph-overview is **published** to the `ai-developer-toolkit` marketplace (i.e. tagged + released after the v2.4.0 merge lands). `copilot plugin install ralph-overview@ai-developer-toolkit` then resolves to v2.4.0 instead of v2.3.0.
- **(b)** GitHub Copilot CLI publishes a version that surfaces plugin-manifest `mcpServers` in `copilot mcp list --json` (or equivalent discovery output). Tracking this requires watching Copilot CLI release notes; consider opening an upstream issue if the gap persists.

When both conditions hold, run the full US-008 acceptance criteria from `plan.md` against a fresh workspace:

1. `copilot plugin marketplace add gim-home/ai-developer-toolkit` (idempotent if already registered)
2. `copilot plugin install ralph-overview@ai-developer-toolkit` — verify `copilot plugin list` shows ralph-overview at v2.4.0 (or whatever version is current)
3. `copilot mcp list --json` — verify the ralph-overview plugin-sourced MCP server is listed with a resolved, launchable command/args path pointing at an existing `launch.cjs`. No literal `${CLAUDE_PLUGIN_ROOT}` token unless Copilot demonstrably expands it. If the launch path is unresolved, switch the manifest from `"mcpServers": ".mcp.json"` to a Copilot-only inline object using Copilot's verified plugin-root token, then re-verify.
4. Invoke `overview.parallel_ready_tasks` from a Copilot session and confirm the MCP server starts (capture transcript).
5. Verify each of `/work-on`, `/triage`, `/blocker-report`, `/overview-init` is callable from a Copilot session.
6. Verify at least one Copilot skill path runs `sync` or `cli derive-next-command` through `node <pluginRoot>/bin/ralph-overview.mjs` (no bare-`ralph-overview` PATH lookup).
7. Capture command + assertion + PASS/FAIL into a refreshed `.ralph/jobs/<follow-up-job-id>/copilot-skill-smoke.log` and require 4/4 PASS rows for the four skills.

If step 3 still shows the plugin MCP missing after Copilot CLI updates, the manifest may need to switch from `"mcpServers": ".mcp.json"` to a Copilot-only inline form with a verified plugin-root token; treat that as part of the follow-up scope.

## Suggested follow-up task entry

To be added to `plans/overview-data.js` by the bookkeeper after merge of this PR (do not hand-edit per `feedback_bookkeeper_updates_overview_data`):

- **id**: `ralph-overview-copilot-smoke-deferred` (or similar)
- **scope**: `ralph-overview`
- **lifecycle**: `tracked`
- **status**: `pending`
- **warnings**: Depends on (a) v2.4.0 marketplace publish AND (b) Copilot CLI version exposing plugin-manifest `mcpServers` in `copilot mcp list --json`. Both conditions must hold before this task is actionable.
- **prompts.impl**: link to this brief; reproduce the 7-step verification checklist above.

## Repo paths

- Topic branch: `ralph/ralph-overview-copilot-mirror` (merged to `ai-developer-toolkit/main` via fast-forward on both `origin` and `work` remotes; see merge SHAs in job-state on completion)
- Worktree (consumed at merge): `D:/ai-developer-toolkit/.worktrees/ralph-overview-copilot-mirror/`
- Evidence artifacts:
  - `.ralph/jobs/ralph-overview-copilot-mirror/copilot-skill-smoke.log`
  - `.ralph/jobs/ralph-overview-copilot-mirror/iteration-result-8.json`
  - `.ralph/jobs/ralph-overview-copilot-mirror/progress.txt`
