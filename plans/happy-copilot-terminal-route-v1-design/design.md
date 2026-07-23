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
2. **The Option B seam is genuinely thin**, contradicting the natural
   assumption that "mirror a live TUI" requires deep forking. Copilot already
   ships the entire attach surface: an interactive‑TUI‑plus‑embedded‑JSON‑RPC
   mode (`--ui-server`), a discovery registry, and a **complete in‑product
   controller** (`LocalRpcSession` + the Agents tab) that attaches to such a
   session, renders it, and answers its approvals/elicitation. The fork change
   reduces to *"let the ordinary interactive launch expose its embedded server
   on loopback behind a token, without changing anything the user sees."*
3. **Option A's genuine advantages are real but off‑target here.** Zero fork
   change, perfectly symmetric mirroring (Happy owns both ends), and the
   simplest one‑session‑ownership story. Those matter for a *Happy‑native
   cross‑device UI where the phone is co‑equal or primary and byte‑fidelity to
   Copilot's terminal is a non‑goal.* That is explicitly **not** this task.

**Recommended shape (v1, read‑mirror first):** ordinary `copilot <args>` runs
the real interactive TUI; a **narrow fork env‑seam** (`COPILOT_HAPPY_EMBED=1`
+ a generated loopback token) makes that interactive process start its
already‑existing embedded server and publish a registry entry; Happy's daemon
attaches **read‑only** (observe + mirror to the phone, human at the terminal
still owns approvals) and projects events to the embedded happy‑server exactly
as M1a already does. Phone‑originated input and phone‑answered approvals are
**additive later milestones**, not part of the v1 preservation contract.

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
  `src/cli/index.ts:4275‑4281`).

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

### 2.6 The `--ui-server` embedded server (Option B's seam already exists)

The interactive TUI can already publish the same RPC surface:

- The interactive path constructs an `EmbeddedServer` and starts its TCP
  listener **only when `--ui-server` is enabled**
  (`src/cli/interactiveMode.ts:626‑651`: "Only start the TCP listener when
  --ui-server mode is enabled"). It is passed to `runInteractiveMode` as
  `embeddedServer: options.uiServer ? {...} : undefined`
  (`src/cli/index.ts:4275‑4281`).
- `RegistryPublisher` writes a `kind:"ui-server"` v1 entry "as soon as
  `start(...)` is called; re‑publishes on every `setSession()` so foreground
  session transitions surface to controllers"
  (`src/core/remoteRegistry/registryPublisher.ts:12‑15`). The token is sourced
  the same way (`src/core/sdkServer.ts:5840`).
- `LocalRpcSession` is documented as attaching to "a local `--ui-server`
  target" (`src/core/sharedApi/localRpcSession.ts:319, 386`). The Agents tab
  attaches one TUI to another TUI's `--ui-server`.
- The embedded server **refuses to register a JSON‑RPC‑attached controller
  session (`kind === "local-attach"`, e.g. a `LocalRpcSession`) as its own
  foreground** (`src/cli/embeddedServer.ts:245‑270`, guard at 268‑270) — attach
  loops are structurally prevented, so a side‑attached controller is a
  *secondary consumer*, never a competing owner of the single foreground
  session.

**Decisive contrast for the two options:** ordinary `copilot` (no
`--ui-server`) does **not** start the listener
(`src/cli/interactiveMode.ts:627`) and publishes **no** registry entry — so
today there is nothing for Happy to attach to. Enabling the embedded server for
the ordinary interactive launch is precisely the "minimal fork seam" Option B
needs, and the entire machinery it plugs into already exists.

### 2.7 Discovery registry shape and boundary

`src/core/remoteRegistry/serverRegistry.ts`: entries are `<pid>.json` files
under `~/.copilot/servers/`; `ServerRegistryEntryKind = "ui-server" |
"managed-server"` (43); the entry carries `schemaVersion (1|2)`, `kind`, `pid`,
`host`, `port`, `token|null`, `sessionId?`, `status?`, `copilotVersion`
(104‑152). Files are `0600`, the dir is `0700`, the token is stored in
plaintext on disk, and **listing filters to localhost‑only hosts** (`127.0.0.1`,
`localhost`, `::1`) (14‑18). This is the baseline security boundary shared by
both options.

### 2.8 Security posture of the RPC surface

The token is sourced from `COPILOT_CONNECTION_TOKEN` for both managed and
ui‑server modes; **if unset the server accepts connections from any local
client** (`src/core/sdkServer.ts:5840‑5841`, warning at 1690‑1691). The
defense‑in‑depth baseline is therefore: loopback‑only bind + localhost registry
filter + `0600/0700` file permissions + optional connection token. M1a already
does the secure thing for Option A — it generates a per‑spawn token and passes
it in the child env (`managedServer.ts:136, 150‑156`). Option B must do the
same for the interactive launch (the fork seam must generate + inject a token,
not leave the embedded server anonymous).

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
expose its **already‑existing** embedded server so Happy can attach:

1. **Fork seam (the only Copilot change).** Make the ordinary interactive
   launch start its embedded server + publish a `ui-server` registry entry when
   opted in, **without** altering user‑visible behavior. Two viable forms:
   - **(B‑env, recommended)** a fork env `COPILOT_HAPPY_EMBED=1` that the fork
     reads to set `embeddedServer.enabled = true` (the field consumed at
     `src/cli/interactiveMode.ts:643‑651`) and to generate + install a loopback
     `COPILOT_CONNECTION_TOKEN` if one is not already present. This keeps the
     user's **argv byte‑identical** to what they typed (strictly honoring the
     "original argv" contract, P0 line 997).
   - **(B‑flag)** have the launcher inject the existing hidden `--ui-server
     --host 127.0.0.1 --port 0` into the child argv. Simpler (no new code path)
     but the injected flag is observable in argv/`--help` and must be proven
     inert for every ordinary arg combination.
   Either way the seam is *"enable the embedded server that already exists"* —
   not new protocol, not new rendering, not new session semantics.
