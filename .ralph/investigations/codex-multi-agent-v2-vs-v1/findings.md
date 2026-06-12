# Codex multi-agent v2 vs v1

## Summary for the operator

v1 is the stable, default-on "Collab" system: the feature flag is `Feature::Collab`, the config key is `multi_agent`, and the model-facing tools live under the `multi_agent_v1` namespace with an id-centric lifecycle (`spawn_agent` -> `send_input` / `resume_agent` -> `wait_agent` -> `close_agent`). `codex/external/repos/codex-patched/codex-rs/features/src/lib.rs:127-130,949-958`; `codex/external/repos/codex-patched/codex-rs/core/src/tools/handlers/multi_agents_spec.rs:11-12,46-73,111-147,207-243,278-314`

v2 is the task-path/mailbox redesign: it is `Feature::MultiAgentV2`, marked `Stage::UnderDevelopment`, default-off, and it swaps the v1 id-centric surface for direct tools like `spawn_agent`, `send_message`, `followup_task`, `wait_agent`, `close_agent`, and `list_agents`, with canonical task names instead of raw thread ids. `codex/external/repos/codex-patched/codex-rs/features/src/lib.rs:127-130,955-958`; `codex/external/repos/codex-patched/codex-rs/core/src/tools/spec_plan.rs:635-690`; `codex/external/repos/codex-patched/codex-rs/core/src/tools/handlers/multi_agents_spec.rs:75-109,149-205,245-314`

The big practical trade-off is that v2 has a cleaner routing model and richer controls (`task_name`, `fork_turns`, `path_prefix`, session-level concurrency caps), but its downstream UI/protocol surfacing is still partly legacy: app-server/TUI history only has `SpawnAgent`, `SendInput`, `ResumeAgent`, `Wait`, and `CloseAgent`, and interaction events are still flattened to `SendInput`. `codex/external/repos/codex-patched/codex-rs/core/src/agent/agent_resolver.rs:7-29`; `codex/external/repos/codex-patched/codex-rs/core/src/agent/control.rs:863-985`; `codex/external/repos/codex-patched/codex-rs/app-server-protocol/src/protocol/v2/item.rs:920-926`; `codex/external/repos/codex-patched/codex-rs/app-server-protocol/src/protocol/event_mapping.rs:137-178`

That is the clearest source-backed reason v2 is still experimental: the source explicitly says "UnderDevelopment/default off", and the implementation is still in a transition state where the new mailbox/task-path API coexists with legacy event/UI concepts rather than replacing them end-to-end. `codex/external/repos/codex-patched/codex-rs/features/src/lib.rs:955-958`; `codex/external/repos/codex-patched/codex-rs/app-server-protocol/src/protocol/v2/item.rs:920-926`; `codex/external/repos/codex-patched/codex-rs/app-server-protocol/src/protocol/thread_history.rs:666-707`

Fork-wise, v2 is not fork-authored: the v2 surface is wired through the normal upstream feature/spec/agent-control stack, and the visible fork-local delta on the v2 path is the `// SANDBOX PATCH: plugin-scope-axis` gate that blocks `spawn_agent` from subagent sessions. `codex/external/repos/codex-patched/codex-rs/core/src/tools/spec_plan.rs:635-690`; `codex/external/repos/codex-patched/codex-rs/core/src/tools/handlers/multi_agents_v2/spawn.rs:2,57-63`

## Quick comparison

