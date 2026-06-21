# Phase-0 Feasibility Spike — `codex-raw-session-happy-daemon-autoconnect`

**Verdict: GO for Direction B** (native Rust `codex-happy` overlay + a bounded
upstream-canonical control seam). Both hard gates pass:

- **Probe (a) — control seam: BOUNDED** (compiles; `cargo check -p codex-tui` green).
- **Probe (b) — Rust Happy protocol client: FEASIBLE** with **byte-compatible
  crypto proven bidirectionally** against the real `encryption.ts`, the server
  contract satisfiable by a standard client **with no happy-server changes**, and
  Socket.IO on a `rust-socketio`-compatible version.

**Port-effort size: L** (sizable but tractable — NOT the XL-blocked shape the
brainstorm feared, because the seam turned out far smaller than the raw-`Codex`
assumption).

Spike ran on COPILOT, codex tree at `0.141.0-copilot-api.1`
(`release/0.141.0-copilot-api.1`, HEAD `50ac507cce`). All probe code is
throwaway and lives under this dir; the only upstream edit (probe a) was applied
to the warm checkout, compiled, **measured, and reverted** (`git checkout --`).

---

## The single most important finding (reshapes the brainstorm's seam estimate)

The brainstorm anchored probe (a) on the RAW runtime channel
(`core/src/session/mod.rs` `Codex { tx_sub, rx_event }`, `pub(crate)`,
single-consumer) and named 5 TUI files + a core fan-out, sizing it XL.

**At the 0.141 tree the modern TUI does NOT consume `Codex` directly.** It drives
codex-core through an **in-process app-server** (`codex_app_server::in_process`)
behind `codex_app_server_client::AppServerClient`. That gives a clean, typed,
already-multi-client-capable boundary:

- **Outbound (events → mobile):** ONE chokepoint. The TUI event loop pulls every
  server event at `tui/src/app.rs:1202-1204`:
  ```rust
  app_server_event = app_server.next_event(), if listen_for_app_server_events => {
      Some(event) => app.handle_app_server_event(&app_server, event).await,
  ```
  `AppServerClient::next_event() -> AppServerEvent` is the sole event stream;
  `AppServerEvent` is `#[derive(Debug, Clone)]`. A 3-line tee here fans every
  event to a Happy sink.

- **Inbound (mobile → turns/approvals/interrupt/stop):** the TUI already holds a
  **cloneable** `AppServerRequestHandle` (`app_server.request_handle()`, used at
  `app.rs:637,870`). It issues `ClientRequest::TurnStart` / `TurnSteer` /
  `TurnInterrupt` (`app-server-protocol/.../common.rs:799,805,811`) and resolves
  approvals via `resolve_server_request(request_id, JsonRpcResult)`.

**This is exactly the app-server protocol `happy-cli`'s `codexAppServerClient.ts`
already speaks over JSON-RPC — but in-process.** So Direction B does not invent a
new driver surface; it mirrors the proven one in Rust, in-process, with no ws/stdio
transport and no separate process. The integrated client becomes a *second
in-process app-server consumer*.

---

## PROBE (a) — bounded upstream-canonical control seam

### What was built (throwaway, reverted)
A minimal proof patch on the warm `codex-patched` checkout:

1. **`tui/src/app.rs` (outbound tap):** an `Option<UnboundedSender<AppServerEvent>>`
   field on `App`, initialized `None`, and a tee at the `next_event()` chokepoint:
   ```rust
   Some(event) => {
       if let Some(tap) = app.happy_tap.as_ref() { let _ = tap.send(event.clone()); }
       app.handle_app_server_event(&app_server, event).await
   }
   ```
2. **`app-server-client/src/lib.rs` (inbound enabler):** added
   `resolve_server_request` + `reject_server_request` to the cloneable
   `InProcessAppServerRequestHandle` (it already holds the `command_tx`; the new
   methods send the same `ClientCommand::ResolveServerRequest/RejectServerRequest`
   the main client uses), plus an enum passthrough on `AppServerRequestHandle`.

### Compile result
`cargo check -p codex-tui` (builds `codex-app-server-client` + `codex-tui`):
**`Finished dev profile ... in 6m 18s`**, only pre-existing unrelated warnings.
The seam type-checks and borrow-checks.

