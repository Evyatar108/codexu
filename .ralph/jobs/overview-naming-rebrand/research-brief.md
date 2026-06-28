# Research Brief: overview-naming-rebrand (D-001 "roadmap")

Seeded from brainstorm: `.ralph/brainstorms/overview-naming-rebrand/selected-direction.md`.
Direction D-001: adopt **"roadmap"** as the canonical HUMAN-FACING name; KEEP the technical
identity (plugin name, `mcp__ralph-overview__*` namespace, `.ralph-overview/` data dir,
`RALPH_OVERVIEW_PLUGIN_ROOT`, `Overview*` TS types). Scope = surface-only + optional additive
aliases; NOT the destructive full rename.

## Researcher Findings (codebase-grounded, primary checkout)

### 1. Human-facing prose/doc (HARD rename `overview`→`roadmap` target)
Counts are case-insensitive "overview" matches; EXCLUDE frozen `.ralph/` history and
`generated/`.

| Surface | Matches | Notes |
|---|---:|---|
| `AGENTS.md` (root, codexu) | 76 | top-of-file + bookkeeper manual |
| `README.md` (root) | 5 | |
| `plans/**` (28 files) | 866 | heaviest doc bucket |
| `ai-developer-toolkit/plugins/ralph-overview/docs/**` (6 files) | 221 | |
| `ai-developer-toolkit/plugins/ralph-overview/*` (4 top files) | 214 | CHANGELOG.md=104, plugin AGENTS.md=61 |
| `.../ralph-overview/tools/overview-viewer/**` (2 files) | 55 | |

Heaviest individual files: `ralph-overview/CHANGELOG.md`=104, `plans/overview-vite-react.md`=77,
`plans/codexu-roadmap.md`=75, `ralph-overview/docs/migration-v2.4-to-v2.5.md`=66,
`plans/ralph-pipeline-12-package-as-plugin.md`=62, `ralph-overview/AGENTS.md`=61,
`plans/ralph-pipeline-09-mcp.md`=61.

**KEEP-technical-even-in-prose (do NOT rename inside prose):** `.ralph-overview/`,
`overview.html`, `mcp__ralph-overview__*`, `overview.parallel_ready_tasks` (and the other
`overview.*` MCP tool names), `OverviewData`/`Overview*` type names, `RALPH_OVERVIEW_PLUGIN_ROOT`,
`bin/ralph-overview.mjs`, the `ralph-overview` plugin/package name, `ralph-overview@ai-developer-toolkit`.

### 2. Role label `overview-bookkeeper` (~22 doc refs)
- `AGENTS.md` lines 34+ (6 refs)
- `plans/codexu-roadmap.md` (6 refs)
- `plans/crews-review-required-mid-turn-brainstorm.md` (7 refs)
- `plans/crews-review-mid-turn-v160-plan.md` (1 ref)
- `plans/in-flight-2026-05-26.md` (2 refs)
- Live `.crews/` runtime state also contains the role string — **do NOT edit runtime state**
  (a crew rename is a separate runtime migration, out of scope; see Open Questions Q2).

### 3. Viewer title/header + visible UI labels
- `ai-developer-toolkit/plugins/ralph-overview/tools/overview-viewer/overview.html:6` →
  `<title>Codexu Overview</title>`
- `.../overview-viewer/src/App.tsx:154` → header text `Ralph pipeline overview`
- `.../overview-viewer/src/components/TopLevelSurfaces.tsx:108-109` → `Keyboard shortcuts` /
  `Keyboard shortcuts for overview navigation`
- NOTE: the viewer FILE name `overview.html` is the bookmarked artifact (technical identity) —
  rename the visible `<title>`/header TEXT, not the filename.

### 4. npm scripts (root `package.json`) — get ADDITIVE `roadmap*` aliases, NOT renamed
- `overview` → `node bin/ralph-overview.mjs dev --repo .`
- `overview:dev` → `node bin/ralph-overview.mjs dev`
- `overview:build` → `node bin/ralph-overview.mjs build --repo .`
- `overview:build:preview` → `cross-env OVERVIEW_BUILD_SAFE_NAME=1 node bin/ralph-overview.mjs build`
- `sync-ralph-state` → `node bin/ralph-overview.mjs sync --repo .`
- `sync-ralph-state:watch` → `node bin/ralph-overview.mjs watch --repo .`
- Plugin `ralph-overview/package.json`: NO `overview*`/`sync-ralph-state` scripts.

