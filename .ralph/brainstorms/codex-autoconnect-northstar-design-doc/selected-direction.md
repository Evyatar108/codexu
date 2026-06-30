---
overviewTaskId: codex-autoconnect-northstar-design-doc
title: "North-star: Happy remote-control of codex via the app-server — two planes, pluggable transports"
status: brainstorm
recommendedDirection: "D-001"
generatedBy: "/brainstorm-with-ralph"
date: 2026-06-29
researchOnly: true
sources:
  - codex/codex-rs-overlay/codex-happy/src/{lib,attach,inbound,mapping,session,remote_on,daemon_supervisor}.rs
  - codex/external/repos/codex-patched/codex-rs/core/src/{session/inject.rs,codex_thread.rs}
  - codex/external/repos/codex-patched/codex-rs/app-server/src/{message_processor.rs,request_processors/turn_processor.rs}
  - codex/external/repos/codex-patched/codex-rs/tui/src/app.rs
  - plans/agent-comms-design.md
  - .ralph/jobs/codex-native-orchestration-crews-replacement-feasibility/plan.md
  - .ralph/jobs/remote-connectivity-single-user-public-evyatar-server/plan.md
---

# North-star: Happy remote-control of codex via the app-server

> **Recommended direction: D-001 — Two planes + pluggable transports.**
> The codex **app-server v2 request surface is the universal CONTROL plane**;
> the **per-daemon embedded happy-server is the universal SESSION plane**;
> transports (loopback / Dev Tunnels / Cloudflare public / future LAN) are
> **pluggable carriers** of the same protocol, secured by **one
> `@slopus/happy-wire` app-layer contract**. The Happy app, the crews
> daemon-inject (crews-replacement P2), and the public `evyatar.dev` endpoint
> are **three consumers of the same two planes — not three separate features.**

This is a research-only design doc. No code was changed. File:line citations
are to the read-only state of the tree on 2026-06-29.

---

## 0 · TL;DR

There is already a working spine for "Happy app drives a remote codex agent
end-to-end": codex ships a **native Rust Happy client** (`codex-happy` overlay
crate) that, when `Feature::RemoteSession` is on, tees every in-process
`AppServerEvent` to a Happy session (outbound) and drives the live codex turn
from mobile via the **same `AppServerRequestHandle` the TUI uses** (inbound).
The mobile→codex control vocabulary — `turn/start` (idle), `turn/steer`
(running), `turn/interrupt`, exec/patch approvals — is **already implemented**
in `codex-happy/src/inbound.rs`.

The north-star is to recognize that this exact spine is **also** what the two
adjacent in-flight workstreams need:

- **crews-replacement P2** wants a happy-cli daemon to inject mail into a
  native codex member (RUNNING ⇒ steer, IDLE ⇒ wake). That is *literally the
  same two app-server requests* the mobile path already drives.
- **single-user public server** wants the operator's phone to reach their own
  machine's session plane off-LAN. That is *another transport* in front of the
  *same per-daemon embedded happy-server* the native client already connects to.

So the unifying move is not to build three things — it is to **name the two
planes, make the transport pluggable, and define the app-layer crypto once**,
then let all three land as additive drivers/transports.

```
                       ┌──────────────────────── consumers ───────────────────────┐
   Happy mobile app    │   crews daemon-inject (P2)   │   public evyatar.dev edge  │
        │              │            │                 │            │               │
        ▼ (session)    │            ▼ (control)        │            ▼ (transport)    │
 ┌──────────────────────────────────────────────────────────────────────────────┐
 │ TRANSPORT plane (pluggable):  loopback · Dev Tunnels · Cloudflare public · LAN │
 └──────────────────────────────────────────────────────────────────────────────┘
        │                                   ▲ app-layer auth = ONE happy-wire contract
        ▼                                   │
 ┌───────────────────────────┐      ┌───────────────────────────────────────────┐
 │ SESSION plane             │◀────▶│ CONTROL plane (codex app-server v2)         │
 │ per-daemon EMBEDDED       │      │ turn/start · turn/steer · turn/interrupt ·  │
 │ happy-server              │      │ thread/inject_items · *RequestApproval      │
 │ /v1/updates /v3 /pair/*   │      │  driven in-process by codex-happy           │
 │ /agent-comms/ingest       │      │  (attach.rs ⇄ inbound.rs ⇄ mapping.rs)      │
 └───────────────────────────┘      └───────────────────────────────────────────┘
              ▲                                   ▲
              │ native client = codex-happy/session.rs (E2EE, /v1/updates)
              └── codex always attaches LOOPBACK (127.0.0.1:<tunnelPort>);
                  the daemon owns the public/tunnel edge, never codex.
```

