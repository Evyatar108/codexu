---
overviewTaskId: overview-naming-rebrand
---

## Direction
D-001 — "Roadmap" canonical name + define-first + surface/additive scope (keep technical identity).
Adopt **"roadmap"** as the canonical human-facing name for the system, lead with a one-line
definition + glossary, rename only the human-facing surfaces and add non-destructive technical
aliases, and KEEP the `ralph-overview` plugin/MCP/data-dir/types technical identity — delivering the
operator's "a name that tells you what it is" goal at ~200–240 effort units instead of the ~575-unit
full rename, with zero broken contracts.

## Goal
A new contributor (or a fresh agent) can state in one sentence what the system is, and reads/hears
the word **"roadmap"** in every human-facing surface (docs, the viewer header, the bookkeeper role,
operator speech), while every machine contract (`ralph-overview` plugin/npm/marketplace name,
`mcp__ralph-overview__*` tool namespace, the `.ralph-overview/` data dir, the `Overview*` code types,
the `bin/ralph-overview.mjs` wrapper + `RALPH_OVERVIEW_PLUGIN_ROOT` env) keeps working unchanged
(optionally augmented with additive aliases). The repo ships **one coordinated PR per repo** (codexu +
ai-developer-toolkit) with no half-renamed state and no cross-machine breakage.

## Scope

### In Scope
- **Canonical name decision: "roadmap"** (umbrella concept = "Ralph Roadmap"; the merged viewer
  surface = "the roadmap" / "roadmap board"). Adopt the **two-part glossary vocabulary**: *roadmap* =
  operator-authored intent (`.ralph-overview/data.json`); *status / pipeline-state* = watcher-derived
  runtime (`.ralph-overview/generated/ralph-state.{js,json}`).
- **Define-first (ship before any rename):** a one-line system definition/tagline at the top of
  `AGENTS.md` + the viewer header, a glossary block mapping legacy "overview" → the concept, and a
  "what it is / what it is NOT" box (NOT an exec summary, NOT an arch diagram, NOT a status report).
- **Human-facing rename (SURFACE-ONLY, ~200u):**
  - Prose/doc mentions (~1,880 hand edits) across `AGENTS.md`, `plans/**`, `docs/**`, `README.md`,
    `ai-developer-toolkit/plugins/ralph-overview/**/*.md`, `ai-developer-toolkit/CHANGELOG.md`.
  - Role label `overview-bookkeeper` → `roadmap-bookkeeper` (~95 refs) — **pending Q2 confirmation**
    (it appears in live `.crews/` state; may be deferred to avoid a runtime-state migration).
  - Viewer `<title>`/header + visible labels in `tools/overview-viewer/src/`.
  - Additive npm script aliases (`pnpm roadmap`, `roadmap:build`, …) alongside the existing
    `overview*` / `sync-ralph-state` keys in `package.json` (additive, ~2u).
- **Non-destructive technical aliases (ADDITIVE-ALIAS, ~40u) — optional per Q4:**
  - Dual-register the 11 MCP tools (new `roadmap.*` names alongside `overview.*`) (~16u).
  - `export type RoadmapTask = OverviewTask` style aliases for the 22 `Overview*` types (~11u).
  - Dual-read `RALPH_ROADMAP_PLUGIN_ROOT` || `RALPH_OVERVIEW_PLUGIN_ROOT` (~5u).
  - `.ralph-overview/` data-dir fallback resolution (read new dir if present, else old) (~5u).

### Out of Scope
- **Destructive FULL rename (option 1, ~575u)** — explicitly rejected. Do NOT rename the
  `ralph-overview` / `@gim-home/ralph-overview` plugin/npm/marketplace package, the
  `mcp__ralph-overview__*` namespace as primary, the `.ralph-overview/` data directory on disk, or the
  22 `Overview*` types as a hard rename (drop-old). Those carry ~107u and ~all the cross-machine risk.
- **Crew name `ralph-pipeline`** — out of scope per invariant #1. (Also why "pipeline" was rejected as
  the name: it collides with the crew.)
- **The ~40,669 frozen historical `.ralph/` occurrences and the ~1,032 auto-regenerated
  `generated/**` + `tasks/INDEX.md` occurrences** — not hand-edited; the watcher rewrites generated
  files on next `sync-ralph-state`.
