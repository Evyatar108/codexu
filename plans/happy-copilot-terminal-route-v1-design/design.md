# `copilot-terminal-route-v1` — source-verified design

> Task: `happy-copilot-terminal-route-v1-design` (scope: `happy-cli`).
> This document is **plan/design only**. No runtime code is changed by this task.
> Dependency: `happy-copilot-native-local-controller-backend` (M1a — the
> spawn-only, headless, read-only Copilot mirror that this route extends).
> Parent context: it is the **P0 prerequisite** named in
> `plans/happy-evcopilot-onedrive-launcher-integration/plan.md` §2.2 (lines
> 62‑87) and §14 P0 (lines 988‑1006). The launcher may not flip
> ordinary‑command routing on until a Happy manifest advertises a
> **separately tested** `copilot-terminal-route-v1` capability; a
> `happy copilot --help` smoke does not satisfy that gate.

**All runtime claims below carry `file:line` citations.** Two source trees are
cited:

- **Copilot runtime** — the authoritative Copilot CLI/agent source at
  `C:\efforts\copilot-agent-runtime` (paths shown as `src/...`). *This is the
  fork we treat as ours; a thin extension to it is first‑class.*
- **Happy CLI (M1a)** — `packages/happy-cli/src/agent/copilot/...` in this
  repo (the read‑only mirror we are extending).

---

## Rev. 2 — corrections from independent source review

An independent source review confirmed the **Option B** recommendation but
found five items that were wrong or under‑specified in Rev. 1. All are
re‑verified against source and the affected sections below are corrected. This
box is the summary; the detail lives in the cited sections.

- **B1 (token — Rev. 1 was wrong).** Rev. 1 claimed the interactive embedded
  server sources `COPILOT_CONNECTION_TOKEN` "the same way." It does **not**.
  `EmbeddedServerOptions` has **no** token field
  (`src/cli/embeddedServer.ts:31‑64`) and the inner `SDKServer` is constructed
  **without** `connectionToken` (`src/cli/embeddedServer.ts:101‑119`). The env
  var is read **only** on the top‑level managed/headless bootstrap
  (`src/core/sdkServer.ts:5840`), not on the interactive path. So today the
  embedded listener is **anonymous** (`this.options.connectionToken` is
  undefined → the Rust TCP gate is off and the "accepts from any client"
  warning fires, `src/core/sdkServer.ts:1670‑1700`), and the published
  `ui-server` entry carries `token: null` — which M1a's validator would reject.
  **Fix (real, multi‑file):** add `connectionToken?: string` to
  `EmbeddedServerOptions`; thread it into the inner `SDKServer`
  (`connectionToken` option, `src/core/sdkServer.ts:236`) so the native gate
  enforces it *and* the publisher (which captures the token from its caller and
  never re‑reads env, `src/core/remoteRegistry/registryPublisher.ts:30‑33`)
  writes a real token; generate/read the token at the interactive launch site.
  The seam therefore touches `embeddedServer.ts` (and the launch site), **not
  just one env toggle**. See §2.8, §4.1, §4.4, T1, F‑3.
- **B2 (foreground‑refusal guard — Rev. 1 over‑claimed).** The
  `registerSession` refusal of a `local-attach` session is **gated on
  `isAgentsTabEnabled`** (`src/cli/embeddedServer.ts:264‑268`: the defense
  "only activates when the feature flag is on"). Since this design keeps
  Agents‑tab **off**, that guard is **inactive** and cannot be cited as the
  ownership‑safety mechanism. Reframed: the v1 invariant is a **Happy‑side
  discipline** — the read‑only attach connects, reads, and **never** calls any
  foreground‑registration path (`session.setForeground`, which would fire the
  TUI's `onForegroundSessionChangeCallback`,
  `src/core/sdkServer.ts:1465‑1472`), nor `session.send`/`session.abort`. See
  §2.6, §4.1, §4.4, H‑8.
- **N1 (P4 overlap — Rev. 1 under‑stated).** Rev. 1 only checked the P0/P4
  co‑edit constraint against *Copilot* controller files and called T2
  "parallelizable." But P4 (parent plan lines 1051‑1064) **rewrites the same
  Happy files** T2/T3 touch — `managedServer.ts` spawn/validator (line 1056‑1057)
  and `runCopilotMirror.ts` provenance/ownership (line 1058). So **T2/T3 must
  rebase after P4**, not parallelize. See §4.3, §8.
- **S1 (B‑env synthesizes, not flips).** Ordinary interactive passes
  `embeddedServer: options.uiServer ? {…} : undefined`
  (`src/cli/index.ts:4275‑4282`) — with `--ui-server` absent the value is
  **`undefined`**. B‑env must **synthesize the whole config object**
  (`{ enabled, port, host, connectionToken }`), not merely flip an `enabled`
  boolean. See §2.6, §4.1.
- **S2 (ui-server validator contract made explicit).** v1 `ui-server` entries
  have the **`kind` field absent on disk**, normalized to `"ui-server"` on read
  (`src/core/remoteRegistry/serverRegistry.ts:97‑99, 108‑111, 156‑161`). Happy
  must accept `schemaVersion === 1` with **omitted kind** (not require
  `kind === "ui-server"` on disk, which would reject every real v1 entry) and
  **poll for a populated `sessionId`** (published on first `setSession()`). See
  §2.7, §4.1, H‑1.

---

## Rev. 3 — final correction from independent source review

A second independent review confirmed **Option B** again but found one more
load‑bearing error that Rev. 1/2 carried: **the interactive `--ui-server` path
does not wire a `RegistryPublisher` at all**, so it publishes **no** discovery
entry today, and Rev. 2's B1 fix was insufficient. Re‑verified against source
and corrected in §2.6, §2.7, §2.8, §4.1, §4.3, §4.4, §4.5, §5, T1, F‑1, F‑3,
F‑6, and §10.

- **N2 (the ui-server publisher does not exist — must be wired by the seam).**
  Rev. 1/2 cited `RegistryPublisher`'s class docstring — *"Two callers use
  this: `EmbeddedServer` for `--ui-server` … `startServerMode` for
  `--server --managed-server`"* (`src/core/remoteRegistry/registryPublisher.ts:10‑20`)
  — as if the ui-server caller were implemented. It is **not**. A grep of the
  whole non‑test tree finds exactly **one** `new RegistryPublisher`, in the
  **managed** bootstrap (`src/core/sdkServer.ts:6047`), and the only
  `.setSession(...)` caller is that same block (`sdkServer.ts:6080`).
  `EmbeddedServer.start()` merely calls `this.server.start()`
  (`src/cli/embeddedServer.ts:152‑163`); `interactiveMode.ts` only *reads* the
  registry dir for the (gated‑off) `AgentRegistryWatcher`
  (`interactiveMode.ts:75, 678‑690`) and never constructs a publisher. The
  docstring describes the *intended* contract, not the shipped wiring.
- **N2 corollary — two token sinks, and threading the SDKServer token is not
  enough.** Adding `connectionToken` to the inner `SDKServer` (Rev. 2 B1)
  authenticates the **TCP listener** but populates **no** registry entry,
  because there is no publisher to write one. `RegistryPublisher` takes its
  **own** `connectionToken` constructor arg and stores it verbatim in the
  `<pid>.json` entry (`registryPublisher.ts:53‑66, 79‑90, 83‑84`). The managed
  path proves the pattern: the **same** token value is threaded to **both** the
  `SDKServer` (`sdkServer.ts:5889`, listener auth) **and** the
  `RegistryPublisher` (`sdkServer.ts:6050`, entry token). The ui-server seam
  must replicate both sinks.