| Area | v1 ("Collab") | v2 ("MultiAgentV2") | Why it matters |
| --- | --- | --- | --- |
| Feature flag / rollout | `Feature::Collab`, key `multi_agent`, `Stage::Stable`, default `true`. `codex/external/repos/codex-patched/codex-rs/features/src/lib.rs:949-953` | `Feature::MultiAgentV2`, key `multi_agent_v2`, `Stage::UnderDevelopment`, default `false`. `codex/external/repos/codex-patched/codex-rs/features/src/lib.rs:955-958` | v1 is the shipped default; v2 is opt-in. |
| Model-facing shape | Namespace `multi_agent_v1` with namespaced tools. `codex/external/repos/codex-patched/codex-rs/core/src/tools/handlers/multi_agents_spec.rs:11-12,46-73,111-147,207-243,278-314` | Plain direct functions by default, optionally re-namespaced via `tool_namespace`. `codex/external/repos/codex-patched/codex-rs/core/src/tools/handlers/multi_agents_v2/spawn.rs:31-37`; `codex/external/repos/codex-patched/codex-rs/core/src/tools/spec_plan.rs:644-690,860-892` | v2 is a cleaner API surface for the model. |
| Spawn identity | Returns `agent_id` + optional nickname. `codex/external/repos/codex-patched/codex-rs/core/src/tools/handlers/multi_agents_spec.rs:347-363`; `codex/external/repos/codex-patched/codex-rs/core/src/tools/handlers/multi_agents/spawn.rs:210-245` | Returns canonical `task_name` (+ optional nickname unless hidden). `codex/external/repos/codex-patched/codex-rs/core/src/tools/handlers/multi_agents_spec.rs:365-395`; `codex/external/repos/codex-patched/codex-rs/core/src/tools/handlers/multi_agents_v2/spawn.rs:230-243,303-313` | v2 routes by task path instead of raw thread id. |
| Follow-up API | `send_input(target, message/items, interrupt)` plus `resume_agent(id)`. `codex/external/repos/codex-patched/codex-rs/core/src/tools/handlers/multi_agents_spec.rs:111-147,207-226`; `codex/external/repos/codex-patched/codex-rs/core/src/tools/handlers/multi_agents/send_input.rs:31-89`; `codex/external/repos/codex-patched/codex-rs/core/src/tools/handlers/multi_agents/resume_agent.rs:28-198` | `send_message(target, message)` and `followup_task(target, message)`; no `resume_agent`; adds `list_agents(path_prefix?)`. `codex/external/repos/codex-patched/codex-rs/core/src/tools/handlers/multi_agents_spec.rs:149-205,257-314`; `codex/external/repos/codex-patched/codex-rs/core/src/tools/handlers/multi_agents_v2/message_tool.rs:33-143`; `codex/external/repos/codex-patched/codex-rs/core/src/tools/handlers/multi_agents_v2/list_agents.rs:18-78` | v2 separates "queue only" vs "wake target" semantics and adds discovery. |
| Wait semantics | Waits on explicit agent ids for final statuses, returning a status map. `codex/external/repos/codex-patched/codex-rs/core/src/tools/handlers/multi_agents/wait.rs:53-185,218-229`; `codex/external/repos/codex-patched/codex-rs/core/src/tools/handlers/multi_agents_spec.rs:229-253,455-471` | Waits on any mailbox change, returning only a summary string + timeout bit. `codex/external/repos/codex-patched/codex-rs/core/src/tools/handlers/multi_agents_v2/wait.rs:43-81,107-159`; `codex/external/repos/codex-patched/codex-rs/core/src/tools/handlers/multi_agents_spec.rs:245-253,474-489` | v1 is more explicit/status-driven; v2 is mailbox/event-driven. |
| Parent/child completion delivery | Non-v2 children get a completion watcher that injects a user message back to the parent. `codex/external/repos/codex-patched/codex-rs/core/src/agent/control.rs:340-353,1000-1067` | MultiAgentV2 children forward terminal completion to the parent via `InterAgentCommunication` on agent paths. `codex/external/repos/codex-patched/codex-rs/core/src/session/mod.rs:1690-1758` | v2 is architected around agent-to-agent messaging, not only thread ids. |

## 1. What the two systems actually are

The operator's naming is directionally right, with one important source-level correction:

- The legacy path is the stable `Feature::Collab` feature (`multi_agent` config key), but the actual tool namespace constant is `multi_agent_v1`, not `multi_agent`. `codex/external/repos/codex-patched/codex-rs/features/src/lib.rs:127-130,949-953`; `codex/external/repos/codex-patched/codex-rs/core/src/tools/handlers/multi_agents_spec.rs:11-12`
- The implementation entrypoint for v1 is `core/src/tools/handlers/multi_agents.rs`, which re-exports `spawn`, `send_input`, `resume_agent`, `wait`, and `close_agent`. `codex/external/repos/codex-patched/codex-rs/core/src/tools/handlers/multi_agents.rs:82-92`
- The new path is `Feature::MultiAgentV2` (`multi_agent_v2` config key), marked `Stage::UnderDevelopment` and default-off. Its implementation entrypoint is `core/src/tools/handlers/multi_agents_v2.rs`, which re-exports `spawn`, `send_message`, `followup_task`, `wait`, `close_agent`, and `list_agents`. `codex/external/repos/codex-patched/codex-rs/features/src/lib.rs:955-958`; `codex/external/repos/codex-patched/codex-rs/core/src/tools/handlers/multi_agents_v2.rs:31-44`
- Tool planning treats v2 as a full replacement surface when enabled: `collab_tools_enabled()` is true if either Collab or MultiAgentV2 is on, and `add_collaboration_tools()` installs the v2 set instead of the v1 set when `multi_agent_v2_enabled()` is true. `codex/external/repos/codex-patched/codex-rs/core/src/tools/spec_plan.rs:291-297,635-721`

