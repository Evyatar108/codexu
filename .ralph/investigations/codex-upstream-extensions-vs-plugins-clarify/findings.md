# Codex "extensions" vs MCP / plugins / skills / hooks — taxonomy + v133 surface

**Task:** `codex-upstream-extensions-vs-plugins-clarify`
**Question:** v133 changelog says *"Extensions can observe more lifecycle events,
including subagent start/stop, tool execution, turn metadata, and async
approval/turn processing."* What ARE codex extensions, and how do they differ
from MCP servers / plugins (marketplace) / skills / hooks?
**Date:** 2026-06-06
**Mode:** READ-ONLY. No source modified.
**Tree:** `codex/external/repos/codex-patched/codex-rs` (fork at 0.135.0-copilot-api.1; v133 ≤ 0.135 so the code IS present).

---

## TL;DR / verdict

A codex **"extension"** is **NOT** a user-installable artifact and has **nothing
to do with the marketplace/plugin system.** It is an **in-process, compile-time
Rust extensibility API** (`codex-extension-api` crate at `ext/extension-api/`)
through which **first-party feature crates** — `guardian`, `memories`,
`web-search`, `goal` (all under `ext/`) — register typed **contributor** objects
that the core runtime calls back at well-defined lifecycle points (thread/turn/
tool start-stop, token usage, config change, prompt assembly, approval review,
turn-item post-processing). Extensions are wired in by Rust code
(`<crate>::install(&mut builder, …)` → `app-server/src/extensions.rs::thread_extensions`),
hold the registry on `Session.services.extensions`, and run **inside the codex
process** with direct access to runtime objects (subagent spawner, event sink,
typed per-scope state). There is **no disk format, no manifest, no config key, no
user installation path** for an extension.

The other four surfaces are the *external/user-facing* extensibility story:

| | **MCP server** | **Skill** | **Plugin (marketplace)** | **Hook** | **Extension** |
|---|---|---|---|---|---|
| **What it is** | External process exposing **tools** (and prompts/resources) over the MCP protocol | A markdown instruction file (`SKILL.md`/`SKILLS.md`) injected into the prompt to teach the model a procedure | A **bundle/distribution unit** that packages skills + MCP servers + hooks + apps under one manifest | An external **command / prompt / agent** fired by the runtime at a named lifecycle event | A **first-party Rust contributor** compiled into codex that observes/participates in runtime lifecycle |
| **Lives where** | Separate OS process (stdio or streamable-HTTP) | `.md` file on disk | Marketplace cache dir `~/.codex/plugins/cache/<mkt>/<plugin>/<ver>/`, manifest `.codex-plugin/plugin.json` | `hooks.json`/config `[hooks]` → external script, OR a plugin-bundled hooks file | Inside `codex-core.exe`; a workspace crate under `ext/` |
| **Registered by** | `[mcp_servers.<name>]` in `~/.codex/config.toml`, or a plugin's `mcpServers` path | Skill loader scans skill dirs (user/project/plugin scope) | `codex plugin marketplace add` + install | `[hooks]` config / `HooksFile` / plugin `hooks` manifest field | Rust: `registry.<kind>_contributor(Arc::new(ext))` at build time |
| **Loaded at** | Runtime (process spawn + handshake) | Runtime (file read → prompt injection) | Install time (copied to cache); loaded at startup | Runtime (config/plugin scan) | **Compile time** (linked into the binary) |
| **Can it observe lifecycle events?** | No — it only answers tool calls | No — it's static prompt text | Only via the hooks it bundles | **Yes** — 10 named events (PreToolUse, PostToolUse, SubagentStart/Stop, Stop, …) | **Yes** — richer, typed, in-process callbacks (this is the v133 headline) |
| **Process boundary** | Out-of-process (IPC) | In-prompt (no process) | n/a (container) | Out-of-process (spawned command) per fire | **In-process** (direct Rust calls, shared memory) |
| **Who can author** | Anyone (user/3rd-party) | Anyone | Anyone | Anyone | **Only the codex codebase** (fork or upstream) |
| **Relationship** | A *capability* a plugin can bundle | A *capability* a plugin can bundle | **Superset container** of skill+mcp+hook+app | A *capability* a plugin can bundle; also user-config | **Orthogonal** internal mechanism; not bundled, not user-facing |

