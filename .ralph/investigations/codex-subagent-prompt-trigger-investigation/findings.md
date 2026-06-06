# Investigation: codex sub-agent spawn — the PROMPT/TRIGGER angle

**Task:** `codex-subagent-prompt-trigger-investigation`
**Mode:** READ-ONLY investigation (no source modified)
**Date:** 2026-06-06
**Fork codex version:** 0.135 (`external/repos/codex-patched`)
**Investigator:** `inv-subagent-prompt` (crews/ralph-pipeline)
**Companion (MECHANISM angle, read first):**
`.ralph/investigations/codex-upstream-multi-agent-v2-fork-impact/findings.md`

All paths below are under
`codex/external/repos/codex-patched/codex-rs/` unless noted.

---

## TL;DR / Verdict

**Question: based on codex's CURRENT prompt + tool descriptions, WHEN is the
model expected/instructed to spawn a sub-agent?**

- **The base/system prompt is SILENT on delegation.** None of the per-model
  base prompts (`gpt_5_1`, `gpt_5_2`, `gpt_5_codex`, `gpt-5.1-codex-max`,
  `gpt-5.2-codex`, `prompt_with_apply_patch_instructions`) mention sub-agents,
  spawning, delegation, or parallel-agent work. The only "collaborat*" hits are
  about *tone* and the `update_plan` tool. **ALL spawn-trigger guidance lives in
  the `spawn_agent` tool DESCRIPTION** (plus an optional v2-only developer-
  message usage-hint channel). A `core/templates/collab/experimental_prompt.md`
  with rich multi-agent guidance EXISTS but is **dead/unreferenced** in source
  (zero `include_str!`/path references across all crate sources) — it is **not**
  injected into any prompt today.

- **V1 (`Collab`, default ON) — guidance is STRONG but RESTRICTIVE (a gate, not
  an encouragement).** Under stock config the `spawn_agent` v1 description
  carries a long hardcoded block whose headline rule is:
  > "Only use `spawn_agent` **if and only if the user explicitly asks for
  > sub-agents, delegation, or parallel agent work.** Requests for depth,
  > thoroughness, research, investigation, or detailed codebase analysis **do
  > not** count as permission to spawn."
  So codex *is* told about delegation — but the instruction actively
  **suppresses** spontaneous spawning. A stock codex session will not self-
  initiate fan-out absent an explicit user request.

- **V2 (`MultiAgentV2`, default OFF) — guidance is ABSENT/MECHANICAL by
  default.** The `spawn_agent` v2 description only explains the task-path
  *mechanism* (canonical naming, tool inheritance, final-answer delivery,
  concurrency cap). It has **no hardcoded "when to spawn" block** and no
  restrictive gate. The "when" only appears if an operator sets
  `multi_agent_v2.usage_hint_text` (tool description) or
  `multi_agent_v2.root_agent_usage_hint_text` / `subagent_usage_hint_text`
  (injected developer message) — **all default `None`**. So v2 ships the
  capability essentially **un-prompted**.

- **Net verdict: codex's spawn capability is PRESENT but UNDER-PROMPTED toward
  use.** In v1 (the default surface) the prompt steers *away* from spawning
  unless the user explicitly asks. In v2 the prompt says *nothing* about when.
  This reinforces the companion doc's conclusion: the Ralph multi-lens
  degradation will **not** be fixed by codex "deciding to delegate on its own" —
  codex must be **explicitly driven** to spawn by an adapter (or by operator-
  supplied usage-hint text), because stock prompting either discourages (v1) or
  is silent (v2).

- **Fork did NOT modify any guidance/description TEXT.** Every `SANDBOX PATCH`
  near the multi-agent handlers is `plugin-scope-axis` (the subagent spawn-gate
  + plugin filter) or `D-002` (fork-only handlers) — none edit a description
  string. The only fork-authored text the model can ever see here is the
  subagent gate's **runtime reject** ("spawn_agent is not available from
  subagent sessions"), which fires only on a depth-2 spawn attempt and never
  appears in a tool description. For a top-level codex ralph member it never
  fires.

---

