---
overviewTaskId: async-events-northstar-architecture
---

## Direction

N-001 — Evolutionary Layering. Build v2/v3 as incremental, independently-shippable layers on top of D-002, with crews channel-wake (Layer 2) prioritized immediately after D-002 for interactive UX improvement.

## Layers (6-12 month horizon)

### Layer 1: D-002 Foundation (immediate — already planned)
- Durable mailbox + channel wake pattern document
- agent-comms Scope B reference implementation
- Missed-wake recovery fixture
- Scope B+C partial unblock of `agent-comms` task

### Layer 2: Channel-Wake + Bridge Producers (Q3-Q4 2026)
- Crews channel-wake progressive enhancement (file protocol stays authoritative; channel wakes are opt-in UX improvement)
- Git watcher producer in `happyMcpStdioBridge.ts`
- Timer/cron producer in bridge
- `codex-as-crews-engine` formal task filed and planned

### Layer 3: App-Server Subscription RPC (Q1 2027)
- Generic `events/subscribe` RPC in codex app-server (Rust)
- Idle-timeout grace period (configurable, default 300s)
- Persistent subscriber mode (cursor-based replay from ring buffer)
- Presence aggregation query in daemon control server

### Layer 4: Cross-Machine (Q2 2027, demand-gated)
- agent-comms Scope A via mailbox-on-server (happy-server relay + persist)
- Cross-machine notification fan-out via Socket.IO
- Per-machine subscriber directory extension

## Scope

### In Scope (this brainstorm answers)
- Per-axis architecture assessment for 7 design axes
- Recommended direction with layered timeline
- v2-blocked-on-v1 dependency list (constrains D-002 impl)
- v1-decisions-that-become-irreversible (warns D-002 implementer)
- Candidate task list for post-brainstorm filings

### Out of Scope
- D-002 re-litigation (settled: durable mailbox + channel wake)
- D-002 implementation details (separate plan-with-ralph)
- Any code changes (design-only brainstorm)
- UI / kanban-viewer changes
- Mid-turn preemption (v3 concern requiring codex-core Rust changes)

## Key architectural decisions

1. **Producer ecosystem = hybrid per-producer-class** (not a single centralized hub):
   - File-system events → app-server-native (`fs_watch.rs` extension, Layer 3)
   - Git/timer events → Node-side bridge-embedded (`happyMcpStdioBridge.ts`, Layer 2)
   - Plugin events → plugin's own MCP server (existing model)
   - Inter-session messages → daemon control route (D-002 pattern)

2. **Subscription transport = both-with-bridge** (not one-side-only):
   - Node-side producers emit via MCP stdio bridge (session-scoped, ephemeral)
   - Codex-side producers emit via app-server WebSocket (connection-scoped, persistent)
   - Bridge case = D-002 pattern itself (filesystem write + wake signal)

3. **Scope A = mailbox-on-server (A3), but DEFERRED** until demand:
   - D-002 envelope must use logical addressing (sessionId) not physical (file paths)
   - happy-server already has the primitives (encrypted store + Socket.IO fan-out)
   - Demand is speculative today; one machine + phone covers actual use

4. **Heartbeats DO NOT converge** — each layer keeps its own mechanism:
   - Crews: file-based manifest heartbeat (cross-engine compatible)
   - Happy-server: Socket.IO presence (network liveness)
   - App-server: in-memory thread status (internal state)
   - Daemon: process PID check (on-demand)
   - v2 adds: unified READ-ONLY presence aggregation query

5. **Replay = two distinct patterns, intentionally NOT unified:**
   - Messages (crews, agent-comms): cursor-based, every-message-matters (Pattern 1)
   - Subscriptions (file changes, thread status): state-snapshot synthetic events (Pattern 2)
   - D-002 inbox = Pattern 1 only; Pattern 2 belongs in app-server subscription RPC (Layer 3)

## Critical v1 (D-002) constraints surfaced by this brainstorm

The D-002 implementer MUST:
1. Use **versioned envelope** (`{ version: 1, ... }`) — future format evolution without migration
2. Use **logical addressing** (sessionId) in the envelope — physical file paths are implementation detail
3. Use **stable URI scheme** for wake signals (`agent-comms://inbox/<sessionId>`) — not filesystem paths
4. Document that **per-subscription routing is a v2 concern** — v1 global-per-server-per-kind is acceptable
5. Document that **between-turns delivery is the v1 contract** — mid-turn preemption is v3

## Sources

- D-002 brainstorm: `.ralph/brainstorms/async-events-design/` (selected-direction.md, brainstorm-synthesis.md, brainstorm.json)
- D-002 plan + research brief: `.ralph/jobs/async-events-design/` (plan.md, research-brief.md, stories-outline.md)
- Codex app-server subscription code: `codex/external/repos/codex-patched/codex-rs/app-server/src/fs_watch.rs`, `thread_state.rs`, `thread_lifecycle.rs`
- Codex MCP notification bridge: `codex/codex-rs-overlay/codex-mcp-notification-bridge/src/bridge.rs`
- Happy-cli consumer: `packages/happy-cli/src/codex/mcpNotificationConsumer.ts`, `mcpNotificationRouting.ts`
- Happy-server presence: `packages/happy-server/sources/app/api/socket/machineUpdateHandler.ts`, `rpcHandler.ts`
- Crews protocol: `ai-developer-toolkit/plugins/crews/docs/protocol.md`, `hooks/mailbox.js`
- Daemon control: `packages/happy-cli/src/daemon/controlServer.ts`, `controlClient.ts`
