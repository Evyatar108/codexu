## Direction
D-001 + D-003 hybrid — Agent-driven bootstrap and bookkeeping. Build a shared init engine (foundational, D-001) plus ongoing bookkeeping skills/MCP tools (recurring-cost, D-003) so the operator's only manual action is `/plugin install`. Everything else — scaffolding files, registering the MCP server, starting the React dev server, adding/editing tasks — flows through agent-invoked skills and MCP tools.

## Goal

After `/plugin install ralph-overview@ai-developer-toolkit` and a one-time Claude Code restart, the operator can say to the agent (in plain language):

- "Set up the overview for this project" → agent scaffolds `plans/overview-data.js`, `.ralph/overview-config.json`, merges the MCP server entry into `.mcp.json` + `.claude/settings.json`, runs initial sync, opens the dashboard.
- "Add a task for X" → agent calls `overview.upsert_task` or invokes `/overview-add-task`; appends to `overview-data.js`.
- "Mark task Y shipped" → agent flips the status field via the same primitive.
- "Show me the dashboard" → agent starts `pnpm overview` if not already running.

The operator never opens `plans/overview-data.js` by hand, never edits `.mcp.json` directly, never copy-pastes JSON stanzas, never runs `pnpm sync-ralph-state` manually.

The Claude Code restart after install is the ONE manual action that cannot be eliminated (the MCP server has to register with the harness). The agent surfaces this clearly in its first response after install.

## Scope

### In Scope

**Init engine (D-001 foundation):**
- New `scripts/init-consumer.mjs` in the plugin — pure Node module, idempotent, refuses to overwrite existing files without `--force`, prints dry-run summary by default.
- Shared by three surfaces:
  - **MCP tool `overview.init`** — primary agent-callable entry. Operator-natural-language → agent calls this tool.
  - **`/overview-init` slash skill** — interactive operator fallback. Useful if the agent isn't running or operator prefers explicit control.
  - **`node bin/ralph-overview.mjs init` CLI** — CI / scripted setup. Same engine, no Claude Code dependency.
- Reconcile `tools/overview-mcp/src/install-server.ts` (currently writes `.claude/settings.json:mcpServers`) with codexu's actual `.mcp.json + enabledMcpjsonServers` shape. Make the engine produce the correct shape.
- Cross-platform path handling (Windows EPERM rename race coverage from prior fixes applies).
- Safe `.mcp.json` merge: parse → mutate only `ralph-overview` key → atomic write. Refuse to clobber other servers.
- `.claude/settings.json:enabledMcpjsonServers` append-if-missing.
- Optional `bin/ralph-overview.mjs` resolver wrapper + npm scripts in consumer's `package.json` (only if `package.json` exists; ask via skill / agent dialogue).
- Templates source remain in `plugins/ralph-overview/templates/` (no schema duplication).
- Refuse-to-overwrite semantics by default; explicit `--force` opt-out. Solves the "ran-init-twice" failure mode DA flagged.

