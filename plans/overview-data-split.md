# Overview-data split — hoist task definitions out of HTML into a sidecar data file

*Drafted 2026-05-17 as input to a future `/plan-with-ralph` invocation. SECOND of three sibling plans. Strict dependency: `plans/task-phases.md` MUST land first because the new schema bakes in the phase enum from that plan.*

## Why

`.ralph-overview/generated/overview.html` is 3770 lines (post-`task-phases` merge). Roughly:

- ~1000 lines header + styles + scripts (now includes 10 phase-badge CSS classes at lines ~852-880 + `.cmd-status-mod` modifier)
- ~150 lines kanban cards (3 columns × ~5-15 cards each), each carrying `data-task-id` (post-`task-phases`)
- ~600 lines phase tree section
- ~900 lines ralph-command `<details>` rows at lines ~1442-1915 (~50 entries × ~18 lines each, each row now carrying `data-task-phase`, `data-task-status`, optionally `data-plan-only` / `data-merge-commit`, plus a full `/plan-with-ralph` prompt body and rendered phase badge)
- ~600 lines embedded `roadmap-data` JSON at lines ~2180 onward (`lastTouched`, `runs`, `periodic`, `cadence`)
- ~400 lines inline JS (filter, search, copy buttons, URL filter banner, hash nav, plus the new `renderPhaseBadges()` function that walks `data-task-phase` to emit badges)

**The bookkeeper procedure now lives at `.agents/skills/roadmap-and-overview/SKILL.md`** (548 lines, shipped 2026-05-17 in commit `db2f68f7`). It documents the multi-file update flow per task state change: command-row data attributes, kanban-card phase pill, `lastTouched` JSON, `runs[]` JSON, status table row in `parallel-assignments.md`, sometimes phase tree, sometimes `cadence` block. That's still 4-6 places per state change — the drift trap is unchanged. This plan reduces it to one file.

A `<script type="application/json" id="roadmap-data">` block already exists (lines 2180 onward) and is consumed by inline JS that calls `document.getElementById('roadmap-data')` → `JSON.parse`. So the JSON-as-data pattern is half-introduced. This plan finishes the job by hoisting per-task definitions into the same data layer, AND simultaneously updates the bookkeeper SKILL to point at the new file.

## What changes

Single sidecar file: `.ralph-overview/data.json` (NOT `.json`).

```js
// .ralph-overview/data.json — single source of truth for the overview viewer
// Edit this file to change task state; do NOT edit .ralph-overview/generated/overview.html directly.
window.OVERVIEW_DATA = {
  meta: {
    generatedAt: "2026-05-17T...",
    generatedFromCommit: "..."
  },
  tasks: [
    {
      id: "perf-WS3",
      title: "Realtime sync perf — WS3: server replay buffer + client lastSeenSeq",
      scope: "codexu",                          // codex | codexu | "codex|codexu"
      area: "multi-package",                    // → pill CSS class
      risk: "medium",                           // low | medium | high
      effort: "~3h",
      kanbanColumn: "ready",                    // ready | soon | blocked
      phase: "shipped",                         // from plan #1's enum (brainstorm-* | plan-* | impl-* | shipped | closed)
      status: "ok",                             // ok | blocked | paused
      blockedBy: [],
      spawnedFrom: null,
      planOnly: false,
      // Prompts:
      brainstormPrompt: null,                   // optional; "/brainstorm-with-ralph \"...\"" for fuzzy tasks
      planPrompt: "/plan-with-ralph \"...\"",   // mandatory; may be "/plan-with-ralph --from-brainstorm"
      implementPrompt: "/implement-with-ralph", // optional

      // Implemented in task-phases (already on HTML as data-* attributes — extract verbatim):
      planOnly: false,                          // mirrors data-plan-only
      mergeCommit: null,                        // mirrors data-merge-commit; populated when phase === "shipped"

      // Surfaced today ONLY in parallel-assignments.md status table; promote to data file (sparse population OK):
      planSource: "fresh",                      // "fresh" | "from-brainstorm" | "from-plan-doc" | "planOnly"
      planSourceRef: null,                      // for "from-plan-doc": relative path like "plans/task-phases.md"; null otherwise
      planJobId: null,                          // .ralph/jobs/<id>/plan.md when populated; today most rows are null (— in markdown table)

      // Reserved for future expansion (not in current HTML or markdown table; leave null/undefined):
      // brainstormJobId, implementJobId, planReviewIterations — drop unless a downstream UI needs them.
      warnings: [
        { kind: "blocked", text: "Wait until perf-WS3 lands." }
      ],
      lastTouchedAt: "2026-05-13T22:00:00Z",
      links: {
        plan: "realtime-sync-perf.md#WS3",
        commit: "197b0148"
      },
      phaseTreePath: "phase-realtime-perf.WS3"  // optional, for phase tree placement
    },
    // ... ~50 more
  ],
  runs: [ /* moved verbatim from existing roadmap-data block */ ],
  periodic: { /* moved verbatim */ },
  cadence: { /* moved verbatim */ },
  lastTouched: { /* DEPRECATED — superseded by per-task lastTouchedAt; preserve for one cycle then remove */ }
};
```

