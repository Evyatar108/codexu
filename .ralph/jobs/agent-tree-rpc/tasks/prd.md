# PRD: Agent Tree RPC

*Generated in autonomous mode from `D:/harness-efforts/codexu/.ralph/jobs/agent-tree-rpc/plan.md` and `stories-outline.md` on 2026-05-13.*

## 1. Introduction / Overview

Expose codex's live in-process agent spawn tree as a queryable + streamable RPC surface that mobile clients (happy-app) can render. Codex already maintains the data internally (`AgentRegistry.agent_tree` in `codex-rs/core/src/agent/registry.rs`) and emits `CollabAgentSpawnBegin/EndEvent` plus the v2 `ThreadItem::CollabAgentToolCall` items, but nothing on the Node side currently parses those events into a unified tree representation.

This work adds the bridge entirely on the happy-cli side (the `codex/` submodule is read-only per the minimize-conflict-surface tenet in `plans/codexu-roadmap.md`), plus the small server-side socket-typing and fan-out extension required to deliver a new `agent-tree-update` Socket.IO frame.

The deliverable is two complementary RPC shapes:
1. `sessionGetAgentTree(sessionId)` — CLI-registered session RPC that returns a `{ nodes, edges, seq }` snapshot.
2. `agent-tree-update` — Socket.IO frame carrying incremental deltas (`pending-spawn-started | node-added | node-status-changed | node-removed`) with a monotonic `seq` so reconnecting clients can RPC for a snapshot and then forward-apply deltas without race.

### Autonomous-mode assumptions

The following decisions were inferred from the plan and stories outline and are recorded here so reviewers can challenge them explicitly:

- **Primary goal:** unblock mobile UI consumption of the agent spawn tree without touching the codex Rust submodule.
- **Target user:** the happy-app mobile client (future consumer); the wire and CLI work in this commit is the foundation.
- **Scope:** Node-side bridge + shared wire types + server fan-out. Mobile UI consumption is explicitly out of scope.
- **Single commit constraint:** all changes (including `plans/overview.html` regeneration) land in one commit on `main`.

## 2. Goals

- Provide a deterministic, queryable snapshot of the live agent spawn tree per codex session.
- Stream incremental deltas with monotonic sequence numbers so clients can reconcile snapshot + stream without race.
- Deduplicate spawn events that arrive on both the legacy `codex/event` path and the v2 `collabAgentToolCall` item path.
- Reject spoofed `agent-tree-update` frames at the server boundary (session-scoped connection authorization).
- Keep the codex Rust submodule untouched.
- Land as a single commit on `main`, with `plans/overview.html` regenerated in the same commit.

## 3. User Stories

The decomposition mirrors `stories-outline.md`. Each story is sized to one focused implementation session.

### US-001: Shared wire types for the agent tree
**Description:** As an implementer working in either happy-cli or happy-server, I want a single source of truth for `AgentTreeNode`, `AgentTreeEdge`, `AgentTreeSnapshot`, and the `AgentTreeDelta` union so both ends compile against the same Zod schemas.

**Acceptance Criteria:**
- [ ] New file `packages/happy-wire/src/agentTree.ts` defines Zod schemas for `AgentTreeNode` (`threadId`, `agentRole`, `nickname`, `status`, `lastTaskMessage?`, `spawnedAt`), `AgentTreeEdge` (`{ parent, child }`), `AgentTreeSnapshot` (`{ nodes, edges, seq }`), and `AgentTreeDelta` union (`pending-spawn-started | node-added | node-status-changed | node-removed`), plus inferred TypeScript types.
- [ ] `packages/happy-wire/src/index.ts` re-exports the new module.
- [ ] `pnpm --filter @slopus/happy-wire build` is green.
- [ ] Typecheck passes for the package.

**Dependencies:** None.
**Estimated complexity:** small.

