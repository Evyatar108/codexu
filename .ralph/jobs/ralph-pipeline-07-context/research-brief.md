# Research Brief — Plan 07 (Context preservation)

## Researcher Findings

All file paths in Plan 07 verified accurate against current main (HEAD `88464053`). Notable findings:

- `tools/overview-viewer/src/components/RalphStageChip.tsx` — **already has `tooltipExtras?: ReactNode`** prop (Plan 03 shipped). Slot renders below stage/slug/lastUpdatedAt rows: `{tooltipExtras ? <div>{tooltipExtras}</div> : null}`.
- `tools/overview-viewer/src/components/TaskCommand.tsx` line 413 — currently `<RalphStageChip taskId={task.id} ralphState={ralphState} />`. **No `tooltipExtras` passed yet** — this is Plan 07's hook-in point. Helpers `QuickCopyButton`, `QuickNavButton`, `QuickActions` exist (lines 162–228) and `copyTextWithToast`/`showToast` is available for branch-name copy UI.
- `scripts/lib/emit-activity.mjs` — exports `appendActivity(repoRoot, event, opts)` using `fs.openSync(path, 'a')` + `writeSync` + `fsyncSync`. Max line 4096 bytes, rotation via `rotateActivity()` at 1000 lines (configurable). Plan 07 should mirror this pattern in `append-journal.mjs`.
- `scripts/lib/sync-core.mjs` — `mergeAndWrite()` at line 239 returns `{ state, writtenAt, changedTaskIds, activityEvents }`. `deriveActivityEvents()` at line 282 produces events with `{ts, slug, kind, taskId, prevStage, newStage, changedFields, reason}`. `toPipelineState()` at lines 612–640 is the natural extension point for notepad + PR-links derivation.
- `tools/overview-viewer/src/types.ts` — current `RalphPipelineState` (lines 61–75) has: `stage, entryPath, artifacts, jobSlug, groupSlug, isParallel, matchSource, storyCompletion, reviewOpenCount, hasPrdWorthy, terminalReason, lastUpdatedAt`. None of Plan 07's new fields present. `ActivityEvent` (lines 198–207) matches `deriveActivityEvents` output exactly.
- `plans/overview-activity.jsonl` — does **not exist on disk** yet. Created at runtime by Plan 05's watcher when first activity event fires.
- **Plugin path is stale**: Plan 07 cites `5.30.0`; current shipped is `5.41.0`. Appendix B content is identical between versions.
- **`.ralph/job-groups/*/group.json` does NOT have a top-level `prUrl` field** in any of the existing samples (e.g. `overview-data-split/group.json`). Schema has `name, description, status, baseBranch, mergeStrategy, jobs, lastPhase, ...`. Plan 07's PR-derivation must fall back to commit-message scrape; the `groupState.prUrl` path is currently dead code unless orchestrator writes it later.
- HMR event `overview-ralph-state:update` is emitted from `vite.config.ts` middleware and subscribed in `App.tsx` lines 75–84 via `import.meta.hot.on('overview-ralph-state:update', reloadRalphState)`.
- **Plan 06 (skills-worker) does NOT touch `scripts/lib/sync-core.mjs`** nor any of Plan 07's new files. Plan 06 only modifies `types.ts` (additive `NextCommand` type) and creates `scripts/lib/derive-next-command.mjs` + `.claude/skills/*` — fully disjoint footprint.
- Test infrastructure: pnpm workspaces; vitest for both `tools/overview-viewer/*` and `scripts/lib/*.test.mjs`. Typecheck via `pnpm --filter @codexu/overview-viewer typecheck`. Existing `.test.mjs` files include `emit-activity.test.mjs`, `sync-core.test.mjs`, `plan05-acceptance.test.mjs`.

## Architect Analysis

**Integration points:**
1. `toPipelineState(bundle)` in `scripts/lib/sync-core.mjs` ~lines 612–640 — call `parseNotepad(fs.readFileSync(path.join(bundle.dir, 'notepad.md'), 'utf8'))` and `derivePRLinks({ groupState: bundle.groupJson, repoRoot, branchName: bundle.prd?.branch?.name })`, merge results into the returned state.
2. Journal append happens at the **caller** of `mergeAndWrite()`, not inside it. Two callers:
   - `scripts/lib/watch-ralph-state.mjs` (watch mode)
   - `scripts/sync-ralph-state.mjs` (one-shot CLI)
   Both already append `result.activityEvents` to the JSONL after `mergeAndWrite()` succeeds. Plan 07 must add a parallel journal-append step in **both** call sites (or via a shared helper) for events where `changedFields.includes('stage')`.

**Technical constraints:**
- Use `execFileSync` for git commands in `derive-pr-links.mjs` (never shell strings — Windows safety).
- Vite dev root is `tools/overview-viewer`. Fetching `./overview-activity.jsonl` will not auto-map to `plans/overview-activity.jsonl`. **Need a Vite middleware route** (mirror of how `/overview-ralph-state.js` is currently served).
- Static `plans/overview.html` opened via `file://` cannot `fetch()` neighboring files. `RecentActivity` must degrade gracefully (empty state, no crash).
- Root `.mjs` helpers imported from TS tests need adjacent `.d.mts` declarations (see existing `tools/overview-viewer/src/__tests__/scripts.d.ts` for the pattern).
- `SNAPSHOT_SCHEMA` at `scripts/lib/emit-snapshot-schema.mjs` should be updated to declare the new optional Ralph fields (extra-fields-allowed today, but explicit declaration is best practice).

