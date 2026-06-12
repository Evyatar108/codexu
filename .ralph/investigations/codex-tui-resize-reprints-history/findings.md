# Summary for the operator

Codex reprints history on resize because finalized chat history is **not** kept in a retained ratatui viewport; it is written into the terminal's **real scrollback** above the inline composer viewport via escape-sequence history insertion (`tui/src/insert_history.rs:1-5`, `tui/src/app/event_dispatch.rs:194-215`, `tui/src/tui.rs:884-908`). When a `Resize` arrives, the TUI's resize-reflow path schedules a transcript rebuild, clears Codex-owned terminal history, and re-emits reflowed lines from `transcript_cells` back into scrollback (`tui/src/tui/event_stream.rs:237-248`, `tui/src/app.rs:1206-1215`, `tui/src/app/resize_reflow.rs:354-368`, `tui/src/app/resize_reflow.rs:421-446`). That work is O(history) up to the configured row cap because `render_transcript_lines_for_reflow()` walks transcript cells and formats lines for replay; when the cap is disabled it renders everything, and Windows Terminal's auto cap is still 9,001 rows, so long sessions can look like "the whole transcript" is being replayed (`tui/src/app/resize_reflow.rs:456-513`, `tui/src/app/tests.rs:3920-3959`, `tui/src/resize_reflow_cap.rs:19-21`, `tui/src/resize_reflow_cap.rs:60-64`).

The cheapest **true** fix for "redraw only the viewport" is architectural: stop making terminal scrollback the authoritative finalized-history surface, and instead render finalized history from `transcript_cells` inside a retained ratatui history viewport so resize only repaints the current frame (`tui/src/app/event_dispatch.rs:194-215`, `tui/src/insert_history.rs:1-225`, `tui/src/tui.rs:1042-1078`). If you want a smaller/safer interim mitigation, reduce the resize-reflow row cap and/or stop scheduling reflow on pure height changes, but that only reduces the amount of replay; it does not remove width-resize re-emission under the current scrollback-based design (`tui/src/app/resize_reflow.rs:294-335`, `tui/src/resize_reflow_cap.rs:24-29`, `tui/src/resize_reflow_cap.rs:52-76`).

## 1. Resize handling

`crossterm` resize notifications enter the TUI as `Event::Resize(_, _)`, which the event stream maps directly to `TuiEvent::Resize` in `tui/src/tui/event_stream.rs:237-248`. `App::handle_tui_event()` treats `Draw` and `Resize` the same when the `TerminalResizeReflow` feature is enabled: it runs `handle_draw_pre_render()` before rendering the frame (`tui/src/app.rs:1206-1215`).

`handle_draw_pre_render()` samples terminal size, routes it through `handle_draw_size_change()`, clears any stale queued history inserts, and then runs pending resize reflow if the debounce deadline has arrived (`tui/src/app/resize_reflow.rs:354-368`). The resize decision is explicit:

- width changes can require transcript reflow because wrapped lines change,
- height changes also force rebuild because rows above the inline viewport can be exposed or hidden,
- the rebuild is scheduled through `TranscriptReflowState` and a 75 ms debounce (`tui/src/app/resize_reflow.rs:294-335`, `tui/src/transcript_reflow.rs:18`, `tui/src/transcript_reflow.rs:72-85`).

So on resize Codex does **not** just repaint the current frame buffer. It schedules transcript repair work before the next draw.

## 2. History rendering model

The finalized-history model is scrollback-based, not a retained full-screen viewport:

1. `insert_history.rs` says so directly: "Codex uses the terminal scrollback itself for finalized chat history" and history insertion is an escape-sequence operation, not a normal ratatui render (`tui/src/insert_history.rs:1-5`).
2. When the app receives `AppEvent::InsertHistoryCell`, it stores the cell in `self.transcript_cells` **and** immediately inserts that cell's rendered lines above the viewport (`tui/src/app/event_dispatch.rs:194-215`).
3. `insert_history_cell_lines()` calls `tui.insert_history_lines_with_wrap_policy(...)`, which queues history lines for insertion above the viewport (`tui/src/app/resize_reflow.rs:91-105`).
4. `Tui::flush_pending_history_lines()` then writes those queued lines using `insert_history_lines_with_mode_and_wrap_policy(...)` (`tui/src/tui.rs:884-908`).
5. The actual insertion code manipulates the terminal scroll region, cursor position, and CRLF writes to put lines above the viewport and update viewport coordinates, which is terminal-scrollback behavior, not viewport-only ratatui painting (`tui/src/insert_history.rs:82-225`).

`draw_with_resize_reflow()` still only draws the live inline viewport after any history flush above it (`tui/src/tui.rs:1042-1078`). That means Codex has two surfaces:

- **terminal scrollback** for finalized history above the composer viewport, and
- **ratatui viewport** for the currently visible inline UI.

Because finalized history lives in terminal scrollback, Codex cannot cheaply "reflow in place" with viewport-only repaint semantics.

## 3. Why resize reprints everything

The full-history replay comes from the dedicated resize-reflow path:

