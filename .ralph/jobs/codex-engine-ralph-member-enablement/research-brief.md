# Research Brief — codex-engine-ralph-member-enablement

## Researcher Findings (Explore agent + direct verification)

### 1. Crews codex launcher fix HAS shipped (lead-side gate cleared)
- `ai-developer-toolkit/plugins/crews/hooks/actors.js:181-229` (`buildLauncherCommand`) and
  `:285-302` (`buildLauncherInvocation`): the codex `skipPerms` branch emits
  `--dangerously-bypass-approvals-and-sandbox` and drops `--add-dir` (shipped crews **v3.6.4**).
  `sandboxPart = skipPerms ? '--dangerously-bypass-approvals-and-sandbox' : '--sandbox read-only'`.
- The lead spawning a codex member runs the lead's OWN crews install (Copilot, **v3.12.0** — has
  the fix). So `--engine codex` members CAN start now, gated on a trusted/skipPermissions spawn.
  This retires the `crews-codex-member-spawn-does-not-start-session` blocker at the launcher layer.
- TWO crews installs are in play: (a) lead's Copilot crews 3.12.0 builds the `codex ...` launcher
  command; (b) the codex member's OWN codex-cached crews (3.6.2) provides its SessionStart /
  PreToolUse / Stop / listener hooks once it starts. (b) is stale and must be refreshed.

### 2. Codex plugin install / refresh mechanics (local-source marketplace)
- `codex plugin add <PLUGIN>@ai-developer-toolkit` is the install/reinstall command
  ("Install a plugin from a configured marketplace snapshot" — verified via `--help`).
- **Codex loads plugins from a per-version CACHE COPY** at
  `~/.codex/plugins/cache/<marketplace>/<plugin>/<version>/`, NOT the source dir (codex/CLAUDE.md
  "Plugin source edits do NOT propagate to the marketplace cache"; copilot lens cites
  `core-plugins/src/store.rs` cache layout + active-version selection).
- Current codex cache (verified `codex plugin list` + cache dir, 2026-06-07):
  - `ai-developer-toolkit/crews/3.6.2/` — installed, enabled (STALE vs source 3.12.0)
  - `ai-developer-toolkit/ralph-orchestration/5.50.0/` — installed, enabled (STALE vs source 5.52.0)
  - `ralph-overview` — NOT installed
- Refresh path: `codex plugin add crews@ai-developer-toolkit` re-copies current 3.12.0 from local
  source into a new version subdir; same for `ralph-orchestration` (5.52.0). A cachebuster /
  cache-subdir delete is only needed for SAME-version local edits (not our case — versions differ).
- **A fresh codex thread/session is required after install/update** to refresh skills/hooks/MCP.
- Marketplace `ai-developer-toolkit` is `source: local`, root `D:\harness-efforts\codexu\ai-developer-toolkit`
  (`.agents/plugins/marketplace.json`). Local source is structurally immune to the codex
  git-marketplace auto-upgrade corruption bug (`.ralph/investigations/codex-git-marketplace-snapshot-tmp-ephemeral/findings.md`:
  auto-upgrade only processes `source_type=git`; local read directly). NEVER use a git-source marketplace.

### 3. Manifest discovery + skill loading under codex
- Discovery order: `.codex-plugin/plugin.json` FIRST, then `.claude-plugin/plugin.json` fallback
  (copilot lens cites `codex-rs/utils/plugins/src/plugin_namespace.rs`).
- ralph plugin layout: `.claude-plugin/` + `.copilot-plugin/` + source `skills/`. **NO `.codex-plugin/`,
  NO codex-*.js hooks, NO `.agents/`** (verified directory listing). plugin.json declares no `skills`
  field → codex falls back to the default `skills/` root, which holds the CLAUDE-FLAVORED source skills.
