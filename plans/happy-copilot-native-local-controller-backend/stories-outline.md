# Stories outline

## Delivery contract

M0-delivery and M1a form the Copilot implementation chain. M0-codec is a
separate cross-provider task with no dependency edge to M1a. M1a is spawn-only
and read-only: it accepts no phone input and persists no Copilot cursor.
Copilot runtime work is not required. A production M1a target is idle because
the milestone has no prompt source; the real smoke uses a separate test-only
local stimulus client. User-driven work starts in M2.

Before M1a starts, the coordinator must grant ownership of:

- `packages/happy-cli/src/index.ts`;
- `packages/happy-cli/src/api/api.ts`;
- `packages/happy-cli/src/api/api.test.ts`;
- `packages/happy-app/sources/-session/SessionView.tsx`;
- `packages/happy-app/sources/fork/session/useForkComposer.ts`;
- `packages/happy-app/sources/fork/session/useSessionContextDrawer.tsx`;
- `packages/happy-app/sources/-session/SessionView.copilotReadOnly.test.tsx`;
- `packages/happy-app/sources/fork/session/useForkComposer.copilotReadOnly.test.ts`;
- `packages/happy-app/sources/fork/session/useSessionContextDrawer.copilotReadOnly.test.tsx`;
- `packages/happy-app/sources/components/MessageView.tsx`;
- `packages/happy-app/sources/components/MessageView.copilotReadOnly.test.tsx`;
- `packages/happy-app/sources/components/ChatList.tsx`;
- `packages/happy-app/sources/components/ChatList.copilotReadOnly.test.tsx`;
- `packages/happy-app/sources/components/ActiveSessionsGroupCompact.tsx`;
- `packages/happy-app/sources/components/ActiveSessionsGroupCompact.test.tsx`;
- `packages/happy-app/sources/hooks/useSessionQuickActions.ts`;
- `packages/happy-app/sources/hooks/useSessionQuickActions.copilotReadOnly.test.ts`;
- `packages/happy-app/sources/app/(app)/session/[id]/info.tsx`;
- `packages/happy-app/sources/app/(app)/session/[id]/info.copilotReadOnly.test.tsx`;
- `packages/happy-app/sources/app/(app)/session/[id]/spawn-child.tsx`;
- `packages/happy-app/sources/app/(app)/session/[id]/spawn-child.test.tsx`;
- `packages/happy-app/sources/app/(app)/session/[id]/fork-composer.tsx`;
- `packages/happy-app/sources/app/(app)/session/[id]/fork-composer.test.tsx`;
- `packages/happy-app/sources/app/(app)/session/[id]/files.tsx`;
- `packages/happy-app/sources/app/(app)/session/[id]/files.copilotReadOnly.test.tsx`;
- `packages/happy-app/sources/app/(app)/session/[id]/file.tsx`;
- `packages/happy-app/sources/app/(app)/session/[id]/file.test.tsx`;
- `packages/happy-app/sources/app/(app)/session/[id]/plugins.tsx`;
- `packages/happy-app/sources/app/(app)/session/[id]/plugins.test.ts`;
- `packages/happy-app/sources/app/(app)/session/[id]/skills.tsx`;
- `packages/happy-app/sources/app/(app)/session/[id]/skills.test.ts`;
- `packages/happy-app/sources/app/(app)/session/[id]/agents.tsx`;
- `packages/happy-app/sources/app/(app)/session/[id]/agents.test.ts`;
- `packages/happy-app/sources/app/(app)/session/[id]/message/[messageId].tsx`;
- `packages/happy-app/sources/app/(app)/session/[id]/message/[messageId].copilotReadOnly.test.tsx`;
- `packages/happy-app/sources/sync/storage.ts`;
- `packages/happy-app/sources/sync/storage.copilotSequenceOrder.test.ts`;
- `packages/happy-cli/vitest.config.ts`;
- `packages/happy-cli/src/utils/createSessionMetadata.test.ts`;
- `packages/happy-app/CHANGELOG.md`;
- `packages/happy-app/sources/changelog/changelog.json`.

These are path grants, not separate architecture tasks. Source review proved
the app grants necessary because the current session view always exposes the
composer and control callbacks.

## M0-codec - independent cross-provider task

Task proposal: `happy-session-history-codec-plaintext-legacy-compat`.

### Story C0 - Decode current and legacy Happy history

**Goal:** remove the plaintext-send/decrypt-fetch asymmetry without changing
new outgoing bytes.

**Files:**