### 5. Technical-identity surfaces to KEEP (optional additive-alias only)
- `Overview*` TS types in `.../overview-viewer/src/types.ts`: `OverviewWarning`, `OverviewCommand`,
  `OverviewTask`, `OverviewRalphState`, `OverviewUiOverrides`, `OverviewData` (6 in the viewer;
  brainstorm's ~22 count spans MCP + scripts copies of these shapes — treat the type family, not
  the literal 22, as the keep-set).
- 11 MCP tools in `.../overview-mcp/src/server.ts` + `.../overview-mcp/src/tools/data-write.ts`:
  `overview.init`, `overview.validate_data`, `overview.parallel_ready_tasks`,
  `overview.expand_task_context`, `overview.watcher_status`, `overview.unblock_candidates`,
  `overview.upsert_task`, `overview.mark_shipped`, `overview.set_lifecycle`,
  `overview.add_kanban_card`, `overview.set_prompts`.
- `.ralph-overview/` references: ~445 in plugin files (excl. generated/node_modules/.git/.xwin-cache).
- `RALPH_OVERVIEW_PLUGIN_ROOT`: ~104 references in plugin files.
- Wrapper: `bin/ralph-overview.mjs` (codexu root) + `.../ralph-overview/bin/ralph-overview.mjs`.

## Architect Analysis (contracts + aliasing + ordering)

### Cross-machine contracts D-001 must NOT break
- MCP server: `.../overview-mcp/src/server.ts:13,25`; 11-tool registrations in
  `.../overview-mcp/src/tools/data-write.ts:123-144`.
- MCP consumers: skills `work-on/SKILL.md`, `triage/SKILL.md`, `blocker-report/SKILL.md`,
  `expand-task/SKILL.md`, `overview-init/SKILL.md`; plus `AGENTS.md` agent prompts and plugin
  `ralph-overview/AGENTS.md:105-109,150,176-180,193,202,216`.
- Plugin manifests (name `ralph-overview`): `.claude-plugin/plugin.json`, `.codex-plugin/plugin.json`,
  `.github/plugin/plugin.json`. Marketplace indexes: `ai-developer-toolkit/.claude-plugin/marketplace.json`,
  `.../.github/plugin/marketplace.json`, `.../.agents/plugins/marketplace.json`.
- `.ralph-overview/` readers: `scripts/lib/data-store.mjs:25,45,61,189,268,295`,
  `scripts/lib/sync-core.mjs` (loadOverviewData hot/cold), viewer
  `tools/overview-viewer/vite.config.ts:96,192,301,349-352`.
- Wrapper probes + env: `bin/ralph-overview.mjs:24,30,131-147,186,231-238,289,294`.

### Additive-alias feasibility (optional, per Open Question Q4)
| Alias | Edit site | Risk |
|---|---|---|
| Dual-register `roadmap.*` MCP tools | `overview-mcp/src/tools/data-write.ts:123-144` (+ dispatched tool files) | medium — `stdio-tools-list.test.ts` + all skill prompts must stay in sync |
| `export type Roadmap* = Overview*` | `overview-viewer/src/types.ts:43,153,289` | low — additive if old names kept |
| Dual-read `RALPH_ROADMAP_PLUGIN_ROOT \|\| RALPH_OVERVIEW_PLUGIN_ROOT` | `bin/ralph-overview.mjs:131-147,231-238,289` | low — keep explicit-fail behavior |
| `.ralph-overview/` data-dir fallback | `data-store.mjs:25,45,189,268,295` + `sync-core.mjs` | medium — touches hot/cold split + reader consistency |

### Safe ordering
- **Land first (contract-independent):** define-first glossary in AGENTS.md, prose/docs/role wording,
  npm script aliases, viewer text/header labels.
- **Defer/optional (touch contracts):** dual MCP aliases, type aliases, dual env-var read, data-dir
  fallback.

