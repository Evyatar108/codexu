# Plan — `agent-comms-serverless-scope-a-discovery`

> **Worktree:** codexu primary repo (`D:/harness-efforts/codexu`). Impl member
> should work on a topic branch in `.ralph/jobs/agent-comms-serverless-scope-a-discovery/worktree/`.
> Touches three packages under one repo root: `packages/happy-cli`,
> `packages/happy-server`, `packages/happy-wire`. **No codex submodule edits.**

## 1. Overview & Goal

Today the Scope A agent-comms ingest endpoint (`POST /agent-comms/ingest`) is
served by the **embedded happy-server's tunnel listener**: the route definition,
body schema, and hop validation live in happy-server
(`packages/happy-server/sources/app/api/routes/agentCommsIngestRoutes.ts`), and
the daemon injects the real crypto/mailbox handler into it
(`packages/happy-cli/src/daemon/run.ts:226-240`).

Per the shipped brainstorm direction **D-001**
(`.ralph/brainstorms/agent-comms-serverless-scope-a-discovery/selected-direction.md`),
this plan **decouples the Scope A ingest path from happy-server** by standing up a
minimal **happy-cli-owned HTTP listener** that serves **only** `POST
/agent-comms/ingest`, delegating to the existing daemon-injected
`agentCommsIngest` closure unchanged. The embedded happy-server **stays in the
daemon** for the tablet/CLI mobile+session plane (pair, sessions, Socket.IO,
machine RPC) — removing it would strand the e-ink tablet and is out of scope
(that is the separate multi-epic D-002).

After this change:
- happy-server's Fastify app is **not in the ingest request path** at all.
- The two-layer auth and Dev-Tunnels discovery are preserved.
- happy-cli no longer imports the ingest body type from happy-server (the
  schema relocates to `@slopus/happy-wire`).

## 2. Research findings (verified against source)

All anchors below were read and confirmed; the brainstorm's citations were
mostly accurate but a few drifted (noted inline).

### 2.1 The ingest handler already lives in happy-cli
- `packages/happy-cli/src/agentComms/ingestHandler.ts` — `createAgentCommsIngestHandler(...)`
  is the **real auth + delivery**: `requirePinnedPeer` (TOFU pin) →
  fingerprint/pubkey match → `verifyEnvelopeSignature` (Ed25519) →
  `openSealedBody` (X25519/NaCl) → `advanceAgentCommsRelay` →
  spawn-approval branch **or** `appendMessage` (mailbox). It currently imports
  the body type from happy-server: `import type { AgentCommsIngestBody } from 'happy-server';`
  (line 2) — the **only** ingest-specific happy-cli→happy-server coupling to remove.
- Wired in `packages/happy-cli/src/daemon/run.ts:226-240`: `const agentCommsIngest =
  createAgentCommsIngestHandler({...})` is then passed into
  `bindListenersAndWriteCapability({ sharedContext: { ..., agentCommsIngest } })`
  (lines 234-262), i.e. **injected into the embedded happy-server's shared context**.
  (Brainstorm cited "run.ts:219-241"; actual is 226-240 for the handler + the
  `sharedContext` injection at 234-262.)

### 2.2 The crypto helpers stay put
- `packages/happy-cli/src/agentComms/peerAuth.ts` — `requirePinnedPeer`,
  `verifyEnvelopeSignature`, `openSealedBody`, `sealBody`, `signEnvelope`,
  `pinPeerKeys`, `PinnedPeerKeys` (carries `tunnelName`/`tunnelId`/`approvedForSpawn`
  config hints + `ed25519Fingerprint`/`ecdhPublicKey`/`ed25519PublicKey`). No change
  to the crypto; **`PinnedPeerKeys` gains an optional `ingestPort` hint** (see §4 D-004).

### 2.3 The route + schema + hop validation live in happy-server (to be relocated/retired)
- `packages/happy-server/sources/app/api/routes/agentCommsIngestRoutes.ts`:
  - `AgentCommsIngestBodySchema` (= `{ envelope: AgentCommsEnvelopeSchema, signature, senderKeys }`),
    `SenderKeysSchema`, `AgentCommsIngestBody`/`AgentCommsIngestHandler` types.
  - `routeHopValidation(envelope)` + `hasDuplicate(...)` (MAX_HOPS cap, hopPath dup,
    hopPath-contains-target) — **backend-observable** checks done before the handler.
  - `agentCommsIngestRoutes(app, { handler })`: `preHandler: [app.authenticate]`,
    Zod body, 200 `{id,seq}` / 400 / 503; returns 503 if no handler, runs
    `routeHopValidation` → 400, else `await handler(body)` (errors → 400).
