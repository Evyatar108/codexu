---
name: crews-listener-rearm-pacing
description: "Do not re-arm the crews listener every empty timeout cycle when nothing else is happening — wait until there's actual work to do."
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 61598f1c-1ec5-4b0f-ae33-2b06d5c6ae30
---

When the crews background listener exits via timeout (not via message delivery) and the conversation is idle (no mailbox content, no pending member checkpoint, no operator instruction), do NOT immediately re-arm and emit an empty `<|report kind="progress" summary="Idle"|>` turn.

**Why:** the user explicitly called this out — each turn consumes a model invocation and clutters the conversation with content-free "Idle." cycles. The listener arm/timeout loop on its own doesn't advance any work; it just burns turns until either the operator types something or a member emits a mailbox message.

**How to apply:**

- If a task-notification fires for a listener-only exit (no `review-required` flag, no mailbox content, no relevant member work in flight), arm the listener ONCE if not already armed and then respond with a substantive turn — or stay quiet entirely if the runtime allows.
- If multiple consecutive turns have produced identical "Idle / re-arm" content, stop re-arming proactively. The listener heartbeat is for *liveness*, not for *busy-wait polling*.
- Heartbeat-staleness from missed re-arms is recoverable on the next operator interaction; lost turns are not.
- Exception: if a member is mid-task and might emit a checkpoint at any moment, the re-arm cycle is worth it. Empty cycles with NO active members do not qualify.

This is operator-explicit feedback (2026-05-24), not a guess.
