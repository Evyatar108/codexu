# Brainstorm synthesis — native-Rust embedded happy-server crate (Rust-crate pivot)

> NEW iteration (2026-06-24) of `codex-autoconnect-self-contained-zero-friction`,
> after the operator VOIDED the prior bundled-sidecar verdict on 2026-06-23.
> Prior-iteration artifacts (`brainstorm.json`, `selected-direction.md`,
> `brainstorm-synthesis.md`) are preserved; this set is `rust-crate-*`.

Lenses: ran=[codex, copilot, devils-advocate]; skipped=[] (full mode).

## TL;DR recommendation

**Recommend the HYBRID (D-001): a TRANSPORT swap, not a protocol fork.** Keep the
app's pairing / account / session-list surface exactly as today (it is plain
**HTTP/REST** → trivial axum handlers in the Rust server), and replace **only the
single `/v1/updates` Socket.IO connection** with a plain WebSocket (+ POST
fallback) that a Rust server implements directly. **Keep the `@slopus/happy-wire`
message/update SCHEMAS byte-stable** — change the *framing/transport*, not the
payloads. Revised effort: **M** for the Rust server (down from the spike's L for
pure option (a)), plus **M** for the bounded app/codex-client transport swap.

The L→M reduction comes entirely from **deleting Socket.IO-server protocol parity**
(engine.io handshake, polling↔ws upgrade, rooms wire-format, `emitWithAck`
round-trip semantics, reconnection) against an unmodifiable counterparty — the
single risk the spike said scoping does NOT buy down. Because we own both ends, we
delete that component instead of reimplementing it. Copilot estimated this at
25–40% of the Rust-server risk; codex and the DA concur it is the dominant risk.

**But the recommendation is GATED, not unconditional.** The Devil's Advocate
raised a red flag the operator must consciously resolve before any Rust-server
build: *the zero-friction win is mostly lifecycle / onboarding / discovery, which
is independent of whether the server is Rust or Node.* So the decomposition ships
self-onboard + codex-owned lifecycle FIRST (Phase 1, server-agnostic), and gates
the Rust server (Phase 2) behind an explicit operator decision (Phase 0) + a live
transport spike on the e-ink tablet.

## The clarification that makes "hybrid" the sweet spot (not the worst of both)

The DA worried a hybrid means "two transports / dual state machines." It does not,
once the surface is read precisely (spike §1b):

- **HTTP/REST (unchanged):** `POST /v1/auth` + the QR/account pairing dance,
  `GET /v1/sessions` (list), `POST /v1/machines`, account settings/profile,
  `POST /v1/version`, push-tokens, and `GET`/`POST /v3/sessions/:id/messages`
  (backfill). None of these use Socket.IO. They become boring axum handlers.
- **Socket.IO `/v1/updates` (the ONLY realtime transport):** the live `update`
  stream (`new-message`, `update-session`, `update-machine`, …), `rpc-call →
  rpc-request → ack`, and `session-message-range`.

