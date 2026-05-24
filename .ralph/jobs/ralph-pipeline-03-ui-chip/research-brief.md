# Research Brief — Plan 03 (UI Chip + Filter Axis + Vite Sidecar)

Generated 2026-05-19. Synthesizes findings from researcher (Explore), architect (Explore), Codex CLI, and Copilot CLI runs against the codexu repo at `D:/harness-efforts/codexu`.

## Researcher Findings (verified)

**Stack reality check:** This is a **React 19 + Vite 8 + Vitest** viewer, NOT Svelte. The user's prompt mentioned "Svelte component" — that was a misnomer. All existing files are `.tsx`/`.ts`. The improved plan must say React/TSX.

**All file paths in the existing plan exist** except the two net-new chip + chip-test files. Full verification table:

| Path | Status |
|------|--------|
| `tools/overview-viewer/src/types.ts` | exists — already defines `RalphStage`, `RalphPipelineState`, `OverviewRalphState`, `getOverviewRalphState()` |
| `tools/overview-viewer/src/App.tsx` | exists |
| `tools/overview-viewer/src/components/TaskCommand.tsx` | exists; WorkstreamPill at lines 276–322 |
| `tools/overview-viewer/src/components/CommandList.tsx` | exists (renders TaskCommand) |
| `tools/overview-viewer/src/components/Kanban.tsx` | exists |
| `tools/overview-viewer/src/components/Toolbar.tsx` | exists; FILTER_GROUPS lines 10–40 |
| `tools/overview-viewer/src/utils/filters.ts` | exists |
| `tools/overview-viewer/src/hooks/useMultiAxisFilter.ts` | exists |
| `tools/overview-viewer/src/styles.css` | exists (40KB) |
| `tools/overview-viewer/vite.config.ts` | exists (108 lines) |
| `tools/overview-viewer/overview.html` | exists — currently only loads `<script src="./overview-data.js">`; **must add ralph state script tag** |
| `tools/overview-viewer/src/__tests__/testData.ts` | exists |
| `tools/overview-viewer/src/__tests__/searchHaystack.test.ts` | exists |
| `tools/overview-viewer/src/__tests__/kanban.test.tsx` | exists |
| `tools/overview-viewer/src/__tests__/commandList.test.tsx` | exists |
| `tools/overview-viewer/src/__tests__/urlFilter.test.ts` | exists — **missing from current plan's update list** |
| `tools/overview-viewer/src/__tests__/interactions/workstreamTooltip.test.tsx` | exists — template for chip tooltip tests |
| `tools/overview-viewer/src/__tests__/ralphStage.test.ts` | exists (Plan 01 baseline) |
| `tools/overview-viewer/src/components/RalphStageChip.tsx` | NET-NEW |
| `tools/overview-viewer/src/__tests__/ralphStageChip.test.tsx` | NET-NEW |
| `tools/overview-viewer/src/__tests__/interactions/ralphStageChipTooltip.test.tsx` | NET-NEW (per copilot + codex) |

**vite.config.ts structure (108 lines, critical for Plan 02 coexistence):**
- Lines 18–30: `overviewDataPlugin()` factory + `buildStart`.
- Lines 31–52: `configureServer` — middleware for `/` and `/overview-data.js`, watch `plans/overview-data.js`, emit `overview-data:update` WS event.
- Lines 54–72: `transformIndexHtml` — inline `overview-data.js` for static build with `</script` escape.
- Lines 74–85: `closeBundle` — atomic rename safety for preview builds.
- Lines 89–107: `defineConfig({ plugins: [react(), singleFile(), overviewDataPlugin()], ... })`.

**Vitest config has two projects:** node SSR (default, `src/__tests__/**` excluding `interactions/`) and jsdom (`src/__tests__/interactions/**`). Radix hover/focus tests must live under `interactions/`.

**Build commands:** `pnpm overview` (dev), `pnpm overview:build` (static), `pnpm --filter @codexu/overview-viewer test` / `typecheck`.

## Architect Analysis

**Vite plugin separation strategy (RECOMMENDED):** Create a **separate named plugin** `overviewRalphStatePlugin()` registered alongside `overviewDataPlugin()` in the `plugins: []` array — do NOT extend `overviewDataPlugin`. Rationale:
- Physical separation from Plan 02's chokidar/WebSocket plugin → clean merges.
- Each plugin has distinct `name`, `configureServer`, `transformIndexHtml`. Vite merges middlewares by path.
- Mirrors community idioms (`@vitejs/plugin-react`, `vite-plugin-singlefile`).

**State flow contract:**
1. `App.tsx`: `const [ralphState, setRalphState] = useState(getOverviewRalphState)` (use the function ref form so HMR can `setRalphState(getOverviewRalphState())` after re-eval).
2. Thread to `useMultiAxisFilter(data, taskIdFilter, ralphState)` (3rd param).
3. Pass into `CommandList`, which forwards to `TaskCommand`, which renders `<RalphStageChip taskId={task.id} ralphState={ralphState} />`.
4. `Toolbar` does **not** need `ralphState` as a prop — its FILTER_GROUPS list is static.

**Ship order:**
1. Filter threading + tests (no UI change yet). Verifies signature compatibility.
2. RalphStageChip + render in TaskCommand. Visual win without HMR.
3. Vite sidecar plugin (dev middleware + transformIndexHtml).
4. App.tsx HMR `useEffect` subscription (no-op without Plan 02; harmless).

**Risks:**
- (a) Double-registration of `/overview-ralph-state.js` middleware — mitigated by single named plugin.
- (b) Concurrent file write during HMR fetch — Plan 01 uses atomic tmp+rename; add `.catch` in `reloadRalphState()`.
- (c) Tests already pass `NO_RALPH_STATE` everywhere — must add to **every** call site including the ones the current plan missed.

