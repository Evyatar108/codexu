# US-001 Live De-Risk — Findings (`codex-raw-session-happy-daemon-autoconnect`)

**Verdict: GO. The full native-Rust live round-trip PASSES against the canonical
codexu happy-server contract.** A throwaway Rust probe (reqwest + rust-socketio +
the spike-proven crypto crates) created a session, sent an E2EE message, fetched
it back byte-identical, and received the live socket broadcasts — with **no
happy-server changes**. US-002..US-009 can proceed as planned, with the
implementation notes below folded in.

Member: `impl-autoconnect` (COPILOT). Date: 2026-06-21. Branch: `feat/remote-session`.

---

## The single most important correction to the spike

The spike (and the plan's `POST /v1/sessions` framing) assumed a hosted server
with `X-Loopback-Capability` / `X-Tunnel-Authorization` header auth. **The
architecture has since moved to embedded-in-daemon, and the live deployment
detail the spike could not execute is now resolved differently than feared.**

Per `packages/happy-server/AGENTS.md` (Sprint A onward) + the source:
happy-server now runs **embedded inside the happy-cli daemon, one user per
process**, binding **two listeners, BOTH on `127.0.0.1`**
(`packages/happy-cli/src/daemon/dualListenerBinding.ts`,
`packages/happy-server/sources/index.ts` `createApp`):

| Listener | Port (machine.json) | Server auth | Route surface |
|---|---|---|---|
| **tunnel** | `tunnelPort` | **no-op** `authenticateTunnel` (`api.ts:79-80`) | `/v1/sessions`, `/v3/sessions`, pair, push, dev, version, **socket** |
| **loopback** | `loopbackPort` | `X-Loopback-Capability: <~/.happy/loopback-cap.txt>` | `accountRoutes`, `/v2/me/*`, **socket** only |

`assertOperatorIdentityGate` (`index.ts:101-108`) REFUSES to start a tunnel
listener on a non-loopback host — so the tunnel listener is always `127.0.0.1`
and its "no auth" is safe because the loopback bind + the Dev Tunnels gateway
(which strips `X-Tunnel-Authorization` before forwarding) are the operator gate.

### Resolved auth story for the native `codex-happy` client (mirror `daemonClient.ts`)

1. **Discover ports** from `~/.happy/machine.json`
   `{ machineId, tunnelPort, loopbackPort, tunnelId, lastTunnelUrl }`.
2. **Session create + v3 messages + socket** → the **tunnel listener** at
   `http://127.0.0.1:<tunnelPort>` with **NO auth header** (no-op
   `authenticateTunnel`). This is exactly `daemonClient.tunnelFetch` /
   `tunnelSocketIOOptions()` (which sends `auth: {}`).
3. **Loopback `/v2/me/*`** (machine state) → `http://127.0.0.1:<loopbackPort>`
   with `X-Loopback-Capability` (this is `daemonClient.loopbackFetch`).
4. The **daemon must be running** to bind the listeners and write
   `machine.json` + `loopback-cap.txt`. (When absent, ports are stale and the
   listeners are down — the US-006 self-onboard/idempotency story owns starting
   the daemon / discovering live ports.)

**Stale-deployment caveat:** the Windows service currently listening on
`localhost:3005` is an OLDER standalone happy-server using **Bearer-token auth**
(`GET /v1/sessions` → 401 "Missing authorization header"; no `/v2/me/*`). It is
NOT representative of the production embedded dual-listener target. The de-risk
therefore stood up the **canonical codexu `packages/happy-server`** in
tunnel-mode-on-127.0.0.1 (the exact mode the embedded daemon uses) and proved
the round-trip there.

---

## What the live probe proved (all PASS)

Throwaway crate: `.ralph/investigations/codex-raw-autoconnect-us001-live/live-probe`
(reqwest http-only + `rust_socketio` 0.6 + `aes-gcm` 0.10 + `base64`). Standup
script + data dir under the same parent dir. Probe output:

```
[1] socket connect: OK -> http://127.0.0.1:4599/v1/updates/
[2] POST /v1/sessions (no auth): PASS status=200 OK id=cmqnt9s050003ubagpgteg3t0
[3] POST /v3/.../messages (encrypted): PASS status=200 OK
[4] /v3 fetch + AES-256-GCM decrypt byte-identical: PASS
[5] socket received update referencing session: PASS (total updates seen=2)
[verify] OVERALL: PASS
```

- **reqwest** (Rust) does the authenticated-by-loopback-bind `POST /v1/sessions`
  (no header) and `/v3/sessions/:id/messages` cleanly.
- **rust-socketio** (Rust) connects to the live socket and receives the
  seq-ordered `update` broadcasts (`new-session`, `new-message`) for the session.
  This de-risks US-004 (the socket client was the riskiest unknown).
- **Crypto byte-compat is proven on a LIVE message**: an `aes-gcm` 0.10
  `0‖nonce12‖ct‖tag16` dataKey bundle round-trips send → store → fetch → decrypt
  byte-identical (complements the spike's bidirectional KAT cross-check).

---

## Contract details captured (for US-003 / US-004)

- **`POST /v1/sessions`** body (`sessionRoutes.ts:215`, zod):
  `{ tag: string, metadata: string, agentState?: string|null, dataEncryptionKey?: string|null }`.
  **`dataEncryptionKey: null` is hardcoded** in `packages/happy-cli/src/api/api.ts:70`
  (the computed sealed key at 47-50 is NOT sent). **Replicate exactly — do not "fix".**
  Response: `{ session: { id, seq, metadata, metadataVersion, agentState,
  agentStateVersion, dataEncryptionKey, active, activeAt, createdAt, updatedAt, lastMessage } }`.
- **`POST /v3/sessions/:id/messages`** body (`v3SessionRoutes.ts:13-18`):
  `{ messages: [ { content: string, localId: string(min 1) } ] (1..100) }`. The
  server wraps each as `{ t: 'encrypted', c: content }`. Response:
  `{ messages: [ { id, seq, localId, createdAt, updatedAt } ] }`. `localId` is the
  dedup key.
- **Socket.IO** (`socket.ts:56-95`): tunnel-listener socket requires **no token**
  (the loopback-cap check is skipped unless `auth === 'loopback'`).
  `handshake.auth.clientType` defaults to `user-scoped`; `user-scoped` receives the
  `new-session` (`recipientFilter: user-scoped-only`) and session updates. CAS is
  `emit_with_ack('update-metadata'|'update-state', …)` (maps to rust-socketio
  `emit_with_ack`).

### ⚠️ US-004 implementation gotcha — engine.io path needs a TRAILING SLASH

`rust_socketio::ClientBuilder::new(url)` only auto-rewrites the path to
`/socket.io/` when `url.path() == "/"` (socketio `builder.rs::connect_raw`).
A custom path is passed through **verbatim**, and the engine.io handshake then
hits `/<path>?EIO=4…`. The happy-server engine.io is mounted at `/v1/updates/`
and returns **404 without the trailing slash**, **200 with it**. So the Rust
client MUST use `http://127.0.0.1:<tunnelPort>/v1/updates/` (trailing slash).
Confirmed empirically (first probe run failed `EngineIO Error` until the slash
was added).

### Build/dep notes (US-002+)

- `rust_socketio` 0.6 pulls `native-tls` non-optionally → **schannel on Windows**
  (no openssl/vendored-TLS pain). Default features give the blocking client.
- `reqwest` with `default-features=false, features=["json","blocking"]` is
  http-only (fine for `127.0.0.1`); avoids the TLS stack entirely for the local path.
- The throwaway crate built clean in ~60s on the codex LLVM toolchain
  (`source codex/scripts/iteration-env.sh`; lld-link + xwin). No ml64/blake3 needed
  in this dep tree.

---

## Answers to the gate questions

- **Auth story resolved?** Yes — tunnel listener on `127.0.0.1:<tunnelPort>`, no
  auth header (mirror `daemonClient.tunnelFetch` / `tunnelSocketIOOptions`).
  Loopback cap only for `/v2/me/*`.
- **Surprise vs the plan?** The deployment moved to embedded-in-daemon dual
  listeners; `/v1/sessions` is **tunnel-only** (not on the loopback listener), so
  the native local client uses the tunnel listener (loopback-bound), NOT the
  loopback listener. The plan's crypto/contract/socket assumptions otherwise hold.
- **Can US-002..US-009 proceed as planned?** Yes. No happy-server change is
  required. Fold in: (a) port discovery from `machine.json`; (b) tunnel-listener
  no-auth local path; (c) the `/v1/updates/` trailing-slash requirement; (d) the
  `dataEncryptionKey: null` wire quirk.

---

## Evidence index (under this dir)

- `live-probe/` — throwaway Rust probe (`Cargo.toml`, `src/main.rs`); built binary
  at `live-probe/target/debug/us001-live-probe.exe`.
- The standup uses `packages/happy-server/us001-derisk-serve.mts` (throwaway,
  deleted after the de-risk) run in tunnel-mode on `127.0.0.1:4599` over a
  throwaway PGlite data dir.
