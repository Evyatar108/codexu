# Spike: codex v1 (Collab) vs v2 (MultiAgentV2) subagent dual-support (D-002)

**Task:** `codex-member-skill-agent-subagent-fanout` (D-002, dual-support gate)
**Date:** 2026-06-09
**Engine:** codex-cli `0.135.0-copilot-api.1`
**Author:** crews member `spike-v1v2-dualsupport` (ralph-pipeline)
**Companion:** the v2 side is already **GO** — see
`.ralph/investigations/codex-spawn-agent-write-child-smoke/findings.md` (commit `69de6def`).

## VERDICT

- **v1 (Collab) write-child smoke: GO — all 5 capabilities PASS.** A codex v1
  `multi_agent_v1.spawn_agent` child edited a file, committed it, the commit was
  parent-visible after the child exited, and the child's structured `<review-meta>`
  was recovered to the parent (via `wait_agent`, NOT `list_agents`).
- **Dual-support is FEASIBLE.** Both v1 and v2 can run ralph's write/review
  fan-out children. BUT the lowering recipe MUST emit a **different tool shape per
  system** — the tool *sets*, *names*, *schemas*, and *retrieval paths* all differ.
- **Detection is deterministic and tool-presence-based** (no config probe needed):
  exactly one subagent surface is ever active, distinguishable by which tools the
  member sees (`followup_task`/`list_agents` ⇒ v2; namespaced `multi_agent_v1.*` +
  `send_input`/`resume_agent` and NO `followup_task`/`list_agents` ⇒ v1).

**One-line recommendation for the plan:** Replace the current v2-required
`preflightProse()` STOP with a **detect-and-branch** preamble that emits BOTH a v1
recipe (`spawn_agent{message}` → `wait_agent{targets,timeout_ms}` → read
`status[target].completed`) and a v2 recipe (the existing `spawn_agent{task_name,message}`
→ `wait_agent{timeout_ms}` → `list_agents` → `agents[].agent_status.completed`),
selected at runtime by tool presence; keep "refuse to silently degrade" only for the
case where NEITHER surface is present.

---

## 1. The 5 capabilities — v1 pass/fail with evidence

| # | Capability | v1 result | Evidence |
|---|---|---|---|
| 1 | Child runs with WRITE access to work_dir | PASS | child edited `target.txt` in the scratch repo cwd |
| 2 | Child makes a file EDIT | PASS | `target.txt \| 3 ++- · 1 file changed, 2 insertions(+), 1 deletion(-)` |
| 3 | Child COMMITs it (git commit in the worktree) | PASS | commit `d2f086f91f48ffbbc5718171aca72de4e7bbe3da` |
| 4 | Edit + commit PARENT-VISIBLE after child exits | PASS | parent's OWN read-only `git log`/`git show` (transcript item_6/item_7) shows `d2f086f`; lead-side independent re-inspection confirms |
| 5 | Child emits PARSEABLE output recovered by parent | PASS | parent recovered the verbatim `<review-meta>{...}</review-meta>` from the `wait_agent` result's `Completed` status → `-o` last-message file |

### Commit SHA (the child's write)

```
d2f086f91f48ffbbc5718171aca72de4e7bbe3da  v1 child write smoke: EDITED_BY_V1_COLLAB_CHILD_9Z4K
3d133c3...                                 initial scratch commit (parent baseline)
```

### Parsed child output (capability 5), recovered by the parent (`v1-last-message.txt`)

```
<review-meta>{"wrote_file": true, "committed": true, "commit_sha": "d2f086f91f48ffbbc5718171aca72de4e7bbe3da", "child_id": "v1_write_child"}</review-meta>
```

### `target.txt` after the run (lead-side independent inspection — NOT agent self-report)

```
ORIGINAL CONTENT - line to be edited by the v1 child
EDITED_BY_V1_COLLAB_CHILD_9Z4K
```

### Runtime self-report (matches source exactly)

The parent agent's final answer stated: *"I called `multi_agent_v1.spawn_agent`;
`followup_task` and `list_agents` were not available on this v1 surface."* This
independently confirms both (a) the v1 tool is **namespaced** (`multi_agent_v1.*`)
and (b) the v1 tool-set lacks `followup_task`/`list_agents` — exactly as the source
predicts (§2).

## 2. Smoke mechanics

- **Scratch repo (isolated):** a fresh `git init` repo at `%TEMP%\v1-collab-smoke`
  with baseline commit `3d133c3` containing `target.txt` (sentinel `ORIGINAL
  CONTENT`) and `README.md`. Fully separate from the codexu tree.