## Codex Research (sharp finds)

Codex flagged real defects in the existing plan:

1. **`overview.html` missing from scope.** Currently has only `<script src="./overview-data.js">`. Without `<script src="./overview-ralph-state.js">` before `/src/main.tsx` mounts, initial dev render and static build will both see empty Ralph state. Must add to "Files to modify."
2. **`urlFilter.test.ts` missing from update list.** It calls `matchesTaskFilter` and will fail to compile after the signature change.
3. **9 vs 10 CSS variants.** Plan says "9 per-stage color variants" but `RalphStage` has 10 values (including `replan-pending`). Off-by-one.
4. **Don't double-watch the sidecar.** Plan 02 (`plans/ralph-pipeline-02-watcher.md`) explicitly says its chokidar watcher emits `overview-ralph-state:update`. Plan 03 should NOT call `server.watcher.add(overviewRalphStatePath)`. The existing plan's "watch as defensive backup" is wrong — it conflicts with Plan 02. Plan 03 = dev middleware + transformIndexHtml ONLY.
5. **`App.tsx` should use `useState(getOverviewRalphState)`, not a `const`.** Without it, `reloadRalphState()` can't trigger re-render.
6. **Chip keyboard focusability.** A `<span>` inside `Tooltip.Trigger asChild` isn't keyboard-accessible. Either add `tabIndex={0}` or use a focusable element.
7. **Tooltip slug content.** Ralph state may have `jobSlug`, `groupSlug`, or brainstorm artifacts — don't assume `jobSlug` always exists. Tooltip text must handle nulls.
8. **Static budget is tight.** `plans/overview.html` is already ~495,245 bytes; the ralph sidecar adds ~3,352 bytes. "Under 500KB" is ambiguous — define the exact threshold (500 KiB = 512000 bytes, or 500 KB = 500000 bytes) and the verify command (`wc -c plans/overview.html`).
9. **Plan 04 cascade.** Plan 04 currently assumes `useMultiAxisFilter` exposes `setFilters`. Plan 03 should either add that return value or note it for the cascade audit.

## Copilot Research

Reinforced codex + added:
- **`App.tsx`:** `useState(getOverviewRalphState)` keeps reload evaluation separate from React state.
- **Kanban filtering scope:** `matchesKanbanFilter` today only applies workstream + query. Plan 03 should add `ralphStage` to kanban filtering BUT must not broaden kanban to all axes — keep that out-of-scope.
- **Constants in vite.config.ts:** Define `overviewRalphStatePath` and `ralphSidecarScriptTag` as named constants for clarity.
- **Test split:** SSR/null/class assertions → `ralphStageChip.test.tsx`; hover/focus → `interactions/ralphStageChipTooltip.test.tsx`.
- **Downstream audit targets:** `plans/ralph-pipeline-04-pipeline-overview.md`, `05-agent-exports.md`, `06-skills.md`, `07-context.md`, `08-crews.md`, `plans/ralph-pipeline-INDEX.md`.

## Consolidated File List

**Files to create:**
- `tools/overview-viewer/src/components/RalphStageChip.tsx`
- `tools/overview-viewer/src/__tests__/ralphStageChip.test.tsx`
- `tools/overview-viewer/src/__tests__/interactions/ralphStageChipTooltip.test.tsx`

**Files to modify:**
- `tools/overview-viewer/src/utils/filters.ts`
- `tools/overview-viewer/src/hooks/useMultiAxisFilter.ts`
- `tools/overview-viewer/src/App.tsx`
- `tools/overview-viewer/src/components/TaskCommand.tsx`
- `tools/overview-viewer/src/components/CommandList.tsx` (forwards `ralphState` to `TaskCommand`)
- `tools/overview-viewer/src/components/Toolbar.tsx` (adds FILTER_GROUPS entry; no prop change)
- `tools/overview-viewer/src/styles.css`
- `tools/overview-viewer/vite.config.ts` (add `overviewRalphStatePlugin`, do NOT extend `overviewDataPlugin`)
- `tools/overview-viewer/overview.html` (add `<script src="./overview-ralph-state.js">`)
- `tools/overview-viewer/src/__tests__/testData.ts`
- `tools/overview-viewer/src/__tests__/searchHaystack.test.ts`
- `tools/overview-viewer/src/__tests__/kanban.test.tsx`
- `tools/overview-viewer/src/__tests__/commandList.test.tsx`
- `tools/overview-viewer/src/__tests__/urlFilter.test.ts`

**Files to read for reference:**
- `tools/overview-viewer/CLAUDE.md` (Radix Tooltip pattern, trusted-HTML, HMR)
- `tools/overview-viewer/src/__tests__/interactions/workstreamTooltip.test.tsx` (jsdom tooltip pattern)
- `tools/overview-viewer/src/types.ts` (lines 36–89 — Ralph types)
- `scripts/lib/sync-core.mjs` (sidecar emission contract)
- `plans/ralph-pipeline-02-watcher.md` (collision boundary)
- `plans/ralph-pipeline-04-pipeline-overview.md` (downstream consumer of `filters.ralphStage`)

**Downstream plans for cascade audit:**
- `plans/ralph-pipeline-04-pipeline-overview.md` (heavy: histogram, setFilters expectation)
- `plans/ralph-pipeline-05-agent-exports.md`
- `plans/ralph-pipeline-06-skills.md`
- `plans/ralph-pipeline-07-context.md` (tooltipExtras slot)
- `plans/ralph-pipeline-08-crews.md` (tooltipExtras slot)
- `plans/ralph-pipeline-INDEX.md` (source-of-truth modules table, DAG)
