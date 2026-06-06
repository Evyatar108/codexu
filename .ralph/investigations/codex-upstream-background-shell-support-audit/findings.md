# Codex background / async shell-task support — status audit

**Task:** `codex-upstream-background-shell-support-audit`
**Date:** 2026-06-06
**Mode:** read-only investigation (no source modified)
**Submodule state:** `codex/external/repos/codex-patched` on branch `sandbox-patches` @ `5817fa310` (ahead of the `rust-v0.130.0` merge; carries the v0.135.0 rebase-resume + stream-cut-diagnostics work).

---

## Verdict

**Mixed — and nothing is currently missing.** There are two distinct layers:

1. **Core background/async exec primitive — NATIVE upstream.** The `exec_command` + `write_stdin`
   unified-exec tools (a long command yields a `session_id` after `yield_time_ms` and keeps running
   in the background; the model polls it with `write_stdin` empty-`chars`) are **upstream-native**,
   carry **no** `SANDBOX PATCH` markers, and exist verbatim in `openai/codex` at identical paths.

2. **Block-wait + completion-notification convenience layer — FORK PATCH (present & wired).** The
   fork's earlier background-shell work is the `await_background_completion` tool (**D-002**, lets the
   model block on a background process instead of busy-polling) plus the D-001 turn-boundary
   `<task_notification>` path (wakes an idle model when a background process exits). This layer is
   **fork-only**, marked with `// SANDBOX PATCH: D-002`, and is **currently fully present and
   registered**.

So: codex did **not** lose background-shell support, and the fork patch is **not** redundant —
upstream still has no `await_background_completion`. **No action needed** beyond continuing to guard
the D-001/D-002 patch on future rebases.

### On "was it accidentally removed?" — a real near-miss, already repaired

