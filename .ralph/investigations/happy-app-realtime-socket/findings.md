# Investigation: Happy web app public-mode realtime socket stuck at "error"

**Date:** 2026-07-05
**Investigator:** read-only investigation member (`ralph/investigate-happy-realtime`)
**System under test:** Happy web app @ `http://localhost:8081` (expo-web/Metro, primary
checkout `packages/happy-app`), paired to the live public server
`https://happy.evyatar.dev` (per-daemon embedded happy-server behind a Cloudflare named
tunnel, public mode).

## Verdict

**Root cause = category 2 (handshake failure through Cloudflare), but with a precise
mechanism: transport ORDERING + browser limitation, NOT device-proof/CORS/CF-edge.**

The app requests `transports: ['websocket', 'polling']` (websocket **first**) with
`reconnection: false` and **without** `tryAllTransports: true`. In a browser, the
WebSocket transport **cannot carry the Cloudflare Access service-token headers nor the
device-proof header** (the browser `WebSocket` API forbids custom request headers), so
Cloudflare Access rejects the WS upgrade. Because `tryAllTransports` defaults to `false`
in engine.io-client, the client **does not fall back to the polling transport** — it emits
`connect_error("websocket error")` and, with `reconnection: false`, never retries. The
polling transport (which the app also lists, and which *does* carry the headers) is never
attempted, even though it works end-to-end.

**Confidence: HIGH (near-certain).** Reproduced end-to-end against the live server with the
app's exact socket options; the single-line delta (`tryAllTransports: true`, or reordering
to polling-first) flips the outcome from `websocket error` to reaching the server.

This is **not** category 1 (the app *does* attempt the socket) and **not** category 3
(single-use-nonce no-recovery) — the connection dies at the very first transport open,
before the device proof is ever evaluated by the server.

## Responsible code (file:line)

- **`packages/happy-app/sources/sync/socketOptions.ts:56`** —
  `transports: isPublic ? ['websocket', 'polling'] : ['websocket']`. Public mode lists
  **websocket first**; there is **no `tryAllTransports: true`** in the returned options
  (whole return block is `socketOptions.ts:38-58`).
- **`packages/happy-app/sources/sync/socketOptions.ts:57`** — `reconnection: false`
  (correct for the strict single-use nonce, but it also means a first-transport failure is
  terminal).
- **`packages/happy-app/sources/sync/socketOptions.ts:47-55`** — `transportOptions.websocket.extraHeaders`
  / `polling.extraHeaders` carry the CF + device-proof headers. On **web**, the
  `websocket.extraHeaders` are silently ignored by the browser (no effect); only the
  `polling.extraHeaders` are actually transmitted.
- **`packages/happy-app/sources/sync/apiSocket.ts:488-493`** — the `connect_error` handler
  sets the machine status to `'error'` and does **not** trigger any retry (only the
  `disconnect` handler at `apiSocket.ts:474-486` re-calls `this.connect(machineId)`). A
  first-open `connect_error` therefore latches `'error'` permanently.
- **`packages/happy-app/sources/sync/apiSocket.ts:438-451`** — `computeAggregateStatus()`
  returns `'error'` when the (single) machine connection is `'error'`, which is what the
  "Terminals" badge renders (`sources/components/MainView.tsx:135-139`,
  `t('status.error')`).

The upstream engine.io-client mechanism that makes this terminal:
`node_modules/engine.io-client/build/cjs/socket.js:509-518` (`_onError`):

```js
_onError(err) {
    SocketWithoutUpgrade.priorWebsocketSuccess = false;
    if (this.opts.tryAllTransports &&      // default: false  → block skipped
        this.transports.length > 1 &&
        this.readyState === "opening") {
        this.transports.shift();           // (would) fall back to polling
        return this._open();
    }
    this.emitReserved("error", err);       // ← taken: emit "websocket error"
    this._onClose("transport error", err);
}
```

