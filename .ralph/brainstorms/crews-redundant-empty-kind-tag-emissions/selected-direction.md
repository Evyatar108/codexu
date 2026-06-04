## Direction
D-001 — Lead-side `review-mail` exact-duplicate collapse. All three lenses (codex, copilot, devils-advocate) converge that displacement at the lead's review surface is materially safer than source-side suppression and that the durable outbox audit log must remain untouched.

## Goal
A lead running `/crews:review-mail` against a mailbox containing N consecutive same-(sender, kind, body-hash, summary) entries — with no differing replyTo / acks / decisions metadata — sees one collapsed row with `count=N`, an explicit per-collapse stderr warning, and a `crews.log` entry per collapse pass. The review cursor advances past all collapsed rows as if individually reviewed. `outbox.jsonl` and `mailbox-history.jsonl` remain append-only and grep-able. STRICT-ACK (v1.1.5), review-required (v1.2.9), proactive-routing (v1.2.11+), and v3.x circuit-breaker behavior are all preserved. An env switch `CREWS_REVIEW_MAIL_COLLAPSE=off` exists for operators who want raw rows.

## Scope

### In Scope
- New collapse pass in `hooks/commands/review-mail.js::formatReviewMailEntry` (and the row-expansion site at `review-mail.js:121-135, 193-209`) that walks consumed rows in cursor order, groups consecutive rows with the same `(memberName, kind, body-hash, summary, empty replyTo, empty acks, empty decisions)` tuple, and emits one collapsed display row per group.
- Body-hash computed against the actually delivered body (NOT the resolved-from-id fallback at `review-mail.js:99-118`), to avoid false dedup when distinct rows happen to resolve to the same display string.
- Per-collapse stderr warning when `count >= 3` AND a per-collapse `appendLog` entry to `crews.log` listing `(memberName, crew, kind, count, seqRange, bodyHashPrefix)` for every collapse pass regardless of count, so operators can grep for false positives.
- Env switches: `CREWS_REVIEW_MAIL_COLLAPSE=off` disables the pass entirely; `CREWS_REVIEW_MAIL_COLLAPSE_WARN_THRESHOLD=<N>` overrides the default warn-at-3 stderr threshold.
- JSON output shape extension: collapsed rows include `collapsedCount`, `collapsedSeqs`, and `collapsedIds` so any downstream consumer can drill into the underlying envelopes. Single-row entries keep their existing shape (`collapsedCount` absent or equal to 1).
- Test coverage spanning `tests/review-mail-command.test.js` (collapse pass), `tests/strict-ack-review-mail.test.js` (cursor advancement under collapse — must match pre-collapse behavior bit-for-bit), and `tests/command-args-parity.test.js` (env-switch / CLI parity).
- A pre-ship offline measurement: run the collapse pass over the existing local `.crews/ralph-pipeline/members/*/outbox.jsonl` + `mailbox-history.jsonl` corpus that codex already sampled (1086 rows, 47 exact consecutive same-kind duplicates, 245 stub-like rows), produce a raw-vs-collapsed diff, and verify zero rows with non-empty replyTo/acks/decisions get coalesced.
- Light D-002 telemetry baked into the same change: each collapse pass also logs the listener-exit reason (when discoverable from the actor's manifest) and the inferred turn-boundary count, so operators can use the collapse log to characterize the residual noise pattern without a separate instrumentation ship.
- Version capture: each `crews.log` collapse entry includes the crews plugin `version` from `package.json` so future evidence can be matched to the deployed code.

### Out of Scope
- Source-side Stop-hook suppression (D-003). May be revisited as a follow-up after D-001's telemetry quantifies residual noise; the lenses agreed it should ship dry-run / log-only first if it ships at all.
- First-class `noop` / `ack` kind or extension of the v3.2 member system.notification no-kind exemption (D-004). Highest risk to the kind-tag invariant; defer until D-001's collapse telemetry shows a clear "lastKind=done + zero inbox delta + zero strict-ack-pending" pattern dominates the surviving noise.
- v2 Option D (side-channel listener queue, per `crews/docs/architecture-refactor.md` Cause 5 + the line-450 anti-refactor note). Stays on the 2.0 roadmap. D-001 reduces lead-side review pain but does not eliminate model-operated re-arm turns, listener-exit-as-wakeup forcing a model turn, or duplicate report tags emitted within a single model turn — Option D is orthogonal and remains the right v2 lever.
- Near-similarity (Levenshtein / first-200-chars) body matching. v1.x ships exact-normalized-hash only; near-similarity adds policy complexity the lenses agreed is not safe in a first ship.
- Changes to `outbox.jsonl` / `mailbox-history.jsonl` write paths. The durable audit log is untouched.

## Criteria
- A `/crews:review-mail` invocation against a mailbox containing 3+ consecutive identical `(sender, kind=done, body-hash, summary)` rows with empty `replyTo`/`acks`/`decisions` emits exactly one collapsed row with `collapsedCount=N`, a stderr warning, and exactly one `appendLog` line per collapse group in `crews.log`.
- A `/crews:review-mail` invocation against rows that have ANY differing `replyTo`, `acks`, `decisions`, `kind`, or body-hash returns each row individually (zero collapse) — verified via fuzz over the existing local sample corpus AND a targeted unit test.
- The post-collapse review cursor (`lastReviewedSeq`) is identical to the cursor that would have advanced under the pre-collapse behavior — `tests/strict-ack-review-mail.test.js` must continue passing without modification of its assertions about cursor position.
- Setting `CREWS_REVIEW_MAIL_COLLAPSE=off` produces output bit-identical to the pre-change behavior; a regression test asserts this.
- The offline pre-ship measurement against codex's already-sampled corpus reports zero rows-with-non-empty-metadata getting coalesced, and shows a measurable reduction in displayed row count (target: ≥ 30% reduction across the 1086-row corpus, given codex measured 47 exact-dup + 245 stub-like rows already present).
- A new `crews.log` line shape `review-mail collapse: member=<name> crew=<crew> kind=<k> count=<N> seqRange=<a>..<b> bodyHash=<prefix> version=<v>` appears for every collapse pass and is grep-able for false-positive audit.
- The proactive-routing payload-batching path (`stop.js:1379-1418`) is explicitly checked for whether it can produce the same kind of duplicate at the `payload.entries[]` level; if it can, the plan must specify whether the collapse pass also applies to expanded `payload.entries` rows or whether that's deferred (Devil's Advocate question).
- All existing crews tests pass; no test is modified except to add new coverage.

