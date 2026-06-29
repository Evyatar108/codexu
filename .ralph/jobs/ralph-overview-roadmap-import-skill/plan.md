# Plan — `ralph-overview-roadmap-import-skill`

> Worktree: `ai-developer-toolkit/.worktrees/ralph-overview-roadmap-import-skill` (submodule), pointer-bumped in codexu primary at ship.
> Target plugin: `ai-developer-toolkit/plugins/ralph-overview/`. Reusable marketplace skill, not codexu-specific.
> From brainstorm `6c335483` (`.ralph/brainstorms/ralph-overview-roadmap-import-skill/`), direction **D-001 absorbing D-002 + D-003**.

## Goal

Add a new guided skill `/import-roadmap` to the `ralph-overview` plugin that bulk-files
tracked tasks from ONE roadmap format (`ROADMAP.md`: `##` headings + `-`/`- [ ]` bullets)
into the consumer's `.ralph-overview/data.json` **without hand-editing the data file**. It
reuses the existing `createOnly` no-clobber write path (no new mutation verb), gates every
write behind an editable `proposed-tasks.json` curate step, dedups against the hot + cold
shards, and applies fail-soft (skip-existing, continue, manifest) so a re-run is a no-op.

## Why a SKILL, not a thin `/create-task` loop (open question from brainstorm)

The brainstorm flagged: "if roadmaps import once, does this justify a SKILL vs a thin
/create-task loop?" Resolution — **a SKILL is justified** because the value is not the
write (createOnly already exists) but four behaviors a one-by-one loop cannot give:
1. **Bulk parse + canonical kebab derivation** from `##`/bullet structure in one pass.
2. **Cross-shard dedup precheck** against hot + cold so re-runs/partial imports are no-ops.
3. **A single editable proposed-tasks.json curate gate** — operator prunes/edits 10 stubs
   once, instead of 10 separate confirm prompts, and seeds the scope/prompts that a kebab
   heading cannot derive.
4. **Fail-soft manifest** (created/skipped/collided/invalid) so 1-of-N failures never block
   retry. This is a thin marketplace skill (no new core code), so cost is low and it
   complements — never replaces — `/create-task`. Defer the heavier CLI/lib (D-004) and
   tables/gh (D-005).

## Scope

### In scope
- ONE input: `ROADMAP.md` with `##` headings (→ `scope`) and `-`/`- [ ]` bullets (→ task).
- New skill `skills/import-roadmap/SKILL.md` + auto-generated Copilot mirror.
- Reuse `overview.upsert_task createOnly:true` (MCP) / `data-edit upsert-task --create-only`
  (dispatcher fallback). N atomic single-task writes; NO new batch verb.
- Editable `proposed-tasks.json` dry-run; dedup vs `data.json` (hot) + `data.archived.json`
  (cold); fail-soft apply with manifest.
- plugin.json bump + CHANGELOG prepend + 3 marketplace indexes + codexu AGENTS table.

### Out of scope (deferred)
- Markdown tables, gh issues (D-005); dedicated CLI + `scripts/lib/import-roadmap.mjs` (D-004);
  any new batch transaction in `data-edit-core.mjs`; auto-inferring prompt seeds beyond a
  templated empty brainstorm seed.

## Relevant files (read-only reference)
- Reference skill: `ai-developer-toolkit/plugins/ralph-overview/skills/create-task/SKILL.md`
  (canonical task shape, precheck, dry-run, createOnly apply, plugin-root resolution).
- Copilot mirror: `.copilot-plugin/copilot-skills/create-task/SKILL.md` (generated).
- Generator: `scripts/generate-copilot-artifacts.mjs` (auto-discovers `skills/*`; FORBIDDEN
  tokens: `Skill(`, `Agent(`, `BashOutput`, `run_in_background`, `Enter/ExitPlanMode`).
- Write surface: `scripts/data-edit.mjs` (`upsert-task <id> --json <f> --create-only`),
  `scripts/lib/data-edit-core.mjs` (runVerb = one task/lock; cold-shard collisions caught).
- Shards: `.ralph-overview/data.json` (hot) + `.ralph-overview/data.archived.json` (cold).
- Existing-id taxonomy source: `.ralph-overview/generated/summary-projection.json`.
- Version: `.claude-plugin/plugin.json`; indexes `.claude-plugin/marketplace.json`,
  `.github/plugin/marketplace.json`, `.agents/plugins/marketplace.json`; `CHANGELOG.md`.
- codexu `AGENTS.md` active-plugin-versions table (line ~25).
- Plugin `AGENTS.md` (architecture invariants 4/5/6, copilot-mirror regen rule).

### Files to change (impl phase)
- ADD `skills/import-roadmap/SKILL.md`; ADD generated `.copilot-plugin/copilot-skills/import-roadmap/SKILL.md`.
- BUMP `.claude-plugin/plugin.json` version; prepend `CHANGELOG.md`; bump 3 marketplace versions.
- EDIT codexu `AGENTS.md` table; EDIT plugin `AGENTS.md` MCP/skill-count prose to list 6 skills.

## Skill contract (5 phases — no Skill()/Agent() tokens; agent parses inline)
1. **Parse** `ROADMAP.md`: `##`→scope kebab; `-`/`- [ ]` bullet→task; id = `<scope>-<bullet-kebab>`
   matching `^[A-Za-z0-9_./-]+$`; descriptionHtml = bullet text; one `cmd-warn` card; `initialStage:"brainstorming"` + templated empty brainstorm seed.
2. **Dedup** each id vs summary-projection (hot+cold), degrade to reading both shards.
3. **Preview** editable `proposed-tasks.json` (status: new/existing); operator prunes/edits/seeds.
4. **Confirm-the-set** gate; cancel = no write.
5. **Apply** fail-soft: createOnly per task, skip existing, continue on reject, print
   created/skipped/collided/invalid manifest. Re-run = no-op. No git ops.

## Acceptance criteria
- 10-item ROADMAP.md previews 10 canonical tasks; confirmed set created via createOnly, zero hand-edits to data.json.
- Re-run = all skipped; collisions reported never aborting; ids validate; cancel leaves data.json untouched.
- Copilot mirror regenerated (no FORBIDDEN tokens); plugin.json + 3 indexes + CHANGELOG + AGENTS tables updated.

## Common mistakes
- Do NOT add a batch verb. Do NOT git add CLAUDE.md. Submodule = two commits. Run `generate-copilot-artifacts.mjs --write` after editing SKILL.md. Mirror count check pins 6 skills.
