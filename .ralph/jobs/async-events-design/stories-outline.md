# Stories Outline: Durable Mailbox + Channel Wake (D-002)

*Preliminary decomposition from `/plan-with-ralph --from-brainstorm`. Feed to `/implement-with-ralph --from-plan D:/harness-efforts/codexu/.ralph/jobs/async-events-design/plan.md` for PRD generation.*

> Brainstorm seed: `D:/harness-efforts/codexu/.ralph/brainstorms/async-events-design/selected-direction.md` (direction D-002).
> Northstar (D-001 long-poll, D-003 producer hub, D-004 pilot, agent-comms Scope A, codex-as-crews-engine wire protocol details) is OUT OF SCOPE; tracked separately as `async-events-northstar-architecture`.

## US-001: Pattern doc — Durable mailbox + channel wake

**Description:** As a Happy maintainer, I want a single architectural pattern document under `plans/` that names "Durable mailbox + channel wake" as the canonical pattern, so that future async-events, agent-comms, and codex-as-crews-engine design questions have one referenceable answer.

**Acceptance Criteria:**
- [ ] `plans/durable-mailbox-channel-wake.md` exists at the repo root.
- [ ] Document names "Durable mailbox + channel wake" as the canonical pattern.
- [ ] Document lists the three questions it resolves: in-session async events for the U1/U2/U4 subset, `agent-comms` Scopes B + C, and codex-as-crews-engine.
- [ ] Document contains an explicit rejection note for "channels-native crews storage" with full rationale: loss of cursor / audit / crash-recovery / cross-machine fan-out.
- [ ] Document includes the `codex-app-server-idle-timeout` interaction note (long-running producer-side MCP servers want app-server to outlive foreground clients) as an INPUT to that task, not a resolution.
- [ ] Document covers a worked example for agent-comms Scope B (referencing the reference implementation landed in US-002–US-006) plus the codex-as-crews-engine answer (channels = wake, file mailbox = source of truth).
- [ ] Document spells out the required `settings.mcpNotificationRouting.perServer.happy.resource_updated` override that turns the default `[mcp:happy] resource updated: {uri}` prompt into the agent-comms wake prompt.
- [ ] Markdown is linted-clean (no trailing whitespace beyond what the surrounding `plans/` files use; no broken intra-doc links).
- [ ] Document supersedes the older `plans/async-events-design.md` (commit `35bc26f6`); explicit "Supersedes" line at the top.

**Dependencies:** None
**Estimated complexity:** small

## US-002: Mailbox core module + unit tests

**Description:** As a Happy CLI process, I want a durable filesystem inbox primitive (atomic JSON write + append-only history sidecar) keyed by Happy session id, so that cross-session messages survive process restarts, daemon restarts, and partial writes.

**Acceptance Criteria:**
- [ ] `packages/happy-cli/src/agentComms/mailbox.ts` exports the API surface: `MailboxEntry`, `MailboxState`, `inboxPathFor(sessionId)`, `inboxDirFor(sessionId)`, `ensureInbox(sessionId)`, `appendMessage(sessionId, body, sender)`, `readPending(sessionId, sinceSeq?)`, `markConsumed(sessionId, uptoSeq)`.
- [ ] Mailbox file is `<happyHomeDir>/agent-comms/inboxes/<sessionId>/mailbox.json`; history sidecar is `<happyHomeDir>/agent-comms/inboxes/<sessionId>/history.jsonl`.
- [ ] All writes use `writeJsonAtomically` from `@slopus/happy-wire/node` (no hand-rolled temp-file rename).
- [ ] `ensureInbox(sessionId)` is idempotent: creates the per-session inbox dir + an empty `mailbox.json` if missing; returns without error if the inbox already exists; never overwrites a non-empty mailbox.
- [ ] `readPending` is retry-tolerant: retries up to 3× with backoff on `EBUSY`/`ENOENT` (the writer-flush vs reader-poll race documented in plan §"Risk Areas"). Document the policy in the module's JSDoc header.
- [ ] Module JSDoc header explains: durable substrate, why it doesn't reuse crews mailbox or `multi_agents_v2`, the cursor + seq contract, and the consumption-must-be-post-drain invariant.
- [ ] `packages/happy-cli/src/agentComms/mailbox.test.ts` passes via `pnpm --filter happy exec vitest run src/agentComms/mailbox.test.ts`, covering:
  - append → read-pending → mark-consumed happy path
  - mark-consumed advances the cursor; subsequent read-pending returns nothing
  - retry-on-locked-read (simulated `EBUSY` on first read; backoff + retry succeeds)
  - atomic-write proof: leftover `.tmp` from a prior crash does not corrupt the next read (see soft-cap F-011 in plan Open Questions if simplifying this)
  - session-id path safety: invalid ids (`../etc`, slashes, backslashes, oversized) cause `inboxPathFor` to throw a typed error (see soft-cap F-010 in plan Open Questions)

