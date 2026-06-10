# Research Brief — codex non-blocking background-completion surfacing

Seeded from brainstorm `.ralph/brainstorms/codex-nonblocking-bg-completion-surfacing/selected-direction.md` (D-001, LOW).
Cross-repo: codex submodule (`codex/external/repos/codex-patched/codex-rs`) + `packages/happy-cli`.

## Researcher Findings (explore agent)

### CODEX (`codex/external/repos/codex-patched/codex-rs`)

**Exit watcher / async completion surfacing**
- `core/src/unified_exec/async_watcher.rs:117-180` — `spawn_exit_watcher(...)`:
  `if session_ref.enabled(Feature::BackgroundProcessNotification) && notified.compare_exchange(false,true,...)`
  → builds payload via `background_completion_message(BackgroundCompletionEvent { process_id, exit_code })`
  → `queue_response_items_for_next_turn(...)` + `maybe_start_turn_for_pending_work().await`.
- Payload is ONLY `process_id` + `exit_code` (`async_watcher.rs:185-190`), text "Background shell command completed (exit code {exit_code})".

**Turn wakeup path** (`core/src/tasks/mod.rs`)
- `:557-593` — `maybe_start_turn_for_pending_work()` delegates to `_with_sub_id(...)`: early-returns if no queued next-turn items / trigger mailbox items; locks `active_turn`, returns early if `active_turn.is_some()`; else creates `RegularTask::new()` via `start_task(...)`.
- `:683-736` — `on_task_finished(...)` drains ONLY turn-scoped pending input (`take_pending_input_for_turn_state(turn_state.as_ref()).await`); NO re-check of session-scoped `idle_pending_input`, NO re-call of `maybe_start_turn_for_pending_work()`. **This is the race seam to fix.**

**`notified` dedup flag sites** (`core/src/unified_exec/process_manager.rs`)
- `:677-679` — write_stdin/poll path: `if process.has_exited() { notified.compare_exchange(false,true,...) }`.
- `:779-780` — `await_background_completion`: `notified.compare_exchange(false,true,...)`.
- `:723-724` and `:808-809` — `entry.notified.store(true, Release)` on exit paths.
- `:935-972` — `store_process(...)` creates `Arc<AtomicBool>::new(false)` and passes it into `spawn_exit_watcher(...)`.

**await handler**: `core/src/tools/handlers/unified_exec/await_background_completion.rs:30-35,71-107` — `AwaitBackgroundCompletionHandler` parses session_id/timeout_ms/max_output_tokens, calls `unified_exec_manager.await_background_completion(...)`.

**Feature gate + config key** (`features/src/lib.rs`)
- `:90-92` enum `BackgroundProcessNotification`; `:741-745` spec `key:"background_process_notification"`, `stage:Stage::UnderDevelopment`, `default_enabled:false`.
- `:408-480` applies `[features]` TOML booleans; `:575-583` `feature_for_key("background_process_notification") -> Some(...)`.
- **Enable flag: `-c features.background_process_notification=true`** (config-only; no codex source change to turn on).

**Tool descriptions (candidate policy edit points)** (`core/src/tools/handlers/shell_spec.rs`)
- `:81-100` exec_command: "Runs a command in a PTY, returning output or a session ID for ongoing interaction."
- `:131-143` write_stdin: "...Use await_background_completion to wait until a background process is done."
- `:169-181` await_background_completion: "Waits for a background unified exec session to finish and returns its aggregated output."

**Tool registration**: `core/src/tools/spec_plan.rs:542-556` (UnifiedExec adds ExecCommand, WriteStdin, AwaitBackgroundCompletion); SANDBOX PATCH marker comment at `:550-552`.

**Yield defaults** (`core/src/unified_exec/mod.rs`): `:64-68` MIN_YIELD_TIME_MS=250, MIN_EMPTY_YIELD_TIME_MS=5000, MAX_YIELD_TIME_MS=30000, DEFAULT_MAX_BACKGROUND_TERMINAL_TIMEOUT_MS=300000. `:146-167` `max_background_wait_ms()`.

