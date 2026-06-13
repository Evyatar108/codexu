# codex paste guard perf and dropped-text investigation

## Scope

Read-only investigation of:

- codex TUI paste-burst grouping in `D:\harness-efforts\codexu\codex\external\repos\codex-patched\codex-rs`
- Claude Code paste handling in `D:\harness-efforts\claude-code\worktrees\main`

## 1. Codex: how paste grouping currently works

### 1.1 Two distinct paths exist

1. **Bracketed paste path (good path).**
   - Codex explicitly enables terminal bracketed paste mode in the TUI with `EnableBracketedPaste` at startup. `tui/src/tui.rs:291-300`
   - The crossterm event stream maps terminal paste events directly to `TuiEvent::Paste(String)`. `tui/src/tui/event_stream.rs:237-249`
   - The app handles that as one normalized paste payload and forwards it straight to the chat widget. `tui/src/app.rs:1225-1235`

2. **Heuristic "paste burst" fallback (problem path).**
   - The fallback is wired from config into the bottom pane via `disable_paste_burst`. `core/src/config/mod.rs:3576`, `tui/src/chatwidget/constructor.rs:97-104`
   - In the current checked-out code, the config default is still **enabled fallback** (`unwrap_or(false)`), so the heuristic remains on unless the user opts out. `core/src/config/mod.rs:3576`
   - The implementation lives in `tui/src/bottom_pane/paste_burst.rs` and is explicitly described as "for terminals without bracketed paste." `tui/src/bottom_pane/paste_burst.rs:1-18`

### 1.2 The heuristic algorithm

The fallback state machine is time-based:

- It treats chars as part of one burst only if adjacent plain chars arrive within `PASTE_BURST_CHAR_INTERVAL = 8ms`. `tui/src/bottom_pane/paste_burst.rs:153-155,269-277`
- A burst is only recognized after at least `PASTE_BURST_MIN_CHARS = 3`. `tui/src/bottom_pane/paste_burst.rs:148-150,235-239,260-263`
- For ASCII input, it **holds the first char** in `pending_first_char` instead of inserting it immediately, waiting to see whether a second fast char arrives. `tui/src/bottom_pane/paste_burst.rs:170-171,222-243`
- Once buffering is active, the accumulated paste is flushed after `PASTE_BURST_ACTIVE_IDLE_TIMEOUT` with no new char:
  - `8ms` on non-Windows
  - `60ms` on Windows
  `tui/src/bottom_pane/paste_burst.rs:156-161,289-301`
- Enter/newline is treated as "newline inside paste" only while the burst is active or while a separate `PASTE_ENTER_SUPPRESS_WINDOW = 120ms` is still alive. `tui/src/bottom_pane/paste_burst.rs:150-152,320-339`

The chat composer drives this state machine on every plain key event:

- due burst flush first `chat_composer.rs:3120-3123`
- ASCII path via `on_plain_char()` `chat_composer.rs:3142-3193`
- non-ASCII path via `on_plain_char_no_hold()` `chat_composer.rs:1678-1752`
- non-char keys flush buffered paste before normal handling `chat_composer.rs:3201-3210`

Retro-capture is also heuristic, not lossless:

- once codex decides a stream is "paste-like", it may retro-grab already inserted text
- but it only does that when the grabbed prefix contains whitespace or is at least 16 chars long
- otherwise the earlier prefix stays outside the grouped paste
  `tui/src/bottom_pane/paste_burst.rs:368-399`

## 2. Codex root causes

### 2.1 Slowness root cause

**Root cause:** the fallback deliberately injects latency and redraw churn into ordinary typing.

Why:

1. Every isolated ASCII char is initially held instead of inserted immediately. `tui/src/bottom_pane/paste_burst.rs:241-243,302-307`
2. The composer exposes that transient "burst" state, and the bottom pane schedules a delayed redraw at `recommended_flush_delay()` so the held char can finally render. `tui/src/bottom_pane/chat_composer.rs:1513-1529`, `tui/src/bottom_pane/mod.rs:654-663`
3. The same key path also requests an immediate redraw when input mutated state, so normal typing can pay both an immediate redraw and a follow-up delayed redraw while the guard decides whether the input was a paste. `tui/src/bottom_pane/mod.rs:654-663`

So the slowness is **not** a blocking sleep or an O(n^2) string algorithm. It is a **timeout-based UI delay plus extra redraw scheduling on the hot typing path**.

### 2.2 Dropped / incomplete pasted text root cause

**Primary root cause:** the fallback is a timeout heuristic, not a delimiter-based protocol.

What goes wrong:

1. The burst closes after `60ms` idle on Windows (or `8ms` elsewhere). `tui/src/bottom_pane/paste_burst.rs:156-161,289-301`
2. If a slow PC / terminal / PTY trickles one physical paste more slowly than that, codex flushes the current partial buffer early.
3. Later bytes then arrive as a new burst or ordinary typing instead of belonging to the original paste.

That already explains the operator's "incomplete grouping" symptom.

There are two follow-on failure modes:

1. **Short prefix escapes the group.**
   - Retro-capture only triggers for whitespace-containing or >=16-char prefixes. Short whitespace-free prefixes stay outside the grouped paste. `tui/src/bottom_pane/paste_burst.rs:371-399`
2. **Multiline paste can submit early.**
   - Enter is only protected while the burst is active or within the 120ms suppress window. `tui/src/bottom_pane/paste_burst.rs:320-339`
   - If the stream stalls long enough for both the active idle timeout and then the newline suppress window to expire, a pasted Enter can be interpreted as a real submit instead of a newline. `tui/src/bottom_pane/chat_composer.rs:2725-2743,3128-3135`

So the "dropped text" mechanism is: **slow producer -> early timeout-based burst close -> tail no longer grouped; and for multiline payloads, the next delayed Enter can become a submit, truncating the paste at that point.**

## 3. Claude Code approach

Claude Code takes the opposite approach: **protocol-delimited paste first, timing heuristic second**.

### 3.1 Bracketed paste is the primary delimiter

- Claude Code enables bracketed paste mode when the app takes control of stdin. `src/ink/components/App.tsx:242-245`
- The terminal constants for paste start/end are explicit `CSI 200~` and `CSI 201~`. `src/ink/termio/csi.ts:272-280`
- The parser enters `IN_PASTE` on `PASTE_START`, appends all subsequent text/sequences into `pasteBuffer`, and emits exactly one `createPasteKey(pasteBuffer)` on `PASTE_END`. `src/ink/parse-keypress.ts:226-246`

That is deterministic and lossless for terminals that support bracketed paste.

### 3.2 Slow/split input is handled more robustly

- While the parser is in paste mode, App uses a much longer `PASTE_TIMEOUT = 500ms` for incomplete escape sequences. `src/ink/components/App.tsx:117-121,350-356`
- If the flush timer fires but stdin already has more buffered bytes, Claude Code **re-arms instead of flushing early**, specifically to avoid splitting the buffered sequence during heavy render / event-loop delay. `src/ink/components/App.tsx:317-327`
- If a flush still happens while `IN_PASTE`, the parser emits the accumulated paste buffer instead of discarding it. `src/ink/parse-keypress.ts:286-299`

### 3.3 It avoids the old dropped-character race

- Input is centralized through one `stdin.readable` listener. `src/ink/components/App.tsx:242,359-374`
- Parsed keys from a chunk are processed together in one `discreteUpdates` batch. `src/ink/components/App.tsx:335-348`
- Claude Code's paste hook explicitly says the old extra `stdin.on('data')` listener was removed because it raced the central readable listener and caused dropped characters. `src/hooks/usePasteHandler.ts:208-212`
- The hook now trusts `event.keypress.isPasted` from the parser instead. `src/hooks/usePasteHandler.ts:214-218`

### 3.4 There is still a secondary chunk-grouping fallback, but it is not the boundary of truth

- After parser-level detection, `usePasteHandler` may still coalesce large input / continuation chunks with `PASTE_COMPLETION_TIMEOUT_MS = 100`. `src/hooks/usePasteHandler.ts:15-17,94-110,252-266`
- The `pastePendingRef` guard exists specifically to prevent "paste + Enter in the same batch" from submitting old input before the paste state commits. `src/hooks/usePasteHandler.ts:48-53`

That fallback is only for higher-level chunk coalescing after the paste has already been identified, not for guessing whether the terminal stream was a paste in the first place.

## 4. Recommendation

## Recommended codex fix

**Treat bracketed paste as authoritative and make the heuristic fallback opt-in only.**

Concretely:

1. Re-apply the fork default `disable_paste_burst = true` so the heuristic is off unless the user explicitly enables it.
2. Keep the existing `Event::Paste(String)` path as the primary path.
3. Leave the heuristic available only as a legacy fallback for terminals that truly do not emit bracketed paste.

Why this is the cleanest fix:

- codex already enables bracketed paste and already has a clean `Event::Paste(String)` path `tui/src/tui.rs:298`, `tui/src/tui/event_stream.rs:248`, `tui/src/app.rs:1229-1235`
- the current bug is specifically in the heuristic fallback's timeout model, not in the explicit paste path
- disabling the heuristic by default is minimal fork surface and matches the existing fork guidance about avoiding unnecessary upstream conflict

## If a fallback must remain fully robust

If codex needs a truly fast + lossless non-bracketed fallback, that is **not** a tiny tweak to the current heuristic. The current design is fundamentally time-window based, so making it fully lossless would need a more explicit transport-aware strategy than "chars arrived close together".

That follow-up would warrant a small plan. But the immediate operator-facing fix does **not**: flipping the default back to "heuristic off" is a **small fix**.

## Bottom line

- **Slowness:** caused by the fallback holding the first char and scheduling delayed redraws on the normal typing path.
- **Dropped/incomplete paste:** caused by the fallback closing the burst on short idle timeouts, with multiline pastes additionally vulnerable to the 120ms Enter-suppress window expiring before the paste finishes.
- **Best fix:** rely on bracketed paste; disable the heuristic by default; keep the heuristic only as explicit legacy opt-in.
