# How codex `/goal` works

## Summary for the operator

`/goal` is a built-in TUI slash command for a **persisted thread-scoped goal**, not a free-form prompt shortcut. Bare `/goal` shows the current goal summary; `/goal <text>` stores or replaces the objective; `/goal edit|pause|resume|clear` mutate the same persisted goal record. The goal is stored in the thread state DB, surfaced in the TUI footer/status area, exposed to the model through `get_goal` / `create_goal` / `update_goal` tools, and injected as hidden `<goal_context>` only at specific runtime moments (continuations, edits, budget-limit steering), not indiscriminately on every turn.  
Sources: `external/repos/codex-patched/codex-rs/tui/src/slash_command.rs:12-17,37-38,79-117,146-164`; `external/repos/codex-patched/codex-rs/tui/src/chatwidget/slash_dispatch.rs:35-36,228-241,505-515,653-750`; `external/repos/codex-patched/codex-rs/state/src/runtime/goals.rs:36-62,64-119,170-317,371-397`; `external/repos/codex-patched/codex-rs/core/src/goals.rs:421-432,434-579,1270-1434,1530-1616`

## 1. Registration / surface

`/goal` is a **real built-in slash command**. It is the `Goal` variant in the TUI `SlashCommand` enum, and enum order is the popup presentation order. Its popup description is `"set or view the goal for a long-running task"`, and the slash-command metadata marks it as supporting inline arguments. It is also allowed while a task is running.  
Sources: `external/repos/codex-patched/codex-rs/tui/src/slash_command.rs:12-17,37-38,79-117,146-164,179-232`

The slash-command popup/lookup layer additionally gates `/goal` behind `goal_command_enabled`, which is driven by `Feature::Goals`. If that feature is off, `/goal` is hidden from lookup and exact-match resolution.  
Sources: `external/repos/codex-patched/codex-rs/tui/src/bottom_pane/slash_commands.rs:57-84,109-123,252-257`; `external/repos/codex-patched/codex-rs/tui/src/chatwidget/settings.rs:323-325`

The TUI accepts two surface forms:

1. **Bare `/goal`**: dispatches `AppEvent::OpenThreadGoalMenu`.
2. **Inline `/goal ...`**: dispatches either control operations (`edit`, `pause`, `resume`, `clear`) or a free-form objective string.

Notably, there is **no flag parser** here: the goal tests show `/goal --tokens 98.5K improve benchmark coverage` is treated as the literal objective text, not as structured flags.  
Sources: `external/repos/codex-patched/codex-rs/tui/src/chatwidget/slash_dispatch.rs:228-241,505-515,653-750`; `external/repos/codex-patched/codex-rs/tui/src/chatwidget/tests/slash_commands.rs:623-646`

## 2. Behavior / data flow

### Bare `/goal`

Bare `/goal` goes from `SlashCommand::Goal` -> `AppEvent::OpenThreadGoalMenu` -> `App::open_thread_goal_menu()`. That app-layer handler calls `app_server.thread_goal_get(thread_id)`. If there is no goal, it prints `Usage: /goal <objective>` plus `"No goal is currently set."`; otherwise it renders a goal summary in history.  
Sources: `external/repos/codex-patched/codex-rs/tui/src/chatwidget/slash_dispatch.rs:228-241`; `external/repos/codex-patched/codex-rs/tui/src/app/event_dispatch.rs:681-700`; `external/repos/codex-patched/codex-rs/tui/src/app/thread_goal_actions.rs:21-49`

### `/goal <objective>`

Inline objective text becomes `AppEvent::SetThreadGoalObjective { mode: ConfirmIfExists }`. The app layer may first read the existing goal; if a non-complete goal already exists, it shows a replace confirmation. On replace, it clears the old goal first, then sets the new one. Otherwise it calls `thread_goal_set(...)` directly.  
Sources: `external/repos/codex-patched/codex-rs/tui/src/chatwidget/slash_dispatch.rs:702-750`; `external/repos/codex-patched/codex-rs/tui/src/app/thread_goal_actions.rs:113-187,246-276,305-315`

### `/goal edit|pause|resume|clear`

`edit` opens an editor prompt seeded with the existing objective. `pause` and `resume` map to `SetThreadGoalStatus` with `Paused` and `Active`. `clear` maps to `ClearThreadGoal`.  
Sources: `external/repos/codex-patched/codex-rs/tui/src/chatwidget/slash_dispatch.rs:657-700`; `external/repos/codex-patched/codex-rs/tui/src/chatwidget/goal_menu.rs:12-33,35-68`; `external/repos/codex-patched/codex-rs/tui/src/app/thread_goal_actions.rs:81-111,189-244`

### Persistence layer

