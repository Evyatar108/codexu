# Investigation: Can a codex 0.135 sub-agent recursively spawn further sub-agents?

**Question:** In codex 0.135 (our fork), when a codex agent spawns a sub-agent, can that
SUB-AGENT ITSELF spawn further sub-agents (recursion / depth > 1)? Or is spawning
depth-limited to 1 level, the way Claude Code's Task-tool sub-agents cannot spawn their own?

**Why it matters:** We are deciding whether to switch the crews member engine from copilot
to codex, and a prior "runaway spawn" incident is being cited. We need the TRUE spawn
topology — breadth (one parent → many children) vs depth (children → grandchildren) — and
whether any nesting guard exists.

**Method:** Read-only source audit of the patched submodule at
`codex/external/repos/codex-patched/codex-rs/` (version `0.135.0-copilot-api.1`), plus the
fork overlay at `codex/codex-rs-overlay/`, plus the wrapper's `docs/implementation/patch-surface.md`,
cross-checked against the behaviorally-verified spike artifacts in
`.ralph/jobs/codex-ralph-member-multi-agent-adapter/`.

---

## VERDICT

| Feature | Default | In OUR FORK (0.135) | Upstream-native (no fork patch) |
|---|---|---|---|
| **v1 Collab** (`multi_agent`) | **ON** | **DEPTH-LIMITED-TO-1** | DEPTH-LIMITED-TO-1 *by default* (`agent_max_depth=1`), but **user-raisable** via `agents.max_depth` |
| **v2 MultiAgentV2** (`multi_agent_v2`) | OFF | **DEPTH-LIMITED-TO-1** | **RECURSIVE-CAPABLE** (no depth cap at all) |

**One-line answer:** In our fork, a spawned sub-agent **cannot** spawn further sub-agents — for
**both** v1 and v2 — because a fork-only "plugin-scope-axis" SANDBOX PATCH withholds the
`spawn_agent` tool from every `SessionSource::SubAgent(_)` session at the tool-spec layer
**and** rejects it again at the handler layer. This makes codex's effective in-process spawn
topology identical to Claude Code's Task tool: **the root spawns many children (breadth), but
children cannot spawn grandchildren (no depth)**. The decisive guard is the fork patch — NOT the
upstream `agent_max_depth` counter, which is bypassed for v2 and user-raisable for v1.

**Most decisive citation:**
`codex/external/repos/codex-patched/codex-rs/tools/src/tool_config.rs:223-228` —
```rust
// SANDBOX PATCH: plugin-scope-axis
let include_spawn_agent = include_collab_tools
    && match session_source {
        SessionSource::SubAgent(_) => false,
        _ => true,
    };
```
`include_collab_tools = include_multi_agent_v2 || features.enabled(Feature::Collab)`
(`tool_config.rs:221`), so this single gate covers **both** v1 and v2: any subagent session is
denied the `spawn_agent` tool entirely.

---

## Q1 — v1 Collab: is the child given the spawn tool?

**Answer: No (in the fork). Upstream default also caps at depth 1, but is user-configurable.**

Feature definition (`features/src/lib.rs:939-944`): `Feature::Collab` key `multi_agent`,
`Stage::Stable`, `default_enabled: true`.

**Fork tool-spec gate (decisive):** `tool_config.rs:223-228` sets `include_spawn_agent = false`
for any `SessionSource::SubAgent(_)`. The child therefore never receives the `spawn_agent` tool
in its advertised tool set.

**Fork runtime handler reject (defense-in-depth):**
`core/src/tools/handlers/multi_agents/spawn.rs:55-61` — at the very top of `handle_spawn_agent`:
```rust
// SANDBOX PATCH: plugin-scope-axis — spawn_agent is not available from subagent sessions.
if matches!(turn.session_source, SessionSource::SubAgent(_)) {
    return Err(FunctionCallError::RespondToModel(
        "spawn_agent is not available from subagent sessions".to_string(),
    ));
}
```