So the app has exactly **one** realtime connection today (Socket.IO). The hybrid
replaces that one connection with **one** plain-WS connection carrying the same
message shapes. Still one realtime transport — just plain WS instead of Socket.IO.
That is what bounds the app change to `apiSocket.ts`'s transport layer and keeps
the wire schemas (`happy-wire/src/*`) stable, which in turn bounds version-skew
(the DA's product-fork objection): a transport swap is not a schema fork.

## Path correction carried into the design

The codex lens located the codex-happy crate at
`codex/external/repos/codex-patched/codex-rs/codex-happy/` — that is **wrong**. The
crate is the fork-exclusive overlay `codex/codex-rs-overlay/codex-happy/`
(verified: the dir holds `onboard.rs`, `attach.rs`, `session.rs`, `encryption.rs`,
`wire.rs`, …). The NEW Rust **server** crate should likewise be a new overlay crate
`codex/codex-rs-overlay/codex-happy-server/` — fork-exclusive = **zero
upstream-conflict surface** per `codex/CLAUDE.md` core tenet 1 (overlay-first
placement). This is strictly better than the spike/lens framing implied.

---

## Candidate directions

### D-001 — Hybrid: REST pairing/list + plain-WS for the session/RPC hot path (RECOMMENDED)
- Contributing lenses: [codex, copilot, devils-advocate] (copilot marked it
  "(recommended)"; codex called it lowest-risk if pairing/account stay compatible;
  DA accepts it as the only sane (b)-flavor when scoped as a transport swap behind
  migration gates).
- What: New Rust overlay server crate. HTTP/REST routes (~8 must-keep groups) as
  axum; SQLite store (per-session monotonic seq + `localId` idempotency dedup +
  `expectedVersion` CAS); JWT + Ed25519 challenge-response + QR account-pairing;
  **plain WebSocket** `/v1/updates` replacement carrying the existing `update` /
  `rpc` / `range` message shapes; single-process room/presence fan-out (trivial:
  "which live connections care about this session"). Reuse `codex-happy`'s
  `encryption.rs` + `wire.rs` + session-sync patterns. App + codex client swap
  their realtime transport (Socket.IO → plain WS) behind a **per-machine
  capability flag** so non-codex machines keep Socket.IO during migration.
- Why it might work: deletes the dominant Socket.IO-server-parity risk; keeps
  happy-wire schemas stable (bounded version skew); pairing/list UX unchanged for
  users; the single-process server sheds all Redis/`fetchSockets`/multi-replica
  code (spike §1c).
- Risks / friction: the app-side transport swap on the **e-ink tablet** (the
  primary target) is the residual risk — the reconnect/replay path
  (`auth.lastSeenSeq`, replay-overflow) and the **two distinct seq domains**
  (`updateData.seq` account-global replay vs `session.seq` pagination — DA) must be
  re-expressed over plain-WS framing **with identical semantics**, or you get empty
  chats / broken pagination. Two-stack migration window if non-BOOX clients must
  keep working.
- Cheapest validation (Phase 0 gate): stand up a minimal Rust plain-WS
  `/v1/updates` + a flagged app transport adapter; prove ONE session round-trip
  (replay from `auth.lastSeenSeq` → live `new-message`/`update-session` → one
  `rpc-call`→`ack` → `session-message-range` backfill → disconnect/reconnect)
  E2EE, locally, on a real BOOX build. Pass ⇒ proceed; fail ⇒ fall back to D-002.
- Disconfirming observation: if the app's `apiSocket.ts`/`sync.ts` realtime logic
  cannot route per-machine capability cleanly, or the swap drags in broad
  reducer/storage/UI rewrites instead of staying near the transport layer, the
  "saved effort" is illusory and this collapses toward D-002 (pure-a) or a more
  aggressive D-003 (pure-b).

### D-002 — Option (a): Rust reimplements the scoped EXISTING Socket.IO surface, zero app/wire change
- Contributing lenses: [codex, copilot, devils-advocate].
- What: A Rust Socket.IO **server** (e.g. `socketioxide`) at `/v1/updates`, byte-
  compatible with `socket.io-client` v4 and the app's exact expectations; same
  HTTP routes + store + auth as D-001. **Zero** change to `packages/happy-app` or
  `packages/happy-wire`.
- Why it might work: lowest rollout friction (no app churn); fully preserves the
  app/server/wire contract and any deployed/non-operator clients.
- Risks / friction: effort stays **L** — the Socket.IO-server-parity risk is NOT
  bought down by scoping. A subtly-incompatible server "looks healthy" while
  breaking one hot path (polling→ws upgrade, trailing-slash/path, `emitWithAck`,
  replay-overflow, the two seq domains). This is the spike's headline risk.
- Cheapest validation: BEFORE any routes/store, stand up `socketioxide` `/v1/updates`
  and drive the **real** app through connect → replay → `update`/`ephemeral` →
  `update-metadata` `emitWithAck` → one `rpc-call`→`rpc-request`→ack → reconnect.
  A go/no-go stop sign.
- Disconfirming observation: if `socketioxide` cannot pass the real-app smoke
  without app patches, or the compat shim grows larger than the scoped store
  itself, (a) is a trap — rule it out despite zero app churn.

### D-003 — Option (b, full): minimal codex-specific wire incl. slimmed schemas (product fork)
- Contributing lenses: [codex, copilot, devils-advocate].
- What: D-001's transport swap PLUS slimming `happy-wire/src/sessionProtocol.ts` /
  `messages.ts` to a codex-only subset (drop update/event types a codex session
  doesn't need), and rewriting `codex-happy/src/session.rs` onto the new wire.
- Why it might work: smallest Rust server; cleanest codex-only protocol;
  divergence already accepted by the fork.
- Risks / friction: highest blast radius. `happy-wire` is shared by app, server,
  CLI/session producers, AND the codex-happy Rust mirror; slimming forks the app
  from BOTH the existing Node daemon (happy-cli-first users) and future upstream
  merges, and risks a *second* subtly-incompatible session server (app build A
  speaks minimal-v1, Node daemon speaks Socket.IO, Rust speaks minimal-v2). On the
  e-ink tablet this trades server difficulty for app sync regressions on the
  weakest device. Effort: S-M Rust mechanics but **M-L** app/wire migration + dual-
  stack + future merge debt.
- Cheapest validation: do NOT design the protocol first. First inventory live
  consumers + required compatibility (which app builds must still pair? must
  happy-cli-first Node daemons keep working? can App Distribution force-update the
  BOOX tablets before `/remote on` ships?). Only then prototype.
- Disconfirming observation: justified ONLY if synthesis finds no meaningful
  external/shipped clients, the BOOX tablets force-update in lockstep, happy-cli
  Node-daemon compat is explicitly abandoned, and the app tolerates dual-stack.
  Without those product decisions, "smaller protocol" is false economy.

---

## The Devil's-Advocate red flag → folded into sequencing (not relitigating the pivot)

DA's strongest finding: **a successful first-run dogfood where codex wires
`onboard.rs` into `/remote on`, supervises the EXISTING embedded Node happy-server
as an internal sidecar, writes `machine.json`, disables the silent fallback, and
the current app pairs/syncs over the existing Socket.IO/wire — with no user-
installed happy-cli and no app changes — would prove zero-friction is mainly
lifecycle/onboarding/discovery, not a server rewrite.** And the unsolved
cross-machine **app discovery** problem is identical for Rust and Node (agent-comms
§5 only gives daemon↔daemon `devtunnel list`; the app cannot run it).

The operator already pivoted away from "bundle Node," so this is NOT re-proposed as
a co-equal direction. Instead it is honored as:
1. **Phase 1 is server-agnostic** (lifecycle + onboard) and ships the bulk of
   zero-friction regardless of the eventual server choice.
2. The **#1 operator decision** below (is "Node-free" hard-required, or is "codex is
   the only user-visible install" enough?) decides whether the Rust server is on the
   critical path at all.
3. The Rust server (Phase 2) is **gated** behind Phase 0.

---

## Decomposition (dependency order)

- **Phase 0 — Operator decision + go/no-go transport spike (GATE).**
  Resolve operator decision #1 (Node-free hard-required?). If Rust proceeds, run
  the D-001 transport spike (or D-002's Socket.IO smoke if the operator chooses
  pure-a) on a real BOOX build. This is the single go/no-go before building.
- **Phase 1 — codex self-onboard + lifecycle (server-AGNOSTIC; ships most of the
  zero-friction; ABSORBS task `codex-autoconnect-interactive-self-onboard-remote-on`).**
  - Wire `onboard.rs` device flow into `/remote on` when `credentials_ready()` is
    false (display user code + open browser + `complete_onboard_with_token`).
  - **M1 fix:** chmod `~/.happy/access.key` → `0o600` on Unix in
    `onboard.rs::write_credentials`.
  - Make `establish()` failure a **hard, diagnosed** `/remote` error (distinguish
    "no daemon/listener" vs "no creds"), NOT today's silent fallback to vanilla
    codex (`attach.rs`).
  - codex-managed daemon lifecycle: start/health/restart/stop the embedded session
    server, write `machine.json` (tunnelPort), bring up the Dev Tunnel.
- **Phase 2 — embedded Rust session-server crate (GATED by Phase 0; the D-001 shape).**
  - NEW overlay crate `codex/codex-rs-overlay/codex-happy-server/` (zero upstream-
    conflict). Reuse `codex-happy` `encryption.rs` + `wire.rs` + store patterns.
  - axum HTTP routes (~8 must-keep) + SQLite store (seq + localId dedup + CAS) +
    JWT/pairing + plain-WS `/v1/updates` + single-process room/presence + RPC bridge.
- **Phase 3 — app + codex-client transport adapter (codexu `packages/` + codex-happy).**
  - `packages/happy-app/sources/sync/{apiSocket.ts, socketOptions.ts, sync.ts}`:
    plain-WS transport adapter behind a per-machine capability flag (non-codex
    machines keep Socket.IO during migration). **Preserve** the `auth.lastSeenSeq`
    replay + replay-overflow + the two seq domains EXACTLY.
  - `codex/codex-rs-overlay/codex-happy/src/session.rs`: swap the Socket.IO client
    for the plain-WS client (session-sync logic unchanged).
  - `packages/happy-wire/src/`: add minimal transport framing if needed; **keep
    message/update schemas stable** (do NOT slim — that is D-003).
- **Phase 4 — cross-machine APP discovery over Dev Tunnels (DEFERRED — likely its
  own brainstorm).**
  The genuinely-unsolved piece: the phone/webapp is NOT running `devtunnel list` and
  there is no central registry; daemon↔daemon discovery (agent-comms §5) does NOT
  solve app↔machine discovery. FLAG as its own brainstorm/spike. Must NOT gate
  Phases 1–3 (localhost/webapp pairing delivers honest local zero-friction first).

## Cross-repo surface

- **codex fork (submodule `codex/`; two-commit + pointer-bump discipline):**
  - `codex/codex-rs-overlay/codex-happy/src/{onboard.rs (wire + 0o600), attach.rs
    (hard-diagnosed failure, no silent fallback), session.rs (transport swap, Ph3),
    auth.rs}`.
  - NEW `codex/codex-rs-overlay/codex-happy-server/` (the embedded Rust server,
    overlay = zero-conflict).
  - codex launcher / `/remote` command seam + packaging
    (`.github/workflows/publish-npm.yml`) so codex owns the lifecycle.
- **codexu `packages/`:**
  - `packages/happy-app/sources/sync/{apiSocket.ts, socketOptions.ts, sync.ts}`
    (Ph3 transport adapter).
  - `packages/happy-wire/src/` (Ph3 framing; schemas stable).
  - `packages/happy-server/` — REUSED as the Rust port's reference (not edited
    unless we also keep Node daemon parity); also the fallback if operator keeps Node.

## Operator decisions (must resolve before/inside planning)

1. **Is "Node-free" a HARD requirement** (security / distribution / no-Node-runtime
   in the codex artifact), **or is "codex is the only user-visible install"
   sufficient** (a codex-supervised Node sidecar already satisfies that)? — Decides
   whether the Rust server is on the zero-friction critical path. **The top decision.**
2. **a vs b vs hybrid** — recommend **hybrid/transport-swap (D-001)**: app transport
   may change (pivot allows it) but **wire schemas stay stable**.
3. **Compatibility scope** — which deployed clients must keep working: only the
   maintainer's BOOX tablets (force-updatable via App Distribution), or also
   existing iOS/Android/web/desktop installs + happy-cli-first Node-daemon users?
   (Narrow ⇒ transport swap is safe; broad ⇒ dual-stack migration required.)
4. **Single-per-machine ownership** — when both happy-cli and raw codex are
   installed, who owns the machine's session plane + tunnel (shared / mutual-
   exclusion / takeover / two identities)? Split-brain risk.
5. **Phase-4 app discovery** — file its own brainstorm now, or accept local-first-
   only for v1?

## Open questions for synthesis / planning

- Exact mandatory route groups + DB tables for local-first v1 (vs the spike's
  ~8-group / ~7-table superset, vs a reduced pair/account/session/machine surface).
- Version-skew governance across `happy-wire` (TS) ↔ `codex-happy` Rust serde mirror
  ↔ Rust server ↔ app after independent edits.
- SQLite from day one (durable) vs in-memory with an append-only migration path.
- Where the protocol boundary lives so future upstream merges hit only
  `packages/happy-app` adapters, not `codex-happy` server internals.
