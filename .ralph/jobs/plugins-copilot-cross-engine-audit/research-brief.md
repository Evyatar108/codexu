# Research Brief — plugins-copilot-cross-engine-audit

## Critical preflight finding (all 4 reviewers concur)

The local checkout at `D:/ai-developer-toolkit/` is on branch `ralph/crews-review-mid-turn-v160`. Manifests in that working tree show **stale versions**:

| Plugin | Working tree (stale) | Target per task spec (on `origin/main`) |
|---|---|---|
| crews | v1.6.0 | v1.7.1 |
| ralph-orchestration | v5.44.0 | v5.46.0 |
| ralph-overview | v2.0.3, no `.copilot-plugin/` | v2.4.0 with `.copilot-plugin/` + `.github/plugin/plugin.json` mcpServers |

Codex/Copilot explicitly verified: `origin/main` carries the target versions. Codexu's `.mcp.json` points at `D:/ai-developer-toolkit/plugins/ralph-overview/launch.cjs` (this stale checkout) — a known risk for the bookkeeper.

**Audit story 0 (preflight) MUST pin versions** before running any verification: capture `git rev-parse origin/main`, plugin manifest versions, `copilot --version`, `node --version`, and either run from an isolated worktree at `origin/main` or against the installed Copilot plugin cache.

## Researcher Findings (paraphrased; full agent transcript not staged)

### crews (target v1.7.1 on main)
- Source root: `D:/ai-developer-toolkit/plugins/crews/`
- Claude manifest: `.claude-plugin/plugin.json`; Copilot manifest: `.github/plugin/plugin.json`; Copilot hooks: `.github/plugin/hooks.json`
- Hook events (Claude/native): `hooks/hooks.json` → SessionStart, UserPromptSubmit, Stop, PreToolUse, PostToolUse
- Hook events (Copilot shim layer): `.github/plugin/hooks.json` → sessionStart, agentStop, preToolUse, postToolUse, userPromptSubmit; each delegates to `hooks/copilot-*.js`
- Shim translator: `hooks/copilot-shim.js` — pure stdin/stdout shape translator (sessionId↔session_id, toolName↔tool_name, toolArgs↔tool_input)
- Engine normalization: `hooks/actors.js` `normalizeEngine()` + `buildLauncherCommand()` + `spawnMember()` (writes launcher with `CREWS_ENGINE` env)
- `--engine` flag: `hooks/commands/spawn-member.js`
- Kind-tag parser: `hooks/mailbox.js` `parseTurnTags()` (invoked by `hooks/stop.js`)
- PreToolUse listener gate: `hooks/pre-tool-use.js`
- PostToolUse 30s nag: `hooks/post-tool-use.js`
- Stop hook listener-armed + kind-tag gate: `hooks/stop.js`
- **v1.7.1-specific (on `origin/main`, not on working tree)**: `hooks/lib/session-env.js` reads `CLAUDE_CODE_SESSION_ID` / `COPILOT_AGENT_SESSION_ID` (with `COPILOT_CLI=1` precedence); `hooks/state-cwd-locator.js` + `hooks/pointer.js` implement the sessionId pointer index for restart recovery
- Copilot skill mirrors: `.copilot-plugin/copilot-skills/` (21 skills incl. spawn-member, send-to-member, stop-member, status). `/review-mail` intentionally has NO Copilot skill mirror — must use typed slash interception or CLI fallback `node tools/crews.js review-mail …`
- Slash command form differs by engine: Claude `/crews:status`, Copilot `/crews-status` (kebab, no colon) — handled by `hooks/briefing/context.js`
- Existing manual smoke runbook: `docs/smoke-runbook.md` — REUSE as scaffolding

