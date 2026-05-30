# Research brief — crews ack-loop bug

**Job:** `crews-ack-loop-bug` (research-only)
**Author:** research-crews-ack-loop-bug (Copilot lead-spawn 2026-05-30)
**Investigation worktree:** `D:/ai-developer-toolkit/.worktrees/crews-ack-loop-investigation` on `ralph/crews-ack-loop-investigation`
**Failing test (toolkit branch):** `plugins/crews/tests/auto-derive-replyTo-enforce-mode-gate.test.js`

## Bug in one paragraph

The crews Stop hook (`plugins/crews/hooks/stop.js`) treats the implicit
"this kind-bearing report IS the reply" intent ASYMMETRICALLY. The
**outbox-write** path at lines 931–937 auto-derives `replyTo` for a member's
report when the tag did not set `reply-to=` explicitly, by calling
`findLatestConsumedLeadMessage` and stamping that id on the outbox row. The
**unresolved-consumed gate** at line 898 — which decides whether to block the
turn — does *not* consult the same helper; it only credits an entry when
`findCurrentDecision` (line 210) finds a literal match of `tags.replyTo === entry.id`,
or a matching `acks[]` / `decisions[]` row, on one of the report tags emitted
this turn. A member that emits a substantive `kind=question/done/blocked`
turn that is semantically the reply to a freshly-consumed lead message — but
forgets to type `reply-to="<id>"` on the tag — therefore gets stop-blocked,
even though the outbox-write logic three function calls later would have
auto-stamped the same `replyTo` if the gate had let the turn through.

## Code citations (origin/main, commit at investigation start: `6a9da6a4`)

| Location | What it does |
|---|---|
| `stop.js:210–229` | `findCurrentDecision(entry, tags)` — the per-report credit predicate. Line 212: `if (tags.replyTo === entry.id) return { id: entry.id, decision: 'replied', reason: '' };`. No kind gate; any kind with a literal `reply-to` match credits the entry. |
| `stop.js:231–255` | `evaluateConsumedResolutions(entries, reportsOrTags, decisionRows)` — iterates the per-turn reports, calls `findCurrentDecision` per entry, classifies each consumed inbox-history row as `resolved` or `unresolved`. |
| `stop.js:188–204` | `findPendingConsumedEntries(manifest, name, crew, cwd, decisionRows)` — supplies the `entries` list (all post-`lastTurnAt` consumed inbox rows, plus any deferred ones). |
| `stop.js:151–165` | `findLatestConsumedLeadMessage(memberName, crew, cwd, lastTurnAt)` — the auto-derive helper. Returns the most-recent post-`lastTurnAt` consumed lead/peer inbox-history row, or `null`. |
| `stop.js:898–908` | **The gate.** When `resolution.unresolved.length > 0`, builds the "You consumed N mailbox message(s) this turn but didn't reply or ack" block reason and writes `{decision:'block', reason}` unless `CREWS_RESOLUTION_MODE=advisory` (log-only). |
| `stop.js:931–937` | **The outbox-write auto-derive.** `recentLeadMsg = findLatestConsumedLeadMessage(...)`; then per report: `if (!effectiveReplyTo && state.role === 'member' && recentLeadMsg) effectiveReplyTo = recentLeadMsg.id;`. This is the *symmetric* logic the gate does not run. |
| `mailbox.js:787–815` | `parseReportAttrs` — parses `reply-to` attribute. Sets `out.replyTo` from `attributes['reply-to']` (line 799) and pushes a synthetic `decisions` entry with `decision:'replied'` (line 813). Reading is consistent and case-insensitive on attribute name. |
| `mailbox.js:825–849` | `parseTurnReports(rawText)` — extracts every `<|report ...|>` tag in source order, attaching prose body to each. Returns `{reports, strippedText}`. Multi-tag turns produce multi-element `reports`. |
| `stop.js:723–739` | Tag merge — metadata-only tags (no `kind=`) fold their `acks` / `decisions` / `replyTo` / body into the nearest kind-bearing report. Confirmed working for the legacy `<|report ack="X"|>` + `<|report kind="progress"|>` split-tag pattern. |

## Protocol promise vs. implementation

The protocol-level prose surfaced to every member at session start (the
spawn-prompt boilerplate emitted by `commands/spawn-member.js`, not
`docs/protocol.md`) says:

> When a mailbox message arrives, your turn MUST resolve it before ending:
>   • REPLY: include `reply-to="<message-id>"` on your `<|report ...|>` tag
>   • ACK:   add `<|report ack="<message-id>" reason="why no action"|>` to your turn text

`plugins/crews/docs/protocol.md` (lines 100–107, the v2.0.0 per-report
outbox protocol) confirms strict per-row credit (`Strict ack, reply, and
decision credit are evaluated per row`) but is silent on the auto-derive
helper. The helper is silently active on the *write* side: if the agent forgets
the explicit `reply-to`, the outbox row still ships with the correct
`replyTo`, the per-row member-reply notification fires (`stop.js:999–1023`),
and the lead sees the reply linked to the original consumed message.
Meanwhile the *gate* enforces the literal protocol promise.

