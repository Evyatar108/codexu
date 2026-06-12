# codex-v1-agent-thread-limit-not-released-on-completion

## Verdict

The operator's working hypothesis is **not** what the current code does. There is **no missing "release on completion" path** because the limit is intentionally applied to **open agent threads**, not only to currently running agent turns.

What saturates is the session's count of still-open spawned agents. A child that reaches `Completed(...)` or `Errored(...)` remains open and reusable until something explicitly closes it. The slot is only freed on:

1. failed spawn/resume before commit,
2. explicit shutdown / `close_agent`,
3. `InternalAgentDied`.

So the symptom ("spawn fails even though no agents are currently running") is real, but the root cause is **lifecycle semantics / UX mismatch**, not a leaked counter on the completion path.

## 1. Where the limit is defined and enforced

### v1 (Collab)

- The v1 spawn path goes through `core/src/tools/handlers/multi_agents/spawn.rs:123-140`, which calls `session.services.agent_control.spawn_agent_with_metadata(...)`.
- `AgentControl::spawn_agent_internal(...)` acquires the slot at `core/src/agent/control.rs:213-283`, specifically `let mut reservation = self.state.reserve_spawn_slot(config.agent_max_threads)?;` at `core/src/agent/control.rs:221`.
- The actual counter lives in `core/src/agent/registry.rs:23-26` as `total_count: AtomicUsize`.
- Enforcement happens in `core/src/agent/registry.rs:80-97`:
  - `reserve_spawn_slot(...)` calls `try_increment_spawned(max_threads)`.
  - `try_increment_spawned(...)` enforces the cap at `core/src/agent/registry.rs:275-290`.
  - On overflow it returns `CodexErr::AgentLimitReached { max_threads }` at `core/src/agent/registry.rs:84-87`.
- The underlying literal error is `protocol/src/error.rs:86-87`: `"agent thread limit reached"`.
- The v1/v2 tool wrapper converts that to `FunctionCallError::RespondToModel(format!("collab spawn failed: {err}"))` in `core/src/tools/handlers/multi_agents_common.rs:118-125`, so the tool-facing text is effectively `collab spawn failed: agent thread limit reached`.
- The TUI then renders spawn failure as `Agent spawn failed` in `tui/src/multi_agents.rs:274-303`.

### v2 (same underlying limiter)

- v2 uses the same `AgentControl` / `AgentRegistry` path: `core/src/tools/handlers/multi_agents_v2/spawn.rs:129-161` also calls `spawn_agent_with_metadata(...)`, which reaches the same `reserve_spawn_slot(...)`.
- The v2 config is exposed as `features.multi_agent_v2.max_concurrent_threads_per_session` in `core/src/config/mod.rs:1001-1033`.
- When MultiAgentV2 is enabled, config compilation maps that to `agent_max_threads = max_concurrent_threads_per_session.saturating_sub(1)` at `core/src/config/mod.rs:3089-3103`. In other words, v2's user-facing limit counts **all open threads in the session tree**, while the internal spawned-agent counter excludes the root thread by subtracting one.

## 2. Acquire vs release trace

### Acquire

Slots are acquired in two places:

1. fresh spawn: `core/src/agent/control.rs:221`
2. resume from rollout: `core/src/agent/control.rs:593`

In both cases the reservation is committed after the new thread is created / resumed:

- fresh spawn commit: `core/src/agent/control.rs:282-284`
- resume commit: `core/src/agent/control.rs:656-658`

Commit stores the thread in the registry and keeps the slot occupied:

- `SpawnReservation::commit(...)` at `core/src/agent/registry.rs:323-328`
- `register_spawned_thread(...)` at `core/src/agent/registry.rs:183-200`

### Release

A committed slot is released only on explicit close/shutdown or hard failure:

1. failed spawn/resume before commit:
   - `SpawnReservation::drop(...)` decrements `total_count` when `self.active` is still true at `core/src/agent/registry.rs:331-339`
2. explicit shutdown / close:
   - `shutdown_live_agent(...)` removes the thread and calls `release_spawned_thread(agent_id)` at `core/src/agent/control.rs:767-784`
   - `close_agent(...)` funnels into that path via `shutdown_agent_tree(...)` at `core/src/agent/control.rs:789-812`
3. transport/process failure:
   - `handle_thread_request_result(...)` releases only on `CodexErr::InternalAgentDied` at `core/src/agent/control.rs:752-763`

The registry-side release primitive is `release_spawned_thread(...)` at `core/src/agent/registry.rs:99-119`.

## 3. Completion / abort / error paths do **not** release

This is the key finding.

### Status transitions

Final statuses are derived purely from events in `core/src/agent/status.rs:6-28`:

- `TurnComplete` -> `AgentStatus::Completed(...)`
- `TurnAborted` -> `Interrupted` or `Errored(...)`
- `Error` -> `Errored(...)`
- `ShutdownComplete` -> `Shutdown`

