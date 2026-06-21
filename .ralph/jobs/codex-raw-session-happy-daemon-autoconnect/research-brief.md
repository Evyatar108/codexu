# Research Brief — codex-raw-session-happy-daemon-autoconnect (Direction B)

> Compiled from two Explore agents (researcher, architect) against the MAIN checkout
> `D:/harness-efforts/codexu` (codex submodule initialized there; the plan worktree has
> uninitialized submodules so research targeted the main checkout). codex-exec research
> stalled (~19 min, no output) and was stopped; copilot-exec research/review fail on this
> box (read-only snapshot budget exceeded by the ~500MB `.xwin-cache` VC++ tree). The two
> Explore briefs + the authoritative spike/brainstorm inputs fully ground the plan.

## Researcher Findings

### 1. Overlay crate workspace
- Workspace root Cargo.toml: `codex/external/repos/codex-patched/codex-rs/Cargo.toml` (1-132).
- Overlay members wired into the upstream workspace `[workspace.members]` (lines ~123-131):
  `../../../../codex-rs-overlay/{codex-copilot, codex-copilot-launcher, codex-mcp-notification-bridge,
  codex-plugin-scope, codex-invariant-tests, codex-stream-diagnostics}`.
- Overlay deps pinned in `[workspace.dependencies]` (166-221), e.g.
  `codex-copilot = { path = "../../../../codex-rs-overlay/codex-copilot" }`.
- Each overlay crate's Cargo.toml declares `workspace = "../../external/repos/codex-patched/codex-rs"`
  (e.g. `codex-copilot/Cargo.toml:1-6`).
- => New crate `codex-happy` = add a member line + a `[workspace.dependencies]` path entry + a crate
  Cargo.toml that points `workspace = "../../external/repos/codex-patched/codex-rs"`.

### 2. Auth precedent — `codex/codex-rs-overlay/codex-copilot/src/auth.rs`
- Device flow: `CopilotAuth::login()` (154-168), `request_device_code()` (284-309),
  `poll_access_token()` (311-373), `fetch_user_login()` (375-394).
- Public surface: `new()` (101-110), `copilot_token()` (170-213), `request_headers()` (215-249),
  `invalidate_cached_copilot_token()` (272-282).
- On-disk creds on `AppPaths` (`github_token_path`, `copilot_token_path`, `device_id_path`,
  `machine_id_path`), read/write at 422-455 / 473-514, secret perms via `write_secret_file()` (458-471).
- NOTE: `packages/happy-cli/src/api/auth.ts` is a deprecated shim — not a live auth flow.

### 3. Launcher — `codex/codex-rs-overlay/codex-copilot-launcher/`
- Exec/spawn: Unix `exec()` `src/main.rs:167-174`; Windows spawn+wait+exit `src/main.rs:176-187`.
- Config struct `src/config.rs:3-8`: fields `default_shell`, `auto_load_claude_md`,
  `style_user_messages`, `enable_anthropic`.
- Config file `~/.codex-copilot/config.toml` resolved `src/config.rs:122-124`; parser `load_config()` 36-48.
- Env wiring `configure_launcher_env()` `src/main.rs:94-117`: sets `OPENAI_API_KEY`,
  strips proxy vars, sets `CODEX_TUI_USER_MESSAGE_STYLE`, optionally `CODEX_ENABLE_ANTHROPIC`.
- **`provider_config_flags()` `src/config.rs:80-119`** emits `-c features.remote_control=false` (86-90),
  `-c features.unified_exec=true` (91-95), `additional_instructions=...` (109-118). This is the
  established experimental-features kill-switch/opt-in mechanism to model `features.happy_autoconnect` on.

### 4. Control seam target (patched upstream tree)
- Chokepoint: `tui/src/app.rs:1202-1210` — `app_server.next_event()` match arm (outbound tee site).
- `app-server-client/src/lib.rs`: `AppServerEvent` 119-125 (`#[derive(Debug, Clone)]` ✓);
  `InProcessAppServerRequestHandle` 458-461; `AppServerRequestHandle` 463-467; `AppServerClient` 469-472;
  `request_handle()` 599-603 & 920-925.
- **`resolve_server_request()` ALREADY EXISTS at 684-709 + enum dispatch 884-892; `reject_server_request()`
  ALREADY EXISTS 711-737 + dispatch 895-903** in the current tree (spike had to ADD them at 0.141 HEAD
  50ac507c). => Must VERIFY at impl time whether they're already on the cloneable handle; if so, the only
  guaranteed upstream modification is the outbound tee + `happy_tap` field.
- `core/src/session/mod.rs`: `Codex { tx_sub, rx_event }`; `rx_event` single-consumer `pub(crate)` (the
  reason the seam is the app-server boundary, NOT raw Codex).