## 2. Tool surface diff

### v1 surface

The v1 namespace exposes:

1. `spawn_agent` - namespaced under `multi_agent_v1`; returns `agent_id` + optional nickname. `codex/external/repos/codex-patched/codex-rs/core/src/tools/handlers/multi_agents_spec.rs:46-73,347-363`
2. `send_input` - accepts `target`, `message` or structured `items`, and `interrupt`. `codex/external/repos/codex-patched/codex-rs/core/src/tools/handlers/multi_agents_spec.rs:111-147`; `codex/external/repos/codex-patched/codex-rs/core/src/tools/handlers/multi_agents/send_input.rs:31-47,106-118`
3. `resume_agent` - resume by raw agent id. `codex/external/repos/codex-patched/codex-rs/core/src/tools/handlers/multi_agents_spec.rs:207-226`; `codex/external/repos/codex-patched/codex-rs/core/src/tools/handlers/multi_agents/resume_agent.rs:38-54,178-198`
4. `wait_agent` - waits on one or more explicit targets and returns final statuses keyed by target plus `timed_out`. `codex/external/repos/codex-patched/codex-rs/core/src/tools/handlers/multi_agents_spec.rs:229-243,455-471`; `codex/external/repos/codex-patched/codex-rs/core/src/tools/handlers/multi_agents/wait.rs:53-85,139-185,218-229`
5. `close_agent` - close by raw agent id. `codex/external/repos/codex-patched/codex-rs/core/src/tools/handlers/multi_agents_spec.rs:278-296`; `codex/external/repos/codex-patched/codex-rs/core/src/tools/handlers/multi_agents/close_agent.rs:36-106`

Its spawn input is loose: `message` is optional, `items` are allowed, and the fork mode is a boolean `fork_context`. `codex/external/repos/codex-patched/codex-rs/core/src/tools/handlers/multi_agents/spawn.rs:62-70,229-239`; `codex/external/repos/codex-patched/codex-rs/core/src/tools/handlers/multi_agents_spec.rs:541-581`

### v2 surface

The v2 planner installs:

1. `spawn_agent`
2. `send_message`
3. `followup_task`
4. `wait_agent`
5. `close_agent`
6. `list_agents`

`codex/external/repos/codex-patched/codex-rs/core/src/tools/spec_plan.rs:638-690`

Key schema and behavior differences:

- `spawn_agent` is a direct tool (not the v1 namespace by default), requires `task_name` and `message`, uses `#[serde(deny_unknown_fields)]`, and rejects the old `fork_context` field in favor of `fork_turns`. `codex/external/repos/codex-patched/codex-rs/core/src/tools/handlers/multi_agents_v2/spawn.rs:31-37,64-66,253-299`; `codex/external/repos/codex-patched/codex-rs/core/src/tools/handlers/multi_agents_spec.rs:75-109,584-620`
- `send_message` is text-only and queues work without waking the target turn. `codex/external/repos/codex-patched/codex-rs/core/src/tools/handlers/multi_agents_spec.rs:149-178`; `codex/external/repos/codex-patched/codex-rs/core/src/tools/handlers/multi_agents_v2/message_tool.rs:11-30,58-143`
- `followup_task` is text-only and triggers a target turn (but refuses the root agent). `codex/external/repos/codex-patched/codex-rs/core/src/tools/handlers/multi_agents_spec.rs:180-205`; `codex/external/repos/codex-patched/codex-rs/core/src/tools/handlers/multi_agents_v2/message_tool.rs:41-47,78-87`
- `wait_agent` only accepts `timeout_ms`, subscribes to the mailbox, and deliberately does **not** return final content. `codex/external/repos/codex-patched/codex-rs/core/src/tools/handlers/multi_agents_spec.rs:245-253,474-489`; `codex/external/repos/codex-patched/codex-rs/core/src/tools/handlers/multi_agents_v2/wait.rs:43-81,113-159`
- `close_agent` accepts either an agent id or a canonical task name, via `resolve_agent_target()`, and explicitly refuses closing the root pseudo-agent. `codex/external/repos/codex-patched/codex-rs/core/src/tools/handlers/multi_agents_spec.rs:298-314`; `codex/external/repos/codex-patched/codex-rs/core/src/tools/handlers/multi_agents_v2/close_agent.rs:36-52`
- `list_agents` is new in v2 and lists live agents in the current root thread tree, optionally filtered by task-path prefix. `codex/external/repos/codex-patched/codex-rs/core/src/tools/handlers/multi_agents_spec.rs:257-276,411-440`; `codex/external/repos/codex-patched/codex-rs/core/src/tools/handlers/multi_agents_v2/list_agents.rs:28-41,51-78`

