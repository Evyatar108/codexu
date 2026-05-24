# Research Brief: task-phases plan conversion

Compiled from 4 parallel research streams (Claude researcher, Claude architect, Codex xhigh, Copilot) on 2026-05-17.

## Researcher Findings

### `plans/overview.html` line-claim audit (total: 3412 lines)

- `:root` color-token block: ✓ confirmed `7-21`
- `@media (prefers-color-scheme: light)`: ✓ confirmed `22-38`
- Kanban badge CSS (`.b-now`, `.b-soon`, `.b-block`): ✓ confirmed `80-82`
- Legacy command-row badge CSS (`.b-ready`, `.b-blocked`, `.b-paused`, `.b-closed`): ✗ source doc claimed ~76-110, actual `845-849` (off by ~770) — these are SEPARATE from kanban badges
- `.b-inprogress`: no CSS definition; JS-only at `2847`
- Kanban container / cards: ✓ confirmed `1043-1178` (close to source's `~1043-1180`)
- Commands `<details>` rows: ✗ source claimed `~1400-2150`, actual `1401-1891` (491 lines, not 750)
- `pill-spawned-from`: ✓ confirmed `363-376`
- `<script id="roadmap-data">`: ✓ confirmed starts `2155`
- Today panel grouped by running/ready/on hold: `962`
- Status filter chips: `978-985`
- Phase tree (existing roadmap tree, not the new phase model): starts `1895`

### `plans/parallel-assignments.md`

- Front-matter / workflow conventions: `1-22` ✓
- Per-task table starts `553`; headers `Tab title | Task | Status | Commit` (`557-558`)
- Spans `557-583`+; existing references to `b-ready`/`b-blocked`/`b-paused`/`b-closed` in table + prose

### `plans/codexu-roadmap.md`

- Standing rules section: header at `163`, 4 bullets `165-174` ✓
- In-flight ralph jobs: header at `176`, 3 subsections (`3a-skills` paused, `3h-options` done, `agent-tree-rpc` delivered)
- "1-paragraph PRD" reference: `1285-1286`

### Bookkeeper pattern

- `roadmap-data` JSON schema today is **top-level maps, not per-task objects**: `generatedAt`, `generatedFromCommit`, `lastTouched`, `periodic`, `cadence`, `runs`, `effort`, `risk`, `workstream`, `sizeBucket`, `spawnedFrom`
- No `bookkeeper` agent in `.agents/` / `.claude/` / `AGENTS.md`
- Bookkeeping rules live in `.agents/skills/roadmap-and-overview/SKILL.md` (lines 55, 99, 121, 258-280, 310, 453-477)
- Spawn relationship: captured in `roadmap-data.spawnedFrom`; rendered by JS `injectSpawnRelationships()` at `3415-3444`; CSS pill at `363-376`

### Sample task entries (all exist in current overview.html)

- `agent-comms` `1594-1597`
- `1b-multidev` `1491-1496`
- `codex-parity-audit` `1466-1470`
- `agent-view-research` `1577-1581`
- `1a-fork-doc` `1483-1487`
- `3c-hooks` `1509-1513`
- `polish-Fs` `1568-1570`

Standard structure: `<details class="cmd">` → `<summary>` (name + badge + short desc) → `<div class="cmd-body">` → optional warning → Copy Command button → `<pre class="cmd-pre">`.

### JS badge classification / kanban logic

- `classifyAndOrderCmds()` at `2671-2695` reads `.cmd-badge` classes:
  - `b-closed` → `closed` (unless emoji is not 🚫 → `shipped`)
  - `b-paused` → `paused`
  - `b-inprogress` → `inprogress`
  - `b-ready` → `ready`
  - `b-blocked` → `blocked`
- `classifyCmd()` at `2842-2851` mirrors the same mapping for Today panel + filters
- Multi-axis filter at `3126-3163` uses `status` as one axis
- Kanban remains 3-column (Ready now / Unblocked needs re-read / Blocked or operator-only)
- Kanban-card title-text matching at `3293` is brittle (used to inject phase pills into cards)

### Test infrastructure

None found for HTML/JS in `plans/`.

### Sibling docs (BOTH EXIST already — both drafted 2026-05-17)

- `plans/overview-data-split.md` (15 KB, 11 sections) — explicitly says "Plan #1 (`task-phases.md`) MUST land first. The schema's `phase` field is the enum from plan #1."
- `plans/overview-vite-react.md` (19 KB, 11 sections) — explicitly says "BLOCKED on `plans/task-phases.md` and `plans/overview-data-split.md`."

Both sibling plans already reference the phase enum, `planSource`, `brainstormPrompt`, etc. — meaning this plan's enum design is load-bearing for them. Sibling plans reference: `phase`, `planSource`, `brainstormPrompt`, `brainstormJobId`, `planJobId`, `implementJobId`, `mergeCommit`, `planReviewIterations`.

### `.ralph/jobs/` existing corpus

12 job directories: `1a-fork-doc`, `agent-tree-rpc`, `codex-mcp-discovery`, `codex-wire-spike`, `f-013-perms-closeout`, `phase-3a-port-ralph-skills`, `phase-3h-options-mode-migration`, `port-explorer-prompt`, `realtime-sync-perf-ws3`, `remove-tunnel-claim-layer`, `session-parent-link`, `session-role-pill`.

---

## Architect Analysis

### Integration points

- `roadmap-data` is **inlined JSON** at `2155-2168`, parsed via `JSON.parse(...)` at `3389-3394`
- Page is hand-curated; the maintenance workflow lives in `.agents/skills/roadmap-and-overview/SKILL.md`
- No generator/codegen script for the page
- Legacy `b-*` model still active in `.agents/skills/roadmap-and-overview/SKILL.md` (lines 35-37, 196-226)

### Technical constraints

- No JS framework — vanilla HTML/CSS/JS only (`2589+` is plain JS)
- Light theme defines ALL the same tokens as dark (`--bg --fg --muted --border --card --card-hover --accent --ok --warn --bad --info --done --purple`); **no missing tokens**
- Phase NOT inferable from filesystem state: jobs can start without producing a plan; "fuzzy enough to brainstorm" is operator judgment

### Recommended approach

- Order: data model first in HTML → CSS aliases → kanban/phase-tree rendering → docs
- CSS placement: splice into existing badge block around `76-110` (review locality)
- Status modifier rendering: **separate `<span>` sub-badge** (not pseudo-elements) — readable, selectable, independent of phase color
- Migration UX: keep the doc's **per-task operator table at end** (not TODO comments, not a details block)

### Risk areas

- Kanban column assignment hard-coded: `labels = ['Ready', 'Soon', 'Blocked']` at `2953-2965`
- CSS specificity: keep new phase classes as single-purpose badge modifiers (`.badge.b-phase-*`); avoid redefining generic `.badge`
- Light-theme tokens: none missing
- `pill-spawned-from` collision: it's injected separately in body (`3436+`); keep phase pills in `<summary>` and spawned-from pills in body

### Risk for plans #2 / #3

Recommendations to lock in NOW:
- Standardize absent optional fields to **`null` in persisted JSON** (not `undefined`)
- TypeScript types: `field: string | null`
- Make `phase` **required**, default to `plan-ready` for un-fired concrete tasks
- Keep `planSource` required once a task has a `planPrompt`; treat `from-brainstorm` / `from-plan-doc` as explicit enums, not inferred state

---

## Codex Research

### Integration points

- `roadmap-data` JSON schema today: `lastTouched`, `effort`, `risk`, `workstream`, `sizeBucket`, `cadence`, `periodic`, `spawnedFrom`, `runs` — **no phase fields**
- `classifyAndOrderCmds()` (`2677-2695`), `classifyCmd()` (`2842-2851`), filter logic (`3126-3163`) ALL derive from legacy badge classes
- Today panel grouped by running/ready/on hold at `962`
- Status filter chips (current axis: status) at `979`
- Existing PRD style examples: `tasks/prd-1a-fork-doc.md` (line ~22), `tasks/prd-port-explorer-prompt.md` (line ~20) — autonomous stories + operator-gated stories pattern

### Technical constraints

- Must remain static HTML — no Vite/React, no sidecar JSON extraction, no generator
- JS is class-driven today, so updates to badge classes alone will DRIFT filters and counts
- Existing doc drift: `overview.html` marks `perf-WS3` and `1a-fork-doc` shipped while `parallel-assignments.md` still says in-progress → migration needs reconciliation pass

### Implementation suggestion (key insight)

Use **row-level data attributes** as the HTML-only schema, NOT just CSS classes:

- `data-task-phase="plan-ready"` and `data-task-status="ok|blocked|paused"` on every `<details class="cmd">`
- Optional: `data-plan-only`, `data-plan-source`, `data-plan-source-ref`, `data-brainstorm-job-id`, `data-plan-job-id`, `data-implement-job-id`, `data-plan-review-iterations`, `data-merge-commit`

The CSS badge becomes a *rendered* artifact (`.cmd-badge.b-plan-ready` etc.), while filters/sorting/Today-panel logic reads the `data-task-phase` attribute. Legacy badge classes are aliased for backwards-compat.

The toolbar status filter at `979` becomes either "Phase" + "Modifier" filters OR a derived-bucket mapping (PRD must specify explicitly).

For kanban: cards currently match commands by title text at `3293` (brittle). Add `data-task-id` to cards or inject phase pills via the matching logic.

Verification: static — grep every command row for `data-task-phase`, grep allowed enum values, open in dark/light, flip one representative row through each progression path.

---

## Copilot Research

### Codebase architecture confirmation

- Single-file static dashboard at `plans/overview.html`; no build step; works under `file://`
- Companion docs: `parallel-assignments.md`, `codexu-roadmap.md`, `.agents/skills/roadmap-and-overview/SKILL.md`

### Constraints surfaced

1. **Current status is badge-class-driven, not schema-driven** → phase change touches sorting, Today panel counts, status filters (not just CSS/markup)
2. **Task state duplicated across representations**: command row + kanban card + `roadmap-data` JSON maps + `parallel-assignments.md` status table — no canonical task object yet
3. **Toolbar filters expose only legacy status categories** (`ready / inprogress / blocked / paused / closed` at `978-985`)
4. **`.agents/skills/roadmap-and-overview/SKILL.md` still documents the old `status`-only model** → will be stale immediately after this change

### Recommended story decomposition (from Copilot)

- **Story 1:** phase/status schema + `overview.html` renderer/plumbing
- **Story 2:** migrate all existing tasks/cards/command rows
- **Story 3:** document conventions in `parallel-assignments.md` and `codexu-roadmap.md`
- **Story 4:** smoke representative progression paths + legacy-class fail-soft behavior

### Two biggest risk areas the source doc underplays

- **Filter/Today-panel JS coupling** — must update `classifyCmd()` / `classifyAndOrderCmds()` / filter logic together
- **Maintenance-doc drift in `.agents/skills/roadmap-and-overview/SKILL.md`** — must update or call out as follow-up

---

## Consolidated File List

### Primary change surface

- `plans/overview.html` (3412 lines)
  - Color tokens: `7-21` (dark `:root`), `22-38` (light `@media`)
  - Kanban badge CSS: `80-82`
  - Legacy command-row badge CSS: `845-849`
  - Today panel grouping: `962`
  - Status filter chips: `978-985`
  - Kanban cards: `1043-1178`
  - Command `<details>` rows: `1401-1891` (49 rows)
  - Existing phase tree: `1895+`
  - `roadmap-data` JSON: `2155-2585`
  - `classifyAndOrderCmds()`: `2671-2695`
  - `classifyCmd()`: `2841-2860`
  - Kanban column assignment: `2953-2965`
  - Multi-axis filter: `3126-3163`
  - Kanban-card title-matching: `3293`
  - `getRoadmapData()`: `3389-3394`
  - `injectSpawnRelationships()`: `3415-3444`
  - `pill-spawned-from`: `363-376`
- `plans/parallel-assignments.md` (front-matter `1-22`, status table `553-583+`)
- `plans/codexu-roadmap.md` (Standing rules `163-174`)

### Sibling plans (READ-ONLY — they reference this plan's enum)

- `plans/overview-data-split.md` — depends on phase enum
- `plans/overview-vite-react.md` — depends on phase enum + data-split

### Reference docs

- `.agents/skills/roadmap-and-overview/SKILL.md` — old `b-*` model is documented here; may need update or follow-up tracking
- `tasks/prd-1a-fork-doc.md`, `tasks/prd-port-explorer-prompt.md` — PRD style reference

### Drift to reconcile during migration

- `perf-WS3` and `1a-fork-doc`: marked shipped in `overview.html` but in-progress in `parallel-assignments.md`
