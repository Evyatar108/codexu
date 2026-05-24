Lenses: ran=[codex, copilot, devils-advocate]; skipped=[]

# Streamline ralph-overview install — synthesis

**Red flag from Devil's Advocate.** DA challenges the framing: (a) `overview-data.js` is bookkeeper-canonical and operators don't actually want it auto-replaced; (b) Claude Code restart is required regardless, so "install → done" is physically blocked; (c) the recurring bookkeeping cost (edit-task) dwarfs the one-time install cost; (d) net-new consumer rate may be too low to amortize automation. Read the directions below with this lens in mind.

## Candidate directions (ordered: multi-lens first, then decision relevance)

### D-001: Shared init engine with multiple surfaces (skill primary + CLI + optional MCP)
- Contributing lenses: [codex, copilot]
- Why this might work: One shared `scripts/init-consumer.mjs` engine does all the file ops (scaffold `overview-data.js` from template, scaffold `.ralph/overview-config.json`, merge `.mcp.json`, append `enabledMcpjsonServers`). Three thin surfaces wrap it: `/overview-init` slash skill (interactive), `node bin/ralph-overview.mjs init` (CLI), optional `overview.init` MCP tool (programmatic/CI). Codex points at the existing `tools/overview-mcp/src/install-server.ts` which already does partial MCP wiring — extend it.
- Risks / friction: Slash skill discoverability after `/plugin install` (Claude may not surface new skills until restart, forcing CLI as the actual first-run path). `.mcp.json` safe-merge logic needs cross-platform path care + atomicity guarantees on Windows EPERM. Schema drift if `overview-data.template.js` gains a `ui.*` field — generator must keep up.
- Cheapest validation: Dry-run mode that prints file ops without writing, run against 3 fixture repos: empty, repo-with-existing-`.mcp.json`, codexu-like-partial. Confirm idempotent + merge-only-missing semantics.
- Disconfirming observation: New consumers still need to read templates / fix `.mcp.json` manually if init half-fails OR if their `.mcp.json` has unusual shape.

### D-002: Lazy auto-bootstrap (postinstall or first-run sync)
- Contributing lenses: [codex, copilot]
- Why this might work: Zero operator action — first `pnpm sync-ralph-state` (or first MCP server boot) detects missing files and writes templates at default paths. Codex's `loadConfig` already returns defaults when config absent; extending to write-defaults-on-missing is small.
- Risks / friction: True postinstall hook may not exist in Claude Code plugin lifecycle (both lenses flag this). Restart still required for MCP registration to take effect, so the marketing of "install → done" is unreachable. Lazy creation in `.mcp.json` / `.claude/settings.json` is more dangerous — those are operator-owned config files, not data files. Silent stock defaults hide the fact that operator never customized `ui.*` taxonomy.
- Cheapest validation: Verify Claude Code plugin lifecycle FIRST. If postinstall hooks don't exist, limit auto-create to `overview-data.js` + `.ralph/overview-config.json` only (not the MCP wiring files).
- Disconfirming observation: If postinstall hooks are unavailable AND restart is mandatory, the "auto" claim is false — operator still does at least one explicit action (restart).

### D-003: Invest in ongoing bookkeeping skills instead of init (reframe)
- Contributing lenses: [devils-advocate]
- Why this might work: Install happens once per project; `overview-data.js` task-status edits happen dozens of times per week. Build `/overview-add-task`, `/overview-edit-task`, `/overview-set-status` FIRST — the highest-leverage automation per operator-hour. Init friction is amortized to zero across project lifetime; bookkeeping friction is not. DA argues approach (c) in the idea is mis-ranked.
- Risks / friction: AST mutation of hand-curated `overview-data.js` is risky — codexu's file has rich `CODEXU_UI`, comments, computed blocks. Constrained schema-aware tools (status flip only) may be safe; full task creation/editing not. Codex flags this concern explicitly in direction 3.
- Cheapest validation: Build `/overview-set-status <id> <status>` first (most constrained — only flips one field via AST). If that's robust on codexu's actual `overview-data.js`, scale up to add/edit.
- Disconfirming observation: If real consumer `overview-data.js` files have idiosyncratic shapes (Codex flags this), generic mutation tools may be data-loss-prone. Bookkeepers may prefer hand-editing even with a skill available.

### D-004: Do nothing automated — INSTALL.md + post-install banner
- Contributing lenses: [devils-advocate]
- Why this might work: A polished `docs/installation.md` (already exists in plugin tree) + post-install banner pointing at it closes 80% of the operator friction at 5% of the engineering cost. The real bug DA names is discoverability ("I had to read the source tree to find the seven steps"), not friction per se. Zero new code, zero new failure modes, zero migration story.
- Risks / friction: DOES NOT solve the recurring `.mcp.json` cross-platform path issue (operator copy-pastes a stanza and may get it wrong). Doesn't help CI/scripted consumers. Doesn't solve the recurring bookkeeping friction.
- Cheapest validation: Polish the existing `docs/installation.md` + add a banner stanza to the plugin's launch.cjs first-run message. Ship. Wait for first complaint that names a SPECIFIC step still confusing — then decide whether automation is justified.
- Disconfirming observation: If net-new consumer rate is high (>4/quarter) AND operators are confused by specific steps (not just discoverability), pure docs is insufficient and D-001 wins.

### D-005: Plugin self-diagnoses on first run — helpful error + minimal CLI file-copier
- Contributing lenses: [devils-advocate]
- Why this might work: Today missing files cause opaque errors / blank dashboard. Replace with structured error from the MCP server / CLI: "overview-data.js not found at `<path>`. Run `node <plugin>/bin/ralph-overview.mjs init` OR copy these two files: <src→dst>. Then add this stanza to `.mcp.json`: <stanza>. Then restart Claude Code." The `init` CLI is then a 30-line file-copier that REFUSES to overwrite existing files. No schema knowledge in the copier; templates flow through untouched.
- Risks / friction: Operator still does multiple actions (copy-paste, restart), but each action is explicit and recoverable. "Refuse to overwrite" semantics dodge the "ran-it-twice" failure mode that D-001 must answer.
- Cheapest validation: Add the structured-error path to the existing missing-file diagnostics in `loadConfig` / `loadOverviewData`. Ship the 30-line CLI. Smoke against same 3 fixture repos as D-001.
- Disconfirming observation: A clear error message is still slower than "run one slash command", so if operator surveys say they want true one-command setup, D-001 wins.

## Open questions for synthesis (highest-priority decisions)

1. **What is the net-new consumer install rate per quarter?** (Sharpest question from DA.) If < 4, D-004 (docs only) is strictly best. If > 4, D-001 starts to amortize.
2. **Does the Claude Code plugin lifecycle support a postinstall hook?** D-002 hinges on this. If no, D-002 collapses to D-005 (lazy first-run error).
3. **Are operators complaining about install steps themselves, or about not knowing what the steps WERE?** Different problems. Discoverability → D-004; actual friction → D-001.
4. **Behavior when init runs twice on the same project** — refuse, prompt, merge, or overwrite? D-001 must answer; D-005 answers "refuse" by construction.
5. **Is recurring bookkeeping (D-003) more painful than initial install (D-001)?** If yes per friction-economic analysis, D-003 > D-001 in priority.
6. **Should the engine handle `.mcp.json` safe-merge, or should Claude Code's plugin host?** Codex flags the install-server.ts inconsistency (`.claude/settings.json mcpServers` block vs codexu's `.mcp.json + enabledMcpjsonServers`). DA argues this is a host bug each plugin shouldn't re-solve.