- Registered **only on the tunnel listener** at
  `packages/happy-server/sources/app/api/api.ts:115`
  (inside `if (options.auth !== "loopback")`), alongside pair/push/session/v3 routes.
- The `agentCommsIngest` config slot threads through
  `packages/happy-server/sources/index.ts` (`HappyServerConfig`,
  `HappyServerSharedContext`, `CreateAppConfig`) → `createApp` →
  `configureApi(..., { agentCommsIngest })` (`index.ts:174`, `api.ts:54,115`).

### 2.4 Two-layer auth — confirmed shape (must be preserved byte-for-byte)
- **Layer 1 (transport):** Microsoft Dev Tunnels gateway validates
  `X-Tunnel-Authorization: tunnel <connect-jwt>` and **strips it before
  forwarding** to the backend. The backend's tunnel `authenticate` decorator is a
  **no-op**: `typed.decorate('authenticateTunnel', async function (_request) {});`
  and `authenticate = auth === 'loopback' ? verifyLoopbackCapability : authenticateTunnel`
  (`packages/happy-server/sources/app/api/api.ts:77-79`). **Key implication:** the
  happy-cli ingest listener does **not** need to re-implement any backend layer-1
  check — binding to `127.0.0.1` + trusting the gateway IS the layer-1 model. It
  must **not** add a loopback-capability gate (ingest arrives via the tunnel, not
  loopback). This matches the daemon's existing `/agent-comms/send` control route,
  which has "NO `X-Loopback-Capability` gate … the 127.0.0.1 binding is the
  boundary" (`controlServer.ts` comment).
- **Layer 2 (app crypto):** TOFU Ed25519 verify + ECDH sealed-body open in
  `ingestHandler.ts` via `peerAuth.ts` + the `agent-comms/peers.json` pin store.
  Unchanged.

### 2.5 Discovery + outbound (Dev Tunnels) — what must stay untouched
- `packages/happy-cli/src/tunnel/tunnelManager.ts`:
  `listOperatorTunnels(prefix='codexu-')` (`devtunnel list --json`, lines 332-341)
  and `mintConnectToken(tunnelId)` (`devtunnel token <id> --scope connect`, lines
  343-356). Connect token is **tunnel-scoped**, so it authorizes any port on the
  tunnel. (Brainstorm cited 332-352; actual 332-356.) **These two functions are not
  modified by this plan.**
- `packages/happy-cli/src/agentComms/peerTransport.ts`:
  - `ingestUrl(tunnel)` derives `<base>/agent-comms/ingest` from
    `tunnel.tunnelUrl ?? tunnel.ports.find(p=>p.portUri)?.portUri` (lines 56-59).
  - `DevTunnelsPeerTransport.send(...)` POSTs JSON with
    `'X-Tunnel-Authorization': 'tunnel ' + mintConnectToken(target.tunnelId)`
    (lines 70-84). **The `/agent-comms/ingest` path suffix is unchanged.**
- `packages/happy-cli/src/agentComms/peerResolver.ts` — `resolvePeerTarget` joins a
  pinned peer to a single `listOperatorTunnels()` match by `tunnelId`/`tunnelName`
  hints, then calls `ingestUrl(tunnel)`.

### 2.6 Embedded server bind path (the tablet plane — must keep working)
- `packages/happy-cli/src/daemon/dualListenerBinding.ts` creates two
  `happy-server` listeners via `createApp(...)`: a **tunnel** listener on
  `state.tunnelPort` and a **loopback** listener on `state.loopbackPort`, both from
  one shared context (which today carries `agentCommsIngest`).
- The Dev Tunnel forwards `state.tunnelPort` (`tunnelProvider.loadHostTunnel({ port:
  state.tunnelPort })`). `machine.json` shape is `{ machineId, tunnelPort,
  loopbackPort, tunnelId, lastTunnelUrl }` (daemon AGENTS.md).
- `devtunnel host <tunnelId>` (`tunnelManager.startHost`) forwards **all ports
  registered on the tunnel**; `ensurePort(tunnelId, port)` registers a port. Today
  only one port (`tunnelPort`) is registered.

