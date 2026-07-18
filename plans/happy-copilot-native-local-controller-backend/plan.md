# Happy Copilot native local-controller backend

## 1. Decision and revision boundary

Implement Option 1 as a codexu-owned backend: `happy-cli` directly spawns a
headless Copilot managed-server target and mirrors a small, read-only projection
of its native local JSON-RPC event stream into typed Happy session envelopes.
The phone never receives a generic Copilot RPC tunnel.

This revision deliberately splits the first delivery into two independently
reviewable changes:

- **M0:** a cross-provider Happy history/delivery correction;
- **M1a:** a spawn-only, read-only Copilot mirror with no phone input.

M1a is the narrowest independently executable transport/projection slice.
Because it neither attaches to an already-active target nor sends a prompt, a
normal production invocation creates an idle observable session; the real
managed-server smoke uses a separate test-only stimulus client. User-driven
work begins in M2. External attach/re-adoption,
persisted source cursors, steering, interactive requests, TUI co-steering, and
filesystem/binary hardening are later milestones.

Pinned evidence:

- codexu base: `06312dd910cb19efea38c7cf38269ef6915c0ece`;
- Copilot source:
  `C:\efforts\copilot-agent-runtime@1f19c0c1ccd2502b1cce8372419a831cf533f37f`;
- managed-server spawn reference:
  `src/cli/sessions/spawnLiveTarget.ts`;
- registry schema:
  `src/core/remoteRegistry/serverRegistry.ts`;
- routing and notification forwarding:
  `src/core/sdkServer.ts`;
- native event-log semantics:
  `src/core/sharedApi/sessionEventsApi.ts`;
- event contracts:
  `src/core/generated/session-events.ts`.

No Copilot runtime change is required for M0 or M1a. The optional ACP
telemetry-untag patch remains out of scope.

## 2. Corrected source claims

### 2.1 History codec asymmetry is real

`packages/happy-cli/src/api/sessionPayloadCodec.ts` currently encodes outgoing
rows as plaintext JSON and parses live rows as plaintext JSON, while fetched
rows go directly through legacy decryption. `ApiSessionClient.fetchMessages()`
therefore drops current fork-sent rows when cold-fetch decryption fails.

M0 fixes the existing format rather than claiming to restore E2E encryption:

1. parse fetched content as plaintext JSON first;
2. only if plaintext parsing fails, try the existing legacy decrypt path;
3. if both fail or the decoded value is not an accepted Happy message shape,
   return a typed malformed-row error;
4. log only session id, seq, and error category; never log payload bytes;
5. skip that row, continue the page, and advance the existing in-memory fetch
   scan so one poison row cannot loop forever.

Legacy encrypted history remains readable. New writes stay byte-compatible.

### 2.2 Native event-log buffering begins at the first read

`ensureEphemeralBuffer()` is called lazily by `performEventsRead()` in
`sessionEventsApi.ts`. It is not activated by `session.resume`. Therefore an
event-log-only bootstrap that resumes first and installs no notification
prebuffer can lose ephemeral events before the first read.

The M1a sequence is:

1. install and open a local `session.event` notification prebuffer;
2. call `session.resume` to establish routing;
3. call `session.eventLog.read` from the start, which also activates the
   runtime's event-log ephemeral buffer;
4. backfill persisted history;
5. establish an event-log live frontier while the notification prebuffer is
   still open;
6. atomically close and drain the prebuffer;
7. continue long-poll reads from the frontier cursor.

Overlaps are deduplicated by the native event `id`.

### 2.3 Ordering is lane-local

M1a preserves:

- the order returned for persisted event-log events; and
- notification arrival order for prebuffer-only events.

It does not sort by timestamp, traverse `parentId`, or invent a total order
between the two lanes. When the same event id is present in both lanes, the
persisted copy wins and the prebuffer copy is discarded. Prebuffer-only events
are appended in their arrival order after the persisted catch-up lane.

### 2.4 M1a uses a small closed projection

M1a does not maintain a policy entry for every generated event variant. The
reader requests a small allowlist and safely omits everything else. Streaming
deltas and progress are not sent to Happy; the durable final events are the
coalesced result.

## 3. Ownership and scope gates

### Required ownership grants

M1a needs one dispatch edit in:

```text
packages/happy-cli/src/index.ts
```

Source review also confirmed that the current app always renders an enabled
composer and control callbacks. A truthful no-phone-action milestone therefore
needs narrow UI gating in:

```text
packages/happy-app/sources/-session/SessionView.tsx
packages/happy-app/sources/fork/session/useForkComposer.ts
packages/happy-app/sources/fork/session/useSessionContextDrawer.tsx
packages/happy-app/sources/-session/SessionView.copilotReadOnly.test.tsx
packages/happy-app/sources/fork/session/useForkComposer.copilotReadOnly.test.ts
packages/happy-app/sources/fork/session/useSessionContextDrawer.copilotReadOnly.test.tsx
packages/happy-app/sources/components/MessageView.tsx
packages/happy-app/sources/components/MessageView.copilotReadOnly.test.tsx
packages/happy-app/sources/components/ChatList.tsx
packages/happy-app/sources/components/ChatList.copilotReadOnly.test.tsx
packages/happy-app/sources/components/ActiveSessionsGroupCompact.tsx
packages/happy-app/sources/components/ActiveSessionsGroupCompact.test.tsx
packages/happy-app/sources/hooks/useSessionQuickActions.ts
packages/happy-app/sources/hooks/useSessionQuickActions.copilotReadOnly.test.ts
packages/happy-app/sources/app/(app)/session/[id]/info.tsx
packages/happy-app/sources/app/(app)/session/[id]/info.copilotReadOnly.test.tsx
packages/happy-app/sources/app/(app)/session/[id]/spawn-child.tsx
packages/happy-app/sources/app/(app)/session/[id]/spawn-child.test.tsx
packages/happy-app/sources/app/(app)/session/[id]/fork-composer.tsx
packages/happy-app/sources/app/(app)/session/[id]/fork-composer.test.tsx
packages/happy-app/sources/app/(app)/session/[id]/files.tsx
packages/happy-app/sources/app/(app)/session/[id]/files.copilotReadOnly.test.tsx
packages/happy-app/sources/app/(app)/session/[id]/file.tsx
packages/happy-app/sources/app/(app)/session/[id]/file.test.tsx
packages/happy-app/sources/app/(app)/session/[id]/plugins.tsx
packages/happy-app/sources/app/(app)/session/[id]/plugins.test.ts
packages/happy-app/sources/app/(app)/session/[id]/skills.tsx
packages/happy-app/sources/app/(app)/session/[id]/skills.test.ts
packages/happy-app/sources/app/(app)/session/[id]/agents.tsx
packages/happy-app/sources/app/(app)/session/[id]/agents.test.ts
packages/happy-app/sources/app/(app)/session/[id]/message/[messageId].tsx
packages/happy-app/sources/app/(app)/session/[id]/message/[messageId].copilotReadOnly.test.tsx
packages/happy-app/sources/sync/storage.ts
packages/happy-app/sources/sync/storage.copilotSequenceOrder.test.ts
packages/happy-cli/vitest.config.ts
packages/happy-cli/src/utils/createSessionMetadata.test.ts
packages/happy-app/CHANGELOG.md
packages/happy-app/sources/changelog/changelog.json
```

