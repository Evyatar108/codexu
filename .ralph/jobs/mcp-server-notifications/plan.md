# Plan — `mcp-server-notifications` (Stage A of channels-research.md)

> Bridge rmcp notification handlers + sampling into the codex agent event loop, feature-gated, with minimum upstream-canonical conflict surface.

**Source spec:** `plans/channels-research.md` §6.1 (verified line-by-line against current codex submodule HEAD `516d2cd9`).

**Scope boundary:** Stage A ends at "MCP notifications + sampling reach the agent loop via `tx_event` as new `EventMsg::McpServer*` variants." Stage B (channels envelope, prompt-queue policy, `experimental["codex/channel"]` advertisement, channel-permission UI) is **explicitly out of scope** and gated on a separate operator decision per the research doc §7.

---

## 0 · Preflight survey corrections (do NOT skip)

The research doc was written when codex was at an earlier release. The current submodule (`external/repos/codex-patched`, head `516d2cd9`) has moved several seams. Verified targets:

| Research-doc claim | Verified actual |
|---|---|
| `rmcp-client/src/logging_client_handler.rs:49–135` (7 `on_*` methods + 1 elicitation) | ✅ Same shape. Struct `LoggingClientHandler { client_info, send_elicitation }`. 7 handlers `on_cancelled`/`on_progress`/`on_resource_updated`/`on_resource_list_changed`/`on_tool_list_changed`/`on_prompt_list_changed`/`on_logging_message`. |
| `rmcp-client/src/elicitation_client_service.rs:69–90` | ✅ `Service<RoleClient>::handle_request` match at lines 68–90. Single `CreateElicitationRequest` arm; the wildcard falls through to `LoggingClientHandler` via `handle_request`. |
| `connection_manager.rs:175` carries `tx_event` | ❌ **Actually line 188** in `codex-mcp/src/connection_manager.rs` (constructor `pub async fn new(...)`). Research doc was off by 13 lines. |
| `rmcp_client.rs:398–402` constructor swap | ❌ Two `rmcp_client.rs` files exist. The `ElicitationClientService::new(...)` call is at **`rmcp-client/src/rmcp_client.rs:381`** (inside `RmcpClient::initialize`). The higher-level managed-client wrapper is `codex-mcp/src/rmcp_client.rs` (different file). |
| `Feature` enum at `core/src/session/features.rs` | ❌ **Actually `features/src/lib.rs:77`** — its own crate `codex-features`. |
| `EventMsg` enum location | ✅ `protocol/src/protocol.rs:1157`. |
| rmcp version | ❌ Spawn prompt said v0.135.0. **Actually v0.15.0** per `external/repos/codex-patched/codex-rs/Cargo.toml:352` (rmcp = "0.15.0"). |
| `cargo check --workspace` blocked on 1.95 toolchain | ❌ Stale. `rustup` + `cargo` ARE installed locally. `cargo check --workspace` (~6 min) is the standard Phase 5a gate per `codex/CLAUDE.md` and `AGENTS.md` memory note. Only `cargo build --release` is deferred to CI. |

**Impl member MUST re-grep for these symbols before editing** — upstream HEAD continues to move; lines may have shifted again by impl time. The verified line numbers above are the impl member's starting reference, not absolute truth.

**Additional verification required at impl time** (could not confirm without `cargo doc` / SDK source):

- **rmcp v0.15.0 `ServerRequest` variant name for sampling**: research doc uses `CreateSamplingMessageRequest`; the spec method is `sampling/createMessage`. The actual variant name in rmcp v0.15.0 may be `CreateMessageRequest` (matching MCP spec method name) or `CreateSamplingMessageRequest`. Impl preflight: `cd codex/external/repos/codex-patched/codex-rs && cargo doc -p codex-rmcp-client --no-deps && grep -r "ServerRequest::" rmcp-client/src/` to discover the actual variant set. The plan calls this `ServerRequest::<Sampling>` below; the impl member fills in the verified name in seam B.
- **`ClientResult` variant for sampling reply**: parallel question — likely `ClientResult::CreateMessageResult(CreateMessageResult)` per MCP spec. Verify via same `cargo doc` probe.

---

## 1 · Goal restated (one sentence)

Add an opt-in (feature-gated, **off by default**) bridge that emits MCP server-initiated notifications (7 kinds) and `sampling/createMessage` requests onto the existing codex `tx_event: Sender<Event>` as new typed `EventMsg::McpServerNotification` and `EventMsg::McpSamplingRequest` variants, so downstream consumers (TUI, app-server, agent prompt-injection layer) can react to them — **without** bleeding into Stage B's envelope/prompt-queue policy.

---

## 2 · Overlay-vs-canonical decision per integration point

Per `codex/CLAUDE.md` core engineering tenant 1 (minimize upstream-canonical conflict surface), every integration point was brainstormed with three options: (a) pure overlay crate, (b) overlay + minimal seam in upstream-canonical file, (c) direct inline edit. Decisions:

| # | Integration point | Decision | Why |
|---|---|---|---|
| **A** | Forward 7 notification kinds from `LoggingClientHandler::on_*` | **(b) Overlay + ~25 LoC additive seam** in `rmcp-client/src/logging_client_handler.rs` | The handler struct is `pub(crate)` and is the trait impl that rmcp's `Service::handle_notification` dispatches to. Cannot intercept without either (i) modifying this file, or (ii) defining a parallel `ClientHandler` impl + flipping `LoggingClientHandler` visibility to `pub` (still an upstream edit, plus drift risk when upstream adds new `on_*` methods). Additive append is **rebase-friendlier** — when upstream adds a new `on_foo` handler, the bridge's missing `forward_foo` call surfaces as a compile error caught at the next rebase. Parallel-impl drift would silently fail to forward new kinds. |
| **B** | Bridge `sampling/createMessage` request → `EventMsg::McpSamplingRequest` + await reply | **(b) Overlay + ~40 LoC seam** in `rmcp-client/src/elicitation_client_service.rs` | The `Service<RoleClient>::handle_request` match is the dispatch surface. Sampling MUST add a new match arm (`ServerRequest::<Sampling>`) — there is no other dispatch hook. Same parallel-impl drift argument as A. Logic body (oneshot resolver, EventMsg construction, error mapping) lives in overlay. |
| **C** | Constructor wiring | **(b) ~3 LoC seam** in `rmcp-client/src/rmcp_client.rs::initialize` | Need to plumb `Option<Arc<NotificationBridge>>` from the codex-mcp layer down to `ElicitationClientService::new`. Pure overlay cannot reach this private constructor. |
| **D** | Construct the bridge per-server with `tx_event` + feature flag | **(b) ~25 LoC seam** in `codex-mcp/src/rmcp_client.rs::start_server_task` (line 459) and the `StartServerTaskParams` struct + `AsyncManagedClient::new` (line 136) | `tx_event` is already plumbed here. Add `features` (or just a `bool mcp_server_notifications`) + a `Arc<SamplingRequestManager>` to `StartServerTaskParams`. Bridge construction itself lives in overlay. |
| **E** | Sampling request manager (mirrors `ElicitationRequestManager`) + `resolve_sampling_request` | **(b) ~30 LoC seam** in `codex-mcp/src/connection_manager.rs` + new pub method | Mirrors the elicitation precedent at `codex-mcp/src/elicitation.rs::ElicitationRequestManager` (already the template). The manager struct itself lives in overlay; the field on `McpConnectionManager` and the `resolve_sampling_request` accessor must be in upstream-canonical (consumers call through this manager type). |
| **F** | New `EventMsg::McpServerNotification` + `EventMsg::McpSamplingRequest` + sub-types | **(c) Direct inline edit** to `protocol/src/protocol.rs:1157` (the `EventMsg` enum) — additive ~50 LoC | The enum is the wire format; new variants MUST live in the enum definition itself. **Pure additive — lowest rebase risk** (rebases on enum variant adds merge cleanly via standard line-additive 3-way merge). |
| **G** | New `Feature::McpServerNotifications` variant + registry entry | **(c) Direct inline edit** to `features/src/lib.rs` (enum + registry table around line 717–1200) — ~10 LoC | Same as F — additive to a list. |

**Outcome:**
- 1 new overlay crate (`codex-mcp-notification-bridge`).
- 6 upstream-canonical files touched, **~180 LoC total** of which **~110 LoC is purely additive** (variants/registry/imports), only **~70 LoC** is functional seam code requiring rebase-replant attention.
- All 5 functional seams (A–E) marked `// SANDBOX PATCH:` per CLAUDE.md tenet 1 rule 3.

---

## 3 · Feature flag

**Name:** `Feature::McpServerNotifications` (PascalCase to match enum convention at `features/src/lib.rs:77`).

**Placement in enum:** under the existing "Experimental" group (after `Feature::AuthElicitation` at line ~190).

**Stage:** `Stage::Experimental { name: "mcp-server-notifications", menu_description: "Bridge MCP server notifications and sampling/createMessage into the agent event stream.", announcement: "" }`.

**Registry entry:** add to the `register_feature(...)` table at lines ~717–1200 (look for `Feature::AuthElicitation` precedent). Default off (`enabled_by_default: false`).

**Channels-research.md does NOT pin a name** — research doc only suggests "feature-gated" without specifying the symbol. `Feature::McpServerNotifications` is consistent with naming of adjacent feature flags (`AuthElicitation`, `ToolCallMcpElicitation`, `BackgroundProcessNotification`). Operator-overridable via `~/.codex/config.toml`:
```toml
[features]
mcp_server_notifications = true
```

**Gate placement:** inside `NotificationBridge::forward_*` methods (drop early-return if feature off). NOT at the constructor — constructing the bridge unconditionally lets us flip the flag at runtime without restart, and the per-call check is a single atomic load.

---

## 4 · Overlay crate scaffold — `codex-rs-overlay/codex-mcp-notification-bridge/`

Copy `codex-rs-overlay/codex-copilot/` shape:

```
codex-rs-overlay/codex-mcp-notification-bridge/
├── Cargo.toml         # workspace = "../../external/repos/codex-patched/codex-rs"; name = "codex-mcp-notification-bridge"; lib name = "codex_mcp_notification_bridge"
├── src/
│   ├── lib.rs         # pub mod bridge; pub mod sampling; pub use bridge::NotificationBridge; pub use sampling::SamplingRequestManager;
│   ├── bridge.rs      # ~150 LoC — NotificationBridge struct, 7 forward_* fns, 1 forward_sampling_request fn, feature-gate check, token bucket
│   └── sampling.rs    # ~100 LoC — SamplingRequestManager (mirrors ElicitationRequestManager), make_sender(), resolve()
└── (tests live alongside src as #[cfg(test)] mod tests blocks per repo convention)
```

### 4.1 `bridge.rs` API surface

```rust
pub struct NotificationBridge {
    tx_event: Sender<Event>,
    server_name: Arc<str>,
    feature_enabled: Arc<AtomicBool>,           // shared with FeatureSet so runtime flips work
    rate_limiter: TokenBucket,                  // 100 events/s default, drop with counter
    sampling: Arc<SamplingRequestManager>,
}

impl NotificationBridge {
    pub fn new(
        tx_event: Sender<Event>,
        server_name: Arc<str>,
        feature_enabled: Arc<AtomicBool>,
        sampling: Arc<SamplingRequestManager>,
    ) -> Self { ... }

    pub async fn forward_progress(&self, params: ProgressNotificationParam) { ... }
    pub async fn forward_cancelled(&self, params: CancelledNotificationParam) { ... }
    pub async fn forward_resource_updated(&self, params: ResourceUpdatedNotificationParam) { ... }
    pub async fn forward_resource_list_changed(&self) { ... }
    pub async fn forward_tool_list_changed(&self) { ... }
    pub async fn forward_prompt_list_changed(&self) { ... }
    pub async fn forward_logging_message(&self, params: LoggingMessageNotificationParam) { ... }

    /// Returns a `oneshot::Receiver<CreateMessageResult>` resolved by ConnectionManager::resolve_sampling_request.
    pub async fn forward_sampling_request(
        &self,
        request_id: RequestId,
        params: CreateMessageRequestParams,
    ) -> anyhow::Result<CreateMessageResult> { ... }
}
```

### 4.2 `sampling.rs` API surface

Mirror `codex-mcp/src/elicitation.rs::ElicitationRequestManager` 1:1:

```rust
pub struct SamplingRequestManager {
    requests: Arc<Mutex<HashMap<(String, RequestId), oneshot::Sender<CreateMessageResult>>>>,
}

impl SamplingRequestManager {
    pub fn new() -> Self { ... }
    pub fn register(&self, server: String, id: RequestId) -> oneshot::Receiver<CreateMessageResult> { ... }
    pub async fn resolve(&self, server: &str, id: &RequestId, result: CreateMessageResult) -> Result<()> { ... }
}
```

### 4.3 Backpressure / risk mitigation (from research doc §6.4)