## 3. Behavioral / architectural differences

### Identity and routing

- v1 primarily routes by thread id. `parse_agent_id_target()` parses ids, `send_input`/`close_agent`/`resume_agent` all take ids, and `wait_agent` takes `targets: Vec<String>` that are parsed into thread ids. `codex/external/repos/codex-patched/codex-rs/core/src/tools/handlers/multi_agents.rs:47-65`; `codex/external/repos/codex-patched/codex-rs/core/src/tools/handlers/multi_agents/send_input.rs:31-33`; `codex/external/repos/codex-patched/codex-rs/core/src/tools/handlers/multi_agents/close_agent.rs:36-38`; `codex/external/repos/codex-patched/codex-rs/core/src/tools/handlers/multi_agents/wait.rs:51-55`
- v2 primarily routes by canonical task path. `resolve_agent_target()` first accepts a thread id, but otherwise resolves relative/canonical task-path references against the current agent path; `list_agents()` is also path-prefix-based. `codex/external/repos/codex-patched/codex-rs/core/src/agent/agent_resolver.rs:7-29`; `codex/external/repos/codex-patched/codex-rs/core/src/agent/control.rs:863-985`

### Spawn lifecycle

- v1 spawn is "spawn a thread, optionally fork all context, return agent id". It computes child depth, enforces the max-depth guard, and passes `task_name: None` into `thread_spawn_source()`. `codex/external/repos/codex-patched/codex-rs/core/src/tools/handlers/multi_agents/spawn.rs:69-77,123-137`
- v2 spawn is "spawn a canonical task node". It computes child depth, attaches `task_name` into `thread_spawn_source()`, supports `fork_turns = none | all | N`, and if the initial operation is plain text it converts it into `InterAgentCommunication` tagged with sender/recipient agent paths. `codex/external/repos/codex-patched/codex-rs/core/src/tools/handlers/multi_agents_v2/spawn.rs:73-75,122-158,253-299`

### Waiting and result delivery

- v1 `wait_agent` subscribes to each target's status channel and returns final statuses directly in tool output. `codex/external/repos/codex-patched/codex-rs/core/src/tools/handlers/multi_agents/wait.rs:101-185,225-229`
- v2 `wait_agent` subscribes to the session mailbox and only reports whether a mailbox update arrived before the deadline. `codex/external/repos/codex-patched/codex-rs/core/src/tools/handlers/multi_agents_v2/wait.rs:63-81,113-129`
- On the control/session side, non-v2 children get a completion watcher that pushes a synthesized user message to the parent; MultiAgentV2 children forward completion via `InterAgentCommunication` from child path to parent path. `codex/external/repos/codex-patched/codex-rs/core/src/agent/control.rs:340-353,1028-1058`; `codex/external/repos/codex-patched/codex-rs/core/src/session/mod.rs:1690-1758`

### Concurrency and limits

- v1 hard-checks depth in the spawn/resume handlers (`exceeds_thread_spawn_depth_limit(child_depth, max_depth)`). `codex/external/repos/codex-patched/codex-rs/core/src/tools/handlers/multi_agents/spawn.rs:72-77`; `codex/external/repos/codex-patched/codex-rs/core/src/tools/handlers/multi_agents/resume_agent.rs:48-53`
- v2 introduces a session-level `max_concurrent_threads_per_session` config, and enabling v2 forbids the old `agents.max_threads` knob. `codex/external/repos/codex-patched/codex-rs/features/src/feature_configs.rs:13-38`; `codex/external/repos/codex-patched/codex-rs/core/src/config/mod.rs:1001-1030,3090-3101`
- The v2 tool description explicitly says spawned agents can spawn their own subagents, but this fork's `spawn_agent` handler blocks subagent sessions via a SANDBOX PATCH, so recursive spawning is not available in this fork even though the upstream-oriented API shape was designed for it. `codex/external/repos/codex-patched/codex-rs/core/src/tools/handlers/multi_agents_spec.rs:717-723`; `codex/external/repos/codex-patched/codex-rs/core/src/tools/handlers/multi_agents_v2/spawn.rs:57-63`

