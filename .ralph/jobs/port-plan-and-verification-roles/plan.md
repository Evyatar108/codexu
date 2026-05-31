# Plan — Port `plan` and `verification` Agent Roles to codex (v0.135.0)

Job: `port-plan-and-verification-roles`
Branch: `ralph/plan-port-plan-and-verification-roles`
Plan worktree: `D:/harness-efforts/codexu/.ralph/jobs/port-plan-and-verification-roles/worktree/plan`
Target: codex submodule (`codex/external/repos/codex-patched/codex-rs/`)
Submodule HEAD probed: `03fe64287` (`rebase: merge upstream rust-v0.135.0 into sandbox-patches`)

---

## 0. Executive recommendation (TL;DR)

| Item | Recommendation |
|---|---|
| Packaging | **Option B — canonical SANDBOX PATCH in `core/src/agent/role.rs` + two new TOMLs under `core/src/agent/builtins/`** |
| Prereq seam? | **No.** Designing an `inventory!`-style external registration hook in role.rs costs the same edit budget as the additive entries and adds permanent global-init complexity for one-off use. Reject the prereq-split. |
| Bundle vs split | **Bundle both roles in a single PR/commit.** They share the same match arm in `config_file_contents` and the same `LazyLock<BTreeMap>` block. |
| LoC delta | ~30 LoC in `role.rs` (2 `BTreeMap` entries + 2 match arms) + 2 new TOML files (~25 + ~35 LoC). Net: 1 modified upstream-canonical file, 2 new files. |
| Conflict surface | Same as existing `agent-spawner` patch (invariant 26 in patch-surface.md §14). Additive `BTreeMap::from([…])` entries rarely conflict in rebase. |
| Unblocks | Originally marked BLOCKED pending "manifest learns `[agents.<role>]`" per native-agent-parity research. That seam never materialized upstream; v0.135.0 still has no plugin-manifest `[agents.<role>]` block. We unblock by accepting Option B (the same path the research called "ship via `include_str!()` in role.rs match-arm (tolerable conflict)"). |

---

## 1. Background and provenance

- The original `native-agent-parity` research (run 2026-05-14, see `.ralph-overview/data.json` log entry id `native-agent-parity/…`) surveyed Claude Code's six built-in subagents and recommended porting three: `explorer` (fill empty stub — separate task `port-explorer-prompt`), `plan` (new), `verification` (new). The other three are skipped: `general-purpose` (redundant with codex's `worker`), `statusline-setup` (Claude-specific), `claude-code-guide` (defer).
- The task statement framing ("Today these roles exist in upstream-canonical TOML formats but role.rs dispatch doesn't know about them") is **inaccurate** based on our v0.135.0 survey:
  - `git grep "plan.toml\|verification.toml"` and `glob **/plan.toml` against `codex/external/repos/codex-patched/codex-rs/` returned no hits.
  - All upstream `"plan"` hits in that tree are the unrelated `ModeKind::Plan` collaboration-mode (e.g. `analytics/src/reducer.rs:2546`, `protocol/src/config_types.rs:603`, `app-server-protocol` schemas).
  - The plan / verification roles are **new built-ins** invented for this fork, modeled after Claude Code subagent prompts. There is nothing in upstream to "wire up".
- The "BLOCKED" status flag in `.ralph-overview/data.json` (`lifecycle: tracked`, `status: blocked`, last touched 2026-05-14) traces back to native-agent-parity's note: "plugin distribution later when manifest learns `[agents.<role>]`". We verified v0.135.0 still has no such manifest block — the wait is open-ended and there is no concrete upstream commit to anticipate. **Unblock criterion satisfied**: accept the same packaging the research already recommended (Option B, `include_str!()` in role.rs).

---

## 2. Survey — current role-system surface in codex v0.135.0

### 2.1 File layout

```
codex/external/repos/codex-patched/codex-rs/core/src/agent/
├── role.rs                   # ~399 LoC, role registry + apply_role_to_config + spawn_tool_spec
├── role_tests.rs             # snapshot/unit tests, includes agent-spawner assertion (line 464)
├── builtins/
│   ├── explorer.toml         # 0 bytes (empty Config layer; description-only role)
│   └── awaiter.toml          # 35 LoC: background_terminal_max_timeout, model_reasoning_effort,
│                             #         developer_instructions
└── control.rs, etc.          # unrelated
```

