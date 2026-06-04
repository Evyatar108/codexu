### Synthesis — Plan Review (3-way: Claude + Codex + Copilot)

### Claude Plan Review
- [High] Feasibility — Claims `tests/review-mail-command.test.js` and `tests/command-args-parity.test.js` don't exist. **INVALID HALLUCINATION** — verified to exist via direct ls probe and referenced by researcher + codex with line numbers.
- [Medium] Feasibility — Version-from-package.json wording is stale (the plan reconciles via PLANNER NOTE but inline verbatim quote could mislead).

### Codex Plan Review
- [High] Feasibility — stderr warning design not testable; `process.stderr.isTTY` fails under spawnSync; should be `args.output === 'cli'` gate.
- [High] Ordering — `measurement-gate` (US-001) listed Depends on: None but plan says it gates US-002+; suggested-decomposition.json allows parallel run with foundation-libs.
- [High] Acceptance Criteria Quality — AC5 (≥30% reduction) inconsistent with planner's ~1% measurement + US-001's 5% gate; autonomous implementer can't tell when to fail.
- [High] Acceptance Criteria Quality — AC1 says `/crews:review-mail` emits stderr warning but plan also says slash invocations won't surface stderr.
- [Medium] Feasibility — D-002 telemetry under-specified; collapseReviewRows signature doesn't pass manifest/actor.name; need explicit data source for listenerExit/turnBoundaryCount.
- [Medium] Feasibility — collapsedIds ambiguous for proactive batches (leaf reportId/outboxId vs parent inbox id).
- [Medium] Completeness — command-args-parity.test.js stderr assertion intersects with new stderr behavior + deprecation wrapper stderr.
- [Medium] Completeness — Version-bump instructions slightly stale; bump-version.js already handles 6 files.
- [Medium] Simplicity — Proposed "pure helper" not pure if it parses env, reads plugin version, appends logs, and writes stderr; suggest keep helper pure and move side effects to review-mail.js call site.
- [Medium] Acceptance Criteria Quality — AC4 "bit-identical to pre-change" boundary undefined (stdout JSON only vs stderr/log/cursor side effects).

### Copilot Plan Review
- [High] Feasibility — D-002 telemetry fields not implementable as described; manifest has no listener exit reason field; `markListenerExited` writes only `lastListenerExitedAt` + `listenerState`.
- [High] Feasibility — stderr warning AC scoped to `/crews:review-mail` but plan says slash won't surface stderr; collapse helper signature doesn't pass `args.output`.
- [High] Ordering — US-001 ordered before lib/collapse-key.js exists; can't re-run "against actual implementation" when implementation isn't built.
- [High] Acceptance Criteria Quality — AC-5 ≥30% reduction conflicts with research showing ~1% on current corpus.

### Consensus (flagged by 2+ reviewers — by category match)

- **F-001 [High] Criteria Quality**: AC-5 ≥30% reduction inconsistent with measured 1% / US-001 5% gate. (Codex + Copilot)
- **F-002 [High] Criteria Quality**: AC-1 stderr on slash invocations contradicts "slash won't surface stderr" assertion. Need to split CLI vs slash AC behavior and pass `args.output` to collapseReviewRows. (Codex + Copilot)
- **F-003 [High] Feasibility**: D-002 telemetry (`listenerExit`, `turnBoundaryCount`) not implementable from the current manifest schema. Either pass through, derive from existing fields (`terminationReason`, `lastListenerExitedAt`), or default to `unknown`/`0`. (Codex + Copilot)
- **F-004 [High] Ordering**: US-001 measurement-gate ordering — Phase 1 runs before foundation-libs containing collapse-key.js. Either add dependency or re-label as heuristic pre-measurement. (Codex + Copilot)

### Divergences (single-reviewer)

