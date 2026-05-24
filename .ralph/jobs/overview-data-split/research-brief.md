# Research Brief — overview-data split

## Researcher Findings (Claude)

**`plans/overview.html` actual structure (verified line ranges, file = 3770 lines):**
| Section | Lines |
|---------|-------|
| Header + CSS + scripts (incl. phase-badge classes 852–880, `.cmd-status-mod` 862–874) | 1–1082 |
| Kanban (3 `<div class="col">` at 1083, 1206, 1327; cards each with `data-task-id`) | 1083–1425 |
| Command `<details>` rows (~50 entries with `data-task-id`/`data-task-phase`/`data-task-status`, optional `data-plan-only`/`data-merge-commit`) | 1442–1914 |
| Phase tree section (`<details class="section sec-roadmap">`, Phases 1–7) | 1920–2009 |
| `roadmap-data` JSON (`generatedAt`, `generatedFromCommit`, `lastTouched`, `runs`, `periodic`, `cadence`, `effort`, `risk`, `workstream`, `sizeBucket`, `spawnedFrom`) | 2180–3529 |
| Inline JS (render, filter, URL banner, hash nav, localStorage v2 persistence) | 3530–3767 |

**Data attributes on rows confirmed (sample):**
- `cmd-perf-WS3`: `data-task-id`, `data-task-scope="codexu"`, `data-task-phase="shipped"`, `data-task-status="ok"`
- `cmd-mcp-discovery`: + `data-merge-commit="1cf6b4e2"`
- `cmd-codex-parity-audit`: + `data-plan-only="true"`
- `cmd-3a-skills`: `data-task-phase="plan-ready"`, `data-task-status="paused"`

**Inline JS contract (locations):**
- `getRoadmapData()` parses `#roadmap-data` JSON (lines 3530–3533)
- `renderPhaseBadges()` walks `details.cmd`, reads `data-task-phase/status`, applies `b-<phase>` class (lines 2729–2762)
- URL filter `?tasks=a,b,c` via `parseTaskIdFilter()` (lines 3205–3254) — **NOT `?id=`** (draft was wrong)
- Section counts populator (lines 3070–3096) — IIFEs for `#counts-cmds` and `#counts-kanban`
- Hash nav + `localStorage` key `'codexu-overview-details-state-v2'` (line 3106)
- Spawn relationships injection (lines 3554–3570) — reverse-index off `data.spawnedFrom`

**Phase / status enums (from `plans/task-phases.md` lines 24–25):**
- Phase (10): `brainstorm-ready | brainstorm-in-progress | brainstorm-review | plan-ready | plan-in-progress | plan-review | impl-ready | impl-in-progress | shipped | closed`
- Status (3): `ok | blocked | paused`

**`.agents/skills/roadmap-and-overview/SKILL.md` (548 lines) section headers:**
- A. Adding a new ralph task (150–199)
- B. Marking a task as shipped (201–242)
- C. Recording a periodic task run (243–252)
- D. Marking a task paused / blocked (253–259)
- E. Research task spawned follow-ups (260–293)
- F. Adding a new workstream (294–299)
- G. Adding a new visualization feature (300–310)
- Pitfalls (311–328)
- URL filtering (492–518)

**`plans/parallel-assignments.md` status table:** lines 561–612, 51 rows, columns: Tab title | Task | Phase | Status | Plan source | Plan job | Commit.

**`plans/codexu-roadmap.md`:** Companion snapshot callout lines 5–9; "Task phase model" standing rule line 175.

**`tools/overview/`:** does NOT exist. `tools/` contains only `render-roadmap.ts`, `render-roadmap.test.ts`, `vitest.config.ts`. pnpm workspaces in use; no existing `overview:*` scripts in root `package.json`.

**References to "edit overview.html" outside the target file:**
- `.agents/skills/roadmap-and-overview/SKILL.md` lines 141, 162, 185–190
- `plans/codexu-roadmap.md` lines 7–9
- `plans/parallel-assignments.md` line 559
- `plans/agent-view-research.md` (multiple)
- `plans/codex-agent-parity-audit.md` line 1358

**Worktree convention (`plans/parallel-assignments.md` lines 13–15):**
`.worktrees/<task-id>/` on branch `ralph/<task-id>`, created via `git worktree add .worktrees/<task-id> -b ralph/<task-id> origin/main`.

---

## Architect Analysis (Claude)

**Plan #1 (task-phases) shipped:** commits `41ffa876..5a369d6f` + 5 post-merge fixes. All 50 rows carry `data-task-phase` + `data-task-status`; 6 carry `data-merge-commit`; 3 carry `data-plan-only`. CSS phase classes fully present.