These paths were not in the planning task's writable set. They are ownership
grant requests, not separate architecture tasks. Implementation must not edit
them until the coordinator grants them.

### Not an M1a dependency

`happy-copilot-message-consumption-flavor` is not a blocker. M1a consumes no
phone messages and emits no `message-consumption` receipts.

### Explicit M1a exclusions

- no external attach, target picker, or process re-adoption;
- no durable Copilot cursor or receive cursor;
- no phone prompt, abort, configuration, permission, elicitation, OAuth,
  sampling, or other command;
- no generic `{ method, params }` RPC;
- no global config, plugin, extension, MCP mutation, filesystem, workspace,
  arbitrary shell, or privileged permission API;
- no streaming delta rows;
- no plan/todo, usage, subagent, attachment, reasoning, canvas, schedule, or
  background-task projection;
- no SEA materialization, artifact-tree hashing, binary attestation, DACL or
  reparse enforcement, closed-environment policy, or OOP-runtime policy;
- no app/server pagination changes;
- no Copilot runtime edits.

## 4. M0: cross-provider codec and ordered delivery

M0 lands separately before M1a.

### 4.1 Changes

1. Update `decodeIncoming(..., {source:'fetch'})` to plaintext-first with
   legacy decrypt fallback and a typed malformed result/error.
2. Add regression fixtures for plaintext current rows, legacy encrypted rows,
   malformed JSON, valid JSON with an invalid message shape, and invalid
   ciphertext.
   Both plaintext and legacy-decoded values must pass the canonical
   `@slopus/happy-wire` `MessageContentSchema`; schema failure is the
   malformed-row path. Remove the stale CLI-local two-role union in
   `src/api/types.ts` and re-export the canonical schema/type so typed
   `role:"session"` `SessionProtocolMessageSchema` history is accepted along
   with user and agent rows.
3. Add the narrow outbound API M1a needs:

   ```ts
   sendSessionProtocolMessageWithDelivery(
     envelope: SessionEnvelope,
     options: { localId: string },
   ): Promise<MessageDelivery>
   ```

4. Preserve queue insertion order and flush the queue head oldest-first in
   chunks of at most 50.
5. Treat the POST response seq as the acknowledgement for that local id, but do
   not advance the inbound fetch watermark past rows it has not scanned.

### 4.2 What M0 does not add

- no durable receive cursor;
- no consumption receipt;
- no provider-specific checkpoint;
- no new wire format or encryption migration;
- no Copilot source event cursor.

### 4.3 M0 acceptance

- current plaintext rows cold-fetch successfully;
- legacy encrypted rows still cold-fetch successfully;
- decoded values must pass canonical `@slopus/happy-wire`
  `MessageContentSchema`, including typed `role:"session"` history;
- malformed rows are visible in structured diagnostics, omitted from routing,
  and cannot stall later rows;
- an ordered batch larger than 50 is posted oldest-first;
- caller-supplied local ids survive retries and resolve the correct delivery;
- outbound ACKs cannot make fetch skip an unseen interleaved row;
- Claude, Codex, and ACP reconnect tests remain green.

Rollback is a single M0 commit revert. Since outgoing bytes do not change,
rollback does not strand newly written history.

## 5. M1a: spawn-only read-only mirror

### 5.1 User-visible contract

M1a is opt-in and command-scoped:

```text
HAPPY_ENABLE_COPILOT_NATIVE=1 happy copilot
```

It starts a new headless Copilot session and stands up the finalized
primary-agent chat/tool mirror. With production M1a alone the fresh target is
idle because there is intentionally no prompt source. The phone can observe
and paginate any rows produced by the target but cannot send anything to
Copilot. Automated acceptance uses a non-shipping local stimulus client;
production steering is M2.

### 5.2 Target lifecycle

1. Resolve the Copilot executable directly; do not invoke a shell.
2. Generate a high-entropy connection token in memory.
3. Spawn:

   ```text
   copilot --server --port 0 --managed-server
     --session-idle-timeout 300
   ```

   with:
   - the token in `COPILOT_CONNECTION_TOKEN`;
   - `COPILOT_RUN_APP=1` so the SEA loader does not introduce a supervised
     double-spawn/PID mismatch;
   - `COPILOT_FORCE_WINDOWS_HIDE=1`;
   - the effective feature-flag input preserving/enabling
     `COPILOT_AGENTS_TAB` (`COPILOT_CLI_ENABLED_FEATURE_FLAGS` in the pinned
     runtime), which is a source-enforced prerequisite for
     `--managed-server`;
   - explicit scrubbing of `COPILOT_LOADER_PID`,
     `COPILOT_DETACHED_SESSION`, `COPILOT_DETACHED_PARENT_SESSION_ID`, and
     `COPILOT_DETACHED_PARENT_ENGAGEMENT_ID`.
   Normalize the enabled-feature list, force inclusion of
   `COPILOT_AGENTS_TAB`, and set the direct child env
   `COPILOT_AGENTS_TAB=true`; this overrides an inherited direct `false`.
   Because the pinned runtime applies config `enabledFeatureFlags` after env,
   inspect the canonical Copilot config before spawn and fail with a precise
   unsupported-state error when it explicitly sets
   `COPILOT_AGENTS_TAB:false`. Do not silently rewrite the user's config.
4. Retain the returned child handle and PID.
   Spawn with `stdin/stdout/stderr` set to `ignore` (never pipes), set
   `windowsHide`, and install persistent `error`/`exit` listeners immediately.
   If implementation later adopts the pinned helper's file-FD diagnostics
   pattern, it must close the parent's FD copy immediately after spawn; M1a's
   default has no inherited log FD.
   The explicit 300-second managed-session idle timeout is an M1a owner-death
   lease: session-scoped event-log reads refresh runtime activity while the
   controller is healthy; after a controller crash, the pinned runtime's
   five-minute reaper sweep shuts the idle managed target down within at most
   about ten minutes after its last activity. Do not set `detached:true` or
   call `unref()`. This is bounded orphan recovery, not external re-adoption.
5. Poll the canonical `<COPILOT_HOME>\servers\<pid>.json` registry entry with a
   bounded timeout.
