# Stories Outline: ralph-overview ready-list/recommendations exclude merged/archived lifecycle

*Preliminary decomposition from `/plan-with-ralph`. Feed to `/implement-with-ralph --from-plan` for PRD generation.*

## US-001: Node-side lifecycle gate for watcher recommendations + unblock candidates
**Description:** As a bookkeeper, I want the watcher recommendation surfaces (`recommendations.json` + `snapshot.recommendations`) and the Node unblock-candidate predicate to exclude `merged`/`archived` (alias-aware) tasks, so already-shipped/archived work never surfaces as actionable.
**Acceptance Criteria:**
- [ ] `scripts/lib/score-recommendations.mjs` imports `classifyShard` from `./data-store.mjs` and filters `topRecommendations` to drop entries whose overview task is `cold` (merged/archived), with an `!task` guard so a `byTaskId` entry absent from `overviewData.tasks` (unknown lifecycle) is KEPT.
- [ ] A `lifecycle: merged`/`archived` task (incl. legacy `phase: shipped`/`closed`) with a non-`shipped` Ralph stage (e.g. `implementing`, `plan-ready`) is excluded from `topRecommendations`; a `lifecycle: tracked` task with a ready stage is kept.
- [ ] `scripts/lib/unblock-candidates.mjs` imports `classifyShard`; `computeUnblockCandidate` computes `blockers` then early-returns `{ unblockCandidate: false, blockers, reason: 'task already merged/archived' }` when the candidate task itself is `cold` — so such a task is absent from `findUnblockCandidates`, `scoreRecommendations().unblockCandidates`, `snapshot.recommendations`, the per-task `snapshot.unblockCandidate` flag, and (transitively) the `overview.unblock_candidates` MCP tool.
- [ ] Shared fixture `scripts/lib/fixtures/unblock-candidates-truth-table.json` gains modern `lifecycle: merged` and `lifecycle: archived` CANDIDATE cases (`status: 'blocked'` + a merged blocker; `expected.unblockCandidate: false` + `expected.blockers`), exercised by both Node and viewer tests.
- [ ] `scripts/lib/unblock-candidates.test.mjs` adds Node-only INLINE cases for legacy `phase: shipped`/`closed` candidate exclusion (NOT in the shared fixture).
- [ ] `scripts/lib/score-recommendations.test.mjs` adds Node-only inline cases: merged/archived/legacy-phase excluded from `topRecommendations`; tracked-ready kept; unknown-lifecycle (no `overviewData.tasks` row) kept.
- [ ] Thin guards: `emit-snapshot.test.mjs` (merged blocked task not flagged per-task `unblockCandidate`, absent from `snapshot.recommendations`) and `emit-derived-artifacts.test.mjs` (merged task with stale stage absent from `recommendations.json`).
- [ ] The lifecycle/stage axis split is preserved (no production code collapses lifecycle into stage).
- [ ] `npm run test:lib` passes (saved to `test-output-lib.log`); typecheck passes.
**Dependencies:** None
**Estimated complexity:** small

## US-002: Viewer NOTIFY-chip lifecycle gate
**Description:** As a bookkeeper looking at the dashboard, I want the command-row and kanban NOTIFY chips to not render for `merged`/`archived` blocked tasks, so the viewer never surfaces shipped/archived work as actionable.
**Acceptance Criteria:**
- [ ] `tools/overview-viewer/src/utils/unblockCandidates.ts` imports `taskLifecycle` from `./taskAliases` and early-returns `false` when `task && (taskLifecycle(task) === 'merged' || taskLifecycle(task) === 'archived')`, before the existing `status`/`blockedOn` check. (Browser-safe: no `node:fs`/`data-store.mjs` import.)
- [ ] Neither the command-row NOTIFY chip (`TaskCommand.tsx:572`) nor the kanban NOTIFY pill (`Kanban.tsx:40`) renders for a merged/archived blocked task; a `tracked` blocked task with all-merged blockers still shows the chip.
- [ ] The existing co-located viewer test `tools/overview-viewer/src/utils/unblockCandidates.test.ts` passes for the new shared-fixture merged/archived candidate cases (US-001) with NO new test file added.
- [ ] `npm run test:viewer` passes (saved to `test-output-viewer.log`); viewer typecheck passes.
**Dependencies:** US-001 (the viewer test consumes the shared fixture cases added in US-001)
**Estimated complexity:** small

## US-003: ralph-overview release ceremony (2.14.0)
**Description:** As a plugin maintainer, I want the version bumped consistently across all manifests and marketplace indexes with a CHANGELOG + AGENTS.md note, so consumers under every engine pick up the fix.
**Acceptance Criteria:**
- [ ] Version `2.13.0 → 2.14.0` in ALL THREE `plugin.json` manifests: `.claude-plugin/plugin.json`, `.codex-plugin/plugin.json`, `.github/plugin/plugin.json`.
- [ ] Version `→ 2.14.0` in the ralph-overview entry of all three marketplace indexes: `ai-developer-toolkit/.claude-plugin/marketplace.json`, `.github/plugin/marketplace.json`, `.agents/plugins/marketplace.json` (Codex schema; preserve `policy` enums).
- [ ] `plugins/ralph-overview/CHANGELOG.md` has a `[2.14.0]` entry describing the recommendations + unblock + viewer-NOTIFY lifecycle gate (noting `parallel_ready_tasks` was already gated in v2.10.0, and that `blockerSummary`'s blocker-completion check is intentionally unchanged).
- [ ] `plugins/ralph-overview/AGENTS.md` has a matching behavioral note.
- [ ] `node tools/validate-codex-marketplace-policy.mjs` (from toolkit root) exits 0.
**Dependencies:** US-001, US-002
**Estimated complexity:** small
