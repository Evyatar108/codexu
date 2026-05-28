# Crews summary-attribute drop — investigation

**Status:** root cause identified, single load-bearing bug.
**Scope:** investigation only (no plugin code modified).
**Plugin source:** `D:/ai-developer-toolkit/plugins/crews/` at `origin/main` `c183326a` (verified 2026-05-28).
**Reporter:** member `investigate-crews-summary-drop` (crew `ralph-pipeline`).

---

## 1. Reproduction (with direct evidence)

The bug is **not** a parser bug. The parser captured the summary correctly. The bug is a
**rendering-side field-path mismatch** between the system envelope written by
`hooks/stop.js` and the field read by `hooks/commands/review-mail.js::formatReviewMailEntry`.

### Direct evidence from the failing run

Member outbox row (member captured the summary correctly):

> `D:/harness-efforts/codexu/.crews/crews/ralph-pipeline/members/impl-ralph-overview-watcher-consumer-workspace-root/outbox.jsonl` seq=4
> ```
> {"seq":4,"kind":"question",
>  "summary":"Phase 5a/5b both converged CLEAN per your Option (A) Split + ship authorization. ... Topic HEAD=6f81ce4f.",
>  "message":"Adding the ack for the prior operator authorization message.",
>  "replyTo":"0c69c7f0-9c01-40ef-b9ff-3df0b5277efd",
>  "id":"5c61cbdc-33c4-4f69-9dd0-f36e0d11d3e5", ...}
> ```

Lead inbox-history row that the bookkeeper reviewed (summary lives **inside `payload`**):

> `D:/harness-efforts/codexu/.crews/crews/ralph-pipeline/leads/overview-bookkeeper/mailbox-history.jsonl` (envelope id `2fe4f644-ebfe-4bbd-af94-acd29075b7b6`)
> ```
> {"kind":"question",
>  "message":"impl-... replied (kind=question, summary=\"Phase 5a/5b ... HEAD=6f81ce4f.\")",
>  "payload":{"memberName":"impl-...","outboxSeq":4,
>    "outboxId":"5c61cbdc-...","replyToId":"0c69c7f0-...",
>    "summary":"Phase 5a/5b ... HEAD=6f81ce4f.","kind":"question"},
>  "id":"2fe4f644-...","seq":169, ...}
> ```

Note: there is **no top-level `summary` key** on this row. It only exists at `payload.summary`.

### The mismatched read

`D:/ai-developer-toolkit/plugins/crews/hooks/commands/review-mail.js:111`:
```js
summary: row && row.summary !== undefined ? row.summary : null,
```

`row` here is the inbox-history row above. `row.summary` is `undefined` → the formatter
returns `summary: null`. Body is then fetched from the member outbox via
`resolveBodyFromOutbox` (`hooks/resolve-body.js:18-45`), which returns `match.message` —
the short prose "Adding the ack for the prior operator authorization message." — exactly
matching the observed `body`/`excerpt` in the operator's report.

### Minimal repro

1. Spawn any member; have lead `/send-to-member <name> "ping"` to set a reply-to id.
2. Member ends the turn with `<|report kind="question" reply-to="<that-id>" summary="long text"|>`
   above any short prose.
3. Lead runs `node tools/crews.js review-mail <leadName> --crew <crew> --cwd <repo>` or
   `/crews:review-mail`.

**Expected:** entry's `summary` field equals "long text".
**Actual:** entry's `summary` is `null`; `body` is the prose (not the summary).

This reproduces on every `kind` in {`done`, `question`, `blocked`} reply because all of them
funnel through the `member-reply` system envelope path in `stop.js:831-842`. Proactive
`done`/`blocked`/`question` reports (no reply-to) hit the parallel
`proactive-report` envelope at `stop.js:878-882` and have the **same** payload-nesting bug.

---

## 2. Hypothesis verdict table

