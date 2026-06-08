# Stories Outline: Agent-comms Scope A live cross-machine wiring

*Preliminary decomposition from `/plan-with-ralph`. Feed to `/implement-with-ralph --from-plan` for PRD generation.*

## US-001: Record D-004/D-005 decisions and sync the design doc
**Description:** As a maintainer, I want the Scope A design doc updated to reflect the live-wiring decisions so future contributors read accurate state.
**Acceptance Criteria:**
- [ ] `plans/agent-comms-design.md` records **D-004 = co-located** (ingest on the existing forwarded happy-server tunnel port) with rationale and the D-001 seam-compatibility note.
- [ ] §5.6 "deferred" status is updated to reflect the now-wired pieces (outbound delivery, automated round-trip, approval gate); the manual §8 smoke and the pre-pinned-peer prerequisite are documented.
- [ ] The stale `<happyHomeDir>/tofu/server-key...` reference is corrected to the real `<happyHomeDir>/server-key.*` / `ecdh-key.*` layout (`keypairManager.ts:31-38`).
- [ ] D-005 (peer→tunnel resolver) is described.
**Dependencies:** None
**Estimated complexity:** small

## US-002: Peer resolver (machineId → PeerTransportTarget)
**Description:** As the daemon, I want to resolve a foreign `machineId` to a reachable, pinned peer target so outbound Scope A can address it without changing discovery.
**Acceptance Criteria:**
- [ ] New `packages/happy-cli/src/agentComms/peerResolver.ts` exposes `resolvePeerTarget(machineId)` returning `{ tunnelId, ingestUrl, peerEcdhPublicKey, approvedForSpawn }` by joining the pinned/operator peer config with `listOperatorTunnels()` output.
- [ ] Peer config schema carries an optional `tunnelName`/`tunnelId` hint and an `approvedForSpawn` flag; `machineId` is NEVER derived from `codexu-<hostname>` (design §8.2).
- [ ] `pinPeerKeys()` (`peerAuth.ts:102-119`) **merges** (does not drop) operator-authored `tunnelName`/`tunnelId`/`approvedForSpawn` on repin.
- [ ] `listOperatorTunnels()` and `mintConnectToken()` are unchanged (behavior + public signature).
- [ ] Unit tests with injected tunnel list + fixture pins cover resolve-hit, unknown-peer, and repin-preservation.
- [ ] Typecheck passes.
**Dependencies:** None
**Estimated complexity:** medium

## US-003: Outbound `deliverRemote` live wiring + channel/kind plumbing
**Description:** As a session, I want a Scope A `agent_comms.send` to a pinned peer to actually deliver a signed+sealed envelope over Dev Tunnels instead of returning 501.
**Acceptance Criteria:**
- [ ] `controlServer.ts` `/agent-comms/send` injects a `deliverRemote(envelope)` that resolves the target (US-002), seals `envelope.body` to the peer ECDH key (`sealBody`), signs the sealed envelope (`signEnvelope`), attaches local `senderKeys`, and calls `DevTunnelsPeerTransport.send()`.
- [ ] The `/agent-comms/send` route body schema (`controlServer.ts:277-293`) and `sendAgentMessage()` (`controlClient.ts:126-141`) are widened to carry `channel: 'message'|'spawn'` and the `spawn-request`/`spawn-result` kinds, defaulting to `message`/`request` so existing callers are unaffected.
- [ ] Scope A no longer returns 501 for a resolvable, pinned peer; an unresolved/unpinned peer still fails closed (no silent success).
- [ ] `peerTransport.ingestUrl()` selection behavior is unchanged.
- [ ] Typecheck + existing `peerTransport.test.ts`/`tunnelManager` tests pass unmodified.
**Dependencies:** US-002
**Estimated complexity:** medium

## US-004: Co-located host-lifecycle verification
**Description:** As the daemon, I want assurance the co-located ingest is reachable on the already-hosted tunnel and the host lifecycle is clean.
**Acceptance Criteria:**
- [ ] A regression test confirms `dualListenerBinding` + `DevTunnelsDaemonProvider.loadHostTunnel`/`TunnelManager.startHost` start the host and register `/agent-comms/ingest` on the tunnel-auth listener.
- [ ] Any startup readiness probe is **log-only / non-fatal**, targets the **local** listener after `tunnel.start()` (not the public URL before the listener binds), and never blocks/crashes daemon boot.
- [ ] Clean host stop on shutdown is verified.
- [ ] Typecheck passes.
**Dependencies:** None (independent of US-001; pairs with US-003 in the same serial member)
**Estimated complexity:** small

## US-005: Operator-approval gate + live spawn-request
**Description:** As an operator, I want a remote daemon to refuse to run a peer-requested spawn unless I have approved that peer, so a peer cannot silently execute code on my machine.
**Acceptance Criteria:**
- [ ] The `run.ts` ingest closure enforces `requiresOperatorApproval`: spawn-channel / `spawn-request` envelopes are **default-deny** unless the sender `machineId` carries `approvedForSpawn: true` in the peer config.
- [ ] A non-allowlisted `spawn-request` is recorded to `<happyHomeDir>/agent-comms/pending-spawns.json` and **never executed**.
- [ ] An allowlisted `spawn-request` body is mapped to `SpawnSessionFromSessionRpcOptions['config']` and executed via `spawnSessionFromSession`; the handler is obtained through a deferred/promise injection (because the ingest closure at `run.ts:219-241` is built before `spawnSessionFromSessionHandler` at `run.ts:939-956`, mirroring `run.ts:849-859`).
- [ ] Executed spawns are deduped by `envelope.id`/`correlationId`: a retry of the same `spawn-request` does not spawn a second child and returns the prior result.
- [ ] A `spawn-result` envelope (success with spawned session id, or error) is returned to the requester via the outbound path.
- [ ] The MCP `agent_comms.spawn` foreign-`machineId` path (`agentCommsBridge.ts:201-218`) sends a real `spawn-request` envelope instead of the `deferred-scope-a-spawn` stub.
- [ ] Typecheck passes.
**Dependencies:** US-003
**Estimated complexity:** medium

## US-006: Automated two-daemon round-trip + approval-gate harness
**Description:** As a maintainer, I want the §8 manual smoke automated so the full signed+sealed cross-machine chain is regression-tested without two physical machines.
**Acceptance Criteria:**
- [ ] A hermetic `packages/happy-cli/src/agentComms/scopeA.integration.test.ts` pre-pins fixture keys both ways across two temp `HAPPY_HOME_DIR`s, injects a loopback `FetchLike` (+ `CommandRunner`), and drives the full chain (sign → seal → POST → verify → open → relay-advance → `appendMessage`) asserting the plaintext body lands in the **remote** mailbox.
- [ ] Negative cases assert unknown peer, fingerprint mismatch, signature failure, and sealed-body open failure each reject **before** `appendMessage`.
- [ ] Spawn cases assert a non-allowlisted peer is denied (no spawn) and an allowlisted peer spawns once; an idempotent-retry case asserts no duplicate child.
- [ ] The hermetic crypto round-trip drives the injected `agentCommsIngest` handler directly; a separate route-level test covers the Fastify schema + `routeHopValidation` + 503/400 boundary (the route uses `app.authenticate` and is tunnel-listener-only, `api.ts:109-115`).
- [ ] An opt-in real-`devtunnel` smoke script (or runbook update) documents the un-hermetic gateway connect-token admission step.
- [ ] `pnpm --filter happy test` and `pnpm --filter happy-server test` pass.
**Dependencies:** US-003, US-005
**Estimated complexity:** large
