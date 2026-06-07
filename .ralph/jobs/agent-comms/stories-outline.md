# Stories Outline: agent-comms — unified top-level-agent ↔ top-level-agent communication

*Preliminary decomposition from `/plan-with-ralph`. Feed to `/implement-with-ralph --from-plan` for PRD generation.*
*Scope A is NAMED + design-level only this pass (no full cross-machine network impl). The `scope-bc` cluster is HARD-gated on the parallel `async-events-design` mailbox landing on `origin/main`.*

## US-001: Design doc — unified agent-comms architecture
**Description:** As a maintainer, I want a design doc capturing the unified scope-aware comms model so future impl + review have a single reference.
**Acceptance Criteria:**
- [ ] `plans/agent-comms-design.md` documents: the unified API (SPAWNING + MESSAGE PASSING), the `AgentCommsEnvelope`, scope-aware routing, all three scopes, the Scope A Dev-Tunnels transport (discovery via `devtunnel list`/`codexu-<hostname>` + dual-layer auth, nothing through phone/happy-server), and cross-scope cycle prevention.
- [ ] Includes a "Manual two-machine smoke" section with exact `devtunnel list --json`/`devtunnel token` commands, expected JSON, the `POST /agent-comms/ingest` curl shape (Ed25519-signed + sealed body), and explicit non-goals.
- [ ] Cross-references `plans/durable-mailbox-channel-wake.md` (async-events Scope B substrate).
**Dependencies:** None
**Estimated complexity:** medium

## US-002: Shared `AgentCommsEnvelope` wire schema
**Description:** As a developer, I want one envelope schema in happy-wire so all scopes share a transport contract.
**Acceptance Criteria:**
- [ ] `packages/happy-wire/src/agentComms.ts` defines `AgentCommsEnvelope` (Zod) with `v, id, ts, from{machineId,sessionId}, to{machineId?,sessionId}, scope, channel, kind, correlationId?, hopCount, hopPath, body` + scope/kind enums + `MAX_HOPS` constant.
- [ ] Exported from `packages/happy-wire/src/index.ts` and importable by happy-cli + happy-server.
- [ ] Unit tests for schema parse/reject; `pnpm --filter @slopus/happy-wire build` typechecks green.
**Dependencies:** None
**Estimated complexity:** small

## US-003: Scope-aware router
**Description:** As the comms layer, I want `resolveScope(from,to)` + dispatch so a single send path routes to B/C/A correctly with cycle prevention.
**Acceptance Criteria:**
- [ ] `packages/happy-cli/src/agentComms/router.ts` implements `resolveScope` (local self/parent-child → B/C; foreign machineId → A) + dispatch + hop/cycle checks.
- [ ] Unit tests: scope resolution per target; `hopCount > MAX_HOPS` rejected; `hopPath` loop (target already in path) rejected.
- [ ] Typecheck passes.
**Dependencies:** US-002
**Estimated complexity:** medium

## US-004: Scope B unified-API layer (over async-events mailbox)
**Description:** As two top-level sessions on one daemon, we want to exchange a message via the unified `agent_comms.send` API.
**Acceptance Criteria:**
- [ ] `agent_comms.send` (in `happyMcpStdioBridge.ts`) generalized to accept `{ target:{machineId?,sessionId}, body, kind }` and route through the router to the async-events mailbox (`controlServer.ts` local `/agent-comms/send` wired through the router).
- [ ] Scope B fixture: two sessions on one daemon exchange a message via `agent_comms.send` → mailbox → target reads. (Requires async-events `mailbox.ts` on `origin/main`; name the prerequisite or `it.skip` with a documented reason if absent.)
- [ ] Typecheck passes; `npm_config_script_shell=bash pnpm --filter happy test` passes for touched files.
**Dependencies:** US-002, US-003, **async-events-design mailbox (origin/main)**
**Estimated complexity:** medium

## US-005a: `initialMessage` propagation fix (independent)
**Description:** As a parent spawning a child, I want the spawn's `initialMessage` to actually reach the child (pre-existing bug).
**Acceptance Criteria:**
- [ ] `initialMessage?: string` added to `SpawnSessionOptions` (`modules/common/registerCommonHandlers.ts:120-131`) and threaded into the spawn launch.
- [ ] `daemon/spawnSessionFromSession.ts:126-134` passes `options.config.initialMessage` through `deps.spawnSession`.
- [ ] Test verifies a parent-supplied `initialMessage` reaches the spawned child.
- [ ] Typecheck passes.
**Dependencies:** None (async-events-independent)
**Estimated complexity:** small

## US-005b: Scope C parent/child reference shortcut + fixture
**Description:** As a spawned child, I want to report to my parent without a re-handshake, using the link known from spawn time.
**Acceptance Criteria:**
- [ ] Router recognizes a known parent↔child edge (via `metadata.parentSessionId`/`spawnedChildren`) and tags Scope C, skipping any target-existence handshake.
- [ ] Scope C fixture: a spawned child sends to `HAPPY_PARENT_SESSION_ID`; the parent mailbox receives it; assert NO discovery/handshake step occurs (parent inbox pre-exists from spawn).
- [ ] Typecheck passes; touched-file tests pass.
**Dependencies:** US-003, US-004, US-005a, **async-events-design mailbox (origin/main)**
**Estimated complexity:** medium

## US-006: Scope A named Dev-Tunnels transport (design-level)
**Description:** As the comms layer, I want a concrete cross-machine transport named + interfaced (no live networking this pass).
**Acceptance Criteria:**
- [ ] `TunnelManager.listOperatorTunnels()` (`devtunnel list --json`) + `mintConnectToken(tunnelId)` (`devtunnel token … --scope connect`) added with `CommandRunner`-injected unit tests (no real tunnels).
- [ ] `agentComms/peerTransport.ts` (Dev Tunnels client interface) + `agentComms/peerAuth.ts` using `TofuKeypairs` (Ed25519 `server-key` sign + ECDH `ecdh-key` seal) and a `machineId`→pinned-peer-key TOFU store — NOT the credentials `machineKey`; unit-tested sign/verify + seal/open round-trip with fixture keys.
- [ ] happy-server `POST /agent-comms/ingest` route skeleton (backend auth = Ed25519 signature vs pinned peer key + sealed-box decrypt + hop checks; the stripped `X-Tunnel-Authorization` is NOT re-checked) delegating to an injected handler.
- [ ] `agentCommsIngest` callback slot added to `HappyServerConfig` + `packages/happy-cli/src/types/happy-server.d.ts`.
- [ ] Router A-path unit test (foreign `machineId` → Scope A) + the design doc's manual smoke section.
- [ ] Typecheck passes for happy-cli + happy-server.
**Dependencies:** US-002, US-003
**Estimated complexity:** large

## US-007: `agent_comms.spawn` (SPAWNING channel) + cross-scope cycle gate
**Description:** As a top-level agent, I want to request another top-level agent be spawned (with role/cwd/plugins), locally now and cross-machine by design.
**Acceptance Criteria:**
- [ ] `agent_comms.spawn { role, cwd, plugins, agent, machineId?, initialMessage? }` MCP tool (in `happyMcpStdioBridge.ts`); local spawns reuse `spawn-session-from-session`.
- [ ] Cross-machine spawn-request path designed: gated by an operator-approval gate + hop counter (A-spawns-B-spawns-A loop prevented); remote spawn execution deferred with the Scope A network.
- [ ] Typecheck passes; touched-file tests pass.
**Dependencies:** US-003, US-005a, US-005b
**Estimated complexity:** medium
