# Plan — daemon's own machine socket is Unauthorized in public mode

Task: `happy-public-mode-daemon-machine-socket-unauthorized`
Worktree: `D:/harness-efforts/codexu/.worktrees/plan-happy-daemon-socket`
Branch: `ralph/plan-happy-daemon-socket` (off `main` @ `8f063076`)
Repo root for all edits: **codexu** (`packages/happy-cli` + `packages/happy-server`). No submodule edits.

---

## 1. Goal & framing

In **public mode** the happy-cli daemon binds a **dual listener** (one process, two embedded
happy-server instances). The daemon's OWN machine realtime client (`[API MACHINE]`) connects to the
**public/tunnel** listener (`http://127.0.0.1:<tunnelPort>`) but presents **no device proof**, so the
public listener rejects the Socket.IO handshake and the client loops forever:

```
[API MACHINE] Connecting to http://127.0.0.1:51371
[API MACHINE] Connection error: Unauthorized
[API MACHINE] Attempting reconnect     (~every 3s, from daemon boot)
```

Effect: the machine's realtime presence never establishes → the Happy app shows a realtime **error**
badge (the HTTP-fetched machine list still shows "last seen just now", confirming it is specifically
the daemon's own realtime socket that is broken). This is **pre-existing and specific to public mode**;
in Dev-Tunnels/tunnel mode the tunnel listener runs `auth: 'tunnel'` (no handshake gate) so the
daemon's own socket connects fine.

**Goal:** in public mode, the daemon's own machine client (and, by the same root cause, its session
clients) must authenticate successfully to the embedded server **without weakening the public listener's
fail-closed device-proof boundary against remote (cloudflared) clients**, and **without changing
behavior in non-public modes**.

---

## 2. HARD CONSTRAINTS (do not violate)

1. **Do NOT weaken the public listener's device-proof auth for the app-facing (remote) boundary.**
   Remote clients arriving via cloudflared must still present a valid Ed25519 device proof + CF-Access
   edge headers. The fix is about the daemon's OWN co-resident internal client, not remote clients.
2. **Non-public modes unchanged.** Tunnel-only / loopback-only behavior (`auth: 'tunnel'` /
   `auth: 'loopback'`) must be byte-for-byte identical after the change.
3. **Single-user, one-process posture.** No per-request `userId` threading (happy-server AGENTS.md hard
   rule); the embedded server is single-operator. Do not add multi-tenant plumbing.
4. **The public HTTP route plane (US-005 default-deny device-proof) is out of scope.** Touch only the
   Socket.IO **handshake** auth. Do not alter `httpGuard`/`bodyHashGuard`/route allowlist.
5. **Markdown-only for this job.** (This is a plan; the impl job that consumes it makes the edits.)

---

## 3. Verified research (all cites confirmed against files in this worktree)

### 3.1 Where the machine-socket URL is chosen (task deliverable #4)

- **`packages/happy-cli/src/daemon/daemonClient.ts` → `tunnelSocketIOOptions()` (line 143).**
  Returns `{ url: await getTunnelLocalBaseUrl(), auth: {} }`. `getTunnelLocalBaseUrl()` →
  `http://127.0.0.1:${state.tunnelPort}` (the **public** listener in public mode). The URL/auth is chosen
  **per-connection** — every connect/reconnect re-invokes `tunnelSocketIOOptions()`. It is a **shared
  helper**: used by both the machine client and the session client.
- **`packages/happy-cli/src/api/apiMachine.ts`** — `ApiMachineClient`:
  - `connectToTunnelListener()` (line 355) and `refreshTunnelAuth()` (line 342) both call
    `daemonClient.tunnelSocketIOOptions()` and then `buildSocket(url, auth)`.
  - `buildSocket()` (line 268): `io(url, { transports: ['websocket'], auth, path: '/v1/updates',
    reconnection: false, autoConnect: false })`. Note **`reconnection: false`** (a fresh socket per
    reconnect — the observed 3s spam comes from `startSmartReconnect()` on `connect_error`).
  - `auth` = `socketAuthBase()` (`{ token, clientType: 'machine-scoped', machineId, happyClient }`)
    merged with `options.auth` (empty). **No device proof, no loopback capability** → public listener
    rejects.
- **`packages/happy-cli/src/api/apiSession.ts`** — `ApiSessionClient` has the **identical latent bug**:
  `tunnelSocketIOOptions()` at line 365, `buildSocket(url, auth)` at line 374, `io(url, {...})` at line
  263 (same shape, plus `withCredentials: true`). Session realtime is also broken in public mode; the
  webapp bring-up only surfaced the machine client because no session was running.

