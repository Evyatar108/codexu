# T6 Path B-lite — phone-side (Happy app) requirements

**Status:** Implementation in progress on the Copilot fork side. This note is
the interop contract the phone/Happy app needs to build against. Companion to
`t6-pathb-lite-handoff.md` (which your agent wrote and we accepted as-is —
thank you, it was verified clean and implementation started immediately).

**Fork-side status (2026-07-31):** Tasks Board task
`happy-mission-control-actor-v1` created and dispatched to a background
worker. Building `src/cli/happyMissionControlActor.ts` + a small
`embeddedServer.ts` hook per your handoff doc's section 3 implementation
shape and section 6 acceptance criteria. Not yet landed — this note describes
the contract the fork side is committing to, so you can build the phone side
in parallel without waiting on our commit.

## 1. What changes for the phone app vs. today's read-only v1

Today (as of commit `8744bdd3c7` on our side): Happy is read-only in
production — `classifyHappyCall`'s allow-list is enforced, so any
mutating call the phone attempts is rejected with `REQUEST_NOT_PERMITTED`.

With this adapter landed: Happy can hold a **steering lease** on the
foreground session and, while holding it, answer prompts. Everything else
(observation, event stream) is unchanged.

## 2. Steering lease — what the phone app must implement

- **Request/acquire:** the phone requests a lease; the fork side grants it
  only while the connection is attached to the current foreground session.
  There is no new auth tier — the existing loopback connection token is
  what admits; the lease is an in-memory grant on top of that, not a
  credential.
- **Default scope on first grant: `answer-prompts` only.** No
  input/send-text, no abort, no foreground-switch in v1. Do not build UI
  that offers those yet — they are out of scope for this task and will be
  a separate future grant type. If your UI currently has any control that
  implies "send a message" or "switch session" from the phone, it must
  stay disabled/hidden regardless of lease state until we tell you
  otherwise.
- **Single holder.** If another client (e.g. Mission Control, or another
  Happy device) already holds the lease, the phone's request is rejected —
  surface this as "another client is currently steering" rather than a
  generic error.
- **Expiry + heartbeat renewal.** The lease is short-lived and must be
  renewed by a phone-originated heartbeat. Exact interval is being finalized
  fork-side; design your heartbeat as a simple periodic "still here" ping
  and we'll confirm the interval and timeout in the next handoff once the
  adapter's lease state machine is implemented. Budget for renewal at least
  every 30s to be safe; we'll tell you the real number.
- **Instant revocation on ANY terminal keystroke.** The moment the human
  touches the terminal, the lease is revoked fork-side with no grace period.
  The phone app must treat a lease-revoked event as authoritative and
  immediately stop offering "answer" affordances for any pending prompt,
  falling back to observe-only rendering. Do not retry-acquire
  automatically — require an explicit new user action on the phone to
  re-request.
- **In-memory only.** Do not expect the lease to survive a fork-side
  process restart or session detach/reattach; the phone must be prepared to
  re-request after any reconnect.

## 3. Destructive permission kinds — always observe-only

Regardless of lease state or scope, some permission kinds are **terminal-only
by operator decision** and must never be answerable from the phone. The fork
adapter will enforce this server-side (rejecting any attempted answer with a
typed outcome), but the phone UI should also proactively render these as
observe-only (no approve/deny buttons) so the user isn't shown a control that
will always be rejected. We'll confirm the exact list of "destructive" kinds
in the next handoff (expect things like irreversible file deletion / destructive
shell commands, as opposed to e.g. a read-only tool permission) — build the UI
to key off a `destructive: boolean` (or similar) flag on the prompt event
rather than hardcoding kind names, since the exact classification may be
refined.

## 4. Command envelope — proposed shape (please confirm or counter-propose)

The fork adapter synthesizes Mission Control's cloud-shaped envelope fields
internally, so the phone does not need to match Mission Control's wire
format. We propose the phone send commands in this shape; please tell us if
this doesn't fit your client architecture:

```jsonc
{
  "actionId": "<client-generated UUID, required>",
  "sessionId": "<the attached session id>",
  "type": "answer-permission" | "answer-elicitation" | "answer-plan" | "answer-ask-user",
  "content": { /* answer payload, shape depends on type */ },
  "targetRequestId": "<the pending request id being answered, from the observed event stream>"
}
```

- **`actionId` is required on every command.** The fork side dedupes on
  `(sessionId, actionId)` with a short in-memory TTL to give exactly-once
  semantics, since the underlying `session.send`/answer paths have no native
  replay protection. Generate a fresh UUID per distinct user action; if you
  retry a network call for the *same* user action, reuse the same
  `actionId` (that's what makes the retry safe).
- Commands outside the current lease scope (e.g. anything other than
  `answer-*` while only holding `answer-prompts`) will come back with a
  typed rejection outcome, not a silent drop or generic error — build your
  error handling to distinguish "rejected: out of scope" from "rejected:
  destructive kind" from "rejected: no lease" from a transport failure.

## 5. Latency expectations — please don't build for sub-3s

The fork adapter drains phone-originated commands through Mission Control's
existing `CommandPoller`, which polls on a 3s fast / 10s slow (after ~30 min
idle) cadence — this is intentional reuse of existing, proven infrastructure,
not a placeholder. **Design the phone UI's "answer sent" feedback assuming
up to ~3s (occasionally more) before the fork side picks it up and acts on
it.** An optimistic local UI update (grey out the button immediately, confirm
via the event stream once actually applied) is the right pattern — don't
block on a synchronous round trip.

If this latency proves unacceptable after you build against it, tell us —
there's a known future escalation path (a small poller wake-patch) but it's
explicitly out of scope for this v1 task, so raise it as a follow-up rather
than assuming it's coming.

## 6. Reconnect / disconnect — known gap, design around it

If the phone disconnects while a prompt is pending and reconnects later:

- **Permission prompts are durable** fork-side and will still be observable
  after reconnect.
- **Ask-user, elicitation, and exit-plan prompts are NOT buffered for
  replay in this v1** — if the phone was disconnected when one of these
  appeared and resolved (e.g. it timed out or the terminal user answered
  it), the phone will not see it after reconnecting. This is a known,
  accepted rough edge in the handoff doc, not a bug to report.
- Design phone reconnect handling to re-sync from "whatever is currently
  pending now," not to assume it can recover full history of what happened
  while disconnected.

## 7. What we still owe you before you can finish integration

- The exact lease heartbeat interval/timeout values (currently a placeholder
  "at least every 30s" above).
- The exact `destructive` permission-kind list/flag shape.
- Confirmation the command envelope in section 4 matches what's actually
  implemented (the adapter is being built now; we'll send the real shape
  once it lands, including exact TypeScript/JSON types for `content` per
  `type`).
- The typed rejection-outcome shape (enum/string values for "out of scope",
  "destructive", "no lease", etc.).

We'll follow up with those specifics once `happy-mission-control-actor-v1`
lands and is validated. In the meantime, everything in sections 2-6 above is
stable enough to build against now.