## 1. Q1 — Base/system prompt: does it mention delegation? (NO)

### 1a. Per-model base prompts are silent on spawning

The model-facing base instructions are the per-model prompt files in `core/`
(`gpt_5_1_prompt.md`, `gpt_5_2_prompt.md`, `gpt_5_codex_prompt.md`,
`gpt-5.1-codex-max_prompt.md`, `gpt-5.2-codex_prompt.md`,
`prompt_with_apply_patch_instructions.md`). A scan for
`sub-?agent|spawn|delegat|parallel agent|multi-?agent|collaborat` across all of
them returns **only** tone/`update_plan` matches — e.g.:

- `gpt_5_2_prompt.md:219` — "Keep the voice **collaborative** and natural, like
  a coding partner handing off work." (tone)
- `gpt_5_2_prompt.md:38` — the `update_plan` tool blurb (planning, not spawning)
- `gpt-5.2-codex_prompt.md:70` — "Tone: **collaborative**, concise, factual…"

There is **no** instruction anywhere in the base prompt about when to spawn,
delegate, or fan out to sub-agents. Conclusion: the base prompt neither
authorizes nor encourages delegation; it defers the entire "when" question to
the tool description.

### 1b. `core/templates/collab/experimental_prompt.md` is DEAD/legacy

There IS a richly-worded multi-agent system-prompt template at
`core/templates/collab/experimental_prompt.md`:

```
## Multi agents
You have the possibility to spawn and use other agents to complete a task. For example, this can be use for:
* Very large tasks with multiple well-defined scopes
* When you want a review from another agent. This can review your own work or the work of another agent.
* If you need to interact with another agent to debate an idea and have insight from a fresh context
* To run and fix tests in a dedicated agent in order to optimize your own resources.

This feature must be used wisely. For simple or straightforward tasks, you don't need to spawn a new agent.
...
```

**But it is not wired in.** A search for `experimental_prompt` / `templates/collab`
/ `collab/experimental_prompt` across every crate's sources (excluding `target/`)
returns **zero** references — no `include_str!`, no template-registry path. So
this "use it for large/review/debate/test tasks" guidance is **not** part of any
live prompt at 0.135. Do not credit codex with this guidance; treat it as a
stale artifact. (Flagged as possibly relevant to a future rebase — see §6.)

---

## 2. Q2 — V1 (`Collab`, default ON) tool descriptions: the WHEN guidance

V1 tools are registered as a namespace `multi_agent_v1`
("Tools for spawning and managing sub-agents.",
`multi_agents_spec.rs:11-12`). The model-facing strings:

### 2a. `spawn_agent` (v1) — `spawn_agent_tool_description`, `multi_agents_spec.rs:630-697`

The base line (always present):
> "Spawn a sub-agent for a well-scoped task. Returns the spawned agent id plus
> the user-facing nickname when available. Spawned agents inherit your current
> model by default. Omit `model` to use that preferred default; set `model` only
> when an explicit override is needed."
(`multi_agents_spec.rs:50,638-642` + `SPAWN_AGENT_INHERITED_MODEL_GUIDANCE:14`)

Then, **when `include_usage_hint == true` AND `usage_hint_text == None`** (this
is the stock default — see §4), the description appends a long hardcoded
guidance block (`multi_agents_spec.rs:659-696`). The load-bearing lines:

> "This spawn_agent tool provides you access to sub-agents that inherit your
> current model by default. … **Only use `spawn_agent` if and only if the user
> explicitly asks for sub-agents, delegation, or parallel agent work. Requests
> for depth, thoroughness, research, investigation, or detailed codebase
> analysis do not count as permission to spawn.**" (`:662-665`)

followed by four sub-sections:

- **`### When to delegate vs. do the subtask yourself`** (`:668-672`) — plan
  first; delegate concrete bounded *sidecar* tasks that can run in parallel;
  do **not** delegate urgent blocking work on the critical path; keep tightly-
  coupled/urgent work local.
- **`### Designing delegated subtasks`** (`:674-682`) — concrete, self-
  contained, materially-advancing, no duplicated work, disjoint write sets,
  prefer concrete code-change workers over read-only explorers.