### 3.2 The two embedded listeners are INDEPENDENT io servers (decisive architecture fact)

- **`packages/happy-cli/src/daemon/dualListenerBinding.ts`** binds **two** listeners via two `create()`
  calls: tunnel/public on `tunnelPort` (`auth: options.publicListener?.auth ?? 'tunnel'`, line ~76) and
  loopback on `loopbackPort` (`auth: 'loopback'`, line ~85). Each `create()` builds a **separate Fastify
  app + separate Socket.IO `Server` (`io`) + separate `EventRouterSink`**.
- **Embedded mode has NO Redis adapter.** `packages/happy-server/sources/app/api/socket.ts` →
  `configureRedisStreamsAdapter()` returns `undefined` when `REDIS_URL` is unset (embedded default). So
  each io server's socket.io **rooms are isolated** — there is no cross-io-server socket routing.
- **Presence/updates DO cross both listeners** via a module-scoped bus:
  `packages/happy-server/sources/app/events/eventRouter.ts` → `sharedEventRouterBus` (module-scoped
  `EventEmitter`, ~line 264). Each `EventRouterSink` subscribes (`bus.on('socket-event', …)`) and
  re-emits into ITS OWN io server. So a machine-online ephemeral
  (`buildMachineActivityEphemeral`, `recipientFilter: user-scoped-only`) published on either listener
  fans out to the app's `user-scoped` room on the other listener.
- **RPC does NOT cross listeners:** `packages/happy-server/sources/app/api/socket/rpcHandler.ts` routes
  `io.in(rpcRoom(method)).fetchSockets()` + `target.emitWithAck('rpc-request', …)` on **one** io server.
  Cross-replica RPC relies on the Redis cluster adapter, which is absent embedded. Daemon machine RPC
  handlers (`spawn-happy-session`, `spawn-in-worktree`, `fork-into-worktree`,
  `spawn-session-from-session`, `resume-happy-session`, `stop-session`, `requestShutdown`) register via
  `socket.join(rpcRoom(method))` on **whichever io server the daemon connects to**. If the daemon and the
  app are on **different** io servers, the app's `rpc-call` finds an **empty** room → "RPC method not
  available".

  → **Consequence:** the embedded server is designed for daemon **and** app to co-locate on the **same**
  (tunnel/public) io server. That is why RPC has no cross-listener bridge, why the client method is named
  `connectToTunnelListener`, and why **no socket client connects to the loopback listener today** (grep:
  only `tunnelSocketIOOptions` exists; the loopback listener serves only HTTP `loopbackFetch`).

### 3.3 What the public listener's Socket.IO handshake requires

- **`packages/happy-server/sources/app/api/socket.ts` → `createSocketAuthMiddleware()` (line 57).**
  Thin dispatcher. `auth === 'loopback'` → `makeLoopbackSocketVerifier(paths)` on
  `socket.handshake.headers`. `auth === 'public'` → `verifyPublicSocketHandshake(publicAuthRuntime,
  socket.handshake.headers)` (lines 82-90). Tunnel mode has no handshake gate.
- **`packages/happy-server/sources/app/api/auth/remoteDeviceAuth.ts`** —
  `verifySocketHandshake(headers)` (line 480) requires **both**: (1) `checkEdgeAccess(edge, headers)`
  (CF-Access edge headers, mandatory) AND (2) a valid `x-happy-device-proof` header — an Ed25519
  device-proof envelope over the fixed `SOCKET_PROOF_METHOD`/`SOCKET_PROOF_PATH`, from a **pinned** device
  key, with a **single-use nonce**.
- **`packages/happy-server/sources/app/api/auth/loopbackCapability.ts`** —
  `makeLoopbackSocketVerifier(paths)` reads `headers['x-loopback-capability']` and compares it to the
  on-disk secret at `paths.loopbackCap` (cached by mtime via `makeLoopbackTokenReader`). It does **not**
  check remote address — its security is **token secrecy**.

### 3.4 The loopback capability path is ALREADY wired to the public listener

- **`packages/happy-server/sources/app/api/api.ts` → `configureApi()`** calls
  `startSocket(typed, tofuConfig, { auth: options.auth, paths: options.paths, publicAuthRuntime })`.
  `options.paths` (incl. `loopbackCap`) is passed **regardless of `auth` mode**, so the **public**
  listener's `startSocket`/`createSocketAuthMiddleware` already has `socketOptions.paths.loopbackCap`
  available. `dualListenerBinding` passes the same `paths` to both `create()` calls. **No new plumbing is
  needed** for the public listener to verify a loopback capability.
