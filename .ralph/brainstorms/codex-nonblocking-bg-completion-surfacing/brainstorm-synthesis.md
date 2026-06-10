Lenses: ran=[codex, copilot, devils-advocate]; skipped=[] (all three lenses produced usable output)

# Brainstorm synthesis — codex non-blocking background-task completion surfacing

**Task:** `codex-nonblocking-bg-completion-surfacing`
**Goal:** Give the codex CLI agent Claude-Code-parity non-blocking background-task UX — the
agent spawns a long-running process, ENDS its turn (operator keeps interacting), and the
process COMPLETION surfaces ASYNC as a later queued prompt/turn — WITHOUT core-turn-loop
surgery. Operator standing constraint: minimize codex-fork upstream conflict surface.

All three lenses independently recommend the **LOW**-conflict tier and warn that the hard
part is not the spawn/await primitive (the fork already has it) but (1) keeping the agent
off the blocking-await path that shares a dedup flag with the async watcher, and (2) a
turn-boundary race in the wake path. The synthesis below folds the orchestrator's own
source verification (file:line cited) into the three lens outputs.

## Source-verified facts (codex/external/repos/codex-patched/codex-rs)

- **The async primitive already exists, default-off.** `spawn_exit_watcher`
  (`core/src/unified_exec/async_watcher.rs:117-183`) waits for PTY exit + output drain,
  emits the exec-end event, then — IF `session.enabled(Feature::BackgroundProcessNotification)`
  AND it wins `notified.compare_exchange(false,true)` — builds a `<task_notification>` user
  message (`async_watcher.rs:185-199`), calls
  `input_queue.queue_response_items_for_next_turn(...)` and
  `maybe_start_turn_for_pending_work()` (`async_watcher.rs:171-179`).
  The feature is `Stage::UnderDevelopment`, `default_enabled: false`
  (`features/src/lib.rs:91-92, 741-746`).
