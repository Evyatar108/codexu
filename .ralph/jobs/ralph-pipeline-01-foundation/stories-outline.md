# Stories Outline: Plan 01 — Foundation (schema, sync core, one-shot sync, sidecar emit)

*Preliminary decomposition from `/plan-with-ralph --improve`. Feed to `/implement-with-ralph --from-plan` for PRD generation.*

## US-001: Ralph types + Window declaration

**Description:** As a frontend developer, I want the overview-viewer to carry the type model for Ralph pipeline state so that future plans can typecheck against a stable contract.

**Acceptance Criteria:**
- [ ] `tools/overview-viewer/src/types.ts` exports `RalphStage` (10 values including `replan-pending`), `RalphEntryPath`, `RalphArtifacts`, `RalphPipelineState`, `OverviewRalphState`, and a `getOverviewRalphState(): OverviewRalphState` helper.
- [ ] `OverviewData` interface is extended with `ralphOverrides?: Record<string, string>` (slug → taskId, hand-edited).
- [ ] `tools/overview-viewer/src/overviewData.ts` declares `Window.OVERVIEW_RALPH_STATE?: OverviewRalphState` alongside the existing `OVERVIEW_DATA` global.
- [ ] `getOverviewRalphState()` typechecks without `as` casts.
- [ ] `OverviewTask` does NOT carry a `ralph` field (separation is preserved — lookup is `ralphState.byTaskId[task.id]`).
- [ ] `pnpm --filter @codexu/overview-viewer typecheck` exits 0.

**Dependencies:** None

**Estimated complexity:** small

---

## US-002: Config layer (resolver + default + schema + .gitignore)

**Description:** As an operator running `pnpm sync-ralph-state`, I want a single config resolver so the sync code stays project-agnostic and downstream plans extend the same artifact.

**Acceptance Criteria:**
- [ ] `scripts/lib/default-config.mjs` exports a frozen codexu-default config object containing only Plan-01 fields (`dataFile`, `ralphRoot`, `ralphSubdirs`, `outputs.{sidecarJs, sidecarJson}`, `lockFile`, `watcher.ignored`).
- [ ] `scripts/lib/resolve-config.mjs` exports `loadConfig({ repoRoot, configPath? })` that merges defaults → committed → `.local.json` overlay → env `OVERVIEW_CONFIG_PATH` per the canonical precedence rule in the plan.
- [ ] `.ralph/overview-config.json` exists as committed pure JSON (validated by `node -e "JSON.parse(require('fs').readFileSync('.ralph/overview-config.json'))"`).
- [ ] `.ralph/overview-config.schema.json` exists as pure JSON Schema (no comments) referenced by `$schema` from the live config.
- [ ] `.gitignore` contains `.ralph/overview-config.local.json` (verifiable via `grep -F '.ralph/overview-config.local.json' .gitignore`).
- [ ] Config-layering unit test passes: env > local > committed > defaults precedence holds.
- [ ] `loadConfig` returns the result frozen per the plan's "Object.freeze" contract (shallow OR deep depending on US-002's chosen path per Open Question F-012).
- [ ] Typecheck passes.

**Dependencies:** US-001

**Estimated complexity:** medium

---

## US-003: Stateless stage-derivation predicate

**Description:** As a sync orchestrator, I want a pure stage-derivation predicate so the predicate stays unit-testable in isolation and is reused by future plans (watcher, snapshot, MCP).

