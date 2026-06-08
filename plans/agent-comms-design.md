# Agent-comms: unified scope-aware agent ↔ agent communication

*Design doc — 2026-06-07. Output of Ralph job `agent-comms`, US-001. Companion to [`plans/durable-mailbox-channel-wake.md`](./durable-mailbox-channel-wake.md), which defines the async-events mailbox substrate this design layers onto.*

> **Status:** design + skeleton pass. This doc names the architecture, the wire schema, the scope-aware router, all three scopes (B, C, A), the Scope A Dev Tunnels transport, the cross-scope cycle gate, and a manual two-machine smoke. Live cross-machine network wiring is explicitly **deferred** to a follow-up impl.

---

## TL;DR

Top-level Happy agent sessions get **one consumer-facing API** for talking to each other — a `MESSAGE PASSING` channel (`agent_comms.send`) and a `SPAWNING` channel (`agent_comms.spawn`) — with **scope-aware routing** picking among three transports underneath:

- **Scope B** — same machine, one daemon, two top-level sessions. Routed through the async-events durable mailbox (`packages/happy-cli/src/agentComms/mailbox.ts`); see [`durable-mailbox-channel-wake.md`](./durable-mailbox-channel-wake.md).
- **Scope C** — a parent session and a child it spawned. Same physical transport as Scope B, but the router skips any target-discovery handshake because the parent ↔ child link is pinned at spawn time via `metadata.parentSessionId` / `metadata.spawnedChildren` / `HAPPY_PARENT_SESSION_ID`.
- **Scope A** — two daemons paired to the same operator GitHub identity on different machines, communicating end-to-end over **Microsoft Dev Tunnels**. Dev Tunnels is the SOLE channel for **data, signaling, rendezvous, discovery, and auth** — nothing transits the phone, the mobile app, a central happy-server broker, a relay, or any other third-party path. The embedded happy-server's `/agent-comms/ingest` route is the local daemon endpoint exposed by the tunnel, not a broker.

All three scopes converge on a single delivery sink at the destination daemon: `mailbox.appendMessage(targetSessionId, body, from)`. Only the **arrival path** to that sink differs. Cross-scope cycles are prevented by a `hopCount` cap plus `hopPath` loop rejection that every relaying daemon increments and validates independently.

---

## 1 · Goals and non-goals

### Goals (this pass)
- Document the unified API + envelope + scope-aware routing as one design.
- Pin Scope A on Dev Tunnels end-to-end (data + signaling + rendezvous + discovery + auth) — no phone, no app, no broker, no relay, no other third-party channel.
- Distinguish the embedded happy-server ingest route (local daemon endpoint reachable via a tunnel) from any forbidden central happy-server broker/relay.
- Specify cross-scope cycle prevention as a load-bearing invariant.
- Specify a manual two-machine smoke with EXACT commands and JSON shapes so a follow-up impl has nothing to invent.

### Non-goals (deferred)
- Live two-machine Scope A network wiring; no automated cross-machine integration test in this pass.
- Pub-sub message fan-out. The envelope is fan-out-ready (`kind: 'notify'`, no `correlationId` requirement) but v1 ships request/reply only.
- Codex submodule edits.
- Re-implementing the async-events mailbox internals; those are owned by [`durable-mailbox-channel-wake.md`](./durable-mailbox-channel-wake.md).
- The `/v3/sessions/:id/messages` alternative substrate (noted; not pursued here).

---

## 2 · Unified API

Two MCP tools, scope-independent at the call site:

### 2.1 MESSAGE PASSING — `agent_comms.send`

```ts
agent_comms.send({
  target: { machineId?: string; sessionId: string },
  body: unknown,           // opaque to the transport; sealed for Scope A
  kind: 'request' | 'reply' | 'notify',
  correlationId?: string,  // for request/reply
})
```

- `target.machineId` absent or equal to self → local (Scope B or Scope C).
- `target.machineId` present and foreign → Scope A.
- Bodies and metadata are application content; the transport never inspects them. For Scope A the body is sealed end-to-end (§4.3).