2. **Happy daemon attaches read‑only.** Extend Happy's discovery + client to
   accept a `kind:"ui-server"` schema‑v1 entry (M1a's validator currently
   hard‑rejects anything but `managed-server`/schema‑2,
   `managedServer.ts:110‑122`), then run the M1a handshake with
   `observePromptEvents:true` **but `requestPermission:false`** — Happy watches
   and mirrors; the human at the terminal remains the sole approver. Project to
   the embedded happy‑server via the existing `eventProjection`/`eventRelay`.
3. **Later, additive:** phone→terminal input via `session.send`, and
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
| **Reconnect / resume** | ✓ Native + independent attach | Terminal resume is native; Happy's attach can reconnect independently against the persistent registry entry, and the embedded server refuses to register the attached controller as foreground (`src/cli/embeddedServer.ts:245‑270`), so re‑attach cannot hijack ownership. |
| **Exactly one session + mirror** | ✓ | The interactive TUI's session is the single foreground; Happy is a secondary consumer that mirrors to the embedded happy‑server. |

**Net:** Option B satisfies the P0 contract **by construction** — the ordinary
experience is preserved because it *is* the ordinary experience, with Happy as
a side‑attached mirror.

### 4.3 Conflict surface

- **Copilot source (fork):** small and **isolated by design**. B‑env adds a
  read of one env var at the interactive‑launch site (near
  `src/cli/index.ts:4275‑4281` where `embeddedServer` is already assembled, and
  the token‑source at `src/core/sdkServer.ts:5840`). It does **not** touch the
  typed‑context/ownership controller files P4 edits — satisfying P0's
  co‑edit prohibition (lines 993‑995) *provided the seam is placed in the
  launch/option‑assembly path, not the controller*. This placement is a hard
  design constraint (see §7 staged tasks).
- **Happy source:** discovery/validator changes to accept `ui-server`/schema‑1
  entries (`managedServer.ts:102‑126` today is managed‑only), plus the client
  changes for `observePromptEvents` + streaming deltas. Bounded; reuses the
  existing projection/relay.
- **Ongoing:** low. Happy attaches to a *stable published protocol* (the same
  one the Agents tab consumes), so Copilot upgrades that keep the RPC contract
  don't break Happy — unlike Option A's imitation‑by‑renderer.

### 4.4 Security / ownership / failure semantics

- **Security — token is mandatory.** The fork seam **must** generate + inject
  `COPILOT_CONNECTION_TOKEN`; an anonymous embedded server accepts any local
  client (`src/core/sdkServer.ts:5840‑5841, 1690‑1691`). With the token +
  loopback bind + localhost registry filter + `0600/0700` perms (§2.7‑2.8), the
  boundary matches M1a's managed posture. **New consideration vs Option A:** the
  embedded server now lives inside a *user‑facing interactive process*, so the
  token must be generated by the launcher and passed via env to the child
  (same pattern as `managedServer.ts:150‑156`), never written to argv/logs.