- `packages/happy-cli/src/api/sessionPayloadCodec.ts`
- `packages/happy-cli/src/api/types.ts`
- codec tests
- focused `apiSession` fetch tests

**Acceptance:**

- fetch parses plaintext JSON first;
- failed plaintext parse falls back to existing legacy decryption;
- plaintext and legacy-decoded values must pass canonical
  `@slopus/happy-wire` `MessageContentSchema`, including typed
  `role:"session"` protocol history; the CLI-local two-role union is replaced
  by a canonical re-export;
- malformed JSON, invalid decoded shapes, and invalid ciphertext produce typed,
  payload-free diagnostics and are skipped without stalling later rows;
- current plaintext and legacy encrypted fixtures both route;
- no E2E-encryption-restoration claim is made.
- this story has no dependency edge to M1a and may land before or after it;
- rollback reverts only the codec/fetch commit and does not disable M1a.

## M0-delivery - required M1a prerequisite

### Story D0 - Add deterministic oldest-first delivery

**Goal:** give the Copilot relay a narrow delivery API whose source order
becomes Happy server sequence order.

**Files:**

- `packages/happy-cli/src/api/apiSession.ts`
- `packages/happy-cli/src/api/apiSession.test.ts`

**Acceptance:**

- caller supplies a deterministic local id and receives `MessageDelivery`;
- queue head is flushed first in chunks of at most 50;
- a batch larger than 50 remains oldest-first;
- retry uses the same local id;
- outbound POST ACKs do not advance the inbound fetch watermark past unseen
  rows;
- no durable receive cursor or consumption receipt is added;
- Claude, Codex, and ACP reconnect/order regressions pass.
- rollback requires M1a to remain disabled/reverted, but does not touch codec or
  stored-history behavior.

## Dependency graph

```text
Story D0 (M0-delivery) ──required──> Stories 2-8 (M1a)

Story C0 (M0-codec) is independent
```

## M1a - spawn-only read-only native mirror

### Story 2 - Add provider types and command dispatch

**Goal:** make Copilot an explicit backend and expose one opt-in command.

**Files:**

- `packages/happy-cli/src/agent/core/AgentBackend.ts`
- `packages/happy-cli/src/agent/copilot/types.ts`
- `packages/happy-cli/src/commands/copilotCommand.ts`
- `packages/happy-cli/src/index.ts` after ownership grant
- `packages/happy-cli/src/utils/createSessionMetadata.ts`
- `packages/happy-cli/src/utils/createSessionMetadata.test.ts` after ownership
  grant
- `packages/happy-app/sources/-session/SessionView.tsx` after ownership grant
- `packages/happy-app/sources/fork/session/useForkComposer.ts` after ownership
  grant
- `packages/happy-app/sources/fork/session/useSessionContextDrawer.tsx` after
  ownership grant
- `packages/happy-app/sources/components/MessageView.tsx` after ownership grant
- `packages/happy-app/sources/components/ChatList.tsx` after ownership grant
- `packages/happy-app/sources/components/ActiveSessionsGroupCompact.tsx` after
  ownership grant
- `packages/happy-app/sources/hooks/useSessionQuickActions.ts` after ownership
  grant
- `packages/happy-app/sources/app/(app)/session/[id]/info.tsx` after ownership
  grant
- the direct `spawn-child`, `fork-composer`, `files`, `file`, `plugins`,
  `skills`, `agents`, and nested `message/[messageId]` route files and focused
  tests listed in the delivery contract after ownership grant
- `packages/happy-app/sources/sync/storage.ts` and
  `storage.copilotSequenceOrder.test.ts` after ownership grant
- `packages/happy-cli/vitest.config.ts` after ownership grant
- `packages/happy-app/CHANGELOG.md` and regenerated
  `packages/happy-app/sources/changelog/changelog.json` after ownership grant
- the exact Copilot read-only test files listed in the delivery contract

**Acceptance:**

- `copilot` is a real backend/session flavor;
- command requires `HAPPY_ENABLE_COPILOT_NATIVE=1`;
- no automatic provider selection;
- metadata contains no token, registry path, prompt, tool input, or process
  environment;
- command creates a restricted read-only Happy session;
- Copilot flavor mounts no `AgentInput`, eliminating composer, attachment
  picker/drop/paste, abort, permission, model/mode/effort, file, and
  autocomplete actions; `useForkComposer` also blocks send;
- Copilot message rows expose no option-send, session-file/link, or
  fork-from-message action;
- Copilot ChatList forces flat MessageView rendering, so grouped tool/agent
  views cannot bypass the gate;
