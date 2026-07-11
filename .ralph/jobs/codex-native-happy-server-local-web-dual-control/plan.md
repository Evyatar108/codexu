# Implementation Plan: Node-free Happy web dual-control for one live Codex thread
<!-- ralph-meta {"overviewTaskId":"codex-native-happy-server-local-web-dual-control"} -->

*Generated from `.ralph\brainstorms\codex-native-happy-server-local-web-dual-control\brainstorm.md` and `brainstorm.json` on 2026-07-10. This is a coordinated eight-job plan, not one cross-repository Ralph PRD.*

Source review basis: codexu base `0bc1a12d6`, Codex wrapper
`0e94f80ed309af1d15214e344fd3bbfb5d662d51`, and nested patched Codex
`587a6a8ab8948ff912b1f24a62833b277934302d`.

## 1. Executive decision

Preserve brainstorm direction **D-001**:

- add a fork-only Rust crate, `codex\codex-rs-overlay\codex-happy-server`, using Axum, the P0-proven Socketioxide release, and SQLx/SQLite;
- keep the existing Happy HTTP and Socket.IO browser contract;
- keep `codex-happy` as the real session-scoped Rust client;
- route browser RPCs to one serialized in-process `CodexControlAdapter`;
- derive one durable Happy session from the primary Codex thread ID;
- add an explicit local plaintext codec while retaining all legacy encrypted codecs;
- require fail-closed Ed25519 paired-device authentication for the browser and a random in-memory capability for Rust-internal traffic;
- bind only `127.0.0.1`;
- never invoke `happy`, start a happy-cli daemon, start a Node happy-server, read `~\.happy` credentials/discovery, or silently fall back to the legacy backend when native-local is selected.

The existing Happy web application is the acceptance surface. P0 first tests whether its existing static message renderer can replace one keyed transient snapshot. If that proof fails because a genuine presentation decision is required, stop that narrow story and file a separate Opus 4.8 UI task; do not redesign chat UI in this work.

## 2. Locked operator decisions

1. Pairing window is exactly **120 seconds**, closes after the first successful enrollment, and opens again only through an explicit operator action that creates a new secret and nonce.
2. Phase-1 dogfood uses fixed port `43127` and exact browser origin `http://localhost:8081`.
3. After a Codex process restart, dogfood imports a **fresh invite**, even when reusing fixed port `43127`; an already-known browser key may be re-enrolled idempotently.
4. P0 uses the real Expo web build in Chromium and the operator-requested exact `socket.io-client` **4.8.1**.
5. No happy-cli executable/daemon, no Node happy-server runtime, and no legacy fallback are permitted in native-local mode.
6. Remote/LAN/tablet exposure, TLS edge design, remote-grade content encryption, multi-device revocation UI, and multi-process aggregation are deferred until local P2 acceptance.

## 3. Source-grounded findings that constrain the plan

- The TUI already exposes a secondary `AppServerEvent` tap and cloneable `AppServerRequestHandle` in `codex\external\repos\codex-patched\codex-rs\tui\src\app.rs` and `app-server-client\src\lib.rs`.
- Current native attach still runs `NodeDaemonSupervisor`, invokes
  `happy daemon start-sync`, and reads `~\.happy\machine.json` and
  `access.key` through
  `codex\codex-rs-overlay\codex-happy\src\attach.rs`,
  `codex\codex-rs-overlay\codex-happy\src\daemon_supervisor.rs`,
  `codex\codex-rs-overlay\codex-happy\src\auth.rs`, and
  `codex\codex-rs-overlay\codex-happy\src\remote_on.rs`.
- Happy web currently parses stored message `content.c` and agent state as plaintext JSON, while the Rust client assumes encrypted bytes. Native-local therefore needs an explicit codec, not an encrypted-looking helper name.
- `POST /v3/sessions/:sessionId/messages` preserves outer message `id`, `localId`, and `seq`, but the current Rust inbound type drops that identity before control dispatch.
- Current TUI-origin user messages and agent-message deltas are not mirrored by `codex-happy`; only final item boundaries are mapped.
- Current app-server callback removal is already the authoritative first-answer-wins point, but the in-process response API discards whether the callback was applied.
- Current native detach cancels pending approvals. That is wrong when the browser disconnects but the live TUI can still answer.
- Browser Socket.IO polling can reuse one proof header for a logical connection, but that proof cannot sign each changing Engine.IO `sid`/timestamp query. Socket proof must bind to the fixed logical target `GET /v1/updates` and be verified once by Socket.IO middleware.
- The checked-in `packages\happy-app\package.json` declares `^4.8.1`, but `pnpm-lock.yaml` currently resolves `socket.io-client` **4.8.3**. P0 must pin and verify exact 4.8.1 rather than assuming the manifest range is the installed version.
- The inner patched Codex workspace references `codex-rs-overlay` through wrapper-relative paths. Inner changes must be built from a Codex wrapper worktree containing its own initialized `external\repos\codex-patched` checkout; an isolated inner-repository worktree elsewhere will not resolve the overlay.

## 4. Review findings resolved in this plan

| ID | Finding | Resolution |
|---|---|---|
| R-01 | Requested Socket.IO client version and lockfile resolution disagree. | J1 pins exact `4.8.1`, updates `pnpm-lock.yaml`, and asserts the installed version before browser proof. |
| R-02 | One cross-repository PRD would lose either Codex or Happy changes. | Eight repo-owned jobs, explicit interface gates, and a single final codexu gitlink integration job. |
| R-03 | Parallel inner-Codex jobs would overwrite the nested gitlink. | All Codex wrapper/inner jobs are serialized; each commits inner first and wrapper second. |
| R-04 | Signing the raw Engine.IO polling query is incompatible with one static browser proof header. | HTTP proofs bind canonical path+query; Socket.IO proof binds fixed `GET /v1/updates` and is consumed once per logical connection. |
| R-05 | An approval RPC ack alone cannot clear Happy state when the TUI answers first. | J2 publishes a local `ServerRequestDisposition` event containing request ID, disposition, and applied result/error. |
| R-06 | A duplicate approval can race between callback removal and tombstone insertion. | Callback map and bounded tombstones share one mutex; removal and tombstone insertion are atomic. |
| R-07 | Snapshot state could remain after final durable text. | Final assistant messages use reserved local ID `codex-origin:assistant:<itemId>`; the server clears the matching snapshot only after that durable commit. |
| R-08 | Current Rust inbound decoding loses browser `id`, `localId`, and `seq`. | Native inbound carries a `StoredInboundMessage`; consumption is emitted only after Codex accepts start/steer. |
| R-09 | `/remote off` currently auto-denies TUI-live approvals. | Native detach drops only remote mirrors/waiters; explicit browser abort still cancels, but detach never resolves the underlying request. |
| R-10 | Pairing/restart semantics were ambiguous on a fixed port. | P2 records the primary thread UUID, relaunches the built fork launcher with `codex resume <THREAD_ID>`, imports a fresh invite, and reuses the existing device key when available. |
| R-11 | Parent codexu could record an intermediate Codex gitlink and lose later Codex jobs. | Only J7 updates the codexu `codex` gitlink to the final merged Codex wrapper SHA. |
| R-12 | P0 could accidentally become a toy-client UI proof. | The probe runs inside the real Expo build with the production `socket.io-client`; P1/P2 acceptance still uses the existing sessions/server/chat screens. |
| R-13 | A memory-only pairing window cannot literally participate in a SQLite transaction. | The gate is serialized by one mutex held through the device-row transaction and consumed before release; restart closes every window. |
| R-14 | Independent Rust and TypeScript fixtures could silently drift. | Both repositories carry the same canonical `happy_local_v1_vectors.json`; J7 fails on a normalized-content mismatch. |
| R-15 | Auth mode and payload codec could be incorrectly conflated. | Keep brainstorm's `dev-tunnel | paired-device` auth discriminator; native Rust explicitly selects `LegacyPlainJsonV1`, while the current app's plaintext parser is locked by local-envelope tests. |
| R-16 | Browser `killSession`, passive disconnect, and operator `/remote off` had ambiguous approval effects. | Only explicit browser abort/kill cancels approvals; disconnect and `/remote off` detach mirrors without resolving TUI-live requests. |
| R-17 | Removing every Socket.IO room would violate D-001's compatibility-plane direction. | Keep only fixed auth-derived machine-user/session rooms; direct RPC still avoids `rpc-register` and generic daemon rooms. |
| R-18 | Persisted settings can contain inference keys, so “message plaintext” understated the at-rest risk. | Docs call settings plaintext too, and DB/evidence tools never emit settings values. |

## 5. Repository, worktree, and merge topology

### 5.1 Repository roots

- **codexu:** `D:\harness-efforts\codexu`
- **Codex wrapper submodule:** `D:\harness-efforts\codexu\codex`
- **Patched Codex nested submodule:** inside each Codex wrapper worktree at `external\repos\codex-patched`

### 5.2 Coordinated jobs

| Job | Repository owner | Worktree | Topic branch(es) | Stories | Depends on |
|---|---|---|---|---:|---|
| J0 P0 Rust compatibility fixture | Codex wrapper | `codex\.worktrees\codex-native-happy-p0-rust` | wrapper `ralph/codex-native-happy-p0-rust` | US-001–003 | none |
| J1 P0 real-browser proof and verdict | codexu | `.worktrees\codex-native-happy-p0-browser` | `ralph/codex-native-happy-p0-browser` | US-004–006 | J0 runnable |
| J2 Authoritative app-server disposition seam | Codex wrapper + nested patched | `codex\.worktrees\codex-happy-approval-disposition` | wrapper `ralph/codex-happy-approval-disposition`; nested `ralph/codex-happy-approval-disposition-patched` | US-007–008 | P0 GO |
| J3 Rust server foundation | Codex wrapper + nested patched | `codex\.worktrees\codex-happy-server-foundation` | wrapper `ralph/codex-happy-server-foundation`; nested `ralph/codex-happy-server-foundation-patched` | US-009–012 | J2 merged in Codex |
| J4 Native lifecycle, codec, identity, and shutdown | Codex wrapper + nested patched | `codex\.worktrees\codex-native-happy-lifecycle` | wrapper `ralph/codex-native-happy-lifecycle`; nested `ralph/codex-native-happy-lifecycle-patched` | US-013–015 | J3 |
| J5 Happy wire/app local compatibility | codexu | `.worktrees\codex-native-happy-app-compat` | `ralph/codex-native-happy-app-compat` | US-016–019 | P0 GO; may run alongside J2–J4 |
| J6 Dual-control arbitration and streaming | Codex wrapper + nested patched only if required | `codex\.worktrees\codex-native-happy-dual-control` | wrapper `ralph/codex-native-happy-dual-control`; nested `ralph/codex-native-happy-dual-control-patched` only for a required TUI seam | US-020–022 | J4 and J5 interface frozen/merged |
| J7 Real dogfood, evidence, docs, and codexu integration | codexu | `.worktrees\codex-native-happy-dogfood` | `ralph/codex-native-happy-dogfood` | US-023–024 | J5 + final J6 Codex SHA |

