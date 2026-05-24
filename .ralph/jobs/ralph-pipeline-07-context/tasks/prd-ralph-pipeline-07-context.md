# PRD: Plan 07 — Context Preservation (Notepad Surfacing, Per-Task Journal, RecentActivity Sidebar, PR/Branch Backlinks)

*Autonomous PRD generated from `.ralph/jobs/ralph-pipeline-07-context/plan.md`. Stories follow the plan's serial decomposition (US-001 through US-009). All work lands in the worktree at `D:/harness-efforts/codexu/.ralph/jobs/ralph-pipeline-07-context/worktree/` on branch `ralph-pipeline-07-context`, forked from `main` at HEAD `88464053` (Plans 01–05 + 10 shipped).*

## Introduction

Plans 01–05 give the dashboard the data plane it needs to show what's running. Plan 07 adds the **context surfaces** that answer two questions per task without round-tripping to other files:

1. **"What's stuck on this task?"** — surface the `notepad.md` Deferred Questions count + first-unanswered preview in the chip tooltip.
2. **"What just changed?"** — render the last 5–10 activity events in a right-side `RecentActivity` sidebar with click-through navigation.

Plus two metadata enrichments: per-task journals (one line per stage transition, append-only) and PR/branch backlinks (chip tooltip → clickable PR URL + copy `git checkout <branch>`).

The plan is **disjoint** from Plan 06 (skills-worker). Only `tools/overview-viewer/src/types.ts` is shared (Plan 06 adds `NextCommand`, Plan 07 extends `RalphPipelineState`).

## Goals

- Extend `RalphPipelineState` with six new optional fields: `branchName`, `deferredQuestionsCount`, `deferredQuestionsPreview`, `mergeCommit`, `prUrl`, `storyDoctorInterventions`.
- Ship three pure Node helpers: `parse-notepad`, `derive-pr-links`, `append-journal` with vitest coverage.
- Wire helpers into `scripts/lib/sync-core.mjs` (`readJobLikeBundles` + `toPipelineState`) and into both call sites of `mergeAndWrite` (`watch-ralph-state.mjs` + `scripts/sync-ralph-state.mjs`) for journal appends.
- Add `RecentActivity` sidebar + `useActivityEvents` hook + Vite middleware serving `/overview-activity.jsonl`.
- Compose `tooltipExtras` JSX in `TaskCommand.tsx` using the Plan 03 chip slot.
- Audit cascade refresh of `plans/ralph-pipeline-INDEX.md` (deferring to notepad if Plan 06 is still RUNNING).

## User Stories

### US-001: parse-notepad helper

**Description:** As a sync-pipeline maintainer, I want a pure markdown-table parser for the notepad's Deferred Questions section so that I can surface unanswered-question counts in the dashboard tooltip.

**Acceptance Criteria:**
- [ ] `scripts/lib/parse-notepad.mjs` exports `parseNotepad(text) → { deferredQuestionsCount, deferredQuestionsPreview, storyDoctorInterventions }`.
- [ ] Counts rows with empty `Answer` column in `## Deferred Questions` as unanswered.
- [ ] `deferredQuestionsPreview` is the first unanswered question text trimmed to ≤120 chars.
- [ ] `storyDoctorInterventions` counts non-empty data rows in `## Story Doctor Log`.
- [ ] Malformed table → zero counts + deduped stderr warn (never throws).
- [ ] Vitest fixtures cover: empty input, no section present, 3-questions-2-answered, malformed table, story-doctor row counting.
- [ ] `scripts/lib/parse-notepad.d.mts` is generated/written.
- [ ] Typecheck passes.

### US-002: derive-pr-links helper

**Description:** As a dashboard user, I want chip tooltips to show clickable PR URLs and merge SHAs so I can navigate from a task to its review.