### 2.2 SPAWNING — `agent_comms.spawn`

```ts
agent_comms.spawn({
  role: string,
  cwd: string,
  plugins?: string[],
  agent?: string,
  machineId?: string,     // absent => local spawn
  initialMessage?: string,
})
```

- Local: reuses the existing `spawn-session-from-session` RPC + daemon route. The `initialMessage` is threaded through the spawn launch path (US-005a fix).
- Cross-machine: represented by a `spawn-request` / `spawn-result` envelope pair over Scope A. Remote spawn is **design-level only** this pass; the network-level impl is deferred along with the rest of the Scope A live wiring. Remote spawn additionally requires an **operator-approval gate** at the remote daemon before any child process starts.

### 2.3 The single sink

Regardless of scope, the destination daemon delivers by calling:

```
mailbox.appendMessage(target.sessionId, body, from)
```

which fans out through the async-events channel-wake substrate (`agent-comms://inbox/<sessionId>` resource_updated; see [`durable-mailbox-channel-wake.md`](./durable-mailbox-channel-wake.md) §2). The recovery path (consumer re-reads its inbox at startup) covers missed wakes uniformly across all three scopes.

---

## 3 · Wire envelope — `AgentCommsEnvelope`

Defined in `packages/happy-wire/src/agentComms.ts` as a Zod schema and exported from `packages/happy-wire/src/index.ts`. Shape:

```ts
AgentCommsEnvelope = {
  v: 1,
  id: string,                    // ULID/UUID per envelope
  ts: number,                    // epoch ms at the sender
  from: { machineId: string; sessionId: string },
  to:   { machineId?: string; sessionId: string },
  scope: 'B' | 'C' | 'A',        // derived/asserted by the router; carried for audit
  channel: 'message' | 'spawn',
  kind: 'request' | 'reply' | 'notify' | 'spawn-request' | 'spawn-result',
  correlationId?: string,
  hopCount: number,              // initialized to 0 at the producer; incremented at every relay
  hopPath: string[],             // composite sids visited; rejected if duplicates or contains target
  body: unknown,                 // opaque; E2E-sealed for Scope A; plaintext for B/C (same machine)
}
```

Enums exported alongside the schema:

- `AgentCommsScope = 'B' | 'C' | 'A'`
- `AgentCommsChannel = 'message' | 'spawn'`
- `AgentCommsKind = 'request' | 'reply' | 'notify' | 'spawn-request' | 'spawn-result'`

Constants exported alongside the schema:

- `MAX_HOPS` — hop-count cap (initial value `4`; cross-scope chains beyond this are rejected).

The envelope MUST live in `packages/happy-wire/src/agentComms.ts` and MUST be re-exported from `packages/happy-wire/src/index.ts` so happy-cli and happy-server can import it from `@slopus/happy-wire` without reaching into the package internals.

---

## 4 · Scope-aware routing

### 4.1 `resolveScope(from, to, context)`

In `packages/happy-cli/src/agentComms/router.ts`:

```
if to.machineId is absent or equals self.machineId:
    if (from.sessionId, to.sessionId) is a known parent-child edge
       (via context.metadata.parentSessionId / spawnedChildren
        / HAPPY_PARENT_SESSION_ID):
        return 'C'
    else:
        return 'B'   // local same-machine, no parent-child link
else:
    return 'A'        // foreign machineId
```

### 4.2 Dispatch matrix

| Scope | Dispatch path                                                                                                                   | Substrate                                  |
|------:|--------------------------------------------------------------------------------------------------------------------------------|--------------------------------------------|
| **B** | Local agent → MCP `agent_comms.send` → daemon `POST /agent-comms/send` (loopback) → router → `mailbox.appendMessage`            | Async-events mailbox + channel-wake        |
| **C** | Same as B; the router tags `scope: 'C'` and skips any target-existence handshake because the inbox is guaranteed from spawn time | Async-events mailbox + channel-wake        |
| **A** | Local agent → MCP `agent_comms.send` → router detects remote `machineId` → Scope A Dev Tunnels client → remote happy-server `POST /agent-comms/ingest` → injected handler → `mailbox.appendMessage` on the **remote** machine | Dev Tunnels + remote async-events mailbox  |

