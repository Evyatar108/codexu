---
overviewTaskId: codex-native-orchestration-crews-replacement-feasibility
---

## Direction
D-001 — Happy-cli daemon owns Layer-B coordination state + a THIN codex hook for the hard gate. Make the existing happy-cli `127.0.0.1` daemon the single-writer owner of crews' coordination files (killing the multi-process EPERM/LockTimeout locks; the substrate is ~80% already shipped as agent-comms Scope B), while a thin codex Stop/PreToolUse hook that does ZERO file I/O keeps querying the daemon to preserve the hard `decision:'block'` turn-veto.

> **Headline verdict: PARTIAL — GO on dropping the LOCKS, NO on dropping the HOOKS.** D-004's verbatim "without hooks AND locks" welds two separable mechanisms with opposite risk profiles. The single-writer daemon legitimately removes the cross-process lock failure class (Node's event loop serializes daemon-internal writes; the in-process `inboxChains` chain has no `LockTimeout`/EPERM). But removing the per-process hooks throws out the hard operator-gate: in THIS fork, codex members have a working Stop hook (`crews/.codex-plugin/hooks/hooks.json` → `codex-stop.js`; `codex-shim.js` honors `decision:'block'`; `tests/progress-bg-gate-codex.test.js` proves a hard turn-block), and that hook — not the lock, not the daemon — is the ONLY seam that can veto a codex member's turn-end. D-001 keeps the gate, drops the locks.

## Goal
A codex-only crew where ALL durable coordination state (mailbox + monotonic cursor, append-only audit history, review-required gate cursor, member registry, crash/takeover state, operator channel) is owned and serialized by a SINGLE persistent happy-cli daemon over a loopback IPC control plane — with NO cross-process file locks on crews' coordination files — while a thin per-process codex Stop/PreToolUse hook (doing zero file I/O) preserves the hard `decision:'block'` operator gate by querying the daemon. End state: zero `LockTimeoutError`/EPERM in crews.log under a multi-member load, the hard review-mail turn-block still fires on an unreviewed codex member, and durable mail survives a daemon restart / reboot and is redelivered to offline members.

## Scope
### In Scope
- Vehicle: the existing **happy-cli daemon** (Node, Windows-supported, already the single-writer for agent-comms inboxes via `POST /agent-comms/send → appendMessage`). NOT the codex Rust app-server-daemon (Unix-only).
- Move `consumePending` + cursor-advance OFF the per-session bridge INTO the daemon (the lock-killing primitive — removes the `mailbox.ts` cross-process `withInboxLock` second-writer).
- Add daemon-owned Layer-B protocol: review-required cursor as a gate (`lastReviewRequiredSeq` vs `lastReviewedSeq`), ack/decision rows, operator-direct/escalate/member-reply semantics, crash/liveness/takeover generation state, member registry.
- A THIN codex Stop/PreToolUse hook rewritten to QUERY the daemon over loopback instead of grabbing `withManifestLock`; it emits `decision:'block'` when the daemon reports reviewed < required. Zero file I/O in the hook.
- Loopback IPC over the shipped `HAPPY_DAEMON_CONTROL_URL` control plane (`X-Loopback-Capability` auth); named pipe as a later Windows-hardening swap.
- Restart/recovery: daemon persists `mailbox.json` + `history.jsonl`; offline members re-read on reconnect (extend `recovery.ts`).

### Out of Scope
- The codex Rust app-server-daemon as the file-owner (Unix-only — `app-server-daemon/README.md`). Revisit only if it gains Windows lifecycle + durable multi-client coordination + a hard turn-complete policy hook.
- Pure no-hooks enforcement (D-002) — deferred behind an explicit operator decision; it loses the hard gate.
- Keeping Claude/Copilot members alive (operator accepted codex-only for members; cross-engine lenses are a separate open question).
- Codex submodule edits (D-001 needs none — app-server stays the session engine).

## Criteria
- Under a 5-member concurrent codex crew, crews.log shows ZERO `LockTimeoutError`/EPERM/`UNKNOWN`-on-rename incidents on coordination writes (vs the documented multi-incident baseline).
- The hard review-mail gate still fires: an unreviewed codex member's turn-end is HARD-blocked via `decision:'block'` (assert against the existing `progress-bg-gate-codex.test.js` harness shape) — the daemon-querying thin hook returns the block.
- A durable message survives a daemon restart AND a machine reboot and is redelivered to an OFFLINE member on reconnect (one wake, no double-consume, cursor monotonic).
- No per-session bridge writes `mailbox.json`/cursor files; the daemon is the single writer (verify no `mailbox.lock` is needed for the send→drain→review path).
- Forensics gate satisfied: confirm whether the dominant crews EPERM site is concurrent WRITES (daemon fixes) or concurrent READS (the `FILE_SHARE_DELETE` rename race — needs member reads ALSO via the daemon, i.e. single-ACCESSOR). The plan must size the rewrite accordingly.
- Audit decision recorded: `history.jsonl` is either accepted best-effort for the pilot or made fail-loud before crews Layer B is retired.

## Context
Synthesis highlights (full detail in `brainstorm-synthesis.md`):
- **Substrate is ~80% shipped, NOT a from-scratch rewrite.** `packages/happy-cli/src/agentComms/` (mailbox.ts + recovery.ts + ingestHandler.ts + the daemon `/agent-comms/send` route) already implements the single-writer-daemon + durable-mailbox model — exactly what `durable-mailbox-channel-wake.md` §6 step 2 describes ("the daemon is the single writer for B's inbox"). This directly answers the prior gap #2 (codex v2 mailbox in-memory, can't survive restart).
- **Decisive correction to the prior brainstorm (Devil's Advocate, source-grounded):** the prior "codex has NO Stop-hook" is STALE for the gim-home/codex fork — codex members have a working hook surface that honors `decision:'block'`. The locks and the hooks are SEPARABLE: drop the locks (safe), keep a thin hook for the gate.
- **Does it actually kill the locks?** Yes for the WRITE path once consume+cursor move into the daemon (in-process `inboxChains` serializer, no cross-process lock). BUT crews' dominant EPERM is READER-induced (the v3.24.5 `FILE_SHARE_DELETE` rename race at `pre-tool-use.js:583`) — a single-WRITER daemon does not fix it unless member READS also route through the daemon (single-ACCESSOR). Forensics decides the rewrite size.
- **Residual risks:** the daemon is a NEW single point of failure with a real Windows-service lifecycle (codexu fork-notes landmines: LocalSystem profile, sc.exe quoting, attached-async-shell silent reap); a daemon crash takes ALL members down at once vs today's localized contention. Price this into the plan.

Decisive open question to resolve before/early in planning (operator-gated): **does the operator accept downgrading the hard turn-block to a cooperative/advisory daemon gate (→ D-002), or is hard `decision:'block'` parity required (→ this D-001 thin-hook design)?** D-001 is the recommendation precisely because it preserves the operator-in-the-loop hard control that is crews Layer B's actual value, while still eliminating the lock fragility the operator asked to kill.
