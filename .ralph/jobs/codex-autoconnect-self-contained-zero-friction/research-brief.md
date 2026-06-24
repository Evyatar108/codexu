# Research Brief — Codex Raw-Autoconnect Phase 1

## Researcher Findings (Explore agent — succeeded)

### 1. Self-onboard seam (`codex/codex-rs-overlay/codex-happy/src/onboard.rs`)
Built (device flow → cred mint), unwired: `request_device_code` (137-165), `poll_for_token` (172-242),
`generate_data_key_credentials` (247-256), `write_credentials` (262-277), `fetch_github_profile`
(283-311), `write_profile` (314-323), `seed_machine_id` (329-350), `complete_onboard_with_token`
(357-371). Module doc (1-23) says interactive surfacing + browser-open + the *when* decision belong to
the attach layer, not this module. `write_credentials` (262-277) atomically writes `access.key` with NO
chmod → the M1 0o600 fix lands there. Tests in `onboard_tests.rs:17-231` cover all seams except
chmod/surfacing. Unix-perms precedent: `codex-rs-overlay/codex-copilot/src/auth.rs:263-266`
(`.mode(0o600)`); `app-server-transport/src/transport/unix_socket_tests.rs:25-33` (`PermissionsExt`).

### 2. `/remote on` seam
Bare `/remote` info: `tui/src/chatwidget/slash_dispatch.rs:382-391`. `/remote on|off` arm (720-751):
flips `Feature::RemoteSession`, gates on `codex_happy::attach::credentials_ready()`, sends
`AppEvent::SetRemoteSession{enabled}`. Tap attach/detach owner: `tui/src/app/event_dispatch.rs:16-45`
(`apply_remote_session_toggle`). Event carrier: `tui/src/app_event.rs:200-207`. `credentials_ready()` =
creds + machine-state present (`attach.rs:136-145`).

### 3. TUI surfacing primitives
`add_info_message(...)` is the info/progress primitive. **Browser-open already vendored:**
`webbrowser::open(...)` in `tui/src/onboarding/auth.rs:1-75` and `tui/src/app/history_ui.rs`. Async
background→TUI reporting precedent: `SlashCommand::Diff` spawns a task + sends `AppEvent::DiffResult`
(`slash_dispatch.rs:393-417`); remote toggle uses `AppEvent::SetRemoteSession` (`app_event.rs:200-207`).

### 4. Silent fallback seam (`attach.rs`)
`maybe_attach()` → `Option<UnboundedSender<AppServerEvent>>`; `None` = vanilla (110-128).
`credentials_ready()` is preflight-only (140-145). Failure swallowed in `run_attach`:
`Ok(None) | Err(_) => return` (147-180). `establish()` → `Option<(SessionClient,
UnboundedReceiver<InboundEvent>)>`, `None` on ANY creds/machine/session/connect failure (339-379). No
signal to TUI today; `tap.send` becomes no-op after background exit. Diagnosed-error plumbing point:
change the `establish`/`run_attach` return path + surface an `AppEvent` through `app_event_tx`.

### 5. Daemon-lifecycle reference (happy-cli — REFERENCE ONLY)
Entrypoint codex spawns: **`happy daemon start-sync`** (detached) via `ensureDaemonRunning()`
(`packages/happy-cli/src/daemon/ensureDaemonRunning.ts:8-38`), which polls
`checkIfDaemonRunningAndCleanupStaleState()` until state written + bound + reachable. `src/index.ts:17-24,
53-64` dispatches `daemon start` → `startDaemon()` (`daemon/run.ts`, writes `machine.json` at 233-268).
Readiness (`daemonClient.ts:26-74`): TCP-probe `tunnelPort` + `loopbackPort`, require `machine.json`
`{machineId,tunnelPort,loopbackPort,tunnelId,lastTunnelUrl}` + loopback capability. `daemon.state.json`
per `daemon/AGENTS.md:133-167`.

