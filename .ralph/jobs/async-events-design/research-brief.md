# Research Brief — async-events-design (D-002)

Compiled across 4 lenses: codebase **researcher** + **architect** (Claude Explore agents), **Codex xhigh**, **Copilot xhigh**.

---

## Researcher Findings

### 1. Just-shipped consumer / routing (the "wake side")

- `packages/happy-cli/src/codex/mcpNotificationConsumer.ts:1-185`
  - Factory: `createMcpNotificationConsumer<TMode>(opts)` → `{ handle(msg), dispose() }` `:87-185`
  - `handle()` ignores anything that is not `mcp_server_notification` or `mcp_sampling_request` `:165-177`
  - Drops `mcp_server_notification` when `routing.enabled === false` `:120-122`
  - Resolves route via `resolveRoute(routing, server, kind)`; `display-only` short-circuits `:134-138`
  - Prompt-queue path renders `text` via `renderNotificationTemplate(...)`, then debounces keyed by `${server}|${uri ?? kind}` `:140-151`, `:106-118`
  - Push target: `messageQueue.push(text, currentMode())` (the existing live-input `MessageQueue2`) `:96-104`
  - Sampling requests are logged once per server per session and dropped `:153-162`

- `packages/happy-cli/src/codex/mcpNotificationRouting.ts:1-291`
  - Allowed kinds: `progress, cancelled, resource_updated, resource_list_changed, tool_list_changed, prompt_list_changed, logging_message` `:25-42`
  - `RouteAction` = `display-only` | `prompt-queue { template, debounceMs? }` `:51-59`
  - Config shape: `McpNotificationRoutingConfig { enabled, perKind, perServer }` `:65-72`
  - Default `enabled: false` if settings field absent or non-object `:169-179`
  - Per-server override beats per-kind default `:203-211`
  - Default `resource_updated` action: prompt-queue with **250ms debounce** `:78-89`

- `packages/happy-cli/src/codex/runCodex.ts`
  - Settings load: `loadMcpNotificationRouting(settings?.mcpNotificationRouting)` near `:286-295`
  - Consumer constructed after `MessageQueue2` (`:258-305`)
  - Event-handler seam: `client.setEventHandler(msg => { mcpNotificationConsumer.handle(msg); ... })` at **`:745-755`** — this is THE integration point
  - `mcpNotificationConsumer.dispose()` on shutdown (`:648-653`)

### 2. Producer-side stdio MCP bridge

- `packages/happy-cli/src/codex/happyMcpStdioBridge.ts:1-105`
  - Minimal stdio MCP server; registers only `change_title` tool today (`:66-91`)
  - Forwards all calls to Happy's HTTP MCP server via `StreamableHTTPClientTransport` (`:47-58, :76-90`)
  - Uses `@modelcontextprotocol/sdk@1.25.3`
- `packages/happy-cli/bin/happy-mcp.mjs` is the runtime entrypoint codex spawns
- The bridge is **per-Codex-session** (Codex finding §"Technical Constraints"): session A's bridge CANNOT push a notification into session B's bridge. For B to wake, **B's own bridge must observe B's inbox file** and call `server.server.sendResourceUpdated({ uri })` from within B's process.
- High-level `McpServer` exposes `.server.sendResourceUpdated({ uri })` for arbitrary `resource_updated` emission.

### 3. Codex `multi_agents_v2` mailbox (disconfirming observation #1)

- Files: `codex/external/repos/codex-patched/codex-rs/core/src/tools/handlers/multi_agents_v2/{spawn,send_message,wait,close_agent}.rs` and `core/src/session/input_queue.rs`
- Shape: `session.input_queue.subscribe_mailbox().await → watch::Receiver<()>` — `wait.rs:63-80`
- Addressing is thread-id / agent-control based; two same-daemon sessions DO share `agent_control`
- **Critical correction from Codex research:** this mailbox is **in-memory only** (input_queue), NOT durable. Cannot be reused as the durable substrate. Disconfirming observation #1 is **partially refuted**: codex DOES already share an addressing primitive, but the mailbox is non-durable, so we still need a filesystem inbox for crash recovery + missed-wake replay.

### 4. Daemon control plane (Codex finding — undervalued by other lenses)

- `packages/happy-cli/src/daemon/controlServer.ts` — local HTTP control server already exposes `/session-started`, `/list`, `/spawn-session`, `/spawn-session-from-session`, `/stop-session`. **Natural site for a same-daemon `/agent-comms/send` route.**
- `packages/happy-cli/src/daemon/controlClient.ts` — existing local-HTTP client pattern + `X-Loopback-Capability` auth header (`daemonClient.ts:114-120`)
- `packages/happy-cli/src/daemon/run.ts` — tracks live + persisted sessions; the route can look up the target session id against tracked sessions.

