# Investigation: codex provisions the Windows sandbox (`codex-windows-sandbox-setup.exe`) despite the launcher's skip flag

- **Task:** `codex-sandbox-setup-install-despite-skip-flag`
- **Type:** read-only source investigation (no code changes)
- **Date:** 2026-06-10
- **Submodule read in place:** `codex/external/repos/codex-patched/codex-rs`
  @ `03da7a2d8cdf2b5fe87a77259c0e6bad19a53441`
  (branch `ralph/codex-release-v3-integration`)
- **Launcher read:** `codex/codex-rs-overlay/codex-copilot-launcher/`

> All line numbers below are at the submodule SHA above. Citations are
> `path:line`. Read-only guard attestation is at the end.

---

## TL;DR — root cause

The codex launcher's **only** "skip sandbox" lever is the `-c` flag
`sandbox_mode="danger-full-access"`
(`codex/codex-rs-overlay/codex-copilot-launcher/src/config.rs:85`).

That flag sets codex-core's **cross-platform exec `SandboxPolicy`** to
`DangerFullAccess`. The Windows-sandbox *provisioning* subsystem (the thing
that runs `codex-windows-sandbox-setup.exe`) is gated on a **completely
separate axis** — `WindowsSandboxLevel`, derived from
`config.permissions.windows_sandbox_mode` (the `[windows].sandbox` TOML key)
or the `windows_sandbox` / `windows_sandbox_elevated` features
(`core/src/windows_sandbox.rs:30-47, 58-63`). `sandbox_mode` is **never
consulted** when computing `WindowsSandboxLevel`.

The launcher never sets `[windows].sandbox` nor those features
(`codex-copilot-launcher/src/config.rs:80-119` — `sandbox_mode` is the only
sandbox key it emits; there is no env var or config to suppress the NUX
either — `main.rs:94-118`). So for **every** fork session,
`WindowsSandboxLevel::from_config(&config) == WindowsSandboxLevel::Disabled`.

And `Disabled` is **precisely the trigger condition** for codex's "set up the
Windows sandbox" NUX (new-user-experience) prompt. So the danger-full-access
flag cannot and does not suppress Windows-sandbox provisioning — the two
features are orthogonal. When the NUX fires and a setup option is chosen, codex
spawns `codex-windows-sandbox-setup.exe`; on installs that do not bundle that
helper next to `codex-core.exe`, the spawn falls back to a bare filename and
fails with **"Windows cannot find codex-windows-sandbox-setup.exe"**.

---

## 1. The launcher "skip" flag — exactly what it passes

`codex/codex-rs-overlay/codex-copilot-launcher/src/config.rs:80-105`
(`provider_config_flags`) emits, among others:

```rust
// Source-level network patching handles isolation; disable codex-core's
// built-in sandbox so it doesn't retry on sandbox-related errors.
"sandbox_mode=\"danger-full-access\"".to_string(),   // config.rs:84-85
```

This is the **entire** "skip sandbox" mechanism. A full grep of the launcher
(`config.rs`, `main.rs`, `setup.rs`, `discovery.rs`) confirms:

- It does **not** emit `[windows].sandbox` (a.k.a. `windows.sandbox` /
  `permissions.windows_sandbox_mode`).
- It does **not** emit `features.windows_sandbox*`.
- It does **not** set any env var to disable the Windows-sandbox NUX
  (the launcher only sets `OPENAI_API_KEY`, `CODEX_TUI_USER_MESSAGE_STYLE`,
  `CODEX_ENABLE_ANTHROPIC` — `main.rs:94-118`).

Threading into codex-core: the launcher appends the `-c` flags last so they
win over user config (`main.rs:139-164`), and `codex-core` parses
`sandbox_mode` into the exec `SandboxPolicy` (`SandboxMode` →
`SandboxPolicy::DangerFullAccess`). This governs `core/src/exec.rs` /
`safety.rs` command sandboxing — **not** the Windows NUX.

---

