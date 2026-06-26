# Research Brief: in-flight cancellation/abort for `/remote on` self-onboard

Target repo for code changes: **codex submodule** at `D:/harness-efforts/codexu/codex`
(wrapper `gim-home/codex` HEAD `5f9dc1105e` / inner `527027282e`). Plan deliverables live in
codexu's `.ralph/jobs/`.

## Lead-member findings (primary, source-verified)

### What already exists (the self-onboard — DO NOT re-plan)
- `codex-rs-overlay/codex-happy/src/remote_on.rs:55-79` — `run_self_onboard()` drives the device
  flow (`request_device_code` -> emit `DeviceCode` -> emit `Progress("Waiting…")` ->
  `poll_for_token` -> `complete_onboard_with_token`). Surfaces notices through the
  `OnboardNoticeSink` trait (`OnboardNotice::{DeviceCode, Progress}`).
- `codex-rs-overlay/codex-happy/src/onboard.rs` — the mechanism:
  - `OnboardError` enum (lines 99-110): `Transport | DeviceFlow | Decode | Io` (no `Cancelled`).
  - `OnboardOutcome` (90-97).
  - `poll_for_token` (172-242): the long-running loop. Its only cancellation point is
    `tokio::time::sleep(Duration::from_secs(poll_interval)).await` (line 240) and the in-flight
    HTTP `send().await` (line 193). `deadline = now + expires_in` (line 181) so an abandoned poll
    self-expires (commonly ~900 s) but is NOT promptly cancellable today.
  - `complete_onboard_with_token` (370-384) writes `access.key` (0o600), `profile.json`,
    `settings.json`.
- `tui/src/chatwidget/slash_dispatch.rs`:
  - `RemoteOnNoticeBridge` (44-72) maps `OnboardNotice` -> `AppEvent::RemoteSessionNotice`
    (device-code text + `open_url`). `// SANDBOX PATCH: remote_session`.
  - `remote_on_flow()` (79-131): `home` resolve -> if `!has_credentials()` `run_self_onboard()` ->
    `NodeDaemonSupervisor::ensure_running()` -> `AppEvent::SetRemoteSession { enabled: true }`.
  - `/remote on` (822-838): `tokio::spawn(remote_on_flow(self.app_event_tx.clone()))`
    — **fire-and-forget; no handle retained.**
  - `/remote off` (839-848): `set_feature_enabled(RemoteSession, false)` + info line +
    `AppEvent::SetRemoteSession { enabled:false }`. **Does NOT touch the spawned task.**
  - **Stale comment (815-821)**: still says `on` "surfaces an onboarding hint and returns without
    attaching (the interactive self-onboard is a separate follow-up story)" — false; the code below
    self-onboards. Cleanup target.
- `docs/implementation/patch-surface.md:897-898` — invariants 59 + 60 document the shipped flow
  (US-009 / US-002/003/004) and their enforcing tests.
- `codex-rs-overlay/codex-happy/src/remote_on_tests.rs:24-81` — the happy-path wiremock device-flow
  test already exists (`run_self_onboard_writes_identity_and_surfaces_device_code`).

### The gap (whole scope)
`tokio::spawn(remote_on_flow(...))` retains no `JoinHandle`/`AbortHandle`/`CancellationToken`, so
`/remote off` cannot cancel an in-flight device-flow poll. Grep for
`CancellationToken|AbortHandle|JoinHandle|.abort()` in `slash_dispatch.rs` found none in this path.

### Precedents
- **Background-task cancel precedent (in-tree):** `tui/src/app.rs:574`
  `thread_event_listener_tasks: HashMap<ThreadId, JoinHandle<()>>` + `app/thread_routing.rs:24,34`
  `handle.abort();`. Proves the fork already stores `JoinHandle`s and aborts them to cancel
  background tasks.
- **Background-task spawn precedent:** `SlashCommand::Diff` (slash_dispatch.rs:495-) — the comment
  at 833 names it as the precedent `remote_on_flow` follows. It is also fire-and-forget (no abort
  needed — short-lived).
- **ChatWidget field anchor:** struct at `chatwidget.rs:526`; existing
  `pub(crate) remote_connection: Option<RemoteConnectionStatus>` (549) is the natural neighbor for a
  new `remote_on_cancel: Option<...>` field.

### Dependency constraints (decisive for the cancel-signal design)
- `tui` crate tokio features (Cargo.toml:104-112): `io-std, macros, process, rt-multi-thread,
  signal, test-util, time` — **NO `sync`**. But `tokio-util = { features=["time"] }` IS present
  (line 128), so `tokio_util::sync::CancellationToken` is usable in the tui crate with no
  Cargo.toml change.
- `codex-happy` deps (Cargo.toml:36): tokio `["time","sync","rt","macros","net"]` — **has `sync`,
  no `tokio-util`.** So `tokio::sync::{watch,Notify,oneshot}` are available to the overlay; a
  `CancellationToken` would need a `tokio-util` dep add (one line + Cargo.lock + `just
  bazel-lock-update`).
- Implication: the TUI cannot construct/name `tokio::sync` channel types (no `sync` feature), and
  the overlay cannot name `CancellationToken` (no tokio-util). The cancel handle should therefore
  be an **overlay-owned opaque type** (built on `tokio::sync::watch`, race-free, dependency-free)
  that the TUI holds and `.cancel()`s. See plan "Approach" for the option matrix.

## Codex Research
[pending — running in background; folded in at finalize, or "Not run" if it fails]

## Copilot Research
Failed: `copilot-exec --read-only` snapshot budget exceeded (tried to copy a 549 MB
`.xwin-cache/...CRT.x64...libcpmtd1.lib` > 512 MB read-only-snapshot limit). Environment artifact
(the build cache lives under the repo), not a plan-content issue. Multi-model coverage is provided
by Phase-4 review instead.

## Consolidated File List
### Files to modify (codex submodule)
- `codex-rs-overlay/codex-happy/src/onboard.rs` — add `OnboardError::Cancelled`; make
  `poll_for_token` honor a cancel signal.
- `codex-rs-overlay/codex-happy/src/remote_on.rs` — thread the cancel signal through
  `run_self_onboard`; define the overlay-owned cancel handle; emit a cancellation notice.
- `codex-rs-overlay/codex-happy/src/remote_on_tests.rs` — add the abort-path hermetic test.
- `external/repos/codex-patched/codex-rs/tui/src/chatwidget.rs` — add the `remote_on_cancel` field.
- `external/repos/codex-patched/codex-rs/tui/src/chatwidget/slash_dispatch.rs` — store the handle on
  `/remote on`; cancel on `/remote off`; map `Cancelled` -> clean notice; fix the stale comment
  (815-821).
- `docs/implementation/patch-surface.md` — new invariant row + §15 rebase-replant note.
### Reference (do not modify)
- `tui/src/app.rs:574`, `tui/src/app/thread_routing.rs:24,34` — JoinHandle/abort precedent.
- `tui/src/app/event_dispatch.rs` — `apply_remote_session_toggle` (the existing off-path detach).
### Test / build commands
- `cargo test -p codex-happy` (overlay unit tests incl. the new abort-path test).
- `cargo test -p codex-invariant-tests --test happy_seam_invariants` (seam markers).
- `cargo test -p codex-tui remote_session_toggle` (existing in-tree TUI test, invariant 59).
- `cargo check --workspace` (~6 min, Phase-5a gate). `cargo build --release` deferred to CI.
- Workspace-parse preflight before spawn: `cd external/repos/codex-patched/codex-rs && cargo
  metadata --no-deps --format-version 1`.
