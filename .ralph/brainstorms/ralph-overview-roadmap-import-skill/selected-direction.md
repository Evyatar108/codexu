---
overviewTaskId: ralph-overview-roadmap-import-skill
---

## Direction
D-001 — Skill-only single-format checkbox/heading importer reusing the create-task createOnly path. A new `/import-roadmap` ralph-overview skill bulk-files tracked tasks from ONE roadmap format, mirroring `/create-task`'s no-clobber write path, with a mandatory edit gate and fail-soft idempotent apply.

## Goal
A reusable `ai-developer-toolkit/plugins/ralph-overview/skills/import-roadmap/` skill (+ generated Copilot mirror) that reads a consumer ROADMAP.md, parses `##` headings + `-`/`- [ ]` bullets into canonical filed tasks, writes a dry-run editable proposed-tasks.json, dedups ids vs hot+cold shards, and on confirm applies each via overview.upsert_task createOnly (or `data-edit upsert-task --create-only` fallback) fail-soft — created/skipped/collided/invalid manifest, deterministic kebab so re-run is a no-op.

## Scope
### In Scope
- ONE input format: ROADMAP.md `##` headings + `-`/`- [ ]` bullets (heading => scope, bullet => task).
- Reuse createOnly core only (no new mutation verb); per-id atomic write, skip-existing + continue.
- Dedup proposed kebab ids vs hot (.ralph-overview/data.json) + cold (.ralph-overview/data.archived.json).
- Editable proposed-tasks.json preview; confirm-the-set before any write; operator fills scope/prompt seeds.
- Canonical shape: id, scope, lifecycle:tracked, status:todo, lastTouchedAt, initialStage, one cmd-warn card, command{name,descriptionHtml,warnings:[],prompts}.
- Generate Copilot mirror; update plugin AGENTS.md/CHANGELOG; version bump + 3 marketplace indexes.
### Out of Scope
- Markdown tables, gh issues (D-005), and a dedicated import-roadmap CLI+lib (D-004) — deferred.
- Auto-inferring prompts seeds beyond an empty/templated brainstorm seed.
- Any new batch transaction in data-edit-core.

## Criteria
- Importing a 10-item ROADMAP.md previews 10 canonical tasks; operator edits/prunes; confirmed set is created via createOnly with zero hand-edits to data.json.
- Re-running the same import is a no-op (all skipped as existing); collisions reported, never abort.
- ids validate ^[A-Za-z0-9_./-]+$; no clobber of any hot/cold task; data.json untouched on cancel.

## Context
3-lens full mode. Verified: no batch verb (runVerb = one task/lock/atomicWrite) => apply is N fail-soft inserts; mid-batch throw must not abort. Kebab heading => inert stub without curated scope/prompts, so the editable preview gate (D-002) is mandatory. Defer D-004 (CLI) and D-005 (gh/tables). Open: justify SKILL vs thin /create-task loop if roadmaps import once.