- The CORS `allowedHeaders` on both the Fastify CORS plugin (api.ts) and the Socket.IO server (socket.ts
  `startSocket`) already include `X-Loopback-Capability`, `X-Happy-Device-Proof`, `CF-Access-Client-Id`,
  `CF-Access-Client-Secret`.

### 3.5 Client already has the loopback capability in hand

- **`packages/happy-cli/src/daemon/daemonClient.ts`** — `readCapability()` reads the local
  `loopback-cap.txt` secret; `getLoopbackBaseUrl()` returns `http://127.0.0.1:${state.loopbackPort}`;
  `loopbackFetch()` already sends `X-Loopback-Capability: <cap>` for local HTTP calls. `ensureDaemonReady()`
  waits until the capability exists, so it is available before any client connects.
- **Public-mode detection signal (clean, persisted):** `packages/happy-cli/src/persistence.ts` line 108 —
  `MachineLocallyPersistedState.publicListener?: { hostname, tunnelName }`, set in
  `packages/happy-cli/src/fork/forkHooks.ts` (lines ~150-173) **only** when `isPublicTunnelOptedIn()` is
  true, and passed to `dualListenerBinding` as `publicListener: { auth: 'public', publicAuth }` (line
  ~243). `daemonClient` already reads machine state, so it can detect public mode via
  `state.publicListener !== undefined` with **no new plumbing**.

---

## 4. Fix-direction evaluation & recommendation

The task offered **(a)** "route the daemon's own client to the loopback **listener**" (preferred if
clean) and **(b)** "authorize local/loopback-originating connections on the public listener" (weaker;
likely reject). Source analysis shows the clean/complete answer is a **safe, scoped realization of (a)'s
intent that keeps the daemon on the public listener** — described below as **Option B2**. Full matrix:

### Option A — daemon → loopback **listener** — REJECTED (incomplete)

Moving the machine client to `127.0.0.1:<loopbackPort>` (auth: loopback capability) authenticates fine
and, because presence crosses via `sharedEventRouterBus` (§3.2), the app's presence badge **would** go
healthy. **But** the daemon would then register its RPC handlers on the **loopback** io server while the
app calls RPC on the **public** io server — and RPC does **not** cross listeners (§3.2). So **remote
app→daemon session control** (`spawn-happy-session`, `stop-session`, `fork-into-worktree`, …) would be
broken in public mode. That is a headline Happy feature (drive sessions from the phone). Making Option A
complete requires a **new cross-listener RPC bridge** in happy-server (request/response relay across two
in-process io servers with correlation ids) — significant, security-sensitive machinery. Rejected as not
"clean". (Note: app→daemon RPC is already 100% broken pre-fix because the daemon never connects anywhere,
so Option A does not *regress* RPC — but it also does not *fix* it, and it silently forecloses the
simpler co-location fix.)

### Option B-naive (task's literal (b)) — authorize by loopback remote-address — REJECTED (unsafe)

cloudflared forwards the public hostname to `127.0.0.1:<tunnelPort>`, so **both** the daemon's own client
**and** every remote-via-cloudflared client appear to originate from `127.0.0.1` at the socket layer. A
"trust the loopback remote-address" exemption on the public listener would therefore authorize **any
remote attacker**, defeating device-proof. Reject.

### Option B2 — **RECOMMENDED** — daemon stays on the public listener, authenticated by the loopback **capability token**

Keep the daemon's machine (and session) clients connected to the tunnel/public listener URL (co-located
with the app → **RPC + presence both work**, no new bridge), but present the **`X-Loopback-Capability`**
header on the Socket.IO handshake **in public mode**. The public listener's socket auth accepts a valid
loopback capability **OR** a device proof.

