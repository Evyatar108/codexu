## Researcher Findings
- Claimable crews identity comes from environment in SessionStart (`plugins/crews/hooks/session-start.js`), specifically role/name/crew and state-root routing.
- Member launchers export claimable `CREWS_*` vars (`plugins/crews/hooks/actors.js`), so descendants inherit impersonation inputs unless stripped.
- Ralph nested spawn boundaries are in `src/ralph.mjs`, `src/codex-exec.mjs`, `src/copilot-exec.mjs`, and `src/review-loop.mjs`.
- Brainstorm/plan skill lens invocations also run from member context and need the same env sanitization guarantees.

## Architect Analysis
- Preferred architecture is layered:
  1. Primary: sanitize env at spawn boundaries so nested children cannot present claim identity.
  2. Defense: refuse descendant claims in crews ownership logic regardless of engine.
- This design blocks both same-engine and cross-engine takeover paths and tolerates one missed spawn-site by still enforcing descendant refusal.
- Two-plugin scope implies planned sequencing and explicit ship-order handling.

## Codex Research
Confirmed D-001 constraints from brainstorm synthesis:
- Same-engine takeover is the load-bearing gap to close.
- Do not rely on engine-mismatch-only decline as primary control.
- Require explicit same-engine dogfood proof in acceptance.

## Copilot Research
Converged with other lenses on:
- Two-layer design (spawn sanitization + ancestry refusal).
- Non-regression requirement against first-bind, same-tab reclaim, and dead-member recovery tests.
- Cross-plugin sequencing note is required in finalized plan.

## Consolidated File List
### Files to modify
- `ai-developer-toolkit/plugins/ralph/src/ralph.mjs`
- `ai-developer-toolkit/plugins/ralph/src/codex-exec.mjs`
- `ai-developer-toolkit/plugins/ralph/src/copilot-exec.mjs`
- `ai-developer-toolkit/plugins/ralph/src/review-loop.mjs`
- `ai-developer-toolkit/plugins/crews/hooks/actors.js`
- `ai-developer-toolkit/plugins/crews/hooks/session-start.js` (if wiring requires)
- `ai-developer-toolkit/plugins/crews/tests/session-ownership-divergence.test.js`

### Test files
- `ai-developer-toolkit/plugins/ralph/tests/*` (new/expanded nested-env coverage)
- `ai-developer-toolkit/plugins/crews/tests/session-ownership-divergence.test.js`

### Planning references
- `.ralph/brainstorms/crews-nested-child-takeover-engine-agnostic-prevention/selected-direction.md`
- `.ralph/brainstorms/crews-nested-child-takeover-engine-agnostic-prevention/brainstorm-synthesis.md`