- **Invocation (forces v1, disables v2):**
  `codex exec -C <scratch> --json -c features.multi_agent_v2=false -c features.multi_agent=true --dangerously-bypass-approvals-and-sandbox -o v1-last-message.txt <prompt>`.
  Setting `multi_agent_v2=false` overrides any global `~/.codex/config.toml`;
  `multi_agent=true` is the default-on Collab key, set explicitly for unambiguity.
  `CODEX_EXEC_TIMEOUT_MS=1200000` confirmed at User scope; wall-clock ~2m20s
  (10:43:27 → 10:45:47), exit 0. Git Bash put first on PATH.
- **Prompt design (forces the v1 write-child path, rules out the parent writing):**
  the top-level agent was told it MUST delegate, must NOT edit files or create
  commits itself, only read-only `git log`/`git show` permitted to the parent, and
  that on v1 there is NO `followup_task`/`list_agents` so the task goes in
  `spawn_agent.message` and the result is read from `wait_agent`. The transcript
  confirms the parent's only command executions were read-only `git show --stat HEAD`
  (item_6) and `git log --oneline -5` (item_7) — so commit `d2f086f` was produced by
  the **child** (thread `019ead7c-2136-...`), not the parent (thread `019ead7b-9298-...`).
- **Artifacts (this dir):** `v1-smoke-prompt.txt`, `v1-codex-exec-transcript.jsonl`,
  `v1-last-message.txt`.

### Transcript trace (key events)

1. parent `agent_message` (item_1): names the available tool as `multi_agent_v1.spawn_agent`,
   notes `wait_agent` present but `followup_task`/`list_agents` absent.
2. `collab_tool_call` `spawn_agent` (item_2), sender thread `019ead7b-...`, child thread
   `019ead7c-2136-7382-84ac-c6e27b86ef3f` created; the child's task is carried in the
   spawn `prompt`/`message` (NO `followup_task` step).
3. parent `wait_agent` → child completes; parent recovers the child's `Completed` final message.
4. parent read-only `git show --stat HEAD` (item_6) + `git log --oneline -5` (item_7) → `d2f086f`.
5. parent final answer (item_8) carries the child's verbatim `<review-meta>` block. Exit 0.

---

## 3. v1 vs v2 comparison (SOURCE-VERIFIED)

All paths under `codex/external/repos/codex-patched/codex-rs/`.

### 3a. Enablement + precedence

| | v1 (Collab) | v2 (MultiAgentV2) |
|---|---|---|
| Feature id / config key | `Feature::Collab` / `multi_agent` | `Feature::MultiAgentV2` / `multi_agent_v2` |
| Default | **ON** (`default_enabled: true`, `Stage::Stable`) — `features/src/lib.rs:940-944` | **OFF** (`default_enabled: false`, `Stage::UnderDevelopment`) — `features/src/lib.rs:946-950` |
| Gate fn | `collab_tools_enabled = multi_agent_v2_enabled \|\| Collab` — `spec_plan.rs:296-298` | `multi_agent_v2_enabled = features.enabled(MultiAgentV2)` — `spec_plan.rs:292-294` |
| Selection | `add_collaboration_tools`: `if multi_agent_v2_enabled { v2 } else { v1 }` — `spec_plan.rs:641-726` | same branch, v2 arm `spec_plan.rs:642-694` |

**Precedence: v2 WINS.** If both features are on, only the v2 tool surface is
registered (`spec_plan.rs:642`). The model NEVER sees both simultaneously — exactly
one subagent surface is active. The **default** codex config (no flags) is **v1
Collab**; v2 is opt-in. The prior v2 smoke explicitly set `multi_agent_v2=true`.

### 3b. Tool SET (which tools the model sees)

| Tool | v1 | v2 |
|---|:---:|:---:|
| `spawn_agent` | ✔ (namespaced `multi_agent_v1`) | ✔ (plain) |
| `wait_agent` | ✔ (takes `targets[]`) | ✔ (no targets) |
| `close_agent` | ✔ | ✔ |
| `send_input` | ✔ | ✘ |
| `resume_agent` | ✔ | ✘ |
| `send_message` | ✘ | ✔ |
| `followup_task` | ✘ | ✔ |
| `list_agents` | ✘ | ✔ |

Registration: v1 arm adds `SpawnAgentHandler`, `SendInputHandler`,
`ResumeAgentHandler`, `WaitAgentHandler`, `CloseAgentHandler` (`spec_plan.rs:704-724`);
v2 arm adds `SpawnAgentHandlerV2`, `SendMessageHandlerV2`, `FollowupTaskHandlerV2`,
`WaitAgentHandlerV2`, `CloseAgentHandlerV2`, `ListAgentsHandlerV2` (`spec_plan.rs:653-694`).
Handler dirs confirm: `handlers/multi_agents/{spawn,send_input,resume_agent,wait,close_agent}.rs`
vs `handlers/multi_agents_v2/{spawn,send_message,message_tool,list_agents,followup_task,wait,close_agent}.rs`.
**`followup_task` and `list_agents` are v2-only.** This is the single biggest reason
the recipe must differ per system — the current recipe is built around both.