6. Accept only an entry whose:
   - `schemaVersion === 2`;
   - `kind === "managed-server"`;
   - `pid === child.pid`;
   - host is loopback;
   - port is in range;
   - token is non-empty and equals the generated token;
   - session id is non-empty;
   - `copilotVersion` is in the tested support table.
   The pinned runtime writes the full token in plaintext into this canonical
   registry entry. Its `0700`/`0600` mode hardening is Unix-only; on Windows the
   files inherit existing directory ACLs and the pinned runtime does not
   enforce a user-only DACL. M1a accepts that source-owned at-rest behavior
   under an explicit same-account/local-host trust assumption, reads only the
   exact child-PID entry, and never copies the token into Happy metadata, logs,
   diagnostics, or retained evidence. Windows DACL/reparse and stronger
   token-at-rest policy remains hardening.
7. On timeout, malformed registry data, early child exit, or failed handshake,
   close the client and terminate only the retained child handle.

M1a does not scan for or attach to pre-existing entries.

### 5.3 Native client and compatibility gate

Implement a private, typed client for Copilot's `Content-Length` JSON-RPC
framing. It exposes no arbitrary request method. Its M1a allowlist is exactly:

- `connect`;
- `session.getForeground`;
- `session.resume`;
- `session.eventLog.read`;
- `runtime.shutdown` only for local owned-target teardown.

After foreground validation, the client stores the session id privately.
Every session-scoped wrapper injects that verified id internally; callers
cannot provide or override `sessionId`. This applies to `session.resume` and
every `session.eventLog.read`.

Validation:

- bounded header/body sizes and strict byte-count framing;
- request-id correlation, timeouts, and deterministic disconnect failure;
- token on `connect`;
- protocol version `3`;
- foreground session id equals the validated registry session id;
- registry and handshake versions satisfy the tested compatibility table and
  `registry.copilotVersion === connect.version`;
- required methods succeed; method-not-found is an unsupported-build failure;
- unsolicited server requests receive method-not-found and cannot invoke local
  behavior.

Exact callback-false object identity and binary/SEA attestation are not M1a
protocol prerequisites. The handshake order is:
`connect -> session.getForeground -> install notification prebuffer ->
session.resume`. The minimal resume sets the verified `sessionId` and
`disableResume:true`, and does not set prompt observation or interactive
callback capabilities. It is tested behaviorally: foreground events route to
the prebuffer without emitting a synthetic `session.resume` row. The request
advertises no tools, commands, or canvases.

The initial compatibility table is intentionally one row:

| Registry schema | Protocol | Registry/connect package version | Required methods |
|---|---:|---|---|
| `2` | `3` | exactly `1.0.71-3` (the installed SEA artifact tested by M1a) | the M1a method allowlist above |

Reject every other package version in M1a. The pinned source checkout's
`package.json` value `0.0.1` is only `DEVELOPMENT_FALLBACK_CLI_VERSION`;
release packaging passes the release version into the SEA build and injects
it as `__CLI_VERSION__`, which is what registry publication and `connect`
report. Therefore `0.0.1` is explicitly unsupported. The M1a gate pins the
tested installed artifact/build label `1.0.71-3` and requires
registry/connect equality; artifact-tree/source attestation remains an
explicit hardening deferral.

### 5.4 Restricted Happy API profile

Add an `ApiSessionClient` construction option equivalent to:

```ts
{ rpcProfile: 'mirror-read-only' }
```

The profile still connects, sends typed session envelopes, and observes
lifecycle signals required to stop the relay. It does not call
`registerCommonHandlers`, does not register shell/filesystem/workspace RPC
handlers, and does not route incoming user messages to a provider callback.
It registers exactly one provider-specific phone RPC, parameterless
`killSession`, as the high-level Archive lifecycle action. The handler
atomically latches `finalizeOnce('phone-archive')`, returns success once the
quiescing latch is set, and continues the memoized cleanup asynchronously so
the RPC response does not wait on its own socket closure. Repeated calls are
idempotent; no raw native method or argument crosses this boundary.

The app recognizes `metadata.flavor === 'copilot'` as read-only in M1a:
`SessionView` does not mount `AgentInput` at all, so composer, attachment
picker/drop/paste, abort, permission-mode, model/mode/effort, file, and
autocomplete controls do not exist. `useForkComposer` also blocks send as
defense in depth.
The sync layer can briefly synthesize an unknown-session placeholder with
`metadata:{path:'',host:'',machineId}` before the real session row supplies
`flavor`. `SessionView` must therefore treat that incomplete placeholder as
non-interactive for every provider: no `AgentInput`, abort, sidebar, avatar
details/menu, context drawer, archived-resume hint, pending-switch banner, or
provider action mounts until real metadata replaces it. Its header/list quick
action array is empty. The real Copilot row then remains read-only by flavor.
`MessageView` also receives the read-only flavor: it supplies no option-send
callback, no session id for session-file/link actions, and no fork-from-message
action. `ChatList` forces flat message rendering for Copilot so grouped tool or
agent-work views cannot bypass `MessageView` gating.
`SessionView` also suppresses the fork files-sidebar state, toggle, and wrapper
for Copilot, so no desktop/tablet file browser remains reachable. It also
suppresses the context drawer, archived-resume hint, and pending-switch banner,
which otherwise expose fork/resume/model/permission/take-over/cancel controls.
`useSessionQuickActions` is the single header/list action gate. For an active
Copilot session it returns exactly **Details** and **Archive**; an already
inactive/archived Copilot session returns only **Details**. It omits resume,
fork, spawn-child, copy-metadata, and copy-metadata-plus-logs; the web header
popover and mobile/list long-press therefore cannot reach those actions.
Placeholder sessions return no actions. `ActiveSessionsGroupCompact` must also
consume the hook's `canArchive` result before mounting `Swipeable`: active
Copilot rows expose the same safe Archive handler, while incomplete
placeholders and inactive Copilot rows render plain children with no swipe
action. This prevents the compact list from bypassing the shared action gate.

The Details route is independently gated. For Copilot it is display-only
metadata plus the same safe Archive action: hide CLI-update copy, session-id
copy, resume-command copy, plugins, skills, agents, machine navigation, resume,
Delete, metadata copy, and metadata-plus-logs copy. A placeholder route stays
loading/non-interactive until real metadata arrives.

Hidden links are not the security boundary. Every independently routable
session child screen also validates the hydrated parent before performing any
effect. Copilot and incomplete placeholders fail closed on `spawn-child`,
`fork-composer`, `files`, `file`, `plugins`, `skills`, and `agents`; these
screens neither render their controls/data nor call spawn, send, worktree,
filesystem, shell, search, prefetch, or catalog operations. Direct/deep links
therefore cannot bypass the M1a phone allowlist. The nested
`message/[messageId]` detail route also fails closed before message lookup,
prefetch, `ToolFullView`, permission/footer, or content rendering. `info`
remains the only permitted child route and is constrained as above.

