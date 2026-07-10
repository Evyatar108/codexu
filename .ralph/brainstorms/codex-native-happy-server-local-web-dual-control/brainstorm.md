# Native Rust Happy session plane for local Codex TUI + web dual-control

- **Task:** `codex-native-happy-server-local-web-dual-control`
- **Phase:** brainstorm only — no production code changed
- **Date:** 2026-07-09
- **Worktree:** `D:\harness-efforts\codexu\.worktrees\native-happy-web-dual-control-sol`
- **Branch:** `ralph/brainstorm-codex-native-happy-server-local-web-dual-control-sol`
- **Base:** `eed3c9156`

> **Recommended direction: D-001 — build a scoped, Codex-owned Rust Happy
> compatibility plane, not a port of the full Node server.**
>
> Add a fork-exclusive `codex-happy-server` overlay crate using
> Axum + Socketioxide + SQLx/SQLite. Keep the existing Happy HTTP and Socket.IO
> contract at the browser boundary, keep `codex-happy` as a real loopback
> session client, and factor its existing inbound logic into one serialized
> `CodexControlAdapter`. Browser `rpc-call` requests route directly from the
> embedded server to that adapter, while browser user messages still traverse
> the real Happy session protocol over loopback. Pair the existing Happy web app
> with Ed25519 device proof; never expose an unauthenticated localhost server.

There is no fundamental architecture blocker. There are three hard proof gates:

1. Socketioxide must pass an actual browser + `socket.io-client@4.8.1`
   compatibility spike on `/v1/updates`, including polling headers and acks.
2. The local message/agent-state payload codec must be made explicit because
   the current app expects plaintext JSON while `codex-happy` currently emits
   ciphertext.
3. Approval resolution needs an authoritative first-answer-wins result, not the
   current fire-and-forget “probably resolved” behavior.

---

## 1. Verdict

The prior Rust-feasibility investigation reached a qualified “not for v1”
because it assumed:

- the app was an effectively unmodifiable counterparty;
- the server needed much of the full account/auth/machine/push surface;
- the generic Socket.IO RPC bridge had to round-trip through a Rust
  `rpc-request` client; and
- Node protocol lockstep was an acceptable runtime dependency.

Those assumptions no longer hold for this task:

- Small additive app/wire compatibility changes are explicitly allowed.
- Phase 1 is one local user, one machine, and one Codex session.
- Existing paired-device auth can be generalized instead of recreating the old
  account/GitHub flow.
- An in-process control adapter removes the missing Rust inbound-ack dependency.
- The operator explicitly rejects `happy-cli` and a Node happy-server runtime.

The correct boundary is therefore **not “port happy-server.”** It is:

> Implement the smallest server-compatible slice required by the existing
> Happy web app and the existing `codex-happy` session client, with the live
> Codex TUI remaining the owner of the process and control handle.

This preserves the north-star split:

- **Control plane:** Codex app-server requests against the running TUI.
- **Session plane:** Happy HTTP/Socket.IO session semantics.
- **Transport:** loopback only in Phase 1.

It also preserves the operator’s strongest acceptance condition: the browser
and terminal are two controllers of the **same in-process Codex thread**, not
two separately spawned agents.

---

## 2. Source-grounded findings

### 2.1 The live-TUI seam already exists and is the right control boundary

The TUI already stores an optional Happy event tap
(`codex/.../tui/src/app.rs:593-597`), creates it only behind
`Feature::RemoteSession` (`app.rs:1027-1056`), and clones every
`AppServerEvent` into it before normal local handling
(`app.rs:1260-1267`). It also passes the cloneable
`AppServerRequestHandle`, which is the exact boundary needed to start, steer,
interrupt, and resolve approvals against the live thread
(`app.rs:1034-1053`).

Mid-session `/remote on|off` already installs or drops the tap; dropping it
causes the attach task to cancel approvals and close its socket without killing
Codex (`tui/src/app/event_dispatch.rs:35-87`). This is reusable lifecycle
ownership, not something the Rust server must reinvent.

The prior investigations correctly establish that this is the only current
path that supports a human-operated TUI and Happy control of the same Codex
instance:

- `.ralph/investigations/codex-appserver-vs-happy-wiring/findings.md`
- `.ralph/investigations/happy-agent-driving-modes/findings.md`

The standalone `codex app-server` binary is not needed. The ordinary TUI
already uses the app-server library in process, and Happy is merely a second
consumer of its event/request boundary.

### 2.2 Current Node dependencies are explicit and replaceable

The current “native” attach still depends on the external Happy daemon:

- `daemon_supervisor.rs:1-15` says Phase 1 drives Node
  `happy daemon start-sync`.
- `daemon_supervisor.rs:254-263` constructs a `happy` process.
- `auth.rs:59-67,173-183` reads `~/.happy/machine.json`.
- `attach.rs:472-526` resolves `~/.happy` credentials and daemon state.

Those paths must not remain as a fallback for the new backend. A native-local
backend that fails must fail loudly and remain detached; it must never
silently execute `happy`, read `~/.happy/access.key`, or discover
`machine.json`.

The legacy `HAPPY_CURRENT_SESSION_ID` guard remains useful only as a collision
guard when Codex was launched underneath an old happy-cli flow
(`codex-happy/src/attach.rs:70-76`). Native-local mode should refuse that
double-wrap case, not invoke the legacy daemon.

### 2.3 The current browser and Rust client disagree on message encoding

The forked Happy app reads `message.content.c` as plaintext JSON:

- `packages/happy-app/sources/sync/sync.ts:103-111`
- `packages/happy-app/sources/sync/sync.ts:149-168`

The Node server also stores the client bytes verbatim inside an envelope named
`{t:"encrypted"}`:

- `packages/happy-server/sources/app/api/routes/v3SessionRoutes.ts:144-192`
- `v3SessionRoutes.ts:214-226`

In contrast, the current Rust client explicitly encrypts direct-server traffic:

- `codex-happy/src/session.rs:19-27`
- `codex-happy/src/session.rs:339-350`

The same mismatch exists for agent state. The app directly parses
`session.agentState` and `update-session.agentState.value` as JSON
(`happy-app/sync.ts:1211-1220,1961-1966`), while the Rust client encrypts every
non-null `update-state` value (`codex-happy/src/session.rs:451-473`).
Metadata is already plaintext in both paths.

Therefore the present `codex-happy` client and present web app cannot share the
same session payload unchanged. The local proof needs an explicit payload
codec:

```text
SessionPayloadCodec::LegacyPlainJson
    message body JSON -> UTF-8 JSON string
    agent state JSON -> UTF-8 JSON string
    message envelope remains { "t": "encrypted", "c": "<JSON string>" }
```

The misleading envelope name is preserved only for app compatibility. Code,
logs, tests, and docs must call the codec plaintext. The existing encrypted
codec remains available for legacy/remote backends; this is not a global
removal of crypto.

### 2.4 The app can target loopback, but its auth mode cannot express it today

The app already stores a per-machine arbitrary `tunnelUrl`
(`packages/happy-app/sources/auth/tokenStorage.ts:11-31`) and passes the
configured endpoint directly to `socket.io-client`
(`packages/happy-app/sources/sync/apiSocket.ts:211-218`). A URL such as
`http://127.0.0.1:<port>` is therefore transport-compatible.

The blocker is credential classification:

- `machineAuth.ts:9-21` treats Ed25519 device proof as “public mode” only when
  both Cloudflare service-token fields are present.
- Otherwise `machineAuth.ts:89-92` tries to refresh a Dev Tunnels token.
- `publicPairingInvite.ts:37-54` requires a Cloudflare block in every invite.

The smallest additive change is a real auth discriminator:

```ts
authMode: 'dev-tunnel' | 'paired-device'
```

