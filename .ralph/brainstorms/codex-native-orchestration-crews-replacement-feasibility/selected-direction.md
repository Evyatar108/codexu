---
overviewTaskId: codex-native-orchestration-crews-replacement-feasibility
---

## Direction
D-001 — SHRINK crews to its durable+operator coordination layer; move only in-session fan-out to codex-native. Full codex-native replacement of crews is NOT-YET feasible (gated on three missing primitives), so the honest, value-positive path is a partial reduction rather than a rewrite.

## Goal

A documented partial-migration in which crews' fragile in-session fan-out is replaced by codex-native primitives, while crews' battle-tested durable coordination layer is preserved — with a written, source-grounded GO/PARTIAL/NO-GO verdict that the operator can use to decide the cross-engine question and to know exactly which primitive must ship before "full replacement" becomes feasible.

Concretely, after this direction is planned + implemented:

- One representative ralph in-session fan-out site (brainstorm lenses, plan reviewers, OR Phase 5.5 retrospectives — all 3-wide, fitting codex's default 4-thread cap) runs on codex multi-agent v2 / app-server instead of spawning crews members in separate `wt.exe` tabs.
- Mailbox WAKE is routed through the codex-native MCP-notification → `MessageQueue2` seam (per `plans/durable-mailbox-channel-wake.md`), while the durable mailbox store stays on the filesystem.
- Crews' Layer B (durable cross-session mailbox + cursor/history, review-mail gates, Stop/PreToolUse enforcement, operator channel, crash-sweep/takeover) remains intact and authoritative.
- A measurement exists for whether hook/listener pressure actually dropped, and a profile of where the EPERM/lock-contention/listener-silent-reap incidents originate (fan-out spawn paths vs. mailbox/manifest lock paths).

Explicitly NOT this work: rewriting crews' durable mailbox into `packages/happy-cli/src/agentComms/`; dropping cross-engine support; adopting the Unix-only upstream Rust `app-server-daemon`; building a codex-only orchestration daemon.

## Scope

### In Scope
- Port exactly ONE in-session fan-out site from a crews-member spawn pattern to codex multi-agent v2 / app-server, within the default 4-thread cap (`codex/external/repos/codex-patched/codex-rs/features/src/feature_configs.rs:7-39`).
- Wire the mailbox WAKE through the existing codex-native MCP-notification consumer (`packages/happy-cli/src/codex/mcpNotificationConsumer.ts:1-21,96-177`; `core/src/tasks/mod.rs:570-614,889-915`) per `plans/durable-mailbox-channel-wake.md:113-150`, leaving the filesystem mailbox store untouched.
- Keep crews' Layer B as-is (`ai-developer-toolkit/plugins/crews/hooks/mailbox.js`, `lib/listener-loop.js`, `hooks/stop.js`, `hooks/pre-tool-use.js`, `hooks/protocol/envelope.js`, `hooks/member-crash-notifications.js`).
- Instrumentation/profiling to attribute crews crash incidents to spawn paths vs. lock paths.
- A short markdown deliverable documenting the verdict, the capability map, and the "what must ship to flip to GO" gate list.

### Out of Scope
- Full retirement of crews (D-002 — NOT-YET; XL second-system rewrite).
- Building/extending `packages/happy-cli/src/agentComms/` into a crews replacement.
- Dropping cross-engine (Claude/Copilot/Codex) support — a separate operator-gated decision.
- Adopting the upstream Rust `app-server-daemon` crate (Unix-only: `app-server-daemon/README.md:13-15`).
- Hard mid-LLM-call preemption (`plans/async-events-design.md:33-36,389-396`).
- Any change to crews' durable mailbox storage shape.

## Criteria

1. One ralph in-session fan-out site demonstrably runs via codex multi-agent v2 / app-server (no `wt.exe` tab spawned for that fan-out), with the result collected back into the ralph flow unchanged.
2. The ported site's wake is delivered through the codex-native MCP-notification → `MessageQueue2` path, verified between-turns, with the filesystem mailbox store unchanged and crews review-mail still functional.
3. Crews' Layer B (review-mail cursor monotonicity, Stop/PreToolUse gates, operator channel, crash-sweep) passes its existing tests unchanged after the port.
4. A measured before/after of hook/listener pressure for the ported workflow, plus an incident attribution (≥ last ~20 crews crash incidents bisected: fraction in spawn/wt.exe paths vs. mailbox/manifest lock paths `hooks/actors.js:1470-1474,1536-1542`).
5. A committed markdown verdict doc stating PARTIAL-REDUCTION-ONLY with the three gating blockers for full replacement (Windows app-server session lifecycle; durable cross-session mailbox surviving daemon restart; operator review-gate product) and the concrete primitive whose shipping would flip the verdict to GO.
6. No regression: cross-engine fan-out (copilot/claude lenses) still works for non-ported sites.

## Context

### Brainstorm synthesis highlights (3-lens convergence: codex + copilot + devils-advocate)

- **Verdict (unanimous): PARTIAL-REDUCTION-ONLY.** Full codex-native replacement is NOT-YET feasible. Codex lens: "PARTIAL now, NOT-YET for retiring crews entirely." Copilot lens: "NOT-YET for full replacement." Devil's Advocate: "NO-GO on full; SHRINK is the honest answer," `red_flag: true`.
- **The reframe:** crews is two welded layers. Layer A (in-session fan-out) maps cleanly onto codex multi-agent v2 / `spawn_top_level_session.rs` / async injection. Layer B (durable cross-session mailbox + cursor/history + review-mail gates + operator channel + crash-sweep) has NO codex-native equivalent. "Retire crews entirely" = reimplement Layer B from scratch.
- **Decisive disconfirming evidence:** the fork's own canonical design doc `plans/durable-mailbox-channel-wake.md:23,47-52` already rejected codex-native crews storage (loss of cursor, audit, crash-recovery — the v2 mailbox "cannot survive a daemon restart" — and cross-machine fan-out) and keeps crews' filesystem mailbox, swapping ONLY the wake to codex-native. `packages/happy-cli/src/agentComms/` is already a partial TS rebuild of Layer B — fragility relocated, not removed.
- **Codex-native seams that DO exist:** `core/src/tools/handlers/spawn_top_level_session.rs:29-171` (`SpawnTopLevelSessionHandler` spawns a top-level Happy session via the local Happy daemon, `HAPPY_DAEMON_CONTROL_URL`) + `spec_plan.rs:718-724`; multi-agent v2 (`multi_agents_v2/spawn.rs` — but root-only depth-1, session-bounded, `core/src/config/mod.rs:188-196`, `core/src/session/mod.rs:1690-1758`); MCP-notif wake.

### Disconfirming observations to carry into plan + impl

- If profiling shows >50% of crews incidents originate in mailbox/manifest LOCK paths (`hooks/actors.js:1470-1474,1536-1542`) rather than spawn/`wt.exe` paths, then shrinking the fan-out layer does NOT fix the dominant failure mode — the plan must pivot toward D-003 (point-fix the lock/listener hot spots) instead.
- If the operator's real pain is the hook-heavy Node surface (PreToolUse/Stop firing on every tool call), shrinking still leaves Layer B as Node hooks, so the felt fragility may not drop — surface this to the operator before committing impl.

### Open questions for the operator (gate the cross-engine + scope decisions)

1. Primary pain source: (a) tab/process spawning, (b) lock contention / EPERM races, or (c) the hook-heavy Node surface? Each implies a different fix; only (c) motivates full replacement.
2. Will copilot/claude brainstorm/plan lenses be retired? If not, full codex-only replacement is off the table (it deletes model diversity this brainstorm depends on, `brainstorm-with-ralph SKILL.md:113-161`).
3. Is app-server thread-level isolation (one daemon, N threads) acceptable, or must separate OS/top-level sessions be preserved for fault isolation + per-tab operator attach?

### Conflict surface

- **codex submodule:** `core/src/tools/handlers/spawn_top_level_session.rs`, `core/src/tools/handlers/multi_agents_v2/`, `core/src/tasks/mod.rs`, `app-server/src/request_processors/`, `app-server-protocol/src/protocol/v2/`. Overlay `codex/codex-rs-overlay/`.
- **codexu / happy-cli:** `packages/happy-cli/src/codex/` (app-server lifecycle + MCP-notif wake) and `packages/happy-cli/src/agentComms/` (do NOT extend into a crews replacement here).
- **crews plugin:** shrinks (fan-out removed) but Layer B retained.
- **ralph plugin:** the fan-out call site(s) that move to codex v2.
