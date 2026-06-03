# Stories Outline: blockedOn dependency + unblock-candidate notify

*Preliminary decomposition from `/plan-with-ralph`. Feed to `/implement-with-ralph --from-plan .ralph/jobs/overview-task-blocked-on-with-auto-unblock/plan.md` for PRD generation. All file paths are relative to the toolkit submodule `ai-developer-toolkit/plugins/ralph-overview/` unless otherwise noted; the implementer works inside the `ai-developer-toolkit/` submodule and never touches the codexu repo or pushes to `main`.*

## US-001: Schema-drift trio + plugin AGENTS.md update + test:lib expansion

**Description:** As a plugin maintainer, I want the `OverviewTask`, `SnapshotTask`, and `Recommendation` schemas to declare `blockedOn` and `unblockCandidate` consistently across TypeScript, Zod, and JSON Schema surfaces — and the plugin AGENTS.md to reflect the current MCP tool list — so downstream code can rely on the new fields and the doc-vs-code drift is closed.

**Acceptance Criteria:**
- [ ] `tools/overview-viewer/src/types.ts` declares `blockedOn?: string[]` on `OverviewTask` and `unblockCandidate?: boolean` on both `SnapshotTask` and `Recommendation`.
- [ ] `tools/overview-mcp/src/tools/validate-data-schema.ts` declares `blockedOn: z.array(z.string()).optional()` on `zodOverviewTaskSchema`.
- [ ] `scripts/lib/emit-snapshot-schema.mjs` declares `blockedOn: { type: 'array', items: { type: 'string' } }` on `OverviewTask` $def, `unblockCandidate: { type: 'boolean' }` on both `SnapshotTask` and `Recommendation` $defs.
- [ ] `scripts/lib/parse-overview-data.test.mjs` (NEW sibling file, NOT under `__tests__/`) covers additive `blockedOn` pass-through.
- [ ] `package.json` `test:lib` script lists ALL new lib test files (`unblock-candidates.test.mjs`, `score-recommendations.test.mjs`, `derive-dependency-graph.test.mjs`, `parse-overview-data.test.mjs`) in addition to the existing `repo-root.test.mjs` and `emit-snapshot.test.mjs`.
- [ ] Plugin `AGENTS.md` `MCP Surface` section no longer says "exactly 4 tools"; lists all 6 current tools (init, validate_data, parallel_ready_tasks, expand_task_context, watcher_status, unblock_candidates).
- [ ] `npm run typecheck` passes; `npm test` `validate-data.test.ts` drift-check passes.
- [ ] Typecheck passes.

**Dependencies:** None.
**Estimated complexity:** medium.

## US-002: Pure detector helper + shared truth-table fixture

**Description:** As a downstream consumer (snapshot emitter, recommendations scorer, MCP tool, viewer), I want a single source-of-truth predicate for "is this task an unblock candidate?" exposed via a tiny pure helper, with a shared fixture file ensuring the `.mjs` and `.ts` mirrors cannot drift silently.

**Acceptance Criteria:**
- [ ] `scripts/lib/unblock-candidates.mjs` exports `computeUnblockCandidate(task, tasksById)` returning `{ unblockCandidate, blockers, reason }` and `findUnblockCandidates(overviewData)` returning a batch.
- [ ] Predicate: `task.status === 'blocked' && Array.isArray(task.blockedOn) && task.blockedOn.length > 0 && task.blockedOn.every(id => tasksById.get(id)?.lifecycle === 'merged')`.
- [ ] `scripts/lib/fixtures/unblock-candidates-truth-table.json` declares all 9 truth-table cases (a through i) as JSON with `input`, `expected`, `description` fields.
- [ ] `scripts/lib/unblock-candidates.test.mjs` loads the fixture and asserts every case.
- [ ] All test cases pass; full plugin `npm test` exits 0.
- [ ] Typecheck passes.

**Dependencies:** None (file-disjoint from US-001).
**Estimated complexity:** small.

## US-003: Snapshot + recommendation emitter integration

**Description:** As a sync pipeline consumer, I want the snapshot to carry `unblockCandidate: true` on qualifying tasks and the recommendations to surface candidates in a separate array (outside the `topN` truncation), so the bookkeeper sees them during routine planning without needing to read raw `data.json`.

