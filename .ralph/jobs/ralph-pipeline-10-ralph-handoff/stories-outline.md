# Stories Outline: Ralph plugin handoff doc (`overviewTaskId` field)

*Preliminary decomposition from `/plan-with-ralph --improve`. Feed to `/implement-with-ralph --from-plan` for PRD generation.*

## US-001: Write `plans/ralph-overview-task-id.md` handoff doc

**Description:** As the codexu workspace owner, I want a single markdown handoff doc at `plans/ralph-overview-task-id.md` that fully specifies the ralph-orchestration plugin patches needed to add an optional `overviewTaskId` field across PRD, group, and brainstorm artifacts, so that a future `/plan-with-ralph --improve` cycle run from the Ralph plugin source tree can pick it up and ship the patches without re-deriving requirements.

**Acceptance Criteria:**
- [ ] `plans/ralph-overview-task-id.md` exists in the worktree at `D:/harness-efforts/codexu/.ralph/jobs/ralph-pipeline-10-ralph-handoff/worktree/plans/ralph-overview-task-id.md`.
- [ ] The doc contains all 10 top-level sections in this order: 1. Context, 2. Ralph internals checked, 3. Patches required (with subsections 3.1–3.4), 4. Back-compat, 5. Out of scope, 6. Critical compatibility gotchas, 7. Suggested landing order, 8. Acceptance criteria, 9. Tests, 10. How to pick this up.
- [ ] All 4 Ralph skill patches are documented: `convert-to-ralph-prd`, `decompose-plan`, `brainstorm-with-ralph`, `plan-with-ralph`. Each has a CLI flag (or prompt), a write location, and — where applicable — a schema-or-artifact-example update directive.
- [ ] The doc pins ralph-orchestration **v5.32.0** (cached) and notes source-tree v5.35.0 with a drift-reconciliation directive.
- [ ] The doc references `plans/ralph-pipeline-01-foundation.md` and the comprehensive plan at `glistening-wondering-llama.md` for context.
- [ ] The doc explicitly names the field `overviewTaskId` (camelCase), confirms no existing schema property collision, and explicitly states the field is OPTIONAL everywhere (not in any `required` array).
- [ ] §3.2 (decompose-plan) precedence order has the explicit `--overview-task-id` CLI flag FIRST, then parent plan metadata, then parent `prd.json`.
- [ ] §3.1 (convert-to-ralph-prd) treats `--overview-task-id` as canonical, free-form prompt as the default, and any consumer-config-driven lookup (e.g. `plans/overview-data.js`) as opt-in with explicit fallback when the file is absent.
- [ ] §6.1 documents the `implement-with-ralph` Phase 0 first-line-check gotcha and both valid resolutions (patch Phase 0; use non-front-matter metadata block).
- [ ] §6.2 calls out `tests/test-no-prohibited-changes.sh`.
- [ ] §10 includes the verbatim handoff command: `/plan-with-ralph --improve` invocation pointed at the doc, runnable from the Ralph plugin source tree.
- [ ] `plans/ralph-pipeline-INDEX.md` audited; refreshed only if it references this plan's output filename, the schema field name `overviewTaskId`, or the plugin version pin AND any diverged. Otherwise unchanged.
- [ ] Typecheck passes (no-op for doc-only changes, but verify nothing else broke).

**Dependencies:** None.

**Estimated complexity:** small