Explicit nested patched checkout paths:

- J2:
  `D:\harness-efforts\codexu\codex\.worktrees\codex-happy-approval-disposition\external\repos\codex-patched`
- J3:
  `D:\harness-efforts\codexu\codex\.worktrees\codex-happy-server-foundation\external\repos\codex-patched`
- J4:
  `D:\harness-efforts\codexu\codex\.worktrees\codex-native-happy-lifecycle\external\repos\codex-patched`
- J6, only if the bounded TUI seam changes:
  `D:\harness-efforts\codexu\codex\.worktrees\codex-native-happy-dual-control\external\repos\codex-patched`

Each row becomes its own Ralph PRD rooted at that repository worktree. A Codex
job may commit its nested patched submodule and then its wrapper gitlink, but
it never owns codexu package files. A codexu job never edits Codex source; J7
only records the already-reviewed final `codex` gitlink.

### 5.3 Merge order

1. Run J0 and J1 without production persistence.
2. If P0 is NO-GO, archive both branches and stop. Do not start J2–J7.
3. If P0 is GO, merge J1's exact client pin and evidence into codexu before
   J5; J5 rebases on it and later removes the dev-only probe. Merge J0 proof
   code only if preserving it is useful; otherwise retain its branch/evidence
   and let J3 implement from the recorded version matrix.
4. Merge Codex jobs serially: **J2 → J3 → J4 → J6**.
5. J5 may run in parallel with J2–J4 because it owns codexu package files, not the Codex submodule repository.
6. For every Codex job: initialize the nested submodule inside that wrapper
   worktree, commit the nested patched branch first, update the wrapper branch
   to the merged nested SHA, then merge the wrapper commit. Never build from an
   unrelated inner worktree.
7. J7 checks out the final Codex wrapper SHA in `codex`, records that one gitlink in codexu, runs P2, adds evidence/docs, and is the only parent-repository integration commit.

## 6. Frozen cross-repository protocol contracts

These shapes are implementation contracts. Changes require updating TypeScript and Rust fixtures in the same coordinated phase.

### 6.1 Local invite

Base64url-encoded UTF-8 JSON:

```json
{
  "kind": "happy-local-pairing",
  "version": 1,
  "authMode": "paired-device",
  "serverUrl": "http://127.0.0.1:43127",
  "browserOrigin": "http://localhost:8081",
  "machineId": "persistent-machine-id",
  "pairSecret": "base64url-32-random-bytes",
  "pairingNonce": "base64url-24-random-bytes",
  "issuedAt": "2026-07-10T00:00:00.000Z",
  "expiresAt": "2026-07-10T00:02:00.000Z"
}
```

Rules:

- `serverUrl` must be `http://127.0.0.1:<port>`; reject hostname, wildcard, non-loopback, HTTPS downgrade tricks, credentials, fragments, and extra path components.
- `browserOrigin` must exactly equal `window.location.origin` in the app and the configured server origin.
- Window state is memory-only. Restart invalidates every old invite even if its timestamp has not expired.
- Opening a new window invalidates the prior secret and nonce.
- One successful enrollment atomically closes the window.
- The secret may be displayed once in the interactive TUI invite but must never enter JSONL logs, diagnostics files, URLs, or SQLite.

### 6.2 Pair completion

`POST /pair/complete`

Headers:

- `Origin: <browserOrigin>`
- `Content-Type: application/json`
- `X-Happy-Pairing-Secret: <pairSecret>`
- `X-Happy-Pairing-Nonce: <pairingNonce>`
- `X-Happy-Local-Device-Proof: <base64url JSON envelope>`

Body:

```json
{
  "version": 1,
  "machineId": "persistent-machine-id",
  "deviceKeyId": "browser-generated-key-id",
  "deviceEd25519PublicKey": "base64-32-byte-key"
}
```

The proof is signed by the submitted private key over the exact POST target and raw body hash. This proves possession before TOFU pinning. The server checks, in order: exact Host, exact Origin, open/unconsumed
120-second window, constant-time pair-secret equality, pairing nonce, request
proof/signature, body/key consistency, rate limit, and key-ID conflict. One
pairing-gate mutex is held from window validation through the SQLite
insert/idempotent-confirm transaction; success marks the in-memory window
consumed before releasing that mutex. A crash after commit still closes the
window because restart creates no open gate.

Enrollment reuses the stored keypair for the invite's stable `machineId` when
one exists; otherwise it generates a new Ed25519 keypair. Successful
re-enrollment atomically updates the stored endpoint/config and discards the
one-time pair secret. Same key ID with the same public key is idempotent; the
same key ID with a different public key is a hard conflict.

Success response retains the app-compatible machine shape:

```json
{
  "machine": {
    "machineId": "persistent-machine-id",
    "tunnelUrl": "http://127.0.0.1:43127"
  },
  "authMode": "paired-device",
  "pairedDevice": {
    "keyId": "browser-generated-key-id",
    "publicKey": "base64-32-byte-key"
  },
  "githubLogin": null
}
```

### 6.3 Local signed-request envelope

Header name: `X-Happy-Local-Device-Proof`
Domain: `happy-local-device-proof/v1`

```json
{
  "v": 1,
  "keyId": "device-key-id",
  "publicKey": "base64-32-byte-key",
  "nonce": "base64url-24-random-bytes",
  "issuedAt": 1783641600000,
  "method": "GET",
  "target": "/v3/sessions/s1/messages?after_seq=0&limit=100",
  "bodyHash": "base64-sha256-of-raw-body",
  "signature": "base64-64-byte-ed25519-signature"
}
```

Canonical string, with a final value on each line and no trailing newline:

```text
happy-local-device-proof/v1
<UPPERCASE_METHOD>
<CANONICAL_TARGET>
<KEY_ID>
<PUBLIC_KEY_BASE64>
<NONCE_BASE64URL>
<ISSUED_AT_EPOCH_MS>
<RAW_BODY_SHA256_BASE64>
```

Canonical target:

1. Use the normalized URL pathname.
2. Parse query as form-url-encoded key/value pairs.
3. Sort by decoded key, then decoded value; preserve duplicates.
4. Re-encode with WHATWG `URLSearchParams` semantics and append only when non-empty.
5. Reject malformed encodings instead of accepting a different canonical form.

Policy:

- freshness window: 120 seconds;
- permitted forward clock skew: 30 seconds;
- pinned key must exactly match envelope key;
- nonce insertion is a unique SQLite write after signature/freshness/key validation; one concurrent request wins;
- nonce rows remain until freshness plus skew expires and survive process restart;
- expired nonce rows are pruned on startup and before each insert without
  deleting unexpired replay evidence;
- raw body bytes, not parsed/re-serialized JSON, determine `bodyHash`.

The existing Cloudflare-backed public proof remains unchanged and distinct.

CORS allow-headers are exactly `Content-Type`, `X-Happy-Client`,
`X-Happy-Local-Device-Proof`, `X-Happy-Pairing-Secret`, and
`X-Happy-Pairing-Nonce`. If real Chromium emits a Local Network Access
preflight with `Access-Control-Request-Private-Network: true`, P0 records it
and production returns `Access-Control-Allow-Private-Network: true` only on a
valid OPTIONS request for the configured exact origin, Host, method, and
headers; it must never broaden to `*`.

### 6.4 Socket.IO authentication and roles

Path: `/v1/updates`, Socket.IO v4 / Engine.IO v4.

Browser:

```json
{
  "clientType": "user-scoped",
  "happyClient": "web/<app-version>",
  "machineId": "<machine-id>",
  "lastSeenSeq": 42
}
```

- transport is `polling` only;
- `reconnection:false`;
- headers include `X-Happy-Local-Device-Proof` and `X-Happy-Client`;
- proof binds to `GET /v1/updates` with the empty-body hash;
- middleware verifies and consumes it once for the logical connection;
- `machineId` must equal the persisted server identity;
- explicit reconnect rebuilds options with a fresh nonce.

Internal Rust session client:

```json
{
  "clientType": "session-scoped",
  "happyClient": "codex-native/<codex-version>",
  "sessionId": "<happy-session-id>",
  "lastSeenSeq": 42
}
```

- transport is websocket;
- every HTTP request and the socket handshake carries `X-Loopback-Capability`;
- `sessionId` must equal the one stable session registered with the adapter;
- capability is 32 random bytes, exists only in memory, and is never logged or persisted.

### 6.5 Socket events and acknowledgements

Server to clients:

- `update: ApiUpdateContainer`
- `replay-overflow: { replayOverflow: true, currentSeq: number }`
- `ephemeral: ApiEphemeralUpdate`
- normal Socket.IO ack callbacks

Clients to server:

- `update-metadata`
- `update-state`
- `session-alive`
- `session-output-snapshot`
- `session-message-range`
- `rpc-call`

Role allowlist:

- browser `user-scoped`: `update-metadata`, `session-message-range`, and
  `rpc-call`;
- internal Rust `session-scoped`: `update-metadata`, `update-state`,
  `session-alive`, and `session-output-snapshot`;
- every other role/event combination returns the event's existing error ack,
  performs no mutation, and is covered by negative tests.

Rooms are fixed and auth-derived, never caller-selected:

- browser joins `machine:<machineId>:users`;
- internal Rust client joins `session:<sessionId>`;
- durable updates/replay and ephemeral snapshots route through those fixed
  rooms with sender-echo suppression where the existing contract requires it.

CAS acknowledgements remain:

```json
{ "result": "success", "version": 2, "metadata": "<json-string>" }
{ "result": "version-mismatch", "version": 2, "metadata": "<authoritative-json-string>" }
{ "result": "success", "version": 2, "agentState": "<json-string-or-null>" }
{ "result": "version-mismatch", "version": 2, "agentState": "<authoritative-json-string-or-null>" }
{ "result": "error" }
```