Yes, it was nearly lost. The **v0.135.0 upstream squash** (`03fe64287`) imported upstream's
`ToolExecutor<ToolInvocation>` + `CoreToolRuntime` trait split and the `planned_tools.add(X)`
registration refactor, but **dropped/left-stranded** the two fork SANDBOX handlers
(`await_background_completion`, `spawn_top_level_session`) on the old `ToolHandler+ToolKind` trait
shape. The **rebase-resume** commit (`13558dfb9` "rebase-resume: migrate fork SANDBOX handlers to new
ToolExecutor+CoreToolRuntime trait shape") **re-ported** it. As of the current `sandbox-patches` HEAD
it is back, wired, and test-guarded. This is documented in `patch-surface.md` §15
("Rebase-resume v0.135.0 — spec_plan + multi_agents replant", item 5).

---

## Exact tool surface offered to the model

Registered in `core/src/tools/handlers/` and gated in `core/src/tools/spec_plan.rs::add_shell_tools`
(reached from `build_model_visible_specs_and_registry` → line 504). Shell-tool selection branches on
`shell_type_for_model_and_features(...)`:

| `ConfigShellToolType` | Tools registered (model-visible) | Notes |
|---|---|---|
| `UnifiedExec` | `exec_command`, `write_stdin`, **`await_background_completion`**, + `shell` (dispatch-only) | `spec_plan.rs:543-556`. The fork's D-002 tool is added at **line 552**; `shell` stays registered as `add_dispatch_only` (not model-visible) for back-compat. |
| `Default` / `Local` / `ShellCommand` | `shell` only | `spec_plan.rs:559-562` — legacy single shell handler. |
| `Disabled` | none | |

For the Copilot fork specifically, UnifiedExec is force-selected via the launcher provider flag
`features.unified_exec=true` (per `codex/CLAUDE.md` "Copilot UnifiedExec selection is launcher-flagged").
So in normal fork operation the model is offered **all four**: `exec_command`, `write_stdin`,
`await_background_completion`, and the dispatch-only `shell`.

Tool semantics:

- **`exec_command`** (`unified_exec/exec_command.rs`, spec `shell_spec.rs:19`) — runs a command in a
  PTY; returns output, or a `session_id` if it is still running after `yield_time_ms`. This *is* the
  background-process launch path. Native upstream.
- **`write_stdin`** (`unified_exec/write_stdin.rs`, spec `shell_spec.rs:103`) — writes bytes to a live
  session; **empty `chars` = background poll**. Native upstream. Its own description text points the
  model at `await_background_completion` to wait for completion (`shell_spec.rs:133`).
- **`await_background_completion`** (`unified_exec/await_background_completion.rs`, spec
  `shell_spec.rs:146`) — blocks until a background `session_id` exits (optional `timeout_ms`) and
  returns aggregated output from `ProcessEntry.transcript`. **Fork-only (D-002).**

---

## Evidence

### Fork-patch markers (D-002 — fork-only, all currently present)

| Location | Marker / fact |
|---|---|
| `core/src/tools/handlers/unified_exec/await_background_completion.rs:30` | `// SANDBOX PATCH: D-002 — fork-only handler.` + replant note ("rebase-resume v0.135.0"). |
| `core/src/tools/handlers/mod.rs:76-77` | `// SANDBOX PATCH: D-002 — fork-only handler retained while upstream removed it.` then `pub use unified_exec::AwaitBackgroundCompletionHandler;` |
| `core/src/tools/spec_plan.rs:550-552` | `// SANDBOX PATCH: D-002 — register await_background_completion handler. Re-ported during rebase-debt-fix v0.135.0 from the dropped orphan block.` then `planned_tools.add(AwaitBackgroundCompletionHandler);` |

### No fork marker on the native primitives

`exec_command.rs` and `write_stdin.rs` contain **no** `SANDBOX PATCH` markers (ripgrep over
`core/src/tools/` confirmed). They are upstream-canonical.

### Upstream cross-check (no pristine local checkout exists — only `codex-patched`)

There is **no** separate pristine upstream tree under `codex/external/repos` (only `codex-patched`),
so a local diff was not possible. Confirmed against `openai/codex` via GitHub code search instead:

- `await_background_completion` in `openai/codex` → **0 results** ⇒ fork-only. ✓
- `create_write_stdin_tool` in `openai/codex` → 3 results at the **same paths**
  (`codex-rs/core/src/tools/handlers/shell_spec.rs`, `…/unified_exec/write_stdin.rs`) ⇒ upstream-native. ✓

### D-001 notification path (the other half of the fork's earlier work) — present

- `core/src/unified_exec/async_watcher.rs` (`spawn_exit_watcher` queue+wake), `process_manager.rs`,
  `process.rs` (`output_drained_flag`), `mod.rs` (`BackgroundCompletionEvent`) all present.
- Gated on the opt-in `Feature::BackgroundProcessNotification`.
- Documented in `patch-surface.md` §13 ("Background process completion notifications (D-001 / D-002)").

### Invariant tests guarding the fork patch — present

Overlay crate `codex/codex-rs-overlay/codex-invariant-tests/tests/` (lives *outside* the submodule,
joined as a workspace member) contains:

- `background_completion.rs` (invariant 15 — `await_background_completion` reads `ProcessEntry.transcript`)
- `background_notifications.rs` (invariants 16, 17 — shared dedup atomic; exit-watcher queue+wake)
- `output_drained.rs` (invariant 18 — `notify_waiters()` not `notify_one()`)

Mapped in `patch-surface.md` §14 rows 15-18. Run via `cargo test -p codex-invariant-tests`.

---

## Action needed

**None required.** Specifically:

- **Do not re-add anything** — the fork's background-shell work (D-001 notify + D-002 await tool) is
  fully present and wired on the current `sandbox-patches` HEAD.
- **Do not drop the fork patch as redundant** — upstream still has no `await_background_completion`;
  it remains a genuine fork-only convenience over upstream's native poll-only unified-exec.
- **Forward guidance (rebase hygiene):** this handler is a repeat near-miss casualty of upstream
  squashes that refactor the tool-registration / trait shape (it was stranded once in v0.135.0). On
  every future `/rebase-upstream`, verify the three D-002 markers above survive and
  `cargo test -p codex-invariant-tests` passes (invariants 15-18). The replant recipe is
  `patch-surface.md` §15 item 5.

---

## Files inspected

- `core/src/tools/handlers/unified_exec.rs` (+ `unified_exec/{exec_command,write_stdin,await_background_completion}.rs`)
- `core/src/tools/handlers/shell.rs` (+ `shell/shell_command.rs`), `shell_spec.rs`
- `core/src/tools/handlers/mod.rs`, `core/src/tools/spec_plan.rs`
- `core/src/unified_exec/` (module listing; `async_watcher.rs`)
- `codex/docs/implementation/patch-surface.md` §§13, 14 (rows 15-18), 15
- Upstream `openai/codex` (GitHub code search)
