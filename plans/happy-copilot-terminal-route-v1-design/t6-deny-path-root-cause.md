# T6 — deny-path `-32603` root cause: **ours, not yours**

**Reply to `t6-deny-path-investigation.md`.** Short version: you asked for the
exact error message text from the captured `-32603`. We did not have it
captured (see "Why we couldn't just paste it" below) — so instead we root-caused
it against your shipped `ev.6` binary. **The bug is on the Happy side, and your
runtime is behaving correctly.**

**The error your runtime threw was:**

```
happy.* requires a non-empty string leaseId
```

...from `requiredString(values, "leaseId")` at the top of
`HappyMissionControlActorImpl.handleAnswerPrompt`. Happy never sent `leaseId`.
Nothing in your permission path ever ran.

## Why we couldn't just paste it

Two independent reasons, both ours:

1. **Our client discards the message.** `nativeLocalRpcClient.ts` throws
   `Copilot RPC failed (happy.answerPrompt, code -32603)` and drops
   `error.message` — deliberate, per our "never render Copilot errors/stacks to
   the phone" convention. Your `toErrorEnvelope()` analysis is right: the real
   text *was* on the wire. We threw it away before logging. We had briefly added
   a debug passthrough during the E2E and reverted it before commit — that
   revert is why the text is not in our logs.
2. **The raw-socket probe never reached the call.** Our `owner-probe` state file
   shows it stopped at `{"phase":"requested"}` — it never got a lease, because
   of the very modal-keystroke ordering bug you just accepted into the runbook.

## How we root-caused it without the string

All of the following was done against the **exact published `ev.6` payload**
(`20260802T061301Z-875812e07a90`), not against a guess.

**Step 1 — your own DEBUG log proves where execution stopped.**
Your terminal process log for the E2E window
(`~/.copilot/logs/process-1785686296238-22508.log`) contains five
`respondToPermission: requestId=…, kind=…` lines at 17:11–17:22 UTC — every one
of them from a *local TUI* answer. There is **no such line at 17:16:21 UTC**,
the moment our `happy.answerPrompt` failed. That log is emitted by the JS loop
over `plan.logs` *after* `sessionPlanRespondToPermissionJson` returns, so its
absence means that native call never returned — i.e. execution never got that
far.

**Step 2 — we loaded your native addon and called the suspects directly.**
`runtime.node` `dlopen`s standalone, so each candidate could be exercised in
isolation:

| Native fn | Deny-path result |
|---|---|
| `remoteBuildToolPermissionResponse(false, 'once', …)` | `{"kind":"reject"}` for *every* well-formed input (incl. `undefined`, `{}`, unknown kinds). Only throws on genuinely malformed JSON. |
| `remotePromptFallbackBeforeLookup` / `AfterLookup` / `AfterRespond` | never throw; return plan objects for every input we tried |
| `sessionPendingRequestsRespondJson` | unknown session → `{"resolved":false}`, no throw |
| `sessionPlanRespondToPermissionJson` | never throws — tolerant of bogus session id, bogus `result.kind`, even a missing `result` |

**So your entire fallback chain is throw-free**, including
`plan_respond_to_permission`. Your initial ruling-out of
`build_tool_permission_response` was correct, and your follow-up suspicion of
`plan_respond_to_permission` is now also ruled out — empirically, not by
reading.

**Step 3 — that left the actor's own parameter validation**, which is the
*first* thing `handleAnswerPrompt` does:

```js
handleAnswerPrompt(params, connection) {
  const values   = recordParam(params);
  const actionId = requiredString(values, "actionId");
  const sessionId = requiredString(values, "sessionId");
  const leaseId  = requiredString(values, "leaseId");        // ← threw here
  const type     = requiredString(values, "type");
  const promptId = requiredString(values, "targetRequestId");
```

**Step 4 — our client provably never sent `leaseId`.** Our wire envelope
`steeringCommandEnvelopeSchema` is `.strict()` and carries exactly
`{ actionId, sessionId, targetRequestId, type, content }`. `answerPrompt()`
spread that envelope straight into `invokeSteering` — so `leaseId` was simply
absent. (The `sessionId` you require *was* present: our native transport injects
the Copilot foreground session id and rejects any caller-supplied one, which is
why the envelope's Happy session id is stripped first.)

## Why this matched the observed pass/fail pattern exactly

Your `leaseId` requirement is asymmetric across the surface, and the asymmetry
lines up perfectly with what passed in the live run:

| Method | `leaseId` | Live E2E result |
|---|---|---|
| `happy.attach` | not read | ✅ passed |
| `happy.requestLease` | not read | ✅ passed |
| `happy.heartbeat` | **required** | ✅ passed — we pass it explicitly |
| `happy.releaseLease` | **required** | ✅ passed — we pass it explicitly |
| `happy.answerPrompt` | **required** | ❌ `-32603` — we never passed it |

`answerPrompt` was the *only* call that both requires `leaseId` and didn't send
it. Everything else in the checklist passing was not luck.

This is the same bug class as the two other contract mismatches this E2E found
(`protocolVersion` sent as a number instead of a string; `happy.requestLease`
missing `actionId`) — all three were undocumented per-method param requirements
that only a live call could surface.

## Fix (landed on our side)

`packages/happy-cli/src/agent/copilot/steeringClient.ts` — `answerPrompt()` now
attaches the locally-held active lease id:

```ts
const { sessionId: _happySessionId, ...params } = command;
const leaseId = this.state.leaseId;
...
result = await this.transport.invokeSteering(
  'happy.answerPrompt',
  { ...params, leaseId },
  ...
);
```

`leaseId` stays out of the wire envelope by design — the phone never learns the
fork-issued lease id, so the CLI is the correct place to attach it. Added a
regression test pinning the **full** param set for `happy.answerPrompt`
(exact `toEqual`, not `objectContaining`) plus an assertion that the Happy
session id is never forwarded, so a future envelope change can't silently drop
it again. happy-cli typecheck clean; 1474 tests pass (one pre-existing
unrelated `messageMetaAttachmentRefs` failure, identical on a clean tree).

## What this means for your two findings

- **Your structural finding stands and is confirmed.** We read the same shipped
  code: `embeddedServer.ts` passes no `createPromptManager`, so
  `resolvePromptManager()` returns the fresh, empty `PromptManager` whenever MC
  is off, and every Happy permission answer takes the
  `promptFallback` branch. Your C4 test-coverage gap (local-entry branch never
  representative of Happy's real runtime) is real and worth filing — it just
  wasn't the cause here.
- **`plan_respond_to_permission` is exonerated.** No further digging needed on
  your side for this bug.

## One optional ask (your call, not blocking)

Three of the four contract mismatches this E2E surfaced were undocumented
per-method param requirements. A short param matrix in the contract doc —
which params each `happy.*` method requires vs. treats as optional, and which
are string-typed — would have caught all three statically. Separately, if
validation failures returned a typed rejection instead of a bare `-32603`,
clients would surface them without needing an error-text passthrough.

## Status

Blocker is **cleared and live-verified**. The deny path was re-run end-to-end
against the same ev.6 build on 2026-08-02 and passed; the exact wire error text
was also captured at last via a raw-seam replay of the pre-fix param set. See
`t6-deny-path-live-verified.md` for the full run, including the captured
`-32603` message string.
