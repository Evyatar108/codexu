# Stories Outline: Roadmap Naming Rebrand (overview → roadmap, surface-only)

*Preliminary decomposition from `/plan-with-ralph`. Feed to `/implement-with-ralph --from-plan` for PRD generation.*

> Cross-cutting constraints for ALL stories:
> - **Semantic rename, NOT find-replace.** Rename "overview" ONLY where it refers to THIS system.
>   Preserve: technical identifiers (`.ralph-overview/`, `overview.html`, `mcp__ralph-overview__*`,
>   `overview.*` tool names, `Overview*` types, `RALPH_OVERVIEW_PLUGIN_ROOT`, `bin/ralph-overview.mjs`,
>   the `ralph-overview` package name); the generic English word "overview" in unrelated docs; frozen
>   `.ralph/` history, `generated/**`, completed point-in-time `plans/**`, and historical CHANGELOG
>   entries.
> - Two-part vocabulary: **roadmap** = curated intent (`.ralph-overview/data.json`); **status /
>   pipeline-state** = watcher runtime (`generated/ralph-state.*`).
> - codexu root `CLAUDE.md` is gitignored — do NOT `git add CLAUDE.md`; fork guidance goes in `AGENTS.md`.
> - Submodule edits = two commits (submodule first, then codexu pointer bump). SERIALIZE the toolkit
>   ship with the sibling task `ralph-overview-create-task-skill`.

## US-001: Define-first glossary in codexu `AGENTS.md`
**Description:** As a new contributor or fresh agent, I want a one-line definition + glossary at the
top of the bookkeeper manual so I can state in one sentence what the roadmap system is and is not.
**Acceptance Criteria:**
- [ ] A one-line definition/tagline, a two-part glossary (roadmap = curated intent in `data.json`;
      status/pipeline-state = watcher runtime in `generated/ralph-state.*`), and a "what it is NOT"
      box (NOT an exec summary / NOT an architecture diagram / NOT a one-off status report) are added
      at the TOP of the `# Codexu — Bookkeeper / Scrum-Master Workspace` section (≈ line 154), with a
      one-line pointer near the existing "Agent-readable Ralph pipeline state is emitted as…" paragraph.
- [ ] Lands as its OWN commit, ordered BEFORE US-002's rename edits.
- [ ] No rename of any technical identifier or generic-word "overview" in this story.
**Dependencies:** None
**Estimated complexity:** small

## US-002: Living-doc prose rename + role wording (codexu)
**Description:** As a reader of the canonical docs, I want system references to read "roadmap" so the
new name appears everywhere that matters.
**Acceptance Criteria:**
- [ ] System references renamed to "roadmap" in codexu `AGENTS.md` manual body (INCLUDING the
      `## Overview data` heading → e.g. "Roadmap data"), `README.md`, `plans/codexu-roadmap.md`,
      `docs/fork-roadmap.md`, `docs/submodule-rollback.md`.
- [ ] Role described as "roadmap bookkeeper" in prose while the literal role id `overview-bookkeeper`
      is preserved (pinned on first use). No edit to live `.crews/` runtime state.
- [ ] grep confirms NO technical identifier was renamed and NO new `.ralph-roadmap` / `ralph-roadmap`
      / `mcp__ralph-roadmap` / `bin/ralph-roadmap` token was introduced.
**Dependencies:** US-001
**Estimated complexity:** medium

## US-003: Additive `roadmap*` npm aliases (codexu `package.json`)
**Description:** As a developer, I want `pnpm roadmap*` aliases so the dev ergonomics match the new name.
**Acceptance Criteria:**
- [ ] `roadmap`, `roadmap:dev`, `roadmap:build`, `roadmap:build:preview` added, delegating to the
      SAME `node bin/ralph-overview.mjs <cmd>` commands as the existing `overview*` keys.
- [ ] All existing `overview*` keys retained; `sync-ralph-state` unchanged (NOT aliased to
      `sync-roadmap-*` — it syncs status/pipeline-state, not roadmap).
- [ ] `pnpm overview`, `pnpm overview:build`, `pnpm sync-ralph-state`, `pnpm roadmap`,
      `pnpm roadmap:build` all run.
**Dependencies:** None
**Estimated complexity:** small