---

## 1 · The two planes, grounded in source

### 1.1 CONTROL plane — the codex app-server v2 request surface

Every way to *drive* a codex agent already exists as an app-server v2
`ClientRequest`, dispatched in `app-server/src/message_processor.rs`:

| Request | Dispatch | Effect | Idle behavior |
|---|---|---|---|
| `turn/start` | `message_processor.rs:1284` → `turn_processor.turn_start` | Start a turn from input | **Starts a fresh turn** (the idle-wake path the mobile client uses) |
| `turn/steer` | `message_processor.rs:1297` → `turn_processor.turn_steer` (`turn_processor.rs:137,810`) → `thread.steer_input` | Steer the active turn | **Errors `NoActiveTurn`** when idle (`turn_processor.rs:857`) |
| `thread/inject_items` | `message_processor.rs:1294` → `turn_processor.thread_inject_items` (`turn_processor.rs:118,764`) → `thread.inject_response_items` | Record model-visible items | **RECORD-only, does NOT start a turn** (`codex_thread.rs:456` → `inject_no_new_turn`, `inject.rs:143`) |
| `turn/interrupt` | (interrupt active turn) | Cancel active turn | n/a |
| `item/commandExecution/requestApproval`, `item/fileChange/requestApproval` (+ legacy exec/patch) | server→client `ServerRequest` | Approval routed to the driver | resolved with the driver's decision |

**The driver that translates Happy ⇄ app-server is already written** — the
`codex-happy` overlay:

- **Outbound** (`mapping.rs:52` `map_event`): codex `AppServerEvent`s →
  Happy session envelopes (turn lifecycle + final items, `CodexBash`/`CodexPatch`
  tool calls). Mirrors happy-cli's raw-notification path; streaming deltas
  dropped on purpose.
- **Inbound** (`inbound.rs`): pure, IO-free control decisions. `ControlState`
  locks the **primary (root) thread** and tracks the active turn from the
  observed event stream; `plan_turn` (`inbound.rs`) maps a mobile message to
  `TurnAction::Start` (idle) or `TurnAction::Steer` (active); approvals are
  extracted (`approval_from`) and resolved (`resolve_payload`); abort →
  `plan_interrupt`.
- **Orchestration** (`attach.rs:1038` `maybe_attach`): returns the
  `UnboundedSender<AppServerEvent>` the TUI stores in `happy_tap`, and is handed
  the **cloneable `AppServerRequestHandle` — the same boundary the TUI uses** —
  so inbound control drives the live, in-process codex session. 8s
  `CONNECT_BUDGET`, background task, silent vanilla fallback.

**The seam into codex is a single, bounded SANDBOX PATCH** in
`tui/src/app.rs`: one `happy_tap: Option<UnboundedSender<AppServerEvent>>`
field (`app.rs:597`), gated by `Feature::RemoteSession` (`app.rs:1034`;
feature is Experimental / default-off, key `remote_session`,
`features/src/lib.rs:1071-1078`), teed before local handling (`app.rs:1243`).
Everything else lives in the fork-exclusive `codex-rs-overlay/codex-happy/`
crate (zero upstream conflict surface).

**The one control-plane gap (the load-bearing decision, see M1):** there is a
third "wake" semantic — `CodexThread::try_start_turn_if_idle`
(`codex_thread.rs:318`, **already `pub`**) → `Session::try_start_turn_if_idle`
(`inject.rs:45`, `pub(crate)`). It starts an *extension-initiated idle* turn
**only if** no user/client work is queued and the session is not in Plan mode.
It is the "polite" idle-wake. But **no app-server `ClientRequest` calls it** —
`thread/inject_items` deliberately maps to the record-only path instead. So
remote idle-wake today is `turn/start` (blunt: always starts), and the gated
variant is reachable in-process but not over the app-server.

