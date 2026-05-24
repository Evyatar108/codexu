# Research Brief — Plan 08 (Crews Plugin Integration)

## Researcher Findings

### scripts/lib/sync-core.mjs (~700 lines)
- `walkRalphState()` (~line 45) — reads Ralph bundles, assembles full state.
- `assembleStateFromBundles()` (~line 96) — merges bundles into per-taskId entries.
- `deriveAffectedTaskUpdate()` (~line 152) — incremental per-slug derivation.
- `mergeAndWrite()` (~line 245) — applies updates to current state and writes sidecar.
- `writeSidecar()` (~line 357) — emits sidecar (state JSON/JS, snapshot, schema, agent artifacts).
- `loadOverviewData()` (~line 664) — trusted parser for `plans/overview-data.js`.

Natural integration: invoke `discoverCrewSessions()` inside `assembleStateFromBundles()` (full walk) AND inside `mergeAndWrite()` (incremental). Plan says "AFTER per-slug derivation" — that matches.

### tools/overview-viewer/src/types.ts (220 lines)
`RalphPipelineState` lives at lines 61–81. No existing `crewSessions` field — additive extension is clean. No `CrewSessionRef` interface yet.

### scripts/lib/watch-ralph-state.mjs (~400 lines)
**Key finding:** watched paths come from `getWatchRoots(config)` (lines 269–271) which returns `[config.ralphSubdirs.jobs, config.ralphSubdirs.jobGroups, config.ralphSubdirs.brainstorms]`. `.crews/` is NOT in the watch roots, and `parseWatchedPath()` only understands `job|group|brainstorm` kinds.

`default-config.mjs` (lines 32–42) already excludes `.crews/logs/**` and `.crews/spawn-launchers/**` from chokidar ignored patterns. So those exclusion rules are pre-existing but no inclusion path exists for `.crews/crews/`, `.crews/sessions-configs/`.

Watcher acquires lock at startup (line 30) and holds it for the watcher's entire lifetime (released only on `stop()` at line 208). Heartbeat every 30s (line 260). Between ticks the lock is touched, not released.

### scripts/lib/sync-lock.mjs (~100 lines)
- `acquireLock({ lockPath, processLabel, staleAfterMs? })` (line 6)
- `releaseLock(handle)` (line 27)
- `touchLock(handle)` (line 34)
- Lock metadata `{ pid, process, startedAt }` (line 14)
- `formatLockDiagnostic()` (line 45) emits canonical `another sync in progress (pid <N>, process <label>, started <ts>)`.
- `isLiveProcess()` (line 48) uses ESRCH/EPERM for stale detection.

### scripts/sync-ralph-state.mjs (~80 lines)
`parseArgs()` currently accepts `--repo`, `--config`, `--watch`, `--debounce-ms`. `runOneShot()` (line 37) acquires lock, walks state, writes sidecar, releases lock.

### scripts/lib/derive-next-command.mjs (115 lines)
Exports `deriveNextCommand(state, task, options = {}) -> NextCommand | null`. `NextCommand = { label, command, icon? }`. Reusable for `--via-crew` as-is.

### .claude/skills/work-on/SKILL.md (123 lines)
Line 20 already has a Plan 06 placeholder: `Optional --via-crew <crewName> flag. For Plan 06, stop immediately with the exact error: crews delegation not yet implemented — wait for Plan 08.` Replace this placeholder with the Plan 08 flow.

### tools/overview-viewer/src/components/TaskCommand.tsx (500+ lines)
`RalphTooltipExtras` component (lines 198–242). Currently renders Deferred questions (207–217), Branch name (219–231), PR URL (233–238). All use `className="tooltip-extras-row"`. Composition site: line 416 (`const tooltipExtras = ralph ? <RalphTooltipExtras ralph={ralph} showToast={showToast} /> : undefined`).

