# T6 joint E2E — web-on-VM results

**Date:** 2026-08-02  
**Happy integration branch:** `tasks-board/happy-t6-joint-e2e-integration/impl`  
**Fork build:** `all-comp-g-20260801`, Evyatar Edition `1.0.76-ev.6`,
artifact `20260802T061301Z-875812e07a90`

The VM has no attached phone/tablet, so the Happy Expo web client replaced the
physical app for this run. The tested path was:

```text
EvCopilot interactive TUI (COPILOT_HAPPY_EMBED=1)
  → v1 ui-server registry entry
  → happy-cli --attach-ui-server mirror
  → daemon-embedded happy-server
  → Happy Expo web client paired with Ed25519 local-device proof
```

## Passed

- Exact published fork build downloaded through the verified EvCopilot cache.
- Schema-v1 discovery, token-gated connect, foreground-session adoption, and
  fail-closed version check.
- Web local-device pairing and authenticated session fetch.
- Copilot transcript/tool events mirrored into Happy.
- Lease request reached the terminal actor and `/happy status` listed its ID.
- `/happy grant <request-id>` moved the web client to `Steering active`, using
  the server-provided expiry/heartbeat/TTL.
- Heartbeats succeeded.
- Browser release produced `released` revocation.
- Any terminal keystroke immediately produced `keystroke` revocation and the
  web client dropped back to observe-only.
- A destructive `write` permission rendered deny-only with
  `Approve is only available at the terminal`.
- The mirror stayed alive through registry-file heartbeat replacements after
  the attach monitor fix.

## Happy-side defects found and fixed

1. `connect.protocolVersion` must be sent as string `"3"`; the response remains
   negotiated numeric `3`. Numeric `3` was rejected `REQUEST_NOT_PERMITTED`.
2. `happy.requestLease` requires a fresh `actionId` and
   `scope: ["answer-prompts"]`.
3. Consuming the local pairing invite removed the only CORS origin allowance,
   making authenticated browser use impossible. Enrolled local devices now
   allow only explicit loopback HTTP origins; Ed25519 proof remains mandatory.
4. A transient registry `stat` failure during atomic publisher replacement was
   treated as terminal death. The attach monitor now trusts the still-live PID
   during that transient gap.

## Remaining blocker — RESOLVED, and it was ours

**Superseded by `t6-deny-path-root-cause.md`. Corrected 2026-08-02.**

Clicking **Deny** on the destructive prompt reached the correct mirror handler,
but the call failed with JSON-RPC `-32603`. This section originally recorded
the failure as fork-side and stated the request shape was the agreed envelope.
**That was wrong on both counts, and the error was mine.** The envelope below is
the *contract's* shape, not what happy-cli actually put on the wire:

```jsonc
{
  "actionId": "<uuid>",
  "sessionId": "<native session id injected by happy-cli>",
  "leaseId": "<active lease id>",          // ← NEVER ACTUALLY SENT
  "type": "answer-permission",
  "targetRequestId": "<permission.requested data.requestId>",
  "content": { "decision": "deny" }
}
```

`steeringCommandEnvelopeSchema` is `.strict()` and carries no `leaseId`, and
`answerPrompt()` spread that envelope straight through — so `leaseId` was
absent. The fork's `handleAnswerPrompt` requires it and threw
`happy.* requires a non-empty string leaseId`, which surfaced as `-32603`.
Nothing in the fork's permission path ever executed; the fork was correct
throughout. `answerPrompt` was the only method that both requires `leaseId` and
omitted it, which is exactly why every other checklist item passed.

Fixed in `steeringClient.ts` (attaches the locally-held active lease id) with a
regression test pinning the full `happy.answerPrompt` param set. **Unit-verified
only — the live deny/approve pass still needs to be re-run.**

## Runbook correction

The current runbook order says to wait for a real prompt, then request/grant
the lease. Once the native permission modal is open, terminal typing is
consumed by that modal and `/happy grant` cannot reach the slash-command
router. The viable sequence is:

1. Request/grant steering before a prompt is pending (or while the model is
   still producing pre-tool text).
2. Let the permission prompt arrive while the lease is active.
3. Answer it from Happy.

This ordering should replace steps 1–5 in `t6-joint-e2e-runbook.md`.
