Lenses: ran=[codex, copilot, devils-advocate]; skipped=[] (full mode)

# Brainstorm synthesis: Codex-native orchestration to RETIRE the crews plugin

## Headline verdict: PARTIAL-REDUCTION-ONLY (full replacement is NOT-YET)

All three independent lenses converged on the same answer, against the operator's
full-replacement lean:

- **Codex (feasibility):** "PARTIAL now, NOT-YET for retiring crews entirely."
- **Copilot (product-reality):** "the honest headline is NOT-YET for full replacement."
- **Devil's Advocate:** "NO-GO on full replacement; SHRINK is the honest answer," `red_flag: true`.

Full codex-native replacement of crews is **not feasible today**. It is gated on three
missing primitives (Windows app-server session lifecycle, a durable cross-session mailbox
with review cursors, and an operator review-gate product). What IS feasible now is a
**partial reduction**: move crews' in-session fan-out to codex-native primitives and adopt
the codex-native *wake*, while keeping crews' thin durable+operator coordination layer until
those primitives ship.

## The honest reframe (Devil's Advocate, corroborated by all lenses)

"Retire crews entirely?" buries the real question. Crews is **two welded layers**:

- **Layer A — in-session / short-lived FAN-OUT** (spawn N workers, wait, collect). Codex-native
  primitives (multi-agent v2, `/goal`, async injection) map cleanly onto this.
- **Layer B — durable, cross-session, operator-gated COORDINATION**: on-disk mailbox with a
  monotonic cursor + append-only history, review-mail gates, Stop/PreToolUse enforcement, an
  operator channel, and crash-sweep/takeover. Codex has **no native equivalent** for Layer B.

So "retire crews entirely" actually means "reimplement Layer B from scratch" — and
`packages/happy-cli/src/agentComms/` (mailbox/router/recovery/peerTransport/peerAuth/
peerResolver/spawnApproval, with scopeA/B/C tests) **is already that rewrite in TypeScript**.
That relocates the same lock-contention / process-spawn / peer-auth fragility from one Node
plugin to another TS package; it does not remove it.

### Decisive disconfirming evidence (the fork already answered this)

The fork's own canonical design doc for exactly this question reached the **opposite** of the
operator's lean. `plans/durable-mailbox-channel-wake.md:23` addresses "codex-as-crews-engine"
and concludes: *channels are the wake hint, the filesystem mailbox is the source of truth;
channels-native crews storage is rejected.* §3 (`:47-52`) gives four reasons codex-native
storage fails: loss of cursor, loss of audit history, loss of crash-recovery (the v2 mailbox
"cannot survive a daemon restart"), and loss of cross-machine fan-out. Even the most
codex-forward design in the repo **keeps crews' durable filesystem mailbox + operator-gate
shape** and only swaps the WAKE transport to codex-native.

## Capability-by-capability mapping (crews -> codex-native)

| # | Crews responsibility | Codex-native mechanism | Class | Gating blocker |
|---|---|---|---|---|
| 1 | Spawn N independent top-level PEER sessions (`ai-developer-toolkit/plugins/crews/hooks/actors.js:2730-3069`, wt.exe/process spawn + engine select + manifests) | `core/src/tools/handlers/spawn_top_level_session.rs:29-171,227-245` (`SpawnTopLevelSessionHandler` spawns a top-level Happy session via the local Happy daemon, `HAPPY_DAEMON_CONTROL_URL`) + `core/src/tools/spec_plan.rs:718-724`; Windows lifecycle = happy-cli `codexAppServerDiscovery.ts:58-218` | **BUILDABLE-SEAM** | Upstream Rust `app-server-daemon` is **Unix-only** (`app-server-daemon/README.md:13-15`); Windows substrate must be happy-cli-managed; N-peer multiplex isolation unproven (happy-cli client is 1-conversation-per-process, `codexAppServerClient.ts:237,1566,1859`) |
| 2 | Durable async MAILBOX + listener/arm (`hooks/mailbox.js:441-497,638-726`, `lib/listener-loop.js:274-487`, cursor `hooks/actors.js:1536-1542`) | codex async-injection is the **WAKE only**: MCP-notif -> `MessageQueue2` (`packages/happy-cli/src/codex/mcpNotificationConsumer.ts:1-21,96-177`; `core/src/tasks/mod.rs:570-614,889-915`); durable store stays filesystem (`plans/durable-mailbox-channel-wake.md:113-150`); TS rebuild exists at `packages/happy-cli/src/agentComms/` | **BUILDABLE-SEAM (= rewrite of Layer B)** | v2 mailbox is session-bounded / in-memory (`core/src/session/mod.rs:1690-1758`), "cannot survive a daemon restart" (`durable-mailbox-channel-wake.md:47-52`); delivery is between-turns only |
| 3 | LEAD/MEMBER + operator review-gate protocol (`docs/protocol.md:3-35,100-146`, `hooks/stop.js:931-942`, `hooks/pre-tool-use.js:583-625`, operator `hooks/protocol/envelope.js:78-99`) | `/goal` (`app-server/src/request_processors/thread_goal_processor.rs:37-147`) + `request_user_input` (Default/Plan mode only) | **GENUINE-GAP** | No codex-native review-mail / Stop-hook / monotonic cursor / operator-channel product |
| 4 | CROSS-ENGINE orchestration (Claude/Copilot/Codex) (`hooks/actors.js:2633-2644,2749-2789`) | codex-only by construction | **GENUINE-GAP (if retained)** | Full codex-only replacement **silently deletes** model diversity that ralph's fan-out uses TODAY (`ai-developer-toolkit/plugins/ralph/skills/brainstorm-with-ralph/SKILL.md:113-161`) — this very brainstorm ran codex+copilot+claude lenses |
| 5 | Crash/liveness/takeover (`hooks/member-crash-notifications.js:255-472`, heartbeat) | happy-cli daemon discovery locks + session-mismatch termination + telemetry (`codexAppServerDiscovery.ts:58-218`, `codexAppServerClient.ts:1004-1469`, `codexDaemonDoctor.ts`/`codexDaemonTelemetry.ts`) | **BUILDABLE-SEAM** | Covers daemon-PROCESS liveness, not cross-session MEMBER takeover/recovery |