Copilot Archive never calls `maybeCleanupWorktree`, never invokes shell or
filesystem cleanup, and never falls back to the server-only
`POST /v1/sessions/:id/archive` endpoint (that endpoint deactivates storage but
does not wake the relay). It calls only the provider-specific `killSession`
handler above. RPC failure is shown and leaves the session active for retry;
successful finalization performs runtime shutdown, deterministic stop delivery,
metadata archival, session death, flush, and close.

The complete M1a phone action allowlist is: existing Back/navigation, read-only
Details, Archive while active, message scrolling, and existing tail/range
pagination.
The sole phone-to-controller action is that parameterless Archive lifecycle
request; there is no prompt, abort, steering, configuration, permission, or
other provider action. The complete phone event surface is the closed typed
projection in section 7; no raw native method, params, or notification reaches
the app.
M1a emits neither a rejection chat row nor a consumption receipt for phone
input. A defense-in-depth CLI guard drops and records any unexpected inbound
user row without forwarding it and without claiming it was consumed.

## 6. Gap-free bootstrap and live relay

### 6.1 Data structures

```ts
type BufferedNativeEvent = {
  arrival: number;
  event: AllowedNativeEvent;
};

type RelayBootstrap = {
  prebufferOpen: boolean;
  prebuffer: BufferedNativeEvent[];
  historyIds: Set<string>;
  prebufferIds: Set<string>;
  frontierCursor?: string;
};

type ProjectedDelivery = {
  sourceEventId: string;
  projectionIndex: number;
  envelope: SessionEnvelope;
  localId: string;
};
```

Sets are in-memory bootstrap/reconnect state only. M1a persists no Copilot
cursor or event-id ledger.

### 6.2 Call chain

```text
copilotCommand
  -> runCopilotMirror
     -> spawnManagedTarget
     -> NativeLocalRpcClient.connect(token)
     -> session.getForeground
     -> install session.event prebuffer
     -> session.resume (routing only)
     -> EventRelay.bootstrapFromStart
        -> session.eventLog.read(cursor absent)
        -> drain persisted pages
        -> establish frontier
        -> close/drain prebuffer
        -> project + ordered Happy delivery
     -> EventRelay.longPoll(frontierCursor)
```

### 6.3 Source-correct algorithm

1. **Before resume:** after `session.getForeground` returns the validated
   session id, register the JSON-RPC `session.event` handler. It validates
   notification shape, foreground session id, allowed type, primary-agent
   scope, and event id, then appends accepted notifications in arrival order
   while `prebufferOpen`.
2. **Routing:** call `session.resume` only after the handler is active.
3. **First read:** call `session.eventLog.read` with no cursor,
   `agentScope:"primary"`, and the M1a type allowlist. This first call activates
   Copilot's lazy ephemeral buffer.
4. **Persisted backfill:** repeatedly read while `hasMore`. Keep the returned
   order exactly. Record each event id. A non-`ok` cursor status is fatal during
   bootstrap.
5. **Frontier:** with the prebuffer still open, issue non-blocking reads from
   the latest cursor until **two consecutive** reads return
   `hasMore === false` with no events. Any returned event or `hasMore:true`
   resets the consecutive-empty count; apply the page and continue from its
   cursor. Retain the second empty read's returned cursor as the live frontier.
   Bound this drain by startup time/page limits and fail closed rather than
   retiring the prebuffer without this repeated no-more proof.
6. **Atomic handoff:** in one event-loop turn, set `prebufferOpen = false` and
   detach/swap the notification callback, then snapshot the remaining queue.
   Process only prebuffer ids not already present in history, preserving their
   arrival order.
7. **Live:** begin long-poll `eventLog.read` from the frontier cursor with
   `waitMs:30000`, safely below the 300-second owner lease. An event
   racing between the frontier read and prebuffer close is present in the
   prebuffer and/or the runtime event-log buffer; event-id dedup removes the
   overlap. An event after close is captured by the already-active event-log
   buffer.
8. **Reconnect/restart of the relay loop:** discard the opaque cursor and replay
   from the start. Deterministic local ids let happy-server return existing rows
   rather than duplicate them.
9. **Expired continuation:** if any live read returns
   `cursorStatus:"expired"`, stop that continuation and re-enter replay from the
   start with a fresh notification prebuffer. Do not continue from the
   runtime's implicit truncated-history restart without rebuilding dedup state.

M1a's projected allowlist contains only durable final events. Ephemeral
notifications are still relevant to the handoff proof, but deltas/progress are
omitted from Happy. An ephemeral event emitted before routing exists is outside
the observable session-notification surface; it cannot affect M1a output
because no ephemeral type is projected.

### 6.4 Ordering and delivery

For every projected envelope:

```text
envelope.id = stableHash("copilot-envelope", sessionId, event.id, index)
localId     = stableHash("copilot-local",    sessionId, event.id, index)
time        = Date.parse(event.timestamp)
```

An invalid timestamp makes the event malformed and omitted. M1a does not
synthesize or monotonically adjust timestamps because that would invent
chronology. Deliveries enter M0's oldest-first queue in projection order and
wait for acknowledgement before the relay advances to the next source batch.
happy-server remains the authority that assigns monotonic session `seq` and
deduplicates local ids.

Copilot can emit several durable events in the same millisecond. The app's
shared storage reducer currently compares only `createdAt`, so M1a adds a
strictly order-preserving tie-break without changing pagination APIs or window
sizes: reducer input sorts by `(createdAt ASC, seq ASC)` and display storage by
`(createdAt DESC, seq DESC)`, retaining stable input order only when both keys
match. `seq` is Happy's assigned source-delivery order, not invented native
chronology. Focused live, initial-tail, and older-range tests cover
same-millisecond events.

Shutdown is the one lifecycle-specific exception: at quiesce start, capture
`shutdownTime` and derive one controller-owned envelope/localId from
`("copilot-stop", sessionId)`. Native shutdown observation and timeout both
refer to this same envelope; neither uses the native shutdown event id.

## 7. Closed M1a event projection

The reader passes these exact types to `session.eventLog.read` and rejects
malformed shapes. Events with `ephemeral === true` are omitted in M1a.

