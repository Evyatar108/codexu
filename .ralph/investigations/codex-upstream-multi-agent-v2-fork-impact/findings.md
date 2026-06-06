# Investigation: codex multi-agent v2 — fork impact

**Task:** `codex-upstream-multi-agent-v2-fork-impact`
**Mode:** READ-ONLY investigation (no source modified)
**Date:** 2026-06-06
**Fork codex version:** 0.135 (`external/repos/codex-patched`)
**Investigator:** `inv-multi-agent-v2` (crews/ralph-pipeline)

---

## TL;DR / Verdict

- **No conflict, no supersession.** `multi_agents_v2/` is **upstream-native** codex
  code with a **thin fork overlay** (the `plugin-scope-axis` patch family: a
  subagent spawn-gate + a subagent plugin filter). It does **not** replace or
  collide with the fork's own agent-spawn work.
- **`codex-child-spawn-tools` is already SHIPPED** (a research spike, not code).
  Its decision and v2 are **complementary**: the spike explicitly chose
  "keep `spawn_agent` top-level-only; use `multi_agent_v2` opt-in as the
  follow-up probe if nested spawn is ever needed." v2 is the substrate that
  spike already pointed at.
- **The "codex members can't run multi-lens brainstorm" degradation is NOT a
  codex spawn-capability gap.** Codex top-level sessions already expose a
  native spawn surface by default (legacy `Collab`). The degradation is a
  **tool-name + schema mismatch**: Ralph-orchestration's skills drive a
  Claude/Copilot-shaped `Task`/`Agent` tool; codex exposes `spawn_agent` /
  `send_input` / `followup_task` instead. Ralph doesn't know to call codex's
  tools, so it falls back to single-threaded.
- **Best leverage = a Ralph engine-adapter (plugin-side), not a codex patch.**
  Optionally flip `features.multi_agent_v2 = true` (a config toggle, zero
  source change) to target the richer/cleaner v2 surface.

### Version-scope caveat (READ FIRST)

