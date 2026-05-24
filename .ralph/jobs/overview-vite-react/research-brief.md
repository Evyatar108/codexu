# Research Brief: overview-vite-react

## Researcher Findings

### Workspace layout
- `pnpm-workspace.yaml` (10 lines, explicit enumeration NOT glob): packages/happy-app, packages/happy-agent, packages/happy-cli, packages/happy-server, packages/happy-wire, packages/happy-app-logs, packages/codexu-plugin, packages/codexu-options-mode-plugin, packages/codium
- Root `package.json`: name `"monorepo"`, private:true, `packageManager: "pnpm@10.11.0"`, no existing `overview` or `overview:build` scripts. ⚠️ Copilot/Codex flag: workspaces are ALSO listed under `workspaces.packages` in root package.json — both files must be updated.
- Naming: most packages unscoped (happy-app, codium, codexu-plugin); only `@slopus/happy-wire` is a published scope; `@codexu/*` scope appears unused → safe to claim for `@codexu/overview-viewer` (no collision)
- TS baseline: `packages/happy-app/tsconfig.json` extends `expo/tsconfig.base.json` with `strict: true`, `jsx: "react-jsx"`, target ES2022, module ESNext, skipLibCheck:true
- No existing pure-Vite workspace package; `packages/codium/electron.vite.config.ts` is the closest precedent (React 19, `@vitejs/plugin-react`, Vite 8, `moduleResolution: bundler`)

### plans/ directory state (file paths and line ranges)
**plans/overview.html (2657 lines)** — key landmarks:
- Lines 7–37: CSS custom properties (`--bg, --fg, --muted, --border, --card, --accent, --ok, --warn, --bad, --info, --done, --purple`) including `@media (prefers-color-scheme: light)` overrides
- Line 852-880 (approx): `.cmd-badge.b-<phase>` + `.cmd-status-mod.<status>` CSS class definitions
- Lines 1288–1398: `renderTasks()` — command rows + kanban cards, preserves `<details open>` state, calls applyEnrichments at line 1397
- Lines 1302–1313: badge text/glyph map (phase → "✅ shipped", "🚫 closed", "📋 plan ready", etc.)
- Lines 1315–1337: kanban placement algorithm — numeric `order` ASC takes precedence, `insertBeforeTaskId` fallback for cards without order
- Lines 1401–1480: `renderPhaseTree()` — derives state class from `task.phase` only (NOT task.status). Mapping: shipped→donefade, closed→closed, else→open. ⚠️ Note (Copilot): blocked/paused are NOT reflected in the phase tree today.
- Line 1482-onwards: phase-to-order/filter bucket maps (load-bearing for sort, filter, Today panel)
- Lines 1581–1611: `renderPhaseBadges()` glyph map (port verbatim into StatusBadge)
- Line 1639: `injectTaskScopeChips()`
- Line 1700: `injectCopyNameButtons()`
- Line 1725–1761: `BOOKKEEPING_PREAMBLE` and copy-preambles — ⚠️ Copy-Command injects scope preamble at copy time, so it is NOT byte-for-byte planPrompt. PRD must resolve.
- Line 1770: `copyCommand()` includes the preamble injection
- Line 1851: `buildTodayPanel()` — running/blocked/paused/recently-shipped buckets
- Line 2015: `injectCheckboxes()` — bulk-select; disabled when no `.cmd-pre`
- Line 2075: `parseTaskIdFilter()` — `?tasks=foo,bar` comma-separated
- Line 2206-2244: `injectWorkstreamPills()` — ⚠️ does more than a label pill: also cadence icon/chip, size/cadence datasets, kanban `data-workstream` attribute
- Line 2303: `injectKanbanPhasePills()`
- Line 2324–2345: `linkBlockedOn`
- Line 2348–2363: `linkKanbanToCmds`
- Line 2422–2475: `injectSpawnRelationships`
- Line 2478–2510: `injectRunHistory`
- Lines 2524–2539: `applyEnrichments()` orchestrates 13 DOM-decoration passes

