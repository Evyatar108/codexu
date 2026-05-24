# PRD: Plan 06 — Repo-local skills + `derive-next-command.mjs`

## Introduction / Overview

This feature adds three repo-local Claude Code skills (`/work-on`, `/triage`, `/blocker-report`) that wrap the Ralph orchestrator's per-stage command surface so users — and future MCP/crew callers — never have to remember "is this a `--from-brainstorm`, `--improve`, `--from-plan`, or `resume` call?" A single new pure-ESM module, `scripts/lib/derive-next-command.mjs`, owns the stage→command predicate. The skills, an optional UI button (out of scope here), and Plan 09's MCP tools all consume the same predicate.

This is the implementation of `plans/ralph-pipeline-06-skills.md`. The plan was reviewed via `/plan-with-ralph --improve` and all 11 findings were applied during Phase 4 synthesis. The plan is the canonical source for context; this PRD captures the user-story decomposition for Ralph autonomous execution.

**Autonomous mode assumptions** (no clarifying questions asked):
- Worktree: `D:/harness-efforts/codexu/.ralph/jobs/ralph-pipeline-06-skills/worktree/` on branch `ralph-pipeline-06-skills` forked from `main`.
- iterationEngine = codex (default). planningEngine = codex (default).
- The 6 stories are taken verbatim from `stories-outline.md` (US-001..US-006); acceptance criteria preserved as written.

## Goals

- Ship one canonical stage→command predicate (`deriveNextCommand`) consumed by skills, the optional UI button, and Plan 09's MCP server — no drift.
- Ship three Claude Code skills (`/work-on`, `/triage`, `/blocker-report`) that resolve and invoke the right Ralph orchestrator command for a task's current stage.
- Keep the predicate browser-safe / Vite-bundlable so the same module works in the overview-viewer UI and the future MCP server.
- Land the cascade refresh atomically so downstream plans (07/08/09) and the INDEX reflect the shipped contract.

## User Stories

### US-001: Predicate module + types

**Description:** As a Ralph user, I want a single pure-ESM module that maps a task's `RalphPipelineState` to the next-step command so all consumers (skills, optional UI, future MCP) share one source of truth.