The operator filed this as a **v137** feature ("Multi-agent v2 keeps runtime
choice with each thread and exposes cleaner follow-up and metadata defaults for
spawned agents"). **Our fork is pinned at codex 0.135.** Everything in this
document is verified against the **0.135 tree**. The *base capabilities* the
operator described are **already present in 0.135** (see §1). The **specific
v137 refinements** ("keeps runtime choice *with each thread*", "*cleaner*
follow-up and metadata *defaults*") are `>135` and **cannot be inspected in this
tree** — they are flagged **REBASE-GATED** in §8. I did not guess at their
content.

---

## 1. What multi-agent v2 IS (and how the surface is exposed to the model)

`multi_agents_v2/` is codex's task-path-based collaboration tool surface. It is
gated by `Feature::MultiAgentV2` and registered in
`core/src/tools/spec_plan.rs::add_collaboration_tools`. When enabled, it exposes
**six function tools** directly to the model:

| Tool | File | Model-facing contract | Behavior |
|---|---|---|---|
| `spawn_agent` | `multi_agents_v2/spawn.rs` | required `task_name` + `message`; optional `agent_type`(role), `model`, `reasoning_effort`, `service_tier`, `fork_turns` | Spawns a child thread under a canonical agent-path. |
| `send_message` | `multi_agents_v2/send_message.rs` | `target` + `message` | Queues a message on a child **without** waking it (`QueueOnly`). |
| `followup_task` | `multi_agents_v2/followup_task.rs` | `target` + `message` | Sends a message **and triggers a turn** in the child (`TriggerTurn`). |
| `wait_agent` | `multi_agents_v2/wait.rs` | optional `timeout_ms` (bounded by config min/max/default) | Blocks on a mailbox change up to a timeout; returns a brief "completed/timed out" summary. |
| `close_agent` | `multi_agents_v2/close_agent.rs` | `target` | Closes a spawned (non-root) agent; returns previous status. |
| `list_agents` | `multi_agents_v2/list_agents.rs` | optional `path_prefix` | Lists agents under a task-path prefix. |

The JSON schema/descriptions the model actually sees are built in
`core/src/tools/handlers/multi_agents_spec.rs` (`create_spawn_agent_tool_v2`,
`create_send_message_tool`, `create_followup_task_tool`,
`create_wait_agent_tool_v2`, `create_close_agent_tool_v2`,
`create_list_agents_tool`). Exposure mode and an optional namespace
(`config.multi_agent_v2.tool_namespace`, e.g. `"agents"`) are applied per
`add_collaboration_tools` (`DirectModelOnly` when
`multi_agent_v2.non_code_mode_only`, else `Direct`).

**The three capabilities the operator named ARE in the 0.135 base:**

1. **Per-thread runtime choice** — `spawn_agent` accepts per-call `model`,
   `reasoning_effort`, and `service_tier`, validated and applied in
   `multi_agents_common.rs::apply_requested_spawn_agent_model_overrides` +
   `apply_spawn_agent_service_tier`. Each spawned thread carries its own
   resolved config (see `build_agent_spawn_config`). So a thread *keeps* the
   runtime it was spawned with across its follow-up turns already in 0.135.
2. **Follow-up** — the dedicated `followup_task` tool (TriggerTurn) vs the
   queue-only `send_message`; both funnel through
   `message_tool.rs::handle_message_string_tool`, differing only in
   `MessageDeliveryMode`.
3. **Metadata defaults** — `config.multi_agent_v2.hide_spawn_agent_metadata`
   (default `false`) plus the `SpawnAgentResult::{WithNickname, HiddenMetadata}`
   split, and the `multi_agent_v2` config block (wait-timeout min/max/default,
   `max_concurrent_threads_per_session`, usage-hint text, `tool_namespace`,
   `non_code_mode_only`). Defined in `core/src/config/mod.rs::MultiAgentV2Config`.

Conclusion: the operator's v137 description is **release-note framing of
mechanisms that already exist in 0.135**. Any genuine v137 *delta* is a
refinement of defaults/wording/persistence I cannot see (REBASE-GATED, §8).

---

## 2. Native vs fork (SANDBOX PATCH inventory)

`multi_agents_v2/` is **upstream-native**. Fork divergence is limited to the
**`plugin-scope-axis`** patch family. `grep 'SANDBOX PATCH'` across all
multi-agent files returns exactly three sites:

| File | Lines | Marker | What it is |
|---|---|---|---|
| `multi_agents_v2/spawn.rs` | 2, 57–63 | `plugin-scope-axis — subagent gate` | **Fork-only**: `import SessionSource` + reject `spawn_agent` when `turn.session_source` is `SubAgent(_)` ("spawn_agent is not available from subagent sessions"). |
| `multi_agents/spawn.rs` (legacy v1) | 2, 55 | same | **Fork-only**: the identical defensive reject on the v1 handler. |
| `multi_agents_common.rs` | 242–243, 258–287 | `plugin-scope-axis` | **Fork-only**: `codex_plugin_scope::apply_subagent_plugin_filter(&mut config)` in `build_agent_shared_config`, plus the `impl codex_plugin_scope::Config for Config` that synthesizes a plugin-disable overlay at `LegacyManagedConfigTomlFromMdm` precedence so a parent's `enabled=true` can't bypass the scope axis. |

Everything else in `multi_agents_v2/` (and `multi_agents_common.rs`,
`multi_agents_spec.rs`) is upstream code. This is documented as
**patch-surface invariant 26** (`codex/docs/implementation/patch-surface.md:808`)
and the **"Plugin scope-axis replant"** recipe (§15, lines ~896–915, ~1093–1113),
with the enforcing test
`codex-rs-overlay/codex-invariant-tests/tests/plugin_scope_filtering.rs`.

There is **one more fork-only handler** in the same family that is NOT under
`multi_agents*`: `core/src/tools/handlers/spawn_top_level_session.rs`
(`SpawnTopLevelSessionHandler`, tool name `spawn_top_level_session`). It is
gated to the **`agent-spawner`** role subagent and uses `HAPPY_CURRENT_SESSION_ID`
+ `HAPPY_DAEMON_CONTROL_URL` to start a brand-new **top-level** happy session on
the operator's behalf. This is the fork's "agent-spawner" pattern (registered
in `add_core_utility_tools`, patch-surface §15 line ~1077/1089).

---

## 3. v1 (legacy `multi_agents/`) vs v2 — the differences

| Axis | v1 (`Collab`, key `multi_agent`) | v2 (`MultiAgentV2`, key `multi_agent_v2`) |
|---|---|---|
| Default enabled | **`true`** (`Stage::Stable`) | **`false`** (`Stage::UnderDevelopment`) |
| Spawn args | `fork_context` (bool) | `task_name` + `message` required; `fork_turns` (`none`/`all`/N) replaces `fork_context` (which v2 explicitly rejects) |
| Messaging | `send_input` (with `interrupt`), `resume_agent` | `send_message` (queue-only) + `followup_task` (trigger-turn) |
| Discovery | — | `list_agents` (task-path prefix) |
| Recursion limit | depth stop: `apply_spawn_agent_overrides` strips `Collab`/`SpawnCsv` at `child_depth >= agent_max_depth` (default depth = 1) | no depth strip; bounded by `max_concurrent_threads_per_session` |
| Identity model | thread-id targets | canonical **task-path** targets (relative or canonical names) |

Source: `multi_agents.rs` / `multi_agents_v2.rs` module files,
`multi_agents_spec.rs`, and `features/src/lib.rs:940-949`.

**Why the default matters for codex ralph members:** with stock config,
`collab_tools_enabled()` is **true** (because `Collab` defaults on), and since
`MultiAgentV2` defaults **off**, `add_collaboration_tools` registers the
**legacy v1 tools** (`spawn_agent` v1, `send_input`, `resume_agent`,
`wait_agent`, `close_agent`). So a stock codex top-level session **does** have a
spawn surface — it's the v1 one.

---

## 4. Reconciliation with `codex-child-spawn-tools`

`codex-child-spawn-tools` is a **shipped research spike** (2026-05-26;
artifact `plans/codex-child-spawn-tools.md`, commit "docs(plans):
codex-child-spawn-tools research spike"). It was triggered by `agent-tree-rpc`
US-006 (a nested A→B spawn test failing because child A reported no
`spawn_agent`/`wait_agent`).

Its verified conclusions (which this investigation independently re-confirms
against the current 0.135 tree):

1. The "child lacks spawn tools" symptom is **legacy-mode behavior**:
   `apply_spawn_agent_overrides` strips `Collab`/`SpawnCsv` at `agent_max_depth`
   (=1) **only when `MultiAgentV2` is off**. In v2 mode that function is a no-op
   for tool availability; recursion is bounded by
   `max_concurrent_threads_per_session` instead. (Confirmed:
   `multi_agents_common.rs::apply_spawn_agent_overrides`, lines 332–337.)
2. It is **not** an upstream rule that children may never spawn — both the pin
   and upstream HEAD expose child spawn tools under v2. **A submodule bump is
   not the fix** (upstream still defaults v2 off). **An overlay crate is not
   justified** (the V2 opt-in config path already exists).
3. **Recommended path:** keep `spawn_agent` top-level-only for the supported
   roadmap shape (matches `plugin-scope-agents` + the fork's `spawn_top_level_session`
   agent-spawner); use **`features.multi_agent_v2 = true` opt-in** as the cheap
   follow-up probe if nested spawn is ever genuinely required.

**Verdict on the three options the task posed:**

- **Superseded by upstream v2?** No. v2 is the very mechanism the spike pointed
  at; it didn't exist *to* supersede the spike — the spike *recommends* it.
- **Conflicting?** No. The spike's "top-level-only" stance is implemented by the
  fork's `plugin-scope-axis` subagent gate (§2), which sits *on top of* v2
  without altering v2's own logic. The two are coherent.
- **Complementary?** **Yes.** v2 = the in-session parent→child surface;
  `plugin-scope-axis` (subagent gate + plugin filter + `spawn_top_level_session`)
  = the fork's scoping/agent-spawner layer over it. `codex-child-spawn-tools` is
  the decision record tying them together.

> Note: the spike doc (dated 2026-05-26) describes a pin where there was "no
> parent/child gate at registry build time." The explicit `SubAgent` reject in
> `spawn.rs` (§2) landed **later** via `plugin-scope-agents`. So the *current*
> 0.135 tree enforces top-level-only via **two** mechanisms: the upstream
> legacy depth-strip AND the fork's explicit reject (defensive, both v1 and v2).

---

## 5. Q4 — Is v2 the "Agent surface" for non-degraded codex ralph members?

**It is the right substrate, but it is NOT a drop-in for Ralph's Agent tool,
and the observed degradation has a different root cause than "codex can't
spawn."**

Diagnosis of the degradation (from `codex-engine-ralph-member-enablement`):
Ralph-orchestration's `/brainstorm-with-ralph` and review loops fan out
"lenses" by calling the **engine's Agent/Task tool** — Claude Code's `Task`
tool and Copilot's `task` tool, with a specific name + synchronous
request/response JSON contract. Codex does **not** expose a tool by that name or
shape. It exposes `spawn_agent` / `send_input` / `followup_task` / `wait_agent`
with an **async, mailbox-based** contract and **task-path** identities. Ralph's
skill code can't find its expected tool, so it degrades to single-threaded.

Two facts that matter for wiring it up:

- **A codex ralph member is a top-level session** (a fresh `codex` process in a
  wt tab), **not** a codex `SubAgent`. The fork's `plugin-scope-axis` subagent
  gate (§2) therefore does **not** block it — the member CAN call `spawn_agent`.
  The gate only blocks *lens → sub-lens* (depth-2), which a single-fan-out
  multi-lens brainstorm does not need. So the gate is **not** the blocker.
- **Semantics differ.** Claude/Copilot Task is "spawn → await result text" in
  one call. Codex is spawn (returns a task-path) → `followup_task`/`send_message`
  → `wait_agent` (returns only a "completed/timed out" summary, not the child's
  output). An adapter must bridge spawn+wait+result-retrieval, and `wait_agent`'s
  thin return means the adapter likely reads child output via the
  app-server/event stream or `list_agents`, not from `wait_agent` alone.

So: **v2 can power non-degraded multi-lens, but only behind an adapter that
maps Ralph's Task-tool calls onto codex's spawn/followup/wait primitives.**

---

## 6. Leverage recommendation

Ranked, cheapest-first; all consistent with the fork tenet *"minimize
upstream-canonical conflict surface."*

1. **(Preferred) Build a Ralph engine-adapter for codex — plugin-side, zero
   codex patch.** Teach `ralph-orchestration` (and/or the lens-fan-out helper in
   the brainstorm/review skills) to detect `engine=codex` and drive codex's
   native `spawn_agent` + `followup_task` + `wait_agent` (+ `list_agents` for
   result retrieval) instead of the Claude/Copilot `Task` tool. This keeps all
   divergence in the toolkit submodule (which the fork already owns and ships),
   not in codex's upstream-canonical tree. File as a new task feeding
   `codex-engine-ralph-member-enablement`.
2. **Flip `features.multi_agent_v2 = true` for codex ralph members.** A
   **config toggle**, not a source change — target the richer/cleaner v2 surface
   (`followup_task`, `send_message`, `list_agents`, task-path identities,
   concurrency-bounded recursion) rather than legacy v1 (`send_input` /
   `resume_agent`, depth-strip). Two plumbing paths already identified by the
   spike: extend `buildThreadConfig()` in
   `packages/happy-cli/src/codex/codexAppServerClient.ts` to forward a `features`
   block, or set it in `~/.codex/config.toml` on the box. **Audit happy-cli RPC
   consumers first** (the v2 schema differs — `task_name`+`message` vs
   `send_input`), per the spike's open question.
3. **Do NOT** bump the submodule or add an overlay crate *for this*. Upstream
   still defaults v2 off, and the config path already exists — both the spike
   and this investigation agree neither is justified by current evidence.

**On `codex-child-spawn-tools`:** leave it shipped/closed. It already documents
the decision matrix and the V2-opt-in follow-up probe. If the adapter work in
(1) lands, update that doc's "Open Questions" (does the v2 schema break happy-cli
RPC consumers?) as the audit gets answered — but no re-open is required.

---

## 7. The async-vs-sync gotcha for whoever builds the adapter

Ralph's existing lens fan-out assumes a synchronous "Task(prompt) -> result"
return. Codex v2 is event/mailbox driven:

- `spawn_agent` returns a **task-path** (and optional nickname), not the child's
  answer.
- `wait_agent` returns only `{message, timed_out}` — a coarse signal, **not** the
  child's produced text.
- Child output is surfaced through the app-server event stream / `list_agents`
  status, so the adapter must collect results out-of-band and join on task-path.

This is the single largest design risk for the adapter and should be the first
thing a plan-phase member validates (a tiny `features.multi_agent_v2=true` probe:
spawn a lens with `fork_turns:"none"`, `followup_task` it, `wait_agent`, then
read the result via the event stream).

---

## 8. REBASE-GATED items (require codex rebase to >=137 to inspect)

The fork is at **0.135**; these operator-cited **v137** specifics are **not in
this tree** and were **not** guessed at:

- The exact v137 meaning of **"keeps runtime choice with each thread"** — whether
  it is new persistence/propagation behavior beyond the per-spawn
  `model`/`reasoning_effort`/`service_tier` selection that 0.135 already has
  (0.135 threads already retain their spawned config across follow-up turns, so
  this phrase may describe pre-existing behavior — unverifiable without the 137
  diff).
- The exact v137 changes to **"cleaner follow-up"** (any new/renamed
  follow-up tool semantics beyond 0.135's `followup_task`/`send_message` split).
- The exact v137 **"metadata defaults"** deltas (changed default values or
  wording vs 0.135's `hide_spawn_agent_metadata=false` + `MultiAgentV2Config`
  defaults).

**General principle (already recorded on the task card):** a codex investigation
only has source up to the fork's *current* pinned codex version; higher-version
features must be brought in by a rebase first. If the operator wants the precise
v137 deltas characterized, the prerequisite is a `codex-upstream-rebase` to
`>=137`, after which this doc's §1/§5 should be re-validated.

---

## Appendix — primary citations (all under `codex/external/repos/codex-patched/codex-rs/`)

- Module surfaces: `core/src/tools/handlers/multi_agents_v2.rs`,
  `.../multi_agents.rs`
- v2 handlers: `.../multi_agents_v2/{spawn,wait,close_agent,send_message,followup_task,list_agents,message_tool}.rs`
- Shared + fork patch: `.../multi_agents_common.rs` (lines 242–243 plugin filter,
  258–287 config overlay, 332–337 `apply_spawn_agent_overrides`)
- Model-facing schemas: `.../multi_agents_spec.rs`
  (`create_spawn_agent_tool_v2`, `create_followup_task_tool`,
  `create_send_message_tool`, `create_list_agents_tool`, `create_wait_agent_tool_v2`)
- Registration + gating: `core/src/tools/spec_plan.rs:292-298` (`multi_agent_v2_enabled`,
  `collab_tools_enabled`), `:639-734` (`add_collaboration_tools`)
- Feature defaults: `features/src/lib.rs:940-949` (`Collab` default-on Stable;
  `MultiAgentV2` default-off UnderDevelopment)
- Config block: `core/src/config/mod.rs:957,998-1029` (`MultiAgentV2Config` +
  defaults), `:2212-2267` (`resolve_multi_agent_v2_config`)
- Fork agent-spawner: `core/src/tools/handlers/spawn_top_level_session.rs`
- Patch-surface: `codex/docs/implementation/patch-surface.md:808` (invariant 26),
  §15 "Plugin scope-axis replant" (~896–915) + "Rebase-resume v0.135.0" (~1093–1113)
- Spike doc: `plans/codex-child-spawn-tools.md` (shipped 2026-05-26)
- Related tasks (`.ralph-overview/data.json`):
  `codex-engine-ralph-member-enablement`, `codex-child-spawn-tools`,
  `agent-tree-rpc`, `plugin-scope-agents`
