# Codex TUI focus-event leak investigation

## Verdict

The source-verified root cause is not that the current Codex TUI event loop lacks
`FocusGained` / `FocusLost` handling. Current fork code, and `upstream/main` at
the same seams, enable terminal focus reporting and then explicitly consume
crossterm focus events before key events reach the chat composer.

The leak is at the terminal/crossterm byte-decoding boundary. Codex enables
DECSET `?1004` focus reporting through crossterm's `EnableFocusChange`, whose
ANSI command is `CSI ? 1004 h`; crossterm parses full `ESC [ I` / `ESC [ O`
sequences as `Event::FocusGained` / `Event::FocusLost`. However, crossterm's
Unix parser treats a standalone `ESC` byte as a completed `KeyCode::Esc` when
the current read buffer has no more bytes, clears parser state, and then parses
the later `[` / `O` or `[` / `I` bytes as ordinary characters. That exact
fragmentation turns focus reports into visible `[O[I` text even though the
application handles focus events correctly when the full escape sequence reaches
the parser together.

This also explains why the bug is intermittent and long-session dependent: it
requires rapid focus toggles plus an unlucky read boundary or equivalent event
handoff gap that splits the `ESC` leader from the rest of the focus report.

## Evidence by question

### 1. Does Codex enable terminal focus-reporting mode?

Yes.

- `codex-rs/tui/src/tui.rs:171-186` initializes terminal modes, enables
  bracketed paste, raw mode, keyboard enhancement, then executes
  `EnableFocusChange` at line 185.
- `codex-rs/tui/src/tui.rs:243-258` restores terminal state and executes
  `DisableFocusChange` at line 257.
- `codex-rs/tui/src/tui.rs:300-317` defines `RestoreMode::{Full, KeepRaw}`;
  both variants call `restore_common`, so focus reporting is disabled even when
  raw mode is kept for external-editor handoff.
- `codex-rs/tui/src/tui.rs:602-644` uses `with_restored(...)` around external
  interactive programs: it pauses crossterm input, restores modes, later calls
  `set_modes()` again, flushes terminal input, and resumes events.
- The pinned crossterm command writes the actual control sequence:
  `C:\Users\evmitran\.cargo\git\checkouts\crossterm-8af208d8974c82d2\87db8bf\src\event.rs:375-386`
  documents/enables focus event emission and writes `csi!("?1004h")`;
  lines 395-401 write `csi!("?1004l")` for disable.

There is no mid-session focus toggle other than the restore/re-enable handoff:
normal startup enables it, restore paths disable it, and `set_modes()` re-enables
it after returning from restored terminal mode.

### 2. Does Codex consume `Event::FocusGained` / `Event::FocusLost`?

Yes, in the current source.

- `codex-rs/tui/src/tui/event_stream.rs:236-260` maps crossterm events into
  Codex `TuiEvent`s. `Event::FocusGained` stores `terminal_focused = true`,
  requeries colors, and returns `Some(TuiEvent::Draw)` at lines 249-253.
  `Event::FocusLost` stores `terminal_focused = false` and returns `None` at
  lines 254-257.
- `codex-rs/tui/src/tui/event_stream.rs:173-221` loops over crossterm events
  until a mapped event is returned or polling goes pending. Because
  `FocusLost` maps to `None`, it is consumed and skipped; because
  `FocusGained` maps to `Draw`, it is consumed as redraw work rather than a key.
- `codex-rs/tui/src/tui.rs:472-484` defines the only app-facing TUI event
  variants as `Key`, `Paste`, `Resize`, and `Draw`; there is no raw focus event
  variant exposed to the composer.
- `codex-rs/tui/src/app.rs:1225-1237` routes only `TuiEvent::Key` to
  `handle_key_event` and `TuiEvent::Paste` to `handle_paste`; focus events that
  were mapped to `Draw` / `None` do not enter the input field.

Therefore a full crossterm `Event::FocusGained` / `Event::FocusLost` cannot
explain literal `[O` / `[I` reaching the input. The leak requires the focus
report bytes to bypass that crossterm event mapping, most plausibly by splitting
the leading `ESC` from the rest of the CSI sequence.

### 3. What corrupts backspace behavior?

There is no Codex composer/text-area state machine that turns a decoded
Backspace event into an inserted space.

