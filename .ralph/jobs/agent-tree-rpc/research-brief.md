# Research Brief: agent-tree-rpc

## Researcher Findings (Claude Explore)

### Monorepo layout (D:/harness-efforts/codexu)
- pnpm workspace, TypeScript 5.9, Vitest, Socket.IO 4.x, Fastify 5
- `packages/happy-cli/` — Node CLI daemon owning codex process control + Socket.IO client to happy-server
- `packages/happy-server/` — Fastify + Socket.IO relay (events + RPC routing)
- `packages/happy-app/` — React Native mobile/web client
- `packages/happy-wire/` — shared Zod / type contracts (BOTH happy-cli AND happy-server depend on it)
- `codex/external/repos/codex-patched/` — Rust submodule, READ-ONLY reference

### happy-cli codex integration (files to read/modify)
- `packages/happy-cli/src/codex/runCodex.ts`
  - lines 542–551 — client setup / connect
  - lines 586–691 — long-lived `client.setEventHandler((msg) => {...})` callback; processes all codex events for the session lifetime
  - line 677 — `mapCodexMcpMessageToSessionEnvelopes()` mapping
  - line 465–498 — `handleKillSession()` teardown (natural place to clear agent-tree cache)
  - line 501 — `session.rpcHandlerManager.registerHandler('abort', handleAbort)` (template for new RPC registration)
  - lines 337–338 — existing `codexStartedSubagents` / `codexActiveSubagents` maps (parallel state already maintained per-session)
- `packages/happy-cli/src/codex/codexAppServerClient.ts`
  - lines 246–253 — `setEventHandler` registration site (entry point for spawn events)
  - lines 1701–1773 — `handleNotification()` v2 protocol dispatch (currently swallows unknown `item/*` types; this is where `item.type === 'collabAgentToolCall'` parsing must be added)
  - lines 376–386 (exec_command_begin), 413–420 (patch_apply_begin), 438–458 (agent_message) — templates for new item.type cases
  - lines 168 — connection lifecycle (transport holds JSON-RPC notification subscription for full session)
- `packages/happy-cli/src/api/apiSession.ts`
  - lines 402–412 — `registerHandler` example (template for `sessionGetAgentTree`)
- `packages/happy-cli/src/api/types.ts` — client-side socket event typing (must add `agent-tree-update`)

### happy-server side
- `packages/happy-server/sources/app/events/eventRouter.ts`
  - lines 42–160 — `UpdateEvent` / `EphemeralEvent` discriminated unions (current fan-out only supports those two types)
  - lines 323–341 — `emitUpdate()` signature
  - lines 343–356 — `emitEphemeral()` signature
  - lines 360–366 — replay buffer (updates only; ephemeral not replayed)
  - lines 238–255 — `EventRouter` interface
  - **Critical:** current EventRouter has NO third event kind. Adding `agent-tree-update` as a literal Socket.IO event is a contract extension.
- `packages/happy-server/sources/app/events/eventRouter.test.ts` — `FakeSocket` / `FakeIo` / `createConnection` test harness pattern; mirror for new fan-out test.
- `packages/happy-server/sources/app/api/socket/rpcHandler.ts`
  - lines 128–250 — generic `rpc-register` / `rpc-unregister` / `rpc-call` routing; method-name format `${sessionId}:method`. No changes needed — register new RPC on the CLI side.
- `packages/happy-server/sources/app/api/socket/sessionUpdateHandler.ts` — CLI-origin socket handler entry; add `agent-tree-update` handler here.
- `packages/happy-server/sources/app/api/socket.ts` — typed Socket.IO event surface; must add `agent-tree-update`.

### happy-app side (informational; out of scope this commit)
- `packages/happy-app/sources/sync/apiSocket.ts` — `apiSocket.forSession(sessionId).rpc(...)` already supports new method names; `onAny`/`onMessage` already supports adding new events.
- `packages/happy-app/sources/app/(app)/session/[id]/agents.tsx` — existing static "Agents" screen; can later be replaced to consume the live tree, but NOT touched in this commit.

