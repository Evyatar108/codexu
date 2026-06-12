# codex-tui-focus-leak-recurs-after-v1-agent-spawn

## Verdict

The direct v1 (Collab) `spawn_agent` path does **not** re-enable Windows VT input, does **not** emit `EnableFocusChange`, and does **not** create a parent-shared PTY/console path that can mutate `STD_INPUT_HANDLE`. The hypothesis is therefore **refuted at the direct v1 spawn site**.

The only in-tree site that re-adds `ENABLE_VIRTUAL_TERMINAL_INPUT` after the `.4` fix is still the Windows TUI restore path in `tui/src/tui.rs`: `restore_common()` calls `restore_saved_virtual_terminal_input_bit()`, and that helper re-applies the saved startup bit to the live `STD_INPUT_HANDLE` if it was originally enabled. The `.4` protection is therefore **not a session-long invariant**; it is only re-asserted when `set_modes()` runs again. Source evidence below.

Because `.4` still reproduces in the field, this should ship as a **.5** fix.

## What `.4` actually fixed

The shipped `.4` fix clears inherited `ENABLE_VIRTUAL_TERMINAL_INPUT` once, before `enable_raw_mode()`:

- `set_modes()` calls `enter_codex_tui_input_mode()` before `enable_raw_mode()` and before `EnableFocusChange` is emitted (`codex-rs/tui/src/tui.rs:248-265`).
- On Windows, `enter_codex_tui_input_mode()` reads the current `STD_INPUT_HANDLE` mode, saves whether the VT-input bit was originally present, then clears only that bit (`codex-rs/tui/src/tui.rs:1213-1248`, `1268-1278`).

That matches the intended root-cause fix for the original bug: keep crossterm on the classic console-record path so focus reports do not arrive as raw `[I` / `[O` text tails.

## The remaining re-enable seam

The only in-tree code that puts the bit back is the restore path:

- `restore_common()` always calls `restore_saved_virtual_terminal_input_bit()` (`codex-rs/tui/src/tui.rs:323-345`).
- `restore_saved_virtual_terminal_input_bit()` reads the live console mode and re-adds `ENABLE_VIRTUAL_TERMINAL_INPUT` whenever the startup-saved state was `Enabled` (`codex-rs/tui/src/tui.rs:1282-1288`).
- Focus reporting itself is only toggled in the same TUI file: enabled by `execute!(stdout(), EnableFocusChange)` in `set_modes()` and disabled by `DisableFocusChange` in `restore_common()` (`codex-rs/tui/src/tui.rs:265`, `334-337`).

So the direct "re-enable site" in current source is:

- `codex-rs/tui/src/tui.rs:343`
- `codex-rs/tui/src/tui.rs:1282-1288`

That is the only place in the tree that restores the Windows VT-input bit after `.4`.

## Does v1 spawn hit that seam?

I could not source-prove that it does.

The direct v1 spawn path is pure in-process thread/session creation:

- tool handler: `core/src/tools/handlers/multi_agents/spawn.rs:45-140`
- control layer: `core/src/agent/control.rs:213-341`
- thread creation: `core/src/thread_manager.rs:1057-1289`

That path reserves a slot, builds a child session source, spawns a new Codex thread, sends the initial input, and starts a completion watcher. It does **not** touch crossterm, TUI mode setup, console mode APIs, PTY creation, or shell/stdin inheritance.

I also checked the process-exec surfaces that a spawned agent can later use:

- shell tool exec uses `stdio_policy: StdioPolicy::RedirectForShellTool` (`core/src/exec.rs:945-956`), and that path sets `stdin` to `null` rather than inheriting the parent console (`core/src/spawn.rs:107-123`).
- interactive exec sessions use Codex PTY/pipe helpers rather than the parent console (`core/src/unified_exec/process_manager.rs:975-999`).
- on Windows the PTY backend is ConPTY / pseudoconsole-backed (`utils/pty/src/pty.rs:137-161`, `utils/pty/src/win/psuedocon.rs:175-207`), not `STD_INPUT_HANDLE` sharing.

So the direct v1 spawn path and the normal child-process surfaces do **not** show a source-level way to re-toggle the parent TUI console mode.

## Windows-only or cross-platform?

This bug remains **Windows-specific**.

The VT-input machinery only exists under `#[cfg(windows)]`:

- `ENABLE_VIRTUAL_TERMINAL_INPUT_BIT` and the saved-state storage are Windows-only (`codex-rs/tui/src/tui.rs:1171-1178`).
- the non-Windows `enter_codex_tui_input_mode()` and `restore_saved_virtual_terminal_input_bit()` are explicit no-ops (`codex-rs/tui/src/tui.rs:1293-1300`).

That means Linux/macOS do not share the failing "console-record parser vs inherited VT-input bit" condition from the original issue.

## Correlation with "v1 agent thread limit not released on completion"

These two bugs appear **independent**.

The thread-limit bug is real, but it lives in agent lifecycle bookkeeping:

- spawn slot is reserved at `core/src/agent/control.rs:221` and `core/src/agent/registry.rs:80-97`
- the v1 completion watcher only waits for a final status and injects a notification back to the parent; it does **not** close the child or release the slot (`core/src/agent/control.rs:995-1067`)
- slot release only happens on explicit shutdown/close or the internal-agent-died path (`core/src/agent/control.rs:758-760`, `767-784`, `789-799`)

So the "finished agent remains OPEN until `close_agent` / shutdown" sibling finding is confirmed by source, but it does not share any console-mode or PTY mutation seam with the focus leak. The common factor is only that both are v1-agent-adjacent.

## Best current explanation

Source inspection supports this narrower conclusion:

1. `.4` fixed the startup case.
2. The TUI still contains a latent reopen seam because mid-session restore logic can re-add the saved VT-input bit.
3. The direct v1 spawn path does not itself touch that seam.

Today the only obvious mid-session TUI restore caller is external-editor launch:

- `App::launch_external_editor()` wraps the editor in `tui.with_restored(RestoreMode::KeepRaw, ...)` (`codex-rs/tui/src/app/input.rs:12-40`)
- `Tui::with_restored()` performs the restore, runs the external program, then re-applies `set_modes()` (`codex-rs/tui/src/tui.rs:685-727`)

So if the field repro is "plain v1 spawn, then leak returns" with no external-editor or suspend/resume involvement, I did **not** find a direct source seam inside the v1 spawn path that explains it. That would need runtime tracing to catch an out-of-band `SetConsoleMode` caller or a failing / skipped `set_modes()` re-assertion.

## Recommended codex-side fix

Keep the fix inside `codex-rs/tui/src/tui.rs` and do **not** fork crossterm.

Recommended change:

1. Treat "VT-input cleared while the TUI is alive" as a TUI-lifetime invariant.
2. Do **not** re-add `ENABLE_VIRTUAL_TERMINAL_INPUT` in mid-session restores (`restore()` / `restore_keep_raw()` / `with_restored()` paths).
3. Restore the original saved bit only in the final exit path (`restore_after_exit()` / process teardown), where returning the parent shell to its pre-Codex state actually matters.

Why this seam:

- It directly removes the only known in-tree re-enable site.
- It stays codex-side and local to the existing `.4` patch surface.
- It does not require a crossterm fork.
- It also hardens against any future agent-adjacent or tool-adjacent restore cycles, even if the exact v1-only repro trigger turns out to be indirect.

## Release recommendation

Yes: this needs a **.5** release.

`.4` fixed the startup leak but did not make the VT-input normalization durable across the full TUI lifetime. Given a second-PC repro on `0.135.0-copilot-api.4`, this is not just a theoretical cleanup.
