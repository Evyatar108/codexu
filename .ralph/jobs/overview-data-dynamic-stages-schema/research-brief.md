# Research Brief — overview-data-dynamic-stages-schema

## Researcher Findings

### Codexu repo (`D:/harness-efforts/codexu/`)

- **`plans/overview-data.js`** — 1691 lines, ~49 task entries each with `"phase":` and `"planPrompt":` fields. Sample entries (with line ranges):
  - `perf-WS3` (79–102): `phase: "shipped"`, planPrompt = `/plan-with-ralph "Realtime sync perf..."`
  - `1b-multidev` (103–146): `phase: "plan-ready"`, planPrompt = `/plan-with-ralph "Phase 1b sub-task 3 + 4..."`
  - `polish-Fs` (148–205): `phase: "plan-ready"`
  - `perf-WS1` (207–227): `phase: "closed"`
  - `3a-skills` (229–254): `phase: "plan-ready"`
  Shape per entry: `{ id, scope, phase, status, lastTouchedAt, mergeCommit?, kanbanCards[], command: { name, descriptionHtml, warnings[], planPrompt } }`.

- **`plans/codexu-roadmap.md`** — 3386 lines. Bookkeeper workflow lines ~817–858 says: "Edit `phase` → `"shipped"`...add `mergeCommit`; refresh `lastTouchedAt`". Phase-discipline rule in earlier section references `feedback_phase_discipline_separate_members`.

- **`CLAUDE.md`** (root, 177 lines) — Phase discipline lines 20–37; two-file split lines 40–64; bookkeeper at-a-glance lines 131–157.

### Ralph-overview plugin (`D:/ai-developer-toolkit/plugins/ralph-overview/`)

- **`tools/overview-viewer/src/types.ts`** (299 lines):
  - Lines 6–11: `OverviewCommand { name?, descriptionHtml, warnings?, planPrompt?: string | null }`
  - Lines 24–36: `OverviewTask { id, scope?, phase?, status?, lastTouchedAt?, planOnly?, mergeCommit?, blocks?, priority?, kanbanCards?, command? }`
  - Lines 38–48: `RalphStage = 'brainstorming' | 'brainstorm-ready' | 'planning' | 'plan-ready' | 'implementing' | 'reviewing' | 'review-fix' | 'replan-pending' | 'shipped' | 'blocked'`
  - Lines 52–63: `CrewSessionRef { crewName, memberName, startedAt, sessionId?, transcriptPath?, endedAt?, outcome?, summary?, _isExplicit?, cwd? }` — **no phase field yet**
  - Lines 74–95: `RalphPipelineState { stage, branchName?, ..., crewSessions? }` — **no regressionReason yet**

- **`tools/overview-viewer/src/components/Toolbar.tsx`** — STATIC_FILTER_GROUPS lines 43–71; dynamic groups lines 87–133. No 'phase' FilterAxis currently defined (filter chips render but the axis is structural — see Toolbar / utils/filters where `task.phase` flows into the search haystack and bucket classifier).

- **`tools/overview-viewer/src/components/TaskCommand.tsx`**:
  - Line 91–94: `StatusBadge({ phase }: { phase?: string })` renders `b-${phase}` CSS class
  - Lines 148–164: CopyCommandButton reads `task.command?.planPrompt ?? ''`
  - Line 167: `taskStatusLabel` uses `task.phase`

- **`tools/overview-viewer/src/utils/filters.ts`** (104 lines):
  - Lines 47–74: `getTaskSearchHaystack` includes `task.phase` (line 53) + `task.command?.planPrompt` (line 58)
  - Lines 76–93: `matchesTaskFilter` — no phase-based filter predicate yet

- **`tools/overview-viewer/src/utils/taskClassification.ts`** (50 lines):
  - Lines 3–14: `PHASE_TO_BADGE_TEXT` map (keyed by current phase values)
  - Lines 42–44: `orderBucketForTask`
  - Lines 46–49: `filterBucketForTask`

- **`tools/overview-viewer/src/__tests__/`** — Fixture-using tests:
  - `phaseTreeDerivation.test.tsx` — fixtures lines 28–34 use `phase: 'shipped' | 'closed' | 'plan-ready' | 'impl-ready'` and `status: 'ok' | 'blocked' | 'paused'`. Maps to badge values: 'donefade', 'closed', 'deferred', 'open'.
  - `bucketCountChips.test.tsx`, `commandBucketGrouping.test.tsx`, `commandList.test.tsx`, `kanban.test.tsx`, `leftRail.test.tsx`, `stickyFrame.test.tsx`.

