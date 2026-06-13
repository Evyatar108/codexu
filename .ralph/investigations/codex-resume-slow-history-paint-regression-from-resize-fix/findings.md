# Findings

## Summary

- **Confirmed regression link:** commit `8548182d` changed resume/thread-switch history replay from a **buffered scrollback flush** into a **retained-viewport repaint path**. Resume still replays every saved turn/item through `AppEvent::InsertHistoryCell`, but the old initial replay buffer is now disabled and each replayed cell requests a frame instead of contributing to one bulk flush (`tui/src/app/thread_routing.rs:1052-1083`, `tui/src/chatwidget/replay.rs:14-63`, `tui/src/chatwidget.rs:1175-1196`, `tui/src/app/event_dispatch.rs:194-204`, `tui/src/app/resize_reflow.rs:118-127,153-159,179-189`).
- **Root cause of the slow trickle:** this is primarily **Lever 1 ("how")**, not **Lever 2 ("whether")**. The managed path already paints only the **visible tail** in the main viewport; the regression is that initial replay no longer batches history into one final paint. Instead, replayed cells arrive one-by-one, each one schedules a draw, and frame emission is capped by the frame scheduler/rate limiter (120 FPS max), so the conversation appears incrementally instead of all at once (`tui/src/chatwidget/committed_transcript.rs:109-127,155-208,212-248`, `tui/src/tui/frame_requester.rs:74-126`, `tui/src/tui/frame_rate_limiter.rs:12-35`).
- **Primary .6 fix direction:** make the retained/managed transcript viewport an **experimental feature, default OFF**, and restore the old terminal-scrollback path by default. That is the cleanest regression fix because it restores both **fast resume paint** and **native terminal scroll-up**. Then do a smaller **feature-ON polish**: suppress per-cell frame requests during initial replay and schedule **one** frame at `EndInitialHistoryReplayBuffer`.
- **Separate older bug on the old path (.4 and earlier):** the "history reprints many times when resumed work immediately starts" issue is distinct from the .5 slow-trickle regression. It comes from the old scrollback path forcing a **full transcript reflow** when an active resumed stream finalizes, not from the new retained viewport. The .5 path accidentally suppresses that by replacing stream-finalization reflow with a plain frame request (`tui/src/chatwidget/streaming.rs:19-47`, `tui/src/app/agent_message_consolidation.rs:65-90`, `8548182d^:codex-rs/tui/src/app/resize_reflow.rs:281-291,398-446`, `tui/src/app/resize_reflow.rs:295-303`).

## 1. What resume does now, and why `8548182d` is the culprit

Resume seeds the primary thread by wrapping replay in `BeginInitialHistoryReplayBuffer` / `EndInitialHistoryReplayBuffer`, then replaying every saved turn/item through `ChatWidget::replay_thread_turns(...)` (`tui/src/app/thread_routing.rs:1052-1083`). Replay is item-by-item: `replay_thread_turns()` iterates turns, then items, and routes each item through the same transcript logic used by live events (`tui/src/chatwidget/replay.rs:14-63`).

Committed replay items become `AppEvent::InsertHistoryCell` events via `add_to_history()` / `add_boxed_history()` (`tui/src/chatwidget.rs:1175-1196`). User messages are one example: replayed user turns call `on_user_message_display(...)`, which builds a committed history cell and sends it into that same path (`tui/src/chatwidget.rs:1224-1270`).

Before `8548182d`, the initial-replay buffer was real:

- `BeginInitialHistoryReplayBuffer` created `initial_history_replay_buffer` when resize reflow was enabled (`8548182d^:codex-rs/tui/src/app/resize_reflow.rs:10-13`).
- `InsertHistoryCell` during replay rendered each cell into buffered lines instead of painting immediately (`8548182d^:codex-rs/tui/src/app/event_dispatch.rs:194-218`).
- `EndInitialHistoryReplayBuffer` flushed the retained lines once into terminal scrollback (`8548182d^:codex-rs/tui/src/app/resize_reflow.rs:34-47`).