**Dependencies:** None
**Estimated complexity:** medium

## US-003: Bridge send tool + producer wake emission in stdio bridge

**Description:** As a Codex session A, I want an `agent_comms.send` MCP tool exposed on Happy's stdio bridge so that I can post a message to another session B on the same daemon; and as session B's bridge, I want to watch B's inbox file and emit a `resource_updated` wake notification so that B's existing `mcpNotificationConsumer` routes a wake prompt into B's `MessageQueue2`.

**Acceptance Criteria:**
- [ ] `packages/happy-cli/src/codex/happyMcpStdioBridge.ts` reads the current Happy session id from the existing env passed at bridge spawn time.
- [ ] Bridge calls `mailbox.ensureInbox(currentSessionId)` BEFORE any `fs.watch` registration; on first session startup the inbox dir + empty `mailbox.json` exist before the watcher arms.
- [ ] Bridge registers an `agent_comms.send` MCP tool that delegates to `controlClient.sendAgentMessage(targetSessionId, body, currentSessionId)` (US-004). The tool returns `{ id, seq }` from the daemon route.
- [ ] Bridge registers an `agent-comms` MCP resource at URI computed via `pathToFileURL(mailboxPath).href` (NOT a hand-built `file:///D:\...` string — Windows-safe per soft-cap F-012).
- [ ] Bridge exposes a resource-read callback for that URI that returns pending mailbox entries and, only after the response is sent, calls `mailbox.markConsumed(currentSessionId, lastEntrySeq)` so consumption is strictly post-drain (per F-001).
- [ ] Bridge `fs.watch`es the inbox DIRECTORY (not the file directly — per F-003), filters events to `mailbox.json` `change`/`rename`, and calls `server.server.sendResourceUpdated({ uri })` on matching events with a ≥ 50ms internal debounce to coalesce rapid writes into one wake.
- [ ] The watcher is `dispose()`d on bridge shutdown via the existing bridge teardown hook (no leaked file descriptors).
- [ ] The wake path NEVER calls `mailbox.markConsumed(...)`; only the resource-read callback consumes (pinned in code + JSDoc).
- [ ] Bridge spawn semantics: existing `change_title` tool keeps working; no regression to non-agent-comms event handling.
- [ ] Manual smoke test documented in commit: spawn the bridge against a real (or mock-codex) parent, write a single entry to the inbox, observe one `sendResourceUpdated` call land + the resource-read callback return the entry.

**Dependencies:** US-002
**Estimated complexity:** medium

## US-004: Daemon route + control-client helper

**Description:** As a sender session A, I want my local Happy daemon to expose `POST /agent-comms/send` so that cross-session writes are serialized through one process (the daemon) and avoid two-writer races on the target inbox file; and as the bridge MCP tool from US-003, I want a typed `controlClient.sendAgentMessage()` helper that posts to that route.

