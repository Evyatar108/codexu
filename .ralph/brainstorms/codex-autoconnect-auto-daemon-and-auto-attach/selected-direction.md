---
overviewTaskId: codex-autoconnect-auto-daemon-and-auto-attach
title: "Auto-daemon + auto-attach: a fresh codex session appears in Happy with nothing typed"
status: brainstorm
recommendedDirection: "D-001"
generatedBy: "/brainstorm-with-ralph"
date: 2026-07-01
researchOnly: true
sources:
  - codex/external/repos/codex-patched/codex-rs/tui/src/app.rs
  - codex/external/repos/codex-patched/codex-rs/tui/src/chatwidget/slash_dispatch.rs
  - codex/external/repos/codex-patched/codex-rs/tui/src/app/event_dispatch.rs
  - codex/external/repos/codex-patched/codex-rs/tui/src/app_event.rs
  - codex/external/repos/codex-patched/codex-rs/features/src/lib.rs
  - codex/codex-rs-overlay/codex-happy/src/{attach,daemon_supervisor,remote_on}.rs
  - codex/codex-rs-overlay/codex-copilot-launcher/src/config.rs
  - codex/docs/implementation/patch-surface.md
  - codex/.ralph/brainstorms/codex-autoconnect-northstar-design-doc/selected-direction.md
---

# Auto-daemon + auto-attach

> **Recommended: D-001 — a new default-off experimental `Feature::RemoteAutoAttach`
> whose startup trigger reuses the already-shipped `/remote on` machinery
> (daemon `ensure_running` → `SetRemoteSession`) *minus the interactive
> onboard*, so a fresh `codex` TUI attaches to Happy with nothing typed once
> credentials exist in `~/.happy`.**

Read-only design doc. No source was changed. All file:line citations are to the
read-only state of the tree on 2026-07-01.

---

## 0 · TL;DR

The end-to-end spine already exists and is proven (north-star **M0**, shipped
under `codex-raw-session-happy-daemon-autoconnect`): a native Rust Happy client
(`codex-happy` overlay) tees every in-process `AppServerEvent` to a Happy
session and drives the live codex turn from mobile, gated behind the default-off
experimental `Feature::RemoteSession`. **Today the only friction is that the
user must type `/remote on` per session.** That command does exactly three
things (`slash_dispatch.rs:79-149` `remote_on_flow`):

1. **self-onboard** if no creds (`has_credentials()` false → `run_self_onboard`),
2. **ensure the per-machine daemon is running** (`NodeDaemonSupervisor::ensure_running`),
3. **attach** (`AppEvent::SetRemoteSession { enabled: true }`).

The wedge is to **fire steps 2+3 automatically at startup** behind a new
default-off experimental gate, and to replace step 1's interactive device-flow
with a **passive one-line hint** when creds are absent. Nothing else in the
attach/daemon/inbound stack needs to change — auto-attach becomes *the default
that fires the same intent the user used to type*.

```
 fresh `codex` (TUI)
        │
        ▼  App::run  (tui/src/app.rs:770)
   Feature::RemoteAutoAttach enabled?  ── no ──▶ vanilla codex (unchanged)
        │ yes
        ▼  tokio::spawn(auto_attach_flow(app_event_tx))   ← NEW trigger, next to app.rs:1034
   has_credentials()?  ── no ──▶ ONE passive Info notice: "Run /remote on to connect to Happy"
        │ yes
        ▼
   NodeDaemonSupervisor::with_os_host(home).ensure_running()   ← REUSE daemon_supervisor.rs
        │  (start-if-absent; daemon stays resident; never restarts a foreign daemon)
        ▼
   AppEvent::SetRemoteSession { enabled: true }               ← REUSE app_event.rs:214
        │
        ▼  apply_remote_session_toggle → maybe_attach_reporting  (event_dispatch.rs:52-84)
   codex session now mirrored + remote-controllable in Happy.   Opt out per session: /remote off
```

---

## 1 · Where things stand in source (grounding)

### 1.1 The startup attach seam — and why it does NOT auto-start the daemon

`App::run` (the async TUI constructor, `tui/src/app.rs:770`) computes
`happy_tap` at **`app.rs:1028-1048`**:

```rust
// tui/src/app.rs:1034
let happy_tap = if config.features.enabled(Feature::RemoteSession) {
    codex_happy::attach::maybe_attach(
        codex_happy::attach::AttachParams::new(config.cwd.to_path_buf(),
            CODEX_CLI_VERSION.to_string()),
        app_server.request_handle(),
    )
} else {
    None
};
```

`maybe_attach` (`attach.rs:168`) spawns a background task and returns the tap
sender immediately (never blocks the first prompt). Its `establish_at`
(`attach.rs:458-503`) reads `~/.happy/machine.json`; **if absent it returns
`AttachError::NoDaemon` and the constructor path silently falls back to vanilla
codex** (`attach.rs:463`). **Critically, the startup path does NOT call the
daemon supervisor** — so even `-c features.remote_session=true` today only
attaches to a daemon someone *already* started; it never starts one. That is the
gap the operator wants closed.

The `happy_tap` field is `app.rs:597`; the outbound tee is `app.rs:1243`
(patch-surface **invariant 54**). This seam is **TUI-only** — there is no
attach path for headless `codex exec`/`codex responses`. Auto-attach therefore
inherits the same "top-level interactive TUI sessions only" scope, which matches
the operator's DEFER of v1/v2 sub-sessions.

### 1.2 The `/remote on` flow is the exact sequence we want to automate

`remote_on_flow` (`slash_dispatch.rs:79-149`):

```
home = happy_home_dir()                                   # slash_dispatch.rs:85
if !has_credentials():  run_self_onboard(...)             # :95  (interactive device flow)
NodeDaemonSupervisor::with_os_host(home).ensure_running() # :136 (start-if-absent)
AppEvent::SetRemoteSession { enabled: true }              # :145 (attach — the single path)
```

`SetRemoteSession` (`app_event.rs:214`) is dispatched at
`event_dispatch.rs:119` → `apply_remote_session_toggle` (`event_dispatch.rs:52-84`),
which on `enabled` installs the tap via `maybe_attach_reporting`
(`attach.rs:183`) and on disable drops it (closing the Happy socket + stopping
reconnect **without killing the codex session**). This is patch-surface
**invariants 59/60**.

### 1.3 The daemon supervisor already gives "resident, single-instance, no-restart"

`daemon_supervisor.rs`:
- `SessionPlaneSupervisor::ensure_running` is **start-if-absent + health-probe
  only** and **must never stop/restart a daemon it did not start** (F-005,
  documented in the module header and enforced by the ownership flag).
- `NodeDaemonSupervisor::with_os_host(home)` is the production impl; it probes
  `~/.happy/machine.json` + TCP-probes the tunnel listener, and only spawns
  `happy daemon start-sync` when nothing is reachable.
- `spawn_happy_daemon` launches the Node daemon **detached** (`Stdio::null` on
  stdin/stdout/stderr), so it **outlives the codex process** — this is precisely
  the operator's "auto-start on first session, stays resident, NOT per-session
  spawn, NOT a boot service" requirement, with **zero new lifecycle code**.

The Node daemon's own singleton logic (`ensureDaemonRunning.ts`) is the
**single-instance guard** at the process level. The *embedded-Rust* server's
single-instance guard + **reattach-on-same-identity** is a separate, explicitly
sibling task (`codex-daemon-same-identity-reattach`) — this wedge coordinates
with it but does not design it.

### 1.4 The experimental-feature convention to mirror

`Feature::RemoteSession` (`features/src/lib.rs:177`) + its `FeatureSpec`
(`features/src/lib.rs:1078-1087`): `key: "remote_session"`,
`stage: Stage::Experimental { name, menu_description, announcement }`,
`default_enabled: false`. It sits in the fork-visibility cluster next to
`Feature::LoopbackInject` (`:182`). Patch-surface **invariant 55** pins it as
"Experimental + default-OFF". The launcher never force-emits it — it emits
`features.remote_session=true` **only** when the user opts in via
`~/.codex-copilot/config.toml::enable_remote_session` (`config.rs:120-131`),
deliberately unlike the force-`false` `features.remote_control`. The new gate
mirrors all of this.

---

