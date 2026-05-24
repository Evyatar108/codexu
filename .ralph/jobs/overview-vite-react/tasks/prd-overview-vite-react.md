# PRD: Overview Viewer — Vite + React Port

## Introduction

Add a new pnpm workspace package `tools/overview-viewer/` (Vite + React 18+ + TypeScript) that consumes the shipped `plans/overview-data.js` global and renders the same UI as `plans/overview.html` does today — with two execution modes:

- **`pnpm overview` (dev):** Vite dev server on `http://localhost:5173`, custom HMR plugin watches `plans/overview-data.js`, React diff updates without a full page reload while preserving expanded `<details>`, scroll position, search filter, and bulk-select state.
- **`pnpm overview:build` (static):** Emits a singleFile-inlined `plans/overview.html` that replaces today's static viewer and remains usable via `file://` double-click.

The work is staged in 9 atomic sub-commits, the last of which is destructive (deletes the existing `plans/overview.html` and replaces it with the build artifact); stages 1–7 must be reviewed in dev mode before stage 8 fires. A safe-name preview at `plans/overview.html.next` (emitted by stage 7) gates the destructive swap.

Plans #1 (`task-phases`) and #2 (`overview-data-split`, at commit `9f81c1f8`) have already shipped on 2026-05-17 and define every contract this plan relies on. This is plan #3 of three siblings; no further preconditions remain.

## Goals

- Build a data-driven React rewrite (not a DOM-effect wrapper around `applyEnrichments()`).
- Preserve visual parity with the `9f81c1f8` baseline (modulo one deliberate UX improvement: phase-tree `deferred` class for `blocked|paused`).
- Maintain `file://` double-click compatibility for the static build artifact.
- Provide HMR live-update on `plans/overview-data.js` edits without losing UI state.
- Land the change as 9 reviewable atomic stages with a manual operator gate before the destructive swap.
- Stay green: TS strict, vitest unit tests, cross-package typecheck.

## User Stories

### US-001: Scaffold workspace package + verify HMR fires
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
- [ ] Verify in browser using dev-browser skill.

### US-002: Port CSS styles verbatim
**Description:** As a developer, I want the existing dark+light theme CSS preserved so the React port matches the baseline visually.

**Acceptance Criteria:**
- [ ] `src/styles.css` contains the verbatim `<style>` block contents from `plans/overview.html:6-1060` (CSS custom properties + `@media (prefers-color-scheme: light)` overrides + all rules).
- [ ] No edits, no Tailwind, no CSS-in-JS, no reformatting.
- [ ] `src/main.tsx` imports `./styles.css`.
- [ ] Dev server renders the hello-world page with correct dark theme by default and light theme when system preference is light.
- [ ] Typecheck passes.
- [ ] Verify in browser using dev-browser skill.

### US-003: Port command list (rows, badges, copy, warnings, spawned, workstream)
**Description:** As an operator, I want the command-list section (one row per task) to render with status badges, scope chips, copy buttons, bulk-select checkboxes, workstream pills with cadence + datasets, warnings, and spawned-from / spawned-children relationships — preserving the exact visual baseline from `9f81c1f8`.

**Acceptance Criteria:**
- [ ] Components implemented: `TaskCommand`, `StatusBadge`, `ScopeChip`, `CopyNameButton`, `CopyCommandButton`, `BulkSelectCheckbox`, `WorkstreamPill` (including cadence chip + datasets), `Warning` (with `linkBlockedOn` link conversion), `SpawnedFromPill`, `SpawnedChildren`.
- [ ] Hooks: `usePersistentExpanded` (reads/writes localStorage key `codexu-overview-details-state-v2`), `useTaskClassification` (mirrors `classifyAndOrderCmds` from overview.html).
- [ ] Data: `src/data/copyPreambles.ts` ports `BOOKKEEPING_PREAMBLE` + other scope preambles verbatim from `plans/overview.html:1725-1761`.
- [ ] Command list renders one `TaskCommand` row per task in `OVERVIEW_DATA.tasks` (49 currently); row count equals `OVERVIEW_DATA.tasks.length`.
- [ ] `CopyCommandButton` writes byte-for-byte identical output vs today's `copyCommand()` (snapshot-tested in `src/__tests__/copyPreamble.test.ts`).
- [ ] `<details>` open state persists across HMR and across page reloads via the `usePersistentExpanded` hook.
- [ ] `WorkstreamPill` renders workstream label + cadence chip + size/cadence datasets + kanban `data-workstream` attribute (matches the full `injectWorkstreamPills()` behavior, not just the label).
- [ ] Trusted-HTML fragments (`command.descriptionHtml`, `command.warnings[].html`) rendered via `dangerouslySetInnerHTML`; CRLF/LF bytes preserved (no normalization).
- [ ] Typecheck passes; `pnpm --filter @codexu/overview-viewer test` exits 0.
- [ ] Verify in browser using dev-browser skill.

