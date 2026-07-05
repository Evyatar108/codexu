# Stories outline — daemon own-machine socket uses the loopback plane in public mode

Task: `happy-public-mode-daemon-machine-socket-unauthorized`
Recommendation implemented by these stories: **Option B2** (daemon stays on the public/tunnel listener,
co-located with the app; authenticates with the local **loopback capability** token on the Socket.IO
handshake in public mode). Option C (self-enrolled device-proof) is the documented fallback in `plan.md`
§4 and is not decomposed here.

Ship order: **S1 → S2 → S3 → S4 → S5** (server credential acceptance must exist before the client sends
it; the shared helper before the two clients that consume it; verification last).

---

## S1 — Public listener accepts a valid loopback capability as a co-resident handshake credential

**Repo/site:** `packages/happy-server/sources/app/api/socket.ts` → `createSocketAuthMiddleware()`
(line 57), the `auth === 'public'` branch (lines ~82-90).

**Change:** In public mode, build a loopback verifier from `socketOptions.paths`
(`makeLoopbackSocketVerifier(socketOptions.paths ?? {})` — the same helper the loopback listener uses).
In the public branch, **first** check `x-loopback-capability`; if present and valid → accept (skip
device-proof). Otherwise run the existing `verifyPublicSocketHandshake(...)` device-proof path unchanged.

**Acceptance criteria:**
- AC1.1 Public handshake with a **valid** `x-loopback-capability` header → accepted (no device proof
  required).
- AC1.2 Public handshake with an **absent or invalid** capability AND no valid device-proof → rejected
  with `Unauthorized` (fail-closed; device-proof path unchanged, including CF-Access edge + single-use
  nonce).
- AC1.3 Public handshake with a **valid device-proof** and no capability → still accepted (existing path
  byte-for-byte unchanged).
- AC1.4 `auth === 'loopback'` and `auth === 'tunnel'` branches are unchanged.
- AC1.5 The capability read uses `socketOptions.paths.loopbackCap` (already forwarded to the public
  listener via `api.ts` `startSocket({ …, paths })` — verified §3.4).

**Deps:** none. **Tests:** `sources/app/api/socket.spec.ts`, `sources/app/api/auth/remoteDeviceAuth.spec.ts`.

---

## S2 — Shared client helper attaches the loopback capability in public mode only

**Repo/site:** `packages/happy-cli/src/daemon/daemonClient.ts` → `tunnelSocketIOOptions()` (line 143).

**Change:** When public mode is active (machine state `publicListener !== undefined`), return an
`extraHeaders: { 'X-Loopback-Capability': await readCapability() }` alongside the existing `{ url, auth }`.
In non-public mode, return the current shape (no `extraHeaders`). Keep `url` = the tunnel/public base URL
in both modes (the daemon stays co-located with the app — Option B2, not Option A).

**Acceptance criteria:**
- AC2.1 With `state.publicListener` set → result includes `extraHeaders['X-Loopback-Capability']` equal to
  `readCapability()`; `url` is still the tunnel/public base URL.
- AC2.2 Without `state.publicListener` → result is byte-for-byte the current `{ url, auth: {} }` (no
  `extraHeaders`).
- AC2.3 `readCapability()`/`ensureDaemonReady()` ordering preserved so the capability is available before
  connect.

**Deps:** S1 (so the server accepts what the client will send). **Tests:** `src/daemon/daemonClient.test.ts`.

---

## S3 — Machine client forwards `extraHeaders` into its socket (PRIMARY fix)

**Repo/site:** `packages/happy-cli/src/api/apiMachine.ts` → `buildSocket()` (line 268) and its callers
`connectToTunnelListener()` (line 355) + `refreshTunnelAuth()` (line 342).

**Change:** Extend `buildSocket(url, auth)` to also accept `extraHeaders` and pass it into
`io(url, { transports: ['websocket'], auth, extraHeaders, path: '/v1/updates', reconnection: false,
autoConnect: false })`. Callers pass through `options.extraHeaders` from `tunnelSocketIOOptions()`.

