# T6 Path B-lite — implementation gap found (blocks `happy-mission-control-actor-v1`)

**Status:** Implementation attempt on the Copilot fork side hit a real feasibility
gap and was correctly aborted (no dead code committed). This is a follow-up to
`t6-pathb-lite-handoff.md` — not a rejection of Path B-lite itself, just two
missing pieces in that doc's "implementation shape" (section 3) that need a
design answer before coding can resume.

**Fork-side status:** worktree `happy-copilot-embedded-ui-server` is clean at
`8744bdd3c7` (unchanged — the read-only enforcement from the prior task). No
new code landed. Prototype was typechecked (clean) and passed 122 focused
tests, but was discarded because it could not be wired into a reachable
production code path within the file scope the handoff doc specified.

## 1. What's missing: an inbound channel for phone-originated commands

The handoff doc's implementation shape says the fork-side hook lives entirely
in `src/cli/embeddedServer.ts` (~15-25 LOC: construct/attach/detach/dispose).
That's correct for wiring the actor's *lifecycle* to the session, but
`embeddedServer.ts` does not — and cannot, within the file scope given —
provide a way for the phone to actually **send** anything to the actor.

Verified directly: `embeddedServer.ts:249`'s only Happy-facing hook is

```ts
authorizeTokenGatedInboundCall:
    options.connectionToken === undefined
        ? undefined
        : (method, params) => classifyHappyCall(method, params).allowed,
```

This is a **boolean allow/deny gate on the existing JSON-RPC method
dispatch** (the mechanism `happy-promote-classify-call-to-production` just
built). It has no way to:

- Accept a **new** message type from the phone (lease request, lease
  heartbeat, an `actionId`-tagged command envelope) that doesn't correspond to
  an existing JSON-RPC method.
- Return a **typed outcome** (e.g. "rejected: out of scope" vs. "rejected:
  destructive kind" vs. "rejected: no lease") — it's a plain boolean.
- Push anything into the actor's command queue at all — there is no seam here
  for the phone's outbound traffic to arrive on, only a gate on inbound calls
  that are already headed somewhere else (existing `session.*` RPC methods).

**Open question for the design:** should the phone reuse *existing* JSON-RPC
methods (e.g. `session.send`, whatever answers a permission prompt) and have
the fork side re-authorize them against the lease instead of the current
allow-list (this would mean extending `classifyHappyCall`'s allow-list logic
or the dispatch layer itself — `serverSeamDispatch.ts`/`serverSeamHandlers.ts`
and the Rust `engine.rs`/`protocol.rs`, none of which were in scope for this
task)? Or does Happy need genuinely new JSON-RPC methods (`happy.requestLease`,
`happy.heartbeat`, `happy.answerPrompt`, ...) registered in that same dispatch
layer? Either answer touches files beyond `happyMissionControlActor.ts` +
`embeddedServer.ts` — the handoff doc's file-scope constraint needs to be
revised to explicitly include whichever of these is chosen.

## 2. What's missing: a terminal-side call site for granting the lease

Separately: nothing in the currently-permitted files can invoke "grant Happy
a lease" from the terminal side. A steering lease is, by definition,
**terminal-granted only** (per the T6 design doc's policy layer) — so there
must be some human-facing UI or keybinding in the CLI that does this. The
obvious place is `app.tsx` (a slash command, a keybinding, a dialog action),
but `app.tsx` is explicitly on the handoff doc's "must not modify" list (it's
also the single hottest file in the repo at 384 commits/90 days, which is
presumably *why* it was excluded).

**Open question for the design:** where does the "grant lease" affordance
live if not `app.tsx`? Options we can see from the fork side:
- A narrow, additive change to `app.tsx` (a single new keybinding/command
  branch) — accept the small collision-surface increase for this one
  necessary hook.
- A new slash-command file that doesn't touch `app.tsx` directly, if the CLI's
  command-registration pattern allows registering a command from an external
  module (needs verification — we did not find this pattern during the
  prototype attempt, but didn't exhaustively search for it either).
- Something else you have in mind that the fork-side investigation didn't
  consider.

## 3. What this does NOT change

Nothing about the core Path B-lite verdict is in question — the observation
seam (`PromptManager`/`CommandPoller` reuse, zero MC file edits, avoiding the
enablement-clobber bug) is still believed clean, and was not what blocked
this attempt. This is purely about the **inbound edge**: how phone-originated
bytes get from "phone" to "actor" and how a human grants the lease in the
first place. Both are plumbing questions, not architecture reversals.

## 4. Ask

Please advise (or re-run a scoped feasibility pass, same as the original
investigation) on:

1. Reuse-existing-RPC-methods-with-lease-reauthorization vs.
   new-Happy-specific-RPC-methods for the inbound command channel, and which
   files that requires touching (we expect `serverSeamDispatch.ts`,
   `serverSeamHandlers.ts`, and the Rust `engine.rs`/`protocol.rs` files at
   minimum, based on what the prior `happy-promote-classify-call-to-production`
   task touched for the read-only enforcement — reusing that same dispatch
   layer for lease-aware answers seems the more natural fit, but we'd like
   your view given the deeper context you have).
2. Where the terminal-side lease-grant call site lives, and whether a small,
   explicitly-scoped `app.tsx` change is acceptable for just that one hook, or
   whether there's a cleaner existing extension point we're missing.

Once you (or a re-run investigation) give us an updated file-scope answer for
these two points, we'll re-open `happy-mission-control-actor-v1` and resume
implementation — the rest of the spec (lease semantics, envelope shape,
polling-latency expectations, reconnect gap) in `t6-pathb-lite-handoff.md` and
`t6-pathb-lite-phone-side-requirements.md` all still stand unchanged.
