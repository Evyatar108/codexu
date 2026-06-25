# Requirements Gaps Assessment

## Dimension Ratings
| Dimension | Rating | Inference |
|-----------|--------|-----------|
| Goal | clear | Desired end state explicit: watcher recommendations + snapshot.recommendations (and viewer rows/NOTIFY chips) must never list lifecycle merged/archived tasks as actionable, while keeping the lifecycle/stage axis split intact. |
| Scope | clear | Plugin-side only (ai-developer-toolkit/plugins/ralph-overview); MCP parallel_ready_tasks already fixed (v2.10.0) and explicitly out of scope; two-commit submodule flow; version bump + marketplace sync. |
| Criteria | clear | Verifiable: regression tests assert merged/archived/legacy-phase excluded, tracked-ready kept, unknown-lifecycle kept, merged+blocked not an unblockCandidate; test:lib green; version + 3 indexes in sync; policy validator passes. |

## Clarifications
No questions needed — all dimensions clear from the authoritative seed + verified code trace.

## Remaining Open Questions
- Scope of the unblock-candidate gate (scoreRecommendations-only vs computeUnblockCandidate) — resolved in plan toward the complete fix (gate computeUnblockCandidate). Documented in the plan's Open Questions for reviewer pushback.
