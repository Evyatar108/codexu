# Research Brief: agent-comms Scope A live cross-machine wiring

## Consolidated File List (verified file:line)
**Inbound (ALREADY WIRED end-to-end):**
- `packages/happy-server/sources/app/api/api.ts:115` — `agentCommsIngestRoutes(typed, { handler: options.agentCommsIngest })` registered on the TUNNEL listener only (`auth !== "loopback"`).
- `packages/happy-server/sources/app/api/routes/agentCommsIngestRoutes.ts:11-70` — skeleton route: `AgentCommsIngestBodySchema` (envelope+signature+senderKeys), `routeHopValidation`, 503 if no handler, 400 on handler throw.
- `packages/happy-cli/src/types/happy-server.d.ts:42-90` — `HappyServerConfig`/`HappyServerSharedContext` already declare `agentCommsIngest`.
- `packages/happy-cli/src/daemon/run.ts:219-241` — `agentCommsIngest` closure: `requirePinnedPeer` → fingerprint+pubkey match → `verifyEnvelopeSignature` → `openSealedBody` → `advanceAgentCommsRelay` (relay id `daemon-<machineId>`) → target-machine check → `appendMessage`. Injected via `sharedContext` at run.ts:242-249.
- `packages/happy-cli/src/daemon/dualListenerBinding.ts:36-89` — embedded happy-server created twice (tunnel auth=`tunnel` port=`state.tunnelPort`; loopback). `sharedContext` (incl. `agentCommsIngest`) flows into both via `create({...shared,...})`.

**Outbound (NOT WIRED — the live gap):**
- `packages/happy-cli/src/daemon/controlServer.ts:275-348` — `/agent-comms/send` calls `dispatchAgentCommsEnvelope` with ONLY `deliverLocal` (line 335). Scope A → `agent_comms_remote_transport_unavailable` → **501** (lines 339-345). No `deliverRemote` injected.
- `packages/happy-cli/src/agentComms/router.ts:191-206` — `dispatchAgentCommsEnvelope` throws `agent_comms_remote_transport_unavailable` for scope A when `deliverRemote` absent. `requiresOperatorApproval(envelope)` (router.ts:187-189) = scope A && (channel `spawn` || kind `spawn-request`) — EXISTS but enforced NOWHERE.
- `packages/happy-cli/src/agentComms/peerTransport.ts:44-84` — `DevTunnelsPeerTransport`: `ingestUrl()` (line 44-47) = `tunnel.tunnelUrl ?? ports.find(portUri)?.portUri` + `/agent-comms/ingest`; `listReachablePeers()` (returns tunnel hints, NO authoritative machineId); `send(SignedSealedEnvelope, target)` mints connect token + POSTs with `X-Tunnel-Authorization`. Takes an ALREADY signed+sealed envelope — outbound seal/sign is built nowhere yet.
- `packages/happy-cli/src/codex/agentCommsBridge.ts:199-244` — MCP `agent_comms.spawn`: with `machineId` returns `{type:'deferred-scope-a-spawn', requiresOperatorApproval:true,...}` isError — NO live spawn-request sent. `agent_comms.send` (145-179) passes through to injected `sendMessage` daemon hop (foreign machineId already flows through to the daemon).

**Crypto / keys (reuse as-is):**
- `packages/happy-cli/src/agentComms/peerAuth.ts:53-131` — `signEnvelope`, `verifyEnvelopeSignature`, `sealBody`, `openSealedBody`, `pinPeerKeys`, `requirePinnedPeer`, peer pin store at `<happyHomeDir>/agent-comms/peers.json` (keyed by machineId; stores ed25519/ecdh pub + fingerprint + pinnedAt — NO tunnel hint).
- `packages/happy-cli/src/tofu/keypairManager.ts:31-38` — keypairs stored DIRECTLY under `<happyHomeDir>`: `server-key.{pub,priv}`, `ecdh-key.{pub,priv}`. **DOC DRIFT: design §8.1 says `<happyHomeDir>/tofu/server-key...` — stale.**
- `packages/happy-wire/src/agentComms.ts:10-63` — `MAX_HOPS=4`; `AgentCommsChannel='message'|'spawn'`; `AgentCommsKind=request|reply|notify|spawn-request|spawn-result`; `AgentCommsEnvelopeSchema` (body `unknown`).

