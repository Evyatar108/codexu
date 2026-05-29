# Overview Viewer polish + IA restructuring — planning seed

*Drafted 2026-05-18 as input to `/plan-with-ralph`. Distills three parallel Claude agent reports (UI library survey, interaction/motion polish, information architecture) into a single planning seed. The full agent reports are reproduced verbatim below.*

## Scope (Phases A through E)

### Phase A — Pure CSS / pure JS, no new deps, ~1 KB delta
- Smooth `<details>` expand/collapse via `interpolate-size: allow-keywords` + `grid-template-rows: 0fr → 1fr` (gracefully degrades on Safari < 17.4 / FF < 129).
- Search-hit highlighting — wrap query matches in `<mark class="search-match">` inside `cmd-name` and the plain-text of `cmd-desc`; skip inside `<code>`. The `.search-match` style ALREADY EXISTS in `styles.css` (amber background, rounded) but is unused.
- Smooth-scroll + flash-pulse on `#cmd-foo` hash navigation. New `.cmd-flash` 1.5s ring keyframe.
- Sticky-toolbar elevation via pure-CSS `animation-timeline: scroll()` — fade shadow + backdrop-filter blur only once scrolled > 24px. Gracefully no-ops on older Safari/FF.
- Bucket-count chips in section summaries (e.g. `Kanban (ready 5 · in-progress 2 · blocked 4)`).
- Global `prefers-reduced-motion` guard block at top of `styles.css` so any new motion degrades automatically without per-rule guards.

### Phase B — Small renderer additions, no new deps
- Copy-Command success toast. **DISCOVERED BUG**: `.copy-btn.copied` class exists in `styles.css` but is never applied — `writeClipboard` returns a boolean that's discarded. Fix: apply `.copied` for 1.2s + show single bottom-right `<div role="status">` toast "Copied `<task-id>` command (N KB)". Pure React useState singleton; CSS keyframe slide-in.
- Per-row quick-actions strip on `<summary>`: extend the existing `.cmd-actions` cluster with `Copy markdown link` (`[\`id\`](file://.../overview.html#cmd-id)`), `Copy ID + status`, `↑ parent` icon (only when `spawnedFrom[id]`), `↓ N children` icon (only when `childrenByParent[id]`), `Jump to kanban card` icon (only when task has `kanbanCards`). Icon-only buttons with title tooltips.
- Density toggle in toolbar (`comfortable` / `compact`) — class-toggle `body.compact` shrinking `.cmd` padding + hiding `.sub` description text; persisted in `localStorage` under `codexu-overview-density-v1`.

### Phase C — Radix UI primitives rollout
Adopt **headless primitives** (no theme engine to fight, no runtime CSS injection, composes with verbatim `styles.css` via `[data-state="open"]` selectors).

- `@radix-ui/react-tooltip` (~3 KB gz) on `WorkstreamPill` + `SpawnedFromPill` + `cadenceChip` + `StatusBadge` + `ScopeChip` to replace `title=` attrs (keyboard-invisible today).
- `@radix-ui/react-dialog` (~6 KB gz) for `KeyboardHelp` — replaces `.kbd-help` + `.kbd-backdrop` div pair. Gains focus-trap, ESC handling, scroll-lock, `aria-modal`, focus restoration. **Alternative**: native `<div popover>` attribute saves ~5 KB; tradeoff is older browser support.
- `@radix-ui/react-popover` + `@radix-ui/react-toggle-group` (~6-8 KB gz combined) for `FilterChips` — replaces the `<details className="toolbar-filters">` pattern. Gains outside-click dismissal + roving Tab/Shift-Tab focus across chips.
- `@radix-ui/react-checkbox` (~3 KB gz) for `BulkSelectCheckbox` + a new "select all visible in bucket" indeterminate checkbox.

**Bundle delta estimate**: ~15-25 KB gzipped after tree-shake. Under the 100 KB ceiling.

**Rollout order within Phase C** (smallest blast radius first, lets us validate Radix interleaving with verbatim CSS before committing further):
1. `Tooltip` on `WorkstreamPill` only.
2. `Dialog` for `KeyboardHelp`.
3. `Popover + ToggleGroup` for `FilterChips` in `Toolbar.tsx`.
4. `Checkbox` for bulk-select.
5. Broader `Tooltip` adoption to remaining `title=` strings.

