# Stories Outline: Fix crews lead reply-to asymmetry (consumed-inbox-envelope ids)

*Preliminary decomposition from `/plan-with-ralph`. Feed to `/implement-with-ralph --from-plan` for PRD generation.*

## US-001: Extend the lead branch of `resolveReplySource` to resolve consumed inbox-history
**Description:** As a crews lead, I want `reply-to=<envelope-id>` (on a Stop `<|report|>` tag or via
`send-to-member --reply-to`) to resolve the same mailbox-envelope id that `review-mail` surfaces as
the actionable ack/reply id, so that `reply-to` and `ack` are consistent and my turn is not blocked
by `ReplyToNotFoundError`.

**Acceptance Criteria:**
- [ ] AC1 — Lead `resolveReplySource` with a consumed inbox-history id returns that row (no throw);
      `node --check hooks/mailbox.js` passes. (Extend the lead branch of `resolveReplySource` in
      `hooks/mailbox.js` to read `getInboxHistoryPath(sender.name, sender.crew, cwd)` + `findMessageById`
      AFTER the send-history and member-outbox misses, before the final `throw`.)
- [ ] AC2 — Lead Stop `<|report ... reply-to="<proactive-report-envelope-id>"|>` does NOT throw / NOT
      block; outbox row persists `replyTo` + `hops === sourceHops + 1`; and NO `decision:"replied"`
      mailbox-decision row is written (proactive-reports are STRICT-ACK auto-exempt — assert the
      absence).
- [ ] AC2b — Lead Stop `<|report ... reply-to="<id>"|>` for a NON-exempt consumed `kind="direct"`
      message: no throw, a `decision:"replied"` row IS written, outbox row persists `replyTo`/`hops`.
- [ ] AC3 — Lead direct send `appendMailbox(..., { replyTo: <consumed-inbox-id> })` (the
      `/send-to-member --reply-to` path) succeeds and stamps the delivered envelope `replyTo` +
      derived `hops` (no `ReplyToNotFoundError`).
- [ ] AC4 — `resolveReplySource` still throws `ReplyToNotFoundError` for an id in NONE of
      send-history / member-outboxes / inbox-history (fail-loud preserved).
- [ ] AC5 — The `member-question-request` carve-out is unchanged (lead reply-to referencing such a
      system envelope still writes a NULL outbox-row `replyTo`).
- [ ] AC6 — The `member` branch of `resolveReplySource` is behaviorally unchanged (existing
      `tests/reply-to.test.js` + member-reply tests stay green).
- [ ] New `tests/lead-reply-to-consumed-inbox.test.js` covers AC1, AC2, AC2b, AC3, AC4, AC5 (patterns
      from `tests/reply-to.test.js`, `tests/force-response-replyTo-passes.test.js`,
      `tests/force-response-strict-ack-block.test.js`, `tests/proactive-report-notify.test.js`;
      harness `tests/lib/force-response.js`).
- [ ] AC8 — Full crews suite (`node plugins/crews/tests/run.js`) passes from a clean env.
- [ ] Typecheck passes (`node --check` on changed JS).
**Dependencies:** None
**Estimated complexity:** small

## US-002: Version bump + CHANGELOG + AGENTS.md note
**Description:** As a crews maintainer, I want the standard 6-stamp version bump + CHANGELOG + AGENTS.md
documentation for the lead inbox-history reply-to resolution change, so consumers pick it up and the
behavior is documented for future agents.

**Acceptance Criteria:**
- [ ] AC7 — `node plugins/crews/scripts/bump-version.js <x.y.z>` bumps the 3 plugin manifests + 3
      marketplace indexes; `node plugins/crews/tests/version.test.js` green. (Recommended `<x.y.z>` =
      `3.13.0` — minor, since it adds a lead-side resolution capability.)
- [ ] CHANGELOG.md prepended with `## <x.y.z> - 2026-06-07` describing the lead inbox-history reply-to
      resolution, the preserved `member-question-request` carve-out, and the gotchas.
- [ ] AGENTS.md gains a short section documenting the new lead resolution path + "don't write a
      decision row for ack-exempt proactive-reports" + "keep the carve-out" gotchas.
- [ ] Typecheck passes on any changed JS.
**Dependencies:** US-001
**Estimated complexity:** small
