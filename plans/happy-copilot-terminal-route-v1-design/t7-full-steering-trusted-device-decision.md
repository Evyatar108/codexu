# T7 — Full steering, trusted-device mode: OPERATOR DECISION (2026-08-05)

**Status:** decided; kicking off implementation on both sides. Answers the
deferred open decision #4 from `t6-joint-objective-and-status.md` §3 ("when to
broaden scope beyond `answer-prompts`") and open decisions #3/#4 from
`t6-remote-steering-design.md` §9.

## The decision

The operator wants **full control of ev-copilot sessions from the phone,
without the request/grant ritual and without scope limitation**, on his own
machines. Verbatim intent: *"I don't see a reason for lease and grants, I want
to have the ability to control the session from my phone without limitation."*

Design response (operator-approved): **trusted-device mode** — auto-grant, not
lease removal.

## Threat-model rationale (why auto-grant is sound here)

The v1 lease's terminal-grant step was proof-of-physical-presence against a
local same-user process abusing the loopback token. On a single-user dev box
that boundary is weak by construction: a malicious same-user process can
already read `~/.happy/access.key` / `ecdh-key.priv`, keylog the terminal, or
inject console input directly. The lease constrains only well-behaved
software.

The load-bearing boundary is and remains the **paired-device identity**: the
phone is Ed25519-authenticated, E2E-encrypted, TOFU-pinned against the
operator's own daemon. "My paired phone" is a strong identity; granting it
standing authority is a deliberate policy, not an accident. Fail-closed
defaults are preserved for everyone else: trusted-device mode is opt-in via
explicit config, default OFF.

## What changes (fork side — ev-copilot actor)

1. **Trust switch:** `COPILOT_HAPPY_TRUST=full` (env; the EvCopilot launcher
   will set it on the operator's machines as part of the OneDrive routing
   work). Unset/other value → exact v1 behavior (request → `/happy grant`),
   byte-for-byte.
2. **Auto-grant on attach:** under `full` trust, the actor grants a
   **full-scope lease** — `{answer-prompts, send-input, abort-turn,
   set-foreground}` — to a paired Happy connection on `happy.attach` (or on
   the first `happy.requestLease`, whichever is simpler; the result must be
   that the phone never waits on a terminal action). Reattach/reconnect
   re-grants automatically. Heartbeat lifecycle unchanged.
3. **Keystroke semantics change:** terminal keystrokes NO LONGER revoke.
   The terminal simply wins in-the-moment races (the native first-wins
   tombstone already arbitrates prompt answers; `session.send` queues input).
   The lease persists. Terminal status line shows a persistent
   "Happy: full control (trusted device)" indicator instead of the
   revoked/granted churn.
4. **Destructive kinds phone-approvable:** under `full` trust, the
   `SAFE_PERMISSION_KINDS`/`destructive_kind` gate no longer blocks
   phone-side APPROVE. Deny-first remains merely the default UI emphasis.
   (Under v1/untrusted behavior the fail-closed gate stays exactly as
   shipped.)
5. **New steering verbs, scope-gated:** dispatch paths for `send-input`
   (originate a user message), `abort-turn`, `set-foreground` — per the
   already-written §6 surface in `t6-remote-steering-design.md`. Existing
   methods gain scope checks at dispatch rather than new signatures where
   possible.
6. **`session.send` idempotency key:** REQUIRED before any phone-originated
   send ships (mobile retry behavior double-sends otherwise). Dedup per
   session, short TTL — same pattern as the existing `actionId` dedup.
7. **Rate limiting** on the new mutating verbs, mirroring the existing
   `rateLimit(connection, ...)` pattern in the actor.

## What changes (happy side — this repo)

1. **Wire schema:** extend `@slopus/happy-wire` steering envelope with the
   new command types (`send-input` with `idempotencyKey`, `abort-turn`,
   `set-foreground`) and lease-scope surface: scope array widens beyond
   `['answer-prompts']`; `steeringClient.ts` requests full scope when the
   daemon/CLI is configured for trusted mode, and handles `auto-granted`
   lease results (no `pending` intermediate).
2. **steeringClient:** drop the assumption that keystroke revocation ends
   steering (handle the new non-revoking notification shape); plumb the new
   verbs with the same actionId-retry/dedup discipline as `answerPrompt`.
3. **App UI (web + phone):** input composer wired to `send-input`; Abort
   button; foreground-session switcher (only if multiple sessions);
   destructive prompts render Approve+Deny under full trust (Approve styled
   as the dangerous action); persistent "Full control" state chip replacing
   the request/grant flow when auto-granted.
4. **Config:** happy-side trusted-mode flag (env/settings) so the CLI knows
   to request full scope; OFF by default upstream.

## Explicit non-goals / kept invariants

- The lease OBJECT survives internally (attribution, multi-device
  arbitration, TTL/heartbeat plumbing) — it just auto-grants. This is a
  policy layer, not a state-machine rewrite.
- v1 fail-closed behavior is the default for any build without the trust
  switch. Nothing weakens for third parties.
- The native first-wins tombstone stays the arbitration layer for
  simultaneous answers.
- Native copilot permission prompts still exist (core product safety) — the
  change is that the phone can answer ALL of them under full trust.
- No second token tier; authority still conveyed via the in-memory lease.

## Sequencing note

Runs in PARALLEL with the OneDrive launcher/distribution work
(`t6-onedrive-delivery-brainstorm-{opus,sol}.md`): disjoint surfaces
(fork actor + happy steering client/UI vs. PowerShell launcher + publish
scripts). The launcher work should reserve setting `COPILOT_HAPPY_TRUST=full`
in the routed environment once this ships. The interop values pinned in T6
(heartbeat 15s, lease TTL 45s where applicable, actionId dedup TTL 60s,
protocolVersion "3"-as-string on connect, `happy.answerPrompt` requires
`leaseId`) remain unchanged unless this work explicitly renegotiates them in
a joint doc.

## Asks for the fork agent

1. Review this decision; flag anything that breaks your C4-era assumptions
   (especially the keystroke-revocation change interacting with the
   modal-consumes-keystrokes behavior we documented in the runbook).
2. Propose the trust-switch plumbing you prefer (env var read at actor
   construction vs config file) and confirm `SAFE_PERMISSION_KINDS` gating
   can be policy-scoped without touching the untrusted path.
3. Implement fork-side items 1–7 behind the switch; the joint live E2E gate
   from T6 applies again before we call it ready (this time including
   send-input from phone, abort from phone, destructive approve from phone,
   and terminal/phone simultaneous-answer races in both directions).
