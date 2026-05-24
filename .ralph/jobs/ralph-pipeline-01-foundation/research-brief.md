# Research Brief — `/plan-with-ralph --improve plans/ralph-pipeline-01-foundation.md`

Repo: `D:/harness-efforts/codexu`  •  Mode: interactive, depth thorough  •  Session: 20260518-153237

## Researcher Findings (file-reference validator)

### Stale references (must fix)

1. **Plugin version pin (`5.30.0`).** Plan lines 141–144, 147 hardcode schema paths under `ralph-orchestration\5.30.0\`. Installed versions: `5.30.0` AND `5.32.0`. The 5.30.0 cache still exists, so paths resolve today, but the pin is fragile — a plugin cleanup deletes the references silently. Recommend: switch to current version OR add a "check `~/.claude/plugins/cache/ai-developer-toolkit/ralph-orchestration/` for current dir" parenthetical.

### All other references verified

- `tools/overview-viewer/src/types.ts` exists; `OverviewData`/`OverviewTask` present; Ralph types NOT yet exported (correct — plan adds them).
- `tools/overview-viewer/src/__tests__/` exists; **Vitest** (`vitest@^4.1.5`); 16 test files present.
- `tools/overview-viewer/CLAUDE.md` carries the "data file is hand-curated" invariant.
- `plans/overview-data.js` exists; top-level shape `window.OVERVIEW_DATA = { generatedAt, generatedFromCommit, tasks[], phaseTree[], ... }`. **No `ralphOverrides` field today** — plan's claim of new addition is correct.
- Root `package.json`: pnpm `10.11.0`; workspaces include `tools/overview-viewer`; scripts `overview`, `overview:build`, `overview:build:preview` present; **no `sync-ralph-state` script today**.
- `scripts/` contains only `release.cjs`, `postinstall.cjs` — no existing `.mjs` modules.
- `.ralph/jobs/` 19 subdirs; `.ralph/job-groups/` 19 subdirs (includes `overview-data-split`); `.ralph/brainstorms/` 1 subdir (`codex-fork-extension-strategy/` with `recommendedDirection: "D-001"`).
- `.worktrees/` 6 subdirs — exclusion in `config.watcher.ignored` is appropriate.
- Package name `@codexu/overview-viewer` matches `tools/overview-viewer/package.json` ✓.
- Real `job-state.json` sample carries `status`, `orchestrator.{phase, review, terminal, terminalReason}` — matches predicate inputs.
- Real `brainstorm.json` carries `recommendedDirection` — matches predicate.
- All 12 sibling pipeline plans (02–12) present in `plans/`; `plans/ralph-pipeline-INDEX.md` present.

## Architect Analysis

### Top 3 risks

**RISK 1 — Predicate-table gap: `terminalReason === 'replan'` is unhandled.** Predicates #1 and #2 only cover `'complete'` and `'blocked'`. A terminal job with `terminalReason === 'replan'` falls through and may land on a brainstorm/unmatched bucket instead of a meaningful stage. Either add a 10th stage value (e.g., `'replan-pending'`) or fold replan into `'blocked'` with a sub-flag.

**RISK 2 — Atomic write durability on Windows.** `fs.renameSync` across volumes fails on Windows; today everything is under `D:\harness-efforts\codexu\plans\` so single-volume, but Plan 12 (plugin extraction) makes cross-volume real. Also: a Vite dev-server mid-eval of `overview-ralph-state.js` during rename can throw a read error. Recommend short retry (≤3, 100ms) and explicit same-volume assertion.

**RISK 3 — Slug collision across kinds.** Plan handles duplicates *within* one kind (mtime tiebreak), but a `jobs/foo/`, `job-groups/foo/`, and `brainstorms/foo/` simultaneously matching one `OverviewTask.id` is unspecified. Document the cross-kind precedence (job > group > brainstorm by mtime, others → `unmatched` with `reason: 'duplicate-resolution'`).

### Predicate-ordering ambiguities

- **#5 vs #7**: `jobState` exists + `prd` absent + orchestrator absent → fires #5 (`implementing`) before #7 (`planning`) can run. The plan's `#7` is therefore unreachable as written. Either reorder so `prd-absent` short-circuits to `planning` or remove #7 as redundant.
- **#8 wording**: "no matching jobDir exists for the same overviewTaskId" implies matching/resolution happens **before** stage derivation. Today the signature is `deriveRalphStage(jobState?, prd?, groupState?, brainstormJson?)`. Either pass an aggregated artifact bundle keyed by `overviewTaskId`, or make sync-core decide brainstorm-vs-job precedence outside the predicate. Recommend the latter: keep `derive-ralph-stage.mjs` truly stateless and let sync-core pick the dominant artifact.