Bottom line: capabilities #1, #2, #5 are buildable seams (with caveats); #3 and #4 are genuine
gaps. The parts codex can natively replace are exactly the parts crews shares with any fan-out
tool; the durable cross-session mailbox + operator review-gate protocol is the residual with no
codex-native equivalent.

## Candidate directions

### D-001: SHRINK crews to the durable+operator layer; move only fan-out to codex-native  (RECOMMENDED)
- Contributing lenses: [codex, copilot, devils-advocate]
- Why this might work: Layer A (3-wide in-session fan-out — brainstorm lenses, plan reviewers,
  Phase 5.5 retrospectives) fits codex's default 4-thread cap (`features/src/feature_configs.rs:7-39`)
  and maps onto multi-agent v2 / app-server. Adopt the codex-native WAKE per the fork's own design
  (`durable-mailbox-channel-wake.md`). KEEP the thin filesystem mailbox + operator-gate layer
  (`hooks/mailbox.js`, `hooks/stop.js`, `hooks/pre-tool-use.js`, `envelope.js`) until last. Sheds the
  spawn-a-wt.exe-tab fragility (`hooks/actors.js:2817-2825`) WITHOUT a full Layer-B rewrite.
- Risks / friction: if the operator's real pain is the hook-heavy Node surface (PreToolUse/Stop on
  every tool call) rather than tab-spawning, shrinking still leaves Layer B as Node hooks, so felt
  fragility may not drop much.
- Cheapest validation: pick ONE ralph workflow that uses crews only for in-session fan-out; port that
  fan-out to codex v2/app-server, leave member launch + mailbox + review-mail + Stop-gates in crews;
  measure whether hook/listener pressure drops without losing operator control.
- Disconfirming observation: profile WHERE the EPERM/lock-contention/listener-silent-reap incidents
  originate — if >50% are in mailbox/manifest lock paths (`hooks/actors.js:1470-1474,1536-1542`) not
  spawn/wt.exe paths, shrinking the fan-out layer does not fix the dominant failure mode.

### D-002: NOT-YET full replacement — build app-server peer-session orchestration first  (the operator's lean, honestly scoped)
- Contributing lenses: [codex, copilot, devils-advocate]
- Why this might work (eventually): the seams exist — `spawn_top_level_session.rs` for peer spawn,
  `agentComms/` as a started durable layer, MCP-notif wake as transport. If they mature, a codex-only
  orchestrator is conceivable.
- Risks / friction: this is an **XL second-system rewrite** that RELOCATES fragility into
  `packages/happy-cli/src/agentComms/` rather than removing it, and re-implements battle-tested Layer-B
  behavior (durable cursor, audit history, review-mail gates, Stop/PreToolUse, operator channel,
  crash-sweep/takeover) from scratch — a long reliability regression for no NEW capability. Silently
  drops cross-engine model diversity.
- Cheapest validation: prototype one codex-only lead spawning TWO independent app-server-backed peer
  conversations on Windows; persist one durable message across a process restart; deliver it to an
  OFFLINE peer that survives reboot; expose a per-consumer processed-cursor. (Today the evidence is the
  opposite: `session/mod.rs:1690-1758` + `durable-mailbox-channel-wake.md:47-52`.)
- Disconfirming observation: if the app-server cannot create/resume independent peer conversations on
  Windows, or mailbox delivery cannot survive restart without crews' on-disk model, full replacement is
  ruled out until those primitives ship.