| Copilot event | Happy projection | Field policy |
|---|---|---|
| `session.start` | agent `start` | controller lifecycle turn id; no cwd, model, producer, or token fields; optional display title is controller-owned |
| `user.message` | user `text` | only when `agentId` and `source` are absent and `isAutopilotContinuation !== true`; use `content` only; omit transformed content and attachments |
| `assistant.turn_start` | agent `turn-start` | deterministic Happy turn from Copilot `turnId` |
| `assistant.message` | agent `text` when trimmed `content` is non-empty | `content` only; tool-only empty final messages emit no blank text row; omit reasoning, citations, provider ids, serverTools, and embedded toolRequests |
| `tool.execution_start` | agent `tool-call-start` | real validated `toolName` and `toolCallId`; title=name; `description:""`; exact M1a argument policy below |
| `tool.execution_complete` | agent `tool-call-end` | require a projected start and correlate its stored Happy turn by `toolCallId`; omit result bodies, telemetry, MCP metadata, and errors |
| `assistant.turn_end` | agent `turn-end(completed)` | correlate by `turnId` |
| `abort` | agent `turn-end(cancelled)` | close the currently open primary turn only; first terminal event wins |
| `session.error` | agent `service`, then `turn-end(failed)` when a primary turn is open | fixed controller-owned text `Copilot session failed.` only; never forward native error type/message/stack/URL/provider/request ids or formatted errors; first terminal event wins |
| `session.shutdown` | agent `stop` | controller lifecycle turn id; best-effort early trigger for the controller-owned shutdown latch; never supplies the stop id/time |

Tool argument policy:

- `arguments` is `unknown` in the pinned source;
- `toolName` must be a non-empty string of at most 128 UTF-8 bytes with no
  control characters; otherwise omit the start and its completion;
- M1a's closed named-schema allowlist contains exactly `view`: require a plain
  object with string `path`; canonicalize it against the Copilot session cwd,
  require it to remain inside that workspace, reject NUL/control characters or
  a display path over 512 UTF-8 bytes, and emit only
  `{path:<forward-slash workspace-relative path>}`;
- ignore all other `view` keys rather than forwarding them;
- for `grep`, `glob`, edit/write tools, all shell-class names (`bash`,
  `powershell`, `local_shell`, and aliases), MCP/plugin/extension tools, and
  every unknown name, preserve the validated real tool name but use
  wire-required `args:{}`;
- never stringify unknown input into `description`, `title`, or service text;
- wire terminology remains `args`; it is the validated projection of native
  `data.arguments`, not a claim that Copilot names the field `rawInput`.

Everything not listed is omitted safely, including:

- `assistant.*_delta`, reasoning, intent, progress, and partial results;
- `session.plan_changed` and `session.todos_changed`;
- usage/checkpoint events;
- all `subagent.*` and non-primary-agent rows;
- permission/user-input/elicitation/OAuth/sampling request/completion events;
- system messages/notifications, hooks, skills, commands, extensions, MCP,
  canvases, schedules, files, and custom events.

Known M1a fidelity gaps are explicit: no streaming, reasoning, tool result body
or success bit in the current Happy `tool-call-end`, plan/todos, usage,
subagents, permissions, or interactive waits. These are omissions, not fake
events. Per-turn terminal state is reconstructed during every replay:
`assistant.turn_end`, `abort`, and `session.error` race through a deterministic
first-terminal-wins latch so a later terminal cannot emit a second turn end.
One turn may contain multiple durable final `assistant.message` events. Project
each once in persisted lane order under the same deterministic Happy turn id;
do not collapse a turn to one assistant row.

Copilot marks `turnId` optional on final messages and tool events, while Happy
drops ordinary agent envelopes without `turn`. Keep one primary-turn state
machine:

- `assistant.turn_start` opens the source turn and its deterministic Happy turn;
- a message/tool start with an explicit `turnId` must match that open turn;
- a message/tool start with no `turnId` may use the sole open primary turn;
- without exactly one matching open turn, omit the event and record a
  payload-free categorized diagnostic;
- a projected tool start stores `toolCallId -> Happy turn`; its completion uses
  that stored turn, and an explicit conflicting source `turnId` is omitted;
- `assistant.turn_end` must match the open source turn before it closes it;
- `abort` and `session.error` attach only to the open turn;
- controller `start`/`stop` use one deterministic lifecycle turn id derived
  from the Happy session id.

## 8. Security and threat model

### Assets

- Copilot registry token and connection;
- Happy session credential;
- user prompts, assistant output, tool names/arguments;
- ability to invoke privileged local Copilot RPC methods.

### Boundaries

- Copilot JSON-RPC is loopback and token-authenticated but highly privileged.
- happy-cli is the sole protocol translator.
- happy-server/app receive only typed Happy envelopes.

### M1a controls

- token generated in memory and passed only to the owned child; the pinned
  runtime necessarily persists the full token in its canonical registry entry;
  Unix modes are hardened, Windows inherits ambient ACLs, and M1a explicitly
  trusts the current local account/host until DACL hardening; the controller
  never duplicates the token into Happy metadata/logs/diagnostics/evidence;
- registry PID must equal the directly spawned child PID;
- loopback-only host validation;
- strict schema/protocol/version/method gate;
- no generic native RPC function;
- no phone-to-Copilot/provider actions except the parameterless,
  provider-specific lifecycle `killSession` behind Archive; only the explicit
  Happy-local read-only/navigation/archive/pagination allowlist;
- read-only Happy RPC profile;
- small event allowlist;
- hidden/transformed prompts, attachments, provider ids, stacks, and unknown tool
  arguments omitted;
- bounded frames, event payloads, queue size, retries, and startup timeout;
- explicit 300-second runtime idle lease plus the pinned five-minute sweep,
  bounding an idle target after controller death to about ten minutes;
- structured redacted errors;
- flag defaults off.

### Deferred hardening, not M1a blockers

The later hardening milestone owns external process verification, re-adoption,
SEA/materialized package identity, artifact-tree hashing, Windows
DACL/reparse checks, a closed child environment, Node injection defenses,
OOP-runtime policy, durable checkpoints, token-at-rest policy, PID-reuse
recovery, and framing fuzzing. M1a's direct-child PID match and loopback/token
checks are sufficient for its local spawn-only acceptance boundary.

## 9. Failure recovery and shutdown

| Failure | M1a response |
|---|---|
| child exits before registry/handshake | fail command; clean local resources |
| registry timeout/mismatch | terminate retained child; do not scan other entries |
| framing/schema/version/method mismatch | fail closed and terminate retained child |
| JSON-RPC disconnect while child lives | bounded reconnect to the same retained child, then replay event log from start |
| Happy send outage | keep current projection batch queued; retry with same local ids |
| relay component restart in same owner process | replay from start; server dedup prevents duplicates |
| full happy-cli process crash | no re-adoption in M1a; the source runtime's configured 300-second idle timeout plus five-minute sweep bounds an idle orphan to about ten minutes, then a later invocation spawns a new target |
| phone Archive | app skips worktree cleanup and calls only parameterless Copilot `killSession`; handler latches `finalizeOnce('phone-archive')`; RPC failure shows an error and never force-archives storage behind a potentially live target |
| controlled stop | enter quiescing state, capture controller stop id/time, keep the current event-log read active, and call `runtime.shutdown`; if that one read returns native `session.shutdown`, it may trigger stop early, but any filtered/hook wake, read rejection, or delay falls through to the authoritative timeout; `emitStopOnce()` uses the same controller-owned envelope/localId and ignores all later native events/ACKs; after stop ACK, cancel reads, flush/timeout sends, close socket, and terminate only by retained child handle if still alive |