## 2. Where codex decides to provision / run `codex-windows-sandbox-setup.exe`

The helper binary name is defined once:
`windows-sandbox-rs/src/setup.rs:47`
`const SETUP_EXE_FILENAME: &str = "codex-windows-sandbox-setup.exe";`

It is launched by `run_setup_exe(...)`
(`windows-sandbox-rs/src/setup.rs:660-769`):

- `let exe = find_setup_exe();` (`setup.rs:671`)
- non-elevated: `Command::new(&exe).arg(&payload_b64)...status()` (`setup.rs:693-699`)
- elevated: `ShellExecuteExW` with the `"runas"` verb (UAC prompt)
  (`setup.rs:724-748`)

`find_setup_exe()` (`setup.rs:628-635`) resolves the helper next to
`current_exe()` via `bundled_executable_path_for_exe`
(`windows-sandbox-rs/src/helper_materialization.rs:190-208`: tries
`<dir>/<file>`, `<pkg>/resources/<file>`, `<dir>/resources/<file>`), and
**falls back to the bare filename** when none is found:

```rust
fn find_setup_exe() -> PathBuf {
    if let Ok(exe) = std::env::current_exe()
        && let Some(setup_exe) = find_setup_exe_for_current_exe(&exe) { return setup_exe; }
    PathBuf::from(SETUP_EXE_FILENAME)            // setup.rs:634  <-- bare "codex-windows-sandbox-setup.exe"
}
```

The three production entry points that reach `run_setup_exe`
(via `run_elevated_setup` / `run_windows_sandbox_legacy_preflight` /
`run_setup_refresh*`) are:

| Entry point | File:line | Reached by |
|---|---|---|
| `core::windows_sandbox::run_windows_sandbox_setup` | `core/src/windows_sandbox.rs:258-332` | app-server JSON-RPC `windowsSandbox/setupStart` (`app-server/src/request_processors/windows_sandbox_processor.rs:85`) |
| `run_elevated_setup` / `run_legacy_setup_preflight` | TUI dispatch `tui/src/app/event_dispatch.rs:909, 1005` | TUI NUX accept (see §3) |
| `run_setup_refresh_with_extra_read_roots` | `core/src/windows_sandbox_read_grants.rs:27` via `grant_read_root_non_elevated` | TUI read-grant `tui/src/app/event_dispatch.rs:1054` (only meaningful once a sandbox is active) |

The dominant interactive trigger is the **TUI NUX** (§3). The exec path that
actually *runs* commands inside the sandbox
(`core/src/unified_exec/process_manager.rs:985-1053`) is correctly suppressed
by danger-full-access (`core/src/exec.rs:966-977`
`should_use_windows_restricted_token_sandbox` returns `false` for
`SandboxPolicy::DangerFullAccess`), so the bug is the **setup/NUX path**, not
the per-command run path.

---

## 3. The two NUX paths that fire `setup.exe` — both gated only on `WindowsSandboxLevel == Disabled`

### Path A — startup NUX

`tui/src/lib.rs:1697-1699`:

```rust
let should_prompt_windows_sandbox_nux_at_startup = cfg!(target_os = "windows")
    && trust_decision_was_made
    && WindowsSandboxLevel::from_config(&config) == WindowsSandboxLevel::Disabled;
```

Plumbed to `App::run(... should_prompt_windows_sandbox_nux_at_startup ...)`
(`lib.rs:1773`) → `app.rs:701, 956`
`maybe_prompt_windows_sandbox_enable(show_now)`
(`tui/src/chatwidget/windows_sandbox_prompts.rs:443-452`):

```rust
if show_now
    && WindowsSandboxLevel::from_config(&self.config) == WindowsSandboxLevel::Disabled
    && let Some(preset) = builtin_approval_presets().into_iter().find(|p| p.id == "auto")
{ self.open_windows_sandbox_enable_prompt(preset, None); }
```