- **`scripts/sync-ralph-state.mjs`** (495 lines) — reads `orchestrator.phase` (line 37, line 770, 783) but these are the Ralph orchestrator's internal phase, **distinct from OverviewTask.phase**. No direct write of OverviewTask.phase.

- **`scripts/lib/sync-core.mjs`** (1022 lines) — Loads overview-data.js, merges with watcher state. No grep hit for `planPrompt`; the field flows transparently because the snapshot wraps the entire `command` object.

- **`scripts/lib/crews-cross-walk.mjs:207–228`** — `buildCrewSessionRef({ manifest, crewName, memberName, existing, nowMs })`. Currently returns `{ crewName, memberName, startedAt, sessionId, transcriptPath, endedAt, outcome, summary, _isExplicit, cwd }` via `pruneUndefined`. **No phase derivation from memberName prefix.**

- **`scripts/lib/derive-next-command.mjs`** (145 lines) — `deriveNextCommand(state, task, options)` lines 16–94. Currently switches on `state.stage`; `task` arg is reserved for future seed-prompt fallback (the comment says "implemented in /work-on skill body, not here").

- **`scripts/lib/emit-snapshot-schema.mjs`** (1927 lines):
  - Lines 1–81: `OverviewCommand` `$def`. Line 49: `planPrompt: { anyOf: [{ type: 'string' }, { type: 'null' }] }`
  - Lines 65–82: `OverviewTask` `$def`. Line 72: `phase: { type: 'string' }`
  - Lines 106–122: `CrewSessionRef` `$def`. **`additionalProperties: false`** — strict; new fields must be added explicitly.
  - Lines 139–177: `RalphPipelineState` `$def`. `additionalProperties: true` — but enum/required must be updated for stage if changed.

- **`tools/overview-mcp/src/tools/`** — 7 files (dev-server-start/stop, envelope, init, parallel-ready-tasks, validate-data, validate-data-schema). `parallel-ready-tasks.ts:93–98` calls `deriveNextCommand(task.ralph, task)`. None directly read `phase`/`planPrompt` — they pass the merged snapshot through.

- **`package.json`** — `"version": "1.0.0"` (CHANGELOG latest entry is **v2.0.2** — package.json is stale; v2.3.0 is the intended next bump from CHANGELOG perspective).

- **`CHANGELOG.md`** — latest entry v2.0.2 (2026-05-24). v2.3.0 candidate for this PR.

- **`README.md`** — references "v2.0.0 (agent-driven install)" surface; no v2.3.0 yet.

- **`CLAUDE.md`** (plugin, 111 lines) — Lines 15–27: MCP surface = 5 tools; Lines 45–86: 16 architecture invariants; no mention of phase vs. lifecycle distinction.

### Test infrastructure
- Root `package.json`: `"test": "npm run test --workspaces --if-present"`, `"typecheck": "npm run typecheck --workspaces --if-present"`.
- Workspaces: `tools/overview-mcp/` + `tools/overview-viewer/`. Vitest run via workspace scripts.

---

## Architect Analysis

### Integration points (read-side / write-side map)

| Component | File | Reads `phase` | Reads `planPrompt` | Action |
|-----------|------|---------------|--------------------|--------|
| Viewer filter haystack | `utils/filters.ts:53,58` | yes | yes | needs `lifecycle ?? phase` + `prompts.* ?? planPrompt` |
| Viewer badge | `components/TaskCommand.tsx:91,167` | yes | — | needs lifecycle fallback |
| Viewer copy button | `components/TaskCommand.tsx:148–164` | — | yes | needs `prompts.plan ?? planPrompt` |
| Bucket classifier | `utils/taskClassification.ts:3–14` | yes (PHASE_TO_BADGE_TEXT) | — | needs lifecycle keys + retain old keys for alias period |
| Phase-tree derivation | `__tests__/phaseTreeDerivation.test.tsx` | yes (fixtures) | — | fixture rewrite |
| sync-core load | `scripts/lib/sync-core.mjs` | indirect (pass-through) | indirect | no logic change; snapshot wraps `command` object verbatim |
| MCP tools | `tools/overview-mcp/src/tools/parallel-ready-tasks.ts:93–98` | indirect | indirect | passes through; will benefit from `task.initialStage`-driven `deriveNextCommand` |
| Schema validator | `scripts/lib/emit-snapshot-schema.mjs` | yes | yes | additive lifecycle/prompts + retain phase/planPrompt for 1 minor |
| Watcher write | `scripts/lib/emit-snapshot.mjs` (and sync-core) | — | — | write-side emits **only** new shape (no double-write) |

### Three "phase"-shaped axes (collision risk)

