# Stories Outline: overview-data-dynamic-stages-schema

*Preliminary decomposition from `/plan-with-ralph`. Feed to `/implement-with-ralph --from-plan` for PRD generation.*

## US-001: Schema types & JSON Schema mirror
**Description:** As a maintainer of `ralph-overview`, I want the canonical TypeScript types and the JSON Schema mirror to declare the five new schema changes (A–E) so that every downstream consumer sees a single source of truth.
**Acceptance Criteria:**
- [ ] `tools/overview-viewer/src/types.ts` declares `OverviewTask.lifecycle?: string`, `OverviewTask.initialStage?: RalphStage`, `OverviewCommand.prompts?: { brainstorm?: string; plan?: string; impl?: string }`, `CrewSessionRef.phase?: 'brainstorm' | 'plan' | 'impl' | null`, `RalphPipelineState.regressionReason?: string`
- [ ] `OverviewTask.phase?: string` and `OverviewCommand.planPrompt?: string | null` carry `@deprecated` JSDoc referencing v2.4.0 removal
- [ ] `scripts/lib/emit-snapshot-schema.mjs` mirrors all five new fields (CrewSessionRef.phase explicitly added because schema is `additionalProperties: false`); legacy `phase`/`planPrompt` keys are retained for the v2.3.0 alias window
- [ ] Typecheck passes
**Dependencies:** None
**Estimated complexity:** small

## US-002: Sync-layer derivation logic
**Description:** As a watcher, I want `buildCrewSessionRef` to derive `phase` from `memberName`, `deriveNextCommand` to consult `task.initialStage` when state is null, `loadOverviewData` to normalize `lifecycle`/`prompts` on read, and `sync-ralph-state.mjs` to expose CLI flags for crew-session phase override and regression-reason recording.
**Acceptance Criteria:**
- [ ] `scripts/lib/crews-cross-walk.mjs:207–228` `buildCrewSessionRef` returns `phase` derived from `memberName` prefix (`brainstorm-*` → `'brainstorm'`, `plan-*` → `'plan'`, `impl-*` → `'impl'`, else `null`)
- [ ] `scripts/lib/derive-next-command.mjs` returns a kickoff command sourced from `task.command.prompts[<initialStage>]` when `state` is null AND `task.initialStage` is set; returns null when the corresponding prompt is missing
- [ ] `scripts/lib/sync-core.mjs:818` `loadOverviewData` normalizes each loaded task: `lifecycle ?? mapLegacyPhaseToLifecycle(phase)` and `command.prompts ?? { plan: command.planPrompt }` (when present)
- [ ] `scripts/sync-ralph-state.mjs --update-crew-session --phase <brainstorm|plan|impl|null>` threads phase into the explicit CrewSessionRef before merge
- [ ] `scripts/sync-ralph-state.mjs --record-regression --taskId <id> --regression-reason <text>` is a new top-level mode that stamps `state.byTaskId[taskId].regressionReason` and calls `writeSidecar`
- [ ] Typecheck + unit tests pass for all of the above
**Dependencies:** US-001
**Estimated complexity:** medium

## US-003: React viewer read-side migration
**Description:** As a viewer user, I want existing badges, search, filter chips, and copy buttons to work transparently whether the snapshot carries the legacy `phase`/`planPrompt` shape or the new `lifecycle`/`prompts` shape; I also want per-phase prompt chips and CrewSessionRef phase pills to render when multi-phase data is present.
**Acceptance Criteria:**
- [ ] `tools/overview-viewer/src/components/TaskCommand.tsx` `StatusBadge` reads `task.lifecycle ?? task.phase`; `CopyCommandButton` reads `task.command?.prompts?.plan ?? task.command?.planPrompt`
- [ ] `tools/overview-viewer/src/utils/filters.ts` haystack reads include the same fallbacks
- [ ] `tools/overview-viewer/src/utils/taskClassification.ts` `PHASE_TO_BADGE_TEXT` contains keys for new lifecycle values (`tracked`, `merged`, `archived`) AND retains all legacy phase values discovered during the AC E1 exhaustive scan
- [ ] `tools/overview-viewer/src/components/Toolbar.tsx` filter axes updated if any chip group was keyed on `phase`
- [ ] TaskCommand.tsx renders a per-phase prompt chip when `command.prompts` has more than one populated key
- [ ] TaskCommand.tsx renders a phase pill on each CrewSessionRef when `phase` is non-null
- [ ] `rg "task\\.phase\\b" tools/overview-viewer/src/` returns zero unaliased reads
- [ ] Typecheck passes
**Dependencies:** US-001, US-002
**Estimated complexity:** medium

## US-004: Test suite updates
**Description:** As a CI gatekeeper, I want the existing viewer test fixtures and new alias-round-trip tests, crew-session phase derivation tests, and deriveNextCommand initialStage-fallback tests to validate the schema migration.
**Acceptance Criteria:**
- [ ] All 7 existing `tools/overview-viewer/src/__tests__/*.test.tsx` files referencing `phase`/`planPrompt` updated to new shape (or accept both via mixed-shape fixtures)
- [ ] New test `tools/overview-viewer/src/__tests__/lifecycleAlias.test.tsx` covers: legacy-only (phase), new-only (lifecycle), both present (lifecycle takes precedence)
- [ ] New test `tools/overview-viewer/src/__tests__/promptsRestructure.test.tsx` covers: `prompts.plan ?? planPrompt` fallback; per-phase chip rendering
- [ ] New test `scripts/lib/__tests__/buildCrewSessionRef.test.mjs` (or colocated equivalent) covers all 4 memberName-prefix derivation cases
- [ ] New test `scripts/lib/__tests__/deriveNextCommand.initialStage.test.mjs` (or colocated equivalent) covers state=null + task.initialStage + prompts/no-prompts
- [ ] `npm run test --workspaces --if-present` exits 0 from the plugin root
- [ ] `npm run typecheck --workspaces --if-present` exits 0
**Dependencies:** US-001, US-002, US-003
**Estimated complexity:** medium