### 5. Patch-surface doc — `codex/docs/implementation/patch-surface.md`
- §4 network audit + seam registry at 63-85 (lists network-suppression files incl. remote-control/launcher
  kill-switches). §14 "Invariant-to-test mapping" at 769 (table; enforcement column = overlay/in-tree/grep/
  windows-only). §15 "Redirect upstream install/update paths replant" at 1356.
- Registration format = §14 table rows, e.g. invariant 10 (~800):
  `| 10 | Launcher provider flags emit features.remote_control=false. | grep | scripts/audit_invariants.sh ... |`.
  Plus `// SANDBOX PATCH:` markers in source + file-scoped guards. There is a `scripts/audit_invariants.sh`.

### 6. Network audit — `codex/scripts/audit_network_calls.sh`
- Phase 1 known patch sites 216-273; Phase 2 scan for new call sites 277-340.
- Allowlist mechanism: `KNOWN_PATCH_FILES` 34-48, `OVERLAY_KNOWN_PATCH_FILES` 69-74,
  `EXCLUDED_FILES` 118-197, `ENDPOINT_PATTERNS` 90-116.
- **Caveat:** canonical (non-worktree) `runtime_audit_allowlist.txt` / `runtime_audit.ps1` were NOT found —
  only worktree copies. Verify their real location/format at impl time; the brainstorm reference may be stale.

### 7. Happy protocol TS source to port — `packages/happy-cli/src/api/`
- `encryption.ts` exports: `encodeBase64/encodeBase64Url/decodeBase64`, `getRandomBytes`,
  `libsodiumPublicKeyFromSecretKey`, `libsodiumEncryptForPublicKey`, `encryptLegacy/decryptLegacy`,
  `encryptWithDataKey/decryptWithDataKey`, `encrypt/decrypt`, `authChallenge`.
- `api.ts`: `ApiClient.getOrCreateSession()` 28-132; `POST /v1/sessions` 56-72; dataKey vs legacy 34-54.
- `apiSession.ts`: `ApiSessionClient`; Socket.IO `path:'/v1/updates'` 261-269; session auth base 222-229;
  message/encryption/routing 281-760.
- **`@slopus/happy-wire` is `workspace:*`** (`packages/happy-cli/package.json:76`; pnpm-lock workspace links)
  — an in-repo workspace package, NOT a published npm version. The drift guard pins/compares the in-repo
  schema source, not an npm semver.

### 8. Enforcing-test pattern — `codex/codex-rs-overlay/codex-invariant-tests`
- Tests under `tests/` (not `src/`); use `include_str!()` to read production source text; structural-only
  assertions (marker presence, ordering, cross-file field propagation); no production logic in the crate.
- Models: `tests/safety_rails_injection.rs:1-62`, `tests/plugin_scope_filtering.rs:1-163`.
- => Model for (a) the seam-invariant test (assert `// SANDBOX PATCH:` markers at the tee) and (b) the
  happy-wire drift guard.

## Architect Analysis

### Integration points
- Outbound tee `tui/src/app.rs:1202-1208` (modification of existing control flow — the one conflict-creating edit).
- Inbound turns/interrupt/stop/approvals via cloneable `AppServerRequestHandle` +
  `AppServerClient::{resolve,reject}_server_request` `app-server-client/src/lib.rs:599-603,684-709,712-730,884-925`
  (additive / low-conflict).
- **Approval-resolve already bridged upstream** at `tui/src/app_server_session.rs:1136-1141` — overlay can
  piggyback; usually NO new core logic for approvals.

### Attach mechanism
- Launcher exec()s and exits → cannot host the client. Attach inside `tui/src/app.rs:1137-1204` (after
  `app_server` is constructed, before the main loop) via `codex_happy::attach(tap_rx, request_handle)`.
- Gating: creds present + feature enabled + NOT already Happy-driven + silent fallback otherwise.
- Launch-time env/config plumbing reused from `codex-copilot-launcher/src/{main.rs:94-116, config.rs}`.

### Idempotency / double-wrap
- `HAPPY_CURRENT_SESSION_ID` defined `packages/happy-cli/src/utils/envNames.ts:1-4`; set on the codex child
  env at `packages/happy-cli/src/codex/runCodex.ts:943-953`; reattach check
  `packages/happy-cli/src/codex/codexAppServerClient.ts:1003-1023`.
- Codex subcommand dispatch `cli/src/main.rs:627-645`; app-server parse/dispatch `cli/src/main.rs:2243-2276`.
- Rule: if `HAPPY_CURRENT_SESSION_ID` set OR subcommand is `app-server` → do NOT autoconnect.

