# PRD: Ralph plugin handoff doc (`overviewTaskId` field)

## Introduction

The codexu overview dashboard (`tools/overview-viewer/`) associates each Ralph artifact (job, group, brainstorm) with an `OverviewTask.id` entry from `plans/overview-data.js`. Today, that association is brittle: it relies on slug-equality plus an optional `ralphOverrides` map. The comprehensive plan settled on a three-tier matching strategy where tier 1 — a first-class `overviewTaskId` field on Ralph artifacts — eliminates this brittleness for new jobs.

Tier 1 requires patches to the ralph-orchestration plugin itself, which lives in a different repo. This PRD covers writing a single markdown **handoff doc** (`plans/ralph-overview-task-id.md`) that fully specifies those patches so a future `/plan-with-ralph --improve` cycle (run from the Ralph plugin source tree) can pick it up and ship without re-deriving requirements.

This PRD is for codexu worktree-side work only. No Ralph plugin code is changed here. The deliverable is a single new markdown doc plus an optional touch-up to `plans/ralph-pipeline-INDEX.md`.

**Autonomous-mode assumptions made while generating this PRD:**
- Single-story scope inherited from `stories-outline.md` (one coherent doc deliverable).
- Job name: `ralph-pipeline-10-ralph-handoff`.
- Worktree path: `D:/harness-efforts/codexu/.ralph/jobs/ralph-pipeline-10-ralph-handoff/worktree/`.
- Branch: `ralph-pipeline-10-ralph-handoff`, forked off `main`.
- Iteration engine: default (`codex`).

## Goals

- Produce `plans/ralph-overview-task-id.md` with all 10 required top-level sections.
- Document the 4 Ralph plugin skill patches (`convert-to-ralph-prd`, `decompose-plan`, `brainstorm-with-ralph`, `plan-with-ralph`) with CLI/prompt shape, write locations, and (where applicable) schema or artifact-example update directives.
- Pin ralph-orchestration version (cached v5.32.0; source tree v5.35.0) and call out drift reconciliation.
- Surface the `implement-with-ralph` Phase 0 first-line check gotcha and the two valid resolutions.
- Surface the `tests/test-no-prohibited-changes.sh` guard callout.
- Audit `plans/ralph-pipeline-INDEX.md` and refresh only if it references the doc filename, the schema field name, or the plugin version pin.

## User Stories

### US-001: Write `plans/ralph-overview-task-id.md` handoff doc

**Description:** As the codexu workspace owner, I want a single markdown handoff doc at `plans/ralph-overview-task-id.md` that fully specifies the ralph-orchestration plugin patches needed to add an optional `overviewTaskId` field across PRD, group, and brainstorm artifacts, so that a future `/plan-with-ralph --improve` cycle (run from the Ralph plugin source tree) can pick it up and ship the patches without re-deriving requirements.

**Acceptance Criteria:**
- [ ] `plans/ralph-overview-task-id.md` exists in the worktree at `D:/harness-efforts/codexu/.ralph/jobs/ralph-pipeline-10-ralph-handoff/worktree/plans/ralph-overview-task-id.md`.
- [ ] The doc contains all 10 top-level sections in this order: 1. Context, 2. Ralph internals checked, 3. Patches required (with subsections 3.1-3.4 for the 4 skills), 4. Back-compat, 5. Out of scope, 6. Critical compatibility gotchas, 7. Suggested landing order, 8. Acceptance criteria, 9. Tests, 10. How to pick this up.
- [ ] All 4 Ralph skill patches are documented (`convert-to-ralph-prd`, `decompose-plan`, `brainstorm-with-ralph`, `plan-with-ralph`). Each has a CLI flag (or prompt), a write location, and — where applicable — a schema-or-artifact-example update directive (prd-schema.json for convert-to-ralph-prd; group-schema.json for decompose-plan; SKILL.md inline JSON example for brainstorm-with-ralph; no schema change for plan-with-ralph).
- [ ] The doc pins ralph-orchestration **v5.32.0** (cached) and notes source-tree v5.35.0 with a drift-reconciliation directive.
- [ ] The doc references `plans/ralph-pipeline-01-foundation.md` and the comprehensive plan at `C:/Users/evmitran/.claude/plans/glistening-wondering-llama.md` for context.
- [ ] The doc explicitly names the field `overviewTaskId` (camelCase), confirms no existing schema property collision, and explicitly states the field is OPTIONAL everywhere (not in any `required` array).
- [ ] §3.2 (decompose-plan) precedence order lists, top first: (1) explicit `--overview-task-id` CLI flag, (2) parent plan metadata, (3) parent `prd.json`.
- [ ] §3.1 (convert-to-ralph-prd) treats `--overview-task-id` as canonical, free-form prompt as the default, and any consumer-config-driven lookup (e.g. `plans/overview-data.js`) as opt-in with explicit fallback when the config is absent or unreadable. Lookup MUST NOT block PRD creation.
- [ ] §6.1 documents the `implement-with-ralph` Phase 0 first-line-check gotcha and both valid resolutions: (A) patch Phase 0 to skip leading YAML front-matter; (B) use a non-front-matter metadata block.
- [ ] §6.2 calls out `tests/test-no-prohibited-changes.sh` as needing whitelisting of the new schema field.
- [ ] §6.3 calls out the cache-vs-source dance (edit source at `D:/ai-developer-toolkit/plugins/ralph/`, invalidate `~/.claude/plugins/cache/...` before integration testing).
- [ ] §10 includes the verbatim handoff command pointed at the doc, runnable from the Ralph plugin source tree: `/plan-with-ralph --improve D:\harness-efforts\codexu\plans\ralph-overview-task-id.md` (Windows-style backslash path, matching repo convention).
- [ ] §3 includes a conditional §3.5 naming `skills/implement-with-ralph/SKILL.md` Phase 0 as the conditional 5th patch site (only required if §6.1 resolution A is selected), cross-referencing §6.1.
- [ ] §3.4 / §6 reference YAML parsing in a tool-agnostic way: "any shell-portable YAML front-matter parser (e.g., `yq` if added to plugin prerequisites; otherwise a `sed`/`awk` extractor over the front-matter block) — the future Ralph patch cycle decides which."
- [ ] §7 prepends a prerequisite note: the §6.1 metadata-format decision MUST be settled before any of the 4 skill patches land, because it determines the contract that `decompose-plan` and `plan-with-ralph` both write/read.
- [ ] `plans/ralph-pipeline-INDEX.md` audited; refreshed only if it references this plan's output filename, the schema field name `overviewTaskId`, or the plugin version pin AND any of those diverged. Otherwise unchanged.
- [ ] Typecheck passes (no-op for doc-only changes — confirm nothing else broke).

