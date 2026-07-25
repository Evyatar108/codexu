# Copilot → Happy embedded UI-server handoff

**Audience:** engineers maintaining the Copilot fork/runtime  
**Scope:** Copilot-owned work needed to expose an ordinary interactive session
to Happy as a read-only local mirror  
**Authority:** `C:\efforts\codexu\plans\happy-copilot-terminal-route-v1-design\design.md`

> This is an implementation handoff, not a new architecture proposal. The
> linked design has completed independent source review. Follow it if this
> abridged handoff is ambiguous.

## Executive summary
The selected route keeps the genuine interactive `copilot` TUI in charge and
side-attaches Happy to that same session over Copilot's existing loopback
JSON-RPC server.

The user continues to enter ordinary `copilot <args>`. Only when EvCopilot's
default-off Happy route is enabled does its launcher select and validate an
exact cached EvCopilot/Happy release set and set the opt-in environment for the
selected Copilot process. Copilot then:

1. follows its normal interactive path with original argv unchanged;
2. starts its existing embedded SDK server on loopback and an ephemeral port;
3. requires one per-launch connection token;
4. publishes a discoverable `ui-server` registry entry; and
5. keeps that entry synchronized with the foreground session.

The per-machine Happy daemon discovers the entry and attaches read-only. It
projects Copilot events into the happy-server embedded in that daemon. There is
no central Happy broker and no replacement terminal UI.

### Why a Copilot change is required
Happy M1a already mirrors a **managed/headless** Copilot server. That child has
no TUI. A Happy-only solution would have to recreate Copilot's argv grammar,
input, streaming renderer, approvals, Ctrl+C behavior, resume, and exit codes;
that replaces rather than preserves the ordinary terminal experience.

Copilot already has most of the interactive attach substrate, but ordinary
launch does not expose it safely:

- ordinary interactive launch does not enable the embedded listener;
- `--ui-server` enables that listener, but `EmbeddedServerOptions` has no token;
- the inner interactive `SDKServer` consequently receives no token; and
- interactive `EmbeddedServer` never constructs a `RegistryPublisher`, so no
  registry entry exists for Happy to discover.

Injecting a flag from Happy cannot repair the missing token plumbing or
publisher lifecycle. The required fork seam is bounded: enable, authenticate,
and publish existing machinery without changing the terminal or RPC protocol.

## Current state
### Interactive runtime
Ordinary Copilot already owns native argv parsing, streaming rendering, prompt
input, tool approvals/elicitation, signal handling, resume, and exit codes.
Mode selection and interactive invocation are at
`C:\efforts\copilot-agent-runtime\src\cli\index.ts:1409,1827,2389-2408,4220,4275-4282`.
Absent `--ui-server`, `embeddedServer` is `undefined`, so the opt-in must
synthesize a complete config rather than flip a field. Interactive mode already
constructs `EmbeddedServer` and starts its listener when enabled
(`src\cli\interactiveMode.ts:626-651`; `src\cli\embeddedServer.ts:152-163`).

The missing pieces are source-verified:
- no token option: `src\cli\embeddedServer.ts:31-64`;
- inner `SDKServer` receives no token: `src\cli\embeddedServer.ts:101-119`;
- `EmbeddedServer.start()` starts only the listener: `src\cli\embeddedServer.ts:152-163`;
- the only non-test `new RegistryPublisher` is managed bootstrap:
  `src\core\sdkServer.ts:6047`.
The publisher docstring's `EmbeddedServer` caller is aspirational, not wired:
`src\core\remoteRegistry\registryPublisher.ts:10-20`.

### Happy M1a
M1a spawns `copilot --server --port 0 --managed-server ...`, validates its
schema-v2 registry entry, authenticates, resumes the foreground, reads
history/live events, and projects a closed event set through a restricted
`mirror-read-only` Happy profile. It cannot preserve ordinary terminal UX
because its target is headless.
Relevant Happy sources are under
`C:\efforts\codexu\packages\happy-cli\src\agent\copilot\`:
`managedServer.ts`, `nativeLocalRpcClient.ts`, `eventProjection.ts`,
`eventRelay.ts`, and `runCopilotMirror.ts`.

## Desired end-to-end flow
```text
operator: copilot <original args>
  |
  v
