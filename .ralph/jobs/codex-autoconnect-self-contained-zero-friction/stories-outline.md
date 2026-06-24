# Stories Outline: Codex Raw-Autoconnect Phase 1 — Self-Onboard, Daemon Lifecycle, Hard Diagnosed Errors

*Preliminary decomposition from `/plan-with-ralph`. Feed to `/implement-with-ralph --from-plan` for PRD generation.*

> **Scope: Phase 1 only** (server-agnostic, codex-submodule-only). All edits are overlay-first per
> codex/CLAUDE.md tenet 1; every upstream-canonical seam carries a `// SANDBOX PATCH:` marker + a
> `docs/implementation/patch-surface.md` row + a rebase-replant note. Stories land on ONE codex submodule
> topic branch with a single submodule-pointer bump (run serially — they share `attach.rs`,
> `slash_dispatch.rs`, `lib.rs`, and `patch-surface.md`).

## US-001: Restrict `~/.happy/access.key` to `0o600` on Unix (M1 fix)
**Description:** As a security-conscious user, I want codex's self-onboarded `access.key` (bearer token +
key material) created with owner-only `0o600` permissions on Unix, so the credential is never world/group
readable — not even transiently.
**Acceptance Criteria:**
- [ ] `codex/codex-rs-overlay/codex-happy/src/onboard.rs::write_credentials` creates the `access.key`
      file (AND its temp file, if `write_json_atomically` uses tmp+rename) at mode `0o600` via
      secure-create — e.g. `OpenOptions::new().write(true).create(true).truncate(true).mode(0o600)` — NOT
      a chmod-after-write that leaves a world-readable window. Gated `#[cfg(unix)]` (Windows is a no-op).
      Precedent: `codex-rs-overlay/codex-copilot/src/auth.rs:263-266`. The atomic rename is preserved.
- [ ] A unit test in `onboard_tests.rs` (using a temp `HAPPY_HOME_DIR`, never the developer's real
      `~/.happy`) asserts the resulting `access.key` mode is `0o600` on Unix (`#[cfg(unix)]`-gated via
      `std::os::unix::fs::PermissionsExt`); profile.json/settings.json (non-secret) are unaffected.
- [ ] `just test -p codex-happy` passes; `just fmt` clean.
- [ ] Typecheck passes (`cargo check --workspace`).
**Dependencies:** None
**Estimated complexity:** small

## US-002: Typed `AttachError` + hard-diagnosed `/remote on` failure (no silent vanilla fallback on intent)
**Description:** As a user who explicitly runs `/remote on`, I want a clear error telling me *why* remote
session could not start (no creds / no daemon / session-create / connect failure) instead of silently
falling back to local-only codex.
**Acceptance Criteria:**
- [ ] `codex/codex-rs-overlay/codex-happy/src/attach.rs::establish` returns a typed result (e.g.
      `Result<(SessionClient, UnboundedReceiver<InboundEvent>), AttachError>`) where `AttachError`
      distinguishes at least `NoCredentials`, `NoDaemon`/`ListenerUnreachable`, `SessionCreateFailed`,
      `ConnectFailed`. Each `None`-return site in the current `establish` (attach.rs:339-379) maps to a
      specific variant.
- [ ] The **constructor-time** attach path (`tui/src/app.rs:1027-1103` → `maybe_attach`) keeps the
      silent vanilla fallback — non-`/remote on` startup behavior is unchanged (no regression).
- [ ] The **`/remote on` intent** path surfaces the diagnosed `AttachError` to the user via
      `add_info_message` / an error message (round-tripped through an `AppEvent` if needed), categorized
      and actionable. codex does NOT silently fall back to vanilla on a `/remote on` intent.
- [ ] The `HAPPY_CURRENT_SESSION_ID` idempotency guard (`should_skip_attach`, attach.rs:132) is intact.
- [ ] Any upstream-canonical edit (slash_dispatch.rs / app_event.rs / event_dispatch.rs) carries a
      `// SANDBOX PATCH:` marker + a `patch-surface.md` row (extending invariant 59) + a rebase-replant
      note.
- [ ] Unit/harness test coverage for the error mapping (codex-happy) and the intent-vs-constructor split
      (`tui/src/app/tests.rs` remote-session toggle harness). `just test -p codex-happy` (+ `-p codex-tui`
      if TUI changed) passes; `cargo check --workspace` passes; `just fmt` clean.
**Dependencies:** None (foundational error plumbing; US-003/US-004 report through it)
**Estimated complexity:** medium