## Context

### Why this direction (cross-lens evidence)
- **3-lens unanimous on display-over-suppression.** Codex D-001 ("review-mail exact-collapse for system-routed duplicates"), Copilot D-001 ("lead-side collapse in review-mail"), and Devils-Advocate D-002 ("coalesce notification/display, not the audit log") converge on this surface. The remaining lens-divergent candidates (telemetry-first, source-side suppression, no-op kind) all rank below D-001 in lens consensus.
- **Codex ground-truth sample.** 1086 outbox rows in the local ralph-pipeline state included 47 exact consecutive same-kind duplicates and 245 stub-like rows by heuristic; the named member's seq 1 + seq 2 had identical body/summary/writtenAt — exactly matching the symptom in the original brainstorm context.
- **Devil's Advocate red flag, addressed.** The original "v1.x" framing was anachronistic — installed crews is v3.x, with `listener-loop.js:213-216` already filtering fs.watch by basename, `deliver()` at lines 159-180 only exiting on real messages, member system.notification no-kind exemption at `stop.js:939-958`, body-canonical block at `stop.js:1143-1215`, and proactive-routing batching at `stop.js:1379-1418`. The pre-survey "candidate 3 (listener wake-up filter)" is mostly already implemented. D-001 is scoped to where the actual unaddressed gap lives: the leaf-row display layer in `review-mail.js`.
- **D-002 telemetry is bundled, not deferred.** Each collapse pass writes a `crews.log` entry that doubles as the per-row classification Devil's Advocate asked for. If the residual noise pattern after D-001 is non-trivial, that same log informs whether D-003 (source-side suppression) or D-004 (no-op kind) should be the next ship.

### Disconfirming observations to watch for in planning
- If the offline measurement shows that most "duplicate" rows actually carry differing replyTo/acks/decisions when read against the live `mailbox-history.jsonl` (not the heuristic body-only count codex used), the collapse pass will hit very few rows and D-001's UX impact will be small. In that case the plan should re-rank toward D-003 or D-004 — but only AFTER the measurement; never speculatively.
- If the proactive-routing path at `stop.js:1379-1418` already de-dups before batching into `payload.entries`, then the collapse pass should NOT also operate on expanded entries (double-collapse risk) — must verify in planning.
- If the `body-resolution fallback in review-mail.js:99-118` makes distinct rows resolve to identical display strings often, body-hash must be computed pre-fallback. The plan must specify this.

### Open questions to carry into planning
- Should D-001 collapse be exact `(sender, kind, normalized body+summary+replyTo+ackSet hash)` only — refusing any near-similarity match in v1.x for safety? (Lens consensus: YES.)
- Should collapsed rows expose `collapsedCount`, `collapsedSeqs`, and `collapsedIds` in the review-mail JSON output, accepting a documented output shape change? (Lens consensus: YES — operators need drill-down.)
- Is it acceptable that `outbox.jsonl` and `mailbox-history.jsonl` keep the duplicate audit rows while review-mail advances the cursor past all collapsed rows? (Lens consensus: YES — preserves grep-ability and reversibility.)
- Does the collapse pass need to dedup across `payload.entries` batches in proactive-routing notifications (`stop.js:1379-1418`), or only at the leaf row level in `review-mail.js`? (Devil's Advocate flag — defer to planning to verify.)
- For each duplicate observed in the original cases, was it (a) one assistant turn with multiple report tags, (b) multiple assistant turns, (c) a Stop retry, or (d) review-mail expansion of one `payload.entries` batch? — D-002 telemetry built into D-001 will answer; D-001 collapse rules must remain safe under all four.
- Should `kind=done` be modeled as a terminal state transition after which idle member turns are no-op until new lead mail (D-004's framing), or as a repeatable per-turn report? — defer until D-001 ships and the residual noise is quantified.
- Which exact crews versions produced Case A (codexu v5.50 impl member) and Case B (seval-540475 summarizer-behavior member)? Do they include `stop.js:939-958` and the terminal-only proactive batching path? — version capture is mandatory for the planning phase since the pre-survey's "v1.x" framing was wrong.

### Verdict on v2 Option D
All three lenses agree v2 Option D (side-channel listener queue) stays on the 2.0 roadmap. D-001 + telemetry-rich logging eliminate the lead-side review pain, but they do NOT eliminate:
- model-operated re-arm turns (Devil's Advocate)
- listener-exit-as-wakeup forcing a model turn that forces a kind tag (orchestrator pre-survey)
- duplicate report tags emitted within a single model turn (Devil's Advocate: "Option D would not by itself prevent a model from emitting duplicate done tags")

So D-001 is independent of the v2 roadmap; it reduces a different problem (lead's review surface) without precluding or replacing the v2 architectural rework. The `crews/docs/architecture-refactor.md` line-450 anti-refactor note ("Defer to 2.0: replacing the listener-exit-as-wakeup model") remains accurate.
