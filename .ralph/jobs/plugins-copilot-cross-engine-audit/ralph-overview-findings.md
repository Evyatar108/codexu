# ralph-overview v2.4.0 Copilot parity findings

Audit target: installed Copilot plugin cache at `C:/Users/evmitran/.copilot/installed-plugins/_direct/ralph-overview`, semantically matching `D:/ai-developer-toolkit/plugins/ralph-overview` at `b2e4913d6862b03f79843942b615f4231aeebbfe` for the plugin manifest.

### mcpservers-from-plugin-manifest

**Command:** `copilot mcp list --json` from `.ralph/jobs/plugins-copilot-cross-engine-audit/scratch-mcp-session/no-workspace-mcp/` with no leaf `.mcp.json`; the worktree root `.mcp.json` was temporarily hidden and restored immediately to avoid Copilot's upward workspace fallback contaminating this manifest-only probe.
**Observed:** Copilot returned exit 0 with `{ "mcpServers": {} }`; `ralph-overview` did not appear from the installed plugin manifest even though the installed `.github/plugin/plugin.json` declares `"mcpServers": ".mcp.json"`. This matches the known Copilot CLI 1.0.55 gap.
**Evidence file:** `evidence/ralph-overview-mcp-list-isolated.json`; `evidence/ralph-overview-no-workspace-mcp-check.txt`; `evidence/ralph-overview-plugin-json-lines.txt`
**Status:** FAIL
**File:** `C:/Users/evmitran/.copilot/installed-plugins/_direct/ralph-overview/.github/plugin/plugin.json:21`
**Follow-up:** monitor Copilot CLI release for plugin-manifest mcpServers fix.

### mcpservers-from-workspace-mcp-json

**Command:** `copilot mcp list --json` and `copilot -p '... call overview.parallel_ready_tasks ...' --allow-all --silent --no-custom-instructions --disable-builtin-mcps` from `.ralph/jobs/plugins-copilot-cross-engine-audit/scratch-mcp-session/with-workspace-mcp/` with a workspace `.mcp.json` pointing at the installed plugin `launch.cjs`.
**Observed:** `copilot mcp list --json` listed `ralph-overview` with `source: "workspace"` and `sourcePath` equal to the scratch workspace `.mcp.json`; the Copilot turn invoked `overview.parallel_ready_tasks` and received an `ok: true` tool envelope.
**Evidence file:** `evidence/ralph-overview-workspace-mcp-list.json`; `evidence/ralph-overview-copilot-tool-output.txt`; `evidence/ralph-overview-copilot-tool-output-2.txt`
**Status:** PASS

### dev-server-watcher-autostart

**Command:** `copilot -p '... call overview.watcher_status ...' --allow-all --silent --no-custom-instructions --disable-builtin-mcps` from `.ralph/jobs/plugins-copilot-cross-engine-audit/scratch-mcp-session/with-workspace-mcp/`.
**Observed:** `overview.watcher_status` returned `ok: true` and reported an active watcher with `ownerPid` and `ownerParentMcpPid`, but the owner marker was written under the installed plugin cache at `C:/Users/evmitran/.copilot/installed-plugins/_direct/ralph-overview/.ralph/overview-watcher.owner`, not under the scratch workspace `.ralph/overview-watcher.owner`. The v2.4.0 MCP surface has `overview.watcher_status`; it does not expose the older `overview.dev_server.start` tool named by the plan.
**Evidence file:** `evidence/ralph-overview-copilot-tool-output-2.txt`; `evidence/ralph-overview-owner-snapshot.txt`; `evidence/ralph-overview-owner-path.txt`; `evidence/ralph-overview-launch-cwd-lines.txt`
**Status:** FAIL
**File:** `C:/Users/evmitran/.copilot/installed-plugins/_direct/ralph-overview/launch.cjs:117`
**Follow-up:** Batch 3: ensure Copilot workspace MCP launches ralph-overview with the consumer workspace as repo root.

### side-skill-mirrors-present

**Command:** `ls C:/Users/evmitran/.copilot/installed-plugins/_direct/ralph-overview/.copilot-plugin/copilot-skills/`
**Observed:** The installed plugin contains all four expected Copilot skill mirrors: `blocker-report`, `overview-init`, `triage`, and `work-on`.
**Evidence file:** `evidence/ralph-overview-skill-mirrors.txt`
**Status:** PASS

### side-plugin-manifest-mcp-declared

**Command:** `node -e "const fs=require('fs'); const p='C:/Users/evmitran/.copilot/installed-plugins/_direct/ralph-overview/.github/plugin/plugin.json'; const j=JSON.parse(fs.readFileSync(p,'utf8')); console.log(JSON.stringify({name:j.name,version:j.version,skills:j.skills,mcpServers:j.mcpServers},null,2));"`
**Observed:** The installed plugin manifest declares `name: "ralph-overview"`, `version: "2.4.0"`, `skills: ".copilot-plugin/copilot-skills/"`, and `mcpServers: ".mcp.json"`.
**Evidence file:** `evidence/ralph-overview-plugin-manifest-mcp.txt`; `evidence/ralph-overview-plugin-json-lines.txt`
**Status:** PASS