### US-004: Port kanban
**Description:** As an operator, I want the kanban columns (`ready`, `soon`, `blocked`) populated from `task.kanbanCards[]` with correct multi-card ordering and inline-style support.

**Acceptance Criteria:**
- [ ] Components: `KanbanColumn`, `KanbanCard` (including `injectKanbanPhasePills` inline phase pill, `linkKanbanToCmds` onClick jump to `#cmd-*`).
- [ ] Utility: `src/utils/kanbanOrdering.ts` ports the algorithm verbatim from `plans/overview.html:1315-1337` (numeric `order` ASC > `insertBeforeTaskId` fallback).
- [ ] Utility: `src/utils/inlineStyleParser.ts` converts `card.inlineStyle` CSS strings to a `Record<string,string>` style object (handles multiple declarations, `var(--*)` references, vendor prefixes).
- [ ] Total card count equals today's count (33 currently).
- [ ] Multi-card-same-column scenario (e.g., 'soon' has 3 cards) renders in correct order — unit-tested in `src/__tests__/kanbanOrdering.test.ts`.
- [ ] `#cmd-foo` hash navigation triggered by clicking a kanban card scrolls to and expands the matching task row.
- [ ] Trusted-HTML fragment `kanbanCards[].html` rendered via `dangerouslySetInnerHTML`.
- [ ] Typecheck passes; `pnpm --filter @codexu/overview-viewer test` exits 0.
- [ ] Verify in browser using dev-browser skill.

### US-005: Port phase tree with deferred-class derivation
**Description:** As an operator, I want the phase-tree section rendered from `OVERVIEW_DATA.phaseTree` with task-ref state derived from `task.phase` AND `task.status` — adding the `deferred` class for `blocked|paused` (a deliberate UX improvement over baseline 9f81c1f8).

**Acceptance Criteria:**
- [ ] Components: `PhaseTree`, `PhaseTreeNode`.
- [ ] State derivation: `shipped → donefade`, `closed → closed`, `task.status === "blocked" || task.status === "paused" → deferred`, else → `open`. Legacy `state` fields on task-refs in shipped data are ignored.
- [ ] One block per entry in `OVERVIEW_DATA.phaseTree` (7 currently); each block contains its child task-refs.
- [ ] Trusted-HTML fragments (`raw.html`, `trailingHtml`) rendered via `dangerouslySetInnerHTML`.
- [ ] Documented in `tools/overview-viewer/README.md` (created in US-007) and SKILL.md viewing subsection (US-009) as an intentional improvement over baseline.
- [ ] Unit-tested in `src/__tests__/phaseTreeDerivation.test.ts`.
- [ ] Typecheck passes; `pnpm --filter @codexu/overview-viewer test` exits 0.
- [ ] Verify in browser using dev-browser skill.

### US-006: Port runs log + TodayPanel + top-level surfaces (toolbar, freshness, whats-new, keyboard help, static sections)
**Description:** As an operator, I want the Today panel, runs log, sticky toolbar with filter chips, freshness hint, what's-new-since-last-visit banner, keyboard-help modal, and the static Parallelism/Dependencies/Footnote sections rendered with parity to `plans/overview.html`.

