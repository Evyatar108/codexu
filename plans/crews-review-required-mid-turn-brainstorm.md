# Crews plugin — review-required mid-turn enforcement gap

**Status:** brainstorm (research only — no code changes proposed for this turn)
**Date:** 2026-05-26
**Author:** crew member `brainstorm-crews-review-gap` (crew `ralph-pipeline`)
**Scope:** `./ai-developer-toolkit/plugins/crews/` at v1.5.6; cross-references
the `2026-05-25/26` autonomous-bookkeeper session in this codexu workspace.

---

## 1. Failure-mode analysis

### What happened today (2026-05-26 07:18Z → 07:31Z)

From `D:/harness-efforts/codexu/.crews/logs/crews.log` (verbatim, abbreviated
timestamps and trimmed for clarity):

```
07:14:40.157  member name=overview-bookkeeper stop allowed (kind=question, seq=253)
07:18:01.129  member name=impl-plugin-scope-agents-v2 notified lead=overview-bookkeeper of reply (seq=2)
07:18:01.130  member name=impl-plugin-scope-agents-v2 stop allowed (kind=question, seq=2, replyTo=be26c971-...253)
07:18:01.396  listener-protocol: transition protocol=listener from=armed to=exited name=overview-bookkeeper
07:18:01.397  listener delivered name=overview-bookkeeper via=watch count=1
07:18:17.676  pre-tool-use: blocked tool=Read name=overview-bookkeeper (listener exited)
07:18:21.728  pre-tool-use: listener arm allowed name=overview-bookkeeper
07:27:32.503  pre-tool-use: review-mail allowed name=overview-bookkeeper        ← first review, 9m13s post-delivery
07:29:03.553  pre-tool-use: review-mail allowed name=overview-bookkeeper        ← second review
07:31:00.731  member name=overview-bookkeeper stop allowed (kind=progress, seq=254)
```

Timeline reconstruction:

- **07:18:01** — Member `impl-plugin-scope-agents-v2` sends `kind=question`
  replying to lead's seq=253. `consumeMailbox`
  (`hooks/mailbox.js:512`) stamps `lastReviewRequiredSeq` on the lead's
  manifest. Listener exits (delivered one envelope).
- **07:18:17** — Lead's next tool call (Read) hits PreToolUse and is blocked
  because `listenerState !== 'armed'` (`hooks/pre-tool-use.js:438-477`).
  This is the **listener-armed** gate, **not** the review-required gate.
- **07:18:21** — Lead re-arms listener. PreToolUse permits the arm call
  (`pre-tool-use.js:379-388`).
- **07:18:21 → 07:27:32** — Approximately **9 minutes of unimpeded
  mid-turn tool calls** by the lead with `lastReviewRequiredSeq > lastReviewedSeq`
  and no in-band signal. PreToolUse has no review-required check in v1.5.6
  (explicit removal at `pre-tool-use.js:390-403`). Stop hook never fires
  because the lead is in one continuous turn.
- **07:27:32** — Lead finally runs `review-mail` (under operator nudge,
  per the spawn-prompt narrative). Cursor advances.
- **07:31:00** — Turn ends with `kind=progress`. Stop hook's review-required
  block at `stop.js:602-614` finds `lastReviewedSeq >= lastReviewRequiredSeq`
  and permits the exit.

**The gap:** between 07:18:01 (mail delivered) and 07:27:32 (review-mail
run), there was no in-band signal that mail was unreviewed. The agent
made dozens of tool calls; each one passed PreToolUse trivially because
the listener was re-armed at 07:18:21. Had the operator not nudged, the
gap would have extended to 07:31:00 — a full 13-minute invisibility
window.

### Code-path attribution

The Stop-only enforcement is structural, not accidental:

- **Stop hook** (`hooks/stop.js:602-614`) — only review-required check in
  v1.5.6. Fires on turn end only.
