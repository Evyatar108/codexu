# Copilot cross-engine audit report

| Behavior | Status | Migration impact |
|---|---|---|
| crews: spawn-launcher-copilot | PASS | Copilot member launch path is viable on Windows. |
| crews: session-start-session-env | PASS | Copilot session identity can bind members without Claude env. |
| crews: pretooluse-listener-gate | PASS | Listener safety gate works for Copilot tool calls. |
| crews: stop-listener-armed-and-kind-tag | PASS | Stop/kind discipline works after listener arm. |
| crews: posttooluse-30s-nag | PASS | Mid-turn review nag behavior survives Copilot hooks. |
| crews: slash-commands-copilot | PASS | Required Copilot skill mirrors and review-mail fallback are usable. |
| crews: sessionid-pointer-restart | PASS | Session pointer restart works without `CREWS_STATE_CWD`. |
| ralph: codex-exec-shell-true | PASS | `shell: true` is present at the Codex spawn site; Windows `.cmd` shim path is covered. |
| ralph: codex-exec-help-contract | FAIL | `--help` flag returns exit 1; help contract mismatch should be fixed before migration automation relies on it. |
| ralph: copilot-exec-shell-true | PASS | `shell: true` is present at the Copilot spawn site; Windows `.cmd` shim path is covered. |
| ralph: copilot-exec-help-contract | FAIL | `--help` flag returns exit 1; help contract mismatch should be fixed before Copilot wrapper checks are trusted. |
| ralph: codex-exec-node-smoke | PASS | Direct Node Codex smoke succeeds. |
| ralph: codex-exec-sh-wrapper-absent | FAIL | `codex-exec.sh` bash shim is absent in v5.46.0; callers expecting the shim will fail. |
| ralph: copilot-exec-node-smoke | PASS | Direct Node Copilot smoke succeeds. |
| ralph: copilot-exec-sh-wrapper-absent | FAIL | `copilot-exec.sh` bash shim is absent in v5.46.0; callers expecting the shim will fail. |
| ralph: ralph-mjs-iterates-codex | PASS | Main iterator resolves `.mjs` engine scripts correctly. |
| ralph: copilot-skill-mirror-parity | FAIL | Stale Copilot mirror prose can mislead operators during migration. |
| ralph: optional-e2e-plan-with-ralph-smoke | NOT-TESTED | Full lead E2E remains a residual confidence gap. |
| ralph-overview: mcpservers-from-plugin-manifest | FAIL | Plugin-manifest MCP discovery does not work in Copilot CLI 1.0.55. |
| ralph-overview: mcpservers-from-workspace-mcp-json | PASS | Workspace `.mcp.json` fallback works. |
| ralph-overview: dev-server-watcher-autostart | FAIL | Watcher owner is rooted in plugin cache instead of consumer workspace. |
| ralph-overview: side-skill-mirrors-present | PASS | Required Copilot skill mirrors are installed. |
| ralph-overview: side-plugin-manifest-mcp-declared | PASS | Plugin manifest declares MCP servers as expected. |

## crews v1.7.x

### spawn-launcher-copilot
**Command:** `node D:/ai-developer-toolkit/.worktrees/audit-main-crews/plugins/crews/tools/crews.js spawn-member audit-test-member --crew audit-test-crew --as audit-lead --state-cwd <scratch>/state --cwd <scratch>/physical --engine copilot --no-launch -- 'Audit scratch member: acknowledge once, arm listener, then idle.'`; then `wt.exe -w crews-audit-test new-tab --title audit-test-member pwsh -NoExit -File <launcher.ps1>`
**Observed:** The generated launcher sets `CREWS_ENGINE = 'copilot'`, scrubs Claude identity env vars, invokes `copilot --name 'audit-test-member (audit-test-crew)' --allow-all-tools --plugin-dir ...`, and the manual `wt.exe` launch returned exit code 0. The launcher process wrote `launcher.pid` before teardown and was killed with `taskkill /T`.
**Evidence file:** `.ralph/jobs/plugins-copilot-cross-engine-audit/evidence/crews-launcher-head.txt`; `.ralph/jobs/plugins-copilot-cross-engine-audit/evidence/crews-wt-launch-output.txt`; `.ralph/jobs/plugins-copilot-cross-engine-audit/evidence/crews-launcher-pid.json`; `.ralph/jobs/plugins-copilot-cross-engine-audit/evidence/crews-taskkill-launcher.txt`
**Status:** PASS

