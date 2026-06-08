Lenses: ran=[codex, copilot, devils-advocate]; skipped=[] (full mode)

# Brainstorm synthesis — agent-comms-serverless-scope-a-discovery

**Question.** Make Scope A cross-machine agent/session discovery + message ingest
work over Microsoft Dev Tunnels with NO happy-server — eliminating even the
EMBEDDED per-daemon happy-server that today hosts `POST /agent-comms/ingest`.
Dev Tunnels must remain the SOLE channel for data + signaling + rendezvous +
discovery + auth. What is the minimal tunnel-facing listener that replaces the
embedded happy-server for ingest, and can happy-server be fully removed from the
daemon?

**Headline result (unanimous across all three lenses).** The operator's lean
conflates two goals. Removing happy-server from the **Scope A ingest path** is
feasible and medium-effort. Removing the **embedded happy-server from the daemon
entirely** is NOT a Scope A change — source shows the embedded tunnel listener IS
the tablet/CLI session plane, so its removal is a separate multi-epic
mobile/session-server replacement. All three lenses independently reached this
conclusion with file:line citations.

## The decisive source facts (settle the verdict)

- The embedded happy-server is started by `dualListenerBinding()` as **two**
  `createApp` Fastify instances — a `tunnel` listener on `state.tunnelPort`
  (`auth:'tunnel'`) and a `loopback` listener on `state.loopbackPort`
  (`auth:'loopback'`); the Dev Tunnel forwards to the tunnel listener
  (`packages/happy-cli/src/daemon/dualListenerBinding.ts:36-69`).
- `configureApi` registers the **full mobile/session surface** on the tunnel
  listener, not just ingest: `accountRoutes` + `machineSelfRoutes` on both
  listeners, and on the tunnel listener additionally `pairRoutes`, `pushRoutes`,
  `sessionRoutes`, `devRoutes`, `versionRoutes`, `agentCommsIngestRoutes`,
  `v3SessionRoutes`, plus Socket.IO via `startSocket`
  (`packages/happy-server/sources/app/api/api.ts:101-117`).
- The Cloudflare-vs-embedded contradiction is reconciled: fork docs mention a
  standalone `localhost:3005`/Cloudflare server for dev posture
  (`AGENTS.md`, `docs/fork-notes.md`), but the **app's live pairing + sync path
  is the per-daemon embedded happy-server over the Dev Tunnel**: the app pairs
  against `machine.url + /pair/complete`
  (`packages/happy-app/sources/auth/pairing.ts:139-153`), stores the daemon
  `tunnelUrl` as credentials (`pairing.ts:162-177`), then sends HTTP + Socket.IO
  to `credentials.tunnelUrl` (`packages/happy-app/sources/sync/sync.ts:1172-1180,
  2191-2199`; `apiSocket.ts:202-218`; `socketOptions.ts:19-43`;
  `tunnelProvider.ts:170-195`). => the embedded happy-server is load-bearing for
  the tablet; it cannot be removed without stranding it.
- The Scope A ingest's REAL auth + mailbox delivery is ALREADY happy-cli code,
  merely **injected** into happy-server: `agentCommsIngest` in
  `packages/happy-cli/src/daemon/run.ts:219-241` does TOFU-pin lookup +
  fingerprint/pubkey checks + `verifyEnvelopeSignature` + `openSealedBody` +
  `advanceAgentCommsRelay` + `appendMessage`, using
  `packages/happy-cli/src/agentComms/peerAuth.ts`. The happy-server route
  (`agentCommsIngestRoutes.ts:45-69`) only does Zod-shape + hop validation and
  delegates to the injected handler; its `app.authenticate` is a no-op for tunnel
  auth (`api.ts:79-80`).
- Discovery + layer-1 auth are happy-cli + the gateway, never happy-server:
  `TunnelManager.listOperatorTunnels()` shells `devtunnel list --json` and
  `mintConnectToken()` shells `devtunnel token --scope connect`
  (`packages/happy-cli/src/tunnel/tunnelManager.ts:332-352`); outbound
  `DevTunnelsPeerTransport` hard-codes `POST /agent-comms/ingest` +
  `X-Tunnel-Authorization` (`packages/happy-cli/src/agentComms/peerTransport.ts:44-47,
  63-74`). The Microsoft gateway consumes/strips `X-Tunnel-Authorization` before
  the backend (`plans/agent-comms-design.md:201-213, 423-425`).

