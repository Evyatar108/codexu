## PERMANENT

## User Preferences

## Deferred Questions

| # | Question | Story ID | Iter Asked | Answer | Iter Answered | Auto-Resolved |
|---|----------|----------|------------|--------|---------------|---------------|

## Story Doctor Log

## Autonomous Decisions

## Working Notes

[Criteria Validator 2026-05-20T07:37:48Z] Rewrote vague/underspecified acceptance criteria for US-002, US-003, US-004, US-005. Replaced "Manual smoke" phrasing with deterministic CLI-output and grep-based assertions against the SKILL.md files. Added explicit vitest test invocation for US-002 (scripts/lib/derive-next-command-cli.test.mjs). For US-003/US-004/US-005, behavior is transitively covered by US-001/US-002 tests (CLI output) plus grep-based body assertions; skills are markdown, not unit-testable in vitest.

## Deferred Cascade

- US-006: Plan 07 job `D:/harness-efforts/codexu/.ralph/jobs/ralph-pipeline-07-context` is RUNNING as of 2026-05-20T08:12:16Z, so Plan 06 did not edit shared plan docs during cascade refresh.
- When Plan 07 is terminal, update `plans/ralph-pipeline-INDEX.md` Source-of-truth modules to list `scripts/lib/derive-next-command.mjs` with its repoRoot/options contract and the repo-local skill artifacts `.claude/skills/{work-on,triage,blocker-report}/SKILL.md`.
- When Plan 07 is terminal, audit `plans/ralph-pipeline-07-context.md` so `/blocker-report` references `ralph.deferredQuestionsCount` and `ralph.deferredQuestionsPreview` exactly as implemented by the Plan 06 skill.
- When Plan 07 is terminal, audit `plans/ralph-pipeline-08-crews.md` so `/work-on --via-crew <crewName>` replaces the Plan 06 error string `crews delegation not yet implemented — wait for Plan 08.`.
- When Plan 07 is terminal, audit `plans/ralph-pipeline-09-mcp.md` so MCP tools import `scripts/lib/derive-next-command.mjs` and share the `deriveNextCommand(state, task, options?)` predicate rather than reimplementing the stage table.
- F-004 docs review (2026-05-20): Plan 07 still RUNNING. INDEX cascade for `scripts/lib/derive-next-command-cli.mjs` (add as new source-of-truth row; mark consumed by /work-on, /triage, /blocker-report, future Plan 09 MCP) and Plan 12 extraction-list addition deferred until Plan 07 terminal. Also tighten the existing `derive-next-command.mjs` INDEX row's "Consumed by" column to reflect that skills route through the CLI wrapper.
