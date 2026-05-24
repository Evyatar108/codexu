## PERMANENT

- **2026-05-17 — US-008 destructive gate APPROVED by operator.** The operator opened `plans/overview.html.next` (446 KB inlined artifact, 0 external `<script src>`/`<link href>` refs, file:// ready) and confirmed visual parity vs the 9f81c1f8 baseline (modulo the deliberate deferred-class addition from US-005). Iteration agent is authorized to: (1) delete `plans/overview.html`, (2) emit the new artifact at `plans/overview.html`, (3) commit the destructive swap. This approval satisfies the gate documented in the job CLAUDE.md and US-008's first acceptance criterion.

## User Preferences

## Deferred Questions

| # | Question | Story ID | Iter Asked | Answer | Iter Answered | Auto-Resolved |
|---|----------|----------|------------|--------|---------------|---------------|

## Story Doctor Log

## Autonomous Decisions

## Working Notes

- 2026-05-18 — Post-iter-9 state: PRD COMPLETE. passed: 9 (US-001..US-009 @ 61c10cb4), blocked: 0, remaining: 0, mode: interactive, batchSize: 1, cumulativeCompleted: 9. All 9 stories pass with VALID evidence; ready for parent Phase 4 (completion check).
- 2026-05-18 — Evidence validation (iter 9): US-009 VALID — 4 ACs covered by 4 verifiedEvidence entries. SKILL.md viewing subsection + root README Roadmap viewer subsection both grep-confirmed; tools/overview-viewer/README.md untouched verified via empty git diff; typecheck exit 0. criteriaWarnings: null (docs-only AC set; no fallback needed).
- 2026-05-18 — Quality Gate (interactive, freq default 1, trigger at cumulativeCompleted crossing 9): PASS — `pnpm --filter @codexu/overview-viewer typecheck` exit 0 (tsc --noEmit clean) re-run at HEAD 61c10cb4. US-009 is docs-only (32 insertions / 2 files); existing iteration evidence already shows typecheck + test exit 0.
- 2026-05-18 — Parity spot-check skipped (US-009 ACs lack mirror/parity/reuse keywords).
- 2026-05-18 — Refactoring Pass skipped twice over: (a) cumulativeCompleted=9 is not a multiple of refactorInterval=5, and (b) docs-only batch (2 docs files, 0 production) hits the documented docs-only refactor skip.
- 2026-05-18 — Manifest verifier skipped for iteration 9: iteration-result-9.json uses legacy `evidenceKind: "command-output"` not the v5.25 closed-enum; structural validation fails as on iter-1..8. Advisory only; dashboard block replaced with iter-9 entry.
- 2026-05-18 — Recurring Not-tested failures: none crossed occurrences>=2 threshold. US-009 commit has no `Not-tested:` trailer; nothing to promote.
- 2026-05-18 — Iter-4 "Not-tested" trailer ("Browser DOM/visual kanban verification unavailable...") was NOT promoted because the commit body uses `Constraint:` rather than `Not-tested:`, so parse-not-tested-trailers.sh did not pick it up. Iteration agents should use `Not-tested:` trailer wording if they want recurrence detection to apply.
- Worktree at `.worktrees/overview-vite-react` on branch `ralph/overview-vite-react` forked from `main@9f81c1f8`.
- US-008 is destructive (overwrites `plans/overview.html`) and gated on operator approval of `plans/overview.html.next` preview from US-007. Gate was satisfied at iter-8.
- 2026-05-17 — [Criteria Validator] Phase 2.7 produced 2 TOO_SHORT blockers + 22 tool-availability warnings. User chose "Apply validator suggestions"; rewrote US-002:AC-003 and US-005:AC-001 via validator-suggested expansions; 22 browser/DOM tool-availability warnings merged into per-story `criteriaWarnings` arrays in prd.json.

### Not-tested candidates

| notTested | firstSeen |
|---|---|
<!-- key: 1e08e38ed161597cc8d416080ccfc8f58824104e5f5ee151780a8882d35f6bd1 -->
| browser dom/hmr visual pass unavailable; verified dev server and hmr log fallback. | 2026-05-17T23:56:34Z |
<!-- key: fa42fecf88dbd4cf667c5cf97052e80ef25c7d839fb0ac493b1e1bd477b51a52 -->
| browser theme and visual verification unavailable; css parity verified by exact diff fallback. | 2026-05-18T00:06:00Z |
<!-- key: a43b6f32d4af6637f6f269b82912d31ed9c09cc32726b98be4fffb6f2b4d57c3 -->
| browser dom/visual command-list verification; dev-browser unavailable | 2026-05-18T00:20:03Z |
<!-- key: 72d63ac38f8f3b09bb021e1d5e7effbfd925dcf4e3c4eb7d9ba86b1080526ab5 -->
| browser dom/visual phase-tree verification; dev-browser unavailable. | 2026-05-18T00:43:12Z |
<!-- key: 8257d7ae888700ede693dd69c3a52229786ab1e0a6601d418b949b4cf64567bb -->
| browser dom/visual us-006 pass; dev-browser unavailable. | 2026-05-18T01:03:26Z |
<!-- key: 0889f3b7f8bbdbadfa328bf760c1a91443c3dfc953ac24948f6367bdb44f3a3f -->
| browser file:// visual parity; dev-browser unavailable, operator must review .next. | 2026-05-18T01:14:12Z |
<!-- key: 6f15a7214ba0f66d5cd6a0a3dc3a8f85c40f4e2a0359d9f31845dcd5e39b94a6 -->
| no-env live build; destructive path is gated to us-008. | 2026-05-18T01:14:12Z |
<!-- key: a39331d3c88e522934daf1c878e03fd31afa0c4e18426599dab8a02d7a476ec3 -->
| browser file:// live artifact pass; dev-browser unavailable. | 2026-05-18T01:28:12Z |
