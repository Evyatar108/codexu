# Stories Outline: Codex non-blocking background-task completion surfacing

*Preliminary decomposition from `/plan-with-ralph`. Feed to `/implement-with-ralph --from-plan` for PRD generation.*

> **Dual-repo plan.** US-001 targets the **codex submodule**
> (`codex/external/repos/codex-patched/codex-rs`); US-002..US-006 target **happy-cli**
> (`packages/happy-cli`). `/implement-with-ralph` generates one PRD per repo — drive the codex story
> and the happy-cli stories as **separate impl jobs**, not a single cross-repo `--parallel` run.
> Codex edits = two commits (codex-side first, then the codexu pointer bump).

## US-001: Codex feature-gated turn-end re-check seam
**Description:** As a codex agent driven through happy-cli, I want a background process that exits
*while a later turn is active* to still wake a follow-up turn after that turn finishes, so async
completion is not silently delayed by the active-turn race.
**Repo:** codex submodule (`core/src/tasks/mod.rs`, `core/src/unified_exec/process_manager_tests.rs`, `codex/docs/implementation/patch-surface.md`)
**Acceptance Criteria:**
- [ ] Exactly one `maybe_start_turn_for_pending_work()` call added in `on_task_finished`, guarded by
      `self.enabled(Feature::BackgroundProcessNotification)`, inserted AFTER `active_turn` is cleared
      (~:888-899) and after the `MaybeContinueIfIdle` apply path (~:900-908) — NOT after the
      pending-input drain (~:736).
- [ ] `// SANDBOX PATCH:` marker on the seam + a corresponding row in
      `codex/docs/implementation/patch-surface.md`.
- [ ] New regression test (sibling to `background_process_notification_wakes_idle_session`): a process
      that exits WHILE a later turn is active wakes a follow-up turn after that turn finishes; the test
      FAILS if the wake is attempted before `active_turn` is cleared (placement guard).
- [ ] No infinite wake loop (helper returns on empty queues; `start_task` drains queued items).
- [ ] `cargo check --workspace` green; `cargo test -p codex-core` / `just test -p codex-core` passes the new test.
**Dependencies:** None
**Estimated complexity:** medium

## US-002: Spawn-then-end-turn model policy via happy-cli developerInstructions
**Description:** As a codex agent, I want guidance to start fire-and-forget work with a short yield and
then end my turn without blocking on completion, so the watcher's dedup CAS fires and completion
surfaces async — injected from happy-cli to keep codex's upstream surface minimal.
**Repo:** happy-cli (`src/codex/runCodex.ts` developerInstructions path; new default-off setting module)
**Acceptance Criteria:**
- [ ] When the new default-off async-completion setting is ON, happy-cli appends a spawn-then-end-turn
      `developerInstruction` via the existing `startThread`/`developerInstructions` path (~`runCodex.ts:1105`).
- [ ] The instruction tells the model: start fire-and-forget work with a short `yield_time_ms`, then END
      the turn; do NOT call a blocking `await_background_completion` and do NOT issue ANY follow-up
      `write_stdin` for that session before completion; if output is needed, retrieve it AFTER being
      woken by the completion notification (post-exit retrieval no longer double-notifies).
- [ ] No codex `shell_spec.rs` tool-description edit is made (documented LAST RESORT only).
- [ ] When the setting is OFF, no async-completion `developerInstruction` is appended.
- [ ] Typecheck passes (`tsc --noEmit`); a vitest case asserts the instruction is present iff the setting is on.
**Dependencies:** None
**Estimated complexity:** small

## US-003: Happy-cli enablement (dual feature flags, both spawn paths) + unsolicited-active-turn tracking
**Description:** As an operator, I want to opt into async completion with a single happy-cli setting that
correctly enables the codex feature (including its UnifiedExec prerequisite) and does not hang when I
message during an unsolicited completion turn.
**Repo:** happy-cli (`src/codex/codexAppServerClient.ts`, `src/codex/runCodex.ts`, setting module)
**Acceptance Criteria:**
- [ ] When the setting is ON, the spawned app-server argv includes BOTH
      `-c features.unified_exec=true` and `-c features.background_process_notification=true`, in BOTH the
      stdio and ws spawn paths.
- [ ] When the setting is OFF, neither flag is added (both paths) — default-off, mirroring `mcpNotificationRouting.enabled`.
- [ ] Unsolicited-active-turn tracking: before `sendTurnAndWait`, if `_turnId` is active with no
      `pendingTurnCompletion`, happy-cli either waits for the unsolicited turn to complete before
      dispatching the queued user message, or steers and waits on the active turn id — so an operator
      message during an unsolicited completion turn cannot leave a `sendTurnAndWait` promise unresolved.