**Acceptance Criteria:**
- [ ] `scripts/lib/derive-pr-links.mjs` exports `derivePRLinks({ groupState?, repoRoot, branchName, stage, originUrl? }) → { branchName?, prUrl?, mergeCommit? }`.
- [ ] Reads `groupState.prUrl` defensively (returns undefined if absent — `group.json` does not currently carry it).
- [ ] Falls back to `execFileSync('git', ['-C', repoRoot, 'log', '--format=%H%n%s%n%b', '-n', '5', branchName])` and regex-scans for `https://github.com/.../pull/N` or `Closes #N`.
- [ ] **F-011 inline:** Skip git invocations entirely when `branchName` is falsy. Caller (`sync-core.mjs`) memoizes `git remote get-url origin` per sync pass and passes resolved `originUrl` in. Always wrap every git call in try/catch — never throw.
- [ ] **F-002 inline:** `mergeCommit` resolved only when `stage === 'shipped'` via single-ref `execFileSync('git', ['-C', repoRoot, 'rev-parse', branchName])`, then shorten with JS `.slice(0, 8)`.
- [ ] `Closes #N` reconstruction only when `originUrl` is a parseable GitHub URL. Non-GitHub remotes → `prUrl=undefined`.
- [ ] Missing/deleted branches, empty `git log` output, and origin lookup failures return the known `branchName` with `prUrl` / `mergeCommit` left undefined.
- [ ] Vitest cases cover: direct URL match, resolvable `Closes #N`, unresolvable `Closes #N`, missing branch (git throws), empty `git log` output, `mergeCommit` omitted for non-shipped stages, `mergeCommit` populated for shipped.
- [ ] `scripts/lib/derive-pr-links.d.mts` is generated/written.
- [ ] Uses `execFileSync` — never shell-string interpolation.
- [ ] Typecheck passes.

### US-003: append-journal helper

**Description:** As a sync-pipeline maintainer, I want per-task journal lines appended atomically on stage transitions so the dashboard surface can later display them.