All terminal causes (controlled stop, archive request, child exit, RPC failure,
startup failure after Happy publication) call one memoized
`finalizeOnce(reason): Promise<void>`. The first caller owns cleanup and every
other caller awaits the same promise. Finalization is failure-safe and bounded:

1. `emitStopOnce()` enqueues the stable stop and waits only to a fixed delivery
   deadline; timeout is recorded but cannot block teardown;
2. metadata archival uses a new cancellable bounded update path rather than
   the current infinite-backoff `updateMetadata()`. It has an ACK deadline,
   bounded version-mismatch retries, explicit hard-error outcome, aborts retry
   work, releases the metadata lock, and failure cannot skip later steps;
3. `sendSessionDeath()` runs from `finally` even when archival fails;
4. flush has a fixed deadline;
5. close always runs, and finalization resolves after recording categorized
   failures.

The metadata step sets
`lifecycleState:'archived'` with `lifecycleStateSince`, `archivedBy:'cli'`, and
a redacted reason. This server lifecycle finalization is required even though
the app currently does not render `start`/`stop` envelopes.

No checkpoint is required for correctness. Replay cost is accepted for the
first milestone and bounded by the real-smoke/session-size acceptance fixture.

## 10. Exact repository edit budget

### M0

- `packages/happy-cli/src/api/sessionPayloadCodec.ts`
- `packages/happy-cli/src/api/sessionPayloadCodec.test.ts`
- `packages/happy-cli/src/api/types.ts`
- `packages/happy-cli/src/api/apiSession.ts`
- `packages/happy-cli/src/api/apiSession.test.ts`

### M1a

- `packages/happy-cli/src/index.ts` **after coordinator ownership grant**
- `packages/happy-cli/vitest.config.ts` **after coordinator ownership grant**
- `packages/happy-cli/src/commands/copilotCommand.ts`
- `packages/happy-cli/src/commands/copilotCommand.test.ts`
- `packages/happy-cli/src/agent/core/AgentBackend.ts`
- `packages/happy-cli/src/agent/copilot/index.ts`
- `packages/happy-cli/src/agent/copilot/types.ts`
- `packages/happy-cli/src/agent/copilot/managedServer.ts`
- `packages/happy-cli/src/agent/copilot/managedServer.test.ts`
- `packages/happy-cli/src/agent/copilot/nativeLocalRpcClient.ts`
- `packages/happy-cli/src/agent/copilot/nativeLocalRpcClient.test.ts`
- `packages/happy-cli/src/agent/copilot/eventProjection.ts`
- `packages/happy-cli/src/agent/copilot/eventProjection.test.ts`
- `packages/happy-cli/src/agent/copilot/eventRelay.ts`
- `packages/happy-cli/src/agent/copilot/eventRelay.test.ts`
- `packages/happy-cli/src/agent/copilot/runCopilotMirror.ts`
- `packages/happy-cli/src/agent/copilot/runCopilotMirror.test.ts`
- `packages/happy-cli/src/agent/copilot/copilot.integration.test.ts`
- `packages/happy-cli/src/agent/copilot/__tests__/managedServerStimulus.ts`
  for native `session.send` stimulus; it must not be imported by production
  code
- `packages/happy-cli/src/api/apiSession.ts`
- `packages/happy-cli/src/api/apiSession.test.ts`
- `packages/happy-cli/src/utils/createSessionMetadata.ts`
- `packages/happy-cli/src/utils/createSessionMetadata.test.ts` **after
  coordinator ownership grant**
- `packages/happy-app/sources/-session/SessionView.tsx` **after coordinator
  ownership grant**
- `packages/happy-app/sources/fork/session/useForkComposer.ts` **after
  coordinator ownership grant**
- `packages/happy-app/sources/fork/session/useSessionContextDrawer.tsx` **after
  coordinator ownership grant**
- `packages/happy-app/sources/-session/SessionView.copilotReadOnly.test.tsx`
  **after coordinator ownership grant**
- `packages/happy-app/sources/fork/session/useForkComposer.copilotReadOnly.test.ts`
  **after coordinator ownership grant**
- `packages/happy-app/sources/fork/session/useSessionContextDrawer.copilotReadOnly.test.tsx`
  **after coordinator ownership grant**
- `packages/happy-app/sources/components/MessageView.tsx` **after coordinator
  ownership grant**
- `packages/happy-app/sources/components/MessageView.copilotReadOnly.test.tsx`
  **after coordinator ownership grant**
- `packages/happy-app/sources/components/ChatList.tsx` **after coordinator
  ownership grant**
- `packages/happy-app/sources/components/ChatList.copilotReadOnly.test.tsx`
  **after coordinator ownership grant**
- `packages/happy-app/sources/components/ActiveSessionsGroupCompact.tsx`
  **after coordinator ownership grant**
- `packages/happy-app/sources/components/ActiveSessionsGroupCompact.test.tsx`
  **after coordinator ownership grant**
- `packages/happy-app/sources/hooks/useSessionQuickActions.ts` **after
  coordinator ownership grant**
- `packages/happy-app/sources/hooks/useSessionQuickActions.copilotReadOnly.test.ts`
  **after coordinator ownership grant**
- `packages/happy-app/sources/app/(app)/session/[id]/info.tsx` **after
  coordinator ownership grant**
- `packages/happy-app/sources/app/(app)/session/[id]/info.copilotReadOnly.test.tsx`
  **after coordinator ownership grant**
- `packages/happy-app/sources/app/(app)/session/[id]/spawn-child.tsx`
  **after coordinator ownership grant**
- `packages/happy-app/sources/app/(app)/session/[id]/spawn-child.test.tsx`
  **after coordinator ownership grant**
- `packages/happy-app/sources/app/(app)/session/[id]/fork-composer.tsx`
  **after coordinator ownership grant**
- `packages/happy-app/sources/app/(app)/session/[id]/fork-composer.test.tsx`
  **after coordinator ownership grant**
- `packages/happy-app/sources/app/(app)/session/[id]/files.tsx` **after
  coordinator ownership grant**
- `packages/happy-app/sources/app/(app)/session/[id]/files.copilotReadOnly.test.tsx`
  **after coordinator ownership grant**
- `packages/happy-app/sources/app/(app)/session/[id]/file.tsx` **after
  coordinator ownership grant**
- `packages/happy-app/sources/app/(app)/session/[id]/file.test.tsx` **after
  coordinator ownership grant**
- `packages/happy-app/sources/app/(app)/session/[id]/plugins.tsx` **after
  coordinator ownership grant**