### Codex wire-protocol fields actually reaching Node today
- Legacy `codex/event` notifications still flow through `setEventHandler`; types include `task_started`, `task_complete`, `turn_aborted`, `exec_command_begin/end`, `patch_apply_begin/end`, `agent_message`, `token_count`.
- V2 raw item notifications: `item/started`, `item/completed`, `thread/started`, `thread/tokenUsage/updated`, `thread/status/changed`.
- **Spawn events present in v2:** `CollabAgentSpawnBegin` / `CollabAgentSpawnEnd` are forwarded by codex app-server (`bespoke_event_handling.rs`) and mapped to `ThreadItem::CollabAgentToolCall` in v2 (`app-server-protocol/src/protocol/event_mapping.rs`). They reach `CodexAppServerClient.handleNotification()` but are NOT parsed today — they fall through the unknown-item branch.

### Codex data shape (read-only reference)
- `codex/.../core/src/agent/registry.rs` — `ActiveAgents.agent_tree: HashMap<String, AgentMetadata>` where `AgentMetadata { agent_id, agent_path, agent_nickname, agent_role, last_task_message }`. `live_agents()` excludes root.
- `codex/.../core/src/agent/control.rs:~832-840` — `subscribe_status(agent_id) -> watch::Receiver<AgentStatus>`; `list_agents()` at ~864 already produces a live snapshot of `{ id, status, last_task_message }`.
- `codex/.../protocol/src/protocol.rs` — `EventMsg` serde-tagged snake_case; `AgentStatus` variants: `pending_init | running | interrupted | completed | errored | shutdown | not_found`.
- `codex/.../app-server-protocol/src/protocol/v2/item.rs` — `CollabAgentToolCall`, `CollabAgentState`
- `codex/.../app-server-protocol/src/protocol/v2/thread_data.rs` — `Thread { session_id, source, status, agent_nickname, agent_role, ... }`
- `codex/.../app-server-protocol/src/protocol/v2/thread.rs` — `ThreadReadParams/Response`, `ThreadLoadedListResponse`, `ThreadStatusChangedNotification`
- `codex/.../core/src/tools/handlers/multi_agents{,_v2}/spawn.rs` — emit spawn begin BEFORE spawn (no child threadId yet — only callId + parent) and spawn end AFTER (carries `new_thread_id`, nickname, role, prompt, model, reasoning effort, status).

### Tests
- happy-cli vitest config: `packages/happy-cli/vitest.config.ts`. Colocated `.test.ts` next to source.
- happy-server vitest config: `packages/happy-server/vitest.config.ts`.
- `packages/happy-server/sources/app/events/eventRouter.test.ts` — closest template for the new fan-out assertion.
- `packages/happy-cli/src/codex/codex.integration.test.ts` — closest template for an end-to-end codex event → session emission test (extend a `CodexDriver` helper to capture agent-tree updates).

### Build / typecheck
- `pnpm build` — typechecks all packages
- `pnpm --filter happy-cli test`, `pnpm --filter happy-server test`
- Build order: `happy-wire` must compile before `happy-cli` / `happy-server` (already wired via `workspace:*` deps in their `package.json`).

### Plans referenced
- `plans/agent-view-research.md` — §6 "Decomposition into follow-up ralph tasks" lines 195–205 define this `agent-tree-rpc` task (8h effort, medium risk, no blockers). Must mark in-progress / done.
- `plans/codexu-roadmap.md` — lines 190–228 codify the "minimize-conflict-surface" tenet (codex submodule read-only; all changes live in `packages/` and `plans/`).
- `plans/native-agent-parity.md` — adjacent, NOT touched by this feature.

---

## Architect Analysis (Claude Explore)

### Subscription lifetime mapping
- The user's pitfall description ("subscribe_status returns a tokio watch::Receiver — bridge must hold it across agent lifetime, not one tool call") is conceptually accurate but practically constrained: a Rust `watch::Receiver` cannot be held by Node. The actual Node-side analog is the JSON-RPC notification stream from `CodexAppServerClient` — that stream is the per-process channel that surfaces the codex registry's status changes. The lifetime concern still applies: register the agent-tree event listener inside `runCodex`'s long-lived `setEventHandler` once per session, NEVER inside a per-turn / per-tool callback.

### State ownership boundary
- In-memory cache: a `Map<threadId, AgentTreeNode>` + a `Map<callId, PendingSpawn>` (pending until spawn-end resolves the child threadId).
- Owner: a new helper module `packages/happy-cli/src/codex/agentTreeState.ts` (pure reducer over `AgentTreeEvent` → `{ snapshot, delta[] }`). Held by `runCodex.ts` in a per-session closure (NOT a global singleton — multiple codex sessions per CLI process must each have their own state).
- Cleared in `handleKillSession()` (`runCodex.ts:465`) before `client.disconnect()`.