- **Never `await` a full `tx_event`**: use `tx_event.try_send(...)` → if `Full`, drop + `tracing::warn!` + bump a counter. Matches `codex-mcp/src/elicitation.rs:208` (`let _ = tx_event.send(...)` pattern — but elicitation can afford the await because it's request-scoped; notifications are streamed and need non-blocking).
- **Lock-free in handlers**: forward functions take `&self`, do one feature load + one rate-limit check + one channel send. No lock acquisition on `McpConnectionManager`.
- **Rate limit**: per-server `TokenBucket` (100 events/s, configurable later). On drop, bump `mcp_notification_dropped_total{server="..."}` (use existing `tracing` instrumentation; otel metric optional follow-up).

---

## 5 · Upstream-canonical seams (verbatim diff sketches)

> Each seam below is sized + line-anchored. Every change carries a `// SANDBOX PATCH: <invariant-ref>` marker per CLAUDE.md tenet 1 rule 3.

### Seam A — `rmcp-client/src/logging_client_handler.rs` (~25 LoC)

```diff
+ use std::sync::Arc;
+ use codex_mcp_notification_bridge::NotificationBridge;

  #[derive(Clone)]
  pub(crate) struct LoggingClientHandler {
      client_info: ClientInfo,
      send_elicitation: Arc<SendElicitation>,
+     // SANDBOX PATCH: invariant 25 (mcp-server-notifications)
+     bridge: Option<Arc<NotificationBridge>>,
  }

  impl LoggingClientHandler {
-     pub(crate) fn new(client_info: ClientInfo, send_elicitation: SendElicitation) -> Self {
+     pub(crate) fn new(
+         client_info: ClientInfo,
+         send_elicitation: SendElicitation,
+         bridge: Option<Arc<NotificationBridge>>,    // SANDBOX PATCH: invariant 25
+     ) -> Self {
          Self {
              client_info,
              send_elicitation: Arc::new(send_elicitation),
+             bridge,
          }
      }
  }
```

Then in each of the 7 `on_*` methods, append (example for `on_progress`):

```diff
      async fn on_progress(
          &self,
          params: ProgressNotificationParam,
          _context: NotificationContext<RoleClient>,
      ) {
          info!(
              "MCP server progress notification (token: {:?}, progress: {}, total: {:?}, message: {:?})",
              params.progress_token, params.progress, params.total, params.message
          );
+         // SANDBOX PATCH: invariant 25
+         if let Some(bridge) = &self.bridge {
+             bridge.forward_progress(params).await;
+         }
      }
```

`on_resource_list_changed`, `on_tool_list_changed`, `on_prompt_list_changed` take no `params` — the bridge fn signatures must match (already correct in §4.1).

### Seam B — `rmcp-client/src/elicitation_client_service.rs` (~40 LoC)

```diff
+ use codex_mcp_notification_bridge::NotificationBridge;

  #[derive(Clone)]
  pub(crate) struct ElicitationClientService {
      handler: LoggingClientHandler,
      send_elicitation: Arc<SendElicitation>,
      pause_state: ElicitationPauseState,
+     // SANDBOX PATCH: invariant 25
+     bridge: Option<Arc<NotificationBridge>>,
  }

  impl ElicitationClientService {
      pub(crate) fn new(
          client_info: ClientInfo,
          send_elicitation: SendElicitation,
          pause_state: ElicitationPauseState,
+         bridge: Option<Arc<NotificationBridge>>,    // SANDBOX PATCH: invariant 25
      ) -> Self {
          let send_elicitation = Arc::new(send_elicitation);
          Self {
              handler: LoggingClientHandler::new(
                  client_info,
                  clone_send_elicitation(Arc::clone(&send_elicitation)),
+                 bridge.clone(),                     // SANDBOX PATCH: invariant 25
              ),
              send_elicitation,
              pause_state,
+             bridge,
          }
      }
```

In `Service<RoleClient>::handle_request` match (line 74–90), add a new arm:

```diff
      match request {
          ServerRequest::CreateElicitationRequest(request) => {
              let response = self.create_elicitation(request.params, context).await?;
              let result = elicitation_response_result(response)?;
              Ok(ClientResult::CustomResult(result))
          }
+         // SANDBOX PATCH: invariant 25 — sampling/createMessage bridge
+         ServerRequest::<SAMPLING-VARIANT>(request) => {
+             let Some(bridge) = &self.bridge else {
+                 return Err(rmcp::ErrorData::internal_error(
+                     "sampling/createMessage requires mcp_server_notifications feature".to_string(),
+                     None,
+                 ));
+             };
+             let result = bridge
+                 .forward_sampling_request(context.id, request.params)
+                 .await
+                 .map_err(|err| rmcp::ErrorData::internal_error(err.to_string(), None))?;
+             Ok(ClientResult::CreateMessageResult(result))
+         }
          request => {
              <LoggingClientHandler as Service<RoleClient>>::handle_request(
                  &self.handler,
                  request,
                  context,
              )
              .await
          }
      }
```

**Impl preflight (mandatory)**: discover actual rmcp v0.15.0 names for `ServerRequest::<SAMPLING-VARIANT>` and `ClientResult::CreateMessageResult` variant. Run `cargo doc -p codex-rmcp-client --no-deps && grep -rn "ServerRequest::" rmcp-client/src/ && grep -rn "ClientResult::" rmcp-client/src/`. If rmcp v0.15.0 has not landed sampling typed variants and the request flows through `ServerRequest::CustomRequest`, fall back to dispatching by method name string (`request.method == "sampling/createMessage"`) — record this in seam B's `// SANDBOX PATCH:` comment.

### Seam C — `rmcp-client/src/rmcp_client.rs::initialize` (~3 LoC)

```diff
      pub async fn initialize(
          &self,
          params: InitializeRequestParams,
          timeout: Option<Duration>,
          send_elicitation: SendElicitation,
+         bridge: Option<Arc<NotificationBridge>>,    // SANDBOX PATCH: invariant 25
      ) -> Result<InitializeResult> {
          let client_service = ElicitationClientService::new(
              params.clone(),
              send_elicitation,
              self.elicitation_pause_state.clone(),
+             bridge,
          );
```

### Seam D — `codex-mcp/src/rmcp_client.rs::start_server_task` + `StartServerTaskParams` + `AsyncManagedClient::new` (~25 LoC)

Plumb `feature_enabled: Arc<AtomicBool>` and `sampling_requests: Arc<SamplingRequestManager>` through `AsyncManagedClient::new` (line 136) → `StartServerTaskParams` (line 549) → `start_server_task` (line 459) → `client.initialize(params, startup_timeout, send_elicitation, bridge)` (line 497).

```diff
  async fn start_server_task(
      server_name: String,
      client: Arc<RmcpClient>,
      params: StartServerTaskParams,
  ) -> Result<ManagedClient, StartupOutcomeError> {
      let StartServerTaskParams {
          startup_timeout,
          tool_timeout,
          tool_filter,
          tx_event,
          elicitation_requests,
          codex_apps_tools_cache_context,
          client_elicitation_capability,
+         mcp_notifications_enabled,         // SANDBOX PATCH: invariant 25
+         sampling_requests,                  // SANDBOX PATCH: invariant 25
      } = params;
      ...
      let send_elicitation = elicitation_requests.make_sender(server_name.clone(), tx_event.clone());
+     // SANDBOX PATCH: invariant 25
+     let bridge = Some(Arc::new(NotificationBridge::new(
+         tx_event.clone(),
+         Arc::from(server_name.as_str()),
+         mcp_notifications_enabled,
+         sampling_requests,
+     )));
      let initialize_result = client
-         .initialize(params, startup_timeout, send_elicitation)
+         .initialize(params, startup_timeout, send_elicitation, bridge)
          .await
          .map_err(StartupOutcomeError::from)?;
```

### Seam E — `codex-mcp/src/connection_manager.rs` (~30 LoC)

Add to `McpConnectionManager` struct (line 73 area):
```diff
  pub struct McpConnectionManager {
      ...
      elicitation_requests: ElicitationRequestManager,
+     // SANDBOX PATCH: invariant 25
+     sampling_requests: Arc<SamplingRequestManager>,
+     mcp_notifications_enabled: Arc<AtomicBool>,
  }
```

Add constructor arg + field init in `pub async fn new(...)` (line 182).

Add accessor:
```rust
// SANDBOX PATCH: invariant 25
pub async fn resolve_sampling_request(
    &self,
    server_name: &str,
    request_id: &RequestId,
    result: CreateMessageResult,
) -> Result<()> {
    self.sampling_requests.resolve(server_name, request_id, result).await
}
```

Wire `mcp_notifications_enabled` + `sampling_requests.clone()` into `AsyncManagedClient::new(...)` call at line 259.

### Seam F — `protocol/src/protocol.rs` (~50 LoC, additive)

```diff
  pub enum EventMsg {
      ...
      McpToolCallBegin(McpToolCallBeginEvent),
      McpToolCallEnd(McpToolCallEndEvent),
+
+     McpServerNotification(McpServerNotificationEvent),
+
+     McpSamplingRequest(McpSamplingRequestEvent),
      ...
  }
```

New event structs (placement: alongside `McpToolCallBeginEvent` at line ~2221):

```rust
#[derive(Debug, Clone, Deserialize, Serialize, JsonSchema, TS, PartialEq)]
pub struct McpServerNotificationEvent {
    pub server_name: String,
    pub kind: McpNotificationKind,
    pub params: serde_json::Value,    // typed by-kind in v2; v1 keeps json for forward-compat
}

#[derive(Debug, Clone, Deserialize, Serialize, JsonSchema, TS, PartialEq)]
#[serde(rename_all = "snake_case", tag = "type")]
pub enum McpNotificationKind {
    Progress,
    Cancelled,
    ResourceUpdated,
    ResourceListChanged,
    ToolListChanged,
    PromptListChanged,
    LoggingMessage,
}

#[derive(Debug, Clone, Deserialize, Serialize, JsonSchema, TS, PartialEq)]
pub struct McpSamplingRequestEvent {
    pub server_name: String,
    pub request_id: ProtocolRequestId,
    pub params: serde_json::Value,    // pending app-server-protocol v2 typing
}
```

**Note (consumer compat)**: per AGENTS.md tenet "unknown EventMsg variants must skip rather than hard-fail", verify `serde(other)` / fallback handling in happy-cli + TUI EventMsg decoders before merging. If hard-fail behavior is found, file a follow-up task; the bridge stays default-off so unknown-variant breakage is opt-in only.

### Seam G — `features/src/lib.rs` (~10 LoC, additive)

Add `McpServerNotifications` variant + registry call. See §3 above for exact metadata.

---

## 6 · Test strategy

### 6.1 Overlay unit tests (`codex-rs-overlay/codex-mcp-notification-bridge/src/bridge.rs` + `sampling.rs`)

- Per-kind round-trip: construct `NotificationBridge`, call `forward_<kind>(...)`, assert exactly one `Event { msg: EventMsg::McpServerNotification { kind: <Kind>, ... } }` arrives on `rx_event`.
- Feature-off behavior: bridge with `feature_enabled = AtomicBool::new(false)` → `forward_*` drops, channel stays empty.
- Backpressure: bounded `tx_event` of size 1, fill it, call `forward_progress` → no panic, no `await` hang, drop counter increments.
- Sampling round-trip: `forward_sampling_request(...)` registers a oneshot, `SamplingRequestManager::resolve(...)` fires it, awaiter returns the `CreateMessageResult`.
- Sampling failure: `resolve` called twice → second call returns `Err`; bridge times out (use `tokio::time::timeout` in test).

### 6.2 Invariant tests (`codex-rs-overlay/codex-invariant-tests/tests/mcp_server_notifications.rs`)

Follow the existing pattern in `codex-rs-overlay/codex-invariant-tests/tests/*.rs`:

1. **Feature default off**: build a default `FeatureSet`, assert `!features.enabled(Feature::McpServerNotifications)`.
2. **Variant present**: assert `format!("{:?}", EventMsg::McpServerNotification(...))` compiles (compile-time assertion).
3. **Feature registered**: assert `Feature::McpServerNotifications` appears in the registry iterator with `Stage::Experimental { .. }`.
4. **Bridge is no-op when feature off**: construct bridge with feature flag off, exercise all 7 `forward_*` + sampling, assert `rx_event.try_recv()` returns `Err(TryRecvError::Empty)`.

### 6.3 End-to-end via `connection_manager_tests.rs` (additive only)

Add new tests next to the existing 962-line `#[tokio::test]` block:

- `mcp_progress_notification_reaches_event_sink`: spin up the existing mock rmcp server (precedent: `connection_manager_tests.rs:236-270` uses `manager.make_sender("server", tx_event)`). Have the mock emit `notifications/progress`. With feature on, assert one `EventMsg::McpServerNotification { kind: Progress, ... }` arrives.
- Repeat for one each of the other 6 notification kinds.
- `mcp_sampling_request_round_trip`: mock server sends `sampling/createMessage`; test consumer pulls `EventMsg::McpSamplingRequest`, calls `manager.resolve_sampling_request(...)` with a fake `CreateMessageResult`, asserts the server receives the reply.

### 6.4 Network audit

Run `bash scripts/audit_network_calls.sh` — should pass (no new endpoints, no new IPs, no new sockets). If audit complains about new patterns, file a follow-up to add the bridge source files to the known-safe allowlist.

### 6.5 App-server JSON fixture

If `just write-app-server-schema` exists per AGENTS.override.md (it does — see "Development Workflow" section), run it to refresh the EventMsg JSON schema fixtures so v2 TS bindings get the new variants.

---

## 7 · Verification plan

| Step | Command | Where | Expected duration |
|---|---|---|---|
| 1. Workspace parse | `cd codex/external/repos/codex-patched/codex-rs && cargo metadata --no-deps --format-version 1` | submodule root | <30s. Confirms overlay member entry is reachable. |
| 2. Typecheck | `cd codex/external/repos/codex-patched/codex-rs && cargo check --workspace` | submodule root | ~6 min. **Standard local Phase 5a gate** per `codex/CLAUDE.md`. |
| 3. Per-crate tests | `cd codex/external/repos/codex-patched/codex-rs && cargo test -p codex-rmcp-client -p codex-mcp -p codex-features -p codex-protocol -p codex-mcp-notification-bridge -p codex-invariant-tests` | submodule root | ~10–15 min. |
| 4. Linter | `cd codex/external/repos/codex-patched/codex-rs && just fix -p codex-rmcp-client -p codex-mcp -p codex-protocol -p codex-features -p codex-mcp-notification-bridge -p codex-invariant-tests` | submodule root | ~5 min. **Per-crate scoping per AGENTS.override.md** ("Prefer scoping with `-p` to avoid slow workspace-wide Clippy builds"). |
| 5. Format | `cd codex/external/repos/codex-patched/codex-rs && just fmt` | submodule root | <1 min. Per AGENTS.override.md mandatory after Rust changes. |
| 6. Bazel lock | `just bazel-lock-update && just bazel-lock-check` from `codex/external/repos/codex-patched` | submodule root | ~5 min if Cargo.toml changed (it will — workspace gets a new member). Include `MODULE.bazel.lock` update in same commit per AGENTS.override.md. |
| 7. Bazel build files | Add new crate's `BUILD.bazel` if `include_str!`/`include_bytes!` used (we don't plan to). | overlay crate | n/a unless build-time file reads added. |
| 8. Network audit | `bash codex/scripts/audit_network_calls.sh` | repo root | ~1 min. |
| 9. Full workspace tests | `cargo test --workspace` | submodule root | **Deferred to CI** (`.github/workflows/invariant-check.yml`) per AGENTS.override.md "cargo test --workspace is for CI, not local iteration agents" (90+ min local, frequent unrelated rebase-debt failures). |
| 10. Release build | `cargo build --release -p codex-cli --bin codex-core` | n/a | **Deferred to `/publish-sandbox-patch`** per CLAUDE.md (fat-LTO link >2h local). |