- **PreToolUse** (`hooks/pre-tool-use.js:390-403`) — comment-marked
  removal. Only checks: listener-arm bypass (379-388), review-mail
  listener bypass (413-416), AskUserQuestion intercept (433-436),
  listener-armed gate (437), listener-arm guidance block (438-477).
  Nothing about `lastReviewRequiredSeq`.
- **Listener delivery** (`hooks/mailbox.js:508-525`) — stamps
  `lastReviewRequiredSeq` and `lastReviewRequiredDeliveryAt` atomically
  under the manifest lock. The post-effect signal is reliable; the gap
  is purely *visibility*.
- **No PostToolUse hook** registered (`hooks/hooks.json:1-49` lists only
  SessionStart, UserPromptSubmit, Stop, PreToolUse).

A turn-end-only enforcement design works when turns are short
(implementer agents that run a small tool sequence then report). It
fails when a turn is long-running — the autonomous bookkeeper pattern,
extended Phase-4 investigations, multi-file refactors.

---

## 2. v1.5.6 design-rationale recovery

The current Stop-only design is the **fixed point** of v1.5.4 → v1.5.5 →
v1.5.6, all documented in `./ai-developer-toolkit/GAPS-FROM-2026-05-25-26-SESSION.md`
under **CR-2 (FIXED v1.5.4/5/6)**:

> The PreToolUse review-required block matched commands via regex
> (`NODE_THEN_CREWS_REVIEW_MAIL_RE` etc.) to "let the right command
> through". The regex initially missed:
> - Quoted dispatcher paths (`node 'C:/...crews.js' review-mail` — quote
>   after `crews.js` broke `\s+`).
> - Env-var forms (`node $CREWS_BIN review-mail`, `node $env:CREWS_BIN
>   review-mail`).
>
> v1.5.4 + v1.5.5 patched each missed form with another regex extension.
> v1.5.6 deleted the entire PreToolUse review-required gate — Stop hook
> is now the single enforcement point, and the script's `markReviewed`
> cursor advancement under the manifest lock is the source of truth.
>
> **Lesson:** Pre-execution command-shape recognition is inherently
> fragile. Trust post-effect signals instead.

The in-source comment at `hooks/pre-tool-use.js:390-403` is even more
explicit about the deadlock failure mode:

> when the regex missed a legitimate review-mail form (e.g. the `node
> $CREWS_BIN review-mail …` env-var variant emitted to spawned members),
> the gate rejected the very command its own block reason suggested,
> and the member had no path forward.

### Is the rationale still load-bearing?

Partially. The rationale has **two distinct claims**, and only one of
them survives today's evidence:

| Claim | Status |
|---|---|
| (A) Regex-gated command bypass is fragile when block-reason and bypass-regex must agree byte-for-byte. | **STILL TRUE.** The CR-2 incident was a real deadlock loop. Any redesign that re-introduces command-shape recognition inherits this risk. |
| (B) Therefore Stop is sufficient as the single enforcement point. | **REFUTED by today's 9–13 min invisibility window.** "Sufficient" only holds for short turns. The autonomous-bookkeeper / long-investigation use case did not exist when v1.5.6 was designed. |

The right summary: **v1.5.6 removed enforcement from PreToolUse correctly
*for the regex-bypass reason*; it did not solve, and did not consider, the
long-turn mid-turn invisibility problem.** Re-adding enforcement is on
the table — but the design must not re-introduce the byte-for-byte
bypass-vs-block-reason coupling.

A subtle nuance worth recording: the `isReviewMailCall` regex
(`pre-tool-use.js:103-137`) **still exists in v1.5.6** — but it serves a
different gate now. It's the listener-arm bypass: an agent can run
`review-mail` even when its listener is exited, without having to
re-arm first. The failure mode of a regex miss here is **degraded** (the
agent has to arm a fresh listener before pasting again — one extra
tool call), not **deadlock**. That asymmetry between "regex miss costs a
round-trip" vs "regex miss costs a session-killing loop" is the
load-bearing distinction.

---

## 3. Option-by-option evaluation

