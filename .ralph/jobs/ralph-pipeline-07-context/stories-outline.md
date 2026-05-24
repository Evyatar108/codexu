# Stories Outline: Plan 07 — Context preservation

*Preliminary decomposition from `/plan-with-ralph --improve`. Feed to `/implement-with-ralph --from-plan` for PRD generation.*

## US-001: parse-notepad helper
**Description:** As a sync-pipeline maintainer, I want a pure markdown-table parser for the notepad's Deferred Questions section so that I can surface unanswered-question counts in the dashboard tooltip.
**Acceptance Criteria:**
- [ ] `scripts/lib/parse-notepad.mjs` exports `parseNotepad(text) → { deferredQuestionsCount, deferredQuestionsPreview, storyDoctorInterventions }`.
- [ ] Counts rows with empty `Answer` column as unanswered.
- [ ] Preview is the first unanswered question text trimmed to ≤120 chars.
- [ ] Story Doctor count = non-empty data rows in `## Story Doctor Log`.
- [ ] Malformed table → zero counts + deduped stderr warn (never throws).
- [ ] Vitest fixtures cover: empty input, no section, 3-questions-2-answered, malformed, story-doctor row counting.
- [ ] Typecheck passes.
**Dependencies:** None
**Estimated complexity:** small

## US-002: derive-pr-links helper
**Description:** As a dashboard user, I want chip tooltips to show clickable PR URLs and merge SHAs so I can navigate from a task to its review.
**Acceptance Criteria:**
- [ ] `scripts/lib/derive-pr-links.mjs` exports `derivePRLinks({ groupState?, repoRoot, branchName, stage, originUrl? }) → { branchName?, prUrl?, mergeCommit? }`.
- [ ] Reads `groupState.prUrl` defensively (returns undefined if absent).
- [ ] Falls back to `execFileSync('git', ['-C', repoRoot, 'log', '--format=%H%n%s%n%b', '-n', '5', branchName])`. Catches all git failures and returns undefined fields.
- [ ] `mergeCommit` resolved only when `stage === 'shipped'`, via single-ref `git rev-parse <branchName>` (full SHA shortened in JS).
- [ ] `Closes #N` reconstruction only when origin URL is a parseable GitHub URL.
- [ ] Skips git invocations entirely when `branchName` is falsy.
- [ ] Vitest cases cover: direct URL match, resolvable `Closes #N`, unresolvable `Closes #N`, missing branch (git throws), empty git output.
- [ ] Typecheck passes.
**Dependencies:** None
**Estimated complexity:** medium

## US-003: append-journal helper
**Description:** As a sync-pipeline maintainer, I want per-task journal lines appended atomically on stage transitions so the dashboard surface can later display them.
**Acceptance Criteria:**
- [ ] `scripts/lib/append-journal.mjs` exports `appendJournalEntry({ repoRoot, taskId, ts, prevStage, newStage, slug })` and `formatJournalLine(...)`.
- [ ] Formats line internally as `- <ISO ts>  stage: <prev> → <new>  (job: <slug>)\n`.
- [ ] Atomic append via `fs.openSync(path, 'a')` + `writeSync` + `fsyncSync` + `closeSync`.
- [ ] Creates `tasks/<taskId>/` directory on first call.
- [ ] Rejects taskIds containing `/`, `\`, or `..`.
- [ ] Two consecutive calls produce two lines.
- [ ] Vitest covers normal append, directory creation, path-traversal rejection, and `formatJournalLine` output.
- [ ] Typecheck passes.
**Dependencies:** None
**Estimated complexity:** small

## US-004: Extend RalphPipelineState + snapshot schema
**Description:** As a TypeScript consumer of `RalphPipelineState`, I want the six new optional fields declared so the viewer can type-safely use them.
**Acceptance Criteria:**
- [ ] `tools/overview-viewer/src/types.ts` extends `RalphPipelineState` with `branchName?, deferredQuestionsCount?, deferredQuestionsPreview?, mergeCommit?, prUrl?, storyDoctorInterventions?` (all optional).
- [ ] `scripts/lib/emit-snapshot-schema.mjs` declares the six fields as optional under `tasks[*].ralph`.
- [ ] `pnpm --filter @codexu/overview-viewer typecheck` passes.
- [ ] `scripts/lib/emit-snapshot.test.mjs` still passes (no schema regression).
**Dependencies:** US-001, US-002, US-003 (signatures must match return shapes)
**Estimated complexity:** small

## US-005: Wire helpers into sync-core + watcher + one-shot CLI
**Description:** As the sync pipeline, I want to call the new helpers per bundle and append journals at the right lock window so the dashboard data plane stays consistent.
**Acceptance Criteria:**
- [ ] `readJobLikeBundles()` reads `<bundle.dir>/notepad.md` (best-effort, missing = empty string), attaches as `bundle.notepadText`.
- [ ] `toPipelineState(bundle, repoRoot)` accepts `repoRoot` and calls `parseNotepad(bundle.notepadText ?? '')` + `derivePRLinks({ groupState: bundle.groupJson, repoRoot, branchName: bundle.prd?.branch?.name, stage, originUrl })`.
- [ ] `assembleStateFromBundles` memoizes `git remote get-url origin` once per sync pass and passes the result through.
- [ ] `scripts/lib/watch-ralph-state.mjs` and `scripts/sync-ralph-state.mjs` both call `appendJournalEntry` for each activity event where `changedFields.includes('stage')`, inside the existing sync-lock window.
- [ ] `scripts/lib/sync-core.d.mts` is updated (if a typed bundle shape is exported) to include the optional `notepadText` field.
- [ ] Unit tests in `watch-ralph-state.test.mjs` and `sync-ralph-state.test.mjs` mock `appendJournalEntry` and verify invocation per stage-changed event.
- [ ] `pnpm test` passes.
**Dependencies:** US-001, US-002, US-003, US-004
**Estimated complexity:** large

## US-006: useActivityEvents hook + Vite middleware
**Description:** As the viewer, I want a hook that fetches the activity JSONL and re-fetches on HMR so the RecentActivity sidebar stays fresh.
**Acceptance Criteria:**
- [ ] `tools/overview-viewer/src/hooks/useActivityEvents.ts` fetches `./overview-activity.jsonl?t=<Date.now()>`, parses JSONL line-by-line, skips a torn last line silently.
- [ ] Subscribes to `import.meta.hot.on('overview-ralph-state:update', refetch)`; unsubscribes on unmount.
- [ ] Returns `ActivityEvent[]` newest-first.
- [ ] Tolerates missing file (empty array) without crashing.
- [ ] Tolerates `file://` open (fetch throws) by returning empty.
- [ ] `tools/overview-viewer/vite.config.ts` adds an `overviewActivityPlugin()` modelled on `overviewRalphStatePlugin()` (`enforce="pre"`) that serves `/overview-activity.jsonl` from `plans/overview-activity.jsonl`. On `ENOENT`, responds with `res.statusCode = 200; res.end('')`. Registered before SPA fallback.
- [ ] Typecheck + vitest pass.
**Dependencies:** US-004
**Estimated complexity:** medium