The local daemon control server (`packages/happy-cli/src/daemon/controlServer.ts`) stays loopback-only and gains no new transport responsibilities; it only learns to route `/agent-comms/send` requests through `router.ts`.

### 4.3 Router validation invariants

- Reject if `hopCount > MAX_HOPS`.
- Reject if `to.sessionId` already appears in `hopPath` (forward loop, e.g. A → B → A).
- Reject if any duplicate appears in `hopPath` (back-reference cycle).
- The receiving daemon increments `hopCount` and appends to `hopPath` **before** re-dispatching, never trusting a sender-provided value as final.

---

## 5 · Scope A — Microsoft Dev Tunnels end-to-end

### 5.1 Hard constraint (operator decision, 2026-06-07)

Scope A uses **Microsoft Dev Tunnels** as the SOLE channel for:

- **Data plane** — message bodies (sealed) and spawn requests/results.
- **Signaling** — connect-token presentation, app-layer crypto exchange.
- **Rendezvous** — locating the remote daemon at the network level.
- **Discovery** — enumerating the operator's own machines by tunnel name.
- **Auth** — both gateway-enforced (connect-token) and backend-observable (Ed25519 signature + sealed body).

Nothing — not data, not signaling, not rendezvous, not discovery, not auth — may transit:

- the phone or any mobile device,
- the Happy mobile app,
- a central happy-server broker, relay, or pub-sub topic,
- any other third-party channel.

### 5.2 Embedded happy-server is the local endpoint, not a broker

Each daemon already runs an **embedded** happy-server alongside the loopback control server. The Scope A ingest route (`POST /agent-comms/ingest`) lives on this embedded happy-server because the loopback control server is bound to `127.0.0.1` and cannot accept tunnel traffic. The tunnel forwards to the embedded happy-server's port.

This is **NOT** a broker or relay:

- The route handler does no cross-tenant fan-out.
- It does not forward to a central happy-server.
- It delegates the validated, decrypted envelope to a **daemon-injected callback** (`HappyServerConfig.agentCommsIngest`) that calls `mailbox.appendMessage` on the local filesystem.
- happy-server has no direct dependency on happy-cli's `mailbox.ts`; the wiring is "inject callback at `createHappyServer` time," matching happy-server's "no app-specific logic in the server" convention.

A central happy-server broker/relay (one shared server fanning messages between operator machines) is a different design and is explicitly **rejected** by this doc.

### 5.3 Discovery (Dev Tunnels management plane is the SOLE network path)

`TunnelManager.listOperatorTunnels()` shells out to `devtunnel list --json`. Both daemons are logged in as the same operator (`devtunnel user login -g`) so the management plane returns each machine's tunnel keyed by name `codexu-<hostname>`. The Dev Tunnels management plane IS the per-identity registry; the daemon never asks the phone, the mobile app, or happy-server "where is machine X?"

An **optional** `<happyHomeDir>/agent-comms/peers.json` file exists as a local, operator-authored static override (the "out-of-band operator-controlled path" the operator named explicitly). It is:

- machine-local config the operator fills in by hand;
- never a network discovery channel;
- never a third party;
- opt-in only — default discovery is `devtunnel list`.

### 5.4 Two-layer auth: gateway-enforced + backend-observable

**Layer 1 — gateway-enforced connect-token (NOT observable at the backend).**

Each operator-owned tunnel is **private**. Microsoft's Dev Tunnels gateway admits the connection only when the client presents a connect-token that ONLY the operator can mint for the operator-owned tunnel:

```
devtunnel token <peerTunnelId> --scope connect
```

