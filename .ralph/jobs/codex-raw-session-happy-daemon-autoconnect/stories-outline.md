# Stories Outline: codex raw-session Happy autoconnect (native Rust `codex-happy`)

*Preliminary decomposition from `/plan-with-ralph`. Feed to `/implement-with-ralph --from-plan` for PRD generation.*
*Target repo: the `codex/` submodule (two-commit submodule flow: commit inside `codex/`, then bump the codexu pointer).*
*Gate: `cargo check --workspace` from `codex/external/repos/codex-patched/codex-rs` is the Rust gate (~6 min). The
release build is deferred to CI. All upstream-canonical edits must be `// SANDBOX PATCH:`-marked + registered in
`codex/docs/implementation/patch-surface.md`.*

## US-001: Live happy-server round-trip de-risk (EARLY GATE)
**Description:** As an implementer, I want the deployed happy-server auth-mode/cap-file detail resolved before the
deep port, so a server-contract surprise surfaces cheaply rather than mid-port.
**Acceptance Criteria:**
- [ ] A throwaway/minimal Rust probe (under `.ralph/investigations/` or a `#[ignore]` integration test) performs an
  authenticated request against the running dev happy-server (`localhost:3005` and/or `https://happy.evyatar.dev`),
  resolving which auth mode it runs (loopback `X-Loopback-Capability` vs tunnel `X-Tunnel-Authorization`) and where
  the capability/cap file is actually read from (the spike found the `:3005` listener in tunnel-auth mode and the
  LocalSystem service reading its cap file from the service profile, not `~/.happy`).
- [ ] A documented, reproducible working auth header + endpoint path the `codex-happy` crate will use, captured in a
  findings note committed to `.ralph/investigations/codex-raw-autoconnect-spike/` (or a new sibling dir).
- [ ] A real `POST /v1/sessions` (or equivalent authenticated GET) returns 2xx in the probe, OR a precise blocker is
  documented with the exact server-side change/config needed (which, per scope, would be a disconfirming signal).
- [ ] Does NOT edit `codex/.../Cargo.toml` (avoids a workspace-manifest merge race with US-002).
**Dependencies:** None
**Estimated complexity:** small

## US-002: `codex-happy` crate scaffold + encryption module
**Description:** As the fork, I want the new overlay crate created and the Happy encryption ported byte-for-byte, so
sessions are cryptographically compatible with the existing mobile app.
**Acceptance Criteria:**
- [ ] New crate `codex/codex-rs-overlay/codex-happy/` with `Cargo.toml` (`workspace = "../../external/repos/codex-patched/codex-rs"`),
  added to the root workspace `[workspace.members]` + `[workspace.dependencies]` (path entry) — this is the ONLY
  story that edits the root workspace `Cargo.toml`.
- [ ] `src/encryption.rs` ports all 5 `packages/happy-cli/src/api/encryption.ts` primitives using the spike-proven
  crates (`crypto_box` 0.9 std, `xsalsa20poly1305` 0.9, `aes-gcm` 0.10, `ed25519-dalek` 2, `sha2` 0.10): the
  libsodium `sha512(seed)[0:32]` X25519 pubkey derivation, the custom ephPub‖nonce‖SalsaBox sealed-box bundle, the
  legacy secretbox (nonce‖ct), the AES-256-GCM dataKey bundle (`0‖nonce12‖ct‖tag16`), and the Ed25519 auth challenge.
- [ ] KAT unit tests reuse `cryptocompat/` cross-check vectors and assert byte-equality vs `encryption.ts` output
  (both Rust→decode and decode→Rust directions), including `dataKey` and `legacy` round-trips.
- [ ] `cargo check -p codex-happy` is green; `cargo test -p codex-happy` encryption tests pass.
**Dependencies:** None (crypto needs no live server). May run in parallel with US-001.
**Estimated complexity:** medium

## US-003: `getOrCreateSession` (POST /v1/sessions) + auth/onboarding module
**Description:** As the integrated client, I want to create/find a Happy session over HTTP with correct encryption
mode selection and auth — and, when Happy is enabled but not yet configured, **self-onboard** the codex-native
identity first — so a session appears server-side exactly as `happy-cli` would create it, even on a fresh machine.
**Acceptance Criteria:**
- [ ] `src/api.rs` implements `getOrCreateSession` mirroring `packages/happy-cli/src/api/api.ts` (28-132): `POST
  /v1/sessions` with `{ tag, metadata, agentState?, dataEncryptionKey? }`, dataKey-vs-legacy selection (34-54),
  sealing a random AES-256 key to the account pubkey via `libsodiumEncryptForPublicKey` with the `0` version byte.