**Acceptance Criteria:**
- [ ] Components: `RunsLog` (with `injectRunHistory` per-task command-body rendering), `TodayPanel` (4 buckets: `Running` / `Ready` brainstorm-then-ready / `On hold` paused-then-blocked / `Recently shipped (7d)` footer — matches `plans/overview.html:988-995` and `:1851-1925`), `Toolbar`, `FilterChips` (5 axes: status / workstream / cadence / size / scope), `BulkCopyButton`, `KeyboardHelp` (dialog + backdrop, toggled by `?`), `FreshnessHint`, `WhatsNewBanner`, `ParallelismSection` (static JSX from `plans/overview.html:1134-1205`), `DependenciesSection` (static JSX from `:1207-1266`), `Footnote` (static JSX from `:1268-1277`), `Legend`, `UrlFilterBanner`, `SearchInput`, `Layout`.
- [ ] Hooks: `useMultiAxisFilter` (encapsulates `applyFilter()` from `plans/overview.html:2125-2200`), `useKeyboardShortcuts` (`/` focus search, `Esc` clear/close, `e`/`c` expand/collapse all, `?` toggle help; matches `:2370-2395`), `useWhatsNewSinceLastVisit` (changed-set + max-of-data save semantics, mirrors IIFE at `:2544-2653`; uses localStorage `codexu-overview-last-visit-v1`), `useUrlFilter` (`?tasks=foo,bar`), `useHashNav` (`#cmd-*`), `useBulkSelection`.
- [ ] Today panel shows the 4 buckets in the documented order and visual format.
- [ ] Runs log renders one entry per `OVERVIEW_DATA.runs[*]` (17 currently).
- [ ] Search input + 5-axis filter chips work; clearing chips returns unfiltered view.
- [ ] `BulkCopyButton` disabled with 0 selected; "Copy N selected" label and concatenated clipboard output (in `data-task-id` order) when N ≥ 1.
- [ ] `KeyboardHelp` opens/closes via `?` and `Esc`; all 5 shortcuts function (`/` focus search, `Esc` clear search / close help, `e` expand all, `c` collapse all, `?` toggle help).
- [ ] `FreshnessHint` renders short SHA from `generatedFromCommit` + relative timestamp ("snapshot N h/d ago" derived from `generatedAt`).
- [ ] `WhatsNewBanner` appears beneath Today panel when any task `lastTouched` > localStorage `codexu-overview-last-visit-v1`; per-row `NEW` badges added (class `cmd-changed`); "Mark all seen" dismisses + writes max-of-(wall-clock, max `lastTouched`) ISO timestamp. First-visit-on-machine path stores silently without banner.
- [ ] `ParallelismSection`, `DependenciesSection`, `Footnote` render the static content verbatim from the source line ranges; collapsible where the source uses `<details>`.
- [ ] `Legend` block (`section.sec-legend`) renders all phase + status swatches verbatim from `plans/overview.html:1067-1132`.
- [ ] `?tasks=foo,bar` URL filter works (comma-separated; matches `parseTaskIdFilter()` semantics); `UrlFilterBanner` renders when query is present.
- [ ] `#cmd-foo` hash navigation scrolls to and expands the matching task.
- [ ] Unit-tested in `src/__tests__/urlFilter.test.ts`.
- [ ] React StrictMode in dev does not produce duplicate event subscriptions (verified by repeated data-file edits).
- [ ] Typecheck passes; `pnpm --filter @codexu/overview-viewer test` exits 0.
- [ ] Verify in browser using dev-browser skill.

### US-007: Wire static build + author contributor README
**Description:** As an operator, I want `pnpm overview:build:preview` to emit `plans/overview.html.next` so I can review parity vs the live `plans/overview.html` before approving the destructive swap in US-008. The contributor README must be in place for that review.

**Acceptance Criteria:**
- [ ] `vite-plugin-singlefile` added to deps; `vite.config.ts` `base: './'` confirmed; `rollupOptions.input.overview: resolve(__dirname, 'overview.html')` confirmed.
- [ ] Custom `overviewDataPlugin` implements all three hooks:
  - `configureServer` — middleware for GET `/overview-data.js` (streams `../../plans/overview-data.js` with Content-Type `application/javascript`) + `server.watcher.add(absSidecarPath)` + `server.watcher.on('change', file => { if (file === absSidecarPath) server.ws.send({type:'custom', event:'overview-data:update'}); })`.
  - `transformIndexHtml` with `enforce: 'pre'` — build-only branch reads `plans/overview-data.js` from disk and inlines as `<script>...</script>`, replacing the relative `<script src="./overview-data.js">` tag BEFORE `vite-plugin-singlefile` runs.
  - `closeBundle` — if `process.env.OVERVIEW_BUILD_SAFE_NAME === '1'`, rename emitted `plans/overview.html` to `plans/overview.html.next`.
