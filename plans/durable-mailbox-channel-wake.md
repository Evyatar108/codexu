# Durable mailbox + channel wake

*Architectural pattern doc — 2026-06-07. Output of Ralph job `async-events-design`, US-001. The reference implementation lives under `packages/happy-cli/src/agentComms/` (US-002..US-006); this doc IS the canonical answer.*

> **Supersedes:** [`plans/async-events-design.md`](./async-events-design.md) (commit `35bc26f6`, 2026-05-13). The earlier doc explored a long-poll-first design (A0 producer hub + later A1 push bridge) before the Stage A `EventMsg::McpServerNotification` + Option B consumer landed. It is preserved as historical context; the binding answer is here.

---

## TL;DR

**The durable filesystem mailbox is the source of truth; the just-shipped MCP-notification channel is the wake signal.** Missed wakes are harmless because the consumer re-reads the inbox on startup. The two layers are deliberately separate: messages persist on disk, wakes are best-effort hints that say "go check the mailbox." This pattern resolves three previously-tangled design questions (in-session async events, agent-comms Scopes B+C, and a hypothetical codex-engine port of the crews plugin) with a single answer, and pins four binding forward-compatibility rules so the v1 wire shape survives v2/v3 transport swaps.

The reference implementation is TypeScript-only inside `packages/happy-cli/` (zero `codex/` submodule edits) and ships agent-comms Scope B (same-daemon, cross-session messaging) end-to-end. Cross-machine fan-out (Scope A) and per-subscription routing remain explicitly deferred.

---

## 1 · Three questions this pattern resolves

This single pattern is the canonical answer to three design questions that had previously been chased in parallel:

1. **In-session async events for the U1/U2/U4 passive-notification subset.** The earlier `plans/async-events-design.md` (commit `35bc26f6`) defined U1 (git ref moves), U2 (periodic timer), U3a/U3b (inter-agent — explicit wait / passive notification), and U4 (filesystem watch). The passive-notification subset of U1/U2/U4 — "wake the agent between turns when an external event lands, without the agent having to poll" — collapses onto exactly this pattern: a producer writes to the consumer's durable inbox, then emits a `resource_updated` wake on the consumer's MCP bridge. Active long-poll (`async_events_wait`) and a generic producer hub remain northstar concerns, not this doc.
2. **agent-comms Scopes B + C.** Scope B is same-daemon cross-session messaging (session A sends to session B's inbox via the local daemon control hop). Scope C is same-machine cross-daemon messaging (still filesystem-mediated; only the wake-hop topology differs because the producer and consumer no longer share a daemon). Both reduce to "write to `<happyHomeDir>/agent-comms/inboxes/<sessionId>/mailbox.json` durably; emit a wake URI keyed by `sessionId`." Scope A (cross-machine fan-out) is **out of scope** for this pattern — it needs a transport-policy decision, not a storage decision.
3. **codex-as-crews-engine.** For a hypothetical codex-engine port of the `crews` plugin (where today's Claude-Code-specific crews coordination would have to work under codex), the same split applies: **channels are the wake hint, the filesystem mailbox is the source of truth.** Channels-native crews storage is rejected (see §3 below for the full rationale). The crews mailbox already uses a filesystem layout with cursor + history sidecar; that shape is what the codex-engine port should adopt directly, with channels (or whatever the codex-side equivalent ends up being) used purely to nudge the consumer to re-scan.

---

## 2 · The pattern

**Two layers, deliberately separate:**

| Layer | Role | Substrate | Failure mode |
|---|---|---|---|
| **Durable mailbox** | Source of truth for messages | `<happyHomeDir>/agent-comms/inboxes/<sessionId>/mailbox.json` (current pending + cursor) plus `history.jsonl` (append-only audit) | A lost mailbox file = a lost message. Atomic writes (`writeJsonAtomically`) + sidecar history protect against this. |
| **Channel wake** | Best-effort wake hint | MCP `resource_updated` notification with URI `agent-comms://inbox/<sessionId>`, emitted by the consumer's own per-session stdio bridge after `fs.watch` fires on the inbox dir | A lost wake = a missed turn-boundary nudge. Recovery: the consumer re-reads its inbox on every startup; pending mail enqueues exactly one wake prompt regardless of how many entries are pending. |

**The load-bearing invariants:**

- **Consume only AFTER drain.** The resource-read callback returns the pending entries first and ONLY THEN advances the cursor via `markConsumed(uptoSeq)`. Crashing between "return entries" and "advance cursor" is safe: the next read sees the same entries again, the consumer re-processes idempotently, and the cursor catches up. This is what makes wake-loss harmless.
- **Wake is never consumption.** The `fs.watch`-triggered `sendResourceUpdated` emission MUST NOT call `markConsumed`. The wake only says "go check the mailbox." Consumption is exclusively the consumer-driven resource-read path.
- **Recovery enqueues exactly one wake prompt per startup.** A consumer with N pending entries on disk at startup enqueues ONE wake (not N), because the wake is a hint to drain, not a per-entry notification. Per-entry delivery happens through the resource-read response payload, not through the queue.
- **Producer cannot reach into consumer's bridge.** Bridges are per-session; session A's bridge cannot push notifications into session B's bridge. The cross-session hop goes through the filesystem inbox: A's bridge writes, B's own bridge watches, B's own consumer fires.

---

## 3 · Rejected alternative: channels-native crews storage

For the codex-as-crews-engine question (§1.3), one tempting shortcut is to put crews coordination (mailboxes, member registries, thread state) directly into a channels-style substrate — that is, broadcast every coordination event over the wake channel and reconstruct state by replaying the channel. This is **rejected**, for four reasons:

1. **Loss of cursor.** A channels-style substrate is a fire-and-forget pub-sub. There is no persisted cursor that says "consumer C has processed up to seq N." If consumer C is offline when seq N+1 fires, seq N+1 is gone — there is no canonical "still pending for C" view. The filesystem mailbox keeps an explicit cursor (`mailbox.json`) so a restarted consumer knows exactly what it has and has not seen.
2. **Loss of audit.** A channels-style substrate has no append-only history. Once a notification fires, there is no record of it for operator inspection, debugging, or replay. The filesystem mailbox keeps `history.jsonl` as an append-only sidecar: every entry ever appended is preserved for `cat`-style inspection, post-mortem, and incident response.
3. **Loss of crash-recovery.** A channels-style substrate stores nothing durably. A daemon restart loses every in-flight message. The codex `multi_agents_v2` mailbox was specifically evaluated as a candidate substrate for crews coordination (its `core/src/session/input_queue.rs` uses an in-memory `watch::Receiver<()>` plus a `VecDeque<InterAgentCommunication>`) and rejected: it cannot survive a daemon restart. The filesystem mailbox survives daemon restart, OS reboot, and partial-write crashes (via atomic-write rename).
4. **Loss of cross-machine fan-out.** A channels-style substrate is local to one process — there is no path to a v2/v3 cross-machine relay that fans the same envelope out across multiple consumer machines. The filesystem mailbox's logical-`sessionId` addressing (§4 rule 2) and stable wake-URI scheme (§4 rule 3) keep the wire shape transport-agnostic, so a future relay can replicate inboxes across machines without changing the consumer-side contract.

The filesystem mailbox is the durable substrate; channels (or any wake-only signal) are the hint. Crews-on-codex must adopt the same two-layer split.

---

## 4 · Four binding forward-compatibility design rules (the Northstar rules)

These rules come from the `async-events-northstar-architecture` brainstorm (commit `950b795b`, selected direction N-001 evolutionary layering). They are binding on this v1 implementation; they exist so v2 (per-subscription routing, signature/encryption) and v3 (mid-turn preemption, cross-machine relay) can land without breaking the v1 wire shape.

1. **Versioned envelope (`version: 1`).** Every mailbox entry and every wake/notification payload carries a top-level `version: 1` field. Mailbox readers MUST reject entries whose `version` is greater than the consumer's known maximum (currently `1`) with a typed error — so a v2 producer talking to a v1 consumer fails loud rather than silently mis-parsing. Future schema evolution (signed envelopes, per-subscription routing fields, encrypted bodies) bumps the `version` and keeps the v1 reader correct.
2. **Logical addressing by `sessionId` only.** The envelope identifies destination by `sessionId` (a logical, opaque handle), NOT by physical inbox file path. Filesystem-path-derived routing is an implementation detail of the v1 transport; the wire schema treats the address as opaque. v2/v3 transports (app-server RPC, cross-machine relay) MUST be able to route the same envelope shape without filesystem semantics leaking into the wire.
3. **Stable wake-URI scheme `agent-comms://inbox/<sessionId>`.** The `sendResourceUpdated({ uri })` URI follows the stable custom-scheme shape `agent-comms://inbox/<sessionId>` — NOT `file:///<absolute-path>` of the mailbox file. Even though the underlying v1 transport reads from a filesystem mailbox, the URI the consumer sees is stable when v2/v3 swaps the transport. (`pathToFileURL` is still the correct helper for any internal diagnostic or log line that references the real file path — but the wake URI is a custom-scheme URI, not a file URI.)
4. **Per-subscription routing is reserved-but-not-implemented (v2).** v1 ships global-per-server-per-kind routing — exactly what `codex-channels-option-b` already established under `settings.mcpNotificationRouting.perServer.<server>.<kind>`. Per-subscription filters and per-subscription handlers (e.g., "wake only when the body matches predicate P") are a v2 concern. The v1 routing-config schema reserves the namespace for future per-subscription extension but does NOT implement it. Consumers MUST treat unknown future routing fields as forward-compat reservations and not error on them.
5. **Between-turns delivery is the v1 contract.** v1 wake delivery happens at the next turn boundary — the consumer enqueues the wake prompt onto its `MessageQueue2`, and the prompt is processed when the current Codex/Copilot turn finishes. Mid-turn preemption (interrupting an in-flight LLM stream to deliver a wake) requires codex-core Rust changes and is explicitly a v3 concern. Consumers that need finer-grained latency than "next turn boundary" are out of scope for v1 and should NOT be designed around.

(Five bullets, four constraints: rules 4 and 5 together form the single "deferred semantics" constraint the brainstorm originally named as one; they are split here for clarity because consumers need to reason about them independently.)

---

## 5 · Settings: the `mcpNotificationRouting` override

The v1 wake-prompt template is wired by a single per-server, per-kind override in user settings. Without this override, the default `mcpNotificationConsumer` would emit the generic `[mcp:happy] resource updated: {uri}` prompt, which (a) leaks the internal URI to the agent prose and (b) does not name the agent-comms drain action. The override replaces that template with the canonical agent-comms wake prompt:

```json
{
  "mcpNotificationRouting": {
    "enabled": true,
    "perServer": {
      "happy": {
        "resource_updated": {
          "type": "prompt-queue",
          "template": "[agent-comms] you have pending message(s); read the agent-comms MCP resource to drain",
          "debounceMs": 250
        }
      }
    }
  }
}
```

Field semantics:

- `perServer.happy` — scoped to the `happy` stdio bridge (only `happyMcpStdioBridge.ts` emits `resource_updated` events on the `agent-comms://inbox/<sessionId>` URI in v1).
- `resource_updated` — the MCP notification kind being routed. The 7-kind whitelist in `mcpNotificationRouting.ts` includes `resource_updated`; that is the kind the bridge emits when `fs.watch` fires on the inbox directory.
- `type: "prompt-queue"` — push the rendered template onto the consumer's `MessageQueue2` so the agent reads it at the next turn boundary.
- `template` — the literal wake prompt. The reference implementation exports this exact string as `AGENT_COMMS_WAKE_PROMPT` from `packages/happy-cli/src/agentComms/recovery.ts`; the missed-wake recovery path enqueues the same string so happy-path wakes and recovery wakes are indistinguishable to the agent.
- `debounceMs: 250` — matches the default `resource_updated` debounce; coalesces rapid writes (e.g., a producer writing several messages in quick succession) into a single wake.

The override is intentionally per-server-per-kind, not per-subscription (Northstar rule 4 / §4.4): the wake means "go check the mailbox," and the mailbox itself is the routing fan-out point.

---

## 6 · Worked example: agent-comms Scope B round-trip

The reference implementation in US-002..US-006 proves this end-to-end. Trace of a single message from sender session A to receiver session B (both on the same daemon):

1. **A calls the bridge tool.** Session A's codex/copilot turn invokes the `agent_comms.send` MCP tool that A's `happyMcpStdioBridge` (US-003) exposes. Tool input: `{ targetSessionId: "<B-session-id>", body: <opaque-payload> }`.
2. **Bridge → daemon control hop.** A's bridge delegates to `controlClient.sendAgentMessage(targetSessionId, body, currentSessionId)` (US-004), which POSTs to the local daemon's `127.0.0.1`-bound `POST /agent-comms/send`. The daemon is the single writer for B's inbox — this serializes cross-session writes and avoids the two-writer race that would happen if every bridge wrote directly.
3. **Daemon writes B's inbox.** The daemon validates that both A and B are tracked sessions, then calls `mailbox.appendMessage(targetSessionId, body, sender)` (US-002). `appendMessage` writes `<happyHomeDir>/agent-comms/inboxes/<B>/mailbox.json` atomically via `writeJsonAtomically` and appends a line to `history.jsonl`. The new entry carries `version: 1` (Northstar rule 1). The daemon returns `{ id, seq }` to A.
4. **B's bridge `fs.watch` fires.** B's own per-session bridge has armed `fs.watch` on the inbox directory (the dir, not the file — directory-level watches survive atomic-rename writes; F-003). The watch handler filters on `mailbox.json`, debounces ≥50ms internally, and calls `server.server.sendResourceUpdated({ uri: "agent-comms://inbox/<B-session-id>" })` (Northstar rule 3).
5. **B's `mcpNotificationConsumer` enqueues the wake prompt.** The codex client surfaces the `resource_updated` notification as an `EventMsg::McpServerNotification`. B's `mcpNotificationConsumer` looks up the route (the override from §5), renders the `AGENT_COMMS_WAKE_PROMPT` template, and pushes it onto B's `MessageQueue2`. A's queue receives nothing (no self-wake — the writer side never enqueues into its own queue).
6. **B drains at the next turn boundary.** B's next turn reads the agent-comms MCP resource. B's bridge resource-read callback calls `mailbox.readPending(targetSessionId)`, builds the response payload from the pending entries, and ONLY THEN calls `mailbox.markConsumed(currentSessionId, lastEntrySeq)` (post-drain consume — §2 invariant 1; F-001). The cursor advances by exactly the seq just returned.
7. **Recovery on restart (missed-wake fixture).** If B was offline when the wake fired (consumer disposed, `routing.enabled === false`, or process exited), no `resource_updated` ever reached B's queue. On B's next startup, `recoverPendingAgentCommsMessages(currentSessionId, queue, currentMode)` (US-005) reads `mailbox.readPending` directly, sees the pending entry, and enqueues exactly ONE `AGENT_COMMS_WAKE_PROMPT` onto B's new `MessageQueue2`. The recovery helper NEVER calls `markConsumed` — drain still happens via the US-003 resource-read path. The invariant pinned by the missed-wake assertion: *"no notification replay occurred; mailbox drain, not wake enqueue, consumed the message."*

The happy-path and missed-wake paths produce indistinguishable agent prose (both enqueue the same `AGENT_COMMS_WAKE_PROMPT` string) and indistinguishable on-disk end-state (same cursor advance after drain). The wake is genuinely best-effort; the mailbox is the source of truth.

---

## 7 · Interaction with `codex-app-server-idle-timeout` (INPUT, not resolution)

This pattern is sensitive to one upstream codex behavior that is currently being scoped under the separate `codex-app-server-idle-timeout` task: long-running producer-side MCP servers (a daemon hosting the producer half of `agent_comms.send`, a git-fsmonitor watcher, a periodic-timer driver) want the codex app-server to outlive their last foreground client session — otherwise, the producer process exits when the foreground codex client disconnects, even though the producer's natural lifetime is the daemon's, not the session's.

This is an **INPUT** to that task, not a resolution here:

- This pattern doc surfaces the requirement: *the producer-side MCP server lifetime must be independent of any single foreground codex client's lifetime if the producer is meant to keep writing into consumer inboxes across foreground reconnects.*
- The resolution (whether via an explicit `--idle-timeout=never` flag, a sticky-session count, or a daemon-supervised codex app-server process) belongs to `codex-app-server-idle-timeout`. This doc does not propose a fix.
- The reference implementation in US-002..US-006 is unaffected for **Scope B** because the v1 producer-side bridge is per-session (each session has its own `happyMcpStdioBridge`) and the producer's "do work" surface is the daemon's `POST /agent-comms/send` route, which is daemon-lifetimed, not session-lifetimed. The interaction matters for hypothetical future producers (e.g., a standalone git-watcher MCP server that lives in its own process) — flagged here so the `codex-app-server-idle-timeout` operator decision is informed by this pattern's needs.

---

## 8 · Scope ledger

**In scope (v1, this pattern):**

- Same-daemon, cross-session messaging (agent-comms Scope B). One reference impl proves it end-to-end (US-002..US-006).
- Between-turns wake delivery via the existing `mcpNotificationConsumer` + `mcpNotificationRouting` overlay.
- Durable filesystem mailbox with atomic-write `mailbox.json` + append-only `history.jsonl`.
- Logical `sessionId`-keyed addressing on the wire; stable `agent-comms://inbox/<sessionId>` wake URI.
- Versioned envelope (`version: 1`) on every entry and wake payload.
- Restart-only recovery: a consumer that just started (or whose `routing.enabled` just flipped from `false` to `true`) re-reads its inbox once and enqueues a single wake prompt if anything is pending.

**Out of scope (deferred, named):**

- **Scope A** (cross-machine fan-out). Needs a transport-policy decision (relay topology, auth model, replication semantics). Tracked separately.
- **Scope C** (cross-daemon, same-machine). Conceptually fits this pattern but needs a second-daemon wake-hop design. Out of v1.
- **Mid-turn preemption.** v3 concern, needs codex-core Rust work.
- **Per-subscription routing** (filter/handler per-subscription rather than per-server-per-kind). v2 concern; v1 routing-config schema reserves the namespace.
- **Live settings reload.** Recovery is restart-only in v1; toggling `mcpNotificationRouting.enabled` at runtime is not supported.
- **Generic producer hub** (`async_events_wait` long-poll tool, U1 git-fsmonitor, U2 timer, U4 fs-watch producers). Northstar territory; this doc resolves only the passive-notification *consumer* shape.
- **Live routing settings reload** and any rate-limiting / backpressure beyond the existing 250ms `resource_updated` debounce.

---

## 9 · See also

- [`plans/async-events-design.md`](./async-events-design.md) — superseded historical exploration (commit `35bc26f6`, 2026-05-13).
- [`plans/channels-research.md`](./channels-research.md) — Claude-Code channels primitive research that informed the wake-hint shape.
- `.ralph/brainstorms/async-events-design/selected-direction.md` — direction D-002 selection rationale.
- `.ralph/brainstorms/async-events-northstar-architecture/selected-direction.md` (commit `950b795b`) — N-001 selection that produced the four binding Northstar rules in §4.
- `packages/happy-cli/src/codex/mcpNotificationConsumer.ts` and `mcpNotificationRouting.ts` — the already-shipped consumer + routing layer this pattern composes with.
- `packages/happy-cli/src/agentComms/` (US-002..US-006) — the reference implementation that proves this pattern end-to-end.