- [ ] The request body is captured from what `api.ts` ACTUALLY sends and replicated byte-exactly — explicitly verify
  the `dataEncryptionKey` value (codex review flagged `api.ts` may POST `dataEncryptionKey: null`); do NOT "fix" it.
- [ ] `src/auth.rs` implements header auth (loopback `X-Loopback-Capability: <~/.happy/loopback-cap.txt>` and
  cross-machine `X-Tunnel-Authorization: tunnel <jwt>`) + GitHub device flow mirroring
  `codex-rs-overlay/codex-copilot/src/auth.rs` (login/request_device_code/poll_access_token; secret-perm cred files);
  reads Happy creds from `~/.happy`.
- [ ] **Self-onboard path:** when `~/.happy` creds are absent, `src/auth.rs` (or a sibling `src/onboard.rs`) mirrors
  `packages/happy-cli/src/ui/auth.ts doAuth`/`authAndSetupMachineIfNeeded`: run the GitHub device flow
  (`auth/githubDeviceFlow.ts requestDeviceCode`/`pollForToken` shape), generate the E2EE keypair locally
  (`tweetnacl.box.keyPair()` equivalent → `crypto_box` 0.9) and write it to `~/.happy/access.key` as dataKey creds
  (`{publicKey, machineKey}` + token), write `~/.happy/profile.json` from `GET https://api.github.com/user`, and seed
  `machineId` in `~/.happy/settings.json`. NO server-side account-creation call (the fork has none — identity = GitHub
  OAuth + Dev-Tunnels ownership). The one-time mobile pairing (`POST /pair/complete`) and a reachable server/tunnel
  remain the same prerequisites `happy codex`'s first run has and are NOT part of this story.
- [ ] An integration test (gated/`#[ignore]` if it needs the live server) creates a session using US-001's resolved
  auth; both `dataKey` and `legacy` modes round-trip and the created session is decryptable.
- [ ] `cargo check -p codex-happy` green.
**Dependencies:** US-001, US-002
**Estimated complexity:** medium

## US-004: Socket.IO `/v1/updates` client + happy-wire serde structs
**Description:** As the integrated client, I want a behavior-parity Socket.IO session client, so the session streams
and stays in sync exactly like `apiSession.ts`.
**Acceptance Criteria:**
- [ ] `src/wire.rs` defines serde structs for the session/message/metadata schemas ported from
  `packages/happy-wire/src/{sessionProtocol.ts, messages.ts}` (+ `messageMeta.ts`, `legacyProtocol.ts` as needed),
  pinned to a recorded schema snapshot.
- [ ] `src/session.rs` uses `rust-socketio` (websocket transport) on `path:/v1/updates` to: receive seq-ordered
  `update` events; emit `update-metadata`/`update-state` via `emit_with_ack` (optimistic-concurrency CAS); send
  `message-consumption` acks; send `session-alive` keepalive (volatile); handle `rpc-request`; smart-reconnect with
  seq-gap detection + backfill so no assistant delta/completion is permanently lost.
- [ ] Unit tests cover seq-gap detection, envelope↔struct mapping, CAS conflict handling, and reconnect/backfill
  (mock or local server).
- [ ] `cargo check -p codex-happy` green; the crate is fully unit-testable in isolation up through this client
  (no seam required).
**Dependencies:** US-002 (and US-003 for shared session/auth types)
**Estimated complexity:** large

## US-005: Bounded upstream-canonical control seam + build/feature wiring
**Description:** As the fork, I want a minimal, registered, rebase-gated seam at the app-server boundary plus the
build/feature wiring, so codex-core fans events to the overlay and the overlay can drive turns/approvals — without
sprawling the upstream conflict surface.
**Acceptance Criteria:**
- [ ] Outbound tee at `tui/src/app.rs:1202-1210` (the `next_event()` chokepoint): an
  `Option<UnboundedSender<AppServerEvent>>` `happy_tap` field (None in vanilla) that clones each event to the overlay
  sink BEFORE local handling. Uses `UnboundedSender` so it NEVER backpressures/hangs the TUI; the overlay owns
  buffering/reconnect/drop policy. Each modified line carries `// SANDBOX PATCH:`.
