---
overviewTaskId: ralph-overview-mcp-snapshot-sync-on-read
---

## Direction
D-001 — Lifecycle-first sync-on-read + staleness guard. Make the MCP ready-task read path treat `.ralph-overview/data.json` as the authoritative source for the task set and lifecycle on every call, so the bookkeeper never plans a batch from stale data — while keeping the heavy watcher-derived stage/dependency fields as best-effort enrichment.

**Version bump target:** ralph-overview `2.9.0` → `2.10.0` (minor — additive MCP response fields + a behavioral correctness fix; no breaking schema change).

## Goal
After this is built correctly:
- `overview.parallel_ready_tasks` **never** returns a task whose authoritative `data.json` lifecycle is `merged` or `archived`, even when `snapshot.json` is stale or the watcher is dead. (Fixes the "28 already merged/archived" half of the 2026-06-06 incident.)
- A task newly filed in `data.json` but absent from a stale `snapshot.json` **still surfaces**, using its `initialStage` + `command.prompts` kickoff command, flagged so the caller knows its dynamic stage/dependency fields are not yet watcher-derived. (Fixes the "omitted same-day filings" half.)
- The tool returns `snapshotAgeMs` and a clear stale indicator whenever `snapshot.json` mtime is older than `data.json` mtime (elevating the already-computed `snapshotStaleSince`/`watcherFailure` signals from silent advisory metadata into a surfaced warning).
- The lifecycle read path stays fast (sub-second on codexu-scale `data.json`) — it does **not** trigger the ~17s full job-state sync per call.

## Scope
### In Scope
- Modify `tools/overview-mcp/src/tools/parallel-ready-tasks.ts` so candidate construction is driven by a fresh read of `data.json` (via the existing `SnapshotReader.getOverviewData()` / `loadOverviewData()`), with snapshot Ralph stage + dependency-graph data overlaid as enrichment only where the task exists in the snapshot.
- Add a hard lifecycle-exclusion invariant: a task with `lifecycle` `merged` or `archived` is never a ready candidate, independent of its Ralph `stage`.
- Include `tracked` tasks present in `data.json` but absent from the snapshot, surfacing `deriveNextCommand(task.ralph, task)` from `initialStage` + `command.prompts`, with conservative readiness semantics: direct `blockedOn` / lifecycle dependencies from `data.json` are authoritative; PRD/story dependency readiness is marked unknown / awaiting-sync until the watcher catches up.
- Surface `snapshotAgeMs` and a stale reason in the tool result envelope (extend the existing `snapshotStaleSince` field).
- Tests: stale-snapshot fixtures proving (a) merged/archived tasks are excluded with no re-sync, and (b) a same-day-filed tracked task absent from the snapshot is included with the awaiting-sync caveat. Keep existing dependency/story-gating readiness tests green.
- `plugin.json` bump to 2.10.0 + the three marketplace indexes + CHANGELOG entry.

### Out of Scope
- Full sync-on-read (rejected — ~17s per call is too slow; turns a quick planning tool into a blocking op).
- Sync-on-write hooks as a correctness boundary (deferred convenience-only layer — misses manual edits, merges, branch switches, failed hooks).
- Re-architecting watcher ownership / lease model; `WatcherSupervisor` cold-start hardening (D-002) is an optional follow-up, not required for this fix.
- Changing how the heavy job-state-derived stage fields are produced (they stay watcher-updated).
- Broadening lifecycle-overlay to tools beyond what's needed; `overview.unblock_candidates` already reads `data.json` lifecycle, and `overview.expand_task_context` is optional.

## Criteria
- Given a fixture where `data.json` marks N snapshot-ready tasks as `merged`/`archived` and the snapshot is NOT re-synced, `overview.parallel_ready_tasks` returns zero of those N tasks.
- Given a fixture where `data.json` contains a new `tracked` task absent from `snapshot.json`, the tool returns that task with its kickoff command and an awaiting-sync / stage-unknown caveat.
- The tool result includes `snapshotAgeMs` (and a stale reason) whenever `snapshot.json` mtime is older than `data.json` mtime.
- The lifecycle read path completes well under 1s on codexu-scale `data.json` (measured/asserted).
- Existing readiness tests (dependency + story gating) still pass.
- `plugin.json` and all three marketplace indexes report `2.10.0`; CHANGELOG updated.

## Context
Three independent lenses (Codex xhigh, Copilot xhigh, Devil's Advocate) plus direct code grounding converged on D-001 as the primary fix. The key code-grounded insight: the read-path bug is real and independent of watcher freshness — `parallel-ready-tasks.ts` builds candidates from `snapshot.tasks` and filters via `isCandidateStage()`, which checks only Ralph `stage` against `EXCLUDED_STAGES = {shipped, replan-pending, blocked}` and **never checks `task.lifecycle`**. So even a fresh snapshot can return a `lifecycle: merged` task whose derived stage is `planning`/`plan-ready`. Most of the infrastructure already exists: `SnapshotReader.getOverviewData()` reads `data.json` directly, and the tool already computes `snapshotStaleSince` + `watcherFailure`; D-001 wires the authoritative lifecycle path into candidate construction and elevates the staleness signal.

**Disconfirming observation to validate during planning:** D-001 is wrong if a codexu-scale benchmark shows fresh `data.json` parse + data-first candidate construction is not comfortably sub-second, OR if the bookkeeper genuinely needs fully-current job-state/PRD dependency resolution before safely excluding merged/archived and including new filings. Concrete disproof: mark many snapshot-ready tasks merged/archived and add a new tracked task, do NOT sync, and the data-first implementation still returns the merged/archived tasks or omits the new task.

**Open questions to resolve in planning:**
- Newer-`data.json`-than-snapshot: return lifecycle-correct results with a warning (lens-preferred) vs fail-closed unless `allowStale`?
- Minimal readiness semantics for new tasks absent from the snapshot (`initialStage` + prompts + `blockedOn` vs full PRD/dependencyGraph derivation)?
- Elevate `snapshotAgeMs`/`snapshotStaleSince` to a hard warning in the result prose so agents can't silently plan from stale dynamic fields?
- (Devil's Advocate) Confirm whether the 2026-06-06 incident was partly an older marketplace build lacking `WatcherSupervisor` — even if so, the call-path lifecycle gap is real and worth fixing.

D-002 (harden the MCP-owned watcher as a background accelerator) is retained for the secondary stage/dependency fields but is not the primary fix. D-003 (sync-on-write hook + freshness contract) is at most a convenience layer behind D-001's read-time lifecycle correctness; full sync-on-read is rejected on latency.