Notation: `manifest.lastReviewRequiredSeq` = R; `manifest.lastReviewedSeq` =
V; `manifest.lastReviewRequiredDeliveryAt` = D. Cursor-behind condition:
R > V. Age: `now - D`.

### Option A — Symmetric PreToolUse block (lead's initial sketch)

PreToolUse adds: if `R > V` AND `age > GRACE_MS` (default 30s) AND the
tool is not in the bypass set → block with the same review-required
reason Stop uses.

- **Bypass set:** `isReviewMailCall` (reused from listener-arm bypass),
  plus the listener-arm itself, plus BashOutput / read_bash for inspecting
  exited listener output.
- **Manifest read cost:** PreToolUse already reads the manifest for
  the listener-armed gate (`pre-tool-use.js:418` `getListenerState` →
  `readManifest`). Adding two field comparisons + one timestamp parse
  is sub-millisecond on top of the existing read. **Acceptable.**
- **False-positive surface:**
  - Sub-grace window (`age < GRACE_MS`): no block. Listener-just-delivered
    case is safe.
  - Age > grace window but agent is *about to* run review-mail in the
    next tool call: the regex needs to recognize the command. **This
    re-introduces the CR-2 risk.** Mitigations: (a) the bypass regex
    today covers all three known forms (`crews.js`, `review-mail.js`,
    `$CREWS_BIN` / `$env:CREWS_BIN`); (b) the block reason is *rendered*
    via `buildReviewMailCommand`, so the suggested command is regex-matched
    by construction; (c) future shape changes must extend the regex AND
    the renderer in lockstep, with a regression test that asserts
    `isReviewMailCall(buildReviewMailCommand(...))` for every emitted form.
- **Loop risk:** The bypass list MUST include `isReviewMailCall`. If
  the agent's review-mail invocation form is novel and the regex misses,
  the agent is back in CR-2 deadlock. Pinning constraint: every emitted
  command form must round-trip through `isReviewMailCall(buildReviewMailCommand(...))
  === true` (add a unit test).
- **Mid-turn ergonomics:** Hard block at the 30s mark feels abrupt. The
  agent receives a `decision: block` with reason text on its next tool
  call, exactly as if Stop fired. Acceptable but jarring during
  investigation bursts.
- **Backward compat:** Existing `tests/integration/review-flow.test.js`
  already retains a `assertReviewGateBlocks` helper that delegates to
  Stop (lines 16-22 explain the v1.5.6 rename). The test suite's design
  anticipates re-adding a PreToolUse check; tests would assert the new
  block fires after grace window only.
- **CR-2 lesson cost:** Re-introduces the regex bypass coupling that CR-2
  explicitly warned against. **This is the central trade-off** of Option
  A.

### Option B — Advisory system-reminder injection

PreToolUse stays as-is (no block). On each Nth tool call (e.g. every
3rd) when `R > V`, write a stderr advisory: "you have unreviewed mail
since Xs ago — run review-mail".

- **Manifest read cost:** Same as Option A (already reading manifest).
- **False-positive surface:** Zero — advisory only.
- **Loop risk:** Zero — never blocks.
- **Mid-turn ergonomics:** **Limited reach.** PreToolUse stderr is
  primarily operator-visible. The Claude Code surface that injects hook
  stderr to the model is the `decision: block` reason; non-blocking
  stderr does not reliably reach the model's context. So this option's
  visibility is "operator sees the nudge in the live transcript" — not
  "model sees it in the next tool result". An operator-in-the-loop
  workflow benefits; a true autonomous run does not.
- **Backward compat:** Trivial — no behavior change to enforcement.
- **Verdict:** Cheap, safe, *but does not solve the autonomous-run case*.

### Option C — Mid-turn auto-peek injection via listener exit handler