Installed versions (resolved from the primary checkout): `socket.io-client@4.8.3`,
`engine.io-client@6.6.4` (declared `socket.io-client: ^4.8.1`). `tryAllTransports` was
added in engine.io-client 6.6.0 and defaults to `false`.

## Decisive evidence (live probes from the app origin)

All probes run via `agent-browser eval` in the running app page (origin
`http://localhost:8081`, cross-origin to `https://happy.evyatar.dev`). Credentials read
from the app's own `localStorage.machine_credentials` (CF service-token + Ed25519 device
key present → `isPublicModeCredentials` true).

### 1. Engine.IO polling handshake works with only CF headers (no device proof)

`GET https://happy.evyatar.dev/v1/updates/?EIO=4&transport=polling` with
`CF-Access-Client-Id` / `CF-Access-Client-Secret`:

```
withCF_noProof: { status: 200, body: '0{"sid":"IPs3AL9jTrrYjHMLAAAC","upgrades":["websocket"],
                  "pingInterval":15000,"pingTimeout":45000,"maxPayload":1000000}',
                  contentType: "text/plain; charset=UTF-8" }
noCF:           { fetchError: "TypeError: Failed to fetch" }   // CF 403, no CORS headers on error page
```

→ **CF Access + CORS + the polling transport at `/v1/updates` all work.** The device proof
is validated later, at the Socket.IO **namespace** connect, not at the Engine.IO transport
handshake. Category-2-as-"CORS/CF-edge/polling rejection" is disproven.

### 2. A raw browser WebSocket to the socket path is rejected

`new WebSocket("wss://happy.evyatar.dev/v1/updates/?EIO=4&transport=websocket")` (browser
cannot attach CF/device-proof headers):

```
{ event: "error", ms: 448 }
```

→ Cloudflare Access rejects the header-less WS upgrade. This is exactly the transport the
app tries first.

### 3. End-to-end reproduction with the app's exact socket options

Loaded `socket.io-client@4.8.1` from CDN in-page and connected to `https://happy.evyatar.dev`
(`path:'/v1/updates'`, `reconnection:false`, CF headers in `extraHeaders`):

| Trial | Options | Result | engine transport |
|---|---|---|---|
| `appExact_wsFirst` | `transports:['websocket','polling']` (app's exact) | `connect_error: "websocket error"` @575ms | **websocket** (never advanced) |
| `pollingOnly` | `transports:['polling']` | `connect_error: "Unauthorized"` @118ms | **polling** |
| `wsFirst_tryAll` | `transports:['websocket','polling']` + `tryAllTransports:true` | `connect_error: "Unauthorized"` @205ms | **polling** (fell back) |

Interpretation:
- The **app's exact config** dies with `"websocket error"` and the engine transport is
  still `websocket` — it **never reaches polling**, so the badge latches `'error'`.
- **Polling-only** and **`tryAllTransports:true`** both advance to the polling transport
  and reach the **server's device-proof verifier**, returning `"Unauthorized"` — which is
  *expected*, because the probe sent no valid `x-happy-device-proof`. The important signal
  is that the connection got all the way to the Socket.IO namespace middleware (a strictly
  later stage than the app ever reaches today).

### 4. Daemon log corroboration

Newest daemon log (`~/.happy/logs/2026-07-05-15-56-39-pid-102040-daemon.log`) shows the
daemon's OWN machine socket connecting cleanly over **loopback** (`[API MACHINE]
Connecting to http://127.0.0.1:51371` → `Connected to server`), i.e. it never touches
Cloudflare. Grepping the whole log for
`socket|handshake|/v1/updates|nonce|proof|401|Unauthorized|CORS|websocket|polling|403`
yields **zero** matches → the embedded happy-server does not log app socket handshakes, so
"no rejection in the daemon log" is not evidence of success (as the lead noted).

### 5. Why the browser console showed nothing

Every socket lifecycle log in `apiSocket.ts` (`connect` / `disconnect` / `connect_error` /
`error`) is gated behind `this.isVerboseLogging()` (`apiSocket.ts:460-499`), which reads
`localSettings.verboseLogging` (default off). So the app *does* fire `connect_error` and
sets `'error'`, but logs nothing — matching the "console shows only app-init logs"
observation.

## Recommended fix direction

**Make the browser use the transport that can actually carry the auth headers, and let it
fall back.** Two independent, additive changes in
`packages/happy-app/sources/sync/socketOptions.ts` (the `return {...}` block,
`socketOptions.ts:38-58`), for the `isPublic` branch:

1. **Add `tryAllTransports: true`** so a failed websocket open falls back to polling
   instead of terminating (engine.io-client 6.6.x honors this — verified live in trial
   `wsFirst_tryAll`). This is the minimal one-line fix and is the safest because it keeps
   websocket available on native (React Native / Node) where `extraHeaders` *do* work on
   the WS upgrade.

2. **Prefer polling-first on web specifically.** On web the websocket transport can *never*
   carry CF/device-proof headers, so listing it first just wastes a guaranteed-failing
   round-trip (~0.5s) on every connect. Recommended: on `Platform.OS === 'web'` in public
   mode, use `transports: ['polling']` (or `['polling', 'websocket']` with
   `tryAllTransports: true`); keep `['websocket', 'polling']` for native. Note the existing
   code comment already anticipates "some Cloudflare Access edges buffer/deny raw WebSocket
   upgrades" — the browser is the strongest instance of that (it can't authenticate the
   upgrade at all).

   The cleanest combined form:
   ```ts
   const isWeb = Platform.OS === 'web';
   // ...
   transports: isPublic
       ? (isWeb ? ['polling'] : ['websocket', 'polling'])
       : ['websocket'],
   tryAllTransports: isPublic ? true : undefined,
   reconnection: false,
   ```