**Therefore:** none of happy-server's machinery is load-bearing FOR INGEST. A
minimal happy-cli-owned listener calling the same injected handler preserves both
auth layers and discovery unchanged. But happy-server stays in the daemon for the
mobile/session plane.

### D-001: Tiny happy-cli-owned HTTP ingest listener; keep the embedded happy-server for the mobile/session plane  **(RECOMMENDED)**
- Contributing lenses: [codex, copilot, devils-advocate]
- Why this might work: ingest auth/discovery already live outside happy-server
  (run.ts:219-241, peerAuth.ts, tunnelManager.ts:332-352, peerTransport.ts:44-74);
  the happy-server route is a thin Zod+hop wrapper over the injected handler. A
  small happy-cli listener (prefer Fastify+Zod, mirroring the existing
  `controlServer.ts` which already imports `appendMessage`/`dispatchAgentCommsEnvelope`)
  serving only `POST /agent-comms/ingest` reproduces the route boundary and calls
  the same `agentCommsIngest` closure. Outbound `peerTransport` is unchanged
  because the URL path stays `/agent-comms/ingest`.
- Risks / friction: a "tiny" listener still re-owns content-type checks, body-size
  limits (happy-server uses a 100MB `bodyLimit`), malformed-JSON behavior,
  status-code mapping, and the injected-handler contract — i.e. it is a SECOND
  HTTP stack alongside happy-server, not zero server code. If it binds a new local
  port, `devtunnel host` must forward a second port (see D-004), which stresses the
  "discovery unchanged" constraint.
- Cheapest validation: spike a 1-route daemon-owned listener on a tunnel-forwarded
  port that validates the same body/hop shape as `agentCommsIngestRoutes.ts:45-69`,
  calls the existing `run.ts` handler, and proves `peerTransport.ts` needs no
  outbound change. Add tests for malformed body, MAX_HOPS/hopPath loop/duplicate,
  unknown peer, signature failure, sealed-body open failure, and successful append.
- Edit budget: happy-cli **M** (new listener module + run.ts wiring +
  dualListenerBinding adjustment if a second port is forwarded), happy-server **S**
  (ingest route/config shim retired once schema relocates), codex **none**.
  Strongly consider moving `AgentCommsIngestBodySchema` + `routeHopValidation` to
  `@slopus/happy-wire` so happy-cli owns the listener without importing happy-server.
- Disconfirming observation: rule this out as "daemon-wide removal" if a paired
  tablet still needs `/pair/complete`, `/v1/sessions`, `/v2/me/machine`,
  `/v1/updates`, settings, or push over the same daemon tunnel and those surfaces
  are not migrated in the same release — which source confirms they are not.

### D-002: Full embedded-happy-server removal — reframed as a separate multi-epic mobile/session server-replacement project (the literal operator lean)
- Contributing lenses: [codex, copilot, devils-advocate]
- Why this might (eventually) work: it is the operator's literal intent and is not
  theoretically impossible — Dev Tunnels can remain the sole channel if a
  daemon-native server re-implements every tunnel route.
- Risks / friction: source turns it from a transport tweak into a broad
  replacement. Removing the embedded server silently breaks pairing
  (`pairRoutes.ts:65-118` returns machineId/tunnelUrl/TOFU keys/shared secret),
  encrypted session sync (`/v1/sessions`, `/v3/sessions/:id/messages`), Socket.IO
  real-time + machine RPC (`socket.ts:98-110, 138-190`; `apiMachine.ts:440-453,
  533-542`), settings/profile, push tokens, machine-self state, and the embedded
  PGlite bootstrap. happy-server's own AGENTS.md says request decorators, socket
  handlers, eventRouter fan-out, presence, and seq allocation are single-process
  embedded surfaces, not incidental plumbing (`packages/happy-server/AGENTS.md:5-39`).
- Cheapest validation: do NOT implement first. If this is truly the target, file a
  dedicated daemon-native server-replacement plan with explicit migration steps and
  a live tablet dogfood gate, separate from agent-comms ingest.
- Disconfirming observation: the app's live pairing/sync path IS the per-daemon
  embedded happy-server (D-001 facts), so "no happy-server at all" strands the
  tablet unless those routes are replaced first.

### D-003: Reject the alternative minimal listeners — un-loopback controlServer.ts / codex app-server / raw socket
- Contributing lenses: [codex, copilot, devils-advocate]
- Why these are tempting: each reuses an existing listener/protocol so it sounds
  like "less server."