### US-002: Pure reducer for the agent-tree state
**Description:** As the happy-cli runtime, I want a deterministic in-memory reducer that consumes typed `AgentTreeEvent` inputs and produces ordered `AgentTreeDelta` outputs plus a queryable snapshot so the RPC and the delta stream stay consistent.

**Acceptance Criteria:**
- [ ] New file `packages/happy-cli/src/codex/agentTreeState.ts` exposes `applyEvent(evt) -> AgentTreeDelta[]`, `snapshot() -> AgentTreeSnapshot`, `clear()` over a closed-over state.
- [ ] `applyEvent` returns an array (possibly empty); `closeAgent` removes the target and all live descendants and emits `node-removed` deltas in descendants-first order, each carrying its own incremented `seq`.
- [ ] Pending map keyed by `callId`; resolved to `node-added` on spawn-end with real `threadId`.
- [ ] `(callId, phase)` deduplication: re-applying the same begin or end produces no additional delta. Metadata merge from a later legacy event into an existing v2-created node is allowed without emitting a delta.
- [ ] Monotonic `seq` counter; each emitted delta and each `snapshot()` carry the current `seq`.
- [ ] `clear()` resets all state and resets `seq` to 0.
- [ ] Colocated `agentTreeState.test.ts` exercises: ordered begin/end pair, nested begin/end pair, status change, removal, dedup (v2-first/legacy-second AND legacy-first/v2-second), seq monotonicity across array-returning `applyEvent`, and `closeAgent` subtree removal.
- [ ] Typecheck passes.

**Dependencies:** US-001.
**Estimated complexity:** medium.

### US-003: Codex v2 parser extension for `collabAgentToolCall`
**Description:** As happy-cli, I want `CodexAppServerClient.handleRawNotification` to recognize v2 `item.type === 'collabAgentToolCall'` so spawn events on the v2 path reach the reducer alongside the legacy `codex/event` path.

**Acceptance Criteria:**
- [ ] `handleRawNotification` (around line 324 of `packages/happy-cli/src/codex/codexAppServerClient.ts`) gets new cases for `item/started` and `item/completed` with `item.type === 'collabAgentToolCall'`, surfacing typed spawn-begin / spawn-end events via the existing `setEventHandler`.
- [ ] `params.threadId` (camelCase, matching the existing v2 wire convention) is preserved on emitted `agent_message` events so the reducer can update `lastTaskMessage` for the correct child.
- [ ] Legacy `CollabAgentSpawnBegin` / `CollabAgentSpawnEndEvent` (snake_case) continues to reach `setEventHandler` unchanged.
- [ ] Status events derive from v2 `CollabAgentToolCall.tool` variants (`sendInput`, `wait`, `closeAgent`, `resumeAgent`) plus their legacy snake_case counterparts.
- [ ] Colocated `codexAppServerClient.test.ts` (extend if present, create if not) feeds synthetic v2 notifications and asserts the emitted typed event shape, including `threadId` preservation.
- [ ] Typecheck passes.

**Dependencies:** US-001.
**Estimated complexity:** small.

### US-004: Wire reducer + RPC + delta emission into runCodex
**Description:** As happy-cli, I want `runCodex` to own the per-session agent-tree state, register the `sessionGetAgentTree` RPC, and emit deltas over the existing Socket.IO connection so the live tree reaches happy-server.

