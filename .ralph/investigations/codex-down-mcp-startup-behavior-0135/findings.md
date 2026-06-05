# Investigation — codex 0.135 down-MCP startup behavior (noise + latency)

**Status:** READ-ONLY diagnosis complete. **HOLD for operator review** — no code/config changed.
**Date:** 2026-06-05
**Task:** `codex-down-mcp-startup-behavior-0135`

## The question

Why does codex 0.135 (gim-home/codex Copilot fork) react to an UNREACHABLE configured
MCP server more *loudly* (ERROR log) + *slower* (~4.6s, single-sample) than 0.125, and
is there a knob to tolerate a down MCP gracefully?

Configured server: `codexu/.codex/config.toml` →
`[mcp_servers.paper] url = "http://127.0.0.1:29979/mcp"` (Paper Design MCP; up only when
that desktop app runs; git-tracked, added 2026-04-13 in commit `3b85f69b`).

---

## TL;DR

1. **The ERROR is emitted by the `rmcp` dependency crate, not codex code.** When the
   `initialize` POST to a down server fails, the rmcp streamable-HTTP transport worker logs
   `tracing::error!("worker quit with fatal: {error}, when {context}")` at
   `rmcp-0.15.0/src/transport/worker.rs:128`. codex's default `codex exec` stderr filter is
   `error` (all targets), so it prints.

2. **There is NO rmcp version delta between codex 0.125 and 0.135** — both pin
   `rmcp = "0.15.0"` (verified in upstream `Cargo.toml` at tags `rust-v0.125.0` and
   `rust-v0.135.0`, and in the local submodule `Cargo.toml:359` / `Cargo.lock:11220`). So the
   loud ERROR is **not** a 0.125→0.135 codex regression. The most likely explanations for the
   perceived change are config-presence/timing and single-sample LLM latency variance (see
   §3). The ERROR would be a real regression only versus a *pre-rmcp-0.15* build (≤ rmcp 0.14,
   i.e. codex < 0.125), which the operator may have run earlier.

3. **No retry/backoff fires on the down-at-startup path.** The `initialize` POST is a single
   attempt; on connection-refused it returns fatal immediately. rmcp's `ExponentialBackoff`
   retry policy governs **only** SSE auto-reconnect *after* a successful init, so it never
   engages for a server that is down at connect time.

4. **A down non-required server does inject a small, bounded, one-time blocking wait** into
   the first turn's tool list (`list_all_tools` → `listed_tools` → `client().await`), because
   non-codex-apps StreamableHTTP servers carry no startup snapshot. For `127.0.0.1` with
   nothing listening this is fast (connection-refused is near-instant on Windows loopback), so
   the measured 4.6s is dominated by LLM variance. **Worst case** (a host that *drops* packets
   rather than refusing) the first turn blocks up to `startup_timeout_sec` (**default 30s**).

5. **Knobs exist but there is no global "tolerate down MCP" / "optional / lazy-connect" flag.**
   Per-server: `enabled` (default true), `required` (default false), `startup_timeout_sec` /
   `startup_timeout_ms`, `tool_timeout_sec`. Noise can be silenced via `RUST_LOG`.

