# De-risk spike findings — codex `rust-v0.135.0` → `rust-v0.140.0` rebase: P2/P3 + Q2/Q3/P4

**Task:** `codex-rebase-0140-p2-p3-derisk` (READ-ONLY investigation, member `derisk-p2p3`).
**Date:** 2026-06-16.
**Inputs:** `.ralph/jobs/codex-upstream-rebase-to-0.140/plan.md`, `codex/docs/implementation/patch-surface.md` (§1, §4, §14 Inv 8/9/10/51, §15 replant notes), and read-only git diffs of the inner submodule at `codex/external/repos/codex-patched`.

## Coordinates verified
- Fork base `rust-v0.135.0` (annotated tag obj `f4a628f40d`) → commit **`4daceea869`** (matches plan).
- Target `upstream-rust-v0.140.0` (tag obj `3ac9870e`) → commit **`6506579001`** (matches plan).
- Fork tip `b540ef30` = `sandbox-patches` = `origin/sandbox-patches` (all identical).
- **Caveat for impl:** the submodule is a *grafted/shallow* checkout — `merge-base b540ef30 upstream-rust-v0.135.0` is EMPTY and neither 0.135 nor 0.140 commit is an ancestor of `b540ef30`. Two-dot tree diffs (`A..B` == `git diff A B`) still work and are what this report uses; do NOT rely on `merge-base`/three-dot semantics during the rebase setup.

---

## 1. P2 — Remote-control 3-layer force-disable  →  **REPLANT difficulty: LOW–MEDIUM (was HIGH)**

### What upstream restructured (0.135 → 0.140)
The whole `remote_control/` module was rewritten and grew new sibling files (precise `--numstat`):

