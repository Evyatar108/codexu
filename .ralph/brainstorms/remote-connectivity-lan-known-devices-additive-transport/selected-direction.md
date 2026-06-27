---
overviewTaskId: remote-connectivity-lan-known-devices-additive-transport
---

## Direction
D-001 — Additive opt-in LAN listener gated by a NEW fail-closed server-side per-device cryptographic auth mode. Add a LAN remote-session transport alongside (never replacing) Dev Tunnels, where the "known devices" allowlist is enforced cryptographically per-request at the embedded happy-server listener — the only design all three lenses agree is both feasible and safe.

> **PLAN-PHASE PRECONDITION (resolve before/at planning):** confirm with the operator that D-002 (reuse the existing `happy.evyatar.dev` Cloudflare Tunnel via a provider-swap) is genuinely ruled out — i.e. that "WITHOUT routing through Microsoft/**cloud**" is a hard requirement. The Devil's-Advocate lens (red_flag) showed a Cloudflare `DaemonTunnelProvider` swap would preserve the entire security model with ZERO teardown and could make this LAN effort unnecessary. If "no cloud at all" is mandatory, proceed with D-001 as below.

## Goal
A codexu user whose corporate policy blocks Microsoft Dev Tunnels can opt into a LAN remote-session transport: their per-machine happy daemon binds an additional happy-server listener reachable from the same trusted network, the Android e-ink tablet (BOOX) connects to it directly, and **only explicitly-blessed ("known") devices can reach the session plane**, enforced by a server-side cryptographic per-request gate. The existing Dev Tunnels path is byte-for-byte unchanged and remains the default; LAN is a user-selectable, opt-in, default-off alternative gated by the codex experimental-features mechanism.

## Scope
### In Scope
- A new happy-server auth mode (e.g. `CreateAppConfig.auth: 'lan'`) that EXTENDS `assertOperatorIdentityGate` (`packages/happy-server/sources/index.ts:101-108`) to permit a non-loopback bind ONLY when a per-request device verifier is active, and a `lanDeviceAuth` verifier applied across the tunnel route surface (`api.ts:104-117`), `/pair/complete` (`pairRoutes.ts:59-119`), and the Socket.IO handshake (`socket.ts`).
- A `LanDaemonProvider` implementing the existing `DaemonTunnelProvider` interface (`packages/happy-cli/src/tunnel/provider.ts:14-18`), selected at `packages/happy-cli/src/daemon/run.ts:210-242`, advertising the LAN address; `dualListenerBinding.ts` wiring to bind the LAN listener.
- The "known devices" enforcement: cryptographic, per-request, fail-closed, reusing the existing Ed25519/X25519 TOFU pairing key material where possible (`packages/happy-app/sources/auth/pairing.ts`, daemon `tofuPublicKeys`). Mechanism choice (signed-request vs mTLS vs HMAC+nonce) to be settled in planning.
- happy-app changes to learn the LAN endpoint + attach the device proof (`sources/sync/tunnelProvider.ts`, `sources/sync/socketOptions.ts`, `sources/auth/*`) and a Settings opt-in toggle; a way to view/revoke known LAN devices.
- Codex opt-in: gate the LAN variant via the `Feature` enum (default off; `codex/external/repos/codex-patched/codex-rs/features/src/lib.rs:171` pattern) and the `/remote on` surface (`codex/codex-rs-overlay/codex-happy/src/remote_on.rs`).
- Update `docs/security-model.md` and the fork's "never expose on 0.0.0.0/LAN/tunnels" invariant (`packages/happy-cli/AGENTS.md`) to formally record the reviewed, gated exception.

### Out of Scope
- Any change to the default Dev Tunnels behavior, the loopback listener, or codex-happy's same-machine loopback attach (it is unaffected — it always uses `127.0.0.1:<tunnelPort>`).
- An IP allowlist, host allowlist, or mDNS-name trust used AS the security boundary (explicitly NO-GO — see Criteria). mDNS may exist only as non-security discovery convenience.
- Implementing D-002 (Cloudflare provider-swap) or D-003 (WireGuard mesh) — both are captured as alternatives; D-002 is a gating question, D-003 a fallback if mTLS-in-RN proves infeasible.
- A multi-tenant / central happy-server (the architecture is one embedded server per daemon).