`paired-device` always signs the request. Cloudflare headers become an optional
edge layer within that mode, not the mode discriminator. A one-time token-store
migration writes the discriminator for current Cloudflare and Dev Tunnels
records.

Do not weaken the existing public invite schema by making its Cloudflare block
optional. Add a distinct, discriminated local invite schema and route both
invite kinds through the existing server-configuration screen.

The current server configuration screen already accepts a pasted pairing
invite and calls the enrollment path
(`packages/happy-app/sources/app/(app)/server.tsx:168-189`). The real existing
UI can be reused; no diagnostic client or new navigation flow is needed.

### 2.5 Socket.IO acknowledgements are load-bearing, and current Rust RPC is incomplete

The app uses Socket.IO acknowledgements for:

- message-range pagination:
  `packages/happy-app/sources/sync/apiSocket.ts:315-327`;
- session RPC:
  `apiSocket.ts:357-379`;
- metadata/state CAS through the existing server handlers
  (`sessionUpdateHandler.ts:55-205`).

The Node server’s generic RPC flow requires the daemon client to:

1. emit `rpc-register` and join a method room
   (`rpcHandler.ts:128-158`);
2. receive `rpc-request`; and
3. acknowledge that inbound request
   (`rpcHandler.ts:160-256`).

The current Rust session client only installs an `rpc-request` listener
(`codex-happy/src/session.rs:239-246`) and forwards `{method, params}` to the
attach loop (`session.rs:780-792`). It never emits `rpc-register`, and its
handler receives no callback/ack object. Its own type comment says the reply is
deferred (`session.rs:103-114`).

Therefore the existing code is **not** a working browser permission/abort RPC
bridge.

Recommended correction:

- Factor current turn/approval/interrupt logic into a serialized
  `CodexControlAdapter`.
- Register that adapter directly in the embedded server for
  `<sessionId>:permission`, `<sessionId>:abort`, and any explicitly supported
  methods.
- `rpc-call` invokes the adapter in process and sends a real browser ack.
- Browser user messages continue through HTTP -> server update ->
  session-scoped `codex-happy` client, preserving a real end-to-end session
  protocol proof.

This is smaller and more deterministic than replacing/upgrading
`rust_socketio` solely to make it an inbound RPC server.

### 2.6 Existing sequence, replay, and idempotency semantics must be preserved

The existing contract includes:

- per-session monotonic message `seq`;
- `(sessionId, localId)` idempotency;
- forward and backward pagination
  (`v3SessionRoutes.ts:8-31,64-118`);
- version-checked metadata/agent-state CAS
  (`sessionUpdateHandler.ts:55-205`);
- Socket.IO replay using `lastSeenSeq`
  (`socket.ts:214-228`);
- a 1,024-update replay ring
  (`eventRouter.ts:223-229`);
- `replay-overflow` followed by an HTTP refresh
  (`happy-app/sync.ts:1710-1744`); and
- `session-message-range` acknowledgement semantics
  (`sessionMessageRangeHandler.ts:1-145`).

The Node implementation’s replay `currentSeq` is process-local
(`eventRouter.ts:223-229`). A native server intended to survive restart should
improve this:

- persist the latest update sequence in SQLite;
- initialize the runtime cursor from it;
- keep the most recent 1,024 routed updates in memory;
- after restart, if a browser cursor is behind the persisted cursor but the
  ring cannot cover the gap, emit `replay-overflow`;
- recover authoritative session/message state over HTTP.

The replay ring is an optimization. SQLite messages, metadata, state versions,
and update cursor are authoritative.

### 2.7 Current session identity and local-prompt mirroring are insufficient

Current session tags are random for every attach
(`codex-happy/src/attach.rs:777-780`). `/remote off` followed by `/remote on`
can therefore create a second Happy session for one Codex thread.

The stable key should be the primary Codex thread ID:

```text
tag = "codex-thread:" + thread_id
```

The server’s existing create route is idempotent by unique tag
(`packages/happy-server/.../sessionRoutes.ts:214-260`;
`prisma/schema.prisma:22-40`), so the Rust implementation should retain that
invariant.

There is also a transcript gap. `mapping.rs:13-18` explicitly drops
`ThreadItem::UserMessage`, so prompts typed in the TUI do not appear in Happy.
Fortunately both `TurnStartParams` and `TurnSteerParams` already expose
`client_user_message_id`
(`app-server-protocol/src/protocol/v2/turn.rs:66-70,165-186`).

The dual-control design should:

1. preserve the Happy message `localId` when decoding a browser message;
2. pass `happy:<localId>` as `client_user_message_id`;
3. suppress any echoed `ThreadItem::UserMessage` whose `client_id` has that
   reserved `happy:` source prefix; and
4. mirror every other primary-thread user item as a durable Happy user message
   with deterministic local ID `codex-origin:user:<item-id>`.

There is a second echo boundary: the server broadcasts a committed message back
to the session-scoped client (`v3SessionRoutes.ts:228-231`). The Rust client
must not treat its own mirrored TUI prompt as a new browser command. Reserve
`codex-origin:` local IDs for internal-capability writes, reject that prefix on
paired browser writes, and suppress those rows from inbound user routing while
still advancing sequence state. This rule survives reconnect/backfill; an
in-memory recent-ID set alone would not.

`InboundEvent::UserMessage` must also retain the outer server message ID,
sequence, and local ID; `session.rs:670-748` currently discards that identity.
Only after `TurnStart`/`TurnSteer` is accepted should the Rust client post the
existing `message-consumption` event for that server message ID. A failed
admission remains pending/unconsumed and is retried on the next authoritative
turn-state change rather than being silently marked handled.

This makes terminal-origin and browser-origin prompts visible exactly once.

### 2.8 Existing output mapping is live at item boundaries, not token-streaming

`mapping.rs:106-137` forwards primary turn boundaries and final item events,
and `mapping.rs:165-190` sends final agent text plus tool start/end. Its header
explicitly states that agent/reasoning/tool-output deltas are dropped
(`mapping.rs:1-18`).

The task’s “stream to both” acceptance must not claim this is already solved.
Recommended additive protocol:

```text
ephemeral type: session-output-snapshot
fields: sessionId, threadId, turnId, itemId, revision, text, emittedAt
```

- `codex-happy` accumulates `AgentMessageDelta` by item ID.
- It emits full snapshots, not raw deltas, through a bounded coalescer.
- Default cadence should be static/e-ink-safe (for example <=4 Hz), with no
  smooth animation.
- `revision` is monotonic per item; the app ignores equal/regressing snapshots.
- The server keeps only the latest in-flight snapshot per item and sends it to
  a reconnecting browser.
- `ItemCompleted` posts the durable final message and clears the transient
  snapshot.
- Tool start/end remain durable. Streaming command output is not required for
  the local proof.

If the existing message components cannot host one transient in-progress item
without a design judgment, that narrow rendering decision should go to a later
Opus 4.8 UI sub-agent. The transport/state contract is part of this task; a UI
redesign is not.

---

## 3. Candidate directions

### D-001 — Scoped Rust compatibility plane + Socket.IO + direct control adapter

**Shape**

- New fork-exclusive `codex-happy-server` crate.
- Axum HTTP, Socketioxide Socket.IO v4, SQLx/SQLite.
- Existing `codex-happy` remains a session-scoped loopback client.
- Existing Happy web app remains a user-scoped client.
- Browser RPC routes directly to an in-process `CodexControlAdapter`.
- Explicit local plaintext codec and paired-device auth.

**Why it wins**

- Satisfies the no-happy-cli/no-Node-runtime constraint.
- Exercises the real Happy protocol and real web UI.
- Avoids a second app transport stack.
- Avoids the broken Rust inbound RPC-ack path.
- Keeps nearly all server work in fork-only overlay code.
- Gives later LAN/public transports a reusable Rust session-plane endpoint.

