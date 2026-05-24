# Research Brief — Plan 10 (Ralph handoff doc improve cycle)

## Verified versions
- Cached plugin (latest installed): **v5.32.0** at `C:/Users/evmitran/.claude/plugins/cache/ai-developer-toolkit/ralph-orchestration/5.32.0`
- Source plugin tree: **v5.35.0** at `D:/ai-developer-toolkit/plugins/ralph/.claude-plugin/plugin.json`
- Existing plan in codexu references v5.30.0 — outdated.

## Researcher Findings
- All 6 reference files exist in v5.32.0: 4 SKILL.md files, prd-schema.json, group-schema.json.
- **No `brainstorm-schema.json`** exists — brainstorm structure is documented inline in `skills/brainstorm-with-ralph/SKILL.md` Phase 3.
- `prd-schema.json` top-level props (no collision with `overviewTaskId`): `project, description, deslop, iterationEngine, codexReview, copilotReview, qualityGateFrequency, refactorInterval, permanentExpiryHours, jobDir, repoDir, group, branch, worktree, additionalDirs, planReviewContext, userStories`.
- `group-schema.json` top-level props (no collision): `name, description, createdAt, updatedAt, status, baseBranch, integrationBranch, prUrl, prCreatedAt, mergeStrategy, concurrency, lastPhase, lastPhaseTimestamp, jobs`.
- `convert-to-ralph-prd` currently accepts batch-mode flags (`--batch`, `--branch`, `--job-dir`, `--group-name`, `--group-dir`, `--start-point`, `--iteration-engine`). No `--overview-task-id` flag.
- `decompose-plan` writes `group.json` with `schemaVersion: 2` via `lib/atomic_update_group.sh`; propagates name/phase/dependsOn/status to children.
- `brainstorm-with-ralph` Phase 5 writes `selected-direction.md` as **pure markdown** today (no YAML front-matter) with required headings `## Direction`, `## Goal`, `## Scope`, `## Criteria`, `## Context`.
- `plan-with-ralph --from-brainstorm` currently copies `selected-direction.md` content verbatim into staging `feature-request.txt` (no structured metadata propagation). The generated plan template only mentions brainstorm source as a markdown comment.

## Architect Analysis
- Both schemas use `additionalProperties: true` → adding optional fields is non-breaking; existing PRDs validate fine. Runtime validation in `ralph.sh` is **hand-coded jq logic**, not external ajv — schemas are descriptive but should still be updated for documentation discoverability.
- The 4 patches are loosely coupled and can ship together or staged. Suggested order: `convert-to-ralph-prd` → `brainstorm-with-ralph` → `decompose-plan` → `plan-with-ralph` (plan-with-ralph reads from brainstorm, so brainstorm must land first).
- **YAML front-matter is a NEW contract** — the plugin doesn't parse YAML today. `plan-with-ralph --from-brainstorm` must add a parser (yq or jq filter) to extract `overviewTaskId` from `selected-direction.md`.
- Flag naming `--overview-task-id` matches kebab-case convention used throughout the plugin.
- Plugin re-install dance: after patches land in source, the cache at `~/.claude/plugins/cache/...` must be invalidated before testing integration.

## Codex Research
- Source tree at `D:/ai-developer-toolkit/plugins/ralph` is v5.35.0 — newer than cache v5.32.0.
- **Critical compatibility gotcha:** `implement-with-ralph` Phase 0 requires the first line of `--from-plan` to be exactly `# Implementation Plan:`. Adding YAML front-matter to generated `plan.md` would break this. Two options for the future patch cycle:
  1. Patch `implement-with-ralph` Phase 0 to tolerate leading YAML front-matter.
  2. Use a non-front-matter metadata format (e.g., a `<!-- ralph-meta {...} -->` HTML comment, or a structured section).
- **Test guard:** `tests/test-no-prohibited-changes.sh` in the Ralph source currently rejects edits to `prd-schema.json` and `group-schema.json` shape. The future patch cycle must update this guard.
- Source plugin's `decompose-plan` invokes `convert-to-ralph-prd --batch` to create each member PRD; the future patch should pass `--overview-task-id` through that batch hop rather than rewriting member PRDs after the fact.
- `lib/atomic_update_group.sh` is the existing safe path for mutating `group.json` — the patch should use it, not a freehand jq overwrite.
- **Acceptance-criterion typo:** the existing plan says "6 sections" but enumerates 7 (Context, Patches required, Back-compat, Out of scope, Acceptance criteria, Tests, How to pick this up). The improved plan should fix the count and the doc must include all 7.

## Copilot Research
- `tools/overview-viewer/src/types.ts` already reserves `matchSource?: 'overviewTaskId' | 'override' | 'slug-default'` — consumer surface anticipates the field.
- `scripts/lib/sync-core.mjs` `resolveTaskMatch()` currently only handles `ralphOverrides[slug]` then slug equality; no `overviewTaskId` consumption yet (matches Plan 01 commentary).
- The codexu-side consumer change (adding tier-1 matching once Ralph writes the field) is **NOT** part of this plan or the future Ralph patch cycle — it's a follow-up in codexu.
- Plan 01 explicitly defers `overviewTaskId` consumption to a later cycle.

## Consolidated File List

### To create (in this plan's worktree)
- `plans/ralph-overview-task-id.md` — the handoff doc (sole deliverable)

### To modify
- `plans/ralph-pipeline-INDEX.md` — refresh entry for Plan 10 to point at the produced doc filename if the index references it.

### Read for reference (this cycle)
- `plans/ralph-pipeline-10-ralph-handoff.md` — source of truth for scope and structure
- `plans/ralph-pipeline-01-foundation.md` — consumer plan that defers tier-1 matching to this doc
- `plans/ralph-pipeline-INDEX.md` — DAG index
- `plans/overview-data.js` — task ID source of truth (consumer)
- `tools/overview-viewer/src/types.ts` — already reserves `matchSource: 'overviewTaskId'`
- `scripts/lib/sync-core.mjs` — consumer matching site
- `C:/Users/evmitran/.claude/plans/glistening-wondering-llama.md` — comprehensive plan

### Read for reference (target plugin, by future Ralph patch cycle)
- `C:/Users/evmitran/.claude/plugins/cache/ai-developer-toolkit/ralph-orchestration/5.32.0/skills/convert-to-ralph-prd/SKILL.md`
- `…/skills/decompose-plan/SKILL.md`
- `…/skills/brainstorm-with-ralph/SKILL.md`
- `…/skills/plan-with-ralph/SKILL.md`
- `…/skills/implement-with-ralph/SKILL.md` (Phase 0 first-line check is the YAML front-matter blocker)
- `…/schemas/prd-schema.json`, `…/schemas/group-schema.json`
- Source tree: `D:/ai-developer-toolkit/plugins/ralph/` (v5.35.0 — the patch target, not the cache)
- `D:/ai-developer-toolkit/plugins/ralph/tests/test-no-prohibited-changes.sh`
- `D:/ai-developer-toolkit/plugins/ralph/lib/atomic_update_group.sh`