Steps 1–8 are local gates for the impl member. Steps 9–10 are CI's job.

---

## 8 · Patch-surface bookkeeping

Per CLAUDE.md tenet 1 + 3, the impl member MUST add to `codex/docs/implementation/patch-surface.md`:

### §14 invariant rows (one per seam, plus a feature row)

| # | Invariant | Enforcing test/guard |
|---|---|---|
| 25 | MCP server notifications bridge is feature-gated and off by default | `codex-rs-overlay/codex-invariant-tests/tests/mcp_server_notifications.rs::feature_default_off` |
| 26 | `LoggingClientHandler::new` accepts an optional `NotificationBridge` (the seam exists) | `codex-rs-overlay/codex-invariant-tests/tests/mcp_server_notifications.rs::handler_constructor_signature` (uses fn-type compile assertion) |
| 27 | `ElicitationClientService::handle_request` dispatches sampling to the bridge (no fallthrough to logging-only) | overlay bridge unit test `sampling_round_trip` |
| 28 | `EventMsg::McpServerNotification` + `EventMsg::McpSamplingRequest` variants are present and serializable | per-kind round-trip in overlay unit tests + invariant compile-time assertion |
| 29 | Sampling reply path uses `SamplingRequestManager` (not auto-accept, not auto-reject) | overlay unit test `sampling_failure_when_unresolved` |

