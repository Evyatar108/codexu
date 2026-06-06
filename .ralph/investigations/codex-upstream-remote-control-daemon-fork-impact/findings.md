# Investigation: codex upstream remote-control / daemon — fork impact

- **Task id:** `codex-upstream-remote-control-daemon-fork-impact`
- **Date:** 2026-06-06
- **Codex tree version:** `0.135.0-copilot-api.1` (`external/repos/codex-patched/codex-rs/Cargo.toml:128-129`)
- **Mode:** read-only investigation (no source modified)
- **Question:** codex v131 added daemon-managed remote-control + runtime enable/disable
  APIs + status reads + registry-backed/configured remote environments. Does it affect
  our happy/codexu daemon integration?

---

## Impact verdict: **INSULATED — no conflict, no required happy-cli change**

(plus one rebase-hygiene watch item, and one deliberately-declined "leverage" option.)

The v131-era remote-control/daemon surface — which is fully present in the current
v0.135.0 tree — does **not** affect happy/codexu's daemon integration:

1. **happy-cli drives the *plain* `app-server` crate, never the `app-server-daemon`
   crate.** It spawns `codex app-server --listen stdio://` / `--listen ws://127.0.0.1:<port>`.
   The new daemon-managed flow is a separate `codex app-server daemon …` subcommand that
   happy-cli never invokes.
2. **The daemon crate is Unix-only and hard-errors on Windows** (codexu's primary dev
   box), so the daemon path is not even reachable there.
3. **The three-layer `remote_control` force-disable is intact and now *transitively*
   covers the new runtime RPCs**, because the new `remoteControl/{enable,disable,status}`
   request-processor calls straight through the already-patched `RemoteControlHandle`.
4. **happy-cli contains zero references** to `app-server daemon`, `remoteControl`,
   `remote_control`, or `remote-control` (its "daemon" is the unrelated Happy Node daemon).

No code change is required in happy-cli or codexu. Keep the three-layer disable.

---

## Background — the fork's three-layer force-disable (verified intact @ v0.135.0)

