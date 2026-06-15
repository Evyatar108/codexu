# codex bracketed paste failure in Windows Terminal

## Verdict

For the released `0.135.0-copilot-api.8` codex build, crossterm does **not** deliver `Event::Paste(String)` on Windows through the event path codex is using. Codex does emit `EnableBracketedPaste`, and Windows Terminal can understand that output sequence, but codex immediately keeps Windows console input in WinAPI `INPUT_RECORD` mode with `ENABLE_VIRTUAL_TERMINAL_INPUT` cleared. Crossterm's Windows source reads `InputRecord::{KeyEvent,MouseEvent,WindowBufferSizeEvent,FocusEvent}` and maps key input to `Event::Key(...)`; the bracketed-paste parser that produces `Event::Paste(...)` exists only in the Unix VT parser in this pinned crossterm revision.

That means when the paste-burst heuristic is disabled (`disable_paste_burst = true`, which is the `.8` default because `Feature::LegacyPasteBurstHeuristic` defaults off), a Windows Terminal paste reaches codex as a flood of ordinary key events, not as one bracketed-paste event. Multiline payloads then follow the normal `KeyCode::Enter` path and can submit early. In this build, the heuristic is the only working Windows paste-grouping path.

## Source snapshots

All source reads were from the isolated release worktree:

`D:\harness-efforts\codexu\.ralph\external\codex-paste-inv\codex-rs\`

I did not read or modify the sibling impl member's active codex checkout for source investigation.

### START git status snapshot

Captured before the investigation with:

```powershell
git --no-pager status --porcelain=v1
git -C .\codex --no-pager status --porcelain=v1
git -C .\codex\external\repos\codex-patched --no-pager status --porcelain=v1
```

The codexu status output was 746 lines due to many pre-existing generated/untracked Ralph artifacts. The section boundaries were:

```text
1:[codexu]
727:[codex]
734:[codex-patched]
```

Material codexu top-level entries:

```text
[codexu]
 M .ralph-overview/generated/activity.jsonl
 M .ralph-overview/generated/dependency-graph.json
 M .ralph-overview/generated/overview.html
 M .ralph-overview/generated/ralph-state.js
 M .ralph-overview/generated/ralph-state.json
 M .ralph-overview/generated/recommendations.json
 M .ralph-overview/generated/snapshot.json
 M .ralph/brainstorms/crews-roles-and-direct-operator-channel/selected-direction.md
 M .ralph/jobs/codex-nonblocking-bg-completion-surfacing/plan.md
 M codex
 M tasks/INDEX.md
 ?? .ralph-overview/generated/active-tasks.json
 ?? .ralph-overview/generated/summary-projection.json
 ?? .ralph/external/
 ?? .ralph/investigations/... (many pre-existing untracked investigation directories)
 ?? .ralph/jobs/... (many pre-existing untracked job artifacts)
```

Full submodule sections:

```text
[codex]
 M external/repos/codex-patched
?? .crews/
?? .ralph-overview/
?? .worktrees/
?? external/repos/codex-anthropic-models-opt-in-gate-worktree/
?? tasks/INDEX.md
[codex-patched]
 M codex-rs/Cargo.toml
 M codex-rs/cli/Cargo.toml
 M codex-rs/cloud-tasks/Cargo.toml
 M codex-rs/core/Cargo.toml
 M codex-rs/protocol/Cargo.toml
 M codex-rs/tui/Cargo.toml
 M codex-rs/tui/src/lib.rs
 M codex-rs/utils/image/Cargo.toml
 M docs/implementation/patch-surface.md
?? .worktrees/
```

### END git status snapshot

Captured after writing this findings file with the same three status commands. The final output was 747 lines; the only new line relative to the pre-write snapshot is this deliverable directory:

```text
22:?? .ralph/investigations/codex-bracketed-paste-fails-windows-terminal/
```

The section boundaries were:

```text
1:[codexu]
728:[codex]
735:[codex-patched]
```

Material codexu top-level entries:

```text
[codexu]
 M .ralph-overview/generated/activity.jsonl
 M .ralph-overview/generated/dependency-graph.json
 M .ralph-overview/generated/overview.html
 M .ralph-overview/generated/ralph-state.js
 M .ralph-overview/generated/ralph-state.json
 M .ralph-overview/generated/recommendations.json
 M .ralph-overview/generated/snapshot.json
 M .ralph/brainstorms/crews-roles-and-direct-operator-channel/selected-direction.md
 M .ralph/jobs/codex-nonblocking-bg-completion-surfacing/plan.md
 M codex
 M tasks/INDEX.md
 ?? .ralph-overview/generated/active-tasks.json
 ?? .ralph-overview/generated/summary-projection.json
 ?? .ralph/external/
 ?? .ralph/investigations/codex-bracketed-paste-fails-windows-terminal/
 ?? .ralph/investigations/... (other pre-existing untracked investigation directories)
 ?? .ralph/jobs/... (many pre-existing untracked job artifacts)