### Configuration extraction

`ralphRoot: ".ralph"` is configurable but the *subdir* names (`jobs`, `job-groups`, `brainstorms`) are hardcoded inside `sync-core.mjs`. For Plan 12 generality, add optional `ralphSubdirs: { jobs, jobGroups, brainstorms }` overrides (defaulting to Ralph's stable layout). Cheap to add now, expensive to thread through later.

### Test-coverage gaps

Plan promises 9 cases (one per stage). Missing:
- Config layering precedence (env > local > committed > default).
- Cross-kind slug collision behavior.
- Duplicate-resolution by `updatedAt`.
- Graceful skip on malformed `job-state.json` (parse error mid-walk should not crash).
- Round-trip JS+JSON consistency (already covered in Verification step F, but no unit test).

## Codex Research

### Important additions

- **Window declaration** belongs in `tools/overview-viewer/src/overviewData.ts`, alongside the existing `OVERVIEW_DATA` declaration — not only in `types.ts`. Plan currently only mentions `types.ts`.
- **Parsing `plans/overview-data.js`**: reuse the trusted-eval pattern already in `tools/overview-viewer/src/__tests__/testData.ts`: `new Function('window', script)(windowValue)`. Avoid brittle regex/string parsing.
- **TS `→` `.mjs` import for the test.** `tsconfig.json` has `allowJs: false` + `moduleResolution: "bundler"`. Statically importing `../../../../scripts/lib/derive-ralph-stage.mjs` from a `.ts` test needs an ambient declaration file (e.g., `tools/overview-viewer/src/__tests__/scripts.d.ts`) or dynamic import with explicit local types. Plan does not address this.
- **Vitest project split**: node SSR project picks up `src/__tests__/**/*.test.{ts,tsx}`; jsdom only for `src/__tests__/interactions`. `ralphStage.test.ts` lands in the node SSR project automatically.
- **JSONC vs JSON**: example schema (lines 53–92) contains `// comment` annotations. If the *committed* config uses comments, `JSON.parse` will fail. The plan should be explicit: schema doc is JSONC for human readability, committed `.ralph/overview-config.json` must be pure JSON.
- **`.gitignore` update missing.** The plan promises a per-machine `.local.json` override but doesn't add `.ralph/overview-config.local.json` to `.gitignore`. Internally inconsistent.

## Copilot Research

### Important additions

- Confirms `.gitignore` gap (`.local.json` must be ignored) — internal inconsistency.
- **`</script>` escaping**: the JS sidecar will be inlined into HTML by Plan 03/04's build path. Defensive escape: `JSON.stringify(state).replace(/<\/(script)/gi, '<\\/$1')`. Plan currently doesn't mention this.
- **Nested job-state ambiguity**: `.ralph/job-groups/<group>/<member>/job-state.json` exists — these are member-job state files nested under groups. Plan must declare whether the walk treats those as (a) standalone jobs, (b) group members only, or (c) skipped during the jobs walk. Today's silence on this is a latent correctness gap.
- Recommends Ralph-state-in-sync deterministic sort (slugs alphabetical, unmatched alphabetical) for idempotent output — Verification step D depends on this.

## Consolidated File List

### Files to create (per plan)

- `scripts/lib/default-config.mjs`
- `scripts/lib/resolve-config.mjs`
- `scripts/lib/derive-ralph-stage.mjs`
- `scripts/lib/sync-core.mjs`
- `scripts/sync-ralph-state.mjs`
- `.ralph/overview-config.schema.json`
- `.ralph/overview-config.json`
- `plans/overview-ralph-state.js` (bootstrap)
- `plans/overview-ralph-state.json` (bootstrap)
- `tools/overview-viewer/src/__tests__/ralphStage.test.ts`
- *(new from research)* `tools/overview-viewer/src/__tests__/scripts.d.ts` — ambient declaration for `.mjs` import in TS test

### Files to modify

- `tools/overview-viewer/src/types.ts` — add Ralph types + `ralphOverrides`
- `tools/overview-viewer/src/overviewData.ts` — declare `Window.OVERVIEW_RALPH_STATE`
- `package.json` (root) — add `sync-ralph-state` npm script
- `.gitignore` — add `.ralph/overview-config.local.json`
- *(downstream cascade)* `plans/ralph-pipeline-INDEX.md` and any sibling plans whose Plan-01 references drift

### Files for reference (do not modify)

- `tools/overview-viewer/src/__tests__/testData.ts` — trusted-eval pattern for `overview-data.js`
- `tools/overview-viewer/vite.config.ts` — sidecar serve+inline model (Plan 03/04 will mirror)
- `tools/overview-viewer/vitest.config.ts` — Vitest project structure
- `tools/overview-viewer/CLAUDE.md` — "data file is hand-curated" invariant
- `tools/overview-viewer/tsconfig.json` — `allowJs: false`, `moduleResolution: bundler`
- Ralph plugin schemas under `~/.claude/plugins/cache/ai-developer-toolkit/ralph-orchestration/<version>/schemas/`
- `~/.claude/plugins/cache/.../lib/sync_job_statuses.sh` — reference pattern (atomic update, stale-RUNNING)

## Summary of issues for plan improvements

1. **Plugin version pin** — switch to `5.32.0` or de-version with a "check installed" note.
2. **Predicate-table gaps**: handle `terminalReason='replan'`; fix unreachable predicate #7 ordering.
3. **`derive-ralph-stage.mjs` signature**: keep it stateless; let sync-core pick the dominant artifact per `overviewTaskId` (predicate #8 currently leaks resolution into the predicate).
4. **Atomic-write hardening**: same-volume assertion + retry on Windows.
5. **Slug-collision cross-kind**: explicit precedence rule (`job > group > brainstorm`) with the rest landing in `unmatched[]`.
6. **Configurable Ralph subdirs**: optional `ralphSubdirs` block to remove the last hardcoded path inside `sync-core.mjs`.
7. **`.gitignore` entry** for `.ralph/overview-config.local.json` — currently missing, plan is internally inconsistent.
8. **`</script>` escaping** in the JS sidecar emitter for safe Plan-03/04 inlining later.
9. **Window declaration** in `tools/overview-viewer/src/overviewData.ts` — missing in plan.
10. **TS-from-`.mjs` import**: add `scripts.d.ts` ambient declaration file (or use dynamic import) — plan currently hand-waves with "or via a workspace alias if one exists."
11. **JSONC vs JSON** for the committed config — be explicit that committed `.ralph/overview-config.json` must be pure JSON (no comments).
12. **Nested `job-groups/<group>/<member>/job-state.json`** — declare walk behavior explicitly (proposed: treat as group-member artifact, NOT as a top-level job, so no double-counting).
13. **Test-coverage additions**: config layering precedence; cross-kind slug collision; duplicate-by-mtime; malformed-JSON skip; deterministic sort for idempotency.
14. **Cascade refresh**: ensure the existing "Refresh downstream plans + INDEX" acceptance criterion explicitly enumerates the new contracts (config resolver shape, ambient decl, escape rule) so Plans 02/03/05/12 stay in sync.
