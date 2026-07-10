# Stories Outline: Node-free Happy web dual-control

*Preliminary 24-story decomposition for eight coordinated repository-owned Ralph jobs. Do not convert this into one cross-repository PRD.*

## Job J0 — Codex P0 Rust compatibility fixture

### US-001: Pin the standalone Rust compatibility stack
**Description:** Create a throwaway/portable Codex-wrapper fixture using the intended Axum, Socketioxide, and rust_socketio stack without production persistence.

**Files:**
- `codex\codex-rs-overlay\codex-happy-compat-spike\Cargo.toml`
- `codex\codex-rs-overlay\codex-happy-compat-spike\Cargo.lock`
- `codex\codex-rs-overlay\codex-happy-compat-spike\src\main.rs`
- `codex\codex-rs-overlay\codex-happy-compat-spike\src\contract.rs`

**Acceptance criteria:**
- [ ] Axum and Socketioxide versions are exact in the fixture lock.
- [ ] Socket path is `/v1/updates`; bind is fixed `127.0.0.1:43127`.
- [ ] Fixture emits only redacted structured output.
- [ ] `cargo test --manifest-path ...` passes.

**Dependencies:** none
**Complexity:** small

### US-002: Prove browser polling, Rust websocket, and acknowledgements
**Description:** Implement the minimum Socket.IO handlers needed to prove both real clients and the existing ack shapes.

**Files:**
- `codex\codex-rs-overlay\codex-happy-compat-spike\src\server.rs`
- `codex\codex-rs-overlay\codex-happy-compat-spike\src\rust_client.rs`
- `codex\codex-rs-overlay\codex-happy-compat-spike\tests\compatibility.rs`

**Acceptance criteria:**
- [ ] Browser polling and rust_socketio websocket connect to the same server.
- [ ] Both clients join only their auth-derived fixed room and receive intended
  updates/replay.
- [ ] `rpc-call`, `session-message-range`, `update-metadata`, and `update-state` acks match the plan contract.
- [ ] `update`, cursor replay, and `replay-overflow` are proven.
- [ ] No custom Engine.IO/Socket.IO packet implementation exists.

**Dependencies:** US-001
**Complexity:** medium

### US-003: Prove CORS, paired proof, replay rejection, and restart
**Description:** Add the P0 auth/CORS harness and negative tests.

**Files:**
- `codex\codex-rs-overlay\codex-happy-compat-spike\src\auth.rs`
- `codex\codex-rs-overlay\codex-happy-compat-spike\tests\compatibility.rs`

**Acceptance criteria:**
- [ ] Exact Origin and preflight pass; wrong/wildcard Origin fails.
- [ ] Any Chromium Local Network Access preflight observed by the real browser
  is allowed for the exact configured origin only.
- [ ] Browser proof headers reach polling handshake.
- [ ] HTTP query/body tampering fails.
- [ ] Nonce replay fails in-process and after restart.
- [ ] Old invite fails after restart; fresh invite succeeds.

**Dependencies:** US-001
**Complexity:** medium

## Job J1 — codexu P0 real-browser proof

### US-004: Pin exact socket.io-client 4.8.1 in the app
**Description:** Correct the manifest/lock mismatch so P0 runs the operator-requested exact client release.

**Files:**
- `packages\happy-app\package.json`
- `pnpm-lock.yaml`

**Acceptance criteria:**
- [ ] Dependency is exact `4.8.1`, not a caret range.
- [ ] `pnpm --filter happy-app list socket.io-client --depth 0` reports 4.8.1.
- [ ] Existing app tests/typecheck remain green.

**Dependencies:** none
**Complexity:** small

### US-005: Run the actual Expo/Chromium compatibility probe
**Description:** Add a dev-only route in the existing Expo bundle and automate P0 through agent-browser.

**Files:**
- `packages\happy-app\sources\app\(app)\dev\native-happy-p0.tsx`
- `packages\happy-app\sources\dev\nativeHappyP0Probe.ts`
- `packages\happy-app\sources\dev\nativeHappyP0Probe.test.ts`
- `.ralph\jobs\codex-native-happy-server-local-web-dual-control\p0\compatibility-result.json`
- `.ralph\jobs\codex-native-happy-server-local-web-dual-control\p0\browser-proof.png`