**Upstream depth machinery (present, but secondary):** the v1 handler also computes
`child_depth = next_thread_spawn_depth(&session_source)` and rejects when
`exceeds_thread_spawn_depth_limit(child_depth, max_depth)` (`multi_agents/spawn.rs:72-78`). With
`DEFAULT_AGENT_MAX_DEPTH = 1` (`core/src/config/mod.rs:195`):
- A root session has `session_depth = 0` (`agent/registry.rs:63-68`), so its child is depth
  `0+1 = 1` (`registry.rs:71-73`); `1 > 1` is false → root **can** spawn (breadth allowed).
- A depth-1 subagent's child would be depth `1+1 = 2`; `2 > 1` is true → blocked.

Additionally, `apply_spawn_agent_overrides` **disables `Collab` on the child config** once
`child_depth >= agent_max_depth` (`multi_agents_common.rs:332-337`), and the same disable is
re-applied on session init (`session/mod.rs:488-494`) and on resume
(`agent/control.rs:584-590`). So upstream v1 also withholds the spawn tool from a depth-1 child
*by default*.

**Important caveat for v1:** `agent_max_depth` is user-configurable via `agents.max_depth`
(`config/mod.rs:799-800` doc "Maximum nesting depth allowed for spawned agent threads";
validated `>= 1` at `config/mod.rs:3081-3084`). So in *upstream* v1, a user could set
`agents.max_depth = 3` and get depth-3 recursion. **In our fork this is moot** — the
`SubAgent(_)` tool-spec gate fires regardless of `agent_max_depth`, so a child never gets the
tool no matter how high the depth cap is set.

## Q2 — v2 MultiAgentV2: can a v2-spawned sub-agent spawn further sub-agents?

**Answer: No in the fork (same SANDBOX PATCH). But upstream-native v2 is RECURSIVE-CAPABLE — it
has NO depth cap.**

Feature definition (`features/src/lib.rs:945-950`): `Feature::MultiAgentV2` key
`multi_agent_v2`, `Stage::UnderDevelopment`, `default_enabled: false`.

**Same fork gates apply:** the v2 handler carries the identical SANDBOX PATCH at the top of
`handle_spawn_agent` (`core/src/tools/handlers/multi_agents_v2/spawn.rs:57-63`), and the
`tool_config.rs:223-228` `include_spawn_agent` gate is feature-agnostic (covers v2 via
`include_collab_tools`). So in the fork, a v2 subagent is denied `spawn_agent` exactly like v1.

**Upstream v2 has NO depth enforcement (the key asymmetry):**
- The v2 spawn handler imports only `next_thread_spawn_depth` and **never** calls
  `exceeds_thread_spawn_depth_limit` (`multi_agents_v2/spawn.rs:7`; verified by grep — 0 matches
  for `exceeds_thread_spawn_depth_limit` in the entire v2 spawn file). It computes `child_depth`
  at line 77 purely for labeling the child's `thread_spawn_source`, then proceeds to spawn with
  no cap check.
- Every "disable Collab/SpawnCsv on deep child" guard is explicitly **skipped when v2 is on**,
  via the `&& !config.features.enabled(Feature::MultiAgentV2)` clause:
  - `multi_agents_common.rs:333` (`apply_spawn_agent_overrides`)
  - `session/mod.rs:490` (session init)
  - `agent/control.rs:586` (resume-from-rollout)
- `max_concurrent_threads_per_session` returns `Some(..)` only under v2
  (`core/src/tools/spec_plan.rs:353-359`) — that is a **breadth** cap, not depth (see Q4).

Net: **without the fork patch, upstream v2 would let a child spawn grandchildren indefinitely**
(unbounded depth). The fork's `SubAgent(_)` gate is the sole thing that makes v2 depth-limited
in our build.

## Q3 — Is there any explicit depth cap / recursion guard / is_subagent flag?

**Yes — two independent fork guards plus an upstream (v1-only) depth counter.**

