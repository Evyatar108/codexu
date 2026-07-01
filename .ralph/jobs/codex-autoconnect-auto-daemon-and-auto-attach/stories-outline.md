# Stories outline — `codex-autoconnect-auto-daemon-and-auto-attach`

Decomposition mirrors brainstorm milestones **M-A..M-E**. All work is in the
**codex submodule** (`codex/`): upstream-canonical seams under
`external/repos/codex-patched/codex-rs/`, fork-exclusive files under
`codex-rs-overlay/` and `docs/`. Repo/complexity noted per story. The feature is
default-off experimental, so vanilla codex stays byte-unaffected.

Verify gate for every story (from `external/repos/codex-patched/codex-rs/`):
`cargo check --workspace` (~6 min) + the story's targeted `cargo test -p …`,
then `just fmt` (or rustfmt on changed files). Do NOT run `cargo test
--workspace` or `cargo build --release` locally (CI-only).

---

## M-A · Feature gate `Feature::RemoteAutoAttach`
**Repo:** codex (`codex-rs/features`, `codex/docs`). **Complexity:** Low.
**Depends on:** nothing. **Unblocks:** M-B, M-D.

**Scope:**
- `features/src/lib.rs` — add the `RemoteAutoAttach` enum variant in the
  fork-visibility cluster next to `RemoteSession`/`LoopbackInject` (`:177-182`)
  with a doc comment + `// SANDBOX PATCH:` marker; add its `FeatureSpec` next to
  the `RemoteSession` spec (`:1078-1088`): `key: "remote_auto_attach"`,
  `stage: Stage::Experimental { name: "Remote auto-attach", menu_description,
  announcement }`, `default_enabled: false`.
- `features/src/tests.rs` — add the
  `(Feature::RemoteAutoAttach, "remote_auto_attach", "Remote auto-attach",
  "<menu_description>")` tuple to
  `fork_visibility_features_are_experimental_and_disabled_by_default` (`:233-293`).
- `codex-rs-overlay/codex-invariant-tests/tests/happy_seam_invariants.rs` — add
  `invariant_71_remote_auto_attach_feature_is_experimental_and_default_off`
  (mirror `invariant_55`, `:157-174`).
- `docs/implementation/patch-surface.md` — add the §14 row **71** stub (finalized
  in M-E) and start the §15 replant-note stub.

**Acceptance criteria:**
- `Feature::RemoteAutoAttach.default_enabled() == false`,
  `matches!(stage, Stage::Experimental { .. })`, `key() == "remote_auto_attach"`.
- `cargo test -p codex-features
  fork_visibility_features_are_experimental_and_disabled_by_default` passes with
  the new tuple.
- `cargo test -p codex-invariant-tests --test happy_seam_invariants
  invariant_71_*` passes.
- `is_known_feature_key("remote_auto_attach")` is true (strict config accepts
  `-c features.remote_auto_attach=...`) — no `strict_config.rs` edit needed.

---

## M-B · Auto-attach flow + startup trigger
**Repo:** codex (`codex-rs/tui`). **Complexity:** Medium.
**Depends on:** M-A. **Unblocks:** M-C, M-E.

**Scope:**
- CREATE `tui/src/remote_auto_attach.rs` — `pub(crate) async fn
  auto_attach_flow(tx: AppEventSender)`: a trimmed copy of `remote_on_flow`
  (`slash_dispatch.rs:79-146`) that (1) resolves `happy_home_dir()` (silent
  return if absent); (2) if `!has_credentials()` emits ONE passive
  `RemoteSessionNotice { level: Info }` "Run `/remote on`" hint and returns
  (**Q2 exception — no error, no device flow**); (3) `NodeDaemonSupervisor::
  with_os_host(home).ensure_running()`, emitting a **loud**
  `RemoteSessionNotice { level: Error }` on `Err` (**Q2**); (4)
  `tx.send(AppEvent::SetRemoteSession { enabled: true })`. Header `// SANDBOX
  PATCH: remote_auto_attach`. Self-contained (constructs its own notices; does
  not depend on the private `remote_on_error`).