- [ ] Verify whether `resolve_server_request`/`reject_server_request` already exist on the cloneable
  `AppServerRequestHandle` (`app-server-client/src/lib.rs:684-737` + dispatch 884-903 per research); add them
  additively (per `probe-a-seam.diff`) ONLY if missing.
- [ ] `tui/Cargo.toml` declares `codex-happy = { workspace = true }` (REQUIRED for `app.rs` to call
  `codex_happy::attach`; absence fails `cargo check`).
- [ ] `remote_session` registered as an experimental feature in `features/src/lib.rs` (Feature enum,
  **default-OFF**) + `features/src/tests.rs`; strict config (`config/src/strict_config.rs` `is_known_feature_key`,
  `core/src/config/config_loader_tests.rs`) accepts `-c features.remote_session=...`.
- [ ] All upstream-canonical edits registered in `patch-surface.md` §14 (invariant rows with an enforcement
  mechanism) and §15 as applicable; an enforcing test in `codex-invariant-tests` (`include_str!()` structural
  assertion of the `// SANDBOX PATCH:` markers at the tee + a lossless-transcript test for assistant deltas/
  completions under slow-mobile/socket reconnect).
- [ ] `cargo check --workspace` green; the conflict-creating surface (lines modifying existing upstream code) stays
  bounded to the single tee chokepoint + the `happy_tap` field/init; everything else additive.
- [ ] Does NOT edit the root workspace `Cargo.toml` (US-002 owns that). MUST land before US-006.
**Dependencies:** None for the mechanism, but only mergeable once US-002 exists (the `codex-happy` crate it depends on)
**Estimated complexity:** medium

## US-006: Launcher wiring + attach + self-onboard + idempotency + fallback + opt-in (default-OFF)
**Description:** As a user, I want raw `codex` to appear on the mobile tree and stream E2EE once I opt in — with Happy
creds it connects directly, and with the feature on but no creds it self-onboards (US-003) first — with no double-wrap
and a silent vanilla fallback when the feature is off, I abort the GitHub login, or the server is unreachable.
**Acceptance Criteria:**
- [ ] `codex_happy::attach(tap_rx, request_handle)` is wired in `tui/src/app.rs` (~1137-1204, after `app_server` is
  constructed, before the main loop), gated on: feature enabled AND not already Happy-driven. When creds are absent,
  attach first invokes US-003's self-onboard (background; the GitHub device-flow prompt is non-blocking) and connects
  on success.
- [ ] Launcher (`codex-rs-overlay/codex-copilot-launcher/src/{main.rs, config.rs}`): a config field +
  `provider_config_flags()` emits `-c features.remote_session=...` (**default-OFF**; opted in via
  `~/.codex-copilot/config.toml` / `-c features.remote_session=true` / `--enable remote_session` / env override /
  `/experimental` / `/remote on`), modeled on the existing `features.remote_control`/`unified_exec` pattern;
  env/cred state passed to the spawned codex-core.
- [ ] Idempotency: native autoconnect is suppressed when `HAPPY_CURRENT_SESSION_ID` is set OR the subcommand is
  `app-server` (refs `cli/src/main.rs:627-645`, `runCodex.ts:943-953`, `codexAppServerClient.ts:1003-1023`).
- [ ] With Happy creds present + feature on, a raw `codex` start surfaces a NEW non-read-only Happy session on the
  mobile tree within ≤5 s `[tune]` with codex-flavor metadata, streaming E2EE. With the feature on + no creds, it
  self-onboards (US-003) first and then surfaces the session (no server-side account-creation step).
- [ ] `happy codex` and a `codex app-server` child it spawns do NOT create a second/duplicate session.
- [ ] Feature OFF (default): raw `codex` is plain vanilla codex (no probe, no added latency). Feature ON but
  can't-connect (user aborts the GitHub login OR server unreachable/offline): raw `codex` reaches the interactive
  prompt with ≤300 ms `[tune]` added over the vanilla baseline, no blocking auth prompt, no error; the
  connect/self-onboard attempt is fully background. Asserted by a test.
- [ ] Windows parity: the launcher's Windows spawn+wait branch (`main.rs:176-187`) carries identical env/feature/
  idempotency behavior (no in-repo `codex.ps1`). Verified on the Windows path.
- [ ] `cargo check --workspace` green.
**Dependencies:** US-003, US-004, US-005
**Estimated complexity:** large

