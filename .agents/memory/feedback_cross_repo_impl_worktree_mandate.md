---
name: feedback-cross-repo-impl-worktree-mandate
description: "When spawning impl members whose work spans multiple shared sibling repos, mandate worktrees in EVERY shared repo — not just the one you anticipated."
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 61598f1c-1ec5-4b0f-ae33-2b06d5c6ae30
---

When spawning an `/implement-with-ralph` member whose plan touches multiple sibling git repos that other crew members may also be working in (e.g., `D:/ai-developer-toolkit`, `D:/harness-efforts/codexu`), the spawn prompt MUST include worktree-creation instructions for EVERY shared repo the impl will edit — not just the one you initially anticipated.

**Why:** 2026-05-26 incident: I spawned two impl members in parallel (impl-overview-multi-mcp-v210 + impl-crews-review-mid-turn-v160). Both wrote to `D:/ai-developer-toolkit`. The crews member checked out `ralph/crews-review-mid-turn-v160` first; multi-MCP's spawn prompt instructed it to `git checkout -b ralph/ralph-overview-multi-mcp-v210 main` — which would have disturbed the crews member's uncommitted state. Multi-MCP correctly surfaced this as `kind=question` before acting; I corrected with a worktree directive. My spawn prompt had a worktree mandate for codexu (correctly anticipating v2 was using it) but missed the equivalent for ai-developer-toolkit because I hadn't thought "the OTHER new impl member is in there too."

**How to apply:**
- Before spawning any cross-repo impl member, enumerate every sibling repo the plan touches.
- For EACH repo, check if any other live crew member is using it (via `list-members` + manifest cwd inspection).
- For EVERY repo that has either a co-resident member OR is the lead's own cwd (which may already be on a non-main branch), put a worktree-creation line in the spawn prompt.
- Default pattern: `git -C <repo> worktree add <repo>-<feature-slug> -b ralph/<feature-slug> main`.
- Cross-repo `/implement-with-ralph` strategy: run from the worktree of the repo that owns most stories; pass `--from-plan` with that repo's job dir; let iterations edit cross-repo via the other worktrees; push each branch separately at Phase 6.

See also [[feedback-bookkeeper-updates-overview-data]] (also covers post-ship bookkeeping for multi-repo impls).