### Dependency graph (audit-friction sizing)
- ALREADY in the patched workspace: `crypto_box` (Cargo.toml:307), `ed25519-dalek` (:319), `reqwest` (:384),
  `sha2` (:405), `aes-gcm` (Cargo.toml:300 use-aes-gcm / Cargo.lock:200), `x25519-dalek` (Cargo.lock:15585).
- **NET-NEW audited surface: `xsalsa20poly1305` + `rust-socketio` only.** (xsalsa20poly1305 backs legacy
  secretbox; rust-socketio backs the /v1/updates client.)

### Risk ranking (architect)
1. NEW audited network egress in codex-core (highest residual) — update `audit_network_calls.sh` +
   allowlist + patch-surface §4.
2. E2EE key-ownership shift into the audited binary (codex reads `~/.happy`, owns per-session data keys).
3. Approval double-answer (dedup by request-id or suppress local UI).
4. Perpetual `@slopus/happy-wire` drift tax (pin + CI guard).
5. Startup-latency / fallback budget (offline/no-creds → silent vanilla codex).
6. Windows `codex.ps1` parity.
7. Live-server auth-mode/cap-file uncertainty (environmental, not protocol) → EARLY live round-trip de-risk.

### Suggested sequencing (architect)
1. Early live happy-server round-trip (de-risk auth/mode) → 2. Crypto module → 3. POST /v1/sessions →
4. Socket.IO client → 5. Bounded TUI/app-server seam → 6. Launcher wiring + idempotency + fallback →
7. Audit registration + drift guard. Overlay crate is unit-testable in isolation up through the socket client;
only the seam + attach need the upstream boundary edits.

## Codex Research
Not run (codex-exec stalled ~19 min with no output; stopped per "never block on research").

## Copilot Research
Failed: copilot-exec `--read-only` snapshot budget exceeded by the ~500MB `.xwin-cache` VC++ tree on this
Windows box (env limitation; copilot is additive). Same wall will hit Phase-4 copilot review → codex + Claude
are the review safety net.

## Authoritative inputs already read by the planner (anchor the plan)
- `selected-direction.md` — Direction B scope contract (In/Out/Criteria).
- `brainstorm-synthesis.md` — B-vs-D analysis + 3 costs (drift tax, new audited egress, key-ownership shift).
- `investigations/codex-raw-autoconnect-spike/findings.md` — GO verdict; app-server-boundary seam; crypto
  proven byte-compatible bidirectionally; POST/Socket.IO contract characterized; port size L.
- `investigations/.../probe-a-seam.diff` — the exact proven seam (2 files: app.rs tee + happy_tap field;
  app-server-client additive resolve/reject methods).
- `investigations/.../cryptocompat/Cargo.toml` — exact crate set: sha2 0.10, crypto_box 0.9 (std),
  xsalsa20poly1305 0.9, aes-gcm 0.10, ed25519-dalek 2, hex 0.4.

## Consolidated File List
**New (create):**
- `codex/codex-rs-overlay/codex-happy/` (Cargo.toml, src/lib.rs, src/encryption.rs, src/api.rs,
  src/session.rs (Socket.IO), src/auth.rs, src/wire.rs (serde), src/attach.rs)
- `codex/codex-rs-overlay/codex-invariant-tests/tests/happy_seam_invariants.rs` (or new test module)
- happy-wire drift-guard test + pinned schema snapshot

**Modify (upstream-canonical seam — `// SANDBOX PATCH:` + register):**
- `codex/external/repos/codex-patched/codex-rs/tui/src/app.rs` (tee + happy_tap field + attach call)
- `codex/external/repos/codex-patched/codex-rs/app-server-client/src/lib.rs` (only if resolve/reject not
  already on the cloneable handle — verify first)
- `codex/external/repos/codex-patched/codex-rs/Cargo.toml` (workspace member + dep entry)

**Modify (overlay / launcher):**
- `codex/codex-rs-overlay/codex-copilot-launcher/src/{main.rs, config.rs}` (kill-switch field, env/feature
  plumbing, idempotency gate)

**Modify (audit / docs):**
- `codex/scripts/audit_network_calls.sh` (OVERLAY_KNOWN_PATCH_FILES / ENDPOINT_PATTERNS)
- `codex/docs/implementation/patch-surface.md` (§4 egress + §14 invariant rows)
- runtime audit allowlist (verify canonical path at impl time)
- Windows `codex.ps1` launcher path (parity)

**Reference (do not modify):**
- `packages/happy-cli/src/api/{encryption,api,apiSession}.ts`, `src/utils/envNames.ts`,
  `src/codex/{runCodex.ts, codexAppServerClient.ts}`
- `.ralph/investigations/codex-raw-autoconnect-spike/` (crypto + seam evidence)
