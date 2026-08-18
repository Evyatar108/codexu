# T6 v3 — Happy client reconciliation for runtime `9650f15864`

**Status:** Happy-side client updated and unit-verified; awaiting the private
build artifact for the joint physical-phone E2E. T7 trusted-device work stays
OUT of this rollout per the fork's item 9 (tracked separately in
`t7-full-steering-trusted-device-decision.md`).

## 1. What the fork's final v3 contract asked for, and what we did

| # | Fork contract item | Happy-side status |
|---|---|---|
| 1 | Discover raw registry files under `<COPILOT_HOME>/servers`, selecting `privateProfile: "happy-t6"`; stock listing hides these entries | **Done.** `uiServerRegistry.ts` already reads the raw directory (never the stock listing). Added `privateProfile` support: `"happy-t6"` accepted and surfaced, a FOREIGN profile rejected fail-closed, absent field still accepted for legacy ev.6-era entries. |
| 2 | Relay/tunnel the registry loopback host:port to the physical phone | **Deliberately reinterpreted — see §3.** The phone never dials the terminal's loopback socket. Happy CLI is the on-machine bridge; the phone reaches it through Happy's existing encrypted session plane. No new tunnel was built and none is needed. |
| 3 | Connect with `protocolVersion: "1"`, `client {name,version}`, empty `capabilities` | **Done.** `nativeLocalRpcClient.ts` now sends `COPILOT_CONNECT_PROTOCOL_VERSION = '1'`. Note: every runtime build we can inspect (`classifyHappyConnect`, verified through 1.0.80-ev.3) type-checks this field as a *string* but never validates its value, and the connect *response* still reports the negotiated SDK protocol as the number `3` — our response-side check is unchanged. |
| 4 | Call `happy.attach`; require `happyProtocolVersion: "3"`; validate capabilities/method list | **Done, conditionally fail-closed — nested shape.** Fork-confirmed (2026-08-17) that v3 negotiation is nested under `result.protocol` (`{happyProtocolVersion, capabilities: [], methods, contractHash}`, alongside top-level `control`). `steeringClient.attachAndResync()` validates `protocol.happyProtocolVersion === '3'` and that `protocol.methods` covers all six steering RPCs — but only when the runtime advertises `protocol`. Verified older builds return only `{actionId?, outcome}` from `happy.attach`, so unconditional requirement would break every build we can currently run. The `protocol` schema is passthrough for additive future fields (e.g. `contractHash`); v3 fields at the TOP level are rejected. |
| 5 | Support exactly the six `happy.*` methods | **Already true.** `STEERING_RPC_METHODS` in happy-wire is exactly that set; no additions in this rollout. |
| 6 | Handle only `happy.controlChanged` with the six reasons | **Already true.** Unknown reasons are handled fail-safe (treated as revocation), per the shipped v1 design. |
| 7 | Heartbeat 15 s, lease TTL 45 s, "waiting for local grant" until `/happy grant <requestId>` | **Already true.** Constants unchanged (`COPILOT_HEARTBEAT_INTERVAL_MS = 15_000`, `COPILOT_LEASE_TTL_MS = 45_000`); server-provided values still override per-lease. Grant-before-modal runbook ordering retained from `t6-deny-path-live-verified.md`. |
| 8 | Prompt-answer mapping; no `autoApproveEdits: true`; permission scope only `"once"` | **Already true.** The wire schemas are strict: `answerPlanContentSchema` has no `autoApproveEdits` key (strict-rejects it), `answerPermissionContentSchema.scope` is `z.literal('once')`. |
| 9 | Keep T7 pairing/trusted-device out of this rollout | **Honored.** No T7 code in this branch. T7 tasks remain filed and paused. |
| 10 | Prepare the joint E2E runbook, wait for the build artifact | **Prepared, not executed.** See §4. |

## 2. Verification honesty: what we verified vs. what we took on trust