### Phase D — Information architecture: bucket headers + sticky top frame
- **Collapse-by-phase bucket headers in command list**: group `tasks` by `phase` (or `orderBucket`) in `CommandList.tsx`, emit one `<details class="cmd-bucket">` per bucket containing `(count, n blocked, oldest lastTouchedAt)` in its summary, with per-task `<details>` nested inside. Default `shipped`/`closed` buckets closed; `plan-ready` open. **Compatibility**: the three intentional deviations (deferred class, blocked-to-tail sub-order, lastTouchedAt-asc) must survive — keep `sortTasksByLastTouchedAsc` within each bucket; blocked-to-tail CSS rule re-scoped under `.cmd-bucket`. Drop the global `.cmd[data-cmd-status]` `order` rules since bucket DOM order now does the bucketing.
- **Sticky top frame** (`<header class="sticky-frame">` above `<main>`):
  - Metrics strip: `N total · X ready · Y in-progress · Z blocked · W shipped (7d)` derived from existing `filterBucketForTask` + `recentRuns`.
  - Horizontal ToC anchor row: `Kanban · Commands · Roadmap · Parallelism · Deps` that scrolls-to + auto-expands the matching `<details>`.
  - Counts double as click-to-filter chips (re-uses `toggleFilter`).
- **Persist bucket expand-state** by extending `usePersistentExpanded` to bucket-level keys under the existing `codexu-overview-details-state-v2` namespace.

### Phase E — Left rail (biggest visual change)
- New persistent left rail (220px width, `position: sticky; top: 0`) containing top-to-bottom: Today (running/ready/on-hold chips from `TodayPanel`), What's-New (changed-since-last-visit list), Recently shipped (7d), Periodic due-soon, Legend (moved out of Kanban summary).
- Main column gets the metrics strip + Kanban + grouped command list + phase tree + parallelism + deps.
- Responsive: collapses to a single button under `@media (max-width: 900px)`.

## Existing constraints from the workspace

- `pnpm-workspace.yaml` AND root `package.json` → `workspaces.packages` BOTH list `tools/overview-viewer` (drop either → silent breakage).
- Vite entry is `overview.html` (NOT `index.html`) so the natural build emits to `.ralph-overview/generated/overview.html`.
- HMR mechanism is option (c) — fetch-and-re-execute via `import.meta.hot.on('overview-data:update')` + `new Function(text)()`. **Do not switch to ws-payload or virtual-module without operator approval.**
- US-008 destructive swap landed `.ralph-overview/generated/overview.html` as a generated artifact. **Never hand-edit it.**

## Reference files to read

| Path | Why |
|---|---|
| `tools/overview-viewer/README.md` | Three intentional deviations, dev/build workflow |
| `tools/overview-viewer/CLAUDE.md` | Layout, HMR mechanism, trusted-HTML boundaries |
| `tools/overview-viewer/src/App.tsx` | Top-level composition + inline `reloadOverviewData()` |
| `tools/overview-viewer/src/components/*.tsx` | Current component inventory |
| `tools/overview-viewer/src/styles.css` | ~1060 lines, dark/light themes, all visual rules |
| `tools/overview-viewer/src/hooks/usePersistentExpanded.ts` | localStorage pattern for expanded-state persistence |
| `tools/overview-viewer/src/utils/filters.ts` | Search haystack + filter logic (recently widened for F-011) |
| `.ralph-overview/data.json` | Data file shape (hand-edited; reference only) |
| `.agents/skills/roadmap-and-overview/SKILL.md` | Bookkeeper Procedures F + G describe what operators actually do |
| `.ralph/jobs/overview-vite-react/plan.md` | The plan that built the current viewer; useful as a structural reference |

## Open questions for the planner

