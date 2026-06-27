# happy-server auth: FORK vs UPSTREAM — source-verified findings

**Investigation:** settle whether the fork's tunnel-mode "no app-layer auth" is a FORK
divergence or upstream behavior, before the `remote-connectivity-single-user-public-evyatar-server`
plan. READ-ONLY. All claims cited to `file:line`.

**Operator's question:** *"did we remove some of the auth from happy? or is it still
there? why do we need more verifier work?"*

**One-line answer:** **YES — the fork deliberately removed upstream's per-request
bearer-token authentication plane** (it deleted the multi-tenant account/token auth and
relocated the trust boundary to the *transport*: the Dev Tunnels gateway + a `127.0.0.1`
bind). For *intended* remote access, authentication still happens — but it lives in the Dev
Tunnels gateway, **not in happy-server**; happy-server's tunnel listener has zero fail-closed
app-layer auth and cannot tell gateway-forwarded traffic from local loopback traffic. "More
verifier work" is needed precisely because the public-exposure plan REPLACES that
authenticating transport with a plain tunnel — which removes the only boundary the fork has.

**Second, sharper finding (verified this run, beyond the brainstorm):** the fork **also dropped
end-to-end ENCRYPTION of session message content.** The CLI posts session bodies as
`JSON.stringify(content)` with **no `encrypt()` call** (`apiSession.ts:659`; `encrypt` is imported
but never invoked in `ApiSessionClient`), the server stores them under a **misleading
`{ t: 'encrypted', c: <plaintext> }` label with no server-side crypto** (`v3SessionRoutes.ts:15,166-168`),
and the real-time receive path `JSON.parse`s `content.c` as plaintext (`apiSession.ts:316`). So
"E2E protects content even if routes are open" — the brainstorm's safety backstop — **does NOT
hold for the fork's session bodies.** A hostile reader reaching the message routes/socket would get
**plaintext agent-session content**, making public exposure even more dangerous than the brainstorm
stated. (This is architecturally coherent: E2E existed to defend content against the *untrusted
multi-tenant* upstream server; the fork's embedded single-user server is the operator's own trusted
local process, so at-rest plaintext was an acceptable simplification — UNTIL you expose it publicly.)

Sources compared:
- **FORK:** `D:/harness-efforts/codexu/packages/happy-server/` (codexu monorepo) — the embedded per-daemon server.
- **UPSTREAM:** `slopus/happy` @ `main`, path `packages/happy-server/` (fetched via `gh api`, 2026-06-27).

---

## (A) FORK-vs-UPSTREAM: is the no-op tunnel auth a fork divergence? — **YES, it is a FORK divergence**

The brainstorm's four "no auth in tunnel mode" claims are all CONFIRMED against fork source,
**and** all four are FORK divergences — upstream has real auth in every one of these spots.

### A1. HTTP route auth decorator (`app.authenticate`)

**FORK — no-op in tunnel mode:**
- `packages/happy-server/sources/app/api/api.ts:79` — `typed.decorate('authenticateTunnel', async function (_request: any) {});` — a literal **no-op** (returns nothing, never rejects).
- `api.ts:80` — `typed.decorate('authenticate', options.auth === "loopback" ? typed.verifyLoopbackCapability : typed.authenticateTunnel);` → in **tunnel** mode `app.authenticate` **IS** the no-op; in **loopback** mode it is the real `verifyLoopbackCapability` 401 gate.
- Every protected route uses `preHandler: [app.authenticate]`: `accountRoutes.ts:47,64,76`, `machineSelfRoutes.ts:22`, `pushRoutes.ts:23,56,88,103`, `sessionRoutes.ts:16,74,124,224,312,360,390`, `v3SessionRoutes.ts:52,101`, `agentCommsIngestRoutes.ts:47`. **In tunnel mode, all of these are ungated at the app layer.**

