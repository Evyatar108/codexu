# Research Brief: codex-tui-message-disappears-after-table-render

## Feature Request
Fix the `retained_transcript_viewport` live-view drop: a tall active tail (table or large paste) must not clip or drop a preceding committed message cell from the live render. Keep the feature default-off, add regression coverage, and close the patch-surface documentation gap.

## Researcher Findings
- Live view and Ctrl+T transcript overlay are separate render paths. The overlay reads the retained `App::transcript_cells` through the pager path, so a message that appears in Ctrl+T but not in the live frame is still in the data model.
- The retained live frame is selected in `codex\external\repos\codex-patched\codex-rs\tui\src\app.rs` around `render_chat_widget_frame()`, which calls `ChatWidget::desired_height_with_committed_cells()` and `ChatWidget::render_with_committed_cells()` when `Feature::RetainedTranscriptViewport` is enabled.
- The main seam is `codex\external\repos\codex-patched\codex-rs\tui\src\chatwidget\committed_transcript.rs`. `RetainedTranscriptViewportRenderable::render()` currently allocates rows to the active tail first, then gives the remainder to committed cells. If the active tail height fills the content area, `committed_area_height` becomes zero and no committed cell is painted.
- `render_committed_tail()` reverse-walks committed cells and clips the first partially visible cell. This behavior is acceptable for older history tail-windowing, but the bug is that the immediately preceding committed context can be fully evicted by a tall active table tail.
- Existing tests to mirror:
  - `enable_retained_transcript_viewport()` in `codex\external\repos\codex-patched\codex-rs\tui\src\app\tests.rs`.
  - `retained_transcript_main_view_renders_visible_tail_snapshot()` in the same file.
  - Resize-reflow suffix tests near the retained viewport tests.

## Architect Analysis
Chosen fix direction: option (a), reserve or pin a minimum committed cell band before the active tail can consume the full retained viewport budget.

Why this approach:
- It keeps the change inside the fork-owned retained viewport code already marked with `// SANDBOX PATCH:`.
- It preserves the purpose of retained mode instead of falling back to native terminal scrollback.
- It explicitly preserves recent committed context, especially the current turn's submitted user prompt, while still allowing older committed cells to be tail-windowed.
- It avoids touching markdown table rendering, table holdback, generic history-cell measurement, or flex layout.

Rejected alternatives:
- Option (b), capping a tall active tail globally, is close but less explicit than reserving a committed context band. The cap should be derived from the reservation policy rather than a standalone arbitrary limit.
- Option (c), falling back to the non-retained render path, would bypass the feature's retained viewport behavior and reintroduce mode-dependent rendering.

## Consolidated File List
### Files to modify
- `codex\external\repos\codex-patched\codex-rs\tui\src\chatwidget\committed_transcript.rs`
  - Add the committed-row reservation/pinning policy inside `RetainedTranscriptViewportRenderable`.
  - Keep the edit marked as `// SANDBOX PATCH:`.
- `codex\external\repos\codex-patched\codex-rs\tui\src\app\tests.rs`
  - Add the regression test next to the existing retained viewport snapshot tests.
- `codex\external\repos\codex-patched\docs\implementation\patch-surface.md`
  - Update the retained viewport row to document the new no-eviction invariant and test guard.

### Files to reference
- `.ralph\investigations\codex-tui-message-disappears-after-table-render\findings.md`
- `codex\CLAUDE.md`
- `codex\external\repos\codex-patched\codex-rs\tui\src\chatwidget\rendering.rs`
- `codex\external\repos\codex-patched\codex-rs\tui\src\app\resize_reflow.rs`
- `codex\external\repos\codex-patched\codex-rs\features\src\lib.rs`
- `codex\external\repos\codex-patched\codex-rs\features\src\tests.rs`

## Test and Verification Commands
Run from the canonical inner checkout. The root `justfile` lives at `D:\harness-efforts\codexu\codex\external\repos\codex-patched\justfile` and delegates into `codex-rs`.

```powershell
Set-Location D:\harness-efforts\codexu\codex\external\repos\codex-patched\codex-rs
cargo check -p codex-tui
Set-Location D:\harness-efforts\codexu\codex\external\repos\codex-patched
just test -p codex-tui retained_transcript
```

If the implementation intentionally updates a snapshot:

```powershell
cargo insta pending-snapshots -p codex-tui
cargo insta show -p codex-tui <snapshot>.snap.new
cargo insta accept -p codex-tui
```

No Rust dependencies, config schema, or feature default changes are expected.