**Acceptance criteria:**
- [ ] Real Chromium from `http://localhost:8081` connects to J0.
- [ ] Chromium generates/signs with Ed25519 and completes local pairing.
- [ ] Every required P0 transport/auth/ack/reconnect check passes.
- [ ] Exact browser/npm/Cargo versions and compatibility shims are recorded.
- [ ] P0 JSON/screenshot contain no invite, proof, nonce, or key material.
- [ ] Transport verdict is explicit GO/NO-GO and renderer verdict is explicit
  existing-renderer/separate-UI-task.

**Dependencies:** US-002, US-003, US-004
**Complexity:** medium

### US-006: Prove the existing renderer can replace a keyed snapshot
**Description:** Exercise one full-text transient item through the existing static message surface without redesign.

**Files:**
- `packages\happy-app\sources\dev\nativeHappySnapshotProbe.ts`
- reference `packages\happy-app\sources\components\ChatList.tsx`
- reference `packages\happy-app\sources\components\MessageView.tsx`
- reference `packages\happy-app\sources\fork\chat\ForkFlatChatList.tsx`

**Acceptance criteria:**
- [ ] Increasing revision replaces one item instead of appending duplicates.
- [ ] Final durable item removes/replaces the transient item.
- [ ] Result is recorded as renderer-compatible or a separate narrow UI task is required.

**Dependencies:** US-005
**Complexity:** small

## Job J2 — Codex authoritative disposition seam

### US-007: Return an authoritative server-request disposition
**Description:** Make callback removal return Applied, AlreadyResolved, or Stale under one atomic state lock.

**Files:**
- `codex\external\repos\codex-patched\codex-rs\app-server\src\outgoing_message.rs`
  (implementation and colocated tests)

**Acceptance criteria:**
- [ ] First concurrent response is Applied.
- [ ] Duplicate resolved response is AlreadyResolved.
- [ ] Cancelled/unknown/expired response is Stale.
- [ ] Tombstones have 1,024 capacity and 10-minute TTL.

**Dependencies:** P0 GO
**Complexity:** medium

### US-008: Expose disposition through in-process client events
**Description:** Return the typed disposition to callers and publish a local event so Happy observes TUI-first answers.

**Files:**
- `codex\external\repos\codex-patched\codex-rs\app-server\src\in_process.rs`
  (implementation and colocated tests)
- `codex\external\repos\codex-patched\codex-rs\app-server-client\src\lib.rs`
  (implementation and colocated tests)
- `codex\external\repos\codex-patched\codex-rs\tui\src\app.rs`
- `codex\docs\implementation\patch-surface.md`

**Acceptance criteria:**
- [ ] In-process typed API returns disposition.
- [ ] Event includes request ID and applied result/error when available.
- [ ] Existing callers may discard the result without behavior change.
- [ ] Remote handle reports typed disposition as unsupported.
- [ ] TUI without Happy tap is unchanged.

**Dependencies:** US-007
**Complexity:** medium

## Job J3 — Codex Rust server foundation

### US-009: Register the fork-only server crate and migrations
**Description:** Add the overlay crate, exact P0-proven Socketioxide dependency, workspace/Bazel locks, and embedded migrations.

**Files:**
- `codex\codex-rs-overlay\codex-happy-server\Cargo.toml`
- `codex\codex-rs-overlay\codex-happy-server\migrations\0001_initial.sql`
- `codex\codex-rs-overlay\fixtures\happy_local_v1_vectors.json`
- `codex\external\repos\codex-patched\codex-rs\Cargo.toml`
- `codex\external\repos\codex-patched\codex-rs\Cargo.lock`
- `codex\external\repos\codex-patched\MODULE.bazel`
- `codex\external\repos\codex-patched\MODULE.bazel.lock`
- `codex\scripts\audit_network_calls.sh`
- `codex\docs\implementation\patch-surface.md`

**Acceptance criteria:**
- [ ] Exact Socketioxide version equals P0 evidence.
- [ ] J3 server auth/invite/snapshot tests load applicable vectors; J4 codec
  tests consume the codec cases from the same file.
- [ ] `cargo metadata`, Bazel lock check, audit scripts, and crate check pass.
- [ ] Network audit allows only loopback for the new crates.
- [ ] Standalone P0 fixture is removed or its tests are ported with no duplicate production stack.