After `8548182d`, that batching was intentionally removed for the feature-on path:

- `begin_initial_history_replay_buffer()` now disables the buffer entirely when the resize-reflow feature is on (`tui/src/app/resize_reflow.rs:118-127`).
- `insert_history_cell_lines_with_initial_replay_buffer()` early-returns under that same feature-on path (`tui/src/app/resize_reflow.rs:179-189`).
- `finish_initial_history_replay_buffer()` no longer flushes buffered history; it just schedules a frame (`tui/src/app/resize_reflow.rs:153-159`).
- `AppEvent::InsertHistoryCell` under the feature-on path now just appends the cell to `transcript_cells` and schedules a frame (`tui/src/app/event_dispatch.rs:194-204`).

That is the direct regression seam: **the old one-shot initial replay flush was removed, but replay still arrives as individual history-cell events.**

## 2. Root cause of the slow paint (Lever 1: HOW)

### 2.1 What changed in cost model

**Pre-8548182d**

- Replay still processed saved turns/items one-by-one, but committed history lines were retained in a startup buffer and then flushed once at the end (`8548182d^:codex-rs/tui/src/app/event_dispatch.rs:194-218`, `8548182d^:codex-rs/tui/src/app/resize_reflow.rs:34-47`).
- The terminal therefore showed history essentially **all at once**.

**Post-8548182d**

- Replay still processes saved turns/items one-by-one.
- The old buffer is disabled (`tui/src/app/resize_reflow.rs:118-127,179-189`).
- Each replayed committed cell schedules a draw (`tui/src/app/event_dispatch.rs:194-204`).
- Draw notifications are coalesced only until the next frame deadline and then capped to 120 FPS (`tui/src/tui/frame_requester.rs:92-126`, `tui/src/tui/frame_rate_limiter.rs:12-35`).

So the visible behavior becomes: **N replayed cells -> a stream of draws -> history appears incrementally**.

### 2.2 What the retained viewport actually renders

The managed path does **not** repaint the whole transcript every frame. The main view's retained transcript renderable explicitly walks backward from the committed-cell tail until it has filled the visible area (`tui/src/chatwidget/committed_transcript.rs:160-179`), then renders only that visible suffix (`tui/src/chatwidget/committed_transcript.rs:182-208,212-248`). `visible_height()` uses the same backward walk to size the viewport (`tui/src/chatwidget/committed_transcript.rs:109-127`).

So the exact diagnosis is:

- **Not** "full transcript O(n^2) every frame".
- **Yes** "initial replay batching was removed, so history becomes visible through per-cell incremental frames".
- The per-frame work is bounded mainly by the **visible tail**, not the full backlog.

That makes **Lever 1** the primary regression. Even if the product still chooses to load every saved message, it should not trickle if replay is batched into a single final draw.

## 3. Operator design question (Lever 2: WHETHER to paint all history)

### 3.1 What the old path provided

The old path uses **native terminal scrollback** as the authoritative committed-history surface (`tui/src/insert_history.rs:1-4`). That means default-off old behavior preserves normal terminal scroll-up to older resumed history.

### 3.2 What the retained path provides now

The managed path no longer writes committed history into terminal scrollback during initial replay (`tui/src/app/resize_reflow.rs:153-159,179-189`). Instead:

- the main viewport renders only the visible committed tail (`tui/src/chatwidget/committed_transcript.rs:86-208`);
- the transcript overlay (`Ctrl+T`) owns the full committed-cell list and can scroll it in-app (`tui/src/chatwidget.rs:6-16`, `tui/src/pager_overlay.rs:393-453`).

So the managed path has already **given up native terminal scroll-up** in exchange for retained in-app history.

### 3.3 Tail-first + lazy-realize vs batch-render-all

