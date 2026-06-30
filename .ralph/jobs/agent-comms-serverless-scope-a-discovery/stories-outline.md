# Stories — `agent-comms-serverless-scope-a-discovery`

Decomposition for D-001: decouple the Scope A `POST /agent-comms/ingest` path from
the embedded happy-server into a minimal happy-cli-owned listener (D-004 Option A:
second forwarded Dev Tunnel port). Stories are ordered by dependency; US-001 is a
no-behavior-change foundation + the D-004 confirmation gate.

---

## US-001 — Relocate ingest schema + hop validation to `@slopus/happy-wire` (+ D-004 gate)
**As** the agent-comms subsystem, **I want** the ingest body schema and hop
validation in happy-wire **so that** the happy-cli listener and happy-server are
both free of the ingest type coupling.

Scope:
- Move `SenderKeysSchema`, `AgentCommsIngestBodySchema`, `AgentCommsIngestBody`,
  `AgentCommsIngestHandler`, `routeHopValidation`, `hasDuplicate` from
  `packages/happy-server/sources/app/api/routes/agentCommsIngestRoutes.ts` into
  `packages/happy-wire/src/agentComms.ts` (next to `AgentCommsEnvelopeSchema`/`MAX_HOPS`).
- Add migrated coverage to `packages/happy-wire/src/agentComms.test.ts`.
- Rebuild happy-wire dist (`pnpm --filter happy-wire build`).
- Update `packages/happy-cli/src/agentComms/ingestHandler.ts` to import
  `AgentCommsIngestBody` from `@slopus/happy-wire` (not `'happy-server'`).
- **Record the D-004 decision** (Option A) in this job dir and surface it for
  operator confirmation before US-003 proceeds.

Acceptance criteria:
- `AgentCommsIngestBodySchema` + `routeHopValidation` exported from
  `@slopus/happy-wire`; new tests cover accept/reject, `hopCount > MAX_HOPS`,
  duplicate hopPath, and hopPath-contains-target.
- happy-cli `ingestHandler.ts` no longer imports from `'happy-server'`;
  `pnpm --filter happy build` (typecheck) green.
- **happy-server stays green in the interim:** US-001 re-points the still-present
  `agentCommsIngestRoutes.ts` to import the moved symbols from `@slopus/happy-wire`
  (the route is not deleted until US-006). `pnpm --filter happy-server build` green
  after US-001 alone; no module still imports the moved symbols from happy-server.
- A short decision note exists; operator-confirmation gate flagged in the report.

---

## US-002 — happy-cli-owned ingest listener module
**As** the daemon, **I want** a standalone Fastify listener that serves only
`POST /agent-comms/ingest` **so that** ingest no longer runs through happy-server.

Scope:
- Create `packages/happy-cli/src/agentComms/ingestServer.ts` mirroring
  `daemon/controlServer.ts` (fastify + `fastify-type-provider-zod`,
  `validatorCompiler`/`serializerCompiler`). One route: validate with
  `AgentCommsIngestBodySchema`, run `routeHopValidation` → 400, `await` the injected
  `agentCommsIngest` handler (errors → 400 `{error}`), 200 `{id,seq}`, 503 when no
  handler. Binds `127.0.0.1:<ingestPort>`. Returns a `{ port, stop() }` handle.
- No `X-Loopback-Capability` gate (the 127.0.0.1 bind is the boundary).
- Create `packages/happy-cli/src/agentComms/ingestServer.test.ts` (real listener on
  an ephemeral port).

Acceptance criteria:
- Unit tests prove: 503 (no handler), 400 (malformed body), 400 (hop violation:
  MAX_HOPS / duplicate / target-in-hopPath), 400 (handler throws: unknown peer /
  fingerprint mismatch / signature failure / sealed-body open failure via stub),
  200 `{id,seq}` (success).
- Listener `stop()` releases the port; a failed start does not leak a bound port.
- File-scoped run green: `pnpm --filter happy exec vitest run
  src/agentComms/ingestServer.test.ts`.

---

## US-003 — Tunnel second-port plumbing + `machine.json` `ingestPort`
**As** the daemon, **I want** the ingest port registered on the Dev Tunnel and
persisted **so that** `devtunnel host` forwards it and it survives restarts.
**(Gated on US-001 D-004 confirmation = Option A.)**

Scope:
- Add `ingestPort` to `machine.json` (`src/persistence.ts` readers/writers);
  allocate once via `pickFreeLoopbackPort` when absent (migration), reuse otherwise.
- Register the ingest port on the tunnel before `startHost` (extend
  `LoadHostTunnelOptions`/provider, e.g. `additionalPorts?: number[]` → `ensurePort`
  per port in `devTunnelsDaemonProvider.ts`/`tunnelManager.ts`).
- `listOperatorTunnels()` and `mintConnectToken()` remain unmodified.
- **Verify the multi-port assumption first:** run a real `devtunnel` smoke (register
  two ports, `devtunnel host`, curl the second port through the tunnel with a
  connect-scoped token). If it fails, escalate + fall back to D-004 Option B.

Acceptance criteria:
- The real `devtunnel` two-port smoke succeeds (recorded), or the story escalates to
  Option B before further impl.
- Old `machine.json` without `ingestPort` is migrated by allocating a free port,
  written once, and reused on the next start.
- Unit tests (injected `CommandRunner`/`ProcessSpawner`) assert the ingest port is
  passed to `ensurePort` and that `devtunnel host` is invoked with both ports
  registered; no change to `listOperatorTunnels`/`mintConnectToken` call shapes.
