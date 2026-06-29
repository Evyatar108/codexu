---
overviewTaskId: codex-native-orchestration-crews-replacement-feasibility
---

## Direction
D-001 (round 4) — NO rehost: add ONE thin loopback-IPC inject endpoint to native codex (overlay listener → inject_if_running + maybe_start_turn_for_pending_work), so a single daemon owns coordination files (no locks) + injects mail into native `& codex` members + consumes the AppServerEvent stream for protocol; ZERO crews hooks, ZERO rehost. Validates the operator's challenge: native-inject < rehost.

## Goal
A codex-only crew with ZERO crews `.codex-plugin` Node hooks AND ZERO rehost: members stay NATIVE `& codex` tabs (actors.js:351-487). The fork adds ONE thin loopback-IPC inject endpoint in `codex-rs-overlay` that wraps the EXISTING in-process primitives (`inject_if_running` + `try_start_turn_if_idle` @ core/src/session/inject.rs:18-150; idle-wake `maybe_start_turn_for_pending_work` @ tasks/mod.rs:574-616; `enqueue_mailbox_communication(trigger_turn)` @ input_queue.rs:96-117), gated like remote_session at tui/src/app.rs but WITHOUT E2EE/tunnel/happy-server. A single daemon owns mailbox/cursor/review/crash (no locks), injects mail through that endpoint, and reads each member's AppServerEvent stream (mapping.rs / happy_tap app.rs:1243) for protocol — NOT stdout. Soft gate accepted (inject IS the read; no Stop veto).

## Scope
### In Scope
- Add overlay loopback listener (named pipe/UDS) → inject_if_running / idle-wake; bounded 1-3 line app.rs seam mirroring remote_session minus transport.
- Daemon sole-owns consume+cursor+review+crash files (single-writer kills EPERM/LockTimeout).
- Members stay native tabs (NO rehost into happy-cli runCodex); enforce kind-tag/identity/crash from AppServerEvent stream.
- Drop ALL crews Node hooks.
### Out of Scope
- Rehost into happy-cli runCodex. Hard turn-veto. TUI-stdout scraping. Cross-engine (Claude/Copilot) members. central happy-server. Mid-turn preemption.

## Criteria
- Native member receives daemon-injected mail RUNNING (steer) + IDLE (wake) with NO happy-server; ZERO crews hooks; ZERO EPERM/LockTimeout; kind-tag/identity/crash from AppServerEvent stream; daemon-SPOF recovery; overlay-mostly patch < rehost.

## Context
GO/PARTIAL (operator challenge validated: native-inject < rehost). DA correction: inject primitives are in-process (need Arc<Session>); attach.rs inbound driver requires ~/.happy + remote_session — so the door is a SMALL new local-IPC patch, not free reuse. Copilot lens skipped (xwin-cache snapshot budget). Residuals: daemon SPOF, codex-only mono-engine, soft gate, Windows lifecycle. D-003 (file-ownership-only, keep hooks) is the cheaper fallback if the patch/SPOF isn't worth zero-hooks.