### Turn-loop / TUI integration

- Tool planning fully switches from the v1 set to the v2 set when `Feature::MultiAgentV2` is enabled. `codex/external/repos/codex-patched/codex-rs/core/src/tools/spec_plan.rs:635-721`
- But the app-server/TUI protocol model still only has `SpawnAgent`, `SendInput`, `ResumeAgent`, `Wait`, and `CloseAgent`; there are no distinct `SendMessage`, `FollowupTask`, or `ListAgents` enum variants. `codex/external/repos/codex-patched/codex-rs/app-server-protocol/src/protocol/v2/item.rs:920-926`
- Correspondingly, interaction begin/end events still map to `CollabAgentTool::SendInput` in the app-server protocol and thread history layers. `codex/external/repos/codex-patched/codex-rs/app-server-protocol/src/protocol/event_mapping.rs:137-178`; `codex/external/repos/codex-patched/codex-rs/app-server-protocol/src/protocol/thread_history.rs:666-707`

That "new control plane, legacy presentation model" split is one of the clearest architectural signs that v2 is still mid-transition.

## 4. Pros / cons of each

### v1 pros

- Stable and default-on. `codex/external/repos/codex-patched/codex-rs/features/src/lib.rs:949-953`
- Mature end-to-end UI/protocol surfacing: the app-server/TUI tool enum and history mapping directly model the v1 verbs. `codex/external/repos/codex-patched/codex-rs/app-server-protocol/src/protocol/v2/item.rs:920-926`; `codex/external/repos/codex-patched/codex-rs/tui/src/multi_agents.rs:216-271`
- More explicit wait semantics: callers can wait on concrete targets and get final statuses back immediately. `codex/external/repos/codex-patched/codex-rs/core/src/tools/handlers/multi_agents/wait.rs:171-201,225-229`

### v1 cons

- Id-centric and more awkward for tree-relative coordination; most follow-up operations require raw agent ids rather than relative task references. `codex/external/repos/codex-patched/codex-rs/core/src/tools/handlers/multi_agents/send_input.rs:106-113`; `codex/external/repos/codex-patched/codex-rs/core/src/tools/handlers/multi_agents/close_agent.rs:145-148`
- Surface is less decomposed: message delivery, interruption, and wake-up semantics are multiplexed through `send_input(interrupt=...)` instead of distinct tools. `codex/external/repos/codex-patched/codex-rs/core/src/tools/handlers/multi_agents_spec.rs:126-130,138-144`
- Resume/close/wait all stay tightly coupled to thread ids, which is the API shape v2 is trying to replace. `codex/external/repos/codex-patched/codex-rs/core/src/tools/handlers/multi_agents_spec.rs:207-243,278-314`

### v2 pros

- Cleaner routing model: canonical task paths, relative references, and `path_prefix` filtering make agent trees easier to address. `codex/external/repos/codex-patched/codex-rs/core/src/agent/agent_resolver.rs:7-29`; `codex/external/repos/codex-patched/codex-rs/core/src/agent/control.rs:916-985`
- Cleaner tool decomposition: `send_message` vs `followup_task` encodes queue-only vs trigger-turn semantics directly in the API. `codex/external/repos/codex-patched/codex-rs/core/src/tools/handlers/multi_agents_v2/message_tool.rs:11-30,58-143`
- More flexible forking and session controls: `fork_turns`, configurable wait bounds, `tool_namespace`, `hide_spawn_agent_metadata`, and session-level thread caps. `codex/external/repos/codex-patched/codex-rs/features/src/feature_configs.rs:9-39`; `codex/external/repos/codex-patched/codex-rs/core/src/config/mod.rs:1001-1030,3078-3101`

### v2 cons

