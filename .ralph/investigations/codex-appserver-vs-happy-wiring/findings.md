# Is `codex-app-server` in the codex ↔ Happy connection path?

**Investigation date:** 2026-07-08
**Scope:** Read-only source investigation of `codexu` (`codex/` submodule + `packages/`).
No files modified except this findings doc. No git write commands run.

---

## 1. Direct answer

**Is codex-app-server in the codex↔Happy path? NO** — in the current native
raw-codex `/remote on` path, Happy is reached by the `codex-happy` Rust overlay
acting as a **client of a loopback happy-server**; the `codex-app-server`
**JSON-RPC server binary is never spawned or connected**. The overlay only *taps*
codex's own **in-process** app-server *library* event stream (the standard TUI↔core
boundary), which is a different thing from the standalone `codex-app-server` server
binary.

> One-caveat: the *separate, being-replaced* happy-cli integration path DOES spawn
> `codex app-server` over stdio (JSON-RPC). If someone means that path, the binary
> is involved there — but that is exactly the path the native overlay exists to
> eliminate ("no happy-cli process at runtime"). See §5.

---

## 2. The actual current path (native raw-codex `/remote on`)

Ordered flow, trigger → client crate → transport → server. Every hop cited.

**Hop 0 — Trigger / gate.**
`/remote on` (or auto-attach at startup, or `-c features.remote_session=true`) is
gated by `Feature::RemoteSession`.
- At startup with creds present: `tui/src/app.rs:1034` `if config.features.enabled(Feature::RemoteSession)` → `tui/src/app.rs:1038` `codex_happy::attach::maybe_attach(...)`.
- Mid-session toggle: `/remote on` emits `AppEvent::SetRemoteSession { enabled }`, handled at `tui/src/app/event_dispatch.rs:150` → `apply_remote_session_toggle` (`tui/src/app/event_dispatch.rs:53`) → `codex_happy::attach::maybe_attach_reporting(...)` (`tui/src/app/event_dispatch.rs:79`).

**Hop 1 — Event SOURCE = codex's IN-PROCESS app-server (a library, not the server binary).**
The TUI *already* runs an in-process app-server client as its normal boundary to
codex-core — this exists with or without Happy:
- `tui/src/lib.rs:245-260` `start_embedded_app_server(...) -> InProcessAppServerClient` → `InProcessAppServerClient::start` (`tui/src/lib.rs:257`).
- `tui/src/app_server_session.rs:247` `matches!(&self.client, AppServerClient::InProcess(_))`.

**Hop 2 — The Happy overlay TAPS that existing stream (no new server).**
- `maybe_attach` is handed `app_server.request_handle()` for inbound control (`tui/src/app.rs:1053`).
- It returns an `UnboundedSender<AppServerEvent>` stored as `happy_tap` (`tui/src/app.rs:597`).
- In the TUI event loop every `AppServerEvent` is cloned into the tap **before** local handling: `tui/src/app.rs:1264` `if let Some(tap) = app.happy_tap.as_ref() { let _ = tap.send(event.clone()); }`.
- The overlay's own docstring states the design: "bridge codex's **in-process** app-server to a native Happy session, with **no happy-cli process at runtime**" (`codex/codex-rs-overlay/codex-happy/src/attach.rs:1-3`).