When the listener's exit handler delivers a batch, it already emits a
JSON envelope (`type: "messages"`) that Claude Code surfaces. **The mail
body IS already injected** via the listener-delivery path, just not as
an interrupt to the in-flight turn — the listener exits and the agent's
PreToolUse re-arm block carries no mail content; the delivered content
becomes visible only when the agent inspects the exited Bash output
(BashOutput).

The proposal: extend the listener so that on exit-with-delivery, it
writes to a known location (`manifest.pendingInjection`) that PreToolUse
reads and emits to the model on the **next non-arm tool call**, as a
synthesized block reason or a non-blocking stderr.

- **Manifest read cost:** Adds one more field read; acceptable.
- **False-positive surface:** Single-shot injection per delivery —
  cleared by the same hook that emits it. Risk: if the hook emits but
  the model doesn't surface it, the mail content is lost. Need an
  "emitted but not yet acked" sub-state.
- **Loop risk:** Low — injection is one-shot per delivered batch.
- **Mid-turn ergonomics:** Mail content surfaces directly in the next
  tool result; no need for an explicit `review-mail` call. **Best
  ergonomics** of all options.
- **Backward compat:** New side effect at consumeMailbox / listener-exit
  boundaries. Touches mailbox.js, listener-loop.js (in lib/), and
  pre-tool-use.js. Larger blast radius than A or B.
- **Subtle risk:** This is essentially **collapsing review-mail into
  delivery**. That breaks the explicit review-cursor model where the
  *agent's act of running review-mail* is the side effect that advances
  `lastReviewedSeq`. If injection auto-advances the cursor, the agent
  could miss the mail content (model didn't actually surface the
  reminder) but the cursor would say "reviewed". If injection does NOT
  auto-advance, the agent still has to run review-mail — which is the
  thing we wanted to remove. **Half-measure tension.**

### Option D — Time-bounded Stop gate

Stop's review-required block fires ONLY if `R > V` AND age > T (e.g. 5
min). Below the threshold, Stop permits the turn end with a stderr
advisory.

- **Mid-turn ergonomics:** *Worse than today.* This option relaxes Stop,
  it does not strengthen PreToolUse. Long mid-turn windows still
  invisible; in addition, very fresh mail can now slip past Stop into
  a closed turn.
- **Verdict:** **Reject.** Does not address the failure mode; trades
  for worse enforcement.

### Option E — Hybrid Stop-strict + PreToolUse-advisory

Stop hook unchanged (v1.5.6 strict block). PreToolUse adds a non-blocking
stderr nudge when `R > V` AND age > 30s.

- Same constraints as Option B (stderr reach is limited).
- Adds nothing beyond B; included for completeness.
- **Verdict:** Subsumed by B.

### Option F — PostToolUse advisory injection (NEW)

Register a new PostToolUse hook in `hooks/hooks.json`. After each tool
call, if `R > V` AND age > 30s, return `decision: block` with a reason
that summarizes the unreviewed-mail state and points the agent at
`review-mail`.

Why PostToolUse vs PreToolUse?

- PostToolUse `decision: block` re-invokes the model with the reason
  appended to the just-executed tool result. The agent sees the nudge
  in-band in the model context — no operator-surface dependency like
  the stderr path.
- The semantics are kinder than PreToolUse-block: the tool call *did
  run*. The agent isn't denied its in-flight investigation — it just
  gets a system-reminder-style follow-up that mail is pending.
- The agent can resolve by running `review-mail` next. No regex bypass
  is needed because PostToolUse never *blocks* a tool call — it
  *appends* a reason after the call. The cursor advances when
  `review-mail` runs; the next PostToolUse sees `R <= V` and stays
  silent.

- **Manifest read cost:** PostToolUse adds one new hook fork per tool
  call. New work: one `readManifest` + two integer compares + one
  timestamp parse. Order of 1–3 ms on Windows (mostly the Node startup
  cost — same as the existing hooks). PostToolUse runs less critically
  than PreToolUse — a slow PostToolUse doesn't block tools, just
  delays the next model step slightly.