### ralph (target v5.46.0 / installed as `ralph-orchestration`)
- Source root: `D:/ai-developer-toolkit/plugins/ralph/`
- Manifests: `.claude-plugin/plugin.json`, `.github/plugin/plugin.json` (with `skills: .copilot-plugin/copilot-skills/`)
- **v5.46.0-specific (on origin/main)**: `src/ralph.mjs`, `src/review-loop.mjs`, `src/codex-exec.mjs`, `src/copilot-exec.mjs` — all-Node migration (replaces `ralph.sh`, `review-loop.sh`, `codex-exec.sh`, `copilot-exec.sh`)
- shell:true fix (v5.45.1 → on main as v5.46.0): `src/codex-exec.mjs` and `src/copilot-exec.mjs` use `spawn(..., { shell: true })` for Windows `.cmd` shim resolution
- Working tree at v5.44.0 lacks `src/codex-exec.mjs` / `src/copilot-exec.mjs` (only shell wrappers exist) — confirms tree is stale
- Engine resolution: `src/ralph.mjs` `resolveEngine()` + `runEnginePreflight()`; supports `CODEX_EXEC_SCRIPT` / `COPILOT_EXEC_SCRIPT` env overrides; deprecated alias `claude` → warns + routes to `copilot` with model `claude-opus-4.7-1m-internal`
- Mirror generation: `scripts/generate-copilot-artifacts.mjs` + `scripts/check-copilot-parity.mjs` (static parity gate)
- Skill mirrors: `.copilot-plugin/copilot-skills/{brainstorm,implement,multi-model-investigate,plan,prepare-handoff}-with-ralph` — **Codex flagged stale `ralph.sh`/`review-loop.sh`/`codex-exec.sh` references in generated `implement-with-ralph` Copilot prose** — runtime verification required
- Agents: `agents/*.md` (12 reviewer/fixer roles); Copilot agent mirrors generated to `.copilot-plugin/agents/`
- Phase 4 + Phase 5 review-changes flow: `src/review-loop.mjs` orchestrates; reviewer subagent invocation point

### ralph-overview (target v2.4.0 — copilot mirror landed at ad4938fc on `origin/main`)
- Source root: `D:/ai-developer-toolkit/plugins/ralph-overview/`
- Claude manifest: `.claude-plugin/plugin.json`; MCP registration: `.mcp.json` (Claude side); **Copilot manifest on main**: `.github/plugin/plugin.json` declares `skills: …` AND `mcpServers: ".mcp.json"`
- Launcher: `launch.cjs` (engine-agnostic, spawns node MCP server with `RALPH_OVERVIEW_PLUGIN_ROOT`)
- CLI dispatcher: `bin/ralph-overview.mjs` — `init|sync|watch|dev|build|mcp|install-server|cli`
- MCP server entry: `tools/overview-mcp/src/server.ts` (per architect) or `tools/overview-mcp/src/index.ts` (per copilot research) — registers: `overview.init`, `overview.validate_data`, `overview.parallel_ready_tasks`, `overview.dev_server.start`, `overview.dev_server.stop`
- Watcher: `scripts/sync-ralph-state.mjs` (writes overview-ralph-state.{js,json} + activity log); supervised by `tools/overview-mcp/src/watcher-supervisor.ts`
- 4 Copilot skill mirrors expected: blocker-report, overview-init, triage, work-on
- **Known Copilot CLI gap** (documented in `CHANGELOG.md`): Copilot CLI 1.0.55 does NOT surface plugin-manifest `mcpServers` in `copilot mcp list --json`. Workspace `.mcp.json` fallback works.

## Architect Analysis (paraphrased)

### Engine abstraction quality
- **Crews**: shim layer is well-isolated; fail-closed parity locked at v1.3.0 via `FAIL_CLOSED_ERRORS` set in `copilot-shim.js`; conditional branches limited to slash-prefix (`hooks/briefing/context.js`), shell-var syntax (`hooks/listener-protocol.js`), and launcher command (`hooks/actors.js`)
- **Ralph**: engine selection at startup via `iterationEngine`/`planningEngine`; subprocess dispatch via `CODEX_EXEC_SCRIPT`/`COPILOT_EXEC_SCRIPT` overrides; `claude` is a deprecated planning-engine alias
- **Ralph-overview**: pure library, engine-agnostic — only risk is whether Copilot CLI surfaces the plugin's `mcpServers` for discovery

