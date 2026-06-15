# Research Brief: Codex paste-burst robustness

## Feature request

Plan only the robustness half of `codex-paste-guard-perf-and-dropped-text`: keep the Windows default-on flip as already shipped in codex `0.135.0-copilot-api.9` and make the non-bracketed `LegacyPasteBurstHeuristic` path robust enough for Windows Terminal, where bracketed paste is not delivered.

## Source-of-truth investigations

`.ralph/investigations/codex-paste-guard-perf-and-dropped-text/findings.md` identifies two current root causes in `tui/src/bottom_pane/paste_burst.rs`:

1. **Typing lag:** the ASCII path holds the first char in `pending_first_char` and relies on delayed redraw/tick flushing before a normal typed character appears.
2. **Lossy/early submit:** active bursts are closed by short idle timeouts, so slow terminal/PTY delivery can split one physical paste into multiple groups. Once the 120ms Enter suppression window expires, a delayed pasted Enter can submit early.

`.ralph/investigations/codex-bracketed-paste-fails-windows-terminal/findings.md` confirms Windows Terminal does not currently reach Codex as `Event::Paste(String)` because Codex keeps Windows console input in WinAPI mode with `ENABLE_VIRTUAL_TERMINAL_INPUT` cleared. The heuristic is therefore the only working Windows paste grouping path until the separate `codex-windows-bracketed-paste-vt-input` task lands.

## Current Codex state-machine trace

### PasteBurst

- `PasteBurst` is documented as a pure state machine for terminals without bracketed paste at `codex/external/repos/codex-patched/codex-rs/tui/src/bottom_pane/paste_burst.rs:1-18`.
- Conceptual states are documented as idle, pending-first-char, active buffer, and Enter suppression window at `paste_burst.rs:93-100`.
- Thresholds are:
  - `PASTE_BURST_MIN_CHARS = 3` at `paste_burst.rs:148-150`.
  - `PASTE_ENTER_SUPPRESS_WINDOW = 120ms` at `paste_burst.rs:150-151`.
  - `PASTE_BURST_CHAR_INTERVAL = 8ms` at `paste_burst.rs:153-154`.
  - active idle timeout `8ms` non-Windows / `60ms` Windows at `paste_burst.rs:156-161`.
- `on_plain_char()` records timing, appends if already active, otherwise holds the first ASCII char in `pending_first_char` and returns `RetainFirstChar`; a second fast char starts buffering from the pending char (`paste_burst.rs:213-244`).
- `on_plain_char_no_hold()` avoids first-char hold for non-ASCII/IME but still starts buffering after the timing/count threshold (`paste_burst.rs:246-267`).
- `flush_if_due()` chooses the pending-char timeout while idle and the active-idle timeout while buffering. Timed-out active buffers flush as `FlushResult::Paste`; timed-out pending chars flush as `FlushResult::Typed` (`paste_burst.rs:280-313`).
- Enter handling is split between `append_newline_if_active()`, `newline_should_insert_instead_of_submit()`, and `extend_window()` (`paste_burst.rs:315-339`).
- Retro capture only starts when the candidate prefix contains whitespace or is at least 16 chars (`paste_burst.rs:368-399`), which means short whitespace-free prefixes can escape a paste group once the first-char hold is removed unless the implementation adjusts this seam.
- Existing tests codify the current laggy behavior, including `ascii_first_char_is_held_then_flushes_as_typed`, `ascii_two_fast_chars_start_buffer_from_pending_and_flush_as_paste`, and `flush_before_modified_input_includes_pending_first_char` at `paste_burst.rs:464-518`.

### ChatComposer callers

- Module docs describe the non-bracketed paste-burst integration at `chat_composer.rs:92-128`; bottom-pane AGENTS guidance requires keeping these docs aligned with state-machine changes.
- `flush_paste_burst_if_due()` is the UI tick entry point and delegates to `handle_paste_burst_flush(Instant::now())` (`chat_composer.rs:1505-1532`).
- `handle_paste_burst_flush()` turns `FlushResult::Paste` into `handle_paste()` and `FlushResult::Typed` into `insert_str()` (`chat_composer.rs:3071-3090`).
- `handle_input_basic_with_time()` currently flushes due burst state before handling every new input (`chat_composer.rs:3117-3124`). This is the split point that makes slow producers lossy: a late-but-still-related char/Enter can arrive after the short timeout and force an early flush before it is offered to the burst.
- Plain ASCII chars are intercepted and routed through `PasteBurst::on_plain_char()` at `chat_composer.rs:3139-3195`.
- Non-ASCII chars route through `handle_non_ascii_char()` and `PasteBurst::on_plain_char_no_hold()` at `chat_composer.rs:1673-1760`.
- Pasted Enter is protected while active at `chat_composer.rs:3130-3137` and again in submission handling via `newline_should_insert_instead_of_submit()` at `chat_composer.rs:2713-2745`.
- `handle_paste()` is the single integration point for explicit terminal paste and flushed burst paste. It normalizes CR, inserts small paste text directly, stores large paste placeholders, and clears paste-burst state (`chat_composer.rs:861-897`).
- Bottom pane requests immediate redraw after mutating input and delayed redraw while `composer.is_in_paste_burst()` (`bottom_pane/mod.rs:667-676`). Removing pending-first-char from the normal typing path removes the delayed redraw from single keystrokes.