### 2.2 Dispatch shape (`role.rs`, v0.135.0)

```rust
// Module-private registry, populated once via LazyLock:
mod built_in {
    pub(super) fn configs() -> &'static BTreeMap<String, AgentRoleConfig> { … }
    pub(super) fn config_file_contents(path: &Path) -> Option<&'static str> {
        const EXPLORER: &str = include_str!("builtins/explorer.toml");
        const AWAITER: &str  = include_str!("builtins/awaiter.toml");
        match path.to_str()? {
            "explorer.toml" => Some(EXPLORER),
            "awaiter.toml"  => Some(AWAITER),
            _ => None,
        }
    }
}
```

- Visibility: both functions are `pub(super)` — module-private, not even crate-public.
- Consumers within `role.rs`:
  - `resolve_role_config` (line 119–127) — falls back to `built_in::configs().get(role_name)` after user-defined roles.
  - `apply_role_to_config_inner` (line 56–83) — loads `config_file_contents(config_file)` for built-ins.
  - `spawn_tool_spec::build` (line 221) and `spawn_tool_spec::format_role` (line 256) — read built-in TOMLs to surface model/effort/service-tier notes in the spawn-agent tool description.
- **No external-registration hook exists** in v0.135.0 (no `inventory::collect!`, no `linkme` slice, no public `register_role` API in this module). An overlay crate cannot extend the registry without first patching role.rs to add such a seam.

### 2.3 Existing fork precedent — the `agent-spawner` role

```rust
// SANDBOX PATCH: plugin-scope-axis
(
    "agent-spawner".to_string(),
    AgentRoleConfig {
        description: Some("Use only to request top-level Happy sessions through spawn_top_level_session.".to_string()),
        config_file: None,
        nickname_candidates: None,
    }
),
```

Lines 349–360 of `role.rs`. This is a **canonical edit** to upstream-canonical code, marked with the standard SANDBOX PATCH comment and tracked by invariant 26 in `docs/implementation/patch-surface.md` §14 (`overlay-test` enforcement via `codex-rs-overlay/codex-invariant-tests/tests/plugin_scope_filtering.rs`) and replant recipe in §15 ("Plugin scope-axis replant"). It has survived multiple upstream rebases (most recently the v0.135.0 merge in submodule HEAD `03fe64287`).

This precedent matters because it establishes that:

1. Additive `BTreeMap::from([…])` entries inside the existing `LazyLock` are a sustained-cost-acceptable edit class for this fork.
2. The invariant-test crate is the agreed enforcement mechanism (per AGENTS.override.md tenet 3 "test invariants in-tree").
3. The SANDBOX PATCH marker convention works for `role.rs` without breaking the audit script's `KNOWN_PATCH_FILES` accounting.

### 2.4 Built-in role TOML schema (what fields are legal)

Built-in role TOMLs are partial `ConfigToml` layers applied at session-flag precedence via `reload::build_next_config`. From `awaiter.toml`:

| Field | Type | Effect |
|---|---|---|
| `model` | `string` | Pins the role's model (e.g. `"gpt-5.4"`) — surfaced in tool description as "this role's model is set to `<x>` and cannot be changed". |
| `model_reasoning_effort` | `"minimal" \| "low" \| "medium" \| "high"` | Locks reasoning effort. |
| `service_tier` | `string` | Locks service tier (e.g. `"priority"`). |
| `model_provider` | `string` | If set, switches the role's provider — but the calling session's provider is **preserved** unless this is set (see `apply_role_to_config_inner` lines 72–73). |
| `background_terminal_max_timeout` | `u64` (ms) | Increases the awaiter-style long-poll ceiling. |
| `developer_instructions` | `string` (multi-line) | Prepended to the model's developer prompt. The vehicle for "this role behaves like X". |

