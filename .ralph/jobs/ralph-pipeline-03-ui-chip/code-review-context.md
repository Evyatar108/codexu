# Code Review Context — ralph-pipeline-03-ui-chip

Patterns and conventions discovered while reviewing Plan 03's diff. These are
informational for the next reviewer / fixer; they are NOT findings.

## Codebase conventions used by this plan

- **Radix Tooltip with a focusable `<span>` trigger.** `RalphStageChip` mirrors
  `WorkstreamPill` (tools/overview-viewer/src/components/TaskCommand.tsx:298)
  by wrapping `<Tooltip.Trigger asChild>` around a span with `tabIndex={0}` and
  an `aria-label`. The plan explicitly dropped `role="button"` per plan-review
  finding F-006 because the chip has no click action.
- **Filter axis fan-out is centralized.** Adding a new `FilterAxis` requires
  changes in `filters.ts` (union + `createEmptyFilters` + `cloneFilters` +
  predicate helpers), `useMultiAxisFilter`, and every test fixture that
  hand-builds an `ActiveFilters` record (e.g., `density.test.ts`). Predicate
  helpers now require `ralphState: OverviewRalphState` as a non-optional
  argument; callers pass `NO_RALPH_STATE` from `__tests__/testData.ts` when
  they have no Ralph state to assert against.
- **Vite plugin separation honored.** A second crew member is working on Plan
  02 (`ralph-pipeline-02-watcher`) and concurrently edits
  `tools/overview-viewer/vite.config.ts`. Plan 03 stays inside a new named
  factory `overviewRalphStatePlugin()` registered as a sibling to
  `overviewDataPlugin()` in the `plugins: []` array. Plan 03 does NOT touch
  Plan 02's `configureServer` extension and does NOT call
  `server.watcher.add(overviewRalphStatePath)` — Plan 02 owns the watch and
  emits `overview-ralph-state:update` over the dev-server WebSocket.
- **HMR subscription is additive.** `App.tsx` keeps the existing
  `overview-data:update` `useEffect` and adds a second, independent
  `useEffect` for `overview-ralph-state:update`. Both effects guard with
  `if (!import.meta.hot) return;` and re-check `import.meta.hot?.off(...)`
  inside the cleanup.
- **Static-build sidecar inlining.** `transformIndexHtml` reads
  `plans/overview-ralph-state.js`, minifies it with `esbuild`, escapes
  `</script` → `<\/script`, and replaces the placeholder
  `<script src="./overview-ralph-state.js"></script>` in `overview.html`.
  Mirrors `overviewDataPlugin` exactly. Fail-fast on missing script tag was
  added per plan-review finding F-005.
- **Test split.** Node SSR project covers default `src/__tests__/**`; jsdom
  project covers `src/__tests__/interactions/**`. Radix hover/focus tests live
  under `interactions/` because they need a real DOM with focus semantics.

## Cross-cutting concerns the fixer should respect

- **Bundle budget.** `wc -c plans/overview.html` after `pnpm overview:build`
  must stay <= 525,000 bytes. Current build is 501,307 bytes — ~24 KB of
  headroom for the remaining downstream plans.
- **Trusted-HTML boundary.** No `dangerouslySetInnerHTML` was introduced by
  this plan. `RalphStageChip` and the tooltip body render plain text from
  `ralphState.byTaskId[taskId]`.
- **`Kanban` `ralphState` prop is unused on purpose.** The required-but-unused
  prop is reserved for Plan 04. F-001 calls this out as a quality footgun;
  treat as informational unless the fixer prefers the relaxed-optional or
  underscore-destructure path before Plan 04 lands.

## Plan-review findings folded into US notes (already addressed in code)

These were originally plan-review Mediums F-005..F-011; the implementer folded
each into the corresponding story notes rather than tracking separately, and
each is reflected in the diff:

- **F-005** — `overviewRalphStatePlugin().transformIndexHtml` fails fast if
  the placeholder script tag is missing (vite.config.ts:116-118).
- **F-006** — Chip trigger has `tabIndex={0}` + `aria-label` +
  `onClick={(e) => e.stopPropagation()}`, no `role="button"`.
- **F-007** — `ralphStageFilter.test.ts` adds positive-coverage tests for
  populated `OverviewRalphState`.
- **F-008** — US-001 atomically exposes `setFilters` from
  `useMultiAxisFilter`, removing the US-007 hook-contract delta.
- **F-009** — `commandListRalphStageChip.test.tsx` provides DOM-level
  assertions for the absent-chip case via
  `[data-task-id="<id>"] .ralph-stage-chip`.
- **F-010** — `progress.txt` (US-005 entry) parses the dev-server URL from
  Vite's stdout rather than hardcoding `127.0.0.1:5173`.
- **F-011** — `loadRalphState()` uses the synthetic-window pattern
  `new Function('window', script)(windowValue)` and returns `NO_RALPH_STATE`
  on ENOENT (testData.ts:16-27).
