---
name: crews-v153-stale-armed-fix
description: "Crews v1.5.3 fixes a long-standing session-resume bug where a stale `listenerState='armed'` from a prior session silently bypassed the PreToolUse arm-block, letting agents proceed without ever arming a listener."
metadata: 
  node_type: memory
  type: project
  originSessionId: 61598f1c-1ec5-4b0f-ae33-2b06d5c6ae30
---

Crews plugin v1.5.3 shipped 2026-05-24 (commit `fe88552a` in `gim-home/ai-developer-toolkit`) to fix a session-resume bug where `deriveListenerState` (`hooks/actor-state.js`) trusted `manifest.listenerState='armed'` verbatim without cross-checking pid liveness or heartbeat freshness. When a prior Claude Code session terminated abruptly (close+reopen, harness crash, etc.) without calling `markExited`, the manifest stayed `'armed'`; the new session's PreToolUse arm-gate (`pre-tool-use.js:410 if (listenerState === 'armed') return; // allow`) treated it as live and silently allowed every tool call. Spawning members in that state worked — but their mailbox replies piled up undelivered because the lead's listener wasn't actually running.

**Why:** The bug surfaced specifically when (1) prior session shut down without `markExited`, AND (2) the new session was a *lead* with `listenerState` already-armed in the manifest. The CLAUDE.md v1.2.x already-active-guard note long *claimed* heartbeat staleness would heal this — but the code never implemented that check. v1.5.3 closes the gap.

**How to apply:** When investigating a "members spawned but mail not delivering" symptom in any future session: check `lastListenerPid` on the lead's `.crews/crews/<crew>/leads/<lead>/manifest.json`. If that pid isn't alive (Windows: `Get-CimInstance Win32_Process -Filter "ProcessId=<pid>"`; posix: `kill -0 <pid>`) AND `listenerState='armed'`, you're hitting this scenario on a plugin version < 1.5.3. Either upgrade the plugin or restart the session — both v1.5.3+ and a fresh SessionStart trigger the reap.

**Workaround when stuck without v1.5.3:** restart Claude Code. SessionStart re-runs and (on v1.5.3+) PreToolUse will detect the dead pid via the patched `deriveListenerState` and fire the arm-block. Direct-editing `.crews/*/manifest.json` is forbidden by `pre-tool-use.js:316-318` `.crews/` direct-write guard — don't bypass it.

**Test helper note:** the same patch fixed `tests/integration/lib/scenario.js#setListenerState('armed')` which was a partial mock — it set the state text but left stale `lastListenerPid` from prior `runListener` subprocesses. The fixed helper also stamps `lastHeartbeatAt` and clears `lastListenerPid`, faithfully simulating `touchHeartbeat`'s write.

Related: [[feedback_crews_listener_rearm_pacing]], [[feedback_crews_spawn_state_cwd_override]]