**Dependencies:** US-008
**Complexity:** medium

### US-010: Implement SQLite identity, messages, CAS, and paging
**Description:** Implement WAL-backed per-thread persistence and transaction invariants.

**Files:**
- `codex\codex-rs-overlay\codex-happy-server\src\db.rs`
- `codex\codex-rs-overlay\codex-happy-server\src\types.rs`
- `codex\codex-rs-overlay\codex-happy-server\src\error.rs`
- `codex\codex-rs-overlay\codex-happy-server\tests\sqlite_invariants.rs`

**Acceptance criteria:**
- [ ] Stable machine/session/tag reopen from the same DB.
- [ ] Any create/load request for a different tag is denied; the DB cannot
  grow a second live session through this API.
- [ ] LocalId dedup and contiguous message sequence are transactional.
- [ ] Global update sequence is persisted in the same mutation transaction.
- [ ] CAS conflict returns authoritative value.
- [ ] Forward/backward paging order and `hasMore` match Happy.
- [ ] Migration/newer-schema failure never deletes data.

**Dependencies:** US-009
**Complexity:** large

### US-011: Implement the scoped HTTP/Socket.IO contract
**Description:** Add only the routes, roles, events, acknowledgements, and replay required by the existing web app.

**Files:**
- `codex\codex-rs-overlay\codex-happy-server\src\http.rs`
- `codex\codex-rs-overlay\codex-happy-server\src\routes.rs`
- `codex\codex-rs-overlay\codex-happy-server\src\socket.rs`
- `codex\codex-rs-overlay\codex-happy-server\src\replay.rs`
- `codex\codex-rs-overlay\codex-happy-server\src\control.rs`
- `codex\codex-rs-overlay\codex-happy-server\tests\http_contract.rs`
- `codex\codex-rs-overlay\codex-happy-server\tests\socket_contract.rs`

**Acceptance criteria:**
- [ ] All plan-listed HTTP shapes match current app expectations.
- [ ] Browser/user-scoped and Rust/session-scoped sockets are validated.
- [ ] Per-event role allowlists reject browser state/snapshot spoofing and
  internal browser-RPC misuse without mutation.
- [ ] Auth-derived machine-user and session rooms route updates/replay with no
  caller-selected room.
- [ ] Replay ring is 1,024 and uncovered gaps produce overflow.
- [ ] Unsupported RPC returns immediately with `method_not_supported`.
- [ ] Exactly one adapter can register for the stable session; no RPC accepts a
  caller-selected thread.
- [ ] No generic `rpc-register`/RPC-room bridge exists.
- [ ] HTTP/socket payload limits reject oversize input before mutation.

**Dependencies:** US-010
**Complexity:** large

### US-012: Implement fail-closed local pairing and auth
**Description:** Implement exact Host/Origin, one-use pairing, Ed25519 proof, persistent nonce rejection, capability auth, route inventory, and rate limits.

**Files:**
- `codex\codex-rs-overlay\codex-happy-server\src\auth.rs`
- `codex\codex-rs-overlay\codex-happy-server\src\config.rs`
- `codex\codex-rs-overlay\codex-happy-server\src\routes.rs`
- `codex\codex-rs-overlay\codex-happy-server\tests\auth_security.rs`

**Acceptance criteria:**
- [ ] 120-second, one-success, explicit-reopen pairing semantics pass.
- [ ] Concurrent pair completion yields exactly one committed enrollment and
  one consumed window.
- [ ] Every route descriptor fails without valid policy auth.
- [ ] Query/body/method/path/key/nonce/freshness negatives pass.
- [ ] Socket polling proof and internal websocket capability pass.
- [ ] Reserved browser local-ID namespace is denied.
- [ ] Secrets never appear in logs/errors.

**Dependencies:** US-010, US-011
**Complexity:** large

## Job J4 — Codex native lifecycle and codec

### US-013: Add exhaustive default-off backend selection
**Description:** Add `native_happy_local_server` and branch before all legacy onboarding/daemon code.

