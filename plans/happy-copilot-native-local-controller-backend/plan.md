# Happy Copilot native local-controller backend

## 1. Decision, scope, and source baseline

Implement GitHub Copilot CLI as a Happy backend by attaching a Happy-owned
controller to a headless Copilot managed-server target over Copilot's native
loopback JSON-RPC.

Source baseline:

- codexu start: `ad7fb259e3391aaec2e2018fe9a9b2b9ad448449`
- Copilot runtime, read-only:
  `C:\efforts\copilot-agent-runtime@1f19c0c1ccd2502b1cce8372419a831cf533f37f`
- Copilot registry schema: `2`
- Copilot native protocol: `3`
- design source:
  `origin/main:docs/copilot-cli-integration.md`, corrected in this plan commit

The first implementation is deliberately narrow: a terminal-started,
default-off, read-only mirror. It owns managed-target lifecycle, imports durable
history, follows live events, projects only an allow-listed event surface into
typed Happy `SessionEnvelope`s, and leaves happy-server and happy-app pagination
unchanged.

Out of scope:

- the optional ACP telemetry-untag patch;
- exposing native Copilot JSON-RPC to a phone;
- daemon/app new-session selection;
- arbitrary shell, workspace, filesystem, global config, MCP mutation,
  plugins/extensions, global permission policy, or raw privileged permission
  APIs;
- UI-server/TUI co-steering in the first implementation;
- a Copilot runtime edit.

## 2. Source-verified corrections

### 2.1 Native target and protocol

The target is:

```text
copilot --server --port 0 --managed-server
```

It is headless, TCP-only, loopback-only, and requires the
`COPILOT_AGENTS_TAB` feature. The runtime publishes
`<COPILOT_HOME>/servers/<pid>.json` with schema 2, kind `managed-server`, PID,
host, port, token, session ID, start time, and Copilot version
(`spawnLiveTarget.ts:233-318,394-423`;
`sdkServer.ts:5781-5807,5836-5841,5955-6052`;
`serverRegistry.ts:5-21,87-174`).

Frames use JSON-RPC 2.0 with:

```text
Content-Length: <UTF-8 byte count>\r\n\r\n<JSON>
```

The read-only connection sequence is `connect` ->
`session.getForeground` -> the source-defined attach bridge
`session.resume({disableResume:true, streaming:true, request*:false,
observePromptEvents:false})`; handlers must be installed before the first
request. The bridge is required to register the foreground session in the
server's session-routing table, but it supplies no tools, commands, callbacks,
or prompt observers. The relay then uses generated `session.eventLog.read`
against that active foreground session, not
`session.getMessages` plus a parallel notification stream
(`localRpcSession.ts:450-557,566-618`;
`apiDispatch.ts:268-270`;
`sessionEventsApi.ts:206-350`).

### 2.2 History codec prerequisite is real

Happy CLI currently sends and receives live session records as plaintext JSON,
while its REST fetch path attempts decryption and drops those rows
(`sessionPayloadCodec.ts:9-24,36-59`; `apiSession.ts:578-595,667-680`).
happy-app already decodes REST and live records symmetrically as plaintext.

Therefore Story 0 is a hard correctness prerequisite: make the CLI fetch path
parse the current plaintext record format. This does **not** re-enable E2E
message encryption. A future encryption migration must version the wire and
migrate all producers/consumers together.

### 2.3 Pagination is already backend-neutral

`POST /v3/sessions/:id/messages` deduplicates `localId` before allocating
session-local seqs (`v3SessionRoutes.ts:144-206`). happy-app cold-loads the last
80 rows, lazy-loads older ranges, sorts by session-local seq, and keeps the
daemon-global socket update seq separate (`sync.ts:1596-1665,1846-1881`;
`applyPrefetchedRange.ts:61-99`).

No server or app pagination edit belongs in this feature.

## 3. Architecture

### 3.1 Call chain

```text
happy copilot
  -> handleCopilotCommand()
  -> create/attach Copilot managed target
  -> NativeLocalRpcClient.connect()
       connect(token)
       session.getForeground()
       session.resume(minimalAttachBridge)
  -> CopilotEventReader
       session.eventLog.read({ sessionId: foreground.sessionId,
                               cursor?, max:500, waitMs<=30000,
                               types:"*", agentScope:"all" })
       drain immediate pages -> stable persisted/ephemeral partial-order merge
  -> CopilotEventProjector
       validate -> classify -> coalesce -> redact excluded fields
       -> SessionEnvelope[]
  -> ApiSessionClient.sendSessionProtocolBatchWithDelivery(
       oldestFirstEnvelopes, deterministicLocalIds)
  -> POST /v3/sessions/:id/messages
  -> existing server seq allocation and app pagination/rendering
```

The event-log cursor is the only Copilot history/live seam. Do not run a second
`session.event` relay, JSONL tail, or `session.getMessages` importer beside it.

### 3.2 Proposed data structures