### Ordering primitive
- Codex JSON-RPC notifications are serialized over a single transport; happy-cli's `setEventHandler` callback runs sequentially. Cache mutation is synchronous inside the callback; delta emission happens in the same synchronous step.
- The only way ordering breaks: queueing deltas via `setImmediate` / `Promise.resolve().then(...)` before the next event lands. Solution: emit synchronously.

### Snapshot-vs-stream race mitigation
- Add `seq` (monotonically increasing integer) to both the snapshot RPC response and each delta. Clients hold `appliedSeq`, ignore deltas with `seq <= appliedSeq`.

### Risk areas
- **Receiver-lifetime bug:** re-registering the event handler inside a tool callback would silently drop spawn events after the first turn. Mitigation: single registration in `runCodex.ts` boot; teardown only in `handleKillSession`.
- **`lastTaskMessage` gap:** codex app-server protocol does NOT expose `last_task_message` to Node today. Best-effort fallback: derive from the spawn-begin prompt and update on observed `agent_message` for that thread, OR leave the field optional and document the gap.
- **Spawn-begin has no child threadId:** include a `pending-spawn-started` delta variant (keyed by callId, carries parent + prompt) so the acceptance test can verify *two* deltas per child (pending + resolved) in correct order. The first delta to mention a real threadId is `node-added` on spawn-end.
- **Cache memory:** bounded by live agent count (<100); explicit `clear()` in teardown.
- **Cross-package typecheck:** add new types to `happy-wire` FIRST, then build, then update consumers.

### Suggested implementation order
1. `packages/happy-wire/src/agentTree.ts` (new) — Zod schemas + TypeScript types for `AgentTreeNode`, `AgentTreeEdge`, `AgentTreeSnapshot`, `AgentTreeDelta` union, RPC request/response, Socket.IO event payload.
2. `packages/happy-cli/src/codex/agentTreeState.ts` (new) — pure reducer + state container; vitest unit test colocated.
3. `packages/happy-cli/src/codex/codexAppServerClient.ts` — extend `handleNotification` to parse `item.type === 'collabAgentToolCall'` and surface to `setEventHandler` callback.
4. `packages/happy-cli/src/codex/runCodex.ts` — construct `AgentTreeState`, wire to event handler, register `sessionGetAgentTree` RPC, emit deltas via new socket helper, clear on kill.
5. `packages/happy-cli/src/api/apiSession.ts` — add `sendAgentTreeUpdate(delta)` helper.
6. `packages/happy-server/sources/app/api/socket.ts` — add `agent-tree-update` to typed socket event surface.
7. `packages/happy-server/sources/app/api/socket/sessionUpdateHandler.ts` — CLI-origin handler for incoming `agent-tree-update` events; forwards to `eventRouter`.
8. `packages/happy-server/sources/app/events/eventRouter.ts` — extend event kind enum; add `emitAgentTreeUpdate(...)` using `all-interested-in-session` recipient filter; vitest in `eventRouter.test.ts`.
9. End-to-end vitest in `packages/happy-cli/src/codex/codex.integration.test.ts` — fake codex emits two ordered spawn-begin → spawn-end pairs, assert client receives `pending-spawn-started → node-added` deltas in correct order with parent linkage.
10. Update `plans/agent-view-research.md` and `plans/codexu-roadmap.md` to mark the task done / referenced.

---

## Codex Research

### Key codebase facts (additive to Claude's findings)
- `AgentRegistry.agent_tree` is `HashMap<String, AgentMetadata>`; fields: `agent_id`, `agent_path`, `agent_nickname`, `agent_role`, `last_task_message`. `live_agents()` excludes root.
- V2 `CollabAgentToolCall` shape contains receiver thread ids + status, but does NOT carry nickname/role — those must be recovered from legacy raw `EventMsg` (still flowing today) OR from `thread/read` / `thread/list` follow-up requests.
- `CodexAppServerClient.handleRawNotification()` currently SWALLOWS unknown `item/*`. Parser for `collabAgentToolCall` must be added or spawn events are silently lost on the v2 path.

### Pitfall sharpened
- Codex source read-only ⇒ happy-cli cannot literally hold a Rust `watch::Receiver`. The "long-lived task" requirement reduces to: maintain a Node mirror reconstructed from the v2 notification stream + the legacy `codex/event` stream, kept open for the whole session.