- **`### After you delegate`** (`:684-689`) — call `wait_agent` **very
  sparingly** (only when blocked on the critical path); do non-overlapping work
  meanwhile; don't redo delegated work.
- **`### Parallel delegation patterns`** (`:691-695`) — run independent
  info-seeking subtasks in parallel; split implementation into disjoint slices.

**Reading:** this is *detailed, high-quality* delegation guidance, but its top
rule is a **hard gate**: spawn only on explicit user request; depth/research/
investigation explicitly do **not** authorize spawning. So v1's "WHEN" answer is
effectively: **almost never, unless the user said so.**

### 2b. Other v1 tools

- `send_input` (`:139-140`): "Send a message to an existing agent. Use
  interrupt=true to redirect work immediately. **You should reuse the agent by
  send_input if you believe your assigned task is highly dependent on the
  context of a previous task.**"
- `resume_agent` (`:218-220`): "Resume a previously closed agent by id so it can
  receive send_input and wait_agent calls."
- `wait_agent` (v1, `:235-236`): "Wait for agents to reach a final status.
  Completed statuses may include the agent's final message. Returns empty status
  when timed out. …"
- `close_agent` (v1, `:289`): "Close an agent and any open descendants when they
  are no longer needed … **Don't keep agents open for too long if they are not
  needed anymore.**"

None of these add a "when to spawn" trigger; they govern lifecycle after a
spawn decision has already been made.

---

## 3. Q3 — V2 (`MultiAgentV2`, default OFF) tool descriptions: mechanical only

### 3a. `spawn_agent` (v2) — `spawn_agent_tool_description_v2`, `multi_agents_spec.rs:699-737`

The description is **purely mechanical** (`:714-724`):
> "Spawns an agent to work on the specified task. If your current task is
> `/root/task1` and you spawn_agent with task_name "task_3" the agent will have
> canonical task name `/root/task1/task_3`. You are then able to refer to this
> agent as `task_3` or `/root/task1/task_3` interchangeably. … The spawned agent
> will have the same tools as you and the ability to spawn its own subagents.
> [inherited-model guidance] It will be able to send you and other running
> agents messages, and its final answer will be provided to you when it
> finishes. The new agent's canonical task name will be provided to it along
> with the message. [concurrency: `max_concurrent_threads_per_session = N`]"

Crucially, the v2 builder has **no hardcoded fallback guidance block**. Its
logic (`:726-736`):
- `include_usage_hint == false` → mechanical description only.
- `include_usage_hint == true` AND `usage_hint_text == Some` → mechanical + the
  operator-supplied text.
- `include_usage_hint == true` AND `usage_hint_text == None` (**stock default**)
  → **mechanical description only**, i.e. *no "when to spawn" guidance at all*.

So unlike v1, v2 never falls back to a built-in delegation rubric. The "when"
must be supplied externally.

### 3b. Other v2 tools

- `send_message` (`:167-168`): "Send a message to an existing agent. The message
  will be delivered promptly. Does not trigger a new turn."
- `followup_task` (`:198-199`): "Send a message to an existing non-root target
  agent **and trigger a turn** in that target. If the target is currently
  mid-turn, the message is queued …"
- `wait_agent` (v2, `:248-249`): "Wait for a mailbox update from any live agent
  … **Does not return the content**; returns either a summary of which agents
  have updates, or a timeout summary …"
- `close_agent` (v2, `:308`): identical wording to v1.
- `list_agents` (`:268-270`): "List live agents in the current root thread tree.
  Optionally filter by task-path prefix."

Again, lifecycle/mechanism only — no spawn trigger.

### 3c. The v2 developer-message usage-hint channel (second injection path)

V2 has a **second** way to inject "when" guidance, separate from the tool
description: a developer-update message placed into the conversation history.

- Resolver `session/multi_agents.rs::usage_hint_text` (whole file, 28 lines):
  returns `None` unless `MultiAgentV2` is enabled, then picks
  `subagent_usage_hint_text` for `SubAgent(ThreadSpawn)` sessions and
  `root_agent_usage_hint_text` for root-ish sources (`Cli|VSCode|Exec|Mcp|
  Custom|Unknown`), `None` otherwise.