**Regression test to mirror**: `core/src/unified_exec/process_manager_tests.rs:583-607` — `background_process_notification_wakes_idle_session` (make session w/ feature, spawn w/ watcher, poll until `active_turn.is_some()`, assert queued next-turn items drained, abort synthetic turn). Helper scaffold `:30-135` `spawn_background_process_inner(... spawn_watcher: bool ...)`.

**SANDBOX PATCH marker + patch-surface doc**
- Doc: `codex/docs/implementation/patch-surface.md` (authoritative; references §14/§15). (`codex-rs/docs/...` does NOT exist.)
- Example marker: `// SANDBOX PATCH: D-002 — fork-only handler.` + `// Replant recipe: docs/implementation/patch-surface.md §15.` (at await_background_completion.rs:30-34).

**codex app-server launch + `-c`**: CLI `-c key=value` overrides via `CliConfigOverrides` (highest precedence); feature flags canonically map to `features.<name>`. Launch shape `codex app-server --listen ...`.

### HAPPY-CLI (`packages/happy-cli`)

- **App-server spawn/args** (`src/codex/codexAppServerClient.ts`): `:1147-1172` default args `['app-server','--listen','stdio://']`; `:1226-1238` ws transport args + appends `extraAppServerArgs`; `:879` child spawn via `crossSpawn`.
- **Turn correlation / unsolicited-turn risk**: `:252-275` tracks `_turnId`; `:1765-1795` pending-turn resolution guards on `turnId`; `:1919-1967` `sendTurnAndWait(...)` stores `ignoredTurnId = this._turnId`, creates `pendingTurnCompletion`, waits; `:2232-2294` notification handling updates `_turnId`, resolves on `task_complete`/`turn_aborted`/`turn/completed`. **Main place needing an unsolicited-turn path.**
- **runCodex event loop**: `src/codex/runCodex.ts:293-313` constructs `mcpNotificationConsumer`; `:766-775` event handler calls `mcpNotificationConsumer.handle(msg)` before UI. (`runCodex.ts:78-105` forwards `extraAppServerArgs` to client ctor — per architect.)
- **mcpNotificationConsumer / routing**: `src/codex/mcpNotificationConsumer.ts:87-118` pushes synthesized prompts into queue; `src/codex/mcpNotificationRouting.ts:11-18,65-72,169-197` — `enabled` defaults FALSE; `loadMcpNotificationRouting(...)` returns `{enabled:false,...}`. **Mirror this default-off pattern for the new bg-process toggle.**
- **MessageQueue2** (LOW-B substrate): `src/utils/MessageQueue2.ts:36-116` class + `push(...)`; `:274-353` `waitForMessagesAndGetAsString(...)`; `:62-65,80-115` push path.
- **Doctor/probe**: NO existing `doctor`/`status`/`probe` command found. CLI entry `bin/happy.mjs:1-35`; command parsing in `src/codex/cliArgs.ts`. (NOTE: architect found `src/codex/codexDaemonDoctor.ts` exists — confirm at impl; probe likely extends that.) Insertion point = main CLI command routing.
- **Build/test/typecheck** (`package.json:60-67`): `typecheck`=`tsc --noEmit`; `build`=`shx rm -rf dist && tsc --noEmit && pkgroll`; `test`=`pnpm run build && vitest run`.

## Architect Analysis (explore agent)

