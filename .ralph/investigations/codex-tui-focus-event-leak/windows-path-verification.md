# Windows path verification: codex input leak on Windows

## Verdict

The prior Unix-path root-cause citation does **not** apply on Windows. On Windows, codex does **not** use crossterm's Unix byte reader or `parse_event(...)` state machine. It uses crossterm's WinAPI console-record path: `InternalEventReader` selects `WindowsEventSource`, `WindowsEventSource` polls the console handle, and input is decoded from `InputRecord` / `KeyEventRecord` values rather than from a byte stream (`C:\Users\evmitran\.cargo\git\checkouts\crossterm-8af208d8974c82d2\87db8bf\src\event\read.rs:18-26`, `C:\Users\evmitran\.cargo\git\checkouts\crossterm-8af208d8974c82d2\87db8bf\src\event\source\windows.rs:19-24`, `43-87`, `C:\Users\evmitran\.cargo\git\checkouts\crossterm-8af208d8974c82d2\87db8bf\src\event\sys\windows\poll.rs:37-55`).

So the source-backed Windows story is different:

1. codex enables **VT output**, not VT input, on Windows (`D:\harness-efforts\codexu\codex\external\repos\codex-patched\codex-rs\tui\src\tui.rs:171-186`, `1041-1080`);
2. crossterm raw mode clears classic console input flags but does **not** set `ENABLE_VIRTUAL_TERMINAL_INPUT` (`C:\Users\evmitran\.cargo\git\checkouts\crossterm-8af208d8974c82d2\87db8bf\src\terminal\sys\windows.rs:17-41`);
3. the Windows decoder has **no escape-sequence parser state** like Unix `parse_event(...)`; it maps `VK_ESCAPE` to `KeyCode::Esc`, `VK_NEXT` to `KeyCode::PageDown`, and ordinary `u_char` values to `KeyCode::Char(...)` (`C:\Users\evmitran\.cargo\git\checkouts\crossterm-8af208d8974c82d2\87db8bf\src\event\sys\windows\parse.rs:42-60`, `242-280`).

That means the old "one-byte `ESC` fragmentation in `event/sys/unix/parse.rs`" explanation is not the right Windows citation. The cheapest correct fix locus is still **below codex's TUI logic**, but on Windows it is specifically the **crossterm Windows input path**: either add Windows-side VT-sequence reassembly/decoding, or add a true Windows VT-input path. I do **not** see a source-backed codex-side settings-only fix that would solve both leaked focus reports and leaked `PageDown` tails.

## 1. How codex reads terminal input on Windows

codex's TUI setup enables VT **output** on Windows by calling `ensure_virtual_terminal_processing()` before raw mode. That helper calls `GetConsoleMode` / `SetConsoleMode` on **STDOUT** and **STDERR**, OR-ing `ENABLE_PROCESSED_OUTPUT | ENABLE_VIRTUAL_TERMINAL_PROCESSING` into the output handles (`D:\harness-efforts\codexu\codex\external\repos\codex-patched\codex-rs\tui\src\tui.rs:171-186`, `1041-1080`).

For **input**, codex delegates to crossterm raw mode. The vendored crossterm Windows implementation of `enable_raw_mode()` only clears `ENABLE_LINE_INPUT | ENABLE_ECHO_INPUT | ENABLE_PROCESSED_INPUT` on the **input** handle. It does **not** set `ENABLE_VIRTUAL_TERMINAL_INPUT` (`C:\Users\evmitran\.cargo\git\checkouts\crossterm-8af208d8974c82d2\87db8bf\src\terminal\sys\windows.rs:17-41`).

The runtime read path is WinAPI console events, not a byte reader:

- `InternalEventReader::default()` selects `WindowsEventSource` on Windows (`C:\Users\evmitran\.cargo\git\checkouts\crossterm-8af208d8974c82d2\87db8bf\src\event\read.rs:18-26`).
- `WindowsEventSource` owns a `Console`, a `WinApiPoll`, a `surrogate_buffer`, and mouse-button state; there is no escape-sequence buffer (`C:\Users\evmitran\.cargo\git\checkouts\crossterm-8af208d8974c82d2\87db8bf\src\event\source\windows.rs:19-24`, `27-39`).
- `WinApiPoll::poll()` waits on the console handle with `WaitForMultipleObjects` (`C:\Users\evmitran\.cargo\git\checkouts\crossterm-8af208d8974c82d2\87db8bf\src\event\sys\windows\poll.rs:37-55`).
- `WindowsEventSource::try_read()` calls `number_of_console_input_events()` and `read_single_input_event()`, then matches `InputRecord::{KeyEvent, MouseEvent, WindowBufferSizeEvent, FocusEvent}` (`C:\Users\evmitran\.cargo\git\checkouts\crossterm-8af208d8974c82d2\87db8bf\src\event\source\windows.rs:43-87`).