### Exact line inventory (`git diff --numstat`)
| File | +added | −removed | nature |
|---|---:|---:|---|
| `app-server-client/src/lib.rs` | 74 | 0 | **purely additive** new `pub` methods (near-zero rebase conflict) |
| `tui/src/app.rs` | 14 | 1 | the only *modification* of existing code (one chokepoint match arm) + field/init |
| **Total** | **88** | **1** | 2 files |

Full diff saved at `probe-a-seam.diff`.

### BOUNDED vs SPRAWLING — **BOUNDED**
- The conflict-creating surface (lines that *modify* existing upstream code) is
  **~6-8 logic lines in ONE file at ONE chokepoint** (the tee), plus the field +
  init. Everything else (74 lines) is *additive* new methods that only conflict if
  upstream inserts code at the identical spot.
- In production the real seam shrinks further: the outbound tap (~5 lines) + one
  `codex_happy::attach(tap_rx, request_handle)` call in `run()` (~3 lines). The
  74 additive handle lines collapse to the **one** `resolve_server_request`
  actually needed for approvals (~31 lines, or less if routed through the existing
  `AppServerSession::resolve_server_request` already at `app_server_session.rs:1136`).
- **All Happy logic** (protocol client, event→envelope mapping, mobile→ClientRequest
  mapping, attach orchestration) lives in the overlay crate `codex-happy`
  (`codex-rs-overlay/`) — **zero conflict surface**.
- This is **comparable to or smaller than** existing fork seams in
  `patch-surface.md` (remote-control 3-layer disable, stream-cut diagnostics loop
  wrap, Copilot header injection). Registerable in §14/§15 as a single
  "secondary app-server event sink + request-handle resolve" invariant.

### The injection/fan-out mechanism that worked
- **Fan-out:** clone `AppServerEvent` (it's `Clone`) at the `next_event()`
  chokepoint into an `mpsc` sink. (Do NOT clone the underlying `mpsc::Receiver` —
  it is single-consumer; tee at the consumption point instead.)
- **Inject:** the cloneable `AppServerRequestHandle` (already `#[derive(Clone)]`)
  carries a `command_tx: mpsc::Sender<ClientCommand>`; turns/interrupt/steer ride
  `request()`; approvals ride the added `resolve_server_request`. No new channels,
  no core edit, no `Codex` exposure.

### Open seam risk (bounded, not blocking)
- **Approval double-answer:** the local TUI ALSO receives the `ServerRequest`
  (approval) and renders its own UI. Two clean options: (i) rely on the
  app-server's request-id dedup (first `resolve` wins, second is a no-op — to be
  verified), or (ii) when Happy is attached, suppress the local approval UI. Either
  is a handful of lines, not sprawl.

---

## PROBE (b) — native Rust Happy protocol client round-trip

### (b.1) Crypto byte-compat — **PROVEN, bidirectional** (the make-or-break)
A throwaway standalone Rust crate (`cryptocompat/`) implements all 5
`packages/happy-cli/src/api/encryption.ts` primitives and cross-checks against the
**real `encryption.ts`** (run via `tsx` + `tweetnacl`), in BOTH directions.

| Primitive | Rust crate | Rust→Node decrypt | Node→Rust decrypt |
|---|---|---|---|
| `libsodiumPublicKeyFromSecretKey` (`sha512(seed)[0:32]` → X25519 pub) | `crypto_box` 0.9 `SecretKey::from().public_key()` + `sha2` | **PASS** | **PASS** |
| `libsodiumEncryptForPublicKey` (ephPub‖nonce‖box, custom bundle) | `crypto_box` 0.9 `SalsaBox` | **PASS** | **PASS** |
| `encryptLegacy` (secretbox; nonce‖ct) | `xsalsa20poly1305` 0.9 | **PASS** | **PASS** |
| `encryptWithDataKey` (AES-256-GCM; ver‖nonce‖ct‖tag) | `aes-gcm` 0.10 `Aes256Gcm` | **PASS** | **PASS** |
| `authChallenge` (Ed25519 detached sign) | `ed25519-dalek` 2 | **PASS** | **PASS** |

