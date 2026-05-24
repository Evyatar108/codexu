# Job Dashboard: ralph-pipeline-04-pipeline-overview-v2

## Status

- Status: PAUSED (after batch 1 — 3 iterations)
- Iterations completed: 3
- Stories: 3/6 passed, 0 blocked, 3 remaining
- Start commit: fc27ba86

## Story Progress

| Story | Title | Status | Iteration | Commit |
|---|---|---|---|---|
| US-001 | Foundation: widen types, add config schema, extract atomic-write, build PRD carrier | passed | 1 | d06ef014 |
| US-002 | scoreRecommendations pure helper + tests | passed | 2 | 4f86ead3 |
| US-003 | deriveDependencyGraph pure helper + tests | passed | 3 | 9a50c375 |
| US-004 | emitDerivedArtifacts + writeSidecar wiring + integration freshness test | pending | — | — |
| US-005 | PipelineOverview component + App.tsx wiring + CSS + tests | pending | — | — |
| US-006 | Downstream cascade audit + CLAUDE.md update | pending | — | — |

## Failure Timeline

| Iteration | Story | Classification | Error Summary | Story Doctor Action |
|---|---|---|---|---|

(no failures recorded in batch 1)

## Deferred Questions

| # | Question | Story ID | Status |
|---|---|---|---|

Resolved: 0 | Auto-Resolved: 0 | Pending: 0

<!-- MANIFEST-VERIFIER-DISAGREEMENTS:BEGIN -->
## Manifest Verifier Disagreements

### Iteration 1

manifest-verifier failed for iteration 1; advisory verifier skipped (no Agent subagent tool available in this analyze-iteration session — Step 0.5 is fail-open and advisory only; Progress Analyst evidence validation remains authoritative below).

### Iteration 2

manifest-verifier failed for iteration 2; advisory verifier skipped (no Agent subagent tool available in this analyze-iteration session — Step 0.5 is fail-open and advisory only; Progress Analyst evidence validation remains authoritative below).

### Iteration 3

structural manifest validation failed for iteration 3; verifier skipped (iteration-result-3.json uses non-enum evidenceKind values "inspection", "test", "typecheck" — closed enum requires one of "passed", "skipped", "manual-skip", "fallback", "absent-verified"). This is advisory-only; Progress Analyst evidence validation still classifies US-003 as VALID below.
<!-- MANIFEST-VERIFIER-DISAGREEMENTS:END -->