- The default keymap maps `plain(KeyCode::Backspace)`,
  `shift(KeyCode::Backspace)`, and `ctrl(KeyCode::Char('h'))` to
  `editor.delete_backward` in `codex-rs/tui/src/keymap.rs:927-931`.
- `codex-rs/tui/src/bottom_pane/textarea.rs:506-533` checks
  `delete_backward` and calls `delete_backward(/*n*/ 1)` before plain character
  insertion.
- `codex-rs/tui/src/bottom_pane/textarea.rs:607-619` inserts only
  `KeyCode::Char(c)` with no modifiers or Shift, and ignores ASCII control
  characters.
- `codex-rs/tui/src/bottom_pane/textarea.rs:961-973` implements
  `delete_backward` by replacing the previous atomic range with `""`.
- On Unix, crossterm maps DEL (`0x7f`) to `KeyCode::Backspace` at
  `crossterm...\src\event\sys\unix\parse.rs:153-156`, maps Ctrl-H via the
  control-letter range at lines 157-160, and maps Kitty/u-encoded DEL to
  `KeyCode::Backspace` at lines 596-612.
- On Windows, crossterm maps `VK_BACK` to `KeyCode::Backspace` at
  `crossterm...\src\event\sys\windows\parse.rs:242-245`.

The parser corruption that is visible in source is instead the CSI focus report
fragmentation:

- `crossterm...\src\event\sys\unix\parse.rs:84-92` treats a one-byte `ESC`
  buffer as either "wait for more bytes" when `input_available` is true or as a
  completed `KeyCode::Esc` when it is false.
- `crossterm...\src\event\source\unix\mio.rs:197-217` appends bytes one at a
  time and calls `parse_event(&self.buffer, more)` where `more` only means
  there are later bytes in the current read chunk or the read buffer was full.
  If the terminal read returns only `ESC`, `more` is false, the parser emits
  `Esc`, clears its buffer, and the following `[` / `O` or `[` / `I` bytes are
  parsed as ordinary printable characters.
- `crossterm...\src\event\sys\unix\parse.rs:188-223` shows the intended full
  CSI handling: `ESC [` followed by `I` becomes `Event::FocusGained`, and
  `ESC [` followed by `O` becomes `Event::FocusLost`.
- `crossterm...\src\event\sys\unix\parse.rs:169-175` is the fallback for bytes
  that are not recognized as escape/control sequences: parse UTF-8, map to
  `KeyCode::Char`, and surface them as key events.

So the source-supported answer is: the crossterm escape-sequence parser can
lose the `ESC` leader across a read boundary, not Codex's text-area backspace
handler or bracketed-paste mode. Once `[O[I...` enters the composer as normal
characters, `codex-rs/tui/src/bottom_pane/chat_composer.rs:3137-3199` can also
classify rapid plain characters through the paste-burst path, and
`chat_composer.rs:3201-3210` flushes any buffered burst before applying a
non-char input. That can make the next backspace appear to add pending text
before deletion. But if the physical Backspace itself literally inserts a
space, then the TUI must be receiving a decoded `KeyCode::Char(' ')`, not a
decoded Backspace; the Codex source has no path that inserts a space for
`KeyCode::Backspace`.

### 4. Is this upstream Codex behavior or fork-introduced?

This is upstream behavior at the relevant seams.

- The current fork files have no `SANDBOX PATCH` markers near
  `EnableFocusChange`, `DisableFocusChange`, or the focus-event match arms.
  A focused grep found the focus code in `codex-rs/tui/src/tui.rs:20-22`,
  `tui.rs:174-185`, `tui.rs:254-257`,
  `codex-rs/tui/src/tui/event_stream.rs:249-257`, and no sandbox marker in
  those ranges.
- Read-only comparison against `upstream/main` showed the same seam:
  `upstream/main:codex-rs/tui/src/tui.rs:20-22` imports focus commands,
  `upstream/main:codex-rs/tui/src/tui.rs:176` enables bracketed paste,
  `upstream/main:codex-rs/tui/src/tui.rs:187` enables focus change, and
  `upstream/main:codex-rs/tui/src/tui.rs:259` disables focus change.
- Read-only comparison against `upstream/main` also showed the same focus event
  handling:
  `upstream/main:codex-rs/tui/src/tui/event_stream.rs:249-257` handles
  `FocusGained` / `FocusLost` exactly like the fork.