```ts
type CopilotManagedTarget = {
    registrySchema: 2;
    kind: 'managed-server';
    pid: number;
    host: '127.0.0.1' | 'localhost' | '::1';
    port: number;
    token: string; // memory only
    sessionId: string;
    copilotVersion: string;
    startedAt: string;
    ownedByController: boolean;
};

type CopilotArtifactDigest = {
    role: 'executable' | 'entry-script' | 'bundle' | 'native-addon' | 'package-tree';
    canonicalPath: string;
    sha256: string;
};

type CopilotCompatibility = {
    registrySchema: 2;
    protocolVersion: 3;
    testedTargets: readonly [{
        sourceCommit: '1f19c0c1ccd2502b1cce8372419a831cf533f37f';
        handshakeVersion: '0.0.1';
        commandKind: 'sea' | 'node-entry';
        normalizedBaseArgs: readonly string[];
        artifacts: readonly CopilotArtifactDigest[];
    }];
    requiredMethods: readonly [
        'connect',
        'session.getForeground',
        'session.resume',
        'session.eventLog.read',
        'runtime.shutdown'
    ];
};

type CopilotControllerCheckpointV1 = {
    schemaVersion: 1;
    copilotSessionId: string;
    targetPid: number;
    targetStartedAt: string;
    copilotVersion: string;
    protocolVersion: 3;
    happySessionId: string;
    eventCursor?: string; // safe cursor only
    lastSourceEventId?: string;
    lastEnvelopeTime: number;
    happyReceiveSeq: number;
    pendingLocalIds: string[];
    ownership: 'spawned' | 'attached';
    artifactSetHash: string;
};

type CopilotProjectionState = {
    currentTurnByAgent: Map<string, string>;
    messageDeltas: Map<string, string>;
    reasoningDeltas: Map<string, string>;
    toolCalls: Map<string, { name: string; turnId?: string }>;
    subagentIds: Map<string, string>;
    parentToolToSubagent: Map<string, string>;
    lastEnvelopeTime: number;
};

type CopilotPhoneAction =
    | { kind: 'prompt'; text: string }
    | { kind: 'abort'; reason?: string }
    | { kind: 'set-mode'; mode: 'interactive' | 'plan' | 'autopilot' }
    | { kind: 'set-model'; modelId: string; reasoningEffort?: string }
    | { kind: 'compact'; instructions?: string };
```

`CopilotPhoneAction` is a later-milestone closed union, not a phase-1 API.
Interactive replies get separate pending-request schemas; they are never a raw
method/params escape hatch. Typed native wrappers inject the verified foreground
`sessionId`; no phone payload or caller-provided params may choose it.

`minimalAttachBridge` is a compile-time constant:

```ts
{
    sessionId: foreground.sessionId,
    disableResume: true,
    streaming: true,
    requestPermission: false,
    requestUserInput: false,
    requestExitPlanMode: false,
    requestAutoModeSwitch: false,
    requestElicitation: false,
    observePromptEvents: false
}
```

It includes no `tools`, `commands`, model/mode/settings change, or arbitrary
caller field. Register `session.event` before the bridge because the server may
emit it, but discard those notifications; `session.eventLog.read` remains the
only projection cursor.

Checkpoint files live under `configuration.happyHomeDir` and use
`writeJsonAtomically()`. They contain no connection token. The authoritative
reattach token remains only in the Copilot registry (after the platform access
checks in §6) and process memory.

The pinned source checkout reports package/handshake version `0.0.1`, which is
not unique enough by itself. M1 therefore accepts only an exact tested target
tuple: registry version equals handshake version, the tuple's source commit is
the pin above, normalized base argv matches, and every declared executable,
entry-script, bundle, and native-addon artifact SHA-256 equals the sanitized
real-smoke manifest, and the normalized extracted package-tree digest matches.
A SEA
tuple hashes the SEA executable; a Node dev tuple hashes both `node(.exe)` and
the canonical entry script/bundle, so swapping `dist-cli/index.js` cannot pass
behind a stable Node hash. Until those artifact hashes are populated, the
feature remains disabled. Supporting another Copilot build requires adding and
testing another tuple; semver ranges and "protocol 3 implies compatible" are
not allowed.

### 3.3 Identity, ordering, and replay

- Happy session tag: deterministic from Copilot session ID, for example
  `copilot-native:<copilotSessionId>`.
- Envelope ID: deterministic hash of
  `copilotSessionId + sourceEventId + projectionKind + ordinal`.
  The terminal `stop` is the exception: native shutdown and controller fallback
  share `stop + copilotSessionId + targetGeneration` so they deduplicate.
- Happy `localId`: deterministic, separately namespaced hash of the same source
  identity. Add an optional localId to the delivery-aware API instead of
  replacing random IDs for existing providers.
- Subagent ID: deterministic CUID2-compatible lowercase identifier derived from
  `sha256(copilotSessionId + nativeAgentId)`, with a leading letter, fixed
  length, `isCuid()` assertion, and collision test. Checkpoint loss must not
  change it.
- Envelope time:
  `max(previousEnvelopeTime + 1, sourceTimestamp)`.
- Server seq remains authoritative and session-local. The controller never
  invents or persists a Happy seq.
- The Copilot delivery API posts oldest-first chunks, including batches larger
  than the existing outbox limit. It must not use the current newest-first
  `flushOutbox()` behavior.
- Split delivery acknowledgement from the contiguous receive watermark.
  Register every deterministic localId in `locallyOriginatedIds` before its POST.
  Atomically persist the bounded pending-localId set before sending and restore
  it before Happy fetch/socket startup after a crash.
  Socket/fetch rows carrying one of those IDs are classified as self-sent even
  when the socket update arrives before the HTTP response; record their seq but
  never route them as phone input. Outbound acknowledgements resolve delivery
  promises but cannot jump the receive watermark over an unseen seq. Advance
  only through a contiguous sequence and retire/persist removal of the localId
  after ACK plus contiguous reconciliation. This closes crash,
  socket-before-response, and
  outbound-ack/phone-message races.
- Persist `happyReceiveSeq` only after each inbound row's side effect is
  acknowledged. For each inbound phone row, emit both a deterministic
  `message-consumption` envelope (`agentFlavor:'copilot'`) and a deterministic
  read-only service response, each keyed from the inbound Happy message ID.
  Advance/checkpoint receive seq only after both deliveries acknowledge. A crash
  before checkpoint replays the row and deduplicates the same receipt/reply.
  Restore the receive seq before fetch or socket handling on controller restart.