**Risks**

- Socketioxide interoperability is a true go/no-go gate.
- The compatibility surface must be tracked against app/wire evolution.
- Plaintext local session storage is not remote-ready.
- A small app-server-client patch is needed for authoritative approval races.

**Cheapest disconfirming test**

Run an actual Chromium page from the existing Expo web build against a minimal
Socketioxide server and prove pairing headers, polling, `rpc-call` ack,
`session-message-range` ack, reconnect cursor, and CORS. If this fails in a way
that requires rewriting Engine.IO, stop before building storage.

### D-002 — Add a plain-WebSocket transport to happy-app/happy-wire

**Shape**

- Build a simpler Axum WebSocket server.
- Add a parallel transport adapter to the app.
- Reimplement rooms, acks, RPC, range requests, reconnect, replay, and
  authentication over a new wire.
- Rewrite or parallelize the Rust session client.

**Why it might work**

- Cleaner protocol under direct control.
- Browser auth could be a signed first frame rather than custom headers.
- Lower server-library dependency risk.

**Why it loses for Phase 1**

- It duplicates semantics already implemented by Socket.IO.
- It touches the app’s hot sync/transport surface instead of only auth
  compatibility.
- It requires coordinated changes across app, happy-wire, and both Rust
  client/server code before the first real UI proof.
- It creates two Happy transports to maintain.

**Complexity comparison**

| Area | D-001 Socket.IO compatibility | D-002 plain WebSocket |
|---|---|---|
| Rust server | New compatibility crate; Socketioxide owns Engine.IO/acks | New server plus custom ack/room/replay protocol |
| `happy-app` | Auth discriminator, invite, polling config, stream snapshot | Replace/parallelize `apiSocket`, reconnect, RPC, ranges, events |
| `codex-happy` | Endpoint/capability/codec and message-ID propagation | Rewrite `session.rs` transport |
| Future remote reuse | Same app protocol and paired auth | New protocol needs its own remote hardening |
| Overall | **M/L, gated by P0** | **XL for this proof** |

Use D-002 only if P0 proves Socketioxide fundamentally incompatible and a small
compatibility patch is impossible.

### D-003 — Direct in-process transcript store with a thin browser gateway

**Shape**

- Skip the session-scoped loopback `codex-happy` client.
- Send TUI events directly into a Rust store.
- Expose only browser-facing HTTP/WebSocket.

**Benefit**

- Fewer moving parts and no Rust Socket.IO client.

**Why it is rejected**

- It violates the requested proof that the existing `codex-happy` live-TUI
  bridge connects to a native Happy session plane over loopback.
- It hides client/server compatibility bugs.
- It weakens future transport reuse.
- It would prove a diagnostics gateway, not the actual Happy session path.

### D-004 — Port/reuse the full happy-server or bundle Node

**Shape**

- Port all server concepts, or keep happy-cli/Node as a sidecar.

**Why it is rejected**

- Bundled Node violates the hard runtime constraint.
- A full port carries account/social/push/Redis/multi-replica features that the
  proof does not use.
- The hardest required pieces survive either way, while unrelated surface
  increases security and maintenance risk.

---

## 4. Recommended architecture

```text
┌──────────────────────────────── Codex process ───────────────────────────────┐
│                                                                              │
│  Live TUI                                                                    │
│    │ every AppServerEvent                                                    │
│    ▼                                                                         │
│  codex-happy                                                                 │
│    ├─ outbound mapper + local user-message dedup                             │
│    ├─ SessionPayloadCodec::LegacyPlainJson                                   │
│    ├─ session-scoped HTTP + Socket.IO client                                 │
│    └─ serialized CodexControlAdapter ───────────┐                            │
│                 │                               │ AppServerRequestHandle      │
│                 │ 127.0.0.1 + in-memory cap     ▼                            │
│                 ▼                           live primary Codex thread         │
│  codex-happy-server                                                          │
│    ├─ Axum routes                                                            │
│    ├─ Socketioxide /v1/updates                                                │
│    ├─ SQLx/SQLite                                                             │
│    ├─ paired-device verifier                                                  │
│    └─ RPC registry ────────────────────────────┘                             │
│                                                                              │
└───────────────────────────────────▲──────────────────────────────────────────┘
                                    │ 127.0.0.1 HTTP / Socket.IO polling
                                    │ Ed25519 paired-device proof
┌───────────────────────────────────┴──────────────────────────────────────────┐
│ Existing packages/happy-app web build at http://localhost:<web-port>         │
│ - existing server configuration / pairing screen                             │
│ - existing sessions list and chat UI                                          │
│ - small additive auth + transient-stream compatibility only                  │
└──────────────────────────────────────────────────────────────────────────────┘
```

### 4.1 Crate boundary

Create a sibling overlay crate:

```text
codex/codex-rs-overlay/codex-happy-server/
```

Responsibilities:

- Happy-compatible HTTP and Socket.IO server.
- SQLite migrations and transactions.
- route policy, paired-device verification, CORS/origin policy;
- update routing/replay;
- generic `ControlBackend` trait and typed RPC results.

It must **not** depend on Codex TUI or app-server types.

Extend:

```text
codex/codex-rs-overlay/codex-happy/
```

Responsibilities:

- implement `ControlBackend` using `AppServerRequestHandle`;
- serialize event observation and inbound control;
- own the embedded-server lifecycle from the existing attach task;
- retain Happy session-client/mapping semantics;
- add local codec, message-ID propagation/dedup, and stream snapshots.

The TUI continues depending only on `codex-happy`. The new server crate stays
behind the existing bounded overlay seam.

### 4.2 Why a separate crate is worth two workspace lines

Putting the server inside `codex-happy` would avoid one workspace member but
would mix:

- browser/server auth;
- database migrations;
- HTTP/Socket.IO server dependencies; and
- Codex-specific control/mapping.

The separate crate keeps the protocol compatibility plane testable without a
model or TUI and reusable by later Codex surfaces. The upstream-canonical
conflict remains bounded to marked workspace member/dependency entries.

### 4.3 Internal control boundary

`codex-happy` exposes one serialized command sender such as:

```text
CodexControlAdapter
  submit_user_message(local_id, text) -> Started | Steered
  resolve_permission(request_id, decision) -> Applied | AlreadyResolved | Stale
  interrupt(reason) -> Interrupted | Idle
```

The embedded server depends only on a narrower generic RPC backend
(`resolve_permission`, `interrupt`, and any later explicitly registered
methods). The session-scoped Rust client sends `submit_user_message` to the
same actor after it decodes a browser message. The actor owns:

- `ControlState`;
- pending browser messages;
- pending approval metadata;
- browser local-ID/control correlation;
- reserved source-prefix rules;
- `AppServerRequestHandle`.

Both browser RPC and loopback-delivered user messages enter that actor. This
prevents concurrent state mutation and makes race behavior testable.
The actor must not hold its state while awaiting HTTP/socket I/O: durable
messages/control outcomes go to a bounded lossless writer queue, while
replaceable stream snapshots go to the coalescer. Backpressure may collapse an
ephemeral revision, never a durable message, approval, or user command.

### 4.4 Approval race outcome

The actual app-server callback map is first-answer-wins because it atomically
removes the callback:

- `codex/.../app-server/src/outgoing_message.rs:373-390`
- `outgoing_message.rs:445-451`

Today a second answer only produces a warning, while
`resolve_server_request()` can still report transport success. Thread a typed
outcome back from the authoritative app-server callback map through the
in-process response command:

```text
try_resolve_server_request(...) ->
    Applied | AlreadyResolved | Stale
```

