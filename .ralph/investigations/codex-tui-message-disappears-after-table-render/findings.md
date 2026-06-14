# Codex TUI table render disappearance investigation

Worktree investigated: `D:/harness-efforts/codexu/codex/external/repos/codex-patched/.worktrees/investigate-table-message-disappear` at `fd331d2f1d72dfd33c3650a36241429224426989`.

## G1 - View modes and Ctrl+T

The live/main view and Ctrl+T transcript view are separate render paths.

Ctrl+T is the default global `open_transcript` keybinding: `RuntimeKeymap::built_in_defaults()` maps `app.open_transcript` to `ctrl(KeyCode::Char('t'))` in `codex-rs/tui/src/keymap.rs:876-880`. The app-level key handler checks `self.keymap.app.open_transcript.is_pressed(key_event)`, enters the alternate screen, and creates `Overlay::new_transcript(self.transcript_cells.clone(), self.keymap.pager.clone())` in `codex-rs/tui/src/app/input.rs:169-176`.

The transcript overlay owns a pager view over committed `HistoryCell`s, not the live inline viewport. `Overlay::new_transcript()` constructs `TranscriptOverlay::new(...)` in `codex-rs/tui/src/pager_overlay.rs:49-57`; `TranscriptOverlay::new()` builds `PagerView::new(Self::render_cells(&transcript_cells, None), "T R A N S C R I P T", usize::MAX, keymap)` in `codex-rs/tui/src/pager_overlay.rs:388-406`; `TranscriptOverlay::render_cells()` delegates to `render_committed_cells()` in `codex-rs/tui/src/pager_overlay.rs:408-413`. The committed-cell renderer is shared helper code in `codex-rs/tui/src/chatwidget/committed_transcript.rs:19-35`.

That explains the core clue. If Ctrl+T shows the missing message, the message is still present in `App::transcript_cells`; the live view is deciding not to paint that cell. The relevant source-of-truth insert path stores every committed cell in `transcript_cells` before live/overlay rendering decisions: `AppEvent::InsertHistoryCell` converts the boxed cell to `Arc`, optionally updates an open transcript overlay, then `self.transcript_cells.push(cell.clone())` in `codex-rs/tui/src/app/event_dispatch.rs:194-201`.

## G2 - Live-view render-path map

### User paste path

The operator wording mentions a composer placeholder like `[Paste #1 - 20 lines]`, but this worktree's source has no exact `Paste #` string. The implemented large-paste path uses `[Pasted Content N chars]`: `ChatComposer::handle_paste()` normalizes CRLF, counts chars, and if `char_count > LARGE_PASTE_CHAR_THRESHOLD`, inserts an element placeholder and stores the full text in `draft.pending_pastes` in `codex-rs/tui/src/bottom_pane/chat_composer.rs:879-886`. The placeholder text is built by `next_large_paste_placeholder()` as `"[Pasted Content {char_count} chars]"`, with ` #N` suffixing for same-sized pending pastes, in `codex-rs/tui/src/bottom_pane/chat_composer.rs:1593-1614`.

On submit, placeholders are expanded back to the full pasted payload before the model/user history path sees them: `prepare_submission()` calls `expand_pending_pastes(&text, text_elements, &self.draft.pending_pastes)` in `codex-rs/tui/src/bottom_pane/chat_composer.rs:2561-2578`; `expand_pending_pastes()` replaces matching placeholder elements with their stored `actual` paste text and drops the placeholder element in `codex-rs/tui/src/bottom_pane/chat_composer.rs:2140-2206`. The submitted user message is then rendered into history through `user_message_display_for_history(...)` and `self.on_user_message_display(display)` in `codex-rs/tui/src/chatwidget/input_submission.rs:391-405`; `UserHistoryCell::display_lines()` wraps and prefixes the message body in `codex-rs/tui/src/history_cell/messages.rs:94-177`.

### Assistant markdown/table path

