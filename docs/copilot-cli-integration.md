# Adding GitHub Copilot CLI as a Happy backend

Status: research / design notes (2026-07-17). Claims verified against source in
`D:\repos\copilot-agent-runtime` and `codexu/packages` by a review pass;
corrections applied for the ACP fidelity, pagination, transport, and codec
sections.
Scope: how to add GitHub Copilot CLI as a third agent backend in codexu
(alongside Claude Code and Codex CLI), and how the mobile/web pagination
experience carries over.

Related docs: `cli-architecture.md`, `protocol.md`, `happy-wire.md`,
`fork-notes.md`, `fork-roadmap.md`.

---

## 1. How Copilot CLI emits events

Copilot CLI's runtime source lives at `D:\repos\copilot-agent-runtime`
(the `copilot-cli` repo is only the distribution/installer). It exposes several
event surfaces, in decreasing order of usefulness for a Happy-style relay:

1. **ACP server mode — best fit.**
   `copilot --acp --stdio` (or `--acp --host <h> --port <p>` for TCP) starts an
   Agent Client Protocol server over NDJSON. Internally it subscribes with
   `session.on("*")` and maps live activity (assistant messages, tool
   calls/results, permission requests, lifecycle) into ACP `sessionUpdate`
   notifications.
   - Impl: `src/cli/acp/server.ts` (stdio ~2104-2140, TCP ~2141-2168,
     `session.on("*")` ~1853-1867).
   - Mapping: `src/cli/acp/mapping.ts`.
   - Note: ACP emits *mapped* updates, not the raw `SessionEvent` objects.

2. **On-disk event log (`events.jsonl`).**
   Every session appends a JSONL transcript to
   `<Copilot home>/session-state/<session-id>/events.jsonl` — the default home
   is `~/.copilot`, but `--config-dir` / `COPILOT_HOME` relocate it
   (`src/helpers/path-helpers.ts:113-130`, `src/core/sessionEventState.ts:51-61`;
   load ~91-106, append ~158-185).
   Envelope shape:
   ```
   { type, data, id, timestamp, parentId, agentId?, ephemeral? }
   ```
   Event families include `session.start|resume|shutdown|idle|model_change`,
   `user.message`, `assistant.turn_start|message_start|message_delta|message|
   reasoning|turn_end`, `tool.execution_start|partial_result|progress|complete`,
   `permission.requested|completed`, `hook.*`, `subagent.*`, `system.message`,
   `session.error`.
   - `ephemeral: true` events are NOT persisted to the jsonl.
   - Windows caveat: the runtime opens/closes the file per append behind an
     in-process per-path mutex — there is NO session-lifetime lock. Guard a tail
     against transient append races (a partial final line), not a continuous
     sharing violation. (The separate "sharing violation" seen when *copying* a
     live session is a copy-time artifact, not a runtime lock.)

3. **Built-in remote — GitHub Mission Control.**
   `--remote` (interactive/steerable) and `--remote-export` (read-only) stream
   `session.on("*")` to Mission Control (`remoteSessionExporter.ts` →
   `missionControlClient.ts`). Batching differs: steerable `--remote` flushes
   every ~500 ms; non-steerable export flushes on terminal events, at 500
   events, or on a 60 s safety interval (`remoteSessionExporter.ts:56-64,116-125`).
   The exporter's wildcard listener also *filters five streaming types*
   (message/reasoning deltas, partial tool results) before sending
   (`remoteSessionExporter.ts:633-647`). The endpoint defaults to GitHub's
   `/agents` but is overridable via `COPILOT_MC_BASE_URL`
   (`setupRemoteExporter.ts:111-119`) — still the Mission Control protocol, not a
   generic webhook. This is the path the GitHub web/mobile client consumes;
   its eager-load behavior is an *observed client trait* (the client code is not
   in these source trees, so treat that as observation, not verified here).

4. **OpenTelemetry** (`OTEL_*` env) — opt-in traces/metrics; metadata only
   unless `OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT=true`. Lossy
   telemetry, not a transcript.

5. **Headless / other:** `-p/--prompt` + `--output-format json` (JSONL prompt
   output), MCP servers, hooks, extensions (tool-scoped, not a full event bus).

Internal (only if embedding the runtime): `session.on("*")` and the cursor-based
`eventLog.read({ cursor, waitMs })` in
`src/core/sharedApi/sessionEventsApi.ts`.

---

## 2. How the Happy integration relays a backend today

Per-backend pattern in `packages/happy-cli`:

```
CLI subprocess/protocol
  -> backend adapter/parser
  -> SessionEnvelope[]              (packages/happy-wire/src/sessionProtocol.ts)
  -> ApiSessionClient.sendSessionProtocolMessage()   (src/api/apiSession.ts)
  -> Socket.IO "message"
  -> happy-server sessionUpdateHandler (persists, allocates seq)
  -> eventRouter.emitUpdate() fan-out
  -> mobile / web clients (happy-app)
```

- **Claude** is run by spawning the **Claude CLI** (`src/claude/claudeLocal.ts`,
  `scripts/claude_local_launcher.cjs`) plus a session-JSONL scanner
  (`src/claude/claudeLocalLauncher.ts`). The Anthropic Agent SDK is used only by
  a *shadow* metadata query (`src/claude/utils/queryInitMetadata.ts`), not to
  drive execution.
- **Codex** spawns `codex app-server` and speaks JSON-RPC; in this fork the
  transport **defaults to WebSocket with a stdio fallback**
  (`codexAppServerClient.ts:304-324`, `fork/onCodexRun.ts:735-741`), not
  stdio-only. Events (`codex/event` notifications, `params.msg`) are mapped to
  envelopes by `src/codex/utils/sessionProtocolMapper.ts`
  (`mapCodexMcpMessageToSessionEnvelopes`). Codex does NOT use the generic
  `AgentBackend` interface — it is a bespoke provider runner
  (`codex/runCodex.ts` -> `fork/onCodexRun.ts`).

**Generic abstractions that already exist (preferred for Copilot):**
- `src/agent/core/AgentBackend.ts` — interface: `startSession`, `sendPrompt`,
  `cancel`, `onMessage`, `respondToPermission`, `dispose`; normalized event type
  `AgentMessage` (`model-output`, `tool-call`, `tool-result`,
  `permission-request`, `event`).
- `src/agent/core/AgentRegistry.ts` — maps `AgentId` -> factory. **Note:
  `AgentId` currently has no Copilot member — one must be added.**
- `src/agent/acp/AcpBackend.ts` — **already implements ACP** via
  `@agentclientprotocol/sdk` (spawns a child, normalizes ACP notifications).
- **`src/agent/acp/runAcp.ts` + `src/agent/acp/AcpSessionManager.ts` — a fully
  generic ACP runner.** This is the key reuse target: a Copilot command can
  likely call `runAcp({ command: "copilot", args: ["--acp","--stdio"], ... })`
  (`runAcp.ts:454-478,542-551`; `AcpSessionManager.ts:103-170`) instead of
  writing a new mapper. `AcpSessionManager` is where ACP updates are turned into
  `SessionEnvelope`s (and where delta coalescing actually happens — see §6).