- **The async turn is started INSIDE codex-core, below the app-server protocol layer.**
  `maybe_start_turn_for_pending_work_with_sub_id` (`tasks/mod.rs:567-593`) starts a real
  `RegularTask` when the session is idle and items are queued. So the completion re-enters
  the model and emits ordinary turn events that the app-server forwards — happy-cli sees a
  normal turn. **This means the LOW path likely needs NO happy-cli prompt-injection** (it
  reframes the task's point (d); see "Key design fork" below).
- **The blocking await and the watcher are mutually exclusive via a shared `notified` flag.**
  `await_background_completion` (`core/src/tools/handlers/unified_exec/await_background_completion.rs:71-108`)
  awaits `unified_exec_manager.await_background_completion(...)`, which claims the flag on
  observed exit (`process_manager.rs:780`). The flag is shared with the watcher
  (`process_manager.rs:935-972` `store_process` → `spawn_exit_watcher`). Whoever observes
  exit first wins; if the model parked in the await, the watcher's CAS fails → no async
  notification.
- **There is a SECOND suppression site.** `process_manager.rs:678` also does
  `notified.compare_exchange(false,true)` (the `write_stdin`/poll-when-`has_exited` path the
  devil's-advocate flagged). So an impatient empty poll on a finished session can ALSO
  suppress the watcher. A timed-out `await` (process still running, `observed_exit==false`)
  does NOT claim the flag (the CAS at `:780` is guarded by `if observed_exit`), so it leaves
  the watcher free to fire later — but relying on that is fragile.
- **happy-cli runs codex via `codex app-server` (JSON-RPC over ws/stdio)** and already has an
  MCP-notification→prompt-queue bridge (`mcpNotificationConsumer.ts:96-111`,
  `mcpNotificationRouting.ts`, default-off) — but it is wired for MCP notifications, NOT
  unified-exec process exits.

## The active-turn wake RACE (source-confirmed; the strongest disconfirming finding)

The watcher's `maybe_start_turn_for_pending_work` early-returns if `active_turn.is_some()`
(`tasks/mod.rs:581-585`). The normal turn-completion path `on_task_finished`
(`tasks/mod.rs:683-736`) drains only **turn-scoped** pending input
(`take_pending_input_for_turn_state`) and does NOT re-check the **session-scoped**
`idle_pending_input` where the watcher queued the `<task_notification>`, and does NOT
re-call `maybe_start_turn_for_pending_work`. The production wake callers are the watcher
itself (`async_watcher.rs:179`), the abort/interrupt paths (`tasks/mod.rs:630,677`), and
goals (`goals.rs:1271`); `codex_thread.rs:417` is `#[cfg(test)]`.

Consequence:
- **Happy path (process exits while the session is idle): WORKS** — proven by the existing
  test `background_process_notification_wakes_idle_session` (`process_manager_tests.rs:583`).
  This is the dominant case for genuinely long-running work.
- **Edge case (process exits DURING a later active turn): notification is delayed**, sitting
  in `idle_pending_input` until some other wake trigger drains it. Not necessarily dropped,
  but a silent parity gap.

The fix is small and LOW-conflict: a **feature-gated turn-end re-check** — one
`maybe_start_turn_for_pending_work()` call at the end of `on_task_finished` (guarded by
`Feature::BackgroundProcessNotification`) + a regression test for the
exit-during-active-turn → turn-finish → auto-wake boundary. This is a ~1-line inline seam
in upstream-canonical code (needs a `// SANDBOX PATCH:` marker + a §14/§15 patch-surface
row), so LOW is "small seam + test", not a pure flag-flip.

## Key design fork inside the LOW path (settled by live validation, not by reasoning)

- **LOW-A (codex self-wake; primary hypothesis):** the watcher's auto-started turn surfaces
  through the app-server to happy-cli as an ordinary turn. happy-cli changes are limited to
  (a) passing `-c features.background_process_notification=true` when it spawns the codex
  app-server, gated behind a default-off happy-cli setting; (b) a `happy codex doctor`/status
  probe that reports whether async completion will fire; (c) verifying its
  `CodexAppServerClient` renders a codex-INITIATED turn it did not submit. NO MCP-style
  prompt-queue consumer needed. Smallest surface.
- **LOW-B (happy-cli event bridge; documented fallback):** ONLY if live validation shows the
  auto-turn does NOT surface cleanly through app-server (e.g. happy-cli's
  `sendTurnAndWait`/turn-correlation chokes on an unsolicited turn). Then add a unified-exec
  completion consumer analogous to `mcpNotificationConsumer` that watches the background
  exec-end (background/subscribed-discriminated) and pushes a synthesized prompt into
  `MessageQueue2` — using a SEPARATE background-process route (do NOT overload
  `mcpNotificationRouting` kinds; foreground `exec_command_end` must NOT loop back as a
  prompt). This is the task's point (d), correctly scoped as a fallback.

## Candidate directions

### D-001: LOW — enable the existing watcher + spawn-then-end-turn policy + race-proof the turn-end wake (RECOMMENDED)
- Contributing lenses: [codex, copilot, devils-advocate]
- Why this might work: the want-(b) primitive already exists in the fork and the auto-turn is
  started inside codex-core, so the dominant "exit-while-idle" case works today with the flag
  on (test-proven). Stays in fork-owned unified-exec/watcher surfaces + happy-cli TS + one
  tiny seam. Lowest upstream-rebase cost; matches the operator constraint.
- Codex work: (1) race-proof seam in `on_task_finished` (feature-gated re-check + regression
  test); (2) model policy — teach spawn-then-end-turn and discourage the blocking await for
  fire-and-forget (tool-description tweak in `shell_spec.rs` and/or system-prompt/instruction
  injection); enablement is config (`features.background_process_notification=true`), no new
  codex source needed to turn on.
- Happy-cli work: LOW-A spawn-arg + default-off setting + doctor probe (+ LOW-B fallback
  consumer only if validation requires).
- Risks / friction: model discipline is policy-dependent — TWO accidental dedup-claim sites
  (`await_background_completion` @ `:780`, `write_stdin` poll @ `:678`) can suppress the
  watcher; two default-off flags + a policy = adoption/trust hazard; completion payload is
  only `process_id`+`exit_code`, so the agent may need a post-exit transcript-retrieval path.
- Cheapest validation: in dev worktrees, enable the flag, run one long `exec_command` with a
  short yield, end the turn without awaiting, and verify the turn ends before exit, an
  operator message is processed mid-run, and completion arrives as a NEW happy-cli turn with
  no manual prompt injection.
- Disconfirming observation: with the flag on, a live happy-cli session that spawns with a
  short yield and never awaits does NOT receive a later synthetic turn after exit — despite
  `background_process_notification_wakes_idle_session` proving the core wake path — which
  would point to either the active-turn race or an app-server→happy-cli surfacing gap.

### D-002: MEDIUM — explicit non-blocking contract (do_not_await / subscribe_background_completion) + nonblocking result retrieval
- Contributing lenses: [codex, copilot, devils-advocate]
- Why this might work: replaces fragile model etiquette with a per-process "subscribed" state
  invariant — a spawn-time `do_not_await`/`notify_on_completion` param or a
  `subscribe_background_completion(session_id)` tool, plus a `get_background_result_if_ready`
  retrieval tool that is nonblocking after notification, while pre-exit blocking either errors
  or requires an explicit override. The subscribed bit (separate from `notified`) guarantees
  the watcher is never suppressed.
- Risks / friction: new model-visible API + tool schema/registration churn
  (`shell_spec.rs`, `spec_plan.rs:542-552`, unified_exec handlers + `mod.rs`); higher
  upstream-rebase conflict surface; only justified if D-001's instruction-only discipline
  proves unreliable in live validation.
- Cheapest validation: prototype the smallest explicit affordance and run a controlled prompt
  set; if compliance is no better than the LOW policy path, the extra surface is unjustified.
- Disconfirming observation: if short-yield + instruction-only reliably keeps the model off
  the blocking await in dogfood, the new schema buys little relative to its rebase cost.

### D-003: HIGH — core session/turn-loop interleaving (operator messages preempt an active await)
- Contributing lenses: [codex, copilot]
- Why this might work: best matches the literal "keep chatting while the tool runs" mental
  model.
- Risks / friction: changes active-turn semantics, tool-execution lifecycle, cancellation,
  transcript ordering, and app-server multi-turn tracking in happy-cli
  (`turn.rs`, `tasks/mod.rs`, `input_queue.rs`, the await handler, `protocol.rs`,
  `codexAppServerClient.ts`). Highest upstream-rebase risk; directly violates the standing
  constraint.
- Cheapest validation: do NOT implement first — a read-only design spike enumerating every
  session/turn-loop invariant that would change vs the LOW path's missing capabilities.
- Disconfirming observation: if spawn → end-turn → async-completion-prompt delivers the
  requested UX (it does, per source), mid-tool interleaving is unnecessary and should be ruled
  out.

## Open questions carried into planning
1. Authoritative producer for the completion turn: codex `input_queue` (LOW-A) vs happy-cli
   `MessageQueue2` (LOW-B) — pick ONE for unified-exec exits; never both (double-prompt).
2. Should the `<task_notification>` carry enough transcript summary to act, or only wake the
   model and require a separate nonblocking result-retrieval tool? (payload is currently
   `process_id`+`exit_code` only.)
3. Model-discipline strength: instruction-only (LOW) vs hide/guard `await_background_completion`
   and the `write_stdin` poll for subscribed sessions (MEDIUM)?
4. Ordering when an operator message and a completion land in the same window
   (notification-first / operator-first / coalesced / separate turn)?
5. Two default-off flags + policy is an adoption hazard — ship a `happy codex doctor`/status
   probe that explains why async completion will or will not fire.
