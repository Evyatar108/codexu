---
overviewTaskId: overview-data-context-scalability
---

## Direction
D-001 — ID-scoped tooling + lazy MCP first; defer source-storage split. All three lenses (codex, copilot, devils-advocate) converged on this as the right first step after grounding invalidated the seed's "every session loads 173K tokens" premise; the proven pain is edit-anchor write-safety, which a checked-in write API solves without any storage migration.

## Goal
A bookkeeper session can ship a task with zero hand-anchored edits to `.ralph-overview/data.json`, and the lead's normal read path is exclusively through generated artifacts + MCP tools rather than direct views of the monolithic source. Specifically, after this work:

- A new command `node tools/data-edit.mjs <verb> <task-id> [...args]` exists, supporting at minimum `mark-shipped`, `upsert-task`, `set-lifecycle`, `add-kanban-card`, and `set-prompts`. The command loads `.ralph-overview/data.json`, finds the target task by exact id, validates schema + invariants (task count unchanged for in-place verbs, no duplicate ids, JSON parses post-write), writes atomically (`tmp` + rename), and prints a minimal unified diff plus the affected-task id.
- Equivalent MCP write tools (`overview.upsert_task`, `overview.mark_shipped`, `overview.set_lifecycle`, …) are exposed by the existing ralph-overview MCP server so a Copilot/Claude lead can mutate the file from inside a session without a shell-out.
- The watcher emits two NEW generated artifacts at `.ralph-overview/generated/`:
  - `active-tasks.json` — only `tracked` lifecycle (today: 33 tasks ≈ 152 KB compact).
  - `summary-projection.json` — all tasks but with `command.prompts.*` and `command.descriptionHtml` bodies stripped, keeping id / scope / lifecycle / lastTouchedAt / mergeCommit | shipManifest summary line / warnings count. This drops ~374 KB of cold prompt text.
- AGENTS.md `## Bookkeeper operating invariants` is updated to: (a) declare `tools/data-edit.mjs` (or the equivalent MCP tool) the canonical write path, (b) document `active-tasks.json` + `summary-projection.json` as the canonical read paths, (c) restate the edit-anchor safety rules as last-resort fallback only.
- A repo lint or hook flags raw `edit`/`apply_patch` against `.ralph-overview/data.json` outside of `tools/data-edit.mjs` and prints the helper invocation instead.

## Scope
### In Scope
- `tools/data-edit.mjs` (CLI) covering the five verbs above. Each verb is a thin wrapper that does load → mutate-by-id → validate → atomic-write → diff-print.
- New ralph-overview MCP write tools mirroring the CLI verbs, with the SAME validation + atomic-write semantics. CLI and MCP share a single library so behavior is identical.
- Watcher additions in `ai-developer-toolkit/plugins/ralph-overview/scripts/lib/sync-core.mjs` to emit `active-tasks.json` and `summary-projection.json`. No source-side format change.
- Bookkeeper AGENTS.md updates declaring the new canonical paths.
- A repo lint/hook (PreToolUse or pre-commit) that flags raw mutations to `.ralph-overview/data.json` and prints the helper invocation.
- Two adoption-evidence sessions: convert the next two ship days (or two batched ship updates) to use the new helper end-to-end; measure zero edit-anchor regressions and document any helper UX gaps.

### Out of Scope
- Any restructuring of `.ralph-overview/data.json` source format (no per-task files, no lifecycle buckets, no JSON-array-of-arrays compaction). Source remains the monolithic JSON file.
- Replacing the watcher's read path or React app's data source (both still consume `snapshot.json`).
- Any new MCP READ tools beyond what already exists; `overview.parallel_ready_tasks` and `overview.expand_task_context` are sufficient.
- A prompt-trace instrumentation harness. The "is data.json actually entering context?" measurement is a separate concern — the brainstorm grounded that AGENTS.md/CLAUDE.md don't @-reference it, which is enough evidence to defer the structural split.
- Migration to per-task files (D-002). Remains an explicit follow-up if 300+ tasks + adoption telemetry justify it later.