Anything that's a valid `ConfigToml` top-level key is technically accepted; in practice the four useful ones for built-ins are `model_reasoning_effort`, `developer_instructions`, plus the awaiter's `background_terminal_max_timeout`. Codex does **not currently support per-role tool gating in the TOML** — i.e. a role TOML cannot say "this role may not use `apply_patch`". Tool restrictions are wired through other paths (`tools/src/tool_config.rs` role gate for `spawn_top_level_session`, `core-plugins` plugin-scope predicates) and are out of scope for this task.

---

## 3. Packaging — overlay vs canonical, per integration point

### 3.1 Integration points

| # | Integration point | Description |
|---|---|---|
| IP-1 | `role.rs` `built_in::configs()` `BTreeMap` | Register the role name → `AgentRoleConfig` (with `description` and `config_file: Some("plan.toml" / "verification.toml")`). |
| IP-2 | `role.rs` `built_in::config_file_contents` match arm | Map `"plan.toml" → Some(PLAN)` / `"verification.toml" → Some(VERIFICATION)` so `apply_role_to_config_inner` can load the embedded contents. |
| IP-3 | `core/src/agent/builtins/plan.toml` (new file) | The actual role config layer. |
| IP-4 | `core/src/agent/builtins/verification.toml` (new file) | The actual role config layer. |
| IP-5 | `core/src/agent/role_tests.rs` (in-tree test extension) | Add coverage that the two new roles resolve via `built_in::configs().get(…)` and surface in `spawn_tool_spec::build` output. Existing `role_tests.rs` already asserts `agent-spawner` at line 464 — extend with parallel assertions. |
| IP-6 | `docs/implementation/patch-surface.md` §14 | Add a new invariant row covering "plan and verification roles registered in `built_in::configs()`; loadable via `apply_role_to_config`". Map to an invariant test (IP-7). |
| IP-7 | `codex-rs-overlay/codex-invariant-tests/tests/builtin_roles.rs` (new) | Invariant test that calls `apply_role_to_config(&mut config, Some("plan"))` and `…Some("verification")` and asserts they succeed (i.e. SANDBOX PATCH lines were not lost in a rebase). |
| IP-8 | `docs/implementation/patch-surface.md` §15 | Replant recipe — paragraph form, paralleling the existing "Plugin scope-axis replant". |

### 3.2 Overlay-vs-canonical per integration point

#### Option A (preferred per operator mandate): pure overlay

For IP-1 + IP-2 to live entirely in an overlay crate `codex-rs-overlay/codex-builtin-roles-extension/`, role.rs would need a registration seam:

```rust
// Hypothetical seam — DOES NOT EXIST in v0.135.0
pub fn register_extra_built_in_role(name: &str, role: AgentRoleConfig, toml: &'static str) { … }

// Or, using inventory:
inventory::collect!(BuiltinRoleEntry);
```

**Verdict: rejected.** The seam itself is a canonical edit to `role.rs` of ~15-25 LoC (the `LazyLock` constructor must consume `inventory::iter::<BuiltinRoleEntry>()` and `config_file_contents` must consult the same registry). That is the *same edit budget* as just adding the two roles directly via Option B, and it permanently adds a global-init hazard (`inventory` slices populate at static-init time, ordering with `LazyLock` is well-defined but adds a class of rebase risk: any upstream refactor of `built_in::configs()` would need to re-thread the merge step). Reserving an `inventory`-based registration hook for a future need where many extension roles are added is fine, but for two role entries it is over-engineering.

Additionally: even with the seam, the TOMLs would still need to live somewhere that `include_str!` can reach at codex-core compile time. Putting them under `codex-rs-overlay/codex-builtin-roles-extension/builtins/` and feeding them through the seam means codex-core depends on the overlay crate compile-time data — reversing the current dependency direction (overlay crates depend on `codex-core`, not the other way around) and breaking the architectural rule that the inner submodule is independently buildable when the invariant-tests overlay is the *only* sibling crate.

#### Option B (recommended): canonical SANDBOX PATCH