**UPSTREAM — real fail-closed bearer-token verifier:**
- `packages/happy-server/sources/app/api/api.ts:77` — `enableAuthentication(typed);`
- `packages/happy-server/sources/app/api/utils/enableAuthentication.ts:5-27` — `app.decorate('authenticate', ...)`: requires `Authorization: Bearer <token>` → **`401` if missing** (`:10-13`); `await auth.verifyToken(token)` → **`401` if invalid** (`:16-20`); sets `request.userId = verified.userId` (`:23`).
- `packages/happy-server/sources/app/auth/auth.ts:42-45` (`createPersistentTokenVerifier`) + `:89-139` (`verifyToken`) — the real cryptographic token verifier.

> The fork's own `auth.ts` (`app/auth/auth.ts`) has **NO `verifyToken` method and NO `verifier`** — it kept only `createToken`/`createGithubToken`/`verifyGithubToken`. The persistent-token *verifier* was deleted in the fork.

### A2. Socket.IO handshake

**FORK — fail-open in tunnel mode:**
- `packages/happy-server/sources/app/api/socket.ts:61-95` (`createSocketAuthMiddleware`): the only credential check is the loopback capability token, **and only when `socketOptions.auth === 'loopback'`** (`:62-69`). In **tunnel** mode there is **no token check at all** — it reads `clientType`/`sessionId`/`machineId` (presence/shape checks only, `:71-85`) and unconditionally calls `next()` (`:94`). **Fail-open.**

**UPSTREAM — fail-closed:**
- `packages/happy-server/sources/app/api/socket.ts:82-121`: `io.use(async (socket, next) => {...})` reads `const token = socket.handshake.auth.token` (`:83`); **`next(new Error('Missing authentication token'))` if no token** (`:88-92`); `const verified = await auth.verifyToken(token)` (`:106`); **`next(new Error('Invalid authentication token'))` if invalid** (`:107-111`); sets `socket.data.userId = verified.userId` (`:113`).

### A3. `/pair/complete` open key-material endpoint

**FORK — exists, no app-layer auth:**
- `packages/happy-server/sources/app/api/routes/pairRoutes.ts:59-119` (`POST /pair/complete`). Only guard is a **per-IP 30/min rate limit** (`:35-57`, `:87-89`). It returns `503` ONLY if `tofuPublicKeys` (`:90-92`) or `~/.happy/profile.json` (`:94-97`) are missing — both ARE present in a live daemon. On the happy path it returns `200` with `githubLogin`, `machineId`, `tunnelUrl`, `ed25519PublicKey`, `x25519PublicKey`, `ed25519Fingerprint`, and (if the caller supplies `mobileEcdhPublicKey`) a derived `mobileSharedSecret` (`:108-119`). `POST /pair/connect` (`:123-150`) is likewise unauthenticated.

**UPSTREAM — `/pair/complete` DOES NOT EXIST.** `gh api .../routes/pairRoutes.ts` → **HTTP 404**. Upstream pairing is the QR + token-approval flow via `authRoutes` (`/v1/auth/request` + `/v1/auth/response`, referenced in `api.ts:99` and the package AGENTS.md debug notes), which mints a **per-user bearer token** the device then presents on every request. The fork *replaced* that whole flow with the single unauthenticated `/pair/complete`.

### A4. `assertOperatorIdentityGate` — the design intent, in the fork's own words

- `packages/happy-server/sources/index.ts:101-108` forces a `127.0.0.1` bind whenever `auth !== "loopback"`, with this error string (`:104`):
  > *"refusing to start happy-server tunnel listener bound to non-loopback host ... The tunnel listener collapses identity to tofuConfig.localUserId and **relies on the Dev Tunnels gateway plus a loopback bind as its operator identity gate**."*

  This is the fork **documenting that the app layer intentionally trusts the gateway**. Upstream has no such gate; upstream `index.ts` / `api.ts:177` binds `host ?? '0.0.0.0'` (public) **because** every route + the socket are token-gated.

### A5. The divergence is explicit in fork git history