- **Renaming the `bin/ralph-overview.mjs` wrapper file + its install-path probes** — defer; it is
  keyed to the plugin package name, which stays.

## Criteria
- [ ] `selected-direction.md` names exactly one canonical word ("roadmap") and one scope (surface-only
      + additive-alias, NOT full); the plan inherits both.
- [ ] A one-line definition + glossary + "what it is NOT" box exists at the top of `AGENTS.md` and the
      viewer header before any rename edit lands.
- [ ] Every `mcp__ralph-overview__*` tool still resolves and every consumer skill (`/work-on`,
      `/triage`, `/blocker-report`) + agent prompt still works after the change (no machine contract
      broken). Verify by listing MCP tools post-change and running one `overview.parallel_ready_tasks`
      call.
- [ ] `pnpm overview` / `pnpm overview:build` / `pnpm sync-ralph-state` still work (old script keys
      retained); any new `roadmap*` keys are additive.
- [ ] `bin/ralph-overview.mjs` and `RALPH_OVERVIEW_PLUGIN_ROOT` resolve on a fresh clone unchanged
      (or dual-read if aliased).
- [ ] The change ships as ONE PR per repo (codexu + ai-developer-toolkit) with no half-renamed state.
- [ ] The "what it is NOT" box + glossary let a fresh reader state what the system is/is-not without
      seeing the old wording (the cheapest-validation check).

## Context

### Why D-001 (synthesis highlights)
Four of five lenses independently concluded a destructive full rename is net-negative. The system is
**irreducibly two things fused** (operator-authored intent in `data.json` + watcher-derived runtime in
`ralph-state`), so no single word fully describes it — every candidate cues one half and mis-cues the
other, leaving the same "it's actually two layers" follow-up sentence the rename was meant to kill.
The grounded scale: ~67k raw "overview" tokens, of which **~60k live in immutable `.ralph/` history**
no rename can reach, so even a "full" rename produces a *permanent dual-vocabulary repo*. The
expensive surfaces (the `mcp__ralph-overview__*` namespace, the `ralph-overview` plugin package, the
`.ralph-overview/` data dir, the wrapper + env var) are **published/cross-machine contracts the repo
cannot atomically migrate** — `enabledPlugins["ralph-overview@ai-developer-toolkit"]` lives in
per-machine `~/.copilot|~/.claude/settings.json`, so a hard rename silently breaks the plugin (tools
vanish, no error) on every install until manually re-enabled. D-001 gives the operator the new word
where it matters (human-facing + a crisp definition) while protecting against ~575 units of thankless,
risky churn.

### Surface inventory (grep-verified 2026-06-27; full table in `brainstorm-synthesis.md`)
| Bucket | Actionable count | Effort FULL | Effort SURFACE-ONLY |
|---|---:|---:|---:|
| 1 Plugin package & dir name | 326 files under `plugins/ralph-overview/`; 3 pkg names; 3 marketplace indexes | 46 | 0 |
| 2 MCP tool names (11) | `mcp__ralph-overview__*`, `overview.*` | 88 (11×8) | 0 |
| 3 TS/JS types (22 distinct, ~788 uses) | `OverviewData` 382, `OverviewTask` 142, `OverviewRalphState` 83, `OverviewConfig` 70 | 110 (22×5) | 0 |
| 4 Data/file paths | `.ralph-overview` ~1,024 + `overview.html` ~160 ≈ 1,184 refs + the dir | 119 | 0 |
| 5 npm scripts (6) | `overview*`, `sync-ralph-state` via `bin/ralph-overview.mjs` | 2 | 2 |
| 6 Role `overview-bookkeeper` (~95) | `AGENTS.md`, `plans/codexu-roadmap.md`, `.crews/` state | 9.5 | 9.5 |
| 7 Prose/doc mentions (~1,880) | `AGENTS.md` 80, `plans/**` 941, plugin `**/*.md` 759 | 188 | 188 |
| 8 External/contract (HIGH RISK) | user settings, wrapper (38 refs), `RALPH_OVERVIEW_PLUGIN_ROOT` (20), bookmarked `overview.html` | 13 | 0 |
| **Totals** | actionable ≈ 5,884 | **≈ 575** | **≈ 200** |

