# Research Brief — blockedOn + unblock-candidate notify (autonomous synthesis)

Synthesizes the parallel Phase 2 outputs from four sources: `researcher`, `architect`, Codex (`codex-research.txt`), Copilot (`copilot-research.txt`). All four ran on the plan worktree at `D:/harness-efforts/codexu/.ralph/jobs/overview-task-blocked-on-with-auto-unblock/worktree/plan/`.

## 4-way consensus matrix

| Decision | Verdict | Rationale |
|---|---|---|
| `unblockCandidate` location | **Snapshot output + Recommendation output (Option C)**; do NOT add to source `OverviewTask` | Codex explicit: keep input schema clean; Copilot + Architect agree on both surfaces. Snapshot is canonical, recommendations surface for UX. |
| New MCP tool vs. extend | **NEW tool `overview.unblock_candidates`** (3-of-4: Researcher implicit, Codex, Copilot) | Copilot + Codex blocking reason: `overview.parallel_ready_tasks` explicitly excludes `blocked` stages (`EXCLUDED_STAGES` set) and is for *spawnable* work. Unblock candidates are notify-only — different semantic. Researcher confirms a 5th tool (`expand_task_context`) already exists, so AGENTS.md "exactly 4 tools" is stale; adding a 6th is precedented. |
| Viewer marker location | **Both Kanban card + Command row** | Architect explicit; Copilot+Codex agree on Kanban; Codex notes TaskCommand for non-kanban visibility. Use existing chip patterns (`ScopeChip`, `WorkstreamPill`). |
| Edge type for `blockedOn` in dependency graph | **Reuse `blocks`** | Architect: graph convention is dependent→prerequisite. `task.blockedOn=[B]` is already in that convention; emit edge `task → B` with `type: 'blocks'`. No new edge type needed. Readiness already iterates `BLOCKING_EDGE_TYPES = ['depends-on-task', 'depends-on-story', 'blocks']`. |
| Backfill strategy | **Option (iii): candidate-list report at impl time** | Codex + Copilot recommend; operator NOTIFY-not-auto-flip clarification aligns: bookkeeper retains agency. Impl emits a deliverable `backfill-candidates.md` (NOT a `data.json` edit) listing the 5 blocked tasks and their mined prose. Lead reviews and hand-applies. |
| Version bump | **`v2.7.0 → v2.8.0`** (minor; additive) | Architect explicit. Researcher confirms current is `2.7.0`. New field + new MCP tool = semver minor. |
| Unknown blocker semantics | **Still blocked (fail-safe)** | Unanimous. A task with `blockedOn: ['nonexistent']` is NOT a candidate. Empty/missing `blockedOn` is also NOT a candidate (avoids vacuous-true on legacy prose-blocked tasks). |
| **Viewer reads snapshot.json?** | **NO — viewer reads `OverviewData` + `OverviewRalphState`** | Codex + Copilot independent discovery. So snapshot-only `unblockCandidate` won't reach the viewer. Resolution: **share the detector** as a tiny pure helper available in both `.mjs` (for emitters) and `.ts` (for viewer); same boolean predicate enforced in both. |

## Detector specification (4-way agreement)

```text
unblockCandidate iff ALL of:
  task.status === "blocked"
  Array.isArray(task.blockedOn)
  task.blockedOn.length > 0
  every blockedOn id resolves to a task with lifecycle === "merged"
                          (unknown / archived / tracked → not a candidate)
```

Helper shape (4-way agreement on signature):
```ts
function computeUnblockCandidate(task, tasksById): { unblockCandidate: boolean; blockers: BlockerStatus[]; reason: string }
```

## Critical architecture notes

1. **Schema-drift trio** (per `ai-developer-toolkit/plugins/ralph-overview/AGENTS.md` invariant 10): any new `OverviewTask` field MUST land in lockstep in:
   - `tools/overview-viewer/src/types.ts:42-60` (TS interface; add `blocks` is at line 54)
   - `tools/overview-mcp/src/tools/validate-data-schema.ts:63-94` (Zod mirror; `blocks` at line 74)
   - `scripts/lib/emit-snapshot-schema.mjs:94-128` (JSON Schema; `blocks` at line 108; `SnapshotTask` wrapper at 226-237)
   The drift-check test at `tools/overview-mcp/src/__tests__/validate-data.test.ts` fails CI if any of the three is out of sync.

2. **`unblockCandidate` lives ONLY on derived output types** (snapshot + recommendation), not on source `OverviewTask`. Source data captures *intent* (blockedOn IDs); derived emits the *computed boolean*.

3. **Viewer data path** (`Codex + Copilot independent finding`): the viewer's `OverviewData` is loaded from `.ralph-overview/data.json` and `OverviewRalphState` from `.ralph-overview/generated/ralph-state.json`. The viewer does NOT read `snapshot.json`. So the viewer needs a **TS-side detector** that runs at render time against the same `tasksById` map. Trivially small (~10 lines); no duplication risk because the predicate is the boolean condition above.

