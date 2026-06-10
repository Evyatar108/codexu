# Research Brief: crews-proactive-done-silent-miss-regression

Target: `ai-developer-toolkit/plugins/crews/` (submodule), crews **v3.19.0** on submodule main (`44375454`).

## The bug (a REGRESSION)

A crews proactive-batch **terminal** report (`kind=done|question|blocked`) routed to
the lead is consumed-and-cursor-advanced such that the lead's subsequent
`/crews:review-mail` returns `{entries:[], advanced:false, lastReviewedSeq:501}` and the
lead **silently misses** the report. Repro (2026-06-08, crews 3.14.1): member
`bs-serverless` wrote `kind=done` id `5124e752` at 20:43:58.321Z; the lead listener
delivered count:1 via watch; the lead `mailbox-history` seq 501 = `kind=done` with
`consumedAt=20:43:58.536Z` + message `"bs-serverless done (proactive batch, 6 reports)"`;
the lead's subsequent `review-mail` returned empty. Content survived only in
`mailbox-history.jsonl` / `read-member --all`.

This is distinct from the v3.19.0 "review-mail overview" feature (which surfaces a
*buried-but-present* done): here the row is invisible to `review-mail` entirely because
the **reviewed cursor (`lastReviewedSeq`) has already advanced past it**.

## What the original v3.6.2 fix did (and why it does NOT cover this)

`fe1a30bf` (v3.6.2) fixed a *different* root cause: an orphan/duplicate listener
draining the lead's mailbox at delivery. It added a monotonic per-actor
`lastListenerEpoch` ownership fence in `consumeMailbox` (`hooks/mailbox.js:660-687`) +
`tests/consume-mailbox-epoch-fence.test.js` + `tests/integration/proactive-report-silent-loss-race.test.js`.
That epoch fence is intact and is NOT the regression here — the v3.14.1 recurrence is a
**cursor/surfacing** bug, not a duplicate-consume race.

## PINNED REGRESSION SITE (git-confirmed)

Two cursor-advancing consume paths exist; only `review-mail` was taught the protocol-v2
`expandReviewRows`. The `/wake` path was not.

- `9347c0c0` (2026-05-19) `fix: [F-003] - /wake now calls markReviewed to advance lastReviewedSeq` —
  made the explicit `/wake` command advance the reviewed cursor after consuming.
- `af07987d` (2026-05-30) `feat(crews): implement protocol v2 per-report outbox` —
  introduced `payload.entries[]` batching and the local `expandReviewRows()` helper in
  **review-mail.js only**. It did **not** update the pre-existing `/wake` path to expand.

So `af07987d` (protocol v2, shipped in the v3.7 line) is the regression commit: it made
the proactive terminal content live inside `payload.entries[]` and taught
`/crews:review-mail` to expand it, but left `/wake` formatting the **raw batch row**
while still advancing the cursor.

### Exact code (current main, v3.19.0)

`hooks/user-prompt-submit.js` `/wake` handler (lines 70-92):
```js
let messages;
try { messages = consumeMailbox(state.name, crew, cwd, 'wake', { sessionId }); } ...
if (messages.length > 0) {
  const historyRows = readInboxHistoryTail(state.name, crew, cwd, messages.length);
  const entries = historyRows.map(row => formatReviewMailEntry(row, { crew, stateCwd: cwd })); // NO expandReviewRows
  ...
  const reviewedSeq = Number.isFinite(afterManifest.lastReviewRequiredSeq) ? afterManifest.lastReviewRequiredSeq : 0;
  ...
  if (reviewedSeq > 0 && reviewedAt) {
    try { markReviewed(state.name, crew, cwd, { sessionId, reviewedSeq, reviewedAt }); } catch (_) {} // advances lastReviewedSeq -> lastReviewRequiredSeq (501)
  }
  block(body, out);
}
```
- `formatReviewMailEntry` is imported from `./commands/review-mail` (line 12) — already shared.
- `markReviewed` lives at `hooks/actors.js:1180-1212` (monotonic write of `lastReviewedSeq`).

`hooks/commands/review-mail.js` (the path that DOES expand), line 239:
```js
const expanded = rows.flatMap(row => expandReviewRows(row));
```
`expandReviewRows` (review-mail.js:154-169) is a pure, **module-local (not exported)**
helper that maps `payload.entries[]` into per-report display rows.

### Why this produces the exact `{entries:[], advanced:false, lastReviewedSeq:501}`

When `/wake` (not the armed listener) is the consumer of a protocol-v2 proactive batch:
1. `consumeMailbox` writes history row at seq 501 and stamps `lastReviewRequiredSeq=501`
   (the batch envelope carries top-level `kind` = the terminal kind, e.g. `done` — see
   `stop.js:1513-1520`, preserved through `appendSystemMailbox` since `envelope.kind`
   wins; `isReviewRequiredEnvelope` returns true for `done`).