`OutgoingMessageSender::notify_client_response()` already performs the atomic
`take_request_callback()`. Make it return the disposition, carry a one-shot
completion through `InProcessClientMessage::ServerRequestResponse`, and expose
that result from the cloneable request handle. This preserves one source of
truth instead of adding a second pending-request registry. The local TUI and
browser path already pass through this same in-process runtime.

To distinguish the losing cases, keep a small bounded/TTL outcome tombstone
beside the authoritative callback map: a completed callback records
`Resolved`, while explicit cancellation records `Cancelled`. A later response
to `Resolved` returns `AlreadyResolved`; `Cancelled` or an unknown/expired ID
returns `Stale`. This is not a second pending-request owner.

After the in-process runtime receives a disposition, the app-server-client
worker should publish a local `ServerRequestDisposition` event containing the
request ID and outcome. The TUI already drives every client event through its
normal handler and Happy tap; `codex-happy` can therefore remove the mirrored
pending request when the **TUI** answered first, not only when the browser
answered. This is required for both surfaces to converge on the same approval
state without polling.

The Socket.IO ack must return that status. The existing app may ignore the
result body initially, but tests/logs must prove that a stale second answer is
not reported as newly applied.

---

## 5. Exact minimum server contract

### 5.1 HTTP routes

| Method/path | Required behavior | Persistence/auth |
|---|---|---|
| `POST /pair/complete` | Enroll browser Ed25519 key during one-time window; return stable local machine/profile identity | Pair secret + nonce + exact Origin; no prior device proof |
| `GET /v1/sessions` | Return the one local server’s sessions in the current app shape | Device proof |
| `POST /v1/sessions` | Idempotent create/load by stable Codex-thread tag | Internal capability only for Phase 1 |
| `GET /v3/sessions/:id/messages` | `after_seq`/`before_seq`, ordered pages, `hasMore` | Device proof or internal capability |
| `POST /v3/sessions/:id/messages` | Batch insert, `(sessionId,localId)` dedup, monotonic sequence, broadcast `new-message` | Device proof or internal capability |
| `GET /v2/me/machine` | Stable local machine record and current endpoint | Device proof |
| `GET /v2/me/settings` | Return persisted settings object | Device proof |
| `PUT /v2/me/settings` | Replace persisted settings, 1 MiB limit | Device proof + body hash |
| `GET /v2/me/profile` | Deterministic single-user local profile | Device proof |

Optional but useful:

- capability-protected `GET /health` for tests/readiness;
- no-op/version routes only if a real web boot proves they are required.

Not required for local web development:

- GitHub/account auth;
- friends/feed/artifacts/voice;
- push registration/delivery;
- Redis;
- multi-replica routing;
- Dev Tunnels, Cloudflare, LAN, or central-server routes.

The app’s actual boot calls are visible at:

- sessions: `happy-app/sync.ts:1173-1224`;
- machine: `sync.ts:1240-1332`;
- settings: `sync.ts:1339-1399`;
- profile: `sync.ts:1402-1430`.

Native-update fetch is skipped on web
(`sync.ts:1432-1490`), and purchases are independent of the session server.

### 5.2 Socket.IO `/v1/updates`

**Connection roles**

- `session-scoped`: the in-process `codex-happy` client, authenticated with an
  in-memory random capability.
- `user-scoped`: the browser, authenticated with paired-device proof.

Machine-scoped support is unnecessary for P1 unless the real web boot proves a
hard dependency.

**Server -> browser/session client**

- `update`
- `replay-overflow`
- `ephemeral`
- Socket.IO acknowledgement responses

**Client -> server**

- `update-metadata` with CAS ack
- `update-state` with CAS ack
- `session-alive`
- `session-output-snapshot` from the authenticated session-scoped client
- `session-message-range` with ack
- `rpc-call` with ack

No generic `rpc-register`/`rpc-request` bridge is required for the local proof;
the in-process `ControlBackend` registry replaces it.

`session-output-snapshot` is validated against the socket's own session ID,
stored only as the latest bounded in-memory value per item, and re-emitted to
user-scoped clients inside the existing `ephemeral` channel. It is never
inserted into `session_messages` or assigned a durable update sequence.

`rpc-call` keeps the app's existing wrapper:

```json
{ "ok": true, "result": { "status": "applied" } }
{ "ok": true, "result": { "status": "already_resolved" } }
{ "ok": false, "error": "method_not_supported" }
```

`session-message-range` must return the exact happy-wire response shape:
`requestId`, `sessionId`, `fromSeq`, `toSeq`, ascending `messages`, and
`hasMore`, with structured `invalid_range`, `session_not_found`, or `internal`
errors (`sessionMessageRangeHandler.ts:20-150`).

### 5.3 SQLite schema

Minimum tables:

```text
server_identity
  machine_id, hostname, created_at

sessions
  id PK, tag UNIQUE, metadata, metadata_version,
  agent_state, agent_state_version, seq,
  active, last_active_at, created_at, updated_at

session_messages
  id PK, session_id FK, local_id,
  seq, content_json, created_at, updated_at
  UNIQUE(session_id, local_id)
  UNIQUE(session_id, seq)

settings
  singleton_id, value_json, updated_at

paired_devices
  key_id PK, public_key, created_at, revoked_at

auth_nonces
  key_id, nonce, expires_at
  UNIQUE(key_id, nonce)

server_meta
  key PK, integer_value/text_value
  (includes persisted update_seq)
```

Use SQLx with SQLite WAL and transactions. The Codex workspace already carries
SQLx/SQLite (`codex-rs/Cargo.toml:362-364,423-433`), so this does not require a
new database stack.

### 5.4 Transactional invariants

For message insertion:

1. Begin transaction.
2. Resolve existing rows for submitted `localId`s.
3. Allocate a contiguous sequence range by atomically incrementing
   `sessions.seq`.
4. Insert only new rows.
5. Allocate/persist the corresponding global update sequence values in the
   same transaction.
6. Commit.
7. Populate the in-memory replay ring and broadcast only committed rows with
   their persisted update sequence.

For metadata/state:

- compare `expectedVersion`;
- update with `WHERE version = expectedVersion`;
- allocate/persist the update sequence in that same transaction;
- return `version-mismatch` plus authoritative value on conflict;
- broadcast only after commit.

For replay:

- update sequence is durable;
- ring buffer is bounded to 1,024;
- restart gap produces `replay-overflow`, never silent omission.

---

## 6. Browser, origin, and authentication design

### 6.1 Bind and origin policy

- Bind only `127.0.0.1`, not `0.0.0.0`, `::`, or hostname wildcard.
- Validate `Host` against the selected loopback endpoint.
- Configure one exact Expo origin, for example
  `http://localhost:8081`; no `*`.
- Require that exact Origin for paired browser traffic. Internal-capability
  requests originate in Rust and need not fabricate a browser Origin.
- Allow unauthenticated `OPTIONS` only to complete CORS preflight.
- Every actual route goes through a default-deny route policy.
- Pairing is the sole pre-enrollment exception and has its own one-time gate.

The existing Node public-mode design is good reference material:

- freshness, pinned keys, nonce replay rejection:
  `remoteDeviceAuth.ts:225-325`;
- default-deny route policy and body-hash enforcement:
  `remoteDeviceAuth.ts:445-525`;
- socket handshake proof:
  `remoteDeviceAuth.ts:526-559`;
- pairing enrollment:
  `pairRoutes.ts:75-190`.

The Rust implementation should port the security properties, not the
Cloudflare coupling.

### 6.2 Browser device enrollment

Add a distinct transport-neutral local invite rather than changing the
Cloudflare-backed public-invite contract:

```json
{
  "kind": "happy-local-pairing",
  "version": 1,
  "authMode": "paired-device",
  "serverUrl": "http://127.0.0.1:43127",
  "machineId": "...",
  "pairSecret": "...",
  "issuedAt": "...",
  "expiresAt": "..."
}
```

