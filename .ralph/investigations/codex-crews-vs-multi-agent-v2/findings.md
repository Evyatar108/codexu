# Crews plugin vs codex multi-agents v2

## Answer for the operator

Crews and codex multi-agents v2 are **complementary, not substitutes**. Codex v2 is a native in-session sub-agent system inside one codex run: it is `Feature::MultiAgentV2`, default-off, and when enabled the tool planner swaps the model-facing multi-agent surface from v1 to the v2 tool set. `codex/external/repos/codex-patched/codex-rs/features/src/lib.rs:949-958`; `codex/external/repos/codex-patched/codex-rs/core/src/tools/spec_plan.rs:291-297,635-721` Crews is a higher-layer orchestration system: it spawns full CLI sessions in separate Windows Terminal tabs / OS processes, persists manifests and mailboxes on disk, and coordinates those sessions through hook-enforced listener, Stop, and review-mail gates. `ai-developer-toolkit/plugins/crews/hooks/actors.js:2627-2937`; `ai-developer-toolkit/plugins/crews/lib/listener-loop.js:277-305,444-487`; `ai-developer-toolkit/plugins/crews/hooks/mailbox.js:441-497,638-726`; `ai-developer-toolkit/plugins/crews/hooks/pre-tool-use.js:583-625`; `ai-developer-toolkit/plugins/crews/hooks/stop.js:931-942` So yes, there is still a reason to use crews even if v2 is enabled: crews gives you cross-session durability, cross-engine orchestration, durable mail/review state, and operator-in-the-loop control that v2 does not try to provide. `ai-developer-toolkit/plugins/crews/hooks/actors.js:2633-2644,2749-2789`; `ai-developer-toolkit/plugins/crews/AGENTS.md:1921-1956`; `ai-developer-toolkit/plugins/crews/docs/protocol.md:3-35,100-110` The inverse is also true: if your problem is only "fan out work *inside this codex session right now*," v2 is the more direct tool because it is native and task-path-aware. `codex/external/repos/codex-patched/codex-rs/core/src/tools/handlers/multi_agents_spec.rs:75-109,149-205,245-314`; `codex/external/repos/codex-patched/codex-rs/core/src/agent/agent_resolver.rs:7-29` Feature::Collab (v1) and Feature::MultiAgentV2 are independently defined, but in a v2-enabled session Codex installs the v2 tool surface instead of the v1 surface, so both flags may be on while the usable model-facing surface is effectively v2 for that session. `codex/external/repos/codex-patched/codex-rs/features/src/lib.rs:949-958`; `codex/external/repos/codex-patched/codex-rs/core/src/tools/spec_plan.rs:291-297,635-721` Finally, our fork's `spawn_agent` handler for v2 is additionally blocked from **subagent sessions**, which narrows nested in-session fan-out; crews is unaffected because it orchestrates separate top-level sessions rather than codex subagents. `codex/external/repos/codex-patched/codex-rs/core/src/tools/handlers/multi_agents_v2/spawn.rs:57-63`; `ai-developer-toolkit/plugins/crews/hooks/actors.js:2910-2937`

## Quick comparison