- The crossterm dependency is pinned by the workspace, not fork-local TUI
  code: `codex-rs/Cargo.toml:286` declares `crossterm = "0.28.1"`,
  `codex-rs/Cargo.toml:532-535` patches crates.io to
  `https://github.com/nornagon/crossterm` at
  `87db8bfa6dc99427fd3b071681b07fc31c6ce995`, and
  `codex-rs/Cargo.lock:4698-4701` records that exact crossterm git source.

Verdict: pre-existing/upstream-canonical, not introduced by fork patches or
the in-flight `.4` work.

### 5. Are the in-flight `.4` changes involved?

No evidence that the named in-flight surfaces touch terminal focus handling or
the composer backspace path.

- The exact `Op::WakePendingWork` symbol is not present in this checked-out
  `codex-rs` tree. The `Op` enum is in `codex-rs/protocol/src/protocol.rs:500-660`;
  the nearby `kind()` mapping at `protocol.rs:741-750` has no wake-pending
  variant. The closest pending-work source I found is
  `codex-rs/core/src/codex_thread.rs:404-424`, which queues response items and
  calls `maybe_start_turn_for_pending_work()` in test-only append-message
  plumbing. That is core/session turn scheduling, not terminal input decoding.
- The background-terminal app-server route in
  `codex-rs/tui/src/app_server_session.rs:935-950` sends
  `thread/backgroundTerminals/clean`; it is not wired into `EventStream`,
  `FocusGained`, `FocusLost`, or `TextArea`.
- Knob B changes are isolated to model/context tier selection and persistence:
  `codex-rs/tui/src/app_event.rs:634-644` adds context-tier app events,
  `codex-rs/tui/src/app/event_dispatch.rs:772-789` handles those events,
  `codex-rs/tui/src/app/config_persistence.rs:719-728` updates app/widget
  config, `codex-rs/tui/src/app/thread_settings.rs:94-109` syncs thread
  settings, `codex-rs/tui/src/chatwidget/context_tier_popup.rs:1-70` implements
  the stage-3 picker, and `codex-rs/tui/src/chatwidget/model_popups.rs:232-247`
  chains model/reasoning selection into the context picker. None of those files
  are in the terminal event loop or text-area backspace path.

### 6. Recommended fix direction only

Best fix direction: make focus reports un-leakable at the lowest boundary where
Codex owns behavior.

Recommended landing site:

- Primary: `codex-rs/tui/src/tui/event_stream.rs:249-257`. Keep the existing
  focus arms, but add regression coverage that feeds `FocusLost`/`FocusGained`
  and verifies no `TuiEvent::Key` is emitted; the existing test at
  `event_stream.rs:391-409` already proves `FocusLost` is skipped before a key.
  Extend this area if Codex adds a local guard for raw focus-report fragments.
- Stronger Codex-side mitigation: add a small pre-composer guard in
  `codex-rs/tui/src/tui/event_stream.rs` or immediately before
  `TuiEvent::Key` reaches `App::handle_key_event` (`codex-rs/tui/src/app.rs:1225-1237`)
  that recognizes the exact leaked tails `[I` and `[O` only when they arrive as
  the aftermath of an `Esc` / focus-report pattern, consumes them, and resets
  paste-burst state. This is more surgical than disabling focus reporting
  globally, but it is heuristic and must not eat user-typed bracket text.
- Dependency-level fix: patch crossterm's Unix parser so a one-byte `ESC` read
  can wait briefly for possible CSI continuation instead of immediately emitting
  `KeyCode::Esc` whenever the current read chunk has no more bytes
  (`crossterm...\src\event\sys\unix\parse.rs:84-92` plus the `more` calculation
  in `crossterm...\src\event\source\unix\mio.rs:197-217`). This is the cleanest
  root fix, but it is outside Codex TUI source and carries dependency-maintenance
  cost.
- Fallback: disable focus reporting entirely by removing or gating
  `EnableFocusChange` in `codex-rs/tui/src/tui.rs:171-186` and its notification
  focus-state behavior. This prevents focus-report bytes from being emitted at
  all, but it regresses `NotificationCondition::Unfocused` behavior, which uses
  `terminal_focused` in `codex-rs/tui/src/tui.rs:78-82` and notification checks
  in `tui.rs:647-650`.

I would not start by changing `TextArea` backspace handling. Source shows it
already deletes decoded Backspace/Ctrl-H correctly; the real failure is earlier,
where focus-report bytes can be decoded as printable input instead of focus
events.