### Define-first placement
- codexu `AGENTS.md`: architect suggested the very top (before `## Fork context`). **Refinement
  (planner decision):** the very top is HAPPY-fork framing; the roadmap system is documented in the
  appended "# Codexu — Bookkeeper / Scrum-Master Workspace" manual. Place the define-first block
  (one-line definition + glossary + "what it is NOT" box) at the TOP of that manual section, plus a
  one-line pointer near the existing "Agent-readable Ralph pipeline state is emitted as…" paragraph
  in the fork-context area. This keeps the glossary where readers of THIS system land, without
  inserting roadmap copy above unrelated happy-fork context.
- Viewer: `overview-viewer/AGENTS.md:1-18` opening block + the visible `App.tsx:154` header.

### Cross-repo split (TWO PRs / commits)
- **codexu-owned:** `AGENTS.md`, `bin/ralph-overview.mjs`, `package.json`, `plans/**`, `docs/**`,
  `README.md`, root `tools/**`.
- **ai-developer-toolkit submodule:** `plugins/ralph-overview/**` (plugin docs, viewer, MCP, skills,
  plugin AGENTS, manifests), `ai-developer-toolkit/.claude-plugin/marketplace.json`,
  `.../.github/plugin/marketplace.json`, `.../.agents/plugins/marketplace.json`.
- **Ship-time serialization:** MUST serialize with sibling task `ralph-overview-create-task-skill`
  (same plugin → both bump `plugin.json`/`CHANGELOG`/`AGENTS`/skills). Submodule edits = two commits
  (submodule first, then codexu pointer bump).

### Verification plan
- `rg -n "overview" <targets>` vs `rg -n "roadmap" <targets>` before/after.
- List MCP tools post-change; confirm all 11 `overview.*` still resolve; run one
  `overview.parallel_ready_tasks`.
- Smoke: `pnpm overview`, `pnpm overview:build`, `pnpm sync-ralph-state`.
- Wrapper: `bin/ralph-overview.mjs` still resolves plugin root; `RALPH_OVERVIEW_PLUGIN_ROOT` works;
  viewer still loads `/data.json` + `/ralph-state.json`.

## Codex Research
Failed: timeout (codex-exec exit 124 at ~5 min, no output).

## Copilot Research
Did not complete: from the worktree the `ai-developer-toolkit` submodule is uninitialized, so
copilot-exec fell back to slow GitHub fetches and produced only narration (~334 bytes) after ~26
min before being stopped. Non-blocking — the two Explore agents covered the real plugin source from
the primary checkout.

## Consolidated File List

### Files to modify — codexu repo (PR #1)
- `AGENTS.md` (define-first block + prose rename + role refs)
- `README.md` (prose)
- `plans/**/*.md` (prose, 28 files — heaviest at codexu-roadmap.md, overview-vite-react.md, ralph-pipeline-*.md)
- `docs/**/*.md` (prose, if any "overview" prose present)
- `package.json` (additive `roadmap*` script aliases)
- `bin/ralph-overview.mjs` (OPTIONAL dual-read env var — Q4)

### Files to modify — ai-developer-toolkit submodule (PR #2, serialized w/ sibling task)
- `plugins/ralph-overview/AGENTS.md`, `docs/**/*.md`, `CHANGELOG.md` (prose)
- `plugins/ralph-overview/tools/overview-viewer/overview.html` (visible `<title>` text only)
- `.../overview-viewer/src/App.tsx:154` (header text), `.../components/TopLevelSurfaces.tsx:108-109` (labels)
- `.../overview-viewer/AGENTS.md` (define-first viewer block)
- OPTIONAL additive aliases (Q4): `.../overview-mcp/src/tools/data-write.ts`, `.../overview-viewer/src/types.ts`, `.../scripts/lib/data-store.mjs`
- `plugins/ralph-overview/.claude-plugin/plugin.json` (version bump), `CHANGELOG.md`

### KEEP unchanged (technical identity / contracts)
- MCP namespace `mcp__ralph-overview__*` + the 11 `overview.*` tool names (primary)
- `.ralph-overview/` data dir + `overview.html` filename
- `RALPH_OVERVIEW_PLUGIN_ROOT`, `bin/ralph-overview.mjs` probe paths, plugin/marketplace package name
- `Overview*` TS type names (primary)
- Live `.crews/` runtime role state
