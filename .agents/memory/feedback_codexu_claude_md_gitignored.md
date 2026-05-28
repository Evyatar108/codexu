---
name: feedback-codexu-claude-md-gitignored
description: "In the codexu repo, root `CLAUDE.md` is gitignored. Fork-level guidance lives in `AGENTS.md`. Spawn prompts for codexu-touching impl members MUST flag this."
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 61598f1c-1ec5-4b0f-ae33-2b06d5c6ae30
---

The codexu repo's `.gitignore` includes `CLAUDE.md` (line 67) — the root `CLAUDE.md` is intentionally local-only (the operator's bookkeeper operating manual lives there as an untracked file). Tracked fork-level guidance is in `AGENTS.md`.

Impl members spawned to update codexu docs MUST be told this explicitly. Otherwise they may `git add CLAUDE.md` thinking they're updating a normal tracked doc, override the gitignore semantically (the file becomes tracked because `git add -f` or by an old-base branch where it wasn't yet gitignored), and the resulting commit either overwrites the operator's local manual or pollutes the repo with a duplicate doc.

**Why:** 2026-05-26 incident. The multi-MCP impl member committed a 7-line `CLAUDE.md` on its branch (`ralph/ralph-overview-multi-mcp-v210` commit `30a5b27e`) intended to add v2.1.0 coordination notes. The branch was based on an older main where CLAUDE.md was not yet gitignored. When I cherry-picked onto current main, it created a tracked `CLAUDE.md` conflicting with the gitignore convention. Required a follow-up commit (`80239642`) to remove the tracked file. The legitimate `.claude/skills/overview-reset/SKILL.md` update from the same commit was kept.

**How to apply:**
- Every codexu-touching impl spawn prompt's "Files to read/touch" section must include: "**Note:** root `CLAUDE.md` is gitignored in codexu; do NOT add docs there. Fork-level guidance goes in `AGENTS.md`. The bookkeeper's local CLAUDE.md is an operator-only file."
- When cherry-picking commits from impl member branches onto codexu/main, scan the cherry-picked diff for `CLAUDE.md` adds/modifies and reject those — those edits belong in `AGENTS.md`.
- The same warning likely applies to similar fork-managed repos (codex, ai-developer-toolkit). Check `.gitignore` before authoring spawn prompts that mention "update CLAUDE.md".