`Session::deliver_event_raw(...)` only updates the watch channel:

- `core/src/session/mod.rs:1817-1821`

There is **no** call to:

- `remove_thread(...)`
- `release_spawned_thread(...)`
- `shutdown_live_agent(...)`

from the terminal turn event path.

### v1 completion watcher

The v1 watcher in `core/src/agent/control.rs:995-1067` waits for a final status and then only notifies the parent thread. It never removes the child thread from the manager and never releases the registry slot.

### v2 completion forwarding

The v2 terminal-turn path in `core/src/session/mod.rs:1689-1781` forwards a completion envelope to the parent. Again, it does not close the child and does not release the slot.

## 4. Why this is intentional, not a leak

The surrounding API/docs make the intended lifecycle explicit:

- v2 spawn description says the session limit is for **"concurrently open agent threads"** at `core/src/tools/handlers/multi_agents_spec.rs:699-724`.
- v1 `send_input` explicitly tells the model to **reuse** an existing agent when prior context matters at `core/src/tools/handlers/multi_agents_spec.rs:111-146`.
- v2 `followup_task` likewise targets an existing non-root agent for another turn at `core/src/tools/handlers/multi_agents_spec.rs:180-204`.
- `close_agent` in both v1 and v2 says to close agents **when they are no longer needed** and warns not to keep them open too long at `core/src/tools/handlers/multi_agents_spec.rs:278-313`.

The tests also assume post-completion reuse:

- `core/src/tools/handlers/multi_agents_tests.rs:1947-1974` sends `followup_task` to the same v2 agent after an earlier `TurnComplete`, proving completion does **not** imply disposal.
- `core/src/tools/handlers/multi_agents_tests.rs:3807-3843` shows that `close_agent` is the operation that transitions the agent to `NotFound`.

Registry bookkeeping matches that design:

- `live_agents()` in `core/src/agent/registry.rs:155-166` counts every non-root entry with an `agent_id`, regardless of whether its last status is `Running`, `Completed`, or `Errored`.

## 5. Root cause

**Root cause:** the session-level cap is tied to **open spawned-agent threads**, not to active/running work. A finished child still occupies a registry slot until the caller closes it. Therefore a session can hit the cap even when zero agents are currently running.

That is why the observed v1 symptom happens.

## 6. Fix recommendation

### Recommended fix

Treat this as a **UX / contract fix**, not as a "release on completion" bugfix.

Concrete recommendation:

1. improve the limit error/help text to say **open** agent limit, not running-agent limit;
2. explicitly hint that the user/model should `close_agent` completed agents that are no longer needed;
3. optionally include currently open agent names/paths in the error context.

The lowest-risk seam is the error surface around:

- `core/src/tools/handlers/multi_agents_common.rs:118-125`
- possibly the spawn-agent tool descriptions in `core/src/tools/handlers/multi_agents_spec.rs`

### Not recommended as a minimal fix

Do **not** blindly release slots on `TurnComplete` / `TurnAborted` / `Error`.

That would break the current model where:

- completed agents remain messageable/reusable (`send_input`, `followup_task`),
- `close_agent` is the explicit lifecycle boundary,
- the limit is documented as applying to open agent threads.

If product intent truly changes to "finished agents should free their slot automatically", that is a larger upstream behavior change: it would need a redesign of reusable-vs-closed agent semantics, not just a one-line decrement.

## 7. Fork vs upstream

This behavior is **upstream-native**, not fork-introduced.

Evidence:

- the lifecycle / counter code is in upstream-canonical files with **no** `// SANDBOX PATCH:` markers in the relevant logic:
  - `core/src/agent/registry.rs`
  - `core/src/agent/control.rs`
  - `core/src/agent/status.rs`
  - `core/src/session/mod.rs` (completion forwarding)
- the fork's documented multi-agent patches are the `plugin-scope-axis` gates called out in `docs/implementation/patch-surface.md:808-809, 906-920, 1108-1120` and in:
  - `core/src/tools/handlers/multi_agents/spawn.rs:55-61`
  - `core/src/tools/handlers/multi_agents_v2/spawn.rs:57-63`
  - `tools/src/tool_config.rs:223-229`

Those fork deltas only restrict where `spawn_agent` is available; they do **not** alter slot acquisition/release or terminal-status cleanup.

## 8. v1 vs v2 scope

This behavior affects **both** v1 and v2.

- v1 and v2 both spawn through `AgentControl::spawn_agent_with_metadata(...)`, which acquires from the same `AgentRegistry`.
- v1 completion watcher does not release.
- v2 terminal-turn forwarding does not release.
- both rely on explicit `close_agent` / shutdown to free the slot.

The only notable difference is configuration:

- v1 uses `agents.max_threads`
- v2 uses `features.multi_agent_v2.max_concurrent_threads_per_session`, which is then mapped to `agent_max_threads = limit - 1` because the root thread is included in the v2 user-facing count

But the underlying saturation behavior is shared.