So the Windows path is the classic **console-record** path (`ReadConsoleInputW` under the `crossterm_winapi` wrapper), not the Unix `mio` byte-reader path.

## 2. Where Windows decodes input, and where the `ESC` leader can disappear

On Windows, crossterm does **not** feed input through Unix `parse_event(...)`. The decisive decode site is `src/event/sys/windows/parse.rs`.

The relevant mappings are:

- `VK_ESCAPE => Some(KeyCode::Esc)` (`C:\Users\evmitran\.cargo\git\checkouts\crossterm-8af208d8974c82d2\87db8bf\src\event\sys\windows\parse.rs:242-246`)
- `VK_NEXT => Some(KeyCode::PageDown)` (`C:\Users\evmitran\.cargo\git\checkouts\crossterm-8af208d8974c82d2\87db8bf\src\event\sys\windows\parse.rs:252-253`)
- ordinary UTF-16 character payloads become `KeyCode::Char(ch)` (`C:\Users\evmitran\.cargo\git\checkouts\crossterm-8af208d8974c82d2\87db8bf\src\event\sys\windows\parse.rs:260-280`)
- `handle_key_event(...)` wraps that into `Event::Key(...)` (`C:\Users\evmitran\.cargo\git\checkouts\crossterm-8af208d8974c82d2\87db8bf\src\event\sys\windows\parse.rs:42-60`)

Focus is decoded even higher up, as a dedicated console record:

- `InputRecord::FocusEvent(record)` maps directly to `Event::FocusGained` / `Event::FocusLost` (`C:\Users\evmitran\.cargo\git\checkouts\crossterm-8af208d8974c82d2\87db8bf\src\event\source\windows.rs:73-80`)

That is why the old Unix explanation does not transfer. There is **no** Windows byte-buffer parser whose state could be prematurely cleared after a one-byte `ESC`.

The Windows source-backed way to get leaked tails like `[O[I` or `[6~` is different: if the console stack has already materialized a VT sequence as separate key records, crossterm will:

1. decode the leading `ESC` key record as `KeyCode::Esc` (`C:\Users\evmitran\.cargo\git\checkouts\crossterm-8af208d8974c82d2\87db8bf\src\event\sys\windows\parse.rs:242-246`), and
2. decode subsequent `[` / `O` / `I` / `6` / `~` records as ordinary `KeyCode::Char(...)` values (`C:\Users\evmitran\.cargo\git\checkouts\crossterm-8af208d8974c82d2\87db8bf\src\event\sys\windows\parse.rs:260-280`).

That exact shape matches the operator's visible symptom: the `ESC` leader is not shown as text, while the tail `[O[I...` or `[6~...` is.

Importantly, this is **not** Unix-style byte fragmentation inside crossterm. It is Windows record decoding with no VT-sequence reassembly layer.

## 3. crossterm vs codex vs fork: where the bug lives on Windows

### Not the prior Unix bug

The prior investigation's key source claim was:

- Unix `parse_event()` treats lone `ESC` as complete when `input_available == false`
- Unix `mio.rs` feeds bytes through that parser one read-chunk at a time

That citation is real for Unix, but it is Unix-only (`D:\harness-efforts\codexu\.ralph\investigations\codex-tui-focus-event-leak\findings.md:99-128`).

### Not a codex-side byte reader

I do not see a codex-side Windows input reader that could be fragmenting VT sequences itself.