| Axis | crews plugin | codex multi-agents v2 | Practical conclusion |
| --- | --- | --- | --- |
| Scope | Cross-engine orchestration: launcher chooses Claude/Copilot/Codex and stamps engine-specific env/session state. `ai-developer-toolkit/plugins/crews/hooks/actors.js:2633-2644,2749-2789` | Codex-only feature inside codex core. `codex/external/repos/codex-patched/codex-rs/features/src/lib.rs:949-958` | v2 does not replace crews when you need non-codex members or mixed-engine crews. |
| Session/process model | Spawns full CLI sessions in separate wt.exe tabs / pwsh processes. `ai-developer-toolkit/plugins/crews/hooks/actors.js:2711-2890,2910-2937` | Native sub-agents inside one codex session/thread tree. `codex/external/repos/codex-patched/codex-rs/core/src/tools/handlers/multi_agents_v2/spawn.rs:47-90`; `codex/external/repos/codex-patched/codex-rs/core/src/session/mod.rs:1690-1758` | Different layers: crews = inter-session orchestration, v2 = intra-session fan-out. |
| Addressing | Actor names, crew names, manifests, mailbox ids, review cursors. `ai-developer-toolkit/plugins/crews/hooks/mailbox.js:441-497,638-726`; `ai-developer-toolkit/plugins/crews/docs/protocol.md:100-110` | Canonical task-path / thread-tree addressing (`task_name`, `path_prefix`, resolver). `codex/external/repos/codex-patched/codex-rs/core/src/tools/handlers/multi_agents_spec.rs:75-109,257-276`; `codex/external/repos/codex-patched/codex-rs/core/src/agent/agent_resolver.rs:7-29` | v2 is cleaner for in-session tree routing; crews is built around durable actors and mailboxes. |
| Persistence | Durable on-disk manifests, mailbox, mailbox-history, review cursors. `ai-developer-toolkit/plugins/crews/hooks/mailbox.js:441-497,638-726`; `ai-developer-toolkit/plugins/crews/hooks/actors.js:2659-2672` | Session-bounded state in codex Session/AgentControl; no separate cross-session crew state layer. `codex/external/repos/codex-patched/codex-rs/core/src/tools/handlers/multi_agents_v2/spawn.rs:47-90`; `codex/external/repos/codex-patched/codex-rs/core/src/session/mod.rs:1690-1758` | Use crews when recovery/resume/auditability matter across turns and sessions. |
| Coordination protocol | `<|report ...|>` rows, review-mail, Strict-ACK, listener gates. `ai-developer-toolkit/plugins/crews/docs/protocol.md:3-35,100-110`; `ai-developer-toolkit/plugins/crews/hooks/pre-tool-use.js:583-625`; `ai-developer-toolkit/plugins/crews/hooks/stop.js:931-942` | Native tools (`spawn_agent`, `send_message`, `followup_task`, `wait_agent`, `close_agent`, `list_agents`). `codex/external/repos/codex-patched/codex-rs/core/src/tools/spec_plan.rs:635-721`; `codex/external/repos/codex-patched/codex-rs/core/src/tools/handlers/multi_agents_spec.rs:149-205,245-314` | crews is a durable mailbox/review protocol; v2 is a direct tool API. |
| Human oversight | Explicit operator channel (`operator-direct`, `operator-direct-summary`, `escalate-to-operator`). `ai-developer-toolkit/plugins/crews/AGENTS.md:1921-1956`; `ai-developer-toolkit/plugins/crews/hooks/protocol/envelope.js:78-99`; `ai-developer-toolkit/plugins/crews/hooks/commands/registry.js:22-29` | None built in; it is a model/tool runtime, not a human-approval workflow. | crews still matters whenever the operator/lead must supervise work. |
| Coexistence with v1 | Not applicable. | v1 and v2 flags both exist, but `add_collaboration_tools()` installs v2 instead of v1 when v2 is enabled. `codex/external/repos/codex-patched/codex-rs/features/src/lib.rs:949-958`; `codex/external/repos/codex-patched/codex-rs/core/src/tools/spec_plan.rs:291-297,635-721` | Enabling v2 does not delete v1 code, but it does replace the exposed tool surface in that session. |
| Nested fan-out | Separate sessions, so no codex subagent restriction applies. `ai-developer-toolkit/plugins/crews/hooks/actors.js:2910-2937` | Fork-local subagent gate: `spawn_agent` is unavailable from subagent sessions. `codex/external/repos/codex-patched/codex-rs/core/src/tools/handlers/multi_agents_v2/spawn.rs:57-63` | In this fork, v2 is weaker than "arbitrary recursive subagents"; crews avoids that limit. |

## 1. What crews actually provides

Crews is an **orchestration and durable coordination layer** around full CLI sessions, not a thin wrapper over codex's internal sub-agent APIs.

1. **Cross-engine lead/member orchestration.** `spawnMember()` detects or is given an engine, writes a member manifest, stamps crews env vars, scrubs foreign engine identity vars, and launches a new engine-specific session. `session-start.js` then binds the incoming session to the crew actor from env/bootstrap state. `ai-developer-toolkit/plugins/crews/hooks/actors.js:2633-2644,2659-2672,2729-2789`; `ai-developer-toolkit/plugins/crews/hooks/session-start.js:75-178`
2. **Cross-session / cross-process execution.** Members are not lightweight in-process children; they are real OS processes in separate wt.exe tabs, with launcher scripts, listener state, and their own session ids. `ai-developer-toolkit/plugins/crews/hooks/actors.js:2711-2890,2910-2937`
3. **Persistent mailboxes and review protocol.** Mail is written to durable mailbox JSON, drained into `mailbox-history`, and review-required envelopes bump durable cursors such as `lastReviewRequiredSeq`. The turn-end protocol is the `<|report ...|>` footer, one durable outbox row per kind-bearing report, with Strict-ACK / reply / decision resolution. `ai-developer-toolkit/plugins/crews/hooks/mailbox.js:441-497,638-726`; `ai-developer-toolkit/plugins/crews/docs/protocol.md:3-35,100-110`
4. **Hook-enforced liveness and review gates.** The listener loop claims the listener, heartbeats it, drains mailbox messages, and emits `messages` / `timeout` / `arm-skipped` envelopes. PreToolUse blocks non-review work until the listener/review state is healthy, and Stop blocks unresolved review-required state at turn end. `ai-developer-toolkit/plugins/crews/lib/listener-loop.js:241-305,359-505`; `ai-developer-toolkit/plugins/crews/hooks/pre-tool-use.js:583-625`; `ai-developer-toolkit/plugins/crews/hooks/stop.js:931-942`
5. **Human operator channel.** Crews has an explicit operator role and envelope family (`operator-direct`, `operator-direct-summary`, `escalate-to-operator`) plus dedicated CLI/lead command surfaces, which is exactly the "lead relays operator decisions" layer the operator described. `ai-developer-toolkit/plugins/crews/AGENTS.md:1921-1956`; `ai-developer-toolkit/plugins/crews/hooks/protocol/envelope.js:78-99`; `ai-developer-toolkit/plugins/crews/hooks/commands/registry.js:22-29`