- Not the default and explicitly marked under development. `codex/external/repos/codex-patched/codex-rs/features/src/lib.rs:955-958`
- Downstream surfacing is incomplete/legacy-biased: the app-server/TUI enum still has only the old verb set, so v2 interactions are flattened into `SendInput`, and `list_agents` has no dedicated history/tool enum variant. `codex/external/repos/codex-patched/codex-rs/app-server-protocol/src/protocol/v2/item.rs:920-926`; `codex/external/repos/codex-patched/codex-rs/app-server-protocol/src/protocol/event_mapping.rs:137-178`
- v2 wait is less informative at the tool boundary: it reports mailbox updates rather than returning final agent statuses/content directly. `codex/external/repos/codex-patched/codex-rs/core/src/tools/handlers/multi_agents_spec.rs:245-253,474-489`; `codex/external/repos/codex-patched/codex-rs/core/src/tools/handlers/multi_agents_v2/wait.rs:119-129`

## 5. Why v2 is still experimental

This is the crux, and the source gives three concrete reasons.

### A. The source literally marks it experimental

`Feature::MultiAgentV2` is defined with `stage: Stage::UnderDevelopment` and `default_enabled: false`, whereas `Feature::Collab` is `Stage::Stable` and `default_enabled: true`. That is the strongest direct evidence. `codex/external/repos/codex-patched/codex-rs/features/src/lib.rs:949-958`

### B. The new API has not fully propagated through the UI/protocol model

Even with the new v2 tool set, the app-server/TUI thread item enum still exposes only `SpawnAgent`, `SendInput`, `ResumeAgent`, `Wait`, and `CloseAgent`. There are no first-class `SendMessage`, `FollowupTask`, or `ListAgents` variants, and interaction events are still projected as `SendInput`. That means the backend surface has evolved farther than the presentation/history surface. `codex/external/repos/codex-patched/codex-rs/app-server-protocol/src/protocol/v2/item.rs:920-926`; `codex/external/repos/codex-patched/codex-rs/app-server-protocol/src/protocol/event_mapping.rs:137-178`; `codex/external/repos/codex-patched/codex-rs/app-server-protocol/src/protocol/thread_history.rs:666-707`

### C. The behavior/config surface is still actively moving

MultiAgentV2 adds a dedicated config object with many knobs (`max_concurrent_threads_per_session`, wait bounds, usage-hint text, optional namespace override, metadata hiding, non-code-mode exposure), and the config validator has special-case logic that forbids the old `agents.max_threads` setting when v2 is enabled. That is consistent with a surface that is still being tuned rather than a frozen stable contract. `codex/external/repos/codex-patched/codex-rs/features/src/feature_configs.rs:9-39`; `codex/external/repos/codex-patched/codex-rs/core/src/config/mod.rs:1001-1030,3078-3101`

### D. In this fork, the upstream-oriented recursion story is intentionally curtailed

The v2 description says spawned agents can spawn their own subagents, but the fork's SANDBOX PATCH blocks `spawn_agent` from subagent sessions. That does not make upstream v2 "fake", but it does mean the most ambitious part of the v2 design is not actually available in this fork right now. `codex/external/repos/codex-patched/codex-rs/core/src/tools/handlers/multi_agents_spec.rs:717-723`; `codex/external/repos/codex-patched/codex-rs/core/src/tools/handlers/multi_agents_v2/spawn.rs:57-63`

## 6. Fork vs upstream

The v2 system is upstream-native, not fork-authored:

- The feature flag lives in the normal upstream feature table (`Feature::MultiAgentV2`). `codex/external/repos/codex-patched/codex-rs/features/src/lib.rs:955-958`
- The planner wires v2 through the normal collaboration-tool registration path. `codex/external/repos/codex-patched/codex-rs/core/src/tools/spec_plan.rs:635-690`
- The core implementation lives in ordinary upstream modules: `multi_agents_v2.rs`, `multi_agents_spec.rs`, `agent/control.rs`, `session/mod.rs`, `agent_resolver.rs`. `codex/external/repos/codex-patched/codex-rs/core/src/tools/handlers/multi_agents_v2.rs:31-44`; `codex/external/repos/codex-patched/codex-rs/core/src/agent/agent_resolver.rs:7-29`

The visible fork-local delta on the v2 path is the `// SANDBOX PATCH: plugin-scope-axis` guard in `multi_agents_v2/spawn.rs`, which rejects `spawn_agent` when the current session source is already a subagent. I also found a related fork-local plugin-scope-axis comment in `spec_plan.rs`, but the v2 behavior difference itself is the spawn-time subagent gate. `codex/external/repos/codex-patched/codex-rs/core/src/tools/handlers/multi_agents_v2/spawn.rs:2,57-63`; `codex/external/repos/codex-patched/codex-rs/core/src/tools/spec_plan.rs:626-631`