| IP | Placement | Conflict-surface cost |
|---|---|---|
| IP-1 | Inline `BTreeMap` entries in `built_in::configs()` LazyLock, immediately after `agent-spawner`, marked with `// SANDBOX PATCH: builtin-roles-extension` | Low — additive entries inside `BTreeMap::from([…])`. Upstream-canonical churn on this LazyLock is one entry per ~1-2 major releases (worker added v0.118-ish, awaiter added then removed, etc.). |
| IP-2 | Inline match arms in `built_in::config_file_contents`, with corresponding `const PLAN: &str = include_str!("builtins/plan.toml");` declarations | Low — same surface as the existing `EXPLORER` / `AWAITER` constants. |
| IP-3, IP-4 | New files `builtins/plan.toml`, `builtins/verification.toml` | Zero — additive only. |
| IP-5 | New test fns in `role_tests.rs` paralleling the existing `agent_spawner_…` test | Low — appended to the test module. |
| IP-6 | New invariant row in `patch-surface.md` §14 | Doc-only. |
| IP-7 | New overlay test crate file `codex-rs-overlay/codex-invariant-tests/tests/builtin_roles.rs` | Zero — overlay-only. |
| IP-8 | New paragraph in `patch-surface.md` §15 | Doc-only. |

**Net conflict surface added to upstream-canonical code: ~30 LoC in `role.rs` + ~5 LoC in `role_tests.rs` + 2 new files.** Functionally identical conflict surface to Option A's seam, with strictly less indirection.

#### Option C (defer-and-do-nothing-now): wait for upstream to ship `[agents.<role>]` plugin manifest

**Verdict: rejected.** The native-agent-parity research already considered this; no upstream signal in v0.135.0 (we verified above). codexu downstream consumers (`work-on` skill, etc.) actively want `plan` and `verification` available now. Indefinite wait is the worst option.

---

## 4. Schema specifications — `plan.toml` and `verification.toml`

Both files live at `core/src/agent/builtins/<role>.toml` and are referenced by the matching `built_in::configs()` entry with `config_file: Some("<role>.toml".to_string().parse().unwrap_or_default())`.

### 4.1 `plan.toml`

```toml
model_reasoning_effort = "medium"
developer_instructions = """You are a planning agent.

Your job is to take a coarse-grained task description and produce a concrete, sequenced plan that another agent can execute. You do NOT execute. You investigate, decide, and write down.

Behavior rules:

1. Surface the actual decision points. List 2-4 candidate approaches when there is a real choice; collapse to one with a brief justification per the tradeoffs. Do not invent fake options.

2. Sequence the work. Produce numbered steps that are independently committable and verifiable. If a step depends on another, say so.

3. Cite the codebase. When the plan references a file, function, or seam, name it with a path + line range so the executing agent does not have to rediscover. Prefer one round of investigation up front over guesses.

4. Acknowledge unknowns explicitly. If something needs a probe to confirm, say "probe needed: <what>" instead of assuming. Defer the assumption-dependent step until after the probe.

5. Do NOT:
   - Write production code.
   - Modify the user's repository state beyond plan deliverables.
   - Skip the sequencing because "it's obvious" — the executing agent may be a different model in a different context window.

6. Output shape: produce a Markdown plan with sections for "Background", "Approach options", "Selected approach", "Sequenced steps", "Risks and unknowns", "Acceptance criteria". Keep the plan under ~500 lines unless the task genuinely warrants more.

7. Verification gate: every step in "Sequenced steps" must list its acceptance check (test name, file output, command exit code). A step with no checkable outcome is not done — split it or add a check.

You may be invoked under a tighter scope (e.g. "plan the prerequisite, defer the full feature"). Follow the operator's narrowing without expanding scope.
"""
```

Design notes:

- `model_reasoning_effort = "medium"` — planning needs more thinking than `awaiter`'s `"low"` but not the `"high"` reserved for hot code paths. Locks the role to medium so a caller cannot accidentally spawn a `plan` agent on a high-cost setting.
- No `model` pin: lets the caller's current model flow through (planning is model-agnostic; pinning would surprise users who explicitly picked a model for their session).
- No `service_tier` pin: same reasoning.
- No `background_terminal_max_timeout`: planning is interactive, not long-poll.
- The prompt deliberately incorporates the operator's mandate that plans cite files + line ranges (echoing rubric from `plan-with-ralph` skill output) and produce checkable acceptance criteria.