Wrapped as `TunnelManager.mintConnectToken(tunnelId)`. The daemon presents `X-Tunnel-Authorization: tunnel <connect-jwt>` on the upgrade. Per `packages/happy-server/AGENTS.md` the gateway **consumes and strips that header before forwarding** to the backend, so happy-server never sees it. The backend MUST NOT attempt to re-validate the `X-Tunnel-Authorization` header — the gateway is the only entity that can.

The gateway-level guarantee the backend relies on is: *any request that reaches `/agent-comms/ingest` over the tunnel was admitted by the operator's private tunnel.*

**Layer 2 — backend-observable Ed25519 signature + sealed body (the actual app-layer auth).**

Because the connect-token is stripped, the only backend-observable auth is application-layer crypto. The cross-machine envelope carries:

- plaintext routing fields (`v`, `id`, `ts`, `from`, `to`, `scope`, `channel`, `kind`, `correlationId?`, `hopCount`, `hopPath`),
- the sender's **machineId**,
- an **Ed25519 detached signature** over the canonicalized envelope, signed with the sender's `server-key` private key,
- a **sealed `body`** — TweetNaCl box (X25519 ECDH) between the sender's `ecdh-key` and the receiver's `ecdh-key`.

`packages/happy-cli/src/agentComms/peerAuth.ts` MUST use the existing **`TofuKeypairs`** from `packages/happy-cli/src/tofu/keypairManager.ts`:

- **Ed25519 `server-key`** (`server-key.pub` / `server-key.priv`) for sign/verify;
- **X25519 ECDH `ecdh-key`** (`ecdh-key.pub` / `ecdh-key.priv`) for seal/open.

`peerAuth.ts` MUST NOT import or use the credentials `machineKey` from `packages/happy-cli/src/persistence.ts`. The credentials `machineKey` is a per-machine surface used for data-key encryption and is not shared across the operator's machines; using it for peer auth would be a cross-machine auth hole.

**First-contact TOFU pinning.** On first contact two daemons exchange their TOFU public keys (`ed25519PublicKey` + `ecdhPublicKey`) and pin them in a peer-pin store keyed by `machineId`:

```
<happyHomeDir>/agent-comms/peers.json
{
  "<peerMachineId>": {
    "ed25519Fingerprint": "<hex>",
    "ed25519PublicKey":   "<base64>",
    "ecdhPublicKey":      "<base64>",
    "pinnedAt":           <epoch_ms>
  }
}
```

Mirrors the existing mobile TOFU pinning model. After pinning, any unknown peer, fingerprint mismatch, signature mismatch, or sealed-body decrypt failure is rejected at `/agent-comms/ingest` and never reaches the mailbox.

**Trust anchor.** Operator tunnel ownership (only the operator can mint the connect token that admits the connection at the gateway) plus TOFU peer-pinning (Ed25519 fingerprint) plus E2E sealing of the body. A hostile gateway can neither read nor forge messages; a hostile peer would still need a valid operator-minted connect token to reach the private tunnel at all.

### 5.5 Ingest endpoint

`packages/happy-server/sources/app/api/routes/agentCommsIngestRoutes.ts` defines:

```
POST /agent-comms/ingest
Content-Type: application/json
Body: AgentCommsEnvelope (with Ed25519 signature + sealed body)
```

Backend-enforced validation (in order):

1. Parse and validate the envelope against the `AgentCommsEnvelope` Zod schema.
2. Resolve `from.machineId` in the peer-pin store; reject if unknown.
3. Verify the Ed25519 signature against the pinned `ed25519PublicKey`.
4. Decrypt the sealed body using the pinned `ecdhPublicKey` and the local `ecdh-key` private half.
5. Re-check hop invariants (`hopCount <= MAX_HOPS`; `to.sessionId` not in `hopPath`; no duplicates).
6. Increment `hopCount` and append the receiver's session id to `hopPath`.
7. Delegate to the daemon-injected handler `HappyServerConfig.agentCommsIngest(envelope, plaintextBody)` → which calls `mailbox.appendMessage(envelope.to.sessionId, plaintextBody, envelope.from)` on the local filesystem.