1. `handle_draw_size_change()` marks width/height changes as transcript rebuild work and schedules a debounced reflow (`tui/src/app/resize_reflow.rs:294-335`).
2. Once the debounce expires, `maybe_run_resize_reflow()` calls `reflow_transcript_now()` and then records the width that was actually rebuilt (`tui/src/app/resize_reflow.rs:377-418`).
3. `reflow_transcript_now()`:
   - recomputes transcript lines from source-backed `transcript_cells`,
   - drops pending old-width history inserts,
   - **clears terminal history / visible screen** with `clear_terminal_for_resize_replay()`,
   - re-inserts the reflowed lines back into history (`tui/src/app/resize_reflow.rs:421-446`).
4. `clear_terminal_for_resize_replay()` explicitly clears the visible screen on alt-screen terminals or clears **scrollback + visible screen** otherwise, then resets the viewport anchor to the top (`tui/src/app/resize_reflow.rs:231-243`).
5. `render_transcript_lines_for_reflow()` is where the O(history) work lives: it walks `self.transcript_cells` backward, renders each cell for the new width, reintroduces separator blank lines, and then optionally trims the result to the configured row cap (`tui/src/app/resize_reflow.rs:456-513`).

This is why the terminal appears to "scroll from the top to the bottom" on resize: Codex has cleared the old Codex-owned history and is replaying rewrapped lines back into terminal scrollback.

Important nuance: the code already has a debounce, so the issue is **not** "too many resize events without coalescing." The 75 ms debounce is present in `TRANSCRIPT_REFLOW_DEBOUNCE` and `schedule_debounced()` (`tui/src/transcript_reflow.rs:18`, `tui/src/transcript_reflow.rs:72-85`). The expensive part is the replay model itself.

Also important: the replay is capped only if `terminal_resize_reflow.max_rows` resolves to a limit. `Auto` is the default config mode (`core/src/config/mod.rs:1035-1048`), the feature is enabled by default (`features/src/lib.rs:792-801`), and Windows Terminal's auto cap is 9,001 rows (`tui/src/resize_reflow_cap.rs:19-21`, `tui/src/resize_reflow_cap.rs:60-64`). The tests show the difference clearly:

- with `Disabled`, reflow renders all cells (`tui/src/app/tests.rs:3947-3959`);
- with a small cap, it renders only a recent suffix (`tui/src/app/tests.rs:3920-3944`).

So on the operator's setup, long-session replay can still be very large even though a cap exists.

## 4. Fix direction (do not implement here)

### Cheapest true fix: stop using scrollback as the resize-time source of truth

If the goal is literally "redraw only the viewport, not the whole transcript," the fix has to change the ownership model for finalized history:

- today, finalized history is emitted to terminal scrollback in `app/event_dispatch.rs:194-215` and `app/resize_reflow.rs:91-105`;
- resize repair clears/replays that scrollback in `app/resize_reflow.rs:231-243` and `app/resize_reflow.rs:421-446`;
- viewport drawing happens separately in `tui.rs:1042-1078`.

The clean solution is to keep `transcript_cells` as the source of truth but render finalized history into a retained ratatui history viewport (or another retained in-process buffer) instead of terminal scrollback. Then resize becomes a normal viewport repaint: rewrap the visible/history-window rows and redraw the frame, which is O(viewport) rather than O(scrollback history). For an e-ink / low-power target, this is the only fix direction that removes the visibly slow terminal scrollback churn.

Likely landing points:

- stop or gate the immediate scrollback emission in `tui/src/app/event_dispatch.rs:194-215`,
- replace/retire the scrollback insertion path in `tui/src/insert_history.rs:1-225`,
- keep resize-specific viewport layout in `tui/src/tui.rs:1042-1078`, but feed it retained history rows instead of replaying scrollback,
- preserve `transcript_cells` as the source-backed data model already used by `render_transcript_lines_for_reflow()` (`tui/src/app/resize_reflow.rs:449-513`).

Tradeoff: this is not a one-line fix. It is a deliberate architecture shift because scrollback-based history and viewport-only resize are fundamentally at odds.

### Cheapest low-risk mitigation inside the current architecture

If you want the smallest patch that improves the symptom **without** re-architecting history:

1. **Lower the resize-reflow cap** for terminals like Windows Terminal in `tui/src/resize_reflow_cap.rs:19-21` and `tui/src/resize_reflow_cap.rs:52-76`, or let users opt into a smaller explicit `max_rows`. This directly reduces replay work, but width resize still replays the retained suffix.
2. **Stop rebuilding on pure height changes unless newly exposed rows truly need source replay.** The current logic rebuilds whenever `height_changed` is true (`tui/src/app/resize_reflow.rs:306-335`). Tightening that condition would reduce surprise replays on vertical-only resizes, but width changes would still require replay under the current design.

I would **not** prioritize more debounce work: the code already debounces resize events, so extra debounce only hides the problem slightly and increases latency without changing the O(history) replay path (`tui/src/transcript_reflow.rs:18`, `tui/src/transcript_reflow.rs:72-85`).

## Fork vs upstream

I did not find any `// SANDBOX PATCH` markers in the resize/reflow/history-insertion path I traced: `tui/src/app.rs:1206-1253`, `tui/src/app/resize_reflow.rs:231-513`, `tui/src/insert_history.rs:1-225`, and `tui/src/tui.rs:1042-1078`. The only nearby marker I hit in `tui/src/tui.rs` was an unrelated Windows VT-input normalization patch at `tui/src/tui.rs:250`. So this resize/redraw behavior appears to be upstream-native rather than fork-specific.
