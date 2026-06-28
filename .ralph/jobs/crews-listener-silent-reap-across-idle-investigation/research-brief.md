# Research Brief: crews-listener-silent-reap-across-idle-investigation

## Researcher Findings

Seeded from `.ralph/brainstorms/crews-listener-silent-reap-across-idle-investigation/selected-direction.md`, which recommends D-001 with D-002: treat listener death as expected, make the dead window lossless, harden the listener against internal `fs.watch` drain, and preserve the hard operator constraint that the listener remains session-bound.

The root AGENTS evidence block records the open question: an indefinite lead listener (`--timeout-ms` omitted) was later found exited after a long idle gap, with no `listener delivered`, no timeout, no transition to `exited`, no crash/EPERM line, and a stale heartbeat. The documented working hypothesis is either external runtime reap of the attached process or internal event-loop drain after `fs.watch` disappears. It explicitly forbids `detach:true`.

Relevant source context:

- `ai-developer-toolkit/plugins/crews/lib/listener-loop.js`
  - `runListenerLoop` marks the listener armed, captures `lastListenerEpoch`, performs an initial mailbox drain, then waits via heartbeat, poll backstop, and `fs.watch`.
  - The heartbeat, poll, and optional hard timeout timers are all `.unref()`'d.
  - `fs.watch(inboxDir)` is the only ref'd keepalive in the default indefinite-arm path. Its current error handler is a no-op: `watcher.on('error', () => { /* poll backstop covers watcher failures */ })`.
  - Clean delivery and timeout paths call `markExited`, append a log line, and write a stdout JSON envelope. A hard external kill or event-loop drain before resolution can bypass all three.

- `ai-developer-toolkit/plugins/crews/hooks/actors.js`
  - `touchHeartbeat` owns listener state writes, `lastListenerPid`, and `lastListenerEpoch`.
  - `requireFreshArm` blocks duplicate listeners when an existing `lastListenerPid` appears alive and the heartbeat is fresh. If heartbeat evidence is missing and the PID has been recycled to an unrelated live process, the existing bare PID check can still produce `already-active-listener`.
  - `markArmIntent` is PreToolUse-owned and intentionally does not clear `lastListenerPid`.

- `ai-developer-toolkit/plugins/crews/hooks/actor-state.js`
  - `deriveListenerState` maps `listenerState='armed'` to `exited` when `isStaleArmedManifest` proves staleness.
  - Staleness currently means heartbeat age >= 5 minutes, or bare `isProcessAlive(lastListenerPid) === false`.
  - Bare liveness is not identity. `hooks/process-liveness.js` treats `EPERM` as alive, and a recycled Windows PID can be alive but unrelated.

- `ai-developer-toolkit/plugins/crews/hooks/health.js`
  - Member launcher health already has a stronger Windows recycle-safety pattern via `describeProcess` and `verifyLauncherRecycleSafety`.
  - The listener path does not yet have an equivalent identity-aware helper.

- `ai-developer-toolkit/plugins/crews/hooks/pre-tool-use.js`
  - When listener state is not armed, PreToolUse blocks before any non-arm tool and prints the exact engine-specific arm command.
  - If unarmed plus unreviewed mail exists, the v3.20 review-mail-first gate tells the actor to drain review-mail first, then arm against a clean mailbox.

- `ai-developer-toolkit/plugins/crews/hooks/stop.js`
  - Lead Stop requires an armed listener every turn.
  - Stop opportunistically consumes mailbox entries with `via='stop-hook'` only when derived listener state is not armed. If a stale/recycled PID leaves derived state as armed, Stop intentionally defers to the nonexistent listener.

Existing tests to preserve or extend:

- `tests/listener.test.js` covers initial listener delivery and `lastListenerPid`.
- `tests/listener-redundant-arm-skip.test.js` and `tests/duplicate-listener-exited-rearm.test.js` pin duplicate-arm guard behavior.
- `tests/actor-state-stale-armed.test.js` covers stale heartbeat and dead PID demotion.
- `tests/stop-hook-consumes-when-listener-exited.test.js` and `tests/stop-hook-defers-to-armed-listener.test.js` pin Stop's consume-vs-defer behavior.
- `tests/pretooluse-review-mail-first.test.js` pins review-mail-first ordering for unarmed plus review-pending actors.
- `tests/listener-eperm-recovery.test.js` covers heartbeat write classification and transient rename recovery.
- Full crews suite runs with `cd ai-developer-toolkit/plugins/crews && node tests/run.js`; AGENTS says clear inherited `CREWS_*`, `CLAUDE_*`, and `COPILOT_*` env when running from a Ralph member.

## Architect Analysis

The plan should avoid a detached listener and avoid a separate long-lived watchdog process. A separate session-bound supervisor has the same reap surface as the listener, and a detached supervisor violates the operator constraint. The correct mechanism is:

1. Harden the listener process itself against the internal drain candidate:
   - Recreate `fs.watch` on `error` and `close` with bounded backoff.
   - Add a ref'd parent/session-liveness anchor inside the listener so loss of the `fs.watch` handle cannot leave the event loop with zero ref'd handles.
   - The anchor must exit when the parent/session owner is gone; it must not become an orphan zombie.
   - Keep the heartbeat and poll timers unref'd so existing orphan-prevention semantics stay intact.