The `agentCommsIngest` callback slot is **new** — neither `HappyServerConfig` (in happy-server) nor the CLI's `packages/happy-cli/src/types/happy-server.d.ts` declaration shim has one today. Adding it is part of US-006.

### 5.6 Scope A in this pass = design + skeleton

This pass ships:

- the envelope schema (US-002),
- the router A-path resolution + unit test (US-003),
- `TunnelManager.listOperatorTunnels()` + `mintConnectToken()` with `CommandRunner`-injected unit tests (US-006),
- `peerTransport.ts` and `peerAuth.ts` interface + design + sign/verify + seal/open unit test against fixture keys (US-006),
- the `/agent-comms/ingest` route skeleton + injected handler slot (US-006),
- this design doc (US-001).

Live two-machine network wiring (real `devtunnel` host on each side, real cross-machine envelope round-trip, real operator-approval-UI for cross-machine spawns) is **deferred** to a follow-up impl. No automated cross-machine integration test in this pass.

---

## 6 · Cross-scope cycle prevention

Cycles can arise once any two scopes are chained (A → B → A, C → B → C, etc.). The guards:

1. **`hopCount` cap.** Every relay (Scope B daemon control hop, Scope C tagged dispatch, Scope A remote daemon) increments `hopCount` and rejects when `hopCount > MAX_HOPS` (initial cap `4`).
2. **`hopPath` loop rejection.** Each relay appends a composite session id to `hopPath`. Reject if `to.sessionId` already appears, or if any duplicate appears.
3. **Sender-untrusted hop fields.** Each relaying daemon increments and validates independently. A sender that understates `hopCount` cannot bypass the cap; the next relay overwrites with `received_hop + 1` and re-checks.
4. **Spawn-specific gate.** Cross-machine `agent_comms.spawn` additionally requires an **operator-approval gate** at the remote daemon before any process starts. The local spawn depth cap (`MAX_SPAWN_DEPTH=10` in `validateSpawnAncestry`) protects within a single machine; the hop counter + approval gate cap cross-daemon spawn chains.

The router unit tests (US-003) cover:

- Scope B / Scope C / Scope A resolution.
- `hopCount > MAX_HOPS` rejection.
- `hopPath` loop rejection (target already in path).
- `hopPath` duplicate rejection.

---

## 7 · Scope B and Scope C in detail

### 7.1 Scope B (same daemon, two top-level sessions)

- The async-events mailbox at `packages/happy-cli/src/agentComms/mailbox.ts` is the source of truth (see [`durable-mailbox-channel-wake.md`](./durable-mailbox-channel-wake.md) §2 for the file layout and load-bearing invariants — consume-only-after-drain, wake-is-never-consumption, recovery enqueues exactly one wake at startup).
- `agent_comms.send` calls the daemon's loopback `POST /agent-comms/send`, which routes through `router.ts`, which lands in `mailbox.appendMessage(to.sessionId, body, from)`.
- The producer side emits a `resource_updated` wake on the consumer's MCP bridge after the mailbox write; the consumer re-reads the inbox on next turn boundary.
- The agent-comms layer does NOT reimplement mailbox internals. If the async-events substrate is absent on the branch under test, the Scope B fixture is `it.skip` with a documented prerequisite reason.

### 7.2 Scope C (parent ↔ spawned child)