`.ralph-overview/generated/overview.html` body becomes mostly empty containers:

```html
<div id="kanban-ready"></div>
<div id="kanban-soon"></div>
<div id="kanban-blocked"></div>
<div id="cmd-list"></div>
<div id="phase-tree"></div>
<div id="runs-log"></div>
<script src="overview-data.js"></script>
<script>
  // existing render JS, expanded to walk OVERVIEW_DATA.tasks and emit cards/rows
</script>
```

## Why `.js` not `.json`

- `.json` files can't be `<script src=>`'d (the `src` attribute is ignored on `application/json` scripts).
- `fetch('./overview-data.json')` is blocked by Chromium on `file://` (CORS).
- A `.js` file containing `window.OVERVIEW_DATA = {...};` works on `file://` (`<script src="overview-data.js">` runs without CORS).
- The body inside the assignment is JSON-shaped; the bookkeeper agent treats it as JSON for editing purposes.
- If strict validation is wanted, ship a tiny `tools/overview/validate.mjs` (Node, ~30 lines) that parses the body and validates schema + cross-refs (`blockedBy` ids exist, `spawnedFrom` points at a real task, no duplicate ids). Invoke via `pnpm overview:validate`.

## Files to change

- `.ralph-overview/data.json` — NEW. ~3000-4000 lines including all task entries + runs log. Start with a top-of-file comment block documenting the schema (copy from this plan's "What changes" section).
- `.ralph-overview/generated/overview.html` — major reduction:
  - DELETE: all ~50 `<details class="cmd">` blocks (lines ~1442-1915 post-`task-phases`).
  - DELETE: all kanban `<div class="card">` blocks inside `.col` containers (lines ~1061-1395; each card now carries `data-task-id`, easy to walk).
  - DELETE: all phase tree cards (lines ~2000s — verify exact range).
  - DELETE: the existing `<script type="application/json" id="roadmap-data">` block (lines ~2180 onward; ~600 lines).
  - DELETE: the existing `renderPhaseBadges()` function and its call sites in inline JS — superseded by the data-driven render that emits badges from `task.phase` directly.
  - PRESERVE: the 10 phase-badge CSS classes at lines ~852-880 and `.cmd-status-mod` at lines ~862-874 — the data-driven render emits the same class names, so the CSS stays untouched.
  - ADD: empty container divs (`<div id="kanban-ready">` etc.).
  - ADD: `<script src="overview-data.js"></script>` near the bottom, before the existing render JS.
  - EXPAND: the existing render JS to walk `OVERVIEW_DATA.tasks` and emit DOM. The filter/search/URL-banner/hash-nav logic should be parameterizable so it works against the data-driven DOM. Today's filter/Today logic reads `data-task-phase` + `data-task-status` from DOM; refactor to read `task.phase` + `task.status` from the data array instead, then re-emit the data attributes on the rendered DOM (so external JS that reads them still works, and so the URL filter / search continues to function).
  - PRESERVE: all `<style>` blocks, the section headers, the legend, the URL filter banner DOM, the search input.
- `.agents/skills/roadmap-and-overview/SKILL.md` — MUST be updated in the same commit. Replace every reference to "edit `data-task-phase` attribute on the row" / "update kanban card" / "bump `lastTouched` JSON" with "edit the corresponding task entry in `.ralph-overview/data.json`". The skill is ~548 lines today; this is a non-trivial update. Key sections to rewrite:
  - "Procedure A — add a task" (currently lines ~141-180-ish): replace multi-step HTML edits with a single JSON entry append.
  - "Procedure B — close out" (currently around line 207+): replace `data-task-phase="shipped"` edits with `phase: "shipped"` field updates in the data file.
  - "Procedure for paused / blocked" (around line 255): same.
  - "Pitfalls" section: drop the "data-task-id is load-bearing" pitfall (still true but the data file's `id` field is the new load-bearing point); add a new pitfall about JS string escaping for prompt bodies (see "Common mistakes" #1 below).
- `plans/parallel-assignments.md` — add bookkeeper edit-rules section near the top: "Task state lives in `.ralph-overview/data.json`. Edit that file; the HTML renders from it. Never edit `.ralph-overview/generated/overview.html` for task state changes." Also: keep the bottom status table OR drop it in favor of the data file. Recommend keeping it (markdown is easier to grep than JSON-in-JS), but it becomes a derived view; add a note that drift between table and data file means data file wins.
- `plans/codexu-roadmap.md` — update the "Task phase model" standing rule (currently around line 175) to point at the new data file as the source of truth. Also update the "Companion snapshot" callout (lines 5-9) noting the data file location.
- `tools/overview/validate.mjs` — NEW (optional but recommended). Schema check script. Pure Node, no deps. Reads `.ralph-overview/data.json` via `vm.runInNewContext` with a stub `window` object, validates structure, validates cross-refs (`blockedBy` ids exist, `spawnedFrom` points at a real task), validates parity with the `parallel-assignments.md` status table if kept, exits non-zero on error. Wire into pre-commit hook or `pnpm overview:validate`.

## Files to read as reference (do NOT edit beyond what's listed above)

- `.ralph-overview/generated/overview.html` end-to-end at least once before starting — agent needs full mental model of current structure.
- `.ralph-overview/generated/overview.html` lines ~2180 onward for the existing `roadmap-data` JSON shape (move verbatim into the new file's `runs` / `periodic` / `cadence` / `lastTouched` fields).
- `.ralph-overview/generated/overview.html` for the `document.getElementById('roadmap-data')` consumption pattern (grep for it; line numbers shift). The data-driven render must replace this.
- `.ralph-overview/generated/overview.html` filter/search/URL-banner state management — grep for `url-filter-banner` and `URLSearchParams` to find the block. The render expansion must preserve this.
- `.ralph-overview/generated/overview.html` lines ~1442-1915 for command row template (extract template, parametrize). Every row already carries `data-task-id`, `data-task-phase`, `data-task-status`, optionally `data-plan-only` / `data-merge-commit` — these become structured fields in the data file.
- `.ralph-overview/generated/overview.html` lines ~852-880 for the 10 phase-badge CSS classes + `.cmd-status-mod` styles — preserve verbatim.
- `.ralph-overview/generated/overview.html` `renderPhaseBadges()` function in inline JS — read to understand how phase → badge text/glyph mapping works today; the new render JS folds this logic in. The function emits badges with class `cmd-badge b-<phase>` and a leading glyph (📋, ✅, 🚫, etc.) keyed off the phase enum.
- `plans/parallel-assignments.md` end-to-end — to understand per-task prompt body conventions AND the bottom status table (lines ~561+ with `Phase | Status | Plan source | Plan job | Commit` columns). The data file extraction can sanity-check against this table.
- `.agents/skills/roadmap-and-overview/SKILL.md` (548 lines) — the canonical bookkeeper procedure as it stands today. Read end-to-end before drafting the data-file-era replacement procedure.
- `plans/task-phases.md` (sibling plan) for the phase enum and the input/output field definitions.

## Acceptance

- `.ralph-overview/data.json` exists with all ~50 task entries ported verbatim from the HTML. Wording, warnings, custom border colors, prompt bodies preserved character-for-character (modulo escaping for JS string literals).
- Opening `.ralph-overview/generated/overview.html` from `file://` (double-click) renders the page identically to the pre-refactor version: same kanban columns + cards, same phase tree, same commands list with expandable `<details>` rows, same filter/search/URL-banner behavior.
- Bookkeeper workflow change: flipping one task's phase from `impl-in-progress` to `shipped` requires editing exactly one block in `overview-data.js`, no edits to `overview.html`.
- `tools/overview/validate.mjs` (if shipped) passes with zero errors on the freshly-migrated data file.
- The previous `roadmap-data` JSON block is removed from `overview.html` (its contents moved to the new file's `runs`/`periodic`/`cadence`/`lastTouched` fields).

## Worktree

`.worktrees/overview-data-split/` per `plans/parallel-assignments.md` lines 10-11. Suggested topic branch: `ralph/overview-data-split`.

## Staging (recommended sub-commits)

The full extraction is high-risk. Split into 3-4 commits, each independently reviewable:

1. **Scaffold:** create `overview-data.js` with the top-of-file schema comment and an empty `tasks: []`. Move the existing `roadmap-data` JSON's `runs`/`periodic`/`cadence`/`lastTouched` into the new file verbatim. Remove the `<script type="application/json" id="roadmap-data">` block from HTML and replace with `<script src="overview-data.js">`. Update the inline JS at line ~3391 to read `window.OVERVIEW_DATA` instead of parsing the script element. Verify the page still renders.
2. **Port 3 representative tasks:** pick `perf-WS3` (shipped, with commits), `1b-multidev` (ready with warnings), `polish-Fs` (ready with conflict warning). Extract their HTML blocks (both kanban card AND commands `<details>` row) into `tasks[]` entries. Add a render-from-data block to the inline JS that emits these three. Render BOTH the existing HTML and the new data-driven blocks in a side-by-side test section at the top of the page. Diff visually.
3. **Port all remaining tasks:** ~47 more. Delete the original HTML blocks. Remove the side-by-side test section.
4. **Port phase tree section:** if time. The phase tree (lines ~2000s) cross-references task ids; data-driving it means tree nodes consume `tasks[]` by id. Optional in v1 if it adds risk.

## Common mistakes / confusion points

1. **JS string escaping for prompt bodies.** The `/plan-with-ralph "..."` prompts contain double quotes, dollar signs, backticks, ampersands, less-than signs. When porting from HTML's `<pre>` (where they're stored as text content, possibly HTML-encoded as `&lt;` etc.) into a JS string literal, the agent must:
   - Decode HTML entities (`&lt;` → `<`, `&gt;` → `>`, `&amp;` → `&`) before placing into JS.
   - Use template literals (`` ` ``) wrapping with `\`` escapes for any literal backticks inside, OR use single-quoted strings and escape only single quotes.
   - Avoid double-encoding. The rendered HTML output must show the same character sequence as the original `<pre>` text.

2. **Order of warnings matters.** Some `<details>` blocks have multiple `<div class="cmd-warn">` blocks — a blocked banner THEN a regular warning. The `warnings: []` array must preserve order. The render JS emits them in order.

3. **Custom inline styles on kanban cards.** Several cards use `style="border-color: var(--ok); opacity: 0.8;"` for "shipped" visual treatment. Capture these as a render-time computation from the task's `phase` field rather than a per-task style override. (E.g., `phase === "shipped"` → opacity 0.8 + green border.) This is cleaner than carrying a `customStyle` string on every task.

4. **Spawned-from arrows render BOTH ways.** The card with `spawnedFrom: "agent-view-research"` shows a "spawned from agent-view-research" pill. The `agent-view-research` card shows a "spawned-children" strip with arrows to its children. The render JS must compute the inverse relation (children) from `tasks.filter(t => t.spawnedFrom === parent.id)`. Don't store both directions in the data.

5. **URL filter banner state.** Inline JS at lines ~3070-3120 reads `?id=foo,bar` URL params and filters the task list. After refactor, the filter operates against the same `tasks` array but the DOM has been re-rendered from data — make sure the filter logic runs AFTER the initial data-driven render, not before.

6. **Section counts.** Headers like "Kanban — assignable now <span class="section-counts" id="counts-kanban">" expect a count. Existing inline JS at some point (search for `counts-` in the file) populates these. After refactor, the count comes from `tasks.filter(t => t.kanbanColumn === 'ready').length`.

7. **Don't load JSON via `fetch()`.** A naive refactor that ships `.json` and adds `fetch('./overview-data.json')` works in dev mode (HTTP) but breaks `file://` (CORS). Stick with `.js` + `<script src>`.

8. **Preserve `expanded` state across data updates.** Today `<details>` `open` attributes are pure DOM state. After refactor, if a render-from-data run wipes the DOM and rebuilds it, all expanded sections collapse. Either: (a) preserve `open` state across re-renders by reading current DOM before wipe and re-applying after; or (b) accept the collapse, since plan #3 (`overview-vite-react.md`) solves this properly with React state. (b) is fine for this plan.

9. **The existing `id` attributes on `<details>` elements are load-bearing.** URL hash navigation (e.g. `#cmd-perf-WS3`) jumps to a specific task. Render JS must emit `id="cmd-${task.id}"` on each `<details>` to preserve deep-linkability.

10. **HMR friendliness.** Plan #3 (Vite) will rely on Vite watching `overview-data.js` for changes. Keep the file's top-level a single `window.OVERVIEW_DATA = { ... };` assignment — no IIFE, no conditional logic. Predictable shape for the watcher.

## Out of scope

- The actual live-update / HMR. That's plan #3.
- Any new task fields beyond what the phase model from plan #1 introduces.
- Migrating `plans/parallel-assignments.md` per-task prompt bodies — they continue to live there as the human-authored source; the JS data file mirrors them. Future cleanup can deduplicate but not in this plan.
- Replacing the inline JS with a build step / bundler. Keep it as `<script>` blocks in HTML. Plan #3 introduces Vite.

## Dependency notes

- Plan #1 (`task-phases.md`) — ✅ SHIPPED 2026-05-17 (commits `41ffa876` through `5a369d6f` + post-merge fixes `f-003`/`f-004`/`f-005`/`f-006`/`f-007`). The phase enum + `data-task-phase` / `data-task-status` / `data-plan-only` / `data-merge-commit` attributes are in place. The extraction can walk them directly.
- Plan #3 (`overview-vite-react.md`) depends on this. The React app imports `window.OVERVIEW_DATA` from the same file.
- After this plan ships, the bookkeeper SKILL (`.agents/skills/roadmap-and-overview/SKILL.md`) must be rewritten in the same commit. The skill update is part of this plan's scope, not a follow-up. Also search `grep -rn overview.html .agents/ plans/ packages/` for stray instructions to "edit overview.html for task state"; update them all.