6. **Recommended low-conflict fix:** move the personal, usually-down Paper server out of the
   SHARED git-tracked `codexu/.codex/config.toml` (which codex merges via the "repo" config
   layer for *every* invocation in the repo, incl. ralph's `codex exec`) into the operator's
   personal user-layer `~/.codex/config.toml`; or keep it in-repo with `enabled = false` +
   a small `startup_timeout_sec`. Zero code, zero upstream-conflict surface (tenet #1).

---

## 1. MECHANISM (file:line)

All paths relative to `codex/external/repos/codex-patched/codex-rs/` unless noted. The TUI and
the `codex exec` non-interactive path share the **same** core session-init + connection-manager
code; there is no exec-specific MCP-init divergence.

### 1a. Eager connect to ALL enabled servers at session init

- `core/src/session/session.rs:1156` — session init calls `McpConnectionManager::new(...)` and
  `.await`s it. The `.await` is only the async constructor; it does **not** block on connect.
- `codex-mcp/src/connection_manager.rs:234-324` — `new()` iterates every **enabled** server
  (`.filter(|(_, server)| server.enabled())`, line 236) and, per server,
  `join_set.spawn(async move { … async_managed_client.client().await … })` (line 294-295) —
  i.e. it eagerly drives a connect future for each configured+enabled server.
- `connection_manager.rs:338-360` — a detached `tokio::spawn` joins all connect tasks to emit
  the `McpStartupComplete` summary, then `new()` returns at line 360. **Session init itself
  does not await connect completion.**
- `core/src/session/session.rs:1194-1205` — the only place init blocks on connect is
  `required_startup_failures(&required_mcp_servers)`, and **only when `required_mcp_servers` is
  non-empty**. Paper is not `required`, so init does not wait on it.

### 1b. Per-turn tool list DOES block on the connect future

- `core/src/session/turn.rs:1031-1036` — every turn builds the tool list via
  `mcp_connection_manager.list_all_tools().await`.
- `connection_manager.rs:444-481` — `list_all_tools` calls `managed_client.listed_tools().await`
  per server.
- `codex-mcp/src/rmcp_client.rs:259-321` — `AsyncManagedClient::listed_tools`:
  - `startup_snapshot_while_initializing()` (line 312) returns a cached snapshot **only if one
    exists AND startup is not yet complete**. Startup snapshots are loaded **only** for the
    codex-apps server (`rmcp_client.rs:160` + `connection_manager.rs:249-256`; the cache context
    is `Some` only when `server_name == CODEX_APPS_MCP_SERVER_NAME`). **Paper has no snapshot.**
  - So for Paper it falls to `self.client().await` (line 315) — **awaiting the shared connect
    future to completion.** On error it returns `self.startup_snapshot.clone()` = `None` (line
    317) → the server contributes no tools.
- The connect future is a `Shared` future (`rmcp_client.rs:128, 220`), so once it resolves
  (failed) the result is cached: the **first** turn pays the connect cost; later turns get the
  cached `Err` immediately. For one-shot `codex exec` (typically one model turn) that is one
  payment.

### 1c. The connect → handshake → the rmcp ERROR

- `rmcp_client.rs:175-208` — the connect future runs `make_rmcp_client(...)` then
  `start_server_task(...)`.
- `rmcp_client.rs:637-663` (`make_rmcp_client`, StreamableHttp arm) →
  `RmcpClient::new_streamable_http_client(...)` builds the transport in `ClientState::Connecting`
  (`rmcp-client/src/rmcp_client.rs:340-371`) — no network yet.
- `rmcp_client.rs:189-192` — startup timeout = `config.startup_timeout_sec` **or**
  `DEFAULT_STARTUP_TIMEOUT` (`rmcp_client.rs:77` = **30s**).
- `rmcp_client.rs:517-520` — `start_server_task` calls
  `client.initialize(params, startup_timeout, …)`.
- `rmcp-client/src/rmcp_client.rs:857-865` — `connect_pending_transport` runs
  `service::serve_client(client_service, transport)` wrapped in `time::timeout(startup_timeout, …)`.
  This drives the rmcp transport worker, which sends the `initialize` POST.
- `rmcp-client/src/http_client_adapter.rs:77-129` — `post_message` issues the POST with
  `timeout_ms: None` (relies on reqwest defaults; connection-refused returns immediately anyway).
- **In the rmcp crate** (`D:\.cargo\registry\src\…\rmcp-0.15.0\`):
  - `src/transport/streamable_http_client.rs:300-324` — the `initialize` POST; on `Err(err)` it
    returns `WorkerQuitReason::fatal(StreamableHttpError::TransportChannelClosed, format!("{:?}", err))`.
    `TransportChannelClosed`'s `Display` is `"Transport channel closed"` (`:49-50`); the context
    string is the reqwest error (`http/request failed … http://127.0.0.1:29979/mcp`).
  - `src/transport/worker.rs:127-128` — the `Fatal` arm logs
    `tracing::error!("worker quit with fatal: {error}, when {context}")`. **This is the exact
    observed line.** It is unconditional and lives in the dependency, not codex.

### 1d. Why it prints by default, and the retry that does NOT fire

- `exec/src/lib.rs:157` — `EXEC_DEFAULT_LOG_FILTER = "error,opentelemetry_sdk=off,opentelemetry_otlp=off"`.
- `exec/src/lib.rs:224-230` — `exec_stderr_env_filter()` = `RUST_LOG` if set, else the default
  filter, else `"error"`. With no `RUST_LOG`, the global `error` level lets the rmcp worker
  ERROR through to stderr (`lib.rs:280-283`).
- **No startup retry/backoff:** `streamable_http_client.rs:300-324` makes a single `initialize`
  POST and returns fatal on error. The default `retry_config = ExponentialBackoff::default()`
  (`streamable_http_client.rs:768`; `max_times: None`, `base_duration: 1000ms` at
  `client_side_sse.rs:50-77`) is attached only to the **SSE auto-reconnect stream**, which
  requires a successful init first (`streamable_http_client.rs:377-417, 472-489`). A down
  server never reaches it.

---

## 2. 0.125 → 0.135 DELTA

**rmcp is identical across the two releases — both pin `rmcp = "0.15.0"`.** Evidence:

- Upstream `openai/codex` `codex-rs/Cargo.toml` at `rust-v0.125.0`:
  `rmcp = { version = "0.15.0", default-features = false }`.
- Upstream at `rust-v0.135.0`: `rmcp = { version = "0.15.0", default-features = false }`.
- Local submodule `codex-rs/Cargo.toml:359` and `Cargo.lock:11220-11221` (rmcp 0.15.0,
  checksum `1bef41eb…`).
- rmcp bump history (local submodule `git log -L` on the version line): `0.14 → 0.15` landed in
  `bd3ce9819 "Bump rmcp to 0.15 (#11539)"`, which is **at or before** upstream `rust-v0.125.0`.
  So between 0.125 and 0.135 rmcp never moved.

**Consequence:** the loud ERROR (`rmcp/.../worker.rs:128`) and the eager-connect / per-turn
blocking are byte-for-byte the same in 0.125 and 0.135. The "louder in 0.135" premise is not
explained by an rmcp bump or (any evidence of) a codex MCP-init change between those tags.

Most plausible explanations for the *perceived* change, in order:

1. **Config presence / timing.** Paper was added to the shared config on 2026-04-13
   (`3b85f69b`). If the operator's "quiet 0.125" experience predates that (or predates an env
   where cwd was inside codexu), 0.125 simply never connected to Paper → no error. After Paper
   landed and the fork moved to 0.130/0.135, every in-repo invocation now connects → ERROR.
2. **Single-sample LLM latency variance.** The measured 29.6s (codexu, Paper down) vs 25.0s
   (clean dir, no MCP) is one sample each; "pong" turn latency is dominated by the model
   round-trip, which routinely jitters ±several seconds. The 4.6s is within that noise band.
3. **Pre-0.15 baseline.** If the operator's earlier "quiet" build was actually codex < 0.125
   (rmcp ≤ 0.14), the worker-level ERROR may have been absent/quieter there. (Not verified
   against rmcp 0.14 source; flagged as the one scenario that would make this a genuine
   regression, and it pre-dates 0.125.)

There IS a real (small, bounded) latency mechanism — the first-turn `client().await` block in
§1b — but for `127.0.0.1` connection-refused it is well under a second; it only becomes
multi-second/`startup_timeout`-bounded if the host *drops* packets or is a remote/down host.

---

## 3. KNOBS (and the absence of a "tolerate down MCP" flag)

Per-server keys (schema in `config/src/mcp_types.rs`):

| Key | Default | Effect | Source |
|---|---|---|---|
| `enabled` | `true` | `false` → server skipped entirely; never connected, no error, no latency | `mcp_types.rs:138-139`; filtered at `connection_manager.rs:236` |
| `required` | `false` | `true` → session init blocks and **fails** if the server can't start; do NOT set for Paper | `mcp_types.rs:143`; `session.rs:1194-1205` |
| `startup_timeout_sec` / `startup_timeout_ms` | 30s | caps the handshake/connect wait → bounds worst-case first-turn block | `mcp_types.rs:159, 242-244`; `rmcp_client.rs:77, 189-192` |
| `tool_timeout_sec` | (per build) | per tool-call timeout (not startup) | `mcp_types.rs:163` |

**There is no per-server `optional` / `lazy` / `connect_on_first_use` flag and no global
"tolerate unreachable MCP" switch.** The only "don't connect" lever is `enabled = false`.
`required = false` (already the case) prevents a *hard failure*, but not the connect attempt,
the ERROR, or the first-turn block.

**Noise-only knob — `RUST_LOG`:** because the ERROR is just a `tracing::error!` on target
`rmcp::transport::worker`, it can be filtered without touching codex:

```
RUST_LOG="error,rmcp::transport::worker=off,opentelemetry_sdk=off,opentelemetry_otlp=off"
```

This keeps codex's normal ERROR output but drops the rmcp worker line. It suppresses the
**noise only** — not the (small) first-turn latency. Trade-off: it hides rmcp worker errors
globally (including for legitimately-configured servers), so prefer config placement (§5).

---

## 4. WHY `codexu/.codex/config.toml` is read, and why `-c mcp_servers={}` didn't work

codex builds config from layered sources (`config/src/loader/mod.rs:90-100`), later overrides
earlier:

```
admin → system → user (${CODEX_HOME}/config.toml) → profile → cwd → tree → repo → runtime (-c / --config)
```

- **`repo` layer** = `$(git rev-parse --show-toplevel)/.codex/config.toml`, and **`tree` layer**
  = `./.codex/config.toml` walking up parents (`loader/mod.rs:98-99`). Both are "loaded but
  disabled when the directory is untrusted." codexu is a trusted dir, so
  `codexu/.codex/config.toml` is merged for **any** codex invocation with cwd inside codexu —
  including ralph-orchestration's `codex exec` review/research lens.
- **Why `-c mcp_servers={}` didn't suppress it:** `-c` is the `runtime` layer (last), but layer
  merging is a **deep table merge**, not a replace. Supplying an empty `mcp_servers` table does
  not delete the `mcp_servers.paper` sub-table contributed by the `repo` layer. To disable Paper
  via `-c` you must target the leaf:
  ```
  codex exec -c mcp_servers.paper.enabled=false …
  ```
  (sets `enabled=false` on the merged sub-table → server skipped at `connection_manager.rs:236`).

---

## 5. RECOMMENDED FIX (low-conflict, per codex/CLAUDE.md tenet #1)

### Primary — config placement (zero code, zero upstream-conflict). Recommended.

A personal tool that is up only when a desktop app is running does **not** belong in the SHARED,
git-tracked `codexu/.codex/config.toml` (the `repo` layer applies to every contributor and every
agent `codex exec` in the repo). Options, best first:

- **(A) Move Paper to the user layer** `~/.codex/config.toml` (`${CODEX_HOME}/config.toml`).
  Personal, untracked, only affects the operator's machine. Remove the `[mcp_servers.paper]`
  block from `codexu/.codex/config.toml`. Even on the operator's machine, when Paper is down the
  ERROR + first-turn touch still occur, so combine with `startup_timeout_sec` (below).
- **(B) Keep it documented in-repo but default-off:** in `codexu/.codex/config.toml` set
  ```toml
  [mcp_servers.paper]
  url = "http://127.0.0.1:29979/mcp"
  enabled = false          # flip on (or override in ~/.codex/config.toml) when Paper app is running
  startup_timeout_sec = 2  # bound the worst case if ever enabled-and-down
  ```
  Default-off means no contributor/agent invocation connects → no noise, no latency. The
  operator enables it locally (user-layer override or `-c mcp_servers.paper.enabled=true`) when
  the Paper app is up.

Either way, add `startup_timeout_sec` (e.g. `2`) so an enabled-but-unreachable host (esp. a
packet-dropping one) cannot block the first turn for the 30s default.

### Secondary — environment `RUST_LOG` (zero code; noise-only)

For ralph's `codex exec` wrapper, export
`RUST_LOG="error,rmcp::transport::worker=off,opentelemetry_sdk=off,opentelemetry_otlp=off"`.
Silences the rmcp worker ERROR while preserving codex's normal errors. Hides the signal
globally, so use only if config placement isn't sufficient.

### Code options (only if a code change is explicitly wanted) — and why NOT, by default

- **Downgrading the ERROR:** the log originates in the rmcp dependency
  (`rmcp-0.15.0/.../worker.rs:128`), not codex — there is no codex seam to lower its level. The
  only low-conflict code lever is to have the **overlay** launcher
  (`codex-rs-overlay/codex-copilot-launcher/`) inject a default `RUST_LOG`/tracing directive that
  appends `rmcp::transport::worker=off` to the exec filter unless the user sets `RUST_LOG`. This
  is overlay-only (zero upstream-conflict, tenet 1.i) but hides rmcp worker errors globally;
  prefer config placement.
- **Bounding the startup connect:** already configurable via `startup_timeout_sec` — no patch
  needed.
- **Making eager-connect lazy / snapshot non-required servers:** would require editing
  upstream-canonical `connection_manager.rs::list_all_tools` / `rmcp_client.rs::listed_tools`
  (high rebase-conflict surface, against tenet #1; upstream likely intends eager behavior).
  **Not recommended.**

---

## 6. Config-placement guidance (explicit answer to the sub-question)

**A personal, usually-down tool like Paper should NOT live in the git-tracked shared
`codexu/.codex/config.toml`.** That file is merged via codex's `repo` config layer for every
invocation in the repo (every contributor, every ralph `codex exec`), so it forces a connect
attempt — and the rmcp ERROR + first-turn touch — on everyone whenever the Paper app is down.

Put it in the **user layer** `~/.codex/config.toml` (personal, untracked), or keep an in-repo
entry as documentation with `enabled = false` (default-off) + a small `startup_timeout_sec`,
and enable it locally only when the desktop app is running. codex has no
`.codex/config.local.toml`-style per-repo untracked override convention; the user layer is the
correct home for machine-personal MCP servers.

---

## Appendix — verification commands

- rmcp version (both releases): upstream `codex-rs/Cargo.toml` @ `rust-v0.125.0` and
  `rust-v0.135.0` → `rmcp = "0.15.0"`; local `Cargo.toml:359`, `Cargo.lock:11220`.
- rmcp ERROR source: `D:\.cargo\registry\src\…\rmcp-0.15.0\src\transport\worker.rs:128` and
  `…\streamable_http_client.rs:300-324, 49-50, 768`, `…\common\client_side_sse.rs:50-77`.
- codex MCP init: `codex-mcp/src/connection_manager.rs:234-360, 444-481`;
  `codex-mcp/src/rmcp_client.rs:77, 160, 189-192, 259-321, 517-520`;
  `rmcp-client/src/rmcp_client.rs:340-371, 857-865`;
  `rmcp-client/src/http_client_adapter.rs:77-129`.
- session wiring: `core/src/session/session.rs:1156-1205`; `core/src/session/turn.rs:1031-1036`.
- exec log filter: `exec/src/lib.rs:157, 224-230, 280-283`.
- config knobs: `config/src/mcp_types.rs:138-139, 143, 159, 163, 242-244`.
- config layering: `config/src/loader/mod.rs:90-100`.
- Paper config: `codexu/.codex/config.toml`; added `3b85f69b` (2026-04-13).

### Optional follow-up to confirm the latency claim empirically (operator)
Run `codex exec` ~5× in codexu with Paper down, ~5× with Paper `enabled=false`, compare medians
(not single samples). To attribute time precisely, run once with
`RUST_LOG=info codex exec …` and inspect the `session_init.mcp_manager_init` /
`list_tools_for_server` trace spans (`connection_manager.rs:443`, `session.rs:1176`).
