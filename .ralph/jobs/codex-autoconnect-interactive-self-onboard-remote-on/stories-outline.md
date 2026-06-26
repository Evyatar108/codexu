# Stories Outline: In-flight cancellation/abort for the `/remote on` self-onboard device-flow poll

*Preliminary decomposition from `/plan-with-ralph`. Feed to `/implement-with-ralph --from-plan` for PRD generation.*

> **Target repo:** the **codex submodule** at `D:/harness-efforts/codexu/codex/` (a codex-submodule
> worktree). All paths below are relative to that submodule root. The Rust workspace for
> `cargo`/`just` is `codex/external/repos/codex-patched/codex-rs`. Gate stays behind the existing
> `Feature::RemoteSession`; no new feature flag; no new runtime dependency. Every new
> upstream-canonical seam/block gets an adjacent `// SANDBOX PATCH: remote_session` marker.

## US-001: Overlay — cooperative cancellation of the self-onboard device-flow poll
**Description:** As a codex user who ran `/remote on` and then changed my mind, I want the in-flight
GitHub device-flow poll to be cancellable, so the background task stops promptly instead of polling
until the device code expires. (This story is overlay-only — `codex-happy` — with zero
upstream-canonical surface, so it lands and tests independently.)
**Acceptance Criteria:**
- [ ] `OnboardError::Cancelled` variant added (with a `Display` arm).
- [ ] An overlay-owned cancel handle pair `OnboardCancel` / `OnboardCancelListener` (built on
      `tokio::sync::watch`, available to codex-happy) in `remote_on.rs`: `OnboardCancel::new() ->
      (Self, OnboardCancelListener)`, `cancel(&self)` via `watch::Sender::send(true)`; the listener
      exposes `is_cancelled()` (`*rx.borrow()`) and an async `cancelled()` that returns on
      `send(true)` **and** on sender-drop.
- [ ] `poll_for_token` honors the listener using the **minimal shape** — a top-of-loop
      `if listener.is_cancelled() { return Err(OnboardError::Cancelled); }` plus a `tokio::select!`
      wrapping **only** the `tokio::time::sleep(...)` await — leaving every existing
      slow_down/authorization_pending/access_denied/expired_token/deadline branch unchanged. (Do NOT
      wrap the whole iteration body in an inner `async {}` — the early `return`s would break.)
- [ ] `run_self_onboard` accepts an owned `OnboardCancelListener`, threads it into `poll_for_token`,
      `is_cancelled()`-checks before the daemon/attach steps, emits a cancellation
      `OnboardNotice` through the sink on cancel, and returns `Err(OnboardError::Cancelled)`.
- [ ] Abort-path test in `remote_on_tests.rs`: wiremock GitHub returns `authorization_pending`
      indefinitely (small `interval`); after the `DeviceCode` notice is observed, `cancel()` the
      handle; assert — within `tokio::time::timeout(Duration::from_secs(2), join)` — that the call
      returns `Err(OnboardError::Cancelled)`, surfaces the cancellation notice, and writes no
      `access.key`/`profile.json`.
- [ ] Re-entry test: dropping/replacing the `OnboardCancel` sender (or a second `cancel()`) makes an
      in-flight `run_self_onboard` return `Err(OnboardError::Cancelled)`.
- [ ] `cargo test -p codex-happy` passes (incl. the existing happy-path test); `just fmt` /
      `just fix -p codex-happy` clean (run from `codex/external/repos/codex-patched/codex-rs`).
- [ ] Typecheck passes (`cargo check -p codex-happy`).
**Dependencies:** None
**Estimated complexity:** small

## US-002: TUI wiring, lifecycle, notice mapping, stale-comment cleanup, invariant test + docs
**Description:** As a codex user, I want `/remote off` (and session/thread switches) to actually stop
an in-flight `/remote on` onboard, with a clear "cancelled" message, so the toggle behaves correctly
mid-onboard. (This story wires US-001's overlay API into the TUI and documents/guards the seam.)
**Acceptance Criteria:**
- [ ] `ChatWidget` gains `remote_on_cancel: Option<codex_happy::remote_on::OnboardCancel>` (init
      `None` in every constructor). `// SANDBOX PATCH: remote_session`.
- [ ] `/remote on` in `slash_dispatch.rs` `.cancel()`s any existing stored handle, then creates a
      fresh `OnboardCancel`, stores it on `self.remote_on_cancel`, and passes the listener into
      `remote_on_flow(tx, listener)`.
- [ ] `remote_on_flow` threads the listener into `run_self_onboard` and maps
      `Err(OnboardError::Cancelled)` to a clean info `RemoteSessionNotice` (not a diagnosed
      `remote_on_error`).
- [ ] `/remote off` calls `self.remote_on_cancel.take()`-and-`.cancel()` in addition to the existing
      `set_feature_enabled(false)` + `SetRemoteSession { enabled: false }` detach.
- [ ] `App::replace_chat_widget` (`tui/src/app/session_lifecycle.rs`, beside the
      `remote_connection` transfer at ~line 336) transfers `remote_on_cancel` to the replacement
      widget so an in-flight onboard stays cancellable across thread-switch/resume/fork. SANDBOX PATCH.
- [ ] The stale comment at `slash_dispatch.rs:815-821` is corrected to state that `/remote on`
      self-onboards and is now cancellable.
- [ ] `codex-rs-overlay/codex-invariant-tests/tests/happy_seam_invariants.rs` gains an
      `invariant_61_*` test asserting the new cancel seam (the `remote_on_cancel` field in
      chatwidget.rs + the `.cancel()` call in slash_dispatch.rs + the marker), mirroring
      `invariant_59`/`invariant_60`.
- [ ] `docs/implementation/patch-surface.md` gains a new invariant row (id **61**) + a §15
      rebase-replant note naming the enforcing tests.
- [ ] `cargo test -p codex-invariant-tests --test happy_seam_invariants` and
      `cargo test -p codex-tui remote_session_toggle` pass; `cargo check --workspace` passes (run from
      `codex/external/repos/codex-patched/codex-rs`); `just fmt` / `just fix -p codex-tui` clean.
- [ ] Every new upstream-canonical seam/block carries an adjacent `// SANDBOX PATCH: remote_session`
      marker.
- [ ] Typecheck passes.
**Dependencies:** US-001
**Estimated complexity:** small
