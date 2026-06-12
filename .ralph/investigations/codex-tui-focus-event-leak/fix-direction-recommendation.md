# Codex TUI focus-event leak: recommended fix direction

## Recommendation

Choose **direction #3: patch the pinned/forked crossterm Unix parser path**, then repoint Codex's existing `[patch.crates-io]` entry at our fork commit.

This is the best direction because the verified fault is **below Codex**: Codex already enables focus reporting (`tui.rs:185`) and already consumes `FocusGained` / `FocusLost` correctly (`event_stream.rs:249-256`). The leak happens because crossterm finalizes a one-byte `ESC` as `KeyCode::Esc` when that byte lands alone at a read boundary (`parse.rs:84-92`), and the later `[` + `I` / `O` bytes then parse as plain characters. The Unix reader feeds `parse_event(&self.buffer, more)` byte-by-byte, where `more` only reflects bytes still available in the current read chunk (plus a full-buffer hint), so a one-byte read of `ESC` is enough to trigger the premature `Esc` emission (`mio.rs:95-102`, `mio.rs:197-217`).

Direction #3 fixes the actual defect at the decoding boundary, avoids heuristic text-swallowing in the Codex composer, and preserves focus-dependent notification behavior.

## Why the other directions lose

### 1. Regression coverage only

Reject. Extending `codex-rs/tui/src/tui/event_stream.rs` tests would document current focus handling, but it would not stop `[I` / `[O` from entering the input. Codex already maps `FocusGained` to `Draw` and `FocusLost` to `None` (`event_stream.rs:249-256`), so tests at that seam only prove behavior that is already correct when crossterm emits real focus events.

### 2. Codex-side pre-composer guard

Reject as the primary fix. A local guard in `event_stream.rs` or just before `App::handle_key_event` (`app.rs:1225-1237`) could try to consume leaked `[I` / `[O` tails and reset paste-burst state, but that is a heuristic layered above a verified lower-level decode bug. The risk is real: if the guard is too broad, it can eat legitimate user-typed bracket text; if it is too narrow, it misses the corrupted sequence. It also widens the fork-only patch surface in upstream-canonical TUI code for a bug Codex does not own.

### 4. Disable focus reporting

Reject. This is not just a cosmetic regression; it directly collides with the background-process notification path the operator just enabled.

Source chain:

1. `features/src/lib.rs:750-754` defines `background_process_notification`.
2. `tui/src/chatwidget/turn_runtime.rs:198-201` emits an `AgentTurnComplete` notification when the agent is truly waiting.
3. `tui/src/chatwidget/notifications.rs:19-21` forwards that pending notification to `tui.notify(...)`.
4. `tui/src/tui.rs:649-652` gates notification delivery on `should_emit_notification(...)`.
5. `tui/src/tui.rs:78-81` implements `NotificationCondition::Unfocused` as `!terminal_focused`.
6. `tui/src/tui/event_stream.rs:249-256` updates `terminal_focused` only from `FocusGained` / `FocusLost`.
7. `tui/src/tui.rs:185` enables terminal focus reporting in the first place.

So yes: **the unfocused-notification behavior depends on focus reporting and `terminal_focused`**.

This matters even more because the notification condition defaults to `unfocused`, not `always` (`config/src/types.rs:592-596`, `config/src/types.rs:631-634`; `core/src/config/config_tests.rs:10569-10578`). Disabling focus reporting would therefore break the default semantics of the background notification feature. At best, users who explicitly set `notification_condition = "always"` would still get notifications, but the intended unfocused-only behavior would be gone.

## Exact dependency state and feasibility

### What is pinned today

- `codex-rs/Cargo.toml:532-535` already uses `[patch.crates-io]` to override `crossterm` with `https://github.com/nornagon/crossterm` at rev `87db8bfa6dc99427fd3b071681b07fc31c6ce995`.
- `codex-rs/Cargo.lock:4698-4701` records that same git source.

### How it is vendored on this box

Cargo has fetched that dependency into the local git checkout cache at:

- `C:\Users\evmitran\.cargo\git\checkouts\crossterm-8af208d8974c82d2\87db8bf\...`

That cache is useful for inspection, and it contains the exact source we root-caused against (`src/event/sys/unix/parse.rs`, `src/event/source/unix/mio.rs`, `src/event.rs`), but it is **not** a durable landing site.

### Durable landing path

Yes: this can and should land via **our own crossterm fork + the existing `[patch.crates-io]` seam**.

Do **not** edit `~/.cargo/git/checkouts/...` directly except for throwaway local spikes. The durable ship path is:

1. Commit the parser fix in a maintained crossterm fork.
2. Update `codex-rs/Cargo.toml` to point the existing `[patch.crates-io]` entry at that fork + commit.
3. Refresh `Cargo.lock`.
4. Because this is a Rust dependency change, also refresh the Bazel lock state in the codex workspace per repo policy.