The current managed main view is already effectively **tail-only on screen**; the reason resume is still slow is that replay still feeds **all** saved history items through `InsertHistoryCell`, one at a time. A true tail-first/lazy-realize design would therefore need more than "render fewer rows":

1. skip materializing older history cells during initial resume,
2. preserve later access for overlay / copy / transcript navigation,
3. define where older messages come from on demand (lazy replay from saved turns, or a second store).

That is a larger behavioral change.

**Recommendation:** for .6, do **not** make tail-first/lazy-realize the primary fix. The lower-risk choice is:

- **primary:** default-off experimental feature gate that restores old scrollback behavior,
- **secondary feature-ON polish:** batch the managed path's initial replay so all saved history becomes visible in a single draw,
- **defer:** tail-first/lazy-realize as a follow-up only if the opt-in managed path still needs a second speed tier.

## 4. Separate older bug on the default-off scrollback path (.4 / earlier)

This is the operator's "resume reprints history many times if the agent starts working immediately" symptom.

### 4.1 Precise source-level coupling

When a resumed stream has a live tail, `flush_answer_stream_with_separator()` marks consolidation as `ConsolidationScrollbackReflow::Required` and sends `AppEvent::ConsolidateAgentMessage` (`tui/src/chatwidget/streaming.rs:19-47`).

`handle_consolidate_agent_message()` routes that to `finish_required_stream_reflow(...)` (`tui/src/app/agent_message_consolidation.rs:65-90`).

In the **pre-8548182d** scrollback design, `finish_required_stream_reflow()` immediately forced a resize-style transcript rebuild:

- `finish_required_stream_reflow()` called `schedule_immediate_resize_reflow()` and `maybe_run_resize_reflow()` (`8548182d^:codex-rs/tui/src/app/resize_reflow.rs:281-291`);
- `maybe_run_resize_reflow()` then called `reflow_transcript_now()` (`8548182d^:codex-rs/tui/src/app/resize_reflow.rs:398-418`);
- `reflow_transcript_now()` cleared Codex-owned history and re-inserted the reflowed transcript (`8548182d^:codex-rs/tui/src/app/resize_reflow.rs:421-446`).

That is the real coupling: **active resumed work -> live-tail finalization -> required scrollback reflow -> whole-history re-emit**.

### 4.2 Why idle vs active resume differ

- **Idle resume:** only the buffered initial replay runs, so history prints once (`8548182d^:codex-rs/tui/src/app/event_dispatch.rs:194-218`, `8548182d^:codex-rs/tui/src/app/resize_reflow.rs:34-47`).
- **Active resume:** the resumed thread starts streaming immediately, and later stream finalization can call the old full reflow path above (`tui/src/chatwidget/streaming.rs:19-47`, `tui/src/app/agent_message_consolidation.rs:65-90`, `8548182d^:codex-rs/tui/src/app/resize_reflow.rs:281-291,421-446`).

So the operator's A/B isolation is directionally right, but the exact trigger is **stream-finalization reflow**, not a generic ratatui redraw loop.

### 4.3 What .5 changed here

The current retained path replaces those old stream-finalization reflows with plain frame requests:

- `maybe_finish_stream_reflow()` now just clears reflow state and schedules a frame (`tui/src/app/resize_reflow.rs:270-278`);
- `finish_required_stream_reflow()` does the same (`tui/src/app/resize_reflow.rs:295-303`).

That explains why .5 likely stops the "many full reprints while active" bug even though it introduces the slow one-by-one history paint.

### 4.4 Fix direction for the default-off path

Default-off should not regress to the old "many full reprints" behavior.

Recommended default-off fix:

1. keep the old **one-shot initial replay buffer** for resume;
2. when an active resumed stream finalizes, **do not** force `reflow_transcript_now()` unless resize repair actually happened during that stream;
3. otherwise, emit only the finalized committed cell once into scrollback and keep later redraws limited to the live/dynamic region.

In short: **decouple "committed history emission" from "full transcript resize reflow"** on the default-off path.

