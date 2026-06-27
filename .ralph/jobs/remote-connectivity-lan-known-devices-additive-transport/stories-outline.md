# Stories Outline: Additive opt-in LAN known-devices remote-session transport

*Preliminary decomposition from `/plan-with-ralph` (Phase-4 reviewed: 17 findings from Claude+codex+copilot, all resolved). Feed to `/implement-with-ralph --from-plan` for PRD generation. Clusters/ordering in `suggested-decomposition.json`.*

## US-001: LAN bind/reachability + worktree preflight
**Description:** As the operator, I want to confirm a non-loopback happy-server bind is reachable on the corp Wi-Fi and that the worktree's submodules resolve, so that we stop before the XL build if the physical LAN path or codex paths are unviable.
**Acceptance Criteria:**
- [ ] A throwaway probe confirms happy-server's `app.listen({ host })` (`index.ts:~195`) actually binds a non-loopback interface when the gate is bypassed, and the chosen LAN port is reachable from a second host on the corp Wi-Fi (operator-confirmed reachable 2026-06-27; this validates the happy-server-specific bind+port).
- [ ] `git submodule update --init --recursive` run and `codex/external/repos/codex-patched/codex-rs/features/src/lib.rs` + `codex/codex-rs-overlay/codex-happy/src/remote_on.rs` confirmed to resolve.
- [ ] NO-GO criteria documented (AP/client-isolation or inbound-port filtering ⇒ stop).
**Dependencies:** None
**Estimated complexity:** small