- MODIFY `tui/src/lib.rs` — add `mod remote_auto_attach;` (marker'd) in the
  module list (`:89-206`).
- MODIFY `tui/src/app.rs` — after the `happy_tap` gate (~`:1048`), **before** the
  `let mut app = Self { … }` struct literal (~`:1050`, which moves `app_event_tx`
  at `:1052`), add the marker'd trigger:
  `if config.features.enabled(Feature::RemoteAutoAttach) { tokio::spawn(
  crate::remote_auto_attach::auto_attach_flow(app_event_tx.clone())); }`. Leave
  the `Feature::RemoteSession` gate (`:1034-1048`) untouched.
- `codex-rs-overlay/codex-invariant-tests/tests/happy_seam_invariants.rs` — add
  `invariant_72_auto_attach_startup_seam_carries_markers` (mirror `invariant_60`,
  `:295-339`): add a `REMOTE_AUTO_ATTACH_RS` `include_str!` const; assert
  `APP_RS` contains `config.features.enabled(Feature::RemoteAutoAttach)` +
  `auto_attach_flow`; assert the module contains `has_credentials`,
  `ensure_running`, `AppEvent::SetRemoteSession`, the
  `RemoteSessionNoticeLevel::Info` passive branch, and a `// SANDBOX PATCH:
  remote_auto_attach` marker.

**Acceptance criteria:**
- Feature **off** (default): `app.rs` runs byte-identically to today; the only
  new branch is the false guard. `cargo check --workspace` green.
- Feature **on**, creds present, daemon reachable/started: fresh `codex` TUI
  reaches `AppEvent::SetRemoteSession { enabled: true }` with nothing typed, via
  the single attach path. (Verified structurally by `invariant_72` + the flow's
  reuse of `ensure_running` + `SetRemoteSession`.)
- Trigger is non-blocking (`tokio::spawn` + `app_event_tx.clone()`); compiles
  (proves the pre-move placement).
- `HAPPY_CURRENT_SESSION_ID`-owned (double-wrap) sessions no-op (inherited via
  `should_skip_attach`).
- `cargo test -p codex-invariant-tests --test happy_seam_invariants
  invariant_72_*` passes; `cargo check --workspace` green.

---

## M-C · Status coherence (Q1) + per-session opt-out confirmation
**Repo:** codex (`codex-rs/tui`). **Complexity:** Low-Medium.
**Depends on:** M-B. **Unblocks:** M-E.

**Scope:**
- MODIFY `tui/src/app/event_dispatch.rs` — in `apply_remote_session_toggle`
  (`:52-84`), at the top of the `if enabled {` branch (before the
  `happy_tap.is_none()` check), add
  `self.chat_widget.set_feature_enabled(Feature::RemoteSession, true);` with a
  `// SANDBOX PATCH: remote_auto_attach` marker. Confirm `Feature` is in scope
  (via `use super::*`) or add the import. Do NOT modify the disable branch.
- MODIFY `tui/src/app/tests.rs` — extend
  `remote_session_toggle_attaches_then_detaches_without_killing_session`
  (`:4241`) (or add a sibling test): after
  `apply_remote_session_toggle(&app_server, /*enabled*/ true)`, assert
  `app.chat_widget.config_ref().features.enabled(Feature::RemoteSession)` is
  `true`.
- `codex-rs-overlay/codex-invariant-tests/tests/happy_seam_invariants.rs` — add
  `invariant_73_auto_attach_status_coherence`: assert `EVENT_DISPATCH_RS`
  contains `set_feature_enabled(Feature::RemoteSession` under a `// SANDBOX
  PATCH: remote_auto_attach` marker.
- Confirm (no code change) `/remote off` remains the per-session opt-out (drops
  `happy_tap` via the disable branch; `slash_dispatch.rs:866-879`).

**Acceptance criteria:**
- After `apply_remote_session_toggle(enabled=true)` (auto OR manual), the
  ChatWidget reports `Feature::RemoteSession` enabled ⇒ bare `/remote` says "on".
  The extended `tui/src/app/tests.rs` test asserts this.
- The Q1 flip is idempotent for the manual `/remote on` path (which already
  flips it) and does not alter `/remote off` semantics.
- `cargo test -p codex-tui remote_session_toggle` passes; `cargo test -p
  codex-invariant-tests --test happy_seam_invariants invariant_73_*` passes.

---

## M-D · Launcher set-once flag `enable_remote_auto_attach`
**Repo:** codex (`codex-rs-overlay/codex-copilot-launcher` — zero upstream
surface). **Complexity:** Low. **Depends on:** M-A. **Parallel to:** M-B/M-C.

**Scope:** mirror `enable_remote_session` exactly in
`codex-rs-overlay/codex-copilot-launcher/src/config.rs`:
- Add `enable_remote_auto_attach: Option<bool>` to `SandboxConfig` (`:3-9`),
  the `defaults` literal (`:60-66`), and read it in `parse_sandbox_config`
  (`:73-89`) via `table.get("enable_remote_auto_attach").and_then(|v|
  v.as_bool())`.
- In `provider_config_flags` (`:91-144`), push `features.remote_auto_attach=true`
  **only when `== Some(true)`**, placed **before** the `additional_instructions`
  / `project_doc_fallback_filenames` block (preserve the `flags.last() ==
  project_doc_fallback_filenames` invariant). Never force-emit.
- Extend the `load_config` doc comment (`:29-36`) describing the new key.
- Add tests mirroring the remote_session ones:
  `provider_flags_emit_remote_auto_attach_only_when_opted_in`,
  `parse_reads_enable_remote_auto_attach`, and a
  `project_doc_fallback_stays_last_with_remote_auto_attach_enabled` check; update
  every existing `SandboxConfig { … }` test literal to add
  `enable_remote_auto_attach: None`.

**Acceptance criteria:**
- `enable_remote_auto_attach = true` ⇒ flags contain
  `features.remote_auto_attach=true`; unset/`false` ⇒ no `features.remote_auto_attach*`
  flag emitted.
- The emitted flag never displaces the trailing
  `project_doc_fallback_filenames=["CLAUDE.md"]` flag.
- `parse_sandbox_config("enable_remote_auto_attach = true")` reads `Some(true)`;
  empty string reads `None`.
- `cargo test -p codex-copilot-launcher` passes (all fixtures updated).

---

## M-E · Patch-surface + audit closeout
**Repo:** codex (`codex/docs`, plus final `cargo check --workspace`).
**Complexity:** Low. **Depends on:** M-B, M-C, M-D.

**Scope:**
- `docs/implementation/patch-surface.md` — finalize §14 rows **71** (feature
  experimental+default-off), **72** (startup trigger + `auto_attach_flow` module
  + `lib.rs` mod line, reuse of `ensure_running` + `SetRemoteSession`, Q2
  passive/loud behavior), **73** (Q1 status coherence flip in
  `apply_remote_session_toggle`) — each with invariant text + enforcing test +
  revert recipe, mirroring rows 55/60. Add the §15 **"remote_auto_attach seam
  replant"** note (mirror the loopback_inject note at `:~1138`) enumerating the
  upstream-canonical replant set: `app.rs` trigger, `tui/src/lib.rs` mod line,
  `features/src/lib.rs` enum+spec, `features/src/tests.rs` tuple,
  `event_dispatch.rs` Q1 flip; note the new module + overlay tests + launcher
  flag carry zero upstream surface.
- `bash scripts/audit_network_calls.sh` — confirm **no new egress site**
  (auto-attach reuses the audited overlay egress files only; invariant 57
  unchanged; no allowlist edit).

**Acceptance criteria:**
- patch-surface.md contains §14 rows 71-73 and the §15 replant note; each new
  invariant maps to its enforcing test.
- `scripts/audit_network_calls.sh` passes with no new egress destination.
- Final `cargo check --workspace` green; targeted `cargo test -p codex-features
  / -p codex-tui / -p codex-invariant-tests / -p codex-copilot-launcher` all
  green; `just fmt` clean on changed files.

---

## Notes for the implementing member

- **Two-commit submodule flow:** commit the `codex-rs/...` + `codex-rs-overlay/...`
  + `docs/...` edits **inside the codex-patched submodule** first (topic branch,
  worktree inside the submodule), then bump the `codex/` wrapper gitlink in a
  second commit. The lead FF-merges + pushes.
- **Do NOT touch any `CLAUDE.md`** (gitignored / read-only context).
- **Local iteration = `cargo check`**, not full builds/tests. Source
  `scripts/iteration-env.sh`; do not drift the frozen LTO/RUSTFLAGS profile.
- Re-`grep` every cited line number before editing — they may drift from this
  plan's 2026-07-01 read.
- Every upstream-canonical edited line needs a `// SANDBOX PATCH:
  remote_auto_attach` marker (the overlay invariant tests assert their presence).
