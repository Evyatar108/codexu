# Stories Outline: crews v3.6.0 — lead-side review-mail exact-duplicate collapse

*Preliminary decomposition from `/plan-with-ralph`. Feed to `/implement-with-ralph --from-plan` for PRD generation.*

## US-001: Heuristic pre-ship offline corpus measurement (early gate)
**Description:** As a planner, I want a read-only Node script that runs a HEURISTIC version of the collapse logic (inlined; does NOT depend on the not-yet-built `lib/collapse-key.js`) over the local `.crews/crews/ralph-pipeline/**/mailbox-history.jsonl` corpus so that I can measure D-001's likely UX impact BEFORE shipping any plugin code and surface a `kind=question` to the operator if the reduction is too small. US-012b runs a final FAITHFUL re-measurement using the real `buildCollapseKey` from `lib/collapse-key.js` after core-collapse ships, to confirm or revise the heuristic finding.
**Acceptance Criteria:**
- [ ] `.ralph/jobs/crews-redundant-empty-kind-tag-emissions/offline-measurement.mjs` exists, executable via `node .ralph/jobs/crews-redundant-empty-kind-tag-emissions/offline-measurement.mjs` from codexu root
- [ ] Script walks `.crews/crews/ralph-pipeline/**/mailbox-history.jsonl` (and optionally other crews via `--crew <name>` flag; defaults to ralph-pipeline)
- [ ] Script uses an INLINED heuristic collapse-key tuple `(sender, kind, sha256(bodyText(row)), summary)` when all of `replyTo`, `payload.replyTo`, `payload.replyToId`, `acks`, `decisions` are empty — this matches the production key SHAPE but does not import the production helper (which doesn't exist yet in Phase 1)
- [ ] Script outputs a raw-vs-collapsed diff report to `.ralph/jobs/crews-redundant-empty-kind-tag-emissions/offline-measurement-report.md` with: `total_rows`, `collapsed_groups`, `extra_dups_eliminated`, `percent_reduction`, per-member breakdown, sample collapsed groups (first 5)
- [ ] Script verifies zero rows with non-empty metadata get coalesced (independent SAFETY assertion in the report — must always hold, regardless of percent_reduction)
- [ ] If `percent_reduction < 5%`, the script's stdout includes a clear `[GATE]` block surfacing three operator options: `(A) proceed as structural improvement + telemetry channel / (B) defer in favor of D-003/D-004 / (C) widen corpus to other crews` — the orchestrator surfaces this as `kind=question` and pauses US-002+ until the operator decision is recorded in the staging dir or replied in the mailbox
- [ ] Report explicitly labels itself "HEURISTIC PRE-MEASUREMENT" and includes a footer linking to US-012b (final verification re-measurement)
- [ ] Typecheck passes (`node --check .ralph/jobs/crews-redundant-empty-kind-tag-emissions/offline-measurement.mjs`)
**Dependencies:** None
**Estimated complexity:** small

## US-002: Add `lib/version.js` runtime plugin-version reader
**Description:** As the crews plugin, I want a tiny runtime helper that reads my own version from `.claude-plugin/plugin.json` so that downstream code (US-009's collapse log line) can stamp the deployed version onto telemetry without re-implementing the manifest read.
**Acceptance Criteria:**
- [ ] `ai-developer-toolkit/plugins/crews/lib/version.js` exists exporting `getPluginVersion()`
- [ ] Reads `.claude-plugin/plugin.json` via `getPluginRoot()` from `hooks/paths.js:50`
- [ ] Returns the `version` string; caches at module scope (read-once)
- [ ] Throws a clear error if the manifest is missing or malformed (do NOT silently return `"unknown"` — fail loud during dev, since `version.test.js` already gates this on test)
- [ ] Test `tests/version-runtime.test.js` asserts `getPluginVersion()` returns the version string matching `.claude-plugin/plugin.json::version` (3 cases: happy path, caching, throws-on-missing)
- [ ] Typecheck passes (`node --check ai-developer-toolkit/plugins/crews/lib/version.js`)
- [ ] Full crews test suite still passes
**Dependencies:** None
**Estimated complexity:** small

## US-003: Add body-hash helper + env switch parser + empty-metadata predicate
**Description:** As the crews plugin, I want a pure-function `lib/collapse-key.js` module that provides (a) a sha256 body hash with explicit normalization, (b) an env-switch parser `parseCollapseEnv()` for `CREWS_REVIEW_MAIL_COLLAPSE` and `CREWS_REVIEW_MAIL_COLLAPSE_WARN_THRESHOLD`, and (c) an `isEmptyMetadata(row)` predicate checking all five reply-target / ack / decision fields so that US-004's collapse pass can compose these without re-implementing them.
**Acceptance Criteria:**
- [ ] `ai-developer-toolkit/plugins/crews/lib/collapse-key.js` exists exporting `hashBody(text)`, `parseCollapseEnv()`, `isEmptyMetadata(row)`, `buildCollapseKey(row)`
- [ ] `hashBody(text)` returns sha256 hex of the input string with normalization: `text.replace(/\r\n/g, '\n')`. NO trim, NO lowercase (preserves exact body semantics)
- [ ] `parseCollapseEnv()` returns `{ enabled: boolean, warnThreshold: number }`; `enabled = String(process.env.CREWS_REVIEW_MAIL_COLLAPSE || '').trim().toLowerCase() !== 'off'` (default ON)
- [ ] `warnThreshold` parsing reuses the existing `readEnvPositiveInt()` helper from `hooks/safe-io.js:60-67` to read `CREWS_REVIEW_MAIL_COLLAPSE_WARN_THRESHOLD`; default 3, invalid values fall back to 3 (matches existing v3.5.0 env-int conventions)
- [ ] `isEmptyMetadata(row)` returns `true` iff ALL of: `!row.replyTo`, `!(row.payload && row.payload.replyTo)`, `!(row.payload && row.payload.replyToId)`, `!(Array.isArray(row.acks) && row.acks.length > 0)`, `!(Array.isArray(row.decisions) && row.decisions.length > 0)`
- [ ] `buildCollapseKey(row)` returns a canonical JSON string `JSON.stringify({sender, kind, bodyHash, summary})` for collapsible rows; returns `null` when `isEmptyMetadata(row) === false` (signals "do not collapse this row")
- [ ] Test `tests/collapse-key.test.js` covers ≥10 cases: hash determinism (same input → same output), CRLF→LF normalization, no-trim invariant, env parser defaults (unset → enabled:true, warn:3), env parser off variants (`off`, `OFF`, `  off  `), env parser warn-threshold valid (5), warn-threshold invalid (-1, 'abc', '0' all → 3), each metadata field independently fails the empty predicate (one case per field: `replyTo`, `payload.replyTo`, `payload.replyToId`, non-empty `acks`, non-empty `decisions`)
- [ ] Typecheck passes; full crews test suite still passes
**Dependencies:** None
**Estimated complexity:** medium

## US-004: Implement PURE collapse helper `lib/collapse-review-rows.js`
**Description:** As the crews plugin, I want a PURE collapse helper (no I/O, no env reads, no manifest reads, no appendLog, no stderr) that takes an array of expanded raw rows and returns BOTH (a) a new array of head rows with `_collapsed*` markers attached and (b) a flat list of `collapseGroups` carrying enough information for the review-mail.js call site to perform all side effects (logging, stderr, telemetry derivation). This purity is required so US-008/US-009 can wire side effects without coupling the collapse logic to its surfaces.
**Acceptance Criteria:**
- [ ] `ai-developer-toolkit/plugins/crews/lib/collapse-review-rows.js` exists exporting `collapseReviewRows(rows)`
- [ ] Signature: `collapseReviewRows(rows)` returns `{ collapsedRows: Row[], collapseGroups: Group[] }` where `Group = { count, seqRange: [a, b], bodyHashPrefix, kind, sender, memberSeqs: number[], memberIds: string[], memberConsumedAts: string[] }`
- [ ] Helper performs NO I/O: NO `require('fs')`, NO `appendLog` import, NO `process.stderr` write, NO `process.env` read, NO manifest read. Imports are limited to `lib/collapse-key.js` only.
- [ ] Uses `buildCollapseKey(row)` from `lib/collapse-key.js` — rows with `key === null` are emitted individually (no collapse, no group entry)
- [ ] Groups CONSECUTIVE rows with the same non-null key into one entry; the head row carries `_collapsedSeqs[]` (all original `seq` values in order), `_collapsedIds[]` (each computed via `row.reportId || row.outboxId || row.id` — the leaf-id chain per F-006), `_collapsedCount` (= group length)
- [ ] For collapse groups of size 1, no `_collapsed*` fields are attached AND no entry is added to `collapseGroups[]` (preserves pre-change shape for non-collapsed rows; surface only has logging-worthy groups)
- [ ] `bodyHashPrefix` in each group is the first 12 chars of `hashBody(bodyText(headRow))` — the helper uses `bodyText` internally for hashing (defined locally to avoid importing from `hooks/commands/review-mail.js`); identical to the `bodyText` exported in v3.5.0 review-mail.js:91-97
- [ ] Test `tests/collapse-review-rows.test.js` covers ≥16 cases:
  - 1-row input → 1 row in `collapsedRows`, no `_collapsed*` fields, 0 entries in `collapseGroups`
  - 2-row collapse → 1 row in `collapsedRows` with `_collapsedCount=2`, 1 entry in `collapseGroups`
  - 3-row collapse → 1 row in `collapsedRows` with `_collapsedCount=3`, 1 entry in `collapseGroups`
  - 5-row collapse, mixed with 2 non-collapsible rows → `collapsedRows.length === 3` (1 collapsed head + 2 individual), `collapseGroups.length === 1`
  - row with non-empty `replyTo` interrupts a run of 3 same-key rows → `collapsedRows.length === 4` (3+1), `collapseGroups.length === 1`
  - row with non-empty `acks` interrupts → 4+1, 1
  - row with non-empty `decisions` interrupts → 4+1, 1
  - row with non-empty `payload.replyTo` interrupts → 4+1, 1
  - row with non-empty `payload.replyToId` interrupts → 4+1, 1
  - two collapse groups separated by a non-collapsible row → both groups collapse independently (`collapseGroups.length === 2`)
  - rows with different summaries do NOT collapse
  - rows with different bodyText do NOT collapse
  - rows with different sender (`from.name` vs `from.triggeredBy`) do NOT collapse
  - `_collapsedIds[]` for a proactive-batch leaf-row group uses `row.reportId` (not parent `row.id`); for a direct-send group uses `row.id`
  - `memberConsumedAts[]` carries 3 distinct ISO timestamps for a 3-row collapse with different `consumedAt` values, 1 distinct for same-`consumedAt` rows
  - Helper is pure: a test passes a frozen `process.env` snapshot, swaps `process.env.CREWS_REVIEW_MAIL_COLLAPSE = 'off'` mid-test, calls the helper again, asserts identical output (helper does not read env)
- [ ] Typecheck passes; full crews test suite still passes
**Dependencies:** US-002, US-003
**Estimated complexity:** large

## US-005: Wire collapse pass into `review-mail.js` handler (all side effects HERE)
**Description:** As a lead running `/crews:review-mail`, I want the new collapse pass plugged into the handler so that my review surface displays collapsed rows AND the side effects (appendLog, stderr, telemetry, env gating) all happen at the handler level — keeping the collapse helper itself pure.
**Acceptance Criteria:**
- [ ] `hooks/commands/review-mail.js` imports `collapseReviewRows` from `../lib/collapse-review-rows` and `parseCollapseEnv` from `../lib/collapse-key` and `getPluginVersion` from `../lib/version`
- [ ] Handler is rewritten as documented in plan.md > Approach > Architecture > step 4: parse env once, only call `collapseReviewRows` when `env.enabled`, iterate `collapseGroups` writing `appendLog` per group and (when `args.output === 'cli'` AND `group.count >= env.warnThreshold`) `process.stderr.write` per group, then map `collapsedRows` through `formatReviewMailEntry`
- [ ] Each `appendLog` line carries the full telemetry shape `review-mail collapse: name=<n> crew=<c> kind=<k> count=<N> seqRange=<a>..<b> bodyHash=<12-char hex> version=<v> listenerExit=<reason> turnBoundaryCount=<N>`, where `listenerExit = manifest.terminationReason || manifest.listenerState || 'unknown'` and `turnBoundaryCount = new Set(group.memberConsumedAts).size`
- [ ] `formatReviewMailEntry` is extended to detect `_collapsedSeqs[] / _collapsedIds[] / _collapsedCount` on the input row and surface them in the return value as `collapsedSeqs[] / collapsedIds[] / collapsedCount` (top-level fields). For non-collapsed rows the `collapsed*` fields are ABSENT from the JSON serialization (preserves shape).
- [ ] Cursor advancement at line 205-209 is byte-identical (uses `allRows`, not `entries`)
- [ ] `tests/review-mail-command.test.js` extended with 6 new cases: (a) 3-row collapse via real handler invocation → 1 entry, (b) replyTo blocks collapse, (c) ack blocks collapse, (d) `CREWS_REVIEW_MAIL_COLLAPSE=off` returns un-collapsed entries with bit-identical JSON shape, (e) collapsed entry includes `collapsedSeqs[]` matching the original seqs in order, (f) collapsed proactive-batch row exposes leaf `reportId`/`outboxId` in `collapsedIds[]` per F-006
- [ ] `tests/command-args-parity.test.js:191-196` stdout key-order pin updated to include `collapsedCount, collapsedSeqs, collapsedIds` AFTER `consumedAt` (additive at end of object). Pre-3.6.0 keys preserved in their existing order. The test invokes the dispatcher form `node tools/crews.js review-mail ...` (not the deprecated wrapper `tools/review-mail.js`) per F-007.
- [ ] Slash form (`/crews:review-mail`) and CLI form (`node tools/crews.js review-mail ...`) both surface collapsed entries in stdout identically (cli-parity); ONLY the stderr warning differs (CLI emits, slash does not).
- [ ] Typecheck passes; full crews test suite still passes
**Dependencies:** US-004
**Estimated complexity:** medium

## US-006: Cursor preservation regression test
**Description:** As a downstream consumer (Stop-hook review-required gate, PreToolUse, PostToolUse), I want a regression test that proves the collapse pass NEVER affects `manifest.lastReviewedSeq` or `manifest.lastReviewedAt` so that a future refactor cannot silently break cursor advancement.
**Acceptance Criteria:**
- [ ] `tests/strict-ack-review-mail.test.js` is NOT modified (assertions remain byte-identical)
- [ ] `tests/strict-ack-review-mail.test.js` PASSES under the new collapse-enabled code path
- [ ] `tests/review-mail-command.test.js` adds one explicit regression case: seed 3 identical rows (seqs 1, 2, 3) plus 1 differing row (seq 4), invoke handler, assert `cursor.lastReviewedSeq === 4` regardless of `entries.length === 2` (1 collapsed group + 1 individual)
- [ ] `tests/review-mail-command.test.js` adds one explicit regression case: same seed, run with `CREWS_REVIEW_MAIL_COLLAPSE=off`, assert cursor still advances to 4 with `entries.length === 4` (un-collapsed)
- [ ] Typecheck passes; full crews test suite still passes
**Dependencies:** US-005
**Estimated complexity:** small

## US-007: `CREWS_REVIEW_MAIL_COLLAPSE=off` produces bit-identical output (4-condition boundary)
**Description:** As an operator, I want to be able to set `CREWS_REVIEW_MAIL_COLLAPSE=off` and get output that is byte-identical to the pre-3.6.0 review-mail JSON AND zero new side-effect noise so that I can opt out cleanly if the collapse changes break my external scripts.
**Acceptance Criteria:**
- [ ] `tests/review-mail-command.test.js` adds a regression case asserting ALL four conditions of AC4 (per F-010): (a) JSON stdout byte-for-byte identical to pre-3.6.0 INCLUDING key order and absence of `collapsed*` fields, (b) zero stderr output, (c) zero new `review-mail collapse:` lines in `crews.log` for the invocation, (d) `manifest.lastReviewedSeq` and `lastReviewedAt` advance to byte-identical values as collapse-enabled mode would have
- [ ] The off-mode output omits `collapsedCount`, `collapsedSeqs`, `collapsedIds` from every entry (NOT present as `null` or `undefined` — absent from the JSON serialization)
- [ ] `tests/review-mail-command.test.js` adds one collapse-on regression case: same fixture, asserts `entries[0].collapsedCount === 5`, `entries[0].collapsedSeqs.length === 5`, `entries.length === 1`
- [ ] Typecheck passes; full crews test suite still passes
**Dependencies:** US-005
**Estimated complexity:** small

## US-008: Per-collapse `appendLog` line + CLI stderr warning + log-line shape contract (slash/CLI split)
**Description:** As an operator grep-ing `crews.log` for collapse activity, I want every collapse pass to leave one grep-able line in the log AND (only when invoked via CLI and count meets the threshold) one stderr warning so that I can both audit and visually notice high-volume collapse activity. Slash invocations emit only the log line, not stderr.
**Acceptance Criteria:**
- [ ] Every collapse group of size ≥ 2 produces one `appendLog` line per the canonical shape (US-005 implements at the handler call site; this story locks the contract via dedicated grep-shape and slash-vs-CLI tests)
- [ ] Test in `tests/review-mail-command.test.js` adds one regex assertion case matching the appendLog line shape via `/^\[\d{4}-\d{2}-\d{2}T[\d:.Z-]+\] review-mail collapse: name=\S+ crew=\S+ kind=\S+ count=\d+ seqRange=\d+\.\.\d+ bodyHash=[a-f0-9]{12} version=\d+\.\d+\.\d+ listenerExit=\S+ turnBoundaryCount=\d+$/` (read from `crews.log` after a handler invocation)
- [ ] Two CLI-form spawn tests in `tests/review-mail-command.test.js` or `tests/command-args-parity.test.js` (dispatcher form per F-007): (a) `count=3` with default `warnThreshold` writes ONE stderr line; (b) `count=2` writes NO stderr line. Stderr shape: `crews review-mail: collapsed <N> consecutive same-(sender=<n>, kind=<k>) rows; seqRange=<a>..<b>; bodyHash=<prefix> (use CREWS_REVIEW_MAIL_COLLAPSE=off to disable)`
- [ ] Two slash-form tests: (a) same 3-row collapse via slash invocation writes ZERO stderr but ONE crews.log line, (b) verifies args.output === 'slash' is the gate
- [ ] One test asserts `CREWS_REVIEW_MAIL_COLLAPSE_WARN_THRESHOLD=5` raises the threshold: `count=3` no longer triggers stderr (CLI), `count=5` does
- [ ] AGENTS.md `v3.6.0` section (US-011) documents the slash-vs-CLI stderr asymmetry explicitly
- [ ] Typecheck passes; full crews test suite still passes
**Dependencies:** US-004, US-005
**Estimated complexity:** medium

## US-009: D-002 telemetry bake-in (listenerExit + turnBoundaryCount) + payload.entries verification
**Description:** As an operator analyzing residual noise after D-001 ships, I want each collapse log line to carry the actor's last listener-exit reason and an inferred turn-boundary count so that I can classify whether the surviving noise is from same-turn multi-tag, multi-turn, Stop retry, or `payload.entries` expansion — without a separate D-002 instrumentation ship.
**Acceptance Criteria:**
- [ ] The handler call site in `review-mail.js` (US-005) reads `manifest` (already in scope at line 184 via `readManifest`) and derives `listenerExit = manifest.terminationReason || manifest.listenerState || 'unknown'`. NO change to `lib/collapse-review-rows.js` (which stays pure per US-004).
- [ ] `turnBoundaryCount` is derived at the call site from `new Set(group.memberConsumedAts).size` (which the pure helper provides)
- [ ] Log line shape (US-005 implements; this story tests) includes both fields at the end: `... version=<v> listenerExit=<reason> turnBoundaryCount=<N>`
- [ ] One unit test verifies the `listenerExit=unknown` fallback when the manifest has neither `terminationReason` nor `listenerState` (legacy pre-v1.9 manifest fixture)
- [ ] One unit test verifies the `listenerExit=hard` value when `manifest.terminationReason === 'hard'` (v1.9+ manifest fixture)
- [ ] One unit test verifies a multi-`consumedAt` collapse group yields `turnBoundaryCount=2` while a same-`consumedAt` group yields `turnBoundaryCount=1`
- [ ] One unit test verifies that a proactive-batch row (`payload.entries[]` with 3 identical entries) flows through `expandReviewRows` → `collapseReviewRows` and emits ONE collapsed row + one log line + (if `count >= 3` AND CLI form) one stderr line — this is the AC-7 (Devil's Advocate) verification that the leaf-row collapse pass naturally covers proactive batches WITHOUT a separate batch-level dedup. The test asserts `collapsedIds[]` carries leaf `reportId` values (not the parent inbox `id`) per F-006.
- [ ] AGENTS.md v3.6.0 section documents the bundled D-002 telemetry shape, the data-source derivation (`terminationReason || listenerState || 'unknown'`), and the "payload.entries naturally covered" finding
- [ ] Typecheck passes; full crews test suite still passes
**Dependencies:** US-005, US-008
**Estimated complexity:** medium

## US-010: Plugin version bump 3.5.0 → 3.6.0 via canonical script
**Description:** As a marketplace consumer running `copilot plugin update crews`, I want the crews plugin to advertise its new version across all 6 stamping locations (atomically via `scripts/bump-version.js`) plus the codexu-root AGENTS.md table row so that the new collapse behavior actually ships.
**Acceptance Criteria:**
- [ ] `node ai-developer-toolkit/plugins/crews/scripts/bump-version.js 3.6.0` run from the toolkit submodule, which atomically bumps:
  - `ai-developer-toolkit/plugins/crews/.claude-plugin/plugin.json` (Claude manifest)
  - `ai-developer-toolkit/plugins/crews/.github/plugin/plugin.json` (Copilot manifest)
  - `ai-developer-toolkit/.claude-plugin/marketplace.json` (Claude marketplace index)
  - `ai-developer-toolkit/.github/plugin/marketplace.json` (Copilot marketplace index)
  - `ai-developer-toolkit/.agents/plugins/marketplace.json` (repo-local Codex marketplace index)
  - `ai-developer-toolkit/plugins/crews/tests/version.test.js` (version literal assertion)
- [ ] All 6 files report version `3.6.0` (verify via `grep -r '3.6.0' ai-developer-toolkit/plugins/crews/.claude-plugin/plugin.json ai-developer-toolkit/plugins/crews/.github/plugin/plugin.json ai-developer-toolkit/.claude-plugin/marketplace.json ai-developer-toolkit/.github/plugin/marketplace.json ai-developer-toolkit/.agents/plugins/marketplace.json ai-developer-toolkit/plugins/crews/tests/version.test.js`)
- [ ] `cd ai-developer-toolkit/plugins/crews && node tests/version.test.js` passes
- [ ] Codexu-root `AGENTS.md` "Active plugin versions" table row for `crews` is bumped manually 3.5.0 → 3.6.0 (this row is OUTSIDE `bump-version.js` scope and must be edited explicitly)
- [ ] Full crews test suite passes
**Dependencies:** core-collapse stories complete (US-004..US-009)
**Estimated complexity:** small

## US-011: CHANGELOG.md + plugin AGENTS.md + codexu-root AGENTS.md updates
**Description:** As a future maintainer reading the codebase 6 months from now, I want a prepended `## 3.6.0 - <date>` CHANGELOG entry, a new `## v3.6.0 review-mail lead-side collapse` plugin AGENTS.md section, and a refreshed codexu-root AGENTS.md note so that the design rationale, edit sites, gotchas, env-switch contract, and slash-vs-CLI asymmetry are discoverable without re-reading the commit messages.
**Acceptance Criteria:**
- [ ] `ai-developer-toolkit/plugins/crews/CHANGELOG.md` has a new `## 3.6.0 - <YYYY-MM-DD>` entry prepended above the existing `## 3.5.0` entry
- [ ] CHANGELOG entry follows the existing prose-with-bold-bullets format (see 3.5.0 entry as the reference); explains the collapse design, the env switches with defaults, the JSON output shape extension (additive: collapsedCount/collapsedSeqs/collapsedIds present only on collapsed rows), the slash-vs-CLI stderr asymmetry, the cursor preservation invariant, the offline-measurement gate, and the bundled D-002 telemetry (listenerExit + turnBoundaryCount)
- [ ] CHANGELOG entry references the in-scope edit sites and the explicitly-untouched files (resolve-body.js, mailbox.js, outbox/history writers)
- [ ] `ai-developer-toolkit/plugins/crews/AGENTS.md` has a new `## v3.6.0 review-mail lead-side collapse` section prepended above the existing v3.5.0 section (same prepend-at-top convention as the existing v3.x sections)
- [ ] AGENTS.md section documents: edit sites, env switches with defaults, log-line format with example, JSON output shape change with example, body-hash normalization rules (CRLF→LF, no trim, no lowercase), the slash-vs-CLI stderr asymmetry, the cursor preservation invariant (load-bearing — link to US-006 regression test), and ≥4 "common-mistake gotchas":
  - "Don't hash the resolved-from-id body; hash the pre-fallback `bodyText(row)`."
  - "Don't widen collapse beyond consecutive runs (no LRU / no near-similarity)."
  - "Don't add `collapsedCount: 1` to non-collapsed rows — absence preserves pre-3.6.0 JSON shape."
  - "Don't move env reads / appendLog / stderr writes into `lib/collapse-review-rows.js`; the helper stays pure for unit-testability."
- [ ] Codexu-root `AGENTS.md` `## Active plugin versions` table row for `crews` shows `3.6.0`
- [ ] Markdown lints clean (no broken intra-doc links)
**Dependencies:** US-010
**Estimated complexity:** medium

## US-012: Full-suite green + US-012b final verification re-measurement + dashboard + commit + push
**Description:** As the ralph orchestrator wrapping this work, I want a final cross-cluster regression run, a FAITHFUL re-measurement using the real `buildCollapseKey` from `lib/collapse-key.js` to confirm or revise US-001's heuristic finding, a dashboard update, and the topic-branch commit + push to be cleanly executed so that the lead can FF-merge into main without surprises.
**Acceptance Criteria:**
- [ ] **US-012a (regression run)**: `cd ai-developer-toolkit/plugins/crews && node tests/run.js 2>&1 | tee /tmp/crews-tests-final.out` shows all tests passing in under 90s on Windows at default concurrency 10 (the v1.5.2+ loosened ceiling per plugin AGENTS.md "Test cadence"). No new test enters the serial denylist.
- [ ] **US-012b (final verification re-measurement)**: a second script `.ralph/jobs/crews-redundant-empty-kind-tag-emissions/offline-measurement-faithful.mjs` exists that IMPORTS the real `buildCollapseKey` from `lib/collapse-key.js` and re-runs the same corpus measurement US-001 ran. Output goes to `.ralph/jobs/crews-redundant-empty-kind-tag-emissions/offline-measurement-faithful-report.md`. The report compares percent_reduction between US-001 heuristic and US-012b faithful; if they differ by more than 2 percentage points, the report flags the heuristic as inaccurate and surfaces a note in the ship report.
- [ ] **US-012b safety re-assertion**: the faithful re-measurement also re-asserts "zero rows with non-empty metadata get coalesced" using the real helper. Any violation halts US-012 and surfaces `kind=blocked`.
- [ ] Submodule commit on `ralph/<task-id>` topic branch inside `ai-developer-toolkit/.worktrees/<task-id>/`, with commit message `feat(crews): v3.6.0 — lead-side review-mail exact-duplicate collapse (D-001)` plus the full feature description in the body
- [ ] Submodule branch pushed to `gim-home/ai-developer-toolkit` (marketplace source), `origin` (work mirror), and `personal` (per AGENTS.md multi-remote convention) — explicit branch push, NOT `--all`
- [ ] Codexu-side submodule-pointer-bump commit on `ralph/<task-id>` topic branch with message `chore(submodule): bump ai-developer-toolkit pointer for crews v3.6.0` plus reference to the toolkit-side commit SHA
- [ ] Final report-tag reads: `<|report kind="done" summary="crews v3.6.0 shipped: D-001 collapse + D-002 telemetry; 12 stories, N cases added; toolkit+codexu commits pushed; faithful measurement = X%"|>` plus a prose body listing both commit SHAs, the test wall-clock, the US-001 heuristic measurement, and the US-012b faithful re-measurement result
**Dependencies:** US-011
**Estimated complexity:** small
