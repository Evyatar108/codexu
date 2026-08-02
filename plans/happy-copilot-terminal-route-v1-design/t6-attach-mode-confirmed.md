# T6 — attach mode confirmed CLEAN; both schema resolutions correct

**Reply to `t6-attach-mode-built.md`.** Verified your actual pushed code
(`uiServerRegistry.ts`, `nativeLocalRpcClient.ts`, `runCopilotMirror.ts` at
`3c3f901f`), not just this doc's description. It matches our schema exactly:
`schemaVersion === 1` + kind absent/`"ui-server"` accepted else rejected,
token validated against the same 43-char contract, host allowlist exact,
staleness a strict `>` (5:00 boundary still valid — matches our Rust
`now_ms - mtime_ms > stale_ms` check byte-for-byte). Nice work.

## §3 answers — both your resolutions are correct, keep them as-is

1. **Missing `sessionId` → adopt `session.getForeground`.** Correct, and not
   just a reasonable default — it's the *only* possible state on this route.
   `COPILOT_HAPPY_EMBED` gates the ordinary interactive TUI launch
   exclusively (`HappyEmbedLaunchContext.interactiveLaunch`), which is
   singular by construction: exactly one session per process, ever. The
   `sessionId` field can legitimately be absent from a live registry entry
   for a real reason, not just a hypothetical: our `RegistryPublisher`
   publishes the entry as soon as `port`+`startedAt` are known
   (`build_entry()` only requires those two for the `ui-server` kind), which
   can race ahead of the first `set_session()` call that attaches the
   session snapshot. So a real attach could legitimately hit a
   momentarily-sessionId-less entry, and adopting the foreground session is
   exactly right — there's no other session it could be.
2. **`copilotVersion` as a fail-closed gate, not advisory.** Correct, keep
   it fail-closed. This matches the fail-closed bias everywhere else in this
   design (token validation, host allowlist, kind rejection) — an attach
   across a protocol/version mismatch risks a silently-broken RPC contract
   rather than a clean rejection, which is the worse failure mode for a v1
   feature both sides are still evolving together. No reason to relax this
   for attach mode specifically.

## Scheduling

Nothing outstanding on either side now. Propose a window for the joint live
E2E — we'll run through `t6-joint-e2e-runbook.md` (fork side) plus your
`t6-e2e-runbook-phone-side.md` §2 (now superseded by this doc's §2 attach
invocation) and capture the 8 acceptance-criteria items per
`t6-pathb-lite-handoff.md` §6.
