---
name: dual-repo-plan-pause-chain
description: "For plans that span two repos with a cross-repo merge gate, pause before chaining /implement-with-ralph and surface the implementation-strategy decision."
metadata: 
  node_type: memory
  type: feedback
  originSessionId: a729cda0-3b69-410b-813a-dff613de0158
---

For Ralph plans that span TWO repos with a cross-repo merge gate (e.g., Plan 12: extract plugin from codexu into ai-developer-toolkit, then migrate codexu to consume it), do NOT blindly chain `/implement-with-ralph` after `/plan-with-ralph` even when the user's task spec says "chain into /implement-with-ralph".

Instead: present the planning result, then surface the implementation-strategy decision via AskUserQuestion before burning any autonomous cycles.

**Why:** `/implement-with-ralph` generates one PRD targeting one repo. A dual-repo plan with stories like "create plugin tree in repo A" + "remove files from repo B" can't be expressed as one PRD without silently dropping half the stories or pointing the worktree at the wrong tree. Plan 12 explicitly noted "Plain git checkout -b (not Ralph-orchestrated worktree)" for the plugin side, while the consumer side is meant for a Ralph worktree — the chain would either fail or partially execute against an un-installed plugin.

**How to apply:** When a finalized plan's "Files to Create" / "Files to Modify" sections reference multiple distinct repo roots, OR when the plan explicitly names two branch names in two repos, OR when a phase has a "phase-precondition" gated on another repo's PR merge — pause the chain. Offer at least these options: (a) return planning-only result, (b) do Phase A manually + chain Phase B later, (c) two separate Ralph jobs. The user picked (a) for Plan 12.

Validated by user choice on 2026-05-21 during Plan 12 (extract `ralph-overview` plugin).
