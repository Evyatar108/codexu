# Stories outline: crews review-mail OVERVIEW/SUMMARY header

Target: `ai-developer-toolkit/plugins/crews/`. 5 stories. US-002/003/004 depend
only on US-001; US-005 depends on all code stories. US-004 (listener) is
independently deferrable without affecting the primary fix (US-001..US-003).

---

## US-001 — Pure `review-kind-summary` helper

**As** the crews review surfaces, **I want** a single pure module that computes a
batch overview + per-kind records, **so that** review-mail, `/wake`, and the
listener share one lossless, tested classification.

Create `lib/review-kind-summary.js` (pure, no IO; NOT re-exported via
`hooks/config.js` — leaf module like `lib/collapse-*.js`).

Exports:
- `NON_ACTIONABLE_KINDS` = Set{`progress`, `thread-fanout`, `thread-notification`,
  `member-joined`, `member-left`}.
- `NEEDS_ACTION_KINDS` = Set{`question`, `blocked`, `direct`, `operator-direct`,
  `operator-direct-summary`, `escalate-to-operator`, `member-crashed`}.
- `OVERVIEW_ACTIONABLE_CAP` = 100.
- `parseOverviewEnv(env = process.env)` → `{ enabled }` (disabled iff
  `CREWS_REVIEW_MAIL_OVERVIEW` trim/lowercases to `off`).
- `computeReviewKindSummary(records, opts?)` → the `overview` object
  (`headline, totalEntries, shownRows, senders, counts, actionableCount,
  needsActionCount, truncatedActionable, actionable[]`). `records` =
  `[{seq, sender, kind, summary, inboxSeq?, collapsedCount?}]`. Null kind ⇒
  `direct`; null summary ⇒ `''`. counts/totalEntries weight by
  `collapsedCount||1`. actionable filtered by `NON_ACTIONABLE_KINDS`, seq-ordered,
  capped per the §3(c) truncation rule (keep last actionable on overflow).
- `expandMessagesToKindRecords(messages)` → flattens raw consumed envelopes into
  records, expanding proactive `payload.entries[]` (report kind+seq each).

**Acceptance:** AC1. Tests in `tests/review-kind-summary.test.js` cover the
21-progress+1-done regression, full bucket coverage (incl. null→direct + operator/
escalate/member-crashed/member-reply), needsAction predicate, collapsedCount
weighting, truncation-keeps-last, headline shape, expandMessagesToKindRecords
(proactive + non-batch), and parseOverviewEnv.

**Files:** CREATE `lib/review-kind-summary.js`, `tests/review-kind-summary.test.js`.

---

## US-002 — review-mail overview header (default-on, env opt-out)

**As** a lead reading saved review-mail JSON, **I want** the overview at the TOP,
**so that** a head-only read never misses a buried terminal report.

In `hooks/commands/review-mail.js handler()`: after `entries` is built, compute
`const overview = parseOverviewEnv().enabled ? computeReviewKindSummary(entries) :
null;` and return it. `formatSuccess` emits
`{name, crew, overview, entries, cursor, warning}` with `overview` BEFORE `entries`
when present; when null (env-off) the key is ABSENT (byte-identical pre-feature
top-level shape). No change to cursor-advance, collapse, `--since`/`--peek`, or
entry shape. (review-mail passes its already-formatted `entries` — overview always
matches the displayed rows; `collapsedCount` on collapsed heads flows through.)

**Acceptance:** AC2, AC3 (review-mail surface), AC5, AC6. Tests in
`tests/review-mail-command.test.js`: default includes `overview` first;
21-progress+1-done end-to-end (slice first 25 lines of output, assert `done`
present); collapse on/off both surface the done; `CREWS_REVIEW_MAIL_OVERVIEW=off`
⇒ no `overview` key + byte-identical; cursor unchanged.

**Files:** MODIFY `hooks/commands/review-mail.js`, `tests/review-mail-command.test.js`.

---

## US-003 — `/wake` delivery overview wrapper

**As** a lead receiving a `/wake` drain, **I want** the same top overview, **so
that** wake deliveries get the same head-read safety.

In `hooks/user-prompt-submit.js` `/wake` path (~L77-78): when
`parseOverviewEnv().enabled`, build `body = JSON.stringify({ overview, entries },
null, 2)` (overview from `computeReviewKindSummary(entries)` over the same formatted
rows); when disabled, emit the bare array exactly as today. No change to the
explicit-command gate, drain, or `markReviewed` semantics.

**Acceptance:** AC3 (`/wake` surface). Tests in `tests/wake-explicit-only.test.js`:
default body = `{overview, entries}`; `=off` ⇒ bare array byte-identical;
explicit-only/drain semantics unchanged.

**Files:** MODIFY `hooks/user-prompt-submit.js`, `tests/wake-explicit-only.test.js`.

---

## US-004 — Listener wake envelope kind enrichment (fail-open, counts-only) — *independently deferrable*

**As** a lead reading the one-line listener wake, **I want** a per-kind +
actionable count, **so that** the wake itself flags a buried actionable item.

In `lib/listener-loop.js deliver()`: when `parseOverviewEnv().enabled`, wrap in
try/catch — `const recs = expandMessagesToKindRecords(messages); const s =
computeReviewKindSummary(recs);` then add `kinds: s.counts` + `actionableCount:
s.actionableCount` to the `finish({type:'messages',...})` envelope. **Never** add
bodies/summaries (preserve `tests/listener.test.js:22` `messages===undefined`).
Fail-open: any throw omits both fields; `consumeMailbox`/`markExited`/`finish` run
regardless. Env-off ⇒ minimal envelope unchanged.

**Acceptance:** AC4. Tests in `tests/listener.test.js`: envelope carries `kinds` +
`actionableCount`; `messages===undefined` still asserted; proactive batch shows
expanded counts; malformed-message fail-open still delivers `{type,count}`; `=off`
⇒ minimal envelope.

**Files:** MODIFY `lib/listener-loop.js`, `tests/listener.test.js`.

---

## US-005 — Version bump, CHANGELOG, AGENTS.md, marketplace sync

**As** a marketplace consumer, **I want** the version + indexes bumped, **so that**
`copilot/codex plugin update` picks up the new crews.

Run `node plugins/crews/scripts/bump-version.js 3.19.0` (updates 3 plugin
manifests + 3 marketplace indexes + `tests/version.test.js`). Prepend `## 3.19.0`
to `CHANGELOG.md` and a `## v3.19.0 review-mail overview header` section to
`AGENTS.md` (edit sites, the `CREWS_REVIEW_MAIL_OVERVIEW=off` knob, the
`messages===undefined` + byte-identical invariants, the lossless-counts +
fail-open gotchas).

**Acceptance:** AC7, AC8. `node tests/version.test.js` green; full `node
tests/run.js` green; `node --check` clean on all changed `.js`.

**Files:** MODIFY (script) the 6 stamps + `tests/version.test.js`; MODIFY
`CHANGELOG.md`, `AGENTS.md`.

---

## Dependency graph

```
US-001 ──┬─► US-002 ──┐
         ├─► US-003 ──┤
         └─► US-004 ──┤   (US-004 deferrable)
                      └─► US-005 (after all code lands)
```
