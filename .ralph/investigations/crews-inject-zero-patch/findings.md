# crews-inject-zero-patch — can a LOCAL daemon inject into a running native `& codex` member with ZERO codex patch?

**Date:** 2026-06-29 · **Mode:** read-only source investigation · **codex submodule HEAD:** `95d4a981069ecb389a96618c33fa8f7cbb718e17`
**cargo metadata preflight:** PASS (exit 0, valid JSON, workspace parses) from `codex/external/repos/codex-patched/codex-rs`.

## VERDICT

**Mixed — both prior claims are right about different constraint sets. Net answer to the literal contested question: PATCH-REQUIRED.**

- **The inject/steer/idle-wake primitives are strictly IN-PROCESS** (need `Arc<Session>` / `CodexThread`). Round-4 brainstorm @26becdba is correct.
- **They are reachable ZERO-patch over app-server v2 RPC** (`turn/start`, `turn/steer`, `thread/inject_items`). Spike-us000-i1 "verdict A" is correct *about the RPC layer*.
- **BUT a native interactive `& codex` member exposes NO local control socket.** The only inbound path into a running TUI is the `remote_session` overlay, which requires `~/.happy` creds **and a reachable per-machine happy-server bound on `127.0.0.1`**. So **with happy-server EXCLUDED** (the question's constraint), there is no inbound seam → a **small overlay loopback endpoint patch is required**. Tunnel + E2EE *can* be dropped (loopback); the happy-server role itself cannot, without a patch.

## The injection seam is in-process (round-4 confirmed)

- `Session::inject_if_running(&self, …)` takes `&self`, locks `self.active_turn`, appends to `input_queue` — `core/src/session/inject.rs:19-42`. Idle-wake `try_start_turn_if_idle(self: &Arc<Self>, …)` reserves the turn and `start_task` — `inject.rs:45-138`. No idle-wake patch needed; the gate exists.
- Thread bridge: `CodexThread::inject_if_running` `core/src/codex_thread.rs:298-302`, `try_start_turn_if_idle` `:318-322`, `inject_response_items` `:456`. All require the live `Codex`/`Session` Arc — impossible for an out-of-process caller to hold.

## …but it IS exposed over app-server v2 RPC with zero codex change (spike confirmed)

- `turn/steer` → `turn_steer_inner` → `thread.steer_input(...)` (active-turn input queue) — `app-server/src/request_processors/turn_processor.rs:137,810-840`.
- `thread/inject_items` → `inject_response_items` → `inject_if_running` — `turn_processor.rs:118-122,764-787`.
- `turn/start` → `turn_start_inner` (`:101,405`) starts a fresh turn when idle.

So "TurnStart/TurnSteer reach the queue with zero codex patch" is TRUE — over the app-server transport.

## The decider: a native `& codex` TUI has no local control surface

- The interactive TUI's app-server is **in-process**; external drive is the cloneable `app_server.request_handle()` — only the overlay holds it (`tui/src/app.rs:1027-1043`). It is NOT bound to any local port/pipe. (The `UnixListener`/NamedPipe hits in `tui/src/lib.rs:2251`, `ide_context/ipc.rs:886-911` are test-only or **outbound IDE-client** pipes, not an inbound control listener.)
- The only inbound-to-TUI path is `codex_happy::attach::maybe_attach(... request_handle)` gated on `Feature::RemoteSession` — `app.rs:1027-1043`. It returns `None` unless: `HAPPY_CURRENT_SESSION_ID` unset (`attach.rs:188-205`), `~/.happy/access.key` present (`AttachError::NoCredentials`), and `~/.happy/machine.json` carries a **reachable per-machine happy-server tunnel listener** (`AttachError::NoDaemon`, `:119-136`). The overlay then Socket.IO-connects to `http://127.0.0.1:<tunnelPort>` (`auth.rs:8-12`, `api.rs:1-6`). codex-happy is a **client**; the happy-server is the listener.

**Consequence:** with `happy-server` forbidden, nothing accepts the daemon's TurnSteer for a native TUI → must add a small loopback control endpoint (overlay-only, ~zero conflict) → **PATCH-REQUIRED**. Tunnel/E2EE drop is fine (loopback); the server role does not.

**ZERO-patch alternative (not a native `& codex`):** daemon spawns `codex app-server` over stdio and drives RPC directly — but crews launches native `& codex` TUIs, so this changes the member shape.

## Cost: ~1 read-only investigation turn; smallest patch = overlay loopback endpoint in `codex-rs-overlay/codex-happy` calling `request_handle` (Option 1, zero upstream surface).
