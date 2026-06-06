---
overviewTaskId: crews-arm-chaining-footgun-guard
---

## Direction
D-001 - Fail-loud redirected immediate-return arm envelopes. The lowest-surface fix is to make `arm` itself impossible to swallow silently when it returns without becoming the live listener, while leaving the normal long-running listener loop and already-active-listener contract intact.

## Goal
Crews lead sessions that accidentally run `crews.js arm` in a piped, redirected, or chained foreground shape get an immediate visible stderr warning and a failing status for no-new-listener outcomes, so they cannot silently believe they are armed when no listener was started.

## Scope
### In Scope
- Add a small helper in `plugins/crews/lib/listener-loop.js` that classifies stdout as redirected/non-interactive and wraps immediate-return envelopes from `runListenerLoop`.
- For `arm-skipped` reasons that mean this process did not become a usable listener for the current actor, print explicit stderr guidance and return non-zero by default when stdout is redirected.
- Preserve legitimate standalone async/foreground listener behavior: a successful new listener still blocks and heartbeats as today, delivers mail as today, and exits through the existing `messages`, `timeout`, or `error` paths.
- Preserve a deliberate machine-readable escape hatch for tests or automation that intentionally captures the JSON envelope.
- Add regression coverage near `tests/listener-redundant-arm-skip.test.js` using injected or spawned non-TTY stdout to prove the swallowed-envelope path is loud, plus coverage that the explicit opt-in keeps existing JSON parsing viable.

### Out of Scope
- Rewriting PreToolUse arm recognition or reintroducing shell command tokenization for pipelines and separators.
- Changing `getListenerState`, `deriveListenerState`, stale PID/heartbeat demotion, listener epochs, or mailbox-drain ownership.
- Chaining into plan or implementation work from this brainstorm.

## Criteria
- `arm | Out-Null; <next cmd>`-style invocations no longer make no-new-listener outcomes silent: stderr includes a clear "no background listener was started" message and the process exits non-zero unless machine mode is explicitly enabled.
- A normal first arm still records `listenerState='armed'`, `lastListenerPid`, and listener epoch, then waits for mailbox delivery or timeout exactly as before.
- A redundant arm against an actually live listener remains safe and does not kill or replace the owning listener; any new stderr advisory for that path must say that an existing live listener is already active.
- Existing scripted JSON consumers have a documented opt-in path and tests proving the old parseable JSON envelope remains available.

## Context
The arm path is small: `tools/crews.js` dispatches `arm` to `lib/listener-loop.js::runListenerLoop`, which calls `markArmed(... requireFreshArm: true)` from `hooks/listener-protocol.js`. The authoritative skip decisions come from `hooks/actors.js::touchHeartbeat`: `session-mismatch`, `recoverable-pending-takeover`, and `already-active-listener`. Stale armed manifests are already handled separately by `actor-state.js::deriveListenerState` and PID/heartbeat liveness, so this brainstorm should not change listener state semantics.

The dangerous user experience is the one-shot stdout JSON envelope. When a lead pipes stdout to `Out-Null`, the envelope can disappear. A hook-level parser would be broader and more brittle; the existing comments in `listener-protocol.js` explain why deep shell parsing was intentionally removed. A doc-only change does not meet the "prevent silently" bar. The recommended plan keeps the edit local to the `arm` return path and uses stderr plus non-zero exit as the product-level guard.