`git log packages/happy-server/sources/app/api/api.ts` (codexu):
- `25b9a573` **"drop multi-tenant userId scoping from happy-server"**
- `48e16356` **"US-001 - Server: tunnel-branch identity collapse + delete requireAccountIdForTunnel"**
- `5c1b3953` **"US-002 - Server: delete tunnel-claim minting code and tunnelClaim.ts"**
- `4869cbd7` **"fix(devtunnels): correct gateway/claim header design + single-step pair flow"**

`packages/happy-server/AGENTS.md` ("Architecture posture", "Pair protocol BOOX-validated 2026-05-13"):
the fork "dropped the public hosted deployment", runs "**exactly one user per process**", and the
"Dev Tunnels gateway's `X-Tunnel-Authorization` check is the **only identity gate**." The two-step
GitHub device flow + `GITHUB_CLIENT_ID` were **deleted** as "redundant on a personal fork because
tunnel ownership already proves operator identity."

**Verdict (A):** Not a bug, not an upstream trait — a **deliberate fork divergence**. Upstream
authenticates every HTTP route and the socket with a per-request, per-user bearer token
(fail-closed). The fork removed that entire token-auth plane and relocated the trust boundary to
the Dev Tunnels transport (gateway auth + loopback bind). **This is an auth-PLANE divergence, not an
apples-to-apples deployment-model comparison:** upstream is a multi-tenant hosted/self-host server
whose bearer verifier was coupled to per-user data scoping; the fork is embedded single-user-per-
daemon and intentionally deleted both. So "upstream has auth here" does NOT mean "re-enable upstream
auth unchanged" — see (D).

---

## (B) What auth exists, and what it protects — active in TUNNEL/remote vs LOOPBACK only

The daemon runs **two** embedded listeners (`packages/happy-cli/src/daemon/dualListenerBinding.ts:56-69`):
a `tunnel` listener (`auth: 'tunnel'`, `:59`) and a `loopback` listener (`auth: 'loopback'`, `:66`).
**Both bind to `127.0.0.1`** — `createApp` resolves `host` to `"127.0.0.1"` and
`assertOperatorIdentityGate` passes for both (`index.ts:102-103`). The "tunnel" listener is reachable
from outside ONLY because the tunnel provider forwards external traffic to `127.0.0.1:<tunnelPort>`.

| Auth layer | Where | Active in TUNNEL/remote mode? | Protects ACCESS or CONTENT? |
|---|---|---|---|
| **Dev Tunnels gateway auth** (`X-Tunnel-Authorization: tunnel <connect-jwt>`) | external transport, before the request reaches happy-server | **YES — this is the entire remote boundary today.** Gateway authenticates the external caller (private Dev Tunnel access control) and strips the header before forwarding. happy-server therefore receives **no verifiable per-request identity** and **cannot distinguish gateway-forwarded traffic from a local `127.0.0.1` process** hitting the tunnel port directly. | route **ACCESS** (the only thing gating tunnel routes) |
| `authenticateTunnel` (app route gate, tunnel mode) | `api.ts:79` | **NO — it's a no-op.** | nothing (placeholder) |
| Socket.IO handshake auth | `socket.ts:61-95` | **NO in tunnel mode** (fail-open); **YES in loopback mode** (capability token) | route/realtime **ACCESS** |
| `verifyLoopbackCapability` (`X-Loopback-Capability` file secret) | `loopbackCapability.ts:25-35` | **Loopback listener only.** Not on the tunnel listener. | local route **ACCESS** |
| `assertOperatorIdentityGate` (loopback-bind enforcement) | `index.ts:101-108` | startup-time; forces `127.0.0.1` bind unless `auth:'loopback'`. **Loopback-only-bind enforcement** — it is NOT a per-request check. | startup posture (keeps the no-auth tunnel listener off `0.0.0.0`) |
| `/pair/complete` + `/pair/connect` | `pairRoutes.ts:59-150` | tunnel listener only (`api.ts:109-110` registers pair routes only when `auth !== "loopback"`); **no app-layer auth** | hands out server key material — **self-enrollment** |
| **E2E content encryption** (design intent) | client-side | **Partially DROPPED in the fork (verified).** Session **message bodies** are sent/stored as **plaintext JSON** under a misleading `t:'encrypted'` label (CLI `apiSession.ts:659` no `encrypt()`; server `v3SessionRoutes.ts:166-168`; receive `apiSession.ts:316` `JSON.parse`). | was CONTENT — but does NOT actually protect fork session bodies |
| Account/token bearer auth (`verifyToken`) | **upstream only** | **N/A — deleted in the fork** | (was route + socket ACCESS upstream) |