**Acceptance Criteria:**
- [ ] **F-008 inline:** `scripts/lib/append-journal.mjs` exports `appendJournalEntry({ repoRoot, taskId, ts, prevStage, newStage, slug })` (semantic inputs, formats internally) AND `formatJournalLine({ ts, prevStage, newStage, slug })` for test introspection.
- [ ] Internal format: `- <ISO ts>  stage: <prev> → <new>  (job: <slug>)\n`.
- [ ] Atomic append via `fs.openSync(path, 'a')` + `writeSync` + `fsyncSync` + `closeSync` (mirror `emit-activity.mjs` lines 7–34).
- [ ] Creates `tasks/<taskId>/` directory on first call (idempotent).
- [ ] Rejects taskIds containing `/`, `\`, or `..` (path-traversal guard — throws).
- [ ] Two consecutive calls produce two lines in `tasks/<taskId>/journal.md`.
- [ ] Vitest covers: normal append, directory creation idempotency, path-traversal rejection, and `formatJournalLine` output exact match.
- [ ] `scripts/lib/append-journal.d.mts` is generated/written.
- [ ] Typecheck passes.

### US-004: Extend RalphPipelineState + snapshot schema

**Description:** As a TypeScript consumer of `RalphPipelineState`, I want the six new optional fields declared so the viewer can type-safely use them.

**Acceptance Criteria:**
- [ ] `tools/overview-viewer/src/types.ts` extends `RalphPipelineState` (lines 61–75) with six new **optional** fields in this alphabetical order to minimize merge friction with Plan 06's `NextCommand`:
  - `branchName?: string`
  - `deferredQuestionsCount?: number`
  - `deferredQuestionsPreview?: string`
  - `mergeCommit?: string`
  - `prUrl?: string`
  - `storyDoctorInterventions?: number`
- [ ] `scripts/lib/emit-snapshot-schema.mjs` declares the six fields as optional under `tasks[*].ralph`.
- [ ] `pnpm --filter @codexu/overview-viewer typecheck` passes.
- [ ] `pnpm test` still passes for `scripts/lib/emit-snapshot.test.mjs` (no schema regression).
- [ ] Additive only — existing snapshot consumers untouched.

### US-005: Wire helpers into sync-core + watcher + one-shot CLI

**Description:** As the sync pipeline, I want to call the new helpers per bundle and append journals at the right lock window so the dashboard data plane stays consistent.

**Acceptance Criteria:**
- [ ] `readJobLikeBundles()` in `scripts/lib/sync-core.mjs` reads `<bundle.dir>/notepad.md` (best-effort; missing → empty string) and attaches as `bundle.notepadText`.
- [ ] **F-001 inline:** `toPipelineState(bundle, repoRoot)` accepts `repoRoot`; `assembleStateFromBundles` updates its call site to pass the already-resolved `absoluteRepoRoot` into `toPipelineState(winner, absoluteRepoRoot)` when building `byTaskId`.
- [ ] `toPipelineState` calls `parseNotepad(bundle.notepadText ?? '')` and merges `deferredQuestionsCount`, `deferredQuestionsPreview`, `storyDoctorInterventions` into the returned state.
- [ ] After deriving `stage`, `toPipelineState` calls `derivePRLinks({ groupState: bundle.groupJson, repoRoot, branchName: bundle.prd?.branch?.name, stage, originUrl })` and merges `branchName`, `prUrl`, `mergeCommit`.
- [ ] **F-011 inline:** `assembleStateFromBundles` memoizes `git remote get-url origin` once per sync pass (single `execFileSync` call wrapped in try/catch) and threads `originUrl` through to each `derivePRLinks` call.
- [ ] `scripts/lib/watch-ralph-state.mjs` and `scripts/sync-ralph-state.mjs` both invoke `appendJournalEntry({ repoRoot, taskId: event.taskId, ts, prevStage, newStage, slug })` for each activity event where `changedFields.includes('stage')`, inside the existing sync-lock window (before lock release).
- [ ] **F-013 inline:** `scripts/lib/sync-core.d.mts` updated (if a typed bundle shape is exported) to include the optional `notepadText` field.
- [ ] **F-012 inline:** Unit tests in `scripts/lib/watch-ralph-state.test.mjs` and `scripts/sync-ralph-state.test.mjs` mock `appendJournalEntry` and assert it is invoked exactly once per stage-changed activity event with the expected `{repoRoot, taskId, prevStage, newStage, slug, ts}` arguments.
- [ ] **F-007 inline (AC-6 split):** Sync output (`overview-snapshot.json`) verified per sub-case:
  - 6a — notepad fields populated from a 3-question fixture (count, preview, storyDoctorInterventions).
  - 6b — `branchName` populated from `prd.branch.name`.
  - 6c — `prUrl` populated from a mocked commit body with `Closes #N` + resolvable origin.
  - 6d — `mergeCommit` populated only when `stage === 'shipped'`.
  - 6e — no sync failure when branch is absent in the working repo.
- [ ] Existing tests (`sync-core.test.mjs`, `emit-activity.test.mjs`, `plan05-acceptance.test.mjs`) remain green.
- [ ] Typecheck passes.

### US-006: useActivityEvents hook + Vite middleware

**Description:** As the viewer, I want a hook that fetches the activity JSONL and re-fetches on HMR so the RecentActivity sidebar stays fresh.

