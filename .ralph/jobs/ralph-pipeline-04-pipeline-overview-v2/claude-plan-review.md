# Claude Plan Review — Plan 04 v2

## Findings (re-classified by stated severity)

### F-001 — High — Non-existent `OverviewTask.priority` field in scoring rubric
- **Category:** Implementation gap
- **Description:** Scoring rubric (line 134) includes `OverviewTask.priority` normalized 0–1 as a 10-weight input. The field does not exist on `OverviewTask` (types.ts:24-34). `scoreRecommendations.mjs` will fall back to 0.5 for all tasks unless either the field is added or priority is removed.
- **Location:** draft-plan.md lines 134, 177; Open Questions does not flag this gap.
- **Recommendation:** Either (a) add `priority?: number` to `OverviewTask` in `types.ts` (US-001) and define default 0.5 fallback explicitly, OR (b) drop priority from the rubric and redistribute weight (40+30+20+10 → e.g. 50+30+20). Recommend (a) for future extensibility. Add an AC verifying the fallback path.

### F-002 — Medium — v1 design-element scoping
- **Description:** Common-mistakes #1 says "don't cherry-pick" but doesn't explicitly enumerate which design elements (weight ratios, edge categorization, Recommendation shape with reasons) are safe to reference for inspiration.
- **Location:** draft-plan.md common-mistakes #1
- **Recommendation:** Add a one-line subsection: "v1 design ideas you CAN reference (scoring weight ratios, edge type categorization, Recommendation shape with reasons[]) vs CANNOT (imports, type refs, config schema keys)."

### F-003 — Medium — PRD schema runtime verification
- **Description:** Open Questions defers `userStories[].dependencies[]` schema verification to the implementer with medium confidence. If divergent, parse produces garbage silently.
- **Location:** draft-plan.md Open Questions (PRD schema)
- **Recommendation:** Add an AC: `load-prds-by-task-id.test.mjs` includes a fixture with a known-valid PRD schema (capture from `plugins/cache/ai-developer-toolkit/ralph-orchestration/5.41.0/schemas/prd-schema.json`) and asserts the helper produces the expected `prdsByTaskId` shape including `userStories[].dependencies`.

### F-004 — Medium — Emission-order integration test AC under-specified
- **Description:** AC says "integration test asserts snapshot freshness" without naming the exact test file or assertion. The Verification section has a `diff <(jq …)` snippet but it's not in the AC list.
- **Location:** draft-plan.md AC list ("Snapshot freshness")
- **Recommendation:** Make the AC explicit: "Integration test at `scripts/lib/write-sidecar-freshness.test.mjs` (or equivalent) runs `writeSidecar()` once in a tempdir and asserts `JSON.parse(fs.readFileSync(snapshotPath)).recommendations === JSON.parse(fs.readFileSync(recommendationsPath)).recommendations` (deep-equal) and the same for `dependencyGraph`."

### F-005 — Medium — Static-build size budget AC vague
- **Description:** AC "≤ 5% growth vs baseline measured immediately before US-005 lands" doesn't pin the baseline value, leaving it implementer-defined.
- **Location:** draft-plan.md acceptance criteria (overview.html size)
- **Recommendation:** Hard-code: "Current `wc -c plans/overview.html` baseline: 501,307 bytes. After US-005 lands, new size must be ≤ 526,372 bytes (baseline × 1.05). Record final byte count in the US-005 commit message."

### F-006 — Low — Empty-state AC missing exact selector
- **Description:** Empty-state AC doesn't pin the testable selector/text.
- **Location:** draft-plan.md acceptance criteria (empty state)
- **Recommendation:** Add to AC: "SSR test asserts the rendered output contains the substring `No Ralph state tracked yet` and the element has class `pipeline-overview-empty`."

### F-007 — Low — Mutation contract JSDoc not in AC
- **Description:** `state.runDurations` mutation is called out in Common Mistakes #4 and Risk #5 but no AC mandates the JSDoc on the function.
- **Location:** draft-plan.md acceptance criteria
- **Recommendation:** Add AC: "`emitDerivedArtifacts` includes a JSDoc block documenting that `state.runDurations` is mutated in place before `emitAgentArtifacts` reads it."

### F-008 — Low — `resolve-config.mjs` "pass-through" unclear
- **Description:** Plan says "pass-through" for `resolve-config.mjs` without specifying behavior.
- **Location:** draft-plan.md "Files to Modify"
- **Recommendation:** Clarify: "`resolve-config.mjs` — verify that `recommendations` and `outputs.recommendationsJson` / `outputs.dependencyGraphJson` keys round-trip through `loadConfig`/`resolveConfig` without being stripped by any whitelist."

## Verified correct

- emitAgentArtifacts reads JSON from disk (sync-core.mjs:381-382). ✓
- `Snapshot.runDurations` schema (emit-snapshot-schema.mjs:27, types.ts:180, emit-snapshot.mjs:6). ✓
- `OverviewData.spawnedFrom` top-level map (types.ts:153). ✓
- `atomicWriteFile` exported (sync-core.mjs:419). ✓
- Mutation contract feasible (line 383 reads `state.runDurations ?? {}`). ✓
- `useMultiAxisFilter()` returns `{ filters, setFilters, … }`; placement Toolbar→Kanban is correct. ✓
- Test path conventions align with `vitest.config.ts` projects. ✓
- Cluster decomposition: US-005 depends only on US-001. ✓
- No downstream stale refs found. ✓

## Summary

- Critical: 0
- High: 1 (priority field gap)
- Medium: 4 (v1 reference scope, PRD schema runtime check, integration test AC, size budget AC)
- Low: 3 (empty-state selector, JSDoc AC, resolve-config clarity)

**Verdict:** Architecturally sound. The one High blocker is the `priority` field gap — must resolve before implementation. Medium items are AC tightening; recoverable by implementer but worth fixing during review. Recommend merge with H fix + the 4 Medium ACs sharpened.