Snapshot acknowledgement:

```json
{ "result": "success", "revision": 7 }
{ "result": "stale", "revision": 7 }
{ "result": "error" }
```

RPC wrapper:

```json
{ "ok": true, "result": { "status": "applied" } }
{ "ok": true, "result": { "status": "already_resolved" } }
{ "ok": true, "result": { "status": "stale" } }
{ "ok": true, "result": { "status": "interrupted" } }
{ "ok": true, "result": { "status": "idle" } }
{ "ok": false, "error": "invalid_params" }
{ "ok": false, "error": "method_not_supported" }
{ "ok": false, "error": "server_stopping" }
```

Phase 1 supports session-prefixed methods `permission`, `abort`, and
`killSession` only. The server validates the prefix against the authenticated
session and dispatches directly to the registered adapter; it does not
implement `rpc-register`, dynamic RPC rooms, or a daemon proxy. The fixed
auth-derived update rooms above remain part of the Socket.IO compatibility
plane.

RPC params retain the existing app shape:

```json
{ "method": "<sessionId>:permission", "params": {
  "id": "<happy-visible-approval-id>",
  "approved": true,
  "decision": "approved | approved_for_session | denied | abort"
} }
{ "method": "<sessionId>:abort", "params": {} }
{ "method": "<sessionId>:killSession", "params": {} }
```

The adapter maps the decision vocabulary to the approval kind already tracked
for that ID; `decision` may be omitted, while missing/malformed required fields
return `{ok:false,error:"invalid_params"}` without mutating the callback map.

`session-message-range` uses the existing happy-wire success/error union exactly, including `requestId`, `sessionId`, `fromSeq`, `toSeq`, ascending messages, `hasMore`, and `invalid_range | session_not_found | internal`.

### 6.6 HTTP surface

| Method and path | Browser auth | Internal auth | Required response/behavior |
|---|---:|---:|---|
| `POST /pair/complete` | one-use pairing gate | no | enroll key; no prior pin |
| `GET /health` | no | capability | readiness only |
| `GET /v1/sessions` | proof | capability | `{sessions:[...]}` in current app shape |
| `POST /v1/sessions` | denied | capability | idempotent create/load by stable tag |
| `GET /v3/sessions/:sessionId/messages` | proof | capability | `after_seq`/`before_seq`, max 500, correct order/`hasMore` |
| `POST /v3/sessions/:sessionId/messages` | proof | capability | batch 1–100, localId idempotency, transactional sequences |
| `GET /v2/me/machine` | proof | capability | stable machine/endpoint |
| `GET /v2/me/settings` | proof | capability | persisted settings JSON |
| `PUT /v2/me/settings` | proof + body hash | capability | replace, maximum 1 MiB |
| `GET /v2/me/profile` | proof | capability | deterministic local profile |

Every route is registered through one static route-policy table:

- `OptionsOnly`
- `Pairing`
- `PairedOrInternal`
- `InternalOnly`

No direct `Router::route` call is allowed outside the route-table module. The negative inventory test iterates every descriptor and proves unauthenticated requests fail; unknown paths remain non-authorizing.

Compatibility bodies:

- `POST /v1/sessions` accepts `{tag,metadata,agentState}` and returns
  `{session:{id,seq,metadata,metadataVersion,agentState,agentStateVersion,
  dataEncryptionKey:null,active,activeAt,createdAt,updatedAt,lastMessage:null}}`.
  It accepts only the configured `codex-thread:<primary-thread-id>` tag;
  another tag cannot create a second session.
- `GET /v1/sessions` returns the same session fields in `{sessions:[...]}`,
  including `tag`.
- `GET /v2/me/machine` returns
  `{machineId,hostname,tunnelUrl,lastSeenAt}`.
- `GET /v2/me/profile` returns
  `{id:<machineId>,timestamp,firstName:"Local",lastName:"Codex",
  avatar:null,github:null}`.
- `GET /v2/me/settings` returns the persisted settings JSON object directly;
  `PUT` accepts and replaces that object.
- Message GET returns
  `{messages:[{id,seq,content,localId,createdAt,updatedAt}],hasMore}`.
  Message POST accepts
  `{messages:[{localId,content:<plaintext RawRecord JSON string wrapping a SessionEnvelope>}]}`
  and returns the inserted-or-existing rows without `content`, matching the
  current app outbox contract.

Limits:

- pair body: 16 KiB;
- metadata, agent state, settings, one message content, and one snapshot text:
  1 MiB each;
- message POST aggregate body: 4 MiB and 1–100 messages;
- oversized HTTP is rejected with 413 before domain parsing; oversized socket
  mutations receive an error ack and no state change.

### 6.7 Plaintext codec

Add `SessionPayloadCodec`:

- `LegacyEncryptedAead` preserves current daemon behavior byte-for-byte.
- `LegacyPlainJsonV1` is selected only for native-local.

For `LegacyPlainJsonV1`:

- message body is serialized `RawRecord` JSON shaped as
  `{ "role":"session", "content":<SessionEnvelope> }`, stored inside the
  legacy outer shape `{ "t":"encrypted", "c":"<plaintext JSON>" }`;
- metadata remains plaintext JSON string;
- agent state remains plaintext JSON string or null;
- persisted settings remain plaintext JSON and may include user-configured
  inference/API keys;
- `dataEncryptionKey` is null;
- logs and docs call it plaintext and never imply that `t:"encrypted"` provides encryption.

Rust and TypeScript consume the same deterministic fixtures.

### 6.8 Stable identity and reserved local IDs

- Happy session tag: `codex-thread:<primary-thread-id>`.
- One per-thread database: `$CODEX_HOME\happy-local\threads\<thread-id>\session.sqlite`.
- Structured log: `$CODEX_HOME\happy-local\threads\<thread-id>\server.log.jsonl`.
- Active diagnostics: `$CODEX_HOME\happy-local\active\<pid>.json`.
- The path component is the canonical parsed Codex thread UUID, never an
  arbitrary user string; unsafe/noncanonical identity fails startup.
- Machine ID and Happy session ID are generated once in that thread database
  and reused on restart.
- Active diagnostics are observability only. Neither the app nor native attach
  discovers authority from them; stale PID/start-time records are ignored.
- Browser-origin Codex client ID: `happy:<browser-localId>`.
- TUI-origin user message local ID: `codex-origin:user:<item-id>`.
- TUI-origin final assistant local ID: `codex-origin:assistant:<item-id>`.
- Browser writes using any `codex-origin:` prefix are rejected with 400.
- Internal capability writes may use that namespace.
- Session client suppresses only its own reserved-prefix broadcast echo.

### 6.9 Streaming snapshot

`session-output-snapshot` payload:

```json
{
  "sessionId": "happy-session-id",
  "threadId": "primary-codex-thread-id",
  "turnId": "codex-turn-id",
  "itemId": "agent-message-item-id",
  "revision": 7,
  "text": "full accumulated text",
  "emittedAt": 1783641600123
}
```

Rules:

- producer accumulates full text and targets at most 4 emissions/second/item;
- server accepts only the authenticated session's ID, primary thread, increasing revisions, text at most 1 MiB, and at most 16 active items for the one session;
- server stores latest snapshots only in memory and emits them through `ephemeral` with `type:"session-output-snapshot"` and `id:<sessionId>`;
- app combines that bare session ID with the authenticated source machine ID
  before indexing transient state, matching existing composite-session rules;
- reconnect re-emits current latest snapshots after durable replay;
- a committed durable assistant message with local ID `codex-origin:assistant:<itemId>` removes the matching snapshot and then broadcasts the durable update;
- snapshots never consume session message sequence or durable update sequence.

### 6.10 SQLite and replay semantics

Migrations are embedded with `sqlx::migrate!`; startup never deletes or recreates a database on migration failure.

Minimum schema:

```text
server_identity(singleton_id PK CHECK singleton_id=1, machine_id UNIQUE,
                hostname, created_at)
sessions(id PK, tag UNIQUE, metadata, metadata_version, agent_state,
         agent_state_version, seq, active, last_active_at, created_at, updated_at)
session_messages(id PK, session_id FK, local_id, seq, content_json,
                 created_at, updated_at,
                 UNIQUE(session_id, local_id), UNIQUE(session_id, seq))
settings(singleton_id PK CHECK singleton_id=1, value_json, updated_at)
paired_devices(key_id PK, public_key UNIQUE, created_at, revoked_at)
auth_nonces(key_id FK, nonce, expires_at, UNIQUE(key_id, nonce))
server_meta(key PK, integer_value, text_value)
```

Open with WAL, foreign keys, busy timeout, and owner-only directory permissions where supported.

- `sessions.seq` starts at 0; committed new messages allocate contiguous `seq+1...`.
- durable global `update_seq` starts at 0 and increments in the same transaction as each mutation.
- duplicate local IDs return existing rows without consuming message or update sequence.
- CAS compares and updates version in one transaction; conflict returns the authoritative value.
- replay ring holds the latest 1,024 committed updates.
- reconnect with `lastSeenSeq=N` replays only when `N+1...current` is fully covered; otherwise emits `replay-overflow`.
- after process restart the ring is empty but `update_seq` persists, so a client behind the cursor receives overflow and performs REST recovery rather than silent omission.

### 6.11 Authoritative approval disposition

Add:

```text
Applied
AlreadyResolved
Stale
```

The callback map and a 1,024-entry, 10-minute tombstone set share one mutex:

- callback present: remove callback + insert `Resolved` tombstone atomically → `Applied`;
- missing callback + `Resolved` tombstone → `AlreadyResolved`;
- missing callback + `Cancelled` tombstone or unknown/expired ID → `Stale`;
- cancellation paths insert `Cancelled`;
- pruning enforces both TTL and capacity.

Every in-process response, including a TUI response through the existing API, emits a local event carrying request ID, disposition, and the applied result/error when available. `codex-happy` uses it to clear or complete the mirrored request even when the TUI answered first.

### 6.12 Control and race semantics

One actor owns primary thread ID, active turn ID, pending browser messages, pending approvals, and stream accumulators.

The server registers exactly one in-process handle for its stable session:

```text
StoredInboundMessage { id, local_id, seq, envelope }

CodexControlAdapter
  submit_user(StoredInboundMessage)
    -> Accepted { mode: start|steer, turn_id }
     | Deferred { code }
  permission(happy_approval_id, approved, decision?)
    -> Applied | AlreadyResolved | Stale
  abort()
    -> interrupted | idle
  kill_session()
    -> interrupted | idle   # ack, then native-Happy shutdown
```

The adapter is constructed with the primary thread ID; no method accepts a
caller-selected thread/session ID. `Deferred` leaves the durable message
unconsumed with a typed code and is retryable only by the serialized actor.
Attach/reconnect rebuilds consumed outer IDs from durable
`message-consumption` history before routing any backlog; remaining browser
messages enter the actor in ascending session `seq`.

A deferred head-of-line message retries only after an authoritative turn-state
generation change or a session-client reconnect; there is no timer/busy-loop
retry.

Browser user message:

1. Server commits/broadcasts it.
2. Rust client receives `StoredInboundMessage { id, local_id, seq, message }`.
3. Replay of an already queued/in-flight/consumed outer `id` is coalesced.
4. Idle → `TurnStart` with `client_user_message_id=happy:<localId>`.
5. Active → `TurnSteer` against the observed active turn.
6. Start losing to a simultaneous TUI start retries once as steer after authoritative `TurnStarted`.
7. Steer losing to completion retries once as start.
8. Only a successful path emits `message-consumption` for the outer Happy message `id`.
9. A second failure leaves the message unconsumed/pending, records a redacted
   typed control outcome, and blocks later browser `seq` values from overtaking
   it; it is never silently dropped or duplicated.

TUI user item:

- if client ID starts `happy:`, suppress the echo;
- otherwise post one durable user message with `codex-origin:user:<itemId>`;
- suppress only the session-client echo of that reserved local ID.

Approval:

- pending map stores both the Happy-visible approval `id` and authoritative
  app-server `RequestId`; they are not assumed equal;
- the actor retains that ID mapping with the same 1,024-entry/10-minute bound
  as the app-server tombstone so a late browser answer still reaches the
  authoritative disposition;
- browser and TUI answer through the same authoritative callback map;
- browser ack reflects `Applied`, `AlreadyResolved`, or `Stale`;
- local disposition event carries the app-server `RequestId`, which the actor
  maps back to the Happy-visible ID before reconciling agent state.

Interrupt:

- browser `abort` first resolves pending approvals with cancel, then interrupts the active turn;
- returns `interrupted` if it changed live state and `idle` otherwise;
- TUI interrupt flows to web through normal interrupted turn completion.

Detach:

- passive browser/socket disconnect clears no approval and interrupts no turn;
- browser `killSession` is an explicit abort-then-detach: it uses the same
  first-answer-wins cancellation as `abort`, interrupts any active turn,
  returns `interrupted` or `idle`, and then runs the native Happy shutdown
  sequence after flushing that ack, without terminating the Codex thread/TUI;
- `/remote off` stops accepting work, fails browser waiters with
  `server_stopping`, closes sockets, removes pending entries from the persisted
  Happy agent-state mirror without writing a completed approval outcome, stops
  the session client/control actor, checkpoints and closes SQLite, releases
  the listener, removes diagnostics, and drops the tap;
- `/remote off` neither interrupts the active Codex turn nor resolves the
  underlying app-server approvals while the TUI remains live.
- `/remote off` does not return until the configured port can be rebound; a
  bounded shutdown timeout may abort Happy-owned tasks but still may not
  resolve TUI-live approvals.
- The actor serializes the detaching flag and mirror clear; late TUI events
  after that flag cannot recreate persisted pending state.

## 7. Detailed implementation jobs

## J0 — P0 Rust compatibility fixture

**Owner:** Codex wrapper only. No production store and no nested patched workspace edit.

### Files to create

- `codex\codex-rs-overlay\codex-happy-compat-spike\Cargo.toml`
- `codex\codex-rs-overlay\codex-happy-compat-spike\Cargo.lock`
- `codex\codex-rs-overlay\codex-happy-compat-spike\src\main.rs`
- `codex\codex-rs-overlay\codex-happy-compat-spike\src\auth.rs`
- `codex\codex-rs-overlay\codex-happy-compat-spike\src\server.rs`
- `codex\codex-rs-overlay\codex-happy-compat-spike\src\rust_client.rs`
- `codex\codex-rs-overlay\codex-happy-compat-spike\src\contract.rs`
- `codex\codex-rs-overlay\codex-happy-compat-spike\tests\compatibility.rs`

### Reference files

- `packages\happy-app\package.json`
- `packages\happy-app\sources\sync\socketOptions.ts`
- `packages\happy-server\sources\app\api\socket.ts`
- `packages\happy-server\sources\app\api\socket\sessionUpdateHandler.ts`
- `packages\happy-server\sources\app\api\socket\sessionMessageRangeHandler.ts`
- `packages\happy-server\sources\app\api\socket\rpcHandler.ts`
- `packages\happy-server\sources\app\api\auth\remoteDeviceAuth.ts`
- `codex\external\repos\codex-patched\codex-rs\Cargo.toml`

### Stories and implementation

- **US-001:** standalone pinned Axum/Socketioxide fixture and exact contract constants.
- **US-002:** browser-polling and Rust-websocket roles, acks, update/replay behavior.
- **US-003:** exact-origin CORS, fixed-port restart, local proof, query/body tamper, nonce replay.

The fixture owns no production session schema. It may use one disposable
SQLite auth journal containing only the paired public key and proof nonces to
prove replay rejection across process restart; it must not pre-build the
production session/message/settings store. It prints a human-visible one-use
invite but redacts all secrets from structured output.

### Acceptance

- Listens only on `127.0.0.1:43127`.
- Engine.IO v4 handshake succeeds for browser polling and Rust websocket.
- Each role joins only its auth-derived fixed room and receives the intended
  update/replay traffic.
- RPC, range, CAS, update, reconnect cursor, and overflow acks match §6.
- Wrong Origin/Host, missing proof/capability, query/body tampering, and replay fail closed.
- Server restart requires a fresh invite/proof.

### Validation

```powershell
Set-Location D:\harness-efforts\codexu\codex\.worktrees\codex-native-happy-p0-rust
cargo test --manifest-path codex-rs-overlay\codex-happy-compat-spike\Cargo.toml
cargo run --manifest-path codex-rs-overlay\codex-happy-compat-spike\Cargo.toml -- server --bind 127.0.0.1:43127 --origin http://localhost:8081
```

In another shell:

```powershell
Set-Location D:\harness-efforts\codexu\codex\.worktrees\codex-native-happy-p0-rust
cargo run --manifest-path codex-rs-overlay\codex-happy-compat-spike\Cargo.toml -- rust-client --url http://127.0.0.1:43127
```

### Stop gate

NO-GO if success requires a Socketioxide/Engine.IO fork, custom packet framing, a browser client patch, or substantial reimplementation of Socket.IO acknowledgements/reconnect. A small path/serde/middleware adapter is allowed.

## J1 — P0 existing-web-build Chromium proof and verdict

**Owner:** codexu.

### Files to create/modify

- `packages\happy-app\package.json`
- `pnpm-lock.yaml`
- `packages\happy-app\sources\app\(app)\dev\native-happy-p0.tsx`
- `packages\happy-app\sources\dev\nativeHappyP0Probe.ts`
- `packages\happy-app\sources\dev\nativeHappyP0Probe.test.ts`
- `packages\happy-app\sources\dev\nativeHappySnapshotProbe.ts`
- `.ralph\jobs\codex-native-happy-server-local-web-dual-control\p0\compatibility-result.json`
- `.ralph\jobs\codex-native-happy-server-local-web-dual-control\p0\browser-proof.png`

### Reference files

- `packages\happy-app\sources\components\ChatList.tsx`
- `packages\happy-app\sources\components\MessageView.tsx`
- `packages\happy-app\sources\fork\chat\ForkFlatChatList.tsx`
- `packages\happy-app\sources\-session\SessionView.tsx`
- `packages\happy-app\sources\sync\socketOptions.ts`
- `packages\happy-app\sources\sync\apiSocket.ts`

### Stories and implementation

- **US-004:** pin exact `socket.io-client` 4.8.1 and add a dev-only probe inside the real Expo bundle.
- **US-005:** execute Chromium polling/header/ack/reconnect/auth checks against J0.
- **US-006:** render and replace one keyed in-progress full-text snapshot through the existing message surface.

The probe may provide deterministic buttons/status rows, but it must import the package's actual `socket.io-client` and render inside the real Expo app. It is not the P1/P2 product acceptance UI.
It clears the invite input and never renders/logs proof headers, key material,
or pair secrets before `browser-proof.png` and `compatibility-result.json` are
captured.

### Validation

```powershell
Set-Location D:\harness-efforts\codexu\.worktrees\codex-native-happy-p0-browser
pnpm install
pnpm --filter happy-app list socket.io-client --depth 0
pnpm --filter happy-app exec vitest run sources\dev\nativeHappyP0Probe.test.ts
pnpm --filter happy-app typecheck
pnpm --filter happy-app exec cross-env APP_ENV=development CI=1 expo start --web --port 8081
```

Browser automation:

```powershell
Set-Location D:\harness-efforts\codexu\.worktrees\codex-native-happy-p0-browser
New-Item -ItemType Directory -Force .ralph\jobs\codex-native-happy-server-local-web-dual-control\p0 | Out-Null
agent-browser --session native-happy-p0 open http://localhost:8081/dev/native-happy-p0
agent-browser --session native-happy-p0 wait --load networkidle
agent-browser --session native-happy-p0 snapshot -i
# Fill the invite input and click "Run P0" using the refs returned above.
agent-browser --session native-happy-p0 wait 5000
agent-browser --session native-happy-p0 get text body
agent-browser --session native-happy-p0 screenshot .ralph\jobs\codex-native-happy-server-local-web-dual-control\p0\browser-proof.png --full
agent-browser --session native-happy-p0 close
```

### P0 verdict artifact

`compatibility-result.json` records exact npm/Cargo versions, browser version,
all pass/fail checks, whether any compatibility shim was needed, and two
orthogonal verdicts:

```json
{
  "transportVerdict": "GO",
  "rendererVerdict": "EXISTING_RENDERER_OK"
}
```

Allowed transport values are `GO | NO_GO_SOCKET_PROTOCOL`; allowed renderer
values are `EXISTING_RENDERER_OK | REQUIRES_SEPARATE_UI_TASK`.