**Acceptance Criteria:**
- [ ] `tools/overview-viewer/src/hooks/useActivityEvents.ts` fetches `./overview-activity.jsonl?t=<Date.now()>` (cache-bust), parses JSONL line-by-line.
- [ ] On `JSON.parse` failure of the **last** line only: skip silently (torn-write tolerance). On failure of an **interior** line: `console.warn` and skip.
- [ ] Subscribes to `import.meta.hot.on('overview-ralph-state:update', refetch)`; unsubscribes via `import.meta.hot?.off(...)` on unmount, including under React StrictMode.
- [ ] Returns `ActivityEvent[]` newest-first.
- [ ] Tolerates missing file (empty array) without crashing.
- [ ] Tolerates `file://` open where fetch throws — returns empty.
- [ ] **F-005 inline:** `tools/overview-viewer/vite.config.ts` adds a new `overviewActivityPlugin()` modelled on `overviewRalphStatePlugin()` with `enforce: "pre"`, a `configureServer` hook that registers middleware for GET `/overview-activity.jsonl` serving from `plans/overview-activity.jsonl`. On `ENOENT`, responds `res.statusCode = 200; res.end('')`. The plugin is registered in `plugins:` **before** the SPA fallback.
- [ ] `tools/overview-viewer/src/__tests__/scripts.d.ts` updated alongside the new helpers (parser/PR-links/journal).
- [ ] Vitest covers the hook (mock fetch, JSONL parse, torn-last-line skip, ENOENT empty).
- [ ] Typecheck passes.

### US-007: RecentActivity sidebar + App integration + styles

**Description:** As a dashboard user, I want a right-side panel showing the last 5–10 activity events with click-through navigation.

**Acceptance Criteria:**
- [ ] **F-009 inline:** `tools/overview-viewer/src/components/RecentActivity.tsx` props are `{ activityEvents: ActivityEvent[]; setFocusedTaskId: (id: string) => void; collapsed: boolean; onToggle: () => void }` (parent-controlled collapse).
- [ ] Renders the last 5–10 events (newest first); each entry is a clickable button.
- [ ] **F-010 inline:** Render contract — when `newStage` is `null`, show `<taskId> removed`. Otherwise `<taskId> → <newStage>`. Vitest fixture-based render test covers null-newStage label.
- [ ] Each entry shows a relative timestamp.
- [ ] Empty state: `<aside className="recent-activity-sidebar empty">No recent activity yet.</aside>`.
- [ ] `tools/overview-viewer/src/App.tsx` imports `RecentActivity` + `useActivityEvents` and renders `<RecentActivity activityEvents={useActivityEvents()} setFocusedTaskId={(id) => navigateToCommand(id, expandedControls.setTaskExpanded)} collapsed={collapsed} onToggle={...} />` in a new right column. Collapsed defaults to closed in compact density mode, open otherwise.
- [ ] Click-through navigation uses existing `tools/overview-viewer/src/utils/commandNavigation.ts` `navigateToCommand()` — no new plumbing.
- [ ] `tools/overview-viewer/src/styles.css` adds `.recent-activity-sidebar` (+`.empty`), `.tooltip-extras-row`, `.tooltip-extras-row a`.
- [ ] Typecheck passes.
- [ ] Verify in browser using dev-browser skill (sidebar renders, click navigates, empty state displays when JSONL absent).

### US-008: Tooltip extras composition in TaskCommand + E2E

**Description:** As a dashboard user, I want chip tooltips to show deferred-question count, branch (with copy), and PR URL.

**Acceptance Criteria:**
- [ ] `tools/overview-viewer/src/components/TaskCommand.tsx` line 413 replaces `<RalphStageChip taskId={task.id} ralphState={ralphState} />` with a composed-extras version that builds a `tooltipExtras` JSX fragment.
- [ ] Tooltip-extras rows:
  - `deferredQuestionsCount > 0` → row `<span>📝 {n} open questions</span>` plus subline showing `deferredQuestionsPreview` if present (CSS-truncated).
  - `branchName` → row with branch text + existing `QuickCopyButton` that copies literal `git checkout <branchName>` via `copyTextWithToast` (helpers at lines 162–228).
  - `prUrl` → row with `<a href={prUrl} target="_blank" rel="noopener noreferrer">PR ↗</a>`.