- crews, by contrast, DOES ship a codex overlay: `plugins/crews/.codex-plugin/{plugin.json,hooks/hooks.json}`
  + engine-specific `hooks/codex-{session-start,pre-tool-use,post-tool-use,stop,user-prompt-submit}.js`.
  This is why crews codex members register/listen; ralph has no equivalent.
- Codex skills: `core-skills/src/{loader,render,injection}.rs` advertise skills and load full SKILL.md
  on mention, but codex provides **no Claude `Skill` tool** (no skill chaining) and no typed `Agent`
  subagents (copilot lens).

### 4. Ralph bash-orientation is mostly STALE (de-risks the seed)
- ralph **v5.46.0 deleted ALL `.sh` runtime**; production path is pure Node ESM (`node src/*.mjs`).
  `jq` is NOT required at runtime. `review-loop.mjs::engineSpawnCommand` returns `node` for `.mjs`.
- The ~23 surviving `.sh` files are TESTS only (need Git Bash on Windows). So a codex member running
  `/plan-with-ralph` or `/brainstorm-with-ralph` invokes cross-platform `node` helpers, not bash.
- Caveat (Windows): `bash`/`jq` only bite the test suite and any inline `bash` snippets still present
  in SKILL.md prose; WSL-bash-on-PATH can hang `spawnSync('bash')` (repo memory).

### 5. Lens recursion + resource
- `/plan-with-ralph` Phase 2 (research) and Phase 4 (review) spawn parallel Explore agents +
  `codex-exec.mjs` (codex-inside-codex) + `copilot-exec.mjs`. A codex member running this recurses
  one codex level.
- Read-only snapshot guard is HARD-DISABLED in ralph v5.52.0 (OOM mitigation; `READONLY_SNAPSHOT_ENABLED=false`,
  was OOM-ing on the 21GB gitignored `codex-rs/target`). So concurrent read-only lenses no longer OOM,
  but `codex-exec` runs `--dangerously-bypass-approvals-and-sandbox` (write-capable, no revert guard).
- OBSERVED THIS SESSION: the `codex-exec.mjs` research lens (xhigh) HUNG > 20 min past its 300s timeout
  and produced no output, while `copilot-exec.mjs` completed cleanly in ~5 min. codex-exec reliability
  on this box is a live risk for any codex-inside-codex recursion.

### 6. MCP availability
- ralph-orchestration ships NO MCP server (skills-only). brainstorm/plan/impl don't need overview MCP.
- ralph-overview ships the `mcp__ralph-overview__*` server; needed only to test overview MCP under codex
  → ralph-overview install is OPTIONAL for this spike.

## Architect Analysis (Explore agent)
- The harness-aware adaptation is ARTIFACT GENERATION (`scripts/generate-copilot-artifacts.mjs`,
  18-entry substitution table: `Skill()`→`task(...)`, `Agent()`→`task(...)`, `Bash()`→`bash(...)`,
  `mcp__x__y`→`x/y`), applied to `.copilot-plugin/*` only; agent bodies stay engine-neutral. No codex
  generator/overlay exists → top blocker for a codex member running ralph skills end-to-end.
- Lightest validation first: `/brainstorm-with-ralph` (halts for user choice, fewer fan-outs), then a
  tiny throwaway `/plan-with-ralph`. Fail-fast gates: if launcher/install doesn't expose the skill tree,
  or codex can't load the skills manifest, stop — the member won't even start.
- Windows: MAX_PATH on deep `.ralph/jobs/<slug>/worktree/` paths, PS5.1 encoding, MSYS path conversion.

## Codex Research Lens
Failed — the `codex-exec.mjs` lens hung >20 min past its 300s timeout, produced no output, and was
stopped manually. (This is itself evidence for item 5: codex-exec recursion reliability risk.)