**Key reading:** in TUNNEL mode the **only** active authentication is the **Dev Tunnels gateway**
(a transport-layer gate, outside happy-server). Inside happy-server, the tunnel listener has **zero
fail-closed app-layer auth** and cannot distinguish gateway-forwarded vs. loopback traffic. And the
fork's **session message content is plaintext at the server** (not E2E ciphertext), so route access
is the whole game — there is no encryption backstop on session bodies.

---

## (C) Public-exposure blast radius (plain tunnel, no new work)

If the per-daemon server were exposed via a plain outbound tunnel (e.g. cloudflared →
`127.0.0.1:<tunnelPort>`) that, **unlike the Dev Tunnels gateway, does NOT authenticate callers**,
a hostile internet client could:

1. **Self-enroll / harvest key material.** `POST /pair/complete` → `200` with the server's
   `ed25519PublicKey`, `x25519PublicKey`, `ed25519Fingerprint`, `machineId`, `tunnelUrl`,
   `githubLogin` (`pairRoutes.ts:108-119`). By sending its own `mobileEcdhPublicKey`, the attacker
   makes the server compute and return a `mobileSharedSecret` = `nacl.box.before(attackerKey,
   serverX25519Secret)` (`:100-104`) — i.e. it completes the TOFU pairing handshake. **The pairing
   handshake has no proof the caller is the operator's device.**
2. **Hit every "protected" route** (no-op `authenticate` in tunnel mode): create/list/mutate
   sessions (`sessionRoutes`, `v3SessionRoutes`), register push tokens (`pushRoutes`), read/write
   account + machine self state (`accountRoutes`, `machineSelfRoutes`), and **read plaintext session
   message bodies** via `GET /v3/sessions/:id/messages`. Plus unauthenticated `GET /files/*` when
   local storage is enabled (`api.ts:84-98`). **Caveat — `agentCommsIngestRoutes`** (`/agent-comms/ingest`):
   the *route* is app-auth-open, but the *handler* is independently fail-closed — it requires a
   TOFU-pinned peer, matching Ed25519 fingerprint/pubkeys, a valid Ed25519 envelope signature, an
   openable ECDH-sealed body, and (for spawns) `approvedForSpawn` (`agentComms/ingestHandler.ts:31-67`).
   So an unauthenticated caller can *reach* it and cause validation work, but cannot inject a valid
   agent-comms envelope or trigger a spawn without compromising a pinned peer.
3. **Open a Socket.IO `/v1/updates` connection** (websocket AND polling) with no token
   (`socket.ts:61-95` fail-open) → receive `update`/`tofu-pubkeys` events, emit session/machine
   updates, call RPC handlers.

**What stays protected vs. what does NOT:**
- **Session message CONTENT is NOT protected (verified).** The brainstorm's assumption that E2E
  ciphertext is a backstop is **wrong for the fork's session bodies**: the CLI sends
  `JSON.stringify(content)` with no `encrypt()` (`apiSession.ts:659`), the server stores it under a
  cosmetic `{t:'encrypted', c:<plaintext>}` label (`v3SessionRoutes.ts:166-168`), and the real-time
  receive path `JSON.parse`s it (`apiSession.ts:316`). A hostile reader of the message routes/socket
  gets **plaintext agent prompts, responses, and tool I/O**. (`encrypt` is imported but never called
  in `ApiSessionClient`; only `decrypt` is — and the one REST catch-up path that still calls `decrypt`
  at `:575` would fail on these plaintext rows, suggesting it is a vestigial/legacy path.)