Canonical wire types (`packages/happy-wire/src/sessionProtocol.ts`):
```
SessionEnvelope = { id, time, role, turn?, subagent?, ev: SessionEvent }
SessionEvent    = { t: 'text', text, thinking? }
                | { t: 'tool-call-start', call, name, title, description, args }
                | { t: 'tool-call-end', call }
                | { t: 'turn-start' } | { t: 'turn-end', status }
                | { t: 'start' } | { t: 'stop' } | { t: 'file', ... }
```
The union also has `service`, `context-boundary`, `agent-configuration-changed`,
and `message-consumption` variants (`sessionProtocol.ts:70-128`). **Important:
there is NO `subagent` variant and NO `plan` variant on `SessionEvent`** —
`subagent` is a field on the *envelope*, and the live nested-agent tree is a
*separate* `AgentTreeDelta` protocol (`happy-wire/src/agentTree.ts`), not a
`SessionEvent`.

> Security note (shipping blocker, not just cosmetic): this fork's
> `sessionPayloadCodec` serializes **plaintext** JSON despite "encrypted" naming
> (`src/api/sessionPayloadCodec.ts:36-43`, `src/api/apiSession.ts:667-680`).
> Worse, the **cold-fetch path still attempts decryption**
> (`sessionPayloadCodec.ts:9-24`, `apiSession.ts:578-594`), so plaintext-sent
> messages can be *dropped* after a reconnect/history refetch. Resolve this
> asymmetry before shipping.

---

## 3. Pagination (the "load last X, scroll up" experience)

The superior pagination is a property of **happy-app + happy-server**, keyed on
a per-message `seq`. It is completely backend-agnostic, so Copilot inherits it
with no app/server changes.

- Server allocates a monotonic `seq` per persisted message via an atomic
  per-session increment (`storage/seq.ts:17-25`,
  `sessionUpdateHandler.ts:275-297`). Monotonic, but gaps are possible because
  seq allocation precedes local-ID dedup on retries.
- Backward pagination RPC: `session-message-range`
  (`happy-server/.../sessionMessageRangeHandler.ts`) — request
  `{ requestId, sessionId, fromSeq, toSeq, limit }` (limit 1..200,
  `happy-wire/src/messages.ts:24-35`), returns that slice + `hasMore` (a cheap
  `seq < fromSeq` probe, `sessionMessageRangeHandler.ts:86-114`).
- Client windowing: `happy-app/sources/sync/messageWindow.ts`,
  `prefetchManager.ts`, `applyPrefetchedRange.ts`, `components/ChatList.tsx`,
  `fork/chat/usePageTurnScroll.ts`. Page size 80 is declared in `sync/sync.ts`
  (~195-196); overscan 60 / prefetch gap 40 are in `messageWindow.ts:3-8`.
- Caveat: the viewport-triggered *socket* range prefetch (the 60/40 path) is
  gated by `localSettings.enableSocketRangeFetch` (`sync/sync.ts:486-502,
  550-570`) — it is not unconditional.

**Why the current Copilot remote loads everything:** you are on the GitHub
Mission Control client (`--remote`), which renders whole `SessionEvent[]`
batches eagerly. Routing Copilot through Happy instead swaps the client and you
get tail-window + scroll-to-paginate for free.

### Requirements the Copilot adapter must satisfy for good pagination
1. **Emit discrete, finalized messages** — one `text` envelope per assistant
   turn, not one per delta (thousands of tiny seqs = noisy pagination). Copilot's
   mapper emits one `agent_message_chunk` *per delta*; the coalescing into a
   single envelope happens **Happy-side** in `AcpSessionManager`
   (`AcpSessionManager.ts:38-74,133-142`) — so reusing `runAcp`/`AcpSessionManager`
   gets you this for free, but a hand-rolled mapper must replicate it.
2. **Feed events in order** — `seq` = server arrival order. Live streaming is
   naturally ordered; when replaying/importing an existing `events.jsonl`
   (e.g. on resume), push records in file order so `seq` matches chronology.
3. **Map onto existing `SessionEvent` variants** — `text`,
   `tool-call-start/end`, `turn-start/end`, `start/stop`, `file`. Core Copilot
   activity fits these, so wire/pagination layers need no changes (but see §6:
   tool arg fidelity and plans need Happy-side handler fixes).

---

## 4. Recommended approach

Prefer the ACP route since Copilot speaks ACP natively and codexu already has a
**generic ACP runner** (`runAcp` / `AcpSessionManager`), not just `AcpBackend`.
The cleanest path reuses that runner rather than writing a new mapper:

```
copilot --acp --stdio
  -> runAcp({ command: "copilot", args: ["--acp","--stdio"], ... })
       (existing generic runner; AcpBackend + AcpSessionManager)
  -> AcpSessionManager maps/coalesces ACP updates -> SessionEnvelope[]
  -> ApiSessionClient.sendSessionProtocolMessage()
  -> (unchanged) Socket.IO / happy-server / happy-app
```

This reuses transport, sequencing, persistence, encryption path, fan-out, and
pagination unchanged.

Fallback (attach to an already-running ordinary interactive CLI, no relaunch):
tail `~/.copilot/session-state/<id>/events.jsonl`, parse newline-delimited
records, track `id`/`parentId`, handle partial final lines + file locks. Lower
latency guarantees and misses `ephemeral` events; use only if launch-via-ACP is
not possible.

---

## 4b. Does this require changes to the Copilot codebase?

**Default answer: no.** The recommended ACP path is chosen precisely so the
integration lives entirely on the codexu side and drives the *existing*
`copilot --acp --stdio` surface. Nothing below the codexu boundary must change
for the primary flow.

**No Copilot-runtime change required (codexu-only work):**
- Launch `copilot --acp --stdio` via the existing `AcpBackend`.
- Map ACP `sessionUpdate` -> `SessionEnvelope`.
- Pagination (pure happy-app / happy-server, backend-agnostic).
- `events.jsonl` tail fallback (read-only).

**Might require a Copilot-runtime change (only if §5 step 1 verification finds a
gap):**
- ACP mapping (`src/cli/acp/mapping.ts`) omits something Happy needs — e.g.
  reasoning deltas, subagent tree, token usage, or the session model label.
- Permission round-trip mismatch between ACP prompts and Happy's
  `respondToPermission()`.
- Auth/launch friction in `--acp` mode.
- (Anti-pattern) abandoning ACP for a native happy-server exporter inside the
  runtime — this *would* be a Copilot change; avoid it, prefer ACP.

### Policy for any Copilot-runtime change
If verification proves a Copilot-side change is genuinely required, it is
**local-only**, not an upstream contribution:
- Make it in a **local worktree** of `D:\repos\copilot-agent-runtime`
  (under `.worktrees`), registered with `copilot-local register <worktree>`.
- Fold it into the **`all-pending-fixes` batch local build** so it ships in the
  combined local CLI (`copilot-local all-pending-fixes ... --yolo`).
- **Do NOT open a PR, do NOT add `Fixes #`, do NOT push for upstream merge.**
  It is not part of the runtime-pr-workflow (no issue, no `needs-review`, no
  `post-to-slack`).
- Keep it minimal and additive (ideally behind the ACP surface) so it does not
  drift against upstream `main` and can be re-based cheaply after native-API
  changes.
- Track it in the workspace inventory (`knowledge\README.md` + the relevant
  detailed worktree page) as a local-only integration patch, distinct from
  PR-bound fixes.