```

Full submodule sections were unchanged from START:

```text
[codex]
 M external/repos/codex-patched
?? .crews/
?? .ralph-overview/
?? .worktrees/
?? external/repos/codex-anthropic-models-opt-in-gate-worktree/
?? tasks/INDEX.md
[codex-patched]
 M codex-rs/Cargo.toml
 M codex-rs/cli/Cargo.toml
 M codex-rs/cloud-tasks/Cargo.toml
 M codex-rs/core/Cargo.toml
 M codex-rs/protocol/Cargo.toml
 M codex-rs/tui/Cargo.toml
 M codex-rs/tui/src/lib.rs
 M codex-rs/utils/image/Cargo.toml
 M docs/implementation/patch-surface.md
?? .worktrees/
```

## Prior investigation context

The prior paste investigation established that codex has two paste paths:

1. Bracketed paste path: codex enables bracketed paste, maps `Event::Paste(String)` to `TuiEvent::Paste(String)`, and calls `chat_widget.handle_paste(...)`.
2. Heuristic fallback: `tui/src/bottom_pane/paste_burst.rs` groups rapid `KeyCode::Char`/`KeyCode::Enter` streams for terminals that do not produce bracketed-paste events.

That report did not settle why the bracketed-paste path was not working in Windows Terminal.

## 1. Terminal setup and bracketed-paste enable

Codex imports `EnableBracketedPaste`, `DisableBracketedPaste`, raw-mode helpers, and alternate-screen commands in `tui/src/tui.rs:21-35`.

The TUI setup path is `set_modes()`:

- `ensure_virtual_terminal_processing()?` is called first.
- `enter_codex_tui_input_mode()?` is called next.
- `execute!(stdout(), EnableBracketedPaste)?` is unconditional, not `cfg(unix)` only.
- `enable_raw_mode()?` follows.
- focus-change setup is platform-conditional: Windows disables focus changes, non-Windows enables them.

Citation: `tui/src/tui.rs:308-329`.

Alternate screen is not part of initial terminal setup; it is entered later through `Tui::enter_alt_screen()`, where codex executes `EnterAlternateScreen` and enables alternate scroll. Citation: `tui/src/tui.rs:866-887`. Leaving alt screen executes `DisableAlternateScroll` and `LeaveAlternateScreen`. Citation: `tui/src/tui.rs:890-903`.

On Windows, codex enables VT output processing only for stdout/stderr:

- `ensure_virtual_terminal_processing()` requests `ENABLE_PROCESSED_OUTPUT | ENABLE_VIRTUAL_TERMINAL_PROCESSING`.
- It operates on `STD_OUTPUT_HANDLE` and `STD_ERROR_HANDLE`.
- It does not set `ENABLE_VIRTUAL_TERMINAL_INPUT` on stdin.

Citation: `tui/src/tui.rs:1215-1255`.

More importantly, codex actively clears VT input on Windows:

- `ENABLE_VIRTUAL_TERMINAL_INPUT_BIT` is defined from `ENABLE_VIRTUAL_TERMINAL_INPUT`.
- `CODEX_TUI_UNEXPECTED_INPUT_BITS` includes `WINDOWS_RAW_MODE_DISALLOWED_INPUT_BITS | ENABLE_VIRTUAL_TERMINAL_INPUT_BIT`.
- `codex_tui_input_mode(input_mode)` returns `input_mode & !CODEX_TUI_UNEXPECTED_INPUT_BITS`.
- `enter_codex_tui_input_mode()` reads the current stdin console mode and writes the normalized mode if it differs.
- Before every Windows event read, `prepare_windows_input_mode_before_read()` computes `expected_mode = codex_tui_input_mode(input_mode)` and reasserts it.

Citations: `tui/src/tui.rs:1263-1275`, `tui/src/tui.rs:1364-1372`, `tui/src/tui.rs:1412-1428`, `tui/src/tui/event_stream.rs:254-272`.

The Windows tests document the intended invariant: `codex_tui_input_mode_clears_cooked_and_vt_bits` clears `ENABLE_VIRTUAL_TERMINAL_INPUT`, and `virtual_terminal_input_stays_cleared_until_final_exit_restore` keeps VT input cleared mid-session. Citation: `tui/src/tui.rs:255-305`.

## 2. Codex event loop: Paste vs Key handling

Codex defines the TUI event surface with separate `Key(KeyEvent)` and `Paste(String)` variants. Citation: `tui/src/tui.rs:638-643`.

On Windows, codex does not use crossterm's async `EventStream` directly. It wraps crossterm reads in a custom thread:

- `CrosstermEventSource` on non-Windows is `crossterm::event::EventStream`.
- `CrosstermEventSource` on Windows owns an `mpsc::UnboundedReceiver`, a shutdown flag, and a thread handle.
- The Windows thread waits for the stdin handle with `WaitForSingleObject`, calls `prepare_windows_input_mode_before_read()`, then calls `crossterm::event::poll(Duration::from_millis(0))` and `crossterm::event::read()`.

Citations: `tui/src/tui/event_stream.rs:123-153`, `tui/src/tui/event_stream.rs:187-201`, `tui/src/tui/event_stream.rs:220-252`.

Codex maps crossterm events directly:

- `Event::Key(key_event)` becomes `TuiEvent::Key(key_event)`.
- `Event::Paste(pasted)` becomes `TuiEvent::Paste(pasted)`.

Citation: `tui/src/tui/event_stream.rs:378-391`.

The app consumes them on separate arms:

- `TuiEvent::Key(key_event)` calls `handle_key_event(...)`.
- `TuiEvent::Paste(pasted)` normalizes `\r` to `\n` and calls `self.chat_widget.handle_paste(pasted)`.

Citation: `tui/src/app.rs:1243-1254`.

The heuristic paste-burst path hooks into the Key path, not the Paste path:

- `handle_input_basic_with_time()` flushes due burst state before each key.
- For `KeyCode::Enter`, if the heuristic is enabled and the burst is active, it appends a newline to the burst buffer.
- For plain `KeyCode::Char(ch)`, if the heuristic is enabled and the textarea allows it, the code calls `paste_burst.on_plain_char(...)`; decisions can buffer the char, begin buffering with retro-capture, begin buffering from a pending first char, or retain a pending first char.

Citations: `tui/src/bottom_pane/chat_composer.rs:3122-3164`, `tui/src/bottom_pane/chat_composer.rs:3166-3195`.

The broader submit/newline path also gates Enter suppression on `!self.draft.disable_paste_burst` and `paste_burst` state. Citation: `tui/src/bottom_pane/chat_composer.rs:2713-2745`.

The heuristic itself is explicitly for terminals without bracketed paste. Its module docs say Windows pastes often arrive as rapid `KeyCode::Char` and `KeyCode::Enter` events rather than a single paste event. Citation: `tui/src/bottom_pane/paste_burst.rs:1-18`. Its Windows active-idle timeout is 60ms. Citation: `tui/src/bottom_pane/paste_burst.rs:148-161`. A due active burst flushes as `FlushResult::Paste(out)`. Citation: `tui/src/bottom_pane/paste_burst.rs:280-312`.

## 3. Config resolution in the `.8` tree

The pinned `.8` source gates the heuristic behind `Feature::LegacyPasteBurstHeuristic`:

- The feature is declared as "Enable legacy non-bracketed paste-burst detection. Default off."
- Its `FeatureSpec` has key `legacy_paste_burst_heuristic`.
- `default_enabled: false`.

Citations: `features/src/lib.rs:140-142`, `features/src/lib.rs:1014-1025`.

Config resolves `disable_paste_burst` as the inverse of that feature:

```rust
let disable_paste_burst = !features.enabled(Feature::LegacyPasteBurstHeuristic);
```

Citation: `core/src/config/mod.rs:2631-2633`.

The compatibility adapter maps the old top-level `disable_paste_burst` knob to the feature only if the canonical feature key is not explicitly present:

- canonical `features.legacy_paste_burst_heuristic` wins when both are set.
- old `disable_paste_burst = false` enables `Feature::LegacyPasteBurstHeuristic`.

Citations: `core/src/config/mod.rs:2576-2588`, `core/src/config/config_tests.rs:9280-9296`, `core/src/config/config_tests.rs:9299-9319`.

The default test verifies `.8` defaults to heuristic disabled: `!config.features.enabled(Feature::LegacyPasteBurstHeuristic)` and `config.disable_paste_burst`. Citation: `core/src/config/config_tests.rs:9243-9255`.

That resolved config is passed into the TUI bottom pane as `disable_paste_burst: config.disable_paste_burst`. Citation: `tui/src/chatwidget/constructor.rs:100-107`.

## 4. Crossterm version and exact source

`Cargo.lock` pins `crossterm` to version `0.28.1` from git source:

```text
name = "crossterm"
version = "0.28.1"
source = "git+https://github.com/nornagon/crossterm?rev=87db8bfa6dc99427fd3b071681b07fc31c6ce995#87db8bfa6dc99427fd3b071681b07fc31c6ce995"
```

Citation: `Cargo.lock:4699-4701`.

The local exact checkout read for crossterm was:

`C:\Users\evmitran\.cargo\git\checkouts\crossterm-8af208d8974c82d2\87db8bf\`

## 5. Crossterm Windows backend verdict

### EnableBracketedPaste command

In this crossterm revision, `EnableBracketedPaste` is implemented as the ANSI sequence `CSI ? 2004 h` (`\x1b[?2004h`). Its Windows WinAPI fallback returns `Unsupported` with message "Bracketed paste not implemented in the legacy Windows API." Citations: `crossterm/src/event.rs:411-433`.

This means `EnableBracketedPaste` is not inherently a Windows no-op when ANSI is supported: crossterm's command machinery writes ANSI when a command's ANSI representation is supported, and falls back to `execute_winapi()` only when it is not. Citations: `crossterm/src/command.rs:29-36`, `crossterm/src/command.rs:121-133`, `crossterm/src/command.rs:178-180`.

So Windows Terminal can receive the bracketed-paste enable sequence from codex. The failure is on input delivery, not on the terminal-level output sequence.

### Event enum

Crossterm's public `Event` enum has `Paste(String)`, but it is conditional on the `bracketed-paste` feature and documented as emitted only if bracketed paste has been enabled. Citation: `crossterm/src/event.rs:543-559`.

### Windows event source

Crossterm's `InternalEventReader` selects `WindowsEventSource::new()` under `#[cfg(windows)]`; Unix selects `UnixInternalEventSource::new()`. Citation: `crossterm/src/event/read.rs:18-25`.

`WindowsEventSource` reads WinAPI console input records:

- It creates `Console::from(Handle::current_in_handle()?)`.
- In `try_read()`, it calls `self.console.read_single_input_event()?`.
- It matches only `InputRecord::KeyEvent`, `MouseEvent`, `WindowBufferSizeEvent`, `FocusEvent`, and `_`.
- Key events are handled by `handle_key_event(...)`.
- When an event is produced, it returns `InternalEvent::Event(event)`.

Citation: `crossterm/src/event/source/windows.rs:19-40`, `crossterm/src/event/source/windows.rs:43-86`.

`handle_key_event(...)` returns only `Event::Key(...)` for key records. The surrogate path also returns `Event::Key(KeyCode::Char(ch), ...)`. Citation: `crossterm/src/event/sys/windows/parse.rs:42-60`.

The key parser maps `VK_RETURN` to `KeyCode::Enter`, regular UTF-16 chars to `KeyCode::Char(ch)`, and then wraps any parsed key code as `WindowsKeyEvent::KeyEvent(KeyEvent::new_with_kind(...))`. Citation: `crossterm/src/event/sys/windows/parse.rs:204-296`.

There is no `Event::Paste` construction in `src/event/sys/windows/*` in this pinned crossterm source. The only crossterm parser that recognizes bracketed paste is the Unix VT parser:

- In CSI parsing, if the buffer starts with `\x1B[200~`, it calls `parse_csi_bracketed_paste(buffer)`.
- `parse_csi_bracketed_paste()` waits for the ending `\x1b[201~`, extracts the payload, and returns `InternalEvent::Event(Event::Paste(paste))`.

Citations: `crossterm/src/event/sys/unix/parse.rs:247-250`, `crossterm/src/event/sys/unix/parse.rs:863-872`.

### Windows VT input mode

This codex build does not switch Windows to a VT/ANSI input reader. It does the opposite:

- crossterm Windows reads WinAPI input records (`InputRecord`) rather than feeding stdin bytes into the Unix ANSI parser.
- codex clears `ENABLE_VIRTUAL_TERMINAL_INPUT` during setup and reasserts that before every read.

Citations: `crossterm/src/event/source/windows.rs:43-86`, `tui/src/tui.rs:1263-1275`, `tui/src/tui.rs:1369-1372`, `tui/src/tui/event_stream.rs:254-272`.

Therefore, on Windows this codex/crossterm combination has no path from Windows Terminal's bracketed-paste `CSI 200~ ... CSI 201~` input to crossterm `Event::Paste(String)`.

## 6. Step-by-step failure mechanism with guard off

With `disable_paste_burst = true` on Windows Terminal:

1. Codex starts the TUI and emits `EnableBracketedPaste` (`CSI ? 2004 h`) unconditionally. `tui/src/tui.rs:308-315`; `crossterm/src/event.rs:411-425`.
2. Codex enables VT output processing for stdout/stderr, but not VT input. `tui/src/tui.rs:1215-1255`.
3. Codex enters and repeatedly reasserts a Windows input mode that clears `ENABLE_VIRTUAL_TERMINAL_INPUT`. `tui/src/tui.rs:1263-1275`, `tui/src/tui.rs:1369-1372`, `tui/src/tui.rs:1412-1428`, `tui/src/tui/event_stream.rs:254-272`.
4. Windows Terminal supports bracketed paste at the terminal level, but the app is still reading through crossterm's Windows `InputRecord` backend, not a VT byte parser. `crossterm/src/event/read.rs:18-25`, `crossterm/src/event/source/windows.rs:43-86`.
5. The pasted payload arrives as console key records. Crossterm converts printable chars to `Event::Key(KeyCode::Char(...))` and newlines to `Event::Key(KeyCode::Enter)`. `crossterm/src/event/sys/windows/parse.rs:242-292`.
6. Codex maps these to `TuiEvent::Key(...)`; the `TuiEvent::Paste(...)` app arm never runs because crossterm never emitted `Event::Paste`. `tui/src/tui/event_stream.rs:378-391`, `tui/src/app.rs:1243-1254`.
7. Because `disable_paste_burst = true`, the heuristic guard is skipped on both char and Enter paths. `tui/src/bottom_pane/chat_composer.rs:3128-3164`, `tui/src/bottom_pane/chat_composer.rs:2713-2745`.
8. Characters are inserted as ordinary typing. A pasted newline follows ordinary Enter handling instead of "newline inside paste"; depending on composer mode/state, that can submit early, splitting/truncating the intended pasted prompt.

The operator's observation ("bracketed paste didn't work when I disabled the burst guard") is therefore expected for this build: the guard was not merely a legacy fallback; on Windows it was the only path that grouped a paste at all.

## 7. Fix-direction assessment

### Near-term: keep the heuristic enabled on Windows

This is the only viable Windows paste path in the current codex/crossterm architecture. It is also the smallest change surface:

- Adjust default resolution so Windows keeps `LegacyPasteBurstHeuristic` enabled unless the user explicitly opts out, or use a Windows-only config default for `disable_paste_burst`.
- Keep the explicit feature/legacy-adapter shape already present in `features/src/lib.rs` and `core/src/config/mod.rs`.
- Preserve the existing `Event::Paste` path for Unix/other terminals where crossterm actually emits it.

Conflict assessment: small fork patch, low upstream conflict if contained to config default resolution plus tests. It does preserve a known imperfect heuristic, so it does not solve the slowness/dropped-text root cause from the prior investigation; it just avoids the worse "no grouping at all" Windows failure.

### Better long-term: make true Windows bracketed paste work

This is feasible in principle for Windows Terminal, but it is not a small codex-only tweak in this build.

Required change surface:

1. Stop clearing `ENABLE_VIRTUAL_TERMINAL_INPUT` for a Windows Terminal / VT-capable input path, or introduce a mode that deliberately enables it.
2. Use an event reader that consumes VT input bytes and parses bracketed-paste delimiters (`CSI 200~` / `CSI 201~`) into one paste payload.
3. Integrate that with codex's Windows event thread, console-mode restore/reassertion, keyboard/mouse handling, and the recent "keep VT input cleared" sandbox patch.
4. Preferably make this upstream-native in crossterm or by upgrading to a crossterm version that has a supported Windows VT-input paste path, then keep codex surface small.

Conflict assessment: medium-to-high if implemented as a codex-local crossterm fork or custom Windows input reader, because it cuts across terminal mode invariants, event-source plumbing, keyboard enhancement assumptions, mouse/focus handling, and Windows console restore behavior. Lower conflict if done upstream in crossterm and codex only opts into a documented Windows VT input mode, but that still needs a plan and compatibility testing.

### Recommendation

Keep the heuristic enabled by default on Windows for now. Treat "true Windows bracketed paste" as a separate planned task, not a quick replacement. The current release cannot rely on crossterm `Event::Paste` on Windows, so disabling the heuristic removes the only working paste grouping path.