## 2 · Recommended design (D-001)

### 2.1 The smallest wedge

**One new experimental feature + one startup trigger + one trimmed flow
function.** Everything else is reuse.

**(a) New gate `Feature::RemoteAutoAttach`** — `features/src/lib.rs`:
- add the enum variant next to `RemoteSession`/`LoopbackInject` (`:177-182`),
- add a `FeatureSpec { id, key: "remote_auto_attach", stage: Stage::Experimental
  { name: "Remote auto-attach", menu_description: "Automatically mirror every
  Codex session to the Happy mobile app once onboarded.", announcement: ... },
  default_enabled: false }` next to the `RemoteSession` spec (`:1078-1087`),
- extend the fork-visibility default-off test that invariant 55 references
  (`fork_visibility_features_are_experimental_and_disabled_by_default`) to cover
  the new key. Add a new patch-surface §14 invariant row + §15 replant note
  (mirror row 55).

**(b) Startup trigger** — `tui/src/app.rs`, immediately after the existing
`happy_tap` gate (`:1028-1048`). Leave the existing `RemoteSession` gate exactly
as-is (so `remote_session=true` keeps its current attach-to-existing-daemon
semantics), and add a sibling:

```rust
// SANDBOX PATCH: remote_auto_attach — fire the same intent `/remote on` fires,
// automatically, when the auto-attach feature is enabled. Non-blocking.
if config.features.enabled(Feature::RemoteAutoAttach) {
    tokio::spawn(auto_attach_flow(app_event_tx.clone()));
}
```

`app_event_tx` is already in scope in `run()` (`app.rs:643`/struct-literal `:1055`).
This is the **daemon auto-start insertion point** the operator asked me to find:
**`tui/src/app.rs:1034`** (the `maybe_attach` gate inside `App::run`); the actual
daemon start happens inside `auto_attach_flow` via `ensure_running`, exactly as
`remote_on_flow` does it at `slash_dispatch.rs:136`.

**(c) `auto_attach_flow`** — a trimmed copy of `remote_on_flow`
(`slash_dispatch.rs:79-149`), living beside it (that file is already a
`// SANDBOX PATCH: remote_session` file, so it is the natural home; a new overlay
module is an alternative if we want to keep the TUI edit to just the trigger):

```rust
// SANDBOX PATCH: remote_auto_attach
async fn auto_attach_flow(tx: AppEventSender) {
    use codex_happy::daemon_supervisor::SessionPlaneSupervisor as _;
    let Some(home) = codex_happy::auth::happy_home_dir() else { return }; // silent

    // Onboarding gate: NEVER auto-launch the device flow. Prompt, don't error.
    if !codex_happy::attach::has_credentials() {          // attach.rs:222
        tx.send(AppEvent::RemoteSessionNotice {           // app_event.rs:223
            text: "Codex can mirror this session to the Happy app.".into(),
            hint: Some("Run `/remote on` once to connect this machine.".into()),
            level: RemoteSessionNoticeLevel::Info,
            open_url: None,
        });
        return;
    }

    // Daemon: start-if-absent, stays resident, never restart a foreign daemon.
    let supervisor = codex_happy::daemon_supervisor::NodeDaemonSupervisor::with_os_host(home);
    if supervisor.ensure_running().await.is_err() {       // daemon_supervisor.rs
        // No happy-cli on a machine that HAS creds is unusual; keep quiet
        // (or a single subtle Info hint) — do NOT hard-error a background path.
        return;
    }

    // Attach through the ONE existing path.
    tx.send(AppEvent::SetRemoteSession { enabled: true }); // app_event.rs:214
}
```

The only behavioral deltas from `remote_on_flow` are: **(i)** creds-absent →
passive hint instead of `run_self_onboard`, and **(ii)** the daemon-missing
branch is quiet rather than a loud diagnosed error, because this is an unprompted
background path. Reuse of `SetRemoteSession` means the attach itself is
**byte-for-byte the same code** the manual command uses — the two paths cannot
diverge (patch-surface invariant 59/60 stay intact).

### 2.2 Auto-attach default + per-session opt-out