Design goal: keep the Copilot-side delta empty or as close to empty as possible.
Every gap should first be evaluated for a codexu-side workaround (mapper
adjustment, jsonl enrichment) before patching the runtime.

## 5. Next steps

1. **Verify ACP mapping coverage.** Compare Copilot's ACP `sessionUpdate`
   variants (`src/cli/acp/mapping.ts`) against `AcpBackend`'s ACP->`AgentMessage`
   normalization and the `SessionEvent` union. Confirm assistant text, tool
   call start/result, reasoning, permission requests, and turn lifecycle all map
   cleanly, and that deltas are coalesced.
2. **Confirm delta coalescing.** Check whether ACP already finalizes
   `assistant.message` (vs streaming `message_delta`); if not, coalesce in the
   mapper so each turn yields one `text` envelope (+ incremental thinking as
   appropriate).
3. **Add a Copilot provider runner + registry entry.** Prefer reusing the
   generic `runAcp`/`AcpSessionManager` (call
   `runAcp({ command: "copilot", args: ["--acp","--stdio"] })`) rather than a new
   mapper; add a `copilot` member to `AgentId` in `AgentRegistry` and a thin
   `copilotCommand.ts`.
4. **Auth wiring.** Add `authenticateCopilot` analogous to
   `src/commands/connect/authenticateCodex.ts` (Copilot uses GitHub auth /
   `copilot` device login).
5. **Session metadata.** Extend `src/utils/createSessionMetadata.ts` and
   `src/api/types.ts` to include a `copilot` agent flavor (for app icons/labels
   and the tool-view renderers under
   `happy-app/sources/components/tools/views/`).
6. **Tool-view rendering.** Add/adjust known-tool views so Copilot tool calls
   (shell, edit, view, etc.) render nicely in `happy-app`
   (`components/tools/knownTools.tsx`).
7. **Permissions/approvals.** ACP permissions use the synchronous
   `requestPermission` RPC: Copilot calls it (`permissionHandlers.ts:103-119`)
   and Happy answers in the `AcpBackend` client handler
   (`AcpBackend.ts:563-575`). Note `respondToPermission()` is **not** the
   round-trip mechanism — it only emits a UI/log event
   (`AcpBackend.ts:631-689,1254-1272`); the real decision is returned
   synchronously by `AcpPermissionHandler`.
8. **Replay/resume ordering.** If supporting resume of an existing Copilot
   session, import `events.jsonl` in file order before going live.
9. **Encryption check (shipping blocker).** `sessionPayloadCodec` sends
   **plaintext** but the cold-fetch/history path still attempts decryption
   (`sessionPayloadCodec.ts:9-24`, `apiSession.ts:578-594`), so messages can be
   dropped after reconnect. Resolve the send/fetch asymmetry before shipping.
10. **Validation.** Run a live Copilot session end-to-end through happy-server
    into happy-app; confirm tail-window loads and scroll-up pagination
    (`session-message-range`) behave, and that seqs are monotonic and 1:1 with
    finalized messages.

## 6. ACP fidelity gap — kept vs dropped

Copilot's runtime union has **110** `SessionEvent` variants
(`src/core/generated/session-events.ts:3744-3745`). The ACP mapping
(`src/cli/acp/mapping.ts`) gives only **9** discriminants a non-null update path;
the other 101 return `null`. The loss is a mapping choice, **not** a Copilot
limitation — every dropped signal still exists at the source.

**Two-stage fidelity loss.** A signal only reaches Happy if it survives *both*
`mapping.ts` (Copilot side) *and* `AcpSessionManager`/`sessionUpdateHandlers.ts`
(Happy side). Several updates that `mapping.ts` *does* emit are then **dropped by
Happy** because Happy has no handler for them. So the real end-to-end "kept" set
is smaller than the mapper's 9.

### Emitted by Copilot's mapper (the 9 non-null cases)
The nine discriminants with a non-null path are `assistant.message_delta`,
`assistant.intent`, `assistant.reasoning_delta`, `tool.execution_start`,
`tool.execution_partial_result`, `tool.execution_complete`, `session.error`,
`session.info`, `session.warning` (`mapping.ts:324-496`). (`update_todo` is a
tool-*name* branch inside `tool.execution_*`, not a tenth event type.)

### Actually reaches Happy end-to-end
| Copilot event | ACP `sessionUpdate` | End-to-end status |
|---|---|---|
| `assistant.message_delta` | `agent_message_chunk` | **Kept.** One update per delta; Happy's `AcpSessionManager` coalesces them into one `text` envelope (`AcpSessionManager.ts:38-74,133-142`). Coalescing is Happy-side, NOT ACP-side. |
| `assistant.reasoning_delta`, `assistant.intent` | `agent_thought_chunk` | **Kept** (thinking); final `assistant.reasoning` is `null` (redundant). |
| `tool.execution_start` | `tool_call` | **Kept but low fidelity.** Copilot puts real args in `rawInput` and a *generic* ACP `kind`; Happy treats `kind` as the tool *name* and parses args from `content`, so the real tool name and most arguments are lost (`sessionUpdateHandlers.ts:249-314`). |
| `tool.execution_complete` | `tool_call_update` | **Kept but reduced** to a bare `tool-call-end`; rich result content is largely dropped (`AcpSessionManager.ts:145-167`). |
| `session.error` / `.info` / `.warning` | `agent_message_chunk` | **Kept** as text. |
| permission prompts | — (`requestPermission` RPC) | **Kept** via a separate synchronous RPC (§8), not the update stream. |
| turn boundaries | — (synthesized) | **Kept**, but `runAcp` *synthesizes* start/end and waits for an idle status after `prompt()` (`runAcp.ts:986-1008`, `AcpBackend.ts:1071-1082`) — not delivered "via the prompt() response". |

### Emitted by mapper but DROPPED by Happy (net loss today)
| Copilot event | Why it's lost |
|---|---|
| `update_todo` → `{sessionUpdate:"plan"}` | Copilot emits a standard ACP `plan` update (`mapping.ts:39-51,376-385`), but Happy's `AcpSessionManager` has **no plan handler** (`sessionUpdateHandlers.ts:520-537`) — the plan never renders. |
| `tool.execution_partial_result` → `tool_call_update` | The update carries no `status`; Happy's `handleToolCallUpdate` only emits for `pending/in_progress/completed/failed/cancelled` (`sessionUpdateHandlers.ts:437-465`), so incremental output is ignored. |

### Not lost despite `null` in mapping.ts
Some events return `null` in `mapping.ts` but are surfaced by a *different*
ACP mechanism the server wires up and Happy consumes:
| Copilot event | Reaches Happy via |
|---|---|
| `session.model_change` | ACP config/session-metadata update (`server.ts:1858-1865`) |
| `session.skills_loaded` | `available_commands_update` (`server.ts:1891-1903`, `AcpBackend.ts:974-995`) |

### Dropped (`return null`, no other path) — grouped by impact

