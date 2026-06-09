# Phase-4 plan review: crews review-mail OVERVIEW/SUMMARY header

Single-lens review (rubber-duck design critique) run BEFORE finalizing the plan,
since the design hinged on several open questions. All findings were resolved into
the plan; nothing is left open. Recorded here so the operator's plan review can see
what was challenged and how it was settled.

## Findings & resolutions

| # | Severity | Finding | Resolution in plan |
|---|---|---|---|
| F-1 | High | Computing buckets from the lossy `{seq,sender,kind,summary}` record could hide known review-required kinds (`member-reply`, `operator-direct`, `escalate-to-operator`, `member-crashed`) and `null`-kind direct sends in a catch-all `other`. | `counts` is now a **lossless per-literal-kind map** (no `other`); `null`→`direct`; every kind appears under its own key. Codified in §3(c)/AC5 + bucket-coverage test. |
| F-2 | High | If overview computation throws after `consumeMailbox`, the listener could drain mail but fail to emit the wake envelope. | Listener enrichment is **fail-open** (try/catch after consume), counts-only, env-gated, and isolated in US-004 (independently deferrable). §3(b)/AC4 + a malformed-message fail-open test. |
| F-3 | Med | Computing over post-collapse `entries` makes counts *display* counts, undercounting originals when identical rows collapse. | `totalEntries`/`counts` weight by `collapsedCount||1` (original totals); `shownRows` = display rows; `collapsedCount` carried into actionable items. §3(c)/AC6 + collapsedCount test. (Confirmed: kind is part of the collapse key, so a trailing `done` can NEVER merge into a `progress` run — `lib/collapse-key.js:84-91`.) |
| F-4 | Med | `/wake` emits a bare array pinned by `tests/wake-explicit-only.test.js`; wrapping is a compat break. | `/wake` gated by the same `CREWS_REVIEW_MAIL_OVERVIEW=off` ⇒ byte-identical bare array; test updated to assert both branches. US-003/AC3. |
| F-5 | Med | `replyRequired = kind==='question'` too narrow — `blocked` should escalate; direct/operator kinds also expect action. | Renamed to **`needsAction`**; predicate = `NEEDS_ACTION_KINDS` (question/blocked/direct/operator-direct/operator-direct-summary/escalate-to-operator/member-crashed). `done`/`member-reply` stay actionable-to-show but `needsAction:false`. §3(c)/AC5. |
| F-6 | Suggestion | Add an `overview.headline` STRING as the first field for grep/5-line head-reads (but NOT a non-JSON banner). | Adopted: `headline` is the first field inside `overview`, a JSON string value (machine-read preserved). §3(c). |
| F-7 | Suggestion | A flat first-50 cap can still hide a trailing terminal if >50 non-progress entries. | Cap = 100; on overflow include first `cap-1` PLUS the **last** actionable entry; `truncatedActionable:true`; `actionableCount` = true count. §3(c)/truncation test. |
| F-8 | Suggestion | Env opt-out is the right escape hatch; a `--no-overview` flag is unnecessary unless automation needs it. | Confirmed env-only opt-out (mirrors collapse precedent); no CLI flag. §3(a). |

## Open-question dispositions (final)

- (a) flag vs default → **default-on + `CREWS_REVIEW_MAIL_OVERVIEW=off`** byte-identical opt-out.
- (b) listener envelope → **enrich additively, fail-open, counts-only** (US-004, deferrable).
- (c) field set → `headline, totalEntries, shownRows, senders, counts(lossless), actionableCount, needsActionCount, truncatedActionable, actionable[]`.
- (d) robustness → computed over the FULL entries, actionable filtered independently of detail order, placed FIRST; trailing-done can't collapse. Dedicated regression test.
- (e) JSON vs human → **JSON-only** (structured overview + `headline` string); no prose mode.

## Residual risks accepted (see plan §8)

R1 listener delivery regression (mitigated by fail-open + US-004 isolation + the
`messages===undefined` guard), R2 top-level shape break (mitigated by env-off
byte-identical + tests), R3 `/wake` compat (env-off byte-identical), R4 future kind
drift (lossless counts always show new kinds; actionable classification fails safe
toward surfacing).

## Verdict

Design is sound and concrete. No High findings remain open. Ready for operator
review; on approval, `/implement-with-ralph --from-plan` against this plan.
