# Stories outline

## Delivery contract

This outline is repository-scoped. M0/M1 are codexu-only and do not own
Copilot-runtime files. Each story is independently testable; later milestones
must not be folded into the read-only implementation.

## M0 - prerequisite

### Story 0 - Make CLI history and delivery sequencing correct

**Goal:** fetched Happy rows decode identically to sent/live rows, and delivery
acknowledgements cannot reorder replay or skip inbound rows.

**Files:** `src/api/sessionPayloadCodec.ts`,
`src/api/sessionPayloadCodec.test.ts`, focused `apiSession` tests.

**Acceptance:**

- fetch uses current plaintext JSON decoding;
- reconnect routes previously sent typed envelopes;
- malformed rows fail visibly and do not corrupt `lastSeq`;
- tests no longer codify silent drop;
- no claim that E2E encryption was restored;
- a new ordered delivery API sends oldest-first chunks, including >50 rows;
- outbound ACK seqs resolve deliveries but cannot jump the contiguous receive
  watermark over an unseen phone row;
- self-sent rows advance contiguous reconciliation without being routed as
  phone input;
- the change lands separately with Claude, Codex, and ACP reconnect/order
  regression coverage and has an explicit commit-revert rollback.

## M1 - read-only native mirror

### Story 1 - Define the provider and compatibility contract

**Goal:** add `copilot` flavor/provider types and a closed, source-pinned
protocol/event policy.

**Files:** `agent/core/AgentBackend.ts`, `agent/core/AgentRegistry.ts`,
`agent/copilot/types.ts`, `agent/copilot/eventPolicy.ts`,
`utils/createSessionMetadata.ts`.

**Acceptance:**

- registry schema 2 and protocol 3 are constants;
- `copilot` is registered as an agent/provider even though command dispatch
  remains a separate entrypoint concern;
- required methods, including owned-target `runtime.shutdown`, and the exact
  source/version/normalized-command/artifact-hash tested target tuple are
  explicit;
- all 110 event discriminants have one policy entry;
- unknown/malformed events fail closed;
- metadata contains no token.

### Story 2 - Spawn, discover, validate, and own a managed target

**Goal:** safely start or explicitly attach to a Copilot managed server.

**Files:** `agent/copilot/managedServer.ts` and tests.

**Acceptance:**

- uses `--server --port 0 --managed-server`;
- resolves and hashes a direct executable/base-argv command without a shell;
- Node dev targets hash the entry script/bundle as well as `node(.exe)`;
- bundled `app.js` and every resolved native addon (`runtime.node`,
  `cli-native.node`, etc.) are hashed; inherited
  `COPILOT_RUNTIME_OOP` is rejected;
- SEA uses a tokenless materialization run, content-addressed controller cache,
  `--no-auto-update`, no ambient dist-dir/preferred-version override, and then
  sets only the verified controller-owned dist dir for managed spawn; the whole
  normalized package tree and critical JS/native files are hashed;
- child environment is allow-listed and rejects Node injection, voice-server,
  OOP, Happy-secret, and detached-session variables;
- spawn uses non-piped stdio, closes parent log FDs, retains the child handle,
  and calls `unref()` after validation;
- preserves the Agents-tab feature inputs and sets the canonical managed-child
  environment (`COPILOT_RUN_APP`, `COPILOT_FORCE_WINDOWS_HIDE`, token);
- requires loopback, schema/kind/session/PID/mtime/version/hash;
- token is generated with CSPRNG, passed only in child env, and never logged;
- checkpoint stores no token;
- ambiguous attach fails;
- registry path/ownership/mode/DACL/reparse validation fails closed;
- external attach resolves and verifies process command/artifacts or fails
  closed;
- ownership provenance survives restart for diagnostics, but a re-adopted target
  is detach-only; shutdown/OS termination require the original live child
  handle;
- every materialization/registry/ACL/hash/handshake failure terminates and reaps
  the retained pre-validation child before returning;
- shutdown distinguishes owned vs external target and resists PID reuse.

### Story 3 - Implement the allow-listed native RPC transport

**Goal:** speak the pinned framed JSON-RPC without exposing a generic invoker.

