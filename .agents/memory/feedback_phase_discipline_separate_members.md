---
name: feedback-phase-discipline-separate-members
description: Each ralph phase (brainstorm / plan / impl) gets its own fresh member. Never chain phases inside a single member.
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 61598f1c-1ec5-4b0f-ae33-2b06d5c6ae30
---

When spawning ralph workers for a task, each phase gets a SEPARATE fresh member. Don't chain brainstorm→plan or plan→impl inside one member's session.

**Why:** 2026-05-26 operator feedback: "I feel like we should always start each phase using a different member." Each phase has its own context-poisoning risk (long debug loops, dead-end explorations, intermediate-state assumptions that get baked into later work). Fresh members start with a clean context window and only the deliverable from the prior phase (committed doc/plan) — not the prior member's reasoning history. Validated by recent ships: plugin-scope-agents-v2, ralph-overview-multi-mcp-v210, and crews-review-mid-turn-v160 each used 2-3 separate members (brainstorm → plan → impl) and shipped cleanly with autonomous Phase 5a/5b convergence.

**How to apply when picking next-batch tasks:**

1. For each task, determine current phase (check `.ralph/brainstorms/<name>/` for prior brainstorm; `.ralph/jobs/<name>/plan.md` for prior plan; `.ralph/jobs/<name>/job-state.json` for prior impl).

2. Surface the **current phase** + **next-phase action** in the next-task recommendation. Don't just say "this task is ready" — say "this task needs planning next; spawn `plan-<task>` member."

3. Brainstorm phase: only required when the design isn't settled (fuzzy goals, multiple competing approaches, unknown conflict surface). Skip for concrete seeds with file paths + specific edits already identified.

4. Spawn pattern:
   - `brainstorm-<task>` → `/brainstorm-with-ralph` → produces `selected-direction.md` → operator reviews
   - `plan-<task>` → `/plan-with-ralph` (or `--from-brainstorm` if step prior shipped) → produces `plan.md` → operator reviews
   - `impl-<task>` → `/implement-with-ralph --from-plan --autonomous` → drives Phase 3→4→5a→5b→5.5→6 → reports kind=done

5. When the prior-phase member ships `kind=done`, stop that member cleanly via `/stop-member`. Do NOT keep it alive across phases. The next phase's member reads the committed deliverable (brainstorm doc / plan.md) from `origin/main` (or wherever the prior member pushed it), not from a chained mailbox handoff.

6. Phase 5a/5b convergence is INTERNAL to the impl member (per [[feedback-spawn-prompt-must-require-review-fix]]). The "fresh per phase" rule applies to the brainstorm/plan/impl axis, not to sub-phases inside impl.

**Regressions follow the same rule.** Ralph is a state machine: any stage can regress back to `brainstorming` or `planning` when review finds a design gap, scope change, or stale assumption. Each regression carries a short `RalphPipelineState.regressionReason` in the watcher state so the operator can see why the task moved backward. **A regression does NOT reuse the old member** — it spawns a FRESH crew member of the regressed-to phase. The new member reads the matching seed from `.ralph-overview/data.json`: `prompts.brainstorm` for regression-to-brainstorming, `prompts.plan` for regression-to-planning. The same "one member per phase" rule applies whether the phase entry is forward (first time entering planning) or backward (re-entering planning after a regression from implementing). If the relevant `prompts.<phase>` seed is missing, the task is not actionable until the bookkeeper adds one.

See also [[feedback-bookkeeper-updates-overview-data]] (when each phase ships, bookkeeper updates the per-task entry).