### session-start-session-env
**Command:** `printf '%s' <copilot sessionStart JSON> | env -u CREWS_STATE_CWD ... CREWS_HOME=<scratch>/home node D:/ai-developer-toolkit/.worktrees/audit-main-crews/plugins/crews/hooks/copilot-session-start.js`
**Observed:** The Copilot SessionStart shim accepted `sessionId: audit-member-session-001` plus `env.COPILOT_AGENT_SESSION_ID`/`COPILOT_CLI=1`, returned member briefing as `additionalContext`, and updated the scratch member manifest with `engine: "copilot"` and the same `sessionId`.
**Evidence file:** `.ralph/jobs/plugins-copilot-cross-engine-audit/evidence/crews-copilot-session-start-input.json`; `.ralph/jobs/plugins-copilot-cross-engine-audit/evidence/crews-copilot-session-start-output.json`; `.ralph/jobs/plugins-copilot-cross-engine-audit/evidence/crews-manifest-after-session-start.json`; `.ralph/jobs/plugins-copilot-cross-engine-audit/evidence/crews-session-pointer.json`
**Status:** PASS

### pretooluse-listener-gate
**Command:** `printf '%s' <copilot preToolUse JSON for bash "echo should-be-blocked"> | env -u CREWS_STATE_CWD ... CREWS_HOME=<scratch>/home node D:/ai-developer-toolkit/.worktrees/audit-main-crews/plugins/crews/hooks/copilot-pre-tool-use.js`
**Observed:** With `listenerState: "never-armed"`, the Copilot PreToolUse shim emitted a block envelope with `decision: "block"`, `permissionDecision: "deny"`, and a Copilot-shaped listener arm instruction using `bash` plus `mode: "async"`.
**Evidence file:** `.ralph/jobs/plugins-copilot-cross-engine-audit/evidence/crews-pretooluse-no-listener-input.json`; `.ralph/jobs/plugins-copilot-cross-engine-audit/evidence/crews-pretooluse-no-listener-output.json`
**Status:** PASS

### stop-listener-armed-and-kind-tag
**Command:** `printf '%s' <copilot agentStop JSON> | env -u CREWS_STATE_CWD ... CREWS_HOME=<scratch>/home node D:/ai-developer-toolkit/.worktrees/audit-main-crews/plugins/crews/hooks/copilot-stop.js`; plus a Copilot PreToolUse listener-arm probe before the final stop attempt.
**Observed:** Stop without a kind tag blocked and rendered the Copilot `bash`/`mode: "async"` arm instruction. Stop with `kind="done"` but no listener also blocked on listener reachability. After a Copilot listener-arm tool call, Stop with prose plus `<|report kind="done" summary="audit done"|>` returned `{}` and the manifest recorded `listenerState: "armed"`, `lastKind: "done"`, `lastSummary: "audit done"`, and `lastSeq: 1`.
**Evidence file:** `.ralph/jobs/plugins-copilot-cross-engine-audit/evidence/crews-stop-missing-kind-output.json`; `.ralph/jobs/plugins-copilot-cross-engine-audit/evidence/crews-stop-done-no-listener-output.json`; `.ralph/jobs/plugins-copilot-cross-engine-audit/evidence/crews-pretooluse-arm-input.json`; `.ralph/jobs/plugins-copilot-cross-engine-audit/evidence/crews-pretooluse-arm-output.json`; `.ralph/jobs/plugins-copilot-cross-engine-audit/evidence/crews-stop-done-armed-output.json`; `.ralph/jobs/plugins-copilot-cross-engine-audit/evidence/crews-manifest-after-stop.json`
**Status:** PASS