### 2.7 happy-wire is the right home for the relocated schema
- `AgentCommsEnvelopeSchema`, `MAX_HOPS`, the channel/kind/scope/from/to schemas all
  live in `packages/happy-wire/src/agentComms.ts` (exported via `src/index.ts:9`).
  Both happy-cli and happy-server already depend on `@slopus/happy-wire`. Moving
  `AgentCommsIngestBodySchema` + `routeHopValidation` here removes the happy-cli →
  happy-server type edge with zero new dependencies.

### 2.8 Existing tests that pin current behavior (must be updated)
- `packages/happy-cli/src/agentComms/scopeA.integration.test.ts` — hermetic
  round-trip. Drives `peerTransport` → a **fetch mock** that calls the handler
  directly; expected URL `https://machine-b-3005.devtunnels.ms/agent-comms/ingest`.
  This is the `integration-agent-comms` Vitest project
  (`packages/happy-cli/vitest.config.ts:84-91`). Today it never boots a real HTTP
  listener — this plan adds one.
- `packages/happy-cli/src/daemon/dualListenerBinding.test.ts:59-128` — asserts
  ingest **is** served on the embedded tunnel listener and rejected on loopback.
  After this change the embedded server no longer serves ingest; this test must be
  rewritten to assert the embedded listener returns **404** for `/agent-comms/ingest`.
- `packages/happy-server/sources/app/api/routes/agentCommsIngestRoutes.spec.ts` —
  deleted with the route; its schema/hop/503 coverage migrates to happy-wire schema
  tests + the happy-cli ingest-listener unit tests.

## 3. Approach

Stand up a standalone happy-cli Fastify listener that mirrors
`packages/happy-cli/src/daemon/controlServer.ts` (same `fastify` +
`fastify-type-provider-zod` + `validatorCompiler`/`serializerCompiler` setup),
serving exactly one route — `POST /agent-comms/ingest` — that:
1. Validates the body with the relocated `AgentCommsIngestBodySchema` (Zod).
2. Runs `routeHopValidation(envelope)` → 400 on failure (backend-observable check,
   identical semantics to today's happy-server route).
3. `await`s the injected `agentCommsIngest` handler; maps thrown errors → 400
   `{error}`; returns `{id, seq}` on success. Returns 503 if no handler is wired.

It binds `127.0.0.1:<ingestPort>` (a persisted, free port — see D-004), and the
daemon registers `<ingestPort>` on the Dev Tunnel so `devtunnel host` forwards it.
The existing `agentCommsIngest` closure is no longer injected into the embedded
happy-server; it is handed to the new listener instead.

## 4. Key design decision — D-004 forwarding/port model

The one genuine architectural choice. Two viable models keep happy-server out of
the ingest path while keeping the tablet plane on the embedded server:

**Option A — second forwarded Dev Tunnel port + standalone happy-cli Fastify
listener (RECOMMENDED).** The ingest listener binds its own persisted free
loopback port; the daemon registers that port on the existing tunnel
(`ensurePort`), and `devtunnel host` forwards it. The sender's `ingestUrl()`
selects the **ingest port** via a new `PinnedPeerKeys.ingestPort` hint.
- ✔ happy-server's Fastify is fully out of the ingest path (separate process-local
  listener, separate forwarded port).
- ✔ `listOperatorTunnels()` + `mintConnectToken()` **untouched** (the two discovery
  primitives the acceptance criteria name); the connect token is tunnel-scoped and
  works for the second port; the POST path stays `/agent-comms/ingest`.
- ✔ The embedded happy-server's bind/serve path is **byte-for-byte unchanged** — no
  risk to the tablet's Socket.IO/pair/session traffic.
- ✔ Lowest complexity; mirrors `controlServer.ts` (the brainstorm's stated shape).
- ➖ Relaxes the In-Scope aspiration "keep `peerTransport.ingestUrl()` behavior
  unchanged": `ingestUrl()` gains deterministic ingest-port selection (small,
  additive, fully unit-tested). Exposes **one** additional forwarded port — same
  tunnel, same connect-token, same crypto trust model, so no new auth surface.

**Option B — single forwarded port, in-process path dispatch (CONSIDERED, DEFERRED).**
Keep one forwarded port; a daemon-owned `http.Server` dispatches `POST
/agent-comms/ingest` to the happy-cli Fastify and everything else to the embedded
happy-server (via Fastify `serverFactory` composition). Keeps discovery + `ingestUrl()`
byte-for-byte identical.
- ➖ Requires a happy-server change to accept a `serverFactory`, and the embedded
  server's **Socket.IO attaches to the shared HTTP server** — composing a custom
  request dispatcher with Socket.IO's `upgrade` handling on one socket is a known
  footgun and directly risks the tablet's real-time channel. Materially higher
  complexity/risk for a task billed as "minimal." **Deferred** unless the operator
  explicitly prioritizes single-port/byte-identical discovery over tablet-path
  safety.

