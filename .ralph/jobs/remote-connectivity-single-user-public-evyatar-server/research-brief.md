# Research Brief — single-user PUBLIC happy-server on evyatar.dev (D-001-with-mandatory-edge)

## Researcher Findings
**happy-server**
- `index.ts:101-108` — `assertOperatorIdentityGate()`: blocks non-loopback bind unless `auth === "loopback"`. Auth union: `"tunnel"|"loopback"` (`:21-29,40-47`).
- `app/api/api.ts:78-80,104-116` — `authenticateTunnel` is a no-op; `authenticate` = loopback verifier or tunnel no-op. tunnel-only routes: pairRoutes, pushRoutes, sessionRoutes, devRoutes, versionRoutes, agentCommsIngestRoutes, v3SessionRoutes; both-listener: accountRoutes, machineSelfRoutes. pairRoutes mounted only when auth!=="loopback" (`:107-113`).
- `pairRoutes.ts:35-56,59-119,121-150` — 30/min/IP rate limit; `/pair/complete` returns githubLogin + machine{machineId,tunnelUrl,ed25519PublicKey,x25519PublicKey,fingerprint?,mobileSharedSecret?}; `/pair/connect` same key material, NO rate limit; neither has app-layer auth.
- `socket.ts:56-95,98-149` — ws/polling handshake; loopback branch checks X-Loopback-Capability, tunnel branch accepts; transports `['websocket','polling']` (`:107`).
- `auth/loopbackCapability.ts:7-34` — reusable fail-closed verifier (X-Loopback-Capability → 401 invalid_loopback_capability).
- Test: Vitest node, colocated *.test.ts; `test=vitest run`, `typecheck=tsc --noEmit`, `build=tsc --noEmit && pkgroll`.

**happy-cli**
- `tunnel/provider.ts:14-18` — DaemonTunnelProvider (createHostTunnel/loadHostTunnel/stop).
- `daemon/run.ts:209-246` — `new DevTunnelsDaemonProvider(...)`; writeMachineState; loopbackCap/profile/accountSettings.
- `tunnel/devTunnelsDaemonProvider.ts:58-93` — provider precedent.
- `daemon/dualListenerBinding.ts` — tunnel listener auth:"tunnel", loopback listener auth:"loopback"; natural place to select auth:"public".
- `persistence.ts` — MachineLocallyPersistedState {machineId,tunnelPort,loopbackPort,tunnelId,lastTunnelUrl}.
- `tofu/keypairManager.ts` — daemon Ed25519+X25519 under ~/.happy. `agentComms/peerAuth.ts` — stable-JSON signing, Ed25519 verify, X25519 seal, TOFU pin, fingerprints (reuse).
- `AGENTS.md` — "never expose app-server on 0.0.0.0"; tunnels private, X-Tunnel-Authorization tunnel <jwt>.

**happy-app**
- `sync/serverConfig.ts:8-79` — get/set/validateServerUrl + per-machine override.
- `sync/socketOptions.ts:18-44` — path /v1/updates, transports `['websocket']` (NOT polling), headers via getMachineAuthHeaders().
- `auth/pairing.ts:139-176` — TOFU; sends X-Tunnel-Authorization tunnel <connectToken> to /pair/complete.
- `auth/machineAuth.ts` — getMachineAuthHeaders() only Dev Tunnels. `auth/tokenStorage.ts` — AUTH_CREDENTIALS_KEYS strips unknown fields.
- `app/(app)/server.tsx:78-145` — custom server settings, validates GET / "Welcome to Happy Server!".

**codex** — `features/src/lib.rs` Feature::RemoteSession (key remote_session, Experimental, default off; /remote on|off). `codex-happy/src/remote_on.rs` self-onboard. `codex-happy/src/auth.rs` builds local 127.0.0.1:<tunnelPort>; `daemon_supervisor.rs` local. Keep loopback attach unchanged.

**docs** — `security-model.md` (Dev Tunnels boundary), `fork-notes.md` (retired central tunnel), `AGENTS.md` (per-daemon embedded).

## Architect Analysis
- Hook point: `api.ts:58-110` configureApi() — CORS, decorate auth, startSocket() BEFORE routes; pairRoutes mounted auth!=="loopback" (`:107-113`). Gate at `index.ts:101-118`. Socket `io.use(createSocketAuthMiddleware)` before connection. CORS allowedHeaders include X-Tunnel-Authorization,X-Loopback-Capability,X-Happy-Client (`api.ts:61-64`).
- Build order: happy-wire → happy-server → happy-app/happy-cli/happy-agent.
- Crypto already Ed25519+X25519 (`api.ts:30-36`, `happy-wire/src/tofu.ts:4-30`); shared secret via tweetnacl.box.before (`pairRoutes.ts:99-103,134-138`).
- Model remoteDeviceAuth.ts on loopbackCapability.ts; single helper for HTTP+socket; cover both ws+polling (`socket.ts:107,136`); revocation needs TOFU invalidation; replay+skew explicit; relaxing gate is regression unless verifier active; non-upstreamable.

## Codex Research
- auth is closed union across server/api/socket/tests/CLI types + `happy-cli/src/types/happy-server.d.ts`.
- `/pair/complete` cannot use post-pair device verifier (no device yet) → separate pairing-window + QR secret gate.
- Server/CLI have @noble/ed25519,@noble/hashes,tweetnacl; happy-app does NOT → needs RN-compatible crypto. tokenStorage AUTH_CREDENTIALS_KEYS must add new fields. socketOptions transports `['websocket']` must add polling. Codex same-machine attach stays loopback. Order: verifier first → auth:"public" → tighten gate → split pairing → route+socket tests → CloudflareProvider → app proofs → codex gate → docs.

## Copilot Research
Failed: read-only snapshot budget exceeded on .xwin-cache (548MB). Not run.

## Consolidated File List
**Modify (happy-server):** index.ts, app/api/api.ts, app/api/socket.ts, app/api/routes/pairRoutes.ts; NEW app/api/auth/remoteDeviceAuth.ts; tests.
**Modify (happy-cli):** daemon/run.ts, daemon/dualListenerBinding.ts, persistence.ts, types/happy-server.d.ts; NEW tunnel/cloudflareTunnelDaemonProvider.ts.
**Modify (happy-app):** sync/socketOptions.ts, sync/serverConfig.ts, auth/machineAuth.ts, auth/pairing.ts, auth/tokenStorage.ts.
**Modify (codex):** features/src/lib.rs, codex-rs-overlay/codex-happy/src/remote_on.rs.
**Reuse:** auth/loopbackCapability.ts, agentComms/peerAuth.ts, tofu/keypairManager.ts, happy-wire/src/tofu.ts.
**Docs:** docs/security-model.md, docs/fork-notes.md, AGENTS.md, packages/happy-cli/AGENTS.md.
