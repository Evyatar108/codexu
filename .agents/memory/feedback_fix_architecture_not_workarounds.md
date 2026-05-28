---
name: feedback-fix-architecture-not-workarounds
description: "When an MCP/watcher/daemon system mis-behaves, operator prefers an architectural fix over recurring process-kill workarounds."
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 61598f1c-1ec5-4b0f-ae33-2b06d5c6ae30
---

When a long-running coordination component (MCP supervisor, watcher, daemon) repeatedly mis-behaves in normal multi-session usage, do NOT default to "kill the offending processes and retry." Surface the architectural mismatch and propose a real fix — even if that means deferring today's task to spawn a brainstorm/plan member.

**Why:** Specific incident 2026-05-26: three concurrent Claude Code sessions in `D:/harness-efforts/codexu` each spawned a ralph-overview MCP. Each MCP's preflightReclaim killed the others' watchers in a cascading loop. I proposed an AskUserQuestion menu where every option was "kill some MCPs." Operator pushed back: "maybe we should have a better approach implemented so we dont need to kill mcp servers and watchers for this to work as intended." They were right — the assumption "1 Claude Code session per repo" is wrong; N concurrent sessions is legitimate use. The fix belongs in `watch-ralph-state.mjs::claimOwnerHeartbeat` (cooperative lease + passive-consumer mode), not in operator muscle memory.

**How to apply:**
- Before recommending a process-kill workaround for a coordination-component failure, ask: "Is this failure mode the system was designed to handle?" If no, the right next step is design work, not a kludge.
- Multi-session coordination bugs (in ralph-overview, crews, or any future shared-watcher design) should be surfaced as candidate brainstorm/plan-with-ralph tasks — not silent operator burden.
- See [[gaps-from-2026-05-25-26-session]] in `D:/ai-developer-toolkit/` for the running list of similar gaps.