1. **Fork tool-spec gate (both v1+v2):** `tool_config.rs:223-228` — `include_spawn_agent = false`
   for `SessionSource::SubAgent(_)`. Tool is never advertised to children.
2. **Fork runtime handler rejects (both v1+v2):** `multi_agents/spawn.rs:57-61` and
   `multi_agents_v2/spawn.rs:59-63` — reject `SubAgent(_)` with
   `"spawn_agent is not available from subagent sessions"`.
3. **Upstream depth counter (v1 + agent-jobs + resume only):**
   - `next_thread_spawn_depth` / `exceeds_thread_spawn_depth_limit` (`agent/registry.rs:71-77`):
     `depth > max_depth`.
   - `DEFAULT_AGENT_MAX_DEPTH: i32 = 1` (`config/mod.rs:195`); config field doc "Maximum nesting
     depth allowed for spawned agent threads" (`config/mod.rs:799-800`).
   - Enforced in v1 spawn (`multi_agents/spawn.rs:72-78`), SpawnCsv/agent-jobs
     (`tools/handlers/agent_jobs.rs:115-121`), and resume (`multi_agents/resume_agent.rs:48-50`).
   - **Not** enforced in the v2 spawn path.

The relevant `SubAgent` source variant is `SessionSource::SubAgent(SubAgentSource::ThreadSpawn { depth, .. })`
(`protocol/src/protocol.rs:2566-2569`); the child's session source is built by
`thread_spawn_source(...)` which always returns `SubAgent(ThreadSpawn{..})`
(`multi_agents_common.rs:143-167`). That is precisely what trips guards (1) and (2) on the child.

**Patch-surface contract:** invariant 26 (`docs/implementation/patch-surface.md` §14) states the
intent in plain language — *"…`spawn_agent` stays top-level-only."* — enforced by the overlay
test `codex-rs-overlay/codex-invariant-tests/tests/plugin_scope_filtering.rs`. The replant note
(§15, "Plugin scope-axis replant", item 4) lists all four enforcement points to preserve across
rebases: the `tool_config.rs` gate, the `spec_plan.rs` registration, and the v1+v2 handler
rejects.

**Escape hatch — `spawn_top_level_session` (NOT recursion):** there is one fork-only tool that a
subagent *can* call — but it does NOT create an in-process nested sub-agent. It is registered
only for `SubAgent(SubAgentSource::ThreadSpawn{ agent_role: Some("agent-spawner"), .. })`
(`tool_config.rs:230-236`) and, when invoked, POSTs to the **Happy daemon** control URL
(`HAPPY_DAEMON_CONTROL_URL`, loopback-validated) at `/spawn-session-from-session` to create a
brand-new **independent top-level** codex session out-of-process
(`core/src/tools/handlers/spawn_top_level_session.rs:56-113`). It is a daemon-mediated
orchestration primitive for codexu/Happy, requires the `agent-spawner` role + daemon env vars,
and does not increase in-process thread-tree depth. The in-process `spawn_agent` path is closed
to all subagents (including `agent-spawner` ones — the v1/v2 handler rejects have no role
exemption).

## Q4 — What IS bounded?

- **Depth (in-process thread nesting):**
  - Fork: hard-capped at 1 for both v1 and v2 by the `SubAgent(_)` tool gate — children cannot
    spawn at all.
  - Upstream: capped by `agent_max_depth` (default 1, user-raisable) for v1 / SpawnCsv / resume;
    **not** capped for v2.
- **Breadth (concurrent live children per session):**
  - `max_concurrent_threads_per_session` — `Some(config.multi_agent_v2.max_concurrent_threads_per_session)`
    **only when v2 is enabled**, else `None` (`spec_plan.rs:353-359`). This limits how many child
    threads are concurrently alive, i.e. BREADTH; it has nothing to do with depth.
  - `AgentRegistry::reserve_spawn_slot` enforces `agent_max_threads`; exceeding it returns
    `CodexErr::AgentLimitReached { max_threads }` (`agent/registry.rs:80-90`). Also a breadth cap.