- Maintain a volatile working cursor for reads and a durable safe cursor in the
  checkpoint. Advance the safe cursor only after all durable projections have
  Happy acknowledgements **and** projector state is quiescent: no unfinalized
  delta, pending tool/subagent correlation, or delayed terminal fallback. If
  state remains unresolved, keep the safe cursor at the start of that read
  window; a crash replays the window and deterministic IDs deduplicate already
  persisted rows. Events with no durable projection may advance only after
  their local state mutation is complete and no replay-critical buffer depends
  on them.
- If `cursorStatus === 'expired'`, registry generation changes, or the target
  restarts, discard the cursor and replay from the beginning. Deterministic
  localIds make this idempotent.
- A target socket reconnect validates PID, start time, session ID, token,
  protocol, and version again. Never kill a PID based only on a stale registry
  row.

### 3.4 Late join and live continuity

`session.eventLog.read` performs persisted catch-up, catches buffered
ephemerals, and then long-polls with listener-before-recheck ordering. The
controller repeatedly calls it with the returned opaque cursor.

The API scans persisted events before buffered ephemerals, so one response is
not necessarily chronologically interleaved. For initial catch-up, repeatedly
read with `waitMs:0` until the immediate tail is drained; after each live wake,
drain all immediately available continuation pages. Preserve every returned
opaque cursor unchanged and treat persisted append/read ordinal as
authoritative—wall-clock timestamps must never reorder persisted events.

Project the burst through a stable partial-order merge that preserves:

1. persisted read ordinal;
2. ephemeral-buffer/read ordinal;
3. `parentId` edges when both endpoints are present.

Timestamp is advisory only for placing an otherwise-unanchored ephemeral
between persisted events; it may not violate either lane's order. Equal or
regressing timestamps fall back to parent/read order. Bound the burst by event
count and bytes and fail closed on contradictory parent constraints rather than
partially reorder it.

Acceptance invariant:

```text
durable history at attach
  -> zero-or-more buffered ephemerals
  -> live long-poll events
```

with no handoff gap and no duplicate Happy rows. Ephemerals emitted before the
first read, or evicted from Copilot's bounded ephemeral buffer, are
unrecoverable; the UI must never imply otherwise.

## 4. Exact event policy

### 4.1 Phase-1 phone-facing event allowlist

Only these typed Happy events cross the Happy relay:

- `start`, `stop`
- `turn-start`, `turn-end`
- `text` and `text{thinking:true}`
- `tool-call-start`, `tool-call-end`
- `service`

The `SessionEnvelope.subagent` field may identify nested-agent output. No raw
Copilot event, registry record, RPC method name, token, system/developer prompt,
skill body, auth header, environment, binary asset, or arbitrary tool result is
forwarded.

Tool starts carry the real native `toolName` and the native
`data.arguments` object in Happy's `args` field. This is the requested raw-input
equivalent for reviewed tool schemas; the native field is not named `rawInput`.
Each tested tool name has a field allowlist, JSON depth/size limits, recursive
sensitive-key removal, and high-confidence token/header redaction. Unknown tool
names keep their real name but use an explicit `{ omitted: true,
reason: 'unreviewed-tool-schema' }` args object. Cycles, binary values, prototype
keys, or an over-limit payload fail closed. The adapter must not replace the
real tool name with ACP `kind`.

### 4.2 Durable event mapping

| Copilot event | Happy projection |
|---|---|
| `session.start` | `start`; seed non-secret target metadata |
| `session.resume` | suppress the known attach-bridge artifact; emit a `service` resume marker only for a later real target generation transition |
| `user.message` | role `user`, `text` only when `source` is absent or starts with `command-`/`schedule-`; never relay `transformedContent` or attachments; later steering suppresses the native echo of a Happy-originated prompt by returned `messageId` |
| `assistant.turn_start` | `turn-start`, stable turn mapping |
| `assistant.message` | one final `text`; final content is canonical over deltas; `toolRequests` are a deduplicated durable backstop when no matching execution-start event exists; reviewed `serverTools` items become deterministic start/end pairs |
| `assistant.reasoning` | one final thinking `text` |
| `assistant.turn_end` | flush final buffers, then `turn-end:completed` |
| `abort` | `turn-end:cancelled` |
| `tool.execution_start` | `tool-call-start` with source `toolCallId`, exact name and reviewed/sanitized arguments |
| `tool.execution_complete` | `tool-call-end`; result payload is a documented Happy-wire fidelity gap |
| `session.error` | if correlated to an active turn, stage a redacted failed-turn fallback; otherwise emit only redacted session-level service/evidence |
| `session.warning`, `session.info`, `system.message`, `system.notification` | redacted `service` only when user-relevant |
| `subagent.started` | derive the stable CUID2-compatible subagent ID and correlate `data.toolCallId`; child envelopes always carry `SessionEnvelope.subagent` and the parent tool args gain `sessionSubagent` |
| `subagent.completed` | `stop` on mapped subagent |
| `subagent.failed` | redacted subagent `service`, then `stop` |
| `subagent.selected`, `subagent.deselected` | controller state only; no chat row |
| `session.shutdown` | `stop`, then close target state |
| `session.task_complete` | when `data.success !== false`, stage a completed-turn fallback; when false, retain redacted validation-failure evidence and keep the turn open until canonical terminal or idle/quiescent failed fallback |
| `session.compaction_start`, `session.compaction_complete`, `session.truncation` | service/boundary follow-up; phase 1 records evidence but emits no fake Happy context boundary |
| `session.plan_changed` | retain type/id/timestamp evidence only; no M1 plan RPC and no fake plan wire event |
| `session.usage_checkpoint` | retain aggregate evidence; no phase-1 chat row |
| all other durable variants | explicit deferred/excluded classification below; never fall through as raw JSON |

### 4.3 Ephemeral coalescing and mapping