- **Still protected:** **machine `metadata` / `daemonState`** are TweetNaCl-encrypted on the wire
  (per `daemon/AGENTS.md` §6; decrypted at `apiSession.ts:342,1039`), and **agent-comms ingest
  payloads** are signature+seal+approval gated at the handler (above). The `/agent-comms/ingest`
  inner gate is the one genuine fail-closed app-layer control on the tunnel listener.
- **Net:** route access, self-enrollment, session creation/read (plaintext), route enumeration,
  push-token registration, and the realtime socket are all WIDE OPEN. "E2E protects content" is NOT a
  valid safety assumption for this fork.

**Brainstorm's `curl -X POST https://<host>/pair/complete -d '{}'` → 200 with key material claim:
CONFIRMED** (with two refinements): (a) you must send `Content-Type: application/json` or Fastify
415s before the handler; (b) with an empty body you get the server pubkeys + fingerprint + machineId
+ tunnelUrl + githubLogin but NOT `mobileSharedSecret` — that field is only returned if the caller
includes `mobileEcdhPublicKey` (which any caller trivially can). The substance of the claim — an
unauthenticated caller gets server key material and completes pairing — holds. (Reading the handler
is sufficient; a live curl was not run in this read-only investigation.)

---

## (D) BOTTOM LINE — is "more verifier work" genuinely required?

**YES, more verifier work is genuinely required for safe public exposure. The brainstorm's core
"a naive provider-swap is a NO-GO" conclusion is CORRECT.** But the framing "from-scratch app-layer
auth build" is **only correct under one branch of the premise gate** — it is **overstated** under the
other branch. Precise verdict:

1. **Today there is real authentication — but it lives in the Dev Tunnels gateway, not in
   happy-server.** The fork deliberately moved the boundary to the transport. So the current
   Dev-Tunnels deployment is NOT "unauthenticated"; it's authenticated *at the gateway*.

2. **The public-exposure plan removes that authenticating transport** (a plain cloudflared tunnel
   forwards everything to the no-op-auth tunnel listener). That deletes the only boundary the fork
   has → ships an open `/pair/complete` + open routes + open socket to the internet. Hence new auth
   IS required. You cannot "just swap the tunnel provider."

3. **Two correct paths exist; only ONE is a from-scratch happy-server-verifier build:**
   - **D-002 (authenticating EDGE):** put Cloudflare Access service-token / mTLS in front of the
     UNCHANGED loopback server. happy-server source is untouched; `assertOperatorIdentityGate`'s
     loopback bind stays as a fail-closed backstop. This **restores an authenticating transport**
     (the same shape the fork already depends on with Dev Tunnels) — it is **NOT a happy-server
     verifier build**, and it is far less code. It is **not zero work**, though: it still needs the
     edge integrated for REST + the Socket.IO WebSocket upgrade + the polling fallback + native-app
     credential storage/refresh + CORS/preflight. Concrete acceptance criteria the edge must pass:
     (a) REST denied without edge credential; (b) Socket.IO websocket upgrade denied without it;
     (c) Socket.IO polling fallback denied without it; (d) BOOX app can obtain/store/refresh/send the
     credential; (e) the local-loopback bypass (`127.0.0.1:<tunnelPort>`) is accepted as in-scope or
     separately mitigated.
   - **D-001 (in-app device verifier):** build a new fail-closed per-request/per-handshake
     cryptographic verifier covering `/pair/complete`, every tunnel route, and the socket handshake
     (websocket + polling). This IS a from-scratch app-layer auth-plane build (XL), and it is the
     **only** option (not optional) under a **LAN / known-devices** direction or a hard **"no
     third-party auth boundary"** requirement — there is no edge to lean on there, so the device
     verifier *is* the boundary.

4. **"Just re-enable upstream's token auth" is NOT a free shortcut.** Upstream's auth is a
   multi-tenant GitHub-OAuth account system whose safety comes from per-user DB *data scoping* —
   which the fork also deleted (`25b9a573 drop multi-tenant userId scoping`). Re-importing it would
   mean partly reverting the fork's single-user architecture and still binding the token to the
   operator's specific device. So every path is real work; there is no "the auth is still there, just
   turn it back on" option.