## US-004 (OPTIONAL / Q4): env-var dual-read via plugin template + codexu wrapper regen
**Description:** As an operator, I optionally want `RALPH_ROADMAP_PLUGIN_ROOT` to work as an alias of
`RALPH_OVERVIEW_PLUGIN_ROOT` without breaking existing installs.
**Acceptance Criteria:**
- [ ] `ai-developer-toolkit/plugins/ralph-overview/templates/consumer-ralph-overview.mjs` dual-reads
      `RALPH_ROADMAP_PLUGIN_ROOT || RALPH_OVERVIEW_PLUGIN_ROOT`, preserving explicit-fail behavior.
- [ ] `scripts/lib/__tests__/consumer-ralph-overview.test.mjs` updated and passing.
- [ ] codexu `bin/ralph-overview.mjs` REGENERATED from the template (not hand-edited); both env vars
      resolve the plugin root.
- [ ] Typecheck/tests pass.
**Dependencies:** US-005 (toolkit worktree); gate on Q4
**Estimated complexity:** small

## US-005: Define-first viewer block + viewer visible-text/a11y rename + plugin-doc prose (toolkit)
**Description:** As a viewer user, I want the board's visible title/header/labels to read "roadmap".
**Acceptance Criteria:**
- [ ] Define-first block added to `tools/overview-viewer/AGENTS.md` FIRST (separate ordered step).
- [ ] Visible text renamed (FILENAME `overview.html` unchanged): `overview.html` `<title>` + `Loading
      overview data…`; `App.tsx:154` header; `PipelineOverview.tsx:26,35` aria-label;
      `TopLevelSurfaces.tsx:56,60,62,64,108-109` labels.
- [ ] Asserting viewer tests updated in the same change: `devServerHtml.test.ts:14,17`,
      `pipelineOverview.test.tsx:52`; the viewer test suite passes.
- [ ] System references renamed in plugin `AGENTS.md` + living `docs/**` (historical migration guides
      preserved).
- [ ] Typecheck passes for touched TS.
**Dependencies:** None (separate submodule worktree)
**Estimated complexity:** medium

## US-006 (OPTIONAL / Q4): additive technical aliases (toolkit)
**Description:** As an operator, I optionally want non-destructive `roadmap.*` / `Roadmap*` aliases.
**Acceptance Criteria:**
- [ ] LOW-risk: `export type Roadmap* = Overview*` aliases added in `types.ts` (old names remain primary).
- [ ] HIGHER-risk (recommend DEFER; include only if Q4 approves): dual-register `roadmap.*` across ALL
      11 MCP registrations (`server.ts` + `tools/{init,validate-data,parallel-ready-tasks,
      expand-task-context,unblock-candidates,data-write}.ts`) + `stdio-tools-list` test + consumer
      skills/docs; and `scripts/lib/data-store.mjs` data-dir fallback — ALL-OR-NOTHING.
- [ ] All 11 `overview.*` tools still resolve (no tool-list parity break); typecheck/tests pass.
**Dependencies:** US-005; gate on Q4
**Estimated complexity:** medium (large if MCP dual-register included)

## US-007: Cross-repo ship — version bump + CHANGELOG + submodule pointer + table sync
**Description:** As a maintainer, I want the plugin version, marketplace indexes, submodule pointer,
and the codexu active-plugin-versions table to move in lockstep so CI stays green.
**Acceptance Criteria:**
- [ ] Plugin version bumped consistently across `.claude-plugin/plugin.json`, `.codex-plugin/plugin.json`,
      `.github/plugin/plugin.json`, and the 3 marketplace indexes (`.claude-plugin/marketplace.json`,
      `.github/plugin/marketplace.json`, `.agents/plugins/marketplace.json`); a new CHANGELOG entry
      added (historical entries untouched).
- [ ] Toolkit commit lands FIRST; ONE codexu commit records the submodule pointer bump AND the
      `AGENTS.md` active-plugin-versions table update, all equal to the bumped version.
- [ ] No half-renamed intermediate state; serialized at ship with `ralph-overview-create-task-skill`.
**Dependencies:** codexu-surface (US-001/002/003), toolkit-surface (US-005/006/004)
**Estimated complexity:** medium