- Injection site `session/mod.rs:2890-2913`: the resolved text is wrapped as a
  developer-update item and pushed into the turn's items.
- Fork-path handling `agent/control.rs:419-484`: when forking history into a
  child, the parent's root/subagent hint messages are **filtered out** of the
  forked history, and (for full-history forks) the `subagent_usage_hint_text` is
  re-injected as a fresh developer message for the child.

**All three config fields default `None`** (`config/mod.rs:1020-1026`), so under
stock config this channel injects **nothing**.

---

## 4. Q4 — What the model ACTUALLY SEES (stock vs v2-on)

### 4a. The config defaults that decide everything

`MultiAgentV2Config::default()` (`config/mod.rs:1012-1027`):
- `usage_hint_enabled: true`
- `usage_hint_text: None`
- `root_agent_usage_hint_text: None`
- `subagent_usage_hint_text: None`
- `hide_spawn_agent_metadata: false`
- `non_code_mode_only: false`

Feature defaults (`features/src/lib.rs:939-950`):
- `Collab` (key `multi_agent`): `Stage::Stable`, **default ON**
- `MultiAgentV2` (key `multi_agent_v2`): `Stage::UnderDevelopment`, **default OFF**

**Key wiring quirk:** in `spec_plan.rs::add_collaboration_tools`, BOTH the v1 and
v2 spawn-tool builders read `include_usage_hint` from
`multi_agent_v2.usage_hint_enabled` and `usage_hint_text` from
`multi_agent_v2.usage_hint_text` (`spec_plan.rs:662-663` for v2, `:712-713` for
v1). So even in **v1-only** stock mode, `include_usage_hint = true` (because that
field defaults true) and `usage_hint_text = None` → the v1 builder hits its
hardcoded-block branch.

### 4b. Stock config (Collab ON, MultiAgentV2 OFF) — what a real codex session sees

`collab_tools_enabled()` is true (Collab on) and `multi_agent_v2_enabled()` is
false, so `add_collaboration_tools` registers the **v1** tool set
(`spec_plan.rs:695-725`): `spawn_agent` v1, `send_input`, `resume_agent`,
`wait_agent` v1, `close_agent` v1.

The model sees the **v1 `spawn_agent` description WITH the full restrictive
delegation block** (§2a), because `include_usage_hint=true` + `usage_hint_text=
None`. Practical answer: **a stock codex session is told to spawn only if the
user explicitly asks for sub-agents/delegation/parallel work, and is told that
depth/research/investigation do NOT authorize spawning.** It also gets the
detailed when/how-to-delegate rubric — but gated behind that explicit-request
precondition. No developer-message usage hint is injected (v2 off).

> **Practical "does a real codex session spawn today?" answer:** rarely, and
> only when the user's prompt explicitly requests sub-agents / delegation /
> parallel agents. The default prompt posture is *do the work yourself*.

### 4c. `features.multi_agent_v2 = true` (everything else stock) — what changes

`multi_agent_v2_enabled()` becomes true, so `add_collaboration_tools` registers
the **v2** tool set (`spec_plan.rs:642-694`): `spawn_agent` v2, `send_message`,
`followup_task`, `wait_agent` v2, `close_agent` v2, `list_agents`.

The model sees the **v2 `spawn_agent` description = mechanical only** (§3a),
because `usage_hint_text=None`. The developer-message channel also injects
**nothing** (`root_agent_usage_hint_text=None`). Practical answer: **under v2,
the model gets the spawn capability with essentially NO instruction on when to
use it** — neither the v1 restrictive gate nor any encouragement. It is told
*how* task paths work, not *whether/when* to spawn. To add a "when," an operator
must set `multi_agent_v2.usage_hint_text` and/or
`multi_agent_v2.root_agent_usage_hint_text`.

### 4d. Side note — situational awareness (not a trigger)

