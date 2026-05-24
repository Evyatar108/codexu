# Plan Review Synthesis

## Reviewers run
- Claude (Agent, subagent_type=Explore): 1 Critical, 2 High, 2 Medium, 1 Low
- Codex (codex-exec.sh --effort high): 0 Critical, 0 High, 6 Medium, 4 Low
- Copilot (copilot-exec.sh): 0 Critical, 1 High, 2 Medium, 1 Low

## Consensus (2+ reviewers flagged same issue)

### F-001 [High] — "5 files" count is wrong; only 4 listed
- Source: Codex (Feasibility Medium + Criteria Medium) + Copilot (Criteria High)
- Plan says "Modify (5 files)" at line 115 and AC #1 says "All 5 doc files" but the modify-list enumerates only 4: `parallel-assignments.md`, `BOOX-TESTING-HANDOFF.md`, `codexu-roadmap.md`, `overview.html`.
- Resolution: change count from 5 → 4 across the plan.

### F-002 [Medium] — `plans/parallel-assignments.md:160` still says "deferred" — should say "closed"
- Source: Claude (Critical Completeness) + Codex (Completeness Medium)
- Line 160's polish-PR command body says "F-013, F-015, F-016 already addressed or deferred (don't include)". After this close-out, "F-013 deferred" is inaccurate; should say "F-013 closed (Sprint E), F-015/F-016 deferred". Also helps the future operator who runs that polish-PR command not see contradictory guidance.
- Resolution: Move line 160 from "optional/leave" to a mandatory edit; specify new text.

### F-003 [Medium] — Grep AC scope is internally inconsistent
- Source: Codex (Criteria Quality Medium) + Copilot (Criteria Medium)
- AC #1 says grep across `plans/` and `docs/operations/`, then allows an exception in `docs/fork-roadmap.md` which is outside that scope.
- Resolution: spell out the exact grep commands, or restructure as two greps with the fork-roadmap.md exception as a separate "do not edit" assertion.

### F-004 [Medium] — `plans/codexu-roadmap.md:322` rewrite leaves F-013 inside the "Open findings" bullet
- Source: Codex (Completeness Medium) + Copilot (Simplicity Medium)
- The proposed rewrite changes "1 code (F-013 Low)" to "0 code (F-013 Low closed ...)" which still names F-013 under "Open findings". A closed item should disappear from the open-findings bucket and be recorded in the preceding "Review convergence" paragraph or a separate note.
- Resolution: rewrite both line 318 and line 322 so F-013 closure lives in the convergence text and only the count remains in the Open-findings line.

## Claude-only findings

### F-005 [High] — `plans/overview.html` `.closed` CSS class fallback
- The plan delegates the CSS strategy to the implementer. Should specify either (a) add `.closed { color: var(--ok); text-decoration: line-through; }` or analogous, or (b) use the fallback text-prepend strategy. Verified that `.closed` does not currently exist in `plans/overview.html` (only `.open` and `.deferred`).
- Resolution: specify the fallback explicitly. Tie to F-006 below.

### F-006 [High] — Commit-body should cross-reference the stale `CLAUDE.md` permissions.ts path
- Future readers following the citation trail from the commit body will hit the stale `src/claude/permissions.ts` reference in `packages/happy-cli/CLAUDE.md`. One-line note in commit body prevents future confusion.
- Resolution: add to the commit-body template.

### F-007 [Medium] — Typecheck/test commands lack exact invocations in AC #6
- Resolution: spell out `pnpm --filter '{packages/happy-cli}' run typecheck` (expect "0 errors"), optionally drop the vitest re-run for a docs-only commit.

### F-008 [Medium] — Final-verification grep command not spelled out
- Resolution: bake into the Implementation Strategy: `git grep -n "F-013" plans/ docs/operations/` and `git grep -n "F-013" docs/fork-roadmap.md` with expected outputs.

### F-009 [Low] — Phase 5 sunset-review date
- Commit body should include a `Review-by: 2026-08-13` so future operators have a calendar trigger if Phase 5 slips.
- Resolution: add to the commit-body template.

## Codex-only findings

### F-010 [Medium] — Closeout plan path doesn't exist yet (ordering)
- Plan references `.ralph/jobs/f-013-perms-closeout/plan.md` in proposed doc edits, but the job directory hasn't been created yet (only `.ralph/jobs/.staging/...` exists).
- Resolution: This is normal — `/implement-with-ralph` Phase 0 creates `job_dir` and copies plan.md before any code work. Document this ordering invariant explicitly in the plan's Implementation Strategy: "Phase 5 of the planning workflow copies plan.md to `<job_dir>/plan.md` before implement-with-ralph starts code edits, so the path is live at edit time."

### F-011 [Medium] — `plans/overview.html` F-013 card still on assignable-now Kanban
- Even with a "closed" visual state, leaving the card on the assignable-now board contradicts the close-out. Removing the card entirely is simpler.
- Resolution: **operator choice** — surface as a choice point.

### F-012 [Low] — `plans/overview.html:165` names "devtunnels-E notepad" as F-013 source
- Even after close-out, the card sub-text "source: .ralph/jobs/devtunnels-E-cleanup/notepad.md" will misleadingly imply that source exists.
- Resolution: update sub-text to "Closed 2026-05-13 obsolete-by-design; original notepad missing — see .ralph/jobs/f-013-perms-closeout/plan.md".

### F-013 [Low] — typecheck + vitest is overkill for docs-only
- Resolution: drop vitest from AC; keep one focused typecheck as a defensive smoke test.

### F-014 [Low] — `.closed` CSS class unnecessary if card removed
- Resolution: collapses if F-011 picks "remove card".

### F-015 [Low] — "renders correctly when opened in a browser" AC is too subjective
- Resolution: change to "HTML has balanced tags (verify with `tidy -e plans/overview.html` or visual inspection of `git diff`) AND no F-013 card appears in the assignable-now Kanban section".

## Copilot-only findings

### F-016 [Low] — branch vs main commit target ambiguity
- Plan says "branch off `main`" in one place and "commit on `main`" elsewhere.
- Resolution: pick one. Recommend: commit on a topic branch `f-013-perms-closeout`, then merge via standard PR flow.

## Divergences
None of material concern. All findings are addressable; the disagreements are between "mark closed visually" vs "remove from active board" (F-011) and the granularity of which AC commands to specify (Codex says less, Claude says more).

## Recommended Amendments
1. Fix F-001 (count 5→4), F-002 (line 160 mandatory), F-003 (grep AC spelled out), F-004 (codexu-roadmap rewrite), F-005 (CSS fallback specified), F-006 (commit-body CLAUDE.md note), F-007 (typecheck command), F-008 (final-verification grep), F-009 (sunset date), F-010 (path-ordering documented), F-012 (overview.html:165 sub-text), F-013 (drop vitest from AC), F-015 (concrete AC), F-016 (branch-vs-main clarified).
2. Surface F-011 to operator as a choice (mark closed visually vs remove card entirely from assignable-now).