Transport `GO` with `REQUIRES_SEPARATE_UI_TASK` permits server/protocol work
but blocks production snapshot UI until a separate Opus 4.8 task settles only
the renderer choice. J2-J4 and J5's schema/auth work may continue in that
state, but US-018, snapshot-dependent J6 acceptance, and J7 remain blocked
until the separate UI task lands.

## J2 — Authoritative app-server request disposition

**Owner:** Codex wrapper plus nested patched Codex.

### Files to modify

- `codex\external\repos\codex-patched\codex-rs\app-server\src\outgoing_message.rs`
- `codex\external\repos\codex-patched\codex-rs\app-server\src\in_process.rs`
- `codex\external\repos\codex-patched\codex-rs\app-server-client\src\lib.rs`
- `codex\external\repos\codex-patched\codex-rs\tui\src\app.rs`
- colocated `#[cfg(test)]` modules in
  `codex\external\repos\codex-patched\codex-rs\app-server\src\outgoing_message.rs`,
  `codex\external\repos\codex-patched\codex-rs\app-server\src\in_process.rs`,
  and
  `codex\external\repos\codex-patched\codex-rs\app-server-client\src\lib.rs`
- `codex\docs\implementation\patch-surface.md`

### Stories

- **US-007:** atomic callback/tombstone disposition API.
- **US-008:** in-process typed result plus local disposition event for every response path.

### Acceptance

- Two concurrent valid responses produce exactly one `Applied` and one `AlreadyResolved`.
- Resolve after cancellation is `Stale`.
- Unknown/expired ID is `Stale`.
- Tombstones are capped at 1,024 and expire after 10 minutes.
- Existing remote handle remains explicitly unsupported for typed disposition; native Happy attaches only to in-process.
- TUI behavior is unchanged when no Happy tap exists.
- B-002 is settled here and consumed in J6.

### Validation

```powershell
Set-Location D:\harness-efforts\codexu\codex\.worktrees\codex-happy-approval-disposition\external\repos\codex-patched\codex-rs
cargo metadata --no-deps --format-version 1
just fmt
cargo test -p codex-app-server first_resolution_is_applied_and_duplicate_is_already_resolved
cargo test -p codex-app-server cancelled_resolution_is_stale
cargo test -p codex-app-server tombstones_are_bounded_and_expire
cargo test -p codex-app-server-client server_request_disposition
cargo check -p codex-app-server -p codex-app-server-client -p codex-tui
cargo check --workspace
Set-Location ..\..\..\..
bash scripts/audit_invariants.sh
```

## J3 — Rust compatibility server foundation

**Owner:** Codex wrapper plus nested patched Codex.

### Files to create

- `codex\codex-rs-overlay\codex-happy-server\Cargo.toml`
- `codex\codex-rs-overlay\codex-happy-server\migrations\0001_initial.sql`
- `codex\codex-rs-overlay\codex-happy-server\src\lib.rs`
- `codex\codex-rs-overlay\codex-happy-server\src\config.rs`
- `codex\codex-rs-overlay\codex-happy-server\src\auth.rs`
- `codex\codex-rs-overlay\codex-happy-server\src\db.rs`
- `codex\codex-rs-overlay\codex-happy-server\src\error.rs`
- `codex\codex-rs-overlay\codex-happy-server\src\http.rs`
- `codex\codex-rs-overlay\codex-happy-server\src\routes.rs`
- `codex\codex-rs-overlay\codex-happy-server\src\socket.rs`
- `codex\codex-rs-overlay\codex-happy-server\src\replay.rs`
- `codex\codex-rs-overlay\codex-happy-server\src\types.rs`
- `codex\codex-rs-overlay\codex-happy-server\src\control.rs`
- `codex\codex-rs-overlay\codex-happy-server\tests\http_contract.rs`
- `codex\codex-rs-overlay\codex-happy-server\tests\socket_contract.rs`
- `codex\codex-rs-overlay\codex-happy-server\tests\auth_security.rs`
- `codex\codex-rs-overlay\codex-happy-server\tests\sqlite_invariants.rs`
- `codex\codex-rs-overlay\fixtures\happy_local_v1_vectors.json`

### Files to modify

- `codex\external\repos\codex-patched\codex-rs\Cargo.toml`
- `codex\external\repos\codex-patched\codex-rs\Cargo.lock`
- `codex\external\repos\codex-patched\MODULE.bazel`
- `codex\external\repos\codex-patched\MODULE.bazel.lock`
- `codex\scripts\audit_network_calls.sh`
- `codex\docs\implementation\patch-surface.md`
- if J0 was merged, delete or absorb
  `codex\codex-rs-overlay\codex-happy-compat-spike` after its tests are ported;
  otherwise port from the J0 branch/evidence without adding the fixture to J3

### Stories

- **US-009:** crate/workspace/dependency pin and embedded migrations.
- **US-010:** transactional SQLite store, stable identity, paging/idempotency/CAS.
- **US-011:** Axum HTTP and Socket.IO roles/events/acks/replay.
- **US-012:** pairing, paired proof, internal capability, route inventory, rate limits.

### Security implementation requirements

- `127.0.0.1` bind assertion at construction.
- exact Host and Origin checks.
- pairing maximum five failed attempts per opened window.
- bounded in-memory proof-failure limiter: 60 failures/minute per remote address + Origin, at most 256 buckets.
- constant-time pair-secret comparison using existing workspace `constant_time_eq`.
- no secret-bearing `Debug` output.
- registered route table is the only router construction source.

### Acceptance

- All §6 HTTP, socket, DB, replay, auth, and migration contracts pass.
- Fixed authenticated machine-user/session rooms route updates without any
  caller-selected or generic RPC room.
- Concurrent pair completion produces one enrollment/one consumed window; no
  second request can interleave between the SQLite commit and gate close.
- Rust tests load `codex\codex-rs-overlay\fixtures\happy_local_v1_vectors.json`.
- Browser write to reserved `codex-origin:` namespace fails; internal capability write succeeds.
- A crash/reopen recovers WAL, stable identity/session, sequence, paired keys, and nonce replay state.
- Migration failure/newer schema fails startup without reset.
- No runtime import or process launch of happy-cli/happy-server exists.
- Network audit permits only the configured loopback listener/client path for
  the new crates and rejects tunnel/public endpoints.

### Validation

```powershell
Set-Location D:\harness-efforts\codexu\codex\.worktrees\codex-happy-server-foundation\external\repos\codex-patched\codex-rs
cargo metadata --no-deps --format-version 1
just fmt
just bazel-lock-update
just bazel-lock-check
cargo test -p codex-happy-server
cargo test -p codex-happy-server --test auth_security
cargo test -p codex-happy-server --test sqlite_invariants
cargo check -p codex-happy-server
cargo check --workspace
Set-Location ..\..\..\..
bash scripts/audit_network_calls.sh
bash scripts/audit_invariants.sh
```

## J4 — Native-local lifecycle, codec, identity, and shutdown

**Owner:** Codex wrapper plus bounded nested patched TUI/feature seams.

### Files to create/modify

- `codex\codex-rs-overlay\codex-happy\Cargo.toml`
- `codex\codex-rs-overlay\codex-happy\src\attach.rs`
- `codex\codex-rs-overlay\codex-happy\src\api.rs`
- `codex\codex-rs-overlay\codex-happy\src\auth.rs`
- `codex\codex-rs-overlay\codex-happy\src\daemon_supervisor.rs`
- `codex\codex-rs-overlay\codex-happy\src\lib.rs`
- `codex\codex-rs-overlay\codex-happy\src\remote_on.rs`
- `codex\codex-rs-overlay\codex-happy\src\session.rs`
- `codex\codex-rs-overlay\codex-happy\src\session_state.rs`
- `codex\codex-rs-overlay\codex-happy\src\wire.rs`
- new `codex\codex-rs-overlay\codex-happy\src\codec.rs`
- new `codex\codex-rs-overlay\codex-happy\src\native_local.rs`
- new `codex\codex-rs-overlay\codex-happy\src\diagnostics.rs`
- new `codex\codex-rs-overlay\codex-happy\src\codec_tests.rs`
- new `codex\codex-rs-overlay\codex-happy\src\native_local_tests.rs`
- new `codex\codex-rs-overlay\codex-happy\src\diagnostics_tests.rs`
- `codex\external\repos\codex-patched\codex-rs\features\src\lib.rs`
- `codex\external\repos\codex-patched\codex-rs\features\src\tests.rs`
- `codex\external\repos\codex-patched\codex-rs\tui\src\app.rs`
- `codex\external\repos\codex-patched\codex-rs\tui\src\app\event_dispatch.rs`
- `codex\external\repos\codex-patched\codex-rs\tui\src\chatwidget\slash_dispatch.rs`
- `codex\external\repos\codex-patched\codex-rs\tui\src\slash_command.rs`
- `codex\external\repos\codex-patched\codex-rs\tui\src\remote_auto_attach.rs`
- `codex\docs\implementation\patch-surface.md`

### Stories

- **US-013:** default-off `native_happy_local_server` feature and exhaustive backend selection.
- **US-014:** `LegacyPlainJsonV1`, stable thread tag, explicit endpoint/capability, identity-preserving inbound message type.
- **US-015:** startup after primary thread identity, fixed/ephemeral port
  selection, `/remote invite` rotation, diagnostics, `/remote off`, and
  restart/resume.

### Backend selection

- `RemoteSession` remains the umbrella.
- New `Feature::NativeHappyLocalServer`, key `native_happy_local_server`, is experimental/default-off.
- `RemoteSession` on + native feature off retains explicit legacy-daemon behavior.
- Native feature on selects `SessionBackend::NativeLocal` exhaustively.
- Native startup failure is surfaced and never invokes the legacy supervisor.
- If `HAPPY_CURRENT_SESSION_ID` is present or the configured port is already
  owned, native mode reports an explicit ownership/bind collision; it never
  discovers or reuses that process and never falls through.
- P1 bypasses `RemoteAutoAttach` for native-local; enabling the feature does
  not start a listener until explicit `/remote on`.
- `/remote on` starts native-local and opens the initial 120-second window;
  `/remote invite` explicitly invalidates and reopens the window with a fresh
  token; `/remote off` stops the server.
- Repeating `/remote on` while already running reports the active endpoint and
  does not rotate a consumed/active window.