**Files:**
- `codex\external\repos\codex-patched\codex-rs\features\src\lib.rs`
- `codex\external\repos\codex-patched\codex-rs\features\src\tests.rs`
- `codex\external\repos\codex-patched\codex-rs\tui\src\app.rs`
- `codex\external\repos\codex-patched\codex-rs\tui\src\chatwidget\slash_dispatch.rs`
- `codex\external\repos\codex-patched\codex-rs\tui\src\remote_auto_attach.rs`
- `codex\codex-rs-overlay\codex-happy\src\attach.rs`
- `codex\codex-rs-overlay\codex-happy\src\remote_on.rs`
- `codex\codex-rs-overlay\codex-happy\src\native_local.rs`

**Acceptance criteria:**
- [ ] New feature is experimental/default-off.
- [ ] Native failure never calls legacy supervisor or onboarding.
- [ ] Feature off and explicit legacy mode retain current behavior.
- [ ] Native-local does not auto-start; only explicit `/remote on` opens it.
- [ ] `HAPPY_CURRENT_SESSION_ID` or an occupied configured port produces an
  explicit collision error, never native discovery, legacy reuse, or fallback.

**Dependencies:** US-012
**Complexity:** medium

### US-014: Add explicit plaintext codec and stable session identity
**Description:** Make codec/auth/endpoint explicit and preserve browser message identity.

**Files:**
- `codex\codex-rs-overlay\codex-happy\src\codec.rs`
- `codex\codex-rs-overlay\codex-happy\src\api.rs`
- `codex\codex-rs-overlay\codex-happy\src\auth.rs`
- `codex\codex-rs-overlay\codex-happy\src\session.rs`
- `codex\codex-rs-overlay\codex-happy\src\session_state.rs`
- `codex\codex-rs-overlay\codex-happy\src\wire.rs`
- `codex\codex-rs-overlay\codex-happy\src\codec_tests.rs`
- `codex\codex-rs-overlay\codex-happy\Cargo.toml`

**Acceptance criteria:**
- [ ] Native codec stores plaintext JSON inside the compatibility envelope.
- [ ] Legacy encrypted codec is unchanged.
- [ ] Session tag is `codex-thread:<primary-thread-id>`.
- [ ] Internal HTTP/socket requests carry only the in-memory capability.
- [ ] Inbound browser message retains outer id/localId/seq.
- [ ] Rust/TS deterministic fixtures agree.

**Dependencies:** US-013
**Complexity:** large

### US-015: Own startup, invite rotation, diagnostics, detach, and restart
**Description:** Start after root thread identity, manage fixed/ephemeral ports and DB, rotate the one-use pairing gate with `/remote invite`, and stop cleanly without cancelling TUI-live approvals.

**Files:**
- `codex\codex-rs-overlay\codex-happy\src\attach.rs`
- `codex\codex-rs-overlay\codex-happy\src\native_local.rs`
- `codex\codex-rs-overlay\codex-happy\src\diagnostics.rs`
- `codex\codex-rs-overlay\codex-happy\src\native_local_tests.rs`
- `codex\codex-rs-overlay\codex-happy\src\diagnostics_tests.rs`
- `codex\external\repos\codex-patched\codex-rs\tui\src\app\event_dispatch.rs`
- `codex\docs\implementation\patch-surface.md`

**Acceptance criteria:**
- [ ] Fixed test port and default ephemeral port both work.
- [ ] Diagnostics are atomic, non-secret, and removed on graceful stop.
- [ ] Stale diagnostics are never attach/discovery authority.
- [ ] Same thread reopens same DB/session/tag.
- [ ] `/remote on` opens the initial two-minute pairing window and
  `/remote invite` invalidates the old invite and opens one fresh window.
- [ ] `/remote off` closes remote resources and leaves TUI approval live.
- [ ] `/remote off` returns only after the configured port is rebindable.
- [ ] Crash recovery uses SQLite WAL.

**Dependencies:** US-014
**Complexity:** medium

## Job J5 — Happy wire/app compatibility

### US-016: Publish local invite, proof, and snapshot schemas
**Description:** Add versioned local-only happy-wire contracts and deterministic cross-language vectors.

**Files:**
- `packages\happy-wire\src\localPairingInvite.ts`
- `packages\happy-wire\src\localPairingInvite.test.ts`
- `packages\happy-wire\src\localDeviceAuth.ts`
- `packages\happy-wire\src\localDeviceAuth.test.ts`
- `packages\happy-wire\src\sessionOutputSnapshot.ts`
- `packages\happy-wire\src\sessionOutputSnapshot.test.ts`
- `packages\happy-wire\src\fixtures\happy_local_v1_vectors.json`
- `packages\happy-wire\src\index.ts`