**MUST-FIX — interactive / blocking request-response events:**
| Event(s) | Consequence |
|---|---|
| `elicitation.requested` / `.completed` | Agent-initiated questions outside the permission flow never surface. |
| `user_input.requested` / `.completed` | Blocking user-input requests never surface. |
| `sampling.requested` / `.completed` | Client-sampling requests never surface. |
| `external_tool.requested`, `exit_plan_mode.requested`, `auto_mode_switch.requested`, `session_limits_exhausted.requested`, `mcp.headers_refresh_required` | Additional request/response events whose schemas require a response — all `null` (`mapping.ts:551-591`). |
| `model.call_failure` | Model failures only visible if they also raise `session.error`. |
| `mcp.oauth_required` / `.completed` | **Not unhandled at runtime** — ACP mode installs a host-owned OAuth handler that acquires a token and resolves the request (`server.ts:682-685`, `mcp-oauth/wireSessionOAuthHandling.ts:45-56,72-110`). It's a **remote-UX gap** (the phone user can't drive it), not a lost runtime event. |

> These are read-write round-trips. A read-only `events.jsonl` tail **cannot**
> answer them, and `mapping.ts` **cannot** implement them (it may return only
> `SessionUpdate` objects). They require `server.ts` listeners that invoke an ACP
> *request* and resolve the runtime's pending request — exactly as permissions
> already do (§8). Treat these as the gate before trusting Copilot as a daily
> driver.

**Informational — visible degradation:**
| Event(s) | What's lost |
|---|---|
| `assistant.usage`, `session.usage_info`, `session.usage_checkpoint` | token counts, context budget, cost meter |
| `subagent.started/completed/failed/selected/deselected` | live nested subagent tree (`task` tool still shows as a generic tool call) |
| `session.compaction_start/complete`, `truncation`, `snapshot_rewind`, `context_changed` | no "context compacted/rewound" indication |
| `session.title_changed` | auto session title |
| `hook.start/end/progress` | hook activity |
| `session.mcp_servers_loaded`, `mcp_server_status_changed`, `mcp.*.list_changed` | MCP connection state |
| `tool.execution_progress` | fine-grained tool progress (only `partial_result` survives) |
| `session.background_tasks_changed`, `session.schedule_*` | background tasks / schedules |
| `skill.invoked`, `session.memory_changed`, `commands.changed`, `session.todos_changed` | skills/memory/command/todo changes (plan still built from the `update_todo` tool) |

**Feature-specific — entirely invisible:**
| Event(s) | What's lost |
|---|---|
| `session.canvas.*` | Copilot canvas UI has no representation |
| `session.binary_asset` | image / binary tool outputs won't render |

### Second-order gap: tool fidelity + Codex-specific renderers
Beyond dropped events, even *mapped* tool calls arrive degraded: Happy reads the
ACP `kind` as the tool name and parses arguments from `content`, so real tool
names and most arguments are lost and results collapse to a bare `tool-call-end`
(§6). On top of that, Happy has Codex-flavored views (`CodexDisplay.tsx`,
`CodexPatchView`, `agentTreeState`) that a generic ACP `tool_call` won't trigger.
Copilot would get plain, lossy tool views until both the arg-fidelity path and
Copilot-flavored renderers are added under
`happy-app/sources/components/tools/views/`.

## 7. Adding dropped signals later — feasibility

All of it is addable because the source events exist. A feature must line up
across four layers to reach the phone:

1. **Copilot emits it** — already true for all 110 events.
2. **ACP carries it** (`mapping.ts` + ACP `SessionUpdate` vocabulary) — the
   bottleneck; ACP is a fixed lowest-common-denominator schema.
3. **happy-wire can represent it.** `SessionEvent` variants are `text`,
   `tool-call-start/end`, `turn-start/end`, `start/stop`, `file`, `service`,
   `context-boundary`, `agent-configuration-changed`, `message-consumption`.
   Note: there is **no `plan` and no `subagent` `SessionEvent`** — `subagent` is
   an envelope field, and the live agent tree is the *separate* `AgentTreeDelta`
   protocol (`happy-wire/src/agentTree.ts`).
4. **happy-app renders it** (and, for tool calls, a Happy-side handler must exist
   in `sessionUpdateHandlers.ts` — several mapped updates are dropped today for
   lack of one).

| Category | Effort | Path |
|---|---|---|
| Plan (`update_todo`) | Easy-Med | Copilot already emits ACP `plan`; add a Happy-side plan handler in `sessionUpdateHandlers.ts` (currently missing) |
| Tool name/args fidelity | Medium | fix Happy's ACP `tool_call` handler to use `rawInput` + real tool name instead of `kind` |
| Tool progress (`execution_progress`/`partial_result`) | Medium | forward with a proper `status` so Happy's `handleToolCallUpdate` emits it |
| Context/compaction, hooks, MCP status, model-switch note, title, background tasks | Easy | forward as system `agent_message_chunk` notes (informational) |
| Images / binary assets | Medium | ACP image content **plus** an attachment upload/storage stage — a happy-wire `file` event needs a stored `ref` + name + size, not just an inline block |
| Subagent tree | Medium-Hard | drive the separate `AgentTreeDelta` protocol (not an envelope tag); encode subagent identity in ACP + decode in Happy, or side-channel |
| Token/usage/cost | Medium | no ACP slot — carry via ACP `_meta`/extension or synthetic message + happy-app meter |
| Elicitation / user_input / sampling / other `*.requested` | Hard | bidirectional round-trip like `requestPermission`; implemented in `server.ts` (invoke ACP request + resolve pending runtime request), **not** in `mapping.ts` |
| MCP OAuth (remote UX) | Hard | runtime already resolves it host-side; to let the *phone* drive it, route through an ACP request instead of the local host handler |
| Canvas | Largest | rich interactive UI; significant happy-app work; may not be worth it on mobile |

Tailwinds: ACP is an evolving open standard, so some signals (usage, richer
content, elicitation) may gain first-class ACP support upstream, shrinking the
local delta for free. Additions are independent and can be phased:
core (now) → interactive must-fix → informational enrichment → canvas (if worth
it).

## 8. Which approach: local runtime patch vs side-channel?

Neither wins universally — pick per signal. The governing principle is §4's
goal: **keep the Copilot-runtime delta as close to empty as possible.** Note a
key correction: **interactive flows are NOT a `mapping.ts` change** —
`mapEventToACPUpdate` may return only `SessionUpdate` objects
(`mapping.ts:317-323`). Bidirectional requests must be added in `server.ts` as
listeners that invoke an ACP *request* and then resolve the runtime's pending
request, the way permissions already work (`server.ts:637-672`).

- **Local runtime patch** (Copilot worktree): either forward more one-way events
  in `mapping.ts`, or add request/response wiring in `server.ts`.
  - Pro: single ordered live stream; low latency; captures ephemeral events;
    reuses ACP transport/permissions; the *only* way to do interactive flows.
  - Con: adds Copilot-runtime local delta to rebase after native-API changes;
    one-way forwards limited to ACP's vocabulary.
- **Side-channel** (tail `events.jsonl`, or the internal event API if embedding):
  feed rich one-way signals straight into happy-wire, bypassing ACP.
  - Pro: **zero Copilot-runtime delta**; can carry arbitrarily rich,
    Copilot-specific shapes ACP can't express; keeps ACP clean.
  - Con: second ingestion path; jsonl misses `ephemeral: true` events, has
    transient append races, and higher latency; **read-only — cannot answer any
    interactive request.**

### Decision rule
1. **Interactive / bidirectional?** (elicitation, user_input, sampling, other
   `*.requested`, phone-driven MCP OAuth) → **must** add `server.ts`
   request/response wiring. Side-channel is impossible (jsonl is read-only) and
   `mapping.ts` alone is insufficient. Accept the local delta — unavoidable and
   high value.