This split is the bug. Either:

1. The auto-derive should be removed (forcing the agent to always type
   `reply-to=`, matching the documented protocol literally), **or**
2. The gate should mirror the auto-derive (the more lenient and currently
   pursued direction, since the auto-derive already exists on the write
   side and is load-bearing for the test
   `auto-derive-replyTo-same-turn.test.js`).

## Reproduction

Real-world failure:
- Member `impl-codex-upstream-rebase`, session
  `39cf71bb-52c7-4ae1-af0a-ed1b6e715546`, 2026-05-30 19:18–19:25 UTC.
- Lead sent direct message id `37dc4350-57e3-42f2-b723-8b032ccc7818`
  ("build env installed, proceed with rebase").
- Member consumed it via `review-mail` at 19:18:19.
- Two assistant turns blocked with `unresolved consumed mailbox messages: 37dc4350-...`:
  - 19:25:02 — `<|report kind="question" summary="..." |>` with NO `reply-to`.
  - 19:25:13 — `<|report kind="progress" summary="..." |>` with NO `reply-to`.
- 19:25:18 — `<|report kind="progress" summary="..." reply-to="37dc4350-..." |>`
  passed (literal `reply-to` match satisfied the gate).
- 19:25:25 — `<|report kind="progress" ack="37dc4350-..." decision="replied" |>`
  also passed (the agent retried with explicit ack/decision after seeing the
  reply-to attempt accepted).

The substantive kind=question prose from the 19:25:02 blocked turn
(operator-visible on-screen as a structural rebase-target question) was
**never persisted** to the outbox — the agent's retry recomposed shorter
progress messages and never re-emitted the question. The operator had to
copy-paste the question into the lead's mailbox manually. The member was
hard-terminated at 19:57:15 with reason "stuck in ack-loop (see
research-crews-ack-loop-bug)".

Outbox.jsonl evidence: only the later progress rows (seq 4 with `replyTo`,
seq 5 with `acks`/`decisions`) ever carried the consumed-id reference; the
intermediate progress row seq 3 had none, and the substantive kind=question
intent was lost entirely.

Minimal in-tree reproduction (committed on
`ralph/crews-ack-loop-investigation`):

`plugins/crews/tests/auto-derive-replyTo-enforce-mode-gate.test.js`
calls `stopHook.handleInput` in-process (avoids the `spawnSync` env-isolation
quirk that bites `auto-derive-replyTo-same-turn.test.js` outside the full
suite), with:
- Lead `lead1` sends `Proceed with the rebase per plan.` to member `alice`.
- Member consumes; manifest's `lastReviewedSeq` advanced (review-required
  gate satisfied).
- Member emits a transcript with substantive prose + `<|report kind="question"
  summary="…" |>` (no `reply-to`).
- `handleInput` invoked WITHOUT `CREWS_RESOLUTION_MODE`.

Current behavior (FAIL): Stop emits