| Copilot event | Handling |
|---|---|
| `assistant.message_start` | initialize message buffer |
| `assistant.message_delta` | append by `messageId`; do not persist a row |
| `assistant.reasoning_delta` | append by `reasoningId`; do not persist a row |
| `assistant.tool_call_delta` | optional in-memory preview only; canonical args come from tool start |
| `assistant.streaming_delta` | ignore unless a source-verified subtype lacks a canonical final event |
| `tool.execution_partial_result`, `tool.execution_progress`, `assistant.server_tool_progress`, `hook.progress` | ephemeral local progress; no durable rows |
| `assistant.usage`, `session.usage_info` | update local aggregate evidence; no durable row |
| `model.call_failure` | stage a redacted failed-turn fallback only if no durable `session.error` covers it |
| `session.todos_changed` | retain type/id/timestamp evidence only; no M1 todo RPC and no fake wire event |
| `pending_messages.modified`, `session.idle`, `assistant.idle`, `assistant.intent` | controller state only |
| request/completion families | local diagnostics/pending-state only; no Happy row and no response RPC in M1 |
| capability/config/status families | update controller diagnostics only |
| canvas/extension/MCP-list families | excluded from phone relay |

### 4.4 Exhaustive deferred/excluded discriminants

The projector owns an exhaustive policy map for all 110 pinned event types.
The durable events not projected in phase 1 are:

`session.remote_steerable_changed`, `session.schedule_created`,
`session.schedule_cancelled`, `session.schedule_rearmed`,
`session.autopilot_objective_changed`, `session.model_change`,
`session.mode_changed`, `session.session_limits_changed`,
`session.permissions_changed`, `session.workspace_file_changed`,
`session.handoff`, `session.context_changed`, `tool.user_requested`,
`skill.invoked`, `hook.start`, `hook.end`, `session.binary_asset`,
`permission.requested`, `permission.completed`, `external_tool.requested`,
`session.auto_mode_resolved`, `session.canvas.recorded`, and
`session.canvas.removed`.

The ephemeral events not otherwise projected are:

`session.title_changed`, `session.memory_changed`, `session.snapshot_rewind`,
`user_input.requested`, `user_input.completed`, `elicitation.requested`,
`elicitation.completed`, `sampling.requested`, `sampling.completed`,
`mcp.oauth_required`, `mcp.oauth_completed`, `mcp.headers_refresh_required`,
`mcp.headers_refresh_completed`, `session.custom_notification`,
`command.queued`, `command.execute`, `command.completed`,
`auto_mode_switch.requested`, `auto_mode_switch.completed`,
`session_limits_exhausted.requested`, `session_limits_exhausted.completed`,
`session.managed_settings_resolved`, `commands.changed`,
`capabilities.changed`, `exit_plan_mode.requested`,
`exit_plan_mode.completed`, `session.tools_updated`,
`session.background_tasks_changed`, `session.skills_loaded`,
`session.custom_agents_updated`, `session.mcp_servers_loaded`,
`session.mcp_server_status_changed`, `mcp.tools.list_changed`,
`mcp.resources.list_changed`, `mcp.prompts.list_changed`,
`session.extensions_loaded`, `session.canvas.opened`,
`session.canvas.registry_changed`, `session.canvas.closed`,
`session.canvas.unavailable`, `session.extensions.attachments_pushed`,
`external_tool.completed`, and `mcp_app.tool_call_complete`.

Unknown discriminants, malformed known variants, and any variant missing a
required correlation ID are fatal compatibility errors. They are logged by
type only and stop the relay; they are never serialized to Happy.

The policy map assigns exactly one action to each discriminant: project,
coalesce, local-state/evidence-only, or exclude. The family labels above are
documentation summaries, not overlapping runtime match arms. Permission,
user-input, elicitation, OAuth, sampling, and external-tool request/completion
events are local-state/evidence-only in M1 and never emit the service marker.

### 4.5 Fidelity gaps accepted in phase 1

- Happy `tool-call-end` cannot carry native result/error payloads.
- Happy has no typed plan, todo, usage, canvas, schedule, or pending-prompt
  event.
- The app has no durable agent-tree snapshot consumer; nested chat can still use
  `SessionEnvelope.subagent`.
- pre-first-read/evicted ephemerals cannot be recovered.
- binary assets are externalized/suppressed by Copilot's event-log API and are
  not a phase-1 attachment path.
- unreviewed tool schemas retain the exact native name but omit raw arguments;
  reviewed schemas preserve only their allowed, redacted JSON fields.
- unknown real Copilot tools use Happy's existing generic JSON tool view until
  a stable name earns a specific alias.

Subagent parent correlation is mandatory rather than checkpoint-dependent.
Within each chronologically merged event burst the projector performs a first pass over
`subagent.started`; cross-page subagent-capable tool starts are held in a
bounded correlation buffer until a matching `toolCallId`, completion, or turn
terminal arrives. The parent `tool-call-start.args.sessionSubagent` and every
child envelope use the same deterministic CUID2-compatible ID. Replay after a
deleted checkpoint must reconstruct the identical sidechain.

Turn-terminal fallbacks are also delayed across event-log page boundaries.
Keep pending fallbacks per turn, cancel them when canonical
`assistant.turn_end`/durable error coverage arrives, and flush them only after
the persisted catch-up reaches the live frontier and either `session.idle` /
`session.shutdown` occurs or a bounded quiescence read returns no newer event.
Never flush merely because a 500-event page ended.

The safe cursor stays before any read window that owns one of these buffers.
Crash recovery therefore rebuilds pending delta/tool/subagent/terminal state by
replay instead of checkpointing partial transcript content.

Do not hide these gaps by inventing fake tool names or service rows that look
like structured state.

## 5. Phone action boundary by milestone

### Milestone 1: read-only

- Allowed actions: none.
- Happy archive/session-close signals are relay lifecycle only: detach the
  mirror and leave Copilot running, even if this controller originally spawned
  it.
