# Codex `/goal` continuation turn: conversation context and history persistence

## Summary for the operator

A `/goal` auto-continuation turn is **not** a fresh thread and it does **not** get a special reduced prompt. It reuses the same session-scoped `ContextManager` history, then appends the continuation turn's normal context setup and the hidden user-role `<goal_context>` message before sampling the next model response. Prior user/assistant messages, reasoning items, tool calls, tool outputs, shell-call items, and similar `ResponseItem`s carry forward into the continuation, subject to the same history rules as any other regular turn. What can shrink that context is only the **normal compaction/truncation pipeline**: tool outputs may already have been truncated when recorded, and pre-turn auto-compaction can replace older raw history with a compacted summary + selected user messages before the continuation turn runs. `budget_limited` matters only insofar as a goal that has flipped out of `active` will no longer auto-continue, and a one-shot budget-limit steering `<goal_context>` may be injected into the current active turn instead of starting a new continuation.  
Sources: `core/src/goals.rs:1270-1433,1557-1613`; `core/src/tasks/mod.rs:891-911`; `core/src/session/turn.rs:143-175,216-236,885-901`; `core/src/session/mod.rs:2577-2597,2720-3009`; `core/src/state/session.rs:23-107`; `core/src/context_manager/history.rs:32-123,362-501`; `core/src/compact.rs:175-205,268-294,397-537`; `core/src/hook_runtime.rs:566-584`

## 1. Which context is assembled for the continuation turn?

`Session::on_task_finished()` clears the finished active turn and then fires `GoalRuntimeEvent::MaybeContinueIfIdle`. That event reaches `maybe_start_goal_continuation_turn()`, which reserves a fresh `ActiveTurn`, queues exactly one pending input item (`goal_context_input_item(continuation_prompt(&goal))`), creates a new default turn context, and starts `RegularTask::new()` with **`Vec::new()` task input**. In other words: the continuation turn itself is created with empty explicit user input, and the hidden goal continuation prompt is delivered through the session input queue as a pending `ResponseInputItem`, not as a new thread or a bespoke prompt type.  
Sources: `core/src/tasks/mod.rs:891-911`; `core/src/goals.rs:1270-1357,1428-1433`

The hidden continuation payload is a `GoalContext`, which serializes as a **user-role** message wrapped in `<goal_context>...</goal_context>`. The concrete continuation text comes from `core/templates/goals/continuation.md`, rendered with the goal objective plus token-usage/budget fields.  
Sources: `core/src/context/goal_context.rs:20-35`; `core/src/goals.rs:1534-1555,1607-1613`; `core/templates/goals/continuation.md:1-51`

Once the regular turn starts, `run_turn()` does **not** build a continuation-specific reduced request. It first runs the standard pre-sampling compact check, then records this turn's ordinary context setup (`record_context_updates_and_set_reference_context_item()`), then records skill/plugin injections, then records the drained pending input items, and only then snapshots the prompt input from `sess.clone_history().await.for_prompt(...)`. That means the continuation request sees the normal session history plus the new turn's context/setup items plus the hidden `<goal_context>` item.  
Sources: `core/src/session/turn.rs:143-175,216-236`; `core/src/session/mod.rs:2979-3009`

`ContextManager::for_prompt()` itself does not create a reduced summary view. It clones the current history, runs `normalize_history()` (fill missing call outputs, drop orphan outputs, strip images for non-image models), and returns the resulting `Vec<ResponseItem>`. The comment on `ContextManager.items` is explicit that items are stored oldest-to-newest.  
Sources: `core/src/context_manager/history.rs:32-51,98-123,362-375`

## 2. What from previous turns persists into the continuation?

The continuation turn reuses the same session-level history store: `SessionState` owns a single `history: ContextManager`, and `Session::clone_history()` just clones that existing state. `maybe_start_goal_continuation_turn()` does not replace, clear, or fork it; it only creates a fresh **turn context/sub-id** for the same session. So this is a fresh turn on the **same thread/session history**, not a fresh thread with summary-only carry-over.  
Sources: `core/src/state/session.rs:23-107`; `core/src/session/mod.rs:2956-2959`; `core/src/session/turn_context.rs:750-779`; `core/src/goals.rs:1275-1357`

What persists in that history is whatever got recorded as model-visible `ResponseItem`s on earlier turns. `record_conversation_items()` appends items into history, persists them to rollout, and emits them. `ContextManager::record_items()` then keeps every `is_api_message(...)` item. That allowlist includes ordinary messages, reasoning items, function/tool calls, function/custom tool outputs, local shell calls, tool-search calls/outputs, web-search calls, image-generation calls, and compaction items. It excludes only non-model/system-style items such as `role == "system"`, `CompactionTrigger`, and `Other`.  
Sources: `core/src/session/mod.rs:2577-2597`; `core/src/context_manager/history.rs:98-123,377-501`

That means prior assistant messages, prior reasoning content, prior tool calls, and prior tool outputs are all part of the continuation prompt history if they were recorded on earlier turns. The streaming path records them as they complete: tool-call items are persisted immediately when emitted, and non-tool items like assistant messages/reasoning are also persisted through the same `record_completed_response_item... -> record_conversation_items()` path.  
Sources: `core/src/stream_events_utils.rs:143-180,350-420,455-470`

