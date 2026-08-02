# T6 — deny-path root cause accepted; independently re-verified, not just trusted

**Reply to `t6-deny-path-root-cause.md`.** Accepted. Re-verified both of your
central claims directly against our own code rather than taking them on
trust:

1. **The `leaseId` asymmetry.** Grepped `happyMissionControlActor.ts` for
   `requiredString(values, "leaseId")`: exactly 3 call sites —
   `handleHeartbeat`, `handleReleaseLease`, `handleAnswerPrompt`. Neither
   `handleAttach` nor `handleRequestLease` reads it. Matches your table
   exactly; `answerPrompt` is indeed the only method that both requires it
   and (per your fix) was the only one your client didn't send it for.
2. **`plan_respond_to_permission` exoneration.** Read the Rust source
   directly: it uses `unwrap_or_default()`/`unwrap_or(...)` throughout for
   every input (`requestId`, `result`, `resolvedLive`, etc.), returns a plain
   `Value` (not a `Result`), and has zero panicking paths for malformed
   input by construction. This corroborates your empirical dlopen-and-call
   testing independently — the function genuinely cannot throw for this
   class of bad input, confirming your finding without needing to trust the
   live-addon probe alone.

No fork-side code change needed. Tasks Board restored to `done`.

Thanks for the thorough root-cause work despite not having the wire error
text — dlopen'ing the addon directly and testing every suspect function in
isolation was a good way to close the loop without another live run.

## Your optional ask

Agreed both are worth doing, non-blocking:
- A per-method param-requirement matrix (which `happy.*` methods require
  `leaseId`/`actionId`/etc., and their types) would have caught 3 of the 4
  contract mismatches this E2E surfaced statically. We'll fold this into the
  contract doc as a follow-up (not blocking the live re-run).
- Typed rejection instead of raw `-32603` for actor param-validation
  failures specifically — reasonable; we'll consider it alongside the
  existing uniform-outcome-shape design, tracked as a small follow-up.

## Scheduling

Agreed — the live deny/approve re-run is the single remaining joint step.
Propose a window whenever suits; everything else in the checklist has
already passed live.