- [ ] `CodexAppServerClient` renders a codex-INITIATED turn it did not submit (no stale promise resolution).
- [ ] Typecheck passes; vitest cases cover: off→no flags (both paths), on→both flags (both paths),
      unsolicited turn does NOT resolve a stale `pendingTurnCompletion`.
**Dependencies:** US-002 (shares the setting module)
**Estimated complexity:** medium

## US-004: `happy codex doctor` async-completion readiness probe
**Description:** As an operator, I want `happy codex doctor`/status to tell me whether async completion
will actually fire and, if not, why — because two default-off flags + a policy is an adoption hazard.
**Repo:** happy-cli (`src/codex/codexDaemonDoctor.ts`, `src/commands/codexCommand.ts`)
**Acceptance Criteria:**
- [ ] Doctor reports: the happy async-completion setting state; whether the spawned app-server argv
      includes both feature flags; whether UnifiedExec/ConPTY is actually active (so `exec_command` is
      model-visible — fail loudly if not); whether the async-completion `developerInstruction` is present.
- [ ] Doctor prints a human-readable reason when async completion will NOT fire (e.g. UnifiedExec
      unavailable, setting off, flag missing).
- [ ] Typecheck passes; a vitest case covers the readiness reporting (ready vs each not-ready reason).
**Dependencies:** US-002, US-003
**Estimated complexity:** small

## US-005: Live end-to-end validation + structured decision artifact
**Description:** As the team, we need a real happy-cli codex session to prove LOW-A surfaces the
completion as a new turn, and to decide whether the LOW-B fallback is required — recorded as a
machine-readable artifact, not a hand-wave.
**Repo:** validation (runs against a codex build with US-001 + a happy-cli build with US-002..US-004)
**Acceptance Criteria:**
- [ ] Live session with both feature flags on: agent spawns a long `exec_command` with a short yield,
      ends the turn, does NOT call `await_background_completion`; confirm (a) the turn ends before
      process exit, (b) an operator message is processed mid-run, (c) completion surfaces as a NEW turn
      with no manual prompt injection, (d) an operator message sent WHILE the unsolicited completion turn
      is active does not hang.
- [ ] A setup step ensures the spawned `codex app-server` is the modified fork build (install/link the
      built fork, or prepend the build output to PATH) — the validation must run against the seam.
- [ ] Emits `.ralph/jobs/codex-nonblocking-bg-completion-surfacing/low-a-validation.json` with fields:
      `unsolicitedTurnRendered` (bool), `stalePromiseObserved` (bool),
      `operatorDuringUnsolicitedTurn` ("pass"|"fail"), `transcriptRetrievalUsable` (bool),
      `decision` ("low-a-pass"|"low-b-required").
**Dependencies:** US-001, US-002, US-003, US-004
**Estimated complexity:** medium

## US-006: LOW-B fallback — unified-exec completion consumer (CONDITIONAL)
**Description:** As a fallback, if LOW-A does not surface the completion cleanly, happy-cli watches the
background process exit itself and pushes a synthesized prompt into `MessageQueue2` via a separate
route — implemented ONLY if US-005 decides `low-b-required`.
**Repo:** happy-cli (`src/codex/codexAppServerClient.ts` mapping, new consumer module, `MessageQueue2` route)
**Acceptance Criteria:**
- [ ] Step 1 (mandatory first): preserve `process_id`/`source` through the happy-cli `exec_command_end`
      mapping (`codexAppServerClient.ts:583`) so foreground vs background/subscribed completion can be
      discriminated (codex protocol carries them at `protocol.rs:3067`).
- [ ] A unified-exec completion consumer (analogous to `mcpNotificationConsumer`) pushes a synthesized
      prompt into `MessageQueue2` via a SEPARATE background-process route (NOT overloading
      `mcpNotificationRouting` kinds).
- [ ] A foreground `exec_command_end` does NOT loop back into the model as a fresh prompt (verified via
      the discriminator).
- [ ] Single-producer invariant: codex auto-wake is disabled for this path so completion is produced by
      exactly one source (no double prompt).
- [ ] Typecheck passes; vitest cases cover the discriminator and the no-foreground-loopback negative case.
- [ ] Only implemented if `low-a-validation.json.decision == "low-b-required"`; otherwise recorded
      skipped-with-evidence (or split into a separate follow-up PRD).
**Dependencies:** US-005
**Estimated complexity:** large
