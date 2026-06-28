Lenses: ran=[codex, copilot, devils-advocate]; skipped=[] (full mode — all three lenses produced well-formed output)

# Brainstorm synthesis — crews lead-listener silent reap across idle

## Problem (settled against source)

`ai-developer-toolkit/plugins/crews/lib/listener-loop.js::runListenerLoop` is a Promise
that resolves ONLY via `deliver()` (message), `bail()` (timeout), or the heartbeat
decider's `terminate` branch. Each clean exit writes THREE things — a `markExited`
manifest transition, a `crews.log` line (`listener delivered` / `listener timeout` /
`listener-eperm-terminate`), and a stdout JSON envelope. The 2026-06-09 silent reap
left NONE of the three (no exit transition, no log line, stale heartbeat). That
signature is produced by exactly TWO causes, and source cannot tell them apart:

1. **External reap** — SIGKILL (or SIGTERM with no handler): the listener has NO
   signal handlers and NO `process.on('exit')` (verified: the only `process.on` in
   the whole crews plugin are `uncaughtException` in the *hooks*, not the listener),
   so an external kill runs none of the clean-exit code.
2. **Internal fs.watch drain** — ALL three timers are `.unref()`'d (`:442`, `:528`,
   `:540`); the SOLE ref'd handle keeping the process alive is `fs.watch(inboxDir)`
   (`:531`) whose error handler is a **no-op that never recreates** the watcher
   (`:535`). If libuv drops that watch handle (fragile on Windows/ReadDirectoryChangesW
   under Defender, long idle, buffer overflow), the event loop has zero ref'd handles
   and Node exits 0 with the delivery Promise still pending — the IDENTICAL silent
   signature.

The internal-throw / lock-failure / heartbeat-writer-death hypotheses are **refuted**
for the idle gap: `decideHeartbeatAction` (`safe-io.js:295-309`) always logs on
terminate or continue, and `fs.watch` only fires on a mailbox change (the gap was idle).

**Self-heal is real but degrades.** PreToolUse forces re-arm as the first tool call
each turn (`pre-tool-use.js:721-729` — the exact block this very session hit). v3.6.2
listener-epoch + the `via=initial` up-front sweep guarantee **no message LOSS**. BUT
the Devil's-Advocate source trace found the "only latency" claim overstates promptness
in TWO ways:
- **≥5-min PID-recycle floor:** `deriveListenerState` demotion (`actor-state.js`
  + `HEARTBEAT_STALE_MS_LOCAL=5*60_000`) needs EITHER heartbeat ≥5min stale OR
  `isProcessAlive(lastListenerPid)===false`. Over a 1h+ idle gap the reaped PID is
  likely RECYCLED to a live process → `isProcessAlive` returns true (EPERM→true in
  `process-liveness.js`) → manifest still reads `armed` → PreToolUse does NOT re-arm
  → `via=initial` never runs → the done waits for the ≥5-MIN staleness floor, not
  "the next turn."
- **Autonomous deadlock:** if the listener wake is the only turn-trigger (overnight
  autonomous run), a dead listener → no wake → no turn → no re-arm → no sweep = a
  self-perpetuating deadlock. The 2026-06-09 incident only healed because a human
  eventually typed.

## Candidate directions

### D-001: Reframe — make the dead-window provably lossless, promptly self-healing, and deadlock-free (treat listener death as EXPECTED)
- Contributing lenses: [codex, copilot, devils-advocate]
- Why this might work: The invariant that matters is **delivery-correctness, not
  process-longevity** — "a member done reaches the lead with a bounded, tested latency
  and zero loss, and the pipeline never deadlocks on a dead listener." That is
  satisfiable EVEN IF the listener dies, and is robust to BOTH causes — decisive
  because source cannot distinguish them. Concretely: (1) record listener
  **start-time/identity** (not bare PID) so a recycled Windows PID is recognized as
  not-our-listener and demoted on the NEXT turn — collapsing the ≥5-min floor to one
  turn; (2) add a **listener-independent idle sweep / turn-trigger** (Stop/PreToolUse-
  driven mailbox sweep) so the autonomous loop cannot deadlock on a wake that never
  comes; (3) assert a **tested zero-loss-across-kill + latency-bound** contract.
- Risks / friction: Does not deliver in real time WHILE idle (acceptable if the bound
  is small and asserted); the identity-vs-PID demotion touches `actor-state.js` /
  `health.js` liveness logic (load-bearing — the v3.21.2 verified-tri-state pidAlive
  rules apply).
- Cheapest validation: Source-trace `deriveListenerState` demotion gating + a 5-line
  repro (arm → SIGKILL → spawn an unrelated process to grab the PID → take a lead turn
  → observe whether PreToolUse re-arms). If it does not, the ≥5-min floor is confirmed.
- Disconfirming observation: If a member done can remain unreviewed after the next lead
  action (re-arm + initial scan), or hooks allow meaningful tool use before re-arm,
  the latency-only framing fails and it becomes a loss bug needing a different fix.

