# crews-undeliverable-report-delivery-gap

## Verdict

The live artifact does **not** support the initial "member outbox row never reached the lead mailbox" premise. The `plan-copilot-exec-snapshot` `done` row exists in the member outbox at `outboxSeq=22` with id `aca89256-8667-41a3-b662-9449f7f268ed`, and the lead's mailbox history contains the matching proactive-report envelope at inbox `seq=707`, `receivedAt/consumedAt=2026-06-14T00:15:10.517Z`, `payload.memberName="plan-copilot-exec-snapshot"`, `payload.outboxSeq=22`, and the same outbox id (`.crews/crews/ralph-pipeline/members/plan-copilot-exec-snapshot/outbox.jsonl:1`, `.crews/crews/ralph-pipeline/leads/overview-bookkeeper/mailbox-history.jsonl:707`). The later `review-mail --peek` result of zero pending entries is explained by the lead cursor already being advanced to `lastReviewedSeq=710`, past inbox seq 707 (`.crews/crews/ralph-pipeline/leads/overview-bookkeeper/manifest.json:24-30`). So this repro is **not** `crews-undeliverable-report-notify-lead` (never enqueued) and is also **not** `crews-listener-silent-reap-across-idle-investigation` (queued, not consumed until later re-arm); it is a **listener-consumed / review-surfacing gap after successful enqueue**, with the exact lead-visible output likely missed or buried before the cursor advanced.

Root-cause ranking:

1. **Confirmed:** the proactive enqueue path succeeded, then the listener consumed the lead mailbox row. The loss happened after enqueue, not at the outbox-to-mailbox split.
2. **Likely:** a review-mail/wake output or listener-delivery notification was not operationally acted on before a later review advanced the cursor through seq 707-710. The current code allows `review-mail` to advance `lastReviewedSeq` to the max review-required seq it prints (`hooks/commands/review-mail.js:265-270`), so once that happens a later peek is necessarily empty.
3. **Collateral:** the `liveness-notifications.json.lock` timeouts are real crash-sweep lock pressure, but that lock is used only by the member-crash notification latch, not by proactive report enqueue (`hooks/member-crash-notifications.js:259-350`, `hooks/locks.js:223-225`).

## Control flow

```txt
Member emits <|report kind="done"|>
│
├─ hooks/stop.js handleInput(...)
│  ├─ rowsToWrite[] from parsed report tags
│  ├─ appendOutboxBatch(state.name, crew, rowsToWrite, cwd, { sessionId })
│  │  ├─ validates sender via deriveSenderIdentity(...)
│  │  └─ appends member outbox JSONL
│  │     → OutboxRow {
│  │          seq: number,
│  │          kind: "done" | "question" | "blocked" | "progress",
│  │          summary: string | null,
│  │          body: string,
│  │          id: string,
│  │          writtenAt: string,
│  │          from: { name: string, role: "member", crew: string }
│  │        }
│  │
│  ├─ if latestTerminal && !latestTerminal.replyTo
│  │  ├─ createdByLead = createdByLeadName(manifest.createdBy)
│  │  ├─ batch = selectTerminalOutboxBatch(member, crew, cwd, cursor[member] || 0)
│  │  ├─ appendSystemMailbox(createdByLead, crew, cwd, {
│  │  │    kind: latestTerminal.kind,
│  │  │    summary,
│  │  │    message,
│  │  │    payload: {
│  │  │      protocolVersion: 2,
│  │  │      memberName: string,
│  │  │      outboxSeq: number,
│  │  │      outboxId: string,
│  │  │      proactive: true,
│  │  │      entries: Array<{
│  │  │        seq: number,
│  │  │        id: string,
│  │  │        kind: "done" | "question" | "blocked" | "progress",
│  │  │        summary: string | null,
│  │  │        body: string,
│  │  │        replyTo: string | null
│  │  │      }>
│  │  │    }
│  │  │  }, { kind: "proactive-report", triggeredBy: member })
│  │  │
│  │  ├─ cursor[member] = batch.maxSeq
│  │  └─ writeCursor(...)
│  │
│  └─ appendLog("... stop allowed ...")
│
└─ Lead listener consumes mailbox
   └─ consumeMailbox(lead, crew, cwd, "listener", { sessionId, listenerEpoch })
      ├─ writes mailbox-history row with inbox seq
      ├─ if review-required: manifest.lastReviewRequiredSeq = seq
      └─ clears mailbox.json
```

## Q1: report-to-lead-mailbox path and atomicity