**Files:** `agent/copilot/nativeLocalRpcClient.ts` and tests.

**Acceptance:**

- byte-correct `Content-Length` framing;
- bounded frame/request sizes and request timeouts;
- handlers listen before handshake;
- unsolicited server requests return method-not-found;
- M1 runs only the source-defined constant `session.resume` attach bridge:
  `disableResume:true`, `streaming:true`, all request callbacks false,
  prompt observation false, and no tools/commands;
- `session.event` is registered before the bridge but discarded; event-log read
  remains the sole projection seam;
- every session-scoped request carries the verified foreground `sessionId`;
- only required read-only methods plus owned-target `runtime.shutdown` are
  callable in M1;
- protocol/version/foreground identity mismatch fails closed.

### Story 4 - Persist safe controller checkpoints

**Goal:** resume event-log cursors without persisting credentials or making
subagent identity depend on checkpoint survival.

**Files:** `agent/copilot/checkpointStore.ts` and tests.

**Acceptance:**

- atomic owner-local writes under Happy home;
- schema/version/source-generation validation;
- restores the contiguous Happy receive seq before fetch/socket processing;
- persists pending deterministic localIds before POST and restores them before
  fetch/socket startup;
- stores spawned-vs-attached provenance and tested artifact-set hash;
- no token/auth/header/environment fields;
- corrupt checkpoint is quarantined/ignored, never partially applied;
- subagent IDs derive deterministically from Copilot session+agent identity and
  pass `isCuid()` after checkpoint deletion;
- read-only replies derive a deterministic localId from the inbound Happy row,
  and inbound seq advances only after that reply is acknowledged.

### Story 5 - Project native events into typed Happy envelopes

**Goal:** preserve canonical chat/tool/turn/subagent semantics without ACP loss.

**Files:** `agent/copilot/eventProjector.ts`, `eventPolicy.ts`, tests/fixtures.

**Acceptance:**

- final assistant/reasoning events win over deltas;
- no envelope per delta;
- hidden/source-tagged user injections, transformed content, and attachments
  never reach Happy;
- real tool names and only reviewed, recursively redacted argument fields reach
  `tool-call-start`; unknown schemas omit arguments explicitly;
- persisted `assistant.message.toolRequests` and `serverTools` cannot disappear
  when standalone execution events are absent;
- start/end correlation survives out-of-order batches;
- envelope time is monotonic;
- envelope/local IDs are deterministic;
- child envelopes use deterministic `subagent`; parent tool args carry the same
  `sessionSubagent`, including replay after checkpoint deletion;
- errors are redacted and mapped consistently;
- uncorrelated/session-level errors do not synthesize failed turns;
- task-complete/error/model-failure terminal fallbacks stay pending across
  event-log pages and are cancelled by later canonical events;
- `session.task_complete.success === false` keeps the turn open for retry and
  only becomes failed after canonical/idle-quiescent resolution;
- the durable safe cursor stays before every unresolved delta/tool/subagent/
  terminal buffer so crash replay rebuilds it;
- every event discriminant has one non-overlapping project/coalesce/local/exclude
  policy;
- plan/todo/usage/permission gaps match the plan rather than becoming fake
  events.

### Story 6 - Relay history and live events with delivery checkpoints

**Goal:** make `session.eventLog.read` the single no-gap/no-duplicate reader.

**Files:** `agent/copilot/eventReader.ts`, `api/apiSession.ts`, `api/api.ts`,
tests.

**Acceptance:**

- first read imports durable history;
- immediate pages are drained into a stable partial-order merge: persisted
  append order and ephemeral order are preserved, parent edges constrain
  insertion, and timestamps never reorder persisted rows;
- returned cursor continues into long-poll live reads;
- cursor persists only after Happy seq acknowledgements;
- source order equals server-seq order across multiple 50-row chunks;
- deterministic localIds are registered before POST so a socket self-echo that
  beats the HTTP response is never routed as phone input;