1. **Race-proof seam**: `on_task_finished` is already `async`; inner `active_turn.lock().await` scope ends (~`:699`), drain at `:703-736`. Place the ONE extra `maybe_start_turn_for_pending_work()` AFTER the turn-scoped drain loop and BEFORE return — NOT while holding the active_turn mutex (it re-locks → deadlock risk). Feature gate `self.enabled(Feature::BackgroundProcessNotification)` is cheap there (already used on adjacent paths). Add/extend the `core/src/tasks/mod.rs` row in `patch-surface.md` + a `// SANDBOX PATCH:` marker.
2. **Feature enablement**: config-only, key `features.background_process_notification`.
3. **Policy injection**: prefer **system-prompt/instructions overlay** (lowest conflict); tool-description edits in `shell_spec.rs` are upstream-visible/churn-prone → fallback only. Steer model away from BOTH suppression sites (await @ `:779-783`, write_stdin poll @ `:677-679`).
4. **LOW-A vs LOW-B**: LOW-A preferred (codex starts follow-up turn below app-server). happy-cli LOW-A work = pass the `-c` flag (gated by default-off setting), doctor probe, verify client renders unsolicited turn. **KEY RISK**: `codexAppServerClient.ts` correlates via `pendingTurnCompletion` + turn-id (`:265-271,503-529,632-652` per architect numbering) — an unsolicited turn could resolve the wrong promise / be dropped. Fall back to LOW-B if: unsolicited completion dropped/mis-correlated, `turn/completed` resolves wrong promise, or client can't distinguish self-started turn. LOW-B = separate bg-exec completion consumer → MessageQueue2 via a SEPARATE route (not mcpNotificationRouting); foreground `exec_command_end` must NOT loop back.
5. **Story split**: A (codex seam+test), B (codex policy overlay), C (happy-cli LOW-A), D (happy-cli LOW-B fallback). Order: A+B first; C validated against them; D only if C fails. Submodule edits = two commits; local worktree overlay re-point may be needed for builds (revert before commit).
6. **Open-question recommendations (LOW)**: single producer = codex input_queue (never also happy-cli); minimal payload (process_id+exit_code), add retrieval later if needed; instruction-only (hard-guard = escalation); deterministic ordering policy documented in happy-cli; ship doctor probe for the two-default-off-flags adoption hazard.
7. **Validation**: automated codex regression (sibling exit-during-active-turn test in process_manager_tests.rs); live happy-cli acceptance (spawn long exec + short yield, end turn, operator msg mid-run, completion arrives as NEW turn, no manual injection). Acceptance: turn ends before exit; operator msg processed mid-run; completion async new turn; no blocking await; no duplicate prompt.

## Codex Research
Not run / Failed: attached async shell reclaimed before xhigh exec completed (no output file). Coverage is provided by the brainstorm's prior codex lens + the two explore agents.

## Copilot Research (partial — output truncated at 1465 bytes, but completed cleanly)
Corroborates the above. Adds: `core/src/session/input_queue.rs` owns `idle_pending_input`, `queue_response_items_for_next_turn()`, and `take_queued_response_items_for_next_turn()`. Notes `on_task_finished()` clears active state — copilot read it at lines ~888-899 (DIVERGES from researcher/architect's 683-736); **the impl must confirm the exact line for the seam**, though all three agree on the semantic placement (after turn-scoped drain, before return, feature-gated).

## Consolidated File List

### Codex — files to modify
- `core/src/tasks/mod.rs` — feature-gated `maybe_start_turn_for_pending_work()` re-check in `on_task_finished` (+ SANDBOX PATCH marker).
- `core/src/unified_exec/process_manager_tests.rs` — new regression test (exit-during-active-turn).
- Policy: system-prompt/instructions overlay (location TBD at impl) OR `core/src/tools/handlers/shell_spec.rs` tool descriptions (fallback).
- `codex/docs/implementation/patch-surface.md` — add/extend the on_task_finished row.

### Codex — read-only / reference
- `core/src/unified_exec/async_watcher.rs`, `process_manager.rs`, `mod.rs`; `features/src/lib.rs`; `core/src/tools/handlers/unified_exec/await_background_completion.rs`; `core/src/tools/spec_plan.rs`; `core/src/session/input_queue.rs`.

### Happy-cli — files to modify
- `src/codex/codexAppServerClient.ts` — append `-c features.background_process_notification=true` to app-server args (gated); accept unsolicited codex-initiated turn.
- `src/codex/runCodex.ts` — wire the setting; (LOW-B) feed bg-exec completions.
- new default-off setting (mirror `mcpNotificationRouting.ts`).
- doctor/status probe — extend `codexDaemonDoctor.ts` (confirm) or add CLI command (`cliArgs.ts` / `bin/happy.mjs`).
- (LOW-B only) new unified-exec completion consumer (mirror `mcpNotificationConsumer.ts`) + `MessageQueue2` route.

### Build/test
- Codex: `cargo check --workspace` (Phase-5a gate, from `codex-rs/`); `just test -p codex-core` / `cargo test -p codex-core`.
- Happy-cli: `tsc --noEmit` (typecheck); `vitest run` (test, via `pnpm run build`).