- Remote-session feature copy becomes transport-neutral and must not claim
  that every backend is end-to-end encrypted.
- Dogfood overrides:
  - `CODEX_HAPPY_LOCAL_PORT=43127`
  - `CODEX_HAPPY_WEB_ORIGIN=http://localhost:8081`
- Product-grade config-table work is deferred; these are explicit experimental overrides, not hidden discovery.

The dedicated feature is intentional: P1 does not add a broad new `[happy]`
ConfigToml surface to upstream-canonical config code. The two environment
overrides are explicit test/dogfood inputs only.

### Acceptance

- A fake process-spawn host that panics is never called by native-local tests.
- Native slash flow branches before credential onboarding, `NodeDaemonSupervisor`, and `~\.happy` reads.
- Native-local remains explicit-command-only; startup auto-attach is unchanged
  for legacy and disabled for native.
- Existing legacy-daemon tests remain green.
- Feature-off behavior is byte-for-byte unchanged.
- Diagnostics file contains PID, endpoint, thread ID, Happy session ID/tag, DB path, and start time only.
- Diagnostics are never consumed as attach authority, and stale records do not
  redirect a native session.
- `/remote off` leaves a TUI-live approval answerable.
- `/remote off` releases the listener before returning, proven by immediate
  fixed-port rebind.
- `/remote invite` is unavailable when native-local is not running and always
  rotates both secret and nonce.
- B-003's Rust side is settled.

### Validation

```powershell
Set-Location D:\harness-efforts\codexu\codex\.worktrees\codex-native-happy-lifecycle\external\repos\codex-patched\codex-rs
cargo metadata --no-deps --format-version 1
just fmt
cargo test -p codex-happy native_local
cargo test -p codex-happy legacy_plain_json
cargo test -p codex-happy diagnostics
cargo test -p codex-tui remote_session
cargo check -p codex-happy -p codex-tui -p codex-features
cargo check --workspace
Set-Location ..\..\..\..
bash scripts/audit_network_calls.sh
bash scripts/audit_invariants.sh
```

## J5 — Happy wire/app local paired mode and transient compatibility

**Owner:** codexu only.

### Files to create

- `packages\happy-wire\src\localPairingInvite.ts`
- `packages\happy-wire\src\localPairingInvite.test.ts`
- `packages\happy-wire\src\localDeviceAuth.ts`
- `packages\happy-wire\src\localDeviceAuth.test.ts`
- `packages\happy-wire\src\sessionOutputSnapshot.ts`
- `packages\happy-wire\src\sessionOutputSnapshot.test.ts`
- `packages\happy-wire\src\fixtures\happy_local_v1_vectors.json`
- `packages\happy-app\sources\auth\localEnrollment.ts`
- `packages\happy-app\sources\auth\localEnrollment.test.ts`
- `packages\happy-app\sources\sync\sessionOutputSnapshot.test.ts`
- `packages\happy-app\sources\-session\SessionView.snapshot.test.tsx`

### Files to modify

- `packages\happy-wire\src\index.ts`
- `packages\happy-app\sources\auth\tokenStorage.ts`
- `packages\happy-app\sources\auth\machineAuth.ts`
- `packages\happy-app\sources\auth\publicEnrollment.ts`
- `packages\happy-app\sources\sync\socketOptions.ts`
- `packages\happy-app\sources\sync\apiSocket.ts`
- `packages\happy-app\sources\sync\apiTypes.ts`
- `packages\happy-app\sources\sync\sync.ts`
- `packages\happy-app\sources\sync\storage.ts`
- `packages\happy-app\sources\app\(app)\server.tsx`
- `packages\happy-app\sources\-session\SessionView.tsx`
- `packages\happy-app\sources\components\MessageView.tsx` only if P0 proves the existing component needs a small additive prop
- `packages\happy-app\sources\components\ChatList.tsx` only if P0 proves composition above the list is impossible
- `packages\happy-app\sources\fork\chat\ForkFlatChatList.tsx` only if the selected existing list path requires the keyed transient row
- `packages\happy-app\sources\text\_default.ts`
- `packages\happy-app\sources\text\translations\ca.ts`
- `packages\happy-app\sources\text\translations\en.ts`
- `packages\happy-app\sources\text\translations\es.ts`
- `packages\happy-app\sources\text\translations\it.ts`
- `packages\happy-app\sources\text\translations\ja.ts`
- `packages\happy-app\sources\text\translations\pl.ts`
- `packages\happy-app\sources\text\translations\pt.ts`
- `packages\happy-app\sources\text\translations\ru.ts`
- `packages\happy-app\sources\text\translations\zh-Hans.ts`
- `packages\happy-app\sources\text\translations\zh-Hant.ts`
- `packages\happy-app\sources\text\translations.test.ts`
- `packages\happy-app\CHANGELOG.md`
- `packages\happy-app\sources\changelog\changelog.json`
- remove the J1 dev-only probe after production tests absorb it

### Stories

- **US-016:** shared invite/proof/snapshot schemas and Rust/TS vectors.
- **US-017:** explicit credential discriminator, local enrollment, HTTP proof, polling socket options.
- **US-018:** ephemeral snapshot state and existing-renderer replacement/clear/reconnect.
- **US-019:** existing server-screen invite dispatch, auth-mode regression tests, changelog.

### Credential discriminator

Add optional persisted:

```text
authMode = dev-tunnel | paired-device
```

Migration:

- missing mode + persisted device-key or Cloudflare fields → paired-device;
- missing mode otherwise → dev-tunnel;
- local mode is never inferred from `http`, `localhost`, or `127.0.0.1`;
- next successful write persists the explicit mode.

After enrollment, `paired-device` signs every normal request. Cloudflare
Access headers are an optional edge layer used only when those fields exist;
paired credentials with Cloudflare fields use the unchanged public proof,
while paired credentials without them use `X-Happy-Local-Device-Proof`.
Local pair completion additionally proves possession of the submitted key;
existing public enrollment remains strict and unchanged. Local invite kind
selects only the local enrollment validator, and neither path is inferred from
URL. Native Rust—not the auth discriminator—selects
`LegacyPlainJsonV1`; app tests lock the existing plaintext
`content.c`/agent-state parsing to that local envelope.

Incomplete `paired-device` credentials (missing key material or only one
Cloudflare field) fail closed and require re-pairing; they never fall through
to Dev-Tunnels token refresh.

### Renderer constraint

The preferred implementation derives one transient standard text item in `SessionView` and passes it through the existing `MessageView`/list path. No animation, smooth streaming, or new layout. If P0 verdict says a real UI choice remains, this story stops at state plumbing and references the separate Opus task.

### Acceptance

- Exact cross-language invite/proof/canonical-target vectors pass.
- The TypeScript tests load
  `packages\happy-wire\src\fixtures\happy_local_v1_vectors.json`.
- Public and Dev-Tunnels auth tests remain unchanged/green.
- Fresh invite for a known `machineId` reuses its stored keypair, updates the
  endpoint after successful pairing, and never persists the pair secret.
- Browser local socket is polling-only, no unsupported WebSocket header assumption.
- Explicit reconnect obtains a new proof nonce and passes `lastSeenSeq`.
- Snapshot revision is monotonic, latest-only, ephemeral, and cleared by durable final local ID.
- The snapshot map is excluded from app persistence/hydration; reconnect
  restores it only from the live server.
- Existing server screen accepts both strict public invite and distinct local invite without a new navigation flow.
- Existing pairing keys stay in place, but all checked-in locale copies stop
  claiming every invite is public/Cloudflare-backed.
- B-003's app side and B-004's rendering side are settled.

### Validation

```powershell
Set-Location D:\harness-efforts\codexu\.worktrees\codex-native-happy-app-compat
pnpm --filter @slopus/happy-wire typecheck
pnpm --filter @slopus/happy-wire test
pnpm --filter happy-app exec vitest run sources\auth\connectTokenRefresh.test.ts sources\auth\localEnrollment.test.ts sources\auth\machineAuth.test.ts sources\auth\pairingInviteDispatch.test.ts sources\auth\publicEnrollment.test.ts sources\auth\tokenStorage.test.ts sources\sync\machineDelete.test.ts sources\sync\pushRegistration.test.ts sources\sync\socketOptions.test.ts sources\sync\apiSocket.test.ts sources\sync\sessionOutputSnapshot.test.ts sources\sync\storageSessionOutputSnapshot.test.ts sources\sync\sync.test.ts sources\-session\SessionView.snapshot.test.tsx sources\text\translations.test.ts
pnpm --filter happy-app typecheck
```

The final J5 acceptance log records this exact 15-file selection at 154 passing
tests. Reducer/local-id replacement has an additional focused 79-test log.

Real browser regression, web-server shell:

```powershell
Set-Location D:\harness-efforts\codexu\.worktrees\codex-native-happy-app-compat
pnpm --filter happy-app exec cross-env APP_ENV=development CI=1 expo start --web --port 8081
```

In another shell:

```powershell
Set-Location D:\harness-efforts\codexu\.worktrees\codex-native-happy-app-compat
New-Item -ItemType Directory -Force .ralph\jobs\codex-native-happy-server-local-web-dual-control\acceptance | Out-Null
agent-browser --session native-happy-app open http://localhost:8081/server
agent-browser --session native-happy-app wait --load networkidle
agent-browser --session native-happy-app snapshot -i
# Pair with a fresh local invite, open the single session, and capture the keyed snapshot replacement.
agent-browser --session native-happy-app screenshot .ralph\jobs\codex-native-happy-server-local-web-dual-control\acceptance\app-compat.png --full
agent-browser --session native-happy-app close
```

The production-route browser capture uses the pinned Codex fixture tree plus
the reviewable acceptance-only `acceptance\app-compat-harness.patch`, applied
to a disposable copy. `acceptance\app-compat-reproduction.md` records the
fixture tree hash, adapter hash, build commands, and cleanup; the Codex
submodule source and pointer remain unchanged.

## J6 — Dual-control correctness

**Owner:** Codex wrapper; touch nested patched TUI only if J2's event passthrough needs a final bounded match arm.

### Files to create/modify