The existing public-invite parser remains unchanged and strict. The existing
server screen dispatches by `kind`; no toy client or new navigation flow is
introduced.

Pairing procedure:

1. TUI opens a short pairing window and prints a base64url token.
2. Existing Happy server screen accepts the token.
3. Browser generates its Ed25519 keypair.
4. Browser sends key ID/public key, pairing secret, and fresh nonce.
5. Server checks exact Origin, time window, secret, nonce, and rate limit.
6. Server pins the key in SQLite and consumes the pairing window.
7. Browser persists `authMode:'paired-device'`, endpoint, key ID, public key,
   and device signing seed; it discards the one-time pairing secret.

The secret must never be logged or written to the runtime discovery file.

### 6.3 Subsequent HTTP proof

Each local-mode request signs:

- method;
- canonical request target (path plus sorted query parameters);
- body hash;
- key ID/public key;
- issued-at time;
- fresh nonce.

Persist recent nonces until their freshness expiry. An in-memory-only cache
would allow a captured request to be replayed across a quick server restart.
The existing public-mode proof binds only `pathname`; keep that mode unchanged,
but use a versioned local proof and reject query tampering in negative tests.

### 6.4 Socket authentication

Browser JavaScript cannot add arbitrary headers to a WebSocket upgrade. The
current app already recognizes this and uses polling for web public mode
(`happy-app/sync/socketOptions.ts:18-68`).

For the local paired-device proof:

- browser uses Socket.IO polling only in P0/P1;
- proof binds to `GET /v1/updates`;
- `reconnection:false`;
- every explicit reconnect builds a new proof/nonce;
- the server verifies once at the logical Socket.IO handshake, not on every
  Engine.IO poll carrying the same headers.

Later, a signed Socket.IO auth payload with a server challenge can allow direct
browser WebSocket without putting credentials in URLs.

### 6.5 Internal Codex client authentication

Generate a random 256-bit capability when the embedded server starts. Pass it
directly in memory to the `codex-happy` client and require it on every internal
HTTP request and Socket.IO handshake. Reuse the existing
`X-Loopback-Capability` header name for HTTP rather than adding another
loopback-auth convention.

Do not write this capability to disk. Loopback address is not identity.

### 6.6 Browser platform constraints

- Serve the Phase-1 web build from a local trustworthy origin such as
  `http://localhost:<port>`.
- `localhost` and loopback origins are treated as potentially trustworthy for
  secure-context purposes:
  <https://developer.mozilla.org/en-US/docs/Web/Security/Secure_Contexts>.
- Do not use the deployed/public web origin for P1. Chrome’s Local Network
  Access permission applies to public/local origins reaching loopback:
  <https://developer.chrome.com/blog/local-network-access/>.
- Avoid relying on mixed-content exceptions; local HTTP -> local HTTP removes
  that variable from the proof.
- Browser credentials remain in `localStorage` under the current web threat
  model (`tokenStorage.ts:1-8`). An XSS in the app origin can steal the device
  seed. This is an accepted single-user local-web limitation, not a claim of
  hardware-backed secret storage.

---

## 7. Rust ownership and lifecycle

### 7.1 Startup trigger

Use the existing `RemoteSession` gate as the umbrella and add an explicit
backend selection:

```text
happy.session_backend = "legacy-daemon" | "native-local"
```

`native-local` must also be experimental/default-off. The branch is exhaustive:

- native-local starts the embedded Rust server;
- legacy-daemon retains current behavior;
- native-local failure never falls through to legacy.

For P1, support explicit `/remote on` first so the TUI can present the pairing
invite and diagnosed errors. Wire `RemoteAutoAttach` to the native backend in
P2 after the status/invite discovery path exists.

### 7.2 Server timing

The attach task already drains TUI events during establishment. Start the
server after the primary root `ThreadStarted` is known, then:

- open the per-thread database;
- choose/bind the loopback port;
- register the control adapter;
- create/load the Happy session by thread tag;
- connect the session-scoped client;
- flush buffered transcript/control state.

This avoids inventing an unstable session ID before the authoritative Codex
thread ID exists.

### 7.3 Port and discovery

Recommended default:

- bind `127.0.0.1:0` (ephemeral, collision-free);
- allow an explicit fixed `happy_local_port` for deterministic tests/dogfood;
- write a non-secret atomic diagnostics record under
  `$CODEX_HOME/happy-local/active/<pid>.json`;
- include PID, endpoint, thread ID, session ID, DB path, and start time;
- remove it on graceful shutdown and treat stale PID records as diagnostics
  only, never authority.

Default ephemeral ports mean a process restart can require re-importing a
pairing invite. That is acceptable for Phase 1. Stable product discovery is a
later decision and must not introduce a daemon merely to remember a port.

### 7.4 Persistence location

Use:

```text
$CODEX_HOME/happy-local/threads/<thread-id>/
  session.sqlite
  server.log.jsonl
```

The per-thread DB keeps the one-server/one-live-thread proof simple and avoids
pretending that independently embedded TUI processes share one real-time
router. On resume of the same Codex thread, the stable tag and DB reopen the
same Happy session/history.

### 7.5 Shutdown/restart

- `/remote off`: immediately close browser/session sockets, cancel outstanding
  browser RPC waiters, remove remote approval mirrors, checkpoint SQLite,
  remove the active record, and stop the listener.
- Do **not** automatically deny/resolve the underlying app-server approval on
  remote detach while the local TUI remains alive. Current
  `attach.rs:466-469` blanket-cancels pending approvals; native dual-control
  must let the TUI finish them. Browser `abort` remains an explicit cancel.
- TUI exit: same shutdown under a bounded deadline.
- Crash: OS closes the listener; SQLite WAL recovers.
- Restart/resume: reopen the per-thread DB, restore persisted update cursor,
  and idempotently load the same session tag.

The TUI can continue storing only the existing tap sender. The attach task owns
the server handle; dropping the sender is its shutdown signal.

---

## 8. Dual-control semantics

### 8.1 One thread, one Happy session

- Root `ThreadStarted` fixes the primary thread.
- Happy session tag derives from that thread ID.
- All browser turns target that thread.
- Child/subagent behavior remains under the existing separate feature gate.
- `/remote off/on`, browser reconnect, and session-client reconnect do not
  create another row.

### 8.2 Browser message while idle

1. App posts the user message with `localId`.
2. Server commits it and broadcasts `new-message`.
3. Session-scoped Rust client receives it and preserves `localId`.
4. Control actor sends `TurnStart` with
   `client_user_message_id=happy:<localId>`.
5. Echoed user item is suppressed by the durable `happy:` source prefix.
6. After Codex accepts the start, the Rust client posts
   `message-consumption` for the outer Happy message ID.

### 8.3 Browser message during an active turn

Same path, but the actor sends `TurnSteer` with the observed active turn ID.

The current code already retries steer as a new turn when completion wins the
race (`codex-happy/src/attach.rs:607-646`). Add the symmetric race:

- if an idle `TurnStart` loses to a simultaneous TUI-started turn, wait for the
  authoritative `TurnStarted` and retry that input as `TurnSteer`;
- only emit `message-consumption` after one path is accepted;
- never drop or duplicate the message.

### 8.4 Terminal-origin message

When the TUI emits a primary `ThreadItem::UserMessage` whose `client_id` is not
prefixed `happy:`:

- encode it as a Happy user message;
- use deterministic local ID `codex-origin:user:<item-id>`;
- post it through the session client;
- let the browser receive it like any other durable message; and
- ignore the session-scoped broadcast echo because `codex-origin:` is a
  reserved internal namespace.

Phase 1 requires text prompts. Local image/file input parity is a later scope.

### 8.5 Streaming and tools