- **Ownership — clean, single foreground.** The interactive session is the sole
  foreground; Happy's attach is explicitly non‑owning
  (`embeddedServer.ts:245‑270`). This directly satisfies "exactly one
  target/session."
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

1. **The seam is thin but not zero.** It is a real Copilot fork change plus
   Happy discovery/client work. The claim being made is "minimal," not "free."
2. **`--ui-server` behavior‑equivalence must be proven.** B‑env must set only
   `embeddedServer.enabled` (+ token) and nothing else; in particular it must
   **not** silently enable the Agents‑tab watcher or any UX that plain
   interactive lacks. The interactive path constructs `EmbeddedServer`
   unconditionally but only starts the listener when enabled
   (`interactiveMode.ts:626‑651`); the Agents‑tab watcher is gated separately on
   `agentsTabEnabled` (`interactiveMode.ts:678‑690`). The seam must flip the
   listener **without** flipping the watcher — an acceptance test must confirm a
   byte‑for‑byte identical interactive experience with the seam on vs off,
   modulo the loopback listener.
3. **Happy validator must learn a second entry shape.** `ui-server` is
   schema‑v1 with `kind` omitted‑on‑disk and `sessionId` populated only after
   the first `setSession()` (`serverRegistry.ts:97‑100, 156‑158`;
   `registryPublisher.ts:12‑15`). Happy's discovery must poll for a populated
   `sessionId` (the same race the managed picker handles) rather than assuming
   it is present at first publish.

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
| One session + mirror | ✓ | ✓ (`embeddedServer.ts:245‑270`) |
| Copilot fork change | **none** | **small, isolated** (enable existing embedded server) |
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
| F‑1 | `COPILOT_HAPPY_EMBED=1` + ordinary interactive launch | Embedded listener starts, `ui-server` registry entry appears with populated `sessionId`, token matches env (`registryPublisher.ts:12‑15`, `serverRegistry.ts:104‑152`). |
| F‑2 | Seam **off** vs **on** UX equivalence | Interactive experience identical modulo the loopback listener; Agents‑tab watcher **not** enabled by the seam (`interactiveMode.ts:626‑690`). |
| F‑3 | Anonymous‑server guard | With the seam on but no token, either a token is generated or the bind fails closed; never an anonymous listener (`sdkServer.ts:5840‑5841, 1690‑1691`). |
| F‑4 | Placement guard | Seam edits live in the launch/option‑assembly path, not P4's controller files (P0 lines 993‑995) — enforced by a codeowners/path check in the PR. |

### 7.2 Happy attach/mirror tests (Option B, real surface — no stimulus client)

