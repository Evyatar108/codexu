# Stories Outline: Crews Listener Silent Reap Across Idle

*Preliminary decomposition from `/plan-with-ralph`. Feed to `/implement-with-ralph --from-plan` for PRD generation.*

## US-001: Harden Listener Loop Against Internal Drain

**Description:** As a crews lead, I want the session-bound listener process to survive `fs.watch` failures and classify unresolved exits so that internal event-loop drain cannot silently masquerade as an external reap.

**Acceptance Criteria:**

- [ ] `listener-loop.js` recreates `fs.watch` on `error` and `close` with bounded backoff.
- [ ] `listener-watch-error` / `listener-watch-close` telemetry is logged without terminating the listener.
- [ ] A ref'd parent/session-liveness anchor keeps the listener alive if `fs.watch` disappears and exits when orphaned.
- [ ] Heartbeat and poll timers remain unref'd.
- [ ] Unresolved `exit` and signal handlers write classification telemetry.
- [ ] `node --check` passes for touched JS files.
- [ ] Targeted watcher recreation tests pass.

**Dependencies:** None

**Estimated complexity:** large

## US-002: Add Listener Identity-Aware Liveness

**Description:** As a crews actor, I want listener liveness to verify that a stored PID belongs to this listener so that PID recycle or foreign live processes cannot block re-arm.

**Acceptance Criteria:**

- [ ] New listener identity helper classifies listener PID state as alive, dead, foreign, or unknown.
- [ ] Windows process checks verify command line/session/name/crew evidence where available.
- [ ] `actor-state.js` demotes foreign/dead listener PIDs to `exited`.
- [ ] `actors.js` duplicate-arm guards allow re-arm for foreign/dead PIDs and preserve `already-active-listener` for real active listeners.
- [ ] Existing duplicate listener tests are updated and pass.
- [ ] New recycled/foreign PID unit tests pass.
- [ ] Typecheck-equivalent `node --check` passes for touched JS files.

**Dependencies:** US-001

**Estimated complexity:** large

## US-003: Assert Dead-Window Recovery Through Hooks

**Description:** As an orchestrator, I want mail written while a listener is dead to be delivered on the next session-bound re-arm initial scan so that a member report is never lost.

**Acceptance Criteria:**

- [ ] Integration test arms a listener, kills it mid-idle, enqueues a member `done`, then re-arms.
- [ ] Re-arm returns `type='messages'` and `via='initial'`.
- [ ] Mailbox history records the consumed row and the mailbox is empty after delivery.
- [ ] No duplicate drain occurs when a superseding listener epoch exists.
- [ ] PreToolUse review-mail-first fires for identity-demoted unarmed plus review-pending state.
- [ ] Stop opportunistic delivery consumes only when derived listener state is not truly armed.
- [ ] The test asserts the latency bound from re-arm start to initial-scan delivery.

**Dependencies:** US-002

**Estimated complexity:** large

## US-004: Release Surfaces And Full Verification

**Description:** As the plugin maintainer, I want docs, version stamps, and the full test gate updated so that the shipped behavior is discoverable and safely installable across engines.

**Acceptance Criteria:**

- [ ] `ai-developer-toolkit/plugins/crews/AGENTS.md` documents the dead-window contract and no-turn limitation.
- [ ] `ai-developer-toolkit/plugins/crews/CHANGELOG.md` records the fix.
- [ ] `node plugins/crews/scripts/bump-version.js <next-version>` updates plugin manifests, marketplaces, and `tests/version.test.js`.
- [ ] Full suite passes from `ai-developer-toolkit/plugins/crews`: `node tests/run.js`.
- [ ] Test command is run with inherited live `CREWS_*`, `CLAUDE_*`, and `COPILOT_*` session env scrubbed.
- [ ] Implementation commit includes the toolkit commit and codexu submodule pointer bump as appropriate for the impl phase.

**Dependencies:** US-003

**Estimated complexity:** medium