### 4.2 `verification.toml`

```toml
model_reasoning_effort = "medium"
developer_instructions = """You are a verification agent.

Your job is to inspect a claim made by another agent (typically: "I implemented X, here's the diff") and return one of three verdicts: PASS, FAIL, or PARTIAL. You are adversarial — assume the claimed work may have gaps and look for them. You are NOT here to be polite.

Behavior rules:

1. Output format. Your final message MUST end with a line of exactly this form:

       VERDICT: PASS
   or  VERDICT: FAIL
   or  VERDICT: PARTIAL

   The line is machine-parsed; do not vary spacing, add bullet markers, or paraphrase. Anything before that line is your investigation summary.

2. Investigation contract. Read the claimed work. Run the tests it claims to add or modify. Spot-check the relevant code paths. Compare against the original task description if one was provided. Do NOT trust the implementing agent's own summary — read the diff.

3. Verdict meanings:
   - PASS: the claimed work is present, the acceptance checks pass, and you found no regression in adjacent code that the claim implicitly required to keep working.
   - PARTIAL: the work is partially present — main change is in place, but one or more acceptance criteria are missing, tests are skipped, or an obvious edge case is unhandled. List the gaps explicitly under a "Gaps" subsection above the VERDICT line.
   - FAIL: the work is materially absent, the diff does the wrong thing, tests do not pass, or the claim contradicts the diff. List the failing observations explicitly under a "Failures" subsection above the VERDICT line.

4. Do NOT:
   - Implement fixes for what you find. You are read-only; another agent will act on your verdict.
   - Soften a FAIL into a PARTIAL to avoid friction. The implementing agent needs the correct signal.
   - Run destructive commands. If you need to run tests, run them in a non-mutating way (read-only checks).

5. If the claim is ambiguous (no clear acceptance criteria provided), state that under an "Insufficient scope" subsection and emit `VERDICT: PARTIAL` — a missing contract is itself a gap.
"""
```

Design notes:

- The `VERDICT: PASS|FAIL|PARTIAL` line is the load-bearing contract called out in `native-agent-parity` research; downstream consumers (codexu `/work-on`, future `review-loop.sh` paths) will grep for this exact pattern. Document this in the plan-surface invariant so a future prompt revision does not silently drop the contract.
- `model_reasoning_effort = "medium"`: verification benefits from careful read-through but does not warrant `"high"`.
- No `model` pin (same reasoning as plan).
- No tool restriction (codex's TOML schema does not support it). Operator-side discipline: when spawning a verification agent, the caller should pass a constrained task description ("verify only, do not implement"). This is documented in the role description in IP-1.

### 4.3 `AgentRoleConfig` entries (for IP-1 in `built_in::configs()`)

```rust
// SANDBOX PATCH: builtin-roles-extension
(
    "plan".to_string(),
    AgentRoleConfig {
        description: Some(r#"Use `plan` for designing the approach to a coarse-grained task before any code is written.
A planning agent investigates the codebase, identifies decision points, and produces a sequenced, checkable plan.
Rules:
- Use when the task description spans multiple files, has unclear scope, or has multiple plausible approaches.
- Do NOT use for trivial single-file edits — plan-then-execute overhead is wasted there.
- The planning agent does not modify code. Hand off the produced plan to a `worker` for execution.
- You may spawn multiple `plan` agents in parallel when investigating independent sub-areas of a larger task."#.to_string()),
        config_file: Some("plan.toml".to_string().parse().unwrap_or_default()),
        nickname_candidates: None,
    }
),
// SANDBOX PATCH: builtin-roles-extension
(
    "verification".to_string(),
    AgentRoleConfig {
        description: Some(r#"Use `verification` to adversarially check another agent's claimed work.
A verification agent reads the diff, runs the acceptance checks, and returns `VERDICT: PASS|FAIL|PARTIAL`.
Rules:
- Use after a `worker` or implementation agent reports done, before merging or marking the task shipped.
- The verification agent is read-only — it does not implement fixes; it only emits a verdict + observations.
- Give the verification agent the original task description AND the implementing agent's summary, so it can compare claim against reality.
- The terminating line `VERDICT: PASS|FAIL|PARTIAL` is machine-parsed by downstream consumers; do not paraphrase it in the spawn prompt."#.to_string()),
        config_file: Some("verification.toml".to_string().parse().unwrap_or_default()),
        nickname_candidates: None,
    }
),
```

### 4.4 `config_file_contents` match arms (for IP-2)

```rust
// SANDBOX PATCH: builtin-roles-extension
const PLAN: &str = include_str!("builtins/plan.toml");
const VERIFICATION: &str = include_str!("builtins/verification.toml");
match path.to_str()? {
    "explorer.toml" => Some(EXPLORER),
    "awaiter.toml" => Some(AWAITER),
    // SANDBOX PATCH: builtin-roles-extension
    "plan.toml" => Some(PLAN),
    "verification.toml" => Some(VERIFICATION),
    _ => None,
}
```

---

## 5. Bundle vs split decision

**Bundle.** A single ship encompassing IP-1 through IP-8 lands as one logical fork patch (`SANDBOX PATCH: builtin-roles-extension`). Reasons:

- Both roles share the same `BTreeMap` block, the same match arm in `config_file_contents`, the same SANDBOX PATCH marker, and the same patch-surface invariant row. Splitting would force two separate rebase-replant entries that always need to be applied together.
- There is no prerequisite work — Section 3.2 Option A (seam-first split) was rejected.
- The invariant test (IP-7) covers both roles in one file; splitting would require two near-identical test files.
- Operator's `native-agent-parity` research explicitly recommended a "combined PR" for `port-plan-and-verification-roles` (vs the separate `port-explorer-prompt` task for the empty `explorer.toml`).

The separate `port-explorer-prompt` task (filling `explorer.toml`) stays independent; this plan deliberately does not touch `explorer.toml`.

---

## 6. LoC estimate per option

| Option | upstream-canonical edited LoC | new upstream-canonical file LoC | overlay LoC | doc LoC | total |
|---|---:|---:|---:|---:|---:|
| **B (recommended)** | ~30 in `role.rs` + ~25 in `role_tests.rs` = **~55** | `plan.toml` ~25 + `verification.toml` ~35 = **~60** | invariant test ~30 | patch-surface §14 row + §15 paragraph ~15 | **~160** |
| A (overlay + seam) | seam in `role.rs` ~20 + `role_tests.rs` ~25 = **~45** | none (TOMLs move to overlay) | new crate skeleton (Cargo.toml + lib.rs) ~80 + TOMLs ~60 + invariant test ~30 = **~170** | same ~15 + extra inventory/seam doc ~10 = ~25 | **~260** |
| C (defer) | 0 | 0 | 0 | 0 | 0 (but task stays BLOCKED forever) |

Option B is ~100 LoC less than Option A and writes fewer files. The upstream-canonical edit budget is *less* than Option A's seam edit (because we don't need the seam's `inventory::collect!` plumbing).

---

## 7. Sequenced steps for the implementation member

1. **Worktree setup** — `/implement-with-ralph` creates `.ralph/jobs/port-plan-and-verification-roles/worktree/` on `ralph/impl-port-plan-and-verification-roles` from `origin/main`. From inside that worktree, `git submodule update --init --recursive` so the codex submodule is populated. Acceptance: `git -C codex/external/repos/codex-patched rev-parse HEAD` reports a non-empty SHA.

2. **Add `plan.toml`** — create `codex/external/repos/codex-patched/codex-rs/core/src/agent/builtins/plan.toml` with the §4.1 content. Acceptance: file exists, parses with `cargo run --quiet -p codex-utils-template -- parse <path>` (or any `toml::from_str` round-trip).

3. **Add `verification.toml`** — create `codex/external/repos/codex-patched/codex-rs/core/src/agent/builtins/verification.toml` with the §4.2 content. Acceptance: same as step 2.

4. **Patch `role.rs` IP-1** — insert the two `// SANDBOX PATCH: builtin-roles-extension` `AgentRoleConfig` entries from §4.3 into `built_in::configs()` `BTreeMap::from([…])`, immediately after the existing `agent-spawner` entry, before the commented-out `awaiter` block. Acceptance: `cargo check -p codex-core` from `codex/external/repos/codex-patched/codex-rs/` exits 0.

5. **Patch `role.rs` IP-2** — add `const PLAN` / `const VERIFICATION` and the two match arms from §4.4. Acceptance: same as step 4.

6. **Extend `role_tests.rs` (IP-5)** — add two tests modeled on the existing `agent-spawner` assertion at line 464:
   ```rust
   #[test]
   fn built_in_configs_contain_plan_role() {
       let plan = built_in::configs().get("plan").expect("plan role registered");
       assert_eq!(plan.config_file.as_ref().and_then(|p| p.to_str()), Some("plan.toml"));
       assert!(plan.description.as_ref().unwrap().contains("planning agent"));
   }
   #[test]
   fn built_in_configs_contain_verification_role() {
       let v = built_in::configs().get("verification").expect("verification role registered");
       assert_eq!(v.config_file.as_ref().and_then(|p| p.to_str()), Some("verification.toml"));
       assert!(v.description.as_ref().unwrap().contains("verification agent"));
   }
   #[test]
   fn built_in_config_file_contents_load_plan_and_verification() {
       use std::path::Path;
       assert!(built_in::config_file_contents(Path::new("plan.toml")).unwrap().contains("planning agent"));
       assert!(built_in::config_file_contents(Path::new("verification.toml")).unwrap().contains("VERDICT: PASS"));
   }
   ```
   Acceptance: `just test -p codex-core built_in` (from `codex/external/repos/codex-patched/codex-rs/`) passes the three new tests.

7. **Add overlay invariant test (IP-7)** — create `codex/codex-rs-overlay/codex-invariant-tests/tests/builtin_roles.rs` that builds a default `Config` via the existing test helpers in the invariant-tests crate, calls `apply_role_to_config(&mut config, Some("plan"))` and the same for `"verification"`, and asserts both succeed. Acceptance: `cargo test -p codex-invariant-tests builtin_roles` passes.

8. **Update `patch-surface.md` §14** — add invariant row 29: "Built-in `plan` and `verification` agent roles registered in `core/src/agent/role.rs::built_in::configs()`; their TOML config layers loadable via `apply_role_to_config`. Enforced by `codex-rs-overlay/codex-invariant-tests/tests/builtin_roles.rs`." Acceptance: row added; `bash codex/scripts/audit_invariants.sh` (if it runs invariant counters) does not regress.

9. **Update `patch-surface.md` §15** — add a "Built-in roles extension replant" paragraph paralleling "Plugin scope-axis replant": specify the marker comment, the file/section anchor, and the test/audit command to verify after a rebase.

10. **Run focused gate** — from inside the worktree:
    - `cd codex/external/repos/codex-patched/codex-rs && cargo check --workspace` (~6 min) — the standard Phase-5a typecheck gate per `codex/CLAUDE.md`.
    - `cd codex/external/repos/codex-patched/codex-rs && just test -p codex-core built_in`
    - `cd codex && cargo test -p codex-invariant-tests builtin_roles`
    - `bash codex/scripts/audit_network_calls.sh` — sanity check that no network endpoint was accidentally introduced (will pass — pure additive role).

11. **Commit** — single commit on `ralph/impl-port-plan-and-verification-roles`:
    ```
    feat(codex/roles): add plan and verification built-in agent roles

    SANDBOX PATCH: builtin-roles-extension. Ports two of the three roles
    recommended by native-agent-parity (2026-05-14): plan (sequenced,
    checkable design output) and verification (adversarial VERDICT:
    PASS|FAIL|PARTIAL contract). Schema documented in
    .ralph/jobs/port-plan-and-verification-roles/plan.md §4.

    Patches:
    - core/src/agent/role.rs: 2 BTreeMap entries + 2 match arms
    - core/src/agent/builtins/plan.toml (new)
    - core/src/agent/builtins/verification.toml (new)
    - core/src/agent/role_tests.rs: 3 new tests
    - codex-rs-overlay/codex-invariant-tests/tests/builtin_roles.rs (new)
    - docs/implementation/patch-surface.md §14 + §15 entries
    ```
    The wrapper-side commit (codexu) bumps the submodule gitlink with the
    same message, plus the plan-job-dir promotion.

12. **Push** — `git push origin` AND `git push personal` for both the codex submodule branch and the codexu wrapper branch. Per AGENTS.md mandate "Always push main to ALL configured remotes after every merge", the lead applies this on FF; the impl member just pushes the topic branches.

---

## 8. Risks and unknowns

| Risk | Likelihood | Mitigation |
|---|---|---|
| Upstream adds a `[agents.<role>]` plugin manifest block in a future rebase, making our hand-registration redundant. | Low (no signal in v0.135.0 after 588 commits). | If it happens, migrate by emptying our `BTreeMap` entries and registering the roles via the manifest. The TOML files port as-is. Invariant test serves as regression guard during the migration. |
| Upstream moves `built_in::configs()` to a different module or restructures the registry. | Medium (codex internals churn). | The SANDBOX PATCH markers + patch-surface.md replant recipe make the relocation grep-able. The agent-spawner precedent has survived multiple rebases unscathed. |
| `model_reasoning_effort = "medium"` is wrong for `plan` — operator may want `"high"`. | Medium. | Operator decision. Defer to operator at PR review; trivial one-line change. |
| The `VERDICT: …` contract phrasing conflicts with an existing downstream regex (e.g. in `review-loop.sh`). | Low — grepped, no existing matches in this exact form. | Codified as an invariant in §4.2; downstream consumers can grep the same string. |
| The `plan.toml`'s reference to "another agent will execute" implies an orchestration model that codex's `worker` role does not strictly enforce. | Low. | The prompt is descriptive, not prescriptive — callers may invoke `plan` standalone. No code dependency. |
| Bazel `BUILD.bazel` needs an update because `core` now has more `include_str!` files. | Medium (per codex/AGENTS.md: "Bazel does not automatically make source-tree files available to compile-time Rust file access. If you add `include_str!`… update the crate's `BUILD.bazel` (`compile_data`…)"). | **Action for impl member:** check `core/BUILD.bazel`'s `compile_data` glob; if it does not already match `src/agent/builtins/*.toml`, add `core/src/agent/builtins/plan.toml` and `core/src/agent/builtins/verification.toml` (or extend the glob). Probe before committing. |

---

## 9. Acceptance criteria (for ship)

The implementation member ships when ALL of the following hold:

1. `cargo check -p codex-core` (from `codex/external/repos/codex-patched/codex-rs/`) exits 0.
2. `just test -p codex-core built_in` (same dir) passes, including the three new tests.
3. `cargo test -p codex-invariant-tests builtin_roles` passes.
4. Spawning `codex` with `--agent_type plan` (or invoking `spawn_agent` with `role: "plan"` from the spawn-agent tool) successfully launches a session with `model_reasoning_effort = "medium"` and the plan developer-instructions injected. Manual smoke check; document the exact command in the commit message.
5. `bash codex/scripts/audit_network_calls.sh` still passes.
6. `bash codex/scripts/audit_invariants.sh` (if it counts invariants) still passes.
7. `docs/implementation/patch-surface.md` has the new §14 invariant row and §15 replant paragraph.
8. The codexu wrapper commit bumps the codex submodule gitlink and includes the `.ralph/jobs/port-plan-and-verification-roles/plan.md` promotion (if `--from-plan` workflow is used).
9. Branch pushed to `origin` AND `personal` on the codex remote; codexu wrapper branch pushed to `origin` AND `personal`.

---

## 10. Handoff

After plan is FF-merged to `main`:

- Lead: `git -C D:/harness-efforts/codexu merge --ff-only <plan-commit-sha>` then `git remote | ForEach-Object { git push $_ main }`.
- Lead: `/plan-with-ralph cleanup port-plan-and-verification-roles` to remove the plan worktree.
- Lead: spawn `impl-port-plan-and-verification-roles` with `/implement-with-ralph --from-plan .ralph/jobs/port-plan-and-verification-roles/plan.md --autonomous`.

The plan deliberately keeps the implementation scope to a single, atomic commit so the impl member's Phase 5a/5b convergence loops have a small surface to review.