- **False-positive surface:** PostToolUse-block re-prompts the model
  with a reason. If the reason fires on every tool call after age > 30s,
  the agent gets nudged repeatedly until it runs `review-mail`. That's
  the *intended* nag behavior — but if the agent is genuinely working
  on a higher-priority task (e.g. a destructive operation it shouldn't
  abort), the repeated nags could be disruptive. Mitigation:
  rate-limit — emit the nag every Nth call or every M seconds.
- **Loop risk:** Zero deadlock. PostToolUse never prevents a tool from
  running; it only re-prompts after. No regex bypass needed.
- **Mid-turn ergonomics:** **The strongest in-band signal of any option.**
  Mail-pending nudge appears in the model's context the very next
  step. Investigation can continue; the model can choose to interleave
  a `review-mail` call.
- **Backward compat:** Requires registering a new hook in `hooks.json`.
  Adds a new hook file (`hooks/post-tool-use.js`) for both Claude and
  Copilot (per the existing copilot-shim pattern for the other hooks).
  Existing tests are unaffected; new tests cover the nag behavior.
- **CR-2 risk:** **None.** PostToolUse doesn't run a command-shape
  recognizer; it just re-prompts. The agent's response (running
  `review-mail` or not) is observed via the post-effect cursor
  advancement.

### Option G (NEW) — Reuse the listener-armed gate by collapsing review-required into listener-state

Treat "unreviewed mail older than 30s" as a degenerate form of
"listener not armed". When `R > V` AND age > 30s, the
`getListenerState` derivation downgrades the effective state to
`'review-pending'`, and PreToolUse's existing listener-armed gate
naturally blocks tool calls. The bypass list is the **same** as the
listener-armed gate's: arm-call, BashOutput, **and** the
`isReviewMailCall` regex (already used as a review-mail bypass at
`pre-tool-use.js:413-416`).

- **Why this is different from Option A:** Same enforcement *behavior*,
  but the *implementation* reuses an existing primitive
  (`getListenerState`) and the existing bypass machinery. No new
  branch in pre-tool-use.js; one new state in actor-state.js.
- **CR-2 risk:** Same as A — the regex bypass coupling re-enters via
  `isReviewMailCall`. The same mitigation applies (round-trip
  invariant test).
- **Cognitive simplicity:** The agent sees the same block reason format
  it already sees for "listener not armed" — but with a different
  remediation prefix. Less new cognitive load on the agent.
- **Hidden coupling:** Makes `getListenerState` carry semantic load
  beyond its name. Future readers will be surprised that "listener
  state" can mean "unreviewed mail". **Naming smell.**

---

## 4. Recommendation

**Adopt Option F (PostToolUse advisory injection)** as the primary
mechanism, with **Stop hook v1.5.6 strict block left intact** as the
final-checkpoint backstop.

Why F over A:

1. **CR-2-safe by construction.** PostToolUse never gates a tool call,
   so there is no command-shape recognizer to maintain. The
   block-reason / bypass-regex coupling that caused the v1.5.4 →
   v1.5.5 → v1.5.6 churn cannot recur.
2. **Strongest in-band signal of any option.** The model sees the
   review-required reminder appended to the tool result that triggered
   the check — exactly where the model is paying attention.
3. **Bounded performance cost.** One extra hook fork per tool call,
   one manifest read inside it. The existing PreToolUse already does
   the same read for the listener-armed gate; PostToolUse can use the
   same code path (lazy-require `actor-state.js` and `protocol/review-required.js`).
4. **Backward-compat-clean.** No change to Stop hook behavior; existing
   review-flow.test.js continues to pass. New tests cover the
   PostToolUse advisory path.
5. **Composable with future work.** Operator-controllable via the same
   `CREWS_REVIEW_MODE` env-var that already gates Stop's strictness:
   `enforce` → PostToolUse re-prompts; `advisory` → PostToolUse writes
   stderr only; `off` → no PostToolUse output.

### Concrete delta against v1.5.6

