---
overviewTaskId: async-events-design
---

## Direction
D-002 — Durable mailbox + channel wake (agent-comms B/C + codex-as-crews). The just-shipped channels primitive is used only as a between-turns wake signal; durable message storage stays on the filesystem mailbox pattern that crews already uses, so cross-engine compatibility, audit trail, and crash recovery are preserved.

## Goal
A documented architectural pattern — "durable mailbox is source of truth; channel notifications carry 'you have mail' wakes; missed wakes recoverable by mailbox re-read" — that is the canonical answer for THREE related questions:

1. How async events reach a long-running codex agent without exit-and-respawn for the in-session subset of use cases (U1 git, U2 timer, U4 file-system) that benefit from passive notification rather than active polling.
2. How `agent-comms` Scopes B (same-daemon cross-session messaging) and C (parent-child handshake) deliver messages — they reuse the same filesystem-inbox + channel-wake pattern instead of inventing a new transport.
3. How a hypothetical codex-engine port of the `crews` plugin uses the channels primitive — as a wake hint on top of crews' existing file-mailbox protocol, NEVER as a replacement for the mailbox.

The end state after this direction is built correctly:
- A short architectural-pattern document under `plans/` (or extended into the existing `plans/async-events-design.md` shape) that names "Durable mailbox + channel wake" as the canonical pattern, with at least two concrete worked examples (agent-comms Scope B; codex-as-crews-engine wire).
- A small reference implementation that proves the pattern end-to-end for ONE concrete case — recommended candidate is agent-comms Scope B because it has the cleanest acceptance criteria (two sessions on one daemon exchange a message via filesystem inbox + channel wake). The producer side (write to inbox + emit notification), the consumer side (the just-shipped `mcpNotificationConsumer.ts` already handles routing), and the missed-wake recovery (consumer re-reads inbox state on startup / reconnect / when routing is enabled mid-session).
- An explicit rejection note in the document for "channels-native crews storage" with the rationale that liveness-dependent durability regresses every property crews currently relies on (cursor, audit, cross-restart, cross-machine fan-out).

## Scope

### In Scope
- Architectural pattern document covering the three questions above with worked examples and acceptance criteria.
- Reference implementation for ONE concrete case (recommended: agent-comms Scope B — same-daemon cross-session). The implementation must demonstrate: (a) one session writes a message to a filesystem inbox; (b) a tiny producer-side MCP server (lives in `packages/happy-cli/src/codex/happyMcpStdioBridge.ts` or a parallel module) emits a `notifications/resources/updated` or equivalent kind so the just-shipped consumer in the target session routes a "you have mail" prompt to its `MessageQueue2`; (c) target session reads the message from disk on the next turn boundary; (d) a kill-and-restart fixture shows the target catching up by re-reading the inbox on cold start without any replay of lost wake signals.
- A backfill / re-scope assessment for `agent-comms`: if the implementation works for Scope B, file a follow-up to partially unblock that task (Scope B + C move out of "blocked"; Scope A explicitly stays blocked on the cross-tunnel transport policy decision).
- Documenting the interaction with `codex-app-server-idle-timeout`: long-running producer-side MCP servers want the app-server to outlive the foreground client. Surface this as an input to the timeout decision in that task's brainstorm, do not resolve it here.
- Documenting the producer-side hosting decision (fold into existing `happyMcpStdioBridge.ts` vs separate child process) for whichever concrete case is implemented. The brainstorm-stage default recommendation was to fold into the existing bridge to reuse stdio wiring + auth + teardown.

### Out of Scope
- Building producer infrastructure for U1 (git), U2 (timer), U4 (file-system) generic use cases. These are the D-003 "Channels-first Node producer hub" direction and are deferred to the northstar follow-up brainstorm (`async-events-northstar-architecture`, sibling task filed by the operator 2026-06-02).
- Long-poll MCP tool surface (`async_events_wait`) — D-001's content; deferred to the northstar brainstorm.
- App-server `thread/subscribeEvents` JSON-RPC and its interaction with the codex `fs_watch` crate — D-004's content via Devil's Advocate; deferred to the northstar brainstorm.
- `agent-comms` Scope A (cross-tunnel / cross-daemon) — stays blocked on the transport-policy decision (relay vs P2P-tunnels vs mobile-broker) that pre-dates channels.
- `3d-workers` — its blockers (3a-skills + 3b-agents) are unrelated to channels; keep blocked.
- Any production-quality multi-producer ecosystem (rate-limiting tiers, per-subscription policy, multi-session policy overrides) — these surface in the northstar brainstorm; not v1 for this direction.
- Cross-machine fan-out of any kind. Channels are intentionally treated as same-daemon only for this direction.
- Mid-LLM-call preemption. The pattern delivers between turns, matching Claude Code channels' and codex mailbox's existing semantics.
- ANY codex/ submodule changes. The just-shipped Stage A `EventMsg::McpServerNotification` and the consumer in happy-cli are sufficient surfaces; this direction stays entirely in TypeScript.

