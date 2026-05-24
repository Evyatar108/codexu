# Code Review Context — ralph-pipeline-01-foundation

Patterns and conventions discovered while reviewing the Plan-01 implementation against `plan.md`. Use this as input for any follow-up review-fix iterations.

## Codebase conventions worth preserving

- **Strict layering between predicate and walker.** `scripts/lib/derive-ralph-stage.mjs` stays pure (no `node:fs`, no `node:child_process`, no list inputs) — `sync-core.mjs` owns all filesystem walking, cross-kind collapse, and `reviewOpenCount` computation. The 10-case predicate sees one already-collapsed bundle. Any future review-fix that needs to touch derivation logic should respect this boundary — moving cross-artifact precedence into the predicate would re-couple the two modules and break unit-test isolation.

- **CLI owns git, sync-core does not.** `scripts/sync-ralph-state.mjs` runs `git rev-parse --show-toplevel` and `git rev-parse --short HEAD`, then stamps `generatedFromCommit` onto the state via `walkRalphState({ ..., generatedFromCommit })`. `sync-core.mjs` has no `child_process` or `git` shell-out. This keeps the core fixture-testable from in-memory configs. Do not introduce git shell-outs into sync-core.

- **`new Function('window', script)(windowValue)` trusted-eval for `plans/overview-data.js`.** sync-core line 296-303 mirrors the existing test-helper pattern in `tools/overview-viewer/src/__tests__/testData.ts`. This is the load-bearing reason `OverviewTask` does not carry `ralph` — the data file is hand-curated, the sidecar is generated. Future stories that need to read the data file should reuse this helper, not introduce a JSON-parse fallback.

- **`reviewOpenCount.<phase> === undefined` (NOT 0)** when the findings file is absent. This is what makes the `reviewing` vs `review-fix` predicate split work. Future fixers must keep `readReviewOpenCount` returning `{}` (with absent keys) instead of `{ code: 0, docs: 0 }`.

- **`</script>` escape lives in `writeSidecar`** (`sync-core.mjs:117`), applied to the inner `JSON.stringify(state)` before both JS and JSON files share the same payload. The JS wrapper is only `window.OVERVIEW_RALPH_STATE = ${json};`. Stripping the wrapper must be byte-identical to the JSON file — preserved by tests at `syncCore.test.ts:188-193`.

- **Atomic write with same-volume tmp + 3× retry on EBUSY/EACCES/EPERM.** `sync-core.mjs:122-160`. The test at `syncCore.test.ts:201-242` covers both success-after-2-failures and rejection-after-3-failures by mocking `fs.renameSync`. Future writes (Plan 02 watcher) must reuse `atomicWriteFile`/`renameWithRetry` — do not re-implement.

## Test conventions

- **Vitest 4 projects:** node SSR tests under `tools/overview-viewer/src/__tests__/*.test.ts`. New tests for scripts/lib/*.mjs land alongside the rest (`ralphStage.test.ts`, `syncCore.test.ts`, `config.test.ts`). 34 tests for Plan 01 — passing.

- **Ambient declarations for root-script imports.** Tests under `tools/overview-viewer/src/__tests__/` import root `scripts/lib/*.mjs` via explicit relative paths (`'../../../../scripts/lib/<file>.mjs'`). Two layers cooperate:
  - **`scripts/lib/*.d.mts`** sibling files declare the runtime exports for `tsc --noEmit` under the package's `moduleResolution: "bundler"` (test-local ambient decls alone are not enough — see overview-viewer `CLAUDE.md`).
  - **`tools/overview-viewer/src/__tests__/scripts.d.ts`** redeclares the same shapes for the test workspace.
  Wildcard module specifiers (`'*/derive-ralph-stage.mjs'`) do NOT resolve under bundler — keep the explicit relative path.

- **Temp-fixture pattern for sync-core / config tests.** `mkdtempSync(path.join(tmpdir(), 'codexu-...-'))` + register in `fixtureRoots[]` array + `afterEach` cleans them. `config.test.ts` and `syncCore.test.ts` both use this shape. Avoid editing the real `plans/overview-data.js` from any test (F-014 invariant).

## Risk surfaces / cross-cutting concerns

- **`resolveConfigPaths` re-builds the object instead of spreading.** Currently drops unknown keys — see finding F-001. Any future downstream plan (02-12) that adds a key to `.ralph/overview-config.json` needs this fixed first, or the resolver must be widened in lockstep. The plan-blessed contract is "loadConfig returns the merged object verbatim."

- **`group.json` is read existence-only.** Today `sync-core.mjs:192` only checks `fs.existsSync` — it never parses `group.json` content, so `isParallel` is hardcoded `true` for any group (finding F-004). Downstream Plan 10 (overviewTaskId on member artifacts) will need group.json content; the read should be added now via `readJsonFile`.

- **Plan-vs-implementation drift on `lockFile` path** (finding F-006). The plan says `plans/.overview-ralph-state.lock`, the code says `.ralph/overview-sync.lock`. Pick one before Plan 02 lands or the watcher will look in the wrong place.

- **`OVERVIEW_CONFIG_PATH` env var is read in resolve-config.mjs:28** — not in the CLI. This means tests can redirect the committed config without setting up `--config`. Good design; preserve. Documented in `config.test.ts:54`.

- **Window ambient declaration in `overviewData.ts` is load-bearing.** Without it, `getOverviewRalphState()` in `types.ts` would need an `as` cast on `window`. Keep these two files in lockstep; if a future plan moves the renderer global elsewhere, both must move together.

## Files relevant to the next review-fix iteration

- `scripts/lib/resolve-config.mjs` — F-001 (spread-then-override the merged config)
- `scripts/lib/sync-core.mjs` — F-002 (warn on non-jobState parse errors), F-003 (warn on unknown phase), F-004 (read group.json content for isParallel), F-005 (emit hasPrdWorthy)
- `scripts/lib/default-config.mjs`, `.ralph/overview-config.json`, `.ralph/overview-config.schema.json`, `plans/ralph-pipeline-01-foundation.md` — F-006 (align lockFile path)
- `tools/overview-viewer/src/__tests__/syncCore.test.ts` and `tools/overview-viewer/src/__tests__/config.test.ts` — add regression tests for each fix