### posttooluse-30s-nag
**Command:** `node D:/ai-developer-toolkit/.worktrees/audit-main-crews/plugins/crews/tools/crews.js send-to-member audit-test-member ...`; exported listener-path mailbox consumption through `hooks/mailbox.consumeMailbox`; `sleep 31`; then `printf '%s' <copilot postToolUse JSON> | env -u CREWS_STATE_CWD ... node D:/ai-developer-toolkit/.worktrees/audit-main-crews/plugins/crews/hooks/copilot-post-tool-use.js`
**Observed:** A scratch lead sent direct mail to the scratch member. The same exported mailbox API used by the listener consumed the mailbox and set `lastReviewRequiredSeq: 1` with no reviewed cursor. After 31 seconds, Copilot PostToolUse emitted a block envelope headed `[mid-turn nag] review-required: unreviewed delivery from sender audit-lead` and advanced `lastMidTurnNagSeq`.
**Evidence file:** `.ralph/jobs/plugins-copilot-cross-engine-audit/evidence/crews-send-to-member-output.txt`; `.ralph/jobs/plugins-copilot-cross-engine-audit/evidence/crews-consume-mailbox-output.json`; `.ralph/jobs/plugins-copilot-cross-engine-audit/evidence/crews-manifest-after-delivery.json`; `.ralph/jobs/plugins-copilot-cross-engine-audit/evidence/crews-posttooluse-nag-input.json`; `.ralph/jobs/plugins-copilot-cross-engine-audit/evidence/crews-posttooluse-nag-output.json`; `.ralph/jobs/plugins-copilot-cross-engine-audit/evidence/crews-manifest-after-posttooluse.json`
**Status:** PASS

### slash-commands-copilot
**Command:** `find D:/ai-developer-toolkit/.worktrees/audit-main-crews/plugins/crews/.copilot-plugin/copilot-skills -mindepth 1 -maxdepth 1 -type d`; then `env -u CLAUDE_CODE_SESSION_ID -u CLAUDECODE COPILOT_AGENT_SESSION_ID=audit-member-session-001 COPILOT_CLI=1 node D:/ai-developer-toolkit/.worktrees/audit-main-crews/plugins/crews/tools/crews.js review-mail audit-test-member --crew audit-test-crew --cwd <scratch>/state`
**Observed:** Copilot skill mirrors include the required kebab commands `status`, `send-to-member`, `stop-member`, and `spawn-member`. No `review-mail` Copilot skill mirror exists by design, and the CLI fallback successfully returned the pending mail entry and advanced `lastReviewedSeq` to 1.
**Evidence file:** `.ralph/jobs/plugins-copilot-cross-engine-audit/evidence/crews-copilot-skills-list.txt`; `.ralph/jobs/plugins-copilot-cross-engine-audit/evidence/crews-review-mail-skill-presence.txt`; `.ralph/jobs/plugins-copilot-cross-engine-audit/evidence/crews-review-mail-cli-output.txt`; `.ralph/jobs/plugins-copilot-cross-engine-audit/evidence/crews-manifest-after-review-mail.json`
**Status:** PASS

### sessionid-pointer-restart
**Command:** `printf '%s' <copilot sessionStart JSON with cwd=<scratch>/physical, same sessionId, no CREWS_STATE_CWD> | env -u CREWS_STATE_CWD -u CLAUDE_CODE_SESSION_ID -u CLAUDECODE CREWS_HOME=<scratch>/home node D:/ai-developer-toolkit/.worktrees/audit-main-crews/plugins/crews/hooks/copilot-session-start.js`
**Observed:** The restart-style SessionStart resolved the existing scratch member through the sessionId pointer even though the hook cwd was the physical cwd and `CREWS_STATE_CWD` was unset. Member directory count stayed 1, and the manifest kept `sessionId: audit-member-session-001` while refreshing `lastSessionStartAt` and `transcriptPath`.
**Evidence file:** `.ralph/jobs/plugins-copilot-cross-engine-audit/evidence/crews-pointer-restart-session-start-input.json`; `.ralph/jobs/plugins-copilot-cross-engine-audit/evidence/crews-pointer-restart-session-start-output.json`; `.ralph/jobs/plugins-copilot-cross-engine-audit/evidence/crews-pointer-restart-result.json`; `.ralph/jobs/plugins-copilot-cross-engine-audit/evidence/crews-scratch-snapshot.txt`
**Status:** PASS