**Acceptance criteria:**
- [ ] Invite and proof reject malformed/non-loopback/cross-origin values.
- [ ] Canonical query/body/signature vectors are deterministic.
- [ ] Snapshot schema enforces size/revision/identity bounds.
- [ ] TypeScript tests load the same canonical vector content checked by the
  Rust jobs.
- [ ] Existing public schemas remain unchanged.

**Dependencies:** P0 GO
**Complexity:** medium

### US-017: Add explicit local credentials, enrollment, and transport auth
**Description:** Extend app credential/auth selection without inferring local mode from URL.

**Files:**
- `packages\happy-app\sources\auth\tokenStorage.ts`
- `packages\happy-app\sources\auth\machineAuth.ts`
- `packages\happy-app\sources\auth\localEnrollment.ts`
- `packages\happy-app\sources\auth\localEnrollment.test.ts`
- `packages\happy-app\sources\auth\publicEnrollment.ts`
- `packages\happy-app\sources\sync\socketOptions.ts`
- `packages\happy-app\sources\sync\apiSocket.ts`

**Acceptance criteria:**
- [ ] Explicit auth-mode migration is tested.
- [ ] Local enrollment reuses a known machine's keypair when available, signs
  pair completion, updates the endpoint only after success, and discards the
  pair secret.
- [ ] Local HTTP uses fresh signed proof.
- [ ] Local browser socket is polling-only and explicit reconnect gets fresh nonce.
- [ ] After enrollment, `authMode:'paired-device'` signs every normal request;
  persisted Cloudflare fields select the unchanged public proof, their absence
  selects the local proof, and neither mode is inferred from the URL.
- [ ] Partial paired credentials fail closed and never trigger Dev-Tunnels
  refresh.
- [ ] Local envelope tests lock the app's existing plaintext parser while the
  native Rust backend selects `LegacyPlainJsonV1`.
- [ ] Public and Dev-Tunnels headers remain unchanged.

**Dependencies:** US-016
**Complexity:** large

### US-018: Add ephemeral snapshot state through the existing renderer
**Description:** Store latest revision per item and compose one transient standard message row.

**Files:**
- `packages\happy-app\sources\sync\apiTypes.ts`
- `packages\happy-app\sources\sync\sync.ts`
- `packages\happy-app\sources\sync\storage.ts`
- `packages\happy-app\sources\sync\sessionOutputSnapshot.test.ts`
- `packages\happy-app\sources\-session\SessionView.tsx`
- `packages\happy-app\sources\-session\SessionView.snapshot.test.tsx`
- conditional `packages\happy-app\sources\components\MessageView.tsx`
- conditional `packages\happy-app\sources\components\ChatList.tsx`
- conditional `packages\happy-app\sources\fork\chat\ForkFlatChatList.tsx`

**Acceptance criteria:**
- [ ] Lower/equal revisions are ignored.
- [ ] Bare snapshot session IDs are localized with the authenticated source
  machine before app storage.
- [ ] Reconnect restores latest snapshot.
- [ ] Durable final local ID clears transient state.
- [ ] Transient state is excluded from app persistence/hydration and durable
  history.
- [ ] Existing static renderer is used unless P0 filed the narrow UI task.

**Dependencies:** US-016, US-006
**Complexity:** medium

### US-019: Dispatch local invites through the existing server screen
**Description:** Reuse the current pairing screen for strict public and local invite types and document the app change.

**Files:**
- `packages\happy-app\sources\app\(app)\server.tsx`
- `packages\happy-app\sources\text\_default.ts`
- `packages\happy-app\sources\text\translations\ca.ts`
- `packages\happy-app\sources\text\translations\en.ts`
- `packages\happy-app\sources\text\translations\es.ts`
- `packages\happy-app\sources\text\translations\it.ts`
- `packages\happy-app\sources\text\translations\ja.ts`
- `packages\happy-app\sources\text\translations\pl.ts`
- `packages\happy-app\sources\text\translations\pt.ts`
- `packages\happy-app\sources\text\translations\ru.ts`
- `packages\happy-app\sources\text\translations\zh-Hans.ts`
- `packages\happy-app\sources\text\translations\zh-Hant.ts`
- `packages\happy-app\sources\text\translations.test.ts`
- `packages\happy-app\CHANGELOG.md`
- `packages\happy-app\sources\changelog\changelog.json`
- remove J1 dev probe files

