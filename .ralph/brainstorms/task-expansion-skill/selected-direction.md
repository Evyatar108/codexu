---
overviewTaskId: task-expansion-skill
---

## Direction
D-004 — Hybrid: checked-in 5-section template + thin context-bundling MCP tool. Template owns the format contract; the MCP tool only bundles structured context (task entry, advisory prerequisite/unblocks candidates from a git-log heuristic, recent commits, snapshot stage, plan/brainstorm pointers); the calling agent does the prose synthesis. This split keeps deterministic code out of authorship, preserves operator-curated `data.json` as authoritative, and makes the skill usable from any MCP-capable agent session without rebuilding ralph-overview into a prose generator.

## Goal
After this lands, any agent session (overview-bookkeeper lead, impl member, planner) can invoke a single MCP tool with a tracked task id and receive a structured JSON context bundle plus a pointer to the checked-in 5-section template. The agent then produces a consistent task expansion covering: (1) What it is, (2) Why it matters, (3) Upstream-conflict surface, (4) Prerequisites — what previous (shipped) work unblocked this task, (5) Unblocks — what downstream tasks become spawn-ready. Output consistency comes from the template; freshness comes from on-demand invocation; provenance comes from the context bundle (every claim the agent makes can be traced back to a field in the bundle or to its own analytical judgment).

## Scope

### In Scope (v1)
- New checked-in template at `.ralph-overview/task-expansion-template.md` in codexu, defining the 5-section contract verbatim, a short "how to use the bundled context" preamble, and an evidence rubric (cite source files, link commits by SHA, distinguish auto-discovered candidates from curated metadata).
- New MCP tool `overview.expand_task_context(taskId)` added to `ralph-overview/tools/overview-mcp/`, returning a structured JSON bundle:
  - `task` — the full task entry from `.ralph-overview/data.json` (id, scope, lifecycle, status, descriptionHtml, prompts, kanbanCards, warnings, lastTouchedAt, shipManifest if present)
  - `stage` — current Ralph stage from snapshot.json if a job exists for this id (else null)
  - `recentCommits[]` — `git log --grep=<taskId> --oneline -20` across codexu (and submodule pointers acknowledged but not deeply searched in v1)
  - `prerequisitesCandidates[]` — heuristic-derived list: for each file the task's prompts.* mention, find lifecycle=merged tasks whose shipManifest.commits touched that file. Each entry labeled `candidate` with the source heuristic (`prompt-file-overlap` or `commit-message-grep`).
  - `unblocksCandidates[]` — inverse: for each lifecycle=tracked task that references files this task is about to modify (per its prompts.*), include as a downstream candidate.
  - `planPath`, `brainstormPath` — absolute paths to `.ralph/jobs/<id>/plan.md` and `.ralph/brainstorms/<id>/selected-direction.md` if they exist on disk (else null).
  - `templatePath` — absolute path to `.ralph-overview/task-expansion-template.md` so the agent always reads the format contract before authoring.
- Tool input schema added to `overview-mcp/src/schemas.ts`; handler at `overview-mcp/src/tools/expand-task-context.ts`; registration in `overview-mcp/src/server.ts`.
- Unit tests for the heuristic (`prompt-file-overlap` + `commit-message-grep`) under `overview-mcp/src/__tests__/expand-task-context.test.ts` with fixture tasks.
- One new skill file (or expansion of `work-on`) that documents the invocation pattern: "Call `overview.expand_task_context` first, read `templatePath`, then write the 5-section expansion." Skill name: `expand-task` under `ralph-overview/skills/expand-task/SKILL.md`.
- Bump `ralph-overview` plugin version (minor bump, e.g. 2.6.x → 2.7.0) since this adds a new MCP tool surface.
- One worked example: run the new tool against `impl-mcp-server-notifications` and check the resulting expansion into `.ralph/brainstorms/task-expansion-skill/example-expansion.md` so the validation reference is in-repo.

### Out of Scope (v1; tracked as Phase-2 followups)
- Curated `unblocks: string[]` / `unblockedBy: string[]` TaskSchema fields. v1 is auto-discovery + advisory labels only. Phase 2 adds the schema fields, makes them authoritative, and downgrades auto-discovery to a fallback when the curated fields are empty. Will be tracked as a new task `task-expansion-curated-graph-fields` once v1 ships and the disconfirming observation has been tested.
- Dashboard-rendered cache of expansions (e.g. `.ralph-overview/generated/task-expansions/<id>.md`). Rejected by devil's advocate; expansions are agent-facing decision inputs, not human-facing dashboard artifacts. Reconsider only if a real consumer asks for it.
- Codex-submodule git-log search (auto-discovery for tasks scoped `codex`). v1 limits commit search to codexu repo; codex-side prerequisites are flagged via `scope: "codex"` on the task entry but not heuristically derived. Phase 2 adds optional submodule scan.
- A `/expand-task <id>` slash command in codexu (vs the skill living inside ralph-overview). The skill inside ralph-overview is sufficient and cross-engine; a codexu-local slash command would duplicate.
- Cross-task batch expansion ("expand all readyTasks in one call"). v1 is one-task-at-a-time. The bookkeeper can loop in prose.
- Prose-generation inside the tool itself. Permanently rejected per devil's advocate; the tool stays a deterministic context bundler.