- **Default once onboarded:** with `Feature::RemoteAutoAttach` enabled, EVERY
  fresh codex TUI with `~/.happy` creds present auto-attaches. "Default-OFF until
  proven" and "default once onboarded" reconcile cleanly: the *feature* is
  experimental default-off (the user turns the whole behavior on once, via
  `/experimental`, `~/.codex/config.toml`, `--enable remote_auto_attach`, or the
  launcher flag in 2.4); *after that* every session is on-by-default.
- **Opt-out per session:** the shipped `/remote off` already sends
  `SetRemoteSession { enabled: false }` and drops `happy_tap` without killing the
  session (`slash_dispatch.rs:866-879`, `event_dispatch.rs:81`). No new opt-out
  surface is strictly required. A scripted/CI opt-out env var
  (`HAPPY_NO_AUTO_ATTACH=1`, mirroring the `HAPPY_CURRENT_SESSION_ID` skip guard
  at `attach.rs:67-70`/`202`) is an optional convenience (open question).

### 2.3 Experimental-feature gating (mirror RemoteSession exactly)

`Feature::RemoteAutoAttach` is registered identically to `RemoteSession`
(§1.4): Experimental, `default_enabled: false`, in the fork-visibility cluster,
covered by the default-off invariant test and a new patch-surface §14 row.
Vanilla codex (feature off) executes the *identical* code path it does today —
the `if config.features.enabled(Feature::RemoteAutoAttach)` guard is the only
new branch, and it is false by default.

### 2.4 Launcher "set-once" convenience (optional but recommended)

Add `enable_remote_auto_attach: Option<bool>` to `SandboxConfig`
(`config.rs:8`) and emit `-c features.remote_auto_attach=true` **only when
opted in** (`config.rs:129-131` pattern), **never force-emitted** (mirror the
`enable_remote_session` policy at `config.rs:29-36`, and keep the
`project_doc_fallback_filenames` last-flag invariant). This gives the operator a
single line in `~/.codex-copilot/config.toml` — the *true* zero-per-session-
friction surface: set once, every future `codex` auto-attaches.

---

## 3 · Failure modes

| Failure | Handling (D-001) | Source |
|---|---|---|
| **No creds yet** (never onboarded) | `has_credentials()` false → **one passive Info notice** ("Run `/remote on` once"), no error, **no auto-launched device flow**, startup unblocked. | `attach.rs:222`; `app_event.rs:223`; §2.1(c) |
| **Creds present, no daemon** | `ensure_running` **starts the Node daemon detached** (start-if-absent); on a machine with creds but no `happy` on PATH it returns `NoDaemon` → the background path stays quiet (or one subtle hint). | `daemon_supervisor.rs` `ensure_running`/`spawn_happy_daemon`/`SupervisorError::NoDaemon` |
| **Daemon already running (foreign or ours)** | `ensure_running` attaches to it and **never restarts/stops it** (F-005 singleton rule). | `daemon_supervisor.rs` header + `ensure_running` step 1 |
| **Daemon crash / socket drop mid-session** | `start_smart_reconnect` (`attach.rs:502`) reconnects transient drops; if the daemon **process** dies, its tunnel listener vanishes and the next codex session's `ensure_running` respawns it (start-if-absent). Mid-session process-death respawn is **not** auto-handled — flagged as open. | `attach.rs:502`; `daemon_supervisor.rs` |
| **Attach fails** (`SessionCreateFailed`/`ConnectFailed`) | Surfaced via `maybe_attach_reporting`; the codex session continues local-only (tap becomes a no-op). Quiet-vs-loud is an open question (§4). | `attach.rs:108-127,183`; `event_dispatch.rs:52-84` |
| **"SessionConflict"** | **Not a real `AttachError` variant** — `attach.rs:108-127` defines only `NoCredentials`/`NoDaemon`/`SessionCreateFailed`/`ConnectFailed`. And `session_tag()` is a fresh `Uuid` per attach (`attach.rs:746`), so N concurrent auto-attached codex sessions each mint a **distinct** Happy session and cannot collide. Any true same-identity conflict (resume/fork racing the same session id) belongs to the sibling **`codex-daemon-same-identity-reattach`** task, not this wedge. | `attach.rs:108-127,746` |
| **Double-wrap** (a `happy codex`-owned session) | `maybe_attach_inner` already short-circuits when `HAPPY_CURRENT_SESSION_ID` is set (`should_skip_attach`), so an auto-attach inside a happy-cli-owned session is a no-op — inherited for free. | `attach.rs:67-70,188-204` |

