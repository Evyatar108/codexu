# Stories Outline: Plan 08 — Crews plugin integration

*Preliminary decomposition from `/plan-with-ralph --improve`. Feed to `/implement-with-ralph --from-plan` for PRD generation.*

## US-001: Add CrewSessionRef types and snapshot schema
**Description:** As the overview viewer, I want a typed `CrewSessionRef` interface and `RalphPipelineState.crewSessions?: Record<RalphStage, CrewSessionRef[]>` field so downstream code (sync-core, viewer, schema validator) can manipulate crew-session entries with type safety.
**Acceptance Criteria:**
- [ ] `CrewSessionRef` interface in `tools/overview-viewer/src/types.ts` with required fields (`crewName`, `memberName`, `startedAt`) and optional fields (`sessionId`, `transcriptPath`, `endedAt`, `outcome`, `summary`, `_isExplicit`, `cwd`).
- [ ] `RalphPipelineState.crewSessions?: Record<RalphStage, CrewSessionRef[]>` field added.
- [ ] `scripts/lib/emit-snapshot-schema.mjs` updated with explicit `crewSessions` JSON schema.
- [ ] `scripts/lib/emit-snapshot-schema.test.mjs` adds a positive case (snapshot with `crewSessions` validates) and a negative case (snapshot with `CrewSessionRef` missing `memberName` fails Ajv validation).
- [ ] `pnpm --filter @codexu/overview-viewer typecheck` passes; `pnpm test` passes.
**Dependencies:** None
**Estimated complexity:** small

## US-002: Config plumbing for crewsRoot
**Description:** As an integrator, I want `crewsRoot` to be a first-class config field that resolves correctly under linked-worktree mode so the watcher and subcommands all reference the main repo's `.crews/`.
**Acceptance Criteria:**
- [ ] `crewsRoot` added to `.ralph/overview-config.schema.json` (top-level `properties.crewsRoot: { "type": "string" }`).
- [ ] `scripts/lib/default-config.mjs` sets `crewsRoot: '.crews'` default and adds chokidar ignore patterns for `.crews/crews/*/members/*/mailbox.json`, `.crews/crews/*/members/*/outbox.jsonl`, `.crews/crews/*/leads/*/mailbox.json`, `.crews/crews/*/leads/*/outbox.jsonl`, `.crews/crews/*/inbox-history.jsonl`.
- [ ] `scripts/lib/default-config.d.mts` adds `crewsRoot: string` to `RalphOverviewConfig`.
- [ ] `scripts/lib/resolve-config.mjs` destructures `crewsRoot` and returns it via a new `resolveCrewsRoot()` helper that resolves linked-worktree paths to the common repo root.
- [ ] `scripts/lib/sync-core.mjs`'s `normalizeConfigPaths()` also resolves `crewsRoot`.
- [ ] Tests cover: schema validation, absolute override preserved, relative override resolved against repo root, linked-worktree mode resolves to main repo's `.crews/`.
**Dependencies:** US-001
**Estimated complexity:** medium

## US-003: Spawn-launcher parser
**Description:** As `discoverCrewSessions`, I want to extract the initial prompt from `.crews/spawn-launchers/<member>-<ts>.ps1` so the medium-signal task-ID match works.
**Acceptance Criteria:**
- [ ] `scripts/lib/parse-spawn-launcher.mjs` exports `parseSpawnLauncher(absolutePath) -> { initialPrompt: string | null, memberName: string | null, crewName: string | null }`.
- [ ] Handles PowerShell single-quote escaping (`''` → `'`).
- [ ] Extracts the FINAL single-quoted argument on the `claude ...` line as `initialPrompt`.
- [ ] Tests cover: real-format launcher, escaped-quote edge case, missing claude line, empty file.
**Dependencies:** US-001
**Estimated complexity:** small

## US-004: Crew cross-walk discovery
**Description:** As the watcher (and full sync), I want a `discoverCrewSessions` function that walks `.crews/`, matches members to tasks, derives the stage from current Ralph state, and emits a sparse map for merging.
**Acceptance Criteria:**
- [ ] `scripts/lib/crews-cross-walk.mjs` exports `discoverCrewSessions({ repoRoot, ralphState, overviewData, crewsRoot, now?, logger? }) -> Map<taskId, Record<RalphStage, CrewSessionRef[]>>`.
- [ ] Walks `.crews/crews/*/members/*/manifest.json` AND `.crews/crews/*/leads/*/manifest.json`.
- [ ] Filters by cwd via `path.relative(repoRoot, manifestCwd)` accepting empty string (cwd === repoRoot), case-normalized on Windows.
- [ ] Matches task ID in `lastSummary` via custom-boundary regex `(?<![A-Za-z0-9_-])<id>(?![A-Za-z0-9_-])`. Multi-match picks longest ID.
- [ ] Fallback medium-signal: scans `.crews/spawn-launchers/*.ps1` indexed by `(crewName, memberName)`, tiebreaks by latest filename timestamp.
- [ ] Reads stage from `ralphState.byTaskId[taskId].stage` at discovery time; entries stay under their recorded stage even if the task later advances.
- [ ] Dedupes by `sessionId`, falling back to `(crewName, memberName)` for partial entries.
- [ ] Stale detection: `manifest.lastHeartbeatAt > 60min` → sets `outcome: 'stopped'` and `endedAt: lastHeartbeatAt` ONLY when the existing entry has no `outcome` (idempotency).
- [ ] Stderr-logs unmatched and ambiguous matches.
- [ ] Tests cover positive match, stage assignment, cwd === repoRoot acceptance, prefix-attack rejection (`D:\\repo` vs `D:\\repo2`), spawn-launcher fallback, multi-task ambiguity, stale detection (with idempotency), missing-manifest tolerance.
**Dependencies:** US-001, US-002, US-003
**Estimated complexity:** large