4. **`scoreRecommendations()` currently iterates ONLY `ralphState.byTaskId`** (`score-recommendations.mjs:46`). Blocked tasks with no Ralph state will not appear in recommendations unless candidates are injected explicitly from `overviewData.tasks`.

5. **Existing `blocks` field is the inverse direction** of `blockedOn`. `task.blocks=[B]` means "this task blocks B" → graph emits edge `B → task` (inversion). `task.blockedOn=[B]` means "this task is blocked by B" → graph emits edge `task → B` (no inversion). Reuse the `blocks` edge type because the GRAPH convention is dependent→prerequisite either way.

6. **Multi-repo ship order** (gim-home gating): toolkit submodule commit → push to ALL THREE remotes (`origin/personal/gim-home`) → bump codexu submodule pointer + update `Active plugin versions` table in codexu `AGENTS.md` → push codexu. Skipping the `gim-home` push leaves marketplace `copilot plugin update` consumers stale.

## Files to Create/Modify (consolidated)

Cited paths are relative to `ai-developer-toolkit/plugins/ralph-overview/` unless otherwise noted.

### Create
- `scripts/lib/unblock-candidates.mjs` — pure detector helper.
- `scripts/lib/unblock-candidates.test.mjs` — truth-table coverage.
- `tools/overview-mcp/src/tools/unblock-candidates.ts` — new MCP tool wrapper.
- `tools/overview-mcp/src/__tests__/unblock-candidates.test.ts` — MCP tool test.
- `tools/overview-viewer/src/utils/unblockCandidates.ts` — TS-side detector mirror.
- `tools/overview-viewer/src/utils/unblockCandidates.test.ts` — TS detector test.
- (At impl time) `<job_dir>/backfill-candidates.md` — operator-review deliverable for the 5 currently-blocked tasks.