Assistant deltas enter `ChatWidget::on_agent_message_delta()` and then `handle_streaming_delta()` in `codex-rs/tui/src/chatwidget/streaming.rs:106-108` and `codex-rs/tui/src/chatwidget/streaming.rs:371-402`. The streaming controller renders markdown at the current width via `append_markdown_agent_with_cwd()` in `codex-rs/tui/src/streaming/controller.rs:276-289`.

Tables are intentionally non-incremental. The streaming controller's table holdback docs state that once a pipe-table header/delimiter is detected, content from the table header onward remains mutable tail until finalization in `codex-rs/tui/src/streaming/controller.rs:12-20`. The scanner records `TableHoldbackState::Confirmed { table_start }` for header+delimiter pairs in `codex-rs/tui/src/streaming/table_holdback.rs:21-32` and `codex-rs/tui/src/streaming/table_holdback.rs:132-141`. `active_tail_budget_lines()` converts that table source start into rendered tail lines so the whole table stays out of the committed queue in `codex-rs/tui/src/streaming/controller.rs:376-404`.

While streaming, stable queued lines are drained into `AgentMessageCell`s by commit ticks: `ChatWidget::run_commit_tick_with_scope()` calls `run_commit_tick(...)`, then for each output cell hides the status indicator and calls `self.add_boxed_history(cell)` in `codex-rs/tui/src/chatwidget/streaming.rs:315-327`; `StreamController::emit()` creates `history_cell::AgentMessageCell::new(lines, ...)` in `codex-rs/tui/src/streaming/controller.rs:558-567`. The mutable table tail is displayed through `StreamingAgentTailCell`, whose comments explicitly say in-progress table lines are displayed in the `active_cell` slot and replaced on every delta in `codex-rs/tui/src/history_cell/messages.rs:373-386`; its `display_lines()` avoids rewrapping table borders in `codex-rs/tui/src/history_cell/messages.rs:393-405`.

On finalization, `flush_answer_stream_with_separator()` finalizes the stream controller, sends `AppEvent::ConsolidateAgentMessage`, and may carry a deferred final stream cell in `codex-rs/tui/src/chatwidget/streaming.rs:19-48`. `App::handle_consolidate_agent_message()` inserts any deferred stream cell, then replaces the trailing run of `AgentMessageCell`s with a source-backed `AgentMarkdownCell` via `self.transcript_cells.splice(start..end, once(consolidated.clone()))` in `codex-rs/tui/src/app/agent_message_consolidation.rs:23-65`. `AgentMarkdownCell::display_lines()` re-renders markdown from source at the current width through `append_markdown_agent_with_cwd()` and prefixes it in `codex-rs/tui/src/history_cell/messages.rs:348-365`.

The table renderer itself is in `codex-rs/tui/src/markdown_render.rs`: `render_markdown_text_with_width_and_cwd()` enables `Options::ENABLE_TABLES` and feeds a `pulldown_cmark` parser to the writer in `codex-rs/tui/src/markdown_render.rs:285-296`. Its table pipeline is documented in `codex-rs/tui/src/markdown_render.rs:13-38`.

### Live retained viewport path and drop seam

The live frame chooses between upstream-style native scrollback and the fork's retained viewport. `App::render_chat_widget_frame()` checks `let retained_transcript_viewport_enabled = self.retained_transcript_viewport_enabled()` in `codex-rs/tui/src/app.rs:1317-1320`. If enabled, it computes height with `self.chat_widget.desired_height_with_committed_cells(&self.transcript_cells, terminal_size.width, terminal_size.height)` and renders with `self.chat_widget.render_with_committed_cells(&self.transcript_cells, area, frame.buffer)` in `codex-rs/tui/src/app.rs:1320-1350`. If disabled, it calls the ordinary `self.chat_widget.desired_height(...)` and `self.chat_widget.render(...)` in `codex-rs/tui/src/app.rs:1327-1360`.

The retained mode gate is exactly `self.config.features.enabled(Feature::RetainedTranscriptViewport)` in `codex-rs/tui/src/app/resize_reflow.rs:108-116`. The feature registry marks `RetainedTranscriptViewport` as experimental and default-off under key `"retained_transcript_viewport"` in `codex-rs/features/src/lib.rs:807-825`; the test `retained_transcript_viewport_is_experimental_and_disabled_by_default` asserts the default is false in `codex-rs/features/src/tests.rs:179-189`.

