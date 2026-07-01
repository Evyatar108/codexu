# Plan — `codex-autoconnect-auto-daemon-and-auto-attach`

> Make a fresh `codex` TUI appear in the Happy app with **zero per-session
> friction** — no `/remote on` typed — by adding a new default-off experimental
> `Feature::RemoteAutoAttach` whose startup trigger reuses the already-shipped
> `/remote on` machinery (daemon `ensure_running` → `AppEvent::SetRemoteSession`)
> **minus the interactive onboard**. Builds directly on brainstorm **D-001**
> (`.ralph/brainstorms/codex-autoconnect-auto-daemon-and-auto-attach/selected-direction.md`).

**Worktree / repo:** this is a **codex submodule** change. All source edits land
inside `codex/` — specifically `external/repos/codex-patched/codex-rs/` (a few
small upstream-canonical seams) plus fork-exclusive files in
`codex-rs-overlay/` and `docs/`. The two-commit submodule flow applies: commit
inside the `codex-patched` submodule first (the `codex-rs/...` edits), then bump
the `codex/` wrapper gitlink; the codexu parent records only the resulting
`codex` pointer bump. **Do NOT edit any `CLAUDE.md`** (gitignored in codexu; the
codex `CLAUDE.md` is read-only context here).

---

## 1 · Overview & goal

Groundwork (north-star **M0**, shipped under
`codex-raw-session-happy-daemon-autoconnect`) already gives a native Rust Happy
client (`codex-happy` overlay) that tees every in-process `AppServerEvent` to a
Happy session and drives the live turn from mobile, gated behind the default-off
experimental `Feature::RemoteSession`. **The only remaining friction is that the
user must type `/remote on` every session.**

This wedge fires the same two effects `/remote on` fires — **(a) ensure the
per-machine daemon is running, (b) attach** — **automatically at TUI startup**,
behind a new default-off experimental gate, and replaces `/remote on`'s
interactive device-flow onboard with a **passive one-line hint** when creds are
absent. Nothing in the attach/daemon/inbound stack changes: auto-attach becomes
*the default that fires the same intent the user used to type*. The manual
`/remote on` and `/remote off` paths are untouched and coexist.

```
 fresh `codex` (TUI)  ──►  App::run  (tui/src/app.rs, async constructor)
        │
        ▼  compute happy_tap (existing RemoteSession gate, UNCHANGED)  ~app.rs:1034
        ▼  NEW sibling: if features.enabled(RemoteAutoAttach) { tokio::spawn(auto_attach_flow(tx)) }
        │
        ▼  auto_attach_flow (trimmed remote_on_flow):
   has_credentials()? ── no ──►  ONE passive Info notice: "Run /remote on to connect"  (NOT an error — Q2 exception)
        │ yes
        ▼  NodeDaemonSupervisor::with_os_host(home).ensure_running()   (start-if-absent; LOUD on failure — Q2)
        ▼  AppEvent::SetRemoteSession { enabled: true }
        │
        ▼  apply_remote_session_toggle  (event_dispatch.rs)
             • flips Feature::RemoteSession = true   ← NEW (Q1 status coherence)
             • maybe_attach_reporting (LOUD attach failures — Q2, reused)
   codex session now mirrored + remote-controllable in Happy.  Per-session opt-out: /remote off
```

### Operator decisions baked in (do NOT re-open)

- **Q1 — status coherence:** the auto path **also flips `Feature::RemoteSession =
  true`** so `/remote` status is coherent. `apply_remote_session_toggle` does not
  flip it today; this plan makes the shared enable path set it (§4, M-C).
- **Q2 — LOUD failures:** genuine failures (`NoDaemon`/`StartFailed` from
  `ensure_running`; `SessionCreateFailed`/`ConnectFailed` from attach) surface in
  the TUI via `RemoteSessionNotice` errors / the reused `maybe_attach_reporting`.
  **Exception:** the `NoCredentials` (never-onboarded) case falls back to the
  **passive onboarding hint** (`Info`), NOT a loud error.
- **Scope:** top-level interactive TUI sessions only. v1/v2 sub-agent sessions
  are **out of scope / deferred** (see §6). Attach is already TUI-only, so the
  trigger's placement in `App::run` inherently scopes it correctly.

---

## 2 · Research findings (verified file:line, read-only, 2026-07-01)