- [ ] `pnpm overview:build:preview` (env `OVERVIEW_BUILD_SAFE_NAME=1` via `cross-env`) emits `plans/overview.html.next`; live `plans/overview.html` untouched.
- [ ] The artifact opens via OS double-click (`file://`) and renders identically to the dev server (modulo HMR).
- [ ] No 404s in DevTools Network tab; no external script references.
- [ ] `grep -c 'window.OVERVIEW_DATA' plans/overview.html.next` ≥ 1; no `<script src="…overview-data.js">` reference remains in the artifact.
- [ ] `?tasks=` URL filter works in the static build; `#cmd-*` hash nav works in the static build.
- [ ] `tools/overview-viewer/README.md` is authored in this stage (NOT stage 9), covering: file layout, dev workflow (`pnpm overview`), build workflow (`pnpm overview:build:preview` for safe, `pnpm overview:build` for live), the phase-tree deferred-class deliberate deviation, the safe-name vs destructive build distinction. Reviewer must be able to read this before approving US-008.
- [ ] Typecheck passes; `pnpm --filter @codexu/overview-viewer build` exits 0.
- [ ] Verify the safe-name artifact in browser using dev-browser skill (open via `file://`).

### US-008: Replace static HTML (destructive)
**Description:** As an operator, after approving US-007's parity output, I want `pnpm overview:build` (no env flag) to replace `plans/overview.html` directly with the React build.

**⚠️ GATED ON MANUAL OPERATOR APPROVAL of US-007 output.** The iteration agent must surface this gate and pause for explicit operator approval of `plans/overview.html.next` before deleting the live file.

**Acceptance Criteria:**
- [ ] Operator has reviewed `plans/overview.html.next` (from US-007) and approved its parity vs the live `plans/overview.html` (modulo phase-tree `deferred` class addition). **The iteration agent MUST NOT proceed without recorded operator approval.**
- [ ] Existing `plans/overview.html` is deleted.
- [ ] `pnpm overview:build` (no env flag, so `closeBundle` rename is a no-op) emits the inlined artifact directly to `plans/overview.html`.
- [ ] Visual parity vs the 9f81c1f8 baseline (modulo the deferred-class addition from US-005).
- [ ] Other `plans/*.md` files are untouched (`emptyOutDir: false`).
- [ ] Cross-package typecheck for other packages (happy-app, codium, etc.) stays green.
- [ ] Verify the live artifact in browser using dev-browser skill (open via `file://`).

### US-009: Docs sweep (SKILL.md + root README)
**Description:** As a bookkeeper, I want the roadmap-and-overview skill and root README updated to point at the new dev-server URL and build command.

**Acceptance Criteria:**
- [ ] `.agents/skills/roadmap-and-overview/SKILL.md` viewing subsection additively updated to include: dev-server URL `http://localhost:5173`, `pnpm overview:build` command, and a note on the phase-tree `deferred` class deviation. **Do NOT** rewrite the bookkeeper editing procedures — plan #2 already did that.
- [ ] Root `README.md` has a new "Roadmap viewer" subsection under the existing Roadmap section, with `pnpm overview` (dev) and `pnpm overview:build` (static) commands.
- [ ] `tools/overview-viewer/README.md` was already created in US-007 — this story does NOT touch it.
- [ ] Typecheck passes (no code changes; docs only).

## Functional Requirements