### D-003: Cheaper non-rewrite alternatives — point-fix crews' Windows hot spots; decide cross-engine explicitly
- Contributing lenses: [devils-advocate, copilot (partial)]
- Why this might work: crews' Windows-fragility hot spots are localized — the EPERM/rename lock race
  (`hooks/actors.js:784,1470-1474`) and the listener silent-reap (documented in codexu AGENTS.md as an
  attached-async-shell lifecycle issue) are fixable with heartbeat-liveness + auto re-arm, far cheaper
  than a substrate swap. And cross-engine is a LIVE, in-use capability (this brainstorm just used it),
  so any replacement must DECIDE to drop it, not assume it.
- Risks / friction: point fixes won't hold if the incidents are spread across many hook paths rather
  than concentrated in 2-3 lock/listener sites.
- Cheapest validation: bisect the last ~20 crews crash incidents; if concentrated in 2-3 sites, point
  fixes dominate a rewrite on cost.
- Disconfirming observation: this is wrong only if the operator has truly committed codex-only for ALL
  agent work (lenses included) AND the incidents are systemic to the Node-hook architecture.

## Recommended migration path (D-001, incremental)

1. **Move first (low risk, high value):** in-session 3-wide fan-out (ralph brainstorm lenses, plan
   reviewers, Phase 5.5 retrospectives) -> codex multi-agent v2 / app-server, within the 4-thread cap.
   This is the largest fragility win (drops per-fan-out wt.exe tab spawning) for the least Layer-B risk.
2. **Adopt the codex-native WAKE, keep the filesystem mailbox:** route mailbox wake through the
   MCP-notification -> `MessageQueue2` seam already consumed by happy-cli, exactly as
   `durable-mailbox-channel-wake.md` prescribes. Do NOT move the durable store off the filesystem.
3. **Keep until last (the residual):** crews' durable cross-session mailbox + cursor/history,
   review-mail gates, Stop/PreToolUse enforcement, operator channel, and crash-sweep/takeover.
4. **Gate the verdict flip to GO on three primitives shipping:** (a) Windows app-server session
   lifecycle (today happy-cli-managed only; upstream Rust daemon Unix-only); (b) durable cross-session
   mailbox with review cursors that survives daemon restart; (c) an operator review-gate product
   equivalent to review-mail + Stop gates.
5. **Cross-engine decision (operator-gated):** explicitly decide whether to drop Claude/Copilot
   members. If ralph's brainstorm/plan lenses still need model diversity (they do today), cross-engine
   stays and full codex-only replacement is off the table by definition.

## Conflict surface (repos/plugins a replacement touches)

- **codex submodule** (`codex/external/repos/codex-patched/codex-rs`): `core/src/tools/handlers/spawn_top_level_session.rs`, `core/src/tools/handlers/multi_agents_v2/`, `core/src/tasks/mod.rs`, `app-server/src/request_processors/{thread,turn,thread_goal}_processor.rs`, `app-server-protocol/src/protocol/v2/`, `app-server-daemon/` (Unix-only). Overlay: `codex/codex-rs-overlay/`.
- **codexu / happy-cli** (`packages/happy-cli/src/codex/` + `packages/happy-cli/src/agentComms/`): the Windows app-server lifecycle, the MCP-notification wake consumer, and the in-progress durable-mailbox TS rebuild — the highest-churn surface.
- **crews plugin** (`ai-developer-toolkit/plugins/crews/`): shrinks (fan-out removed) but Layer B (`hooks/mailbox.js`, `lib/listener-loop.js`, `hooks/stop.js`, `hooks/pre-tool-use.js`, `hooks/protocol/envelope.js`, `hooks/member-crash-notifications.js`) is retained until the residual ships.
- **ralph plugin** (`ai-developer-toolkit/plugins/ralph/`): fan-out call sites that move to codex v2.

## Open questions carried to planning

1. Is the operator's pain primarily (a) wt.exe tab/process spawning, (b) on-disk lock contention / EPERM
   rename races, or (c) the hook-heavy Node surface itself? Each points to a DIFFERENT fix; only (c) truly
   motivates full replacement.
2. Will the operator stop using copilot/claude brainstorm/plan lenses? If not, full codex-only replacement
   silently deletes cross-engine model diversity this very brainstorm depends on.
3. Given `durable-mailbox-channel-wake.md` §3 already rejected codex-native crews storage, does
   "codex-native replacement" really mean "crews mailbox + operator gates rewritten in TS under
   happy-cli/agentComms"? If so, what NEW capability justifies the rewrite over hardening crews in place?
4. Is app-server thread-level isolation (one daemon, N threads) acceptable, or must the replacement
   preserve separate OS/top-level sessions (fault isolation + per-tab operator attach)?
5. What concrete primitive must ship next to flip PARTIAL -> GO: durable peer mailbox, operator gates, or
   Windows session lifecycle?