**Hop 3 — Client crate maps events → Happy envelopes.**
`codex_happy::attach::maybe_attach` (`codex/codex-rs-overlay/codex-happy/src/attach.rs`)
does all creds/session/connect on a background task and maps app-server events to
Happy session envelopes via `mapping.rs`
(`codex/codex-rs-overlay/codex-happy/src/mapping.rs:1-3`: "codex in-process
app-server events -> Happy session-protocol envelopes").

**Hop 4 — Transport + SERVER = loopback happy-server (NOT codex-app-server).**
- HTTP session create: `POST http://127.0.0.1:<tunnelPort>/v1/sessions`, **no auth header**, against the "tunnel listener" (`codex/codex-rs-overlay/codex-happy/src/api.rs:1-6`; `SESSION_PATH = "/v1/sessions"` at `api.rs:34`).
- Live sync: Socket.IO `/v1/updates` session client (`codex/codex-rs-overlay/codex-happy/src/lib.rs:18` module doc; `rust_socketio` dep in `Cargo.toml`).
- `tunnelPort` is read from `~/.happy/machine.json` (per crate + fork docs; auth/machine discovery in `auth.rs`).
- Crate purpose, verbatim: "port the Happy end-to-end-encryption + protocol client from `packages/happy-cli` so a raw `codex` session can speak the Happy wire protocol directly to **happy-server**, with no `happy-cli` process at runtime" (`codex/codex-rs-overlay/codex-happy/src/lib.rs:5-9`).

So: **`/remote on` → tap TUI's in-process AppServerEvent stream → `codex-happy` → loopback happy-server (HTTP + Socket.IO, E2EE).** No `codex-app-server` binary anywhere in that chain.

---

## 3. App-server involvement evidence (the crux greps)

### 3a. Zero Happy references *inside* the `app-server` server crate

Command (run from `codex/external/repos/codex-patched/codex-rs`):
```
git grep -in "happy\|remote_session\|remote_on\|codex_happy\|autoconnect" -- app-server/
```
Output — the ONLY matches are plugin-list **test fixtures** where a variable is
named `remote_only` (substring false-positive of `remote_on`):
```
app-server/tests/suite/v2/plugin_list.rs:223:    let mut remote_only = global_installed_body["plugins"][0].clone();
app-server/tests/suite/v2/plugin_list.rs:224:    remote_only["id"] = serde_json::json!("plugins~Plugin_1111...");
app-server/tests/suite/v2/plugin_list.rs:225:    remote_only["name"] = serde_json::json!("remote-only");
app-server/tests/suite/v2/plugin_list.rs:226:    remote_only["release"]["display_name"] = serde_json::json!("Remote Only");
app-server/tests/suite/v2/plugin_list.rs:230:        .push(remote_only);
```
There is **no** reference to Happy, `codex_happy`, `remote_session`, `remote_on`
(the feature), or autoconnect anywhere in the `app-server` server crate. The edge
is genuinely absent.

### 3b. `codex-happy` does NOT depend on the `codex-app-server` server crate

Command (from `codex/`):
```
git grep -in "codex-app-server\b\|app_server::\|spawn.*app-server" -- codex-rs-overlay/codex-happy/
```
Output — only the two *client/protocol* crates, never the server crate:
```
codex-rs-overlay/codex-happy/Cargo.toml:40:codex-app-server-client   = { workspace = true }
codex-rs-overlay/codex-happy/Cargo.toml:41:codex-app-server-protocol = { workspace = true }
```
`codex-happy` imports only `codex_app_server_client::{AppServerEvent, AppServerRequestHandle, ...}`
and `codex_app_server_protocol::{ServerNotification, ThreadItem, Turn, ...}` (see
`attach.rs:35-43`, `mapping.rs:26-36`). Those are the **event/type** surface, not the
server binary.

### 3c. The three crates are distinct — only the *library* is transitively linked

Package names (`codex/external/repos/codex-patched/codex-rs/`):
- `app-server/Cargo.toml:2` `name = "codex-app-server"` — with `[[bin]] codex-app-server` (`app-server/Cargo.toml:7-8`) **and** `[lib] codex_app_server` (`app-server/Cargo.toml:15-16`).
- `app-server-client/Cargo.toml:2` `name = "codex-app-server-client"`.
- `app-server-protocol/Cargo.toml:2` `name = "codex-app-server-protocol"`.

`codex-app-server-client` "wraps `codex_app_server::in_process` behind a single async
API" (`app-server-client/src/lib.rs:3`) and calls
`codex_app_server::in_process::start(...)` (`app-server-client/src/lib.rs:483`). It
therefore takes a Cargo edge on the app-server **library** crate
(`app-server-client/Cargo.toml:16` `codex-app-server = { workspace = true }`).

**Interpretation:** the app-server *library* crate is linked into the TUI process
(that's how the TUI talks to core, Happy or not), and `codex-happy` rides that
in-process event bus. The `codex-app-server` **binary / standalone JSON-RPC server**
(stdio/socket transport for IDE clients) is **not** started or connected on the
native Happy path.

---

## 4. Default on/off + gating

**`Feature::RemoteSession` is `default_enabled: false`** — opt-in only.
- Spec: `codex/external/repos/codex-patched/codex-rs/features/src/lib.rs:1107-1114`
  (`id: Feature::RemoteSession`, `key: "remote_session"`, `Stage::Experimental{...}`, `default_enabled: false`).
- Doc/enum: `features/src/lib.rs:176-177` — enable via `-c features.remote_session=true`, `--enable remote_session`, or `/remote on`.
- Related gates, all also `default_enabled: false`: `RemoteAutoAttach` (`features/src/lib.rs:1135`), `RemoteSubagentSessions` (`features/src/lib.rs:1149`), `LoopbackInject` (`features/src/lib.rs:1120`). When off, `happy_tap` is `None` and the event-loop fanout at `app.rs:1264` is a no-op → byte-identical vanilla codex.

---

## 5. Nuance / caveats

**(a) The app-server binary IS in the *happy-cli* integration path — the one being replaced.**
`packages/happy-cli/src/codex/codexAppServerClient.ts:2-13` states happy-cli "drives
Codex via the v2 JSON-RPC protocol (`codex app-server`) ... JSON-RPC 2.0 over stdio"
and spawns it via `cross-spawn` (`codexAppServerClient.ts:21`). So in the *happy-cli*
world, happy-cli spawns the `codex app-server` **binary** as a child, speaks JSON-RPC
to it, and bridges to the happy-server session plane. This is exactly the
"`codex app-server` child spawned by `happy codex`" the overlay guards against with the
`HAPPY_CURRENT_SESSION_ID` idempotency env (`codex-happy/src/attach.rs:66-70`). The
native `codex-happy` overlay exists to eliminate this hop ("no happy-cli process at
runtime", `lib.rs:6-9`). **Bottom line:** the app-server binary is a real Happy-adjacent
surface *only* on the legacy/alternative happy-cli path, never on the native
raw-codex `/remote on` path the operator asked about.

**(b) The app-server library's `in_process` module is genuinely linked — but it is
the internal event bus, not "the connection to Happy."** It is present in the process
whether or not Happy is enabled; Happy just subscribes a second consumer to it.
Calling it "codex-app-server in the path" would conflate the in-process library with
the standalone JSON-RPC server binary — the precise conflation the fork docs warn
about.

**(c) Correction to the pre-investigation hypothesis about happy-cli's role.**
The task framing guessed happy-cli is a pure *client* (no server deps). Actually
`packages/happy-cli/package.json` shows `happy-server: workspace:*` + `fastify` +
`socket.io-client` — happy-cli **embeds/hosts the per-daemon happy-server** (the
`fastify` tunnel listener the overlay POSTs to at `127.0.0.1:<tunnelPort>`) *and* is a
Socket.IO **client** of the session plane. This matches the fork's "per-daemon embedded
happy-server, no central server" architecture. It does **not** change the crux answer:
happy-cli is never the `codex-app-server`; it is the happy-server host/client.

---

## 6. Server-role confirmation

- **What codex's client talks to:** a loopback **happy-server** at
  `http://127.0.0.1:<tunnelPort>` — HTTP `/v1/sessions` (`api.rs:1-6,34`) + Socket.IO
  `/v1/updates` (`lib.rs:18`). Not chatgpt.com, not an external server, not
  codex-app-server.
- **happy-cli relationship:** hosts the per-daemon happy-server (`fastify` +
  `happy-server: workspace:*`) and is a `socket.io-client` of it
  (`packages/happy-cli/package.json`). It is a happy-server host+client, distinct from
  the codex app-server.

---

## Appendix — key file:line index

| Claim | Evidence |
|---|---|
| codex-happy = Happy client, no happy-cli at runtime | `codex/codex-rs-overlay/codex-happy/src/lib.rs:5-9` |
| Connects to loopback happy-server `127.0.0.1:<tunnelPort>` `/v1/sessions` | `codex-happy/src/api.rs:1-6`, `api.rs:34` |
| Socket.IO `/v1/updates` session client | `codex-happy/src/lib.rs:18`; `codex-happy/Cargo.toml` (`rust_socketio`) |
| Overlay taps codex's **in-process** app-server | `codex-happy/src/attach.rs:1-3` |
| codex-happy deps = client + protocol, NOT server crate | `codex-happy/Cargo.toml:40-41` |
| TUI runs its own in-process app-server (standard boundary) | `tui/src/lib.rs:245-260`; `tui/src/app_server_session.rs:247` |
| `happy_tap` fanout of every AppServerEvent | `tui/src/app.rs:597`, `app.rs:1264` |
| Overlay gets request handle for inbound control | `tui/src/app.rs:1053` |
| RemoteSession gate at startup | `tui/src/app.rs:1034-1038` |
| `/remote on` → `SetRemoteSession` → toggle → attach | `tui/src/app/event_dispatch.rs:150,53,79` |
| CRUX: zero Happy refs in app-server crate (only `remote_only` fixture) | `git grep ... -- app-server/` → `app-server/tests/suite/v2/plugin_list.rs:223-230` |
| app-server-client wraps `codex_app_server::in_process` | `app-server-client/src/lib.rs:3,483` |
| app-server-client → codex-app-server **library** edge | `app-server-client/Cargo.toml:16` |
| app-server crate = bin + lib named codex-app-server | `app-server/Cargo.toml:2,7-8,15-16` |
| RemoteSession default OFF | `features/src/lib.rs:1107-1114` (`default_enabled: false`) |
| happy-cli spawns `codex app-server` binary (legacy path) | `packages/happy-cli/src/codex/codexAppServerClient.ts:2-13,21` |
| happy-cli embeds happy-server + is socket.io client | `packages/happy-cli/package.json` (`happy-server`, `fastify`, `socket.io-client`) |