**Plan #3 (overview-vite-react) contract:** lines 43, 74–88, 102 of `plans/overview-vite-react.md` explicitly require `window.OVERVIEW_DATA` as React's data source via `getSnapshot()`. Custom Vite HMR plugin watches `plans/overview-data.js`. **Schema must remain a single top-level `window.OVERVIEW_DATA = {...};` assignment — no IIFE, no conditional logic.**

**Top three risks (architect's ranking):**
1. **Prompt body corruption.** ~50 prompt bodies with HTML entities (`&lt;`, `&gt;`, `&amp;`) in shell metacharacters like `2&gt;&amp;1`. Double-decode and quote/backtick escaping are real corruption vectors. Mitigation: HTML-decode once, prefer single-quoted strings with `\'` escapes or template literals with explicit `\``+`${` escapes; manually diff first/last 5 prompts.
2. **`<details>` expanded state wipes on re-render.** Architect recommends overriding the draft's "accept collapse" position with a 5–10-line preserve-and-restore on the rendered DOM.
3. **`validate.mjs` cross-ref false positives blocking commits.** Add `--strict` flag; ref checks advisory by default; support `--from-commit` dirty-state validation.

**Custom-styled kanban cards (architect counted):**
- Shipped-style `border-color: var(--ok); opacity: 0.8;`: 4 cards (perf-WS3, mcp-discovery, codex-parity-audit, 3h-options)
- Paused-style `border-color: var(--muted); opacity: 0.7;`: 1 card (3a-skills)
Architect recommends render-time computation from `task.phase` instead of inline style strings.

**Architect on parallelization:** suggests SKILL.md rewrite + `validate.mjs` could land **parallel** with the final task-extraction commit because they don't touch `overview.html` or `overview-data.js`. Otherwise sequential.

---

## Codex Research

**Key disagreement with draft:** **`kanbanColumn` is too narrow.** Codex confirmed multiple kanban cards per task for `1b-multidev`, `polish-Fs`, `perf-WS2`, `agent-comms`. Use `kanbanCards: []` per task or a top-level `kanbanCards[]` array. **The draft schema must be widened.**

**Counts disagreement:** Codex reports **49 real `details.cmd` rows**, not "~50" (the row count in the draft is approximate).

**DOM contracts to re-emit (must preserve verbatim):**
- `id="cmd-${task.id}"` (hash links)
- `data-task-id`, `data-task-phase`, `data-task-status`, `data-task-scope`, `data-plan-only`, `data-merge-commit`
- URL filter param is `?tasks=`, not `?id=`
- Scope values are not just `codex|codexu`: also `bookkeeping|codexu`, `codex`, `codexu`. Schema must not narrow.

**Recommended schema additions Codex flags:**
- `meta: { generatedAt, generatedFromCommit }`
- `task.command: { summaryHtml, descriptionHtml, warnings[], planPrompt }` (description often contains `<code>` and `<a>` — pure string fields lose fidelity)
- `task.kanbanCards[]` instead of single column
- `task.lastTouchedAt`, `effortHours`, `risk`, `workstream`, `sizeBucket`, `cadence`
- Top-level `runs`, `periodic`
- Optional `phaseTree` only if this pass data-drives the tree

**Inline JS sequencing:** Data-driven render must execute BEFORE existing IIFEs (`renderPhaseBadges`, `injectTaskScopeChips`, counts, filters, spawn links, run-history). Otherwise the existing enhancers query empty DOM.

---

## Copilot Research

**The biggest gap the draft misses:** **The phase tree is NOT task-derived.** The current roadmap section (`<details class="section sec-roadmap">`, lines 1920–2028) contains many bullets that are not task rows at all (`1b.1`, `4a-4m`, etc.) and have no task IDs. A `phaseTreePath` field on tasks **cannot reproduce the page identically**.

**Recommendation:** add a dedicated `phaseTree` structure to `overview-data.js`, OR explicitly defer phase-tree extraction to a later commit. **Do not promise identical phase tree from `tasks[]` alone.**

**Inline JSON already richer than draft acknowledges:** existing block holds map-shaped metadata `effort`, `risk`, `workstream`, `sizeBucket`, `spawnedFrom` keyed by task id. Current enhancers read these maps. If they move into `tasks[]`, the enhancers need refactors OR a compatibility adapter.

**Doc drift Copilot caught:** SKILL.md references `codexu-overview-details-state-v1` while `overview.html` line 3105–3122 uses `...-v2`. Confirms the same-commit skill rewrite is needed.

**Repo-wide stale-instruction sweep needed:** beyond named docs, search `roadmap-plugin` prompt body and `plans/parallel-assignments.md` for instructions assuming the old "edit overview.html" model.

**Implementation suggestion (sequencing):** first migration commit should move the **existing inline JSON verbatim** (with `effort`/`risk`/`workstream`/`sizeBucket`/`spawnedFrom` maps intact) into `window.OVERVIEW_DATA` and switch `getRoadmapData()` to return it. Then port task rows. This makes the first commit a pure relocation, not a schema change.

**`cmd-desc` content is rich:** inline `<code>` + links inside the description, ordered rich-text warnings, shipped/paused inline styling, some tasks have no command body at all. Flat string-only model will not preserve identically.

---

## Consensus & Divergences

**Consensus across all four (no disagreement):**
- `.js` (not `.json`) is mandatory due to `file://` CORS
- Existing data attributes on rows are ready to extract verbatim — no new schema decisions needed for phase/status
- SKILL.md rewrite must be in the same commit
- `validate.mjs` is good-to-have, optional
- Worktree path: `.worktrees/overview-data-split/` on `ralph/overview-data-split`

**Divergences / draft gaps to fix:**
1. **Single `kanbanColumn` field is wrong** (Codex). Multiple cards per task exist. Use `kanbanCards[]`.
2. **Phase tree can't be derived from `tasks[]`** (Copilot). Either a dedicated `phaseTree` structure, or explicit deferral. Draft's `phaseTreePath` is insufficient.
3. **Existing inline JSON has more maps than draft acknowledges** (Copilot, Codex). `effort`/`risk`/`workstream`/`sizeBucket` maps must move too — either into per-task fields or preserved as top-level maps for adapter compatibility.
4. **Task description is rich HTML, not a flat string** (Codex, Copilot). Schema needs `summaryHtml`/`descriptionHtml` or trusted-HTML fragments.
5. **`<details>` open-state preservation** — architect votes (a) implement preserve/restore; draft votes (b) accept collapse. Architect's case (5–10 LOC, large UX win) is stronger.
6. **URL filter param is `?tasks=`, not `?id=`** — minor fact-check.
7. **49 task rows, not 50** — minor count correction.

**Critical sequence Codex + Copilot agree on:**
Phase 1 commit should be **pure relocation** of inline JSON to `overview-data.js` with `getRoadmapData()` rewired. Phase 2+ extracts the task rows. Plan-doc's Stage #1 says "Move runs/periodic/cadence/lastTouched verbatim" but omits `effort/risk/workstream/sizeBucket/spawnedFrom`. Correct that to "move the entire current inline JSON verbatim."

---

## Consolidated File List

**Files to create:**
- `plans/overview-data.js` (~3000–4000 lines)
- `tools/overview/validate.mjs` (~50–100 lines; ref-check + enum-check + parity-with-status-table)

**Files to modify (major):**
- `plans/overview.html` — delete inline JSON block + ~50 `<details class="cmd">` rows + kanban cards + (optional) phase tree cards; add empty containers + `<script src="overview-data.js">`; expand inline JS to data-drive render and re-emit DOM contracts; preserve `<details>` open state across re-render
- `.agents/skills/roadmap-and-overview/SKILL.md` (548 lines) — rewrite procedures A–F to point at `plans/overview-data.js`; fix `v1`→`v2` localStorage drift; update Pitfalls with JS string-escaping guidance

**Files to modify (minor):**
- `plans/parallel-assignments.md` — add bookkeeper edit-rules note at top; keep bottom status table but mark as derived view
- `plans/codexu-roadmap.md` — update "Companion snapshot" callout (lines 5–9) and "Task phase model" standing rule (line 175)
- `package.json` — add `"overview:validate": "node tools/overview/validate.mjs"` (optional)

**Files to read as reference:**
- `plans/overview.html` end-to-end (especially 852–880 CSS, 1083–1425 kanban, 1442–1914 commands, 1920–2009 phase tree, 2180–3529 JSON, 3530–3767 JS)
- `plans/parallel-assignments.md` end-to-end (per-task prompt-body conventions; status table)
- `.agents/skills/roadmap-and-overview/SKILL.md` end-to-end before rewrite
- `plans/task-phases.md` for the enum
- `plans/overview-vite-react.md` for downstream contract
- `plans/codex-agent-parity-audit.md`, `plans/agent-view-research.md` (stale references to update)