### Modify
- `tools/overview-viewer/src/types.ts:42-60` — add `blockedOn?: string[]` to `OverviewTask`; add `unblockCandidate?: boolean` to `SnapshotTask` (line ~340).
- `tools/overview-mcp/src/tools/validate-data-schema.ts:63-94` — Zod mirror: `blockedOn: z.array(z.string()).optional()`.
- `scripts/lib/emit-snapshot-schema.mjs:94-128` — add `blockedOn: { type: 'array', items: { type: 'string' } }` to `OverviewTask.$defs`; add `unblockCandidate: { type: 'boolean' }` to `SnapshotTask` extension (line 226-237).
- `scripts/lib/emit-snapshot.mjs:13-17` — `buildSnapshot()` calls `computeUnblockCandidate(task, tasksById)` per task; sets `unblockCandidate` on snapshot tasks.
- `scripts/lib/emit-snapshot.test.mjs` — extend with truth-table cases.
- `scripts/lib/score-recommendations.mjs:46-67` — inject unblock-candidate entries from `overviewData.tasks` (since they're not in `byTaskId`); add a `'unblock candidate: blockers merged'` reason; ensure `topN` does not drop them silently.
- `scripts/lib/score-recommendations.test.mjs` — add candidate-surfacing test.
- `scripts/lib/derive-dependency-graph.mjs:56-61` — append a parallel loop emitting `task → B` edges with `type: 'blocks'` for each `blockedOn` entry.
- `scripts/lib/derive-dependency-graph.test.mjs` — extend with `blockedOn` edge emission case.
- `scripts/lib/parse-overview-data.test.mjs` (if exists; else add to `__tests__/parseOverviewData.test.mjs`) — additive-field pass-through test.
- `tools/overview-mcp/src/server.ts:17-21` — register `overview.unblock_candidates`.
- `tools/overview-mcp/src/__tests__/validate-data.test.ts` — drift-check covers the new field; no behavior change but verify the new field passes through.
- `tools/overview-viewer/src/components/Kanban.tsx:19-47` — inject NOTIFY pill in `kanbanCardHtml()` when `computeUnblockCandidate(task, tasksById).unblockCandidate === true`.
- `tools/overview-viewer/src/components/TaskCommand.tsx:580-610` — add a NOTIFY chip in the command-row chip stack.
- `tools/overview-viewer/src/styles.css` — add `.cmd-badge.unblock-notify` / `.kanban-unblock-pill` classes (high-contrast, no animation; e-ink friendly).
- `tools/overview-viewer/src/__tests__/kanban.test.tsx` — chip-render SSR test.
- `tools/overview-viewer/src/__tests__/taskCommand.test.tsx` (or new file) — chip-render test.
- `CHANGELOG.md` — add `v2.8.0` entry.
- `.claude-plugin/plugin.json`, marketplace indexes (3 of them), and `package.json` — bump to `2.8.0` per `/release-plugin` skill. **The 3 marketplace indexes are repo-root files in `ai-developer-toolkit/`**:
  - `.claude-plugin/marketplace.json`
  - `.github/plugin/marketplace.json`
  - `.agents/plugins/marketplace.json`
- Codexu repo: `AGENTS.md` "Active plugin versions" table (`ralph-overview` row 2.7.0 → 2.8.0); submodule pointer bump for `ai-developer-toolkit/`.

## Test commands (verified via `package.json:14-20`)

Plugin-local (run from `ai-developer-toolkit/plugins/ralph-overview/`):
- `npm run typecheck` — both workspaces (`overview-mcp` + `overview-viewer`)
- `npm run test:lib` — lib-only (currently a SUBSET — verify the new lib tests are in the subset OR add them)
- `npm test` — full plugin suite (lib + MCP + viewer, serial Vitest mode for Windows)

Codexu smoke (from repo root):
- `RALPH_OVERVIEW_PLUGIN_ROOT=D:/harness-efforts/codexu/ai-developer-toolkit/plugins/ralph-overview pnpm sync-ralph-state`
- `pnpm overview:build` — regenerates `.ralph-overview/generated/overview.html` (visually confirm NOTIFY marker via `file://`)

## Mined prose for the 5 currently-blocked tasks (from researcher)

These will be re-mined and surfaced as `backfill-candidates.md` at impl time. Quoted prose is what the bookkeeper would use to derive `blockedOn` entries:

- **`3b-agents`** — blocked on Phase 3a discovery / `3a-skills` (data.json:299, 487-561). Candidate `blockedOn: ['3a-skills']`.
- **`3d-workers`** — blocked on `3a-skills` discovery AND `3b-agents` landing the agent role TOMLs (data.json:561-565). Candidate `blockedOn: ['3a-skills', '3b-agents']`.
- **`3fg-package`** — same 3a-skills / 3b-agents cluster (data.json:299, 487-585). Candidate `blockedOn: ['3a-skills', '3b-agents']`.
- **`agent-comms`** — blocked by three-scope design decision (data.json:1768+, 2277-2285). Candidate `blockedOn: ['agent-comms-three-scope-design']` (NOTE: needs verification — operator should confirm the actual blocker task-id exists).
- **`escalate-gim-home-actions-policy`** — blocked by org-policy CI failure on `gim-home/codex@main`. NO existing task represents the blocker (external policy decision); leave `blockedOn` empty and document in `kanbanCards` prose.

## Suggested cluster boundaries (for `## Suggested Decomposition`)

| Cluster | Stories | Files | Phase | Depends on |
|---|---|---|---|---|
| **A. Schema-drift trio + parser** | US-001 | `types.ts`, `validate-data-schema.ts`, `emit-snapshot-schema.mjs`, parser tests | 1 | — |
| **B. Detector helper + tests** | US-002 | `scripts/lib/unblock-candidates.mjs` + test | 1 | — (independent) |
| **C. Snapshot + recommendation emitter integration** | US-003 | `emit-snapshot.mjs`, `score-recommendations.mjs`, `derive-dependency-graph.mjs`, their tests | 2 | A, B |
| **D. MCP tool surface** | US-004 | `tools/overview-mcp/src/tools/unblock-candidates.ts`, `server.ts`, tool tests | 2 | A, B (independent of C in files) |
| **E. Viewer marker (Kanban + TaskCommand + styles + tests)** | US-005 | `Kanban.tsx`, `TaskCommand.tsx`, `styles.css`, viewer-side detector util, viewer tests | 2 | A (types) |
| **F. Backfill candidates report (advisory only)** | US-006 | `<job_dir>/backfill-candidates.md` (NOT a `data.json` edit) | 3 | C |
| **G. Release ceremonies** | US-007 | `CHANGELOG.md`, `plugin.json`, 3 marketplace indexes, codexu `AGENTS.md`, submodule pointer | 3 | A, B, C, D, E, F |

Clusters A + B can run in parallel (file-disjoint). Clusters C, D, E can run in parallel after A+B land (D+E share no files with C). F + G are sequential cleanup.

## Open architectural questions for the plan

1. **Should the detector helper be one file or two** (`.mjs` for emitters + `.ts` for viewer)? Recommend **two files**, same predicate text, both covered by tests. The predicate is 4 lines; duplication is cheaper than a shared ESM↔TS dependency that complicates the viewer bundle.

2. **Does `derive-dependency-graph.mjs` need the `blockedOn` edges?** Recommend **yes** — even though readiness logic is `lifecycle === 'merged'` (not `stage === 'shipped'`), the edges still document the dependency for graph visualization and future tooling. Cheap to add.

3. **Should `score-recommendations.mjs` reasons include a special `'unblock candidate'` reason or rely on the snapshot-side flag?** Recommend the reason string be added — operators reading `recommendations.json` directly (via `jq`) should see WHY a blocked task is being recommended.

## Failure modes already considered and mitigated

- **Vacuous-true** on legacy prose-blocked tasks: blocked by requiring `blockedOn.length > 0`. A task with `status === 'blocked'` but no structured `blockedOn` will NOT be a candidate.
- **Hallucinated task-IDs in backfill**: backfill is a separate deliverable report (option iii), not a `data.json` edit. Operator reviews before applying.
- **Auto-flip drift from operator intent**: detector emits a boolean flag; no code path mutates `task.status` or `task.lifecycle`. Wording in CHANGELOG / chip text uses "candidate" / "notify", not "auto-unblock" as a verb.
- **Schema drift**: the 3-surface drift-check test catches any out-of-sync change at CI time.