So: **breadth is throttled** (slot reservation + per-session concurrent-thread cap), and **depth
is hard-capped at 1 in the fork**. There is no scenario in our fork where a child spawns a
grandchild in-process.

## Q5 — Empirical cross-check (the cited "runaway" incident)

**Artifacts:** `.ralph/jobs/codex-ralph-member-multi-agent-adapter/` — `ralph-run1.log` (~638 KB,
the codex-iteration-engine run), `prd.json` (US-002), `spike-verdict.json` (the D-003 behavioral
spike), `job-state.json`.

**What the spike actually verified (behavioral ground truth).** `spike-verdict.json` has
`verdict: "GO"` and an `operationalFindingsForRecipe` list produced by *running* codex 0.135
`multi_agent_v2`. Two findings directly answer this investigation:

> "Spawn children with `fork_turns="none"` so each child starts with a CLEAN context (only its
> task message). Without it the child inherits the parent's full prompt and **recursively
> re-runs the protocol -> hits the fork's subagent spawn-gate ('spawn_agent is not available
> from subagent sessions')** and task-path confusion (/root/X/X)."

> "**The fork's plugin-scope-axis subagent gate blocks a CHILD from spawning grandchildren** ->
> the recipe must keep the multi-lens fan-out **SINGLE-LEVEL** (parent spawns lenses; lenses must
> not spawn)."

These behavioral findings independently confirm the source analysis: the fork gate fires at
runtime, and child→grandchild spawning is impossible. US-002's acceptance criteria bake this in
as a hard requirement — *"single-level fan-out"* (`prd.json` US-002, criteria + notes).

**What `ralph-run1.log` shows (breadth + re-entry, not depth).** Pattern counts over the 6,455-line
log: the literal token `spawn_agent`/`spawn-agent` appears only ~6 times — and those occurrences
are (a) inside the embedded spike-verdict findings, (b) impl-prompt guardrails that literally say
*"DO NOT spawn ANY sub-agents during implementation. Do NOT call spawn_agent / send_input / …"*
(`ralph-run1.log` L6039, L6413). There are **zero** `AgentLimitReached`, zero
`agent depth limit reached`, and zero `max_concurrent` lines. The single occurrence of the word
"runaway" (L1213) is unrelated skill-authoring prose. The header confirms this is the
**iteration ENGINE** run (`Iteration engine: codex`, line 3), i.e. codex driving the Ralph impl
loop — not a transcript of a successful infinite-depth agent tree.

**Convergence.** `job-state.json` shows the job ultimately `COMPLETED`, 6/6 stories passed, 7
iterations — but via the copilot-engine fallback (`ralph-run2-copilot.log`,
`ralph-run3-copilot.log`); the codex-engine run1 is the problematic one. The known-issue
framing (and the memory record for this task) is that the codex *iteration engine* exhibited a
runaway/hang, with workaround `iterationEngine codex -> copilot` — a separate phenomenon from the
`spawn_agent` topology this investigation settles.

---

## What this means for the "runaway-pathology" framing

The framing "sub-agents spawning sub-agents" is **NOT an accurate description of the codex
in-process spawn topology in our fork.** The fork hard-blocks child→grandchild spawning at two
independent layers (tool-spec gate + handler reject), for both v1 and v2, and the behavioral
spike confirms the gate fires in practice. A spawned lens/sub-agent simply does not have the
`spawn_agent` tool and is rejected if it tries.

What the spike *did* observe — and what likely seeded the "runaway" intuition — is a **breadth +
prompt-inheritance re-entry** pathology, not depth recursion: when children were spawned WITHOUT
`fork_turns="none"`, each child inherited the parent's entire prompt and tried to *re-run the
whole multi-lens protocol itself* (attempting to spawn its own lenses). Those attempts were
**rejected by the subagent gate** ("spawn_agent is not available from subagent sessions") and
produced task-path confusion (`/root/X/X`) and wasted child turns — amplification at a single
level, plus a separately-tracked codex iteration-engine hang, **not** an unbounded recursive
tree. The mitigation is the documented recipe contract: `fork_turns="none"` + single-level
fan-out + fail-hard on timeout.