### Test seams per audit story
- **crews story**: 7 scenarios — spawn-member launcher; SessionStart sessionId capture (`CLAUDE_CODE_SESSION_ID` vs `COPILOT_AGENT_SESSION_ID` w/ `COPILOT_CLI=1` precedence); PreToolUse drain-confirmation gate; Stop hook listener-armed (v1.6.2) + kind-tag (mailbox.js); PostToolUse 30s nag; slash-command equivalents (Copilot kebab form); v1.7.1 sessionId pointer survival across engine restart
- **ralph story**: 6 scenarios — `/plan-with-ralph` end-to-end from Copilot member; `/implement-with-ralph` E2E; `src/codex-exec.mjs` shell:true success on Windows; `src/copilot-exec.mjs` shell:true success on Windows; Phase 4 + Phase 5 reviewer subagents fire under Copilot; all-Node migration call sites (30+) do not regress
- **ralph-overview story**: 3 scenarios — MCP tool callable via plugin-manifest registration (likely FAIL on Copilot 1.0.55) vs workspace `.mcp.json` fallback (likely PASS); watcher auto-start under `overview.dev_server.start` via Copilot; watcher-lease + snapshot freshness under Copilot

### Risk areas / unknowns
1. Copilot MCP plugin-manifest gap (CLI 1.0.55) — already documented in ralph-overview CHANGELOG, expected FAIL until newer CLI
2. Stale generated `implement-with-ralph` Copilot SKILL.md prose references `ralph.sh`/`codex-exec.sh` — runtime may invoke `src/ralph.mjs` correctly while the docs lag; needs E2E verification
3. Windows-only `shell:true` fix — must run on Windows, not POSIX, to verify the v5.45.1 narrowing
4. Bookkeeper `.mcp.json` points at `D:/ai-developer-toolkit/plugins/ralph-overview/launch.cjs` (the stale checkout); audit must not test against this path
5. v1.7.1 sessionId pointer is the riskiest new behavior — restart recovery is the migration's load-bearing feature
6. `/review-mail` has no Copilot slash mirror — relies on typed slash interception or CLI fallback; verify operator-visible UX

### Dependency graph (4 audit stories)
```
US-001 crews-copilot-audit          (independent)
US-002 ralph-copilot-audit          (independent)
US-003 ralph-overview-copilot-audit (independent — copilot mirror has LANDED at ad4938fc, no longer blocked)
US-004 audit-report-aggregation     (depends on US-001..003)
```
- File-overlap matrix: zero cross-story overlap. Each story reads its own plugin dir; each writes to a distinct sub-file under `.ralph/jobs/plugins-copilot-cross-engine-audit/` (`crews-findings.md`, `ralph-findings.md`, `ralph-overview-findings.md`); US-004 reads all three and produces `audit-report.md`.
- Stories US-001/002/003 can run in parallel.

## Codex Research (paraphrased, full at `<STAGING>/codex-research.txt`)

- Confirmed the version-stamp gap, identified `origin/main` as canonical
- Pinpointed v1.7.1-new files: `hooks/state-cwd-locator.js`, `hooks/pointer.js`, `hooks/lib/session-env.js`
- Confirmed `src/codex-exec.mjs`/`src/copilot-exec.mjs` use `shell: true` on `origin/main`
- Confirmed `ralph-overview` v2.4.0 has `.github/plugin/plugin.json` with `mcpServers: ".mcp.json"`
- Confirmed CHANGELOG-documented Copilot 1.0.55 mcpServers gap with workspace `.mcp.json` fallback
- Confirmed `docs/smoke-runbook.md` exists for reuse
- Recommended preflight: pin commits + manifests + versions before any test runs

## Copilot Research (paraphrased, full at `<STAGING>/copilot-research.txt`)

- Independently confirmed version-stamp gap
- Noted `scripts/generate-copilot-artifacts.mjs` (ralph-overview) currently emits to `dist/copilot` not `.copilot-plugin` on the stale tree — on origin/main this is fixed for ralph-overview
- Noted `/review-mail` Copilot routing: typed-slash interception or CLI mirror `node …/tools/crews.js review-mail …`
- Confirmed all 5 MCP tools: `overview.init`, `overview.validate_data`, `overview.parallel_ready_tasks`, `overview.dev_server.start`, `overview.dev_server.stop`
- Recommended scratch crew + scratch state-cwd per story so audit does not perturb codexu's live bookkeeper

## Consolidated File List (audit must reference)

### Files to READ (no edits — this is an audit, not a fix)