All paths below are under
`codex/external/repos/codex-patched/codex-rs/` unless they say `codex-rs-overlay/`
(fork-exclusive) or `codex/docs/`. Line numbers verified this session; they may
drift on rebase — re-`grep` before editing (CLAUDE.md tenet #2).

### 2.1 The startup attach seam (upstream-canonical; the one required TUI edit)
- `tui/src/app.rs:597` — `happy_tap: Option<mpsc::UnboundedSender<AppServerEvent>>`
  struct field (invariant 54).
- `tui/src/app.rs:793-794` — `let (app_event_tx, mut app_event_rx) = unbounded_channel();`
  … `app_event_tx = AppEventSender::new(app_event_tx);` — **`app_event_tx` is in
  scope** throughout `App::run`.
- `tui/src/app.rs:1028-1048` — the existing `happy_tap` gate; the feature check
  `if config.features.enabled(Feature::RemoteSession)` is at **:1034**, the
  `codex_happy::attach::maybe_attach(` call at **:1038**. This gate stays exactly
  as-is (invariant 54/56 depend on the literal `maybe_attach` string + marker).
- `tui/src/app.rs:~1050` — `let mut app = Self { … }`; the field `app_event_tx,`
  is **moved into the struct at :1052**. ⇒ the new trigger must run **before**
  the struct literal and use `app_event_tx.clone()`.
- `tui/src/app.rs:1243` — the outbound tee (`if let Some(tap) = app.happy_tap…`)
  (invariant 54). Unchanged.
- `Feature` is already imported in `app.rs` (used at :1034), so
  `Feature::RemoteAutoAttach` needs no new import.

### 2.2 `remote_on_flow` — the exact sequence to trim-copy
- `tui/src/chatwidget/slash_dispatch.rs:79-146` — `remote_on_flow(tx, cancel)`:
  1. `happy_home_dir()` → else diagnosed error (`:84-92`);
  2. `if !has_credentials()` → `run_self_onboard(...)` interactive device flow
     (`:94-131`) ← **this is the block we replace with a passive Info hint**;
  3. `NodeDaemonSupervisor::with_os_host(home).ensure_running()` → on `Err`,
     diagnosed `remote_on_error` (`:134-141`);
  4. `tx.send(AppEvent::SetRemoteSession { enabled: true })` (`:145`).
- `tui/src/chatwidget/slash_dispatch.rs:148-155` — `remote_on_error(text, hint)`
  builds a `RemoteSessionNotice { level: Error }` AppEvent (reusable helper — but
  it is **private to `slash_dispatch.rs`**; see placement decision §3).
- `tui/src/chatwidget/slash_dispatch.rs:830-882` — the `/remote on|off` handler:
  `on` calls `self.set_feature_enabled(Feature::RemoteSession, true)` (**:841**),
  then `tokio::spawn(remote_on_flow(...))` (**:863**); `off` calls
  `set_feature_enabled(..., false)` (**:866**) then sends
  `SetRemoteSession { enabled: false }` (**:879**). Confirms: **the manual path
  already flips the feature flag itself, before/around the shared attach path.**
- `tui/src/chatwidget/slash_dispatch.rs:499-509` — bare `/remote` status reads
  `self.config.features.enabled(Feature::RemoteSession)` **on the ChatWidget**.
  ⇒ status coherence (Q1) requires flipping the **ChatWidget's** `config.features`.
- `slash_dispatch.rs` is **1323 LoC** — already over the AGENTS.md ~800-LoC
  "avoid large modules" guidance (relevant to the placement decision §3).

### 2.3 `apply_remote_session_toggle` — the shared attach handler (Q1 + Q2 site)
- `tui/src/app/event_dispatch.rs:16-33` — `remote_session_error_hint(&AttachError)`.
- `tui/src/app/event_dispatch.rs:52-84` — `App::apply_remote_session_toggle(&mut
  self, app_server, enabled)`: on `enabled && happy_tap.is_none()`, attaches via
  `codex_happy::attach::maybe_attach_reporting(...)` (**:72**) with an outcome
  sink that emits `RemoteSessionNotice { level: Error }` on `AttachError`
  (**LOUD** — this is why the auto path gets loud attach failures for free); on
  disable, `self.happy_tap = None`. **It does NOT flip `Feature::RemoteSession`
  today** — the Q1 gap.
- `tui/src/app/event_dispatch.rs:119` — `AppEvent::SetRemoteSession { enabled }`
  arm dispatches to `apply_remote_session_toggle`.
- `App` owns a `chat_widget` field (struct literal in `app.rs`), so
  `event_dispatch.rs` can call `self.chat_widget.set_feature_enabled(...)`.

### 2.4 Feature registration convention to mirror
- `features/src/lib.rs:177` — `RemoteSession` enum variant (fork-visibility
  cluster); `:182` — `LoopbackInject` (its sibling).
- `features/src/lib.rs:1078-1088` — `Feature::RemoteSession` `FeatureSpec`:
  `key: "remote_session"`, `stage: Stage::Experimental { name, menu_description,
  announcement }`, `default_enabled: false`.
- `features/src/lib.rs:1091-1101` — `Feature::LoopbackInject` `FeatureSpec`
  (the second precedent).
- `features/src/tests.rs:233-293` —
  `fork_visibility_features_are_experimental_and_disabled_by_default`: an array
  of `(Feature, key, menu_name, menu_description)` tuples (RemoteSession tuple at
  **:261-266**, LoopbackInject at **:268-272**) looped over asserting
  `feature_for_key`, `default_enabled()==false`, and the experimental menu
  strings. Extend the array with the new tuple.

### 2.5 Daemon supervisor + attach primitives (overlay, reused as-is — zero edits)
- `codex-rs-overlay/codex-happy/src/daemon_supervisor.rs:92` —
  `trait SessionPlaneSupervisor`; `:126` `struct NodeDaemonSupervisor`;
  `:136` `with_os_host(home)`; `:163` `ensure_running` (**start-if-absent +
  health-probe only; never stops/restarts a foreign daemon — F-005**);
  `:256` `spawn_happy_daemon` launches `happy daemon start-sync` **detached**
  (`Stdio::null` on all three fds), so the daemon **outlives codex** — "resident,
  not per-session, not a boot service" with zero new lifecycle code.
  `SupervisorError::{NoDaemon, StartFailed}` at `:46-53`.
- `codex-rs-overlay/codex-happy/src/attach.rs:113-127` — `enum AttachError {
  NoCredentials, NoDaemon, SessionCreateFailed(String), ConnectFailed(String) }`
  — **there is NO `SessionConflict` variant** (confirms the brainstorm; any true
  same-identity conflict belongs to the sibling
  `codex-daemon-same-identity-reattach` task).
- `codex-rs-overlay/codex-happy/src/attach.rs` — `maybe_attach` (`:168`, silent,
  used by the constructor), `maybe_attach_reporting` (`:183`, loud, used by
  intent), both funnel through `maybe_attach_inner` (`:189`) → **exactly one
  attach path**; `should_skip_attach` (`:199-204`) short-circuits when
  `HAPPY_CURRENT_SESSION_ID` is set (double-wrap protection, inherited free);
  `has_credentials()` (creds-only gate, matches `remote_on_flow`) around `:217`;
  `credentials_ready()` (creds AND machine) around `:205`; `session_tag()` mints
  a **fresh `Uuid` per attach** (~`:746`) ⇒ N concurrent auto-attached sessions
  cannot collide.

### 2.6 Invariant-test pattern to mirror
- `codex-rs-overlay/codex-invariant-tests/tests/happy_seam_invariants.rs` —
  `include_str!` file consts (`APP_RS`, `SLASH_DISPATCH_RS`, `EVENT_DISPATCH_RS`,
  `APP_EVENT_RS`, …, `:37-60`); structural marker/ordering assertions.
  `invariant_55` (`:157-174`, feature experimental+default-off) and `invariant_60`
  (`:295-339`, the self-onboard/daemon/loud-attach seam) are the two to mirror.
  Existing in-tree toggle test:
  `tui/src/app/tests.rs:4241` `remote_session_toggle_attaches_then_detaches_without_killing_session`
  (uses `make_test_app()`), extendable for the Q1 coherence assertion.

### 2.7 Launcher set-once flag (overlay crate — zero upstream surface)
- `codex-rs-overlay/codex-copilot-launcher/src/config.rs:3-9` — `struct
  SandboxConfig` (`enable_remote_session: Option<bool>` at **:8**);
  `:59-89` `parse_sandbox_config` (reads `enable_remote_session` at **:81**);
  `:91-144` `provider_config_flags` — emits `features.remote_session=true`
  **only when opted in** (`:129-131`), **never force-emitted**, and **before**
  the `additional_instructions`/`project_doc_fallback_filenames` block to
  preserve the `flags.last() == project_doc_fallback_filenames` invariant.
  Tests at `:155+` (`provider_flags_emit_remote_session_only_when_opted_in`,
  `parse_reads_enable_remote_session`, `project_doc_fallback_stays_last_...`).
- `codex/docs/implementation/patch-surface.md` — §14 table (`:813`), remote_session
  rows 54-62 (`:900-908`); §15 replant notes (`:931+`), the loopback_inject
  replant note (`:~1138`) is the structural template for the new note. **Highest
  existing invariant row = 70** ⇒ new rows are **71, 72, 73**.

---

## 3 · Placement decision (CLAUDE.md core tenet #1)

The flow function (`auto_attach_flow`) constructs `AppEvent::SetRemoteSession`
and `RemoteSessionNotice` / `RemoteSessionNoticeLevel`, which are **`pub(crate)`
tui-internal types** — so it **cannot** live in an overlay crate (tenet option 1
is impossible). Between the remaining options:

- **Chosen — tenet option 2: a NEW module `tui/src/remote_auto_attach.rs`**
  containing `auto_attach_flow`, declared with one `// SANDBOX PATCH:
  remote_auto_attach` line in `tui/src/lib.rs` (module list at `:89-206`), and
  called from the `app.rs` trigger. A brand-new fork-authored file has **zero
  merge-conflict surface** on rebase (upstream never touches it); only the tiny
  `app.rs` trigger, the one-line `mod` declaration, the feature enum+spec, the
  fork-visibility tuple, and the `apply_remote_session_toggle` flip are
  upstream-canonical conflict candidates. This also respects the AGENTS.md
  "avoid large modules / don't grow high-touch files" rule — `slash_dispatch.rs`
  is already 1323 LoC.
- **Rejected — colocate `auto_attach_flow` in `slash_dispatch.rs`** beside
  `remote_on_flow` (would let it reuse the private `remote_on_error`). Simpler
  reuse, but it grows an already-oversized high-touch upstream file and is an
  *inline* edit to upstream-canonical code (tenet option 3) rather than a new
  file (option 2). Net-worse rebase posture.

Consequence of the new module being self-contained: it constructs its own
`RemoteSessionNotice` error/info AppEvents inline (≈4 lines each) instead of
calling the private `remote_on_error`. No cross-module `pub(crate)` widening
needed.

**Edit-budget estimate & re-conflict probability (upstream-canonical only):**
- `app.rs` trigger: ~5 lines, marker'd. Re-conflict: **low** (isolated block
  immediately after the stable `happy_tap` gate; no upstream churn expected).