## ralph v5.46.0

### codex-exec-shell-true
**Command:** `grep -n "shell: true" D:/ai-developer-toolkit/.worktrees/audit-main-ralph/plugins/ralph/src/codex-exec.mjs`
**Observed:** The trusted Codex spawn site contains `shell: true` at line 74 with the Windows `.cmd` shim rationale in nearby comments. The property is present and load-bearing for the migration path.
**Evidence file:** `.ralph/jobs/plugins-copilot-cross-engine-audit/evidence/ralph-codex-shell-grep.txt`; `.ralph/jobs/plugins-copilot-cross-engine-audit/evidence/ralph-codex-shell-context.txt`
**Status:** PASS

### codex-exec-help-contract
**Command:** `node D:/ai-developer-toolkit/.worktrees/audit-main-ralph/plugins/ralph/src/codex-exec.mjs --help`
**Observed:** `codex-exec.mjs --help` returned exit 1 with usage plus `Error: unknown argument: --help`. The `--help` flag is not handled; audit/verifier scripts that probe the help contract will see a non-zero exit.
**Evidence file:** `.ralph/jobs/plugins-copilot-cross-engine-audit/evidence/ralph-help-output.txt`
**Status:** FAIL
**File:** D:/ai-developer-toolkit/.worktrees/audit-main-ralph/plugins/ralph/src/codex-exec.mjs:148
**Follow-up:** Batch 3: align codex-exec --help contract with audit/verifier expectations.

### copilot-exec-shell-true
**Command:** `grep -n "shell: true" D:/ai-developer-toolkit/.worktrees/audit-main-ralph/plugins/ralph/src/copilot-exec.mjs`
**Observed:** The trusted Copilot spawn site contains `shell: true` at line 255 with the Windows `.cmd` shim rationale in nearby comments. The property is present and load-bearing for the migration path.
**Evidence file:** `.ralph/jobs/plugins-copilot-cross-engine-audit/evidence/ralph-copilot-shell-grep.txt`; `.ralph/jobs/plugins-copilot-cross-engine-audit/evidence/ralph-copilot-shell-context.txt`
**Status:** PASS

### copilot-exec-help-contract
**Command:** `node D:/ai-developer-toolkit/.worktrees/audit-main-ralph/plugins/ralph/src/copilot-exec.mjs --help`
**Observed:** `copilot-exec.mjs --help` returned exit 1 with usage plus `Error: unknown argument: --help`. The `--help` flag is not handled; audit/verifier scripts that probe the help contract will see a non-zero exit.
**Evidence file:** `.ralph/jobs/plugins-copilot-cross-engine-audit/evidence/ralph-help-output.txt`
**Status:** FAIL
**File:** D:/ai-developer-toolkit/.worktrees/audit-main-ralph/plugins/ralph/src/copilot-exec.mjs:196
**Follow-up:** Batch 3: align copilot-exec --help contract with audit/verifier expectations.

### codex-exec-node-smoke
**Command:** `node D:/ai-developer-toolkit/.worktrees/audit-main-ralph/plugins/ralph/src/codex-exec.mjs --prompt .ralph/jobs/plugins-copilot-cross-engine-audit/scratch-ralph-prompt/prompt.txt --output .ralph/jobs/plugins-copilot-cross-engine-audit/scratch-ralph-prompt/codex-output.txt --effort low --text "echo hello"`
**Observed:** The direct Node invocation exited 0 and wrote a 16-byte non-empty output file containing `hello from smoke`. The `.mjs` call site is functional in v5.46.0.
**Evidence file:** `.ralph/jobs/plugins-copilot-cross-engine-audit/evidence/ralph-direct-smoke-output.txt`
**Status:** PASS

