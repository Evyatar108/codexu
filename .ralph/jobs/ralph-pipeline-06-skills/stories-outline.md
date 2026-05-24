# Stories Outline: Plan 06 — Repo-local skills + derive-next-command.mjs

*Preliminary decomposition from `/plan-with-ralph --improve`. Feed to `/implement-with-ralph --from-plan` for PRD generation.*

## US-001: Predicate module + types
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
**Estimated complexity:** small

## US-002: CLI helper
**Description:** As a skill author, I want a CLI wrapper around the predicate so skill markdown bodies can shell out via one short command without JSON-quoting fragility.
**Acceptance Criteria:**
- [ ] `scripts/lib/derive-next-command-cli.mjs` exists. Reading `plans/overview-snapshot.json`, looking up `--task <id>`, resolving repoRoot via `git rev-parse --show-toplevel`, and writing `NextCommand | null` as JSON to stdout.
- [ ] Optional `--snapshot <path>` overrides the snapshot location.
- [ ] On no-match, exits non-zero with a stderr message naming the missing task id.
- [ ] Manual smoke: run with a known task id from a freshly-synced `plans/overview-snapshot.json`; stdout is valid `NextCommand` JSON.
- [ ] Typecheck passes.
**Dependencies:** US-001
**Estimated complexity:** small

## US-003: /work-on skill
**Description:** As a Ralph user, I want `/work-on <task-id>` to resolve the right Ralph skill invocation for a task's current stage and either dry-run-print or invoke it.
**Acceptance Criteria:**
- [ ] `.claude/skills/work-on/SKILL.md` exists with YAML frontmatter (`name: work-on`, `description: ...`).
- [ ] Body covers arg parsing (positional `<task-id>` exact case-insensitive match; `--dry-run`; `--via-crew` error for Plan 08); snapshot location; task resolution + picker on ambiguity; null-handling for shipped vs other stages; seed-prompt fallback; explicit skill-name mapping (`/plan-with-ralph` → `ralph-orchestration:plan-with-ralph` etc.).
- [ ] Manual smoke: `/work-on <known-id> --dry-run` prints the predicate-table command for the current stage.
- [ ] `/work-on <known-id> --via-crew foo` errors with `crews delegation not yet implemented — wait for Plan 08.`
- [ ] Typecheck passes.
**Dependencies:** US-001, US-002
**Estimated complexity:** small

## US-004: /triage skill
**Description:** As a Ralph user, I want `/triage` to rank tasks needing attention from the snapshot's recommendations and chain into `/work-on`.
**Acceptance Criteria:**
- [ ] `.claude/skills/triage/SKILL.md` exists with frontmatter and body.
- [ ] Reads `snapshot.recommendations` primarily; falls back to `plans/overview-recommendations.json` wrapper only when snapshot is missing (not when snapshot is present-but-empty).
- [ ] Renders numbered list with `taskId`, stage, score, reasons; prompts for picker; selecting a number invokes `/work-on <id>`.
- [ ] `--limit N` and `--filter stage=<stage>` flags supported.
- [ ] Manual smoke: with ≥5 recommendations, `/triage` shows top 5; with empty recommendations, shows the "no recommendations" message.
- [ ] Typecheck passes.
**Dependencies:** US-001, US-002, US-003
**Estimated complexity:** small

## US-005: /blocker-report skill
**Description:** As a Ralph user, I want `/blocker-report` to surface blocked tasks with proposed remediation commands.
**Acceptance Criteria:**
- [ ] `.claude/skills/blocker-report/SKILL.md` exists with frontmatter and body.
- [ ] Filters `snapshot.tasks` for `ralph.stage === 'blocked'`, `ralph.stage === 'review-fix'` with non-zero `reviewOpenCount.code|docs` (open Medium+ findings — wording must match), `ralph.deferredQuestionsCount > 0` (gated; undefined treated as 0), and PRD `userStories[].blocked === true`.
- [ ] Renders entries with `taskId`, stage, jobDir, blocker summary, proposed action (`/implement-with-ralph resume <jobSlug>`). Picker chains into `/work-on`.
- [ ] Manual smoke: with a synthetic blocked task in the snapshot, the skill surfaces it.
- [ ] Typecheck passes.
**Dependencies:** US-001, US-002, US-003
**Estimated complexity:** small

## US-006: Cascade refresh
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
**Estimated complexity:** small