The durable outbox write and proactive lead notification are separate operations. `stop.js` first builds rows from parsed reports and calls `appendOutboxBatch(...)` (`hooks/stop.js:1344-1405`). Only after the outbox write succeeds does it compute `terminalRows`, select the terminal batch, and call `appendSystemMailbox(...)` to write the lead's mailbox envelope (`hooks/stop.js:1504-1543`). It then writes the per-member orchestrator cursor with `writeCursor(...)` (`hooks/stop.js:1544-1546`).

The outbox writer itself appends directly to the member `outbox.jsonl` via `fs.appendFileSync(...)` after validation (`hooks/mailbox.js:768-812`). The lead-mailbox writer is `appendSystemMailbox(...)`, which validates the envelope and delegates to `appendMailboxWithSender(...)` (`hooks/mailbox.js:544-585`). `appendMailboxWithSender(...)` takes the recipient mailbox lock, pushes the envelope into `mailbox.messages`, writes `mailbox.json`, optionally logs `mail-queued-no-listener`, appends sender history, and returns (`hooks/mailbox.js:441-498`).

Therefore the split is **not atomic**: the member outbox can succeed while lead notification enqueue or cursor write fails later. The code catches proactive notification failures and only logs them (`hooks/stop.js:1548-1550`). However, that split is **not what this concrete repro shows**: the lead history row exists for the same outbox id (`.crews/crews/ralph-pipeline/leads/overview-bookkeeper/mailbox-history.jsonl:707`).

## Q2: `liveness-notifications.json.lock`

`liveness-notifications.json` is the member-crash notification dedupe latch. `getLatchPath()` returns `<crewRoot>/liveness-notifications.json` (`hooks/member-crash-notifications.js:77-81`), and both `sweepMemberCrashNotifications(...)` and `resetMemberCrashNotificationLatch(...)` lock that latch with `withStateFileLock(getLatchPath(...), ...)` (`hooks/member-crash-notifications.js:238-263`, `hooks/member-crash-notifications.js:355-375`).

The 2000 ms timeout comes from the generic lock helper: `DEFAULT_MAILBOX_LOCK_TIMEOUT_MS = 2_000`, and `withStateFileLock(...)` calls `acquireLock(file + ".lock", timeoutMs || DEFAULT_MAILBOX_LOCK_TIMEOUT_MS)` (`hooks/locks.js:21-25`, `hooks/locks.js:223-225`). `acquireLock(...)` throws `LockTimeoutError` when it cannot acquire before the deadline (`hooks/locks.js:171-193`).

On `LockTimeoutError`, crash-sweep callers **fail loud to `crews.log` but drop that sweep attempt**. The listener heartbeat wraps the sweep in `try/catch` and logs `member-crash-sweep-failed ... err=<code>:<msg>` (`lib/listener-loop.js:408-430`); Stop and SessionStart have analogous best-effort wrappers (`hooks/stop.js:907-921`, `hooks/session-start.js:504-517`). The sweep does not retry inside the same call.

This lock is **not** on the proactive-report path. Proactive report enqueue uses the lead mailbox lock via `appendSystemMailbox(...)` -> `appendMailboxWithSender(...)` -> `withMailboxLock(...)` (`hooks/stop.js:1536-1543`, `hooks/mailbox.js:441-498`, `hooks/locks.js:237-245`). The crash-sweep latch lock and the lead mailbox lock are different files. The observed `member-crash-sweep-failed ... liveness-notifications.json.lock` rows are a concurrency-pressure signal, not the direct cause of this `done` delivery.

## Q3: actor-hijack hypothesis

The source has multiple guards that make a silent codex-lens child hijack unlikely for this concrete member:

- `assignMemberRole(...)` refuses a different session when the existing member has a live or unverifiable launcher tab (`hooks/actors.js:1087-1122`).
- It also refuses if the claimant hook process is proven to descend from the bound member's launcher process (`hooks/actors.js:1129-1140`).
- Codex SessionStart translation stamps `__crewsIncomingEngine = "codex"` specifically so `session-start.js` can detect a codex child trying to claim a copilot/claude parent (`hooks/codex-shim.js:74-84`).
- `session-start.js` documents and threads `incomingEngine` / `clearReclaim` through `applyEnvRole(...)` before applying the role (`hooks/session-start.js:349-380`).

The live manifest stayed a copilot member with the expected session id `8eee2ea4-c986-4639-bea7-ea6819b2486d`, `engine: "copilot"`, and `lastKind: "done"` (`.crews/crews/ralph-pipeline/members/plan-copilot-exec-snapshot/manifest.json:1-25`). That rules out an active final hijack. A transient displaced-and-rebound sequence is theoretically possible in older versions, but this source would log/decline the common child-claim paths and the concrete outbox + lead-history row prove this member owned enough state to append the outbox and route the proactive report.

So the actor-hijack hypothesis is **not the root cause of this repro**.

## Q4: missing log lines

There are two reasons the "zero log lines for this member" observation is not decisive:

1. `appendLog(...)` deletes `crews.log` when the file is larger than `MAX_LOG_BYTES = 64 * 1024`, then appends the new line (`hooks/mailbox.js:80`, `hooks/mailbox.js:992-1003`). The current root `crews.log` starts at `2026-06-14T00:35:08.343Z`, which is after the member's outbox write (`2026-06-14T00:15:08.349Z`) and after the lead mailbox-history consume (`2026-06-14T00:15:10.517Z`) (`.crews/logs/crews.log:1`, `.crews/crews/ralph-pipeline/members/plan-copilot-exec-snapshot/outbox.jsonl:1`, `.crews/crews/ralph-pipeline/leads/overview-bookkeeper/mailbox-history.jsonl:707`).
2. The logger path is derived from state cwd: `getLogPath(cwd)` returns `<cwd>/.crews/logs/crews.log` (`hooks/paths.js:256-258`). Hook state-cwd resolution honors `CREWS_STATE_CWD`, then validated pointer/walk-up, then `input.cwd` (`hooks/state-cwd-locator.js:95-141`). The member manifest records `stateCwd: "D:/harness-efforts/codexu"` (`.crews/crews/ralph-pipeline/members/plan-copilot-exec-snapshot/manifest.json:6-7`), so the expected log is the root `.crews/logs/crews.log`. A stale `codex/.crews/logs/crews.log` exists but contains only one unrelated 2026-06-10 `plan-anthropic-gate` line.

Conclusion: missing same-member log lines are best explained by log rotation/truncation, not by a different state root or by hooks not running.

## Q5: prior-art classification

This repro is **not** the `crews-undeliverable-report-notify-lead` failure mode. That task's selected direction is about a displaced member whose `IdentityMismatchError` catch clears the flag and returns before the outbox write, so the member's report cannot be delivered unless a new `member-undeliverable` incident envelope is added (`.ralph/jobs/crews-undeliverable-report-notify-lead/worktree/brainstorm/.ralph/brainstorms/crews-undeliverable-report-notify-lead/selected-direction.md:5-17`, `hooks/stop.js:870-898`). Here, the member outbox row exists and the lead mailbox-history row exists.

This repro is also **not** the `crews-listener-silent-reap-across-idle-investigation` failure mode. That prior verdict was "listener not running at write-time; queued mail later delivered by next arm via `initial`" (`.worktrees/investigate-listenerwake/.ralph/investigations/crews-listener-silent-reap-across-idle/findings.md:3-8`, `.worktrees/investigate-listenerwake/.ralph/investigations/crews-listener-silent-reap-across-idle/findings.md:37-47`). Here, the row was consumed by a listener about two seconds after being sent (`sentAt=2026-06-14T00:15:08.388Z`, `consumedAt=2026-06-14T00:15:10.517Z`, `via="listener"`) (`.crews/crews/ralph-pipeline/leads/overview-bookkeeper/mailbox-history.jsonl:707`).

It is closest to a **review-surfacing / cursor-after-consume** miss: the message did reach and was consumed into durable history, but a later `peek` at `lastReviewedSeq=710` could not show seq 707 because the reviewed cursor had already advanced past it (`.crews/crews/ralph-pipeline/leads/overview-bookkeeper/manifest.json:24-30`).

## Recommended minimal fix

Do **not** start by changing the proactive enqueue lock or the crash-sweep `liveness-notifications.json` latch; neither is causal for this repro. The minimal fix should harden the lead's review-surfacing path:

1. Add a review/audit recovery mode in `hooks/commands/review-mail.js` near the normal cursor logic (`hooks/commands/review-mail.js:221-270`): when `--peek` returns empty but the operator supplies a member/outbox id (or when the overview detects a recently referenced outbox id), search a bounded recent `mailbox-history.jsonl` window for `payload.memberName` / `payload.outboxId` and print the expanded row without advancing cursors. This gives the lead a deterministic "where did that done go?" path after `lastReviewedSeq` has already advanced.
2. Add log retention that does not delete the entire current log at 64 KiB. At minimum, rotate to `crews.log.1` before unlinking in `appendLog(...)` (`hooks/mailbox.js:992-1003`) so the Stop-time "notified lead of proactive done batch" line survives long enough for postmortem correlation.
3. Keep `crews-undeliverable-report-notify-lead` as a separate defense-in-depth task for the true displaced/no-outbox case, targeting the `IdentityMismatchError` catches (`hooks/stop.js:870-898`) and the new incident-envelope helper described by its selected direction.

These fixes are scoped: they do not alter report routing semantics, mailbox locks, crash-notify latch behavior, or listener ownership. They add a postmortem recovery/read surface and preserve the evidence needed to classify future reports accurately.