### 5. Test infrastructure

- `packages/happy-cli/vitest.config.ts`; `package.json` `test = "pnpm run build && vitest run"`
- Existing related fixtures:
  - `packages/happy-cli/src/codex/mcpNotificationConsumer.test.ts`
  - `packages/happy-cli/src/codex/mcpNotificationRouting.test.ts`
  - `packages/happy-cli/src/codex/runCodex.mcpNotifications.test.ts` (closest pattern: injects events, asserts routing into a fake `MessageQueue2`)
- Focused-run: `pnpm --filter happy exec vitest run <file>`
- Full suite: `pnpm --filter happy test`
- AGENTS-mandated mock pattern: partial mock of `node:child_process` that preserves real exports and overrides only `execSync` (so `@slopus/happy-wire/node` `execFile` paths keep working).
- No existing two-session/cross-session inbox fixture today — the missed-wake fixture has to be greenfield.

### 6. agent-comms source material

- No `.ralph/jobs/agent-comms/` directory exists yet. The original scope definitions live only in the brainstorm + `.ralph-overview/data.json` task entry. Treat the v1 ref impl as the first concrete artifact for that task.

### 7. Naming conventions (`packages/happy-cli/src/codex/` style)

- camelCase TS module names, no deep subfolder explosion within a feature area
- Named exports preferred
- JSDoc file header explaining the module's responsibilities (see `mcpNotificationConsumer.ts:1-22` for the canonical shape)
- `@/` import alias for `src/`
- Tests colocated as `*.test.ts`

---

## Architect Analysis

### A. Producer hosting — **fold into `happyMcpStdioBridge.ts`** (option a)

Rejected (b) "separate child process": adds a second supervisor for start/stop/restart, duplicates the transport policy already enforced by `CodexAppServerClient` (`intentionalClose` gate at `codexAppServerClient.ts:1212-1276`, `terminateAttachedAppServer` invariants at `:699-740`, `:1027-1176`). Lifetime would skew on codex restart / sandbox-forcing / reattach.

The bridge already lives inside the codex client process and shares its lifecycle. Adding `fs.watch` + `sendResourceUpdated` to it is the smallest seam.

### B. Inbox substrate — **NEW TS module under `packages/happy-cli/src/agentComms/`** (option c, as refined by Codex)

The architect's initial (b) "reuse `multi_agents_v2` mailbox" was the early read but is **refuted** by the deeper Codex research: that mailbox is in-memory only. We need filesystem durability for the missed-wake recovery contract.

- (a) reuse crews mailbox — REJECTED: pollutes crews' `id/seq/reviewed` envelope invariants; agent-comms is a separate concern. Blast radius unacceptable.
- (b) reuse `multi_agents_v2` — REJECTED: non-durable; in-memory `watch::Receiver<()>` only. Cannot survive a daemon restart.
- (c) NEW `~/.happy/agent-comms/inboxes/<sessionId>/mailbox.json` (+ optional `history.jsonl`) — chosen. Borrows crews shape (atomic JSON write + append-only history sidecar) but does not depend on the crews plugin. Reuses `writeJsonAtomically` from `@slopus/happy-wire/node`.

### C. Consumer routing — **reuse `resource_updated` with a sentinel URI** (option a)

- (b) custom `wake_signal` kind: REJECTED. `mcpNotificationConsumer.ts:128-130` hard-drops unknown kinds, and there's no live routing reload. Would require both consumer change AND coordinated config schema bump.
- (c) new MCP method (long-poll): REJECTED, deferred to the northstar brainstorm (D-001).
- (a) chosen: emit `notifications/resources/updated` with URI `agent-comms://inbox/<sessionId>` (or `file://...mailbox.json`). Routing config can already target `kind=resource_updated` per-server, and the 250ms debounce default at `mcpNotificationRouting.ts:78-89` is appropriate for a "you have mail" stream.

### D. Missed-wake recovery — startup/reconnect hook in `runCodex.ts`

- The consumer is no-op when `routing.enabled === false` (`mcpNotificationConsumer.ts:120-122`), AND routing is loaded ONCE from settings (`runCodex.ts:286-295`) — there is no live reload. So "routing re-enabled mid-process" actually means restart. **Routing-toggle-mid-process is OUT OF SCOPE for v1**; recovery is at startup only.
- Best seam: `runCodex.ts` queue-init area (~line 290), after `MessageQueue2` exists, BEFORE the live event handler is bound. Read the session's inbox file; for each unconsumed entry, `messageQueue.push(syntheticPromptText)`. This catches up everything that landed while the session was down.

### E. Hard constraints (architect's framing)