EvCopilot default-off route gate
  - explicitly enabled
  - selects exact cached EvCopilot + Happy release set
  - validates manifests/hashes/package/protocol/launch context
  - preserves original argv
  - sets COPILOT_HAPPY_EMBED=1
  - supplies per-launch COPILOT_CONNECTION_TOKEN
  |
  v
selected ordinary interactive Copilot
  - normal runInteractiveMode
  - synthesizes EmbeddedServer config only under the gate
  - binds 127.0.0.1:0
  - authenticates listener
  - publishes ~/.copilot/servers/<pid>.json
  - publishes foreground sessionId and transitions
  - remains terminal-authoritative
  |
  v
per-machine Happy daemon
  - validates expected local entry and authenticates
  - attaches read-only
  - mirrors history and live events
  - never sets foreground, sends, aborts, or answers approvals
  |
  v
happy-server embedded in that daemon -> Happy app read-only view
```

There is no central server. Every machine's daemon embeds its own happy-server.

## Exact bounded Copilot seam
Keep edits in interactive launch option assembly, `EmbeddedServer`, and reuse
of `RegistryPublisher`. Do not add RPC methods or alter the event model.

### 1. Default-off config synthesis
Recommended trigger:

```text
COPILOT_HAPPY_EMBED=1
```

At `src\cli\index.ts:4275-4282`, synthesize:

```ts
{
  enabled: true,
  host: "127.0.0.1",
  port: 0,
  connectionToken
}
```

The environment seam is preferred to injected `--ui-server` because argv stays
byte-identical. Requirements:
- gate off preserves exact current behavior;
- gate on forces loopback and an ephemeral port;
- original argv is not changed or reinterpreted;
- no Agents-tab flags or watcher are enabled; and
- token acquisition failure fails closed.

Owner: `C:\efforts\copilot-agent-runtime\src\cli\index.ts:4275-4282`.

### 2. Capture or generate one per-launch token
Preferred: EvCopilot generates the token and passes
`COPILOT_CONNECTION_TOKEN`. Interactive launch must explicitly read it; the
existing read at `src\core\sdkServer.ts:5840-5841` is server-mode-only.
Alternative: generate it at the gated interactive launch site.

Whichever option is selected:

- use one value for both token sinks below;
- clear the env value after capture, before tools/subagents inherit it;
- never place it in argv, logs, diagnostics, metadata, provenance, or snapshots;
- reject empty/invalid tokens; and
- fail closed if secure generation/capture fails.

### 3. Authenticate the inner SDK server
Add `connectionToken?: string` to `EmbeddedServerOptions`, then pass
`connectionToken: options.connectionToken` into its inner `SDKServer`.

Owners/citations:
- `C:\efforts\copilot-agent-runtime\src\cli\embeddedServer.ts:31-64`
- `C:\efforts\copilot-agent-runtime\src\cli\embeddedServer.ts:101-119`
- existing option: `C:\efforts\copilot-agent-runtime\src\core\sdkServer.ts:236`
- native gate: `C:\efforts\copilot-agent-runtime\src\core\sdkServer.ts:1665-1700`

With the Happy gate enabled, an anonymous listener is forbidden.

### 4. Wire a UI-server `RegistryPublisher`
Model the interactive lifecycle on the proven managed block:
`C:\efforts\copilot-agent-runtime\src\core\sdkServer.ts:6039-6091`.

The natural owner is `EmbeddedServer`, which owns listener start, foreground
registration, and shutdown:

- `src\cli\embeddedServer.ts:143-145,152-163,241-278`.

Only when the TCP listener actually starts:

1. construct `RegistryPublisher` with `kind: "ui-server"`, loopback host, the
   same `connectionToken`, and `pid: process.pid`;
2. register `publisher.stop()` with shutdown **before** `publisher.start()`;
3. call `publisher.start(actualPort, startedAt)`;
4. call `publisher.setSession(foregroundSession)` for the initial foreground;
5. call `setSession` on every foreground transition;
6. run the existing heartbeat on an `unref`'d interval; and
7. call `stop()` on orderly shutdown.

`registerSession` currently receives a session ID, while `setSession` requires
the `Session`. Resolve it through the existing `sessionManager`; do not create
a second session or foreground source.

Publisher citations:
- constructor/options: `src\core\remoteRegistry\registryPublisher.ts:53-90`
- `start`: `src\core\remoteRegistry\registryPublisher.ts:97-116`
- `setSession`: `src\core\remoteRegistry\registryPublisher.ts:123-140`
- heartbeat: `src\core\remoteRegistry\registryPublisher.ts:51,240-247`
- `stop`/unlink: `src\core\remoteRegistry\registryPublisher.ts:249-266`
- stale backstop: `src\core\remoteRegistry\registryPublisher.ts:45-49`

### 5. Publish foreground transitions; do not enable Agents tab
The initial registry entry may omit `sessionId`. First `setSession` populates
it; later calls keep it aligned with the TUI foreground. Happy polls until it
appears.

Do not enable `AgentRegistryWatcher`, whose independent gate is at
`C:\efforts\copilot-agent-runtime\src\cli\interactiveMode.ts:678-690`.
The embed gate must not expose an Agents tab, watch/spawn agents, or alter
terminal navigation.

### 6. Enforce the read-only v1 client contract
Happy may call `connect`, `session.getForeground`, read-only `session.resume`,
history/event-log reads, and subscribe to `session.event`. Resume uses
`observePromptEvents: true` and `requestPermission: false`.

It must never invoke:

- `session.setForeground`;
- `session.send`;
- `session.abort`;
- permission, elicitation, or user-input answer methods; or
- global configuration, filesystem, shell, plugin, MCP, or extension methods.

The terminal remains sole foreground owner and approval UI. Protocol citations:
- `C:\efforts\copilot-agent-runtime\src\core\protocol\types.ts:2374-2408`
- foreground callback: `src\core\sdkServer.ts:1465-1472`

## Critical: two independent token sinks
```text
one token
  +--> EmbeddedServerOptions.connectionToken
  |      \--> inner SDKServer --> native listener authentication
  |
  \--> RegistryPublisher({ connectionToken })
         \--> ~/.copilot/servers/<pid>.json token