## US-005: Wire cross-walk into sync-core merge
**Description:** As `walkRalphState` / `mergeAndWrite`, I want crew-session discovery merged into `byTaskId[*].crewSessions` after Ralph-side derivation, preserving explicit entries across ticks.
**Acceptance Criteria:**
- [ ] `walkRalphState` reads `config.outputs.sidecarJson` if it exists and threads `priorCrewSessions` into `assembleStateFromBundles`.
- [ ] `assembleStateFromBundles` and `mergeAndWrite` invoke `discoverCrewSessions` AFTER per-slug Ralph derivation, passing `priorCrewSessions` for the explicit-preservation merge.
- [ ] Merge identity: prefer `sessionId`; fall back to `(crewName, memberName)`. Entries with `_isExplicit: true` survive intact (`endedAt`, `outcome`, `summary` preserved).
- [ ] Partial explicit entries (no `sessionId`) get upgraded in place when heuristic discovery later supplies `sessionId`/`transcriptPath`.
- [ ] Tests cover: heuristic adds new entries, explicit prior entries survive, partial entry upgrade, stage stickiness on task advancement, stale idempotency.
**Dependencies:** US-004
**Estimated complexity:** medium

## US-006: Watcher integration for .crews/ events
**Description:** As the watcher, I want `.crews/` events to trigger a crew-only rescan without re-deriving Ralph state.
**Acceptance Criteria:**
- [ ] `getWatchRoots()` returns `<crewsRoot>/crews/` and `<crewsRoot>/sessions-configs/` in addition to existing Ralph roots.
- [ ] `parseWatchedPath()` detects paths under those `.crews/` roots BEFORE the Ralph `rootEntries` loop; returns `{ kind: 'crews' }` (no slug).
- [ ] `flushPending()` branches on `kind === 'crews'` BEFORE calling `deriveAffectedTaskUpdate()`. Crew events route to a new `rescanCrewSessionsAndWrite({ currentState, config, repoRoot, overviewData })` helper in `sync-core.mjs`.
- [ ] `rescanCrewSessionsAndWrite` re-runs `discoverCrewSessions`, merges into `currentState.byTaskId[*].crewSessions` (preserving `_isExplicit` + stage buckets), updates only crew-session data + `generatedAt`, calls `writeSidecar()` without re-reading or re-deriving Ralph bundles.
- [ ] Mixed-batch flushes apply Ralph `mergeAndWrite` first, then crew rescan.
- [ ] Tests cover: mailbox file change is ignored; manifest change triggers crew-only flush; debounce coalesces multiple `.crews/` events; mixed batch ordering.
**Dependencies:** US-002, US-005
**Estimated complexity:** medium

## US-007: Subcommand modes for explicit writes
**Description:** As `/work-on --via-crew`, I want CLI subcommands to atomically write or finalize a CrewSessionRef under the watcher's shared lock contract.
**Acceptance Criteria:**
- [ ] `scripts/sync-ralph-state.mjs --update-crew-session <taskId> <stage> --json <ref-json>` loads `config.outputs.sidecarJson` (Ralph sidecar shape), upserts into `byTaskId[id].crewSessions[stage]` with `_isExplicit: true`, calls `writeSidecar()`.
- [ ] `scripts/sync-ralph-state.mjs --finalize-crew-session <taskId> <stage> --member <name> --outcome <s> [--summary <text>]` loads the sidecar, finds the matching entry by `(crewName, memberName)` (or `sessionId` if provided), updates `endedAt` / `outcome` / `summary` in place, calls `writeSidecar()`.
- [ ] Both subcommands validate `<stage>` against the canonical `RalphStage` union and `--outcome` against `('completed'|'handed-off'|'stopped'|'failed')`. Invalid input exits non-zero with a clear diagnostic.
- [ ] Both subcommands acquire `sync-lock.mjs`; on contention with a running watcher, fail fast with the canonical `another sync in progress (pid <N>, process <label>, started <ts>)` diagnostic, no partial write.
- [ ] Tests cover: serialized invocations succeed; concurrent invocation against a watcher-held lock fails fast; finalize updates an existing entry in place; invalid stage/outcome rejected.
**Dependencies:** US-005
**Estimated complexity:** medium