### 3c. `spawn_agent` schema

| | v1 | v2 |
|---|---|---|
| Tool kind / name | `ToolSpec::Namespace(multi_agent_v1)` → `multi_agent_v1.spawn_agent` — `multi_agents_spec.rs:56-72`, `multi_agents/spawn.rs:30` | `ToolSpec::Function` → plain `spawn_agent` — `multi_agents_spec.rs:90-91`, `multi_agents_v2/spawn.rs:32` |
| Required fields | **none** (`JsonSchema::object(..., /*required*/ None, ...)`) — `multi_agents_spec.rs:69` | **`task_name` + `message`** — `multi_agents_spec.rs:102` |
| Args struct strictness | `#[derive(Deserialize)]` — **NOT** `deny_unknown_fields` (extra fields ignored) — `multi_agents/spawn.rs:227` | `#[serde(deny_unknown_fields)]` — `multi_agents_v2/spawn.rs:251-252` |
| `message` | `Option<String>` (or `items`) — `multi_agents/spawn.rs:229-230` | `String` (required) — `multi_agents_v2/spawn.rs:254` |
| `task_name` | absent from schema/args | `String` (required) — `multi_agents_v2/spawn.rs:255` |
| fork control | `fork_context: bool` — `multi_agents/spawn.rs:236` | `fork_turns: Option<String>` (`none`/`all`/N); `fork_context` REJECTED — `multi_agents_v2/spawn.rs:260-270` |
| Returns | `{agent_id, nickname}` — `multi_agents/spawn.rs:240-243` | `{agent_name, ...}` (canonical task path) |

Practical consequence: a literal `spawn_agent{task_name, message}` emission is valid
on BOTH (v1 ignores the unknown `task_name`; v2 requires it). But v1 needs the task
in `message` (no `followup_task` to dispatch it later), whereas the **current** v2
recipe deliberately spawns with no message and dispatches via `followup_task`
(`codex-lowering.mjs:288-296`). So a single literal shape does not cover both
retrieval flows.

### 3d. Result retrieval (the load-bearing asymmetry)

| | v1 | v2 |
|---|---|---|
| `wait_agent` args | `{targets: Vec<String>, timeout_ms}` — `multi_agents/wait.rs:218-223` | `{timeout_ms}` only, `deny_unknown_fields` — `multi_agents_v2/wait.rs:107-111` |
| `wait_agent` return | `{status: HashMap<target, AgentStatus>, timed_out}` — `multi_agents/wait.rs:225-229` | `{message: String, timed_out}` (a mailbox-change notification) — `multi_agents_v2/wait.rs:113-117` |
| Where the child's final answer lives | **in the wait result**: `status[target] == Completed(Option<String>)` — `protocol.rs:1585-1586` ("Contains the final assistant message") | **NOT in wait**: must call `list_agents` → `agents[].agent_status.completed` |
| Canonical retrieval | `spawn_agent{message}` → `wait_agent{targets:[id], timeout_ms}` → read `status[id].completed` | `spawn_agent{task_name,message}` → `wait_agent{timeout_ms}` → `list_agents` → `agents[].agent_status.completed` |

v2's `wait_agent` is a generic "wait for the next mailbox change" primitive with no
targets (`multi_agents_v2/wait.rs:79-97`), which is precisely why `list_agents` is
mandatory on v2. v1's `wait_agent` is target-scoped and returns the completed message
directly, so v1 needs no `list_agents`. **The smoke exercised exactly this v1 path
and recovered the `<review-meta>` from the wait result.**

### 3e. Execution semantics — IDENTICAL (no per-system difference)

Both arms call `session.services.agent_control.spawn_agent_with_metadata(config,
input_items/initial_operation, ..., environments: Some(turn.environments.to_selections()))`
— v1 `multi_agents/spawn.rs:123-138`, v2 `multi_agents_v2/spawn.rs:78-130`. Children
in BOTH share the parent's working tree / host filesystem (no per-child sandbox),
which is why write+commit are parent-visible immediately in both smokes. The
disjoint-write-set rule for concurrent write-children applies equally to both.

### 3f. Depth / topology — IDENTICAL, breadth-1 only (confirms prior art)