## 5. Flag-gate recommendation (PRIMARY .6 fix)

The retained/managed viewport should be split from `TerminalResizeReflow` and made its own **experimental feature, default OFF**.

Why this is feasible:

- the current retained behavior is already localized to a small set of TUI call sites (`tui/src/app.rs:1300-1333`, `tui/src/app/event_dispatch.rs:194-204`, `tui/src/app/resize_reflow.rs:118-127,153-159,179-189,270-303`, `tui/src/app_backtrack.rs:246-279`, `tui/src/chatwidget/rendering.rs:43-149`, `tui/src/chatwidget/committed_transcript.rs:86-248`);
- the old scrollback behavior is still present in the codebase, mostly in the non-retained branches (`tui/src/app/resize_reflow.rs:91-105,160-176,198-213,395-490`, `tui/src/app_backtrack.rs:250-279`, plus the ordinary `self.chat_widget.render(...)` path in `tui/src/app.rs:1313-1315`);
- Codex already has standardized experimental-feature plumbing in `features/src/lib.rs`, and the current resize-reflow feature is itself experimental (`features/src/lib.rs:95-96,793-800`, `features/src/tests.rs:166-175`).

Implementation shape:

1. add a new experimental feature enum/spec (for example `retained_transcript_viewport` / `managed_tui_history`) with `default_enabled: false`;
2. add a helper such as `retained_committed_transcript_enabled()` instead of overloading `terminal_resize_reflow_enabled()`;
3. gate the `8548182d` managed-path call sites with that new helper;
4. leave default behavior on the old terminal-scrollback path.

That satisfies the operator directive: **default = old upstream/native scrollback model; opt-in = managed retained viewport**.

## 6. Feature-ON polish recommendation (SECONDARY .6 fix)

Once the managed viewport is opt-in, the best low-conflict fix for its slow resume paint is:

- during `BeginInitialHistoryReplayBuffer` / `EndInitialHistoryReplayBuffer`, **suppress per-cell frame requests** while replay is in progress;
- still append every committed cell to `transcript_cells`;
- schedule exactly **one** frame at replay end.

That preserves:

- full committed-cell state for the overlay / copy logic,
- the current "visible tail only" main viewport behavior,
- the resize-reprint benefit of the retained model,
- and removes the user-visible one-by-one trickle without needing a bigger lazy-realize design.

This same batching should probably also apply to the thread-switch replay wrapper, not just `/resume`.

## 7. OS scope

**Verdict:** this regression is **cross-platform**, not Windows-only.

- `TerminalResizeReflow` is an experimental feature that is currently **enabled by default** with no OS-specific gate (`features/src/lib.rs:95-96,793-800`, `features/src/tests.rs:166-175`).
- `terminal_resize_reflow_enabled()` is just a feature check (`tui/src/app/resize_reflow.rs:108-110`).
- The .5 retained-viewport replay path (`tui/src/app/event_dispatch.rs:194-204`, `tui/src/app/resize_reflow.rs:118-127,153-159`, `tui/src/app.rs:1306-1333`) has no Windows-only branching either.

So the mechanism is general. Windows mainly changes **severity/visibility** because console redraw costs and terminal defaults make incremental paint more obvious, but the fix should be **general codex-side logic**, not OS-gated.

## 8. Small fix vs plan

**Recommendation:** treat this as a **small but multi-file .6 fix**, not a separate planning project.

Reason:

- the primary regression fix is a contained feature gate + routing change across a handful of TUI files;
- the older default-off reprint-many-times bug is in the same small area (`streaming.rs`, `agent_message_consolidation.rs`, `resize_reflow.rs`);
- the feature-ON batching fix is also local to the replay / frame-request path.

I would only promote this to a larger plan if the operator explicitly wants the **tail-first/lazy-realize** design for the opt-in managed path. The **default-off feature gate + default-off reprint-once fix + feature-ON one-frame batching** should fit a normal .6 implementation pass.