- TS-only inside `packages/happy-cli/` (and possibly `packages/happy-server/` if cross-machine were in scope — it's not). **ZERO `codex/` submodule touches.**
- Between-turns delivery only.
- Same-daemon only (Scope B); cross-machine fan-out is OUT OF SCOPE (Scope A stays blocked on transport policy).

### F. Risks identified

1. **CWD-hash collision with codex transport discovery.** `CodexAppServerClient` keys WS discovery by `realpathSync(process.cwd())` and writes `codex-active-<cwdHash>.json` (`codexAppServerClient.ts:1040-1075`). If the agent-comms inbox uses the same cwdHash, we could conflate "the codex app-server for this cwd" with "the inbox for this session." Mitigation: key by **session id**, not cwd.
2. **Writer-flush vs reader-poll race.** Atomic write via `writeJsonAtomically` mitigates partial-write reads, but the reader must `fs.watch` for `change` AND tolerate a stat-then-read window where the writer's rename hasn't landed. Mitigation: on watch event, retry-read with backoff (e.g., 1 retry @ 50ms).
3. **Debounce coalescing high-frequency wakes.** `resource_updated` defaults to 250ms debounce, keyed by `${server}|${uri}`. A bursty stream of N messages within 250ms produces ONE wake push to `MessageQueue2`. That's fine for the wake-signal pattern (mailbox re-read picks up all N) — but the synthesized prompt template must NOT pretend to know the message count; it must say "you have mail, re-read the inbox."
4. **Locked inbox during recovery.** If a writer holds the inbox file open during startup recovery, the read must be retry-tolerant (3 retries with backoff). Atomic-write semantics mean the lock window is microsecond-scale, so 1 retry suffices in practice; document the policy in the mailbox module.
5. **Sentinel URI confusion.** Unknown URIs flow through `display-only` by default. A sentinel like `agent-comms://inbox/<sessionId>` needs to be explicitly routed to `prompt-queue` either via per-server config OR by leaving `resource_updated` on its existing prompt-queue default. Document the required `settings.mcpNotificationRouting.perServer["happy-agent-comms"]` shape.
6. **(Added by planner)** **Bridge-per-session means writer doesn't get its own wake.** Session A writes to B's inbox. A's bridge only watches A's inbox; B's bridge watches B's inbox. So A never wakes itself from its own send — which is the correct semantics for Scope B but is worth pinning in a test.

---

## Codex Research (xhigh)

- **`packages/happy-cli/src/utils/MessageQueue2.ts`** — `push()` wakes idle waiter; `waitForMessagesAndGetAsString()` drains on next turn boundary. This is the existing seam the consumer already pushes into; the recovery hook re-uses it.
- **`packages/happy-cli/src/persistence.ts`** — settings already include `mcpNotificationRouting?: unknown`. Add nothing new at the settings root; the agent-comms config lives under the existing `mcpNotificationRouting.perServer` map (or as a separate `settings.agentComms` if richer per-target config is needed; v1 doesn't need it).
- **`ai-developer-toolkit/plugins/crews/hooks/mailbox.js`** — durable mailbox/outbox/cursor/history pattern: atomic writes, lock discipline, JSON mailbox, JSONL history. This is the SHAPE to borrow (not the implementation; the plugin is CJS and lives in another submodule). Pin a doc cite, copy the algorithm.
- **`ai-developer-toolkit/plugins/crews/docs/protocol.md`** — crews envelope and review/cursor protocol. Relevant cite for the "Durable mailbox + channel wake" pattern doc (codex-as-crews-engine answer).
- **`codex/external/repos/codex-patched/codex-rs/core/src/session/input_queue.rs`** — confirms codex `multi_agents_v2` mailbox is in-memory `watch::Receiver<()>`, NOT durable. Locks the rejection of disconfirming observation #1.
- **`packages/happy-server/sources/app/api/routes/v3SessionRoutes.ts`** + `sources/app/events/eventRouter.ts` — server-side durable encrypted chat-message stream + Socket.IO fan-out. **Not** the right substrate (would conflict with filesystem-mailbox brief), but the existing replay buffer is a useful conceptual contrast for the doc.
- **`plans/async-events-design.md`** — older broader draft (commit 35bc26f6). Will be **superseded**, not extended, by the new narrower pattern doc.
- **`.ralph-overview/data.json`** — task state for `agent-comms`, `async-events-design`, `async-events-northstar-architecture`, `codex-app-server-idle-timeout`. Reference cite for the follow-up assessment.

### Codex implementation suggestions (mostly absorbed into stories below)

- New module: `packages/happy-cli/src/agentComms/mailbox.ts` exposing `appendMessage`, `readPending(sinceSeq)`, `markConsumed(uptoSeq)`. Store at `<happyHomeDir>/agent-comms/inboxes/<sessionId>/mailbox.json` + `history.jsonl`. Use `writeJsonAtomically` from `@slopus/happy-wire/node`.
- New local daemon route: `controlServer.ts` adds `POST /agent-comms/send` — validates sender+target session ids against tracked sessions, writes target inbox file, returns `{id, seq}`.
- Producer wake: extend `happyMcpStdioBridge.ts` (or sibling) to (a) know current session id from env, (b) register `agent-comms://inbox/<sessionId>` resource, (c) `fs.watch` the inbox file, (d) on change call `server.server.sendResourceUpdated({ uri })`.
- Recovery: `runCodex.ts` near queue init — scan current session inbox; for each unread entry, push a synthetic "[agent-comms] you have N message(s) from <peer>" prompt.

---

## Copilot Research (xhigh)

Lean output but useful confirmations of the same surfaces (`mcpNotificationConsumer.ts`, `mcpNotificationRouting.ts`, `runCodex.ts` `:286-305` / `:745-754`, `happyMcpStdioBridge.ts`, `MessageQueue2.ts`, `persistence.ts`). Re-confirms the constraint set and naming conventions. No novel findings beyond what Researcher + Codex covered.

Copilot specifically called out:
- **Avoid fake URIs if using `resource_updated`; prefer a real `file://` URI for the inbox file.** This is a useful refinement of Architect's recommendation (a). The producer can register the inbox as `file:///<absolute-path-to-mailbox.json>` so consumer config sees a real resource. The sentinel-URI variant (`agent-comms://inbox/<sessionId>`) is a fallback if MCP-spec strictness matters.

---

## Consolidated File List

### Files to MODIFY

| Path | What |
|---|---|
| `packages/happy-cli/src/codex/happyMcpStdioBridge.ts` | Add agent-comms inbox watcher + `sendResourceUpdated` emission (Story producer-emit) |
| `packages/happy-cli/src/codex/runCodex.ts` | Wire startup catch-up after `MessageQueue2` init, near `:286-305`; potentially pass session id to bridge env (Story recovery-hook) |
| `packages/happy-cli/src/daemon/controlServer.ts` | New `POST /agent-comms/send` route (Story daemon-route) |
| `packages/happy-cli/src/daemon/controlClient.ts` | Optional helper `sendAgentMessage(target, body)` (Story daemon-route) |

### Files to CREATE

| Path | What |
|---|---|
| `packages/happy-cli/src/agentComms/mailbox.ts` | Durable filesystem inbox module (Story mailbox-core) |
| `packages/happy-cli/src/agentComms/mailbox.test.ts` | Unit tests for mailbox module (Story mailbox-core) |
| `packages/happy-cli/src/agentComms/scopeB.integration.test.ts` | Happy-path + missed-wake recovery fixtures (Stories fixture-happy-path, fixture-missed-wake) |
| `plans/durable-mailbox-channel-wake.md` | Pattern doc — supersedes `plans/async-events-design.md` (Story pattern-doc) |

### Files to READ (reference only, NEVER edit)

| Path | Why |
|---|---|
| `packages/happy-cli/src/codex/mcpNotificationConsumer.ts` | Confirm consumer contract; debounce key; routing-disabled short-circuit |
| `packages/happy-cli/src/codex/mcpNotificationRouting.ts` | Confirm allowed kinds + default actions |
| `packages/happy-cli/src/utils/MessageQueue2.ts` | Push semantics (already used by consumer) |
| `packages/happy-cli/src/persistence.ts` | `settings.mcpNotificationRouting?: unknown` shape; no new settings field needed in v1 |
| `ai-developer-toolkit/plugins/crews/hooks/mailbox.js` | Shape to borrow for atomic write + history sidecar |
| `ai-developer-toolkit/plugins/crews/docs/protocol.md` | Cite for the pattern doc (codex-as-crews-engine answer) |
| `codex/external/repos/codex-patched/codex-rs/core/src/session/input_queue.rs` | Cite for "in-memory, non-durable" → why we can't reuse |
| `packages/happy-cli/src/codex/codexAppServerClient.ts:699-740, 1027-1176, 1212-1276` | Transport invariants — make sure the producer's `fs.watch` lifetime respects `intentionalClose` |

### Files explicitly OUT OF SCOPE for edit

- Anything under `codex/` — hard rule
- `packages/happy-cli/src/codex/mcpNotificationConsumer.ts` — consumer stays unchanged (proves the wake-pattern works with the already-shipped surface)
- `packages/happy-cli/src/codex/mcpNotificationRouting.ts` — same
- `packages/happy-server/**` — Scope A is out of scope; v1 stays in happy-cli + ~/.happy filesystem
- `packages/happy-app/**` — no app changes