## US-005: Plugin documentation + version + CHANGELOG
**Description:** As a future contributor, I want plugin documentation to explain the three "phase-like" axes, the state-machine + regression flow, and the v2.3.0 deprecation timeline.
**Acceptance Criteria:**
- [ ] `D:/ai-developer-toolkit/plugins/ralph-overview/CLAUDE.md` and `tools/overview-viewer/CLAUDE.md` document the three axes (lifecycle / stage / CrewSessionRef.phase) with a comparison table and explain state-machine + regression semantics
- [ ] `D:/ai-developer-toolkit/plugins/ralph-overview/README.md` updated if it references `phase`/`planPrompt`
- [ ] `D:/ai-developer-toolkit/plugins/ralph-overview/CHANGELOG.md` has a `## [2.3.0]` entry with `### Changed`, `### Added`, and `### Migration` subsections
- [ ] `D:/ai-developer-toolkit/plugins/ralph-overview/package.json` `"version"` is `"2.3.0"`
**Dependencies:** US-001, US-002, US-003, US-004
**Estimated complexity:** small

## US-006: MCP tool verification
**Description:** As an agent consumer, I want MCP tools to pass through the new shape transparently without breaking the existing call sites.
**Acceptance Criteria:**
- [ ] Audit of `tools/overview-mcp/src/tools/*.ts` confirms no direct `phase`/`planPrompt` reads remain (or any that do use the fallback pattern)
- [ ] `tools/overview-mcp/src/tools/parallel-ready-tasks.ts:93–98` continues to invoke `deriveNextCommand(task.ralph, task)` without signature change; runtime now reads `task.initialStage` when state is null
- [ ] If an MCP test harness exists, fixtures cover the state=null + initialStage path; if no harness exists, a thin one is added
**Dependencies:** US-001, US-002
**Estimated complexity:** small

## US-007: overview-data.js rewrite
**Description:** As the bookkeeper, I want `plans/overview-data.js` to use the new `lifecycle` and `prompts` fields so the viewer + MCP can drop the legacy aliases in v2.4.0.
**Acceptance Criteria:**
- [ ] Pre-flight scan with `grep -oE '"phase":\s*"[^"]+"' plans/overview-data.js | sort -u` enumerates all distinct legacy values; mapping is exhaustive (any unmapped value blocks the rewrite)
- [ ] Bulk rewrite: ~49 `"phase": "<val>"` entries → `"lifecycle": "<new-val>"` using mapping (`plan-ready → tracked`, `shipped → merged`, `closed → archived`, plus any additional discovered values mapped explicitly)
- [ ] Bulk rewrite: ~49 `"planPrompt": "..."` entries → `"prompts": { plan: "..." }` preserving content verbatim
- [ ] Optionally add `initialStage` on tasks where the bookkeeper has explicit non-default kickoff intent
- [ ] `grep -c '"phase":' plans/overview-data.js` returns 0
- [ ] `grep -c '"planPrompt":' plans/overview-data.js` returns 0
**Dependencies:** PR #1 (ralph-overview v2.3.0) merged to its main branch first
**Estimated complexity:** medium

## US-008: codexu roadmap docs
**Description:** As the operator, I want `plans/codexu-roadmap.md` to describe the state-machine model, per-phase prompts, regression flow, and the one-member-per-phase rule using the new field names.
**Acceptance Criteria:**
- [ ] Phase Discipline section updated with state-machine semantics (forward + regression transitions)
- [ ] Bookkeeper Workflow section updated to reference `lifecycle` (not `phase`), `prompts.<phase>` (not `planPrompt`), and the `--record-regression` flow
**Dependencies:** US-007 (same PR)
**Estimated complexity:** small

## US-009: codexu root CLAUDE.md
**Description:** As an agent picking up the bookkeeper context, I want the root `CLAUDE.md` (untracked) to mirror the roadmap doc updates.
**Acceptance Criteria:**
- [ ] Two-file split section, Bookkeeper duty table, and Common confusion points reflect the new schema
- [ ] Three-axis comparison (lifecycle / stage / CrewSessionRef.phase) documented
**Dependencies:** US-008 (same PR)
**Estimated complexity:** small

## US-010: Operator memory updates
**Description:** As the operator's future bookkeeper session, I want the local `feedback_*.md` memory files to reflect the new field names and regression flow.
**Acceptance Criteria:**
- [ ] `C:/Users/evmitran/.claude/projects/D--harness-efforts-codexu/memory/feedback_bookkeeper_updates_overview_data.md` uses `lifecycle: "merged"` in the example + rule text
- [ ] `C:/Users/evmitran/.claude/projects/D--harness-efforts-codexu/memory/feedback_phase_discipline_separate_members.md` includes a paragraph about regressions spawning fresh members and reusing `prompts.<phase>`
**Dependencies:** US-008, US-009 (operator-local; runs last)
**Estimated complexity:** trivial