**Recommendation:** ship **Option A**. The acceptance criteria are satisfied
(named discovery primitives untouched, path unchanged, happy-server out of the
path, single tunnel, Dev Tunnels sole channel). **US-001 includes an explicit
operator-confirmation gate** for this decision before the port-plumbing story
proceeds, because A relaxes the prior "single forwarded port (no second port)"
note in `packages/happy-cli/src/daemon/AGENTS.md` and the In-Scope "ingestUrl
unchanged" aspiration. If the operator chooses B, re-scope US-003/US-005 to the
serverFactory dispatcher and drop the `ingestPort` hint.

`machine.json` gains an `ingestPort` field (allocated once via
`pickFreeLoopbackPort`, persisted, reused on restart; migrated by allocating when
absent — mirrors how `tunnelPort`/`loopbackPort` are handled).

## 5. Files to create / modify

### Create
- `packages/happy-cli/src/agentComms/ingestServer.ts` — the minimal Fastify+Zod
  ingest listener (start/stop handle like `controlServer.ts`).
- `packages/happy-cli/src/agentComms/ingestServer.test.ts` — unit tests (boots the
  real listener on an ephemeral port; covers the full matrix).

### Modify — happy-wire
- `packages/happy-wire/src/agentComms.ts` — add `SenderKeysSchema`,
  `AgentCommsIngestBodySchema`, `AgentCommsIngestBody`, `AgentCommsIngestHandler`,
  `routeHopValidation`, `hasDuplicate` (next to `AgentCommsEnvelopeSchema`/`MAX_HOPS`).
- `packages/happy-wire/src/agentComms.test.ts` — add schema + `routeHopValidation`
  coverage migrated from the deleted happy-server spec.
- (`src/index.ts` already `export *`s `agentComms`; no index change. Run
  `pnpm --filter happy-wire build` to refresh `dist` — required by happy-server's
  older module resolution, per happy-wire AGENTS.md.)

### Modify — happy-cli
- `src/agentComms/ingestHandler.ts` — import `AgentCommsIngestBody` from
  `@slopus/happy-wire` instead of `'happy-server'`.
- `src/agentComms/peerAuth.ts` — add optional `ingestPort?: number` to
  `PeerConfigHints`/`PinnedPeerKeys`; persist/read it in `pinPeerKeys`.
- `src/agentComms/peerTransport.ts` — `ingestUrl(tunnel, ingestPort?)` selects the
  ingest port's `portUri` when provided (path suffix unchanged).
- `src/agentComms/peerResolver.ts` — pass `pinned.ingestPort` to `ingestUrl(...)`.
- `src/daemon/run.ts` — stop injecting `agentCommsIngest` into the embedded
  `sharedContext`; start `ingestServer` with the same handler + `ingestPort`; stop
  it in shutdown cleanup.
- `src/daemon/dualListenerBinding.ts` — drop `agentCommsIngest` from the shared
  context type usage (type comes from happy-server `HappyServerSharedContext`,
  updated below).
- `src/persistence.ts` (+ `machine.json` readers/writers) — add `ingestPort`;
  migrate when absent.
- `src/tunnel/provider.ts` / `src/tunnel/devTunnelsDaemonProvider.ts` /
  `src/tunnel/tunnelManager.ts` — register the additional ingest port on the
  tunnel before `startHost` (e.g. `LoadHostTunnelOptions.additionalPorts?: number[]`
  → `ensurePort` per port). `listOperatorTunnels`/`mintConnectToken` unchanged.
- `src/daemon/dualListenerBinding.test.ts` — assert embedded listener returns 404
  for `/agent-comms/ingest`.
- `src/agentComms/scopeA.integration.test.ts` — update the expected ingest URL to
  the ingest-port host; add a real-listener round-trip case.

### Modify — happy-server (edit budget S)
- `sources/app/api/api.ts` — remove the `agentCommsIngestRoutes(typed, ...)`
  registration (line 115) and the import; remove `agentCommsIngest` from
  `ConfigureApiOptions` + the `configureApi` call.
