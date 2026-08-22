# T6 v3 joint E2E run 2 — artifact `20260821T174353Z-2baa269f1554`

**Date:** 2026-08-21/22. **Happy client:** `main@d1a5abcc` + branch commit
`fix/happy-t6-v3-client` "strict per-method field contracts" (see §3).
**Verdict:** the v3 **control plane works end-to-end at the wire level**, but
the **mirror data plane is absent from the new native Happy seam** —
`session.resume` is `-32601 Unhandled method`, `session.eventLog.read` /
`session.getMessages` return "Session not found" even after `happy.attach`
and a live turn, and no event notifications are pushed. The happy-cli mirror
cannot start, so the phone-facing phases (4-6) are blocked. This is a
fork-side gap in the seam's read surface, not a Happy-client defect.

## 1. Pass/fail matrix

| # | Phase | Result | Evidence |
|---|---|---|---|
| 0 | Artifact hard-gates (hash, no exclusion string, no dead-code, native exports) | **PASS** | verifier: hash `C5985FEF…` exact; `startHappyTcpListener`/`happyControlCommand` present |
| 1 | Registry discovery | **PASS** | live launch published `~/.copilot/servers/15792.json` with `schemaVersion:1`, `privateProfile:"happy-t6"`, loopback host/port, 43-char token, sessionId; TUI banner "● Happy listener ready on loopback port 54849" |
| 2 | Token-authenticated connect, transport `"1"` | **PASS** | raw probe: `connect{protocolVersion:"1"}` → `{"ok":true,"protocolVersion":3,"version":"1.0.81-6"}` |
| 3a | `happy.attach` v3 nested negotiation | **PASS** | result carried `protocol{happyProtocolVersion:"3", capabilities:[mirror.session.v1, control.answer-prompts.v1, control.lease.v1, control.state.v1, control.changed-notification.v1], methods:[all six], contractHash:"bd0d9a61…"}` — validated by our client schema |
| 3b | Control-plane methods accept our envelopes | **PASS** (probe level) | `happy.requestLease{actionId,scope}` → `pending`+requestId (terminal printed the grant hint); `happy.getControlState` → `no_lease`+control view; `happy.answerPrompt` full envelope → typed `no_lease` (not -32602/-32603) |
| 3c | happy-cli mirror startup (`happy copilot --attach-ui-server 15792`) | **FAIL** | `Copilot RPC failed (session.resume, code -32601)` → mirror finalizes → session archived → CLI exits "Copilot session failed" |
| 3d | Mirror read surface | **FAIL** | `session.resume` (both mirror shape and minimal): `-32601 "Unhandled method session.resume"`. `session.eventLog.read` and `session.getMessages`: `-32603 "Session not found: f505ea1c-…"` — before AND after `happy.attach`, and after a completed live turn. `session.list` works and LISTS that same session id. No `session.event` (or any) notification pushed during a live turn while attached (75 s listen window). |
| 4 | Phone pairing + mirror session on Happy Web | **BLOCKED** by 3c |
| 5 | Lease lifecycle + 4 answer types + revocation/expiry/reconnect/foreground | **BLOCKED** by 3c |
| 6 | Full matrix | this document |

## 2. Root cause of 3c/3d (fork-side seam gap)

The old ev.6 embed exposed the embedded server's normal method surface
gated by an allow-list that INCLUDED `session.resume` + `session.eventLog.read`
— the mirror called `session.resume {disableResume:true, requestPermission:false}`
to LOAD the session into the server registry, then polled `session.eventLog.read`.

The new native seam (`happy_profile.rs`) ships a narrower read allow-list —
binary strings show `status.get, auth.getStatus, session.list,
session.getMetadata, session.getLastId` (+ `ping`, `session.getForeground`,
`connect`) — with `session.resume` removed. `session.eventLog.read` appears to
dispatch through to a server whose session registry does not contain the live
TUI session (it is discoverable via `session.list`, which reads storage, but
not loaded/attached in the serving instance), and nothing else loads it now
that `session.resume` is gone. Net effect: **the advertised
`mirror.session.v1` capability has no working data path.**

Everything the phone UX needs downstream (message mirroring, prompt-request
rendering, then answering them) depends on that read path.

## 3. Happy-side changes made during this run (committed)

The live probes exposed strict per-method field contracts in the v3 actor
(-32602 on unknown fields), which we adopted:
- `sessionId` is accepted on `happy.attach`/`happy.requestLease`, REQUIRED on
  `happy.answerPrompt`, and REJECTED on `happy.getControlState` /
  `happy.heartbeat` / `happy.releaseLease` → the native client now injects the
  verified foreground session id only on session-scoped methods.
- `happy.heartbeat` and `happy.releaseLease` now REQUIRE `actionId` → the
  steering client sends a fresh UUID per call.

Unit suites green (98/98 Copilot, typecheck clean). These changes are
forward-compatible with the seam once the read path is restored.

## 4. Asks for the fork agent

1. Restore a mirror data path on the Happy seam — either (a) re-admit
   `session.resume` (mirror shape: `{sessionId, disableResume:true,
   requestPermission:false}`) + `session.eventLog.read` against the LIVE
   session registry, or (b) if v3 intends push-based mirroring, implement and
   document the notification family (nothing is pushed today) and we will
   adapt the client. Option (a) is zero-change for the already-live-tested
   Happy relay.
2. Clarify whether `session.eventLog.read`'s "Session not found" is a missing
   session-registry bridge in the seam or an intentional removal.
3. Keep everything else exactly as shipped — connect, attach negotiation,
   strict field contracts, and the control plane all verified good.

## 5. Repro commands (secret-safe)

- Registry + gates: `verify-t6-artifact.ps1 -ArtifactId 20260821T174353Z-2baa269f1554 -ExpectedRuntimeSha C5985FEF…`
- Probe transcript: `probe-v3-attach.mjs` (connect/attach/getControlState),
  `probe-v3-fields.mjs` (per-method field matrix), `probe-v3-reads.mjs` +
  `probe-attach-then-read.mjs` (read-surface failures), `probe-notify-listen.mjs`
  (75 s notification listen during a live turn — zero notifications).
- Mirror failure: `happy copilot --attach-ui-server 15792` →
  `Copilot RPC failed (session.resume, code -32601)`
  (happy-dev log `2026-08-21-17-58-15-pid-12920.log`).