**Acceptance Criteria:**
- [ ] `AgentTreeState` is constructed in `packages/happy-cli/src/codex/runCodex.ts` BEFORE `client.setEventHandler(...)` so the handler can write into it on the first event.
- [ ] The event handler dispatches `CollabAgentSpawnBegin` / `End` (legacy) and `collabAgentToolCall` (v2, surfaced by US-003) into `state.applyEvent(...)`.
- [ ] Each emitted delta is forwarded via a new `session.sendAgentTreeUpdate(delta)` helper added to `packages/happy-cli/src/api/apiSession.ts` (uses the existing per-session socket; `sessionId` is implicit on inbound from CLI).
- [ ] `sessionGetAgentTree` is registered via `session.rpcHandlerManager.registerHandler(...)`, matching the existing `abort` handler pattern at `runCodex.ts:501`. The handler returns `state.snapshot()`.
- [ ] `handleKillSession` (`runCodex.ts:465-498`) clears state and unregisters the RPC.
- [ ] `packages/happy-cli/src/api/types.ts` declares the `agent-tree-update` emit signature on the typed socket surface for both directions: CLI-to-server payload is `{ delta }` (no `sessionId`); server-to-client payload is `{ sessionId, delta }`.
- [ ] New `packages/happy-cli/src/codex/runCodex.agentTree.test.ts` (NOT gated by `RUN_CODEX_INTEGRATION`; uses a controlled `CodexAppServerClient` stand-in) asserts:
  - [ ] `sessionGetAgentTree` is registered on `session.rpcHandlerManager` after boot.
  - [ ] Calling that registered RPC returns a snapshot matching the in-memory reducer.
  - [ ] A synthesized spawn-begin event flowing through the real `setEventHandler` triggers `sendAgentTreeUpdate`.
  - [ ] `handleKillSession` unregisters the RPC and clears state.
- [ ] Typecheck passes for happy-cli.

**Dependencies:** US-002, US-003.
**Estimated complexity:** medium.

### US-005: Server-side authorization, validation, and fan-out
**Description:** As happy-server, I want to receive `agent-tree-update` frames from authorized session-scoped CLI sockets, validate them, and fan them out only to clients watching the same session.

**Acceptance Criteria:**
- [ ] `packages/happy-server/sources/app/api/socket/sessionUpdateHandler.ts` adds an `agent-tree-update` socket-event handler that rejects unless `connection.connectionType === 'session-scoped'`. The trusted `sessionId` is read from `connection.sessionId` (set at socket-auth time in `socket.ts:71`), NEVER from the client payload — the inbound CLI payload is `{ delta }` only.
- [ ] Handler validates the `{ delta }` payload with the Zod schema re-exported from `@slopus/happy-wire`.
- [ ] On valid frame, calls `eventRouter.emitAgentTreeUpdate({ userId, sessionId: connection.sessionId, delta })`.
- [ ] `packages/happy-server/sources/app/events/eventRouter.ts` adds `emitAgentTreeUpdate({ userId, sessionId, delta })` with signature mirroring `emitUpdate` / `emitEphemeral` (lines 242-253), using `recipientFilter: { type: 'all-interested-in-session', sessionId }` so it routes to `user:${userId}:session:${sessionId}` AND `user:${userId}:user-scoped` (per the existing routing at lines 372-380). Does NOT write to the replay buffer.
- [ ] The OUTBOUND frame the server emits to clients carries `{ sessionId, delta }` so user-scoped subscribers can demultiplex.
- [ ] `RoutedSocketEvent.eventName` and the `publish` / `emitToLocalSink` / `EventRouter` interface unions widen from `'update' | 'ephemeral'` to also include `'agent-tree-update'`.
- [ ] `eventRouter.test.ts` covers: (1) positive delivery to `FakeSocket` joined to `user:${userId}:session:${sessionId}`, (2) positive delivery to `FakeSocket` joined to `user:${userId}:user-scoped`, (3) no delivery to `FakeSocket` joined only to `user:${userId}:machine:${otherMachineId}`.
- [ ] New `packages/happy-server/sources/app/api/socket/sessionUpdateHandler.test.ts` asserts that an `agent-tree-update` frame from a `connectionType !== 'session-scoped'` connection is dropped and does NOT reach `eventRouter`.
- [ ] Typecheck passes for happy-server.

**Dependencies:** US-001.
**Estimated complexity:** medium.