2. Add cause-classifying observability:
   - `process.on('exit')` logs `listener-unexpected-exit` if `resolved === false`.
   - SIGTERM/SIGINT/SIGHUP/SIGBREAK handlers best-effort log, call `markExited`, and exit.
   - Decision table: signal log means graceful runtime kill; exit code 0 with unresolved means internal drain; no exit/signal log plus process gone means SIGKILL-class external reap.

3. Replace bare listener PID liveness with identity-aware listener liveness:
   - Add a listener identity helper that can classify `lastListenerPid` as this listener, foreign/recycled, dead, or unknown.
   - On Windows, reuse existing process description/CIM seams where practical and verify the process command line looks like `node ... crews.js arm` or `wait-for-message.js` for the same name, crew, state cwd, and session id. Match process creation time or manifest spawn time within a small tolerance.
   - Hook `deriveListenerState`, `markArmIntent`, and `markArmed(requireFreshArm)` through this helper so recycled/foreign PIDs demote to `exited` on the next turn instead of waiting for the heartbeat stale floor.
   - On unknown/unverifiable platforms, preserve the conservative fallback and rely on heartbeat stale demotion.

4. Preserve the delivery contract:
   - Delivery correctness is already mailbox-backed: messages remain queued until `consumeMailbox` drains them.
   - The implementation must add an explicit end-to-end dead-window test: arm, kill the listener mid-idle, enqueue a member `done`, re-arm, and assert the first delivery is `via='initial'`, mailbox history is durable, and no duplicate drain occurs.
   - This cannot promise wall-clock delivery while no session-bound process or hook is running after an external SIGKILL-class reap. Under the no-detach constraint, the enforceable bound is from the next lead session-bound event/re-arm to `via=initial` delivery. The plan should state that boundary explicitly so implementation is not judged against an impossible no-turn real-time wake.

## Codex Research

Codex plan member research was performed in-session against the isolated plan worktree. The key source conclusion is that the selected direction is viable if it is scoped as "zero loss plus immediate next re-arm delivery" rather than "a dead listener keeps delivering in real time." The listener process can be made robust against the internal drain candidate, but no in-process change can survive SIGKILL or a runtime reap of that process.

Recommended implementation shape:

- Add a small listener-watch manager inside `listener-loop.js` rather than a standalone supervisor process.
- Add a new `hooks/listener-identity.js` or equivalent helper for listener PID ownership checks, with injectable seams for unit tests.
- Update `actors.touchHeartbeat` and `actor-state.deriveListenerState` to consume that helper.
- Add integration tests around `crews.js arm` or `tools/wait-for-message.js`, not only pure helper tests, so the `via=initial` recovery contract is exercised through real mailbox files.

## Copilot Research

Not run. `copilot` was not available in PATH in this Codex member environment.

## Consolidated File List

Files to modify:

- `ai-developer-toolkit/plugins/crews/lib/listener-loop.js`
- `ai-developer-toolkit/plugins/crews/hooks/actors.js`
- `ai-developer-toolkit/plugins/crews/hooks/actor-state.js`
- `ai-developer-toolkit/plugins/crews/hooks/health.js`
- `ai-developer-toolkit/plugins/crews/hooks/process-liveness.js` if a shared primitive needs widening
- `ai-developer-toolkit/plugins/crews/hooks/listener-protocol.js` if arm command metadata or docs wording changes
- `ai-developer-toolkit/plugins/crews/hooks/pre-tool-use.js`
- `ai-developer-toolkit/plugins/crews/hooks/stop.js`
- `ai-developer-toolkit/plugins/crews/hooks/protocol/manifest.js` if new manifest fields should be typed
- `ai-developer-toolkit/plugins/crews/AGENTS.md`
- `ai-developer-toolkit/plugins/crews/CHANGELOG.md`
- `ai-developer-toolkit/plugins/crews/.claude-plugin/plugin.json`
- `ai-developer-toolkit/plugins/crews/.codex-plugin/plugin.json`
- `ai-developer-toolkit/plugins/crews/.github/plugin/plugin.json`
- `ai-developer-toolkit/.claude-plugin/marketplace.json`
- `ai-developer-toolkit/.github/plugin/marketplace.json`
- `ai-developer-toolkit/.agents/plugins/marketplace.json`
- `ai-developer-toolkit/plugins/crews/tests/version.test.js`

Files to create:

- `ai-developer-toolkit/plugins/crews/hooks/listener-identity.js`
- `ai-developer-toolkit/plugins/crews/tests/listener-identity-recycle.test.js`
- `ai-developer-toolkit/plugins/crews/tests/listener-watch-recreate.test.js`
- `ai-developer-toolkit/plugins/crews/tests/listener-dead-window-recovery.test.js`

Existing tests likely to update:

- `ai-developer-toolkit/plugins/crews/tests/listener-redundant-arm-skip.test.js`
- `ai-developer-toolkit/plugins/crews/tests/duplicate-listener-exited-rearm.test.js`
- `ai-developer-toolkit/plugins/crews/tests/actor-state-stale-armed.test.js`
- `ai-developer-toolkit/plugins/crews/tests/stop-hook-consumes-when-listener-exited.test.js`
- `ai-developer-toolkit/plugins/crews/tests/stop-hook-defers-to-armed-listener.test.js`
- `ai-developer-toolkit/plugins/crews/tests/pretooluse-review-mail-first.test.js`

Build/config:

- The crews plugin has no package-level `package.json`. Use `node --check` for touched JS files and `node tests/run.js` for the full suite.
- Version bump should use `node plugins/crews/scripts/bump-version.js <next-version>` from the toolkit root.