`[verify] OVERALL: PASS` on both legs. The two subtle bits both replicate exactly:
the **libsodium `sha512(seed)[0:32]` X25519-secret derivation** (the TS comment's
"tweetnacl doesn't do this by default" quirk) and the **custom sealed-box bundle
layout** (explicit random 24-byte nonce, NOT a libsodium derived-nonce sealed box).
Evidence files: `cryptocompat/src/main.rs`, `cryptocompat/crosscheck.mts`,
`rust_out.txt`, `node_out.txt`.

### (b.2) Session HTTP contract (`POST /v1/sessions`) — standard, NO server changes
`sessionRoutes.ts:215` `POST /v1/sessions` body schema is plain JSON:
`{ tag: string, metadata: string, agentState?: string, dataEncryptionKey?: string }`;
response is plain JSON. `dataKey` vs `legacy` selection happens **client-side**
(`api.ts:getOrCreateSession`): for `dataKey`, seal a random AES-256 key to the
account pubkey via `libsodiumEncryptForPublicKey` (proven above), prepend a `0`
version byte, send as `dataEncryptionKey`. A `reqwest` client replicates this
trivially. **No server protocol change is implied.**

Auth model (`api.ts:80`): `app.authenticate` is either `verifyLoopbackCapability`
(local; header `X-Loopback-Capability: <~/.happy/loopback-cap.txt>`) or
`authenticateTunnel` (cross-machine; `X-Tunnel-Authorization: tunnel <jwt>` via the
Dev Tunnels gateway). Both are simple headers a Rust client sets directly.

**Live attempt:** server reachable (`GET /` → 200 on `localhost:3005` and
`https://happy.evyatar.dev`). A direct `GET /v1/sessions` with the user's
`X-Loopback-Capability` returned **401** — the running `:3005` listener is in
**tunnel-auth mode** (single listener bound `0.0.0.0:3005`; loopback vs tunnel is a
start-time `auth:` option), and the server most likely runs as a LocalSystem
Windows service reading its cap file from the service profile, not the user's
`~/.happy`. This is an **environment credential/mode detail, not a protocol
limitation** — the request/response shapes and header auth are standard. (A full
live create was not completed end-to-end for this reason; the contract is
nonetheless fully characterized.)

### (b.3) Socket.IO (`/v1/updates`) — REACHABLE, `rust-socketio`-compatible
- Server is **`socket.io ^4.8.1` (EIO=4)**; client is `socket.io-client ^4.8.1`.
- Engine.IO handshake `GET http://localhost:3005/v1/updates/?EIO=4&transport=polling`
  → **200**: `0{"sid":"…","upgrades":["websocket"],"pingInterval":15000,
  "pingTimeout":45000,"maxPayload":1000000}`. Endpoint live, websocket upgrade
  advertised.
- The client wire (`apiSession.ts`): `io(url,{ path:'/v1/updates', transports:['websocket'] })`;
  receives seq-ordered `update`, emits `emitWithAck('update-metadata'|'update-state', …)`
  for **optimistic-concurrency (CAS)**, `volatile.emit('session-alive')`,
  `rpc-request` handling, smart-reconnect.
- **`rust-socketio` covers Socket.IO v4 + engine.io v4 over websocket and
  `emit_with_ack`** (CAS maps directly). Feasible. The behavior-parity surface
  (seq-gap detection, reconnect/backfill, volatile keepalive, RPC manager) is the
  largest remaining *engineering* chunk — not a feasibility blocker.

### Port-effort sizing
| Component | Size | Note |
|---|---|---|
| Crypto (NaCl box/secretbox + AES-GCM + Ed25519 + sha512 quirk) | **M** | proven in-spike; crate choices fixed |
| `POST /v1/sessions` + `dataKey`/`legacy` + auth headers | **S** | plain JSON + reqwest |
| Socket.IO client (seq `update`, CAS metadata/state, msg-consumption ack, session-alive, reconnect, RPC) | **M–L** | the behavior-parity-critical part; `rust-socketio` base |
| `@slopus/happy-wire` serde structs + drift guard | **M** | perpetual two-impl tax |
| Axis-1 glue (codex `Event` ↔ Happy envelope; mobile ↔ `ClientRequest`) | **M** | overlay-resident |
| **Full B (protocol client) — excluding the now-small seam** | **L** | |