### 1.2 SESSION plane — the per-daemon embedded happy-server

Per `AGENTS.md` ("Server architecture — distributed per-daemon, NO central
server") and `agent-comms-design.md §5.2`: **each machine runs a daemon that
EMBEDS its own happy-server.** That embedded server IS the session plane the
Happy app pairs and syncs against — `/v1/updates` (Socket.IO),
`/v3/...` (E2EE messages + acks), `/pair/*`, and the agent-comms
`/agent-comms/ingest` route. It is an **endpoint, not a broker** (no
cross-tenant fan-out; agent-comms §5.2 explicitly rejects a central broker).

The **native client** of that plane is `codex-happy/src/session.rs`: it
connects to the **local tunnel listener** at
`http://127.0.0.1:<tunnelPort>/v1/updates/` (trailing slash required),
classifies seq-ordered updates, backfills over `/v3` on a seq gap, and — unlike
happy-cli, which posts plaintext to its co-located server — **encrypts on send
/ decrypts on receive** because it talks to happy-server directly
(`session.rs` "Encryption boundary" doc).

**Critical invariant for the whole north-star:** codex **always attaches
loopback**. `daemon_supervisor.rs` readiness (F-008) is "`machine.json` present
with a valid `tunnelPort` AND a TCP probe of `127.0.0.1:<tunnelPort>` succeeds";
the loopback/`X-Loopback-Capability` listener is happy-cli-internal and not
used to gate codex. The daemon — never codex — owns any public/tunnel edge.
This is why the public-server plan can keep codex's `/remote on` unchanged.

### 1.3 The third leg — transports are already pluggable in spirit

`daemon_supervisor.rs` is explicitly **server-agnostic**: Phase 1 drives the
Node `happy daemon start-sync`; Phase 2's embedded Rust server will implement
the **same `SessionPlaneSupervisor` trait**, so `/remote on` callers don't
change when the server language flips. Ownership rule (F-005):
**start-if-absent + health-probe only**; a daemon already serving other
sessions is attached-to, never stopped/restarted.

On the happy-cli side, the daemon already has a `DaemonTunnelProvider`
abstraction and a `dualListenerBinding` that picks auth per listener (per the
single-user plan's research). That is the natural extension point for
pluggable transports.

---

## 2 · How the three consumers fold into the two planes

### 2.1 Happy mobile app — the reference consumer (mostly shipped)

End-to-end path, all source-confirmed:

1. `/remote on` (or `Feature::RemoteSession` at startup) → `attach.rs:maybe_attach`
   gets `AppServerRequestHandle` + returns the `happy_tap` sender.
2. Self-onboard if needed: `remote_on.rs::run_self_onboard` mints a `~/.happy`
   identity via GitHub device flow (no happy-cli at runtime).
3. Daemon readiness via `daemon_supervisor.rs` (loopback tunnel listener).
4. Outbound: TUI tees `AppServerEvent` → `mapping.rs::map_event` → E2EE Happy
   envelopes over `session.rs` `/v1/updates`+`/v3` → phone transcript.
5. Inbound: phone message → `session.rs` inbound → `inbound.rs::plan_turn` →
   `turn/start`/`turn/steer` on the live thread via `AppServerRequestHandle`;
   approvals routed + resolved; abort → `turn/interrupt`.

**Remaining work is hardening + the transport leg (M3/M4), not new architecture.**

### 2.2 crews-replacement P2 — a SECOND driver of the same control plane

The crews plan wants a happy-cli daemon to inject mail into native codex
members: RUNNING ⇒ steer, IDLE ⇒ wake, sole-own the mailbox, and read each
member's `AppServerEvent` stream for kind-tag/identity/crash (not stdout
scraping). Its **US-000 gate** is exactly the M1 control-verb decision below.

**Source correction the north-star bakes in:** the crews plan's framing of
"reuse `thread/inject_items` + `turn/steer`" is half-right. `thread/inject_items`
is **record-only** (`codex_thread.rs:456` → `inject_no_new_turn`) and
`turn/steer` **errors when idle** (`turn_processor.rs:857`). To make a member
**act** on injected mail, the IDLE path is `turn/start` (or a new gated
`turn/startIfIdle`), exactly as `inbound.rs::plan_turn` already chooses
`Start` vs `Steer`. So:

- The crews daemon and the mobile app are **the same driver pattern**: choose
  `turn/start` (idle) vs `turn/steer` (running) against the primary thread.
- `thread/inject_items` is the right verb only for "drop a fact into context
  **without** forcing a turn."
- This is why the crews driver can be **near-zero codex patch** — it reuses the
  control plane the overlay already exercises.

### 2.3 Public single-user server — another TRANSPORT for the session plane

The public plan exposes the operator's **own** embedded per-daemon happy-server
at `https://happy.evyatar.dev` via an outbound-only **Cloudflare named tunnel**
(because corp policy blocks Dev Tunnels), with a from-scratch **fail-closed
Ed25519 device verifier** over every route + the Socket.IO handshake +
`/pair/complete`, plus a **mandatory Cloudflare Access service-token edge**
(defense-in-depth). It introduces `auth:"public"`, a
`CloudflareTunnelDaemonProvider`, and app-side enrollment.

In north-star terms this is **purely a transport + app-auth addition**:

- Session plane and control plane are unchanged.
- codex `/remote on` stays a **local 127.0.0.1 attach** (the plan's codex story
  is a no-op gate that only observes public mode through the CLI/server
  contract) — consistent with §1.2's loopback invariant.
- The device-verifier signed-request envelope is the **same family** as
  agent-comms Scope A's Ed25519+sealed envelope — which is why M2 unifies them
  into one `@slopus/happy-wire` contract.

### 2.4 Cross-machine agent-comms (Scope A) — same planes, machine↔machine

`agent-comms-design.md §5` already specifies machine↔machine over Dev Tunnels:
ingest on the embedded happy-server (`/agent-comms/ingest`), two-layer auth
(gateway connect-token, stripped before backend, + backend-observable Ed25519
signature over the canonical envelope + X25519-sealed body, TOFU peer-pinning).
This is the **transport-plane sibling** of the public endpoint — same session
plane, same crypto primitives, different rendezvous/edge.

---

## 3 · The unifying architecture (D-001)

**Declare and build to three abstractions, then everything else is additive:**

1. **Control plane = app-server v2 requests, driven by a `RemoteControlDriver`.**
   The native `codex-happy` overlay is the reference driver (in-process,
   `AppServerRequestHandle`). The crews daemon is a second driver (over the
   loopback app-server ws). Both speak the same vocabulary: `turn/start`
   (idle) · `turn/steer` (running) · `turn/interrupt` · `thread/inject_items`
   (record) · approvals. **No new upstream surface unless M1 chooses the gated
   wake verb.**

2. **Session plane = the per-daemon embedded happy-server, fronted by a
   `SessionPlaneSupervisor` (codex side) + `DaemonTunnelProvider` (daemon
   side).** codex is always a loopback client; the daemon owns the edge.

3. **One app-layer security contract in `@slopus/happy-wire`:** the canonical
   signed-request / envelope (nonce, method/path/body-hash canonicalization,
   Ed25519 detached signature, X25519 sealed body, TOFU pinning, deterministic
   cross-runtime test vectors), consumed by server / app / cli / codex-happy.
   The public device-verifier and the agent-comms peer-auth are two **policies
   over one contract**, not two stacks.

This satisfies the standing constraints on record: **no central server**
(per-daemon embedded happy-server is the hub), **pluggable transport** (Dev
Tunnels OR Cloudflare OR LAN behind `DaemonTunnelProvider`), **fork-is-ours**
(extend codex via the overlay + a single bounded TUI seam), and **codex tenant
#1** (the heavy lifting stays in the overlay; the only candidate upstream patch
is the optional M1 wake verb).