Upstream remote-control enrolls the app-server at
`wss://chatgpt.com/backend-api/wham/remote/control/server` with ChatGPT OAuth. The fork
neutralizes it at three layers (per `codex/CLAUDE.md` / `AGENTS.override.md` §"Remote
control is force-disabled at THREE layers"). All three confirmed present:

| Layer | Location | What it does |
|---|---|---|
| **L1 — startup target null** | `app-server-transport/src/transport/remote_control/mod.rs:184-189` | `start_remote_control` forces `remote_control_target = None; let _ = initial_enabled; let initial_enabled = false;` after the upstream `state_db_available` guard. `// SANDBOX PATCH` marker present. |
| **L2 — runtime toggle neutralized** | `app-server-transport/src/transport/remote_control/mod.rs:71-93` | `RemoteControlHandle::enable()` ignores the caller and only drives the watch channel **toward `false`**, returning `Disabled`. `// SANDBOX PATCH` marker present. (Upstream v0.130 `set_enabled` was split into `enable()`/`disable()` by v0.135; the patch tracked that split.) |
| **L3 — launcher config** | `codex/codex-rs-overlay/codex-copilot-launcher/src/config.rs:80-84` | Launcher appends `features.remote_control=false` to the args passed to `codex-core`. `// SANDBOX PATCH` marker present. |

Ignore-marker invariant holds: **10** `#[ignore = "patched fork force-disables
remote_control …"]` markers in
`app-server-transport/src/transport/remote_control/tests.rs` (matches the "10 in total as
of US-019" note in CLAUDE.md).

---

## What v131+ added, and WHERE (all present in the v0.135.0 tree)

| New capability | Location | Notes |
|---|---|---|
| **Daemon-managed remote-control** (lifecycle: start/restart/stop/bootstrap/enable-remote-control/disable-remote-control over a Unix control socket) | `app-server-daemon/` crate (`src/lib.rs`, `src/remote_control_client.rs`, `src/backend/`, `src/settings.rs`, `README.md`) | **Unix-only.** Uses `codex-uds` + `libc` flock + pidfile. |
| **Runtime enable/disable/status RPCs** | `app-server/src/request_processors/remote_control_processor.rs` (`enable`/`disable`/`status_read`); protocol types `RemoteControlEnableResponse`, `RemoteControlDisableResponse`, `RemoteControlStatusReadResponse`, `RemoteControlStatusChangedNotification` in `app-server-protocol/src/protocol/v2/` | Methods `remoteControl/enable`, `remoteControl/disable`, `remoteControl/status/read`, notification `remoteControl/status/changed`. Experimental-API surface. |
| **Top-level `codex remote-control` command** | `cli/src/remote_control_cmd.rs` | Thin wrapper over `codex_app_server_daemon::ensure_remote_control_ready()` / `run(Stop)` / `enable_remote_control_on_socket()`. |
| **Registry-backed remote environments** | `state/migrations/0024_remote_control_enrollments.sql` + `state/src/runtime/remote_control.rs` | SQLite `remote_control_enrollments` table keyed `(websocket_url, account_id, app_server_client_name)`, storing `server_id`, `environment_id`, `server_name`. Written only on successful enrollment. |
| **Plain app-server start wires it in** | `app-server/src/lib.rs:702-731`, `AppServerRuntimeOptions::remote_control_enabled` (default `false`, `lib.rs:413`) | Even the plain app-server calls `start_remote_control(...)` — but always through the L1-patched function. |

---

## Conflict assessment (the four investigate points)

### 1. Do the new APIs re-enable or route around the force-disable? — **No.**

The new runtime RPCs funnel through the *same* patched seam:

- `remote_control_processor.rs:22-28` — `enable()` → `handle.enable()` → **L2-neutralized**
  (returns `Disabled`, never wakes the websocket).
- `remote_control_processor.rs:35-43` — `status_read()` reads `handle.status()`, which stays
  `Disabled` because nothing can transition it to `Connecting`/`Connected`.
- `remote_control_processor.rs:30-33` — `disable()` is upstream-unmodified and only ever
  drives toward `false` (harmless).
- The daemon's own client (`app-server-daemon/src/remote_control_client.rs:58-66`) sends a
  `remoteControl/enable` JSON-RPC over the Unix socket → lands on the **same L2-neutralized
  `enable()`**. So even the daemon path cannot enroll.
- Plain app-server start (`app-server/src/lib.rs:718-728`) passes `remote_control_enabled`
  into `start_remote_control`, where **L1** unconditionally forces target `None` /
  `initial_enabled = false`. `remote_control_enabled` defaults to `false` anyway and happy
  never passes `--remote-control`.

Net: the new surface is *reachable but inert*. There is no path to a chatgpt.com
enrollment.

### 2. Do they change the app-server vs app-server-daemon boundary happy-cli relies on? — **No.**

happy-cli's contract is "spawn the plain `app-server` and talk JSON-RPC over a loopback
transport":

- `packages/happy-cli/src/codex/codexAppServerClient.ts:1107` → `['app-server', '--listen', 'stdio://']`
- `…:1113` → sandbox-wrapped stdio: `['app-server', '--listen', 'stdio://']`
- `…:1185` → ws: `['app-server', '--listen', 'ws://127.0.0.1:<port>', '--ws-auth', 'capability-token', '--ws-token-sha256', <hex>]`

The `app-server-daemon` crate is an *additional, parallel* entry point (`codex app-server
daemon …` / `codex remote-control`) for SSH/remote-managed instances. It does not replace,
rename, or gate the plain `app-server --listen` path. happy-cli's spawn argv, discovery
record (`~/.happy/codex-active-<cwdHash>.json`), reattach, and force-restart flows are
untouched by the daemon additions.

### 3. Does happy-cli need any change? — **No.**

- Zero references to the daemon/remote-control surface in `packages/happy-cli/src`
  (grep for `app-server daemon|app-server-daemon|remoteControl|remote_control|remote-control`
  returns only the unrelated Happy Node daemon `happy daemon start`).
- happy-cli *does* initialize with `capabilities: { experimentalApi: true }`
  (`codexAppServerClient.ts:1159-1160`), so the experimental `remoteControl/*` methods are
  *exposed* on its loopback connection — but happy-cli never calls them, and L2 would
  neutralize them if it did. Reachable-but-unused + L2 = no behavioral path.
- The daemon is **Unix-only**: every `app-server-daemon` public entry point calls
  `ensure_supported_platform()` first, which returns
  `Err("codex app-server daemon lifecycle is only supported on Unix platforms")` on
  `cfg(not(unix))` (`app-server-daemon/src/lib.rs:190-248`). codexu's primary dev box is
  Windows, so the daemon path can't even start there.

### 4. Is happy-cli insulated because it uses the plain app-server? — **Yes, structurally.**

The insulation is two-fold and independent:
- **Boundary insulation:** happy uses `app-server --listen`, not `app-server daemon`. The
  daemon surface is opt-in and orthogonal.
- **Behavioral insulation:** even on the plain-app-server connection happy uses, the
  remote-control RPCs are dead-ended by L1+L2.

---

## Leverage — could daemon remote-control improve the codexu daemon integration?

**No — recommend keeping it force-disabled.** Two structural reasons:

1. **It targets OpenAI's proprietary cloud relay.** The daemon's remote-control enrolls at
   `wss://chatgpt.com/backend-api/wham/remote/control/server` with ChatGPT OAuth. Adopting
   it would re-introduce exactly the non-Copilot network path the fork exists to remove
   (it's in the network-audit `ENDPOINT_PATTERNS`), and ChatGPT auth doesn't exist in a
   Copilot-only build.
2. **codexu already has a *better-fit* transport.** Cross-device control in codexu flows
   through Happy's own E2E-encrypted relay (happy-server) with the CLI as the only local
   app-server client. The codex daemon's remote-control would *duplicate and bypass* that
   encrypted layer, not improve it.

The daemon's *lifecycle management* (pidfile-backed idempotent start/restart, idle
handling) is conceptually adjacent to happy-cli's own ws discovery/reattach
(`codex-active-<cwdHash>.json` + lock), but it's Unix-only and bootstrap-coupled to
remote-control, so it is not a useful cross-platform building block for codexu's daemon
either. No adoption recommended.

---

## Recommended fork action

**No code change.** The fork is already correctly insulated. Specifically:

1. **Keep the three-layer disable** (L1 mod.rs:184-189, L2 mod.rs:71-93, L3
   launcher config.rs:80-84) and the 10 ignore markers in `remote_control/tests.rs`.
2. **Rebase-hygiene watch item (the one thing to track):** the v0.135 intake added a
   *new* upstream call site — `app-server/src/request_processors/remote_control_processor.rs`
   — that reaches the force-disabled handle. It's covered *transitively* today (it calls
   `handle.enable()/disable()/status()` rather than re-implementing the websocket connect).
   On future rebases:
   - Re-confirm `remote_control_processor.rs` (and any newly-added `remoteControl/*` RPC or
     enrollment path) still routes through the patched `RemoteControlHandle` rather than a
     new direct `RemoteControlWebsocket::connect()` call.
   - Audit newly-added upstream tests in `remote_control/tests.rs`, the
     `app-server-daemon` crate, and `remote_control_processor` for any that assume runtime
     enable/enrollment works; add `#[ignore = …]` markers per the existing invariant.
     (Current daemon-crate tests are `#[cfg(all(test, unix))]` and exercise the *client
     protocol plumbing against a mock server*, not real enrollment, so they pass under the
     force-disable.)
3. *(Optional)* record this finding in `codex/docs/implementation/patch-surface.md` §15
   rebase notes so the next rebaser knows the daemon + runtime-RPC surface is already
   covered transitively by L1/L2 and needs no new patch — only the routing re-check above.

---

## Evidence index (file:line)

**Fork disable points (verified intact):**
- `external/repos/codex-patched/codex-rs/app-server-transport/src/transport/remote_control/mod.rs:184-189` — L1 force target None / initial_enabled false (SANDBOX PATCH)
- `…/remote_control/mod.rs:71-93` — L2 `enable()` neutralized to drive-toward-false (SANDBOX PATCH)
- `codex/codex-rs-overlay/codex-copilot-launcher/src/config.rs:80-84` — L3 `features.remote_control=false` (SANDBOX PATCH)
- `…/remote_control/tests.rs` — 10× `#[ignore = "patched fork force-disables remote_control …"]`

**New v131+/v135 surface:**
- `external/repos/codex-patched/codex-rs/app-server-daemon/src/lib.rs:190-248` — daemon entry points + Unix-only `ensure_supported_platform()`
- `…/app-server-daemon/src/remote_control_client.rs:27-74` — daemon sends `remoteControl/enable` over Unix socket (hits L2)
- `…/app-server-daemon/README.md:11-15` — "current daemon implementation is Unix-only"
- `…/app-server/src/request_processors/remote_control_processor.rs:22-49` — runtime enable/disable/status_read → patched handle
- `…/app-server/src/lib.rs:702-731` — plain app-server start wires `start_remote_control` (through L1); default `remote_control_enabled=false` at `lib.rs:413`
- `…/cli/src/remote_control_cmd.rs:9-14,77-82,262` — top-level `codex remote-control` → `codex_app_server_daemon::*`
- `…/state/migrations/0024_remote_control_enrollments.sql` — enrollment registry table
- `…/state/src/runtime/remote_control.rs` — registry runtime accessor

**happy-cli integration boundary (insulated):**
- `packages/happy-cli/src/codex/codexAppServerClient.ts:1107,1113,1185` — spawns plain `app-server --listen` (stdio / sandbox-stdio / ws)
- `…/codexAppServerClient.ts:1159-1160` — initialize `capabilities.experimentalApi = true` (RPCs reachable, unused)
- grep `packages/happy-cli/src` for `app-server daemon|app-server-daemon|remoteControl|remote_control|remote-control` → only the unrelated Happy Node daemon (`happy daemon start`)