## Criteria

The direction is delivered correctly when each of the following is verifiable:

- [ ] An architectural pattern document under `plans/` names "Durable mailbox + channel wake" as the canonical pattern, lists at least the three questions it resolves (in-session async events, agent-comms B/C, codex-as-crews-engine), and contains the explicit rejection note for "channels-native crews storage" with the rationale (loss of cursor / audit / crash-recovery / cross-machine fan-out).
- [ ] A reference vitest fixture covering the agent-comms Scope B case demonstrates: two simulated sessions on the same daemon; session A writes a message to session B's inbox file; a producer-side MCP server emits a notification; session B's consumer (existing `mcpNotificationConsumer.ts`) routes a synthesized prompt into `MessageQueue2`; session B reads the message from disk on the next turn boundary.
- [ ] A second vitest fixture demonstrates the missed-wake recovery contract: B is brought up with routing disabled; A sends a message; B re-enables routing AND is restarted; B finds and processes the message by reading the inbox on startup, not by replaying any wake signal.
- [ ] The reference implementation lives entirely in TypeScript under `packages/happy-cli/` (and possibly `packages/happy-server/` for inbox path coordination); ZERO touches to `codex/` submodule files.
- [ ] The document calls out the `codex-app-server-idle-timeout` interaction (subscribers want app-server to outlive foreground clients) as input to that task's brainstorm, without trying to resolve it here.
- [ ] If the implementation lands, an operator-decision-bearing follow-up either (a) re-files `agent-comms` with Scope A only as the remaining blocker, or (b) confirms the original blocker list still holds and explains why the Scope B implementation doesn't move the needle.
- [ ] The codex-as-crews-engine architectural answer is captured in the document as "channels = wake, mailbox = durable; channels-native storage REJECTED" with at least one paragraph explaining what additional primitives channels would need to gain (durable cursor, delivery guarantee, cross-machine fan-out) before they could replace the file mailbox — and noting that those primitives are exactly what crews' filesystem mailbox already provides, so building them in channels-land is duplicative.
- [ ] All happy-cli tests pass (`pnpm --filter happy-cli test`) and cross-package typecheck is green for any package the reference implementation touches.

## Context

### Brainstorm synthesis highlights

Two of three lenses ran (Codex feasibility + Devil's Advocate). Copilot lens ran twice at xhigh effort and produced empty output despite a successful smoke test — treated as `malformed` for Partial-mode synthesis. The codex + devils-advocate convergence on D-002 was strong: both lenses independently named "channels = wake signal, durable mailbox = source of truth" as the right architectural pattern, both rejected channels-native crews storage, and both flagged the same adjacent-task treatment (3d-workers keep blocked; agent-comms B/C partial unblock candidate; codex-app-server-idle-timeout surface but don't resolve).

The selected direction is intentionally narrower than the prior un-landed draft at commit `35bc26f6` (`plans/async-events-design.md`, ~520 lines) which envisioned a full A0 long-poll + A1 push two-stage build-out covering U1/U2/U4 generic producers. The narrower D-002 framing leverages the just-shipped channels consumer for a specific architectural pattern rather than committing to a generic producer ecosystem; the operator filed a separate northstar brainstorm (`async-events-northstar-architecture`) to handle the longer-horizon design choices (D-001 long-poll, D-003 producer hub, D-004 pilot-first, app-server subscription RPC, agent-comms Scope A, codex-as-crews-engine wire-protocol details).

### Cross-lens convergence (what made D-002 the recommendation)

| Question | Codex lens position | Devil's Advocate position | Convergence |
|---|---|---|---|
| Should channels carry durable message state? | "Channels insufficient for mailbox parity, cursors, replay, or multi-machine delivery" | "Channels-native crews storage = dangerous; mailbox properties come from filesystem, not liveness" | YES — both reject channels-native storage |
| Right pattern for agent-comms Scope B? | "Same-daemon durable inbox plus channel wake pattern" | "Hybrid: mailbox is source of truth; channels say you have mail; missed wakes required to be harmless" | YES — same architectural pattern |
| Right pattern for codex-as-crews-engine? | "Hybrid mailbox durability with channels carrying only you-have-mail wakeups" | "Channels-native rejected unless they gain durable cursor + delivery guarantee + multi-machine fan-out" | YES — both name the same hybrid + same rejection |

### Rejected alternatives note