**One-line mental model:**
- **MCP / skill / hook / app** = the four *things a plugin can contain*; a **plugin** is the **superset bundle/distribution wrapper** around them.
- **Extension** = an **orthogonal, internal** mechanism — the in-process Rust API the codex team uses to build first-party features (`guardian`/`memories`/`web-search`/`goal`) that need to *participate in* the agent loop, not just feed it tools or text.

**Fork-relevance verdict (full detail in §6):** **Extensions give the fork
nothing actionable today, and crews/ralph cannot and should not be re-built as a
codex extension.** Authoring an extension means writing a Rust crate and *forking
the codex build* (max upstream-conflict surface — the exact thing codex/CLAUDE.md
tenant #1 says to avoid). crews/ralph deliberately coordinate **out-of-process**
via hooks + an external Node CLI so they stay **engine-agnostic** (the same hook
JSON drives Claude Code, Copilot CLI, and codex). Hooks remain the correct seam.
The *interesting* finding is that the **`guardian` extension is codex's own
in-process analog of crews' supervisor pattern** (spawn subagents + observe
thread lifecycle) — worth knowing as prior art, not worth adopting.

---

## 1. Where the extension subsystem lives

```
codex-rs/
├── ext/                              # the "extensions" home
│   ├── extension-api/                # the API crate (traits, registry, state)
│   │   ├── src/lib.rs                # public exports
│   │   ├── src/registry.rs          # ExtensionRegistry{,Builder}
│   │   ├── src/state.rs             # ExtensionData (typed per-scope store)
│   │   ├── src/capabilities/        # host→ext capabilities (agent spawn, event sink, response-item inject)
│   │   ├── src/contributors/        # the lifecycle contributor inputs (thread/turn/tool)
│   │   └── examples/enabled_extensions.rs   # standalone usage demo (compile-time install)
│   ├── guardian/                     # first-party extension: spawn-subagent + thread lifecycle
│   ├── memories/                     # first-party extension: memory tools + lifecycle
│   ├── web-search/                   # first-party extension: web_search native tool
│   └── goal/                         # first-party extension: goal accounting (tools + every lifecycle hook)
├── core/src/
│   ├── tools/lifecycle.rs           # CALL SITE: on_tool_start / on_tool_finish
│   ├── tasks/lifecycle.rs           # CALL SITE: on_turn_start / on_turn_stop / on_turn_abort
│   ├── session/handlers.rs, session.rs  # CALL SITE: thread_lifecycle_contributors
│   ├── stream_events_utils.rs       # CALL SITE: turn_item_contributors (async turn-item post-processing)
│   ├── session/mod.rs               # CALL SITE: context_contributors (prompt assembly); holds Session.services.extensions
│   └── tools/handlers/extension_tools.rs  # routes extension-contributed native tools
└── app-server/src/extensions.rs      # WIRING: thread_extensions() installs guardian+memories+web_search
```

The **API crate name** is `codex-extension-api`. The concrete extensions are
separate crates (`codex-guardian`, `codex-memories-extension`,
`codex-web-search-extension`, the goal extension) that depend on it.

---

## 2. What an extension actually is (precise definition + evidence)

### 2.1 A registry of typed contributor trait-objects

`ExtensionRegistryBuilder<C>` collects `Arc<dyn …Contributor>` vectors and
`build()`s an immutable `ExtensionRegistry<C>`
(`ext/extension-api/src/registry.rs:19-217`). The registry holds **nine**
contributor kinds + one event sink:

- `thread_lifecycle_contributors` — `ThreadLifecycleContributor<C>`
- `turn_lifecycle_contributors` — `TurnLifecycleContributor`
- `config_contributors` — `ConfigContributor<C>`
- `token_usage_contributors` — `TokenUsageContributor`
- `context_contributors` — `ContextContributor` (prompt fragments)
- `tool_contributors` — `ToolContributor` (native tools owned by a feature)
- `tool_lifecycle_contributors` — `ToolLifecycleContributor`
- `turn_item_contributors` — `TurnItemContributor`
- `approval_review_contributors` — `ApprovalReviewContributor`
- `event_sink` — `Arc<dyn ExtensionEventSink>` (fire-and-forget protocol events)