- FR-1: Register `tools/overview-viewer/` as a pnpm workspace package in BOTH `pnpm-workspace.yaml` AND root `package.json` → `workspaces.packages`.
- FR-2: Provide root scripts `overview` (dev), `overview:build` (live destructive build), `overview:build:preview` (safe-name preview build).
- FR-3: Dev server serves `plans/overview-data.js` via a custom Vite middleware (under path `/overview-data.js`); `server.fs.allow` must whitelist `../../plans`.
- FR-4: HMR re-execution mechanism on data-file change MUST follow option (c): plugin watches the absolute sidecar path; on change, sends a custom WS event `overview-data:update`; client-side `useOverviewData` hook subscribes via `import.meta.hot.on(...)` and refreshes by cache-busted fetch + `new Function(text)()` re-evaluation, then calls the `useSyncExternalStore` notify.
- FR-5: Build mode inlines `plans/overview-data.js` via `transformIndexHtml` (`enforce: 'pre'`) BEFORE `vite-plugin-singlefile` runs; the emitted HTML must be self-contained.
- FR-6: Vite entry HTML is `tools/overview-viewer/overview.html` (NOT `index.html`); sidecar reference MUST be relative (`./overview-data.js`), never absolute (`/overview-data.js`).
- FR-7: All 13 enrichment passes from `applyEnrichments()` (`plans/overview.html:2524-2539`) ported as React components/hooks: `renderPhaseBadges`, `injectTaskScopeChips`, `classifyAndOrderCmds`, `injectCopyNameButtons`, `injectCheckboxes`, `injectWorkstreamPills`, `injectKanbanPhasePills`, `linkBlockedOn`, `linkKanbanToCmds`, `injectSpawnRelationships`, `injectRunHistory`, `buildTodayPanel`, `populateKanbanCount`, plus `applyFilter`.
- FR-8: Top-level behaviors outside `applyEnrichments()` also ported: what's-new-since-last-visit banner + `NEW` row badges + dismiss; freshness hint (short SHA + relative timestamp); keyboard-help modal + global shortcuts (`/`, `Esc`, `e`, `c`, `?`); multi-axis filter toolbar (5 axes); URL filter banner (`?tasks=...`); hash nav (`#cmd-*`); static `ParallelismSection`, `DependenciesSection`, `Footnote`.
- FR-9: Phase-tree state derivation: `shipped → donefade`, `closed → closed`, `task.status === "blocked"|"paused" → deferred`, else → `open`. Legacy `state` fields on task-refs are ignored.
- FR-10: localStorage keys preserved verbatim: `codexu-overview-details-state-v2`, `codexu-overview-last-visit-v1`, `codexu-overview-notes-v1`.
- FR-11: CSS tokens and rules ported byte-for-byte from `plans/overview.html:6-1060` into `src/styles.css` (no Tailwind, no CSS-in-JS, no reformatting).
- FR-12: TS strict mode with `jsx: "react-jsx"`, `moduleResolution: "bundler"`, ES2022; package does NOT extend the expo base.
- FR-13: Vitest unit tests for: `kanbanOrdering`, `phaseTreeDerivation`, `urlFilter`, `copyPreamble`.
- FR-14: CRLF/LF byte sequences in trusted-HTML strings MUST NOT be normalized; Copy-Command output must be byte-for-byte identical to today's `copyCommand()`.
- FR-15: Stage 8 is destructive and gated on explicit operator approval of `plans/overview.html.next` from stage 7. The iteration agent MUST surface this gate and pause.

## Non-Goals