---

## 4 · Sequenced milestone roadmap

Dependency graph (→ = "must precede"):

```
M0 (shipped) ─┬─▶ M1 ─▶ M5 (crews driver)
              └─▶ M2 ─┬─▶ M3 ─┬─▶ M4 (public transport)
                      │       └─▶ M5 (optional)
                      ├─▶ M4
                      └─▶ M6 (agent-comms Scope A)
M3/M4 (stable) ─────────▶ M7 (Phase-2 Rust server, long-horizon)
```

### M0 — Foundations (already shipped; the baseline)
The native `codex-happy` overlay (encryption/auth/api/onboard/wire/
session_state/session/mapping/inbound/attach/remote_on/daemon_supervisor), the
`Feature::RemoteSession` gate + single `happy_tap` TUI seam + inbound
`AppServerRequestHandle`, and the per-daemon embedded happy-server + agent-comms
Scope A/B/C skeleton. (Shipped under `codex-raw-session-happy-daemon-autoconnect`
per `codex-happy/src/lib.rs`.) **This milestone is the proof D-001 is real, not
aspirational.**

### M1 — Control-verb decision (BLOCKING; = crews-replacement US-000)
Settle the idle-wake verb for the control plane:
- **Option A (reuse, zero codex patch):** IDLE → `turn/start`, RUNNING →
  `turn/steer` (exactly `inbound.rs::plan_turn`). Ship the crews driver and the
  mobile path on this.