The persisted state is a single `thread_goals` row per thread, keyed by `thread_id`. The state crate exposes `get_thread_goal`, `replace_thread_goal`, `insert_thread_goal`, `update_thread_goal`, `delete_thread_goal`, and `account_thread_goal_usage`. The stored model includes `goal_id`, `objective`, `status`, `token_budget`, `tokens_used`, `time_used_seconds`, `created_at`, and `updated_at`.  
Sources: `external/repos/codex-patched/codex-rs/state/src/model/thread_goal.rs:11-69,99-114`; `external/repos/codex-patched/codex-rs/state/src/runtime/goals.rs:36-62,64-119,121-168,170-317,371-397`

### App-server bridge

The TUI does not mutate goals directly; it goes through app-server JSON-RPC methods `thread/goal/get`, `thread/goal/set`, and `thread/goal/clear`. The app-server request processor validates the feature flag, rejects ephemeral threads, reconciles rollout state, updates the persisted `thread_goals` state, replies to the client, emits ordered `thread/goal/updated` / `thread/goal/cleared` notifications, and applies runtime side effects to a running thread if one exists.  
Sources: `external/repos/codex-patched/codex-rs/tui/src/app_server_session.rs:797-849`; `external/repos/codex-patched/codex-rs/app-server-protocol/src/protocol/common.rs:497-510,1479-1480`; `external/repos/codex-patched/codex-rs/app-server/src/request_processors/thread_goal_processor.rs:92-249,251-267,270-337,339-360`

### Important non-implementation: `ext/goal`

There is also an `ext/goal` crate, but its own crate docs say it is **"intentionally not wired into the host yet."** It is not the implementation behind the live `/goal` command described above.  
Source: `external/repos/codex-patched/codex-rs/ext/goal/src/lib.rs:1-5`

## 3. Effect on the model / turns

The model-facing part of goals is **tool- and runtime-based**, not "paste the goal into every prompt forever."

### Goal tools

When goal tools are enabled for a turn, core adds three model tools: `get_goal`, `create_goal`, and `update_goal`. Their specs explicitly constrain behavior: `create_goal` starts a goal only when explicitly requested, and `update_goal` can only mark a goal `complete` or `blocked` (not pause/resume/budget-limit it).  
Sources: `external/repos/codex-patched/codex-rs/core/src/tools/spec_plan.rs:299-305,576-580`; `external/repos/codex-patched/codex-rs/core/src/tools/handlers/goal_spec.rs:12-15,16-95`

### Hidden prompt injection

Hidden goal context is represented as a `GoalContext` fragment that serializes as a **user-role** message wrapped in `<goal_context>...</goal_context>`.  
Source: `external/repos/codex-patched/codex-rs/core/src/context/goal_context.rs:5-35`

The runtime injects that hidden goal context at **specific moments**:

1. **Automatic continuation of an active goal**: when the thread is idle and the current goal is still active, core builds a continuation candidate with `goal_context_input_item(continuation_prompt(&goal))`, queues it as the next turn's input, creates a new default turn, and starts a regular task.  
   Sources: `external/repos/codex-patched/codex-rs/core/src/goals.rs:1270-1434,1530-1555,1611-1612`
2. **External objective edit while a turn is active** (for example, user runs `/goal ...` during an active run): `apply_external_thread_goal_status()` injects `goal_context_input_item(objective_updated_prompt(&goal))` into the active turn if the objective changed.  
   Sources: `external/repos/codex-patched/codex-rs/core/src/goals.rs:652-709,1577-1612`
3. **Budget limit hit mid-turn**: `account_thread_goal_progress()` injects `budget_limit_steering_item(&goal)` once for that goal and records that it has already been reported.  
   Sources: `external/repos/codex-patched/codex-rs/core/src/goals.rs:963-1082,1557-1612`

What it **does not** do is inject the goal at every turn start unconditionally. `mark_thread_goal_turn_started()` restores accounting state and marks an active goal for bookkeeping, but it does not inject goal text there.  
Source: `external/repos/codex-patched/codex-rs/core/src/goals.rs:842-899`

## 4. UI / display

Bare `/goal` prints a summary card into history with:

- status
- objective
- time used
- tokens used
- optional token budget
- command hints (`/goal edit`, `pause`/`resume`, `clear`)

The exact hint text varies by status.  
Source: `external/repos/codex-patched/codex-rs/tui/src/chatwidget/goal_menu.rs:81-139`

If the user chooses `edit`, the TUI opens a custom prompt titled **"Edit goal"** with the current objective prefilled.  
Source: `external/repos/codex-patched/codex-rs/tui/src/chatwidget/goal_menu.rs:12-33`

Separately, the TUI surfaces goal state in the footer/status-line area using `GoalStatusIndicator`. Labels include `"Pursuing goal (...)"`, `"Goal paused (/goal resume)"`, `"Goal blocked (/goal resume)"`, `"Goal hit usage limits (/goal resume)"`, `"Goal unmet (...)"`, and `"Goal achieved (...)"`.  
Sources: `external/repos/codex-patched/codex-rs/tui/src/bottom_pane/footer.rs:97-105,539-570,573-599`

