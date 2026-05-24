# Stories Outline: overview-vite-react

*Preliminary decomposition from `/plan-with-ralph`. Feed to `/implement-with-ralph --from-plan` for PRD generation.*

Worktree: `.worktrees/overview-vite-react/` on branch `ralph/overview-vite-react`.

## US-001: Scaffold workspace package + verify HMR fires
**Description:** As a developer, I want a Vite+React+TS workspace package wired into the monorepo so that `pnpm overview` starts a dev server and HMR reacts to `plans/overview-data.js` edits.

**Acceptance Criteria:**
- [ ] `tools/overview-viewer/` exists with `package.json` (name `@codexu/overview-viewer`, `private: true`, scripts `dev`, `build`, `typecheck`, `test`).
- [ ] `tsconfig.json` set to `strict: true`, `jsx: "react-jsx"`, `moduleResolution: "bundler"`, target ES2022 (NOT extending the expo base).
- [ ] `vite.config.ts` with `base: './'`, `outDir: '../../plans'`, `emptyOutDir: false`, `rollupOptions.input.overview` pointed at `overview.html`, `server.fs.allow: ['../../plans']`, plugins: `react()`, `singleFile()`, custom `overviewDataPlugin()` skeleton.
- [ ] `overview.html` (Vite entry, NOT `index.html`) at the package root with relative `<script src="./overview-data.js">` tag.
- [ ] `src/main.tsx` mounts `<StrictMode><App /></StrictMode>`.
- [ ] `src/App.tsx` reads `window.OVERVIEW_DATA?.tasks?.length` and renders `<h1>{count} tasks</h1>`.
- [ ] `pnpm-workspace.yaml` adds `- "tools/overview-viewer"`.
- [ ] Root `package.json` adds `tools/overview-viewer` to `workspaces.packages` AND scripts `overview`, `overview:build`, `overview:build:preview` (+ `cross-env` devDep).
- [ ] `pnpm install` from repo root succeeds with no new peer-dep warnings.
- [ ] `pnpm overview` starts a dev server on `http://localhost:5173` and displays the task count.
- [ ] Hand-edit `plans/overview-data.js` (e.g., add a dummy task) — browser updates count without full page reload (HMR re-execution via `import.meta.hot.on('overview-data:update')`).
- [ ] Typecheck passes.

**Dependencies:** None
**Estimated complexity:** medium

## US-002: Port CSS styles verbatim
**Description:** As a developer, I want the existing dark+light theme CSS preserved so the React port matches the baseline visually.

**Acceptance Criteria:**
- [ ] `src/styles.css` contains the verbatim `<style>` block contents from `plans/overview.html:6-1060` (CSS custom properties + `@media (prefers-color-scheme: light)` overrides + all rules).
- [ ] No edits, no Tailwind, no CSS-in-JS, no reformatting.
- [ ] `src/main.tsx` imports `./styles.css`.
- [ ] Dev server renders the hello-world page with correct dark theme by default and light theme when system preference is light.
- [ ] Typecheck passes.

**Dependencies:** US-001
**Estimated complexity:** small

## US-003: Port command list (rows, badges, copy, warnings, spawned, workstream)
**Description:** As an operator, I want the command-list section (one row per task) to render with status badges, scope chips, copy buttons, bulk-select checkboxes, workstream pills with cadence + datasets, warnings, and spawned-from / spawned-children relationships — preserving the exact visual baseline from `9f81c1f8`.

**Acceptance Criteria:**
- [ ] Components implemented: `TaskCommand`, `StatusBadge`, `ScopeChip`, `CopyNameButton`, `CopyCommandButton`, `BulkSelectCheckbox`, `WorkstreamPill` (including cadence chip + datasets), `Warning` (with `linkBlockedOn` link conversion), `SpawnedFromPill`, `SpawnedChildren`.
- [ ] Hooks: `usePersistentExpanded` (reads/writes localStorage key `codexu-overview-details-state-v2`), `useTaskClassification` (mirrors `classifyAndOrderCmds` from overview.html).
- [ ] Data: `src/data/copyPreambles.ts` ports `BOOKKEEPING_PREAMBLE` + other scope preambles verbatim from `plans/overview.html:1725-1761`.
- [ ] Command list renders one `TaskCommand` row per task in `OVERVIEW_DATA.tasks` (49 currently).
- [ ] `CopyCommandButton` writes byte-for-byte identical output vs today's `copyCommand()` (snapshot-tested in `src/__tests__/copyPreamble.test.ts`).
- [ ] `<details>` open state persists across HMR and across page reloads via the `usePersistentExpanded` hook.
- [ ] Typecheck and unit tests pass.

**Dependencies:** US-002
**Estimated complexity:** large

## US-004: Port kanban
**Description:** As an operator, I want the kanban columns (`ready`, `soon`, `blocked`) populated from `task.kanbanCards[]` with correct multi-card ordering and inline-style support.