- `packages/happy-app/sources/app/(app)/session/[id]/plugins.test.ts` **after
  coordinator ownership grant**
- `packages/happy-app/sources/app/(app)/session/[id]/skills.tsx` **after
  coordinator ownership grant**
- `packages/happy-app/sources/app/(app)/session/[id]/skills.test.ts` **after
  coordinator ownership grant**
- `packages/happy-app/sources/app/(app)/session/[id]/agents.tsx` **after
  coordinator ownership grant**
- `packages/happy-app/sources/app/(app)/session/[id]/agents.test.ts` **after
  coordinator ownership grant**
- `packages/happy-app/sources/app/(app)/session/[id]/message/[messageId].tsx`
  **after coordinator ownership grant**
- `packages/happy-app/sources/app/(app)/session/[id]/message/[messageId].copilotReadOnly.test.tsx`
  **after coordinator ownership grant**
- `packages/happy-app/sources/sync/storage.ts` **after coordinator ownership
  grant**
- `packages/happy-app/sources/sync/storage.copilotSequenceOrder.test.ts`
  **after coordinator ownership grant**
- `packages/happy-app/CHANGELOG.md` **after coordinator ownership grant**
- `packages/happy-app/sources/changelog/changelog.json` **after coordinator
  ownership grant; regenerate from the changelog**

No M1a production edit is expected in happy-server, happy-wire, or the Copilot
runtime. If implementation discovers a required file outside this budget, stop
and return to planning/ownership review rather than widening silently.

## 11. Tests and acceptance

### Unit

- framing split/coalesced reads, invalid headers, wrong byte counts, oversized
  frames, timeouts, unsolicited requests;
- plaintext and legacy-decrypted user, agent, and canonical
  `SessionProtocolMessageSchema` rows pass the wire schema; invalid role/session
  envelopes take the malformed-row path;
- session-scoped wrappers inject the verified foreground id and reject caller
  `sessionId` overrides;
- registry validation for wrong PID/kind/schema/host/port/token/session/version;
- registry/handshake package-version mismatch fails closed;
- registry-token tests assert Unix mode intent without claiming Windows DACL
  enforcement, and retained/logged outputs contain no token copy;
- spawn uses no piped stdio and child `error`/`exit` handlers remain active
  through cleanup;
- spawn sets `--session-idle-timeout 300`, remains parent-referenced, and a
  source-backed clock/sweep fixture proves owner-loss cleanup is bounded;
- token/redaction logging assertions;
- inherited direct `COPILOT_AGENTS_TAB=false` is overridden in the child;
- config-level `enabledFeatureFlags.COPILOT_AGENTS_TAB=false` fails precisely
  before spawn and is not rewritten;
- each projected type and every exclusion rule;
- multiple final assistant messages in one turn each emit once in persisted
  order under the same turn id;
- tool-only final assistant messages with empty content emit no blank text row;
- missing optional message/tool `turnId` uses the sole open primary turn;
  explicit mismatches and missing-without-open-turn rows are omitted with
  payload-free diagnostics; tool completion uses its projected start's turn;
- `session.error` emits only the fixed service text
  `Copilot session failed.` plus exactly one failed turn end when a turn is
  open; native error fields are absent and later terminal events are ignored;
- user-message source/attachment/transformed-content rejection;
- `view` preserves only a validated workspace-relative path; outside-workspace,
  oversized, control-bearing, malformed, and extra fields are omitted;
- `grep`, `glob`, mutation, MCP/plugin/extension, and unknown tool arguments
  use `{}` while preserving a validated real tool name;
- shell-class tools always use `args:{}`;
- deterministic envelope/local ids;
- oldest-first batching and retry with unchanged local ids;
- restricted Happy RPC profile registers no common handlers.
- restricted profile registers only parameterless idempotent `killSession` for
  phone lifecycle, and it latches asynchronous finalization before replying.
- Copilot flavor blocks composer send and hides/disables abort, permission,
  model/mode/effort, file, and autocomplete actions.
- Copilot message rendering exposes no option-send, session-file/link, or
  fork-from-message action.
- Copilot mounts no `AgentInput` and ChatList produces no grouped tool/agent
  views; attachment/drop/paste and grouped-view links cannot fire.
- Copilot suppresses the files sidebar/toggle/wrapper.
- Copilot suppresses context drawer, archived-resume hint, and pending-switch
  take-over/cancel actions.
- optimistic unknown-session placeholders are non-interactive before real
  flavor metadata arrives, have no avatar/details menu, and return no quick
  actions.
- compact-list swipe actions consume `canArchive`: active Copilot rows invoke
  the safe provider Archive, while placeholders and inactive Copilot rows mount
  no `Swipeable` or archive affordance.
- Copilot quick actions contain exactly Details and Archive in header and list
  surfaces while active and Details only after archival;
  resume/fork/spawn-child/copy actions are absent.
- Copilot Details is display-only plus safe Archive: update/id/resume-command
  copy, plugins/skills/agents/machine/resume/Delete, and metadata/log copy are
  absent; a placeholder details route remains non-interactive.
- direct routes for spawn-child, fork-composer, files/file, plugins, skills,
  and agents fail closed for Copilot and incomplete placeholders before any
  child-route side effect or data rendering.
- the nested message-detail route fails closed before lookup, prefetch,
  `ToolFullView`, permission/footer, or content rendering.
- Copilot Archive never calls worktree cleanup or server force-archive, calls
  parameterless `killSession` once, and leaves the session active on RPC
  failure.
- native-shutdown-vs-timeout and late-ACK races emit one shutdown local id;
- every exit path archives metadata, sends session death, flushes, and closes.
- pairwise controlled-stop/archive/child-exit/RPC-failure races share one
  memoized finalization and emit session death once.
- stop delivery timeout, metadata-update failure, flush timeout, and close
  failure are injected independently; no failure skips `sendSessionDeath()` or
  leaves `finalizeOnce()` pending forever.
- a never-ACKing metadata socket and perpetual version mismatch are cancelled
  at the archival deadline, release the lock, and still reach session death and
  close.

### Relay race matrix

Use a deterministic fake native server and event ids:

1. durable event emitted before `session.resume`: recovered by history;
2. event emitted during resume after forwarding is installed: captured by the
   prebuffer and history, emitted once;
3. event after resume but before first `eventLog.read`: captured by prebuffer
   and durable history, emitted once;
4. event during the first read: present in one or both sources, emitted once;
5. event during persisted page draining: lane order preserved;
6. event after frontier read but before prebuffer close: captured in prebuffer
   and/or runtime buffer, emitted once;
7. event immediately after prebuffer close: delivered by the next event-log
   read;
8. distinct persisted and prebuffer-only ids: persisted lane order followed by
   prebuffer arrival order, with no timestamp/parent merge;