| ID | Test | Assertion |
|---|---|---|
| H‑1 | Discover + validate a `ui-server`/schema‑1 entry | Happy accepts it (today's validator rejects it, `managedServer.ts:110‑122`); waits for populated `sessionId`. |
| H‑2 | Read‑only attach handshake | `connect`→`getForeground`→`resume(observePromptEvents:true, requestPermission:false)`→`getMessages`; transcript hydrated (`localRpcSession.ts:320‑347`). |
| H‑3 | Live mirror of a **real** typed turn | Operator types in the terminal; final events (`user.message`…`assistant.turn_end`) project to the embedded happy‑server and render on the phone (M1a projection). |
| H‑4 | Approval mirrored read‑only | A real tool‑approval prompt at the terminal surfaces as `permission.requested` on the phone (read‑only); the human answers at the terminal; no phone answer path in v1. |
| H‑5 | Ctrl+C at terminal | Cancels the turn / exits per native semantics; Happy observes `abort`/`session.shutdown` and updates the mirror; Happy does not crash or wedge. |
| H‑6 | Exit code fidelity | The interactive process's exit code is unchanged with the seam on (compare to seam off). |
| H‑7 | Attach‑after‑start | Happy attaches mid‑session; `getMessages` replay yields a complete mirror (`localRpcSession.ts:613‑627`). |
| H‑8 | Detach/reconnect | Happy disconnects and re‑attaches without disturbing the terminal; embedded server never registers the controller as foreground (`embeddedServer.ts:245‑270`). |
| H‑9 | Idle longevity | An idle interactive terminal is **not** reaped by a managed idle‑timeout (managed‑only path, `sdkServer.ts:5895‑5906`) — confirms Option B avoids A's idle‑reap. |

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

Sequencing honors P0: **design now, implement after P4, and do not co‑edit P4's
Copilot controller files** (lines 993‑995). All tasks assume Option B.

- **T0 (this document).** Source‑verified design + recommendation. *Done on
  commit of this file.*
- **T1 — Copilot fork seam (`COPILOT_HAPPY_EMBED`).** Add the env‑gated enable
  of the existing embedded server + token generation at the interactive
  launch/option‑assembly site (near `src/cli/index.ts:4275‑4281`; token at
  `src/core/sdkServer.ts:5840`). **Constraint:** new code path only; no edits to
  the typed‑context/ownership controller files P4 touches. Ships behind the env,
  default‑off. Tests F‑1…F‑4. *Starts after P4.*
- **T2 — Happy discovery + validator for `ui-server` entries.** Generalize
  `managedServer.ts:102‑126` to accept `kind:"ui-server"`/schema‑1 and to wait
  for a populated `sessionId`. Tests H‑1. *Parallelizable with T1 (Happy tree).*
- **T3 — Happy read‑only attach client.** Extend `nativeLocalRpcClient.ts` to
  resume with `observePromptEvents:true`, subscribe to streaming deltas +
  request events, and project via the existing `eventProjection`/`eventRelay`.
  Tests H‑2…H‑9. *Depends on T1+T2.*
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
   B‑env keeps argv byte‑identical (strictest "original argv" reading) at the
   cost of a small new fork code path; B‑flag reuses an existing hidden flag but
   is observable in argv. Recommendation: **B‑env**. *Decision needed before T1.*
3. **v1 scope = read‑only mirror?** This design scopes v1 to preserve + mirror,
   with phone input/approvals deferred to T6. Confirm that "an ordinary
   interactive session with phone mirroring" (P0 line 1004) is satisfied by a
   read‑only phone mirror, or whether phone‑originated input is required for the
   capability to flip. *Decision needed before T4/T5.*
4. **Token lifetime + storage.** The embedded server's token sits in the
   `0600` registry file in plaintext (`serverRegistry.ts:14‑15`). Confirm the
   loopback‑only + file‑perms boundary is acceptable for the interactive process
   (it is the same boundary M1a already accepts for the managed child), or
   whether an additional rotation policy is wanted.
5. **Interaction with the launcher's default‑off posture.** The seam is
   default‑off; confirm the launcher only sets `COPILOT_HAPPY_EMBED` when the
   Happy route is explicitly enabled, so a plain `copilot` invocation outside
   Happy is byte‑identical to today.
6. **Later remote‑approval ownership model (T6).** If/when the phone answers
   approvals, define terminal‑vs‑phone authority and the disconnect‑safe restore
   (the `sdkServer.ts:4625‑4628` race). *Decision needed only if T6 is
   scheduled.*

---

## 10. Source‑citation index

**Copilot runtime (`C:\efforts\copilot-agent-runtime`):**

- Mode selection / interactive invocation: `src/cli/index.ts:1409, 1827,
  2389‑2408, 4220, 4275‑4281`.
- Managed bootstrap + permissions: `src/core/sdkServer.ts:5840‑5841,
  5895‑5906, 5955‑5959, 6047, 6094‑6172`.
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
- Registry: `src/core/remoteRegistry/registryPublisher.ts:12‑15`;
  `src/core/remoteRegistry/serverRegistry.ts:14‑18, 43, 97‑100, 104‑152,
  156‑158`.
- Managed‑server has no TUI: `src/cli/sessions/spawnLiveTarget.ts:10‑14`.

**Happy CLI (M1a, this repo):**

- Managed spawn + validator + token: `packages/happy-cli/src/agent/copilot/managedServer.ts:102‑126,
  136, 150‑156, 158‑200`.
- Constants + projected event types + entry type:
  `packages/happy-cli/src/agent/copilot/types.ts:7‑9, 11‑22, 36‑52`.
- Client / projection / relay: `packages/happy-cli/src/agent/copilot/nativeLocalRpcClient.ts`,
  `eventProjection.ts`, `eventRelay.ts`, `runCopilotMirror.ts`.

**Parent launcher plan:**
`plans/happy-evcopilot-onedrive-launcher-integration/plan.md:62‑87, 980‑1006`.
