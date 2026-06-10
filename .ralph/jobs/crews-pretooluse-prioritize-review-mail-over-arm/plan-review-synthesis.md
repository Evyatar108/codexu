### Claude Plan Review
No major issues. Insertion point correct; reuse of reviewRequiredReason sound; ACs verifiable
(incl. lead + byte-identical). Claimed NO existing test flips — INCORRECT (see codex High below).
Minor: keep new test focused; compare command via direct reviewRequiredReason call.

### Codex Plan Review
- [High] review-gate.test.js:367-381 flips: it seeds review-required mail + listenerState:'exited'
  (unarmed) and asserts `must arm a background listener` (:379) + NO `review-required` (:380). The
  new branch emits the review-mail-first block, flipping both. MUST be updated or `node tests/run.js`
  fails. (VERIFIED directly against source.)
- [Medium] Broaden the test audit: grep the whole tests/ tree for `you must arm a background listener`,
  `lastReviewRequiredSeq`, `lastReviewedSeq` (not just 3 named files).
- [Medium] AC4 conflates "review-mail command" with reviewRequiredReason(...) (a full multi-line
  reason). Assert the hook reason contains the exact full reviewRequiredReason(...) string (prefix),
  or extract/compare the command substring.
- [Medium] AC4 engine coverage must include env-set AND env-unset (useEnvBin true/false). Current
  review-gate.test.js golden loop covers claude/copilot env-set/env-unset but NOT codex.
- [Low] Reuse existing fixtures (review-gate.test.js helpers / tests/integration/lib/scenario.js)
  rather than duplicating subprocess+manifest setup.
- [Low] AC8 wording: bump-version.js edits 7 files total (3 plugin manifests + 3 marketplace indexes
  + tests/version.test.js); "6 stamps + version.test.js" is fine but clarify the total.

### Copilot Plan Review
- [Medium] review-gate.test.js has `expectedReviewRequiredReason` helper special-casing only
  engine==='copilot'; extending it to codex yields the wrong arm-prefix (codex has its own string).
  Update the helper OR test codex against direct reviewRequiredReason(...) output. (=> test against
  direct output; do NOT extend the helper.)
- [Medium] Make the test matrix explicit: member pending/no-pending/armed + lead pending + engine
  assertions covering codex `$env:CREWS_BIN`.
- [Medium] "byte-identical" imprecise: the combined block cannot EQUAL reviewRequiredReason(...) (it
  appends arm note). Criterion: the block STARTS WITH the exact reviewRequiredReason(...) string,
  followed by the secondary arm note.
- Ordering/Simplicity: no issues; reuse of reviewRequiredReason is the right integration point.

### Consensus (2+ reviewers)
- AC4 wording: assert the block CONTAINS / STARTS WITH the exact full reviewRequiredReason(...) string
  (a contiguous prefix), then the arm note — not "byte-identical equality". (codex + copilot)
- AC4 engine coverage: cover claude/copilot/codex × env-set/env-unset; compare against DIRECT
  reviewRequiredReason(...) output; do NOT extend the review-gate.test.js helper. (codex + copilot)

### Divergences
- [codex, High] review-gate.test.js:367-381 flips (Claude said no flips; codex verified correct).
- [codex, Medium] broaden audit via grep.
- [codex, Low] reuse fixtures; AC8 7-file clarification.
- [copilot, Medium] explicit test matrix.

### Recommended Amendments (all applied to plan)
1. Correct the false "no existing fixtures flip" claim; add explicit story/AC to update
   review-gate.test.js:367-381 to expect the review-mail-first block.
2. Broaden the audit to a tests/-tree grep for the 3 tokens.
3. Refine AC1/AC4: prefix-substring of exact reviewRequiredReason(...) output; explicit
   claude/copilot/codex × env-set/env-unset matrix; compare against direct reviewRequiredReason;
   do not extend the review-gate helper.
4. Clarify AC8 as 7 files edited by bump-version.js.
5. Note optional reuse of existing fixtures/helpers.
