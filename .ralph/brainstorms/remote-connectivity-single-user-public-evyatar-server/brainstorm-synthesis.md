Lenses: ran=[codex, copilot, devils-advocate]; skipped=[] (full mode)

# Brainstorm synthesis — single-user PUBLIC happy-server on evyatar.dev (QR/E2E-secured, outbound-tunnel transport)

**Idea:** Build a SINGLE-USER (single-tenant) happy-server exposed PUBLICLY on the operator's own
`evyatar.dev` domain as the codexu remote-session transport, secured the way Happy already works
(QR-code device pairing + E2E encryption), reached via an OUTBOUND-ONLY tunnel (e.g. Cloudflare named
tunnel) so it works remotely from anywhere and sidesteps the corporate Microsoft-Dev-Tunnels block.
This REPLACES the shelved same-LAN approach (`remote-connectivity-lan-known-devices-additive-transport`).
Primary device: Android e-ink tablet (BOOX).

## The one load-bearing finding all three lenses converged on (front and center)

**The premise "QR-pairing + E2E is the security boundary, so public exposure is safe" is FALSE against
source.** Today the *entire* security boundary is the **Microsoft Dev Tunnels gateway** authenticating
callers before forwarding. The embedded happy-server's tunnel-mode listener is effectively
**unauthenticated at the application layer**, verified at:

- `packages/happy-server/sources/app/api/api.ts:79` — `authenticateTunnel` is a literal **no-op**
  (`async function (_request){}`); every "authenticated" tunnel route is guarded by it.
- `packages/happy-server/sources/index.ts:101-108` — `assertOperatorIdentityGate` **forces a 127.0.0.1
  bind** precisely BECAUSE the app layer trusts the gateway ("collapses identity to localUserId").
- `packages/happy-server/sources/app/api/routes/pairRoutes.ts:59-119` — `POST /pair/complete` has **no
  app-layer auth** and returns server key material (`ed25519PublicKey`, `x25519PublicKey`, fingerprint,
  and a derived `mobileSharedSecret`) to ANY caller, behind only a 30/min **per-IP** rate limit (a
  botnet bypasses it trivially).
- `packages/happy-server/sources/app/api/socket.ts:57-92,136` — the Socket.IO handshake only enforces a
  capability in **loopback** mode; in tunnel mode it is **fail-open**.

**Decisive disconfirmation (the acceptance test fails out of the box):** from any unpaired internet host,
`curl -X POST https://<host>/pair/complete -d '{}'` returns **200 with key material** today. E2E
encryption protects message *content*; it does NOT gate route *access* or self-enrollment.

**Unanimous verdict:** this is NOT a transport swap — it is a **from-scratch application-layer auth-plane
construction project on a security boundary.** A plain outbound tunnel (cloudflared) gives reachability
but NOT authentication, so naively pointing it at the existing tunnel-mode listener ships an OPEN
key-material endpoint to the public internet. The "single-user" constraint does NOT simplify this; it
**removes the only blast-radius limiter** — one auth gap = total compromise of the operator's whole agent
fleet. The fix must be a server-side, per-request/per-handshake, cryptographic, **fail-closed** gate
covering `/pair/complete`, EVERY tunnel-only HTTP route, AND the Socket.IO handshake (incl. its polling
fallback), enforced BEFORE any non-loopback exposure — OR an authenticating edge that does the same.

## Existing seams that make this feasible (verified)

- **App already targets a custom server URL (reuse, not new):** `packages/happy-app/sources/sync/serverConfig.ts:8-44`
  (`getServerUrl/setServerUrl/validateServerUrl`, default `http://127.0.0.1:3005`), Settings UI at
  `packages/happy-app/sources/app/(app)/server.tsx`, `EXPO_PUBLIC_HAPPY_SERVER_URL` override. Pointing a
  device at `https://happy.evyatar.dev` needs no new app code.
- **Pluggable transport provider (single seam):** `DaemonTunnelProvider` interface
  (`packages/happy-cli/src/tunnel/provider.ts:14-18`); the only construction site is
  `packages/happy-cli/src/daemon/run.ts:211` (`new DevTunnelsDaemonProvider(...)`). A
  `CloudflareTunnelDaemonProvider` slots in here. NOTE: the provider only abstracts tunnel setup/URL — it
  does NOT change listener auth.
- **Reusable fail-closed primitive:** `packages/happy-server/sources/app/api/auth/loopbackCapability.ts`
  is a per-request fail-closed 401 verifier (`X-Loopback-Capability` vs a file secret). The public server
  needs an analogous but STRONGER "remote-capability" verifier whose credential is a paired-device
  Ed25519 signature over a server nonce, wired into a new `auth` mode + `assertOperatorIdentityGate`.
