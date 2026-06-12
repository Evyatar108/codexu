# MCP notification/subscription support for crews-mail-via-codex-injection

## Verdict

**No MCP protocol change is required.** The MCP spec already has standard server-to-client notifications, Codex's rmcp client already receives and bridges the relevant standard notifications, and the remaining work is consumer-side Codex plumbing plus a producer-side crews MCP server. The missing pieces are **implementation**, not **protocol**.

The only caveat is **resource subscriptions**: if the design wants to use `notifications/resources/updated` in the spec-native way, Codex must add client-side `resources/subscribe` plumbing before crews starts pushing mailbox-change notifications for a mailbox URI. If the team wants the smallest possible implementation with no subscription work, `notifications/message` (logging) is the cleanest already-supported alternative, but it is semantically weaker than resource updates.

## 1. MCP standard notification surface (spec revision: 2025-06-18)

**Revision cited:** all spec citations below are from the official MCP spec revision in the URL path: `https://modelcontextprotocol.io/specification/2025-06-18/...`.

### Standard notification methods relevant here

From the base protocol, MCP has only three message classes: **requests**, **responses**, and **notifications**; notifications are one-way JSON-RPC messages with no `id`.[^basic-overview]

Server-to-client notifications in the standard surface relevant to this design:

1. **Resources**
   - `notifications/resources/updated`[^resources]
   - `notifications/resources/list_changed`[^resources]
2. **Prompts**
   - `notifications/prompts/list_changed`[^prompts]
3. **Tools**
   - `notifications/tools/list_changed`[^tools]
4. **Logging**
   - `notifications/message`[^logging]