---

## GO / NO-GO decision (the disconfirming check)

- Seam BOUNDED? **YES** (compiles; ~6-8 modified lines at one chokepoint + additive
  handle methods; all logic overlay-resident).
- Rust client round-trips with byte-compatible crypto and **no happy-server
  changes**? **YES** for crypto (proven) and the contract (standard headers + JSON +
  Socket.IO v4); the only un-executed live step (POST create / live socket connect)
  was blocked by an **environment auth-credential detail**, not a protocol gap.
- Port effort acceptable? **YES — L**, not XL-blocked.

→ **GO: Direction B.** Because Axis-1 (the seam) is shared by B and D and it came
in BOUNDED + compiling, **D (the fallback) is also unblocked** — but B's only
distinctive cost (the Rust protocol port) is now sized **L** with the crypto proven,
so the fallback is not needed on feasibility grounds. No seam-NO-GO (which would
have been fatal to both B and D) was observed.

---

## Top 5 things the follow-on PLAN member must know

1. **Target the in-process app-server-client boundary, NOT raw `Codex.rx_event`.**
   Outbound = tee `AppServerClient::next_event()` at `tui/src/app.rs:~1204`
   (`AppServerEvent` is `Clone`). Inbound = the already-cloneable
   `AppServerRequestHandle` (`request()` for `TurnStart/TurnSteer/TurnInterrupt`;
   add/route `resolve_server_request` for approvals). This is the same protocol
   `codexAppServerClient.ts` drives — mirror it in-process. Upstream seam ≈ a tee +
   one additive handle method + a ~3-line `attach()` in `App::run()`; everything
   else in overlay crate `codex-happy`.

2. **Crypto crate set is proven byte-compatible (use these exact ones):**
   `crypto_box` 0.9 (`SalsaBox`, and `SecretKey::from(sha512(seed)[0:32]).public_key()`
   for the libsodium pubkey quirk), `xsalsa20poly1305` 0.9 (legacy secretbox),
   `aes-gcm` 0.10 (`Aes256Gcm`, dataKey bundle `0‖nonce12‖ct‖tag16`),
   `ed25519-dalek` 2, `sha2` 0.10. Bundle layouts are documented in
   `cryptocompat/src/main.rs` and validated against `encryption.ts`.

3. **Socket.IO = v4 / EIO=4 → use `rust-socketio`** (websocket transport +
   `emit_with_ack` for the `update-metadata`/`update-state` CAS). `path=/v1/updates`,
   `transports:['websocket']`. The seq-ordered `update` + reconnect/backfill +
   `session-alive` volatile keepalive + `rpc-request` manager are the parity work.

4. **Auth is header-only:** local = `X-Loopback-Capability: <~/.happy/loopback-cap.txt>`;
   cross-machine = `X-Tunnel-Authorization: tunnel <connect-jwt>` (Dev Tunnels
   gateway, cross-machine-only per fork tenet). The integrated client uses the
   loopback header against the local happy-server; the running server's auth MODE
   (loopback vs tunnel) is a start-time option — confirm which the deployment runs.

5. **Carry the three known costs into the plan** (all real, none fatal):
   (a) approval double-answer coordination (TUI vs mobile — dedup or suppress);
   (b) the perpetual `@slopus/happy-wire` two-implementation drift tax (add a
   version-pin guard/test); (c) NEW audited network egress *inside* codex-core
   (register happy-server + Dev-Tunnels in `scripts/audit_network_calls.sh` +
   `runtime_audit_allowlist.txt` + `patch-surface.md` §4) and the E2EE-key-ownership
   shift into the network-audited binary.

---

## Evidence index (all under this dir)
- `probe-a-seam.diff` — the throwaway seam patch (reverted from the tree).
- `probe-a-check.log` — `cargo check -p codex-tui` output (Finished, green).
- `cryptocompat/` — standalone Rust crypto probe (`src/main.rs`, `Cargo.toml`).
- `cryptocompat/crosscheck.mts` — Node cross-check against the real `encryption.ts`.
- `rust_out.txt` / `node_out.txt` — the cross-checked artifacts.