## US-003: Wire `onboard.rs` device flow into `/remote on` (self-onboard when creds absent)
**Description:** As a brand-new user with no `~/.happy`, I want `/remote on` to mint codex's own Happy
credentials via the GitHub device flow (showing me the user code + URL and opening my browser), so I never
have to run happy-cli to onboard.
**Acceptance Criteria:**
- [ ] A new overlay module (e.g. `codex/codex-rs-overlay/codex-happy/src/remote_on.rs`) orchestrates the
      device flow: `request_device_code` → surface `user_code` + `DeviceCode::display_uri()` to the user
      and best-effort `webbrowser::open(...)` (text-only fallback on error) → `poll_for_token` →
      `complete_onboard_with_token`. The poll runs on a background task (it can take minutes) and reports
      progress/outcome back to the TUI via an `AppEvent` (the `SlashCommand::Diff` → `AppEvent::DiffResult`
      pattern, slash_dispatch.rs:393-417).
- [ ] The `/remote on` "on" arm in `tui/src/chatwidget/slash_dispatch.rs:720-751` calls the onboard
      driver when `credentials_ready()` is false (replacing the static "run `happy` once" hint) on a
      background task; on success it sends the EXISTING `AppEvent::SetRemoteSession{enabled:true}` to
      attach (single attach path, no duplicate — Q2 decision); on failure surfaces a diagnosed error
      (US-002). A new `AppEvent` variant is added only if surfacing cannot be done via `add_info_message`.
- [ ] On success, `access.key` (0o600 secure-create, US-001), `profile.json`, and a seeded `machineId`
      in `settings.json` exist — verified by a hermetic test using the parameterized `github_base_url` in
      `onboard.rs` AND a temp `HAPPY_HOME_DIR` fixture (never the developer's real `~/.happy`); no live
      GitHub call.
- [ ] The driver entrypoint is exported via `codex-happy/src/lib.rs`. Upstream-canonical edits carry
      `// SANDBOX PATCH:` markers + patch-surface rows + rebase-replant notes.
- [ ] `just test -p codex-happy` (+ `-p codex-tui` if TUI changed) passes; `cargo check --workspace`
      passes; `just fmt` clean.
**Dependencies:** US-002 (failure path reports the diagnosed error)
**Estimated complexity:** medium

## US-004: Server-agnostic codex-owned daemon-lifecycle supervisor
**Description:** As a user running `/remote on`, I want codex to start and supervise the per-machine
session daemon itself (so I never manually run a daemon), behind an abstraction that the Phase-2 embedded
Rust server can later replace with no caller changes.
**Acceptance Criteria:**
- [ ] A new overlay module (e.g. `codex/codex-rs-overlay/codex-happy/src/daemon_supervisor.rs`) defines a
      server-agnostic trait (e.g. `SessionPlaneSupervisor { ensure_running() -> Result<MachineState,
      SupervisorError>; health(); stop(); }`) and a Phase-1 `NodeDaemonSupervisor` impl that, when `happy`
      is on PATH, spawns `happy daemon start-sync` (detached, mirroring
      `happy-cli/src/daemon/ensureDaemonRunning.ts:8-38`) and probes readiness by confirming `machine.json`
      with a valid `tunnelPort` AND a TCP probe of `tunnelPort` (the tunnel listener codex attaches to, no
      auth header — auth.rs:84-86). The loopback capability is happy-cli-internal and is NOT required for
      codex readiness (optionally probe `loopbackPort` as a "fully bound" signal only).
- [ ] **Ownership (F-005):** `ensure_running()` is **start-if-absent + health only**. If a daemon is
      ALREADY running, codex attaches to it and NEVER stops/restarts it (it is a shared machine singleton
      serving other happy-cli/mobile sessions). `stop()`/restart apply ONLY to a daemon THIS codex process
      started (tracked ownership) or are deferred to Phase 2. Stopping a foreign daemon is forbidden.
- [ ] The `/remote on` flow calls `ensure_running()` (after onboard) and attaches only once the listener
      is ready; it distinguishes "starting" (wait/retry with a bounded budget, do NOT collapse via the 8s
      `CONNECT_BUDGET`) from "dead/unavailable" (report `NoDaemon` via US-002's diagnosed error).
- [ ] When `happy` is NOT on PATH (truly Node-free machine — no Phase-1 daemon; the embedded Rust daemon
      is Phase 2), the supervisor returns a categorized `NoDaemon` error with an actionable message after a
      successful self-onboard; it does NOT hang or silently fall back. (Plan Q1.) Exercised by a test with
      an injected spawner/PATH-probe fake.
- [ ] The supervisor is the ONLY abstraction callers use — they bind to the trait, not happy-cli
      directly, so a Phase-2 `EmbeddedRustSupervisor` slots in with no caller changes. happy-cli source is
      reference-only and is NOT edited.
- [ ] Unit tests for the readiness-probe, ownership (no-stop-foreign), and PATH-absent/`NoDaemon` paths
      (injectable spawner/probe, mirroring how `attach.rs` defines a local trait for test fakes).
      `just test -p codex-happy` passes; `cargo check --workspace` passes; `just fmt` clean.
**Dependencies:** US-002 (reports `NoDaemon` via the diagnosed error), US-003 (runs after onboard in the
`/remote on` flow)
**Estimated complexity:** medium-large