2. `/wake` formats the raw batch row (the buried per-report `done` inside
   `payload.entries[]` is NOT expanded as a distinct reviewable row) and then
   `markReviewed(reviewedSeq=501)` advances `lastReviewedSeq` to 501.
3. A later `review-mail`: `readInboxHistorySince(lastReviewedSeq=501)` returns nothing
   past 501; both advance branches skip → `{entries:[], advanced:false, lastReviewedSeq:501}`.

The armed-listener path (the bookkeeper's normal flow) is NOT broken: the listener's
`deliver()` → `consumeMailbox` does **not** advance `lastReviewedSeq`, so a subsequent
`review-mail` surfaces the batch (verified by the codex research live watch-path repro:
progress/progress/done → `review-mail` returned 3 entries, `advanced:true`). The bug
manifests specifically on cursor-advancing consume paths that don't expand.

## Secondary over-advance path (defense-in-depth)

`review-mail.js:274-291` — the **legacy-cursor recovery branch**. It advances
`lastReviewedSeq` to `lastReviewRequiredSeq` when
`allRows.length === 0 && lastReviewRequiredSeq > lastReviewedSeq`. If `consumeMailbox`
ever stamps a proactive batch as review-required (line 701) while `review-mail`'s
`filterReviewRequired` drops it (env `CREWS_REVIEW_KINDS` drift, or a future predicate
divergence between `consumeMailbox` and `review-mail`), this branch would silently
advance past the un-surfaced terminal row — the same silent-miss shape. Both predicates
use the same `isReviewRequiredEnvelope`, so they agree today, but the branch is a latent
second silent-miss surface worth a guard/assertion.

## Two review-required predicates (must stay consistent)

- `consumeMailbox` stamps `lastReviewRequiredSeq` via
  `isReviewRequiredEnvelope(envelope, role, { kinds: reviewKindsFromEnv() })` (mailbox.js:701).
- `review-mail` filters via the SAME `filterReviewRequired(history.rows, role, { kinds: reviewKindsFromEnv() })`
  (review-mail.js:227).
- `DEFAULT_REVIEW_KINDS` includes `done|question|blocked` (review-required.js:1-16); the
  proactive batch envelope's top-level `kind` is the terminal kind, so it is review-required.

## Invariants to preserve

- The **listener stays metadata-only** (counts/`kinds`/`actionableCount`, no message
  bodies — v3.19.0 contract). Do NOT make the listener carry content (that would
  re-introduce the v3.6.2 double-notify class). The fix is on the explicit `/wake`
  surface (which ALREADY carries content) + the review-mail recovery branch.
- Protocol v2 multi-row outbox, v3.6.3 display-only collapse, body-canonical — unchanged.
- v3.6.2 `lastListenerEpoch` epoch fence in `consumeMailbox` — unchanged.
- `markReviewed` monotonicity (actors.js:1180-1212) — unchanged.

## Existing tests in scope

- `tests/wake-explicit-only.test.js` — `/wake` explicit-command gate.
- `tests/stop-member-wake.test.js`, `tests/integration/proactive-report-progress-tail.test.js`,
  `tests/protocol-v2-per-report-outbox.test.js`, `tests/review-mail-command.test.js`,
  `tests/integration/proactive-report-silent-loss-race.test.js` (v3.6.2 regression),
  `tests/consume-mailbox-epoch-fence.test.js`.
- No existing test asserts `/wake` expands a protocol-v2 `payload.entries[]` proactive
  batch before `markReviewed`. That gap is what let the regression ship.

## Files in scope

| File | Change |
|---|---|
| `hooks/commands/review-mail.js` | Export `expandReviewRows` (or move to a shared `lib/` module). |
| `hooks/user-prompt-submit.js` | `/wake` expands `payload.entries[]` via shared `expandReviewRows` before `formatReviewMailEntry` and before `markReviewed`. |
| `hooks/commands/review-mail.js` (recovery branch) | Defense-in-depth guard so the legacy-recovery branch cannot silently advance past an un-surfaced review-required proactive terminal row. |
| `tests/...` (new) | Regression test reproducing the seq-501 scenario (proactive batch with trailing done -> consumed -> review path surfaces the done, not empty). |
| `.claude-plugin/plugin.json`, `.github/plugin/plugin.json`, `.codex-plugin/plugin.json`, `.claude-plugin/marketplace.json` (root), `.github/plugin/marketplace.json`, `.agents/plugins/marketplace.json`, `tests/version.test.js` | 6-file version stamp via `scripts/bump-version.js`. |
| `CHANGELOG.md`, `AGENTS.md` | New version entry + plugin AGENTS.md section. |

Toolkit-root marketplace indexes + codexu gitlink/AGENTS active-plugin-versions table are
**lead-owned at ship** (two-commit submodule flow).