**Acceptance Criteria:**
- [ ] `scripts/lib/emit-snapshot.mjs` `buildSnapshot()` computes the candidate flag per task via the shared detector and sets `unblockCandidate: true` only when true (omits the field when false).
- [ ] `scripts/lib/score-recommendations.mjs` returns `{ topRecommendations: Recommendation[], unblockCandidates: Recommendation[] }`. The existing topN-bounded list becomes `topRecommendations`. Candidates are emitted in `unblockCandidates` with `score: 1.0`, `stage: 'blocked'`, `unblockCandidate: true`, `reasons: ['unblock candidate: all blockedOn tasks merged']`, sorted by `taskId` ascending. Deduplicate: if a task appears in both arrays, the candidate entry wins and the byTaskId entry is removed from `topRecommendations`.
- [ ] `scripts/lib/derive-dependency-graph.mjs` emits `from: task.id, to: blockedOnId, type: 'blocks'` for each `task.blockedOn[i]` (reuses existing `'blocks'` edge type; no new type introduced).
- [ ] `emit-derived-artifacts.mjs` audited; if it consumes the scorer output, handle the wrapped shape; if it writes `recommendations.json`, write the wrapped object.
- [ ] `emit-snapshot.mjs` accepts BOTH wrapped and flat recommendations input for back-compat (spread wrapped → flat for the snapshot's `recommendations` field).
- [ ] All emitter tests (truth-table coverage, wrap-shape, dedup, dependency-graph) pass under `npm run test:lib`.
- [ ] Codexu smoke: `pnpm sync-ralph-state` exits 0; `.ralph-overview/generated/snapshot.json` validates against Ajv.
- [ ] Typecheck passes.

**Dependencies:** US-001, US-002.
**Estimated complexity:** medium.

## US-004: MCP tool surface + shared task-title helper

**Description:** As an MCP client (agent or operator), I want a dedicated `overview.unblock_candidates` tool that returns the list of currently-candidate tasks with their IDs, titles, blockedOn lists, and reasons — so I can surface notifications without reading the full snapshot. Title rendering is shared with `parallel_ready_tasks` to prevent drift.

**Acceptance Criteria:**
- [ ] `tools/overview-mcp/src/utils/task-title.ts` exports `taskTitle(task: SnapshotTask): string` and `plaintext(html: string | undefined): string | undefined`, extracted from the existing private helpers in `parallel-ready-tasks.ts:399-417`.
- [ ] `tools/overview-mcp/src/tools/parallel-ready-tasks.ts` is refactored to import the shared helpers (no behavioral change; private copies deleted).
- [ ] `tools/overview-mcp/src/tools/unblock-candidates.ts` registers `overview.unblock_candidates` tool returning `{ candidates: Array<{ taskId, title, blockedOn, reason }> }`. Uses `context.snapshotReader.getSnapshot()` to read pre-emitted candidate flags (snapshot is canonical).
- [ ] `tools/overview-mcp/src/server.ts` calls `registerUnblockCandidatesTool(server, context)`.
- [ ] `tools/overview-mcp/src/__tests__/unblock-candidates.test.ts` asserts: 2-candidate snapshot returns both; 0-candidate snapshot returns empty array; missing snapshot returns standard error envelope.
- [ ] `tools/overview-mcp/src/__tests__/validate-data.test.ts` drift-check passes.
- [ ] MCP `npm test` workspace exits 0.
- [ ] Typecheck passes.

**Dependencies:** US-001, US-002.
**Estimated complexity:** medium.

## US-005: Viewer NOTIFY chip (Kanban + TaskCommand) with App.tsx memoization

**Description:** As a bookkeeper using the static viewer, I want a visual NOTIFY chip on candidate task cards and command rows so I can NOTICE which blocked tasks have had their blockers shipped and DECIDE whether to flip them. The chip is passive — no auto-flip button.

**Acceptance Criteria:**
- [ ] `tools/overview-viewer/src/utils/unblockCandidates.ts` exports `computeUnblockCandidate(task: OverviewTask, tasksById: Map<string, OverviewTask>): boolean`. Same predicate as the `.mjs` version.
- [ ] `tools/overview-viewer/src/utils/unblockCandidates.test.ts` loads the SAME shared fixture at `scripts/lib/fixtures/unblock-candidates-truth-table.json` (relative-path or path-mapped import — both tests must consume the same file).
- [ ] `tools/overview-viewer/src/App.tsx` builds `tasksById` via `useMemo` keyed on `data.tasks` reference; passes the Map down to `Kanban` and `TaskCommand` as a prop. Kanban + TaskCommand do NOT construct the Map themselves.
- [ ] `tools/overview-viewer/src/components/Kanban.tsx` `kanbanCardHtml()` accepts a candidate flag from the caller and injects a `.kanban-unblock-pill` element with text `"NOTIFY"` and the tooltip `"Blockers all merged — review whether this task is ready to unblock"`.
- [ ] `tools/overview-viewer/src/components/TaskCommand.tsx` adds an inline `<UnblockNotifyChip />` between `StatusBadge` and `WorkstreamPill`; same tooltip text.
- [ ] `tools/overview-viewer/src/styles.css` defines `.cmd-badge.unblock-notify` and `.kanban-unblock-pill` with high-contrast colors, no animation, no smooth-scroll triggers.
- [ ] `kanban.test.tsx` SSR test: candidate task card contains the NOTIFY pill class; non-candidate does not.
- [ ] `taskCommand.test.tsx` SSR test: candidate row contains `.cmd-badge.unblock-notify`; non-candidate does not.
- [ ] Viewer `npm test` workspace exits 0.
- [ ] Manual smoke: `cd D:/harness-efforts/codexu && pnpm overview:build` exits 0; `.ralph-overview/generated/overview.html` contains the new CSS class strings.
- [ ] Typecheck passes.

**Dependencies:** US-001 (types), US-002 (shared fixture); file-disjoint from US-003 + US-004.
**Estimated complexity:** medium.

## US-006: Advisory backfill candidates report

**Description:** As the bookkeeper-lead, I want an advisory report listing the 5 currently-blocked codexu tasks with their existing blocker prose mined from `data.json`, plus the implementer's best-guess `blockedOn` array for each — so I can decide which entries to apply by hand after the schema work ships. The implementer does NOT edit `data.json`.

**Acceptance Criteria:**
- [ ] `<job_dir>/backfill-candidates.md` exists (path = `.ralph/jobs/overview-task-blocked-on-with-auto-unblock/backfill-candidates.md` in the codexu repo / impl worktree).
- [ ] File lists ALL 5 currently-blocked tasks: `3b-agents`, `3d-workers`, `3fg-package`, `agent-comms`, `escalate-gim-home-actions-policy`.
- [ ] Each entry includes: task-id heading, quoted prose from `data.json` (with line citations) describing the current blocker, the implementer's proposed `blockedOn` array, and an explicit "needs operator verification" annotation.
- [ ] File preamble states explicitly that this is an advisory report; the impl does NOT edit `data.json`; the bookkeeper hand-applies after review.
- [ ] Implementer's final summary references the file path so the lead can find it.
- [ ] No `data.json` edits in the impl diff: `git diff origin/main -- .ralph-overview/data.json` is empty.
- [ ] Typecheck passes (no code change).

**Dependencies:** US-003 (detector must be wired for the implementer to validate its own proposed entries against the detector locally).
**Estimated complexity:** small.

## US-007: Impl-side release prep (CHANGELOG, plugin.json, marketplace indexes)

**Description:** As the implementer, I want to bump the plugin version, update the CHANGELOG, and update the three marketplace indexes — and commit the result to the topic branch — so the lead has a ready-to-FF-merge branch. The implementer does NOT push toolkit `main`; the implementer does NOT touch the codexu repo.

**Acceptance Criteria:**
- [ ] `ai-developer-toolkit/plugins/ralph-overview/.claude-plugin/plugin.json` `version` is `"2.8.0"`.
- [ ] `ai-developer-toolkit/plugins/ralph-overview/CHANGELOG.md` has a `## v2.8.0` entry at the top using NOTIFY / candidate framing (NEVER "auto-unblock" as a verb); calls out: blockedOn field, unblockCandidate flag, new MCP tool, NOTIFY chip in viewer, total MCP tool count now 6, breaking-but-minor scorer wrap-shape change.
- [ ] `ai-developer-toolkit/.claude-plugin/marketplace.json` `ralph-overview` entry version `"2.8.0"`.
- [ ] `ai-developer-toolkit/.github/plugin/marketplace.json` same.
- [ ] `ai-developer-toolkit/.agents/plugins/marketplace.json` same.
- [ ] `ai-developer-toolkit/plugins/ralph-overview/package.json` `version` field is UNCHANGED (still `"1.0.0"`) — that field is the workspace package version, NOT the plugin version.
- [ ] All changes committed to the `ralph/overview-task-blocked-on-with-auto-unblock` topic branch in the toolkit submodule.
- [ ] Topic branch pushed to `git remote origin` of the toolkit submodule (NOT main, NOT to `personal` or `gim-home` — those are lead-owned multi-remote pushes).
- [ ] NO commit anywhere modifies the codexu repo (parent of submodule). NO codexu submodule pointer bump. NO codexu `AGENTS.md` edit.
- [ ] Typecheck passes; `npm test` passes (running from the toolkit topic branch).

**Dependencies:** US-001, US-002, US-003, US-004, US-005, US-006.
**Estimated complexity:** small.

## US-008: Lead handoff report

**Description:** As the bookkeeper-lead picking up this implementation, I want a concrete checklist with SHAs, branch names, and ordered steps for the lead-owned release ceremonies so I can execute the multi-remote push + codexu submodule pointer bump without ambiguity.

**Acceptance Criteria:**
- [ ] `<job_dir>/lead-handoff.md` exists (path = `.ralph/jobs/overview-task-blocked-on-with-auto-unblock/lead-handoff.md` in the codexu repo / impl worktree).
- [ ] File enumerates exactly the 12 lead-owned steps from `plan.md` "Lead-owned release ceremonies" section, filled in with: concrete topic-branch HEAD SHA from the toolkit, list of files modified in the topic branch, expected behavioral changes the lead should sanity-check post-merge.
- [ ] File includes an explicit "STOP — operator/lead approval required" message at the top: `## STOP — lead approval required before main merge / multi-remote push / codexu pointer bump. See checklist below.`
- [ ] Implementer's final summary includes the file path AND the STOP message verbatim.
- [ ] No autonomous push to toolkit `main`. No autonomous push to `personal` or `gim-home`. No autonomous codexu commit. Verify (PowerShell from impl worktree): `git log origin/main --not main | Measure-Object | Select-Object -ExpandProperty Count` returns 0 (no commits on toolkit main beyond what was already there). And: in the codexu repo `git status` is clean (no submodule-pointer changes staged, no AGENTS.md edits).
- [ ] Typecheck passes (no code change).

**Dependencies:** US-006, US-007 (needs the topic-branch SHA + file list).
**Estimated complexity:** small.
