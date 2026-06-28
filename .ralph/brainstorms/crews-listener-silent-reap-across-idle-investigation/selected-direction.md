---
overviewTaskId: crews-listener-silent-reap-across-idle-investigation
---

## Direction
D-001 — Reframe: make the dead-window provably lossless, promptly self-healing, and deadlock-free (treat listener death as EXPECTED). Implement WITH D-002 as the cause-agnostic mechanism and observe D-003 as a guardrail. Target delivery-correctness, not process-longevity — the only framing robust to BOTH possible causes (external runtime reap vs. internal fs.watch-drain), which source cannot distinguish.

## Goal
The crews lead listener may die silently across a long idle/between-turns gap (the 2026-06-09 OPEN QUESTION), and that is treated as EXPECTED rather than fought. After this work:
- A member `done`/`question`/`blocked` that lands while the lead listener is dead is delivered with a **bounded, asserted latency** and **zero loss** (no reliance on a human eventually typing).
- The crews-internal `fs.watch`-drain bug is fixed unconditionally (the watcher is recreated on error/close; the process-liveness anchor is decoupled from the message-notify mechanism) so the listener cannot silently event-loop-drain.
- Exit/signal instrumentation is folded into the fix so the NEXT silent death self-classifies external-reap vs. internal-drain — settling the OPEN QUESTION without a standalone investigation task.
- The autonomous (no-operator) deadlock is closed: a dead listener can no longer self-perpetuate (no wake → no turn → no re-arm → no wake).
- The operator's `detach:true` prohibition is honored throughout (listener stays session-bound).

## Scope
### In Scope
- `ai-developer-toolkit/plugins/crews/lib/listener-loop.js`: recreate `fs.watch` on error/close (replace the no-op `:535`), with backoff; add `process.on('exit', code => { if (!resolved) appendLog('listener-unexpected-exit code=...') })` + SIGTERM/SIGINT/SIGHUP/SIGBREAK handlers (log + best-effort `markExited` before exit); decouple a ref'd parent/ppid-liveness anchor (exits-when-orphaned) from the fail-soft `fs.watch`+poll notify path. Do NOT naively un-unref the poll/heartbeat timers (resurrects the orphan-zombie the unref's prevent).
- Listener identity vs. bare PID: record listener start-time/identity so a recycled Windows PID is recognized as not-our-listener and demoted on the next turn — collapsing the ≥5-min `deriveListenerState` self-heal floor (`hooks/actor-state.js` / `hooks/health.js` / `hooks/process-liveness.js` liveness path) to one turn.
- A listener-INDEPENDENT idle mailbox sweep / turn-trigger (Stop / PreToolUse-driven) so the autonomous loop cannot deadlock on a wake that never comes.
- Tests: a zero-loss-across-kill test (arm → kill mid-idle → enqueue a member done → next lead action re-arms + `via=initial` surfaces it before further work) and an asserted latency-bound assertion; a test seam that errors+closes `fs.watch` to prove the watcher-recreate / no-silent-exit behavior.
- Revisit the operator guidance "always arm indefinitely, never `--timeout-ms`": omitting `--timeout-ms` removes the hardTimer (`listener-loop.js:539` is conditional), leaving `fs.watch` as the literal sole ref'd keepalive — maximizing drain exposure.
- crews version bump + CHANGELOG + AGENTS.md per the crews release ceremony.

### Out of Scope
- Any `detach:true` listener (operator constraint — explicitly forbidden).
- A standalone supervisor/watchdog PROCESS (D-003 guardrail: dead-on-arrival — it would be another reapable attached async shell; the only never-reaped supervisor is the hook system, which is turn-gated and cannot cover a no-turn idle window).
- A dedicated instrumentation-FIRST investigation task (the disambiguation is folded into D-002 as a 3-line side effect; the next death self-classifies).
- Changing the v3.6.2 listener-epoch ownership or the PreToolUse arm-first / v3.4 lead-listener-unconditional Stop gates beyond what the identity-vs-PID demotion requires.

## Criteria
- Source-verified: `lib/listener-loop.js` recreates `fs.watch` on error/close (no more no-op handler) and the listener cannot event-loop-drain to a silent `exit 0` while it should be alive (proven by a test seam that errors+closes the watch handle).
- A `process.on('exit')` unresolved-exit log line AND signal handlers exist; a documented decision table maps {signal-log present ⇒ graceful runtime kill}, {exit-log code=0/resolved=false ⇒ internal drain}, {neither + process gone ⇒ SIGKILL reap}.
- Zero-loss-across-kill test passes: a member done enqueued while the lead listener is dead is surfaced to the lead on the next action with NO loss, within an asserted latency bound.
- The PID-recycle ≥5-min self-heal floor is collapsed: a repro where the reaped listener's PID is recycled to a live process still demotes `armed`→`exited` and re-arms on the next turn (not after 5 min).
- The autonomous deadlock is closed: a listener-independent sweep/turn-trigger guarantees a dead-listener idle window cannot self-perpetuate.
- crews test suite green (`node plugins/crews/tests/run.js`); version bump + CHANGELOG + crews/AGENTS.md updated; no `detach:true` introduced.

## Context
Source findings (cited file:line in `brainstorm-synthesis.md`): the listener Promise resolves only via `deliver`/`bail`/heartbeat-terminate, each writing a `markExited` transition + a `crews.log` line + a stdout envelope. The 2026-06-09 silent reap left none of the three. All three timers are `.unref()`'d (`:442`/`:528`/`:540`); `fs.watch` (`:531`) is the sole ref'd keepalive with a no-op error handler (`:535`). Two same-signature causes: external SIGKILL/SIGTERM-no-handler reap, or internal fs.watch-close → event-loop drain (Node exits 0 with the Promise pending). The internal-throw/lock/heartbeat-writer hypotheses are refuted (`safe-io.js:295-309` always logs).

Disconfirming observations to carry into the plan: (a) if, after the watcher-recreate + exit/signal loggers ship, a silent death recurs with NO exit-log AND NO signal-log, the cause is an external SIGKILL-class reap and the plan must commit fully to D-001's accept-and-bound (no in-process resilience can keep it alive); (b) if a member done can remain unreviewed after the next lead action, the latency-only framing fails and it becomes a loss bug.

Open questions: acceptable asserted latency BOUND for a done in a dead-idle window; whether the dead window is on the lead INBOX listener, the `wait-for-any-member` OUTBOX watcher, or both; whether the indefinite-arm (`--timeout-ms`-omitted) guidance should be revised here.
