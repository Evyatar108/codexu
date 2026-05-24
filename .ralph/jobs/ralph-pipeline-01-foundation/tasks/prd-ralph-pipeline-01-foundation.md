# PRD: Ralph Pipeline 01 — Foundation (schema, sync core, one-shot sync, sidecar emit)

*Generated from `D:/harness-efforts/codexu/.ralph/jobs/ralph-pipeline-01-foundation/plan.md` and `stories-outline.md` on 2026-05-18. Mode: interactive (minimal-questions — no ambiguity surfaced by the source plan; assumptions inherited verbatim from the plan).*

**Job:** `ralph-pipeline-01-foundation`
**Worktree:** main checkout at `D:\harness-efforts\codexu` (no separate worktree).
**Position in DAG:** root. Enables plans 02, 03, 05, 10.

## 1. Introduction / Overview

The codexu overview dashboard (`tools/overview-viewer/`) currently renders static per-task metadata from the hand-curated `plans/overview-data.js`, but it has no representation of where each task currently sits in the Ralph pipeline (`/brainstorm-with-ralph` → `/plan-with-ralph` → `/implement-with-ralph`). Ralph pipeline state already exists on disk under `.ralph/jobs/*/job-state.json`, `.ralph/job-groups/*/group.json` + `job-state.json`, and `.ralph/brainstorms/*/brainstorm.json`, but isn't surfaced anywhere consumable by the dashboard.

This PRD covers the **foundation layer only**: a TypeScript type model for pipeline state, a stateless stage-derivation predicate, a config resolver, a deterministic walk-+-match-+-emit sync core, a one-shot CLI wrapper, and the dual-emit sidecar (`plans/overview-ralph-state.{js,json}`). After this PRD ships, an operator can run `pnpm sync-ralph-state` and inspect the sidecar by hand. **Nothing in the React UI changes** — that is Plan 03.

## 2. Goals

- Establish a stable, typed contract (`OverviewRalphState`, `RalphPipelineState`, `RalphStage`) that future plans (02, 03, 05, 09, 10) can consume without re-deriving.
- Make stage derivation a pure, unit-testable function with no filesystem access.
- Make the entire system project-agnostic via a single config resolver (`loadConfig`) so Plan 12 can extract it as a reusable plugin without code edits.
- Guarantee that two consecutive sync runs produce byte-identical sidecars (modulo the top-level `generatedAt`) — i.e. deterministic, idempotent output.
- Survive Windows + Vite-dev-server contention via atomic tmp+rename with retry on `EBUSY`/`EACCES`/`EPERM`.
- Prevent the React app from eval-crashing on inlined `<script>` content by escaping `</script` defensively in the JS sidecar.

## 3. User Stories

### US-001: Ralph types + Window declaration
**Description:** As a frontend developer, I want the overview-viewer to carry the type model for Ralph pipeline state so that future plans can typecheck against a stable contract.

**Acceptance Criteria:**
- [ ] `tools/overview-viewer/src/types.ts` exports `RalphStage` (10 values: `brainstorming`, `brainstorm-ready`, `planning`, `plan-ready`, `implementing`, `reviewing`, `review-fix`, `replan-pending`, `shipped`, `blocked`), `RalphEntryPath`, `RalphArtifacts`, `RalphPipelineState`, `OverviewRalphState`, and a `getOverviewRalphState(): OverviewRalphState` helper.
- [ ] `OverviewData` interface is extended with `ralphOverrides?: Record<string, string>` (slug → taskId, hand-edited).
- [ ] `tools/overview-viewer/src/overviewData.ts` declares `Window.OVERVIEW_RALPH_STATE?: OverviewRalphState` alongside the existing `OVERVIEW_DATA` global in the `declare global` block.
- [ ] `getOverviewRalphState()` typechecks without `as` casts (relies on the ambient `Window` declaration).
- [ ] `OverviewTask` does NOT carry a `ralph` field — separation is preserved; lookup is `ralphState.byTaskId[task.id]`.
- [ ] `pnpm --filter @codexu/overview-viewer typecheck` exits 0.

**Dependencies:** None
**Estimated complexity:** small

---

### US-002: Config layer (resolver + default + schema + .gitignore)
**Description:** As an operator running `pnpm sync-ralph-state`, I want a single config resolver so the sync code stays project-agnostic and downstream plans extend the same artifact.