- `tui/src/lib.rs` `mod` line: 1 line. Re-conflict: **low** (module list is
  append-friendly; occasional reorder churn).
- `features/src/lib.rs` enum variant + `FeatureSpec`: ~10 lines across two
  known sites. Re-conflict: **low-medium** (fork-visibility cluster already a
  known replant zone; mirrors RemoteSession/LoopbackInject).
- `features/src/tests.rs` tuple: ~6 lines. Re-conflict: **low**.
- `event_dispatch.rs` Q1 flip: ~2 lines inside the existing fork-authored
  `apply_remote_session_toggle`. Re-conflict: **low** (function is fork-authored).
- Overlay (`codex-happy`, `codex-invariant-tests`, `codex-copilot-launcher`) and
  `docs/`: **zero** upstream-canonical surface.

Total new upstream-canonical surface ≈ **24 lines across 5 files** — well under
the 800-line change guidance, and small enough that the whole change is one
reviewable stage.

---

## 4 · Exact files to create / modify

### CREATE
1. **`codex/external/repos/codex-patched/codex-rs/tui/src/remote_auto_attach.rs`**
   (new upstream-canonical file, but fork-authored ⇒ zero conflict surface).
   Contents: `pub(crate) async fn auto_attach_flow(tx: AppEventSender)`, a trimmed
   copy of `remote_on_flow` (§2.2), header-commented `// SANDBOX PATCH:
   remote_auto_attach`:
   ```
   use crate::app_event::{AppEvent, RemoteSessionNoticeLevel};
   use crate::app_event_sender::AppEventSender;
   use codex_happy::daemon_supervisor::SessionPlaneSupervisor as _;

   pub(crate) async fn auto_attach_flow(tx: AppEventSender) {
       let Some(home) = codex_happy::auth::happy_home_dir() else { return }; // silent: no ~/.happy

       // Q2 exception: creds absent → passive onboarding hint, NOT a loud error.
       if !codex_happy::attach::has_credentials() {
           tx.send(AppEvent::RemoteSessionNotice {
               text: "Codex can mirror this session to the Happy app.".to_string(),
               hint: Some("Run `/remote on` once to connect this machine.".to_string()),
               level: RemoteSessionNoticeLevel::Info,
               open_url: None,
           });
           return;
       }

       // Daemon: start-if-absent. Q2: LOUD on failure.
       let supervisor =
           codex_happy::daemon_supervisor::NodeDaemonSupervisor::with_os_host(home);
       if let Err(err) = supervisor.ensure_running().await {
           tx.send(AppEvent::RemoteSessionNotice {
               text: format!("Happy auto-attach could not start: {err}."),
               hint: Some(
                   "Install happy-cli (the per-machine session server), or run `/remote on`."
                       .to_string(),
               ),
               level: RemoteSessionNoticeLevel::Error,
               open_url: None,
           });
           return;
       }

       // Attach via the ONE existing path (loud attach failures via
       // maybe_attach_reporting inside apply_remote_session_toggle).
       tx.send(AppEvent::SetRemoteSession { enabled: true });
   }
   ```
   (Exact `AppEventSender::send` signature + notice field names must be
   confirmed against `app_event.rs:214,223` and `app_event_sender.rs` at impl
   time — verified to match this session's reads.)

### MODIFY (upstream-canonical — each edited line carries `// SANDBOX PATCH: remote_auto_attach`)
2. **`tui/src/lib.rs`** (`:89-206` module list) — add `mod remote_auto_attach;`
   with a `// SANDBOX PATCH: remote_auto_attach` marker.
3. **`tui/src/app.rs`** — immediately after the `happy_tap` gate (after ~`:1048`,
   before the `let mut app = Self {` struct literal at ~`:1050`), add:
   ```
   // SANDBOX PATCH: remote_auto_attach — fire the same intent `/remote on`
   // fires, automatically, when the auto-attach feature is enabled. Non-blocking.
   if config.features.enabled(Feature::RemoteAutoAttach) {
       tokio::spawn(crate::remote_auto_attach::auto_attach_flow(app_event_tx.clone()));
   }
   ```
   Leave the existing `Feature::RemoteSession` gate (`:1034-1048`) **untouched**.
4. **`features/src/lib.rs`** — (a) add the `RemoteAutoAttach` enum variant in the
   fork-visibility cluster next to `RemoteSession`/`LoopbackInject` (`:177-182`)
   with a doc comment + `// SANDBOX PATCH:` marker; (b) add its `FeatureSpec`
   next to the `RemoteSession` spec (`:1078-1088`): `key: "remote_auto_attach"`,
   `stage: Stage::Experimental { name: "Remote auto-attach", menu_description:
   "Automatically mirror every Codex session to the Happy mobile app once
   onboarded.", announcement: "Remote auto-attach can now be enabled from
   /experimental. Restart Codex after enabling it." }`, `default_enabled: false`.
5. **`features/src/tests.rs`** — extend the
   `fork_visibility_features_are_experimental_and_disabled_by_default` tuple
   array (`:233-293`) with the `(Feature::RemoteAutoAttach, "remote_auto_attach",
   "Remote auto-attach", "<menu_description>")` tuple.
6. **`tui/src/app/event_dispatch.rs`** — **Q1 status coherence**: in
   `apply_remote_session_toggle` (`:52-84`), at the top of the `if enabled {`
   branch (before the `happy_tap.is_none()` check), add
   `self.chat_widget.set_feature_enabled(Feature::RemoteSession, true);` with a
   `// SANDBOX PATCH: remote_auto_attach` marker (verify `Feature` is in scope via
   `use super::*`; add the import if not). This makes **both** the auto path and
   the manual `/remote on` path (idempotent there) leave `/remote` reporting
   "on". Do **not** touch the disable branch (manual `/remote off` already flips
   the flag false; auto never sends disable).
   **Critical — flip the `chat_widget`'s config, not the App's:** bare `/remote`
   status reads `self.config.features.enabled(Feature::RemoteSession)` **on the
   ChatWidget** (`slash_dispatch.rs:501`), and `set_feature_enabled` mutates that
   same `ChatWidget.config.features` (`settings.rs:70`). `App.config.features` is
   a *separate* copy that `/remote` never reads and no mid-session consumer keys
   off (the tee at `app.rs:1243` gates on `happy_tap`, not the flag) — so flipping
   the ChatWidget's copy is both necessary and sufficient for coherence.

### CREATE / MODIFY (overlay + docs — zero upstream-canonical surface)
7. **`codex-rs-overlay/codex-invariant-tests/tests/happy_seam_invariants.rs`** —
   add three tests (mirror `invariant_55` / `invariant_60`):
   - `invariant_71_remote_auto_attach_feature_is_experimental_and_default_off`
     (assert `Feature::RemoteAutoAttach` default-off + `Stage::Experimental` +
     key `"remote_auto_attach"`).
   - `invariant_72_auto_attach_startup_seam_carries_markers` (assert `APP_RS`
     contains `config.features.enabled(Feature::RemoteAutoAttach)` +
     `auto_attach_flow` + a `// SANDBOX PATCH: remote_auto_attach` marker; add a
     `REMOTE_AUTO_ATTACH_RS` `include_str!` const for the new module and assert it
     contains `has_credentials`, `ensure_running`, `AppEvent::SetRemoteSession`,
     the `RemoteSessionNoticeLevel::Info` passive-hint branch, and a marker).
     **Ordering gotcha:** `include_str!` is resolved at **compile time**, so the
     new `tui/src/remote_auto_attach.rs` file MUST exist before the
     `codex-invariant-tests` crate will compile with the new `REMOTE_AUTO_ATTACH_RS`
     const. Land the module creation and the `invariant_72` const in the same M-B
     commit (create the file first).
   - `invariant_73_auto_attach_status_coherence` (assert `EVENT_DISPATCH_RS`'s
     `apply_remote_session_toggle` contains
     `set_feature_enabled(Feature::RemoteSession` under a marker).
8. **`tui/src/app/tests.rs`** — extend
   `remote_session_toggle_attaches_then_detaches_without_killing_session`
   (`:4241`) or add a sibling: after `apply_remote_session_toggle(&app_server,
   /*enabled*/ true)`, assert
   `app.chat_widget.config_ref().features.enabled(Feature::RemoteSession)` is
   `true` (Q1 coherence; the flip is synchronous so the assert is deterministic).
9. **`codex-rs-overlay/codex-copilot-launcher/src/config.rs`** — **M-D set-once
   flag** (mirror `enable_remote_session` exactly): add
   `enable_remote_auto_attach: Option<bool>` to `SandboxConfig` (`:3-9`); read it
   in `parse_sandbox_config` (`:73-89`) and the `defaults` literal (`:60-66`);
   emit `features.remote_auto_attach=true` in `provider_config_flags` **only when
   `== Some(true)`**, placed **before** the `additional_instructions` /
   `project_doc_fallback_filenames` block (preserve the trailing-flag invariant);
   extend the doc comment (`:29-36`). Add mirrored tests:
   `provider_flags_emit_remote_auto_attach_only_when_opted_in`,
   `parse_reads_enable_remote_auto_attach`, and update every `SandboxConfig { … }`
   test literal in the file to include the new field (defaults `None`).
10. **`codex/docs/implementation/patch-surface.md`** — (a) add §14 rows **71,
    72, 73** (mirror the shape of rows 55 and 60: invariant text + enforcing
    test + revert recipe); (b) add a §15 **"remote_auto_attach seam replant"**
    note (mirror the loopback_inject replant note at `:~1138`) enumerating the
    upstream-canonical replant set: the `app.rs` trigger, the `tui/src/lib.rs`
    `mod` line, the `features/src/lib.rs` enum+spec, the `features/src/tests.rs`
    tuple, and the `event_dispatch.rs` Q1 flip; note the new module + overlay
    tests + launcher flag are zero-surface. (c) confirm **no new egress site** —
    auto-attach reuses the audited overlay egress files only (invariant 57), adds
    none, so no `audit_network_calls.sh` allowlist change.

---

## 5 · Coexistence & edge cases (do-not-regress)

- **Manual `/remote on` / `/remote off` untouched.** Both funnel through the same
  `SetRemoteSession → apply_remote_session_toggle → maybe_attach_reporting` chain;
  auto is just the default that fires the same intent. Invariants 54/56/59/60/62
  stay green.
- **`remote_session=true` AND `remote_auto_attach=true` together.** The
  constructor `maybe_attach` gate runs first (attaches to an *already-running*
  daemon, or silently no-ops); then the auto trigger's `SetRemoteSession{true}`
  reaches `apply_remote_session_toggle`, whose `happy_tap.is_none()` guard
  **prevents a double attach**. If the constructor no-op'd (no daemon), auto's
  `ensure_running` starts the daemon and the single attach proceeds. Net: at most
  one Happy session; the Q1 flip is idempotent.
- **Double-wrap (a `happy codex`-owned session).** `should_skip_attach`
  (`HAPPY_CURRENT_SESSION_ID`) makes the reused attach a no-op — inherited free.
- **Event ordering at startup.** The trigger is `tokio::spawn`'d before the run
  loop drains `app_event_rx`; queued `SetRemoteSession`/`RemoteSessionNotice`
  events are handled once the loop starts (unbounded channel; same pattern as
  the manual `/remote on` spawn). The first interactive prompt is never blocked.
- **Concurrent sessions.** `session_tag()` mints a fresh `Uuid` per attach — N
  auto-attached codex sessions each get a distinct Happy session; no
  `SessionConflict` (no such variant exists).

---

## 6 · Scope

**In scope:** the new `Feature::RemoteAutoAttach` gate + startup trigger + trimmed
`auto_attach_flow`; Q1 status-coherence flip; Q2 loud-vs-passive failure wiring;
the launcher set-once flag; invariant tests + patch-surface rows/replant note.

**Out of scope / deferred (do NOT implement):**
- **v1/v2 sub-agent sessions** appearing in Happy — attach is TUI-only and the
  trigger lives in `App::run`; sub-agent surfacing is a separate task.
- **Mid-session daemon-process-crash respawn** — `start_smart_reconnect` handles
  transient socket drops; process-death respawn is next-session `ensure_running`
  only. A mid-session watchdog ties into `codex-daemon-same-identity-reattach`
  (sibling task), not this wedge.
- **Embedded-Rust daemon single-instance guard + reattach-on-same-identity** —
  owned by `codex-daemon-same-identity-reattach`.
- **A scripted `HAPPY_NO_AUTO_ATTACH=1` opt-out env guard** — optional
  convenience; `/remote off` already provides per-session opt-out. Left as an
  open question (§8), not implemented in v1.
- **crews-replacement / loopback-inject / hook removal** — explicitly out per the
  operator.

---

## 7 · Risk areas

1. **`app_event_tx` move ordering in `app.rs`.** The trigger MUST precede the
   `let mut app = Self { … app_event_tx, … }` struct literal (`:1052`) and use
   `.clone()`; placing it after the move fails to compile. Mitigation: place it
   immediately after the `happy_tap` gate; verify with `cargo check`.
2. **`Feature` import in `event_dispatch.rs`.** The Q1 flip references
   `Feature::RemoteSession`; confirm it's reachable via `use super::*` or add the
   import. Mitigation: `cargo check -p codex-tui` catches it.
3. **`chat_widget` borrow in `apply_remote_session_toggle`.** The flip
   (`self.chat_widget.set_feature_enabled`) and the existing
   `self.app_event_tx.clone()` / `self.happy_tap = …` are disjoint field borrows;
   sequence the flip first. Low risk (borrow-checker enforced).
4. **Fork-visibility test is exhaustive-by-listing.** Adding the enum variant +
   spec without the `features/src/tests.rs` tuple leaves the new feature
   uncovered (but green); the new `invariant_71` overlay test is the backstop.
   Mitigation: land tuple + spec + test together (M-A).
5. **Launcher test literals.** `config.rs` has ~15 `SandboxConfig { … }` test
   fixtures; adding a struct field breaks them all until each gets
   `enable_remote_auto_attach: None`. Mitigation: mechanical, `cargo check
   -p codex-copilot-launcher` enumerates every miss.
6. **UX noise: passive hint every un-onboarded session.** A never-onboarded user
   who enabled the feature sees the one-line Info hint on every startup. Accepted
   for v1 (single Info line, not an error); flagged as an open question (§8).
7. **Rebase replant.** New upstream-canonical seams must be re-applied on
   `/rebase-upstream`; the §15 note + the three overlay invariant tests are the
   guardrails (they fail loudly if a seam is dropped).

---

## 8 · Open questions (non-blocking — v1 proceeds with the stated default)

1. **Passive-hint frequency.** Show the "Run `/remote on`" Info hint every
   un-onboarded session (current plan), once-per-day, or once-ever (needs a
   persisted marker)? v1: every session (simplest; low-noise Info line).
2. **Scripted opt-out env guard** (`HAPPY_NO_AUTO_ATTACH=1`). Add now or defer?
   v1: **defer** — `/remote off` covers interactive opt-out.
3. **Feature naming.** `RemoteAutoAttach` / `remote_auto_attach` (chosen, per
   brainstorm recommendation) vs `AutoRemoteSession`. v1: `RemoteAutoAttach`.

---

## 9 · Build / verify plan (codex submodule)

Per `codex/CLAUDE.md` — **this is a codex-fork change; local iteration uses
`cargo check`, not full builds/tests.** The seam is small and the feature is
default-off experimental, so **vanilla codex is byte-unaffected** (the only new
runtime branch is `if config.features.enabled(Feature::RemoteAutoAttach)`, false
by default).

**Environment:** source `scripts/iteration-env.sh` first (frozen sccache/LTO
profile — do NOT drift `RUSTFLAGS` / `CARGO_PROFILE_RELEASE_LTO` /
`CARGO_PROFILE_RELEASE_CODEGEN_UNITS`). Build env is LLVM clang-cl + lld-link +
xwin (not MSVC); the authoritative env block is in
`.claude/commands/publish-sandbox-patch.md`.

**Gates (run from `codex/external/repos/codex-patched/codex-rs/`):**
1. **Workspace-parse preflight** (before editing): `cargo metadata --no-deps
   --format-version 1` — confirms the overlay-workspace parses so inherited
   breakage isn't misattributed.
2. **`cargo check --workspace`** — the ~6-min standard typecheck gate (HARD gate).
3. **Targeted tests for the crates touched:**
   - `cargo test -p codex-features fork_visibility_features_are_experimental_and_disabled_by_default`
   - `cargo test -p codex-invariant-tests --test happy_seam_invariants`
   - `cargo test -p codex-tui remote_session_toggle` (the extended coherence test)
   - `cargo test -p codex-copilot-launcher` (launcher flag parse/emit tests)
   - `cargo test -p codex-happy` (unchanged; run to confirm no regression)
4. **Format only changed files** with `rustfmt` (or `just fmt` in `codex-rs` per
   `codex-patched/AGENTS.md`) — do not reformat untouched files.
5. **Clippy on touched crates** (optional, recommended): `just fix -p codex-tui`
   / `-p codex-features` / `-p codex-copilot-launcher` — scope with `-p` to avoid
   a slow workspace-wide Clippy build.

**Deferred to CI (NOT local):** `cargo test --workspace` (90+ min; guaranteed by
`.github/workflows/invariant-check.yml`) and `cargo build --release` (fat-LTO
link can exceed the local tool ceiling; belongs to `/publish-sandbox-patch`). No
release cut is required for this task — it's a source change; the wrapper release
is a separate ship step if/when the operator wants it distributed.

**Two-commit submodule flow (impl commits locally on a topic branch; the lead
FF-merges + pushes):**
1. In a worktree **inside the codex-patched submodule** (per codexu AGENTS.md
   worktree convention: `codex/external/repos/codex-patched/.worktrees/<task-id>`
   or the codex wrapper's own worktree pattern), commit the `codex-rs/...` +
   `codex-rs-overlay/...` + `docs/...` edits **inside the submodule** first, push
   the submodule topic branch.
2. Then bump the `codex/` **wrapper gitlink** to the new submodule SHA in a second
   commit (wrapper records only the pointer + any wrapper-owned docs). The codexu
   parent, in turn, records only the `codex` pointer bump.
   *(Note: `Cargo.lock` under the submodule belongs to the submodule commit; the
   wrapper commit records only the gitlink.)*
3. Kill any running `codex.exe`/`codex-core.exe` before any build to avoid
   Windows `os error 5` file-locking (only relevant if a build is attempted).

---

## 10 · Acceptance criteria (verifiable)

1. `Feature::RemoteAutoAttach` exists (enum + `FeatureSpec`), `key ==
   "remote_auto_attach"`, `Stage::Experimental`, `default_enabled == false`;
   `cargo test -p codex-features fork_visibility_features_are_experimental_and_disabled_by_default`
   passes with the new tuple.
2. With the feature **off** (default), `app.rs` executes byte-identically to
   today: the only new branch is the false `if
   config.features.enabled(Feature::RemoteAutoAttach)` guard. `cargo check
   --workspace` is green.
3. With the feature **on** and creds present + daemon reachable/started, a fresh
   `codex` TUI attaches to Happy with **nothing typed** (auto path terminates in
   `AppEvent::SetRemoteSession { enabled: true }` through the single attach path).
4. **Q1:** after auto-attach, `apply_remote_session_toggle`'s enable path has
   flipped `Feature::RemoteSession = true`; the extended
   `tui/src/app/tests.rs` toggle test asserts the ChatWidget reports the feature
   enabled (so bare `/remote` says "on").
5. **Q2:** `NoCredentials` → a **passive `Info`** `RemoteSessionNotice` (the
   "Run `/remote on`" hint), **not** an error; `ensure_running` failure
   (`NoDaemon`/`StartFailed`) → a **loud `Error`** `RemoteSessionNotice`; attach
   failure (`SessionCreateFailed`/`ConnectFailed`) → loud via the reused
   `maybe_attach_reporting` sink.
6. Manual `/remote on` and `/remote off` still work unchanged (coexistence);
   `/remote off` opts the session out (drops `happy_tap`) without killing it.
7. **M-D:** `enable_remote_auto_attach = true` in
   `~/.codex-copilot/config.toml` causes the launcher to emit exactly
   `-c features.remote_auto_attach=true` (and nothing when unset/false), placed
   before the trailing `project_doc_fallback_filenames` flag; mirrored launcher
   tests pass.
8. `cargo test -p codex-invariant-tests --test happy_seam_invariants` passes
   including the new `invariant_71/72/73`.
9. patch-surface.md has §14 rows 71-73 and a §15 replant note; `bash
   scripts/audit_network_calls.sh` reports **no new egress site** (invariant 57
   unchanged).
10. `cargo check --workspace` (green), targeted `cargo test -p …` (green),
    `rustfmt`/`just fmt` clean on changed files.

---

## 11 · Milestone → story map (see `stories-outline.md`)

- **M-A** — Feature gate (enum + spec + fork-visibility tuple + §14 row 71 + §15
  note stub). *Depends on: nothing. Unblocks: M-B, M-D.*
- **M-B** — `auto_attach_flow` new module + `app.rs` startup trigger + `lib.rs`
  `mod` line + `invariant_72`. *Depends on: M-A.*
- **M-C** — Q1 status-coherence flip in `apply_remote_session_toggle` + the
  extended `tui/src/app/tests.rs` coherence test + `invariant_73`; confirm
  `/remote off` opt-out. (Q2 loud/passive behavior is realized in M-B's flow +
  the reused reporting attach.) *Depends on: M-B.*
- **M-D** — launcher `enable_remote_auto_attach` parse/emit + mirrored tests.
  *Depends on: M-A. Parallel to M-B/M-C.*
- **M-E** — patch-surface §14 rows 71-73 finalize + §15 replant note + audit
  closeout (`cargo check --workspace`; confirm no new egress). *Depends on: M-B,
  M-C, M-D.*