- **QR/E2E TOFU pairing already exists:** `packages/happy-app/sources/auth/pairing.ts` (Ed25519/X25519).
- **Codex opt-in gate:** `features/src/lib.rs` Feature enum (default off; `--enable`/`-c features.x=true`),
  `/remote on` surface in `codex/codex-rs-overlay/codex-happy/src/remote_on.rs`.
- **Architecture fit:** happy-server is embedded one-per-daemon ("exactly one user per process",
  `packages/happy-server/AGENTS.md`). A single-user PUBLIC server is the SAME one-user-per-process server,
  reachable remotely via an outbound tunnel instead of only loopback+Dev-Tunnels — consistent with the
  fork's "no shared multi-tenant broker" posture because it is the operator's OWN daemon's server.

---

## Candidate directions

### D-001: Public per-daemon endpoint = NEW fail-closed app-layer paired-device verifier (the operator's QR/E2E boundary) + MANDATORY authenticating edge as defense-in-depth  [RECOMMENDED]
- Contributing lenses: [codex, copilot, devils-advocate]
- Why this might work: directly delivers the operator's ask AND makes the stated "QR+E2E is the boundary"
  model actually TRUE. Expose the embedded server over an outbound Cloudflare tunnel to evyatar.dev via a
  `CloudflareTunnelDaemonProvider` on the existing `DaemonTunnelProvider` seam. Add a new happy-server
  `auth: 'public'` mode that permits a tunnel/non-loopback exposure ONLY when a fail-closed per-request
  device verifier is active: it (i) **replaces the no-op `authenticateTunnel`** with an Ed25519
  challenge-response over a server nonce from an already-paired device, (ii) **closes the socket
  fail-open branch** so the handshake (websocket AND polling) demands the same proof, and (iii) **closes
  `/pair/complete`** to a pre-shared-QR-secret + short operator-opened pairing window + replay-protected
  nonce (open self-enrollment becomes 401 outside the window). Gate the whole variant behind the codex
  `Feature` enum (default off) + `/remote on`. App reuses the existing custom-server-url + QR/E2E pairing.
  Layer a **mandatory Cloudflare Access service-token / mTLS edge** in front as defense-in-depth: it gives
  a fail-closed boundary on day one (passing the acceptance test immediately) while the app-layer verifier
  is hardened, and it covers any route accidentally left open during the build.
- Risks / friction: XL surface — happy-server (`index.ts`, `api.ts`, `socket.ts`, `pairRoutes.ts`, new
  `remoteDeviceAuth.ts`), happy-cli (`cloudflareTunnelProvider.ts`, `run.ts`, persistence), happy-app
  (attach device proof in `sync/socketOptions.ts` + settings), codex `Feature` + `/remote on`. A subtly
  wrong verifier is a WORSE open door than today because it looks secure. Every route
  (pair/account/machineSelf/session/v3Session/push/version/dev) + the socket polling transport + CORS
  preflight + `/pair/connect` must be covered with NO gap. e-ink pairing-window UX (clock skew, retries on
  a slow BOOX). Device revocation = one all-powerful identity, no per-tenant containment. Reintroduces a
  cloud/vendor dependency (Cloudflare could DLP-block like Microsoft did). Fork-only; relaxes the fork's
  own "never expose on 0.0.0.0/LAN/tunnels" invariant (`packages/happy-cli/AGENTS.md`) — needs a reviewed
  amendment + `docs/security-model.md` update.
- Cheapest validation: stand up a disposable staging subdomain behind Cloudflare Access in front of a
  hardened build where `/pair/complete` is closed except during a short operator pairing window; prove a
  BOOX can pair + attach once, an unauthenticated `curl /pair/complete` returns 401 (no key material), and
  the Socket.IO upgrade (websocket AND polling) is rejected without the device proof.
- Disconfirming observation: if Socket.IO `/v1/updates` (websocket + polling), `/files/*`, `/pair/*`, and
  every tunnel-only route cannot ALL be covered by one fail-closed verifier without an auth-plane gap, the
  app-layer boundary is unsafe as specified; and if Cloudflare Access cannot gate the WebSocket upgrade
  with the same fail-closed policy it applies to REST, the edge defense-in-depth leaks at the socket.

### D-002: Edge-only — terminate auth at the Cloudflare EDGE (Access service-token / mTLS); keep happy-server loopback-only and UNCHANGED  [strongest if "cloud auth edge" is acceptable]
- Contributing lenses: [devils-advocate (strongest single reframe), codex, copilot]
- Why this might work: strictly LESS code and LESS risk than building an app-layer verifier. cloudflared
  connects to `127.0.0.1:<port>` exactly as today, so `assertOperatorIdentityGate` stays intact and
  happy-server source is UNTOUCHED — there is no new N-route auth plane to get wrong. A Cloudflare Access
  service-token / mTLS policy at the edge replaces the Dev Tunnels gateway 1:1; the loopback bind is a
  fail-closed backstop if the edge is bypassed. The decisive acceptance test is satisfied at the edge.