**Acceptance criteria:**
- AC3.1 In public mode, the machine client's `io(url, …)` options include
  `extraHeaders['X-Loopback-Capability']`.
- AC3.2 **Primary end-to-end acceptance:** in public mode the machine socket connects
  (`[API MACHINE] Connected to server`) and **stays** connected — no repeating
  `[API MACHINE] Connection error: Unauthorized` / `Attempting reconnect` loop.
- AC3.3 In non-public mode, machine-client socket options are unchanged (no `extraHeaders`).
- AC3.4 The `socketAuthBase()` auth object (token/clientType/machineId/happyClient) is unchanged and is
  still passed via `auth`.

**Deps:** S2. **Tests:** `src/api/socketTunnelAuth.test.ts`, `src/api/apiMachine.keepalive.test.ts`,
`src/api/socketReady.preconnect.test.ts`.

---

## S4 — Session client forwards `extraHeaders` (same root cause; regression-guarded)

**Repo/site:** `packages/happy-cli/src/api/apiSession.ts` → `buildSocket()` (`io(url, …)` at line 263)
and the reconnect path (`tunnelSocketIOOptions()` at line 365, `buildSocket(url, auth)` at line 374).

**Change:** Same `extraHeaders` threading as S3 (session client shares `tunnelSocketIOOptions()`), keeping
`withCredentials: true` and all other options unchanged.

**Acceptance criteria:**
- AC4.1 In public mode, the session client's `io(url, …)` options include
  `extraHeaders['X-Loopback-Capability']`.
- AC4.2 In non-public mode, session-client socket options are unchanged.
- AC4.3 No behavioral change to session sync/replay logic beyond the added handshake header.

**Deps:** S2. **Tests:** existing apiSession socket tests + `src/api/socketReady.preconnect.test.ts`.

---

## S5 — Verification: automated coverage + live public-mode check

**Change:** Land the new/updated assertions from S1-S4 and perform the live end-to-end verification.

**Acceptance criteria:**
- AC5.1 Targeted suites green (see `plan.md` §7.1): happy-server `socket.spec.ts`,
  `remoteDeviceAuth.spec.ts`, `dualListenerBinding.test.ts`; happy-cli `daemonClient.test.ts`,
  `dualListenerBinding.test.ts`, `socketTunnelAuth.test.ts`, `socketReady.preconnect.test.ts`,
  `apiMachine.keepalive.test.ts`.
- AC5.2 **Live:** restart the daemon in public mode (`HAPPY_TUNNEL_PROVIDER=cloudflare` + public opt-in);
  daemon log shows `[API MACHINE] Connected to server` with **no** `Unauthorized` reconnect loop; the
  Happy app's machine realtime presence badge is **healthy**.
- AC5.3 **Live RPC (Option B2 guarantee):** from the app, invoke a machine RPC (e.g. spawn a session) and
  confirm success — proving the daemon is co-located with the app on the public io server (this is what
  Option A would have silently broken).
- AC5.4 Non-public mode unaffected: a tunnel/Dev-Tunnels-mode daemon still connects as before (no
  `extraHeaders` attached; server tunnel branch unchanged).

**Deps:** S1-S4.

---

## Cross-cutting notes

- **Do not** move the client to the loopback listener URL (Option A) — it isolates app→daemon RPC across
  the two embedded io servers (`plan.md` §3.2/§4). Keep `url` = tunnel/public base URL.
- **Do not** authorize by remote-address on the public listener (Option B-naive) — cloudflared collapses
  remote traffic to `127.0.0.1` (`plan.md` §4). Authorize only by possession of the local capability
  secret.
- **Do not** touch the HTTP device-proof route plane (US-005) — socket handshake only.
- codexu root `CLAUDE.md` is gitignored — never `git add CLAUDE.md`; never `git add -A`. Fork-level
  guidance edits go in `AGENTS.md`.