The drop/clipping mechanism is in `RetainedTranscriptViewportRenderable`. It is explicitly fork-marked: `// SANDBOX PATCH: The main viewport now renders only the visible committed tail from retained cells` in `codex-rs/tui/src/chatwidget/committed_transcript.rs:86-87`. Its `render()` splits the available content area into committed history and active tail: `active_height = self.active_total_height(...)`, `active_area_height = active_height.min(content_area.height)`, `committed_area_height = content_area.height.saturating_sub(active_area_height)` in `codex-rs/tui/src/chatwidget/committed_transcript.rs:212-247`.

If the active cell is tall enough to consume the viewport, `committed_area_height` becomes zero and no committed cells are painted. If some committed area remains, `render_committed_tail()` walks `committed_cells` in reverse from newest to oldest, subtracting measured cell heights from `remaining_rows`; when the next cell does not fit, it computes `top_clip = cell_height - remaining_rows`, pushes that one clipped cell, and breaks in `codex-rs/tui/src/chatwidget/committed_transcript.rs:155-180`. It later renders that clipped cell with `paragraph.scroll((top_clip, 0))` in `codex-rs/tui/src/chatwidget/committed_transcript.rs:184-208`.

This is not data loss; it is tail-window rendering. The existing test codifies the behavior: `retained_transcript_main_view_renders_visible_tail_snapshot` enables retained transcript viewport, inserts 8 cells, renders with height 10, and asserts the rendered output does not contain `"cell 0"` but does contain `"cell 7"` in `codex-rs/tui/src/app/tests.rs:4090-4112`.

## G3 - Upstream vs fork verdict

Verdict: **fork patch, specifically `retained_transcript_viewport`, with likely trigger from table holdback/finalization producing a tall active/finalized block.** From source alone, I would not call this stock-upstream reproducible.

Evidence:

- The live drop seam is in fork-marked retained viewport code, not generic upstream table rendering. `render_with_committed_cells()` carries `// SANDBOX PATCH: Feature-enabled main chat rendering now owns committed transcript cells inline` in `codex-rs/tui/src/chatwidget/rendering.rs:43-50`; `RetainedTranscriptViewportRenderable` carries `// SANDBOX PATCH: The main viewport now renders only the visible committed tail from retained cells` in `codex-rs/tui/src/chatwidget/committed_transcript.rs:86-87`.
- Blame points the retained viewport render wrappers and clipping logic to fork commit `8548182d369` (2026-06-12): `codex-rs/tui/src/chatwidget/rendering.rs:43-99`, `codex-rs/tui/src/chatwidget/committed_transcript.rs:86-128`, `codex-rs/tui/src/chatwidget/committed_transcript.rs:155-208`, and most of `codex-rs/tui/src/chatwidget/committed_transcript.rs:212-248` are all blamed to `8548182d369`. The `desired_height()` change returning `u16::MAX` for non-empty retained content is blamed to fork commit `705d14c6c21` in `codex-rs/tui/src/chatwidget/committed_transcript.rs:250-254`.
- The app live-frame branch into retained mode is fork-marked at `codex-rs/tui/src/app.rs:1321` and was added around fork commits `8548182d369` / `6f0137db451` per blame for `codex-rs/tui/src/app.rs:1317-1350`.
- The non-retained path still writes committed cells to terminal scrollback through `insert_history_cell_lines(...)`: `AppEvent::InsertHistoryCell` pushes `transcript_cells`, then if retained mode is disabled it calls `insert_history_cell_lines(...)` or replay-buffer variants in `codex-rs/tui/src/app/event_dispatch.rs:194-220`. `insert_history_cell_lines()` writes display lines to terminal history with `tui.insert_history_lines_with_wrap_policy(...)` in `codex-rs/tui/src/app/resize_reflow.rs:91-105`. That path does not tail-window over `transcript_cells` each frame.
- Ctrl+T uses the same `transcript_cells` but a different pager render path and therefore can still show cells that the retained live tail chooses not to paint, as shown in G1.