**Tunnel lifecycle:**
- `packages/happy-cli/src/tunnel/tunnelManager.ts:317-352` — `startHost` (one `devtunnel host <tunnelId>` process, detached, error/exit logging, no readiness modeling); `listOperatorTunnels(prefix='codexu-')` via `devtunnel list --json`; `mintConnectToken` via `devtunnel token <id> --scope connect`. `ensurePort` uses `--port-number` (not `--port`). Single port per tunnel.
- `packages/happy-cli/src/tunnel/provider.ts` — `DaemonTunnelProvider` interface single-port (`createHostTunnel`/`loadHostTunnel`/`stop`). `TunnelConfig`/`MachineLocallyPersistedState` single-port.

## Test infrastructure
- Vitest. happy-cli: `pnpm --filter happy typecheck|build|test`. happy-server: `pnpm --filter happy-server typecheck|build|test`. happy-wire: `pnpm --filter @slopus/happy-wire test`. Windows/Git Bash: `npm_config_script_shell=bash pnpm --filter happy test`.
- Existing relevant tests: `peerAuth.test.ts`, `peerTransport.test.ts`, `router.test.ts`, `scopeB.test.ts`, `scopeC.test.ts`, `agentCommsIngestRoutes.spec.ts`.
- **Harness model:** `packages/happy-cli/src/agentComms/mailbox.crossProcess.integration.test.ts` — `*.integration.test.ts` in SERIAL vitest project `integration-agent-comms` (maxWorkers:1); forks real OS processes with temp `HAPPY_HOME_DIR`, contends on the cross-process mailbox lock. This is the two-daemon-harness precedent.

## D-004 verdict (4-source convergence: architect + codex + copilot + first-hand)
**CO-LOCATED** on the existing happy-server tunnel port. Ingest already rides the single forwarded port (api.ts:115 on the hosted tunnel listener); `ingestUrl()` + §5.3 `devtunnel list --json` discovery stay byte-for-byte unchanged. A SECOND port would force `ports[]` disambiguation, change `ingestUrl()` selection + §5.3 semantics, and widen `machine.json`/`TunnelConfig`/provider to multi-port. Co-located keeps the D-001 seam compatible regardless of ship order (D-001 NOT shipped; this task targets the current happy-server ingest route). Copilot's refinement: structure the peer-target type so a future second-port switch is a small follow-up.

## Open technical questions for the plan
1. **Peer→tunnel mapping source (D-005):** the pin store has no tunnel hint and `listReachablePeers()` has no authoritative machineId. Need a `machineId → PeerTransportTarget{tunnelId, ingestUrl, ecdhPub}` resolver. Recommend: operator-authored peer config carrying `tunnelName`, joined to `listOperatorTunnels()` at send time (never derive machineId from `codexu-<hostname>`; design §8.2). listOperatorTunnels/mintConnectToken UNCHANGED.
2. **TOFU first-contact auto-exchange:** none today; `requirePinnedPeer` throws if absent (inbound). v1 requires peers PRE-PINNED (operator-authored peers.json / one-time pin step) per design §8.1 prereq. Auto-exchange = follow-up.
3. **Approval gate model (headless):** default-deny + allowlist of approved peer machineIds + pending-approval persistence; only approved → `spawnSessionFromSession`. Fail closed.
4. **Harness hermeticity:** inject `FetchLike` (+ `CommandRunner`) to hit a second in-process happy-server (or the injected handler directly) on loopback; pre-pin fixture keys both ways; assert remote `appendMessage`. Genuinely un-testable in CI: real `devtunnel host` + gateway connect-token admission → covered by TunnelManager unit tests + opt-in live §8 smoke script.
5. **Schema relocation to happy-wire:** OUT OF SCOPE (D-001 owns it); keep handler contract compatible.