1. **Radix Dialog vs native `<div popover>`** for KeyboardHelp — Radix wins on browser support, native saves ~5 KB. Default Radix unless bundle-budget is tight.
2. **Should bucket headers replace the CSS `order`-based interleaving entirely**, or coexist? Recommendation: replace, since cross-bucket ordering goes away once buckets are explicit. Keep the blocked-tail CSS rule scoped under `.cmd-bucket`.
3. **Left rail responsive collapse threshold** — `@media (max-width: 900px)` is a starting point; the planner should pick based on the operator's typical viewport.
4. **Does Phase E (left rail) require splitting `TodayPanel.tsx` and `TopLevelSurfaces.tsx`?** Recommendation: yes, factor into `LeftRail.tsx`. Move `FreshnessHint`, `WhatsNewBanner`, `Legend` (out of Kanban summary) into the rail.

## Phasing recommendation for the planner

Treat the five phases as **separate stories with explicit dependencies**:

- Stories US-001 through US-006 = Phase A (each item is one atomic story)
- US-007 + US-008 + US-009 = Phase B (toast, quick-actions, density)
- US-010 through US-014 = Phase C (Radix; one story per primitive rollout step)
- US-015 + US-016 = Phase D (bucket headers + sticky frame)
- US-017 = Phase E (left rail)
- US-018 = docs sweep (update CLAUDE.md, README, SKILL.md to reflect the new layout + add a fourth intentional deviation entry if needed)

After each story, a checkpoint: rebuild via `pnpm overview:build`, manually verify `file://` opens correctly, verify bundle size stays under budget. Phase C in particular needs the bundle-size verification gate because each Radix package adds ~3-8 KB.

---

# Full agent reports

The three agent reports below are reproduced verbatim. They were produced in parallel by three Claude `general-purpose` subagents (NOT codex / NOT copilot, per operator request) on 2026-05-18.

## Agent 1: React UI library survey

**Top recommendation: Radix UI Primitives (v1.x, late 2025)**

1. **Name + version**: `@radix-ui/react-*` modular primitives (Dialog 1.1, Popover 1.1, Tooltip 1.1, Checkbox 1.1, Toggle 1.1, ToggleGroup 1.1, Collapsible 1.1, ScrollArea 1.2). Pick 4–6 packages à la carte.
2. **Bundle impact**: ~12–25 KB gzipped after tree-shake for the set above (each primitive is 2–6 KB gz). Well under the 100 KB ceiling. Zero runtime CSS — Radix ships unstyled, headless components plus inline `data-state="open|closed"` attributes.
3. **Replaces / augments**:
   - `KeyboardHelp` → `Dialog` (focus-trap, ESC, scroll-lock, `aria-modal`, restores focus)
   - `FilterChips` `<details>` → `Popover` (closes on outside click + ESC)
   - `BulkSelectCheckbox` → `Checkbox` (indeterminate state)
   - `WorkstreamPill`/`SpawnedFromPill` tooltips → `Tooltip` (keyboard-visible)
   - `cmd` and section `<details>` → keep native (Radix `Collapsible` optional; native is fine and load-bearing for the CSS selectors).
4. **UX wins**: ESC-to-close + click-outside dismissal on filter popover; focus-trapped help modal; hover/focus tooltips with proper delay + arrow; indeterminate bulk-select; Tab/Shift-Tab roving focus inside filter chip groups via `ToggleGroup`.
5. **Tradeoffs**: Headless — styling stays in `styles.css`. New classes target `[data-state="open"]`, `[data-state="checked"]`, `[role="dialog"]` selectors composing cleanly. Several entries in `package.json`. No theme engine.
6. **file:// compatibility**: Excellent. Pure React + DOM, no portals to fixed host, no service workers, no font fetches, no runtime CSS injection. Portals to `document.body` work under `file://`. Vite tree-shakes ESM exports.

**Honorable mentions**: `cmdk` (~6 KB) for command palette; `@floating-ui/react` (~10 KB) for bespoke floating UI.

**Rejected**: shadcn/ui (Tailwind dep), MUI (90+ KB + Emotion), Chakra UI v3 (CSS-in-JS), Mantine v7 (CSS-modules build pipeline), Park UI / Ark UI (Panda CSS overlap), Tailwind / DaisyUI (explicitly banned), Headless UI (smaller surface, Tailwind-aligned).

**Rollout order**: Tooltip → Dialog → Popover+ToggleGroup → Checkbox → broader Tooltip.