## Criteria
- **C-1 helper exists and is testable.** `tools/data-edit.mjs --help` lists the five verbs; each verb has at least one passing test covering happy path + invariant violation (e.g., `set-lifecycle nonexistent-id` exits non-zero without writing).
- **C-2 atomic-write invariants are enforced.** The helper validates: (a) JSON parses after write, (b) `tasks.length` is preserved for in-place verbs, (c) every task has a non-empty `id`, (d) no duplicate `id`s, (e) the target task id is present after write (or absent, for delete verbs). On any invariant failure, the temp file is discarded and the original `data.json` is untouched.
- **C-3 MCP write tools mirror CLI.** The ralph-overview MCP server exposes `overview.upsert_task`, `overview.mark_shipped`, `overview.set_lifecycle`, `overview.add_kanban_card`, `overview.set_prompts`. Each tool's behavior is bit-identical to its CLI counterpart (verified by a round-trip test that runs both against a fixture and diffs the result).
- **C-4 watcher emits the two new projections.** `active-tasks.json` contains exactly the tasks where `lifecycle === 'tracked'`. `summary-projection.json` contains all tasks but with `command.prompts` and `command.descriptionHtml` replaced by `null` (or omitted entirely; deferred to plan-phase decision). Both files are written by the watcher in the same commit as their source.
- **C-5 lint/hook fires.** A documented PreToolUse hook (or pre-commit gate) detects raw edits to `.ralph-overview/data.json` and prints an actionable helper invocation. The hook is engine-aware: Claude Code's PreToolUse + Copilot CLI's preToolUse both fire.
- **C-6 adoption evidence.** Two real ship updates (lifecycle flip + shipManifest add for two different tasks) are landed via the helper, with no edit-anchor regression and no manual fallback to `Edit`. Documented in the AGENTS.md operational practice section.
- **C-7 backwards compatibility.** Before/after: `node bin/ralph-overview.mjs sync` produces a `snapshot.json` whose `tasks` array is byte-identical to the pre-change snapshot when no source edit has occurred. The new projections are additive only.
- **C-8 documentation.** AGENTS.md `## Bookkeeper operating invariants → data.json edit-anchor safety` is rewritten to declare the helpers canonical and edit-anchor rules a last-resort fallback. README of the ralph-overview plugin lists the new CLI + MCP verbs.

## Context

### Brainstorm synthesis highlights

- **Seed's central premise verifiably wrong.** AGENTS.md and CLAUDE.md have zero `@`-prefix auto-load directives. The ralph-overview MCP server caches data.json in process memory only — not injected into LLM context. The "every bookkeeper session auto-loads 680 KB / 173K tokens" framing is not supported by grounding evidence.
- **Two sibling tasks the seed flagged as in-flight are already merged.** `overview-data-dynamic-stages-schema` and `overview-data-ship-manifest` are both `lifecycle: merged` in current data.json — no coordination friction.
- **Proven pain is write-safety, not read-context-budget.** AGENTS.md `### data.json edit-anchor safety` documents 4 distinct regressions in a single 2026-06-03 session. That pain is fully solvable by ID-scoped tooling without touching source storage.
- **Cost asymmetry of the alternatives.** D-002 (per-task files) and D-003 (lifecycle buckets) each carry significant migration cost (watcher rewrite, dual-authority hazard, git-blame noise for D-002; ship-time multi-file edits for D-003) — all to solve a problem that may not exist.
- **Lens convergence.** All three lenses independently arrived at "ID-scoped tooling first" as the right next step:
  - Codex called it "Lazy MCP plus generated summary projection, no source split yet" (M effort).
  - Copilot called it "Tool-first lazy access with stronger edit helpers".
  - Devil's Advocate called it "F-plus: keep monolithic source, add ID-scoped edit/read tooling first" and explicitly identified the seed's reframe.
- **Disconfirming-observation contract.** If a prompt-trace at session start later shows data.json bytes leaking into context via some indirect path (Claude Code summarizer auto-introspect, MCP auto-call on session init, etc.), this decision must be revisited and D-002 promoted.

### Open questions to carry into planning

- **Naming + location of the helper.** `tools/data-edit.mjs` lives at codexu repo root or inside `ai-developer-toolkit/plugins/ralph-overview/`? The DA notes that the existing `node -e` mutation pattern is already in AGENTS.md as the recommendation — formalizing it as a script under the plugin keeps it shared across consumers, but at codexu-root keeps the bookkeeper's mental model tight. Plan-phase must pick.
- **MCP tool naming.** Existing tools use `overview.parallel_ready_tasks`. New write tools should follow the same prefix and snake_case. Confirm with the operator before the plan member commits.
- **`summary-projection.json` shape.** Should `command.prompts` be replaced by `null`, omitted entirely, or replaced by `{ "stripped": true, "approxBytes": N }`? The plan member should choose the simplest shape that lets consumers detect "this is the stripped projection" without ambiguity.
- **Lint/hook surface.** Claude Code PreToolUse hooks live in `.claude/hooks/`; Copilot CLI's live in `~/.copilot/hooks/` or plugin-bundled hooks. The hook should be shipped as part of the ralph-overview plugin so it is auto-installed with the plugin, not as a codexu-local file.
- **Adoption gate.** Should the operator manually approve the first two helper-driven ships (operator-in-the-loop) before declaring the helper canonical? Recommended yes for C-6 evidence.