- `codex\codex-rs-overlay\codex-happy-server\src\control.rs`
- `codex\codex-rs-overlay\codex-happy-server\src\routes.rs`
- `codex\codex-rs-overlay\codex-happy-server\src\socket.rs`
- `codex\codex-rs-overlay\codex-happy\src\agent_state.rs`
- `codex\codex-rs-overlay\codex-happy\src\attach.rs`
- `codex\codex-rs-overlay\codex-happy\src\inbound.rs`
- `codex\codex-rs-overlay\codex-happy\src\mapping.rs`
- `codex\codex-rs-overlay\codex-happy\src\session.rs`
- `codex\codex-rs-overlay\codex-happy\src\session_state.rs`
- `codex\codex-rs-overlay\codex-happy\src\wire.rs`
- new `codex\codex-rs-overlay\codex-happy\src\control.rs`
- new `codex\codex-rs-overlay\codex-happy\src\control_tests.rs`
- new `codex\codex-rs-overlay\codex-happy\src\streaming_tests.rs`
- `codex\codex-rs-overlay\codex-happy\src\attach_e2e_tests.rs`
- `codex\codex-rs-overlay\codex-happy\src\inbound_tests.rs`
- `codex\codex-rs-overlay\codex-happy\src\mapping_tests.rs`
- `codex\codex-rs-overlay\codex-happy\src\session_tests.rs`
- `codex\codex-rs-overlay\codex-happy\src\wire_tests.rs`
- `codex\external\repos\codex-patched\codex-rs\tui\src\app.rs` only if required
- `codex\docs\implementation\patch-surface.md`

### Stories

- **US-020:** preserve outer IDs; mirror/deduplicate browser- and TUI-origin prompts.
- **US-021:** serialized idle start/active steer and symmetric race recovery.
- **US-022:** snapshots/tools, authoritative approvals, interrupt, detach semantics.

### Acceptance

- Exactly one root thread and one Happy session/tag are ever targeted.
- Browser message is consumed only after accepted start/steer.
- Start/start and steer/completion races lose no input and create no duplicate.
- TUI-origin prompt appears once in web; Happy-origin echo appears once in TUI/web.
- Browser gets live full snapshots at ≤4 Hz and durable final text/tool boundaries.
- First approval answer is `Applied`; second is `AlreadyResolved` or `Stale`, never false success.
- The race tests use distinct Happy-visible and app-server request IDs.
- TUI-first resolution clears Happy state with the applied decision.
- Browser and TUI interrupt paths are reflected on both surfaces.
- Passive disconnect and `/remote off` leave TUI approval live; explicit
  `killSession` cancels then shuts only the native Happy side.
- `/remote off` removes the persisted Happy pending mirror without recording a
  false approval outcome.
- B-004's mapping/dedup/streaming side is settled.

### Validation

```powershell
Set-Location D:\harness-efforts\codexu\codex\.worktrees\codex-native-happy-dual-control\external\repos\codex-patched\codex-rs
cargo metadata --no-deps --format-version 1
just fmt
cargo test -p codex-happy terminal_and_browser_prompts_are_mirrored_once
cargo test -p codex-happy idle_start_race_retries_as_steer_without_loss
cargo test -p codex-happy steer_completion_race_retries_as_start_without_loss
cargo test -p codex-happy approval_first_answer_wins
cargo test -p codex-happy detach_does_not_cancel_tui_live_approval
cargo test -p codex-happy passive_disconnect_does_not_cancel_or_interrupt
cargo test -p codex-happy kill_session_aborts_then_stops_only_happy
cargo test -p codex-happy snapshots_are_coalesced_and_cleared_after_durable_final
cargo test -p codex-happy
cargo check -p codex-happy -p codex-happy-server -p codex-tui
cargo check --workspace
Set-Location ..\..\..\..
bash scripts/audit_invariants.sh
```

## J7 — Real same-machine dogfood, evidence, docs, and integration

**Owner:** codexu. Records the final Codex wrapper gitlink.

### Files to create/modify

- `codex` gitlink
- `scripts\fork-setup\verify-codex-native-happy-local.ps1`
- `scripts\fork-setup\inspect-happy-local-db.py`
- `.ralph\jobs\codex-native-happy-server-local-web-dual-control\acceptance\evidence.json`
- `.ralph\jobs\codex-native-happy-server-local-web-dual-control\acceptance\steps.md`
- `.ralph\jobs\codex-native-happy-server-local-web-dual-control\acceptance\browser.png`
- `.ralph\jobs\codex-native-happy-server-local-web-dual-control\acceptance\server-log.redacted.jsonl`
- `docs\security-model.md`
- `docs\fork-notes.md`
- `AGENTS.md` only if implementation discovers a new recurring trap

### Stories

- **US-023:** deterministic P2 acceptance and process/port/DB evidence.
- **US-024:** security/plaintext/default-off docs and release deferral.

### Dogfood launch

Web shell:

```powershell
Set-Location D:\harness-efforts\codexu\.worktrees\codex-native-happy-dogfood
pnpm --filter happy-app exec cross-env APP_ENV=development CI=1 expo start --web --port 8081
```

Codex shell:

```powershell
Set-Location D:\harness-efforts\codexu\.worktrees\codex-native-happy-dogfood\codex
& 'C:\Program Files\Git\bin\bash.exe' -c 'source scripts/iteration-env.sh && cd external/repos/codex-patched/codex-rs && cargo build -p codex-cli --bin codex-core -p codex-copilot-launcher --bin codex'
Set-Location .\external\repos\codex-patched\codex-rs
$env:CODEX_HAPPY_LOCAL_PORT = '43127'
$env:CODEX_HAPPY_WEB_ORIGIN = 'http://localhost:8081'
.\target\debug\codex.exe --enable remote_session --enable native_happy_local_server
```

Inside TUI:

1. `/remote on`
2. copy the fresh local invite;
3. after the first enrollment closes the window, run `/remote invite`; prove
   the old invite fails and the fresh invite can enroll a fresh browser profile;
4. after the scripted pre-restart history is fully consumed and Codex prints
   the primary thread UUID/resume hint, record that UUID as `$threadId` and
   exit the process cleanly;
5. restart the same thread, not a new TUI thread:

   ```powershell
   $threadId = '<recorded-primary-thread-uuid>'
   .\target\debug\codex.exe --enable remote_session --enable native_happy_local_server resume $threadId
   ```

6. run `/remote on` again and import the newly emitted invite rather than
   relying on rendezvous; assert the listed Happy session remains
   `codex-thread:<threadId>` and the pre-restart history is present exactly
   once.

Browser automation uses the existing screens:

```powershell
Set-Location D:\harness-efforts\codexu\.worktrees\codex-native-happy-dogfood
New-Item -ItemType Directory -Force .ralph\jobs\codex-native-happy-server-local-web-dual-control\acceptance | Out-Null
agent-browser --session native-happy-p2 open http://localhost:8081/server
agent-browser --session native-happy-p2 wait --load networkidle
agent-browser --session native-happy-p2 snapshot -i
# Paste invite and pair through the existing server screen.
# Navigate to the one listed session and execute the scripted alternating-turn matrix.
agent-browser --session native-happy-p2 screenshot .ralph\jobs\codex-native-happy-server-local-web-dual-control\acceptance\browser.png --full
agent-browser --session native-happy-p2 close
```

### Required visible matrix

- terminal prompt → appears once in web;
- browser idle prompt → appears once and starts a turn;
- opposite-surface follow-up during active turn → steers same turn;
- simultaneous idle-start race → both inputs retained;
- live assistant snapshots and tool start/end on both;
- approve and deny from each surface;
- simultaneous double-answer → one applied, one already-resolved/stale;
- interrupt from each surface;
- browser disconnect/reconnect with no duplicate/loss;
- consumed pairing invite fails; `/remote invite` rotates both secret and
  nonce; a fresh browser profile enrolls with the new invite;
- `/remote off/on` retains one session;
- `/remote off` during approval leaves the TUI answer active and leaves no
  stale/false-completed Happy mirror;
- fully consumed idle fixed-port process restart via
  `codex resume <THREAD_ID>` + fresh invite reopens the same
  `codex-thread:<THREAD_ID>` session and history.

### Process and port evidence

`verify-codex-native-happy-local.ps1`:

- reads the non-secret active diagnostics record;
- resolves `Get-NetTCPConnection -LocalAddress 127.0.0.1 -LocalPort 43127 -State Listen`;
- asserts listener owner PID equals Codex PID;
- captures `Win32_Process` PID, parent PID, name, and command line for Codex, `happy*`, Node, cloudflared, and devtunnel-related processes;
- classifies Expo/Metro and unrelated Node tooling separately;
- fails if a `happy` executable, Node happy-server/happy-cli daemon, standalone
  Codex app-server, or Cloudflare/Dev-Tunnels process is a descendant of the
  tested Codex process or references the tested port/DB; unrelated machine
  processes are recorded but do not create a false failure;
- always fails if any PID other than the tested Codex PID owns the
  session-plane listener.

`inspect-happy-local-db.py` asserts:

- one `sessions` row for `codex-thread:<thread-id>`;
- no duplicate `(session_id,local_id)` or `(session_id,seq)`;
- persisted update cursor and paired nonce/device rows;
- detach case has no stale pending request and no fabricated completed outcome;
- expected history after restart.

It reports counts, IDs, and invariant outcomes only; it never prints message
content or settings values. `evidence.json` and `server-log.redacted.jsonl`
likewise contain no invite, proof, key, capability, transcript text, or
settings payload. The browser screenshot may show only synthetic
non-sensitive acceptance labels and must not show an invite or credential.
`steps.md` records placeholder actions and verdicts, never the pasted token.

### Validation