**Bottom line for the engine-switch decision:** codex 0.135 (our fork) is, for in-process
spawning, topologically equivalent to Claude Code's Task tool — **one level of fan-out, no
recursion**. Recursive grandchild spawning is not a risk in this fork. The real risks to weigh
are (a) the separate codex *iteration-engine* hang/runaway (mitigated today by running the
iteration engine on copilot), and (b) breadth amplification if a fan-out recipe omits
`fork_turns="none"` — both orthogonal to spawn depth.

---

### Source map (verified, file:line)

| Claim | Citation |
|---|---|
| `Collab` key `multi_agent`, Stage Stable, default ON | `features/src/lib.rs:939-944` |
| `MultiAgentV2` key `multi_agent_v2`, UnderDevelopment, default OFF | `features/src/lib.rs:945-950` |
| `SpawnCsv` key `enable_fanout`, default OFF | `features/src/lib.rs:951-956` |
| **Fork tool-spec gate: no spawn_agent for any SubAgent (both v1+v2)** | `tools/src/tool_config.rs:221-228` |
| `spawn_top_level_session` registered only for agent-spawner subagent | `tools/src/tool_config.rs:230-236` |
| Fork handler reject (v1) | `core/src/tools/handlers/multi_agents/spawn.rs:55-61` |
| Fork handler reject (v2) | `core/src/tools/handlers/multi_agents_v2/spawn.rs:57-63` |
| v1 enforces upstream depth cap | `core/src/tools/handlers/multi_agents/spawn.rs:72-78` |
| v2 does NOT call exceeds_thread_spawn_depth_limit (grep: 0 matches) | `core/src/tools/handlers/multi_agents_v2/spawn.rs` (imports only `next_thread_spawn_depth`, L7) |
| depth helpers `next_thread_spawn_depth` / `exceeds_thread_spawn_depth_limit` | `core/src/agent/registry.rs:63-77` |
| child config "disable Collab" override is v1-only (`&& !MultiAgentV2`) | `core/src/tools/handlers/multi_agents_common.rs:332-337`; `session/mod.rs:488-494`; `agent/control.rs:584-590` |
| `DEFAULT_AGENT_MAX_DEPTH = 1`; config doc; validation `>=1` | `core/src/config/mod.rs:195`, `:799-800`, `:3076-3084` |
| `max_concurrent_threads_per_session` = breadth cap, v2-only | `core/src/tools/spec_plan.rs:353-359` |
| breadth slot reservation → `AgentLimitReached` | `core/src/agent/registry.rs:80-90` |
| child session source is `SubAgent(ThreadSpawn{..})` | `core/src/tools/handlers/multi_agents_common.rs:143-167`; `protocol/src/protocol.rs:2566-2569` |
| `spawn_top_level_session` POSTs to Happy daemon (out-of-process, not nested) | `core/src/tools/handlers/spawn_top_level_session.rs:56-113` |
| patch-surface invariant 26 "spawn_agent stays top-level-only" + overlay test | `codex/docs/implementation/patch-surface.md` §14 (L808), §15 replant (L896-915) |
| behavioral confirmation: gate blocks child→grandchild, single-level | `.ralph/jobs/codex-ralph-member-multi-agent-adapter/spike-verdict.json` (operationalFindingsForRecipe #1, #4) |
| US-002 requires single-level fan-out | `.ralph/jobs/codex-ralph-member-multi-agent-adapter/prd.json` (US-002) |
| run1 = codex iteration engine; converged via copilot fallback | `.ralph/jobs/codex-ralph-member-multi-agent-adapter/ralph-run1.log:3`; `job-state.json` |