## Copilot Research Lens (xhigh, completed)
Confirms: codex installs into `~/.codex/plugins/cache/<mp>/<plugin>/<version>/`, runtime loads cache not
source; `codex plugin add <plugin>@<marketplace>` is the install/reinstall; `.codex-plugin/plugin.json`
discovered before `.claude-plugin/plugin.json`; crews HAS a `.codex-plugin` overlay, ralph does NOT;
codex skills advertise + load-on-mention but have no `Skill` tool / typed `Agent`; fresh thread required
after install. Predicts: install works + crews codex member works, but a real ralph phase will fail on
missing `Agent`/`Skill` semantics unless a codex-specific ralph overlay is added OR codex parity lands.
Recommended command sequence: marketplace add (if needed) → `codex plugin add` each plugin →
`codex plugin list` + cache inspect → fresh thread → expect ralph workflow to fail on Agent/Skill.

## Gold reference — codex parity PRD already exists
`codex/tasks/prd-plugin-parity-skill-agent-streaming.md` (18.8KB) scopes EXACTLY the three missing
codex-engine capabilities that block ralph (and crews streaming):
- **Feature 1 — Skill invocation tool + `internal: true` skill metadata** (`invoke_skill` tool; ralph's
  `/implement-with-ralph` chains decompose-plan / analyze-iteration / review-changes / parallel-ralph).
- **Feature 2 — Typed subagent spawning** (`Agent({subagent_type})`; ralph's parallel research/review fan-out).
- **Feature 3 — Streaming background-process output** (`Monitor` over `Bash(run_in_background:true)`; crews
  listener threads delivering mailbox messages as they arrive).
It notes codex ALREADY has: full hook surface, Claude-compat tool aliases (shell→Bash, apply_patch→Write/Edit),
`request_user_input`≡`AskUserQuestion`, marketplace + `.codex-plugin/` manifest. Has Goal / per-feature Scope /
Acceptance criteria / Sequencing sections.

## Prior investigations (read)
- `codex-git-marketplace-snapshot-tmp-ephemeral/findings.md` — root cause of the git-marketplace
  corruption; local-source is immune; KEEP local source.
- `crews-codex-member-spawn-does-not-start-session/findings.md` — the `--add-dir` TUI hard-exit
  (`tui/src/lib.rs:1167-1176`); fix = `--dangerously-bypass-approvals-and-sandbox`; now SHIPPED in crews 3.12.0.
  Also notes codex `~/.codex/config.toml` has `[plugins."crews@ai-developer-toolkit"] enabled = true` +
  hook trust hashes (so codex fires crews hooks). Re-verify the deferred live spawn smoke this spike.

## Consolidated File / artifact list
**Refresh + verify (impl):**
- `~/.codex/plugins/cache/ai-developer-toolkit/{crews,ralph-orchestration}/<version>/`  (cache)
- `D:/harness-efforts/codexu/ai-developer-toolkit/.agents/plugins/marketplace.json`  (local-source index)
- `codex plugin add … @ai-developer-toolkit`, `codex plugin list`  (commands)
**Skill/tool-name seam (remediation):**
- `ai-developer-toolkit/plugins/ralph/scripts/generate-copilot-artifacts.mjs`  (extend with codex table)
- `ai-developer-toolkit/plugins/ralph/.copilot-plugin/`  (pattern to mirror as `.codex-plugin/`)
- `ai-developer-toolkit/plugins/crews/.codex-plugin/`  (existing codex overlay exemplar)
**Engine parity (remediation, out-of-spike):**
- `codex/tasks/prd-plugin-parity-skill-agent-streaming.md`  (Features 1-3)
- `codex-rs/utils/plugins/src/plugin_namespace.rs`, `core-plugins/src/store.rs`, `core-skills/src/{loader,render,injection}.rs`
**Crews lifecycle under codex (validate):**
- `ai-developer-toolkit/plugins/crews/hooks/codex-*.js`, `.codex-plugin/hooks/hooks.json`
**Reference (downstream consumer):**
- `crews-target-engine-plugin-provisioning` automation design (this spike de-risks/feeds it)