### codex-exec-sh-wrapper-absent
**Command:** `bash D:/ai-developer-toolkit/.worktrees/audit-main-ralph/plugins/ralph/codex-exec.sh --prompt .ralph/jobs/plugins-copilot-cross-engine-audit/scratch-ralph-prompt/prompt.txt --output .ralph/jobs/plugins-copilot-cross-engine-audit/scratch-ralph-prompt/codex-output.txt --effort low --text "echo hello"`
**Observed:** The bash shim command failed with exit 127 because `codex-exec.sh` is absent in v5.46.0. Any caller that references the `.sh` wrapper by path will fail with command-not-found.
**Evidence file:** `.ralph/jobs/plugins-copilot-cross-engine-audit/evidence/ralph-smoke-output.txt`; `.ralph/jobs/plugins-copilot-cross-engine-audit/evidence/ralph-root-listing.txt`
**Status:** FAIL
**File:** D:/ai-developer-toolkit/.worktrees/audit-main-ralph/plugins/ralph
**Follow-up:** Batch 3: document v5.46.0 wrapper-removal in CHANGELOG and verify no remaining callers expect `codex-exec.sh`.

### copilot-exec-node-smoke
**Command:** `node D:/ai-developer-toolkit/.worktrees/audit-main-ralph/plugins/ralph/src/copilot-exec.mjs --prompt .ralph/jobs/plugins-copilot-cross-engine-audit/scratch-ralph-prompt/prompt.txt --output .ralph/jobs/plugins-copilot-cross-engine-audit/scratch-ralph-prompt/copilot-output.txt --effort low --text "echo hello"`
**Observed:** The direct Node invocation exited 0 and wrote a 107-byte non-empty output file ending with `hello from smoke`. The `.mjs` call site is functional in v5.46.0.
**Evidence file:** `.ralph/jobs/plugins-copilot-cross-engine-audit/evidence/ralph-direct-smoke-output.txt`
**Status:** PASS

### copilot-exec-sh-wrapper-absent
**Command:** `bash D:/ai-developer-toolkit/.worktrees/audit-main-ralph/plugins/ralph/copilot-exec.sh --prompt .ralph/jobs/plugins-copilot-cross-engine-audit/scratch-ralph-prompt/prompt.txt --output .ralph/jobs/plugins-copilot-cross-engine-audit/scratch-ralph-prompt/copilot-output.txt --effort low --text "echo hello"`
**Observed:** The bash shim command failed with exit 127 because `copilot-exec.sh` is absent in v5.46.0. Any caller that references the `.sh` wrapper by path will fail with command-not-found.
**Evidence file:** `.ralph/jobs/plugins-copilot-cross-engine-audit/evidence/ralph-smoke-output.txt`; `.ralph/jobs/plugins-copilot-cross-engine-audit/evidence/ralph-root-listing.txt`
**Status:** FAIL
**File:** D:/ai-developer-toolkit/.worktrees/audit-main-ralph/plugins/ralph
**Follow-up:** Batch 3: document v5.46.0 wrapper-removal in CHANGELOG and verify no remaining callers expect `copilot-exec.sh`.

### ralph-mjs-iterates-codex
**Command:** `node D:/ai-developer-toolkit/.worktrees/audit-main-ralph/plugins/ralph/src/ralph.mjs --help`; inspect `resolveEngineScript()` / `engineSpawnCommand()` in `src/ralph.mjs`
**Observed:** `ralph.mjs --help` returned exit 0. `resolveEngineScript()` defaults to `join(PLUGIN_DIR, "src", `${engine}-exec.mjs`)`, and `engineSpawnCommand()` dispatches `.mjs` scripts through `node`; non-`.mjs` env overrides still dispatch through `bash`.
**Evidence file:** `.ralph/jobs/plugins-copilot-cross-engine-audit/evidence/ralph-ralph-help-output.txt`; `.ralph/jobs/plugins-copilot-cross-engine-audit/evidence/ralph-engine-wrapper-context.txt`; `.ralph/jobs/plugins-copilot-cross-engine-audit/evidence/ralph-engine-wrapper-grep.txt`
**Status:** PASS