- Inline editing of `plans/overview-data.js` from the browser.
- Drag-and-drop kanban reordering.
- WebSocket multi-operator collaboration.
- Replacing `tools/render-roadmap.ts` (different pattern; orthogonal).
- Mobile redesign / responsive overhaul beyond what `plans/overview.html` already does.
- Tightening trusted-HTML sites to structured tokens (future work — `command.descriptionHtml`, `warnings[].html`, `trailingHtml` remain `dangerouslySetInnerHTML` in v1).
- Rewriting bookkeeper editing procedures in SKILL.md (plan #2 already did that — only the viewing subsection gets an additive update here).
- `?q=` URL-backed search state (rejected during plan review F-011; React state is sufficient since the controlled input stays mounted across HMR).

## Design Considerations

- **Worktree:** `.worktrees/overview-vite-react/` on branch `ralph/overview-vite-react` (per `plans/parallel-assignments.md:13-15`).
- **React+Vite precedent:** `packages/codium/electron.vite.config.ts` is the closest existing reference (React 19, `@vitejs/plugin-react`, Vite 8).
- **TS strict precedent:** `packages/happy-app/tsconfig.json` — but do NOT extend the expo base in the new package.
- **`file://` compatibility:** non-negotiable. `base: './'`, no network requests, no web fonts, no external CSS, no API calls. `vite-plugin-singlefile` inlines everything in the module graph; the custom plugin handles the external sidecar separately.
- **External data file:** `plans/overview-data.js` lives at `../../plans/overview-data.js` relative to `tools/overview-viewer/vite.config.ts`. Requires `server.fs.allow: ['../../plans']` and explicit `server.watcher.add()`.
- **Trusted-HTML boundaries:** six sites use `dangerouslySetInnerHTML` — `kanbanCards[].html`, `command.descriptionHtml`, `command.warnings[].html`, `phaseTree raw.html`, `phaseTree task-ref.trailingHtml`. (`card.inlineStyle` is a CSS string, not HTML — parse to a style object via `inlineStyleParser.ts`.)
- **React StrictMode + HMR:** `useSyncExternalStore` cleanup must be idempotent; HMR subscription must not leak across reruns.

## Technical Considerations

- **Workspace registration:** must update BOTH `pnpm-workspace.yaml` AND root `package.json` → `workspaces.packages` (the monorepo enumerates packages in both files).
- **`@codexu/*` scope** is unused in the repo and free for this package.
- **Forward-compat fields** (`planSource`, `planSourceRef`, `planJobId`, `brainstormPrompt`) are typed `string | null | undefined`; components must render nothing rather than crash when absent.
- **`phaseTree.task-ref` legacy `state` fields** exist in shipped data even though the renderer ignores them — TS schema marks `state?` optional; React renderer must ignore.
- **Line endings** in `plans/overview-data.js` are MIXED `\r\n` and `\n` (the original feature request said pure CRLF — outdated). Implementation must NOT normalize.
- **`mergeCommit` populated count** is currently 8 (feature request said 6 — outdated). Schema must allow it.
- **No root ESLint config** — keep ESLint optional (package-local if used).
- **vitest version** — repo precedent is `^3.2.4` per `packages/happy-wire/package.json:54,68`; bump only if needed for compatibility.

## Success Metrics

- `pnpm overview` starts a dev server on `http://localhost:5173` and renders the full overview against the shipped `plans/overview-data.js`.
- Hand-editing one task's `phase` in `plans/overview-data.js` updates both the command-row badge AND the phase-tree state class without a full page reload, while preserving expanded `<details>`, scroll position, and search input value.
- `pnpm overview:build:preview` emits `plans/overview.html.next` that opens via OS double-click and renders identically to dev (DevTools shows zero network requests).
- After operator approval, `pnpm overview:build` replaces `plans/overview.html` with the inlined React build; cross-package typecheck stays green.
- All four unit tests (`kanbanOrdering`, `phaseTreeDerivation`, `urlFilter`, `copyPreamble`) pass.

## Open Questions

All three pre-review ambiguities were resolved during plan review:
1. ✅ Copy behavior: match current preamble-injected copy (verified byte-for-byte against today's `copyCommand()`).
2. ✅ Phase-tree state: add `deferred` class for `blocked|paused` (deliberate UX improvement over baseline 9f81c1f8).
3. ✅ Workspace registration: update both `pnpm-workspace.yaml` and root `package.json` → `workspaces.packages`.

One non-blocking optional refinement remains open from plan review:
- **F-012 (Simplicity, optional):** Consider an interstitial "pure-logic utilities" stage between US-002 and US-003 that lands `src/utils/kanbanOrdering.ts`, `src/utils/inlineStyleParser.ts`, and `src/data/*.ts` (plus their `vitest` tests) before the UI components. This is implementer's call — the staged plan tolerates either order.

## Risk Areas

1. **Stage 8 is destructive.** Deleting `plans/overview.html` is irreversible without git revert. Mitigation: stage 7 emits to `plans/overview.html.next` for parity review; only stage 8 swaps the filename. Operator must approve stages 1–7 before stage 8 fires.
2. **`base: './'` is mandatory.** Forgetting it produces absolute asset URLs that 404 under `file://`.
3. **CRLF/LF mixing in HTML strings.** TS code must read these as opaque strings (no normalization, no template-literal reformatting). Copy-Command output must preserve the exact byte sequence.
4. **React StrictMode + HMR subscription leak.** `useSyncExternalStore` `subscribe` must return a cleanup that idempotently removes the listener.
5. **`card.inlineStyle` parsing.** Raw CSS strings cannot be passed to React `style={}`. Implement `inlineStyleParser.ts` that converts to a `Record<string,string>`.
6. **`injectWorkstreamPills()` is broader than its name.** WorkstreamPill must absorb the full current behavior: workstream label, cadence chip, size/cadence datasets, kanban `data-workstream` attribute.
7. **Phase-tree behavior change.** Adding `deferred` class for `blocked|paused` is a visible deviation from `9f81c1f8`. AC explicitly calls this out; SKILL.md viewing subsection should mention it.
8. **Forward-compat fields.** `planSource`, `planSourceRef`, `planJobId`, `brainstormPrompt` are typed `string | null | undefined`; components must render nothing rather than crash when absent.
9. **Copy preamble fidelity.** `BOOKKEEPING_PREAMBLE` and other scope preambles must be ported verbatim from `plans/overview.html:1725-1761`. Snapshot test asserts clipboard text is byte-for-byte equal to today's output.
10. **External file outside project root.** Vite `server.fs.allow` + custom watcher; if misconfigured, dev server either 403s or fails to re-render on edit.
11. **Sidecar inlining at build time.** `vite-plugin-singlefile` only inlines assets in Vite's module graph; an external `<script src="./overview-data.js">` tag is NOT inlined automatically. The custom plugin's `transformIndexHtml` hook (with `enforce: 'pre'`, build-only branch) must read the file from disk and substitute inline before singleFile runs.
12. **Script-tag path under `file://`.** The tag in `overview.html` must be relative (`./overview-data.js`). An absolute path (`/overview-data.js`) resolves to the filesystem root under `file://` and 404s.