5. **Progress**
   - `notifications/progress` (either direction, tied to a request's `progressToken`)[^progress]
6. **Cancellation**
   - `notifications/cancelled` (either direction, for an in-progress request)[^cancel]

Related but **not** server-to-client for this problem:

1. `notifications/initialized` is client-to-server lifecycle signaling.[^lifecycle]
2. `notifications/roots/list_changed` exists, but it is a **client-to-server** notification because roots are a client capability.[^roots]

### Capability negotiation for resource updates

The resources spec says servers that support resources **must** declare the `resources` capability, and the sub-capabilities are:

- `subscribe`: whether the client can subscribe to notifications for individual resources
- `listChanged`: whether the server will emit resource-list change notifications[^resources]

The spec-native flow for per-resource updates is:

1. server declares `resources.subscribe = true`
2. client sends `resources/subscribe { uri }`
3. server later sends `notifications/resources/updated { uri }` for that subscribed resource[^resources]

So for a mailbox-changed design built on `resources/updated`, the clean standards-based answer is **yes, the client should subscribe to a specific URI first**.

### Is there any formal MCP "channel" beyond notifications + transport?

No. The base protocol defines only JSON-RPC **requests**, **responses**, and **notifications**.[^basic-overview] The transports page defines only **stdio** and **Streamable HTTP** as standard transports, and says SSE is just a transport mechanism by which the server may send JSON-RPC requests/notifications on a stream.[^transports]

So there is **no separate mailbox/channel/pubsub protocol primitive** to invent or extend here. A mailbox-change wake must ride one of:

1. an existing standard notification method
2. a custom JSON-RPC notification method
3. a request/response flow

all over the existing transport.

## 2. Codex rmcp-client support

## What Codex already receives

Codex's rmcp client already wires standard server notifications into typed callbacks:

- `on_cancelled` -> forwards cancellation notifications[^logging-handler]
- `on_progress` -> forwards progress notifications[^logging-handler]
- `on_resource_updated` -> forwards `notifications/resources/updated`[^logging-handler]
- `on_resource_list_changed` -> forwards `notifications/resources/list_changed`[^logging-handler]
- `on_tool_list_changed` -> forwards `notifications/tools/list_changed`[^logging-handler]
- `on_prompt_list_changed` -> forwards `notifications/prompts/list_changed`[^logging-handler]
- `on_logging_message` -> forwards `notifications/message`[^logging-handler]

`ElicitationClientService` also handles the server-initiated `sampling/createMessage` request path and forwards it through the same bridge mechanism, while delegating all notifications to `LoggingClientHandler`.[^elicitation-service]

The overlay bridge converts those rmcp callbacks into Codex protocol events:

- `EventMsg::McpServerNotification(McpServerNotificationEvent { server_name, kind, params })`
- `EventMsg::McpSamplingRequest(McpSamplingRequestEvent { ... })`[^bridge][^protocol-types]

The supported notification kinds are explicitly enumerated as:

- `Progress`
- `Cancelled`
- `ResourceUpdated`
- `ResourceListChanged`
- `ToolListChanged`
- `PromptListChanged`
- `LoggingMessage`[^protocol-types]

The feature is present but **off by default** behind `Feature::McpServerNotifications`.[^feature-flag] Session MCP refresh/startup plumbs that flag into `McpConnectionManager`, which in turn constructs the `NotificationBridge` and passes it into `RmcpClient::initialize(...)`.[^session-mcp][^connection-manager][^rmcp-init]

## What the native turn path currently does with those events

The brainstorm's "drop site" is **basically correct, but more precisely**:

- Codex **does receive** and type these notifications/events.
- In the native session turn path, `core/src/session/turn.rs::realtime_text_for_event(...)` maps both `EventMsg::McpServerNotification(_)` and `EventMsg::McpSamplingRequest(_)` to `None`.[^turn-drop]

So the events are **not dropped at the transport/rmcp boundary**; they are dropped at the point where the native turn path decides whether an event becomes user-visible realtime text. I did not find any other `core/src` consumer of `McpServerNotification` or `McpSamplingRequest`; the only `core/src` references are the feature plumbing and this `realtime_text_for_event` sink.[^turn-drop][^session-mcp]

## Does Codex support resource subscriptions specifically?

**Not as a first-class client API today.**

The public `RmcpClient` surface includes:

- `list_tools`
- `list_resources`
- `list_resource_templates`
- `read_resource`
- `call_tool`
- `send_custom_notification`
- `send_custom_request`[^rmcp-client-api]

There is **no typed `resources/subscribe` or `resources/unsubscribe` helper** in the client wrapper, and repository search only found `resources/subscribe` / `resources/unsubscribe` on the **server** side (`mcp-server/src/message_processor.rs`), not in current Codex client-side plumbing.[^subscribe-search]

That said, `RmcpClient` does expose a generic `send_custom_request(method, params)` escape hatch.[^rmcp-client-api] So adding a standards-compliant `resources/subscribe` call looks like **client-side plumbing work**, not an MCP or rmcp protocol limitation.

## Does Codex support generic server custom notifications?

Not in the current integration.

The rmcp client wrapper has outbound helpers for:

- `send_custom_notification(...)`
- `send_custom_request(...)`[^rmcp-client-api]

But I found **no server->client custom-notification forwarding path** in `LoggingClientHandler` or `ElicitationClientService`; those only bridge the standard typed notifications above plus `sampling/createMessage`.[^logging-handler][^elicitation-service]

So a **custom server notification method** is JSON-RPC-valid in principle, but **current Codex integration does not already surface it**. That makes a custom-notification design strictly worse than using one of the standard notification methods that are already bridged.

## 3. Crews producer feasibility

`plugins/crews/.codex-plugin/plugin.json` currently declares only hooks; it has **no `mcpServers` entry**.[^crews-plugin] So today, raw Codex does **not** connect to a crews MCP server at all.

That means a crews-mail-via-MCP design needs a producer-side change before anything else:

1. crews must expose an MCP server
2. Codex must be configured to connect to it

After that, there are two viable spec-native producer strategies:

### Option A: resource-based mailbox URI (best semantics)

Use a mailbox resource URI such as `crews://mailbox/<member>` or similar:

1. crews declares `resources: { subscribe: true }`
2. Codex subscribes via `resources/subscribe`
3. crews emits `notifications/resources/updated { uri }` when mailbox content changes

This is the cleanest fit if the intent is "this mailbox resource changed; go re-read it."

### Option B: logging notification (smallest implementation)

Use `notifications/message` with the `logging` capability only.[^logging]

This has an important advantage: **Codex already forwards logging notifications today**.[^logging-handler] No subscription request is needed, and crews does not need to model mailboxes as resources.

Trade-offs:

- **Pros:** least Codex work; existing bridged standard method
- **Cons:** semantically it is "a log entry happened," not "resource X changed"; no URI; no subscribe/unsubscribe contract; no natural read-after-notify semantics

### Can crews just emit unsolicited `notifications/resources/updated` without subscribe?

Probably **Codex would still surface it** once the MCP connection exists, because the current bridge path does not enforce local subscription state before forwarding `ResourceUpdatedNotificationParam`.[^logging-handler]

But I would treat that as **implementation luck, not the contract**. The spec-native answer is still to declare `resources.subscribe = true` and have the client subscribe first.[^resources]

## 4. Recommendation

### Final answer

**No MCP protocol change is required.**

If the design wants the most semantically correct standards-based shape, implement:

1. a crews MCP server
2. a mailbox resource URI
3. `resources.subscribe = true` on the crews server
4. Codex-side `resources/subscribe` plumbing
5. Codex consumer plumbing that turns `EventMsg::McpServerNotification(ResourceUpdated)` into a queued next-turn prompt

That last consumer step already has an in-tree precedent: background process completion injects a synthetic next-turn user message by calling `input_queue.queue_response_items_for_next_turn(...)` and then `request_pending_work_wake()`.[^input-queue][^async-watcher]

If the team wants the **smallest first ship** and is willing to accept weaker semantics, the cleanest current-spec alternative is:

- **use `notifications/message` first**

because Codex already receives and bridges it, and it needs no subscription work. The downside is that it treats "mailbox changed" as a log event rather than as a typed resource update.

## Sources

[^basic-overview]: MCP basic overview (2025-06-18), https://modelcontextprotocol.io/specification/2025-06-18/basic
[^lifecycle]: MCP lifecycle (2025-06-18), https://modelcontextprotocol.io/specification/2025-06-18/basic/lifecycle
[^transports]: MCP transports (2025-06-18), https://modelcontextprotocol.io/specification/2025-06-18/basic/transports
[^resources]: MCP resources (2025-06-18), https://modelcontextprotocol.io/specification/2025-06-18/server/resources
[^prompts]: MCP prompts (2025-06-18), https://modelcontextprotocol.io/specification/2025-06-18/server/prompts
[^tools]: MCP tools (2025-06-18), https://modelcontextprotocol.io/specification/2025-06-18/server/tools
[^logging]: MCP logging (2025-06-18), https://modelcontextprotocol.io/specification/2025-06-18/server/utilities/logging
[^progress]: MCP progress (2025-06-18), https://modelcontextprotocol.io/specification/2025-06-18/basic/utilities/progress
[^cancel]: MCP cancellation (2025-06-18), https://modelcontextprotocol.io/specification/2025-06-18/basic/utilities/cancellation
[^roots]: MCP roots (2025-06-18), https://modelcontextprotocol.io/specification/2025-06-18/client/roots
[^logging-handler]: `codex/external/repos/codex-patched/codex-rs/rmcp-client/src/logging_client_handler.rs:24-29,32-42,58-177`
[^elicitation-service]: `codex/external/repos/codex-patched/codex-rs/rmcp-client/src/elicitation_client_service.rs:28-34,37-55,75-125`
[^bridge]: `codex/codex-rs-overlay/codex-mcp-notification-bridge/src/bridge.rs:1-5,47-63,109-224`
[^protocol-types]: `codex/external/repos/codex-patched/codex-rs/protocol/src/protocol.rs:1242-1257,2275-2305`
[^feature-flag]: `codex/external/repos/codex-patched/codex-rs/features/src/lib.rs:1161-1170`
[^session-mcp]: `codex/external/repos/codex-patched/codex-rs/core/src/session/mcp.rs:345-364`
[^connection-manager]: `codex/external/repos/codex-patched/codex-rs/codex-mcp/src/connection_manager.rs:194-289,374-404`
[^rmcp-init]: `codex/external/repos/codex-patched/codex-rs/codex-mcp/src/rmcp_client.rs:470-519`; `codex/external/repos/codex-patched/codex-rs/rmcp-client/src/rmcp_client.rs:373-388`
[^turn-drop]: `codex/external/repos/codex-patched/codex-rs/core/src/session/turn.rs:1291-1371`
[^rmcp-client-api]: `codex/external/repos/codex-patched/codex-rs/rmcp-client/src/rmcp_client.rs:439-663`
[^subscribe-search]: `codex/external/repos/codex-patched/codex-rs/mcp-server/src/message_processor.rs` (search hit for `resources/subscribe` / `resources/unsubscribe`), contrasted with `rmcp-client/src/rmcp_client.rs:439-663` which exposes no typed subscribe API
[^crews-plugin]: `ai-developer-toolkit/plugins/crews/.codex-plugin/plugin.json:1-19`
[^input-queue]: `codex/external/repos/codex-patched/codex-rs/core/src/session/input_queue.rs:82-88`
[^async-watcher]: `codex/external/repos/codex-patched/codex-rs/core/src/unified_exec/async_watcher.rs:166-189`