**Acceptance Criteria:**
- [ ] Components: `KanbanColumn`, `KanbanCard` (including `injectKanbanPhasePills` inline phase pill, `linkKanbanToCmds` onClick jump to `#cmd-*`).
- [ ] Utility: `src/utils/kanbanOrdering.ts` ports the algorithm verbatim from `plans/overview.html:1315-1337` (numeric `order` ASC > `insertBeforeTaskId` fallback).
- [ ] Utility: `src/utils/inlineStyleParser.ts` converts `card.inlineStyle` CSS strings to a `Record<string,string>` style object (multiple declarations, `var(--*)` references, vendor prefixes).
- [ ] Total card count equals today's count (33 currently).
- [ ] Multi-card-same-column scenario (e.g., 'soon' has 3 cards) renders in correct order — unit-tested in `src/__tests__/kanbanOrdering.test.ts`.
- [ ] `#cmd-foo` hash navigation triggered by clicking a kanban card scrolls to and expands the matching task row.
- [ ] Typecheck and unit tests pass.

**Dependencies:** US-002 (parallel-ok with US-003 in terms of file footprint, but project keeps serial order to keep App.tsx mounting clean)
**Estimated complexity:** medium

## US-005: Port phase tree with deferred-class derivation
**Description:** As an operator, I want the phase-tree section rendered from `OVERVIEW_DATA.phaseTree` with task-ref state derived from `task.phase` AND `task.status` — adding the `deferred` class for `blocked|paused` (a deliberate UX improvement over baseline 9f81c1f8).

**Acceptance Criteria:**
- [ ] Components: `PhaseTree`, `PhaseTreeNode`.
- [ ] State derivation: `shipped → donefade`, `closed → closed`, `task.status === "blocked" || task.status === "paused" → deferred`, else → `open`. Legacy `state` fields on task-refs in shipped data are ignored.
- [ ] One block per entry in `OVERVIEW_DATA.phaseTree` (7 currently); each block contains its child task-refs.
- [ ] Trusted-HTML fragments (`raw.html`, `trailingHtml`) rendered via `dangerouslySetInnerHTML`.
- [ ] Documented in `tools/overview-viewer/README.md` (created in US-007) and SKILL.md viewing subsection (US-009) as an intentional improvement over baseline.
- [ ] Unit-tested in `src/__tests__/phaseTreeDerivation.test.ts`.
- [ ] Typecheck passes.

**Dependencies:** US-002
**Estimated complexity:** small

## US-006: Port runs log + TodayPanel + top-level surfaces (toolbar, freshness, whats-new, keyboard help, static sections)
**Description:** As an operator, I want the Today panel, runs log, sticky toolbar with filter chips, freshness hint, what's-new-since-last-visit banner, keyboard-help modal, and the static Parallelism/Dependencies/Footnote sections rendered with parity to `plans/overview.html`.

**Acceptance Criteria:**
- [ ] Components: `RunsLog` (with `injectRunHistory` per-task command-body rendering), `TodayPanel` (4 buckets: `Running` / `Ready` brainstorm-then-ready / `On hold` paused-then-blocked / `Recently shipped (7d)` footer — matches `plans/overview.html:988-995` and `:1851-1925`), `Toolbar`, `FilterChips` (5 axes: status / workstream / cadence / size / scope), `BulkCopyButton`, `KeyboardHelp` (dialog + backdrop, toggled by `?`), `FreshnessHint`, `WhatsNewBanner`, `ParallelismSection` (static JSX from `plans/overview.html:1134-1205`), `DependenciesSection` (static JSX from `:1207-1266`), `Footnote` (static JSX from `:1268-1277`), `Legend`, `UrlFilterBanner`, `SearchInput`, `Layout`.
- [ ] Hooks: `useMultiAxisFilter` (encapsulates `applyFilter()` from `plans/overview.html:2125-2200`), `useKeyboardShortcuts` (`/` focus search, `Esc` clear/close, `e`/`c` expand/collapse all, `?` toggle help; matches `:2370-2395`), `useWhatsNewSinceLastVisit` (changed-set + max-of-data save semantics, mirrors IIFE at `:2544-2653`; uses localStorage `codexu-overview-last-visit-v1`), `useUrlFilter` (`?tasks=foo,bar`), `useHashNav` (`#cmd-*`), `useBulkSelection`.
- [ ] Today panel shows the 4 buckets in the documented order and visual format.
- [ ] Runs log renders one entry per `OVERVIEW_DATA.runs[*]` (17 currently).
- [ ] Search input + 5-axis filter chips work; clearing chips returns unfiltered view.
- [ ] `BulkCopyButton` disabled with 0 selected; "Copy N selected" label and concatenated clipboard output when N ≥ 1.
- [ ] `KeyboardHelp` opens/closes via `?` and `Esc`; all 5 shortcuts function.
- [ ] `FreshnessHint` renders short SHA from `generatedFromCommit` + relative timestamp.
- [ ] `WhatsNewBanner` appears beneath Today panel when any task `lastTouched` > localStorage `codexu-overview-last-visit-v1`; per-row `NEW` badges added; "Mark all seen" dismisses + writes max-of-(wall-clock, max `lastTouched`) ISO timestamp. First-visit-on-machine path stores silently without banner.
- [ ] `ParallelismSection`, `DependenciesSection`, `Footnote` render the static content verbatim from the source line ranges as `<details>` (collapsible where the source uses `<details>`).
- [ ] `?tasks=foo,bar` URL filter works; `#cmd-foo` hash nav works.
- [ ] Unit-tested in `src/__tests__/urlFilter.test.ts`.
- [ ] Typecheck and unit tests pass.