**plans/overview-data.js (1630 lines)**:
- Line 20: `window.OVERVIEW_DATA = { ... }`
- Top-level keys: `generatedAt`, `generatedFromCommit`, `tasks[]`, `phaseTree[]`, `runs[]`, `periodic`, `cadence`, `lastTouched`, `effort`, `risk`, `workstream`, `sizeBucket`, `spawnedFrom`
- Tasks: NO flat `title` (confirmed); 49 tasks, 33 kanban cards, 17 runs, 7 phase-tree blocks
- ⚠️ Codex: `planOnly:true` appears 7 times, populated `mergeCommit` appears **8 times** (feature request said 6 — outdated)
- ⚠️ Codex/Copilot: `phaseTree.task-ref` nodes still contain legacy `state` fields in the data file, even though the renderer ignores them — TS type must mark as optional, not removed
- ⚠️ Codex: line endings are MIXED `\r\n` and `\n` across HTML strings (feature request said pure CRLF — outdated)
- Trusted-HTML sites (broader than feature request): `kanbanCards[].html`, `command.descriptionHtml`, `command.warnings[].html`, `phaseTree raw.html`, `phaseTree task-ref.trailingHtml`, `card.inlineStyle` (needs parser, can't pass as `style="..."` to React)

**plans/task-phases.md**: phase enum (10 phases) + status modifier (ok|blocked|paused) + CSS classes `.cmd-badge.b-<phase>` / `.cmd-status-mod.<status>`

**plans/overview-data-split.md**: downstream schema definitions for `src/data/schema.ts`

**plans/parallel-assignments.md lines 13–15**: confirms `.worktrees/overview-vite-react/` on branch `ralph/overview-vite-react`

### Existing localStorage keys (port verbatim — don't churn user state)
- `codexu-overview-details-state-v2` (expanded details)
- `codexu-overview-last-visit-v1`
- `codexu-overview-notes-v1`

### Test infra
- `tools/vitest.config.ts` + `tools/render-roadmap.test.ts` (precedent)
- `.test-output/` cache exists (use run-tests skill)
- No root ESLint config — any `react/no-danger` rule would need package-local config or skip

### Existing tools
- `tools/render-roadmap.ts` runs OUTSIDE the workspace via direct src imports (per its top comment lines 5-6); intentional pattern, but DIFFERENT from this plan which adds a proper workspace package. Don't copy that pattern.

## Architect Analysis

### Workspace integration
- Add `tools/overview-viewer` to `pnpm-workspace.yaml` as line 11 (after `packages/codium`). ⚠️ Also update `workspaces.packages` in root package.json (Copilot caught this).
- Root scripts: `"overview": "pnpm --filter @codexu/overview-viewer dev"`, `"overview:build": "pnpm --filter @codexu/overview-viewer build"`
- Package name: `@codexu/overview-viewer` (fallback `codexu-overview-viewer` only on collision — confirmed no collision)
- `private: true` in the package's package.json
- Standalone `tsconfig.json` (don't extend expo base); strict:true, jsx:"react-jsx", target ES2022, moduleResolution:bundler
- Don't enroll in cross-workspace `pnpm -r` typecheck/build yet (keep isolated)

### Data loading
- Use `window.OVERVIEW_DATA` global + `useSyncExternalStore` (Option A confirmed by plan, codex, copilot)
- `vite.config.ts`: `server.fs.allow` to permit `../../plans/`, custom plugin that watches `plans/overview-data.js` and sends `overview-data:updated` via HMR
- Client subscription: re-execute the script (or refetch) on HMR, re-read `window.OVERVIEW_DATA`, notify subscribers
- StrictMode-safe cleanup mandatory

### Component tree (proposed)
```
src/
├── main.tsx
├── App.tsx
├── styles.css                       # ported verbatim from overview.html <style>
├── components/
│   ├── TaskCommand.tsx              # <details> command row
│   ├── StatusBadge.tsx              # renderPhaseBadges → component
│   ├── ScopeChip.tsx                # injectTaskScopeChips
│   ├── CopyNameButton.tsx           # injectCopyNameButtons
│   ├── CopyCommandButton.tsx        # copy with preamble injection (⚠️ see open question)
│   ├── BulkSelectCheckbox.tsx       # injectCheckboxes
│   ├── WorkstreamPill.tsx           # injectWorkstreamPills + cadence icon + datasets
│   ├── Warning.tsx                  # linkBlockedOn link conversion
│   ├── SpawnedFromPill.tsx          # injectSpawnRelationships
│   ├── SpawnedChildren.tsx          # injectSpawnRelationships
│   ├── KanbanColumn.tsx             # column + populateKanbanCount
│   ├── KanbanCard.tsx               # inline phase pill (injectKanbanPhasePills), inlineStyle parser, link onClick
│   ├── PhaseTree.tsx
│   ├── PhaseTreeNode.tsx            # task.phase → state class derivation (open|deferred|donefade|closed)
│   ├── RunsLog.tsx                  # injectRunHistory + Recently-shipped section
│   ├── TodayPanel.tsx               # NEW: buildTodayPanel → 4 buckets
│   ├── UrlFilterBanner.tsx
│   ├── SearchInput.tsx
│   ├── Legend.tsx
│   └── Layout.tsx
├── hooks/
│   ├── useOverviewData.ts           # useSyncExternalStore
│   ├── useUrlFilter.ts              # ?tasks= parsing
│   ├── useHashNav.ts                # #cmd-* scroll-into-view
│   ├── usePersistentExpanded.ts     # localStorage codexu-overview-details-state-v2
│   ├── useBulkSelection.ts
│   └── useTaskClassification.ts     # classifyAndOrderCmds
├── data/
│   ├── schema.ts                    # TS types
│   ├── phaseConstants.ts            # PHASE_TO_BADGE_TEXT
│   ├── workstreamConstants.ts
│   └── copyPreambles.ts             # BOOKKEEPING_PREAMBLE etc.
└── utils/
    ├── kanbanOrdering.ts            # order + insertBeforeTaskId
    └── inlineStyleParser.ts         # parse card.inlineStyle string → React style object
```

### State preservation under HMR
- `<details>` open state: hybrid ref + localStorage via `usePersistentExpanded` hook keyed on existing `codexu-overview-details-state-v2`
- Search input: controlled useState; persist to URL query (e.g. `?q=...`) or localStorage; URL preserves on HMR naturally
- Scroll: stable React keys → reconciliation preserves DOM → browser preserves scroll
- Bulk-select: useState in a context or top-level hook (session-scoped)

### Static build
- `vite-plugin-singlefile` (not currently in lockfile — must be added)
- `base: './'` MANDATORY for `file://`
- `outDir: '../../plans'` + `emptyOutDir: false` (preserves other plans/*.md)
- Test: open `plans/overview.html` from disk via double-click, verify no 404s

### TS schema (key types)
- `Task`: id, scope, phase (10 enum values), status (ok|blocked|paused), lastTouchedAt, mergeCommit?, planOnly?, planSource?, planSourceRef?, planJobId?, brainstormPrompt?, kanbanCards[], command{name, descriptionHtml, warnings[], planPrompt?}, spawnedFrom?
- `KanbanCard`: column (ready|soon|blocked), cardClass?, inlineStyle?, html, insertBeforeTaskId?, order?
- `PhaseTreeNode`: kind (sub-phase|raw|task-ref), id?, title?, taskId?, visibleText?, trailingHtml?, html?, state? (LEGACY — keep optional, renderer ignores)
- `OverviewData`: generatedAt, generatedFromCommit, tasks[], phaseTree?, runs[], + denormalized maps

### Risk areas
1. CRLF/LF mixed in HTML strings (not pure CRLF) — TS code must not normalize
2. Copy-Command preamble injection — NOT byte-for-byte planPrompt today (PRD ambiguity)
3. React StrictMode double-mount + HMR subscription leakage
4. `card.inlineStyle` as raw string — can't pass to React's style prop, must parse
5. `injectWorkstreamPills` is broader than name suggests (cadence chips + datasets)
6. `phaseTree.task-ref.state` legacy field still in data — must be optional in TS, never written by React renderer
7. file:// open requires `base:'./'` exclusively
8. Theme parity (dark + prefers-color-scheme:light) — verbatim CSS preservation

### 9-stage staging confirmed
Order from feature request preserved; stage 8 (replace static HTML) is the only destructive step — surface to operator.

## Codex Research

(Verbatim summary — full output in `<staging>/codex-research.txt`)

- pnpm@10.11.0 monorepo; workspaces enumerated in BOTH pnpm-workspace.yaml AND root package.json (line 21)
- `packages/codium/electron.vite.config.ts` is the closest React+Vite precedent (Vite 8, `@vitejs/plugin-react`, React 19, `moduleResolution: bundler`)
- `tools/render-roadmap.ts` documents at lines 5–6 the "intentional src-path import: root-level tools/*.ts run outside pnpm workspace module resolution" — don't copy this pattern
- Shipped data file: 49 tasks, 33 kanban cards, 17 runs, 7 phase-tree blocks
- Task keys: id, scope, phase, status, lastTouchedAt, optional planOnly/mergeCommit, kanbanCards[], command — NO flat `title`
- Card keys: column, cardClass, inlineStyle, html, optional insertBeforeTaskId, order
- `plans/overview.html:1386` sorts cards by numeric order; cards without numeric order fall through to `insertBeforeTaskId` via `insertKanbanCard()`
- `plans/overview.html:1401` `renderPhaseTree()` ignores legacy `state` fields on task-ref nodes; derives from `task.phase`
- `plans/overview.html:1482` phase-to-order/filter bucket maps are LOAD-BEARING for sort, filter, Today panel
- `plans/overview.html:1581` badge text/glyph map (port to StatusBadge)
- `plans/overview.html:1851` `buildTodayPanel()`: running, ready, on-hold, recently-shipped sections
- `plans/overview.html:2075` URL filter `?tasks=foo,bar`
- `plans/overview.html:2524` `applyEnrichments()` — list of DOM passes that become React components/hooks
- ⚠️ `plans/overview.html:1770` `copyCommand()` injects scope preambles — current behavior is NOT byte-for-byte planPrompt
- Card HTML strings are MIXED `\r\n` and `\n`, not pure CRLF
- `dangerouslySetInnerHTML` required for: kanbanCards[].html, descriptionHtml, warnings[].html, phaseTree.raw.html, trailingHtml
- React cannot use `style="..."`; `card.inlineStyle` needs a parser or ref-based attribute set
- `vite-plugin-singlefile` NOT currently in lockfile
- `@codexu/overview-viewer` — no package-name collision
- Existing localStorage key: `codexu-overview-details-state-v2`
- Suggest scaffolding: React 19, Vite 8, `@vitejs/plugin-react`, strict TS, `base:'./'`, `outDir:'../../plans'`, `emptyOutDir:false`, root scripts `overview`/`overview:build`, then root `pnpm install`
- Suggested tests: schema loading, kanban ordering, phase-tree derivation, URL filter parsing, copy text behavior; consider Playwright/screenshot for parity

## Copilot Research

(Verbatim summary — full output in `<staging>/copilot-research.txt`)

- ⚠️ Workspace registration is duplicated in BOTH `pnpm-workspace.yaml` AND root `package.json` → `workspaces.packages`; PRD must update both
- ⚠️ Shipped data: `planOnly:true` appears 7 times, populated `mergeCommit` appears 8 times (feature request said 6 — outdated); `planSource`, `planSourceRef`, `planJobId`, `brainstormPrompt` have 0 matches
- ⚠️ `phaseTree.task-ref` nodes still contain legacy `state` fields in shipped data — TS schema must mark as optional, renderer must ignore
- ⚠️ `renderPhaseTree()` derives class from `task.phase` ONLY (not task.status); blocked/paused NOT reflected in phase tree today
- ⚠️ `injectWorkstreamPills()` does MORE than a label pill: also cadence icon/chip, size/cadence datasets, kanban `data-workstream` attribute — WorkstreamPill component must absorb full behavior
- Existing localStorage keys: `codexu-overview-details-state-v2`, `codexu-overview-last-visit-v1`, `codexu-overview-notes-v1` — port verbatim, don't churn user state
- Trusted-HTML injection sites: `kanbanCards[].html`, `command.descriptionHtml`, `command.warnings[].html`, `phaseTree raw.html`, `phaseTree task-ref.trailingHtml`, plus `card.inlineStyle` parsing concern
- No root ESLint config — any `react/no-danger` rule needs package-local setup or skip
- `.agents/skills/roadmap-and-overview/SKILL.md` procedure G already says preserve `file://` compatibility and keep top-level `window.OVERVIEW_DATA` — additive viewing-section update only, do not rewrite procedures
- Root `README.md` has roadmap context but no viewer subsection — add one
- Treat the React port as a data-driven rewrite, NOT a DOM-effect wrapper around `applyEnrichments()`
- TS types must defensively: no `task.title`, sparse optionals, optional legacy `phaseTree.task-ref.state`
- `tools/render-roadmap.ts` is NOT a pattern to copy (standalone root tool, different from workspace package)

## Consolidated File List

### Files to CREATE (under `.worktrees/overview-vite-react/tools/overview-viewer/`)
- `package.json` (name: @codexu/overview-viewer, private:true, scripts: dev/build/typecheck)
- `tsconfig.json` (strict, jsx:react-jsx, ES2022, bundler resolution)
- `vite.config.ts` (base:'./', outDir:'../../plans', emptyOutDir:false, plugins: react+singleFile+customHmrPlugin)
- `index.html` (Vite entry, references `<script src="/overview-data.js">` via dev plugin)
- `README.md` (contributor guide)
- `.eslintrc.cjs` (optional — package-local React config if used)
- `src/main.tsx`
- `src/App.tsx`
- `src/styles.css` (verbatim port from overview.html <style> block)
- `src/components/*.tsx` (~20 components per architect)
- `src/hooks/*.ts` (~6 hooks)
- `src/data/schema.ts`, `phaseConstants.ts`, `workstreamConstants.ts`, `copyPreambles.ts`
- `src/utils/kanbanOrdering.ts`, `inlineStyleParser.ts`

### Files to MODIFY
- `pnpm-workspace.yaml` (add `- "tools/overview-viewer"`)
- `package.json` (root): add `workspaces.packages` entry AND `overview` + `overview:build` scripts
- `.agents/skills/roadmap-and-overview/SKILL.md` (additive — viewing subsection only adds dev-server URL)
- `README.md` (root): add "Roadmap viewer" subsection
- `plans/overview.html` (DELETED in stage 8, replaced by build output)

### Files for REFERENCE (read-only ground truth)
- `plans/overview-vite-react.md` (input plan — 299 lines)
- `plans/overview.html` (current renderer — 2657 lines)
- `plans/overview-data.js` (data — 1630 lines)
- `plans/overview-data-split.md` (schema)
- `plans/task-phases.md` (phase + status enum)
- `plans/parallel-assignments.md` lines 13–15 (worktree)
- `packages/codium/electron.vite.config.ts` (React+Vite precedent — closest in repo)
- `packages/happy-app/tsconfig.json` (strict TS conventions)
- `tools/render-roadmap.ts` (DIFFERENT pattern — root-level, not workspace package)

### Test/Build infra
- `tools/vitest.config.ts` (precedent for test wiring)
- `.test-output/` (run-tests cache)
- root `pnpm install` after workspace edits