`session/mod.rs:2876-2887` adds an `EnvironmentContext` section listing
currently-running subagents (`format_environment_context_subagents`). This is
*awareness of existing* agents, not guidance on *when to spawn* — it does not
move the trigger needle.

---

## 5. Q5 — Fork modifications to this guidance (NONE to the text)

`grep 'SANDBOX PATCH'` across `core/src/tools/handlers/` (the multi-agent
handler tree) returns only:

| File | Marker | What it is |
|---|---|---|
| `multi_agents_v2/spawn.rs:2,57-62` | `plugin-scope-axis — subagent gate` | reject `spawn_agent` when `turn.session_source` is `SubAgent(_)` |
| `multi_agents/spawn.rs:2,55` (v1) | `plugin-scope-axis` | the identical reject on the v1 handler |
| `multi_agents_common.rs:242-243,258-287` | `plugin-scope-axis` | subagent plugin filter + disable-overlay synthesis |
| `multi_agents/await_background_completion.rs:30`, `multi_agents/mod.rs:72,76`, `spawn_top_level_session.rs:25,86` | `plugin-scope-axis` / `D-002` | fork-only handlers (background-completion, top-level spawn) |

**None of these touch a description/prompt string.** The fork did not soften,
strengthen, or reword any spawn-trigger guidance. The v1 restrictive block and
the v2 mechanical description are **upstream-authored text**, unchanged by the
fork.

**The one fork-authored string the model can see** is the subagent gate's
runtime reject (`multi_agents_v2/spawn.rs:60-62`, mirrored in v1
`multi_agents/spawn.rs:55`):
> `"spawn_agent is not available from subagent sessions"`

This is returned as `FunctionCallError::RespondToModel` only **after** a
`SubAgent` session attempts `spawn_agent` (i.e. a depth-2 nested spawn). It is
**not** in any tool description, so it does not influence *when a top-level model
decides to spawn* — it only blocks the second level after the fact. For a codex
**ralph member (a top-level `Cli` session)** this gate never fires, so it has no
bearing on whether that member spawns lenses.

**Launcher/overlay:** a scan of `codex-rs-overlay/` for
`usage_hint|multi_agent_v2|spawn_agent` returns **zero** matches — the Copilot
launcher does **not** inject any `usage_hint_text` / `root_agent_usage_hint_text`
/ `multi_agent_v2` config. So the fork ships **stock upstream guidance** for both
v1 and v2.

---

## 6. Q6 — REBASE-GATED (v137) items — NOT guessed

Fork is pinned at **0.135**. The following are out-of-tree and were **not**
inferred:

- Any v137 changes to the v1 hardcoded delegation block wording, or to the v2
  mechanical description.
- Any v137 default-value changes for `usage_hint_enabled` / `usage_hint_text` /
  `root_agent_usage_hint_text` / `subagent_usage_hint_text`
  (operator-cited "cleaner follow-up and metadata defaults").
- Whether v137 wires the now-dead `core/templates/collab/experimental_prompt.md`
  (or a successor) back into a live prompt. At 0.135 it is unreferenced (§1b);
  whether a later release revives it is unknown without the diff.

Characterizing these precisely requires a `codex-upstream-rebase` to `>=137`,
after which §2–§4 should be re-validated. (Consistent with the companion doc §8.)

---

## 7. Verdict — strong / weak / absent?

| Surface | Spawn-trigger guidance | Strength | Direction |
|---|---|---|---|
| **Base system prompt** | none | **ABSENT** | — (silent) |
| **V1 `spawn_agent` (stock default)** | hardcoded block, "only if user explicitly asks…" + when/how rubric | **STRONG** | **RESTRICTIVE** (gates *against* spawning) |
| **V2 `spawn_agent` (stock default)** | mechanical task-path description only | **ABSENT / WEAK** | neutral (no "when") |
| **V2 + operator `usage_hint_text` set** | whatever the operator writes | depends on operator | configurable |
| **Fork-authored text** | subagent-gate reject only (runtime, depth-2) | n/a to top-level trigger | blocks nested spawn |