### D-002: Fix the internal fs.watch-drain unconditionally + fold exit/signal instrumentation INTO the fix (NOT a standalone instrumentation task)
- Contributing lenses: [codex, copilot, devils-advocate]
- Why this might work: The fs.watch-drain is a clear LATENT BUG independent of which
  cause fired — the no-op watcher error handler that never recreates + all-timers-unref
  = the loop drain-exits the instant the watch handle dies. Fix it unconditionally
  (correct regardless): **recreate `fs.watch` on error/close** (with backoff), and
  **decouple the process-liveness anchor from the message-notify mechanism** — fs.watch
  + the 1s poll backstop (`:523`) stay the fail-soft notify path, while a **ref'd
  parent/ppid-liveness probe that exits-when-orphaned** becomes the keepalive. The
  disambiguation is a 3-line side effect, not a precursor task: add `process.on('exit',
  code => { if (!resolved) appendLog('listener-unexpected-exit code='+code) })` (fires
  on event-loop DRAIN ⇒ code 0 / resolved=false ⇒ internal drain; does NOT fire on
  SIGKILL) + SIGTERM/SIGINT/SIGHUP/SIGBREAK handlers (catch a graceful runtime kill).
  The NEXT silent death then self-classifies and settles the OPEN QUESTION for free.
- Risks / friction: Naively un-unref'ing the poll timer is WRONG — the unref's encode
  an **anti-orphan-zombie intent** (an orphaned listener self-exits); un-unref'ing
  resurrects the zombie. The ref'd anchor must be a parent-liveness probe that
  exits-when-orphaned, NOT a bare ref'd interval. Must respect the heartbeat-stamp
  ownership + advisory-vs-fail-loud write-budget contracts (`crews/AGENTS.md`).
- Cheapest validation: A test seam / monkeypatch that errors+closes `fs.watch` while
  timers stay unref'd; assert the listener logs the watcher failure, recreates it (or
  the ref'd anchor keeps it alive), and does NOT silently exit. Ship the
  watcher-recreate + exit/signal loggers together; the next real silent death's logs
  self-classify the cause.
- Disconfirming observation: If, AFTER this fix, a silent death recurs with NO exit-log
  AND NO signal-log (process simply vanished), the cause is an external SIGKILL-class
  reap — no in-process resilience can keep it alive, and the plan must commit fully to
  D-001's accept-and-bound. Conversely an exit-log code=0/resolved=false CONFIRMS the
  internal drain and refutes the external-reap framing.

### D-003: Explicitly REJECT the supervisor/watchdog (dead-on-arrival guardrail)
- Contributing lenses: [devils-advocate]
- Why this might work (as a guardrail, not a build): A "lightweight session-bound
  supervisor that respawns the arm if it dies" is circular — it would itself be an
  attached async shell (detach forbidden) subject to the SAME reap; under the internal
  cause it needs its own ref'd keepalive and either drains (unref'd) or becomes an
  orphan zombie (ref'd-and-orphaned). The only never-reaped "supervisor" is the HOOK
  system — but hooks fire only on lead TURNS, so a hook-supervisor still cannot heal a
  listener that died during a no-turn idle window (the deadlock case). So "supervisor"
  collapses into D-001's listener-independent turn-trigger + bulletproof hook re-arm —
  not a new long-lived process.
- Risks / friction: If the plan files a standalone watchdog it builds the forbidden
  thing in disguise and the operator rejects it at review on the detach constraint.
- Cheapest validation: Thought-experiment — enumerate where a candidate supervisor runs
  (attached async shell), apply the reap, observe it dies under both cause hypotheses.
- Disconfirming observation: Only if Copilot CLI exposed a session-bound child primitive
  that is provably NOT reaped without detach would a supervisor become viable — it does
  not today.

## Recommendation

**recommendedDirection = D-001**, implemented WITH D-002 as the cause-agnostic mechanism
and observing D-003 as a guardrail. D-001 reframes the goal correctly (delivery-
correctness, not process-longevity) and is the only framing that addresses the two
killer findings — the PID-recycle ≥5-min self-heal floor and the autonomous deadlock —
that the naive "accept + narrow latency" framing misses. D-002 is the small,
high-confidence, cause-agnostic fix (recreate watcher + decouple liveness-from-notify +
folded exit/signal instrumentation) that BOTH hardens the internal-drain bug AND
self-classifies the cause on the next death — so a dedicated instrumentation-first
investigation task is NOT justified. D-003 keeps the plan from wasting a cycle on a
detach-violating watchdog.

## Brainstorm → plan vs straight-to-plan

**Go STRAIGHT TO PLAN.** All three lenses agree the source already narrows the field to
exactly two same-signature candidates and the recommended fix is cause-agnostic, so a
standalone investigation/brainstorm round buys nothing. Suggested plan shape:
- Story 1 (D-002): recreate `fs.watch` on error + decouple a ref'd parent-liveness
  anchor from the fail-soft notify path + folded `process.on('exit')`/signal loggers.
- Story 2 (D-001): record listener start-time/identity (not bare PID) to collapse the
  PID-recycle demotion floor; add a listener-independent Stop/PreToolUse idle mailbox
  sweep to kill the autonomous deadlock; tested zero-loss-across-kill + asserted
  latency-bound contract.
- Guardrail (D-003): plan must NOT introduce a supervisor/watchdog process.
- Also revisit the operator's "always arm indefinitely, never `--timeout-ms`" guidance:
  omitting `--timeout-ms` removes the hardTimer (`:539` is conditional), leaving
  `fs.watch` as the literal sole ref'd keepalive — maximizing drain exposure.

## Open questions carried forward
- Acceptable, asserted latency BOUND for a done landing in a dead-idle window?
- Is the dead window on the lead INBOX listener, the `wait-for-any-member` OUTBOX
  watcher, or both?
- Should the indefinite-arm (`--timeout-ms`-omitted) guidance be revisited here?
