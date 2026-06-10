---
overviewTaskId: codex-nonblocking-bg-completion-surfacing
---

## Direction
D-001 — LOW: enable the existing `BackgroundProcessNotification` watcher + a spawn-then-end-turn
policy + race-proof the turn-end wake. The want-(b) primitive already exists in the fork and
the completion turn is started inside codex-core, so the lowest-conflict path is "turn it on,
keep the agent off the blocking await, close the active-turn race with a tiny seam, and surface
the codex-self-started turn through happy-cli."

## Goal
A codex agent (driven through happy-cli's `codex app-server`) can spawn a long-running process
with a short initial yield, END its turn, and have the operator keep interacting; when the
process exits, its completion surfaces ASYNC as a new queued turn in the conversation — with NO
core-turn-loop interleaving and the minimum possible codex-fork upstream-canonical edit surface.
Feature stays default-off behind an explicit opt-in toggle.

## Scope
### In Scope
- codex (submodule): enable `Feature::BackgroundProcessNotification` (config
  `features.background_process_notification=true`); a **feature-gated turn-end pending-work
  re-check** in `on_task_finished` (`core/src/tasks/mod.rs:683-736`) — one
  `maybe_start_turn_for_pending_work()` call guarded by the feature — to close the active-turn
  wake race, plus a regression test for the exit-during-active-turn → turn-finish → auto-wake
  boundary (sibling to `background_process_notification_wakes_idle_session`,
  `process_manager_tests.rs:583`). Mark the seam `// SANDBOX PATCH:` + add a
  `docs/implementation/patch-surface.md` §14/§15 row.
- codex model policy: teach spawn-with-short-yield + end-turn and discourage the blocking
  `await_background_completion` (and the empty `write_stdin` poll) for fire-and-forget work —
  via the `await_background_completion`/`exec_command` tool descriptions (`shell_spec.rs`)
  and/or a system-prompt/instruction injection (prefer the lowest-conflict overlay/instruction
  seam).
- happy-cli (LOW-A, primary): pass `-c features.background_process_notification=true` when
  spawning the codex app-server (in `codexAppServerClient.ts`), gated behind a default-off
  happy-cli setting (mirroring `mcpNotificationRouting.enabled`); add a `happy codex
  doctor`/status probe reporting whether async completion will fire (both flags + policy
  aligned); verify `CodexAppServerClient` renders a codex-INITIATED turn it did not submit.
- happy-cli (LOW-B, fallback — ONLY if live validation shows the auto-turn does not surface):
  a unified-exec completion consumer analogous to `mcpNotificationConsumer` that watches the
  background exec-end (background/subscribed-discriminated) and pushes a synthesized prompt
  into `MessageQueue2` via a SEPARATE background-process route (NOT overloading
  `mcpNotificationRouting` kinds).

### Out of Scope
- Core session/turn-loop interleaving so operator messages preempt an active tool await
  (D-003 / HIGH). Explicitly ruled out.
- A new explicit non-blocking tool/param + result-retrieval tool + per-process mode bit
  (D-002 / MEDIUM) — kept as the documented escalation if D-001's instruction-only discipline
  proves unreliable in live validation; do not build it first.
- Enriching the `<task_notification>` payload beyond `process_id`+`exit_code` is a planning
  open question (see Criteria / Context), not a committed scope item yet.

## Criteria
- With `features.background_process_notification=true` in a LIVE happy-cli codex session: the
  agent spawns a long `exec_command` with a short yield, ends the turn, does NOT call
  `await_background_completion`; observers confirm (a) the turn ends BEFORE process exit, (b) an
  operator message is processed while the process is still running, (c) on exit the completion
  surfaces as a NEW turn in happy-cli WITHOUT any manual prompt injection (validates LOW-A).
- Regression test: a background process that exits WHILE a later turn is active still wakes a
  follow-up turn after that turn finishes (validates the `on_task_finished` re-check seam).
- A foreground `exec_command_end` does NOT loop back into the model as a fresh prompt — only
  background/subscribed sessions wake a turn.
- Two concurrent background exits + an operator message in the same window produce a
  deliberate, documented ordering (not incidental queue order).
- The feature is OFF by default; with it off, codex/happy-cli behavior is byte-for-byte
  unchanged. Codex upstream-canonical edits are limited to the one feature-gated `on_task_finished`
  seam (+ marker + patch-surface row) and, if taken, a tool-description tweak.
- `cargo check --workspace` (the documented Phase-5a gate) is green; the new codex test passes
  via `just test -p codex-core`.

## Context
**Source-verified primitives (codex/external/repos/codex-patched/codex-rs):**
`spawn_exit_watcher` queues a `<task_notification>` and calls `maybe_start_turn_for_pending_work`
when `Feature::BackgroundProcessNotification` is on and it wins the shared `notified` CAS
(`async_watcher.rs:117-199`); the feature is `UnderDevelopment`/default-off
(`features/src/lib.rs:91-92,741-746`); `maybe_start_turn_for_pending_work_with_sub_id` starts a
real `RegularTask` inside codex-core (`tasks/mod.rs:567-593`), BELOW the app-server layer — so
the completion turn surfaces to happy-cli as an ordinary turn (this reframes the task's point
(d): happy-cli prompt-injection is the LOW-B fallback, not the primary mechanism). The blocking
`await_background_completion` (`.../await_background_completion.rs:71-108`) and a `write_stdin`
poll both claim the shared `notified` flag (`process_manager.rs:780` and `:678`), which is what
suppresses the watcher — hence the spawn-then-end-turn policy.

**Disconfirming observation carried forward (the strongest red flag, source-confirmed):** the
watcher's wake early-returns when `active_turn.is_some()` (`tasks/mod.rs:581-585`), and
`on_task_finished` drains only turn-scoped pending input — NOT the session-scoped
`idle_pending_input` — and does not re-check pending work. So the dominant exit-while-idle case
works (test-proven, `process_manager_tests.rs:583`), but a completion landing during a later
active turn is delayed until another wake trigger. The committed fix is the feature-gated
turn-end re-check seam above. The MANDATORY live validation at impl is precisely to confirm
LOW-A surfaces the auto-turn through app-server→happy-cli and that the race seam closes the edge
case; if it does not, fall back to LOW-B.

**Cross-repo:** impl needs worktrees in BOTH `codex` (submodule) and `packages/happy-cli`.
Submodule edits are two commits (codex-side first, then the codexu pointer bump). Keep the codex
edit overlay-first / minimal-seam per the fork's "minimize upstream-canonical conflict surface"
tenet. codexu root CLAUDE.md is gitignored — do NOT git add it.

**Open planning questions:** (1) one producer for the completion turn (codex input_queue vs
happy-cli MessageQueue2) — never both; (2) whether the notification should carry transcript
summary or only wake the model + a separate nonblocking result-retrieval tool; (3) instruction-
only vs hard-guard discipline; (4) operator-message-vs-completion ordering; (5) a `happy codex
doctor`/status probe so users know why async completion will or won't fire (two default-off
flags + a policy is an adoption hazard).
