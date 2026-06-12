# Research Brief: codex-tui-resize-reprints-full-history

## Researcher Findings

### Codebase context
- `tui/src/app.rs:480-505` owns the transcript state that matters here: committed history lives in `App::transcript_cells`, the live UI state lives in `ChatWidget`, and resize state lives in `TranscriptReflowState`.
- `tui/src/tui/event_stream.rs:237-248` maps `Event::Resize(_, _)` directly to `TuiEvent::Resize`.
- `tui/src/app.rs:1206-1245` routes `Draw` and `Resize` through `handle_draw_pre_render()` when `Feature::TerminalResizeReflow` is enabled.
- `tui/src/app/resize_reflow.rs:231-243, 294-446, 456-513` owns the clear-and-replay behavior: size-change detection, debounce, terminal clearing, transcript re-rendering, and row-cap trimming.
- `tui/src/app/event_dispatch.rs:194-215` appends committed cells to `transcript_cells` and immediately emits them through the terminal-scrollback insertion path.
- `tui/src/insert_history.rs:1-220` is the terminal-scrollback writer. Its module-level comment explicitly says finalized history lives in terminal scrollback above the viewport.
- `tui/src/tui.rs:884-908, 1042-1078` flushes queued scrollback lines and then draws the retained inline viewport.

### Reusable patterns and seams
- `tui/src/pager_overlay.rs:50-58, 409-689` already has a retained transcript renderer (`TranscriptOverlay`) built from `transcript_cells`. It is the best precedent for direction A because it renders committed history in-process rather than by replaying terminal scrollback.
- `tui/src/chatwidget/rendering.rs:6-129` shows the main inline render pipeline: `ChatWidget::as_renderable()` currently renders only the active cell plus the composer reserve, so committed history is not yet part of the main retained viewport.
- `tui/src/chatwidget/transcript.rs:13-118` keeps active-cell and transcript-adjacent state in one place; it is the natural home for any new retained-history bookkeeping that must stay close to `ChatWidget`.
- `tui/src/transcript_reflow.rs:18-155` already debounces resize storms correctly. The problem is not event coalescing but the O(history) replay model after the debounce fires.

### Tests and verification surfaces
- `tui/src/app/tests.rs:3920-4075` already proves the current cap behavior:
  - `Disabled` replays all cells.
  - a small limit keeps only the recent suffix.
  - initial and thread-switch replay buffers change behavior when a row cap is present.
- `tui/src/pager_overlay.rs` has existing transcript overlay snapshot coverage under `tui/src/snapshots/codex_tui__pager_overlay__tests__*.snap`.
- Fork guidance from `codex/CLAUDE.md` requires `just test -p codex-tui`, `just fmt`, and `just fix -p codex-tui` for a large TUI change, with `just test` workspace-wide only if shared crates change and the operator approves.

### Constraints
- The current resize/render path is upstream-native. The investigation found no existing `// SANDBOX PATCH:` markers in the resize/history path, so any fix that lands in `codex-rs/tui` increases upstream rebase surface and must be registered in `codex/docs/implementation/patch-surface.md`.
- The eventual implementation must be run and verified from the canonical inner checkout, not autonomously from the plan worktree, because codex overlay relative paths break cargo verification from a worktree in this repo setup.

## Architect Analysis

### Dependency graph
- Resize event ingress:
  - `tui/src/tui/event_stream.rs:237-248`
  - `tui/src/app.rs:1206-1215`
- Resize scheduling and replay:
  - `tui/src/app/resize_reflow.rs:294-335, 354-418, 421-513`
  - `tui/src/transcript_reflow.rs:72-85`
- Committed-history ownership today:
  - `tui/src/app/event_dispatch.rs:194-215`
  - `tui/src/insert_history.rs:1-220`
  - `tui/src/tui.rs:884-908`
- Retained transcript precedent:
  - `tui/src/pager_overlay.rs:409-689`
  - `tui/src/chatwidget/rendering.rs:6-129`

### Direction A touch set
- Reuse the retained rendering model from `TranscriptOverlay` for the main chat surface so committed history is rendered from `transcript_cells` inside ratatui.
- Stop the main transcript path from writing committed cells through `insert_history_lines_with_wrap_policy(...)`.
- Replace resize clear-and-replay with normal retained repaint behavior for committed history.
- Preserve `transcript_cells` as the source of truth and keep the overlay/backtrack flows in sync.

### Direction B touch set
- Lower or make more aggressive the caps in `tui/src/resize_reflow_cap.rs`.
- Tighten `handle_draw_size_change()` so pure-height changes skip rebuilds when possible.
- Keep the existing scrollback-based architecture intact.

### Recommendation
- Recommend **A**.
- Rationale:
  1. It is the only direction that actually removes the visible full-history replay on resize; B only trims how much history gets replayed.
  2. The codebase already contains a retained transcript rendering precedent in `TranscriptOverlay`, so A is not a greenfield UI model.
  3. A better fits the e-ink and weak-terminal priority because repaint cost becomes tied to the retained viewport rather than the terminal scrollback history depth.
  4. Although A costs more upstream-canonical edits, it can still follow the fork tenet of minimizing conflict surface by putting new logic in a small new TUI module and keeping the call-site edits narrow.

## Codex Research

Not run separately. The merged investigation at `.ralph/investigations/codex-tui-resize-reprints-history/findings.md` is already the authoritative source grounding this plan.

## Copilot Research

Not run separately. The planner used the merged investigation plus direct source reads and the two parallel agent passes above.

## Consolidated File List

### Likely files to modify
- `codex/external/repos/codex-patched/codex-rs/tui/src/app/event_dispatch.rs`
- `codex/external/repos/codex-patched/codex-rs/tui/src/app/resize_reflow.rs`
- `codex/external/repos/codex-patched/codex-rs/tui/src/chatwidget/rendering.rs`
- `codex/external/repos/codex-patched/codex-rs/tui/src/pager_overlay.rs`
- `codex/external/repos/codex-patched/codex-rs/tui/src/tui.rs`
- `codex/external/repos/codex-patched/codex-rs/tui/src/app/tests.rs`
- `codex/docs/implementation/patch-surface.md`

### Strong candidate new file
- `codex/external/repos/codex-patched/codex-rs/tui/src/chatwidget/committed_transcript.rs`

### Supporting dependencies to read during implementation
- `codex/external/repos/codex-patched/codex-rs/tui/src/app.rs`
- `codex/external/repos/codex-patched/codex-rs/tui/src/transcript_reflow.rs`
- `codex/external/repos/codex-patched/codex-rs/tui/src/resize_reflow_cap.rs`
- `codex/external/repos/codex-patched/codex-rs/tui/src/app_backtrack.rs`
- `codex/external/repos/codex-patched/codex-rs/tui/src/chatwidget/transcript.rs`

### Test and snapshot surfaces
- `codex/external/repos/codex-patched/codex-rs/tui/src/app/tests.rs`
- `codex/external/repos/codex-patched/codex-rs/tui/src/snapshots/codex_tui__pager_overlay__tests__*.snap`