- Risks / friction: reintroduces a cloud trust dependency + single vendor kill-switch (the SAME failure
  mode that killed Dev Tunnels — Cloudflare can policy-block too); a misconfigured/disabled Access policy
  **fails OPEN silently** (the loopback backstop catches REST but the socket is the historical fail-open
  spot). Does NOT match the operator's "secured the way Happy already works (QR+E2E)" intent — the boundary
  is an edge token, not in-app pairing. BOOX must reliably present a service-token / client-cert (Android
  e-ink renewal UX). Diagnostics must distinguish edge-rejection vs app-rejection.
- Cheapest validation: put cloudflared + a Cloudflare Access service-token (or mTLS) in front of an
  UNMODIFIED loopback happy-server; `curl https://happy.evyatar.dev/pair/complete` with no token (expect
  403 at edge) and with token (reaches app); then test the Socket.IO `/v1/updates` upgrade through the
  edge with and without the token.
- Disconfirming observation: if Cloudflare Access cannot gate the WebSocket upgrade (websocket + polling)
  with the same fail-closed policy as REST, the real-time plane leaks and the edge-only reframe collapses.
  Also disconfirmed if "no third-party cloud auth edge" turns out to be a hard operator requirement.

### D-003: On-demand / ephemeral tunnel — bring the public endpoint up only WHILE a session is active, tear down after (surface reduction; a MODIFIER on D-001/D-002)
- Contributing lenses: [devils-advocate, copilot]
- Why this might work: a single occasional user does not justify a permanently internet-exposed endpoint
  on a stable, guessable hostname. The operator's `/remote on` toggle raises the tunnel on demand and
  drops it after, shrinking the self-enrollment / route-enumeration / credential-abuse window from
  "always" to "minutes." Composes with whichever auth model (D-001 or D-002) wins.
- Risks / friction: `/pair/complete` returns and the app CACHES a fixed `tunnelUrl`
  (`pairRoutes.ts:106-117`, daemon `machine.json`); ephemeral tunnels rotate the URL, which may break
  reconnect/persistence on a slow e-ink BOOX that expects a stable endpoint. Cloudflared cold-start
  latency degrades the "just works from anywhere" feel. A NAMED Cloudflare tunnel keeps a stable hostname
  while still being on-demand, which mitigates most of this.
- Cheapest validation: measure cloudflared cold tunnel-up time; test whether the BOOX Happy app tolerates
  a changed `tunnelUrl` across reconnects (does it re-pair or hard-fail?).
- Disconfirming observation: if the app cannot rotate `tunnelUrl` without re-pairing (the cached
  `machine.json` tunnelUrl is load-bearing for reconnect), ephemeral tunnels break persistence and a
  standing endpoint is forced — making surface reduction infeasible without app-side changes.

### D-004: Separate thin relay on evyatar.dev that forwards only opaque encrypted frames to the local daemon  [single-lens; likely NO-GO / out of scope]
- Contributing lenses: [codex]
- Why this might work (in theory): a relay that only forwards E2E frames could keep the daemon fully
  private.
- Risks / friction: reintroduces a central-server / second control-plane — exactly the architecture the
  fork rejects (the embedded per-daemon happy-server must remain the session plane). Current routes carry
  server-side session semantics that cannot all be opaque frames, so the relay either becomes a second
  happy-server or fails to support existing behavior. XL, new protocol + deployment surface.
- Cheapest validation: enumerate which HTTP routes require server-side plaintext/session state vs which
  can be opaque frames — if more than a handful need first-class handling, the relay is a second server.
- Disconfirming observation: if any session/v3session route needs server-side semantics, the relay is not
  a thin forwarder. Recommend SKIP unless D-001/D-002 are both ruled out.

### D-005: Reject public exposure; keep LAN/mesh as the only transport  [single-lens; anti-direction]
- Contributing lenses: [copilot]
- Why this is captured: completeness.
- Risks / friction: the operator ALREADY shelved LAN (it does not work remotely from arbitrary networks;
  corp Wi-Fi AP/client-isolation and blocked UDP make it unreliable). This direction fails the core
  "works from anywhere" requirement. Keep LAN only as a niche OFFLINE fallback after the public endpoint
  is proven safe.

---

## Recommendation & feasibility

**Recommended direction: D-001** — the public per-daemon endpoint with a NEW fail-closed app-layer
paired-device verifier (making the operator's QR/E2E boundary real) PLUS a mandatory Cloudflare Access /
mTLS edge as defense-in-depth — because it is the operator's explicit ask, honors the "secured the way
Happy already works" intent, and the layered model de-risks the high-stakes app-layer build (a single gap
= total compromise) by giving a fail-closed edge boundary on day one.