| ID  | Hypothesis | Verdict | Evidence (file:line) |
|-----|------------|---------|----------------------|
| H1  | Stop hook parser silently drops summary >N chars | **Refuted** | `mailbox.js:756` regex is `/\bsummary\s*=\s*"([^"]*)"/i` — no length cap. Member outbox row stores the full ~600-char summary (`outbox.jsonl` seq=4). |
| H2  | Summary attribute regex breaks on internal `"` / commas / apostrophes | **Refuted** | Same regex; `[^"]*` accepts apostrophes/commas/parentheses freely. Observed summary contains zero `"`. Outbox proves it parsed. |
| H3  | Body-vs-summary precedence: prose body silently drops summary attribute | **Refuted at member side, but the *adjacent* truth is the actual bug.** `stop.js:778` builds `effectiveSummary = tags.summary \|\| synthesizeSummary(tags.body) \|\| null` and `stop.js:783-787` writes both `summary` and `message` to the member outbox — no precedence collision. The drop happens **later**, in the lead-notification envelope (H7 below). |
| H4  | Manifest `lastSummary` size limit truncates → null in envelope | **Refuted** | `stop.js:807` writes `lastSummary: effectiveSummary` with no truncation. Member's `manifest.lastSummary` is independent of the envelope `summary` field; the lead's inbox-history row is the failing surface, not the member manifest. |
| H5  | Stop hook re-runs and overwrites with stub | **Refuted** | The member outbox shows a single seq=4 entry with the full summary. No `note:"empty-body-on-retry"` row exists in the outbox tail. The empty-body retry path at `stop.js:686-708` was not taken. |
| H6  | `kind=question + reply-to` takes a different code path | **Partial** | All terminal kinds with addressable replies go through `appendSystemMailbox` at `stop.js:831-842`. The path is shared between `question`/`done`/`blocked`, so the bug isn't `question`-specific — but H6's intuition is correct that the **system-envelope path** is what loses the summary on the *display* side. |
| H7 (new) | `appendSystemMailbox` nests `summary` inside `payload`; `review-mail.formatReviewMailEntry` reads top-level `row.summary` | **Confirmed — root cause** | `stop.js:831-842` (member-reply) and `stop.js:858-882` (proactive-report) both pass envelopes shaped `{kind, message, payload:{...summary, kind, ...}}`. No top-level `summary` field is set. Lead inbox-history confirms `payload.summary` populated, top-level missing. `review-mail.js:111` reads `row.summary` → `undefined` → `null`. |

---

## 3. Root cause (one load-bearing claim)

**`hooks/commands/review-mail.js:111` reads `row.summary` (top-level) for every inbox-history
row, but member-reply and proactive-report system envelopes — emitted by
`hooks/stop.js:831-842` and `hooks/stop.js:858-882` respectively — only populate
`payload.summary` and never copy it to the top-level envelope key.** Result: any non-direct
(system-routed) member envelope returns `summary: null` from `/crews:review-mail`, regardless of
what the parser captured, regardless of summary length, and regardless of which valid `kind`
the member used.

This is a long-standing rendering bug — likely present since v1.0.2 (commit `bfa6dfae`
"crews 1.0.2 — member→lead notification on outbox reply") which introduced the
member-reply notification path. Direct sends (`/send-to-member`, `/send-to-lead`) flow
through `appendMailboxWithSender` (`hooks/mailbox.js:422-455`) and store summary at the
envelope top level, which is why operators have not seen this on lead-originated mail.

Why it surfaced only now: the operator paid close attention to a single high-stakes
push-authorization question, and noticed the very long, deliberately-crafted summary was
missing from `review-mail` output. Prior `progress` envelopes were filtered out by
`CREWS_REVIEW_KINDS` (`hooks/commands/review-mail.js:163` → `reviewKindsFromEnv()` defaults
to `done,question,blocked` per v1.6.0 CHANGELOG), so older summary drops on `progress`
weren't visible either.

The test that should have caught this is `tests/review-mail-command.test.js:31-41` —
its `row()` fixture hand-crafts `summary` at the **top level**, which never exercises the
production path where `appendSystemMailbox` would have nested it under `payload`. The
related test `tests/member-reply-notify.test.js:88` only asserts `note.payload.summary`,
not `note.summary` — so the gap is consistent across both fixtures.

---

## 4. Recommended fix sketch (no code written)