**Acceptance Criteria:**
- [ ] `scripts/lib/default-config.mjs` exports a frozen codexu-default config object containing only Plan-01 fields: `dataFile`, `ralphRoot`, `ralphSubdirs.{jobs, jobGroups, brainstorms}`, `outputs.{sidecarJs, sidecarJson}`, `lockFile`, `watcher.ignored`.
- [ ] `scripts/lib/resolve-config.mjs` exports `loadConfig({ repoRoot, configPath? })` that enforces the canonical precedence:
  - **Merge order (lowest → highest):** `defaults` < `committed` < `.local.json overlay`.
  - **Committed-path lookup (lowest → highest):** default `<repoRoot>/.ralph/overview-config.json` < `OVERVIEW_CONFIG_PATH` env var < `configPath` argument.
  - The `.local.json` overlay always sits next to whichever committed file was selected.
- [ ] `loadConfig` resolves all paths to absolute paths against `repoRoot`.
- [ ] `loadConfig` returns the resolved object frozen via deep-freeze (recursive `Object.freeze` so `outputs`, `ralphSubdirs`, `watcher` are also immutable) — resolves Open Question F-012 in favor of deep-freeze.
- [ ] `loadConfig` warns (does not throw) to stderr when a configured `ralphSubdirs.*` directory is missing — empty `.ralph/` remains valid.
- [ ] `.ralph/overview-config.json` exists as committed pure JSON (no comments, no trailing commas), validated by `node -e "JSON.parse(require('fs').readFileSync('.ralph/overview-config.json'))"`.
- [ ] `.ralph/overview-config.schema.json` exists as pure JSON Schema (no comments, no trailing commas), referenced by `$schema` from the committed config.
- [ ] `.gitignore` contains `.ralph/overview-config.local.json` — verifiable via `grep -F '.ralph/overview-config.local.json' .gitignore`.
- [ ] Config-layering unit test passes both sub-assertions: (a) overlay wins over redirected committed config; (b) `configPath` arg overrides `OVERVIEW_CONFIG_PATH` env var.
- [ ] `pnpm --filter @codexu/overview-viewer typecheck` passes.

**Dependencies:** US-001
**Estimated complexity:** medium

---

### US-003: Stateless stage-derivation predicate
**Description:** As a sync orchestrator, I want a pure stage-derivation predicate so the predicate stays unit-testable in isolation and is reused by future plans (watcher, snapshot, MCP).

**Acceptance Criteria:**
- [ ] `scripts/lib/derive-ralph-stage.mjs` exports `deriveRalphStage(bundle) -> RalphStage` accepting one bundle: `{ jobState?, prd?, brainstormJson?, reviewOpenCount?, jobDirMarker? }`. No filesystem access. No list inputs.
- [ ] Predicate-set constants are defined once: `REVIEW_PHASES = ['5a','5b','5.5','6']` and `IMPLEMENTING_PHASES = ['1','2','3','4','5c']`.
- [ ] All 10 predicates from the plan's stage-derivation table are implemented **in order** (first match wins):
  1. `shipped` — `orchestrator.terminal=true && terminalReason='complete'`
  2. `blocked` — `status='BLOCKED'` OR `(terminal=true && terminalReason='blocked')`
  3. `replan-pending` — `terminal=true && terminalReason='replan'`
  4. `review-fix` — `phase ∈ REVIEW_PHASES` AND `terminal !== true` AND ≥1 `reviewOpenCount.* > 0`
  5. `reviewing` — `phase ∈ REVIEW_PHASES` AND `terminal !== true` AND (no findings file OR all `reviewOpenCount.* === 0`)
  6. `implementing` — `jobState && orchestrator && terminal !== true && phase ∉ REVIEW_PHASES` — includes `IMPLEMENTING_PHASES`, unknown/future phase strings, and empty/missing phase
  7. `plan-ready` — `prd` exists AND `jobState` absent
  8. `planning` — `jobDirMarker === true` AND `prd` absent AND `jobState` absent
  9. `brainstorm-ready` — `brainstormJson.recommendedDirection` is set
  10. `brainstorming` — `brainstormJson` exists AND `recommendedDirection` absent