## US-007: Full bidirectional control (turns, approvals, interrupt/stop)
**Description:** As a mobile user, I want to drive the live raw codex session — send turns, approve exec/patch,
interrupt and stop — so it behaves exactly like `happy codex`.
**Acceptance Criteria:**
- [ ] Mobile turn → `ClientRequest::TurnStart`/`TurnSteer` drives the live session; streamed output mirrors back E2EE.
- [ ] Exec approval AND patch approval requested by codex route to mobile; the mobile decision drives the live
  session via `resolve_server_request` (route through `app_server_session.rs:1136-1141` when possible).
- [ ] Approval double-answer coordination: either rely on app-server request-id dedup (first `resolve` wins — verify)
  OR suppress the local TUI approval UI when Happy is attached; the chosen branch is tested.
- [ ] Interrupt from mobile → `TurnInterrupt`: streamed output ceases within ≤2 s `[tune]` and codex reports the turn
  aborted.
- [ ] Explicit abort-vs-killSession mapping mirroring `runCodex.ts` (`permissionHandler.abortAll()`,
  `client.abortTurnWithFallback(...)`, `killSession`): "stop" = abort current turn + cancel pending approvals +
  (optional) session teardown — defined and tested (no separate process to kill for the in-process client).
- [ ] TUI integration tests cover remote turn, remote exec approval, remote patch approval, remote interrupt, remote
  stop; `cargo check --workspace` green.
**Dependencies:** US-006
**Estimated complexity:** large

## US-008: Network-audit registration + happy-wire drift guard
**Description:** As the fork, I want the new audited egress registered + justified and a drift guard, so the
egress-suppression invariant holds and the two-implementation tax stays visible.
**Acceptance Criteria:**
- [ ] `codex/scripts/audit_network_calls.sh` updated: the new happy-server + Dev-Tunnels egress is allowlisted; each
  overlay egress file (`codex-happy/src/{api.rs, session.rs, auth.rs}`) is listed in `OVERLAY_KNOWN_PATCH_FILES` AND
  carries a `// SANDBOX PATCH:` marker (the script requires the marker on every listed file).
- [ ] `codex/scripts/runtime_audit_allowlist.txt` updated with the new destinations (loopback-only locally;
  Dev-Tunnels-only cross-machine; never non-loopback).
- [ ] `codex/docs/implementation/patch-surface.md` §4 documents + justifies the new egress and the E2EE
  key-ownership shift into the audited binary; the two net-new deps (`xsalsa20poly1305`, `rust-socketio`) are noted.
- [ ] A drift guard test in `codex-invariant-tests` pins the in-repo `@slopus/happy-wire` schema snapshot
  (`packages/happy-wire/src/`) and FAILS when the TS schema advances without a matching `codex-happy` Rust update;
  verified to fail-correctly on a simulated schema bump.
- [ ] `codex/scripts/audit_network_calls.sh` passes; `cargo check --workspace` green.
**Dependencies:** US-003, US-004, US-005
**Estimated complexity:** medium

## US-009: Per-session `/remote on|off` slash command
**Description:** As a user, I want a dedicated `/remote` command to enable/disable Happy connection for THIS codex
session mid-session, on top of the `/experimental` + config + startup-flag opt-in surfaces.
**Acceptance Criteria:**
- [ ] `SlashCommand::Remote` added to the `SlashCommand` enum in `tui/src/slash_command.rs` (serialized `remote`),
  with a user-visible description and `on`/`off` argument parsing. Each modified upstream line carries `// SANDBOX PATCH:`.
- [ ] `/remote on` flips `remote_session` on via the existing `set_feature_enabled` live-toggle
  (`tui/src/chatwidget/settings.rs:69` — the `UserMessageStyling` precedent at `settings.rs:107-112`) and ATTACHES the
  `codex-happy` client mid-session (self-onboarding via US-003 if creds are absent), so the session appears on the
  mobile tree without restarting codex.
- [ ] `/remote off` flips `remote_session` off and cleanly DETACHES the `codex-happy` client (stops the Happy
  session/sync, tears down the tap/socket) WITHOUT killing the codex session; codex continues as plain local codex.
- [ ] `codex-happy::attach` exposes a matching `detach`/teardown entry point (built on US-007's clean abort/teardown
  semantics) that `/remote off` invokes; re-`/remote on` re-attaches cleanly.
- [ ] All upstream-canonical edits registered in `patch-surface.md` §14 with an enforcing test; a TUI integration test
  drives `/remote on` then `/remote off` and asserts attach→detach behavior (session appears, then sync stops, codex
  stays alive). `cargo check --workspace` green.
**Dependencies:** US-006, US-007
**Estimated complexity:** medium