## Criteria
- Dev Tunnels remains the default and works unchanged; LAN is opt-in and default-off (codex Feature flag off by default).
- The LAN listener does NOT bind to any non-loopback interface unless the cryptographic per-device verifier is active; `assertOperatorIdentityGate` still throws on a bare non-loopback bind without it.
- A HOSTILE-client test: an unpaired/unblessed device on the same LAN that can reach the LAN listener is **fail-closed rejected** on `/pair/complete`, every tunnel-only HTTP route, AND the Socket.IO handshake — it cannot self-enroll, create a session, enumerate version/dev routes, or trigger any meaningful server behavior. (This is the decisive acceptance test; it is what rules out IP/mDNS allowlists.)
- A blessed device (pinned key) successfully completes a remote session from the BOOX over Wi-Fi with Dev Tunnels disabled.
- Existing happy-server, happy-cli, and happy-app tests pass; the new auth mode has its own coverage (including the dual-listener non-crossing-auth invariant, cf. `dualListenerBinding.test.ts` / `index.spec.ts`).

## Context
- **Three-lens convergence (full mode: codex + copilot + devils-advocate).** All three independently identified the same crux: the Dev Tunnels gateway provides BOTH reachability and authentication; the tunnel listener has zero per-request auth and "collapses identity to `tofuConfig.localUserId`". A naive LAN bind keeps reachability but deletes authentication. Codex source-verified the concrete bypass: `/pair/complete` (`pairRoutes.ts:59-119`) is unauthenticated, so any LAN host hitting a 0.0.0.0 bind can self-enroll. Therefore IP/host/mDNS allowlists alone are unanimously NO-GO; the boundary must be a server-side, per-request, cryptographic, fail-closed gate.
- **Devil's-Advocate red_flag — the premise challenge (D-002):** the operator already runs a Cloudflare Tunnel (`happy.evyatar.dev`) that survives their corporate network. Because `cloudflared` is outbound-only, a provider-swap preserves the security model with zero teardown and could dominate a bespoke LAN listener on every axis except true offline use. This is captured as the plan-phase precondition above. The single cheapest disconfirmation of the whole effort: "does the tablet reach `happy.evyatar.dev` over the corp network, and is no-cloud mandatory?"
- **Physical reachability is itself a NO-GO risk:** if the corp Wi-Fi uses AP/client isolation or filters inbound LAN ports, NO same-LAN transport is reachable. Run a raw peer-to-peer connection probe on the actual corp Wi-Fi before committing (D-003's cheapest validation doubles as this probe).
- **Selectability seams are real and minimize forking:** `DaemonTunnelProvider` (provider abstraction), the happy-server `auth` mode + `assertOperatorIdentityGate`, and the codex `Feature` gate. The provider only abstracts tunnel setup/URL; the auth change is happy-server-side.
- **Conflict surface:** XL, spanning happy-server, happy-cli (daemon/tunnel/persistence), happy-app (sync/auth/settings), and the codex Feature gate + `/remote on` overlay. Overlaps the recently-shipped autoconnect/self-onboard/cancellation work in `codex-happy/src/remote_on.rs` + `daemon_supervisor.rs` (coordinate). Largely fork-only and not cleanly upstreamable (the `assertOperatorIdentityGate` dual-listener model is fork-local Sprint-A code).
- **Open questions to resolve in planning** are listed in `brainstorm.json` / `brainstorm-synthesis.md`: enforcement mechanism, concurrent-vs-selected listener, discovery + IP-churn handling, device-revocation UI, and formal sign-off for relaxing the no-LAN-exposure invariant.
- Full per-lens analysis: `brainstorm-synthesis.md` (this directory).