**Bottom line:** codex *does* get told about delegation — but only in v1, and the
instruction is a **gate that suppresses** spontaneous spawning ("if and only if
the user explicitly asks for sub-agents, delegation, or parallel agent work").
In v2 the prompt is **silent** on when. The **capability is present but
deliberately under-prompted toward use** on both surfaces. The base prompt never
raises delegation at all, and the one richly-encouraging template
(`experimental_prompt.md`) is dead code.

**Implication for the Ralph multi-lens degradation (ties to companion doc §5):**
do **not** expect a stock codex ralph member to self-initiate lens fan-out. In
v1 it is actively told not to spawn absent an explicit request; in v2 it is told
nothing about when. Closing the degradation therefore requires **explicitly
driving** the spawn — either a plugin-side adapter that calls
`spawn_agent`/`followup_task`/`wait_agent` directly, or (for v2) operator-set
`multi_agent_v2.usage_hint_text` / `root_agent_usage_hint_text` carrying the
fan-out instruction. Prompt-only nudging will not flip codex from "do it myself"
to "delegate."

---

## Appendix — primary citations

(all under `codex/external/repos/codex-patched/codex-rs/`)

- V1 spawn description + hardcoded block:
  `core/src/tools/handlers/multi_agents_spec.rs:630-697`
  (headline gate `:662-665`; sub-sections `:668-695`); base line `:50` +
  `SPAWN_AGENT_INHERITED_MODEL_GUIDANCE:14`.
- V2 spawn description (mechanical, no fallback):
  `core/src/tools/handlers/multi_agents_spec.rs:699-737`.
- Other tool strings: `send_input:139-140`, `send_message:167-168`,
  `followup_task:198-199`, `resume_agent:218-220`, `wait_agent v1:235-236`,
  `wait_agent v2:248-249`, `list_agents:268-270`, `close_agent v1:289` /
  `v2:308`; namespace `:11-12`.
- Tool registration + usage-hint wiring:
  `core/src/tools/spec_plan.rs::add_collaboration_tools:639-734`
  (v2 `:642-694`, v1 `:695-725`; `include_usage_hint`/`usage_hint_text` read
  from `multi_agent_v2` at `:662-663`,`:712-713`); gates `multi_agent_v2_enabled
  :292-294`, `collab_tools_enabled:296-298`.
- Config defaults: `core/src/config/mod.rs::MultiAgentV2Config` `:998-1027`
  (`usage_hint_enabled:true`, all `*usage_hint_text*:None`); resolver
  `:2212-2283`.
- Feature defaults: `features/src/lib.rs:939-950`
  (`Collab` Stable/ON; `MultiAgentV2` UnderDevelopment/OFF).
- V2 developer-message usage-hint channel: resolver
  `core/src/session/multi_agents.rs` (whole file); injection
  `core/src/session/mod.rs:2890-2913`; fork-history filter/inject
  `core/src/agent/control.rs:419-484`.
- Base per-model prompts (no delegation language):
  `core/gpt_5_1_prompt.md`, `core/gpt_5_2_prompt.md`,
  `core/gpt_5_codex_prompt.md`, `core/gpt-5.1-codex-max_prompt.md`,
  `core/gpt-5.2-codex_prompt.md`, `core/prompt_with_apply_patch_instructions.md`.
- Dead template: `core/templates/collab/experimental_prompt.md`
  (content present; zero source references).
- Fork patches (no description edits): `SANDBOX PATCH` markers in
  `core/src/tools/handlers/multi_agents_v2/spawn.rs:2,57-62`,
  `core/src/tools/handlers/multi_agents/spawn.rs:2,55`,
  `core/src/tools/handlers/multi_agents_common.rs:242-243,258-287`,
  plus `spawn_top_level_session.rs`, `multi_agents/mod.rs`,
  `multi_agents/await_background_completion.rs`. Subagent-gate reject string:
  `multi_agents_v2/spawn.rs:60-62`.
- Launcher/overlay: zero `usage_hint|multi_agent_v2|spawn_agent` matches under
  `codex-rs-overlay/`.
- Companion (MECHANISM): `.ralph/investigations/codex-upstream-multi-agent-v2-fork-impact/findings.md`.
