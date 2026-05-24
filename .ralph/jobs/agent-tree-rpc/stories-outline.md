# Stories Outline: agent-tree-rpc

*Preliminary decomposition from `/plan-with-ralph`. Feed to `/implement-with-ralph --from-plan` for PRD generation.*

## US-001: Shared wire types for the agent tree
**Description:** As an implementer working in either happy-cli or happy-server, I want a single source of truth for `AgentTreeNode`, `AgentTreeEdge`, `AgentTreeSnapshot`, and the `AgentTreeDelta` union so both ends compile against the same Zod schemas.
**Acceptance Criteria:**
- [ ] New file `packages/happy-wire/src/agentTree.ts` defines Zod schemas for `AgentTreeNode` (threadId, agentRole, nickname, status, lastTaskMessage?, spawnedAt), `AgentTreeEdge` ({parent, child}), `AgentTreeSnapshot` ({nodes, edges, seq}), and `AgentTreeDelta` union (`pending-spawn-started | node-added | node-status-changed | node-removed`), plus inferred TypeScript types.
- [ ] `packages/happy-wire/src/index.ts` re-exports the new module.
- [ ] `pnpm --filter @slopus/happy-wire build` is green.
- [ ] Typecheck passes for the package.
**Dependencies:** None.
**Estimated complexity:** small.

## US-002: Pure reducer for the agent-tree state
**Description:** As the happy-cli runtime, I want a deterministic in-memory reducer that consumes typed `AgentTreeEvent` inputs and produces ordered `AgentTreeDelta` outputs + a queryable snapshot so the RPC and the delta stream stay consistent.
**Acceptance Criteria:**
- [ ] New file `packages/happy-cli/src/codex/agentTreeState.ts` exposes `applyEvent(evt)`, `snapshot()`, `clear()` over a closed-over state.
- [ ] Pending map keyed by `callId`; resolved to `node-added` on spawn-end with real `threadId`.
- [ ] `(callId, phase)` deduplication: re-applying the same begin or end produces no additional delta.
- [ ] Monotonic `seq` counter; each emitted delta and each `snapshot()` carry the current `seq`.
- [ ] `clear()` resets all state and resets `seq` to 0.
- [ ] Colocated `agentTreeState.test.ts` exercises: ordered begin/end pair, nested begin/end pair, status change, removal, dedup, seq monotonicity.
- [ ] Typecheck passes.
**Dependencies:** US-001.
**Estimated complexity:** medium.

## US-003: Codex v2 parser extension for `collabAgentToolCall`
**Description:** As happy-cli, I want `CodexAppServerClient.handleRawNotification` to recognize v2 `item.type === 'collabAgentToolCall'` so spawn events on the v2 path reach the reducer alongside the legacy `codex/event` path.
**Acceptance Criteria:**
- [ ] `handleRawNotification` (around line 324 of `codexAppServerClient.ts`) gets new cases for `item/started` and `item/completed` with `item.type === 'collabAgentToolCall'`, surfacing typed spawn-begin and spawn-end events to `setEventHandler`.
- [ ] Legacy `CollabAgentSpawnBegin/End` continues to reach `setEventHandler` unchanged.
- [ ] Colocated `codexAppServerClient.test.ts` (extend if present, create if not) feeds synthetic v2 notifications and asserts the emitted typed event shape.
- [ ] Typecheck passes.
**Dependencies:** US-001.
**Estimated complexity:** small.

## US-004: Wire reducer + RPC + delta emission into runCodex
**Description:** As happy-cli, I want `runCodex` to own the per-session agent-tree state, register the `sessionGetAgentTree` RPC, and emit deltas over the existing Socket.IO connection so the live tree reaches happy-server.
**Acceptance Criteria:**
- [ ] `AgentTreeState` is constructed in `runCodex.ts` BEFORE `client.setEventHandler(...)` so the handler can write into it on the first event.
- [ ] The event handler dispatches `CollabAgentSpawnBegin/End` (legacy) and `collabAgentToolCall` (v2, surfaced by US-003) into `state.applyEvent(...)`.
- [ ] Each emitted delta is forwarded via a new `session.sendAgentTreeUpdate(delta)` helper added to `apiSession.ts` (uses the existing per-session socket; sid is implicit).
- [ ] `sessionGetAgentTree` is registered via `session.rpcHandlerManager.registerHandler(...)` (same pattern as the existing `abort` handler at `runCodex.ts:501`), returning `state.snapshot()`.
- [ ] `handleKillSession` clears state and unregisters the RPC.
- [ ] `packages/happy-cli/src/api/types.ts` declares the `agent-tree-update` emit signature on the typed socket surface.
- [ ] Typecheck passes for happy-cli.
**Dependencies:** US-002, US-003.
**Estimated complexity:** medium.

