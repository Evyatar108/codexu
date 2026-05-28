---
name: spawn-prompt-must-require-review-fix
description: "When spawning Ralph members, the spawn prompt must EXPLICITLY require Phase 5a/5b review-fix convergence before fast-forward-and-push. Otherwise members may interpret \"drive to terminal then push\" as license to skip the post-impl code review."
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 61598f1c-1ec5-4b0f-ae33-2b06d5c6ae30
---

**Rule:** Every spawn prompt instructing a member to drive a task end-to-end must include language like:

> "Step 2: when plan/PRD lands, run `/implement-with-ralph --from-plan ... --autonomous` to drive through Phase 4 (ralph.sh stories), **Phase 5a (code review-fix convergence — multiple rounds if needed)**, **Phase 5b (docs review-fix convergence)**, Phase 5.5 (retrospective), and Phase 6 (terminal). Do NOT skip Phase 5a/5b; the post-impl review catches issues the plan-review pass missed. Phase 5a/5b must reach `review: {code: 'clean', docs: 'clean'}` before merge."
>
> "Step 3: only AFTER Phase 5/6 terminal-clean, fast-forward main and push."

**Why:** Ambiguous prompts ("when terminal:complete, fast-forward and push") let a member interpret terminal as "stories pass" (Phase 4 done) rather than the full Phase 6 terminal-clean (after Phase 5 review-fix). Observed in `impl-spawn-from-app` (2026-05-26): member shipped 4 commits to main after Phase 4 alone, leaving 4 Medium plan-review findings (F-009..F-012) documented but un-addressed. Reviewed in `impl-mobile-tree-view`'s precedent (same session): 3 review-fix rounds caught 2 High findings reviewers missed pre-impl. Skipping that step is a real quality loss.

**How to apply:** When relaying spawn directives in the `crews.js spawn-member -- <prompt>` argument, hard-code the "Phase 5a/5b mandatory" language. Don't trust members to infer it from the seed planPrompt or from "drive to terminal."

**When NOT to require Phase 5a/5b:**
- Empty-diff short-circuit cases (work already on main, only finalization artifacts need writing — precedent: `impl-1a-fork-doc`, `impl-port-explorer-prompt-v2`).
- Explicit operator instruction to skip review for a hotfix or rollback.
- **Research-only spike with multi-model converged consensus + verified citations.** When the deliverable is a doc (not code), all 4 review channels (researcher / architect / codex-xhigh / copilot-xhigh) converge on the same recommendation, and the member verifies citations against source, that constitutes a Phase 5a equivalent. Running the full plan→PRD→ralph.sh→review machinery over a consensus doc adds ceremony without quality gain. Precedent: `impl-codex-child-spawn-tools` (2026-05-26, commit `23d43f93`) shipped a 207-line research doc directly after 4-way reviewer consensus + citation verification.

**Lesson learned 2026-05-26:** Operator caught the deviation. Going forward, bake Phase 5a/5b into every implement-driving spawn prompt.

Related: [[feedback_bookkeeper_updates_overview_data]], [[feedback_codex_fork_no_local_cargo]]