- **Option B (gated wake, small upstream patch):** add a v2
  `turn/startIfIdle` (or `thread/wakeIfIdle`) request that delegates to the
  already-`pub` `CodexThread::try_start_turn_if_idle` (`codex_thread.rs:318`),
  giving "don't trample queued user work / Plan mode" semantics. Adds an
  app-server `ClientRequest` + processor + schema (one bounded SANDBOX PATCH;
  must clear the codex overlay-first gates).
Decide per-consumer: mobile messages are user-intent (Option A is fine);
crews-mail may want Option B's politeness. **Resolve before M5.**
Depends on: M0.

### M2 — Unify the app-layer security contract in `@slopus/happy-wire`
Define ONE signed-request/envelope schema + canonicalization + deterministic
test vectors. Reconcile the public device-verifier and the agent-comms Scope A
peer-auth (both Ed25519 + sealed body) as two policies over the one contract,
or prove they must stay siblings (see Open Question 2). Consumed by
server/app/cli/codex-happy.
Depends on: M0. Informs: M3, M4, M5(crypto), M6.

### M3 — Pluggable transport abstraction
Generalize `DaemonTunnelProvider` / `dualListenerBinding` (daemon) and keep
`SessionPlaneSupervisor` (codex) so transports are interchangeable: loopback ·
Dev Tunnels · Cloudflare public · future LAN/known-devices. **Preserve the
codex-always-loopback invariant** (`daemon_supervisor.rs` attaches to
`127.0.0.1:<tunnelPort>` regardless of transport).
Depends on: M2.

### M4 — Public single-user transport (evyatar.dev)
Ship `auth:"public"` server mode + fail-closed device verifier (over all routes
+ ws/polling handshake + `/pair/complete`) + mandatory Cloudflare Access edge +
`CloudflareTunnelDaemonProvider` + app enrollment/header plumbing, per
`.ralph/jobs/remote-connectivity-single-user-public-evyatar-server/plan.md`.
codex `/remote on` unchanged (local attach).
Depends on: M2 (contract) + M3 (transport abstraction).

### M5 — crews daemon-inject driver (hook-free P2)
The happy-cli daemon becomes a SECOND `RemoteControlDriver` over the loopback
app-server: IDLE→`turn/start` (or M1 Option-B verb), RUNNING→`turn/steer`;
sole-own the mailbox (kill the EPERM/`LockTimeout` locks); read each member's
`AppServerEvent` stream for kind-tag/identity/crash; drop the crews Node hooks;
pilot ONE fan-out. Fallback D-003 (file-ownership-only, keep hooks) if the
SPOF/patch cost isn't worth zero-hooks. Per
`.ralph/jobs/codex-native-orchestration-crews-replacement-feasibility/plan.md`.
Depends on: M1 (+ optionally M3).

