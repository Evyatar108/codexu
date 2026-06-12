# Codex Windows input-leak fix design

## Verdict

This is a **codex-side Windows console-mode normalization fix**, not a crossterm fork.

The cheapest correct repair is:

1. **On Windows TUI entry, explicitly clear `ENABLE_VIRTUAL_TERMINAL_INPUT` on `STD_INPUT_HANDLE` before `enable_raw_mode()`.**
2. **On TUI restore/exit, restore only the original VT-input bit to whatever input mode is current at that point.**

That stops **both** leaked focus tails (`[O` / `[I`) and leaked special-key tails (`[6~`) while preserving the existing background-notification / `terminal_focused` feature.

## A. Resolved subtlety: why raw VT tails appear on Windows

### 1. Codex really is using crossterm's Windows `INPUT_RECORD` path

On Windows, crossterm's internal reader always chooses `WindowsEventSource`, and that source reads `InputRecord`s from the console handle rather than running the Unix byte-stream parser (`C:\Users\evmitran\.cargo\git\checkouts\crossterm-8af208d8974c82d2\87db8bf\src\event\read.rs:18-26`, `src\event\source\windows.rs:43-87`).

That means codex is not fragmenting bytes in app code. `codex-rs\tui\src\tui\event_stream.rs` just wraps `crossterm::event::EventStream` and maps already-decoded crossterm events into `TuiEvent`s (`D:\harness-efforts\codexu\codex\external\repos\codex-patched\codex-rs\tui\src\tui\event_stream.rs:117-129`, `236-259`).

### 2. Codex does ask Windows Terminal for xterm-style focus reports

`set_modes()` executes `EnableFocusChange` on stdout (`codex-rs\tui\src\tui.rs:171-186`). On Windows 10+, crossterm commands use the ANSI path whenever ANSI is supported: `ExecutableCommand::execute()` calls `queue()`, and `queue()` writes ANSI unless `is_ansi_code_supported()` is false (`crossterm\src\command.rs:29-36`, `121-133`, `178-181`; `src\macros.rs:108-118`). `EnableFocusChange`'s ANSI form is exactly `CSI ? 1004 h` (`crossterm\src\event.rs:383-386`).

So on Windows Terminal, codex is definitely requesting xterm focus reporting. This is not a WinAPI-only no-op.

### 3. crossterm raw mode does **not** enable VT input, but it also does **not** clear inherited VT input

crossterm's Windows raw-mode implementation only clears `ENABLE_LINE_INPUT | ENABLE_ECHO_INPUT | ENABLE_PROCESSED_INPUT`; it preserves every other input-mode bit that was already present (`crossterm\src\terminal\sys\windows.rs:17-41`).

That matters because Microsoft's console docs say `ENABLE_VIRTUAL_TERMINAL_INPUT` causes user input to be converted into VT sequences, and Microsoft Terminal maintainers explicitly describe that mode as giving applications a Unix-style stdin rather than Win32-style key metadata:

- Microsoft Learn: `ENABLE_VIRTUAL_TERMINAL_INPUT` "directs the Virtual Terminal processing engine to convert user input ... into Console Virtual Terminal Sequences" (`https://learn.microsoft.com/en-us/windows/console/setconsolemode`).
- Microsoft Learn: special keys such as PageDown become VT input sequences like `ESC [ 6 ~` (`https://learn.microsoft.com/en-us/windows/console/console-virtual-terminal-sequences`, "Input Sequences").
- Windows Terminal discussion #18214: with `ENABLE_VIRTUAL_TERMINAL_INPUT`, Windows gives an "UNIX-style stdin" and `dwControlKeyState` / Win32 key fidelity no longer behaves like normal console input (`https://github.com/microsoft/terminal/discussions/18214`).
- Windows Terminal issue #15743: with VT input enabled, even `ESC` arrives with `wVirtualKeyCode == 0` and only the character payload set, and that VT-input behavior is inherited by child processes (`https://github.com/microsoft/terminal/issues/15743`).

So the contradiction resolves as follows:

- codex itself does **not** turn on VT input;
- but codex also does **not** normalize it off;
- therefore if the launching console/session already has `ENABLE_VIRTUAL_TERMINAL_INPUT` active, crossterm's Windows reader will still run on top of a VT-character stream.

That is the Windows-only divergence. Unix works because its parser is designed for VT-byte input; crossterm's Windows path is not.

### 4. The exact place the leading `ESC` is lost

Once VT-input-style `KEY_EVENT_RECORD`s are fed into crossterm's Windows parser, the leak shape matches the source exactly.

The Windows parser only recognizes `Esc` as `KeyCode::Esc` when `virtual_key_code == VK_ESCAPE` (`crossterm\src\event\sys\windows\parse.rs:242-246`). But the Terminal issue above documents the problematic VT-input case: `ESC` can arrive with `wVirtualKeyCode == 0` and only `uChar == 0x1b` set (`https://github.com/microsoft/terminal/issues/15743`).