### §15 rebase-replant recipes (one entry per functional seam A–E)

For each seam, document:
1. The upstream-canonical file + the exact function signature being patched.
2. The expected upstream conflict shape on rebase (e.g., "if upstream adds a new `on_resource_subscribed` handler, the bridge has no `forward_resource_subscribed` → compile error; add a matching `forward_*` method + bridge call").
3. The re-application checklist: where the `// SANDBOX PATCH: invariant N` markers live, and the order to re-apply (notification handler last — depends on bridge type + sampling manager type).

Additive seams F + G need only a brief §15 note: "additive enum variants merge cleanly; if upstream renames the enum or changes derive macros, re-port variants manually."

---

## 9 · Stage A scope boundary — explicit non-goals

Anything in this list is **deferred to Stage B** (`codex-channels`) per research doc §6.2 + §7:

- ❌ No `experimental["codex/channel"]` capability key advertisement during MCP initialize.
- ❌ No `notifications/codex/channel` or `notifications/codex/channel/permission` methods.
- ❌ No prompt-queue policy ("inject as next prompt", "buffer during LLM call", priority semantics).
- ❌ No channel-permission UI or per-server allowlist for sampling.
- ❌ No happy-app or TUI rendering shim for channel messages.
- ❌ No agent-comms cross-task integration (Stage A unblocks it; Stage B uses it).