**crews (`D:/ai-developer-toolkit/plugins/crews/` at origin/main):**
- `.claude-plugin/plugin.json` (verify v1.7.1)
- `.github/plugin/plugin.json` (Copilot manifest)
- `.github/plugin/hooks.json` (Copilot hook events)
- `hooks/hooks.json` (Claude hook events)
- `hooks/copilot-{session-start,pre-tool-use,post-tool-use,stop,user-prompt-submit}.js`
- `hooks/copilot-shim.js`
- `hooks/actors.js` (normalizeEngine, buildLauncherCommand, spawnMember)
- `hooks/commands/spawn-member.js`, `review-mail.js`, `send-to-member.js`, `stop-member.js`, `registry.js`
- `hooks/{pre,post}-tool-use.js`, `hooks/stop.js`
- `hooks/mailbox.js` (parseTurnTags, TAG_REPORT_REGEX, VALID_KINDS)
- `hooks/briefing/context.js` (slash-prefix branching)
- `hooks/listener-protocol.js` (shell-syntax branching)
- `hooks/lib/session-env.js` (v1.7.1 — sessionId env resolution)
- `hooks/state-cwd-locator.js`, `hooks/pointer.js` (v1.7.1 sessionId pointer index)
- `.copilot-plugin/copilot-skills/` (21 skill mirrors)
- `docs/smoke-runbook.md` (reuse)
- `tools/crews.js`, `tools/wait-for-message.js`

**ralph (`D:/ai-developer-toolkit/plugins/ralph/` at origin/main):**
- `.claude-plugin/plugin.json` (verify v5.46.0)
- `.github/plugin/plugin.json` (Copilot manifest)
- `src/ralph.mjs`, `src/review-loop.mjs`
- `src/codex-exec.mjs`, `src/copilot-exec.mjs` (shell:true sites)
- `scripts/generate-copilot-artifacts.mjs`, `scripts/check-copilot-parity.mjs`
- `skills/{plan-with-ralph,implement-with-ralph,review-changes}/SKILL.md`
- `.copilot-plugin/copilot-skills/{plan,implement,brainstorm,prepare-handoff,multi-model-investigate}-with-ralph/SKILL.md`
- `agents/*.md`, `.copilot-plugin/agents/*.md` (if present)
- `CHANGELOG.md` (v5.45.1, v5.46.0 entries)

**ralph-overview (`D:/ai-developer-toolkit/plugins/ralph-overview/` at origin/main, post ad4938fc):**
- `.claude-plugin/plugin.json` (verify v2.4.0)
- `.github/plugin/plugin.json` (verify mcpServers declared)
- `.mcp.json` (workspace-fallback MCP shape)
- `launch.cjs`
- `bin/ralph-overview.mjs`
- `tools/overview-mcp/src/server.ts` (or `src/index.ts`) — MCP tool registrations
- `tools/overview-mcp/src/watcher-supervisor.ts`
- `scripts/sync-ralph-state.mjs`
- `.copilot-plugin/copilot-skills/{blocker-report,overview-init,triage,work-on}/SKILL.md`
- `CHANGELOG.md` (Copilot 1.0.55 mcpServers gap note)

### Files to WRITE (audit findings)

- `D:/harness-efforts/codexu/.ralph/jobs/plugins-copilot-cross-engine-audit/preflight.md` (US-000 capture; or include in US-001)
- `D:/harness-efforts/codexu/.ralph/jobs/plugins-copilot-cross-engine-audit/crews-findings.md` (US-001)
- `D:/harness-efforts/codexu/.ralph/jobs/plugins-copilot-cross-engine-audit/ralph-findings.md` (US-002)
- `D:/harness-efforts/codexu/.ralph/jobs/plugins-copilot-cross-engine-audit/ralph-overview-findings.md` (US-003)
- `D:/harness-efforts/codexu/.ralph/jobs/plugins-copilot-cross-engine-audit/audit-report.md` (US-004 aggregation)

### Scratch areas (per-story, do NOT touch codexu state)

- Scratch crews state-cwd: e.g. `D:/harness-efforts/codexu/.ralph/jobs/plugins-copilot-cross-engine-audit/scratch-crew/`
- Scratch ralph job: e.g. `D:/harness-efforts/codexu/.ralph/jobs/plugins-copilot-cross-engine-audit/scratch-ralph-job/`
- Scratch ai-developer-toolkit worktree at `origin/main`: e.g. `D:/ai-developer-toolkit/.worktrees/audit-main/` (per cross-repo worktree mandate)
