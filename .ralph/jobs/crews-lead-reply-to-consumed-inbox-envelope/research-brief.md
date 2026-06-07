# Research Brief: crews lead reply-to asymmetry

## Researcher Findings (Explore agent + direct source reading)
- `resolveReplySource` lead branch (`hooks/mailbox.js:358-376`) searches `getSendHistoryPath` +
  `memberOutboxRowsIncludingLeftAt` only; member branch searches `getInboxHistoryPath`. Lead never
  searches its own consumed inbox-history → `ReplyToNotFoundError` on a consumed envelope id.
- Both call sites funnel through it: `appendMailboxWithSender` (`:446`, direct `/send-to-member
  --reply-to`) and `buildOutboxEntry`→`appendOutboxBatch` (`:715`, Stop `<|report reply-to|>`; throw
  caught at `stop.js:1356-1362` → `{decision:'block'}`).
- `consumeMailbox` writes inbox-history rows spreading the full envelope (`:682`), so rows carry
  `id` + `hops`; an inbox-resolved source yields correct `findMessageById` + `deriveHops` (`:378-383`,
  `source.hops + 1`).
- Turn-resolution (`evaluateConsumedResolutions`, `stop.js:288-312`, `:1058`) uses the IN-TAG
  reply-to, independent of `resolveReplySource`. So the only failure is the durable outbox write
  throwing; resolution itself already works.
- `member-question-request` carve-out (`stop.js:314-323`, `:1316-1318`) nulls `effectiveReplyTo` for
  the lead BEFORE `buildOutboxEntry`, which is why those ids don't throw today. Regular
  proactive-reports (`from.role:'member'`, `routingKind:'proactive-report'`) are not carved out.
- Lead per-row reply routing does NOT exist — the `member-reply` block (`stop.js:1431-1457`) and the
  proactive-report block (`:1459-1505`) are both gated `state.role === 'member'`. So a lead's
  outbox-row `replyTo` has no downstream `findActorBySendHistoryId` consumer.
- `review-mail` (`hooks/commands/review-mail.js:103-122`, `:153-165`) surfaces the mailbox-envelope
  `id` as the actionable ack/reply id; `outboxId`/`reportId`/`outboxSeq` are member outbox refs.
- Version surface: `scripts/bump-version.js` bumps 3 plugin manifests + 3 marketplace indexes +
  `tests/version.test.js`; CHANGELOG (`plugins/crews/CHANGELOG.md`) is manual, `## <version> - YYYY-MM-DD`.
- Test patterns: `tests/reply-to.test.js` (resolveReplySource basics), `tests/force-response-*.test.js`
  (Stop reply-to/ack/strict-ack), `tests/proactive-report-notify.test.js`, `tests/member-reply-notify.test.js`,
  `tests/strict-ack-review-mail.test.js`, `tests/decision-replyTo-implies-replied.test.js`,
  `tests/review-mail-command.test.js`; Stop harness `tests/lib/force-response.js`; scenario helpers
  `tests/integration/lib/scenario.js`.

## Architect Analysis
Skipped (focused single-function fix; architecture covered above).

## Codex Research
Not run — codex lens treated UNAVAILABLE per spawn instructions (known codex-exec hang on this box).

## Copilot Research
Corroborated all findings independently. Recommends Option A (extend lead branch with
`getInboxHistoryPath` lookup), preserve the `member-question-request` carve-out, do NOT broaden
suppression for ordinary proactive reports (lead outbox `replyTo=<consumed-id>` becomes resolvable +
useful audit metadata). Confirmed Option B fights the `review-mail` output shape. Confirmed version
command + CHANGELOG-manual. Suggested regression test via `createScenario()` /
`tests/lib/force-response.js`: member proactive kind=question → lead consumes → review-mail surfaces
`entries[0].id` → lead Stop `<|report reply-to="<id>"|>` → assert no block + `decision:"replied"`.

## Consolidated File List
- Files to modify: `hooks/mailbox.js` (resolveReplySource lead branch).
- Tests: NEW `tests/lead-reply-to-consumed-inbox.test.js`; patterns from `tests/reply-to.test.js`,
  `tests/force-response-replyTo-passes.test.js`, `tests/force-response-strict-ack-block.test.js`,
  `tests/proactive-report-notify.test.js`, harness `tests/lib/force-response.js`, scenario
  `tests/integration/lib/scenario.js`.
- Version bump: `.claude-plugin/plugin.json`, `.github/plugin/plugin.json`, `.codex-plugin/plugin.json`
  (all under `plugins/crews/`), repo-root `.claude-plugin/marketplace.json`,
  `.github/plugin/marketplace.json`, `.agents/plugins/marketplace.json`,
  `plugins/crews/tests/version.test.js`.
- Docs: `plugins/crews/CHANGELOG.md`, `plugins/crews/AGENTS.md`.
- Reference (read-only, no change): `hooks/stop.js`, `hooks/errors.js`, `hooks/commands/review-mail.js`.