- `sources/index.ts` — remove `agentCommsIngest` from `HappyServerConfig`,
  `HappyServerSharedContext`, `CreateAppConfig`, and the `configureApi(...)` pass-through
  (line 174) + the `AgentCommsIngestHandler` import.
- Delete `sources/app/api/routes/agentCommsIngestRoutes.ts` and
  `sources/app/api/routes/agentCommsIngestRoutes.spec.ts` (schema + tests relocated).

### Docs (update in the same change)
- `packages/happy-cli/src/daemon/AGENTS.md` — rewrite the `/agent-comms/ingest`
  bullet: ingest is now a happy-cli-owned listener on a second forwarded tunnel
  port; embedded happy-server no longer serves it. Update the "single forwarded
  port (no second port)" line.
- `packages/happy-cli/AGENTS.md` — update the "Scope A ingest verification lives in
  `src/agentComms/ingestHandler.ts`" note to add the new `ingestServer.ts` listener
  and the happy-wire schema home.
- `packages/happy-server/AGENTS.md` — drop ingest from the route inventory if listed;
  note ingest moved to happy-cli.
- `plans/durable-mailbox-channel-wake.md` and/or `plans/agent-comms-design.md` —
  cross-reference the ingest-path relocation (§5.x) if those docs describe the
  embedded-server ingest path.

## 6. Scope

### In scope
- happy-cli-owned `POST /agent-comms/ingest` listener calling the unchanged
  `agentCommsIngest` handler; embedded happy-server removed from the ingest path.
- Relocate ingest schema + hop validation to `@slopus/happy-wire`.
- Second-port forwarding model (D-004 Option A) + `ingestUrl()` ingest-port
  selection; `listOperatorTunnels()`/`mintConnectToken()` untouched.
- Retire the happy-server ingest route + config slot.
- Test matrix: malformed body, MAX_HOPS, hopPath loop, hopPath duplicate, unknown
  peer, signature failure, sealed-body open failure, successful append; outbound
  `peerTransport` path unchanged; embedded server 404s ingest.

### Out of scope
- Removing the embedded happy-server from the daemon (the tablet/CLI session plane)
  — separate multi-epic D-002 with its own live-tablet dogfood gate.
- Single-port serverFactory dispatch (Option B) unless the operator picks it.
- Codex submodule edits (budget: codex = none).
- The deferred §5.6 Scope A live cross-machine round-trip + remote-daemon
  operator-approval UI (call out as a follow-up; do not implement here).

## 7. Risk areas & common mistakes

- **Do not strand the tablet.** The embedded happy-server MUST keep serving
  pair/sessions/Socket.IO on `tunnelPort`. Only the ingest route moves. Verify the
  tunnel listener still binds and the dualListener flow is intact.
- **`devtunnel host` port matching.** `devtunnel host` forwards each registered
  tunnel port to the **same-numbered** local port. The ingest listener must bind the
  exact `ingestPort` registered on the tunnel — not `port: 0`. Persist it and reuse.
- **No loopback-capability gate on ingest.** Ingest arrives over the tunnel; adding
  `X-Loopback-Capability` would break it. The 127.0.0.1 bind is the boundary
  (matches `/agent-comms/send`).
- **happy-cli still depends on happy-server.** Only the ingest *type* coupling is
  removed; `dualListenerBinding.ts` still imports `createApp`/`HappyServerHandle`/
  `HappyServerSharedContext` for the embedded mobile plane.
- **happy-wire dist rebuild.** After moving schema, run `pnpm --filter happy-wire
  build` or happy-server typecheck won't see the new exports (happy-wire AGENTS.md).
- **Update the two pinning tests** (`dualListenerBinding.test.ts`,
  `scopeA.integration.test.ts`) — they currently assert the *old* topology and will
  fail otherwise. This is expected behavior change, not a regression.
- **Stop the ingest listener on shutdown** and on a failed startup (mirror the
  `bindListenersAndWriteCapability` cleanup-on-error pattern), so a partial start
  doesn't leak a bound port.
- **Idempotency unchanged.** Spawn dedup by `envelope.id`/`correlationId` stays in
  `ingestHandler.ts`/`spawnApproval.ts`; the listener adds none.
- **`routeHopValidation` must not be dropped.** It runs in the happy-server *route*
  today, NOT inside `ingestHandler.ts` (which checks target-machine + channel/kind
  but NOT `hopCount > MAX_HOPS` or hopPath dup/loop). The new listener MUST call
  `routeHopValidation` before the handler or those caps are silently lost. Covered by
  US-002 + tests.