**Acceptance Criteria:**
- [ ] `scripts/lib/derive-ralph-stage.mjs` exports `deriveRalphStage(bundle) -> RalphStage` accepting `{ jobState?, prd?, brainstormJson?, reviewOpenCount?, jobDirMarker? }`. No filesystem access, no list inputs.
- [ ] All 10 predicates from the plan's stage-derivation table are implemented in order; `replan-pending` is handled by predicate #3.
- [ ] `tools/overview-viewer/src/__tests__/scripts.d.ts` declares the imported `.mjs` module(s) using explicit relative-path module specifiers (not the wildcard form, which doesn't resolve under `moduleResolution: bundler`).
- [ ] `tools/overview-viewer/src/__tests__/ralphStage.test.ts` has at least: 10 stage cases (one per `RalphStage` value), one case asserting `reviewOpenCount.<phase> === undefined` (missing findings file) maps to `reviewing` not `review-fix`, one case asserting `jobDirMarker: true` without prd/jobState maps to `planning`.
- [ ] `pnpm --filter @codexu/overview-viewer test src/__tests__/ralphStage.test.ts` all stage cases pass.
- [ ] Typecheck passes.

**Dependencies:** US-001

**Estimated complexity:** medium

---

## US-004: Walk + match + cross-kind collapse

**Description:** As a sync orchestrator, I want a deterministic walk of `.ralph/` that resolves artifacts to overview task IDs and collapses cross-kind collisions before predicate evaluation.

**Acceptance Criteria:**
- [ ] `scripts/lib/sync-core.mjs` exports `walkRalphState({ repoRoot, config, generatedFromCommit }) -> Promise<OverviewRalphState>`.
- [ ] Walk reads `<ralphRoot>/<ralphSubdirs.jobs>/`, `<ralphRoot>/<ralphSubdirs.jobGroups>/`, `<ralphRoot>/<ralphSubdirs.brainstorms>/` (each direct children only; no recursion into `<slug>/`).
- [ ] Nested `<jobGroups>/<group>/<member>/job-state.json` files do NOT produce per-task entries (group-member granularity is Plan 10).
- [ ] Slug-heuristic matching: `ralphOverrides[slug]` (overrides) → `OverviewTask.id === slug` (default) → `unmatched[]` with `reason: 'no-matching-task-id'`.
- [ ] Within-kind duplicates: pick max `updatedAt`; others go to `unmatched[]` with `reason: 'duplicate-resolution'`.
- [ ] Cross-kind precedence: job > group > brainstorm; losers go to `unmatched[]` with `reason: 'shadowed-by-<kind>'`.
- [ ] Plan-decided behavior on malformed `job-state.json`: log to stderr, append to `unmatched[]` with `reason: 'parse-error'`, do NOT derive a stage from sibling files for that slug.
- [ ] Output is deterministically sorted: `byTaskId` keys alphabetical; `unmatched[]` sorted by `kind` then `slug`.
- [ ] Unit tests cover: cross-kind precedence (job shadows brainstorm), duplicate-by-mtime, malformed-JSON skip, slug-default vs `ralphOverrides` resolution.
- [ ] Typecheck passes.

**Dependencies:** US-002, US-003

**Estimated complexity:** large

---

## US-005: Atomic write + `</script>` escape

**Description:** As a sync emitter, I want atomic, escape-safe sidecar writes so the React dashboard never eval-crashes on a torn file and inlined HTML can't be broken by a script-tag substring.

**Acceptance Criteria:**
- [ ] `scripts/lib/sync-core.mjs` exports `writeSidecar({ repoRoot, config, state })`.
- [ ] `.tmp` file is emitted next to its destination (same volume), `fs.fsync` is called on the tmp, then `fs.renameSync(tmp, final)`.
- [ ] On `EBUSY`/`EACCES`/`EPERM` the rename retries up to 3× with 100ms delay; exits non-zero after the 3rd failure.
- [ ] JS sidecar body escapes `<\/script` via `JSON.stringify(state).replace(/<\/(script)/gi, '<\\/$1')`. A test asserts the literal substring `</script` does not appear in the emitted `.js` after a slug containing `</script>` is fed through.
- [ ] JS + JSON sidecars are byte-identical after stripping the JS wrapper.
- [ ] Idempotency: two consecutive `pnpm sync-ralph-state` runs produce byte-identical sidecars after `del(.generatedAt)` filter (per plan's Verification D and the F-008 resolution).
- [ ] Typecheck passes.

**Dependencies:** US-004

**Estimated complexity:** medium

---

## US-006: CLI wrapper + npm script

**Description:** As an operator, I want `pnpm sync-ralph-state` to run an end-to-end one-shot sync against the live `.ralph/`.

**Acceptance Criteria:**
- [ ] `scripts/sync-ralph-state.mjs` exists. Resolves repo root via `git rev-parse --show-toplevel`. Computes `generatedFromCommit` via `git rev-parse --short HEAD` (emits `'unknown'` on failure; never crashes).
- [ ] Accepts `--repo <path>` and `--config <path>` flags; `--config` threads to `loadConfig({ repoRoot, configPath })`.
- [ ] Calls `loadConfig` → `walkRalphState` → `writeSidecar`; prints `unmatched[]` to stderr.
- [ ] Exits 0 on success, 1 on hard error.
- [ ] Root `package.json` has `"sync-ralph-state": "node scripts/sync-ralph-state.mjs"`.
- [ ] `pnpm sync-ralph-state` from `D:\harness-efforts\codexu` exits 0 against the current `.ralph/` and produces non-empty `plans/overview-ralph-state.json` whose `byTaskId` is a valid (possibly empty) object.

**Dependencies:** US-004, US-005

**Estimated complexity:** small

---

## US-007: Bootstrap sidecar + cascade refresh

**Description:** As a downstream-plan author, I want Plan 01's contracts surfaced in the INDEX and sibling plans so the cascade from Plan 02–12 stays coherent.

**Acceptance Criteria:**
- [ ] First post-implementation commit runs `pnpm sync-ralph-state` and includes the generated `plans/overview-ralph-state.{js,json}` (per the plan's Hand-off section; Implementation Strategy step 7 is dropped as the duplicate per F-018).
- [ ] `plans/ralph-pipeline-INDEX.md` "Source-of-truth modules" table reflects: stateless `derive-ralph-stage.mjs(bundle)` signature with `jobDirMarker`, `sync-core.mjs` cross-kind precedence + nested-member suppression, `resolve-config.mjs` precedence rule, `</script>` escape contract, `scripts.d.ts` ambient-decl approach, and the trimmed Plan-01 config schema (deferred fields documented as "Downstream additive extensions").
- [ ] Sibling plans 02, 03, 05, 10, 12 referenced in the Hand-off section have their Plan-01 dependencies updated to match the contracts above; any stale type signatures or function names are corrected.
- [ ] The implementation commit message lists every cross-plan diff (file, lines, what changed) so reviewers can verify the cascade.

**Dependencies:** US-001, US-002, US-003, US-004, US-005, US-006

**Estimated complexity:** medium