- **N2 fix — wire the publisher lifecycle, modeled on the managed block.** The
  seam must construct `new RegistryPublisher({ kind: "ui-server", host,
  connectionToken, pid })`, register its `stop()` cleanup **before** `start()`,
  call `start(port, startedAt)`, call `setSession(foregroundSession)` on the
  initial foreground **and every foreground transition**, install a
  `REGISTRY_HEARTBEAT_INTERVAL_MS` heartbeat (`unref`'d), and `stop()` on
  shutdown — exactly the shape of the managed lifecycle at
  `sdkServer.ts:6039‑6091`. The natural owner is `EmbeddedServer` (it already
  tracks the foreground via `registerSession` and already registers a shutdown
  callback, `embeddedServer.ts:143‑145, 241‑278`), gated so it runs only when
  the TCP listener is actually started. No duplicate/stale entry: the filename
  is `<pid>.json` (one publisher per process), `stop()` unconditionally unlinks
  and is shutdown‑flag‑guarded (`registryPublisher.ts:249‑266, 25‑27`), and a
  crash without `stop()` is swept by the ~5‑min stale‑mtime backstop once
  heartbeats cease (`registryPublisher.ts:45‑49`). See §2.8, §4.1, §4.3, T1,
  F‑1, F‑6.

**Net effect:** the recommendation is unchanged (Option B, read‑mirror first),
but the fork seam is honestly **larger than Rev. 2 stated** — it adds a full
`RegistryPublisher` lifecycle to the interactive path, not just a token field.
It remains bounded (it re‑uses the existing, tested publisher class and copies
the managed block's proven lifecycle), and Option A's cost is still far higher.

---

## 0. Executive summary and recommendation

The P0 contract is a single sentence with teeth: *preserve the **ordinary
Copilot terminal experience** — original argv and exit codes, streaming
rendering, prompt input, tool approvals/elicitation, Ctrl+C/cancellation,
reconnect/resume, and exactly one target/session — while Happy mirrors the
same session to its per‑daemon embedded happy‑server* (§2.2 lines 84‑86; P0
lines 996‑998).

I evaluated the two routes the parent plan names (§2.2 lines 80‑82):

- **Option A — Happy‑owned interactive/TUI client for the *managed* target.**
  Happy keeps M1a's spawn of a **headless** `copilot --server
  --managed-server` (no TUI) and re‑implements the entire terminal experience
  itself, driving the session over the native JSON‑RPC.
- **Option B — a minimal Copilot fork seam that mirrors/controls the *real*
  ordinary interactive terminal session.** The user runs the genuine `copilot`
  TUI unchanged; Happy's daemon side‑attaches to that session's embedded
  JSON‑RPC server and mirrors it to the phone.

**Recommendation: Option B**, staged so the design lands now and
implementation begins after P4 (P0 sequencing, lines 993‑995). The evidence is
decisive and, crucially, it is *not* a rubber‑stamp of the parent plan's
phrasing:

1. **Only Option B can satisfy the dominant requirement.** "Preserve the
   ordinary Copilot terminal experience" is, by construction, satisfied when
   the terminal *is* the ordinary Copilot TUI. Option A does not preserve that
   experience; it **replaces** it with a Happy re‑implementation of Copilot's
   render stack, input box, approval UI, Ctrl+C semantics, exit‑code
   derivation, and — the hardest part — Copilot's *argv grammar*. Every one of
   those is a perpetual fidelity tax that drifts every Copilot release.
2. **The Option B seam is genuinely thin** (though not a one‑line env toggle —
   see Rev. 2 B1 and Rev. 3 N2), contradicting the natural assumption that
   "mirror a live TUI" requires deep forking. Copilot already ships almost the
   entire attach surface: an interactive‑TUI‑plus‑embedded‑JSON‑RPC mode
   (`--ui-server`), a discovery registry **format + a reusable
   `RegistryPublisher` class**, and a **complete in‑product controller**
   (`LocalRpcSession` + the Agents tab) that attaches to such a session, renders
   it, and answers its approvals/elicitation. The one piece that is **not**
   wired is a `RegistryPublisher` on the interactive path (Rev. 3 N2). The fork
   change is *"let the ordinary interactive launch expose its embedded server on
   loopback behind a token **and publish a discovery entry**, without changing
   anything the user sees"* — concretely a small multi‑file change: synthesize
   the embedded‑server config at the launch site, thread a `connectionToken`
   through `EmbeddedServerOptions` into the inner `SDKServer`, **and wire a
   `ui-server` `RegistryPublisher` lifecycle** copied from the managed block
   (§2.8, §4.1).
3. **Option A's genuine advantages are real but off‑target here.** Zero fork
   change, perfectly symmetric mirroring (Happy owns both ends), and the
   simplest one‑session‑ownership story. Those matter for a *Happy‑native
   cross‑device UI where the phone is co‑equal or primary and byte‑fidelity to
   Copilot's terminal is a non‑goal.* That is explicitly **not** this task.

**Recommended shape (v1, read‑mirror first):** ordinary `copilot <args>` runs
the real interactive TUI; a **narrow fork env‑seam** (`COPILOT_HAPPY_EMBED=1`
+ a generated loopback token) makes that interactive process start its
embedded server (the listener already exists) **and wire a `ui-server`
discovery‑registry publisher (which does not exist today, Rev. 3 N2)**; Happy's
daemon attaches **read‑only** (observe + mirror to the phone, human at the
terminal still owns approvals) and projects events to the embedded
happy‑server exactly as M1a already does. Phone‑originated input and
phone‑answered approvals are **additive later milestones**, not part of the v1
preservation contract.

The remainder of this document is the evidence, the conflict surface, the
security/ownership/failure semantics for both options, the argv policy P0
requires (lines 1001‑1002), a test matrix, staged tasks, and the operator
decisions that remain open.

---

## 1. Problem and gap restatement

M1a (the completed dependency) is a **spawn‑only, headless, read‑only
mirror** (§2.2 line 64). Concretely, in Happy today:

- `spawnManagedTarget()` launches `copilot --server --port 0 --managed-server
  --session-idle-timeout 300` with a fresh per‑spawn connection token, then
  validates a `kind:"managed-server"` registry entry
  (`packages/happy-cli/src/agent/copilot/managedServer.ts:158‑200`). There is
  **no TUI** in that child (confirmed at
  `src/cli/sessions/spawnLiveTarget.ts:10‑14`: managed‑server "does NOT start a
  TUI; it bootstraps a headless SDKServer that publishes itself to the local
  discovery registry").
- The client is a pure‑TS, Content‑Length‑framed JSON‑RPC client that
  `connect`s, discovers the foreground session, resumes it with
  `disableResume:true`, and **reads** the event log; it projects only 10 final
  event types and drops everything else
  (`packages/happy-cli/src/agent/copilot/types.ts:11‑22`;
  `nativeLocalRpcClient.ts`; `eventProjection.ts`). Its posture is explicitly
  `mirror-read-only`.
- `happy copilot` accepts **no ordinary Copilot arguments**, and a
  production‑launched target is idle because only the test suite has a stimulus
  client (§2.2 lines 64‑66). Production steering was deferred to "M2" by the
  dependency's own plan (§2.2 lines 66‑68).

Therefore M1a **cannot truthfully replace the interactive `copilot ...`
experience** (§2.2 line 70). P0 requires us to choose and implement one **real
terminal contract** that preserves interactive input, output, ordinary args,
Ctrl+C, tools/approval, and exit codes *while Happy owns/mirrors the same
session* (P0 lines 996‑998), and to add the `copilot-terminal-route-v1`
capability **only after real external acceptance** — "an operator can complete
an ordinary interactive session through the cached Happy command with phone
mirroring; no test‑only stimulus client is required" (P0 lines 999‑1006).

---

## 2. Source‑verified architecture of the Copilot runtime

Both options sit on the same substrate. This section establishes it once, with
citations, so the option analyses can reference it.

### 2.1 One session abstraction, two front‑ends

Copilot has exactly one session/event‑log core (`LocalSessionManager` /
`Session`), fronted by either the **interactive TUI** or a **headless
JSON‑RPC server**. Mode is chosen in `src/cli/index.ts`:

- `--server` / `--headless` → headless JSON‑RPC (`isServerMode`,
  `src/cli/index.ts:1827`).
- `--managed-server` → under `--server`, bootstrap exactly one session; it is
  incompatible with `--ui-server`/`--stdio`/`-p`/`--connect`
  (`src/cli/index.ts:2389‑2408`).
- `--ui-server` → **"Enable TUI with embedded JSON‑RPC server"**
  (`src/cli/index.ts:1409`); this is the ordinary interactive path *plus* a
  server (details in §2.6).
- Otherwise → the ordinary interactive TUI via `runInteractiveMode(...)`
  (`src/cli/index.ts:~4220`, invoked with the `embeddedServer` option at
  `src/cli/index.ts:4275‑4282` — the `options.uiServer ? {…} : undefined`
  ternary, see §2.6 S1).

### 2.2 The managed‑server bootstrap (Option A's target)

`bootstrapManagedServerSession` creates **one** session via
`sessionManager.createSession(...)` — explicitly "the same surface a fresh
interactive `copilot` would use" (`src/core/sdkServer.ts:5955‑5959`) — registers
it as the SDKServer foreground, and publishes a `kind:"managed-server"`
registry entry through `RegistryPublisher` (`src/core/sdkServer.ts:6047`). The
connection token is sourced from `COPILOT_CONNECTION_TOKEN`
(`src/core/sdkServer.ts:5840‑5841`).

Crucially, the managed bootstrap has **no UI proxy** for
permissions/elicitation. `applyManagedServerPermissions`
(`src/core/sdkServer.ts:6133‑6172`) unconditionally sets
`approveAllReadPermissionRequests: true` (reads auto‑approved because a
`kind:"read"` prompt "crashes the Ink render", 6116‑6118), and — absent
`--yolo`/`--allow-all*` — any tool needing approval **auto‑denies** with
`denied-no-approval-rule-and-could-not-request-from-user`. The doc is explicit
that allow‑all flags are the sanctioned workaround only *"without a
permission‑event forwarder on the attached controller"*
(`src/core/sdkServer.ts:6097‑6100`) — i.e. **a controller that forwards
permissions makes the managed session interactively usable** (see §2.4).

Managed mode also arms an idle‑timeout that reaps the foreground session then
shuts the process (`managedSessionShutdown`,
`src/core/sdkServer.ts:5895‑5906`; M1a passes `--session-idle-timeout 300`).

### 2.3 The native RPC protocol surface

The wire protocol (`src/core/protocol/types.ts`) is JSON‑RPC 2.0, Content‑Length
framed over loopback TCP. The method and notification names are enumerated in
`ProtocolMethods` / `ProtocolNotifications`
(`src/core/protocol/types.ts:2374‑2408`). The load‑bearing methods for a
terminal route:

- `connect` (token + protocol version handshake).
- `session.getForeground` (`SESSION_GET_FOREGROUND`, 2385).
- `session.resume` (`SESSION_RESUME`, 2377) — carries the streaming/callback
  flags (see §2.4).
- `session.getMessages` (`SESSION_GET_MESSAGES`, 2381) — hydrate transcript.
- `session.send` (`SESSION_SEND`, 2380) — **prompt input**.
- `session.abort` (`SESSION_ABORT`, 2379) — **cancel the current turn**.
- Server→client notification `session.event` (`SESSION_EVENT`, 2403).

### 2.4 Event fidelity: final vs streaming vs request events

`SessionEventNotification` documents the delivery guarantees
(`src/core/protocol/types.ts:2282‑2350`):

- **Final events** — always delivered, persisted, and **replayed** on
  resume/`getMessages`: `session.start`, `user.message`,
  `assistant.turn_start`, `assistant.message`, `assistant.reasoning`,
  `tool.execution_start`, `tool.execution_complete`, `assistant.turn_end`,
  `abort`, `session.error`, `session.shutdown`
  (2294‑2310; M1a projects the 10 non‑reasoning ones,
  `packages/happy-cli/src/agent/copilot/types.ts:11‑22`).
- **Streaming/ephemeral events** — delivered **only when `streaming:true`** on
  `session.create`/`resume`, NOT replayed, forwarded in real time:
  `assistant.message_start`, `assistant.message_delta`,
  `assistant.reasoning_delta`, `assistant.tool_call_delta`,
  `assistant.streaming_delta` (2312‑2348). *These are what an interactive TUI
  needs for incremental rendering; M1a does not request them.*
- **Request events** (interactivity) — `permission.requested`,
  `user_input.requested`, `exit_plan_mode.requested`,
  `auto_mode_switch.requested`, `elicitation.requested`
  (`src/core/protocol/types.ts:1725‑1726`).

**Capability negotiation for a controller that *answers* prompts.** A client
declares intent on the resume/create params: `requestPermission` →
`enablePermissionCallback` (`src/core/sdkServer.ts:900‑903, 2379‑2384`),
`requestElicitation` → `enableElicitationCallback` (same sites), and
`observePromptEvents` (a listener‑only observer)
(`src/core/sdkServer.ts:3262‑3263, 3432‑3441`). When a connection opts in it is
registered as a **capability/permission provider**
(`addCapabilityProvider` / `updatePermissionCallbackProvider`,
`src/core/sdkServer.ts:4549‑4610`), which flips
`session.permissions.setRequired({ required: providers.size > 0 })`
(4605‑4608) so prompts route to the provider instead of auto‑denying. The
controller then answers proactively via
`session.permissions.handlePendingPermissionRequest` and the
`session.ui.handlePending*` family (`src/core/sdkServer.ts:3356, 3642‑3645`).
M1a connects with `capabilities:{}` and therefore never enables this — it is a
passive reader by design.

### 2.5 The in‑product controller precedent (`LocalRpcSession` + Agents tab)

Copilot already contains a **complete controller** that attaches to a managed
or `--ui-server` session, renders it in a TUI, and answers its
approvals/elicitation — this is the Agents‑tab "attach" flow, and it is the
strongest evidence for Option A's feasibility *and* Option B's thin seam:

- `src/core/sharedApi/localRpcSession.ts` — the controller client. Handshake
  documented at 320‑347: open TCP → register `session.event` handler →
  `connect` → `session.getForeground` → `session.resume` with
  `disableResume:true`, `streaming:true`, and (opt‑in) `observePromptEvents`
  → `session.getMessages` → reconstruct via `Session.fromEvents`. Input
  forwarding is implemented: `send()` → `session.send`
  (`localRpcSession.ts:874‑886`), `abort()` → `session.abort`
  (888‑892), permission answer via
  `session.permissions.handlePendingPermissionRequest`
  (1332), elicitation via `session.ui.handlePendingElicitation` (1403).
- `src/cli/permissions/respondToPermissionViaApi.ts` and
  `src/cli/helpers/respondToUiViaApi.ts` — the answer helpers for permission,
  user‑input, sampling, auto‑mode‑switch, session‑limits, exit‑plan‑mode, and
  elicitation, all through `session.permissions.*` / `session.ui.*`.
- `src/cli/components/agentsScreen.tsx`, `src/cli/hooks/useAgentRegistryRows.ts`,
  `src/cli/sessions/spawnLiveTarget.ts` — the discovery + spawn + render wiring.

**Important transport nuance.** `LocalRpcSession` drives a **Rust‑owned** TCP
JSON‑RPC client (`nativeRuntime.localRpc*`, e.g.
`localRpcSession.ts:574‑610`, backed by
`src/runtime/src/remote/local_rpc_session.rs`). Happy does **not** reuse this;
M1a already has its **own pure‑TS** Content‑Length JSON‑RPC client
(`packages/happy-cli/src/agent/copilot/nativeLocalRpcClient.ts`). So for either
option Happy extends its own TS client — the Copilot controller is a *behavioral
reference*, not a dependency.

### 2.6 The `--ui-server` embedded server (Option B's seam: listener exists, publisher does NOT)

The interactive TUI already hosts the same RPC **listener**, but it does **not**
publish itself to the discovery registry — the publisher wiring is missing (Rev.
3 N2):

- The interactive path constructs an `EmbeddedServer` and starts its TCP
  listener **only when `--ui-server` is enabled**
  (`src/cli/interactiveMode.ts:626‑651`: "Only start the TCP listener when
  --ui-server mode is enabled"). It is passed to `runInteractiveMode` as
  `embeddedServer: options.uiServer ? { enabled: true, port, host } : undefined`
  (`src/cli/index.ts:4275‑4282`). **(S1)** Note the ternary: with `--ui-server`
  **absent** the value is `undefined` — so a B‑env seam must *synthesize the
  whole config object*, not flip a pre‑existing `enabled` field (§4.1).
- **(N2) No `RegistryPublisher` is wired on this path.** `EmbeddedServer.start()`
  merely calls `this.server.start()` and returns the port
  (`src/cli/embeddedServer.ts:152‑163`); it constructs no publisher and writes
  no `<pid>.json`. The `RegistryPublisher` class docstring lists *"`EmbeddedServer`
  for `--ui-server`"* as a caller (`src/core/remoteRegistry/registryPublisher.ts:10‑20`),
  but that is the **intended** contract, not the shipped code: the only
  non‑test `new RegistryPublisher` in the tree is the **managed** bootstrap
  (`src/core/sdkServer.ts:6047`), and the only `.setSession(...)` caller is that
  same block (`sdkServer.ts:6080`) — grep‑verified. **(B1)** Even if a publisher
  were wired, the token it writes is a **separate** constructor arg
  (`registryPublisher.ts:53‑66, 83‑84`) that the interactive path supplies to
  nothing today, so the entry's `token` would be `null` (see §2.8). The seam
  must therefore **add** the publisher lifecycle *and* feed it the token.
- `LocalRpcSession` is documented as attaching to "a local `--ui-server`
  target" (`src/core/sharedApi/localRpcSession.ts:319, 386`). The Agents tab
  attaches one TUI to another TUI's `--ui-server` — but that flow spawns its
  targets through the managed/`spawnLiveTarget` path (which *does* publish),
  not the plain interactive launch. This is why the missing interactive
  publisher has gone unnoticed: no shipped feature attaches to a *bare*
  interactive TUI.
- **(B2) The `local-attach` foreground‑refusal guard is NOT load‑bearing for
  this design.** `EmbeddedServer.registerSession` refuses to register a
  `kind === "local-attach"` session as foreground, but **only when
  `isAgentsTabEnabled` is true** (`src/cli/embeddedServer.ts:245‑273`; the guard
  at 264‑268 and its comment state the defense "only activates when the feature
  flag is on"). Since this design keeps Agents‑tab **off**, the guard is
  **inactive**. It also protects the wrong surface for us: `registerSession` is
  an **in‑process** method the owning TUI calls for *its own* foreground
  session; an external JSON‑RPC client (Happy) never reaches it. The path an
  external client *can* reach is `session.setForeground`
  (`ProtocolMethods.SESSION_SET_FOREGROUND`, `protocol/types.ts:2386`), which
  fires the TUI's `onForegroundSessionChangeCallback`
  (`src/core/sdkServer.ts:1465‑1472`) — i.e. it would *steer the terminal's
  foreground*. The v1 ownership invariant is therefore a **Happy‑side
  discipline** (never call `setForeground`/`send`/`abort`), defined in §4.1/§4.4,
  not reliance on this inactive guard.

**Decisive contrast for the two options:** ordinary `copilot` (no `--ui-server`)
starts **no** listener (`src/cli/interactiveMode.ts:627`), and even `--ui-server`
today starts the listener but wires **no** publisher, so in **neither** case is
there a `<pid>.json` for Happy to discover. Enabling the embedded server **and
wiring its `ui-server` publisher** for the ordinary interactive launch is
precisely the "minimal fork seam" Option B needs. Most of the machinery
(listener, publisher *class*, registry format, controller precedent) already
exists; the one genuinely new line of wiring is the publisher lifecycle on the
interactive path, and it is a near‑copy of the managed block (§2.8).

### 2.7 Discovery registry shape and boundary

`src/core/remoteRegistry/serverRegistry.ts`: entries are `<pid>.json` files
under `~/.copilot/servers/`; `ServerRegistryEntryKind = "ui-server" |
"managed-server"` (43); the entry carries `schemaVersion (1|2)`, `kind`, `pid`,
`host`, `port`, `token|null`, `sessionId?`, `status?`, `copilotVersion`
(104‑152). Files are `0600`, the dir is `0700`, the token is stored in
plaintext on disk, and **listing filters to localhost‑only hosts** (`127.0.0.1`,
`localhost`, `::1`) (14‑18). This is the baseline security boundary shared by
both options.

**(S2) The v1 `ui-server` on‑disk shape differs from v2 `managed-server`**, and
Happy's validator must handle it explicitly (`serverRegistry.ts:93‑111,
156‑161`):

- **`schemaVersion: 1`** for ui-server; **`2`** for managed-server (105‑106).
- **The `kind` field is *absent on disk* for v1** and "normalized to
  `"ui-server"` on read" (97‑99, 108‑111, 156‑161). A validator that requires
  `entry.kind === "ui-server"` **on the raw file** would reject every real v1
  entry. Accept `schemaVersion === 1` with omitted kind and normalize it.
- **`sessionId` is populated only after the first `setSession()`** — which the
  seam‑added `ui-server` publisher must call once the foreground session exists
  (N2; the managed picker already relies on this republish,
  `sdkServer.ts:6080`, `registryPublisher.ts:123‑140`). The picker must
  **poll** for a populated `sessionId` rather than assume it at first publish
  (the same race the managed picker already handles).

### 2.8 Security posture of the RPC surface

For the **top‑level managed/headless** server, the token is read from
`COPILOT_CONNECTION_TOKEN` (`src/core/sdkServer.ts:5840‑5841`: read then
`delete`d from env), passed to that `SDKServer`, and **if unset the server
accepts connections from any local client** (warning at `sdkServer.ts:1690‑1691`).
The native TCP gate that enforces the token lives in the Rust engine and rejects
unauthenticated traffic before dispatch (`sdkServer.ts:1665‑1668, 1670‑1700`).

**(B1 + N2) The interactive `EmbeddedServer` neither authenticates its listener
nor publishes an entry today.** `EmbeddedServerOptions` has **no** token field
(`src/cli/embeddedServer.ts:31‑64`), and the inner `SDKServer` is constructed
**without** `connectionToken` (`src/cli/embeddedServer.ts:101‑119`) even though
`SDKServer` accepts one (`connectionToken?: string`, `sdkServer.ts:236`). The
env read at `sdkServer.ts:5840` is on the *server‑mode* bootstrap only, never on
the interactive path. And **no `RegistryPublisher` is constructed on this path
at all** (N2, §2.6): `EmbeddedServer.start()` only calls `this.server.start()`
(`embeddedServer.ts:152‑163`). Consequently, with the seam merely enabling the
listener: `this.options.connectionToken` is undefined → the native gate is
**off** (anonymous listener, `sdkServer.ts:1690‑1691`), **and** there is no
`<pid>.json` entry for Happy to discover at all — so the "entry's token is null"
framing of Rev. 2 was itself optimistic; there is no entry.

**Two independent token sinks (the Rev. 2 fix touched only one).** Threading a
`connectionToken` into the inner `SDKServer` authenticates the **TCP listener**
but does **not** populate any registry entry. `RegistryPublisher` reads the
token it writes into the `<pid>.json` from its **own** `connectionToken`
constructor option, stored verbatim in the entry (`registryPublisher.ts:53‑66,
79‑90, 83‑84`), and never re‑reads env (`registryPublisher.ts:30‑33`). The
managed path proves both sinks must be fed the same value: the captured token
goes to the top‑level `SDKServer` (`sdkServer.ts:5889`) **and** to
`new RegistryPublisher({ …, connectionToken })` (`sdkServer.ts:6050`).

**Therefore the fork seam is a real, multi‑file change (not one env toggle, and
larger than Rev. 2 stated):**

1. Add `connectionToken?: string` to `EmbeddedServerOptions`
   (`embeddedServer.ts:31‑64`).
2. Thread it into the inner `SDKServer` construction
   (`embeddedServer.ts:101‑119`, add `connectionToken: options.connectionToken`)
   so the native Rust gate enforces it (`sdkServer.ts:1670‑1700`). **This alone
   does not publish an entry.**
3. **(N2) Wire a `ui-server` `RegistryPublisher` lifecycle into the interactive
   path**, gated to run only when the TCP listener is actually started. Model it
   on the managed block (`sdkServer.ts:6039‑6091`):
   - Construct `new RegistryPublisher({ kind: "ui-server", host,
     connectionToken, pid: process.pid })` — the **second** token sink
     (`registryPublisher.ts:53‑66, 79‑90`).
   - Register `publisher.stop()` on the shutdown service **before** calling
     `start()` (managed ordering, comment `sdkServer.ts:6042‑6046`;
     `EmbeddedServer` already owns a shutdown callback at
     `embeddedServer.ts:143‑145`).
   - `await publisher.start(port, new Date().toISOString())` — for
     `kind:"ui-server"` this enqueues the initial write immediately, before a
     session exists (`registryPublisher.ts:97‑116`).
   - `publisher.setSession(foregroundSession)` on the initial foreground **and
     on every foreground transition** so `sessionId`/status stay fresh
     (`registryPublisher.ts:123‑140`). The hook is `EmbeddedServer.registerSession`
     (`embeddedServer.ts:241‑278`), which today takes a `sessionId` string —
     the seam must resolve the `Session` (via `options.sessionManager`) to hand
     to `setSession`, an implementation detail called out in T1.
   - Install a `REGISTRY_HEARTBEAT_INTERVAL_MS` (`unref`'d) heartbeat
     (`registryPublisher.ts:51, 240‑247`; managed sets one at
     `sdkServer.ts:6082‑6087`).
4. At the interactive launch site (`index.ts:4275‑4282`), **synthesize** the
   embedded config *including a token* — reading `COPILOT_CONNECTION_TOKEN` (the
   env the launcher sets) or generating one there, because nothing on the
   interactive path reads it today.

**No duplicate / stale entry on shutdown or crash.** The entry filename is
`<pid>.json` and there is exactly one interactive `EmbeddedServer` per process,
so no duplicate is possible; a managed sibling in a *different* process has a
different pid. `publisher.stop()` sets the shutdown flag, detaches listeners,
and unconditionally unlinks (`registryPublisher.ts:249‑266`); the flag is
re‑checked before and after every async metadata read so a write queued before
`stop()` cannot republish a stale entry after the unlink
(`registryPublisher.ts:25‑27, 269‑277`). A hard crash that skips `stop()` leaves
an orphan that the ~5‑minute stale‑mtime backstop reaps once heartbeats cease
(`registryPublisher.ts:45‑49`) — identical to the managed path's crash
semantics. Registering the cleanup **before** `start()` closes the narrow
orphan window between `start()` and heartbeat setup.

With these edits the interactive embedded listener reaches the same security +
discovery posture M1a already has for the managed child (per‑spawn loopback
token + localhost bind + `0600/0700` perms + a published, self‑cleaning entry).
Absent the publisher wiring there is nothing to attach to; absent the token the
listener is anonymous — both unacceptable.

---

## 3. Option A — Happy‑owned interactive/TUI client for the managed target

### 3.1 Mechanism and exact seams

Keep M1a's headless managed‑server spawn (`managedServer.ts:158‑169`). Extend
Happy's **own** TS client (`nativeLocalRpcClient.ts`) from a reader into a full
controller:

1. `connect` unchanged, but `session.resume` gains `streaming:true`,
   `requestPermission:true`, `requestElicitation:true`, `observePromptEvents:true`
   (the flags at `src/core/sdkServer.ts:900‑903, 2379‑2384, 3262‑3263`).
2. Subscribe to the streaming deltas (§2.4) and the request events; render them
   in a **Happy‑authored terminal UI** (new code; Ink or equivalent).
3. Forward keystrokes/prompt as `session.send` (`ProtocolMethods.SESSION_SEND`),
   Ctrl+C as `session.abort` vs process exit (Happy‑authored mapping), and
   answer approvals/elicitation via
   `session.permissions.handlePendingPermissionRequest` /
   `session.ui.handlePending*` (the shapes at
   `respondToPermissionViaApi.ts:34‑63`, `respondToUiViaApi.ts:44‑106`).
4. Mirror the same event stream to the embedded happy‑server via M1a's existing
   projection (`eventProjection.ts`, `eventRelay.ts`) — unchanged.

Because a permission‑forwarding controller is attached, the managed session's
auto‑deny no longer bites (§2.2; `src/core/sdkServer.ts:6097‑6100`, provider
routing at 4605‑4608). **No Copilot fork change is required.**

### 3.2 Preservation analysis (the P0 checklist)

| Required behavior | Option A outcome | Why (evidence) |
|---|---|---|
| **Original argv** | ✗ Not preserved | The child is a fixed `--server --managed-server` argv (`managedServer.ts:158‑169`). To honor ordinary `copilot <args>` Happy must parse Copilot's *entire* arg grammar (`src/cli/index.ts` arg parsing) and translate the supported subset into bootstrap options; the managed bootstrap only honors model/agent/cwd‑style inputs, so most flags must be rejected or re‑implemented. Perpetual drift surface. |
| **Exit codes** | ✗ Reimplemented | The managed child's exit code reflects the server process/idle‑timeout (`managedSessionShutdown`, `sdkServer.ts:5895‑5906`), not the interactive outcome. Happy's own process must derive an exit code from session state, re‑implementing `interactiveMode.ts` exit derivation (`src/cli/interactiveMode.ts:1282`). |
| **Streaming rendering** | ✗ Reimplemented | Protocol supports deltas (§2.4), but Happy must build the whole render stack (markdown, tool views, reasoning, diffs, plan mode). Copilot's is `app.tsx` (~16.7k lines) + components; none is reused. |
| **Prompt input** | ✗ Reimplemented | `session.send` exists (`sdkServer` write path), but the input box, slash commands, history, multiline, paste, completion are all Happy‑authored. |
| **Tool approvals / elicitation** | ~ Protocol‑supported, UI reimplemented | Answer path exists (§2.4/§2.5). But Happy renders the approval/elicitation UI itself (Copilot's is `permissionRequest.tsx`, ~840 lines). Read‑baseline auto‑approve and the provider‑disconnect hazard (§3.4) apply. |
| **Ctrl+C / cancellation** | ✗ Reimplemented | `session.abort` exists (`localRpcSession.ts:888‑892`); the cancel‑turn‑vs‑exit policy that Copilot implements in `interactiveMode.ts` (signal handling at 1068) is re‑derived by Happy. |
| **Reconnect / resume** | ~ Supported, UX‑owned | `session.resume`/`getMessages`/eventLog cursor exist; Happy owns the reconnect UX and cursor‑expiry handling (`cursorStatus:'expired'`, `types.ts:36‑41`). |
| **Exactly one session + mirror** | ✓ Clean | The managed session is the single foreground; Happy is its sole UI and mirrors trivially via the existing projection. |

**Net:** Option A satisfies only *one* line of the P0 contract natively
(one‑session + mirror). Everything the operator would *see and feel* is a Happy
re‑implementation that must track Copilot's TUI feature‑set release over
release.

### 3.3 Conflict surface

- **Copilot source:** none. No fork edit. (This is Option A's biggest
  attraction and it is real.)
- **Happy source:** large **new** surface in
  `packages/happy-cli/src/agent/copilot/` — a terminal renderer, input layer,
  approval UI, arg translator, exit mapper. It heavily extends
  `nativeLocalRpcClient.ts` and adds sibling modules. It does **not** collide
  with P4's Copilot controller files (they're in the Copilot tree), so P0's
  "P0 and P4 must not edit the same Copilot controller files" constraint (lines
  993‑995) is trivially met.
- **Ongoing:** the arg‑grammar translator and the renderer are coupled to
  Copilot internals *by imitation*; there is no compiler to catch drift, so
  breakage is discovered at runtime after each Copilot upgrade.

### 3.4 Security / ownership / failure semantics

- **Security:** inherits M1a's per‑spawn loopback token (`managedServer.ts:136`)
  — good. No new network surface.
- **Ownership:** clean — Happy owns the only UI of a session that has no other
  front‑end.
- **Failure — permission‑provider disconnect (documented hazard).** If Happy's
  controller (the sole permission provider) disconnects mid‑session, the
  provider refcount hits zero and `setRequired(false)` clobbers the host's
  routing, after which *every later tool call is silently denied*
  (`src/core/sdkServer.ts:4625‑4628` explicitly flags this "provider‑vs‑host
  ownership race … an approved permission‑callback provider later disconnecting
  can still clobber"). Option A must treat controller reconnect as
  safety‑critical, not cosmetic.
- **Failure — idle reap.** `--session-idle-timeout 300` reaps the session and
  shuts the process after 300s idle (`sdkServer.ts:5895‑5906`); a "terminal you
  walked away from" dies unless Happy manages the timeout.

### 3.5 When Option A is the right call

If the goal were a **Happy‑native, cross‑device** experience where the phone is
co‑equal or primary and byte‑fidelity to Copilot's terminal is a non‑goal,
Option A's symmetric ownership (Happy renders both ends from one event stream)
is the cleaner architecture and needs zero Copilot cooperation. That is a
legitimate product — it is simply **not** the P0 contract, which is about
*preserving the ordinary Copilot terminal*.

---

## 4. Option B — minimal fork seam to mirror/control the real interactive session

### 4.1 Mechanism and exact seams

The user runs the **genuine** interactive `copilot <args>` (the
`runInteractiveMode` path). The launcher/daemon arranges for that process to
expose its embedded server (the **listener** already exists; the **publisher**
does not — N2) so Happy can attach:

1. **Fork seam (the only Copilot change — small but multi‑file, not one env
   toggle).** Make the ordinary interactive launch start its embedded server
   **with a connection token** and **publish a `ui-server` registry entry** when
   opted in, **without** altering user‑visible behavior. The seam has four
   parts (all confirmed necessary by the B1/N2 analysis in §2.6/§2.8):
   - **(a) Config synthesis at the launch site.** Today
     `embeddedServer: options.uiServer ? { enabled, port, host } : undefined`
     (`src/cli/index.ts:4275‑4282`); with `--ui-server` absent it is
     `undefined`. The seam **synthesizes** the config object when
     `COPILOT_HAPPY_EMBED=1`: `{ enabled: true, host: "127.0.0.1", port: 0,
     connectionToken: <token> }`, where `<token>` is read from
     `COPILOT_CONNECTION_TOKEN` (set by the launcher) or generated there. **(S1)**
     This is synthesis, not flipping a boolean.
   - **(b) A token field on `EmbeddedServerOptions`.** Add
     `connectionToken?: string` (`src/cli/embeddedServer.ts:31‑64`) and thread
     it into the inner `SDKServer` (`embeddedServer.ts:101‑119`;
     `SDKServer` already accepts `connectionToken`, `sdkServer.ts:236`). **(B1)**
     This authenticates the listener; on its own it publishes nothing (§2.8).
   - **(c) Wire a `ui-server` `RegistryPublisher` lifecycle. (N2)** This wiring
     does **not** exist today — `EmbeddedServer.start()` only starts the listener
     (`embeddedServer.ts:152‑163`) and the sole `new RegistryPublisher` is the
     managed block (`sdkServer.ts:6047`). Add, gated on the listener being
     started: construct `new RegistryPublisher({ kind: "ui-server", host,
     connectionToken, pid })` (the **second** token sink,
     `registryPublisher.ts:53‑90`), register `stop()` before `start()`, call
     `start(port, startedAt)`, `setSession(foregroundSession)` on the initial
     foreground and every transition, and an `unref`'d heartbeat — a near‑copy
     of `sdkServer.ts:6039‑6091`. Filename `<pid>.json` + unconditional unlink on
     `stop()` guarantee no duplicate/stale entry (§2.8).
   - **(d) No new protocol/render/session semantics.** The listener, the
     publisher *class*, the registry format, and the event surface all already
     exist; the seam only *enables, authenticates, and publishes* them — it adds
     no new RPC methods, render paths, or session behavior.
   Two forms for triggering (a):
   - **(B‑env, recommended)** the fork reads `COPILOT_HAPPY_EMBED=1` and does the
     synthesis internally. Keeps the user's **argv byte‑identical** to what they
     typed (strictly honoring the "original argv" contract, P0 line 997).
   - **(B‑flag)** the launcher injects `--ui-server --host 127.0.0.1 --port 0`
     into the child argv (no config‑synthesis fork edit, but still needs the
     token‑threading (b) **and** publisher‑wiring (c) edits, and the injected
     flag is observable in argv/`--help` and must be proven inert for every
     ordinary arg combination). Note: `--ui-server` alone still publishes
     nothing today (N2), so (c) is required under **both** forms.
2. **Happy daemon attaches read‑only.** Extend Happy's discovery + validator to
   accept a `ui-server` entry. **(S2)** The contract is explicit: accept
   `schemaVersion === 1` with the **`kind` field omitted on disk** (normalize to
   `"ui-server"`; M1a today hard‑rejects because it requires
   `kind === "managed-server"` + schema 2, `managedServer.ts:110‑122`), and
   **poll for a populated `sessionId`** (published on the seam‑added publisher's
   first `setSession()`, N2; `registryPublisher.ts:123‑140`). Then run the M1a
   handshake with
   `observePromptEvents:true` **but `requestPermission:false`** — Happy watches
   and mirrors; the human at the terminal remains the sole approver. Project to
   the embedded happy‑server via the existing `eventProjection`/`eventRelay`.
3. **v1 ownership invariant (B2).** Happy's attach is a **pure read‑only
   consumer**: it calls `connect` → `session.getForeground` → `session.resume`
   (read‑only flags) → `session.getMessages` → subscribe to `session.event`, and
   **never** calls `session.setForeground`, `session.send`, or `session.abort`.
   This — not the inactive `isAgentsTabEnabled`‑gated `registerSession` guard
   (§2.6) — is what guarantees the terminal keeps sole ownership of its single
   foreground session. See §4.4 for whether an additional Copilot‑side guard is
   warranted.
4. **Later, additive:** phone→terminal input via `session.send`, and
   phone‑answered approvals by attaching as a *second* permission provider
   (§4.4 covers the dual‑provider race this introduces).

### 4.2 Preservation analysis (the P0 checklist)

| Required behavior | Option B outcome | Why (evidence) |
|---|---|---|
| **Original argv** | ✓ Preserved | The ordinary interactive path (`runInteractiveMode`, `src/cli/index.ts:4220+`) parses the user's args unchanged; B‑env leaves argv byte‑identical. `--ui-server` does **not** set `isServerMode` and does not conflict with ordinary interactive args (`src/cli/index.ts:1827, 2389‑2408, 4275`). |
| **Exit codes** | ✓ Native | The real interactive process derives and returns its own exit code (`src/cli/interactiveMode.ts:1282` flush‑then‑exit). Happy is side‑attached and never intercepts the exit path. |
| **Streaming rendering** | ✓ Native at terminal | The user sees Copilot's own render stack. Happy mirrors projected events to the phone (M1a projection already does this read‑only). |
| **Prompt input** | ✓ Native at terminal | Copilot's own input box. (Phone input is a later additive `session.send` path.) |
| **Tool approvals / elicitation** | ✓ Native at terminal | Answered in Copilot's own `permissionRequest.tsx`. Happy mirrors the `permission.requested`/`elicitation.requested` events to the phone read‑only in v1. |
| **Ctrl+C / cancellation** | ✓ Native | Handled by the interactive session's own signal handling ("shut down active session on signal‑driven exits (SIGINT/SIGTERM/SIGHUP)", `src/cli/interactiveMode.ts:1068`). |
| **Reconnect / resume** | ✓ Native + independent attach | Terminal resume is native; Happy's attach can reconnect independently against the persistent registry entry. Ownership is preserved by the **Happy‑side read‑only invariant** (§4.1 item 3): the attach never calls `session.setForeground`/`send`/`abort`, so a re‑attach cannot hijack the terminal's single foreground. (The `embeddedServer.ts` `local-attach` guard is inactive with Agents‑tab off and is *not* relied upon — see §2.6 B2.) |
| **Exactly one session + mirror** | ✓ | The interactive TUI's session is the single foreground; Happy is a read‑only secondary consumer that mirrors to the embedded happy‑server. |

**Net:** Option B satisfies the P0 contract **by construction** — the ordinary
experience is preserved because it *is* the ordinary experience, with Happy as
a side‑attached mirror.

### 4.3 Conflict surface

- **Copilot source (fork):** small but **multi‑file** (not one env read; see B1
  in §2.8 and N2 in §2.6). It adds: (a) config synthesis + token read/generate
  at the interactive‑launch site (`src/cli/index.ts:4275‑4282`), (b) a
  `connectionToken` field on `EmbeddedServerOptions` threaded into the inner
  `SDKServer` (`src/cli/embeddedServer.ts:31‑64, 101‑119`; option at
  `sdkServer.ts:236`), and **(c) a `ui-server` `RegistryPublisher` lifecycle on
  the interactive path** (construct/start/`setSession`/heartbeat/stop), which
  does not exist today and is modeled on the managed block
  (`sdkServer.ts:6039‑6091`); its natural home is `EmbeddedServer`
  (`embeddedServer.ts:143‑145, 152‑163, 241‑278`). None of this touches the
  typed‑context/ownership controller files P4 edits — satisfying P0's co‑edit
  prohibition (lines 993‑995) *provided the seam stays in the launch/option‑
  assembly + embedded‑server path, not the controller*. This placement is a hard
  design constraint (see §8 staged tasks). Optionally, a Copilot‑side hardening
  (§4.4) makes the `local-attach` foreground guard unconditional — a separate,
  small edit in `embeddedServer.ts:264‑268`.
- **Happy source — OVERLAPS P4 (N1).** The discovery/validator generalization
  lives in `managedServer.ts` (today managed‑only, `managedServer.ts:102‑126`),
  and the mirror extension lives in the `runCopilotMirror.ts`/client path — **the
  same Happy files P4 rewrites** ("generalize managed spawn to executable plus
  fixed arguments" + "validate exact runtime/package identity" +
  "add session provenance and monotonic ownership status", parent plan lines
  1056‑1058). This is a **real collision**: T2/T3 must **rebase after P4** and
  build on its `{executable, fixedArguments}` spawn + provenance/ownership seams,
  **not** parallelize with it (corrected from Rev. 1, which wrongly called T2
  parallelizable). See §8.
- **Ongoing:** low. Happy attaches to a *stable published protocol* (the same
  one the Agents tab consumes), so Copilot upgrades that keep the RPC contract
  don't break Happy — unlike Option A's imitation‑by‑renderer.

### 4.4 Security / ownership / failure semantics

- **Security — token is mandatory AND currently absent, on BOTH sinks (B1 +
  N2).** The embedded listener is anonymous today because `EmbeddedServerOptions`
  carries no token and the inner `SDKServer` gets none (§2.8;
  `embeddedServer.ts:31‑64, 101‑119`), **and** no publisher writes an entry at
  all (§2.6). The seam **must** (i) add the token field + thread it into the
  inner `SDKServer` (listener auth), and (ii) pass the **same** token to the
  seam‑added `RegistryPublisher` constructor (`registryPublisher.ts:53‑66,
  83‑84`) so the discovery entry carries it — two sinks, one value, exactly as
  the managed path does (`sdkServer.ts:5889` + `6050`). The token is generated
  by the launcher and passed via env to the child (same pattern as
  `managedServer.ts:150‑156`), never written to argv/logs; the child clears it
  from its own env after capture so tools/subagents never inherit it
  (`sdkServer.ts:5836‑5841`). With the token + loopback bind + localhost registry
  filter + `0600/0700` perms (§2.7‑2.8), the boundary matches M1a's managed
  posture.
- **Failure — registry entry is self‑cleaning (N2).** The seam‑added publisher
  writes exactly one `<pid>.json`; `stop()` (wired on the shutdown service
  before `start()`) unconditionally unlinks it and is shutdown‑flag‑guarded
  against a late republish (`registryPublisher.ts:249‑266, 25‑27`). A hard crash
  leaves an orphan that the ~5‑minute stale‑mtime backstop reaps once heartbeats
  cease (`registryPublisher.ts:45‑49`) — no duplicate entry is possible (one
  publisher per pid), and Happy's poll‑for‑`sessionId` + liveness check tolerate
  a briefly‑stale entry.
- **Ownership — clean, single foreground, guaranteed Happy‑side (B2).** The
  interactive session is the sole foreground. Ownership safety rests on the
  **v1 read‑only invariant** (§4.1 item 3): Happy never calls
  `session.setForeground` (which would fire the TUI's
  `onForegroundSessionChangeCallback`, `sdkServer.ts:1465‑1472`), `session.send`,
  or `session.abort`. It does **not** rest on the `embeddedServer.ts`
  `registerSession` `local-attach` refusal, which is gated on `isAgentsTabEnabled`
  and therefore **inactive** in this design (§2.6). **Decision — is a Copilot‑side
  guard needed?** For v1, **no**: an external read‑only client that never issues
  a write/foreground RPC cannot take ownership, and adding the guard would not
  change v1 behavior. If defense‑in‑depth against a *future* buggy or malicious
  local client is wanted, the minimal hardening is to make the existing
  `local-attach` refusal **unconditional** (drop the `isAgentsTabEnabled` gate at
  `embeddedServer.ts:264‑268`) — which does **not** enable `AgentRegistryWatcher`
  (that watcher is gated separately on `agentsTabEnabled`,
  `interactiveMode.ts:678‑690`). Recommended as an optional T1 sub‑item, not a v1
  blocker.
- **Failure — read‑only v1 has no permission‑race.** Because v1 attaches with
  `requestPermission:false`, Happy is never a permission provider, so the
  provider‑disconnect clobber (`sdkServer.ts:4625‑4628`) **cannot** occur in
  v1. This is a real safety advantage over Option A, whose sole‑provider
  controller *is* exposed to that race.
- **Failure — later remote‑answer milestone reintroduces the race.** If a later
  milestone lets the phone answer approvals, Happy becomes a *second* provider
  alongside the terminal human. The provider set and `setRequired` are
  refcounted (`sdkServer.ts:4589‑4609`), and the documented host‑vs‑provider
  clobber (4625‑4628) becomes live. That milestone must design who‑wins
  (terminal‑authoritative, phone‑advisory) and a disconnect‑safe restore — it
  is explicitly out of the v1 preservation scope.
- **Failure — attach lag / cold start.** If Happy attaches after the session
  started, `session.getMessages` replays the full transcript
  (`localRpcSession.ts:333, 613‑627`) so the mirror is complete; ephemeral
  deltas before attach are lost but the final events are replayed (§2.4),
  matching M1a's mirror semantics.

### 4.5 Honest costs of Option B (not a rubber‑stamp)

1. **The seam is thin but not zero — and it is multi‑file (B1 + N2).** It is a
   real Copilot fork change: config synthesis at the launch site, a
   `connectionToken` field threaded through `EmbeddedServerOptions`→inner
   `SDKServer`, **and a `ui-server` `RegistryPublisher` lifecycle wired into the
   interactive path** (which does not exist today — the only publisher is the
   managed block, `sdkServer.ts:6047`), plus Happy discovery/client work. Rev. 1's
   "one env read" framing and Rev. 2's "just add a token field" framing were both
   too small; the claim is "minimal and near‑copied from the managed block," not
   "free," and it touches `embeddedServer.ts` (and possibly a small helper in
   `interactiveMode.ts` to resolve the foreground `Session` for `setSession`).
2. **`--ui-server`/embed behavior‑equivalence must be proven.** The seam must
   set only `embeddedServer.enabled` + `connectionToken` and nothing else; in
   particular it must **not** enable the Agents‑tab watcher or any UX plain
   interactive lacks. The interactive path constructs `EmbeddedServer`
   unconditionally but only starts the listener when enabled
   (`interactiveMode.ts:626‑651`); the Agents‑tab watcher is gated separately on
   `agentsTabEnabled` (`interactiveMode.ts:678‑690`). An acceptance test must
   confirm a byte‑for‑byte identical interactive experience with the seam on vs
   off, modulo the loopback listener.
3. **Happy validator must learn the v1 entry shape (S2).** `ui-server` is
   schema‑v1 with `kind` **omitted on disk** (normalized on read) and `sessionId`
   populated only after the first `setSession()` (`serverRegistry.ts:97‑99,
   108‑111, 156‑161`; `registryPublisher.ts:123‑140`). Happy's discovery must
   accept omitted‑kind + `schemaVersion === 1` and poll for a populated
   `sessionId`, rather than requiring `kind === "managed-server"` as M1a does
   today (`managedServer.ts:110‑122`).
4. **T2/T3 are gated on P4 (N1).** They rebase on P4's Happy‑side
   spawn/validator/provenance rewrite; they cannot land in parallel.

---

## 5. Head‑to‑head comparison

| Dimension | Option A (Happy‑owned TUI / managed) | Option B (mirror real TUI / ui‑server seam) |
|---|---|---|
| Preserves original argv | ✗ Happy re‑parses Copilot arg grammar | ✓ native (`index.ts:4220+`) |
| Preserves exit codes | ✗ Happy re‑derives | ✓ native (`interactiveMode.ts:1282`) |
| Streaming render fidelity | ✗ Happy re‑implements `app.tsx` stack | ✓ native terminal; projected to phone |
| Prompt input | ✗ Happy‑authored input layer | ✓ native; phone input additive later |
| Approvals/elicitation | ~ answerable, UI re‑implemented; sole‑provider race | ✓ native at terminal; mirrored to phone |
| Ctrl+C semantics | ✗ Happy re‑derives cancel‑vs‑exit | ✓ native signal handling (`interactiveMode.ts:1068`) |
| Reconnect/resume | ~ supported, UX‑owned | ✓ native + non‑owning re‑attach |
| One session + mirror | ✓ | ✓ (Happy read‑only invariant — never `setForeground`/`send`/`abort`, §4.1/§4.4) |
| Copilot fork change | **none** | **small, multi‑file** (synthesize embed config + token; add `connectionToken` to `EmbeddedServerOptions`→inner `SDKServer`; **wire a `ui-server` `RegistryPublisher` lifecycle**, near‑copied from the managed block) |
| Happy new‑code volume | **large** (renderer/input/approvals/argv/exit) | **bounded** (discovery+client deltas) |
| Drift risk after Copilot upgrades | **high** (imitation, no compiler) | **low** (stable published RPC) |
| Permission‑provider disconnect race | **exposed** (`sdkServer.ts:4625‑4628`) | **not in v1** (read‑only attach) |
| Fits P0 "preserve ordinary terminal" | **no** | **yes** |
| Best when… | phone‑primary Happy‑native UI (non‑goal here) | preserve the real terminal (this task) |

---

## 6. Argument policy (P0 lines 1001‑1002)

P0 requires defining which original Copilot args the wrapper supports/rejects
*before* routing them. The two options impose very different policies.

**Under Option B (recommended)** the policy is trivial and safe because args go
straight to Copilot's own parser:

- **Pass‑through (all ordinary interactive args):** everything the interactive
  path accepts — prompt, `--model`, `--agent`, `--resume`/`--continue`, cwd,
  `--allow-all*`/`--yolo`, custom‑instruction toggles, etc. Happy does not
  interpret them; Copilot does.
- **Reject (incompatible with the seam):** the headless/again‑server family that
  is already mutually exclusive with the interactive+embedded path —
  `--server`, `--headless`, `--managed-server`, `--stdio`, `--connect`,
  `--ui-server` (the last because the seam already manages the embedded server;
  a user‑supplied one would double‑bind). These are exactly the combinations
  Copilot itself rejects (`src/cli/index.ts:2389‑2408`), so Happy's wrapper
  should refuse them early with a clear message rather than letting Copilot
  error opaquely.
- **Env, not argv:** the seam itself travels as `COPILOT_HAPPY_EMBED` +
  `COPILOT_CONNECTION_TOKEN` env (B‑env), so the user's argv is never mutated.
  Note (B1): because nothing on the interactive path reads
  `COPILOT_CONNECTION_TOKEN` today (only the server‑mode bootstrap does,
  `sdkServer.ts:5840`), the seam must **explicitly** read it at the interactive
  launch site and thread it into the synthesized embedded config — it is not
  inherited for free.

**Under Option A** the policy is a large allow‑list Happy must maintain: only
the handful of bootstrap‑expressible flags (model/agent/cwd/resume) can be
honored; the rest must be rejected or silently dropped, and the list must be
re‑audited every Copilot release. This is a standing maintenance obligation and
a strong point against A.

---

## 7. Test matrix

Acceptance is P0's bar: *an operator completes an ordinary interactive session
through the cached Happy command with phone mirroring; no test‑only stimulus
client is required* (lines 1004‑1006). Tests are written against the
**recommended Option B**; where a row is option‑specific it is marked.

### 7.1 Copilot fork‑seam unit/behavior tests (Option B)

| ID | Test | Assertion |
|---|---|---|
| F‑1 | `COPILOT_HAPPY_EMBED=1` + ordinary interactive launch | The seam‑wired `ui-server` `RegistryPublisher` (N2) writes a `<pid>.json` entry (none exists without the seam — `EmbeddedServer.start` publishes nothing, `embeddedServer.ts:152‑163`); the entry appears with `schemaVersion 1`, populated `sessionId` after the first `setSession()`, and a `token` equal to the injected token (`registryPublisher.ts:79‑90, 109‑140`; `serverRegistry.ts:104‑152`). |
| F‑2 | Seam **off** vs **on** UX equivalence | Interactive experience identical modulo the loopback listener; Agents‑tab watcher **not** enabled by the seam (`interactiveMode.ts:626‑651, 678‑690`). |
| F‑3 | **Token threading — both sinks (B1 + N2)** | The single injected token reaches **both** the inner `SDKServer` (listener auth) **and** the `RegistryPublisher` constructor (entry token). `EmbeddedServerOptions.connectionToken` is set from the launch site (`index.ts:4275‑4282`), threaded into the inner `SDKServer` (`embeddedServer.ts:101‑119`; option `sdkServer.ts:236`), **and** passed to `new RegistryPublisher({…, connectionToken})` (`registryPublisher.ts:79‑90`). Assert: (a) a `connect` **without** the token is rejected by the native gate (`sdkServer.ts:1665‑1668, 1670‑1700`); (b) with no token supplied to the seam the launch **fails closed** rather than starting an anonymous listener / publishing a null‑token entry (`sdkServer.ts:1690‑1691`); (c) the published entry's `token` is non‑null and equals the listener's token. |
| F‑4 | Placement guard | Seam edits live only in the launch/option‑assembly path + `EmbeddedServerOptions`/inner‑`SDKServer` threading, **not** P4's controller files (P0 lines 993‑995) — enforced by a codeowners/path check in the PR. |
| F‑5 | **Foreground‑guard decision (B2), optional** | If the optional unconditional `local-attach` refusal is adopted, assert `registerSession` refuses a `local-attach` session **regardless of `isAgentsTabEnabled`** (`embeddedServer.ts:264‑268`) **and** that `AgentRegistryWatcher` stays off (`interactiveMode.ts:678‑690`). If not adopted, this test is N/A and v1 relies solely on the Happy‑side read‑only invariant (H‑10). |
| F‑6 | **Publisher lifecycle + no orphan/stale entry (N2)** | Assert the seam‑wired publisher: (a) writes exactly one `<pid>.json`; (b) refreshes `sessionId`/status on foreground transitions via `setSession` (`registryPublisher.ts:123‑140`); (c) on clean shutdown, `stop()` unlinks the entry (`registryPublisher.ts:249‑266`) and no file remains; (d) on a simulated crash (skip `stop()`), the entry is reaped by the stale‑mtime backstop and never causes a duplicate on the next launch (`registryPublisher.ts:45‑49`); (e) the cleanup callback is registered **before** `start()` (`sdkServer.ts:6042‑6046` ordering) so no orphan survives a `start`‑time failure. |

### 7.2 Happy attach/mirror tests (Option B, real surface — no stimulus client)

| ID | Test | Assertion |
|---|---|---|
| H‑1 | Discover + validate a `ui-server` entry **(S2)** | Happy accepts `schemaVersion === 1` with the **`kind` field omitted on disk** (normalized to `"ui-server"`) and a non‑null `token`, then **polls** for a populated `sessionId` before attaching. Today's validator rejects it because it requires `kind === "managed-server"` + schema 2 (`managedServer.ts:110‑122`); the fix is the S2 contract (`serverRegistry.ts:97‑99, 108‑111, 156‑161`). |
| H‑2 | Read‑only attach handshake | `connect`→`getForeground`→`resume(observePromptEvents:true, requestPermission:false)`→`getMessages`; transcript hydrated (`localRpcSession.ts:320‑347`). |
| H‑3 | Live mirror of a **real** typed turn | Operator types in the terminal; final events (`user.message`…`assistant.turn_end`) project to the embedded happy‑server and render on the phone (M1a projection). |
| H‑4 | Approval mirrored read‑only | A real tool‑approval prompt at the terminal surfaces as `permission.requested` on the phone (read‑only); the human answers at the terminal; no phone answer path in v1. |
| H‑5 | Ctrl+C at terminal | Cancels the turn / exits per native semantics; Happy observes `abort`/`session.shutdown` and updates the mirror; Happy does not crash or wedge. |
| H‑6 | Exit code fidelity | The interactive process's exit code is unchanged with the seam on (compare to seam off). |
| H‑7 | Attach‑after‑start | Happy attaches mid‑session; `getMessages` replay yields a complete mirror (`localRpcSession.ts:613‑627`). |
| H‑8 | Detach/reconnect | Happy disconnects and re‑attaches without disturbing the terminal's foreground; the terminal keeps sole ownership. (Ownership rests on the Happy‑side read‑only invariant, H‑10 — **not** on the inactive `embeddedServer.ts` guard, §2.6 B2.) |
| H‑9 | Idle longevity | An idle interactive terminal is **not** reaped by a managed idle‑timeout (managed‑only path, `sdkServer.ts:5895‑5906`) — confirms Option B avoids A's idle‑reap. |
| H‑10 | **Read‑only invariant (B2)** | Over a full real session, assert Happy's client issues **zero** write/foreground RPCs — never `session.setForeground` (`protocol/types.ts:2386`), `session.send` (2380), or `session.abort` (2379). This is the v1 ownership guarantee; enforce it with a client‑side allow‑list + a test that fails if any write method is emitted. |

### 7.3 Capability‑gate tests (both options)

| ID | Test | Assertion |
|---|---|---|
| C‑1 | Manifest advertises `copilot-terminal-route-v1` only after H‑3…H‑6 pass on a real session | The launcher's `ev-copilot happy enable` refuses routing otherwise (§2.2 lines 71‑75). |
| C‑2 | `happy copilot --help` alone does **not** flip the capability | Negative test for the §2.2 line 74 anti‑pattern. |

### 7.4 Option‑A‑only tests (for completeness, if A is ever chosen)

Sole‑provider disconnect → later tool calls denied (`sdkServer.ts:4625‑4628`);
arg‑translation allow‑list/reject‑list; Happy‑rendered streaming fidelity vs a
golden transcript; Happy exit‑code derivation. These have no Option‑B analog
and illustrate A's larger surface.

---

## 8. Staged implementation tasks

Sequencing honors P0: **design now, implement after P4.** Two distinct
P0/P4 relationships apply: (i) the Copilot fork seam (T1) must **not co‑edit
P4's Copilot controller files** (P0 lines 993‑995) — satisfied by keeping T1 in
the launch/option‑assembly + `EmbeddedServerOptions` path; and (ii) the Happy
work (T2/T3) **edits the very files P4 rewrites** (`managedServer.ts`,
`runCopilotMirror.ts`), so it **rebases on P4** rather than running in parallel
(N1). All tasks assume Option B.

- **T0 (this document).** Source‑verified design + recommendation. *Done on
  commit of this file.*
- **T1 — Copilot fork seam (`COPILOT_HAPPY_EMBED`), multi‑file (B1/S1/N2).** Four
  edits, all outside P4's controller files: (a) **synthesize** the embedded
  config + read/generate the token at the interactive launch site
  (`src/cli/index.ts:4275‑4282` — today `undefined` when `--ui-server` absent);
  (b) add `connectionToken?: string` to `EmbeddedServerOptions` and thread it
  into the inner `SDKServer` (`src/cli/embeddedServer.ts:31‑64, 101‑119`; option
  `sdkServer.ts:236`); (c) **wire a `ui-server` `RegistryPublisher` lifecycle**
  into the interactive path (construct with the **second** token sink,
  register `stop()` before `start()`, `start`, `setSession` on foreground +
  transitions, `unref`'d heartbeat, `stop` on shutdown) — this does not exist
  today and is a near‑copy of the managed block `sdkServer.ts:6039‑6091`; owner
  is `EmbeddedServer` (`embeddedServer.ts:143‑145, 152‑163, 241‑278`), with a
  small `Session`‑resolution helper so `registerSession(sessionId)` can drive
  `publisher.setSession(session)`; (d) **optional** hardening — make the
  `local-attach` foreground refusal unconditional (`embeddedServer.ts:264‑268`)
  **without** enabling `AgentRegistryWatcher` (§4.4 B2). **Constraint:**
  new/isolated code paths only; no edits to the typed‑context/ownership
  controller files P4 touches. Ships behind the env, default‑off. Tests
  F‑1…F‑6. *Starts after P4.*
- **T2 — Happy discovery + validator for `ui-server` entries (S2), REBASES ON
  P4 (N1).** Generalize `managedServer.ts` to accept `schemaVersion === 1` with
  **omitted‑on‑disk kind** (normalized to `"ui-server"`) + non‑null token, and to
  **poll** for a populated `sessionId` (`serverRegistry.ts:97‑99, 108‑111,
  156‑161`). **This edits the same `managedServer.ts` spawn/validator P4 rewrites
  (parent plan lines 1056‑1057), so it must rebase on P4's `{executable,
  fixedArguments}` + identity‑validation seams — NOT parallelize** (corrected
  from Rev. 1). Tests H‑1. *Depends on P4.*
- **T3 — Happy read‑only attach client (B2), REBASES ON P4 (N1).** Extend the
  TS client (`nativeLocalRpcClient.ts`) to resume with `observePromptEvents:true,
  requestPermission:false`, subscribe to streaming deltas + request events, and
  project via the existing `eventProjection`/`eventRelay`. Enforce the
  **read‑only invariant** (never `setForeground`/`send`/`abort`). Because the
  provenance/ownership write lands in `runCopilotMirror.ts` which **P4 also
  edits** (parent plan line 1058), T3 rebases on P4. Tests H‑2…H‑10.
  *Depends on P4 + T1 + T2.*
- **T4 — Launcher wiring + capability gate.** Teach the daemon/launcher to set
  the env, generate the token, discover the entry, and only then advertise
  `copilot-terminal-route-v1`. Tests C‑1, C‑2. *Depends on T3.*
- **T5 — Real external acceptance.** An operator completes an ordinary
  interactive session with phone mirroring; capture the transcript as the
  acceptance artifact P0 requires (lines 1004‑1006). *Gate for flipping the
  manifest capability.*
- **T6 (additive, out of v1 preservation scope) — phone input + phone
  approvals.** `session.send` from the phone; second permission provider with a
  terminal‑authoritative / phone‑advisory policy and disconnect‑safe restore
  (designs around `sdkServer.ts:4589‑4628`). Separate operator decision (§9).

---

## 9. Unresolved operator decisions

1. **Confirm Option B over Option A.** This design recommends B on the P0
   "preserve the ordinary terminal" contract. If the operator's true intent is a
   Happy‑native cross‑device UI (phone co‑equal/primary), A becomes viable and
   the recommendation flips. *Decision needed before T1.*
2. **Seam form: B‑env (`COPILOT_HAPPY_EMBED`) vs B‑flag (inject `--ui-server`).**
   Both require the B1 token‑threading edits to `EmbeddedServerOptions`/inner
   `SDKServer`; they differ only in how the config is triggered. B‑env keeps
   argv byte‑identical (strictest "original argv" reading) and adds the small
   config‑synthesis code path; B‑flag reuses the existing hidden flag (no
   synthesis edit) but is observable in argv/`--help`. Recommendation: **B‑env**.
   *Decision needed before T1.*
3. **Copilot‑side foreground guard: adopt the unconditional `local-attach`
   refusal, or rely on the Happy‑side read‑only invariant alone? (B2)** The
   existing `registerSession` guard is inactive with Agents‑tab off. v1 is safe
   without it because Happy never issues a write/foreground RPC (H‑10). Optional
   defense‑in‑depth: drop the `isAgentsTabEnabled` gate at
   `embeddedServer.ts:264‑268` (must not enable `AgentRegistryWatcher`).
   Recommendation: **rely on the Happy‑side invariant for v1; adopt the
   unconditional guard only as a cheap hardening if desired.** *Decision needed
   before T1 (affects whether F‑5 is in scope).*
4. **v1 scope = read‑only mirror?** This design scopes v1 to preserve + mirror,
   with phone input/approvals deferred to T6. Confirm that "an ordinary
   interactive session with phone mirroring" (P0 line 1004) is satisfied by a
   read‑only phone mirror, or whether phone‑originated input is required for the
   capability to flip. *Decision needed before T4/T5.*
5. **Token lifetime + storage.** The embedded server's token sits in the
   `0600` registry file in plaintext (`serverRegistry.ts:14‑15`). Confirm the
   loopback‑only + file‑perms boundary is acceptable for the interactive process
   (it is the same boundary M1a already accepts for the managed child), or
   whether an additional rotation policy is wanted.
6. **Interaction with the launcher's default‑off posture.** The seam is
   default‑off; confirm the launcher only sets `COPILOT_HAPPY_EMBED` +
   `COPILOT_CONNECTION_TOKEN` when the Happy route is explicitly enabled, so a
   plain `copilot` invocation outside Happy is byte‑identical to today.
7. **Later remote‑approval ownership model (T6).** If/when the phone answers
   approvals, define terminal‑vs‑phone authority and the disconnect‑safe restore
   (the `sdkServer.ts:4625‑4628` race). *Decision needed only if T6 is
   scheduled.*

---

## 10. Source‑citation index

**Copilot runtime (`C:\efforts\copilot-agent-runtime`):**

- Mode selection / interactive invocation: `src/cli/index.ts:1409, 1827,
  2389‑2408, 4220, 4275‑4282`.
- Managed bootstrap + permissions: `src/core/sdkServer.ts:5840‑5841,
  5895‑5906, 5955‑5959, 6047, 6094‑6172`.
- **Token model (B1 + N2 — two sinks):** `SDKServer` `connectionToken` option
  `src/core/sdkServer.ts:236`; native TCP token gate `1665‑1668, 1670‑1700`;
  no‑token warning `1690‑1691`; server‑mode env read (interactive path does NOT
  read this) `5840‑5841`. `EmbeddedServerOptions` has no token field
  `src/cli/embeddedServer.ts:31‑64`; inner `SDKServer` built without token
  `101‑119`; `EmbeddedServer.start` delegates to inner start and publishes
  nothing `152‑163`. Managed path feeds the **same** token to both sinks —
  `SDKServer` `sdkServer.ts:5889` and `RegistryPublisher` `sdkServer.ts:6050`.
  `RegistryPublisher` takes its **own** `connectionToken` constructor arg,
  stored verbatim in the entry `src/core/remoteRegistry/registryPublisher.ts:53‑66,
  79‑90, 83‑84`, and never re‑reads env `30‑33`.
- **Registry publisher wiring (N2):** the only non‑test `new RegistryPublisher`
  is the managed block `src/core/sdkServer.ts:6047` (lifecycle
  cleanup‑before‑start / start / setStatus / setSession / heartbeat `6039‑6091`;
  sole `.setSession` caller `6080`); the class docstring's "two callers …
  `EmbeddedServer` for `--ui-server`" is **aspirational, not wired**
  `src/core/remoteRegistry/registryPublisher.ts:10‑20` (grep‑verified: no
  `new RegistryPublisher` in `embeddedServer.ts`/`interactiveMode.ts`). Publisher
  lifecycle API: options `registryPublisher.ts:53‑66`; ctor `79‑90`; `start`
  (ui‑server writes immediately) `97‑116`; `setSession` `123‑140`; heartbeat
  interval const + method `51, 240‑247`; `stop` unconditional unlink + shutdown
  guard `249‑266, 25‑27`; stale‑mtime backstop `45‑49`.
- **Foreground guard + setForeground (B2):** `registerSession` `local-attach`
  refusal gated on `isAgentsTabEnabled` `src/cli/embeddedServer.ts:241‑278`
  (guard + comment `245‑273`, condition `264‑268`); external `session.setForeground`
  fires the TUI callback `src/core/sdkServer.ts:1465‑1472`; protocol method
  `src/core/protocol/types.ts:2385‑2386`, request/response `2194‑2198`.
- Capability/permission provider routing:
  `src/core/sdkServer.ts:900‑903, 2379‑2384, 3262‑3263, 3356, 3432‑3441,
  3642‑3645, 4549‑4610, 4625‑4628`.
- Protocol methods/notifications + event fidelity:
  `src/core/protocol/types.ts:1725‑1726, 2282‑2350, 2374‑2408`.
- Controller precedent (`LocalRpcSession`): `src/core/sharedApi/localRpcSession.ts:319,
  320‑347, 386, 559‑640, 874‑892, 1332, 1403`.
- Answer helpers: `src/cli/permissions/respondToPermissionViaApi.ts:34‑63`;
  `src/cli/helpers/respondToUiViaApi.ts:44‑106`.
- Interactive embedded server + signals + exit:
  `src/cli/interactiveMode.ts:626‑651, 678‑690, 1068, 1282`;
  `src/cli/embeddedServer.ts:74, 152, 241‑278`.
- Registry: `src/core/remoteRegistry/registryPublisher.ts:10‑20` (docstring —
  aspirational two‑caller contract), `53‑66, 79‑90` (options/ctor incl. own
  `connectionToken`), `97‑116, 123‑140, 240‑247, 249‑266` (lifecycle), `30‑33,
  45‑49`; `src/core/remoteRegistry/serverRegistry.ts:14‑18, 43, 93‑111, 104‑152,
  156‑161` (**S2:** v1 `kind` omitted on disk, normalized on read `97‑99,
  108‑111, 156‑161`).
- Managed‑server has no TUI: `src/cli/sessions/spawnLiveTarget.ts:10‑14`.

**Happy CLI (M1a, this repo):**

- Managed spawn + validator + token: `packages/happy-cli/src/agent/copilot/managedServer.ts:102‑126,
  136, 150‑156, 158‑200` (validator hard‑rejects non‑managed/schema‑2 at
  `110‑122`).
- Constants + projected event types + entry type:
  `packages/happy-cli/src/agent/copilot/types.ts:7‑9, 11‑22, 36‑52`.
- Client / projection / relay: `packages/happy-cli/src/agent/copilot/nativeLocalRpcClient.ts`,
  `eventProjection.ts`, `eventRelay.ts`, `runCopilotMirror.ts`.

**Parent launcher plan:**
`plans/happy-evcopilot-onedrive-launcher-integration/plan.md:62‑87, 980‑1006`
(P0 `988‑1006`; **N1** P4 rewrites Happy spawn/validator/provenance `1051‑1064`,
esp. `1056‑1058`).