2. **One-way, persisted, latency-tolerant, rich/Copilot-specific?** (subagent
   tree, canvas, memory, MCP status, usage history) → **side-channel.** Keeps
   ACP and the runtime untouched — best fit for the zero-delta goal.
3. **One-way but ephemeral, low-latency, or cleanly ACP-shaped?** (tool progress,
   inline system notes) → **`mapping.ts` patch** (plus a matching Happy-side
   handler if none exists).

### Recommended default (hybrid)
Keep **ACP as the live control + core channel** (and the only channel for
interactive round-trips), and add a **read-only `events.jsonl` side-channel for
one-way enrichment**. Patch the runtime (`mapping.ts` for one-way, `server.ts`
for interactive) only when a signal is both (a) interactive/ephemeral/low-latency
and (b) genuinely needed.

**Correlation caveat (verified):** you cannot reliably join the JSONL and ACP
streams by source `id`/`timestamp`. ACP message updates **strip** the source
event id, timestamp, parentId, messageId, and agentId (`mapping.ts:328-335,
364-373`); only tool-call ids survive, and only for tools. If you run the hybrid,
either add explicit correlation metadata via a local patch or accept heuristic
dedup — do not assume id/timestamp joins work.

## 9. Telemetry egress (and the untag worktree task)

Running `copilot --acp` boots a full Copilot process that, by default, emits its
own product telemetry **out-of-band** — to Microsoft/GitHub (Application
Insights / Hydro), plus GitHub Failbot error reporting
(`index.ts:2012-2025`, `appInsightsTelemetryService.ts:35-38`). This is **not**
part of the ACP stream to Happy and does not contaminate Happy data, but the
child process does phone home each session.

**The ACP connection is instrumented / detectable:**
- Every telemetry event is stamped `clientType = "cli-acp"` (`index.ts:2003-2004`).
- The `--acp` boolean flag is reported to telemetry as `cli_acp=true`
  (`cliOptionsTelemetry.ts`; booleans are always included).
- On `initialize`, the connecting client's name/version is written into the
  `copilot_v0` usage events via `resolveAcpUsageMetricsAttribution`
  (`server.ts:1087`).
- Locally, the ACP server logs `"ACP initialize request from client: <name>"`,
  session create/load, transport (stdio/TCP + port) — visible in debug logs.

Not auto-triggered under ACP: the `--remote`/Mission Control exporter
(gated on `isTTY && !nonInteractivePrompt`, `index.ts:2000`) and OTel
(needs `OTEL_*`).

**Full off-switch:** `COPILOT_OFFLINE=true` → `NoopTelemetryService`
(`offline.ts`), but it also disables GitHub auth, web tools, GitHub MCP, and
auto-update — only viable with a BYOK/local model.

### Task (local worktree, not upstreamed): untag ACP telemetry
Goal: make an ACP-driven session report as a **normal session**, not `cli-acp`,
while leaving telemetry otherwise intact. Local-only per §4b — worktree in
`D:\repos\copilot-agent-runtime\.worktrees`, folded into `all-pending-fixes`,
**no PR**. Edit points:
1. `src/cli/index.ts:2003-2011` — the `clientType` branch. Map `options.acp` to
   `"cli-interactive"` (blend as a normal interactive session) instead of
   `"cli-acp"`. (Falling through would yield `cli-prompt` since ACP has no TTY;
   pick `cli-interactive` to look normal.)
2. `src/cli/telemetry/cliOptionsTelemetry.ts` — exclude the `acp` flag so
   `cli_acp=true` is not reported (add it to a skip set before the boolean rule).
3. `src/cli/acp/server.ts:1087` — optionally skip
   `setUsageMetricsAttribution(resolveAcpUsageMetricsAttribution(...))` (for
   Happy it already falls back to `copilot-cli` attribution, so low priority).

