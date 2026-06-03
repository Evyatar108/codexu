Lenses: ran=[devils-advocate, codex]; skipped=[copilot] (CLI ran twice but produced empty output; smoke test of the CLI succeeded, so the failure was specific to this prompt+effort+payload combination — most likely a timeout while the CLI was still in its long initial "I'll open the referenced prompt file" planning preamble. Treated as malformed for synthesis.)

# Async events design — brainstorm synthesis

## Re-evaluation context

The original async-events-design task was blocked on the channels primitive shipping. Two related ships closed that gap today (2026-06-02):

1. **`codex-mcp-server-notifications` Stage A** (codex submodule `b371db56d`) — codex now emits `EventMsg::McpServerNotification` (7 standard MCP kinds: progress, cancelled, resource_updated, resource_list_changed, tool_list_changed, prompt_list_changed, logging_message) and `EventMsg::McpSamplingRequest`. Gated by `Feature::McpServerNotifications`.
2. **`codex-channels-option-b`** (commit `c3075b6c`) — happy-cli consumer `packages/happy-cli/src/codex/mcpNotificationConsumer.ts` + `mcpNotificationRouting.ts`. Routes notifications into the existing `MessageQueue2` with per-kind / per-server configurable policy (display-only vs prompt-queue + template + trailing-edge debounce). Disabled by default; opt-in via `settings.mcpNotificationRouting.enabled`.

Both lenses agree that this re-classifies the original Option (a) "MCP 2-way channels" as **partially shipped** (consumer side built, producer side missing) rather than greenfield. They diverge on whether "just build the producers" is the correct next step or whether the abstraction itself needs more scrutiny first.

## Re-evaluated 5-option matrix (axes drawn from both lenses)

| Option | Latency (post-turn) | Cross-tunnel reach | Same-daemon B+C reach | Replay/durability | Producer ergonomics | Conflict surface | Status today |
|---|---|---|---|---|---|---|---|
| (a) MCP channels push | Low (ms after turn end) | None (in-session only) | Yes when sessions share producer-side MCP server | None — relies on producer re-poll | Producer can be Node/TS in `happyMcpStdioBridge.ts` | Low (TS-only producer side) | **Consumer SHIPPED; producers ABSENT** |
| (b) Exit-and-respawn | 2-10s per event | Best (operator-driven, no liveness assumption) | Yes (each spawn is independent) | Best (every event is a fresh session) | Trivial (cron / scheduler) | Zero | Status quo |
| (c) Long-poll MCP tool | Low (ms) | None | Per-caller, explicit | Producer-local (same as a) | Same as (a) but agent must explicitly wait | Low (TS-only) | Not built; would reuse Option (a) producer code |
| (d) App-server `thread/subscribeEvents` RPC | Low (ms) | Yes if WS exposed (today loopback-only) | Yes (already shares app-server) | None inherent | Rust-side, can reuse `app-server/src/fs_watch.rs` (already debounced!) | High (protocol bump + Rust + permission gating) | Not built |
| (e) Hybrid (hooks + channels) | Mixed | Hooks fire on codex lifecycle, not external events | Same as (a) | Same as (a) | Hooks add nothing for U1/U2/U4 because none are codex lifecycle events | Mixed | Rejected by both lenses |

Both lenses note (e) is the wrong primitive — codex hooks observe codex's OWN lifecycle, not external events. Devil's Advocate adds that (b) exit-and-respawn has been undersold: it's the only option with cross-tunnel reach and best operational simplicity, and Claude Code's actual production cron pattern is much closer to (b) than to in-session subscription.

The remaining decision question is whether (a)+(c) shared-producer-code or (d) app-server-side path is the right v1, and whether ANY new in-session machinery is justified before more concrete demand surfaces.

## Adjacent-task assessment (both lenses converge)