### US-006: End-to-end acceptance test using the real codex CLI
**Description:** As the project, I want a primary acceptance test in `codex.integration.test.ts` that uses the real codex CLI to spawn 2 sub-agents and proves the live tree reaches the CLI's delta stream and snapshot RPC. Per `packages/happy-cli/agents.md`, mocked tests do not count as primary acceptance.

**Acceptance Criteria:**
- [ ] `packages/happy-cli/src/codex/codex.integration.test.ts` gains a new long-form test, guarded by `RUN_CODEX_INTEGRATION === "1"`, that boots a real codex app-server through the existing test rig and asks the agent to spawn 2 sub-agents (child B nested under child A under root).
- [ ] The test mounts an in-test bridge: constructs the production `AgentTreeState` reducer, hands the real `CodexAppServerClient.setEventHandler` callback through the same dispatch the production `runCodex.ts` uses, and captures emitted deltas through a fake `sendAgentTreeUpdate` sink.
- [ ] Captured deltas contain the **ordered subsequence** `pending-spawn-started(A) → node-added(A) → pending-spawn-started(B) → node-added(B)` (additional interleaved `node-status-changed` deltas are tolerated; model nondeterminism is bounded by a per-spawn timeout ≤120s).
- [ ] `seq` values are strictly increasing across the captured stream.
- [ ] `state.snapshot()` returns a topology with `nodes` containing exactly A and B (root is excluded per `AgentRegistry.live_agents()` semantics) and `edges` `[{parent: rootThreadId, child: A.threadId}, {parent: A.threadId, child: B.threadId}]`.
- [ ] Test invocation on Windows / Git Bash: `RUN_CODEX_INTEGRATION=1 npm_config_script_shell=bash pnpm --filter happy exec vitest run src/codex/codex.integration.test.ts`. Requires `OPENAI_API_KEY` (or equivalent codex auth) in environment.
- [ ] Prompts are deterministic (e.g., "spawn one explorer named A and instruct A to spawn one explorer named B").

**Dependencies:** US-001..US-005.
**Estimated complexity:** large.

### US-007: Doc updates with overview.html regeneration
**Description:** As a planning artifact, I want `plans/agent-view-research.md` and `plans/codexu-roadmap.md` to reflect the delivered task, and `plans/overview.html` regenerated so the markdown-authoritative / HTML-derivative invariant holds within the single commit.

**Acceptance Criteria:**
- [ ] `plans/agent-view-research.md` §6 `agent-tree-rpc` row gets a "Delivered (branch <branch-name>)" marker — no SHA (a commit cannot contain its own SHA).
- [ ] `plans/codexu-roadmap.md` recent-deliveries / Phase status section gets a one-line entry.
- [ ] `plans/parallel-assignments.md` task entry (~line 372) and status table (~line 566) for `agent-tree-rpc` move from "🟡 in progress" to "✅ done". The downstream `agent-status-stream` guidance (~line 427) is verified consistent with the wire semantics shipped here.
- [ ] `plans/overview.html` is regenerated from the updated markdown in the same commit (per `plans/codexu-roadmap.md:5-9`).
- [ ] Pre-commit verification: `git diff --name-only -- codex/external/repos/codex-patched` returns empty AND `git diff --submodule=diff -- codex` reports no content delta inside the submodule.
- [ ] All changes land as a single commit on `main`.

**Dependencies:** US-001..US-006.
**Estimated complexity:** small.

## 4. Functional Requirements

