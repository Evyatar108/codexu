# T6 — critical fixes landed; protocol confirmed compatible; deny-first policy update

**Status:** Major update. Independent brainstorm agents (Opus 5 max, Sol max)
re-investigated the just-landed `happyMissionControlActor.ts` against the
ACTUAL shipped enforcement policy and found real, severe bugs — since fixed
and independently re-verified by this session (not just trusted). This
supersedes parts of `t6-joint-objective-and-status.md`.

## 1. Critical: your EXISTING client code was actually incompatible — now fixed, no changes needed on your side

The shipped read-only enforcement (`happy-promote-classify-call-to-production`,
commit `8744bdd3c7`) turned out to reject your real client's actual requests:

- Your `connect()` sends `{token, protocolVersion, client: {name, version},
  capabilities: {}}` (4 keys) — the policy required *exactly* `{token}` (1
  key). Every connect attempt would have been rejected.
- Your `session.resume` sends `{sessionId, disableResume: true}` only — the
  policy required `observePromptEvents: true` and `requestPermission: false`
  too, which your client never sends (correctly — it polls
  `session.eventLog.read` rather than subscribing live). Every resume
  attempt would have been rejected.

**Fixed** (worktree `happy-copilot-embedded-ui-server`, commits `fb45ce87a0`):
connect now accepts your exact real shape (still requires `capabilities` be
empty — the original security intent of blocking capability opt-ins like
telemetry forwarding is preserved); resume no longer requires
`observePromptEvents`/`requestPermission` at all. **Your existing client
code needs no changes** — it was already correct; our policy was wrong.

## 2. Bonus finding: removing `observePromptEvents` does NOT break observation

We verified directly (not assumed) that this doesn't regress your ability to
see prompt events at all. `sdkServer.ts`'s generic event forwarder
(`~line 5315-5384`) broadcasts every session event — including
`permission.requested` and friends — to **every non-extension connection
unconditionally**. The "opt-in required" gating only applies to VS-Code
*extension* connections (a completely separate connection path your
TCP-seam client never touches). So you continue observing the full event
stream exactly as before; only the SDK *provider registration* (the part
that caused the clobber bug) is no longer triggered.

## 3. Permission answer policy update: deny works for ANY kind; approve is currently a no-op

Real, severe finding: the only kind we allow-listed for **approval**
(`"read"`) is unconditionally auto-approved by the CLI's own baseline
(`applyManagedServerPermissions` sets `approveAllReadPermissionRequests: true`
regardless of flags) and — per that function's own doc comment — **crashes
the terminal's Ink render if a `read` prompt is ever surfaced to a UI at
all**. In practice, a `read` permission request never reaches a pending
state for anyone to answer. As shipped, your phone's entire
approve-permission path was unreachable.

**Fixed:** denial is monotonically safe regardless of permission kind (it
can only prevent an action, never cause one), so `happy.answerPrompt` now
allows **denying any kind**, including ones we'd otherwise call
"destructive." Approval remains gated to the fail-closed allow-list
(currently just `read`, which — per above — never actually needs answering).

**Recommendation for your UI (update to the phone-side design):** given
approval is currently a no-op in real usage, consider making **deny the
primary/prominent action** for permission prompts, with approve either
hidden or clearly secondary, rather than presenting a symmetric
approve/deny pair. This may change again if/when a genuinely
safe-to-approve-remotely kind is identified and added server-side, but
don't build UI today assuming approve reliably works.

## 4. Other fixes (lower relevance to you, FYI)

- A real streaming-mutation bug: any `session.resume` that omitted
  `streaming` was silently forcing the session to non-streaming. Fixed;
  doesn't affect you since you never send `streaming` and never wanted to
  change it.
- Doc-accuracy fixes to `disableResume`'s comments (no behavior change).
- The `constructor`/prototype-chain dispatch concern one reviewer raised
  was independently re-verified end-to-end (traced the full Rust dispatch
  chain) and confirmed **not exploitable** for Happy specifically — the
  fail-closed allow-list gate runs and rejects before that code path is
  ever reached.

## 5. Decisions 3 & 4 — both your and our brainstorm agents converged

- **Path B (generalizing Mission Control's plumbing):** both recommend
  **not pursuing it now**. The current fork-local adapter already reuses
  the core shared semantics (`PromptManager`, native first-wins arbitration)
  — the risky duplication (two independent prompt-arbitration systems)
  doesn't exist. Revisit only after your real-phone E2E validation, and only
  if a genuinely missing shared primitive is identified — not preemptively.
- **Broadening beyond `answer-prompts`:** both recommend **not now** — wait
  until the current slice passes real end-to-end validation with an actual
  phone. One reviewer (Sol) also found concrete hidden traps for whenever
  broadening does happen (worth reading before that work starts): scope is
  currently hard-coded to `readonly ["answer-prompts"]`; the dedup map is a
  seen-bit not a result ledger (a retry needs the original outcome, not just
  "duplicate"); `send()` can't be synchronously awaited in the inbound RPC
  (would need an atomic-enqueue + later-completion-event pattern, mirroring
  why `CommandPoller` fire-and-forgets it); abort needs stale-state
  protection via an explicit turn ID, not just session generation; and a
  successful foreground-switch actually revokes the current lease via the
  actor's own attach/detach lifecycle today, which would need explicit
  handling if foreground-switch is ever added as an action kind.

## What this means for your current tasks

`happy-t6-phone-steering-client-plumbing` can proceed exactly as before —
nothing here invalidates the pinned interop values from the joint-status
doc. The one meaningful update: build your permission-prompt UI expecting
deny to be the reliable, primary action, not a symmetric approve/deny pair.