**Acceptance Criteria:**
- [ ] `scripts/lib/derive-next-command.mjs` exports `deriveNextCommand(state, task, options?) -> NextCommand | null` with the file-level JSDoc version-pin naming ralph-orchestration v5.41.0.
- [ ] Module is browser-safe — no `node:fs`, `node:path`, or `node:child_process` imports.
- [ ] `scripts/lib/derive-next-command.d.mts` exists and re-exports the signature for TypeScript consumers.
- [ ] `tools/overview-viewer/src/types.ts` exports `interface NextCommand { label: string; command: string; icon?: string }` placed near `Recommendation` (additive — no conflict with Plan 07's `RalphPipelineState` extension).
- [ ] `pnpm --filter @codexu/overview-viewer typecheck` passes.
- [ ] `scripts/lib/derive-next-command.test.mjs` covers all 10 stages plus null-on-shipped, parallel-group `implementing` with `{ repoRoot }`, brainstorming-with-slug, no-artifact fallback. `pnpm test scripts/lib/derive-next-command.test.mjs` passes.
- [ ] Typecheck passes.

**Dependencies:** None

### US-002: CLI helper

**Description:** As a skill author, I want a CLI wrapper around the predicate so skill markdown bodies can shell out via one short command without JSON-quoting fragility.

**Acceptance Criteria:**
- [ ] `scripts/lib/derive-next-command-cli.mjs` exists. Reading `plans/overview-snapshot.json`, looking up `--task <id>`, resolving repoRoot via `git rev-parse --show-toplevel`, and writing `NextCommand | null` as JSON to stdout.
- [ ] Optional `--snapshot <path>` overrides the snapshot location.
- [ ] On no-match, exits non-zero with a stderr message naming the missing task id.
- [ ] Manual smoke: run with a known task id from a freshly-synced `plans/overview-snapshot.json`; stdout is valid `NextCommand` JSON.
- [ ] Typecheck passes.

**Dependencies:** US-001

### US-003: /work-on skill

**Description:** As a Ralph user, I want `/work-on <task-id>` to resolve the right Ralph skill invocation for a task's current stage and either dry-run-print or invoke it.

**Acceptance Criteria:**
- [ ] `.claude/skills/work-on/SKILL.md` exists with YAML frontmatter (`name: work-on`, `description: ...`).
- [ ] Body covers arg parsing (positional `<task-id>` exact case-insensitive match; `--dry-run`; `--via-crew` error for Plan 08); snapshot location; task resolution + picker on ambiguity; null-handling for shipped vs other stages; seed-prompt fallback; explicit skill-name mapping (`/plan-with-ralph` → `ralph-orchestration:plan-with-ralph` etc.).
- [ ] Manual smoke: `/work-on <known-id> --dry-run` prints the predicate-table command for the current stage.
- [ ] `/work-on <known-id> --via-crew foo` errors with `crews delegation not yet implemented — wait for Plan 08.`
- [ ] Typecheck passes.

**Dependencies:** US-001, US-002

### US-004: /triage skill

**Description:** As a Ralph user, I want `/triage` to rank tasks needing attention from the snapshot's recommendations and chain into `/work-on`.

**Acceptance Criteria:**
- [ ] `.claude/skills/triage/SKILL.md` exists with frontmatter and body.
- [ ] Reads `snapshot.recommendations` primarily; falls back to `plans/overview-recommendations.json` wrapper only when snapshot is missing (not when snapshot is present-but-empty).
- [ ] Renders numbered list with `taskId`, stage, score, reasons; prompts for picker; selecting a number invokes `/work-on <id>`.
- [ ] `--limit N` and `--filter stage=<stage>` flags supported.
- [ ] Manual smoke: with ≥5 recommendations, `/triage` shows top 5; with empty recommendations, shows the "no recommendations" message.
- [ ] Typecheck passes.

**Dependencies:** US-001, US-002, US-003

### US-005: /blocker-report skill

**Description:** As a Ralph user, I want `/blocker-report` to surface blocked tasks with proposed remediation commands.

**Acceptance Criteria:**
- [ ] `.claude/skills/blocker-report/SKILL.md` exists with frontmatter and body.
- [ ] Filters `snapshot.tasks` for `ralph.stage === 'blocked'`, `ralph.stage === 'review-fix'` with non-zero `reviewOpenCount.code|docs` (open Medium+ findings — wording must match), `ralph.deferredQuestionsCount > 0` (gated; undefined treated as 0), and PRD `userStories[].blocked === true`.
- [ ] Renders entries with `taskId`, stage, jobDir, blocker summary, proposed action (`/implement-with-ralph resume <jobSlug>`). Picker chains into `/work-on`.
- [ ] Manual smoke: with a synthetic blocked task in the snapshot, the skill surfaces it.
- [ ] Typecheck passes.

**Dependencies:** US-001, US-002, US-003

### US-006: Cascade refresh

**Description:** As a Ralph pipeline maintainer, I want Plan 06's implementation to update the INDEX and downstream plan references so future agents see a consistent contract.

**Acceptance Criteria:**
- [ ] `plans/ralph-pipeline-INDEX.md` "Source-of-truth modules" table lists `scripts/lib/derive-next-command.mjs` and the new `.claude/skills/{work-on,triage,blocker-report}/` artifacts.
- [ ] `plans/ralph-pipeline-07-context.md` reference to `/blocker-report` and `deferredQuestionsPreview` field name matches the actual implementation.
- [ ] `plans/ralph-pipeline-08-crews.md` `--via-crew` error string matches the implemented one.
- [ ] `plans/ralph-pipeline-09-mcp.md` predicate-module path matches.
- [ ] **If Plan 07 worker is still RUNNING at cascade time**, emit `## Deferred Cascade` entries to notepad.md instead of touching shared plan docs.
- [ ] Cascade lands as a single atomic commit; commit message lists each diff (file:line, change summary).
- [ ] Typecheck passes (no .ts changes here; this is doc-only).

**Dependencies:** US-001, US-002, US-003, US-004, US-005

## Functional Requirements

- FR-1: `deriveNextCommand(state, task, options?)` switches on `state.stage` only and returns `NextCommand | null` per the predicate table in `plan.md` (10 stages including `replan-pending`).
- FR-2: The predicate module is pure ESM, browser-safe, and Vite-bundlable (no Node-only imports).
- FR-3: When a required artifact (e.g., `planFile`, `jobDir`, `brainstormDir`) is missing from `state.artifacts`, the predicate returns `null` so callers can surface a missing-data hint.
- FR-4: For parallel-group `implementing` (`isParallel === true` AND `groupSlug` set) the predicate returns `/implement-with-ralph --run-only --job <absolute_groupDir>` using `options.repoRoot` to absolutize.
- FR-5: A CLI wrapper (`scripts/lib/derive-next-command-cli.mjs`) owns snapshot reading, `--task <id>` lookup, repoRoot resolution, and `NextCommand | null` JSON marshalling so skills do not embed `node -e` with inline JSON.
- FR-6: `/work-on <task-id>` resolves the next command via the CLI helper, supports `--dry-run`, picks the right `ralph-orchestration:<skill>` skill, and errors on `--via-crew` with the exact string `crews delegation not yet implemented — wait for Plan 08.`.
- FR-7: `/triage` reads `snapshot.recommendations` first, falls back to `plans/overview-recommendations.json` wrapper only when the snapshot file is missing, supports `--limit N` and `--filter stage=<stage>`, and chains into `/work-on` via the `Skill` tool.
- FR-8: `/blocker-report` surfaces tasks where `ralph.stage === 'blocked'`, `ralph.stage === 'review-fix'` with non-zero Medium+ findings, `ralph.deferredQuestionsCount > 0`, or PRD `userStories[].blocked === true`, and proposes the predicate-derived retry command.
- FR-9: The cascade story refreshes `plans/ralph-pipeline-INDEX.md` and Plans 07/08/09 references; if Plan 07's worker is still RUNNING at cascade time, deferred entries land in `notepad.md` under `## Deferred Cascade` instead.

## Non-Goals (Out of Scope)

- `--via-crew <crewName>` delegation logic for `/work-on` — Plan 08.
- MCP server exposing `overview.next_command` / `overview.invoke_next` — Plan 09.
- `TaskCommand.tsx` "Copy next command" Quick Action button — optional follow-up.
- Populating `deferredQuestionsCount` / `deferredQuestionsPreview` on `RalphPipelineState` — Plan 07. `/blocker-report` must gracefully degrade when the fields are undefined.

## Technical Considerations

- Predicate is pinned to `ralph-orchestration v5.41.0`. The top-of-file JSDoc comment is the durable contract; when the orchestrator's resume syntax changes (e.g., `--run-only` canonicalization), this module must be updated in lockstep.
- `tools/overview-viewer/src/types.ts` is also extended by Plan 07 — place `NextCommand` near `Recommendation` (different cluster from Plan 07's `RalphPipelineState` extension) to keep the merge clean.
- Tests live next to source as `scripts/lib/<name>.test.mjs` (kebab-case, flat layout); `vitest.config.ts` picks them up via `scripts/lib/**/*.test.mjs`.
- Repo paths in `state.artifacts` are POSIX strings (forward slashes) even on Windows; use string concatenation rather than `node:path` so the module stays Vite-bundlable.
- Snapshot files (`plans/overview-snapshot.json`, `plans/overview-recommendations.json`) are sync-emitted, not committed. Skills must handle the missing-file case and check `<repoRoot>/.ralph/overview-sync.lock` heartbeat before nagging the user.

## Success Metrics

- All 6 stories ship with their acceptance criteria checked.
- `pnpm test scripts/lib/derive-next-command.test.mjs` passes with 10 stage cases plus null-on-shipped, parallel-group, brainstorming-slug, no-artifact cases.
- `pnpm --filter @codexu/overview-viewer typecheck` passes against the extended `types.ts`.
- `/work-on <known-id> --dry-run` prints the predicate-table command for each stage (manual smoke).
- Cascade audit commit lists each plan-doc diff for review.

## Open Questions

1. CLI helper output shape on no-match: currently exits non-zero with stderr. Alternative (exit 0 + stdout `null`) was considered and rejected during Phase 4 review.
2. Predicate signature `(state, task, options?)` vs `(snapshot, taskId, options?)`: settled on `(state, task, options?)` to keep the function pure; the CLI helper owns I/O.