- Scope C is **Scope B with a known parent link**, not a separate physical transport.
- The router recognizes a parent-child edge via `metadata.parentSessionId`, `metadata.spawnedChildren`, and `HAPPY_PARENT_SESSION_ID` where applicable.
- Once recognized, the router tags `scope: 'C'` and **skips** any target-existence handshake that Scope B would otherwise perform. The parent inbox is guaranteed to exist because the parent spawned the child; no discovery is needed.
- US-005a fixes the pre-existing `initialMessage` propagation bug at `packages/happy-cli/src/modules/common/registerCommonHandlers.ts` (add `initialMessage?: string` to `SpawnSessionOptions`) and `packages/happy-cli/src/daemon/spawnSessionFromSession.ts` (thread `options.config.initialMessage` through `deps.spawnSession`). This fix is **async-events-independent** and lands ahead of US-005b.
- The Scope C fixture (US-005b) verifies (a) the spawned child sends to its parent via `HAPPY_PARENT_SESSION_ID`, (b) the parent mailbox receives the message, (c) no discovery/handshake function is invoked, and (d) the US-005a initial-message path remains intact end-to-end.

---

## 8 · Manual two-machine smoke (Scope A)

This section is the EXACT operator runbook a follow-up impl will exercise once the live Scope A wiring lands. Nothing here is automated this pass.

### 8.1 Prerequisites

- Both machines run the same Happy fork build and are logged into Dev Tunnels as the same GitHub operator:

  ```
  devtunnel user login -g
  ```

- Each daemon has created its per-machine tunnel named `codexu-<hostname>` (existing `TunnelManager` behavior; see `packages/happy-cli/src/tunnel/tunnelManager.ts`).
- Each daemon has populated its `TofuKeypairs` at `<happyHomeDir>/tofu/server-key.{pub,priv}` and `<happyHomeDir>/tofu/ecdh-key.{pub,priv}` (existing first-run behavior of `keypairManager.ts`).
- Both daemons have completed first-contact TOFU pinning of the peer (`peerAuth.ts` writes `<happyHomeDir>/agent-comms/peers.json`).

### 8.2 Step 1 — list operator tunnels (discovery)

On machine A, list the operator's tunnels:

```
devtunnel list --json
```

Expected JSON shape (abbreviated; only the fields this design relies on):

```json
{
  "tunnels": [
    {
      "tunnelId": "<peer-tunnel-id>",
      "name": "codexu-<peer-hostname>",
      "ports": [
        { "portNumber": <int>, "portUri": "https://<peer-tunnel-id>-<port>.<region>.devtunnels.ms/" }
      ]
    }
  ]
}
```

Filter the result to entries whose `name` starts with `codexu-`. Map peer `machineId` → `codexu-<hostname>` → `tunnelId` + `portUri`.

### 8.3 Step 2 — mint a connect token

On machine A, mint a connect token for machine B's tunnel:

```
devtunnel token <peer-tunnel-id> --scope connect
```

Expected output: a single line containing the connect-token JWT (the exact shape depends on the installed `devtunnel` CLI version; `REQUIRED_DEVTUNNEL_VERSION = 1.0.1516`). This token is presented as `X-Tunnel-Authorization: tunnel <jwt>` on the next ingest request. The Dev Tunnels gateway will **consume and strip** the header before forwarding to machine B's embedded happy-server.

### 8.4 Step 3 — POST the signed + sealed envelope

From machine A, POST an `AgentCommsEnvelope` to machine B's `/agent-comms/ingest`:

```
curl -X POST "https://<peer-tunnel-id>-<port>.<region>.devtunnels.ms/agent-comms/ingest" \
  -H "Content-Type: application/json" \
  -H "X-Tunnel-Authorization: tunnel <connect-jwt>" \
  --data @envelope.json
```

`envelope.json` shape:

```json
{
  "v": 1,
  "id": "<ULID>",
  "ts": 1736188800000,
  "from": { "machineId": "<machine-a-id>", "sessionId": "<sender-session-id>" },
  "to":   { "machineId": "<machine-b-id>", "sessionId": "<target-session-id>" },
  "scope": "A",
  "channel": "message",
  "kind": "request",
  "correlationId": "<optional>",
  "hopCount": 0,
  "hopPath": ["<sender-session-id>"],
  "senderMachineId": "<machine-a-id>",
  "signature": "<base64 Ed25519 detached signature over canonicalized envelope>",
  "body": "<base64 TweetNaCl-sealed body for machine B's ecdh-key>"
}
```

