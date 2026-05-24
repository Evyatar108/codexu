# Code Review Context — Plan 07 (Context Preservation)

Notes captured during code review of Plan 07 (`ralph-pipeline-07-context`). Useful for follow-on plans / agents.

## Codebase Conventions Observed

- **`RalphPipelineState` additions** require three synchronized surfaces: the TypeScript `interface` in `tools/overview-viewer/src/types.ts`, the JSON schema in `scripts/lib/emit-snapshot-schema.mjs`, and an Ajv regression in `scripts/lib/emit-snapshot-schema.test.mjs`. Plan 07 added six fields and updated all three.
- **Root-level Node helpers** under `scripts/lib/` ship with three sibling files: `<name>.mjs`, `<name>.d.mts` (TS declarations consumed from the overview-viewer package), and `<name>.test.mjs` (vitest). When tests need typed imports of those modules from the overview-viewer package, mirror the shape in `tools/overview-viewer/src/__tests__/scripts.d.ts`.
- **`scripts/sync-core.mjs` extension points**: `readJobLikeBundles()` is the file-loading layer (read additional files here, attach as bundle fields); `toPipelineState(bundle, ...)` is the per-bundle derivation layer (call helpers here). Both layers are tested by `sync-core.test.mjs`.
- **Activity-event journal append** lives in BOTH `scripts/lib/watch-ralph-state.mjs` (watch mode) AND `scripts/sync-ralph-state.mjs` (one-shot CLI), as parallel `appendJournalForStageEvent` helpers. Keep them in sync; both must run inside the existing sync-lock window before lock release.
- **Vite dev-server middleware plugins** in `tools/overview-viewer/vite.config.ts` should use `enforce: 'pre'` to register before the SPA fallback. Pattern: `overviewActivityPlugin()` mirrors `overviewRalphStatePlugin()` shape — handler that reads the underlying file, catches ENOENT to return `200 ''`, falls through to 500 on other errors.
- **`execFileSync` for git** is the project standard — never shell-string interpolation. `derive-pr-links.mjs` and the new memoized origin lookup in `sync-core.mjs` both follow this.
- **HMR cleanup** must call `import.meta.hot?.off?.(...)` (note both optional chains) because Vitest's HMR shim can expose `on` without `off`. The Plan 07 changes correctly updated the pre-existing `App.tsx` subscriptions as well.

## Cross-Cutting Concerns

- **Trusted-HTML boundary** is documented in `tools/overview-viewer/CLAUDE.md` § "Trusted-HTML boundaries". `dangerouslySetInnerHTML` sites consume operator-authored data; new code should NOT introduce additional `dangerouslySetInnerHTML` surfaces without re-validating the trust path. Plan 07 added no new `dangerouslySetInnerHTML` consumers — `prUrl` is rendered as an `href` attribute on an `<a>` tag (with `target="_blank" rel="noopener noreferrer"`) and `branchName` is rendered as plain text.
- **Path-traversal guard** in `appendJournalEntry` rejects taskIds containing `/`, `\`, or `..`. Replicate this guard pattern for any future helper that takes a user/data-supplied identifier and uses it in `path.join(repoRoot, ..., id, ...)`.
- **Stage-only journaling**: `appendJournalForStageEvent` short-circuits on `event.changedFields?.includes('stage')`. Other `changedFields` (e.g. `storyCompletion`, `reviewOpenCount`) are intentionally excluded from journal writes per plan AC. Plan 08+ may revisit if non-stage changes warrant journal entries.

## Gotchas / Surprises

- **`derivePRLinks` early-return on `rev-parse` failure**: when `stage === 'shipped'` and `git rev-parse <branch>` throws, the function `return result` immediately rather than falling through to the bottom-of-function return. Functionally equivalent (no later code runs), but slightly surprising shape. Worth noting for future refactors.
- **`parseMarkdownTable` short-circuits the WHOLE table on any single malformed row** (returns `null` once column count mismatches). Matches AC-1 ("malformed table → zero counts") but means a single bad row hides all good rows. By design.
- **`appendJournalForStageEvent` is duplicated** verbatim in `watch-ralph-state.mjs` and `scripts/sync-ralph-state.mjs`. Plan-acknowledged technical debt; extract to a shared helper if either grows additional logic.
- **`RecentActivity` `useState` initializer** seeds `recentActivityCollapsed` from `density.density` once at mount; subsequent density-toggle by the user does NOT re-collapse the sidebar. Intentional — explicit user collapse choice wins after first render.
- **Plan 06 / Plan 07 parallel-safety**: Plan 06 (skills-worker) and Plan 07 both extend `tools/overview-viewer/src/types.ts`. Plan 06 adds `NextCommand`; Plan 07 adds six fields to `RalphPipelineState`. Both stay in their own subsections — bounded merge conflict if anyone reorders the interface bodies.

## Relevant File Map

- Helper modules: `scripts/lib/parse-notepad.mjs`, `scripts/lib/derive-pr-links.mjs`, `scripts/lib/append-journal.mjs`
- Wiring: `scripts/lib/sync-core.mjs` (lines 128-148 `assembleStateFromBundles`, 504-528 `readJobLikeBundles`, 617-665 `toPipelineState`), `scripts/lib/watch-ralph-state.mjs:309-322`, `scripts/sync-ralph-state.mjs:146-160`
- Schema mirror: `scripts/lib/emit-snapshot-schema.mjs:122-131`
- Viewer additions: `tools/overview-viewer/src/components/RecentActivity.tsx`, `tools/overview-viewer/src/hooks/useActivityEvents.ts`, `tools/overview-viewer/vite.config.ts:142-170` (`overviewActivityPlugin`), `tools/overview-viewer/src/App.tsx:46-126`, `tools/overview-viewer/src/components/TopLevelSurfaces.tsx:91-99`, `tools/overview-viewer/src/components/TaskCommand.tsx:198-242` (`RalphTooltipExtras`)
- Tests: `scripts/lib/parse-notepad.test.mjs`, `scripts/lib/derive-pr-links.test.mjs`, `scripts/lib/append-journal.test.mjs`, `scripts/lib/emit-snapshot-schema.test.mjs`, `scripts/lib/sync-core.test.mjs:274-352`, `scripts/lib/watch-ralph-state.test.mjs`, `scripts/sync-ralph-state.test.mjs`, `tools/overview-viewer/src/__tests__/interactions/{recentActivity,useActivityEvents,taskCommandTooltipExtras}.test.tsx`, `tools/overview-viewer/src/__tests__/viteActivityPlugin.test.ts`
- Type/schema mirrors: `tools/overview-viewer/src/types.ts:61-74`, `scripts/lib/sync-core.d.mts:8`, `tools/overview-viewer/src/__tests__/scripts.d.ts:83-135`