### copilot-skill-mirror-parity
**Command:** `cd D:/ai-developer-toolkit/.worktrees/audit-main-ralph && node plugins/ralph/scripts/check-copilot-parity.mjs`; `grep -nE "\.sh\b" D:/ai-developer-toolkit/.worktrees/audit-main-ralph/plugins/ralph/.copilot-plugin/copilot-skills/implement-with-ralph/SKILL.md`
**Observed:** The generator parity script passed all assertions, but the `implement-with-ralph` Copilot mirror still contains 33 `.sh` references including `ralph.sh`, `codex-exec.sh`, `drain-cascade.sh`, and `parse-not-tested-trailers.sh` prose. The plan says any `.sh` hit in this mirror is a FAIL row.
**Evidence file:** `.ralph/jobs/plugins-copilot-cross-engine-audit/evidence/ralph-parity-output.txt`; `.ralph/jobs/plugins-copilot-cross-engine-audit/evidence/ralph-implement-skill-sh-grep.txt`
**Status:** FAIL
**File:** D:/ai-developer-toolkit/.worktrees/audit-main-ralph/plugins/ralph/.copilot-plugin/copilot-skills/implement-with-ralph/SKILL.md:15
**Follow-up:** Batch 3: ralph-implement-skill-mirror-regenerate-2026-05-28.

### optional-e2e-plan-with-ralph-smoke
**Command:** N/A
**Observed:** SKIPPED: scenarios 1-6 were executed and the lighter direct Node runtime smokes for both Codex and Copilot produced non-empty output; the optional full `/plan-with-ralph` Copilot lead smoke is slower and not needed to disambiguate static runtime wrapper behavior in this audit iteration.
**Evidence file:** `.ralph/jobs/plugins-copilot-cross-engine-audit/evidence/ralph-direct-smoke-output.txt`; `.ralph/jobs/plugins-copilot-cross-engine-audit/evidence/ralph-parity-output.txt`
**Status:** NOT-TESTED

## ralph-overview v2.4.0

### mcpservers-from-plugin-manifest
**Command:** `copilot mcp list --json` from `.ralph/jobs/plugins-copilot-cross-engine-audit/scratch-mcp-session/no-workspace-mcp/` with no leaf `.mcp.json`; the worktree root `.mcp.json` was temporarily hidden and restored immediately to avoid Copilot's upward workspace fallback contaminating this manifest-only probe.
**Observed:** Copilot returned exit 0 with `{ "mcpServers": {} }`; `ralph-overview` did not appear from the installed plugin manifest even though the installed `.github/plugin/plugin.json` declares `"mcpServers": ".mcp.json"`. This matches the known Copilot CLI 1.0.55 gap.
**Evidence file:** `.ralph/jobs/plugins-copilot-cross-engine-audit/evidence/ralph-overview-mcp-list-isolated.json`; `.ralph/jobs/plugins-copilot-cross-engine-audit/evidence/ralph-overview-no-workspace-mcp-check.txt`; `.ralph/jobs/plugins-copilot-cross-engine-audit/evidence/ralph-overview-plugin-json-lines.txt`
**Status:** FAIL
**File:** C:/Users/evmitran/.copilot/installed-plugins/_direct/ralph-overview/.github/plugin/plugin.json:21
**Follow-up:** monitor Copilot CLI release for plugin-manifest mcpServers fix.

### mcpservers-from-workspace-mcp-json
**Command:** `copilot mcp list --json` and `copilot -p '... call overview.parallel_ready_tasks ...' --allow-all --silent --no-custom-instructions --disable-builtin-mcps` from `.ralph/jobs/plugins-copilot-cross-engine-audit/scratch-mcp-session/with-workspace-mcp/` with a workspace `.mcp.json` pointing at the installed plugin `launch.cjs`.
**Observed:** `copilot mcp list --json` listed `ralph-overview` with `source: "workspace"` and `sourcePath` equal to the scratch workspace `.mcp.json`; the Copilot turn invoked `overview.parallel_ready_tasks` and received an `ok: true` tool envelope.
**Evidence file:** `.ralph/jobs/plugins-copilot-cross-engine-audit/evidence/ralph-overview-workspace-mcp-list.json`; `.ralph/jobs/plugins-copilot-cross-engine-audit/evidence/ralph-overview-copilot-tool-output.txt`; `.ralph/jobs/plugins-copilot-cross-engine-audit/evidence/ralph-overview-copilot-tool-output-2.txt`
**Status:** PASS