- [ ] Unknown/future phase values map to `implementing` via predicate #6 (never fall through to #7+).
- [ ] `tools/overview-viewer/src/__tests__/scripts.d.ts` declares all three `.mjs` modules touched by the test file (`derive-ralph-stage.mjs`, `sync-core.mjs`, `resolve-config.mjs`) using **explicit relative-path module specifiers** (`'../../../../scripts/lib/<file>.mjs'`) — NOT wildcard patterns (which do not resolve under `moduleResolution: "bundler"`).
- [ ] `tools/overview-viewer/src/__tests__/ralphStage.test.ts` includes at minimum:
  - 10 stage cases (one per `RalphStage` value, including `replan-pending`)
  - 1 case asserting `reviewOpenCount.<phase> === undefined` (missing findings file) maps to `reviewing`, NOT `review-fix`
  - 1 case per `IMPLEMENTING_PHASES` value (`'1'`, `'2'`, `'3'`, `'4'`, `'5c'`) asserting predicate #6 returns `implementing` (parametrized via `it.each`)
  - 1 case asserting an unknown phase string (e.g. `'4.5'`, `'7'`) maps to `implementing` via predicate #6
  - 1 case asserting `jobDirMarker: true` without prd/jobState maps to `planning` via predicate #8
- [ ] `pnpm --filter @codexu/overview-viewer test src/__tests__/ralphStage.test.ts` exits 0.
- [ ] Typecheck passes.

**Dependencies:** US-001
**Estimated complexity:** medium

---

### US-004: Walk + match + cross-kind collapse
**Description:** As a sync orchestrator, I want a deterministic walk of `.ralph/` that resolves artifacts to overview task IDs and collapses cross-kind collisions before predicate evaluation.

**Acceptance Criteria:**
- [ ] `scripts/lib/sync-core.mjs` exports `walkRalphState({ repoRoot, config, generatedFromCommit }) -> Promise<OverviewRalphState>`.
- [ ] Walk root is exactly `<repoRoot>/<config.ralphRoot>/`. Walker NEVER recurses from `<repoRoot>` directly (would hit `.worktrees/*/.ralph/`).
- [ ] Walk reads:
  - `<ralphRoot>/<ralphSubdirs.jobs>/` direct children — read `job-state.json`, `prd.json`, `code-review-findings.json`, `docs-review-findings.json`. Set `jobDirMarker: true` on bundle whenever the `<slug>/` directory is observed. Do NOT recurse into `<slug>/`.
  - `<ralphRoot>/<ralphSubdirs.jobGroups>/` direct children — read each group's own top-level `job-state.json`, `prd.json`, findings (treated as `jobState`/`prd`/`reviewOpenCount` inputs to the predicate — group orchestrator schema matches job schema). Also read `group.json` (metadata only — NOT passed to predicate; used for `RalphArtifacts.groupDir`, `isParallel`). Set `jobDirMarker: true` when `<group>/` is observed.
  - `<ralphRoot>/<ralphSubdirs.brainstorms>/` direct children — read `brainstorm.json`.
- [ ] Skip symlinks. Skip paths matching any pattern in `config.watcher.ignored` (at minimum: `.worktrees/**`, `**/.git/**`, `.ralph/jobs/*/worktree/**`, `.ralph/jobs/.staging/**`, `.ralph/telemetry/**`, `.crews/logs/**`, `.crews/spawn-launchers/**`).
- [ ] Nested `<jobGroups>/<group>/<member>/job-state.json` files do NOT produce per-task entries (group-member granularity is Plan 10).
- [ ] **Slug-heuristic matching** resolves each artifact to an `OverviewTask.id`:
  1. `ralphOverrides[slug]` (read from `overview-data.js` via the trusted-eval pattern in `tools/overview-viewer/src/__tests__/testData.ts`) → `matchSource: 'override'`
  2. `OverviewTask.id === slug` (default) → `matchSource: 'slug-default'`
  3. Otherwise → append to `unmatched[]` with `reason: 'no-matching-task-id'`
