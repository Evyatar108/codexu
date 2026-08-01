# T6 Path B-lite — phone-side ACK: envelope confirmed (with deltas) + our constraints

**Status:** Reply to `t6-pathb-lite-phone-side-requirements.md`. The phone-side
work is now tracked and starting in parallel (tasks
`happy-t6-phone-steering-client-plumbing` → `happy-t6-phone-steering-app-ui`
on the codexu tasks board). Everything in your §2–§6 is accepted as-is unless
noted below.

## 1. Command envelope (§4) — CONFIRMED, with three small deltas

Your proposed shape works for our client architecture. We will send:

```jsonc
{
  "actionId": "<client-generated UUID v4, required>",
  "sessionId": "<the attached session id>",
  "type": "answer-permission" | "answer-elicitation" | "answer-plan" | "answer-ask-user",
  "content": { /* per-type payload */ },
  "targetRequestId": "<pending request id from the observed event stream>"
}
```

Deltas / clarifications we need you to confirm:

1. **`actionId` reuse semantics on retry — confirmed and load-bearing for
   us.** Our transport path is phone → happy-server relay → happy-cli →
   your loopback seam, and the relay layer currently forwards `{method,
   params}` with no dedup of its own (`packages/happy-server/sources/app/api/
   socket/rpcHandler.ts:160-220`). We are adding `actionId` passthrough at
   every hop, but the phone's socket layer can retry after reconnect, so
   **your `(sessionId, actionId)` TTL must be long enough to cover a mobile
   reconnect cycle — please make it ≥ 60 s** (your "short TTL" wording didn't
   give a number). Tell us the actual TTL so we can cap our client-side
   retry window below it.

2. **Please echo `actionId` in the outcome/ack event.** Optimistic UI needs
   to correlate "the thing I sent" with "the thing that was applied/rejected"
   without guessing by `targetRequestId` (two devices could answer the same
   request). Whatever event you emit when a command is applied or rejected,
   include the originating `actionId`.

3. **Typed rejection outcomes:** we will branch on a discriminant. Proposed
   enum (from your own §4 text) — confirm or rename, we don't care about the
   exact strings as long as they're stable:
   `applied | duplicate | already_resolved | out_of_scope | destructive_kind |
   no_lease | not_pending | rate_limited`. If you implement the Sol-style
   dispatch outcome set from the T6 doc §6 Option 2, that's fine too — just
   send us the final list. `duplicate` and `already_resolved` should be
   distinguishable from real failures (we render them as success-ish, not
   errors).

## 2. Lease (§2) — accepted; two requests

- All semantics accepted: single holder, terminal-grant only, instant
  keystroke revocation, no auto re-acquire, in-memory only, re-request after
  reconnect.
- **Request 1:** emit an explicit `lease-revoked` event with a `reason`
  (`keystroke | expired | superseded | released | detached`) rather than
  letting the phone infer it from a failed heartbeat. Our UI copy differs for
  "the human took over" vs "your lease expired".
- **Request 2:** heartbeat — we will ping every **15 s** by default (well
  inside your ≤30 s budget) and make the interval remotely tunable from a
  server-sent value in the lease-grant response (e.g. `{heartbeatIntervalMs,
  leaseTtlMs}`). If you put those two numbers in the grant payload, you can
  change them fork-side later without another interop round.

## 3. Destructive flag (§3) — accepted

We key UI strictly off a boolean on the prompt event, no hardcoded kind
names. Please put it on the event as `destructive: boolean` (absent =
`false`) and we're done — we don't need the classification list itself,
only the flag. Server-side rejection of an attempted answer on a
destructive kind (belt and braces) should return the `destructive_kind`
outcome above.

## 4. Latency (§5) — accepted

Building optimistic UI against ~3 s pickup: control greys out immediately on
send, confirmation comes from the event stream (correlated via the echoed
`actionId`, see §1.2). No synchronous round-trip anywhere. We will not ask
for the poller wake-patch in v1; if real usage shows it matters we'll file
it as the follow-up you described.

## 5. Reconnect (§6) — accepted

Phone resyncs from currently-pending state only. We will not build replay
for ask-user/elicitation/exit-plan. One request: expose the "currently
pending" set as a **single snapshot read** we can issue right after
reconnect (rather than waiting for the next event), including for durable
permission prompts — if your adapter already maintains this for the
event stream, a `pending` array in the attach/registration response is the
cheapest shape for us.

## 6. Summary of what we're waiting on from you (supersedes your §7)

| # | Item | Our default until you confirm |
|---|---|---|
| 1 | Lease heartbeat interval + TTL, ideally in the grant payload | 15 s heartbeat, assume 45 s TTL |
| 2 | `destructive: boolean` on prompt events | treat absent as `false`, render answerable |
| 3 | Final `content` types per answer `type` | permission: `{decision: "approve" \| "deny"}`; others stubbed behind adapter types |
| 4 | Rejection outcome enum (final strings) | the §1.3 list above |
| 5 | `actionId` echoed in applied/rejected events | correlate by `targetRequestId` (degraded) |
| 6 | Dedup TTL value (≥ 60 s requested) | cap client retries at 45 s |
| 7 | Pending-set snapshot on attach (§5) | poll event stream after reconnect (degraded) |

Items 3–5 block our final integration pass but not our build start; 1, 2, 6,
7 have safe defaults. Send the real values whenever
`happy-mission-control-actor-v1` lands.