- codex's `CrosstermEventSource` is just a thin wrapper around `crossterm::event::EventStream` (`D:\harness-efforts\codexu\codex\external\repos\codex-patched\codex-rs\tui\src\tui\event_stream.rs:117-129`)
- `map_crossterm_event()` only maps already-decoded crossterm events into `TuiEvent`; it does not decode bytes or reassemble escape sequences (`D:\harness-efforts\codexu\codex\external\repos\codex-patched\codex-rs\tui\src\tui\event_stream.rs:236-259`)
- crossterm's async `EventStream` itself just calls `poll_internal()` and `read_internal()`; on Windows those still go through `WindowsEventSource` (`C:\Users\evmitran\.cargo\git\checkouts\crossterm-8af208d8974c82d2\87db8bf\src\event\stream.rs:40-67`, `101-145`, plus `C:\Users\evmitran\.cargo\git\checkouts\crossterm-8af208d8974c82d2\87db8bf\src\event\read.rs:18-26`)

So there is no codex-owned "tiny chunk stdin reader" here analogous to Unix `mio.rs`.

### Not a visible `// SANDBOX PATCH` in the traced input path

The codex lines I traced for Windows terminal setup and event delivery are:

- `tui/src/tui.rs:171-186`, `1041-1080`
- `tui/src/tui/event_stream.rs:117-129`, `236-259`

Those traced blocks contain no `// SANDBOX PATCH:` markers, and the surrounding fork-only markers in `tui/src/` are unrelated UI/config patches rather than terminal-input rewrites. So I do not see evidence that this Windows input behavior was introduced by the codex fork.

## 4. Reconciliation with the prior Unix-path finding

The earlier finding was correct **for Unix**, but it should not be carried over to Windows as-is.

- `src/event/source/unix/mio.rs` is Unix-only.
- `src/event/sys/unix/parse.rs` is Unix-only.
- On Windows, `InternalEventReader` switches to `WindowsEventSource` instead (`C:\Users\evmitran\.cargo\git\checkouts\crossterm-8af208d8974c82d2\87db8bf\src\event\read.rs:18-26`).

So:

- **Prior Unix citation:** valid for Unix terminals only.
- **Windows-equivalent citation:** `src/event/source/windows.rs` + `src/event/sys/windows/parse.rs`.

The Windows-equivalent problem is not "byte fragmentation clears parser state"; it is "the Windows path has no VT-sequence reassembly layer, so an `Esc` record plus later printable-char records will surface exactly as `Esc` + tail chars."

## 5. Fix locus recommendation

### What I do **not** recommend

I do **not** recommend treating this as a codex TUI bug and patching the composer/text-area logic. The composer only sees decoded `KeyEvent`s after crossterm has already decided what they are. For example, the paste-burst path only buffers plain `KeyCode::Char(...)` events; it does not invent them (`D:\harness-efforts\codexu\codex\external\repos\codex-patched\codex-rs\tui\src\bottom_pane\chat_composer.rs:3137-3210`).

I also do **not** see a source-backed codex-side **settings-only** fix:

- skipping `EnableFocusChange` on Windows would not explain leaked `[6~` PageDown tails, because PageDown is not gated by focus mode;
- codex already uses the standard crossterm EventStream path, not a custom Windows byte reader.

### Cheapest correct locus

The cheapest **correct** fix locus is the **crossterm Windows input path**, not codex's composer:

1. **Preferred narrow fix:** add Windows-side VT-sequence reassembly/decoding in the crossterm Windows path, most likely near `src/event/source/windows.rs` / `src/event/sys/windows/parse.rs`, so a leading `Esc` record followed by `[`-prefixed char records can collapse into semantic events instead of surfacing as printable tails.
2. **Larger fix:** add a real Windows VT-input mode/path (`ENABLE_VIRTUAL_TERMINAL_INPUT` plus a parser that can consume VT sequences on Windows). That is architecturally cleaner, but broader.

Between those two, option 1 is the cheaper targeted repair for the exact symptom. A codex-side workaround would mean reimplementing VT-sequence recognition above crossterm, duplicating terminal parsing that belongs in the input library.

## Bottom line

The prior Unix root-cause citation should be retired for Windows. The Windows source path does **not** support "Unix parser fragmentation inside codex." Instead, it shows:

- VT output enabled, but not VT input;
- WinAPI console-record reads, not byte-stream reads;
- no Windows escape parser state;
- a decode path where `Esc` is a real key event and later printable chars stay printable.

So the Windows verdict is:

- **not** the old Unix `parse.rs` / `mio.rs` bug,
- **not** a codex-side reader fragmentation bug,
- **likely** a lower-layer Windows input interpretation gap that crossterm currently does not reassemble,
- and therefore the cheapest robust fix is a **crossterm Windows input-path change**, not a codex composer patch.