- **FR-1:** The system must expose a session-scoped RPC `sessionGetAgentTree(sessionId)` that returns `{ nodes: AgentTreeNode[], edges: AgentTreeEdge[], seq: number }`.
- **FR-2:** The system must emit a `agent-tree-update` Socket.IO frame for every state change to the agent tree, carrying a single `AgentTreeDelta` and a monotonically increasing `seq`.
- **FR-3:** The reducer must dedup spawn events by `(callId, phase)` so the same spawn observed on both the legacy `codex/event` path and the v2 `collabAgentToolCall` item path mutates the tree only once.
- **FR-4:** Spawn-begin events (which lack a child `threadId`) must produce a `pending-spawn-started` delta keyed by `callId`. The corresponding `node-added` delta is emitted only on spawn-end, when the real child `threadId` is known.
- **FR-5:** `closeAgent` must remove the target node and all live descendants tracked in the local `nodes` map; one `node-removed` delta is emitted per node in descendants-first order, each delta carrying its own incremented `seq`.
- **FR-6:** The server inbound socket handler must reject `agent-tree-update` frames unless the connection is `connectionType === 'session-scoped'`. The authoritative `sessionId` is always read from `connection.sessionId`, never from the client payload.
- **FR-7:** The server outbound `agent-tree-update` frame must carry `{ sessionId, delta }` so user-scoped subscribers receiving events for multiple sessions can demultiplex.
- **FR-8:** The server must NOT write `agent-tree-update` frames to the replay buffer. Clients reconcile after reconnect by calling `sessionGetAgentTree` for a snapshot and forward-applying any subsequent deltas with `delta.seq > appliedSeq`.
- **FR-9:** `runCodex` must initialize `AgentTreeState` BEFORE calling `client.setEventHandler(...)`, register `sessionGetAgentTree` on `session.rpcHandlerManager` after setup, and clear state plus unregister the RPC in `handleKillSession`.
- **FR-10:** All new Zod schemas live in `packages/happy-wire/src/agentTree.ts` and are re-exported from `packages/happy-wire/src/index.ts`.
- **FR-11:** `plans/overview.html` must be regenerated from the updated markdown sources in the same commit per `plans/codexu-roadmap.md:5-9`.
- **FR-12:** No file under `codex/external/repos/codex-patched/` may be modified.

## 5. Non-Goals (Out of Scope)

- Any change under `codex/external/repos/codex-patched/` (Rust submodule is read-only).
- Mobile UI (`packages/happy-app/sources/app/(app)/session/[id]/agents.tsx`) consumption of the new RPC + stream — explicitly a future follow-up.
- Replay / persistence of agent-tree state in happy-server's DB. Clients always re-RPC on reconnect.
- Authoritative `lastTaskMessage`. Codex's app-server protocol does not expose it; the field is optional in the wire schema and populated best-effort from spawn-begin prompts + observed `agent_message` items.
- Cross-session aggregation. Each session owns its own tree.
- A `thread/read` typed helper on `codexAppServerClient.ts` to recover nickname/role when only v2 events are observed. Deferred — would expand scope beyond the single-commit constraint. Today legacy events still emit nickname/role; if codex drops legacy events in the future, the AC loosens to "field may be null" rather than blocking on this helper.

## 6. Design Considerations

- **Reuse existing patterns:** RPC registration uses `session.rpcHandlerManager.registerHandler(...)` exactly as `runCodex.ts:501` does for `abort`. Fan-out signature mirrors `emitUpdate` / `emitEphemeral` shape at `eventRouter.ts:242-253`.
- **Single-writer ordering:** `setEventHandler` callback is invoked sequentially by `CodexAppServerClient`. The reducer mutates synchronously and emits deltas in the same step — no queueing, no `setImmediate`, no `Promise.resolve().then(...)`.
- **Snapshot / stream race:** snapshot carries `seq`; every delta carries `seq`. Clients track `appliedSeq` and ignore `delta.seq <= appliedSeq`.
- **Distinct frame vs reusing `ephemeral`:** the plan adds a third `agent-tree-update` frame rather than tunneling through `ephemeral`. Trade-off: clearer client-side (no payload-type discrimination) at the cost of a one-time socket-contract extension in `packages/happy-cli/src/api/types.ts`. The single-user embedded-daemon posture (per `packages/happy-server/CLAUDE.md`) makes the contract change low-risk.
- **No UI in this commit:** mobile-app consumption is deferred.