- **`devtunnel` multi-port forwarding is a load-bearing assumption (verify early).**
  Option A assumes `devtunnel host <tunnelId>` forwards a *second* registered port to
  the same-numbered local port and that the second port is reachable with the same
  tunnel-scoped connect token. US-003 must verify this with a real `devtunnel`
  smoke (register two ports, host, curl the second) BEFORE the impl depends on it. If
  multi-port forwarding does not behave as assumed, escalate to the operator and fall
  back to D-004 Option B (single-port serverFactory dispatch).
- **Back-compat for existing peer pins.** A peer pinned before this change has no
  `ingestPort` hint, so discovery would resolve to the old tunnel-port URL (now a
  404). Scope A live cross-machine delivery is still **deferred/unwired** (§5.6), so
  there are no production pins today — acceptable. The impl must (a) document that
  pins created from now on include `ingestPort`, and (b) make `resolvePeerTarget`
  emit a clear, actionable error when a pinned peer lacks an `ingestPort` rather than
  silently targeting the wrong port.

## 8. Test plan

- **happy-wire** (`agentComms.test.ts`): `AgentCommsIngestBodySchema` accept/reject;
  `routeHopValidation` for `hopCount > MAX_HOPS`, duplicate hopPath, hopPath-contains-target.
- **happy-cli ingest listener** (`ingestServer.test.ts`, real Fastify on ephemeral
  port): 503 when no handler; 400 on malformed body (Zod) and on hop violations;
  400 when the handler throws (unknown peer / fingerprint mismatch / signature
  failure / sealed-body open failure — via a stub handler that throws those
  messages); 200 `{id,seq}` on success.
- **happy-cli hermetic round-trip** (`scopeA.integration.test.ts`,
  `integration-agent-comms` project): boot the real ingest listener, POST through
  `DevTunnelsPeerTransport` to the ingest-port URL, assert mailbox append; keep the
  full crypto-rejection + spawn-approval matrix. Run via
  `RUN_INTEGRATION=1 npm_config_script_shell=bash pnpm --filter happy test`.
- **embedded server 404** (`dualListenerBinding.test.ts`): assert `/agent-comms/ingest`
  is no longer served by the tunnel or loopback listener.
- **happy-server build/test**: `pnpm --filter happy-server build` (typecheck) green
  after route/config removal.
- File-scoped CLI validation: `pnpm --filter happy exec vitest run
  src/agentComms/ingestServer.test.ts src/agentComms/peerTransport.test.ts
  src/agentComms/peerResolver.test.ts src/tunnel/tunnelManager.test.ts`.

## 9. Acceptance criteria

1. A happy-cli-owned listener serves `POST /agent-comms/ingest` over the Dev Tunnel
   and calls the existing `agentCommsIngest` handler; the embedded happy-server
   returns 404 for `/agent-comms/ingest` (proven by `dualListenerBinding.test.ts`).
2. The embedded happy-server still serves pair/sessions/Socket.IO on `tunnelPort`
   (dualListener flow intact; no regression in the embedded-server start path).
3. Two-layer auth byte-for-byte preserved: layer 1 = Dev Tunnels gateway connect
   token (`X-Tunnel-Authorization`, never inspected by the backend; no loopback gate
   on ingest); layer 2 = TOFU Ed25519 verify + ECDH sealed-body open via the
   unchanged `peerAuth.ts` + `peers.json`. Proven by unknown-peer / signature-failure
   / sealed-body-failure tests rejecting **before** mailbox append.
4. `TunnelManager.listOperatorTunnels()` and `mintConnectToken()` are unmodified;
   outbound `peerTransport` still POSTs to `/agent-comms/ingest`; Dev Tunnels remains
   the sole channel (no phone/app/central server/relay added).
5. `AgentCommsIngestBodySchema` + `routeHopValidation` live in `@slopus/happy-wire`;
   happy-cli no longer imports the ingest body type from `'happy-server'`; the
   happy-server ingest route + `agentCommsIngest` config slot are removed.
6. Edit budget respected: happy-cli M, happy-server S, happy-wire S, codex none.
7. All targeted tests green (happy-wire, happy-cli unit + `integration-agent-comms`,
   happy-server typecheck).

## 10. Open items for the operator (US-001 gate)
- Confirm **D-004 = Option A** (second forwarded port) vs Option B (single-port
  serverFactory dispatch). Plan assumes A.
- Confirm a second publicly-forwarded Dev Tunnel port is acceptable (same trust
  model, one extra port).
