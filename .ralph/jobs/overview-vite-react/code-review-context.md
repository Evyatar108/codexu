# Code Review Context — overview-vite-react

Patterns and gotchas discovered during the round-1 code review. Useful for the next reviewer or for fixer agents working on the open findings.

## Baseline parity is the load-bearing contract

The plan repeatedly frames acceptance criteria as "visual + behavioral parity vs `9f81c1f8`". When a finding flags missing behavior that the AC seems to require, always check the baseline first — several external-reviewer findings turned out to match baseline behavior exactly and were therefore not real defects:

- Top-level `RunsLog` section is not in the baseline (`plans/overview.html@9f81c1f8` only injects run-history blocks per-task at line 2495). The plan AC's "Runs log section renders one entry per `OVERVIEW_DATA.runs[*]`" is satisfied by the per-task `RunsLog` rendered inside `TaskCommand` — there is no separate top-level section to render.
- The `<div class="legend">` at `plans/overview.html@9f81c1f8:1075-1085` contains package/risk pills (`happy-app`, `low risk`, etc.), not phase/status swatches. The plan AC text "Legend block renders all phase + status swatches" is internally inconsistent with the baseline — the React port matches baseline reality.
- Baseline kanban filter (`applyFilter()` at `plans/overview.html:2159-2164`) only honors `workstream + text` for `.kanban .card`, deliberately ignoring `taskIdFilter`/status/cadence/size/scope. The React `matchesKanbanFilter` matches baseline exactly. The Copilot finding flagging this as a defect is wrong against baseline.
- Baseline `Esc`-clear-search is wired only on the search input's own `keydown` (`plans/overview.html:2173-2179`), not globally. The React `useKeyboardShortcuts` matches by gating `clearSearch()` behind `inField`. Copilot's "Esc doesn't clear outside the input" finding describes a missing feature not present in baseline either.

When a finding's premise is "this differs from the legacy" but the legacy itself doesn't have that behavior, downgrade to Low or close.

## Real divergences from baseline

The workstream pill on a command row IS a baseline interaction that the port misses. Baseline `injectWorkstreamPills()` at `plans/overview.html:2284-2291` opens the toolbar filter `<details>` and synthetically clicks the corresponding workstream filter chip. The React port's `WorkstreamPill.onClick` only calls `preventDefault + stopPropagation` — a no-op. This is F-001.

## Trusted-HTML boundaries

Six `dangerouslySetInnerHTML` sites are intentional, documented in plan §Trusted-HTML boundaries:

- `Kanban.tsx:62` — `kanbanCardHtml(item)` (operator-authored card body)
- `TaskCommand.tsx:287` — `command?.descriptionHtml`
- `TaskCommand.tsx:208` (`Warning`) — `linkBlockedOnHtml(warning.html, taskIds)`
- `PhaseTree.tsx:20` — raw phase tree node html
- `PhaseTree.tsx:29` — task-ref `trailingHtml`
- `PhaseTree.tsx:45` — phase `headerHtml`
- `StaticSections.tsx:41,45` — static parallelism/dependencies tables (verbatim from `plans/overview.html`)

A seventh trust boundary: `App.tsx:27` `new Function(text)()` re-executes `plans/overview-data.js` over HMR. The plan §Data flow > Dev mode + HMR re-execution mechanism explicitly documents this as option (c) with operator-trusted sidecar. The plugin enforces it via `vite.config.ts` `server.fs.allow` whitelist.

When updating any of these sites: confirm the input is still operator-authored (not user-controlled) and that the new `linkBlockedOnHtml`-style helper escapes regex metacharacters in identifier inputs (the existing helper does this via `escapeRegExp`).

## Forbidden invariants from job CLAUDE.md (encountered during review)

- `plans/overview-data.js` has mixed CRLF/LF inside trusted-HTML strings — `loadOverviewData()` and the inlining `transformIndexHtml` hook treat it as opaque bytes. Do NOT normalize line endings during edits.
- CSS is verbatim ported from `plans/overview.html:6-1060` — no Tailwind, no CSS-in-JS, no reformatting.
- Phase-tree `deferred` class is a deliberate UX deviation from baseline (called out in `README.md` US-007 and `SKILL.md` US-009).
- US-008 destructive swap was already operator-approved per `notepad.md` PERMANENT entry — that gate is closed and recorded.

## External-reviewer noise to watch for

Copilot's prose output includes mid-stream "thinking" narration (e.g., "I'm opening the attachment...") before the actual findings. The scan-reviewer-bullets.sh parser correctly skips non-bullet lines, but a human-reading the raw `copilot-review.txt` should jump to the first `### Completeness` heading.

## Vitest configuration drift

The plan declared `tools/overview-viewer/vitest.config.ts` as a required deliverable. The file is absent but the test suite passes — vitest picks up sensible defaults via the Vite config and the `.tsx` test files. Either ratify the absence in the plan or add the file; this is F-003.

## Round 2 verification (re-review)

All four fixable findings (F-001 through F-004) verified resolved in code:

- **F-001 (WorkstreamPill click):** `WorkstreamPill` now accepts `onActivateWorkstream` (`TaskCommand.tsx:170`) which `App.tsx:66-70` wires to `filter.toggleFilter('workstream', ws)` and opens the `.toolbar-filters` `<details>`. Threaded through `CommandList -> TaskCommand` (no prop drilling skipped).
- **F-002 / F-005 (bulk-copy preamble):** `useBulkSelection.ts:9` invokes `buildCopyCommandText(planPrompt, task.scope)` so per-task scope preambles are now injected.
- **F-003 (vitest.config.ts):** `tools/overview-viewer/vitest.config.ts` exists with `environment: 'node'`, `include: ['src/__tests__/**/*.test.{ts,tsx}']`.
- **F-004 (@types/node):** `tools/overview-viewer/package.json:19` declares `@types/node: '>=20'`.

`F-006` and `F-007` remain `wont_fix` with `9f81c1f8` baseline-parity rationale already recorded in their `resolution` fields — confirmed correct against `plans/overview.html@9f81c1f8:2159-2164` (kanban filter scope) and `:2387-2390` (global Esc handler returns when `inField`).

No new findings emerged in Round 2.

### Minor observations (Low — not added as findings per spec filter)

- `tools/overview-viewer/src/overviewData.ts` declares a `Window.OVERVIEW_DATA` global but is never imported by any module. The global augmentation is still picked up because `tsconfig.json` includes `src/`, so `App.tsx`'s `window.OVERVIEW_DATA` typechecks. Safe today but the file's purpose isn't obvious; either inline the `declare global` into `types.ts` or document the role with a one-line header comment.
- `plans/overview.html` is now the React build artifact (1696 lines, contains the inlined Vite bundle at line 1638). US-008's destructive swap landed and matches `plans/overview.html.next`.
