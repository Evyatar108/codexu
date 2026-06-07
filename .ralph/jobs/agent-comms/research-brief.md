# Research Brief: agent-comms (top-level-agent <-> top-level-agent communication)

## Researcher / self findings (verified file:line)
- **Scope B substrate is SETTLED by async-events-design** (`.ralph/jobs/async-events-design/plan.md`): durable filesystem mailbox + channel wake. `packages/happy-cli/src/agentComms/mailbox.ts` (`appendMessage`/`readPending`/`markConsumed`), daemon `POST /agent-comms/send` in `controlServer.ts`, `controlClient.sendAgentMessage`, producer wake in `happyMcpStdioBridge.ts` (`fs.watch` -> `resource_updated`), startup `agentComms/recovery.ts`, MCP tool `agent_comms.send {targetSessionId, body}`. Sink = `<happyHomeDir>/agent-comms/inboxes/<sessionId>/mailbox.json` (+ `history.jsonl`). **Design AROUND this; do not redesign.**
- **Scope C substrate already exists** (`packages/happy-cli/AGENTS.md`, `spawnSessionFromSession.ts`): `spawn-session-from-session` RPC + Codex `spawn_top_level_session` via daemon HTTP route `/spawn-session-from-session`; `validateSpawnAncestry()` @50-86 with `MAX_SPAWN_DEPTH=10`; `HAPPY_PARENT_SESSION_ID` @125-131; `metadata.parentSessionId` + `metadata.spawnedChildren` @143-145.
- **Scope A reality** (`packages/happy-server/AGENTS.md`): happy-server embedded per-daemon, ONE user/process; hosted relay DELETED (operator policy); Dev Tunnels gateway = existing cross-machine transport (`X-Tunnel-Authorization: tunnel <jwt>`); `eventRouter.ts` rooms are process-scoped (no cross-daemon routing).

## Architect findings (gpt-5.4-mini explore, file:line)
- **tunnelManager.ts:121-325** — tunnel config `~/.happy/tunnel.json`; tunnel name **`codexu-<hostname>`** @155-157 (deterministic = "well-known per-identity tunnel"); CLI: `devtunnel user login -g` @181-189 (GitHub, same operator on both daemons), `create --expiration 30d --json`, `port create --port-number <p> --protocol http`, `host <id>`, `show <id> --json`, `update`; injected `CommandRunner`/`ProcessSpawner` @24-51. **No list/token subcommands used yet** — discovery (`devtunnel list`) + connect-token mint (`devtunnel token`) are NEW capabilities to add.
- **controlServer.ts:29-299** — binds **loopback-only** `127.0.0.1` @280-297; routes `/session-started /list /stop-session /spawn-session /spawn-session-from-session /stop`; **no auth header checks** (loopback-gated by `X-Loopback-Capability` on the client `daemonClient.ts:114-132`; `tunnelFetch()` does NOT add it @134-140). => Scope A ingest CANNOT live on the control server; must be a happy-server route reachable via the tunnel.
- **persistence.ts:229-296** — operator key material: `access.key` (GitHub device-flow token + `dataKey {publicKey, machineKey, token}`), `machine.json {machineId, tunnelPort, loopbackPort, tunnelId, lastTunnelUrl}`. **machineKey/publicKey is PER-MACHINE, not shared** => app-layer trust anchor must be operator-tunnel-ownership + TOFU peer-key pinning, NOT a shared static secret. `encryption.ts:55-60,199-213` E2E/TOFU helpers.
- **multi_agents_v2** (read-only): `spawn_agent`, `send_message` (queue-only), `wait_agent` (mailbox seq-watch via `watch::Receiver`), `close_agent`. Confirms Scope A/C tool analogs; no codex edits needed.
- **vitest** `packages/happy-cli/vitest.config.ts` — unit project excludes `src/**/*.integration.test.ts`; integration files explicitly listed. Plain `.test.ts` for unit; `agentComms/*.test.ts` is the home.

## Copilot research findings
- Recommends ONE logical envelope with scope-aware adapters (not 3 APIs); envelope belongs in **happy-wire** (sender/target session, channel kind, request/reply correlation, hop counter, parent-capability fields).
- Flags a real gap: **`spawn-session-from-session` accepts `initialMessage` but `spawnSessionFromSession.ts` does NOT pass it to `spawnSession`** — spawned children can't receive an initial prompt. Fix in the Scope C slice (the "known channel from spawn time").
- Notes an alternative Scope B substrate (`/v3/sessions/:id/messages` encrypted persisted messages via `v3SessionRoutes.ts` + `eventRouter` + `ApiSessionClient.fetchMessages()`). CONSIDERED-AND-DEFERRED: operator directive pins Scope B to the async-events filesystem mailbox; the v3 path is noted as a future alternative.
- (Copilot ran on the raw seed and still listed mobile-broker for Scope A; OVERRIDDEN by the operator's Dev-Tunnels-only decision.)

## Codex research
- **FAILED: timed out (exit 124)** — codex-exec research lens hung on this Windows box. Surfaced to lead as kind=progress; proceeded without it. Coverage unaffected (architect + copilot + direct reads sufficient).

## Operator decision (HARD, security-critical)
Scope A = daemon-to-daemon over Microsoft Dev Tunnels END-TO-END, SOLE channel for data + signaling + discovery + auth. NOTHING transits mobile app or happy-server. Mobile-broker + relay rejected. Keep unified scope-aware API. Resolve in-plan: tunnel discovery/naming without 3rd-party rendezvous, and the over-tunnel auth model.

## Consolidated file list
**Create:** happy-wire/src/agentComms.ts; happy-cli/src/agentComms/router.ts(+test); happy-cli/src/agentComms/peerTransport.ts; happy-cli/src/agentComms/peerAuth.ts; happy-cli/src/agentComms/scopeC.test.ts; happy-server agentCommsIngestRoutes.ts; plans/agent-comms-design.md.
**Modify:** happy-cli/src/codex/happyMcpStdioBridge.ts (generalize agent_comms.send + add agent_comms.spawn); happy-cli/src/daemon/spawnSessionFromSession.ts (initialMessage fix); happy-cli/src/tunnel/tunnelManager.ts (listOperatorTunnels + mintConnectToken); daemon createHappyServer wiring (inject ingest->mailbox handler).
**Depends-on (parallel):** async-events-design mailbox.ts/recovery.ts/daemon route.
