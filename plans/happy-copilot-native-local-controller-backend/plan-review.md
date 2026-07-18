# Plan review

## Result

Status: **clean after independent review/fix convergence**.

Final reviewers:

- architecture/task-alignment: fresh standard `gpt-5.6-sol`, `xhigh`;
- security/history/pagination/event policy: fresh standard `gpt-5.6-sol`,
  `xhigh`.

Both final sign-off passes returned:

```text
CLEAN: no Medium+ findings
```

Reviewers were explicitly constrained to Option 1 and the narrow default-off
read-only milestone; they did not introduce another control plane or the
excluded ACP telemetry patch.

## Medium+ findings resolved

### Target, transport, and compatibility

- Added the canonical managed-child environment, direct command resolution,
  feature-flag handling, loopback/registry checks, and exact
  registry-version/handshake equality.
- Replaced version-only trust with exact source/version/normalized-command and
  artifact identity. SEA uses tokenless materialization into an access-checked,
  content-addressed package tree; critical JS and native addons are hashed.
- Added a closed child environment, Windows DACL/reparse validation, external
  attach process/artifact verification, and fail-closed OOP-runtime handling.
- Restored the source-required minimal `session.resume` routing bridge with
  `disableResume:true`, no tools/commands/callbacks, and prompt observation off.
- Added required foreground `sessionId` injection to every session-scoped RPC.

### History, delivery, and pagination

- Corrected the plaintext send/live versus decrypt-fetch asymmetry as M0.
- Added oldest-first delivery for batches beyond the existing 50-row outbox
  boundary.
- Split outbound acknowledgements from contiguous receive sequencing; handled
  socket-before-HTTP self echoes and interleaved phone rows by deterministic,
  pre-registered localIds.
- Added durable receive seq and pending-localId recovery. Read-only receipt and
  reply both acknowledge before inbound seq advances.
- Added volatile working versus durable safe Copilot cursors so unresolved
  delta/tool/subagent/terminal state is rebuilt by replay after a crash.
- Replaced timestamp sorting with a partial-order merge that preserves persisted
  append order and ephemeral order, uses parent edges, and treats timestamps as
  advisory only.
- Kept happy-server/app pagination unchanged and added >200-row, tail-80,
  older-range, restart, and race acceptance.

### Event fidelity and security

- Closed all 110 pinned event discriminants into one non-overlapping policy.
- Filtered hidden user-message sources, transformed content, and attachments.
- Added per-tool argument schemas/redaction, unknown-tool omission,
  `assistant.message.toolRequests`/`serverTools` backstops, and secret scans of
  persisted Happy payloads.
- Made subagent CUIDs deterministic and correlated parent
  `args.sessionSubagent` across checkpoint loss.
- Added cross-page terminal fallback deferral, session-level versus turn-level
  error handling, and `session.task_complete.success === false` retry behavior.

### Lifecycle and ownership

- Made controller-local `stop` authoritative for controlled teardown instead of
  depending on a racy native shutdown event.
- Added non-piped stdio, parent-FD closure, child listeners, bounded failure
  cleanup, retained child handle, and post-validation `unref()`.
- Separated same-process owned shutdown from external/re-adopted detach.
- Made Happy phone archive detach-only, never `runtime.shutdown` or OS kill.
- Added M0 cross-provider rollback and M1 flag-off rollback.

### Repository decomposition

- Kept M0/M1 Copilot-runtime-free.
- Added blocking same-repo proposals:
  `happy-copilot-cli-entry-dispatch` and
  `happy-copilot-message-consumption-flavor`.
- Kept later provider selection, rich wire/app fidelity, interactive prompt
  capability, TUI co-steering, and hardening in separate milestones/tasks.

## Final verdict

- Runtime change required for M0/M1: **no**.
- Conditional runtime follow-ups: Windows registry ACL hardening only if the
  controller cannot enforce policy; external prompt capability only if M4
  proves exact-build gating insufficient.
- Exact next implementation phase: Story 0, landed as a separate reviewed M0
  change with Claude/Codex/ACP regressions; then stop until both blocking
  same-repo dependency proposals are declared or their paths are granted.
