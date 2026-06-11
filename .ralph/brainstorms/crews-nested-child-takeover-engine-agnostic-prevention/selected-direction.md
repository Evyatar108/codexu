---
overviewTaskId: crews-nested-child-takeover-engine-agnostic-prevention
---

## Direction
D-001 — Primary ralph spawn-env sanitization plus crews ancestry refusal defense-in-depth. Remove claimable crews identity env from nested child processes at ralph spawn boundaries, and enforce an engine-agnostic nested-child refusal in crews based on process ancestry to block any missed path.

## Goal
Nested children spawned during `/implement-with-ralph` iterations and brainstorm/plan/review lens fanout can no longer claim a live parent member's crews identity (session or engine takeover), including the same-engine codex->codex case, while legitimate first-bind, `/clear` rebind, and dead-member recovery flows continue to work.

## Scope
### In Scope
- Ralph-side env sanitization for nested spawn boundaries:
  - implementer iteration spawn chain (`src/ralph.mjs` -> `src/codex-exec.mjs` / `src/copilot-exec.mjs`)
  - review/lens spawn paths (`src/review-loop.mjs`, brainstorm/plan skill-driven codex/coplan lens commands)
- Crews-side defense-in-depth ancestry refusal using existing process introspection/ancestry helpers in `hooks/actors.js`.
- Unit tests in both plugins plus live dogfood proving no same-engine takeover and intact delivery.
- Cross-plugin sequencing notes (ralph + crews bumps, serialize with in-flight crews impl to avoid version-file conflicts).

### Out of Scope
- Delivery-symptom mitigation task (`crews-undeliverable-report-notify-lead`) beyond interface coordination.
- Replacing the entire SessionStart claim model.
- Relying on engine mismatch (GAP2) as the primary mechanism.

## Criteria
- Child processes launched from ralph nested paths do not inherit claimable crews identity vars (`CREWS_ROLE`, `CREWS_NAME`, `CREWS_CREW`, `CREWS_STATE_CWD`, `CREWS_BOOTSTRAP_REPLY_TO`).
- Same-engine nested test (codex member spawning codex iteration) cannot steal parent manifest session/engine, and parent can still deliver `done/question/blocked`.
- Cross-engine nested test (copilot member spawning codex child) remains blocked from takeover.
- Brainstorm/plan/review lens-child paths cannot claim parent role.
- Crews ancestry defense-in-depth blocks nested descendants even if a spawn path accidentally leaks env.
- Non-regression: first bind, same-tab `/clear` reclaim, and recoverable dead-member reclaims continue to pass existing tests.

## Context
Claimable identity in SessionStart is env-driven (`CREWS_ROLE/NAME/CREW`) and state-scoped by `CREWS_STATE_CWD`, while launcher scripts deliberately export those vars to member sessions. Current protections are insufficient as a sole strategy for same-engine nesting because engine-mismatch decline only applies cross-engine; same-engine children still enter claim logic and depend on live-tab guard behavior. The recommended design moves prevention to the source (ralph spawn env) and keeps crews guardrails as structural fallback.