5. **The dropped E2E encryption raises the stakes.** Because session bodies are plaintext at the
   server (see (C)), the consequence of ANY auth gap is not "attacker sees ciphertext" — it is
   "attacker reads the operator's agent conversations in cleartext." So the fail-closed boundary is
   even more load-bearing than the brainstorm assumed; partial/edge-only solutions must be verified
   to cover the message read routes + socket, not just `/pair/complete`.

**Decisive question the operator must answer (the premise gate):** is **"no third-party cloud auth
edge"** a hard requirement, or just **"nothing through Microsoft"**?
- If a Cloudflare auth edge is acceptable → **D-002 is the cheapest safe path** (no app-layer build),
  or D-001+mandatory-edge is the most robust.
- If "no third-party edge" is mandatory → the **D-001 app-layer verifier must carry 100% of the
  boundary** (highest-risk, biggest build), and the operator accepts that any tunnel vendor
  (Cloudflare included) can policy-block them exactly as Microsoft Dev Tunnels did.

**TL;DR for the operator:** Yes, the fork removed happy-server's own authentication and put the
boundary in the Dev Tunnels gateway. Public exposure swaps that gateway out, so the boundary must be
re-established — either as an authenticating edge (cheap, D-002) or as a new in-app device verifier
(expensive, D-001). The brainstorm is right that a bare provider-swap is unsafe; it slightly
overstates the cost by assuming the app-layer build is unavoidable when an edge can satisfy the
acceptance test with far less work.

---

### Evidence appendix (exact files compared)

| File | FORK (codexu) | UPSTREAM (slopus/happy@main) |
|---|---|---|
| `app/api/api.ts` | no-op `authenticateTunnel` (`:79`), `auth` switch (`:80`), tunnel-only routes (`:108-117`) | `enableAuthentication` (`:77`), full multi-tenant route set (`:99-114`), `host ?? '0.0.0.0'` (`:177`) |
| `app/api/utils/enableAuthentication.ts` | **absent** | real Bearer-token 401 gate (`:5-27`) |
| `app/auth/auth.ts` | no `verifyToken`/`verifier` | `verifyToken` + `createPersistentTokenVerifier` (`:42-45`,`:89-139`) |
| `app/api/socket.ts` | loopback-only cap check, tunnel fail-open (`:61-95`) | token-required fail-closed handshake (`:82-121`) |
| `app/api/routes/pairRoutes.ts` | unauthenticated `/pair/complete` + `/pair/connect` (`:59-150`) | **absent (HTTP 404)** |
| `index.ts` | `assertOperatorIdentityGate` loopback-bind gate (`:101-108`) | no such gate |
| `daemon/dualListenerBinding.ts` (happy-cli) | tunnel `auth:'tunnel'` + loopback `auth:'loopback'`, both bind `127.0.0.1` (`:56-69`) | n/a (fork-only embedded model) |
| `api/apiSession.ts` (happy-cli) | session send = `JSON.stringify(content)`, **no `encrypt()`** (`:659`,`flushOutbox :607-627`); real-time receive `JSON.parse(content.c)` plaintext (`:316`); `encrypt` imported but never called | (upstream CLI encrypts against the untrusted hosted server) |
| `app/api/routes/v3SessionRoutes.ts` (happy-server) | accepts `content: z.string()` (`:15`); stores/relabels as `{t:'encrypted', c: <client string>}` with **no server crypto** (`:166-168`,`:200-203`) | n/a |
| `agentComms/ingestHandler.ts` (happy-cli) | **fail-closed** handler: pinned-peer + Ed25519 sig + ECDH unseal + spawn-approval (`:31-67`) — the one real app-layer gate on the tunnel listener | n/a (fork-only) |

Investigation method: read fork source under `packages/happy-server` + `packages/happy-cli`; fetched
upstream equivalents via `gh api repos/slopus/happy/contents/...` (2026-06-27); diffed behavior +
cross-checked fork git history and `packages/happy-server/AGENTS.md`.