- TUI continues receiving original lossless app-server deltas.
- Browser receives coalesced full-text ephemeral snapshots.
- Tool-call start/end remain durable and visible on both.
- Final assistant text is durable and authoritative.
- Reconnect restores latest in-flight snapshot, then final durable output.

### 8.6 Approval/deny

- Approval request is visible in both TUI and browser.
- Both answer through the same in-process response command and authoritative
  app-server callback map.
- First valid answer gets `Applied`.
- Later answer gets `AlreadyResolved` or `Stale`.
- Browser ack is deterministic.
- A local `ServerRequestDisposition` event removes the resolved request from
  Happy agent state even when the TUI answered first.

### 8.7 Interrupt

- Browser `abort` first cancels pending approvals, then sends
  `TurnInterrupt`, matching current behavior
  (`codex-happy/src/attach.rs:685-718`).
- TUI interrupt produces the ordinary turn-completed/interrupted events, which
  flow to the browser.
- Browser abort while idle returns `Idle`, not a fabricated success.

### 8.8 Unsupported RPC methods

Phase 1 registers only methods proven necessary for this acceptance path.
Unsupported methods return a typed `method_not_supported`; they must not hang
for the Node server’s 30-second RPC timeout.

---

## 9. Reuse, replace, and bypass

| Existing merged surface | Native-local treatment |
|---|---|
| `features/src/lib.rs` `RemoteSession` | Reuse as the default-off umbrella. |
| `features/src/lib.rs` `RemoteAutoAttach` | Temporarily bypass in P1; reuse against native-local in P2. |
| `tui/src/app.rs` `happy_tap` + request handle | Reuse unchanged if endpoint/invite status can stay in logs. |
| `tui/src/app/event_dispatch.rs` `/remote on|off` | Reuse trigger/drop semantics; select native backend before attach. |
| `codex-happy/src/attach.rs` event/control loop | Reuse mapping/control behavior but refactor into the serialized adapter and native server lifecycle; change detach-time approval cleanup so the live TUI retains authority. |
| `codex-happy/src/session.rs` HTTP/Socket.IO client | Reuse with endpoint, internal capability, payload codec, outer message identity, and reserved-origin support. |
| `codex-happy/src/api.rs` session creation | Add a native codec/auth path; do not require legacy Happy credentials or generated content keys. |
| `codex-happy/src/daemon_supervisor.rs` | Replace entirely for native-local; retain only for explicit legacy-daemon backend. |
| `codex-happy/src/auth.rs` `~/.happy` discovery | Bypass entirely for native-local. |
| `codex-happy/src/onboard.rs` self-onboarding | Bypass entirely for native-local; local pairing is browser-to-embedded-server. |
| `HAPPY_CURRENT_SESSION_ID` collision guard | Reuse only to reject accidental double wrapping; never as native discovery. |

### Reuse

- `tui/src/app.rs` Happy tap and request-handle seam.
- `tui/src/app/event_dispatch.rs` drop-to-detach lifecycle.
- `codex-happy::ControlState`.
- idle `TurnStart`, active `TurnSteer`, steer->start race fallback.
- approval payload mapping and interrupt/cancel behavior.
- session envelope/wire structs.
- HTTP v3 paging, localId, CAS, replay concepts.
- existing Happy web sessions/chat/pairing screens.
- existing Ed25519 signed-request format and test vectors.
- default-off `RemoteSession` and later `RemoteAutoAttach` gates.

### Replace for native-local backend

- `NodeDaemonSupervisor`.
- `happy daemon start-sync`.
- `~/.happy/machine.json` and `~/.happy/access.key` discovery.
- random per-attach session tag.
- ciphertext-only message/agent-state codec.
- generic socket-room RPC routing for local Codex control.
- ambiguous fire-and-forget approval result.
- blanket approval cancellation on remote detach while the TUI is still alive.

### Temporarily bypass

- GitHub/self-onboarding.
- Dev Tunnels.
- Cloudflare.
- LAN/public listeners.
- central server.
- physical tablet.
- push delivery.
- `RemoteAutoAttach` until P2.
- unsupported file/bash/directory RPCs.

### Preserve only as collision protection

- `HAPPY_CURRENT_SESSION_ID` guard when an old happy-cli-owned session is
  already active.

---

## 10. Phased milestones

### P0 — Transport/browser/auth spike

**Goal:** buy down the only external protocol risk before building persistence.

Build a minimal test-only Rust server using the intended versions of Axum and
Socketioxide. Drive it with:

- the actual `socket.io-client` dependency used by `packages/happy-app`;
- an actual Chromium/Edge page served from the existing Expo web build origin;
- the existing Rust `rust_socketio` client.

Must prove:

1. exact path `/v1/updates` and Engine.IO version compatibility;
2. browser polling with custom paired-device headers;
3. Rust-client websocket connection with internal capability;
4. exact-origin CORS and preflight;
5. `rpc-call` ack;
6. `session-message-range` ack;
7. `update-metadata`/`update-state` ack shapes;
8. update delivery, reconnect cursor, and `replay-overflow`;
9. signed-query tampering and nonce replay fail closed;
10. no reliance on browser WebSocket custom headers.

**Exit:** all pass against the real browser stack.
**Stop condition:** a protocol mismatch that requires implementing/forking a
substantial Engine.IO/Socket.IO server. Reassess D-002 rather than continuing.

### P1 — Native Rust compatibility plane + real web compatibility

Implement:

- `codex-happy-server` crate;
- SQLite schema/migrations and transactional invariants;
- local paired-device auth and the distinct local invite;
- internal capability auth;
- HTTP routes and Socket.IO events above;
- native-local backend selection and lifecycle;
- `LegacyPlainJson` message/agent-state codec;
- stable thread-based session identity;
- browser-message ID propagation and local-prompt mirroring;
- direct `CodexControlAdapter`;
- authoritative approval outcome propagation;
- ephemeral output snapshots;
- small additive app/wire auth and stream-state changes.

**Exit:** the existing web UI pairs, lists exactly one session, opens it,
observes a real TUI-origin prompt/output, sends an idle browser turn, and
survives a browser reconnect.

### P2 — Same-machine dual-control dogfood

Run a real model session and prove:

- alternating terminal/browser turns;
- active-turn steer from the other surface;
- simultaneous idle-start race with no lost input;
- assistant streaming snapshots and tool start/end on both;
- approve and deny from each surface;
- first-answer-wins when both answer;
- interrupt from each surface;
- browser disconnect/reconnect;
- `/remote off/on`;
- `/remote off` during a pending approval leaves that approval answerable in
  the live TUI;
- idle, fully-consumed fixed-port process restart/resume with the same
  thread/session/history;
- exactly one Happy session row/tag throughout;
- no happy-cli or Node happy-server runtime.

**Exit:** deterministic evidence bundle passes every criterion in §11.

### P3 — Release and later transports

Only after P2:

- production packaging and feature documentation;
- auto-attach;
- optional Rust-served static web assets;
- LAN/public/tablet transports;
- browser WebSocket challenge auth;
- remote-grade encryption;
- multi-device/revocation;
- multi-Codex-process aggregation if desired.

Binding the P1 listener to LAN or placing it behind a tunnel is explicitly
forbidden as a shortcut. Local plaintext and local browser assumptions are not
remote-ready.

---

## 11. Real acceptance design

### 11.1 Launch

1. Start the existing Happy Expo web build at a fixed local origin.
   Node is allowed here only as browser build/dev tooling.
2. Launch the fork Codex TUI with:
   - `RemoteSession` enabled;
   - native-local backend selected;
   - fixed test port for deterministic restart evidence.
3. Run `/remote on`.
4. Paste the emitted invite into the existing Happy server configuration
   screen.

### 11.2 Required visible proof

- Happy web sessions list contains exactly one Codex session.
- Browser and terminal display the same session/thread identity.
- Every browser control request targets the TUI's one root thread ID; no
  second Codex thread/process is created for Happy.