**Acceptance Criteria:**
- [ ] `packages/happy-cli/src/daemon/controlServer.ts` exposes `POST /agent-comms/send` on the existing `127.0.0.1`-bound daemon control port (NO new `X-Loopback-Capability` auth gate; the port's existing loopback-binding is the auth gate per F-002).
- [ ] Request body schema: `{ targetSessionId: string, body: unknown, sender: { sessionId: string } }`. Use the existing daemon-side Zod / typed body validator pattern.
- [ ] Route validates BOTH sender and target against tracked sessions (`daemon/run.ts`-tracked state); returns 404 with a clear error message if either id is unknown.
- [ ] Route calls `mailbox.appendMessage(targetSessionId, body, sender)` from US-002 and returns `{ id, seq }` on success.
- [ ] Route is rate-limit-free in v1; documented as "single-daemon hop, no rate limiting in v1" in the route's JSDoc.
- [ ] `packages/happy-cli/src/daemon/controlClient.ts` exposes `sendAgentMessage(targetSessionId, body, senderSessionId)` using the existing `daemonPost` helper.
- [ ] Helper returns the daemon's `{ id, seq }` on success; throws on non-2xx with a typed error.
- [ ] Existing daemon-control endpoints (`/session-started`, `/list`, `/spawn-session`, `/spawn-session-from-session`, `/stop-session`) keep working — no regression.
- [ ] Route covered by either a per-route test or by the integration fixture in US-006; if neither covers a specific edge (e.g., missing target session id → 404), add a small focused test.

**Dependencies:** US-002
**Estimated complexity:** medium

## US-005: Startup catch-up helper + runCodex wiring

**Description:** As a Happy CLI session that just started or reconnected, I want the recovery path to read its inbox on startup and push exactly one wake prompt if pending messages exist — without replaying lost notifications — so that the "missed wakes are harmless because the mailbox is the source of truth" invariant is durable across process restarts.

**Acceptance Criteria:**
- [ ] `packages/happy-cli/src/agentComms/recovery.ts` exists and exports: `AGENT_COMMS_WAKE_PROMPT` constant string AND `recoverPendingAgentCommsMessages<TMode>(sessionId, queue, currentMode): Promise<{ wakeEnqueued: boolean }>` (signature compatible with `MessageQueue2.push(text, mode)`).
- [ ] Helper reads `mailbox.readPending(sessionId)`; if any entries exist, pushes EXACTLY ONE wake prompt onto `queue` (not per-message); returns `{ wakeEnqueued: true }`. If no pending entries, returns `{ wakeEnqueued: false }` without pushing.
- [ ] Helper NEVER calls `mailbox.markConsumed(...)`; consumption is strictly the resource-read callback path from US-003 (per F-001). Pinned in code + JSDoc.
- [ ] Helper returns NO message bodies; the wake prompt is the literal `AGENT_COMMS_WAKE_PROMPT` (e.g. `[agent-comms] you have pending message(s); read the agent-comms MCP resource to drain`).
- [ ] `packages/happy-cli/src/agentComms/recovery.test.ts` passes via `pnpm --filter happy exec vitest run src/agentComms/recovery.test.ts`, covering:
  - empty inbox → no push, `wakeEnqueued: false`
  - 1 pending entry → exactly one push, `wakeEnqueued: true`
  - 3 pending entries → still exactly one push (proves "wake once per recovery, not per-entry")
  - cursor unchanged after recovery (proves no-markConsumed invariant)
- [ ] `packages/happy-cli/src/codex/runCodex.ts` calls `recoverPendingAgentCommsMessages(currentSessionId, messageQueue, currentMode)` AFTER `MessageQueue2` construction and BEFORE the codex client event handler is bound (i.e., before `client.setEventHandler(...)` at `:745-755`).
- [ ] `runCodex.ts` does NOT duplicate any mailbox scan, cursor, or prompt logic inline — it only calls the helper.
- [ ] No code changes to `packages/happy-cli/src/codex/mcpNotificationConsumer.ts` or `packages/happy-cli/src/codex/mcpNotificationRouting.ts` (verifier: `git diff --name-only origin/main...HEAD -- packages/happy-cli/src/codex/mcpNotification*` MUST be empty).

**Dependencies:** US-002
**Estimated complexity:** small

## US-006: Scope B happy-path + missed-wake integration fixtures

**Description:** As a reviewer of this work, I want two vitest fixtures that exercise the full durable-mailbox-plus-channel-wake contract end-to-end — happy-path round-trip AND missed-wake recovery — so that the pattern's load-bearing invariants ("source of truth on disk", "missed wakes harmless because mailbox re-read") have proof, not just prose.

**Acceptance Criteria:**
- [ ] `packages/happy-cli/src/agentComms/scopeB.test.ts` exists (NOT `*.integration.test.ts` — see F-007 / soft-cap; the file is picked up by the default `*.test.ts` glob in `packages/happy-cli/vitest.config.ts`).
- [ ] Test file passes via `pnpm --filter happy exec vitest run src/agentComms/scopeB.test.ts` (note package-relative path per F-008).
- [ ] **Happy-path fixture:** simulate two sessions A + B on one daemon.
  - A calls the `agent_comms.send` MCP tool exposed by A's stdio bridge → delegates to `sendAgentMessage` targeting B → daemon writes B's inbox via `mailbox.appendMessage`.
  - B's bridge `fs.watch` fires; B's `mcpNotificationConsumer` (real instance, real `MessageQueue2`, real `mcpNotificationRouting.perServer.happy.resource_updated` override) receives a synthesized `resource_updated` event with URI = `pathToFileURL(B's mailbox).href`.
  - B reads the `agent-comms` MCP resource on the next turn boundary; the resource-read callback returns the message body and only THEN calls `markConsumed`.
  - **Asserts:** message body matches the resource-read payload, B's queue received exactly ONE wake push with the `AGENT_COMMS_WAKE_PROMPT` template (NOT the default `[mcp:happy] resource updated: {uri}` string and NOT per-message), A's queue received NOTHING (no self-wake), `mailbox.json` cursor advances by the message's seq ONLY after the resource-read callback returns.
- [ ] **Missed-wake recovery fixture:** prove the pattern's load-bearing invariant.
  - B's bridge is set up but `mcpNotificationConsumer` is disabled (`routing.enabled === false`) so no wake event fires.
  - A sends a message via the daemon hop; B's mailbox file is updated; NO `resource_updated` ever flows into B's process.
  - B is "shut down" (consumer disposed; simulated process exit) and "restarted" (new consumer + new `MessageQueue2`; routing.enabled now true).
  - Fixture invokes `recoverPendingAgentCommsMessages(...)` DIRECTLY (does not boot `runCodex.ts`, does not duplicate recovery logic) per F-006.
  - **Asserts:** the helper detects pending mail, pushes ONE wake prompt onto B's new queue, does NOT mark the message consumed; then an explicit `agent-comms` MCP resource read returns the message body and advances the cursor — all WITHOUT any `resource_updated` event being injected.
  - Pin the invariant in the test's assertion message: `"no notification replay occurred; mailbox drain, not wake enqueue, consumed the message."`
- [ ] Fixture file header explains the two contracts pinned by the file: happy-path "you have mail" wake + missed-wake recovery via inbox re-read.
- [ ] Fixture uses real `writeJsonAtomically` writes (no mocks-as-main-proof); the only mocking allowed is the `node:child_process` partial mock pattern documented in `packages/happy-cli/AGENTS.md` if absolutely needed for daemon boot.
- [ ] Typecheck passes for the new test file: `pnpm --filter happy run build`.

**Dependencies:** US-003, US-004, US-005
**Estimated complexity:** medium
