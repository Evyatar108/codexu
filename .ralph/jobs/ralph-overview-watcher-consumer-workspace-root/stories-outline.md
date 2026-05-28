# Stories Outline: ralph-overview Watcher Consumer-Workspace Repo-Root Resolution

*Preliminary decomposition from `/plan-with-ralph`. Feed to `/implement-with-ralph --from-plan` for PRD generation.*

## US-001: Shared repo-root resolver library + tests
**Description:** As a ralph-overview maintainer, I want a single `scripts/lib/repo-root.mjs` module exporting `resolveRepoRootFromEnv()`, `resolveCopilotWorkspaceRoot()`, `isPluginCachePath()`, `findRalphAncestor()`, and `resolveRepoRootDefault()` so all callers share one resolution chain.
**Acceptance Criteria:**
- [ ] `scripts/lib/repo-root.mjs` exists with the five exports listed in the plan's Architecture section.
- [ ] `scripts/lib/repo-root.d.mts` provides TypeScript declarations consumable from `tools/overview-mcp/src/`.
- [ ] `scripts/lib/repo-root.test.mjs` covers: env precedence (`RALPH_OVERVIEW_REPO_ROOT` beats `OVERVIEW_REPO_ROOT`), Copilot workspace hint, plugin-cache rejection (including `installed-plugins/_direct/ralph-overview` and paths under `RALPH_OVERVIEW_PLUGIN_ROOT`), walk-up returns nearest `.ralph/` ancestor, walk-up halts at `os.homedir()`, git fallback, cwd fallback, Windows path normalization (`path.resolve` on both sides).
- [ ] The new test file is picked up by the standard plugin `npm test` invocation (add a top-level vitest config or `test:lib` npm script).
- [ ] `npm test --workspaces --if-present` exits 0 and includes the new tests.
- [ ] Typecheck passes.
**Dependencies:** None
**Estimated complexity:** medium

## US-002: Wire the shared resolver into all four call sites
**Description:** As a ralph-overview maintainer, I want `context.ts`, `install-server.ts`, `sync-ralph-state.mjs`, and `vite.config.ts` to delegate to the shared resolver so the four duplicated implementations stay in sync forever.
**Acceptance Criteria:**
- [ ] `tools/overview-mcp/src/context.ts:65` delegates to `resolveRepoRootDefault(cwd)`.
- [ ] `tools/overview-mcp/src/install-server.ts:104` delegates to `resolveRepoRootDefault(cwd)`.
- [ ] `scripts/sync-ralph-state.mjs:438` delegates to `resolveRepoRootDefault(process.cwd())` and removes the throw-on-missing-git behavior.
- [ ] `tools/overview-viewer/vite.config.ts:30` delegates to the shared resolver, preserving `OVERVIEW_REPO_ROOT` as alias via the env-check path.
- [ ] Existing tests (`tools/overview-mcp/src/__tests__/watcher-supervisor.test.ts`, `install-server.test.ts`, `scripts/sync-ralph-state.test.mjs`) still pass.
- [ ] Typecheck passes.
**Dependencies:** US-001
**Estimated complexity:** small