## US-008: /work-on --via-crew skill branch
**Description:** As the lead orchestrator, I want `/work-on <task> --via-crew <crewName>` to spawn a crew member and record the session ref atomically.
**Acceptance Criteria:**
- [ ] `.claude/skills/work-on/SKILL.md` replaces the Plan-06 `--via-crew` placeholder with the full flow.
- [ ] Pseudocode covers: (a) lock preflight, (b) `node scripts/lib/derive-next-command-cli.mjs <taskId>` to derive the prompt, (c) generate a unique member name, (d) invoke `node D:/ai-developer-toolkit/plugins/crews/tools/spawn-member.js <name> --crew <crewName> --cwd <main-repo-root> -- "<prompt>"`, (e) poll the member manifest for `sessionId`/`transcriptPath` (10s timeout, 500ms interval), (f) call `node scripts/sync-ralph-state.mjs --update-crew-session <taskId> <stage> --json <ref>`, (g) print confirmation `Spawned <crew>/<member> for <taskId>:<stage>; session=<id|pending>`.
- [ ] Lock preflight aborts BEFORE spawning if the watcher owns the lock — no orphan members.
- [ ] Documents that `Skill` tool invocations cannot trigger the `/spawn-member` hook; the CLI mirror is REQUIRED.
- [ ] Tests cover: end-to-end happy path (mocked spawn), lock-contention preflight failure, manifest-race partial entry written when polling times out.
**Dependencies:** US-007
**Estimated complexity:** medium

## US-009: Tooltip extras render crew sessions
**Description:** As the viewer, I want each task's stage chip tooltip to show the crew sessions worked on that stage with clickable transcript links.
**Acceptance Criteria:**
- [ ] `RalphTooltipExtras` in `tools/overview-viewer/src/components/TaskCommand.tsx` renders crew session rows when `ralph.crewSessions?.[stage]?.length > 0`.
- [ ] Each row shows: member name, time range (`startedAt` → `endedAt || 'live'`), outcome (or 'live'), and a clickable `file://` link to `transcriptPath`.
- [ ] The transcript URL is built via `pathToFileURL(transcriptPath).href` (or client-side equivalent that URL-encodes drive letter, segments, spaces, and `#`).
- [ ] Tests cover: row renders all fields; transcriptPath with `#` and spaces produces a valid clickable href; no rows render when `crewSessions[stage]` is empty.
**Dependencies:** US-001
**Estimated complexity:** small

## US-010: Stale-member detection idempotency tests
**Description:** As a verifier, I want explicit test coverage of the stale-flag idempotency rule.
**Acceptance Criteria:**
- [ ] Test with a synthetic manifest whose `lastHeartbeatAt` is 121 minutes ago — first `discoverCrewSessions` tick sets `outcome: 'stopped'` and `endedAt: lastHeartbeatAt`.
- [ ] Re-running `discoverCrewSessions` on the same manifest does NOT shift `endedAt` (idempotent).
- [ ] When the synthetic member briefly revives (heartbeat moves forward), the existing `outcome: 'stopped'` is preserved (not re-derived).
**Dependencies:** US-004
**Estimated complexity:** small

## US-011: Conflict-resolution tests (including partial-entry race)
**Description:** As a verifier, I want explicit test coverage of explicit-vs-heuristic merge for both complete entries and partial entries.
**Acceptance Criteria:**
- [ ] Test 1: write explicit entry via subcommand (`_isExplicit: true`). Trigger a heuristic walk that would also discover the same `sessionId`. Assert the explicit `summary` / `outcome` / `endedAt` survive intact.
- [ ] Test 2: write a partial explicit entry (no `sessionId`, only `crewName` + `memberName`). Heuristic walk later discovers the same member with a populated `sessionId`. Assert the entry is upgraded in place (single entry, not duplicated; `_isExplicit` preserved).
**Dependencies:** US-005, US-007
**Estimated complexity:** small

## US-012: Cascade audit and INDEX refresh
**Description:** As the plan steward, I want `plans/ralph-pipeline-INDEX.md` and downstream documentation refreshed to match Plan 08's actual implementation.
**Acceptance Criteria:**
- [ ] `plans/ralph-pipeline-INDEX.md`: Source-of-truth modules table adds rows for `crews-cross-walk.mjs`, `parse-spawn-launcher.mjs`, `rescanCrewSessionsAndWrite`, and `CrewSessionRef` / `crewSessions`. DAG dependency for downstream plans (Plan 09) updated.
- [ ] `tools/overview-viewer/README.md`: if it lists `RalphPipelineState` fields, `crewSessions` is added.
- [ ] All existing tests pass: `pnpm test`, `pnpm --filter @codexu/overview-viewer test`, `pnpm --filter @codexu/overview-viewer typecheck`, `pnpm -r --if-present typecheck`.
- [ ] Commit message lists each cascade diff (file + lines + change summary) so reviewers can verify.
**Dependencies:** US-001 through US-011
**Estimated complexity:** small