| file | added | removed | driver |
|---|---:|---:|---|
| `remote_control/mod.rs` | 802 | 25 | managed-disable + desired-state + pairing |
| `remote_control/websocket.rs` | 787 | 306 | pairing / server-token transport |
| `remote_control/enroll.rs` | 387 | 34 | server tokens (#24141) |
| `remote_control/tests.rs` | 1121 | 55 | new behavior tests |
| `remote_control/auth.rs` *(new)* | 105 | 0 | migrate to server tokens (#24141) |
| `remote_control/clients.rs` *(new)* | 307 | 0 | client management RPCs (#25785) |
| `remote_control/desired_state.rs` *(new)* | 171 | 0 | persist desired state (#27445) |
| `remote_control/tests/clients_tests.rs` *(new)* | 371 | 0 | #25785 |
| `remote_control/tests/pairing_tests.rs` *(new)* | 854 | 0 | PAT-v2 / pairing |
| `app-server-daemon/src/remote_control_client.rs` | 29 | 158 | desired-state client |
| `app-server-protocol/.../v2/remote_control.rs` | 115 | 0 | RPC surface |

### The fork's CURRENT 3-layer override (b540ef30) and how each maps to 0.140
- **Layer 1 (Inv 8) — `start_remote_control` body force** at `mod.rs:184-189`:
  `let remote_control_target = None; let _ = initial_enabled; let initial_enabled = false;` placed after the `state_db_available` guard. The fork's signature still takes `initial_enabled: bool` (mod.rs:176).
- **Layer 2 (Inv 9) — `RemoteControlHandle::set_enabled`** force-false at `mod.rs:75` (+ test marker `tests.rs:701`). Closes the `message_processor::handle_config_mutation → set_enabled(true)` runtime-toggle bypass.
- **Layer 3 (Inv 10) — launcher** `codex-rs-overlay/codex-copilot-launcher/src/config.rs::provider_config_flags` emits `features.remote_control=false`.

### Upstream 0.140 NATIVE managed-disable (this is the #27961 mechanism)
- New enum `RemoteControlPolicy { #[default] Allowed, DisabledByRequirements }` at `mod.rs:71-75`.
- New enum `RemoteControlStartupMode { ResolvePersisted, DisabledEphemeral, EnabledEphemeral }` at `mod.rs:78-82`.
- `start_remote_control(config, …, startup_mode)` (`mod.rs:919-951`): when `config.policy == RemoteControlPolicy::DisabledByRequirements` (OR `!state_db_available`) it sets `desired_state = RemoteControlDesiredState::Disabled` (`mod.rs:932-933`) ⇒ `initial_enabled = desired_state.is_enabled()` = false (`mod.rs:943`) ⇒ **`remote_control_target = None`** (`mod.rs:947-951`). **Upstream now natively reproduces Layer 1 when the policy is set.**
- `RemoteControlHandle` stores `policy: RemoteControlPolicy` (`mod.rs:106`). `ensure_remote_control_allowed()` returns `Err(DisabledByRequirements)` when policy is set (`mod.rs:236-241`).
- **The enable path is policy-gated on its FIRST line:** `enable_ephemeral() → enable_with_preference()` calls `self.ensure_remote_control_allowed().map_err(RemoteControlEnableError::DisabledByRequirements)?;` at `mod.rs:254-259` *before* touching desired_state / waking the websocket. **This natively reproduces Layer 2** (closes the exact `handle_config_mutation` runtime-toggle bypass).
- The policy is derived in `app-server/src/lib.rs:676-686`:
  ```rust
  let remote_control_policy = if config.config_layer_stack.requirements()
      .allow_remote_control.as_ref().is_some_and(|requirement| !requirement.value)
  { RemoteControlPolicy::DisabledByRequirements } else { RemoteControlPolicy::Allowed };
  ```
  Belt-and-suspenders: explicit `EnabledEphemeral` start under `DisabledByRequirements` hard-errors at `app-server/src/lib.rs:690-697`.
- There is also a daemon-only env marker `REMOTE_CONTROL_DISABLED_ENV_VAR = "CODEX_INTERNAL_APP_SERVER_REMOTE_CONTROL_DISABLED"` + `take_remote_control_disabled_env()` (`mod.rs:84-95`, consumed at `app-server/src/main.rs:62`, `app-server-daemon/src/backend/pid.rs:420`). This is the daemon's own way to disable spawned children; it feeds `startup_mode`, **not** the policy, so it is the weaker (ephemeral) lever — do NOT rely on it for the fork.

### **Q2 VERDICT — LEAN ON UPSTREAM. Retire Layers 1 AND 2; reduce P2 from 3 deep layers to 1 shallow seam.**
- **Layer 2 (set_enabled) cannot even be replanted as-is** — `set_enabled` was DELETED upstream (no `fn set_enabled` anywhere in 0.140 `mod.rs`; it was replaced by `enable_ephemeral`/`enable_with_preference`/`disable`/`disable_ephemeral`/`transition_disabled`). The function the fork hooked no longer exists. The native policy gate is the only correct replant.
- **Recommended mechanism (Option B, robust for a privacy patch):** a SINGLE `// SANDBOX PATCH:` at `app-server/src/lib.rs:676-686` forcing the policy unconditionally:
  ```rust
  // SANDBOX PATCH: remote_control is ChatGPT-only; force the managed-disable policy.
  let remote_control_policy = RemoteControlPolicy::DisabledByRequirements;
  ```
  Downstream native code then guarantees ALL three privacy properties (desired_state=Disabled, remote_control_target=None, every enable RPC rejected, EnabledEphemeral start hard-errors). This replaces both deep `mod.rs` body edits (Inv 8 in the rewritten +802/−25 `start_remote_control`, and Inv 9 against a now-deleted function) with ONE shallow edit on a stable `let`-binding seam.
- **Alternative mechanism (Option A, zero source edits):** plant a managed `requirements.toml`/MDM layer with `allow_remote_control = false` (`ConfigRequirementsToml.allow_remote_control: Option<bool>`, `config/src/config_requirements.rs:833`; proven by upstream tests `app-server/tests/suite/v2/remote_control.rs:130,210,284` and `config_rpc.rs:52-72`). Cleaner in theory but requirements come from *system requirements.toml / MDM* (`config_requirements.rs:821`), not user `-c` flags — the fork would have to deploy a managed file. **Less deterministic than Option B for a privacy-critical gate; prefer B, optionally + A as defense-in-depth.**
- **Layer 3 (launcher `features.remote_control=false`):** `Feature::RemoteControl` still exists (`features/src/lib.rs:259, 1204`), so the flag still compiles. With the policy forced it is **moot but free** — keep it as zero-cost belt-and-suspenders or retire it; not load-bearing once Option B is in.
- **Surface reduction:** the two hardest replants in the whole rebase (Inv 8 re-anchor into the +802/−25 rewrite, Inv 9 re-anchor into a deleted function) are ELIMINATED. P2 drops from HIGH to LOW–MEDIUM.

### P2 replant recipe (exact)
1. **Delete** the Layer-1 body override in `mod.rs::start_remote_control` (do not try to re-anchor it; upstream already sets `remote_control_target=None` under the policy).
2. **Delete** the Layer-2 `set_enabled` override + its `tests.rs:701` marker (function is gone; gate is native).
3. **Add** the single policy-force `// SANDBOX PATCH:` at `app-server/src/lib.rs:676-686` (Option B). New invariant test: assert `policy == DisabledByRequirements` after `run_main` config resolution, or a focused test that `enable_ephemeral()` returns `Err(DisabledByRequirements)` and `start_remote_control` yields `remote_control_target=None`.
4. **Keep** Layer 3 launcher flag (optional) — update Inv 10 note that it is now defense-in-depth, not primary.
5. **Re-mark the upstream-behavior tests:** the 10 existing `#[ignore = "patched fork force-disables remote_control…"]` markers must be re-applied AND the NEW test files (`tests/clients_tests.rs`, `tests/pairing_tests.rs`, the +1121 in `tests.rs`) audited — any new test that asserts enrollment / toggle-to-true / websocket-connect runtime behavior must get the same ignore marker (this is the §14 ignore-marker invariant; budget for it as `codex-rebase-debt-fix-remote-control`).
6. **Rewrite patch-surface §1/§4/§14:** Inv 8 + Inv 9 are replaced by a single new invariant ("policy forced to DisabledByRequirements"); update the §1 network-suppression table row for `remote_control/mod.rs` accordingly.

---

## 2. P3 — Multi-agent tool registration  →  **REPLANT difficulty: MEDIUM–HIGH (hardest sub-problem: the squash silently re-dropping `PlannedTools`/`add_collaboration_tools`)**

### What upstream churned (0.135 → 0.140) under `core/src/tools/` and `core/src/agent/`
- `#27304` removed `async_trait` from `ToolExecutor` (confirmed: NO `async_trait` in `registry.rs`/`spec_plan.rs` at 0.140).
- `#27299` "outlined ToolExecutor handler bodies" — visible as the heavy *removal* in `multi_agents_v2/spawn.rs` (**+45 / −102**).
- `#26610` split `agent/control.rs` (monolith) into `agent/control/{execution,legacy,residency,spawn}.rs` (+ tests). `control.rs` still exists.
- Broad tools churn: `spec_plan.rs` +185/−114, `registry.rs` +60/−40, `multi_agents_spec.rs` +61/−48, `shell_spec.rs` +80/−50, `runtimes/mod.rs` +151/−13, `runtimes/unified_exec.rs` +161/−9, plus new files `code_mode/delegate.rs` (+311), `handlers/get_context_remaining.rs` (+95), `multi_agents_v2/interrupt_agent.rs` (+126). v2 activity-tracking (`SubAgentActivityEvent`, `spawn.rs:150-155`) and residency LRU (`control/residency.rs`) are new but internal.

### Critical: the producer-side modules STILL EXIST at 0.140 (the 0.135 drop was a squash artifact, NOT an upstream deletion)
- `spec_plan.rs:100  struct PlannedTools`
- `spec_plan.rs:701  fn add_collaboration_tools(context, planned_tools)` — body still uses the `planned_tools.add_arc(override_tool_exposure(multi_agent_v2_handler(…), exposure))` pattern (verified lines 701-745). The §15 recipe's "don't flatten back to plain `.add()`" rule STILL applies verbatim.
- `registry.rs:47  pub(crate) trait CoreToolRuntime: ToolExecutor<ToolInvocation>`

**⇒ The exact 0.135 failure mode (squash drops `PlannedTools` + `add_collaboration_tools`, leaving an orphaned `impl` block / missing-fn diagnostic) WILL recur** because the fork's `sandbox-patches` tree diverged on these files and `git merge --squash` resolves trees, not history. This is the #1 forecast debt cluster.

### What the fork rides on top here (current seams, all still anchorable at 0.140)
- **Plugin-scope-axis subagent gate** in `multi_agents_v2/spawn.rs` and `multi_agents/spawn.rs`: an early `return Err(…)` at the TOP of free-fn `handle_spawn_agent` after `let ToolInvocation { … } = invocation;` when `turn.session_source` is `SessionSource::SubAgent(_)`, plus a fork-only `use codex_protocol::protocol::SessionSource;`. **The anchor is INTACT at 0.140:** `multi_agents_v2/spawn.rs` keeps `impl ToolExecutor<ToolInvocation> for Handler` (`:25`), `fn tool_name` (`:26`), `fn spec` (`:30`), free `async fn handle_spawn_agent` (`:39`) with `let ToolInvocation { … }` destructure (`:42`), and `impl CoreToolRuntime for Handler` (`:179`) with `fn matches_kind` (`:180`). The gate re-applies at the same structural point; only body lines around it moved.
- **`spawn_top_level_session.rs` is fork-only** (confirmed absent at upstream 0.140 — "exists on disk, but not in upstream-rust-v0.140.0"). Re-adds clean; only its trait shape must match the `ToolExecutor<ToolInvocation>` + `CoreToolRuntime` pair, and its registration must be re-applied (`spec_plan.rs::add_core_utility_tools` `planned_tools.add(SpawnTopLevelSessionHandler)` + `handlers/mod.rs` re-export).
- **`handlers/mod.rs` re-exports at 0.140:** `mod shell;` + `pub use shell::ShellCommandHandler;` (`:27,:69`). **No `ShellHandler`, no `unavailable_tool`** (both deleted upstream — the §15 recipe to DELETE `use …ShellHandler;` and the `unavailable_tool` re-exports is still correct). The fork-only `pub use spawn_top_level_session::SpawnTopLevelSessionHandler;` and `pub use unified_exec::AwaitBackgroundCompletionHandler;` (D-002) must be re-added with SANDBOX anchors.
- **Plugin-scope-axis overlay** `codex-rs-overlay/codex-plugin-scope/` + the `multi_agents_common.rs` seam (markers at `:255`, `:271` in b540ef30: `apply_subagent_plugin_filter`) — zero upstream conflict surface; keep the workspace member + the 1-line call after `apply_spawn_agent_runtime_overrides`.

### P3 replant recipe (exact) — the §15 "Rebase-resume v0.135.0 — spec_plan + multi_agents replant" notes are STILL ACCURATE at 0.140. Apply them verbatim, plus:
1. **First action after squash:** `git show :1:codex-rs/core/src/tools/spec_plan.rs` / `grep -n "struct PlannedTools" spec_plan.rs` to confirm the struct + `add_collaboration_tools` SURVIVED. If the `impl PlannedTools` block exists without the `struct PlannedTools` definition, the squash dropped it — re-import upstream's verbatim. Run `cargo check -p codex-core --lib` before the workspace check to surface this fast.
2. Re-apply the plugin-scope-axis SubAgent gate at the top of `handle_spawn_agent` in BOTH `multi_agents_v2/spawn.rs` (anchor `:42`) and `multi_agents/spawn.rs`, plus the fork-only `use …SessionSource;`.
3. Keep the ONE fork registration `planned_tools.add(SpawnTopLevelSessionHandler)` (plugin-scope-axis) in `add_core_utility_tools`, and `planned_tools.add(AwaitBackgroundCompletionHandler)` (D-002) in `add_shell_tools`' UnifiedExec branch.
4. `handlers/mod.rs`: REMOVE `pub use shell::ShellHandler;` + `unavailable_tool` re-exports; KEEP the two fork re-exports with anchors.
5. Migrate `spawn_top_level_session.rs` + `unified_exec/await_background_completion.rs` to the `ToolExecutor<ToolInvocation>` + `CoreToolRuntime` pair (free-fn body + `.await.map(boxed_tool_output)`; `post_tool_use_payload` on the `CoreToolRuntime` impl taking `&dyn ToolOutput`).
6. Re-run `codex-rs-overlay/codex-invariant-tests/tests/plugin_scope_filtering.rs` (source-pattern grep locally; cargo in CI).
- **Forecast:** spawns `codex-rebase-debt-fix-tools-registration` (dominant) likely folding in `handlers/mod.rs` re-exports, `tool_config.rs` lost imports, and the `app-server/request_processors/*` `ExecParams`/`ExecCommandToolOutput.truncation_policy` drift. This is the plan's #1 debt zone — confirmed.

---

## 3. Q3 — cloud-requirements network-suppression patch  →  **VERDICT: RETIRE (obsolete-at-path, network path is GONE, not relocated)**

- The entire `cloud-requirements/` crate is **DELETED** at 0.140: `cloud-requirements/src/lib.rs` was 2296 lines at 0.135, does not exist at 0.140 (`cat-file -e` exit 128), and `ls-tree -r codex-rs/cloud-requirements/` returns EMPTY. This is the `#24621` "Move cloud requirements crate to cloud config" move.
- Requirements now live as **config**, not a network fetch: `config/src/config_requirements.rs` (`ConfigRequirements` at `:144`, `ConfigRequirementsToml` at `:823` — doc-comment: "Base config deserialized from system `requirements.toml` or MDM"). Loaded via config layers (`config/src/loader/mod.rs:725 requirements_layers_from_legacy_scheme`), not `GET /api/codex/config/requirements`.
- The new `cloud-config` crate has **no production network literal**: grep for `reqwest|.no_proxy|https://|chatgpt.com|/api/codex` across `codex-rs/cloud-config/` matched ONLY `service_tests.rs` (a test file). `requirements_fragment_from_delivered` (`cloud-config/src/backend.rs:128`) consumes already-delivered fragments; it does not itself open a socket.
- **Net effect on `audit_network_calls.sh`:** drop the `cloud-requirements/src/lib.rs` row from `KNOWN_PATCH_FILES` (the file is gone). The Phase-2 new-`.rs` endpoint scan should come back clean for `config/`+`cloud-config/` since neither carries a suppressed endpoint. **One residual verify for the impl (low risk):** confirm `cloud-config/src/backend.rs`'s "delivered" requirements fragment is fed by an already-suppressed channel (the existing app-server/backend connection) and does NOT introduce a fresh fetch behind a helper — run the audit's phase-2 scan + a `grep -rn "reqwest\|http" codex-rs/cloud-config/src` after the squash. Expectation: clean → retire with no relocation.

---

## 4. P4 — `close_agent` → `interrupt_agent` rename (#26994)  →  **VERDICT: CONFLICT, NOT a blanket rename. The rename is V2-ONLY; v1 keeps `close_agent`.**

- **Confirmed rename, scoped to V2:** `multi_agents_v2/close_agent.rs` (0.135) → `multi_agents_v2/interrupt_agent.rs` (0.140, +126 lines). At 0.140 there is NO `close_agent` under `multi_agents_v2/`.
- **V1 is upstream-retained, NOT renamed:** `multi_agents/close_agent.rs` exists at BOTH 0.135 AND 0.140 (`cat-file -e` exit 0 both); there is NO `multi_agents/interrupt_agent.rs`. So the v1 tool name `close_agent` survives upstream.
- **`AgentControl` method split (#26610):** at 0.140 the v2-facing method is `control.rs:190 interrupt_agent()`, and the legacy v1 method is `control/legacy.rs:29 close_agent()`. The fork's current `control.rs:839 close_agent` edit must re-anchor — the v1 call relocates into `control/legacy.rs`, the v2 call name becomes `interrupt_agent` in `control.rs`.
- **The fork's Inv-51 / v1-agent-limit-ux hints reference V1 `close_agent`** (markers in b540ef30: `multi_agents_common.rs:118` cap-counts-open-agents + the `:127` "use close_agent" limit error; `multi_agents_spec.rs:638,715` open/reusable semantics; `multi_agents_spec_tests.rs:73-75` "use close_agent when an agent is no longer needed"). Because v1 keeps the name, **these stay `close_agent` — do NOT blanket-swap them to `interrupt_agent`.**
- **The nuance the impl MUST handle:** audit each fork hint string by which tool it describes. Any V2 `spawn_agent` description text that says "…until close_agent closes them" (e.g. `multi_agents_spec.rs:642,723`, which are spawn_agent_v2 descriptions) must switch to `interrupt_agent`; v1 limit-error hints stay `close_agent`. So P4 is a targeted, per-string CONFLICT plus method-call relocation into the `control/` split — NOT obsolete, and NOT a single sed.

---

## 5. NET conflict-surface reduction summary (headline)

| Item | Verdict | Net effect |
|---|---|---|
| **Q2** remote-control managed-disable (#27961) | **REDUCE — lean on upstream** | Retire **2 of 3 layers**. Inv 8 (deep `start_remote_control` body) + Inv 9 (deleted `set_enabled`) → replaced by **1 shallow `let`-binding force** at `app-server/src/lib.rs:676-686`. Layer 3 launcher flag optional (free). |
| **Q3** cloud-requirements network suppression (#24621) | **REDUCE — retire** | Whole crate deleted; patch obsolete-at-path; network path gone, not relocated. Drop 1 row from `audit_network_calls.sh::KNOWN_PATCH_FILES`. 1 low-risk verify of `cloud-config`. |
| **P4** close_agent→interrupt_agent (#26994) | **REPLANT (targeted) — NOT obsolete** | V2-only rename; v1 keeps `close_agent`. Per-string hint audit + relocate the `AgentControl` v1 call into `control/legacy.rs`. Low effort, but not trivial/blanket. |
| **P2** remote-control replant | **Difficulty LOW–MEDIUM** (was HIGH) | Hardest sub-problem after leaning on upstream: re-applying `#[ignore]` markers across the +1121-line new test surface (`tests.rs` + `tests/clients_tests.rs` + `tests/pairing_tests.rs`) → file `codex-rebase-debt-fix-remote-control`. |
| **P3** multi-agent tool registration | **Difficulty MEDIUM–HIGH** | Hardest sub-problem: the `git merge --squash` silently re-dropping `PlannedTools` + `add_collaboration_tools` (the producer-side modules still exist upstream, so a clean resolve brings them over; a sloppy one orphans the `impl`). Trait skeleton + gate anchors are INTACT, so the §15 recipe applies verbatim. |

### Bottom line (for the rebase impl)
Roughly **half of the predicted "highest-risk" surface can be ELIMINATED before/inside the rebase.** P2 collapses from a 3-layer deep-body override to a single shallow policy-force because upstream's native `RemoteControlPolicy::DisabledByRequirements` reproduces both the start-time and runtime-toggle disables — and the old Layer-2 hook (`set_enabled`) is *gone*, so leaning on upstream is effectively mandatory, not just preferable. Q3's cloud-requirements patch is pure deletion. What remains irreducible and must be hand-resolved: (1) the P3 tools-registration squash-resolution (verify `PlannedTools`/`add_collaboration_tools` survive; re-apply the plugin-scope-axis gate + D-002 registrations against churned-but-structurally-intact files) — this is the dominant debt zone and should drive the Phase-5a `cargo check --workspace` loop; and (2) the P2/P4 test/marker + hint-string fan-out (re-`#[ignore]` the new remote_control test files; per-string v1-vs-v2 `close_agent`/`interrupt_agent` audit; relocate the v1 method call into `control/legacy.rs`).

---

## Read-only proof
Final-step `git status --short` on both repos (pasted verbatim). The inner submodule shows ONLY the pre-existing gitignored `?? .worktrees/` noise and nothing else; the wrapper shows only untracked state/worktree dirs — **no `codex-rs` source was modified, added, or deleted.** This investigation wrote exactly one file (`findings.md`), which lives in the codexu parent repo (`.ralph/investigations/...`), not inside either codex repo.

```
=== git -C codex/external/repos/codex-patched status --short ===
?? .worktrees/
=== (end inner) ===
=== git -C codex status --short ===
?? .crews/
?? .ralph-overview/
?? .worktrees/
?? external/repos/codex-anthropic-models-opt-in-gate-worktree/
?? tasks/INDEX.md
=== (end wrapper) ===
```