### Bracketed paste path

- Codex enables terminal bracketed paste at `tui/src/tui.rs:308-315`.
- Crossterm `Event::Paste(pasted)` maps to `TuiEvent::Paste(pasted)` at `tui/src/tui/event_stream.rs:390-391`.
- App-level handling normalizes `\r` to `\n` and forwards the payload to `chat_widget.handle_paste()` at `tui/src/app.rs:1247-1253`.
- This plan must not change that explicit bracketed-paste path.

## Existing test seams

- `question_mark_does_not_toggle_during_paste_burst` asserts `?` does not toggle shortcut overlay during active burst (`chat_composer.rs:5843-5877`).
- Existing mixed Unicode burst coverage demonstrates forced active buffering with Enter conversion (`chat_composer.rs:6600-6676`).
- `ascii_burst_treats_enter_as_newline` verifies active burst Enter does not submit (`chat_composer.rs:6678-6729`).
- `queued_submission_flushes_ascii_burst_instead_of_inserting_newline` verifies queued submit flushes buffered text (`chat_composer.rs:6731-6772`).
- `slash_context_enter_ignores_paste_burst_enter_suppression` keeps slash command dispatch semantics (`chat_composer.rs:6774-6803`).
- `non_char_key_flushes_active_burst_before_input` covers flush-before-unrelated-input (`chat_composer.rs:6805-6839`).
- `disable_paste_burst_flushes_pending_first_char_and_inserts_immediately` will need updating because the new design should not have a held first char on normal typing (`chat_composer.rs:6841-6872`).
- `flush_after_paste_burst()` and `type_chars_humanlike()` helpers are at `chat_composer.rs:7549-7572`.

## Claude Code comparison

Claude Code's design is protocol-delimited first and debounce-only second:

- Bracketed paste constants are explicit `CSI 200~` / `CSI 201~` (`D:/harness-efforts/claude-code/worktrees/main/src/ink/termio/csi.ts:277-280`).
- `parseMultipleKeypresses()` enters `IN_PASTE`, appends text/sequences to `pasteBuffer`, and emits exactly one pasted key at `PASTE_END`; on flush while still in paste mode, it emits the accumulated paste rather than losing it (`src/ink/parse-keypress.ts:226-301`).
- `App.tsx` uses a longer `PASTE_TIMEOUT = 500ms` while in paste mode and re-arms the flush timer when stdin already has buffered data (`src/ink/components/App.tsx:300-356`).
- `usePasteHandler` uses a synchronous `pastePendingRef` to avoid paste+Enter in the same batch submitting stale input before paste state commits (`src/hooks/usePasteHandler.ts:48-53,208-270`).
- It removed a competing `stdin.on('data')` paste listener because the race caused dropped characters (`src/hooks/usePasteHandler.ts:208-212`).

Codex cannot borrow the delimiter guarantee on Windows yet, but it can borrow three principles: centralize handling, re-arm before flushing when likely-continuation input is present, and keep a synchronous paste-pending/submission-protection bit.

## Likely files to modify

- `codex/external/repos/codex-patched/codex-rs/tui/src/bottom_pane/paste_burst.rs`
- `codex/external/repos/codex-patched/codex-rs/tui/src/bottom_pane/chat_composer.rs`
- `codex/external/repos/codex-patched/codex-rs/tui/src/bottom_pane/mod.rs` only if redraw scheduling APIs need renaming after pending-first-char removal.
- `codex/docs/implementation/patch-surface.md`
- Possibly `codex/scripts/audit_invariants.sh` only if the implementation adds a grep guard in addition to in-tree tests.

## Verification commands for implementation

Implementation should run from the canonical inner checkout, not a codex worktree:

```powershell
Set-Location D:\harness-efforts\codexu\codex\external\repos\codex-patched\codex-rs
just fmt
just test -p codex-tui paste_burst
just test -p codex-tui ascii_burst_treats_enter_as_newline
just test -p codex-tui slow
just test -p codex-tui chat_composer
just fix -p codex-tui
```

Per codex-rs guidance, use `just test`, not direct `cargo test`, and run `just fmt` after Rust edits.
