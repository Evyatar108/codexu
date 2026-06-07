# Stories Outline: crews Listener Delivery Observability Logging

*Preliminary decomposition from `/plan-with-ralph`. Feed to `/implement-with-ralph --from-plan` for PRD generation.*

*Target repo: the `ai-developer-toolkit` submodule (`ai-developer-toolkit/plugins/crews`), crews
v3.10.0 → v3.11.0. All `node` commands run from cwd `ai-developer-toolkit/plugins/crews` unless a
different cwd is named. Impl happens in a worktree inside that submodule (two-commit submodule-first
flow); the codexu active-plugin-versions table + submodule pointer bump are lead-owned ship steps.*

## US-001: Listener-loop delivery/timeout line enrichment + `computeOldestMsgAgeMs`
**Description:** As an operator, I want the `listener delivered` and `listener timeout` lines in
`crews.log` to carry `timeoutMs`, `armedAtAgeMs`, and (on `via=initial`) `oldestMsgAgeMs`, so I can
see how long a listener had been armed and how long a delivered message had been waiting, without
hand-correlating timestamps.
**Acceptance Criteria:**
- [ ] `lib/listener-loop.js` adds a pure exported `computeOldestMsgAgeMs(messages, now)` returning
  `now - min(parseable sentAt)`, or `null` when input is empty / no `sentAt` parses (drops `NaN`).
- [ ] `deliver(reason)` delivered line gains `timeoutMs=<ms|null>` + `armedAtAgeMs=<Date.now()-start>`
  on every delivery, plus `oldestMsgAgeMs=<ms>` only when `reason === 'initial'` and the value is
  non-null. Uses loop-local `start` (NOT manifest `lastListenerSpawnAt`, which is heartbeat-refreshed).
- [ ] `bail(reason)` timeout line gains `timeoutMs=<ms|null>` + `armedAtAgeMs=<Date.now()-start>`
  (existing `waitedMs` unchanged).
- [ ] The listener stdout envelopes (`{type:"messages"}` / `{type:"timeout"}`) gain no new keys and
  lose none; no message body added.
- [ ] `node --check lib/listener-loop.js` passes.
**Dependencies:** None
**Estimated complexity:** small

## US-002: Mailbox `mail-queued-no-listener` line + `isQueuedWhileUnarmed`
**Description:** As an operator, I want a `mail-queued-no-listener` line appended to `crews.log`
whenever a message is queued to a recipient that has no live armed listener, so I can immediately
see mail that will sit until the next arm.
**Acceptance Criteria:**
- [ ] `hooks/mailbox.js` adds a small exported `isQueuedWhileUnarmed(manifest)` =
  `deriveListenerState(manifest) !== 'armed'` (lazy `require('./actor-state')` for the cycle).
- [ ] At the `appendMailboxWithSender` chokepoint, after the successful `writeJsonAtomic`, when
  `isQueuedWhileUnarmed(manifest)` is true, emit
  `mail-queued-no-listener name=<recipient> crew=<crew> kind=<kind>` via `appendLog`, where
  `kind = envelope.kind || opts.kind || sender.routingKind || 'message'`.
- [ ] The new `appendLog(...)` call is wrapped in its own local `try/catch` so a logging failure
  cannot fail the mailbox append (no-behavior-change guarantee).
- [ ] Covers `appendMailbox`, `appendSystemMailbox`, and `appendOperatorMailbox` (all route through
  the chokepoint) — no per-entry-point duplication.
- [ ] `node --check hooks/mailbox.js` passes.
**Dependencies:** None (disjoint file from US-001)
**Estimated complexity:** small

## US-003: Tests — helpers + listener-loop log fields + queued-while-unarmed e2e + failure seam
**Description:** As a maintainer, I want deterministic tests so an implementer cannot silently omit
any of the new fields/lines.
**Acceptance Criteria:**
- [ ] New `tests/listener-delivery-observability.test.js`.
- [ ] Unit tests for `computeOldestMsgAgeMs` (oldest-wins, NaN-skip, null on empty/unparseable) and
  `isQueuedWhileUnarmed` (armed→false incl. legacy-timestamp-only; never-armed/exited/recoverable/
  null/stale-armed→true; stale-armed exercised via heartbeat-staleness).
- [ ] Deterministic listener-loop tests (subprocess or injected-IO, mirroring `listener.test.js` /
  `dispatcher-arm-listener.test.js`): an `initial` delivery asserts the new delivered fields in
  `crews.log`; an explicit timeout asserts the new timeout fields; stdout key-set unchanged
  (tolerate optional `sessionId`).
- [ ] Queued-while-unarmed e2e (mirroring `consume-mailbox-epoch-fence.test.js`): logged for an
  unarmed recipient, NOT for an armed one, across `appendMailbox`/`appendSystemMailbox`/
  `appendOperatorMailbox` (or a source assertion the line is only inside `appendMailboxWithSender`).
- [ ] Source assertion that the new append-path `appendLog` call is inside a local `try/catch`.
- [ ] Full suite `node tests/run.js` passes.
**Dependencies:** US-001, US-002
**Estimated complexity:** medium

## US-004: Version bump 3.10.0→3.11.0 + CHANGELOG + AGENTS.md (member-owned, in submodule)
**Description:** As a consumer, I want the crews version bumped and documented so the new
observability lines ship and are discoverable.
**Acceptance Criteria:**
- [ ] `node plugins/crews/scripts/bump-version.js 3.11.0` (from cwd `ai-developer-toolkit`) stamps
  all 6 files (3 plugin manifests + 3 marketplace indexes); `node plugins/crews/tests/version.test.js`
  passes.
- [ ] `plugins/crews/CHANGELOG.md` gains a `## 3.11.0` entry; `plugins/crews/AGENTS.md` gains a
  `## v3.11.0` section (3 log lines, 2 helpers, observability-only non-goals).
- [ ] The stale crews `AGENTS.md` "Version layout" section is corrected to 6 files (adds
  `.codex-plugin/plugin.json`).
- [ ] Full suite `node tests/run.js` re-run as the final gate after the bump + docs edits.
- [ ] (Lead-owned ship step, NOT this member's commit) codexu `AGENTS.md` active-plugin-versions
  table crews 3.10.0→3.11.0 + `ai-developer-toolkit` submodule pointer bump in a separate codexu
  commit.
**Dependencies:** US-001, US-002, US-003
**Estimated complexity:** small