This realizes the task's **(a) intent** — "the daemon is co-resident and already trusted; use the
loopback trust plane, not the public device-proof plane" — using the loopback **capability** (the
existing co-resident trust credential) on the **correct listener** (the app's), thereby avoiding Option
A's RPC-isolation flaw.

**Why it satisfies the hard constraints:**

- **Does not weaken the remote boundary.** The loopback capability is a local `0600` secret at
  `loopback-cap.txt`, regenerated per daemon start, **never transmitted to remote clients**. A remote
  (cloudflared) client cannot obtain or forge it; if it sends no/invalid `x-loopback-capability` it
  **falls through to device-proof** (fail-closed). Only a process with local file read (i.e., an
  already-compromised host) could present it. Security rests on **token secrecy**, which is why gating on
  remote-address (unreliable under cloudflared, §Option B-naive) is neither needed nor helpful here —
  document this explicitly for the reviewer.
- **Socket-handshake only.** The HTTP device-proof route plane (US-005 default-deny) is untouched.
- **Non-public modes unchanged.** Tunnel listener stays `auth: 'tunnel'` (no handshake gate); the extra
  header is only *attached* in public mode (gated on `state.publicListener`) and only *consulted* by the
  public listener.
- **Minimal & already-plumbed.** `paths.loopbackCap` already reaches the public listener (§3.4);
  `makeLoopbackSocketVerifier` already exists; the client already has `readCapability()` and public-mode
  detection (§3.5).

**Precedence in the public branch:** check loopback capability **first**; if present-and-valid, accept
(co-resident); else run the existing `verifyPublicSocketHandshake` device-proof path unchanged. A missing
or invalid capability must never short-circuit device-proof.

### Option C — daemon self-enrolls a device identity + real device-proof — DOCUMENTED FALLBACK

The daemon self-enrolls its own Ed25519 key via `PublicAuthRuntime.enrollDevice()` at startup and
connects to the public listener presenting CF-Access edge headers + a freshly-signed single-use
device-proof envelope per handshake (its `reconnection: false` sockets already mint a fresh connection
per reconnect, matching single-use nonce semantics). This keeps the public plane "device-proof only" (no
new accepted-credential class), at the cost of materially more code: wire a device-proof **producer** into
the machine/session clients, supply the CF-Access service-token headers the daemon holds, and self-enroll
at boot. **Recommend only if a reviewer rejects broadening the public handshake's accepted-credential
set.** Feasibility is confirmed (`enroll()`/`enrollDevice()` + `verifySocketHandshake` exist), but B2 is
strictly smaller and equally safe against the remote boundary.

**Recommendation: implement Option B2.** Keep Option C in the plan as the documented fallback.

---

## 5. Scope decision — fix the shared helper (machine + session)

Because both clients route through `daemonClient.tunnelSocketIOOptions()` (§3.1), the correct, minimal fix
lives in that shared helper plus a small `buildSocket` signature extension in each client to forward
`extraHeaders`. This fixes the reported machine-client symptom **and** the identical latent session-client
bug in one place. The plan treats the **machine client as primary/required** (matches the task's
acceptance) and the **session client as same-root-cause coverage** (verify no regression; assert it also
attaches the header in public mode).

`socket.io-client` note: `extraHeaders` is honored on the initial HTTP upgrade in **Node** for the
`websocket` transport (unlike browsers), so the capability header does reach the server handshake. The
`auth` object (token/clientType/machineId) stays separate and is read from `socket.handshake.auth`.

---

## 6. Stories (small, testable; see `stories-outline.md` for AC/deps/ship order)

- **S1 (server):** Accept a valid loopback capability as a co-resident credential on the **public**
  listener's Socket.IO handshake (device-proof otherwise unchanged; fail-closed).
- **S2 (client helper):** `tunnelSocketIOOptions()` returns `extraHeaders` with the loopback capability
  **in public mode only** (gated on `state.publicListener`); non-public returns unchanged.
- **S3 (machine client):** Thread `extraHeaders` from the helper through `apiMachine.buildSocket()` into
  the `io(url, …)` options. Primary acceptance: no Unauthorized loop in public mode.
- **S4 (session client):** Same `extraHeaders` threading in `apiSession.buildSocket()` (same root cause;
  regression-guard non-public).
- **S5 (verification):** Unit/integration coverage + live end-to-end verification (restart daemon in
  public mode; grep the daemon log).

---

## 7. Acceptance criteria & verification

### 7.1 Automated (targeted)

Run from repo root (Windows/Git Bash) — file-scoped per happy-cli AGENTS.md §Testing:

```
# happy-server (public handshake accepts loopback cap; device-proof still enforced)
pnpm --filter happy-server exec vitest run \
  sources/app/api/socket.spec.ts \
  sources/app/api/auth/remoteDeviceAuth.spec.ts \
  sources/dualListenerBinding.test.ts

# happy-cli (shared helper + machine/session client attach cap in public mode; non-public unchanged)
pnpm --filter happy exec vitest run \
  src/daemon/daemonClient.test.ts \
  src/daemon/dualListenerBinding.test.ts \
  src/api/socketTunnelAuth.test.ts \
  src/api/socketReady.preconnect.test.ts \
  src/api/apiMachine.keepalive.test.ts

# Broader integration (needs prerequisites; opt-in)
RUN_INTEGRATION=1 npm_config_script_shell=bash pnpm --filter happy test  # src/daemon/daemon.integration.test.ts
```

New/updated test assertions:
- **Server:** public handshake with a valid `x-loopback-capability` header → connection accepted; with
  an invalid/absent capability AND no device-proof → rejected (`Unauthorized`); with a valid device-proof
  and no capability → still accepted (device-proof path unchanged). Loopback and tunnel listeners
  unchanged.
- **Client:** `tunnelSocketIOOptions()` returns `extraHeaders['X-Loopback-Capability']` when
  `state.publicListener` is set, and **omits** it otherwise; `buildSocket` forwards `extraHeaders` into
  `io(url, …)` for both machine and session clients.

### 7.2 Live end-to-end (the decisive check)

1. Restart the daemon in **public mode** (e.g. `HAPPY_TUNNEL_PROVIDER=cloudflare` with public opt-in) so
   `machine.json` has `publicListener` + distinct `tunnelPort`/`loopbackPort`.
2. Grep the daemon log for the machine client result:
   - **PASS:** `[API MACHINE] Connected to server` appears once and **stays** connected; **no** repeating
     `[API MACHINE] Connection error: Unauthorized` / `Attempting reconnect` loop.
   - **FAIL:** the `Unauthorized` reconnect loop persists.
3. In the Happy app, confirm the machine's realtime presence badge is **healthy** (not "error").
4. From the app, invoke a machine RPC (e.g. spawn a session) and confirm it succeeds — proving the daemon
   is co-located with the app on the public io server (Option B2's RPC guarantee; would have silently
   broken under Option A).

---

## 8. Risks & open questions

1. **RPC cross-listener isolation (the reason Option A was rejected).** Documented in §3.2/§4. Option B2
   sidesteps it by keeping the daemon on the app's io server. If the impl deviates toward the loopback
   listener, it MUST also add a cross-listener RPC bridge or it will silently break remote session
   control. Include the S7.2 step-4 RPC check to catch this.
2. **Session-client parallel bug (`apiSession.ts:263/365/374`).** Same root cause; fixed by the shared
   helper. Flagged as S4 so it is verified rather than silently changed. If the impl wants to keep scope
   to the machine client only, it must special-case the helper — more code and it leaves session realtime
   broken in public mode; not recommended.
3. **Broadening the public handshake's accepted-credential set.** Option B2 adds a second accepted
   credential (a static local bearer token) to a plane that is otherwise nonce-based single-use
   device-proof. Mitigation: token secrecy (`0600`, per-start regeneration, never sent remotely) and
   strict fail-through to device-proof on absent/invalid capability. If a reviewer rejects this on
   principle, fall back to **Option C** (self-enrolled device-proof), which introduces no new credential
   class. Call this out in the impl PR description for explicit reviewer sign-off.
4. **`extraHeaders` on the `websocket` transport.** Valid in Node (not browsers). Both clients use
   `transports: ['websocket']`, so no polling fallback is involved; the header rides the upgrade request.
   Add a client unit test asserting the option is present rather than relying on runtime behavior alone.
5. **Loopback capability availability/rotation.** `ensureDaemonReady()` guarantees the capability exists
   before clients connect; `loopbackFetch` already handles a 401 by `invalidateCapability()` + refresh.
   For the socket path (no HTTP status), rely on `readCapability()` returning the current secret at
   connect time; because `reconnection: false` rebuilds the socket per attempt, a rotated capability is
   naturally re-read on the next reconnect. Verify a capability rotation across a reconnect does not wedge
   the client.

---

## 9. Files the impl will touch (predicted)

- `packages/happy-server/sources/app/api/socket.ts` — `createSocketAuthMiddleware()` public branch: add
  loopback-capability acceptance (create a loopback verifier from `socketOptions.paths` for the public
  mode; check-first, fall through to device-proof).
- `packages/happy-cli/src/daemon/daemonClient.ts` — `tunnelSocketIOOptions()`: return `extraHeaders` with
  the loopback capability when `state.publicListener` is set.
- `packages/happy-cli/src/api/apiMachine.ts` — `buildSocket()` + `connectToTunnelListener()`/
  `refreshTunnelAuth()`: forward `extraHeaders` into `io(url, …)`.
- `packages/happy-cli/src/api/apiSession.ts` — `buildSocket()` + reconnect path: same `extraHeaders`
  threading.
- Tests listed in §7.1 (server + happy-cli).

Reference-only (do not edit): `dualListenerBinding.ts`, `forkHooks.ts`, `persistence.ts`,
`eventRouter.ts`, `rpcHandler.ts`, `loopbackCapability.ts`, `remoteDeviceAuth.ts`,
`packages/happy-cli/AGENTS.md`, `packages/happy-server/AGENTS.md`.