**PUBLIC-EXPOSURE SECURITY VERDICT (load-bearing, front and center): GO — but ONLY conditioned on hard,
non-negotiable security preconditions. A naive "swap the tunnel provider and expose the existing listener"
is a NO-GO that ships an open key-material self-enrollment endpoint to the internet.** The conditions:

1. **Build the fail-closed verifier FIRST (hard gate).** No non-loopback exposure until a per-request /
   per-handshake cryptographic device verifier covers `/pair/complete`, EVERY tunnel-only HTTP route, AND
   the Socket.IO handshake (websocket + polling), fail-closed. `assertOperatorIdentityGate` must keep
   throwing on a bare public bind without it. The decisive acceptance test (hostile internet client cannot
   self-enroll / create a session / enumerate routes / read plaintext) must pass.
2. **Close `/pair/complete` open enrollment.** Pre-shared QR secret + short operator-opened pairing window
   + replay-protected nonce; closed (401, no key material) outside the window. The per-IP rate limit is
   NOT an abuse control (botnet-bypassable) and must not be leaned on for self-enrollment defense.
3. **Mandatory authenticating edge as defense-in-depth** (recommended) — Cloudflare Access service-token /
   mTLS — proven to gate the WebSocket upgrade with the same fail-closed policy as REST.

**Premise gate the operator must answer BEFORE planning:** is **"no cloud / no third-party auth edge"** a
hard requirement, or just **"nothing through Microsoft specifically"**? This is decisive:
- If a Cloudflare auth edge is acceptable → **D-002 (edge-only)** is dramatically cheaper and safest-per-
  line, OR D-001-with-mandatory-edge is the most robust. Either way the app-layer build can be staged.
- If "no third-party edge" is mandatory → the app-layer verifier (D-001) must carry **100%** of the
  boundary (highest-risk, but the only path), and the operator must accept that any tunnel vendor
  (Cloudflare included) can policy-block them exactly as Dev Tunnels did.

## Open questions to carry into planning

- **Premise gate (answer first):** "no cloud auth edge" hard requirement, or just "no Microsoft"? (Decides
  D-001-layered vs D-002-edge-only vs D-001-app-layer-only.)
- Enforcement mechanism for the app-layer verifier: Ed25519 signed-request reusing TOFU keys vs mTLS
  client certs vs HMAC+nonce — best balance of airtight-ness vs React-Native/BOOX feasibility?
- Can the chosen mechanism (edge token OR app-layer Ed25519) gate the Socket.IO `/v1/updates` WebSocket
  upgrade AND its polling fallback with the same fail-closed guarantee? (The single most likely gap.)
- `/pair/complete` pairing-window UX on e-ink: who opens it, how long, clock-skew tolerance, retries; how
  is the pre-shared QR secret generated and surfaced?
- Standing vs on-demand (D-003): does the operator need a 24/7 endpoint, or does `/remote on`-gated
  ephemeral exposure meet the usage pattern? Can the BOOX tolerate a rotating `tunnelUrl`, or must the
  Cloudflare tunnel be NAMED (stable hostname) to preserve reconnect/persistence?
- Threat model for a leaked cloudflared credential on this Windows box (note the LocalSystem-profile
  cred-path gotcha in fork AGENTS.md); device revocation / key-rotation story for a lost BOOX.
- Cert/DNS lifecycle on evyatar.dev; coexistence with / replacement of the Dev Tunnels default
  (provider selection, default-off codex Feature gate).
- **Docs reconciliation (follow-up):** the fork's `AGENTS.md` + `docs/fork-notes.md` still say "never
  happy.evyatar.dev / never a Cloudflare provider-swap." The operator's 2026-06-27 decision (a SINGLE-
  TENANT personal server — NOT the retired multi-tenant dev instance, NOT a shared broker) supersedes
  that; the planning/impl phase must update those docs + the `packages/happy-cli/AGENTS.md`
  no-exposure invariant + `docs/security-model.md` in lockstep.

## Relationship to the shelved LAN brainstorm (D-001 there)

This task REPLACES `remote-connectivity-lan-known-devices-additive-transport`. Reusable from that
brainstorm: the **server-side fail-closed per-request cryptographic device-auth analysis is the SAME core
problem** (the LAN plan's "new happy-server auth mode + per-device verifier covering /pair/complete + all
routes + socket handshake" maps directly onto D-001 here, just with an outbound tunnel instead of a LAN
bind). The LAN brainstorm's devil's-advocate **D-002 (outbound Cloudflare provider-swap)** is essentially
the seed of THIS task — now refined to a single-user public server with the public-exposure hardening made
explicit. LAN survives only as a niche OFFLINE fallback (D-005 here).

Full per-lens analysis: staged lens outputs (codex/copilot/devils-advocate) summarized above; verified
source findings preserved in this run's staging `source-findings.md`.