- **`3d-workers`** — KEEP-BLOCKED. The channels ship does not address its actual blockers (`3a-skills` discovery + `3b-agents` role TOMLs). Channels may marginally affect the design surface if the spawned worker is long-lived enough to want subscriptions, but that's a Phase 6 concern, not a v1 blocker.
- **`agent-comms`** — **PARTIAL UNBLOCK candidate.** Scope B (same-daemon cross-session) and Scope C (parent-child) become tractable using the "durable inbox + channel wake" pattern; Scope A (cross-tunnel cross-daemon) stays blocked on the transport-policy decision that pre-dates channels. Rescoping the task to "land B+C now, defer A" is a real option but should be a deliberate operator decision, not an automatic unblock.
- **`codex-app-server-idle-timeout`** — KEEP TRACKED as planned. Surfaced interaction: long-running subscriber MCP servers want the app-server to outlive the foreground client. This is an *input* to the timeout decision (argues for either configurable timeout or heartbeat-based liveness), not a blocker on async-events.

## Codex-as-crews-engine answer

Both lenses converge: channels are **necessary-and-sufficient for the wake signal** but **insufficient as the durable mailbox**. The safe direction is the hybrid:

- **Source of truth**: file-based mailbox (current crews design). Cursor, audit trail, crash recovery, cross-machine fan-out all flow from filesystem semantics.
- **Wake signal**: MCP notification on same daemon → consumer in target session pushes a "you have mail" prompt-queue entry → target wakes on next turn boundary and reads the durable mailbox.
- **Missed wakes must be harmless**: any consumer that comes online later (after restart, after reconnect, after channels disabled then re-enabled) must catch up by reading the mailbox state, not by replaying lost wake signals.

Channels-native crews storage is **rejected**: it would convert crews from a durable file-protocol into a liveness-dependent protocol, regressing every property crews currently relies on. The "additional primitives" channels would need to replace the mailbox (durable cursor, delivery guarantee, cross-machine fan-out) are exactly the properties the filesystem mailbox already provides — building them in channels-land is re-implementing what crews already has.

## Candidate directions

