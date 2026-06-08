---
overviewTaskId: agent-comms-serverless-scope-a-discovery
---

## Direction
D-001 — Tiny happy-cli-owned HTTP ingest listener; keep the embedded happy-server
for the mobile/session plane. Replace the embedded happy-server **for Scope A
ingest only** with a minimal happy-cli-owned HTTP listener that serves just
`POST /agent-comms/ingest` and calls the existing daemon-injected `agentCommsIngest`
handler — preserving the two-layer auth and Dev-Tunnels discovery unchanged, while
explicitly NOT removing happy-server from the daemon (it is the tablet/CLI session
plane).

## Verdict on "can happy-server be fully removed from the daemon?"
**No — not from the daemon.** Source is decisive: the embedded happy-server's
tunnel listener registers the entire mobile/session surface (pair, push, sessions,
v3 messages, account/settings, machine-self, Socket.IO real-time + machine RPC),
and the e-ink tablet app pairs and syncs against that per-daemon embedded server
over the Dev Tunnel (`packages/happy-server/sources/app/api/api.ts:101-117`;
`packages/happy-app/sources/auth/pairing.ts:139-177`;
`packages/happy-app/sources/sync/sync.ts:1172-1180, 2191-2199`;
`apiSocket.ts:202-218`). Removing it strands the tablet.
**Yes — from the Scope A ingest path.** The ingest route's real auth + mailbox
delivery already live in happy-cli (`run.ts:219-241` + `agentComms/peerAuth.ts`),
merely injected into happy-server; discovery + connect-token live in
`tunnel/tunnelManager.ts:332-352`; outbound posts a hard-coded
`/agent-comms/ingest` (`agentComms/peerTransport.ts:44-74`). So a minimal
happy-cli listener can own ingest with happy-server uninvolved in that path.

## Goal
A daemon-owned minimal HTTP listener (no full happy-server) accepts the Scope A
`POST /agent-comms/ingest` over a Microsoft Dev Tunnel, applies the existing
Zod-shape + hop validation, and delegates to the existing `agentCommsIngest`
closure (TOFU pin → fingerprint/pubkey check → Ed25519 verify → ECDH open →
relay-advance → `mailbox.appendMessage`). The embedded happy-server remains in the
daemon for the mobile/session plane. Dev Tunnels stays the SOLE channel for data +
signaling + rendezvous + discovery + auth; outbound `peerTransport` is unchanged.

## Scope
### In Scope
- A new happy-cli-owned ingest listener module (prefer Fastify+Zod, mirroring
  `daemon/controlServer.ts`, which already imports `appendMessage` /
  `dispatchAgentCommsEnvelope`), serving ONLY `POST /agent-comms/ingest`.
- Wire it into `daemon/run.ts` and reuse the existing `agentCommsIngest` closure
  (`run.ts:219-241`) unchanged; keep `peerAuth.ts` as the crypto.
- Relocate `AgentCommsIngestBodySchema` + `routeHopValidation` to
  `@slopus/happy-wire` (or a happy-cli shared module) so the listener does not
  import happy-server.
- Decide + implement the port/forwarding model (D-004): either `devtunnel host`
  forwards a SECOND port for ingest (keeping happy-server's tunnel port intact), or
  ingest stays co-located — chosen to keep `§5.3` `devtunnel list --json` discovery
  and `peerTransport.ingestUrl()` behavior unchanged.
- Retire the happy-server `agentCommsIngestRoutes` route + the `agentCommsIngest`
  config slot from happy-server once the listener owns ingest.
- Tests: malformed body, MAX_HOPS / hopPath loop / duplicate, unknown peer,
  signature failure, sealed-body open failure, successful append; outbound
  `peerTransport` unchanged.

### Out of Scope
- Removing the embedded happy-server from the daemon (mobile/session plane). That
  is a separate multi-epic migration (D-002) with its own plan + live tablet
  dogfood gate, NOT part of this task.
- Un-loopback-ing `controlServer.ts`, using the codex app-server as the ingest
  surface, or a raw TCP/WebSocket transport (all rejected — see D-003).
- Codex submodule edits (edit budget: codex = none).

## Criteria
- A minimal happy-cli-owned listener serves `POST /agent-comms/ingest` over the
  Dev Tunnel with happy-server NOT in the ingest request path; the embedded
  happy-server still serves pair/sessions/Socket.IO for the tablet.
- The §5.4 two-layer auth is byte-for-byte preserved: layer 1 = Dev Tunnels
  gateway connect-token (unchanged; backend never inspects
  `X-Tunnel-Authorization`); layer 2 = TOFU Ed25519 verify + ECDH sealed-body open
  via the same `peerAuth.ts` helpers + peer-pin store. Proven by tests for unknown
  peer / signature failure / sealed-body failure rejecting before mailbox append.
- §5.3 discovery is unchanged: `TunnelManager.listOperatorTunnels()`
  (`devtunnel list --json`) + `mintConnectToken()` are untouched, and outbound
  `peerTransport` still posts to `/agent-comms/ingest`.
- Dev Tunnels remains the SOLE channel (no phone/app/central server/relay added).
- Edit budget respected: happy-cli M, happy-server S (route + schema relocation),
  codex none.

## Context
- Unanimous 3-lens conclusion (codex + copilot + devils-advocate, all
  source-cited): the operator's "NO happy-server at all" conflates two goals;
  decoupling ingest is feasible (medium), full daemon-wide removal is a separate
  multi-epic. This brainstorm corrects the lean's overreach rather than
  rubber-stamping it.
- The biggest red flag (devils-advocate): "tiny" is not free — the listener
  re-owns content-type/size/error/status semantics and is a SECOND HTTP stack next
  to happy-server. If the win is "less server," weigh it against the option of
  simply leaving ingest on happy-server until a daemon-native server replaces the
  mobile plane. The honest minimal change is "decouple the ingest path," not
  "remove happy-server."
- Deferred Scope A live-wiring (design §5.6, never re-filed): outline a follow-up
  impl with real `devtunnel host` each side, a real cross-machine signed+sealed
  envelope round-trip (the §8 manual smoke), and an operator-approval UI at the
  remote daemon before any cross-machine spawn. Cross-reference
  `codex-raw-session-happy-daemon-autoconnect`: raw codex session discoverability
  should reuse this Dev-Tunnels discovery/ingest metadata, not expose the codex
  app-server (loopback-only mandate).
- Key open questions for planning: (1) ingest-path-only vs daemon-wide removal
  (assume the former); (2) relocate schema/hop-validation to happy-wire; (3) second
  forwarded Dev Tunnel port vs co-located ingest port; (4) live round-trip +
  approval-UI gate for the deferred §5.6 impl.