If the impl member finds themselves writing code that mentions "channel", "prompt queue", "priority", or "permission gating beyond feature-flag" — they have bled into Stage B. Stop and report `kind=question`.

---

## 10 · Bundle vs split recommendation

**Recommendation: SINGLE bundled PR.**

Reasons:
1. **Tight constructor coupling.** Seams C, D, E plumb the same `bridge: Option<Arc<NotificationBridge>>` through the same call chain. Splitting notifications from sampling means rewriting seam D twice (first with just `mcp_notifications_enabled`, then again to add `sampling_requests`).
2. **Shared overlay crate.** Both notifications and sampling live in the same overlay crate; splitting forces an awkward two-phase crate land.
3. **Shared feature flag.** Both ride `Feature::McpServerNotifications` — splitting forces either two feature flags (over-engineered) or one flag gating partial functionality.
4. **Estimated LoC fits one ralph job.** ~610 LoC total (~300 overlay, ~180 seams, ~80 docs, ~50 invariant tests) is within one impl member's envelope (~3.25 d engineering per research doc estimate).
5. **End-to-end testability.** Splitting leaves intermediate state where some MCP server-initiated messages reach the agent loop and others don't — confusing for downstream consumers and dangerous for staging deployments.

**If the operator insists on splitting**: PR 1 = overlay crate + Feature flag + protocol variants + invariant tests + seams F + G + landing seam E with `sampling_requests` accepted but ignored (no Service arm). PR 2 = seams A, B, C, D adding the actual handler/dispatch wiring. PR 1 is dead code on its own. Don't recommend.

---

## 11 · Estimated LoC delta + per-file budget

| Location | LoC | Type |
|---|---|---|
| `codex-rs-overlay/codex-mcp-notification-bridge/` (new crate) | ~300 | new file(s) |
| `external/repos/codex-patched/codex-rs/Cargo.toml` (workspace.members + path entry) | ~4 | additive |
| `external/repos/codex-patched/codex-rs/rmcp-client/Cargo.toml` (new dep on overlay crate) | ~2 | additive |
| `external/repos/codex-patched/codex-rs/codex-mcp/Cargo.toml` (new dep on overlay crate) | ~2 | additive |
| `rmcp-client/src/logging_client_handler.rs` | ~25 | **seam A** (additive append + 1 field) |
| `rmcp-client/src/elicitation_client_service.rs` | ~40 | **seam B** (additive arm + 1 field + 1 constructor arg) |
| `rmcp-client/src/rmcp_client.rs` | ~3 | **seam C** (1 arg + 1 line) |
| `codex-mcp/src/rmcp_client.rs` | ~25 | **seam D** (2 fields in StartServerTaskParams + 5 wiring lines + bridge construction) |
| `codex-mcp/src/connection_manager.rs` | ~30 | **seam E** (2 fields + 1 constructor arg + 1 accessor) |
| `protocol/src/protocol.rs` | ~50 | **seam F** (2 enum variants + 3 structs + 1 sub-enum) |
| `features/src/lib.rs` | ~10 | **seam G** (1 enum variant + 1 registry call) |
| `codex-rs-overlay/codex-invariant-tests/tests/mcp_server_notifications.rs` (new test file) | ~80 | new file |
| `codex-mcp/src/connection_manager_tests.rs` | ~150 | additive #[tokio::test] fns |
| `codex/docs/implementation/patch-surface.md` | ~80 | §14 + §15 entries |
| `external/repos/codex-patched/MODULE.bazel.lock` | machine-generated | regenerated by `just bazel-lock-update` |
| **Total impl LoC** | **~800 LoC** (300 overlay + 180 seams + 230 tests + 80 docs + machine-gen + boilerplate) | |