## Agent 2: Interaction & motion polish

**Top 5 high-value, low-cost wins**:

1. **Smooth `<details>` expand/collapse** via `interpolate-size: allow-keywords` + `grid-template-rows: 0fr → 1fr`. Pure CSS, ~0 KB. Wrap each `<details>` body in `<div class="cmd-body">` (already exists for `.cmd`). Chrome 129+/Safari 17.4+/FF 129+ supported; older browsers degrade.
2. **Copy-Command success toast**. CSS class `.copy-btn.copied` exists but is never applied — operator double-pastes thinking it failed. Pure React + CSS keyframe, ~0.5 KB, honors reduced-motion.
3. **Smooth-scroll + flash-highlight on `#cmd-xxx` hash nav**. `scrollIntoView({ behavior: 'smooth', block: 'center' })` + `.cmd-flash` class for 1.5s pulsing accent ring. ~0.3 KB.
4. **Sticky-toolbar elevation on scroll** via pure-CSS `animation-timeline: scroll()`. Backdrop-blur + shadow only once scrolled > 24px. No-ops on Safari < 18 / FF. ~0.2 KB.
5. **Search-hit highlighting**. The `.search-match` CSS rule already exists but nothing emits `<mark>`. Wrap matches in `cmd-name` + `cmd-desc` plain-text, skip inside `<code>`. ~0.4 KB.

**Additional ideas**: chip count-badge bump (~0.2 KB), search-input clear ×, kanban card hover lift, kbd shortcut hints on hover, filter-popover slide-down, global reduced-motion guard, native `<div popover>` for KeyboardHelp.

**Explicit skips**: `framer-motion` / `motion` (30 KB; CSS does the same); `@dnd-kit/core` (data is read-only — misleading drag UI); `cmdk` (duplicates `/` search + `?` help); `react-virtuoso` / `@tanstack/react-virtual` (breaks `:target` deep-links, Ctrl+F, persistent details state); `embla-carousel-react` for kanban (hides columns); `react-hotkeys-hook` (current hook is fine); `react-aria` (#12 native popover covers); skeleton/shimmer (data is inline at first paint); drag-without-effect.

## Agent 3: IA + component restructuring

**Top 5 IA improvements by impact-per-effort**:

1. **Collapse-by-phase bucket headers in command list**. 73 flat `<details>` siblings → grouped under `<details class="cmd-bucket">` per phase with count + blocked + oldest-touched in summary. Default `shipped`/`closed` closed. Preserve three deviations: keep `sortTasksByLastTouchedAsc` within each bucket; blocked-tail CSS scoped under `.cmd-bucket`.
2. **Sticky top frame: metrics strip + ToC anchors**. `<header class="sticky-frame">` above `<main>` with `N total · X ready · Y in-progress · Z blocked · W shipped (7d)` + horizontal anchor row. Counts double as click-to-filter chips.
3. **Left rail for Today / What's-New / Legend / Recently shipped / Periodic due-soon**. 220px persistent sticky sidebar. Main column gets clean focus. Collapses on narrow viewports.
4. **Quick-actions strip on command row summary**: `Copy markdown link`, `Copy ID + status`, `↑ parent`, `↓ N children`, `Jump to kanban card`. Icon-only buttons, only show when relevant.
5. **Global Runs Log section** grouped by ISO week between `PhaseTree` and `ParallelismSection`. Re-uses per-task `RunsLog` row style.

**Smaller polish**: density toggle, bucket-count chips inside section summaries, keyboard "jump to task" palette via `g`, saved views via URL (extend `?tasks=` scheme), per-task right-click context menu.

**Rejected**: Kanban + Command list as tabs (breaks shared scroll + `#cmd-foo` deep-links); focus mode (existing workstream filter does it); side-by-side "diff" view for What's-New (would require previous-snapshot data); per-row "spawned" graph visualization (data is intentionally flat); separate operator-notes surface (`codexu-overview-notes-v1` already exists per-task).

---

*End of planning seed. The planner should produce a multi-story implementation plan covering all five phases, with each story bounded enough to ship + verify independently, and with explicit story dependencies so US-007 (toast) lands before US-014 (broader Radix adoption that uses the toast) etc.*