- [ ] Passes JSX through `<RalphStageChip tooltipExtras={…} />` — does NOT modify `RalphStageChip.tsx` itself (Plan 03's slot is contract-stable).
- [ ] When all three fields are absent, renders nothing extra — tooltip falls back to Plan 03 minimal content (stage, jobSlug, lastUpdatedAt). No broken rows. No console warnings.
- [ ] Vitest covers all permutations (none / one / two / all three) without broken markup.
- [ ] End-to-end: populate a synthetic notepad fixture with 3 deferred questions (2 answered); run sync; hover the chip — tooltip shows `📝 1 open questions` plus preview ≤120 chars.
- [ ] Branch surfacing verification: for `prd.branch.name='ralph/overview-data-split/integration'`, the chip tooltip shows that branch plus a `QuickCopyButton` whose tooltip is `Copy \`git checkout ralph/overview-data-split/integration\`` and clicking confirms toast.
- [ ] `pnpm --filter @codexu/overview-viewer test` passes including all new tests.
- [ ] Typecheck passes.
- [ ] Verify in browser using dev-browser skill (hover chip, copy button toast, PR link opens new tab).

### US-009: Cascade refresh

**Description:** As a downstream-plan reader, I want `plans/ralph-pipeline-INDEX.md` to reflect Plan 07's new modules and types — but only when Plan 06 is not in flight.

**Acceptance Criteria:**
- [ ] **F-006 inline:** Before cascade, read `.ralph/jobs/ralph-pipeline-06-skills/progress.json`. Plan 06 is **terminal** if `progress.terminal === true` OR the directory contains only `plan.md` (not yet started). If `progress.json` exists with `terminal !== true`, **defer** cascade.
- [ ] If deferred: append entries to `<jobDir>/notepad.md` under `## Deferred Cascade` and leave `plans/ralph-pipeline-INDEX.md` untouched.
- [ ] If Plan 06 is terminal (or unstarted): update `plans/ralph-pipeline-INDEX.md` "Source-of-truth modules" table with the 5 new modules (`scripts/lib/parse-notepad.mjs`, `scripts/lib/derive-pr-links.mjs`, `scripts/lib/append-journal.mjs`, `tools/overview-viewer/src/hooks/useActivityEvents.ts`, `tools/overview-viewer/src/components/RecentActivity.tsx`).
- [ ] Extend the `RalphPipelineState` row in the table with the 6 new optional fields.
- [ ] Verify the DAG diagram still reflects Plan 07's "depends on Plan 05" edge.
- [ ] Update applied atomically in the final implementation commit; commit message lists each diff (file, lines, change) for reviewer verification.
- [ ] All other ACs (US-001..US-008) pass before US-009 starts.
- [ ] Typecheck passes (no source changes; markdown-only).

## Functional Requirements

- FR-1: `parseNotepad(text)` returns `{ deferredQuestionsCount, deferredQuestionsPreview, storyDoctorInterventions }` as a pure function with no I/O.
- FR-2: `derivePRLinks({ groupState?, repoRoot, branchName, stage, originUrl? })` returns `{ branchName?, prUrl?, mergeCommit? }`. All git calls via `execFileSync`. Skips git entirely when `branchName` is falsy. Never throws.
- FR-3: `appendJournalEntry({ repoRoot, taskId, ts, prevStage, newStage, slug })` atomically appends a single line to `tasks/<taskId>/journal.md`. Rejects path-traversal taskIds. Companion `formatJournalLine(...)` is exported for test introspection.
- FR-4: `RalphPipelineState` carries six new optional fields. `SNAPSHOT_SCHEMA` declares them as optional under `tasks[*].ralph`.
- FR-5: `readJobLikeBundles` attaches `bundle.notepadText`; `toPipelineState(bundle, repoRoot)` calls both new helpers and merges results.
- FR-6: `assembleStateFromBundles` memoizes `git remote get-url origin` per sync pass.
- FR-7: Both `watch-ralph-state.mjs` and `scripts/sync-ralph-state.mjs` invoke `appendJournalEntry` for stage-transition activity events, inside the sync lock window.
- FR-8: Vite dev server serves `/overview-activity.jsonl` from `plans/overview-activity.jsonl` via an `overviewActivityPlugin()` with `enforce: "pre"`; `ENOENT` → `200 ''`.
- FR-9: `useActivityEvents()` fetches the JSONL with cache-bust, parses defensively (torn-last-line tolerance), refetches on HMR event `overview-ralph-state:update`, unsubscribes cleanly.
- FR-10: `RecentActivity` renders the last 5–10 events newest-first; `null` `newStage` renders as `<taskId> removed`; click navigates via `navigateToCommand`.
- FR-11: `TaskCommand.tsx` composes `tooltipExtras` JSX and passes it to `RalphStageChip` (no chip modifications).
- FR-12: Cascade refresh updates `plans/ralph-pipeline-INDEX.md` if Plan 06 is terminal, otherwise defers to `notepad.md`.

## Non-Goals (Out of Scope)

- Crews session list in tooltip → Plan 08.
- MCP `overview.add_journal_entry` tool wrapping `append-journal.mjs` → Plan 09.
- Full notepad rendering (deferred-questions table viewer, story-doctor-log dialog).
- Modifying `RalphStageChip.tsx` — Plan 03's `tooltipExtras` slot is contract-stable.
- Writing PR URLs into `OverviewData.runs[]` — bookkeeper-owned.
- Web Workers / streaming JSONL parsing.
- localStorage persistence of sidebar collapse state.
- Auto-journal for `changedFields` other than `stage`.

## Design Considerations

- Right-sidebar collapses to a thin rail under compact density.
- Tooltip extras use the existing Plan 03 slot (`tooltipExtras?: ReactNode` in `RalphStageChip.tsx`) — rendered below stage/slug/lastUpdatedAt rows.
- Reuse existing `QuickCopyButton`, `QuickNavButton`, `QuickActions`, `copyTextWithToast` helpers from `TaskCommand.tsx` lines 162–228.

## Technical Considerations

- All edits land in the worktree at `D:/harness-efforts/codexu/.ralph/jobs/ralph-pipeline-07-context/worktree/` on branch `ralph-pipeline-07-context`. **Do NOT edit `main` directly.**
- Plans 01–05 + 10 are already shipped on main HEAD `88464053`. **Do NOT re-implement** what they provided.
- Use `execFileSync` for all git calls (Windows safety + injection avoidance).
- JSONL torn-line tolerance is mandatory in both Node-side readers and `useActivityEvents`.
- Bounded merge conflict with Plan 06 on `types.ts` — resolve by union-of-fields.
- Vite middleware ordering matters — register `overviewActivityPlugin()` before the SPA fallback.

## Success Metrics

- Tooltip hover shows deferred-question count + branch + PR URL for any task with non-empty notepad/branch/PR data.
- `RecentActivity` sidebar lists last 5–10 events newest-first; click navigates correctly.
- Journal file `tasks/<id>/journal.md` accumulates one line per stage transition (verified in both watch and one-shot modes).
- All ACs pass; `pnpm --filter @codexu/overview-viewer typecheck` and `pnpm test` both green.
- No regression in existing tests (`sync-core.test.mjs`, `emit-activity.test.mjs`, `plan05-acceptance.test.mjs`, `emit-snapshot.test.mjs`).

## Open Questions

1. Should `storyDoctorInterventions` count resolved entries? — Current decision: count all non-empty data rows.
2. Should sidebar collapse state persist across reloads? — Current decision: no (in-session only).
3. `Closes #N` reconstruction is GitHub-only. Azure DevOps / GitLab support deferred to Plan 08.
4. Journal entries for non-stage `changedFields` deferred (RecentActivity surfaces these instead).
5. `group.json.prUrl` source-of-truth — read defensively; no plan-side change needed.