- A terminal prompt appears once in web.
- A browser prompt appears once in terminal/web and starts a turn while idle.
- During a long active turn, a follow-up from the opposite surface steers the
  same turn.
- Coalesced assistant text and tool boundaries appear live in web while the TUI
  remains interactive.
- Approval request appears on both; either can approve/deny.
- A second approval response is reported as already resolved/stale.
- Either surface can interrupt.
- Browser reconnect causes no duplicate/lost durable messages.
- `/remote off/on` retains one session row.
- Restart/resume on the fixed port restores the same session/history.

### 11.3 Deterministic evidence

Write structured JSONL logs containing no secrets:

- Codex PID;
- backend = `native-local`;
- bound address/port;
- thread ID;
- Happy session ID/tag;
- SQLite path;
- message sequence;
- update sequence;
- connect/disconnect/replay/overflow decisions;
- control action and outcome;
- approval outcome;
- shutdown reason.

Logs record identifiers, sizes, and outcomes only—never message text, request
bodies, proof envelopes, pairing secrets, device signing seeds, or the internal
capability.

Produce an acceptance evidence JSON containing:

- process inventory;
- listening-port owner;
- session/tag count;
- message localId/seq uniqueness check;
- update cursor/replay result;
- scripted/manual step results.

On Windows, verify the selected listener port belongs to the Codex PID and
capture command lines for all `node`, `happy`, and Codex-related processes.
Classify unrelated Node processes separately rather than assuming a quiet
machine.

Allowed:

- Node/Expo process serving the web build.
- unrelated Node tooling and model-invoked Node tool processes, provided their
  command lines are classified and they neither own nor host the session-plane
  port/routes.

Forbidden:

- `happy-cli`;
- `happy daemon`;
- Node process running `packages/happy-server`;
- standalone `codex app-server` process for this path;
- Dev Tunnels/Cloudflare/LAN listeners.

### 11.4 Failure criteria

The proof fails if any of the following occurs:

- native-local failure silently falls back to happy-cli/Node;
- any non-OPTIONS route is usable without pairing proof/internal capability;
- CORS uses wildcard origin;
- browser auth depends on unsupported WebSocket headers;
- more than one session is created for one Codex thread;
- browser control creates or targets a second Codex thread/process;
- a browser/TUI message is lost or duplicated;
- approval ack claims a second answer was applied;
- reconnect silently skips a sequence gap;
- browser only receives final text despite P2 claiming streaming;
- any Node process owns the session-plane port or hosts the Happy session
  routes.

---

## 12. Conflict surface and likely implementation files

### Codex overlay repo — new/fork-only

- `codex/codex-rs-overlay/codex-happy-server/Cargo.toml`
- `codex/codex-rs-overlay/codex-happy-server/src/**`
- `codex/codex-rs-overlay/codex-happy/src/attach.rs`
- `codex/codex-rs-overlay/codex-happy/src/inbound.rs`
- `codex/codex-rs-overlay/codex-happy/src/mapping.rs`
- `codex/codex-rs-overlay/codex-happy/src/session.rs`
- `codex/codex-rs-overlay/codex-happy/src/session_state.rs`
- `codex/codex-rs-overlay/codex-happy/src/wire.rs`
- tests/fixtures under both overlay crates

### Codex upstream-canonical patch surface — keep bounded

- `codex/external/repos/codex-patched/codex-rs/Cargo.toml`
  - workspace member/dependency and Socketioxide dependency stamp.
- `codex/.../app-server-client/src/lib.rs`
  - expose the typed first-answer-wins resolution outcome.
- `codex/.../app-server/src/in_process.rs`
  - carry an outcome acknowledgement back through the in-process response.
- `codex/.../app-server/src/outgoing_message.rs`
  - return the disposition from the authoritative callback removal.
- `codex/.../tui/src/app.rs`
  - forward/ignore the local request-disposition event after the Happy tap
    observes it.
- possibly `codex/.../tui/src/app/event_dispatch.rs`
  - only if the existing sender-owned lifecycle channel cannot carry
    endpoint/invite status.
- `codex/docs/implementation/patch-surface.md`
  - required when implementation lands.

Avoid adding a standalone app-server binary seam or broad core changes.

### Happy app/wire compatibility

- `packages/happy-wire/src/localPairingInvite.ts` (new)
- `packages/happy-wire/src/localDeviceAuth.ts` (new, versioned canonical
  path+query proof)
- `packages/happy-wire/src/sessionOutputSnapshot.ts` (new)
- `packages/happy-wire/src/index.ts`
- shared deterministic Rust/TypeScript fixtures
- `packages/happy-app/sources/auth/tokenStorage.ts`
- `packages/happy-app/sources/auth/machineAuth.ts`
- `packages/happy-app/sources/auth/localEnrollment.ts` (new)
- `packages/happy-app/sources/sync/socketOptions.ts`
- `packages/happy-app/sources/sync/apiSocket.ts`
- `packages/happy-app/sources/sync/apiTypes.ts`
- `packages/happy-app/sources/sync/sync.ts`
- `packages/happy-app/sources/sync/storage.ts`
- `packages/happy-app/sources/-session/SessionView.tsx`
- `packages/happy-app/sources/components/MessageView.tsx`
- `packages/happy-app/sources/components/ChatList.tsx` only if transient rows
  cannot be composed above the list
- `packages/happy-app/sources/app/(app)/server.tsx` only as needed to dispatch
  the local invite through the existing screen
- `packages/happy-app/sources/text/_default.ts` and every locale only if the
  current invite label cannot remain transport-neutral

`sync.ts` is a known manual-three-way hotspot. Keep its changes surgical:
auth/transport selection and transient snapshot handling only; do not refactor
unrelated sync behavior.

### Documentation expected during implementation

- `codex/docs/implementation/patch-surface.md`
- `codex/CLAUDE.md` if build/test or fork constraints change
- `docs/security-model.md` for local paired mode/plaintext limitations
- `docs/fork-notes.md` for launch/dogfood procedure
- `packages/happy-app/CHANGELOG.md` plus regenerated
  `packages/happy-app/sources/changelog/changelog.json` when app changes ship
- package AGENTS guidance only if a new recurring trap is discovered

---

## 13. Security review

### 13.1 Threat model

Protect against:

- arbitrary websites driving localhost;
- another local process guessing the port;
- replayed signed requests;
- body substitution;
- stale pairing invites;
- duplicate/conflicting device key IDs;
- browser reconnect reusing a consumed socket proof;
- route additions accidentally becoming unauthenticated;
- hidden fallback to a less secure legacy server.

Not protected against:

- malware running as the same OS user;
- XSS in the Happy web origin stealing `localStorage`;
- an administrator reading Codex/SQLite state;
- remote attackers, because no remote listener exists.

### 13.2 Required controls

- loopback-only bind;
- exact Host for all traffic and exact Origin for paired browser traffic;
- default-deny HTTP route inventory;
- paired Ed25519 key pinning;
- method/canonical-target/body-hash binding, including query-tamper tests;
- freshness window;
- persistent nonce replay rejection;
- one-time pairing window and secret;
- constant-time secret comparison;
- rate limiting;
- in-memory internal capability;
- no secret logging;
- explicit auth mode;
- fail-closed backend selection;
- negative integration test covering every registered route;
- socket handshake tests for both polling and internal websocket.

### 13.3 Plaintext caveat

The local compatibility codec and SQLite database contain plaintext
conversation JSON and agent state. This is an explicit Phase-1 tradeoff, not
E2EE. Store under the user’s `$CODEX_HOME` with inherited user-only permissions
where available. Do not reuse this codec for LAN/public/tablet release.

### 13.4 Review verdict