9. reconnect/relay restart: replay from start, deterministic local-id dedup, no
   duplicate Happy rows;
10. expired live cursor: abandon continuation, replay from start, and produce no
    duplicate Happy rows;
11. more than 200 events arrive during frontier establishment: non-blocking
    reads continue until two consecutive empty `hasMore:false` results before
    prebuffer retirement, resetting the proof when an event appears;
12. native shutdown arrives before/at/after timeout and its ACK is delayed:
    exactly one deterministic stop is persisted and Happy lifecycle is
    finalized once;
13. the in-flight shutdown read wakes on a filtered hook event or rejects after
    shutdown begins: authoritative timeout still emits one stop;
14. pairwise terminal causes race: one finalization promise, one metadata
    archive, one `sendSessionDeath()`, one flush/close;
15. stop ACK never arrives and metadata/flush stages fail independently:
    deadlines advance cleanup, session death is attempted once, and
    finalization completes;
16. metadata ACK never settles or version mismatch repeats forever: bounded
    cancellation releases the lock and finalization still settles.

### Integration

- fake managed-server spawn through registry, handshake, foreground, routing
  resume, history, frontier, live read, and shutdown;
- more than 200 projected rows, including a batch boundary above 50;
- happy-server assigns strictly increasing seqs in source delivery order;
- same-millisecond events reduce oldest-to-newest by `(createdAt, seq)` and
  render newest-to-oldest by the inverse comparator across live, tail, and
  older-range merges;
- no duplicate local ids/rows after replay;
- simulated phone Archive receives an accepted lifecycle response, invokes no
  worktree/server-force-archive path, and drives the owned target through the
  same one-shot shutdown/finalization path;
- app initial tail remains 80
  (`packages/happy-app/sources/sync/sync.ts`);
- successive older ranges of 80 reconstruct the full set;
- existing server/app range and socket pagination tests pass unchanged.

Add `src/agent/copilot/copilot.integration.test.ts` to a dedicated
`integration-copilot-native` project in `packages/happy-cli/vitest.config.ts`.
The project runs only with `RUN_INTEGRATION=1`, uses one worker and an adequate
managed-server timeout. The real binary smoke inside it additionally requires
`RUN_COPILOT_NATIVE_SMOKE=1`; otherwise only deterministic fake-server
integration cases run.

### Real managed-server smoke

Against the pinned Copilot build:

1. launch the opt-in command in a fixture workspace;
2. verify direct managed child PID and registry schema 2;
3. connect, get foreground, and resume routing;
4. from a separate **test-only local stimulus client**, send one deterministic
   prompt through native `session.send` so the headless target produces final
   assistant output. This method is absent from production M1a types and is
   never exposed to the phone. Real tool execution is not required because a
   default-permission headless target can wait for approval; tool
   start/end/name/argument behavior is proven by hermetic native fixtures;
5. interrupt/restart the relay loop and verify replay produces no duplicate
   Happy rows;
6. create more than 200 projected rows or use a retained sanitized fixture from
   the same protocol build, then verify tail/range pagination;
7. scan logs, Happy payloads, and retained evidence for token, transformed
   prompts, attachment paths, provider ids, stacks, and rejected tool args.

Retain sanitized registry/handshake shapes, framed RPC fixtures, event fixtures,
race traces, Happy seq/local-id traces, and pagination assertions under the
implementation job artifacts. Never retain tokens or raw private prompts.

## 12. Rollout, rollback, and compatibility

- default off: `HAPPY_ENABLE_COPILOT_NATIVE` absent/false;
- explicit `happy copilot` command only;
- no automatic provider selection or migration;
- support table accepts only registry schema 2, protocol 3, exact package
  version/build label `1.0.71-3` on both registry and connect, and required
  methods;
- unknown schema/protocol/version/method behavior fails before Happy session
  publication where possible;
- immediate M1a rollback is flag-off while retaining the app's Copilot
  read-only compatibility guards for already persisted/active sessions;
- backend/app code may be reverted only after all Copilot sessions are
  archived/closed, or the small reader-safe UI guards remain;
- previously mirrored typed Happy history remains readable after rollback;
- no server/app migration is required.

## 13. Ordered implementation and later tasks

1. **Implement M0 only.** Review the cross-provider codec/delivery change and
   run Claude/Codex/ACP regressions.
2. **Obtain coordinator grants** for `packages/happy-cli/src/index.ts`,
   `packages/happy-cli/vitest.config.ts`,
   `packages/happy-cli/src/utils/createSessionMetadata.test.ts`,
   `packages/happy-app/sources/-session/SessionView.tsx`, and
   `packages/happy-app/sources/fork/session/useForkComposer.ts`,
   `packages/happy-app/sources/fork/session/useSessionContextDrawer.tsx`,
   `packages/happy-app/sources/components/MessageView.tsx`, and
   `packages/happy-app/sources/components/ChatList.tsx`,
   `packages/happy-app/sources/components/ActiveSessionsGroupCompact.tsx`,
   `packages/happy-app/sources/hooks/useSessionQuickActions.ts`,
   `packages/happy-app/sources/app/(app)/session/[id]/info.tsx`, the
   independently routable `spawn-child`, `fork-composer`, `files`, `file`,
   `plugins`, `skills`, `agents`, and nested `message/[messageId]` screens and
   tests,
   `packages/happy-app/sources/sync/storage.ts` and its focused sequence-order
   test, plus
   `packages/happy-app/CHANGELOG.md` and regenerated
   `packages/happy-app/sources/changelog/changelog.json`, including the exact
   Copilot read-only test paths in the edit budget.
3. **Implement M1a only** in story order: types/provider -> spawn/validation ->
   RPC/routing -> projection -> gap-free relay -> restricted runner ->
   pagination/real smoke.
4. Stop. Do not fold later control or hardening into M1a.

Proposed follow-up Tasks Board tasks:

- `happy-copilot-native-controller-basic-steering`
  - prompt and abort only;
- `happy-copilot-native-controller-rich-control`
  - session-scoped model/mode/reasoning/compact and separately reviewed
    high-level operations;
- `happy-copilot-native-controller-interactive-completeness`
  - permission, user-input, elicitation, OAuth, sampling, and pending-request
    reply schemas;
- `happy-copilot-native-controller-ui-server-tui-co-steering`
  - eventual local TUI plus phone control of one `--ui-server` session;
- `happy-copilot-native-controller-hardening-and-readoption`
  - external attach/re-adoption, persistent cursors, SEA/artifact attestation,
    DACL/reparse, closed environment, OOP policy, crash recovery, and fuzzing.

Conditional runtime-owned follow-up only if a later milestone proves the
current protocol insufficient:

- `copilot-runtime-external-controller-prompt-capability`.

The codexu implementation chain must stop at any proven runtime dependency.
Do not create a dual-repo PRD.