```powershell
Set-Location D:\harness-efforts\codexu\.worktrees\codex-native-happy-dogfood
pnpm --filter @slopus/happy-wire test
pnpm --filter happy-app typecheck
$rustVectors = ([IO.File]::ReadAllText('codex\codex-rs-overlay\fixtures\happy_local_v1_vectors.json') -replace "`r`n", "`n").TrimEnd([char]10)
$tsVectors = ([IO.File]::ReadAllText('packages\happy-wire\src\fixtures\happy_local_v1_vectors.json') -replace "`r`n", "`n").TrimEnd([char]10)
if ($rustVectors -cne $tsVectors) { throw 'Rust/TypeScript local-contract vectors differ' }
powershell -ExecutionPolicy Bypass -File scripts\fork-setup\verify-codex-native-happy-local.ps1 -Port 43127 -Output .ralph\jobs\codex-native-happy-server-local-web-dual-control\acceptance\evidence.json
python scripts\fork-setup\inspect-happy-local-db.py --evidence .ralph\jobs\codex-native-happy-server-local-web-dual-control\acceptance\evidence.json
```

No release build, tag, package publish, auto-attach default change, remote listener, or tunnel configuration is part of this job.

## 8. P0 GO / NO-GO contract

### GO requires every item

- Exact `socket.io-client` 4.8.1 is installed and recorded.
- Real Chromium page in the existing Expo build connects by polling to `/v1/updates`.
- Real Chromium generates an Ed25519 keypair and completes the signed local
  pairing proof.
- Browser custom proof headers reach the Socketioxide logical handshake.
- Existing `rust_socketio` 0.6 client connects by websocket with internal capability.
- Auth-derived browser/session room routing works without `rpc-register`.
- Exact-origin CORS and preflight pass; wrong/wildcard Origin fails.
- `rpc-call`, `session-message-range`, metadata CAS, and state CAS acknowledgements match §6.
- Update delivery, explicit reconnect with fresh proof, cursor replay, and overflow work.
- HTTP canonical query and body tampering fail.
- Nonce replay fails before and after server restart.
- Fixed port bind/rebind works and restart uses a fresh invite.
- Any Chromium Local Network Access preflight observed in the real run is
  handled for the exact origin only.
- Existing static renderer replaces one keyed transient snapshot without a broad redesign, or the verdict explicitly gates a separate narrow UI task.

### NO-GO

Stop before production storage if any required transport behavior needs:

- a fork of Socketioxide/Engine.IO;
- custom Socket.IO packet parsing/framing;
- a modified browser Socket.IO client;
- browser WebSocket custom headers;
- replacing acknowledgements/replay with an unplanned parallel protocol.

NO-GO triggers reassessment of D-002. It is not permission to quietly ship Node or happy-cli.

## 9. Acceptance mapping

| Brainstorm criterion | Settling jobs |
|---|---|
| AC-01 existing web pairs and lists one live thread session | J3, J4, J5, J7 |
| AC-02 prompts rendered exactly once; local IDs preserved | J4, J6, J7 |
| AC-03 idle start vs active steer; one root thread | J6, J7 |
| AC-04 live snapshots, durable final, tools | J5, J6, J7 |
| AC-05 authoritative approval race | J2, J6, J7 |
| AC-06 interrupt from either surface | J6, J7 |
| AC-07 seq/cursor/idempotency/replay/CAS/ranges | J3, J5, J7 |
| AC-08 loopback bind and all traffic authenticated | J0, J1, J3, J7 |
| AC-09 no happy-cli/Node/fallback | J4, J7 |
| AC-10 PID/port/process proof | J7 |
| AC-11 off/on and restart retain stable session | J3, J4, J7 |
| AC-12 default-off vanilla behavior | J4, J5, J7 |

Blockers:

- **B-001:** settled only by J0+J1 P0 execution.
- **B-002:** settled by J2; exercised by J6/J7.
- **B-003:** settled jointly by J4 Rust codec and J5 app/wire mode.
- **B-004:** settled jointly by J5 transient state/rendering and J6 prompt/delta mapping.

## 10. Security test matrix

Mandatory automated negatives:

- bind `0.0.0.0`, `::`, or hostname wildcard → startup error;
- wrong Host → 400/401 before handler;
- absent/wrong Origin on paired browser path → denied;
- unauthenticated non-OPTIONS request for every registered route → denied;
- pair route with closed/expired/consumed window → denied;
- pair secret wrong, nonce wrong/reused, key signature wrong, body/key mismatch → denied;
- conflicting key ID/public key → denied without overwrite;
- proof from a revoked key row → denied;
- stale/future proof → denied;
- method, path, canonical query, or raw body changed after signing → denied;
- nonce replay in same process and after restart → denied;
- missing/incorrect internal capability → denied;
- browser role emitting `update-state`, `session-alive`, or
  `session-output-snapshot` → error ack and no mutation;
- internal role emitting browser RPC/range events → error ack and no mutation;
- internal session create/tag or socket `sessionId` not equal to the configured
  primary session → denied;
- browser Socket.IO websocket attempt cannot be treated as authenticated;
- reused polling handshake proof on explicit reconnect → denied;
- reserved `codex-origin:` browser local ID → denied;
- settings payload >1 MiB → 413;
- pair body >16 KiB, message aggregate >4 MiB, or
  metadata/state/snapshot payload >1 MiB → rejected before mutation;
- route added outside policy builder → invariant test failure;
- logs/evidence contain no secret/proof/private key/capability/message body.
- DB inspection/evidence never emits plaintext settings values or inference
  keys.

Security verdict remains **GO for loopback-only local proof, NO-GO for remote exposure**.

## 11. Phase 5a / 5b convergence for every job

Each job is incomplete until:

1. targeted tests/typechecks above pass;
2. **Phase 5a:** code review finds no open High/Medium correctness or security issue; fixes are re-tested and reviewed again until clean;
3. **Phase 5b:** docs review confirms every changed behavior, flag, security limitation, build command, and patch-surface record is current; fixes are reviewed again until clean;
4. the job diff contains only its repository-owned files;
5. nested Codex jobs show both the inner commit and wrapper commit, with the wrapper pointing at the reviewed inner SHA;
6. no job pushes or updates parent codexu's `codex` gitlink except J7.

For Codex jobs, `cargo check --workspace` is the local hard gate; `cargo test --workspace` and release builds remain CI/release-only per `codex\CLAUDE.md`.

## 12. Conflict surface

### Codex upstream

- **Low:** new overlay crates/files under `codex-rs-overlay`.
- **Medium:** `codex-rs\Cargo.toml`, `Cargo.lock`, Bazel locks, feature registry, app-server in-process response seam, and TUI event match.
- Keep upstream-canonical edits bounded and marked `SANDBOX PATCH`.
- Do not add a standalone app-server process or broad core protocol changes.

### Happy upstream

- **Low:** new happy-wire local contract files and app local-enrollment module.
- **Medium:** `tokenStorage.ts`, `machineAuth.ts`, `publicEnrollment.ts`,
  `socketOptions.ts`, `apiSocket.ts`, server-screen invite dispatch, pairing
  locale copy, and changelog artifacts.
- **High/manual-three-way:** `sync.ts`, `storage.ts`, `SessionView.tsx`, list/render components. Keep changes to auth selection and one transient snapshot map; prefer new pure helpers/fork seams over refactors.
- `packages\happy-server` is reference-only for this task; no Node runtime or production server edit is required.

## 13. Rollback and feature-gate behavior

- Disable `native_happy_local_server` to restore the explicit legacy backend; disabling `remote_session` restores vanilla no-attach behavior.
- Native failure never changes backend automatically.
- Native DB/state is isolated under `$CODEX_HOME\happy-local`; legacy `~\.happy` files are neither read nor modified.
- Removing a local credential from the app does not alter Dev-Tunnels/public credentials.
- Reverting the codexu gitlink and J5 app commit fully removes the feature path; orphan local SQLite may be deleted manually after confirming no needed history.
- Migrations are forward-only. Older binaries ignore the separate native DB rather than trying to downgrade it.
- P0 NO-GO branches are disposable and must not be partially merged into production jobs.

## 14. Common mistakes and confusion points

1. `^4.8.1` is not exact 4.8.1; the current lock resolves 4.8.3.
2. Do not build the inner patched workspace from an unrelated inner worktree; its overlay paths depend on the Codex wrapper worktree layout.
3. Do not run two Codex inner jobs in parallel and then choose one gitlink; one will be lost.
4. Browser polling proof signs the fixed logical Socket.IO target, not each changing Engine.IO query.
5. Loopback is not identity. Every actual request/socket needs paired proof or the in-memory capability.
6. `{t:"encrypted"}` is a compatibility wrapper, not encryption in native-local mode.
7. Preserve browser outer `id`, `localId`, and `seq`; `message-consumption` targets the outer message ID.
8. Reject browser `codex-origin:` IDs; otherwise a browser can spoof the echo-suppression namespace.
9. Do not create a second Codex thread for browser control; adapter injects the authoritative primary thread.
10. Do not mark a browser message consumed before start/steer acceptance.
11. Do not treat a second approval answer as success; only callback-map disposition is authoritative.
12. `/remote off` is detach, not abort. It must not interrupt the turn or
    auto-deny a TUI-live approval.
13. Do not persist transient snapshots or allocate durable sequence numbers for them.
14. Clear snapshots only after durable final commit, not merely after observing `ItemCompleted`.
15. After process restart, use a fresh invite in P2 even on fixed port; do not add a rendezvous daemon.
16. Node is allowed to serve/build the web app only. It may not own the Happy session-plane port or routes.
17. Do not broaden P0 renderer uncertainty into UI redesign or remote transport work.
18. `/remote invite` rotates the pairing gate; it is not an alias for abort,
    restart, or legacy onboarding.
19. Do not dump the SQLite `settings` value in diagnostics/evidence; local
    settings are plaintext and can include inference credentials.
20. Keep the new PowerShell verifier ASCII-only or UTF-8 with BOM so Windows
    PowerShell 5.1 does not mis-tokenize it.
21. In PowerShell, bare `bash` may resolve WSL rather than Git Bash. Invoke
    `C:\Program Files\Git\bin\bash.exe` explicitly before sourcing
    `codex\scripts\iteration-env.sh`.

## 15. Genuine blockers and deferred decisions

### Genuine blocker

- **B-001 remains genuine until J0/J1 execute.** Source inspection cannot prove real Chromium + exact Socket.IO 4.8.1 + Socketioxide + rust_socketio interoperability.

### Implementation gates, not architecture blockers

- B-002, B-003, and B-004 have explicit jobs and acceptance tests above.

### Deferred

- Exact Socketioxide version is a P0 output. J3 must pin the exact proven version; no range drift.
- If P0 proves a genuine keyed-transient rendering decision is required, file a separate Opus 4.8 task.
- Product-grade stable discovery, auto-attach, Rust-served static assets, LAN/public/tablet transport, remote encryption, revocation UI, and multiple simultaneous Codex processes are P3/follow-up work.

## 16. Definition of done

This task is locally complete only when all eight jobs are merged in the stated order, J7 records the final Codex gitlink, all Phase 5a/5b gates are clean, P2 evidence proves every visible/control/reconnect/restart case, and process/port evidence proves that the session plane is owned by the Codex PID with no happy-cli or Node happy-server runtime.