- Inbound Happy user text is never forwarded to Copilot. The runner emits a
  deterministic service response explaining that the mirror is read-only.
- Construct `ApiSessionClient` with `rpcProfile: 'copilot-readonly'`, which
  registers no common shell/filesystem/workspace RPC handlers.

### Milestone 2: basic steering

Allow only:

- prompt -> `session.send`;
- abort -> `session.abort`.

Prompt text is length-limited and attachments remain excluded. The
`session.send` returned message ID is retained to suppress the mirrored
`user.message` duplicate.

### Milestone 3: rich session control

Allow only schema-bound:

- mode -> `session.mode.set`;
- model/reasoning -> `session.model.switchTo`;
- compact -> `session.history.compact`;
- specifically reviewed session commands/tasks.

Still excluded: `session.shell.*`, `session.workspaces.*`, server/global
settings/config, plugin/extension mutation, MCP config mutation, arbitrary
command names, raw session methods, yolo/allow-all, and session shutdown.

### Milestone 4: interactive completeness

Expose dedicated reply schemas for a request already present in the local
pending map:

- permission;
- user input;
- elicitation;
- exit-plan;
- OAuth;
- sampling.

Each reply validates request ID, expected event family, target generation,
expiry, and an operation-specific choice. Never expose
`session.permissions.*` or `session.ui.handlePending*` directly.

Do not enable `observePromptEvents` or event interests until this milestone.
If the tested external controller cannot negotiate these safely, stop and file
the runtime follow-up proposed in §10.

## 6. Lifecycle and failure recovery

### Spawn

1. Resolve an explicit `CopilotCommandSpec { execPath, baseArgs, artifacts }`
   and canonicalize/hash the direct executable. For SEA, first run a **tokenless
   materialization process** (`--no-auto-update --help`) in an empty,
   controller-owned staging cache with ambient `COPILOT_CLI_DIST_DIR` and
   preferred-version inputs rejected. Hash every extracted file into a
   normalized package-tree digest plus explicit critical digests for `index.js`,
   bundled `app.js`, and each `*.node` addon (including `runtime.node` and Windows
   `cli-native.node`). Atomically move/copy the whole normalized package tree
   into a content-addressed,
   access-checked controller cache, then set controller-owned
   `COPILOT_CLI_DIST_DIR` to that verified directory for the token-bearing
   managed spawn. Rehash before attach; reject pre-existing or changed content.
   The Node dev smoke likewise hashes `node(.exe)`, `dist-cli/index.js`,
   bundled `app.js`, and every resolved native addon. Normalize base argv and
   match the exact tuple. Spawn directly with `shell:false`; reject command-shell
   or PATH-wrapper PID indirection.
2. Verify the inherited Copilot feature-flag inputs actually enable
   `COPILOT_AGENTS_TAB`; do not guess by setting an undocumented standalone
   boolean.
3. Generate 32 random token bytes, base64url.
4. Spawn detached with `--server --port 0 --managed-server`, stdin ignored,
   `COPILOT_CONNECTION_TOKEN`, `COPILOT_RUN_APP=1`,
   `COPILOT_FORCE_WINDOWS_HIDE=1`, the verified controller-owned dist/cache
   paths, and a closed child-environment allowlist: OS bootstrap/path,
   user-profile/config, locale, proxy/TLS, GitHub/Copilot auth, and known
   feature-flag inputs only. Explicitly reject `NODE_OPTIONS`, `NODE_PATH`,
   `COPILOT_VOICE_SERVER_MODE`, ambient dist/cache overrides,
   `COPILOT_RUNTIME_OOP`, Happy secrets, and detached-session control variables.
   Use non-piped stdio (`ignore`, or owner-only pre-opened log FDs whose parent
   copies close immediately), retain the original `ChildProcess` handle, and
   call `child.unref()` after registry/handshake validation so the target cannot
   keep the controller alive. Hidden window on Windows. An out-of-process native
   runtime is unsupported until a separate tested tuple hashes its provider
   binary and launch chain.
5. Poll the canonical registry for the exact direct child PID.
6. Require schema 2, managed kind, non-stale mtime, loopback host, session ID,
   token equality, explicit `registry.copilotVersion === connect.version`, and
   the tested command/artifact tuple.
7. Connect, get foreground, run the exact minimal attach bridge, and negotiate
   before creating a Happy session.

Install child `error`/`exit` listeners immediately. On every pre-validation
failure (spawn error, materialization/hash/DACL/registry timeout or mismatch,
connect/foreground/resume failure), close sockets and parent FDs, terminate and
reap through the retained original child handle, and only then return the
failure. If termination itself fails, retain a permanent non-throwing error
listener and `unref()` as the last-resort leak-safe path. `unref()` on the happy
path occurs only after all validation succeeds.

On Windows the pinned runtime does not tighten registry ACLs. The controller
must canonicalize the current-user `COPILOT_HOME`, reject registry directories
or files that are reparse points, and verify that their DACL grants read access
only to the current user, SYSTEM, and Administrators. An unreadable or
unverifiable ACL fails closed. If a reliable controller-side check cannot be
implemented, file `copilot-runtime-windows-registry-acl-hardening` and stop M1
on Windows; do not weaken the check.

### Attach

An explicit attach identifies a registry row by PID plus session ID. The
controller revalidates file location/permissions where supported, liveness,
generation, loopback host, token, `connect` response, and foreground session.
It also resolves the target process command on each supported OS and matches
the SEA executable or Node executable+entry script+base argv against a tested
artifact tuple, including bundled JS and `runtime.node`. If process
command/artifact identity is unavailable or ambiguous, external attach fails
closed. Ambiguous same-cwd targets fail with a list; the adapter never guesses.