- [ ] **Within-kind duplicates:** pick max `jobState.updatedAt` (falling back to directory mtime); others go to `unmatched[]` with `reason: 'duplicate-resolution'`.
- [ ] **Cross-kind precedence:** `job` > `group` > `brainstorm`. Losers go to `unmatched[]` with `reason: 'shadowed-by-<winning-kind>'`. Precedence is applied BEFORE the predicate; the winner's bundle is what `deriveRalphStage` sees.
- [ ] **Malformed `job-state.json` handling** (resolves Open Question F-011): log to stderr, append to `unmatched[]` with `reason: 'parse-error'`, do NOT derive a stage from sibling files for that slug.
- [ ] `reviewOpenCount.<phase>` is `undefined` (NOT `0`) when the corresponding findings file is missing — load-bearing for the `reviewing` vs `review-fix` predicate.
- [ ] Output is deterministically sorted: `byTaskId` keys alphabetical; `unmatched[]` sorted by `kind` then `slug`.
- [ ] Sync-core stamps `generatedFromCommit` (passed by CLI) and `generatedAt = new Date().toISOString()` onto the returned state.
- [ ] **`walkRalphState` does NOT shell out to `git`** — the CLI owns the `git rev-parse` lookup so the core stays fixture-testable.
- [ ] Helper exports `resolveCrossKindPrecedence` and `pickMostRecentByMtime` for unit testing (signatures pre-declared in `scripts.d.ts`).
- [ ] Unit tests in `ralphStage.test.ts` cover:
  - cross-kind precedence (job shadows brainstorm)
  - duplicate-by-mtime within one kind
  - malformed-JSON skip (asserts `reason: 'parse-error'` in `unmatched[]`)
  - slug-default vs `ralphOverrides` resolution
  - group-as-job stage derivation: a `<group>/` with only a top-level `job-state.json` resolves via the same 10-case predicate
- [ ] Typecheck passes.

**Dependencies:** US-002, US-003
**Estimated complexity:** large

---

### US-005: Atomic write + `</script>` escape
**Description:** As a sync emitter, I want atomic, escape-safe sidecar writes so the React dashboard never eval-crashes on a torn file and inlined HTML can't be broken by a script-tag substring.

**Acceptance Criteria:**
- [ ] `scripts/lib/sync-core.mjs` exports `writeSidecar({ repoRoot, config, state }) -> Promise<void>`.
- [ ] **Same-volume tmp + rename:** `.tmp` file is emitted next to its destination (e.g. `plans/overview-ralph-state.js.tmp` next to `plans/overview-ralph-state.js`), `fs.fsync` is called on the tmp, then `fs.renameSync(tmp, final)`.
- [ ] **Retry on Windows-transient errors:** on `EBUSY` / `EACCES` / `EPERM`, the rename retries up to 3× with 100ms delay. After the 3rd failure, the function rejects/exits non-zero.
- [ ] **`</script>` escape:** the JS sidecar body uses `JSON.stringify(state).replace(/<\/(script)/gi, '<\\/$1')`. A unit test asserts that the literal substring `</script` does not appear in the emitted `.js` file after a slug containing `</script>` is fed through.
- [ ] JS sidecar format: `window.OVERVIEW_RALPH_STATE = <escaped JSON>;`.
- [ ] JS + JSON sidecars are byte-identical after stripping the JS wrapper (`window.OVERVIEW_RALPH_STATE = ` prefix and trailing `;`).
- [ ] **Idempotency** — running `writeSidecar` twice in a row with the same state produces byte-identical files (excluding only the top-level `generatedAt`). Per-entry `generatedAt` is forbidden in Plan 01 (see Type model in plan.md).
- [ ] Typecheck passes.

**Dependencies:** US-004
**Estimated complexity:** medium

---

### US-006: CLI wrapper + npm script
**Description:** As an operator, I want `pnpm sync-ralph-state` to run an end-to-end one-shot sync against the live `.ralph/`.

**Acceptance Criteria:**
- [ ] `scripts/sync-ralph-state.mjs` exists. Resolves repo root via `child_process.execFileSync('git', ['rev-parse', '--show-toplevel'])`.
- [ ] Computes `generatedFromCommit` via `child_process.execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: repoRoot })`. **Failure handling:** any thrown error or non-zero exit (detached HEAD with no commits, missing `.git`, unresolvable HEAD, `git` not on PATH) is caught, emits a single stderr warning (`sync-ralph-state: could not resolve HEAD short SHA, using 'unknown'`), and sets `generatedFromCommit = 'unknown'`. **Never crashes.**
- [ ] Accepts `--repo <path>` (override repo root) and `--config <path>` (override config path) flags. `--config` value is threaded into `loadConfig({ repoRoot, configPath })`.
- [ ] Pipeline: `loadConfig` → `walkRalphState({ config, repoRoot, generatedFromCommit })` → `writeSidecar({ config, repoRoot, state })`.
- [ ] Prints `state.unmatched[]` to stderr (one line per entry).
- [ ] Exits 0 on success, 1 on hard error.
- [ ] Root `package.json` has `"sync-ralph-state": "node scripts/sync-ralph-state.mjs"` in the `scripts` block (ordered alphabetically or after `overview:build:preview`).
- [ ] `pnpm sync-ralph-state` from `D:\harness-efforts\codexu` exits 0 against the current `.ralph/` and produces non-empty `plans/overview-ralph-state.{js,json}` whose `byTaskId` is a valid (possibly empty) object.
- [ ] Running with a clean checkout where `.ralph/` is absent (Verification G in plan): exit 0; sidecar contains `byTaskId: {}` and `unmatched: []`.