The operator's exact reproduction depends on whether `features.retained_transcript_viewport = true` is enabled in their runtime configuration. The feature is default-off in source (`codex-rs/features/src/lib.rs:817-825`, `codex-rs/features/src/tests.rs:179-189`). If the operator has it disabled and still reproduces, the next suspect would be a different terminal/scrollback interaction in the upstream-style native scrollback path; this read-only source pass did not find an upstream-native code path that would drop the model cell while preserving it for Ctrl+T.

I also checked the named fork-patch suspects:

- `retained_transcript_viewport`: strong match. It owns the live committed-tail viewport and intentionally drops older cells from the frame when height is exhausted.
- `history_cell.rs` empty-separator-line tweak / user-message styling / `chat_composer.rs` per-row `buf.set_style`: no source evidence that these decide which committed cells are included in the live viewport. They affect line/style representation, not the live tail-window selection.
- resize-reprints-full-history / focus-leak work: not the direct seam for the Ctrl+T contrast. Resize reflow is related infrastructure, but retained mode explicitly bypasses terminal scrollback replay and repaints the retained viewport on frame/resize in `codex-rs/tui/src/app/resize_reflow.rs:282-291`, `codex-rs/tui/src/app/resize_reflow.rs:317-326`, and `codex-rs/tui/src/app/resize_reflow.rs:370-375`.

One documentation gap: `D:/harness-efforts/codexu/codex/docs/implementation/patch-surface.md` did not contain the exact key `retained_transcript_viewport` in my search, even though the source has multiple `// SANDBOX PATCH:` markers for it. Tenant 1 in `codex/CLAUDE.md` requires upstream-canonical edits to have a `// SANDBOX PATCH:` marker, a patch-surface row, and a rebase note in `codex/CLAUDE.md:16-21`.

## G4 - Root cause, fix direction, and open questions

Most likely root cause: with `retained_transcript_viewport` enabled, the live main viewport renders only a bottom-anchored, height-limited tail of `transcript_cells` plus the active stream tail. A markdown table is held in `active_cell` while streaming and can be tall. When the table is rendered/finalized, the retained viewport recalculates the available rows and either (a) gives most/all rows to the active table tail, leaving `committed_area_height == 0`, or (b) walks committed cells from newest backward and clips/drops older committed cells when `remaining_rows` is exhausted. The "disappeared" message remains in `transcript_cells`, so Ctrl+T can render it from the full pager model.

Minimal fix direction:

1. Add a retained-viewport regression test around the reported shape: a visible user/message cell, then a tall table-like active/finalized assistant block, with retained viewport enabled. Assert the live render does not fully evict the just-submitted user/message cell unexpectedly, or document/encode the intended pinning policy.
2. Adjust `RetainedTranscriptViewportRenderable` rather than markdown/table rendering. Possible low-conflict choices:
   - reserve at least one committed-cell band above a tall active cell, so active tail cannot consume 100% of the viewport when committed context exists;
   - make the retained live viewport pin a small number of most-recent committed cells, especially the current turn's user prompt, before allocating remaining rows to active tail;
   - if the desired UX is true full transcript retention, add scroll state to the retained main viewport instead of a pure tail window.
3. Keep the change inside the existing fork-owned retained viewport module/path (`chatwidget/committed_transcript.rs` and its call sites), with `// SANDBOX PATCH:` markers already present, and add/update the patch-surface entry as required by Tenant 1. This avoids touching upstream markdown/table rendering.

Open questions for a runtime repro:

- Confirm whether the operator had `features.retained_transcript_viewport = true`. If false, this source-only verdict should be revisited against the terminal-native scrollback path.
- Capture terminal size and table rendered height. The exact disappearance threshold is height-budget dependent: `active_total_height`, bottom-pane height, and terminal rows determine whether committed cells get zero rows or only a clipped tail.
- Confirm which message "disappears" (the submitted table prompt/user cell vs. a preceding assistant/message cell). The mechanism can evict any older committed cell outside the retained tail window; a targeted fix should decide which recent cell(s) must be pinned.