## US-003: Env propagation through launch.cjs + both MCP registration builders
**Description:** As a ralph-overview operator, I want the env block carrying `RALPH_OVERVIEW_REPO_ROOT=<consumer-root>` to be present in every generated MCP registration (`scripts/init-consumer.mjs:planMcpJson()`, `tools/overview-mcp/src/install-server.ts:previewMcp()`, and the plugin's static `.mcp.json` when Copilot supports templated env), with `launch.cjs` only modified if a Copilot workspace env var must be normalized into the canonical name.
**Acceptance Criteria:**
- [ ] `scripts/init-consumer.mjs:planMcpJson()` emits an `env` block on every generated server entry.
- [ ] `tools/overview-mcp/src/install-server.ts:previewMcp()` emits the same env block; `--print-only` output matches the generated `.mcp.json`.
- [ ] `D:/ai-developer-toolkit/plugins/ralph-overview/.mcp.json` is updated with the Copilot-compatible env directive OR a clear comment documents why Copilot does not support templated env there and how the resolver fallback covers the case.
- [ ] `tools/overview-mcp/src/__tests__/init-consumer.test.ts` and `tools/overview-mcp/src/__tests__/install-server.test.ts` assert the new env block (update existing exact-object assertions).
- [ ] `launch.cjs` is unchanged unless Copilot research confirms a workspace env var that must be normalized; if changed, the change includes a test or comment justifying it (resolves F-013).
- [ ] All tests pass; typecheck passes.
**Dependencies:** US-001, US-002
**Estimated complexity:** medium

## US-004: Version bump to 2.4.1 + CHANGELOG + docs
**Description:** As an operator upgrading ralph-overview, I want all version manifests bumped in lockstep with a CHANGELOG entry describing the fix, the release note about re-running `overview.init`, and updated CLAUDE.md / docs/configuration.md describing the new env-var precedence.
**Acceptance Criteria:**
- [ ] `D:/ai-developer-toolkit/plugins/ralph-overview/.claude-plugin/plugin.json` reports `2.4.1`.
- [ ] `D:/ai-developer-toolkit/plugins/ralph-overview/.github/plugin/plugin.json` reports `2.4.1`.
- [ ] Toolkit-root marketplace JSONs (`D:/ai-developer-toolkit/.claude-plugin/marketplace.json`, `D:/ai-developer-toolkit/.github/marketplace.json`, `D:/ai-developer-toolkit/.agents/plugins/marketplace.json`) report `2.4.1` for ralph-overview wherever a version field is present (verify per-file before editing — some may use `source.path` only).
- [ ] `D:/ai-developer-toolkit/plugins/ralph-overview/CHANGELOG.md` has a v2.4.1 entry describing: new shared resolver, env-var precedence, plugin-cache rejection, env block in MCP registrations, release note "Re-run `overview.init` after upgrade to get the new env block in your `.mcp.json`."
- [ ] `D:/ai-developer-toolkit/plugins/ralph-overview/CLAUDE.md` rule 2 explicitly enumerates the new precedence (`RALPH_OVERVIEW_REPO_ROOT` > `OVERVIEW_REPO_ROOT` > Copilot workspace hint > plugin-cache-safe walk-up > git toplevel > cwd) and references `scripts/lib/repo-root.mjs`.
- [ ] `D:/ai-developer-toolkit/plugins/ralph-overview/docs/configuration.md` documents the env var, the precedence order, and the monorepo guidance (set the env var explicitly for nested layouts).
- [ ] Typecheck passes.
**Dependencies:** US-001, US-002, US-003
**Estimated complexity:** small

## US-005a: Publish and reinstall v2.4.1 in the scratch Copilot workspace
**Description:** As the implementer verifying AC-3, I want to commit and push the v2.4.1 toolkit changes to `origin`, then refresh the scratch Copilot workspace plugin install cache and verify the install carries v2.4.1 before exercising the audit probe.
**Acceptance Criteria:**
- [ ] Toolkit changes committed and pushed to `origin/main` (or the operator-designated release branch).
- [ ] `copilot plugin remove ralph-overview && copilot plugin add D:/ai-developer-toolkit/plugins/ralph-overview/` (or the equivalent for the implementation worktree path) runs to completion.
- [ ] Inspection of the installed `~/.copilot/installed-plugins/_direct/ralph-overview/.claude-plugin/plugin.json` (or platform-equivalent path) reports version `2.4.1`.
- [ ] No further audit work happens until this verification is captured (the verification output itself becomes part of the AC-3 evidence).
**Dependencies:** US-004
**Estimated complexity:** small

## US-005: Add v2.4.1 audit follow-up + evidence in codexu (cross-repo)
**Description:** As the auditor verifying AC-3, I want a new v2.4.1 section appended to `plugins-copilot-cross-engine-audit/audit-report.md` documenting that the watcher now writes its owner-marker under the consumer workspace, with a new evidence file proving the path — without rewriting or destroying the original v2.4.0 FAIL evidence.
**Acceptance Criteria:**
- [ ] `D:/harness-efforts/codexu/.ralph/jobs/plugins-copilot-cross-engine-audit/audit-report.md` has a new "## v2.4.1 follow-up" section (or equivalent additive subsection) referencing the v2.4.1 verification PASS for `dev-server-watcher-autostart`. The original v2.4.0 row is unchanged.
- [ ] `D:/harness-efforts/codexu/.ralph/jobs/plugins-copilot-cross-engine-audit/evidence/ralph-overview-owner-path-v2_4_1.txt` exists with the owner-marker path captured under the consumer workspace.
- [ ] Evidence capture command documented and reproducible: `copilot -p "call overview.watcher_status" --allow-all --silent --no-custom-instructions --disable-builtin-mcps` run from a scratch workspace, paired with a directory listing showing the marker is NOT in the plugin cache.
- [ ] Evidence includes both the `overview.watcher_status` response and the file-path proof.
- [ ] The codexu commit lands on the lead's branch (per the impl-topic-branch memory rule) for the bookkeeper to relay to main.
**Dependencies:** US-005a
**Estimated complexity:** small