**Security verdict: GO for local proof only**, provided all controls above are
acceptance gates. An unauthenticated localhost listener, wildcard CORS,
in-memory-only replay cache, or automatic legacy fallback is a **NO-GO**.

---

## 14. Hidden happy-cli / Node dependency review

The recommended steady-state session path is:

```text
Codex TUI process
  -> codex-happy Rust client
  -> embedded codex-happy-server Rust crate
  -> existing browser app
```

It contains no:

- `Command::new("happy")`;
- `happy daemon start-sync`;
- `packages/happy-cli` runtime import;
- `packages/happy-server` runtime import;
- `~/.happy` credentials/discovery;
- Node child process;
- standalone Codex app-server child.

Within this feature path, Node may exist solely to serve/build
`packages/happy-app` during development. Unrelated Node tooling or a
model-invoked Node command may also run, but the native backend lifecycle must
not launch Node, and no Node process may own/host the session-plane port or
routes. The Rust listener’s PID, backend spawn audit, and process command lines
make that separation observable.

Required implementation guardrails:

- native-local unit test with a process-spawn host that panics on invocation;
- source invariant forbidding `NodeDaemonSupervisor` in the native branch;
- source invariant forbidding `.happy`, `machine.json`, and `access.key` in the
  native startup path;
- dogfood process/port inventory;
- no fallback from `native-local` to `legacy-daemon`.

**Dependency verdict: GO.** The design does not retain a hidden happy-cli or
Node happy-server dependency. The only Node dependency in the P1/P2 feature
path is explicit browser build tooling.

---

## 15. Settled decisions

1. **Preserve Socket.IO in Phase 1.** Do not add a parallel plain-WebSocket app
   transport unless P0 disproves Socketioxide.
2. **Build a scoped compatibility server, not the full happy-server.**
3. **Use a separate fork-overlay server crate.**
4. **Route browser control RPC directly to an in-process adapter.**
5. **Keep browser user messages on the real Happy session path.**
6. **Add an explicit local paired-device mode without Cloudflare; keep the
   existing Cloudflare-backed public mode strict.**
7. **Use an explicit local plaintext codec; retain encrypted legacy codecs.**
8. **Use stable Codex thread ID as the Happy session tag.**
9. **Persist message/update sequence and nonce replay state in SQLite.**
10. **Default to ephemeral loopback port; support fixed port for tests.**
11. **Use per-thread database/state for Phase 1.**
12. **`/remote off` stops the embedded server immediately.**
13. **P2 requires coalesced browser streaming, not final-text-only claims.**
14. **No remote/tablet release until local P2 passes.**

---

## 16. Genuine open decisions and blockers

### OD-001 — Exact transient streaming presentation

**Architecture decision is settled:** full-text snapshots keyed by item ID,
coalesced and ephemeral, final text durable.

**Open UI detail:** whether the existing message renderer can show/replace one
in-progress item without new product decisions. If not, assign only that
rendering choice to an Opus 4.8 UI sub-agent. Do not broaden it into a chat UI
redesign.

### OD-002 — Default pairing window duration

Recommendation: 2 minutes, one successful enrollment, explicit command to
reopen. The exact duration is an operator/security preference, not an
architecture blocker.

### OD-003 — Product behavior after process restart on an ephemeral port

Phase 1 answer: re-import a fresh invite; fixed port is available for dogfood.
Later product choices are:

- remembered preferred port with fallback;
- Rust-served web assets/same-origin;
- a separate stable local rendezvous mechanism.

Do not solve this by adding a daemon in P1.

### OD-004 — Multi-Codex-process aggregation

One embedded server per live TUI is correct for this task. A future desire to
see several simultaneous Codex processes through one browser credential needs
another architecture decision; shared SQLite alone would not provide shared
live Socket.IO routing.

### Blockers

- **B-001 (hard P0 gate):** actual Socketioxide/browser/Rust-client
  interoperability has not yet been executed.
- **B-002 (implementation gate):** first-answer-wins outcome must be made
  authoritative before approval race acceptance.
- **B-003 (implementation gate):** local codec mismatch must be fixed before
  the real app can decode Rust-origin messages.
- **B-004 (implementation gate):** local prompt mirroring/dedup and transient
  streaming are missing today.

None requires happy-cli or Node server runtime.

---

## 17. Planning handoff

A downstream plan should decompose by proof boundary, not by package:

1. **P0 compatibility spike** — no production server/store.
2. **Rust server foundation** — auth, SQLite, route/socket contract.
3. **Codex integration** — lifecycle, codec, identity, control actor.
4. **Happy app/wire compatibility** — paired mode and transient stream.
5. **Dual-control race correctness** — turn and approval arbitration.
6. **Real web dogfood/evidence** — process inventory and restart/reconnect.

Do not create one PRD spanning two independently shipped repos without an
explicit two-job/ship sequence. The Codex submodule commit must land first, then
the codexu pointer/app changes can be committed and verified against it.

---

## 18. Key references

### Prior analysis

- `.ralph/investigations/codex-appserver-vs-happy-wiring/findings.md`
- `.ralph/investigations/happy-agent-driving-modes/findings.md`
- `.ralph/investigations/codex-autoconnect-rust-crate-feasibility/findings.md`
- `.ralph/brainstorms/codex-autoconnect-northstar-design-doc/selected-direction.md`

### Codex

- `codex/codex-rs-overlay/codex-happy/src/attach.rs`
- `codex/codex-rs-overlay/codex-happy/src/inbound.rs`
- `codex/codex-rs-overlay/codex-happy/src/mapping.rs`
- `codex/codex-rs-overlay/codex-happy/src/session.rs`
- `codex/external/repos/codex-patched/codex-rs/tui/src/app.rs`
- `codex/external/repos/codex-patched/codex-rs/tui/src/app/event_dispatch.rs`
- `codex/external/repos/codex-patched/codex-rs/app-server-client/src/lib.rs`
- `codex/external/repos/codex-patched/codex-rs/app-server/src/in_process.rs`
- `codex/external/repos/codex-patched/codex-rs/app-server/src/outgoing_message.rs`
- `codex/external/repos/codex-patched/codex-rs/app-server-protocol/src/protocol/v2/turn.rs`

### Happy app/wire/server compatibility references

- `packages/happy-app/sources/auth/tokenStorage.ts`
- `packages/happy-app/sources/auth/machineAuth.ts`
- `packages/happy-app/sources/auth/publicEnrollment.ts`
- `packages/happy-app/sources/sync/socketOptions.ts`
- `packages/happy-app/sources/sync/apiSocket.ts`
- `packages/happy-app/sources/sync/sync.ts`
- `packages/happy-app/sources/sync/ops.ts`
- `packages/happy-wire/src/publicPairingInvite.ts`
- `packages/happy-server/sources/app/api/socket.ts`
- `packages/happy-server/sources/app/api/socket/rpcHandler.ts`
- `packages/happy-server/sources/app/api/socket/sessionUpdateHandler.ts`
- `packages/happy-server/sources/app/api/socket/sessionMessageRangeHandler.ts`
- `packages/happy-server/sources/app/api/auth/remoteDeviceAuth.ts`
- `packages/happy-server/sources/app/api/routes/pairRoutes.ts`
- `packages/happy-server/sources/app/api/routes/sessionRoutes.ts`
- `packages/happy-server/sources/app/api/routes/v3SessionRoutes.ts`
- `packages/happy-server/sources/app/events/eventRouter.ts`
- `packages/happy-server/prisma/schema.prisma`

### Browser platform

- MDN Secure Contexts:
  <https://developer.mozilla.org/en-US/docs/Web/Security/Secure_Contexts>
- MDN WebSocket API:
  <https://developer.mozilla.org/en-US/docs/Web/API/WebSocket>
- Chrome Local Network Access:
  <https://developer.chrome.com/blog/local-network-access/>