### dev-server-watcher-autostart
**Command:** `copilot -p '... call overview.watcher_status ...' --allow-all --silent --no-custom-instructions --disable-builtin-mcps` from `.ralph/jobs/plugins-copilot-cross-engine-audit/scratch-mcp-session/with-workspace-mcp/`.
**Observed:** `overview.watcher_status` returned `ok: true` and reported an active watcher with `ownerPid` and `ownerParentMcpPid`, but the owner marker was written under the installed plugin cache at `C:/Users/evmitran/.copilot/installed-plugins/_direct/ralph-overview/.ralph/overview-watcher.owner`, not under the scratch workspace `.ralph/overview-watcher.owner`. The v2.4.0 MCP surface has `overview.watcher_status`; it does not expose the older `overview.dev_server.start` tool named by the plan.
**Evidence file:** `.ralph/jobs/plugins-copilot-cross-engine-audit/evidence/ralph-overview-copilot-tool-output-2.txt`; `.ralph/jobs/plugins-copilot-cross-engine-audit/evidence/ralph-overview-owner-snapshot.txt`; `.ralph/jobs/plugins-copilot-cross-engine-audit/evidence/ralph-overview-owner-path.txt`; `.ralph/jobs/plugins-copilot-cross-engine-audit/evidence/ralph-overview-launch-cwd-lines.txt`
**Status:** FAIL
**File:** C:/Users/evmitran/.copilot/installed-plugins/_direct/ralph-overview/launch.cjs:117
**Follow-up:** Batch 3: ensure Copilot workspace MCP launches ralph-overview with the consumer workspace as repo root.

### side-skill-mirrors-present
**Command:** `ls C:/Users/evmitran/.copilot/installed-plugins/_direct/ralph-overview/.copilot-plugin/copilot-skills/`
**Observed:** The installed plugin contains all four expected Copilot skill mirrors: `blocker-report`, `overview-init`, `triage`, and `work-on`.
**Evidence file:** `.ralph/jobs/plugins-copilot-cross-engine-audit/evidence/ralph-overview-skill-mirrors.txt`
**Status:** PASS

### side-plugin-manifest-mcp-declared
**Command:** `node -e "const fs=require('fs'); const p='C:/Users/evmitran/.copilot/installed-plugins/_direct/ralph-overview/.github/plugin/plugin.json'; const j=JSON.parse(fs.readFileSync(p,'utf8')); console.log(JSON.stringify({name:j.name,version:j.version,skills:j.skills,mcpServers:j.mcpServers},null,2));"`
**Observed:** The installed plugin manifest declares `name: "ralph-overview"`, `version: "2.4.0"`, `skills: ".copilot-plugin/copilot-skills/"`, and `mcpServers: ".mcp.json"`.
**Evidence file:** `.ralph/jobs/plugins-copilot-cross-engine-audit/evidence/ralph-overview-plugin-manifest-mcp.txt`; `.ralph/jobs/plugins-copilot-cross-engine-audit/evidence/ralph-overview-plugin-json-lines.txt`
**Status:** PASS

## Migration recommendation

Chosen option: (C) defer the bookkeeper-lead engine migration from claude-code to copilot until the Batch 3 follow-ups above land or are explicitly accepted as non-blocking.

The positive path is real: crews passed all seven Copilot behaviors, `shell: true` is confirmed present at both the Codex and Copilot spawn sites (the load-bearing property for the Windows `.cmd` shim path), ralph's direct Node `.mjs` smokes produced non-empty output, and ralph-overview works when registered through a workspace `.mcp.json`. The defer decision is driven by the remaining FAIL rows: the `--help` contract on both exec wrappers returns exit 1, the `.sh` bash shims are absent in v5.46.0 so any caller referencing them by path will fail, the `implement-with-ralph` Copilot skill mirror still contains stale shell-shim guidance, Copilot CLI 1.0.55 does not discover ralph-overview MCP servers from the plugin manifest, and ralph-overview's watcher owner state is rooted in the installed plugin cache instead of the consumer workspace. Those gaps are exactly the surfaces a bookkeeper-lead migration would depend on for reliable operator workflow and recoverability.