Checkpoint provenance distinguishes spawned from attached targets, but
controller restart deliberately downgrades a previously spawned target to
re-adopted detach-only ownership. `runtime.shutdown` drains resources but does
not exit the server, and the new controller lacks the original child handle, so
it must neither call shutdown nor OS-terminate that process. Owned shutdown is
available only in the same controller process that retains the original live
child handle plus matching registry generation. Missing/corrupt provenance
also degrades to external-attach semantics.

### Reconnect

- Transport failure: backoff, reread/revalidate registry, reconnect, verify the
  same active foreground session, continue checkpoint cursor.
- Cursor expired: durable replay from start with deterministic dedup.
- Target PID/generation changed: close pending buffers, mark the old turn
  failed, create/attach only through an explicit restart policy, then replay.
- Happy relay offline: keep Copilot cursor uncommitted, retry deterministic
  Happy deliveries, then checkpoint.
- Malformed/version-skew response: fail closed; no ACP/JSONL/raw fallback.

### Shutdown

Shutdown origin is explicit. A Happy-side archive/session-close always takes
the external-detach path below and never calls `runtime.shutdown` or an OS
termination API. Only a local owning-controller command, signal handler, or
owned-child failure policy may request owned-target shutdown.

1. stop accepting phone actions and quiesce the normal long poll without
   discarding its working cursor;
2. enqueue and acknowledge the deterministic controller-local `stop`; this is
   authoritative for controlled teardown. A native `session.shutdown` observed
   before quiescence uses the same ID, but teardown never waits for it;
3. flush the Happy outbox and persist safe cursor, receive seq, and pending
   localIds;
4. for a locally requested same-process owned shutdown only, call allow-listed
   `runtime.shutdown` as best-effort resource drain and await its response, then
   close JSON-RPC, wait a bounded interval, and terminate/reap only through the
   original child handle if necessary;
5. Happy archive, external attach, and re-adopted targets close JSON-RPC only
   and leave Copilot running;
6. close Happy last.

## 7. Security and threat model

Assets:

- Copilot connection token and GitHub-authenticated session;
- Happy relay credentials;
- local workspace/tool inputs;
- session transcript;
- privileged native method surface.

Threats and controls:

| Threat | Control |
|---|---|
| phone invokes arbitrary native RPC | no raw invoker; closed action schemas and constant method mapping |
| native server exposed beyond machine | managed target must be loopback; reject all other hosts |
| token leakage | memory only outside the access-checked Copilot registry; never logs/metadata/checkpoint/Happy relay |
| stale/forged registry | canonical non-reparse path, Windows DACL/Unix owner+mode checks, schema/kind/mtime/PID/generation checks, token-authenticated handshake, foreground ID match |
| version drift changes semantics | protocol 3 plus exact source/version/command/bundled-JS/runtime.node hash tuple and required-method checks; OOP runtime rejected; unknown events fail closed |
| generic Happy RPCs bypass read-only boundary | restricted `ApiSessionClient` profile |
| child environment alters loaded code or leaks Happy secrets | closed env allowlist; reject Node injection, voice-server, ambient dist/cache, OOP runtime, detached-session, and Happy private variables |
| duplicate/reordered history | deterministic envelope/local IDs, delivery ack before cursor checkpoint, server seq authoritative |
| secret-bearing event fields | user-source filtering plus event/tool-specific schemas; never forward transformed prompts, attachments, registry/auth/system prompts/skill content/headers/env/binaries; unknown tool args omitted and allowed schemas recursively redacted |
| PID reuse causes wrong-process kill | require owned child handle plus matching registry generation; never kill by stale PID alone |

The paired Happy phone remains trusted for the allow-listed session transcript,
including real tool names and allowed tool arguments. This does not imply trust
for global configuration or local-controller credentials.

## 8. Exact implementation budget

### Milestone 0 + 1: owned-path budget

Production, maximum 16 files:

1. `packages/happy-cli/src/api/sessionPayloadCodec.ts`
2. `packages/happy-cli/src/api/apiSession.ts`
3. `packages/happy-cli/src/api/api.ts`
4. `packages/happy-cli/src/utils/createSessionMetadata.ts`
5. `packages/happy-cli/src/agent/core/AgentBackend.ts`
6. `packages/happy-cli/src/agent/core/AgentRegistry.ts`
7. `packages/happy-cli/src/agent/copilot/types.ts`
8. `packages/happy-cli/src/agent/copilot/nativeLocalRpcClient.ts`
9. `packages/happy-cli/src/agent/copilot/managedServer.ts`
10. `packages/happy-cli/src/agent/copilot/checkpointStore.ts`
11. `packages/happy-cli/src/agent/copilot/eventPolicy.ts`
12. `packages/happy-cli/src/agent/copilot/eventProjector.ts`
13. `packages/happy-cli/src/agent/copilot/eventReader.ts`
14. `packages/happy-cli/src/agent/copilot/runCopilot.ts`
15. `packages/happy-cli/src/agent/copilot/index.ts`
16. `packages/happy-cli/src/commands/copilotCommand.ts`

Tests/fixtures, maximum 9 files:

1. `packages/happy-cli/src/api/sessionPayloadCodec.test.ts`
2. `packages/happy-cli/src/api/apiSession.test.ts`
3. `packages/happy-cli/src/api/api.test.ts`
4. `packages/happy-cli/src/agent/copilot/nativeLocalRpcClient.test.ts`
5. `packages/happy-cli/src/agent/copilot/managedServer.test.ts`
6. `packages/happy-cli/src/agent/copilot/checkpointStore.test.ts`
7. `packages/happy-cli/src/agent/copilot/eventProjector.test.ts`
8. `packages/happy-cli/src/agent/copilot/copilot.integration.test.ts`
9. `packages/happy-cli/src/commands/copilotCommand.test.ts`