Notes: this does **not** stop telemetry egress (that's `COPILOT_OFFLINE`); it
only removes the ACP labeling. It deliberately makes telemetry misreport the
transport, adds local runtime delta to rebase after native-API changes, and
should be kept minimal/additive.

## 10. Session model: multi-session and co-steering (ACP vs remoteSteerable)

**Multiple sessions per ACP connection: fully supported.** The ACP server holds
`sessions: Map<string, AgentSession>` (`server.ts:288`) with `newSession`
(1134), `loadSession` (1228), `session/list` (1400), and per-`sessionId`
`setMode`/`setModel`/`prompt`/`cancel`. One ACP connection can create/resume and
drive many concurrent sessions — comparable to Codex app-server's
multi-conversation model.

**Session locking is advisory.** `registerSessionLock` →
`checkForAliveInUseLocks` returns `alreadyInUse` if another live process (e.g. a
TUI) holds the session, then registers a *second* lock and surfaces
`alreadyInUse: true` (`localSessionManager.ts:1236-1258, 3542-3546`). ACP
`loadSession` only hard-refuses if the *same* ACP server already loaded that id.
So attaching to a session that's live elsewhere is not blocked, but it's not a
clean guaranteed co-steer either — **validate empirically.**

### `remoteSteerable` vs ACP
`remoteSteerable` is a different mechanism, not a variant of ACP:

| | **ACP** | **remoteSteerable (`--remote`)** |
|---|---|---|
| Who owns the process | The ACP client spawns & owns a **headless** Copilot (no TUI) | The user's **own running CLI/TUI** session owns it |
| Coexists with a live TUI | No — the ACP client *is* the UI | **Yes — that's the point**: local TUI + remote both drive the same live session |
| Transport | Local NDJSON over stdio/TCP | HTTPS to **GitHub Mission Control** (cloud) |
| Protocol | Open, vendor-neutral ACP | GitHub-proprietary Mission Control |
| How remote input arrives | ACP client sends `prompt` directly | `commandPoller.ts` polls MC for user-typed commands and injects them via `session.send()`; the exporter streams events out |
| Gating | just `--acp` | `canSteer = steerable && remoteControlEnabled` (org/enterprise policy) |
| Destination/privacy | Local only | Sends session to GitHub cloud |

**Why it matters for Happy:** if the goal is "run Copilot in my terminal TUI
*and* also control that same live session from my phone," pure ACP does **not**
give it — with ACP, Happy owns a headless session and there's no concurrent
local TUI. The feature that provides true co-steering of a running TUI session is
`remoteSteerable`, but it is wired to GitHub Mission Control, not Happy. To get a
Happy-driven equivalent you'd have to build a remoteSteerable-style overlay
pointing at happy-server (a larger runtime change) — otherwise accept ACP's
headless model (Happy is the sole UI for the sessions it spawns).

## 11. Wanted: ACP + live TUI co-steer (a local remoteSteerable)

Goal: run Copilot's own TUI normally **and** have Happy drive that same live
session concurrently — remoteSteerable's coexistence, but over ACP/local instead
of GitHub Mission Control. Pure `--acp` cannot do this (it owns a headless
session, no TUI).

**Key finding — Copilot already has local multi-process co-steer.** Independent
of ACP, the runtime supports attaching multiple local controllers to one live
session over local TCP JSON-RPC (the "Agent View" feature):
- `--server --managed-server` spawns a **headless** target that publishes to the
  local discovery registry (`serverRegistry`, `kind="managed-server"`, with
  `sessionId` + TCP port) (`spawnLiveTarget.ts:1-52`).
- Controllers auto-attach over local TCP via `LocalRpcSession` /
  `NativeLocalRpcConnection` (`localRpcSession.ts:120-215`), receiving session
  notifications and **steering** via `sendRequest` (send message, `mode.set`,
  etc.). Multiple controllers can attach to one target.

This is the **local, non-cloud analog of remoteSteerable** — but it's Copilot's
**proprietary local session RPC**, not ACP. Nuance: in this model the target is
headless and the TUI is a *controller* (Agent View) rendering it — not the target
process itself owning a classic single-session chat TUI.

### Three implementation options
| # | Approach | Copilot change | ACP kept? | Notes |
|---|---|---|---|---|
| 1 | **happy-cli attaches as a native controller** over Copilot's local managed-server RPC (like Agent View) | Little/none | No | Fastest; gives TUI + co-steer today. happy-cli implements Copilot's `sessionApi`/`ProtocolMethods` local-RPC client (proprietary, version-coupled). |
| 2 | **ACP↔local-RPC bridge**: attach to a managed-server target over local RPC, re-expose as ACP to Happy | Moderate (local worktree) | Yes | Keeps Happy on `AcpBackend`; reuses the proven attach + arbitration infra. Recommended if ACP is required. |
| 3 | **Embed an ACP endpoint in the interactive TUI process** bound to the current live `Session` (TCP/pipe, since stdio is the TUI); reuse `acp/mapping.ts` outbound + add inbound prompt injection (`commandPoller`/`promptManager` style) | Largest / novel | Yes | Literal classic TUI co-driven by ACP in one process, but reinvents concurrency handling. |

**Hard problem in all options: concurrent steering / permission arbitration** —
two drivers (keyboard + Happy) sending prompts and answering permission/elicit
prompts on one live session. Options 1 and 2 reuse the mechanism that already
solves this (managed-server multi-controller + remoteSteerable's `promptManager`
and `commandPoller` injection). Option 3 must build it.

**Recommendation:** if ACP is a hard requirement, do **option 2** (bridge) —
smallest new logic that keeps Happy on ACP while inheriting the battle-tested
local-attach/arbitration path. If you'd accept a non-ACP local transport for this
specific "TUI + phone" mode, **option 1** is the fastest and may need no Copilot
change at all. Reserve option 3 for when a single-process classic TUI is
essential.

> **DECISION (2026-07-17): pursuing Option 1** — happy-cli attaches as a native
> controller over Copilot's managed-server local RPC. Rationale: fastest path to
> TUI + phone co-steer with little/no Copilot-runtime delta. Trade-off accepted:
> this path is Copilot's proprietary local session RPC, not ACP, so happy-cli
> implements a `sessionApi`/`ProtocolMethods` local-RPC client for it (the ACP
> backend can remain for headless/standalone Copilot sessions). Open question
> driving the feature audit in §12: exactly which steering actions and
> information surfaces are reachable over the local controller RPC (skills
> discover/run, MCP install, `/compact`, tool info, subagent tree, etc.).

## 12. Approach comparison & Option 1 feature coverage

_Verified by gpt-5.6-sol audit against `D:\repos\copilot-agent-runtime`._

**Key framing:** "Supported" below means an authenticated controller can call the
method directly on the target's native local JSON-RPC connection. This raw
surface is **much broader than the stock `LocalRpcSession`/Agent View façade**:
- The generated dispatch table exposes server-wide APIs plus the complete session
  API, dispatching session calls straight to the live `Session`
  (`generated/apiDispatch.ts:19-279`, `jsonrpc/serverSeamDispatch.ts:200-211`);
  `SDKServer` instantiates models/tools/MCP/plugins/skills/agents/commands/
  settings/sessions APIs (`sdkServer.ts:727-801`).
- The stock façade handles only `session.event`, rejects server→client requests,
  and forwards a deliberately narrow set (`localRpcSession.ts:403-421, 473-503,
  315-347`).
- The target broadcasts all live events (incl. ephemeral) except standalone
  `session.binary_asset`; subagent streaming deltas are opt-in
  (`sdkServer.ts:4020-4097`).

So a custom Happy controller implementing the raw protocol gets far more than
today's Agent View UI.

> **TUI-target correction:** the chosen `--server --managed-server` target is
> **headless** (no TUI). For genuine "TUI + phone" co-steer, attach to a
> `--ui-server` TUI target instead (`spawnLiveTarget.ts:5-16`,
> `serverRegistry.ts:31-43`). Managed-server gives a headless session that both
> your Agent-View controller *and* Happy attach to.

### Option 1 feature coverage (native local controller RPC)
| Feature | Coverage | RPC / notification | Caveat |
|---|---|---|---|
| **Skills: discover/configure** | Supported (raw; not in façade) | `skills.discover`, `skills.getDiscoveryPaths`, `session.skills.list/enable/disable/reload`; `session.skills_loaded`, `skill.invoked` | `skill.invoked` exposes full skill content + allowed tools. |
| **Skills: invoke/run** | **Partial** | `session.commands.invoke({name,input})` then `session.send` if result is `kind:"agent-prompt"` | No generic `skills.invoke`/"run internal tool" RPC; only user-invocable enabled skills. |
| **MCP: add/install/configure** | Supported (raw; not in façade) | `mcp.config.list/add/update/remove/enable/disable/reload`, `mcp.discover`; then `session.mcp.reload` | "Install" = persist config, not package install. `mcp.config.reload` only clears cache; active session needs `session.mcp.reload`. Façade throws for these. |
| **MCP: status/list/tools** | Supported | `session.mcp.list/listTools/isServerRunning`; `session.mcp_servers_loaded`, `session.mcp_server_status_changed`, `mcp.*.list_changed` | List excludes raw secrets. |
| **MCP OAuth** | Partial/conditional | `mcp.oauth_required/completed`; `session.mcp.oauth.handlePendingRequest/login` | Events only fire if a typed interest exists — call `session.eventLog.registerInterest({eventType:"mcp.oauth_required"})` first. |
| **`/compact`** | Supported | `session.history.compact` or `session.commands.invoke({name:"compact"})`; `session.compaction_start/complete` | Façade already forwards this. Custom instructions ≤4000 chars. |
| **Tools: discover/metadata** | Supported | `tools.list`; `session.tools.getCurrentMetadata`; `session.mcp.listTools` | `getCurrentMetadata` = authoritative current set incl. MCP schema. No RPC to directly invoke a built-in tool. |
| **Tools: updates/execution** | Supported | `session.tools_updated`; `tool.execution_start/partial_result/progress/complete` | Only CLI-only `shell_exit` block stripped. |
| **Subagent tree/lifecycle** | **Partial** | `subagent.started/completed/failed/selected/deselected`; `session.tasks.list/getProgress/...` | No canonical `getAgentTree`; reconstruct via `agentId`+parent `toolCallId`. Streaming deltas suppressed unless `includeSubAgentStreamingEvents:true`. |
| **Send prompts / steer** | Supported | `session.send` (enqueue/immediate, attachments, wait) | Façade drops `selection`/`github_reference` attachments. |
| **Batch send** | Supported (raw only) | `session.sendMessages` | Façade `sendMessages()` throws (not implemented). |
| **Cancel/abort** | Supported | `session.abort`; `session.tasks.cancel`; compaction abort | `suspend` is target-owner-only. |
| **Permissions / user_input / elicitation / exit-plan / auto-mode / limits** | Supported, conditional | events + `session.permissions.handlePendingPermissionRequest`, `session.ui.handlePending*` | Resume with `observePromptEvents:true`; server expects proactive response RPCs (no server→client calls). |
| **Sampling** | **Partial** | `sampling.requested/completed`; `session.ui.handlePendingSampling` | Needs explicit `registerInterest`; else target cancels sampling silently. |
| **Model / reasoning effort** | Supported | `models.list`, `session.model.list/getCurrent/switchTo/setReasoningEffort`; `session.model_change`, `model.call_failure` | — |
| **Agent mode (interactive/plan/autopilot)** | Supported | `session.mode.get/set`; `session.mode_changed` | Availability is feature/policy dependent. |
| **Plan / todos** | Supported (raw; not façade) | `session.plan.read/update/delete/readSqlTodos...`; `session.plan_changed`, `session.todos_changed` | `todos_changed` is signal-only; re-fetch after. |
| **History / messages** | Supported | `session.getMessages`; `session.eventLog.read/tail/registerInterest`; live `session.event` | `getMessages` = stored events only; ephemeral (streaming/prompt/usage) is live-only. |
| **Usage / token / cost** | Supported | `assistant.usage`, `session.usage_info`, `session.usage_checkpoint`; `session.usage.getMetrics` | Per-call events ephemeral → late attach misses history; `getMetrics` gives aggregates. |
| **Model-call failures** | Supported (live only) | `model.call_failure` | Ephemeral; no historical replay. |
| **Custom agents** | Supported | `agents.discover`; `session.agent.list/getCurrent/select/deselect/reload`; `session.custom_agents_updated` | Richest façade integration. |
| **Extensions / plugins** | **Partial** | `session.extensions.list/enable/disable/reload`; global `plugins.*` | Managed-server may lack an extension controller (see gap 7). |
| **Commands / slash commands** | Supported (raw) | `commands.list`; `session.commands.list/invoke/execute/enqueue`; `commands.changed`, `command.*` | — |
| **Memory** | **Not exposed** (observe only) | `session.memory_changed` only | No `memory` namespace in `SessionApi`; no fetch RPC (gap 4). |
| **Canvas** | **Partial** | `session.canvas.list/open/close/action.invoke`; `session.canvas.*` events | Stock attach can't act as an interactive renderer (rejects server→client requests). |
| **Background tasks** | Supported (raw) | `session.tasks.startAgent/list/getProgress/cancel/sendMessage`; `session.background_tasks_changed` | — |
| **Schedules** | **Partial** | `session.schedule.list/stop`; create via `session.commands.invoke` (`/every`,`/after`) | No first-class `schedule.create` RPC. |
| **Filesystem / shell adjuncts** | Supported (raw) | `session.workspaces.*`; `session.shell.exec/kill/...`; `shell.output/exit` | **Security-sensitive** — must gate before exposing to phone. |

### Cross-approach gain/lose
| Dimension | Pure `--acp --stdio` | **Option 1: native controller RPC** | Option 2: ACP↔local bridge | Option 3: ACP in TUI process |
|---|---|---|---|---|
| **TUI co-steer** | No (separate headless branch) | Managed-server is headless; attach to a `--ui-server` target for a real TUI | Same target options as O1 | Yes by design, but requires rebinding ACP to the TUI's session/manager |
| **Multi-session** | Native new/load/list | ~1 session/managed process; Happy multiplexes registry targets | Bridge maps ACP ids→target connections | TUI foreground+background once patched |
| **Protocol** | Open ACP | Proprietary Copilot JSON-RPC (version-skew is Happy's job) | ACP outside, proprietary inside (contained) | ACP outside; patch must keep TUI ownership |
| **Copilot delta** | None | None if Happy implements the client itself; small patch if reusing `LocalRpcSession` (private, narrow) | No hard patch; mostly bridge translation | Significant (ACP branch returns before interactive startup) |
| **Steering breadth** | Prompt/cancel/mode/model/config/slash + session-MCP-at-create | **Broadest** — full server/session dispatch incl. MCP mutation, skills, plans, tasks, extensions, shell | Native breadth behind bridge, but ACP can't represent all ops | Standard ACP unless vendor methods added |
| **Info to phone** | Normalized & lossy (drops usage, compaction, subagents, MCP status, agents, canvas, memory, schedules, sampling…) | **Broadest** — raw `session.event` carries everything live; `getMessages` for durable history | ACP projection loss unless bridge adds passthrough/vendor notifications | Same projection loss unless extended |
| **Interactive requests** | Permissions + MCP OAuth wired; user_input/elicit/exit-plan/auto-mode/limits/sampling dropped by mapper | All native round-trips via `observePromptEvents`; sampling/OAuth need explicit interest | Bridge must translate each prompt to ACP/vendor or lose it | Can reuse TUI prompt UX ("first response wins") but ACP still needs shapes |

**Verdict:** Option 1 maximizes both steering and observability and avoids the ACP
projection bottleneck. Principal costs: protocol instability (proprietary,
version-coupled), **local-token security** (registry creds protected only by
filesystem perms, and the authed RPC exposes powerful global-config/plugin/fs/
shell/permission APIs — `serverRegistry.ts:5-21,104-116`), and the need for Happy
to build a **safe phone-facing abstraction** rather than forwarding the native
API wholesale.

### Option 1 gaps to close (each a small local patch)
1. **Expose a supported controller client / typed raw invoker** — `NativeLocalRpcConnection.sendRequest` is private; either reimplement the framed protocol in happy-cli or export a typed proxy from `localRpcSession.ts:123-196`.
2. **Widen the façade if reusing `LocalRpcSession`** — add wrappers for commands/skills, plan/todos, tools, usage, tasks, schedules, canvas, MCP; implement `sendMessages` (`localRpcSession.ts:894-921`).
3. **Make prompt-forwarding negotiable** (not same-process-only): add a `connect`/`session.resume` capability, drop the owned-session heuristic, register sampling/OAuth/headers interests, add a `respondToSampling` override (`computeAttachPromptForwarding.ts:8-35`, `sdkServer.ts:3633-3681`).
4. **Add missing wire APIs**: memory list/get, first-class `schedule.create`, optional agent-tree snapshot (require Rust SDK contract additions).
5. **Canvas renderer** needs bidirectional client request handling + capability negotiation.
6. **Preserve `selection`/`github_reference` attachments** if needed (`toWireAttachments`).
7. **Extension parity in managed-server mode** isn't guaranteed — needs an extension controller/loader like `EmbeddedServer` if phone control of live extensions is required.

## 13. Option 1 implementation plan (happy-cli native local controller)

Chosen path (§11 decision): happy-cli attaches to a headless Copilot
managed-server target over Copilot's native local JSON-RPC and relays into Happy.
Both repos are now on the work account (`evmitran_microsoft/copilot-agent-runtime`,
`.../codexu`), so an implementing agent has the runtime source for exact schemas.

### Split of work
- **Mostly codexu/happy-cli (no runtime change):** discovery, attach, event
  relay, prompt steering, and the phone-facing abstraction.
- **Local Copilot worktree (per §4b, no upstream PR):** only the §12 gaps that
  need runtime changes (negotiable prompt-forwarding, missing wire APIs, exported
  typed client, extension parity).

### A. happy-cli side (codexu)
1. **Add an agent id + provider.** Extend `AgentId` in
   `packages/happy-cli/src/agent/core/AgentBackend.ts:51` with `'copilot'`
   (mirrors the existing `codex`/`codex-acp` precedent). Add a
   `commands/copilotCommand.ts` (mirror `commands/codexCommand.ts`) and register
   a factory in `agent/core/AgentRegistry.ts`.
2. **Spawn / discover the target.** Launch the runtime as a managed server
   (`copilot --server --port 0 --managed-server`), then read the local discovery
   registry for `kind="managed-server"` + `sessionId` + TCP port
   (runtime `src/cli/sessions/spawnLiveTarget.ts`,
   `src/core/remoteRegistry/serverRegistry.ts`). Handle the connection token that
   `spawnLiveTarget` sets (`COPILOT_CONNECTION_TOKEN`).
3. **Implement the native local-RPC client.** happy-cli speaks Copilot's framed
   JSON-RPC directly (the runtime's `NativeLocalRpcConnection.sendRequest` is
   private — §12 gap 1). Schemas come from the runtime's
   `src/core/generated/api.ts`, `apiInterfaces.ts`, `apiDispatch.ts`,
   `src/core/protocol/types.ts`. Connect handshake + `session.resume`.
4. **Attach with the right options.** Resume with `observePromptEvents:true` and
   call `session.eventLog.registerInterest` for `mcp.oauth_required` and
   `sampling.requested` (§12 rows for permissions/OAuth/sampling).
5. **Relay events → `SessionEnvelope`.** Subscribe to `session.event`; map the
   live Copilot `SessionEvent`s to happy-wire `SessionEvent` variants (reuse the
   shape logic from `src/codex/utils/sessionProtocolMapper.ts` as a template).
   Coalesce `assistant.message_delta` into one `text` envelope; map
   `tool.execution_start/complete` to `tool-call-start/end` with **real** name +
   `rawInput` (avoid the ACP `kind`-as-name loss from §6); map plan/todos, usage,
   subagents. Push via `ApiSessionClient.sendSessionProtocolMessage()`
   (`src/api/apiSession.ts`) — server/pagination unchanged.
6. **Steering from the phone.** Map Happy inbound actions to native RPC:
   `session.send` (prompt), `session.abort` (cancel), `session.mode.set`,
   `session.model.switchTo`/`setReasoningEffort`, `session.history.compact`
   (`/compact`), `session.commands.invoke` (skills/slash), `session.mcp.*`
   (add/status), `session.tasks.*` (subagents). Answer interactive prompts via
   `session.permissions.handlePendingPermissionRequest` /
   `session.ui.handlePending*`.
7. **Safe phone-facing abstraction (required).** Do NOT forward the raw native
   API to the phone — it includes global-config/plugin/filesystem/shell/
   permission APIs (§12 verdict). Expose an allow-listed action set; gate
   `session.shell.*` and `session.workspaces.*` behind explicit policy.
8. **Auth + metadata.** `authenticateCopilot` (GitHub device login) analogous to
   `commands/connect/authenticateCodex.ts`; extend
   `src/utils/createSessionMetadata.ts` + `src/api/types.ts` with a `copilot`
   flavor; add tool-view renderers under
   `happy-app/sources/components/tools/views/`.

### B. Local Copilot worktree (only if needed)
Address §12 gaps that are runtime-side, each minimal/additive, folded into
`all-pending-fixes`, no PR:
- **Negotiable prompt-forwarding** (drop the same-process-only heuristic in
  `src/cli/sessions/computeAttachPromptForwarding.ts`; add capability to
  `connect`/`session.resume`) — needed so an external controller can answer
  permission/elicitation prompts.
- **Export a typed controller client / raw invoker** from
  `src/core/sharedApi/localRpcSession.ts` (gap 1) if not reimplementing framing.
- **Missing wire APIs**: memory list/get, first-class `schedule.create`, optional
  agent-tree snapshot (gap 4) — require Rust SDK contract additions.
- **Extension parity** in managed-server mode (gap 7) if phone control of live
  extensions is required.
- Optionally the §9 **telemetry untag** worktree (separate task
  `copilot-acp-untag-telemetry`) — note: managed-server is `cli-server`, not
  `cli-acp`, so revisit which clientType it reports.

### C. Phased milestones
1. **Read-only mirror:** spawn managed-server, attach, relay events to Happy,
   verify tail-window + scroll pagination. No steering yet.
2. **Basic steering:** `session.send` + `session.abort` + permission answers.
3. **Rich control:** model/mode/reasoning, `/compact`, skills/commands, MCP
   add/status, tasks/subagents.
4. **Interactive completeness:** elicitation/user_input/sampling/OAuth
   round-trips (may pull in the prompt-forwarding worktree patch).
5. **Co-steer with a real TUI:** switch the target from managed-server (headless)
   to a `--ui-server` TUI target so a local terminal and the phone drive one live
   session (the "remoteSteerable, but local" goal).
6. **Hardening:** phone allow-list/policy, token handling, version-skew guard
   against the proprietary protocol.

### D. Key risks (carry from §12)
- Proprietary, **version-coupled** protocol — pin/verify against the runtime
  build; add a capability/handshake guard.
- **Local token security** — registry creds are filesystem-perms only; the RPC is
  powerful. Never expose raw to the phone.
- Ephemeral events (usage, `model.call_failure`, streaming) are live-only —
  attach early; use `session.getMessages` for durable history on late join.

## Common pitfalls
- Copilot's runtime source is at `D:\repos\copilot-agent-runtime`, not under
  `D:\harness-efforts` (the workspace there is an operator/knowledge workspace).
- Don't confuse the two remote paths: `--remote` (GitHub Mission Control, eager
  load) vs the Happy relay (windowed pagination). They are different clients.
- `ephemeral: true` Copilot events never hit `events.jsonl` — the jsonl tail
  fallback is lossy for those; ACP/`session.on("*")` is authoritative.
- Codex is a bespoke runner, not an `AgentBackend` impl; do not assume the Codex
  files are the generic extension seam. For Copilot, prefer the generic
  `runAcp`/`AcpSessionManager` runner (not just `AcpBackend`).
- ACP is **lossy by default**: only 9 of Copilot's **110** event variants get a
  non-null mapping (§6), and some of those 9 are then dropped Happy-side (the
  `update_todo` plan and `tool.execution_partial_result` have no Happy handler).
  Tool calls also arrive with the real name/args degraded.
- The most dangerous drops are the silent *interactive* ones (elicitation,
  user_input, sampling, other `*.requested`) — nothing errors, the prompt just
  never reaches the phone. `mcp.oauth_required` is a special case: the runtime
  resolves it host-side in ACP mode, so it's a remote-UX gap, not an unhandled
  event. Audit all of these before daily-driver use.
- Interactive signals cannot be recovered by tailing `events.jsonl` (read-only)
  **and cannot be added in `mapping.ts`** (it returns only `SessionUpdate`). They
  need `server.ts` request/response wiring like permissions — see §8.
- Do not assume JSONL↔ACP correlation by source `id`/`timestamp`: ACP strips
  source id/timestamp/parentId/messageId/agentId; only tool-call ids survive.