The footer only shows the goal indicator when Plan mode is not taking over that slot; `update_collaboration_mode_indicator()` explicitly prefers the collaboration-mode indicator and only falls back to the goal indicator when there is no collaboration-mode label to show.  
Source: `external/repos/codex-patched/codex-rs/tui/src/chatwidget/settings.rs:632-672`

## 5. Lifecycle: clear, update, replace, resume, `/clear`, compaction

### Replace / update / clear

- `/goal <objective>` may replace an existing non-complete goal after confirmation.  
- `/goal pause` / `/goal resume` update the persisted status.  
- `/goal clear` deletes the `thread_goals` row for that thread.  
Sources: `external/repos/codex-patched/codex-rs/tui/src/app/thread_goal_actions.rs:113-187,189-244,246-315`; `external/repos/codex-patched/codex-rs/state/src/runtime/goals.rs:371-397`

### Resume

Goals are designed to survive resume because they live in persisted thread state, not only in TUI memory. On resume, app-server emits a goal snapshot and then calls `continue_active_goal_if_idle()`. Core restores runtime accounting for already-active goals via `GoalRuntimeEvent::ThreadResumed`. In the TUI, if the resumed goal is paused / blocked / usage-limited, the app prompts the user with **"Resume paused goal?"** instead of silently resuming it.  
Sources: `external/repos/codex-patched/codex-rs/state/src/runtime/goals.rs:36-62`; `external/repos/codex-patched/codex-rs/app-server/src/request_processors/thread_goal_processor.rs:59-72`; `external/repos/codex-patched/codex-rs/core/src/codex_thread.rs:172-183`; `external/repos/codex-patched/codex-rs/core/src/goals.rs:414-417,1221-1268`; `external/repos/codex-patched/codex-rs/tui/src/app/thread_goal_actions.rs:51-79`; `external/repos/codex-patched/codex-rs/tui/src/chatwidget/goal_menu.rs:35-68`

### `/clear`

`/clear` is a fresh-session operation, not a goal mutation. The TUI comment for `AppEvent::ClearUi` says it clears the terminal UI, starts a fresh session, and keeps the previous chat resumable. Since goals are stored per thread (`thread_id`) in `thread_goals`, the old thread's goal remains attached to that old resumable thread; the new thread created by `/clear` does not inherit it.  
Sources: `external/repos/codex-patched/codex-rs/tui/src/app_event.rs:190-205`; `external/repos/codex-patched/codex-rs/tui/src/app/event_dispatch.rs:30-60`; `external/repos/codex-patched/codex-rs/state/src/runtime/goals.rs:36-62`

### Compaction

I did **not** find a goal-specific compaction mutation path in the traced code. The goal store is persisted separately in `thread_goals`, keyed by `thread_id`, while `/compact` is a session/turn compaction flow rather than a goal API. Based on the traced storage model, goals appear to survive compaction within the same thread, but this is an inference from the code paths I traced rather than an explicit "goal survives compact" assertion in comments or tests.  
Sources: `external/repos/codex-patched/codex-rs/state/src/runtime/goals.rs:36-62`; `external/repos/codex-patched/codex-rs/tui/src/chatwidget/slash_dispatch.rs:188-194`

### Plan mode interaction

Goal runtime logic is intentionally suppressed in Plan mode. `should_ignore_goal_for_mode()` returns true for `ModeKind::Plan`, and several runtime entry points bail out on that condition. So an active goal is not allowed to drive automatic continuation/steering while the thread is in Plan mode.  
Sources: `external/repos/codex-patched/codex-rs/core/src/goals.rs:842-857,963-977,1172-1179,1221-1229,1363-1368,1526-1528`

## 6. Fork vs upstream

Everything I traced for `/goal` lives in the **upstream-canonical `codex-rs` submodule** (`tui`, `core`, `state`, `app-server`, `app-server-protocol`), not in the fork-only overlay crates. The fork's own policy says any upstream-canonical fork edit must be marked with `// SANDBOX PATCH:` and registered in patch-surface docs. I did not encounter such markers anywhere in the `/goal` path I traced, and goal tools are registered in the ordinary core tool plan. That strongly indicates `/goal` is an upstream codex feature, not a fork-local sandbox addition.  
Sources: `CLAUDE.md:16-21`; `external/repos/codex-patched/codex-rs/core/src/tools/spec_plan.rs:576-580`; `external/repos/codex-patched/codex-rs/tui/src/slash_command.rs:12-17,37-38,79-117`; `external/repos/codex-patched/codex-rs/core/src/goals.rs:1-6`