- **Channels-native crews storage** — explicitly REJECTED. Converts crews from a durable file-protocol into a liveness-dependent protocol; the additional primitives channels would need (durable cursor, delivery guarantee, cross-machine fan-out) are exactly what the filesystem mailbox already provides. Building them in channels-land is duplicative and lossy.
- **Channels-first generic producer hub for U1/U2/U4 (D-003)** — deferred to the northstar brainstorm. Devil's Advocate's buried-assumption critique stands: git/timer events aren't naturally MCP `resource_updated` / `tool_list_changed` semantics; the kind-routing + default-off + global-per-server policy creates failure modes that warrant a measurement pilot (D-004) before committing producer-ecosystem investment.
- **Long-poll `async_events_wait` MCP tool (D-001)** — deferred to the northstar brainstorm. Useful as a deterministic test surface and a per-caller fallback, but tangential to the D-002 architectural-pattern goal.

### Disconfirming observations to watch for during plan / impl

1. When two sessions on the same daemon need to exchange messages, codex's app-server already shares thread state — `multi_agents_v2` mailbox seq-watch primitives may already cover Scope B without any new inbox file format. If the plan-phase member confirms this, the reference implementation may collapse to "use the existing mailbox seq-watch via channels notifications" rather than introducing a parallel filesystem inbox.
2. If the producer-side smoke test shows that synthesizing a notification (even via a sanctioned kind like `resource_updated`) requires fabricating a fake URI or other field that confuses the consumer's routing, the kind-based abstraction may be wrong and the implementation may need to either define an unofficial "wake-signal" subtype or revisit the routing layer in the just-shipped `mcpNotificationConsumer.ts`.
3. If the missed-wake recovery fixture cannot be implemented without instrumenting the consumer to log when notifications were dropped, the "missed wakes harmless" invariant may be unverifiable in production — that would be a design escalation, not a v1 ship.

### Future work — out of this direction but tracked elsewhere

- `async-events-northstar-architecture` (filed by operator 2026-06-02 as a sibling task) — longer-horizon design choices: D-001 long-poll, D-003 producer hub, D-004 pilot, app-server subscription RPC, agent-comms Scope A cross-tunnel transport, codex-as-crews-engine wire-protocol details, multi-session per-subscription routing, mid-turn preemption requirements gathering.
- `agent-comms` — partial-unblock follow-up depends on whether the D-002 reference implementation actually works for Scope B; until then, keep all three Scopes blocked.
- `3d-workers` — keep blocked on 3a/3b; revisit only if the northstar brainstorm produces a long-lived-worker direction that depends on channels.
- `codex-app-server-idle-timeout` — input from this direction: long-running producer-side MCP servers want the app-server to outlive foreground clients. Carry into that task's brainstorm.

### Open question for follow-up tasks (not for the plan-with-ralph member)

- Copilot lens reliability: this brainstorm ran in Partial mode because the Copilot xhigh-effort lens produced empty output twice despite a successful smoke test. The Codex lens succeeded on the same prompt, and the Devil's Advocate agent succeeded. Root-cause this as its own task if the pattern repeats on subsequent brainstorms — the working hypothesis is a timeout while the CLI is still in its long initial planning preamble, but a real investigation is needed.

### Carryover note for the `/plan-with-ralph --from-brainstorm` member

You are receiving a NARROW architectural-pattern brainstorm. Your plan should NOT try to scope a full producer ecosystem or a long-poll tool — those are explicitly out-of-scope here and tracked separately under `async-events-northstar-architecture`. Focus the plan on (a) the pattern document, (b) the ONE reference implementation (recommend agent-comms Scope B), (c) the two fixtures (happy-path + missed-wake recovery), and (d) the follow-up filings (agent-comms partial-unblock decision; codex-app-server-idle-timeout input note). Read disconfirming observation #1 carefully before committing to a parallel filesystem inbox — the existing `multi_agents_v2` mailbox may already be the right durable substrate. Read disconfirming observation #2 before committing to the kind-routing strategy — if synthesizing notifications requires fabricating URIs, surface to the operator BEFORE implementing.

### Sources

- Brainstorm synthesis: `brainstorm-synthesis.md` (this directory)
- Machine-readable manifest: `brainstorm.json` (this directory)
- Just-shipped channels consumer code: `packages/happy-cli/src/codex/mcpNotificationConsumer.ts`, `mcpNotificationRouting.ts`, `runCodex.ts` event-handler wiring at line ~754
- Stage A codex code: codex submodule `b371db56d` — `EventMsg::McpServerNotification`, `EventMsg::McpSamplingRequest`
- Prior un-landed draft (for context, not as a direct seed — selected direction is narrower): `git show 35bc26f6:plans/async-events-design.md`
- Codex `multi_agents_v2` mailbox (for disconfirming observation #1): `codex/external/repos/codex-patched/codex-rs/core/src/tools/handlers/multi_agents_v2/{spawn,send_message,wait,close_agent}.rs`
- crews plugin file mailbox (for codex-as-crews-engine answer): `ai-developer-toolkit/plugins/crews/`
- Roadmap arch diagram + open question #6: `plans/codexu-roadmap.md` lines 1248-1266, 1547-1551