- **F-005 [High] Feasibility (Codex)**: `process.stderr.isTTY` predicate doesn't fire under spawnSync; use `args.output === 'cli'` instead.
- **F-006 [Medium] Feasibility (Codex)**: `collapsedIds` ambiguous for proactive batches — decide between parent inbox `id` and leaf `reportId`/`outboxId`.
- **F-007 [Medium] Completeness (Codex)**: command-args-parity stderr assertion + deprecation wrapper stderr interaction.
- **F-008 [Medium] Completeness (Codex)**: Version-bump description should reframe marketplace edits as verification (already handled by bump-version.js).
- **F-009 [Medium] Simplicity (Codex)**: Pure helper not pure — separate env parsing + version reading + appendLog + stderr into review-mail.js call site; keep `collapseReviewRows` return-value-only.
- **F-010 [Medium] Criteria Quality (Codex)**: AC4 "bit-identical" needs boundary specification.
- **F-011 [High] Feasibility (Claude)**: Test file existence claim — INVALID (hallucination; files verified to exist).
- **F-012 [Medium] Feasibility (Claude)**: Version-from-package.json verbatim quote in AC could mislead despite PLANNER NOTE — minor polish.

### Recommended Amendments

1. **F-001/F-005 (AC5 + AC1 + stderr predicate)** — Rewrite AC1, AC4, AC5 to be unambiguous; split stderr behavior into CLI-only vs slash-no-op; replace `process.stderr.isTTY` with explicit `args.output === 'cli'` gate; reframe AC5 as "measurement reported + zero unsafe coalesces + operator decision recorded when reduction < threshold."
2. **F-003 (D-002 telemetry)** — Pass `actorManifest` and `actorName` into `collapseReviewRows`; derive `listenerExit` from `manifest.terminationReason || manifest.listenerState`; `turnBoundaryCount` = count of distinct `consumedAt` ISO timestamps in the collapse group (this IS implementable as already documented in US-009; the issue is just plumbing the manifest through the signature).
4. **F-004 (Ordering)** — Update suggested-decomposition.json so `measurement-gate` and `foundation-libs` can run in parallel for the HEURISTIC measurement (US-001's first run uses an inlined heuristic key), but core-collapse must invoke US-001's script again as a FINAL verification step after lib/collapse-key.js + lib/collapse-review-rows.js exist (we relabel this as "US-012b verification re-run" inside US-012). OR add explicit `dependsOn: ["foundation-libs"]` to measurement-gate if the operator prefers strictly-after-impl measurement.
5. **F-006 (collapsedIds ambiguity)** — Specify in US-005: when the input row carries `payload.entries[]`-expanded `reportId`/`outboxId` (leaf), `collapsedIds[]` uses leaf `reportId || outboxId || id` (fallback chain); for direct rows, `collapsedIds[]` uses `id`. Drill-down still works.
6. **F-007 (parity stderr collision)** — In US-005's parity-test update: use dispatcher form (`tools/crews.js review-mail`) not deprecated wrapper (`tools/review-mail.js`); the deprecation shim's stderr does not interfere with dispatcher invocations.
7. **F-008 (bump-version simplification)** — Reword US-010 to call `node scripts/bump-version.js 3.6.0` as the canonical command; the 3 marketplace indexes ARE already part of the script's enumeration list (confirmed at scripts/bump-version.js:15-16 + the marketplace list); manual instructions reframed as "verify the 6 stamping locations all show 3.6.0".
8. **F-009 (pure helper)** — Keep `collapseReviewRows(rows)` pure (returns `{ collapsedRows, collapseGroups: [{count, seqRange, bodyHashPrefix, kind, sender, members[]}] }`); move env parsing + version reading + appendLog + stderr writing to the review-mail.js handler call site. Update US-004 + US-005 + US-008 + US-009 ACs accordingly.
9. **F-010 (AC4 bit-identical boundary)** — Specify: "JSON stdout byte-for-byte identical, including key order and absence of `collapsedCount/collapsedSeqs/collapsedIds`; stderr is silent (no warnings); crews.log line is NOT written; cursor advancement is identical."
10. **F-011 (Claude hallucination)** — wont_fix with rationale.
11. **F-012 (package.json wording)** — Minor: add a "Planner clarification" footer line under the verbatim-quoted Criteria block reiterating "version source = .claude-plugin/plugin.json (NO package.json exists for crews)".