**Acceptance criteria:**
- [ ] Existing screen dispatches by invite kind.
- [ ] Public invite remains strict.
- [ ] Local invite pairs with no new navigation flow.
- [ ] Existing pairing copy no longer implies that every server is public or
  Dev-Tunnels-hosted.
- [ ] Changelog artifacts are current.
- [ ] App typecheck and targeted tests pass.

**Dependencies:** US-017
**Complexity:** medium

## Job J6 — Codex dual-control correctness

### US-020: Preserve and deduplicate user-message origins
**Description:** Mirror browser and TUI prompts exactly once using reserved client/local IDs.

**Files:**
- `codex\codex-rs-overlay\codex-happy\src\attach.rs`
- `codex\codex-rs-overlay\codex-happy\src\inbound.rs`
- `codex\codex-rs-overlay\codex-happy\src\mapping.rs`
- `codex\codex-rs-overlay\codex-happy\src\session.rs`
- `codex\codex-rs-overlay\codex-happy\src\wire.rs`
- `codex\codex-rs-overlay\codex-happy\src\attach_e2e_tests.rs`
- `codex\codex-rs-overlay\codex-happy\src\inbound_tests.rs`
- `codex\codex-rs-overlay\codex-happy\src\mapping_tests.rs`
- `codex\codex-rs-overlay\codex-happy\src\session_tests.rs`
- `codex\codex-rs-overlay\codex-happy\src\wire_tests.rs`

**Acceptance criteria:**
- [ ] Browser outer id/localId/seq survive to dispatch.
- [ ] `happy:<localId>` suppresses Happy-origin TUI echo.
- [ ] `codex-origin:user:<itemId>` mirrors TUI prompt once.
- [ ] Consumption is emitted only after Codex accepts input.

**Dependencies:** US-015, US-019
**Complexity:** large

### US-021: Serialize TurnStart/TurnSteer and both race fallbacks
**Description:** Route all browser input to the one root thread with no lost or duplicated message.

**Files:**
- `codex\codex-rs-overlay\codex-happy\src\control.rs`
- `codex\codex-rs-overlay\codex-happy\src\attach.rs`
- `codex\codex-rs-overlay\codex-happy\src\inbound.rs`
- `codex\codex-rs-overlay\codex-happy-server\src\control.rs`
- `codex\codex-rs-overlay\codex-happy\src\control_tests.rs`

**Acceptance criteria:**
- [ ] Idle input uses TurnStart.
- [ ] Active input uses TurnSteer.
- [ ] Start losing to TUI start retries once as steer.
- [ ] Steer losing to completion retries once as start.
- [ ] Second failure remains pending with a redacted typed diagnostic; later
  browser sequence values cannot overtake it.
- [ ] Browser cannot select/create another thread.

**Dependencies:** US-020
**Complexity:** large

### US-022: Complete streaming, approval, interrupt, and detach arbitration
**Description:** Add coalesced snapshots/tool events, consume authoritative dispositions, and separate abort from detach.

**Files:**
- `codex\codex-rs-overlay\codex-happy\src\agent_state.rs`
- `codex\codex-rs-overlay\codex-happy\src\attach.rs`
- `codex\codex-rs-overlay\codex-happy\src\control.rs`
- `codex\codex-rs-overlay\codex-happy\src\mapping.rs`
- `codex\codex-rs-overlay\codex-happy\src\session_state.rs`
- `codex\codex-rs-overlay\codex-happy-server\src\control.rs`
- `codex\codex-rs-overlay\codex-happy-server\src\socket.rs`
- `codex\codex-rs-overlay\codex-happy-server\src\routes.rs`
- `codex\codex-rs-overlay\codex-happy\src\streaming_tests.rs`
- optional bounded TUI event passthrough in
  `codex\external\repos\codex-patched\codex-rs\tui\src\app.rs`