## Criteria

The v1 ships successfully when ALL of these are verifiable:

1. `overview.expand_task_context(taskId="impl-mcp-server-notifications")` returns a JSON bundle with all documented fields populated (or explicitly `null` when no plan/brainstorm/snapshot exists), no truncation, and a stable schema validated against a Zod schema in `schemas.ts`.
2. Calling the tool with a non-existent task id returns a typed error (not an exception) with the actionable message "task id <id> not found in .ralph-overview/data.json; valid ids include: <first 5 ids>...".
3. The `prerequisitesCandidates[]` heuristic, run against `impl-mcp-server-notifications`, surfaces at least one true prerequisite (manually verified against the operator's mental model documented in data.json or the example expansion). Acceptable false-positive rate for v1: ≤ 50% of candidates per task on the first three real tasks expanded.
4. The checked-in template at `.ralph-overview/task-expansion-template.md` exists, contains all 5 sections verbatim with one-paragraph guidance under each, and is referenced by absolute path from the tool's `templatePath` field.
5. Unit tests in `overview-mcp/src/__tests__/expand-task-context.test.ts` cover: bundle shape on a happy-path task; prereq heuristic on a fixture with one matching merged task; not-found error path; plan/brainstorm pointer logic when files exist vs don't.
6. The example expansion at `.ralph/brainstorms/task-expansion-skill/example-expansion.md` is checked in, follows the 5-section template, and was demonstrably generated using the new tool (the file's prologue cites which bundle fields it drew from).
7. `pnpm --filter overview-mcp test` and `pnpm --filter overview-mcp build` pass.
8. Bookkeeper uses the tool once in a real session (not part of the impl) and reports: structure adherence improved over the 2026-05-31 ad-hoc baseline OR documents the gap that motivates a Phase-2 followup.

## Context

### Synthesis highlights
- The triggering event (2026-05-31 ad-hoc bookkeeper expansion) was praised for human-style synthesis, not template-fill. Pushing prose generation into deterministic tool code would risk losing exactly the quality that earned the operator request. The split — template (format) + tool (context) + agent (synthesis) — preserves the praised quality while making the workflow repeatable and cross-session.
- Operator already curates `.ralph-overview/data.json` extensively (descriptionHtml, prompts.{brainstorm,plan,impl}, kanbanCards, warnings, shipManifest). Curated state should remain authoritative for v1; auto-discovery is a labor-saver layered on top, not a replacement.
- Ralph-overview already exposes 5 MCP tools and is auto-loaded by both Claude Code and Copilot CLI on every codexu session. Adding one more tool inherits that cross-engine reach for free — no separate plugin install, no `.mcp.json` change beyond a plugin version bump (and that bump auto-resolves via the marketplace).

### Disconfirming observations carried forward
- Devil's advocate, primary: "If agents given a simple checked-in template plus data.json/snapshot context already produce consistently useful 5-section overviews, then a dedicated skill/MCP tool is solving a tooling preference, not a workflow gap." Mitigation: validation criterion #8 requires a real-session use; if structure adherence does not improve over the ad-hoc baseline, the v1 implementation is reconsidered before any Phase-2 work is greenlit.
- D-004 secondary: "If the auto-derived `prerequisitesCandidates` are wrong more often than right (>50% noise) on the first three real expansions, drop auto-discovery from v1 and rely entirely on operator-curated `unblocks` / `unblockedBy` fields (promote from Phase 2 to v1)." Mitigation: criterion #3 caps the acceptable false-positive rate at 50%; if exceeded, the planner re-scopes to D-005 (curated-only).

### Open questions for the planner (not blocking direction selection)
- Heuristic tuning: should `prompt-file-overlap` extract file paths from prompts.* via a regex (e.g. `src/**`, `packages/**/sources/**`, `.ralph-overview/**`) or by spawning a small extractor LLM call? v1 leans regex for determinism; the planner should evaluate whether the regex coverage is good enough on the first three real tasks.
- Cache invalidation (deferred from v1 but should be designed for): if Phase 2 adds an optional dashboard cache, the natural invalidation trigger is `data.json` mtime + the watcher's `activity.jsonl` tail. Design the v1 tool so adding a cache layer later does not change its public interface.
- Skill discoverability: should the `expand-task` skill be `user-invocable: true` (operators type `/expand-task <id>`) or `description`-only (agents auto-invoke when reasoning about a task)? Both are cheap; the planner should pick one explicitly so the install story is clear.
- Codex-submodule scope: when the task entry has `scope: "codex"`, should the v1 tool warn in its output that codex-side commits are not searched? Probably yes — a `caveats[]` field on the bundle keeps that explicit.

### Estimated impl effort (v1)
- Template doc: ~30 min.
- MCP tool (schema + handler + heuristic + registration): ~3–4 h.
- Unit tests: ~1–1.5 h.
- Skill markdown: ~30 min.
- Example expansion + validation pass: ~1 h.
- Total: ~6–7 h of focused impl work, plus the operator validation step (~30 min real-session use, not on the implementer).