The prompt (`open_windows_sandbox_enable_prompt`,
`windows_sandbox_prompts.rs:196-328`) offers a selection list whose
**first / default-highlighted** item is
*"Set up default sandbox (requires Administrator permissions)"* →
`AppEvent::BeginWindowsSandboxElevatedSetup`
(`windows_sandbox_prompts.rs:280-283`) →
`event_dispatch.rs:863-965` → `run_elevated_setup` → `run_setup_exe`
(UAC `runas`). The second item *"Use non-admin sandbox"* →
`BeginWindowsSandboxLegacySetup` → `run_legacy_setup_preflight` → `run_setup_exe`
(non-elevated).

Neither this gate nor the prompt consults `sandbox_mode` / `SandboxPolicy` at
any point.

### Path B — approval-preset NUX

`tui/src/chatwidget/permission_popups.rs:324-346`: when the **"auto"** approval
preset is selected (via the approvals/`/permissions` popup) and
`WindowsSandboxLevel::from_config(&self.config) == WindowsSandboxLevel::Disabled`:

```rust
if WindowsSandboxLevel::from_config(&self.config) == WindowsSandboxLevel::Disabled {
    if ELEVATED_SANDBOX_NUX_ENABLED && sandbox_setup_is_complete(codex_home) {
        // already provisioned: just enable
        tx.send(AppEvent::EnableWindowsSandboxForAgentMode { Elevated, .. });
    }
    // not provisioned: show the same setup NUX
    tx.send(AppEvent::OpenWindowsSandboxEnablePrompt { .. });   // -> run_setup_exe on accept
}
```

Again gated only on `WindowsSandboxLevel == Disabled`, independent of
`sandbox_mode`.

---

## 4. WHY the skip flag is not honored (the core defect)

`WindowsSandboxLevel::from_config` (`core/src/windows_sandbox.rs:30-47`) reads
**only** `config.permissions.windows_sandbox_mode`, falling back to the
`windows_sandbox*` features — it never reads `sandbox_mode` / `SandboxPolicy`:

```rust
fn from_config(config: &Config) -> WindowsSandboxLevel {
    match config.permissions.windows_sandbox_mode {
        Some(WindowsSandboxModeToml::Elevated)   => WindowsSandboxLevel::Elevated,
        Some(WindowsSandboxModeToml::Unelevated) => WindowsSandboxLevel::RestrictedToken,
        None => Self::from_features(&config.features),   // -> Disabled unless a feature is on
    }
}
```

So the two axes are orthogonal:

| Axis | Set by | Launcher value | Governs |
|---|---|---|---|
| `SandboxPolicy` (`sandbox_mode`) | `-c sandbox_mode=...` | `DangerFullAccess` | per-command exec sandboxing (`exec.rs`, `safety.rs`) |
| `WindowsSandboxLevel` | `[windows].sandbox` / `windows_sandbox*` features | **unset → `Disabled`** | Windows NUX + provisioning (`setup.exe`) |

The launcher believes "danger-full-access ⇒ no sandbox at all," but the
Windows-sandbox NUX interprets `Disabled` as *"the user hasn't set up the
sandbox yet — offer to set it up."* That is the inversion that defeats the
skip flag: the launcher leaves the Windows sandbox in the exact state
(`Disabled`) that **triggers** the provisioning prompt.

(Confirming evidence that danger-full-access still yields `Disabled`:
`core/src/config/config_tests.rs:3429,3450,3482,...` assert
`WindowsSandboxLevel::Disabled` for configs without `[windows].sandbox`.)

There is **no** "Disabled-and-don't-offer" state upstream: `Disabled` always
means "eligible to be offered." A fork that does isolation at the network-patch
layer and always runs danger-full-access therefore needs to **explicitly**
short-circuit the NUX; nothing the launcher currently emits does that.

---

## 5. WHEN "sometimes" triggers — precise conditions

Necessary precondition (always true for the fork): Windows OS **and**
`WindowsSandboxLevel::from_config == Disabled` (launcher never sets the level).

The "sometimes" is the *discriminator on top of that*:

- **Path A (startup NUX):** additionally requires `trust_decision_was_made`
  (`lib.rs:1698`), which is `onboarding_result.directory_trust_persisted`
  (`lib.rs:1394, 1439`). That is **true only on a run where onboarding's trust
  screen ran and the user persisted a trust decision for the cwd** — i.e. the
  **first run in a not-yet-trusted directory** (or whenever trust is
  re-prompted). On an already-trusted cwd, onboarding is skipped,
  `trust_decision_was_made` stays `false`, and the startup NUX does **not**
  appear. → This is the primary source of intermittency: it tracks
  *first-launch-in-a-new-working-directory*. In the crews workflow, each new
  member tab opened in a fresh worktree/cwd that isn't yet trusted hits the
  trust screen → trust persisted → Windows-sandbox NUX. Re-running in an
  already-trusted dir does not.
  - The actual `setup.exe` spawn then requires a setup item to be chosen in the
    prompt. The **default-highlighted** item is *"Set up default sandbox,"* so a
    stray Enter (or a human reflexively accepting) launches it (UAC `runas`).

- **Path B (approvals popup):** fires when the **"auto"** approval preset is
  selected while the Windows sandbox is `Disabled`
  (`permission_popups.rs:324`). Because the launcher forces
  `sandbox_mode="danger-full-access"` (full-access preset), this requires an
  explicit switch away from full access to "auto" via `/approvals` /
  `/permissions`. → intermittent by whether the operator/agent changes preset.

- **The "Windows cannot find codex-windows-sandbox-setup.exe" string**
  surfaces specifically on installs where the helper is **not** bundled next to
  `codex-core.exe` (nor in the sibling `resources/` dir): `find_setup_exe`
  falls back to the bare filename (`setup.rs:634`) and the OS can't resolve it
  on `PATH`. The full release bundle *does* ship the helper
  (`codex/.github/workflows/publish-npm.yml:129,141`), so this is seen on
  partial installs / dev-iteration builds that compile only `codex-core` +
  `codex` (the launcher) and omit `codex-windows-sandbox-setup`. Where the
  helper *is* present, the same NUX instead produces a real UAC elevation
  prompt / sandbox setup — equally unwanted for the fork, just a different
  symptom.

---

## 6. Recommended fix direction

Goal: make the Windows-sandbox NUX/provisioning **inert** for fork sessions
(which are always danger-full-access and rely on source-level network
patching), per `codex/CLAUDE.md` tenets (overlay-first; minimize
upstream-canonical conflict surface; pair any upstream edit with a
`// SANDBOX PATCH:` marker + patch-surface §14 invariant + §15 replant note).

**Primary (lowest conflict surface, profile-independent) — a fork env-var
gate, following the existing launcher-env pattern:**

1. Launcher (`codex-copilot-launcher/src/main.rs` `configure_launcher_env`,
   alongside `CODEX_TUI_USER_MESSAGE_STYLE` / `CODEX_ENABLE_ANTHROPIC`,
   `main.rs:94-118`) unconditionally sets e.g.
   `CODEX_DISABLE_WINDOWS_SANDBOX_NUX=1`.