## 2. What codex multi-agents v2 actually provides

Multi-agents v2 is a **native codex sub-agent API inside one codex session**.

1. **Feature flag + rollout status.** It is separately defined as `Feature::MultiAgentV2`, keyed by `multi_agent_v2`, marked `Stage::UnderDevelopment`, default-off; v1 remains `Feature::Collab`, keyed by `multi_agent`, stable, default-on. `codex/external/repos/codex-patched/codex-rs/features/src/lib.rs:127-130,949-958`
2. **Model-facing tool surface.** When v2 is enabled, tool planning installs `spawn_agent`, `send_message`, `followup_task`, `wait_agent`, `close_agent`, and `list_agents`; otherwise it installs the v1 set (`spawn_agent`, `send_input`, `resume_agent`, `wait_agent`, `close_agent`). `codex/external/repos/codex-patched/codex-rs/core/src/tools/spec_plan.rs:291-297,635-721`
3. **Task-path/mailbox routing instead of v1's id-centric surface.** The spec moves v1's namespaced `multi_agent_v1` API toward direct tools with `task_name`, `target`, and `path_prefix` semantics, and `resolve_agent_target()` resolves thread ids or canonical/relative task-path references against the current agent tree. `codex/external/repos/codex-patched/codex-rs/core/src/tools/handlers/multi_agents_spec.rs:11-12,75-109,149-205,245-314`; `codex/external/repos/codex-patched/codex-rs/core/src/agent/agent_resolver.rs:7-29`
4. **In-session delivery/completion plumbing.** The v2 spawn handler creates a child agent inside codex core and uses `InterAgentCommunication`; terminal child completion is forwarded back to the parent from within the same `Session`. `codex/external/repos/codex-patched/codex-rs/core/src/tools/handlers/multi_agents_v2/spawn.rs:47-90,253-313`; `codex/external/repos/codex-patched/codex-rs/core/src/session/mod.rs:1690-1758`
5. **Fork-local limitation.** Our fork adds a subagent-session gate: `spawn_agent` returns `"spawn_agent is not available from subagent sessions"` if called from a subagent session. `codex/external/repos/codex-patched/codex-rs/core/src/tools/handlers/multi_agents_v2/spawn.rs:57-63`

## 3. Substitute or complementary?

They are **complementary** because they solve different orchestration problems.

### Where they overlap

Both can fan work out to multiple agents and both provide a way to send follow-up work and wait for outcomes. `ai-developer-toolkit/plugins/crews/docs/protocol.md:100-110`; `codex/external/repos/codex-patched/codex-rs/core/src/tools/spec_plan.rs:635-721`

### Where they differ materially

1. **Engine scope**
   - **crews:** cross-engine (`claude`, `copilot`, `codex`). `ai-developer-toolkit/plugins/crews/hooks/actors.js:2633-2644,2749-2789`
   - **v2:** codex-only.

2. **Session/process scope**
   - **crews:** cross-session and cross-process; every member is a separate session/process/tab. `ai-developer-toolkit/plugins/crews/hooks/actors.js:2711-2890,2910-2937`
   - **v2:** intra-session, inside one codex run/session tree. `codex/external/repos/codex-patched/codex-rs/core/src/tools/handlers/multi_agents_v2/spawn.rs:47-90`; `codex/external/repos/codex-patched/codex-rs/core/src/session/mod.rs:1690-1758`

3. **Persistence**
   - **crews:** durable manifests, mailboxes, mailbox-history, review cursors, operator escalations. `ai-developer-toolkit/plugins/crews/hooks/actors.js:2659-2672`; `ai-developer-toolkit/plugins/crews/hooks/mailbox.js:441-497,638-726`; `ai-developer-toolkit/plugins/crews/AGENTS.md:1957-1963`
   - **v2:** no separate crew-state/audit layer; it is codex runtime state.

