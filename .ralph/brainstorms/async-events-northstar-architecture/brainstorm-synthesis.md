Lenses: ran=[codex-feasibility, devils-advocate]; skipped=[copilot] (Partial mode — Copilot CLI lens was flaky on the sibling brainstorm and the operator authorized proceeding without it.)

# Async Events Northstar Architecture — Brainstorm Synthesis

## Foundation premise

D-002 ("durable mailbox + channel wake") is SELECTED and NOT RE-LITIGATED here. It establishes:

- **Mailbox = source of truth** for inter-agent messages (filesystem, durable, crash-recoverable)
- **Channel notifications = "you have mail" wake signals** (MCP `resource_updated` through the just-shipped `mcpNotificationConsumer.ts`)
- **Missed wakes are harmless** — consumers catch up by re-reading the mailbox on startup/reconnect
- **Channels-native crews storage = REJECTED** — liveness-dependent protocols regress durability, cursor, audit, and cross-machine fan-out

This brainstorm builds the NEXT THREE LAYERS above D-002: (1) the producer ecosystem, (2) the subscription transport architecture, and (3) the multi-machine / multi-device convergence story.

---

## Per-Axis Assessment

### Axis 1: Producer Ecosystem

**Frame:** What should the v2 producer story look like? Who builds producers, where do they live, how are they discovered?

#### Codex-feasibility lens

The shipped `happyMcpStdioBridge.ts` is already the de facto producer host — a per-session stdio MCP server living inside the happy-cli process. Its lifecycle ties perfectly to the codex session lifecycle. Adding producers here is TS-only, zero Rust changes, and uses the existing `server.server.sendResourceUpdated({ uri })` API.

Three viable hosting strategies:

| Strategy | Location | Discovery | Lifecycle |
|---|---|---|---|
| **Bridge-embedded** | `happyMcpStdioBridge.ts` (or sibling modules) | Statically compiled; consumer routing config maps kinds to actions | Tied to codex session — start on session init, stop on session exit |
| **Plugin-contributed** | MCP server per plugin (crews, ralph, custom) | `mcp_servers` config in settings; codex discovers at init | Tied to the MCP server process the plugin spawns; codex manages start/stop |
| **App-server-native** | Rust `fs_watch.rs` pattern in codex app-server | Thread subscription RPC (`thread/subscribe`) already exists | Tied to app-server lifecycle; outlives any single connection |

The critical insight from the codex app-server code: **`fs_watch.rs` already implements debounced file-watching with per-connection subscription tracking.** A codex-native producer for file-system events doesn't need to route through Node at all — the app-server can emit `FsChangedNotification` to subscribed connections directly. This is option (d) from the D-002 sibling brainstorm, and it's a fundamentally different architecture: the producer lives in Rust, subscriptions are connection-scoped, and notifications flow over the existing app-server WebSocket without any MCP intermediary.

**Assessment:** v2 should be a HYBRID per-producer-class decision:

- **File-system events (U4):** App-server-native via `fs_watch.rs` extension. The debounce, subscription tracking, and connection-scoped delivery are already built. Adding a "subscription RPC" surface that lets a session opt into watching specific paths is a ~200-line Rust addition.
- **Git events (U1), timer events (U2):** Bridge-embedded in `happyMcpStdioBridge.ts`. These are high-level, semantic producers that need TS ecosystem access (git CLI, cron parsing). They observe external state and emit notifications; the bridge is the natural host.
- **Plugin-contributed events:** Plugin's own MCP server (already the model — crews MCP server exists). Each plugin is an autonomous MCP server; the consumer routes by server name. No central hub needed.
- **Cross-session agent-comms events:** Daemon control server route (D-002's pattern). Not a "producer" in the subscription sense — it's request-response message passing with a wake signal as a side effect.

#### Devil's advocate lens

The "hybrid per-producer-class" model has a real risk: **discovery fragmentation.** An agent session needs to know: (a) which producers exist, (b) which are active/healthy, (c) what events each can emit, and (d) how to subscribe/unsubscribe. With three hosting strategies, there's no single registry to query.

Counter-arguments:
1. The just-shipped consumer already handles this gracefully — it doesn't "discover" producers, it just consumes notifications from whatever MCP servers happen to emit them. Discovery is implicit: if a server emits, the consumer routes.
2. App-server-native subscriptions work differently (they're RPC request-response, not ambient push), but that's actually cleaner — the agent explicitly opts in via `fs/watch` and explicitly opts out via `fs/unwatch`.
3. Plugin MCP servers are already discovered via the standard `mcp_servers` config mechanism.

The real fragmentation risk is **operational**: debugging "why didn't my agent get notified?" requires checking three different layers. Mitigation: unified notification audit log (all notifications, regardless of source, logged to a standard location with timestamp + source + kind + uri).

**Devil's advocate also raises:** The "none-needed" option deserves real consideration for v2. If D-002's mailbox pattern works well enough for inter-agent comms, and the primary use case for in-session subscription is "long-running agent wants to know about external changes" — is that use case actually common enough to justify the ecosystem? Exit-and-respawn (D-002 brainstorm option b) has the best operational simplicity profile. The northstar should explicitly preserve exit-and-respawn as the DEFAULT, with in-session subscription as an OPT-IN for specific high-frequency cases where respawn latency (2-10s) is unacceptable.

### Axis 2: Subscription Transport

**Frame:** Which producers live on which side of the wire and why?

The "wire" in question is the boundary between:
- **Node-side (happy-cli process):** TS, MCP stdio bridge, `MessageQueue2`, daemon control server
- **Codex-side (app-server process):** Rust, WebSocket JSON-RPC, thread state, `fs_watch.rs`

#### Architecture

```
┌─────────────────────────────────────┐
│          Node-side (happy-cli)       │
│                                      │
│  ┌─────────────────────────────────┐ │
│  │ happyMcpStdioBridge.ts          │ │
│  │  - git watcher (U1)             │ │
│  │  - timer scheduler (U2)         │ │
│  │  - inbox watcher (D-002)        │ │
│  │  → emits resource_updated       │ │
│  └──────────┬──────────────────────┘ │
│             │ stdio MCP                │
│  ┌──────────▼──────────────────────┐ │
│  │ mcpNotificationConsumer.ts      │ │
│  │  → routes to MessageQueue2      │ │
│  └─────────────────────────────────┘ │
│                                      │
│  ┌─────────────────────────────────┐ │
│  │ daemon controlServer.ts         │ │
│  │  - POST /agent-comms/send       │ │
│  │  - cross-session message relay  │ │
│  └─────────────────────────────────┘ │
└──────────────────┬───────────────────┘
                   │ WebSocket (app-server protocol)
┌──────────────────▼───────────────────┐
│        Codex-side (app-server)        │
│                                       │
│  ┌──────────────────────────────────┐ │
│  │ fs_watch.rs                      │ │
│  │  - file system events (U4)      │ │
│  │  - per-connection subscriptions  │ │
│  │  - debounced FsChangedNotif     │ │
│  └──────────────────────────────────┘ │
│                                       │
│  ┌──────────────────────────────────┐ │
│  │ thread subscription RPC          │ │
│  │  - thread status changes         │ │
│  │  - per-connection lifecycle      │ │
│  └──────────────────────────────────┘ │
│                                       │
│  ┌──────────────────────────────────┐ │
│  │ v2 subscription RPC (proposed)   │ │
│  │  - generic event subscription    │ │
│  │  - cursor-based replay           │ │
│  │  - persistent across reconnects  │ │
│  └──────────────────────────────────┘ │
└───────────────────────────────────────┘
```

**Decision framework for which side:**

| Criterion | Node-side producer | Codex-side producer |
|---|---|---|
| Needs TS ecosystem (npm, git CLI, cron) | ✓ | ✗ |
| Needs low-latency file-system events | ✗ | ✓ (already debounced) |
| Needs to survive session restart | ✗ | ✓ (app-server persists) |
| Needs cross-session visibility | ✗ (per-process) | ✓ (shared app-server) |
| Needs minimal conflict surface | ✓ (TS-only) | ✗ (Rust, protocol bump) |
| Needs to work without app-server | ✓ | ✗ |

**v2 transport answer:** BOTH, with a bridge for cases that need cross-side coordination:

1. **Node-side producers** (git, timer, inbox watcher) → emit via MCP stdio bridge → consumer routes to `MessageQueue2`. These are session-scoped, ephemeral, TS-only.
2. **Codex-side producers** (fs_watch, thread status) → emit via app-server WebSocket notifications → happy-cli receives as `EventMsg::McpServerNotification` → routes through same consumer. These are connection-scoped, persistent within the app-server lifetime.
3. **Bridge case** (agent-comms Scope B): daemon control server writes to a filesystem inbox AND triggers Node-side bridge watcher → wake via MCP notification. This is D-002's pattern and remains the canonical inter-session transport.

The bridge is NOT a new component — it's the D-002 pattern itself (filesystem write + wake signal). The "both-with-bridge" option from the original prompt is the right answer, but the bridge is D-002, not a new thing.

### Axis 3: agent-comms Scope A (Cross-Tunnel)

**Frame:** D-002 explicitly leaves Scope A blocked. What's the v2 path?

#### Current state

- Each machine runs its own `codex app-server` (loopback-bound WebSocket)
- `happy-server` runs per-operator (localhost:3005, exposed via Cloudflare Tunnel as `https://happy.evyatar.dev`)
- happy-server has a directory entry for each connected machine (tunnel presence)
- Scope B (same-daemon) is solved by D-002 (filesystem mailbox + channel wake)
- Scope C (parent-child) is a strict subset of B with stronger trust

#### v2 candidates for Scope A

| Option | Transport | Trust model | Latency | Durability |
|---|---|---|---|---|
| **A1: happy-server relay** | Machine A → happy-server → Machine B via tunnel | happy-server is the trust anchor; both machines authenticated to same operator | 200-500ms (two tunnel hops) | happy-server can persist undelivered messages |
| **A2: Direct P2P via Dev Tunnels** | Machine A ←→ Machine B via Microsoft Dev Tunnel / Tailscale / WireGuard | Mutual authentication at tunnel level; no relay | 50-200ms | No relay = no persistence; missed messages require sender retry |
| **A3: Mailbox-on-server** | Both machines read/write to happy-server's durable store | Same as A1; mailbox semantics preserved | First delivery: 200-500ms; replay: on reconnect | Full — happy-server IS the mailbox |
| **A4: Mobile broker** | Machine A → phone app → Machine B (phone as rendezvous) | Phone holds operator identity | Variable (push notification latency) | Phone can queue offline messages |

#### Assessment

**A3 (Mailbox-on-server)** is the only option that preserves D-002's architectural invariant: mailbox = source of truth, notifications = wake hints. The extension is:

- On-disk mailbox (D-002, Scope B) → on-server mailbox (Scope A)
- Local `fs.watch` wake → Socket.IO push notification wake (existing `eventRouter.ts`)
- Same "missed wakes harmless" invariant holds because the server-side mailbox is the durable source

**Required happy-server schema changes for A3:**

1. **Per-session inbox store** — encrypted at rest (existing pattern: `v3SessionRoutes.ts` already stores encrypted session data). Shape: `{ sessionId, messages: [{ id, from, body, createdAt, consumedAt? }], cursor }`
2. **Cross-machine notification fan-out** — when Machine A writes to Machine B's session inbox, happy-server pushes a Socket.IO event to Machine B's tunnel connection (existing `eventRouter.ts` fan-out pattern)
3. **Subscriber directory** — extend the existing machine directory entry with per-session subscription registrations so happy-server knows which machine holds which session

**v2-blocked-on-v1 dependency:** The D-002 impl must define the inbox message envelope shape in a way that's transportable to a server-side store. If the v1 envelope is tightly coupled to filesystem semantics (e.g., file paths as addressing), A3 becomes a rewrite. Recommendation: define the envelope as a JSON object with logical addressing (`{ from: sessionId, to: sessionId, body, ... }`) that can be stored in either a file OR a server-side database.

**v1-decision-that-becomes-irreversible:** If D-002 uses raw filesystem paths as the addressing scheme (e.g., `~/.happy/agent-comms/inboxes/<sessionId>/`), cross-machine delivery requires translating paths to logical addresses at the boundary. This is manageable but ugly. Better: use logical session-id addressing in v1 and treat the filesystem path as an implementation detail of the local store.

#### Devil's advocate on Scope A

The entire Scope A premise assumes two machines owned by the same operator need to communicate through their agents. Is this actually a use case anyone has? Today the operator's workflow is:
- Laptop runs local codex sessions
- The operator's phone runs the happy-app as a viewer/commander
- There is no second machine with its own codex sessions that needs to talk to the first

Scope A may be premature. The immediate real demand is **phone-to-laptop** (the happy-app sending a "start session" or "resume session" command to the laptop's daemon), which is already handled by happy-server's existing Socket.IO routes. True machine-to-machine agent communication is a multi-operator or multi-workspace concern that's significantly harder (who arbitrates trust? what's the namespace?).

**Recommendation:** Keep Scope A blocked for v2. The path exists (A3 mailbox-on-server) and can be built when demand materializes. The critical v1 decision is: don't make the envelope format file-path-coupled.

### Axis 4: codex-as-crews-engine Wire Protocol

**Frame:** What notification kinds, what mailbox-event semantics, what acknowledgment/replay path?

#### Current state

Today crews operates as:
- Lead + members run as independent CLI sessions (Claude Code or Copilot CLI)
- Communication is via filesystem mailbox (JSONL outbox → lead reviews via manifest cursor)
- Heartbeat is file-based (`manifest.json` → `lastHeartbeatAt` field)
- The Stop hook + report tag protocol gates turn completion

#### v2 wire protocol (channels-leveraged hybrid)

The D-002 pattern applied to crews means:

```
┌────────────────────────────────────────────────┐
│   Lead session (codex process)                  │
│                                                 │
│   manifest.json ← heartbeat write (every ~10s) │
│   outbox.jsonl  ← kind-bearing report rows      │
│                                                 │
│   MCP bridge watches lead's own outbox.jsonl    │
│   → emits resource_updated("crews://lead/outbox")│
└────────────────────┬────────────────────────────┘
                     │ (fs write to member inbox)
┌────────────────────▼────────────────────────────┐
│   Member session (codex process)                 │
│                                                  │
│   inbox.jsonl ← messages from lead               │
│                                                  │
│   MCP bridge watches member's own inbox.jsonl    │
│   → emits resource_updated("crews://member/inbox")│
│   → consumer pushes "you have mail" to MQ2       │
│   → member reads inbox on next turn boundary     │
└──────────────────────────────────────────────────┘
```

**Notification kinds (v2):**

| Kind | Direction | Semantics |
|---|---|---|
| `crews://member/<name>/inbox` | Lead → Member (wake) | "You have a new message in your inbox" |
| `crews://lead/outbox/<name>` | Member → Lead (wake) | "Member <name> posted a new report row" |
| `crews://member/<name>/heartbeat` | Member → Lead (presence) | "Member <name> is still alive" (replaces file heartbeat polling) |
| `crews://member/<name>/stopped` | Member → Lead (lifecycle) | "Member <name> terminated" |

**Mailbox-event semantics:**

The filesystem mailbox remains source of truth. Wake notifications carry NO message content — they are pure signals. The reader ALWAYS re-reads the file to get actual content. This means:

1. **Acknowledgment:** Reader advances a cursor (seq number) in its own state file after processing messages. Writer doesn't know if reader has consumed — this is intentional (fire-and-forget wake).
2. **Replay:** On startup/reconnect, reader scans the mailbox for entries with seq > last-consumed-seq. No replay of lost wake signals needed.
3. **Ordering:** Mailbox JSONL is append-only; seq numbers are monotonic. Reader processes in order.

**v2 addition — acknowledgment channel (optional):**

For the lead to know whether a member CONSUMED a message (not just received it), the lead reads the member's manifest cursor (`lastReviewedSeq`). This is already how crews v3 works. The v2 channel-leveraged version could additionally emit a wake notification back to the lead when the member advances its cursor — but this is an optimization, not a correctness requirement. The lead can poll the manifest file.

#### Devil's advocate

The entire "channels-leveraged" hybrid adds complexity over the current pure-file approach for a marginal latency improvement. Today's crews file-polling (manifest heartbeat ~10s) already works. The wake signal reduces "time until leader notices member report" from ~10s worst-case to <1s — but does that actually matter for the orchestration workflow?

Counter: It matters for INTERACTIVE crews sessions where the operator is watching. A 10-second delay between "member posts question" and "lead surfaces it" is noticeable UX. For autonomous batch work (the bookkeeper's normal mode), it doesn't matter much. The channel wake is a UX improvement, not a correctness improvement.

**Recommendation:** Ship the channels-leveraged hybrid as a progressive enhancement. The file-based protocol remains authoritative. Channel wakes are emitted when available but NEVER required for correctness. A pure-file fallback (no MCP server, no channel notifications) must always work — this preserves cross-engine compatibility and works on machines without the bridge.

### Axis 5: codex-app-server Idle-Timeout Interaction

**Frame:** D-002 + persistent subscribers raise pressure on the app-server idle-timeout question.

#### The tension

Current code (`app-server/src/lib.rs:660`):
```rust
let shutdown_when_no_connections = single_client_mode;
```

In WebSocket (multi-client) mode, the app-server does NOT shut down when connections drop — it stays alive indefinitely. In stdio mode (single-client), it exits when the connection closes.

D-002 introduces scenarios where the app-server SHOULD outlive client disconnects:
1. A Node-side producer is watching a filesystem inbox. If the app-server exits, the `fs_watch` subscription dies. When the client reconnects, it must re-register.
2. If two sessions share one app-server and session A disconnects, session B's subscriptions shouldn't be affected. (Already handled by per-connection subscription tracking.)
3. A persistent subscriber (e.g., background agent that periodically reconnects) wants its subscriptions to survive brief disconnects.

#### v2 lifecycle answer

The app-server already has the right building blocks:

- `UnloadingState` (`thread_lifecycle.rs:26-79`) — tracks per-thread "no subscribers AND inactive" with a configurable delay before unload
- Per-connection subscription cleanup on disconnect (`thread_processor.rs:2400`)
- `shutdown_when_no_connections` only applies to stdio mode

**Proposed v2 model:**

```
App-server lifecycle states:
  ACTIVE → (all connections drop) → IDLE_GRACE → (timeout expires) → SHUTDOWN
                                  → (new connection) → ACTIVE

IDLE_GRACE period: configurable (default 300s = 5 minutes)
- During IDLE_GRACE, app-server maintains all state but accepts no new work
- Filesystem watchers pause (stop emitting notifications) but don't unregister
- On new connection: resume immediately, re-emit missed changes since last activity

Persistent subscriber mode (opt-in per connection):
  Connection registers as "persistent" → app-server tracks its subscription state
  across disconnects. On reconnect, the connection provides a cursor (last-seen seq)
  and the app-server replays missed notifications from its ring buffer.
```

**v2-blocked-on-v1 dependency:** D-002's implementation doesn't touch the app-server (zero Rust changes). The idle-timeout question is orthogonal to D-002 and should be resolved in its own task (`codex-app-server-idle-timeout`).

**v1-decision-that-becomes-irreversible:** None identified. D-002 uses Node-side `fs.watch` for its inbox watcher, not app-server `fs_watch.rs`. The two are independent. If v2 later migrates inbox-watching to app-server-native, that's additive.

### Axis 6: Heartbeat + Presence

**Frame:** How does liveness / "I'm here / I left" work across crews, agent-comms, and multi-device?

#### Current heartbeat implementations

| System | Mechanism | Location | Interval | Consumer |
|---|---|---|---|---|
| Crews manifest | File write (`lastHeartbeatAt`, `lastListenerHeartbeatAt`) | `.crews/<crew>/members/<name>/manifest.json` | ~10s | Lead reads file; Stop hook checks staleness |
| Happy-server machine | Socket.IO `machine-alive` event | `machineUpdateHandler.ts:13-48` | Varies (client-driven) | Activity cache + ephemeral presence |
| Codex app-server thread | `ThreadStatus::Active` via `watch::Receiver` | `thread_status.rs:371` | Change-driven (not periodic) | `UnloadingState` unload delay |
| Daemon sessions | Process liveness (PID check) | `controlServer.ts` tracked sessions | On-demand (no periodic heartbeat) | Daemon `list` route |

#### v2 convergence assessment

**Should these converge?** No — they serve different purposes at different layers:

1. **Crews heartbeat** → "Is this agent session still participating in the orchestration?" — FILE-based because crews protocol is cross-engine, cross-machine, and must not depend on network liveness. KEEP SEPARATE.

2. **Happy-server presence** → "Is this machine/device reachable for push delivery?" — SOCKET-based because it's about network connectivity. KEEP SEPARATE.

3. **App-server thread status** → "Is this conversation actively being processed?" — IN-MEMORY because it's about internal app-server state. KEEP SEPARATE.

4. **Daemon session liveness** → "Is this codex process still running?" — PROCESS-based. KEEP SEPARATE.

**What v2 SHOULD add:** A unified PRESENCE QUERY that aggregates across these layers. Example:

```typescript
// "Is agent session X alive and reachable?"
interface AgentPresence {
  sessionId: string;
  processAlive: boolean;     // daemon PID check
  crewsActive: boolean;      // manifest heartbeat < 30s ago
  networkReachable: boolean; // happy-server presence
  lastActivity: Date;        // max across all layers
}
```

This is a READ-ONLY aggregation, not a replacement for the individual heartbeats. Each layer keeps its own liveness mechanism; a "presence service" in the daemon control server queries all four and returns a unified view.

**v1-decision-that-becomes-irreversible:** None. D-002 doesn't introduce a new heartbeat; it reuses the existing crews manifest heartbeat for its own sessions. The aggregation query is purely additive.

### Axis 7: Replay / Catch-Up Semantics

**Frame:** When a subscriber misses notifications, how do they catch up?

#### Taxonomy of miss scenarios

| Scenario | What's missed | Recovery mechanism |
|---|---|---|
| Session restart | All notifications since last run | **Mailbox re-read** — scan inbox for entries with seq > last-consumed |
| Brief disconnect (app-server reconnect) | Notifications during disconnect window | **App-server ring buffer** — reconnect with cursor, replay from buffer |
| Routing disabled mid-session | Notifications while disabled | **Mailbox re-read** — same as restart; consumer re-scans on enable |
| App-server idle-exit | All subscriptions lost | **Re-registration** — on next connect, re-register all subscriptions; app-server re-scans filesystem state |
| Cross-machine (Scope A) | Messages during offline period | **Server-side mailbox** — happy-server persists; client reads on reconnect |

#### v2 replay architecture

Two distinct replay patterns emerge:

**Pattern 1: Cursor-based mailbox replay (for durable messages)**
- Source of truth: filesystem (local) or server-side store (cross-machine)
- Cursor: monotonic sequence number, stored by the consumer
- Replay: consumer reads all entries with seq > cursor on startup/reconnect
- Correctness guarantee: eventual delivery (all messages eventually seen)
- Already implemented by: crews manifest cursor, D-002's inbox read-on-startup

**Pattern 2: State-snapshot synthetic events (for subscription state)**
- Source of truth: the current state of the watched resource
- On reconnect: subscriber asks "what's the current state?" and diffs against its last-known state
- Replay: NOT per-event replay, but synthetic "here's what changed" summary
- Correctness guarantee: eventual consistency (subscriber converges to current state)
- Already implemented by: `fs_watch.rs` (connection registers, immediately gets current state; subsequent changes are debounced notifications)

**Key insight:** These two patterns serve different use cases and should NOT be unified:

- **Inter-agent messages (crews, agent-comms):** Pattern 1. Every message matters; ordering matters; nothing can be skipped.
- **Resource subscriptions (file changes, thread status):** Pattern 2. Only the current state matters; intermediate changes are noise. A file that changed 47 times while the subscriber was offline needs exactly one "it changed" notification, not 47.

**v1-decision-that-becomes-irreversible:** D-002's inbox uses Pattern 1 (cursor-based, every-message-matters). This is correct for agent-comms. But if the same inbox format is later reused for resource subscriptions (e.g., "file X changed"), Pattern 1 would produce unnecessary replay volume. **Recommendation:** D-002's inbox is explicitly for MESSAGES (inter-agent communication). Resource subscriptions should use a separate mechanism (app-server `fs_watch` subscription RPC) that implements Pattern 2. Don't overload the inbox for both purposes.

---

## Competing Directions (for operator pick)

Unlike the sibling brainstorm (which converged cleanly on D-002), this northstar has multiple viable directions that DON'T converge into a single recommendation. The axes are largely independent — the operator can mix and match.

### N-001: Evolutionary Layering (conservative)

Build v2 as incremental layers on top of D-002, each independently shippable:

1. **Layer 1 (Q3 2026):** D-002 ships. agent-comms Scope B works. Crews continues file-only.
2. **Layer 2 (Q4 2026):** Add channel-wake to crews (progressive enhancement; file protocol unchanged). Add git/timer producers to bridge.
3. **Layer 3 (Q1 2027):** Add app-server subscription RPC for file-system events. Add idle-timeout grace period. Add presence aggregation query.
4. **Layer 4 (Q2 2027):** Scope A via mailbox-on-server (if demand materializes).

**Pro:** Lowest risk; each layer is independently testable and revertable. D-002 decisions are preserved without modification.
**Con:** Slow; Scope A stays blocked for 6+ months. No unified subscription model.

### N-002: Subscription-First Unification (ambitious)

Introduce a generic subscription RPC at the app-server level that subsumes all notification patterns:

1. App-server exposes `events/subscribe { filter, cursor?, persistent? }` → returns subscription ID
2. Subscriptions persist across reconnects (cursor-based replay from ring buffer)
3. All producers (fs, git, timer, agent-comms) register as event sources on the app-server
4. Consumer side in happy-cli translates app-server events into the existing `MessageQueue2` push

**Pro:** Single model for all subscriptions. Persistent subscriptions solve the idle-timeout question. Cursor-based replay is built once.
**Con:** Requires significant Rust-side protocol bump (high conflict surface with upstream). Subsumes patterns that are simpler as-is (file heartbeat, daemon presence). Over-engineering risk for the current scale.

### N-003: Agent-Comms-Centric (demand-driven)

Focus v2 exclusively on making agent-comms Scope B/C production-quality, then tackle Scope A when multi-machine demand materializes:

1. Polish D-002's agent-comms Scope B (daemon route, inbox format, authentication)
2. Build Scope C (parent-child) as a privileged subset of B (stronger trust, spawn-time channel)
3. Add channel-wake to crews as a separate progressive enhancement
4. Defer ALL producer ecosystem work until measurement shows which events actually need in-session delivery
5. Scope A: build when the operator actually has two machines with agents that need to talk

**Pro:** Demand-driven; doesn't build infrastructure ahead of use cases. Aligns with Devil's Advocate's "exit-and-respawn is undervalued" position.
**Con:** May leave the producer ecosystem unstratified for too long; if multiple teams build producers without guidance, they'll each invent incompatible patterns.

---

## Recommended Direction

**N-001 (Evolutionary Layering)** — with the caveat that Layer 2 (channel-wake for crews) should be prioritized alongside or immediately after D-002, because the latency improvement for interactive crews sessions is the most immediately-felt UX win.

Rationale:
- The single-operator, single-machine use case dominates today and for the foreseeable future
- Scope A demand is speculative (the operator has one dev machine + one phone; the phone already communicates via happy-server's existing routes)
- The subscription-first unification (N-002) is premature — the scale doesn't justify the Rust-side investment and upstream conflict surface
- Agent-comms Scope B/C (N-003's focus) is ALREADY covered by D-002's immediate next step

---

## v2-Blocked-on-v1 Dependencies

These are things that CANNOT be built until D-002 ships:

| Dependency | Blocks | Reason |
|---|---|---|
| D-002 inbox envelope shape definition | Scope A (mailbox-on-server) | Server-side inbox must use the same envelope format; defining it twice creates a migration burden |
| D-002 daemon `/agent-comms/send` route | Crews channel-wake (Layer 2) | The wake notification flow requires the daemon to know about active sessions and their inbox locations |
| D-002 missed-wake recovery fixture | App-server subscription RPC replay | The replay-on-reconnect pattern for subscriptions should reuse the same cursor-advancement logic |
| D-002 `happyMcpStdioBridge.ts` producer pattern | Generic producers (git, timer) | The bridge producer hosting model must be proven before adding more producers |

## v1-Decisions-That-Become-Irreversible

These are D-002 design choices that, once shipped, constrain the v2/v3 design space:

| Decision | Irreversibility | Mitigation |
|---|---|---|
| **Inbox envelope schema** | Once consumers exist, the envelope shape can't change without migration | Define a versioned envelope (`{ version: 1, ... }`) from day 1. Include logical addressing (sessionId), not physical (file paths). |
| **Addressing model (sessionId vs path vs URI)** | Cross-machine delivery requires logical addressing; if v1 uses file paths, v2 needs a translation layer | Use sessionId as the canonical address in the D-002 envelope; treat the filesystem path as a private implementation detail of the local store. |
| **Wake signal URI scheme** | The consumer routes by URI pattern; once deployed, changing the URI scheme breaks existing config | Use a stable URI scheme: `agent-comms://inbox/<sessionId>` (NOT `file:///path/to/mailbox.json`). The URI is a logical identifier, not a locator. |
| **Routing config shape** | If v1 routing is global-per-server-per-kind, adding per-session or per-subscription routing later requires a config schema bump | Acceptable for v1. Document that per-subscription routing is a v2 concern. The config shape allows extension (nested objects) without breaking existing configs. |
| **Consumer integration point** | The consumer pushes to `MessageQueue2` between turns. If v2 needs mid-turn delivery, a new integration point is required. | Acceptable for v1. Between-turns delivery is the correct default; mid-turn preemption is a v3 concern that requires codex-core changes (Rust). |

---

## Candidate Task List (post-brainstorm filings)

| Task to file | Type | Depends on | Priority |
|---|---|---|---|
| `crews-channel-wake-progressive-enhancement` | plan | D-002 ships | HIGH — immediate UX win for interactive crews; Layer 2 of N-001 |
| `app-server-subscription-rpc` | brainstorm | D-002 ships + producer pattern proven | MEDIUM — Layer 3 of N-001; requires Rust investment |
| `agent-comms-scope-a-mailbox-on-server` | brainstorm | D-002 envelope schema stable + real demand | LOW — defer until multi-machine demand materializes |
| `producer-ecosystem-git-timer` | plan | D-002 bridge producer pattern proven | MEDIUM — Layer 2 of N-001 alongside crews-wake |
| `codex-as-crews-engine` | plan | D-002 ships + crews-channel-wake proven | MEDIUM — formal filing of the informal task; material in Axis 4 makes this mechanical |
| `presence-aggregation-query` | plan | D-002 ships + daemon route exists | LOW — Layer 3 convenience; not blocking |
| `notification-audit-log` | plan | Any producer ships | LOW — operational debugging aid; file when the first producer-miss bug report arrives |

---

## Explicit coordination notes

- **`codex-app-server-idle-timeout`**: This northstar recommends the "configurable idle-grace period" answer (Axis 5). The idle-timeout brainstorm should reference this document's Axis 5 assessment. The key input: persistent subscribers want app-server to outlive client disconnects, but D-002 doesn't create persistent app-server subscribers (it uses Node-side `fs.watch`). The pressure comes from Layer 3 (app-server subscription RPC), not from D-002.

- **`agent-comms`**: Scope B/C partial-unblock should happen when D-002 ships. Scope A stays blocked with the explicit note: "path exists (A3 mailbox-on-server) but demand is speculative."

- **`3d-workers`**: Tangential. Its blockers (3a-skills, 3b-agents) are prerequisite-chain, not transport-chain. If a spawned worker is long-lived enough to want subscriptions, it would use the same D-002 inbox pattern as any other session. No special design needed.

- **`codex-as-crews-engine`** (informal, not yet filed): Axis 4 above provides the concrete material. The task filing should be: "Implement channel-wake progressive enhancement for crews protocol — MCP bridge watches inbox/outbox JSONL, emits resource_updated, consumer pushes 'you have mail' to MessageQueue2. File protocol remains authoritative. Channel wake is opt-in, not required for correctness."
