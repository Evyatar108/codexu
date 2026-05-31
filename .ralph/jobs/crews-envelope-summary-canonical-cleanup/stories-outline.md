# Stories Outline: crews envelope summary canonical cleanup

*Preliminary decomposition from `/plan-with-ralph`. Feed to `/implement-with-ralph --from-plan` for PRD generation.*

## US-001: Retire consumer fallback for `payload.summary` and bump crews to v2.4.1

**Description:** As a crews-plugin maintainer, I want to retire the v1.7.3
consumer fallback `row?.summary ?? row?.payload?.summary` at
`hooks/commands/review-mail.js:110` so that the canonical wire address
(`env.summary`, top-level) becomes the sole authoritative read path; the
producer mirror at `stop.js:1086/1122` stays in place as the transitional
bridge for in-flight on-disk envelopes per `hooks/protocol/envelope.js:192`'s
"cleanup follow-up" anticipation.

**Acceptance Criteria:**

- [ ] `hooks/commands/review-mail.js:110` reads `summary: row?.summary ?? null,`
      (no `?? row?.payload?.summary`).
- [ ] `tests/review-mail-command.test.js` block at ~361-378 is INVERTED: a row
      constructed with `payload.summary` only (no top-level) now asserts
      `equal(entry.summary, null, ...)` instead of asserting it surfaces
      `payloadSummary`. The block carries a one-line comment pointing at the
      v2.4.1 CHANGELOG entry.
- [ ] `tests/protocol-envelope-roundtrip.test.js` v1.7.2 regression block:
      half (a) (validator strict-mode silent-drop guard) is preserved as-is;
      half (b) (consumer-fallback assertion that
      `formatReviewMailEntry(payloadOnlyRow).summary` surfaces) is deleted.
      Comment header at ~129-145 is updated to describe the v2.4.1 state.
- [ ] `tests/member-reply-notify.test.js:90-93` and
      `tests/proactive-report-notify.test.js:58-110` assertions about
      `payload.summary` and `payload.kind` ARE UNCHANGED and still pass
      (producer mirror retained).
- [ ] `hooks/protocol/envelope.js` header comment block (lines 7-11) updated
      to describe v2.4.1: producer mirror retained, consumer fallback removed.
      Line 192's "follow-up removes `payload.summary` entirely" comment is
      retained — it describes a still-future cleanup (producer-side).
- [ ] Version pinning bumped to `2.4.1` in all of:
      `plugins/crews/.claude-plugin/plugin.json`,
      `plugins/crews/.github/plugin/plugin.json`,
      `plugins/crews/CLAUDE.md`,
      `plugins/crews/tests/version.test.js` (if it pins).
- [ ] `plugins/crews/CHANGELOG.md` has a new `## 2.4.1 - <date>` entry naming
      the file/line removed and citing `envelope.js:192` as the anticipated
      cleanup site.
- [ ] `node tests/run.js` from `plugins/crews/` exits 0 under the v2.4.0
      default of `CREWS_STRICT_SCHEMA=1`.
- [ ] Typecheck passes (`node --check` on every edited `.js`).

**Dependencies:** None
**Estimated complexity:** small