### M6 — Cross-machine agent-comms Scope A, live
Two daemons over Dev Tunnels using the M2 contract; `/agent-comms/ingest`
verification chain; remote-spawn approval gate. (Skeleton exists from M0.)
Depends on: M2.

### M7 — Phase-2 embedded Rust session server (long-horizon, optional)
Replace the Node happy-server with the embedded Rust server implementing the
same `SessionPlaneSupervisor` trait, letting `/remote on` run fully Node-free
and letting happy-cli shrink. Strictly optional to the north-star; unblocks the
"thin happy-cli / fully-native" end state.
Depends on: M3/M4 stable.

**Suggested ship order:** M0 (done) → M1 → M2 → M3 → {M4, M5, M6 in parallel by
disjoint surface} → M7. M1 and M2 are the two true bottlenecks; everything
downstream is additive.

---

## 5 · Conflict-surface & constraint check

- **codex tenant #1 (minimize upstream-canonical conflict surface):** D-001
  keeps all logic in the `codex-rs-overlay/codex-happy/` crate + one bounded
  `tui/src/app.rs` seam (already shipped). The ONLY candidate new upstream patch
  is M1 Option B (a gated `turn/startIfIdle` request) — and only if chosen.
- **No central server:** every consumer terminates at the *per-daemon embedded*
  happy-server; no broker (agent-comms §5.2).
- **Pluggable transport:** M3 makes Dev Tunnels / Cloudflare / LAN
  interchangeable behind `DaemonTunnelProvider`; codex stays loopback.
- **The fork is ours to extend:** M1 Option B is a normal overlay-first move if
  the gated wake semantics prove worth a 1–3-line app-server delegation.

---

## 6 · Assumptions flagged (could not fully verify read-only)

1. **happy-cli daemon internals** (`controlServer.ts`, `dualListenerBinding.ts`,
   `mailbox.ts` writer inventory) were taken from the two adjacent plans'
   research sections, not re-read directly in this pass. The transport-provider
   and sole-writer claims should be re-confirmed against source during M3/M5.
2. **`turn/start` on a freshly-spawned member presupposes a started primary
   thread.** `inbound.rs` buffers mobile turns until the primary thread id is
   observed (`MAX_BUFFERED_TURNS`), implying a thread must exist before a turn
   can start/steer. For crews mail injected before the member's first action,
   confirm the thread-bootstrap timing (M1/M5).
3. **The public plan's "codex `/remote on` stays local 127.0.0.1" claim** is
   taken at face value from its codex-gate story; consistent with
   `daemon_supervisor.rs` but not independently exercised here.
4. **Two Ed25519 schemes unify into one contract (M2)** is the working
   hypothesis; device↔server vs machine↔machine key roles differ (agent-comms
   §5.5 forbids `machineKey` for peer auth), so they may stay siblings sharing
   only canonicalization — to be settled in M2 (Open Question 2).

---

## 7 · Open questions (top 3)

1. **Idle-wake verb (the single load-bearing seam, = crews US-000):** reuse
   `turn/start` (works today via `inbound.rs::plan_turn`, but bypasses
   `try_start_turn_if_idle`'s gating for queued user work / Plan mode) vs add a
   gated app-server `turn/startIfIdle` delegating to the already-`pub`
   `CodexThread::try_start_turn_if_idle` (`codex_thread.rs:318`)? What semantic
   does mobile-message want vs crews-mail?
2. **One crypto contract or two siblings (M2):** can the public device-verifier
   envelope (device↔own-server, Ed25519 device keys + Cloudflare Access) and the
   agent-comms Scope A peer-auth envelope (machine↔machine, Ed25519 `server-key`
   + X25519 `ecdh-key`, explicitly NOT `machineKey`, agent-comms §5.5) truly
   unify into one `@slopus/happy-wire` signed-request schema, or only share
   canonicalization/nonce/body-hash?
3. **Phase-2 Rust server timing (M7):** is "native `codex-happy` client + Node
   embedded happy-server" the steady state, or is the embedded Rust server a
   north-star prerequisite (it is what lets `/remote on` run fully Node-free and
   lets happy-cli shrink)? Secondary: is **codex-only** (mono-engine) acceptable
   for the crews driver, or is a cross-engine driver abstraction in scope?