**Dependencies:** US-004, US-005
**Estimated complexity:** small

---

### US-007: Bootstrap sidecar + cascade refresh
**Description:** As a downstream-plan author, I want Plan 01's contracts surfaced in the INDEX and sibling plans so the cascade from Plan 02–12 stays coherent.

**Acceptance Criteria:**
- [ ] **First post-implementation commit** runs `pnpm sync-ralph-state` and includes the generated `plans/overview-ralph-state.{js,json}` files (per plan's Hand-off section; Implementation-Strategy step 7 is dropped per F-018 resolution — the first real sync is the single source of truth for the initial sidecar content).
- [ ] `plans/ralph-pipeline-INDEX.md` "Source-of-truth modules" table is updated to reflect:
  - stateless `derive-ralph-stage.mjs(bundle)` signature with `jobDirMarker`
  - `sync-core.mjs` cross-kind precedence + nested-member suppression
  - `resolve-config.mjs` canonical precedence rule (merge order vs committed-path lookup)
  - `</script>` escape contract
  - `scripts.d.ts` ambient-decl approach (explicit relative-path specifiers; no wildcards)
  - trimmed Plan-01 config schema with deferred fields documented as "Downstream additive extensions"
- [ ] Sibling plans `02`, `03`, `05`, `10`, `12` referenced in the plan's Hand-off section have their Plan-01 dependencies updated to match the actual contracts above. Any stale type signatures, function names, or behavior contracts are corrected.
- [ ] The implementation commit message lists every cross-plan diff (file, line range, what changed) so reviewers can verify the cascade in one read.
- [ ] All Verification steps A–L from plan.md pass (typecheck, predicate tests, one-shot sync, idempotency both JSON and JS, slug-heuristic override via temp-fixture per F-014 — NOT by editing the real `overview-data.js`, JS/JSON consistency including the `</script` grep, no-`.ralph` graceful handling, worktree exclusion, replan-pending derivation, cross-kind precedence end-to-end, Windows rename retry manual smoke, `.gitignore` entry).

**Dependencies:** US-001, US-002, US-003, US-004, US-005, US-006
**Estimated complexity:** medium

## 4. Functional Requirements

- **FR-1:** The system must expose Ralph pipeline state to the overview viewer via a generated sidecar (`plans/overview-ralph-state.{js,json}`) and never mutate the hand-curated `plans/overview-data.js`.
- **FR-2:** The system must expose a typed contract in `tools/overview-viewer/src/types.ts` covering 10 `RalphStage` values, `RalphPipelineState`, `OverviewRalphState`, and a `getOverviewRalphState()` helper that returns a safe default when `window.OVERVIEW_RALPH_STATE` is absent.
- **FR-3:** The system must declare `Window.OVERVIEW_RALPH_STATE` ambient typing in `tools/overview-viewer/src/overviewData.ts` so consumers typecheck without `as` casts.
- **FR-4:** The system must provide a single config resolver (`loadConfig`) enforcing the canonical precedence: **merge** `defaults < committed < .local.json overlay`; **committed-path lookup** `configPath` arg > `OVERVIEW_CONFIG_PATH` env var > default `<repoRoot>/.ralph/overview-config.json`.
- **FR-5:** The resolved config must be deep-frozen recursively (resolves F-012).
- **FR-6:** The committed `.ralph/overview-config.json` and `.ralph/overview-config.schema.json` must both be pure JSON (no comments, no trailing commas).
- **FR-7:** `.gitignore` must list `.ralph/overview-config.local.json`.
- **FR-8:** The system must provide a stateless predicate `deriveRalphStage(bundle) -> RalphStage` with NO filesystem access and NO list inputs, implementing the 10-row predicate table in the specified order.
- **FR-9:** Unknown/future phase values must map to `implementing` (predicate #6 catch-all), never `unmatched`.
- **FR-10:** `reviewOpenCount.<phase>` must be `undefined` when the corresponding findings file is absent, NOT `0`.
- **FR-11:** The walk must read direct children of `.ralph/jobs/`, `.ralph/job-groups/`, `.ralph/brainstorms/` only — no recursion into `<slug>/` or `<group>/<member>/`.
- **FR-12:** Cross-kind collisions must resolve via precedence `job > group > brainstorm`; shadowed artifacts must appear in `unmatched[]` with `reason: 'shadowed-by-<kind>'`.
- **FR-13:** Within-kind duplicates must resolve to the artifact with the max `jobState.updatedAt` (falling back to directory mtime); losers go to `unmatched[]` with `reason: 'duplicate-resolution'`.
- **FR-14:** Malformed `job-state.json` must log to stderr and append to `unmatched[]` with `reason: 'parse-error'`; siblings for the same slug must NOT be used to derive a stage.
- **FR-15:** Sidecar writes must be atomic via tmp+fsync+rename on the same volume, with up to 3× retry (100ms delay) on `EBUSY` / `EACCES` / `EPERM`.
- **FR-16:** The JS sidecar must escape `</script` defensively via `replace(/<\/(script)/gi, '<\\/$1')`.
- **FR-17:** The JS sidecar must take the exact form `window.OVERVIEW_RALPH_STATE = <escaped JSON>;` and be byte-equivalent to the JSON twin after stripping the wrapper.
- **FR-18:** Output must be deterministically sorted: `byTaskId` keys alphabetical; `unmatched[]` sorted by `kind` then `slug`.
- **FR-19:** Two consecutive sync runs must produce byte-identical sidecars after stripping the top-level `generatedAt` (no per-entry `generatedAt` is permitted in Plan 01).
- **FR-20:** The CLI must accept `--repo <path>` and `--config <path>` flags, exit 0 on success, exit 1 on hard error, and never crash on `git rev-parse --short HEAD` failure (falls back to `'unknown'` with a single stderr warning).
- **FR-21:** Root `package.json` must expose `"sync-ralph-state": "node scripts/sync-ralph-state.mjs"`.
- **FR-22:** `tools/overview-viewer/src/__tests__/scripts.d.ts` must use explicit relative-path module specifiers — wildcard ambient declarations MUST NOT be used (they fail to resolve under `moduleResolution: "bundler"`).
- **FR-23:** Slug-heuristic verification (Verification E) must use a temp-fixture procedure (NOT edit the hand-curated `overview-data.js`) — resolves F-014.
- **FR-24:** `loadConfig` must warn (not throw) to stderr when `ralphSubdirs.*` points at a missing directory.

## 5. Non-Goals (Out of Scope)

The following are explicitly deferred to later plans and MUST NOT be implemented here:

- Continuous watcher / debounce / incremental processing → **Plan 02**
- React UI rendering / chip components / filter axis / Vite plugin integration → **Plans 03 + 04**
- Aggregated snapshot / activity tail / JSON Schema for overview state / `tasks/INDEX.md` generation → **Plan 05**
- Skills like `/work-on`, `/triage`, and `deriveNextCommand` → **Plan 06**
- Context surfaces: notepad, journal, PR backlinks, `RecentActivity` → **Plan 07**
- Crews session tracking (`CrewSessionRef`, `--via-crew` mode) → **Plan 08**
- MCP server → **Plan 09**
- Ralph plugin patches (`overviewTaskId` schema fields on jobs/groups/members; cross-member roll-ups) → **Plan 10**
- Generic plugin extraction for other repos → **Plan 12**

Additionally:

- **Do NOT** add `ralph?: RalphPipelineState` to `OverviewTask` — the entire architecture depends on the sidecar living in `OverviewRalphState.byTaskId[task.id]`.
- **Do NOT** add per-entry `generatedAt` on `RalphPipelineState` — top-level `generatedAt` is the single timestamp source.
- **Do NOT** roll group-member states into the group bundle — Plan 10's job.
- **Do NOT** hardcode the Ralph plugin version when referencing schemas in `~/.claude/plugins/cache/ai-developer-toolkit/ralph-orchestration/<version>/schemas/` — resolve `<version>` at implementation time by `ls`-ing and picking the highest semver.

## 6. Design Considerations

- **Architecture (strict layering, no upward imports):**
  ```
  sync-ralph-state.mjs   (CLI entry — flags, repo-root resolution, exit codes, git rev-parse)
          │
          ▼
  sync-core.mjs          (walk + match + write — has filesystem; no git)
     │           │
     ▼           ▼
  derive-ralph-stage.mjs  resolve-config.mjs
     (pure predicate)         │
                              ▼
                       default-config.mjs
  ```
- **Reuse existing patterns:** the trusted-eval pattern from `tools/overview-viewer/src/__tests__/testData.ts` (`new Function('window', script)(windowValue)`) is reused by `sync-core.mjs` when reading `ralphOverrides` from `plans/overview-data.js`.
- **Vitest configuration:** the test file lands in the **node SSR project** defined in `tools/overview-viewer/vitest.config.ts` (path `src/__tests__/**/*.test.{ts,tsx}`), NOT the jsdom project (which is scoped to `src/__tests__/interactions`).
- **TypeScript module resolution:** `tools/overview-viewer/tsconfig.json` has `allowJs: false` + `moduleResolution: "bundler"`. Static imports of `.mjs` files from `.ts` need ambient declarations with **explicit relative-path module specifiers**. Wildcard patterns (`'*/derive-ralph-stage.mjs'`) DO NOT WORK under bundler resolution for relative imports.
- **Atomic write hardening (Windows):** `.tmp` next to destination → `fs.fsync` → `fs.renameSync` → retry 3× with 100ms delay on `EBUSY`/`EACCES`/`EPERM`. This survives Vite dev-server briefly holding the file open mid-rename.

## 7. Technical Considerations

- **Ralph plugin schemas** live at `~/.claude/plugins/cache/ai-developer-toolkit/ralph-orchestration/<current-version>/schemas/{job-state,prd,group,review-findings}-schema.json`. The current cache has both `5.30.0` and `5.32.0`. Implementers must `ls` the cache dir and pick the highest semver — do not hardcode.
- **`plans/overview-data.js` is JavaScript, not JSON.** It must be read via the trusted-eval pattern, not `JSON.parse`.
- **Single-volume invariant:** all current sync paths are under `D:\harness-efforts\codexu\plans\` (single volume). The `.tmp`-next-to-destination rule preserves single-volume rename for Plan 12 (when consumer repos may be on different drives).
- **Existing tests under `tools/overview-viewer/src/__tests__/` must NOT be modified** — additions are signature-preserving and snapshot-stable.
- **No existing `scripts/lib/` directory** — must be created. Today `scripts/` contains only `release.cjs` and `postinstall.cjs`.
- **`.ralph/` live state at PRD generation time:** 19 `jobs/` subdirs, 19 `job-groups/` subdirs (some with nested `<group>/<member>/job-state.json`), 1 brainstorm (`codex-fork-extension-strategy/`). `.worktrees/` has 6 subdirs that MUST be excluded.
- **`overview-data.js` invariant** (load-bearing, from `tools/overview-viewer/CLAUDE.md`): the data file is hand-curated. The sync script reads it but never writes it. The `ralphOverrides` smoke (Verification E) uses a temp-fixture procedure per F-014.

## 8. Success Metrics

- `pnpm sync-ralph-state` exits 0 from a clean checkout in under ~5 seconds against the current `.ralph/`.
- Sidecar files (`plans/overview-ralph-state.{js,json}`) exist after sync and parse back to identical in-memory state.
- Two consecutive sync runs produce byte-identical sidecars after stripping `generatedAt` (idempotency verified at both JSON and JS layers).
- `pnpm --filter @codexu/overview-viewer typecheck` exits 0 with all new types and ambient declarations in place.
- `pnpm --filter @codexu/overview-viewer test src/__tests__/ralphStage.test.ts` runs ≥15 cases (10 stages + edge cases) with 100% pass rate.
- No regressions in existing `tools/overview-viewer/` test surfaces (zero modified existing test files).
- Downstream plan authors (02, 03, 05, 10, 12) can import the contracts directly without re-reading this PRD — the type model and `scripts/lib/*.mjs` exports are the single source of truth.

## 9. Open Questions

These are inherited from `plan.md` "Open Questions" section. The PRD takes a position on each where one was reached during plan review; the remainder are flagged for runtime decision:

1. **`.ralph/overview-config.README.md`** — deferred. Create only when a downstream plan first needs to document a non-trivial config field. Not blocking Plan 01.
2. **`ralphSubdirs` near-term consumer** — none in codexu; the field is dead config for the codexu deployment but enables Plan 12 generality. Acceptable cost.
3. **`terminalReason='replan'` interaction with `BLOCKED`/`complete`** — current order is `complete > blocked > replan` (predicates 1 > 2 > 3). A job with `terminal=true && status='BLOCKED' && terminalReason='replan'` returns `blocked` because predicate #2 fires before #3. PRD position: **blocked wins** (BLOCKED is the more actionable surface). Confirm during implementation if a real-world case surfaces.
4. **F-009 deferred-fields list** — resolved by trimming Plan-01 schema to Plan-01-only fields (`dataFile`, `ralphRoot`, `ralphSubdirs`, `outputs.{sidecarJs,sidecarJson}`, `lockFile`, `watcher.ignored`). Downstream plans (02, 03, 04, 05, 07, 08, 11) extend in lockstep with their consumer code.
5. **F-015 "expected matching task IDs" in Verification C** — the verification is intentionally informational against live `.ralph/` content. The deterministic assertion is the idempotency check (Verification D) and the byTaskId-is-an-object shape check; "expected count" is a manual sanity step, not an automated AC.

## 10. References

**Plan source (do not modify):**
- `D:/harness-efforts/codexu/.ralph/jobs/ralph-pipeline-01-foundation/plan.md`
- `D:/harness-efforts/codexu/.ralph/jobs/ralph-pipeline-01-foundation/stories-outline.md`

**Files to create:**
- `D:/harness-efforts/codexu/scripts/lib/default-config.mjs`
- `D:/harness-efforts/codexu/scripts/lib/resolve-config.mjs`
- `D:/harness-efforts/codexu/scripts/lib/derive-ralph-stage.mjs`
- `D:/harness-efforts/codexu/scripts/lib/sync-core.mjs`
- `D:/harness-efforts/codexu/scripts/sync-ralph-state.mjs`
- `D:/harness-efforts/codexu/.ralph/overview-config.json`
- `D:/harness-efforts/codexu/.ralph/overview-config.schema.json`
- `D:/harness-efforts/codexu/plans/overview-ralph-state.js` (generated by first sync)
- `D:/harness-efforts/codexu/plans/overview-ralph-state.json` (generated by first sync)
- `D:/harness-efforts/codexu/tools/overview-viewer/src/__tests__/scripts.d.ts`
- `D:/harness-efforts/codexu/tools/overview-viewer/src/__tests__/ralphStage.test.ts`

**Files to modify:**
- `D:/harness-efforts/codexu/tools/overview-viewer/src/types.ts` — add Ralph types + extend `OverviewData` with `ralphOverrides?`
- `D:/harness-efforts/codexu/tools/overview-viewer/src/overviewData.ts` — add `Window.OVERVIEW_RALPH_STATE` ambient declaration
- `D:/harness-efforts/codexu/package.json` — add `sync-ralph-state` npm script
- `D:/harness-efforts/codexu/.gitignore` — add `.ralph/overview-config.local.json`
- `D:/harness-efforts/codexu/plans/ralph-pipeline-INDEX.md` — refresh "Source-of-truth modules" table (US-007)
- Sibling plans `02`, `03`, `05`, `10`, `12` under `D:/harness-efforts/codexu/plans/` — refresh Plan-01 dependency references (US-007)

**Files for reference (do not modify):**
- `D:/harness-efforts/codexu/tools/overview-viewer/CLAUDE.md` — load-bearing "data file is hand-curated" invariant
- `D:/harness-efforts/codexu/tools/overview-viewer/src/__tests__/testData.ts` — trusted-eval pattern for reading `overview-data.js`
- `D:/harness-efforts/codexu/tools/overview-viewer/vitest.config.ts` — node vs jsdom project routing
- `D:/harness-efforts/codexu/tools/overview-viewer/tsconfig.json` — `allowJs: false` + `moduleResolution: "bundler"` constraints
- `D:/harness-efforts/codexu/plans/overview-data.js` — hand-curated data file (read for `ralphOverrides`, never written)
- `~/.claude/plugins/cache/ai-developer-toolkit/ralph-orchestration/<current-version>/schemas/` — authoritative Ralph schemas (resolve `<current-version>` at impl time)
- `~/.claude/plugins/cache/ai-developer-toolkit/ralph-orchestration/<current-version>/lib/sync_job_statuses.sh` — bash reference pattern for stale-RUNNING detection (~60min mtime), atomic state updates
- `C:/Users/evmitran/.claude/plans/glistening-wondering-llama.md` — full design rationale; tie-breaker for ambiguity