## US-007: RecentActivity sidebar + App integration + styles
**Description:** As a dashboard user, I want a right-side panel showing the last 5–10 activity events with click-through navigation.
**Acceptance Criteria:**
- [ ] `tools/overview-viewer/src/components/RecentActivity.tsx` props: `{ activityEvents: ActivityEvent[]; setFocusedTaskId: (id: string) => void; collapsed: boolean; onToggle: () => void }`.
- [ ] Renders last 5–10 events newest-first; each clickable.
- [ ] Render contract: when `newStage` is `null`, show `<taskId> removed`. Otherwise `<taskId> → <newStage>`.
- [ ] Empty state: `<aside className="recent-activity-sidebar empty">No recent activity yet.</aside>`.
- [ ] `App.tsx` renders `<RecentActivity activityEvents={useActivityEvents()} setFocusedTaskId={(id) => navigateToCommand(id, expandedControls.setTaskExpanded)} collapsed={collapsed} onToggle={...} />` with collapsed defaulting closed in compact density mode.
- [ ] `styles.css` adds `.recent-activity-sidebar` (+`.empty`), `.tooltip-extras-row`, `.tooltip-extras-row a`.
- [ ] Vitest render test covers null-newStage label rendering.
- [ ] Typecheck passes.
**Dependencies:** US-006
**Estimated complexity:** medium

## US-008: Tooltip extras composition in TaskCommand + E2E
**Description:** As a dashboard user, I want chip tooltips to show deferred-question count, branch (with copy), and PR URL.
**Acceptance Criteria:**
- [ ] `tools/overview-viewer/src/components/TaskCommand.tsx` line 413 composes `tooltipExtras` JSX with rows for `deferredQuestionsCount > 0` (with preview), `branchName` (+`QuickCopyButton` copying `git checkout <branchName>` via `copyTextWithToast`), and `prUrl` (clickable external link).
- [ ] Passes through `<RalphStageChip tooltipExtras={…} />` using the Plan 03 slot.
- [ ] Falls back cleanly (no rows) when all three fields absent.
- [ ] Vitest covers all permutations (none/one/all) without broken markup.
- [ ] End-to-end: populate a synthetic notepad with 3 deferred questions; run sync; verify tooltip output shape.
**Dependencies:** US-005, US-007
**Estimated complexity:** medium

## US-009: Cascade refresh
**Description:** As a downstream-plan reader, I want `plans/ralph-pipeline-INDEX.md` to reflect Plan 07's new modules and types.
**Acceptance Criteria:**
- [ ] Before cascade: read `.ralph/jobs/ralph-pipeline-06-skills/progress.json`. Plan 06 is terminal if `progress.terminal === true` OR the directory contains only `plan.md`. If `progress.json` exists with `terminal !== true`, **defer** cascade by appending entries to `<jobDir>/notepad.md` under `## Deferred Cascade` and skip INDEX modification.
- [ ] If Plan 06 is terminal (or unstarted): update `plans/ralph-pipeline-INDEX.md` Source-of-truth modules table with the 5 new modules (`parse-notepad`, `derive-pr-links`, `append-journal`, `useActivityEvents`, `RecentActivity`) and extend the `RalphPipelineState` row with the 6 new optional fields.
- [ ] Update applied atomically in the final implementation commit; commit message lists each diff (file, lines, change) for reviewer verification.
- [ ] All other ACs (US-001..US-008) pass before US-009 starts.
**Dependencies:** US-001..US-008
**Estimated complexity:** small