- `pnpm --filter happy exec vitest run src/tunnel/tunnelManager.test.ts` green.

---

## US-004 — Wire the ingest listener into the daemon; stop injecting into happy-server
**As** the daemon, **I want** to start the ingest listener with the existing
handler and stop passing `agentCommsIngest` to the embedded server.

Scope:
- In `src/daemon/run.ts`: keep `createAgentCommsIngestHandler({...})`; start
  `ingestServer` with that handler + `ingestPort`; remove `agentCommsIngest` from
  the `bindListenersAndWriteCapability` `sharedContext`; stop the ingest listener in
  the shutdown cleanup path (and on a failed startup).
- Update `src/daemon/dualListenerBinding.ts` usage so it no longer threads
  `agentCommsIngest`.

Acceptance criteria:
- Daemon start brings up the embedded happy-server (tablet plane) AND the ingest
  listener on `ingestPort`; shutdown stops both; a failed start leaks neither.
- The embedded `sharedContext` no longer carries `agentCommsIngest`.
- Daemon integration/typecheck paths compile; existing daemon tests pass (with the
  US-006/US-007 updates).

---

## US-005 — Outbound discovery: select the ingest port
**As** a sending daemon, **I want** `ingestUrl()` to target the peer's ingest port
**so that** signed/sealed envelopes reach the new listener. **(Gated on Option A.)**

Scope:
- Add optional `ingestPort?: number` to `PeerConfigHints`/`PinnedPeerKeys` and
  persist/read it in `peerAuth.ts` `pinPeerKeys`/`readPeerPins`.
- `peerTransport.ts` `ingestUrl(tunnel, ingestPort?)` selects the ingest port's
  `portUri` when provided; path suffix stays `/agent-comms/ingest`.
- `peerResolver.ts` passes `pinned.ingestPort` to `ingestUrl(...)`.

Acceptance criteria:
- With an `ingestPort` hint, `ingestUrl` returns the ingest-port host +
  `/agent-comms/ingest`; without it, behavior is unchanged (back-compat).
- `resolvePeerTarget` emits a clear, actionable error when a pinned peer has no
  `ingestPort` (rather than silently targeting the old happy-server port).
- `peerTransport.test.ts` + `peerResolver.test.ts` cover both paths and stay green.
- `X-Tunnel-Authorization` header + `mintConnectToken(target.tunnelId)` usage
  unchanged.

---

## US-006 — Retire the happy-server ingest route + config slot
**As** happy-server, **I want** the ingest route and `agentCommsIngest` config slot
removed **so that** happy-server is fully out of the ingest path.

Scope:
- Remove the `agentCommsIngestRoutes(typed, ...)` registration + import from
  `sources/app/api/api.ts`; remove `agentCommsIngest` from `ConfigureApiOptions` and
  the `configureApi` call.
- Remove `agentCommsIngest` from `HappyServerConfig`, `HappyServerSharedContext`,
  `CreateAppConfig`, the `configureApi(...)` pass-through, and the
  `AgentCommsIngestHandler` import in `sources/index.ts`.
- Delete `sources/app/api/routes/agentCommsIngestRoutes.ts` and its `.spec.ts`.

Acceptance criteria:
- `pnpm --filter happy-server build` (typecheck) green; no dangling references.
- No happy-server route serves `/agent-comms/ingest`.
- happy-cli's `dualListenerBinding.ts` type usage compiles against the trimmed
  `HappyServerSharedContext`.

---

## US-007 — Tests: end-to-end round-trip + topology regression
**As** a maintainer, **I want** the real-listener round-trip and the new topology
proven **so that** the decoupling is verified.

Scope:
- Update `src/agentComms/scopeA.integration.test.ts` to boot the real
  `ingestServer` and POST through `DevTunnelsPeerTransport` to the ingest-port URL;
  keep the full crypto-rejection + spawn-approval matrix; fix the expected URL.
- Rewrite `src/daemon/dualListenerBinding.test.ts` to assert the embedded tunnel +
  loopback listeners return 404 for `/agent-comms/ingest`.

Acceptance criteria:
- `RUN_INTEGRATION=1 npm_config_script_shell=bash pnpm --filter happy test` passes
  the `integration-agent-comms` project including a real-listener append round-trip.
- `dualListenerBinding.test.ts` proves the embedded server no longer serves ingest.
- Rejection tests show no mailbox append on unknown peer / signature failure /
  sealed-body failure / malformed body / hop violation.

---

## US-008 — Documentation
**As** a future agent, **I want** the docs to reflect the new ingest topology.

Scope:
- `packages/happy-cli/src/daemon/AGENTS.md` — rewrite the `/agent-comms/ingest`
  bullet (happy-cli-owned listener on a second forwarded port; embedded server no
  longer serves it; update the "single forwarded port (no second port)" line).
- `packages/happy-cli/AGENTS.md` — update the Scope A ingest-verification note to
  add `ingestServer.ts` + the happy-wire schema home.
- `packages/happy-server/AGENTS.md` — note ingest moved out; trim route inventory
  if listed.
- Cross-reference `plans/durable-mailbox-channel-wake.md` / `plans/agent-comms-design.md`.

Acceptance criteria:
- All four docs updated consistently with the shipped topology; no stale references
  to happy-server serving ingest.

---

### Follow-up (NOT in this job)
- Deferred §5.6 Scope A live cross-machine round-trip (`devtunnel host` each side, a
  real signed+sealed envelope hop, and a remote-daemon operator-approval UI before
  any cross-machine spawn). File separately; cross-reference
  `codex-raw-session-happy-daemon-autoconnect`.
