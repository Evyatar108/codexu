---
name: async-events-prefer-generic-primitive
description: "For async-event subscription APIs and similar runtime-extensible surfaces, prefer one generic primitive that the agent configures at runtime over multiple pre-baked tools per event type."
metadata: 
  node_type: memory
  type: feedback
  originSessionId: bfe5b53f-781f-42ea-91e4-d1078a04758c
---

When designing async-event / subscription / event-listening APIs that agents (LLMs) call at runtime, prefer a **single generic primitive** the agent configures over **multiple pre-baked tools per event kind**.

Example: `async_events.register({ kind: "shell-poll" | "file-glob" | "timer" | "mcp-passthrough", config })` is the right shape — NOT separate `git_subscribe`, `fs_subscribe`, `timer_subscribe` tools.

**Why:** Operator said on 2026-05-13 (after reviewing the first cut of `plans/async-events-design.md`):
> "I want to have a flexible generic way for models to define the events they listen on, we dont need to define pre-existing tools for events in advance"

Pre-baked tools per event type lock the shape and prevent agents from listening on new event sources without code changes. A generic primitive with a small set of generic source-kind dispatchers (shell-poll, file-glob, timer, mcp-passthrough) lets the agent extend coverage by configuration alone.

**How to apply:**
- Whenever designing an agent-facing tool surface, ask "would this be N tools per event-type/resource-type, or one generic configurable tool?" Default to the latter unless there's a concrete reason against (e.g. completion-time argument constraints, materially different semantics per kind).
- Applies to: event subscription, resource access, RPC dispatchers, anything where the "kind" is enumerable.
- Does NOT apply to: tools with fundamentally different effects per kind (e.g. `read_file` vs `write_file` shouldn't merge into a generic `file_op`).

Related: [[channels-research]] §6.1 — the codex MCP bridge is the transport for the generic envelope; not a producer.