| File | Change |
|---|---|
| `hooks/hooks.json` | Register `PostToolUse` hook pointing at `${CLAUDE_PLUGIN_ROOT}/hooks/post-tool-use.js`. Timeout 5s, same as PreToolUse. |
| `hooks/post-tool-use.js` (new) | New file. Reads input, runs `RuntimeContext.fromHook`, reads manifest, checks `R > V` and `now - D > GRACE_MS` (default 30s, env-overridable via `CREWS_REVIEW_MID_TURN_GRACE_MS`). If condition holds, emit `decision: block` with reason from a new `reviewMidTurnReason` helper in `hooks/protocol/review-gate.js`. Rate-limit to one fire per `lastReviewRequiredSeq` value AND per N-second window per tool call burst (avoid spamming on every PostToolUse during a debug loop). |
| `hooks/protocol/review-gate.js` | Add `reviewMidTurnReason(name, crew, cwd, role, manifest)` — reuses `readInboxHistorySince` + `filterReviewRequired` (same logic as `reviewRequiredReason`) but emits a shorter reason: "mid-turn nudge: <N> unreviewed envelopes since <age>s ago; run review-mail to acknowledge — Stop will block your turn end until you do". |
| `hooks/copilot-post-tool-use.js` (new) | Mirror existing copilot-shim pattern: translates Copilot's `postToolUse` input → Claude `PostToolUse` shape, delegates to `post-tool-use.js`. |
| `tests/integration/review-flow.test.js` | New scenario: lead delivers mail, agent runs an unrelated tool, PostToolUse fires advisory at age > 30s. Lead runs `review-mail`; next PostToolUse stays silent. Lead runs another tool; PostToolUse stays silent (cursor caught up). |
| `tests/protocol/review-gate.test.js` | Unit-test `reviewMidTurnReason` shape + grace-window semantics. |
| `README.md` | Document new hook + `CREWS_REVIEW_MID_TURN_GRACE_MS` env var + nag-rate-limit semantics. |
| `CLAUDE.md` (crews plugin) | Add a v1.5.7 (or next) section narrating the PostToolUse mid-turn nag, plus a "common-mistake gotcha": "Do NOT re-introduce a command-shape recognizer in PostToolUse. The CR-2 lesson applies. PostToolUse re-prompts; it does NOT bypass-via-regex." |
| `D:/harness-efforts/codexu/CLAUDE.md` ("Crews-plugin invariants" section) | Update the v1.5.6 description to v1.5.7-aware: "Stop hook is the strict gate; PostToolUse runs an advisory nag at >30s mid-turn." |

Estimated patch size: ~300-400 lines of new code (one new hook file +
one new helper + one new Copilot shim + tests + docs), zero deletions in
production code. The Stop hook's review-required block at
`stop.js:602-614` and the PreToolUse arm-only-bypass at
`pre-tool-use.js:390-403` both remain unchanged.

### Why not Option A as a fallback

A is viable if PostToolUse turns out to not actually re-prompt the model
in the deployment shape we expect (i.e. Claude Code's PostToolUse
contract is different from what the docs suggest). In that scenario:
fall back to A, accept the CR-2 risk, and pay the cost of the
round-trip-invariant test as ongoing maintenance. The grace window
(>30s) absorbs the listener-just-delivered race. The bypass set is
documented as load-bearing and any future shape change to the rendered
review-mail command must include a regression test
`isReviewMailCall(buildReviewMailCommand({…})) === true` across the
matrix of `{role, engine, useEnvBin}`.

---

## 5. Open questions (operator decision required)

1. **PostToolUse semantics in Claude Code.** Does `decision: block` from
   PostToolUse actually re-prompt the model with the reason appended to
   the tool result, the way Option F assumes? This is the load-bearing
   assumption. **Operator answer needed before implementation.** If the
   actual behavior is "PostToolUse-block aborts the tool result entirely",
   F is materially worse and we should re-evaluate. (A quick test: write
   a one-shot PostToolUse hook that emits `decision: block` after a
   `Read`; observe whether the model sees the reason or just sees the
   Read result.)