```

`RegistryPublisher` captures its own constructor argument and never re-reads
env (`registryPublisher.ts:30-33,53-90`). Threading only into `SDKServer`
authenticates the listener but does not publish a discovery credential.
Threading only into the publisher advertises a token the listener does not
enforce. Either mistake is a release blocker.

Managed mode demonstrates both sinks:

- listener: `C:\efforts\copilot-agent-runtime\src\core\sdkServer.ts:5889`
- publisher: `C:\efforts\copilot-agent-runtime\src\core\sdkServer.ts:6050`

## Registry contract Happy expects
Canonical directory: `~\.copilot\servers\`; filename: `<pid>.json`.

| Field/condition | Contract |
|---|---|
| Schema | UI-server schema v1 |
| `kind` on disk | Omitted in v1; normalized to `"ui-server"` on read |
| Host | Loopback (`127.0.0.1`; registry also recognizes localhost/`::1`) |
| Port | Actual ephemeral bound port |
| PID/start | Interactive process PID and per-launch `startedAt` |
| Token | Non-null; identical to listener token |
| `sessionId` | May start absent; populated and updated by `setSession` |
| Version | `copilotVersion` compatible with the selected release set |
| Protocol | Existing native local RPC; Happy validates protocol compatibility |

Format: `src\core\remoteRegistry\serverRegistry.ts:14-18,43,93-161`.
Do not migrate this entry to schema v2. Happy deliberately accepts schema v1
with omitted raw `kind`.

Discovery lifecycle:

1. listener binds and returns its actual port;
2. publisher writes one `<pid>.json`, possibly without `sessionId`;
3. foreground registration calls `setSession` and republishes;
4. later foreground transitions republish;
5. heartbeat refreshes the entry while the process lives;
6. clean shutdown calls `stop()` and unlinks it; and
7. a hard-crash orphan is removed by the existing roughly five-minute
   stale-mtime sweep after heartbeats stop.

One publisher and PID-based filename prevent duplicates. Happy separately
checks liveness and expected launch identity before attaching.

## Security, ownership, and failures
Security requirements:
- loopback only; no anonymous listener;
- unpredictable per-launch token, supplied to both sinks;
- env cleared after capture;
- token never copied to argv/logs/telemetry/Happy metadata/evidence;
- canonical registry file-permission behavior retained;
- no raw native RPC exposed to the phone;
- no shell launch in the selected artifact chain; and
- gated initialization fails closed.
The registry stores the token in plaintext by existing design. Unix uses
`0700` directory/`0600` file permissions. Windows additionally relies on the
local account's ambient ACLs; stronger DACL/reparse hardening is later work.
Preferred token lifetime is one interactive process: launcher generation,
environment transfer, immediate env clearing, in-memory plus registry use, and
registry deletion on shutdown/stale cleanup. In-process generation remains an
open alternative, but independently generated listener/publisher tokens are
never valid.
Copilot owns terminal input/rendering, foreground, approvals, cancellation,
exit behavior, listener lifetime, and registry lifetime. Happy owns only its
read-only attachment. Happy disconnect/restart must not stop or steer Copilot;
late attach replays persisted final events.
The existing `local-attach` foreground refusal is gated by
`isAgentsTabEnabled` (`src\cli\embeddedServer.ts:241-278`, condition
`264-268`). Agents tab remains off, so that guard is not load-bearing.
The v1 safety boundary is Happy's tested method allowlist. Optional hardening
may make the refusal unconditional, but must not enable the watcher.

Failure semantics:
- gate off: no listener/publisher or behavior change;
- missing token: fail closed, never anonymous;
- start failure: cleanup was registered first, preventing an orphan;
- publisher failure: do not advertise route capability;
- clean shutdown: stop heartbeat/listeners and unlink;
- hard crash: existing stale cleanup reaps the orphan;
- Happy unavailable: terminal remains authoritative/usable; launcher reports
  mirror failure under its status contract; and
- Happy reconnect: hydrate history without mutation RPCs.

## Compatibility and non-goals
Compatibility:
- behavior changes only under `COPILOT_HAPPY_EMBED=1`;
- original argv and native TUI behavior remain unchanged;
- server/headless/managed modes remain unchanged;
- native local RPC is reused without a protocol redesign/version bump;
- UI-server registry stays schema v1 with omitted disk `kind`; and
- Agents-tab watcher remains independently gated and off.

Non-goals:
- replacement TUI or Happy-authored terminal UX;
- central Happy server/broker;
- phone send, abort, steering, approvals, or elicitation answers in v1;
- new RPC methods or broad protocol redesign;
- global Copilot policy/config mutation;
- shell launch; or
- any behavior change when the gate is disabled.

## Copilot-owned implementation decomposition
### C1 — gate and token capture (`src\cli\index.ts`)
Implement env gate, token capture/generation, env clearing, full config
synthesis, loopback/port zero, and fail-closed behavior. Tests prove gate-off
identity, exact gated config, unchanged argv, no secret output, and no
Agents-tab flag changes.

### C2 — authenticated listener (`src\cli\embeddedServer.ts`)
Add the option and pass it to inner `SDKServer`. Tests prove tokenless connect
is rejected, correct-token connect succeeds, gated missing-token startup fails,
and seam-off behavior remains unchanged.

### C3 — publisher lifecycle (`src\cli\embeddedServer.ts`)
Construct/start/setSession/heartbeat/stop the UI-server publisher and resolve
foreground `Session` through `sessionManager`. Tests prove exactly one
schema-v1 entry, omitted raw kind, exact PID/port/token/version, eventual and
transitioning `sessionId`, clean unlink, and stale-crash cleanup.

### C4 — behavior/ownership regressions
Compare gate on/off ordinary interactive suites. Assert unchanged argv, terminal
behavior, Ctrl+C, and exit code; no managed idle timeout; no Agents watcher;
both token sinks populated; and fail-closed behavior when either is absent.

Focused acceptance matrix:
| ID | Scenario | Result |
|---|---|---|
| CP-1 | Gate absent | No listener/entry/UX change |
| CP-2 | Gate on | Loopback listener + one UI-server entry |
| CP-3 | No/wrong token | Connect rejected |
| CP-4 | Correct token | Existing handshake succeeds |
| CP-5 | Entry inspection | Schema 1, omitted kind, exact PID/port/token/version |
| CP-6 | Foreground start/change | `sessionId` appears and updates |
| CP-7 | Clean exit/Ctrl+C | Entry unlinked |
| CP-8 | Hard crash | Existing stale sweep removes orphan |
| CP-9 | Agents tab disabled | No watcher/tab side effect |
| CP-10 | Two-sink fault injection | Omitting either sink fails |

External release acceptance remains Happy/EvCopilot-owned, but must prove a real
terminal-authored turn mirrors and the Happy client emits zero mutation RPCs.

## Integration boundary
### Happy/codexu and EvCopilot already handle
- strict launch-context and immutable artifact-path validation;
- exact manifest/package/hash/receipt/archive/SBOM cross-binding;
- exact local `happy\release-sets\<id>.json` selection;
- package/protocol compatibility checks;
- direct executable launch with `shell: false`;
- per-machine daemon identity, routed readiness, drain, and replacement;
- path-free provenance and monotonic launcher status;
- M1a JSON-RPC client, event projection, delivery, and read-only Happy profile;
- packaging/capability advertisement; and
- one embedded happy-server per machine.

See `C:\efforts\codexu\docs\copilot-cli-integration.md:1082-1129`.

### Copilot owns now
- default-off interactive embed gate;
- token capture/generation and both sinks;
- authenticated embedded-listener startup;
- interactive UI-server registry lifecycle;
- foreground publication/heartbeat/cleanup; and
- regression tests proving ordinary TUI equivalence.

### EvCopilot/Happy still own later
- setting the gate only for a validated release set;
- token generation/transfer if launcher-generated;
- schema-v1 omitted-kind discovery and `sessionId` polling;
- PID/start/version/protocol/release-set validation;
- adapting M1a from headless spawn to read-only attach;
- enforcing the mutation-method denylist;
- real-session acceptance and capability activation; and
- separately designed future phone steering/approvals.

## Open decisions
1. Trigger: recommended env seam or injected flag.
2. Token source: launcher-generated (recommended) or Copilot-generated.
3. Confirm gated missing-token startup fails closed.
4. Confirm process-lifetime registry token is acceptable under Windows ACLs.
5. Foreground hardening: read-only allowlist only, or unconditional
   `local-attach` refusal.
6. Keep publisher lifecycle in `EmbeddedServer`, with only a tiny helper
   elsewhere if session resolution requires it.
7. Confirm read-only phone mirroring is sufficient for v1 capability.
8. Define secret-safe user error for listener/publisher initialization failure.

## References
- Full reviewed design:
  [`..\plans\happy-copilot-terminal-route-v1-design\design.md`](..\plans\happy-copilot-terminal-route-v1-design\design.md)
- Happy integration/M1a:
  [`copilot-cli-integration.md`](copilot-cli-integration.md)
- Copilot source root: `C:\efforts\copilot-agent-runtime`
- Mode/options: `src\cli\index.ts:1409,1827,2389-2408,4220,4275-4282`
- Embedded server: `src\cli\embeddedServer.ts:31-64,101-163,241-278`
- Interactive/watcher: `src\cli\interactiveMode.ts:626-651,678-690`
- SDK auth/managed precedent:
  `src\core\sdkServer.ts:236,1665-1700,5840-5841,5889,6039-6091`
- Publisher:
  `src\core\remoteRegistry\registryPublisher.ts:10-20,30-33,45-140,240-266`
- Registry schema: `src\core\remoteRegistry\serverRegistry.ts:14-18,43,93-161`
- Protocol: `src\core\protocol\types.ts:1725-1726,2282-2408`
- Attach precedent: `src\core\sharedApi\localRpcSession.ts:319-347,559-640,874-892`