The contributor traits are defined in
`ext/extension-api/src/contributors.rs:33-169`. They are **plain async Rust
traits** (`#[async_trait]` or RPITIT), e.g.:

```rust
pub trait ToolLifecycleContributor: Send + Sync {
    fn on_tool_start<'a>(&'a self, _input: ToolStartInput<'a>) -> ToolLifecycleFuture<'a> { … }
    fn on_tool_finish<'a>(&'a self, _input: ToolFinishInput<'a>) -> ToolLifecycleFuture<'a> { … }
}
```

### 2.2 Registration is **Rust code at build time**, not config

`app-server/src/extensions.rs:23-36` is the canonical wiring:

```rust
pub(crate) fn thread_extensions<S>(…) -> Arc<ExtensionRegistry<Config>> {
    let mut builder = ExtensionRegistryBuilder::<Config>::with_event_sink(event_sink);
    codex_guardian::install(&mut builder, guardian_agent_spawner);
    codex_memories_extension::install(&mut builder, codex_otel::global());
    codex_web_search_extension::install(&mut builder, auth_manager);
    Arc::new(builder.build())
}
```

Each extension's `install()` pushes its `Arc<Self>` into the relevant
contributor slots. Example — the goal extension registers itself into **six**
slots from one object (`ext/goal/src/extension.rs:363-385`):

```rust
registry.thread_lifecycle_contributor(extension.clone());
registry.config_contributor(extension.clone());
registry.turn_lifecycle_contributor(extension.clone());
registry.token_usage_contributor(extension.clone());
registry.tool_lifecycle_contributor(extension.clone());
registry.tool_contributor(extension);
```

The `examples/enabled_extensions.rs` demo confirms the model is purely
programmatic: `let mut builder = ExtensionRegistryBuilder::<()>::new();
shared_state_extension::install(&mut builder); let registry = builder.build();`
— **no file, no manifest, no marketplace.**

> **This is the crux of the distinction.** MCP servers, skills, plugins, and
> hooks are all *discovered from disk / config at runtime by anyone*. An
> extension is *linked into the binary by the codex source tree*. Adding one
> means editing `app-server/src/extensions.rs` and shipping a new codex build.

### 2.3 The registry hangs off the session

`core/src/session/mod.rs:401` and `state/service.rs:66`:
`pub(crate) extensions: Arc<codex_extension_api::ExtensionRegistry<crate::config::Config>>`.
Tests and the `ThreadManager` default use `empty_extension_registry()`
(`ext/extension-api/src/registry.rs:215`) when no features are installed.

### 2.4 Typed, scoped, extension-private state — `ExtensionData`