Tracked fixtures/evidence, maximum 3 files:

1. `packages/happy-cli/src/agent/copilot/__fixtures__/session-events.json`
2. `plans/happy-copilot-native-local-controller-backend/smoke-manifest.json`
3. `plans/happy-copilot-native-local-controller-backend/implementation-validation.md`

The smoke manifest records normalized base argv and every artifact digest.
Fixtures are sanitized and bounded; implementation validation contains command
results, not raw transcripts.

The core M1 change does not alter happy-server pagination or app reducers/tool
rendering. The existing unknown-tool fallback renders real names and the
allowed/omitted JSON input object. A small atomic wire/app flavor dependency is
required for message-consumption receipts, described below.

### Same-repo path dependencies

`packages/happy-cli/src/index.ts` is outside this task's writable paths but is
the actual command dispatcher. The implementation cannot ship a reachable
`happy copilot` command without one import and one dispatch/help branch there.
Tasks Board proposal: `happy-copilot-cli-entry-dispatch`, owned by the
happy-cli entrypoint maintainer. It may be folded into the implementation only
after the coordinator explicitly grants that path.

`message-consumption.agentFlavor` currently permits only `claude|codex` in
`packages/happy-wire/src/sessionProtocol.ts`, and
`packages/happy-app/sources/sync/typesRaw.ts` repeats that closed enum. The app
path is outside this task's writable set, so M1 cannot truthfully emit a Copilot
receipt here. Tasks Board proposal:
`happy-copilot-message-consumption-flavor`, atomically adding `copilot` to both
schemas and their tests. It must land before M1; do not alias Copilot receipts
as Codex.

### Later outside-budget surfaces

- daemon spawn/availability and app new-session provider selection;
- app sync/reducer and happy-wire additions for structured plan/todo/usage/tool
  result/pending-prompt events;
- specific tool views only after stable native names are captured.

## 9. Test and acceptance plan

### Unit

- codec: fetch/live parse the same plaintext bytes; malformed payload fails
  explicitly; tests remove the old silent-drop expectation;
- delivery sequencing: oldest-first batches preserve source order beyond 50
  rows; a socket self-echo arriving before POST response is recognized by its
  pre-registered localId; crash after POST/before ACK restores that pending ID
  before receive; outbound ACK seqs cannot skip an interleaved phone
  seq; contiguous receive reconciliation skips self-sent rows without routing
  them;
- framing: fragmented headers/body, multiple frames, UTF-8 byte lengths,
  malformed/duplicate/oversized `Content-Length`, unknown response IDs,
  timeout/cancel, unsolicited request rejection, and required foreground
  `sessionId` on every session-scoped request;
- registry: schema/kind/host/PID/mtime/session/version checks, token redaction,
  ambiguous attach, PID-reuse kill refusal, tokenless SEA materialization,
  content-addressed cache immutability, and child-env allowlist;
- compatibility: protocol mismatch, runtime mismatch, missing required method,
  SEA override/cache/path/tree mismatch, index/app/runtime.node/cli-native.node hash
  mismatch, Node injection/voice/OOP env, unverifiable external-attach command,
  unknown event type, malformed known event all fail closed;
- attach bridge: exact constant params, no tools/commands/callbacks/prompt
  observers, no projected `session.event` notification, and session-scoped read
  fails before bridge but succeeds after it;
- projector: exhaustive 110-type policy, final-over-delta precedence,
  message/reasoning coalescing, user-source/attachment filtering, exact tool
  name plus schema-bound arguments, nested-secret redaction, unknown-tool
  omission, `assistant.message` server-tool/tool-request backstops, tool
  correlation, monotonic time, deterministic IDs, deterministic subagent CUID
  and parent correlation after checkpoint loss, terminal fallback cancellation
  when canonical events arrive on a later page, and session-level error vs
  active-turn failure distinction, and `session.task_complete.success === false`
  retry behavior;
- reader: history -> live cursor continuity, batch ack/checkpoint ordering,
  cursor expiry replay, target-generation reset, Happy outage retry, restored
  Happy receive seq and pending localIds, crash-before-read-only-reply-ack
  replay/dedup, persisted-ordinal preservation under inverted/equal timestamps,
  and parent-constrained ephemeral insertion across pages;
- reader/projector crash matrix: crash at each delta, pending tool correlation,
  pending subagent correlation, and terminal fallback rebuilds from the lagging
  safe cursor with no lost/duplicate Happy row;
- restricted API profile: no common RPC handlers and no phone message forwarding;
- inbound read-only handling: `copilot` message-consumption receipt plus service
  reply both acknowledge before receive seq advances; crash replay deduplicates
  both;

### Hermetic integration

Run a real loopback fake managed server speaking the pinned framing and method
shapes. Cover handshake, history, long-poll event arrival, reconnect, cursor
expiry, persisted-before-ephemeral partial-order merge with equal/regressing
timestamps and multi-page parent chains,
missing/wrong `sessionId`, malformed frames, method-not-found, native-vs-local
stop dedup, detached/unref process-liveness behavior, and clean owned shutdown
plus external/re-adopted detach.
Also assert a phone archive detaches an originally owned mirror without sending
`runtime.shutdown` or terminating the target.

### Happy persistence/pagination acceptance

Project more than 200 finalized envelopes, including tool pairs and subagent
rows, through a real embedded Happy server:

1. deterministic retry creates no extra row or seq;
2. source event order equals server seq order across >50-row chunks, while
   session seq remains monotonic and backend-generated timestamps never replace it;
3. cold fetch loads only the final 80;
4. HTTP and socket older ranges reconstruct the complete ordered history;
5. controller restart/replay creates no duplicate message IDs or tool rows;
6. an interleaved inbound phone row is fetched/routed exactly once and cannot
   be skipped by a later outbound delivery acknowledgement;