## Functional Requirements

- FR-1: Create the file `plans/ralph-overview-task-id.md` inside the worktree (relative path `plans/ralph-overview-task-id.md` from worktree root).
- FR-2: The doc MUST contain exactly the 10 top-level sections, in order, listed in the acceptance criteria.
- FR-3: §3 "Patches required" MUST contain subsections 3.1-3.4 covering each of the 4 target skills, AND a conditional §3.5 for `implement-with-ralph` Phase 0 (gated on §6.1 resolution A).
- FR-4: Every schema-update bullet in the doc MUST explicitly state the field is optional and MUST NOT be added to any `required` array.
- FR-5: §3.2 "decompose-plan" MUST list the source precedence as (1) explicit CLI flag, (2) parent plan metadata, (3) parent `prd.json` — in that order.
- FR-6: §3.1 "convert-to-ralph-prd" MUST describe the free-form-prompt + opt-in-config-driven-lookup behavior and MUST state the lookup never blocks PRD creation.
- FR-7: §6.1 MUST enumerate both valid resolutions to the `implement-with-ralph` Phase 0 first-line check.
- FR-8: §6.2 MUST name `tests/test-no-prohibited-changes.sh` as a guard requiring whitelisting.
- FR-9: §6.3 MUST name the cache-vs-source convention.
- FR-10: §10 MUST include the literal `/plan-with-ralph --improve` handoff command pointed at the doc, using Windows-style backslash paths (`D:\harness-efforts\codexu\plans\ralph-overview-task-id.md`).
- FR-11: §7 MUST prepend a prerequisite note that the §6.1 metadata-format decision blocks all four patches.
- FR-12: `plans/ralph-pipeline-INDEX.md` MUST be read at start of work; only modified if it references the doc filename, the field name, or the plugin version pin AND any of those diverged.

## Non-Goals

- The actual Ralph plugin patches (those land via a separate `/plan-with-ralph --improve` cycle in `D:/ai-developer-toolkit/plugins/ralph/`).
- Editing `plans/overview-data.js`.
- Updating codexu's `scripts/lib/sync-core.mjs` to consume `overviewTaskId` (separate codexu follow-up after Ralph patches ship).
- Backfilling existing PRDs / groups / brainstorms with the new field.
- Validating `overviewTaskId` values against any authority — Ralph stays agnostic.

## Technical Considerations

- This is a doc-only change. No code, no schema, no test scaffolding in this worktree.
- The doc is consumed by a different repo's `/plan-with-ralph --improve` cycle — it must be self-contained (no codexu-specific assumptions baked in unless explicitly opt-in).
- Reference files (read-only):
  - `plans/ralph-pipeline-10-ralph-handoff.md` (source plan)
  - `plans/ralph-pipeline-01-foundation.md` (consumer plan)
  - `plans/ralph-pipeline-INDEX.md` (DAG index — audit only)
  - `plans/overview-data.js` (consumer task ID source — referenced as opt-in, NOT hardcoded into Ralph)
  - `tools/overview-viewer/src/types.ts` (already reserves `matchSource: 'overviewTaskId'`)
  - `scripts/lib/sync-core.mjs` (consumer matching site)
  - `C:/Users/evmitran/.claude/plans/glistening-wondering-llama.md` (comprehensive plan)
  - `D:/ai-developer-toolkit/plugins/ralph/` (Ralph plugin source — referenced in §6.3 and §10)
  - `C:/Users/evmitran/.claude/plugins/cache/ai-developer-toolkit/ralph-orchestration/5.32.0/` (cached install — referenced in §2 and §6.3)

## Success Metrics

- A future `/plan-with-ralph --improve` cycle, run against the produced doc from the Ralph plugin source tree, can begin work without asking clarifying questions about field name, location, CLI shape, schema posture, or compatibility gotchas.
- Codexu's consumer (`scripts/lib/sync-core.mjs`) can later add tier-1 matching with no field-name surprises.

## Open Questions

- **[Deferred to the future Ralph patch cycle]** Between §6.1 resolution A (patch `implement-with-ralph` Phase 0) and resolution B (use non-front-matter metadata), which is preferred? Encoded as a deferred decision — the doc records both.
- **[Audit-driven]** Does `plans/ralph-pipeline-INDEX.md` currently reference the doc filename, the field name, or the plugin version pin? Resolved by reading the INDEX at start of work.