**Ongoing bookkeeping (D-003):**
- **MCP tool `overview.upsert_task`** — single generic primitive (per operator's "generic over per-event-type" preference from memory). Schema: `{ id, fields: { title?, scope?, workstream?, status?, phase?, blockedBy?, mergeCommit?, ... } }`. Creates if absent, updates if present. AST-aware edit of `plans/overview-data.js` — splice the task entry, preserve formatting + comments around it.
- **`/overview-add-task`**, **`/overview-edit-task`**, **`/overview-set-status`** slash skills as thin wrappers over the MCP tool. Operator-typed convenience.
- Constrained schema mutation — only edit recognized fields; refuse to touch `ui.*`, `cadence`, `staticSections`, comments, custom blocks. Bookkeeper retains full hand-edit control of structural rich data; agent only touches per-task fields.
- After each upsert, agent auto-runs `pnpm sync-ralph-state` so the dashboard reflects the change.

**Agent-driven invocation:**
- The agent surfaces a one-line "Setup ralph-overview?" prompt after detecting the plugin installed but no consumer files present (via a first-run check in `overview.list_tasks` or `overview.dev_server.status`).
- After init completes, the agent offers to start the dashboard.
- For ongoing edits, the agent recognizes natural-language intent ("add a task", "mark X shipped") and calls the appropriate MCP tool.

### Out of Scope

- **Postinstall hooks** (D-002 lazy/auto-bootstrap). Blocked on Claude Code plugin lifecycle support. If the lifecycle gains a postinstall later, revisit.
- **Replacing hand-editing of `plans/overview-data.js` entirely** (DA's concern in D-003 critique). The upsert primitive touches only per-task fields. `ui.*` taxonomy, `cadence`, `staticSections`, `kanbanCards`, comments, and computed blocks stay bookkeeper-canonical.
- **Mass-rewrite/migration of existing consumer configs.** Existing consumers (codexu) keep their current wiring. Init refuses to overwrite if files already exist; operator can use `--force` if they want a fresh scaffold.
- **`docs/installation.md` polish for manual-install path** (D-004). The README/install doc stays as a fallback / reference, but agent-driven flow is the primary UX.
- **Codex parity bundle, async-events A0, agent-view follow-ups** — unrelated work tracked elsewhere.

## Criteria

Verifiable success conditions (these seed the plan's Acceptance Criteria):

1. **After `/plugin install ralph-overview` and Claude Code restart, the operator can say "set up the overview" to the agent and the agent calls `overview.init` to scaffold all required files.** The 4 target files exist on disk at expected paths after one MCP call.
2. **`overview.init` is idempotent** — running it twice on the same project (without `--force`) refuses to overwrite and prints what's missing vs already present.
3. **`overview.init --force` regenerates** without preserving custom UI taxonomy unless the operator confirms.
4. **`.mcp.json` safe-merge** — running init on a project with an existing `.mcp.json` containing other servers (e.g. `paper`) leaves those servers intact and adds only `ralph-overview`.
5. **`.claude/settings.json:enabledMcpjsonServers` append-only** — does not duplicate or overwrite existing array entries.
6. **`overview.upsert_task` is data-loss-safe on rich `overview-data.js`** — running it against codexu's actual file (with `ui.*`, `cadence`, `staticSections`) updates only the targeted task fields; all other content byte-identical.
7. **Agent autonomously invokes `pnpm sync-ralph-state` after `upsert_task`** so dashboard reflects changes without operator action.
8. **The CLI subcommand `node bin/ralph-overview.mjs init` works headlessly** (no Claude Code dependency); useful in CI.
9. **All three surfaces (skill / CLI / MCP) share the same engine** — no logic duplication; behavior parity confirmed via dry-run output equality on fixture repos.
10. **Tests cover** (a) empty-repo init, (b) repo-with-existing-`.mcp.json` merge, (c) codexu-like-partial-state idempotency, (d) `upsert_task` against rich `overview-data.js`, (e) `--force` overwrite path, (f) cross-platform paths (Windows EPERM atomicity).
11. **First-run prompt** — when MCP detects missing consumer files on first invocation, returns a structured "scaffold this?" response the agent can act on.

## Context

**Brainstorm synthesis highlights:**
- 3 lenses ran (codex, copilot, devil's-advocate). DA raised a red flag arguing automation is partially overengineered.
- Codex + Copilot converged on D-001 (shared init engine, multi-surface) as the natural bootstrap shape.
- DA's strongest contribution: D-005 (refuse-to-overwrite semantics + structured first-run error) which we adopt as the safety contract for `overview.init`.
- DA's D-003 critique (recurring-cost > one-time-cost) is what makes the hybrid the right scope: build init AND ongoing bookkeeping together so the agent has full coverage.

**Disconfirming observations to carry forward:**
- AST mutation of rich hand-curated `overview-data.js` (Codex direction 3) is risky. Mitigation: constrain `upsert_task` to per-task field edits only; refuse to touch `ui.*` / structural blocks; require byte-identical diff outside the target task in tests.
- Claude Code restart is operator-only (cannot be triggered by plugin). The agent surfaces this clearly in its post-install message.
- Net-new consumer rate may be low (DA's sharpest question). If it stays low long-term, the init engine still amortizes via the CLI / MCP surfaces for codexu's own re-init scenarios (worktree resets, scratch project bootstraps).

**Open questions to resolve at plan-with-ralph time:**
- Does Claude Code surface newly-installed plugin skills immediately or after restart? If after restart, `/overview-init` slash skill is unavailable on first-ever run; CLI + MCP become the only first-run paths. (Codex direction 1's disconfirming observation.)
- Should `overview.upsert_task` be one generic tool or split into `add_task` / `edit_task` / `set_status`? Operator memory preference is for one generic primitive; that's the recommendation. But task creation has different validation requirements (required fields) than status flips.
- Behavior when init runs on a project that has `plans/overview-data.js` but no `.ralph/overview-config.json` — partial state. Probably: detect partial → fill missing only, never touch existing.
- How does the agent KNOW to offer init? A first-call probe on `overview.list_tasks` returning a special "consumer-not-initialized" response is the natural signal.

**Related work shipped this session:**
- Plan 12 (overview plugin extraction): templates already exist at `plugins/ralph-overview/templates/`.
- MCP cwd fix (`launch.cjs:119`): `cwd: process.cwd()` so consumer repo root resolves correctly. This work depends on that fix being in place.
- Phase A-E polish: all React viewer polish landed; init engine doesn't need to know about UI surface.
- watcher Windows fix: depth-cap + broadened patterns. Init engine's `.ralph/overview-config.json` template must include the new patterns.