## US-005: Server-side authorization, validation, and fan-out
**Description:** As happy-server, I want to receive `agent-tree-update` frames from authorized session-scoped CLI sockets, validate them, and fan them out only to clients watching the same session room.
**Acceptance Criteria:**
- [ ] `sessionUpdateHandler.ts` adds an `agent-tree-update` socket-event handler that rejects unless `connection.connectionType === 'session-scoped'` AND `connection.sessionId === payload.sessionId`.
- [ ] Handler validates payload with the Zod schema from `@slopus/happy-wire`.
- [ ] On valid frame, calls `eventRouter.emitAgentTreeUpdate({ userId, sessionId, delta })`.
- [ ] `eventRouter.ts` adds `emitAgentTreeUpdate({ userId, sessionId, delta })` with signature mirroring `emitUpdate` / `emitEphemeral` (lines 242-253), using `recipientFilter: { type: 'all-interested-in-session', sessionId }` so it routes to `user:${userId}:session:${sessionId}`. Does NOT touch the replay buffer.
- [ ] `eventRouter.test.ts` covers two cases: positive (frame delivered to a `FakeSocket` joined to the session room) and negative (frame NOT delivered to a `FakeSocket` joined only to a different scope).
- [ ] A new server-side test covers the authorization rejection (mismatched sessionId or wrong connectionType).
- [ ] Typecheck passes for happy-server.
**Dependencies:** US-001.
**Estimated complexity:** medium.

## US-006: End-to-end acceptance test using the real codex CLI
**Description:** As the project, I want a primary acceptance test in `codex.integration.test.ts` that uses the real codex CLI to spawn 2 sub-agents and proves the live tree reaches the CLI's delta stream and snapshot RPC. Per `packages/happy-cli/agents.md`, mocked tests do not count as primary acceptance.
**Acceptance Criteria:**
- [ ] `packages/happy-cli/src/codex/codex.integration.test.ts` gains a new long-form test that boots a real codex app-server through the existing test rig and asks the agent to spawn 2 sub-agents (child B nested under child A under root).
- [ ] The test asserts the CLI emits exactly 4 deltas: `pending-spawn-started(A) → node-added(A) → pending-spawn-started(B) → node-added(B)` with strictly increasing `seq` and correct parent linkage.
- [ ] After the spawn-end events, the test calls the `sessionGetAgentTree` RPC and asserts the response shape: `{ nodes: 2 entries (A, B), edges: [{parent: rootThreadId, child: A.threadId}, {parent: A.threadId, child: B.threadId}], seq: 4 }`.
- [ ] Test is invoked on Windows / Git Bash via `npm_config_script_shell=bash pnpm --filter happy exec vitest run src/codex/codex.integration.test.ts`.
**Dependencies:** US-001..US-005.
**Estimated complexity:** large.

## US-007: Doc updates with overview.html regeneration
**Description:** As a planning artifact, I want `plans/agent-view-research.md` and `plans/codexu-roadmap.md` to reflect the delivered task, and `plans/overview.html` regenerated so the markdown-authoritative / HTML-derivative invariant holds within the single commit.
**Acceptance Criteria:**
- [ ] `plans/agent-view-research.md` §6 `agent-tree-rpc` row gets a "Delivered (branch <branch-name>)" marker — no SHA (a commit cannot contain its own SHA).
- [ ] `plans/codexu-roadmap.md` recent-deliveries / Phase status section gets a one-line entry.
- [ ] `plans/overview.html` is regenerated from the updated markdown in the same commit (per `plans/codexu-roadmap.md:5-9`).
- [ ] Pre-commit verification: `git diff --name-only -- codex/external/repos/codex-patched` returns empty.
- [ ] All changes land as a single commit on `main`.
**Dependencies:** US-001..US-006.
**Estimated complexity:** small.
