# Notepad — ralph-pipeline-03-ui-chip

## PERMANENT

- Parallel-work guardrail: a sibling crew member (watcher-worker) is implementing Plan 02 on branch `ralph-pipeline-02-watcher` and ALSO edits `tools/overview-viewer/vite.config.ts`. Plan 03 must keep its vite.config edits in a NEW named plugin `overviewRalphStatePlugin()` sibling to `overviewDataPlugin()`. Plan 03 must NOT touch Plan 02's `configureServer` extensions and must NOT call `server.watcher.add(...)` for the ralph sidecar.
- Stack: React 19 + Vite 8 + Vitest + Radix UI. NOT Svelte.
- Static bundle budget: `wc -c plans/overview.html` must be <= 525000 bytes after Plan 03 ships (currently ~495,245 bytes).

### Recurring failures

| notTested | firstSeen | secondSeen | revalidateAfter | status |
|---|---|---|---|---|
<!-- key: c3eaeb869183a0e654f1472570ccba7a5d7b1c8e61a3559dfac1beeafa919333 -->
| live browser verification; dev-browser tooling unavailable | 2026-05-19T11:13:10Z | 2026-05-19T11:21:08Z | 2026-05-20T11:21:08Z | active |

## User Preferences

(none yet)

## Deferred Questions

| # | Question | Story ID | Iter Asked | Answer | Iter Answered | Auto-Resolved |
|---|----------|----------|------------|--------|---------------|---------------|

## Story Doctor Log

(none yet)

## Autonomous Decisions

- 2026-05-19 — PRD subagent set `iterationEngine: "codex"` (default).
- 2026-05-19 — PRD subagent skipped optional criteria-validator (batch flow); Phase 2.7 below will run it.
- 2026-05-19 — Plan-review Mediums F-005..F-011 folded into per-story `notes`/criteria rather than tracked as separate findings (none had `classification: prd-worthy`).

## Working Notes

Phase 2.5: pluginRoot persisted, startCommit backfilled.

[2026-05-19T10:49:09Z] Phase 2.7 — criteria-validator: valid=true, 0 blockers, 8 tool-availability warnings (US-002 AC-010, US-003 AC-005/AC-009, US-004 AC-004/AC-006/AC-009, US-006 AC-004/AC-006). Browser/DOM-dependent acceptance criteria — iteration agent should fall back to jsdom or SKIPPED with rationale if dev-browser tooling unavailable.

[2026-05-19T11:23:13Z] Post-iter-3 state — mode: autonomous, passes: 3/7 (US-001, US-002, US-003 VALID). Remaining unblocked: US-004, US-005, US-006, US-007. Quality Gate passed (typecheck + 116 tests). Parity spot-check passed. Promoted PERMANENT key c3eaeb8691... (live-browser Not-tested, 2 occurrences across iters 2+3). Manifest verifier advisory skipped iters 1-3 (evidenceKind off-enum; advisory-only — does not affect VALID verdict).

[2026-05-19T11:48:30Z] Post-iter-6 state — mode: autonomous, batchSize: 3, passes: 6/7 (US-001..US-006 VALID; US-007 unblocked, cascade audit / docs-only). Remaining: US-007. Quality Gate passed via in-iteration evidence (typecheck 0 + 24 files / 119 tests pass each iter). Parity spot-check passed: loadRalphState ↔ loadOverviewData; overview-ralph-state:update ↔ overview-data:update; overviewRalphStatePlugin ↔ overviewDataPlugin (sibling, non-modifying). Manifest verifier: iter 5 all 11 verdicts = agree; iters 4 and 6 structurally invalid (skippedReasons string-array vs object-array) — advisory only. Refactoring Pass DEFERRED — parallel-work guardrails on tools/overview-viewer/vite.config.ts (Plan 02 sibling crew) make broad refactor risky; only US-007 (docs cascade) remains.