- Copilot SessionView suppresses the files sidebar/toggle/wrapper;
- Copilot SessionView suppresses context drawer, archived-resume hint, and
  pending-switch take-over/cancel controls;
- optimistic unknown-session placeholders remain non-interactive before real
  flavor metadata arrives, expose no avatar/details route, and have no quick
  actions;
- active header/list quick actions are exactly Details and Archive; archived
  sessions show Details only; resume, fork, spawn-child, and metadata/log copy
  actions are absent;
- compact-list swipe consumes the same `canArchive` gate: active Copilot rows
  invoke the safe provider Archive, while placeholders and inactive Copilot
  rows mount no swipe action;
- Copilot Details is display-only plus safe Archive; update/id/resume-command
  copy, plugins/skills/agents/machine/resume/Delete, and metadata/log copy are
  absent;
- direct/deep links to spawn-child, fork-composer, files/file, plugins, skills,
  and agents reject Copilot and incomplete placeholders before any child-route
  side effect or data render;
- nested message detail rejects Copilot and incomplete placeholders before
  lookup, prefetch, `ToolFullView`, permission/footer, or content rendering;
- no phone input/receipt schema change is included.

### Story 3 - Spawn and validate one owned managed server

**Goal:** directly start a new headless target and reject ambiguous discovery.

**Files:**

- `agent/copilot/managedServer.ts`
- tests

**Acceptance:**

- direct executable spawn, no shell;
- args are `--server --port 0 --managed-server --session-idle-timeout 300`;
- stdio is non-piped (`ignore` by default), `windowsHide` is set, and
  persistent child `error`/`exit` handlers are installed immediately; the
  child is not detached or unrefed;
- any future file-FD diagnostic variant closes the parent's FD copy immediately
  after spawn;
- fresh in-memory connection token; the source runtime's canonical registry
  necessarily stores it plaintext; Unix modes are hardened, Windows inherits
  ambient ACLs under the explicit local-account/host trust assumption, and
  Happy metadata/logs/diagnostics/evidence never duplicate it;
- child env sets `COPILOT_RUN_APP=1`,
  `COPILOT_FORCE_WINDOWS_HIDE=1`, and preserves/enables the pinned runtime's
  `COPILOT_AGENTS_TAB` feature input;
- enabled feature flags are normalized so an inherited absent/disabled state
  cannot override `COPILOT_AGENTS_TAB`, and direct child env sets
  `COPILOT_AGENTS_TAB=true`;
- canonical config is inspected before spawn; an explicit
  `enabledFeatureFlags.COPILOT_AGENTS_TAB=false` fails precisely and is never
  rewritten;
- `COPILOT_LOADER_PID` and all three `COPILOT_DETACHED_*` attribution vars are
  scrubbed;
- registry lookup targets exactly `child.pid`;
- schema 2, `kind="managed-server"`, loopback, PID, port, token, non-empty
  session id, and tested version are validated;
- timeout, early exit, malformed/mismatched entry, or later handshake failure
  cleans up only the retained child;
- event-log reads refresh runtime activity; owner death is bounded by the
  300-second idle timeout plus the pinned five-minute sweep;
- no existing-target scan, attach, re-adoption, SEA materialization, artifact
  hashing, DACL/reparse policy, closed-env policy, or OOP policy.

### Story 4 - Implement the typed native RPC and routing bridge

**Goal:** connect to the owned target without exposing a generic invoker.

**Files:**

- `agent/copilot/nativeLocalRpcClient.ts`
- tests

**Acceptance:**

- strict bounded `Content-Length` framing;
- token-authenticated `connect`, protocol 3;
- `session.getForeground` identity matches registry;
- order is `connect -> getForeground -> install session.event prebuffer ->
  session.resume`;
- resume sets the verified session id and `disableResume:true`, with prompt
  observation and interactive callbacks disabled/omitted;
- resume is tested by actual foreground event routing, not exact optional
  callback-object/SEA attestation, and emits no synthetic resume row;
- no tools, commands, canvases, or prompt-observation capabilities are
  advertised;
- callable methods are only `connect`, `session.getForeground`,
  `session.resume`, `session.eventLog.read`, and owned-target
  `runtime.shutdown`;
- every session-scoped wrapper injects the privately stored verified foreground
  id and rejects caller-supplied `sessionId`;
- required method absence or version/schema mismatch fails closed;
- registry `copilotVersion` must equal `connect.version`;
- the only accepted initial tuple is registry schema 2, protocol 3, and package
  version/build label `1.0.71-3`; all other package versions fail closed;
- source `package.json` version `0.0.1` is a development fallback and is
  explicitly unsupported; binary/filesystem attestation remains deferred;
