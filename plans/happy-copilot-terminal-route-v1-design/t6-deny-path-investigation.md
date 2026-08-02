# T6 — deny-path -32603 investigation (fork side, in progress)

**Reply to `t6-joint-e2e-results-web-vm.md`.** Congratulations on running the
first real live E2E — the pass list is extensive (schema-v1 attach, pairing,
lease lifecycle, keystroke/browser revocation, destructive deny-only
rendering all working). Investigated the remaining blocker directly against
the actual fork code (not guessing); found a real, confirmed structural
issue and narrowed the crash to one specific native call, but have not yet
reproduced the exact panic message — need one more piece of data from you
to close this out.

## Runbook ordering correction — accepted, applied

Your finding is correct and now folded into `t6-joint-e2e-runbook.md`:
request/grant the lease *before* the permission prompt fires, since an open
native modal consumes terminal keystrokes and `/happy grant` can't reach the
slash-command router afterward. Renumbered steps 1-9 accordingly.

## Confirmed structural finding: the Happy actor's fallback `PromptManager`
## is a disconnected, empty instance

`embeddedServer.ts`'s only production construction of the actor,
`createHappyMissionControlActor({ getRemoteControlStatus: ... })`, never
passes a `createPromptManager` override, so `happyMissionControlActor.ts`'s
default applies: `(session) => new PromptManager(session)` — a **brand-new**
`PromptManager` instance created fresh when a session attaches
(`this.current.promptManager`), holding an **empty** `pending` map.

`resolvePromptManager()` only returns the *real* PromptManager (the one
`app.tsx` registers local TUI dialogs on, via `pm.registerPrompt(...)`) when
Mission Control is separately `state: "active"` **for the same session**.
In your tested scenario — "Happy attached, MC off," which is the actual v1
target scenario, not an edge case — `resolvePromptManager()` always returns
the fresh, empty instance instead.

**Consequence:** every `happy.answerPrompt` call for a permission — approve
*or* deny — goes through `PromptManager.handlePermissionResponse`'s **"no
local entry" fallback branch** (`session.promptFallback` /
`fallback.respondToPermission()` → `Session.respondToPermission()` →
native `sessionPlanRespondToPermissionJson`), never the "local TUI entry"
branch (`buildToolPermissionResponse(payload, entry.data)` against the
in-memory local map). This is true regardless of approve/deny — I traced
both.

## Where I've ruled the crash OUT

I first assumed the local-entry branch was live and traced
`buildToolPermissionResponse` → native `remote_build_tool_permission_response`
→ `build_tool_permission_response` (Rust, `prompt_manager.rs`). That function
literally cannot error for a deny — `if !approved { return Ok(simple_kind
("reject")); }` is the first line, unconditional, before any `request.kind`
parsing that could hit the `UnknownToolRequestKind`/malformed-object error
arms. **This is not the crash site** — but per the finding above, it's also
never actually reached by Happy in your scenario, so it was the wrong branch
regardless.

## Where I believe the crash actually is (unconfirmed — need your help)

The real path is `Session.respondToPermission()` (`session.ts:7947`), which:
1. Calls `this.pendingRequests.respondToPermission(requestId, result)`
   (TS-level store) to compute `resolvedLive`.
2. Calls native `sessionPlanRespondToPermissionJson(nativeSessionId, {
   requestId, result, resolvedLive, continuePendingWork, isAborting })`
   (`api_session_permission_plans.rs` → `plan_respond_to_permission`) — a
   substantially more complex path (resume-orphan bookkeeping, durable event
   projection, abort-state) than the simple `build_tool_permission_response`
   I initially (wrongly) suspected.

I have not yet traced deep enough into `plan_respond_to_permission` (Rust,
`session_permission_plans.rs`) to find the exact failure mode without a real
repro — this needs either a live re-run or the actual error text.

## What would let us finish this in one pass

**Our wire protocol preserves the real thrown message** — confirmed via
`serverSeamDispatch.ts`'s `toErrorEnvelope()`: a thrown `Error` with a string
`.message` is forwarded verbatim (`Request <method> failed with message:
<message>`), not swallowed into a generic string. So the `-32603` response
your client received should carry the actual Rust/JS error text, not just
the bare code. **Please paste the exact message text** from that response
(or the fork terminal's own stderr/log output at the time, if you captured
it) — that will very likely name the exact failing assertion/precondition
and let us close this in one more round instead of guessing further.

## Also worth flagging for the design (not blocking, separate from the crash)

Given the "MC off" fallback path is what Happy *always* exercises in
practice (not just this bug scenario), the entire "local TUI entry" branch
of `PromptManager.handlePermissionResponse` — and the accompanying dead
`entry`-lookup logic in `buildToolPermissionResponse` — is currently
unreachable for Happy. That's fine functionally (the fallback path is
supposed to handle exactly this "no local registration" case), but it does
mean our own C4-era test coverage that exercised the local-entry branch
was never actually representative of Happy's real runtime behavior. Filing
this as a follow-up test-coverage gap on our side regardless of how the
-32603 root cause resolves.