### tools/overview-viewer/src/components/RalphStageChip.tsx (46 lines)
Props: `{ taskId, ralphState, tooltipExtras? }`. Tooltip slot already present and generic — no change needed (plan's claim is correct).

### Sample .crews/ data
- Real member manifest: `D:/harness-efforts/codexu/.crews/crews/ralph-pipeline/members/agent-exports-worker/manifest.json`. Fields verified: `name`, `crew`, `cwd` (Windows backslash form `D:\\harness-efforts\\codexu`), `sessionId`, `transcriptPath` (Windows backslash form to `.jsonl`), `startedAt`, `lastHeartbeatAt`, `lastSummary` (free-text narrative).
- Real spawn launcher: `D:/harness-efforts/codexu/.crews/spawn-launchers/alice-1778830606020.ps1` (7 lines). **Important:** the format does NOT contain a literal `--` separator. The prompt is the FINAL single-quoted argument on the `claude ... '<prompt>'` line. PowerShell single-quote escaping uses `''`.

### Test infrastructure
- Vitest config: `tools/overview-viewer/vitest.config.ts` (split projects: ssr + interactions).
- Root scripts tests: `scripts/lib/*.test.mjs` (Vitest ESM). Examples: `derive-next-command.test.mjs`, `emit-snapshot-schema.test.mjs`.
- Existing tests touching this area: `scripts/lib/sync-core.test.mjs`, `scripts/lib/watch-ralph-state.test.mjs`, `tools/overview-viewer/src/__tests__/syncRalphStateCli.test.ts`, `tools/overview-viewer/src/__tests__/interactions/taskCommandTooltipExtras.test.tsx`.

### plans/ralph-pipeline-INDEX.md (227 lines)
Source-of-truth modules table at lines 182–216. DAG diagram (lines 19–111) already shows Plan 08 depends on Plan 06.

---

## Architect Analysis

### Finding 1 — Lock contention (CRITICAL)
Watcher holds the lock for its full lifetime. Plan section L116–118 already acknowledges this and downscopes ("subcommand should not have acquired the lock; callers should surface the diagnostic and retry after the watcher stops"). For Plan 08 we'll honor that explicit constraint:
- Subcommands fail fast via `sync-lock.mjs` with the canonical diagnostic when watcher owns the lock.
- `/work-on --via-crew` is expected to be invoked when the watcher is stopped, OR via a future queue (Plan 09+).
- Tests verify both serialization (no watcher) and fail-fast (with watcher).

### Finding 2 — `_source` persistence gap (HIGH)
`_source: 'explicit' | 'heuristic'` is in-memory only per the plan, but the snapshot is the only state that persists between watcher ticks. On tick N+1, deserialized explicit entries are indistinguishable from freshly-discovered heuristic entries.

**Remediation:** persist explicit-ness in the snapshot. Add `_isExplicit?: boolean` to `CrewSessionRef`. Set it to `true` on explicit writes (`--update-crew-session`, `--finalize-crew-session`); omit on heuristic-discovered entries. Merge rule: if existing entry has `_isExplicit === true`, preserve its `endedAt`/`outcome`/`summary` and only allow updates from explicit subcommands. Internal `_source` annotation is dropped in favor of this serialized flag.

### Finding 3 — Substring collision (MEDIUM)
Task IDs like `overview-viewer` are prefixes of `overview-viewer-polish`. Plain `indexOf` matching causes false positives.

**Remediation:** strong-signal match uses word-boundary regex: `new RegExp(\`(?<![A-Za-z0-9_-])${escapedTaskId}(?![A-Za-z0-9_-])\`)`. Custom boundary (not just `\b`) because task IDs contain `-`. When multiple task IDs match, log ambiguity to stderr and pick the LONGEST matching ID (more specific wins).

### Finding 4 — `.crews/` path resolution (MEDIUM)
`.crews/` is shared workspace state at the main repo root, NOT under any worktree. The plan's `discoverCrewSessions` must resolve `.crews/` from the repo root, not the worktree cwd.

**Remediation:** thread `repoRoot` (already an absolute path provided by `scripts/lib/resolve-repo-root.mjs` or equivalent) into `discoverCrewSessions({ repoRoot, ... })`. Use `path.join(repoRoot, '.crews')`. Add an optional `crewsRoot` config field (default `<repoRoot>/.crews`) for tests and edge cases. Updating `default-config.mjs`, `resolve-config.mjs`, `default-config.d.mts`, AND the JSON schema is required because the schema has `additionalProperties: false`.

### Finding 5 — Stale-member idempotency (LOW)
Once `outcome: 'stopped'` is set by stale-heartbeat detection on tick N, tick N+1 should NOT re-derive it (e.g., if the member's `lastHeartbeatAt` changes due to a transient revival).

**Remediation:** if an existing entry already has `outcome` set (any value), `discoverCrewSessions` preserves it across ticks. Only entries with no `outcome` get the stale-check applied.

### Finding 6 — Path safety on Windows (NEW, from Codex)
`startsWith` is unsafe for the cwd filter: `D:\repo2` startsWith `D:\repo`. Use `path.relative(repoRoot, manifestCwd)` and check that the result is NOT empty, NOT absolute, and NOT prefixed with `..`. On Windows, case-normalize both paths (`.toLowerCase()`) before comparison.

### Finding 7 — Watcher kind for `.crews/` (NEW, from Copilot/Codex)
`parseWatchedPath()` only understands `job|group|brainstorm`. `.crews/` events don't map to a Ralph slug. Add a new `crews` kind that triggers a full crew-rescan (not a per-slug derivation). The watcher's `scheduleFlush()` already shares debounce across all event kinds — reuse it.

### Finding 8 — Manifest field availability (NEW, from Codex)
After `/spawn-member` returns, the new member's `manifest.json` may NOT yet have `sessionId`/`transcriptPath` filled (those are written by Claude's SessionStart hook, which races with the spawn). `/work-on --via-crew` must poll the manifest for up to ~10s with a 500ms interval, OR fall back to recording the partial entry (with member name only) and let the next heuristic tick fill in `sessionId`/`transcriptPath`.

### Finding 9 — Skill cannot trigger spawn-member hook (NEW, from Codex)
The crews plugin's `/spawn-member` slash command only runs the spawn side-effect when invoked from the user prompt. When called via the Skill tool from another skill (which is what `--via-crew` would do), the hook does NOT fire. The plan must use the CLI mirror at `D:/ai-developer-toolkit/plugins/crews/tools/spawn-member.js`, not the Skill tool.

---

## Codex Research
Captured as architect Findings 6/8/9 above. Additional notes:
- `additionalProperties: false` in `.ralph/overview-config.schema.json` — required schema update for any new config field.
- `emit-snapshot-schema.mjs`: `RalphPipelineState.additionalProperties` is true, so the snapshot tolerates the new field even without a schema update, but adding explicit `crewSessions` schema makes the contract visible.

## Copilot Research
- Confirmed `.crews/` events need a new "crew-state changed" update mode rather than forcing through `deriveAffectedTaskUpdate()`.
- Confirmed `walkRalphState()` currently rebuilds from `.ralph/` only and does not receive prior sidecar state. So explicit crew entries must be read from the prior snapshot/sidecar in `walkRalphState()` (or in `assembleStateFromBundles`) and merged after heuristic discovery.

---

## Consolidated File List

### Files to create (4)
- `scripts/lib/crews-cross-walk.mjs`
- `scripts/lib/parse-spawn-launcher.mjs`
- `scripts/lib/crews-cross-walk.test.mjs`
- `scripts/lib/parse-spawn-launcher.test.mjs`

### Files to modify (10)
- `scripts/lib/sync-core.mjs` — invoke `discoverCrewSessions` in full + incremental paths; merge into `byTaskId`; preserve explicit entries from prior snapshot.
- `scripts/lib/watch-ralph-state.mjs` — `getWatchRoots()` returns additional `.crews/crews/`, `.crews/sessions-configs/` roots; `parseWatchedPath()` handles new `crews` kind; `scheduleFlush` triggers full crew rescan on `crews` events.
- `scripts/sync-ralph-state.mjs` — add `--update-crew-session`, `--finalize-crew-session` subcommand handlers. Both acquire lock via `sync-lock.mjs` (fail fast if held by watcher).
- `scripts/lib/default-config.mjs` — add `crewsRoot` config field (default `<repoRoot>/.crews`).
- `scripts/lib/default-config.d.mts` — type for new config field.
- `scripts/lib/resolve-config.mjs` — resolve `crewsRoot` from override or default.
- `.ralph/overview-config.schema.json` — add `crewsRoot` (string) field. Required because schema has `additionalProperties: false`.
- `tools/overview-viewer/src/types.ts` — add `CrewSessionRef` interface (with `_isExplicit?: boolean`); extend `RalphPipelineState` with `crewSessions?: Record<RalphStage, CrewSessionRef[]>`.
- `tools/overview-viewer/src/components/TaskCommand.tsx` — extend `RalphTooltipExtras` to render crew sessions for the current stage (rows with member name, timestamps, outcome, clickable `file://` transcript link).
- `.claude/skills/work-on/SKILL.md` — replace Plan 06 placeholder with `--via-crew <crewName>` branch.

### Files to modify (cascade audit)
- `plans/ralph-pipeline-INDEX.md` — add rows for new modules and types.
- `tools/overview-viewer/README.md` — if file layout / type docs reference RalphPipelineState fields.
- `scripts/lib/emit-snapshot-schema.mjs` — explicitly add `crewSessions` to the generated JSON schema (currently the parent allows `additionalProperties: true`, but explicit schema makes contract visible).

### Files to read for reference
- `D:/ai-developer-toolkit/plugins/crews/skills/spawn-member/SKILL.md`
- `D:/ai-developer-toolkit/plugins/crews/tools/spawn-member.js` (CLI mirror — what `--via-crew` actually invokes)
- `D:/ai-developer-toolkit/plugins/crews/hooks/actors.js` (manifest-creation timing)
- `D:/harness-efforts/codexu/.crews/crews/ralph-pipeline/members/agent-exports-worker/manifest.json` (sample manifest)
- `D:/harness-efforts/codexu/.crews/spawn-launchers/alice-1778830606020.ps1` (sample launcher)
- `scripts/lib/sync-lock.mjs` (lock contract)