### 8.5 Step 4 — expected backend behavior

Machine B's happy-server `/agent-comms/ingest` handler MUST, in order:

1. Parse and validate against the `AgentCommsEnvelope` Zod schema.
2. Look up `from.machineId` in `<happyHomeDir>/agent-comms/peers.json`; reject 401 if unknown.
3. Verify the Ed25519 signature against the pinned `ed25519PublicKey`; reject 401 on mismatch.
4. Decrypt the sealed `body` using the local `ecdh-key.priv` and the pinned peer `ecdhPublicKey`; reject 400 on decrypt failure.
5. Re-check `hopCount <= MAX_HOPS` and `to.sessionId not in hopPath`; reject 422 on violation.
6. Increment `hopCount`, append the receiver session id to `hopPath`.
7. Call the injected `HappyServerConfig.agentCommsIngest(envelope, plaintextBody)` which calls `mailbox.appendMessage(envelope.to.sessionId, plaintextBody, envelope.from)`.
8. Return 200 with `{ "ok": true, "id": "<envelope.id>" }`.

The handler MUST NOT inspect `X-Tunnel-Authorization`; that header has been stripped by the gateway by the time the request arrives.

### 8.6 Non-goals for the smoke (this pass)

- **No automated two-machine integration test.** This pass ships interfaces, skeletons, and unit tests only.
- **No remote spawn execution.** Cross-machine `agent_comms.spawn` is design-only this pass and remains gated on the operator-approval UI work in a follow-up impl.
- **No pub-sub fan-out.** Envelope-ready (`kind: 'notify'`) but not exercised.
- **No central happy-server broker.** The smoke targets the **embedded** happy-server on machine B, reached via machine B's own tunnel. No traffic crosses a central server.
- **No phone, mobile app, or any third-party participation.** The smoke uses only `devtunnel` CLI + curl + the two daemons.

---

## 9 · Verification this pass

Markdown-only verification is recorded for this story:

- The doc exists at `plans/agent-comms-design.md` with the unified API, envelope, scope-aware routing, Scope B / Scope C / Scope A sections, the Scope A Dev-Tunnels-end-to-end constraint, the embedded-happy-server-is-not-a-broker distinction, the manual two-machine smoke with exact `devtunnel` commands + JSON shapes + curl shape + explicit non-goals, and a cross-reference to [`plans/durable-mailbox-channel-wake.md`](./durable-mailbox-channel-wake.md).
- No live two-machine test is required this pass (per US-001 acceptance).
- The schema, router, transport interfaces, ingest skeleton, and the `initialMessage` propagation fix referenced here are implemented under their own user stories (US-002 through US-007) and verified in those stories' iterations.

---

## 10 · References

- [`plans/durable-mailbox-channel-wake.md`](./durable-mailbox-channel-wake.md) — async-events durable mailbox + channel-wake substrate (the single delivery sink for all three scopes).
- `packages/happy-cli/src/agentComms/mailbox.ts` — the durable mailbox implementation referenced by Scope B / Scope C / Scope A.
- `packages/happy-cli/src/tunnel/tunnelManager.ts` — Dev Tunnels per-machine tunnel manager; `listOperatorTunnels()` and `mintConnectToken()` are added by US-006.
- `packages/happy-cli/src/tofu/keypairManager.ts` — `TofuKeypairs` (Ed25519 `server-key`, ECDH `ecdh-key`) used by `peerAuth.ts`.
- `packages/happy-cli/src/daemon/spawnSessionFromSession.ts` and `packages/happy-cli/src/modules/common/registerCommonHandlers.ts` — the spawn path the `initialMessage` propagation fix touches (US-005a).
- `packages/happy-server/AGENTS.md` — happy-server conventions, including the rule that the Dev Tunnels gateway strips `X-Tunnel-Authorization` before forwarding.
