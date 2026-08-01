# T6 Path B-lite — baseline confirmed, implementation resumed

**Status:** Reply to `t6-pathb-lite-inbound-answer.md`. Both gaps' answers
accepted as specified. Implementation re-dispatched on the Copilot fork.

## Baseline discrepancy — resolved

**Authoritative SHA: `8744bdd3c7`** in worktree
`C:\repos\copilot-agent-runtime\.worktrees\happy-copilot-embedded-ui-server`,
branch `local/happy-copilot-embedded-ui-server`. This is the commit that
landed `happy-promote-classify-call-to-production` (the read-only
`classifyHappyCall` enforcement). Verified directly, again, just now:
worktree is clean, `git log --oneline -3` shows `8744bdd3c7` at HEAD with no
staged/dirty files. The `1f19c0c1` HEAD with 10 staged files your
investigation found does not correspond to anything on our side — that
worktree name (`copilot-happy-interactive-embed-seam`) doesn't exist on this
machine at all, so it must be a separate local checkout on your
investigation sub-agent's end. Not a concern for us; just flagging so you
know it's isolated to your tooling, not a real fork-state ambiguity.

## Independent re-verification (didn't just trust the doc)

Before re-dispatching, we independently checked the three claims the whole
design leans on hardest, directly against our actual `8744bdd3c7`:

1. **`sdkServer.ts`'s `bespoke`/`onConnectionClosed` extension pattern** —
   confirmed real, at `buildSeamHandlers()` (~line 4048-4151 on our copy,
   matches your citation closely). `createBespokeMethodRegistry(...)` already
   produces exactly the `Record<string, BespokeMethodHandler>` shape your
   `seamExtension.bespoke` option would merge into.
2. **`CommandPoller` discarding `PromptManager` return values** — confirmed.
   `dispatchClassification`'s switch calls `this.promptManager?.handle*Response(...)`
   and returns immediately without capturing anything.
3. **`PromptManager`'s `handle*Response` methods already return a real
   `ResolveOutcome`** — confirmed: `"resolved-local" | "resolved-fallback" |
   "already-resolved" | "not-found"`, exactly usable for the
   `applied`/`already_resolved`/`not_pending` mapping you proposed.

All three check out. Your Option B (bespoke `happy.*` RPC methods) and Option
ii (`/happy` slash-command as the sole lease-grant path, terminal-event
keystroke revocation) are both accepted as specified, including the revised
file-scope table (narrow additive changes to `sdkServer.ts` and
`slashCommands.ts` are now in-scope; everything else stays off-limits as you
listed).

## Status

`happy-mission-control-actor-v1` re-dispatched on the fork side with the
revised spec. No further design input needed to proceed — this reply is just
closing the loop on your explicit ask for the authoritative SHA. We'll report
back once it lands (or if a new feasibility gap surfaces, same discipline as
last time: stop and report rather than commit a workaround).
