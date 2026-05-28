# Stories Outline: crews-review-mail-summary-payload-fallback

*Preliminary decomposition from `/plan-with-ralph`. Feed to `/implement-with-ralph --from-plan` for PRD generation.*

## US-001: Read-path nullish-coalescing fallback in formatReviewMailEntry
**Description:** As an operator running `/crews:review-mail`, I want member-reply and proactive-report envelopes (which store summary nested under `payload.summary`) to surface their summary in the formatter output, so that historical inbox-history rows from before v1.7.3 still show the full summary attribute.
**Acceptance Criteria:**
- [ ] `hooks/commands/review-mail.js` line 111 reads `summary: row?.summary ?? row?.payload?.summary ?? null,` (uses `??` not `||`)
- [ ] New fixture in `tests/review-mail-command.test.js` seeds an inbox-history row with NO top-level summary and populated `payload.summary`; asserts `entry.summary === payload.summary` via `formatReviewMailEntry`
- [ ] Existing tests still pass; `node tests/run.js` exits 0 inside plugins/crews
- [ ] Typecheck passes (N/A — CommonJS, no TS)
**Dependencies:** None
**Estimated complexity:** small

## US-002: Lift summary to top-level on member-reply system envelope
**Description:** As a consumer of inbox-history rows, I want member-reply envelopes (system-routed via `appendSystemMailbox`) to carry `summary` at the top level matching the direct-send shape, so the schema is uniform and readers don't need fallback logic for future rows.
**Acceptance Criteria:**
- [ ] `hooks/stop.js` member-reply call site (~lines 831–842) passes `summary: effectiveSummary` at the envelope top level (between `kind` and `message`), in addition to `payload.summary`
- [ ] Existing tests still pass; `node tests/run.js` exits 0 inside plugins/crews
- [ ] Typecheck passes (N/A)
**Dependencies:** None (file overlap with US-003 — same file, non-overlapping sites)
**Estimated complexity:** small

## US-003: Lift summary to top-level on proactive-report system envelope
**Description:** As a consumer of inbox-history rows, I want proactive-report envelopes to carry `summary` at the top level matching the direct-send shape, completing the schema-uniformity fix for both system-routed envelope kinds.
**Acceptance Criteria:**
- [ ] `hooks/stop.js` proactive-report call site (~lines 858–882) passes `summary: effectiveSummary` at the envelope top level, in addition to `payload.summary`
- [ ] Existing tests still pass; `node tests/run.js` exits 0 inside plugins/crews
- [ ] Typecheck passes (N/A)
**Dependencies:** None (file overlap with US-002 — same file, non-overlapping sites; serialize for merge cleanliness)
**Estimated complexity:** small

## US-004: Formatter and real-stop integration assertions
**Description:** As a maintainer, I want both the formatter (hand-built fixture) and the real `hooks/stop.js`-routed path to have regression assertions for top-level summary on system envelopes, so future producer or formatter regressions are caught.
**Acceptance Criteria:**
- [ ] `tests/member-reply-notify.test.js` asserts `formatReviewMailEntry` surfaces `entry.summary` from the (hand-built) member-reply envelope using the assertion template in the plan
- [ ] `tests/proactive-report-notify.test.js` asserts the post-stop proactive-report envelope carries `summary` at the top level
- [ ] One integration test under `tests/integration/` (extend `review-flow.test.js` or `send-receive-reply-cycle.test.js`) asserts that after real stop routing, `review.entries[0].summary === "<text>"`
- [ ] `node tests/run.js` exits 0 inside plugins/crews
- [ ] Typecheck passes (N/A)
**Dependencies:** US-002, US-003
**Estimated complexity:** small-to-medium

## US-005: Version bump to 1.7.3, CHANGELOG entry, CLAUDE.md schema-note update
**Description:** As a release manager, I want the crews plugin's version bumped to v1.7.3 across all 5 release stamps + version test, with a CHANGELOG entry citing the failing scenario and schema-uniformity rationale, and the CLAUDE.md v1.3.5 schema note updated to reflect the v1.7.3 reversal.
**Acceptance Criteria:**
- [ ] `node plugins/crews/scripts/bump-version.js 1.7.3` run from `D:/ai-developer-toolkit/`; all 5 release stamps + `tests/version.test.js` updated to 1.7.3
- [ ] Targeted `git grep` over the 5 stamp files + `tests/version.test.js` returns 0 hits for `1.7.2` (do not grep CHANGELOG.md or CLAUDE.md)
- [ ] `CHANGELOG.md` has a `## v1.7.3` entry citing the failing scenario AND the schema-uniformity rationale
- [ ] `CLAUDE.md` lines 607–614 updated to reference (a) v1.3.5 decision context, (b) v1.7.3 reversal at stop.js system-routing sites, (c) read-side `??` fallback, (d) `payload.summary` retained for back-compat
- [ ] `node tests/run.js` exits 0 inside plugins/crews; `tests/version.test.js` passes with 1.7.3
- [ ] Typecheck passes (N/A)
**Dependencies:** US-001, US-002, US-003, US-004 (ship gate — all code lands before release stamp)
**Estimated complexity:** small
