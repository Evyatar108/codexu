# Security Model

Audience: developers working on Happy's daemon, server, agent, and app transport layers.

This document records the current Dev Tunnels security contract. The Happy-specific tunnel claim layer has been removed. Remote callers are admitted by the Microsoft Dev Tunnels gateway using `X-Tunnel-Authorization: tunnel <connect-jwt>`; local callers are admitted by the loopback capability token. The removed X25519 RPC payload encryption layer remains out of the current transport contract.

There is also an **opt-in, default-off** public exposure mode — a single-user public happy-server at `https://happy.evyatar.dev` fronted by an outbound Cloudflare named tunnel — with its own fail-closed application-layer boundary. It is documented in [Optional Public Mode](#optional-public-mode-single-user-evyatardev-server-opt-in-default-off) below. When the mode is not enabled, everything else in this document is unchanged.

## Trust Model

The Dev Tunnels design uses two independent gates:

- Transport: Microsoft Dev Tunnels TLS protects bytes in flight between clients and the user's daemon listener. Private tunnel access is authenticated to the gateway with `X-Tunnel-Authorization: tunnel <connect-jwt>` (Microsoft consumes and strips this header before forwarding to the backend).
- Local loopback: callers on the local listener authenticate with `X-Loopback-Capability`, read from the per-start capability file.

After either gate admits a request, happy-server is single-user and assigns identity from `tofuConfig.localUserId`. There is no separate Happy claim, replay cache, or per-request account id in the tunnel path.

Trusted parties:

- GitHub as the account identity provider used during pairing.
- Microsoft Dev Tunnels as the TLS tunnel transport provider.
- The user's local daemon machine and its embedded Happy server.

Untrusted parties:

- The public network between clients and the Dev Tunnels edge.
- Other clients without Dev Tunnels gateway access or a valid loopback capability.

## Retired Happy Claim Contract

The prior Ed25519-signed Happy tunnel envelope was deleted by the remove-tunnel-claim-layer plan. Pairing no longer returns a claim, clients no longer persist one, and happy-server no longer verifies one. The Dev Tunnels gateway is the sole remote identity gate.

## Gateway Auth: R-D18 Path (b)

Sprint E implements R-D18 path (b): all private-tunnel HTTP and Socket.IO callers carry a Dev Tunnels connect token.

- `X-Tunnel-Authorization: tunnel <connect-jwt>` is consumed by the Dev Tunnels gateway and stripped before forwarding to the backend.
- happy-app obtains connect tokens from `DevTunnelsClientProvider.getConnectToken(tunnelId)` through its local provider implementation.
- happy-agent obtains connect tokens from the same provider contract and persists refreshed token fields in its machine credentials.

happy-server never sees `X-Tunnel-Authorization` (gateway strips it). CORS allow-lists in `app/api/api.ts` and `app/api/socket.ts` include the gateway header for browser preflight.

## Operator Identity Gate

The operator identity gate is the pair **Dev Tunnels gateway + `127.0.0.1` bind**. Both halves are load-bearing: the gateway proves the caller holds a Dev Tunnels connect token for this tunnel, and the loopback bind ensures the tunnel listener is not directly addressable on the host's network. `createApp()` / `createHappyServer()` enforces the bind half at startup: when `auth !== 'loopback'` and the resolved `config.host` is anything other than a loopback address (`127.0.0.1`, `::1`, `localhost`), the server logs a Critical message and refuses to start (`packages/happy-server/sources/index.ts` `assertOperatorIdentityGate`). The loopback listener (`auth: 'loopback'`) is exempt because it is gated by `X-Loopback-Capability` instead.

Identity is read at pair time from `~/.happy/profile.json` (written by `happy auth login --force` on the daemon machine via a one-time GitHub device flow against `Iv1.e7b89e013f801f03`, the public devtunnel OAuth app). The previous `HAPPY_TUNNEL_GITHUB_OWNER` enforcement gate was removed during BOOX validation 2026-05-13, and the later Happy claim layer was removed by the remove-tunnel-claim-layer plan. Tunnel ownership at the Dev Tunnels gateway is now the only remote identity gate. Anyone who has the daemon's local filesystem AND can reach its Dev Tunnel **is** the operator. This is appropriate for the single-operator personal-fork posture; a public multi-tenant deployment would need to reintroduce a per-tunnel ownership check.

The Prometheus metrics endpoint is unchanged by this work. In standalone mode it still binds according to its configured host, including `0.0.0.0` when requested, and it does not use Dev Tunnels or loopback capability authentication.

## Optional Public Mode: Single-User evyatar.dev Server (opt-in, default-off)

Shipped and verified 2026-07. This mode exposes the operator's **own embedded per-daemon single-tenant** happy-server (exactly one user per process) publicly at `https://happy.evyatar.dev` through an **outbound-only** Cloudflare named tunnel, because the operator's corporate policy blocks Microsoft Dev Tunnels. It is **not** a return to a central multi-tenant server and **not** a Cloudflare "provider-swap" of the retired central instance — it is still the per-daemon embedded server, and Cloudflare is mandatory edge defense-in-depth layered on top of a new fail-closed app-layer verifier, never the boundary by itself.

It is enabled only when the operator sets `HAPPY_TUNNEL_PROVIDER=cloudflare` **and** supplies a valid `~/.happy/public-tunnel.json` (hostname, tunnel name, and at least one Cloudflare Access service token). Absent either, the daemon keeps the Dev Tunnels + loopback contract described above, unchanged. Codex `/remote on` stays LOOPBACK-only (it attaches to the local `127.0.0.1` daemon listener and never targets the public URL).

Two independent gates protect public mode, layered defense-in-depth. The **app-layer Ed25519 paired-device verifier is the PRIMARY boundary**; the **Cloudflare Access edge (a cryptographically-verified `Cf-Access-Jwt-Assertion` JWT) is MANDATORY defense-in-depth in front of it**. The verifier ships and passes its decisive route-inventory acceptance test independently of the edge, so the boundary never depends on Cloudflare's correctness.

### Primary boundary: fail-closed Ed25519 paired-device verifier

`packages/happy-server/sources/app/api/auth/remoteDeviceAuth.ts` verifies an Ed25519 signature from an already-paired, TOFU-pinned device on every public-mode request. The signed-request envelope, canonicalization, and deterministic cross-runtime test vectors live in `@slopus/happy-wire` (`publicDeviceAuth.ts`) so server, app, cli, and codex cannot drift:

- The device signs a domain-separated canonical string binding `method + path + keyId + publicKey + nonce + issuedAt + bodyHash` (domain prefix `happy-public-device-proof/v1`).
- The base64 JSON envelope rides the `x-happy-device-proof` header on both HTTP and the Socket.IO handshake.
- Verification is fail-closed and enforces, in order: well-formed envelope → known + pinned public key (pinned exactly, no rebind) → freshness (`issuedAt` within a 5-minute window, +1-minute forward clock skew) → **strict single-use nonce** (replay cache) → cryptographic signature bound to method + path. Any failure returns 401 with no key material.
- The same verifier instance backs BOTH the HTTP guard and the socket handshake, so a nonce is consumed exactly once across transports.

### Mandatory edge: Cloudflare Access JWT assertion

A Cloudflare Access self-hosted application on `happy.evyatar.dev` (Zero Trust org `evyatar-codexu.cloudflareaccess.com`) enforces a service-token (`non_identity`) policy at the edge. The app authenticates to the edge by presenting `CF-Access-Client-Id` + `CF-Access-Client-Secret` (sourced from the one-time pairing invite); Cloudflare rejects missing/incorrect tokens with **403** before the request reaches the origin.

Crucially, **Cloudflare Access strips the `CF-Access-Client-Id` / `CF-Access-Client-Secret` headers at the edge and does not forward them to the origin.** Instead it injects a short-lived, RS256-signed JWT in the `Cf-Access-Jwt-Assertion` header. The origin therefore cannot re-check the service-token pair (a naive re-check can never pass through real Cloudflare Access) — it **cryptographically verifies the assertion JWT** in `packages/happy-server/sources/app/api/auth/edgeAssertion.ts` (using [`jose`](https://github.com/panva/jose)): the signature against Cloudflare's rotating JWKS (`https://<teamDomain>/cdn-cgi/access/certs`, fetched + cached + rotated for free by `createRemoteJWKSet`), plus `iss` (`https://<teamDomain>`), `aud` (the Access application AUD tag), and `exp`/`nbf`. Any failure — missing / malformed / expired assertion, wrong `aud` / `iss`, bad signature, or an unreachable JWKS — fails closed (401 `edge_access_denied`). The team domain and AUD are **configuration** (`~/.happy/public-tunnel.json` → `PublicAuthConfig.edge.assertion`), never hardcoded.

`isEdgeAllowed` is the guard the live runtime calls: when an `assertion` expectation is configured (the shipped public-bind path) it verifies the JWT; otherwise it falls back to the legacy synchronous service-token check (`checkEdgeAccess`, constant-time compare), which is retained as a fail-closed fallback for non-public/test paths only. The operator bind gate (`assertOperatorIdentityGate`) and the CLI's `assertPublicBindReady()` both require the assertion config (team domain + AUD) for a public non-loopback bind, so a missing/typo'd assertion config fails fast at startup rather than silently denying every request. mTLS is explicitly out of scope until the app has native client-certificate storage.

### Global default-deny + explicit route allowlist

Public mode is **not** secured by piecemeal per-route `preHandler`s. `configureApi()` installs a global fail-closed Fastify `onRequest` hook **before any route is registered**, and every method/path is denied (401) unless it appears in the explicit `PUBLIC_ROUTE_POLICY_ALLOWLIST` with a named policy:

- `deviceProof` — requires a valid Ed25519 device proof (and the edge headers). Covers `/health`, `/`, `/files/*`, version/dev routes, `/pair/connect`, push routes, `/v2/me/*`, and the session routes.
- `pairComplete` — the ONLY pre-enrollment policy (`/pair/complete`): it passes the edge check then reaches the handler, which enforces the operator pairing window + QR secret + replay (see Enrollment below). It never requires a device proof because the device is not yet paired.

Any newly registered route that is not deliberately added to the allowlist **fails closed**. The decisive acceptance test derives the route inventory from the live Fastify app (not a hand-maintained list) and asserts every non-allowlisted route returns 401 with no key material.

### Body-hash binding

The `onRequest` guard verifies the signature over method + path only, because it runs before the body is parsed — so a valid proof would otherwise authorize any body. A second `preValidation` `bodyHashGuard` runs after the raw body is captured, recomputes the SHA-256 body hash, and rejects (401) unless it matches the authenticated envelope's signed `bodyHash`, closing the body-swap gap. Fail-closed: a body-bearing route whose raw body cannot be captured hashes to the empty-body hash, which will not match a non-empty signed hash, so it is rejected too.

### Socket.IO handshake (websocket + polling)

The socket middleware demands a device proof on BOTH the websocket and polling transports (the old fail-open tunnel branch is closed), using a fixed proof binding of `GET /v1/updates`. Because the socket nonce is **strict single-use**, the app must connect with `reconnection: false` and a single transport — a reused nonce always fails closed.

### Browser CORS preflight

For a browser-based app to reach public mode, the CORS `allowedHeaders` (in `app/api/api.ts` and `app/api/socket.ts`) must list every request header the browser sends on a cross-origin request, or the preflight `OPTIONS` fails before the real request. The allowlist carries the device-proof header (`X-Happy-Device-Proof`), the pairing headers (`X-Happy-Pairing-Secret`, `X-Happy-Pairing-Nonce`, sent on `POST /pair/complete`), and the legacy Cloudflare Access client headers (`CF-Access-Client-Id` / `CF-Access-Client-Secret`, which the browser presents to the *edge*). The `Cf-Access-Jwt-Assertion` header is deliberately **NOT** in the allowlist: Cloudflare Access *injects* it between its edge and the origin — a browser never sends it — so listing it in a preflight allowlist would be meaningless. The `corsAllowed.test.ts` preflight test asserts the pairing headers are echoed and the assertion header is absent.

### Enrollment (TOFU device pinning)

First contact is explicit and operator-gated; there is no open self-enrollment:

1. When the daemon brings up the public listener it emits a one-time **public pairing invite** (`@slopus/happy-wire` `publicPairingInvite.ts`): a compact base64url `{ version, serverUrl, machineId, pairSecret, cloudflareAccess: { clientId, clientSecret }, issuedAt, expiresAt }` (default 10-minute TTL), surfaced via QR or manual entry.
2. The app imports the invite and validates the server using the CF-Access headers from the invite.
3. The app calls `POST /pair/complete` with the CF-Access headers, the pre-shared pairing secret (`x-happy-pairing-secret`), a single-use pairing nonce (`x-happy-pairing-nonce`), and its device public key. The pairing gate returns key material **only** inside the operator-opened window with a valid secret and an unused nonce; everything else → 401.
4. On success the device Ed25519 public key is **TOFU-pinned** into the live verifier (`enroll()`), visible immediately to both the HTTP guard and the socket handshake. Re-enroll of the same `(keyId, publicKey)` is idempotent; a conflicting public key for an already-pinned `keyId` is refused (`device_key_conflict` → 409) and never overwrites the pin.
5. happy-cli persists pinned devices to `~/.happy/public-paired-devices.json` (via the `onDeviceEnrolled` hook) so pins survive a daemon restart.
6. Thereafter the app presents the device proof (`x-happy-device-proof`) plus the CF-Access headers on **every** HTTP request and on the Socket.IO handshake (polling and websocket).

### Public-mode threat model summary

- **Default-deny.** Un-allowlisted routes and un-proofed requests fail closed (401); the route inventory is derived from the live app so a new route cannot silently open a hole.
- **Replay protection.** Single-use nonces on both the device proof (shared across HTTP + ws/polling) and the `/pair/complete` pairing nonce; freshness-bounded proofs with a bounded clock-skew allowance.
- **Body-hash binding.** The signed proof commits to the exact request body, so a captured proof cannot be replayed against a different body.
- **TOFU device pinning.** Only operator-enrolled device keys can present proofs; a pinned key cannot be silently rebound.
- **Edge defense-in-depth.** The mandatory Cloudflare Access layer rejects unauthenticated traffic (HTTP + WS upgrade) at the edge (403) before it reaches the origin; the origin then cryptographically verifies the CF-injected `Cf-Access-Jwt-Assertion` JWT (signature + `iss` + `aud` + `exp`) and fails closed on any mismatch.
- **Non-goals.** Multi-tenant isolation, key revocation for a lost device, and Cloudflare mTLS are out of scope for the single-user posture; a public multi-user deployment would need all three.

## Replay Protection (post-claim removal)

Per-request anti-replay protection now lives at the Dev Tunnels gateway as part of its connect-token validation; no application-level replay cache is needed in happy-server. The previous Happy claim layer's `seenJti` cache (single-use `jti`, `MAX_CLAIM_LIFETIME_SECONDS=3600`) was removed together with `packages/happy-server/sources/app/api/auth/tunnelClaim.ts`. Backend code MUST NOT re-introduce its own replay cache without first re-introducing a verifiable backend-side claim that carries a server-checkable identifier; otherwise such a cache would key off attacker-controlled or gateway-stripped material and provide no real protection.

## Web TokenStorage Threat Model

Native happy-app stores credentials in `expo-secure-store`. On web, `sources/auth/tokenStorage.ts` stores `devTunnelsAccess` and per-machine tunnel credentials in `localStorage`. That is an accepted trade-off for the single-user self-host posture: the operator controls the browser environment, the app does not mix untrusted third-party scripts into its origin, and XSS is out of scope. If the fork ever ships a public multi-user web build, this must be revisited with session-only tokens or a backend-for-frontend that holds tokens server-side.

## Encryption Posture

Happy now relies on TLS plus Dev Tunnels gateway auth for remote callers and loopback capability auth for local callers. The removed X25519 RPC-layer encryption is not part of the current transport contract. Message bodies, metadata, and state fields can still be encrypted at the application layer where existing session sync requires it, but RPC params and responses are plaintext JSON over the authenticated tunnel.

## RPC Payload Contract: Option A

Option A is plaintext-over-TLS plus Dev Tunnels gateway authorization for RPC payloads. After the B+C+D cutover, `rpc-call` params and `rpc-request` responses are ordinary JSON payloads carried over the Dev Tunnels TLS transport. The server continues to route RPC messages by Socket.IO room and does not become the account identity source.

As of Sprint D, the X25519 per-message RPC layer is REMOVED end-to-end. The happy-cli handler side (Sprint B) reads `request.params` directly and returns plaintext JSON via `packages/happy-cli/src/api/rpc/RpcHandlerManager.ts`. The happy-agent caller side (Sprint C) emits plaintext `rpc-call` params and consumes plaintext results via `packages/happy-agent/src/machineRpc.ts`. The happy-app caller side (Sprint D) emits plaintext params and consumes plaintext results via `packages/happy-app/sources/sync/apiSocket.ts`, and the X25519 session-key derivation path that previously lived in `pairing.ts` and `tunnelTransport.ts` has been deleted along with the entire `packages/happy-app/sources/encryption/` directory and the `packages/happy-app/sources/sync/encryption/` subtree.

Pre-cutover (Sprint A only, now historical), callers sent encrypted base64 strings:

```json
{
  "event": "rpc-call",
  "payload": {
    "method": "machine-123:spawn-happy-session",
    "params": "base64url(secretbox-or-aes-gcm-bytes)"
  }
}
```

Pre-cutover (Sprint A only, now historical), handlers returned encrypted base64 strings:

```json
{
  "ok": true,
  "result": "base64url(secretbox-or-aes-gcm-bytes)"
}
```

After cutover, callers send plaintext JSON params over TLS:

```json
{
  "event": "rpc-call",
  "payload": {
    "method": "machine-123:spawn-happy-session",
    "params": {
      "type": "spawn-in-directory",
      "directory": "C:/work/project",
      "approvedNewDirectoryCreation": false
    }
  }
}
```

After cutover, handlers return plaintext JSON results over TLS:

```json
{
  "ok": true,
  "result": {
    "type": "success",
    "sessionId": "session-123"
  }
}
```

The server-side RPC router remains an opaque forwarder. `packages/happy-server/sources/app/api/socket/rpcHandler.ts` reads `method` and forwards `params` as provided; it does not decrypt, inspect, or validate RPC method payload schemas.

## Dual-Listener RPC Plane Non-Crossing

Sprint A's dual-listener design creates one Socket.IO server per listener. The tunnel listener and loopback listener must not share RPC rooms or handler registries.

Constraints:

- Each listener owns its own `io` Server instance.
- Each listener owns its own Socket.IO rooms, including `rpc:<userId>:<method>` rooms.
- Each listener owns its own RPC handler registration lifecycle.
- The shared event bus may fan out non-RPC realtime events between listener sinks.
- The shared event bus must not bridge `rpc-call`, `rpc-request`, `rpc-register`, or `rpc-unregister` between listeners.

This keeps tunnel-authenticated RPC traffic and loopback-capability RPC traffic from crossing authentication planes.

## Coordinated B+C+D Cutover Tasks

The following code changes landed together in the coordinated B+C+D cutover.

Landed:

- Sprint B deleted handler-side RPC param decryption and response encryption in `packages/happy-cli/src/api/rpc/RpcHandlerManager.ts`. The handler now consumes plaintext `request.params` and returns plaintext result objects.
- Sprint C deleted caller-side RPC param encryption and result decryption in `packages/happy-agent/src/machineRpc.ts`. happy-agent now emits plaintext `rpc-call` params and consumes plaintext result objects.
- Sprint D deleted app-side RPC param encryption and result decryption in `packages/happy-app/sources/sync/apiSocket.ts`. The Socket.IO RPC paths emit plaintext params and consume plaintext results directly. (Naming note: those paths were `apiSocket.sessionRPC(sid, ...)` / `apiSocket.machineRPC(mid, ...)` at the time of Sprint D; the 2026-05-13 consolidation moved them under `apiSocket.forSession(sid).rpc(...)` / `apiSocket.forMachine(mid).rpc(...)` scope builders — same wire shape, different call surface.)
- Sprint D deleted pair-time X25519 session key derivation from stored app credentials and from `packages/happy-app/sources/auth/pairing.ts`.
- Sprint D deleted the app-side X25519 helper usage for tunnel transport credentials. `packages/happy-app/sources/sync/tunnelTransport.ts` was removed entirely; its successor `packages/happy-app/sources/sync/socketOptions.ts` builds Socket.IO options from Dev Tunnels connect-token auth and emits no encryption-derived material.
- Sprint D deleted the entire `packages/happy-app/sources/encryption/` directory (aes, base64, deriveKey, hex, hmac_sha512, libsodium, text) and the `packages/happy-app/sources/sync/encryption/` subtree (artifactEncryption, encryption, encryptionCache, encryptor, machineEncryption, sessionEncryption) as part of US-D4. The cutover also updated tests that previously asserted encrypted base64 RPC params or results, replacing those assertions with plaintext JSON payload expectations.

## Sprint A Non-Changes (historical)

Sprint A intentionally left these areas unchanged at the time of its own landing. Sprints B, C, and D have since changed most of them; this section is retained for historical context.

- At the end of Sprint A: `packages/happy-agent/src/machineRpc.ts` continued encrypting params and decrypting results — superseded by Sprint C, which deleted both code paths.
- At the end of Sprint A: `packages/happy-app/sources/sync/apiSocket.ts`, `packages/happy-app/sources/auth/pairing.ts`, and `packages/happy-app/sources/sync/tunnelTransport.ts` continued using the existing X25519-derived session-key path — superseded by Sprint D, which deleted that path. `tunnelTransport.ts` was removed and replaced by `socketOptions.ts`; `pairing.ts` no longer derives or stores a session key; `apiSocket.ts` no longer touches encryption helpers.
- The happy-wire RPC payload shape is no longer opaque after the B+C+D cutover; shared wire schemas now describe plaintext params and results. (Sprint A originally documented this as opaque, with `params: string` for encrypted payloads.)
- `packages/happy-server/sources/app/api/socket/rpcHandler.ts` continues forwarding RPC payloads without inspecting them. Happy-specific tunnel-claim cryptography has been removed from the server side. The server does not derive X25519 session keys, and the app no longer derives them either.
