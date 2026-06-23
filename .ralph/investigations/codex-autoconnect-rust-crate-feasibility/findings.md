# Feasibility: a native-Rust "happy-server crate" scoped to a codex session, vs bundling Node happy-cli/happy-server

**Spike:** `codex-autoconnect-rust-crate-feasibility` · **Date:** 2026-06-23 · **Type:** read-only investigation (no code changed)
**Operator question (2026-06-23):** The brainstorms (`906ed67b`, `codex-autoconnect-self-contained-zero-friction` @ `36ac8e09`) rejected a *full* Rust reimplementation of the happy-server session plane as too costly + divergence-prone, and recommended **bundling** the Node happy-cli/happy-server as a sidecar. The rejection *assumed codex needs the full happy-server surface — that was never measured.* Could we instead ship a Rust "happy-cli/happy-server crate" scoped to only what a codex session + the app need, so no Node is required at all? **Measure it.**

## Read-only guard / baseline

- codexu on `main`; pre-existing untracked/modified generated sidecars only (`.ralph-overview/generated/*`, a few `.ralph/*`) — none mine.
- codex submodule on `main` @ `d7ed49c8f89169b31ce20645ef90fed61f4098c6`; no tracked modifications (only untracked dirs).
- No code was modified. Only this findings doc is added, on branch `ralph/codex-autoconnect-rust-crate-feasibility`.

## TL;DR

**Headline: QUALIFIED NO for v1 — bundle the Node happy-server as the embedded sidecar now; keep a scoped Rust crate as a documented future option, not a v1 deliverable.**