> **Do-not-regress guarantee:** the manual `/remote on` path is untouched — auto
> and manual both terminate in the same `SetRemoteSession` →
> `apply_remote_session_toggle` → single attach chain. `auto = the default that
> calls the same attach path`. Invariants 54/56/59/60/62 remain green.

---

## 4 · Open questions for the operator

1. **Feature name**: `Feature::RemoteAutoAttach` / key `remote_auto_attach`
   (recommended) vs `AutoRemoteSession`. Register in the fork-visibility cluster
   (`features/src/lib.rs:177-182`).
2. **Status coherence**: should `auto_attach_flow` also
   `set_feature_enabled(Feature::RemoteSession, true)` so `/remote` reports "on"
   while auto-attached, or should we add a distinct runtime "attached" indicator?
   `apply_remote_session_toggle` does not flip the flag today
   (`event_dispatch.rs:52-84`).
3. **Quiet vs loud** background attach failures: reuse `maybe_attach_reporting`
   (loud, like `/remote on`) or thread a `quiet` flag on `SetRemoteSession` for
   the auto path?
4. **Mid-session daemon-crash respawn**: is next-session `ensure_running`
   respawn sufficient for v1, or do we want a mid-session watchdog? (Ties into
   `codex-daemon-same-identity-reattach`.)
5. **Scripted opt-out**: add `HAPPY_NO_AUTO_ATTACH=1` env guard alongside
   `/remote off`, mirroring the `HAPPY_CURRENT_SESSION_ID` skip (`attach.rs:67-70`)?

---

## 5 · Sequenced milestones

- **M-A · Feature gate.** Add `Feature::RemoteAutoAttach` (enum + `FeatureSpec`,
  Experimental, default-off) in `features/src/lib.rs` next to `RemoteSession`;
  extend the fork-visibility default-off test; add patch-surface §14 invariant
  row + §15 replant note. *(Depends on: nothing. Unblocks: M-B.)*
- **M-B · Auto-attach flow + startup trigger.** Add `auto_attach_flow`
  (trimmed `remote_on_flow`: creds-gate → `ensure_running` → `SetRemoteSession`;
  creds-absent → one passive Info hint) and the
  `if features.enabled(RemoteAutoAttach) { tokio::spawn(...) }` trigger next to
  `app.rs:1034`. Add an overlay/invariant test asserting the trigger reuses
  `ensure_running` + `SetRemoteSession` and carries `// SANDBOX PATCH`
  markers (mirror invariant 60's marker test). *(Depends on: M-A.)*
- **M-C · Opt-out + status coherence.** Confirm `/remote off` opts a session out
  (already shipped); resolve open questions 2 & 3 (flip `RemoteSession` flag
  and/or quiet failures); optionally add the `HAPPY_NO_AUTO_ATTACH` env guard.
  *(Depends on: M-B.)*
- **M-D · Launcher set-once flag.** Add `enable_remote_auto_attach` to
  `~/.codex-copilot/config.toml` handling in `config.rs`, emitted only-when-
  opted-in (mirror `enable_remote_session`, preserve the trailing-flag
  invariant), with the parse/emit tests parallel to the existing
  `remote_session` launcher tests. *(Depends on: M-A. Parallel to M-B/M-C.)*
- **M-E · Patch-surface + audit closeout.** New §14 invariant row(s) for the
  trigger + flow + gate, §15 replant recipe, and confirm no new egress site
  (auto-attach adds none — it reuses the audited overlay egress files, invariant
  57). `cargo check --workspace` gate. *(Depends on: M-B, M-D.)*
- **Coordination (NOT owned here)**: the embedded-Rust daemon single-instance
  guard + reattach-on-same-identity is `codex-daemon-same-identity-reattach`;
  v1/v2 sub-session surfacing in Happy is explicitly deferred; crews-replacement
  (loopback daemon-inject / hook removal) is out of scope per the operator.