`ext/extension-api/src/state.rs` is a `TypeId → Arc<dyn Any>` map
(`get`/`get_or_init`/`insert`/`remove`) attached to **three host scopes**:
`session_extension_data`, `thread_extension_data`, and per-turn
`turn.extension_data` (see the call sites in §3). This lets an extension stash
runtime handles (e.g. goal's `GoalRuntimeHandle`) keyed by Rust type, scoped to
session/thread/turn lifetime — something no out-of-process surface can do.

### 2.5 Host→extension **capabilities** (the in-process power)

`ext/extension-api/src/capabilities/`:
- `agent.rs` — `AgentSpawner<R>` trait: the host injects a closure letting an
  extension **spawn subagents** (`spawn_subagent(forked_from_thread_id,
  request)`). Concretely wired in `app-server/src/extensions.rs:68-84` to
  `ThreadManager::spawn_subagent`.
- `events.rs` — `ExtensionEventSink::emit(Event)`: extension emits protocol
  events; host owns transport/persistence. The app-server sink
  (`extensions.rs:48-65`) forwards `ThreadGoalUpdated` to a client notification.
- `response_items.rs` — `ResponseItemInjector`: inject items into the model stream.

These capabilities — spawning subagents, emitting protocol events, injecting
response items, holding live `Weak<ThreadManager>` — are **impossible** for
MCP/skill/hook surfaces, which sit behind a process or prompt boundary.

---

## 3. The v133 lifecycle surface, mapped to code

The changelog's four named additions map 1:1 to contributor callbacks + their
**core call sites**:

### (a) "subagent start/stop"
- **Spawn capability:** `AgentSpawner::spawn_subagent(forked_from_thread_id, request)`
  (`capabilities/agent.rs:13-22`), host impl at `app-server/src/extensions.rs:68-84`.
- **Observation:** a subagent is itself a thread, so its start/stop is observed
  through `ThreadLifecycleContributor::{on_thread_start,on_thread_resume,
  on_thread_idle,on_thread_stop}` (`contributors.rs:46-64`) fired at
  `core/src/session/handlers.rs:629` and `session/session.rs:969`.
- **Prior art:** `guardian` is exactly this — it captures `forked_from_thread_id`
  on `on_thread_start` and exposes `spawn_subagent` (`ext/guardian/src/lib.rs:24-71`).
- NOTE: hooks *also* expose `SubagentStart`/`SubagentStop` events (see §5) — the
  same conceptual event, but out-of-process and untyped.

### (b) "tool execution"
- `ToolLifecycleContributor::{on_tool_start,on_tool_finish}` (`contributors.rs:133-143`).
- Inputs `ToolStartInput`/`ToolFinishInput` (`contributors/tool_lifecycle.rs`)
  carry `turn_id`, `call_id`, `tool_name`, `source`
  (`Direct` vs `CodeMode{cell_id,…}`), and on finish a typed `ToolCallOutcome`
  (`Completed{success}` / `Blocked` / `Failed{handler_executed}` / `Aborted`).
- **Call sites:** `core/src/tools/lifecycle.rs:12-85` (`notify_tool_start`,
  `notify_tool_finish_parts`, `notify_tool_aborted`).
- vs hooks: this is **observe-only** ("without inspecting or rewriting tool
  input/output" — the trait doc explicitly says use a `ToolContributor` to *own*
  a tool and *hooks* for "policy that needs tool payloads"). So extensions get
  *typed lifecycle observation*; hooks get *payload-level policy/veto*.

### (c) "turn metadata"
- `TurnLifecycleContributor::{on_turn_start,on_turn_stop,on_turn_abort}`
  (`contributors.rs:71-82`).
- `TurnStartInput` (`contributors/turn_lifecycle.rs:8-21`) exposes `turn_id`,
  `collaboration_mode` (Plan/etc.), and `token_usage_at_turn_start` — i.e. the
  "turn metadata". Abort carries a typed `TurnAbortReason`.
- Plus `TokenUsageContributor::on_token_usage` (`contributors.rs:106-116`) for
  mid-turn token checkpoints.
- **Call sites:** `core/src/tasks/lifecycle.rs:8-56`
  (`emit_turn_start_lifecycle`/`emit_turn_stop_lifecycle`/`emit_turn_abort_lifecycle`).

### (d) "async approval / turn processing"
- **Async approval:** `ApprovalReviewContributor::contribute(session_store,
  thread_store, prompt) -> Option<ReviewDecision>` (`contributors.rs:146-154`),
  claimed first-match by `ExtensionRegistry::approval_review(…)`
  (`registry.rs:175-191`). This lets an extension **answer an approval prompt
  programmatically** (auto-approve/deny) instead of asking the user.
  *Observation:* the registry method exists and a slot is registered, but **no
  first-party `install()` registers an approval-review contributor yet**
  (grep shows only the API definition + the registry consumer, no caller in
  `core` invoking `extensions.approval_review(...)`). It is a **latent, newly-
  exposed v133 surface** awaiting a consumer.
- **Async turn processing:** `TurnItemContributor::contribute(thread_store,
  turn_store, &mut TurnItem) -> Result<(),String>` (`contributors.rs:161-169`)
  — ordered async post-processing that may **mutate each parsed turn item**
  before emission. **Call site:** `core/src/stream_events_utils.rs:267`
  (`turn_item_contributors().to_vec()`), gated by a non-empty check at
  `core/src/session/turn.rs:1741`.
- **Prompt assembly (related):** `ContextContributor::contribute(...) ->
  Vec<PromptFragment>` (`contributors.rs:33-39`), consumed at
  `core/src/session/mod.rs:2844`.

---

## 4. The other surfaces, precisely

### 4.1 MCP server
- **What:** an external program speaking the Model Context Protocol; exposes
  **tools** (and prompts/resources) the model can call.
- **Registration:** `[mcp_servers.<name>]` in `~/.codex/config.toml`
  (stdio: `command`/`args`/`env`; or streamable-HTTP `url`), or bundled by a
  plugin via the manifest `mcpServers` path field
  (`core-plugins/src/manifest.rs:27`).
- **Connection:** rmcp client (`rmcp-client/`, `codex-mcp/`,
  `mcp_connection_manager.rs`), pinned `rmcp 0.15.0`.
- **Scope of power:** answers `tools/call`; **cannot** observe codex's internal
  thread/turn/tool lifecycle. Pure capability provider, out-of-process.

### 4.2 Skill
- **What:** a markdown procedure file (`SKILL.md`/`SKILLS.md`) + metadata
  (`SkillMetadata`: name, description, interface, dependencies, policy, scope,
  `plugin_id`) — `core-skills/src/model.rs:11-23`.
- **Registration/loading:** `SkillsManager` scans skill dirs across
  user/project/plugin scope (`core-skills/src/{loader,manager}.rs`); rendered
  into the system prompt (`render.rs`) and optionally implicit-invoked
  (`invocation_utils.rs`).
- **Scope of power:** pure **prompt content** — it *teaches the model a
  procedure*; it runs no code and observes nothing. The weakest/most-portable
  surface.

### 4.3 Plugin (marketplace)
- **What:** a **bundle** described by `.codex-plugin/plugin.json`
  (`RawPluginManifest`, `core-plugins/src/manifest.rs:12-35`). The manifest's
  payload fields are paths to the *other* surfaces:
  `skills`, `mcpServers`, `apps`, `hooks` (+ `interface` display metadata).
- So a plugin is the **superset container / distribution unit** that aggregates
  skills + MCP servers + hooks + apps under one installable, versioned package.
- **Registration:** `codex plugin marketplace add <src>` then install; codex
  copies the plugin into `~/.codex/plugins/cache/<marketplace>/<plugin>/<ver>/`
  and loads from the cache (`core-plugins/src/{marketplace,store,loader}.rs`).
  Marketplace index schema lives in `.agents/plugins/marketplace.json` /
  `.claude-plugin/...` (`core-plugins/src/marketplace.rs`).
- **Scope of power:** whatever its bundled skills/MCP/hooks/apps can do — it has
  no independent runtime power of its own.

### 4.4 Hook
- **What:** a handler fired at one of **10 named lifecycle events**
  (`hooks/src/lib.rs:19-30`): `PreToolUse`, `PermissionRequest`, `PostToolUse`,
  `PreCompact`, `PostCompact`, `SessionStart`, `UserPromptSubmit`,
  `SubagentStart`, `SubagentStop`, `Stop`.
- **Handler kinds** (`config/src/hook_config.rs:137-156`):
  - `command` — spawn an **external process** with JSON on stdin, read a typed
    JSON decision on stdout (per-event input/output schemas in
    `hooks/src/schema.rs`); supports `commandWindows`, `timeout`, `async`,
    `statusMessage`.
  - `prompt` — inject a prompt.
  - `agent` — run an agent handler.
- **Registration:** `[hooks]` in config / `HooksFile` / `MatcherGroup{matcher,
  hooks}`, **and** bundled by plugins (`PluginHookSource` →
  `plugin_hook_declarations`, `hooks/src/declarations.rs`).
- **Scope of power:** out-of-process **policy + veto**. A `PreToolUse`/
  `PermissionRequest` hook can **block** a tool (`continue:false`,
  `decision:deny`), unlike an extension's `ToolLifecycleContributor` which is
  observe-only. Hooks see **payloads** (tool args, messages) but cross a process
  boundary on every fire and return untyped JSON.

### 4.5 (App — for completeness)
The plugin manifest also has an `apps` path (`manifest.rs:30`,
`PluginManifestPaths.apps`) — embedded interactive apps/webviews surfaced via the
plugin `interface` metadata. Orthogonal to the agent loop; not relevant to the
question beyond "another thing a plugin can bundle."

---

## 5. How they relate (superset vs orthogonal)

```
                          ┌──────────────────────── PLUGIN (marketplace bundle) ───────────────────────┐
                          │  manifest .codex-plugin/plugin.json  →  paths to:                            │
                          │     • skills/        (prompt procedures)                                     │
                          │     • mcpServers/    (external tool processes)                               │
                          │     • hooks/         (lifecycle command/prompt/agent handlers)               │
                          │     • apps/          (embedded webviews)                                     │
                          └──────────────────────────────────────────────────────────────────────────────┘
   user/3rd-party, out-of-process or in-prompt, discovered from disk/config at runtime
   ───────────────────────────────────────────────────────────────────────────────────────────────────────
   codex-source-only, IN-PROCESS, linked at compile time, NOT bundled by plugins:

                          ┌──────────────────────── EXTENSION (codex-extension-api) ───────────────────┐
                          │  guardian / memories / web-search / goal                                    │
                          │  register typed contributors into ExtensionRegistry; called back by core    │
                          │  at thread/turn/tool lifecycle; can spawn subagents, emit events, mutate     │
                          │  turn items, answer approvals, own native tools, hold typed scoped state.    │
                          └──────────────────────────────────────────────────────────────────────────────┘
```

- **Plugin = superset** of {skill, MCP, hook, app}. Those four are the
  *capabilities a plugin contains*; each can also be configured standalone
  (MCP via `[mcp_servers]`, hooks via `[hooks]`, skills via skill dirs).
- **Extension = orthogonal.** It is the only *in-process, first-party,
  compile-time* surface. It is **not** a plugin capability and **cannot** be
  authored without modifying the codex build.
- **Overlap of note:** hooks and extensions both observe SubagentStart/Stop and
  Pre/PostToolUse-shaped events. The difference is **boundary + power + typing**:
  hooks = external process, untyped JSON, *can veto*, payload-visible;
  extensions = in-process, typed Rust, *observe-only at the tool layer* but with
  far richer capabilities (subagent spawn, event emit, turn-item mutation,
  approval answering, scoped state).

---

## 6. Fork relevance — do crews/ralph/happy gain anything? (verdict)

**Verdict: No actionable gain. Hooks remain the correct seam for crews/ralph.
Do NOT re-platform crews coordination as a codex extension.**

### Why crews/ralph should stay on hooks
1. **Engine-agnosticism is the whole point.** crews/ralph drive **Claude Code,
   Copilot CLI, and codex** with the *same* hook JSON + an external Node CLI
   (`crews.js`). Hooks are a cross-engine contract. An extension is a
   **codex-only Rust API** — adopting it would fork the coordination layer per
   engine and throw away portability. (Memory: crews default member engine now
   mirrors the caller CLI; the system is explicitly multi-engine.)
2. **Authoring an extension = forking the codex build = maximum conflict
   surface.** Per `codex/CLAUDE.md` engineering tenant #1, every edit inside
   `external/repos/codex-patched/codex-rs/` is rebase friction, and *adding a new
   extension requires editing `app-server/src/extensions.rs::thread_extensions`*
   (an upstream-canonical file) plus shipping a new `codex-core.exe`. That is the
   single most expensive way to add behavior in this fork — the opposite of the
   overlay-first discipline.
3. **Hooks already give crews everything it uses.** crews/ralph rely on
   PreToolUse (block-until-armed), Stop (turn-end gating), SessionStart
   (auto-register), and SubagentStart/Stop. All are first-class hook events
   (`hooks/src/lib.rs:19-30`) with payload access and **veto power** — which the
   extension tool-lifecycle surface explicitly **lacks** (observe-only).
4. **The async-approval extension surface is latent (no consumer yet)** and is
   codex-internal, so even the one genuinely new v133 capability (programmatic
   approval answering) is not reachable from an out-of-process coordinator.

### The one worth knowing: `guardian` is codex's in-process crews-analog
`guardian` already implements *exactly* the supervisor pattern crews emulates —
**observe thread lifecycle + spawn subagents** — but as a compiled first-party
extension (`ext/guardian/src/lib.rs`, `AgentSpawner` →
`ThreadManager::spawn_subagent`). This is useful **prior art / context**, not an
adoption target:
- If codex upstream ever exposes guardian-style supervision *through a
  config/plugin/hook surface* (i.e. makes the extension's powers reachable from
  outside the binary), **that** would be the thing to revisit for crews. Today it
  is hard-wired in Rust and unreachable from a plugin/hook.
- It confirms crews' architecture is sound: the coordination model codex chose
  internally (lifecycle-observation + subagent-spawn) is the same one crews
  implements externally via hooks.

### happy integration
No gain. happy-cli spawns the plain `app-server` crate and consumes its
protocol; extensions are an internal core concern below that boundary. Nothing in
the happy integration touches `codex-extension-api`, and there is no protocol
surface to opt into extension behavior from a client.

### If a future need ever justified an extension
Only if the fork needed an in-process behavior that **must** mutate the agent
loop and **cannot** be done from a hook/MCP/tool — e.g. typed per-turn token
accounting, mutating turn items mid-stream, or programmatic approval answering.
Even then, per tenant #1 the placement would be a **new overlay crate** under
`codex-rs-overlay/` registered by a 1-3 line edit at the
`thread_extensions()` seam — and it would still be codex-only. No current
fork roadmap item needs this.

---

## 7. Evidence index (file:line)

- API crate exports: `ext/extension-api/src/lib.rs:1-52`
- Registry + 9 contributor slots + `approval_review()`: `ext/extension-api/src/registry.rs:19-217`
- Contributor traits: `ext/extension-api/src/contributors.rs:33-169`
- Tool-lifecycle inputs/outcomes: `ext/extension-api/src/contributors/tool_lifecycle.rs`
- Turn-lifecycle inputs (turn metadata): `ext/extension-api/src/contributors/turn_lifecycle.rs:8-43`
- Thread-lifecycle inputs: `ext/extension-api/src/contributors/thread_lifecycle.rs`
- Typed scoped state: `ext/extension-api/src/state.rs:11-86`
- Agent-spawn capability: `ext/extension-api/src/capabilities/agent.rs:13-22`
- Event sink capability: `ext/extension-api/src/capabilities/events.rs:8-19`
- Compile-time install demo: `ext/extension-api/examples/enabled_extensions.rs:15-19`
- Host wiring (install guardian/memories/web-search): `app-server/src/extensions.rs:23-84`
- Goal extension (6-slot self-register): `ext/goal/src/extension.rs:363-385`
- Guardian extension (subagent spawn + thread lifecycle): `ext/guardian/src/lib.rs:24-71`
- CALL SITE tool execution: `core/src/tools/lifecycle.rs:12-85`
- CALL SITE turn metadata: `core/src/tasks/lifecycle.rs:8-56`
- CALL SITE thread lifecycle: `core/src/session/handlers.rs:629`, `core/src/session/session.rs:969`
- CALL SITE async turn-item processing: `core/src/stream_events_utils.rs:267`, gate `core/src/session/turn.rs:1741`
- CALL SITE prompt assembly: `core/src/session/mod.rs:2844`
- Registry held on session: `core/src/session/mod.rs:401`, `core/src/state/service.rs:66`
- Hooks: 10 event names `hooks/src/lib.rs:19-30`; handler kinds `config/src/hook_config.rs:137-156`; payload `hooks/src/types.rs`; plugin-bundled hooks `hooks/src/declarations.rs:12-33`
- Plugin manifest (skills/mcpServers/apps/hooks paths): `core-plugins/src/manifest.rs:12-53`
- Skill model: `core-skills/src/model.rs:11-23`; loader/render: `core-skills/src/{loader,manager,render}.rs`
- MCP: `[mcp_servers]` config + `rmcp-client/`, `codex-mcp/mcp_connection_manager.rs` (rmcp 0.15.0)
```