- The operator's premise is **half right**: the brainstorm *did* overstate the surface. The minimal subset a codex session + app need is meaningfully **smaller than the full happy-server** (you can drop ~40% of routes + ~15 of 22 DB models: social/feed/kv/voice/artifacts/github/usage/dev), and the embedded *single-process* deployment drops **all** of the Node server's hardest code (Redis streams adapter, cross-replica `fetchSockets`, multi-replica RPC/presence). The crypto + wire + Socket.IO **client** are *already* a proven Rust port (`codex-happy`). So a scoped crate is **more feasible than "full reimplementation" framing implied** — effort **L, not XL**.
- **But scoping does not flip the decision**, because the two real costs survive scoping:
  1. **You must reimplement the Socket.IO *server* half against an unmodifiable counterparty (the React-Native app).** Every event/ack/pairing/presence shape must match `socket.io-client` v4 + the app's exact expectations, or you get app-breaking bugs you cannot fix on the app side without forking the app too.
  2. **The divergence tax is structural, not size-driven.** Even a small subset is coupled to an *independently-evolving* app↔server protocol. The Node bundle gets protocol-lockstep **for free** (it literally *is* upstream's server, moving in step with the app via the shared `@slopus/happy-wire`); a Rust crate must *chase* every change.
- Minimal-surface size: **~8 HTTP route groups + 1 Socket.IO namespace (3 client scopes, ~6 handler families) + ~7 DB tables**, of which the *hard* parts (Socket.IO server, RPC bridge, JWT+pairing crypto, seq+CAS store) are all in the must-keep set and the *easy* parts (CRUD social/feed/kv/voice) are what you get to drop.

---

## 1 · Surface inventory — minimal union vs full happy-server

### 1a. What the codex SESSION client actually calls (already ported in `codex-happy`)

This is the strongest single data point: the codex-session side **already exists as native Rust** and needs **no Node**. Its entire server-facing surface:

**HTTP (tunnel listener `http://127.0.0.1:<tunnelPort>`, no auth header — loopback + Dev-Tunnels gateway is the gate):**
| Method + path | Purpose | Cite |
|---|---|---|
| `POST /v1/sessions` | create/load session (idempotent by `tag`) | `codex/codex-rs-overlay/codex-happy/src/api.rs:33,181` |
| `POST /v3/sessions/:id/messages` | send E2EE message (`{messages:[{content,localId}]}`) | `.../codex-happy/src/session.rs:340-350` |
| `GET /v3/sessions/:id/messages?after_seq=&limit=` | backfill on (re)connect | `.../codex-happy/src/session.rs:281-288` |

**Socket.IO `/v1/updates/` (session-scoped):**
| Direction | Event | Cite |
|---|---|---|
| handshake auth | `{token, clientType:"session-scoped", sessionId, happyClient}` | `session.rs:214-221` |
| in | `update` (session sync) | `session.rs:239` |
| in | `rpc-request` (`{method,params}` — e.g. mobile `permission`) | `session.rs:243,751-758`; consumed at `attach.rs:403` |
| out | `session-alive` (keepalive) | `session.rs:499-506` |
| out (ack) | `update-metadata` (CAS, `expectedVersion`, plaintext) | `session.rs:417-423` |
| out (ack) | `update-state` (CAS, `expectedVersion`, E2EE agentState) | `session.rs:467-473` |

**On-disk discovery only (no server):** `~/.happy/access.key` (token + dataKey/legacy secret), `~/.happy/machine.json` (`tunnelPort`/`loopbackPort`/`machineId`/`tunnelId`) — `auth.rs:60-192`. The `/v2/me/*` loopback routes need `X-Loopback-Capability` (`auth.rs:9-13,196-204`) but codex's autoconnect path does not use them.

So the **codex client subset is tiny**: 3 HTTP routes + 1 socket namespace with ~3 in / ~3 out events. The full E2EE/crypto (`encryption.rs`, byte-compatible with RustCrypto), the wire schema (`wire.rs`), the Socket.IO **client** (`session.rs`), and the inbound control mapping (`inbound.rs`) are **done** (`lib.rs:22-33`).

### 1b. What the APP needs from the per-machine server (the other half of the union)

In the autoconnect / agent-comms Scope-A model the app **pairs + syncs against the per-daemon happy-server** (`AGENTS.md` "do NOT assume a single central happy-server"; `plans/agent-comms-design.md:15,178-180`). So the embedded server must serve the app's full sync+pairing surface, not just the codex client's. From `packages/happy-app/sources/sync/*`:

**HTTP (app → server):** `POST /v1/auth` (challenge/response login; `authGetToken.ts:7-16`), `POST /v1/auth/account/request` + `GET /v1/auth/request/status` + `POST /v1/auth/response` + `POST /v1/auth/account/response` (QR/account pairing; `authQRStart.ts:22-36`, `authApprove.ts:17-55`, `authAccountApprove.ts:6-16`), `GET /v1/sessions` (list; `sync.ts:1082-1114`), `POST /v1/sessions` (create/load), `GET`+`POST /v3/sessions/:id/messages` (`sync.ts:1957-2089`), `POST /v1/machines` (`sync.ts:1463-1491`), `GET/POST /v1/account/settings` + `GET /v1/account/profile` (`sync.ts:1676-1819`), `POST /v1/version` (`sync.ts:1846-1884`), `POST/GET/DELETE /v1/push-tokens` (`apiPush.ts:20-86`). (`/v1/connect/*` GitHub/integration routes are not session-control.)

**Socket.IO `/v1/updates` (user-scoped):** auth `{token, clientType:"user-scoped", happyClient}` (`apiSocket.ts:76-82`); app **emits** `rpc-call` (`apiSocket.ts:139-167`) and `session-message-range` (`apiSocket.ts:190-200`); session RPC methods over `rpc-call`: `permission, abort, switch, request-switch, cancel-pending-switch, bash, readFile, writeFile, listDirectory, getDirectoryTree, ripgrep, killSession` (`ops.ts:413-617`); inbound `update` body types it handles: `new-message, update-session, update-machine, delete-session, update-account, delete-machine, relationship-updated, new-artifact` + `ephemeral` (`sync.ts:2112-2520`). Tool-approval is the `permission` RPC, payload `{id, approved, reason?, mode?, allowTools?, updatedInput?, decision?}` (`ops.ts:12-21,419-433`). Push delivery is via Expo/central, not per-machine socket (`pushRegistration.ts:131-201`).

### 1c. The SERVER the per-machine daemon must run (what mediates both clients)

The embedded happy-server is **not a dumb relay** — `createApp`'s socket layer wires JWT auth + 3 client scopes + room fan-out + the RPC bridge:

- **Socket.IO server**, `path:/v1/updates`, JWT-verified in middleware, scopes `session-scoped | user-scoped | machine-scoped`, Redis streams adapter *iff* `REDIS_URL` (multi-process only) — `happy-server/sources/app/api/socket.ts:19-203`.
- **Room-based fan-out + presence** via `eventRouter` with `RecipientFilter` (`all-interested-in-session`, `user-scoped-only`, `machine-scoped-only`) and ~15 update builders + ephemeral activity — `eventRouter.ts:34-159,207-305`.
- **RPC bridge**: `rpc-register`/`rpc-unregister` join/leave room `rpc:<user>:<method>`; `rpc-call` finds the target socket and `emitWithAck('rpc-request',…)` relays the ack back — `rpcHandler.ts:128-256`. (All the `fetchSockets`/backoff/cross-replica complexity at `rpcHandler.ts:16-126` is **multi-replica scaling** an embedded single-process server does not need.)
- **Event-sourced store** (Postgres/Prisma today, `pgliteLoader.ts` shows an embeddable Postgres path): append-only `SessionMessage` with **per-session monotonic seq** via atomic `UPDATE … seq = seq + N RETURNING` + **localId idempotency dedup** + E2EE content stored opaque `{t:"encrypted", c}` (server never decrypts) — `v3SessionRoutes.ts:102-200`, `seq.ts:30-45`. metadata/agentState are **CAS** by `expectedVersion`.

**Full surface, for the size comparison:** 15 route files (`accessKeys, account, artifacts, auth, connect, dev, feed, kv, machines, push, session(v1), user, v3Session, version, voice`), 8 socket handlers (`usage, rpc, ping, sessionUpdate, machineUpdate, artifactUpdate, accessKey, sessionMessageRange`), **22 Prisma models** (`Account, TerminalAuthRequest, AccountAuthRequest, AccountPushToken, Session, SessionMessage, Github*, GlobalLock, RepeatKey, SimpleCache, UsageReport, Machine, UploadedFile, ServiceAccountToken, Artifact, AccessKey, UserRelationship, UserFeedItem, UserKVStore, VoiceConversation`).

### 1d. Minimal subset vs full — verdict on "is it small?"

| Component | FULL | MINIMAL (codex+app remote control) | Droppable |
|---|---|---|---|
| HTTP route groups | 15 | **~8**: auth/pairing, sessions(v1), v3 messages, machines, account, version, push(maybe) | social, feed, kv, voice, artifacts, github/connect, dev |
| Socket handlers | 8 | **~6**: rpc, ping, sessionUpdate, machineUpdate, sessionMessageRange, usage(opt) | artifactUpdate, accessKey(maybe) |
| DB models | 22 | **~7**: Account, AccountAuthRequest/TerminalAuthRequest, AccessKey, Session, SessionMessage, Machine (+AccountPushToken opt) | ~15 (Github*, *Cache/Lock/RepeatKey, Usage, UploadedFile, ServiceAccountToken, Artifact, Relationship, Feed, KV, Voice) |

**Answer: the subset is *smaller than full but not tiny*.** You drop ~40-50% of routes and ~2/3 of DB models — but every *hard* component (Socket.IO server, RPC bridge, JWT+pairing, seq+CAS store, room/presence fan-out) is **in the must-keep set**, while the parts you drop are exactly the **easy, self-contained CRUD** (social/feed/kv/voice/artifacts). Scoping shrinks the *line count*, not the *difficulty floor*.

---

## 2 · Rust-crate feasibility

**Already done (de-risks the wire + crypto entirely):** the 5 E2EE primitives (`encryption.rs`, proven byte-compatible with RustCrypto: SalsaBox/secretbox/AES-256-GCM dataKey/Ed25519 authChallenge), the `@slopus/happy-wire` serde structs (`wire.rs`), the Socket.IO **client** + session-sync core + inbound control map (`session.rs`, `session_state.rs`, `inbound.rs`). `codex-happy/src/lib.rs:22-33`.

**The hard parts of a SERVER crate, ranked by risk:**

| Part | Effort | Risk | Notes |
|---|---|---|---|
| **Socket.IO *server*** | M | **HIGH** | The dominant risk. Must serve `socket.io-client` v4 against an **unmodifiable app**: engine.io handshake, websocket+polling upgrade, rooms, `emitWithAck` round-trips (rpc bridge), `update`/`ephemeral` shapes, volatile emits, reconnection. `socketioxide` (axum-based, claims v4 protocol parity) is the candidate, but exact ack/presence/reconnect compat must be live-validated against the real app — any subtle mismatch is an app-breaking bug not fixable on the app side. |
| **JWT + pairing** | M | MED | `jsonwebtoken` for tokens; the challenge-response uses Ed25519 (**already in `encryption.rs`**); the QR account-pairing state machine (`AccountAuthRequest` encrypted-response dance, `authApprove`/`authAccountApprove`) is net-new server logic. `happy-server/sources/app/auth/auth.ts`. |
| **Store: seq + CAS + dedup** | S–M | LOW | SQLite (`sqlx`/`rusqlite`): atomic `UPDATE session SET seq=seq+N RETURNING seq`, localId dedup, version-checked CAS for metadata/agentState. Directly mirrors `seq.ts:30-45` + `v3SessionRoutes.ts:137-194`. |
| **RPC bridge (single-process)** | S–M | LOW | Drop *all* the Node cross-replica machinery (`rpcHandler.ts:16-126`). Embedded version is a `method→socket` map + `emitWithAck('rpc-request')` relay + a presence check. |
| **Room fan-out + presence** | M | LOW–MED | Re-derive `eventRouter`'s 3 recipient filters + ~10 update builders + activity ephemeral (`eventRouter.ts`). Mechanical but broad. |
| **Fastify routes → axum** | M | LOW | ~8 route groups become axum handlers; Zod schemas → serde + validation. |
| **Push** | S / skip | LOW | App registers tokens centrally + Expo delivers (`pushRegistration.ts`). Per-machine server can proxy Expo HTTP or omit (socket/poll fallback). |

**Overall effort: L (large).** Not XL because (a) crypto + wire + client are done and proven, (b) the *embedded single-process* server sheds the Node server's hardest scaling code, (c) the droppable surface is real. **Single largest risk is Socket.IO-server compatibility with the unmodifiable app**, which scoping does not reduce.

---

## 3 · The divergence tax

The measured churn is **modest but the coupling is structural**:

- `@slopus/happy-wire/src`: **13 commits / 18 mo**, including an explicit *"protocol freeze"* milestone (`61a2aa04`) and the v3 reliable-messages cut. Recent changes are **additive** (session-message-range `US-002`, non-renderable registry `US-001`, new `messageMeta` fields, voice). `index.ts` exports just 5 schema files; `sessionProtocol.ts` has ~10 event kinds; `messages.ts` ~3 core update kinds.
- `v3SessionRoutes.ts`: effectively **1 commit** — the message HTTP API is very stable.

So the **content/message wire is stable**, and critically the server is a **blind E2EE relay for content** (stores `{t:"encrypted", c}` opaque) — content-schema changes don't touch the server. **The tax is on the *control/sync envelope*, not the message body:** the `update` body union (`new-session/update-session/update-machine/new-artifact/relationship-updated/…`), the socket event set, the pairing dance, account/machine shapes — all owned by happy **upstream + the app**, which evolve **independently of this fork**.

**The asymmetry that decides it:** the Node happy-server and the app live in the **same monorepo**, share `@slopus/happy-wire`, and move in **lockstep for free**. A Rust reimplementation **forks that coupling** — every additive `update` type, every new socket event, every pairing tweak becomes a manual port task, against the **one product the fork does not control (the React-Native app)**. Bundling Node buys protocol-lockstep at zero ongoing cost; the Rust crate pays it forever.

---

## 4 · Recommendation

**Bundle the Node happy-server as the embedded sidecar for v1 (confirms the brainstorm's verdict — but for a sharper reason than "the surface is huge").** The surface is *not* huge; it's the **Socket.IO-server-compat risk against an unmodifiable app + the lockstep-vs-chase divergence asymmetry** that win the argument, and **neither is reduced by scoping**.

Record the refinement so the decision is not re-litigated on the stale "full surface" premise: a scoped crate is **L, not XL**, and **the entire codex-client half is already native Rust** — the Node dependency is *only* for the **server role** that mediates the app.

**Keep scoped-Rust as a documented future option, not a v1 deliverable.** Revisit only if one of these triggers fires:
- the app side reaches a hard, enforced **protocol freeze** (the `61a2aa04` "freeze" becomes real + stable), collapsing the chase cost; **and**
- `socketioxide` (or equiv.) is **live-proven** compatible with the real app over a 2-machine smoke (the §2 HIGH risk is bought down to LOW).

**If/when pursued, the decomposition (in dependency order):**
1. **Spike: Socket.IO-server compat** — stand up `socketioxide` `/v1/updates`, drive the *real app* through pairing + `update`/`ephemeral` + one `rpc-call`→`rpc-request`→ack round-trip. Go/no-go gate before anything else.
2. **Store** — SQLite session/message/machine with seq + localId dedup + CAS (mirror `seq.ts` + `v3SessionRoutes.ts`).
3. **Auth + pairing** — JWT + Ed25519 challenge-response (reuse `encryption.rs`) + the QR account-pairing state machine.
4. **HTTP routes (axum)** — the ~8 must-keep groups.
5. **eventRouter + RPC bridge (single-process)** — recipient filters, update builders, presence, the `method→socket` relay.
6. **2-machine smoke** parity with `agent-comms-design.md §8` (Dev Tunnels gateway admission), app unmodified.

The codex-session client (`codex-happy`) is **unchanged** under either choice — it already speaks the wire natively and points at `127.0.0.1:<tunnelPort>` regardless of whether a Node or Rust process answers.

---

## References (file:line)

- codex client: `codex/codex-rs-overlay/codex-happy/src/{api.rs:33,181; session.rs:214-221,239-288,340-350,417-473,499-506,751-758; auth.rs:60-204; inbound.rs:1-365; lib.rs:22-33}`
- app client: `packages/happy-app/sources/sync/{apiSocket.ts:76-200; ops.ts:12-21,413-617; sync.ts:1082-2520; apiPush.ts:20-86; authGetToken.ts; authQRStart.ts; authApprove.ts; authAccountApprove.ts; pushRegistration.ts:131-201}`
- server: `packages/happy-server/sources/app/api/socket.ts:19-203; app/events/eventRouter.ts:34-305; app/api/socket/rpcHandler.ts:16-256; app/api/routes/v3SessionRoutes.ts:102-200; storage/seq.ts:30-45; storage/pgliteLoader.ts; prisma/schema.prisma (22 models)`
- wire: `packages/happy-wire/src/{index.ts:1-5; sessionProtocol.ts; messages.ts; messageMeta.ts}` (13 commits/18mo; `61a2aa04` "protocol freeze")
- design: `plans/agent-comms-design.md:15,159-208,332-446`; `AGENTS.md` (per-machine daemon + Dev Tunnels, "do NOT assume a single central happy-server")
