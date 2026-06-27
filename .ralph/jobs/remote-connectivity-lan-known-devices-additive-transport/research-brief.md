# Research Brief — Additive opt-in LAN known-devices remote-session transport

Seeded from brainstorm `.ralph/brainstorms/remote-connectivity-lan-known-devices-additive-transport/selected-direction.md` (Direction D-001).
Lenses: Claude `architect` (Opus 4.8), Claude `researcher` (Opus 4.8), Copilot `copilot-research` (gpt-5.5). `codex` research lens produced no output (timeout) — it runs again in Phase-4 review. All file:line numbers verified against the current working tree; raw lens outputs preserved at `architect-output.txt`, `researcher-output.txt`, `copilot-research.txt`.

## The one load-bearing finding (all lenses + firsthand verification agree)

The embedded happy-server's tunnel listener has **zero per-request auth**. `typed.decorate('authenticateTunnel', async function (_request) {})` is a literal **no-op** (`packages/happy-server/sources/app/api/api.ts:79`), and `assertOperatorIdentityGate` (`packages/happy-server/sources/index.ts:101-108`) is the ONLY thing preventing a non-loopback bind. Identity is "collapsed to `tofuConfig.localUserId`" and the trust root is entirely external: (1) the Dev Tunnels gateway already authenticated the caller, and (2) the listener binds loopback only. A LAN bind keeps reachability and **deletes the entire trust root**.

Verified concrete bypass: `POST /pair/complete` (`pairRoutes.ts:65-119`) is **unauthenticated** (only an IP rate-limit at `:87` + presence checks). It returns the machine's `ed25519PublicKey`, `x25519PublicKey`, `ed25519Fingerprint`, and a `mobileSharedSecret` = `nacl.box.before(mobileEcdhPublicKey, x25519SecretKey)` (X25519 ECDH, `:100-104`). So any host reaching a naive `0.0.0.0` bind self-enrolls. **`/pair/complete` and `/pair/connect` have NO `preHandler`** (copilot lens), so a route-level `app.authenticate` change alone will not protect LAN pairing — the gate must be a **global `onRequest` hook**.

**Unanimous verdict:** IP / host / mDNS allowlists alone are NO-GO. The "known devices" boundary MUST be a **server-side, per-request, cryptographic, fail-closed** gate at the listener, enforced BEFORE any non-loopback bind is permitted, covering `/pair/complete`, every tunnel-only HTTP route, `/files/*`, AND the Socket.IO handshake.

## Decisive scope correction (architect + researcher independently)

The brainstorm cites the fork's "never expose on 0.0.0.0/LAN/tunnels" invariant (`packages/happy-cli/AGENTS.md:282/288`) as the thing being relaxed. **That invariant is scoped to the codex app-server WS transport (CLI↔codex), NOT the embedded happy-server listener.** This LAN feature relaxes the **happy-server** bind gate (`assertOperatorIdentityGate` + `docs/security-model.md §Operator Identity Gate`). The codex-app-server invariant at `AGENTS.md:288` MUST stay byte-for-byte intact — codex app-server remains loopback-only. The plan must not conflate the two.

## Verified seams (happy-server)

- **`auth` union** lives in FOUR coupled places, all must learn `'lan'`:
  - `HappyServerConfig.auth?: "tunnel" | "loopback"` — `index.ts:25`
  - `CreateAppConfig.auth?: "tunnel" | "loopback"` — `index.ts:45`
  - `ConfigureApiOptions.auth?: "tunnel" | "loopback"` — `api.ts:51`
  - `StartSocketOptions.auth?: "tunnel" | "loopback"` — `socket.ts:19`
  - plus mirror file `packages/happy-cli/src/types/happy-server.d.ts` and possibly shared `packages/happy-wire/src/tunnel/types.ts` (transport variant).