We could not read runtime commit `9650f15864` directly — it is not in any
local runtime checkout/mirror, and GitHub SAML authorization is currently
expired for the official repo. What we did instead:

- **Verified against the newest cached build** (`1.0.80-ev.3`,
  `20260814T222604Z-c83980e0c8ef`): the six-method actor, 45s/15s/60s timing,
  `classifyHappyConnect` string-typed-but-value-unchecked `protocolVersion`,
  raw registry publisher, and the attach result shape (`{actionId?, outcome}`
  — no negotiation fields yet in that build).
- **Fork-confirmed 2026-08-17 (answers to our two §2 questions plus extras):**
  (1) `connect.protocolVersion` IS strictly value-checked as string `"1"` in
  the v3 runtime; (2) unknown `connect` fields are rejected; (3)
  `connect.capabilities` must be absent or `{}`; (4) `privateProfile:
  "happy-t6"` discovery is correct as implemented; (5) the encrypted-relay
  interpretation is correct — happy-cli is the sole loopback/token consumer.
  The one correction they required: v3 negotiation is NESTED under
  `happy.attach` `result.protocol`, not top-level — applied in the follow-up
  commit with a nested-shape test using their exact example payload.
  Runtime source sharing was declared unnecessary; the forthcoming private
  build artifact is the joint-E2E verification vehicle.

## 3. Architecture note: "relay/tunnel to the physical phone"

The fork's item 2 phrasing ("relay/tunnel the registry's loopback host:port to
the physical phone") does not match Happy's architecture, and we did not
implement it literally. In Happy:

- The **terminal's loopback JSON-RPC socket is consumed only by happy-cli on
  the same machine** (`happy copilot --attach-ui-server`), exactly as the
  fork's own runbook §2 notes ("whatever bridges your phone to this loopback
  listener needs to run on the SAME machine").
- The **phone talks to the per-daemon embedded happy-server** over Happy's
  paired-device encrypted relay (Ed25519 device proof, TOFU pinning). The six
  `happy.*` RPCs are re-exposed to the phone as Happy session RPCs with a
  server-side per-connection caller envelope; the fork-issued `leaseId` never
  leaves the CLI.

This is the same shape that passed the live web E2E and deny-path re-run.
Exposing the raw registry host:port+token beyond loopback would bypass the
paired-device boundary and is out of the question for this rollout.

## 4. Physical-phone E2E readiness (prepared, blocked on the build)

Client branch: `fix/happy-t6-v3-client` (this commit). Launch sequence on the
terminal machine once the private build lands:

```powershell
# 1. Fork terminal (their side), with the embed gate on:
$env:COPILOT_HAPPY_EMBED = "1"; <private-build launcher>

# 2. Happy daemon (embedded per-daemon server), isolated dev home:
$env:HAPPY_HOME_DIR="$HOME\.happy-dev"; $env:HAPPY_VARIANT="dev"
node packages\happy-cli\bin\happy.mjs daemon start

# 3. Happy Copilot bridge, attaching to the published registry entry:
node packages\happy-cli\bin\happy.mjs copilot --attach-ui-server
```

Phone side: pair via the standard invite flow, open the mirror session,
request steering, then have the terminal user run `/happy grant <requestId>`
BEFORE any prompt modal opens (runbook-ordering lesson from
`t6-deny-path-live-verified.md`).

Checklist to execute jointly (unchanged from the web E2E, plus v3 deltas):
1. Registry discovery selects the `privateProfile: "happy-t6"` entry.
2. Connect handshake succeeds with transport `"1"`.
3. Attach negotiation reports `happyProtocolVersion: "3"` + methods; client
   validates and proceeds.
4. Lease request → pending → terminal grant → active with server TTLs.
5. Heartbeats, release, keystroke revocation.
6. Deny on a destructive permission (typed result, modal closes, no write).
7. Ask-user / elicitation / plan answer paths (not yet live-exercised —
   carried over as the known coverage gap from the web E2E).