When that happens, crossterm falls into the generic `_` branch (`parse.rs:260-280`). For control chars `0x00..=0x1f`, it **does not** emit `KeyCode::Char(ch)` from the byte it already has; instead it calls `get_char_for_key(key_event)` (`parse.rs:263-270`). That helper reconstructs characters from Win32 virtual-key/scan-code information via `ToUnicodeEx` (`parse.rs:143-201`). With a VT-style record whose VK/scancode are effectively zero, that reconstruction has no meaningful Win32 key to decode, so the parser yields `None`.

`WindowsEventSource::try_read()` drops `None` events and keeps polling (`crossterm\src\event\source\windows.rs:47-87`).

The following bytes in the same VT sequence are ordinary printable chars:

- `[` / `O` / `I` in focus reports
- `[` / `6` / `~` in PageDown

Those hit the printable-char path and become `KeyCode::Char(...)` (`parse.rs:274-279`), so the composer sees the tail **without** the `ESC` leader. That is why the operator sees raw `[O[I...` and `[6~` rather than a visible leading escape glyph.

### 5. Why the bug is Windows-only

Unix/macOS use the VT byte-stream parser, where `ESC[I` / `ESC[O` / `ESC[6~` are exactly the normal input encoding and are assembled by the parser state machine. Windows uses `WindowsEventSource` + `parse.rs` instead, which expects Win32 `INPUT_RECORD` semantics. The bug is specifically the mismatch between:

- **VT-input-style character records**, and
- **a parser that assumes structured Win32 key records**.

## B. Recommended fix: codex-side input-mode normalization

### Chosen fix

Add a Windows-only codex TUI helper that **clears `ENABLE_VIRTUAL_TERMINAL_INPUT` before raw mode is enabled**, and **restores only the original VT-input bit on restore/exit**.

This is the cheapest fix because it keeps the existing crossterm Windows path on the mode it was written for: structured `INPUT_RECORD`s.

With VT input cleared:

- focus changes can keep arriving through `InputRecord::FocusEvent`, which crossterm already maps to `Event::FocusGained` / `Event::FocusLost` (`crossterm\src\event\source\windows.rs:73-80`);
- PageDown can keep arriving as `VK_NEXT`, which crossterm already maps to `KeyCode::PageDown` (`crossterm\src\event\sys\windows\parse.rs:252-253`);
- codex's existing focus bookkeeping remains unchanged (`codex-rs\tui\src\tui\event_stream.rs:249-257`).

### Why this is better than enabling VT input

The prompt's "maybe enable `ENABLE_VIRTUAL_TERMINAL_INPUT`" candidate is the wrong direction.

There is **no** crossterm Windows VT-input parser path to switch to:

- on Windows, `InternalEventReader` unconditionally instantiates `WindowsEventSource` (`crossterm\src\event\read.rs:18-26`);
- `WindowsEventSource` always reads `InputRecord`s (`src\event\source\windows.rs:43-87`);
- `parse.rs` has Win32-key decoding logic only; there is no Windows-side escape-sequence assembler comparable to Unix `parse_event(...)`;
- searching the pinned crossterm tree finds no Windows use of `ENABLE_VIRTUAL_TERMINAL_INPUT`.

So turning VT input **on** in codex would not route input into a working VT parser. It would keep feeding VT-character `KEY_EVENT_RECORD`s into the same Windows parser that drops the `ESC` leader and leaks the tail.

### Why a crossterm fork is not the cheapest correct fix

A crossterm fork is only justified if a live probe proves that Windows Terminal still feeds VT-character records into `ReadConsoleInputW` **after** codex has explicitly cleared `ENABLE_VIRTUAL_TERMINAL_INPUT`.

Current evidence does not require that escalation. The codex-side normalization point is sufficient and much cheaper:

- 1 Rust crate (`codex-tui`)
- no dependency/fork churn
- no `[patch.crates-io]` repoint
- no operator approval gate

If that codex-side fix is ever falsified by a live repro, then the fallback fork would be:

1. fork `https://github.com/nornagon/crossterm` under **`Evyatar108`** (operator approval required because this is an external action);
2. patch the Windows parser to detect VT-input-style `KEY_EVENT_RECORD`s and run a tiny VT-sequence reassembler before emitting chars;
3. repoint `codex-rs\Cargo.toml`'s existing `[patch.crates-io].crossterm` stanza (`D:\harness-efforts\codexu\codex\external\repos\codex-patched\codex-rs\Cargo.toml:532-535`).

That is a valid fallback, but it is not the cheapest first fix.

## C. Background-notification non-regression

The unfocused-notification feature hangs off `terminal_focused`, which codex updates from crossterm focus events in `event_stream.rs` (`249-257`) and later reads in `should_emit_notification(...)` / `notify(...)` (`codex-rs\tui\src\tui.rs:78-83`, `647-670`).

The recommended fix should **improve** that feature on Windows rather than regress it:

- today, VT-character leakage means focus changes can degenerate into printable `[I` / `[O` tails;
- after clearing VT input, the Windows reader stays on its native `FocusEvent` path (`crossterm\src\event\source\windows.rs:73-80`);
- codex's existing `terminal_focused` updates then keep working with no app-layer behavior change.

So there is no need to disable focus reporting globally, and no reason to regress `NotificationCondition::Unfocused`.

## D. Exact implementation plan

### Scope

**Pure codex-rs change. No crossterm fork. No operator approval needed.**

Estimated effort: **small** (roughly 45-90 minutes including focused tests).

### Files and edits

#### 1. `codex-rs/tui/src/tui.rs`

Add a Windows-only helper next to the existing Windows console helpers (`ensure_virtual_terminal_processing()` and `flush_terminal_input_buffer()` are already in this file, so it is the correct seam).

Suggested helper shape:

- `read_console_input_mode() -> Result<u32>`
- `write_console_input_mode(mode: u32) -> Result<()>`
- a tiny Windows-only saved-state holder for the original **VT-input bit only**
- `enter_codex_tui_input_mode()`:
  - read current `STD_INPUT_HANDLE` mode;
  - remember whether `ENABLE_VIRTUAL_TERMINAL_INPUT` was set;
  - if set, clear only that bit;
  - leave every other bit alone;
- `restore_saved_virtual_terminal_input_bit()`:
  - read current mode;
  - re-add the VT-input bit iff it was originally present;
  - do **not** overwrite unrelated bits.

Why restore only the VT-input bit instead of the entire mode?

- `RestoreMode::KeepRaw` intentionally keeps raw-mode bits in place for the external-editor path (`codex-rs\tui\src\app\input.rs:12-39`, `codex-rs\tui\src\tui.rs:299-317`, `602-645`);
- restoring the full original input mode there would accidentally undo the "keep raw" contract;
- restoring only the VT-input bit preserves current raw-mode behavior while still handing external programs back the original VT-input setting.

#### 2. `set_modes()` in `codex-rs/tui/src/tui.rs`

Call the new Windows helper **before** `enable_raw_mode()`:

1. `ensure_virtual_terminal_processing()?`
2. **clear inherited `ENABLE_VIRTUAL_TERMINAL_INPUT`**
3. `execute!(stdout(), EnableBracketedPaste)?`
4. `enable_raw_mode()?`
5. keyboard enhancement
6. `execute!(stdout(), EnableFocusChange)`

Clearing VT input before `enable_raw_mode()` matters because crossterm raw mode reads the current input mode and preserves non-raw bits (`crossterm\src\terminal\sys\windows.rs:31-38`).

#### 3. `restore_common()` in `codex-rs/tui/src/tui.rs`

After the existing bracketed-paste / focus cleanup and after optional `disable_raw_mode()`, restore the saved VT-input bit.

That covers:

- normal TUI exit (`restore()`)
- panic exit (`restore_after_exit()`)
- temporary restore for external programs (`with_restored(...)`)

No app-layer logic changes are needed in `event_stream.rs`, `app.rs`, or the composer.

### Focused tests to add

#### 1. `codex-rs/tui/src/tui.rs` Windows-only unit tests

Add pure bitmask tests for the new helper logic:

- **enter strips VT input only**
  - input mode with `ENABLE_VIRTUAL_TERMINAL_INPUT | ENABLE_WINDOW_INPUT | ENABLE_MOUSE_INPUT | ENABLE_EXTENDED_FLAGS`
  - expected result keeps every flag except VT input
- **restore re-adds VT input only when originally present**
  - saved=`true` re-adds the bit
  - saved=`false` leaves mode unchanged
- **KeepRaw contract preserved**
  - restoring the VT-input bit does not force line/echo/processed bits back on

These are cheap, deterministic, and directly pin the behavior that fixes the bug.

#### 2. Optional doc comment / invariant note

Add a short Windows-only comment explaining why codex clears inherited VT input:

> crossterm's Windows reader expects Win32 `INPUT_RECORD`s; inherited VT input turns special keys/focus into VT-character `KEY_EVENT`s and leaks raw tails like `[I` / `[6~`.

That keeps the seam obvious on the next upstream rebase.

## E. Rejected options

### Rejected: "Enable `ENABLE_VIRTUAL_TERMINAL_INPUT` in codex"

Rejected because crossterm's Windows reader does not switch to a VT parser when that flag is set. It keeps using `WindowsEventSource` + `parse.rs`, which is exactly the combination that drops the leading `ESC` and leaks the printable tail.

### Rejected: "Patch the composer/text area to swallow `[I` / `[O` / `[6~`"

Rejected because the leak is below the app layer. The composer only sees already-decoded `KeyEvent`s. Swallowing a few strings in the composer would be heuristic, fragile, and easy to get wrong for real user input.

### Rejected: crossterm fork as first move

Rejected because codex can normalize the offending input mode locally with a much smaller change and zero dependency-management cost.