**Suggested approach refinements:**
- `useActivityEvents`: cache-busting `?t=${Date.now()}` query is good; inline parsing (no Web Worker) since dataset is small.
- `parse-notepad.mjs`: defensive markdown-table parser (no external lib). Require header row containing `Question` and `Answer`. Count rows where `Answer` column is empty. Stderr warn on malformed table, return zero counts.
- `append-journal.mjs`: validate the resolved `tasks/<taskId>/journal.md` path stays under `tasks/` to prevent path traversal.

**Risks flagged:**
- Plan 06 + Plan 07 both touch `types.ts` — additive only (Plan 06 adds `NextCommand` type, Plan 07 extends `RalphPipelineState` field cluster). Bounded merge conflict on the interface body; resolve by union of fields.
- Plan 03 already shipped (`RalphStageChip` + Plan 03 row composition merged on main). No live conflict.
- Cascade refresh of `plans/ralph-pipeline-INDEX.md` is required per Plan 07's last acceptance criterion. If Plan 06 is still RUNNING at terminal time, defer cascade to `notepad.md`'s `## Deferred Cascade` section.

## Codex Research

(Summarized — Plan 07 worktree path correctly identified, parallel-safety with Plan 06 confirmed, technical constraints aligned with architect's findings.)

Key add-on insights:
- `readJobLikeBundles()` is the earlier point to **read** `notepad.md` content into the bundle; pass the parsed result through to `toPipelineState()` rather than re-reading the file. This keeps I/O at the bundle assembly layer.
- `Closes #N` parsing in `derive-pr-links.mjs` should derive the GitHub PR URL by `git remote get-url origin` (via `execFileSync`) — Plan 07's spec says "GitHub URL" but doesn't define how to construct it from `#N`. Recommend: only return a `prUrl` for direct URL matches; for `Closes #N` with no resolvable origin, leave `prUrl` undefined.
- Count `storyDoctorInterventions` from non-empty data rows in the notepad's `## Story Doctor Log` section, not from the deferred-questions table.
- Tests that import root `.mjs` from TS need declaration files in `tools/overview-viewer/src/__tests__/scripts.d.ts` (existing pattern).

## Copilot Research

(Summarized — broadly agrees with codex; emphasizes Vite middleware necessity and graceful `file://` degradation.)

Add-on insights:
- Reuse `atomic-write.mjs` semantics for journal creation (open with `wx` for first create, then `a` for subsequent appends) — though plain `O_APPEND` is sufficient since journals are append-only and concurrency is bounded by the sync lock.
- HMR subscription in `useActivityEvents` should `off()` on unmount to avoid leak when StrictMode double-invokes effects.
- Branch-name copy UI should output the literal string `git checkout <branchName>` (Plan 07 spec) — use `copyTextWithToast` not `navigator.clipboard.writeText` direct.

## Consolidated File List

### Files to create
- `scripts/lib/parse-notepad.mjs`
- `scripts/lib/parse-notepad.test.mjs`
- `scripts/lib/derive-pr-links.mjs`
- `scripts/lib/derive-pr-links.test.mjs`
- `scripts/lib/append-journal.mjs`
- `scripts/lib/append-journal.test.mjs`
- `tools/overview-viewer/src/components/RecentActivity.tsx`
- `tools/overview-viewer/src/hooks/useActivityEvents.ts`
- Test files for parser fixtures: `scripts/lib/__fixtures__/notepad-empty.md`, `notepad-3q-2answered.md`, `notepad-malformed.md`

### Files to modify
- `tools/overview-viewer/src/types.ts` (extend `RalphPipelineState`)
- `scripts/lib/sync-core.mjs` (call parsers in `toPipelineState()`; read notepad in `readJobLikeBundles()`)
- `scripts/lib/watch-ralph-state.mjs` (journal append after `appendActivity` calls, inside lock window)
- `scripts/sync-ralph-state.mjs` (one-shot mode — same journal append integration)
- `scripts/lib/emit-snapshot-schema.mjs` (declare new optional fields in `SNAPSHOT_SCHEMA`)
- `tools/overview-viewer/src/components/TaskCommand.tsx` (build & pass `tooltipExtras`)
- `tools/overview-viewer/src/App.tsx` (render `<RecentActivity>` sidebar)
- `tools/overview-viewer/src/styles.css` (`.recent-activity-sidebar`, `.tooltip-extras-row`)
- `tools/overview-viewer/vite.config.ts` (middleware: serve `/overview-activity.jsonl` from `plans/overview-activity.jsonl`)
- `tools/overview-viewer/src/__tests__/scripts.d.ts` (declare new module shapes)
- `plans/ralph-pipeline-INDEX.md` (cascade — list new modules, update RalphPipelineState row)

### Reference files (read-only)
- `tools/overview-viewer/src/components/RalphStageChip.tsx` (Plan 03 contract)
- `scripts/lib/emit-activity.mjs` (append+fsync pattern)
- `scripts/lib/atomic-write.mjs` (atomic-write helper)
- `scripts/lib/sync-core.mjs` `toPipelineState`/`mergeAndWrite`/`deriveActivityEvents`
- `tools/overview-viewer/src/utils/commandNavigation.ts` (`navigateToCommand`)
- `tools/overview-viewer/vite.config.ts` lines 17, 80 (HMR event definition + middleware pattern)
- `C:/Users/evmitran/.claude/plugins/cache/ai-developer-toolkit/ralph-orchestration/5.41.0/skills/implement-with-ralph/SKILL.md` Appendix B
- `plans/ralph-pipeline-06-skills.md` (parallel-safety verification)