The continuation's own hidden `<goal_context>` prompt is also persisted into history before the first model sample of that continuation turn. Because the continuation task starts with empty explicit `input`, `run_turn()` immediately drains pending turn-state input on its first loop iteration; `record_pending_input()` converts each `TurnInput::ResponseInputItem` into a `ResponseItem` and appends it to history.  
Sources: `core/src/session/turn.rs:170,216-236`; `core/src/hook_runtime.rs:566-584`

One important nuance: persistence is **not byte-for-byte raw forever**. When `ContextManager` records a `FunctionCallOutput` or `CustomToolCallOutput`, it runs those payloads through `truncate_function_output_payload(...)` using the turn truncation policy. So file reads / command outputs / other tool outputs do carry forward, but possibly in truncated form. Messages and reasoning items are cloned without that tool-output truncation step.  
Sources: `core/src/context_manager/history.rs:377-412,462-479`

## 3. What gets dropped, compacted, or summarized between continuations?

There is no goal-specific "reduce the thread before continuing" path. What applies is the normal **pre-turn auto-compaction** that every regular turn runs. `run_turn()` calls `run_pre_sampling_compact()` before recording new turn context or new input. That helper computes token status from session history (`active_context_tokens`) and triggers auto-compaction when either the configured auto-compact limit is reached or, for `BodyAfterPrefix`, the effective model context window is exhausted; it can also compact pre-turn when the model switches to a smaller context window.  
Sources: `core/src/session/turn.rs:143-159,647-775`

When compaction runs, it clones the existing history, adds the synthetic compaction prompt as input for the compact task, gets a model-produced summary, then replaces session history with `build_compacted_history(...)`. That replacement history keeps:

1. selected **user messages** (up to the configured token limit for compacted user-message replay), and
2. a final **user-role summary message** containing `SUMMARY_PREFIX` plus the generated summary text.

The old raw assistant/tool/reasoning history is **not** preserved as raw items after compaction; it survives only insofar as the summary captures it. For pre-turn/manual compaction, `InitialContextInjection::DoNotInject` is used, so `reference_context_item` is cleared and the **next regular turn** will re-add full initial context through `record_context_updates_and_set_reference_context_item()`.  
Sources: `core/src/compact.rs:175-205,268-294,397-537`; `core/src/session/mod.rs:2966-3009`

So the right model is: the continuation normally sees the full accumulated history, **unless** normal compaction has already rewritten that history into "selected past user messages + compaction summary", after which the continuation turn proceeds from that compacted transcript plus freshly re-injected current-turn context and the new `<goal_context>`.  
Sources: `core/src/compact.rs:274-294,474-537`; `core/src/session/mod.rs:2966-3009`

`budget_limited` is related but separate. Goal accounting can flip the persisted goal status from `active` to `budget_limited`, and when that happens codex may inject a one-shot budget-limit steering `<goal_context>` into the **current** active turn telling the model to stop starting new substantive work and wrap up. But the continuation launcher itself only continues when the persisted goal status is exactly `active`; once the status is `budget_limited` (or any other non-active state), `goal_continuation_candidate_if_active()` declines to start another turn. This is not history summarization; it is a goal-status gate on whether another continuation turn should exist at all.  
Sources: `core/src/goals.rs:1399-1417`; `core/src/goals.rs:963-1082,1557-1613`

## 4. Exact assembled prompt order for a continuation turn

The model request has two top-level parts in `Prompt`:

1. `base_instructions` (separate field, not a history item), and
2. `input: Vec<ResponseItem>` (the assembled conversation/context history).

`build_prompt(...)` places those separately into `Prompt`, and `run_sampling_request()` fills `base_instructions` from `sess.get_base_instructions().await` while using the history snapshot as `input`.  
Sources: `core/src/client_common.rs:23-46`; `core/src/session/turn.rs:885-901,914-960`; `core/src/session/mod.rs:1181-1189`

For the **first sampling request** of a goal continuation turn, the ordering of `Prompt.input` is:

1. the already-carried session history from prior turns (`SessionState.history`, oldest -> newest),
2. this turn's context setup items from `record_context_updates_and_set_reference_context_item()`:
   - full initial context if `reference_context_item` is missing, otherwise
   - steady-state settings diff items,
3. any skill/plugin injection items for this turn,
4. the drained pending input items for this turn, which for goal continuation includes the hidden user-role `<goal_context>` message,
5. any hook-added extra context recorded after those pending inputs.

The decisive sequencing is in `run_turn()`: pre-sampling compaction -> context updates -> skill/plugin recording -> pending-input recording -> `clone_history().for_prompt(...)`.  
Sources: `core/src/session/turn.rs:143-175,216-236`; `core/src/session/mod.rs:2979-3009`; `core/src/hook_runtime.rs:566-584`

So `<goal_context>` sits **after** the carried-over prior history and after the new turn's ordinary initial-context/settings-diff items; it is not prepended ahead of the prior transcript, and it is not outside the history list. The only thing "above" it in the request is `Prompt.base_instructions`, which are supplied out-of-band from the `input` array rather than as a history message.  
Sources: `core/src/session/turn.rs:230-236,885-901,914-960`; `core/src/client_common.rs:23-46`
