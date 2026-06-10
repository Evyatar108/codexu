# Stories Outline: crews proactive-done silent-miss regression

*Preliminary decomposition from `/plan-with-ralph`. Feed to `/implement-with-ralph --from-plan` for PRD generation.*

## US-001: Reproduce + instrument the seq-501 silent-miss; pin the over-advance path
**Description:** As the maintainer, I want a failing reproduction of the seq-501 empty-`review-mail`
symptom that pins which cursor-advancer fires, so the fix targets the real path rather than an
assumed one (the armed-listener path is provably not the silent-advancer).
**Acceptance Criteria:**
- [ ] A new test (`tests/integration/proactive-done-silent-miss.test.js`) reproduces the symptom on
      current main: a protocol-v2 proactive batch (progress×N + trailing `done`) delivered to the
      lead, then consumed/advanced via a candidate path, after which `review-mail` returns
      `{entries:[], advanced:false}` while the `done` exists in `mailbox-history.jsonl`. The test
      FAILS (red) on current main.
- [ ] The reproduction exercises each candidate advancer in turn: (a) `/wake` `markReviewed`
      without expand; (b) `review-mail --since <seq>` advancing on `allRows`; (c) the
      `review-mail` legacy-cursor recovery branch (`review-mail.js:274-291`).
- [ ] A `reproduction-findings.md` is written naming the advancer(s) that fire, with captured
      values: history row `via`, `lastReviewRequiredSeq` before/after consume, and
      `lastReviewedSeq` before/after each `/wake`/`review-mail`.
- [ ] `node --check` passes on the new test file.
- [ ] Typecheck passes (`node --check` on touched `.js`).
**Dependencies:** None
**Estimated complexity:** medium

## US-002: Share `expandReviewRows`; fix the cursor-advance-without-expanded-surface paths
**Description:** As the lead, I want every cursor-advancing path to surface the expanded
protocol-v2 `payload.entries[]` terminal content before advancing `lastReviewedSeq`, so a
delivered proactive `done`/`question`/`blocked` is never silently skipped by `review-mail`.
**Acceptance Criteria:**
- [ ] `expandReviewRows` is a single shared implementation in `lib/expand-review-rows.js`
      (pure — no `require` of `config`/`mailbox`/`review-mail`), imported by `review-mail.js`;
      `review-mail` behavior is byte-identical for existing cases (regression-guarded by
      `tests/review-mail-command.test.js`).
- [ ] `/wake` (`hooks/user-prompt-submit.js`) expands history rows via the shared
      `expandReviewRows` before `formatReviewMailEntry` AND before `markReviewed`; the delivered
      `entries` include the expanded per-report `done` (assert entry count, per-entry `kind`,
      `outboxSeq`/`reportId`, shared `inboxSeq`) — NOT just batch body text.
- [ ] Because `/wake` surfaces the `done`, a subsequent `review-mail` is correctly empty —
      asserted explicitly.
- [ ] Listener path: `deliver()` does not advance `lastReviewedSeq`; the first subsequent
      `review-mail` surfaces the expanded `done` (`entries` non-empty, `advanced:true`).
- [ ] The `review-mail` legacy-cursor recovery branch does NOT silently advance past a delivered
      review-required protocol-v2 proactive **terminal** row (guard scoped to
      `payload.proactive`/`payload.entries[]` with a terminal kind); the genuine stuck-cursor
      recovery (no proactive-terminal row present) still advances.
- [ ] Invariants preserved: metadata-only listener envelope unchanged; `wake-explicit-only` gate
      holds; `{overview, entries}` vs bare-array `/wake` body shape preserved under
      `CREWS_REVIEW_MAIL_OVERVIEW` on AND off; `review-mail --since` advance semantics unchanged;
      v3.6.2 epoch-fence + `proactive-report-silent-loss-race` tests still pass.
- [ ] The US-001 reproduction test(s) now PASS (green).
- [ ] `node plugins/crews/tests/run.js` is green on Windows at default concurrency (output saved
      to a file).
- [ ] Typecheck passes (`node --check` on touched `.js`).
**Dependencies:** US-001
**Estimated complexity:** medium

## US-003: Version bump + CHANGELOG + plugin AGENTS.md + marketplace/codex-policy validation
**Description:** As a consumer, I want the crews version bumped and the fix documented so
`copilot plugin update` picks it up and future maintainers understand the regression.
**Acceptance Criteria:**
- [ ] `node scripts/bump-version.js <x.y.z>` bumps all 6 version stamps; `tests/version.test.js`
      passes (recommend 3.20.0; 3.19.1 acceptable — lead confirms).
- [ ] `CHANGELOG.md` has a `## <x.y.z>` entry summarizing the regression + fix.
- [ ] Plugin `AGENTS.md` has a `## v<x.y.z>` section documenting: the regression (cursor
      over-advance without expanded surface), the pinned path (`af07987d` protocol-v2 expand
      parity gap), the fix (shared `expandReviewRows` + `/wake` expand-before-advance + recovery
      guard), and the gotcha "don't make the listener carry content (v3.6.2 double-notify class)".
- [ ] `node tools/validate-codex-marketplace-policy.mjs` passes for all three marketplace indexes.
- [ ] `node plugins/crews/tests/run.js` still green.
- [ ] Codexu root `CLAUDE.md` is NOT staged; fork-level edits go in codexu `AGENTS.md` (lead-owned
      at ship — not this story).
**Dependencies:** US-001, US-002
**Estimated complexity:** small