## 7. Technical Considerations

- **Build order:** `happy-wire` compiles before `happy-cli` / `happy-server` (already wired via `workspace:*` in their `package.json`).
- **Cross-package typecheck command:** the repo root has no `pnpm build` script. Use `pnpm --filter @slopus/happy-wire build && pnpm --filter happy build && pnpm --filter happy-server build`, or `pnpm -r build` for a full workspace build. On Windows / Git Bash prepend `npm_config_script_shell=bash`.
- **Parser location:** v2 `item/*` parsing lives in `handleRawNotification` (around line 324 of `codexAppServerClient.ts`), NOT in `handleNotification` at line 1701 — the latter only dispatches to `handleRawNotification` first then falls through to legacy `codex/event`.
- **Typed socket contract site:** the actual typed socket contract lives in `packages/happy-cli/src/api/types.ts`. `packages/happy-server/sources/app/api/socket.ts` uses untyped Socket.IO and only needs Zod payload validation.
- **`watch::Receiver` pitfall:** Codex's Rust `subscribe_status(agent_id) -> watch::Receiver<AgentStatus>` cannot be held directly by Node. The Node-side analog is the existing JSON-RPC notification stream on `CodexAppServerClient`, which must remain subscribed across the entire session lifetime. Do NOT re-register the event handler inside a per-turn / per-tool callback — that would silently drop spawn events after the first turn.
- **Memory:** state cleared in `handleKillSession` before `client.disconnect()`. Bounded by live-agent count (<100 typical).

## 8. Success Metrics

- AC1: cross-package typecheck green for `@slopus/happy-wire`, `happy`, and `happy-server`.
- AC4 (primary, per `packages/happy-cli/agents.md`): the real-codex integration test passes with the asserted ordered subsequence and topology.
- AC4a / AC4b / AC4c: parser, server authorization, and runCodex-glue support tests pass.
- AC2 / AC3: reducer + fan-out unit tests pass.
- AC5: no file under `codex/external/repos/codex-patched/` is modified (verified via `git diff --name-only -- codex/external/repos/codex-patched` AND `git diff --submodule=diff -- codex`).
- AC6 / AC7 / AC8 / AC9: single commit on `main`; `plans/agent-view-research.md`, `plans/codexu-roadmap.md`, `plans/parallel-assignments.md`, and `plans/overview.html` all updated in that commit.

## 9. Open Questions

All design decisions are documented inline in the plan; no blocking open questions remain. The non-blocking choices recorded for reviewers:

- **`lastTaskMessage` strategy:** derive an initial value from the spawn-begin prompt; subsequent `agent_message` items on the child thread update the field. The wire schema marks it optional and AC4 does NOT assert on it. Future codex-side enhancement to expose `AgentMetadata.last_task_message` via the app-server protocol is tracked separately.
- **Nickname / role fallback:** v2 `CollabAgentToolCall` does NOT carry nickname/role; legacy `collab_agent_spawn_end` does. Strategy: legacy-event best-effort; if only v2 is observed, leave both fields null. A `thread/read` typed helper is deferred (see Non-Goals).
- **Dedup vs metadata merge:** when both v2 and legacy spawn-end arrive for the same `(callId, phase)`, the reducer emits only one structural delta but MAY merge the richer metadata (nickname/role from legacy) into the existing node WITHOUT producing an additional delta. Three reducer-test cases cover this (v2-first/legacy-second, legacy-first/v2-second, repeated identical event).
- **Pending spawn-begin without child threadId:** emit `pending-spawn-started` keyed by `callId`; `node-added` emits only on spawn-end with the real child `threadId`. The 4-delta ordering (`pending-A, added-A, pending-B, added-B`) is what AC4 asserts.
- **`closeAgent` subtree semantics:** codex's `closeAgent` closes the target AND its live descendants. Reducer emits one `node-removed` per node in descendants-first order. Covered by reducer test.