Other scope totals: PLUGIN-KEEPS-NAME ≈ **430** · ADDITIVE-ALIAS ≈ **40** (+188 prose deferred).
Prose/string mass (buckets 4+7) ≈ **3,064 hand edits** (~52% of FULL) — the dominant cost in every
non-additive option.

### Migration strategy
**Glossary-first, additive, never a one-shot hard rename.** Phase order:
1. **Define** (zero interface change): tagline + glossary + "what it is NOT" box.
2. **Human-surface rename** (prose, role per Q2, viewer title, additive npm aliases).
3. **Additive technical aliases** (dual MCP names, `export type New = Old`, dual env var, data-dir
   fallback) — only if Q4 says yes; breaks nothing.
4. **Defer/avoid** the destructive plugin-package + MCP-namespace + data-dir + type hard-rename
   (D-002). If ever pursued, it requires a cross-machine migration runbook (publish new marketplace
   name, coordinate `copilot plugin install <new>` on every consumer, viewer redirect for bookmarked
   `overview.html`) and must be a single atomic ship, dead last.

### Risk areas (bucket 8 — migration step each needs)
- **MCP namespace `mcp__ralph-overview__*` (11 tools):** consumed by `/work-on`, `/triage`,
  `/blocker-report` + agent prompts in `AGENTS.md`. D-001 keeps it primary; if aliasing, dual-register
  old+new and update skills in lockstep before dropping old.
- **User-global settings (`~/.copilot|~/.claude/settings.json` `ralph-overview@…` key):** outside the
  repo, per-machine, unversioned — the repo CANNOT migrate it. D-001 does not touch it.
- **Wrapper `bin/ralph-overview.mjs` (PLUGIN_NAME + 5 install-path probes) + `RALPH_OVERVIEW_PLUGIN_ROOT`
  (20 refs):** derived from the package name; D-001 keeps the package name so these stay valid (dual-
  read env only if aliasing).
- **`.ralph-overview/` data dir + the bookmarked `generated/overview.html`:** shared by watcher, MCP,
  viewer, the hot/cold shard loader, and a PreToolUse hook hard-coding `.ralph-overview/data.json`.
  D-001 keeps the dir; only a future D-002 would need fallback resolution + a viewer redirect.
- **Published plugin package `@gim-home/ralph-overview` (+ `-mcp`, `-viewer`) + 3 marketplace
  indexes:** `copilot plugin update` keys off the marketplace name. D-001 keeps it.

### Sequencing recommendation
The three "must-land-after" prerequisites (`overview-data-dynamic-stages-schema`,
`overview-data-ship-manifest`, `overview-data-context-scalability`) are **all `lifecycle: merged`**
(verified in `.ralph-overview/data.archived.json`), so invariant #5 is satisfied.
- **Land EARLY (now, schema-independent):** the define-first glossary, prose/doc rename (~1,880),
  role rename (~95), additive npm aliases, and additive MCP/type aliases. This is the bulk of D-001's
  value and touches no schema, no contract, no code path.
- **Land LAST (only if scope ever expands to D-002, and only after any in-flight `data-relocation` /
  `multi-mcp` type work merges):** the destructive `Overview*` type rename, the `.ralph-overview/`
  data-dir rename, the MCP hard-rename (drop old), and the plugin-package rename — atomic,
  cross-machine, contract-breaking, dead last. D-001 deliberately stops before this.

### Disconfirming observation to carry forward
If a real new contributor, AFTER reading the glossary/tagline, still mis-identifies or mis-scopes the
system, then the *word itself* (not a missing definition) is the blocker and a heavier scope (toward
D-002) earns its cost. Until such evidence exists, D-001 is the right ceiling.

### Open questions for planning
1. Confirm canonical word **"roadmap"** vs. **"board"** (the simplification lens's least-bad single
   word — a kanban board natively implies cards + lanes = intent + state).
2. Rename `overview-bookkeeper` → `roadmap-bookkeeper` this pass, or defer (live `.crews/` state)?
3. Adopt the two-part glossary vocab (roadmap + status) as canonical layer names?
4. Dual-register the 11 MCP tools + type aliases now (additive ~40u), or human surfaces only (~200u)?
5. Confirm acceptance of permanent dual-vocabulary (live "roadmap" + frozen "overview" in immutable
   `.ralph/` history).
