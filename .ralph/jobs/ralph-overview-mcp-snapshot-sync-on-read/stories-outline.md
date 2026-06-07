# Stories Outline: Lifecycle-first sync-on-read + staleness guard for `overview.parallel_ready_tasks`

*Preliminary decomposition from `/plan-with-ralph`. Feed to `/implement-with-ralph --from-plan` for PRD generation.*

*All code lives in the `ai-developer-toolkit` submodule under `plugins/ralph-overview/`. Follow the
two-commit submodule flow (see plan: Repo & Submodule Workflow). Stories run SERIALLY in one cluster
(`lifecycle-first-read`) — they share `parallel-ready-tasks.ts` + its test file.*

## US-001: Lifecycle-first authoritative candidate construction
**Description:** As the bookkeeper, I want `overview.parallel_ready_tasks` to build its task set + lifecycle from a FRESH read of `.ralph-overview/data.json` (overlaying only the snapshot's `ralph` enrichment), and to hard-exclude `merged`/`archived` tasks, so a stale or dead snapshot can never surface already-shipped work.
**Acceptance Criteria:**
- [ ] `parallelReadyTasks()` builds candidates from `getOverviewData().tasks` (authoritative), not `snapshot.tasks`. Each candidate is `{ ...overviewTask, ralph: snap?.ralph, unblockCandidate: snap?.unblockCandidate }`; snapshot-only tasks absent from data.json are dropped.
- [ ] A hard lifecycle gate (`EXCLUDED_LIFECYCLES = {merged, archived}`, read from the normalized `task.lifecycle`) runs BEFORE the stage gate, independent of Ralph stage. (AC1)
- [ ] Given a fixture where data.json marks N snapshot-ready-staged tasks `merged`/`archived` and the snapshot is NOT re-synced, the tool returns zero of those N tasks. (AC1)
- [ ] `SnapshotReader.getOverviewData()` is mtime-guarded (re-reads when the `dataFile` mtime changes) so freshness does not depend on `reader.start()` / the in-process watcher; a direct `snapshot-reader.test.ts` proves a `data.json` mutation + `setMtime()` is reflected WITHOUT `start()`. (AC8)
- [ ] `loadPrdsByTaskId(...)` is called with the already-loaded `overviewData` to avoid a second data.json parse per call.
- [ ] If `task-aliases.mjs`'s `resolveTaskLifecycle` is imported, `scripts/lib/task-aliases.d.mts` is added; otherwise the normalized `task.lifecycle` is read directly (no new import).
- [ ] Typecheck passes
**Dependencies:** None
**Estimated complexity:** medium

## US-002: Authoritative readiness + same-day-filing inclusion
**Description:** As the bookkeeper, I want newly-filed `tracked` tasks that are absent from a stale snapshot to still surface with a kickoff command and an awaiting-sync flag, and I want prerequisite/blocker readiness re-derived from authoritative data.json so `blockedOn` and reverse `blocks` are honored even without a fresh snapshot.
**Acceptance Criteria:**
- [ ] Readiness uses a FRESH dependency graph from `deriveDependencyGraph({ byTaskId, overviewData, prdsByTaskId })` (not the stale `snapshot.dependencyGraph`), where `byTaskId` is a `Record<string, RalphPipelineState>` built from snapshot tasks (`Object.fromEntries(snapshot.tasks.flatMap(t => t.ralph ? [[t.id, t.ralph]] : []))`), `overviewData` is the fresh data.json, and `prdsByTaskId` is the loaded PRDs. Confirmed to derive only from its arguments with no `.ralph/jobs/*` job-state walk. Edge orientation (dependent→prerequisite) and the `spawn`-never-blocks rule are preserved. The merged `Map<string, SnapshotTask>` is kept separate for readiness/title lookups.
- [ ] A prerequisite `P` is satisfied iff `P.lifecycle === 'merged'` OR `P.ralph?.stage === 'shipped'` (looked up in the merged `tasksById`). A `tracked` dependent whose only blocker is `merged` is actionable even when the blocker's snapshot stage is stale. (AC4)
- [ ] A snapshot-absent `tracked` task is returned with a non-null kickoff `command` (from `initialStage` + `command.prompts` via `deriveNextCommand(undefined, task)`) and `enrichment === 'awaiting-sync'`. (AC2)
- [ ] A snapshot-absent `tracked` task with `blockedOn:[X]` where X's lifecycle ≠ `merged` is NOT actionable; flipping X to `merged` makes it actionable. A data.json-only reverse `blocks` relationship is honored under a missing snapshot. (AC5)
- [ ] Graceful missing snapshot: with data.json present and `snapshot.json` absent, the tool returns `ok:true` with data.json-driven candidates all `enrichment:'awaiting-sync'`, `snapshotAgeMs === null`, and a snapshot-missing `snapshotStaleReason` (replaces the current hard `{ok:false,'missing snapshot'}`). Only an absent data.json returns `ok:false`. (AC6)
- [ ] The full existing `parallel-ready-tasks.test.ts` (dependency + story gating + curator-conflict + watcher-failure) passes; only fixtures gaining explicit blocker lifecycle change, not assertions. (AC7)
- [ ] Typecheck passes
**Dependencies:** US-001
**Estimated complexity:** large

## US-003: Staleness surfacing + tool description + performance guard
**Description:** As the bookkeeper, I want the tool to surface how stale the snapshot enrichment is, so I never silently plan from stale dynamic fields, and I want the lifecycle read proven sub-second / no-full-sync.
**Acceptance Criteria:**
- [ ] Result gains `snapshotAgeMs?: number | null` (= `Date.now() - snapshotMtimeMs`; `null` when the snapshot is missing) and `snapshotStaleReason?: string`; existing `snapshotStaleSince` retained. (AC3)
- [ ] When `snapshot.json` mtime < `data.json` mtime, the result includes a numeric `snapshotAgeMs` and a `snapshotStaleReason` that includes the age and a stable marker for the `data.json newer than snapshot` case (distinct from the snapshot-missing wording). Verified via a `setMtime()` test. (AC3)
- [ ] The tool `description` states the lifecycle-authoritative + staleness contract.
- [ ] AC9 instrumentation: the read path parses data.json at most once per call (asserted via a spy/mock on `loadOverviewData` call-count ≤ 1 or a test-only parse counter) and performs no job-state walk beyond the existing `computeSnapshotStaleSince` mtime stats; a 300-task synthetic timer is informational only. (AC9)
- [ ] No consumer asserts an exact `ReadyTask` key set and no docs/snapshot fixture pins the result shape (additive fields confirmed safe).
- [ ] Typecheck passes
**Dependencies:** US-001
**Estimated complexity:** medium

## US-004: Version bump to 2.10.0 + docs + submodule bookkeeping
**Description:** As a maintainer, I want the plugin shipped at 2.10.0 across all version surfaces and the behavior documented, following the codexu submodule conventions and the repo's release-plugin workflow.
**Acceptance Criteria:**
- [ ] Version bump performed via the repo-level `/release-plugin` skill (or by mirroring its exact outputs), NOT ad-hoc hand edits: `plugins/ralph-overview/.claude-plugin/plugin.json` 2.9.0 → 2.10.0 plus all three toolkit-root marketplace indexes (`ai-developer-toolkit/.claude-plugin/marketplace.json`, `ai-developer-toolkit/.github/plugin/marketplace.json`, `ai-developer-toolkit/.agents/plugins/marketplace.json`) reporting 2.10.0.
- [ ] `plugins/ralph-overview/CHANGELOG.md` has a 2.10.0 entry; `node tools/validate-codex-marketplace-policy.mjs` (from the toolkit root) passes.
- [ ] `plugins/ralph-overview/AGENTS.md` adds a `v2.10.0 Behavioral Additions` section (lifecycle-first read, merged/archived hard exclusion, same-day filing inclusion, `snapshotAgeMs`/`snapshotStaleReason`, mtime-guarded getOverviewData).
- [ ] Root codexu `AGENTS.md` Active Plugin Versions table reads `ralph-overview 2.10.0`, committed in the codexu submodule-pointer-bump commit (NOT the submodule commit). Do NOT `git add` the gitignored codexu `CLAUDE.md`.
- [ ] Two-commit submodule flow followed: ai-developer-toolkit commit, then codexu pointer-bump commit. All commits are LOCAL — do NOT push to shared branches or cut the release / push to release remotes without lead/operator approval (ask before push; the lead owns the FF-merge + multi-remote release push).
- [ ] Typecheck passes; `npm test` green.
**Dependencies:** US-001, US-002, US-003
**Estimated complexity:** medium