**This does NOT weaken the single-use-nonce security model.** The device proof is built
once and sent via `polling.extraHeaders` on the Engine.IO handshake request; the server's
strict single-use nonce is consumed exactly once at the Socket.IO namespace middleware
(the transport-level polling GET does not consume it — evidence probe #1 returned 200 with
no proof). `reconnection: false` can stay as-is. Recovery after a genuine drop is already
handled by the app-level `disconnect` handler (`apiSocket.ts:474-486`), which calls
`this.connect(machineId)` and rebuilds a **fresh** nonce via
`buildTunnelSocketOptions(...)` — that path was never the problem here.

### Files to change
- `packages/happy-app/sources/sync/socketOptions.ts` — add `tryAllTransports: true` and a
  web-aware `transports` selection in the `isPublic` branch (the only required change).
- (optional, defensive) `packages/happy-app/sources/sync/apiSocket.ts` — consider a bounded
  retry on first-open `connect_error` in public mode so a transient edge failure self-heals
  instead of latching `'error'` until manual reload. Not required to fix this bug; the
  transport change alone resolves it.

### Suggested verification after the fix
1. Reload the web app; the "Terminals" badge should transition `error/connecting →
   connected`.
2. Temporarily enable `localSettings.verboseLogging` to observe `SyncSocket connected` with
   `engine.transport.name === 'polling'` on web.
3. Re-run the in-page trial harness (this doc, §3) against the real app socket with a valid
   device proof to confirm `connect` (not `Unauthorized`).

## Ambiguities / caveats
- The `"Unauthorized"` in trials #2/#3 is from a probe with **no** device proof; it does
  **not** indicate a device-proof problem in the real app. It only proves the polling
  transport reaches the server's verifier — a stage the app never reaches today. Confirming
  the *real* app's proof is accepted over polling requires the fix + a live reconnect (or a
  proof-signing probe), which was out of scope for this read-only diagnosis.
- Native (iOS/Android) is unaffected by this specific bug because the RN websocket/ws layer
  can attach `extraHeaders` to the upgrade; the recommended change is guarded to keep native
  behavior identical.