- crash after POST/before ACK restores pending localIds before receive;
- deterministic localId retry deduplicates server rows;
- cursor expiry and target restart replay safely;
- Happy outage does not advance the source cursor;
- interleaved phone input cannot be skipped by an outbound acknowledgement;
- controller restart resumes the Happy receive seq and replays/deduplicates an
  unacknowledged read-only reply;
- Copilot message-consumption receipt and read-only service reply both
  acknowledge before inbound seq advances;
- no JSONL, `session.getMessages`, or parallel `session.event` fallback.

### Story 7 - Wire the terminal runner with a real read-only boundary

**Goal:** create the Happy session, run lifecycle, and prevent phone control.

**Files:** `agent/copilot/runCopilot.ts`, `agent/copilot/index.ts`,
`commands/copilotCommand.ts`, `api/apiSession.ts`, tests.

**Acceptance:**

- `HAPPY_ENABLE_COPILOT_NATIVE=1` plus explicit command required;
- session tag/flavor are deterministic;
- restricted API profile registers no common shell/filesystem handlers;
- inbound Happy user text is not forwarded and gets a deterministic read-only
  response plus deterministic `agentFlavor:'copilot'` consumption receipt;
- target/socket/outbox/checkpoint shutdown order is idempotent;
- controller-local `stop` is authoritative and acknowledged before teardown;
  native shutdown uses the same ID but is never awaited for delivery;
- same-process owned teardown best-effort calls `runtime.shutdown`, then closes
  the socket and uses the original child handle if termination is needed;
- external/re-adopted teardown is detach-only;
- a Happy phone archive detaches the relay only and never shuts down or
  terminates an originally owned Copilot target;
- one-file `src/index.ts` dispatch dependency is landed separately or explicitly
  authorized before this story starts;
- `happy-copilot-message-consumption-flavor` has atomically added `copilot` to
  happy-wire and app raw schemas before this story starts.

### Story 8 - Prove persistence and pagination

**Goal:** establish that the new producer does not alter server/app behavior.

**Files:** `agent/copilot/copilot.integration.test.ts`, sanitized fixtures;
existing app tests are validation-only.

**Acceptance:**

- >200 finalized rows retain monotonic session seq;
- source order is preserved beyond the 50-row outbox boundary;
- tail 80 and older HTTP/socket ranges reconstruct all rows;
- restart/backfill creates no duplicates;
- phone rows before/during restart are handled exactly once;
- receipt+reply both deduplicate across crash and seq advances only after both;
- crashes at each unresolved projector buffer replay from the safe cursor;
- tool pairs and subagent rows remain associated;
- hidden prompts/secrets are absent from persisted Happy payloads;
- socket update seq never overwrites session seq;
- real managed-server smoke passes with no secret leakage.

## M2 - basic steering

### Story 9 - Add prompt and abort actions

Closed actions only:

- prompt -> `session.send`;
- abort -> `session.abort`.

Suppress the native echo of a Happy-originated user message using the returned
Copilot message ID. No attachments, mode/model changes, permissions, or generic
RPC.

## M3 - rich session control

### Story 10 - Add model, mode, reasoning, and compact

Expose schema-bound session operations and publish echoed effective state.
Commands/tasks require individual allow-list entries. Shell/workspace/global
MCP/plugin/extension/config operations remain excluded.

## M4 - interactive completeness

### Story 11 - Add tracked pending-request replies

Implement per-family request stores and high-level response schemas for
permission, user input, elicitation, exit-plan, OAuth, and sampling.

**Stop condition:** if external prompt observation cannot be safely enabled for
the tested runtime without a native capability, stop and file
`copilot-runtime-external-controller-prompt-capability`.

## M5 - eventual UI-server/TUI co-steering

### Story 12 - Plan, do not fold, TUI co-steering

Create a separate plan for attaching to a `--ui-server` target, ownership
transfer, first-response-wins interactive prompts, and terminal/phone presence.
Do not mutate the managed-server M1 lifecycle to approximate this.

## M6 - hardening

### Story 13 - Compatibility, recovery, and rollback matrix

Fuzz framing and event schemas, test supported runtime versions, audit
redaction/token custody, simulate PID reuse and target crashes, and prove
flag-off rollback leaves durable Happy history readable.