Both arms enforce single-level fan-out: a SubAgent session cannot call `spawn_agent`
at all — the fork-only SANDBOX PATCH gate `if matches!(turn.session_source,
SessionSource::SubAgent(_)) { return Err("spawn_agent is not available from subagent
sessions") }` is present in BOTH (`multi_agents/spawn.rs:57-61`,
`multi_agents_v2/spawn.rs:59-63`). v1 additionally enforces
`exceeds_thread_spawn_depth_limit(child_depth, max_depth)` (`multi_agents/spawn.rs:73-78`).
So parent-spawns-lenses, lenses-don't-spawn-grandchildren holds for both. **breadth-1
is sufficient for ralph's fan-out** (code-fixer / docs-updater / reviewer sites are all
single-level), unchanged from `codex-recursive-subagent-spawn` / `codex-child-spawn-tools`.

---

## 4. Detection mechanism for the recipe

**The recipe is a PROMPT; the member introspects its own tool surface at runtime.**
There is no need for the recipe to probe `~/.codex/config.toml` or query features —
because exactly one surface is ever active (§3a precedence), the active system is
**deterministically identifiable by tool presence**:

| Signal observed by the member | Active system |
|---|---|
| `followup_task` AND `list_agents` present (plain `spawn_agent`) | **v2** |
| `spawn_agent` only under `multi_agent_v1.*` namespace; `send_input`/`resume_agent` present; NO `followup_task`/`list_agents` | **v1** |
| none of the spawn/wait/close collaboration tools present | **neither** → genuinely refuse (the only legitimate STOP) |

The smoke proved the member can self-report this accurately ("I called
`multi_agent_v1.spawn_agent`; `followup_task`/`list_agents` were not available"). So a
detect-and-branch preamble is reliable. The cleanest discriminator to instruct on is
**"is `list_agents` available?"** — present ⇒ v2 path, absent ⇒ v1 path.

(Config-level corroboration if ever needed: v1 key `multi_agent` default-on; v2 key
`multi_agent_v2` default-off — `features/src/lib.rs:940-950`. But tool-presence is the
runtime-authoritative signal and needs no config read.)

---

## 5. Dual-support feasibility + what each side requires from the recipe

**Feasible: YES.** Both v1 and v2 children can write+commit+be-parent-visible+emit
parseable output (v1 proven here; v2 proven by `69de6def`). Neither is read-only.

What the recipe must encode per system:

- **v2 (existing recipe, mostly correct):** `spawn_agent{task_name, message}` (the
  prior smoke + this source review confirm `message` is REQUIRED — the shipped
  `codex-lowering.mjs:288-296` shape that omits `message` and defers to `followup_task`
  is schema-stale under `deny_unknown_fields`; pass the task in `spawn_agent.message`,
  optionally still `followup_task` for multi-step) → `wait_agent{timeout_ms}` →
  `list_agents` → `agents[].agent_status.completed` → JSON-validate → `close_agent`.
- **v1 (new):** `spawn_agent{message: <full task>}` (namespaced `multi_agent_v1.*`; do
  NOT rely on `task_name`; do NOT emit `followup_task`/`list_agents` — they don't
  exist) → `wait_agent{targets: [<agent_id>], timeout_ms}` → read
  `status[<target>].completed` for the child's final answer → JSON-validate →
  `close_agent{<agent_id>}`. `wait_agent` timeout min is shared infra; keep ≥ 10000.
- **Shared (both):** `fork_turns:"none"` analog (v1 uses `fork_context:false`, which is
  the default — don't set `fork_context:true`); omit `agent_type`/`model`/`reasoning_effort`;
  single-level fan-out only; disjoint write sets for concurrent write-children; FAIL HARD
  on `timed_out` / malformed JSON.

**The fallback the plan should encode** (if it chooses minimal change instead of full
dual-support): keep v2 as the required path but DETECT v1 and, instead of the blanket
`preflightProse()` STOP, emit the v1 recipe branch. Only STOP when NEITHER surface is
present. (Pure v2-required + degrade-to-manual is strictly worse now that v1 is proven
GO — it would refuse a perfectly capable default-config member.)

## 6. Scope caveats (what this smoke does and does NOT prove)

- DOES prove the v1 load-bearing primitives (write + commit + parent-visibility +
  parseable-output recovery) on the live `0.135.0-copilot-api.1` engine, and the exact
  v1 tool name/set/schema/retrieval at runtime.
- Does NOT prove reviewer FIDELITY (a real `<review-meta>` from an actual code review
  of a large diff, or a multi-round 5a/5b convergence). That belongs to the D-002 plan
  + a real codex-member `/implement-with-ralph` dogfood, not this cheap gate.
- Default copilot model + trivial single-file edit were used deliberately to isolate
  the capability question (mirrors the v2 smoke).
- v1's namespaced/possibly-deferred (behind tool-search) exposure did not impede the
  member from finding and calling the tool in this run; the plan should still instruct
  the member to locate `spawn_agent` via tool search if it isn't directly listed.