## US-002: `auth:'lan'` contract + `lanDeviceAuth` verifier core + allowlist/enrollment + transport/opt-in contract
**Description:** As an implementer, I want the cross-cutting LAN security + transport contract frozen first, so that the cli, app, and codex clusters bind to a stable shape.
**Acceptance Criteria:**
- [ ] `'lan'` added to the `auth` union in `index.ts:25` (`HappyServerConfig`), `index.ts:45` (`CreateAppConfig`), `api.ts:51` (`ConfigureApiOptions`), `socket.ts:19` (`StartSocketOptions`).
- [ ] A `lanDeviceAuth.ts` verifier core lives in happy-server (or shared `happy-wire`), reusing the `agentComms/peerAuth` PATTERN via happy-server's own `@noble/ed25519`/`@noble/hashes`/`tweetnacl`/`privacy-kit` deps — NO import from happy-cli internals.
- [ ] The canonical signed-request form is fully specified: exact signed header name(s), canonical path+query handling, body-hash algorithm, timestamp-skew window, nonce store + lifetime, and the socket-handshake canonical form — documented and unit-tested (valid/expired/replayed/forged).
- [ ] A known-device allowlist/pin store (mirroring `peerAuth`'s `peers.json` + Ed25519 fingerprint-change rejection) is defined, with LAN-gated `device-list` and `device-revoke` server routes (their own auth = the LAN verifier).
- [ ] The out-of-band enrollment design is concrete: a daemon-side mint/display/expire mechanism for a one-time QR/PIN secret (named happy-cli command/startup-output/control route, with expiry + rate-limit), and the rule that `/pair/complete` on LAN requires that secret (no self-enrollment).
- [ ] A discriminated `transport: 'dev-tunnels' | 'lan'` variant (or optional Dev-Tunnels-only fields) is added to BOTH `packages/happy-cli/src/tunnel/types.ts` and `packages/happy-wire/src/tunnel/types.ts` (LAN has no `tunnelId`/`tunnelName`/`tags`/`owner`/connect-token).
- [ ] The happy-cli daemon opt-in shape (env/config/CLI) and advertised LAN URL shape are specified.
- [ ] Listener-concurrency decision recorded (Option B single selected remote listener recommended).
- [ ] Typecheck passes (`pnpm --filter happy-server build`).
**Dependencies:** US-001
**Estimated complexity:** large

## US-003: Server gate relaxation + global enforcement hook + socket lan branch + `/pair/complete` gate + CORS + `.d.ts` mirror
**Description:** As the operator, I want the LAN listener to refuse every unauthenticated request, so that exposing it on the LAN does not delete the trust root.
**Acceptance Criteria:**
- [ ] `assertOperatorIdentityGate` (`index.ts:101-108`) permits a non-loopback bind ONLY when a live LAN verifier is present; it still throws on a bare non-loopback bind without the verifier (unit test). The gate's error string describes the LAN carve-out condition.
- [ ] The verifier is registered as a global hook that fires on EVERY registered route (the bare `GET /` at `api.ts:66`, `enableMonitoring`'s `GET /health`, `/files/*`, both-listener routes, all tunnel-only routes, device-list/revoke), with the body-hash portion at `preValidation`/`preHandler` (NOT `onRequest`, which is pre-body-parse), an explicit default-empty public-path allowlist, and stated ordering relative to the existing `enableMonitoring` `onRequest` hook.
- [ ] A `'lan'` branch in `createSocketAuthMiddleware` (`socket.ts:56-96`) verifies the handshake proof using the SAME verifier instance as the HTTP plane.
- [ ] `/pair/complete` (`pairRoutes.ts:65-119`) and `/pair/connect` are gated (enrollment requires the one-time secret; steady-state requires the device signature).
- [ ] The LAN proof header is added to CORS `allowedHeaders` (`api.ts:61-64`) and socket CORS (`socket.ts:105`).
- [ ] `packages/happy-cli/src/types/happy-server.d.ts` mirror updated for `auth:'lan'`.
- [ ] The reviewed relaxed-bind decision (sign-off) is recorded with this change.
- [ ] Typecheck passes.
**Dependencies:** US-002
**Estimated complexity:** large

## US-004: Hostile-client + non-crossing-auth + CORS/raw-body test suite
**Description:** As a reviewer, I want an automated decisive acceptance gate, so that a subtly-wrong verifier cannot ship looking secure.
**Acceptance Criteria:**
- [ ] An automated hostile-client test (second in-process client, forged/absent signature) is fail-closed rejected (401 / handshake-reject) on EVERY reachable entry point: `GET /`, `GET /health`, `/files/*`, `/pair/complete`, `/pair/connect`, `accountRoutes`/`machineSelfRoutes`, every tunnel-only route, device-list/revoke, AND the Socket.IO `/v1/updates` handshake. Completeness asserted against the live Fastify route table.
- [ ] A non-crossing-auth test: a loopback capability never satisfies the LAN plane and a LAN proof never satisfies the loopback plane.
- [ ] A blessed-client (pinned key, valid signed request) automated integration test succeeds against a LAN-bound listener; a revoke then causes fail-closed on the next request + handshake.
- [ ] CORS-allowed-header and raw-body/preValidation canonicalization tests pin what the server can receive and verify.
- [ ] Existing happy-server tests pass unchanged.
**Dependencies:** US-003
**Estimated complexity:** medium

## US-005: happy-cli daemon opt-in + `LanDaemonProvider` + provider selection + `dualListenerBinding` + `machine.json` migration + QR/PIN mint
**Description:** As the operator, I want to start the daemon in LAN mode, so that the embedded server binds a LAN listener advertising a reachable address while Dev Tunnels stays the default.
**Acceptance Criteria:**
- [ ] A happy-cli daemon opt-in (env/config/CLI, e.g. `HAPPY_LAN_TRANSPORT`) is read BEFORE `dualListenerBinding()`; absent ⇒ unchanged Dev Tunnels behavior.
- [ ] `LanDaemonProvider implements DaemonTunnelProvider` (`tunnel/provider.ts:14-18`) advertises `http://<lan-ip>:<port>`; provider selection at `run.ts:210-211` switches on the opt-in without touching `DevTunnelsDaemonProvider`.
- [ ] `dualListenerBinding.ts` binds the LAN listener per the chosen concurrency model (Option B default: LAN replaces the tunnel listener; loopback unchanged), with rollback/stop choreography updated.
- [ ] `MachineLocallyPersistedState` (`persistence.ts:89-95`, `machine.json`) gains LAN port/addr fields with all readers/writers migrated together.
- [ ] The daemon mints/displays/expires the one-time QR/PIN enrollment secret per the US-002 design; LAN bind/port validation runs at startup.
- [ ] `LanDaemonProvider` unit test + `dualListenerBinding` non-crossing-auth test; existing happy-cli tests pass (`pnpm --filter happy build && vitest run`).
- [ ] Typecheck passes.
**Dependencies:** US-002 (parallel-safe with US-006)
**Estimated complexity:** large

## US-006: happy-app LAN client (device-keypair + endpoint learning + device-proof attach + gated enrollment)
**Description:** As a BOOX user, I want the app to connect to a LAN daemon as a blessed device, so that I can use remote sessions where Dev Tunnels is blocked.
**Acceptance Criteria:**
- [ ] The app generates + stores an Ed25519 device keypair (tweetnacl; greenfield) in `tokenStorage.ts`, accounting for the existing filter that strips old `pinnedPubkey`/`sessionKey` shapes (the new key is not stripped).
- [ ] The app learns the LAN endpoint via a manual URL / QR (transport made explicit in credentials: `dev-tunnels` vs `lan`).
- [ ] The device-proof signature is attached on HTTP (`machineAuth.ts` transport-specific builder) and on the socket handshake (`socketOptions.ts`), matching the US-002 canonical form exactly.
- [ ] The QR/PIN-gated enrollment flow completes a LAN `/pair/complete` against a blessed daemon.
- [ ] Dev Tunnels paths are unchanged (transport-specific builders; default transport stays dev-tunnels).
- [ ] `socketOptions`/`pairing` tests updated; `pnpm --filter happy-app typecheck` passes.
**Dependencies:** US-002 (parallel-safe with US-005)
**Estimated complexity:** large

## US-007: happy-app Settings opt-in toggle + known-devices revoke UI + i18n
**Description:** As the operator, I want to enable LAN mode and revoke known devices from Settings, so that the feature is discoverable and the allowlist is manageable.
**Acceptance Criteria:**
- [ ] A default-off opt-in toggle in `sources/app/(app)/settings/features.tsx` + a flag in `LocalSettingsSchema` (`sources/sync/localSettings.ts`), following the `enableSocketRangeFetch` pattern.
- [ ] A `sources/app/(app)/settings/lan-devices.tsx` revoke list calls the `device-list`/`device-revoke` routes; revoking a device removes its pin.
- [ ] Every new user-visible string uses `t(...)` with keys added to all 10 locales + `sources/text/_default.ts`; `sources/text/translations.test.ts` passes with the new required keys (flag English-only strings for upstream translation in the commit message).
- [ ] Uses `ItemList`/`Item`, `useHappyAction`, `@/modal` (not `Alert`); `pnpm --filter happy-app typecheck` passes.
**Dependencies:** US-006
**Estimated complexity:** medium

## US-008: codex `Feature` gate + `/remote on` LAN transport + `daemon_supervisor`
**Description:** As a codex user, I want `/remote on` to offer the LAN transport behind an experimental flag, so that LAN is opt-in and default-off at the codex layer.
**Acceptance Criteria:**
- [ ] PREREQ done: `git submodule update --init --recursive codex`; codex paths re-verified.
- [ ] A new experimental `Feature` enum variant + `FeatureSpec` (`features/src/lib.rs`, pattern of `RemoteSession` at `:171` + `:1054-1063`), `default_enabled: false`, `// SANDBOX PATCH`.
- [ ] The LAN transport choice is threaded through the `/remote on` onboard/cancel state machine (`remote_on.rs`) — `/remote off` cancels an in-flight LAN onboard — and `daemon_supervisor.rs`; LAN logic lives overlay-first in `codex-rs-overlay/codex-happy`.
- [ ] A `docs/implementation/patch-surface.md §14` invariant row + `§15` rebase-replant note added for any upstream-canonical edit.
- [ ] `cargo check --workspace` + `cargo test -p codex-happy` pass; the codex app-server WS-transport loopback invariant is untouched.
**Dependencies:** US-005
**Estimated complexity:** medium

## US-009: `docs/security-model.md` + `AGENTS.md` invariant amendment (full write-up)
**Description:** As a future contributor, I want the reviewed LAN exception documented, so that the relaxed bind invariant is recorded and the codex-vs-happy-server scope is unambiguous.
**Acceptance Criteria:**
- [ ] `docs/security-model.md` `## Operator Identity Gate` (`:41`) + `## Dual-Listener RPC Plane Non-Crossing` (`:118`) amended to record the reviewed, gated happy-server LAN exception (signature-as-trust-root, fail-closed, no self-enrollment).
- [ ] `packages/happy-cli/AGENTS.md` clarifies that the `## Codex Transport Security Model` invariant governs the codex app-server WS transport (unchanged) and adds the reviewed happy-server LAN carve-out.
- [ ] No code behavior change; the relaxed-bind sign-off itself was recorded in US-003.
**Dependencies:** US-002, US-003, US-005, US-006, US-008
**Estimated complexity:** small