- Risks / friction (why each is rejected):
  - **Option 2 (un-loopback controlServer.ts):** security regression. It owns
    `/list`, `/stop-session`, `/spawn-session`, `/spawn-session-from-session`,
    `/agent-comms/send`, `/stop` with NO auth gate beyond the 127.0.0.1 binding
    (`controlServer.ts:65-388`, esp. the `/agent-comms/send` comment at :270-274
    and `listen('127.0.0.1')` at :371). Exposing it to the tunnel hands
    spawn/stop controls to any gateway-admitted caller unless a public
    ingest-only app is split out first — at which point it IS just D-001 under a
    riskier name.
  - **Option 3 (codex app-server):** ruled out by the documented security
    mandate — "must only bind `ws://127.0.0.1`; never expose on 0.0.0.0, LAN,
    public, or tunnels" (`packages/happy-cli/AGENTS.md:281-285`;
    `codexAppServerClient.ts:1223`). Also couples agent-comms transport to one
    agent implementation.
  - **Option 4 (raw TCP/WebSocket):** only preserves "Dev Tunnels only" by
    discarding the current HTTP `POST /agent-comms/ingest` + JSON `{id,seq}`
    contract and the curl-able manual smoke; it needs new framing, backpressure,
    lifecycle, schema parsing, and error mapping for little gain (the expensive
    part is the auth/mailbox semantics, not HTTP).
- Cheapest validation: a one-page threat/edit-budget table; do not implement.
- Disconfirming observation: all three "less server" options either widen an
  internal control plane, violate the codex loopback boundary, or re-derive half
  of Fastify/Zod/error semantics.

### D-004: Second Dev Tunnel port vs shared-port for the ingest listener (implementation sub-decision within D-001)
- Contributing lenses: [copilot, devils-advocate]
- Why this matters: if happy-server stays for mobile and a separate listener owns
  ingest, the listener needs its own local port. Two sub-options:
  (a) `devtunnel host` forwards a SECOND port for ingest — keeps happy-server's
  port untouched but `peerTransport.ingestUrl()` currently derives a single ingest
  URL from the tunnel URL / first port (`peerTransport.ts:44-47`), so a second port
  needs reliable identification via `devtunnel list --json` and a durable way to
  name the agent-comms port WITHOUT adding a non-Dev-Tunnels registry; or
  (b) keep the ingest route co-located on the existing tunnel port (then "remove
  happy-server from the ingest path" means the listener on that port stops being a
  full happy-server — which loops back to D-002's mobile dependency).
- Risks / friction: option (a) stresses the "§5.3 discovery unchanged" constraint;
  option (b) cannot coexist with keeping happy-server on the same port.
- Cheapest validation: `devtunnel port create` a second port and confirm
  `devtunnel list --json` exposes both `portUri` values reliably + connect-token
  behaves per-port; then a tiny local patch selecting the agent-comms port from
  `OperatorTunnel`.
- Disconfirming observation: if Dev Tunnels management output cannot reliably
  distinguish the agent-comms port, or the operator requires one tunnel URL per
  machine, option (a) is out and ingest must stay co-located (favoring leaving
  ingest on happy-server until a daemon-native server exists).

## Deferred Scope A live-impl path (design §5.6, never re-filed)
Independent of the listener choice, Scope A live cross-machine networking is still
design+skeleton only (`plans/agent-comms-design.md:271-282`). A recommended
direction must outline the live-impl follow-up: real `devtunnel host` on each side,
a real cross-machine signed+sealed envelope round-trip (the §8 manual two-machine
smoke, `agent-comms-design.md:323-433`), and an operator-approval UI at the remote
daemon before any cross-machine `agent_comms.spawn` starts a child
(`agent-comms-design.md:427-433`). Cross-reference
`codex-raw-session-happy-daemon-autoconnect`: raw codex session discoverability
should reuse this same Dev-Tunnels discovery/ingest metadata rather than exposing
the codex app-server directly.

## Open questions carried to planning
1. Is the target "no happy-server in the ingest PATH" (D-001, medium) or "no
   embedded happy-server at all" (D-002, multi-epic)? D-001 assumes the former and
   explicitly reframes the latter.
2. Move `AgentCommsIngestBodySchema` + `routeHopValidation` to `@slopus/happy-wire`
   (or a happy-cli shared module) so the listener avoids importing happy-server?
3. Second forwarded Dev Tunnel port for ingest, or co-located on the existing port?
   (D-004.)
4. Should a live two-machine round-trip + operator-approval UI gate the deferred
   §5.6 live-wiring impl, and should `codex-raw-session-happy-daemon-autoconnect`
   share this transport's discovery/ingest metadata?