2. **Nag rate-limit policy.** Once per `lastReviewRequiredSeq` value
   (one nag per fresh mail delivery)? Or every N seconds while cursor
   is behind (recurring nag)? Or every Nth tool call?
   Recommended default: **once per `lastReviewRequiredSeq` value**, then
   re-fires only if a new envelope arrives. Predictable; avoids
   nag-fatigue.

3. **GRACE_MS default.** 30s feels right (listener-just-delivered race
   is sub-second; an honest agent has time to start its next think-and-
   act before being nudged). But the autonomous-bookkeeper use case
   suggests something coarser (60–120s) so a brief tool sequence
   doesn't trigger. **Recommend 30s; revisit after one week of
   telemetry.**

4. **Should the nag include the envelope summaries?** Stop's reason
   already includes sender names via `senderNames` + `readInboxHistorySince`.
   The mid-turn nag could be more terse (just the count) or fully
   informative (sender names, kinds). Recommend: include sender names
   + kinds — same shape as `reviewRequiredReason` — so the agent has
   enough context to decide priority.

5. **Should `kind=progress` and `kind=done` envelopes trigger the
   mid-turn nag, or only `kind=question` / `kind=blocked`?** Today's
   review-required set is `['done', 'question', 'blocked', 'progress']`
   (`review-required.js:1`). The mid-turn nag is more interruptive than
   Stop; an argument exists to narrow the set to just
   `['question', 'blocked']` for mid-turn (the ones that genuinely need
   the agent's attention NOW). **Operator decision.**

6. **Does the gap reproduce for *member* sessions, or only for leads?**
   Members typically have shorter turns and fewer mid-turn bursts. The
   incident today was lead-only. If members are unaffected in practice,
   the PostToolUse nag could be lead-only — saves the PostToolUse fork
   cost on every member tool call. But the asymmetry is a maintenance
   smell. **Recommend uniform; reconsider if perf shows up.**

7. **Cross-plugin interactions.** PostToolUse is currently unused by
   crews — but is it used by other plugins on the same workspace? If
   so, the new crews PostToolUse must be a well-behaved citizen (fail
   open, fast, no contention on `.crews/` writes). **Need a survey of
   the ai-developer-toolkit plugins' PostToolUse usage.**

---

## Appendix — references

- Incident log: `D:/harness-efforts/codexu/.crews/logs/crews.log` (lines
  236-258 for the 07:14:40 → 07:31:00 window).
- v1.5.6 enforcement code path: `hooks/stop.js:602-614` (Stop gate),
  `hooks/pre-tool-use.js:390-403` (removed PreToolUse gate),
  `hooks/protocol/review-gate.js:39-85` (`reviewRequiredReason`),
  `hooks/protocol/review-required.js:35-50` (`isReviewRequiredEnvelope`).
- Cursor mechanics: `hooks/mailbox.js:508-525` (`lastReviewRequiredSeq`
  + `lastReviewRequiredDeliveryAt` stamped under manifest lock at
  delivery time).
- Existing bypass machinery: `hooks/pre-tool-use.js:103-137`
  (`isReviewMailCall` — three command-shape regexes), `:413-416`
  (listener-arm bypass usage).
- Hook registration: `hooks/hooks.json` (PostToolUse absent — new
  registration needed for Option F).
- Existing tests: `tests/integration/review-flow.test.js:16-46`
  (`assertReviewGateBlocks` delegates to Stop per v1.5.6 rename).
- Historical context: `./ai-developer-toolkit/GAPS-FROM-2026-05-25-26-SESSION.md`
  CR-2 (FIXED v1.5.4/5/6) — the regex-deadlock root cause.
- Plugin CLAUDE.md v1.5.1 / v1.5.2 sections — narrate the
  `buildReviewMailCommand` consolidation + `useEnvBin` mode, both of
  which Option F leaves untouched but Option A would need to extend.