- unsolicited server requests cannot invoke local behavior.

### Story 5 - Project a small durable event allowlist

**Goal:** map only finalized primary-agent events to existing Happy wire types.

**Files:**

- `agent/copilot/eventProjection.ts`
- tests/fixtures

**Acceptance:**

- closed list: `session.start`, safe `user.message`,
  `assistant.turn_start`, `assistant.message`, `tool.execution_start`,
  `tool.execution_complete`, `assistant.turn_end`, `abort`,
  `session.error`, `session.shutdown`;
- ephemeral instances are omitted;
- `user.message` requires absent source/agent id, is not autopilot continuation,
  and exposes only displayed `content`;
- assistant message exposes only final `content`;
- tool-only final assistant messages with empty content emit no text row;
- tool start keeps the real `toolName` and `toolCallId`;
- the only argument schema is `view`, which emits only a bounded normalized
  workspace-relative `path`;
- grep/glob, mutation, shell, MCP/plugin/extension, and unknown tools preserve a
  validated real name but always use `args:{}`;
- tool results, transformed prompts, attachments, reasoning, provider ids,
  stacks, URLs, and telemetry are omitted;
- deltas/progress coalesce by omission in favor of durable finals;
- plan/todos, usage, subagents, permissions, interactions, and all unlisted
  variants are safely omitted;
- `session.error` emits only the fixed service row
  `Copilot session failed.` and one failed turn end when a primary turn is
  open; no native error field or formatted error is forwarded;
- `assistant.turn_end`, `abort`, and `session.error` use deterministic
  first-terminal-wins state so replay or a later terminal event cannot double
  close a turn;
- deterministic envelope/turn/local ids are tested;
- multiple final assistant messages in one turn each emit once in persisted
  order under the same turn id;
- missing optional message/tool `turnId` uses the sole open primary turn;
  explicit mismatches and missing-without-open-turn cases are omitted, tool
  completion uses its projected start's stored Happy turn, and lifecycle
  start/stop use a deterministic controller turn;
- validated native timestamps are preserved; invalid timestamps omit the event
  rather than synthesizing chronology.

### Story 6 - Bootstrap history and live events without gaps or duplicates

**Goal:** use a pre-resume live buffer plus event-log frontier handoff.

**Files:**

- `agent/copilot/eventRelay.ts`
- tests

**Acceptance:**

- notification prebuffer is installed before resume;
- first event-log read occurs after routing resume and starts from no cursor;
- persisted pages retain returned order;
- first read activates the runtime event-log ephemeral buffer;
- non-blocking reads continue until two consecutive empty `hasMore:false`
  results, resetting on any event/`hasMore:true`, establishing the live
  frontier while the prebuffer is still open; startup/page bounds fail closed
  rather than switching early;
- prebuffer close/drain is atomic in one event-loop turn;
- overlap dedup uses native event id;
- persisted lane order and prebuffer-only arrival order are preserved;
- no timestamp/parent/partial-order merge;
- long-poll continues from the frontier cursor with `waitMs:30000`, below the
  owner idle lease;
- an expired live cursor re-enters replay from the start with fresh bootstrap
  dedup state;
- reader/relay restart replays from the start and uses deterministic local-id
  dedup rather than a persisted cursor;
- races before, during, and after resume/first read/frontier handoff have no
  missing or duplicate projected rows;
- a >200-event frontier race drains every immediate page before handoff.

### Story 7 - Wire the restricted mirror runner and lifecycle

**Goal:** run the mirror without exposing local machine control to the phone.

**Files:**

- `agent/copilot/runCopilotMirror.ts`
- `agent/copilot/index.ts`
- `commands/copilotCommand.ts`
- `api/api.ts` after ownership grant
- `api/api.test.ts` after ownership grant
- `api/apiSession.ts`
- tests

**Acceptance:**

- Happy API uses `mirror-read-only` RPC profile;
- `runCopilotMirror` calls
  `api.sessionSyncClient(session, {rpcProfile:'mirror-read-only'})`;
- `ApiClient.sessionSyncClient()` forwards the explicit options to
  `ApiSessionClient`; omitted options preserve every existing caller's
  default/full profile, with focused factory coverage in `api.test.ts`;
- common shell/filesystem/workspace handlers are not registered;
- the only phone lifecycle RPC is parameterless idempotent `killSession`, which
  latches `finalizeOnce('phone-archive')` before replying and continues cleanup
  asynchronously;
- no inbound user row is forwarded, acknowledged as consumed, or converted to
  a Copilot call;