**Of which:**
- Net-new files: ~700 LoC (overlay crate + new invariant test + new tests in connection_manager_tests.rs + patch-surface entries).
- Upstream-canonical surface: ~180 LoC across 6 files, of which ~110 LoC is additive (variants, registry, struct fields) and **~70 LoC is functional seam** that will show up in future rebase 3-way merges.

For reference: per CLAUDE.md the last upstream rebase had 588 commits / 26 conflicts. The 5 functional seams here (~70 LoC) add roughly **1–2 expected conflicts per rebase** if upstream touches `logging_client_handler.rs` or `elicitation_client_service.rs` — both of which were quiescent in v0.123 → v0.130 per `regression-history.md` skim.

---

## 12 · Open questions for impl member to verify before commit

(Not blockers — items to confirm at impl time so the seam diff is correct.)

1. **rmcp v0.15.0 sampling variant name** — see §0 + Seam B preflight.
2. **EventMsg unknown-variant handling** in happy-cli + TUI consumers — see Seam F note. File follow-up if hard-fail found.
3. **`features` field plumbing into `McpConnectionManager::new`** — does the caller (search for `McpConnectionManager::new(` in `core/src/`) already have `Arc<AtomicBool>` access to per-feature flags, or does it have only `FeatureSet`? If only `FeatureSet`, expose `feature_enabled_handle(Feature) -> Arc<AtomicBool>` on `FeatureSet`. The impl can choose: thread the whole `FeatureSet` (more flexible, larger seam) or just the bool (smaller seam, less reusable).
4. **`SamplingRequestManager` placement** — overlay crate (this plan's recommendation), or alongside `ElicitationRequestManager` in `codex-mcp/src/elicitation.rs`? Overlay is rebase-safer; co-location is more discoverable. **Recommendation: overlay** to keep the upstream surface minimal.
5. **Token-bucket parameters** — start with 100 events/s (research doc §6.4 risk 3). If overlay tests are flaky on slow CI, bump to 200/s. Configurable later via overlay-crate constant; no need to expose to user config in Stage A.
6. **`AsyncManagedClient::new` arg explosion** — already `#[allow(clippy::too_many_arguments)]`. Two more args (`mcp_notifications_enabled`, `sampling_requests`) keep it ugly. Consider a small `McpBridgeContext { feature_enabled, sampling_requests }` newtype to keep the signature readable. Recommendation: do it; ~5 extra LoC, much clearer.

---

## 13 · Per-integration-point decision summary (for the kind=done report)

| Integration point | Decision | Seam size |
|---|---|---|
| A. Notification handlers (7 kinds) | overlay+seam in `logging_client_handler.rs` | ~25 LoC |
| B. Sampling request dispatch | overlay+seam in `elicitation_client_service.rs` | ~40 LoC |
| C. `RmcpClient::initialize` plumbing | seam in `rmcp_client.rs` (rmcp-client crate) | ~3 LoC |
| D. Per-server bridge construction | seam in `rmcp_client.rs` (codex-mcp crate) | ~25 LoC |
| E. Sampling request manager + resolver | overlay+seam in `connection_manager.rs` | ~30 LoC |
| F. EventMsg variants | additive inline edit in `protocol/src/protocol.rs` | ~50 LoC |
| G. Feature flag | additive inline edit in `features/src/lib.rs` | ~10 LoC |
| **Cargo feature name** | `Feature::McpServerNotifications` (default off, `Stage::Experimental`) | n/a |
| **Bundle vs split** | **Bundle** — single PR | n/a |
| **Estimated total LoC** | ~800 (300 overlay + 180 seams + 230 tests + 80 docs + boilerplate) | n/a |

---

## 14 · Reference artifacts

- Source spec: `plans/channels-research.md` §6.1, §6.4 (risk areas), §7 (Stage A vs B split).
- Operator tenants: `codex/CLAUDE.md` §"Core engineering tenants" 1–3.
- Overlay precedent: `codex/codex-rs-overlay/codex-copilot/` (lib-only crate, no fixtures).
- Sampling precedent (request-id oneshot pattern): `codex/external/repos/codex-patched/codex-rs/codex-mcp/src/elicitation.rs:103-247` (`ElicitationRequestManager::make_sender`).
- Connection manager test scaffolding: `codex/external/repos/codex-patched/codex-rs/codex-mcp/src/connection_manager_tests.rs:236-1025`.
- Invariant test precedent: `codex/codex-rs-overlay/codex-invariant-tests/tests/`.
- Patch-surface §14/§15 format: `codex/docs/implementation/patch-surface.md`.