2. Add a 1-line read of that env var at the **two** gate seams:
   - `tui/src/lib.rs:1697-1699` — `&& !disable_windows_sandbox_nux()` in
     `should_prompt_windows_sandbox_nux_at_startup`.
   - `tui/src/chatwidget/permission_popups.rs:324-346` — short-circuit before
     branching into the windows-sandbox enable path.
   Helper can live in a fork overlay module so the upstream edits are just the
   two call sites (placement option 2 in `CLAUDE.md`'s hierarchy). This is
   trivially greppable/auditable and does not entangle the NUX with permission
   profile semantics.

**Alternative (no env var) — gate on the full-access posture:** add
`&& config.permissions.effective_permission_profile() != PermissionProfile::Disabled`
(full access) at the same two seams. `PermissionProfile::Disabled` == "Full
Access mode" (`windows_sandbox_prompts.rs:64-65`), which is exactly what
danger-full-access resolves to, so the NUX is suppressed for the fork while
preserved for any (hypothetical) non-full-access posture. Slightly more coupled
than the env var but needs no launcher change.

**Secondary / belt-and-suspenders (symptom hardening, not a root-cause fix):**
make `find_setup_exe` (`windows-sandbox-rs/src/setup.rs:628-635`) **not** fall
back to the bare filename — return an explicit "setup helper not bundled" error
instead of attempting a `PATH`-resolved launch — so that if the NUX is ever
reached on a helper-less install, the failure is a clean diagnostic rather than
the confusing "Windows cannot find codex-windows-sandbox-setup.exe". This only
changes the error text; do it in addition to, not instead of, the primary fix.

> Do **not** "fix" this by setting `[windows].sandbox` to a non-`Disabled`
> value — that suppresses the NUX but then makes codex actually *use* and
> provision the Windows sandbox for restricted/elevated exec, which is strictly
> worse for the fork.

---

## Appendix A — file:line index

- Launcher skip flag: `codex/codex-rs-overlay/codex-copilot-launcher/src/config.rs:84-85`
- Launcher emits no `[windows].sandbox` / no NUX-disable env: `config.rs:80-119`, `main.rs:94-118`
- `WindowsSandboxLevel::from_config` (reads only `windows_sandbox_mode`/features): `core/src/windows_sandbox.rs:30-47`
- `resolve_windows_sandbox_mode`: `core/src/windows_sandbox.rs:58-63`
- Startup NUX gate: `tui/src/lib.rs:1697-1699` (plumbed `lib.rs:1773`; `tui/src/app.rs:701,956`)
- `maybe_prompt_windows_sandbox_enable`: `tui/src/chatwidget/windows_sandbox_prompts.rs:443-452`
- NUX prompt items → `BeginWindowsSandbox{Elevated,Legacy}Setup`: `windows_sandbox_prompts.rs:196-328` (280-283, 297-300)
- Approval-preset NUX gate: `tui/src/chatwidget/permission_popups.rs:324-346`
- TUI dispatch → `run_elevated_setup` / `run_legacy_setup_preflight`: `tui/src/app/event_dispatch.rs:863-965, 972-1028`
- app-server JSON-RPC trigger: `app-server/src/request_processors/windows_sandbox_processor.rs:77-85`; routed `app-server/src/message_processor.rs:1251-1253`
- `run_setup_exe` (spawns the helper): `windows-sandbox-rs/src/setup.rs:660-769` (find at 671; Command at 693-699; ShellExecuteExW runas at 724-748)
- `find_setup_exe` bare-filename fallback: `windows-sandbox-rs/src/setup.rs:628-635`
- helper resolution: `windows-sandbox-rs/src/helper_materialization.rs:190-208`
- exec run-path correctly excludes DangerFullAccess: `core/src/exec.rs:966-977`; unified-exec spawn `core/src/unified_exec/process_manager.rs:985-1053`
- danger-full-access still yields `WindowsSandboxLevel::Disabled`: `core/src/config/config_tests.rs:3429,3450,3482`
- helper is built/bundled by release: `codex/.github/workflows/publish-npm.yml:129,141`

## Appendix B — read-only guard attestation

- Pre-snapshot (codexu): HEAD `0994b24709a413d50e9b44a14e92d58ea102fb44`; 4 pre-existing
  stashes; pre-existing dirty generated/overview files (`.ralph-overview/generated/*`,
  `tasks/INDEX.md`, etc.) unrelated to this task.
- Submodule `codex/external/repos/codex-patched`: HEAD
  `03da7a2d8cdf2b5fe87a77259c0e6bad19a53441`, branch
  `ralph/codex-release-v3-integration`, only untracked `.worktrees/`.
- This investigation made **no** source edits. The sole write is this
  `findings.md` under `.ralph/investigations/`. No branch switches; the
  submodule was read in place.
