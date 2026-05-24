# Stories Outline: F-013 Permission-Mode Override — Docs-Only Close-Out

*Preliminary decomposition from `/plan-with-ralph`. Feed to `/implement-with-ralph --from-plan` for PRD generation.*

## US-001: Close out Sprint E F-013 across the trackers (docs-only)

**Description:** As the codexu maintainer, I want Sprint E F-013 (latent permission-mode override path in Claude permission handler) marked as closed/obsolete-by-design across all tracking artifacts in this repo, so that the parallel-job dispatcher, the BOOX testing handoff, the roadmap accounting, and the visual overview no longer offer F-013 as a startable task — and so that future readers understand the latent code path is intentionally left in place until the Phase 5 (drop-Claude) deletion removes the surface entirely.

**Acceptance Criteria:**

- [ ] All 4 doc files updated per `plan.md` "Files to Create/Modify" section: `plans/parallel-assignments.md` (lines 41, 66, 160, 188), `docs/operations/BOOX-TESTING-HANDOFF.md` (lines 244, 329), `plans/codexu-roadmap.md` (lines 318, 322), `plans/overview.html` (lines 173, 261-270 + 263 + 268, 589, 642, plus new `.closed` CSS class).
- [ ] `plans/overview.html` has a new `.closed` CSS class defined consistently with the existing `.open` / `.deferred` classes — rule `.item-name.closed { color: var(--ok); text-decoration: line-through; }` and `.card.closed { opacity: 0.6; border-color: var(--ok); }`.
- [ ] `git grep -n "F-013" plans/ docs/operations/` returns only lines annotated as closed/obsolete-by-design.
- [ ] `git grep -n "F-013" docs/fork-roadmap.md` returns exactly one match at line 103 (p4-attachments F-013 — sanitizeAttachmentName, **not** Sprint E). Plan does not touch this line.
- [ ] Single commit on topic branch `f-013-perms-closeout` (forked from `main`).
- [ ] Commit subject and body explicitly reference "F-013 (Sprint E)" or equivalent to disambiguate from the p4-attachments F-013.
- [ ] Commit body includes:
  - Rationale: "obsolete-by-design — superseded by Phase 5 drop-Claude" with citation to `plans/codexu-roadmap.md:541`.
  - Explicit deviation note: "no new vitest test added — original task acceptance criterion does not apply because no code change was made; latent path intentionally left in `packages/happy-cli/src/claude/utils/permissionHandler.ts:87-89` until Phase 5 deletion".
  - Cross-reference: `packages/happy-cli/CLAUDE.md` "Permission Mode Protocol" section path-staleness note (real file is `src/claude/utils/permissionMode.ts`, not `src/claude/permissions.ts`).
  - Calendar trigger: `Review-by: 2026-08-13` (re-open F-013 decision if Phase 5 has slipped past this date).
- [ ] Defensive typecheck passes: `pnpm --filter '{packages/happy-cli}' run typecheck` emits 0 errors.
- [ ] `git diff --stat` after all edits shows only files under `plans/` and `docs/operations/`. No source-code file (under `packages/happy-cli/src/**`) is modified.
- [ ] `plans/overview.html` has balanced HTML tags after edits (verify by visual inspection of `git diff` for matched `<div>`/`<span>`/`<li>` open/close around each edited range) AND the F-013 card on the assignable-now Kanban renders with the new `.closed` styling.

**Dependencies:** None.

**Estimated complexity:** small (one focused docs-only commit; ~30-45 min including verification greps + typecheck).