**Dependencies:** US-003, US-004, US-005 (App.tsx layout assembles all sections)
**Estimated complexity:** large

## US-007: Wire static build + author contributor README
**Description:** As an operator, I want `pnpm overview:build:preview` to emit `plans/overview.html.next` so I can review parity vs the live `plans/overview.html` before approving the destructive swap in US-008. The contributor README must be in place for that review.

**Acceptance Criteria:**
- [ ] `vite-plugin-singlefile` added to deps; `vite.config.ts` `base: './'` confirmed; `rollupOptions.input.overview: resolve(__dirname, 'overview.html')` confirmed.
- [ ] Custom `overviewDataPlugin` implements:
  - `configureServer` — middleware for `/overview-data.js` + `server.watcher.add(absSidecarPath)` + `server.watcher.on('change')` → `server.ws.send({type:'custom', event:'overview-data:update'})`.
  - `transformIndexHtml` with `enforce: 'pre'` — build-only branch reads `plans/overview-data.js` from disk and inlines as `<script>...</script>`, replacing the relative `<script src="./overview-data.js">` tag BEFORE `vite-plugin-singlefile` runs.
  - `closeBundle` — if `process.env.OVERVIEW_BUILD_SAFE_NAME === '1'`, rename emitted `plans/overview.html` to `plans/overview.html.next`.
- [ ] `pnpm overview:build:preview` (env `OVERVIEW_BUILD_SAFE_NAME=1` via `cross-env`) emits `plans/overview.html.next`; live `plans/overview.html` untouched.
- [ ] The artifact opens via OS double-click (`file://`) and renders identically to the dev server (modulo HMR).
- [ ] No 404s in DevTools Network tab; no external script references.
- [ ] `grep -c 'window.OVERVIEW_DATA' plans/overview.html.next` ≥ 1; `grep -c 'src=.\?overview-data.js' plans/overview.html.next` == 0 (the sidecar is inlined, not externally referenced).
- [ ] `tools/overview-viewer/README.md` is authored in this stage (NOT stage 9), covering: file layout, dev workflow (`pnpm overview`), build workflow (`pnpm overview:build:preview` for safe, `pnpm overview:build` for live), the phase-tree deferred-class deliberate deviation, the safe-name vs destructive build distinction. Reviewer must be able to read this before approving US-008.
- [ ] Typecheck passes.

**Dependencies:** US-006
**Estimated complexity:** medium

## US-008: Replace static HTML (destructive)
**Description:** As an operator, after approving US-007's parity output, I want `pnpm overview:build` (no env flag) to replace `plans/overview.html` directly with the React build.

**⚠️ GATED ON MANUAL OPERATOR APPROVAL of US-007 output.**

**Acceptance Criteria:**
- [ ] Operator has reviewed `plans/overview.html.next` (from US-007) and approved its parity vs the live `plans/overview.html` (modulo phase-tree `deferred` class addition).
- [ ] Existing `plans/overview.html` is deleted.
- [ ] `pnpm overview:build` (no env flag, so `closeBundle` rename is a no-op) emits the inlined artifact directly to `plans/overview.html`.
- [ ] Acceptance: visual parity vs the 9f81c1f8 baseline (modulo the deferred-class addition from US-005).
- [ ] Other `plans/*.md` files are untouched (`emptyOutDir: false`).
- [ ] Cross-package typecheck for other packages stays green.

**Dependencies:** US-007 + manual operator approval
**Estimated complexity:** small

## US-009: Docs sweep (SKILL.md + root README)
**Description:** As a bookkeeper, I want the roadmap-and-overview skill and root README updated to point at the new dev-server URL and build command.

**Acceptance Criteria:**
- [ ] `.agents/skills/roadmap-and-overview/SKILL.md` viewing subsection additively updated to include: dev-server URL `http://localhost:5173`, `pnpm overview:build` command, and a note on the phase-tree `deferred` class deviation. **Do NOT** rewrite the bookkeeper editing procedures — plan #2 already did that.
- [ ] Root `README.md` has a new "Roadmap viewer" subsection under the existing Roadmap section, with `pnpm overview` (dev) and `pnpm overview:build` (static) commands.
- [ ] `tools/overview-viewer/README.md` was already created in US-007 — this story does NOT touch it.
- [ ] Typecheck passes (no code changes; docs only).

**Dependencies:** US-008
**Estimated complexity:** small
