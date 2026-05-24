# Stories Outline: overview-viewer-polish

*Preliminary decomposition from `/plan-with-ralph`. Feed to `/implement-with-ralph --from-plan` for PRD generation. Per-story acceptance criteria here EXTEND the global ACs in `plan.md` (typecheck, tests, file:// build, < 500 KB bundle, 3 deviations preserved, prefers-reduced-motion respected, root pnpm-lock.yaml committed when package.json changes).*

## US-006: Install global prefers-reduced-motion guard (LANDS FIRST)
**Description:** As a viewer user with reduced-motion preference enabled, I want all current and future animations on the overview page to degrade to instant transitions so I don't get vestibular discomfort.
**Acceptance Criteria:**
- [ ] `tools/overview-viewer/src/styles.css` has a `@media (prefers-reduced-motion: reduce) { *, *::before, *::after { animation: none !important; transition: none !important; } }` block placed immediately after the CSS variable definitions (top of file, before any animation rule).
- [ ] No existing tests regress.
- [ ] Typecheck passes.
**Dependencies:** None — first story to land.
**Estimated complexity:** small

## US-001: Smooth `<details>` expand/collapse via `interpolate-size`
**Description:** As an operator, when I expand or collapse a command row, I want the body to animate in/out smoothly rather than snap, so I can track which row I just opened.
**Acceptance Criteria:**
- [ ] Each `details.cmd` body is wrapped in `<div class="cmd-body">` (or the existing wrapper if present).
- [ ] CSS rule on `.cmd-body` uses `grid-template-rows: 0fr → 1fr` driven by `interpolate-size: allow-keywords` for the animation; `transition: grid-template-rows 0.3s ease-out` on the wrapper.
- [ ] Animation degrades to instant snap on browsers without `interpolate-size` support (no JS-driven fallback required; the prior US-006 guard also covers reduced-motion).
- [ ] No existing tests regress.
**Dependencies:** US-006
**Estimated complexity:** small

## US-002: Search-hit highlighting wraps matches in `<mark class="search-match">`
**Description:** As an operator searching for "perf", I want the matching text in each visible row to be visually highlighted so I can see exactly which substring matched.
**Acceptance Criteria:**
- [ ] New file `tools/overview-viewer/src/utils/searchHighlighting.ts` exports `highlightMatches(html: string, query: string): string`.
- [ ] `highlightMatches` escapes regex metacharacters in `query` before building the matcher.
- [ ] `highlightMatches` wraps text-node matches in `<mark class="search-match">`; it does NOT rewrite inside HTML tags or attributes, and skips `<code>...</code>` blocks.
- [ ] The active search query string is threaded from `App.tsx` → `CommandList.tsx` → `TaskCommand.tsx` (new `query` prop) for use in `highlightMatches` on `cmd-name` and the plain-text rendering of `cmd-desc`.
- [ ] New test file `tools/overview-viewer/src/__tests__/searchHighlighting.test.ts` covers: regex-metachar escape, no-rewrite-inside-tags, code-block skip, case-insensitive match, empty query no-op.
**Dependencies:** US-006
**Estimated complexity:** medium

## US-003: Smooth-scroll + 1.5s flash-pulse on `#cmd-foo` hash navigation
**Description:** As an operator clicking `from prd-005` or a kanban card or a deep-linked URL, I want the page to scroll smoothly to the target row and pulse it briefly so I keep my place.
**Acceptance Criteria:**
- [ ] `tools/overview-viewer/src/hooks/useHashNav.ts` calls `element.scrollIntoView({ behavior: 'smooth', block: 'center' })` after expanding the target.
- [ ] A `.cmd-flash` class is applied for 1.5s on hash-nav arrival; the class triggers a CSS keyframe pulsing the accent ring (`box-shadow: 0 0 0 2px var(--accent)` → `6px` and back).
- [ ] The keyframe degrades to a static ring for 1.5s under `prefers-reduced-motion` (the US-006 global guard handles this).
**Dependencies:** US-006
**Estimated complexity:** small

## US-004: Sticky-toolbar elevation via `animation-timeline: scroll()`
**Description:** As an operator scrolling down, I want the toolbar's shadow and backdrop-blur to fade in only after I've scrolled past the top so the page feels less cluttered above the fold.
**Acceptance Criteria:**
- [ ] `.toolbar` CSS uses `animation-timeline: scroll()` + `animation-range: 0px 24px` to fade `box-shadow` and `backdrop-filter: blur(...)` from 0% to 100% over the first 24px of scroll.
- [ ] Older browsers (Safari < 18, Firefox without `animation-timeline`) keep the existing static shadow — no JS fallback.
- [ ] `prefers-reduced-motion` keeps a static shadow (US-006 guard).
**Dependencies:** US-006
**Estimated complexity:** small

## US-005: Bucket-count chips in section summaries
**Description:** As an operator, when I see a section summary, I want a per-bucket count (e.g., `Kanban (ready 5 · in-progress 2 · blocked 4)`) so I can triage without expanding.
**Acceptance Criteria:**
- [ ] `Kanban.tsx` summary renders a count chip per kanban column (ready / soon / blocked).
- [ ] `CommandList.tsx` summary renders a count chip per phase bucket (brainstorm / inprogress / ready / shipped / closed). Counts come from `useTaskClassification.orderBucket` aggregation.
- [ ] Counts update reactively when filters change.
- [ ] Styling uses existing `.section-counts` span; no new CSS classes.
**Dependencies:** US-006
**Estimated complexity:** small

## US-007: Copy-Command success toast (fixes silent-copy bug)
**Description:** As an operator clicking "Copy Command", I want visible confirmation that the copy succeeded (the current implementation silently captures the result and drops it) so I don't double-paste in my terminal.
**Acceptance Criteria:**
- [ ] New `tools/overview-viewer/src/components/CopyToast.tsx` rendered at App.tsx as a single bottom-right surface (role="status").
- [ ] New `useToast` hook (in `src/hooks/`) exposes `{ showToast(text), currentToast }`. All copy buttons — CopyName, CopyCommand, BulkCopy (and the future markdown-link from US-008) — dispatch via this hook.
- [ ] On copy success, the toast shows "Copied `<task-id>` (N KB)" and auto-dismisses after 1.2s. The button gets `.copied` class briefly (existing CSS at `styles.css:958` applies).
- [ ] CSS keyframe slide-in for the toast respects `prefers-reduced-motion` (US-006 guard).
- [ ] New test file `tools/overview-viewer/src/__tests__/copyToast.test.tsx` covers: render with text, auto-dismiss timing, useToast dispatch.
- [ ] `App.tsx` is added to US-007's modified-file list.
**Dependencies:** US-006, plus US-001/US-002/US-003/US-004/US-005 done (Phase A complete)
**Estimated complexity:** medium

## US-008: Per-row quick-actions strip
**Description:** As an operator, I want one-click access to the most common per-task operations (Copy markdown link, Copy ID+status, jump to parent, jump to children, jump to kanban card) from the row summary, so I don't have to expand the row to navigate.
**Acceptance Criteria:**
- [ ] `TaskCommand.tsx` summary's `.cmd-actions` cluster gets these new icon-only buttons (conditional render based on data):
  - [ ] `Copy markdown link` — always; emits `[\`task-id\`](file://.../overview.html#cmd-task-id)` via the US-007 toast pipeline.
  - [ ] `Copy ID + status` — always; emits `task-id [phase/status]`.
  - [ ] `↑ parent` — only when `data.spawnedFrom[task.id]` is set; links to `#cmd-<parentId>`.
  - [ ] `↓ N children` — only when the reverse lookup of `data.spawnedFrom` has any children; links to first child or expands a sub-list.
  - [ ] `Jump to kanban card` — only when `task.kanbanCards?.length > 0`.
- [ ] Icon-only buttons with `title=` (will get Radix Tooltip in US-014).
- [ ] Buttons reuse the toast singleton from US-007 for copy operations.
**Dependencies:** US-007
**Estimated complexity:** medium

## US-009: Density toggle (comfortable / compact)
**Description:** As an operator with many tasks visible, I want a "compact" mode that shrinks row padding and hides description sub-text so I can see more rows at once.
**Acceptance Criteria:**
- [ ] `Toolbar.tsx` has a density toggle button (text or icon, two states).
- [ ] On toggle, `<body>` gets/loses class `compact`; persisted to `localStorage` under key `codexu-overview-density-v1`.
- [ ] CSS rule `body.compact .cmd { padding: 4px 8px; } body.compact .cmd-desc, body.compact .sub { display: none; }` (or equivalent).
- [ ] Reads localStorage on mount; sensible default (`comfortable`) when no value stored.
- [ ] New test file `tools/overview-viewer/src/__tests__/density.test.ts` covers: localStorage round-trip, default value, key-versioning collision.
**Dependencies:** US-007
**Estimated complexity:** small

## US-010: Radix Tooltip on WorkstreamPill (BUNDLE-VALIDATION GATE)
**Description:** As an operator, I want hover/focus tooltips on workstream pills with proper keyboard accessibility (current `title=` is keyboard-invisible). This story is the **bundle-size and CSS-interleaving validation gate** for Phase C — if it succeeds without bundle bloat or visual regression, the rest of Radix adoption (US-011..US-014) proceeds.
**Acceptance Criteria:**
- [ ] Add `@radix-ui/react-tooltip ^1.1.x` to `tools/overview-viewer/package.json` dependencies.
- [ ] Root `pnpm-lock.yaml` regenerated by `pnpm install` and committed.
- [ ] `WorkstreamPill` in `TaskCommand.tsx` wraps the `<a class="pill-workstream">` in `Tooltip.Root` + `Tooltip.Trigger asChild` + `Tooltip.Portal` + `Tooltip.Content`.
- [ ] New CSS rule `.tooltip-content` (in styles.css) styles the Radix-emitted `[data-state="open"]` content with existing CSS variables.
- [ ] After `pnpm overview:build`, `stat -c%s plans/overview.html` returns < 500000 (bundle gate).
- [ ] Decision documented in commit message: this story installs a verification harness for Phase C — either (a) a split-projects vitest config with `environment: 'jsdom'` + `@testing-library/react` + `@testing-library/user-event` for interaction tests, OR (b) an `agent-browser` / Playwright smoke harness for popover/dialog/portal open-close interactions. Subsequent Radix stories use this harness for their behavioral ACs.
**Dependencies:** US-009
**Estimated complexity:** medium

## US-011: Radix Dialog replaces KeyboardHelp `.kbd-help` div pair
**Description:** As a keyboard user, I want the `?` help modal to have proper focus trap, ESC handling, and focus restoration on close, all of which the hand-rolled `.kbd-help` lacks today.
**Acceptance Criteria:**
- [ ] Add `@radix-ui/react-dialog ^1.1.x` to package.json; commit root pnpm-lock.yaml.
- [ ] `KeyboardHelp` in `TopLevelSurfaces.tsx` uses `Dialog.Root` + `Dialog.Trigger` + `Dialog.Portal` + `Dialog.Overlay` + `Dialog.Content`.
- [ ] Existing `.kbd-help` CSS (at `styles.css:584-618`) is reused via `[role="dialog"]` selector; existing `.kbd-backdrop` becomes the `Dialog.Overlay`.
- [ ] Radix portal z-index ≥ 100 (matches existing `.kbd-help z-index: 100`).
- [ ] After build, `stat -c%s plans/overview.html` < 500000 (halt remaining Phase C stories if exceeded).
- [ ] File:// validation: open `plans/overview.html` via OS double-click, open the help dialog, hit Escape, verify zero console errors AND that focus returns to the `?` trigger button. (Use the harness from US-010.)
**Dependencies:** US-010
**Estimated complexity:** medium

## US-012: Radix Popover + ToggleGroup replaces FilterChips `<details>`
**Description:** As an operator, I want the filter popover to dismiss on outside click + ESC, and to support roving Tab/Shift-Tab focus across chips — neither of which the current `<details>` provides. Critically, the `activateWorkstream` callback at `App.tsx:66-70` must continue to open the filter UI even after the underlying `<details>` is gone.
**Acceptance Criteria:**
- [ ] Add `@radix-ui/react-popover ^1.1.x` AND `@radix-ui/react-toggle-group ^1.1.x` to package.json; commit pnpm-lock.yaml.
- [ ] `FilterChips` in `Toolbar.tsx` uses `Popover.Root` + `Popover.Trigger` + `Popover.Portal` + `Popover.Content` containing `ToggleGroup.Root` + `ToggleGroup.Item` per chip.
- [ ] **`App.tsx` modified:** filter-open state lifted into `App` via `useState`; `setOpenFilters` callback threaded into `Toolbar`'s props; `activateWorkstream` callback (existing at App.tsx:66) calls `setOpenFilters(true)` and `filter.toggleFilter('workstream', ws)` so a workstream-pill click still reveals + activates the matching chip.
- [ ] Acceptance criterion (verified manually under file://): clicking a `.pill-workstream` on any command row opens the filter popover with the matching workstream chip in `data-state="on"`.
- [ ] **Expand-all / Collapse-all keyboard shortcuts continue to control the same surfaces** they did before this story. Today `setAllDetails` at `App.tsx:58-64` queries `document.querySelectorAll('details')` and toggles `.open`. After Radix Popover replaces the filter `<details>`, the filter is no longer affected by Expand-all — this is acceptable IF the documentation explicitly notes the filter no longer participates in Expand-all (otherwise it's a silent regression). Choose: (a) accept the filter exit from Expand-all + document, OR (b) extend setAllDetails to also dispatch to a registered set of open-state controllers including the new Popover state.
- [ ] After build, bundle size < 500 KB.
- [ ] File:// validation: open popover, hit Escape, verify dismiss + focus returns to trigger. Tab through chips, Shift-Tab back. Click outside to dismiss.
**Dependencies:** US-011
**Estimated complexity:** medium

## US-013: Radix Checkbox replaces BulkSelectCheckbox (row-level only)
**Description:** As an operator, I want row-level bulk-select checkboxes that have proper keyboard semantics. (Bucket-level "select all visible" indeterminate moved to US-015 because the bucket DOM doesn't exist yet.)
**Acceptance Criteria:**
- [ ] Add `@radix-ui/react-checkbox ^1.1.x` to package.json; commit pnpm-lock.yaml.
- [ ] `BulkSelectCheckbox` in `TaskCommand.tsx` uses `Checkbox.Root` + `Checkbox.Indicator`.
- [ ] Existing `.cmd-select` CSS (at `styles.css:564-568`) extends via `[data-state="checked"]` selector.
- [ ] Keyboard: Space toggles, focus visible.
- [ ] After build, bundle size < 500 KB.
- [ ] File:// validation via the harness from US-010.
**Dependencies:** US-012
**Estimated complexity:** small

## US-014: Broader Tooltip adoption
**Description:** As an operator, I want consistent keyboard-accessible tooltips on all hint-bearing UI elements (cadence chips, status badges, scope chips, spawned-from pills, kanban hover text).
**Acceptance Criteria:**
- [ ] Replace `title=` attribute with Radix `Tooltip` wrap on: `cadenceChip`, `StatusBadge`, `ScopeChip`, `SpawnedFromPill` (all in `TaskCommand.tsx`), and any kanban card pills.
- [ ] All tooltips share the same `.tooltip-content` CSS from US-010.
- [ ] No additional Radix dependencies (reuses US-010's `@radix-ui/react-tooltip`).
- [ ] After build, bundle size < 500 KB.
**Dependencies:** US-013
**Estimated complexity:** small

## US-015: Collapse-by-phase bucket headers in CommandList (+ bucket-level indeterminate select-all)
**Description:** As an operator with 73+ rows, I want to fold whole phase buckets (e.g., close all `shipped` rows) so I can focus on `plan-ready` work. Buckets are the existing `orderBucket` values from `PHASE_TO_ORDER_BUCKET` (brainstorm/shipped/closed/inprogress/ready). Also adds bucket-level indeterminate "select all visible in bucket" checkbox (deferred from US-013 because it needs this bucket DOM).
**Acceptance Criteria:**
- [ ] `CommandList.tsx` groups `tasks` by `useTaskClassification(task).orderBucket`. Emits one `<details class="cmd-bucket" id="cmd-bucket-<orderBucket>">` per non-empty bucket. Default `shipped`/`closed` buckets closed; `plan-ready`/`inprogress`/`brainstorm` open.
- [ ] Bucket summary shows: `<bucket-label> (count · N blocked · oldest YYYY-MM-DD)`. Counts derive from filtered visible-task set.
- [ ] `<TaskCommand>` children are sorted inside each bucket via `sortTasksByLastTouchedAsc` (preserves deviation #3).
- [ ] CSS rules: drop or scope down the global `.cmd[data-cmd-status]` `order` rules at `styles.css:837-852` (they become inert since DOM order now reflects buckets). Add new `.cmd-bucket > .cmd[data-task-status="blocked"]` and `[data-task-status="paused"]` rules to preserve deviation #2 (blocked/paused → tail of bucket).
- [ ] **`App.tsx` modified:** thread the new bucket open-state controls from `usePersistentExpanded` through `CommandList`; `useHashNav` receives both task and bucket setters.
- [ ] New file `tools/overview-viewer/src/utils/bucketNavigation.ts` exports `getBucketIdForTask(taskId: string, tasks: OverviewTask[]): string | null`. Pure function, no DOM access.
- [ ] `useHashNav.ts` uses `getBucketIdForTask` to find the parent bucket and calls `setBucketExpanded(bucketId, true)` BEFORE expanding the task. Then scroll + flash.
- [ ] `usePersistentExpanded.ts` extended with `setBucketExpanded(bucketId, open)` and `isBucketExpanded(bucketId)`. Same localStorage key (`codexu-overview-details-state-v2`); bucket keys use prefix `cmd-bucket-<orderBucket>`.
- [ ] **Bucket-level indeterminate select-all:** add a checkbox in each `<summary>` of `.cmd-bucket` that goes `unchecked / indeterminate / checked` based on visible-row selection state in that bucket. Reuses Radix Checkbox from US-013.
- [ ] **Expand-all / Collapse-all** keyboard shortcuts continue to control bucket open-state (buckets ARE native `<details>` so `document.querySelectorAll('details')` still finds them).
- [ ] New tests: `bucketGrouping.test.ts` (group-by + count + oldest aggregation), `bucketNavigation.test.ts` (renamed from `hashNavBucket.test.ts` — pure-function test of `getBucketIdForTask`).
- [ ] Deep-link regression test: loading `?#cmd-<id>` where the parent bucket is persisted-collapsed expands BOTH the bucket and the task, then scrolls + flashes.
**Dependencies:** US-014
**Estimated complexity:** large

## US-016: Sticky top frame: metrics strip + ToC anchors
**Description:** As an operator, I want a persistent metrics strip ("N total · X ready · Y in-progress · Z blocked · W shipped (7d)") and ToC anchors ("Kanban · Commands · Roadmap · Parallelism · Deps") at the top of the page so I always know where I am and what the high-level state is.
**Acceptance Criteria:**
- [ ] New file `tools/overview-viewer/src/components/StickyFrame.tsx` with metrics + ToC sub-components.
- [ ] New file `tools/overview-viewer/src/utils/dashboardCounts.ts` exports `getDashboardCounts(data: OverviewData): { total, ready, inProgress, blocked, shippedRecent }`. Shared with future LeftRail in US-017.
- [ ] `App.tsx`: mount `<StickyFrame>` above `<main>`. Position: sticky, top: 0, z-index: 15 (above toolbar's 10).
- [ ] Metrics counts each clickable; click toggles the corresponding filter via `filter.toggleFilter('status', '<bucket>')`.
- [ ] ToC buttons scroll-to + expand the matching section `<details>` (and the corresponding bucket header if any).
- [ ] `TodayPanel.tsx` refactored to consume `getDashboardCounts` (eliminates duplicated calculation).
- [ ] New test file `tools/overview-viewer/src/__tests__/stickyFrame.test.tsx` covers: metrics derivation, ToC anchor list, click-to-filter wiring.
**Dependencies:** US-015
**Estimated complexity:** medium

## US-017: LeftRail component + factor TodayPanel utilities
**Description:** As an operator, I want a persistent left sidebar showing Today / What's-New / Recently shipped / Periodic / Legend so these "what should I look at" panels are always visible while scrolling.
**Acceptance Criteria:**
- [ ] New file `tools/overview-viewer/src/components/LeftRail.tsx` rendering 5 sub-sections.
- [ ] `App.tsx` layout: `<div class="main-layout" style="display: grid; grid-template-columns: 220px 1fr; gap: 16px;"><LeftRail /><main>...</main></div>` (or equivalent CSS rule in styles.css).
- [ ] `LeftRail` has `position: sticky; top: 60px; max-height: 100vh; overflow-y: auto`.
- [ ] Refactor: extract `buildTodayBuckets`, `recentRuns`, `TodayChips` from `TodayPanel.tsx` into reusable utilities consumed by both `TodayPanel` (legacy compact in main column) and `LeftRail` (full).
- [ ] `Legend` extracted from `TopLevelSurfaces.tsx` / `Kanban.tsx` summary into LeftRail.
- [ ] New test file `tools/overview-viewer/src/__tests__/leftRail.test.tsx` covers render + sub-section presence.
**Dependencies:** US-016
**Estimated complexity:** large

## US-018: Responsive collapse for LeftRail (< 900px hamburger toggle)
**Description:** As a mobile / narrow-window user, I want the LeftRail to collapse behind a hamburger button so the main content gets full width.
**Acceptance Criteria:**
- [ ] CSS `@media (max-width: 900px)`: `.left-rail { position: fixed; left: -220px; transition: left 0.3s; } .left-rail.open { left: 0; }`. Main layout becomes single-column.
- [ ] `StickyFrame.tsx` (or `App.tsx`) renders a hamburger button in the metrics strip (visible only via the same media query). Clicking it toggles `.left-rail.open`.
- [ ] Transition respects `prefers-reduced-motion` (US-006 guard).
- [ ] File:// validation: resize browser to 800px wide, click hamburger, verify rail slides in over main; click outside / hit Esc to dismiss.
**Dependencies:** US-017
**Estimated complexity:** medium

## US-019: Docs sweep (README, CLAUDE.md, SKILL.md)
**Description:** As a future contributor, I want the docs to reflect the new layout (LeftRail, StickyFrame, bucket headers) and to list all intentional deviations from the `9f81c1f8` baseline.
**Acceptance Criteria:**
- [ ] `tools/overview-viewer/README.md` Layout section updated with the new structure (StickyFrame on top, LeftRail on left, main column with bucket-grouped CommandList).
- [ ] `tools/overview-viewer/README.md` "Intentional Deviations" section expanded from 3 to up to 7 entries:
  1. Phase-tree `deferred` class (existing).
  2. Blocked/paused → tail of phase bucket (existing).
  3. Secondary sort by `lastTouchedAt` ascending (existing).
  4. Phase-bucket headers in command list (US-015).
  5. Sticky top frame with metrics + ToC (US-016).
  6. Left rail (US-017).
  7. Smooth `<details>` expand + hash-nav flash-pulse + sticky-toolbar elevation as motion polish (US-001/US-003/US-004).
- [ ] `tools/overview-viewer/CLAUDE.md` Layout section + HMR description updated.
- [ ] `.agents/skills/roadmap-and-overview/SKILL.md` viewing subsection updated.
**Dependencies:** US-018
**Estimated complexity:** small