- phone prompt/abort/steering/configuration/permission actions are empty; the
  exact Happy-local allowlist is Back/navigation, read-only Details, Archive
  while active, scrolling, and existing tail/range pagination;
- phone-facing events are only the Story 5 typed projections;
- no raw Copilot method/params, global config, plugins/extensions, MCP
  mutation, shell, workspace, filesystem, or privileged permission API;
- Happy outage retries the same ordered local ids;
- Copilot Archive skips `maybeCleanupWorktree`, calls only `killSession`, never
  falls back to server force-archive, and leaves the session active on RPC
  failure;
- same-process reconnect/restart replays from start;
- controlled stop captures one controller-derived stop id/time, keeps the
  current read active while calling `runtime.shutdown`, and lets native
  shutdown trigger early only if that read observes it; timeout is
  authoritative after filtered wake/read rejection/delay;
- native and timeout paths call the same `emitStopOnce()`; native event id is
  never used for the stop envelope;
- every terminal cause calls one memoized `finalizeOnce()` promise, which
  attempts stop delivery only to a fixed deadline, best-effort archives Happy
  metadata through a cancellable bounded update API, calls
  `sendSessionDeath()` from `finally`, bounds flush, and closes exactly once
  before final process cleanup;
- injected stop-ACK timeout, archival failure, and flush timeout cannot skip
  session death or leave finalization pending;
- never-settling metadata ACK and perpetual version mismatch are cancelled at
  deadline, release the metadata lock, and still reach close;
- full happy-cli crash re-adoption is explicitly unsupported in M1a, but the
  configured idle lease bounds an idle orphan to about ten minutes.

### Story 8 - Prove server/app pagination is unchanged

**Goal:** show the new producer works with existing Happy storage and windows.

**Files:**

- Copilot integration tests and sanitized fixtures;
- existing server/app pagination tests are validation-only.

**Acceptance:**

- more than 200 projected rows receive strictly increasing Happy seqs;
- source delivery order survives multiple 50-row POST batches;
- equal-millisecond rows reduce by `(createdAt ASC, seq ASC)` and display by
  `(createdAt DESC, seq DESC)` across live delivery and pagination merges;
- initial app tail contains the final 80 rows;
- successive older 80-row ranges reconstruct every row;
- socket/range dedup remains unchanged;
- replay from start creates no duplicate rows;
- a simulated phone Archive invokes no worktree/server-force-archive path and
  drives the owned target through the same one-shot finalization;
- real pinned managed-server smoke covers spawn, connect, foreground, routing
  resume, history, frontier, live event, replay, and shutdown;
- a separate test-only local stimulus client sends the smoke prompt through
  native `session.send`; production M1a has no send method;
- the real smoke requires final assistant output only; tool lifecycle/name/args
  are proven hermetically because default-permission headless tool execution
  can wait for approval;
- retained evidence contains no token, transformed prompt, private attachment
  path, provider id, stack, or rejected tool argument.
- `vitest.config.ts` includes a one-worker `integration-copilot-native` project
  gated by `RUN_INTEGRATION=1`; real binary smoke additionally requires
  `RUN_COPILOT_NATIVE_SMOKE=1`.

## Later milestones - separate tasks

### M2 - basic steering

Task proposal: `happy-copilot-native-controller-basic-steering`.

Add only high-level prompt and abort actions. No generic RPC.

### M3 - rich control

Task proposal: `happy-copilot-native-controller-rich-control`.

Add individually schema-bound session model/mode/reasoning/compact and selected
operations. Global config, shell/workspace, plugins/extensions, and privileged
permission mutation remain excluded.

### M4 - interactive completeness

Task proposal:
`happy-copilot-native-controller-interactive-completeness`.

Add tracked pending-request stores and high-level replies for permissions,
user input, elicitation, OAuth, sampling, and exit-plan flows. If the current
runtime cannot safely support external prompt observation, stop and file
`copilot-runtime-external-controller-prompt-capability`.

### M5 - UI-server/TUI co-steering

Task proposal:
`happy-copilot-native-controller-ui-server-tui-co-steering`.

Design attachment to one `--ui-server` session, ownership transfer,
first-response-wins interactions, and terminal/phone presence.

### M6 - hardening and re-adoption

Task proposal:
`happy-copilot-native-controller-hardening-and-readoption`.

Own external attach/re-adoption, persistent cursors/checkpoints, SEA
materialization, artifact-tree hashing, binary/process identity, DACL/reparse
enforcement, closed child environment, OOP-runtime policy, PID-reuse/crash
recovery, fuzzing, and rollback drills.