7. a crash with unresolved projector state replays from the safe cursor and
   preserves finalized order/correlation;
8. daemon-global update seq never becomes `session.seq`;
9. existing app pagination/reducer behavior stays unchanged; the separate
   consumption-flavor schema tests and existing pagination tests stay green.

### Real managed-server smoke

Opt-in only:

```text
RUN_INTEGRATION=1
RUN_COPILOT_INTEGRATION=1
HAPPY_ENABLE_COPILOT_NATIVE=1
```

Against the pinned local Copilot build:

- spawn and discover a managed target;
- prove token never appears in logs, Happy metadata, checkpoint, or argv;
- attach and import history;
- drive a test-only native prompt to capture assistant text, one exact-name
  reviewed tool call with projected arguments, one unknown-tool omission,
  server-tool/tool-request history, usage, and subagent evidence;
- restart only the Happy controller while the target survives;
- recover durable history and live events without gaps/duplicates;
- verify phone rows received before/during restart are handled exactly once,
  read-only responses deduplicate, and input is not forwarded;
- scan persisted Happy payloads as well as logs/metadata/checkpoints for token,
  header, hidden skill/system prompt, attachment, and transformed-content
  leakage;
- cleanly detach external target and shut down owned target.

Retain sanitized request/event fixtures and a smoke manifest containing source
commit, Copilot version, protocol, registry schema, OS, normalized command,
package-tree and critical JS/native-addon hashes, and assertions.
Never retain tokens, auth headers, prompts containing secrets, or raw
environment values.

### Validation commands for implementation

```text
pnpm --filter happy exec vitest run <all changed happy-cli test files>
pnpm --filter happy typecheck
pnpm --filter happy build
pnpm --filter happy-app test --run <existing pagination/reducer selectors>
pnpm --filter happy-app typecheck
```

Run `pnpm --filter happy-wire build` only if a later milestone actually changes
happy-wire.

## 10. Milestones, dependencies, and stop conditions

1. **M0 codec/sequencing prerequisite** - land as a separate commit/change with
   Claude, Codex, and ACP regression coverage; it must land before steering and
   before the backend is called reconnect-correct.
2. **M1 read-only mirror** - codexu-only core plus the separately authorized
   entrypoint dispatch and consumption-flavor schema dependency.
3. **M2 basic steering** - prompt/abort only.
4. **M3 rich control** - session-scoped model/mode/reasoning/compact, then
   individually reviewed commands/tasks.
5. **M4 interactive completeness** - tracked pending-request replies only.
6. **M5 UI-server/TUI co-steering** - separate plan; managed-server remains the
   headless path.
7. **M6 hardening** - fuzz, compatibility matrix, recovery/rollback drills,
   evidence audit.

Dependencies/follow-up proposals:

- **Blocking same-repo ownership proposal:** `happy-copilot-cli-entry-dispatch`.
  The coordinator must create it as a declared dependency or grant
  `packages/happy-cli/src/index.ts` before M1 implementation begins. This plan
  cannot mutate coordinator-owned Tasks Board state.
- **Blocking same-repo protocol proposal:**
  `happy-copilot-message-consumption-flavor`, owning the wire + app raw-schema
  enum update above.
- **Later product surface:** `happy-copilot-daemon-app-provider-selection`.
- **Later structured fidelity:** `happy-copilot-rich-session-events` for
  plan/todo/usage/tool-result/pending-prompt wire + app reducer/UI.
- **Conditional runtime-only gate:** `copilot-runtime-external-controller-prompt-capability`.
  File only if M4 evidence proves exact-build gating insufficient. If filed,
  stop the codexu M4 chain at that dependency; do not create a dual-repo PRD.
- **Conditional Windows hardening:** `copilot-runtime-windows-registry-acl-hardening`.
  File only if M1 cannot reliably enforce the DACL/reparse policy in the
  controller; if filed, M1 is blocked on Windows but may continue on verified
  Unix targets.

No Copilot runtime change is required for M0/M1. The ACP telemetry-untag task is
unrelated and excluded.

## 11. Rollout and rollback

- M1 requires both explicit `happy copilot` invocation and
  `HAPPY_ENABLE_COPILOT_NATIVE=1`; default is off.
- Later capabilities use separate default-off flags:
  `HAPPY_ENABLE_COPILOT_STEERING`,
  `HAPPY_ENABLE_COPILOT_RICH_CONTROL`, and
  `HAPPY_ENABLE_COPILOT_INTERACTIVE`.
- Publish non-secret capability/version status in session metadata; never
  silently downgrade.
- Rollback is flag-off plus controller detach. Existing Happy rows remain valid
  because M1 uses current `SessionEnvelope` and pagination formats.
- M0 is not flag-scoped. Its separate commit must pass cross-provider
  reconnect/order tests; rollback for an M0 regression is an explicit revert of
  that commit followed by the same cross-provider tests.
- Owned targets are shut down only by the same-process owning controller with
  the original child handle; external and re-adopted targets survive rollback.
- Checkpoints are versioned and ignorable. A rejected checkpoint causes
  deterministic durable replay, not data deletion.

## 12. Implementation order

Exact next implementation phase:

1. implement and validate Story 0 (codec symmetry plus the contiguous receive /
   outbound-delivery sequencing seam) entirely within the current owned paths;
2. land M0 as its own reviewed commit/change and run cross-provider regression
   coverage;
3. stop until the coordinator creates both
   `happy-copilot-cli-entry-dispatch` and
   `happy-copilot-message-consumption-flavor` as dependencies (or grants the
   equivalent paths);
4. implement Stories 1-7, then run hermetic, persistence/pagination, and real
   managed-server acceptance;
5. review/fix code and docs to clean before enabling M1 for any daily-driver
   session.

Do not begin M2 steering in the M1 implementation change.