**Acceptance criteria:**
- [ ] Full snapshots emit at ≤4 Hz and clear after durable final commit.
- [ ] Tool start/end remain durable.
- [ ] Approval ack is Applied/AlreadyResolved/Stale from J2 authority.
- [ ] Tests keep Happy-visible approval IDs distinct from app-server RequestIds.
- [ ] TUI-first result reconciles Happy agent state.
- [ ] Browser abort cancels pending approvals then interrupts; idle returns Idle.
- [ ] Browser `killSession` performs explicit abort-then-detach, while passive
  disconnect does not cancel or interrupt.
- [ ] `/remote off` neither interrupts the active turn nor resolves TUI-live
  approvals.
- [ ] `/remote off` clears only the persisted Happy pending mirror and records
  no false completed outcome.

**Dependencies:** US-008, US-018, US-021
**Complexity:** large

## Job J7 — codexu dogfood, evidence, docs, and integration

### US-023: Execute deterministic same-machine dual-control acceptance
**Description:** Run a live Codex TUI and existing Happy web UI against the final Rust server and capture process/port/DB evidence.

**Files:**
- `codex` gitlink
- `scripts\fork-setup\verify-codex-native-happy-local.ps1`
- `scripts\fork-setup\inspect-happy-local-db.py`
- `.ralph\jobs\codex-native-happy-server-local-web-dual-control\acceptance\evidence.json`
- `.ralph\jobs\codex-native-happy-server-local-web-dual-control\acceptance\steps.md`
- `.ralph\jobs\codex-native-happy-server-local-web-dual-control\acceptance\browser.png`
- `.ralph\jobs\codex-native-happy-server-local-web-dual-control\acceptance\server-log.redacted.jsonl`

**Acceptance criteria:**
- [ ] All alternating-turn, steering, race, snapshot/tool, approval, interrupt, reconnect, off/on, and restart steps pass.
- [ ] Exactly one session/tag exists for the root thread.
- [ ] Listener owner is the Codex PID.
- [ ] No happy-cli, Node happy-server, standalone app-server child, Dev Tunnel, Cloudflare child, or legacy fallback hosts the session plane.
- [ ] The primary thread UUID is recorded before shutdown; the built fork
  launcher restarts with `codex resume <THREAD_ID>`, and a fresh invite is
  imported into the same `codex-thread:<THREAD_ID>` session with history
  present exactly once.
- [ ] Consumed invite fails; `/remote invite` rotates secret and nonce; a fresh
  browser profile enrolls with the new invite.
- [ ] Rust and TypeScript contract-vector normalized contents match.
- [ ] Machine-readable evidence/logs contain no secrets or transcript text;
  DB inspection also excludes settings values, and screenshots use only
  synthetic non-sensitive labels and exclude invites.

**Dependencies:** US-019, US-022
**Complexity:** large

### US-024: Document local-only security and defer release
**Description:** Record the real launch path, plaintext limitation, default-off flags, rollback, and remote-release blockers.

**Files:**
- `docs\security-model.md`
- `docs\fork-notes.md`
- `AGENTS.md` only for a newly discovered recurring trap
- reference `codex\docs\implementation\patch-surface.md`

**Acceptance criteria:**
- [ ] Docs state loopback-only, paired auth, and exact process ownership.
- [ ] Docs explicitly state message, metadata, agent-state, and settings
  plaintext (including possible inference keys), plus localStorage seed risk.
- [ ] Docs state Node is allowed only for web build tooling.
- [ ] Docs state native errors never fall back.
- [ ] Release, auto-attach default, remote/LAN/tablet transport, and remote encryption remain deferred.
- [ ] Phase 5b docs review is clean.

**Dependencies:** US-023
**Complexity:** medium

## Cross-job completion rules

- J0/J1 must issue a GO before J2–J7.
- Transport GO plus renderer `REQUIRES_SEPARATE_UI_TASK` allows non-UI
  server/schema/auth work but blocks US-018, snapshot-dependent J6 acceptance,
  and J7 until the UI task lands.
- Codex nested jobs merge inner patched commits before wrapper commits and run serially.
- J5 may run parallel with J2–J4 but J6 waits for its frozen interface.
- Only J7 updates the parent codexu `codex` gitlink.
- Every job completes targeted verification plus Phase 5a code review-fix and Phase 5b docs review-fix convergence.
- No implementation job pushes; the lead owns merge/push.