- **`assertOperatorIdentityGate`** `index.ts:101-108`; called at top of `createApp()` `:118`. Only `auth==='loopback'` (or a loopback host) bypasses today. Listen host = `config.host || "127.0.0.1"` passed to `app.listen` (~`index.ts:195`). The gate must permit a non-loopback bind ONLY when a live LAN verifier object is present (fail-closed if `auth==='lan'` but verifier/allowlist material is missing). The gate's error string (`index.ts:104`) should be updated to describe the LAN carve-out, not silently weakened.
- **Route mount** `api.ts:104-117`: both-listener routes = `/` (`:66-68`), `/files/*` (`:84-98`, local-storage guarded — serves on BOTH listeners), `accountRoutes` (`:105`), `machineSelfRoutes` (`:106`); tunnel-only block `if (options.auth !== "loopback")` (`:109-117`) = `pairRoutes`, `pushRoutes`, `sessionRoutes`, `devRoutes`, `versionRoutes`, `agentCommsIngestRoutes`, `v3SessionRoutes`. The `'lan'` mode must traverse the same `!== "loopback"` block so its routes mount.
- **The verifier attach point:** register ONE global `onRequest` (or `preHandler`) hook in `configureApi` (replacing reliance on the no-op `authenticateTunnel` at `:79-80`) so it covers `/`, `/files/*`, and every route in one place — with an explicit allowlist for any intentionally-public path (there should be none on a LAN bind). The current `verifyLoopbackCapability` only works because the loopback listener doesn't mount tunnel routes; do NOT copy that per-route opt-in model.
- **Socket plane:** `createSocketAuthMiddleware(tofuConfig, socketOptions)` `socket.ts:56-96`, registered via `io.use(...)` `:136`, path `/v1/updates` `:110`. Today only the `auth==='loopback'` branch (`:62-69`) enforces a credential; tunnel falls through to `next()`. Add a `'lan'` branch mirroring loopback, reading the device proof from `socket.handshake.headers`/`socket.handshake.auth` and verifying via the **same** verifier instance used by the HTTP hook (so the two planes can't diverge).
- **Pattern to mirror:** `loopbackCapability.ts` factory (`sources/app/api/auth/loopbackCapability.ts:7-35`) — `makeLoopbackTokenReader(paths)` (reader) + `verifyLoopbackCapability(paths)` (Fastify decorator returning 401 on mismatch). `lanDeviceAuth.ts` should export the analogous pair (an HTTP preHandler/onRequest verifier + a socket-usable verifier sharing one core).

## Verified seams (happy-cli)

- **`DaemonTunnelProvider`** interface `tunnel/provider.ts:14-18` (`createHostTunnel`, `loadHostTunnel`, `stop`). Implemented by `DevTunnelsDaemonProvider` `tunnel/devTunnelsDaemonProvider.ts:58-93`. Provider only abstracts tunnel setup/URL advertising; it does NOT touch listener auth. A `LanDaemonProvider` slots in here, returning a `TunnelConfig` whose `tunnelUrl` is `http://<lan-ip>:<port>`.
- **Provider selection** `daemon/run.ts:210-211` is hardcoded (`new DevTunnelsDaemonProvider(...)`) — the seam to switch on a LAN feature flag. TOFU key load `:204`, `tofuPublicKeysConfig` built `:220-225`, bind call `:233-252`.
- **`dualListenerBinding.ts:36-89`** creates exactly TWO `createApp` handles: tunnel (`auth:'tunnel'`, `state.tunnelPort`, `:56-62`) and loopback (`auth:'loopback'`, `state.loopbackPort`, `:63-69`), started sequentially `:72-73`, rollback both + `tunnelProvider.stop()` on failure `:74-78`. This is where the LAN listener is added.
- **`MachineLocallyPersistedState`** `persistence.ts:89-95` = `{ machineId, tunnelPort, loopbackPort, tunnelId, lastTunnelUrl }` (`machine.json`). A LAN listener adds `lanPort`/LAN-addr — and per the daemon AGENTS.md migration rule, ALL readers/writers migrate together.
- **Device key material:** `packages/happy-cli/src/tofu/keypairManager.ts` `loadOrCreateTofuKeypairs():69`; `TofuKeypairs` = `ed25519PublicKey/PrivateKey`, `ecdhPublicKey/PrivateKey`, `ed25519Fingerprint` (`:23-25`).
- **Strongest reuse precedent (researcher):** `packages/happy-cli/src/agentComms/peerAuth.ts` (`pinPeer` + fingerprint-change rejection `:110-120`, sealed-body open/verify) and `agentComms/ingestHandler.ts:32-42` (pinned-key Ed25519/ECDH verification + `openSealedBody`). **This is the closest existing fail-closed per-device crypto gate in the repo** — the LAN verifier should reuse this machinery rather than invent new crypto.

## Verified seams (happy-app, React Native / Expo)

- **`sources/sync/tunnelProvider.ts`** — `ClientTunnelProvider` interface `:11-17`; `DevTunnelsClientProvider` `:157-223` learns the endpoint. A LAN variant adds a manual-URL/QR endpoint source.
- **`sources/sync/socketOptions.ts`** — `buildTunnelSocketOptions():19-45` sets socket `auth` + `extraHeaders` (from `getMachineAuthHeaders` → `X-Tunnel-Authorization`). The LAN device-proof header/handshake-auth attaches here.
- **`sources/auth/machineAuth.ts`** — `getMachineAuthHeaders():20-25` injects `X-Tunnel-Authorization`; `tunnelFetch():8-18`. Per-request header injection point.
- **`sources/auth/pairing.ts`** — `completePair()` POSTs `/pair/complete` with `X-Tunnel-Authorization`. **The app does NOT generate its own Ed25519 device keypair today** — greenfield app-side keygen needed. Crypto lib = **tweetnacl** (pure-JS, RN/Hermes-safe; no native module). `expo-crypto` present but used elsewhere.
- **`sources/auth/tokenStorage.ts`** — credential store; **old `pinnedPubkey`/`sessionKey` shapes are explicitly filtered out today** (copilot) — adding LAN device keys must account for that filter. Make transport explicit in credentials (`dev-tunnels` vs `lan`) and route headers/socket options through transport-specific builders.
- **Settings:** `sources/app/(app)/settings/features.tsx` (experimental toggles, `ItemGroup`/`Item`/`Switch` pattern); local-only flags in `LocalSettingsSchema` (`sources/sync/localSettings.ts`, same pattern as `enableSocketRangeFetch`). Revoke UI fits a new sub-route `settings/lan-devices.tsx`. **i18n mandatory:** every user-visible string via `t(...)` in all 10 locales + `sources/text/_default.ts` + `sources/text/translations.test.ts` required-key list.

## Verified seams (codex submodule)

- **`codex/external/repos/codex-patched/codex-rs/features/src/lib.rs`** — `Feature` enum; `RemoteSession` variant `:171` (`// SANDBOX PATCH`). Registration is TWO parts: enum variant + a `FeatureSpec` entry in the `FEATURES` table (`RemoteSession` spec `:1051-1063`, `default_enabled: false`, `Stage::Experimental`). Enable via `/experimental`, `-c features.<key>=true`, `--enable <key>`, `/remote on`. New LAN feature follows the identical 2-part pattern, default off. Per `codex/CLAUDE.md` tenet, prefer overlay code + minimal upstream enum-add.
- **`codex/codex-rs-overlay/codex-happy/src/remote_on.rs`** — `/remote on` self-onboard driver `run_self_onboard()`; **cancellation** via `OnboardCancel`/`OnboardCancelListener` (`tokio::sync::watch`). A LAN transport choice must thread through the SAME onboard/cancel state machine so `/remote off` cancels an in-flight LAN onboard.
- **`codex/codex-rs-overlay/codex-happy/src/daemon_supervisor.rs`** — `NodeDaemonSupervisor`; a LAN flag threads through daemon spawn here.

## Enforcement-mechanism recommendation (architect + copilot converge)

**Per-device Ed25519 signed-request, reusing TOFU material, with a mandatory nonce/timestamp.** Canonical signature over `method + path + body-hash + timestamp + nonce`; short replay window; server-side known-device allowlist. Plain HTTP-over-LAN is acceptable because the **signature**, not TLS, is the trust root. Reuse `agentComms/peerAuth.ts`/`ingestHandler.ts` machinery. mTLS rejected: Expo/RN `fetch`/`socket.io-client` have no first-class Android client-cert API (BOOX feasibility killer). HMAC+nonce over `mobileSharedSecret` is the lower-scope fallback (reuses the ECDH secret verbatim) but gives weaker (symmetric) identity for the revocation story.

**Enrollment bootstrap (chicken-and-egg — must be settled in planning):** on the tunnel, the Dev Tunnels gateway gates `/pair/complete`; on LAN there is no gateway, so enrollment itself needs an out-of-band gate. Recommended: a one-time enrollment secret displayed by the daemon (QR/PIN) that proves physical/visual operator access, gating the FIRST `/pair/complete`; steady-state requests then use the per-device signature. **No LAN self-enrollment** (copilot). A subtly-wrong check here is a WORSE open door than Dev Tunnels because it looks secure.

## Concurrency: third listener vs single selected (architect recommends Option B)

- **Option A — concurrent third listener** (`tunnel` + `loopback` + `lan`): Dev Tunnels stays byte-for-byte live, but the `assertOperatorIdentityGate` non-loopback carve-out is live simultaneously with the unauthenticated tunnel listener; widens attack surface; 3-way rollback choreography; extra `machineState` port field.
- **Option B — user-selected single remote listener** (Dev Tunnels default; LAN replaces the tunnel listener when opted in): only ever ONE non-loopback listener; the invariant becomes "non-loopback ⇒ verifier active" with no concurrent unauthenticated peer; simpler rollback; matches "opt-in per daemon start." **Recommended.** Open question to confirm in planning.

## Tests / build

- **Decisive acceptance test:** a hostile-client integration test from a SECOND host proving fail-closed rejection on `/pair/complete`, `/pair/connect`, `/files/*`, `accountRoutes`/`machineSelfRoutes`, every tunnel-only route, AND the Socket.IO `/v1/updates` handshake — an unsigned/forged-signature client cannot self-enroll, open a socket, or trigger any handler. Plus the **dual-listener non-crossing-auth invariant** (loopback cap ≠ LAN proof and vice-versa).
- Runners: Vitest. `happy-server` test = `vitest run` (`.spec.ts` convention, though both exist); `happy-cli` test = `pnpm run build && vitest run` (`.test.ts`, builds first — on Windows/Git Bash use `npm_config_script_shell=bash pnpm --filter happy test` or `pnpm --filter happy exec vitest run <paths>`); `happy-app` = `vitest` with `vitest.config.mts`. Typecheck (all three) = `tsc --noEmit` (`pnpm build` on server/cli also typechecks). codex: `cargo check --workspace` (~6 min) Phase-5a gate + `cargo test -p codex-happy` + `codex-rs-overlay/codex-invariant-tests/`.
- `index.spec.ts` referenced by brainstorm does NOT exist at happy-server/sources — the `assertOperatorIdentityGate` tests are not in a file by that name (do not assume it).

## Docs

- `docs/security-model.md` EXISTS — amend `## Operator Identity Gate` (`:41`) and `## Dual-Listener RPC Plane Non-Crossing` (`:118`) to record the reviewed LAN exception.
- `packages/happy-cli/AGENTS.md` — clarify the `:282`/`:288` invariant scope (codex-app-server, NOT happy-server) and add the reviewed happy-server LAN carve-out. Formal sign-off recording the relaxed bind invariant.

## Consolidated file list

**Modify (happy-server):** `index.ts`, `app/api/api.ts`, `app/api/socket.ts`, `app/api/routes/pairRoutes.ts`.
**Modify (happy-cli):** `daemon/run.ts`, `daemon/dualListenerBinding.ts`, `persistence.ts`, `types/happy-server.d.ts` (+ possibly `happy-wire/src/tunnel/types.ts`).
**Modify (happy-app):** `sources/sync/socketOptions.ts`, `sources/sync/tunnelProvider.ts`, `sources/auth/pairing.ts`, `sources/auth/machineAuth.ts`, `sources/auth/tokenStorage.ts`, `sources/app/(app)/settings/features.tsx`, `sources/sync/localSettings.ts`, i18n files.
**Modify (codex):** `features/src/lib.rs`, `codex-rs-overlay/codex-happy/src/remote_on.rs`, `codex-rs-overlay/codex-happy/src/daemon_supervisor.rs`.
**New:** `happy-server/sources/app/api/auth/lanDeviceAuth.ts`; `happy-cli/src/tunnel/lanDaemonProvider.ts`; `happy-app/sources/app/(app)/settings/lan-devices.tsx`; app-side device-keypair module under `sources/auth/`.
**Tests:** `happy-server` lanDeviceAuth + hostile-client suite + `socket.spec.ts` + `pairRoutes` LAN; `dualListenerBinding.test.ts` non-crossing-auth (happy-cli + happy-server copies); `happy-cli` `lanDaemonProvider.test.ts`; happy-app `socketOptions`/`pairing` updates; codex invariant tests.
**Docs:** `docs/security-model.md`, `packages/happy-cli/AGENTS.md`.