```json
{"decision":"block","reason":"You consumed 1 mailbox message(s) this turn but didn't reply or ack:\n  - id=302f2052-... from=lead1 (lead):\n      Proceed with the rebase per plan.\nEither reply with `reply-to=\"<id>\"` on your kind tag, or add\n`<|report ack=\"<id>\" reason=\"...\"|>` for each one you choose not to act on."}
```

Expected post-fix behavior: empty stdout (stop allowed), one outbox row
with `kind=question`, `replyTo=<sent.id>`, substantive body, and a
member-reply notification on the lead's mailbox.

## Why earlier candidates from the spawn-prompt were ruled out

- **(a) `reply-to` on a `kind=question` report is not credited.** Ruled out.
  `findCurrentDecision` does not gate on kind; any kind with literal
  `tags.replyTo === entry.id` credits. The 19:25:18 turn that passed proves
  this works for `kind=progress` and the code path is identical for
  `kind=question`.
- **(b) `progress`-kind reports cannot carry an ack / `reply-to`.** Ruled
  out. `kind=progress` with `reply-to` (19:25:18) and with
  `ack=`/`decision=` (19:25:25) both passed.
- **(c) Fuzzy ID matching.** Ruled out. Comparison is strict-equal string
  match (`===` on line 212; `.includes` on line 225). The consumed id and
  attempted reply-to id are byte-identical in the failing transcript.
- **(d) Something else.** This is it — the auto-derive asymmetry between
  the unresolved-consumed gate (line 898) and the outbox-write path
  (line 937).

## Recommended minimal fix

Add an auto-derive pass *before* the unresolved-consumed gate, in
`stop.js` around line 779 (right after `pendingConsumed` is computed).
**Critical guard:** only auto-derive when *no* report on this turn already
carries an explicit `replyTo`, `acks`, or `decisions` entry for the
target id. Without this guard, the implicit `replied` decision would
silently override an explicit `<|report ack="<id>" decision="deferred"|>`
or `decision="unable"` on a split-tag turn (see existing tests
`decision-deferred-once.test.js`, `decision-deferred-cap.test.js`,
`decision-unable-final.test.js` for the contracts that must be preserved).

```js
let impliedReplyTo = null;
if (state.role === 'member') {
  const recentLeadMsg = findLatestConsumedLeadMessage(state.name, crew, cwd, manifest.lastTurnAt);
  if (recentLeadMsg) impliedReplyTo = recentLeadMsg.id;
}
if (impliedReplyTo) {
  // Guard: skip if any report already explicitly resolves this id (in any
  // direction — replied, ack-no-action, deferred, unable). Reuse the gate's
  // own per-report predicate so the guard tracks behavior changes.
  const alreadyResolved = reports.some(r => findCurrentDecision({ id: impliedReplyTo }, r));
  if (!alreadyResolved) {
    const latestKindReport = reports[reports.length - 1];
    if (latestKindReport && !latestKindReport.replyTo) {
      latestKindReport.replyTo = impliedReplyTo;
      latestKindReport.decisions = (latestKindReport.decisions || []).concat([
        { id: impliedReplyTo, decision: 'replied', reason: '' }
      ]);
    }
  }
}
const resolution = evaluateConsumedResolutions(pendingConsumed, reports, decisionRows);
```

The fixer should confirm: (a) the failing test
`auto-derive-replyTo-enforce-mode-gate.test.js` passes; (b) the existing
`auto-derive-replyTo-same-turn.test.js` and `auto-derive-replyTo-stale-skip.test.js`
still pass in both advisory and enforce modes; (c) the three
`decision-*.test.js` cases above still pass — the guard exists specifically
to protect their explicit-decision semantics from being clobbered by the
new implicit `replied`.

**Accepted leniency tradeoff.** This fix makes enforce mode credit the
most-recent same-turn consumed lead message even when the agent's
substantive prose is *unrelated* to that message (e.g., the agent ignored
the lead's request and surfaced an independent question). The same
leniency already exists on the outbox-write path on line 937; the fix
brings the gate into symmetry rather than introducing new permissiveness.
The alternative — strict per-prose semantic matching — is not implementable
without an LLM-grade text classifier. The narrower-than-this option would
be: only auto-derive when the consumed message is the *only* pending
consumed entry (one outstanding message → one obvious implicit reply).
That extra constraint is worth considering if the operator has seen
multi-consumed-per-turn scenarios where the wrong message gets credited,
but the production failure observed on 2026-05-30 was a single-pending
case and the simpler form already eliminates it.

A complementary improvement (NOT strictly required for the bug fix) is to
document the auto-derive in `plugins/crews/docs/protocol.md`. The current
session-start prompt prose ("REPLY: include `reply-to=...`") promises
strict literal matching. If the implementation is going to be lenient,
both surfaces should mention "or omit `reply-to` and the most recent
same-turn consumed message is credited automatically as the reply — unless
some other report tag already resolves it explicitly" so agents and humans
share a mental model.

## Severity

**HIGH.** This bug silently censors review-surfacing
(`kind=question`/`done`/`blocked`) reports whenever the agent neglects to
include the literal `reply-to=` attribute on a turn that follows a
freshly-consumed lead message. The agent's substantive prose is visible on
the operator's screen but is dropped from the lead's mailbox on retry —
the lead never sees what the agent was actually asking, completing, or
blocked by. Production impact observed on 2026-05-30: lost
`kind=question` for a 5-version codex-rebase task with a non-trivial
structural blocker; operator had to copy-paste the substance manually
into the lead's mailbox to unstick the pipeline. The failure mode is
quiet (no exception, no error log mentioning lost content) and likely
recurring across other members under similar patterns; an audit of
`outbox.jsonl` files for members that hit
`stop blocked (unresolved consumed mailbox messages:` followed by short
follow-up progress rows would surface other affected sessions.

## What is in this brief and what is not

- ✅ Root cause cited to specific line numbers on `origin/main` (commit
  `6a9da6a4`).
- ✅ Protocol promise (session-start prose + `docs/protocol.md`) quoted
  and compared to implementation.
- ✅ Failing in-tree test committed on the toolkit investigation branch.
- ✅ Recommended minimal fix sketched (one helper call + one mutation
  before the gate; existing helper used).
- ✅ Severity justified with real-world evidence.
- ❌ **No fix code committed on this run.** The implement member for the
  fix should land on a separate branch
  (`ralph/fix-crews-ack-loop-auto-derive-symmetry` or similar) and add the
  documentation update in the same patch.
- ❌ **Bug B (content loss on retry).** The agent's CLI does not replay the
  prior assistant content into the next turn; a stop-block forces a retry
  in which the model recomposes prose, typically shorter. That is an
  agent-runtime concern outside `stop.js` and not in scope for this
  research, but worth flagging: even after fixing Bug A, an agent that hits
  any stop-block on a substantive review-surfacing kind risks losing the
  prose. A complementary mitigation is to widen the implicit-ack surface
  (Bug A fix) so the unresolved-consumed gate triggers much less often in
  the first place.
