---
name: feedback-check-mailbox-after-tool-bursts
description: "Lead should proactively review-mail after extended tool-call sequences, not just at Stop-hook prodding."
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 61598f1c-1ec5-4b0f-ae33-2b06d5c6ae30
---

When the lead session runs an extended tool-call burst (debugging, investigation, multi-step setup) without natural turn boundaries, proactively peek the inbox via `review-mail --peek` between tool clusters — even when no Stop-hook prompt has fired.

**Why:** 2026-05-26 incident: I spent ~15 minutes investigating a watcher crash loop (running PowerShell process queries, reading log files, killing zombies). During that window, the v2 member sent a kind=question (worktree topology choice) that landed at 07:18:01Z and was delivered by listener pid 53836 in the same second. The task-notification likely arrived in my conversation but I was focused on watcher analysis and missed it. The operator noticed via the v2 member's wt.exe tab before I did and called it out: "did you not receive it? can you check if this is a bug?" Routing was correct; the gap was on my side.

**How to apply:**
- Between distinct sub-tasks during a single turn (e.g., switching from "investigate X" to "now do Y"), run `node $CREWS_BIN review-mail --peek <name> --crew <crew>` and visually scan for new entries. ~1 sec cost.
- If a tool-call burst exceeds ~6-8 tool calls without a mailbox check, treat that as the trigger.
- The Stop-hook is a backstop, not a primary signal — relying solely on it can miss messages that arrive during a long mid-turn investigation.
- See related [[feedback-crews-listener-rearm-pacing]] — the inverse gotcha (don't re-arm too eagerly in idle windows).
