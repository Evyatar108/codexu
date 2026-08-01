# T6 Path B-lite — phone side is NEAR-READY

**Status:** Reply to `t6-joint-objective-and-status.md` and
`t6-critical-fixes-and-policy-update.md`. Both phone-side tasks are built,
adversarially reviewed, and complete per the joint doc §2 "near-ready"
definition. This supersedes any claim that the phone-side tasks are
"not started."

## 1. What shipped (both branches pushed to origin as topic branches)

| Branch | Tip | Content |
|---|---|---|
| `tasks-board/happy-t6-phone-steering-client-plumbing/impl` | `4a7954eb` (4 commits) | Transport layer: shared wire types in `packages/happy-wire` (envelope, your final content types, outcome enum, lease/control events); lease client state machine in `packages/happy-cli/src/agent/copilot/steeringClient.ts` (single holder, generation-tokened stale-response AND stale-grant discard, requestId-correlated grants, no auto re-acquire, 15s heartbeat honoring grant-payload overrides, 45s-capped retry window under your 60s dedup TTL, per-connection identity broker with server-side identity injection); event projection with pending-prompt events + fail-closed destructive flag; bootstrap-gap buffering with ordered drain. |
| `tasks-board/happy-t6-phone-steering-app-ui/impl` (stacked on `9b265372`) | `5db71992` (2 commits) | happy-app UI: lease UX (request/holder-conflict/expiry/manual release/reason-specific revocation copy), prompt-answer composer for all four types, deny-first permission rendering per your policy update, attribution, e-ink-static rendering, i18n across 11 locales. |

Review protocol: 5 adversarial review rounds total across the two branches
(gpt-5.6-sol for transport, claude-opus-4.8 for UI). Round-1 findings
(4 HIGH + 1 MEDIUM transport; 1 MEDIUM + 1 LOW UI) plus a round-2 HIGH
(stale-grant transfer between phone connections) were all fixed and
re-verified; final verdicts CLEAN on both branches. Validation: both
typechecks clean; 143 happy-wire + 64 copilot-targeted + 37 app-targeted
tests green.

**Your deny-first policy update (§3 of your doc) is fully adopted:**
- Transport gate split by decision: deny → forwarded for ANY known pending
  permission kind; approve → fail-closed exact-`"read"`-only, rejected
  `destructive_kind` before send.
- UI: destructive permission prompts render **deny-only** with an
  "approve is terminal-only" note; non-destructive prompts render deny
  primary / approve secondary. Approve-of-destructive is unreachable at
  three layers (pure guard, composer, and your server gate).

## 2. ACK §6 item 7 — answered (you asked us to verify)

**It was a REAL gap on our side, now fixed — no fork-side follow-up task
needed.** Our attach path had generic replay-from-start, but our event-log
read request omitted prompt event types entirely, so pending-permission
state was never replayed. Fixed in the plumbing branch
(`types.ts`, `nativeLocalRpcClient.ts`, `eventRelay.ts`): durable
permission prompts now resync after attach; ask-user/elicitation/exit-plan
remain live-only per the accepted gap.

## 3. Two things we need pinned from you (gate our final integration pass)

1. **Lease notification method names.** The joint doc pinned the six
   request methods but not the notification names. We implemented
   `happy.leaseGranted` and `happy.leaseRevoked` (revoked carries
   `reason: keystroke | expired | superseded | released | detached`).
   Confirm, or send your shipped names and we rename — trivial either way.
2. **Grant-active control event `requestId` echo.** Our app tier
   correlates the `requesting → holding` promotion on the `requestId`
   carried by the active/grant control event (falling back safely when
   absent, since your broker gates every actionable RPC by connection
   ownership anyway). Confirm your grant event echoes the granted
   `requestId`.

## 4. Assumptions we coded (flag if any is wrong)

- Permission kind strings are lowercase (`"read"`), matching your
  `SAFE_PERMISSION_KINDS` and the event schema — the joint doc's prose
  mentions `Read`; we followed the code.
- `expiresAt` is epoch milliseconds.
- `leaseTtlMs` is present in the grant result payload alongside
  `heartbeatIntervalMs`.

## 5. v1.1 candidate (NOT a v1 blocker)

Our relay identity is connection-scoped (`socket.id`), not a durable
device key — authenticated device identity isn't exposed on this relay
path today. Consequence: if disconnect cleanup can't reach the daemon, a
reconnecting phone's stale fork-side lease survives up to the 45s TTL
(no other phone can use it; single-holder still holds). Fine for v1
semantics; durable per-device binding would need a small interop
extension — noting it for the post-E2E punch list.

## 6. Next milestone: the joint live E2E (§2 ready checklist)

We agree with your sequencing and your prediction that a live run will
surface a punch list. We're ready to schedule the joint session — your
call on the window. Suggested prep on your side so the session is
scripted rather than exploratory: a short fork-side runbook (launch the
actor-enabled terminal, `/happy grant` flow, expected log locations).
Integration note on our side: the UI branch is stacked on `9b265372`;
final integration re-stacks it on the plumbing tip `4a7954eb` (the
deny-policy client gate) — sequencing handled by us.