4. **Human oversight**
   - **crews:** operator/lead are first-class. `ai-developer-toolkit/plugins/crews/AGENTS.md:1921-1956`
   - **v2:** no equivalent human-in-the-loop review/mailbox protocol.

5. **Recursive depth**
   - **crews:** spawns another top-level session whenever needed.
   - **v2:** in this fork, `spawn_agent` is blocked from subagent sessions. `codex/external/repos/codex-patched/codex-rs/core/src/tools/handlers/multi_agents_v2/spawn.rs:57-63`

### Conclusion

Enabling v2 **does not obviate crews for codex**. It obviates only the narrow need to build a *custom in-session fan-out mechanism* on top of codex when codex itself can already do it. Crews still serves a distinct layer: **inter-session, cross-engine, operator-supervised, durable orchestration**.

## 4. Is there still a reason to use crews if v2 is enabled?

**Yes.**

Use **crews** when you need any of the following:

- **Cross-engine orchestration** (for example, codex + Copilot + Claude in one workflow). `ai-developer-toolkit/plugins/crews/hooks/actors.js:2633-2644,2749-2789`
- **Durable session boundaries** with resumable actors, mailboxes, and review cursors. `ai-developer-toolkit/plugins/crews/hooks/mailbox.js:638-726`; `ai-developer-toolkit/plugins/crews/hooks/actors.js:1299-1385`
- **Operator/lead supervision** and explicit human routing/escalation. `ai-developer-toolkit/plugins/crews/AGENTS.md:1921-1956`; `ai-developer-toolkit/plugins/crews/hooks/commands/registry.js:22-29`
- **A real mailbox/review discipline** (`review-mail`, Strict-ACK, `<|report ...|>`). `ai-developer-toolkit/plugins/crews/docs/protocol.md:3-35,100-110`; `ai-developer-toolkit/plugins/crews/hooks/pre-tool-use.js:583-625`; `ai-developer-toolkit/plugins/crews/hooks/stop.js:931-942`
- **An escape from the fork's subagent gate** when nested codex subagent spawning is blocked. `codex/external/repos/codex-patched/codex-rs/core/src/tools/handlers/multi_agents_v2/spawn.rs:57-63`

Use **codex multi-agents v2** when you need:

- **Low-friction native parallelism inside one codex session**
- **Task-path-aware routing** (`task_name`, `path_prefix`, canonical/relative references)
- **Native codex message/follow-up/wait tooling** without opening extra tabs or processes

That is the clean split: **v2 for intra-session fan-out; crews for inter-session orchestration**.

## 5. If v2 is enabled, can we still use v1 agents?

**Mostly no at the model-facing surface of that same session, even though the v1 code still exists.**

What the source shows:

1. `Feature::Collab` and `Feature::MultiAgentV2` are separately defined features, so they are independently gateable. `codex/external/repos/codex-patched/codex-rs/features/src/lib.rs:127-130,949-958`
2. `collab_tools_enabled()` returns true when **either** v2 or v1 is enabled. `codex/external/repos/codex-patched/codex-rs/core/src/tools/spec_plan.rs:291-297`
3. But `add_collaboration_tools()` branches: **if v2 is enabled, install the v2 tools; else install the v1 tools.** `codex/external/repos/codex-patched/codex-rs/core/src/tools/spec_plan.rs:635-721`

So the practical answer is:

- **Both flags can exist together** in config/state.
- **They are not mutually exclusive as feature bits.**
- **But they are effectively mutually exclusive at the exposed tool surface per session** because the planner chooses the v2 tool set whenever `Feature::MultiAgentV2` is on.

The v1 implementation is still present in the tree (`multi_agent_v1` namespace, `send_input`, `resume_agent`, v1 wait/close handlers). `codex/external/repos/codex-patched/codex-rs/core/src/tools/handlers/multi_agents_spec.rs:11-12,46-73,111-147,207-226,278-296,541-581` However, a v2-enabled session does **not** concurrently expose that v1 namespace to the model through the normal planner path. `codex/external/repos/codex-patched/codex-rs/core/src/tools/spec_plan.rs:635-721`

## Bottom line

- **Crews vs v2:** different layers, complementary.
- **Reason to keep crews with v2 enabled:** yes, whenever you need cross-session durability, cross-engine members, or operator-supervised coordination.
- **v1 after enabling v2:** the v1 code still exists, but the normal exposed multi-agent surface becomes v2 for that session.