| Axis | Location | Owner | Values | Concept |
|------|----------|-------|--------|---------|
| `OverviewTask.lifecycle` (new) | types.ts:OverviewTask | bookkeeper hand-curated | `tracked` / `merged` / `archived` | task status in project lifecycle |
| `RalphPipelineState.stage` | types.ts:RalphPipelineState | watcher-derived from `.ralph/jobs/<slug>/job-state.json` | `brainstorming` ... `shipped`, `blocked` | orchestrator runtime stage |
| `CrewSessionRef.phase` (new) | types.ts:CrewSessionRef | derived from memberName prefix | `brainstorm` / `plan` / `impl` / `null` | member intent at spawn time |

Even after rename, three "phase-like" concepts coexist; architect recommends KEEPING the name `phase` on CrewSessionRef (it's the most natural label for the member-intent concept and lives on a different object — no namespace collision in JSON/TS).

### Dependency graph (5 changes A–E)

- **Change A (phase→lifecycle rename)** — MAX ripple radius; every viewer/test reader must transition. Mandatory read-side fallback `lifecycle ?? phase` for 1 minor.
- **Change B (planPrompt→prompts restructure)** — HIGH ripple radius; mandatory read-side fallback `prompts.plan ?? planPrompt` for 1 minor.
- **Change C (initialStage additive)** — LOW ripple; pure addition. Can land independently of A/B, but better atomically.
- **Change D (CrewSessionRef.phase derivation)** — ISOLATED to crew-session subsystem (crews-cross-walk + types + sync). Independent.
- **Change E (state-machine docs + regressionReason)** — DOCS + 1 additive field. Trailing.

### Migration constraint
- v2.3.0 (this PR): ship rename + restructure + initialStage + CrewSessionRef.phase + regressionReason WITH read-side fallbacks (`??`). Write-side emits ONLY the new shape. Single PR per repo.
- v2.4.0 (next minor): drop the `??` fallbacks.

### Ordering across repos
1. Land ralph-overview PR (v2.3.0) FIRST on its main branch. Aliases in place so viewer + MCP can read either old or new shape.
2. Land codexu PR (overview-data.js rewrite + docs) AFTER. By then the consumers can handle new shape.
3. Reverse order would temporarily break the viewer if it hasn't shipped the alias yet.

### Per-file edit sequence (within ralph-overview PR)
1. `tools/overview-viewer/src/types.ts` — interface updates (with `@deprecated` JSDoc on `phase`/`planPrompt`).
2. `scripts/lib/emit-snapshot-schema.mjs` — match types: additive lifecycle/initialStage/prompts/CrewSessionRef.phase/regressionReason; keep phase/planPrompt for 1 minor.
3. `scripts/lib/crews-cross-walk.mjs:207–228` — `buildCrewSessionRef` add phase derivation from `memberName` prefix split (`brainstorm-*` / `plan-*` / `impl-*` / null).
4. `scripts/lib/derive-next-command.mjs` — initial-stage fallback when `state` is null: read `task.initialStage`, return command from `task.command.prompts[<initialStage>]`. Fallback chain when prompts missing → return null.
5. `scripts/sync-ralph-state.mjs` — `runUpdateCrewSession` accepts optional `--phase` override flag + `--regression-reason` flag.
6. `scripts/lib/sync-core.mjs` — read-side fallback when loading overview-data.js entries (no logical change, just defensive read).
7. Viewer components — `TaskCommand.tsx`, `filters.ts`, `Toolbar.tsx`, `taskClassification.ts`: read-side fallback + render new fields (per-phase prompt chips in TaskCommand; phase pill on crew-session refs).
8. Viewer tests — fixture updates; new tests per acceptance criterion.
9. MCP tools — pass-through behavior, but ensure they expose merged shape correctly; add fixture tests if MCP tools have a test harness.
10. `tools/overview-viewer/CLAUDE.md`, plugin-root `README.md` + `CLAUDE.md` — doc updates.
11. `CHANGELOG.md` — v2.3.0 entry with `### Changed`, `### Added`, `### Migration` subsections.
12. `package.json` — bump `"version"` from `"1.0.0"` to `"2.3.0"`.

### Within codexu PR (after ralph-overview lands)
- `plans/overview-data.js` — bulk rewrite. ~49 `"phase":` → `"lifecycle":` with value mapping (`plan-ready`→`tracked`, `shipped`→`merged`, `closed`→`archived`); ~49 `"planPrompt":` → `"prompts": { plan: <content> }`. Optionally add `initialStage` on a few tasks where the bookkeeper has explicit non-default intent (most stay `'planning'` default).
- `plans/codexu-roadmap.md` — update Phase Discipline and Bookkeeper workflow sections.
- `CLAUDE.md` (root, untracked) — same.

### Risk areas
- Three phase-like concepts (lifecycle / stage / CrewSessionRef.phase) — confusion risk if not clearly documented. Mitigation: distinct type names + comparison table in CLAUDE.md.
- `CrewSessionRef.phase` override semantics — `sync-ralph-state.mjs --update-crew-session --phase` override is rare/advanced; document the use case (manifest corruption, manual repair, historical import).
- `initialStage='plan-ready'` + missing `prompts.impl` — `deriveNextCommand` returns null; task is "not actionable" until prompts.impl filled.
- Bookkeeper memory files are operator-local (under `~/.claude/projects/`). Not in repos. They're operator guidance, not code contracts — update post-facto. CI agents never read them.
- `emit-snapshot-schema.mjs` CrewSessionRef has `additionalProperties: false` (strict). The new `phase` field MUST be added explicitly to the schema; otherwise validate-data will fail loudly when the watcher emits the new field.

### Test strategy
- Unit tests: read-side fallback (old data, new data, both present); buildCrewSessionRef phase derivation (4 cases incl. null); derive-next-command initialStage path; schema validator round-trip.
- Fixture updates: every `__tests__/*.tsx` that uses `phase` / `planPrompt`. Replace with new fields; optionally add legacy-shape fixtures asserting fallback.
- Integration test: load actual overview-data.js, assert zero residual `"phase":` / top-level `"planPrompt":` after migration.
- Typecheck + vitest: green across workspaces.

## Codex Research
Not run — Codex CLI failed on Windows (`spawn codex ENOENT` — Node `spawn()` doesn't resolve `.cmd` shims without `shell: true`). Additive/non-blocking reviewer.

## Copilot Research
Not run — `Model "gpt-5.5" from --model flag is not available` (copilot-exec.mjs default model unavailable in this account/install). Additive/non-blocking reviewer.

## Consolidated File List

### codexu repo — files to modify
- `plans/overview-data.js` — bulk rewrite (~49 phase→lifecycle, ~49 planPrompt→prompts.plan, optional initialStage)
- `plans/codexu-roadmap.md` — Phase Discipline + Bookkeeper workflow sections
- `CLAUDE.md` (root, untracked) — same

### ralph-overview repo — files to modify
- `tools/overview-viewer/src/types.ts` — OverviewTask, OverviewCommand, CrewSessionRef, RalphPipelineState
- `tools/overview-viewer/src/components/Toolbar.tsx` — implicit filter axis updates if 'phase' axis was added
- `tools/overview-viewer/src/components/TaskCommand.tsx` — StatusBadge, CopyCommandButton, taskStatusLabel; render per-phase prompt chips + crew-session phase pills
- `tools/overview-viewer/src/utils/filters.ts` — search haystack reads
- `tools/overview-viewer/src/utils/taskClassification.ts` — PHASE_TO_BADGE_TEXT (extend keys)
- `tools/overview-viewer/src/__tests__/bucketCountChips.test.tsx`
- `tools/overview-viewer/src/__tests__/commandBucketGrouping.test.tsx`
- `tools/overview-viewer/src/__tests__/commandList.test.tsx`
- `tools/overview-viewer/src/__tests__/kanban.test.tsx`
- `tools/overview-viewer/src/__tests__/leftRail.test.tsx`
- `tools/overview-viewer/src/__tests__/phaseTreeDerivation.test.tsx`
- `tools/overview-viewer/src/__tests__/stickyFrame.test.tsx`
- `scripts/sync-ralph-state.mjs` — `--update-crew-session --phase` flag, `--regression-reason` flag
- `scripts/lib/sync-core.mjs` — read-side fallback
- `scripts/lib/crews-cross-walk.mjs:207–228` — buildCrewSessionRef phase derivation
- `scripts/lib/derive-next-command.mjs` — initialStage fallback
- `scripts/lib/emit-snapshot-schema.mjs` — schema additions (lifecycle, initialStage, prompts, CrewSessionRef.phase, regressionReason; retain phase/planPrompt for 1 minor)
- `tools/overview-mcp/src/tools/*.ts` — verify pass-through with new shape; add explicit field in returned envelopes if needed
- `tools/overview-viewer/CLAUDE.md`, `CLAUDE.md` (plugin root), `README.md`
- `CHANGELOG.md` — v2.3.0 entry
- `package.json` — bump to v2.3.0

### Bookkeeper memory (operator-local; NOT in repos)
- `C:/Users/evmitran/.claude/projects/D--harness-efforts-codexu/memory/feedback_bookkeeper_updates_overview_data.md`
- `C:/Users/evmitran/.claude/projects/D--harness-efforts-codexu/memory/feedback_phase_discipline_separate_members.md`
