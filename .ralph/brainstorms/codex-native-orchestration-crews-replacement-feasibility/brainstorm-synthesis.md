Lenses: ran=[codex, copilot, devils-advocate]; skipped=[] (full mode)

# Brainstorm synthesis v3 (D-005): FULLY-hook-free crews via daemon-owned files + mail INJECTION

> **Round 3.** Round 2 (@00e52a13) concluded GO-on-locks / NO on hooks because the codex Stop hook is the ONLY seam to HARD-block a member turn-end until review-mail. The OPERATOR OVERRODE that: do NOT veto turn-end — INJECT mail into the member's conversation; it reads it as a turn. This round designs+feasibility-checks FULLY hook-free and grounds both sides in source.

## Headline verdict: PARTIAL — GO on eliminating every crews HOOK, but ONLY after rehosting members inside happy-cli (the ferry survives as in-process plumbing, not a hook)

All three lenses converge: dropping the LOCKS is GO (substrate ~80% shipped), and dropping the review-VETO is now operator-sanctioned. But "zero hooks" hinges on one load-bearing fact: **crews codex members today spawn as NATIVE `codex` CLI tabs (`crews/hooks/actors.js::buildLauncherCommand` codex branch `& codex …`) with `.codex-plugin` Node hooks, NOT inside happy-cli `runCodex`.** The injection seam everyone cites (`mcpNotificationConsumer.ts → MessageQueue2`) belongs to happy-cli's OWN foreground codex app-server client (`runCodex.ts:309-323,1006-1009`). So "push-inject mail" cannot reach a crews member until every member is **rehosted** inside happy-cli runCodex. Once rehosted, mail-ferry + output-parse become in-process TS, ALL crews Node hooks vanish, and the override holds. The residual is the per-member `mcpNotificationConsumer` ferry — plumbing, lifecycle-bound, fail-soft, NOT a turn-veto hook. Zero crews hooks = GO conditional on rehost; literal "zero ferries" = impossible.

## The decisive source correction (devil's advocate, source-grounded)

| Optimistic premise | Source-grounded correction |
|---|---|
| "inject mail into each codex member's conversation" (push reaches them) | The push targets `MessageQueue2` inside happy-cli `runCodex` (`mcpNotificationConsumer.ts:96-100`, `runCodex.ts:1006-1009`). Crews members are NATIVE `codex` tabs (`actors.js buildLauncherCommand`; AGENTS.md "codex members spawned as native codex CLI tabs with .codex-plugin hooks") — NO MessageQueue2. **Injection presumes a substrate members don't run inside.** Rehost is a precondition, not free. |
| "no hook needed — inject = read as turn" | The ferry that turns daemon mail → codex stdin IS code co-resident with the member, lifecycle-bound, fail-soft — a ferry, not a veto. Different mechanism, not literally zero. |
| Stop hook only enforces review-veto | Stop ALSO parses member OUTPUT: kind-tag (`progress-bg-gate-codex.test.js`), body-canonical, identity/takeover, crash-sweep. A daemon never sees member output, so injecting mail can't replace these UNLESS the daemon ingests the member output stream (happy-cli runCodex already does → rehost re-enables them server-side, no veto needed). |

## Q1 — Injection reach (rehosted only)
RUNNING: drains at next turn boundary (`runCodex.ts:1009`), between-turns not mid-turn (`durable-mailbox-channel-wake.md:66`). IDLE: woken via `MessageQueue2` + codex-core `maybe_start_turn_for_pending_work` (`tasks/mod.rs:589-616`). OFFLINE: `recoverPendingAgentCommsMessages` re-reads inbox, one wake (`recovery.ts:50-60`). All hold only inside happy-cli runCodex.

## Q2 — Hooks dropped vs residual (aim ZERO crews hooks)
Droppable: PreToolUse arm/lock/`.crews` write-guard, PostToolUse nag, Stop review-veto. Replaced daemon-side via stream-parse: kind-tag, body-canonical, identity/takeover, crash-sweep. Residual ferries (non-zero): per-member `mcpNotificationConsumer`, daemon wake emitter, restart recovery — no veto. Crews Node hooks = ZERO; ferries ≠ 0.

## Q3 — Lost hard-block: nothing critical silently breaks if parse-enforcement moves daemon-side; operator accepts soft. ## Q4 — Locks: GO only single-ACCESSOR (consume+cursor into daemon; rehosted = pure-IPC kills reader-rename EPERM `pre-tool-use.js:583`). ## Q5 — SPOF: daemon death drops ALL members at once; Windows lifecycle landmines; rehost is the big lift.

## Directions
### D-001 (RECOMMENDED): rehost members into happy-cli runCodex; daemon owns files; inject mail; daemon stream-parses output; ZERO crews Node hooks. Lenses [codex,copilot,devils-advocate]. Only path that truly zeroes crews hooks AND honors override; ~80% substrate. Risk: rehost lift, ferry survives, SPOF, soft gate.
### D-002: native tabs stay; daemon owns files; ONE thin ferry-bridge replaces 4 hooks. PARTIAL — fewer not zero. Cheapest if rehost too costly.
### D-003: point-fix locks + advisory gate, no daemon, keep hooks. Smallest; fails zero-hook goal.

## Open questions: (1) rehost into runCodex acceptable? (2) is in-process ferry "hook-free" enough? (3) SPOF+soft-gate acceptable?