### D-001: Long-poll / explicit-seam v0 before channels-first producers
- Contributing lenses: [codex, devils-advocate]
- Why this might work: Both lenses note that the just-shipped consumer routes by 7 fixed MCP kinds + global per-server policy with default-off — characteristics that fit "ambient log-shaped events" better than "git/fs/timer event subscription." Shipping a long-poll `async_events_wait` MCP tool first (option c) makes the wait explicit and per-caller, and gives a deterministic test surface BEFORE committing to ambient push. Producer code is shared with the channels path — when channels-first is later justified, the same producers light up by adding notification emission alongside the tool. Devil's Advocate also notes that codex's existing `app-server/src/fs_watch.rs` is already debounced and could fire `tx_event` directly for U4 without an MCP layer at all.
- Risks / friction: Long-poll occupies a tool slot and a model turn while waiting — not passive background delivery. Adds a v0 surface that may have to be deprecated when channels-first matures. Codex's view names this as a fallback/test harness alongside the channels-first path rather than a replacement for it.
- Cheapest validation: Implement one producer (git ref-SHA transition) behind ONE long-poll tool; measure (a) actual false-wake rate against `.git/` churn from IDE indexing, (b) how often the agent ends up calling `async_events_wait` vs just exiting on its own and being respawned.
- Disconfirming observation: Real usage shows agents rarely call the wait tool — they either exit naturally (option b wins) or want passive push (option a's producer side needs building anyway).

### D-002: Durable mailbox + channel wake (agent-comms B/C + codex-as-crews)
- Contributing lenses: [codex, devils-advocate]
- Why this might work: Strongest cross-lens convergence. Same architectural pattern resolves three independent questions at once: (a) how agent-comms Scope B same-daemon messaging works without re-inventing transport; (b) how Scope C parent-child handshake reuses a primitive; (c) how a hypothetical codex-engine crews port relates to the just-shipped channels primitive. Pattern is: the durable filesystem mailbox (or daemon-side inbox) is the source of truth; channel notifications carry "you have mail" wake signals; missed wakes are recoverable by re-reading the mailbox. This is what crews already does internally — just extended to "wake the right session when mail lands." Reuses the just-shipped consumer with no producer-ecosystem investment.
- Risks / friction: Requires deciding the on-disk inbox shape for agent-comms B/C (does it reuse crews' format or invent a parallel store?). Same-daemon cross-session message addressing is a new primitive on top of the daemon's Socket.IO event router. Cross-machine Scope A stays blocked — explicit non-goal.
- Cheapest validation: Two-session manual smoke: agent A on daemon writes message to agent B's mailbox file; agent B's consumer subscribes to a notification emitted by a tiny per-session producer; verify B wakes on next turn boundary and reads the message from disk (not from the notification payload).
- Disconfirming observation: When two sessions on the same daemon need to exchange messages, the codex app-server already shares thread state — maybe Scope B should just use `multi_agents_v2` mailbox seq-watch primitives that already exist (U3a). If so, the channel-wake pattern is overkill for B and only meaningful for cross-process cases that aren't real today.

### D-003: Channels-first Node producer hub
- Contributing lenses: [codex]
- Why this might work: The consumer is built, the wire format is stable, codex Stage A is in the binary. Adding three producers (git ref-watcher, chokidar-based fs watcher, in-process timer) to `happyMcpStdioBridge.ts` is the smallest visible-result increment: ships passive in-session subscription for U1/U2/U4 in 2-3 days with zero codex-side changes and reuses the existing stdio MCP wiring, auth surface, and teardown hook. Matches the prior draft's A0 recommendation, just collapsed onto the already-built consumer instead of holding for a future bridge.
- Risks / friction: Devil's Advocate's contradicting framing in D-004 names the buried assumption explicitly — git/fs/timer events aren't naturally MCP `resource_updated` / `tool_list_changed` semantics, so the producers either misuse standard kinds or get dropped as unknown kinds. The consumer is default-off, so a third-party producer in the wild silently does nothing for users who don't opt in. Per-server / per-kind policy is global, so multiple sessions sharing one producer-side MCP server cannot have different policies. Producer lifecycle (start, stop, restart on disconnect) is non-trivial when folded into the stdio bridge.
- Cheapest validation: One producer (U4 file watcher via chokidar) emitting `notifications/resources/updated`; verify it routes through the consumer to the prompt queue with a real codex session; measure false-wake rate against `node_modules/` write storms.
- Disconfirming observation: When the producer-side smoke test runs, the kind-based routing turns out to drop or misclassify the synthesized events (e.g., a git ref transition has to masquerade as `resource_updated` with a fake URI, and that confuses the agent or the routing config).

### D-004: Delay producer build-out — run a pilot first
- Contributing lenses: [devils-advocate]
- Why this might work: Direct counter to D-003. The optimistic "consumer exists, just build producers" framing skips real questions: (a) is the kind-based routing the right abstraction for git/fs/timer? (b) does the default-off + global-per-server policy create a class of silent-miss bugs across multi-session use? (c) does between-turns-only delivery solve the actual painful case where a long-running turn should be interrupted? Devil's Advocate proposes a real pilot — routing enabled, synthetic producers across multiple concurrent sessions — to measure these before committing producer-ecosystem investment.
- Risks / friction: Defers any visible v1 deliverable by 2-3 weeks of pilot + measurement. Risks "perfect is the enemy of good" — operator may give up waiting and ship D-003 anyway. The pilot itself needs producers built (just throwaway ones), so cost difference vs D-003 is partly about how seriously the v1 producers are designed.
- Cheapest validation: Smoke harness — one ephemeral test producer per use case, two concurrent sessions, routing enabled in one and disabled in the other, observe what each session sees over 1 hour of synthetic events. No production ergonomics, just measurement.
- Disconfirming observation: The pilot shows the kind-routing, default-off policy, and between-turns delivery all behave as expected; no surprises surface that would change the producer design.

## Open questions for the operator (not yet ID-tied to a direction)

These came up across lenses and matter regardless of which direction is picked:

1. Which event kinds *truly* require in-session reaction vs an exit-and-respawn? The prior draft's U1/U2/U4 enumeration was operator-named, not measured.
2. Is the authority of record for each use case the MCP producer (D-003), the app-server (D-001's app-server-fs_watch hint), or a durable mailbox/store (D-002)?
3. Can routing become per-subscription/per-session before multi-session producers ship, or is global per-server/per-kind policy acceptable for v1?
4. What is the explicit missed-wake recovery path when routing is disabled, the session is mid-turn, or the app-server idles out?
5. Should `agent-comms` be rescoped now to unblock B/C while keeping Scope A explicitly blocked?
6. For codex-as-crews-engine: is anyone proposing to move message durability OUT of the file mailbox, or are we explicitly settling on "mailbox = source of truth, channels = wake hint"?