**Single-line fix:** in `hooks/commands/review-mail.js::formatReviewMailEntry`
(line 111), change `summary` to prefer `row.summary` and fall back to
`row.payload && row.payload.summary` before defaulting to `null`. This preserves backward
compatibility with direct-send envelopes (`/send-to-member`) that store summary at the top
level, and handles system-routed envelopes (member-reply, proactive-report, thread-fanout
that ever surfaced summary) by reaching one level into payload.

**Defense-in-depth alternative:** have `hooks/stop.js` lift `summary` to a top-level
envelope key in addition to keeping it in payload at both `appendSystemMailbox` call
sites (`stop.js:831-842` and `stop.js:858-882`). This makes the envelope schema uniform
across direct and system routing and removes the read-path special case. The two changes
are not mutually exclusive — applying both leaves the reader resilient against future
producers that nest only inside payload.

**Test additions needed:** extend `tests/review-mail-command.test.js` with a fixture that
seeds an inbox-history row shaped like the production member-reply envelope (no top-level
`summary`, populated `payload.summary`) and assert the returned entry has
`summary === payload.summary`. Add a corresponding assertion to
`tests/member-reply-notify.test.js:88` that the surfaced envelope (after passing through
`formatReviewMailEntry`) returns the summary.

No envelope-schema migration is required; no field is being renamed. The fix is backward-
compatible with all historical inbox-history.jsonl entries.

---

## 5. Suggested follow-up bookkeeper tasks

### Task A — `crews-review-mail-summary-payload-fallback`
- **Scope:** `D:/ai-developer-toolkit/plugins/crews/`
- **Phase to start at:** `planning` (concrete fix; no fuzzy direction to brainstorm)
- **Description:** Apply the single-line read-path fix in `review-mail.js:111` and add the
  two regression tests described in §4. Bump crews patch version
  (current `v1.7.2` → `v1.7.3`), CHANGELOG entry, marketplace.json update.
- **Acceptance criteria:**
  - `formatReviewMailEntry` returns `summary === payload.summary` for an inbox-history
    row with only nested summary. Regression test added.
  - `tests/member-reply-notify.test.js` asserts the formatter-surfaced summary, not just
    the raw envelope payload.
  - CHANGELOG entry under `v1.7.3` cites the failing scenario.
  - `npm test` green; manual repro from §1 returns the long summary.

### Task B — `crews-system-envelope-summary-top-level`
- **Scope:** `D:/ai-developer-toolkit/plugins/crews/`
- **Phase to start at:** `planning` (decision is whether to lift summary to top-level on
  the write side as defense-in-depth; concrete edit either way)
- **Description:** Mirror `effectiveSummary` to the top-level envelope key at the two
  `appendSystemMailbox` call sites in `stop.js` (member-reply at line 831-842; proactive-
  report at line 878-882). Keep the `payload.summary` for back-compat with any consumer
  that may already be reading from there. Update goldens.
- **Acceptance criteria:**
  - `appendSystemMailbox` envelopes for `member-reply` and `proactive-report` carry both
    `summary` and `payload.summary`.
  - Existing tests still pass; one new test asserts top-level summary on the system
    envelope.

### Task C — `crews-summary-rendering-audit`
- **Scope:** `D:/ai-developer-toolkit/plugins/crews/`
- **Phase to start at:** `brainstorm` (need to scope which downstream consumers read
  `summary` — `/list-members` view, `format-progress-tail.js`, briefing renderer,
  `formatOutboxEntries`, etc.)
- **Description:** Audit every consumer that surfaces an envelope `summary` field and
  document which ones read top-level vs payload. Catalog any other similar drift where a
  field exists in one shape on outbox.jsonl and a different shape on inbox-history.jsonl.
- **Acceptance criteria:**
  - Markdown audit doc enumerates each `summary` read site with file:line and the path it
    reads.
  - Identifies any other field with the same producer/consumer drift (candidates: `kind`,
    `replyTo`, `progressTail`).
  - Outcome is either "no other drift" or a list of follow-up tasks.

---

**Word count:** ~1400 (within 1500-word cap).