### Delta union refinement
- Spawn-begin has only `call_id` + `sender_thread_id` (parent). No child threadId yet. A literal `node-added` cannot be emitted on begin. Either:
  - (a) include `pending-spawn-started` in the delta union and emit it on begin, OR
  - (b) buffer begin events and only emit `node-added` on end (loses the "begin delta" assertion).
- Recommendation: option (a) — include the pending variant; the acceptance test can then assert four ordered deltas (2 pending-spawn-started, 2 node-added) for the 2-subagent scenario.

### Server fan-out caveat
- `EventRouter` today emits only `update` / `ephemeral` Socket.IO frames. Adding a distinct `agent-tree-update` frame is a cross-package socket contract change in `socket.ts` + `eventRouter.ts` + consumer client types.

### Test priorities
1. Pure reducer test for `agentTreeState.ts` (input: ordered fake events → expected snapshot + delta stream)
2. Server fan-out test in `eventRouter.test.ts` for the new `agent-tree-update` frame
3. End-to-end integration test feeding mock codex events through CodexAppServerClient → runCodex → fake apiSession → assert deltas arrive in correct order with parent linkage

---

## Copilot Research

### Adds the following clarifications
- **`lastTaskMessage` is the hardest field**: Codex core has it (`registry.rs`, `control.rs::list_agents`), but the app-server protocol does NOT expose it. Best-effort fallback: derive from spawn prompt; later correlate with `agent_message` items on the child thread.
- **Replay behavior**: only `emitUpdate(...)` paths are replayable across reconnects on happy-server. A custom `agent-tree-update` Socket.IO frame is transient — clients should always RPC `sessionGetAgentTree` on mount/reconnect to get the authoritative snapshot, then apply forward deltas.
- **Session RPC routing already exists** — the new RPC just needs to be registered on the CLI side via `session.rpcHandlerManager.registerHandler('sessionGetAgentTree', ...)` and the happy-server `rpcHandler.ts` will route `${sessionId}:sessionGetAgentTree` automatically. No new server handler file.
- **Existing mobile Agents screen** at `packages/happy-app/sources/app/(app)/session/[id]/agents.tsx` is misleadingly close — it consumes `session.metadata.agents` (static catalog), NOT the live tree. Out of scope this commit; documented as future hook-up.

### Socket-typing files to update in lockstep
- `packages/happy-server/sources/app/api/socket.ts` — server's typed socket surface
- `packages/happy-cli/src/api/types.ts` — CLI client's matching surface
- (Mobile/web socket typing — deferred, not in this commit.)

---

## Consolidated File List

### Files to create
- `packages/happy-wire/src/agentTree.ts` — shared types + Zod schemas
- `packages/happy-cli/src/codex/agentTreeState.ts` — reducer / state container
- `packages/happy-cli/src/codex/agentTreeState.test.ts` — reducer unit test

### Files to modify
- `packages/happy-wire/src/index.ts` — re-export the new module
- `packages/happy-cli/src/codex/codexAppServerClient.ts` — add `collabAgentToolCall` parsing in `handleNotification`
- `packages/happy-cli/src/codex/runCodex.ts` — construct state, wire event handler, register RPC, emit deltas, clear on kill
- `packages/happy-cli/src/api/apiSession.ts` — add `sendAgentTreeUpdate(delta)` helper
- `packages/happy-cli/src/api/types.ts` — declare `agent-tree-update` event in client socket typing
- `packages/happy-server/sources/app/api/socket.ts` — declare `agent-tree-update` in server socket typing
- `packages/happy-server/sources/app/api/socket/sessionUpdateHandler.ts` — handle incoming CLI deltas
- `packages/happy-server/sources/app/events/eventRouter.ts` — add `emitAgentTreeUpdate(...)` method with `all-interested-in-session` filter
- `packages/happy-server/sources/app/events/eventRouter.test.ts` — fan-out test for new frame

### Files to add/extend tests for
- `packages/happy-cli/src/codex/codex.integration.test.ts` — end-to-end ordering + parent-linkage assertion (the acceptance test)

### Plans to update (docs)
- `plans/agent-view-research.md` — mark §6 `agent-tree-rpc` complete with commit reference
- `plans/codexu-roadmap.md` — note the task delivered (no tenet change)

### READ-ONLY (must not touch)
- All files under `codex/external/repos/codex-patched/`