That keeps the fix reproducible, reviewable, and rebaseable.

## Concrete implementation plan

## Landing repos / checkouts

This is a **multi-repo** implementation:

1. **crossterm fork repo**: actual parser/read-boundary fix + unit tests.
2. **`external/repos/codex-patched` submodule repo** (`codex-rs` workspace): repoint `Cargo.toml` / `Cargo.lock` to the fork commit and refresh Bazel lock state.
3. **outer `codex` wrapper repo**: record the updated `external/repos/codex-patched` gitlink.

Do not treat `C:\Users\evmitran\.cargo\git\checkouts\...` as a repo to modify; it is only Cargo's local dependency cache.

## Files to change

### In the crossterm fork

1. `src/event/sys/unix/parse.rs`
2. `src/event/source/unix/mio.rs`
3. `src/event/source/unix/tty.rs`
4. New/updated unit tests in the same Unix event modules

### In `codex-rs`

1. `Cargo.toml` (`[patch.crates-io]` crossterm source)
2. `Cargo.lock`
3. `MODULE.bazel.lock` (because dependency source changed)

### In the outer `codex` repo

1. The `external/repos/codex-patched` gitlink bump

## Exact code direction

### Root issue to remove

The bad branch is the one-byte `ESC` fast-path in `parse.rs`:

- `src/event/sys/unix/parse.rs:84-92`

Current behavior:

- `buffer == [ESC]` and `input_available == false` => emit `KeyCode::Esc`
- later `[` + `I` / `O` bytes => parsed separately as printable characters

### Recommended shape of the fix

Patch the Unix parser path so a lone `ESC` is treated as **ambiguous/pending** for a short grace window, not as an immediately completed `Esc` key.

Concretely:

1. **Change the single-byte `ESC` branch in `parse.rs:84-92`** so the parser no longer treats `input_available == false` as sufficient proof that the sequence is complete. A one-byte `ESC` must remain pending until either:
   - another byte arrives and the full escape sequence can be decoded, or
   - a short continuation grace window expires and the reader explicitly finalizes it as a literal `Esc`.

2. **Teach both Unix readers** (`source/unix/mio.rs` and `source/unix/tty.rs`) to apply the same continuation grace policy, because both have the same byte-by-byte `Parser::advance(... parse_event(&self.buffer, more) ...)` logic (`mio.rs:95-102`, `mio.rs:197-217`; `tty.rs:243-266`).

3. **After the grace window**, finalize the pending one-byte `ESC` as a real `KeyCode::Esc` if no continuation arrived.

This means the fix is **not realistically parse.rs-only**. The bug is exposed at `parse.rs:84-92`, but a correct repair needs both:

- the parser branch to stop prematurely finalizing one-byte `ESC`, and
- the Unix reader path to decide when a pending `ESC` has waited long enough to become a literal Esc key.

That is still the cleanest seam because it stays in the dependency that owns byte decoding instead of patching Codex's text input path.

## Tests to add

### In the crossterm fork (required)

1. **Unit coverage for split focus reports across read boundaries**
   - simulate `ESC` arriving alone, then `[` + `I`
   - simulate `ESC` arriving alone, then `[` + `O`
   - assert those decode to `FocusGained` / `FocusLost`, not `Esc` + printable chars

2. **Literal Esc regression coverage**
   - simulate a lone `ESC` with no continuation
   - assert it still becomes `KeyCode::Esc` after the grace path

3. **Parity coverage for both Unix reader implementations**
   - `mio.rs`
   - `tty.rs`

### In Codex (nice-to-have, not the primary regression net)

No ratatui snapshot changes are needed; this is not a UI rendering change.

If the impl member wants one codex-side belt-and-suspenders test, the best local one is a small regression at the TUI event seam confirming that properly decoded focus events remain consumed (`event_stream.rs` area around `key_event_skips_unmapped`). But the real bug-catcher must live in crossterm, because Codex tests above that layer cannot reproduce the read-boundary split without the real parser path.

## Effort estimate

**Moderate**: roughly **half a day to one day** for an experienced impl member, mainly because this is a cross-repo dependency patch, not because the parser logic itself is large.

Rough breakdown:

- 1-2 hours: implement + test the crossterm fix
- 30-60 minutes: repoint `Cargo.toml` / `Cargo.lock` and refresh Bazel lock state
- 30-60 minutes: submodule/wrapper pointer updates and review
- extra time only if the first grace-window choice causes unacceptable Unix `Esc` latency and needs retuning

## Product decision needed before impl?

**No product decision is required first.**

This is an engineering seam choice, not a product tradeoff:

- #1 is insufficient
- #2 is riskier and dirtier
- #4 breaks unfocused notifications
- #3 fixes the verified root cause while preserving behavior

The only implementation judgment call is the exact grace duration for a pending one-byte `ESC`, and that should be resolved by engineering validation in the crossterm fork, not by a product call.