### 6. Patch-surface / overlay discipline
remote_session registered at `docs/implementation/patch-surface.md:979-1040` ("Happy native
remote-session overlay egress — US-008"), invariants 54-59; invariant 59 = `/remote on|off` command
seam. Named seams: `tui/src/app.rs`, `features/src/lib.rs`, `features/src/tests.rs`,
`app-server-client/src/lib.rs`, `tui/Cargo.toml`. Format: `// SANDBOX PATCH:` marker + invariant row +
rebase-replant note (CLAUDE.md tenet 1).

### 7. Build/test commands
Typecheck: `cargo check --workspace` from `codex/external/repos/codex-patched/codex-rs` (CLAUDE.md).
Tests via `just test -p <project>` (not raw `cargo test`); `just fmt` after edits; `just fix -p <project>`
before finalizing. codex-happy tests are `#[path="..._tests.rs"]` modules.

## Architect Analysis (Explore agent — succeeded)

- **Self-onboard:** background task (device flow polls ~15 min; `onboard.rs:167-241` already models long
  polling), surface results via an AppEvent (like `AppEvent::SetRemoteSession`); display user_code +
  `DeviceCode::display_uri()` + browser-open before await.
- **Daemon lifecycle:** small Rust trait/enum provider in codex-happy (start/ensure/stop/health); Phase-1
  impl shells to `happy daemon start` + machine.json probe; Phase-2 in-process Rust impl behind the same
  trait. Keep callers talking to ONE codex-happy abstraction, not happy-cli directly.
- **Hard diagnosed error:** replace `establish()` `Option` with typed error {NoCreds, NoDaemon,
  SessionCreateFailed, ConnectFailed}; `maybe_attach` may still return immediately but reports a typed
  result back to `/remote on` via callback/channel. **Keep the constructor-time `app.rs:1027-1103`
  `maybe_attach` silent fallback for non-remote startup; only `/remote on` hard-errors.**
- **Ordering:** (1) M1 chmod (independent) → (2) self-onboard wiring → (3) daemon lifecycle seam → (4)
  typed diagnosed error / TUI surfacing.
- **Constraints:** 8s `CONNECT_BUDGET` (attach.rs:73-75) too short for daemon startup → the lifecycle
  seam must distinguish "starting" vs "dead"; long-poll off the main thread; cfg-gated chmod;
  `HAPPY_CURRENT_SESSION_ID` idempotency guard intact; partial-state (onboard ok, daemon-start fail) must
  hard-error not "local-only".
- **Tests:** unit-testable in codex-happy (onboard hermetic via parameterized base_url); TUI harness
  (`tui/src/app/tests.rs` exercises remote-session toggles / `happy_tap`); clean-machine wipe-`~/.happy`
  spike is impl-time only.

## Codex Research
Not run — process hung past the 5-min budget on this environment (no output produced); stopped. (Codex
review is purely additive; the two Explore agents + first-hand source reads provide full grounding.)

## Copilot Research
Failed — `copilot-exec --read-only` snapshot budget exceeded (512MB) on `.xwin-cache` /initialized
submodule in the primary checkout. Known environmental limitation (tracked separately as
`ralph-copilot-exec-readonly-submodule-snapshot-cost`). Phase 4 copilot review will run from the small
plan worktree cwd (empty submodule, no cache) to stay under budget.

## Consolidated File List

**Files to modify (codex submodule — overlay):**
- `codex/codex-rs-overlay/codex-happy/src/onboard.rs` (M1 0o600 in write_credentials; export driver)
- `codex/codex-rs-overlay/codex-happy/src/attach.rs` (typed `AttachError`; intent vs constructor split)
- `codex/codex-rs-overlay/codex-happy/src/lib.rs` (module exports)

**Files to create (codex submodule — overlay):**
- `codex/codex-rs-overlay/codex-happy/src/remote_on.rs` (+ `remote_on_tests.rs`) — onboard driver +
  diagnosed orchestration
- `codex/codex-rs-overlay/codex-happy/src/daemon_supervisor.rs` (+ tests) — server-agnostic supervisor

**Files to modify (codex submodule — upstream-canonical, SANDBOX PATCH each):**
- `codex/external/repos/codex-patched/codex-rs/tui/src/chatwidget/slash_dispatch.rs` (`/remote on` arm)
- possibly `tui/src/app_event.rs` + `tui/src/app/event_dispatch.rs` (a result-bearing AppEvent)
- `codex/docs/implementation/patch-surface.md` (register new SANDBOX PATCH rows, extend invariant 59)

**Reference only (NOT edited):**
- `packages/happy-cli/src/daemon/{ensureDaemonRunning,daemonClient,run}.ts`, `daemon/AGENTS.md`,
  `src/index.ts`

**Build/test:** `cargo check --workspace`; `just test -p codex-happy` / `-p codex-tui`; `just fmt`.
